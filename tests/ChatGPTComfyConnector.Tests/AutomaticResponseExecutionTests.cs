using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class AutomaticResponseExecutionTests
{
    [Fact]
    public void TheSameAssistantResponseIsProcessedOnlyOnceAcrossTerminalStates()
    {
        var session = new CreationSession { Id = "session-automatic" };
        var response = Response("request-1", session.Id, "handoff-1", "boundary-1");

        Assert.True(AutomaticResponseExecutionCoordinator.TryBegin(session, response, out var key));
        AutomaticResponseExecutionCoordinator.MarkApplying(session, key, "generate");
        AutomaticResponseExecutionCoordinator.MarkGenerating(session, key, "generate");
        AutomaticResponseExecutionCoordinator.MarkCompleted(session, key, "generate");

        Assert.False(AutomaticResponseExecutionCoordinator.TryBegin(session, response, out var duplicateKey));
        Assert.Equal(key, duplicateKey);
        Assert.Equal(AutomaticResponseExecutionState.Completed, session.Pipeline.AutomaticResponseExecution?.State);
        Assert.Equal("generate", session.Pipeline.AutomaticResponseExecution?.Action);
    }

    [Fact]
    public void AFailedResponseIsNotRetriedByAReplayButASeparateExplicitRequestCanRun()
    {
        var session = new CreationSession { Id = "session-automatic-failed" };
        var response = Response("request-1", session.Id, "handoff-1", "boundary-1");

        Assert.True(AutomaticResponseExecutionCoordinator.TryBegin(session, response, out var key));
        AutomaticResponseExecutionCoordinator.MarkFailed(
            session,
            key,
            "generate",
            "apply_failed",
            "apply",
            "validation failed");

        Assert.False(AutomaticResponseExecutionCoordinator.TryBegin(session, response, out _));

        var explicitRetry = Response("request-2", session.Id, "handoff-1", "boundary-1");
        Assert.True(AutomaticResponseExecutionCoordinator.TryBegin(session, explicitRetry, out var retryKey));
        Assert.NotEqual(key, retryKey);
        Assert.Equal(AutomaticResponseExecutionState.Validating, session.Pipeline.AutomaticResponseExecution?.State);
    }

    [Fact]
    public void ExecutionSnapshotContainsOnlyResponseIdentityAndSafeDiagnostics()
    {
        var session = new CreationSession { Id = "session-automatic-safe" };
        var response = Response("request-safe", session.Id, "handoff-safe", "boundary-safe");

        Assert.True(AutomaticResponseExecutionCoordinator.TryBegin(session, response, out var key));
        AutomaticResponseExecutionCoordinator.MarkFailed(
            session,
            key,
            "generate",
            "generation_failed",
            "generate",
            "ComfyUI job failed");

        var execution = Assert.IsType<AutomaticResponseExecutionSnapshot>(session.Pipeline.AutomaticResponseExecution);
        Assert.Equal(response.RequestId, execution.RequestId);
        Assert.Equal(response.SessionId, execution.SessionId);
        Assert.Equal(response.HandoffId, execution.HandoffId);
        Assert.Equal(response.BoundaryId, execution.BoundaryId);
        Assert.Null(execution.GetType().GetProperty("Payload"));
        Assert.Equal("generation_failed", execution.ErrorCode);
    }

    private static BrowserExtensionAssistantResponse Response(
        string requestId,
        string sessionId,
        string handoffId,
        string boundaryId)
        => new(
            requestId,
            sessionId,
            handoffId,
            boundaryId,
            "received",
            "connector response body is intentionally not retained here");
}
