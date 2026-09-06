namespace ChatGPTComfyConnector.Core.Services;

/// <summary>Transient user acknowledgements; never persisted as Session binding or execution gates.</summary>
public sealed class ChatGuidanceProgress
{
    public bool CatalogRefreshed { get; private set; }
    private string? _project;
    private string? _chat;

    public void Reset() { CatalogRefreshed = false; _project = null; _chat = null; }
    public void Refreshed() { CatalogRefreshed = true; _project = null; _chat = null; }
    public bool IsProjectConfirmed(string? project) => project is not null && string.Equals(project, _project, StringComparison.Ordinal);
    public bool IsChatConfirmed(string? project, string? chat) => IsProjectConfirmed(project) && chat is not null && string.Equals(chat, _chat, StringComparison.Ordinal);
    public void ConfirmProject(string project)
    {
        if (!IsProjectConfirmed(project)) _chat = null;
        _project = project;
    }
    public void ConfirmChat(string project, string chat) { ConfirmProject(project); _chat = chat; }
    public void SelectionChanged(string? project, string? chat)
    {
        if (!IsProjectConfirmed(project)) { _project = null; _chat = null; }
        else if (!IsChatConfirmed(project, chat)) _chat = null;
    }
}
