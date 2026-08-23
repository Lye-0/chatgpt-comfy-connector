using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Workflows;

public sealed class WorkflowCatalog
{
    private readonly IComfyMcpClient _mcp;
    private readonly IPortableStore _store;

    public WorkflowCatalog(IComfyMcpClient mcp, IPortableStore store)
    {
        _mcp = mcp;
        _store = store;
    }

    public IReadOnlyList<WorkflowTreeNode> BuildTree(string workflowRoot)
    {
        if (!Directory.Exists(workflowRoot)) return [];
        return BuildFolder(workflowRoot, workflowRoot).Children;
    }

    public string GetWorkflowPath(WorkflowIdentity workflow, string workflowRoot) => workflow.ToAbsolute(workflowRoot);

    public async Task<IReadOnlyList<WorkflowSlot>> DiscoverSlotsAsync(WorkflowIdentity workflow, string workflowRoot, CancellationToken cancellationToken = default)
    {
        var node = await _mcp.CallAsync("list_workflow_slots", new Dictionary<string, object?> { ["workflow_path"] = workflow.ToAbsolute(workflowRoot) }, cancellationToken);
        var array = node?["slots"] as JsonArray ?? (node as JsonArray);
        if (array is null) return [];
        return array.OfType<JsonObject>().Select(slot => new WorkflowSlot
        {
            Address = slot["address"]?.GetValue<string>() ?? string.Empty,
            Label = slot["label"]?.GetValue<string>() ?? slot["name"]?.GetValue<string>() ?? slot["address"]?.GetValue<string>() ?? "slot",
            Type = slot["type"]?.GetValue<string>() ?? "UNKNOWN",
            CurrentValue = slot["current_value"]?.DeepClone(),
            Choices = slot["choices"] as JsonArray ?? slot["values"] as JsonArray,
            PairingSuspect = slot["pairing_suspect"]?.GetValue<bool>() ?? false,
        }).Where(slot => !string.IsNullOrWhiteSpace(slot.Address)).ToArray();
    }

    public async Task<JsonNode?> ValidateAsync(WorkflowIdentity workflow, string workflowRoot, CancellationToken cancellationToken = default)
        => await _mcp.CallAsync("validate_workflow", new Dictionary<string, object?> { ["workflow_path"] = workflow.ToAbsolute(workflowRoot) }, cancellationToken);

    public async Task<string> ApplySlotsAsync(WorkflowIdentity workflow, string workflowRoot, IReadOnlyDictionary<string, JsonNode?> changes, CancellationToken cancellationToken = default)
    {
        if (changes.Count == 0) return string.Empty;
        var backup = await _store.CreateWorkflowBackupAsync(workflow, workflowRoot, "before-save", cancellationToken);
        try
        {
            var overrides = changes.Select(change => (object?)new Dictionary<string, object?>
            {
                ["address"] = change.Key,
                ["value"] = change.Value is null ? null : System.Text.Json.JsonSerializer.SerializeToElement(change.Value),
            }).ToList();
            await _mcp.CallAsync("set_workflow_slot", new Dictionary<string, object?>
            {
                ["workflow_path"] = workflow.ToAbsolute(workflowRoot),
                ["overrides"] = overrides,
                ["stdout"] = false,
            }, cancellationToken);
            var validation = await ValidateAsync(workflow, workflowRoot, cancellationToken);
            if (validation?["valid"]?.GetValue<bool>() != true) throw new InvalidOperationException("Workflowのvalidate結果が成功ではありません。実行は中止しました。");
            return backup;
        }
        catch (Exception ex)
        {
            try { await _store.RestoreWorkflowBackupAsync(workflow, workflowRoot, backup, cancellationToken); }
            catch (Exception rollback) { await _store.LogAsync("workflow", "rollback failed", rollback, cancellationToken); }
            await _store.LogAsync("workflow", "slot apply failed; rollback attempted", ex, cancellationToken);
            throw;
        }
    }

