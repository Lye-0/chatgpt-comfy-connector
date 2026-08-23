using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Infrastructure.Mcp;
using ChatGPTComfyConnector.Infrastructure.Storage;
using ChatGPTComfyConnector.Infrastructure.Workflows;

namespace ChatGPTComfyConnector.Tests;

public sealed class LiveWorkflowSmokeTests
{
    [Fact]
    public async Task InspectsConfiguredH3WorkflowWhenExplicitlyEnabled()
    {
        if (!string.Equals(Environment.GetEnvironmentVariable("RUN_LIVE_WORKFLOW"), "1", StringComparison.Ordinal)) return;
        var temp = Path.Combine(Path.GetTempPath(), "connector-workflow-live-" + Guid.NewGuid().ToString("N"));
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
            var info = await client.CallAsync("server_info", new Dictionary<string, object?>());
            var root = Path.Combine(settings.PortableRoot, "ComfyUI", "user", "default", "workflows");
            var identity = WorkflowIdentity.Create("MiniMaxH3_NVFP4_AWQ/text→video_MCPテスト.json");
            var catalog = new WorkflowCatalog(client, store);
            var slots = await catalog.DiscoverSlotsAsync(identity, root);
            Assert.NotEmpty(slots);
            Console.WriteLine($"H3 slots: {slots.Count}; ComfyUI running={info?["running"]}");

            var safeSlot = slots.FirstOrDefault(slot => !slot.PairingSuspect && slot.CurrentValue is not null);
            Assert.NotNull(safeSlot);
            var backup = await store.CreateWorkflowBackupAsync(identity, root, "live-before-inspection");
            try
            {
                if (info?["running"]?.GetValue<bool>() == true)
                {
                    await catalog.ApplySlotsAsync(identity, root, new Dictionary<string, JsonNode?> { [safeSlot!.Address] = safeSlot.CurrentValue!.DeepClone() });
                }
                else
                {
                    Console.WriteLine("ComfyUI is stopped; slot read and backup were verified, live validate/run was not attempted.");
                }
            }
            finally
            {
                await store.RestoreWorkflowBackupAsync(identity, root, backup);
            }
        }
        finally
        {
            await client.DisconnectAsync();
            if (Directory.Exists(temp)) Directory.Delete(temp, true);
        }
    }
}
