using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using ChatGPTComfyConnector.Desktop.Behaviors;

namespace ChatGPTComfyConnector.Desktop;

public partial class MainWindow
{
    private ComboBox? _guideOpenSelector;
    private bool _guideSelectorCancelled;

    private void GuideSelector_Opened(object? sender, EventArgs args)
    {
        _guideOpenSelector = sender as ComboBox;
        _guideSelectorCancelled = false;
        RefreshGuideInteraction();
    }
    private async void ProjectGuideSelector_Closed(object? sender, EventArgs args)
    {
        var confirm = ReferenceEquals(_guideOpenSelector, sender) && !_guideSelectorCancelled;
        _guideOpenSelector = null;
        RefreshGuideInteraction();
        if (confirm) await Run("Project確認", ViewModel.ConfirmProjectForGuidanceAsync);
    }
    private void ChatGuideSelector_Closed(object? sender, EventArgs args)
    {
        var confirm = ReferenceEquals(_guideOpenSelector, sender) && !_guideSelectorCancelled;
        _guideOpenSelector = null;
        RefreshGuideInteraction();
        if (confirm) ViewModel.ConfirmChatForGuidance();
    }
    private void GuidePreviewKeyDown(object sender, KeyEventArgs args)
    {
        if (args.Key == Key.Escape && _guideOpenSelector is not null) _guideSelectorCancelled = true;
    }
    private void GuideFocusChanged(object sender, KeyboardFocusChangedEventArgs args)
        => Dispatcher.BeginInvoke(RefreshGuideInteraction, DispatcherPriority.Input);
    private void MaximumIterations_ValidationError(object sender, ValidationErrorEventArgs args)
        => ViewModel.HasMaximumIterationsInputError = Validation.GetHasError((DependencyObject)sender);
    private void RefreshGuideInteraction()
    {
        var focus = Keyboard.FocusedElement as DependencyObject;
        var editing = false;
        while (focus is not null)
        {
            if (focus is TextBoxBase or PasswordBox) { editing = true; break; }
            focus = focus is Visual ? VisualTreeHelper.GetParent(focus) : LogicalTreeHelper.GetParent(focus);
        }
        GuideHighlight.SetIsInteractionActive(this, editing || _guideOpenSelector is not null);
    }
}
