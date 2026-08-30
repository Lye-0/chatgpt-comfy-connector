using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Runtime.CompilerServices;

namespace ChatGPTComfyConnector.Core.Models;

public enum ConnectionState
{
    Disconnected,
    Connecting,
    Connected,
    Stopped,
    Unavailable,
    Error,
}

/// <summary>
/// Runtime state of the ComfyUI HTTP endpoint. This is deliberately separate
/// from <see cref="ConnectionState"/>: MCP transport connectivity and the
/// ComfyUI process are independent facts in the system connection topology.
/// </summary>
public enum ComfyUiRuntimeState
{
    Unknown,
    Stopped,
    Starting,
    Ready,
    Error,
}

public enum ComfyUiHealthCheckStatus
{
    Ready,
    Unavailable,
    InvalidEndpoint,
    Error,
}

public readonly record struct ComfyUiHealthCheckResult(
    ComfyUiHealthCheckStatus Status,
    string? Detail = null)
{
    public bool IsReady => Status == ComfyUiHealthCheckStatus.Ready;
}

public enum SessionStatus
{
    New,
    Active,
    Completed,
    Stopped,
    Paused,
    Error,
    /// <summary>
    /// The current automatic Run reached its per-run iteration budget while
    /// ChatGPT still returned a valid generate decision.  This is distinct
    /// from Completed: the user can explicitly resume the deferred command.
    /// Appended at the end to preserve the numeric values of persisted states.
    /// </summary>
    LimitReached,
}

public enum JobStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

public enum ContextBindingMode
{
    Local,
    External,
}

public static class ContextProviderIds
{
    public const string LocalJson = "local-json";
}

public enum HandoffDirection
{
    ChatGptToComfy,
    ComfyToChatGpt,
    ConnectorToChatGpt,
}

public enum HandoffMessageKind
{
    Unknown,
    CreationRequest,
    GenerationCommand,
    GenerationResult,
    ReviewRequest,
    RegenerationCommand,
    Complete,
}

public enum HandoffTransportState
{
    Waiting,
    Received,
    Copied,
    Sent,
    Attached,
    Failed,
    Completed,
}

/// <summary>
/// The immutable boundary a Pending Handoff represents.  This is kept on the
/// snapshot instead of inferred from the mutable pipeline stages so a response
/// can still be classified after command validation has started resetting
/// transient stages.
/// </summary>
public enum PendingHandoffPurpose
{
    Unknown,
    Bootstrap,
    /// <summary>
    /// The immutable ComfyUI output context shown in the Timeline.  It is not
    /// the Review request that follows it; a Review request must receive a
    /// fresh handoff/boundary identity.
    /// </summary>
    GenerationResult,
    Review,
    /// <summary>
    /// A user-directed Handoff issued after a completed Session was resumed.
    /// It deliberately permits only the first generate decision of the new
    /// Run; later iteration Reviews use <see cref="Review"/>.
    /// </summary>
    Resume,
}

public enum CreationStage
{
    // Keep the persisted v1 numeric values stable. Display/execution order is
    // defined by CreationPipelineStateMachine.OrderedStages.
    Context = 0,
    Idea = 1,
    ToChatGpt = 2,
    Command = 3,
    Apply = 4,
    Generate = 5,
    Output = 6,
    Review = 7,
    Connect = 8,
}

public enum CreationStageState
{
    NotReached,
    Current,
    WaitingUser,
    InProgress,
    Completed,
    Error,
    Cancelled,
    Skipped,
}

/// <summary>
/// Structured reason for a stage that is waiting for a user action or response.
/// Keep this separate from <see cref="CreationStageState"/> so the shared state
/// model remains stable while the UI can explain the concrete wait condition.
/// </summary>
public enum CreationWaitingReason
{
    None,
    ComfyUiStartRequired,
    ReconnectRequired,
    ConnectionCheckRequired,
    ChatGptPasteRequired,
    ChatGptResponseRequired,
    ReviewResponseRequired,
    ContinueDecisionRequired,
    UserActionRequired,
}

