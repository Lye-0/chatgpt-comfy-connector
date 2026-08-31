using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Contexts;
using ChatGPTComfyConnector.Infrastructure.Bridge;
using ChatGPTComfyConnector.Infrastructure.Mcp;
using ChatGPTComfyConnector.Infrastructure.Storage;
using ChatGPTComfyConnector.Infrastructure.Workflows;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class MainViewModel : INotifyPropertyChanged
{
    private static readonly TimeSpan ComfyUiStartupTimeout = TimeSpan.FromSeconds(90);
    private static readonly TimeSpan ComfyUiStartupPollInterval = TimeSpan.FromSeconds(1);
    private const long MaxReviewMediaBytes = 512L * 1024 * 1024;
    private static readonly TimeSpan ReviewMediaStabilityPollInterval = TimeSpan.FromMilliseconds(150);
    private static readonly TimeSpan ReviewMediaStabilityTimeout = TimeSpan.FromSeconds(5);
    private readonly PortableLayout _layout;
    private readonly PortableStore _store;
    private readonly ComfyMcpClientProxy _mcp;
    private readonly IBrowserExtensionBridge _browserExtensionBridge;
    private readonly IComfyUiHealthProbe _comfyUiHealthProbe;
    private readonly WorkflowCatalog _catalog;
    private readonly SemaphoreSlim _comfyUiStatusGate = new(1, 1);
    private readonly SemaphoreSlim _comfyUiStartGate = new(1, 1);
    private readonly SemaphoreSlim _generationGate = new(1, 1);
    private readonly SemaphoreSlim _bootstrapHandoffGate = new(1, 1);
    private readonly SemaphoreSlim _reviewHandoffGate = new(1, 1);
    private readonly SemaphoreSlim _reviewMediaAttachmentGate = new(1, 1);
    private readonly SemaphoreSlim _resumeGate = new(1, 1);
    private CreationSession? _currentSession;
    private WorkflowIdentity? _selectedWorkflow;
    private JobSnapshot? _currentJob;
    private string _statusMessage = "初回セットアップを確認しています。";
    private ConnectionState _connectionState = ConnectionState.Disconnected;
    private ComfyUiRuntimeState _comfyUiRuntimeState = ComfyUiRuntimeState.Unknown;
    private bool _isSetupVisible;
    private bool _isBusy;
    private bool _isSlotLoading;
    private SlotDiscoveryState _slotDiscoveryState = SlotDiscoveryState.NotLoaded;
    // Slot discovery is asynchronous and can be triggered by both Workflow
    // selection and a successful MCP reconnect.  A later request must own the
    // observable collections; otherwise an earlier response can append the
    // same schema (or a previous Workflow's schema) after the newer request
    // has already started.
    private long _slotDiscoveryVersion;
    private bool _isDirty;
    private bool _isWorkflowEditorVisible;
    private string _commandText = string.Empty;
    private string _idea = string.Empty;
    private string? _slotLoadError;
    private ProtocolValidationResult? _pendingValidation;
    private string? _loadedFingerprint;
    private JsonNode? _serverInfo;
    private GenerationHistoryItem? _selectedHistoryItem;
    private bool _isWorkflowRenameVisible;
    private string _workflowRenameText = string.Empty;
    private readonly IProjectChatProvider _contextProvider;
    private ProjectChatCatalog _contextCatalog = new();
    private readonly ProjectContextOption _createProjectOption = new() { Key = "__create_project__", DisplayName = "＋ 新しいProjectを作成", IsCreateAction = true };
    private readonly ChatContextOption _createChatOption = new() { Key = "__create_chat__", DisplayName = "＋ 新しいChatを作成", IsCreateAction = true };
    private ProjectContextOption? _selectedProject;
    private ChatContextOption? _selectedChat;
    private bool _isProjectCreateVisible;
    private bool _isChatCreateVisible;
    private string _newProjectName = string.Empty;
    private string _newChatName = string.Empty;
    private string _projectValidationMessage = string.Empty;
    private string _chatValidationMessage = string.Empty;
    private int _sessionMaximumIterations = 10;
    // A persisted session may be loaded for history, but it is not the new
    // creation draft until the user explicitly starts or resumes it.
    private bool _isCurrentSessionActivated;
    // WPF keeps IME composition text out of the bound Text value until the
    // composition is committed. Keep this presentation-only flag so the
    // custom placeholder does not render over the composition text.
    private bool _isIdeaComposing;
    private readonly SynchronizationContext? _notificationContext = SynchronizationContext.Current;
    private readonly object _browserExtensionResponseGate = new();
    private readonly SemaphoreSlim _automaticResponseExecutionGate = new(1, 1);
    private bool _isResumeInProgress;
    private readonly HashSet<string> _browserExtensionSendRequests = new(StringComparer.Ordinal);
    private readonly Dictionary<string, BrowserExtensionAssistantResponse> _queuedBrowserExtensionResponses = new(StringComparer.Ordinal);

    public MainViewModel(
        string applicationDirectory,
        IProjectChatProvider? contextProvider = null,
        IComfyUiHealthProbe? comfyUiHealthProbe = null,
        IBrowserExtensionBridge? browserExtensionBridge = null)
    {
        _layout = new PortableLayout(applicationDirectory);
        _store = new PortableStore(_layout);
        _mcp = new ComfyMcpClientProxy(_store);
        _browserExtensionBridge = browserExtensionBridge ?? new BrowserExtensionBridge(pairingStore: _store);
        // The default context source is the authenticated Extension.  Keep an
        // explicitly injected provider intact so local-provider tests and
        // legacy/offline callers remain deterministic.
        _contextProvider = contextProvider ?? new ChatGptProjectChatProvider(_browserExtensionBridge, _store);
        _browserExtensionBridge.StatusChanged += BrowserExtensionBridge_StatusChanged;
        _browserExtensionBridge.Diagnostic += BrowserExtensionBridge_Diagnostic;
        _browserExtensionBridge.AssistantResponseReceived += BrowserExtensionBridge_AssistantResponseReceived;
        _browserExtensionBridge.ChatGptContextChanged += BrowserExtensionBridge_ChatGptContextChanged;
        _comfyUiHealthProbe = comfyUiHealthProbe ?? new ComfyUiEndpointHealthProbe();
        _catalog = new WorkflowCatalog(_mcp, _store);
        Settings = new AppSettings
        {
            PortableRoot = Directory.Exists("C:\\AI\\ComfyUI_windows_portable") ? "C:\\AI\\ComfyUI_windows_portable" : string.Empty,
            ComfyMcpPath = File.Exists("C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy-mcp.exe") ? "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy-mcp.exe" : string.Empty,
            ComfyCliPath = File.Exists("C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy.exe") ? "C:\\AI\\comfy-mcp-runtime\\.venv\\Scripts\\comfy.exe" : null,
        };
        Sessions = [];
        TreeNodes = [];
        Slots = [];
        PrimarySlots = [];
        TuningSlots = [];
        AdvancedSlots = [];
        Iterations = [];
        Backups = [];
        LatestOutputs = [];
        HistoryItems = [];
        PipelineStages = [];
        ProjectOptions = [];
        ChatOptions = [];
        HandoffItems = [];
        Settings.PropertyChanged += Settings_PropertyChanged;
        RefreshPipeline();
    }

    public AppSettings Settings { get; }
    public ObservableCollection<CreationSession> Sessions { get; }
    public ObservableCollection<WorkflowTreeNode> TreeNodes { get; }
    public ObservableCollection<SlotEditorItem> Slots { get; }
    public ObservableCollection<SlotEditorItem> PrimarySlots { get; }
    public ObservableCollection<SlotEditorItem> TuningSlots { get; }
    public ObservableCollection<SlotEditorItem> AdvancedSlots { get; }
    public ObservableCollection<SessionIteration> Iterations { get; }
    public ObservableCollection<string> Backups { get; }
    public ObservableCollection<OutputArtifact> LatestOutputs { get; }
    public ObservableCollection<GenerationHistoryItem> HistoryItems { get; }
    public ObservableCollection<CreationPipelineStage> PipelineStages { get; }
    public ObservableCollection<ProjectContextOption> ProjectOptions { get; }
    public ObservableCollection<ChatContextOption> ChatOptions { get; }
    public ObservableCollection<HandoffTimelineItem> HandoffItems { get; }
    public CreationSession? CurrentSession { get => _currentSession; private set { _currentSession = value; if (value is not null) CreationPipelineStateMachine.EnsureInitialized(value); OnPropertyChanged(); OnPropertyChanged(nameof(SessionTitle)); OnPropertyChanged(nameof(SessionStatusText)); OnPropertyChanged(nameof(SessionProgressText)); OnPropertyChanged(nameof(ProjectLabel)); OnPropertyChanged(nameof(ChatLabel)); OnPropertyChanged(nameof(CurrentSessionContextText)); OnPropertyChanged(nameof(CanResumeSession)); OnPropertyChanged(nameof(HasPendingContextChange)); OnPropertyChanged(nameof(IsIdeaInputEnabled)); OnPropertyChanged(nameof(HasIdeaInput)); OnPropertyChanged(nameof(ShowIdeaPlaceholder)); OnPropertyChanged(nameof(IdeaInputHint)); OnPropertyChanged(nameof(CanResendBootstrapHandoff)); OnPropertyChanged(nameof(CanResendReviewHandoff)); OnPropertyChanged(nameof(CanSendToChatGpt)); OnPropertyChanged(nameof(SendToChatGptButtonText)); OnPropertyChanged(nameof(SendToChatGptHint)); OnPropertyChanged(nameof(CurrentGenerateExecutionState)); OnPropertyChanged(nameof(GenerateExecutionStateText)); OnPropertyChanged(nameof(AutomaticResponseExecutionText)); OnPropertyChanged(nameof(AutomaticIterationText)); OnPropertyChanged(nameof(HasAutomaticIterationStatus)); OnPropertyChanged(nameof(ReviewHandoff)); OnPropertyChanged(nameof(ReviewMediaAttachment)); OnPropertyChanged(nameof(HasReviewMediaAttachment)); OnPropertyChanged(nameof(ReviewMediaAttachmentStateText)); OnPropertyChanged(nameof(IsReviewMediaAttachmentFailed)); OnPropertyChanged(nameof(CanAttachReviewOutput)); OnPropertyChanged(nameof(CanCancelOperation)); OnPropertyChanged(nameof(HasDeferredGenerate)); OnPropertyChanged(nameof(DeferredGenerateText)); NotifyPipelineStateChanged(); } }
    public WorkflowIdentity? SelectedWorkflow { get => _selectedWorkflow; private set { _selectedWorkflow = value; OnPropertyChanged(); OnPropertyChanged(nameof(SelectedWorkflowText)); OnPropertyChanged(nameof(SelectedWorkflowName)); OnPropertyChanged(nameof(HasSelectedWorkflow)); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); OnPropertyChanged(nameof(CurrentOutputFolderPath)); OnPropertyChanged(nameof(CanStartNewCreation)); NotifyViewStateChanged(); NotifyContextSelectionChanged(); } }
    public JobSnapshot? CurrentJob { get => _currentJob; private set { _currentJob = value; OnPropertyChanged(); OnPropertyChanged(nameof(JobStatusText)); OnPropertyChanged(nameof(JobStatusDetailText)); OnPropertyChanged(nameof(IsJobActive)); OnPropertyChanged(nameof(CanCancelOperation)); OnPropertyChanged(nameof(CanStartNewCreation)); NotifyGenerationDisplayChanged(); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public ConnectionState ConnectionState { get => _connectionState; private set { _connectionState = value; OnPropertyChanged(); OnPropertyChanged(nameof(ConnectionStateText)); OnPropertyChanged(nameof(IsConnected)); NotifyConnectionStateChanged(); NotifyViewStateChanged(); NotifyPipelineStateChanged(); } }
    public string StatusMessage { get => _statusMessage; set { _statusMessage = value; OnPropertyChanged(); } }
    public bool IsSetupVisible { get => _isSetupVisible; private set { _isSetupVisible = value; OnPropertyChanged(); } }
    public bool IsWorkflowEditorVisible { get => _isWorkflowEditorVisible; private set { _isWorkflowEditorVisible = value; OnPropertyChanged(); } }
    public bool IsBusy { get => _isBusy; private set { _isBusy = value; OnPropertyChanged(); OnPropertyChanged(nameof(CanRefreshChatGptContext)); NotifyGenerationDisplayChanged(); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public bool IsSlotLoading { get => _isSlotLoading; private set { _isSlotLoading = value; OnPropertyChanged(); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); } }
    public SlotDiscoveryState SlotDiscoveryState { get => _slotDiscoveryState; private set { _slotDiscoveryState = value; OnPropertyChanged(); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); OnPropertyChanged(nameof(CanStartNewCreation)); OnPropertyChanged(nameof(CanResendBootstrapHandoff)); OnPropertyChanged(nameof(CanResendReviewHandoff)); OnPropertyChanged(nameof(CanSendToChatGpt)); OnPropertyChanged(nameof(SendToChatGptButtonText)); OnPropertyChanged(nameof(SendToChatGptHint)); NotifyViewStateChanged(); } }
    public bool IsDirty { get => _isDirty; private set { _isDirty = value; OnPropertyChanged(); OnPropertyChanged(nameof(DirtyText)); NotifyPipelineStateChanged(); } }
    public bool IsWorkflowRenameVisible { get => _isWorkflowRenameVisible; private set { _isWorkflowRenameVisible = value; OnPropertyChanged(); } }
    public string WorkflowRenameText { get => _workflowRenameText; set { _workflowRenameText = value; OnPropertyChanged(); } }
    public ProjectContextOption? SelectedProject
    {
        get => _selectedProject;
        set
        {
            if (value?.IsCreateAction == true)
            {
                _selectedProject = null;
                IsProjectCreateVisible = true;
                NewProjectName = string.Empty;
                ProjectValidationMessage = string.Empty;
                RefreshChatOptions();
                OnPropertyChanged();
                OnPropertyChanged(nameof(HasSelectedProject));
                OnPropertyChanged(nameof(CanSelectChat));
                OnPropertyChanged(nameof(CanCreateChat));
                OnPropertyChanged(nameof(CanStartNewCreation));
                NotifyContextSelectionChanged();
                return;
            }
            if (ReferenceEquals(_selectedProject, value)) return;
            _selectedProject = value;
            IsProjectCreateVisible = false;
            ProjectValidationMessage = string.Empty;
            RefreshChatOptions();
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSelectedProject));
            OnPropertyChanged(nameof(CanSelectChat));
            OnPropertyChanged(nameof(CanCreateChat));
            OnPropertyChanged(nameof(CanStartNewCreation));
            NotifyContextSelectionChanged();
        }
    }
    public ChatContextOption? SelectedChat
    {
        get => _selectedChat;
        set
        {
            if (value?.IsCreateAction == true)
            {
                _selectedChat = null;
                IsChatCreateVisible = true;
                NewChatName = string.Empty;
                ChatValidationMessage = string.Empty;
                OnPropertyChanged();
                OnPropertyChanged(nameof(HasSelectedChat));
                OnPropertyChanged(nameof(CanStartNewCreation));
                NotifyContextSelectionChanged();
                return;
            }
            if (ReferenceEquals(_selectedChat, value)) return;
            _selectedChat = value;
            IsChatCreateVisible = false;
            ChatValidationMessage = string.Empty;
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasSelectedChat));
            OnPropertyChanged(nameof(CanStartNewCreation));
            NotifyContextSelectionChanged();
        }
    }
    public bool IsProjectCreateVisible { get => _isProjectCreateVisible; private set { _isProjectCreateVisible = value; OnPropertyChanged(); } }
    public bool IsChatCreateVisible { get => _isChatCreateVisible; private set { _isChatCreateVisible = value; OnPropertyChanged(); } }
    public string NewProjectName { get => _newProjectName; set { _newProjectName = value; ProjectValidationMessage = string.Empty; OnPropertyChanged(); } }
    public string NewChatName { get => _newChatName; set { _newChatName = value; ChatValidationMessage = string.Empty; OnPropertyChanged(); } }
    public string ProjectValidationMessage { get => _projectValidationMessage; private set { _projectValidationMessage = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasProjectValidationMessage)); } }
    public string ChatValidationMessage { get => _chatValidationMessage; private set { _chatValidationMessage = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasChatValidationMessage)); } }
    public int SessionMaximumIterations { get => _sessionMaximumIterations; set { if (_sessionMaximumIterations == value) return; _sessionMaximumIterations = value; OnPropertyChanged(); OnPropertyChanged(nameof(CanStartNewCreation)); NotifyContextSelectionChanged(); } }
    public string CommandText
    {
        get => _commandText;
        set
        {
            var replaced = !string.Equals(_commandText, value, StringComparison.Ordinal) && _pendingValidation is not null;
            _commandText = value;
            _pendingValidation = null;
            if (replaced && CurrentSession is not null) CreationPipelineStateMachine.CommandReplaced(CurrentSession);
            OnPropertyChanged();
            OnPropertyChanged(nameof(CanApplyCommand));
            NotifyPipelineStateChanged();
        }
    }
    public string Idea
    {
        get => _idea;
        set
        {
            if (string.Equals(_idea, value, StringComparison.Ordinal)) return;
            _idea = value;
            if (_isCurrentSessionActivated && CurrentSession is not null) CreationPipelineStateMachine.IdeaChanged(CurrentSession, value);
            OnPropertyChanged();
            OnPropertyChanged(nameof(HasIdeaInput));
            OnPropertyChanged(nameof(ShowIdeaPlaceholder));
            NotifyPipelineStateChanged();
        }
    }

    /// <summary>
    /// Updates the view-only IME composition state used by the kickoff input.
    /// The bound <see cref="Idea"/> value is intentionally unchanged until
    /// WPF commits the composition to the TextBox.
    /// </summary>
    internal void SetIdeaCompositionState(bool isComposing)
    {
        if (_isIdeaComposing == isComposing) return;
        _isIdeaComposing = isComposing;
        OnPropertyChanged(nameof(IsIdeaComposing));
        OnPropertyChanged(nameof(ShowIdeaPlaceholder));
    }

    public string? SlotLoadError { get => _slotLoadError; private set { _slotLoadError = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasSlotLoadError)); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); } }
    public string ProjectLabel { get => CurrentSession?.ProjectLabel ?? string.Empty; set { if (CurrentSession is null) return; CurrentSession.ProjectLabel = value; OnPropertyChanged(); } }
    public string ChatLabel { get => CurrentSession?.ChatLabel ?? string.Empty; set { if (CurrentSession is null) return; CurrentSession.ChatLabel = value; OnPropertyChanged(); } }
    public string SessionTitle { get => CurrentSession?.Title ?? "セッションなし"; set { if (CurrentSession is null) return; CurrentSession.Title = value; OnPropertyChanged(); } }
    public GenerationHistoryItem? SelectedHistoryItem
    {
        get => _selectedHistoryItem;
        set
        {
            if (ReferenceEquals(_selectedHistoryItem, value)) return;
            _selectedHistoryItem = value;
            OnPropertyChanged();
            OnPropertyChanged(nameof(SelectedPreviewOutput));
            OnPropertyChanged(nameof(HasSelectedPreviewOutput));
            OnPropertyChanged(nameof(IsSelectedPreviewMissing));
            OnPropertyChanged(nameof(CanSaveSelectedOutputCopy));
            OnPropertyChanged(nameof(ViewingIterationText));
            OnPropertyChanged(nameof(IsViewingLatest));
            OnPropertyChanged(nameof(ViewingStateText));
            OnPropertyChanged(nameof(CanReturnToLatest));
            OnPropertyChanged(nameof(CurrentOutputFolderPath));
            NotifyGenerationDisplayChanged();
        }
    }
    private GenerationHistoryItem? PreviewHistoryItem => IsGenerationInProgress
        && (SelectedHistoryItem?.HasOutput != true || SelectedHistoryItem.PrimaryOutput?.IsMissing == true)
            ? HistoryItems.LastOrDefault(item => item.HasOutput && item.PrimaryOutput?.IsMissing != true)
            : SelectedHistoryItem;
    public OutputArtifact? SelectedPreviewOutput => PreviewHistoryItem?.PrimaryOutput;
    public bool HasSelectedPreviewOutput => SelectedPreviewOutput is not null;
    public bool IsSelectedPreviewMissing => SelectedPreviewOutput?.IsMissing == true;
    // Keep the action available for an artifact whose source disappeared so
    // the click can report a clear user-facing missing-file error.  It is
    // disabled only when the viewer has no selected artifact at all.
    public bool CanSaveSelectedOutputCopy => SelectedPreviewOutput is not null;
    public string ViewingIterationText => PreviewHistoryItem is null ? "VIEWING —" : $"VIEWING ITERATION {PreviewHistoryItem.Number:00}";
    public string LatestIterationText => HistoryItems.LastOrDefault() is { } latest ? $"LATEST ITERATION {latest.Number:00}" : "LATEST —";
    public bool IsViewingLatest => SelectedHistoryItem is not null && ReferenceEquals(SelectedHistoryItem, HistoryItems.LastOrDefault());
    public string ViewingStateText => IsViewingLatest ? "VIEWING LATEST" : SelectedHistoryItem is null ? "NO OUTPUT" : "VIEWING HISTORY";
    public bool CanReturnToLatest => SelectedHistoryItem is not null && HistoryItems.Count > 0 && !IsViewingLatest;
    public bool IsGenerationInProgress
    {
        get
        {
            if (!_isCurrentSessionActivated || CurrentSession is null) return false;
            var generateState = CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Generate).State;
            var outputState = CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Output).State;
            return IsJobActive
                || generateState == CreationStageState.InProgress
                || outputState == CreationStageState.InProgress;
        }
    }
    public bool HasCompletedPreview => HistoryItems.Any(item => item.HasOutput && item.PrimaryOutput?.IsMissing != true);
    public bool ShowOutputEmptyState => !HasSelectedPreviewOutput && !IsGenerationInProgress;
    public bool ShowOutputGeneratingState => !HasSelectedPreviewOutput && IsGenerationInProgress;
    public bool ShowOutputUpdatingState => HasSelectedPreviewOutput && IsGenerationInProgress;
    public string CurrentOutputGenerationLabel => HasCompletedPreview ? "NEXT ITERATION · GENERATING" : "GENERATING";
    public string CurrentOutputGenerationHint => HasCompletedPreview
        ? "直前の完成結果を表示中。完了後に更新されます。"
        : "完了するとここにプレビューが表示されます。";
    public string CurrentOutputGenerationDetail => CurrentSession is not null
        && CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Output).State == CreationStageState.InProgress
        && CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Generate).State != CreationStageState.InProgress
            ? "生成結果を取得中"
            : "ComfyUIで生成中";
    public string SelectedWorkflowText => SelectedWorkflow?.RelativePath ?? "Workflow未選択";
    public string SelectedWorkflowName => SelectedWorkflow is null ? "Workflow未選択" : Path.GetFileNameWithoutExtension(SelectedWorkflow.RelativePath);
    public string ConnectionStateText => ConnectionState switch { ConnectionState.Connected => "CONNECTED", ConnectionState.Connecting => "CONNECTING", ConnectionState.Error => "ERROR", _ => "DISCONNECTED" };
    public string BuildVersion => BuildIdentity.Version;
    public string BuildCommit => BuildIdentity.Commit;
    public string BuildIdentityText => BuildIdentity.Display;
    public BrowserExtensionConnectionState BrowserExtensionConnectionState => _browserExtensionBridge.Status.ConnectionState;
    public string BrowserExtensionConnectionStateText => _browserExtensionBridge.Status.ConnectionStateText;
    public string BrowserExtensionSystemState => BrowserExtensionConnectionStateText;
    public BrowserExtensionPairingState BrowserExtensionPairingState => _browserExtensionBridge.Status.PairingState;
    public string BrowserExtensionPairingStateText => _browserExtensionBridge.Status.PairingStateText;
    public bool IsBrowserExtensionPairingRequired => _browserExtensionBridge.Status.IsPairingRequired;
    public bool IsBrowserExtensionPairingCodeVisible => !string.IsNullOrWhiteSpace(_browserExtensionBridge.Status.PairingCode);
    public string BrowserExtensionPairingCode => _browserExtensionBridge.Status.PairingCode ?? string.Empty;
    public bool IsBrowserExtensionConnected => _browserExtensionBridge.Status.ConnectionState == BrowserExtensionConnectionState.Connected;
    public bool IsBrowserExtensionBridgeRunning => _browserExtensionBridge.Status.IsRunning;
    public ProjectChatCatalogLoadState ChatGptContextLoadState => _contextCatalog.LoadState;
    public string ChatGptContextLoadStateText => ChatGptContextLoadState switch
    {
        ProjectChatCatalogLoadState.Loading => "取得中…",
        ProjectChatCatalogLoadState.Loaded => "取得済み",
        ProjectChatCatalogLoadState.Empty => "履歴なし",
        ProjectChatCatalogLoadState.Disconnected => "Extension未接続",
        ProjectChatCatalogLoadState.Error => "取得エラー",
        _ => "未取得",
    };
    public string ChatGptContextErrorText => _contextCatalog.ErrorMessage ?? string.Empty;
    public bool CanRefreshChatGptContext
        => string.Equals(_contextProvider.ProviderId, ContextProviderIds.ChatGptExtension, StringComparison.OrdinalIgnoreCase)
            && !IsBusy;
    public BrowserExtensionChatGptCurrentContext? CurrentChatGptContext { get; private set; }
    public string BrowserExtensionEndpoint => _browserExtensionBridge.Status.HttpEndpoint;
    public string BrowserExtensionStatusDetail => _browserExtensionBridge.Status.LastError is { Length: > 0 } error
        ? error
        : _browserExtensionBridge.Status.ClientOrigin is { Length: > 0 } origin
            ? $"接続元 {origin}"
            : _browserExtensionBridge.Status.IsPairingRequired
                ? "PopupへPairing codeを入力してください"
            : _browserExtensionBridge.Status.IsRunning
                ? "Extensionの接続を待機中"
                : "Desktop終了時に停止します";
    public ReviewMediaAttachmentSnapshot? ReviewMediaAttachment => _isCurrentSessionActivated ? CurrentSession?.Pipeline.ReviewMediaAttachment : null;
    public bool HasReviewMediaAttachment => ReviewMediaAttachment is not null;
    public ReviewHandoffSnapshot? ReviewHandoff => _isCurrentSessionActivated ? CurrentSession?.Pipeline.ReviewHandoff : null;
    public string AutomaticIterationText
        => CurrentSession?.Pipeline.AutomaticIteration?.State switch
        {
            AutomaticIterationState.Running => "自動Iteration実行中",
            AutomaticIterationState.WaitingForReviewResponse => "ChatGPTレビュー返答待ち",
            AutomaticIterationState.LimitReached => "LIMIT REACHED · 保留generateをRESUME可能",
            AutomaticIterationState.Stopped => "自動Iteration停止 · 手動復旧可能",
            AutomaticIterationState.Failed => "自動Iteration停止 · 再試行可能",
            AutomaticIterationState.Completed => "自動Iteration完了",
            _ => ReviewHandoff?.State switch
            {
                ReviewHandoffState.Preparing => "Review Handoff準備中",
                ReviewHandoffState.Sending => "Review Handoff送信中",
                ReviewHandoffState.WaitingResponse => "ChatGPTレビュー返答待ち",
                ReviewHandoffState.Received => "Review Response受信済み",
                ReviewHandoffState.Failed => "Review Handoff送信失敗 · 再試行可能",
                _ => "Response受信後に自動処理",
            }
        };
    public bool HasAutomaticIterationStatus
        => _isCurrentSessionActivated
            && CurrentSession?.Pipeline.AutomaticIteration is { State: not AutomaticIterationState.None };
    public string ReviewMediaAttachmentStateText => ReviewMediaAttachment?.State switch
    {
        ReviewMediaAttachmentState.Preparing => "生成結果をChatGPTへ添付準備中",
        ReviewMediaAttachmentState.Attaching => "生成結果をChatGPTへ添付中",
        ReviewMediaAttachmentState.Attached => "生成結果をChatGPTへ添付済み · Review Handoff送信待ち",
        ReviewMediaAttachmentState.Failed => $"生成結果のChatGPT添付に失敗 · {ReviewMediaAttachment.ErrorCode ?? "再試行可能"}",
        _ => "生成結果をChatGPTへ添付待ち",
    };
    public bool IsReviewMediaAttachmentFailed => ReviewMediaAttachment?.State == ReviewMediaAttachmentState.Failed;
    public bool CanAttachReviewOutput
    {
        get
        {
            if (!_isCurrentSessionActivated || !IsBrowserExtensionConnected || ReviewMediaAttachment?.State != ReviewMediaAttachmentState.Failed)
                return false;

            var iteration = CurrentSession?.Iterations.FirstOrDefault(item => item.Number == ReviewMediaAttachment.Iteration);
            return iteration is { Status: JobStatus.Completed }
                && iteration.Outputs.FirstOrDefault() is { IsMissing: false };
        }
    }
    public bool IsSystemProcessing => IsBusy || IsJobActive;
    public string ConnectorSystemState => IsSystemProcessing ? "PROCESSING" : "ONLINE";
    public string McpSystemState => IsSystemProcessing && IsConnected ? "PROCESSING" : ConnectionStateText;
    public ComfyUiRuntimeState ComfyUiRuntimeState => _comfyUiRuntimeState;
    public string ComfyUiSystemState => _comfyUiRuntimeState switch
    {
        ComfyUiRuntimeState.Starting => "STARTING",
        ComfyUiRuntimeState.Ready => "READY",
        ComfyUiRuntimeState.Stopped => "STOPPED",
        ComfyUiRuntimeState.Error => "ERROR",
        _ => "UNKNOWN",
    };
    public string GpuSystemState => !IsConnected ? "—" : IsSystemProcessing ? "PROCESSING" : HasGpuEvidence ? "READY" : "UNKNOWN";
    public bool HasGpuEvidence => FindServerInfoNode("gpu") is not null || FindServerInfoNode("gpu_name") is not null || FindServerInfoNode("device") is not null || FindServerInfoNode("hardware") is not null;
    public string SystemConnectionSummary
    {
        get
        {
            var mcp = IsConnected
                ? "MCP接続済み"
                : ConnectionState == ConnectionState.Connecting
                    ? "MCP接続中"
                    : ConnectionState == ConnectionState.Error
                        ? "MCP接続エラー"
                        : "MCP未接続";
            var gpu = HasGpuEvidence ? " · GPU情報確認済み" : string.Empty;
            var extension = BrowserExtensionConnectionStateText switch
            {
                "CONNECTED" => "Extension接続済み",
                "CONNECTING" => "Extension接続中",
                "ERROR" => "Extension接続エラー",
                _ => "Extension未接続",
            };
            return $"{mcp} · {extension} · ComfyUI {ComfyUiSystemState}{gpu}";
        }
    }
    public string CurrentCreationStageText => GetCurrentPipelineStage().Label;
    public string CurrentCreationStageDescription => GetCurrentPipelineStage().Description;
    public string CurrentCreationStageState => GetCurrentPipelineStage().State;
    public GenerateExecutionState CurrentGenerateExecutionState => _isCurrentSessionActivated && CurrentSession is not null
        ? CurrentSession.Pipeline.GenerateExecutionState
        : GenerateExecutionState.ReadyToGenerate;
    public string GenerateExecutionStateText => CreationPipelineStateMachine.GetGenerateExecutionStateLabel(CurrentGenerateExecutionState);
    public string AutomaticResponseExecutionText
    {
        get
        {
            if (!_isCurrentSessionActivated || CurrentSession?.Pipeline.AutomaticResponseExecution is not { } execution)
                return "Response受信後に自動処理";
            return execution.State switch
            {
                AutomaticResponseExecutionState.Validating => "自動Response検証中",
                AutomaticResponseExecutionState.Applying => "自動APPLY中",
                AutomaticResponseExecutionState.Generating => "自動GENERATE中",
                AutomaticResponseExecutionState.Completed => "自動処理済み",
                AutomaticResponseExecutionState.Failed => "自動処理失敗 · 再試行可能",
                _ => "Response受信後に自動処理",
            };
        }
    }
    public string CurrentIterationLabel => !_isCurrentSessionActivated || CurrentSession is null || CurrentSession.Pipeline.IterationNumber == 0 ? "ITERATION —" : CurrentSession.Pipeline.IterationNumber > CurrentSession.CurrentIteration ? $"ITERATION {CurrentSession.Pipeline.IterationNumber:00} · PREP" : $"ITERATION {CurrentSession.CurrentIteration:00}";
    public string PipelineLoopText => CreationPipelineLoopText.Resolve(CurrentSession, _isCurrentSessionActivated, ConnectionState, Idea);
    public string SessionStatusText => CurrentSession?.Status switch
    {
        SessionStatus.LimitReached => "LIMIT REACHED",
        SessionStatus.Completed => "COMPLETED",
        { } status => status.ToString().ToUpperInvariant(),
        null => "NEW",
    };
    public string JobStatusText => CurrentJob is null ? "IDLE" : CurrentJob.Status.ToString().ToUpperInvariant();
    public string JobStatusDetailText => IsGenerationInProgress ? CurrentOutputGenerationDetail : CurrentJob is null ? "生成待機中" : CurrentJob.Status switch { JobStatus.Completed => "生成が完了しました", JobStatus.Failed => "生成に失敗しました", JobStatus.Cancelled => "生成をキャンセルしました", _ => "Jobを確認してください" };
    public string DirtyText => IsDirty ? "UNSAVED CHANGES" : "SAVED";
    public string SessionProgressText => CurrentSession is null
        ? "RUN 01 · 0 / 10 ITERATIONS"
        : $"RUN {(CurrentSession.Pipeline.CurrentRun?.Number ?? 1):00} · {CurrentSession.Pipeline.CurrentRun?.IterationCount ?? CurrentSession.CurrentIteration} / {CurrentSession.MaximumIterations} · TOTAL {CurrentSession.CurrentIteration}";
    public bool HasDeferredGenerate => _isCurrentSessionActivated && CurrentSession?.Pipeline.DeferredGenerate is not null;
    public string DeferredGenerateText => CurrentSession?.Pipeline.DeferredGenerate is null
        ? string.Empty
        : "保留中のgenerateがあります。RESUMEで同じCommandを一度だけAPPLY・GENERATEします。";
    public string CurrentSessionContextText => CurrentSession is null ? "制作セッションなし" : $"{BlankFallback(CurrentSession.ProjectLabel, "Project未設定")}  ·  {BlankFallback(CurrentSession.ChatLabel, "Chat未設定")}";
    public string ProjectPlaceholderText => HasSelectedProject || IsProjectCreateVisible ? string.Empty : "Projectを選択…";
    public string ChatPlaceholderText => !HasSelectedProject ? "先にProjectを選択してください" : HasSelectedChat || IsChatCreateVisible ? string.Empty : "Chatを選択…";
    public string ContextReadinessText => string.Join(Environment.NewLine,
        $"{(HasSelectedWorkflow ? "✓" : "!")} Workflow  {SelectedWorkflowName}",
        $"{(SlotDiscoveryState == SlotDiscoveryState.Loaded ? "✓" : "!")} Slot Schema  {(SlotDiscoveryState == SlotDiscoveryState.Loaded ? $"{Slots.Count} slots" : "未取得")}",
        $"{(ChatGptContextLoadState is ProjectChatCatalogLoadState.Loaded or ProjectChatCatalogLoadState.Empty ? "✓" : "!")} ChatGPT Context  {ChatGptContextLoadStateText}",
        $"{(HasSelectedProject ? "✓" : "!")} Project  {(SelectedProject?.DisplayName ?? "未選択")}",
        $"{(HasSelectedChat ? "✓" : "!")} Chat  {(SelectedChat?.DisplayName ?? "未選択")}",
        $"{(SessionMaximumIterations is >= 1 and <= 1000 ? "✓" : "!")} Maximum Iterations  {SessionMaximumIterations}");
    public string WorkflowSlotSummaryText => !HasSelectedWorkflow ? "左のライブラリからWorkflowを選択" : !IsConnected ? "MCP未接続 · CONNECTでslotを読み込み" : SlotDiscoveryState == SlotDiscoveryState.Loading ? "slotを読み込み中…" : SlotDiscoveryState == SlotDiscoveryState.Failed ? "slotの読み込みに失敗" : SlotDiscoveryState == SlotDiscoveryState.Loaded ? $"主要 {PrimarySlots.Count} · 調整 {TuningSlots.Count} · 詳細 {AdvancedSlots.Count}" : "slotはまだ読み込まれていません";
    public bool IsConnected => ConnectionState == ConnectionState.Connected && _mcp.IsConnected;
    public bool IsComfyUiReachable => _comfyUiRuntimeState == ComfyUiRuntimeState.Ready;
    public bool IsCreationConnectionReady => IsConnected;
    public bool HasSelectedWorkflow => SelectedWorkflow is not null;
    public bool HasTreeNodes => TreeNodes.Count > 0;
    public bool HasSlotLoadError => !string.IsNullOrWhiteSpace(SlotLoadError);
    public bool HasSlots => Slots.Count > 0;
    public bool HasPrimarySlots => PrimarySlots.Count > 0;
    public bool HasTuningSlots => TuningSlots.Count > 0;
    public bool HasAdvancedSlots => AdvancedSlots.Count > 0;
    public bool HasIterations => Iterations.Count > 0;
    public bool HasLatestOutputs => LatestOutputs.Count > 0;
    public bool HasHistoryItems => HistoryItems.Count > 0;
    public bool HasHandoffItems => HandoffItems.Count > 0;
    public bool HasSelectedProject => SelectedProject is { IsCreateAction: false };
    public bool HasSelectedChat => SelectedChat is { IsCreateAction: false };
    public bool CanSelectChat => HasSelectedProject;
    public bool CanCreateChat => HasSelectedProject
        && string.Equals(_contextProvider.ProviderId, ContextProviderIds.LocalJson, StringComparison.OrdinalIgnoreCase);
    public bool HasProjectValidationMessage => !string.IsNullOrWhiteSpace(ProjectValidationMessage);
    public bool HasChatValidationMessage => !string.IsNullOrWhiteSpace(ChatValidationMessage);
    public bool CanStartNewCreation => IsCreationConnectionReady
        && SlotDiscoveryState == SlotDiscoveryState.Loaded
        && HasSelectedWorkflow
        && HasSelectedProject
        && (SelectedProject?.IsTargetResolvable ?? false)
        && HasSelectedChat
        && (SelectedChat?.IsNewConversation != true || SelectedProject?.IsNewConversationTargetResolvable == true)
        && SessionMaximumIterations is >= 1 and <= 1000
        && !IsJobActive;
    public bool CanResumeSession => !_isResumeInProgress
        && _isCurrentSessionActivated
        && IsCreationConnectionReady
        && CurrentSession?.Status is SessionStatus.Completed or SessionStatus.LimitReached or SessionStatus.Paused or SessionStatus.Stopped or SessionStatus.Error;
    public bool IsIdeaInputEnabled => _isCurrentSessionActivated && CurrentSession?.Pipeline.ContextBound == true && !IsJobActive;
    public bool HasIdeaInput => !string.IsNullOrWhiteSpace(Idea);
    public bool IsIdeaComposing => _isIdeaComposing;
    public bool ShowIdeaPlaceholder => IsIdeaInputEnabled && !HasIdeaInput && !IsIdeaComposing;
    public string IdeaInputPlaceholder => $"任意：既存のChatGPT会話への開始指示・補足{Environment.NewLine}空欄：これまでの会話内容をもとに生成を開始";
    public string IdeaInputHint => IsIdeaInputEnabled
        ? "開始指示・補足は任意です。空欄なら既存ChatGPT会話をもとに開始します。"
        : "左側の設定から新しい制作を開始してください。";
    public bool CanResendBootstrapHandoff
        => _isCurrentSessionActivated
            && !HasPendingContextChange
            && !IsJobActive
            && PendingHandoffReuse.TryGetResendableBootstrapPayload(CurrentSession, out _);
    public bool CanResendReviewHandoff
    {
        get
        {
            if (!_isCurrentSessionActivated || IsJobActive || CurrentSession?.PendingHandoff is not { } pending
                || ReviewMediaAttachment?.State != ReviewMediaAttachmentState.Attached)
            {
                return false;
            }

            if (PendingHandoffReuse.IsReview(pending))
            {
                var review = FindReviewHandoff(pending, pending.Iteration);
                return review is { State: HandoffTransportState.Failed or HandoffTransportState.Copied }
                    || (review is null
                        && FindGenerationResultHandoff(pending, pending.Iteration) is { State: HandoffTransportState.Attached });
            }

            // The output context is a separate immutable boundary from the
            // Review request.  Before the first Review request is materialized,
            // the SEND button is still the explicit recovery entry point after
            // attachment verification.
            return PendingHandoffReuse.IsGenerationResult(pending)
                && FindGenerationResultHandoff(pending, pending.Iteration) is { State: HandoffTransportState.Attached }
                && FindReviewHandoff(null, pending.Iteration) is null;
        }
    }
    public bool CanSendToChatGpt
        => CanResendBootstrapHandoff
            || CanResendReviewHandoff
            || (!HasPendingContextChange
                && CurrentSession?.PendingHandoff is null
                && CreationWorkspacePolicy.CanSendToChatGpt(CurrentSession, _isCurrentSessionActivated, IsConnected, SlotDiscoveryState, Idea, IsJobActive));
    public string SendToChatGptButtonText
        => CanResendReviewHandoff
            ? BrowserExtensionConnectionState == BrowserExtensionConnectionState.Disconnected ? "HANDOFFを再コピー" : "CHATGPTへ再送"
            : !CanResendBootstrapHandoff
            ? "SEND TO CHATGPT"
            : BrowserExtensionConnectionState == BrowserExtensionConnectionState.Disconnected
                ? "HANDOFFを再コピー"
                : "CHATGPTへ再送";
    public string SendToChatGptHint
    {
        get
        {
            if (CanResendReviewHandoff)
            {
                return BrowserExtensionConnectionState switch
                {
                    BrowserExtensionConnectionState.Connected => "添付済み生成物を保持したまま、同じReview Handoffを保存済みChatGPTタブへ再送します。",
                    BrowserExtensionConnectionState.Disconnected => "添付済み生成物を保持したまま、同じReview HandoffをClipboardへ再コピーします。",
                    _ => "同じReview Handoffを再試行できます。失敗してもSessionと生成物は保持されます。",
                };
            }

            if (CanResendBootstrapHandoff)
            {
                return BrowserExtensionConnectionState switch
                {
                    BrowserExtensionConnectionState.Connected => "保存済みの同じHandoffを現在アクティブなChatGPTタブへ再送します。IDと本文は変更しません。",
                    BrowserExtensionConnectionState.Disconnected => "保存済みの同じHandoffをClipboardへ再コピーします。",
                    BrowserExtensionConnectionState.Connecting => "保存済みの同じHandoffを再送します。接続結果を確認してください。",
                    _ => "保存済みの同じHandoffを再送します。失敗しても同じHandoffを再試行できます。",
                };
            }

            if (CanSendToChatGpt)
            {
                return BrowserExtensionConnectionState switch
                {
                    BrowserExtensionConnectionState.Connected => "制作コンテキストを現在アクティブなChatGPTタブへ自動送信",
                    BrowserExtensionConnectionState.Disconnected => "制作コンテキストをClipboardへコピー",
                    BrowserExtensionConnectionState.Connecting => "Browser Extensionの接続完了を待って自動送信します。",
                    _ => "Browser Extensionの接続エラーを確認してから送信してください。",
                };
            }

            return !_isCurrentSessionActivated
                ? "左側の設定から新しい制作を開始してください。"
                : !IsConnected
                    ? "MCP接続を確立してください。"
                    : CurrentSession?.Pipeline.ContextBound != true
                        ? "制作ContextをSessionへBindingしてください。"
                        : HasPendingContextChange
                            ? "選択中のContextをSessionへ反映してから送信してください。"
                        : SlotDiscoveryState != SlotDiscoveryState.Loaded
                            ? "WorkflowのSlot Schema取得を完了してください。"
                            : IsJobActive
                                ? "生成中は送信できません。"
                                : "IDEA Stageを確認してください。";
        }
    }
    public bool CanApplyCommand => IsCreationConnectionReady && _isCurrentSessionActivated && _pendingValidation is { IsValid: true, Command: not null } command && command.Command.Action == "generate" && !HasIterationSafetyStop;
    public bool ShowWorkflowEmptyState => !HasSelectedWorkflow;
    public bool ShowDisconnectedState => HasSelectedWorkflow && !IsConnected;
    public bool ShowSlotLoadingState => HasSelectedWorkflow && IsConnected && IsSlotLoading;
    public bool ShowSlotErrorState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && HasSlotLoadError;
    public bool ShowNoSlotState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && !HasSlots;
    public bool ShowReadyState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && HasSlots;
    public bool CanRunWorkflow => IsCreationConnectionReady && _isCurrentSessionActivated && HasSelectedWorkflow && !IsSlotLoading && !HasSlotLoadError && CurrentSession is not null && CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Generate).State is CreationStageState.Current or CreationStageState.WaitingUser or CreationStageState.Error or CreationStageState.Cancelled;
    public bool HasIterationSafetyStop => _isCurrentSessionActivated
        && (CurrentSession?.Pipeline.MaximumIterationSafetyStop == true || CurrentSession?.Status == SessionStatus.LimitReached);
    public bool HasPendingContextChange => _isCurrentSessionActivated && CurrentSession?.Pipeline.ContextBound == true &&
        (SelectedWorkflow?.RelativePath != CurrentSession.BoundWorkflow?.RelativePath || SelectedProject?.ProviderId != CurrentSession.EffectiveContextProviderId || SelectedProject?.Key != CurrentSession.EffectiveProjectContextKey || SelectedChat?.ProviderId != CurrentSession.EffectiveContextProviderId || SelectedChat?.Key != CurrentSession.EffectiveChatContextKey || SessionMaximumIterations != CurrentSession.MaximumIterations);
    public bool IsJobActive => CurrentJob is { Status: JobStatus.Queued or JobStatus.Running };
    public bool IsAutomaticIterationActive
        => _isCurrentSessionActivated
            && CurrentSession?.Pipeline.AutomaticIteration?.State is AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse;
    public bool CanCancelOperation => IsJobActive || IsAutomaticIterationActive;
    public string WorkflowRoot => Path.Combine(Settings.PortableRoot, "ComfyUI", "user", "default", "workflows");
    public string OutputRoot => Path.Combine(Settings.PortableRoot, "ComfyUI", "output");
    public string VideoOutputRoot => Path.Combine(OutputRoot, "video");
    public string CurrentOutputFolderPath
    {
        get
        {
            var outputPath = SelectedPreviewOutput?.FullPath;
            if (!string.IsNullOrWhiteSpace(outputPath))
            {
                var fullOutputPath = Path.GetFullPath(outputPath);
                if (PathSafety.IsWithin(OutputRoot, fullOutputPath))
                {
                    var outputFolder = Directory.Exists(fullOutputPath) ? fullOutputPath : Path.GetDirectoryName(fullOutputPath);
                    if (!string.IsNullOrWhiteSpace(outputFolder) && PathSafety.IsWithin(OutputRoot, outputFolder)) return outputFolder;
                }
            }
            return OutputRoot;
        }
    }

    public async Task InitializeAsync()
    {
        try
        {
            await _browserExtensionBridge.StartAsync();
        }
        catch (Exception ex)
        {
            await _store.LogAsync("bridge", "Browser Extension Bridgeの開始に失敗しました。", ex);
        }

        var saved = await _store.LoadSettingsAsync();
        if (saved is not null)
        {
            Settings.PortableRoot = saved.PortableRoot;
            Settings.ComfyMcpPath = saved.ComfyMcpPath;
            Settings.ComfyCliPath = saved.ComfyCliPath;
            Settings.Endpoint = saved.Endpoint;
            Settings.MaximumIterations = saved.MaximumIterations;
        }
        IsSetupVisible = saved is null || !Settings.IsConfigured;
        Sessions.Clear();
        foreach (var session in await _store.LoadSessionsAsync()) Sessions.Add(session);
        // Persisted sessions are loaded for internal provider bindings and future
        // recovery, but never become the active Workspace on startup.  The
        // visible Workspace always starts from a fresh, non-persisted session.
        _isCurrentSessionActivated = false;
        CurrentSession = NewSessionInternal();
        await InitializeContextProviderAsync();
        SessionMaximumIterations = Settings.MaximumIterations is >= 1 and <= 1000 ? Settings.MaximumIterations : 10;
        Idea = string.Empty;
        CommandText = string.Empty;
        _pendingValidation = null;
        Iterations.Clear();
        LatestOutputs.Clear();
        RebuildHistoryItems();
        HandoffItems.Clear();
        OnPropertyChanged(nameof(HasLatestOutputs));
        OnPropertyChanged(nameof(HasHandoffItems));
        RefreshWorkflowTree();
        await RefreshComfyUiStatusAsync();
        StatusMessage = IsSetupVisible ? "接続先を確認して保存してください。" : "準備完了。ComfyUIの状態を確認できます。";
        OnPropertyChanged(nameof(HasIterations));
        NotifyPipelineStateChanged();
        NotifyConnectionStateChanged();
    }

    public async Task SaveSetupAsync()
    {
        ValidateSettings();
        Settings.ComfyCliPath ??= Path.Combine(Path.GetDirectoryName(Settings.ComfyMcpPath)!, "comfy.exe");
        await _store.SaveSettingsAsync(Settings);
        IsSetupVisible = false;
        RefreshWorkflowTree();
        await RefreshComfyUiStatusAsync();
        StatusMessage = "設定をPortable領域へ保存しました。Connectを押してMCPへ接続してください。";
    }

    public void ShowSetup() => IsSetupVisible = true;

    public void ShowWorkflowEditor() => IsWorkflowEditorVisible = true;

    public void HideWorkflowEditor() => IsWorkflowEditorVisible = false;

    public void BeginWorkflowRename()
    {
        if (SelectedWorkflow is null) return;
        WorkflowRenameText = SelectedWorkflowName;
        IsWorkflowRenameVisible = true;
        StatusMessage = "Workflow名を入力してEnterで確定、Escでキャンセルしてください。";
    }

    public void CancelWorkflowRename()
    {
        IsWorkflowRenameVisible = false;
        WorkflowRenameText = string.Empty;
    }

    public async Task CommitWorkflowRenameAsync()
    {
        if (!IsWorkflowRenameVisible) return;
        await RenameWorkflowAsync(WorkflowRenameText);
        IsWorkflowRenameVisible = false;
        WorkflowRenameText = string.Empty;
    }

    public async Task ConnectAsync()
    {
        ValidateSettings();
        IsBusy = true;
        _serverInfo = null;
        ConnectionState = ConnectionState.Connecting;
        SynchronizePipelineConnectionGate();
        try
        {
            await _mcp.ConnectAsync(Settings);
            ConnectionState = ConnectionState.Connected;
            SynchronizePipelineConnectionGate();
            try
            {
                _serverInfo = await _mcp.CallAsync("server_info", new Dictionary<string, object?>());
            }
            catch (Exception ex) when (_mcp.IsConnected)
            {
                _serverInfo = null;
                await _store.LogAsync("connection", $"ComfyUI状態確認を延期しました: {ex.Message}", ex);
            }
            // MCP's server_info is retained for optional GPU/server details,
            // but ComfyUI readiness always comes from the direct endpoint.
            await RefreshComfyUiStatusAsync();
            NotifyConnectionStateChanged();
            StatusMessage = $"MCP接続を確認しました。ComfyUIは{ComfyUiSystemState}です。";
            if (SelectedWorkflow is not null) await SelectWorkflowAsync(SelectedWorkflow.RelativePath);
        }
        catch (Exception ex)
        {
            ConnectionState = ConnectionState.Error;
            SynchronizePipelineConnectionGate(ex.Message);
            StatusMessage = $"MCP接続に失敗しました: {ex.Message}";
            await _store.LogAsync("connection", StatusMessage, ex);
            await SaveActiveSessionAsync();
        }
        finally { IsBusy = false; }
    }

    public async Task DisconnectAsync()
    {
        // Invalidate an in-flight list_workflow_slots request before changing
        // the connection gate.  Its continuation may arrive after disconnect;
        // it must not repopulate the visible collections with a stale schema.
        Interlocked.Increment(ref _slotDiscoveryVersion);
        await _mcp.DisconnectAsync();
        // A selection can begin while the transport is still completing its
        // shutdown. Invalidate that narrow race as well once disconnect has
        // finished and the connection state is authoritative.
        Interlocked.Increment(ref _slotDiscoveryVersion);
        _serverInfo = null;
        ConnectionState = ConnectionState.Disconnected;
        SynchronizePipelineConnectionGate();
        SlotDiscoveryState = SlotDiscoveryState.NotLoaded;
        IsSlotLoading = false;
        StatusMessage = "MCPを切断しました。ComfyUIは終了していません。";
        await SaveActiveSessionAsync();
    }

    public async Task ShutdownAsync()
    {
        try
        {
            await DisconnectAsync();
        }
        finally
        {
            await _browserExtensionBridge.StopAsync();
        }
    }

    public void RefreshWorkflowTree()
    {
        TreeNodes.Clear();
        foreach (var node in _catalog.BuildTree(WorkflowRoot)) TreeNodes.Add(node);
        OnPropertyChanged(nameof(HasTreeNodes));
        StatusMessage = Directory.Exists(WorkflowRoot) ? $"Workflowを{TreeNodes.Count}件読み込みました。" : "Workflowフォルダが見つかりません。Setupのパスを確認してください。";
    }

    public async Task SelectWorkflowAsync(string relativePath)
    {
        var identity = WorkflowIdentity.Create(relativePath);
        var loadVersion = Interlocked.Increment(ref _slotDiscoveryVersion);
        SelectedWorkflow = identity;
        Slots.Clear();
        PrimarySlots.Clear();
        TuningSlots.Clear();
        AdvancedSlots.Clear();
        Backups.Clear();
        SlotLoadError = null;
        SlotDiscoveryState = SlotDiscoveryState.NotLoaded;
        NotifySlotCollectionsChanged();
        var path = identity.ToAbsolute(WorkflowRoot);
        _loadedFingerprint = File.Exists(path) ? WorkflowCatalog.ComputeFingerprint(path) : null;
        if (!IsConnected)
        {
            IsSlotLoading = false;
            StatusMessage = "Workflowを選択しました。slot取得にはMCP接続が必要です。";
            return;
        }

        IsBusy = true;
        IsSlotLoading = true;
        SlotDiscoveryState = SlotDiscoveryState.Loading;
        try
        {
            var discovered = await _catalog.DiscoverSlotsAsync(identity, WorkflowRoot);
            // A stale response must never append into the collections owned by
            // a newer selection. This is also what prevents two identical
            // list_workflow_slots responses from becoming a doubled Handoff
            // schema when selection/reconnect events overlap.
            if (!IsCurrentSlotDiscovery(loadVersion, identity)) return;

            foreach (var slot in discovered)
            {
                var item = new SlotEditorItem(slot);
                item.PropertyChanged += SlotChanged;
                Slots.Add(item);
                switch (item.Priority)
                {
                    case SlotPriority.Primary: PrimarySlots.Add(item); break;
                    case SlotPriority.Tuning: TuningSlots.Add(item); break;
                    default: AdvancedSlots.Add(item); break;
                }
            }
            foreach (var backup in await _store.ListWorkflowBackupsAsync(identity)) Backups.Add(backup);
            IsDirty = false;
            SlotDiscoveryState = SlotDiscoveryState.Loaded;
            NotifySlotCollectionsChanged();
            StatusMessage = $"{Slots.Count}個のslotを読み込みました。";
        }
        catch (Exception ex)
        {
            if (!IsCurrentSlotDiscovery(loadVersion, identity)) return;
            MarkConnectionFailureIfTransportClosed(ex);
            SlotLoadError = ex.Message;
            SlotDiscoveryState = SlotDiscoveryState.Failed;
            StatusMessage = $"slot取得に失敗しました: {ex.Message}";
            await _store.LogAsync("workflow", StatusMessage, ex);
        }
        finally
        {
            if (IsCurrentSlotDiscovery(loadVersion, identity))
            {
                IsSlotLoading = false;
                IsBusy = false;
                NotifySlotCollectionsChanged();
            }
        }
    }

    public void DiscardChanges()
    {
        if (SelectedWorkflow is null) return;
        _ = SelectWorkflowAsync(SelectedWorkflow.RelativePath);
    }

    public async Task ApplySlotsAsync()
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        EnsureMcpConnectionReady();
        var path = SelectedWorkflow.ToAbsolute(WorkflowRoot);
        if (_loadedFingerprint is not null && File.Exists(path) && !string.Equals(_loadedFingerprint, WorkflowCatalog.ComputeFingerprint(path), StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Workflowが外部で変更されています。再読み込みしてから保存してください。");
        }

        var changes = BuildChanges();
        var trackApply = CurrentSession is not null && CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Apply).State is CreationStageState.Current or CreationStageState.Error or CreationStageState.InProgress;
        if (trackApply) CreationPipelineStateMachine.BeginApply(CurrentSession!);
        IsBusy = true;
        try
        {
            if (changes.Count > 0) await _catalog.ApplySlotsAsync(SelectedWorkflow, WorkflowRoot, changes);
            else
            {
                var validation = await _catalog.ValidateAsync(SelectedWorkflow, WorkflowRoot);
                if (validation?["valid"]?.GetValue<bool>() != true) throw new InvalidOperationException("Workflowのvalidateに失敗しました。");
            }
            _loadedFingerprint = WorkflowCatalog.ComputeFingerprint(path);
            IsDirty = false;
            foreach (var item in Slots.Where(item => changes.ContainsKey(item.Address))) item.AcceptCurrentValue();
            if (trackApply) CreationPipelineStateMachine.ApplyCompleted(CurrentSession!);
            foreach (var backup in await _store.ListWorkflowBackupsAsync(SelectedWorkflow)) { if (!Backups.Contains(backup)) Backups.Add(backup); }
            StatusMessage = "Workflowをbackup → apply → validateしました。";
            await SaveActiveSessionAsync();
        }
        catch (Exception ex)
        {
            MarkConnectionFailureIfTransportClosed(ex);
            if (trackApply) CreationPipelineStateMachine.ApplyFailed(CurrentSession!, ex.Message);
            await SaveActiveSessionAsync();
            throw;
        }
        finally { IsBusy = false; }
    }

    public async Task ValidateCurrentAsync()
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        if (!IsConnected) throw new InvalidOperationException("MCPに接続してください。");
        var result = await _catalog.ValidateAsync(SelectedWorkflow, WorkflowRoot);
        var valid = result?["valid"]?.GetValue<bool>();
        StatusMessage = valid == true ? "Workflowのvalidateに成功しました。" : valid == false ? "Workflowのvalidateが失敗しました。内容を確認してください。" : "Workflowのvalidate結果を判定できませんでした。";
    }

    public async Task DuplicateWorkflowAsync(string name)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        var source = SelectedWorkflow.ToAbsolute(WorkflowRoot);
        var safeName = NormalizeWorkflowName(name);
        var destination = Path.Combine(Path.GetDirectoryName(source)!, safeName + ".json");
        PathSafety.RequireWithin(WorkflowRoot, destination);
        if (File.Exists(destination)) throw new InvalidOperationException("同名Workflowが既に存在します。上書きはしません。");
        File.Copy(source, destination);
        RefreshWorkflowTree();
        await SelectWorkflowAsync(Path.GetRelativePath(WorkflowRoot, destination).Replace('\\', '/'));
        StatusMessage = $"Workflowを複製しました: {safeName}";
    }

    public async Task DuplicateWorkflowAndBeginRenameAsync()
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        var source = SelectedWorkflow.ToAbsolute(WorkflowRoot);
        var directory = Path.GetDirectoryName(source) ?? WorkflowRoot;
        var stem = Path.GetFileNameWithoutExtension(source);
        var baseName = NormalizeWorkflowName($"{stem} - コピー");
        var safeName = baseName;
        var suffix = 2;
        while (File.Exists(Path.Combine(directory, safeName + ".json"))) safeName = $"{baseName} {suffix++}";
        var destination = Path.Combine(directory, safeName + ".json");
        PathSafety.RequireWithin(WorkflowRoot, destination);
        File.Copy(source, destination);
        RefreshWorkflowTree();
        await SelectWorkflowAsync(Path.GetRelativePath(WorkflowRoot, destination).Replace('\\', '/'));
        WorkflowRenameText = safeName;
        IsWorkflowRenameVisible = true;
        StatusMessage = "Workflowを複製しました。新しい名前を入力してEnterで確定してください。";
    }

    public async Task RenameWorkflowAsync(string name)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        var source = SelectedWorkflow.ToAbsolute(WorkflowRoot);
        var safeName = NormalizeWorkflowName(name);
        var destination = Path.Combine(Path.GetDirectoryName(source)!, safeName + ".json");
        PathSafety.RequireWithin(WorkflowRoot, destination);
        if (File.Exists(destination)) throw new InvalidOperationException("同名Workflowが既に存在します。上書きはしません。");
        File.Move(source, destination);
        var newIdentity = WorkflowIdentity.Create(Path.GetRelativePath(WorkflowRoot, destination).Replace('\\', '/'));
        if (CurrentSession?.BoundWorkflow?.RelativePath.Equals(SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase) == true) CurrentSession.BoundWorkflow = newIdentity;
        RefreshWorkflowTree();
        await SelectWorkflowAsync(newIdentity.RelativePath);
        await SaveActiveSessionAsync();
        StatusMessage = $"Workflowの名前を変更しました: {safeName}";
    }

    public async Task CreateProjectAsync()
    {
        var name = NormalizeContextName(NewProjectName, "Project");
        if (ProjectOptions.Any(project => !project.IsCreateAction && string.Equals(project.DisplayName, name, StringComparison.OrdinalIgnoreCase)))
        {
            ProjectValidationMessage = "同名のProjectが既にあります。";
            throw new InvalidOperationException(ProjectValidationMessage);
        }
        var project = await _contextProvider.CreateProjectAsync(name);
        await ReloadContextOptionsAsync(project.Key);
        IsProjectCreateVisible = false;
        NewProjectName = string.Empty;
        StatusMessage = $"Projectを作成しました ({_contextProvider.ProviderId}): {name}";
    }

    /// <summary>
    /// Explicitly refreshes the metadata-only Project/Chat catalog from the
    /// authenticated ChatGPT Extension.  A refresh never changes an active
    /// session's bound conversation; it only preserves the draft selection
    /// when the same stable IDs are still present.
    /// </summary>
    public async Task RefreshChatGptContextAsync(CancellationToken cancellationToken = default)
    {
        if (!string.Equals(_contextProvider.ProviderId, ContextProviderIds.ChatGptExtension, StringComparison.OrdinalIgnoreCase))
            return;

        var preferredProjectKey = _selectedProject?.Key;
        var preferredChatKey = _selectedChat?.Key;
        await ReloadContextOptionsAsync(preferredProjectKey, preferredChatKey, cancellationToken);
        StatusMessage = ChatGptContextLoadState switch
        {
            ProjectChatCatalogLoadState.Loaded => "ChatGPTのProject / Chat履歴を更新しました。",
            ProjectChatCatalogLoadState.Empty => "ChatGPTのProject / Chat履歴は空です。",
            ProjectChatCatalogLoadState.Disconnected => "Extension未接続のためChatGPT履歴を取得できません。",
            ProjectChatCatalogLoadState.Error => $"ChatGPT履歴の取得に失敗しました。{ChatGptContextErrorText}",
            _ => "ChatGPTのProject / Chat履歴を更新しました。",
        };
    }

    public async Task CreateChatAsync()
    {
        if (!HasSelectedProject) throw new InvalidOperationException("先にProjectを選択してください。");
        var name = NormalizeContextName(NewChatName, "Chat");
        if (SelectedProject!.Chats.Any(chat => string.Equals(chat.DisplayName, name, StringComparison.OrdinalIgnoreCase)))
        {
            ChatValidationMessage = "同名のChatがこのProjectに既にあります。";
            throw new InvalidOperationException(ChatValidationMessage);
        }
        var chat = await _contextProvider.CreateChatAsync(SelectedProject, name);
        await ReloadContextOptionsAsync(SelectedProject.Key, chat.Key);
        IsChatCreateVisible = false;
        NewChatName = string.Empty;
        StatusMessage = $"Chatを作成しました ({_contextProvider.ProviderId}): {name}";
    }

    public void CancelProjectCreation()
    {
        IsProjectCreateVisible = false;
        NewProjectName = string.Empty;
        ProjectValidationMessage = string.Empty;
        RefreshProjectOptions();
    }

    public void CancelChatCreation()
    {
        IsChatCreateVisible = false;
        NewChatName = string.Empty;
        ChatValidationMessage = string.Empty;
        RefreshChatOptions();
    }

    public async Task StartNewCreationAsync()
    {
        ValidateNewCreationSetup();
        RevokeReviewMediaRegistration(CurrentSession);
        var session = new CreationSession
        {
            Title = $"{SelectedProject!.DisplayName} / {SelectedChat!.DisplayName}",
            ProjectLabel = SelectedProject.DisplayName,
            ChatLabel = SelectedChat.DisplayName,
            ProjectId = SelectedProject.ExternalId,
            ConversationId = SelectedChat.ExternalId,
            MaximumIterations = SessionMaximumIterations,
            BoundWorkflow = SelectedWorkflow,
        };
        BindSessionContext(session, SelectedProject, SelectedChat);
        SynchronizePipelineConnectionGate(session);
        Sessions.Insert(0, session);
        CurrentSession = session;
        CreationPipelineStateMachine.BindContext(session);
        _isCurrentSessionActivated = true;
        ResetSessionWorkspace(session);
        await _store.SaveSessionAsync(session);
        NotifyPipelineStateChanged();
        StatusMessage = "新しい制作を開始しました。中央の開始指示・補足から進めてください。入力は任意です。";
    }

    public async Task ApplySelectedContextToCurrentSessionAsync()
    {
        ValidateNewCreationSetup();
        if (!_isCurrentSessionActivated || CurrentSession is null) throw new InvalidOperationException("先に新しい制作を開始してください。");
        RevokeReviewMediaRegistration(CurrentSession);
        CurrentSession.ProjectLabel = SelectedProject!.DisplayName;
        CurrentSession.ChatLabel = SelectedChat!.DisplayName;
        CurrentSession.ProjectId = SelectedProject.ExternalId;
        CurrentSession.ConversationId = SelectedChat.ExternalId;
        CurrentSession.BoundWorkflow = SelectedWorkflow;
        CurrentSession.MaximumIterations = SessionMaximumIterations;
        CurrentSession.Title = $"{SelectedProject.DisplayName} / {SelectedChat.DisplayName}";
        BindSessionContext(CurrentSession, SelectedProject, SelectedChat);
        SynchronizePipelineConnectionGate(CurrentSession);
        CreationPipelineStateMachine.BindContext(CurrentSession);
        _isCurrentSessionActivated = true;
        await SaveActiveSessionAsync();
        OnPropertyChanged(nameof(CurrentSessionContextText));
        OnPropertyChanged(nameof(SessionTitle));
        OnPropertyChanged(nameof(SessionProgressText));
        OnPropertyChanged(nameof(HasPendingContextChange));
        NotifyPipelineStateChanged();
        StatusMessage = "現在の制作セッションへ新しいContextをBindingしました。履歴は保持されています。";
    }

    public async Task SaveSessionAsync()
    {
        if (!_isCurrentSessionActivated || CurrentSession is null) return;
        CurrentSession.OriginalIdea = Idea;
        await SaveActiveSessionAsync();
        StatusMessage = "制作セッションを保存しました。";
    }

    private Task SaveActiveSessionAsync()
        => !_isCurrentSessionActivated || CurrentSession is null
            ? Task.CompletedTask
            : _store.SaveSessionAsync(CurrentSession);

    public async Task GenerateAsync(bool applyFirst = true)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        EnsureMcpConnectionReady();
        if (IsJobActive) throw new InvalidOperationException("Connectorが管理中のJobは1件だけです。");
        if (CurrentSession is null || !CurrentSession.Pipeline.ContextBound) throw new InvalidOperationException("左側から新しい制作を開始してください。");
        if (CurrentSession.BoundWorkflow is null || !string.Equals(CurrentSession.BoundWorkflow.RelativePath, SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("セッションに紐づくWorkflowと選択中Workflowが異なります。");
        if (CurrentSession.Pipeline.MaximumIterationSafetyStop) throw new InvalidOperationException("最大反復回数に達しました。続行するか制作を終了するか選択してください。");
        // Keep the whole request (including the ComfyUI startup wait) inside
        // one gate.  A second click while the first request is starting must
        // not launch another process or submit the same workflow twice.
        if (!await _generationGate.WaitAsync(0)) throw new InvalidOperationException("生成処理を実行中です。完了するまでお待ちください。");
        try
        {
            await GenerateCoreAsync(applyFirst);
        }
        finally
        {
            _generationGate.Release();
        }
    }

    private async Task GenerateCoreAsync(bool applyFirst)
    {
        var session = CurrentSession ?? throw new InvalidOperationException("左側から新しい制作を開始してください。");
        var workflow = SelectedWorkflow ?? throw new InvalidOperationException("Workflowを選択してください。");
        if (session.Pipeline.AutomaticIteration?.State == AutomaticIterationState.Stopped)
        {
            StatusMessage = "自動Iterationは停止しています。RESUMEまたは明示的な再試行を行ってください。";
            return;
        }
        var changes = BuildChanges();
        if (applyFirst && (IsDirty || CreationPipelineStateMachine.Get(session, CreationStage.Apply).State != CreationStageState.Completed)) await ApplySlotsAsync();
        await EnsureComfyUiForStageAsync(session, CreationStage.Generate);
        // Starting a new generation invalidates any previous temporary
        // Review media registration. The state machine clears its persisted
        // attachment projection at the same boundary below.
        RevokeReviewMediaRegistration(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        var prompt = FindPrompt(changes) ?? Idea;
        var iteration = session.StartIteration(prompt, changes);
        await SaveActiveSessionAsync();
        OnPropertyChanged(nameof(SessionStatusText));
        OnPropertyChanged(nameof(SessionProgressText));
        Iterations.Add(iteration);
        var historyItem = new GenerationHistoryItem(iteration);
        var previousPreviewItem = HistoryItems.LastOrDefault(item => item.HasOutput && item.PrimaryOutput?.IsMissing != true);
        HistoryItems.Add(historyItem);
        RefreshHistoryFlags();
        // Keep the last completed preview visible while a later iteration is
        // running. The new iteration remains in HISTORY with its live status;
        // once it produces output, MonitorJobAsync selects it below.
        SelectedHistoryItem = previousPreviewItem ?? historyItem;
        OnPropertyChanged(nameof(HasIterations));
        NotifyHistoryChanged();
        NotifyPipelineStateChanged();
        IsBusy = true;
        try
        {
            CurrentJob = await _catalog.RunAsync(workflow, WorkflowRoot);
            iteration.JobId = CurrentJob.JobId;
            iteration.Status = CurrentJob.Status;
            CreationPipelineStateMachine.JobStatusChanged(session, CurrentJob.Status, CurrentJob.Message);
            await SaveActiveSessionAsync();
            StatusMessage = $"Job {CurrentJob.JobId} を投入しました。進捗率は推測せず状態だけ表示します。";
            await MonitorJobAsync(iteration);
        }
        catch (Exception ex)
        {
            if (session.Pipeline.AutomaticIteration?.State == AutomaticIterationState.Stopped)
            {
                CurrentJob = null;
                await SaveActiveSessionAsync();
                NotifyPipelineStateChanged();
                return;
            }
            MarkConnectionFailureIfTransportClosed(ex);
            iteration.Status = JobStatus.Failed;
            iteration.Error = ex.Message;
            session.Status = SessionStatus.Error;
            session.LastError = ex.Message;
            if (CreationPipelineStateMachine.Get(session, CreationStage.Generate).State != CreationStageState.Completed)
                CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Failed, ex.Message);
            else
                CreationPipelineStateMachine.OutputFailed(session, ex.Message);
            CurrentJob = null;
            await SaveActiveSessionAsync();
            RefreshHistoryFlags();
            NotifySelectedPreviewChanged();
            OnPropertyChanged(nameof(SessionStatusText));
            NotifyPipelineStateChanged();
            StatusMessage = $"生成に失敗しました: {ex.Message}";
            await _store.LogAsync("generation", StatusMessage, ex);
        }
        finally { IsBusy = false; }
    }

    public async Task ImportCommandAsync(bool clearCommandOnComplete = true)
    {
        if (CurrentSession is null) throw new InvalidOperationException("先に新しい制作を開始してください。");
        if (CurrentSession.PendingHandoff is null)
        {
            throw new InvalidOperationException("先にSEND TO CHATGPTで制作ContextをHandoffしてください。");
        }
        if (HasPendingContextChange
            || !string.Equals(CurrentSession.BoundWorkflow?.RelativePath, SelectedWorkflow?.RelativePath, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(CurrentSession.BoundWorkflow?.RelativePath, CurrentSession.PendingHandoff.WorkflowIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Handoff作成後に制作Contextが変更されています。現在のContextをChatGPTへ送り直してください。");
        CreationPipelineStateMachine.BeginCommandValidation(CurrentSession);
        NotifyPipelineStateChanged();
        _pendingValidation = ConnectorProtocol.Parse(CommandText, CurrentSession.PendingHandoff);
        if (!_pendingValidation.IsValid)
        {
            var detail = _pendingValidation.DiagnosticText;
            CreationPipelineStateMachine.CommandValidationFailed(CurrentSession, detail);
            await _store.LogAsync("protocol.validation", detail);
            await SaveActiveSessionAsync();
            OnPropertyChanged(nameof(CanApplyCommand)); StatusMessage = _pendingValidation.UserMessage; NotifyPipelineStateChanged(); return;
        }
        OnPropertyChanged(nameof(CanApplyCommand));
        StatusMessage = _pendingValidation.UserMessage + " 「適用」から反映できます。";
        try
        {
            var command = _pendingValidation.Command!;
            CreationPipelineStateMachine.CommandValidated(CurrentSession, command.Action);
            await RecordHandoffAsync(new HandoffMessage
            {
                Direction = HandoffDirection.ChatGptToComfy,
                Kind = command.Action == "complete" ? HandoffMessageKind.Complete : HandoffMessageKind.GenerationCommand,
                State = HandoffTransportState.Received,
                Title = command.Action == "complete" ? "制作完了の指示" : "生成指示",
                DisplayText = BuildCommandTimelineDisplay(command),
                Metadata = BuildCommandTimelineMetadata(command),
                Summary = BuildCommandTimelineSummary(command),
                Payload = CommandText,
            });
            if (command.Action == "complete")
            {
                await CompleteSessionAsync(command.Reason ?? "ChatGPT completed the session.", chatGptComplete: true);
                MarkLatestCommandCompleted(CommandText);
                await SaveActiveSessionAsync();
                // The accepted command remains in the timeline above, while
                // the editor is only a temporary buffer for an unprocessed
                // response.  Clear it only after the complete transition and
                // persistence have succeeded; all validation/error paths keep
                // the user's text intact.
                if (clearCommandOnComplete) ClearAppliedCommandInput();
            }
        }
        catch (Exception ex)
        {
            if (!_pendingValidation.Errors.Contains(ex.Message)) _pendingValidation.Errors.Add(ex.Message);
            StatusMessage = ex.Message;
            await SaveActiveSessionAsync();
        }
        OnPropertyChanged(nameof(CanApplyCommand));
        NotifyPipelineStateChanged();
    }

    public Task ApplyCommandAsync(bool generate)
        => ApplyCommandCoreAsync(generate, clearCommandOnApply: true);

    private async Task ApplyCommandCoreAsync(
        bool generate,
        bool clearCommandOnApply,
        Action? afterApply = null)
    {
        if (_pendingValidation is not { IsValid: true, Command: not null } validation) { await ImportCommandAsync(); validation = _pendingValidation; }
        if (validation is not { IsValid: true, Command: not null } commandResult) throw new InvalidOperationException(string.Join(" ", validation?.Errors ?? []));
        if (commandResult.Command.Action != "generate") throw new InvalidOperationException("このcommandはgenerateではありません。");
        foreach (var item in Slots) if (commandResult.Command.Parameters.TryGetPropertyValue(item.Address, out var value) && value is not null) item.ValueText = value is JsonValue v && v.TryGetValue<string>(out var text) ? text : value.ToJsonString();
        IsDirty = true;
        NotifyPipelineStateChanged();
        if (generate)
        {
            // Apply first. The manual button clears its temporary command at
            // the exact point where APPLY succeeds, then GenerateAsync(false)
            // performs the normal ComfyUI gate without applying twice. The
            // automatic Response path passes clearCommandOnApply:false so a
            // later startup/generation failure retains the command for retry.
            await ApplySlotsAsync();
            afterApply?.Invoke();
            if (clearCommandOnApply) ClearAppliedCommandInput();
            if (CurrentSession?.Pipeline.AutomaticIteration?.State == AutomaticIterationState.Stopped)
            {
                await SaveActiveSessionAsync();
                return;
            }
            await GenerateAsync(applyFirst: false);
        }
        else
        {
            await ApplySlotsAsync();
            afterApply?.Invoke();
            if (clearCommandOnApply) ClearAppliedCommandInput();
        }
    }

    private void ClearAppliedCommandInput()
    {
        // Clearing through the public setter would look like a replacement
        // and reset the command stage. APPLY has already completed, so only
        // discard the transient validation buffer and notify the binding.
        _pendingValidation = null;
        _commandText = string.Empty;
        OnPropertyChanged(nameof(CommandText));
        OnPropertyChanged(nameof(CanApplyCommand));
        NotifyPipelineStateChanged();
    }

    public void ReturnToLatestOutput()
    {
        SelectedHistoryItem = HistoryItems.LastOrDefault(item => item.HasOutput && item.PrimaryOutput?.IsMissing != true)
            ?? HistoryItems.LastOrDefault();
    }

    public async Task<string> PrepareBootstrapHandoffAsync()
    {
        await _bootstrapHandoffGate.WaitAsync();
        try
        {
            return await PrepareBootstrapHandoffCoreAsync();
        }
        finally
        {
            _bootstrapHandoffGate.Release();
        }
    }

    /// <summary>
    /// Prepares the initial Bootstrap Handoff or returns the already persisted
    /// body for an explicit retry. A retry is deliberately resolved before the
    /// normal IDEA-stage validation because COPIED/FAILED means that the
    /// original pipeline boundary has already been issued.
    /// </summary>
    public async Task<string> PrepareBootstrapHandoffForSendAsync()
    {
        await _bootstrapHandoffGate.WaitAsync();
        try
        {
            // Phase 5.2 reuses the initial UI action for an explicit Review
            // retry.  The saved Review body is immutable and must be returned
            // before Bootstrap-stage validation can reject the completed
            // session.  No identity or payload is rebuilt for an existing
            // Review boundary.
            if (CurrentSession?.PendingHandoff is { } reviewPending && PendingHandoffReuse.IsReview(reviewPending))
            {
                var reviewMessage = FindReviewHandoff(reviewPending, reviewPending.Iteration)
                    ?? FindGenerationResultHandoff(reviewPending, reviewPending.Iteration);
                if (HandoffPayloadReuse.TryGetSavedPayload(reviewMessage, out var reviewPayload))
                    return reviewPayload;

                return await PrepareReviewHandoffForSendAsync();
            }

            // A completed output is not itself the Review request.  Materialize
            // a new Review PendingHandoff from that result before the transport
            // layer is called, so every Review boundary receives fresh IDs.
            if (CurrentSession?.PendingHandoff is { } resultPending
                && PendingHandoffReuse.IsGenerationResult(resultPending))
            {
                return await PrepareReviewHandoffForSendAsync();
            }

            if (PendingHandoffReuse.TryGetResendableBootstrapPayload(CurrentSession, out var savedPayload))
            {
                return savedPayload;
            }

            return await PrepareBootstrapHandoffCoreAsync();
        }
        finally
        {
            _bootstrapHandoffGate.Release();
        }
    }

    private async Task<string> PrepareBootstrapHandoffCoreAsync()
    {
        EnsureSendToChatGptAllowed();
        if (CurrentSession is null || CurrentSession.BoundWorkflow is null) throw new InvalidOperationException("左の設定から新しい制作を開始してください。");
        if (SelectedWorkflow is null || !string.Equals(CurrentSession.BoundWorkflow.RelativePath, SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("現在の制作セッションと選択中Workflowが一致しません。左から新しい制作を開始してください。");
        }
        if (string.IsNullOrWhiteSpace(CurrentSession.ProjectLabel) || string.IsNullOrWhiteSpace(CurrentSession.ChatLabel)) throw new InvalidOperationException("ProjectとChatを設定して新しい制作を開始してください。");
        EnsureSlotSchemaAvailable();

        var kickoffInstruction = Idea;
        var currentSlots = Slots.Select(ToWorkflowSlot).ToList();
        var pending = CurrentSession.PendingHandoff;
        var canReusePending = PendingHandoffReuse.MatchesBootstrap(CurrentSession, pending, currentSlots, kickoffInstruction);
        if (!canReusePending)
        {
            // This is the explicit first send (or an explicit re-send after a
            // context/kickoff change). Only this path is allowed to issue a
            // replacement handoff identity.
            CurrentSession.OriginalIdea = kickoffInstruction;
            pending = PendingHandoffFactory.Create(CurrentSession, currentSlots, "generate");
            CurrentSession.PendingHandoff = pending;
        }
        else
        {
            // Keep the session's editable value current, while the issued
            // snapshot (including its captured kickoff) remains immutable.
            CurrentSession.OriginalIdea = kickoffInstruction;
        }

        var existingMessage = CurrentSession.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ConnectorToChatGpt
            && item.Kind == HandoffMessageKind.CreationRequest
            && item.IterationNumber is null);
        if (canReusePending
            && HandoffPayloadReuse.TryGetSavedPayload(existingMessage, out var savedPayload)
            && PendingHandoffReuse.MatchesPayload(pending!, savedPayload))
        {
            await SaveSessionAsync();
            return savedPayload;
        }

        var payload = ConnectorContextBuilder.BuildBootstrap(CurrentSession, pending!);
        await SaveSessionAsync();
        return payload;
    }

    public async Task<string> PrepareResultHandoffAsync(SessionIteration? selectedIteration = null)
    {
        if (CurrentSession is null) throw new InvalidOperationException("制作セッションがありません。");
        var iteration = selectedIteration ?? CurrentSession.Iterations.LastOrDefault() ?? throw new InvalidOperationException("ChatGPTへ渡せる生成結果がありません。");
        var existingMessage = CurrentSession.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ComfyToChatGpt &&
            item.Kind == HandoffMessageKind.GenerationResult &&
            item.IterationNumber == iteration.Number);
        if (HandoffPayloadReuse.TryGetSavedPayload(existingMessage, out var savedPayload))
        {
            // Result Handoff payloads are immutable copy material once
            // persisted. Re-copying must not rotate the active Review
            // PendingHandoff or rebuild the payload from the current editor
            // state.
            return savedPayload;
        }
        if (iteration.Status != JobStatus.Completed || iteration.Outputs.All(output => output.IsMissing)) throw new InvalidOperationException("成功した生成結果だけをChatGPTへ渡せます。");
        EnsureSlotSchemaAvailable();
        var resultPending = CurrentSession.PendingHandoff is { } currentPending
            && PendingHandoffReuse.IsGenerationResult(currentPending)
            && currentPending.Iteration == iteration.Number
            ? currentPending
            : PendingHandoffFactory.CreateGenerationResult(CurrentSession, Slots.Select(ToWorkflowSlot), "generate", "complete");
        if (CurrentSession.PendingHandoff is null
            || !PendingHandoffReuse.IsReview(CurrentSession.PendingHandoff))
        {
            CurrentSession.PendingHandoff = resultPending;
        }
        var payload = ConnectorContextBuilder.BuildResult(CurrentSession, iteration, resultPending);
        // A new review boundary (for example after RESUME) is a new timeline
        // message. Never rewrite the payload of the previous result card: it
        // is the immutable handoff that was issued for that earlier boundary.
        // Re-copying within the same boundary was handled above, so this path
        // only records a genuinely new result handoff.
        await RecordHandoffAsync(new HandoffMessage
        {
            Direction = HandoffDirection.ComfyToChatGpt,
            Kind = HandoffMessageKind.GenerationResult,
            State = HandoffTransportState.Waiting,
            Title = $"Iteration {iteration.Number:00} の生成結果",
            DisplayText = BuildResultTimelineDisplay(iteration),
            Metadata = BuildResultTimelineMetadata(iteration),
            Summary = BuildResultTimelineSummary(iteration),
            Payload = payload,
            IterationNumber = iteration.Number,
        });
        return payload;
    }

    /// <summary>
    /// Materializes the Review boundary used by the explicit SEND/recovery
    /// action. The GenerationResult card is an immutable output-context record
    /// and is never promoted into a Review request by mutating its identity.
    /// </summary>
    private async Task<string> PrepareReviewHandoffForSendAsync()
    {
        var session = CurrentSession ?? throw new InvalidOperationException("制作セッションがありません。");
        var currentPending = session.PendingHandoff;

        if (PendingHandoffReuse.IsReview(currentPending))
        {
            var existingReview = FindReviewHandoff(currentPending, currentPending!.Iteration);
            if (HandoffPayloadReuse.TryGetSavedPayload(existingReview, out var savedReviewPayload))
                return savedReviewPayload;

            var reviewIteration = session.Iterations.FirstOrDefault(item => item.Number == currentPending.Iteration)
                ?? throw new InvalidOperationException("Review対象のIterationが見つかりません。");
            var reviewPayload = ConnectorContextBuilder.BuildResult(session, reviewIteration, currentPending);
            // A restored/partially-created Review boundary may have a valid
            // PendingHandoff but no Timeline transport record yet. Materialize
            // that record before sending so retry/recovery always has one
            // durable ReviewRequest to update instead of silently creating an
            // untracked transport attempt.
            await RecordReviewHandoffTransportAsync(
                reviewPayload,
                HandoffTransportState.Waiting,
                null,
                null,
                currentPending.Iteration);
            return reviewPayload;
        }

        var iterationNumber = PendingHandoffReuse.IsGenerationResult(currentPending)
            ? currentPending!.Iteration
            : session.Iterations.LastOrDefault(item =>
                item.Status == JobStatus.Completed
                && item.Outputs.Any(output => !output.IsMissing))?.Number ?? session.CurrentIteration;
        var iteration = session.Iterations.FirstOrDefault(item => item.Number == iterationNumber)
            ?? throw new InvalidOperationException("Review対象のIterationが見つかりません。");
        var resultMessage = FindGenerationResultHandoff(
            PendingHandoffReuse.IsGenerationResult(currentPending) ? currentPending : null,
            iteration.Number);
        if (resultMessage is null || resultMessage.State != HandoffTransportState.Attached)
            throw new InvalidOperationException("Review対象の生成物添付が完了していません。");

        EnsureSlotSchemaAvailable();
        var reviewPending = PendingHandoffFactory.CreateReview(
            session,
            Slots.Select(ToWorkflowSlot),
            GetReviewAllowedActions(session));
        session.PendingHandoff = reviewPending;
        await SaveActiveSessionAsync();
        return ConnectorContextBuilder.BuildResult(session, iteration, reviewPending);
    }

    public Task<string> PrepareTimelineHandoffAsync(HandoffTimelineItem item)
    {
        if (item is null) throw new ArgumentNullException(nameof(item));
        if (!HandoffPayloadReuse.TryGetSavedPayload(item.Message, out var savedPayload))
        {
            throw new InvalidOperationException("このTimelineカードには再コピーできる保存済みHandoffがありません。");
        }
        // Timeline Copy is deliberately a pure re-copy operation. Do not
        // create a new handoff, bind a new PendingHandoff, validate the current
        // IDEA stage, or regenerate content from mutable editor state.
        return Task.FromResult(savedPayload);
    }

    public async Task ConfirmBootstrapCopiedAsync(string payload)
    {
        await _bootstrapHandoffGate.WaitAsync();
        try
        {
            await ConfirmBootstrapCopiedCoreAsync(payload);
        }
        finally
        {
            _bootstrapHandoffGate.Release();
        }
    }

    /// <summary>
    /// Delivers one already-prepared Bootstrap payload through the authenticated
    /// Browser Extension Bridge. Preparation and delivery are intentionally
    /// separate so a failed delivery never replaces the PendingHandoff or
    /// rebuilds the Handoff body.
    /// </summary>
    public async Task<BrowserExtensionHandoffSendResult> SendPreparedBootstrapHandoffAsync(string payload)
    {
        if (CurrentSession?.PendingHandoff is { } reviewPending && PendingHandoffReuse.IsReview(reviewPending))
            return await SendPreparedReviewHandoffAsync(payload);

        if (CurrentSession?.PendingHandoff is { } resultPending
            && PendingHandoffReuse.IsGenerationResult(resultPending)
            && PendingHandoffReuse.MatchesPayload(resultPending, payload))
        {
            var reviewPayload = await PrepareReviewHandoffForSendAsync();
            return await SendPreparedReviewHandoffAsync(reviewPayload);
        }

        await _bootstrapHandoffGate.WaitAsync();
        string? sendRequestId = null;
        try
        {
            if (CurrentSession is null) throw new InvalidOperationException("制作セッションがありません。");
            var pending = CurrentSession.PendingHandoff;
            if (pending is null || !PendingHandoffReuse.MatchesPayload(pending, payload))
            {
                throw new InvalidOperationException("送信対象のHandoffが現在のPending Handoffと一致しません。最新のHandoffを再送してください。");
            }

            var isExplicitResend = PendingHandoffReuse.TryGetResendableBootstrapPayload(CurrentSession, out var savedPayload)
                && string.Equals(savedPayload, payload, StringComparison.Ordinal);
            if (isExplicitResend)
            {
                EnsureBootstrapResendAllowed(payload);
            }
            else
            {
                EnsureSendToChatGptAllowed();
            }
            var request = new BrowserExtensionHandoffSendRequest(
                Guid.NewGuid().ToString("N"),
                pending.SessionId,
                pending.HandoffId,
                pending.BoundaryId,
                payload,
                TargetConversationId: CurrentSession.ConversationId,
                TargetConversationUrl: CurrentSession.ConversationUrl,
                TargetProjectId: CurrentSession.ProjectId,
                NewConversation: string.IsNullOrWhiteSpace(CurrentSession.ConversationId)
                    && string.IsNullOrWhiteSpace(CurrentSession.ConversationUrl),
                TargetProjectUrl: CurrentSession.ProjectUrl);
            // Persist the latest request identity before the transport call so
            // an assistant response can be rejected if it belongs to an older
            // retry attempt. Session/Handoff/Boundary and the body remain
            // unchanged across retries.
            pending.LastBrowserExtensionRequestId = request.RequestId;
            sendRequestId = request.RequestId;
            lock (_browserExtensionResponseGate) _browserExtensionSendRequests.Add(request.RequestId);

            // Persist the transport attempt before crossing the process
            // boundary. A restart during the send therefore retains the same
            // PendingHandoff and gives the next attempt a durable WAITING
            // timeline entry to update.
            await RecordBootstrapTransportAsync(payload, HandoffTransportState.Waiting, advancePipeline: false);

            BrowserExtensionHandoffSendResult result;
            try
            {
                result = await _browserExtensionBridge.SendHandoffAsync(request);
            }
            catch (Exception)
            {
                result = new(
                    request.RequestId,
                    request.HandoffId,
                    "error",
                    BrowserExtensionHandoffErrorCodes.BridgeDisconnected,
                    "Browser Extension Bridgeとの通信に失敗しました。",
                    "bridge_send");
            }

            await RecordBootstrapTransportAsync(
                payload,
                result.IsSent ? HandoffTransportState.Sent : HandoffTransportState.Failed,
                advancePipeline: result.IsSent,
                failureDetail: result.IsSent
                    ? null
                    : BuildBootstrapFailureDetail(result),
                failureCode: result.IsSent ? null : result.ErrorCode,
                failureStage: result.IsSent ? null : result.Stage);
            if (result.IsSent)
            {
                // Bind later Review media to the exact tab that accepted this
                // Session's initial Handoff. It must not depend on the tab
                // that happens to be active when ComfyUI finishes.
                CurrentSession.BrowserExtensionTargetTabId = result.TargetTabId;
                CurrentSession.BrowserExtensionTargetTabUrl = result.TargetTabId.HasValue ? result.TargetTabUrl : null;
                if (!string.IsNullOrWhiteSpace(result.TargetConversationId))
                {
                    CurrentSession.ConversationId = result.TargetConversationId;
                    CurrentSession.ConversationUrl = result.TargetConversationUrl ?? CurrentSession.ConversationUrl;
                    CurrentSession.ChatContextKey = result.TargetConversationId;
                }
                if (!string.IsNullOrWhiteSpace(result.TargetProjectId))
                {
                    CurrentSession.ProjectId = result.TargetProjectId;
                    CurrentSession.ProjectContextKey = result.TargetProjectId;
                }
                await SaveActiveSessionAsync();
                await DrainQueuedBrowserExtensionResponseAsync(request.RequestId);
            }
            else
            {
                RemoveQueuedBrowserExtensionResponse(request.RequestId);
            }
            return result;
        }
        finally
        {
            if (sendRequestId is not null)
            {
                RemoveQueuedBrowserExtensionResponse(sendRequestId);
                lock (_browserExtensionResponseGate) _browserExtensionSendRequests.Remove(sendRequestId);
            }
            _bootstrapHandoffGate.Release();
        }
    }

    /// <summary>
    /// Chooses the transport from the Bridge's live status. The UI projection
    /// is notified from the same Bridge status, but this decision intentionally
    /// does not rely on a stale view-model snapshot. A null result is reserved
    /// for the legacy Clipboard path when the Bridge is actually disconnected;
    /// every other state is treated as an explicit Extension-route failure.
    /// </summary>
    public async Task<BrowserExtensionHandoffSendResult?> TrySendPreparedBootstrapHandoffAsync(string payload)
    {
        var status = _browserExtensionBridge.Status;
        if (status.ConnectionState == BrowserExtensionConnectionState.Disconnected)
        {
            await PersistBrowserExtensionDiagnosticAsync(new BrowserExtensionBridgeDiagnostic(
                "clipboard fallback selected",
                HandoffId: CurrentSession?.PendingHandoff?.HandoffId,
                Status: status.ConnectionStateText,
                ErrorCode: BrowserExtensionHandoffErrorCodes.BridgeDisconnected));
            return null;
        }

        StatusMessage = "Browser Extension経由でChatGPTへ送信中…";
        return CurrentSession?.PendingHandoff is { } pending && PendingHandoffReuse.IsReview(pending)
            ? await SendPreparedReviewHandoffAsync(payload)
            : await SendPreparedBootstrapHandoffAsync(payload);
    }

    public async Task<string> PrepareHandoffForSendAsync()
    {
        if (CurrentSession?.PendingHandoff is { } pending && PendingHandoffReuse.IsReview(pending))
        {
            var review = FindReviewHandoff(pending)
                ?? FindGenerationResultHandoff(pending, pending.Iteration);
            if (HandoffPayloadReuse.TryGetSavedPayload(review, out var payload)) return payload;
        }
        if (CurrentSession?.PendingHandoff is { } resultPending
            && PendingHandoffReuse.IsGenerationResult(resultPending))
        {
            return await PrepareReviewHandoffForSendAsync();
        }
        return await PrepareBootstrapHandoffForSendAsync();
    }

    public async Task<BrowserExtensionHandoffSendResult> SendPreparedHandoffAsync(string payload)
        => await SendPreparedBootstrapHandoffAsync(payload);

    public async Task<BrowserExtensionHandoffSendResult?> TrySendPreparedHandoffAsync(string payload)
        => await TrySendPreparedBootstrapHandoffAsync(payload);

    public async Task ConfirmHandoffCopiedAsync(string payload)
    {
        if (CurrentSession?.PendingHandoff is { } pending && PendingHandoffReuse.IsReview(pending))
        {
            await _reviewHandoffGate.WaitAsync();
            try
            {
                // A generation result can exist before the Review transport
                // card is materialized (for example when the user chooses
                // Clipboard fallback during attachment recovery). Materialize
                // that card with the same immutable Pending Handoff before
                // applying the copied state; never create a new identity.
                if (FindReviewHandoff(pending, pending.Iteration, payload) is null)
                    await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Copied, null, null, pending.Iteration);
                EnsureReviewHandoffResendAllowed(payload);
                CreationPipelineStateMachine.ReviewHandoffCopied(CurrentSession);
                var message = FindReviewHandoff(CurrentSession.PendingHandoff, CurrentSession.PendingHandoff!.Iteration, payload);
                if (message is not null) message.State = HandoffTransportState.Copied;
                await SaveActiveSessionAsync();
                RebuildHandoffItems();
                NotifyPipelineStateChanged();
            }
            finally
            {
                _reviewHandoffGate.Release();
            }
            return;
        }

        await ConfirmBootstrapCopiedAsync(payload);
    }

    public async Task<BrowserExtensionHandoffSendResult> SendPreparedReviewHandoffAsync(string payload)
    {
        await _reviewHandoffGate.WaitAsync();
        BrowserExtensionHandoffSendResult result;
        try
        {
            result = await SendPreparedReviewHandoffCoreAsync(payload, automatic: false);
        }
        finally
        {
            _reviewHandoffGate.Release();
        }

        // The Extension may deliver assistant.response before the SENT state
        // has finished persisting.  The response is queued by the normal
        // correlation gate; drain it only after this gate is released so a
        // Review response can safely start the next generation/review cycle.
        if (result.IsSent) await DrainQueuedBrowserExtensionResponseAsync(result.RequestId);
        return result;
    }

    /// <summary>
    /// Starts the Phase 5.2 boundary after a completed output has been
    /// verified and attached.  The result card and the Review Handoff card are
    /// intentionally separate transport records.  This method is idempotent
    /// for the same session/iteration/pending identity and never starts a
    /// second Review send for an already sent boundary.
    /// </summary>
    private async Task SendAutomaticReviewHandoffAsync(SessionIteration iteration)
    {
        await _reviewHandoffGate.WaitAsync();
        BrowserExtensionHandoffSendResult? sendResult = null;
        try
        {
            var session = CurrentSession;
            var attachment = session?.Pipeline.ReviewMediaAttachment;
            if (!_isCurrentSessionActivated || session is null || iteration.Status != JobStatus.Completed) return;
            if (session.Pipeline.AutomaticIteration?.State is AutomaticIterationState.Stopped or AutomaticIterationState.Failed or AutomaticIterationState.Completed)
                return;
            if (attachment?.State != ReviewMediaAttachmentState.Attached)
            {
                await StopAutomaticIterationAsync(
                    BrowserExtensionHandoffErrorCodes.ReviewMediaNotAttached,
                    "review_media_verification",
                    "生成物の添付完了を確認できないためReview Handoffを送信しませんでした。");
                return;
            }

            if (session.Pipeline.ReviewHandoff is { Iteration: var currentIteration }
                && currentIteration == iteration.Number
                && session.Pipeline.ReviewHandoff.State is ReviewHandoffState.Sending or ReviewHandoffState.Sent or ReviewHandoffState.WaitingResponse)
            {
                return;
            }
            // The completed output has its own GenerationResult identity. It
            // is not a Review transport and must never be reused as the next
            // Review boundary. Only an existing ReviewRequest is idempotent.
            var existingReviewRequest = session.HandoffMessages.LastOrDefault(item =>
                item.Direction == HandoffDirection.ComfyToChatGpt
                && item.Kind == HandoffMessageKind.ReviewRequest
                && item.IterationNumber == iteration.Number);
            if (existingReviewRequest is not null)
                return;

            EnsureSlotSchemaAvailable();
            // A Review Handoff is a new protocol boundary after the output
            // context and therefore always receives fresh handoff_id and
            // boundary_id values. Explicit user retries reuse this snapshot;
            // this automatic first send never aliases the GenerationResult.
            var pending = PendingHandoffFactory.CreateReview(
                session,
                Slots.Select(ToWorkflowSlot),
                GetReviewAllowedActions(session));
            session.PendingHandoff = pending;
            CreationPipelineStateMachine.ReviewHandoffPreparing(
                session,
                pending,
                iteration.Number,
                session.BrowserExtensionTargetTabId,
                session.BrowserExtensionTargetTabUrl);
            var payload = ConnectorContextBuilder.BuildResult(session, iteration, pending);
            await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Waiting, null, null, iteration.Number);
            await SaveActiveSessionAsync();
            NotifyPipelineStateChanged();

            CreationPipelineStateMachine.AutomaticIterationStarted(session);
            sendResult = await SendPreparedReviewHandoffCoreAsync(payload, automatic: true);
            if (sendResult.IsSent)
            {
                StatusMessage = $"Iteration {iteration.Number} のReview Handoffを同じChatGPT会話へ送信しました。返答を待機しています。";
            }
        }
        catch (Exception ex)
        {
            if (CurrentSession is not null)
            {
                if (CurrentSession.Pipeline.ReviewHandoff is { Iteration: var reviewIteration }
                    && reviewIteration == iteration.Number
                    && CurrentSession.Pipeline.ReviewHandoff.State is ReviewHandoffState.Preparing or ReviewHandoffState.Sending)
                {
                    CreationPipelineStateMachine.ReviewHandoffFailed(
                        CurrentSession,
                        BrowserExtensionHandoffErrorCodes.ReviewHandoffBuildFailed,
                        "review_handoff_build",
                        "Review Handoffの生成または送信準備に失敗しました。");
                }
                await StopAutomaticIterationAsync(
                    BrowserExtensionHandoffErrorCodes.ReviewHandoffBuildFailed,
                    "review_handoff_build",
                    "Review Handoffの生成に失敗したため自動Iterationを停止しました。",
                    ex);
            }
        }
        finally
        {
            _reviewHandoffGate.Release();
        }

        if (sendResult?.IsSent == true)
            await DrainQueuedBrowserExtensionResponseAsync(sendResult.RequestId);
    }

    /// <summary>
    /// Sends the first Handoff of a new Run after a previously completed
    /// Session is explicitly resumed. It can also retry a persisted Resume
    /// boundary after a transport failure, without rotating its identity. The
    /// latest output is attached by the caller, and the saved ChatGPT
    /// tab/conversation is reused.
    /// </summary>
    private async Task<BrowserExtensionHandoffSendResult> SendResumeHandoffAsync(
        SessionIteration iteration,
        bool reuseExisting = false)
    {
        await _reviewHandoffGate.WaitAsync();
        try
        {
            var session = CurrentSession ?? throw new InvalidOperationException("制作セッションがありません。");
            EnsureSlotSchemaAvailable();

            PendingHandoffSnapshot pending;
            string payload;
            if (reuseExisting)
            {
                if (session.PendingHandoff is not { } existingPending
                    || !PendingHandoffReuse.IsResume(existingPending)
                    || existingPending.Iteration != iteration.Number)
                {
                    throw new InvalidOperationException("再試行するResume Handoffが見つかりません。Sessionの履歴は保持されています。");
                }

                var existingMessage = FindReviewHandoff(existingPending, iteration.Number);
                if (!HandoffPayloadReuse.TryGetSavedPayload(existingMessage, out payload))
                {
                    throw new InvalidOperationException("保存済みResume Handoff本文を確認できません。Sessionの履歴は保持されています。");
                }

                pending = existingPending;
                var review = session.Pipeline.ReviewHandoff;
                if (review is null
                    || review.Iteration != pending.Iteration
                    || !string.Equals(review.SessionId, pending.SessionId, StringComparison.Ordinal)
                    || !string.Equals(review.HandoffId, pending.HandoffId, StringComparison.Ordinal)
                    || !string.Equals(review.BoundaryId, pending.BoundaryId, StringComparison.Ordinal)
                    || review.State is ReviewHandoffState.None or ReviewHandoffState.Failed or ReviewHandoffState.Stopped or ReviewHandoffState.Completed)
                {
                    // Re-arm the same persisted boundary. This changes only
                    // transient lifecycle state; it never regenerates the
                    // session, Handoff, boundary, or payload.
                    CreationPipelineStateMachine.ReviewHandoffPreparing(
                        session,
                        pending,
                        iteration.Number,
                        session.BrowserExtensionTargetTabId,
                        session.BrowserExtensionTargetTabUrl);
                }
            }
            else
            {
                pending = PendingHandoffFactory.CreateResume(
                    session,
                    Slots.Select(ToWorkflowSlot));
                session.PendingHandoff = pending;
                CreationPipelineStateMachine.ReviewHandoffPreparing(
                    session,
                    pending,
                    iteration.Number,
                    session.BrowserExtensionTargetTabId,
                    session.BrowserExtensionTargetTabUrl);
                payload = ConnectorContextBuilder.BuildResult(session, iteration, pending);
            }

            await RecordReviewHandoffTransportAsync(
                payload,
                HandoffTransportState.Waiting,
                null,
                null,
                iteration.Number);
            await SaveActiveSessionAsync();
            NotifyPipelineStateChanged();

            // Resume is an explicit user action, but the resulting Handoff is
            // still an automatic loop boundary.  The shared Review send path
            // will persist SENT/FAILED and correlate assistant.response using
            // this fresh PendingHandoff identity.
            CreationPipelineStateMachine.AutomaticIterationStarted(session);
            var result = await SendPreparedReviewHandoffCoreAsync(payload, automatic: true);
            if (result.IsSent)
            {
                StatusMessage = "RESUME Handoffを同じChatGPT会話へ送信しました。返答を待機しています。";
            }
            return result;
        }
        finally
        {
            _reviewHandoffGate.Release();
        }
    }

    /// <summary>
    /// Explicitly retries the already persisted Review Handoff.  It is also
    /// used by the automatic path after the new Review identity has been
    /// recorded.  Preparation and transport remain separate so a failure
    /// never rotates session/handoff/boundary or rebuilds the body.
    /// </summary>
    private async Task<BrowserExtensionHandoffSendResult> SendPreparedReviewHandoffCoreAsync(string payload, bool automatic)
    {
        var session = CurrentSession ?? throw new InvalidOperationException("制作セッションがありません。");
        var pending = session.PendingHandoff;
        if (pending is null || !PendingHandoffReuse.IsReview(pending) || !PendingHandoffReuse.MatchesPayload(pending, payload))
            throw new InvalidOperationException("送信対象のReview Handoffが現在のPending Handoffと一致しません。");

        var attachment = session.Pipeline.ReviewMediaAttachment;
        if (attachment?.State != ReviewMediaAttachmentState.Attached)
        {
            var failure = new BrowserExtensionHandoffSendResult(
                Guid.NewGuid().ToString("N"),
                pending.HandoffId,
                "error",
                BrowserExtensionHandoffErrorCodes.ReviewMediaNotAttached,
                "生成物の添付完了を確認できません。",
                "attachment_verification");
            return await FailReviewHandoffTransportAsync(payload, pending, failure, automatic);
        }

        var targetTabId = session.BrowserExtensionTargetTabId;
        var targetTabUrl = session.BrowserExtensionTargetTabUrl;
        if (!targetTabId.HasValue || string.IsNullOrWhiteSpace(targetTabUrl))
        {
            var failure = new BrowserExtensionHandoffSendResult(
                Guid.NewGuid().ToString("N"),
                pending.HandoffId,
                "error",
                BrowserExtensionHandoffErrorCodes.ReviewTargetTabNotFound,
                "初回HandoffのChatGPT送信先が確認できません。",
                "target_tab_check");
            return await FailReviewHandoffTransportAsync(payload, pending, failure, automatic);
        }

        if (!automatic)
        {
            // Recovery can reach this method with a copied ReviewRequest whose
            // lifecycle snapshot is intentionally None. Re-prepare the
            // lifecycle whenever the persisted snapshot is absent, closed for
            // the clipboard path, or belongs to another boundary. The
            // ReviewRequest/PendingHandoff itself is still reused in place;
            // this must never rotate the session, handoff, boundary, or body.
            var reviewSnapshot = session.Pipeline.ReviewHandoff;
            if (reviewSnapshot is null
                || reviewSnapshot.State == ReviewHandoffState.None
                || reviewSnapshot.Iteration != pending.Iteration
                || !string.Equals(reviewSnapshot.SessionId, pending.SessionId, StringComparison.Ordinal)
                || !string.Equals(reviewSnapshot.HandoffId, pending.HandoffId, StringComparison.Ordinal)
                || !string.Equals(reviewSnapshot.BoundaryId, pending.BoundaryId, StringComparison.Ordinal))
            {
                CreationPipelineStateMachine.ReviewHandoffPreparing(
                    session,
                    pending,
                    pending.Iteration,
                    targetTabId,
                    targetTabUrl);
            }
            // A copied/failed ReviewRequest remains the durable transport
            // record. Move that same record to WAITING for the new attempt;
            // do not create a second Timeline Handoff.
            await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Waiting, null, null, pending.Iteration);
            EnsureReviewHandoffResendAllowed(payload);
            CreationPipelineStateMachine.AutomaticIterationStarted(session);
        }
        else if (!IsAutomaticIterationActive && session.Pipeline.AutomaticIteration?.State != AutomaticIterationState.Running)
        {
            return new BrowserExtensionHandoffSendResult(
                Guid.NewGuid().ToString("N"), pending.HandoffId, "error",
                BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled,
                "自動Iterationは停止しています。",
                "automatic_iteration_cancelled");
        }

        var request = new BrowserExtensionHandoffSendRequest(
            Guid.NewGuid().ToString("N"),
            pending.SessionId,
            pending.HandoffId,
            pending.BoundaryId,
            payload,
            "review",
            targetTabId,
            targetTabUrl,
            attachment.MediaId,
                attachment.FileName,
                attachment.Iteration,
            TargetConversationId: session.ConversationId,
            TargetConversationUrl: session.ConversationUrl,
            TargetProjectId: session.ProjectId);
        await _store.LogAsync(
            "automation",
            $"review handoff ready request_id={request.RequestId} session_id={request.SessionId} handoff_id={request.HandoffId} boundary_id={request.BoundaryId} target_tab_id={request.TargetTabId?.ToString() ?? "none"} stage=review_handoff_ready");
        pending.LastBrowserExtensionRequestId = request.RequestId;
        lock (_browserExtensionResponseGate) _browserExtensionSendRequests.Add(request.RequestId);
        try
        {
            CreationPipelineStateMachine.ReviewHandoffSending(session, request.RequestId);
            await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Waiting, null, null, pending.Iteration);

            BrowserExtensionHandoffSendResult result;
            try
            {
                result = await _browserExtensionBridge.SendHandoffAsync(request);
            }
            catch (Exception)
            {
                result = new(
                    request.RequestId,
                    request.HandoffId,
                    "error",
                    BrowserExtensionHandoffErrorCodes.BridgeDisconnected,
                    "Browser Extension Bridgeとの通信に失敗しました。",
                    "bridge_connection");
            }

            if (result.IsSent)
            {
                CreationPipelineStateMachine.ReviewHandoffSent(session, result);
                await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Sent, null, null, pending.Iteration);
                await _store.LogAsync(
                    "automation",
                    $"review handoff sent request_id={request.RequestId} session_id={request.SessionId} handoff_id={request.HandoffId} boundary_id={request.BoundaryId} target_tab_id={request.TargetTabId?.ToString() ?? "none"} stage=review_handoff_sent");
            }
            else
            {
                CreationPipelineStateMachine.ReviewHandoffFailed(session, result.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewSendFailed, result.Stage, result.Message);
                await RecordReviewHandoffTransportAsync(payload, HandoffTransportState.Failed, result.ErrorCode, result.Stage, pending.Iteration, result.Message);
                await SaveActiveSessionAsync();
                await _store.LogAsync("automation", $"review handoff failed request_id={request.RequestId} handoff_id={request.HandoffId} error_code={result.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewSendFailed} stage={result.Stage ?? "review_send"}");
            }

            await SaveActiveSessionAsync();
            NotifyPipelineStateChanged();
            return result;
        }
        finally
        {
            lock (_browserExtensionResponseGate) _browserExtensionSendRequests.Remove(request.RequestId);
        }
    }

    private async Task<BrowserExtensionHandoffSendResult> FailReviewHandoffTransportAsync(
        string payload,
        PendingHandoffSnapshot pending,
        BrowserExtensionHandoffSendResult failure,
        bool automatic)
    {
        var session = CurrentSession;
        if (session is null) return failure;

        if (session.Pipeline.ReviewHandoff is not null)
        {
            CreationPipelineStateMachine.ReviewHandoffFailed(
                session,
                failure.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewSendFailed,
                failure.Stage,
                failure.Message);
        }
        else if (automatic || session.Pipeline.AutomaticIteration is { State: AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse })
        {
            CreationPipelineStateMachine.AutomaticIterationFailed(
                session,
                failure.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewSendFailed,
                failure.Stage,
                failure.Message);
        }

        await RecordReviewHandoffTransportAsync(
            payload,
            HandoffTransportState.Failed,
            failure.ErrorCode,
            failure.Stage,
            pending.Iteration,
            failure.Message);
        await SaveActiveSessionAsync();
        NotifyPipelineStateChanged();
        return failure;
    }

    private async Task RecordReviewHandoffTransportAsync(
        string payload,
        HandoffTransportState state,
        string? errorCode,
        string? errorStage,
        int iteration,
        string? errorMessage = null)
    {
        var session = CurrentSession;
        var pending = session?.PendingHandoff;
        if (session is null || pending is null || !PendingHandoffReuse.IsReview(pending) || !PendingHandoffReuse.MatchesPayload(pending, payload))
            throw new InvalidOperationException("Review Handoffの送信対象が現在のPending Handoffと一致しません。");

        var message = FindReviewHandoff(pending, iteration, payload);
        if (message is null)
        {
            var isResume = pending.Purpose == PendingHandoffPurpose.Resume;
            message = new HandoffMessage
            {
                Direction = HandoffDirection.ComfyToChatGpt,
                Kind = HandoffMessageKind.ReviewRequest,
                State = HandoffTransportState.Waiting,
                Title = isResume
                    ? $"Iteration {iteration:00} Resume Handoff"
                    : $"Iteration {iteration:00} Review Handoff",
                DisplayText = isResume
                    ? $"Iteration {iteration:00} のResume Handoffを送信"
                    : $"Iteration {iteration:00} のReview Handoffを送信",
                Metadata = BuildResultTimelineMetadata(session.Iterations.FirstOrDefault(item => item.Number == iteration) ?? new SessionIteration { Number = iteration }),
                Summary = isResume
                    ? "完成済みの生成結果を基準に、新しいRunの最初のgenerate判断を依頼します。"
                    : "生成物を確認したChatGPTへ次のIterationまたは完了判断を依頼します。",
                Payload = payload,
                IterationNumber = iteration,
            };
            session.HandoffMessages.Add(message);
        }

        message.State = state;
        message.TransportErrorCode = state == HandoffTransportState.Failed ? errorCode : null;
        message.TransportErrorStage = state == HandoffTransportState.Failed ? errorStage : null;
        if (state == HandoffTransportState.Failed && !string.IsNullOrWhiteSpace(errorMessage))
            message.DisplayText = $"Iteration {iteration:00} Review Handoff · {errorMessage}";
        RebuildHandoffItems();
        await SaveActiveSessionAsync();
    }

    private async Task StopAutomaticIterationAsync(string errorCode, string stage, string message, Exception? exception = null)
    {
        var session = CurrentSession;
        if (session is null) return;
        // Review failures must also transition the durable ReviewRequest card
        // out of WAITING; otherwise an explicit retry remains hidden even
        // though the automatic loop has stopped. This method is only used by
        // Phase 5.2 Review/attachment paths, but keep the non-Review fallback
        // for defensive compatibility with restored sessions.
        if (PendingHandoffReuse.IsReview(session.PendingHandoff))
            MarkReviewHandoffRetryable(session, errorCode, stage, message);
        else
            CreationPipelineStateMachine.AutomaticIterationFailed(session, errorCode, stage, message);
        await SaveActiveSessionAsync();
        StatusMessage = $"自動Iterationを停止しました。({errorCode}, stage={stage})";
        await _store.LogAsync("automation", $"automatic iteration stopped session_id={session.Id} iteration={session.CurrentIteration} error_code={errorCode} stage={stage}", exception);
        NotifyPipelineStateChanged();
    }

    private void MarkReviewHandoffRetryable(
        CreationSession session,
        string errorCode,
        string stage,
        string message,
        bool transitionLifecycle = true)
    {
        if (!PendingHandoffReuse.IsReview(session.PendingHandoff)) return;

        if (transitionLifecycle && session.Pipeline.ReviewHandoff is not null)
        {
            CreationPipelineStateMachine.ReviewHandoffFailed(session, errorCode, stage, message);
        }
        else if (transitionLifecycle && session.Pipeline.AutomaticIteration is { State: AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse })
        {
            // A restored/copied Review Pending can exist before its lifecycle
            // snapshot is materialized. Still close the automatic loop and
            // leave the transport retryable instead of silently leaving it in
            // RUNNING.
            CreationPipelineStateMachine.AutomaticIterationFailed(session, errorCode, stage, message);
        }
        var pending = session.PendingHandoff;
        var review = FindReviewHandoff(pending, pending?.Iteration);
        if (review is not null)
        {
            review.State = HandoffTransportState.Failed;
            review.TransportErrorCode = errorCode;
            review.TransportErrorStage = stage;
            if (!string.IsNullOrWhiteSpace(message))
                review.DisplayText = $"Iteration {pending!.Iteration:00} Review Handoff · {message}";
        }
        RebuildHandoffItems();
    }

    private string[] GetReviewAllowedActions(CreationSession session)
        // MaximumIterations limits Connector execution for the current Run;
        // it must never change ChatGPT's Review decision contract. The final
        // iteration is still allowed to return either generate or complete.
        => ["generate", "complete"];

    private HandoffMessage? FindReviewHandoff(PendingHandoffSnapshot? pending, int? iteration = null, string? payload = null)
        => CurrentSession?.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ComfyToChatGpt
            // GenerationResult is the media/result card.  It is deliberately
            // a separate timeline record and is never the Review transport
            // boundary that can be sent or retried.
            && item.Kind == HandoffMessageKind.ReviewRequest
            && (iteration is null || item.IterationNumber == iteration)
            && (payload is null || string.Equals(item.Payload, payload, StringComparison.Ordinal))
            && (pending is null || PendingHandoffReuse.MatchesPayload(pending, item.Payload)));

    private HandoffMessage? FindGenerationResultHandoff(PendingHandoffSnapshot? pending, int? iteration = null)
        => CurrentSession?.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ComfyToChatGpt
            && item.Kind == HandoffMessageKind.GenerationResult
            && (iteration is null || item.IterationNumber == iteration)
            && (pending is null || PendingHandoffReuse.MatchesPayload(pending, item.Payload)));

    private void EnsureReviewHandoffResendAllowed(string payload)
    {
        var session = CurrentSession;
        var pending = session?.PendingHandoff;
        if (!_isCurrentSessionActivated || session is null || pending is null || !PendingHandoffReuse.IsReview(pending) || !PendingHandoffReuse.MatchesPayload(pending, payload))
            throw new InvalidOperationException("再送対象のReview Handoffが見つかりません。");
        if (session.Pipeline.ReviewMediaAttachment?.State != ReviewMediaAttachmentState.Attached)
            throw new InvalidOperationException("Review対象の生成物添付が完了していません。");
        if (!session.BrowserExtensionTargetTabId.HasValue || string.IsNullOrWhiteSpace(session.BrowserExtensionTargetTabUrl))
            throw new InvalidOperationException("初回HandoffのChatGPT送信先が記録されていません。");
        if (IsJobActive) throw new InvalidOperationException("生成中はReview Handoffを再送できません。");
        var message = FindReviewHandoff(pending, pending.Iteration, payload);
        if (message is null || message.State is not (HandoffTransportState.Copied or HandoffTransportState.Failed or HandoffTransportState.Waiting))
            throw new InvalidOperationException("再送可能なReview Handoffが見つかりません。");
    }

    private async Task ConfirmBootstrapCopiedCoreAsync(string payload)
    {
        if (CurrentSession is null) return;
        var pending = CurrentSession.PendingHandoff;
        if (pending is null || !PendingHandoffReuse.MatchesPayload(pending, payload))
        {
            throw new InvalidOperationException("コピー対象のHandoffが現在のPending Handoffと一致しません。最新のHandoffを再送してください。");
        }

        var existing = FindBootstrapHandoff(payload);
        // A second click should be idempotent. It must not re-run the state
        // transition or issue a new identity after a successful transport.
        if (existing?.State is HandoffTransportState.Copied or HandoffTransportState.Sent)
        {
            return;
        }

        var isExistingRetry = existing is not null
            && existing.State is (HandoffTransportState.Failed or HandoffTransportState.Waiting)
            && PendingHandoffReuse.TryGetResendableBootstrapPayload(CurrentSession, out var savedPayload)
            && string.Equals(savedPayload, payload, StringComparison.Ordinal);
        if (isExistingRetry)
        {
            // Re-copying a failed/waiting Bootstrap is also allowed when MCP is
            // temporarily unavailable: the payload is already persisted and
            // does not need to be rebuilt from the mutable workspace.
            EnsureBootstrapResendAllowed(payload);
        }
        else
        {
            EnsureSendToChatGptAllowed();
            var kickoffInstruction = PendingHandoffReuse.GetKickoffInstruction(pending, CurrentSession);
            if (!string.Equals(
                    PendingHandoffReuse.NormalizeKickoffInstruction(kickoffInstruction),
                    PendingHandoffReuse.NormalizeKickoffInstruction(Idea),
                    StringComparison.Ordinal))
            {
                throw new InvalidOperationException("開始指示がHandoff作成後に変更されています。現在の内容をChatGPTへ送り直してください。");
            }
        }

        await RecordBootstrapTransportAsync(payload, HandoffTransportState.Copied, advancePipeline: true);
    }

    private async Task RecordBootstrapTransportAsync(
        string payload,
        HandoffTransportState state,
        bool advancePipeline,
        string? failureDetail = null,
        string? failureCode = null,
        string? failureStage = null)
    {
        if (CurrentSession is null) return;
        var pending = CurrentSession.PendingHandoff;
        if (pending is null || !PendingHandoffReuse.MatchesPayload(pending, payload))
        {
            throw new InvalidOperationException("送信対象のHandoffが現在のPending Handoffと一致しません。最新のHandoffを再送してください。");
        }

        var kickoffInstruction = PendingHandoffReuse.GetKickoffInstruction(pending, CurrentSession);
        var message = FindBootstrapHandoff(payload);
        if (message is null)
        {
            message = new HandoffMessage
            {
                Direction = HandoffDirection.ConnectorToChatGpt,
                Kind = HandoffMessageKind.CreationRequest,
                Title = "制作コンテキストを送信",
                DisplayText = string.IsNullOrWhiteSpace(kickoffInstruction) ? "既存ChatGPT会話をもとに制作を開始" : kickoffInstruction,
                Metadata = $"Workflow: {CurrentSession.BoundWorkflow?.DisplayName ?? SelectedWorkflowName}{Environment.NewLine}{CurrentSession.ProjectLabel} / {CurrentSession.ChatLabel}",
                Summary = "既存ChatGPT会話を制作文脈として使用し、Workflow向けの生成指示を作成します。",
                Payload = payload,
            };
            CurrentSession.HandoffMessages.Add(message);
        }

        message.State = state;
        message.TransportErrorCode = state == HandoffTransportState.Failed ? failureCode : null;
        message.TransportErrorStage = state == HandoffTransportState.Failed ? failureStage : null;
        if (state == HandoffTransportState.Failed)
        {
            CreationPipelineStateMachine.BootstrapSendFailed(
                CurrentSession,
                failureDetail ?? "自動送信に失敗しました · 同じHandoffを再送できます");
        }
        else if (advancePipeline)
        {
            if (state == HandoffTransportState.Sent)
            {
                CreationPipelineStateMachine.BootstrapSent(CurrentSession, kickoffInstruction);
            }
            else if (state == HandoffTransportState.Copied)
            {
                CreationPipelineStateMachine.BootstrapCopied(CurrentSession, kickoffInstruction);
            }
        }

        RebuildHandoffItems();
        await SaveActiveSessionAsync();
        NotifyPipelineStateChanged();
    }

    private void MarkLatestCommandCompleted(string payload)
    {
        if (CurrentSession is null) return;
        var message = CurrentSession.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ChatGptToComfy
            && string.Equals(item.Payload, payload, StringComparison.Ordinal));
        if (message is null) return;
        message.State = HandoffTransportState.Completed;
        RebuildHandoffItems();
    }

    private static string BuildBootstrapFailureDetail(BrowserExtensionHandoffSendResult result)
    {
        var code = result.ErrorCode ?? BrowserExtensionHandoffErrorCodes.SendFailed;
        var stage = string.IsNullOrWhiteSpace(result.Stage) ? string.Empty : $", stage={result.Stage}";
        return $"自動送信に失敗しました ({code}{stage}) · 同じHandoffを再送できます";
    }

    private HandoffMessage? FindBootstrapHandoff(string payload)
        => CurrentSession?.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ConnectorToChatGpt
            && item.Kind == HandoffMessageKind.CreationRequest
            && item.IterationNumber is null
            && string.Equals(item.Payload, payload, StringComparison.Ordinal));

    public async Task MarkHandoffCopiedAsync(HandoffTimelineItem item)
    {
        // Copying an already delivered Handoff is an inspection/fallback
        // operation. It must not rewrite the durable transport result from
        // SENT back to COPIED or make the pipeline contradict the actual send.
        if (item.Message.State == HandoffTransportState.Sent)
        {
            StatusMessage = "送信済みHandoffをClipboardへコピーしました。";
            return;
        }

        if ((item.IsConnectorToChatGpt && item.Message.Kind == HandoffMessageKind.CreationRequest
             || item.IsComfyToChatGpt && item.Message.Kind == HandoffMessageKind.ReviewRequest)
            && CurrentSession?.PendingHandoff is { } pending
            && PendingHandoffReuse.MatchesPayload(pending, item.Payload)
            && item.Message.State is not HandoffTransportState.Sent)
        {
            // A persisted WAITING/FAILED Bootstrap or Review boundary can be
            // deliberately recovered through the legacy Clipboard action.
            // Confirming it advances the same boundary without issuing a
            // replacement ID.
            await ConfirmHandoffCopiedAsync(item.Payload);
            StatusMessage = item.Message.Kind == HandoffMessageKind.CreationRequest
                ? "制作コンテキストをコピーしました。ChatGPTへ貼り付けてください。"
                : "Review Handoffをコピーしました。ChatGPTへ貼り付けてください。";
            return;
        }

        item.MarkCopied();
        if (CurrentSession is not null)
        {
            // Existing non-Bootstrap cards are transport-only. The one
            // exception is a failed/waiting Bootstrap: copying that exact
            // pending boundary is the explicit legacy fallback and must move
            // the pipeline to ChatGPT-response waiting.
            await SaveActiveSessionAsync();
            NotifyPipelineStateChanged();
        }
        StatusMessage = item.IsChatGptToComfy ? "Connector用Commandをコピーしました。" : "ChatGPTへ渡す内容をコピーしました。";
    }

    public async Task CompleteSessionAsync(string reason, bool chatGptComplete = false)
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.Complete(CurrentSession, reason, chatGptComplete);
        CreationPipelineStateMachine.AutomaticIterationCompleted(CurrentSession);
        RevokeReviewMediaRegistration(CurrentSession);
        RefreshHistoryFlags();
        OnPropertyChanged(nameof(SessionStatusText));
        OnPropertyChanged(nameof(CanResumeSession));
        NotifyPipelineStateChanged();
        StatusMessage = "セッションをCOMPLETEDにしました。履歴と出力は保持されています。必要ならRESUMEできます。";
        await SaveActiveSessionAsync();
    }

    public async Task ResumeSessionAsync()
    {
        if (!_isCurrentSessionActivated || CurrentSession is null)
        {
            throw new InvalidOperationException("再開する制作Sessionを明示的に選択してください。");
        }

        if (!await _resumeGate.WaitAsync(0))
            throw new InvalidOperationException("セッションの再開処理を実行中です。完了するまでお待ちください。");

        _isResumeInProgress = true;
        OnPropertyChanged(nameof(CanResumeSession));
        try
        {
            var session = CurrentSession;
            SynchronizePipelineConnectionGate(session);
            CreationPipelineStateMachine.RequireConnection(session);
            _isCurrentSessionActivated = true;

            if (session.Status == SessionStatus.LimitReached
                || session.Pipeline.MaximumIterationSafetyStop
                || session.Pipeline.DeferredGenerate is not null)
            {
                await ResumeDeferredGenerateAsync(session);
            }
            else if (IsCompletedResumeAwaitingResponse(session))
            {
                // A second invocation after the first Resume has already
                // crossed the Bridge is a no-op. The active watcher owns the
                // existing boundary; restarting it would duplicate a Handoff
                // and could cause a second automatic generation.
                StatusMessage = "Resume Handoffは送信済みです。ChatGPTの返答を待機しています。";
            }
            else if (session.Status == SessionStatus.Completed)
            {
                await ResumeCompletedSessionAsync(session);
            }
            else if (IsCompletedResumeRetryable(session))
            {
                // If the first Resume send failed after persisting its
                // boundary, retry that exact Handoff instead of creating a
                // fresh Run or rotating its identity.
                await ResumeCompletedSessionAsync(session);
            }
            else
            {
                // Preserve the legacy pause/error recovery behavior for a
                // session that was stopped for a non-iteration reason.
                CreationPipelineStateMachine.Resume(session);
                RefreshHistoryFlags();
                await SaveActiveSessionAsync();
                StatusMessage = "セッションを再開しました。";
            }

            OnPropertyChanged(nameof(SessionStatusText));
            OnPropertyChanged(nameof(CanResumeSession));
            NotifyPipelineStateChanged();
        }
        catch (Exception ex)
        {
            // A Resume can fail during media/Bridge recovery after the new
            // Run was created. Keep it explicitly retryable instead of
            // leaving an Active session that has no actionable button.
            if (CurrentSession is { } failed
                && failed.Status == SessionStatus.Active
                && !IsJobActive)
            {
                failed.Status = SessionStatus.Error;
                failed.LastError = ex.Message;
                failed.PauseReason = "Resumeに失敗しました。再試行してください。";
                await SaveActiveSessionAsync();
                OnPropertyChanged(nameof(SessionStatusText));
                OnPropertyChanged(nameof(CanResumeSession));
                NotifyPipelineStateChanged();
            }
            throw;
        }
        finally
        {
            _isResumeInProgress = false;
            _resumeGate.Release();
            OnPropertyChanged(nameof(CanResumeSession));
        }
    }

    public async Task ContinueBeyondIterationLimitAsync()
    {
        if (CurrentSession is null) return;
        await ResumeSessionAsync();
    }

    public async Task EndAtIterationLimitAsync()
    {
        if (CurrentSession is null
            || (CurrentSession.Status != SessionStatus.LimitReached
                && !CurrentSession.Pipeline.MaximumIterationSafetyStop
                && CurrentSession.Pipeline.DeferredGenerate is null)) return;
        await CompleteSessionAsync("最大反復回数でユーザーが制作終了を選択しました。");
    }

    private async Task ResumeDeferredGenerateAsync(CreationSession session)
    {
        // Validate the durable recovery record before changing the Run.  A
        // corrupt/stale snapshot must remain retryable and must never create an
        // empty recovery Run merely because the user pressed RESUME.
        var deferred = session.Pipeline.DeferredGenerate;
        if (deferred is null)
        {
            CreationPipelineStateMachine.ResumeFromLimit(session);
            await SaveActiveSessionAsync();
            StatusMessage = "LIMIT REACHEDを解除しました。次の生成を準備できます。";
            return;
        }

        if (!string.Equals(deferred.SessionId, session.Id, StringComparison.Ordinal)
            || !string.Equals(
                deferred.RecoveryRunId ?? deferred.RunId,
                session.Pipeline.CurrentRun?.RunId,
                StringComparison.Ordinal)
            || session.PendingHandoff is not { } pending
            || !string.Equals(deferred.HandoffId, pending.HandoffId, StringComparison.Ordinal)
            || !string.Equals(deferred.BoundaryId, pending.BoundaryId, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("保留中のgenerateの相関情報を確認できません。Sessionを破壊せず再試行できます。");
        }

        var restoredText = deferred.CommandText;
        var restoredValidation = ConnectorProtocol.Parse(restoredText, pending);
        if (!restoredValidation.IsValid
            || restoredValidation.Command is not { Action: "generate" })
        {
            throw new InvalidOperationException("保留中のgenerate Commandをstrict validationできません。保留内容は保持されています。");
        }

        // This is the first mutating step.  All identity and strict-command
        // checks above are intentionally complete before the recovery Run is
        // created or the old Review boundary is re-armed.
        deferred = CreationPipelineStateMachine.ResumeFromLimit(session)
            ?? throw new InvalidOperationException("LIMIT REACHEDの再開状態を確認できません。保留内容は保持されています。");

        RestoreAutomaticCommandInput(restoredText, restoredValidation);
        await SaveActiveSessionAsync();
        NotifyPipelineStateChanged();

        var iterationBefore = session.CurrentIteration;
        var commandBefore = CommandText;
        var validationBefore = _pendingValidation;
        try
        {
            await ApplyCommandCoreAsync(
                generate: true,
                clearCommandOnApply: false,
                afterApply: ClearAppliedCommandInput);
        }
        catch
        {
            RestoreAutomaticCommandInput(commandBefore, validationBefore);
            throw;
        }

        var generated = session.Iterations.LastOrDefault();
        var generationSucceeded = generated is not null
            && generated.Number > iterationBefore
            && generated.Status == JobStatus.Completed
            && generated.Outputs.Any(output => !output.IsMissing)
            && CreationPipelineStateMachine.Get(session, CreationStage.Output).State == CreationStageState.Completed;
        if (!generationSucceeded)
        {
            RestoreAutomaticCommandInput(commandBefore, validationBefore);
            await SaveActiveSessionAsync();
            throw new InvalidOperationException("保留中のgenerateを実行できませんでした。Commandと生成履歴は保持されています。");
        }

        // The deferred command was consumed only after APPLY/GENERATE and
        // OUTPUT completed. The response/Handoff identity itself remains in
        // the Timeline for auditability, while a new normal Review boundary
        // will be issued by the existing output monitor.
        session.Pipeline.DeferredGenerate = null;
        session.Pipeline.MaximumIterationSafetyStop = false;
        await SaveActiveSessionAsync();
        OnPropertyChanged(nameof(SessionProgressText));
        OnPropertyChanged(nameof(HasDeferredGenerate));
        OnPropertyChanged(nameof(DeferredGenerateText));
        var generatedNumber = generated?.Number ?? session.CurrentIteration;
        StatusMessage = $"保留中のgenerateでIteration {generatedNumber:00}を開始しました。生成結果をReviewします。";
    }

    private async Task ResumeCompletedSessionAsync(CreationSession session)
    {
        var latest = session.Iterations
            .Where(item => item.Status == JobStatus.Completed && item.Outputs.Any(output => !output.IsMissing))
            .OrderByDescending(item => item.Number)
            .FirstOrDefault()
            ?? throw new InvalidOperationException("RESUME対象の完成済みOutputが見つかりません。");

        var hasExistingResumeBoundary = IsCompletedResumeRetryable(session);
        if (!hasExistingResumeBoundary)
        {
            CreationPipelineStateMachine.Resume(session);
            // CompleteSessionAsync revokes the process-local media registration.
            // Force a fresh registration for the same latest artifact without
            // creating a new output or changing its history identity.
            RevokeReviewMediaRegistration(session);
            session.Pipeline.ReviewMediaAttachment = null;
            await SaveActiveSessionAsync();
        }
        else
        {
            // Preserve the recovery Run and its persisted Resume boundary when
            // retrying after a failed send. Only clear a transient error.
            session.Resume();
        }

        if (session.Pipeline.ReviewMediaAttachment?.State != ReviewMediaAttachmentState.Attached
            && !await TryAttachPrimaryOutputAsync(latest, explicitRetry: true))
            throw new InvalidOperationException("RESUME用に最新生成物をChatGPTへ再添付できませんでした。");

        var result = await SendResumeHandoffAsync(latest, reuseExisting: hasExistingResumeBoundary);
        if (!result.IsSent)
            throw new InvalidOperationException(result.Message ?? "RESUME Handoffの送信に失敗しました。");

        await DrainQueuedBrowserExtensionResponseAsync(result.RequestId);
        RefreshHistoryFlags();
        await SaveActiveSessionAsync();
        StatusMessage = "制作を再開し、最新成果物を基準にResume Handoffを送信しました。返答を待っています。";
    }

    private bool IsCompletedResumeRetryable(CreationSession session)
        => PendingHandoffReuse.IsResume(session.PendingHandoff)
            && session.Pipeline.CurrentRun?.StartedReason == "user_resume_completed"
            && session.PendingHandoff?.Iteration == session.CurrentIteration
            && FindReviewHandoff(session.PendingHandoff, session.CurrentIteration) is
                { State: HandoffTransportState.Failed or HandoffTransportState.Copied or HandoffTransportState.Waiting };

    private bool IsCompletedResumeAwaitingResponse(CreationSession session)
        => PendingHandoffReuse.IsResume(session.PendingHandoff)
            && session.Pipeline.CurrentRun?.StartedReason == "user_resume_completed"
            && session.Pipeline.ReviewHandoff is
                { State: ReviewHandoffState.Preparing or ReviewHandoffState.Sending or ReviewHandoffState.WaitingResponse or ReviewHandoffState.Received }
            && session.Pipeline.AutomaticIteration is
                { State: AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse };

    public async Task CancelJobAsync()
    {
        if (IsAutomaticIterationActive)
        {
            if (CurrentJob is { } automaticJob && IsJobActive)
            {
                try { await _catalog.CancelAsync(automaticJob.JobId); } catch (Exception) { }
                automaticJob.Status = JobStatus.Cancelled;
                var automaticIteration = CurrentSession?.Iterations.LastOrDefault(i => i.JobId == automaticJob.JobId);
                if (automaticIteration is not null) automaticIteration.Status = JobStatus.Cancelled;
                if (CurrentSession is not null) CreationPipelineStateMachine.JobStatusChanged(CurrentSession, JobStatus.Cancelled, "ユーザーが生成をキャンセル");
            }
            if (CurrentSession is not null)
            {
                CreationPipelineStateMachine.AutomaticIterationStopped(CurrentSession);
                // Keep the already issued ReviewRequest explicitly retryable.
                // AutomaticIterationStopped describes the user cancellation
                // in the pipeline snapshot, while the Timeline transport
                // record must remain a reusable FAILED boundary.
                MarkReviewHandoffRetryable(
                    CurrentSession,
                    BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled,
                    "automatic_iteration_cancelled",
                    "自動Iterationをユーザーが停止しました。Review Handoffを再送できます。",
                    transitionLifecycle: false);
                await SaveActiveSessionAsync();
            }
            StatusMessage = "自動Iterationを停止しました。完了済みのOutputと履歴は保持されています。";
            RefreshHistoryFlags();
            NotifySelectedPreviewChanged();
            NotifyConnectionStateChanged();
            NotifyPipelineStateChanged();
            return;
        }

        if (CurrentJob is null || !IsJobActive) return;
        await _catalog.CancelAsync(CurrentJob.JobId);
        CurrentJob.Status = JobStatus.Cancelled;
        var iteration = CurrentSession?.Iterations.LastOrDefault(i => i.JobId == CurrentJob.JobId);
        if (iteration is not null) iteration.Status = JobStatus.Cancelled;
        if (CurrentSession is not null) CreationPipelineStateMachine.JobStatusChanged(CurrentSession, JobStatus.Cancelled, "ユーザーが生成をキャンセル");
        RefreshHistoryFlags();
        NotifySelectedPreviewChanged();
        await SaveActiveSessionAsync();
        StatusMessage = "Connectorが投入したJobへCANCELを要求しました。";
        OnPropertyChanged(nameof(JobStatusText));
        OnPropertyChanged(nameof(JobStatusDetailText));
        NotifyConnectionStateChanged();
        NotifyPipelineStateChanged();
    }

    public async Task RestoreBackupAsync(string backupPath)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        await _store.RestoreWorkflowBackupAsync(SelectedWorkflow, WorkflowRoot, backupPath);
        _loadedFingerprint = WorkflowCatalog.ComputeFingerprint(SelectedWorkflow.ToAbsolute(WorkflowRoot));
        await SelectWorkflowAsync(SelectedWorkflow.RelativePath);
        StatusMessage = "現在のWorkflowをbackupした後、選択した世代を復元しました。";
    }

    public async Task StartComfyUiAsync()
    {
        // Header START COMFYUI is an explicit runtime action. It shares the
        // same state/health-check coordinator as GENERATE, but it never
        // touches the MCP/Creation Pipeline gates.
        StatusMessage = "ComfyUIの状態を確認しています…";
        try
        {
            await EnsureComfyUiReadyAsync(allowStartFromError: true);
            StatusMessage = "ComfyUIがREADYです。生成を実行できます。";
        }
        catch (Exception ex)
        {
            SetComfyUiRuntimeState(ComfyUiRuntimeState.Error);
            StatusMessage = "ComfyUIを起動できませんでした。";
            await _store.LogAsync("connection", StatusMessage, ex);
            throw new InvalidOperationException(StatusMessage, ex);
        }
    }

    /// <summary>
    /// Coordinates every ComfyUI start request in the desktop process. A
    /// direct endpoint probe is always the source of truth; the MCP transport
    /// is intentionally not consulted here. The semaphore makes a manual
    /// START and a GENERATE arriving at the same time share one startup wait
    /// instead of launching two batch files.
    /// </summary>
    private async Task EnsureComfyUiReadyAsync(
        bool allowStartFromError,
        CancellationToken cancellationToken = default,
        Action? onWaitingForReady = null)
    {
        await _comfyUiStartGate.WaitAsync(cancellationToken);
        try
        {
            if (await RefreshComfyUiStatusAsync(cancellationToken)) return;

            if (_comfyUiRuntimeState == ComfyUiRuntimeState.Error)
            {
                if (!allowStartFromError)
                    throw new InvalidOperationException("ComfyUIを起動できませんでした。Endpointまたは起動状態を確認してください。");

                if (!Uri.TryCreate(Settings.Endpoint?.Trim(), UriKind.Absolute, out var endpoint)
                    || endpoint.Scheme is not ("http" or "https"))
                    throw new InvalidOperationException("ComfyUI Endpointが不正です。");

                // An explicit header retry may recover from a previous start
                // failure. GENERATE itself does not silently retry an Error;
                // it only auto-starts the normal STOPPED path.
                SetComfyUiRuntimeState(ComfyUiRuntimeState.Stopped);
            }

            if (_comfyUiRuntimeState is ComfyUiRuntimeState.Stopped or ComfyUiRuntimeState.Unknown)
            {
                SetComfyUiRuntimeState(ComfyUiRuntimeState.Starting);
                StatusMessage = "ComfyUIを起動しています…";
                LaunchComfyUiProcess();
            }
            else if (_comfyUiRuntimeState == ComfyUiRuntimeState.Starting)
            {
                StatusMessage = "ComfyUIを起動しています…";
            }

            onWaitingForReady?.Invoke();
            await WaitForComfyUiReadyAsync(cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch
        {
            SetComfyUiRuntimeState(ComfyUiRuntimeState.Error);
            throw;
        }
        finally
        {
            _comfyUiStartGate.Release();
        }
    }

    private void LaunchComfyUiProcess()
    {
        var batch = Path.Combine(Settings.PortableRoot, "run_nvidia_gpu.bat");
        if (!File.Exists(batch)) throw new FileNotFoundException("ComfyUI起動batchが見つかりません。", batch);

        var process = Process.Start(new ProcessStartInfo(batch)
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(batch),
        });
        if (process is null) throw new InvalidOperationException("ComfyUI起動プロセスを開始できませんでした。");
    }

    private async Task WaitForComfyUiReadyAsync(CancellationToken cancellationToken)
    {
        var deadline = DateTimeOffset.UtcNow + ComfyUiStartupTimeout;
        while (true)
        {
            if (await RefreshComfyUiStatusAsync(cancellationToken)) return;
            if (_comfyUiRuntimeState == ComfyUiRuntimeState.Error)
                throw new InvalidOperationException("ComfyUIを起動できませんでした。Endpointがエラーを返しました。");
            if (DateTimeOffset.UtcNow >= deadline)
            {
                SetComfyUiRuntimeState(ComfyUiRuntimeState.Error);
                throw new TimeoutException("ComfyUIを起動できませんでした。起動確認がタイムアウトしました。");
            }

            await Task.Delay(ComfyUiStartupPollInterval, cancellationToken);
        }
    }

    private async Task MonitorJobAsync(SessionIteration iteration)
    {
        while (CurrentJob is { Status: JobStatus.Queued or JobStatus.Running } job)
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
            CurrentJob = await _catalog.GetJobAsync(job.JobId);
            iteration.Status = CurrentJob.Status;
            CreationPipelineStateMachine.JobStatusChanged(CurrentSession!, CurrentJob.Status, CurrentJob.Message);
            NotifyPipelineStateChanged();
            if (CurrentJob.Status == JobStatus.Completed)
            {
                try
                {
                    iteration.Outputs = (await _catalog.FetchOutputsAsync(job.JobId, OutputRoot, CurrentJob.OutputReferences)).ToList();
                    CreationPipelineStateMachine.OutputCompleted(CurrentSession!, iteration.Outputs);
                }
                catch (Exception ex)
                {
                    iteration.Error = ex.Message;
                    CreationPipelineStateMachine.OutputFailed(CurrentSession!, ex.Message);
                    StatusMessage = $"Jobは完了しましたがOutput取得に失敗しました: {ex.Message}";
                    await SaveActiveSessionAsync();
                    await _store.LogAsync("output", StatusMessage, ex);
                    NotifyPipelineStateChanged();
                    break;
                }
                CurrentJob.Outputs = iteration.Outputs;
                if (CreationPipelineStateMachine.Get(CurrentSession!, CreationStage.Output).State == CreationStageState.Error)
                {
                    StatusMessage = CreationPipelineStateMachine.Get(CurrentSession!, CreationStage.Output).Detail;
                    await SaveActiveSessionAsync();
                    RefreshHistoryFlags();
                    NotifySelectedPreviewChanged();
                    NotifyPipelineStateChanged();
                    break;
                }
                LatestOutputs.Clear();
                foreach (var output in iteration.Outputs) LatestOutputs.Add(output);
                OnPropertyChanged(nameof(HasLatestOutputs));
                SelectedHistoryItem = HistoryItems.FirstOrDefault(item => ReferenceEquals(item.Iteration, iteration)) ?? SelectedHistoryItem;
                RefreshHistoryFlags();
                NotifySelectedPreviewChanged();
                CurrentJob.CompletedAt = DateTimeOffset.UtcNow;
                StatusMessage = $"Iteration {iteration.Number} が完了しました。出力 {iteration.Outputs.Count} 件。";
                EnsureSlotSchemaAvailable();
                // GenerationResult and ReviewRequest are two distinct protocol
                // boundaries. The result is persisted first so ATTACHED can be
                // shown independently; SendAutomaticReviewHandoffAsync issues
                // a fresh Review identity only after attachment verification.
                var existingResult = CurrentSession!.HandoffMessages.LastOrDefault(item =>
                    item.Direction == HandoffDirection.ComfyToChatGpt
                    && item.Kind == HandoffMessageKind.GenerationResult
                    && item.IterationNumber == iteration.Number);
                if (existingResult is not null)
                {
                    var attachmentAlreadyVerified = await TryAttachPrimaryOutputAsync(iteration);
                    if (attachmentAlreadyVerified && IsAutomaticIterationActive)
                        await SendAutomaticReviewHandoffAsync(iteration);
                    NotifyPipelineStateChanged();
                    break;
                }

                var resultPending = PendingHandoffFactory.CreateGenerationResult(
                    CurrentSession,
                    Slots.Select(ToWorkflowSlot),
                    "generate",
                    "complete");
                CurrentSession.PendingHandoff = resultPending;
                var resultPayload = ConnectorContextBuilder.BuildResult(CurrentSession, iteration, resultPending);
                await RecordHandoffAsync(new HandoffMessage
                {
                    Direction = HandoffDirection.ComfyToChatGpt,
                    Kind = HandoffMessageKind.GenerationResult,
                    State = HandoffTransportState.Waiting,
                    Title = $"Iteration {iteration.Number:00} の生成結果",
                    DisplayText = BuildResultTimelineDisplay(iteration),
                    Metadata = BuildResultTimelineMetadata(iteration),
                    Summary = BuildResultTimelineSummary(iteration),
                    Payload = resultPayload,
                    IterationNumber = iteration.Number,
                });
                var attachmentVerified = await TryAttachPrimaryOutputAsync(iteration);
                if (attachmentVerified && IsAutomaticIterationActive)
                {
                    await SendAutomaticReviewHandoffAsync(iteration);
                }
                NotifyPipelineStateChanged();
                break;
            }
            if (CurrentJob.Status is JobStatus.Failed or JobStatus.Cancelled)
            {
                iteration.Error = CurrentJob.Message;
                RefreshHistoryFlags();
                NotifySelectedPreviewChanged();
                StatusMessage = $"Job {CurrentJob.Status}。";
                await SaveActiveSessionAsync();
                NotifyPipelineStateChanged();
                break;
            }
        }
    }

    private CreationSession NewSessionInternal()
    {
        var maximumIterations = Settings.MaximumIterations is >= 1 and <= 1000 ? Settings.MaximumIterations : 10;
        var session = new CreationSession { Title = "新しい制作", MaximumIterations = maximumIterations };
        CreationPipelineStateMachine.PrepareContext(session);
        return session;
    }

    private async Task InitializeContextProviderAsync()
    {
        await LoadContextCatalogAsync();
        if (CurrentSession is not null)
        {
            var project = FindProjectForSession(CurrentSession);
            var chat = project is null ? null : FindChatForSession(project, CurrentSession);
            if (project is not null && chat is not null)
            {
                var before = CurrentSession.ToProjectChatBindingSnapshot();
                BindSessionContext(CurrentSession, project, chat);
                var after = CurrentSession.ToProjectChatBindingSnapshot();
                if (!BindingEquals(before, after)) await SaveActiveSessionAsync();
            }
        }

        RefreshProjectOptions(CurrentSession?.EffectiveProjectContextKey, CurrentSession?.EffectiveChatContextKey);
    }

    private async Task ReloadContextOptionsAsync(
        string? preferredProjectKey = null,
        string? preferredChatKey = null,
        CancellationToken cancellationToken = default)
    {
        await LoadContextCatalogAsync(cancellationToken);
        RefreshProjectOptions(preferredProjectKey ?? CurrentSession?.EffectiveProjectContextKey, preferredChatKey ?? CurrentSession?.EffectiveChatContextKey);
    }

    private async Task LoadContextCatalogAsync(CancellationToken cancellationToken = default)
    {
        _contextCatalog = new ProjectChatCatalog
        {
            ProviderId = _contextProvider.ProviderId,
            LoadState = ProjectChatCatalogLoadState.Loading,
        };
        NotifyContextCatalogChanged();

        try
        {
            _contextCatalog = await _contextProvider.LoadAsync(
                Sessions.Select(session => session.ToProjectChatBindingSnapshot()).ToArray(),
                cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _contextCatalog = new ProjectChatCatalog
            {
                ProviderId = _contextProvider.ProviderId,
                LoadState = ProjectChatCatalogLoadState.Error,
                ErrorCode = "context_discovery_failed",
                ErrorMessage = ex.Message,
            };
        }

        NotifyContextCatalogChanged();
    }

    private void RefreshProjectOptions(string? preferredProjectKey = null, string? preferredChatKey = null)
    {
        var targetKey = preferredProjectKey ?? _selectedProject?.Key;
        ProjectOptions.Clear();
        foreach (var project in _contextCatalog.Projects
                     .Where(item => string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase))
                     .OrderBy(item => item.CreatedAt)) ProjectOptions.Add(project);
        if (string.Equals(_contextProvider.ProviderId, ContextProviderIds.LocalJson, StringComparison.OrdinalIgnoreCase))
            ProjectOptions.Add(_createProjectOption);
        _selectedProject = ProjectOptions.FirstOrDefault(item => !item.IsCreateAction
                && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(item.Key, targetKey, StringComparison.OrdinalIgnoreCase))
            ?? ProjectOptions.FirstOrDefault(item => !item.IsCreateAction
                && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase));
        OnPropertyChanged(nameof(SelectedProject));
        OnPropertyChanged(nameof(HasSelectedProject));
        OnPropertyChanged(nameof(CanSelectChat));
        OnPropertyChanged(nameof(CanCreateChat));
        OnPropertyChanged(nameof(CanStartNewCreation));
        RefreshChatOptions(_selectedProject?.Key, preferredChatKey);
        NotifyContextSelectionChanged();
    }

    private void RefreshChatOptions(string? preferredProjectKey = null, string? preferredChatKey = null)
    {
        var targetProjectKey = preferredProjectKey ?? _selectedProject?.Key;
        var targetChatKey = preferredChatKey ?? _selectedChat?.Key;
        ChatOptions.Clear();
        if (_selectedProject is not null && string.Equals(_selectedProject.Key, targetProjectKey, StringComparison.OrdinalIgnoreCase))
        {
            foreach (var chat in _selectedProject.Chats.OrderBy(item => item.CreatedAt)) ChatOptions.Add(chat);
            if (string.Equals(_contextProvider.ProviderId, ContextProviderIds.LocalJson, StringComparison.OrdinalIgnoreCase))
                ChatOptions.Add(_createChatOption);
        }
        _selectedChat = ChatOptions.FirstOrDefault(item => !item.IsCreateAction
                && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(item.Key, targetChatKey, StringComparison.OrdinalIgnoreCase))
            ?? (string.Equals(_contextProvider.ProviderId, ContextProviderIds.ChatGptExtension, StringComparison.OrdinalIgnoreCase)
                ? ChatOptions.FirstOrDefault(item => !item.IsCreateAction && item.IsNewConversation)
                : null)
            ?? ChatOptions.FirstOrDefault(item => !item.IsCreateAction
                && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase));
        OnPropertyChanged(nameof(SelectedChat));
        OnPropertyChanged(nameof(HasSelectedChat));
        OnPropertyChanged(nameof(CanStartNewCreation));
        NotifyContextSelectionChanged();
    }

    private void ResetSessionWorkspace(CreationSession session)
    {
        Idea = session.OriginalIdea;
        CommandText = string.Empty;
        _pendingValidation = null;
        Iterations.Clear();
        LatestOutputs.Clear();
        HandoffItems.Clear();
        RebuildHistoryItems();
        OnPropertyChanged(nameof(HasIterations));
        OnPropertyChanged(nameof(HasLatestOutputs));
        OnPropertyChanged(nameof(HasHandoffItems));
        OnPropertyChanged(nameof(SessionStatusText));
        OnPropertyChanged(nameof(SessionProgressText));
        OnPropertyChanged(nameof(CurrentSessionContextText));
        NotifyPipelineStateChanged();
    }

    private ProjectContextOption? FindProjectForSession(CreationSession session)
    {
        var providerId = session.EffectiveContextProviderId;
        return _contextCatalog.Projects.FirstOrDefault(project =>
                   string.Equals(project.ProviderId, providerId, StringComparison.OrdinalIgnoreCase)
                   && string.Equals(project.Key, session.EffectiveProjectContextKey, StringComparison.OrdinalIgnoreCase))
            ?? _contextCatalog.Projects.FirstOrDefault(project =>
                string.Equals(project.ProviderId, providerId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(project.DisplayName, session.ProjectLabel, StringComparison.OrdinalIgnoreCase));
    }

    private static ChatContextOption? FindChatForSession(ProjectContextOption project, CreationSession session)
        => project.Chats.FirstOrDefault(chat => string.Equals(chat.Key, session.EffectiveChatContextKey, StringComparison.OrdinalIgnoreCase))
            ?? project.Chats.FirstOrDefault(chat => string.Equals(chat.DisplayName, session.ChatLabel, StringComparison.OrdinalIgnoreCase));

    private static void BindSessionContext(CreationSession session, ProjectContextOption project, ChatContextOption chat)
    {
        if (!string.Equals(project.ProviderId, chat.ProviderId, StringComparison.OrdinalIgnoreCase)
            || !string.Equals(project.Key, chat.ProjectKey, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("ProjectとChatのProvider参照が一致しません。");
        }

        session.ContextProviderId = project.ProviderId;
        session.ProjectContextKey = project.Key;
        session.ChatContextKey = chat.Key;
        session.ProjectId = project.ExternalId;
        session.ConversationId = chat.ExternalId;
        session.ProjectUrl = project.Url;
        session.ConversationUrl = chat.IsNewConversation ? null : chat.Url;
        if (string.Equals(project.ProviderId, ContextProviderIds.LocalJson, StringComparison.OrdinalIgnoreCase))
        {
            session.LocalProjectContextId = project.Key;
            session.LocalChatContextId = chat.Key;
        }
        else
        {
            session.LocalProjectContextId = null;
            session.LocalChatContextId = null;
        }
    }

    private static bool BindingEquals(ProjectChatBindingSnapshot left, ProjectChatBindingSnapshot right)
        => string.Equals(left.ProviderId, right.ProviderId, StringComparison.Ordinal)
            && string.Equals(left.ProjectKey, right.ProjectKey, StringComparison.Ordinal)
            && string.Equals(left.ChatKey, right.ChatKey, StringComparison.Ordinal)
            && string.Equals(left.ProjectExternalId, right.ProjectExternalId, StringComparison.Ordinal)
            && string.Equals(left.ChatExternalId, right.ChatExternalId, StringComparison.Ordinal)
            && string.Equals(left.ProjectExternalUrl, right.ProjectExternalUrl, StringComparison.Ordinal)
            && string.Equals(left.ChatExternalUrl, right.ChatExternalUrl, StringComparison.Ordinal);

    private void ValidateNewCreationSetup()
    {
        EnsureMcpConnectionReady();
        if (!HasSelectedWorkflow) throw new InvalidOperationException("制作に使うWorkflowを選択してください。");
        if (SlotDiscoveryState != SlotDiscoveryState.Loaded) throw new InvalidOperationException("選択WorkflowのSlot Schema取得が完了していません。");
        if (!HasSelectedProject) throw new InvalidOperationException("ChatGPT Projectを選択してください。");
        if (!SelectedProject!.IsTargetResolvable) throw new InvalidOperationException("選択したChatGPT Projectの識別情報を取得できません。ChatGPT側でProjectを開いてから更新してください。");
        if (!HasSelectedChat) throw new InvalidOperationException("Chatを選択してください。");
        if (SelectedChat!.IsNewConversation && !SelectedProject.IsNewConversationTargetResolvable)
            throw new InvalidOperationException("選択したChatGPT Projectで新しいChatを開始するための安全な遷移先を取得できません。ChatGPT側でProjectを開いてから更新してください。");
        if (SessionMaximumIterations is < 1 or > 1000) throw new InvalidOperationException("Maximum Iterationsは1〜1000で指定してください。");
        if (IsJobActive) throw new InvalidOperationException("生成中は新しい制作を開始できません。");
    }

    private bool RebuildHandoffItems()
    {
        HandoffItems.Clear();
        if (CurrentSession is null) return false;
        var changed = false;
        foreach (var message in CurrentSession.HandoffMessages)
        {
            if (NormalizeHandoffMessage(message)) changed = true;
        }
        foreach (var iteration in CurrentSession.Iterations.Where(item => item.Status == JobStatus.Completed && item.Outputs.Count > 0))
        {
            if (CurrentSession.HandoffMessages.Any(item => item.Direction == HandoffDirection.ComfyToChatGpt && item.IterationNumber == iteration.Number)) continue;
            CurrentSession.HandoffMessages.Add(new HandoffMessage
            {
                Direction = HandoffDirection.ComfyToChatGpt,
                Kind = HandoffMessageKind.GenerationResult,
                State = HandoffTransportState.Waiting,
                Title = $"Iteration {iteration.Number:00} の生成結果",
                DisplayText = BuildResultTimelineDisplay(iteration),
                Metadata = BuildResultTimelineMetadata(iteration),
                Summary = BuildResultTimelineSummary(iteration),
                Payload = BuildPersistedResultPayload(CurrentSession, iteration),
                IterationNumber = iteration.Number,
                CreatedAt = iteration.CreatedAt,
            });
            changed = true;
        }
        foreach (var message in CurrentSession.HandoffMessages.OrderBy(item => item.CreatedAt)) HandoffItems.Add(new HandoffTimelineItem(message));
        OnPropertyChanged(nameof(HasHandoffItems));
        return changed;
    }

    private async Task RecordHandoffAsync(HandoffMessage message)
    {
        if (CurrentSession is null) return;
        // Retry/reconnect callbacks can arrive after another Timeline record
        // has been appended. Match the complete durable message identity, not
        // only the last card, so duplicate GenerationCompleted/response events
        // remain idempotent without merging different boundaries.
        var existing = CurrentSession.HandoffMessages.LastOrDefault(item => HandoffMessageIdentity.Matches(item, message));
        if (existing is not null)
        {
            existing.State = message.State;
            existing.Kind = message.Kind;
            existing.Title = message.Title;
            existing.DisplayText = message.DisplayText;
            existing.Metadata = message.Metadata;
            existing.Summary = message.Summary;
            existing.TransportErrorCode = message.TransportErrorCode;
            existing.TransportErrorStage = message.TransportErrorStage;
            RebuildHandoffItems();
        }
        else
        {
            CurrentSession.HandoffMessages.Add(message);
            HandoffItems.Add(new HandoffTimelineItem(message));
            OnPropertyChanged(nameof(HasHandoffItems));
        }
        await SaveActiveSessionAsync();
    }

    private static string BuildCommandTimelineSummary(ConnectorCommand command)
        => command.Action == "complete"
            ? command.Reason ?? "ChatGPTが制作完了を指示しました。"
            : $"{command.Parameters.Count}件のslot変更を受信しました。適用前に検証できます。";

    private static string BuildResultTimelineSummary(SessionIteration iteration)
        => $"{iteration.Outputs.Count}件の生成物を受信しました。コピーしてChatGPTへレビューを依頼できます。";

    private string BuildCommandTimelineDisplay(ConnectorCommand command)
    {
        if (command.Action == "complete") return string.IsNullOrWhiteSpace(command.Reason) ? "ChatGPTが制作完了を指示しました。" : command.Reason!;
        foreach (var parameter in command.Parameters)
        {
            var slot = Slots.FirstOrDefault(item => string.Equals(item.Address, parameter.Key, StringComparison.OrdinalIgnoreCase));
            if (!IsPromptLike(parameter.Key, slot?.Label)) continue;
            var value = FormatParameterValue(parameter.Value);
            if (!string.IsNullOrWhiteSpace(value)) return value;
        }
        return command.Parameters.Count == 0 ? "生成パラメータを受信しました。" : $"{command.Parameters.Count}件の生成パラメータを受信しました。";
    }

    private string BuildCommandTimelineMetadata(ConnectorCommand command)
    {
        var parts = new List<string>();
        foreach (var parameter in command.Parameters)
        {
            var slot = Slots.FirstOrDefault(item => string.Equals(item.Address, parameter.Key, StringComparison.OrdinalIgnoreCase));
            var label = slot?.Label ?? parameter.Key;
            if (!IsMetadataLike(parameter.Key, label)) continue;
            var value = FormatParameterValue(parameter.Value);
            if (string.IsNullOrWhiteSpace(value)) continue;
            parts.Add(FormatMetadataPart(label, value));
            if (parts.Count == 4) break;
        }
        return string.Join(" · ", parts);
    }

    private string BuildResultTimelineDisplay(SessionIteration iteration)
    {
        var prompt = string.IsNullOrWhiteSpace(iteration.Prompt) ? "生成結果をChatGPTへレビュー用に送信します。" : $"Iteration #{iteration.Number}を生成しました。{iteration.Prompt}";
        return prompt;
    }

    private string BuildResultTimelineMetadata(SessionIteration iteration)
    {
        var parts = new List<string> { $"Iteration #{iteration.Number}" };
        var outputs = iteration.Outputs.Select(output => output.FileName).Where(name => !string.IsNullOrWhiteSpace(name)).Take(2).ToArray();
        if (outputs.Length > 0) parts.Add(string.Join(" / ", outputs));
        foreach (var parameter in iteration.Parameters)
        {
            if (!IsMetadataLike(parameter.Key, parameter.Key)) continue;
            parts.Add(FormatMetadataPart(parameter.Key, FormatParameterValue(parameter.Value)));
            if (parts.Count >= 5) break;
        }
        parts.Add($"Workflow: {CurrentSession?.BoundWorkflow?.DisplayName ?? SelectedWorkflowName}");
        return string.Join(" · ", parts);
    }

    private bool NormalizeHandoffMessage(HandoffMessage message)
    {
        var changed = false;
        if (message.Direction == HandoffDirection.ComfyToChatGpt && message.IterationNumber is null && message.Title == "制作コンテキストを送信")
        {
            message.Direction = HandoffDirection.ConnectorToChatGpt;
            message.Kind = HandoffMessageKind.CreationRequest;
            if (string.IsNullOrWhiteSpace(message.DisplayText)) message.DisplayText = string.IsNullOrWhiteSpace(CurrentSession?.OriginalIdea) ? "既存ChatGPT会話をもとに制作を開始" : CurrentSession.OriginalIdea;
            if (CurrentSession is not null) message.Metadata = $"Workflow: {CurrentSession.BoundWorkflow?.DisplayName ?? SelectedWorkflowName}{Environment.NewLine}{CurrentSession.ProjectLabel} / {CurrentSession.ChatLabel}";
            changed = true;
        }
        if (message.Kind == HandoffMessageKind.Unknown)
        {
            var inferredKind = message.Direction switch
            {
                HandoffDirection.ChatGptToComfy when message.Title.Contains("完了", StringComparison.Ordinal) => HandoffMessageKind.Complete,
                HandoffDirection.ChatGptToComfy => HandoffMessageKind.GenerationCommand,
                HandoffDirection.ComfyToChatGpt when message.IterationNumber is not null => HandoffMessageKind.GenerationResult,
                HandoffDirection.ConnectorToChatGpt => HandoffMessageKind.CreationRequest,
                _ => HandoffMessageKind.Unknown,
            };
            if (message.Kind != inferredKind)
            {
                message.Kind = inferredKind;
                changed = true;
            }
        }
        if (message.Kind == HandoffMessageKind.CreationRequest && CurrentSession is not null)
        {
            var metadata = $"Workflow: {CurrentSession.BoundWorkflow?.DisplayName ?? SelectedWorkflowName}{Environment.NewLine}{CurrentSession.ProjectLabel} / {CurrentSession.ChatLabel}";
            if (!string.Equals(message.Metadata, metadata, StringComparison.Ordinal))
            {
                message.Metadata = metadata;
                changed = true;
            }
        }
        if (message.Direction == HandoffDirection.ChatGptToComfy && string.IsNullOrWhiteSpace(message.DisplayText) && !string.IsNullOrWhiteSpace(message.Payload))
        {
            var parsed = ConnectorProtocol.Parse(message.Payload, CurrentSession?.PendingHandoff);
            if (parsed.IsValid && parsed.Command is not null)
            {
                message.DisplayText = BuildCommandTimelineDisplay(parsed.Command);
                message.Metadata = BuildCommandTimelineMetadata(parsed.Command);
                changed = true;
            }
        }
        if (string.IsNullOrWhiteSpace(message.DisplayText) && !string.IsNullOrWhiteSpace(message.Summary))
        {
            message.DisplayText = message.Summary;
            changed = true;
        }
        return changed;
    }

    private static bool IsPromptLike(string address, string? label)
    {
        var text = $"{address} {label}";
        return text.Contains("prompt", StringComparison.OrdinalIgnoreCase)
            || text.Contains("positive", StringComparison.OrdinalIgnoreCase)
            || text.Contains("text", StringComparison.OrdinalIgnoreCase)
            || text.Contains("idea", StringComparison.OrdinalIgnoreCase)
            || text.Contains("description", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsMetadataLike(string address, string? label)
    {
        var text = $"{address} {label}";
        return text.Contains("duration", StringComparison.OrdinalIgnoreCase)
            || text.Contains("length", StringComparison.OrdinalIgnoreCase)
            || text.Contains("seconds", StringComparison.OrdinalIgnoreCase)
            || text.Contains("frames", StringComparison.OrdinalIgnoreCase)
            || text.Contains("fps", StringComparison.OrdinalIgnoreCase)
            || text.Contains("aspect", StringComparison.OrdinalIgnoreCase)
            || text.Contains("ratio", StringComparison.OrdinalIgnoreCase)
            || text.Contains("resolution", StringComparison.OrdinalIgnoreCase)
            || text.Contains("megapixel", StringComparison.OrdinalIgnoreCase)
            || text.Contains("seed", StringComparison.OrdinalIgnoreCase)
            || text.Contains("width", StringComparison.OrdinalIgnoreCase)
            || text.Contains("height", StringComparison.OrdinalIgnoreCase);
    }

    private static string FormatParameterValue(JsonNode? value)
    {
        if (value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text)) return text;
        return value?.ToJsonString() ?? string.Empty;
    }

    private static string FormatMetadataPart(string label, string value)
    {
        var normalizedLabel = label.Replace('_', ' ').Trim();
        if (normalizedLabel.Contains("duration", StringComparison.OrdinalIgnoreCase) || normalizedLabel.Contains("length", StringComparison.OrdinalIgnoreCase) || normalizedLabel.Contains("seconds", StringComparison.OrdinalIgnoreCase)) return $"{value} sec";
        if (normalizedLabel.Contains("megapixel", StringComparison.OrdinalIgnoreCase)) return $"{value} MP";
        if (normalizedLabel.Contains("seed", StringComparison.OrdinalIgnoreCase)) return $"Seed {value}";
        return $"{normalizedLabel}: {value}";
    }

    private static string NormalizeContextName(string? name, string label)
    {
        var value = (name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException($"{label}名を入力してください。");
        if (value.Length > 80) throw new InvalidOperationException($"{label}名は80文字以内で入力してください。");
        if (value.Any(char.IsControl)) throw new InvalidOperationException($"{label}名に制御文字は使用できません。");
        return value;
    }

    private static string BlankFallback(string? value, string fallback) => string.IsNullOrWhiteSpace(value) ? fallback : value;

    private void RebuildHistoryItems()
    {
        HistoryItems.Clear();
        foreach (var iteration in Iterations) HistoryItems.Add(new GenerationHistoryItem(iteration));
        RefreshHistoryFlags();
        SelectedHistoryItem = HistoryItems.LastOrDefault(item => item.HasOutput) ?? HistoryItems.LastOrDefault();
        NotifyHistoryChanged();
    }

    private void RefreshHistoryFlags()
    {
        var latest = HistoryItems.LastOrDefault();
        if (CurrentSession is not null) CreationPipelineStateMachine.EnsureInitialized(CurrentSession);
        foreach (var item in HistoryItems)
        {
            var isLatest = ReferenceEquals(item, latest);
            item.UpdateFlags(isLatest);
        }
        OnPropertyChanged(nameof(LatestIterationText));
        OnPropertyChanged(nameof(IsViewingLatest));
        OnPropertyChanged(nameof(ViewingStateText));
        OnPropertyChanged(nameof(CanReturnToLatest));
    }

    private void NotifyHistoryChanged()
    {
        OnPropertyChanged(nameof(HasHistoryItems));
        OnPropertyChanged(nameof(LatestIterationText));
        NotifyGenerationDisplayChanged();
        NotifySelectedPreviewChanged();
    }

    private void NotifySelectedPreviewChanged()
    {
        OnPropertyChanged(nameof(SelectedPreviewOutput));
        OnPropertyChanged(nameof(HasSelectedPreviewOutput));
        OnPropertyChanged(nameof(IsSelectedPreviewMissing));
        OnPropertyChanged(nameof(CanSaveSelectedOutputCopy));
        OnPropertyChanged(nameof(ViewingIterationText));
        OnPropertyChanged(nameof(IsViewingLatest));
        OnPropertyChanged(nameof(ViewingStateText));
        OnPropertyChanged(nameof(CanReturnToLatest));
        OnPropertyChanged(nameof(CurrentOutputFolderPath));
        NotifyGenerationDisplayChanged();
    }

    private void NotifyGenerationDisplayChanged()
    {
        // The selected item can temporarily point at a queued/running
        // iteration while the preview intentionally falls back to the last
        // completed output. Notify both the generation flags and the derived
        // preview properties whenever that fallback can change.
        OnPropertyChanged(nameof(SelectedPreviewOutput));
        OnPropertyChanged(nameof(HasSelectedPreviewOutput));
        OnPropertyChanged(nameof(IsSelectedPreviewMissing));
        OnPropertyChanged(nameof(CanSaveSelectedOutputCopy));
        OnPropertyChanged(nameof(ViewingIterationText));
        OnPropertyChanged(nameof(ViewingStateText));
        OnPropertyChanged(nameof(IsGenerationInProgress));
        OnPropertyChanged(nameof(HasCompletedPreview));
        OnPropertyChanged(nameof(ShowOutputEmptyState));
        OnPropertyChanged(nameof(ShowOutputGeneratingState));
        OnPropertyChanged(nameof(ShowOutputUpdatingState));
        OnPropertyChanged(nameof(CurrentOutputGenerationLabel));
        OnPropertyChanged(nameof(CurrentOutputGenerationHint));
        OnPropertyChanged(nameof(CurrentOutputGenerationDetail));
        OnPropertyChanged(nameof(JobStatusDetailText));
    }

    private Dictionary<string, JsonNode?> BuildChanges()
        => Slots
            .Select(item => (item, value: item.ToJsonNode()))
            .Where(entry => !JsonNode.DeepEquals(entry.item.CurrentValue, entry.value))
            .ToDictionary(entry => entry.item.Address, entry => entry.value, StringComparer.OrdinalIgnoreCase);

    private string? FindPrompt(Dictionary<string, JsonNode?> changes)
    {
        var changedPrompt = changes
            .FirstOrDefault(item => item.Key.Contains("prompt", StringComparison.OrdinalIgnoreCase))
            .Value;
        changedPrompt ??= changes
            .FirstOrDefault(item => item.Key.Contains("text", StringComparison.OrdinalIgnoreCase))
            .Value;
        if (changedPrompt is JsonValue changedValue && changedValue.TryGetValue<string>(out var changedText)) return changedText;

        var currentPrompt = Slots
            .Where(item => item.Address.Contains("prompt", StringComparison.OrdinalIgnoreCase)
                          || item.Label.Contains("prompt", StringComparison.OrdinalIgnoreCase))
            .Select(item => item.ToJsonNode())
            .OfType<JsonValue>()
            .Select(value => value.TryGetValue<string>(out var text) ? text : null)
            .FirstOrDefault(text => !string.IsNullOrWhiteSpace(text));
        if (!string.IsNullOrWhiteSpace(currentPrompt)) return currentPrompt;

        return Slots
            .Where(item => item.Address.Contains("text", StringComparison.OrdinalIgnoreCase)
                          || item.Label.Contains("text", StringComparison.OrdinalIgnoreCase))
            .Select(item => item.ToJsonNode())
            .OfType<JsonValue>()
            .Select(value => value.TryGetValue<string>(out var text) ? text : null)
            .FirstOrDefault(text => !string.IsNullOrWhiteSpace(text));
    }
    private static WorkflowSlot ToWorkflowSlot(SlotEditorItem item) => new()
    {
        Address = item.Address,
        Label = item.Label,
        Type = item.Type,
        CurrentValue = item.ToJsonNode(),
        Choices = new JsonArray(item.Choices.Select(value => (JsonNode?)JsonValue.Create(value)).ToArray()),
        Minimum = item.Minimum,
        Maximum = item.Maximum,
    };

    private void EnsureSlotSchemaAvailable()
    {
        EnsureMcpConnectionReady();
        if (SlotDiscoveryState == SlotDiscoveryState.Loading) throw new InvalidOperationException("Workflow slotを読み込み中です。完了後にもう一度SEND TO CHATGPTを押してください。");
        if (SlotDiscoveryState == SlotDiscoveryState.Failed) throw new InvalidOperationException($"Workflow slotの取得に失敗しています。再読み込みしてください。{(string.IsNullOrWhiteSpace(SlotLoadError) ? string.Empty : $" 詳細: {SlotLoadError}")}");
        if (SlotDiscoveryState != SlotDiscoveryState.Loaded) throw new InvalidOperationException("Workflow slot schemaが未取得です。Workflowを再選択して読み込んでください。");
    }

    private void EnsureBootstrapResendAllowed(string payload)
    {
        if (!_isCurrentSessionActivated || CurrentSession is null)
        {
            throw new InvalidOperationException("左側の設定から新しい制作を開始してください。");
        }
        if (HasPendingContextChange)
        {
            throw new InvalidOperationException("選択中のContextをSessionへ反映してからHandoffを再送してください。");
        }
        if (IsJobActive)
        {
            throw new InvalidOperationException("生成中はHandoffを再送できません。");
        }
        if (!PendingHandoffReuse.TryGetResendableBootstrapPayload(CurrentSession, out var savedPayload)
            || !string.Equals(savedPayload, payload, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("再送対象の保存済みHandoffが見つかりません。新しい制作Contextを確認してください。");
        }
    }

    private void EnsureSendToChatGptAllowed()
    {
        if (!IsConnected) EnsureMcpConnectionReady();
        if (!_isCurrentSessionActivated || CurrentSession is null)
        {
            throw new InvalidOperationException("左側の設定から新しい制作を開始してください。");
        }
        if (HasPendingContextChange)
        {
            throw new InvalidOperationException("選択中のContextをSessionへ反映してからChatGPTへ送信してください。");
        }
        if (!CurrentSession.Pipeline.ContextBound || CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Context).State != CreationStageState.Completed)
        {
            throw new InvalidOperationException("制作ContextをSessionへBindingしてください。");
        }
        EnsureSlotSchemaAvailable();
        if (IsJobActive) throw new InvalidOperationException("生成中はChatGPTへ送信できません。");
        var ideaState = CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Idea).State;
        if (ideaState is not (CreationStageState.Current or CreationStageState.WaitingUser))
        {
            throw new InvalidOperationException("IDEA Stageを確認してからChatGPTへ送信してください。");
        }
    }

    private static string BuildPersistedResultPayload(CreationSession session, SessionIteration iteration)
    {
        var pending = PendingHandoffReuse.IsGenerationResult(session.PendingHandoff)
            && session.PendingHandoff!.Iteration == iteration.Number
            ? session.PendingHandoff
            : PendingHandoffFactory.CreateGenerationResult(session, [], "generate", "complete");
        return ConnectorContextBuilder.BuildResult(session, iteration, pending);
    }

    private void RevokeReviewMediaRegistration(CreationSession? session)
    {
        var mediaId = session?.Pipeline.ReviewMediaAttachment?.MediaId;
        if (string.IsNullOrWhiteSpace(mediaId)) return;

        // Revoke only the opaque process-local registration. The original
        // ComfyUI output remains untouched and can still be used for a
        // deliberate retry or manual attachment.
        _browserExtensionBridge.RevokeMedia(mediaId);
    }

    /// <summary>
    /// Attaches the Primary Output owned by one completed iteration to the
    /// ChatGPT tab that accepted this session's Bootstrap Handoff. Media
    /// delivery is a separate transport operation and never rebuilds the
    /// Review Handoff or its PendingHandoff identity.
    /// </summary>
    private async Task<bool> TryAttachPrimaryOutputAsync(SessionIteration iteration, bool explicitRetry = false)
    {
        await _reviewMediaAttachmentGate.WaitAsync();
        try
        {
            return await TryAttachPrimaryOutputCoreAsync(iteration, explicitRetry);
        }
        finally
        {
            _reviewMediaAttachmentGate.Release();
        }
    }

    private async Task<bool> TryAttachPrimaryOutputCoreAsync(SessionIteration iteration, bool explicitRetry)
    {
        var session = CurrentSession;
        if (!_isCurrentSessionActivated || session is null || iteration.Status != JobStatus.Completed) return false;

        var output = iteration.Outputs.FirstOrDefault();
        if (output is null)
        {
            StatusMessage = $"Iteration {iteration.Number} のPrimary Outputが見つかりません。";
            NotifyPipelineStateChanged();
            return false;
        }

        string fullPath = string.Empty;
        string outputRoot = string.Empty;
        FileInfo? stableFile = null;
        var pathIsSafe = false;
        try
        {
            if (!string.IsNullOrWhiteSpace(output.FullPath))
            {
                fullPath = Path.GetFullPath(output.FullPath);
                outputRoot = Path.GetFullPath(OutputRoot);
                pathIsSafe = PathSafety.IsWithin(outputRoot, fullPath);
                if (pathIsSafe && File.Exists(fullPath))
                    stableFile = await WaitForStableReviewOutputAsync(fullPath);
            }
        }
        catch (Exception)
        {
            // Exception text can contain a local path. Keep this failure
            // diagnostic generic and path-free.
            pathIsSafe = false;
            stableFile = null;
        }

        var fileName = ResolveReviewFileName(output, fullPath);
        var size = stableFile?.Length ?? 0;
        var lastWriteTicks = stableFile?.LastWriteTimeUtc.Ticks ?? 0;
        var outputIdentity = BuildReviewOutputIdentity(fileName, size, lastWriteTicks, iteration);
        var mimeType = BrowserExtensionMediaTypes.TryResolve(output.FileName, output.Type, out var resolvedMime)
            ? resolvedMime
            : string.Empty;
        var existing = session.Pipeline.ReviewMediaAttachment;
        var sameOutput = existing is not null
            && existing.Iteration == iteration.Number
            && string.Equals(existing.OutputIdentity, outputIdentity, StringComparison.Ordinal);

        if (sameOutput && existing!.State is (ReviewMediaAttachmentState.Preparing or ReviewMediaAttachmentState.Attaching or ReviewMediaAttachmentState.Attached))
            return existing.State == ReviewMediaAttachmentState.Attached;
        if (sameOutput && existing is { State: ReviewMediaAttachmentState.Failed } && !explicitRetry)
            return false;

        if (existing?.MediaId is { Length: > 0 }) _browserExtensionBridge.RevokeMedia(existing.MediaId);

        CreationPipelineStateMachine.ReviewMediaPreparing(
            session,
            iteration.Number,
            session.Id,
            outputIdentity,
            fileName,
            mimeType,
            size);
        await SaveActiveSessionAsync();
        NotifyPipelineStateChanged();

        if (!pathIsSafe || stableFile is null)
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.ReviewOutputNotFound,
                "output_resolved",
                "生成完了したPrimary Outputを安定したファイルとして確認できませんでした。");
            return false;
        }

        if (string.IsNullOrWhiteSpace(fileName) || !IsSafeReviewFileName(fileName))
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.ReviewOutputNotFound,
                "output_resolved",
                "Primary Outputのファイル名を確認できませんでした。");
            return false;
        }

        if (!BrowserExtensionMediaTypes.IsSupported(mimeType))
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.UnsupportedMediaType,
                "output_resolved",
                "Primary OutputはPhase 5.1で対応していないMIME typeです。");
            return false;
        }

        if (size <= 0 || size > MaxReviewMediaBytes)
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                size > MaxReviewMediaBytes
                    ? BrowserExtensionReviewMediaErrorCodes.MediaTooLarge
                    : BrowserExtensionReviewMediaErrorCodes.ReviewOutputNotFound,
                "output_resolved",
                size > MaxReviewMediaBytes
                    ? "Primary Outputが許可されたサイズ上限を超えています。"
                    : "Primary Outputのサイズを確認できませんでした。");
            return false;
        }

        var targetTabId = session.BrowserExtensionTargetTabId;
        var targetTabUrl = session.BrowserExtensionTargetTabUrl;
        if (!targetTabId.HasValue || string.IsNullOrWhiteSpace(targetTabUrl))
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.ReviewTargetTabNotFound,
                "target_tab_check",
                "このSessionのHandoff送信先ChatGPTタブが記録されていません。");
            return false;
        }

        if (!IsBrowserExtensionConnected)
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected,
                "bridge_connection",
                "Browser Extension Bridgeに接続されていません。");
            return false;
        }

        var mediaId = Guid.NewGuid().ToString("N");
        var requestId = Guid.NewGuid().ToString("N");
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(10);
        try
        {
            _browserExtensionBridge.RegisterMedia(new BrowserExtensionMediaRegistration
            {
                MediaId = mediaId,
                SessionId = session.Id,
                Iteration = iteration.Number,
                OutputIdentity = outputIdentity,
                FileName = fileName,
                MimeType = mimeType,
                Size = size,
                ExpiresAt = expiresAt,
                FullPath = fullPath,
                AllowedRoot = outputRoot,
            });
        }
        catch (Exception)
        {
            await FailReviewMediaAttachmentAsync(
                session,
                iteration,
                outputIdentity,
                BrowserExtensionReviewMediaErrorCodes.MediaRegistrationFailed,
                "media_registered",
                "生成物を一時Mediaとして登録できませんでした。");
            return false;
        }

        CreationPipelineStateMachine.ReviewMediaAttaching(
            session,
            requestId,
            mediaId,
            targetTabId,
            targetTabUrl);
        await SaveActiveSessionAsync();
        NotifyPipelineStateChanged();

        BrowserExtensionMediaAttachResult result;
        try
        {
            result = await _browserExtensionBridge.SendMediaAttachAsync(new BrowserExtensionMediaAttachRequest(
                requestId,
                session.Id,
                iteration.Number,
                mediaId,
                fileName,
                mimeType,
                size,
                targetTabId.Value,
                targetTabUrl,
                session.ConversationId,
                session.ConversationUrl,
                session.ProjectId));
        }
        catch (Exception)
        {
            result = new(
                requestId,
                session.Id,
                iteration.Number,
                mediaId,
                "error",
                BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected,
                "Browser Extension Bridgeとの通信に失敗しました。",
                "bridge_connection");
        }

        if (result.IsAttached)
        {
            CreationPipelineStateMachine.ReviewMediaAttached(session, result);
            UpdateGenerationResultTransport(iteration, HandoffTransportState.Attached, null, null);
            _browserExtensionBridge.RevokeMedia(mediaId);
            await SaveActiveSessionAsync();
            StatusMessage = "生成結果を同じChatGPT会話へ添付しました。Review Handoff送信待ちです。";
            NotifyPipelineStateChanged();
            return true;
        }

        _browserExtensionBridge.RevokeMedia(mediaId);
        await FailReviewMediaAttachmentAsync(
            session,
            iteration,
            outputIdentity,
            result.ErrorCode ?? BrowserExtensionReviewMediaErrorCodes.AttachmentUploadFailed,
            result.Stage ?? "attachment_uploading",
            result.Message ?? "ChatGPTへの生成物添付に失敗しました。");
        return false;
    }

    /// <summary>Explicit retry entry point. Reconnection alone never calls this.</summary>
    public async Task AttachReviewOutputAsync()
    {
        var session = CurrentSession;
        if (!_isCurrentSessionActivated || session is null)
            throw new InvalidOperationException("制作セッションがありません。");
        if (session.Pipeline.ReviewMediaAttachment?.State != ReviewMediaAttachmentState.Failed)
            throw new InvalidOperationException("再添付できる失敗状態の生成物がありません。");

        var attachment = session.Pipeline.ReviewMediaAttachment;
        var iteration = session.Iterations.FirstOrDefault(item => item.Number == attachment!.Iteration);
        if (iteration is null)
            throw new InvalidOperationException("再添付対象のIterationが見つかりません。");

        await TryAttachPrimaryOutputAsync(iteration, explicitRetry: true);
    }

    private async Task FailReviewMediaAttachmentAsync(
        CreationSession session,
        SessionIteration iteration,
        string outputIdentity,
        string errorCode,
        string stage,
        string message)
    {
        if (session.Pipeline.ReviewMediaAttachment is not { Iteration: var attachmentIteration }
            || attachmentIteration != iteration.Number
            || !string.Equals(session.Pipeline.ReviewMediaAttachment.OutputIdentity, outputIdentity, StringComparison.Ordinal))
        {
            CreationPipelineStateMachine.ReviewMediaPreparing(
                session,
                iteration.Number,
                session.Id,
                outputIdentity,
                session.Pipeline.ReviewMediaAttachment?.FileName ?? string.Empty,
                session.Pipeline.ReviewMediaAttachment?.MimeType ?? string.Empty,
                session.Pipeline.ReviewMediaAttachment?.Size ?? 0);
        }

        CreationPipelineStateMachine.ReviewMediaFailed(session, errorCode, stage, message);
        if (session.Pipeline.AutomaticIteration?.State is AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse)
        {
            CreationPipelineStateMachine.AutomaticIterationFailed(session, errorCode, stage, message);
        }
        UpdateGenerationResultTransport(iteration, HandoffTransportState.Failed, errorCode, stage);
        await SaveActiveSessionAsync();
        StatusMessage = $"生成結果のChatGPT添付に失敗しました。({errorCode}, stage={stage})";
        NotifyPipelineStateChanged();
    }

    private void UpdateGenerationResultTransport(
        SessionIteration iteration,
        HandoffTransportState state,
        string? errorCode,
        string? stage)
    {
        var message = CurrentSession?.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ComfyToChatGpt
            && item.Kind == HandoffMessageKind.GenerationResult
            && item.IterationNumber == iteration.Number);
        if (message is null) return;

        message.State = state;
        message.TransportErrorCode = state == HandoffTransportState.Failed ? errorCode : null;
        message.TransportErrorStage = state == HandoffTransportState.Failed ? stage : null;
        RebuildHandoffItems();
    }

    private static async Task<FileInfo?> WaitForStableReviewOutputAsync(string fullPath)
    {
        var deadline = DateTimeOffset.UtcNow + ReviewMediaStabilityTimeout;
        long? previousSize = null;
        DateTime? previousWrite = null;
        while (DateTimeOffset.UtcNow < deadline)
        {
            try
            {
                if (File.Exists(fullPath))
                {
                    var current = new FileInfo(fullPath);
                    if (current.Length > 0
                        && previousSize == current.Length
                        && previousWrite == current.LastWriteTimeUtc)
                    {
                        return current;
                    }

                    previousSize = current.Length;
                    previousWrite = current.LastWriteTimeUtc;
                }
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }

            await Task.Delay(ReviewMediaStabilityPollInterval);
        }

        return null;
    }

    private static string ResolveReviewFileName(OutputArtifact output, string fullPath)
    {
        var fileName = Path.GetFileName(output.FileName ?? string.Empty);
        if (string.IsNullOrWhiteSpace(fileName) && !string.IsNullOrWhiteSpace(fullPath))
            fileName = Path.GetFileName(fullPath);
        return fileName;
    }

    private static bool IsSafeReviewFileName(string value)
        => !string.IsNullOrWhiteSpace(value)
            && value.Length <= 255
            && value is not "." and not ".."
            && !value.Contains('/')
            && !value.Contains('\\')
            && string.Equals(Path.GetFileName(value), value, StringComparison.Ordinal)
            && !value.Any(static character => char.IsControl(character) || character is '"' or '\r' or '\n');

    private static string BuildReviewOutputIdentity(
        string fileName,
        long size,
        long lastWriteTicks,
        SessionIteration iteration)
    {
        var material = string.Join('\u001f',
            fileName,
            size.ToString(System.Globalization.CultureInfo.InvariantCulture),
            lastWriteTicks.ToString(System.Globalization.CultureInfo.InvariantCulture),
            iteration.Number.ToString(System.Globalization.CultureInfo.InvariantCulture),
            iteration.CreatedAt.UtcDateTime.Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture));
        return Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(material)));
    }

    private static string NormalizeWorkflowName(string name)
    {
        var value = Path.GetFileNameWithoutExtension(name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value) || value is "." or ".." || value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidOperationException("Workflow名が不正です。");
        return value;
    }

    private bool IsCurrentSlotDiscovery(long version, WorkflowIdentity identity)
        => Volatile.Read(ref _slotDiscoveryVersion) == version
            && SelectedWorkflow is { } selected
            && string.Equals(selected.RelativePath, identity.RelativePath, StringComparison.OrdinalIgnoreCase);

    private void SlotChanged(object? sender, PropertyChangedEventArgs e) { if (e.PropertyName == nameof(SlotEditorItem.ValueText)) IsDirty = true; }

    private void BrowserExtensionBridge_StatusChanged(object? sender, BrowserExtensionBridgeStatusChangedEventArgs e)
    {
        void Apply()
        {
            OnPropertyChanged(nameof(BrowserExtensionConnectionState));
            OnPropertyChanged(nameof(BrowserExtensionConnectionStateText));
            OnPropertyChanged(nameof(BrowserExtensionSystemState));
            OnPropertyChanged(nameof(BrowserExtensionPairingState));
            OnPropertyChanged(nameof(BrowserExtensionPairingStateText));
            OnPropertyChanged(nameof(IsBrowserExtensionPairingRequired));
            OnPropertyChanged(nameof(IsBrowserExtensionPairingCodeVisible));
            OnPropertyChanged(nameof(BrowserExtensionPairingCode));
            OnPropertyChanged(nameof(IsBrowserExtensionConnected));
            OnPropertyChanged(nameof(IsBrowserExtensionBridgeRunning));
            OnPropertyChanged(nameof(BrowserExtensionEndpoint));
            OnPropertyChanged(nameof(BrowserExtensionStatusDetail));
            OnPropertyChanged(nameof(ChatGptContextLoadState));
            OnPropertyChanged(nameof(ChatGptContextLoadStateText));
            OnPropertyChanged(nameof(ChatGptContextErrorText));
            OnPropertyChanged(nameof(CanRefreshChatGptContext));
            OnPropertyChanged(nameof(SystemConnectionSummary));
            OnPropertyChanged(nameof(HasReviewMediaAttachment));
            OnPropertyChanged(nameof(ReviewMediaAttachmentStateText));
            OnPropertyChanged(nameof(IsReviewMediaAttachmentFailed));
            OnPropertyChanged(nameof(CanAttachReviewOutput));
            OnPropertyChanged(nameof(CanResendBootstrapHandoff));
            OnPropertyChanged(nameof(CanResendReviewHandoff));
            OnPropertyChanged(nameof(CanSendToChatGpt));
            OnPropertyChanged(nameof(SendToChatGptButtonText));
            OnPropertyChanged(nameof(SendToChatGptHint));
        }

        if (_notificationContext is null)
        {
            Apply();
            return;
        }

        try { _notificationContext.Post(static state => ((Action)state!).Invoke(), (Action)Apply); }
        catch (InvalidOperationException) { }
    }

    private void BrowserExtensionBridge_ChatGptContextChanged(
        object? sender,
        BrowserExtensionChatGptContextChangedEventArgs e)
    {
        void Apply()
        {
            // Context change events are informational.  Do not silently
            // replace the user's selected Project/Chat or an active Session's
            // bound target; an explicit Refresh is required to change the
            // selectable catalog.
            CurrentChatGptContext = e.Context;
            OnPropertyChanged(nameof(CurrentChatGptContext));
        }

        if (_notificationContext is null)
        {
            Apply();
            return;
        }

        try { _notificationContext.Post(static state => ((Action)state!).Invoke(), (Action)Apply); }
        catch (InvalidOperationException) { }
    }

    private void BrowserExtensionBridge_AssistantResponseReceived(
        object? sender,
        BrowserExtensionAssistantResponseEventArgs e)
    {
        void Apply() => _ = HandleBrowserExtensionAssistantResponseAsync(e.Response);

        if (_notificationContext is null)
        {
            Apply();
            return;
        }

        try { _notificationContext.Post(static state => ((Action)state!).Invoke(), (Action)Apply); }
        catch (InvalidOperationException) { }
    }

    private async Task HandleBrowserExtensionAssistantResponseAsync(BrowserExtensionAssistantResponse response)
    {
        await _store.LogAsync(
            "automation",
            $"assistant response received request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=assistant_response_received");
        var session = CurrentSession;
        if (session?.Pipeline.AutomaticIteration?.State == AutomaticIterationState.Stopped
            && session.Pipeline.ReviewHandoff is { HandoffId: var stoppedHandoff }
            && string.Equals(stoppedHandoff, response.HandoffId, StringComparison.Ordinal))
        {
            await _store.LogAsync("automation", $"stale assistant.response ignored request_id={response.RequestId} handoff_id={response.HandoffId} error_code={BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled}");
            return;
        }
        await _store.LogAsync(
            "automation",
            $"response correlation started request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=response_correlation_started");
        var validation = BrowserExtensionResponseCorrelation.Validate(response, session);
        if (!validation.IsValid)
        {
            // The Extension sends assistant.response immediately after the
            // Phase 2 handoff.result. It can therefore race the Desktop's
            // asynchronous persistence of the outgoing SENT state. Keep that
            // response in memory only until the send operation records SENT;
            // do not weaken the normal correlation gate or accept it after a
            // failed/finished send attempt.
            if (session is not null
                && string.Equals(validation.Stage, "handoff_not_sent", StringComparison.Ordinal)
                && IsBrowserExtensionSendInProgress(response.RequestId)
                && BrowserExtensionResponseCorrelation.MatchesPendingIdentity(response, session, out _))
            {
                lock (_browserExtensionResponseGate)
                {
                    _queuedBrowserExtensionResponses[response.RequestId] = response;
                }
                await _store.LogAsync(
                    "automation",
                    $"response correlation deferred request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=handoff_not_sent");
                return;
            }

            // A response for another session/boundary must not alter the
            // visible workspace. Matched transport/validation failures remain
            // visible as a FAILED inbound timeline item while PendingHandoff
            // is deliberately retained for inspection/retry.
            string? correlationStage = null;
            var identityMatched = false;
            var pendingMatches = false;
            if (session is not null)
            {
                identityMatched = BrowserExtensionResponseCorrelation.MatchesPendingIdentity(response, session, out _);
                pendingMatches = BrowserExtensionResponseCorrelation.MatchesPending(response, session, out correlationStage);
            }
            if (!pendingMatches)
            {
                // A response with the current Review identity can still be a
                // real failure (for example a target-conversation mismatch).
                // Stop the automatic loop and retain the Review transport in
                // that case. Responses arriving after an already closed
                // boundary, or after an explicit Clipboard fallback, are
                // stale and must remain no-ops.
                var staleClosedStage = string.Equals(correlationStage, "automatic_iteration_closed", StringComparison.Ordinal)
                    || string.Equals(correlationStage, "review_boundary_closed", StringComparison.Ordinal)
                    || string.Equals(correlationStage, "handoff_not_sent", StringComparison.Ordinal);
                if (session is not null
                    && identityMatched
                    && PendingHandoffReuse.IsReview(session.PendingHandoff)
                    && !staleClosedStage)
                {
                    await _store.LogAsync(
                        "automation",
                        $"response correlation rejected request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} error_code={validation.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewResponseNotCorrelated} stage={correlationStage ?? "review_response_correlation"}");
                    CreationPipelineStateMachine.ConnectorResponseFailed(
                        session,
                        $"ChatGPT Response受信エラー ({validation.ErrorCode ?? "response_rejected"}, stage={correlationStage ?? "unknown"})");
                    MarkReviewHandoffRetryable(
                        session,
                        validation.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewResponseNotCorrelated,
                        correlationStage ?? "review_response_correlation",
                        validation.Message);
                    await RecordBrowserExtensionResponseFailureAsync(
                        response,
                        validation.ErrorCode ?? BrowserExtensionAssistantResponseErrorCodes.ResponseNotCorrelated,
                        correlationStage ?? "review_response_correlation",
                        validation.Message);
                    StatusMessage = $"ChatGPTの返答を受信しましたが、Review Responseを相関できませんでした。({validation.ErrorCode ?? "response_rejected"})";
                    NotifyPipelineStateChanged();
                    return;
                }
                await _store.LogAsync(
                    "bridge.response",
                    $"Assistant response rejected request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} error_code={validation.ErrorCode ?? "response_rejected"} stage={correlationStage ?? validation.Stage ?? "unknown"}");
                return;
            }

            CreationPipelineStateMachine.ConnectorResponseFailed(
                session!,
                $"ChatGPT Response受信エラー ({validation.ErrorCode ?? "response_rejected"}, stage={validation.Stage ?? "unknown"})");
            if (PendingHandoffReuse.IsReview(session!.PendingHandoff))
            {
                MarkReviewHandoffRetryable(
                    session,
                    validation.ErrorCode ?? BrowserExtensionHandoffErrorCodes.ReviewResponseNotCorrelated,
                    validation.Stage ?? "review_response_validation",
                    validation.Message);
            }
            await RecordBrowserExtensionResponseFailureAsync(
                response,
                validation.ErrorCode ?? BrowserExtensionAssistantResponseErrorCodes.ResponseExtractionFailed,
                validation.Stage ?? "response_validation",
                validation.Message);
            await _store.LogAsync(
                "automation",
                $"response correlation rejected request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} error_code={validation.ErrorCode ?? BrowserExtensionAssistantResponseErrorCodes.ResponseExtractionFailed} stage={validation.Stage ?? "response_validation"}");
            StatusMessage = $"ChatGPTの返答を受信しましたが、Connector Responseを確認できませんでした。({validation.ErrorCode ?? "response_rejected"})";
            NotifyPipelineStateChanged();
            return;
        }

        if (validation.ProtocolResult?.Command is not { } command || response.Payload is not { Length: > 0 } payload)
        {
            return;
        }

        await _store.LogAsync(
            "automation",
            $"response correlation accepted request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=response_correlation_accepted");

        await _automaticResponseExecutionGate.WaitAsync();
        try
        {
            var responseKey = string.Empty;
            if (!AutomaticResponseExecutionCoordinator.TryBegin(session!, response, out responseKey))
            {
                // Service Worker reconnects can replay the same assistant
                // response. The persisted response identity is the guard
                // against running APPLY or GENERATE twice.
                _ = _store.LogAsync(
                    "automation",
                    $"assistant.response duplicate ignored request_id={response.RequestId} handoff_id={response.HandoffId}");
                return;
            }

            try
            {
                if (PendingHandoffReuse.IsReview(session!.PendingHandoff))
                    CreationPipelineStateMachine.ReviewHandoffResponseReceived(session);
                else
                    CreationPipelineStateMachine.AutomaticIterationStarted(session!);
                SetCommandTextFromBrowserResponse(payload);
                CreationPipelineStateMachine.ConnectorResponseReceived(session!);
                await RecordBrowserExtensionResponseAsync(response, command, payload);
                await _store.LogAsync(
                    "automation",
                    $"response correlated request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=response_correlated action={command.Action}");
                OnPropertyChanged(nameof(CanApplyCommand));
                NotifyPipelineStateChanged();

                await _store.LogAsync(
                    "automation",
                    $"response execution started request_id={response.RequestId} session_id={response.SessionId} handoff_id={response.HandoffId} boundary_id={response.BoundaryId} target_tab_id={response.TargetTabId?.ToString() ?? "none"} stage=response_execution_started action={command.Action}");
                await ExecuteBrowserExtensionCommandAutomaticallyAsync(session!, responseKey, response, command);
            }
            catch (Exception ex)
            {
                await FailAutomaticResponseAsync(
                    session!,
                    responseKey,
                    command.Action,
                    ResolveAutomaticErrorCode(session!, ex),
                    ResolveAutomaticErrorStage(session!, ex),
                    ex.Message);
            }
        }
        finally
        {
            _automaticResponseExecutionGate.Release();
        }
    }

    private async Task ExecuteBrowserExtensionCommandAutomaticallyAsync(
        CreationSession session,
        string responseKey,
        BrowserExtensionAssistantResponse response,
        ConnectorCommand responseCommand)
    {
        // Run the same strict parser and CommandValidated transition used by
        // the manual "読み込んで確認" action. Browser-side validation is a
        // transport safety gate; Desktop remains the final authority.
        // ImportCommandAsync normally clears the command buffer after a
        // successful `complete` command. Automatic execution still needs the
        // validated result after that shared import path returns; defer the
        // clear until the automatic terminal state has been recorded.
        await ImportCommandAsync(clearCommandOnComplete: false);
        if (_pendingValidation is not { IsValid: true, Command: not null } validation)
        {
            await _store.LogAsync(
                "automation",
                $"automatic validation failed request_id={responseKey.Split('\u001f')[0]} handoff_id={session.PendingHandoff?.HandoffId} validation_state={(_pendingValidation is null ? "missing" : "invalid")} error_count={_pendingValidation?.Errors.Count ?? 0} stage=automatic_validation");
            await FailAutomaticResponseAsync(
                session,
                responseKey,
                responseCommand.Action,
                BrowserExtensionAssistantResponseErrorCodes.ConnectorResponseInvalid,
                "automatic_validation",
                "Connector Responseのstrict validationに失敗しました。");
            return;
        }

        var command = validation.Command;
        if (!string.Equals(command.Action, responseCommand.Action, StringComparison.Ordinal))
        {
            await FailAutomaticResponseAsync(
                session,
                responseKey,
                responseCommand.Action,
                BrowserExtensionAssistantResponseErrorCodes.ConnectorResponseInvalid,
                "automatic_validation",
                "受信したCommandのactionが相関情報と一致しません。");
            return;
        }

        if (command.Action == "complete")
        {
            // ImportCommandAsync performs the existing complete safety checks:
            // successful Output and a Review Handoff are still mandatory.
            if (session.Status != SessionStatus.Completed)
            {
                await FailAutomaticResponseAsync(
                    session,
                    responseKey,
                    command.Action,
                    "complete_not_accepted",
                    "complete",
                    "complete Responseを受理できませんでした。");
                return;
            }

            AutomaticResponseExecutionCoordinator.MarkCompleted(session, responseKey, command.Action);
            CreationPipelineStateMachine.AutomaticIterationCompleted(session);
            ClearAppliedCommandInput();
            await SaveActiveSessionAsync();
            await _store.LogAsync(
                "automation",
                $"automatic complete completed request_id={responseKey.Split('\u001f')[0]}");
            StatusMessage = "ChatGPTのcomplete Responseを受理し、制作Sessionを完了しました。";
            OnPropertyChanged(nameof(CanApplyCommand));
            NotifyPipelineStateChanged();
            return;
        }

        if (command.Action != "generate")
        {
            await FailAutomaticResponseAsync(
                session,
                responseKey,
                command.Action,
                BrowserExtensionAssistantResponseErrorCodes.ConnectorResponseInvalid,
                "automatic_validation",
                "自動実行できないactionです。");
            return;
        }

        if (session.AtRunIterationLimit)
        {
            // CommandValidated deliberately left REVIEW in
            // ContinueDecisionRequired. This is a safe, user-facing stop, not
            // an automatic execution failure: keep the valid command and the
            // existing Review boundary available for Resume/End actions.
            const string maximumIterationsMessage = "Maximum iterationsに達しているため次のGenerationを開始しませんでした。";
            var deferred = new DeferredGenerateSnapshot
            {
                RunId = session.Pipeline.CurrentRun?.RunId ?? string.Empty,
                SessionId = response.SessionId,
                RequestId = response.RequestId,
                HandoffId = response.HandoffId,
                BoundaryId = response.BoundaryId,
                CommandText = CommandText,
                Iteration = session.CurrentIteration,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            AutomaticResponseExecutionCoordinator.MarkCompleted(session, responseKey, command.Action);
            CreationPipelineStateMachine.AutomaticIterationLimitReached(session, maximumIterationsMessage, deferred);
            await SaveActiveSessionAsync();
            StatusMessage = "Maximum iterationsに達しました。続行するか、制作を終了してください。";
            OnPropertyChanged(nameof(CanApplyCommand));
            OnPropertyChanged(nameof(HasDeferredGenerate));
            OnPropertyChanged(nameof(DeferredGenerateText));
            NotifyPipelineStateChanged();
            return;
        }

        AutomaticResponseExecutionCoordinator.MarkApplying(session, responseKey, command.Action);
        var iterationBefore = session.CurrentIteration;
        var commandTextBeforeApply = CommandText;
        var validationBeforeApply = _pendingValidation;
        try
        {
            await ApplyCommandCoreAsync(
                generate: true,
                clearCommandOnApply: false,
                afterApply: () =>
                {
                    AutomaticResponseExecutionCoordinator.MarkGenerating(session, responseKey, command.Action);
                    // Match the established manual contract: a generate
                    // command is cleared after APPLY succeeds. If GENERATE or
                    // ComfyUI startup subsequently fails, the catch path below
                    // restores the exact command buffer and validation result.
                    ClearAppliedCommandInput();
                });
        }
        catch
        {
            RestoreAutomaticCommandInput(commandTextBeforeApply, validationBeforeApply);
            throw;
        }

        var iteration = session.Iterations.LastOrDefault();
        var outputState = CreationPipelineStateMachine.Get(session, CreationStage.Output).State;
        var generationSucceeded = iteration is not null
            && iteration.Number > iterationBefore
            && iteration.Status == JobStatus.Completed
            && iteration.Outputs.Any(output => !output.IsMissing)
            && outputState == CreationStageState.Completed;
        if (!generationSucceeded)
        {
            RestoreAutomaticCommandInput(commandTextBeforeApply, validationBeforeApply);
            await FailAutomaticResponseAsync(
                session,
                responseKey,
                command.Action,
                ResolveAutomaticGenerationErrorCode(session),
                ResolveAutomaticErrorStage(session, null),
                "自動GENERATEが完了しませんでした。Commandを保持して再試行できます。");
            return;
        }

        AutomaticResponseExecutionCoordinator.MarkCompleted(session, responseKey, command.Action);
        await SaveActiveSessionAsync();
        await _store.LogAsync(
            "automation",
            $"automatic apply/generate completed request_id={responseKey.Split('\u001f')[0]} handoff_id={session.PendingHandoff?.HandoffId}");
        StatusMessage = "ChatGPT Responseをstrict validationし、APPLY・GENERATE・OUTPUTまで完了しました。";
        OnPropertyChanged(nameof(CanApplyCommand));
        NotifyPipelineStateChanged();
    }

    private async Task FailAutomaticResponseAsync(
        CreationSession session,
        string responseKey,
        string action,
        string errorCode,
        string stage,
        string message)
    {
        AutomaticResponseExecutionCoordinator.MarkFailed(session, responseKey, action, errorCode, stage, message);
        if (PendingHandoffReuse.IsReview(session.PendingHandoff))
        {
            // Keep the Review transport retryable as well as the automatic
            // response execution failed. The same Pending Handoff/body can
            // be sent again after the user fixes the target or UI condition.
            MarkReviewHandoffRetryable(session, errorCode, stage, message);
        }
        else if (session.Pipeline.AutomaticIteration?.State is AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse)
            CreationPipelineStateMachine.AutomaticIterationFailed(session, errorCode, stage, message);
        await SaveActiveSessionAsync();
        await _store.LogAsync(
            "automation",
            $"automatic response failed request_id={responseKey.Split('\u001f')[0]} handoff_id={session.PendingHandoff?.HandoffId} error_code={errorCode} stage={stage}");
        StatusMessage = $"ChatGPT Responseの自動処理に失敗しました。Commandを保持して再試行できます。({errorCode}, stage={stage})";
        OnPropertyChanged(nameof(CanApplyCommand));
        NotifyPipelineStateChanged();
    }

    private void RestoreAutomaticCommandInput(
        string commandText,
        ProtocolValidationResult? validation)
    {
        if (string.Equals(_commandText, commandText, StringComparison.Ordinal)
            && ReferenceEquals(_pendingValidation, validation)) return;
        _commandText = commandText;
        _pendingValidation = validation;
        OnPropertyChanged(nameof(CommandText));
        OnPropertyChanged(nameof(CanApplyCommand));
    }

    private static string ResolveAutomaticErrorStage(CreationSession session, Exception? exception)
    {
        if (CreationPipelineStateMachine.Get(session, CreationStage.Apply).State == CreationStageState.Error)
            return "apply";
        var generate = CreationPipelineStateMachine.Get(session, CreationStage.Generate);
        if (generate.State == CreationStageState.Error && generate.Detail.Contains("ComfyUI", StringComparison.OrdinalIgnoreCase))
            return "comfy_ui_start";
        if (generate.State == CreationStageState.Error)
            return "generate";
        if (CreationPipelineStateMachine.Get(session, CreationStage.Output).State == CreationStageState.Error)
            return "output";
        return exception is TimeoutException ? "comfy_ui_wait" : "automatic_execution";
    }

    private static string ResolveAutomaticErrorCode(CreationSession session, Exception exception)
    {
        if (CreationPipelineStateMachine.Get(session, CreationStage.Apply).State == CreationStageState.Error)
            return "apply_failed";
        if (exception is TimeoutException || exception.InnerException is TimeoutException)
            return "comfy_start_timeout";
        var generate = CreationPipelineStateMachine.Get(session, CreationStage.Generate);
        if (generate.State == CreationStageState.Error)
        {
            if (generate.Detail.Contains("comfy_start_timeout", StringComparison.OrdinalIgnoreCase)) return "comfy_start_timeout";
            if (generate.Detail.Contains("comfy_not_ready", StringComparison.OrdinalIgnoreCase)) return "comfy_not_ready";
            if (generate.Detail.Contains("comfy_start_failed", StringComparison.OrdinalIgnoreCase)) return "comfy_start_failed";
        }
        if (generate.State == CreationStageState.Error)
            return "generation_failed";
        if (CreationPipelineStateMachine.Get(session, CreationStage.Output).State == CreationStageState.Error)
            return "output_failed";
        return "automatic_execution_failed";
    }

    private static string ResolveAutomaticGenerationErrorCode(CreationSession session)
    {
        var generate = CreationPipelineStateMachine.Get(session, CreationStage.Generate);
        var output = CreationPipelineStateMachine.Get(session, CreationStage.Output);
        if (generate.State == CreationStageState.Error && generate.Detail.Contains("comfy_start_timeout", StringComparison.OrdinalIgnoreCase))
            return "comfy_start_timeout";
        if (generate.State == CreationStageState.Error && generate.Detail.Contains("comfy_start_failed", StringComparison.OrdinalIgnoreCase))
            return "comfy_start_failed";
        if (generate.State == CreationStageState.Error && generate.Detail.Contains("comfy_not_ready", StringComparison.OrdinalIgnoreCase))
            return "comfy_not_ready";
        if (output.State == CreationStageState.Error) return "output_failed";
        return "generation_failed";
    }

    private bool IsBrowserExtensionSendInProgress(string requestId)
    {
        lock (_browserExtensionResponseGate) return _browserExtensionSendRequests.Contains(requestId);
    }

    private void RemoveQueuedBrowserExtensionResponse(string requestId)
    {
        lock (_browserExtensionResponseGate) _queuedBrowserExtensionResponses.Remove(requestId);
    }

    private Task DrainQueuedBrowserExtensionResponseAsync(string requestId)
    {
        BrowserExtensionAssistantResponse? response = null;
        lock (_browserExtensionResponseGate)
        {
            if (_queuedBrowserExtensionResponses.Remove(requestId, out var queued)) response = queued;
        }

        return response is null
            ? Task.CompletedTask
            : HandleBrowserExtensionAssistantResponseAsync(response);
    }

    private void SetCommandTextFromBrowserResponse(string payload)
    {
        // Keep the existing Command buffer as the observable response
        // boundary. Automatic execution reuses the same strict import path,
        // while the user can still inspect or retry it through the manual
        // controls when automation fails.
        _pendingValidation = null;
        _commandText = payload;
        OnPropertyChanged(nameof(CommandText));
        OnPropertyChanged(nameof(CanApplyCommand));
    }

    private async Task RecordBrowserExtensionResponseAsync(
        BrowserExtensionAssistantResponse response,
        ConnectorCommand command,
        string payload)
    {
        if (CurrentSession is null) return;
        var isReviewResponse = PendingHandoffReuse.IsReview(CurrentSession.PendingHandoff);
        var responseIteration = isReviewResponse ? CurrentSession.PendingHandoff?.Iteration : null;
        var existing = CurrentSession.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ChatGptToComfy
            && item.State == HandoffTransportState.Received
            && string.Equals(item.Payload, payload, StringComparison.Ordinal));
        if (existing is not null)
        {
            RebuildHandoffItems();
            await SaveActiveSessionAsync();
            return;
        }

        await RecordHandoffAsync(new HandoffMessage
        {
            Direction = HandoffDirection.ChatGptToComfy,
            Kind = command.Action == "complete" ? HandoffMessageKind.Complete : HandoffMessageKind.GenerationCommand,
            State = HandoffTransportState.Received,
            Title = isReviewResponse
                ? $"Iteration {responseIteration.GetValueOrDefault():00} Review Response"
                : command.Action == "complete" ? "制作完了の指示" : "生成指示",
            DisplayText = BuildCommandTimelineDisplay(command),
            Metadata = BuildCommandTimelineMetadata(command),
            Summary = BuildCommandTimelineSummary(command),
            Payload = payload,
            IterationNumber = responseIteration,
        });
    }

    private async Task RecordBrowserExtensionResponseFailureAsync(
        BrowserExtensionAssistantResponse response,
        string errorCode,
        string stage,
        string message)
    {
        if (CurrentSession is null) return;
        var isReviewResponse = PendingHandoffReuse.IsReview(CurrentSession.PendingHandoff);
        var responseIteration = isReviewResponse ? CurrentSession.PendingHandoff?.Iteration : null;
        var existing = CurrentSession.HandoffMessages.LastOrDefault(item =>
            item.Direction == HandoffDirection.ChatGptToComfy
            && item.State == HandoffTransportState.Failed
            && string.Equals(item.TransportErrorCode, errorCode, StringComparison.Ordinal)
            && string.Equals(item.TransportErrorStage, stage, StringComparison.Ordinal));
        if (existing is null)
        {
            await RecordHandoffAsync(new HandoffMessage
            {
                Direction = HandoffDirection.ChatGptToComfy,
                Kind = HandoffMessageKind.GenerationCommand,
                State = HandoffTransportState.Failed,
                Title = isReviewResponse
                    ? $"Iteration {responseIteration.GetValueOrDefault():00} Review Response受信エラー"
                    : "ChatGPT応答の受信エラー",
                DisplayText = message,
                Summary = "assistant応答をConnector Responseとして受信できませんでした。",
                Metadata = $"request_id={response.RequestId}",
                Payload = response.Payload ?? string.Empty,
                TransportErrorCode = errorCode,
                TransportErrorStage = stage,
                IterationNumber = responseIteration,
            });
        }
        else
        {
            existing.DisplayText = message;
            existing.TransportErrorCode = errorCode;
            existing.TransportErrorStage = stage;
            RebuildHandoffItems();
            await SaveActiveSessionAsync();
        }
    }

    private void BrowserExtensionBridge_Diagnostic(object? sender, BrowserExtensionBridgeDiagnosticEventArgs e)
        => _ = PersistBrowserExtensionDiagnosticAsync(e.Diagnostic);

    private async Task PersistBrowserExtensionDiagnosticAsync(BrowserExtensionBridgeDiagnostic diagnostic)
    {
        try
        {
            var fields = new List<string>();
            if (!string.IsNullOrWhiteSpace(diagnostic.RequestId)) fields.Add($"request_id={diagnostic.RequestId}");
            if (!string.IsNullOrWhiteSpace(diagnostic.HandoffId)) fields.Add($"handoff_id={diagnostic.HandoffId}");
            if (!string.IsNullOrWhiteSpace(diagnostic.Status)) fields.Add($"status={diagnostic.Status}");
            if (!string.IsNullOrWhiteSpace(diagnostic.ErrorCode)) fields.Add($"error_code={diagnostic.ErrorCode}");
            if (!string.IsNullOrWhiteSpace(diagnostic.Stage)) fields.Add($"stage={diagnostic.Stage}");
            var suffix = fields.Count == 0 ? string.Empty : $" ({string.Join(", ", fields)})";
            await _store.LogAsync("bridge", $"Browser Extension {diagnostic.EventName}{suffix}");
        }
        catch (Exception)
        {
            // Diagnostics must never change the transport or UI outcome.
        }
    }

    private void NotifyConnectionStateChanged()
    {
        OnPropertyChanged(nameof(IsSystemProcessing));
        OnPropertyChanged(nameof(ConnectorSystemState));
        OnPropertyChanged(nameof(McpSystemState));
        OnPropertyChanged(nameof(ComfyUiRuntimeState));
        OnPropertyChanged(nameof(ComfyUiSystemState));
        OnPropertyChanged(nameof(GpuSystemState));
        OnPropertyChanged(nameof(HasGpuEvidence));
        OnPropertyChanged(nameof(SystemConnectionSummary));
        OnPropertyChanged(nameof(IsComfyUiReachable));
        OnPropertyChanged(nameof(IsCreationConnectionReady));
        OnPropertyChanged(nameof(CanStartNewCreation));
        OnPropertyChanged(nameof(CanResumeSession));
        OnPropertyChanged(nameof(IsIdeaInputEnabled));
        OnPropertyChanged(nameof(HasIdeaInput));
        OnPropertyChanged(nameof(ShowIdeaPlaceholder));
        OnPropertyChanged(nameof(IdeaInputHint));
        OnPropertyChanged(nameof(CanResendBootstrapHandoff));
        OnPropertyChanged(nameof(CanResendReviewHandoff));
        OnPropertyChanged(nameof(CanSendToChatGpt));
        OnPropertyChanged(nameof(SendToChatGptButtonText));
        OnPropertyChanged(nameof(SendToChatGptHint));
        OnPropertyChanged(nameof(CanApplyCommand));
        OnPropertyChanged(nameof(CanRunWorkflow));
        NotifyGenerationDisplayChanged();
    }

    private void SynchronizePipelineConnectionGate(string? detail = null)
    {
        if (CurrentSession is null) return;
        SynchronizePipelineConnectionGate(CurrentSession, detail);
        NotifyPipelineStateChanged();
    }

    private void SynchronizePipelineConnectionGate(CreationSession session, string? detail = null)
        => CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState, detail);

    private void EnsureMcpConnectionReady()
    {
        SynchronizePipelineConnectionGate();
        if (CurrentSession is not null) CreationPipelineStateMachine.RequireConnection(CurrentSession);
        if (!IsCreationConnectionReady) throw new InvalidOperationException("MCP接続を確立してから制作を続行してください。");
    }

    private async Task EnsureComfyUiForStageAsync(CreationSession session, CreationStage stage)
    {
        EnsureMcpConnectionReady();
        try
        {
            if (await RefreshComfyUiStatusAsync()) return;

            // STOPPED/STARTING is an internal runtime condition, not a user
            // confirmation step. Reflect the automatic startup directly on
            // GENERATE and keep the original request alive until READY.
            CreationPipelineStateMachine.BeginComfyUiStartup(session, stage);
            NotifyPipelineStateChanged();
            StatusMessage = "ComfyUIを起動しています…";
            await EnsureComfyUiReadyAsync(
                allowStartFromError: false,
                onWaitingForReady: () =>
                {
                    CreationPipelineStateMachine.WaitingForComfyUi(session, stage);
                    NotifyPipelineStateChanged();
                    StatusMessage = "ComfyUIのREADYを待機中です…";
                });
            StatusMessage = "ComfyUIはREADYです。Jobを投入しています…";
            NotifyPipelineStateChanged();
        }
        catch (Exception ex)
        {
            var errorCode = ResolveComfyUiStartupErrorCode(ex);
            var detail = $"ComfyUIを起動できませんでした。({errorCode})";
            CreationPipelineStateMachine.ComfyUiStartupFailed(session, stage, detail);
            await _store.SaveSessionAsync(session);
            StatusMessage = detail;
            NotifyPipelineStateChanged();
            await _store.LogAsync("generation", $"{detail} {ex.Message}", ex);
            throw new InvalidOperationException(detail, ex);
        }
    }

    private string ResolveComfyUiStartupErrorCode(Exception exception)
    {
        if (exception is TimeoutException || exception.InnerException is TimeoutException)
            return "comfy_start_timeout";
        if (_comfyUiRuntimeState == ComfyUiRuntimeState.Error)
            return "comfy_start_failed";
        return "comfy_not_ready";
    }

    public async Task<bool> RefreshComfyUiStatusAsync(CancellationToken cancellationToken = default)
    {
        await _comfyUiStatusGate.WaitAsync(cancellationToken);
        try
        {
            var health = await _comfyUiHealthProbe.CheckAsync(Settings.Endpoint, cancellationToken);
            var nextState = ComfyUiRuntimeStateMachine.Resolve(_comfyUiRuntimeState, health);
            SetComfyUiRuntimeState(nextState);
            return health.IsReady;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            // A probe implementation should normally classify transport
            // failures as Unavailable. Keep this guard so an unexpected probe
            // failure is still reflected as an explicit runtime ERROR without
            // affecting MCP's independent connection state.
            SetComfyUiRuntimeState(ComfyUiRuntimeStateMachine.Resolve(
                _comfyUiRuntimeState,
                new ComfyUiHealthCheckResult(ComfyUiHealthCheckStatus.Error, ex.Message)));
            await _store.LogAsync("connection", $"ComfyUI Endpointの状態確認に失敗しました: {ex.Message}", ex);
            return false;
        }
        finally
        {
            _comfyUiStatusGate.Release();
        }
    }

    private void SetComfyUiRuntimeState(ComfyUiRuntimeState state)
    {
        if (_comfyUiRuntimeState == state) return;
        _comfyUiRuntimeState = state;
        NotifyConnectionStateChanged();
    }

    private void MarkConnectionFailureIfTransportClosed(Exception exception)
    {
        if (_mcp.IsConnected) return;
        _serverInfo = null;
        ConnectionState = ConnectionState.Error;
        SynchronizePipelineConnectionGate(exception.Message);
    }

    private void NotifyContextSelectionChanged()
    {
        OnPropertyChanged(nameof(ProjectPlaceholderText));
        OnPropertyChanged(nameof(ChatPlaceholderText));
        OnPropertyChanged(nameof(ContextReadinessText));
        OnPropertyChanged(nameof(HasPendingContextChange));
        NotifyPipelineStateChanged();
    }

    private void NotifyContextCatalogChanged()
    {
        OnPropertyChanged(nameof(ChatGptContextLoadState));
        OnPropertyChanged(nameof(ChatGptContextLoadStateText));
        OnPropertyChanged(nameof(ChatGptContextErrorText));
        OnPropertyChanged(nameof(CanRefreshChatGptContext));
        OnPropertyChanged(nameof(ContextReadinessText));
    }

    private void NotifyPipelineStateChanged()
    {
        RefreshPipeline();
        // IsGenerationInProgress is derived from the pipeline as well as the
        // active Job. Notify it here so the viewer can pause a retained
        // previous Output as soon as GENERATE enters startup, before a Job is
        // submitted to ComfyUI.
        OnPropertyChanged(nameof(IsGenerationInProgress));
        OnPropertyChanged(nameof(CurrentCreationStageText));
        OnPropertyChanged(nameof(CurrentCreationStageDescription));
        OnPropertyChanged(nameof(CurrentCreationStageState));
        OnPropertyChanged(nameof(SessionStatusText));
        OnPropertyChanged(nameof(SessionProgressText));
        OnPropertyChanged(nameof(CanResumeSession));
        OnPropertyChanged(nameof(CurrentGenerateExecutionState));
        OnPropertyChanged(nameof(GenerateExecutionStateText));
        OnPropertyChanged(nameof(AutomaticResponseExecutionText));
        OnPropertyChanged(nameof(AutomaticIterationText));
        OnPropertyChanged(nameof(HasAutomaticIterationStatus));
        OnPropertyChanged(nameof(ReviewHandoff));
        OnPropertyChanged(nameof(ReviewMediaAttachment));
        OnPropertyChanged(nameof(HasReviewMediaAttachment));
        OnPropertyChanged(nameof(ReviewMediaAttachmentStateText));
        OnPropertyChanged(nameof(IsReviewMediaAttachmentFailed));
        OnPropertyChanged(nameof(CanAttachReviewOutput));
        OnPropertyChanged(nameof(CurrentIterationLabel));
        OnPropertyChanged(nameof(PipelineLoopText));
        OnPropertyChanged(nameof(HasIterationSafetyStop));
        OnPropertyChanged(nameof(IsIdeaInputEnabled));
        OnPropertyChanged(nameof(HasIdeaInput));
        OnPropertyChanged(nameof(ShowIdeaPlaceholder));
        OnPropertyChanged(nameof(IdeaInputHint));
        OnPropertyChanged(nameof(CanResendBootstrapHandoff));
        OnPropertyChanged(nameof(CanResendReviewHandoff));
        OnPropertyChanged(nameof(CanSendToChatGpt));
        OnPropertyChanged(nameof(SendToChatGptButtonText));
        OnPropertyChanged(nameof(SendToChatGptHint));
        OnPropertyChanged(nameof(CanApplyCommand));
        OnPropertyChanged(nameof(CanRunWorkflow));
        OnPropertyChanged(nameof(CanCancelOperation));
        OnPropertyChanged(nameof(HasDeferredGenerate));
        OnPropertyChanged(nameof(DeferredGenerateText));
    }

    private void RefreshPipeline()
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.EnsureInitialized(CurrentSession);
        var definitions = new Dictionary<CreationStage, (string Key, string Label, string Description)>
        {
            [CreationStage.Connect] = ("CONNECT", "Connect", "MCP接続 / 制作通信Gate"),
            [CreationStage.Context] = ("CONTEXT", "Context", "Workflow / Project / Chat / Maximum Iterations / Session Binding"),
            [CreationStage.Idea] = ("IDEA", "開始指示・補足", "既存ChatGPT会話への任意の開始指示・補足"),
            [CreationStage.ToChatGpt] = ("TO CHATGPT", "To ChatGPT", "Extension送信 / Clipboard fallback"),
            [CreationStage.Command] = ("COMMAND", "Command", "Connector Commandを解析・検証"),
            [CreationStage.Apply] = ("APPLY", "Apply", "Backup・slot反映・保存・validate"),
            [CreationStage.Generate] = ("GENERATE", "Generate", "ComfyUI Jobを実行"),
            [CreationStage.Output] = ("OUTPUT", "Output", "実ファイルを取得・確認・履歴登録"),
            [CreationStage.Review] = ("REVIEW", "Review", "結果をChatGPTへ渡して判断"),
        };

        PipelineStages.Clear();
        for (var index = 0; index < CreationPipelineStateMachine.OrderedStages.Length; index++)
        {
            var stage = CreationPipelineStateMachine.OrderedStages[index];
            CreationStageStatus status;
            if (_isCurrentSessionActivated)
            {
                status = CreationPipelineStateMachine.Get(CurrentSession, stage);
            }
            else
            {
                var connection = CreationPipelineStateMachine.EvaluateConnectionGate(ConnectionState, false);
                status = stage switch
                {
                    CreationStage.Connect => connection,
                    CreationStage.Context when connection.State == CreationStageState.Completed => new CreationStageStatus
                    {
                        Stage = CreationStage.Context,
                        State = CreationStageState.Current,
                        Detail = "Workflow / Project / Chat / Maximum Iterations / Slot Schemaを確認して新しい制作を開始してください",
                    },
                    _ => new CreationStageStatus { Stage = stage },
                };
            }
            var definition = definitions[stage];
            var state = status.State.ToString().ToUpperInvariant();
            var stateLabel = CreationPipelineStateMachine.GetStageStateLabel(status);
            var description = string.IsNullOrWhiteSpace(status.Detail) ? definition.Description : $"{definition.Description}{Environment.NewLine}{status.Detail}";
            if (stage == CreationStage.Generate && _isCurrentSessionActivated)
                description = $"{description}{Environment.NewLine}{GenerateExecutionStateText}";
            PipelineStages.Add(new CreationPipelineStage(index + 1, definition.Key, definition.Label, description, state, stateLabel, index == CreationPipelineStateMachine.OrderedStages.Length - 1));
        }
        OnPropertyChanged(nameof(PipelineStages));
    }

    private CreationPipelineStage GetCurrentPipelineStage()
    {
        if (_isCurrentSessionActivated && CurrentSession is not null)
        {
            var active = CreationPipelineStateMachine.OrderedStages
                .Select((stage, index) => (Status: CreationPipelineStateMachine.Get(CurrentSession, stage), Index: index))
                .Where(item => item.Status.State is CreationStageState.Current
                    or CreationStageState.InProgress
                    or CreationStageState.WaitingUser
                    or CreationStageState.Error
                    or CreationStageState.Cancelled)
                .OrderByDescending(item => item.Status.UpdatedAt)
                .ThenByDescending(item => item.Index)
                .FirstOrDefault();
            if (active.Status is not null && active.Index < PipelineStages.Count) return PipelineStages[active.Index];
        }

        return PipelineStages.FirstOrDefault(item => item.State is "CURRENT" or "INPROGRESS" or "WAITINGUSER" or "ERROR" or "CANCELLED")
            ?? PipelineStages.LastOrDefault(item => item.IsCompleted)
            ?? new CreationPipelineStage(1, "CONNECT", "Connect", "MCP接続を確認", "CURRENT", "現在", false);
    }

    private JsonNode? FindServerInfoNode(string key)
    {
        if (_serverInfo is null) return null;
        return FindNodeRecursive(_serverInfo, key, 0);
    }

    private static JsonNode? FindNodeRecursive(JsonNode node, string key, int depth)
    {
        if (depth > 3) return null;
        if (node is JsonObject obj)
        {
            if (obj.TryGetPropertyValue(key, out var direct) && direct is not null) return direct;
            foreach (var property in obj)
            {
                if (property.Value is not null)
                {
                    var nested = FindNodeRecursive(property.Value, key, depth + 1);
                    if (nested is not null) return nested;
                }
            }
        }
        else if (node is JsonArray array)
        {
            foreach (var child in array)
            {
                if (child is not null)
                {
                    var nested = FindNodeRecursive(child, key, depth + 1);
                    if (nested is not null) return nested;
                }
            }
        }
        return null;
    }

    private void NotifySlotCollectionsChanged()
    {
        OnPropertyChanged(nameof(HasSlots));
        OnPropertyChanged(nameof(HasPrimarySlots));
        OnPropertyChanged(nameof(HasTuningSlots));
        OnPropertyChanged(nameof(HasAdvancedSlots));
        OnPropertyChanged(nameof(WorkflowSlotSummaryText));
        OnPropertyChanged(nameof(ContextReadinessText));
        OnPropertyChanged(nameof(CanStartNewCreation));
        NotifyViewStateChanged();
        NotifyPipelineStateChanged();
    }

    private void NotifyViewStateChanged()
    {
        OnPropertyChanged(nameof(ShowWorkflowEmptyState));
        OnPropertyChanged(nameof(ShowDisconnectedState));
        OnPropertyChanged(nameof(ShowSlotLoadingState));
        OnPropertyChanged(nameof(ShowSlotErrorState));
        OnPropertyChanged(nameof(ShowNoSlotState));
        OnPropertyChanged(nameof(ShowReadyState));
        OnPropertyChanged(nameof(CanRunWorkflow));
    }

    public void OpenOutputFile(string path)
    {
        EnsurePortableRootConfigured();
        var fullPath = Path.GetFullPath(path);
        PathSafety.RequireWithin(OutputRoot, fullPath);
        if (!File.Exists(fullPath)) throw new FileNotFoundException("出力ファイルが見つかりません。", fullPath);
        Process.Start(new ProcessStartInfo(fullPath) { UseShellExecute = true });
    }

    /// <summary>
    /// Copies the artifact currently shown in OUTPUT VIEWER.  The selected
    /// history item (and the generation fallback while a later iteration is
    /// running) is resolved by <see cref="SelectedPreviewOutput"/>; no latest
    /// output shortcut is used here.
    /// </summary>
    public void SaveSelectedOutputCopy(string destinationPath, bool overwriteExisting = false)
    {
        var output = SelectedPreviewOutput;
        if (output is null) throw new InvalidOperationException("表示中のOutputがありません。");
        OutputCopyService.Copy(output, destinationPath, overwriteExisting);
        StatusMessage = $"Outputのコピーを保存しました: {Path.GetFileName(destinationPath)}";
    }

    public void OpenOutputFolder(string path)
    {
        EnsurePortableRootConfigured();
        var fullPath = Path.GetFullPath(path);
        PathSafety.RequireWithin(OutputRoot, fullPath);
        var folder = Directory.Exists(fullPath) ? fullPath : Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(folder)) throw new DirectoryNotFoundException("出力フォルダを特定できません。");
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
    }

    private void EnsurePortableRootConfigured()
    {
        if (string.IsNullOrWhiteSpace(Settings.PortableRoot)) throw new InvalidOperationException("先にSETUPでComfyUI Portableの場所を指定してください。");
    }

    private void Settings_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is nameof(AppSettings.PortableRoot) or null)
        {
            OnPropertyChanged(nameof(WorkflowRoot));
            OnPropertyChanged(nameof(OutputRoot));
            OnPropertyChanged(nameof(VideoOutputRoot));
            OnPropertyChanged(nameof(CurrentOutputFolderPath));
        }
        if (e.PropertyName is nameof(AppSettings.Endpoint) or null)
        {
            SetComfyUiRuntimeState(ComfyUiRuntimeState.Unknown);
        }
    }

    private void ValidateSettings()
    {
        if (!Directory.Exists(Settings.PortableRoot)) throw new InvalidOperationException("ComfyUI Portable rootが存在しません。");
        if (!Directory.Exists(Path.Combine(Settings.PortableRoot, "ComfyUI"))) throw new InvalidOperationException("Portable root内にComfyUIがありません。");
        if (!File.Exists(Settings.ComfyMcpPath)) throw new InvalidOperationException("comfy-mcp.exeが存在しません。");
        if (!Uri.TryCreate(Settings.Endpoint, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")) throw new InvalidOperationException("Endpoint URLが不正です。");
        if (Settings.MaximumIterations is < 1 or > 1000) throw new InvalidOperationException("Maximum Iterationsは1〜1000で指定してください。");
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) => PropertyChanged?.Invoke(this, new(propertyName));

    private sealed class ComfyMcpClientProxy : IComfyMcpClient
    {
        private readonly ChatGPTComfyConnector.Infrastructure.Mcp.ComfyMcpClient _inner;
        public ComfyMcpClientProxy(IPortableStore store) => _inner = new(store);
        public bool IsConnected => _inner.IsConnected;
        public ConnectionState State => _inner.State;
        public IReadOnlyList<string> ToolNames => _inner.ToolNames;
        public Task ConnectAsync(AppSettings settings, CancellationToken cancellationToken = default) => _inner.ConnectAsync(settings, cancellationToken);
        public Task DisconnectAsync(CancellationToken cancellationToken = default) => _inner.DisconnectAsync(cancellationToken);
        public Task<JsonNode?> CallAsync(string toolName, IReadOnlyDictionary<string, object?> arguments, CancellationToken cancellationToken = default) => _inner.CallAsync(toolName, arguments, cancellationToken);
        public ValueTask DisposeAsync() => _inner.DisposeAsync();
    }
}
