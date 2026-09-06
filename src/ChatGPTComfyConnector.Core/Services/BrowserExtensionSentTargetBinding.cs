using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Resolves the new-Chat placeholder to the conversation that accepted the
/// Handoff, while preserving any selection the user changed during the send.
/// </summary>
public static class BrowserExtensionSentTargetBinding
{
    public static ChatContextOption? Apply(
        CreationSession session,
        BrowserExtensionHandoffSendResult result,
        IReadOnlyCollection<ProjectContextOption> projects,
        ProjectContextOption? selectedProject,
        ChatContextOption? selectedChat)
    {
        if (!result.IsSent) return selectedChat;

        var providerId = session.EffectiveContextProviderId;
        var projectKey = session.EffectiveProjectContextKey;
        var chatKey = session.EffectiveChatContextKey;
        var wasNewConversation = string.IsNullOrWhiteSpace(session.ConversationId)
            && string.IsNullOrWhiteSpace(session.ConversationUrl);
        var selectionMatches = selectedProject?.ProviderId == providerId
            && selectedProject?.Key == projectKey
            && selectedChat?.ProviderId == providerId
            && selectedChat?.ProjectKey == projectKey
            && selectedChat?.Key == chatKey;

        session.BrowserExtensionTargetTabId = result.TargetTabId;
        session.BrowserExtensionTargetTabUrl = result.TargetTabId.HasValue ? result.TargetTabUrl : null;
        if (!string.IsNullOrWhiteSpace(result.TargetConversationId))
        {
            session.ConversationId = result.TargetConversationId;
            session.ConversationUrl = result.TargetConversationUrl ?? session.ConversationUrl;
            session.ChatContextKey = result.TargetConversationId;
        }
        if (!string.IsNullOrWhiteSpace(result.TargetProjectId))
        {
            session.ProjectId = result.TargetProjectId;
            session.ProjectContextKey = result.TargetProjectId;
        }

        if (providerId != ContextProviderIds.ChatGptExtension
            || string.IsNullOrWhiteSpace(result.TargetConversationId)
            || session.EffectiveProjectContextKey != projectKey)
            return selectedChat;

        var project = projects.FirstOrDefault(item => item.ProviderId == providerId && item.Key == projectKey);
        if (project is null) return selectedChat;

        var boundChat = project.Chats.FirstOrDefault(item => item.ProviderId == providerId
            && item.ProjectKey == projectKey && item.Key == result.TargetConversationId
            && !item.IsCreateAction && !item.IsNewConversation);
        if (boundChat is null)
        {
            boundChat = new ChatContextOption
            {
                ProviderId = providerId,
                ProjectKey = project.Key,
                Key = result.TargetConversationId,
                DisplayName = wasNewConversation ? "新しいChat" : session.ChatLabel,
                ExternalId = result.TargetConversationId,
                Url = session.ConversationUrl,
                Mode = ContextBindingMode.External,
            };
            // Keep the placeholder intact so the next creation can still
            // explicitly request another new conversation.
            project.Chats.Add(boundChat);
        }
        var defaultTitle = $"{session.ProjectLabel} / {session.ChatLabel}";
        session.ChatLabel = boundChat.DisplayName;
        if (session.Title == defaultTitle) session.Title = $"{session.ProjectLabel} / {session.ChatLabel}";

        // PendingHandoff is the immutable request snapshot. Its placeholder
        // identity and payload must survive this transport acknowledgement.
        return selectionMatches ? boundChat : selectedChat;
    }
}
