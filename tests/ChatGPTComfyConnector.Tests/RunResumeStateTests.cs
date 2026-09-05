using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class RunResumeStateTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "ChatGPTComfyConnector.RunResumeStateTests", Guid.NewGuid().ToString("N"));

    [Fact]
    public void LimitReachedRetainsValidatedGenerateAsDeferredCommand()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        CreationPipelineStateMachine.AutomaticIterationStarted(session);
        CreationPipelineStateMachine.ReviewHandoffPreparing(session, pending, 5, 42, "https://chatgpt.com/c/fixture");
        var deferred = new DeferredGenerateSnapshot
        {
            RunId = session.Pipeline.CurrentRun!.RunId,
            SessionId = session.Id,
            RequestId = "response-request-5",
            HandoffId = pending.HandoffId,
            BoundaryId = pending.BoundaryId,
            CommandText = "connector-response-with-generate",
            Iteration = session.CurrentIteration,
        };

        CreationPipelineStateMachine.AutomaticIterationLimitReached(
            session,
            "maximum reached",
            deferred);

        Assert.Equal(SessionStatus.LimitReached, session.Status);
        Assert.Equal(AutomaticIterationState.LimitReached, session.Pipeline.AutomaticIteration!.State);
        Assert.True(session.Pipeline.MaximumIterationSafetyStop);
        Assert.Same(deferred, session.Pipeline.DeferredGenerate);
        Assert.Equal("connector-response-with-generate", deferred.CommandText);
        Assert.Equal(ReviewHandoffState.Received, session.Pipeline.ReviewHandoff!.State);
        Assert.Equal(pending.HandoffId, session.PendingHandoff!.HandoffId);
        Assert.Equal(pending.BoundaryId, session.PendingHandoff.BoundaryId);
        Assert.Equal(5, session.CurrentIteration);
    }

    [Fact]
    public void LimitResumeCreatesOneRunAndReusesTheDeferredIdentity()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        var oldRunId = session.Pipeline.CurrentRun!.RunId;
        var deferred = new DeferredGenerateSnapshot
        {
            RunId = oldRunId,
            SessionId = session.Id,
            RequestId = "response-request-5",
            HandoffId = pending.HandoffId,
            BoundaryId = pending.BoundaryId,
            CommandText = "validated-generate",
            Iteration = 5,
        };
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached", deferred);

        var first = CreationPipelineStateMachine.ResumeFromLimit(session);
        var recoveryRun = session.Pipeline.CurrentRun!;
        var recoveryRunId = recoveryRun.RunId;

        Assert.Same(deferred, first);
        Assert.Equal(SessionStatus.Active, session.Status);
        Assert.Equal(2, recoveryRun.Number);
        Assert.Equal(5, recoveryRun.StartIteration);
        Assert.Equal(0, recoveryRun.IterationCount);
        Assert.NotEqual(oldRunId, recoveryRunId);
        Assert.Equal(recoveryRunId, deferred!.RecoveryRunId);
        Assert.False(session.Pipeline.MaximumIterationSafetyStop);

        var second = CreationPipelineStateMachine.ResumeFromLimit(session);

        Assert.Same(deferred, second);
        Assert.Equal(recoveryRunId, session.Pipeline.CurrentRun!.RunId);
        Assert.Equal(2, session.Pipeline.CurrentRun.Number);
        Assert.Equal(5, session.CurrentIteration);
        Assert.Same(pending, session.PendingHandoff);
    }

    [Fact]
    public void CompletedResumePreservesHistoryAndStartsANewRun()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        var oldRunId = session.Pipeline.CurrentRun!.RunId;
        CreationPipelineStateMachine.Complete(session, "approved");

        CreationPipelineStateMachine.Resume(session);

        Assert.Equal(SessionStatus.Active, session.Status);
        Assert.Equal(2, session.Pipeline.CurrentRun!.Number);
        Assert.NotEqual(oldRunId, session.Pipeline.CurrentRun.RunId);
        Assert.Equal(5, session.Pipeline.CurrentRun.StartIteration);
        Assert.Equal(5, session.CurrentIteration);
        Assert.Equal(5, session.Iterations.Count);
        Assert.Null(session.PendingHandoff);
        Assert.Null(session.Pipeline.ReviewHandoff);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
    }

    [Fact]
    public void ResumeHandoffUsesTheSameSessionAndOnlyAllowsGenerate()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var latest = session.Iterations.Last();
        var resume = PendingHandoffFactory.CreateResume(session, []);

        var payload = ConnectorContextBuilder.BuildResult(session, latest, resume);

        Assert.Equal(PendingHandoffPurpose.Resume, resume.Purpose);
        Assert.True(PendingHandoffReuse.IsReview(resume));
        Assert.Equal(["generate"], resume.AllowedActions);
        Assert.Equal(session.Id, resume.SessionId);
        Assert.DoesNotContain("Complete response grammar:", payload, StringComparison.Ordinal);
        Assert.Contains("Generate response grammar:", payload, StringComparison.Ordinal);
        Assert.Contains("permits generate only", payload, StringComparison.Ordinal);
    }

    [Fact]
    public void CompletedResumeHandoffUsesFreshBoundaryIdentity()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var original = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = original;
        CreationPipelineStateMachine.Complete(session, "approved");

        CreationPipelineStateMachine.Resume(session);
        var resumed = PendingHandoffFactory.CreateResume(session, []);

        Assert.Equal(original.SessionId, resumed.SessionId);
        Assert.NotEqual(original.HandoffId, resumed.HandoffId);
        Assert.NotEqual(original.BoundaryId, resumed.BoundaryId);
        Assert.Equal(5, resumed.Iteration);
    }

    [Fact]
    public void RepeatedResumeDoesNotClearAnActiveResumeBoundary()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        CreationPipelineStateMachine.Complete(session, "approved");
        CreationPipelineStateMachine.Resume(session);
        var runId = session.Pipeline.CurrentRun!.RunId;
        var pending = PendingHandoffFactory.CreateResume(session, []);
        session.PendingHandoff = pending;
        CreationPipelineStateMachine.ReviewHandoffPreparing(session, pending, 5, 42, "https://chatgpt.com/c/fixture");
        CreationPipelineStateMachine.AutomaticIterationStarted(session);

        CreationPipelineStateMachine.Resume(session);

        Assert.Equal(runId, session.Pipeline.CurrentRun!.RunId);
        Assert.Same(pending, session.PendingHandoff);
        Assert.Equal(ReviewHandoffState.Preparing, session.Pipeline.ReviewHandoff!.State);
        Assert.Equal(AutomaticIterationState.Running, session.Pipeline.AutomaticIteration!.State);
    }

    [Fact]
    public void AFinalNormalReviewStillAllowsGenerateAndComplete()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var review = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");

        Assert.Equal(["generate", "complete"], review.AllowedActions);
        Assert.Contains("complete", ConnectorContextBuilder.BuildResult(session, session.Iterations.Last(), review), StringComparison.Ordinal);
    }

    [Fact]
    public void OldRunReviewResponseIsRejectedAfterTheRunReachesTheLimit()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "old-review-request";
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ComfyToChatGpt,
            Kind = HandoffMessageKind.ReviewRequest,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });
        CreationPipelineStateMachine.AutomaticIterationStarted(session);
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached");

        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            "late response");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal("automatic_iteration_closed", result.Stage);
        Assert.Same(pending, session.PendingHandoff);
    }

    [Fact]
    public void IterationHistoryContinuesAcrossRunsAndSessionIdentityIsStable()
    {
        var session = SessionWithCompletedIterations(5, maximumIterations: 5);
        var sessionId = session.Id;
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached");
        CreationPipelineStateMachine.ResumeFromLimit(session);

        var next = session.StartIteration("resumed", new Dictionary<string, JsonNode?>());

        Assert.Equal(6, next.Number);
        Assert.Equal([1, 2, 3, 4, 5, 6], session.Iterations.Select(item => item.Number));
        Assert.Equal(sessionId, session.Id);
        Assert.Equal(1, session.Pipeline.CurrentRun!.IterationCount);
        Assert.Equal(5, session.Pipeline.CurrentRun.StartIteration);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory)) Directory.Delete(_tempDirectory, recursive: true);
    }

    private CreationSession SessionWithCompletedIterations(int count, int maximumIterations)
    {
        Directory.CreateDirectory(_tempDirectory);
        var session = new CreationSession
        {
            Id = "session-run-test",
            OriginalIdea = "idea",
            ProjectLabel = "Project",
            ChatLabel = "Chat",
            ContextProviderId = ContextProviderIds.LocalJson,
            ProjectContextKey = "project-run-test",
            ChatContextKey = "chat-run-test",
            BoundWorkflow = WorkflowIdentity.Create("workflow.json"),
            MaximumIterations = maximumIterations,
        };
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindWorkflow(session, session.BoundWorkflow!, SlotDiscoveryState.Loaded);
        CreationPipelineStateMachine.BindChat(session);
        for (var number = 1; number <= count; number++)
        {
            var outputPath = Path.Combine(_tempDirectory, $"output-{number}.mp4");
            File.WriteAllText(outputPath, "media");
            var iteration = session.StartIteration($"prompt-{number}", new Dictionary<string, JsonNode?>());
            iteration.Status = JobStatus.Completed;
            iteration.Outputs = [new OutputArtifact
            {
                FileName = $"output-{number}.mp4",
                Type = "mp4",
                FullPath = outputPath,
            }];
        }
        CreationPipelineStateMachine.OutputCompleted(session, session.Iterations.Last().Outputs);
        return session;
    }
}
