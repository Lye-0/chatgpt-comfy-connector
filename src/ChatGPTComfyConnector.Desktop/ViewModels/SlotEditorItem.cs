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
        Choices = slot.Choices?.Select(x => x?.ToString() ?? string.Empty).ToArray() ?? [];
        _valueText = Format(slot.CurrentValue);
        PairingSuspect = slot.PairingSuspect;
    }

    public string Address { get; }
    public string Label { get; }
    public string Type { get; }
    public WorkflowSlotType Kind { get; }
    public IReadOnlyList<string> Choices { get; }
    public bool PairingSuspect { get; }
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

    public event PropertyChangedEventHandler? PropertyChanged;
    private void OnPropertyChanged([CallerMemberName] string? propertyName = null) => PropertyChanged?.Invoke(this, new(propertyName));
}