/// <summary>
/// Internal execution state for the automatic Response -> APPLY -> GENERATE
/// path. This is deliberately separate from the persisted pipeline stages so
/// a duplicate assistant.response can be ignored without rewriting the
/// user-visible Handoff timeline.
/// </summary>
public enum AutomaticResponseExecutionState
{
    None,
    Validating,
    Applying,
    Generating,
    Completed,
    Failed,
}

/// <summary>
/// Durable transport state for the Review Handoff that follows a completed
/// generation.  It is deliberately separate from media attachment and
/// assistant-response state: an attachment being present does not mean that
/// the Review Handoff was sent.
/// </summary>
public enum ReviewHandoffState
{
    None,
    Preparing,
    Sending,
    Sent,
    WaitingResponse,
    Received,
    Failed,
    Stopped,
    Completed,
}

/// <summary>
/// State of the standard automatic iteration loop.  There is no user-facing
/// ON/OFF switch; this snapshot exists to make cancellation, restart recovery
/// and stale-response rejection durable and idempotent.
/// </summary>
public enum AutomaticIterationState
{
    None,
    Running,
    WaitingForReviewResponse,
    Stopped,
    Failed,
    Completed,
    // Appended to preserve the numeric values of the v0.2 snapshots.
    LimitReached,
}

/// <summary>
/// User-facing substate of the existing GENERATE stage. No permanent pipeline
/// stage is added for ComfyUI startup/waiting; these states only describe the
/// current generation request.
/// </summary>
public enum GenerateExecutionState
{
    ReadyToGenerate,
    StartingComfyUi,
    WaitingForComfyUi,
    Generating,
    GenerationFailed,
}

public sealed class AppSettings : INotifyPropertyChanged
{
    private string _portableRoot = string.Empty;
    private string _comfyMcpPath = string.Empty;
    private string _endpoint = "http://127.0.0.1:8188";
    private string? _comfyCliPath;
    private int _maximumIterations = 10;
    public string PortableRoot { get => _portableRoot; set => Set(ref _portableRoot, value); }
    public string ComfyMcpPath { get => _comfyMcpPath; set => Set(ref _comfyMcpPath, value); }
    public string Endpoint { get => _endpoint; set => Set(ref _endpoint, value); }
    public string? ComfyCliPath { get => _comfyCliPath; set => Set(ref _comfyCliPath, value); }
    public int MaximumIterations { get => _maximumIterations; set => Set(ref _maximumIterations, value); }

    public bool IsConfigured =>
        !string.IsNullOrWhiteSpace(PortableRoot) &&
        !string.IsNullOrWhiteSpace(ComfyMcpPath) &&
        Uri.TryCreate(Endpoint, UriKind.Absolute, out var uri) &&
        (uri.Scheme is "http" or "https");

    public AppSettings Clone() => new()
    {
        PortableRoot = PortableRoot,
        ComfyMcpPath = ComfyMcpPath,
        Endpoint = Endpoint,
        ComfyCliPath = ComfyCliPath,
        MaximumIterations = MaximumIterations,
    };

    public event PropertyChangedEventHandler? PropertyChanged;
    private void Set<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return;
        field = value;
        PropertyChanged?.Invoke(this, new(propertyName));
    }
}

public sealed class PortableLayout
{
    public PortableLayout(string root)
    {
        Root = Path.GetFullPath(root);
        Config = Path.Combine(Root, "config");
        Data = Path.Combine(Root, "data");
        Sessions = Path.Combine(Data, "sessions");
        Logs = Path.Combine(Root, "logs");
        Backups = Path.Combine(Root, "backups");
        Cache = Path.Combine(Root, "cache");
        ContextsFile = Path.Combine(Data, "chatgpt-contexts.json");
    }

    public string Root { get; }
    public string Config { get; }
    public string Data { get; }
    public string Sessions { get; }
    public string Logs { get; }
    public string Backups { get; }
    public string Cache { get; }
    public string ContextsFile { get; }
    public string SettingsFile => Path.Combine(Config, "settings.json");
    public string BrowserExtensionPairingFile => Path.Combine(Config, "browser-extension-pairing.json");
    public string LogFile => Path.Combine(Logs, "connector.log");

    public void EnsureDirectories()
    {
        Directory.CreateDirectory(Config);
        Directory.CreateDirectory(Data);
        Directory.CreateDirectory(Sessions);
        Directory.CreateDirectory(Logs);
        Directory.CreateDirectory(Backups);
        Directory.CreateDirectory(Cache);
    }
}

