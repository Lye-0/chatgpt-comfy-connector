using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Desktop-side boundary checks for an assistant response received from the
/// Browser Extension.  This class does not know how the response was found
/// in the browser; it only binds the authenticated transport envelope to the
/// current immutable PendingHandoff and delegates command syntax to the
/// existing strict ConnectorProtocol parser.
/// </summary>
public static class BrowserExtensionResponseCorrelation
{
    public static BrowserExtensionResponseValidationResult Validate(
        BrowserExtensionAssistantResponse response,
        CreationSession? session)
    {
        if (session?.PendingHandoff is not { } pending)
        {
            return Invalid(
                BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated,
                "pending_handoff_missing",
                "現在待機中のHandoffがありません。");
        }

        if (!MatchesPending(response, session, out var identityError))
        {
            return Invalid(
                BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated,
                identityError ?? "response_identity_mismatch",
                "assistant応答が現在のPending Handoffに一致しません。");
        }

        if (!response.IsReceived || string.IsNullOrWhiteSpace(response.Payload))
        {
            return Invalid(
                response.ErrorCode ?? BrowserExtensionAssistantResponseErrorCodes.ResponseExtractionFailed,
                response.Stage ?? "response_transport_error",
                response.Message ?? "assistant応答を取得できませんでした。");
        }

        var parsed = ConnectorProtocol.Parse(response.Payload, pending);
        if (!parsed.IsValid)
        {
            return new BrowserExtensionResponseValidationResult(
                false,
                parsed,
                BrowserExtensionAssistantResponseErrorCodes.ConnectorResponseInvalid,
                "response_validation",
                "ChatGPTの返答はConnector Responseのstrict validationを通過しませんでした。");
        }

        return new BrowserExtensionResponseValidationResult(true, parsed, null, null, "Connector Responseを受信・検証しました。");
    }

    /// <summary>
    /// Matches all durable identity fields and, when available, the request id
    /// of the latest send attempt.  A missing legacy request id is accepted so
    /// sessions written before Phase 3 remain readable; newly sent Handoffs
    /// always persist it before crossing the Bridge.
    /// </summary>
    public static bool MatchesPending(
        BrowserExtensionAssistantResponse response,
        CreationSession session,
        out string? errorStage)
    {
        if (!MatchesPendingIdentity(response, session, out errorStage)) return false;

        // Assistant observation is opened only after the Extension has
        // reported the Phase 2 user message as sent.  Require the durable
        // outgoing message to be SENT as well, so a late/forged response can
        // never advance a copied or failed Handoff boundary.
        var pending = session.PendingHandoff;
        var sentHandoff = pending is not null && session.HandoffMessages.Any(item =>
            item.Direction == HandoffDirection.ConnectorToChatGpt
            && item.Kind == HandoffMessageKind.CreationRequest
            && item.State == HandoffTransportState.Sent
            && PendingHandoffReuse.MatchesPayload(pending, item.Payload));
        if (!sentHandoff)
        {
            errorStage = "handoff_not_sent";
            return false;
        }

        return true;
    }

    /// <summary>
    /// Matches only the durable transport identity.  The Desktop uses this
    /// narrower check to briefly queue a response that races the persistence
    /// of the outgoing SENT state; the full <see cref="MatchesPending"/>
    /// check remains the gate for command validation and UI mutation.
    /// </summary>
    public static bool MatchesPendingIdentity(
        BrowserExtensionAssistantResponse response,
        CreationSession session,
        out string? errorStage)
    {
        errorStage = null;
        var pending = session.PendingHandoff;
        if (pending is null)
        {
            errorStage = "pending_handoff_missing";
            return false;
        }

        if (!string.Equals(response.SessionId, session.Id, StringComparison.Ordinal)
            || !string.Equals(response.SessionId, pending.SessionId, StringComparison.Ordinal))
        {
            errorStage = "session_id_mismatch";
            return false;
        }
        if (!string.Equals(response.HandoffId, pending.HandoffId, StringComparison.Ordinal))
        {
            errorStage = "handoff_id_mismatch";
            return false;
        }
        if (!string.Equals(response.BoundaryId, pending.BoundaryId, StringComparison.Ordinal))
        {
            errorStage = "boundary_id_mismatch";
            return false;
        }
        if (pending.LastBrowserExtensionRequestId is { Length: > 0 }
            && !string.Equals(response.RequestId, pending.LastBrowserExtensionRequestId, StringComparison.Ordinal))
        {
            errorStage = "request_id_mismatch";
            return false;
        }
        return true;
    }

    private static BrowserExtensionResponseValidationResult Invalid(string code, string stage, string message)
        => new(false, null, code, stage, message);
}

public sealed record BrowserExtensionResponseValidationResult(
    bool IsValid,
    ProtocolValidationResult? ProtocolResult,
    string? ErrorCode,
    string? Stage,
    string Message);
