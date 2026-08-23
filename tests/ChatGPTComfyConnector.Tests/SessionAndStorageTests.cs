using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Tests;

public sealed class SessionAndStorageTests
{
    [Fact]
    public void SessionPreservesIterationHistoryAndStopsAtLimit()
    {
        var session = new CreationSession { MaximumIterations = 2 };
        session.StartIteration("one", new Dictionary<string, JsonNode?> { ["prompt"] = "one" });
        session.StartIteration("two", new Dictionary<string, JsonNode?> { ["prompt"] = "two" });
        Assert.Equal(2, session.Iterations.Count);
        Assert.True(session.AtIterationLimit);
        Assert.Throws<InvalidOperationException>(() => session.StartIteration("three", new Dictionary<string, JsonNode?>()));
        session.Complete("looks good");
        Assert.Equal(SessionStatus.Completed, session.Status);
        session.Resume();
        Assert.Equal(SessionStatus.Active, session.Status);
        Assert.Equal(2, session.Iterations.Count);
    }

    [Fact]
    public async Task WorkflowBackupsRotateToThreeAndRestoreAtomically()
    {
        var temp = Path.Combine(Path.GetTempPath(), "connector-tests-" + Guid.NewGuid().ToString("N"));
        var workflowRoot = Path.Combine(temp, "workflows");
        Directory.CreateDirectory(workflowRoot);
        var file = Path.Combine(workflowRoot, "test.json");
        await File.WriteAllTextAsync(file, "{\"version\":1}");
        var store = new PortableStore(new PortableLayout(Path.Combine(temp, "portable")));
        var identity = WorkflowIdentity.Create("test.json");
        try
        {
            var first = await store.CreateWorkflowBackupAsync(identity, workflowRoot, "first");
            await File.WriteAllTextAsync(file, "{\"version\":2}");
            await store.CreateWorkflowBackupAsync(identity, workflowRoot, "second");
            await File.WriteAllTextAsync(file, "{\"version\":3}");
            await store.CreateWorkflowBackupAsync(identity, workflowRoot, "third");
            await File.WriteAllTextAsync(file, "{\"version\":4}");
            var retained = await store.CreateWorkflowBackupAsync(identity, workflowRoot, "fourth");
            var backups = await store.ListWorkflowBackupsAsync(identity);
            Assert.Equal(3, backups.Count);
            await store.RestoreWorkflowBackupAsync(identity, workflowRoot, retained);
            Assert.Contains("\"version\":4", await File.ReadAllTextAsync(file));
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
    }
}
