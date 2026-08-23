using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class CreationPipelineStateMachineTests : IDisposable
{
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "connector-pipeline-" + Guid.NewGuid().ToString("N"));

    public CreationPipelineStateMachineTests() => Directory.CreateDirectory(_temp);

    [Fact]
    public void ConnectionGateControlsContextEntryUsingSharedStageStates()
    {
        var session = new CreationSession();
        CreationPipelineStateMachine.PrepareContext(session);
        AssertStage(session, CreationStage.Connect, CreationStageState.Current);
        AssertStage(session, CreationStage.Context, CreationStageState.NotReached);

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connecting, false);
        AssertStage(session, CreationStage.Connect, CreationStageState.InProgress);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, false);
        AssertStage(session, CreationStage.Connect, CreationStageState.WaitingUser);
        AssertStage(session, CreationStage.Context, CreationStageState.NotReached);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Error, false);
        AssertStage(session, CreationStage.Connect, CreationStageState.Error);

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, true);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        AssertStage(session, CreationStage.Context, CreationStageState.Current);
    }

    [Fact]
    public void WaitingUserUsesStructuredStageSpecificReasons()
    {
        var session = SentIdeaSession();
        var connectWaiting = CreationPipelineStateMachine.EvaluateConnectionGate(ConnectionState.Connected, false, false);
        Assert.Equal(CreationStageState.WaitingUser, connectWaiting.State);
        Assert.Equal(CreationWaitingReason.ComfyUiStartRequired, connectWaiting.WaitingReason);
        Assert.Equal("ComfyUI起動待ち", CreationPipelineStateMachine.GetStageStateLabel(connectWaiting));

        var reconnectWaiting = CreationPipelineStateMachine.EvaluateConnectionGate(ConnectionState.Disconnected, false, true);
        Assert.Equal(CreationStageState.WaitingUser, reconnectWaiting.State);
        Assert.Equal(CreationWaitingReason.ReconnectRequired, reconnectWaiting.WaitingReason);
        Assert.Equal("再接続待ち", CreationPipelineStateMachine.GetStageStateLabel(reconnectWaiting));

        var handoff = CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt);
        Assert.Equal(CreationWaitingReason.ChatGptResponseRequired, handoff.WaitingReason);
        Assert.Equal("ChatGPT返答待ち", CreationPipelineStateMachine.GetStageStateLabel(handoff));

        var reviewSession = ReadyForReview(maximumIterations: 2);
        CreationPipelineStateMachine.ReviewCopied(reviewSession);
        var review = CreationPipelineStateMachine.Get(reviewSession, CreationStage.Review);
        Assert.Equal(CreationStageState.WaitingUser, review.State);
        Assert.Equal(CreationWaitingReason.ReviewResponseRequired, review.WaitingReason);
        Assert.Equal("レビュー返答待ち", CreationPipelineStateMachine.GetStageStateLabel(review));

        var limitSession = ReadyForReview(maximumIterations: 1);
        CreationPipelineStateMachine.CommandValidated(limitSession, "generate");
        var limit = CreationPipelineStateMachine.Get(limitSession, CreationStage.Review);
        Assert.Equal(CreationStageState.WaitingUser, limit.State);
        Assert.Equal(CreationWaitingReason.ContinueDecisionRequired, limit.WaitingReason);
        Assert.Equal("続行判断待ち", CreationPipelineStateMachine.GetStageStateLabel(limit));
        Assert.DoesNotContain("ユーザー待ち", CreationPipelineStateMachine.GetStageStateLabel(limit), StringComparison.Ordinal);
    }

    [Fact]
    public void ContextCannotBindUntilMcpAndComfyUiAreReady()
    {
        var session = ConfiguredSession(2);
        CreationPipelineStateMachine.PrepareContext(session);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BindContext(session));

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, false);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BindContext(session));

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, true);
        CreationPipelineStateMachine.BindContext(session);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
    }

    [Fact]
    public void NormalFlowReachesCompletedReviewAndSession()
    {
        var session = BoundSession(maximumIterations: 2);
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);

        CreationPipelineStateMachine.IdeaChanged(session, "night drive");
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        CreationPipelineStateMachine.BootstrapCopied(session, "night drive");
        AssertStage(session, CreationStage.Idea, CreationStageState.Completed);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        AssertStage(session, CreationStage.Command, CreationStageState.Completed);
        AssertStage(session, CreationStage.Apply, CreationStageState.Current);
        CreationPipelineStateMachine.BeginApply(session);
        CreationPipelineStateMachine.ApplyCompleted(session);
        AssertStage(session, CreationStage.Generate, CreationStageState.Current);

        var iteration = StartSuccessfulIteration(session, "one.mp4");
        AssertStage(session, CreationStage.Generate, CreationStageState.Completed);
        AssertStage(session, CreationStage.Output, CreationStageState.Completed);
        AssertStage(session, CreationStage.Review, CreationStageState.Current);
        CreationPipelineStateMachine.ReviewCopied(session);
        AssertStage(session, CreationStage.Review, CreationStageState.WaitingUser);

        CreationPipelineStateMachine.CommandValidated(session, "complete");
        CreationPipelineStateMachine.Complete(session, "approved");
        AssertStage(session, CreationStage.Review, CreationStageState.Completed);
        Assert.Equal(SessionStatus.Completed, session.Status);
        Assert.Single(session.Iterations);
        Assert.Same(iteration, session.Iterations[0]);
    }

    [Fact]
    public void ReviewGenerateStartsNextIterationWithoutRebindingContext()
    {
        var session = ReadyForReview(maximumIterations: 3);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Command, CreationStageState.Completed);
        AssertStage(session, CreationStage.Apply, CreationStageState.Current);
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        var second = session.StartIteration("second", new Dictionary<string, JsonNode?>());
        Assert.Equal(2, second.Number);
        Assert.True(session.Pipeline.ContextBound);
    }

    [Fact]
    public void CommandErrorCanBeRetriedWithoutLosingCompletedUpstreamStages()
    {
        var session = SentIdeaSession();
        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidationFailed(session, "invalid json");
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Completed);
        AssertStage(session, CreationStage.Command, CreationStageState.Error);
        AssertStage(session, CreationStage.Apply, CreationStageState.NotReached);

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        AssertStage(session, CreationStage.Command, CreationStageState.Completed);
        AssertStage(session, CreationStage.Apply, CreationStageState.Current);
    }

    [Fact]
    public void ApplyErrorGenerateFailureAndCancellationRemainDistinct()
    {
        var session = CommandReadySession();
        CreationPipelineStateMachine.BeginApply(session);
        CreationPipelineStateMachine.ApplyFailed(session, "validation failed");
        AssertStage(session, CreationStage.Apply, CreationStageState.Error);
        AssertStage(session, CreationStage.Generate, CreationStageState.NotReached);

        CreationPipelineStateMachine.BeginApply(session);
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Failed, "job failed");
        AssertStage(session, CreationStage.Generate, CreationStageState.Error);

        CreationPipelineStateMachine.BeginGenerate(session);
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Cancelled, "cancelled");
        AssertStage(session, CreationStage.Generate, CreationStageState.Cancelled);
        Assert.NotEqual(SessionStatus.Completed, session.Status);
    }

    [Fact]
    public void OutputFailureIsSeparateFromSuccessfulGenerate()
    {
        var session = CommandReadySession();
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        session.StartIteration("test", new Dictionary<string, JsonNode?>());
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Completed);
        CreationPipelineStateMachine.OutputCompleted(session, []);
        AssertStage(session, CreationStage.Generate, CreationStageState.Completed);
        AssertStage(session, CreationStage.Output, CreationStageState.Error);
        AssertStage(session, CreationStage.Review, CreationStageState.NotReached);
    }

    [Fact]
    public void EditingSentIdeaResetsOnlyCurrentPipelineAndPreservesHistory()
    {
        var session = ReadyForReview(maximumIterations: 3);
        var history = session.Iterations.Single();
        session.Pipeline.SentIdeaSnapshot = "original";
        CreationPipelineStateMachine.IdeaChanged(session, "modified");
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.NotReached);
        AssertStage(session, CreationStage.Review, CreationStageState.NotReached);
        Assert.Same(history, session.Iterations.Single());
        Assert.Single(history.Outputs);
    }

    [Fact]
    public void ReplacingCommandResetsApplyAndDownstream()
    {
        var session = CommandReadySession();
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.CommandReplaced(session);
        AssertStage(session, CreationStage.Command, CreationStageState.Current);
        AssertStage(session, CreationStage.Apply, CreationStageState.NotReached);
        AssertStage(session, CreationStage.Generate, CreationStageState.NotReached);
    }

    [Fact]
    public void IterationLimitCreatesSafetyStopUntilUserContinues()
    {
        var session = ReadyForReview(maximumIterations: 1);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        Assert.True(session.Pipeline.MaximumIterationSafetyStop);
        AssertStage(session, CreationStage.Review, CreationStageState.WaitingUser);
        AssertStage(session, CreationStage.Apply, CreationStageState.NotReached);
        Assert.Equal(1, session.CurrentIteration);

        CreationPipelineStateMachine.ContinueBeyondLimit(session);
        Assert.False(session.Pipeline.MaximumIterationSafetyStop);
        Assert.Equal(2, session.MaximumIterations);
        AssertStage(session, CreationStage.Apply, CreationStageState.Current);
    }

    [Fact]
    public void RebindingContextPreservesPreviousIterations()
    {
        var session = ReadyForReview(maximumIterations: 2);
        var previous = session.Iterations.Single();
        session.LocalChatContextId = "chat-2";
        session.ChatLabel = "Scene 02";
        CreationPipelineStateMachine.BindContext(session);
        Assert.Equal("chat-2", session.LocalChatContextId);
        Assert.Same(previous, session.Iterations.Single());
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
    }

    [Fact]
    public void DisconnectPreservesSessionDataAndReconnectContinuesAtExistingStage()
    {
        var session = ReadyForReview(maximumIterations: 3);
        var workflow = session.BoundWorkflow;
        var idea = session.OriginalIdea;
        var iteration = session.Iterations.Single();
        var reviewState = CreationPipelineStateMachine.Get(session, CreationStage.Review).State;

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Disconnected, false);

        AssertStage(session, CreationStage.Connect, CreationStageState.WaitingUser);
        Assert.Same(workflow, session.BoundWorkflow);
        Assert.Equal(idea, session.OriginalIdea);
        Assert.Same(iteration, session.Iterations.Single());
        Assert.Equal(reviewState, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BeginGenerate(session));

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, true);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        Assert.Equal(reviewState, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
        Assert.Same(iteration, session.Iterations.Single());
    }

    private CreationSession BoundSession(int maximumIterations)
    {
        var session = ConfiguredSession(maximumIterations);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected, true);
        CreationPipelineStateMachine.BindContext(session);
        return session;
    }

    private static CreationSession ConfiguredSession(int maximumIterations) => new()
    {
        BoundWorkflow = WorkflowIdentity.Create("test.json"),
        LocalProjectContextId = "project",
        LocalChatContextId = "chat",
        ProjectLabel = "Project",
        ChatLabel = "Chat",
        MaximumIterations = maximumIterations,
    };

    private CreationSession SentIdeaSession()
    {
        var session = BoundSession(3);
        session.OriginalIdea = "idea";
        CreationPipelineStateMachine.BootstrapCopied(session, session.OriginalIdea);
        return session;
    }

    private CreationSession CommandReadySession()
    {
        var session = SentIdeaSession();
        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        return session;
    }

    private CreationSession ReadyForReview(int maximumIterations)
    {
        var session = CommandReadySession();
        session.MaximumIterations = maximumIterations;
        CreationPipelineStateMachine.ApplyCompleted(session);
        return FinishIteration(session, "output-" + Guid.NewGuid().ToString("N") + ".mp4");
    }

    private SessionIteration StartSuccessfulIteration(CreationSession session, string fileName)
    {
        CreationPipelineStateMachine.BeginGenerate(session);
        var iteration = session.StartIteration("prompt", new Dictionary<string, JsonNode?>());
        var path = Path.Combine(_temp, fileName);
        File.WriteAllText(path, "media");
        iteration.Status = JobStatus.Completed;
        iteration.Outputs = [new OutputArtifact { FileName = fileName, FullPath = path, Type = "mp4" }];
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Completed);
        CreationPipelineStateMachine.OutputCompleted(session, iteration.Outputs);
        return iteration;
    }

    private CreationSession FinishIteration(CreationSession session, string fileName)
    {
        StartSuccessfulIteration(session, fileName);
        return session;
    }

    private static void AssertStage(CreationSession session, CreationStage stage, CreationStageState expected)
        => Assert.Equal(expected, CreationPipelineStateMachine.Get(session, stage).State);

    public void Dispose()
    {
        if (Directory.Exists(_temp)) Directory.Delete(_temp, true);
    }
}
