using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Contexts;

/// <summary>
/// Project/Chat provider backed by the portable local JSON catalog.
/// The desktop UI talks to the provider contract instead of this storage shape.
/// </summary>
public sealed class LocalProjectChatProvider : IProjectChatProvider
{
    private readonly IPortableStore _store;
    private LocalContextCatalog _catalog = new();
    private bool _loaded;

    public LocalProjectChatProvider(IPortableStore store)
    {
        _store = store;
    }

    public string ProviderId => ContextProviderIds.LocalJson;

    public async Task<ProjectChatCatalog> LoadAsync(
        IReadOnlyCollection<ProjectChatBindingSnapshot> existingBindings,
        CancellationToken cancellationToken = default)
    {
        _catalog = await _store.LoadLocalContextsAsync(cancellationToken) ?? new LocalContextCatalog();
        var changed = false;

        if (_catalog.Version < 2)
        {
            var legacyDefault = _catalog.Projects.Count == 1 ? _catalog.Projects[0] : null;
            var referencedProjectKeys = existingBindings
                .Where(binding => string.Equals(binding.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase))
                .Select(binding => binding.ProjectKey)
                .Where(key => !string.IsNullOrWhiteSpace(key))
                .ToHashSet(StringComparer.OrdinalIgnoreCase);
            if (legacyDefault is not null
                && string.Equals(legacyDefault.DisplayName, "ComfyUI × ChatGPT", StringComparison.Ordinal)
                && legacyDefault.Chats.Count == 1
                && string.Equals(legacyDefault.Chats[0].DisplayName, "新しい制作", StringComparison.Ordinal)
                && !referencedProjectKeys.Contains(legacyDefault.Id))
            {
                _catalog.Projects.Clear();
                changed = true;
            }

            _catalog.Version = 2;
            changed = true;
        }

        foreach (var binding in existingBindings.Where(item => string.Equals(item.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase)))
        {
            if (string.IsNullOrWhiteSpace(binding.ProjectLabel)) continue;
            var project = _catalog.Projects.FirstOrDefault(item => string.Equals(item.Id, binding.ProjectKey, StringComparison.OrdinalIgnoreCase))
                ?? _catalog.Projects.FirstOrDefault(item => string.Equals(item.DisplayName, binding.ProjectLabel, StringComparison.OrdinalIgnoreCase));
            if (project is null)
            {
                project = new LocalProjectContext
                {
                    DisplayName = binding.ProjectLabel.Trim(),
                    ExternalId = binding.ProjectExternalId,
                };
                _catalog.Projects.Add(project);
                changed = true;
            }
            else if (project.ExternalId is null && binding.ProjectExternalId is not null)
            {
                project.ExternalId = binding.ProjectExternalId;
                changed = true;
            }

            if (string.IsNullOrWhiteSpace(binding.ChatLabel)) continue;
            var chat = project.Chats.FirstOrDefault(item => string.Equals(item.Id, binding.ChatKey, StringComparison.OrdinalIgnoreCase))
                ?? project.Chats.FirstOrDefault(item => string.Equals(item.DisplayName, binding.ChatLabel, StringComparison.OrdinalIgnoreCase));
            if (chat is null)
            {
                project.Chats.Add(new LocalChatContext
                {
                    DisplayName = binding.ChatLabel.Trim(),
                    ExternalId = binding.ChatExternalId,
                });
                changed = true;
            }
            else if (chat.ExternalId is null && binding.ChatExternalId is not null)
            {
                chat.ExternalId = binding.ChatExternalId;
                changed = true;
            }
        }

        if (changed) await _store.SaveLocalContextsAsync(_catalog, cancellationToken);
        _loaded = true;
        return ToCatalog();
    }

    public async Task<ProjectContextOption> CreateProjectAsync(string displayName, CancellationToken cancellationToken = default)
    {
        await EnsureLoadedAsync(cancellationToken);
        var name = NormalizeName(displayName, "Project");
        if (_catalog.Projects.Any(project => string.Equals(project.DisplayName, name, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("同名のProjectが既にあります。");
        }

        var project = new LocalProjectContext { DisplayName = name };
        _catalog.Projects.Add(project);
        await _store.SaveLocalContextsAsync(_catalog, cancellationToken);
        return ToProjectOption(project);
    }

    public async Task<ChatContextOption> CreateChatAsync(ProjectContextOption project, string displayName, CancellationToken cancellationToken = default)
    {
        await EnsureLoadedAsync(cancellationToken);
        if (!string.Equals(project.ProviderId, ProviderId, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("選択したProjectはこのProviderのものではありません。");
        }

        var localProject = _catalog.Projects.FirstOrDefault(item => string.Equals(item.Id, project.Key, StringComparison.OrdinalIgnoreCase));
        if (localProject is null) throw new InvalidOperationException("Projectが見つかりません。Providerを更新してください。");
        var name = NormalizeName(displayName, "Chat");
        if (localProject.Chats.Any(chat => string.Equals(chat.DisplayName, name, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException("同名のChatがこのProjectに既にあります。");
        }

        var chat = new LocalChatContext { DisplayName = name };
        localProject.Chats.Add(chat);
        await _store.SaveLocalContextsAsync(_catalog, cancellationToken);
        return ToChatOption(localProject, chat);
    }

    private async Task EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_loaded) return;
        await LoadAsync([], cancellationToken);
    }

    private ProjectChatCatalog ToCatalog() => new()
    {
        ProviderId = ProviderId,
        Projects = _catalog.Projects.OrderBy(item => item.CreatedAt).Select(ToProjectOption).ToList(),
    };

    private ProjectContextOption ToProjectOption(LocalProjectContext project) => new()
    {
        ProviderId = ProviderId,
        Key = project.Id,
        DisplayName = project.DisplayName,
        ExternalId = project.ExternalId,
        Mode = project.Mode,
        CreatedAt = project.CreatedAt,
        Chats = project.Chats.OrderBy(item => item.CreatedAt).Select(chat => ToChatOption(project, chat)).ToList(),
    };

    private ChatContextOption ToChatOption(LocalProjectContext project, LocalChatContext chat) => new()
    {
        ProviderId = ProviderId,
        ProjectKey = project.Id,
        Key = chat.Id,
        DisplayName = chat.DisplayName,
        ExternalId = chat.ExternalId,
        Mode = chat.Mode,
        CreatedAt = chat.CreatedAt,
    };

    private static string NormalizeName(string displayName, string label)
    {
        var value = (displayName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException($"{label}名を入力してください。");
        if (value.Length > 80) throw new InvalidOperationException($"{label}名は80文字以内で入力してください。");
        if (value.Any(char.IsControl)) throw new InvalidOperationException($"{label}名に制御文字は使用できません。");
        return value;
    }
}
