using System.Net;
using System.Net.Http.Headers;
using System.Net.WebSockets;
using System.Text.Json;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Infrastructure.Bridge;
using ChatGPTComfyConnector.Infrastructure.Storage;

namespace ChatGPTComfyConnector.Tests;

public sealed partial class BrowserExtensionBridgeTests
{
    [Fact]
    public async Task ResetPairingRevokesOldConnectionCredentialTokenAndPendingHandoff()
    {
        var store = new InMemoryPairingStore();
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var oldCredential = await PairAsync(client, bridge);
        var oldToken = await BootstrapAsync(client, bridge, oldCredential);
        using var oldSocket = await ConnectSocketAsync(bridge, oldToken);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(oldSocket, timeout.Token);
        using var ready = await ReceiveJsonAsync(oldSocket, timeout.Token);
        var handoffTask = bridge.SendHandoffAsync(new BrowserExtensionHandoffSendRequest(
            "reset-request", "reset-session", "reset-handoff", "reset-boundary", "payload"), timeout.Token);
        using var handoff = await ReceiveJsonAsync(oldSocket, timeout.Token);
        Assert.Equal("handoff.send", handoff.RootElement.GetProperty("type").GetString());

        await bridge.ResetPairingAsync(timeout.Token);

        Assert.True(bridge.Status.IsRunning);
        Assert.Equal(BrowserExtensionConnectionState.Disconnected, bridge.Status.ConnectionState);
        Assert.Equal(BrowserExtensionPairingState.Required, bridge.Status.PairingState);
        Assert.False(string.IsNullOrWhiteSpace(bridge.Status.PairingCode));
        Assert.Null(store.Record);
        var failedHandoff = await handoffTask.WaitAsync(TimeSpan.FromSeconds(1));
        Assert.Equal(BrowserExtensionHandoffErrorCodes.BridgeDisconnected, failedHandoff.ErrorCode);
        await Assert.ThrowsAsync<WebSocketException>(() => ReceiveJsonAsync(oldSocket, timeout.Token));
        await AssertRejectedBearerAsync(client, bridge, BrowserExtensionBridgeProtocol.BootstrapPath, oldCredential);
        await AssertRejectedBearerAsync(client, bridge, BrowserExtensionBridgeProtocol.PingPath, oldToken);

        var newCredential = await PairAsync(client, bridge);
        var newToken = await BootstrapAsync(client, bridge, newCredential);
        Assert.NotEqual(oldCredential, newCredential);
        Assert.NotEqual(oldToken, newToken);
        using var newSocket = await ConnectSocketAsync(bridge, newToken);
        using var newHello = await ReceiveJsonAsync(newSocket, timeout.Token);
        using var newReady = await ReceiveJsonAsync(newSocket, timeout.Token);
        Assert.Equal("hello.ack", newHello.RootElement.GetProperty("type").GetString());
        await newSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task ResetPairingPersistsRevocationWithoutChangingOtherPortableData()
    {
        var root = Path.Combine(Path.GetTempPath(), $"connector-pairing-reset-{Guid.NewGuid():N}");
        try
        {
            var layout = new PortableLayout(root);
            var store = new PortableStore(layout);
            await store.SaveSettingsAsync(new AppSettings { Endpoint = "http://127.0.0.1:8188", MaximumIterations = 7 });
            var settingsBefore = await File.ReadAllBytesAsync(layout.SettingsFile);
            var sessionPath = Path.Combine(layout.Sessions, "retained-session.json");
            await File.WriteAllTextAsync(sessionPath, "retained history");
            await using var bridge = new BrowserExtensionBridge(0, store);
            await bridge.StartAsync();
            using var client = CreateHttpClient();
            var oldCredential = await PairAsync(client, bridge);

            await bridge.ResetPairingAsync();
            Assert.False(File.Exists(layout.BrowserExtensionPairingFile));
            Assert.Equal(settingsBefore, await File.ReadAllBytesAsync(layout.SettingsFile));
            Assert.Equal("retained history", await File.ReadAllTextAsync(sessionPath));
            await bridge.StopAsync();

            await using var restarted = new BrowserExtensionBridge(0, new PortableStore(layout));
            await restarted.StartAsync();
            Assert.True(restarted.Status.IsPairingRequired);
            Assert.False(string.IsNullOrWhiteSpace(restarted.Status.PairingCode));
            await AssertRejectedBearerAsync(client, restarted, BrowserExtensionBridgeProtocol.BootstrapPath, oldCredential);
            var replacementCredential = await PairAsync(client, restarted);
            Assert.False(string.IsNullOrWhiteSpace(await BootstrapAsync(client, restarted, replacementCredential)));
            Assert.NotNull(await store.LoadBrowserExtensionPairingAsync());
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task FailedPairingResetKeepsThePreviousCredentialAndConnection()
    {
        var store = new InMemoryPairingStore { ClearFailure = new IOException("Pairing file is locked.") };
        await using var bridge = new BrowserExtensionBridge(0, store);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var token = await BootstrapAsync(client, bridge, credential);
        var savedPairing = store.Record;
        using var socket = await ConnectSocketAsync(bridge, token);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        using var hello = await ReceiveJsonAsync(socket, timeout.Token);
        using var ready = await ReceiveJsonAsync(socket, timeout.Token);

        await Assert.ThrowsAsync<IOException>(() => bridge.ResetPairingAsync(timeout.Token));

        Assert.Equal(savedPairing, store.Record);
        Assert.Equal(BrowserExtensionPairingState.Paired, bridge.Status.PairingState);
        Assert.Equal(BrowserExtensionConnectionState.Connected, bridge.Status.ConnectionState);
        Assert.Null(bridge.Status.PairingCode);
        Assert.Equal(token, await BootstrapAsync(client, bridge, credential));
        await SendTextAsync(socket, "{\"type\":\"ping\",\"id\":\"still-connected\"}", timeout.Token);
        using var pong = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("pong", pong.RootElement.GetProperty("type").GetString());
        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task ResetPairingRejectsAHelloStartedBeforeRevocation()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var credential = await PairAsync(client, bridge);
        var token = await BootstrapAsync(client, bridge, credential);
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", ExtensionOrigin);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await socket.ConnectAsync(new Uri(bridge.Status.WebSocketEndpoint), timeout.Token);
        await bridge.ResetPairingAsync(timeout.Token);
        var newCode = bridge.Status.PairingCode;

        await SendTextAsync(socket, JsonSerializer.Serialize(new
        {
            type = "hello", protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
            client = BrowserExtensionBridgeProtocol.ExtensionClientName, token,
        }), timeout.Token);
        using var error = await ReceiveJsonAsync(socket, timeout.Token);
        Assert.Equal("invalid_session_token", error.RootElement.GetProperty("code").GetString());
        Assert.True(bridge.Status.IsPairingRequired);
        Assert.Equal(newCode, bridge.Status.PairingCode);
        Assert.NotEqual(BrowserExtensionConnectionState.Connected, bridge.Status.ConnectionState);
        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task RevokedHelloCannotOverwriteTheReplacementConnectionsStatus()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var oldCredential = await PairAsync(client, bridge);
        var oldToken = await BootstrapAsync(client, bridge, oldCredential);
        using var oldSocket = new ClientWebSocket();
        oldSocket.Options.SetRequestHeader("Origin", ExtensionOrigin);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        await oldSocket.ConnectAsync(new Uri(bridge.Status.WebSocketEndpoint), timeout.Token);
        await bridge.ResetPairingAsync(timeout.Token);
        var credential = await PairAsync(client, bridge);
        var token = await BootstrapAsync(client, bridge, credential);
        using var replacementSocket = await ConnectSocketAsync(bridge, token);
        using var hello = await ReceiveJsonAsync(replacementSocket, timeout.Token);
        using var ready = await ReceiveJsonAsync(replacementSocket, timeout.Token);
        var rejected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        bridge.Diagnostic += (_, args) =>
        {
            if (args.Diagnostic.EventName == "hello rejected") rejected.TrySetResult();
        };

        await SendTextAsync(oldSocket, JsonSerializer.Serialize(new
        {
            type = "hello", protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
            client = BrowserExtensionBridgeProtocol.ExtensionClientName, token = oldToken,
        }), timeout.Token);
        using var error = await ReceiveJsonAsync(oldSocket, timeout.Token);
        Assert.Equal("invalid_session_token", error.RootElement.GetProperty("code").GetString());
        await oldSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
        await rejected.Task.WaitAsync(timeout.Token);

        Assert.Equal(BrowserExtensionConnectionState.Connected, bridge.Status.ConnectionState);
        Assert.Equal(BrowserExtensionPairingState.Paired, bridge.Status.PairingState);
        await SendTextAsync(replacementSocket, "{\"type\":\"ping\",\"id\":\"replacement\"}", timeout.Token);
        using var pong = await ReceiveJsonAsync(replacementSocket, timeout.Token);
        Assert.Equal("pong", pong.RootElement.GetProperty("type").GetString());
        await replacementSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
    }

    [Fact]
    public async Task ResetPairingRenewsAnUnpairedCodeAndItsAttemptBudget()
    {
        await using var bridge = new BrowserExtensionBridge(0);
        await bridge.StartAsync();
        using var client = CreateHttpClient();
        var oldCode = bridge.Status.PairingCode;
        for (var attempt = 0; attempt < 5; attempt++)
        {
            using var request = CreateJsonRequest(HttpMethod.Post,
                $"{bridge.Status.HttpEndpoint}{BrowserExtensionBridgeProtocol.PairPath}",
                "{\"pairing_code\":\"AAAA-BBBB-CCCC\"}");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        }

        await bridge.ResetPairingAsync();

        Assert.NotEqual(oldCode, bridge.Status.PairingCode);
        Assert.InRange(bridge.Status.PairingCodeExpiresAt!.Value - DateTimeOffset.UtcNow,
            TimeSpan.FromMinutes(9), TimeSpan.FromMinutes(10));
        var credential = await PairAsync(client, bridge);
        Assert.False(string.IsNullOrWhiteSpace(await BootstrapAsync(client, bridge, credential)));
    }

    private static async Task AssertRejectedBearerAsync(
        HttpClient client, BrowserExtensionBridge bridge, string path, string bearer)
    {
        using var request = CreateJsonRequest(HttpMethod.Post, bridge.Status.HttpEndpoint + path, "{}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
