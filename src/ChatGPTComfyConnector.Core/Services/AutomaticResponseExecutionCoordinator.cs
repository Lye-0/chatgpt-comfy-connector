using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Owns the durable idempotency boundary for automatic assistant-response
/// processing. Transport correlation and strict ConnectorProtocol validation
/// remain separate concerns; this class only records that one already
/// validated response is being processed.
/// </summary>
public static class AutomaticResponseExecutionCoordinator
{
    private const char KeySeparator = '\u001f';

    public static string BuildResponseKey(BrowserExtensionAssistantResponse response)
        => string.Join(
            KeySeparator,
            response.RequestId,
            response.SessionId,
            response.HandoffId,
            response.BoundaryId);

    /// <summary>
    /// Starts processing a response once. A duplicate delivery of the same
    /// transport identity is rejected in every state, including Failed, so a
    /// Browser Extension reconnect cannot repeat APPLY or GENERATE. A later
    /// explicit send has a new request id and may be processed as a new
    /// attempt after the normal Desktop correlation gate accepts it.
    /// </summary>
    public static bool TryBegin(
        CreationSession session,
        BrowserExtensionAssistantResponse response,
        out string responseKey)
    {
        CreationPipelineStateMachine.EnsureInitialized(session);
        responseKey = BuildResponseKey(response);
        var existing = session.Pipeline.AutomaticResponseExecution;
        if (existing is not null
            && existing.State != AutomaticResponseExecutionState.None
            && string.Equals(existing.ResponseKey, responseKey, StringComparison.Ordinal))
        {
            return false;
        }

        session.Pipeline.AutomaticResponseExecution = new AutomaticResponseExecutionSnapshot
        {
            ResponseKey = responseKey,
            RequestId = response.RequestId,
            SessionId = response.SessionId,
            HandoffId = response.HandoffId,
            BoundaryId = response.BoundaryId,
            State = AutomaticResponseExecutionState.Validating,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        session.UpdatedAt = DateTimeOffset.UtcNow;
        return true;
    }

    public static void MarkApplying(CreationSession session, string responseKey, string action)
        => Update(session, responseKey, AutomaticResponseExecutionState.Applying, action, null, null, null);

    public static void MarkGenerating(CreationSession session, string responseKey, string action)
        => Update(session, responseKey, AutomaticResponseExecutionState.Generating, action, null, null, null);

    public static void MarkCompleted(CreationSession session, string responseKey, string action)
        => Update(session, responseKey, AutomaticResponseExecutionState.Completed, action, null, null, null);

    public static void MarkFailed(
        CreationSession session,
        string responseKey,
        string action,
        string errorCode,
        string stage,
        string message)
        => Update(session, responseKey, AutomaticResponseExecutionState.Failed, action, errorCode, stage, message);

    private static void Update(
        CreationSession session,
        string responseKey,
        AutomaticResponseExecutionState state,
        string action,
        string? errorCode,
        string? errorStage,
        string? errorMessage)
    {
        CreationPipelineStateMachine.EnsureInitialized(session);
        var execution = session.Pipeline.AutomaticResponseExecution;
        if (execution is null || !string.Equals(execution.ResponseKey, responseKey, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("自動Response処理の相関状態が見つかりません。");
        }

        execution.Action = action;
        execution.State = state;
        execution.ErrorCode = errorCode;
        execution.ErrorStage = errorStage;
        execution.ErrorMessage = errorMessage;
        execution.UpdatedAt = DateTimeOffset.UtcNow;
        session.UpdatedAt = execution.UpdatedAt;
    }
}
