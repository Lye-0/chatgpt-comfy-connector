using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Contexts;

namespace ChatGPTComfyConnector.Tests;

public sealed class ChatGptContextProviderTests
{
    [Fact]
    public async Task MapsProjectsProjectlessChatsAndNewConversationWithoutUsingTitlesAsIdentity()
    {
        var snapshot = new BrowserExtensionChatGptContextSnapshot(
            "context-request",
            "ok",
            [
                new BrowserExtensionChatGptProjectEntry(
                    "g-p-project-a",
                    "Project A",
                    "https://chatgpt.com/g/g-p-project-a/project"),
                new BrowserExtensionChatGptProjectEntry(
                    "g-p-project-b",
                    "Project B",
                    "https://chatgpt.com/g/g-p-project-b/project"),
            ],
            [
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-a",
                    "同じタイトル",
                    "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
                    "g-p-project-a",
                    "Project A"),
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-b",
                    "同じタイトル",
                    "https://chatgpt.com/g/g-p-project-b/c/conversation-b",
                    "g-p-project-b",
                    "Project B"),
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-free",
                    "Project外Chat",
                    "https://chatgpt.com/c/conversation-free"),
            ]);
        var provider = new ChatGptProjectChatProvider(new StubBridge(snapshot), new StubPortableStore());

        var catalog = await provider.LoadAsync([]);

        Assert.Equal(ContextProviderIds.ChatGptExtension, catalog.ProviderId);
        Assert.Equal(ProjectChatCatalogLoadState.Loaded, catalog.LoadState);
        Assert.Equal(3, catalog.Projects.Count);

        var projectA = Assert.Single(catalog.Projects, item => item.ExternalId == "g-p-project-a");
        var projectB = Assert.Single(catalog.Projects, item => item.ExternalId == "g-p-project-b");
        var noProject = Assert.Single(catalog.Projects, item => item.IsNoProject);
        Assert.Equal("https://chatgpt.com/g/g-p-project-a/project", projectA.Url);

        var chatA = Assert.Single(projectA.Chats, item => !item.IsNewConversation);
        var chatB = Assert.Single(projectB.Chats, item => !item.IsNewConversation);
        var freeChat = Assert.Single(noProject.Chats, item => !item.IsNewConversation);
        Assert.NotEqual(chatA.Key, chatB.Key);
        Assert.Equal("conversation-a", chatA.ExternalId);
        Assert.Equal("conversation-b", chatB.ExternalId);
        Assert.Equal("conversation-free", freeChat.ExternalId);
        Assert.Equal("https://chatgpt.com/c/conversation-free", freeChat.Url);
        Assert.All(catalog.Projects, project => Assert.Single(project.Chats, item => item.IsNewConversation));
    }

    [Fact]
    public async Task KeepsDisconnectedStateDistinctWhileOfferingSafeProjectlessNewChat()
    {
        var snapshot = new BrowserExtensionChatGptContextSnapshot(
            "context-request",
            "error",
            [],
            [],
            ErrorCode: "bridge_disconnected",
            Message: "Extension未接続",
            Stage: "bridge_connection");
        var provider = new ChatGptProjectChatProvider(new StubBridge(snapshot), new StubPortableStore());

        var catalog = await provider.LoadAsync([]);

        Assert.Equal(ProjectChatCatalogLoadState.Disconnected, catalog.LoadState);
        var project = Assert.Single(catalog.Projects);
        Assert.True(project.IsNoProject);
        var newConversation = Assert.Single(project.Chats);
        Assert.True(newConversation.IsNewConversation);
        Assert.Null(newConversation.ExternalId);
    }

    [Fact]
    public async Task KeepsVisibleProjectWithoutPublicIdForDisplayWithoutInventingIdentity()
    {
        var snapshot = new BrowserExtensionChatGptContextSnapshot(
            "context-request",
            "ok",
            [new BrowserExtensionChatGptProjectEntry(
                null,
                "Visible Project",
                DiscoveryKey: "project-visible-01")],
            []);
        var provider = new ChatGptProjectChatProvider(new StubBridge(snapshot), new StubPortableStore());

        var catalog = await provider.LoadAsync([]);

        var visibleProject = Assert.Single(catalog.Projects, item => item.DisplayName == "Visible Project");
        Assert.Null(visibleProject.ExternalId);
        Assert.Equal("project-visible-01", visibleProject.Key);
        Assert.Empty(visibleProject.Chats);
        Assert.DoesNotContain(catalog.Projects, item => item.DisplayName.StartsWith("Project (", StringComparison.Ordinal));
    }

    [Fact]
    public async Task MergesProjectsAndConversationsByExternalIdAndReparentsProjectlessDuplicate()
    {
        var snapshot = new BrowserExtensionChatGptContextSnapshot(
            "context-request",
            "ok",
            [
                new BrowserExtensionChatGptProjectEntry(
                    null,
                    "Project (g-p-project-a)",
                    DiscoveryKey: "project-a-visible"),
                new BrowserExtensionChatGptProjectEntry(
                    "g-p-project-a",
                    "Project A",
                    "https://chatgpt.com/g/g-p-project-a/project"),
                new BrowserExtensionChatGptProjectEntry(
                    "g-p-project-b",
                    "Project B",
                    "https://chatgpt.com/g/g-p-project-b/project"),
            ],
            [
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-a",
                    "Chat A",
                    "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
                    "g-p-project-a",
                    "Project A"),
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-a",
                    "Chat A (duplicate)",
                    "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
                    "g-p-project-a",
                    "Project A"),
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-free-first",
                    "Projectless first",
                    "https://chatgpt.com/g/g-p-project-a/c/conversation-free-first"),
                new BrowserExtensionChatGptConversationEntry(
                    "conversation-free-first",
                    "Projectless first",
                    "https://chatgpt.com/g/g-p-project-a/c/conversation-free-first",
                    "g-p-project-a",
                    "Project A"),
            ]);
        var provider = new ChatGptProjectChatProvider(new StubBridge(snapshot), new StubPortableStore());

        var catalog = await provider.LoadAsync([]);

        var projectA = Assert.Single(catalog.Projects, item => item.ExternalId == "g-p-project-a");
        Assert.Equal("Project A", projectA.DisplayName);
        Assert.DoesNotContain(catalog.Projects, item => item.DisplayName.StartsWith("Project (", StringComparison.Ordinal));
        Assert.Equal(2, projectA.Chats.Count(item => !item.IsNewConversation));
        Assert.Single(projectA.Chats, item => item.ExternalId == "conversation-a");
        Assert.Single(projectA.Chats, item => item.ExternalId == "conversation-free-first");
        var noProject = Assert.Single(catalog.Projects, item => item.IsNoProject);
        Assert.DoesNotContain(noProject.Chats, item => item.ExternalId == "conversation-free-first");
    }

    [Fact]
    public async Task ReferencedFallbackBindingMergesIntoDiscoveredProjectWithoutGhost()
    {
        var snapshot = new BrowserExtensionChatGptContextSnapshot(
            "context-request",
            "ok",
            [new BrowserExtensionChatGptProjectEntry(
                "g-p-project-a",
                "Project A",
                "https://chatgpt.com/g/g-p-project-a/project")],
            []);
        var binding = new ProjectChatBindingSnapshot
        {
            ProviderId = ContextProviderIds.ChatGptExtension,
            ProjectKey = "g-p-project-a",
            ProjectExternalId = "g-p-project-a",
            ProjectExternalUrl = "https://chatgpt.com/g/g-p-project-a/project",
            ProjectLabel = "Project (g-p-project-a)",
            ChatKey = "conversation-a",
            ChatExternalId = "conversation-a",
            ChatExternalUrl = "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
            ChatLabel = "Chat A",
        };
        var provider = new ChatGptProjectChatProvider(new StubBridge(snapshot), new StubPortableStore());

        var catalog = await provider.LoadAsync([binding]);

        var project = Assert.Single(catalog.Projects, item => item.ExternalId == "g-p-project-a");
        Assert.Equal("Project A", project.DisplayName);
        Assert.Single(project.Chats, item => item.ExternalId == "conversation-a");
        Assert.DoesNotContain(catalog.Projects, item => item.DisplayName.Contains("g-p-project-a", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void SessionBindingRetainsExternalIdentityAndUrls()
    {
        var session = new CreationSession
        {
            ContextProviderId = ContextProviderIds.ChatGptExtension,
            ProjectContextKey = "g-p-project-a",
            ChatContextKey = "conversation-a",
            ProjectId = "g-p-project-a",
            ConversationId = "conversation-a",
            ProjectUrl = "https://chatgpt.com/g/g-p-project-a/project",
            ConversationUrl = "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
            ProjectLabel = "Project A",
            ChatLabel = "同じタイトル",
        };

        var binding = session.ToProjectChatBindingSnapshot();

        Assert.Equal(ContextProviderIds.ChatGptExtension, binding.ProviderId);
        Assert.Equal("g-p-project-a", binding.ProjectExternalId);
        Assert.Equal("conversation-a", binding.ChatExternalId);
        Assert.Equal(session.ProjectUrl, binding.ProjectExternalUrl);
        Assert.Equal(session.ConversationUrl, binding.ChatExternalUrl);
    }

    [Fact]
    public async Task SavesLiveMetadataSnapshotAndRestoresItWhenTheExtensionIsUnavailable()
    {
        var store = new StubPortableStore();
        var liveSnapshot = new BrowserExtensionChatGptContextSnapshot(
            "live-request",
            "ok",
            [new BrowserExtensionChatGptProjectEntry(
                "g-p-cached",
                "Cached Project",
                "https://chatgpt.com/g/g-p-cached/project")],
            [new BrowserExtensionChatGptConversationEntry(
                "conversation-cached",
                "Cached Chat",
                "https://chatgpt.com/g/g-p-cached/c/conversation-cached",
                "g-p-cached",
                "Cached Project")]);

        var liveProvider = new ChatGptProjectChatProvider(new StubBridge(liveSnapshot), store);
        await liveProvider.LoadAsync([]);

        Assert.NotNull(store.Cache);
        Assert.Equal("g-p-cached", store.Cache!.Projects.Single().ProjectId);
        Assert.Equal("conversation-cached", store.Cache.Conversations.Single().ConversationId);

        var offlineProvider = new ChatGptProjectChatProvider(new StubBridge(
            new BrowserExtensionChatGptContextSnapshot(
                "offline-request",
                "error",
                [],
                [],
                ErrorCode: "bridge_disconnected",
                Message: "Extension未接続",
                Stage: "bridge_connection")), store);
        var restored = await offlineProvider.LoadAsync([]);

        Assert.Equal(ProjectChatCatalogLoadState.Loaded, restored.LoadState);
        var project = Assert.Single(restored.Projects, item => item.ExternalId == "g-p-cached");
        Assert.Single(project.Chats, item => item.ExternalId == "conversation-cached");
    }

    [Fact]
    public async Task LoadsCachedCatalogBeforeFreshDiscoveryCanReplaceIt()
    {
        var store = new StubPortableStore
        {
            Cache = new BrowserExtensionChatGptContextCache(
                [new BrowserExtensionChatGptProjectEntry(
                    "g-p-old",
                    "Old Project",
                    "https://chatgpt.com/g/g-p-old/project")],
                [new BrowserExtensionChatGptConversationEntry(
                    "conversation-old",
                    "Old Chat",
                    "https://chatgpt.com/g/g-p-old/c/conversation-old",
                    "g-p-old",
                    "Old Project")],
                DateTimeOffset.UtcNow)
        };
        var provider = new ChatGptProjectChatProvider(
            new StubBridge(new BrowserExtensionChatGptContextSnapshot("fresh", "ok", [], [])), store);

        var cached = await ((IProjectChatCacheProvider)provider).LoadCachedAsync([]);

        Assert.NotNull(cached);
        Assert.Single(cached!.Projects, item => item.ExternalId == "g-p-old");
        Assert.Single(cached.Projects.Single(item => item.ExternalId == "g-p-old").Chats,
            item => item.ExternalId == "conversation-old");
    }

    [Fact]
    public async Task TreatsEmptyLiveProjectDiscoveryAsIncompleteAndKeepsKnownCache()
    {
        var store = new StubPortableStore
        {
            Cache = new BrowserExtensionChatGptContextCache(
                [new BrowserExtensionChatGptProjectEntry(
                    "g-p-known",
                    "Known Project",
                    "https://chatgpt.com/g/g-p-known/project")],
                [new BrowserExtensionChatGptConversationEntry(
                    "conversation-known",
                    "Known Chat",
                    "https://chatgpt.com/g/g-p-known/c/conversation-known",
                    "g-p-known",
                    "Known Project")],
                DateTimeOffset.UtcNow)
        };
        var provider = new ChatGptProjectChatProvider(
            new StubBridge(new BrowserExtensionChatGptContextSnapshot(
                "empty-live",
                "ok",
                [],
                [],
                new BrowserExtensionChatGptCurrentContext(
                    ProjectId: "g-p-known"))),
            store);

        var catalog = await provider.LoadAsync([]);

        Assert.Equal(ProjectChatCatalogLoadState.Error, catalog.LoadState);
        Assert.Equal("context_projects_incomplete", catalog.ErrorCode);
        var project = Assert.Single(catalog.Projects, item => item.ExternalId == "g-p-known");
        Assert.Single(project.Chats, item => item.ExternalId == "conversation-known");
        Assert.Equal("g-p-known", store.Cache!.Projects.Single().ProjectId);
    }

    private sealed class StubBridge(BrowserExtensionChatGptContextSnapshot snapshot) : IBrowserExtensionBridge
    {
        public BrowserExtensionBridgeStatus Status => new(
            false,
            BrowserExtensionConnectionState.Disconnected,
            BrowserExtensionPairingState.Paired,
            "127.0.0.1",
            43127,
            null,
            null,
            null,
            DateTimeOffset.UtcNow);

        public event EventHandler<BrowserExtensionBridgeStatusChangedEventArgs>? StatusChanged { add { } remove { } }
        public event EventHandler<BrowserExtensionBridgeDiagnosticEventArgs>? Diagnostic { add { } remove { } }
        public event EventHandler<BrowserExtensionAssistantResponseEventArgs>? AssistantResponseReceived { add { } remove { } }
        public event EventHandler<BrowserExtensionChatGptContextChangedEventArgs>? ChatGptContextChanged { add { } remove { } }

        public Task StartAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task StopAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<bool> SendEventAsync(BrowserExtensionBridgeEvent bridgeEvent, CancellationToken cancellationToken = default)
            => Task.FromResult(false);
        public Task<BrowserExtensionHandoffSendResult> SendHandoffAsync(BrowserExtensionHandoffSendRequest request, CancellationToken cancellationToken = default)
            => Task.FromException<BrowserExtensionHandoffSendResult>(new NotSupportedException());
        public void RegisterMedia(BrowserExtensionMediaRegistration registration) { }
        public bool RevokeMedia(string mediaId) => false;
        public Task<BrowserExtensionMediaAttachResult> SendMediaAttachAsync(BrowserExtensionMediaAttachRequest request, CancellationToken cancellationToken = default)
            => Task.FromException<BrowserExtensionMediaAttachResult>(new NotSupportedException());
        public Task<BrowserExtensionChatGptContextSnapshot> GetChatGptContextAsync(bool currentOnly = false, CancellationToken cancellationToken = default)
            => Task.FromResult(snapshot);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class StubPortableStore : IPortableStore, IChatGptContextCacheStore
    {
        public BrowserExtensionChatGptContextCache? Cache { get; set; }
        public Task<AppSettings?> LoadSettingsAsync(CancellationToken cancellationToken = default) => Task.FromResult<AppSettings?>(null);
        public Task SaveSettingsAsync(AppSettings settings, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<IReadOnlyList<CreationSession>> LoadSessionsAsync(CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<CreationSession>>([]);
        public Task SaveSessionAsync(CreationSession session, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<LocalContextCatalog?> LoadLocalContextsAsync(CancellationToken cancellationToken = default) => Task.FromResult<LocalContextCatalog?>(null);
        public Task SaveLocalContextsAsync(LocalContextCatalog catalog, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task<BrowserExtensionChatGptContextCache?> LoadChatGptContextCacheAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(Cache);
        public Task SaveChatGptContextCacheAsync(BrowserExtensionChatGptContextCache cache, CancellationToken cancellationToken = default)
        {
            Cache = cache;
            return Task.CompletedTask;
        }
        public Task<string> CreateWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string reason, CancellationToken cancellationToken = default) => Task.FromResult("backup");
        public Task<IReadOnlyList<string>> ListWorkflowBackupsAsync(WorkflowIdentity workflow, CancellationToken cancellationToken = default) => Task.FromResult<IReadOnlyList<string>>([]);
        public Task RestoreWorkflowBackupAsync(WorkflowIdentity workflow, string workflowRoot, string backupPath, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task LogAsync(string category, string message, Exception? exception = null, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
