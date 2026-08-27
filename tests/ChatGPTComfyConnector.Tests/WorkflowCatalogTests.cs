using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Workflows;

namespace ChatGPTComfyConnector.Tests;

public sealed class WorkflowCatalogTests
{
    [Fact]
    public async Task DiscoverSlotsCollapsesIdenticalAddressesFromMcpResponse()
    {
        var root = CreateTempDirectory();
        try
        {
            var mcp = new StubMcpClient((tool, _) => tool == "list_workflow_slots"
                ? JsonNode.Parse("""
                    {"slots":[
                      {"address":"115.aspect_ratio","label":"aspect_ratio","type":"COMBO","current_value":"16:9","choices":["16:9","9:16"]},
                      {"address":"115.ASPECT_RATIO","label":"aspect_ratio","type":"COMBO","current_value":"16:9","choices":["16:9","9:16"]}
                    ]}
                    """)
                : null);
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            var slots = await catalog.DiscoverSlotsAsync(WorkflowIdentity.Create("test.json"), root);

            var slot = Assert.Single(slots);
            Assert.Equal("115.aspect_ratio", slot.Address);
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    [Fact]
    public async Task DiscoverSlotsRejectsConflictingAddressesFromMcpResponse()
    {
        var root = CreateTempDirectory();
        try
        {
            var mcp = new StubMcpClient((tool, _) => tool == "list_workflow_slots"
                ? JsonNode.Parse("""
                    {"slots":[
                      {"address":"115.aspect_ratio","label":"aspect_ratio","type":"COMBO","current_value":"16:9","choices":["16:9","9:16"]},
                      {"address":"115.ASPECT_RATIO","label":"aspect_ratio","type":"COMBO","current_value":"1:1","choices":["1:1"]}
                    ]}
                    """)
                : null);
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            var exception = await Assert.ThrowsAsync<InvalidOperationException>(() =>
                catalog.DiscoverSlotsAsync(WorkflowIdentity.Create("test.json"), root));

            Assert.Contains("競合するAddress", exception.Message, StringComparison.Ordinal);
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    [Fact]
    public async Task FetchOutputsResolvesComfySubfolderWithoutDownloadingAFlatCopy()
    {
        var root = CreateTempDirectory();
        try
        {
            var expected = Path.Combine(root, "video", "MiniMax_H3_00008_.mp4");
            Directory.CreateDirectory(Path.GetDirectoryName(expected)!);
            await File.WriteAllTextAsync(expected, "video");

            var mcp = new StubMcpClient((tool, _) => tool switch
            {
                "job" => JsonNode.Parse("{\"status\":\"completed\",\"outputs\":[\"http://127.0.0.1:8188/view?filename=MiniMax_H3_00008_.mp4&subfolder=video&type=output\"]}"),
                "fetch_outputs" => throw new InvalidOperationException("fetch_outputs should not be called when the ComfyUI output exists locally."),
                _ => null,
            });
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            var outputs = await catalog.FetchOutputsAsync("prompt-id", root);

            var output = Assert.Single(outputs);
            Assert.Equal(Path.GetFullPath(expected), output.FullPath);
            Assert.Equal("MiniMax_H3_00008_.mp4", output.FileName);
            Assert.DoesNotContain(mcp.Calls, call => call.Tool == "fetch_outputs");
            Assert.False(File.Exists(Path.Combine(root, "prompt-id_000.mp4")));
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    [Fact]
    public async Task FetchOutputsKeepsArbitraryWorkflowSubfolders()
    {
        var root = CreateTempDirectory();
        try
        {
            var expected = Path.Combine(root, "renders", "cinematic", "scene.mp4");
            Directory.CreateDirectory(Path.GetDirectoryName(expected)!);
            await File.WriteAllTextAsync(expected, "video");

            var mcp = new StubMcpClient((tool, _) => tool == "job"
                ? JsonNode.Parse("{\"status\":\"done\",\"outputs\":[\"http://127.0.0.1:8188/view?filename=scene.mp4&subfolder=renders%2Fcinematic&type=output\"]}")
                : tool == "fetch_outputs"
                    ? throw new InvalidOperationException("fetch_outputs should not be called for an existing output.")
                    : null);
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            var outputs = await catalog.FetchOutputsAsync("prompt-id", root);

            Assert.Equal(Path.GetFullPath(expected), Assert.Single(outputs).FullPath);
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    [Fact]
    public async Task FetchOutputsRelocatesAStagedDownloadToTheReportedSubfolder()
    {
        var root = CreateTempDirectory();
        try
        {
            var mcp = new StubMcpClient((tool, arguments) => tool switch
            {
                "job" => JsonNode.Parse("{\"status\":\"completed\",\"outputs\":[\"http://127.0.0.1:8188/view?filename=scene.mp4&subfolder=renders%2Fcinematic&type=output\"]}"),
                "fetch_outputs" => CreateStagedDownload(arguments),
                _ => null,
            });
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            var outputs = await catalog.FetchOutputsAsync("prompt-id", root);

            var expected = Path.Combine(root, "renders", "cinematic", "scene.mp4");
            Assert.Equal(Path.GetFullPath(expected), Assert.Single(outputs).FullPath);
            Assert.True(File.Exists(expected));
            Assert.False(File.Exists(Path.Combine(root, "prompt-id_000.mp4")));
            Assert.False(Directory.Exists(Path.Combine(root, ".connector-downloads")));
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    [Fact]
    public async Task ApplyPreservesWorkflowRelativeDirectoryForFilenamePrefixOverride()
    {
        var root = CreateTempDirectory();
        try
        {
            var workflowRoot = Path.Combine(root, "workflows");
            Directory.CreateDirectory(workflowRoot);
            var workflowPath = Path.Combine(workflowRoot, "test.json");
            await File.WriteAllTextAsync(workflowPath, """
                {
                  "nodes": [
                    {
                      "id": 92,
                      "type": "SaveVideo",
                      "inputs": [
                        { "name": "video", "type": "VIDEO", "link": 1 },
                        { "name": "filename_prefix", "type": "STRING", "widget": { "name": "filename_prefix" } },
                        { "name": "format", "type": "COMBO", "widget": { "name": "format" } }
                      ],
                      "widgets_values": ["video/MiniMax_H3", "auto"]
                    }
                  ]
                }
                """);

            var mcp = new StubMcpClient((tool, arguments) => tool switch
            {
                "set_workflow_slot" => null,
                "validate_workflow" => JsonNode.Parse("{\"valid\":true}"),
                _ => null,
            });
            var catalog = new WorkflowCatalog(mcp, new StubPortableStore());

            await catalog.ApplySlotsAsync(
                WorkflowIdentity.Create("test.json"),
                workflowRoot,
                new Dictionary<string, JsonNode?> { ["92.filename_prefix"] = JsonValue.Create("e5730de5") });

            var call = Assert.Single(mcp.Calls, call => call.Tool == "set_workflow_slot");
            var arguments = call.Arguments;
            var overrides = Assert.IsType<List<object?>>(arguments["overrides"]);
            var overrideItem = Assert.IsType<Dictionary<string, object?>>(Assert.Single(overrides));
            var value = Assert.IsType<JsonElement>(overrideItem["value"]);
            Assert.Equal("video/e5730de5", value.GetString());
        }
        finally
        {
            DeleteTempDirectory(root);
        }
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), "connector-workflow-catalog-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path);
        return path;
    }

    private static void DeleteTempDirectory(string path)
    {
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
    }

    private static JsonNode CreateStagedDownload(IReadOnlyDictionary<string, object?> arguments)
    {
        var destination = Assert.IsType<string>(arguments["out_dir"]);
        Directory.CreateDirectory(destination);
        var path = Path.Combine(destination, "prompt_000.mp4");
        File.WriteAllText(path, "video");
        return JsonValue.Create(path)!;
    }

    private sealed class StubMcpClient : IComfyMcpClient
    {
        private readonly Func<string, IReadOnlyDictionary<string, object?>, JsonNode?> _handler;

        public StubMcpClient(Func<string, IReadOnlyDictionary<string, object?>, JsonNode?> handler) => _handler = handler;
        public List<(string Tool, IReadOnlyDictionary<string, object?> Arguments)> Calls { get; } = [];
        public bool IsConnected => true;
        public ConnectionState State => ConnectionState.Connected;
        public IReadOnlyList<string> ToolNames => ["job", "fetch_outputs", "set_workflow_slot", "validate_workflow"];
        public Task ConnectAsync(AppSettings settings, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task DisconnectAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<JsonNode?> CallAsync(string toolName, IReadOnlyDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
        {
            Calls.Add((toolName, arguments));
            return Task.FromResult(_handler(toolName, arguments));
        }

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class StubPortableStore : IPortableStore
    {
        public Task<AppSettings?> LoadSettingsAsync(CancellationToken cancellationToken = default) => Task.FromResult<AppSettings?>(null);
        public Task SaveSettingsAsync(AppSettings settings, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<IReadOnlyList<CreationSession>> LoadSessionsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CreationSession>>([]);
        public Task SaveSessionAsync(CreationSession session, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<LocalContextCatalog?> LoadLocalContextsAsync(CancellationToken cancellationToken = default) => Task.FromResult<LocalContextCatalog?>(null);
        public Task SaveLocalContextsAsync(LocalContextCatalog catalog, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<string> CreateWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string reason, CancellationToken cancellationToken = default) => Task.FromResult("backup");
        public Task<IReadOnlyList<string>> ListWorkflowBackupsAsync(WorkflowIdentity workflow, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<string>>([]);
        public Task RestoreWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string backupPath, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task LogAsync(string category, string message, Exception? exception = null, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
