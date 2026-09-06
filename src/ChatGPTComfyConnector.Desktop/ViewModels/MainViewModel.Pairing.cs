using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Desktop.ViewModels;

public sealed partial class MainViewModel
{
    private bool _isResettingBrowserExtensionPairing;

    private bool IsBrowserExtensionPairingBusy
    {
        get
        {
            lock (_browserExtensionResponseGate)
            {
                return IsBusy || CanCancelOperation || IsChatSelectorLoading
                    || _isChatBinding || _isResumeInProgress
                    || _browserExtensionSendRequests.Count > 0
                    || ReviewMediaAttachment?.State is ReviewMediaAttachmentState.Preparing or ReviewMediaAttachmentState.Attaching;
            }
        }
    }

    public bool CanResetBrowserExtensionPairing => IsSetupVisible && CanEditSetup
        && IsBrowserExtensionBridgeRunning && !IsBrowserExtensionPairingBusy;

    public string BrowserExtensionPairingHelpText => _isResettingBrowserExtensionPairing
        ? "新しいペアリングコードを発行しています…"
        : !IsBrowserExtensionBridgeRunning
            ? "拡張機能の接続サービスが停止しています。Connectorを再起動してください。"
            : IsBrowserExtensionPairingBusy
                ? "制作や送受信の処理中は変更できません。制作を止める場合は、SETUPを閉じてCANCELを押してください。"
                : IsBrowserExtensionConnected
                    ? "拡張機能に接続しています。"
                    : IsBrowserExtensionPairingCodeVisible
                        ? "このコードを接続したい拡張機能に入力し、PAIR DESKTOPを押してください。有効期限は発行から10分です。"
                        : "拡張機能の更新や再インストール後に、接続し直せます。";

    public async Task ResetBrowserExtensionPairingAsync()
    {
        if (_isResettingBrowserExtensionPairing) return;
        if (!CanResetBrowserExtensionPairing)
            throw new InvalidOperationException("処理が完了してから、SETUPで拡張機能を再ペアリングしてください。");

        _isResettingBrowserExtensionPairing = true;
        OnPropertyChanged(nameof(CanEditSetup));
        NotifyBrowserExtensionPairingControls();
        try
        {
            await _browserExtensionBridge.ResetPairingAsync();
            StatusMessage = "新しいペアリングコードを発行しました。接続したい拡張機能でPAIR DESKTOPを押してください。";
        }
        finally
        {
            _isResettingBrowserExtensionPairing = false;
            OnPropertyChanged(nameof(CanEditSetup));
            NotifyBrowserExtensionPairingControls();
        }
    }

    private void NotifyBrowserExtensionPairingControls()
    {
        OnPropertyChanged(nameof(CanResetBrowserExtensionPairing));
        OnPropertyChanged(nameof(BrowserExtensionPairingHelpText));
    }
}
