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
        if (PendingHandoffReuse.IsReview(pending)
            && session.Pipeline.ReviewHandoff is { State: ReviewHandoffState.Failed or ReviewHandoffState.Stopped or ReviewHandoffState.Completed })
        {
            errorStage = "review_boundary_closed";
            return false;
        }
        if (PendingHandoffReuse.IsReview(pending)
            && session.Pipeline.AutomaticIteration is { State: AutomaticIterationState.LimitReached or AutomaticIterationState.Failed or AutomaticIterationState.Stopped or AutomaticIterationState.Completed })
        {
            // A timeout, validation failure, explicit CANCEL, or completed
            // session closes the automatic continuation boundary even when a
            // late assistant response still carries the old Review identity.
            // Manual recovery must explicitly create/retry a new boundary.
            errorStage = "automatic_iteration_closed";
            return false;
        }
        // The two outgoing boundaries intentionally use different timeline
        // directions: the initial CreationRequest is Connector -> ChatGPT,
        // while a ReviewRequest is Comfy -> ChatGPT because it carries the
        // generated media/review context.  Keep the direction check explicit
        // so a message from the opposite side cannot authorize a response.
        var sentHandoff = pending is not null && session.HandoffMessages.Any(item =>
            IsSentResponseAnchor(item)
            && PendingHandoffReuse.MatchesPayload(pending, item.Payload));
        if (!sentHandoff)
        {
            errorStage = "handoff_not_sent";
            return false;
        }

        // A Managed Tab is only an execution medium.  It may be recreated or
        // replaced while the same ChatGPT conversation remains bound to the
        // session, so a changed target_tab_id/url must not reject a valid
        // Review response.  Conversation identity is the durable boundary.
        if (PendingHandoffReuse.IsReview(pending)
            && !MatchesBoundConversation(response, session, out errorStage))
        {
            return false;
        }

        return true;
    }

    private static bool IsSentResponseAnchor(HandoffMessage item)
        => item.State == HandoffTransportState.Sent
            && (item.Kind switch
            {
                HandoffMessageKind.CreationRequest => item.Direction == HandoffDirection.ConnectorToChatGpt,
                HandoffMessageKind.ReviewRequest => item.Direction == HandoffDirection.ComfyToChatGpt,
                _ => false,
            });

    private static bool MatchesBoundConversation(
        BrowserExtensionAssistantResponse response,
        CreationSession session,
        out string? errorStage)
    {
        errorStage = null;
        if (response.TargetConversationId is null && response.TargetConversationUrl is null)
        {
            // Envelopes from before conversation identity was added remain
            // readable.  Durable transport IDs still provide the primary
            // correlation gate above.
            return true;
        }

        var boundConversationId = session.ConversationId;
        var boundConversationUrl = session.ConversationUrl;
        var responseConversationId = response.TargetConversationId
            ?? ConversationIdFromUrl(response.TargetConversationUrl);

        if (!string.IsNullOrWhiteSpace(boundConversationId)
            && !string.Equals(responseConversationId, boundConversationId, StringComparison.Ordinal))
        {
            errorStage = "target_conversation_mismatch";
            return false;
        }

        if (response.TargetConversationUrl is not null
            && !string.IsNullOrWhiteSpace(boundConversationUrl)
            && !SameConversationUrl(response.TargetConversationUrl, boundConversationUrl))
        {
            errorStage = "target_conversation_mismatch";
            return false;
        }

        // If a response supplies a URL for a bound session but it cannot be
        // reduced to the same conversation ID, reject it instead of silently
        // accepting a project/root page as a response source.
        if (!string.IsNullOrWhiteSpace(boundConversationId)
            && response.TargetConversationUrl is not null
            && responseConversationId is null)
        {
            errorStage = "target_conversation_mismatch";
            return false;
        }

        return true;
    }

    private static string? ConversationIdFromUrl(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase)
            || uri.Port != -1)
        {
            return null;
        }

        var segments = uri.AbsolutePath
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        for (var index = 0; index < segments.Length - 1; index++)
        {
            if (!string.Equals(segments[index], "c", StringComparison.OrdinalIgnoreCase)) continue;
            var id = Uri.UnescapeDataString(segments[index + 1]);
            return IsSafeConversationId(id) ? id : null;
        }

        return null;
    }

    private static bool IsSafeConversationId(string value)
        => value.Length is > 0 and <= 128
            && value.All(character => (character is >= 'A' and <= 'Z')
                || (character is >= 'a' and <= 'z')
                || (character is >= '0' and <= '9')
                || character is '.' or '_' or '-');

    private static bool SameConversationUrl(string left, string right)
    {
        var leftId = ConversationIdFromUrl(left);
        var rightId = ConversationIdFromUrl(right);
        if (leftId is not null || rightId is not null)
        {
            return leftId is not null
                && rightId is not null
                && string.Equals(leftId, rightId, StringComparison.Ordinal);
        }

        return string.Equals(
            left.TrimEnd('/'),
            right.TrimEnd('/'),
            StringComparison.OrdinalIgnoreCase);
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
