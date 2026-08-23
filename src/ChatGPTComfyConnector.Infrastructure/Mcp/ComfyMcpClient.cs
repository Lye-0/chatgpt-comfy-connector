using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;

namespace ChatGPTComfyConnector.Infrastructure.Mcp;

public sealed class ComfyMcpClient : IComfyMcpClient
{
    private const string ComfyMcpProtocolVersion = "2025-06-18";
    private readonly IPortableStore _store;
    private McpClient? _client;
    private StdioClientTransport? _transport;
    private readonly List<string> _toolNames = [];

    public ComfyMcpClient(IPortableStore store) => _store = store;

    public bool IsConnected => _client is not null;
    public ConnectionState State { get; private set; } = ConnectionState.Disconnected;
    public IReadOnlyList<string> ToolNames => _toolNames;

    public async Task ConnectAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        await DisconnectAsync(cancellationToken);
        State = ConnectionState.Connecting;
        if (!File.Exists(settings.ComfyMcpPath)) throw new FileNotFoundException("comfy-mcp executableが見つかりません。", settings.ComfyMcpPath);

        var comfyRoot = Path.Combine(settings.PortableRoot, "ComfyUI");
        var env = StdioClientTransportOptions.GetDefaultEnvironmentVariables();
        env["COMFY_BIN"] = settings.ComfyCliPath ?? Path.Combine(Path.GetDirectoryName(settings.ComfyMcpPath)!, "comfy.exe");
        env["COMFY_PROJECT"] = comfyRoot;
        env["COMFYUI_URL"] = settings.Endpoint;
        env["COMFYUI_HOST"] = new Uri(settings.Endpoint).Host;

        _transport = new StdioClientTransport(new StdioClientTransportOptions
        {
            Command = settings.ComfyMcpPath,
            Arguments = [],
            WorkingDirectory = Path.GetDirectoryName(settings.ComfyMcpPath),
            EnvironmentVariables = env,
            InheritEnvironmentVariables = false,
            ShutdownTimeout = TimeSpan.FromSeconds(10),
            Name = "chatgpt-comfy-connector",
            StandardErrorLines = line => _ = _store.LogAsync("mcp.stderr", line),
        });

        try
        {
            _client = await McpClient.CreateAsync(
                _transport,
                new McpClientOptions { ProtocolVersion = ComfyMcpProtocolVersion },
                cancellationToken: cancellationToken);
            var tools = await _client.ListToolsAsync(cancellationToken: cancellationToken);
            _toolNames.Clear();
            _toolNames.AddRange(tools.Select(t => t.Name));
            State = ConnectionState.Connected;
            await _store.LogAsync("mcp", $"connected; tools={string.Join(',', _toolNames)}", cancellationToken: cancellationToken);
        }
        catch (ClientTransportClosedException ex)
        {
            State = ConnectionState.Error;
            var diagnostics = ex.Details is StdioClientCompletionDetails stdio
                ? FormatStdioDiagnostics(stdio)
                : $"details={ex.Details.GetType().Name}";
            await _store.LogAsync("mcp.transport", $"stdio transport closed during connect: {diagnostics}", ex, cancellationToken);
            await DisposeResourcesAsync();
            throw new InvalidOperationException($"comfy-mcp stdio transportが終了しました。{diagnostics}", ex);
        }
        catch (ModelContextProtocol.UnsupportedProtocolVersionException ex)
        {
            State = ConnectionState.Error;
            var diagnostics = $"requested={ex.Requested}; supported={string.Join(", ", ex.Supported)}";
            await _store.LogAsync("mcp.protocol", $"MCP protocol negotiation failed: {diagnostics}; message={ex.Message}", ex, cancellationToken);
            await DisposeResourcesAsync();
            throw new InvalidOperationException($"MCP protocol versionが一致しません。{diagnostics}", ex);
        }
        catch
        {
            State = ConnectionState.Error;
            await DisposeResourcesAsync();
            throw;
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        await DisposeResourcesAsync();
        State = ConnectionState.Disconnected;
        await Task.CompletedTask;
    }

    public async Task<JsonNode?> CallAsync(string toolName, IReadOnlyDictionary<string, object?> arguments, CancellationToken cancellationToken = default)
    {
        var client = _client ?? throw new InvalidOperationException("MCPに接続されていません。");
        if (!_toolNames.Contains(toolName, StringComparer.Ordinal)) throw new InvalidOperationException($"MCP toolが見つかりません: {toolName}");
        try
        {
            var result = await client.CallToolAsync(toolName, arguments, cancellationToken: cancellationToken);
            var text = string.Join(Environment.NewLine, result.Content.OfType<TextContentBlock>().Select(c => c.Text));
            if (result.IsError == true) throw new InvalidOperationException(string.IsNullOrWhiteSpace(text) ? $"MCP tool failed: {toolName}" : text);

            if (result.StructuredContent is not null)
            {
                var structuredText = JsonSerializer.Serialize(result.StructuredContent);
                if (JsonNode.Parse(structuredText) is JsonNode structured) return structured;
            }

            if (!string.IsNullOrWhiteSpace(text))
            {
                try { return JsonNode.Parse(text); }
                catch (JsonException) { return JsonValue.Create(text); }
            }

            return null;
        }
        catch (ClientTransportClosedException ex)
        {
            State = ConnectionState.Error;
            var diagnostics = ex.Details is StdioClientCompletionDetails stdio
                ? FormatStdioDiagnostics(stdio)
                : $"details={ex.Details.GetType().Name}";
            await _store.LogAsync("mcp.transport", $"stdio transport closed during {toolName}: {diagnostics}", ex, cancellationToken);
            await DisposeResourcesAsync();
            throw new InvalidOperationException($"comfy-mcp stdio transportが終了しました。{diagnostics}", ex);
        }
    }

    public async ValueTask DisposeAsync() => await DisconnectAsync();

    private async Task DisposeResourcesAsync()
    {
        var client = _client;
        _client = null;
        _toolNames.Clear();
        if (client is not null)
        {
            try { await client.DisposeAsync(); } catch (Exception ex) { await _store.LogAsync("mcp", "client dispose failed", ex); }
        }
        _transport = null;
    }

    private static string FormatStdioDiagnostics(StdioClientCompletionDetails details)
    {
        var stderr = details.StandardErrorTail is { Count: > 0 }
            ? string.Join(" | ", details.StandardErrorTail)
            : "(empty)";
        return $"pid={details.ProcessId?.ToString() ?? "unknown"}; exitCode={details.ExitCode?.ToString() ?? "unknown"}; stderr={stderr}";
    }
}
