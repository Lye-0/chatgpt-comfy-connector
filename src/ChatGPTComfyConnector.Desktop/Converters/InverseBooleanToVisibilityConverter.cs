using System.Globalization;
using System.Windows;
using System.Windows.Data;

namespace ChatGPTComfyConnector.Desktop.Converters;

public sealed class InverseBooleanToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => value is bool flag && !flag ? Visibility.Visible : Visibility.Collapsed;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => value is Visibility visibility && visibility != Visibility.Visible;
}
