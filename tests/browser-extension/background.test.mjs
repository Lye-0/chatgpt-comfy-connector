import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (await readFile(join(repositoryRoot, "browser-extension", "background.js"), "utf8"))
  .replace("ensureReconnectAlarm();\nconnect().catch(() => {});", "");

const wait = (milliseconds = 0) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createHarness() {
  let activeTabs = [];
  const tabsById = new Map();
  let contentResponse = null;
  let contentError = null;
  let mediaResponse = null;
  const fetchCalls = [];
  let lastSocket = null;
  let keepaliveCallback = null;
  let keepaliveDelay = null;
  const runtimeListeners = [];

  class FakeWebSocket {
    static OPEN = 1;

    constructor(url) {
      this.url = url;
      this.readyState = FakeWebSocket.OPEN;
      this.sent = [];
      lastSocket = this;
      queueMicrotask(() => this.onopen?.());
    }

    send(value) { this.sent.push(JSON.parse(value)); }
    close() { this.readyState = 3; this.onclose?.(); }
  }

  const chrome = {
    storage: {
      local: {
        async get() { return {}; },
        async set() {}
      }
    },
    tabs: {
      async query() { return activeTabs; },
      async get(tabId) {
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      async sendMessage(tabId, message) {
        assert.ok(tabsById.has(tabId), `Message target ${tabId} should exist`);
        if (contentError) throw contentError;
        return contentResponse(message);
      }
    },
    runtime: {
      sendMessage: async () => ({ ok: true }),
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      onMessage: { addListener(listener) { runtimeListeners.push(listener); } }
    },
    alarms: {
      create() {},
      onAlarm: { addListener() {} }
    }
  };

  const context = createContext({
    URL,
    Promise,
    Map,
    Set,
    Date,
    Error,
    String,
    Boolean,
    JSON,
    WebSocket: FakeWebSocket,
    crypto: { randomUUID: () => "ping-fixture" },
    chrome,
    setTimeout,
    clearTimeout,
    setInterval(callback, delay) {
      keepaliveCallback = callback;
      keepaliveDelay = delay;
      return "keepalive-timer";
    },
    clearInterval() {
      keepaliveCallback = null;
      keepaliveDelay = null;
    },
    queueMicrotask,
    fetch: async (url, options = {}) => {
      fetchCalls.push({ url, options });
      if (mediaResponse?.error) throw mediaResponse.error;
      return mediaResponse?.response || {
        ok: false,
        status: 404,
        headers: { get() { return null; } }
      };
    },
    console
  });
  new Script(source).runInContext(context);

  const socketPromise = context.openSocket("session-fixture");
  await wait();
  assert.ok(lastSocket);
  assert.deepEqual(lastSocket.sent[0], {
    type: "hello",
    protocol: "chatgpt-comfy-connector.bridge/1",
    client: "browser-extension",
    token: "session-fixture"
  });
  lastSocket.onmessage({ data: JSON.stringify({
    type: "hello.ack",
    protocol: "chatgpt-comfy-connector.bridge/1"
  }) });
  await socketPromise;
  // openSocket() is intentionally tested independently from the bootstrap
  // flow. Seed the private runtime token after the authenticated fixture
  // socket is ready so media fetch tests can exercise the same Bearer path.
  new Script('sessionToken = "session-fixture";').runInContext(context);

  return {
    context,
    get socket() { return lastSocket; },
    setActiveTabs(value) {
      activeTabs = value;
      tabsById.clear();
      for (const tab of value) if (tab?.id !== undefined) tabsById.set(tab.id, tab);
    },
    setContentHandler(handler) {
      contentError = null;
      contentResponse = handler;
    },
    setContentError(error) {
      contentError = error;
    },
    setMediaResponse(response) {
      if (response?.error) {
        mediaResponse = { error: response.error };
        return;
      }
      const bytes = response?.bytes instanceof Uint8Array
        ? response.bytes
        : new Uint8Array(response?.bytes || []);
      let consumed = false;
      mediaResponse = {
        response: {
          ok: (response?.status ?? 200) >= 200 && (response?.status ?? 200) < 300,
          status: response?.status ?? 200,
          headers: {
            get(name) {
              return name.toLowerCase() === "content-length"
                ? String(response?.contentLength ?? bytes.length)
                : null;
            }
          },
          body: {
            getReader() {
              return {
                async read() {
                  if (consumed) return { done: true, value: undefined };
                  consumed = true;
                  return { done: false, value: bytes };
                }
              };
            }
          },
          async arrayBuffer() {
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
          }
        }
      };
    },
    get fetchCalls() { return fetchCalls; },
    triggerKeepalive() {
      assert.ok(keepaliveCallback, "Background did not start a WebSocket keepalive");
      keepaliveCallback();
    },
    get keepaliveDelay() { return keepaliveDelay; },
    async waitForResult(previousCount) {
      return this.waitForSocketMessage(previousCount, (message) => message.type === "handoff.result");
    },
    async waitForSocketMessage(previousCount, predicate = () => true) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const message = lastSocket.sent.slice(previousCount).find(predicate);
        if (message) return message;
        await wait(5);
      }
      assert.fail("Background did not send the expected WebSocket message");
    }
  };
}

