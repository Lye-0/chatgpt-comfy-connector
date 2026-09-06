using System.Text.Json;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Contexts;

namespace ChatGPTComfyConnector.Tests;

public sealed class BrowserExtensionSentTargetBindingTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void NewChatAcknowledgementResolvesSelectionAndRetainsTheIssuedHandoff(bool projectless)
    {
        var (session, project, placeholder) = NewChat(projectless);
        session.PendingHandoff = PendingHandoffFactory.Create(session, [], "generate");
        var originalHandoff = JsonSerializer.Serialize(session.PendingHandoff);
        var result = Sent(projectless);

        var selected = BrowserExtensionSentTargetBinding.Apply(session, result, [project], project, placeholder);

        Assert.NotNull(selected);
        Assert.Equal(session.EffectiveContextProviderId, selected.ProviderId);
        Assert.Equal(session.EffectiveProjectContextKey, project.Key);
        Assert.Equal(session.EffectiveChatContextKey, selected.Key);
        Assert.Equal("conversation-created", selected.ExternalId);
        Assert.Equal(result.TargetConversationUrl, selected.Url);
        Assert.False(selected.IsNewConversation);
        Assert.Contains(selected, project.Chats);
        Assert.Contains(placeholder, project.Chats);
        Assert.True(placeholder.IsNewConversation);
        Assert.Equal(ChatGptProjectChatProvider.NewConversationKey, placeholder.Key);
        Assert.Null(placeholder.ExternalId);
        Assert.Equal(originalHandoff, JsonSerializer.Serialize(session.PendingHandoff));
        Assert.Equal(71, session.BrowserExtensionTargetTabId);
        Assert.Equal(result.TargetConversationUrl, session.ConversationUrl);
        Assert.Equal("新しいChat", session.ChatLabel);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void SelectionChangedWhileSendingIsNotOverwritten(bool changedProject)
    {
        var (session, project, _) = NewChat();
        var otherProject = changedProject
            ? new ProjectContextOption { ProviderId = project.ProviderId, Key = "project-other" }
            : project;
        var otherChat = new ChatContextOption
        {
            ProviderId = project.ProviderId,
            ProjectKey = otherProject.Key,
            Key = "conversation-other",
        };
        otherProject.Chats.Add(otherChat);

        var selected = BrowserExtensionSentTargetBinding.Apply(session, Sent(), [project], otherProject, otherChat);

        Assert.Same(otherChat, selected);
        Assert.NotNull(selected);
        Assert.NotEqual(session.EffectiveChatContextKey, selected.Key);
        Assert.Equal("conversation-created", session.ConversationId);
        Assert.Contains(project.Chats, item => item.Key == "conversation-created");
    }

    [Fact]
    public void RepeatedAcknowledgementReusesTheSameConversationOption()
    {
        var (session, project, placeholder) = NewChat();
        var first = BrowserExtensionSentTargetBinding.Apply(session, Sent(), [project], project, placeholder);
        var second = BrowserExtensionSentTargetBinding.Apply(session, Sent(), [project], project, first);

        Assert.Same(first, second);
        Assert.Equal(2, project.Chats.Count);
        Assert.Single(project.Chats, item => item.IsNewConversation);
    }

    [Fact]
    public void DiscoveredConversationIsReusedWithItsRealTitle()
    {
        var (session, project, placeholder) = NewChat();
        var discovered = new ChatContextOption
        {
            ProviderId = project.ProviderId,
            ProjectKey = project.Key,
            Key = "conversation-created",
            ExternalId = "conversation-created",
            DisplayName = "都市を走る車",
            Url = Sent().TargetConversationUrl,
            Mode = ContextBindingMode.External,
        };
        project.Chats.Add(discovered);

        var selected = BrowserExtensionSentTargetBinding.Apply(session, Sent(), [project], project, placeholder);

        Assert.Same(discovered, selected);
        Assert.Equal("都市を走る車", session.ChatLabel);
        Assert.Equal("Project / 都市を走る車", session.Title);
        Assert.Equal(2, project.Chats.Count);
    }

    [Fact]
    public void FailedSendDoesNotBindOrChangeSelection()
    {
        var (session, project, placeholder) = NewChat();
        var before = JsonSerializer.Serialize(session);

        var selected = BrowserExtensionSentTargetBinding.Apply(
            session, Sent() with { Status = "error" }, [project], project, placeholder);

        Assert.Same(placeholder, selected);
        Assert.Equal(before, JsonSerializer.Serialize(session));
        Assert.Single(project.Chats);
    }

    [Fact]
    public void MissingConversationIdentityKeepsThePlaceholder()
    {
        var (session, project, placeholder) = NewChat();
        var result = Sent() with { TargetConversationId = null, TargetConversationUrl = null };

        var selected = BrowserExtensionSentTargetBinding.Apply(session, result, [project], project, placeholder);

        Assert.Same(placeholder, selected);
        Assert.Equal(placeholder.Key, session.EffectiveChatContextKey);
        Assert.Single(project.Chats);
    }

    [Fact]
    public void AResultFromAnotherProjectDoesNotSilentlyReconcileTheSelection()
    {
        var (session, project, placeholder) = NewChat();
        var result = Sent() with { TargetProjectId = "project-other" };

        var selected = BrowserExtensionSentTargetBinding.Apply(session, result, [project], project, placeholder);

        Assert.Same(placeholder, selected);
        Assert.NotEqual(session.EffectiveProjectContextKey, project.Key);
        Assert.Single(project.Chats);
    }

    private static (CreationSession Session, ProjectContextOption Project, ChatContextOption Placeholder) NewChat(bool projectless = false)
    {
        var project = new ProjectContextOption
        {
            ProviderId = ContextProviderIds.ChatGptExtension,
            Key = projectless ? ChatGptProjectChatProvider.NoProjectKey : "project-one",
            ExternalId = projectless ? null : "project-one",
            DisplayName = "Project",
            Mode = ContextBindingMode.External,
            IsNoProject = projectless,
        };
        var placeholder = new ChatContextOption
        {
            ProviderId = project.ProviderId,
            ProjectKey = project.Key,
            Key = ChatGptProjectChatProvider.NewConversationKey,
            DisplayName = "＋ 新しいChat",
            Mode = ContextBindingMode.External,
            IsNewConversation = true,
        };
        project.Chats.Add(placeholder);
        var session = new CreationSession
        {
            ContextProviderId = project.ProviderId,
            ProjectContextKey = project.Key,
            ProjectId = project.ExternalId,
            ProjectLabel = project.DisplayName,
            ChatContextKey = placeholder.Key,
            ChatLabel = placeholder.DisplayName,
            Title = "Project / ＋ 新しいChat",
            BoundWorkflow = new WorkflowIdentity("video.json"),
        };
        return (session, project, placeholder);
    }

    private static BrowserExtensionHandoffSendResult Sent(bool projectless = false)
        => new("request", "handoff", "sent",
            TargetTabId: 71,
            TargetTabUrl: "https://chatgpt.com/c/conversation-created",
            TargetConversationId: "conversation-created",
            TargetConversationUrl: "https://chatgpt.com/c/conversation-created",
            TargetProjectId: projectless ? null : "project-one");
}
