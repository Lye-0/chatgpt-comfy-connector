using System.ComponentModel;
using System.Text.RegularExpressions;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class HandoffTimelineItem : INotifyPropertyChanged
{
    private const int TooltipLimit = 1100;

    public HandoffTimelineItem(HandoffMessage message) => Message = message;

    public HandoffMessage Message { get; }
    public string Id => Message.Id;
    public string DirectionLabel => Message.Direction switch
    {
        HandoffDirection.ConnectorToChatGpt => "CONNECTOR → CHATGPT",
        HandoffDirection.ChatGptToComfy => "CHATGPT → COMFY",
        HandoffDirection.ComfyToChatGpt => "COMFY → CHATGPT",
        _ => "CONNECTOR → CHATGPT",
    };
    public string TimeText => Message.CreatedAt.ToLocalTime().ToString("HH:mm");
    public string KindLabel => Message.Kind switch
    {
        HandoffMessageKind.CreationRequest => "制作リクエストを送信",
        HandoffMessageKind.GenerationCommand => "生成指示",
        HandoffMessageKind.GenerationResult => "生成結果を送信",
        HandoffMessageKind.ReviewRequest => "レビュー用情報を送信",
        HandoffMessageKind.RegenerationCommand => "再生成指示",
        HandoffMessageKind.Complete => "制作完了の指示",
        _ => string.IsNullOrWhiteSpace(Message.Title) ? "Handoffメッセージ" : Message.Title,
    };
    public string DisplayText => NormalizeForDisplay(
        string.IsNullOrWhiteSpace(Message.DisplayText) ? Message.Summary : Message.DisplayText);
    public string BodyTooltip => LimitTooltip(
        string.IsNullOrWhiteSpace(Message.DisplayText) ? Message.Summary : Message.DisplayText);
    public string MetadataText => NormalizeForDisplay(Message.Metadata);
    public string Summary => Message.Summary;
    public string Payload => Message.Payload;
    public string StateLabel => Message.State.ToString().ToUpperInvariant();
    public bool IsCopied => Message.State == HandoffTransportState.Copied;
    public bool IsConnectorToChatGpt => Message.Direction == HandoffDirection.ConnectorToChatGpt;
    public bool IsChatGptToComfy => Message.Direction == HandoffDirection.ChatGptToComfy;
    public bool IsComfyToChatGpt => Message.Direction == HandoffDirection.ComfyToChatGpt;
    public string CopyToolTip => Message.Direction switch
    {
        HandoffDirection.ConnectorToChatGpt => "ChatGPTへ送る全文をコピー",
        HandoffDirection.ChatGptToComfy => "Connector Command全文をコピー",
        HandoffDirection.ComfyToChatGpt => "生成結果Context全文をコピー",
        _ => "Handoff全文をコピー",
    };

    public void MarkCopied()
    {
        Message.State = HandoffTransportState.Copied;
        PropertyChanged?.Invoke(this, new(nameof(StateLabel)));
        PropertyChanged?.Invoke(this, new(nameof(IsCopied)));
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private static string NormalizeForDisplay(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        var normalized = value.Replace("\r\n", "\n", StringComparison.Ordinal).Replace('\r', '\n');
        var lines = normalized
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(line => Regex.Replace(line.Trim(), "\\s+", " "))
            .Where(line => line.Length > 0);
        return string.Join(" ", lines).Trim();
    }

    private static string LimitTooltip(string? value)
    {
        var normalized = NormalizeForDisplay(value);
        return normalized.Length <= TooltipLimit ? normalized : normalized[..TooltipLimit].TrimEnd() + "…";
    }
}