public sealed record WorkflowIdentity(string RelativePath)
{
    public string DisplayName => Path.GetFileNameWithoutExtension(RelativePath);

    public string ToAbsolute(string workflowRoot)
    {
        var root = Path.GetFullPath(workflowRoot);
        var candidate = Path.GetFullPath(Path.Combine(root, RelativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!PathSafety.IsWithin(root, candidate) || !candidate.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Workflowの相対パスが許可範囲外です。");
        }

        return candidate;
    }

    public static WorkflowIdentity Create(string relativePath)
    {
        if (string.IsNullOrWhiteSpace(relativePath) || Path.IsPathRooted(relativePath))
        {
            throw new ArgumentException("Workflowは相対パスで指定してください。", nameof(relativePath));
        }

        var normalized = relativePath.Replace('\\', '/').Trim('/');
        if (!normalized.EndsWith(".json", StringComparison.OrdinalIgnoreCase) ||
            normalized.Split('/').Any(segment => segment is ".." or "." || segment.IndexOf('\0') >= 0))
        {
            throw new ArgumentException("Workflowの相対パスが不正です。", nameof(relativePath));
        }

        return new WorkflowIdentity(normalized);
    }
}

public static class PathSafety
{
    public static bool IsWithin(string root, string candidate)
    {
        var normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var normalizedCandidate = Path.GetFullPath(candidate).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return normalizedCandidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }

