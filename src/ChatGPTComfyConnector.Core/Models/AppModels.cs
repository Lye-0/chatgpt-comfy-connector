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

public enum SessionStatus
{
    New,
    Active,
    Completed,
    Stopped,
    Paused,
    Error,
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
    Failed,
}

public enum CreationStage
{
    Context,
    Idea,
    ToChatGpt,
    Command,
    Apply,
    Generate,
    Output,
    Review,
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
    public string HandoffId { get; set; } = Guid.NewGuid().ToString("N");
    public string SessionId { get; set; } = string.Empty;
    public string BoundaryId { get; set; } = Guid.NewGuid().ToString("N");
    public List<string> AllowedActions { get; set; } = [];
    public string WorkflowIdentity { get; set; } = string.Empty;
    public List<HandoffSlotSnapshot> Slots { get; set; } = [];
    public int Iteration { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
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

public sealed class JobSnapshot
{
    public string JobId { get; set; } = string.Empty;
    public JobStatus Status { get; set; } = JobStatus.Queued;
    public string? Message { get; set; }
    public DateTimeOffset StartedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; set; }
    public List<OutputArtifact> Outputs { get; set; } = [];
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
    public int? IterationNumber { get; set; }
}

public sealed class CreationStageStatus
{
    public CreationStage Stage { get; set; }
    public CreationStageState State { get; set; } = CreationStageState.NotReached;
    public string Detail { get; set; } = string.Empty;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class CreationPipelineSnapshot
{
    public int Version { get; set; } = 1;
    public int IterationNumber { get; set; }
    public bool ContextBound { get; set; }
    public bool MaximumIterationSafetyStop { get; set; }
    public string? SentIdeaSnapshot { get; set; }
    public string? AcceptedCommandAction { get; set; }
    public List<CreationStageStatus> Stages { get; set; } = [];
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
    public bool AtIterationLimit => CurrentIteration >= MaximumIterations;

    public void Resume()
    {
        Status = SessionStatus.Active;
        PauseReason = null;
        LastError = null;
        UpdatedAt = DateTimeOffset.UtcNow;
    }

    public SessionIteration StartIteration(string prompt, IDictionary<string, JsonNode?> parameters)
    {
        if (AtIterationLimit)
        {
            throw new InvalidOperationException("最大反復回数に達しています。続行する場合は上限を明示的に変更してください。");
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
        UpdatedAt = DateTimeOffset.UtcNow;
        return iteration;
    }

    public void Complete(string reason)
    {
        Status = SessionStatus.Completed;
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
