using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class BrowserExtensionResponseCorrelationTests
{
    [Fact]
    public void ValidResponseMatchesTheSentPendingHandoffAndUsesTheStrictParser()
    {
        var session = CreateSession("session-response");
        var pending = PendingHandoffFactory.CreateReview(session, [], "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-response";
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });

        var payload = $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"approved\"}}\n```";
        var response = new BrowserExtensionAssistantResponse(
            "request-response",
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            payload,
            Stage: "assistant_response_complete");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.True(result.IsValid);
        Assert.Equal("complete", result.ProtocolResult?.Command?.Action);
        Assert.Equal(pending.HandoffId, result.ProtocolResult?.Command?.HandoffId);
    }

    [Fact]
    public void ReviewResponseMatchesTheSentComfyToChatGptReviewRequest()
    {
        var session = CreateSession("session-review-direction");
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-review-direction";
        session.HandoffMessages.Add(new HandoffMessage
        {
            // ReviewRequest is recorded as ComfyToChatGpt because the review
            // boundary includes the generated ComfyUI output context.
            Direction = HandoffDirection.ComfyToChatGpt,
            Kind = HandoffMessageKind.ReviewRequest,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });

        var payload = $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"approved\"}}\n```";
        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            payload,
            Stage: "assistant_response_complete");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.True(result.IsValid);
        Assert.Equal("complete", result.ProtocolResult?.Command?.Action);
    }

    [Fact]
    public void ResponseFromCopiedOrFailedHandoffCannotAdvanceTheBoundary()
    {
        var session = CreateSession("session-not-sent");
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-not-sent";
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Copied,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });

        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            "not parsed");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal(BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated, result.ErrorCode);
        Assert.Equal("handoff_not_sent", result.Stage);
    }

    [Fact]
    public void SendResponseIdentityCanBeHeldUntilOutgoingSentStateIsPersisted()
    {
        var session = CreateSession("session-race");
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-race";
        session.HandoffMessages.Add(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Waiting,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        });

        var response = new BrowserExtensionAssistantResponse(
            "request-race",
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "error",
            ErrorCode: BrowserExtensionAssistantResponseErrorCodes.ResponseTimeout,
            Stage: "assistant_response_stability_timeout");

        Assert.True(BrowserExtensionResponseCorrelation.MatchesPendingIdentity(response, session, out var identityError));
        Assert.Null(identityError);
        Assert.False(BrowserExtensionResponseCorrelation.MatchesPending(response, session, out var sendError));
        Assert.Equal("handoff_not_sent", sendError);
    }

    [Fact]
    public void InvalidConnectorResponseIsRejectedAfterTransportCorrelation()
    {
        var session = CreateSession("session-invalid");
        var pending = PendingHandoffFactory.CreateReview(session, [], "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-invalid";
        session.HandoffMessages.Add(SentMessage(pending));

        var response = new BrowserExtensionAssistantResponse(
            "request-invalid",
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"wrong\",\"session_id\":\"{session.Id}\",\"reason\":\"not this handoff\"}}\n```");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal(BrowserExtensionAssistantResponseErrorCodes.ConnectorResponseInvalid, result.ErrorCode);
        Assert.Equal("response_validation", result.Stage);
        Assert.NotEmpty(result.ProtocolResult!.Errors);
    }

    [Fact]
    public void TransportErrorKeepsPendingIdentityAndReturnsTheExtensionError()
    {
        var session = CreateSession("session-error");
        var pending = PendingHandoffFactory.Create(session, [], "generate");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "request-error";
        session.HandoffMessages.Add(SentMessage(pending));

        var response = new BrowserExtensionAssistantResponse(
            "request-error",
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "error",
            ErrorCode: BrowserExtensionAssistantResponseErrorCodes.ResponseTimeout,
            Stage: "assistant_response_stability_timeout");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal(BrowserExtensionAssistantResponseErrorCodes.ResponseTimeout, result.ErrorCode);
        Assert.Equal("assistant_response_stability_timeout", result.Stage);
        Assert.Same(pending, session.PendingHandoff);
    }

    [Fact]
    public void LateReviewResponseIsRejectedAfterAutomaticIterationFailure()
    {
        var session = CreateSession("session-review-failed");
        session.BrowserExtensionTargetTabId = 42;
        session.BrowserExtensionTargetTabUrl = "https://chatgpt.com/c/fixture";
        var pending = PendingHandoffFactory.CreateReview(session, [], "generate", "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "review-request-failed";
        session.HandoffMessages.Add(SentMessage(pending, HandoffMessageKind.ReviewRequest));

        CreationPipelineStateMachine.AutomaticIterationStarted(session);
        CreationPipelineStateMachine.ReviewHandoffPreparing(session, pending, pending.Iteration, 42, session.BrowserExtensionTargetTabUrl);
        CreationPipelineStateMachine.ReviewHandoffSending(session, pending.LastBrowserExtensionRequestId);
        CreationPipelineStateMachine.ReviewHandoffSent(
            session,
            new BrowserExtensionHandoffSendResult(
                pending.LastBrowserExtensionRequestId,
                pending.HandoffId,
                "sent",
                TargetTabId: 42,
                TargetTabUrl: session.BrowserExtensionTargetTabUrl));
        CreationPipelineStateMachine.AutomaticIterationFailed(session, "response_timeout", "assistant_response", "timed out");

        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            "late response",
            TargetTabId: 42,
            TargetTabUrl: session.BrowserExtensionTargetTabUrl);

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal(BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated, result.ErrorCode);
        Assert.Equal("automatic_iteration_closed", result.Stage);
        Assert.Same(pending, session.PendingHandoff);
    }

    [Fact]
    public void ReviewResponseFromTheSameConversationSurvivesManagedTabReplacement()
    {
        var session = CreateSession("session-review-target");
        session.ConversationId = "fixture";
        session.ConversationUrl = "https://chatgpt.com/c/fixture";
        session.BrowserExtensionTargetTabId = 42;
        session.BrowserExtensionTargetTabUrl = "https://chatgpt.com/c/fixture";
        var pending = PendingHandoffFactory.CreateReview(session, [], "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "review-request-target";
        session.HandoffMessages.Add(SentMessage(pending, HandoffMessageKind.ReviewRequest));

        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"approved\"}}\n```",
            TargetTabId: 99,
            TargetTabUrl: "https://chatgpt.com/c/fixture",
            TargetConversationId: "fixture",
            TargetConversationUrl: "https://chatgpt.com/c/fixture");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.True(result.IsValid);
        Assert.Equal("complete", result.ProtocolResult?.Command?.Action);
    }

    [Fact]
    public void ReviewResponseFromAnotherConversationIsRejectedByConversationIdentity()
    {
        var session = CreateSession("session-review-target-mismatch");
        session.ConversationId = "fixture";
        session.ConversationUrl = "https://chatgpt.com/c/fixture";
        var pending = PendingHandoffFactory.CreateReview(session, [], "complete");
        session.PendingHandoff = pending;
        pending.LastBrowserExtensionRequestId = "review-request-target-mismatch";
        session.HandoffMessages.Add(SentMessage(pending, HandoffMessageKind.ReviewRequest));

        var response = new BrowserExtensionAssistantResponse(
            pending.LastBrowserExtensionRequestId,
            session.Id,
            pending.HandoffId,
            pending.BoundaryId,
            "received",
            $"```connector-command\n{{\"protocol\":\"{ConnectorProtocol.Version}\",\"action\":\"complete\",\"handoff_id\":\"{pending.HandoffId}\",\"session_id\":\"{pending.SessionId}\",\"reason\":\"approved\"}}\n```",
            TargetConversationId: "another",
            TargetConversationUrl: "https://chatgpt.com/c/another");

        var result = BrowserExtensionResponseCorrelation.Validate(response, session);

        Assert.False(result.IsValid);
        Assert.Equal(BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated, result.ErrorCode);
        Assert.Equal("target_conversation_mismatch", result.Stage);
        Assert.Same(pending, session.PendingHandoff);
    }

    [Fact]
    public void PipelineMarksCommandAsWaitingForUserWithoutApplyingOrGenerating()
    {
        var session = CreateSession("session-pipeline");
        CreationPipelineStateMachine.EnsureInitialized(session);

        CreationPipelineStateMachine.ConnectorResponseReceived(session);

        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.ToChatGpt).State);
        Assert.Equal(CreationStageState.WaitingUser, CreationPipelineStateMachine.Get(session, CreationStage.Command).State);
        Assert.Equal(CreationWaitingReason.UserActionRequired, CreationPipelineStateMachine.Get(session, CreationStage.Command).WaitingReason);
        Assert.Equal(CreationStageState.NotReached, CreationPipelineStateMachine.Get(session, CreationStage.Apply).State);
        Assert.Equal(CreationStageState.NotReached, CreationPipelineStateMachine.Get(session, CreationStage.Generate).State);
    }

    private static CreationSession CreateSession(string id)
        => new()
        {
            Id = id,
            OriginalIdea = "idea",
            ProjectLabel = "Project",
            ChatLabel = "Chat",
            BoundWorkflow = WorkflowIdentity.Create("folder/workflow.json"),
            MaximumIterations = 10,
        };

    private static HandoffMessage SentMessage(
        PendingHandoffSnapshot pending,
        HandoffMessageKind kind = HandoffMessageKind.CreationRequest)
        => new()
        {
            Direction = kind == HandoffMessageKind.ReviewRequest
                ? HandoffDirection.ComfyToChatGpt
                : HandoffDirection.ConnectorToChatGpt,
            Kind = kind,
            State = HandoffTransportState.Sent,
            Payload = $"handoff_id: {pending.HandoffId}\nsession_id: {pending.SessionId}\nboundary_id: {pending.BoundaryId}",
        };
}
