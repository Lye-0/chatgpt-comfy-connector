using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Copies an Output Viewer artifact without changing the ComfyUI output.
/// The desktop layer owns the save dialog; this service keeps the actual copy
/// operation deterministic and testable, including a no-silent-overwrite
/// guarantee.
/// </summary>
public static class OutputCopyService
{
    public static void Copy(OutputArtifact output, string destinationPath, bool overwrite = false)
    {
        ArgumentNullException.ThrowIfNull(output);

        if (string.IsNullOrWhiteSpace(output.FullPath))
            throw new InvalidOperationException("表示中のOutputを特定できません。");

        var source = Path.GetFullPath(output.FullPath);
        if (!File.Exists(source))
            throw new FileNotFoundException("表示中のOutputファイルが見つかりません。", source);
        if (string.IsNullOrWhiteSpace(destinationPath))
            throw new InvalidOperationException("保存先を指定してください。");

        var destination = Path.GetFullPath(destinationPath);
        if (string.Equals(source, destination, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("保存先は元のOutputとは異なる場所を指定してください。");

        // The desktop SaveFileDialog performs the user-facing overwrite
        // confirmation and passes overwrite=true only after the user accepts
        // it.  Callers without that explicit confirmation remain
        // non-destructive by default.
        File.Copy(source, destination, overwrite);
    }
}
