using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

// Inputs belong to the next creation draft, not the running Session's binding.
public sealed record WorkflowPreparation(
    WorkflowIdentity? Workflow,
    SlotDiscoveryState SlotState,
    string? Error = null);

public sealed record ChatPreparation(
    ProjectChatCatalogLoadState CatalogState,
    ProjectContextOption? Project,
    ChatContextOption? Chat,
    int MaximumIterations,
    bool IsLoadingChats = false,
    string? Error = null,
    bool IsBinding = false);

/// <summary>
/// Independent preparation results. Completed means the inputs are ready;
/// CHAT becomes Completed in the pipeline only after Session binding succeeds.
/// These checks are also used by the start command, so display and execution
/// cannot disagree about loading, failures or the selected provider identities.
/// </summary>
public static class CreationPreparationPolicy
{
    public static CreationStageStatus EvaluateWorkflow(WorkflowPreparation input)
    {
        if (input.SlotState == SlotDiscoveryState.Loading)
            return Workflow(CreationStageState.InProgress, "Workflow / Slot Schemaを読み込み中");
        if (!string.IsNullOrWhiteSpace(input.Error) || input.SlotState == SlotDiscoveryState.Failed)
            return Workflow(CreationStageState.Error, input.Error ?? "Slot Schemaの取得に失敗しました · Workflowを再読み込みしてください");
        if (input.Workflow is null)
            return Workflow(CreationStageState.Current, "制作に使うWorkflowを選択してください");
        if (input.SlotState != SlotDiscoveryState.Loaded)
            return Workflow(CreationStageState.Current, "選択WorkflowのSlot Schemaを読み込んでください");
        return Workflow(CreationStageState.Completed, "Workflow / Slot Schemaの準備完了");
    }

    public static CreationStageStatus EvaluateChat(ChatPreparation input)
    {
        if (input.IsBinding)
            return Chat(CreationStageState.InProgress, "ChatGPT ContextをSessionへBinding・保存中");
        if (input.CatalogState == ProjectChatCatalogLoadState.Loading || input.IsLoadingChats)
            return Chat(CreationStageState.InProgress, input.IsLoadingChats ? "選択ProjectのChatを取得中" : "ChatGPT Project / Chatを取得中");
        if (!string.IsNullOrWhiteSpace(input.Error) || input.CatalogState == ProjectChatCatalogLoadState.Error)
            return Chat(CreationStageState.Error, input.Error ?? "ChatGPT Contextの取得に失敗しました · 再取得してください");
        if (input.CatalogState == ProjectChatCatalogLoadState.Disconnected)
            return Chat(CreationStageState.WaitingUser, "Extensionを接続してChatGPT Contextを再取得してください");
        if (input.CatalogState == ProjectChatCatalogLoadState.NotLoaded)
            return Chat(CreationStageState.Current, "ChatGPT Project / Chatを取得してください");
        if (input.Project is not { IsCreateAction: false } project)
            return Chat(CreationStageState.Current, "ChatGPT Projectを選択してください");
        if (!project.IsTargetResolvable)
            return Chat(CreationStageState.Error, "選択Projectの識別情報を取得できません · ChatGPT側でProjectを開いて再取得してください");
        if (input.Chat is not { IsCreateAction: false } chat)
            return Chat(CreationStageState.Current, "Chatを選択してください");
        if (!string.Equals(project.ProviderId, chat.ProviderId, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(project.Key, chat.ProjectKey, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(project.Key) || string.IsNullOrWhiteSpace(chat.Key))
            return Chat(CreationStageState.Error, "ProjectとChatのProvider参照が一致しません · 選択し直してください");
        if (chat.IsNewConversation && !project.IsNewConversationTargetResolvable)
            return Chat(CreationStageState.Error, "新しいChatの安全な遷移先を取得できません · Projectを再取得してください");
        if (input.MaximumIterations is < 1 or > 1000)
            return Chat(CreationStageState.Error, "Maximum Iterationsは1〜1000で指定してください");
        return Chat(CreationStageState.Completed, "Project / Chatの準備完了 · 新しい制作を開始してください");
    }

    private static CreationStageStatus Workflow(CreationStageState state, string detail)
        => new() { Stage = CreationStage.Workflow, State = state, Detail = detail };

    private static CreationStageStatus Chat(CreationStageState state, string detail)
        => new() { Stage = CreationStage.Chat, State = state, Detail = detail,
            WaitingReason = state == CreationStageState.WaitingUser ? CreationWaitingReason.UserActionRequired : CreationWaitingReason.None };
}
