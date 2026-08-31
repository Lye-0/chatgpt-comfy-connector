using System.Buffers;
using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Infrastructure.Bridge;

/// <summary>
/// Local-only HTTP/WebSocket bridge for the Chromium Browser Extension.
///
/// The server deliberately has a very small command surface in this phase:
/// public health metadata, one-time pairing, authenticated bootstrap, an
/// authenticated HTTP ping/media stream, and an authenticated WebSocket
/// carrying ping/pong, server-originated events, Handoff transport, and
/// metadata-only Review media attachment requests. It does not execute
/// Connector commands and it never accepts an arbitrary URL or filesystem
/// operation.
/// </summary>
public sealed class BrowserExtensionBridge : IBrowserExtensionBridge
{
    private const int MaxHttpBodyBytes = 8 * 1024;
    private const int MaxWebSocketMessageBytes = 256 * 1024;
    private const int MaxHandoffPayloadBytes = 192 * 1024;
    private const int MaxAssistantResponseBytes = 256 * 1024;
    private const int MaxChatGptContextEntries = 5000;
    private const long MaxReviewMediaBytes = 512L * 1024 * 1024;
    private const int MaxPairingAttempts = 5;
    private static readonly TimeSpan HelloTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan PairingCodeLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan SessionTokenLifetime = TimeSpan.FromMinutes(30);
    // A Review Handoff may wait for ChatGPT to finish processing an attached
    // video before its Send control becomes enabled. This must exceed the
    // Extension Content Script readiness window, otherwise the Desktop would
    // report a bridge timeout while the Extension is still waiting safely.
    private static readonly TimeSpan HandoffResponseTimeout = TimeSpan.FromSeconds(90);
    // Keep an in-flight Handoff alive while the MV3 service worker reconnects.
    // A normal socket close is not proof that the ChatGPT post failed; the
    // accepted result may arrive on the next authenticated socket.
    private static readonly TimeSpan BridgeReconnectGrace = TimeSpan.FromSeconds(7);
    private static readonly TimeSpan MediaAttachResponseTimeout = TimeSpan.FromMinutes(3);
    private static readonly TimeSpan ChatGptContextResponseTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan MediaRegistrationLifetime = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(3);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
        WriteIndented = false,
    };

    private readonly int _requestedPort;
    private readonly IBrowserExtensionPairingStore? _pairingStore;
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly SemaphoreSlim _pairingGate = new(1, 1);
    private readonly SemaphoreSlim _sendGate = new(1, 1);
    private readonly object _clientGate = new();
    private readonly ConcurrentDictionary<string, PendingHandoffRequest> _pendingHandoffs = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, RegisteredMedia> _registeredMedia = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, PendingMediaAttachRequest> _pendingMediaAttachments = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, PendingChatGptContextRequest> _pendingChatGptContextRequests = new(StringComparer.Ordinal);
    private BrowserExtensionBridgeStatus _status;
    private HttpListener? _listener;
    private CancellationTokenSource? _serverCts;
    private Task? _acceptTask;
    private WebSocket? _clientSocket;
    private long _clientGeneration;
    private string? _accessToken;
    private DateTimeOffset? _accessTokenExpiresAt;
    private string? _pairingId;
    private string? _pairingCredentialHash;
    private string? _pairingCode;
    private DateTimeOffset? _pairingCodeExpiresAt;
    private int _pairingAttempts;
    private bool _disposed;

    public BrowserExtensionBridge(
        int port = BrowserExtensionBridgeProtocol.DefaultPort,
        IBrowserExtensionPairingStore? pairingStore = null)
    {
        if (port is < 0 or > 65535) throw new ArgumentOutOfRangeException(nameof(port));

        _requestedPort = port;
        _pairingStore = pairingStore;
        _status = CreateStatus(
            isRunning: false,
            BrowserExtensionConnectionState.Disconnected,
            port,
            clientOrigin: null,
            connectedAt: null,
            lastError: null,
            pairingState: BrowserExtensionPairingState.Required,
            pairingCode: null,
            pairingCodeExpiresAt: null);
    }

    public BrowserExtensionBridgeStatus Status => _status;

    public event EventHandler<BrowserExtensionBridgeStatusChangedEventArgs>? StatusChanged;
    public event EventHandler<BrowserExtensionBridgeDiagnosticEventArgs>? Diagnostic;
    public event EventHandler<BrowserExtensionAssistantResponseEventArgs>? AssistantResponseReceived;
    public event EventHandler<BrowserExtensionChatGptContextChangedEventArgs>? ChatGptContextChanged;

    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            ThrowIfDisposed();
            if (_listener?.IsListening == true) return;

            var port = _requestedPort == 0 ? FindAvailablePort() : _requestedPort;
            var pairing = _pairingStore is null
                ? null
                : await _pairingStore.LoadBrowserExtensionPairingAsync(cancellationToken);
            var listener = new HttpListener
            {
                IgnoreWriteExceptions = true,
            };
            listener.Prefixes.Add(BuildHttpEndpoint(port) + "/");

            try
            {
                listener.Start();
            }
            catch (Exception ex)
            {
                listener.Close();
                PublishStatus(CreateStatus(
                    isRunning: false,
                    BrowserExtensionConnectionState.Error,
                    port,
                    clientOrigin: null,
                    connectedAt: null,
                    lastError: ex.Message,
                    pairingState: GetPairingState(),
                    pairingCode: _pairingCode,
                    pairingCodeExpiresAt: _pairingCodeExpiresAt));
                throw new InvalidOperationException(
                    $"Browser Extension Bridgeを127.0.0.1:{port}で開始できませんでした。{ex.Message}", ex);
            }

            var serverCts = new CancellationTokenSource();
            _listener = listener;
            _serverCts = serverCts;
            _accessToken = CreateAccessToken();
            _accessTokenExpiresAt = DateTimeOffset.UtcNow.Add(SessionTokenLifetime);
            _pairingId = pairing?.PairingId;
            _pairingCredentialHash = pairing?.CredentialHash;
            // A persisted pairing is already the Desktop/Extension trust
            // relationship. Do not mint a second recovery code on every
            // restart: while paired, showing or accepting a fresh code would
            // create an unintended re-pairing surface.
            _pairingCode = pairing is null ? CreatePairingCode() : null;
            _pairingCodeExpiresAt = pairing is null ? DateTimeOffset.UtcNow.Add(PairingCodeLifetime) : null;
            _pairingAttempts = 0;
            PublishStatus(CreateStatus(
                isRunning: true,
                BrowserExtensionConnectionState.Disconnected,
                port,
                clientOrigin: null,
                connectedAt: null,
                lastError: null,
                pairingState: GetPairingState(),
                pairingCode: _pairingCode,
                pairingCodeExpiresAt: _pairingCodeExpiresAt));
            PublishDiagnostic("bridge started", status: Status.ConnectionStateText);
            _acceptTask = AcceptLoopAsync(listener, serverCts.Token);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        await _lifecycleGate.WaitAsync(cancellationToken);
        try
        {
            var listener = _listener;
            var serverCts = _serverCts;
            var acceptTask = _acceptTask;
            WebSocket? socket;

            _listener = null;
            _serverCts = null;
            _acceptTask = null;
            _accessToken = null;
            _accessTokenExpiresAt = null;
            _pairingCode = null;
            _pairingCodeExpiresAt = null;
            _pairingAttempts = 0;
            lock (_clientGate)
            {
                socket = _clientSocket;
                _clientSocket = null;
            }
            FailPendingHandoffs(BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeを停止しました。");
            FailPendingMediaAttachments(BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeを停止しました。");
            FailPendingChatGptContextRequests("Browser Extension Bridgeを停止しました。");
            _registeredMedia.Clear();

            serverCts?.Cancel();
            try { listener?.Stop(); } catch (Exception) { }

            if (socket is not null)
            {
                using var closeCts = new CancellationTokenSource(StopTimeout);
                await CloseSocketAsync(socket, WebSocketCloseStatus.NormalClosure, "bridge stopping", closeCts.Token);
            }

            if (acceptTask is not null)
            {
                try { await acceptTask.WaitAsync(StopTimeout, CancellationToken.None); }
                catch (OperationCanceledException) { }
                catch (HttpListenerException) { }
                catch (ObjectDisposedException) { }
            }

            serverCts?.Dispose();
            try { listener?.Close(); } catch (Exception) { }

            PublishStatus(CreateStatus(
                isRunning: false,
                BrowserExtensionConnectionState.Disconnected,
                _port,
                clientOrigin: null,
                connectedAt: null,
                lastError: null,
                pairingState: GetPairingState(),
                pairingCode: null,
                pairingCodeExpiresAt: null));
            PublishDiagnostic("bridge stopped", status: Status.ConnectionStateText);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    public async Task<bool> SendEventAsync(
        BrowserExtensionBridgeEvent bridgeEvent,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(bridgeEvent);
        ThrowIfDisposed();
        if (!IsSafeEventName(bridgeEvent.EventName))
        {
            throw new ArgumentException("Event名は英数字、'.'、'-'、'_'の64文字以内で指定してください。", nameof(bridgeEvent));
        }

        WebSocket? socket;
        lock (_clientGate) socket = _clientSocket;
        if (socket is null || socket.State != WebSocketState.Open) return false;

        try
        {
            await SendJsonAsync(socket, new
            {
                type = "event",
                @event = bridgeEvent.EventName,
                event_id = bridgeEvent.EventId ?? Guid.NewGuid().ToString("N"),
                timestamp = bridgeEvent.EffectiveTimestamp,
                data = bridgeEvent.Data,
            }, cancellationToken);
            return true;
        }
        catch (WebSocketException)
        {
            RemoveClient(socket);
            return false;
        }
        catch (ObjectDisposedException)
        {
            RemoveClient(socket);
            return false;
        }
    }

    public async Task<BrowserExtensionChatGptContextSnapshot> GetChatGptContextAsync(
        bool currentOnly = false,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var requestId = Guid.NewGuid().ToString("N");
        WebSocket? socket;
        lock (_clientGate) socket = _clientSocket;
        if (socket is null || socket.State != WebSocketState.Open)
        {
            var disconnected = ContextError(
                requestId,
                "bridge_disconnected",
                "Browser Extension Bridgeに接続されていません。",
                "bridge_connection");
            PublishDiagnostic("chatgpt.context rejected", requestId: requestId, status: disconnected.Status, errorCode: disconnected.ErrorCode, stage: disconnected.Stage);
            return disconnected;
        }

        var pending = new PendingChatGptContextRequest(
            currentOnly,
            new TaskCompletionSource<BrowserExtensionChatGptContextSnapshot>(TaskCreationOptions.RunContinuationsAsynchronously));
        if (!_pendingChatGptContextRequests.TryAdd(requestId, pending))
        {
            return ContextError(requestId, "context_request_id_collision", "ChatGPT Context request IDが重複しました。", "context_request");
        }

        PublishDiagnostic(
            currentOnly ? "chatgpt.context.current requested" : "chatgpt.context.list requested",
            requestId: requestId,
            status: "requested",
            stage: "context_request");
        try
        {
            await SendJsonAsync(socket, new
            {
                type = currentOnly ? "chatgpt.context.current.request" : "chatgpt.context.list.request",
                request_id = requestId,
            }, cancellationToken);
            PublishDiagnostic(
                "websocket send",
                requestId: requestId,
                status: "sending",
                stage: currentOnly ? "chatgpt_context_current" : "chatgpt_context_list");
            return await pending.Completion.Task.WaitAsync(ChatGptContextResponseTimeout, cancellationToken);
        }
        catch (TimeoutException)
        {
            var result = ContextError(requestId, "context_response_timeout", "Browser ExtensionからChatGPT Contextが返りませんでした。", "context_response_timeout");
            PublishDiagnostic("chatgpt.context result", requestId: requestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage);
            return result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            var result = ContextError(requestId, "bridge_disconnected", "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("chatgpt.context result", requestId: requestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            var result = ContextError(requestId, "context_request_cancelled", "ChatGPT Context取得がキャンセルされました。", "context_request_cancelled");
            PublishDiagnostic("chatgpt.context result", requestId: requestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage);
            return result;
        }
        catch (WebSocketException)
        {
            RemoveClient(socket);
            var result = ContextError(requestId, "bridge_disconnected", "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("chatgpt.context result", requestId: requestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage);
            return result;
        }
        catch (ObjectDisposedException)
        {
            RemoveClient(socket);
            var result = ContextError(requestId, "bridge_disconnected", "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("chatgpt.context result", requestId: requestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage);
            return result;
        }
        finally
        {
            _pendingChatGptContextRequests.TryRemove(requestId, out _);
        }
    }

    public async Task<BrowserExtensionHandoffSendResult> SendHandoffAsync(
        BrowserExtensionHandoffSendRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ThrowIfDisposed();

        if (!IsSafeIdentifier(request.RequestId)
            || !IsSafeIdentifier(request.SessionId)
            || !IsSafeIdentifier(request.HandoffId)
            || !IsSafeIdentifier(request.BoundaryId))
        {
            throw new ArgumentException("Handoffの識別子が不正です。", nameof(request));
        }

        if (string.IsNullOrWhiteSpace(request.Payload))
        {
            throw new ArgumentException("Handoff本文が空です。", nameof(request));
        }

        if (request.HandoffKind is not (null or "bootstrap" or "review")
            || request.TargetTabId is < 0
            || request.TargetTabUrl is { Length: > 2048 }
            || (request.TargetTabUrl is not null && !IsChatGptUrl(request.TargetTabUrl))
            || (request.TargetConversationId is { } conversationId && !IsSafeIdentifier(conversationId))
            || request.TargetConversationUrl is { Length: > 2048 }
            || (request.TargetConversationUrl is not null && !IsChatGptUrl(request.TargetConversationUrl))
            || (request.TargetProjectId is { } projectId && !IsSafeIdentifier(projectId))
            || (request.TargetProjectUrl is { Length: > 2048 })
            || (request.TargetProjectUrl is not null && !IsChatGptUrl(request.TargetProjectUrl))
            || (request.NewConversation && (request.TargetConversationId is not null || request.TargetConversationUrl is not null))
            || (request.HandoffKind == "review" && request.NewConversation)
            || (request.ReviewMediaId is { } mediaId && !IsSafeIdentifier(mediaId))
            || (request.ReviewFileName is { } fileName && !IsSafeFileName(fileName))
            || request.ReviewIteration is <= 0)
        {
            throw new ArgumentException("Review Handoffの送信メタデータが不正です。", nameof(request));
        }

        if (Encoding.UTF8.GetByteCount(request.Payload) > MaxHandoffPayloadBytes)
        {
            var result = HandoffError(request.RequestId, request.HandoffId, "handoff_payload_too_large", "Handoff本文が大きすぎます。", "payload_validation");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }

        WebSocket? socket;
        lock (_clientGate) socket = _clientSocket;
        if (socket is null || socket.State != WebSocketState.Open)
        {
            var result = HandoffError(
                request.RequestId,
                request.HandoffId,
                BrowserExtensionHandoffErrorCodes.BridgeDisconnected,
                "Browser Extension Bridgeに接続されていません。",
                "bridge_connection");
            PublishDiagnostic("handoff.send rejected", request.RequestId, request.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }

        var pending = new PendingHandoffRequest(
            request.HandoffId,
            new TaskCompletionSource<BrowserExtensionHandoffSendResult>(TaskCreationOptions.RunContinuationsAsynchronously));
        if (!_pendingHandoffs.TryAdd(request.RequestId, pending))
        {
            throw new ArgumentException("request_idが重複しています。", nameof(request));
        }

        PublishDiagnostic(
            "handoff.send requested",
            request.RequestId,
            request.HandoffId,
            "requested",
            sessionId: request.SessionId,
            boundaryId: request.BoundaryId,
            targetTabId: request.TargetTabId);
        try
        {
            PublishDiagnostic(
                "websocket send",
                request.RequestId,
                request.HandoffId,
                "sending",
                sessionId: request.SessionId,
                boundaryId: request.BoundaryId,
                targetTabId: request.TargetTabId);
            await SendJsonAsync(socket, new
            {
                type = "handoff.send",
                request_id = request.RequestId,
                session_id = request.SessionId,
                handoff_id = request.HandoffId,
                boundary_id = request.BoundaryId,
                payload = request.Payload,
                handoff_kind = request.HandoffKind,
                target_tab_id = request.TargetTabId,
                target_tab_url = request.TargetTabUrl,
                review_media_id = request.ReviewMediaId,
                review_file_name = request.ReviewFileName,
                review_iteration = request.ReviewIteration,
                target_conversation_id = request.TargetConversationId,
                target_conversation_url = request.TargetConversationUrl,
                target_project_id = request.TargetProjectId,
                new_conversation = request.NewConversation,
                target_project_url = request.TargetProjectUrl,
            }, cancellationToken);

            var result = await pending.Completion.Task.WaitAsync(HandoffResponseTimeout, cancellationToken);
            PublishDiagnostic(
                "handoff.send completed",
                result.RequestId,
                result.HandoffId,
                result.Status,
                result.ErrorCode,
                "handoff_send_completed",
                sessionId: request.SessionId,
                boundaryId: request.BoundaryId,
                targetTabId: result.TargetTabId ?? request.TargetTabId);
            return result;
        }
        catch (TimeoutException)
        {
            var result = HandoffError(request.RequestId, request.HandoffId, BrowserExtensionHandoffErrorCodes.SendFailed, "Browser Extensionから送信結果が返りませんでした。", "bridge_response_timeout");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            var result = HandoffError(request.RequestId, request.HandoffId, BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            var result = HandoffError(request.RequestId, request.HandoffId, BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeへの送信がキャンセルされました。", "bridge_send_cancelled");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }
        catch (WebSocketException)
        {
            RemoveClient(socket);
            var result = HandoffError(request.RequestId, request.HandoffId, BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }
        catch (ObjectDisposedException)
        {
            RemoveClient(socket);
            var result = HandoffError(request.RequestId, request.HandoffId, BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
            return result;
        }
        finally
        {
            _pendingHandoffs.TryRemove(request.RequestId, out _);
        }
    }

    /// <summary>
    /// Registers one already-resolved Primary Output for a short-lived,
    /// process-local media download.  The registration is intentionally not a
    /// network API: only the Desktop can put a path into this map.
    /// </summary>
    public void RegisterMedia(BrowserExtensionMediaRegistration registration)
    {
        ArgumentNullException.ThrowIfNull(registration);
        ThrowIfDisposed();
        if (_listener?.IsListening != true)
            throw new InvalidOperationException("Browser Extension Bridgeが起動していません。");
        RemoveExpiredMedia();

        if (!IsSafeIdentifier(registration.MediaId)
            || !IsSafeIdentifier(registration.SessionId)
            || registration.Iteration <= 0
            || string.IsNullOrWhiteSpace(registration.OutputIdentity)
            || registration.OutputIdentity.Length > 512)
        {
            throw new ArgumentException("Media registrationの識別情報が不正です。", nameof(registration));
        }

        if (!IsSafeFileName(registration.FileName)
            || !BrowserExtensionMediaTypes.IsSupported(registration.MimeType)
            || registration.Size <= 0
            || registration.Size > MaxReviewMediaBytes)
        {
            throw new ArgumentException("Media registrationのファイル情報が不正です。", nameof(registration));
        }

        var now = DateTimeOffset.UtcNow;
        if (registration.ExpiresAt <= now || registration.ExpiresAt > now + MediaRegistrationLifetime + TimeSpan.FromMinutes(1))
        {
            throw new ArgumentException("Media registrationの有効期限が不正です。", nameof(registration));
        }

        string fullPath;
        string allowedRoot;
        try
        {
            fullPath = Path.GetFullPath(registration.FullPath);
            allowedRoot = Path.GetFullPath(registration.AllowedRoot);
        }
        catch (Exception ex) when (ex is ArgumentException or IOException or UnauthorizedAccessException)
        {
            throw new ArgumentException("Media registrationのローカルファイルが不正です。", nameof(registration), ex);
        }

        if (!PathSafety.IsWithin(allowedRoot, fullPath)
            || !File.Exists(fullPath)
            || string.Equals(Path.GetFileName(fullPath), string.Empty, StringComparison.Ordinal))
        {
            throw new ArgumentException("Media registrationのローカルファイルが許可範囲外です。", nameof(registration));
        }

        var fileInfo = new FileInfo(fullPath);
        if (fileInfo.Length != registration.Size)
        {
            throw new ArgumentException("Media registrationのファイルサイズが一致しません。", nameof(registration));
        }

        var registered = new RegisteredMedia(
            registration.MediaId,
            registration.SessionId,
            registration.Iteration,
            registration.OutputIdentity,
            registration.FileName,
            registration.MimeType.Trim().ToLowerInvariant(),
            registration.Size,
            registration.ExpiresAt,
            fullPath,
            allowedRoot);
        if (!_registeredMedia.TryAdd(registered.MediaId, registered))
        {
            throw new ArgumentException("Media IDが重複しています。", nameof(registration));
        }
        PublishDiagnostic("media registered", mediaId: registered.MediaId, iteration: registered.Iteration);
    }

    public bool RevokeMedia(string mediaId)
    {
        if (string.IsNullOrWhiteSpace(mediaId)) return false;
        var removed = _registeredMedia.TryRemove(mediaId, out var media);
        if (removed) PublishDiagnostic("media revoked", mediaId: media!.MediaId, iteration: media.Iteration);
        return removed;
    }

    public async Task<BrowserExtensionMediaAttachResult> SendMediaAttachAsync(
        BrowserExtensionMediaAttachRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        ThrowIfDisposed();
        RemoveExpiredMedia();

        if (!IsSafeIdentifier(request.RequestId)
            || !IsSafeIdentifier(request.SessionId)
            || !IsSafeIdentifier(request.MediaId)
            || request.Iteration <= 0
            || !IsSafeFileName(request.FileName)
            || !BrowserExtensionMediaTypes.IsSupported(request.MimeType)
            || request.Size <= 0
            || request.Size > MaxReviewMediaBytes
            || request.TargetTabId is < 0
            || request.TargetTabUrl is { Length: > 2048 }
            || (request.TargetTabUrl is not null && !IsChatGptUrl(request.TargetTabUrl))
            || request.TargetConversationId is { } conversationId && !IsSafeIdentifier(conversationId)
            || request.TargetConversationUrl is { Length: > 2048 }
            || (request.TargetConversationUrl is not null && !IsChatGptUrl(request.TargetConversationUrl))
            || request.TargetConversationId is { } conversationIdForUrl
                && request.TargetConversationUrl is { } conversationUrl
                && !string.Equals(ConversationIdFromUrl(conversationUrl), conversationIdForUrl, StringComparison.Ordinal)
            || request.TargetProjectId is { } projectId && !IsSafeIdentifier(projectId))
        {
            return MediaError(request, BrowserExtensionReviewMediaErrorCodes.MediaRegistrationFailed, "Review添付の識別情報が不正です。", "media_request_validation");
        }

        if (!_registeredMedia.TryGetValue(request.MediaId, out var media))
        {
            var missing = MediaError(request, BrowserExtensionReviewMediaErrorCodes.MediaRegistrationFailed, "添付対象の生成物が登録されていません。", "media_registration");
            PublishDiagnostic("review.media.attach rejected", requestId: request.RequestId, status: missing.Status, errorCode: missing.ErrorCode, stage: missing.Stage, mediaId: request.MediaId, iteration: request.Iteration);
            return missing;
        }
        if (media.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            _registeredMedia.TryRemove(request.MediaId, out _);
            var expired = MediaError(request, BrowserExtensionReviewMediaErrorCodes.MediaExpired, "添付対象の有効期限が切れています。", "media_expired");
            PublishDiagnostic("review.media.attach rejected", requestId: request.RequestId, status: expired.Status, errorCode: expired.ErrorCode, stage: expired.Stage, mediaId: request.MediaId, iteration: request.Iteration);
            return expired;
        }
        if (!MediaMatchesRequest(media, request))
        {
            var mismatch = MediaError(request, BrowserExtensionReviewMediaErrorCodes.MediaRegistrationFailed, "添付対象の生成物情報が一致しません。", "media_registration_mismatch");
            PublishDiagnostic("review.media.attach rejected", requestId: request.RequestId, status: mismatch.Status, errorCode: mismatch.ErrorCode, stage: mismatch.Stage, mediaId: request.MediaId, iteration: request.Iteration);
            return mismatch;
        }

        WebSocket? socket;
        lock (_clientGate) socket = _clientSocket;
        if (socket is null || socket.State != WebSocketState.Open)
        {
            var disconnected = MediaError(request, BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeに接続されていません。", "bridge_connection");
            PublishDiagnostic("review.media.attach rejected", requestId: request.RequestId, status: disconnected.Status, errorCode: disconnected.ErrorCode, stage: disconnected.Stage, mediaId: request.MediaId, iteration: request.Iteration);
            return disconnected;
        }

        var pending = new PendingMediaAttachRequest(
            request.SessionId,
            request.Iteration,
            request.MediaId,
            new TaskCompletionSource<BrowserExtensionMediaAttachResult>(TaskCreationOptions.RunContinuationsAsynchronously));
        if (!_pendingMediaAttachments.TryAdd(request.RequestId, pending))
        {
            throw new ArgumentException("request_idが重複しています。", nameof(request));
        }

        PublishDiagnostic("review.media.attach requested", requestId: request.RequestId, status: "requested", mediaId: request.MediaId, iteration: request.Iteration, targetTabId: request.TargetTabId);
        try
        {
            PublishDiagnostic("websocket send", requestId: request.RequestId, status: "sending", stage: "media_metadata", mediaId: request.MediaId, iteration: request.Iteration, targetTabId: request.TargetTabId);
            await SendJsonAsync(socket, new
            {
                type = "review.media.attach",
                request_id = request.RequestId,
                session_id = request.SessionId,
                iteration = request.Iteration,
                media_id = request.MediaId,
                filename = request.FileName,
                mime_type = request.MimeType,
                size = request.Size,
                target_tab_id = request.TargetTabId,
                target_tab_url = request.TargetTabUrl,
                target_conversation_id = request.TargetConversationId,
                target_conversation_url = request.TargetConversationUrl,
                target_project_id = request.TargetProjectId,
            }, cancellationToken);

            var result = await pending.Completion.Task.WaitAsync(MediaAttachResponseTimeout, cancellationToken);
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        catch (TimeoutException)
        {
            var result = MediaError(request, BrowserExtensionReviewMediaErrorCodes.AttachmentTimeout, "Browser Extensionから添付結果が返りませんでした。", "media_response_timeout");
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            var result = MediaError(request, BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            var result = MediaError(request, BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeへの添付送信がキャンセルされました。", "media_send_cancelled");
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        catch (WebSocketException)
        {
            RemoveClient(socket);
            var result = MediaError(request, BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        catch (ObjectDisposedException)
        {
            RemoveClient(socket);
            var result = MediaError(request, BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。", "bridge_connection");
            PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
            return result;
        }
        finally
        {
            _pendingMediaAttachments.TryRemove(request.RequestId, out _);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        await StopAsync();
        _disposed = true;
        _lifecycleGate.Dispose();
        _pairingGate.Dispose();
        _sendGate.Dispose();
    }

    private int _port => _status.Port;

    private async Task AcceptLoopAsync(HttpListener listener, CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested && listener.IsListening)
            {
                HttpListenerContext context;
                try
                {
                    context = await listener.GetContextAsync().WaitAsync(cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
                catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }

                _ = HandleContextAsync(context, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            PublishStatus(CreateStatus(
                isRunning: false,
                BrowserExtensionConnectionState.Error,
                _port,
                Status.ClientOrigin,
                Status.ConnectedAt,
                ex.Message,
                GetPairingState(),
                _pairingCode,
                _pairingCodeExpiresAt));
        }
    }

    private async Task HandleContextAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var websocketAccepted = false;
        try
        {
            if (!IsLoopbackRequest(context))
            {
                await WriteJsonAsync(context.Response, 403, new { ok = false, error = "loopback_only" }, null, cancellationToken);
                return;
            }

            var path = context.Request.Url?.AbsolutePath ?? "/";
            var method = context.Request.HttpMethod.ToUpperInvariant();
            if (method == "OPTIONS")
            {
                await HandleOptionsAsync(context, path, cancellationToken);
                return;
            }

            if (path == BrowserExtensionBridgeProtocol.HealthPath && method == "GET")
            {
                await HandleHealthAsync(context, cancellationToken);
                return;
            }

            if (path == BrowserExtensionBridgeProtocol.PairPath && method == "POST")
            {
                await HandlePairAsync(context, cancellationToken);
                return;
            }

            if (path == BrowserExtensionBridgeProtocol.BootstrapPath && method == "POST")
            {
                await HandleBootstrapAsync(context, cancellationToken);
                return;
            }

            if (path == BrowserExtensionBridgeProtocol.PingPath && method == "POST")
            {
                await HandleHttpPingAsync(context, cancellationToken);
                return;
            }

            if (method == "GET" && TryGetMediaId(path, out var mediaId))
            {
                await HandleMediaDownloadAsync(context, mediaId, cancellationToken);
                return;
            }

            if (path == BrowserExtensionBridgeProtocol.WebSocketPath && method == "GET")
            {
                websocketAccepted = await HandleWebSocketAsync(context, cancellationToken);
                return;
            }

            await WriteJsonAsync(context.Response, 404, new { ok = false, error = "not_found" }, null, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (HttpListenerException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (ObjectDisposedException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception)
        {
            if (!websocketAccepted)
            {
                try
                {
                    await WriteJsonAsync(context.Response, 500, new { ok = false, error = "internal_error" }, null, CancellationToken.None);
                }
                catch (Exception) { }
            }
        }
        finally
        {
            if (!websocketAccepted)
            {
                try { context.Response.Close(); } catch (Exception) { }
            }
        }
    }

    private async Task HandleHealthAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!string.IsNullOrWhiteSpace(origin) && !IsAllowedExtensionOrigin(origin))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_origin_required" }, null, cancellationToken);
            return;
        }

        var status = Status;
        var payload = new JsonObject
        {
            ["ok"] = true,
            ["service"] = "chatgpt-comfy-connector",
            ["bridge_version"] = BrowserExtensionBridgeProtocol.BridgeVersion,
            ["protocol"] = BrowserExtensionBridgeProtocol.ProtocolVersion,
            ["bind_address"] = BrowserExtensionBridgeProtocol.BindAddress,
            ["port"] = status.Port,
            ["websocket_path"] = BrowserExtensionBridgeProtocol.WebSocketPath,
            ["bootstrap_path"] = BrowserExtensionBridgeProtocol.BootstrapPath,
            ["extension_connected"] = status.ConnectionState == BrowserExtensionConnectionState.Connected,
            ["connection_state"] = status.ConnectionStateText,
            ["pairing_state"] = status.PairingStateText,
            ["auth"] = new JsonObject
            {
                ["scheme"] = "pairing-credential",
                ["required"] = true,
                ["scope"] = "bootstrap",
            },
        };

        // Health is intentionally metadata-only.  Pairing and bootstrap are
        // separate authenticated operations so a normal browser page or a
        // local CLI can never obtain a session token from this endpoint.
        await WriteJsonAsync(context.Response, 200, payload, origin, cancellationToken);
    }

    private async Task HandlePairAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedClientRequest(context.Request))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_client_required" }, null, cancellationToken);
            return;
        }

        string pairingCode;
        try
        {
            var body = await ReadRequestBodyAsync(context.Request, MaxHttpBodyBytes, cancellationToken);
            pairingCode = ParsePairingCode(body);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            await WriteJsonAsync(context.Response, 400, new { ok = false, error = "invalid_pairing_code" }, origin, cancellationToken);
            return;
        }

        await _pairingGate.WaitAsync(cancellationToken);
        try
        {
            if (!IsPairingCodeValid(pairingCode))
            {
                await WriteJsonAsync(context.Response, 401, new { ok = false, error = "invalid_pairing_code" }, origin, cancellationToken);
                return;
            }

            var pairingId = Guid.NewGuid().ToString("N");
            var pairingCredential = CreateAccessToken();
            var record = new BrowserExtensionPairingRecord(
                pairingId,
                HashSecret(pairingCredential),
                DateTimeOffset.UtcNow);
            if (_pairingStore is not null)
            {
                await _pairingStore.SaveBrowserExtensionPairingAsync(record, cancellationToken);
            }

            _pairingId = pairingId;
            _pairingCredentialHash = record.CredentialHash;
            InvalidatePairingCode();
            PublishStatus(CreateStatus(
                isRunning: true,
                connectionState: Status.ConnectionState,
                _port,
                Status.ClientOrigin,
                Status.ConnectedAt,
                lastError: null,
                pairingState: BrowserExtensionPairingState.Paired,
                pairingCode: null,
                pairingCodeExpiresAt: null));

            await WriteJsonAsync(context.Response, 200, new
            {
                ok = true,
                pairing_id = pairingId,
                pairing_credential = pairingCredential,
                protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
                bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
            }, origin, cancellationToken);
        }
        finally
        {
            _pairingGate.Release();
        }
    }

    private async Task HandleBootstrapAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedClientRequest(context.Request))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_client_required" }, null, cancellationToken);
            return;
        }

        if (!IsPairingCredentialValid(GetBearerToken(context.Request)))
        {
            context.Response.Headers["WWW-Authenticate"] = "Bearer";
            await WriteJsonAsync(context.Response, 401, new { ok = false, error = "invalid_pairing_credential" }, origin, cancellationToken);
            return;
        }

        EnsureSessionToken();
        await WriteJsonAsync(context.Response, 200, new
        {
            ok = true,
            pairing_id = _pairingId,
            protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
            bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
            session_token = _accessToken,
            session_expires_at = _accessTokenExpiresAt,
            websocket_path = BrowserExtensionBridgeProtocol.WebSocketPath,
        }, origin, cancellationToken);
    }

    private async Task HandleHttpPingAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedClientRequest(context.Request))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_client_required" }, null, cancellationToken);
            return;
        }

        if (!IsAccessTokenValid(GetBearerToken(context.Request)))
        {
            context.Response.Headers["WWW-Authenticate"] = "Bearer";
            await WriteJsonAsync(context.Response, 401, new { ok = false, error = "invalid_session_token" }, origin, cancellationToken);
            return;
        }

        string? requestId;
        try
        {
            var body = await ReadRequestBodyAsync(context.Request, MaxHttpBodyBytes, cancellationToken);
            requestId = ParseRequestId(body);
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            await WriteJsonAsync(context.Response, 400, new { ok = false, error = "invalid_ping_body" }, origin, cancellationToken);
            return;
        }

        await WriteJsonAsync(context.Response, 200, new
        {
            type = "pong",
            id = requestId,
            timestamp = DateTimeOffset.UtcNow,
            bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
        }, origin, cancellationToken);
    }

    private async Task HandleMediaDownloadAsync(
        HttpListenerContext context,
        string mediaId,
        CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedClientRequest(context.Request))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_client_required" }, null, cancellationToken);
            return;
        }

        if (!IsAccessTokenValid(GetBearerToken(context.Request)))
        {
            context.Response.Headers["WWW-Authenticate"] = "Bearer";
            await WriteJsonAsync(context.Response, 401, new { ok = false, error = "invalid_session_token" }, origin, cancellationToken);
            return;
        }

        var sessionId = context.Request.QueryString["session_id"];
        var iterationText = context.Request.QueryString["iteration"];
        if (!IsSafeIdentifier(sessionId ?? string.Empty)
            || !int.TryParse(iterationText, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var iteration)
            || iteration <= 0)
        {
            await WriteJsonAsync(context.Response, 400, new { ok = false, error = "invalid_media_request" }, origin, cancellationToken);
            return;
        }

        RemoveExpiredMedia();
        if (!_registeredMedia.TryGetValue(mediaId, out var media))
        {
            await WriteJsonAsync(context.Response, 404, new { ok = false, error = "media_not_found" }, origin, cancellationToken);
            return;
        }
        if (media.ExpiresAt <= DateTimeOffset.UtcNow)
        {
            _registeredMedia.TryRemove(mediaId, out _);
            await WriteJsonAsync(context.Response, 410, new { ok = false, error = "media_expired" }, origin, cancellationToken);
            return;
        }
        if (!string.Equals(media.SessionId, sessionId, StringComparison.Ordinal)
            || media.Iteration != iteration)
        {
            // Do not reveal whether a different session's media id exists.
            await WriteJsonAsync(context.Response, 404, new { ok = false, error = "media_not_found" }, origin, cancellationToken);
            return;
        }

        if (!PathSafety.IsWithin(media.AllowedRoot, media.FullPath) || !File.Exists(media.FullPath))
        {
            await WriteJsonAsync(context.Response, 404, new { ok = false, error = "media_not_found" }, origin, cancellationToken);
            return;
        }

        var fileInfo = new FileInfo(media.FullPath);
        if (fileInfo.Length != media.Size || fileInfo.Length <= 0 || fileInfo.Length > MaxReviewMediaBytes)
        {
            await WriteJsonAsync(context.Response, 409, new { ok = false, error = "media_changed" }, origin, cancellationToken);
            return;
        }

        if (IsAllowedExtensionOrigin(origin)) AddCorsHeaders(context.Response, origin!);
        context.Response.StatusCode = 200;
        context.Response.ContentType = media.MimeType;
        context.Response.ContentLength64 = media.Size;
        context.Response.KeepAlive = false;
        context.Response.Headers["Content-Disposition"] = $"attachment; filename=\"{media.FileName}\"";
        try
        {
            await using var stream = new FileStream(
                media.FullPath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                bufferSize: 64 * 1024,
                options: FileOptions.Asynchronous | FileOptions.SequentialScan);
            await stream.CopyToAsync(context.Response.OutputStream, 64 * 1024, cancellationToken);
            PublishDiagnostic("media streamed", mediaId: media.MediaId, iteration: media.Iteration);
        }
        catch (FileNotFoundException)
        {
            // The output can be removed outside the Connector after it was
            // registered. Keep the endpoint response generic and path-free.
            try { context.Response.StatusCode = 404; } catch (Exception) { }
        }
        catch (IOException)
        {
            try { context.Response.StatusCode = 409; } catch (Exception) { }
        }
    }

    private async Task HandleOptionsAsync(HttpListenerContext context, string path, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedExtensionOrigin(origin)
            || path is not (BrowserExtensionBridgeProtocol.HealthPath
                or BrowserExtensionBridgeProtocol.PairPath
                or BrowserExtensionBridgeProtocol.BootstrapPath
                or BrowserExtensionBridgeProtocol.PingPath)
                && !TryGetMediaId(path, out _))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_origin_required" }, null, cancellationToken);
            return;
        }

        AddCorsHeaders(context.Response, origin!);
        context.Response.StatusCode = 204;
        context.Response.ContentLength64 = 0;
    }

    private async Task<bool> HandleWebSocketAsync(HttpListenerContext context, CancellationToken cancellationToken)
    {
        var origin = GetOrigin(context.Request);
        if (!IsAllowedExtensionOrigin(origin))
        {
            await WriteJsonAsync(context.Response, 403, new { ok = false, error = "extension_origin_required" }, null, cancellationToken);
            return false;
        }

        if (!context.Request.IsWebSocketRequest)
        {
            await WriteJsonAsync(context.Response, 426, new { ok = false, error = "websocket_upgrade_required" }, origin, cancellationToken);
            return false;
        }

        var websocketContext = await context.AcceptWebSocketAsync(null);
        var socket = websocketContext.WebSocket;
        try
        {
            PublishStatus(CreateStatus(
                isRunning: true,
                BrowserExtensionConnectionState.Connecting,
                _port,
                clientOrigin: origin,
                connectedAt: null,
                lastError: null,
                pairingState: GetPairingState(),
                pairingCode: _pairingCode,
                pairingCodeExpiresAt: _pairingCodeExpiresAt));

            using var helloCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            helloCts.CancelAfter(HelloTimeout);
            var helloText = await ReceiveTextMessageAsync(socket, helloCts.Token);
            if (!TryParseHello(helloText, out var suppliedToken, out var helloError)
                || !IsAccessTokenValid(suppliedToken))
            {
                await SendErrorAndCloseAsync(socket, helloError ?? "invalid_session_token");
                PublishDiagnostic("hello rejected", status: "ERROR", errorCode: helloError ?? "invalid_session_token");
                PublishStatus(CreateStatus(
                    isRunning: true,
                    BrowserExtensionConnectionState.Error,
                    _port,
                    clientOrigin: null,
                    connectedAt: null,
                    lastError: helloError ?? "invalid_session_token",
                    pairingState: GetPairingState(),
                    pairingCode: _pairingCode,
                    pairingCodeExpiresAt: _pairingCodeExpiresAt));
                return true;
            }

            await ReplaceClientAsync(socket, origin!, cancellationToken);
            await SendJsonAsync(socket, new
            {
                type = "hello.ack",
                protocol = BrowserExtensionBridgeProtocol.ProtocolVersion,
                server = "desktop",
                bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
                timestamp = DateTimeOffset.UtcNow,
            }, cancellationToken);
            await SendJsonAsync(socket, new
            {
                type = "event",
                @event = "desktop.ready",
                event_id = Guid.NewGuid().ToString("N"),
                timestamp = DateTimeOffset.UtcNow,
                data = new
                {
                    message = "Desktop Connector is ready",
                    bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
                    bind_address = BrowserExtensionBridgeProtocol.BindAddress,
                    port = _port,
                },
            }, cancellationToken);

            using var sessionCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            sessionCts.CancelAfter(GetSessionTokenRemaining());
            await ReceiveClientMessagesAsync(socket, sessionCts.Token);
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return true;
        }
        catch (OperationCanceledException)
        {
            // The process-scoped session token expired. The Extension will
            // bootstrap a fresh token on its reconnect attempt.
            return true;
        }
        catch (WebSocketException)
        {
            return true;
        }
        catch (ObjectDisposedException)
        {
            return true;
        }
        finally
        {
            RemoveClient(socket);
            await CloseSocketAsync(socket, WebSocketCloseStatus.NormalClosure, "bridge closing", CancellationToken.None);
        }
    }

    private async Task ReplaceClientAsync(WebSocket socket, string origin, CancellationToken cancellationToken)
    {
        WebSocket? previous;
        lock (_clientGate)
        {
            previous = _clientSocket;
            _clientSocket = socket;
            _clientGeneration++;
        }

        if (previous is not null && !ReferenceEquals(previous, socket))
        {
            // Keep request correlation alive across the replacement. The new
            // authenticated Extension connection can still return the result
            // for a Handoff already posted by the previous connection.
            await CloseSocketAsync(previous, WebSocketCloseStatus.PolicyViolation, "replaced by a newer extension connection", cancellationToken);
        }

        PublishStatus(CreateStatus(
            isRunning: true,
            BrowserExtensionConnectionState.Connected,
            _port,
            clientOrigin: origin,
            connectedAt: DateTimeOffset.UtcNow,
            lastError: null,
            pairingState: GetPairingState(),
            pairingCode: _pairingCode,
            pairingCodeExpiresAt: _pairingCodeExpiresAt));
        PublishDiagnostic("bridge connected", status: Status.ConnectionStateText);
    }

    private async Task ReceiveClientMessagesAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && socket.State == WebSocketState.Open)
        {
            var text = await ReceiveTextMessageAsync(socket, cancellationToken);
            if (text is null) return;

            try
            {
                using var document = JsonDocument.Parse(text);
                var root = document.RootElement;
                var type = GetString(root, "type");
                if (type == "ping")
                {
                    var id = GetString(root, "id");
                    await SendJsonAsync(socket, new
                    {
                        type = "pong",
                        id,
                        timestamp = DateTimeOffset.UtcNow,
                        bridge_version = BrowserExtensionBridgeProtocol.BridgeVersion,
                    }, cancellationToken);
                }
                else if (type == "handoff.result")
                {
                    if (!TryParseHandoffResult(text, out var result, out var resultError))
                    {
                        PublishDiagnostic("result rejected", status: "error", errorCode: resultError ?? "invalid_handoff_result");
                        await SendJsonAsync(socket, new
                        {
                            type = "error",
                            code = resultError ?? "invalid_handoff_result",
                            message = "Handoff送信結果を解釈できません。",
                        }, cancellationToken);
                        continue;
                    }

                    if (!IsCurrentClient(socket))
                    {
                        PublishDiagnostic(
                            "result rejected",
                            result.RequestId,
                            result.HandoffId,
                            result.Status,
                            "stale_bridge_connection",
                            "handoff_result_connection",
                            targetTabId: result.TargetTabId);
                        continue;
                    }

                    PublishDiagnostic(
                        "handoff.result received",
                        result.RequestId,
                        result.HandoffId,
                        result.Status,
                        result.ErrorCode,
                        "handoff_result_received",
                        targetTabId: result.TargetTabId);
                    if (_pendingHandoffs.TryRemove(result.RequestId, out var pending))
                    {
                        var completed = string.Equals(result.HandoffId, pending.HandoffId, StringComparison.Ordinal)
                            ? result
                            : HandoffError(
                                result.RequestId,
                                pending.HandoffId,
                                BrowserExtensionHandoffErrorCodes.SendFailed,
                                "Handoff送信結果の識別子が一致しません。",
                                "result_validation");
                        PublishDiagnostic("result status", completed.RequestId, completed.HandoffId, completed.Status, completed.ErrorCode, completed.Stage);
                        pending.Completion.TrySetResult(completed);
                    }
                    else
                    {
                        PublishDiagnostic("result status", result.RequestId, result.HandoffId, result.Status, result.ErrorCode, result.Stage);
                    }

                    // `WebSocket.SendAsync` on the Extension side can
                    // succeed while this server is replacing the old client
                    // connection. An explicit receipt lets the Extension
                    // retain/retry the envelope until this current Bridge
                    // instance has actually accepted it.
                    await SendDeliveryAckAsync(
                        socket,
                        "handoff.result",
                        result.RequestId,
                        result.HandoffId,
                        cancellationToken);
                }
                else if (type is "chatgpt.context.list.response" or "chatgpt.context.current.response")
                {
                    if (!TryParseChatGptContextSnapshot(text, out var context, out var contextError, out var currentOnly))
                    {
                        PublishDiagnostic("chatgpt.context rejected", requestId: GetString(root, "request_id"), status: "error", errorCode: contextError ?? "invalid_context_response", stage: "context_response_envelope");
                        await SendJsonAsync(socket, new
                        {
                            type = "error",
                            code = contextError ?? "invalid_context_response",
                            message = "ChatGPT Context responseを解釈できません。",
                        }, cancellationToken);
                        continue;
                    }

                    if (!IsCurrentClient(socket))
                    {
                        PublishDiagnostic("chatgpt.context rejected", requestId: context.RequestId, status: "error", errorCode: "stale_bridge_connection", stage: "context_response_connection");
                        continue;
                    }

                    if (_pendingChatGptContextRequests.TryRemove(context.RequestId, out var pending))
                    {
                        var completed = pending.CurrentOnly == currentOnly
                            ? context
                            : ContextError(context.RequestId, "context_response_mode_mismatch", "ChatGPT Context responseの種別が一致しません。", "context_response_validation");
                        PublishDiagnostic("chatgpt.context result", requestId: completed.RequestId, status: completed.Status, errorCode: completed.ErrorCode, stage: completed.Stage);
                        pending.Completion.TrySetResult(completed);
                    }
                    else
                    {
                        PublishDiagnostic("chatgpt.context result", requestId: context.RequestId, status: context.Status, errorCode: context.ErrorCode, stage: context.Stage);
                    }
                }
                else if (type is "chatgpt.context.current" or "chatgpt.context.changed")
                {
                    if (!TryParseChatGptCurrentContext(text, out var current, out var currentError))
                    {
                        PublishDiagnostic("chatgpt.context current rejected", status: "error", errorCode: currentError ?? "invalid_current_context", stage: "context_current_envelope");
                        continue;
                    }

                    if (!IsCurrentClient(socket))
                    {
                        PublishDiagnostic("chatgpt.context current rejected", status: "error", errorCode: "stale_bridge_connection", stage: "context_current_connection");
                        continue;
                    }

                    PublishDiagnostic("chatgpt.context current received", status: "ok", stage: "context_current_received");
                    try { ChatGptContextChanged?.Invoke(this, new BrowserExtensionChatGptContextChangedEventArgs(current)); }
                    catch (Exception) { }
                }
                else if (type == "assistant.response")
                {
                    if (!TryParseAssistantResponse(text, out var response, out var responseError))
                    {
                        PublishDiagnostic("assistant response rejected", status: "error", errorCode: responseError ?? "invalid_assistant_response", stage: "response_envelope");
                        await SendJsonAsync(socket, new
                        {
                            type = "error",
                            code = responseError ?? "invalid_assistant_response",
                            message = "Assistant response envelopeを解釈できません。",
                        }, cancellationToken);
                        continue;
                    }

                    if (!IsCurrentClient(socket))
                    {
                        PublishDiagnostic("assistant response rejected", response.RequestId, response.HandoffId, response.Status, "stale_bridge_connection", "response_connection");
                        continue;
                    }

                    PublishDiagnostic(
                        "assistant response received",
                        response.RequestId,
                        response.HandoffId,
                        response.Status,
                        response.ErrorCode,
                        response.Stage,
                        sessionId: response.SessionId,
                        boundaryId: response.BoundaryId,
                        targetTabId: response.TargetTabId);
                    PublishDiagnostic(
                        "assistant response bridge received",
                        response.RequestId,
                        response.HandoffId,
                        response.Status,
                        response.ErrorCode,
                        "assistant_response_received",
                        sessionId: response.SessionId,
                        boundaryId: response.BoundaryId,
                        targetTabId: response.TargetTabId);
                    try { AssistantResponseReceived?.Invoke(this, new BrowserExtensionAssistantResponseEventArgs(response)); }
                    catch (Exception) { }
                    await SendDeliveryAckAsync(
                        socket,
                        "assistant.response",
                        response.RequestId,
                        response.HandoffId,
                        cancellationToken);
                }
                else if (type == "review.media.result")
                {
                    if (!TryParseMediaAttachResult(text, out var result, out var resultError))
                    {
                        PublishDiagnostic("media result rejected", status: "error", errorCode: resultError ?? "invalid_media_result", stage: "media_result_envelope");
                        await SendJsonAsync(socket, new
                        {
                            type = "error",
                            code = resultError ?? "invalid_media_result",
                            message = "Review添付結果を解釈できません。",
                        }, cancellationToken);
                        continue;
                    }

                    if (_pendingMediaAttachments.TryRemove(result.RequestId, out var pending))
                    {
                        var matches = string.Equals(result.SessionId, pending.SessionId, StringComparison.Ordinal)
                            && result.Iteration == pending.Iteration
                            && string.Equals(result.MediaId, pending.MediaId, StringComparison.Ordinal);
                        var completed = matches
                            ? result
                            : MediaError(
                                result.RequestId,
                                pending.SessionId,
                                pending.Iteration,
                                pending.MediaId,
                                BrowserExtensionReviewMediaErrorCodes.AttachmentVerificationFailed,
                                "Review添付結果の識別子が一致しません。",
                                "media_result_validation");
                        PublishDiagnostic("result status", requestId: completed.RequestId, status: completed.Status, errorCode: completed.ErrorCode, stage: completed.Stage, mediaId: completed.MediaId, iteration: completed.Iteration);
                        pending.Completion.TrySetResult(completed);
                    }
                    else
                    {
                        PublishDiagnostic("result status", requestId: result.RequestId, status: result.Status, errorCode: result.ErrorCode, stage: result.Stage, mediaId: result.MediaId, iteration: result.Iteration);
                    }
                }
                else
                {
                    await SendJsonAsync(socket, new
                    {
                        type = "error",
                        code = "unsupported_message",
                        message = "このalpha Bridgeはhello、ping、handoff.result、chatgpt.context、assistant.response、review.media.resultだけを受け付けます。",
                    }, cancellationToken);
                }
            }
            catch (JsonException)
            {
                await SendJsonAsync(socket, new
                {
                    type = "error",
                    code = "invalid_json",
                    message = "JSON messageを解釈できません。",
                }, cancellationToken);
            }
        }
    }

    private async Task SendErrorAndCloseAsync(WebSocket socket, string code)
    {
        try
        {
            await SendJsonAsync(socket, new { type = "error", code }, CancellationToken.None);
        }
        catch (Exception) { }

        await CloseSocketAsync(socket, WebSocketCloseStatus.PolicyViolation, code, CancellationToken.None);
    }

    private async Task SendJsonAsync(WebSocket socket, object value, CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(value, JsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        await _sendGate.WaitAsync(cancellationToken);
        try
        {
            if (socket.State != WebSocketState.Open) throw new WebSocketException("WebSocket is not open.");
            await socket.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, cancellationToken);
        }
        finally
        {
            _sendGate.Release();
        }
    }

    private async Task SendDeliveryAckAsync(
        WebSocket socket,
        string deliveryType,
        string requestId,
        string handoffId,
        CancellationToken cancellationToken)
    {
        try
        {
            await SendJsonAsync(socket, new
            {
                type = "bridge.delivery.ack",
                delivery_type = deliveryType,
                request_id = requestId,
                handoff_id = handoffId,
                status = "received",
            }, cancellationToken);
        }
        catch (Exception)
        {
            // The Extension keeps the envelope when this acknowledgement is
            // lost and retries it on the next authenticated socket.
        }
    }

    private static async Task CloseSocketAsync(
        WebSocket socket,
        WebSocketCloseStatus closeStatus,
        string description,
        CancellationToken cancellationToken)
    {
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                await socket.CloseAsync(closeStatus, description, cancellationToken);
            }
        }
        catch (Exception) { }
        finally
        {
            socket.Dispose();
        }
    }

    private void RemoveClient(WebSocket socket)
    {
        var removed = false;
        long disconnectedGeneration = 0;
        lock (_clientGate)
        {
            if (ReferenceEquals(_clientSocket, socket))
            {
                _clientSocket = null;
                disconnectedGeneration = ++_clientGeneration;
                removed = true;
            }
        }

        if (removed && _serverCts is { IsCancellationRequested: false })
        {
            SchedulePendingHandoffFailure(disconnectedGeneration);
            FailPendingMediaAttachments(BrowserExtensionReviewMediaErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。");
            FailPendingChatGptContextRequests("Browser Extension Bridgeとの接続が終了しました。");
            PublishStatus(CreateStatus(
                isRunning: true,
                BrowserExtensionConnectionState.Disconnected,
                _port,
                clientOrigin: null,
                connectedAt: null,
                lastError: null,
                pairingState: GetPairingState(),
                pairingCode: _pairingCode,
                pairingCodeExpiresAt: _pairingCodeExpiresAt));
            PublishDiagnostic("bridge disconnected", status: Status.ConnectionStateText);
        }
    }

    private void SchedulePendingHandoffFailure(long disconnectedGeneration)
    {
        _ = FailPendingHandoffsAfterReconnectGraceAsync(disconnectedGeneration);
    }

    private async Task FailPendingHandoffsAfterReconnectGraceAsync(long disconnectedGeneration)
    {
        var serverToken = _serverCts?.Token ?? CancellationToken.None;
        try
        {
            await Task.Delay(BridgeReconnectGrace, serverToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        lock (_clientGate)
        {
            if (_clientSocket is not null || _clientGeneration != disconnectedGeneration) return;
        }

        FailPendingHandoffs(BrowserExtensionHandoffErrorCodes.BridgeDisconnected, "Browser Extension Bridgeとの接続が終了しました。");
    }

    private bool IsCurrentClient(WebSocket socket)
    {
        lock (_clientGate) return ReferenceEquals(_clientSocket, socket);
    }

    private void FailPendingHandoffs(string errorCode, string message)
    {
        foreach (var pair in _pendingHandoffs.ToArray())
        {
            if (_pendingHandoffs.TryRemove(pair.Key, out var pending))
            {
                pending.Completion.TrySetResult(HandoffError(
                    pair.Key,
                    pending.HandoffId,
                    errorCode,
                    message,
                    "bridge_connection"));
            }
        }
    }

    private void FailPendingMediaAttachments(string errorCode, string message)
    {
        foreach (var pair in _pendingMediaAttachments.ToArray())
        {
            if (_pendingMediaAttachments.TryRemove(pair.Key, out var pending))
            {
                pending.Completion.TrySetResult(MediaError(
                    pair.Key,
                    pending.SessionId,
                    pending.Iteration,
                    pending.MediaId,
                    errorCode,
                    message,
                    "bridge_connection"));
            }
        }
    }

    private void FailPendingChatGptContextRequests(string message)
    {
        foreach (var pair in _pendingChatGptContextRequests.ToArray())
        {
            if (_pendingChatGptContextRequests.TryRemove(pair.Key, out var pending))
            {
                pending.Completion.TrySetResult(ContextError(
                    pair.Key,
                    "bridge_disconnected",
                    message,
                    "bridge_connection"));
            }
        }
    }

    private bool IsAccessTokenValid(string? suppliedToken)
    {
        var expectedToken = _accessToken;
        if (string.IsNullOrWhiteSpace(expectedToken)
            || string.IsNullOrWhiteSpace(suppliedToken)
            || _accessTokenExpiresAt is not { } expiresAt
            || expiresAt <= DateTimeOffset.UtcNow)
        {
            return false;
        }

        var expected = Encoding.UTF8.GetBytes(expectedToken);
        var supplied = Encoding.UTF8.GetBytes(suppliedToken);
        return CryptographicOperations.FixedTimeEquals(expected, supplied);
    }

    private TimeSpan GetSessionTokenRemaining()
    {
        var remaining = (_accessTokenExpiresAt ?? DateTimeOffset.UtcNow) - DateTimeOffset.UtcNow;
        return remaining > TimeSpan.Zero ? remaining : TimeSpan.FromMilliseconds(1);
    }

    private bool IsPairingCredentialValid(string? suppliedCredential)
    {
        var expectedHash = _pairingCredentialHash;
        if (string.IsNullOrWhiteSpace(expectedHash) || string.IsNullOrWhiteSpace(suppliedCredential)) return false;

        var expected = Encoding.UTF8.GetBytes(expectedHash);
        var supplied = Encoding.UTF8.GetBytes(HashSecret(suppliedCredential));
        return CryptographicOperations.FixedTimeEquals(expected, supplied);
    }

    private void EnsureSessionToken()
    {
        if (!string.IsNullOrWhiteSpace(_accessToken)
            && _accessTokenExpiresAt is { } expiresAt
            && expiresAt > DateTimeOffset.UtcNow)
        {
            return;
        }

        _accessToken = CreateAccessToken();
        _accessTokenExpiresAt = DateTimeOffset.UtcNow.Add(SessionTokenLifetime);
    }

    private BrowserExtensionPairingState GetPairingState()
        => string.IsNullOrWhiteSpace(_pairingCredentialHash)
            ? BrowserExtensionPairingState.Required
            : BrowserExtensionPairingState.Paired;

    private bool IsPairingCodeValid(string suppliedCode)
    {
        if (string.IsNullOrWhiteSpace(_pairingCode)
            || _pairingCodeExpiresAt is not { } expiresAt
            || expiresAt <= DateTimeOffset.UtcNow
            || _pairingAttempts >= MaxPairingAttempts)
        {
            return false;
        }

        _pairingAttempts++;
        var expected = Encoding.UTF8.GetBytes(HashSecret(NormalizePairingCode(_pairingCode)));
        var supplied = Encoding.UTF8.GetBytes(HashSecret(suppliedCode));
        return CryptographicOperations.FixedTimeEquals(expected, supplied);
    }

    private void InvalidatePairingCode()
    {
        _pairingCode = null;
        _pairingCodeExpiresAt = null;
        _pairingAttempts = MaxPairingAttempts;
    }

    private void PublishStatus(BrowserExtensionBridgeStatus status)
    {
        _status = status;
        try { StatusChanged?.Invoke(this, new BrowserExtensionBridgeStatusChangedEventArgs(status)); }
        catch (Exception) { }
    }

    private void PublishDiagnostic(
        string eventName,
        string? requestId = null,
        string? handoffId = null,
        string? status = null,
        string? errorCode = null,
        string? stage = null,
        string? mediaId = null,
        int? iteration = null,
        int? targetTabId = null,
        string? sessionId = null,
        string? boundaryId = null)
    {
        var diagnostic = new BrowserExtensionBridgeDiagnostic(
            eventName,
            requestId,
            handoffId,
            status,
            errorCode,
            stage,
            mediaId,
            iteration,
            targetTabId,
            sessionId,
            boundaryId);
        try { Diagnostic?.Invoke(this, new BrowserExtensionBridgeDiagnosticEventArgs(diagnostic)); }
        catch (Exception) { }
    }

    private BrowserExtensionBridgeStatus CreateStatus(
        bool isRunning,
        BrowserExtensionConnectionState connectionState,
        int port,
        string? clientOrigin,
        DateTimeOffset? connectedAt,
        string? lastError,
        BrowserExtensionPairingState pairingState,
        string? pairingCode,
        DateTimeOffset? pairingCodeExpiresAt)
        => new(
            isRunning,
            connectionState,
            pairingState,
            BrowserExtensionBridgeProtocol.BindAddress,
            port,
            clientOrigin,
            connectedAt,
            lastError,
            DateTimeOffset.UtcNow,
            pairingCode,
            pairingCodeExpiresAt);

    private static bool IsLoopbackRequest(HttpListenerContext context)
        => context.Request.RemoteEndPoint?.Address.Equals(IPAddress.Loopback) == true;

    private static string? GetOrigin(HttpListenerRequest request)
        => request.Headers["Origin"]?.Trim();

    private static bool IsAllowedClientRequest(HttpListenerRequest request)
    {
        if (!string.Equals(
                request.Headers[BrowserExtensionBridgeProtocol.ClientHeaderName],
                BrowserExtensionBridgeProtocol.ClientHeaderValue,
                StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        // Chromium extension service-worker Fetch may omit Origin even when
        // host_permissions authorize the loopback request. The explicit
        // client header is required in that case. Normal web pages carry a
        // non-extension Origin and are rejected below.
        var origin = GetOrigin(request);
        return string.IsNullOrWhiteSpace(origin) || IsAllowedExtensionOrigin(origin);
    }

    private static bool IsAllowedExtensionOrigin(string? origin)
    {
        if (string.IsNullOrWhiteSpace(origin) || !Uri.TryCreate(origin, UriKind.Absolute, out var uri)) return false;
        // Chrome uses chrome-extension://.  Edge extension pages can expose
        // extension://, while some Chromium hosts use edge-extension://.
        // Keep the accepted schemes explicit; never accept an arbitrary web
        // origin here.
        if (uri.Scheme is not ("chrome-extension" or "extension" or "edge-extension")) return false;
        if (string.IsNullOrWhiteSpace(uri.Host) || !string.IsNullOrWhiteSpace(uri.UserInfo)) return false;
        if (uri.Port != -1 || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        return uri.AbsolutePath is "" or "/";
    }

    private static void AddCorsHeaders(HttpListenerResponse response, string origin)
    {
        response.Headers["Access-Control-Allow-Origin"] = origin;
        response.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
        response.Headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type, X-Connector-Client";
        response.Headers["Access-Control-Max-Age"] = "600";
        response.Headers["Vary"] = "Origin";
    }

    private static async Task WriteJsonAsync(
        HttpListenerResponse response,
        int statusCode,
        object value,
        string? origin,
        CancellationToken cancellationToken)
    {
        if (IsAllowedExtensionOrigin(origin)) AddCorsHeaders(response, origin!);
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, JsonOptions);
        response.StatusCode = statusCode;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentEncoding = Encoding.UTF8;
        response.ContentLength64 = bytes.Length;
        response.KeepAlive = false;
        await response.OutputStream.WriteAsync(bytes.AsMemory(), cancellationToken);
    }

    private static async Task<string> ReadRequestBodyAsync(
        HttpListenerRequest request,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        if (request.ContentLength64 > maxBytes) throw new InvalidDataException("Request body is too large.");

        var buffer = ArrayPool<byte>.Shared.Rent(Math.Min(maxBytes, 4096));
        try
        {
            using var body = new MemoryStream();
            while (true)
            {
                var read = await request.InputStream.ReadAsync(buffer.AsMemory(), cancellationToken);
                if (read == 0) break;
                if (body.Length + read > maxBytes) throw new InvalidDataException("Request body is too large.");
                body.Write(buffer, 0, read);
            }

            return Encoding.UTF8.GetString(body.ToArray());
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static string? ParseRequestId(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) return null;
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
        var id = GetString(document.RootElement, "id");
        if (id is { Length: > 128 }) throw new JsonException();
        return id;
    }

    private static string ParsePairingCode(string body)
    {
        if (string.IsNullOrWhiteSpace(body)) throw new JsonException();
        using var document = JsonDocument.Parse(body);
        if (document.RootElement.ValueKind != JsonValueKind.Object) throw new JsonException();
        var code = GetString(document.RootElement, "pairing_code")
            ?? GetString(document.RootElement, "code");
        var normalized = NormalizePairingCode(code);
        if (normalized.Length != 12 || normalized.Any(static character => !char.IsLetterOrDigit(character)))
        {
            throw new JsonException();
        }

        return normalized;
    }

    private static async Task<string?> ReceiveTextMessageAsync(WebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = ArrayPool<byte>.Shared.Rent(4096);
        try
        {
            using var message = new MemoryStream();
            while (true)
            {
                var result = await socket.ReceiveAsync(buffer.AsMemory(), cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) return null;
                if (result.MessageType != WebSocketMessageType.Text) throw new InvalidDataException("Only text WebSocket messages are supported.");
                if (message.Length + result.Count > MaxWebSocketMessageBytes) throw new InvalidDataException("WebSocket message is too large.");
                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage) return Encoding.UTF8.GetString(message.ToArray());
            }
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static bool TryParseHello(string? text, out string? token, out string? error)
    {
        token = null;
        error = null;
        if (string.IsNullOrWhiteSpace(text))
        {
            error = "invalid_hello";
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || GetString(root, "type") != "hello"
                || GetString(root, "protocol") != BrowserExtensionBridgeProtocol.ProtocolVersion
                || GetString(root, "client") != BrowserExtensionBridgeProtocol.ExtensionClientName)
            {
                error = "invalid_hello";
                return false;
            }

            token = GetString(root, "token");
            if (string.IsNullOrWhiteSpace(token)) error = "invalid_session_token";
            return error is null;
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private static string? GetBearerToken(HttpListenerRequest request)
    {
        const string prefix = "Bearer ";
        var value = request.Headers["Authorization"]?.Trim();
        return value is not null && value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            ? value[prefix.Length..].Trim()
            : null;
    }

    private static string? GetString(JsonElement element, string propertyName)
        => element.TryGetProperty(propertyName, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static string BuildHttpEndpoint(int port)
        => $"http://{BrowserExtensionBridgeProtocol.BindAddress}:{port}";

    private static string CreateAccessToken()
        => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

    private static string CreatePairingCode()
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        Span<byte> random = stackalloc byte[12];
        RandomNumberGenerator.Fill(random);
        Span<char> code = stackalloc char[14];
        for (var index = 0; index < random.Length; index++)
        {
            code[index + (index >= 4 ? 1 : 0) + (index >= 8 ? 1 : 0)] = alphabet[random[index] % alphabet.Length];
        }
        code[4] = '-';
        code[9] = '-';

        return new string(code);
    }

    private static string NormalizePairingCode(string? value)
        => new((value ?? string.Empty)
            .Where(static character => char.IsLetterOrDigit(character))
            .Select(char.ToUpperInvariant)
            .ToArray());

    private static string HashSecret(string secret)
        => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(secret)));

    private static bool IsSafeEventName(string value)
        => value.Length is > 0 and <= 64
            && value.All(static character => char.IsLetterOrDigit(character) || character is '.' or '-' or '_');

    private static bool IsSafeIdentifier(string value)
        => value.Length is > 0 and <= 128
            && value.All(static character => char.IsLetterOrDigit(character) || character is '.' or '-' or '_');

    private static BrowserExtensionHandoffSendResult HandoffError(
        string requestId,
        string handoffId,
        string errorCode,
        string message,
        string? stage = null)
        => new(requestId, handoffId, "error", errorCode, message, stage);

    private static BrowserExtensionChatGptContextSnapshot ContextError(
        string requestId,
        string errorCode,
        string message,
        string? stage = null)
        => new(requestId, "error", [], [], null, errorCode, message, stage);

    private static BrowserExtensionMediaAttachResult MediaError(
        BrowserExtensionMediaAttachRequest request,
        string errorCode,
        string message,
        string? stage = null)
        => MediaError(request.RequestId, request.SessionId, request.Iteration, request.MediaId, errorCode, message, stage);

    private static BrowserExtensionMediaAttachResult MediaError(
        string requestId,
        string sessionId,
        int iteration,
        string mediaId,
        string errorCode,
        string message,
        string? stage = null)
        => new(requestId, sessionId, iteration, mediaId, "error", errorCode, message, stage);

    private static bool MediaMatchesRequest(
        RegisteredMedia media,
        BrowserExtensionMediaAttachRequest request)
        => string.Equals(media.SessionId, request.SessionId, StringComparison.Ordinal)
            && media.Iteration == request.Iteration
            && string.Equals(media.MediaId, request.MediaId, StringComparison.Ordinal)
            && string.Equals(media.FileName, request.FileName, StringComparison.Ordinal)
            && string.Equals(media.MimeType, request.MimeType, StringComparison.OrdinalIgnoreCase)
            && media.Size == request.Size;

    private void RemoveExpiredMedia()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var pair in _registeredMedia.ToArray())
        {
            if (pair.Value.ExpiresAt <= now) _registeredMedia.TryRemove(pair.Key, out _);
        }
    }

    private static bool TryGetMediaId(string? path, out string mediaId)
    {
        mediaId = string.Empty;
        if (string.IsNullOrWhiteSpace(path) || !path.StartsWith(BrowserExtensionBridgeProtocol.MediaPathPrefix, StringComparison.Ordinal)) return false;
        var encoded = path[BrowserExtensionBridgeProtocol.MediaPathPrefix.Length..];
        if (string.IsNullOrWhiteSpace(encoded) || encoded.Contains('/')) return false;
        try
        {
            mediaId = Uri.UnescapeDataString(encoded);
        }
        catch (UriFormatException)
        {
            return false;
        }

        return mediaId is not "." and not ".." && IsSafeIdentifier(mediaId);
    }

    private static bool IsSafeFileName(string value)
        => !string.IsNullOrWhiteSpace(value)
            && value.Length <= 255
            && value is not "." and not ".."
            && !value.Contains('/')
            && !value.Contains('\\')
            && string.Equals(Path.GetFileName(value), value, StringComparison.Ordinal)
            && !value.Any(static character => char.IsControl(character) || character is '"' or '\r' or '\n');

    private static bool IsChatGptUrl(string? value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)) return false;
        return uri.Scheme == Uri.UriSchemeHttps
            && string.Equals(uri.Host, "chatgpt.com", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrEmpty(uri.UserInfo)
            // Uri.Port exposes the scheme's default port (443 for https), so
            // use IsDefaultPort rather than comparing it with -1.  The latter
            // made every normal https://chatgpt.com conversation URL fail the
            // Phase 5.1 target validation.
            && uri.IsDefaultPort;
    }

    private static string? ConversationIdFromUrl(string value)
    {
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || !IsChatGptUrl(value)) return null;

        var segments = uri.AbsolutePath
            .Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        for (var index = 0; index < segments.Length - 1; index++)
        {
            if (!string.Equals(segments[index], "c", StringComparison.OrdinalIgnoreCase)) continue;
            var conversationId = Uri.UnescapeDataString(segments[index + 1]);
            return IsSafeIdentifier(conversationId) ? conversationId : null;
        }

        return null;
    }

    private static bool TryParseMediaAttachResult(
        string text,
        out BrowserExtensionMediaAttachResult result,
        out string? error)
    {
        result = new(string.Empty, string.Empty, 0, string.Empty, "error");
        error = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || GetString(root, "type") != "review.media.result")
            {
                error = "invalid_media_result";
                return false;
            }

            var requestId = GetString(root, "request_id");
            var sessionId = GetString(root, "session_id");
            var mediaId = GetString(root, "media_id");
            var status = GetString(root, "status");
            if (requestId is null || sessionId is null || mediaId is null
                || status is not ("attached" or "error")
                || !IsSafeIdentifier(requestId)
                || !IsSafeIdentifier(sessionId)
                || !IsSafeIdentifier(mediaId)
                || !root.TryGetProperty("iteration", out var iterationElement)
                || iterationElement.ValueKind != JsonValueKind.Number
                || !iterationElement.TryGetInt32(out var iteration)
                || iteration <= 0)
            {
                error = "invalid_media_result";
                return false;
            }

            var errorCode = GetString(root, "error_code");
            var message = GetString(root, "message");
            var stage = GetString(root, "stage");
            if (errorCode is { Length: > 64 } || (errorCode is not null && !IsSafeIdentifier(errorCode))
                || message is { Length: > 1024 }
                || stage is { Length: > 64 } || (stage is not null && !IsSafeIdentifier(stage)))
            {
                error = "invalid_media_result";
                return false;
            }

            result = new(requestId, sessionId, iteration, mediaId, status, errorCode, message, stage);
            return true;
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private static bool TryParseHandoffResult(
        string text,
        out BrowserExtensionHandoffSendResult result,
        out string? error)
    {
        result = new(string.Empty, string.Empty, "error");
        error = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || GetString(root, "type") != "handoff.result")
            {
                error = "invalid_handoff_result";
                return false;
            }

            var requestId = GetString(root, "request_id");
            var handoffId = GetString(root, "handoff_id");
            var status = GetString(root, "status");
            if (requestId is null || handoffId is null || status is not ("sent" or "error")
                || !IsSafeIdentifier(requestId)
                || !IsSafeIdentifier(handoffId))
            {
                error = "invalid_handoff_result";
                return false;
            }

            var errorCode = GetString(root, "error_code");
            var message = GetString(root, "message");
            var stage = GetString(root, "stage");
            if (errorCode is { Length: > 64 }
                || message is { Length: > 1024 }
                || stage is { Length: > 64 }
                || (stage is not null && !IsSafeIdentifier(stage)))
            {
                error = "invalid_handoff_result";
                return false;
            }

            int? targetTabId = null;
            if (root.TryGetProperty("target_tab_id", out var targetTabIdElement))
            {
                if (targetTabIdElement.ValueKind != JsonValueKind.Number
                    || !targetTabIdElement.TryGetInt32(out var parsedTargetTabId)
                    || parsedTargetTabId < 0)
                {
                    error = "invalid_handoff_result";
                    return false;
                }

                targetTabId = parsedTargetTabId;
            }

            var targetTabUrl = GetString(root, "target_tab_url");
            if (targetTabUrl is { Length: > 2048 } || (targetTabUrl is not null && !IsChatGptUrl(targetTabUrl)))
            {
                error = "invalid_handoff_result";
                return false;
            }

            var targetConversationId = GetString(root, "target_conversation_id");
            if (targetConversationId is { } conversationId && !IsSafeIdentifier(conversationId))
            {
                error = "invalid_handoff_result";
                return false;
            }

            var targetConversationUrl = GetString(root, "target_conversation_url");
            if (targetConversationUrl is { Length: > 2048 }
                || (targetConversationUrl is not null && !IsChatGptUrl(targetConversationUrl)))
            {
                error = "invalid_handoff_result";
                return false;
            }

            var targetProjectId = GetString(root, "target_project_id");
            if (targetProjectId is { } projectId && !IsSafeIdentifier(projectId))
            {
                error = "invalid_handoff_result";
                return false;
            }

            result = new(requestId, handoffId, status, errorCode, message, stage, targetTabId, targetTabUrl, targetConversationId, targetConversationUrl, targetProjectId);
            return true;
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private static bool TryParseChatGptContextSnapshot(
        string text,
        out BrowserExtensionChatGptContextSnapshot snapshot,
        out string? error,
        out bool currentOnly)
    {
        snapshot = new(string.Empty, "error", [], []);
        error = null;
        currentOnly = false;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            var type = root.ValueKind == JsonValueKind.Object ? GetString(root, "type") : null;
            currentOnly = type == "chatgpt.context.current.response";
            if (root.ValueKind != JsonValueKind.Object
                || type is not ("chatgpt.context.list.response" or "chatgpt.context.current.response"))
            {
                error = "invalid_context_response";
                return false;
            }

            var requestId = GetString(root, "request_id");
            var status = GetString(root, "status");
            if (requestId is null
                || !IsSafeIdentifier(requestId)
                || status is not ("ok" or "error"))
            {
                error = "invalid_context_response";
                return false;
            }

            var projects = new List<BrowserExtensionChatGptProjectEntry>();
            if (root.TryGetProperty("projects", out var projectsElement))
            {
                if (!TryParseContextProjects(projectsElement, projects, out error)) return false;
            }

            var conversations = new List<BrowserExtensionChatGptConversationEntry>();
            if (root.TryGetProperty("conversations", out var conversationsElement))
            {
                if (!TryParseContextConversations(conversationsElement, conversations, out error)) return false;
            }

            BrowserExtensionChatGptCurrentContext? current = null;
            if (root.TryGetProperty("current", out var currentElement)
                && currentElement.ValueKind is not JsonValueKind.Null)
            {
                if (!TryParseCurrentContextElement(currentElement, out current, out error)) return false;
            }

            var errorCode = GetString(root, "error_code");
            var message = GetString(root, "message");
            var stage = GetString(root, "stage");
            if (errorCode is { Length: > 64 } || (errorCode is not null && !IsSafeIdentifier(errorCode))
                || message is { Length: > 1024 }
                || stage is { Length: > 64 } || (stage is not null && !IsSafeIdentifier(stage)))
            {
                error = "invalid_context_response";
                return false;
            }

            snapshot = new(requestId, status, projects, conversations, current, errorCode, message, stage);
            return true;
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private static bool TryParseChatGptCurrentContext(
        string text,
        out BrowserExtensionChatGptCurrentContext context,
        out string? error)
    {
        context = new();
        error = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            var type = GetString(root, "type");
            if (root.ValueKind != JsonValueKind.Object
                || type is not ("chatgpt.context.current" or "chatgpt.context.changed"))
            {
                error = "invalid_current_context";
                return false;
            }

            var element = root.TryGetProperty("context", out var nested)
                ? nested
                : root;
            return TryParseCurrentContextElement(element, out context, out error);
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private static bool TryParseContextProjects(
        JsonElement element,
        List<BrowserExtensionChatGptProjectEntry> destination,
        out string? error)
    {
        error = null;
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() > MaxChatGptContextEntries)
        {
            error = "invalid_context_projects";
            return false;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) { error = "invalid_context_projects"; return false; }
            var id = GetString(item, "project_id");
            var title = GetString(item, "title");
            var url = GetString(item, "url");
            var discoveryKey = GetString(item, "discovery_key");
            var hasId = item.TryGetProperty("project_id", out var idElement)
                && idElement.ValueKind is not JsonValueKind.Null;
            var hasDiscoveryKey = item.TryGetProperty("discovery_key", out var discoveryElement)
                && discoveryElement.ValueKind is not JsonValueKind.Null;
            if (title is null || title.Length is 0 or > 512
                || hasId && (id is null || !IsSafeIdentifier(id))
                || hasDiscoveryKey && (discoveryKey is null || !IsSafeIdentifier(discoveryKey))
                || id is null && discoveryKey is null
                || url is { Length: > 2048 } || (url is not null && !IsChatGptUrl(url)))
            {
                error = "invalid_context_projects";
                return false;
            }

            destination.Add(new BrowserExtensionChatGptProjectEntry(id, title, url, discoveryKey));
        }

        return true;
    }

    private static bool TryParseContextConversations(
        JsonElement element,
        List<BrowserExtensionChatGptConversationEntry> destination,
        out string? error)
    {
        error = null;
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() > MaxChatGptContextEntries)
        {
            error = "invalid_context_conversations";
            return false;
        }

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) { error = "invalid_context_conversations"; return false; }
            var id = GetString(item, "conversation_id");
            var title = GetString(item, "title");
            var url = GetString(item, "url");
            var projectId = GetString(item, "project_id");
            var projectTitle = GetString(item, "project_title");
            if (id is null || title is null || url is null
                || !IsSafeIdentifier(id)
                || title.Length is 0 or > 512
                || url.Length > 2048
                || !IsChatGptUrl(url)
                || projectId is { } nonNullProjectId && !IsSafeIdentifier(nonNullProjectId)
                || projectTitle is { Length: > 512 })
            {
                error = "invalid_context_conversations";
                return false;
            }

            destination.Add(new BrowserExtensionChatGptConversationEntry(id, title, url, projectId, projectTitle));
        }

        return true;
    }

    private static bool TryParseCurrentContextElement(
        JsonElement element,
        out BrowserExtensionChatGptCurrentContext context,
        out string? error)
    {
        context = new();
        error = null;
        if (element.ValueKind != JsonValueKind.Object)
        {
            error = "invalid_current_context";
            return false;
        }

        var conversationId = GetString(element, "conversation_id") ?? GetString(element, "current_conversation_id");
        var title = GetString(element, "title") ?? GetString(element, "current_title");
        var url = GetString(element, "url") ?? GetString(element, "conversation_url") ?? GetString(element, "current_conversation_url");
        var projectId = GetString(element, "project_id") ?? GetString(element, "current_project_id");
        var projectTitle = GetString(element, "project_title") ?? GetString(element, "current_project_title");
        if (conversationId is { } nonNullConversationId && !IsSafeIdentifier(nonNullConversationId)
            || title is { Length: > 512 }
            || url is { Length: > 2048 } || (url is not null && !IsChatGptUrl(url))
            || projectId is { } nonNullProjectId && !IsSafeIdentifier(nonNullProjectId)
            || projectTitle is { Length: > 512 })
        {
            error = "invalid_current_context";
            return false;
        }

        context = new(conversationId, title, url, projectId, projectTitle);
        return true;
    }

    private static bool TryParseAssistantResponse(
        string text,
        out BrowserExtensionAssistantResponse response,
        out string? error)
    {
        response = new(string.Empty, string.Empty, string.Empty, string.Empty, "error");
        error = null;
        try
        {
            using var document = JsonDocument.Parse(text);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object || GetString(root, "type") != "assistant.response")
            {
                error = "invalid_assistant_response";
                return false;
            }

            var requestId = GetString(root, "request_id");
            var sessionId = GetString(root, "session_id");
            var handoffId = GetString(root, "handoff_id");
            var boundaryId = GetString(root, "boundary_id");
            var status = GetString(root, "status");
            if (requestId is null || sessionId is null || handoffId is null || boundaryId is null
                || status is not ("received" or "error")
                || !IsSafeIdentifier(requestId)
                || !IsSafeIdentifier(sessionId)
                || !IsSafeIdentifier(handoffId)
                || !IsSafeIdentifier(boundaryId))
            {
                error = "invalid_assistant_response";
                return false;
            }

            string? payload = null;
            if (root.TryGetProperty("payload", out var payloadElement))
            {
                if (payloadElement.ValueKind != JsonValueKind.String)
                {
                    error = "invalid_assistant_response";
                    return false;
                }

                payload = payloadElement.GetString();
            }

            if (status == "received"
                && (string.IsNullOrWhiteSpace(payload)
                    || Encoding.UTF8.GetByteCount(payload) > MaxAssistantResponseBytes))
            {
                error = "invalid_assistant_response";
                return false;
            }

            if (payload is { } responsePayload && Encoding.UTF8.GetByteCount(responsePayload) > MaxAssistantResponseBytes)
            {
                error = "invalid_assistant_response";
                return false;
            }

            var errorCode = GetString(root, "error_code");
            var message = GetString(root, "message");
            var stage = GetString(root, "stage");
            if (errorCode is { Length: > 64 } || (errorCode is not null && !IsSafeIdentifier(errorCode))
                || message is { Length: > 1024 }
                || stage is { Length: > 64 } || (stage is not null && !IsSafeIdentifier(stage)))
            {
                error = "invalid_assistant_response";
                return false;
            }

            int? targetTabId = null;
            if (root.TryGetProperty("target_tab_id", out var targetTabIdElement))
            {
                if (targetTabIdElement.ValueKind != JsonValueKind.Number
                    || !targetTabIdElement.TryGetInt32(out var parsedTargetTabId)
                    || parsedTargetTabId < 0)
                {
                    error = "invalid_assistant_response";
                    return false;
                }

                targetTabId = parsedTargetTabId;
            }

            var targetTabUrl = GetString(root, "target_tab_url");
            if (targetTabUrl is { Length: > 2048 }
                || (targetTabUrl is not null && !IsChatGptUrl(targetTabUrl)))
            {
                error = "invalid_assistant_response";
                return false;
            }

            var targetConversationId = GetString(root, "target_conversation_id");
            if (targetConversationId is { } conversationId && !IsSafeIdentifier(conversationId))
            {
                error = "invalid_assistant_response";
                return false;
            }

            var targetConversationUrl = GetString(root, "target_conversation_url");
            if (targetConversationUrl is { Length: > 2048 }
                || (targetConversationUrl is not null && !IsChatGptUrl(targetConversationUrl)))
            {
                error = "invalid_assistant_response";
                return false;
            }

            response = new(
                requestId,
                sessionId,
                handoffId,
                boundaryId,
                status,
                payload,
                errorCode,
                message,
                stage,
                targetTabId,
                targetTabUrl,
                targetConversationId,
                targetConversationUrl);
            return true;
        }
        catch (JsonException)
        {
            error = "invalid_json";
            return false;
        }
    }

    private sealed record PendingHandoffRequest(
        string HandoffId,
        TaskCompletionSource<BrowserExtensionHandoffSendResult> Completion);

    private sealed record PendingMediaAttachRequest(
        string SessionId,
        int Iteration,
        string MediaId,
        TaskCompletionSource<BrowserExtensionMediaAttachResult> Completion);

    private sealed record PendingChatGptContextRequest(
        bool CurrentOnly,
        TaskCompletionSource<BrowserExtensionChatGptContextSnapshot> Completion);

    private sealed record RegisteredMedia(
        string MediaId,
        string SessionId,
        int Iteration,
        string OutputIdentity,
        string FileName,
        string MimeType,
        long Size,
        DateTimeOffset ExpiresAt,
        string FullPath,
        string AllowedRoot);

    private static int FindAvailablePort()
    {
        var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        try { return ((IPEndPoint)probe.LocalEndpoint).Port; }
        finally { probe.Stop(); }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(BrowserExtensionBridge));
    }
}
