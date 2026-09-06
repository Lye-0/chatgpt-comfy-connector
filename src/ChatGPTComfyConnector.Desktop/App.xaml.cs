using System.Windows;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Bridge;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Desktop;

/// <summary>
/// Application composition root. The Bridge lifetime is owned by the Desktop
/// process rather than by a view so it starts/stops with the application.
/// </summary>
public partial class App : Application
{
    private IBrowserExtensionBridge? _browserExtensionBridge;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var pairingStore = new PortableStore(new PortableLayout(AppContext.BaseDirectory));
        _browserExtensionBridge = new BrowserExtensionBridge(pairingStore: pairingStore);
        var window = new MainWindow(_browserExtensionBridge);
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try { _browserExtensionBridge?.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
        finally { base.OnExit(e); }
    }
}
