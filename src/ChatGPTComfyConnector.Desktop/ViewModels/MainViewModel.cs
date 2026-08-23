using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
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
    private bool _isDirty;
    private bool _isWorkflowEditorVisible;
    private string _commandText = string.Empty;
    private string _idea = string.Empty;
    private string? _slotLoadError;
    private ProtocolValidationResult? _pendingValidation;
    private string? _loadedFingerprint;
    private JsonNode? _serverInfo;
    private bool _commandReceived;
    private bool _workflowPrepared;
    private GenerationHistoryItem? _selectedHistoryItem;

    public MainViewModel(string applicationDirectory)
    {
        _layout = new PortableLayout(applicationDirectory);
        _store = new PortableStore(_layout);
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
    public CreationSession? CurrentSession { get => _currentSession; private set { _currentSession = value; OnPropertyChanged(); OnPropertyChanged(nameof(SessionTitle)); OnPropertyChanged(nameof(SessionStatusText)); OnPropertyChanged(nameof(SessionProgressText)); OnPropertyChanged(nameof(ProjectLabel)); OnPropertyChanged(nameof(ChatLabel)); NotifyPipelineStateChanged(); } }
    public WorkflowIdentity? SelectedWorkflow { get => _selectedWorkflow; private set { _selectedWorkflow = value; OnPropertyChanged(); OnPropertyChanged(nameof(SelectedWorkflowText)); OnPropertyChanged(nameof(SelectedWorkflowName)); OnPropertyChanged(nameof(HasSelectedWorkflow)); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); NotifyPipelineStateChanged(); } }
    public JobSnapshot? CurrentJob { get => _currentJob; private set { _currentJob = value; OnPropertyChanged(); OnPropertyChanged(nameof(JobStatusText)); OnPropertyChanged(nameof(JobStatusDetailText)); OnPropertyChanged(nameof(IsJobActive)); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public ConnectionState ConnectionState { get => _connectionState; private set { _connectionState = value; OnPropertyChanged(); OnPropertyChanged(nameof(ConnectionStateText)); OnPropertyChanged(nameof(IsConnected)); NotifyConnectionStateChanged(); NotifyViewStateChanged(); NotifyPipelineStateChanged(); } }
    public string StatusMessage { get => _statusMessage; set { _statusMessage = value; OnPropertyChanged(); } }
    public bool IsSetupVisible { get => _isSetupVisible; private set { _isSetupVisible = value; OnPropertyChanged(); } }
    public bool IsWorkflowEditorVisible { get => _isWorkflowEditorVisible; private set { _isWorkflowEditorVisible = value; OnPropertyChanged(); } }
    public bool IsBusy { get => _isBusy; private set { _isBusy = value; OnPropertyChanged(); NotifyConnectionStateChanged(); NotifyPipelineStateChanged(); } }
    public bool IsSlotLoading { get => _isSlotLoading; private set { _isSlotLoading = value; OnPropertyChanged(); OnPropertyChanged(nameof(WorkflowSlotSummaryText)); NotifyViewStateChanged(); } }
    public bool IsDirty { get => _isDirty; private set { _isDirty = value; OnPropertyChanged(); OnPropertyChanged(nameof(DirtyText)); NotifyPipelineStateChanged(); } }
    public string CommandText
    {
        get => _commandText;
        set
        {
            _commandText = value;
            _pendingValidation = null;
            OnPropertyChanged();
            OnPropertyChanged(nameof(CanApplyCommand));
            NotifyPipelineStateChanged();
        }
    }
    public string Idea { get => _idea; set { _idea = value; OnPropertyChanged(); NotifyPipelineStateChanged(); } }
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
    public string CurrentIterationLabel => CurrentSession is null || CurrentSession.CurrentIteration == 0 ? "ITERATION —" : $"ITERATION {CurrentSession.CurrentIteration:00}";
    public string PipelineLoopText => CurrentSession?.Status == SessionStatus.Completed ? "SESSION COMPLETE" : CurrentSession?.CurrentIteration > 0 ? "REVIEW → NEXT ITERATION" : "REVIEW → NEXT ITERATION";
    public string SessionStatusText => CurrentSession?.Status.ToString().ToUpperInvariant() ?? "NEW";
    public string JobStatusText => CurrentJob is null ? "IDLE" : CurrentJob.Status.ToString().ToUpperInvariant();
    public string JobStatusDetailText => CurrentJob is null ? "生成待機中" : IsJobActive ? "ComfyUIで生成を実行中" : CurrentJob.Status switch { JobStatus.Completed => "生成が完了しました", JobStatus.Failed => "生成に失敗しました", JobStatus.Cancelled => "生成をキャンセルしました", _ => "Jobを確認してください" };
    public string DirtyText => IsDirty ? "UNSAVED CHANGES" : "SAVED";
    public string SessionProgressText => CurrentSession is null ? "0 / 10 ITERATIONS" : $"{CurrentSession.CurrentIteration} / {CurrentSession.MaximumIterations} ITERATIONS";
    public string WorkflowSlotSummaryText => !HasSelectedWorkflow ? "左のライブラリからWorkflowを選択" : !IsConnected ? "MCP未接続 · CONNECTでslotを読み込み" : IsSlotLoading ? "slotを読み込み中…" : HasSlotLoadError ? "slotの読み込みに失敗" : $"主要 {PrimarySlots.Count} · 調整 {TuningSlots.Count} · 詳細 {AdvancedSlots.Count}";
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
    public bool CanApplyCommand => _pendingValidation is { IsValid: true, Command: not null } command && command.Command.Action == "generate";
    public bool ShowWorkflowEmptyState => !HasSelectedWorkflow;
    public bool ShowDisconnectedState => HasSelectedWorkflow && !IsConnected;
    public bool ShowSlotLoadingState => HasSelectedWorkflow && IsConnected && IsSlotLoading;
    public bool ShowSlotErrorState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && HasSlotLoadError;
    public bool ShowNoSlotState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && !HasSlots;
    public bool ShowReadyState => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError && HasSlots;
    public bool CanRunWorkflow => HasSelectedWorkflow && IsConnected && !IsSlotLoading && !HasSlotLoadError;
    public bool IsJobActive => CurrentJob is { Status: JobStatus.Queued or JobStatus.Running };
    public string WorkflowRoot => Path.Combine(Settings.PortableRoot, "ComfyUI", "user", "default", "workflows");
    public string OutputRoot => Path.Combine(Settings.PortableRoot, "ComfyUI", "output");

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
        Idea = CurrentSession.OriginalIdea;
        Iterations.Clear();
        foreach (var iteration in CurrentSession.Iterations) Iterations.Add(iteration);
        LatestOutputs.Clear();
        foreach (var output in CurrentSession.Iterations.LastOrDefault()?.Outputs ?? []) LatestOutputs.Add(output);
        RebuildHistoryItems();
        _commandReceived = !string.IsNullOrWhiteSpace(CommandText);
        _workflowPrepared = CurrentSession.BoundWorkflow is not null;
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
            NotifySlotCollectionsChanged();
            StatusMessage = $"{Slots.Count}個のslotを読み込みました。";
        }
        catch (Exception ex)
        {
            SlotLoadError = ex.Message;
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
        if (changes.Count == 0) { IsDirty = false; _workflowPrepared = true; NotifyPipelineStateChanged(); return; }
        IsBusy = true;
        try
        {
            await _catalog.ApplySlotsAsync(SelectedWorkflow, WorkflowRoot, changes);
            _loadedFingerprint = WorkflowCatalog.ComputeFingerprint(path);
            IsDirty = false;
            _workflowPrepared = true;
            foreach (var backup in await _store.ListWorkflowBackupsAsync(SelectedWorkflow)) { if (!Backups.Contains(backup)) Backups.Add(backup); }
            StatusMessage = "Workflowをbackup → apply → validateしました。";
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

    public void CreateNewSession()
    {
        CurrentSession = NewSessionInternal();
        Idea = string.Empty;
        CommandText = string.Empty;
        _pendingValidation = null;
        _commandReceived = false;
        _workflowPrepared = false;
        Iterations.Clear();
        LatestOutputs.Clear();
        HistoryItems.Clear();
        SelectedHistoryItem = null;
        OnPropertyChanged(nameof(HasIterations));
        OnPropertyChanged(nameof(HasLatestOutputs));
        NotifyHistoryChanged();
        OnPropertyChanged(nameof(SessionProgressText));
        NotifyPipelineStateChanged();
        StatusMessage = "新しい制作セッションを作成しました。";
    }

    public async Task SaveSessionAsync()
    {
        if (CurrentSession is null) return;
        CurrentSession.OriginalIdea = Idea;
        CurrentSession.MaximumIterations = Settings.MaximumIterations;
        await _store.SaveSessionAsync(CurrentSession);
        StatusMessage = "制作セッションを保存しました。";
    }

    public async Task GenerateAsync(bool applyFirst = true)
    {
        if (SelectedWorkflow is null) throw new InvalidOperationException("Workflowを選択してください。");
        if (!IsConnected) throw new InvalidOperationException("MCPに接続してください。");
        if (IsJobActive) throw new InvalidOperationException("Connectorが管理中のJobは1件だけです。");
        CurrentSession ??= NewSessionInternal();
        if (CurrentSession.BoundWorkflow is null) CurrentSession.BoundWorkflow = SelectedWorkflow;
        if (!string.Equals(CurrentSession.BoundWorkflow.RelativePath, SelectedWorkflow.RelativePath, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("セッションに紐づくWorkflowと選択中Workflowが異なります。");
        if (CurrentSession.AtIterationLimit) throw new InvalidOperationException("最大反復回数に達しました。上限を変更してから続行してください。");
        var changes = BuildChanges();
        if (applyFirst && IsDirty) await ApplySlotsAsync();
        await ValidateCurrentAsync();
        _workflowPrepared = true;
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
        _pendingValidation = ConnectorProtocol.Parse(CommandText);
        if (!_pendingValidation.IsValid) { OnPropertyChanged(nameof(CanApplyCommand)); StatusMessage = string.Join(" ", _pendingValidation.Errors); NotifyPipelineStateChanged(); return; }
        _pendingValidation = ConnectorProtocol.ValidateAgainstSlots(_pendingValidation.Command!, Slots.Select(ToWorkflowSlot), SelectedWorkflow);
        _commandReceived = true;
        OnPropertyChanged(nameof(CanApplyCommand));
        StatusMessage = _pendingValidation.IsValid ? "ChatGPTからの生成指示を確認しました。「適用」から反映できます。" : string.Join(" ", _pendingValidation.Errors);
        if (_pendingValidation.Command?.Action == "complete" && _pendingValidation.IsValid) CompleteSession(_pendingValidation.Command.Reason ?? "ChatGPT completed the session.");
        await Task.CompletedTask;
    }

    public async Task ApplyCommandAsync(bool generate)
    {
        if (_pendingValidation is not { IsValid: true, Command: not null } validation) { await ImportCommandAsync(); validation = _pendingValidation; }
        if (validation is not { IsValid: true, Command: not null } commandResult) throw new InvalidOperationException(string.Join(" ", validation?.Errors ?? []));
        if (commandResult.Command.Action != "generate") throw new InvalidOperationException("このcommandはgenerateではありません。");
        foreach (var item in Slots) if (commandResult.Command.Parameters.TryGetPropertyValue(item.Address, out var value) && value is not null) item.ValueText = value is JsonValue v && v.TryGetValue<string>(out var text) ? text : value.ToJsonString();
        IsDirty = true;
        _workflowPrepared = true;
        NotifyPipelineStateChanged();
        if (generate) await GenerateAsync(); else await ApplySlotsAsync();
    }

    public string BuildBootstrapContext() => CurrentSession is null ? string.Empty : ConnectorContextBuilder.BuildBootstrap(CurrentSession, Slots.Select(ToWorkflowSlot));
    public string BuildResultContext() => CurrentSession?.Iterations.LastOrDefault() is { } iteration ? ConnectorContextBuilder.BuildResult(CurrentSession, iteration) : string.Empty;

    public void CompleteSession(string reason)
    {
        if (CurrentSession is null) return;
        CurrentSession.Complete(reason);
        RefreshHistoryFlags();
        OnPropertyChanged(nameof(SessionStatusText));
        NotifyPipelineStateChanged();
        StatusMessage = "セッションをCOMPLETEDにしました。履歴と出力は保持されています。必要ならRESUMEできます。";
        _ = _store.SaveSessionAsync(CurrentSession);
    }

    public async Task ResumeSessionAsync()
    {
        if (CurrentSession is null) return;
        CurrentSession.Resume();
        RefreshHistoryFlags();
        await _store.SaveSessionAsync(CurrentSession);
        OnPropertyChanged(nameof(SessionStatusText));
        NotifyPipelineStateChanged();
        StatusMessage = "セッションを再開しました。";
    }

    public async Task CancelJobAsync()
    {
        if (CurrentJob is null || !IsJobActive) return;
        await _catalog.CancelAsync(CurrentJob.JobId);
        CurrentJob.Status = JobStatus.Cancelled;
        var iteration = CurrentSession?.Iterations.LastOrDefault(i => i.JobId == CurrentJob.JobId);
        if (iteration is not null) iteration.Status = JobStatus.Cancelled;
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
            if (CurrentJob.Status == JobStatus.Completed)
            {
                iteration.Outputs = (await _catalog.FetchOutputsAsync(job.JobId, OutputRoot)).ToList();
                CurrentJob.Outputs = iteration.Outputs;
                LatestOutputs.Clear();
                foreach (var output in iteration.Outputs) LatestOutputs.Add(output);
                OnPropertyChanged(nameof(HasLatestOutputs));
                SelectedHistoryItem = HistoryItems.FirstOrDefault(item => ReferenceEquals(item.Iteration, iteration)) ?? SelectedHistoryItem;
                RefreshHistoryFlags();
                NotifySelectedPreviewChanged();
                CurrentJob.CompletedAt = DateTimeOffset.UtcNow;
                StatusMessage = $"Iteration {iteration.Number} が完了しました。出力 {iteration.Outputs.Count} 件。";
                await _store.SaveSessionAsync(CurrentSession!);
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
        var session = new CreationSession { Title = "新しい制作", MaximumIterations = Settings.MaximumIterations, BoundWorkflow = SelectedWorkflow };
        Sessions.Add(session);
        return session;
    }

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
    }

    private Dictionary<string, JsonNode?> BuildChanges() => Slots.ToDictionary(x => x.Address, x => x.ToJsonNode(), StringComparer.OrdinalIgnoreCase);
    private string? FindPrompt(Dictionary<string, JsonNode?> changes) => changes.FirstOrDefault(x => x.Key.Contains("prompt", StringComparison.OrdinalIgnoreCase)).Value is JsonValue value && value.TryGetValue<string>(out var prompt) ? prompt : null;
    private static WorkflowSlot ToWorkflowSlot(SlotEditorItem item) => new() { Address = item.Address, Label = item.Label, Type = item.Type, CurrentValue = item.ToJsonNode() };

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

    private void NotifyPipelineStateChanged()
    {
        RefreshPipeline();
        OnPropertyChanged(nameof(CurrentCreationStageText));
        OnPropertyChanged(nameof(CurrentCreationStageDescription));
        OnPropertyChanged(nameof(CurrentCreationStageState));
        OnPropertyChanged(nameof(CurrentIterationLabel));
        OnPropertyChanged(nameof(PipelineLoopText));
    }

    private void RefreshPipeline()
    {
        var currentIndex = GetCurrentPipelineStageIndex();
        var sessionCompleted = CurrentSession?.Status == SessionStatus.Completed;
        var sessionErrored = CurrentSession?.Status == SessionStatus.Error;
        var definitions = new[]
        {
            ("IDEA", "アイデア", "制作の核となるイメージ"),
            ("CHATGPT", "ChatGPT", "会話で意図を磨く"),
            ("COMMAND", "Command", "Connector Protocol v1を確認"),
            ("WORKFLOW", "Workflow", "選択・微調整・検証"),
            ("GENERATE", "Generate", "ComfyUIで1件を実行"),
            ("OUTPUT", "Output", "最新の生成物を受け取る"),
            ("REVIEW", "Review", "結果を見て次のIterationへ"),
        };

        PipelineStages.Clear();
        for (var index = 0; index < definitions.Length; index++)
        {
            var state = index < currentIndex ? "DONE" : index > currentIndex ? "NEXT" : "NOW";
            if (sessionCompleted) state = index == definitions.Length - 1 ? "COMPLETE" : "DONE";
            if (sessionErrored && index == currentIndex) state = "ERROR";
            var stateLabel = state switch
            {
                "DONE" => "完了",
                "COMPLETE" => "完了",
                "ERROR" => "要確認",
                "NOW" => "現在",
                _ => "次",
            };
            PipelineStages.Add(new CreationPipelineStage(index + 1, definitions[index].Item1, definitions[index].Item2, definitions[index].Item3, state, stateLabel, index == definitions.Length - 1));
        }
        OnPropertyChanged(nameof(PipelineStages));
    }

    private CreationPipelineStage GetCurrentPipelineStage()
    {
        var index = GetCurrentPipelineStageIndex();
        return PipelineStages.ElementAtOrDefault(index) ?? new CreationPipelineStage(1, "IDEA", "アイデア", "制作の核となるイメージ", "NOW", "現在", false);
    }

    private int GetCurrentPipelineStageIndex()
    {
        if (CurrentSession?.Status == SessionStatus.Completed) return 6;
        var latest = CurrentSession?.Iterations.LastOrDefault() ?? Iterations.LastOrDefault();
        if (CurrentSession?.Status == SessionStatus.Error || latest?.Status == JobStatus.Failed) return 4;
        if (IsJobActive || latest?.Status is JobStatus.Queued or JobStatus.Running) return 4;
        if (latest?.Status == JobStatus.Completed) return 6;
        if (_workflowPrepared && SelectedWorkflow is not null) return 3;
        if (_commandReceived || !string.IsNullOrWhiteSpace(CommandText)) return 2;
        if (!string.IsNullOrWhiteSpace(Idea)) return 1;
        return 0;
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
        var fullPath = Path.GetFullPath(path);
        PathSafety.RequireWithin(OutputRoot, fullPath);
        if (!File.Exists(fullPath)) throw new FileNotFoundException("出力ファイルが見つかりません。", fullPath);
        Process.Start(new ProcessStartInfo(fullPath) { UseShellExecute = true });
    }

    public void OpenOutputFolder(string path)
    {
        var fullPath = Path.GetFullPath(path);
        PathSafety.RequireWithin(OutputRoot, fullPath);
        var folder = Directory.Exists(fullPath) ? fullPath : Path.GetDirectoryName(fullPath);
        if (string.IsNullOrWhiteSpace(folder)) throw new DirectoryNotFoundException("出力フォルダを特定できません。");
        Directory.CreateDirectory(folder);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{folder}\"") { UseShellExecute = true });
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
