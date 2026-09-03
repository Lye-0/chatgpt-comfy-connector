using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Contexts;

/// <summary>
/// Metadata-only Project/Conversation catalog supplied by the authenticated
/// Browser Extension.  ChatGPT does not expose a supported public catalog API
/// for this feature, so the provider deliberately delegates discovery to the
/// Content Script and keeps the Desktop side free of DOM knowledge.
/// </summary>
public sealed class ChatGptProjectChatProvider : IProjectChatProvider, IProjectChatCacheProvider, IProjectChatSelectionProvider
{
    public const string NoProjectKey = "__chatgpt_no_project__";
    public const string NewConversationKey = "__chatgpt_new_conversation__";

    private const string ChatGptRootUrl = "https://chatgpt.com/";
    private readonly IBrowserExtensionBridge _bridge;
    private readonly LocalProjectChatProvider _legacyLocalProvider;
    private readonly IPortableStore _store;
    private readonly IChatGptContextCacheStore? _cacheStore;

    public ChatGptProjectChatProvider(
        IBrowserExtensionBridge bridge,
        IPortableStore store)
    {
        _bridge = bridge;
        _store = store;
        _legacyLocalProvider = new LocalProjectChatProvider(store);
        _cacheStore = store as IChatGptContextCacheStore;
    }

    public string ProviderId => ContextProviderIds.ChatGptExtension;

