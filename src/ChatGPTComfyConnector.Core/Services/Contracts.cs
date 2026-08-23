using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public interface IPortableStore
{
    Task<AppSettings?> LoadSettingsAsync(CancellationToken cancellationToken = default);
    Task SaveSettingsAsync(AppSettings settings, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<CreationSession>> LoadSessionsAsync(CancellationToken cancellationToken = default);
    Task SaveSessionAsync(CreationSession session, CancellationToken cancellationToken = default);
    Task<string> CreateWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string reason, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<string>> ListWorkflowBackupsAsync(WorkflowIdentity workflow, CancellationToken cancellationToken = default);
    Task RestoreWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string backupPath, CancellationToken cancellationToken = default);
    Task LogAsync(string category, string message, Exception? exception = null, CancellationToken cancellationToken = default);
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

public interface IClipboardService
{
    void SetText(string text);
}

public interface IExternalFileService
{
    void OpenFile(string path);
    void OpenFolder(string path);
}
