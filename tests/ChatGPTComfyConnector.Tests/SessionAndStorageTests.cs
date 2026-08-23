using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Contexts;
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

    [Fact]
    public async Task LocalChatContextsAndHandoffTimelineRoundTrip()
    {
        var temp = Path.Combine(Path.GetTempPath(), "connector-context-tests-" + Guid.NewGuid().ToString("N"));
        var store = new PortableStore(new PortableLayout(temp));
        var chat = new LocalChatContext { DisplayName = "Direction Chat", ExternalId = null, Mode = ContextBindingMode.Local };
        var project = new LocalProjectContext { DisplayName = "Film Project", ExternalId = "future-project-id", Chats = [chat] };
        var catalog = new LocalContextCatalog { Projects = [project] };
        var session = new CreationSession
        {
            ProjectLabel = project.DisplayName,
            ChatLabel = chat.DisplayName,
            LocalProjectContextId = project.Id,
            LocalChatContextId = chat.Id,
            PendingHandoff = new PendingHandoffSnapshot
            {
                HandoffId = "handoff-1", SessionId = "session-1", BoundaryId = "boundary-1",
                WorkflowIdentity = "workflow.json", AllowedActions = ["generate"],
                Slots = [new HandoffSlotSnapshot { Address = "6.text", Type = "STRING", Transport = SlotValueTransport.Payload }],
            },
            HandoffMessages =
            [
                new HandoffMessage
                {
                    Direction = HandoffDirection.ComfyToChatGpt,
                    State = HandoffTransportState.Copied,
                    Title = "制作コンテキストを送信",
                    Summary = "bootstrap",
                    Payload = "payload",
                },
            ],
        };

        try
        {
            await store.SaveLocalContextsAsync(catalog);
            await store.SaveSessionAsync(session);

            var loadedCatalog = await store.LoadLocalContextsAsync();
            var loadedSession = Assert.Single(await store.LoadSessionsAsync(), item => item.Id == session.Id);
            var loadedProject = Assert.Single(loadedCatalog!.Projects);
            var loadedChat = Assert.Single(loadedProject.Chats);

            Assert.Equal("Film Project", loadedProject.DisplayName);
            Assert.Equal("future-project-id", loadedProject.ExternalId);
            Assert.Equal(ContextBindingMode.Local, loadedChat.Mode);
            Assert.Equal(chat.Id, loadedSession.LocalChatContextId);
            Assert.Equal(HandoffTransportState.Copied, Assert.Single(loadedSession.HandoffMessages).State);
            Assert.Equal("handoff-1", loadedSession.PendingHandoff!.HandoffId);
            Assert.Equal(SlotValueTransport.Payload, Assert.Single(loadedSession.PendingHandoff.Slots).Transport);
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
    }

    [Fact]
    public async Task LocalJsonProviderExposesProviderNeutralProjectAndChatOptions()
    {
        var temp = Path.Combine(Path.GetTempPath(), "connector-provider-tests-" + Guid.NewGuid().ToString("N"));
        var store = new PortableStore(new PortableLayout(temp));
        var provider = new LocalProjectChatProvider(store);
        try
        {
            var project = await provider.CreateProjectAsync("Film Project");
            var chat = await provider.CreateChatAsync(project, "Scene 01");

            var catalog = await provider.LoadAsync([]);
            var loadedProject = Assert.Single(catalog.Projects);
            var loadedChat = Assert.Single(loadedProject.Chats);

            Assert.Equal(ContextProviderIds.LocalJson, catalog.ProviderId);
            Assert.Equal(ContextProviderIds.LocalJson, loadedProject.ProviderId);
            Assert.Equal(project.Key, loadedProject.Key);
            Assert.Equal(loadedProject.Key, loadedChat.ProjectKey);
            Assert.Equal(chat.Key, loadedChat.Key);
            Assert.Equal("Scene 01", loadedChat.DisplayName);
        }
        finally { if (Directory.Exists(temp)) Directory.Delete(temp, true); }
    }

    [Fact]
    public void SessionBindingSupportsNonLocalProviderReferences()
    {
        var session = new CreationSession
        {
            BoundWorkflow = WorkflowIdentity.Create("test.json"),
            ContextProviderId = "browser-extension",
            ProjectContextKey = "project-42",
            ChatContextKey = "chat-7",
            ProjectLabel = "Remote Project",
            ChatLabel = "Scene 07",
            MaximumIterations = 10,
        };

        CreationPipelineStateMachine.BindContext(session);

        Assert.True(session.HasBoundProjectChat);
        Assert.Equal("browser-extension", session.EffectiveContextProviderId);
        Assert.Equal("project-42", session.EffectiveProjectContextKey);
        Assert.Equal(CreationStageState.Completed, CreationPipelineStateMachine.Get(session, CreationStage.Context).State);
    }
}
