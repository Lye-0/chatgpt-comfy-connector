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
        Assert.Contains("https://chatgpt.com/*", root.GetProperty("host_permissions").EnumerateArray().Select(value => value.GetString()));
        Assert.Contains(root.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()), value => value == "alarms");
        Assert.Contains(root.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()), value => value == "storage");
        Assert.Contains(root.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()), value => value == "scripting");
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
        Assert.Contains("function diagnostic", source, StringComparison.Ordinal);
        Assert.DoesNotContain("sessionToken", source[source.IndexOf("function diagnostic", StringComparison.Ordinal)..source.IndexOf("async function setState", StringComparison.Ordinal)], StringComparison.Ordinal);
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
            Assert.Null(secondBridge.Status.PairingCode);
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
        var diagnostics = new List<BrowserExtensionBridgeDiagnostic>();
        bridge.Diagnostic += (_, args) => diagnostics.Add(args.Diagnostic);
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

        var handoff = new BrowserExtensionHandoffSendRequest(
            "request-01",
            "session-01",
            "handoff-01",
            "boundary-01",
            "## ChatGPT Comfy Connector\nhandoff_id: handoff-01\nsession_id: session-01\nboundary_id: boundary-01");
        var handoffTask = bridge.SendHandoffAsync(handoff, timeout.Token);
        using var handoffMessage = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("handoff.send", handoffMessage.RootElement.GetProperty("type").GetString());
        Assert.Equal(handoff.RequestId, handoffMessage.RootElement.GetProperty("request_id").GetString());
        Assert.Equal(handoff.SessionId, handoffMessage.RootElement.GetProperty("session_id").GetString());
        Assert.Equal(handoff.HandoffId, handoffMessage.RootElement.GetProperty("handoff_id").GetString());
        Assert.Equal(handoff.BoundaryId, handoffMessage.RootElement.GetProperty("boundary_id").GetString());
        Assert.Equal(handoff.Payload, handoffMessage.RootElement.GetProperty("payload").GetString());

        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "handoff.result",
            request_id = handoff.RequestId,
            handoff_id = handoff.HandoffId,
            status = "sent",
        }), timeout.Token);
        var handoffResult = await handoffTask;
        Assert.True(handoffResult.IsSent);
        Assert.Equal(handoff.RequestId, handoffResult.RequestId);
        Assert.Equal(handoff.HandoffId, handoffResult.HandoffId);
        using var handoffAck = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("bridge.delivery.ack", handoffAck.RootElement.GetProperty("type").GetString());
        Assert.Equal("handoff.result", handoffAck.RootElement.GetProperty("delivery_type").GetString());
        Assert.Equal(handoff.RequestId, handoffAck.RootElement.GetProperty("request_id").GetString());
        Assert.Equal(handoff.HandoffId, handoffAck.RootElement.GetProperty("handoff_id").GetString());
        Assert.Contains(diagnostics, item => item.EventName == "bridge connected");
        Assert.Contains(diagnostics, item => item.EventName == "handoff.send requested" && item.RequestId == handoff.RequestId && item.HandoffId == handoff.HandoffId);
        Assert.Contains(diagnostics, item => item.EventName == "websocket send" && item.RequestId == handoff.RequestId && item.HandoffId == handoff.HandoffId);
        Assert.Contains(diagnostics, item => item.EventName == "handoff.result received"
            && item.RequestId == handoff.RequestId
            && item.HandoffId == handoff.HandoffId
            && item.Stage == "handoff_result_received");
        Assert.Contains(diagnostics, item => item.EventName == "result status" && item.RequestId == handoff.RequestId && item.Status == "sent");

        var failedHandoff = handoff with { RequestId = "request-02", HandoffId = "handoff-02" };
        var failedTask = bridge.SendHandoffAsync(failedHandoff, timeout.Token);
        using var failedMessage = await ReceiveJsonAsync(socket, timeout.Token);
        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "handoff.result",
            request_id = failedHandoff.RequestId,
            handoff_id = failedHandoff.HandoffId,
            status = "error",
            error_code = BrowserExtensionHandoffErrorCodes.ComposerNotFound,
            stage = "composer_not_found",
            message = "ChatGPTの入力欄が見つかりません。",
        }), timeout.Token);
        var failedResult = await failedTask;
        Assert.False(failedResult.IsSent);
        Assert.Equal(BrowserExtensionHandoffErrorCodes.ComposerNotFound, failedResult.ErrorCode);
        Assert.Equal("composer_not_found", failedResult.Stage);
        Assert.Contains(diagnostics, item => item.EventName == "result status"
            && item.RequestId == failedHandoff.RequestId
            && item.Status == "error"
            && item.ErrorCode == BrowserExtensionHandoffErrorCodes.ComposerNotFound
            && item.Stage == "composer_not_found");

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
    public async Task WebSocketReturnsMetadataOnlyChatGptProjectAndConversationContext()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var sessionToken = await BootstrapAsync(client, bridge, credential);
        using var socket = await ConnectSocketAsync(bridge, sessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);

        var contextTask = bridge.GetChatGptContextAsync(cancellationToken: timeout.Token);
        using var request = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("chatgpt.context.list.request", request.RootElement.GetProperty("type").GetString());
        Assert.True(request.RootElement.TryGetProperty("request_id", out var requestId));
        Assert.False(request.RootElement.TryGetProperty("payload", out _));
        Assert.False(request.RootElement.TryGetProperty("session_token", out _));

        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "chatgpt.context.list.response",
            request_id = requestId.GetString(),
            status = "ok",
            projects = new[]
            {
                new
                {
                    project_id = (string?)"g-p-project-a",
                    title = "Project A",
                    url = (string?)"https://chatgpt.com/g/g-p-project-a/project",
                    discovery_key = (string?)null,
                },
                new
                {
                    project_id = (string?)null,
                    title = "Visible Project",
                    url = (string?)null,
                    discovery_key = (string?)"project-visible-01",
                }
            },
            conversations = new[]
            {
                new
                {
                    conversation_id = "conversation-a",
                    title = "Chat A",
                    url = "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
                    project_id = (string?)"g-p-project-a",
                    project_title = (string?)"Project A",
                },
                new
                {
                    conversation_id = "conversation-free",
                    title = "Free Chat",
                    url = "https://chatgpt.com/c/conversation-free",
                    project_id = (string?)null,
                    project_title = (string?)null,
                }
            },
            current = new
            {
                conversation_id = "conversation-a",
                title = "Chat A",
                url = "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
                project_id = "g-p-project-a",
                project_title = "Project A",
            }
        }), timeout.Token);

        var snapshot = await contextTask;
        Assert.True(snapshot.IsSuccess);
        Assert.Equal(2, snapshot.Projects.Count);
        Assert.Equal("g-p-project-a", snapshot.Projects[0].ProjectId);
        Assert.Equal("https://chatgpt.com/g/g-p-project-a/project", snapshot.Projects[0].Url);
        Assert.Null(snapshot.Projects[1].ProjectId);
        Assert.Equal("project-visible-01", snapshot.Projects[1].DiscoveryKey);
        Assert.Equal(2, snapshot.Conversations.Count);
        Assert.Equal("conversation-a", snapshot.Conversations[0].ConversationId);
        Assert.Equal("g-p-project-a", snapshot.Conversations[0].ProjectId);
        Assert.Null(snapshot.Conversations[1].ProjectId);
        Assert.Equal("conversation-a", snapshot.Current?.ConversationId);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task WebSocketRequestsOnlyTheSelectedProjectChatMetadata()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var sessionToken = await BootstrapAsync(client, bridge, credential);
        using var socket = await ConnectSocketAsync(bridge, sessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);

        var contextTask = bridge.GetChatGptProjectChatsAsync(
            "g-p-selected",
            "https://chatgpt.com/g/g-p-selected/project",
            timeout.Token);
        using var request = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("chatgpt.context.list.request", request.RootElement.GetProperty("type").GetString());
        Assert.Equal("project", request.RootElement.GetProperty("collection").GetString());
        Assert.Equal("g-p-selected", request.RootElement.GetProperty("project_id").GetString());
        Assert.Equal("https://chatgpt.com/g/g-p-selected/project", request.RootElement.GetProperty("project_url").GetString());
        Assert.False(request.RootElement.TryGetProperty("payload", out _));

        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "chatgpt.context.list.response",
            request_id = request.RootElement.GetProperty("request_id").GetString(),
            status = "ok",
            projects = Array.Empty<object>(),
            conversations = new[]
            {
                new
                {
                    conversation_id = "selected-conversation",
                    title = "Selected Chat",
                    url = "https://chatgpt.com/g/g-p-selected/c/selected-conversation",
                    project_id = "g-p-selected",
                    project_title = "Selected Project",
                }
            },
            current = (object?)null,
        }), timeout.Token);

        var snapshot = await contextTask;
        Assert.True(snapshot.IsSuccess);
        Assert.Single(snapshot.Conversations);
        Assert.Equal("selected-conversation", snapshot.Conversations[0].ConversationId);

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task WebSocketPublishesAuthenticatedAssistantResponseWithoutParsingPayload()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        var diagnostics = new List<BrowserExtensionBridgeDiagnostic>();
        bridge.Diagnostic += (_, args) => diagnostics.Add(args.Diagnostic);
        var received = new TaskCompletionSource<BrowserExtensionAssistantResponse>(TaskCreationOptions.RunContinuationsAsynchronously);
        bridge.AssistantResponseReceived += (_, args) => received.TrySetResult(args.Response);

        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var sessionToken = await BootstrapAsync(client, bridge, credential);
        using var socket = await ConnectSocketAsync(bridge, sessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);

        const string payload = "```connector-command\n{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\"}\n```";
        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "assistant.response",
            request_id = "request-response-01",
            session_id = "session-response-01",
            handoff_id = "handoff-response-01",
            boundary_id = "boundary-response-01",
            status = "received",
            payload,
            stage = "assistant_response_complete",
        }), timeout.Token);

        var response = await received.Task.WaitAsync(timeout.Token);
        Assert.Equal("request-response-01", response.RequestId);
        Assert.Equal("session-response-01", response.SessionId);
        Assert.Equal("handoff-response-01", response.HandoffId);
        Assert.Equal("boundary-response-01", response.BoundaryId);
        Assert.Equal("received", response.Status);
        Assert.Equal(payload, response.Payload);
        Assert.Contains(diagnostics, item => item.EventName == "assistant response received"
            && item.RequestId == response.RequestId
            && item.HandoffId == response.HandoffId
            && item.Status == "received"
            && item.Stage == "assistant_response_complete");
        Assert.DoesNotContain(diagnostics, item => item.EventName.Contains(payload, StringComparison.Ordinal));

        using var responseAck = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("bridge.delivery.ack", responseAck.RootElement.GetProperty("type").GetString());
        Assert.Equal("assistant.response", responseAck.RootElement.GetProperty("delivery_type").GetString());
        Assert.Equal("request-response-01", responseAck.RootElement.GetProperty("request_id").GetString());
        Assert.Equal("handoff-response-01", responseAck.RootElement.GetProperty("handoff_id").GetString());

        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task RegisteredMediaStreamsOnlyTheBoundOutputAndKeepsLocalPathOffTheWire()
    {
        var root = Path.Combine(Path.GetTempPath(), $"chatgpt-comfy-connector-media-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var outputPath = Path.Combine(root, "MiniMax_H3_00015_.mp4");
        var bytes = new byte[] { 1, 2, 3, 4, 5 };
        await File.WriteAllBytesAsync(outputPath, bytes);

        try
        {
            var store = new InMemoryPairingStore();
            await using var bridge = new BrowserExtensionBridge(0, store);
            await bridge.StartAsync();
            using var client = CreateHttpClient();
            var credential = await PairAsync(client, bridge);
            var sessionToken = await BootstrapAsync(client, bridge, credential);
            using var socket = await ConnectSocketAsync(bridge, sessionToken);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            using var hello = await ReceiveJsonAsync(socket, timeout.Token);
            using var ready = await ReceiveJsonAsync(socket, timeout.Token);

            const string mediaId = "media-fixture-01";
            const string sessionId = "session-media-01";
            const string outputIdentity = "output-identity-fixture";
            var registration = new BrowserExtensionMediaRegistration
            {
                MediaId = mediaId,
                SessionId = sessionId,
                Iteration = 2,
                OutputIdentity = outputIdentity,
                FileName = Path.GetFileName(outputPath),
                MimeType = BrowserExtensionMediaTypes.Mp4,
                Size = bytes.Length,
                ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(2),
                FullPath = outputPath,
                AllowedRoot = root,
            };

            var serializedRegistration = JsonSerializer.Serialize(registration);
            Assert.DoesNotContain(outputPath, serializedRegistration, StringComparison.Ordinal);
            Assert.DoesNotContain(nameof(BrowserExtensionMediaRegistration.FullPath), serializedRegistration, StringComparison.Ordinal);
            Assert.DoesNotContain(nameof(BrowserExtensionMediaRegistration.AllowedRoot), serializedRegistration, StringComparison.Ordinal);
            bridge.RegisterMedia(registration);

            using var download = new HttpRequestMessage(
                HttpMethod.Get,
                $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.MediaPathPrefix}{mediaId}?session_id={sessionId}&iteration=2");
            download.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken);
            download.Headers.TryAddWithoutValidation(BrowserExtensionBridgeProtocol.ClientHeaderName, BrowserExtensionBridgeProtocol.ClientHeaderValue);
            download.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
            using var downloadResponse = await client.SendAsync(download);
            Assert.Equal(HttpStatusCode.OK, downloadResponse.StatusCode);
            Assert.Equal(BrowserExtensionMediaTypes.Mp4, downloadResponse.Content.Headers.ContentType?.MediaType);
            Assert.Equal(bytes, await downloadResponse.Content.ReadAsByteArrayAsync());

            using var wrongToken = new HttpRequestMessage(
                HttpMethod.Get,
                $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.MediaPathPrefix}{mediaId}?session_id={sessionId}&iteration=2");
            wrongToken.Headers.Authorization = new AuthenticationHeaderValue("Bearer", "wrong-token");
            wrongToken.Headers.TryAddWithoutValidation(BrowserExtensionBridgeProtocol.ClientHeaderName, BrowserExtensionBridgeProtocol.ClientHeaderValue);
            wrongToken.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
            using var wrongTokenResponse = await client.SendAsync(wrongToken);
            Assert.Equal(HttpStatusCode.Unauthorized, wrongTokenResponse.StatusCode);

            using var unknownMedia = new HttpRequestMessage(
                HttpMethod.Get,
                $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.MediaPathPrefix}unknown-media?session_id={sessionId}&iteration=2");
            unknownMedia.Headers.Authorization = new AuthenticationHeaderValue("Bearer", sessionToken);
            unknownMedia.Headers.TryAddWithoutValidation(BrowserExtensionBridgeProtocol.ClientHeaderName, BrowserExtensionBridgeProtocol.ClientHeaderValue);
            unknownMedia.Headers.TryAddWithoutValidation("Origin", ExtensionOrigin);
            using var unknownResponse = await client.SendAsync(unknownMedia);
            Assert.Equal(HttpStatusCode.NotFound, unknownResponse.StatusCode);

            var attachRequest = new BrowserExtensionMediaAttachRequest(
                "media-request-01",
                sessionId,
                2,
                mediaId,
                registration.FileName,
                registration.MimeType,
                registration.Size,
                17,
                "https://chatgpt.com/c/fixture",
                TargetProjectId: "Project (stale display label)");
            var attachTask = bridge.SendMediaAttachAsync(attachRequest, timeout.Token);
            using var attachEnvelope = await ReceiveJsonAsync(socket, timeout.Token);
            Assert.Equal("review.media.attach", attachEnvelope.RootElement.GetProperty("type").GetString());
            Assert.Equal(mediaId, attachEnvelope.RootElement.GetProperty("media_id").GetString());
            Assert.Equal(sessionId, attachEnvelope.RootElement.GetProperty("session_id").GetString());
            Assert.Equal(2, attachEnvelope.RootElement.GetProperty("iteration").GetInt32());
            Assert.Equal(17, attachEnvelope.RootElement.GetProperty("target_tab_id").GetInt32());
            Assert.False(attachEnvelope.RootElement.TryGetProperty("target_project_id", out _));
            Assert.False(attachEnvelope.RootElement.TryGetProperty("full_path", out _));
            Assert.False(attachEnvelope.RootElement.TryGetProperty("allowed_root", out _));

            await SendTextAsync(socket, JsonSerializer.Serialize(new
            {
                type = "review.media.result",
                request_id = attachRequest.RequestId,
                session_id = attachRequest.SessionId,
                iteration = attachRequest.Iteration,
                media_id = attachRequest.MediaId,
                status = "attached",
                stage = "attachment_verified",
            }), timeout.Token);
            var attachResult = await attachTask;
            Assert.True(attachResult.IsAttached);
            Assert.Equal(attachRequest.RequestId, attachResult.RequestId);
            Assert.Equal(attachRequest.MediaId, attachResult.MediaId);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task MediaRegistrationRejectsTraversalUnsupportedMimeOversizeAndExpiredMedia()
    {
        var root = Path.Combine(Path.GetTempPath(), $"chatgpt-comfy-connector-media-security-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var outputPath = Path.Combine(root, "safe.png");
        await File.WriteAllBytesAsync(outputPath, [1, 2, 3]);

        try
        {
            await using var bridge = new BrowserExtensionBridge(0, new InMemoryPairingStore());
            await bridge.StartAsync();

            BrowserExtensionMediaRegistration CreateRegistration(
                string mediaId,
                string fileName,
                string mimeType,
                long size,
                DateTimeOffset expiresAt,
                string fullPath = "")
                => new()
                {
                    MediaId = mediaId,
                    SessionId = "session-security",
                    Iteration = 1,
                    OutputIdentity = "identity-security",
                    FileName = fileName,
                    MimeType = mimeType,
                    Size = size,
                    ExpiresAt = expiresAt,
                    FullPath = string.IsNullOrEmpty(fullPath) ? outputPath : fullPath,
                    AllowedRoot = root,
                };

            Assert.Throws<ArgumentException>(() => bridge.RegisterMedia(CreateRegistration(
                "media-traversal",
                "..\\secret.txt",
                BrowserExtensionMediaTypes.Png,
                3,
                DateTimeOffset.UtcNow.AddMinutes(1))));
            Assert.Throws<ArgumentException>(() => bridge.RegisterMedia(CreateRegistration(
                "media-unsupported",
                "safe.png",
                "image/gif",
                3,
                DateTimeOffset.UtcNow.AddMinutes(1))));
            Assert.Throws<ArgumentException>(() => bridge.RegisterMedia(CreateRegistration(
                "media-oversize",
                "safe.png",
                BrowserExtensionMediaTypes.Png,
                512L * 1024 * 1024 + 1,
                DateTimeOffset.UtcNow.AddMinutes(1))));
            Assert.Throws<ArgumentException>(() => bridge.RegisterMedia(CreateRegistration(
                "media-outside-root",
                "safe.png",
                BrowserExtensionMediaTypes.Png,
                3,
                DateTimeOffset.UtcNow.AddMinutes(1),
                Path.Combine(root, "..", "outside.png"))));
            Assert.Throws<ArgumentException>(() => bridge.RegisterMedia(CreateRegistration(
                "media-expired-registration",
                "safe.png",
                BrowserExtensionMediaTypes.Png,
                3,
                DateTimeOffset.UtcNow.AddSeconds(-1))));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task HandoffResultCompletesAfterExtensionReconnect()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        var diagnostics = new List<BrowserExtensionBridgeDiagnostic>();
        bridge.Diagnostic += (_, args) => diagnostics.Add(args.Diagnostic);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var sessionToken = await BootstrapAsync(client, bridge, credential);
        using var firstSocket = await ConnectSocketAsync(bridge, sessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(firstSocket, timeout.Token);
        using var ready = await ReceiveJsonAsync(firstSocket, timeout.Token);

        var handoff = new BrowserExtensionHandoffSendRequest(
            "request-reconnect",
            "session-reconnect",
            "handoff-reconnect",
            "boundary-reconnect",
            "## ChatGPT Comfy Connector\nhandoff_id: handoff-reconnect\nsession_id: session-reconnect\nboundary_id: boundary-reconnect");
        var handoffTask = bridge.SendHandoffAsync(handoff, timeout.Token);
        using var request = await ReceiveJsonAsync(firstSocket, timeout.Token);
        Assert.Equal("handoff.send", request.RootElement.GetProperty("type").GetString());

        // The service worker can lose its socket after the ChatGPT post has
        // already been accepted. Close the first connection cleanly, then
        // deliver the result over the next authenticated connection.
        await firstSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test reconnect", timeout.Token);

        var replacementToken = await BootstrapAsync(client, bridge, credential);
        using var replacementSocket = await ConnectSocketAsync(bridge, replacementToken);
        using var replacementHello = await ReceiveJsonAsync(replacementSocket, timeout.Token);
        using var replacementReady = await ReceiveJsonAsync(replacementSocket, timeout.Token);
        Assert.Equal("hello.ack", replacementHello.RootElement.GetProperty("type").GetString());
        Assert.Equal("desktop.ready", replacementReady.RootElement.GetProperty("event").GetString());

        await SendTextAsync(replacementSocket, JsonSerializer.Serialize(new
        {
            type = "handoff.result",
            request_id = handoff.RequestId,
            session_id = handoff.SessionId,
            handoff_id = handoff.HandoffId,
            boundary_id = handoff.BoundaryId,
            status = "sent",
        }), timeout.Token);

        var result = await handoffTask;
        Assert.True(result.IsSent);
        Assert.Equal(handoff.RequestId, result.RequestId);
        Assert.DoesNotContain(diagnostics, item => item.EventName == "result status" && item.ErrorCode == BrowserExtensionHandoffErrorCodes.BridgeDisconnected);
    }

    [Fact]
    public async Task HandoffSendFailsWithoutConnectedExtensionAndWhenSocketCloses()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();

        var disconnected = await bridge.SendHandoffAsync(new BrowserExtensionHandoffSendRequest(
            "request-disconnected",
            "session-01",
            "handoff-01",
            "boundary-01",
            "payload"));
        Assert.False(disconnected.IsSent);
        Assert.Equal(BrowserExtensionHandoffErrorCodes.BridgeDisconnected, disconnected.ErrorCode);

        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var sessionToken = await BootstrapAsync(client, bridge, credential);
        using var socket = await ConnectSocketAsync(bridge, sessionToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);

        var handoffTask = bridge.SendHandoffAsync(new BrowserExtensionHandoffSendRequest(
            "request-close",
            "session-01",
            "handoff-close",
            "boundary-01",
            "payload"), timeout.Token);
        using var request = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("handoff.send", request.RootElement.GetProperty("type").GetString());
        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test disconnect", timeout.Token);

        var result = await handoffTask;
        Assert.False(result.IsSent);
        Assert.Equal(BrowserExtensionHandoffErrorCodes.BridgeDisconnected, result.ErrorCode);
    }

    [Fact]
    public void ExtensionContainsThePhase2HandoffRoutingAndDomBoundaries()
    {
        var extensionRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "browser-extension"));
        var manifest = JsonDocument.Parse(File.ReadAllText(Path.Combine(extensionRoot, "manifest.json"))).RootElement;
        Assert.Contains("tabs", manifest.GetProperty("permissions").EnumerateArray().Select(value => value.GetString()));
        var matches = manifest.GetProperty("content_scripts")[0].GetProperty("matches").EnumerateArray().Select(value => value.GetString()).ToArray();
        Assert.True(matches.Length == 1 && matches[0] == "https://chatgpt.com/*");
        Assert.Equal("chatgpt-locators.js", manifest.GetProperty("content_scripts")[0].GetProperty("js")[0].GetString());

        var background = File.ReadAllText(Path.Combine(extensionRoot, "background.js"));
        Assert.Contains("message.type === \"handoff.send\"", background, StringComparison.Ordinal);
        Assert.Contains("MANAGED_TAB_STORAGE_KEY", background, StringComparison.Ordinal);
        Assert.Contains("chrome.windows.create(createData)", background, StringComparison.Ordinal);
        Assert.Contains("focused: false", background, StringComparison.Ordinal);
        Assert.Contains("active: true", background, StringComparison.Ordinal);
        Assert.Contains("autoDiscardable: false", background, StringComparison.Ordinal);
        Assert.Contains("MANAGED_EXECUTION_WINDOW_SIZE_FACTOR", background, StringComparison.Ordinal);
        Assert.DoesNotContain("populate: true", background, StringComparison.Ordinal);
        Assert.Contains("function ensureManagedExecutionTab", background, StringComparison.Ordinal);
        Assert.Contains("conversation is the durable identity", background, StringComparison.Ordinal);
        Assert.Contains("prepare: true", background, StringComparison.Ordinal);
        Assert.Contains("chrome.tabs.sendMessage(tabId", background, StringComparison.Ordinal);
        Assert.Contains("type: \"handoff.result\"", background, StringComparison.Ordinal);
        Assert.Contains("background received", background, StringComparison.Ordinal);
        Assert.Contains("content script dispatched", background, StringComparison.Ordinal);
        Assert.Contains("response watch armed", background, StringComparison.Ordinal);
        Assert.Contains("review handoff sent", background, StringComparison.Ordinal);
        Assert.Contains("targetTabId: managedTabState.tabId", background, StringComparison.Ordinal);
        Assert.Contains("result status", background, StringComparison.Ordinal);
        Assert.Contains("chrome.scripting.executeScript", background, StringComparison.Ordinal);
        Assert.Contains("CONTENT_SCRIPT_TIMEOUT_MS", background, StringComparison.Ordinal);
        Assert.DoesNotContain("document.querySelector", background, StringComparison.Ordinal);

        var content = File.ReadAllText(Path.Combine(extensionRoot, "content-script.js"));
        var locators = File.ReadAllText(Path.Combine(extensionRoot, "chatgpt-locators.js"));
        Assert.Contains("HANDOFF_SEND", content, StringComparison.Ordinal);
        Assert.Contains("beforeinput", content, StringComparison.Ordinal);
        Assert.Contains("InputEvent", content, StringComparison.Ordinal);
        Assert.Contains("execCommand(\"insertText\"", content, StringComparison.Ordinal);
        Assert.Contains("tryPasteContentEditableValue", content, StringComparison.Ordinal);
        Assert.Contains("ClipboardEvent", content, StringComparison.Ordinal);
        Assert.Contains("content script received", content, StringComparison.Ordinal);
        Assert.Contains("content script result", content, StringComparison.Ordinal);
        Assert.Contains("captureUserMessageSnapshot", content, StringComparison.Ordinal);
        Assert.Contains("hasNewUserMessageWithCorrelation", content, StringComparison.Ordinal);
        Assert.Contains("composer_found", content, StringComparison.Ordinal);
        Assert.Contains("input_attempted", content, StringComparison.Ordinal);
        Assert.Contains("input_visible", content, StringComparison.Ordinal);
        Assert.Contains("send_button_enabled", content, StringComparison.Ordinal);
        Assert.Contains("send_button_not_enabled", content, StringComparison.Ordinal);
        Assert.Contains("user_message_observed", content, StringComparison.Ordinal);
        Assert.Contains("user_message_correlated", content, StringComparison.Ordinal);
        Assert.Contains("WATCH_ASSISTANT_RESPONSE", content, StringComparison.Ordinal);
        Assert.Contains("response anchor found", content, StringComparison.Ordinal);
        Assert.Contains("response_watch_armed", content, StringComparison.Ordinal);
        Assert.Contains("assistant message complete", content, StringComparison.Ordinal);
        Assert.Contains("assistant response emitted", content, StringComparison.Ordinal);
        Assert.Contains("assistant_response_complete", content, StringComparison.Ordinal);
        Assert.Contains("MutationObserver", content, StringComparison.Ordinal);
        Assert.Contains("assistant_response_not_found", content, StringComparison.Ordinal);
        Assert.Contains("response_stream_interrupted", content, StringComparison.Ordinal);
        Assert.DoesNotContain("element.textContent = payload", content, StringComparison.Ordinal);
        Assert.Contains("send button clicked", content, StringComparison.Ordinal);
        Assert.Contains("user message confirmed", content, StringComparison.Ordinal);
        Assert.DoesNotContain("waitForSendAccepted", content, StringComparison.Ordinal);
        Assert.DoesNotContain("127.0.0.1", content, StringComparison.Ordinal);
        Assert.DoesNotContain("new WebSocket", content, StringComparison.Ordinal);
        Assert.Contains("findComposer", locators, StringComparison.Ordinal);
        Assert.Contains("findSendButton", locators, StringComparison.Ordinal);
        Assert.Contains("belongsToComposerScope", locators, StringComparison.Ordinal);
        Assert.Contains("excludedActionPattern", locators, StringComparison.Ordinal);
        Assert.Contains("attachment", locators, StringComparison.Ordinal);
        Assert.Contains("plus", locators, StringComparison.Ordinal);
        Assert.Contains("findUserMessages", locators, StringComparison.Ordinal);
        Assert.Contains("findNewUserMessages", locators, StringComparison.Ordinal);
        Assert.Contains("messageContainsMarker", locators, StringComparison.Ordinal);
        Assert.Contains("contenteditable", locators, StringComparison.Ordinal);
        Assert.Contains("aria-label", locators, StringComparison.Ordinal);
        Assert.Contains("data-testid", locators, StringComparison.Ordinal);
        Assert.Contains("findAssistantMessagesAfterAnchor", locators, StringComparison.Ordinal);
        Assert.Contains("hasAssistantCompletionActions", locators, StringComparison.Ordinal);
        Assert.Contains("isGenerating", locators, StringComparison.Ordinal);

        var timeline = File.ReadAllText(Path.Combine(extensionRoot, "..", "src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml"));
        Assert.Contains("TransportFailureText", timeline, StringComparison.Ordinal);
    }

    [Fact]
    public void DesktopSendPathUsesBridgeResultBeforeClipboardFallback()
    {
        var desktopSourcePath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml.cs");
        var source = File.ReadAllText(Path.GetFullPath(desktopSourcePath));
        var prepareCall = source.IndexOf("PrepareBootstrapHandoffForSendAsync()", StringComparison.Ordinal);
        var sendCall = source.IndexOf("TrySendPreparedBootstrapHandoffAsync(payload)", StringComparison.Ordinal);
        var clipboardCall = source.IndexOf("Clipboard.SetText(payload)", StringComparison.Ordinal);

        Assert.True(prepareCall >= 0);
        Assert.True(sendCall >= 0);
        Assert.True(clipboardCall > sendCall);
        Assert.Contains("if (result.IsSent)", source, StringComparison.Ordinal);
        Assert.DoesNotContain("if (ViewModel.IsBrowserExtensionConnected)", source, StringComparison.Ordinal);

        var viewModelPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ChatGPTComfyConnector.Desktop", "ViewModels", "MainViewModel.cs");
        var viewModel = File.ReadAllText(Path.GetFullPath(viewModelPath));
        Assert.Contains("CanResendBootstrapHandoff", viewModel, StringComparison.Ordinal);
        Assert.Contains("TryGetResendableBootstrapPayload", viewModel, StringComparison.Ordinal);
        Assert.Contains("EnsureBootstrapResendAllowed", viewModel, StringComparison.Ordinal);
        Assert.Contains("stage=ui_context_catalog", viewModel, StringComparison.Ordinal);
        Assert.Contains("ui_real_project_count", viewModel, StringComparison.Ordinal);
        Assert.Contains("IsProjectChatListLoading", viewModel, StringComparison.Ordinal);

        var xamlPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml");
        var xaml = File.ReadAllText(Path.GetFullPath(xamlPath));
        Assert.Contains("Content=\"{Binding SendToChatGptButtonText}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("IsEnabled=\"{Binding CanSendToChatGpt}\"", xaml, StringComparison.Ordinal);
        Assert.Contains("Chatを取得中…", xaml, StringComparison.Ordinal);
        Assert.Contains("IsProjectChatListLoading", xaml, StringComparison.Ordinal);
    }

    [Fact]
    public void BrowserExtensionReconnectDoesNotTriggerAnImplicitHandoffRetry()
    {
        var viewModelPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ChatGPTComfyConnector.Desktop", "ViewModels", "MainViewModel.cs");
        var source = File.ReadAllText(Path.GetFullPath(viewModelPath));
        var handlerStart = source.IndexOf("private void BrowserExtensionBridge_StatusChanged", StringComparison.Ordinal);
        var handlerEnd = source.IndexOf("private void BrowserExtensionBridge_Diagnostic", handlerStart, StringComparison.Ordinal);

        Assert.True(handlerStart >= 0);
        Assert.True(handlerEnd > handlerStart);
        var handler = source[handlerStart..handlerEnd];
        Assert.DoesNotContain("PrepareBootstrapHandoffForSendAsync", handler, StringComparison.Ordinal);
        Assert.DoesNotContain("SendPreparedBootstrapHandoffAsync", handler, StringComparison.Ordinal);
        Assert.Contains("CanResendBootstrapHandoff", handler, StringComparison.Ordinal);
    }

    [Fact]
    public void ConnectorStartupDoesNotStartLiveChatGptProjectDiscovery()
    {
        var viewModelPath = Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "src", "ChatGPTComfyConnector.Desktop", "ViewModels", "MainViewModel.cs");
        var source = File.ReadAllText(Path.GetFullPath(viewModelPath));
        var initializeStart = source.IndexOf("private async Task InitializeContextProviderAsync()", StringComparison.Ordinal);
        var initializeEnd = source.IndexOf("private async Task ReloadContextOptionsAsync(", initializeStart, StringComparison.Ordinal);
        Assert.True(initializeStart >= 0);
        Assert.True(initializeEnd > initializeStart);
        var initialize = source[initializeStart..initializeEnd];
        Assert.Contains("LoadCachedContextCatalogAsync", initialize, StringComparison.Ordinal);
        Assert.Contains("startup_collection_suppressed", initialize, StringComparison.Ordinal);
        Assert.DoesNotContain("LoadContextCatalogAsync", initialize, StringComparison.Ordinal);
        Assert.DoesNotContain("GetChatGptContextAsync", initialize, StringComparison.Ordinal);

        var refreshStart = source.IndexOf("public async Task RefreshChatGptContextAsync", StringComparison.Ordinal);
        var refreshEnd = source.IndexOf("public async Task CreateChatAsync()", refreshStart, StringComparison.Ordinal);
        Assert.True(refreshStart >= 0);
        Assert.True(refreshEnd > refreshStart);
        var refresh = source[refreshStart..refreshEnd];
        Assert.Contains("ReloadContextOptionsAsync", refresh, StringComparison.Ordinal);
        Assert.Contains("manual_refresh", refresh, StringComparison.Ordinal);
        Assert.Contains("manual_refresh_started", refresh, StringComparison.Ordinal);
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
