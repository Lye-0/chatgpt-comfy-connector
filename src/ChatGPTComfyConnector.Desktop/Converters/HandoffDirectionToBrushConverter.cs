using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;
using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.Converters;

/// <summary>
/// Resolves the semantic colour of a Timeline message from its transport
/// direction.  Direction is deliberately separate from the message transport
/// state: a failed CHATGPT → COMFY message is still a purple direction card,
/// while its ERROR badge is coloured by <see cref="StateToBrushConverter"/>.
/// </summary>
public sealed class HandoffDirectionToBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (!TryGetDirection(value, out var direction))
        {
            return FindBrush("MutedTextBrush");
        }

        var resourceKey = direction switch
        {
            HandoffDirection.ConnectorToChatGpt => "HandoffConnectorBrush",
            HandoffDirection.ChatGptToComfy => "HandoffChatGptBrush",
            HandoffDirection.ComfyToChatGpt => "HandoffComfyBrush",
            _ => "MutedTextBrush",
        };

        return FindBrush(resourceKey);
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;

    private static bool TryGetDirection(object? value, out HandoffDirection direction)
    {
        if (value is HandoffDirection typed)
        {
            direction = typed;
            return true;
        }

        return Enum.TryParse(value?.ToString(), ignoreCase: true, out direction);
    }

    private static Brush FindBrush(string resourceKey)
        => Application.Current?.TryFindResource(resourceKey) as Brush ?? Brushes.Gray;
}
