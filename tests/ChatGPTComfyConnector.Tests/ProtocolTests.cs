using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class ProtocolTests
{
    [Fact]
    public void ParsesRawAndFencedCommands()
    {
        var raw = ConnectorProtocol.Parse("{\"protocol\":\"comfy-connector/1\",\"action\":\"generate\",\"parameters\":{\"6.text\":\"rain\"}}");
        var fenced = ConnectorProtocol.Parse("```connector-command\n{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\",\"reason\":\"done\"}\n```");
        Assert.True(raw.IsValid);
        Assert.Equal("rain", raw.Command!.Parameters["6.text"]!.GetValue<string>());
        Assert.True(fenced.IsValid);
        Assert.Equal("complete", fenced.Command!.Action);
    }

    [Fact]
    public void RejectsUnknownActionsAndAbsoluteWorkflowPaths()
    {
        var result = ConnectorProtocol.Parse("{\"protocol\":\"comfy-connector/1\",\"action\":\"shell\",\"workflow\":\"C:\\\\secret.json\"}");
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("action", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Errors, error => error.Contains("絶対パス", StringComparison.Ordinal));
    }

    [Fact]
    public void RejectsParametersNotExposedByCurrentWorkflow()
    {
        var command = ConnectorProtocol.Parse("{\"protocol\":\"comfy-connector/1\",\"action\":\"generate\",\"parameters\":{\"6.text\":\"ok\",\"999.secret\":\"bad\"}}").Command!;
        var result = ConnectorProtocol.ValidateAgainstSlots(command, [new WorkflowSlot { Address = "6.text", Type = "STRING" }], WorkflowIdentity.Create("folder/test.json"));
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("999.secret", StringComparison.Ordinal));
    }

    [Fact]
    public void WorkflowIdentityCannotEscapeRoot()
    {
        Assert.Throws<ArgumentException>(() => WorkflowIdentity.Create("../outside.json"));
        Assert.Throws<ArgumentException>(() => WorkflowIdentity.Create("C:/outside.json"));
        var root = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var identity = WorkflowIdentity.Create("folder/test.json");
            Assert.StartsWith(root, identity.ToAbsolute(root), StringComparison.OrdinalIgnoreCase);
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public void RejectsNonStringCommandMetadataWithoutThrowing()
    {
        var result = ConnectorProtocol.Parse("""{"protocol":123,"action":"generate","parameters":{}}""");
        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("protocol", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ClassifiesImageAndVideoOutputs()
    {
        Assert.True(new OutputArtifact { FullPath = "C:\\output\\frame.png", Type = "png" }.IsImage);
        Assert.True(new OutputArtifact { FullPath = "C:\\output\\clip.mp4", Type = "mp4" }.IsVideo);
    }
}
