using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public interface IPortableStore
{
    Task<AppSettings?> LoadSettingsAsync(CancellationToken cancellationToken = default);
    Task SaveSettingsAsync(AppSettings settings, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CreationSession>> LoadSessionsAsync(CancellationToken cancellationToken = default);
    Task SaveSessionAsync(CreationSession session, CancellationToken cancellationToken = default);
    Task<LocalContextCatalog?> LoadLocalContextsAsync(CancellationToken cancellationToken = default);
    Task SaveLocalContextsAsync(LocalContextCatalog catalog, CancellationToken cancellationToken = default);
    Task<string> CreateWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string reason, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<string>> ListWorkflowBackupsAsync(WorkflowIdentity workflow, CancellationToken cancellationToken = default);
    Task RestoreWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string backupPath, CancellationToken cancellationToken = default);
    Task LogAsync(string category, string message, Exception? exception = null, CancellationToken cancellationToken = default);
}

/// <summary>
/// Persistence boundary for the Desktop half of Browser Extension pairing.
/// Implementations must persist only a verifier/hash, never the raw bearer
/// credential returned to the Extension.
/// </summary>
public interface IBrowserExtensionPairingStore
{
    Task<BrowserExtensionPairingRecord?> LoadBrowserExtensionPairingAsync(CancellationToken cancellationToken = default);
    Task SaveBrowserExtensionPairingAsync(BrowserExtensionPairingRecord pairing, CancellationToken cancellationToken = default);
}

/// <summary>
/// Optional metadata-only cache for an external Project/Chat provider. It is
/// separate from IPortableStore so existing store implementations and local
/// context formats remain source-compatible.
/// </summary>
public interface IChatGptContextCacheStore
{
    Task<BrowserExtensionChatGptContextCache?> LoadChatGptContextCacheAsync(
        CancellationToken cancellationToken = default);
    Task SaveChatGptContextCacheAsync(
        BrowserExtensionChatGptContextCache cache,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Optional provider capability used by the Desktop to render a previous
/// metadata snapshot immediately while a fresh discovery runs in the
/// background/foreground loading path.
/// </summary>
public interface IProjectChatCacheProvider
{
    Task<ProjectChatCatalog?> LoadCachedAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default);
}

public interface IProjectChatProvider
{
    string ProviderId { get; }
    Task<ProjectChatCatalog> LoadAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default,
        string? collectionTrigger = null);
    Task<ProjectContextOption> CreateProjectAsync(string displayName, CancellationToken cancellationToken = default);
    Task<ChatContextOption> CreateChatAsync(ProjectContextOption project, string displayName, CancellationToken cancellationToken = default);
}

/// <summary>
/// Optional capability for providers whose root catalog contains Project
/// metadata and Projectless Chats, while Project Chats are collected only
/// after the user selects one Project. Keeping this separate from
/// <see cref="IProjectChatProvider"/> leaves local/offline providers unchanged.
/// </summary>
public interface IProjectChatSelectionProvider
{
    Task<IReadOnlyList<ChatContextOption>> LoadProjectChatsAsync(
        ProjectContextOption project,
        CancellationToken cancellationToken = default);
}

public interface IComfyMcpClient : IAsyncDisposable
{
    bool IsConnected { get; }
    ConnectionState State { get; }
    IReadOnlyList<string> ToolNames { get; }
    Task ConnectAsync(AppSettings settings, CancellationToken cancellationToken = default);
    Task DisconnectAsync(CancellationToken cancellationToken = default);
    Task<JsonNode?> CallAsync(string toolName, IReadOnlyDictionary<string, object?> arguments, CancellationToken cancellationToken = default);
}

/// <summary>
/// Checks the configured ComfyUI endpoint without going through MCP. Keeping
/// this boundary injectable lets the desktop runtime use one shared HTTP
/// implementation while the state transitions remain independently testable.
/// </summary>
public interface IComfyUiHealthProbe
{
    Task<ComfyUiHealthCheckResult> CheckAsync(string endpoint, CancellationToken cancellationToken = default);
}

/// <summary>
/// Local-only transport boundary for the Chromium Browser Extension. The
/// implementation owns HTTP/WebSocket details; Core consumers only observe
/// state and send explicitly shaped server events or Handoff requests.
/// </summary>
public interface IBrowserExtensionBridge : IAsyncDisposable
{
    BrowserExtensionBridgeStatus Status { get; }
    event EventHandler<BrowserExtensionBridgeStatusChangedEventArgs>? StatusChanged;
    event EventHandler<BrowserExtensionBridgeDiagnosticEventArgs>? Diagnostic;
    event EventHandler<BrowserExtensionAssistantResponseEventArgs>? AssistantResponseReceived;
    event EventHandler<BrowserExtensionChatGptContextChangedEventArgs>? ChatGptContextChanged;
    Task StartAsync(CancellationToken cancellationToken = default);
    Task StopAsync(CancellationToken cancellationToken = default);
    Task<bool> SendEventAsync(BrowserExtensionBridgeEvent bridgeEvent, CancellationToken cancellationToken = default);
    Task<BrowserExtensionHandoffSendResult> SendHandoffAsync(
        BrowserExtensionHandoffSendRequest request,
        CancellationToken cancellationToken = default);
    void RegisterMedia(BrowserExtensionMediaRegistration registration);
    bool RevokeMedia(string mediaId);
    Task<BrowserExtensionMediaAttachResult> SendMediaAttachAsync(
        BrowserExtensionMediaAttachRequest request,
        CancellationToken cancellationToken = default);
    Task<BrowserExtensionChatGptContextSnapshot> GetChatGptContextAsync(
        bool currentOnly = false,
        CancellationToken cancellationToken = default,
        string? collectionTrigger = null);
    Task<BrowserExtensionChatGptContextSnapshot> GetChatGptProjectChatsAsync(
        string projectId,
        string projectUrl,
        CancellationToken cancellationToken = default,
        string? collectionTrigger = null);
}

public interface IClipboardService
{
    void SetText(string text);
}

public interface IExternalFileService
{
    void OpenFile(string path);
    void OpenFolder(string path);
}
