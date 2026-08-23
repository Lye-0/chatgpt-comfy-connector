using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Contexts;
using ChatGPTComfyConnector.Infrastructure.Storage;
using ChatGPTComfyConnector.Infrastructure.Workflows;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class MainViewModel : INotifyPropertyChanged
{
    private readonly PortableLayout _layout;
    private readonly PortableStore _store;
    private readonly ComfyMcpClientProxy _mcp;
    private readonly WorkflowCatalog _catalog;
    private CreationSession? _currentSession;
    private WorkflowIdentity? _selectedWorkflow;
    private JobSnapshot? _currentJob;
    private string _statusMessage = "初回セットアップを確認しています。";
    private ConnectionState _connectionState = ConnectionState.Disconnected;
    private bool _isSetupVisible;
    private bool _isBusy;
    private bool _isSlotLoading;
    private SlotDiscoveryState _slotDiscoveryState = SlotDiscoveryState.NotLoaded;
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

    public MainViewModel(string applicationDirectory, IProjectChatProvider? contextProvider = null)
    {
        _layout = new PortableLayout(applicationDirectory);
        _store = new PortableStore(_layout);
        _contextProvider = contextProvider ?? new LocalProjectChatProvider(_store);
        _mcp = new ComfyMcpClientProxy(_store);
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
    public CreationSession? CurrentSession { get => _currentSession; private set { _currentSession = value; if (value is not null) CreationPipelineStateMachine.EnsureInitialized(value); OnPropertyChanged(); OnPropertyChanged(nameof(SessionTitle)); OnPropertyChanged(nameof(SessionStatusText)); OnPropertyChanged(nameof(SessionProgressText)); OnPropertyChanged(nameof(ProjectLabel)); OnPropertyChanged(nameof(ChatLabel)); OnPropertyChanged(nameof(CurrentSessionContextText)); OnPropertyChanged(nameof(CanResumeSession)); OnPropertyChanged(nameof(HasPendingContextChange)); NotifyPipelineStateChanged(); } }
    public WorkflowIdentity? SelectedWorkflow { get => _selectedWorkflow; private set { _selectedWorkflow = value; OnPropertyChanged(); OnPropertyChanged(nameof(SelectedWorkflowText)); OnPropertyChanged(nameof(SelectedWorkflowName)); OnPropertyChanged(nameof(HasSelectedWorkflow)); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); OnPropertyChanged(nameof(CurrentOutputFolderPath)); OnPropertyChanged(nameof(CanStartNewCreation)); NotifyViewStateChanged(); NotifyContextSelectionChanged(); } }
    public JobSnapshot? CurrentJob { get => _currentJob; private set { _currentJob = value; OnPropertyChanged(); OnPropertyChanged(nameof(JobStatusText)); OnPropertyChanged(nameof(JobStatusDetailText)); OnPropertyChanged(nameof(IsJobActive)); OnPropertyChanged(nameof(CanStartNewCreation)); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public ConnectionState ConnectionState { get => _connectionState; private set { _connectionState = value; OnPropertyChanged(); OnPropertyChanged(nameof(ConnectionStateText)); OnPropertyChanged(nameof(IsConnected)); NotifyConnectionStateChanged(); NotifyViewStateChanged(); NotifyPipelineStateChanged(); } }
    public string StatusMessage { get => _statusMessage; set { _statusMessage = value; OnPropertyChanged(); } }
    public bool IsSetupVisible { get => _isSetupVisible; private set { _isSetupVisible = value; OnPropertyChanged(); } }
    public bool IsWorkflowEditorVisible { get => _isWorkflowEditorVisible; private set { _isWorkflowEditorVisible = value; OnPropertyChanged(); } }
    public bool IsBusy { get => _isBusy; private set { _isBusy = value; OnPropertyChanged(); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public bool IsSlotLoading { get => _isSlotLoading; private set { _isSlotLoading = value; OnPropertyChanged(); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); } }
    public SlotDiscoveryState SlotDiscoveryState { get => _slotDiscoveryState; private set { _slotDiscoveryState = value; OnPropertyChanged(); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); } }
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
    public string Idea { get => _idea; set { if (string.Equals(_idea, value, StringComparison.Ordinal)) return; _idea = value; if (CurrentSession is not null) CreationPipelineStateMachine.IdeaChanged(CurrentSession, value); OnPropertyChanged(); NotifyPipelineStateChanged(); } }
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
            OnPropertyChanged(nameof(ViewingIterationText));
            OnPropertyChanged(nameof(IsViewingLatest));
            OnPropertyChanged(nameof(ViewingStateText));
            OnPropertyChanged(nameof(CurrentOutputFolderPath));
        }
    }
    public OutputArtifact? SelectedPreviewOutput => SelectedHistoryItem?.PrimaryOutput;
    public bool HasSelectedPreviewOutput => SelectedPreviewOutput is not null;
    public bool IsSelectedPreviewMissing => SelectedPreviewOutput?.IsMissing == true;
    public string ViewingIterationText => SelectedHistoryItem is null ? "VIEWING —" : $"VIEWING ITERATION {SelectedHistoryItem.Number:00}";
    public string LatestIterationText => HistoryItems.LastOrDefault() is { } latest ? $"LATEST ITERATION {latest.Number:00}" : "LATEST —";
    public bool IsViewingLatest => SelectedHistoryItem is not null && ReferenceEquals(SelectedHistoryItem, HistoryItems.LastOrDefault());
    public string ViewingStateText => IsViewingLatest ? "VIEWING LATEST" : SelectedHistoryItem is null ? "NO OUTPUT" : "VIEWING HISTORY";
    public string SelectedWorkflowText => SelectedWorkflow?.RelativePath ?? "Workflow未選択";
    public string SelectedWorkflowName => SelectedWorkflow is null ? "Workflow未選択" : Path.GetFileNameWithoutExtension(SelectedWorkflow.RelativePath);
    public string ConnectionStateText => ConnectionState switch { ConnectionState.Connected => "CONNECTED", ConnectionState.Connecting => "CONNECTING", ConnectionState.Error => "ERROR", _ => "DISCONNECTED" };
    public bool IsSystemProcessing => IsBusy || IsJobActive;
    public string ConnectorSystemState => IsSystemProcessing ? "PROCESSING" : "ONLINE";
    public string McpSystemState => IsSystemProcessing && IsConnected ? "PROCESSING" : ConnectionStateText;
    public string ComfyUiSystemState => ConnectionState switch
    {
        ConnectionState.Connecting => "CONNECTING",
        ConnectionState.Error => "ERROR",
        _ when IsJobActive => "PROCESSING",
        ConnectionState.Connected when ReadServerInfoBoolean("running") == false => "STOPPED",
        ConnectionState.Connected => "READY",
        ConnectionState.Stopped => "STOPPED",
        _ => "DISCONNECTED",
    };
    public string GpuSystemState => !IsConnected ? "—" : IsSystemProcessing ? "PROCESSING" : HasGpuEvidence ? "READY" : "UNKNOWN";
    public bool HasGpuEvidence => FindServerInfoNode("gpu") is not null || FindServerInfoNode("gpu_name") is not null || FindServerInfoNode("device") is not null || FindServerInfoNode("hardware") is not null;
    public string SystemConnectionSummary => IsConnected
        ? HasGpuEvidence ? "MCP経由でComfyUIとGPU情報を確認済み" : "MCP経由でComfyUIへ接続済み · GPU情報は未提供"
        : "ローカル環境は未接続 · CONNECTまたはSTART COMFYUIから開始";
    public string CurrentCreationStageText => GetCurrentPipelineStage().Label;
    public string CurrentCreationStageDescription => GetCurrentPipelineStage().Description;
    public string CurrentCreationStageState => GetCurrentPipelineStage().State;
    public string CurrentIterationLabel => !_isCurrentSessionActivated || CurrentSession is null || CurrentSession.Pipeline.IterationNumber == 0 ? "ITERATION —" : CurrentSession.Pipeline.IterationNumber > CurrentSession.CurrentIteration ? $"ITERATION {CurrentSession.Pipeline.IterationNumber:00} · PREP" : $"ITERATION {CurrentSession.CurrentIteration:00}";
    public string PipelineLoopText => !_isCurrentSessionActivated ? "CONTEXT → 新しい制作を開始" : CurrentSession?.Status == SessionStatus.Completed ? "SESSION COMPLETE" : HasIterationSafetyStop ? "SAFETY STOP · USER DECISION" : "REVIEW → NEXT ITERATION / COMPLETE";
    public string SessionStatusText => CurrentSession?.Status.ToString().ToUpperInvariant() ?? "NEW";
    public string JobStatusText => CurrentJob is null ? "IDLE" : CurrentJob.Status.ToString().ToUpperInvariant();
    public string JobStatusDetailText => CurrentJob is null ? "生成待機中" : IsJobActive ? "ComfyUIで生成を実行中" : CurrentJob.Status switch { JobStatus.Completed => "生成が完了しました", JobStatus.Failed => "生成に失敗しました", JobStatus.Cancelled => "生成をキャンセルしました", _ => "Jobを確認してください" };
    public string DirtyText => IsDirty ? "UNSAVED CHANGES" : "SAVED";
    public string SessionProgressText => CurrentSession is null ? "0 / 10 ITERATIONS" : $"{CurrentSession.CurrentIteration} / {CurrentSession.MaximumIterations} ITERATIONS";
    public string CurrentSessionContextText => CurrentSession is null ? "制作セッションなし" : $"{BlankFallback(CurrentSession.ProjectLabel, "Project未設定")}  ·  {BlankFallback(CurrentSession.ChatLabel, "Chat未設定")}";
    public string ProjectPlaceholderText => HasSelectedProject || IsProjectCreateVisible ? string.Empty : "Projectを選択…";
    public string ChatPlaceholderText => !HasSelectedProject ? "先にProjectを選択してください" : HasSelectedChat || IsChatCreateVisible ? string.Empty : "Chatを選択…";
    public string ContextReadinessText => string.Join(Environment.NewLine,
        $"{(HasSelectedWorkflow ? "✓" : "!")} Workflow  {SelectedWorkflowName}",
        $"{(HasSelectedProject ? "✓" : "!")} Project  {(SelectedProject?.DisplayName ?? "未選択")}",
        $"{(HasSelectedChat ? "✓" : "!")} Chat  {(SelectedChat?.DisplayName ?? "未選択")}",
        $"{(SessionMaximumIterations is >= 1 and <= 1000 ? "✓" : "!")} Maximum Iterations  {SessionMaximumIterations}");
    public string WorkflowSlotSummaryText => !HasSelectedWorkflow ? "左のライブラリからWorkflowを選択" : !IsConnected ? "MCP未接続 · CONNECTでslotを読み込み" : SlotDiscoveryState == SlotDiscoveryState.Loading ? "slotを読み込み中…" : SlotDiscoveryState == SlotDiscoveryState.Failed ? "slotの読み込みに失敗" : SlotDiscoveryState == SlotDiscoveryState.Loaded ? $"主要 {PrimarySlots.Count} · 調整 {TuningSlots.Count} · 詳細 {AdvancedSlots.Count}" : "slotはまだ読み込まれていません";
    public bool IsConnected => ConnectionState == ConnectionState.Connected;
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
    public bool CanCreateChat => HasSelectedProject;
    public bool HasProjectValidationMessage => !string.IsNullOrWhiteSpace(ProjectValidationMessage);
    public bool HasChatValidationMessage => !string.IsNullOrWhiteSpace(ChatValidationMessage);
    public bool CanStartNewCreation => HasSelectedWorkflow && HasSelectedProject && HasSelectedChat && SessionMaximumIterations is >= 1 and <= 1000 && !IsJobActive;
    public bool CanResumeSession => CurrentSession?.Status is SessionStatus.Completed or SessionStatus.Paused or SessionStatus.Stopped or SessionStatus.Error;
    public bool CanApplyCommand => _isCurrentSessionActivated && _pendingValidation is { IsValid: true, Command: not null } command && command.Command.Action == "generate" && !HasIterationSafetyStop;
    public bool ShowWorkflowEmptyState => !HasSelectedWorkflow;
    public bool ShowDisconnectedState => HasSelectedWorkflow && !IsConnected;
    public bool ShowSlotLoadingState => HasSelectedWorkflow && IsConnected && IsSlotLoading;
    public bool ShowSlotErrorState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && HasSlotLoadError;
    public bool ShowNoSlotState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && !HasSlots;
    public bool ShowReadyState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && HasSlots;
    public bool CanRunWorkflow => _isCurrentSessionActivated && HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && CurrentSession is not null && CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Generate).State is CreationStageState.Current or CreationStageState.Error or CreationStageState.Cancelled;
    public bool HasIterationSafetyStop => _isCurrentSessionActivated && CurrentSession?.Pipeline.MaximumIterationSafetyStop == true;
    public bool HasPendingContextChange => _isCurrentSessionActivated && CurrentSession?.Pipeline.ContextBound == true &&
        (SelectedWorkflow?.RelativePath != CurrentSession.BoundWorkflow?.RelativePath || SelectedProject?.ProviderId != CurrentSession.EffectiveContextProviderId || SelectedProject?.Key != CurrentSession.EffectiveProjectContextKey || SelectedChat?.ProviderId != CurrentSession.EffectiveContextProviderId || SelectedChat?.Key != CurrentSession.EffectiveChatContextKey || SessionMaximumIterations != CurrentSession.MaximumIterations);
    public bool IsJobActive => CurrentJob is { Status: JobStatus.Queued or JobStatus.Running };
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
        CurrentSession = Sessions.FirstOrDefault() ?? NewSessionInternal();
        // Loading a persisted session is not the same as starting a new creation.
        // Keep its history available, while the setup screen remains at CONTEXT
        // until the user explicitly activates the session.
        _isCurrentSessionActivated = false;
        NotifyPipelineStateChanged();
        CreationPipelineStateMachine.EnsureInitialized(CurrentSession);
        await InitializeContextProviderAsync();
        SessionMaximumIterations = CurrentSession.MaximumIterations;
        Idea = CurrentSession.OriginalIdea;
        Iterations.Clear();
        foreach (var iteration in CurrentSession.Iterations) Iterations.Add(iteration);
        LatestOutputs.Clear();
        foreach (var output in CurrentSession.Iterations.LastOrDefault()?.Outputs ?? []) LatestOutputs.Add(output);
        RebuildHistoryItems();
        if (RebuildHandoffItems()) await _store.SaveSessionAsync(CurrentSession);
        RefreshWorkflowTree();
        StatusMessage = IsSetupVisible ? "接続先を確認して保存してください。" : "準備完了。ComfyUIの状態を確認できます。";
        OnPropertyChanged(nameof(HasIterations));
        OnPropertyChanged(nameof(HasLatestOutputs));
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
        ConnectionState = ConnectionState.Connecting;
        try
        {
            await _mcp.ConnectAsync(Settings);
            ConnectionState = ConnectionState.Connected;
            var info = await _mcp.CallAsync("server_info", new Dictionary<string, object?>());
            _serverInfo = info;
            NotifyConnectionStateChanged();
            StatusMessage = info is null ? "MCPに接続しました。" : "MCPに接続しました。server_infoを取得済みです。";
            if (SelectedWorkflow is not null) await SelectWorkflowAsync(SelectedWorkflow.RelativePath);
        }
        catch (Exception ex)
        {
            ConnectionState = ConnectionState.Error;
            StatusMessage = $"MCP接続に失敗しました: {ex.Message}";
            await _store.LogAsync("connection", StatusMessage, ex);
        }
        finally { IsBusy = false; }
    }

    public async Task DisconnectAsync()
    {
        await _mcp.DisconnectAsync();
        _serverInfo = null;
        ConnectionState = ConnectionState.Disconnected;
        SlotDiscoveryState = SlotDiscoveryState.NotLoaded;
        StatusMessage = "MCPを切断しました。ComfyUIは終了していません。";
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
            StatusMessage = "Workflowを選択しました。slot取得にはMCP接続が必要です。";
            return;
        }

        IsBusy = true;
        IsSlotLoading = true;
        SlotDiscoveryState = SlotDiscoveryState.Loading;
        try
        {
            foreach (var slot in await _catalog.DiscoverSlotsAsync(identity, WorkflowRoot))
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
            SlotLoadError = ex.Message;
            SlotDiscoveryState = SlotDiscoveryState.Failed;
            StatusMessage = $"slot取得に失敗しました: {ex.Message}";
            await _store.LogAsync("workflow", StatusMessage, ex);
        }
        finally { IsSlotLoading = false; IsBusy = false; NotifySlotCollectionsChanged(); }
    }

    public void DiscardChanges()
    {
        if (SelectedWorkflow is null) return;
        _ = SelectWorkflowAsync(SelectedWorkflow.RelativePath);
    }

    public async Task ApplySlotsAsync()
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        if (!IsConnected) throw new InvalidOperationException("MCPに接続してください。");
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
            if (trackApply) CreationPipelineStateMachine.ApplyCompleted(CurrentSession!);
            foreach (var backup in await _store.ListWorkflowBackupsAsync(SelectedWorkflow)) { if (!Backups.Contains(backup)) Backups.Add(backup); }
            StatusMessage = "Workflowをbackup → apply → validateしました。";
            if (CurrentSession is not null) await _store.SaveSessionAsync(CurrentSession);
        }
        catch (Exception ex)
        {
            if (trackApply) CreationPipelineStateMachine.ApplyFailed(CurrentSession!, ex.Message);
            if (CurrentSession is not null) await _store.SaveSessionAsync(CurrentSession);
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
        if (CurrentSession is not null) await _store.SaveSessionAsync(CurrentSession);
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
        Sessions.Insert(0, session);
        CurrentSession = session;
        CreationPipelineStateMachine.BindContext(session);
        _isCurrentSessionActivated = true;
        ResetSessionWorkspace(session);
        await _store.SaveSessionAsync(session);
        NotifyPipelineStateChanged();
        StatusMessage = "新しい制作を開始しました。中央の制作アイデアから進めてください。";
    }

    public async Task ApplySelectedContextToCurrentSessionAsync()
    {
        ValidateNewCreationSetup();
        if (CurrentSession is null) throw new InvalidOperationException("現在の制作セッションがありません。");
        CurrentSession.ProjectLabel = SelectedProject!.DisplayName;
        CurrentSession.ChatLabel = SelectedChat!.DisplayName;
        CurrentSession.ProjectId = SelectedProject.ExternalId;
        CurrentSession.ConversationId = SelectedChat.ExternalId;
        CurrentSession.BoundWorkflow = SelectedWorkflow;
        CurrentSession.MaximumIterations = SessionMaximumIterations;
        CurrentSession.Title = $"{SelectedProject.DisplayName} / {SelectedChat.DisplayName}";
        BindSessionContext(CurrentSession, SelectedProject, SelectedChat);
        CreationPipelineStateMachine.BindContext(CurrentSession);
        _isCurrentSessionActivated = true;
        await _store.SaveSessionAsync(CurrentSession);
        OnPropertyChanged(nameof(CurrentSessionContextText));
        OnPropertyChanged(nameof(SessionTitle));
        OnPropertyChanged(nameof(SessionProgressText));
        OnPropertyChanged(nameof(HasPendingContextChange));
        NotifyPipelineStateChanged();
        StatusMessage = "現在の制作セッションへ新しいContextをBindingしました。履歴は保持されています。";
    }

    public async Task SaveSessionAsync()
    {
        if (CurrentSession is null) return;
        CurrentSession.OriginalIdea = Idea;
        await _store.SaveSessionAsync(CurrentSession);
        StatusMessage = "制作セッションを保存しました。";
    }

    public async Task GenerateAsync(bool applyFirst = true)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        if (!IsConnected) throw new InvalidOperationException("MCPに接続してください。");
        if (IsJobActive) throw new InvalidOperationException("Connectorが管理中のJobは1件だけです。");
        if (CurrentSession is null || !CurrentSession.Pipeline.ContextBound) throw new InvalidOperationException("左側から新しい制作を開始してください。");
        if (CurrentSession.BoundWorkflow is null || !string.Equals(CurrentSession.BoundWorkflow.RelativePath, SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("セッションに紐づくWorkflowと選択中Workflowが異なります。");
        if (CurrentSession.Pipeline.MaximumIterationSafetyStop) throw new InvalidOperationException("最大反復回数に達しました。続行するか制作を終了するか選択してください。");
        var changes = BuildChanges();
        if (applyFirst && (IsDirty || CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Apply).State != CreationStageState.Completed)) await ApplySlotsAsync();
        CreationPipelineStateMachine.BeginGenerate(CurrentSession);
        var prompt = FindPrompt(changes) ?? Idea;
        var iteration = CurrentSession.StartIteration(prompt, changes);
        await _store.SaveSessionAsync(CurrentSession);
        OnPropertyChanged(nameof(SessionStatusText));
        OnPropertyChanged(nameof(SessionProgressText));
        Iterations.Add(iteration);
        var historyItem = new GenerationHistoryItem(iteration);
        HistoryItems.Add(historyItem);
        RefreshHistoryFlags();
        SelectedHistoryItem = historyItem;
        OnPropertyChanged(nameof(HasIterations));
        NotifyHistoryChanged();
        NotifyPipelineStateChanged();
        IsBusy = true;
        try
        {
            CurrentJob = await _catalog.RunAsync(SelectedWorkflow, WorkflowRoot);
            iteration.JobId = CurrentJob.JobId;
            iteration.Status = CurrentJob.Status;
            CreationPipelineStateMachine.JobStatusChanged(CurrentSession, CurrentJob.Status, CurrentJob.Message);
            await _store.SaveSessionAsync(CurrentSession);
            StatusMessage = $"Job {CurrentJob.JobId} を投入しました。進捗率は推測せず状態だけ表示します。";
            await MonitorJobAsync(iteration);
        }
        catch (Exception ex)
        {
            iteration.Status = JobStatus.Failed;
            iteration.Error = ex.Message;
            CurrentSession.Status = SessionStatus.Error;
            CurrentSession.LastError = ex.Message;
            if (CreationPipelineStateMachine.Get(CurrentSession, CreationStage.Generate).State != CreationStageState.Completed)
                CreationPipelineStateMachine.JobStatusChanged(CurrentSession, JobStatus.Failed, ex.Message);
            else
                CreationPipelineStateMachine.OutputFailed(CurrentSession, ex.Message);
            CurrentJob = null;
            await _store.SaveSessionAsync(CurrentSession);
            RefreshHistoryFlags();
            NotifySelectedPreviewChanged();
            OnPropertyChanged(nameof(SessionStatusText));
            NotifyPipelineStateChanged();
            StatusMessage = $"生成に失敗しました: {ex.Message}";
            await _store.LogAsync("generation", StatusMessage, ex);
        }
        finally { IsBusy = false; }
    }

    public async Task ImportCommandAsync()
    {
        if (CurrentSession is null) throw new InvalidOperationException("先に新しい制作を開始してください。");
        if (CurrentSession.PendingHandoff is not null && !string.Equals(CurrentSession.BoundWorkflow?.RelativePath, CurrentSession.PendingHandoff.WorkflowIdentity, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Handoff作成後に制作Contextが変更されています。現在のContextをChatGPTへ送り直してください。");
        CreationPipelineStateMachine.BeginCommandValidation(CurrentSession);
        NotifyPipelineStateChanged();
        _pendingValidation = ConnectorProtocol.Parse(CommandText, CurrentSession.PendingHandoff);
        if (!_pendingValidation.IsValid)
        {
            var detail = _pendingValidation.DiagnosticText;
            CreationPipelineStateMachine.CommandValidationFailed(CurrentSession, detail);
            await _store.LogAsync("protocol.validation", detail);
            await _store.SaveSessionAsync(CurrentSession);
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
            if (command.Action == "complete") await CompleteSessionAsync(command.Reason ?? "ChatGPT completed the session.");
        }
        catch (Exception ex)
        {
            if (!_pendingValidation.Errors.Contains(ex.Message)) _pendingValidation.Errors.Add(ex.Message);
            StatusMessage = ex.Message;
            await _store.SaveSessionAsync(CurrentSession);
        }
        OnPropertyChanged(nameof(CanApplyCommand));
        NotifyPipelineStateChanged();
    }

    public async Task ApplyCommandAsync(bool generate)
    {
        if (_pendingValidation is not { IsValid: true, Command: not null } validation) { await ImportCommandAsync(); validation = _pendingValidation; }
        if (validation is not { IsValid: true, Command: not null } commandResult) throw new InvalidOperationException(string.Join(" ", validation?.Errors ?? []));
        if (commandResult.Command.Action != "generate") throw new InvalidOperationException("このcommandはgenerateではありません。");
        foreach (var item in Slots) if (commandResult.Command.Parameters.TryGetPropertyValue(item.Address, out var value) && value is not null) item.ValueText = value is JsonValue v && v.TryGetValue<string>(out var text) ? text : value.ToJsonString();
        IsDirty = true;
        NotifyPipelineStateChanged();
        if (generate) await GenerateAsync(); else await ApplySlotsAsync();
    }

    public async Task<string> PrepareBootstrapHandoffAsync()
    {
        if (CurrentSession is null || CurrentSession.BoundWorkflow is null) throw new InvalidOperationException("左の設定から新しい制作を開始してください。");
        if (SelectedWorkflow is null || !string.Equals(CurrentSession.BoundWorkflow.RelativePath, SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("現在の制作セッションと選択中Workflowが一致しません。左から新しい制作を開始してください。");
        }
        if (string.IsNullOrWhiteSpace(CurrentSession.ProjectLabel) || string.IsNullOrWhiteSpace(CurrentSession.ChatLabel)) throw new InvalidOperationException("ProjectとChatを設定して新しい制作を開始してください。");
        EnsureSlotSchemaAvailable();
        CurrentSession.OriginalIdea = Idea;
        CurrentSession.PendingHandoff = PendingHandoffFactory.Create(CurrentSession, Slots.Select(ToWorkflowSlot), "generate");
        await SaveSessionAsync();
        return ConnectorContextBuilder.BuildBootstrap(CurrentSession, CurrentSession.PendingHandoff);
    }

    public async Task<string> PrepareResultHandoffAsync(SessionIteration? selectedIteration = null)
    {
        if (CurrentSession is null) throw new InvalidOperationException("制作セッションがありません。");
        var iteration = selectedIteration ?? CurrentSession.Iterations.LastOrDefault() ?? throw new InvalidOperationException("ChatGPTへ渡せる生成結果がありません。");
        if (iteration.Status != JobStatus.Completed || iteration.Outputs.All(output => output.IsMissing)) throw new InvalidOperationException("成功した生成結果だけをChatGPTへ渡せます。");
        EnsureSlotSchemaAvailable();
        CurrentSession.PendingHandoff = PendingHandoffFactory.Create(CurrentSession, Slots.Select(ToWorkflowSlot), "generate", "complete");
        var payload = ConnectorContextBuilder.BuildResult(CurrentSession, iteration, CurrentSession.PendingHandoff);
        var message = CurrentSession.HandoffMessages.LastOrDefault(item => item.Direction == HandoffDirection.ComfyToChatGpt && item.IterationNumber == iteration.Number);
        if (message is not null) message.Payload = payload;
        await _store.SaveSessionAsync(CurrentSession);
        return payload;
    }

    public async Task<string> PrepareTimelineHandoffAsync(HandoffTimelineItem item)
    {
        if (item.Message.Direction == HandoffDirection.ChatGptToComfy) return item.Payload;
        if (item.Message.IterationNumber is { } iterationNumber)
        {
            var iteration = CurrentSession?.Iterations.FirstOrDefault(candidate => candidate.Number == iterationNumber);
            return await PrepareResultHandoffAsync(iteration);
        }
        var payload = await PrepareBootstrapHandoffAsync();
        item.Message.Payload = payload;
        return payload;
    }

    public async Task ConfirmBootstrapCopiedAsync(string payload)
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.BootstrapCopied(CurrentSession, Idea);
        await RecordHandoffAsync(new HandoffMessage
        {
            Direction = HandoffDirection.ConnectorToChatGpt,
            Kind = HandoffMessageKind.CreationRequest,
            State = HandoffTransportState.Copied,
            Title = "制作コンテキストを送信",
            DisplayText = string.IsNullOrWhiteSpace(Idea) ? "制作アイデア未入力" : Idea,
            Metadata = $"Workflow: {CurrentSession.BoundWorkflow?.DisplayName ?? SelectedWorkflowName}{Environment.NewLine}{CurrentSession.ProjectLabel} / {CurrentSession.ChatLabel}",
            Summary = "制作アイデアとConnector ProtocolをChatGPTへ渡します。",
            Payload = payload,
        });
        NotifyPipelineStateChanged();
    }

    public async Task MarkHandoffCopiedAsync(HandoffTimelineItem item)
    {
        item.MarkCopied();
        if (CurrentSession is not null)
        {
            if (item.Message.IterationNumber is not null) CreationPipelineStateMachine.ReviewCopied(CurrentSession);
            await _store.SaveSessionAsync(CurrentSession);
            NotifyPipelineStateChanged();
        }
        StatusMessage = item.IsChatGptToComfy ? "Connector用Commandをコピーしました。" : "ChatGPTへ渡す内容をコピーしました。";
    }

    public async Task CompleteSessionAsync(string reason)
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.Complete(CurrentSession, reason);
        RefreshHistoryFlags();
        OnPropertyChanged(nameof(SessionStatusText));
        NotifyPipelineStateChanged();
        StatusMessage = "セッションをCOMPLETEDにしました。履歴と出力は保持されています。必要ならRESUMEできます。";
        await _store.SaveSessionAsync(CurrentSession);
    }

    public async Task ResumeSessionAsync()
    {
        if (CurrentSession is null) return;
        _isCurrentSessionActivated = true;
        CreationPipelineStateMachine.Resume(CurrentSession);
        RefreshHistoryFlags();
        await _store.SaveSessionAsync(CurrentSession);
        OnPropertyChanged(nameof(SessionStatusText));
        NotifyPipelineStateChanged();
        StatusMessage = "セッションを再開しました。";
    }

    public async Task ContinueBeyondIterationLimitAsync()
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.ContinueBeyondLimit(CurrentSession);
        SessionMaximumIterations = CurrentSession.MaximumIterations;
        await _store.SaveSessionAsync(CurrentSession);
        OnPropertyChanged(nameof(SessionProgressText));
        NotifyPipelineStateChanged();
        StatusMessage = $"Maximum Iterationsを{CurrentSession.MaximumIterations}へ拡張しました。次のIterationへ進めます。";
    }

    public async Task EndAtIterationLimitAsync()
    {
        if (CurrentSession is null || !CurrentSession.Pipeline.MaximumIterationSafetyStop) return;
        await CompleteSessionAsync("最大反復回数でユーザーが制作終了を選択しました。");
    }

    public async Task CancelJobAsync()
    {
        if (CurrentJob is null || !IsJobActive) return;
        await _catalog.CancelAsync(CurrentJob.JobId);
        CurrentJob.Status = JobStatus.Cancelled;
        var iteration = CurrentSession?.Iterations.LastOrDefault(i => i.JobId == CurrentJob.JobId);
        if (iteration is not null) iteration.Status = JobStatus.Cancelled;
        if (CurrentSession is not null) CreationPipelineStateMachine.JobStatusChanged(CurrentSession, JobStatus.Cancelled, "ユーザーが生成をキャンセル");
        RefreshHistoryFlags();
        NotifySelectedPreviewChanged();
        if (CurrentSession is not null) await _store.SaveSessionAsync(CurrentSession);
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

    public void StartComfyUi()
    {
        var batch = Path.Combine(Settings.PortableRoot, "run_nvidia_gpu.bat");
        if (!File.Exists(batch)) throw new FileNotFoundException("ComfyUI起動batchが見つかりません。", batch);
        Process.Start(new ProcessStartInfo(batch) { UseShellExecute = true, WorkingDirectory = Path.GetDirectoryName(batch) });
        StatusMessage = "ComfyUIの起動を要求しました。ConnectorはComfyUIを終了しません。";
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
                    iteration.Outputs = (await _catalog.FetchOutputsAsync(job.JobId, OutputRoot)).ToList();
                    CreationPipelineStateMachine.OutputCompleted(CurrentSession!, iteration.Outputs);
                }
                catch (Exception ex)
                {
                    iteration.Error = ex.Message;
                    CreationPipelineStateMachine.OutputFailed(CurrentSession!, ex.Message);
                    StatusMessage = $"Jobは完了しましたがOutput取得に失敗しました: {ex.Message}";
                    await _store.SaveSessionAsync(CurrentSession!);
                    await _store.LogAsync("output", StatusMessage, ex);
                    NotifyPipelineStateChanged();
                    break;
                }
                CurrentJob.Outputs = iteration.Outputs;
                if (CreationPipelineStateMachine.Get(CurrentSession!, CreationStage.Output).State == CreationStageState.Error)
                {
                    StatusMessage = CreationPipelineStateMachine.Get(CurrentSession!, CreationStage.Output).Detail;
                    await _store.SaveSessionAsync(CurrentSession!);
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
                CurrentSession!.PendingHandoff = PendingHandoffFactory.Create(CurrentSession, Slots.Select(ToWorkflowSlot), "generate", "complete");
                var resultPayload = ConnectorContextBuilder.BuildResult(CurrentSession, iteration, CurrentSession.PendingHandoff);
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
                NotifyPipelineStateChanged();
                break;
            }
            if (CurrentJob.Status is JobStatus.Failed or JobStatus.Cancelled)
            {
                iteration.Error = CurrentJob.Message;
                RefreshHistoryFlags();
                NotifySelectedPreviewChanged();
                StatusMessage = $"Job {CurrentJob.Status}。";
                await _store.SaveSessionAsync(CurrentSession!);
                NotifyPipelineStateChanged();
                break;
            }
        }
    }

    private CreationSession NewSessionInternal()
    {
        var session = new CreationSession { Title = "新しい制作", MaximumIterations = Settings.MaximumIterations };
        CreationPipelineStateMachine.PrepareContext(session);
        Sessions.Add(session);
        return session;
    }

    private async Task InitializeContextProviderAsync()
    {
        _contextCatalog = await _contextProvider.LoadAsync(Sessions.Select(session => session.ToProjectChatBindingSnapshot()).ToArray());
        if (CurrentSession is not null)
        {
            var project = FindProjectForSession(CurrentSession);
            var chat = project is null ? null : FindChatForSession(project, CurrentSession);
            if (project is not null && chat is not null)
            {
                var before = CurrentSession.ToProjectChatBindingSnapshot();
                BindSessionContext(CurrentSession, project, chat);
                var after = CurrentSession.ToProjectChatBindingSnapshot();
                if (!BindingEquals(before, after)) await _store.SaveSessionAsync(CurrentSession);
            }
        }

        RefreshProjectOptions(CurrentSession?.EffectiveProjectContextKey, CurrentSession?.EffectiveChatContextKey);
    }

    private async Task ReloadContextOptionsAsync(string? preferredProjectKey = null, string? preferredChatKey = null)
    {
        _contextCatalog = await _contextProvider.LoadAsync(Sessions.Select(session => session.ToProjectChatBindingSnapshot()).ToArray());
        RefreshProjectOptions(preferredProjectKey ?? CurrentSession?.EffectiveProjectContextKey, preferredChatKey ?? CurrentSession?.EffectiveChatContextKey);
    }

    private void RefreshProjectOptions(string? preferredProjectKey = null, string? preferredChatKey = null)
    {
        var targetKey = preferredProjectKey ?? _selectedProject?.Key;
        ProjectOptions.Clear();
        foreach (var project in _contextCatalog.Projects.OrderBy(item => item.CreatedAt)) ProjectOptions.Add(project);
        ProjectOptions.Add(_createProjectOption);
        _selectedProject = ProjectOptions.FirstOrDefault(item => !item.IsCreateAction && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase) && item.Key == targetKey)
            ?? null;
        OnPropertyChanged(nameof(SelectedProject));
        OnPropertyChanged(nameof(HasSelectedProject));
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
            ChatOptions.Add(_createChatOption);
        }
        _selectedChat = ChatOptions.FirstOrDefault(item => !item.IsCreateAction && string.Equals(item.ProviderId, _contextProvider.ProviderId, StringComparison.OrdinalIgnoreCase) && item.Key == targetChatKey)
            ?? null;
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
            && string.Equals(left.ChatExternalId, right.ChatExternalId, StringComparison.Ordinal);

    private void ValidateNewCreationSetup()
    {
        if (!HasSelectedWorkflow) throw new InvalidOperationException("制作に使うWorkflowを選択してください。");
        if (!HasSelectedProject) throw new InvalidOperationException("ChatGPT Projectを選択してください。");
        if (!HasSelectedChat) throw new InvalidOperationException("Chatを選択してください。");
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
        var existing = CurrentSession.HandoffMessages.LastOrDefault();
        if (existing is not null && existing.Direction == message.Direction && string.Equals(existing.Payload, message.Payload, StringComparison.Ordinal))
        {
            existing.State = message.State;
            existing.Kind = message.Kind;
            existing.Title = message.Title;
            existing.DisplayText = message.DisplayText;
            existing.Metadata = message.Metadata;
            existing.Summary = message.Summary;
            RebuildHandoffItems();
        }
        else
        {
            CurrentSession.HandoffMessages.Add(message);
            HandoffItems.Add(new HandoffTimelineItem(message));
            OnPropertyChanged(nameof(HasHandoffItems));
        }
        await _store.SaveSessionAsync(CurrentSession);
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
            if (string.IsNullOrWhiteSpace(message.DisplayText)) message.DisplayText = string.IsNullOrWhiteSpace(CurrentSession?.OriginalIdea) ? "制作アイデア未入力" : CurrentSession.OriginalIdea;
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
        var isComplete = CurrentSession?.Status == SessionStatus.Completed;
        foreach (var item in HistoryItems)
        {
            var isLatest = ReferenceEquals(item, latest);
            item.UpdateFlags(isLatest, isComplete && isLatest);
        }
        OnPropertyChanged(nameof(LatestIterationText));
        OnPropertyChanged(nameof(IsViewingLatest));
        OnPropertyChanged(nameof(ViewingStateText));
    }

    private void NotifyHistoryChanged()
    {
        OnPropertyChanged(nameof(HasHistoryItems));
        OnPropertyChanged(nameof(LatestIterationText));
        NotifySelectedPreviewChanged();
    }

    private void NotifySelectedPreviewChanged()
    {
        OnPropertyChanged(nameof(SelectedPreviewOutput));
        OnPropertyChanged(nameof(HasSelectedPreviewOutput));
        OnPropertyChanged(nameof(IsSelectedPreviewMissing));
        OnPropertyChanged(nameof(ViewingIterationText));
        OnPropertyChanged(nameof(IsViewingLatest));
        OnPropertyChanged(nameof(ViewingStateText));
        OnPropertyChanged(nameof(CurrentOutputFolderPath));
    }

    private Dictionary<string, JsonNode?> BuildChanges() => Slots.ToDictionary(x => x.Address, x => x.ToJsonNode(), StringComparer.OrdinalIgnoreCase);
    private string? FindPrompt(Dictionary<string, JsonNode?> changes) => changes.FirstOrDefault(x => x.Key.Contains("prompt", StringComparison.OrdinalIgnoreCase)).Value is JsonValue value && value.TryGetValue<string>(out var prompt) ? prompt : null;
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
        if (!IsConnected) throw new InvalidOperationException("MCPへ接続してWorkflow slotを読み込んでください。Handoffはまだ作成されていません。");
        if (SlotDiscoveryState == SlotDiscoveryState.Loading) throw new InvalidOperationException("Workflow slotを読み込み中です。完了後にもう一度SEND TO CHATGPTを押してください。");
        if (SlotDiscoveryState == SlotDiscoveryState.Failed) throw new InvalidOperationException($"Workflow slotの取得に失敗しています。再読み込みしてください。{(string.IsNullOrWhiteSpace(SlotLoadError) ? string.Empty : $" 詳細: {SlotLoadError}")}");
        if (SlotDiscoveryState != SlotDiscoveryState.Loaded) throw new InvalidOperationException("Workflow slot schemaが未取得です。Workflowを再選択して読み込んでください。");
    }

    private static string BuildPersistedResultPayload(CreationSession session, SessionIteration iteration)
    {
        session.PendingHandoff ??= PendingHandoffFactory.Create(session, [], "generate", "complete");
        return ConnectorContextBuilder.BuildResult(session, iteration, session.PendingHandoff);
    }

    private static string NormalizeWorkflowName(string name)
    {
        var value = Path.GetFileNameWithoutExtension(name ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value) || value is "." or ".." || value.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new InvalidOperationException("Workflow名が不正です。");
        return value;
    }

    private void SlotChanged(object? sender, PropertyChangedEventArgs e) { if (e.PropertyName == nameof(SlotEditorItem.ValueText)) IsDirty = true; }

    private void NotifyConnectionStateChanged()
    {
        OnPropertyChanged(nameof(IsSystemProcessing));
        OnPropertyChanged(nameof(ConnectorSystemState));
        OnPropertyChanged(nameof(McpSystemState));
        OnPropertyChanged(nameof(ComfyUiSystemState));
        OnPropertyChanged(nameof(GpuSystemState));
        OnPropertyChanged(nameof(HasGpuEvidence));
        OnPropertyChanged(nameof(SystemConnectionSummary));
    }

    private void NotifyContextSelectionChanged()
    {
        OnPropertyChanged(nameof(ProjectPlaceholderText));
        OnPropertyChanged(nameof(ChatPlaceholderText));
        OnPropertyChanged(nameof(ContextReadinessText));
        OnPropertyChanged(nameof(HasPendingContextChange));
        NotifyPipelineStateChanged();
    }

    private void NotifyPipelineStateChanged()
    {
        RefreshPipeline();
        OnPropertyChanged(nameof(CurrentCreationStageText));
        OnPropertyChanged(nameof(CurrentCreationStageDescription));
        OnPropertyChanged(nameof(CurrentCreationStageState));
        OnPropertyChanged(nameof(CurrentIterationLabel));
        OnPropertyChanged(nameof(PipelineLoopText));
        OnPropertyChanged(nameof(HasIterationSafetyStop));
        OnPropertyChanged(nameof(CanApplyCommand));
        OnPropertyChanged(nameof(CanRunWorkflow));
    }

    private void RefreshPipeline()
    {
        if (CurrentSession is null) return;
        CreationPipelineStateMachine.EnsureInitialized(CurrentSession);
        var definitions = new Dictionary<CreationStage, (string Key, string Label, string Description)>
        {
            [CreationStage.Context] = ("CONTEXT", "Context", "Workflow / Project / Chat / Maximum Iterations / Session Binding"),
            [CreationStage.Idea] = ("IDEA", "アイデア", "制作の核となるイメージ"),
            [CreationStage.ToChatGpt] = ("TO CHATGPT", "To ChatGPT", "制作ContextをManual Handoff"),
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
            var status = _isCurrentSessionActivated
                ? CreationPipelineStateMachine.Get(CurrentSession, stage)
                : new CreationStageStatus
                {
                    Stage = stage,
                    State = stage == CreationStage.Context ? CreationStageState.Current : CreationStageState.NotReached,
                    Detail = stage == CreationStage.Context
                        ? "Workflow / Project / Chat / Maximum Iterations / Session Bindingを確認して新しい制作を開始してください"
                        : string.Empty,
                };
            var definition = definitions[stage];
            var state = status.State.ToString().ToUpperInvariant();
            var stateLabel = status.State switch
            {
                CreationStageState.Completed => "完了",
                CreationStageState.Current => "現在",
                CreationStageState.WaitingUser => "ユーザー待ち",
                CreationStageState.InProgress => "処理中",
                CreationStageState.Error => "エラー",
                CreationStageState.Cancelled => "キャンセル",
                CreationStageState.Skipped => "スキップ",
                _ => "未到達",
            };
            var description = string.IsNullOrWhiteSpace(status.Detail) ? definition.Description : $"{definition.Description}{Environment.NewLine}{status.Detail}";
            PipelineStages.Add(new CreationPipelineStage(index + 1, definition.Key, definition.Label, description, state, stateLabel, index == CreationPipelineStateMachine.OrderedStages.Length - 1));
        }
        OnPropertyChanged(nameof(PipelineStages));
    }

    private CreationPipelineStage GetCurrentPipelineStage()
    {
        return PipelineStages.FirstOrDefault(item => item.State is "CURRENT" or "INPROGRESS" or "WAITINGUSER" or "ERROR" or "CANCELLED")
            ?? PipelineStages.LastOrDefault(item => item.IsCompleted)
            ?? new CreationPipelineStage(1, "CONTEXT", "Context", "Workflow / Project / Chatを設定", "CURRENT", "現在", false);
    }

    private JsonNode? FindServerInfoNode(string key)
    {
        if (_serverInfo is null) return null;
        return FindNodeRecursive(_serverInfo, key, 0);
    }

    private bool? ReadServerInfoBoolean(string key)
    {
        var node = FindServerInfoNode(key);
        return node is JsonValue value && value.TryGetValue<bool>(out var result) ? result : null;
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
