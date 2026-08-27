using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Desktop.ViewModels;

namespace ChatGPTComfyConnector.Desktop;

public partial class MainWindow : Window
{
    private readonly DispatcherTimer _comfyUiStatusTimer = new() { Interval = TimeSpan.FromSeconds(5) };
    private bool _refreshingComfyUiStatus;
    private bool _closeAfterDisconnect;
    private bool _disconnectingForClose;
    private MainViewModel ViewModel => (MainViewModel)DataContext;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel(AppContext.BaseDirectory);
        IdeaInputBox.AddHandler(TextCompositionManager.PreviewTextInputStartEvent,
            new TextCompositionEventHandler(IdeaInput_TextInputStart), true);
        IdeaInputBox.AddHandler(TextCompositionManager.PreviewTextInputUpdateEvent,
            new TextCompositionEventHandler(IdeaInput_TextInputUpdate), true);
        IdeaInputBox.AddHandler(TextCompositionManager.PreviewTextInputEvent,
            new TextCompositionEventHandler(IdeaInput_TextInput), true);
        IdeaInputBox.AddHandler(TextCompositionManager.TextInputStartEvent,
            new TextCompositionEventHandler(IdeaInput_TextInputStart), true);
        IdeaInputBox.AddHandler(TextCompositionManager.TextInputUpdateEvent,
            new TextCompositionEventHandler(IdeaInput_TextInputUpdate), true);
        IdeaInputBox.AddHandler(TextCompositionManager.TextInputEvent,
            new TextCompositionEventHandler(IdeaInput_TextInput), true);
        IdeaInputBox.TextChanged += IdeaInput_TextChanged;
        IdeaInputBox.AddHandler(Keyboard.PreviewKeyDownEvent,
            new KeyEventHandler(IdeaInput_PreviewKeyDown), true);
        IdeaInputBox.LostKeyboardFocus += IdeaInput_LostKeyboardFocus;
        IdeaInputBox.IsEnabledChanged += IdeaInput_IsEnabledChanged;
        _comfyUiStatusTimer.Tick += ComfyUiStatusTimer_Tick;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        HideSystemConnectionSeparators();
        _comfyUiStatusTimer.Start();
        await ViewModel.InitializeAsync();
    }

    private async void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_closeAfterDisconnect)
        {
            _comfyUiStatusTimer.Stop();
            return;
        }
        if (ViewModel.IsDirty)
        {
            MessageBox.Show("未保存のWorkflow変更があります。保存してから終了してください。", "未保存変更", MessageBoxButton.OK, MessageBoxImage.Warning);
            e.Cancel = true;
            return;
        }
        if (ViewModel.IsJobActive && MessageBox.Show("生成中です。Connectorを終了すると監視だけ停止し、ComfyUI側の生成は継続します。終了しますか？", "生成中", MessageBoxButton.YesNo, MessageBoxImage.Warning) != MessageBoxResult.Yes)
        {
            e.Cancel = true;
            return;
        }
        _comfyUiStatusTimer.Stop();
        e.Cancel = true;
        if (_disconnectingForClose) return;
        _disconnectingForClose = true;
        try
        {
            await ViewModel.DisconnectAsync();
            _closeAfterDisconnect = true;
            Application.Current.Shutdown();
        }
        catch (Exception ex)
        {
            _disconnectingForClose = false;
            MessageBox.Show(ex.Message, "MCP切断", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void SaveSetup_Click(object sender, RoutedEventArgs e) => await Run("設定保存", ViewModel.SaveSetupAsync);
    private void Setup_Click(object sender, RoutedEventArgs e) => ViewModel.ShowSetup();
    private void OpenWorkflowEditor_Click(object sender, RoutedEventArgs e) => ViewModel.ShowWorkflowEditor();
    private void CloseWorkflowEditor_Click(object sender, RoutedEventArgs e) => ViewModel.HideWorkflowEditor();
    private async void Connect_Click(object sender, RoutedEventArgs e) => await Run("MCP接続", ViewModel.ConnectAsync);
    private async void StartComfy_Click(object sender, RoutedEventArgs e) => await Run("ComfyUI起動", ViewModel.StartComfyUiAsync);
    private void Refresh_Click(object sender, RoutedEventArgs e) => ViewModel.RefreshWorkflowTree();
    private void OpenWorkflowFolder_Click(object sender, RoutedEventArgs e) => OpenFolder(ViewModel.WorkflowRoot);
    private async void RetryWorkflow_Click(object sender, RoutedEventArgs e)
    {
        if (ViewModel.SelectedWorkflow is not null) await Run("Workflow再読み込み", () => ViewModel.SelectWorkflowAsync(ViewModel.SelectedWorkflow.RelativePath));
    }

    private async void WorkflowTree_SelectedItemChanged(object sender, RoutedPropertyChangedEventArgs<object> e)
    {
        if (e.NewValue is not WorkflowTreeNode node || node.IsFolder) return;
        if (ViewModel.IsDirty)
        {
            var answer = MessageBox.Show("未保存の変更があります。Yes=保存して切替 / No=破棄して切替 / Cancel=維持", "Workflow切替", MessageBoxButton.YesNoCancel, MessageBoxImage.Warning);
            if (answer == MessageBoxResult.Cancel) return;
            if (answer == MessageBoxResult.Yes) await Run("保存", ViewModel.ApplySlotsAsync); else ViewModel.DiscardChanges();
        }
        await Run("Workflow選択", () => ViewModel.SelectWorkflowAsync(node.RelativePath));
    }

    private async void Save_Click(object sender, RoutedEventArgs e) => await Run("Workflow保存", ViewModel.ApplySlotsAsync);
    private async void Validate_Click(object sender, RoutedEventArgs e) => await Run("Workflowのvalidate", ViewModel.ValidateCurrentAsync);
    private async void Generate_Click(object sender, RoutedEventArgs e) => await Run("生成", () => ViewModel.GenerateAsync());
    private async void CancelJob_Click(object sender, RoutedEventArgs e) => await Run("JobのCANCEL", ViewModel.CancelJobAsync);
    private async void Restore_Click(object sender, RoutedEventArgs e) { if (BackupCombo.SelectedItem is string path) await Run("復元", () => ViewModel.RestoreBackupAsync(path)); }
    private async void Duplicate_Click(object sender, RoutedEventArgs e)
    {
        await Run("Workflow複製", ViewModel.DuplicateWorkflowAndBeginRenameAsync);
        if (ViewModel.IsWorkflowRenameVisible) FocusWorkflowRenameBox();
    }

    private void Rename_Click(object sender, RoutedEventArgs e)
    {
        ViewModel.BeginWorkflowRename();
        if (ViewModel.IsWorkflowRenameVisible) FocusWorkflowRenameBox();
    }

    private async void WorkflowRenameBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            ViewModel.CancelWorkflowRename();
            e.Handled = true;
            return;
        }
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            await Run("Workflow名前変更", ViewModel.CommitWorkflowRenameAsync);
            if (!ViewModel.IsWorkflowRenameVisible) WorkflowTree.Focus();
        }
    }
    private async void NewSession_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.HasPendingContextChange)
        {
            await Run("新しい制作", ViewModel.StartNewCreationAsync);
            return;
        }
        var answer = MessageBox.Show(
            "現在の制作セッションと異なるContextが選択されています。\n\nYes: 現在のセッションへ反映\nNo: 新しい制作として開始\nCancel: 変更しない",
            "制作Contextの変更",
            MessageBoxButton.YesNoCancel,
            MessageBoxImage.Question);
        if (answer == MessageBoxResult.Yes) await Run("Context変更", ViewModel.ApplySelectedContextToCurrentSessionAsync);
        else if (answer == MessageBoxResult.No) await Run("新しい制作", ViewModel.StartNewCreationAsync);
    }
    private async void CreateProject_Click(object sender, RoutedEventArgs e) => await Run("Project作成", ViewModel.CreateProjectAsync);
    private void CancelProjectCreation_Click(object sender, RoutedEventArgs e) => ViewModel.CancelProjectCreation();
    private async void CreateChat_Click(object sender, RoutedEventArgs e) => await Run("Chat作成", ViewModel.CreateChatAsync);
    private void CancelChatCreation_Click(object sender, RoutedEventArgs e) => ViewModel.CancelChatCreation();
    private async void Resume_Click(object sender, RoutedEventArgs e) => await Run("セッション再開", ViewModel.ResumeSessionAsync);
    private async void ImportCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド検証", ViewModel.ImportCommandAsync);
    private async void ApplyCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド適用", () => ViewModel.ApplyCommandAsync(false));
    private async void ApplyGenerateCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド適用 + 生成", () => ViewModel.ApplyCommandAsync(true));
    private async void CopyBootstrap_Click(object sender, RoutedEventArgs e)
    {
        await Run("ChatGPTへ送信", async () =>
        {
            Clipboard.SetText(await ViewModel.PrepareBootstrapHandoffAsync());
            await ViewModel.ConfirmBootstrapCopiedAsync(Clipboard.GetText());
            ViewModel.StatusMessage = "制作コンテキストをコピーしました。ChatGPTへ貼り付けてください。";
        });
    }
    private async void CopyHandoff_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not FrameworkElement { Tag: HandoffTimelineItem item }) return;
        await Run("Handoffをコピー", async () =>
        {
            Clipboard.SetText(await ViewModel.PrepareTimelineHandoffAsync(item));
            await ViewModel.MarkHandoffCopiedAsync(item);
        });
    }
    private async void ContinueIteration_Click(object sender, RoutedEventArgs e) => await Run("Iteration続行", ViewModel.ContinueBeyondIterationLimitAsync);
    private async void EndIteration_Click(object sender, RoutedEventArgs e) => await Run("制作終了", ViewModel.EndAtIterationLimitAsync);
    private async void CopyResult_Click(object sender, RoutedEventArgs e)
    {
        await Run("生成結果をコピー", async () =>
        {
            Clipboard.SetText(await ViewModel.PrepareResultHandoffAsync(ViewModel.SelectedHistoryItem?.Iteration));
            ViewModel.StatusMessage = "生成結果をChatGPT用にコピーしました。必要な画像・動画を手動で添付してください。";
        });
    }
    private void OpenOutput_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string path }) RunSync("出力を開く", () => ViewModel.OpenOutputFile(path));
    }

    private void OpenOutputFolder_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { Tag: string path }) RunSync("出力フォルダを開く", () => ViewModel.OpenOutputFolder(path));
    }

    private void OutputImageFailed(object sender, ExceptionRoutedEventArgs e)
        => ViewModel.StatusMessage = "画像プレビューに失敗しました。OPENでOSの既定アプリを使用できます。";

    private void OutputMediaFailed(object sender, ExceptionRoutedEventArgs e)
        => ViewModel.StatusMessage = "動画プレビューに対応していません。OPENでOSの既定アプリを使用できます。";

    private void OpenLogs_Click(object sender, RoutedEventArgs e) => OpenFolder(Path.Combine(AppContext.BaseDirectory, "logs"));

    private async void ComfyUiStatusTimer_Tick(object? sender, EventArgs e)
    {
        if (_refreshingComfyUiStatus) return;
        _refreshingComfyUiStatus = true;
        try
        {
            // ComfyUI is probed directly even when MCP is disconnected. This
            // keeps the independent SYSTEM CONNECTION facts current and also
            // detects a ComfyUI instance started outside Connector.
            await ViewModel.RefreshComfyUiStatusAsync();
        }
        catch
        {
            // The next tick will retry. Connection failures are handled by the
            // ViewModel and should not surface as an unhandled async-void error.
        }
        finally
        {
            _refreshingComfyUiStatus = false;
        }
    }

    private void FocusWorkflowRenameBox()
    {
        Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
        {
            WorkflowRenameBox.Focus();
            WorkflowRenameBox.SelectAll();
        }));
    }

    private void IdeaInput_TextInputStart(object sender, TextCompositionEventArgs e)
        => ViewModel.SetIdeaCompositionState(true);

    private void IdeaInput_TextInputUpdate(object sender, TextCompositionEventArgs e)
        => ViewModel.SetIdeaCompositionState(true);

    private void IdeaInput_TextInput(object sender, TextCompositionEventArgs e)
    {
        // Some IMEs raise TextInput before the composed text has been copied
        // into TextBox.Text. Keep the placeholder hidden until TextChanged
        // confirms that the committed value is actually present.
        if (IdeaInputBox.Text.Length > 0) ViewModel.SetIdeaCompositionState(false);
    }

    private void IdeaInput_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (sender is TextBox { Text.Length: > 0 }) ViewModel.SetIdeaCompositionState(false);
    }

    private void IdeaInput_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            ViewModel.SetIdeaCompositionState(false);
            return;
        }

        // TextCompositionManager is the primary IME signal, but a few
        // Windows IME configurations expose the first composition keystroke
        // only through PreviewKeyDown. Hide the watermark at that point so
        // it cannot remain behind the in-progress composition string.
        if (IdeaInputBox.Text.Length == 0 && IsTextEntryKey(e.Key, Keyboard.Modifiers))
        {
            ViewModel.SetIdeaCompositionState(true);
        }
    }

    private static bool IsTextEntryKey(Key key, ModifierKeys modifiers)
    {
        if ((modifiers & (ModifierKeys.Control | ModifierKeys.Alt | ModifierKeys.Windows)) != 0) return false;
        return key is (>= Key.A and <= Key.Z)
            or (>= Key.D0 and <= Key.D9)
            or (>= Key.NumPad0 and <= Key.NumPad9)
            or Key.Space
            or Key.Oem1
            or Key.Oem2
            or Key.Oem3
            or Key.Oem4
            or Key.Oem5
            or Key.Oem6
            or Key.Oem7
            or Key.Oem8
            or Key.OemComma
            or Key.OemMinus
            or Key.OemPeriod
            or Key.OemPlus;
    }

    private void IdeaInput_LostKeyboardFocus(object sender, KeyboardFocusChangedEventArgs e)
        => ViewModel.SetIdeaCompositionState(false);

    private void IdeaInput_IsEnabledChanged(object sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.NewValue is false) ViewModel.SetIdeaCompositionState(false);
    }

    private void HideSystemConnectionSeparators()
    {
        var systemConnection = FindVisualChild<Border>(this, static border =>
            AutomationProperties.GetName(border) == "SYSTEM CONNECTION");
        if (systemConnection is null) return;
        HideOnePixelBorders(systemConnection);
    }

    private static T? FindVisualChild<T>(DependencyObject root, Predicate<T> predicate) where T : DependencyObject
    {
        var childCount = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < childCount; i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is T typed && predicate(typed)) return typed;

            var nested = FindVisualChild(child, predicate);
            if (nested is not null) return nested;
        }
        return null;
    }

    private static void HideOnePixelBorders(DependencyObject root)
    {
        var childCount = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < childCount; i++)
        {
            var child = VisualTreeHelper.GetChild(root, i);
            if (child is Border border && Math.Abs(border.Height - 1d) < 0.01)
            {
                border.Visibility = Visibility.Collapsed;
            }
            HideOnePixelBorders(child);
        }
    }

    private async Task Run(string title, Func<Task> operation)
    {
        try { await operation(); }
        catch (Exception ex) { MessageBox.Show(ex.Message, title, MessageBoxButton.OK, MessageBoxImage.Warning); }
    }

    private void RunSync(string title, Action operation)
    {
        try { operation(); }
        catch (Exception ex) { MessageBox.Show(ex.Message, title, MessageBoxButton.OK, MessageBoxImage.Warning); }
    }

    private static void OpenFolder(string path)
    {
        if (!Directory.Exists(path)) Directory.CreateDirectory(path);
        Process.Start(new ProcessStartInfo("explorer.exe", $"\"{path}\"") { UseShellExecute = true });
    }
}