    public static string RequireWithin(string root, string candidate, string message = "パスが許可範囲外です。")
    {
        var full = Path.GetFullPath(candidate);
        if (!IsWithin(root, full))
        {
            throw new InvalidOperationException(message);
        }

        return full;
    }
}

public sealed class WorkflowTreeNode
{
    public string Name { get; init; } = string.Empty;
    public string RelativePath { get; init; } = string.Empty;
    public bool IsFolder { get; init; }
    public ObservableCollection<WorkflowTreeNode> Children { get; } = [];
    public bool IsExpanded { get; set; } = true;
}

public enum WorkflowSlotType
{
    Unknown,
    String,
    Integer,
    Number,
    Boolean,
    Enum,
    File,
}

public enum SlotValueTransport
{
    Json,
    Payload,
}

public enum ChatGptSlotExposure
{
    Hidden,
    ReadOnly,
    Writable,
}

public enum SlotDiscoveryState
{
    NotLoaded,
    Loading,
    Loaded,
    Failed,
}

public sealed class WorkflowSlot
{
    public string Address { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Type { get; set; } = "UNKNOWN";
    public JsonNode? CurrentValue { get; set; }
    public JsonArray? Choices { get; set; }
    public double? Minimum { get; set; }
    public double? Maximum { get; set; }
    public bool PairingSuspect { get; set; }

    public WorkflowSlotType Kind => WorkflowSlotTypeClassifier.Classify(Type);

    public string CurrentText => CurrentValue?.ToJsonString(new JsonSerializerOptions { WriteIndented = false }) ?? string.Empty;
}

public sealed class HandoffSlotSnapshot
{
    public string Address { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public string Type { get; set; } = "UNKNOWN";
    public JsonNode? CurrentValue { get; set; }
    public JsonArray? Choices { get; set; }
    public double? Minimum { get; set; }
    public double? Maximum { get; set; }
    public SlotValueTransport Transport { get; set; }
    public ChatGptSlotExposure Exposure { get; set; }
    public string PolicyReason { get; set; } = string.Empty;

    [JsonIgnore]
    public bool IsWritableByChatGpt => Exposure == ChatGptSlotExposure.Writable;

    [JsonIgnore]
    public WorkflowSlotType Kind => WorkflowSlotTypeClassifier.Classify(Type);
}

public static class WorkflowSlotTypeClassifier
{
    public static WorkflowSlotType Classify(string? type)
    {
        var normalized = (type ?? string.Empty).Trim().ToUpperInvariant();
        if (normalized.Contains("COMBO", StringComparison.Ordinal) || normalized is "ENUM" or "CHOICE") return WorkflowSlotType.Enum;
        return normalized switch
        {
            "STRING" or "TEXT" => WorkflowSlotType.String,
            "INT" or "INTEGER" => WorkflowSlotType.Integer,
            "FLOAT" or "NUMBER" => WorkflowSlotType.Number,
            "BOOLEAN" or "BOOL" => WorkflowSlotType.Boolean,
            "IMAGE" or "FILE" => WorkflowSlotType.File,
            _ => WorkflowSlotType.Unknown,
        };
    }
}

public sealed class PendingHandoffSnapshot
{
    /// <summary>
    /// Purpose captured when the Handoff was issued.  Unknown is retained for
    /// snapshots written before this field existed; PendingHandoffReuse uses
    /// the allowed actions as a compatibility fallback for those records.
    /// </summary>
    public PendingHandoffPurpose Purpose { get; set; } = PendingHandoffPurpose.Unknown;
    public string HandoffId { get; set; } = Guid.NewGuid().ToString("N");
    public string SessionId { get; set; } = string.Empty;
    public string BoundaryId { get; set; } = Guid.NewGuid().ToString("N");
    public List<string> AllowedActions { get; set; } = [];
    public string WorkflowIdentity { get; set; } = string.Empty;
    public string ContextProviderId { get; set; } = string.Empty;
    public string ProjectContextKey { get; set; } = string.Empty;
    public string ChatContextKey { get; set; } = string.Empty;
    public string ProjectLabel { get; set; } = string.Empty;
    public string ChatLabel { get; set; } = string.Empty;
    /// <summary>
    /// The kickoff text captured when this Handoff was issued. A nullable
    /// value keeps snapshots written before this field existed compatible;
    /// an empty string is a deliberate blank kickoff.
    /// </summary>
    public string? KickoffInstruction { get; set; }
    public List<HandoffSlotSnapshot> Slots { get; set; } = [];
    public int Iteration { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    /// <summary>
    /// Request identity for the latest authenticated Browser Extension send.
    /// This is transport metadata only; retrying a Handoff may rotate this
    /// value while Session/Handoff/Boundary and the rendered body remain
    /// unchanged.
    /// </summary>
    public string? LastBrowserExtensionRequestId { get; set; }
}

public sealed class OutputArtifact
{
    public string FileName { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string Type { get; set; } = "unknown";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public bool IsMissing => !File.Exists(FullPath);
    public bool IsImage => IsExtension("png", "jpg", "jpeg", "webp", "bmp", "gif");
    public bool IsVideo => IsExtension("mp4", "webm", "mov", "avi", "mkv");

    private bool IsExtension(params string[] extensions)
        => extensions.Contains(Type.TrimStart('.'), StringComparer.OrdinalIgnoreCase) ||
           extensions.Contains(Path.GetExtension(FullPath).TrimStart('.'), StringComparer.OrdinalIgnoreCase);
}

/// <summary>
/// Output identity reported by ComfyUI for a completed Job.  The filename and
/// subfolder are relative to ComfyUI's output root; a URL is retained only as
/// runtime provenance.  Keeping this separate from <see cref="OutputArtifact"/>
/// lets the Connector resolve the real local file without treating a download
/// staging name (for example, a prompt-id prefix) as the generated filename.
/// </summary>
public sealed class JobOutputReference
{
    public string FileName { get; set; } = string.Empty;
    public string Subfolder { get; set; } = string.Empty;
    public string Type { get; set; } = "output";
    public string? Url { get; set; }

