using System.Text.Json.Nodes;

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
    public const string ClientHeaderName = "X-Connector-Client";
    public const string ClientHeaderValue = "browser-extension";
    public const string ExtensionClientName = "browser-extension";

    public static string ToStateText(BrowserExtensionConnectionState state)
        => state.ToString().ToUpperInvariant();
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
    public const string SendButtonNotFound = "send_button_not_found";
    public const string SendNotReady = "send_not_ready";
    public const string SendFailed = "send_failed";
    public const string BridgeDisconnected = "bridge_disconnected";
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
    string Payload);

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
    string? Stage = null)
{
    public bool IsSent => string.Equals(Status, "sent", StringComparison.Ordinal);
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
    string? Stage = null);

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
