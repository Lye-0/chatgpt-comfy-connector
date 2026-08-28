using System.Globalization;
using System.Windows;
using System.Windows.Data;
using System.Windows.Media;

namespace ChatGPTComfyConnector.Desktop.Converters;

/// <summary>
/// Maps the small, user-facing state vocabulary used by the connection topology
/// and creation pipeline to the app's dark-theme brushes. Keeping this mapping in
/// one place means state is never communicated by text colour alone in the view.
/// </summary>
public sealed class StateToBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var state = value?.ToString()?.Trim().ToUpperInvariant() ?? string.Empty;
        var resourceKey = state switch
        {
            "CONNECTED" or "ONLINE" or "READY" or "DONE" or "SUCCESS" or "COMPLETE" or "COMPLETED" or "SENT" => "SuccessBrush",
            "PROCESSING" or "NOW" or "CURRENT" or "INPROGRESS" => "AccentStrongBrush",
            "CONNECTING" or "STARTING" or "WAITING" or "WAITINGUSER" or "WARNING" or "ATTENTION" => "WarningBrush",
            "ERROR" or "FAILED" => "DangerBrush",
            "DISCONNECTED" or "STOPPED" or "UNKNOWN" or "NOTREACHED" or "CANCELLED" or "SKIPPED" or "—" or "-" => "MutedTextBrush",
            _ => "LineStrongBrush",
        };

        return Application.Current?.TryFindResource(resourceKey) as Brush
            ?? Brushes.Gray;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture)
        => Binding.DoNothing;
}