    public async Task<ProjectChatCatalog> LoadAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default)
    {
        var snapshot = NormalizeRootSnapshot(await LoadLiveSnapshotAsync(cancellationToken));
        var cached = await LoadCachedSnapshotAsync(cancellationToken);
        var normalizedCached = cached is null ? null : NormalizeCache(cached);
        await LogCatalogCountsAsync(
            "provider_live_snapshot",
            snapshot.RequestId,
            deserialized: snapshot.Projects.Count,
            cached: normalizedCached?.Projects.Count,
            cancellationToken: cancellationToken);
        if (snapshot.IsSuccess && snapshot.Projects.Count == 0)
        {
            // A full Collector refresh must prove that the Project sidebar was
            // discovered. An empty successful result would otherwise erase a
            // known catalog and make an incomplete DOM scan look legitimate.
            var incomplete = IncompleteProjectDiscoverySnapshot(snapshot);
            if (normalizedCached is not null)
            {
                return await BuildCatalogAsync(
                    CachedSnapshotWithError(normalizedCached, incomplete),
                    existingBindings,
                    cancellationToken);
            }
            return await BuildCatalogAsync(incomplete, existingBindings, cancellationToken);
        }

        if (snapshot.IsSuccess)
        {
            await SaveCacheIfAvailableAsync(snapshot, cancellationToken);
        }
        else
        {
            if (normalizedCached is not null)
            {
                if (string.Equals(snapshot.ErrorCode, "context_projects_incomplete", StringComparison.Ordinal)
                    || string.Equals(snapshot.ErrorCode, "context_response_timeout", StringComparison.Ordinal))
                {
                    return await BuildCatalogAsync(
                        CachedSnapshotWithError(normalizedCached, snapshot),
                        existingBindings,
                        cancellationToken);
                }
                // A stale metadata snapshot is still safe to display and is
                // preferable to erasing the user's selections while the
                // Extension is disconnected. The next successful refresh
                // replaces it with the complete Collector result.
                return await BuildCatalogAsync(ToSnapshot(normalizedCached), existingBindings, cancellationToken);
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
            : await BuildCatalogAsync(ToSnapshot(NormalizeCache(cached)), existingBindings, cancellationToken);
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

    private static BrowserExtensionChatGptContextCache NormalizeCache(
        BrowserExtensionChatGptContextCache cache)
        => cache with
        {
            Conversations = cache.Conversations.Where(IsProjectlessConversation).ToArray(),
        };

    private static BrowserExtensionChatGptContextSnapshot NormalizeRootSnapshot(
        BrowserExtensionChatGptContextSnapshot snapshot)
        => !snapshot.IsSuccess
            ? snapshot
            : snapshot with
            {
                // Root discovery owns the Project catalog and Projectless Chat
                // list. Project Chats are fetched only by the selection
                // capability below, so they must not leak into the root UI.
                Conversations = snapshot.Conversations.Where(IsProjectlessConversation).ToArray(),
            };

    private static bool IsProjectlessConversation(
        BrowserExtensionChatGptConversationEntry conversation)
        => string.IsNullOrWhiteSpace(conversation.ProjectId)
            && !TryGetProjectIdFromUrl(conversation.Url, out _);

    private static bool ConversationBelongsToProject(
        BrowserExtensionChatGptConversationEntry conversation,
        string projectId)
    {
        if (!string.IsNullOrWhiteSpace(conversation.ProjectId)
            && !string.Equals(conversation.ProjectId, projectId, StringComparison.OrdinalIgnoreCase)) return false;

        return string.Equals(conversation.ProjectId, projectId, StringComparison.OrdinalIgnoreCase)
            || TryGetProjectIdFromUrl(conversation.Url, out var urlProjectId)
                && string.Equals(urlProjectId, projectId, StringComparison.OrdinalIgnoreCase);
    }

    private static bool TryGetProjectIdFromUrl(string? value, out string projectId)
    {
        projectId = string.Empty;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase)) return false;

        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Select(Uri.UnescapeDataString)
            .ToArray();
        for (var index = 0; index + 1 < segments.Length; index++)
        {
            if (!string.Equals(segments[index], "g", StringComparison.OrdinalIgnoreCase)
                || !segments[index + 1].StartsWith("g-p-", StringComparison.OrdinalIgnoreCase)) continue;
            projectId = segments[index + 1];
            return true;
        }

        return false;
    }

    private static BrowserExtensionChatGptContextSnapshot IncompleteProjectDiscoverySnapshot(
        BrowserExtensionChatGptContextSnapshot live)
        => new(
            live.RequestId,
            "error",
            live.Projects,
            live.Conversations,
            live.Current,
            ErrorCode: "context_projects_incomplete",
            Message: "ChatGPT Projectの取得結果が空のため、完全なContextとして扱えません。",
            Stage: "context_projects_validation");

    private static BrowserExtensionChatGptContextSnapshot CachedSnapshotWithError(
        BrowserExtensionChatGptContextCache cache,
        BrowserExtensionChatGptContextSnapshot failure)
        => new(
            failure.RequestId,
            "error",
            cache.Projects,
            cache.Conversations,
            Current: failure.Current,
            ErrorCode: failure.ErrorCode ?? "context_projects_incomplete",
            Message: failure.Message ?? "ChatGPT Projectの取得結果が不完全なため、前回のContextを保持しています。",
            Stage: failure.Stage ?? "context_projects_validation");

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

        var projectById = new Dictionary<string, ProjectContextOption>(StringComparer.Ordinal);
        var projectByKey = new Dictionary<string, ProjectContextOption>(StringComparer.Ordinal);
        var sequence = 0;
        var skippedProjectCount = 0;
        foreach (var project in snapshot.Projects)
        {
            var identityKey = project.ProjectId ?? project.DiscoveryKey;
            if (string.IsNullOrWhiteSpace(identityKey))
            {
                skippedProjectCount += 1;
                continue;
            }

            ProjectContextOption? option = null;
            if (!string.IsNullOrWhiteSpace(project.DiscoveryKey)
                && projectByKey.TryGetValue(project.DiscoveryKey, out var discoveryOption))
            {
                option = discoveryOption;
            }
            else if (!string.IsNullOrWhiteSpace(project.ProjectId)
                && string.IsNullOrWhiteSpace(project.DiscoveryKey)
                && projectById.TryGetValue(project.ProjectId, out var idOnlyOption))
            {
                option = idOnlyOption;
            }
            else if (!string.IsNullOrWhiteSpace(project.ProjectId))
            {
                option = catalog.Projects.FirstOrDefault(item =>
                    !item.IsNoProject
                    && item.ExternalId is null
                    && string.Equals(FallbackProjectId(item.DisplayName), project.ProjectId, StringComparison.Ordinal));
            }

            if (option is null)
            {
                var occupyCanonicalId = string.IsNullOrWhiteSpace(project.ProjectId)
                    || !projectById.ContainsKey(project.ProjectId);
                option = ToProjectOption(project, sequence++, occupyCanonicalId);
                catalog.Projects.Add(option);
            }
            MergeProjectOption(option, project);
            projectByKey[option.Key] = option;
            if (!string.IsNullOrWhiteSpace(identityKey)) projectByKey[identityKey] = option;
            if (!string.IsNullOrWhiteSpace(project.DiscoveryKey)) projectByKey[project.DiscoveryKey] = option;
            if (!string.IsNullOrWhiteSpace(option.ExternalId)
                && (string.IsNullOrWhiteSpace(project.DiscoveryKey)
                    || string.Equals(option.Key, option.ExternalId, StringComparison.Ordinal)))
            {
                projectById[option.ExternalId] = option;
            }
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
        var realProjectCount = catalog.Projects.Count(item => !item.IsCreateAction && !item.IsNoProject);
        await LogCatalogCountsAsync(
            "provider_catalog_built",
            snapshot.RequestId,
            deserialized: snapshot.Projects.Count,
            normalized: realProjectCount,
            skipped: skippedProjectCount,
            cached: snapshot.Projects.Count,
            persisted: snapshot.IsSuccess ? snapshot.Projects.Count : null,
            detail: string.Join(
                ", ",
                $"viewmodel_source_project_count={snapshot.Projects.Count}",
                $"viewmodel_catalog_project_count={realProjectCount}",
                $"ui_real_project_count={realProjectCount}",
                $"ui_project_option_count={catalog.Projects.Count(item => !item.IsCreateAction)}",
                $"projectless_option_count={catalog.Projects.Count(item => item.IsNoProject)}"),
            cancellationToken: cancellationToken);
        return catalog;
    }

    private async Task LogCatalogCountsAsync(
        string stage,
        string? requestId,
        int? deserialized = null,
        int? normalized = null,
        int? skipped = null,
        int? cached = null,
        int? persisted = null,
        string? detail = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var fields = new List<string> { $"stage={stage}" };
            if (!string.IsNullOrWhiteSpace(requestId)) fields.Add($"request_id={requestId}");
            if (deserialized is int live) fields.Add($"provider_deserialized_project_count={live}");
            if (normalized is int kept) fields.Add($"provider_normalized_project_count={kept}");
            if (skipped is int drop) fields.Add($"provider_skipped_project_count={drop}");
            if (cached is int cacheCount) fields.Add($"provider_cached_project_count={cacheCount}");
            if (persisted is int saved) fields.Add($"provider_persisted_project_count={saved}");
            if (!string.IsNullOrWhiteSpace(detail)) fields.Add(detail);
            await _store.LogAsync("context", string.Join(" ", fields), cancellationToken: cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
        }
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

    /// <summary>
    /// Loads Chats for exactly one user-selected Project. Root discovery never
    /// calls this method; the selected Project's canonical ID/URL is sent to
    /// the Extension so the Collector can visit only that Project page.
    /// </summary>
    public async Task<IReadOnlyList<ChatContextOption>> LoadProjectChatsAsync(
        ProjectContextOption project,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(project);
        if (!string.Equals(project.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase)
            || project.IsNoProject
            || string.IsNullOrWhiteSpace(project.ExternalId)
            || string.IsNullOrWhiteSpace(project.Url)
            || !TryGetProjectIdFromUrl(project.Url, out var urlProjectId)
            || !string.Equals(project.ExternalId, urlProjectId, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("選択したChatGPT Projectの識別情報を取得できません。");
        }

        var snapshot = await _bridge.GetChatGptProjectChatsAsync(
            project.ExternalId,
            project.Url,
            cancellationToken);
        if (!snapshot.IsSuccess)
        {
            throw new InvalidOperationException(
                snapshot.Message ?? "ChatGPT Project内のChat一覧を取得できませんでした。");
        }

        var chats = new List<ChatContextOption>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var conversation in snapshot.Conversations)
        {
            if (!ConversationBelongsToProject(conversation, project.ExternalId)
                || string.IsNullOrWhiteSpace(conversation.ConversationId)
                || !seen.Add(conversation.ConversationId)) continue;
            chats.Add(ToChatOption(project, conversation, chats.Count));
        }

        // Preserve a previously bound chat until a later Project refresh can
        // rediscover it, while allowing the selected Project response to
        // replace stale/partial root data.
        foreach (var existing in project.Chats.Where(item =>
                     !item.IsNewConversation
                     && !string.IsNullOrWhiteSpace(item.ExternalId)
                     && seen.Add(item.ExternalId!)))
            chats.Add(existing);

        if (project.IsNewConversationTargetResolvable)
            chats.Add(CreateNewConversationOption(project));
        return chats;
    }

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

    private ProjectContextOption ToProjectOption(
        BrowserExtensionChatGptProjectEntry project,
        int sequence,
        bool occupyCanonicalId = true)
        => new()
        {
            ProviderId = ProviderId,
            Key = occupyCanonicalId
                ? project.ProjectId ?? project.DiscoveryKey ?? $"__chatgpt_project_{sequence}"
                : project.DiscoveryKey ?? $"__chatgpt_project_{sequence}",
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
            var retargetKey = target.ExternalId is null
                || string.Equals(target.Key, source.ProjectId, StringComparison.Ordinal);
            target.ExternalId = source.ProjectId;
            if (retargetKey) target.Key = source.ProjectId;
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
