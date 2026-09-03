using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace ChatGPTComfyConnector.Core.Models;

/// <summary>
/// State of the Browser Extension connection. This is intentionally separate
/// from the MCP/ComfyUI connection state used by the creation pipeline.
/// </summary>
public enum BrowserExtensionConnectionState
{
    Disconnected,
    Connecting,
    Connected,
    Error,
}

public enum BrowserExtensionPairingState
{
    Required,
    Paired,
}

public static class BrowserExtensionBridgeProtocol
{
    public const string BridgeVersion = "0.2-alpha";
    public const string ProtocolVersion = "chatgpt-comfy-connector.bridge/1";
    public const string BindAddress = "127.0.0.1";
    public const int DefaultPort = 43127;
    public const string HealthPath = "/health";
    public const string WebSocketPath = "/bridge";
    public const string PingPath = "/api/v1/ping";
    public const string PairPath = "/api/v1/pair";
    public const string BootstrapPath = "/api/v1/bootstrap";
    public const string MediaPathPrefix = "/api/v1/media/";
    public const string ClientHeaderName = "X-Connector-Client";
    public const string ClientHeaderValue = "browser-extension";
    public const string ExtensionClientName = "browser-extension";

    public static string ToStateText(BrowserExtensionConnectionState state)
        => state.ToString().ToUpperInvariant();
}

/// <summary>
/// Metadata-only ChatGPT context entries discovered by the Content Script.
/// Message bodies, attachments, credentials, and tokens are deliberately not
/// represented by these records.
/// </summary>
public sealed record BrowserExtensionChatGptProjectEntry(
    string? ProjectId,
    string Title,
    string? Url = null,
    string? DiscoveryKey = null);

public sealed record BrowserExtensionChatGptConversationEntry(
    string ConversationId,
    string Title,
    string Url,
    string? ProjectId = null,
    string? ProjectTitle = null);

public sealed record BrowserExtensionChatGptCurrentContext(
    string? ConversationId = null,
    string? Title = null,
    string? Url = null,
    string? ProjectId = null,
    string? ProjectTitle = null);

public sealed record BrowserExtensionChatGptContextSnapshot(
    string RequestId,
    string Status,
    IReadOnlyList<BrowserExtensionChatGptProjectEntry> Projects,
    IReadOnlyList<BrowserExtensionChatGptConversationEntry> Conversations,
    BrowserExtensionChatGptCurrentContext? Current = null,
    string? ErrorCode = null,
    string? Message = null,
    string? Stage = null)
{
    public bool IsSuccess => string.Equals(Status, "ok", StringComparison.Ordinal);
}

/// <summary>
/// Persisted metadata-only discovery cache. Request/transport state and the
/// current page are intentionally excluded so the cache never becomes a
/// transcript or a credential-bearing recovery record.
/// </summary>
public sealed record BrowserExtensionChatGptContextCache(
    IReadOnlyList<BrowserExtensionChatGptProjectEntry> Projects,
    IReadOnlyList<BrowserExtensionChatGptConversationEntry> Conversations,
    DateTimeOffset UpdatedAt);

public sealed class BrowserExtensionChatGptContextChangedEventArgs(
    BrowserExtensionChatGptCurrentContext context) : EventArgs
{
    public BrowserExtensionChatGptCurrentContext Context { get; } = context;
}

