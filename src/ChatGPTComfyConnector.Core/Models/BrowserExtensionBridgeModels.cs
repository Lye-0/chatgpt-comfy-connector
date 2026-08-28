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
