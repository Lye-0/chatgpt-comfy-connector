using System.Net;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;
using ChatGPTComfyConnector.Infrastructure.Bridge;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Tests;

public sealed class BrowserExtensionBridgeTests
{
    private const string ExtensionOrigin = "chrome-extension://abcdefghijklmnop";
    private const string EdgeExtensionOrigin = "extension://abcdefghijklmnop";

    [Fact]
    public void ManifestIsChromiumMv3CompatibleForChromeAndEdge()
    {
        var manifestPath = Path.Combine(AppContext.BaseDirectory, "browser-extension", "manifest.json");
        using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
        var root = document.RootElement;

        Assert.Equal(3, root.GetProperty("manifest_version").GetInt32());
        Assert.Equal("background.js", root.GetProperty("background").GetProperty("service_worker").GetString());
        Assert.Equal("popup.html", root.GetProperty("action").GetProperty("default_popup").GetString());
        Assert.Contains("http://127.0.0.1:43127/*", root.GetProperty("host_permissions").EnumerateArray().Select(value => value.GetString()));
        Assert.Contains(root.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()), value => value == "alarms");
        Assert.Contains(root.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()), value => value == "storage");
    }

    [Fact]
    public void BackgroundUsesPairingAndBootstrapInsteadOfHealthToken()
    {
        var sourcePath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "browser-extension", "background.js");
        var source = File.ReadAllText(Path.GetFullPath(sourcePath));
        var healthStart = source.IndexOf("async function fetchHealth", StringComparison.Ordinal);
        var pairingStart = source.IndexOf("async function fetchPairing", StringComparison.Ordinal);

        Assert.True(healthStart >= 0);
        Assert.True(pairingStart > healthStart);
        Assert.DoesNotContain("session_token", source[healthStart..pairingStart], StringComparison.Ordinal);
        Assert.Contains("/api/v1/pair", source, StringComparison.Ordinal);
        Assert.Contains("/api/v1/bootstrap", source, StringComparison.Ordinal);
        Assert.Contains("fetchBootstrap(pairing.credential)", source, StringComparison.Ordinal);
        Assert.Contains("token: nextSessionToken", source, StringComparison.Ordinal);
        Assert.Contains("X-Connector-Client", source, StringComparison.Ordinal);
        Assert.Contains("status: connectionFailureState(error)", source, StringComparison.Ordinal);
        Assert.Contains("desktop_unavailable", source, StringComparison.Ordinal);
    }

    [Fact]
    public async Task HealthIsMetadataOnlyAndNeverIssuesSessionToken()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();

        using var localResponse = await client.GetAsync($"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.HealthPath}");
        Assert.Equal(HttpStatusCode.OK, localResponse.StatusCode);
        using var localHealth = await JsonDocument.ParseAsync(await localResponse.Content.ReadAsStreamAsync());
        Assert.Equal("127.0.0.1", localHealth.RootElement.GetProperty("bind_address").GetString());
        Assert.Equal(BrowserExtensionBridgeProtocol.ProtocolVersion, localHealth.RootElement.GetProperty("protocol").GetString());
        Assert.False(localHealth.RootElement.TryGetProperty("session_token", out _));

        using var extensionRequest = new HttpRequestMessage(HttpMethod.Get, $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.HealthPath}");
        extensionRequest.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
        using var extensionResponse = await client.SendAsync(extensionRequest);
        Assert.Equal(HttpStatusCode.OK, extensionResponse.StatusCode);
        using var extensionHealth = await JsonDocument.ParseAsync(await extensionResponse.Content.ReadAsStreamAsync());
        Assert.Equal("pairing-credential", extensionHealth.RootElement.GetProperty("auth").GetProperty("scheme").GetString());
        Assert.False(extensionHealth.RootElement.TryGetProperty("session_token", out _));

        using var edgeRequest = new HttpRequestMessage(HttpMethod.Get, $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.HealthPath}");
        edgeRequest.Headers.TryAddWithoutValidation("Origin", EdgeExtensionOrigin);
        using var edgeResponse = await client.SendAsync(edgeRequest);
        Assert.Equal(HttpStatusCode.OK, edgeResponse.StatusCode);
        Assert.Equal(EdgeExtensionOrigin, edgeResponse.Headers.GetValues("Access-Control-Allow-Origin").Single());

        using var browserRequest = new HttpRequestMessage(HttpMethod.Get, $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.HealthPath}");
        browserRequest.Headers.TryAddWithoutValidation("Origin", "https://example.invalid");
        using var browserResponse = await client.SendAsync(browserRequest);
        Assert.Equal(HttpStatusCode.Forbidden, browserResponse.StatusCode);
    }

    [Fact]
    public async Task EdgeExtensionOriginCanUsePairingWithTheExplicitClientHeader()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        using var request = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}",
            JsonSerializer.Serialize(new { pairing_code = bridge.Status.PairingCode }));
        request.Headers.Remove("Origin");
        request.Headers.TryAddWithoutValidation("Origin", EdgeExtensionOrigin);

        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(EdgeExtensionOrigin, response.Headers.GetValues("Access-Control-Allow-Origin").Single());
    }

    [Fact]
    public async Task PairingBootstrapIssuesSessionTokenOnlyAfterCredentialExchange()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var pairingCode = bridge.Status.PairingCode;
        Assert.False(string.IsNullOrWhiteSpace(pairingCode));

        using var invalidPair = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}",
            "{\"pairing_code\":\"AAAA-BBBB-CCCC\"}");
        using var invalidPairResponse = await client.SendAsync(invalidPair);
        Assert.Equal(HttpStatusCode.Unauthorized, invalidPairResponse.StatusCode);

        using var pairRequest = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}",
            JsonSerializer.Serialize(new { pairing_code = pairingCode }),
            includeOrigin: false);
        using var pairResponse = await client.SendAsync(pairRequest);
        Assert.Equal(HttpStatusCode.OK, pairResponse.StatusCode);
        using var pair = await JsonDocument.ParseAsync(await pairResponse.Content.ReadAsStreamAsync());
        var pairingId = pair.RootElement.GetProperty("pairing_id").GetString();
        var pairingCredential = pair.RootElement.GetProperty("pairing_credential").GetString();
        Assert.False(string.IsNullOrWhiteSpace(pairingId));
        Assert.False(string.IsNullOrWhiteSpace(pairingCredential));
        Assert.NotNull(store.Record);
        Assert.Equal(pairingId, store.Record!.PairingId);
        Assert.NotEqual(pairingCredential, store.Record.CredentialHash);
        Assert.Equal(BrowserExtensionPairingState.Paired, bridge.Status.PairingState);
        Assert.Null(bridge.Status.PairingCode);

        using var bootstrapRequest = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.BootstrapPath}",
            "{}",
            includeOrigin: false);
        bootstrapRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", pairingCredential);
        using var bootstrapResponse = await client.SendAsync(bootstrapRequest);
        Assert.Equal(HttpStatusCode.OK, bootstrapResponse.StatusCode);
        using var bootstrap = await JsonDocument.ParseAsync(await bootstrapResponse.Content.ReadAsStreamAsync());
        Assert.Equal(BrowserExtensionBridgeProtocol.ProtocolVersion, bootstrap.RootElement.GetProperty("protocol").GetString());
        var sessionToken = bootstrap.RootElement.GetProperty("session_token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(sessionToken));
        Assert.True(bootstrap.RootElement.TryGetProperty("session_expires_at", out _));

        using var healthRequest = new HttpRequestMessage(HttpMethod.Get, $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.HealthPath}");
        healthRequest.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
        using var healthResponse = await client.SendAsync(healthRequest);
        using var health = await JsonDocument.ParseAsync(await healthResponse.Content.ReadAsStreamAsync());
        Assert.False(health.RootElement.TryGetProperty("session_token", out _));

        using var wrongBootstrap = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.BootstrapPath}",
            "{}");
        wrongBootstrap.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "wrong-credential");
        using var wrongBootstrapResponse = await client.SendAsync(wrongBootstrap);
        Assert.Equal(HttpStatusCode.Unauthorized, wrongBootstrapResponse.StatusCode);
    }

    [Fact]
    public async Task PortableStorePersistsPairingVerifierAcrossBridgeInstances()
    {
        var root = Path.Combine(Path.GetTempPath(), $"chatgpt-comfy-connector-pairing-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        try
        {
            var firstStore = new PortableStore(new PortableLayout(root));
            await using var firstBridge = new BrowserExtensionBridge(0, firstStore);
            await firstBridge.StartAsync();
            using var client = CreateHttpClient();
            var credential = await PairAsync(client, firstBridge);
            var firstSession = await BootstrapAsync(client, firstBridge, credential);
            await firstBridge.StopAsync();

            var persisted = await firstStore.LoadBrowserExtensionPairingAsync();
            Assert.NotNull(persisted);
            Assert.NotEqual(credential, persisted!.CredentialHash);

            var secondStore = new PortableStore(new PortableLayout(root));
            await using var secondBridge = new BrowserExtensionBridge(0, secondStore);
            await secondBridge.StartAsync();
            Assert.Equal(BrowserExtensionPairingState.Paired, secondBridge.Status.PairingState);
            var secondSession = await BootstrapAsync(client, secondBridge, credential);
            Assert.NotEqual(firstSession, secondSession);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task WebSocketSupportsHelloPingEventsAndPairedRestart()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var pairingCredential = await PairAsync(client, bridge);
        var firstSessionToken = await BootstrapAsync(client, bridge, pairingCredential);

        using var socket = await ConnectSocketAsync(bridge, firstSessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("hello.ack", hello.RootElement.GetProperty("type").GetString());
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("desktop.ready", ready.RootElement.GetProperty("event").GetString());

        await SendTextAsync(socket, "{\"type\":\"ping\",\"id\":\"ws-ping\"}", timeout.Token);
        using var pong = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("pong", pong.RootElement.GetProperty("type").GetString());
        Assert.Equal("ws-ping", pong.RootElement.GetProperty("id").GetString());

        var sent = await bridge.SendEventAsync(new BrowserExtensionBridgeEvent(
            "desktop.test",
            new JsonObject { ["ok"] = true }), timeout.Token);
        Assert.True(sent);
        using var eventMessage = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("desktop.test", eventMessage.RootElement.GetProperty("event").GetString());
        Assert.True(eventMessage.RootElement.GetProperty("data").GetProperty("ok").GetBoolean());
        Assert.Equal(BrowserExtensionConnectionState.Connected, bridge.Status.ConnectionState);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
        Assert.True(await WaitForStatusAsync(bridge, BrowserExtensionConnectionState.Disconnected, timeout.Token));

        await bridge.StopAsync(timeout.Token);
        Assert.False(bridge.Status.IsRunning);
        Assert.Equal(BrowserExtensionPairingState.Paired, bridge.Status.PairingState);

        await bridge.StartAsync(timeout.Token);
        var secondSessionToken = await BootstrapAsync(client, bridge, pairingCredential);
        Assert.NotEqual(firstSessionToken, secondSessionToken);

        using var restartedSocket = await ConnectSocketAsync(bridge, secondSessionToken);
        using var restartedHello = await ReceiveJsonAsync(restartedSocket, timeout.Token);
        Assert.Equal("hello.ack", restartedHello.RootElement.GetProperty("type").GetString());
        using var restartedReady = await ReceiveJsonAsync(restartedSocket, timeout.Token);
        Assert.Equal("desktop.ready", restartedReady.RootElement.GetProperty("event").GetString());
        await restartedSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task WebPageCannotPairEvenWhenItKnowsThePairingCode()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();

        using var webRequest = new HttpRequestMessage(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { pairing_code = bridge.Status.PairingCode }),
                Encoding.UTF8,
                "application/json"),
        };
        webRequest.Headers.TryAddWithoutValidation("Origin", "https://example.invalid");
        webRequest.Headers.TryAddWithoutValidation(BrowserExtensionBridgeProtocol.ClientHeaderName, BrowserExtensionBridgeProtocol.ClientHeaderValue);
        using var webResponse = await client.SendAsync(webRequest);
        Assert.Equal(HttpStatusCode.Forbidden, webResponse.StatusCode);

        using var missingHeaderRequest = new HttpRequestMessage(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(new { pairing_code = bridge.Status.PairingCode }),
                Encoding.UTF8,
                "application/json"),
        };
        missingHeaderRequest.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
        using var missingHeaderResponse = await client.SendAsync(missingHeaderRequest);
        Assert.Equal(HttpStatusCode.Forbidden, missingHeaderResponse.StatusCode);
    }

    private static HttpClient CreateHttpClient()
        => new(new HttpClientHandler { UseProxy = false });

    private static HttpRequestMessage CreateJsonRequest(
        HttpMethod method,
        string uri,
        string body,
        bool includeOrigin = true)
    {
        var request = new HttpRequestMessage(method, uri)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        if (includeOrigin) request.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
        request.Headers.TryAddWithoutValidation(BrowserExtensionBridgeProtocol.ClientHeaderName, BrowserExtensionBridgeProtocol.ClientHeaderValue);
        return request;
    }

    private static async Task<string> PairAsync(HttpClient client, BrowserExtensionBridge bridge)
    {
        using var request = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}",
            JsonSerializer.Serialize(new { pairing_code = bridge.Status.PairingCode }));
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        return document.RootElement.GetProperty("pairing_credential").GetString()!;
    }

    private static async Task<string> BootstrapAsync(HttpClient client, BrowserExtensionBridge bridge, string pairingCredential)
    {
        using var request = CreateJsonRequest(
            HttpMethod.Post,
            $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.BootstrapPath}",
            "{}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", pairingCredential);
        using var response = await client.SendAsync(request);
        response.EnsureSuccessStatusCode();
        using var document = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync());
        return document.RootElement.GetProperty("session_token").GetString()!;
    }

    private static async Task<ClientWebSocket> ConnectSocketAsync(BrowserExtensionBridge bridge, string sessionToken)
    {
        var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", ExtensionOrigin);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await socket.ConnectAsync(new Uri(bridge.Status.WebSocketEndpoint), timeout.Token);
        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "hello",
            protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
            client = BrowserExtensionBridgeProtocol.ExtensionClientName,
            token = sessionToken,
        }), timeout.Token);
        return socket;
    }

    private static async Task SendTextAsync(ClientWebSocket socket, string text, CancellationToken cancellationToken)
        => await socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, cancellationToken);

    private static async Task<JsonDocument> ReceiveJsonAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[4096];
        using var message = new MemoryStream();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) throw new WebSocketException("The test socket was closed.");
            message.Write(buffer, 0, result.Count);
            if (result.EndOfMessage) return JsonDocument.Parse(message.ToArray());
        }
    }

    private static async Task<bool> WaitForStatusAsync(
        BrowserExtensionBridge bridge,
        BrowserExtensionConnectionState expected,
        CancellationToken cancellationToken)
    {
        if (bridge.Status.ConnectionState == expected) return true;
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void Handler(object? _, BrowserExtensionBridgeStatusChangedEventArgs args)
        {
            if (args.Status.ConnectionState == expected) completion.TrySetResult(true);
        }

        bridge.StatusChanged += Handler;
        try
        {
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
        }
        finally
        {
            bridge.StatusChanged -= Handler;
        }
    }

    private sealed class InMemoryPairingStore : IBrowserExtensionPairingStore
    {
        public BrowserExtensionPairingRecord? Record { get; private set; }

        public Task<BrowserExtensionPairingRecord?> LoadBrowserExtensionPairingAsync(CancellationToken cancellationToken = default)
            => Task.FromResult(Record);

        public Task SaveBrowserExtensionPairingAsync(
            BrowserExtensionPairingRecord pairing,
            CancellationToken cancellationToken = default)
        {
            Record = pairing;
            return Task.CompletedTask;
        }
    }
}