/// <summary>
/// Error codes returned by the Extension when the active ChatGPT tab cannot
/// accept a Handoff. Keeping these values in the shared protocol model makes
/// the Desktop result handling independent from the Extension implementation.
/// </summary>
public static class BrowserExtensionHandoffErrorCodes
{
    public const string ActiveTabNotChatGpt = "active_tab_not_chatgpt";
    public const string ContentScriptUnavailable = "content_script_unavailable";
    public const string ComposerNotFound = "composer_not_found";
    public const string ComposerInputFailed = "composer_input_failed";
    public const string ComposerInputVerificationFailed = "composer_input_verification_failed";
    public const string SendButtonNotFound = "send_button_not_found";
    public const string SendNotReady = "send_not_ready";
    public const string SendFailed = "send_failed";
    public const string BridgeDisconnected = "bridge_disconnected";
    public const string ReviewMediaNotAttached = "review_media_not_attached";
    public const string ReviewHandoffBuildFailed = "review_handoff_build_failed";
    public const string ReviewComposerNotClean = "review_composer_not_clean";
    public const string ReviewComposerInputFailed = "review_composer_input_failed";
    public const string ReviewSendButtonNotFound = "review_send_button_not_found";
    public const string ReviewSendNotReady = "review_send_not_ready";
    public const string ReviewSendFailed = "review_send_failed";
    public const string ReviewMessageNotObserved = "review_message_not_observed";
    public const string ReviewMessageNotCorrelated = "review_message_not_correlated";
    public const string ReviewTargetTabNotFound = "review_target_tab_not_found";
    public const string ReviewResponseTimeout = "review_response_timeout";
    public const string ReviewResponseNotCorrelated = "review_response_not_correlated";
    public const string MaximumIterationsReached = "maximum_iterations_reached";
    public const string AutomaticIterationCancelled = "automatic_iteration_cancelled";
}

/// <summary>
/// Errors reported while the Extension waits for the assistant response to a
/// Handoff that was already confirmed as sent.  The Extension only reports
/// DOM/transport facts; Connector Response parsing remains a Desktop concern.
/// </summary>
public static class BrowserExtensionAssistantResponseErrorCodes
{
    public const string AssistantResponseNotFound = "assistant_response_not_found";
    public const string ResponseTimeout = "response_timeout";
    public const string ResponseStreamInterrupted = "response_stream_interrupted";
    public const string ResponseExtractionFailed = "response_extraction_failed";
    public const string ResponseAnchorNotFound = "response_anchor_not_found";
    public const string ContentScriptUnavailable = "content_script_unavailable";
    public const string BridgeDisconnected = "bridge_disconnected";
    public const string ResponseNotCorrelated = "response_not_correlated";
    public const string ConnectorResponseInvalid = "connector_response_invalid";
}

/// <summary>
/// Errors reported while the Extension attaches a completed ComfyUI output
/// to the ChatGPT tab that owns the current creation boundary.
/// </summary>
public static class BrowserExtensionReviewMediaErrorCodes
{
    public const string ReviewOutputNotFound = "review_output_not_found";
    public const string MediaRegistrationFailed = "media_registration_failed";
    public const string MediaExpired = "media_expired";
    public const string MediaFetchFailed = "media_fetch_failed";
    public const string MediaTooLarge = "media_too_large";
    public const string UnsupportedMediaType = "unsupported_media_type";
    public const string ReviewTargetTabNotFound = "review_target_tab_not_found";
    public const string ContentScriptUnavailable = "content_script_unavailable";
    public const string AttachmentControlNotFound = "attachment_control_not_found";
    public const string AttachmentInputFailed = "attachment_input_failed";
    public const string AttachmentUploadFailed = "attachment_upload_failed";
    public const string AttachmentTimeout = "attachment_timeout";
    public const string AttachmentVerificationFailed = "attachment_verification_failed";
    public const string BridgeDisconnected = "bridge_disconnected";
}

/// <summary>
/// The MIME allow-list for Phase 5.1.  Extension code receives the resolved
/// MIME value, but never a local path.  Keeping this list shared prevents the
/// Desktop registration and Bridge download endpoint from disagreeing.
/// </summary>
public static class BrowserExtensionMediaTypes
{
    public const string Mp4 = "video/mp4";
    public const string Png = "image/png";
    public const string Jpeg = "image/jpeg";
    public const string Webp = "image/webp";

