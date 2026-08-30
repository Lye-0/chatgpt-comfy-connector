namespace ChatGPTComfyConnector.Tests;

public sealed class HistoryThumbnailBoundaryTests
{
    [Fact]
    public void HistoryCaptureNeverCachesAPlaybackFallbackThatIsStillBlank()
    {
        var source = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml.cs");

        Assert.Contains("if (frame is not null && !IsLikelyBlankFrame(frame))", source, StringComparison.Ordinal);
        Assert.Contains("return null;", source[source.IndexOf("private async Task<BitmapSource?> CaptureMediaFrameWhenReadyAsync", StringComparison.Ordinal)..], StringComparison.Ordinal);
        Assert.DoesNotContain("return CaptureVisualFrame(media);", source, StringComparison.Ordinal);
    }

    [Fact]
    public void HistoryThumbnailCaptureWaitsForDecoderReadinessAndHasAVisibleFailureState()
    {
        var code = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml.cs");
        var xaml = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml");
        var item = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "ViewModels", "GenerationHistoryItem.cs");

        Assert.Contains("NaturalVideoWidth", code, StringComparison.Ordinal);
        Assert.Contains("NaturalVideoHeight", code, StringComparison.Ordinal);
        Assert.Contains("HistoryVideoMediaLoaded", xaml, StringComparison.Ordinal);
        Assert.Contains("ShowThumbnailUnavailable", xaml, StringComparison.Ordinal);
        Assert.Contains("MarkThumbnailUnavailable", code, StringComparison.Ordinal);
        Assert.Contains("ShowThumbnailMedia", item, StringComparison.Ordinal);
    }

    private static string ReadRepoFile(params string[] parts)
    {
        var path = Path.Combine([AppContext.BaseDirectory, "..", "..", "..", "..", "..", .. parts]);
        return File.ReadAllText(Path.GetFullPath(path));
    }
}
