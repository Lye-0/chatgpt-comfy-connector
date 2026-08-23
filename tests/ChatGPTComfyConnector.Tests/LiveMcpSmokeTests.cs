using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Infrastructure.Mcp;
using ChatGPTComfyConnector.Infrastructure.Storage;

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
}