    public async Task<JobSnapshot> RunAsync(WorkflowIdentity workflow, string workflowRoot, CancellationToken cancellationToken = default)
    {
        var response = await _mcp.CallAsync("run_workflow", new Dictionary<string, object?>
        {
            ["workflow_path"] = workflow.ToAbsolute(workflowRoot),
            ["wait"] = false,
            ["timeout_seconds"] = 3600d,
            ["confirm_spend"] = false,
        }, cancellationToken);
        var jobId = ReadString(response, "prompt_id", "job_id", "id");
        if (string.IsNullOrWhiteSpace(jobId)) throw new InvalidOperationException("run_workflowの応答にprompt_idがありません。");
        return new JobSnapshot { JobId = jobId, Status = JobStatus.Queued };
    }

    public async Task<JobSnapshot> GetJobAsync(string jobId, CancellationToken cancellationToken = default)
    {
        var response = await _mcp.CallAsync("job", new Dictionary<string, object?> { ["action"] = "status", ["prompt_id"] = jobId }, cancellationToken);
        var status = ReadString(response, "status", "state")?.ToLowerInvariant() ?? "running";
        var mapped = status switch
        {
            "queued" or "pending" => JobStatus.Queued,
            "completed" or "complete" or "success" or "succeeded" or "done" => JobStatus.Completed,
            "failed" or "error" => JobStatus.Failed,
            "cancelled" or "canceled" => JobStatus.Cancelled,
            _ => JobStatus.Running,
        };
        return new JobSnapshot { JobId = jobId, Status = mapped, Message = response?.ToJsonString() };
    }

    public async Task CancelAsync(string jobId, CancellationToken cancellationToken = default)
        => await _mcp.CallAsync("job", new Dictionary<string, object?> { ["action"] = "cancel", ["prompt_id"] = jobId }, cancellationToken);

    public async Task<IReadOnlyList<OutputArtifact>> FetchOutputsAsync(string jobId, string outputRoot, CancellationToken cancellationToken = default)
    {
        Directory.CreateDirectory(outputRoot);
        var response = await _mcp.CallAsync("fetch_outputs", new Dictionary<string, object?> { ["prompt_id"] = jobId, ["out_dir"] = outputRoot }, cancellationToken);
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectPaths(response, paths);
        return paths.Where(File.Exists).Select(path => new OutputArtifact
        {
            FileName = Path.GetFileName(path),
            FullPath = path,
            Type = Path.GetExtension(path).TrimStart('.').ToLowerInvariant(),
            CreatedAt = File.GetCreationTimeUtc(path),
        }).ToArray();
    }

    public static string ComputeFingerprint(string workflowPath)
    {
        using var stream = File.OpenRead(workflowPath);
        return Convert.ToHexString(SHA256.HashData(stream));
    }

    private static WorkflowTreeNode BuildFolder(string folder, string root)
    {
        var node = new WorkflowTreeNode { Name = Path.GetFileName(folder), IsFolder = true, RelativePath = string.Empty };
        foreach (var directory in Directory.EnumerateDirectories(folder).OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase)) node.Children.Add(BuildFolder(directory, root));
        foreach (var file in Directory.EnumerateFiles(folder, "*.json")
                     .Where(file => !string.Equals(Path.GetFileNameWithoutExtension(file), ".index", StringComparison.OrdinalIgnoreCase))
                     .OrderBy(Path.GetFileName, StringComparer.OrdinalIgnoreCase))
        {
            node.Children.Add(new WorkflowTreeNode
            {
                Name = Path.GetFileNameWithoutExtension(file),
                IsFolder = false,
                RelativePath = Path.GetRelativePath(root, file).Replace('\\', '/'),
            });
        }
        return node;
    }

    private static string? ReadString(JsonNode? node, params string[] names)
    {
        foreach (var name in names)
        {
            var value = node?[name];
            if (value is null) continue;
            if (value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text)) return text;
            return value.ToString();
        }
        return null;
    }

    private static void CollectPaths(JsonNode? node, ISet<string> paths)
    {
        if (node is JsonValue value && value.TryGetValue<string>(out var text) && Path.HasExtension(text) && File.Exists(text)) paths.Add(Path.GetFullPath(text));
        if (node is JsonObject obj) foreach (var pair in obj) CollectPaths(pair.Value, paths);
        if (node is JsonArray array) foreach (var item in array) CollectPaths(item, paths);
    }
}
