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

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connecting);
        AssertStage(session, CreationStage.Connect, CreationStageState.InProgress);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        AssertStage(session, CreationStage.Context, CreationStageState.Current);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Error);
        AssertStage(session, CreationStage.Connect, CreationStageState.Error);

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        AssertStage(session, CreationStage.Context, CreationStageState.Current);
    }

    [Fact]
    public void WaitingUserUsesStructuredStageSpecificReasons()
    {
        var session = SentIdeaSession();
        var connectCompleted = CreationPipelineStateMachine.EvaluateConnectionGate(ConnectionState.Connected, false);
        Assert.Equal(CreationStageState.Completed, connectCompleted.State);
        Assert.Equal(CreationWaitingReason.None, connectCompleted.WaitingReason);

        var generateSession = CommandReadySession();
        CreationPipelineStateMachine.ApplyCompleted(generateSession);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.RequireComfyUi(generateSession, CreationStage.Generate, false));
        var generateWaiting = CreationPipelineStateMachine.Get(generateSession, CreationStage.Generate);
        Assert.Equal(CreationStageState.WaitingUser, generateWaiting.State);
        Assert.Equal(CreationWaitingReason.ComfyUiStartRequired, generateWaiting.WaitingReason);
        Assert.Equal("ComfyUI起動待ち", CreationPipelineStateMachine.GetStageStateLabel(generateWaiting));

        var reconnectWaiting = CreationPipelineStateMachine.EvaluateConnectionGate(ConnectionState.Disconnected, true);
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
    public void AutomaticComfyUiStartupUsesInProgressAndFailureDoesNotEraseHistory()
    {
        var session = ReadyForReview(maximumIterations: 3);
        var output = session.Iterations.Single().Outputs.Single();

        CreationPipelineStateMachine.BeginComfyUiStartup(session, CreationStage.Generate);
        var starting = CreationPipelineStateMachine.Get(session, CreationStage.Generate);
        Assert.Equal(CreationStageState.InProgress, starting.State);
        Assert.Equal("ComfyUI起動中", starting.Detail);
        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Output).State);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);

        CreationPipelineStateMachine.ComfyUiStartupFailed(session, CreationStage.Generate, "ComfyUIを起動できませんでした。");
        var failed = CreationPipelineStateMachine.Get(session, CreationStage.Generate);
        Assert.Equal(CreationStageState.Error, failed.State);
        Assert.NotEqual(CreationStageState.WaitingUser, failed.State);
        Assert.Equal("ComfyUIを起動できませんでした。", failed.Detail);
        Assert.Equal(output.FileName, session.Iterations.Single().Outputs.Single().FileName);
        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Output).State);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
    }

    [Fact]
    public void PersistedHandoffPayloadCanBeReusedWithoutRebuilding()
    {
        const string saved = "  {\"handoff_id\":\"original\"}\n";
        var message = new HandoffMessage { Payload = saved };

        Assert.True(HandoffPayloadReuse.TryGetSavedPayload(message, out var payload));
        Assert.Equal(saved, payload);
        Assert.False(HandoffPayloadReuse.TryGetSavedPayload(new HandoffMessage(), out _));
        Assert.False(HandoffPayloadReuse.TryGetSavedPayload(null, out _));
    }

    [Theory]
    [InlineData(HandoffTransportState.Copied)]
    [InlineData(HandoffTransportState.Failed)]
    public void ExplicitBootstrapRetryKeepsTheSamePendingIdentityAndBody(HandoffTransportState transportState)
    {
        var session = BoundSession(3);
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        const string bodySuffix = "\n\n# saved bootstrap body";
        var payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}{bodySuffix}";
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = transportState,
            Payload = payload,
        });

        var handoffId = pending.HandoffId;
        var boundaryId = pending.BoundaryId;
        var sessionId = pending.SessionId;
        var messageCount = session.HandoffMessages.Count;

        Assert.True(PendingHandoffReuse.TryGetResendableBootstrapPayload(session, out var retryPayload));
        Assert.Equal(payload, retryPayload);
        Assert.Equal(sessionId, session.PendingHandoff.SessionId);
        Assert.Equal(handoffId, session.PendingHandoff.HandoffId);
        Assert.Equal(boundaryId, session.PendingHandoff.BoundaryId);

        foreach (var connection in new[] { ConnectionState.Connected, ConnectionState.Disconnected, ConnectionState.Connected })
        {
            CreationPipelineStateMachine.SynchronizeConnectionGate(session, connection);
        }

        Assert.Equal(messageCount, session.HandoffMessages.Count);
        Assert.Equal(transportState, session.HandoffMessages.Single().State);
        Assert.Equal(payload, session.HandoffMessages.Single().Payload);
        Assert.Equal(sessionId, session.PendingHandoff.SessionId);
        Assert.Equal(handoffId, session.PendingHandoff.HandoffId);
        Assert.Equal(boundaryId, session.PendingHandoff.BoundaryId);
    }

    [Fact]
    public void SentBootstrapIsNotEligibleForExplicitRetry()
    {
        var session = BoundSession(3);
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });

        Assert.False(PendingHandoffReuse.TryGetResendableBootstrapPayload(session, out _));
    }

    [Fact]
    public void WaitingHandoffSurvivesConnectionRefreshesAndKeepsItsIdentity()
    {
        var session = SentIdeaSession();
        session.PendingHandoff = new PendingHandoffSnapshot
        {
            HandoffId = "handoff-stable",
            BoundaryId = "boundary-stable",
            SessionId = session.Id,
            WorkflowIdentity = session.BoundWorkflow!.RelativePath,
            KickoffInstruction = session.OriginalIdea,
            AllowedActions = ["generate"],
        };
        var originalHandoffId = session.PendingHandoff.HandoffId;
        var originalBoundaryId = session.PendingHandoff.BoundaryId;

        foreach (var connection in new[]
                 {
                     ConnectionState.Connected,
                     ConnectionState.Connecting,
                     ConnectionState.Disconnected,
                     ConnectionState.Error,
                     ConnectionState.Connected,
                 })
        {
            CreationPipelineStateMachine.SynchronizeConnectionGate(session, connection);
            AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);
            Assert.Equal(originalHandoffId, session.PendingHandoff.HandoffId);
            Assert.Equal(originalBoundaryId, session.PendingHandoff.BoundaryId);
        }
    }

    [Fact]
    public void IdeaChangedIgnoresLineEndingOnlyUpdateButInvalidatesARealEdit()
    {
        var session = BoundSession(3);
        session.OriginalIdea = "line one\nline two";
        CreationPipelineStateMachine.BootstrapCopied(session, session.OriginalIdea);

        CreationPipelineStateMachine.IdeaChanged(session, "line one\r\nline two");
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);
        Assert.Equal("line one\nline two", session.Pipeline.SentIdeaSnapshot);

        CreationPipelineStateMachine.IdeaChanged(session, "line one\r\nchanged");
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.NotReached);
        Assert.Null(session.PendingHandoff);
    }

    [Fact]
    public void ConfirmedBootstrapWaitingStateIsRestoredFromItsPendingSnapshot()
    {
        var session = SentIdeaSession();
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        var pending = session.PendingHandoff!;
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });
        var handoff = CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt);
        handoff.State = CreationStageState.NotReached;
        handoff.WaitingReason = CreationWaitingReason.None;

        CreationPipelineStateMachine.EnsureInitialized(session);

        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);
        Assert.Equal(CreationWaitingReason.ChatGptResponseRequired, handoff.WaitingReason);
    }

    [Fact]
    public void BootstrapSnapshotCompatibilityReusesIdentityOnlyForTheSameSource()
    {
        var session = BoundSession(3);
        session.OriginalIdea = "night drive\nwith rain";
        var slots = new[]
        {
            new WorkflowSlot
            {
                Address = "6.prompt", Label = "Prompt", Type = "STRING",
                CurrentValue = JsonValue.Create("night drive"),
            },
        };
        var pending = PendingHandoffFactory.Create(session, slots, "generate");
        var handoffId = pending.HandoffId;

        Assert.True(PendingHandoffReuse.MatchesBootstrap(session, pending, slots, "night drive\r\nwith rain"));
        Assert.Equal(handoffId, pending.HandoffId);

        session.ChatLabel = "Another Chat";
        Assert.False(PendingHandoffReuse.MatchesBootstrap(session, pending, slots, session.OriginalIdea));
        session.ChatLabel = "Chat";
        slots[0].CurrentValue = JsonValue.Create("changed");
        Assert.False(PendingHandoffReuse.MatchesBootstrap(session, pending, slots, session.OriginalIdea));
        Assert.Equal(handoffId, pending.HandoffId);
    }

    [Fact]
    public void BootstrapPayloadIdentityMustMatchTheIssuedSnapshot()
    {
        var pending = new PendingHandoffSnapshot
        {
            HandoffId = "handoff-1",
            SessionId = "session-1",
            BoundaryId = "boundary-1",
        };
        var payload = "handoff_id: handoff-1\nsession_id: session-1\nboundary_id: boundary-1";

        Assert.True(PendingHandoffReuse.MatchesPayload(pending, payload));
        Assert.False(PendingHandoffReuse.MatchesPayload(pending, payload.Replace("boundary-1", "boundary-old", StringComparison.Ordinal)));
        Assert.False(PendingHandoffReuse.MatchesPayload(pending, payload.Replace("handoff-1", "handoff-old", StringComparison.Ordinal)));
    }

    [Fact]
    public void EditingKickoffAfterPrepareInvalidatesTheUnconfirmedSnapshot()
    {
        var session = BoundSession(3);
        session.OriginalIdea = "first";
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");

        CreationPipelineStateMachine.IdeaChanged(session, "second");

        Assert.Null(session.PendingHandoff);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.NotReached);
    }

    [Fact]
    public void InvalidCommandKeepsWaitingForTheSameChatGptResponse()
    {
        var session = SentIdeaSession();
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        var handoffId = session.PendingHandoff.HandoffId;
        var boundaryId = session.PendingHandoff.BoundaryId;

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidationFailed(session, "以前のHandoffへの返信です");

        AssertStage(session, CreationStage.Command, CreationStageState.Error);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);
        Assert.Equal(CreationWaitingReason.ChatGptResponseRequired, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).WaitingReason);
        Assert.Equal(handoffId, session.PendingHandoff.HandoffId);
        Assert.Equal(boundaryId, session.PendingHandoff.BoundaryId);
    }

    [Fact]
    public void ReviewValidationUsesImmutablePendingPurposeAndPreservesSuccessfulOutput()
    {
        var session = ReadyForReview(maximumIterations: 3);
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        Assert.Equal(PendingHandoffPurpose.Review, pending.Purpose);
        session.PendingHandoff = pending;
        CreationPipelineStateMachine.ReviewCopied(session);

        var outputState = CreationPipelineStateMachine.Get(session, CreationStage.Output);
        var reviewState = CreationPipelineStateMachine.Get(session, CreationStage.Review);
        var handoffId = pending.HandoffId;

        CreationPipelineStateMachine.BeginCommandValidation(session);

        Assert.Equal(CreationStageState.Completed, outputState.State);
        Assert.Equal(CreationStageState.WaitingUser, reviewState.State);
        Assert.Equal(handoffId, session.PendingHandoff.HandoffId);

        CreationPipelineStateMachine.CommandValidationFailed(session, "不正なCommand");

        AssertStage(session, CreationStage.Command, CreationStageState.Error);
        AssertStage(session, CreationStage.Output, CreationStageState.Completed);
        AssertStage(session, CreationStage.Review, CreationStageState.WaitingUser);
        Assert.Equal(handoffId, session.PendingHandoff.HandoffId);
        Assert.Single(session.Iterations);
    }

    [Fact]
    public void ReviewCompleteIsAcceptedEvenWhenTransientReviewStateWasCleared()
    {
        var session = ReadyForReview(maximumIterations: 3);
        session.PendingHandoff = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        var review = CreationPipelineStateMachine.Get(session, CreationStage.Review);
        review.State = CreationStageState.NotReached;
        review.WaitingReason = CreationWaitingReason.None;
        var output = CreationPipelineStateMachine.Get(session, CreationStage.Output);
        Assert.Equal(CreationStageState.Completed, output.State);

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "complete");

        AssertStage(session, CreationStage.Command, CreationStageState.Completed);
        AssertStage(session, CreationStage.Review, CreationStageState.Completed);
        AssertStage(session, CreationStage.Output, CreationStageState.Completed);
        Assert.Equal("complete", session.Pipeline.AcceptedCommandAction);
    }

    [Fact]
    public void ResumePreservesCompletedOutputAndInvalidatesConsumedReviewHandoff()
    {
        var session = ReadyForReview(maximumIterations: 3);
        session.PendingHandoff = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        var oldHandoffId = session.PendingHandoff.HandoffId;
        var oldBoundaryId = session.PendingHandoff.BoundaryId;
        CreationPipelineStateMachine.ReviewCopied(session);
        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "complete");
        CreationPipelineStateMachine.Complete(session, "approved");

        var iteration = Assert.Single(session.Iterations);
        var output = Assert.Single(iteration.Outputs);
        Assert.Equal(SessionStatus.Completed, session.Status);

        CreationPipelineStateMachine.Resume(session);

        Assert.Equal(SessionStatus.Active, session.Status);
        Assert.Null(session.PendingHandoff);
        Assert.Same(iteration, Assert.Single(session.Iterations));
        Assert.Same(output, Assert.Single(iteration.Outputs));
        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Output).State);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
        Assert.Null(session.CompletionReason);
        Assert.Null(session.Pipeline.AcceptedCommandAction);

        // A fresh review boundary is allowed to use the same Session ID, but
        // must not accidentally reuse the consumed complete response identity.
        var fresh = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        Assert.Equal(session.Id, fresh.SessionId);
        Assert.NotEqual(oldHandoffId, fresh.HandoffId);
        Assert.NotEqual(oldBoundaryId, fresh.BoundaryId);
        var oldResponse = $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{oldHandoffId}\",\"session_id\":\"{session.Id}\",\"reason\":\"approved\"}}\n```";
        Assert.False(ConnectorProtocol.Parse(oldResponse, fresh).IsValid);
    }

    [Fact]
    public void ReviewGenerateUsesImmutablePendingPurposeAndKeepsIterationHistory()
    {
        var session = ReadyForReview(maximumIterations: 3);
        session.PendingHandoff = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        CreationPipelineStateMachine.ReviewCopied(session);
        var previous = session.Iterations.Single();

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");

        AssertStage(session, CreationStage.Command, CreationStageState.Completed);
        AssertStage(session, CreationStage.Apply, CreationStageState.Current);
        Assert.Same(previous, session.Iterations.Single());
        Assert.Equal(JobStatus.Completed, previous.Status);
        Assert.Equal(CreationStageState.NotReached, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
    }

    [Fact]
    public void ExplicitContextRebindStalesThePreviousPendingHandoff()
    {
        var session = SentIdeaSession();
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        session.LocalChatContextId = "chat-2";
        session.ChatLabel = "Chat 2";

        CreationPipelineStateMachine.BindContext(session);

        Assert.Null(session.PendingHandoff);
        Assert.Null(session.Pipeline.SentIdeaSnapshot);
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.NotReached);
    }

    [Fact]
    public void ContextCanBindWhenOnlyMcpIsReady()
    {
        var session = ConfiguredSession(2);
        CreationPipelineStateMachine.PrepareContext(session);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BindContext(session));

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindContext(session);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        AssertStage(session, CreationStage.Context, CreationStageState.Completed);
        AssertStage(session, CreationStage.Idea, CreationStageState.Current);

        CreationPipelineStateMachine.IdeaChanged(session, "idea while ComfyUI is stopped");
        CreationPipelineStateMachine.BootstrapCopied(session, "idea while ComfyUI is stopped");
        AssertStage(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser);
        Assert.Equal(CreationWaitingReason.ChatGptPasteRequired, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).WaitingReason);
    }

    [Fact]
    public void BootstrapCanBeCopiedWithoutAKickoffInstruction()
    {
        var session = BoundSession(3);

        CreationPipelineStateMachine.BootstrapCopied(session, string.Empty);

        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Idea).State);
        Assert.Equal(CreationStageState.WaitingUser, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).State);
        Assert.Equal(string.Empty, session.Pipeline.SentIdeaSnapshot);
        Assert.Equal(CreationWaitingReason.ChatGptPasteRequired, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).WaitingReason);
    }

    [Fact]
    public void BootstrapCanBeSentThroughTheBrowserExtensionWithoutChangingThePipelineBoundary()
    {
        var session = BoundSession(3);
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        CreationPipelineStateMachine.BootstrapSent(session, session.OriginalIdea);

        Assert.Same(pending, session.PendingHandoff);
        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Idea).State);
        Assert.Equal("制作ContextをExtensionへ送信済み", CreationPipelineStateMachine.Get(session, CreationStage.Idea).Detail);
        Assert.Equal(CreationStageState.WaitingUser, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).State);
        Assert.Equal("Handoff送信済み · ChatGPTからの返答待ち", CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).Detail);
        Assert.Equal(CreationWaitingReason.ChatGptResponseRequired, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).WaitingReason);
    }

    [Fact]
    public void BootstrapSendFailureKeepsTheSamePendingHandoffAndMakesToChatGptRetryable()
    {
        var session = BoundSession(3);
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;

        CreationPipelineStateMachine.BootstrapSendFailed(session, "自動送信に失敗しました (composer_not_found)");

        Assert.Same(pending, session.PendingHandoff);
        Assert.Equal(CreationStageState.Current, CreationPipelineStateMachine.Get(session, CreationStage.Idea).State);
        var handoff = CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt);
        Assert.Equal(CreationStageState.Error, handoff.State);
        Assert.Contains("composer_not_found", handoff.Detail, StringComparison.Ordinal);
        Assert.Equal("TO CHATGPT → 送信エラー · 再送できます", CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));
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

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Disconnected);

        AssertStage(session, CreationStage.Connect, CreationStageState.WaitingUser);
        Assert.Same(workflow, session.BoundWorkflow);
        Assert.Equal(idea, session.OriginalIdea);
        Assert.Same(iteration, session.Iterations.Single());
        Assert.Equal(reviewState, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.BeginGenerate(session));

        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        AssertStage(session, CreationStage.Connect, CreationStageState.Completed);
        Assert.Equal(reviewState, CreationPipelineStateMachine.Get(session, CreationStage.Review).State);
        Assert.Same(iteration, session.Iterations.Single());
    }

    private CreationSession BoundSession(int maximumIterations)
    {
        var session = ConfiguredSession(maximumIterations);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
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
        CreationPipelineStateMachine.BootstrapSent(session, session.OriginalIdea);
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
