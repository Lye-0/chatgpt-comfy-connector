using System.ComponentModel;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class HandoffTimelineItem : INotifyPropertyChanged
{
    public HandoffTimelineItem(HandoffMessage message) => Message = message;

    public HandoffMessage Message { get; }
    public string Id => Message.Id;
    public string DirectionLabel => Message.Direction == HandoffDirection.ChatGptToComfy ? "CHATGPT → COMFY" : "COMFY → CHATGPT";
    public string TimeText => Message.CreatedAt.ToLocalTime().ToString("HH:mm");
    public string Title => Message.Title;
    public string Summary => Message.Summary;
    public string Payload => Message.Payload;
    public string StateLabel => Message.State.ToString().ToUpperInvariant();
    public bool IsChatGptToComfy => Message.Direction == HandoffDirection.ChatGptToComfy;
    public bool IsComfyToChatGpt => Message.Direction == HandoffDirection.ComfyToChatGpt;
    public string CopyToolTip => IsComfyToChatGpt ? "ChatGPTへ渡す内容をコピー" : "Connector用Commandをコピー";

    public void MarkCopied()
    {
        Message.State = HandoffTransportState.Copied;
        PropertyChanged?.Invoke(this, new(nameof(StateLabel)));
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}