    private static readonly IReadOnlyDictionary<string, string> ExtensionMap =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".mp4"] = Mp4,
            [".png"] = Png,
            [".jpg"] = Jpeg,
            [".jpeg"] = Jpeg,
            [".webp"] = Webp,
        };

    public static bool IsSupported(string? mimeType)
        => mimeType is not null
            && mimeType.Trim().ToLowerInvariant() is Mp4 or Png or Jpeg or Webp;

    public static bool TryResolve(string? fileName, string? declaredType, out string mimeType)
    {
        var normalizedType = (declaredType ?? string.Empty).Trim().ToLowerInvariant();
        if (IsSupported(normalizedType))
        {
            mimeType = normalizedType;
            return true;
        }

        var extension = Path.GetExtension(fileName ?? string.Empty);
        if (ExtensionMap.TryGetValue(extension, out var mapped))
        {
            mimeType = mapped;
            return true;
        }

        mimeType = string.Empty;
        return false;
    }
}

/// <summary>
/// A complete, already-rendered Handoff sent over the authenticated Bridge.
/// The payload is intentionally supplied by the existing Handoff builder;
/// the Extension must not create a second representation of it.
/// </summary>
public sealed record BrowserExtensionHandoffSendRequest(
    string RequestId,
    string SessionId,
    string HandoffId,
    string BoundaryId,
    string Payload,
    string? HandoffKind = null,
    int? TargetTabId = null,
    string? TargetTabUrl = null,
    string? ReviewMediaId = null,
    string? ReviewFileName = null,
    int? ReviewIteration = null,
    string? TargetConversationId = null,
    string? TargetConversationUrl = null,
    string? TargetProjectId = null,
    bool NewConversation = false,
    string? TargetProjectUrl = null);

/// <summary>
/// Result correlated with <see cref="BrowserExtensionHandoffSendRequest.RequestId"/>.
/// Results never echo the Handoff body.
/// </summary>
public sealed record BrowserExtensionHandoffSendResult(
    string RequestId,
    string HandoffId,
    string Status,
    string? ErrorCode = null,
    string? Message = null,
    string? Stage = null,
    int? TargetTabId = null,
    string? TargetTabUrl = null,
    string? TargetConversationId = null,
    string? TargetConversationUrl = null,
    string? TargetProjectId = null)
{
    public bool IsSent => string.Equals(Status, "sent", StringComparison.Ordinal);
}

/// <summary>
/// Desktop-only media registration.  FullPath and AllowedRoot are explicitly
/// ignored by JSON serialization and are never placed on the Bridge wire.
/// They exist only inside the Desktop/Infrastructure process boundary so the
/// authenticated media endpoint can stream the registered output safely.
/// </summary>
public sealed class BrowserExtensionMediaRegistration
{
    public string MediaId { get; init; } = string.Empty;
    public string SessionId { get; init; } = string.Empty;
    public int Iteration { get; init; }
    public string OutputIdentity { get; init; } = string.Empty;
    public string FileName { get; init; } = string.Empty;
    public string MimeType { get; init; } = string.Empty;
    public long Size { get; init; }
    public DateTimeOffset ExpiresAt { get; init; }

    [JsonIgnore]
    public string FullPath { get; init; } = string.Empty;

    [JsonIgnore]
    public string AllowedRoot { get; init; } = string.Empty;
}

/// <summary>
/// Metadata-only command sent over the authenticated WebSocket.  The file
/// bytes are fetched separately over the authenticated loopback media route.
/// </summary>
public sealed record BrowserExtensionMediaAttachRequest(
    string RequestId,
    string SessionId,
    int Iteration,
    string MediaId,
    string FileName,
    string MimeType,
    long Size,
    int? TargetTabId = null,
    string? TargetTabUrl = null,
    string? TargetConversationId = null,
    string? TargetConversationUrl = null,
    // Kept as an optional compatibility field. Media delivery targets the
    // bound Conversation and never routes by Project metadata.
    string? TargetProjectId = null);