const request = {
  type: "handoff.send",
  request_id: "request-fixture",
  session_id: "session-fixture",
  handoff_id: "handoff-fixture",
  boundary_id: "boundary-fixture",
  payload: "## Handoff\nhandoff_id: handoff-fixture\n"
};

const reviewHandoffRequest = {
  ...request,
  request_id: "review-request-fixture",
  handoff_id: "review-handoff-fixture",
  boundary_id: "review-boundary-fixture",
  handoff_kind: "review",
  target_tab_id: 42,
  target_tab_url: "https://chatgpt.com/c/fixture",
  review_media_id: "review-media-fixture",
  review_file_name: "MiniMax_H3_00015_.mp4",
  review_iteration: 2,
  payload: "## Review Handoff\nhandoff_id: review-handoff-fixture\n"
};

const reviewMediaRequest = {
  type: "review.media.attach",
  request_id: "media-request-fixture",
  session_id: "session-fixture",
  iteration: 2,
  media_id: "media-fixture",
  filename: "MiniMax_H3_00015_.mp4",
  mime_type: "video/mp4",
  size: 100000,
  target_tab_id: 42,
  target_tab_url: "https://chatgpt.com/c/fixture"
};

test("Background keeps an MV3 WebSocket alive below the service-worker idle limit", async () => {
  const harness = await createHarness();

  assert.equal(harness.keepaliveDelay, 20000);
  const previousCount = harness.socket.sent.length;
  harness.triggerKeepalive();

  const keepalive = harness.socket.sent.slice(previousCount).find((message) => message.type === "ping");
  assert.ok(keepalive);
  assert.match(keepalive.id, /^keepalive-/);
});

test("Background relays a Handoff to the active ChatGPT tab and returns sent", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let relayedMessage;
  harness.setContentHandler((message) => {
    relayedMessage = message;
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching",
        stage: "response_watch_started"
      };
    }
    return {
      request_id: request.request_id,
      handoff_id: request.handoff_id,
      status: "sent"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.type, "handoff.result");
  assert.equal(result.request_id, request.request_id);
  assert.equal(result.handoff_id, request.handoff_id);
  assert.equal(result.status, "sent");
  assert.equal(relayedMessage.type, "WATCH_ASSISTANT_RESPONSE");
  assert.equal(relayedMessage.sessionId, request.session_id);
  assert.equal(relayedMessage.boundaryId, request.boundary_id);
});

