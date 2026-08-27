using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Mcp;
using ChatGPTComfyConnector.Infrastructure.Storage;
using ChatGPTComfyConnector.Infrastructure.Workflows;

namespace ChatGPTComfyConnector.Tests;

public sealed class LiveMcpSmokeTests
{
    [Fact]
    public async Task ConnectsToConfiguredComfyMcpWhenExplicitlyEnabled()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_LIVE_MCP"), "1", StringComparison.Ordinal)) return;
        var temp = Path.Combine(Path.GetTempPath(), "connector-live-" + Guid.NewGuid().ToString("N"));
        var store = new PortableStore(new PortableLayout(temp));
        await using var client = new ComfyMcpClient(store);
        try
        {
            var settings = new AppSettings
            {
                PortableRoot = "C:\\AI\\ComfyUI_windows_portable",
                ComfyMcpPath = "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy-mcp.exe",
                ComfyCliPath = "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy.exe",
                Endpoint = "http://127.0.0.1:8188",
            };
            await client.ConnectAsync(settings);
            Assert.True(client.IsConnected);
            Assert.Contains("server_info", client.ToolNames);
            var info = await client.CallAsync("server_info", new Dictionary<string, object?>());
            Assert.NotNull(info);
        }
        finally
        {
            await client.DisconnectAsync();
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
        }
    }

    [Fact]
    public async Task ClassifiesRealH3SlotsWithoutExposingInternalControlsWhenExplicitlyEnabled()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_LIVE_MCP"), "1", StringComparison.Ordinal)) return;
        var temp = Path.Combine(Path.GetTempPath(), "connector-live-" + Guid.NewGuid().ToString("N"));
        var store = new PortableStore(new PortableLayout(temp));
        await using var client = new ComfyMcpClient(store);
        try
        {
            var settings = new AppSettings
            {
                PortableRoot = "C:\\AI\\ComfyUI_windows_portable",
                ComfyMcpPath = "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy-mcp.exe",
                ComfyCliPath = "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy.exe",
                Endpoint = "http://127.0.0.1:8188",
            };
            await client.ConnectAsync(settings);
            var catalog = new WorkflowCatalog(client, store);
            var workflow = WorkflowIdentity.Create("MiniMaxH3_NVFP4_AWQ/text→video_MCPテスト.json");
            var slots = await catalog.DiscoverSlotsAsync(workflow, Path.Combine(settings.PortableRoot, "ComfyUI", "user", "default", "workflows"));
            var snapshots = slots.Select(ChatGptSlotPolicy.CreateSnapshot).ToArray();

            Assert.NotEmpty(snapshots);
            Assert.Contains(snapshots, slot => slot.IsWritableByChatGpt && slot.Label.Contains("prompt", StringComparison.OrdinalIgnoreCase));
            Assert.All(snapshots.Where(slot => slot.Label.Contains("filename", StringComparison.OrdinalIgnoreCase)
                                                   || slot.Label.Contains("unet", StringComparison.OrdinalIgnoreCase)
                                                   || slot.Label.Contains("vae", StringComparison.OrdinalIgnoreCase)
                                                   || slot.Label.Contains("clip", StringComparison.OrdinalIgnoreCase)
                                                   || slot.Label.Contains("expression", StringComparison.OrdinalIgnoreCase)),
                slot => Assert.False(slot.IsWritableByChatGpt));
            Assert.All(snapshots.Where(slot => slot.Kind == WorkflowSlotType.Enum && slot.Choices is not { Count: > 0 }),
                slot => Assert.False(slot.IsWritableByChatGpt));

            foreach (var slot in snapshots)
                Console.WriteLine($"{slot.Address} | {slot.Label} | {slot.Type} | {slot.Exposure} | choices={slot.Choices?.Count ?? 0} | {slot.PolicyReason}");
        }
        finally
        {
            await client.DisconnectAsync();
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
        }
    }
}
