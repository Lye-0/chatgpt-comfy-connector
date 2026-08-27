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
            Minimum = ReadDouble(slot, "minimum", "min"),
            Maximum = ReadDouble(slot, "maximum", "max"),
            PairingSuspect = slot["pairing_suspect"]?.GetValue<bool>() ?? false,
        }).Where(slot => !string.IsNullOrWhiteSpace(slot.Address)).ToArray();
    }

    public async Task<JsonNode?> ValidateAsync(WorkflowIdentity workflow, string workflowRoot, CancellationToken cancellationToken = default)
        => await _mcp.CallAsync("validate_workflow", new Dictionary<string, object?> { ["workflow_path"] = workflow.ToAbsolute(workflowRoot) }, cancellationToken);

    public async Task<string> ApplySlotsAsync(WorkflowIdentity workflow, string workflowRoot, IReadOnlyDictionary<string, JsonNode?> changes, CancellationToken cancellationToken = default)
    {
        if (changes.Count == 0) return string.Empty;
        var workflowPath = workflow.ToAbsolute(workflowRoot);
        var safeChanges = NormalizeFilenamePrefixChanges(workflowPath, changes);
        var backup = await _store.CreateWorkflowBackupAsync(workflow, workflowRoot, "before-save", cancellationToken);
        try
        {
            var overrides = safeChanges.Select(change => (object?)new Dictionary<string, object?>
            {
                ["address"] = change.Key,
                ["value"] = change.Value is null ? null : System.Text.Json.JsonSerializer.SerializeToElement(change.Value),
            }).ToList();
            await _mcp.CallAsync("set_workflow_slot", new Dictionary<string, object?>
            {
                ["workflow_path"] = workflowPath,
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
        return new JobSnapshot
        {
            JobId = jobId,
            Status = mapped,
            Message = response?.ToJsonString(),
            OutputReferences = ReadOutputReferences(response).ToList(),
        };
    }

    public async Task CancelAsync(string jobId, CancellationToken cancellationToken = default)
        => await _mcp.CallAsync("job", new Dictionary<string, object?> { ["action"] = "cancel", ["prompt_id"] = jobId }, cancellationToken);

    public Task<IReadOnlyList<OutputArtifact>> FetchOutputsAsync(string jobId, string outputRoot, CancellationToken cancellationToken = default)
        => FetchOutputsAsync(jobId, outputRoot, outputReferences: null, cancellationToken);

    /// <summary>
    /// Resolves completed ComfyUI outputs from the filename/subfolder metadata
    /// returned by <c>job status</c>.  The Comfy CLI's download command uses a
    /// prompt-id based name and a flat destination when no item is supplied;
    /// that name is only a staging name and must never replace the Workflow's
    /// relative output path.
    /// </summary>
    public async Task<IReadOnlyList<OutputArtifact>> FetchOutputsAsync(
        string jobId,
        string outputRoot,
        IReadOnlyList<JobOutputReference>? outputReferences,
        CancellationToken cancellationToken = default)
    {
        var normalizedRoot = Path.GetFullPath(outputRoot);
        Directory.CreateDirectory(normalizedRoot);
        var references = outputReferences?.Where(reference => !string.IsNullOrWhiteSpace(reference.FileName)).ToArray();

        if (references is not { Length: > 0 })
        {
            try
            {
                var status = await _mcp.CallAsync("job", new Dictionary<string, object?>
                {
                    ["action"] = "status",
                    ["prompt_id"] = jobId,
                }, cancellationToken);
                references = ReadOutputReferences(status).Where(reference => !string.IsNullOrWhiteSpace(reference.FileName)).ToArray();
            }
            catch (Exception ex)
            {
                await _store.LogAsync("output", "Job output metadata could not be read; using the legacy download fallback.", ex, cancellationToken);
            }
        }

        if (references is { Length: > 0 })
        {
            var resolvedPaths = new List<string>();
            var unresolved = new List<JobOutputReference>();
            foreach (var reference in references)
            {
                if (TryResolveOutputPath(reference, normalizedRoot, out var path) && File.Exists(path)) resolvedPaths.Add(path);
                else unresolved.Add(reference);
            }

            if (unresolved.Count == 0) return BuildOutputArtifacts(resolvedPaths);

            // Only use fetch_outputs when the local ComfyUI output is not
            // already available. Download into an isolated staging folder,
            // then restore each file to its Workflow-relative subfolder.
            var stagingRoot = Path.Combine(normalizedRoot, ".connector-downloads", SafePathSegment(jobId));
            Directory.CreateDirectory(stagingRoot);
            var downloadedPaths = await FetchOutputFilesAsync(jobId, stagingRoot, cancellationToken);
            var remainingDownloads = downloadedPaths.ToList();
            for (var referenceIndex = 0; referenceIndex < references.Length; referenceIndex++)
            {
                var reference = references[referenceIndex];
                if (!unresolved.Contains(reference)) continue;
                var source = FindDownloadedMatch(reference, remainingDownloads, unresolved.Count == 1);
                if (downloadedPaths.Count == references.Length && referenceIndex < downloadedPaths.Count && remainingDownloads.Contains(downloadedPaths[referenceIndex]))
                    source = downloadedPaths[referenceIndex];
                if (source is null) continue;
                remainingDownloads.Remove(source);
                if (!TryResolveOutputPath(reference, normalizedRoot, out var destination))
                {
                    TryDeleteFile(source);
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                if (!File.Exists(destination)) File.Move(source, destination);
                else if (!string.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) File.Delete(source);
                if (File.Exists(destination)) resolvedPaths.Add(destination);
            }

            // The status response is authoritative for this Job. Any files
            // left in the staging directory are duplicate downloads for
            // already-resolved references, so remove them instead of exposing
            // prompt-id filenames as additional outputs.
            foreach (var extra in remainingDownloads) TryDeleteFile(extra);
            TryDeleteEmptyDirectory(stagingRoot);
            TryDeleteEmptyDirectory(Path.GetDirectoryName(stagingRoot));
            return BuildOutputArtifacts(resolvedPaths);
        }

        // Older comfy-mcp versions may not expose output metadata. Preserve
        // the old behavior as a last resort, but do not assume a particular
        // Workflow subfolder when interpreting the returned files.
        return BuildOutputArtifacts(await FetchOutputFilesAsync(jobId, normalizedRoot, cancellationToken));
    }

    private async Task<IReadOnlyList<string>> FetchOutputFilesAsync(string jobId, string destination, CancellationToken cancellationToken)
    {
        var normalizedDestination = Path.GetFullPath(destination);
        var response = await _mcp.CallAsync("fetch_outputs", new Dictionary<string, object?>
        {
            ["prompt_id"] = jobId,
            ["out_dir"] = normalizedDestination,
        }, cancellationToken);
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectPaths(response, paths);
        return paths
            .Select(Path.GetFullPath)
            .Where(path => PathSafety.IsWithin(normalizedDestination, path) && File.Exists(path))
            .ToArray();
    }

    private static IReadOnlyList<OutputArtifact> BuildOutputArtifacts(IEnumerable<string> paths)
        => paths
            .Where(File.Exists)
            .Select(Path.GetFullPath)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(path => new OutputArtifact
            {
                FileName = Path.GetFileName(path),
                FullPath = path,
                Type = Path.GetExtension(path).TrimStart('.').ToLowerInvariant(),
                CreatedAt = File.GetCreationTimeUtc(path),
            })
            .ToArray();

    private static string? FindDownloadedMatch(JobOutputReference reference, IReadOnlyCollection<string> candidates, bool allowSingleFallback)
    {
        var fileName = Path.GetFileName(reference.FileName.Replace('/', Path.DirectorySeparatorChar));
        var exact = candidates.FirstOrDefault(path => string.Equals(Path.GetFileName(path), fileName, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact;

        var extension = Path.GetExtension(fileName);
        var sameExtension = candidates
            .Where(path => string.Equals(Path.GetExtension(path), extension, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (sameExtension.Length == 1 || allowSingleFallback) return sameExtension.FirstOrDefault();
        return candidates.FirstOrDefault();
    }

    private static bool TryResolveOutputPath(JobOutputReference reference, string outputRoot, out string path)
    {
        path = string.Empty;
        if (string.Equals(reference.Type, "input", StringComparison.OrdinalIgnoreCase)
            || string.Equals(reference.Type, "temp", StringComparison.OrdinalIgnoreCase)) return false;

        if (!string.IsNullOrWhiteSpace(reference.SourcePath))
        {
            try
            {
                if (Path.IsPathRooted(reference.SourcePath))
                {
                    var source = Path.GetFullPath(reference.SourcePath);
                    if (!PathSafety.IsWithin(outputRoot, source)) return !string.IsNullOrWhiteSpace(reference.Url) && TryResolveRelativeOutput(reference, outputRoot, out path);
                    path = source;
                    return true;
                }
            }
            catch (ArgumentException) { return false; }
            catch (IOException) { return false; }
        }

        return TryResolveRelativeOutput(reference, outputRoot, out path);
    }

    private static bool TryResolveRelativeOutput(JobOutputReference reference, string outputRoot, out string path)
    {
        path = string.Empty;
        var fileName = (reference.FileName ?? string.Empty).Replace('\\', '/').Trim('/');
        if (string.IsNullOrWhiteSpace(fileName)) return false;
        var fileSegments = fileName.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (fileSegments.Any(segment => segment is "." or ".." || segment.IndexOf('\0') >= 0)) return false;
        var subfolder = (reference.Subfolder ?? string.Empty).Replace('\\', '/').Trim('/');
        if (fileSegments.Length > 1)
        {
            if (string.IsNullOrWhiteSpace(subfolder)) subfolder = string.Join('/', fileSegments[..^1]);
            fileName = fileSegments[^1];
        }
        if (fileName is "." or ".." || fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;

        var subfolderSegments = subfolder.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (subfolderSegments.Any(segment => segment is "." or ".." || segment.IndexOf('\0') >= 0)) return false;
        var relative = string.Join('/', subfolderSegments.Append(fileName));
        try
        {
            var candidate = Path.GetFullPath(Path.Combine(outputRoot, relative.Replace('/', Path.DirectorySeparatorChar)));
            if (!PathSafety.IsWithin(outputRoot, candidate)) return false;
            path = candidate;
            return true;
        }
        catch (ArgumentException) { return false; }
        catch (IOException) { return false; }
    }

    private static string SafePathSegment(string value)
    {
        var chars = value.Select(character => char.IsLetterOrDigit(character) || character is '-' or '_' ? character : '_').ToArray();
        var safe = new string(chars).Trim('_');
        return string.IsNullOrWhiteSpace(safe) ? "job" : safe;
    }

    private static void TryDeleteEmptyDirectory(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            if (Directory.Exists(path) && !Directory.EnumerateFileSystemEntries(path).Any()) Directory.Delete(path);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    private static IEnumerable<JobOutputReference> ReadOutputReferences(JsonNode? response)
    {
        var root = response as JsonObject;
        var outputs = root?["outputs"] ?? (root?["data"] as JsonObject)?["outputs"];
        if (outputs is null) yield break;
        foreach (var reference in EnumerateOutputReferences(outputs)) yield return reference;
    }

    private static IEnumerable<JobOutputReference> EnumerateOutputReferences(JsonNode? node)
    {
        if (node is JsonArray array)
        {
            foreach (var item in array)
            {
                var reference = ParseOutputReference(item);
                if (reference is not null) yield return reference;
                else foreach (var nested in EnumerateOutputReferences(item)) yield return nested;
            }
            yield break;
        }

        if (node is not JsonObject obj) yield break;
        var direct = ParseOutputReference(obj);
        if (direct is not null)
        {
            yield return direct;
            yield break;
        }
        foreach (var child in obj.Select(pair => pair.Value))
            foreach (var nested in EnumerateOutputReferences(child)) yield return nested;
    }

    private static JobOutputReference? ParseOutputReference(JsonNode? node)
    {
        if (node is JsonValue value && value.TryGetValue<string>(out var text)) return ParseOutputReference(text);
        if (node is not JsonObject obj) return null;

        var url = ReadString(obj, "url", "uri");
        var reference = !string.IsNullOrWhiteSpace(url) ? ParseOutputReference(url) : new JobOutputReference();
        if (reference is null) reference = new JobOutputReference();
        reference.Url ??= url;
        var sourcePath = ReadString(obj, "path", "full_path", "filepath", "file_path");
        if (!string.IsNullOrWhiteSpace(sourcePath))
        {
            if (Uri.TryCreate(sourcePath, UriKind.Absolute, out var sourceUri) && sourceUri.IsFile) sourcePath = sourceUri.LocalPath;
            reference.SourcePath = sourcePath;
        }
        reference.FileName = ReadString(obj, "filename", "file_name", "name") ?? reference.FileName;
        reference.Subfolder = ReadString(obj, "subfolder", "folder", "directory") ?? reference.Subfolder;
        reference.Type = ReadString(obj, "type", "output_type") ?? reference.Type;
        if (string.IsNullOrWhiteSpace(reference.FileName) && !string.IsNullOrWhiteSpace(reference.SourcePath)) reference.FileName = Path.GetFileName(reference.SourcePath);
        if (string.IsNullOrWhiteSpace(reference.Subfolder)
            && !string.IsNullOrWhiteSpace(reference.SourcePath)
            && !Path.IsPathRooted(reference.SourcePath))
        {
            var normalizedSource = reference.SourcePath.Replace('\\', '/').Trim('/');
            var sourceSegments = normalizedSource.Split('/', StringSplitOptions.RemoveEmptyEntries);
            if (sourceSegments.Length > 1) reference.Subfolder = string.Join('/', sourceSegments[..^1]);
        }
        return string.IsNullOrWhiteSpace(reference.FileName) ? null : reference;
    }

    private static JobOutputReference? ParseOutputReference(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        if (Uri.TryCreate(raw, UriKind.Absolute, out var uri) && (uri.Scheme is "http" or "https"))
        {
            var reference = new JobOutputReference
            {
                Url = raw,
                FileName = QueryValue(uri, "filename") ?? string.Empty,
                Subfolder = QueryValue(uri, "subfolder") ?? string.Empty,
                Type = QueryValue(uri, "type") ?? "output",
            };
            if (string.IsNullOrWhiteSpace(reference.FileName)) reference.FileName = Path.GetFileName(uri.AbsolutePath);
            return string.IsNullOrWhiteSpace(reference.FileName) ? null : reference;
        }

        if (Uri.TryCreate(raw, UriKind.Absolute, out var fileUri) && fileUri.IsFile)
        {
            var path = fileUri.LocalPath;
            return new JobOutputReference
            {
                FileName = Path.GetFileName(path),
                SourcePath = path,
                Type = "output",
            };
        }

        if (Path.IsPathRooted(raw))
        {
            return new JobOutputReference
            {
                FileName = Path.GetFileName(raw),
                SourcePath = raw,
                Type = "output",
            };
        }

        var normalized = raw.Replace('\\', '/').Trim('/');
        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(segment => segment is "." or "..")) return null;
        return new JobOutputReference
        {
            FileName = segments[^1],
            Subfolder = segments.Length > 1 ? string.Join('/', segments[..^1]) : string.Empty,
            Type = "output",
        };
    }

    private static string? QueryValue(Uri uri, string key)
    {
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = pair.Split('=', 2);
            var name = Uri.UnescapeDataString(parts[0].Replace('+', ' '));
            if (!string.Equals(name, key, StringComparison.OrdinalIgnoreCase)) continue;
            return Uri.UnescapeDataString((parts.Length > 1 ? parts[1] : string.Empty).Replace('+', ' '));
        }
        return null;
    }

    private static Dictionary<string, JsonNode?> NormalizeFilenamePrefixChanges(string workflowPath, IReadOnlyDictionary<string, JsonNode?> changes)
    {
        var originals = ReadFilenamePrefixes(workflowPath);
        var normalized = new Dictionary<string, JsonNode?>(StringComparer.OrdinalIgnoreCase);
        foreach (var change in changes)
        {
            var value = change.Value?.DeepClone();
            if (TryGetFilenamePrefixNodeId(change.Key, out var nodeId)
                && originals.TryGetValue(nodeId, out var original)
                && value is JsonValue jsonValue
                && jsonValue.TryGetValue<string>(out var requested))
            {
                value = JsonValue.Create(PreserveOutputDirectory(original, requested));
            }
            normalized[change.Key] = value;
        }
        return normalized;
    }

    private static bool TryGetFilenamePrefixNodeId(string address, out string nodeId)
    {
        nodeId = string.Empty;
        var separator = address.IndexOf('.', StringComparison.Ordinal);
        if (separator <= 0) return false;
        var inputName = address[(separator + 1)..];
        if (inputName.StartsWith("inputs.", StringComparison.OrdinalIgnoreCase)) inputName = inputName["inputs.".Length..];
        if (!string.Equals(inputName, "filename_prefix", StringComparison.OrdinalIgnoreCase)) return false;
        nodeId = address[..separator];
        return !string.IsNullOrWhiteSpace(nodeId);
    }

    private static string PreserveOutputDirectory(string original, string requested)
    {
        var originalSegments = NormalizeComfyPrefix(original);
        var requestedSegments = string.IsNullOrWhiteSpace(requested) ? originalSegments : NormalizeComfyPrefix(requested);
        var directory = originalSegments.Length > 1 ? originalSegments[..^1] : [];
        var leaf = requestedSegments[^1];
        return string.Join('/', directory.Append(leaf));
    }

    private static string[] NormalizeComfyPrefix(string value)
    {
        var normalized = (value ?? string.Empty).Replace('\\', '/').Trim();
        if (string.IsNullOrWhiteSpace(normalized) || Path.IsPathRooted(normalized)) throw new InvalidOperationException("filename_prefixはComfyUIの相対パスで指定してください。");
        var segments = normalized.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(segment => segment is "." or ".." || segment.IndexOf('\0') >= 0)) throw new InvalidOperationException("filename_prefixの相対パスが不正です。");
        return segments;
    }

    private static IReadOnlyDictionary<string, string> ReadFilenamePrefixes(string workflowPath)
    {
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(workflowPath)) as JsonObject;
            if (root is null) return result;
            IEnumerable<JsonObject> nodes = root["nodes"] switch
            {
                JsonArray array => array.OfType<JsonObject>(),
                JsonObject map => map.Select(pair => pair.Value).OfType<JsonObject>(),
                _ => [],
            };
            foreach (var node in nodes)
            {
                var id = ReadString(node, "id");
                if (string.IsNullOrWhiteSpace(id)) continue;
                if (node["inputs"] is JsonObject apiInputs && apiInputs["filename_prefix"] is JsonValue apiValue && apiValue.TryGetValue<string>(out var apiPrefix))
                {
                    result[id] = apiPrefix;
                    continue;
                }
                if (node["inputs"] is not JsonArray uiInputs || node["widgets_values"] is not JsonArray widgets) continue;
                var widgetIndex = 0;
                foreach (var input in uiInputs.OfType<JsonObject>())
                {
                    var hasWidget = input["widget"] is not null;
                    var name = ReadString(input, "name");
                    if (string.Equals(name, "filename_prefix", StringComparison.OrdinalIgnoreCase)
                        && widgetIndex < widgets.Count
                        && widgets[widgetIndex] is JsonValue value
                        && value.TryGetValue<string>(out var prefix))
                    {
                        result[id] = prefix;
                        break;
                    }
                    if (hasWidget) widgetIndex++;
                }
            }
        }
        catch (Exception) { }
        return result;
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

    private static double? ReadDouble(JsonNode? node, params string[] names)
    {
        foreach (var name in names)
        {
            if (node?[name] is not JsonValue value) continue;
            if (value.TryGetValue<double>(out var number)) return number;
            if (value.TryGetValue<int>(out var integer)) return integer;
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