test("Background arms the response watcher before acknowledging a fast assistant response", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => {
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      // Simulate a response that arrives as soon as the watcher is armed.
      // The Desktop may not have persisted handoff.result yet, so it relies
      // on its existing identity queue for this ordering.
      harness.context.handleAssistantResponseFromContent({
        type: "ASSISTANT_RESPONSE_RESULT",
        requestId: request.request_id,
        sessionId: request.session_id,
        handoffId: request.handoff_id,
        boundaryId: request.boundary_id,
        status: "received",
        payload: "response payload",
        stage: "assistant_response_complete"
      }, { tab: { id: 17 } });
      return {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      };
    }
    return {
      request_id: request.request_id,
      handoff_id: request.handoff_id,
      status: "sent"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);
  const responseIndex = harness.socket.sent.findIndex((message, index) =>
    index >= previousCount && message.type === "assistant.response");
  const handoffIndex = harness.socket.sent.findIndex((message, index) =>
    index >= previousCount && message.type === "handoff.result");

  assert.equal(result.status, "sent");
  assert.ok(responseIndex >= 0, "The fast response should be relayed");
  assert.ok(handoffIndex >= 0, "The handoff result should be relayed");
  assert.ok(responseIndex < handoffIndex, "The watcher must be armed before handoff.result");
});

test("Background sends a Review Handoff only to its saved target tab and preserves its attachment metadata", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([
    { id: 7, url: "https://example.invalid/" },
    { id: reviewHandoffRequest.target_tab_id, url: reviewHandoffRequest.target_tab_url }
  ]);
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: reviewHandoffRequest.request_id,
        session_id: reviewHandoffRequest.session_id,
        handoff_id: reviewHandoffRequest.handoff_id,
        boundary_id: reviewHandoffRequest.boundary_id,
        status: "watching",
        stage: "response_watch_started"
      };
    }
    return {
      request_id: reviewHandoffRequest.request_id,
      handoff_id: reviewHandoffRequest.handoff_id,
      status: "sent",
      stage: "user_message_correlated"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewHandoffRequest, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(result.target_tab_id, reviewHandoffRequest.target_tab_id);
  assert.equal(result.target_tab_url, reviewHandoffRequest.target_tab_url);
  const handoffMessage = relayedMessages.find((message) => message.type === "HANDOFF_SEND");
  assert.equal(handoffMessage.type, "HANDOFF_SEND");
  assert.equal(handoffMessage.requestId, reviewHandoffRequest.request_id);
  assert.equal(handoffMessage.sessionId, reviewHandoffRequest.session_id);
  assert.equal(handoffMessage.handoffId, reviewHandoffRequest.handoff_id);
  assert.equal(handoffMessage.boundaryId, reviewHandoffRequest.boundary_id);
  assert.equal(handoffMessage.protocol, "comfy-connector/1");
  assert.equal(handoffMessage.payload, reviewHandoffRequest.payload);
  assert.equal(handoffMessage.review, true);
  assert.equal(handoffMessage.expectedAttachment.mediaId, reviewHandoffRequest.review_media_id);
  assert.equal(handoffMessage.expectedAttachment.fileName, reviewHandoffRequest.review_file_name);
  assert.equal(handoffMessage.expectedAttachment.iteration, reviewHandoffRequest.review_iteration);
  const watchMessage = relayedMessages.find((message) => message.type === "WATCH_ASSISTANT_RESPONSE");
  assert.equal(watchMessage.review, true);

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: reviewHandoffRequest.request_id,
    sessionId: reviewHandoffRequest.session_id,
    handoffId: reviewHandoffRequest.handoff_id,
    boundaryId: reviewHandoffRequest.boundary_id,
    status: "received",
    payload: "review response",
    stage: "assistant_response_complete"
  }, { tab: { id: reviewHandoffRequest.target_tab_id } });
  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.equal(response.target_tab_id, reviewHandoffRequest.target_tab_id);
  assert.equal(response.target_tab_url, reviewHandoffRequest.target_tab_url);
});

