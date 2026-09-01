using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Contexts;

/// <summary>
/// Metadata-only Project/Conversation catalog supplied by the authenticated
/// Browser Extension.  ChatGPT does not expose a supported public catalog API
/// for this feature, so the provider deliberately delegates discovery to the
/// Content Script and keeps the Desktop side free of DOM knowledge.
/// </summary>
public sealed class ChatGptProjectChatProvider : IProjectChatProvider, IProjectChatCacheProvider
{
    public const string NoProjectKey = "__chatgpt_no_project__";
    public const string NewConversationKey = "__chatgpt_new_conversation__";

    private const string ChatGptRootUrl = "https://chatgpt.com/";
    private readonly IBrowserExtensionBridge _bridge;
    private readonly LocalProjectChatProvider _legacyLocalProvider;
    private readonly IChatGptContextCacheStore? _cacheStore;

    public ChatGptProjectChatProvider(
        IBrowserExtensionBridge bridge,
        IPortableStore store)
    {
        _bridge = bridge;
        _legacyLocalProvider = new LocalProjectChatProvider(store);
        _cacheStore = store as IChatGptContextCacheStore;
    }

    public string ProviderId => ContextProviderIds.ChatGptExtension;

    public async Task<ProjectChatCatalog> LoadAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default)
    {
        var snapshot = await LoadLiveSnapshotAsync(cancellationToken);
        if (snapshot.IsSuccess)
        {
            await SaveCacheIfAvailableAsync(snapshot, cancellationToken);
        }
        else
        {
            var cached = await LoadCachedSnapshotAsync(cancellationToken);
            if (cached is not null)
            {
                // A stale metadata snapshot is still safe to display and is
                // preferable to erasing the user's selections while the
                // Extension is disconnected. The next successful refresh
                // replaces it with the complete Collector result.
                return await BuildCatalogAsync(ToSnapshot(cached), existingBindings, cancellationToken);
            }
        }

        return await BuildCatalogAsync(snapshot, existingBindings, cancellationToken);
    }

    public async Task<ProjectChatCatalog?> LoadCachedAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default)
    {
        var cached = await LoadCachedSnapshotAsync(cancellationToken);
        return cached is null
            ? null
            : await BuildCatalogAsync(ToSnapshot(cached), existingBindings, cancellationToken);
    }

    private async Task<BrowserExtensionChatGptContextSnapshot> LoadLiveSnapshotAsync(
        CancellationToken cancellationToken)
    {
        try
        {
            return await _bridge.GetChatGptContextAsync(cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new(
                Guid.NewGuid().ToString("N"),
                "error",
                [],
                [],
                ErrorCode: "context_discovery_failed",
                Message: ex.Message,
                Stage: "context_discovery");
        }
    }

    private async Task SaveCacheIfAvailableAsync(
        BrowserExtensionChatGptContextSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        if (_cacheStore is null) return;
        try
        {
            await _cacheStore.SaveChatGptContextCacheAsync(
                new BrowserExtensionChatGptContextCache(
                    snapshot.Projects.ToArray(),
                    snapshot.Conversations.ToArray(),
                    DateTimeOffset.UtcNow),
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            // Cache persistence is best effort; a live discovery must not be
            // reported as failed because a local cache write was unavailable.
        }
    }

    private async Task<BrowserExtensionChatGptContextCache?> LoadCachedSnapshotAsync(
        CancellationToken cancellationToken)
    {
        if (_cacheStore is null) return null;
        try
        {
            return await _cacheStore.LoadChatGptContextCacheAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            return null;
        }
    }

    private static BrowserExtensionChatGptContextSnapshot ToSnapshot(
        BrowserExtensionChatGptContextCache cache)
        => new(
            "cached",
            "ok",
            cache.Projects,
            cache.Conversations,
            Current: null,
            Stage: "context_cache_loaded");

    private async Task<ProjectChatCatalog> BuildCatalogAsync(
        BrowserExtensionChatGptContextSnapshot snapshot,
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken)
    {

        var catalog = new ProjectChatCatalog
        {
            ProviderId = ProviderId,
            LoadState = snapshot.IsSuccess
                ? snapshot.Projects.Count == 0 && snapshot.Conversations.Count == 0
                    ? ProjectChatCatalogLoadState.Empty
                    : ProjectChatCatalogLoadState.Loaded
                : string.Equals(snapshot.ErrorCode, "bridge_disconnected", StringComparison.Ordinal)
                    ? ProjectChatCatalogLoadState.Disconnected
                    : ProjectChatCatalogLoadState.Error,
            ErrorCode = snapshot.ErrorCode,
            ErrorMessage = snapshot.Message,
        };

        var projectById = new Dictionary<string, ProjectContextOption>(StringComparer.OrdinalIgnoreCase);
        var projectByKey = new Dictionary<string, ProjectContextOption>(StringComparer.OrdinalIgnoreCase);
        var sequence = 0;
        foreach (var project in snapshot.Projects)
        {
            var identityKey = project.ProjectId ?? project.DiscoveryKey;
            if (string.IsNullOrWhiteSpace(identityKey)) continue;

            ProjectContextOption? option = null;
            if (!string.IsNullOrWhiteSpace(project.ProjectId))
                projectById.TryGetValue(project.ProjectId, out option);
            if (option is null && projectByKey.TryGetValue(identityKey, out var keyedOption)) option = keyedOption;
            if (option is null && !string.IsNullOrWhiteSpace(project.ProjectId))
            {
                // A title-only row may have been emitted before the current
                // route exposed its Project ID. Merge that unresolved display
                // row only when it has no identity of its own.
                option = catalog.Projects.FirstOrDefault(item =>
                    !item.IsNoProject
                    && item.ExternalId is null
                    && (string.Equals(item.DisplayName, project.Title, StringComparison.Ordinal)
                        || string.Equals(FallbackProjectId(item.DisplayName), project.ProjectId, StringComparison.OrdinalIgnoreCase)));
            }

            if (option is null)
            {
                option = ToProjectOption(project, sequence++);
                catalog.Projects.Add(option);
            }
            MergeProjectOption(option, project);
            projectByKey[identityKey] = option;
            if (!string.IsNullOrWhiteSpace(option.ExternalId)) projectById[option.ExternalId] = option;
            if (!string.IsNullOrWhiteSpace(project.ProjectId)) projectById[project.ProjectId] = option;
        }

        var noProject = new ProjectContextOption
        {
            ProviderId = ProviderId,
            Key = NoProjectKey,
            DisplayName = "Projectなし",
            Url = ChatGptRootUrl,
            Mode = ContextBindingMode.External,
            ExternalId = null,
            IsNoProject = true,
            CreatedAt = DateTimeOffset.UtcNow.AddTicks(sequence++),
        };
        projectById[string.Empty] = noProject;

        var conversationById = new Dictionary<string, ChatContextOption>(StringComparer.OrdinalIgnoreCase);
        foreach (var conversation in snapshot.Conversations)
        {
            if (string.IsNullOrWhiteSpace(conversation.ConversationId)
                || string.IsNullOrWhiteSpace(conversation.Url)) continue;

            var project = conversation.ProjectId is { Length: > 0 } projectId
                && projectById.TryGetValue(projectId, out var knownProject)
                ? knownProject
                : noProject;
            if (conversation.ProjectId is { Length: > 0 } unknownProjectId && project == noProject)
            {
                project = new ProjectContextOption
                {
                    ProviderId = ProviderId,
                    Key = unknownProjectId,
                    DisplayName = string.IsNullOrWhiteSpace(conversation.ProjectTitle)
                        ? "Project名未取得"
                        : conversation.ProjectTitle,
                    ExternalId = unknownProjectId,
                    Url = ProjectUrlFromConversationUrl(conversation.Url, unknownProjectId),
                    Mode = ContextBindingMode.External,
                    CreatedAt = DateTimeOffset.UtcNow.AddTicks(sequence++),
                };
                projectById[unknownProjectId] = project;
                catalog.Projects.Add(project);
            }

            if (conversationById.TryGetValue(conversation.ConversationId, out var existingChat))
            {
                // A projectless link can be rendered before ChatGPT exposes
                // its project relation. If a later metadata path provides a
                // real Project ID, move the already-deduplicated chat to that
                // Project instead of leaving a second copy under Projectなし.
                if (!project.IsNoProject
                    && !string.Equals(existingChat.ProjectKey, project.Key, StringComparison.OrdinalIgnoreCase))
                {
                    var previousProject = string.Equals(existingChat.ProjectKey, noProject.Key, StringComparison.OrdinalIgnoreCase)
                        ? noProject
                        : catalog.Projects.FirstOrDefault(item =>
                            string.Equals(item.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase)
                            && string.Equals(item.Key, existingChat.ProjectKey, StringComparison.OrdinalIgnoreCase));
                    if (previousProject?.IsNoProject == true)
                    {
                        previousProject.Chats.Remove(existingChat);
                        existingChat.ProjectKey = project.Key;
                        project.Chats.Add(existingChat);
                    }
                }
                MergeChatOption(existingChat, conversation);
                continue;
            }

            var chat = ToChatOption(project, conversation, sequence++);
            project.Chats.Add(chat);
            conversationById[conversation.ConversationId] = chat;
        }

        // Keep Projectなし visible even when the current sidebar snapshot has
        // no non-project conversations.  It is the stable target for a new
        // Chat and also lets an empty/disconnected catalog remain selectable
        // without inventing a local Project.
        catalog.Projects.Add(noProject);

        foreach (var project in catalog.Projects)
        {
            // A new conversation is a navigation/send target, not a request
            // to create or rename anything in ChatGPT's UI.
            if (project.IsNewConversationTargetResolvable)
                project.Chats.Add(CreateNewConversationOption(project));
        }

        await MergeLegacyBindingsAsync(catalog, existingBindings, cancellationToken);
        EnsureReferencedExternalBindings(catalog, existingBindings);
        return catalog;
    }

    public Task<ProjectContextOption> CreateProjectAsync(
        string displayName,
        CancellationToken cancellationToken = default)
        => throw new InvalidOperationException("ChatGPT Projectの作成はDesktopの範囲外です。ChatGPT Webで作成後、更新してください。");

    public Task<ChatContextOption> CreateChatAsync(
        ProjectContextOption project,
        string displayName,
        CancellationToken cancellationToken = default)
        => throw new InvalidOperationException("ChatGPT Chatの作成はDesktopの範囲外です。「新しいChat」を選択して制作を開始してください。");

    private async Task MergeLegacyBindingsAsync(
        ProjectChatCatalog catalog,
        IReadOnlyCollection<ProjectChatBindingSnapshot> bindings,
        CancellationToken cancellationToken)
    {
        var localBindings = bindings
            .Where(binding => string.Equals(binding.ProviderId, ContextProviderIds.LocalJson, StringComparison.OrdinalIgnoreCase))
            .ToArray();
        if (localBindings.Length == 0) return;

        var localCatalog = await _legacyLocalProvider.LoadAsync(localBindings, cancellationToken);
        foreach (var project in localCatalog.Projects)
        {
            if (catalog.Projects.Any(item => string.Equals(item.ProviderId, project.ProviderId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(item.Key, project.Key, StringComparison.OrdinalIgnoreCase))) continue;
            catalog.Projects.Add(project);
        }
    }

    private void EnsureReferencedExternalBindings(
        ProjectChatCatalog catalog,
        IReadOnlyCollection<ProjectChatBindingSnapshot> bindings)
    {
        foreach (var binding in bindings.Where(item => string.Equals(item.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase)))
        {
            var projectKey = binding.ProjectKey
                ?? binding.ProjectExternalId
                ?? NoProjectKey;
            var project = catalog.Projects.FirstOrDefault(item => string.Equals(item.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase)
                && (string.Equals(item.Key, projectKey, StringComparison.OrdinalIgnoreCase)
                    || binding.ProjectExternalId is not null && string.Equals(item.ExternalId, binding.ProjectExternalId, StringComparison.OrdinalIgnoreCase)));
            if (project is null)
            {
                project = new ProjectContextOption
                {
                    ProviderId = ProviderId,
                    Key = projectKey,
                    DisplayName = IsFallbackProjectLabel(binding.ProjectLabel)
                        ? "Project名未取得"
                        : string.IsNullOrWhiteSpace(binding.ProjectLabel) ? "Projectなし" : binding.ProjectLabel,
                    ExternalId = binding.ProjectExternalId,
                    Url = binding.ProjectExternalId is null ? ChatGptRootUrl : binding.ProjectExternalUrl,
                    Mode = ContextBindingMode.External,
                    IsNoProject = binding.ProjectExternalId is null,
                    CreatedAt = DateTimeOffset.UtcNow,
                };
                if (project.IsNewConversationTargetResolvable)
                    project.Chats.Add(CreateNewConversationOption(project));
                catalog.Projects.Add(project);
            }
            else
            {
                if (project.ExternalId is null && binding.ProjectExternalId is not null)
                {
                    var previousProjectKey = project.Key;
                    project.ExternalId = binding.ProjectExternalId;
                    project.Key = binding.ProjectExternalId;
                    foreach (var chat in project.Chats)
                        if (string.Equals(chat.ProjectKey, previousProjectKey, StringComparison.OrdinalIgnoreCase))
                            chat.ProjectKey = project.Key;
                }
                if (project.Url is null && binding.ProjectExternalUrl is not null)
                    project.Url = binding.ProjectExternalUrl;
                if (IsFallbackProjectLabel(project.DisplayName)
                    && !IsFallbackProjectLabel(binding.ProjectLabel)
                    && !string.IsNullOrWhiteSpace(binding.ProjectLabel))
                    project.DisplayName = binding.ProjectLabel;
            }

            if (string.IsNullOrWhiteSpace(binding.ChatKey)
                && string.IsNullOrWhiteSpace(binding.ChatExternalId)) continue;
            var chatKey = binding.ChatKey ?? binding.ChatExternalId!;
            if (project.Chats.Any(item => !item.IsNewConversation
                && (string.Equals(item.Key, chatKey, StringComparison.OrdinalIgnoreCase)
                    || binding.ChatExternalId is not null
                    && string.Equals(item.ExternalId, binding.ChatExternalId, StringComparison.OrdinalIgnoreCase)))) continue;
            project.Chats.Insert(0, new ChatContextOption
            {
                ProviderId = ProviderId,
                ProjectKey = project.Key,
                Key = chatKey,
                DisplayName = string.IsNullOrWhiteSpace(binding.ChatLabel) ? chatKey : binding.ChatLabel,
                ExternalId = binding.ChatExternalId,
                Url = binding.ChatExternalUrl,
                Mode = ContextBindingMode.External,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }
    }

    private ProjectContextOption ToProjectOption(BrowserExtensionChatGptProjectEntry project, int sequence)
        => new()
        {
            ProviderId = ProviderId,
            Key = project.ProjectId ?? project.DiscoveryKey ?? $"__chatgpt_project_{sequence}",
            DisplayName = project.Title,
            ExternalId = project.ProjectId,
            Url = project.Url,
            Mode = ContextBindingMode.External,
            CreatedAt = DateTimeOffset.UtcNow.AddTicks(sequence),
        };

    private static void MergeProjectOption(
        ProjectContextOption target,
        BrowserExtensionChatGptProjectEntry source)
    {
        if (!string.IsNullOrWhiteSpace(source.ProjectId))
        {
            target.ExternalId = source.ProjectId;
            target.Key = source.ProjectId;
        }
        if (!string.IsNullOrWhiteSpace(source.Title)
            && (string.IsNullOrWhiteSpace(target.DisplayName) || IsFallbackProjectLabel(target.DisplayName)))
            target.DisplayName = source.Title;
        if (!string.IsNullOrWhiteSpace(source.Url)) target.Url = source.Url;
    }

    private static void MergeChatOption(
        ChatContextOption target,
        BrowserExtensionChatGptConversationEntry source)
    {
        if (!string.IsNullOrWhiteSpace(source.Title)
            && (string.IsNullOrWhiteSpace(target.DisplayName) || string.Equals(target.DisplayName, target.Key, StringComparison.OrdinalIgnoreCase)))
            target.DisplayName = source.Title;
        if (!string.IsNullOrWhiteSpace(source.Url)) target.Url = source.Url;
        if (!string.IsNullOrWhiteSpace(source.ConversationId)) target.ExternalId = source.ConversationId;
    }

    private static bool IsFallbackProjectLabel(string? value)
        => !string.IsNullOrWhiteSpace(value)
            && value.Trim().StartsWith("Project (", StringComparison.OrdinalIgnoreCase)
            && value.Trim().EndsWith(")", StringComparison.Ordinal);

    private static string? FallbackProjectId(string? value)
    {
        if (!IsFallbackProjectLabel(value)) return null;
        var trimmed = value!.Trim();
        var opening = trimmed.IndexOf('(');
        return opening >= 0 && opening + 1 < trimmed.Length - 1
            ? trimmed[(opening + 1)..^1].Trim()
            : null;
    }

    private static string? ProjectUrlFromConversationUrl(string conversationUrl, string projectId)
    {
        if (!Uri.TryCreate(conversationUrl, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase)) return null;

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.UnescapeDataString)
            .ToArray();
        var index = Array.FindIndex(segments, segment =>
            string.Equals(segment, projectId, StringComparison.OrdinalIgnoreCase));
        if (index < 1 || !string.Equals(segments[index - 1], "g", StringComparison.OrdinalIgnoreCase)) return null;
        var prefix = string.Join('/', segments.Take(index + 1).Select(Uri.EscapeDataString));
        return $"{uri.Scheme}://{uri.Host}/{prefix}/project";
    }

    private ChatContextOption ToChatOption(
        ProjectContextOption project,
        BrowserExtensionChatGptConversationEntry conversation,
        int sequence)
        => new()
        {
            ProviderId = ProviderId,
            ProjectKey = project.Key,
            Key = conversation.ConversationId,
            DisplayName = conversation.Title,
            ExternalId = conversation.ConversationId,
            Url = conversation.Url,
            Mode = ContextBindingMode.External,
            CreatedAt = DateTimeOffset.UtcNow.AddTicks(sequence),
        };

    private static ChatContextOption CreateNewConversationOption(ProjectContextOption project)
        => new()
        {
            ProviderId = project.ProviderId,
            ProjectKey = project.Key,
            Key = NewConversationKey,
            DisplayName = "＋ 新しいChat",
            Url = project.Url ?? ChatGptRootUrl,
            Mode = ContextBindingMode.External,
            CreatedAt = DateTimeOffset.MaxValue,
            IsNewConversation = true,
        };
}