    /// <summary>
    /// A local source path may be supplied by an older runtime.  It is never
    /// sent to ChatGPT and is used only when it is already inside OutputRoot.
    /// </summary>
    [JsonIgnore]
    public string? SourcePath { get; set; }
}

public sealed class JobSnapshot
{
    public string JobId { get; set; } = string.Empty;
    public JobStatus Status { get; set; } = JobStatus.Queued;
    public string? Message { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public List<OutputArtifact> Outputs { get; set; } = [];

    /// <summary>
    /// ComfyUI's filename/subfolder metadata from the latest status response.
    /// This is runtime-only metadata used by WorkflowCatalog to resolve outputs
    /// without flattening workflow-relative directories during download.
    /// </summary>
    [JsonIgnore]
    public List<JobOutputReference> OutputReferences { get; set; } = [];
}

public sealed class ProjectChatBindingSnapshot
{
    public string ProviderId { get; init; } = string.Empty;
    public string? ProjectKey { get; init; }
    public string? ChatKey { get; init; }
    public string? ProjectExternalId { get; init; }
    public string? ChatExternalId { get; init; }
    public string ProjectLabel { get; init; } = string.Empty;
    public string ChatLabel { get; init; } = string.Empty;
}

public sealed class ChatContextOption
{
    public string ProviderId { get; set; } = string.Empty;
    public string ProjectKey { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public ContextBindingMode Mode { get; set; } = ContextBindingMode.Local;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    [JsonIgnore]
    public bool IsCreateAction { get; set; }
}

public sealed class ProjectContextOption
{
    public string ProviderId { get; set; } = string.Empty;
    public string Key { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public ContextBindingMode Mode { get; set; } = ContextBindingMode.Local;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<ChatContextOption> Chats { get; set; } = [];
    [JsonIgnore]
    public bool IsCreateAction { get; set; }
}

public sealed class ProjectChatCatalog
{
    public string ProviderId { get; set; } = string.Empty;
    public List<ProjectContextOption> Projects { get; set; } = [];
}

public sealed class LocalChatContext
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DisplayName { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public ContextBindingMode Mode { get; set; } = ContextBindingMode.Local;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    [JsonIgnore]
    public bool IsCreateAction { get; set; }
}

public sealed class LocalProjectContext
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DisplayName { get; set; } = string.Empty;
    public string? ExternalId { get; set; }
    public ContextBindingMode Mode { get; set; } = ContextBindingMode.Local;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<LocalChatContext> Chats { get; set; } = [];
    [JsonIgnore]
    public bool IsCreateAction { get; set; }
}

public sealed class LocalContextCatalog
{
    public int Version { get; set; } = 2;
    public List<LocalProjectContext> Projects { get; set; } = [];
}

public sealed class HandoffMessage
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public HandoffDirection Direction { get; set; }
    public HandoffMessageKind Kind { get; set; } = HandoffMessageKind.Unknown;
    public HandoffTransportState State { get; set; } = HandoffTransportState.Waiting;
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string Title { get; set; } = string.Empty;
    public string DisplayText { get; set; } = string.Empty;
    public string Metadata { get; set; } = string.Empty;
    // Summary is retained for sessions written before the content-first card model.
    public string Summary { get; set; } = string.Empty;
    public string Payload { get; set; } = string.Empty;
    // Transport diagnostics are intentionally limited to safe identifiers.
    // They let a FAILED card explain which Bridge/Content Script stage failed
    // without persisting the credential or duplicating the Handoff body.
    public string? TransportErrorCode { get; set; }
    public string? TransportErrorStage { get; set; }
    public int? IterationNumber { get; set; }
}

public sealed class CreationStageStatus
{
    public CreationStage Stage { get; set; }
    public CreationStageState State { get; set; } = CreationStageState.NotReached;
    public CreationWaitingReason WaitingReason { get; set; } = CreationWaitingReason.None;
    public string Detail { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CreationPipelineSnapshot
{
    public int Version { get; set; } = 7;
    public int IterationNumber { get; set; }
    public bool ContextBound { get; set; }
    public bool MaximumIterationSafetyStop { get; set; }
    public string? SentIdeaSnapshot { get; set; }
    public string? AcceptedCommandAction { get; set; }
    public GenerateExecutionState GenerateExecutionState { get; set; } = GenerateExecutionState.ReadyToGenerate;
    public AutomaticResponseExecutionSnapshot? AutomaticResponseExecution { get; set; }
    public ReviewHandoffSnapshot? ReviewHandoff { get; set; }
    public AutomaticIterationSnapshot? AutomaticIteration { get; set; }
    public ReviewMediaAttachmentSnapshot? ReviewMediaAttachment { get; set; }
    /// <summary>
    /// The automatic-generation budget is scoped to this Run.  Iteration
    /// history remains session-wide and is never renumbered by Resume.
    /// </summary>
    public CreationRunSnapshot? CurrentRun { get; set; }
    /// <summary>
    /// A validated generate command that was intentionally deferred because
    /// the current Run reached its limit.  The raw command is retained so a
    /// later Resume can APPLY/GENERATE it without re-sending a Handoff.
    /// </summary>
    public DeferredGenerateSnapshot? DeferredGenerate { get; set; }
    public List<CreationStageStatus> Stages { get; set; } = [];
}

/// <summary>
/// Durable per-Run accounting.  Run numbers are user-visible history
/// context, while RunId is used for idempotency and stale-response guards.
/// </summary>
public sealed class CreationRunSnapshot
{
    public string RunId { get; set; } = Guid.NewGuid().ToString("N");
    public int Number { get; set; } = 1;
    public int StartIteration { get; set; }
    public int IterationCount { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public string StartedReason { get; set; } = "initial";
}

/// <summary>
/// Persisted, already validated generate Response waiting for an explicit
/// user Resume after LIMIT_REACHED.  CommandText is intentionally not logged;
/// it is stored only to make recovery deterministic across restarts.
/// </summary>
public sealed class DeferredGenerateSnapshot
{
    public string RunId { get; set; } = string.Empty;
    /// <summary>
    /// The recovery Run created by the first Resume.  Keeping this value makes
    /// repeated Resume clicks/restarts reuse one Run instead of creating a
    /// chain of empty Runs.
    /// </summary>
    public string? RecoveryRunId { get; set; }
    public string SessionId { get; set; } = string.Empty;
    public string RequestId { get; set; } = string.Empty;
    public string HandoffId { get; set; } = string.Empty;
    public string BoundaryId { get; set; } = string.Empty;
    public string CommandText { get; set; } = string.Empty;
    public int Iteration { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum ReviewMediaAttachmentState
{
    None,
    Preparing,
    Attaching,
    Attached,
    Failed,
}

/// <summary>
/// Durable UI/operation state for the temporary Primary Output attachment.
/// It deliberately contains no local filesystem path or media bytes.
/// </summary>
public sealed class ReviewMediaAttachmentSnapshot
{
    public ReviewMediaAttachmentState State { get; set; } = ReviewMediaAttachmentState.None;
    public string SessionId { get; set; } = string.Empty;
    public int Iteration { get; set; }
    public string RequestId { get; set; } = string.Empty;
    public string MediaId { get; set; } = string.Empty;
    public string OutputIdentity { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string MimeType { get; set; } = string.Empty;
    public long Size { get; set; }
    public int? TargetTabId { get; set; }
    public string? TargetTabUrl { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorStage { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Durable identity and terminal state for one automatically processed
/// assistant response. It contains identifiers only, never the Response body,
/// credential, or session token.
/// </summary>
public sealed class AutomaticResponseExecutionSnapshot
{
    public string ResponseKey { get; set; } = string.Empty;
    public string RequestId { get; set; } = string.Empty;
    public string SessionId { get; set; } = string.Empty;
    public string HandoffId { get; set; } = string.Empty;
    public string BoundaryId { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public AutomaticResponseExecutionState State { get; set; } = AutomaticResponseExecutionState.None;
    public string? ErrorCode { get; set; }
    public string? ErrorStage { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Identity and terminal state for the current Review Handoff transport.
/// This contains identifiers only and never the rendered Handoff body.
/// </summary>
public sealed class ReviewHandoffSnapshot
{
    public ReviewHandoffState State { get; set; } = ReviewHandoffState.None;
    public string SessionId { get; set; } = string.Empty;
    public int Iteration { get; set; }
    public string RequestId { get; set; } = string.Empty;
    public string HandoffId { get; set; } = string.Empty;
    public string BoundaryId { get; set; } = string.Empty;
    public int? TargetTabId { get; set; }
    public string? TargetTabUrl { get; set; }
    public string? ErrorCode { get; set; }
    public string? ErrorStage { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Durable loop state.  The response body remains in CHATGPT COMMAND and in
/// the timeline; this projection only records the identity needed to prevent
/// a duplicate response from starting APPLY/GENERATE twice.
/// </summary>
public sealed class AutomaticIterationSnapshot
{
    public AutomaticIterationState State { get; set; } = AutomaticIterationState.None;
    public string SessionId { get; set; } = string.Empty;
    public int Iteration { get; set; }
    public string ReviewHandoffId { get; set; } = string.Empty;
    public string ReviewBoundaryId { get; set; } = string.Empty;
    public string? ErrorCode { get; set; }
    public string? ErrorStage { get; set; }
    public string? ErrorMessage { get; set; }
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class SessionIteration : INotifyPropertyChanged
{
    private List<OutputArtifact> _outputs = [];
    private JobStatus _status = JobStatus.Queued;
    private string? _error;
    public int Number { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string Prompt { get; set; } = string.Empty;
    public Dictionary<string, JsonNode?> Parameters { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public JobStatus Status
    {
        get => _status;
        set
        {
            if (_status == value) return;
            _status = value;
            PropertyChanged?.Invoke(this, new(nameof(Status)));
        }
    }
    public string? JobId { get; set; }
    public string? Error
    {
        get => _error;
        set
        {
            if (string.Equals(_error, value, StringComparison.Ordinal)) return;
            _error = value;
            PropertyChanged?.Invoke(this, new(nameof(Error)));
        }
    }
    public List<OutputArtifact> Outputs
    {
        get => _outputs;
        set
        {
            _outputs = value ?? [];
            PropertyChanged?.Invoke(this, new(nameof(Outputs)));
            PropertyChanged?.Invoke(this, new(nameof(HasOutputs)));
        }
    }
    [JsonIgnore]
    public bool HasOutputs => Outputs.Count > 0;

    public event PropertyChangedEventHandler? PropertyChanged;
}

public sealed class CreationSession
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Title { get; set; } = "新しい制作";
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public string OriginalIdea { get; set; } = string.Empty;
    public string ProjectLabel { get; set; } = string.Empty;
    public string ChatLabel { get; set; } = string.Empty;
    public string? ContextProviderId { get; set; }
    public string? ProjectContextKey { get; set; }
    public string? ChatContextKey { get; set; }
    public string? LocalProjectContextId { get; set; }
    public string? LocalChatContextId { get; set; }
    public string? ProjectId { get; set; }
    public string? ConversationId { get; set; }
    /// <summary>
    /// Browser tab identity returned by the successful initial Handoff.  It
    /// is used only to bind Phase 5.1 media attachment to that same tab.
    /// </summary>
    public int? BrowserExtensionTargetTabId { get; set; }
    public string? BrowserExtensionTargetTabUrl { get; set; }
    public WorkflowIdentity? BoundWorkflow { get; set; }
    public int CurrentIteration { get; set; }
    public int MaximumIterations { get; set; } = 10;
    public SessionStatus Status { get; set; } = SessionStatus.New;
    public List<SessionIteration> Iterations { get; set; } = [];
    public List<HandoffMessage> HandoffMessages { get; set; } = [];
    public CreationPipelineSnapshot Pipeline { get; set; } = new();
    public PendingHandoffSnapshot? PendingHandoff { get; set; }
    public string? LastError { get; set; }
    public string? PauseReason { get; set; }
    public string? CompletionReason { get; set; }

    [JsonIgnore]
    public string EffectiveContextProviderId => string.IsNullOrWhiteSpace(ContextProviderId) ? ContextProviderIds.LocalJson : ContextProviderId;
    [JsonIgnore]
    public string? EffectiveProjectContextKey => string.IsNullOrWhiteSpace(ProjectContextKey) ? LocalProjectContextId : ProjectContextKey;
    [JsonIgnore]
    public string? EffectiveChatContextKey => string.IsNullOrWhiteSpace(ChatContextKey) ? LocalChatContextId : ChatContextKey;
    [JsonIgnore]
    public bool HasBoundProjectChat => !string.IsNullOrWhiteSpace(EffectiveProjectContextKey) && !string.IsNullOrWhiteSpace(EffectiveChatContextKey);

    public ProjectChatBindingSnapshot ToProjectChatBindingSnapshot() => new()
    {
        ProviderId = EffectiveContextProviderId,
        ProjectKey = EffectiveProjectContextKey,
        ChatKey = EffectiveChatContextKey,
        ProjectExternalId = ProjectId,
        ChatExternalId = ConversationId,
        ProjectLabel = ProjectLabel,
        ChatLabel = ChatLabel,
    };

    public bool CanGenerate => Status is SessionStatus.New or SessionStatus.Active or SessionStatus.Paused or SessionStatus.Error;

    /// <summary>
    /// Compatibility name retained for existing callers.  The value now means
    /// the current Run has consumed its per-Run budget, not that the Session's
    /// lifetime history has reached a permanent ceiling.
    /// </summary>
    [JsonIgnore]
    public bool AtIterationLimit => AtRunIterationLimit;

    [JsonIgnore]
    public bool AtRunIterationLimit
        => MaximumIterations > 0
            && (Pipeline.CurrentRun?.IterationCount ?? CurrentIteration) >= MaximumIterations;

    public void Resume()
    {
        Status = SessionStatus.Active;
        PauseReason = null;
        LastError = null;
        CompletionReason = null;
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Starts a new automatic Run without touching the Session identity or
    /// historical iteration numbers.  Callers are responsible for clearing or
    /// re-arming the pipeline stages for the specific Resume path.
    /// </summary>
    public CreationRunSnapshot StartNewRun(string reason)
    {
        var previous = Pipeline.CurrentRun;
        var run = new CreationRunSnapshot
        {
            RunId = Guid.NewGuid().ToString("N"),
            Number = (previous?.Number ?? 0) + 1,
            StartIteration = CurrentIteration,
            IterationCount = 0,
            StartedAt = DateTimeOffset.UtcNow,
            StartedReason = string.IsNullOrWhiteSpace(reason) ? "resume" : reason,
        };
        Pipeline.CurrentRun = run;
        Status = SessionStatus.Active;
        PauseReason = null;
        LastError = null;
        CompletionReason = null;
        UpdatedAt = run.StartedAt;
        return run;
    }

    public SessionIteration StartIteration(string prompt, IDictionary<string, JsonNode?> parameters)
    {
        if (AtRunIterationLimit)
        {
            throw new InvalidOperationException("このRunの最大反復回数に達しています。RESUMEで次のRunを開始してください。");
        }

        Status = SessionStatus.Active;
        CurrentIteration++;
        var iteration = new SessionIteration
        {
            Number = CurrentIteration,
            Prompt = prompt,
            Parameters = new Dictionary<string, JsonNode?>(parameters, StringComparer.OrdinalIgnoreCase),
        };
        Iterations.Add(iteration);
        var run = Pipeline.CurrentRun ??= new CreationRunSnapshot
        {
            RunId = Guid.NewGuid().ToString("N"),
            Number = 1,
            StartIteration = 0,
            StartedReason = "initial",
        };
        run.IterationCount = Math.Max(0, CurrentIteration - run.StartIteration);
        UpdatedAt = DateTimeOffset.UtcNow;
        return iteration;
    }

    public void Complete(string reason)
    {
        Status = SessionStatus.Completed;
        Pipeline.DeferredGenerate = null;
        Pipeline.MaximumIterationSafetyStop = false;
        CompletionReason = reason;
        UpdatedAt = DateTimeOffset.UtcNow;
    }
}

public sealed class ConnectorCommand
{
    public string Protocol { get; init; } = string.Empty;
    public string Action { get; init; } = string.Empty;
    public string HandoffId { get; init; } = string.Empty;
    public string SessionId { get; init; } = string.Empty;
    public JsonObject Slots { get; init; } = [];
    public JsonObject ResolvedSlots { get; init; } = [];
    [JsonIgnore]
    public JsonObject Parameters => ResolvedSlots;
    public string? Reason { get; init; }
}

public sealed class ProtocolValidationResult
{
    public ConnectorCommand? Command { get; set; }
    public string RawResponse { get; set; } = string.Empty;
    public Dictionary<string, string> ResolvedPayloads { get; } = new(StringComparer.Ordinal);
    public List<string> Errors { get; } = [];
    public bool IsValid => Errors.Count == 0 && Command is not null;
    public string UserMessage => IsValid
        ? "Connector Responseを確認しました。"
        : Errors.Any(error => error.Contains("以前のHandoff", StringComparison.Ordinal))
            ? "このCommandは以前のHandoffに対する返答です。現在待機中のChatGPT返答を貼り付けてください。"
            : Errors.FirstOrDefault() ?? "Connector Responseを検証できませんでした。入力内容を確認してください。";
    public string DiagnosticText => string.Join(Environment.NewLine, Errors);
}
