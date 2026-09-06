namespace ChatGPTComfyConnector.Core.Services;

public sealed record ComfyMcpRuntimePaths(string McpExecutablePath, string CliExecutablePath)
{
    public static ComfyMcpRuntimePaths Resolve(string configuredMcpPath)
    {
        var candidate = Directory.Exists(configuredMcpPath)
            ? Path.Combine(configuredMcpPath, ".venv", "Scripts", "comfy-mcp.exe")
            : configuredMcpPath;
        if (!File.Exists(candidate)) throw new InvalidOperationException("comfy-mcp.exeが存在しません。");

        var mcpExecutablePath = Path.GetFullPath(candidate);
        var cliExecutablePath = Path.Combine(Path.GetDirectoryName(mcpExecutablePath)!, "comfy.exe");
        if (!File.Exists(cliExecutablePath))
            throw new InvalidOperationException("comfy-mcp.exeと同じフォルダーにcomfy.exeが存在しません。comfy-mcp-runtimeの場所を確認してください。");

        return new(mcpExecutablePath, cliExecutablePath);
    }
}