test("Background preserves Review response correlation when it arrives during watcher arm", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: reviewHandoffRequest.target_tab_id, url: reviewHandoffRequest.target_tab_url }]);
  harness.setContentHandler(async (message) => {
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      // A very fast/previously completed ChatGPT response can be delivered
      // while the Background is still awaiting the Content Script's watcher
      // acknowledgement. The Review identity must already be registered.
      await harness.context.handleAssistantResponseFromContent({
        type: "ASSISTANT_RESPONSE_RESULT",
        requestId: reviewHandoffRequest.request_id,
        sessionId: reviewHandoffRequest.session_id,
        handoffId: reviewHandoffRequest.handoff_id,
        boundaryId: reviewHandoffRequest.boundary_id,
        status: "received",
        payload: "review response",
        stage: "assistant_response_complete"
      }, { tab: { id: reviewHandoffRequest.target_tab_id } });
      return {
        request_id: reviewHandoffRequest.request_id,
        session_id: reviewHandoffRequest.session_id,
        handoff_id: reviewHandoffRequest.handoff_id,
        boundary_id: reviewHandoffRequest.boundary_id,
        status: "watching"
      };
    }
    return {
      request_id: reviewHandoffRequest.request_id,
      handoff_id: reviewHandoffRequest.handoff_id,
      status: "sent"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewHandoffRequest, harness.socket);
  const result = await harness.waitForResult(previousCount);
  const response = await harness.waitForSocketMessage(previousCount, (message) => message.type === "assistant.response");

  assert.equal(result.status, "sent");
  assert.equal(response.status, "received");
  assert.equal(response.request_id, reviewHandoffRequest.request_id);
  assert.equal(response.session_id, reviewHandoffRequest.session_id);
  assert.equal(response.handoff_id, reviewHandoffRequest.handoff_id);
  assert.equal(response.boundary_id, reviewHandoffRequest.boundary_id);
  assert.equal(response.target_tab_id, reviewHandoffRequest.target_tab_id);
  assert.equal(response.target_tab_url, reviewHandoffRequest.target_tab_url);
});

test("Background rejects a Review response after the saved target tab navigates away", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: reviewHandoffRequest.target_tab_id, url: reviewHandoffRequest.target_tab_url }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
        request_id: reviewHandoffRequest.request_id,
        session_id: reviewHandoffRequest.session_id,
        handoff_id: reviewHandoffRequest.handoff_id,
        boundary_id: reviewHandoffRequest.boundary_id,
        status: "watching"
      }
    : {
        request_id: reviewHandoffRequest.request_id,
        handoff_id: reviewHandoffRequest.handoff_id,
        status: "sent"
      });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewHandoffRequest, harness.socket);
  await harness.waitForResult(previousCount);

  // The service worker must re-check the URL at response time because the
  // same tab can navigate between the Review send and the assistant result.
  harness.setActiveTabs([{ id: reviewHandoffRequest.target_tab_id, url: "https://chatgpt.com/c/another-conversation" }]);
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: reviewHandoffRequest.request_id,
    sessionId: reviewHandoffRequest.session_id,
    handoffId: reviewHandoffRequest.handoff_id,
    boundaryId: reviewHandoffRequest.boundary_id,
    status: "received",
    payload: "response from another conversation"
  }, { tab: { id: reviewHandoffRequest.target_tab_id } });

  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.equal(response.status, "error");
  assert.equal(response.error_code, "review_target_tab_not_found");
  assert.equal(response.stage, "target_tab_check");
  assert.equal(response.target_tab_id, reviewHandoffRequest.target_tab_id);
  assert.equal(response.target_tab_url, reviewHandoffRequest.target_tab_url);
});