public sealed record BrowserExtensionMediaAttachResult(
    string RequestId,
    string SessionId,
    int Iteration,
    string MediaId,
    string Status,
    string? ErrorCode = null,
    string? Message = null,
    string? Stage = null)
{
    public bool IsAttached => string.Equals(Status, "attached", StringComparison.Ordinal);
}

/// <summary>
/// Assistant response envelope transported from the authenticated Extension
/// socket to Desktop.  Payload is present only for a successful
/// <c>received</c> result; it is never written to transport diagnostics.
/// </summary>
public sealed record BrowserExtensionAssistantResponse(
    string RequestId,
    string SessionId,
    string HandoffId,
    string BoundaryId,
    string Status,
    string? Payload = null,
    string? ErrorCode = null,
    string? Message = null,
    string? Stage = null,
    int? TargetTabId = null,
    string? TargetTabUrl = null,
    string? TargetConversationId = null,
    string? TargetConversationUrl = null)
{
    public bool IsReceived => string.Equals(Status, "received", StringComparison.Ordinal);
}

public sealed class BrowserExtensionAssistantResponseEventArgs(
    BrowserExtensionAssistantResponse response) : EventArgs
{
    public BrowserExtensionAssistantResponse Response { get; } = response;
}

/// <summary>
/// Persisted Desktop-side pairing state.  Only the hash is stored; the
/// bearer credential is returned to the Extension once and remains in the
/// Extension's local storage.
/// </summary>
public sealed record BrowserExtensionPairingRecord(
    string PairingId,
    string CredentialHash,
    DateTimeOffset PairedAt);

public sealed record BrowserExtensionBridgeStatus(
    bool IsRunning,
    BrowserExtensionConnectionState ConnectionState,
    BrowserExtensionPairingState PairingState,
    string BindAddress,
    int Port,
    string? ClientOrigin,
    DateTimeOffset? ConnectedAt,
    string? LastError,
    DateTimeOffset UpdatedAt,
    string? PairingCode = null,
    DateTimeOffset? PairingCodeExpiresAt = null)
{
    public string HttpEndpoint => $"http://{BindAddress}:{Port}";
    public string WebSocketEndpoint => $"ws://{BindAddress}:{Port}{BrowserExtensionBridgeProtocol.WebSocketPath}";
    public string ConnectionStateText => BrowserExtensionBridgeProtocol.ToStateText(ConnectionState);
    public string PairingStateText => PairingState.ToString().ToUpperInvariant();
    public bool IsPairingRequired => PairingState == BrowserExtensionPairingState.Required;
}

public sealed class BrowserExtensionBridgeStatusChangedEventArgs(BrowserExtensionBridgeStatus status) : EventArgs
{
    public BrowserExtensionBridgeStatus Status { get; } = status;
}

/// <summary>
/// Safe, non-secret diagnostics for tracing the Browser Extension transport.
/// Implementations must not put tokens or Handoff payloads in this record.
/// </summary>
public sealed record BrowserExtensionBridgeDiagnostic(
    string EventName,
    string? RequestId = null,
    string? HandoffId = null,
    string? Status = null,
    string? ErrorCode = null,
    string? Stage = null,
    string? MediaId = null,
    int? Iteration = null,
    int? TargetTabId = null,
    string? SessionId = null,
    string? BoundaryId = null,
    string? Detail = null);

public sealed class BrowserExtensionBridgeDiagnosticEventArgs(BrowserExtensionBridgeDiagnostic diagnostic) : EventArgs
{
    public BrowserExtensionBridgeDiagnostic Diagnostic { get; } = diagnostic;
}

/// <summary>
/// A server-originated event sent only to an authenticated Extension socket.
/// The current alpha uses events for connection confirmation; it does not
/// expose any command execution surface.
/// </summary>
public sealed record BrowserExtensionBridgeEvent(
    string EventName,
    JsonObject? Data = null,
    string? EventId = null,
    DateTimeOffset? Timestamp = null)
{
    public DateTimeOffset EffectiveTimestamp => Timestamp ?? DateTimeOffset.UtcNow;
}
