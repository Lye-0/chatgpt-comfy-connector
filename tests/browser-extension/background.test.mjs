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
    async waitForResult(previousCount) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        if (lastSocket.sent.length > previousCount) return lastSocket.sent.at(-1);
        await wait(5);
      }
      assert.fail("Background did not send a handoff.result");
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

test("Background relays a Handoff to the active ChatGPT tab and returns sent", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let relayedMessage;
  harness.setContentHandler((message) => {
    relayedMessage = message;
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
