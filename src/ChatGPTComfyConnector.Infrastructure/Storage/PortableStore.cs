using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Storage;

public sealed class PortableStore : IPortableStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
    };
    private readonly PortableLayout _layout;
    private readonly SemaphoreSlim _logLock = new(1, 1);

    public PortableStore(PortableLayout layout)
    {
        _layout = layout;
        _layout.EnsureDirectories();
    }

    public async Task<AppSettings?> LoadSettingsAsync(CancellationToken cancellationToken = default)
        => await ReadAsync<AppSettings>(_layout.SettingsFile, cancellationToken);

    public Task SaveSettingsAsync(AppSettings settings, CancellationToken cancellationToken = default)
        => AtomicWriteAsync(_layout.SettingsFile, settings, cancellationToken);

    public async Task<IReadOnlyList<CreationSession>> LoadSessionsAsync(CancellationToken cancellationToken = default)
    {
        var sessions = new List<CreationSession>();
        if (!Directory.Exists(_layout.Sessions)) return sessions;
        foreach (var file in Directory.EnumerateFiles(_layout.Sessions, "*.json", SearchOption.TopDirectoryOnly))
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var session = await ReadAsync<CreationSession>(file, cancellationToken);
                if (session is not null) sessions.Add(session);
            }
            catch (JsonException)
            {
                await LogAsync("persistence", $"セッションJSONを読み込めませんでした: {file}", cancellationToken: cancellationToken);
            }
        }

        return sessions.OrderByDescending(s => s.UpdatedAt).ToArray();
    }

    public Task SaveSessionAsync(CreationSession session, CancellationToken cancellationToken = default)
    {
        session.UpdatedAt = DateTimeOffset.UtcNow;
        var fileName = SanitizeFileName(session.Id) + ".json";
        return AtomicWriteAsync(Path.Combine(_layout.Sessions, fileName), session, cancellationToken);
    }

    public Task<LocalContextCatalog?> LoadLocalContextsAsync(CancellationToken cancellationToken = default)
        => ReadAsync<LocalContextCatalog>(_layout.ContextsFile, cancellationToken);

    public Task SaveLocalContextsAsync(LocalContextCatalog catalog, CancellationToken cancellationToken = default)
        => AtomicWriteAsync(_layout.ContextsFile, catalog, cancellationToken);

    public async Task<string> CreateWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string reason, CancellationToken cancellationToken = default)
    {
        var source = workflow.ToAbsolute(workflowRoot);
        if (!File.Exists(source)) throw new FileNotFoundException("バックアップ対象のWorkflowが見つかりません。", source);
        var folder = GetBackupFolder(workflow);
        Directory.CreateDirectory(folder);
        var stamp = DateTimeOffset.UtcNow.ToString("yyyyMMdd-HHmmssfffffff");
        var destination = Path.Combine(folder, $"{stamp}-{SanitizeFileName(reason)}.json");
        await using (var input = File.OpenRead(source))
        await using (var output = File.Create(destination))
        {
            await input.CopyToAsync(output, cancellationToken);
        }

        var backups = Directory.EnumerateFiles(folder, "*.json").OrderByDescending(Path.GetFileName, StringComparer.Ordinal).ToArray();
        foreach (var old in backups.Skip(3)) File.Delete(old);
        return destination;
    }

    public Task<IReadOnlyList<string>> ListWorkflowBackupsAsync(WorkflowIdentity workflow, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var folder = GetBackupFolder(workflow);
        IReadOnlyList<string> result = Directory.Exists(folder)
            ? Directory.EnumerateFiles(folder, "*.json").OrderByDescending(Path.GetFileName, StringComparer.Ordinal).ToArray()
            : [];
        return Task.FromResult(result);
    }

    public async Task RestoreWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string backupPath, CancellationToken cancellationToken = default)
    {
        var source = workflow.ToAbsolute(workflowRoot);
        var fullBackup = Path.GetFullPath(backupPath);
        if (!PathSafety.IsWithin(_layout.Backups, fullBackup) || !File.Exists(fullBackup))
        {
            throw new InvalidOperationException("指定されたバックアップはConnectorのバックアップ領域にありません。");
        }

        var temp = source + ".restore.tmp";
        await using (var input = File.OpenRead(fullBackup))
        await using (var output = File.Create(temp))
        {
            await input.CopyToAsync(output, cancellationToken);
        }
        if (File.Exists(source)) await CreateWorkflowBackupAsync(workflow, workflowRoot, "before-restore", cancellationToken);
        File.Move(temp, source, true);
    }

    public async Task LogAsync(string category, string message, Exception? exception = null, CancellationToken cancellationToken = default)
    {
        var line = $"{DateTimeOffset.UtcNow:O} [{category}] {message}" +
                   (exception is null ? string.Empty : Environment.NewLine + exception) + Environment.NewLine;
        await _logLock.WaitAsync(cancellationToken);
        try
        {
            Directory.CreateDirectory(_layout.Logs);
            await File.AppendAllTextAsync(_layout.LogFile, line, Encoding.UTF8, cancellationToken);
            var info = new FileInfo(_layout.LogFile);
            if (info.Length > 5 * 1024 * 1024)
            {
                var rotated = Path.Combine(_layout.Logs, $"connector-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}.log");
                File.Move(_layout.LogFile, rotated, true);
            }
        }
        finally { _logLock.Release(); }
    }

    private string GetBackupFolder(WorkflowIdentity workflow)
    {
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(workflow.RelativePath))).ToLowerInvariant();
        return Path.Combine(_layout.Backups, hash);
    }

    private static string SanitizeFileName(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var sanitized = new string(value.Select(c => invalid.Contains(c) ? '_' : c).ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "backup" : sanitized[..Math.Min(80, sanitized.Length)];
    }

    private static async Task<T?> ReadAsync<T>(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return default;
        await using var stream = File.OpenRead(path);
        return await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken);
    }

    private static async Task AtomicWriteAsync<T>(string path, T value, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + ".tmp";
        await using (var stream = File.Create(temp))
        {
            await JsonSerializer.SerializeAsync(stream, value, JsonOptions, cancellationToken);
            await stream.FlushAsync(cancellationToken);
        }
        File.Move(temp, path, true);
    }
}