test("Background relays a correlated assistant response without parsing its payload", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching",
        stage: "response_watch_started"
      };
    }
    return {
      request_id: request.request_id,
      handoff_id: request.handoff_id,
      status: "sent",
      stage: "user_message_correlated"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await harness.waitForResult(previousCount);
  assert.equal(relayedMessages.length, 2);
  assert.equal(relayedMessages[1].type, "WATCH_ASSISTANT_RESPONSE");

  const payload = "```connector-command\n{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\"}\n```";
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "received",
    payload,
    stage: "assistant_response_complete"
  }, { tab: { id: 17 } });

  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.deepEqual(response, {
    type: "assistant.response",
    request_id: request.request_id,
    session_id: request.session_id,
    handoff_id: request.handoff_id,
    boundary_id: request.boundary_id,
    status: "received",
    payload,
    stage: "assistant_response_complete"
  });
});

test("Background forwards assistant response diagnostics and rejects another tab", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      }
    : { request_id: request.request_id, handoff_id: request.handoff_id, status: "sent" });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await harness.waitForResult(previousCount);
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "error",
    errorCode: "response_timeout",
    stage: "assistant_response_stability_timeout",
    message: "応答待機がタイムアウトしました。"
  }, { tab: { id: 999 } });
  await wait(10);
  assert.equal(harness.socket.sent.length, previousCount + 1);

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "error",
    errorCode: "response_timeout",
    stage: "assistant_response_stability_timeout",
    message: "応答待機がタイムアウトしました。"
  }, { tab: { id: 17 } });
  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.equal(response.status, "error");
  assert.equal(response.error_code, "response_timeout");
  assert.equal(response.stage, "assistant_response_stability_timeout");
  assert.equal(response.message, "応答待機がタイムアウトしました。");
});

test("Background keeps the active tab bound when assistant response arrives", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      }
    : { request_id: request.request_id, handoff_id: request.handoff_id, status: "sent" });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await harness.waitForResult(previousCount);
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "received",
    payload: "response payload"
  }, { tab: { id: 17 } });
  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.equal(response.request_id, request.request_id);
  assert.equal(response.handoff_id, request.handoff_id);
  assert.equal(response.payload, "response payload");
});

test("Background preserves the original Handoff relay shape before response watching", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let relayedMessage;
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") relayedMessage = message;
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? {
          request_id: request.request_id,
          session_id: request.session_id,
          handoff_id: request.handoff_id,
          boundary_id: request.boundary_id,
          status: "watching"
        }
      : { request_id: request.request_id, handoff_id: request.handoff_id, status: "sent" };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await harness.waitForResult(previousCount);
  assert.deepEqual({ ...relayedMessage }, {
    type: "HANDOFF_SEND",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    protocol: "comfy-connector/1",
    payload: request.payload
  });
});

test("Background propagates a Content Script send failure instead of upgrading it to sent", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler(() => ({
    request_id: request.request_id,
    handoff_id: request.handoff_id,
    status: "error",
    error_code: "send_failed",
    stage: "user_message_not_observed",
    message: "ChatGPTの送信操作が成立したことを確認できませんでした。"
  }));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.type, "handoff.result");
  assert.equal(result.status, "error");
  assert.equal(result.error_code, "send_failed");
  assert.equal(result.stage, "user_message_not_observed");
});

test("Background rejects a non-ChatGPT active tab without switching tabs", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 18, url: "https://example.invalid/" }]);
  harness.setContentHandler(() => assert.fail("Content Script must not be called"));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "active_tab_not_chatgpt");
});

test("Background maps an unavailable Content Script to an explicit error", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 19, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler(() => null);
  harness.setContentError(new Error("Could not establish connection."));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "content_script_unavailable");
});

test("Background maps a tab disappearing during dispatch to an explicit error", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 20, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler(() => null);
  harness.setContentError(new Error("No tab with id: 20"));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "content_script_unavailable");
});

