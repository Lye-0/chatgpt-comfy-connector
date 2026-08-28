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
  let contentResponse = null;
  let contentError = null;
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
      async sendMessage(tabId, message) {
        assert.equal(tabId, activeTabs[0]?.id);
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

  return {
    context,
    get socket() { return lastSocket; },
    setActiveTabs(value) { activeTabs = value; },
    setContentHandler(handler) {
      contentError = null;
      contentResponse = handler;
    },
    setContentError(error) {
      contentError = error;
    },
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
