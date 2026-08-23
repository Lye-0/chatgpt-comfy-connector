using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Desktop.ViewModels;

namespace ChatGPTComfyConnector.Desktop;

public partial class MainWindow : Window
{
    private MainViewModel ViewModel => (MainViewModel)DataContext;

    public MainWindow()
    {
        InitializeComponent();
        DataContext = new MainViewModel(AppContext.BaseDirectory);
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e) => await ViewModel.InitializeAsync();

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
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
        ViewModel.DisconnectAsync().GetAwaiter().GetResult();
    }

    private async void SaveSetup_Click(object sender, RoutedEventArgs e) => await Run("設定保存", ViewModel.SaveSetupAsync);
    private void Setup_Click(object sender, RoutedEventArgs e) => ViewModel.ShowSetup();
    private void OpenWorkflowEditor_Click(object sender, RoutedEventArgs e) => ViewModel.ShowWorkflowEditor();
    private void CloseWorkflowEditor_Click(object sender, RoutedEventArgs e) => ViewModel.HideWorkflowEditor();
    private async void Connect_Click(object sender, RoutedEventArgs e) => await Run("MCP接続", ViewModel.ConnectAsync);
    private void StartComfy_Click(object sender, RoutedEventArgs e) => RunSync("ComfyUI起動", ViewModel.StartComfyUi);
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
    private void NewSession_Click(object sender, RoutedEventArgs e) => ViewModel.CreateNewSession();
    private async void Resume_Click(object sender, RoutedEventArgs e) => await Run("セッション再開", ViewModel.ResumeSessionAsync);
    private async void ImportCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド検証", ViewModel.ImportCommandAsync);
    private async void ApplyCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド適用", () => ViewModel.ApplyCommandAsync(false));
    private async void ApplyGenerateCommand_Click(object sender, RoutedEventArgs e) => await Run("コマンド適用 + 生成", () => ViewModel.ApplyCommandAsync(true));
    private async void CopyBootstrap_Click(object sender, RoutedEventArgs e) { await ViewModel.SaveSessionAsync(); Clipboard.SetText(ViewModel.BuildBootstrapContext()); ViewModel.StatusMessage = "ChatGPTへ送る内容をコピーしました。ChatGPTへ貼り付けてください。"; }
    private void CopyIdea_Click(object sender, RoutedEventArgs e) { Clipboard.SetText(ViewModel.Idea ?? string.Empty); ViewModel.StatusMessage = "制作アイデアをクリップボードへコピーしました。ChatGPTへ貼り付けてください。"; }
    private void CopyResult_Click(object sender, RoutedEventArgs e) { Clipboard.SetText(ViewModel.BuildResultContext()); ViewModel.StatusMessage = "生成結果をChatGPT用にコピーしました。必要な画像・動画を手動で添付してください。"; }
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

    private void FocusWorkflowRenameBox()
    {
        Dispatcher.BeginInvoke(DispatcherPriority.Input, new Action(() =>
        {
            WorkflowRenameBox.Focus();
            WorkflowRenameBox.SelectAll();
        }));
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