test("Background fetches media with the session token and attaches it to the original non-active ChatGPT tab", async () => {
  const harness = await createHarness();
  // The first tab is active and unrelated.  The target tab is deliberately
  // second to prove Phase 5.1 does not switch to the current active tab.
  harness.setActiveTabs([
    { id: 7, url: "https://example.invalid/" },
    { id: reviewMediaRequest.target_tab_id, url: reviewMediaRequest.target_tab_url }
  ]);
  harness.setMediaResponse({ bytes: new Uint8Array(reviewMediaRequest.size) });
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "REVIEW_MEDIA_ATTACH_BEGIN") return { status: "receiving" };
    if (message.type === "REVIEW_MEDIA_ATTACH_CHUNK") {
      assert.ok(message.chunk.length <= 2 * 48 * 1024, "Chunk should stay within the bounded transfer budget");
      return { status: "receiving" };
    }
    if (message.type === "REVIEW_MEDIA_ATTACH_END") return { status: "attached", stage: "attachment_verified" };
    return null;
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewMediaRequest, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");

  assert.equal(result.request_id, reviewMediaRequest.request_id);
  assert.equal(result.session_id, reviewMediaRequest.session_id);
  assert.equal(result.iteration, reviewMediaRequest.iteration);
  assert.equal(result.media_id, reviewMediaRequest.media_id);
  assert.equal(result.status, "attached");
  assert.ok(relayedMessages.length >= 4, "Media should be transferred in more than one bounded message");
  assert.ok(relayedMessages.every((message) => message.targetTabId === undefined), "Content Script must not receive a local target path or tab metadata");
  assert.equal(harness.fetchCalls.length, 1);
  assert.match(harness.fetchCalls[0].url, /\/api\/v1\/media\/media-fixture\?/);
  assert.equal(harness.fetchCalls[0].options.headers.Authorization, "Bearer session-fixture");
  assert.equal(harness.fetchCalls[0].options.headers["X-Connector-Client"], "browser-extension");
});

test("Background rejects a closed or non-ChatGPT Review target without fetching or switching tabs", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 7, url: "https://chatgpt.com/c/other" }]);
  harness.setContentHandler(() => assert.fail("Content Script must not receive media for a missing target"));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewMediaRequest, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");
  assert.equal(result.status, "error");
  assert.equal(result.error_code, "review_target_tab_not_found");
  assert.equal(harness.fetchCalls.length, 0);
});

test("Background rejects a ChatGPT tab that changed to another conversation", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 42, url: "https://chatgpt.com/c/another-conversation" }]);
  harness.setContentHandler(() => ({ status: "attached" }));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewMediaRequest, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "review_target_tab_not_found");
  assert.equal(result.stage, "target_tab_check");
  assert.equal(harness.fetchCalls.length, 0);
});

test("Background preserves explicit media expiry and Content Script upload errors", async () => {
  const expired = await createHarness();
  expired.setActiveTabs([{ id: reviewMediaRequest.target_tab_id, url: reviewMediaRequest.target_tab_url }]);
  expired.setMediaResponse({ status: 410, bytes: [] });
  expired.setContentHandler(() => assert.fail("Expired media must not be dispatched"));
  const expiredBefore = expired.socket.sent.length;
  expired.context.handleBridgeMessage(reviewMediaRequest, expired.socket);
  const expiredResult = await expired.waitForSocketMessage(expiredBefore, (message) => message.type === "review.media.result");
  assert.equal(expiredResult.error_code, "media_expired");

  const failed = await createHarness();
  failed.setActiveTabs([{ id: reviewMediaRequest.target_tab_id, url: reviewMediaRequest.target_tab_url }]);
  failed.setMediaResponse({ bytes: new Uint8Array(reviewMediaRequest.size) });
  failed.setContentHandler((message) => message.type === "REVIEW_MEDIA_ATTACH_BEGIN"
    ? { status: "error", error_code: "attachment_control_not_found", stage: "attachment_control_found" }
    : null);
  const failedBefore = failed.socket.sent.length;
  failed.context.handleBridgeMessage(reviewMediaRequest, failed.socket);
  const failedResult = await failed.waitForSocketMessage(failedBefore, (message) => message.type === "review.media.result");
  assert.equal(failedResult.error_code, "attachment_control_not_found");
  assert.equal(failedResult.stage, "attachment_control_found");
});
