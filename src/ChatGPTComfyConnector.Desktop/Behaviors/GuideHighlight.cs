using System.ComponentModel;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Desktop.Behaviors;

/// <summary>A decorative, non-interactive frame. It never changes a control's template, selection or layout.</summary>
public static class GuideHighlight
{
    public static readonly DependencyProperty TargetProperty = DependencyProperty.RegisterAttached(
        "Target", typeof(CreationGuideTarget), typeof(GuideHighlight), new PropertyMetadata(CreationGuideTarget.None, Changed));
    public static readonly DependencyProperty CurrentProperty = DependencyProperty.RegisterAttached(
        "Current", typeof(CreationGuideTarget), typeof(GuideHighlight), new FrameworkPropertyMetadata(CreationGuideTarget.None, FrameworkPropertyMetadataOptions.Inherits, Changed));
    public static readonly DependencyProperty ItemIdProperty = DependencyProperty.RegisterAttached(
        "ItemId", typeof(string), typeof(GuideHighlight), new PropertyMetadata(null, Changed));
    public static readonly DependencyProperty CurrentItemIdProperty = DependencyProperty.RegisterAttached(
        "CurrentItemId", typeof(string), typeof(GuideHighlight), new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.Inherits, Changed));
    public static readonly DependencyProperty IsInteractionActiveProperty = DependencyProperty.RegisterAttached(
        "IsInteractionActive", typeof(bool), typeof(GuideHighlight), new FrameworkPropertyMetadata(false, FrameworkPropertyMetadataOptions.Inherits, Changed));
    private static readonly DependencyProperty StateProperty = DependencyProperty.RegisterAttached("State", typeof(HighlightState), typeof(GuideHighlight));

    public static CreationGuideTarget GetTarget(DependencyObject element) => (CreationGuideTarget)element.GetValue(TargetProperty);
    public static void SetTarget(DependencyObject element, CreationGuideTarget value) => element.SetValue(TargetProperty, value);
    public static CreationGuideTarget GetCurrent(DependencyObject element) => (CreationGuideTarget)element.GetValue(CurrentProperty);
    public static void SetCurrent(DependencyObject element, CreationGuideTarget value) => element.SetValue(CurrentProperty, value);
    public static string? GetItemId(DependencyObject element) => (string?)element.GetValue(ItemIdProperty);
    public static void SetItemId(DependencyObject element, string? value) => element.SetValue(ItemIdProperty, value);
    public static string? GetCurrentItemId(DependencyObject element) => (string?)element.GetValue(CurrentItemIdProperty);
    public static void SetCurrentItemId(DependencyObject element, string? value) => element.SetValue(CurrentItemIdProperty, value);
    public static bool GetIsInteractionActive(DependencyObject element) => (bool)element.GetValue(IsInteractionActiveProperty);
    public static void SetIsInteractionActive(DependencyObject element, bool value) => element.SetValue(IsInteractionActiveProperty, value);

    private static void Changed(DependencyObject sender, DependencyPropertyChangedEventArgs args)
    {
        if (sender is not FrameworkElement element) return;
        var state = (HighlightState?)element.GetValue(StateProperty);
        if (state is null && GetTarget(element) != CreationGuideTarget.None)
        {
            state = new(element);
            element.SetValue(StateProperty, state);
        }
        state?.Update();
    }

    private sealed class HighlightState
    {
        private readonly FrameworkElement _element;
        private AdornerLayer? _layer;
        private FrameAdorner? _adorner;
        private bool _subscribed;

        public HighlightState(FrameworkElement element)
        {
            _element = element;
            element.Loaded += Loaded;
            element.Unloaded += Unloaded;
            element.IsEnabledChanged += (_, _) => Update();
            element.IsVisibleChanged += (_, _) => Update();
            if (element.IsLoaded) Subscribe();
        }

        public void Update()
        {
            var target = GetTarget(_element);
            var active = target != CreationGuideTarget.None && target == GetCurrent(_element)
                && (target != CreationGuideTarget.Handoff || GetItemId(_element) is { } id && id == GetCurrentItemId(_element));
            if (!active || !_element.IsLoaded || !_element.IsVisible || !_element.IsEnabled)
            {
                Remove();
                return;
            }
            if (_adorner is null)
            {
                _layer = AdornerLayer.GetAdornerLayer(_element);
                if (_layer is null) return;
                _adorner = new(_element);
                _layer.Add(_adorner);
            }
            _adorner.SetPulse(SystemParameters.ClientAreaAnimation && !GetIsInteractionActive(_element));
        }

        private void Loaded(object sender, RoutedEventArgs args)
        {
            Subscribe();
            Update();
            if (_adorner is null) _element.Dispatcher.BeginInvoke(Update, DispatcherPriority.Loaded);
        }
        private void Subscribe()
        {
            if (_subscribed) return;
            SystemParameters.StaticPropertyChanged += SystemParametersChanged;
            _subscribed = true;
        }
        private void Unloaded(object sender, RoutedEventArgs args)
        {
            if (_subscribed) SystemParameters.StaticPropertyChanged -= SystemParametersChanged;
            _subscribed = false;
            Remove();
        }
        private void SystemParametersChanged(object? sender, PropertyChangedEventArgs args)
        {
            if (args.PropertyName != nameof(SystemParameters.ClientAreaAnimation)) return;
            if (_element.Dispatcher.CheckAccess()) Update();
            else _element.Dispatcher.BeginInvoke(Update);
        }
        private void Remove()
        {
            if (_adorner is null) return;
            _adorner.SetPulse(false);
            _layer?.Remove(_adorner);
            _adorner = null;
            _layer = null;
        }
    }

    private sealed class FrameAdorner : Adorner
    {
        private readonly Border _frame;
        private bool? _pulsing;
        public FrameAdorner(FrameworkElement element) : base(element)
        {
            IsHitTestVisible = false;
            Focusable = false;
            _frame = new Border
            {
                BorderBrush = element.TryFindResource("AccentBrush") as Brush ?? Brushes.Turquoise,
                BorderThickness = new Thickness(2),
                CornerRadius = element is Border border ? border.CornerRadius : new CornerRadius(7),
                IsHitTestVisible = false,
            };
            AddVisualChild(_frame);
        }
        public void SetPulse(bool pulse)
        {
            if (_pulsing == pulse) return;
            _pulsing = pulse;
            _frame.BeginAnimation(OpacityProperty, null);
            _frame.Opacity = 1;
            if (pulse) _frame.BeginAnimation(OpacityProperty, new DoubleAnimation(.25, 1, TimeSpan.FromSeconds(1))
            {
                AutoReverse = true,
                RepeatBehavior = RepeatBehavior.Forever,
                EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut },
            });
        }
        protected override int VisualChildrenCount => 1;
        protected override Visual GetVisualChild(int index) => index == 0 ? _frame : throw new ArgumentOutOfRangeException(nameof(index));
        protected override Size MeasureOverride(Size constraint) { _frame.Measure(AdornedElement.RenderSize); return AdornedElement.RenderSize; }
        protected override Size ArrangeOverride(Size finalSize) { _frame.Arrange(new Rect(-2, -2, finalSize.Width + 4, finalSize.Height + 4)); return finalSize; }
    }
}
