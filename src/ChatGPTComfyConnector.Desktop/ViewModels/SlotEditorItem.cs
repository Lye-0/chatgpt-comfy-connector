using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed class SlotEditorItem : INotifyPropertyChanged
{
    private string _valueText;

    public SlotEditorItem(WorkflowSlot slot)
    {
        Address = slot.Address;
        Label = slot.Label;
        Type = slot.Type;
        Kind = slot.Kind;
        CurrentValue = slot.CurrentValue?.DeepClone();
        Minimum = slot.Minimum;
        Maximum = slot.Maximum;
        Choices = slot.Choices?.Select(x => x?.ToString() ?? string.Empty).ToArray() ?? [];
        _valueText = Format(slot.CurrentValue);
        PairingSuspect = slot.PairingSuspect;
        Priority = Classify(slot);
    }

    public string Address { get; }
    public string Label { get; }
    public string Type { get; }
    public WorkflowSlotType Kind { get; }
    public JsonNode? CurrentValue { get; }
    public double? Minimum { get; }
    public double? Maximum { get; }
    public IReadOnlyList<string> Choices { get; }
    public bool PairingSuspect { get; }
    public SlotPriority Priority { get; }
    public bool IsPrimary => Priority == SlotPriority.Primary;
    public bool IsTuning => Priority == SlotPriority.Tuning;
    public bool IsAdvanced => Priority == SlotPriority.Advanced;
    public bool HasChoices => Choices.Count > 0;
    public string PriorityLabel => Priority switch
    {
        SlotPriority.Primary => "主要設定",
        SlotPriority.Tuning => "調整",
        _ => "詳細設定",
    };
    public string ValueText
    {
        get => _valueText;
        set { if (_valueText == value) return; _valueText = value; OnPropertyChanged(); }
    }

    public JsonNode? ToJsonNode()
    {
        return Kind switch
        {
            WorkflowSlotType.Integer when int.TryParse(ValueText, out var integer) => JsonValue.Create(integer),
            WorkflowSlotType.Number when double.TryParse(ValueText, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var number) => JsonValue.Create(number),
            WorkflowSlotType.Boolean when bool.TryParse(ValueText, out var boolean) => JsonValue.Create(boolean),
            WorkflowSlotType.String or WorkflowSlotType.Enum or WorkflowSlotType.File => JsonValue.Create(ValueText),
            _ => TryParseUnknown(ValueText),
        };
    }

    private static JsonNode? TryParseUnknown(string value)
    {
        try { return JsonNode.Parse(value); } catch (System.Text.Json.JsonException) { return JsonValue.Create(value); }
    }

    private static string Format(JsonNode? value)
    {
        if (value is JsonValue jsonValue && jsonValue.TryGetValue<string>(out var text)) return text;
        return value?.ToJsonString() ?? string.Empty;
    }

    private static SlotPriority Classify(WorkflowSlot slot)
    {
        var text = $"{slot.Address} {slot.Label}".ToLowerInvariant();
        if (PrimaryTokens.Any(text.Contains) || (slot.Kind == WorkflowSlotType.File && FileInputTokens.Any(text.Contains))) return SlotPriority.Primary;
        if (TuningTokens.Any(text.Contains)) return SlotPriority.Tuning;
        return SlotPriority.Advanced;
    }

    private static readonly string[] PrimaryTokens =
    [
        "prompt", "positive", "negative", "text", "idea", "description",
        "duration", "length", "seconds", "frames", "fps", "aspect", "ratio",
        "resolution", "megapixel", "seed", "width", "height", "size",
    ];

    private static readonly string[] FileInputTokens =
    ["image", "input", "reference", "first", "last", "init", "source", "start", "end"];

    private static readonly string[] TuningTokens =
    ["steps", "step", "denoise", "cfg", "guidance", "batch", "count", "samples", "noise"];

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) => PropertyChanged?.Invoke(this, new(propertyName));
}

public enum SlotPriority
{
    Primary,
    Tuning,
    Advanced,
}
