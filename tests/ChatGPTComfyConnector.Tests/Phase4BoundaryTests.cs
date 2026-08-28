using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Tests;

public sealed class Phase4BoundaryTests
{
    [Fact]
    public void AutomaticResponsePathUsesDesktopStrictValidationAndExistingApplyGenerateMethods()
    {
        var source = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "ViewModels", "MainViewModel.cs");
        var responseHandlerStart = source.IndexOf(
            "private async Task HandleBrowserExtensionAssistantResponseAsync",
            StringComparison.Ordinal);
        var automaticHandlerStart = source.IndexOf(
            "private async Task ExecuteBrowserExtensionCommandAutomaticallyAsync",
            responseHandlerStart,
            StringComparison.Ordinal);
        var automaticHandlerEnd = source.IndexOf(
            "private async Task FailAutomaticResponseAsync",
            automaticHandlerStart,
            StringComparison.Ordinal);

        Assert.True(responseHandlerStart >= 0);
        Assert.True(automaticHandlerStart > responseHandlerStart);
        Assert.True(automaticHandlerEnd > automaticHandlerStart);

        var responseHandler = source[responseHandlerStart..automaticHandlerStart];
        var automaticHandler = source[automaticHandlerStart..automaticHandlerEnd];

        Assert.Contains("BrowserExtensionResponseCorrelation.Validate", responseHandler, StringComparison.Ordinal);
        Assert.Contains("AutomaticResponseExecutionCoordinator.TryBegin", responseHandler, StringComparison.Ordinal);
        Assert.Contains("await ImportCommandAsync()", automaticHandler, StringComparison.Ordinal);
        Assert.Contains("ApplyCommandCoreAsync", automaticHandler, StringComparison.Ordinal);
        Assert.Contains("GenerateAsync(applyFirst: false)", source, StringComparison.Ordinal);
        Assert.Contains("AutomaticResponseExecutionCoordinator.MarkFailed", source, StringComparison.Ordinal);
        // ConnectorProtocol.Parse is intentionally reached through the same
        // ImportCommandAsync path as the manual Command action, not copied into
        // the automatic handler as a second parser.
        Assert.DoesNotContain("ConnectorProtocol.Parse", automaticHandler, StringComparison.Ordinal);
    }

    [Fact]
    public void SystemConnectionAndCommandUiExposePhase4StatesWithoutRemovingManualControls()
    {
        var xaml = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml");
        var viewModel = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "ViewModels", "MainViewModel.cs");
        var releaseWorkflow = ReadRepoFile(".github", "workflows", "release.yml");

        var connector = xaml.IndexOf("AutomationProperties.Name=\"Connector\"", StringComparison.Ordinal);
        var mcp = xaml.IndexOf("AutomationProperties.Name=\"MCP\"", StringComparison.Ordinal);
        var extension = xaml.IndexOf("AutomationProperties.Name=\"Extension\"", StringComparison.Ordinal);
        var comfyUi = xaml.IndexOf("AutomationProperties.Name=\"ComfyUI\"", StringComparison.Ordinal);
        var gpu = xaml.IndexOf("AutomationProperties.Name=\"GPU\"", StringComparison.Ordinal);

        Assert.True(connector >= 0 && connector < mcp && mcp < extension && extension < comfyUi && comfyUi < gpu);
        Assert.Contains("IsBrowserExtensionPairingCodeVisible", xaml, StringComparison.Ordinal);
        Assert.Contains("BuildIdentityText", xaml, StringComparison.Ordinal);
        Assert.Contains("GenerateExecutionStateText", xaml, StringComparison.Ordinal);
        Assert.Contains("AutomaticResponseExecutionText", xaml, StringComparison.Ordinal);
        Assert.Contains("TransportFailureText", xaml, StringComparison.Ordinal);
        Assert.Contains("読み込んで確認", xaml, StringComparison.Ordinal);
        Assert.Contains("適用して生成", xaml, StringComparison.Ordinal);
        Assert.Contains("HandoffTransportState.Completed", viewModel, StringComparison.Ordinal);
        Assert.Contains("SourceRevisionId=$env:GITHUB_SHA", releaseWorkflow, StringComparison.Ordinal);
    }

    [Fact]
    public void CompletedSessionResumeKeepsHistoryAndInvalidatesOldBoundary()
    {
        var source = ReadRepoFile("src", "ChatGPTComfyConnector.Core", "Services", "CreationPipelineStateMachine.cs");

        Assert.Contains("var invalidatesConsumedReviewHandoff", source, StringComparison.Ordinal);
        Assert.Contains("session.PendingHandoff = null", source, StringComparison.Ordinal);
        Assert.Contains("SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate)", source, StringComparison.Ordinal);
        Assert.True(Enum.TryParse<HandoffTransportState>("Completed", out _));
    }

    private static string ReadRepoFile(params string[] parts)
    {
        var path = Path.Combine([AppContext.BaseDirectory, "..", "..", "..", "..", "..", .. parts]);
        return File.ReadAllText(Path.GetFullPath(path));
    }
}
