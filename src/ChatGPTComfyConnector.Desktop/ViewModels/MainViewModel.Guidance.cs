using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed partial class MainViewModel
{
    private readonly ChatGuidanceProgress _chatGuidance = new();
    private CreationGuidance _guidance = CreationGuidance.None;
    private int _guidedOperations;
    private string? _guideLoadedProjectKey;
    private bool _hasMaximumIterationsInputError;

    public bool HasMaximumIterationsInputError
    {
        get => _hasMaximumIterationsInputError;
        set { _hasMaximumIterationsInputError = value; RefreshGuidance(); }
    }

    public CreationGuideTarget GuideTarget => _guidance.Target;
    public string? GuideItemId => _guidance.ItemId;
    public string GuideText => HasGuidance ? $"次：{_guidance.Message}" : string.Empty;
    public bool HasGuidance => GuideTarget != CreationGuideTarget.None;

    public void BeginGuidedOperation() { _guidedOperations++; RefreshGuidance(); }
    public void EndGuidedOperation() { _guidedOperations = Math.Max(0, _guidedOperations - 1); RefreshGuidance(); }

    public async Task ConfirmProjectForGuidanceAsync()
    {
        if (IsChatGptContextLoading || SelectedProject is not { IsCreateAction: false } project) return;
        var key = ProjectGuideKey;
        if (key is null) return;
        var previouslyConfirmed = _chatGuidance.IsProjectConfirmed(key);
        _chatGuidance.ConfirmProject(key);
        RefreshGuidance();
        // Root refresh may have auto-selected the Project without collecting
        // its Chats. Confirming that same row is an explicit user selection.
        if (!previouslyConfirmed && _guideLoadedProjectKey != key && !IsProjectChatListLoading && !project.IsNoProject
            && project.ProviderId == ContextProviderIds.ChatGptExtension && _contextProvider is IProjectChatSelectionProvider)
        {
            IsProjectChatListLoading = true;
            ChatValidationMessage = string.Empty;
            ChatOptions.Clear();
            _selectedChat = null;
            OnPropertyChanged(nameof(SelectedChat));
            OnPropertyChanged(nameof(HasSelectedChat));
            NotifyContextSelectionChanged();
            await LoadSelectedProjectChatsAsync(project);
        }
    }

    public void ConfirmChatForGuidance()
    {
        if (IsChatSelectorLoading || ProjectGuideKey is not { } project || ChatGuideKey is not { } chat) return;
        _chatGuidance.ConfirmChat(project, chat);
        RefreshGuidance();
    }

    private string? ProjectGuideKey => SelectedProject is { IsCreateAction: false } project ? $"{project.ProviderId}\u001f{project.Key}" : null;
    private string? ChatGuideKey => SelectedChat is { IsCreateAction: false } chat ? $"{chat.ProviderId}\u001f{chat.Key}" : null;

    private void RefreshGuidance()
    {
        var pending = CurrentSession?.PendingHandoff;
        var handoff = pending is null ? null : CurrentSession!.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ConnectorToChatGpt && PendingHandoffReuse.MatchesPayload(pending, item.Payload));
        var next = CreationGuidancePolicy.Resolve(new CreationGuideContext
        {
            Session = CurrentSession,
            IsSessionActivated = _isCurrentSessionActivated,
            Connection = ConnectionState,
            IsOperationInProgress = _guidedOperations > 0 || IsBusy || _isChatBinding || _isResumeInProgress
                || IsGenerationInProgress || _browserExtensionSendRequests.Count > 0,
            IsSetupReady = IsConnected || IsGuidanceSetupReady(),
            IsSetupVisible = IsSetupVisible,
            Workflow = SelectedWorkflowPreparation,
            Chat = SelectedChatPreparation,
            IsWorkflowEditorVisible = IsWorkflowEditorVisible,
            HasWorkflowEntries = HasTreeNodes,
            RequiresChatRefresh = _contextProvider.ProviderId == ContextProviderIds.ChatGptExtension,
            IsExtensionConnected = IsBrowserExtensionConnected,
            IsCatalogRefreshed = _chatGuidance.CatalogRefreshed,
            IsProjectConfirmed = _chatGuidance.IsProjectConfirmed(ProjectGuideKey),
            IsChatConfirmed = _chatGuidance.IsChatConfirmed(ProjectGuideKey, ChatGuideKey),
            IsProjectCreateVisible = IsProjectCreateVisible,
            IsChatCreateVisible = IsChatCreateVisible,
            HasMaximumIterationsInputError = HasMaximumIterationsInputError,
            HasPendingContextChange = HasPendingContextChange,
            CanRefreshChat = CanRefreshChatGptContext,
            CanStartCreation = CanStartNewCreation,
            CanSend = CanSendToChatGpt,
            CanApply = CanApplyCommand,
            CanGenerate = CanRunWorkflow,
            CanAttachReviewOutput = CanAttachReviewOutput,
            CanResume = CanResumeSession,
            HasCommandText = !string.IsNullOrWhiteSpace(CommandText),
            IsCommandValid = _pendingValidation?.IsValid == true,
            HandoffNeedsPaste = handoff?.State == HandoffTransportState.Copied,
            HandoffItemId = handoff?.Id,
        });
        if (_guidance == next) return;
        _guidance = next;
        OnPropertyChanged(nameof(GuideTarget));
        OnPropertyChanged(nameof(GuideItemId));
        OnPropertyChanged(nameof(GuideText));
        OnPropertyChanged(nameof(HasGuidance));
    }

    private bool IsGuidanceSetupReady()
    {
        try { ValidateSettings(); return true; }
        catch (InvalidOperationException) { return false; }
    }
}
