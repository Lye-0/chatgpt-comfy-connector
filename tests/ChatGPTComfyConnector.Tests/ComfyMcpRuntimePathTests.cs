using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Mcp;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Tests;

public sealed class ComfyMcpRuntimePathTests : IDisposable
{
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "connector-mcp-paths-" + Guid.NewGuid().ToString("N"));

    [Theory]
    [InlineData("directory")]
    [InlineData("trailing-separator")]
    [InlineData("executable")]
    public void UsesBothExecutablesFromTheSelectedRuntime(string inputKind)
    {
        var runtime = Path.Combine(_temp, "日本語 runtime");
        var mcp = CreateFile(Path.Combine(runtime, ".venv", "Scripts", "comfy-mcp.exe"));
        var cli = CreateFile(Path.Combine(runtime, ".venv", "Scripts", "comfy.exe"));
        var input = inputKind switch
        {
            "executable" => mcp,
            "trailing-separator" => runtime + Path.DirectorySeparatorChar,
            _ => runtime,
        };

        var paths = ComfyMcpRuntimePaths.Resolve(input);

        Assert.Equal(mcp, paths.McpExecutablePath);
        Assert.Equal(cli, paths.CliExecutablePath);
    }

    [Fact]
    public void ADirectoryContainingOnlyTheCliIsRejected()
    {
        var runtime = Path.Combine(_temp, "cli-only");
        CreateFile(Path.Combine(runtime, ".venv", "Scripts", "comfy.exe"));

        var exception = Assert.Throws<InvalidOperationException>(() => ComfyMcpRuntimePaths.Resolve(runtime));

        Assert.Equal("comfy-mcp.exeが存在しません。", exception.Message);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task MissingSiblingCliRejectsConnectionEvenWhenLegacyCliWasConfigured(bool legacyCliExists)
    {
        var mcp = CreateFile(Path.Combine(_temp, "selected-runtime", "comfy-mcp.exe"));
        var legacyCli = Path.Combine(_temp, "previous-runtime", "comfy.exe");
        if (legacyCliExists) CreateFile(legacyCli);
        var store = new PortableStore(new PortableLayout(Path.Combine(_temp, "connector")));
        await using var client = new ComfyMcpClient(store);

        var exception = await Assert.ThrowsAsync<InvalidOperationException>(() => client.ConnectAsync(new AppSettings
        {
            PortableRoot = _temp,
            ComfyMcpPath = mcp,
            ComfyCliPath = legacyCli,
        }));

        Assert.Contains("同じフォルダーにcomfy.exeが存在しません", exception.Message, StringComparison.Ordinal);
        Assert.Equal(ConnectionState.Error, client.State);
        Assert.False(client.IsConnected);
        Assert.Empty(client.ToolNames);
    }

    [Fact]
    public async Task ListsRealSlotsDespiteAStaleSavedCliPathWhenExplicitlyEnabled()
    {
        if (Environment.GetEnvironmentVariable("RUN_LIVE_MCP_PATHS") != "1") return;
        var mcpPath = RequireEnvironment("LIVE_MCP_PATH");
        var portableRoot = RequireEnvironment("LIVE_COMFY_PORTABLE_ROOT");
        var workflowPath = RequireEnvironment("LIVE_MCP_WORKFLOW_PATH");
        var store = new PortableStore(new PortableLayout(Path.Combine(_temp, "connector")));
        await using var client = new ComfyMcpClient(store);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var settings = new AppSettings
        {
            PortableRoot = portableRoot,
            ComfyMcpPath = mcpPath,
            ComfyCliPath = Path.Combine(_temp, "previous-runtime", "comfy.exe"),
        };

        await client.ConnectAsync(settings, timeout.Token);
        var result = await client.CallAsync("list_workflow_slots",
            new Dictionary<string, object?> { ["workflow_path"] = workflowPath }, timeout.Token);

        Assert.True(client.IsConnected);
        var slots = result is JsonObject obj ? obj["slots"] as JsonArray : result as JsonArray;
        Assert.NotNull(slots);
        Assert.NotEmpty(slots);
        Console.WriteLine($"Read-only live MCP regression: {slots.Count} slots retrieved with a stale saved CLI path.");
    }

    private static string RequireEnvironment(string name)
        => Environment.GetEnvironmentVariable(name) is { Length: > 0 } value
            ? value : throw new InvalidOperationException($"Live MCP path test requires {name}.");

    private static string CreateFile(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, "Fixture: not an executable; must never be started.");
        return path;
    }

    public void Dispose()
    {
        if (Directory.Exists(_temp)) Directory.Delete(_temp, recursive: true);
    }
}
