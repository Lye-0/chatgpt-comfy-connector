using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class OutputCopyTests : IDisposable
{
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "connector-output-copy-" + Guid.NewGuid().ToString("N"));

    public OutputCopyTests() => Directory.CreateDirectory(_temp);

    [Fact]
    public void CopiesTheDisplayedArtifactWithoutChangingTheSource()
    {
        var source = Path.Combine(_temp, "source.mp4");
        var destination = Path.Combine(_temp, "saved", "scene.mp4");
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        File.WriteAllText(source, "video-bytes");
        var output = new OutputArtifact { FileName = "scene.mp4", FullPath = source, Type = "mp4" };

        OutputCopyService.Copy(output, destination);

        Assert.Equal("video-bytes", File.ReadAllText(source));
        Assert.Equal("video-bytes", File.ReadAllText(destination));
    }

    [Fact]
    public void DoesNotSilentlyOverwriteAnExistingDestination()
    {
        var source = Path.Combine(_temp, "source.png");
        var destination = Path.Combine(_temp, "saved.png");
        File.WriteAllText(source, "new");
        File.WriteAllText(destination, "existing");
        var output = new OutputArtifact { FileName = "source.png", FullPath = source, Type = "png" };

        Assert.Throws<IOException>(() => OutputCopyService.Copy(output, destination));
        Assert.Equal("existing", File.ReadAllText(destination));
    }

    [Fact]
    public void ExplicitOverwriteIsAvailableAfterTheSaveDialogConfirmation()
    {
        var source = Path.Combine(_temp, "source.webm");
        var destination = Path.Combine(_temp, "saved.webm");
        File.WriteAllText(source, "new");
        File.WriteAllText(destination, "existing");
        var output = new OutputArtifact { FileName = "source.webm", FullPath = source, Type = "webm" };

        OutputCopyService.Copy(output, destination, overwrite: true);

        Assert.Equal("new", File.ReadAllText(destination));
    }

    [Fact]
    public void MissingDisplayedArtifactIsReportedAsAUserFacingFileError()
    {
        var output = new OutputArtifact
        {
            FileName = "missing.webp",
            FullPath = Path.Combine(_temp, "missing.webp"),
            Type = "webp",
        };

        var exception = Assert.Throws<FileNotFoundException>(() => OutputCopyService.Copy(output, string.Empty));

        Assert.Contains("表示中のOutputファイルが見つかりません", exception.Message, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(_temp)) Directory.Delete(_temp, recursive: true);
    }
}
