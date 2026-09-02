import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (await readFile(join(repositoryRoot, "browser-extension", "background.js"), "utf8"))
  .replace("ensureReconnectAlarm();\nconnect().catch(() => {});", "")
  .replace("const HANDOFF_ACCEPTANCE_RETRY_DELAY_MS = 500;", "const HANDOFF_ACCEPTANCE_RETRY_DELAY_MS = 5;");

const wait = (milliseconds = 0) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function createHarness() {
  let activeTabs = [];
  const tabsById = new Map();
  const managedStorageValues = {};
  let contentResponse = null;
  let contentError = null;
  let mediaResponse = null;
  const fetchCalls = [];
  let lastSocket = null;
  let keepaliveCallback = null;
  let keepaliveDelay = null;
  let scriptInjectionCount = 0;
  const runtimeListeners = [];
  const createdTabs = [];
  const updatedTabs = [];
  const tabUpdatedListeners = new Set();
  const tabRemovedListeners = new Set();
  const tabActivatedListeners = new Set();
  const windowFocusChangedListeners = new Set();
  const windowRemovedListeners = new Set();
  const windowStates = new Map([[1, {
    id: 1,
    focused: true,
    state: "normal",
    type: "normal",
    width: 1920,
    height: 1080
  }]]);
  const diagnostics = [];
  const createdWindows = [];
  let nextCreatedTabStatus;
  let nextWindowId = 200;

  function allTabs() {
    return [...tabsById.values()];
  }

  function ensureWindow(windowId, defaults = {}) {
    if (!windowStates.has(windowId)) {
      windowStates.set(windowId, {
        id: windowId,
        focused: false,
        state: "normal",
        type: "normal",
        ...defaults
      });
    }
    return windowStates.get(windowId);
  }

  function setActiveTabInWindow(tabId, windowId) {
    for (const tab of tabsById.values()) {
      if (tab.windowId === windowId) tab.active = tab.id === tabId;
    }
    activeTabs = allTabs();
  }

  function conversationIdFromUrl(url) {
    const match = String(url || "").match(/\/c\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function executionReadyFixture(message) {
    const tab = tabsById.get(message.targetTabId);
    const url = message.expectedConversationUrl || tab?.url || "https://chatgpt.com/";
    const conversationId = message.expectedConversationId || conversationIdFromUrl(url);
    return {
      request_id: message.requestId || "",
      session_id: message.sessionId || "",
      handoff_id: message.handoffId || "",
      boundary_id: message.boundaryId || "",
      status: "ready",
      stage: "conversation_ready",
      composer_ready: true,
      current_context: {
        ...(conversationId ? { conversation_id: conversationId } : {}),
        url
      }
    };
  }

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
      session: {
        async get(key) {
          if (typeof key === "string") return { [key]: managedStorageValues[key] };
          return { ...managedStorageValues };
        },
        async set(value) { Object.assign(managedStorageValues, value); }
      },
      local: {
        async get() { return {}; },
        async set() {}
      }
    },
    tabs: {
      async query(query = {}) {
        const tabs = allTabs();
        if (Number.isSafeInteger(query?.windowId)) return tabs.filter((tab) => tab.windowId === query.windowId);
        if (query?.active === true) return tabs.filter((tab) => tab.active === true);
        return tabs;
      },
      async get(tabId) {
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        return tab;
      },
      async create({ url, windowId = 1, active = true, autoDiscardable = true }) {
        const window = ensureWindow(windowId);
        const tab = {
          id: 100 + createdTabs.length,
          windowId,
          url,
          active,
          status: nextCreatedTabStatus,
          discarded: false,
          frozen: false,
          autoDiscardable
        };
        createdTabs.push(tab);
        tabsById.set(tab.id, tab);
        window.tabs = [...(window.tabs || []), tab];
        if (active) {
          setActiveTabInWindow(tab.id, windowId);
          for (const listener of tabActivatedListeners) listener({ tabId: tab.id, windowId: tab.windowId });
        } else activeTabs = allTabs();
        return tab;
      },
      async update(tabId, changes = {}) {
        const tab = tabsById.get(tabId);
        assert.ok(tab, `Tab ${tabId} should exist before updating it`);
        const wasActive = tab.active === true;
        Object.assign(tab, changes);
        updatedTabs.push({ tabId, changes: { ...changes } });
        if (changes.active === true) {
          setActiveTabInWindow(tabId, tab.windowId);
          if (!wasActive) {
            for (const listener of tabActivatedListeners) listener({ tabId, windowId: tab.windowId });
          }
        }
        if (changes.active === false) tab.active = false;
        activeTabs = allTabs();
        for (const listener of tabUpdatedListeners) listener(tabId, { status: tab.status || "complete", ...changes }, tab);
        return tab;
      },
      async remove(tabId) {
        const tab = tabsById.get(tabId);
        if (!tab) throw new Error(`No tab with id: ${tabId}`);
        tabsById.delete(tabId);
        activeTabs = allTabs();
        for (const listener of tabRemovedListeners) listener(tabId, { windowId: tab.windowId, isWindowClosing: false });
      },
      async sendMessage(tabId, message) {
        assert.ok(tabsById.has(tabId), `Message target ${tabId} should exist`);
        if (contentError) throw contentError;
        const result = await contentResponse?.(message) || {};
        if (message?.type === "GET_COLLECTOR_VIEWPORT"
          && result?.type !== "COLLECTOR_VIEWPORT_RESULT") {
          return {
            type: "COLLECTOR_VIEWPORT_RESULT",
            requestId: message.requestId,
            status: "ok",
            content_inner_width: 1024,
            content_inner_height: 540,
            sidebar_container_exists: true,
            project_section_exists: true,
            project_row_locator_ready: true,
            desktop_layout: true,
            sidebar_expected_visible: true,
            sidebar_ready: true
          };
        }
        if (message?.type === "GET_COLLECTOR_ROOT_HYDRATION"
          && result?.type !== "COLLECTOR_ROOT_HYDRATION_RESULT") {
          return {
            type: "COLLECTOR_ROOT_HYDRATION_RESULT",
            requestId: message.requestId,
            status: "ok",
            refresh_generation: message.refreshGeneration,
            navigation_generation: message.navigationGeneration,
            collector_tab_id: message.collectorTabId,
            expected_root_url: "https://chatgpt.com/",
            root_hydration_started: true,
            root_hydration_completed: true,
            root_hydration_timeout: false,
            hydration_wait_ms: 1,
            document_ready_state: "complete",
            sidebar_root_present: true,
            sidebar_scroll_container_present: true,
            sidebar_shell_present: true,
            sidebar_sections_stable: true,
            mutation_count: 0,
            mutation_quiet_ms: 600,
            root_url_verified: true
          };
        }
        if (message?.type === "GET_CHATGPT_CONTEXT"
          && result?.type === "CHATGPT_CONTEXT_RESULT"
          && result.status === "ok") {
          return {
            ...result,
            sidebar_scroll_top: result.sidebar_scroll_top ?? 0,
            sidebar_scroll_height: result.sidebar_scroll_height ?? 0,
            sidebar_client_height: result.sidebar_client_height ?? 0,
            sidebar_can_scroll: result.sidebar_can_scroll ?? false,
            sidebar_at_bottom: result.sidebar_at_bottom ?? true,
            visible_project_rows: result.visible_project_rows ?? result.projects.length,
            discovered_project_count: result.discovered_project_count ?? result.projects.length,
            project_section_found: result.project_section_found ?? true,
            no_growth_count: result.no_growth_count ?? 2,
            sidebar_scroll_complete: result.sidebar_scroll_complete ?? true,
            sidebar_scroll_container_found: result.sidebar_scroll_container_found ?? true
          };
        }
        return result;
      },
      onUpdated: {
        addListener(listener) { tabUpdatedListeners.add(listener); },
        removeListener(listener) { tabUpdatedListeners.delete(listener); }
      },
      onRemoved: {
        addListener(listener) { tabRemovedListeners.add(listener); },
        removeListener(listener) { tabRemovedListeners.delete(listener); }
      },
      onActivated: {
        addListener(listener) { tabActivatedListeners.add(listener); },
        removeListener(listener) { tabActivatedListeners.delete(listener); }
      }
    },
    windows: {
      async get(windowId) {
        const window = windowStates.get(windowId);
        if (!window) throw new Error(`No window with id: ${windowId}`);
        return window;
      },
      async getLastFocused() {
        return [...windowStates.values()].find((window) => window.focused === true)
          || [...windowStates.values()].at(-1);
      },
      async create(createData = {}) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(createData, "populate"),
          false,
          "windows.create must not receive the windows.get populate query option"
        );
        const {
          url,
          focused = true,
          state = "normal",
          type = "normal",
          width,
          height
        } = createData;
        const id = nextWindowId++;
        const window = ensureWindow(id, {
          focused: focused === true,
          state,
          type,
          width,
          height,
          tabs: []
        });
        if (focused === true) {
          for (const candidate of windowStates.values()) candidate.focused = candidate.id === id;
        }
        const tab = {
          id: 100 + createdTabs.length,
          windowId: id,
          url,
          active: true,
          status: nextCreatedTabStatus,
          discarded: false,
          frozen: false,
          autoDiscardable: true
        };
        createdTabs.push(tab);
        tabsById.set(tab.id, tab);
        window.tabs = [tab];
        activeTabs = allTabs();
        createdWindows.push(window);
        return window;
      },
      async update(windowId, changes = {}) {
        const window = ensureWindow(windowId);
        Object.assign(window, changes);
        if (changes.focused === true) {
          for (const candidate of windowStates.values()) candidate.focused = candidate.id === windowId;
        }
        return window;
      },
      async remove(windowId) {
        const window = windowStates.get(windowId);
        if (!window) throw new Error(`No window with id: ${windowId}`);
        const removedTabs = allTabs().filter((tab) => tab.windowId === windowId);
        for (const tab of removedTabs) tabsById.delete(tab.id);
        activeTabs = allTabs();
        for (const tab of removedTabs) {
          for (const listener of tabRemovedListeners) listener(tab.id, { windowId, isWindowClosing: true });
        }
        windowStates.delete(windowId);
        for (const listener of windowRemovedListeners) listener(windowId);
      },
      onFocusChanged: {
        addListener(listener) { windowFocusChangedListeners.add(listener); },
        removeListener(listener) { windowFocusChangedListeners.delete(listener); }
      },
      onRemoved: {
        addListener(listener) { windowRemovedListeners.add(listener); },
        removeListener(listener) { windowRemovedListeners.delete(listener); }
      }
    },
    scripting: {
      async executeScript() {
        scriptInjectionCount += 1;
        contentError = null;
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
    console: {
      info(...args) { diagnostics.push(args); },
      warn() {},
      error() {},
      log() {}
    }
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
      activeTabs = value.map((tab) => {
        if (tab?.id === undefined) return tab;
        if (!Number.isSafeInteger(tab.windowId)) tab.windowId = 1;
        ensureWindow(tab.windowId);
        tabsById.set(tab.id, tab);
        return tab;
      });
      activeTabs = allTabs();
    },
    setContentHandler(handler) {
      contentError = null;
      contentResponse = async (message) => {
        const result = await handler?.(message);
        if (message?.type === "CHATGPT_EXECUTION_READY") {
          if (result?.status === "error") return result;
          return result?.status === "ready"
            ? { ...executionReadyFixture(message), ...result }
            : executionReadyFixture(message);
        }
        if (message?.type === "WATCH_ASSISTANT_RESPONSE" && result?.status === "watching") {
          return {
            request_id: message.requestId,
            session_id: message.sessionId,
            handoff_id: message.handoffId,
            boundary_id: message.boundaryId,
            ...result
          };
        }
        return result;
      };
    },
    setContentError(error) {
      contentError = error;
    },
    setNextCreatedTabStatus(status) {
      nextCreatedTabStatus = status;
    },
    addTabToWindow(options = {}) {
      return chrome.tabs.create({
        url: options.url || "https://chatgpt.com/",
        windowId: options.windowId,
        active: options.active === true,
        autoDiscardable: options.autoDiscardable
      });
    },
    setTabStatus(tabId, status) {
      const tab = tabsById.get(tabId);
      assert.ok(tab, `Tab ${tabId} should exist before updating its status`);
      tab.status = status;
      for (const listener of tabUpdatedListeners) listener(tabId, { status }, tab);
    },
    setTabUrl(tabId, url) {
      const tab = tabsById.get(tabId);
      assert.ok(tab, `Tab ${tabId} should exist before updating its URL`);
      tab.url = url;
      for (const listener of tabUpdatedListeners) listener(tabId, { status: "complete", url }, tab);
    },
    activateTab(tabId, windowId = null) {
      const tab = tabsById.get(tabId);
      assert.ok(tab, `Tab ${tabId} should exist before activation`);
      if (Number.isSafeInteger(windowId)) tab.windowId = windowId;
      ensureWindow(tab.windowId);
      setActiveTabInWindow(tabId, tab.windowId);
      for (const listener of tabActivatedListeners) listener({ tabId, windowId: tab.windowId });
    },
    focusWindow(windowId) {
      ensureWindow(windowId);
      for (const window of windowStates.values()) window.focused = window.id === windowId;
      for (const listener of windowFocusChangedListeners) listener(windowId);
    },
    setTabLifecycle(tabId, changes = {}) {
      const tab = tabsById.get(tabId);
      assert.ok(tab, `Tab ${tabId} should exist before lifecycle update`);
      Object.assign(tab, changes);
      activeTabs = allTabs();
      for (const listener of tabUpdatedListeners) listener(tabId, { ...changes }, tab);
    },
    removeTab(tabId) {
      const tab = tabsById.get(tabId);
      assert.ok(tab, `Tab ${tabId} should exist before removal`);
      tabsById.delete(tabId);
      activeTabs = allTabs();
      for (const listener of tabRemovedListeners) listener(tabId, { windowId: tab.windowId, isWindowClosing: false });
    },
    get createdTabs() { return createdTabs; },
    get createdWindows() { return createdWindows; },
    get updatedTabs() { return updatedTabs; },
    get diagnostics() { return diagnostics; },
    getTab(tabId) { return tabsById.get(tabId); },
    tabsInWindow(windowId) { return allTabs().filter((tab) => tab.windowId === windowId); },
    getWindow(windowId) { return windowStates.get(windowId); },
    closeExecutionWindow(windowId) { return chrome.windows.remove(windowId); },
    get managedTabId() { return context.managedTabState?.tabId ?? createdTabs.at(-1)?.id ?? null; },
    async openAuthenticatedSocket(token = "session-reconnected") {
      const socketPromise = context.openSocket(token);
      await wait();
      assert.ok(lastSocket);
      lastSocket.onmessage({ data: JSON.stringify({
        type: "hello.ack",
        protocol: "chatgpt-comfy-connector.bridge/1"
      }) });
      await socketPromise;
      return lastSocket;
    },
    async notifyRuntimeMessage(message, sender) {
      const listener = runtimeListeners.at(-1);
      assert.ok(listener, "Background runtime listener should be registered");
      const effectiveSender = sender || { tab: { id: this.managedTabId ?? 17 } };
      return await new Promise((resolve) => {
        const returned = listener(message, effectiveSender, resolve);
        if (returned !== true) resolve(returned);
      });
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
    get scriptInjectionCount() { return scriptInjectionCount; },
    triggerKeepalive() {
      assert.ok(keepaliveCallback, "Background did not start a WebSocket keepalive");
      keepaliveCallback();
    },
    get keepaliveDelay() { return keepaliveDelay; },
    async waitForResult(previousCount) {
      return this.waitForSocketMessage(previousCount, (message) => message.type === "handoff.result");
    },
    async waitForSocketMessage(previousCount, predicate = () => true) {
      for (let attempt = 0; attempt < 600; attempt += 1) {
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
  target_conversation_id: "fixture",
  target_conversation_url: "https://chatgpt.com/c/fixture",
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
  target_tab_url: "https://chatgpt.com/c/fixture",
  target_conversation_id: "fixture",
  target_conversation_url: "https://chatgpt.com/c/fixture"
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

test("Background uses one active Managed ChatGPT Tab in an isolated Execution Window", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://example.invalid/", active: true }]);
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
  const managedTab = harness.createdTabs[0];
  assert.equal(managedTab.active, true);
  assert.equal(managedTab.autoDiscardable, false);
  assert.equal(managedTab.url, "https://chatgpt.com/");
  assert.notEqual(managedTab.windowId, 1);
  assert.equal(harness.getTab(17).active, true);
  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdWindows[0].focused, false);
  assert.equal(harness.createdWindows[0].state, "normal");
  assert.equal(harness.createdWindows[0].width, 960);
  assert.equal(harness.createdWindows[0].height, 540);
  assert.equal(harness.managedTabId, managedTab.id);
  assert.equal(harness.createdTabs.length, 1);
  const watchMessage = relayedMessages.find((message) => message.type === "WATCH_ASSISTANT_RESPONSE");
  const handoffMessage = relayedMessages.find((message) => message.type === "HANDOFF_SEND");
  assert.equal(watchMessage.sessionId, request.session_id);
  assert.equal(watchMessage.boundaryId, request.boundary_id);
  assert.equal(watchMessage.targetTabId, managedTab.id);
  assert.equal(watchMessage.prepare, true);
  assert.equal(handoffMessage.targetTabId, undefined);
});

test("Background restores a focused Execution Window without focusing the user's window", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://example.invalid/", active: true }]);
  const sentMessages = [];
  harness.setContentHandler((message) => {
    sentMessages.push(message);
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      }
      : {
        request_id: request.request_id,
        handoff_id: request.handoff_id,
        status: "sent"
      };
  });

  const firstCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  assert.equal((await harness.waitForResult(firstCount)).status, "sent");
  const executionWindowId = harness.createdTabs[0].windowId;
  harness.focusWindow(executionWindowId);

  harness.context.handleBridgeMessage(request, harness.socket);
  await wait(50);
  assert.equal(harness.getWindow(executionWindowId).focused, false);
  assert.equal(harness.getTab(17).active, true);
  assert.equal(harness.createdWindows.length, 1);
  assert.equal(sentMessages.filter((message) => message.type === "HANDOFF_SEND").length, 1);
});

test("Background records Managed Tab activation, focus, and discard lifecycle state without changing routing", async () => {
  const harness = await createHarness();
  harness.setNextCreatedTabStatus("complete");
  harness.setActiveTabs([{
    id: 17,
    windowId: 1,
    url: "https://example.invalid/",
    active: true
  }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
      request_id: request.request_id,
      session_id: request.session_id,
      handoff_id: request.handoff_id,
      boundary_id: request.boundary_id,
      status: "watching"
    }
    : {
      request_id: request.request_id,
      handoff_id: request.handoff_id,
      status: "sent",
      stage: "user_message_correlated"
    });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  const managedTabId = harness.managedTabId;
  assert.ok(Number.isSafeInteger(managedTabId));

  // Let the creation/send snapshots settle before comparing the later state.
  await wait(10);
  harness.activateTab(17);
  await wait(10);
  harness.focusWindow(2);
  await wait(10);
  harness.setTabLifecycle(managedTabId, {
    active: false,
    discarded: true,
    frozen: true,
    status: "complete"
  });
  await wait(10);
  assert.equal(harness.getTab(managedTabId).active, true);
  assert.equal(harness.getTab(managedTabId).autoDiscardable, false);

  const entries = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields && typeof fields === "object");
  const created = entries.find((fields) =>
    fields.stage === "managed_tab_created" && fields.managed_tab_exists === true);
  assert.equal(created.managed_tab_exists, true);
  assert.equal(created.tab_id, managedTabId);
  assert.equal(created.tab_active, true);
  assert.equal(created.tab_discarded, false);
  assert.equal(created.tab_frozen, false);
  assert.equal(created.tab_auto_discardable, false);
  assert.equal(created.window_focused, false);
  assert.equal(created.execution_window_id, managedTabId === null ? null : harness.createdTabs[0].windowId);
  assert.equal(created.execution_window_focused, false);
  assert.equal(created.execution_window_state, "normal");
  assert.equal(created.execution_window_exists, true);
  assert.equal(created.tab_status, "complete");
  assert.ok(entries.some((fields) => fields.stage === "tabs_on_activated" && fields.tab_active === true));
  assert.ok(entries.some((fields) => fields.stage === "windows_on_focus_changed" && fields.window_focused === false));
  assert.ok(entries.some((fields) => fields.stage === "managed_tab_state_changed"
    && fields.changed_state.includes("tab_discarded")
    && fields.changed_state.includes("tab_frozen")));
  assert.ok(entries.some((fields) => fields.stage === "handoff_send_before"
    && fields.request_id === request.request_id));
  assert.ok(entries.some((fields) => fields.stage === "response_watch_armed"
    && fields.watcher_state === "armed"));
  assert.equal(entries.some((fields) => Object.prototype.hasOwnProperty.call(fields, "payload")), false);
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
      }, { tab: { id: 100 } });
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

test("Background does not send a Handoff until the pre-send watcher is ready", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let releaseWatcher;
  const watcherResult = new Promise((resolve) => { releaseWatcher = resolve; });
  let watcherRequested = false;
  harness.setContentHandler((message) => {
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      watcherRequested = true;
      return watcherResult;
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
  for (let attempt = 0; attempt < 50 && !watcherRequested; attempt += 1) await wait(5);
  assert.equal(watcherRequested, true);
  await wait(20);
  assert.equal(harness.socket.sent.some((message) => message.type === "handoff.result"), false);
  releaseWatcher({
    request_id: request.request_id,
    session_id: request.session_id,
    handoff_id: request.handoff_id,
    boundary_id: request.boundary_id,
    status: "watching"
  });
  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.equal(harness.socket.sent.filter((message) => message.type === "handoff.result").length, 1);
});

test("Background completes a Handoff from Content Script confirmation when the send response is delayed", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") {
      return new Promise((resolve) => setTimeout(() => resolve({
        request_id: request.request_id,
        handoff_id: request.handoff_id,
        status: "sent",
        stage: "user_message_correlated"
      }), 100));
    }
    return {
      request_id: request.request_id,
      session_id: request.session_id,
      handoff_id: request.handoff_id,
      boundary_id: request.boundary_id,
      status: "watching"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await wait(10);
  const confirmation = await harness.notifyRuntimeMessage({
    type: "HANDOFF_SEND_CONFIRMED",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "sent",
    stage: "user_message_correlated"
  });
  assert.equal(confirmation.ok, true);

  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.equal(result.stage, "user_message_correlated");
  assert.equal(harness.socket.sent.filter((message) => message.type === "handoff.result").length, 1);
});

test("Background binds a new Conversation after the early send confirmation", async () => {
  const harness = await createHarness();
  const newConversationRequest = {
    ...request,
    request_id: "request-new-conversation-bind",
    handoff_id: "handoff-new-conversation-bind",
    boundary_id: "boundary-new-conversation-bind",
    new_conversation: true,
    target_project_url: "https://chatgpt.com/"
  };
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") {
      return new Promise((resolve) => setTimeout(() => resolve({
        request_id: newConversationRequest.request_id,
        session_id: newConversationRequest.session_id,
        handoff_id: newConversationRequest.handoff_id,
        boundary_id: newConversationRequest.boundary_id,
        status: "sent",
        stage: "user_message_correlated",
        current_context: {
          conversation_id: "conversation-created",
          url: "https://chatgpt.com/c/conversation-created"
        }
      }), 100));
    }
    return {
      request_id: newConversationRequest.request_id,
      session_id: newConversationRequest.session_id,
      handoff_id: newConversationRequest.handoff_id,
      boundary_id: newConversationRequest.boundary_id,
      status: "watching"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(newConversationRequest, harness.socket);
  await wait(10);
  const confirmation = await harness.notifyRuntimeMessage({
    type: "HANDOFF_SEND_CONFIRMED",
    requestId: newConversationRequest.request_id,
    sessionId: newConversationRequest.session_id,
    handoffId: newConversationRequest.handoff_id,
    boundaryId: newConversationRequest.boundary_id,
    status: "sent",
    stage: "user_message_correlated",
    current_context: {
      url: "https://chatgpt.com/"
    }
  });
  assert.equal(confirmation.ok, true);

  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.equal(result.target_conversation_id, "conversation-created");
  assert.equal(result.target_conversation_url, "https://chatgpt.com/c/conversation-created");
});

test("Background retries acceptance after a new-tab DOM hydration gap without reposting the Handoff", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let handoffCalls = 0;
  let acceptanceChecks = 0;
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") {
      handoffCalls += 1;
      if (handoffCalls === 1) return Promise.reject(new Error("Could not establish connection."));
      // Model the original page context disappearing after ChatGPT accepted
      // the post. The recovery path must win before this delayed response.
      return new Promise((resolve) => setTimeout(() => resolve({
        request_id: request.request_id,
        handoff_id: request.handoff_id,
        status: "error",
        error_code: "content_script_unavailable",
        stage: "content_script_timeout"
      }), 100));
    }
    if (message.type === "CHECK_HANDOFF_SENT") {
      acceptanceChecks += 1;
      return acceptanceChecks === 1
        ? {
            request_id: request.request_id,
            handoff_id: request.handoff_id,
            status: "error",
            error_code: "handoff_not_sent",
            stage: "handoff_acceptance_not_found"
          }
        : {
            request_id: request.request_id,
            handoff_id: request.handoff_id,
            status: "sent",
            stage: "user_message_already_correlated"
          };
    }
    return {
      request_id: request.request_id,
      session_id: request.session_id,
      handoff_id: request.handoff_id,
      boundary_id: request.boundary_id,
      status: "watching"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  await wait(15);
  const ready = await harness.notifyRuntimeMessage({ type: "CONTENT_SCRIPT_READY" });
  assert.equal(ready.ok, true);

  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.equal(acceptanceChecks, 2);
  assert.equal(handoffCalls, 2, "the second call is the pending original dispatch, not a recovery repost");
  assert.equal(harness.socket.sent.filter((message) => message.type === "handoff.result").length, 1);

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "received",
    payload: "response payload",
    stage: "assistant_response_complete"
  }, { tab: { id: 100 } });
  const response = await harness.waitForSocketMessage(previousCount, (message) => message.type === "assistant.response");
  assert.equal(response.status, "received");
  assert.equal(response.request_id, request.request_id);
  assert.equal(response.handoff_id, request.handoff_id);
});

test("Background replies on the current Bridge socket even when hello acknowledgement bookkeeping is late", async () => {
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

  // The Desktop can send the Handoff immediately after its server-side
  // handshake. The current socket is already authenticated from the
  // Background's perspective even if the local hello.ack flag has not been
  // assigned yet.
  new Script("acknowledgedSocket = null;").runInContext(harness.context);
  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.equal(harness.socket.sent.filter((message) => message.type === "handoff.result").length, 1);
});

test("Background queues a Handoff ACK until a replacement Bridge socket is authenticated", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") {
      // Model an MV3 socket replacement after ChatGPT accepted the user
      // message but before the background worker can relay handoff.result.
      new Script("manualDisconnect = true;").runInContext(harness.context);
      harness.socket.close();
      return {
        request_id: request.request_id,
        handoff_id: request.handoff_id,
        status: "sent",
        stage: "user_message_correlated"
      };
    }
    return {
      request_id: message.requestId,
      session_id: message.sessionId,
      handoff_id: message.handoffId,
      boundary_id: message.boundaryId,
      status: "watching"
    };
  });

  const oldSocket = harness.socket;
  harness.context.handleBridgeMessage(request, oldSocket);
  await wait(20);
  assert.equal(oldSocket.sent.some((message) => message.type === "handoff.result"), false);

  const replacementSocket = await harness.openAuthenticatedSocket();
  const result = await harness.waitForSocketMessage(0, (message) => message.type === "handoff.result");
  assert.equal(replacementSocket, harness.socket);
  assert.equal(result.request_id, request.request_id);
  assert.equal(result.status, "sent");
});

test("Background retries a Handoff result that was sent to a stale socket", async () => {
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
  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");

  // The server may have replaced this socket before the browser receives its
  // close event. A local WebSocket send is therefore not an ACK.
  const oldSocket = harness.socket;
  new Script("manualDisconnect = true;").runInContext(harness.context);
  oldSocket.close();

  const replacementSocket = await harness.openAuthenticatedSocket();
  const resent = await harness.waitForSocketMessage(0, (message) => message.type === "handoff.result");
  assert.equal(replacementSocket, harness.socket);
  assert.equal(resent.request_id, request.request_id);
  assert.equal(resent.handoff_id, request.handoff_id);
  assert.equal(resent.status, "sent");
});

test("Background removes a delivery only after the Desktop receipt ACK", async () => {
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
  const oldSocket = harness.socket;
  harness.context.handleBridgeMessage({
    type: "bridge.delivery.ack",
    delivery_type: "handoff.result",
    request_id: request.request_id,
    handoff_id: request.handoff_id,
    status: "received"
  }, oldSocket);
  new Script("manualDisconnect = true;").runInContext(harness.context);
  oldSocket.close();

  const replacementSocket = await harness.openAuthenticatedSocket();
  await wait(20);
  assert.equal(replacementSocket.sent.some((message) => message.type === "handoff.result"), false);
});

test("Background queues an assistant response across a Bridge socket reconnect", async () => {
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
  const oldSocket = harness.socket;
  new Script("manualDisconnect = true;").runInContext(harness.context);
  oldSocket.close();

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "received",
    payload: "response payload",
    stage: "assistant_response_complete"
  }, { tab: { id: 100 } });
  await wait(20);
  assert.equal(oldSocket.sent.filter((message) => message.type === "assistant.response").length, 0);

  const replacementSocket = await harness.openAuthenticatedSocket();
  const response = await harness.waitForSocketMessage(0, (message) => message.type === "assistant.response");
  assert.equal(replacementSocket, harness.socket);
  assert.equal(response.request_id, request.request_id);
  assert.equal(response.payload, "response payload");
});

test("Background rearms a response watcher when a replacement Content Script is ready", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let watchCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      watchCalls += 1;
      if (watchCalls === 1) {
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
  assert.equal(result.status, "sent");
  assert.equal(watchCalls, 1);

  await harness.notifyRuntimeMessage({ type: "CONTENT_SCRIPT_READY" });
  for (let attempt = 0; attempt < 20 && watchCalls < 2; attempt += 1) await wait(5);
  assert.equal(watchCalls, 2);
});

test("Background suppresses a duplicate Handoff after the first user message was accepted", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 17, url: "https://chatgpt.com/c/fixture" }]);
  let handoffSendCount = 0;
  harness.setContentHandler((message) => {
    if (message.type === "HANDOFF_SEND") handoffSendCount += 1;
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? {
          request_id: message.requestId,
          session_id: message.sessionId,
          handoff_id: message.handoffId,
          boundary_id: message.boundaryId,
          status: "watching"
        }
      : {
          request_id: message.requestId,
          handoff_id: message.handoffId,
          status: "sent"
        };
  });

  const firstCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const firstResult = await harness.waitForResult(firstCount);
  assert.equal(firstResult.status, "sent");

  const retry = {
    ...request,
    request_id: "request-fixture-retry"
  };
  const retryCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(retry, harness.socket);
  const retryResult = await harness.waitForSocketMessage(retryCount, (message) =>
    message.type === "handoff.result" && message.request_id === retry.request_id);

  assert.equal(retryResult.status, "sent");
  assert.equal(retryResult.request_id, retry.request_id);
  assert.equal(retryResult.stage, "handoff_duplicate_suppressed");
  assert.equal(handoffSendCount, 1);
});

test("Background reopens the exact bound conversation when its original tab is closed", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 7, url: "https://chatgpt.com/c/unrelated" }]);
  const boundRequest = {
    ...request,
    request_id: "bound-request-fixture",
    target_conversation_id: "conversation-saved",
    target_conversation_url: "https://chatgpt.com/c/conversation-saved"
  };
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: boundRequest.request_id,
        session_id: boundRequest.session_id,
        handoff_id: boundRequest.handoff_id,
        boundary_id: boundRequest.boundary_id,
        status: "watching",
        stage: "response_watch_started"
      };
    }
    return {
      request_id: boundRequest.request_id,
      handoff_id: boundRequest.handoff_id,
      status: "sent"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(boundRequest, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(result.target_conversation_id, "conversation-saved");
  assert.equal(result.target_conversation_url, boundRequest.target_conversation_url);
  assert.deepEqual(harness.createdTabs.map((tab) => tab.url), [boundRequest.target_conversation_url]);
  const handoffMessage = relayedMessages.find((message) => message.type === "HANDOFF_SEND");
  const watchMessage = relayedMessages.find((message) => message.type === "WATCH_ASSISTANT_RESPONSE");
  assert.equal(handoffMessage?.requestId, boundRequest.request_id);
  assert.equal(watchMessage?.targetTabId, 100);
});

test("Background waits for a newly opened Conversation before dispatching the Handoff", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 7, url: "https://chatgpt.com/c/unrelated" }]);
  harness.setNextCreatedTabStatus("loading");
  const boundRequest = {
    ...request,
    request_id: "loading-bound-request-fixture",
    handoff_id: "loading-bound-handoff-fixture",
    boundary_id: "loading-boundary-fixture",
    target_conversation_id: "conversation-loading",
    target_conversation_url: "https://chatgpt.com/c/conversation-loading"
  };
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: boundRequest.request_id,
        session_id: boundRequest.session_id,
        handoff_id: boundRequest.handoff_id,
        boundary_id: boundRequest.boundary_id,
        status: "watching"
      };
    }
    return {
      request_id: boundRequest.request_id,
      handoff_id: boundRequest.handoff_id,
      status: "sent"
    };
  });
  // tabs.create resolves while the new document is still loading.  The
  // first dispatch therefore has no receiving Content Script; completing the
  // navigation must make the same request succeed without user retry.
  harness.setContentError(new Error("Could not establish connection."));
  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(boundRequest, harness.socket);
  setTimeout(() => {
    harness.setContentError(null);
    harness.setTabStatus(100, "complete");
  }, 10);

  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  assert.deepEqual(harness.createdTabs.map((tab) => tab.url), [boundRequest.target_conversation_url]);
  const handoffMessage = relayedMessages.find((message) => message.type === "HANDOFF_SEND");
  const watchMessage = relayedMessages.find((message) => message.type === "WATCH_ASSISTANT_RESPONSE");
  assert.equal(handoffMessage?.requestId, boundRequest.request_id);
  assert.equal(watchMessage?.targetTabId, 100);
});

test("Background sends a Review Handoff through the Managed Tab and preserves its attachment metadata", async () => {
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
  assert.equal(result.target_tab_id, harness.managedTabId);
  assert.equal(result.target_tab_url, reviewHandoffRequest.target_tab_url);
  assert.equal(harness.createdTabs[0].active, true);
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
  assert.equal(watchMessage.prepare, true);
  assert.equal(watchMessage.targetTabId, harness.managedTabId);

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: reviewHandoffRequest.request_id,
    sessionId: reviewHandoffRequest.session_id,
    handoffId: reviewHandoffRequest.handoff_id,
    boundaryId: reviewHandoffRequest.boundary_id,
    status: "received",
    payload: "review response",
    stage: "assistant_response_complete"
  }, { tab: { id: harness.managedTabId } });
  const response = await harness.waitForSocketMessage(previousCount, (message) => message.type === "assistant.response");
  assert.equal(response.target_tab_id, harness.managedTabId);
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
      }, { tab: { id: harness.managedTabId } });
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
  assert.equal(response.target_tab_id, harness.managedTabId);
  assert.equal(response.target_tab_url, reviewHandoffRequest.target_tab_url);
});

test("Background rejects a Review response after the Managed Tab navigates away", async () => {
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
  harness.setTabUrl(harness.managedTabId, "https://chatgpt.com/c/another-conversation");
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: reviewHandoffRequest.request_id,
    sessionId: reviewHandoffRequest.session_id,
    handoffId: reviewHandoffRequest.handoff_id,
    boundaryId: reviewHandoffRequest.boundary_id,
    status: "received",
    payload: "response from another conversation"
  }, { tab: { id: harness.managedTabId } });

  const response = await harness.waitForSocketMessage(previousCount, (message) => message.type === "assistant.response");
  assert.equal(response.status, "error");
  assert.equal(response.error_code, "review_target_tab_not_found");
  assert.equal(response.stage, "target_tab_check");
  assert.equal(response.target_tab_id, harness.managedTabId);
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
  assert.equal(relayedMessages.length, 3);
  assert.ok(relayedMessages.some((message) => message.type === "CHATGPT_EXECUTION_READY"));
  assert.ok(relayedMessages.some((message) => message.type === "WATCH_ASSISTANT_RESPONSE"));
  assert.ok(relayedMessages.some((message) => message.type === "HANDOFF_SEND"));

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
  }, { tab: { id: 100 } });

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
  }, { tab: { id: 100 } });
  const response = await harness.waitForSocketMessage(previousCount + 1, (message) => message.type === "assistant.response");
  assert.equal(response.status, "error");
  assert.equal(response.error_code, "response_timeout");
  assert.equal(response.stage, "assistant_response_stability_timeout");
  assert.equal(response.message, "応答待機がタイムアウトしました。");
  await wait(10);
  const telemetryEntries = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields && typeof fields === "object");
  const timeoutTelemetry = telemetryEntries.find((fields) =>
    fields.stage === "assistant_response_received"
      && fields.error_code === "response_timeout"
      && fields.watcher_state === "idle");
  assert.equal(timeoutTelemetry.watcher_state, "idle");
  assert.equal(timeoutTelemetry.assistant_state, "not_detected");
  assert.ok(telemetryEntries.some((fields) => fields.stage === "response_correlation_rejected"
    && fields.error_code === "response_timeout"));
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
  }, { tab: { id: 100 } });
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

test("Background forwards a complete metadata snapshot through an active Collector Window Tab", async () => {
  const harness = await createHarness();
  const requestedMessages = [];
  harness.setContentHandler((message) => {
    requestedMessages.push(message);
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [
        {
          project_id: "g-p-project-a",
          title: "Project A",
          url: "https://chatgpt.com/g/g-p-project-a/project"
        },
        {
          project_id: "g-p-project-visible",
          title: "Visible Project",
          url: "https://chatgpt.com/g/g-p-project-visible/project"
        }
      ],
      conversations: [
        {
          conversation_id: "conversation-a",
          title: "Visible Chat",
          url: "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
          project_id: "g-p-project-a",
          project_title: "Project A"
        }
      ],
      current: {
        conversation_id: "conversation-a",
        title: "Visible Chat",
        url: "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
        project_id: "g-p-project-a",
        project_title: "Project A"
      }
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "context-request-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(requestedMessages[0].type, "GET_COLLECTOR_VIEWPORT");
  const contextMessages = requestedMessages.filter((message) => message.type === "GET_CHATGPT_CONTEXT");
  assert.equal(contextMessages[0].mode, "list");
  assert.equal(contextMessages[0].collection, "root");
  assert.equal(contextMessages[1].collection, "project");
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[0].autoDiscardable, false);
  assert.notEqual(harness.createdTabs[0].windowId, 1);
  assert.equal(harness.createdTabs[0].url, "https://chatgpt.com/g/g-p-project-visible/project");
  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdWindows[0].focused, false);
  assert.equal(harness.createdWindows[0].state, "normal");
  assert.equal(harness.createdWindows[0].width, 960);
  assert.equal(harness.createdWindows[0].height, 540);
  assert.equal(response.request_id, "context-request-fixture");
  assert.equal(response.status, "ok");
  assert.deepEqual(response.projects, [
    {
      project_id: "g-p-project-a",
      title: "Project A",
      url: "https://chatgpt.com/g/g-p-project-a/project"
    },
    {
      project_id: "g-p-project-visible",
      title: "Visible Project",
      url: "https://chatgpt.com/g/g-p-project-visible/project"
    }
  ]);
  assert.equal(response.conversations[0].title, "Visible Chat");
  assert.equal(response.current.project_id, "g-p-project-a");
});

test("Background separates Project chat completeness from Root Project catalog completeness", async () => {
  const harness = await createHarness();
  const project = {
    project_id: "g-p-project-page",
    title: "Project page",
    url: "https://chatgpt.com/g/g-p-project-page/project"
  };
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [project],
        conversations: [{
          conversation_id: "project-page-chat",
          title: "Project page chat",
          url: "https://chatgpt.com/g/g-p-project-page/c/project-page-chat",
          project_id: project.project_id
        }],
        current: null,
        // The Root Project sidebar is intentionally not complete on a
        // Project page. That must not invalidate the Project chat scan.
        sidebar_scroll_complete: false,
        project_page_ready: true,
        current_project_id_verified: true,
        chat_container_found: true,
        visible_chat_count: 1,
        discovered_chat_count: 1,
        deduped_chat_count: 1,
        scroll_iteration: 2,
        scroll_top: 0,
        scroll_height: 1200,
        scroll_complete: true,
        project_chat_collection_complete: true
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [project],
      conversations: [],
      current: null,
      project_section_found: true,
      sidebar_scroll_complete: true,
      sidebar_at_bottom: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-project-chat-completeness"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-project-chat-completeness");

  assert.equal(response.status, "ok");
  assert.deepEqual(response.conversations.map((conversation) => conversation.conversation_id), [
    "project-page-chat"
  ]);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_sidebar_scan_incomplete"), false);
  const scan = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_chat_scan");
  assert.equal(scan.project_page_ready, true);
  assert.equal(scan.current_project_id_verified, true);
  assert.equal(scan.discovered_chat_count, 1);
  assert.equal(scan.deduped_chat_count, 1);
  assert.equal(scan.scroll_complete, true);
  const structure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_chat_dom_structure");
  assert.equal(structure.current_project_id, project.project_id);
  assert.equal(structure.project_page_ready, true);
  assert.equal(structure.current_project_id_verified, true);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_chat_collection_complete"), true);
});

test("Background rejects an incomplete Project chat scan without relabeling it as a catalog error", async () => {
  const harness = await createHarness();
  const project = {
    project_id: "g-p-incomplete-project-page",
    title: "Incomplete Project page",
    url: "https://chatgpt.com/g/g-p-incomplete-project-page/project"
  };
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [project],
        conversations: [],
        current: null,
        project_page_ready: true,
        current_project_id_verified: true,
        chat_container_found: false,
        scroll_complete: false,
        project_chat_collection_complete: false
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [project],
      conversations: [],
      current: null,
      project_section_found: true,
      sidebar_scroll_complete: true,
      sidebar_at_bottom: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-project-chat-incomplete"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-project-chat-incomplete");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_project_chats_incomplete");
  const failure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_chat_collection_incomplete");
  assert.equal(failure.error_code, "context_project_chats_incomplete");
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_sidebar_scan_incomplete"), false);
});

test("Background preserves the Content Script Project Chat failure classification", async () => {
  const harness = await createHarness();
  const project = {
    project_id: "g-p-project-chat-error",
    title: "Project Chat error",
    url: "https://chatgpt.com/g/g-p-project-chat-error/project"
  };
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "error",
        errorCode: "context_extraction_failed",
        failure_stage: "project_chat_collection",
        internal_reason: "reference_error",
        exception_name: "ReferenceError",
        exception_reason: "reference_error",
        projects: [],
        conversations: [],
        current: null
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [project],
      conversations: [],
      current: null,
      project_section_found: true,
      sidebar_scroll_complete: true,
      sidebar_at_bottom: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-project-chat-error"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-project-chat-error");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_extraction_failed");
  const failure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_chat_collection_failed");
  assert.equal(failure.error_code, "context_extraction_failed");
  assert.equal(failure.failure_stage, "project_chat_collection");
  assert.equal(failure.internal_reason, "reference_error");
  assert.equal(failure.exception_name, "ReferenceError");
  assert.equal(failure.exception_reason, "reference_error");
});

test("Background reconciles duplicate Collector Tabs and keeps the canonical Tab active", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => ({
    type: "CHATGPT_CONTEXT_RESULT",
    requestId: message.requestId,
    mode: "list",
    status: "ok",
    projects: [{
      project_id: "g-p-topology",
      title: "Topology Project",
      url: "https://chatgpt.com/g/g-p-topology/project"
    }],
    conversations: [],
    current: null
  }));

  const firstCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-topology-first"
  }, harness.socket);
  await harness.waitForSocketMessage(firstCount, (message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-topology-first");

  const collectorWindowId = harness.createdWindows[0].id;
  const canonicalTabId = harness.createdTabs[0].id;
  await harness.addTabToWindow({
    windowId: collectorWindowId,
    url: "https://chatgpt.com/duplicate",
    active: true
  });

  const secondCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-topology-second"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(secondCount, (message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-topology-second");

  const tabs = harness.tabsInWindow(collectorWindowId);
  assert.equal(response.status, "ok");
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].id, canonicalTabId);
  assert.equal(tabs[0].active, true);
  assert.equal(tabs[0].autoDiscardable, false);
  const topology = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_tab_topology")
    .at(-1);
  assert.equal(topology.collector_tab_id, canonicalTabId);
  assert.equal(topology.active_tab_id_in_collector_window, canonicalTabId);
  assert.equal(topology.collector_tab_active, true);
  assert.equal(topology.tab_count_in_collector_window, 1);
});

test("Background suppresses unchanged Collector topology and state telemetry", async () => {
  const harness = await createHarness();
  const project = {
    project_id: "g-p-stable-topology",
    title: "Stable topology Project",
    url: "https://chatgpt.com/g/g-p-stable-topology/project"
  };
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type === "GET_CHATGPT_CONTEXT" && message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [project],
        conversations: [],
        current: null
      };
    }
    if (message.type === "GET_CHATGPT_CONTEXT") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [project],
        conversations: [],
        current: null,
        project_section_found: true,
        sidebar_scroll_complete: true,
        sidebar_at_bottom: true
      };
    }
    return {};
  });

  const request = async (requestId) => {
    const previousCount = harness.socket.sent.length;
    harness.context.handleBridgeMessage({
      type: "chatgpt.context.list.request",
      request_id: requestId
    }, harness.socket);
    return await harness.waitForSocketMessage(
      previousCount,
      (message) => message.type === "chatgpt.context.list.response"
        && message.request_id === requestId);
  };

  assert.equal((await request("collector-stable-topology-first")).status, "ok");
  const firstCounts = {
    topology: harness.diagnostics.filter(([, fields]) => fields?.stage === "collector_tab_topology").length,
    state: harness.diagnostics.filter(([, fields]) => fields?.stage === "collector_tab_state_enforced").length
  };
  assert.equal((await request("collector-stable-topology-second")).status, "ok");
  const secondCounts = {
    topology: harness.diagnostics.filter(([, fields]) => fields?.stage === "collector_tab_topology").length,
    state: harness.diagnostics.filter(([, fields]) => fields?.stage === "collector_tab_state_enforced").length
  };
  assert.deepEqual(secondCounts, firstCounts);
});

test("Background widens a Collector Window until the desktop sidebar viewport is ready", async () => {
  const harness = await createHarness();
  let viewportCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") {
      viewportCalls += 1;
      const narrow = viewportCalls === 1;
      return {
        type: "COLLECTOR_VIEWPORT_RESULT",
        requestId: message.requestId,
        status: "ok",
        content_inner_width: narrow ? 600 : 800,
        content_inner_height: 540,
        sidebar_container_exists: true,
        project_section_exists: true,
        project_row_locator_ready: true,
        desktop_layout: !narrow,
        sidebar_expected_visible: !narrow,
        sidebar_ready: !narrow
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: "g-p-viewport",
        title: "Viewport Project",
        url: "https://chatgpt.com/g/g-p-viewport/project"
      }],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-viewport-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "ok");
  assert.equal(viewportCalls, 2);
  assert.ok(harness.createdWindows[0].width > 960);
  assert.equal(harness.createdWindows[0].focused, false);
  assert.equal(harness.createdWindows[0].state, "normal");
  const viewportTelemetry = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_viewport_observed");
  assert.equal(viewportTelemetry[0].collector_content_inner_width, 600);
  assert.equal(viewportTelemetry[0].sidebar_expected_visible, false);
  assert.equal(viewportTelemetry.at(-1).collector_content_inner_width, 800);
  assert.equal(viewportTelemetry.at(-1).sidebar_expected_visible, true);
  assert.equal(viewportTelemetry.at(-1).viewport_retry_count, 1);
});

test("Background waits for Root Sidebar hydration before starting Project discovery", async () => {
  const harness = await createHarness();
  const events = [];
  const project = {
    project_id: "g-p-hydrated",
    title: "Hydrated Project",
    url: "https://chatgpt.com/g/g-p-hydrated/project"
  };
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type === "GET_COLLECTOR_ROOT_HYDRATION") {
      events.push("root-hydration");
      return {
        type: "COLLECTOR_ROOT_HYDRATION_RESULT",
        requestId: message.requestId,
        status: "ok",
        refresh_generation: message.refreshGeneration,
        navigation_generation: message.navigationGeneration,
        collector_tab_id: message.collectorTabId,
        expected_root_url: "https://chatgpt.com/",
        root_hydration_started: true,
        root_hydration_completed: true,
        root_hydration_timeout: false,
        hydration_wait_ms: 35,
        document_ready_state: "complete",
        sidebar_root_present: true,
        sidebar_scroll_container_present: true,
        sidebar_shell_present: true,
        sidebar_sections_stable: true,
        mutation_count: 2,
        mutation_quiet_ms: 600,
        root_url_verified: true
      };
    }
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    events.push(`context:${message.collection}`);
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [project],
        conversations: [],
        current: null
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [project],
      conversations: [],
      current: null,
      project_section_found: true,
      sidebar_scroll_complete: true,
      sidebar_at_bottom: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-hydration-order"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-hydration-order");

  assert.equal(response.status, "ok");
  assert.deepEqual(events, ["root-hydration", "context:root", "context:project"]);
  const diagnosticEntries = harness.diagnostics.map(([eventName, fields]) => ({ eventName, fields }));
  const hydrationCompleteIndex = diagnosticEntries.findIndex((entry) =>
    entry.fields?.stage === "collector_root_hydration_complete");
  const discoveryStartIndex = diagnosticEntries.findIndex((entry) =>
    entry.fields?.stage === "collector_project_discovery_start");
  assert.ok(hydrationCompleteIndex >= 0);
  assert.ok(discoveryStartIndex > hydrationCompleteIndex);
  assert.equal(diagnosticEntries[hydrationCompleteIndex].fields.root_hydration_completed, true);
  assert.equal(diagnosticEntries[discoveryStartIndex].fields.root_hydration_completed, true);
});

test("Background does not start Project discovery when Root Sidebar hydration times out", async () => {
  const harness = await createHarness();
  let discoveryCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type === "GET_COLLECTOR_ROOT_HYDRATION") {
      return {
        type: "COLLECTOR_ROOT_HYDRATION_RESULT",
        requestId: message.requestId,
        status: "error",
        errorCode: "collector_root_hydration_timeout",
        refresh_generation: message.refreshGeneration,
        navigation_generation: message.navigationGeneration,
        collector_tab_id: message.collectorTabId,
        expected_root_url: "https://chatgpt.com/",
        root_hydration_started: true,
        root_hydration_completed: false,
        root_hydration_timeout: true,
        hydration_wait_ms: 30000,
        document_ready_state: "loading",
        sidebar_root_present: false,
        sidebar_scroll_container_present: false,
        sidebar_shell_present: false,
        sidebar_sections_stable: false,
        mutation_count: 4,
        mutation_quiet_ms: 0,
        root_url_verified: true
      };
    }
    if (message.type === "GET_CHATGPT_CONTEXT") {
      discoveryCalls += 1;
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [],
        conversations: [],
        current: null
      };
    }
    return {};
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-hydration-timeout"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-hydration-timeout");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "collector_root_hydration_timeout");
  assert.equal(discoveryCalls, 0);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_discovery_start"), false);
  const hydrationFailure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_root_hydration_validation");
  assert.equal(hydrationFailure?.root_hydration_completed, false);
  assert.equal(hydrationFailure?.root_hydration_timeout, true);
});

test("Background rejects a stale Root hydration generation before Project discovery", async () => {
  const harness = await createHarness();
  let discoveryCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type === "GET_COLLECTOR_ROOT_HYDRATION") {
      return {
        type: "COLLECTOR_ROOT_HYDRATION_RESULT",
        requestId: message.requestId,
        status: "ok",
        refresh_generation: message.refreshGeneration,
        navigation_generation: "stale-navigation-generation",
        collector_tab_id: message.collectorTabId,
        expected_root_url: "https://chatgpt.com/",
        root_hydration_started: true,
        root_hydration_completed: true,
        root_hydration_timeout: false,
        hydration_wait_ms: 10,
        document_ready_state: "complete",
        sidebar_root_present: true,
        sidebar_scroll_container_present: true,
        sidebar_shell_present: true,
        sidebar_sections_stable: true,
        mutation_count: 1,
        mutation_quiet_ms: 600,
        root_url_verified: true
      };
    }
    if (message.type === "GET_CHATGPT_CONTEXT") discoveryCalls += 1;
    return {};
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-stale-hydration"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "collector-stale-hydration");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "collector_root_hydration_correlation_failed");
  assert.equal(discoveryCalls, 0);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_discovery_start"), false);
});

test("Background does not mark a wide zero-Project Collector scan as Collected", async () => {
  const harness = await createHarness();
  let rootCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") {
      return {
        type: "COLLECTOR_VIEWPORT_RESULT",
        requestId: message.requestId,
        status: "ok",
        content_inner_width: 1024,
        content_inner_height: 540,
        sidebar_container_exists: true,
        project_section_exists: true,
        project_row_locator_ready: true,
        desktop_layout: true,
        sidebar_expected_visible: true,
        sidebar_ready: true
      };
    }
    if (message.type === "GET_COLLECTOR_ROOT_HYDRATION") return {};
    rootCalls += 1;
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-zero-project-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_projects_incomplete");
  assert.equal(rootCalls, 1);
  const discoveryRuns = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_discovery_start");
  assert.equal(discoveryRuns.length, 1);
  assert.equal(discoveryRuns[0].project_discovery_call_count, 1);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_window_collected"), false);
});

test("Background blocks a second incomplete Project discovery scan in one Refresh", async () => {
  const harness = await createHarness();
  let rootCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_CHATGPT_CONTEXT") rootCalls += 1;
    return {};
  });
  const pending = {
    requestId: "collector-discovery-duplicate-fixture",
    generation: 0,
    tabId: 100,
    projectDiscovery: {
      refreshGeneration: 0,
      runId: "refresh-0-project-duplicate",
      callCount: 1,
      started: true,
      completed: false,
      scanCompleted: false,
      caller: "first_scan",
      inFlight: false,
      alreadyCompleted: false,
      scrollDirection: null,
      restoreCount: 0,
      result: null,
      promise: null
    },
    projectDiscoveryScanResult: null
  };

  assert.throws(
    () => harness.context.collectCollectorRootResult(
      { id: 100 },
      pending,
      {},
      "recovery_orchestration"),
    (error) => error?.code === "context_projects_incomplete");
  assert.equal(rootCalls, 0);
  const blocked = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_discovery_duplicate_blocked");
  assert.equal(blocked.project_discovery_call_count, 1);
  assert.equal(blocked.internal_reason, "project_discovery_already_attempted");
});

test("Background uses the received Project array as the discovery handoff source of truth", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          project_id: "g-p-array-source",
          title: "Array Source Project",
          url: "https://chatgpt.com/g/g-p-array-source/project"
        }],
        conversations: [],
        current: null
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: "g-p-array-source",
        title: "Array Source Project",
        url: "https://chatgpt.com/g/g-p-array-source/project"
      }],
      conversations: [],
      current: null,
      // Simulate stale content-side telemetry while preserving the actual
      // top-level projects array returned by the Content Script.
      discovered_project_count: 0
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-array-source-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "ok");
  assert.deepEqual(response.projects.map((project) => project.project_id), ["g-p-array-source"]);
  const received = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_result_received");
  assert.equal(received.response_shape, "top_level_arrays");
  assert.equal(received.background_projects_length, 1);
  assert.equal(received.discovered_project_count, 1);
  assert.equal(received.content_discovered_project_count, 0);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_result_handoff"), true);
});

test("Background rejects a Project array lost between Content Script telemetry and the result envelope", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [],
      conversations: [],
      current: null,
      visible_project_rows: 10,
      discovered_project_count: 10,
      project_section_found: true,
      sidebar_scroll_complete: true,
      sidebar_at_bottom: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-array-loss-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_projects_incomplete");
  const received = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_result_received");
  assert.equal(received.discovered_project_count, 0);
  assert.equal(received.background_projects_length, 0);
  assert.equal(received.content_discovered_project_count, 10);
  assert.equal(received.response_shape, "top_level_arrays");
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_project_result_handoff_incomplete"
    && fields.error_code === "collector_project_result_handoff_mismatch"), true);
});

test("Background passes the discovered Project array through DOM identity resolution before Chat discovery", async () => {
  const harness = await createHarness();
  const collectionMessages = [];
  const discoveredProjects = [
    { project_index: 0, discovery_index: 0, title: "DOM Project A", discovery_key: "project-a" },
    { project_index: 1, discovery_index: 1, title: "DOM Project B", discovery_key: "project-b" }
  ];
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    collectionMessages.push({ collection: message.collection, identityMode: message.identityMode });
    if (message.collection === "root") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: discoveredProjects,
        conversations: [],
        current: null
      };
    }
    if (message.collection === "project_identity") {
      assert.equal(message.identityMode, "dom");
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: message.projects.map((project) => ({
          ...project,
          project_id: `g-p-${project.project_index}`,
          url: `https://chatgpt.com/g/g-p-${project.project_index}/project`,
          project_index: project.project_index
        })),
        conversations: [],
        current: null,
        project_identity_resolution_completed: true,
        non_navigation_resolved_count: message.projects.length,
        navigation_resolved_count: 0,
        unresolved_count: 0,
        resolution_method: "dom"
      };
    }
    assert.equal(message.collection, "project");
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: message.projectId,
        title: `Resolved ${message.projectId}`,
        url: `https://chatgpt.com/g/${message.projectId}/project`
      }],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-identity-dom-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "ok");
  assert.deepEqual(collectionMessages, [
    { collection: "root", identityMode: undefined },
    { collection: "project_identity", identityMode: "dom" },
    { collection: "project", identityMode: undefined },
    { collection: "project", identityMode: undefined }
  ]);
  assert.deepEqual(response.projects.map((project) => project.project_id), ["g-p-0", "g-p-1"]);

  const identityCompleteIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_identity_resolution_complete");
  const projectNavigationIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_url_navigation");
  assert.ok(identityCompleteIndex >= 0);
  assert.ok(projectNavigationIndex > identityCompleteIndex);
  const identitySummary = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_resolution_complete");
  assert.equal(identitySummary.discovered_project_count, 2);
  assert.equal(identitySummary.resolved_project_count, 2);
  assert.equal(identitySummary.unresolved_count, 0);
  assert.equal(identitySummary.non_navigation_resolved_count, 2);
  assert.equal(identitySummary.navigation_resolved_count, 0);
});

test("Background resolves only the discovered Projects with navigation fallback, then navigates to their URLs", async () => {
  const harness = await createHarness();
  const identityMessages = [];
  const navigationTargets = [];
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.collection === "root") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [
          { project_index: 0, discovery_index: 0, title: "Same name" },
          { project_index: 1, discovery_index: 1, title: "Same name" }
        ],
        conversations: [],
        current: null
      };
    }
    if (message.collection === "project_identity") {
      identityMessages.push({
        mode: message.identityMode,
        projectIndex: message.projects[0]?.project_index,
        refreshGeneration: message.refreshGeneration,
        navigationGeneration: message.navigationGeneration,
        collectorTabId: message.collectorTabId
      });
      if (message.identityMode === "dom") {
        return {
          type: "CHATGPT_CONTEXT_RESULT",
          requestId: message.requestId,
          mode: "list",
          status: "ok",
          projects: message.projects,
          conversations: [],
          current: null
        };
      }
      const projectIndex = message.projects[0].project_index;
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          ...message.projects[0],
          project_id: `g-p-nav-${projectIndex}`,
          url: `https://chatgpt.com/g/g-p-nav-${projectIndex}/project`,
          project_index: projectIndex
        }],
        conversations: [],
        current: null,
        navigation_target_verified: true,
        project_url_pattern_valid: true,
        project_id_url_match: true
      };
    }
    navigationTargets.push(message.projectId);
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: message.projectId,
        title: "Same name",
        url: `https://chatgpt.com/g/${message.projectId}/project`
      }],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-identity-navigation-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "ok");
  assert.deepEqual(identityMessages, [
    {
      mode: "dom",
      projectIndex: 0,
      refreshGeneration: undefined,
      navigationGeneration: undefined,
      collectorTabId: undefined
    },
    {
      mode: "navigation",
      projectIndex: 0,
      refreshGeneration: 1,
      navigationGeneration: "refresh-1-identity-0",
      collectorTabId: 100
    },
    {
      mode: "navigation",
      projectIndex: 1,
      refreshGeneration: 1,
      navigationGeneration: "refresh-1-identity-1",
      collectorTabId: 100
    }
  ]);
  assert.deepEqual(navigationTargets, ["g-p-nav-0", "g-p-nav-1"]);
  assert.deepEqual(response.projects.map((project) => project.project_id), [
    "g-p-nav-0",
    "g-p-nav-1"
  ]);
  assert.equal(harness.createdTabs.length, 1);
  const identityCompleteIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_identity_resolution_complete");
  const firstProjectNavigationIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_url_navigation");
  const navigationDispatchIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_identity_navigation_dispatch");
  const navigationResponseIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_identity_navigation_response");
  const metadataResolutionIndex = harness.diagnostics.findIndex(([, fields]) =>
    fields?.stage === "collector_project_identity_metadata_resolution");
  const navigationEntries = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_identity_navigation_entry");
  const navigationPreconditions = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_identity_navigation_precondition");
  const readyNavigationPreconditions = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_identity_navigation_precondition_ready");
  const navigationExits = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_identity_navigation_exit");
  assert.ok(identityCompleteIndex >= 0);
  assert.ok(firstProjectNavigationIndex > identityCompleteIndex);
  assert.ok(navigationDispatchIndex >= 0);
  assert.ok(navigationResponseIndex > navigationDispatchIndex);
  assert.ok(metadataResolutionIndex > navigationResponseIndex);
  assert.equal(navigationEntries.length, 2);
  assert.equal(navigationEntries[0].project_index, 0);
  assert.equal(navigationEntries[0].target_project_present, true);
  assert.equal(navigationEntries[0].project_index_valid, true);
  assert.equal(navigationEntries[0].discovery_snapshot_present, true);
  assert.equal(navigationEntries[0].discovery_fingerprint_present, true);
  assert.equal(navigationPreconditions.length, 2);
  assert.equal(readyNavigationPreconditions.length, 2);
  assert.equal(navigationPreconditions.every((fields) => fields.root_state_ready === true), true);
  assert.equal(readyNavigationPreconditions.every((fields) => fields.collector_tab_matches === true), true);
  assert.equal(readyNavigationPreconditions.every((fields) => fields.refresh_generation_matches === true), true);
  assert.equal(readyNavigationPreconditions.every((fields) => fields.navigation_generation_matches === true), true);
  assert.equal(navigationExits.length, 2);
  assert.equal(navigationExits.every((fields) => fields.success === true), true);
  assert.equal(navigationExits.every((fields) => fields.exit_reason === "resolved"), true);
  const summary = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_resolution_complete");
  assert.equal(summary.non_navigation_resolved_count, 0);
  assert.equal(summary.navigation_resolved_count, 2);
  assert.equal(summary.unresolved_count, 0);
});

test("Background relays only correlated Project identity navigation telemetry", async () => {
  const harness = await createHarness();
  new Script(`contextRequests.set("collector-identity-telemetry", {
    requestId: "collector-identity-telemetry",
    tabId: 100,
    generation: 7,
    identityNavigationProjectIndex: 0,
    identityNavigationTotalProjects: 10,
    identityNavigationGeneration: "refresh-7-identity-0",
    identityNavigationActive: true
  });`).runInContext(harness.context);

  const result = await harness.notifyRuntimeMessage({
    type: "COLLECTOR_PROJECT_IDENTITY_TELEMETRY",
    request_id: "collector-identity-telemetry",
    refresh_generation: 7,
    collector_tab_id: 100,
    navigation_generation: "refresh-7-identity-0",
    project_index: 0,
    candidate_count: 10,
    row_found: true,
    match_method: "discovery_fingerprint",
    section_verified: true,
    stale_element_reused: false,
    click_attempted: true,
    click_dispatched: true,
    click_target_is_project_row: true,
    interactive_candidate_count: 2,
    selected_target_type: "button",
    selected_target_has_href: false,
    selected_target_role: "button",
    selected_target_tag: "BUTTON",
    selected_target_inside_project_row: true,
    selected_target_is_menu_control: false,
    selected_target_is_overflow_control: false,
    safe_candidate_count: 1,
    visible_safe_candidate_count: 1,
    selection_reason: "button",
    menu_control_reason: "none",
    row_tag: "DIV",
    row_role: "button",
    row_tabindex_present: false,
    row_href_present: false,
    row_aria_haspopup: "none",
    row_aria_expanded: "false",
    row_aria_controls_present: false,
    direct_child_count: 1,
    descendant_count: 1,
    descendant_anchor_count: 0,
    descendant_button_count: 1,
    descendant_role_link_count: 0,
    descendant_role_button_count: 1,
    descendant_tabindex_count: 0,
    descendant_href_count: 0,
    shadow_root_present: false,
    shadow_descendant_count: 0,
    nearest_interactive_ancestor_present: false,
    nearest_interactive_ancestor_tag: "none",
    nearest_interactive_ancestor_role: "none",
    row_is_menu_control: false,
    row_is_overflow_control: false,
    row_interactive_evidence: true,
    stage: "collector_project_identity_click"
  }, { tab: { id: 100, windowId: 200 } });

  assert.deepEqual(Object.fromEntries(Object.entries(result)), { ok: true });
  const entry = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_click");
  assert.equal(entry.project_index, 0);
  assert.equal(entry.candidate_count, 10);
  assert.equal(entry.row_found, true);
  assert.equal(entry.click_dispatched, true);
  assert.equal(entry.interactive_candidate_count, 2);
  assert.equal(entry.selected_target_type, "button");
  assert.equal(entry.selected_target_has_href, false);
  assert.equal(entry.selected_target_role, "button");
  assert.equal(entry.selected_target_tag, "BUTTON");
  assert.equal(entry.selected_target_inside_project_row, true);
  assert.equal(entry.selected_target_is_menu_control, false);
  assert.equal(entry.selected_target_is_overflow_control, false);
  assert.equal(entry.safe_candidate_count, 1);
  assert.equal(entry.selection_reason, "button");
  assert.equal(entry.menu_control_reason, "none");
  assert.equal(entry.row_tag, "DIV");
  assert.equal(entry.row_role, "button");
  assert.equal(entry.row_is_menu_control, false);
  assert.equal(entry.navigation_generation, "refresh-7-identity-0");
  assert.equal(Object.hasOwn(entry, "prompt"), false);
  assert.equal(Object.hasOwn(entry, "project_title"), false);

  new Script('contextRequests.get("collector-identity-telemetry").identityNavigationActive = false;')
    .runInContext(harness.context);
  const lateResult = await harness.notifyRuntimeMessage({
    type: "COLLECTOR_PROJECT_IDENTITY_TELEMETRY",
    request_id: "collector-identity-telemetry",
    refresh_generation: 7,
    collector_tab_id: 100,
    navigation_generation: "refresh-7-identity-0",
    project_index: 0,
    stage: "collector_project_identity_navigation_result"
  }, { tab: { id: 100, windowId: 200 } });
  assert.deepEqual(Object.fromEntries(Object.entries(lateResult)), {
    ok: false,
    error: "collector_project_identity_telemetry_not_correlated"
  });
});

test("Background accepts a Project navigation after the Content Script port closes without replaying the click", async () => {
  const harness = await createHarness();
  let navigationDispatches = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.collection === "root") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{ project_index: 0, discovery_index: 0, title: "Reloaded Project" }],
        conversations: [],
        current: null
      };
    }
    if (message.collection === "project_identity" && message.identityMode === "dom") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: message.projects,
        conversations: [],
        current: null
      };
    }
    if (message.collection === "project_identity") {
      navigationDispatches += 1;
      harness.setTabUrl(
        harness.createdTabs[0].id,
        "https://chatgpt.com/g/g-p-reloaded/project");
      throw new Error("The message port closed before a response was received");
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: message.projectId,
        title: "Reloaded Project",
        url: `https://chatgpt.com/g/${message.projectId}/project`
      }],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-identity-port-close-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "ok");
  assert.equal(navigationDispatches, 1);
  assert.deepEqual(response.projects.map((project) => project.project_id), ["g-p-reloaded"]);
});

test("Background does not complete a Collector scan before the Project section is found", async () => {
  const harness = await createHarness();
  let rootCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") {
      return {
        type: "COLLECTOR_VIEWPORT_RESULT",
        requestId: message.requestId,
        status: "ok",
        content_inner_width: 1024,
        content_inner_height: 540,
        sidebar_container_exists: true,
        project_section_exists: false,
        project_row_locator_ready: true,
        desktop_layout: true,
        sidebar_expected_visible: true,
        sidebar_scroll_container_found: true,
        sidebar_ready: true
      };
    }
    if (message.type === "GET_COLLECTOR_ROOT_HYDRATION") return {};
    rootCalls += 1;
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: "g-p-section-late",
        title: "Section Late Project",
        url: "https://chatgpt.com/g/g-p-section-late/project"
      }],
      conversations: [],
      current: null,
      sidebar_scroll_complete: true,
      project_section_found: false,
      sidebar_at_bottom: true,
      sidebar_scroll_container_found: true
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-section-late-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_projects_incomplete");
  assert.equal(rootCalls, 1);
  const discoveryRuns = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_discovery_start");
  assert.equal(discoveryRuns.length, 1);
  assert.equal(discoveryRuns[0].project_discovery_call_count, 1);
  assert.equal(harness.diagnostics.some(([, fields]) =>
    fields?.stage === "collector_window_collected"), false);
});

test("Background does not publish a Project catalog when a Collector row has no resolvable ID", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => ({
    type: "CHATGPT_CONTEXT_RESULT",
    requestId: message.requestId,
    mode: "list",
    status: "ok",
    projects: message.collection === "root"
      ? [{ title: "タイトルだけのProject", discovery_key: "project-title-only" }]
      : [],
    conversations: [],
    current: null
  }));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "context-incomplete-project-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_projects_incomplete");
  const resolution = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_metadata_resolution");
  assert.equal(resolution.discovered_project_count, 1);
  assert.equal(resolution.resolved_project_count, 0);
  assert.equal(resolution.unresolved_project_count, 1);
  const item = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_metadata_item");
  assert.equal(item.project_index, 0);
  assert.equal(item.title_present, true);
  assert.equal(item.project_id_present, false);
  assert.equal(item.url_present, false);
  assert.equal(item.resolution_status, "unresolved");
  assert.equal(item.unresolved_reason, "missing_stable_identity");
  const failure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_metadata_resolution_failed");
  assert.equal(failure.discovered_project_count, 1);
  assert.equal(failure.resolved_project_count, 0);
  assert.equal(failure.unresolved_project_count, 1);
  const reason = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_metadata_unresolved_reason_failed");
  assert.equal(reason.unresolved_reason, "missing_stable_identity");
  assert.equal(reason.unresolved_reason_count, 1);
  const navigationEntry = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_navigation_entry");
  assert.equal(navigationEntry.target_project_present, true);
  assert.equal(navigationEntry.discovery_snapshot_present, true);
  const navigationFailure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_navigation_failed");
  assert.equal(navigationFailure.navigation_failure_reason, "navigation_target_not_verified");
  assert.equal(navigationFailure.internal_reason, "project_identity_navigation_target_not_verified");
  const navigationExit = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_navigation_exit");
  assert.equal(navigationExit.success, false);
  assert.equal(navigationExit.exit_reason, "navigation_target_not_verified");
  assert.equal(navigationExit.internal_reason, "project_identity_navigation_target_not_verified");
});

test("Background preserves an unsafe Project-row navigation reason", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => {
    if (message.type === "GET_COLLECTOR_VIEWPORT") return {};
    if (message.type === "GET_CHATGPT_CONTEXT" && message.collection === "root") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          title: "Menu Project",
          discovery_key: "menu-project"
        }],
        conversations: [],
        current: null
      };
    }
    if (message.type === "GET_CHATGPT_CONTEXT" && message.collection === "project_identity") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          ...message.projects[0],
          unresolved_reason: "no_safe_project_navigation_target"
        }],
        conversations: [],
        current: null,
        navigation_target_verified: false,
        project_url_pattern_valid: false,
        project_id_url_match: false,
        navigation_failure_reason: "no_safe_project_navigation_target",
        internal_reason: "project_row_is_menu_control"
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [],
      conversations: [],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "context-menu-row-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response"
      && message.request_id === "context-menu-row-fixture");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "context_projects_incomplete");
  const failure = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_identity_navigation_failed");
  assert.equal(failure.navigation_failure_reason, "no_safe_project_navigation_target");
  assert.equal(failure.internal_reason, "project_row_is_menu_control");
});

test("Background keeps the Collector Window separate from the Managed Execution Window", async () => {
  const harness = await createHarness();
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "CHATGPT_EXECUTION_READY") return { status: "ready" };
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      };
    }
    if (message.type === "HANDOFF_SEND") {
      return {
        request_id: request.request_id,
        handoff_id: request.handoff_id,
        status: "sent"
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: "g-p-separation",
        title: "Separation Project",
        url: "https://chatgpt.com/g/g-p-separation/project"
      }],
      conversations: [],
      current: null
    };
  });

  const handoffCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const handoffResult = await harness.waitForResult(handoffCount);
  assert.equal(handoffResult.status, "sent");
  const managedTabId = harness.managedTabId;

  const contextCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "context-separation-fixture"
  }, harness.socket);
  const contextResult = await harness.waitForSocketMessage(
    contextCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(contextResult.status, "ok");
  assert.equal(harness.createdTabs.length, 2);
  assert.notEqual(harness.createdTabs[0].id, harness.createdTabs[1].id);
  assert.equal(harness.createdTabs[0].id, managedTabId);
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[1].active, true);
  assert.equal(harness.createdTabs[1].autoDiscardable, false);
  assert.notEqual(harness.createdTabs[0].windowId, harness.createdTabs[1].windowId);
  assert.equal(harness.createdWindows.length, 2);
  assert.equal(harness.createdWindows[1].focused, false);
  assert.equal(relayedMessages.some((message) => message.type === "GET_CHATGPT_CONTEXT"), true);
  assert.equal(relayedMessages.find((message) => message.type === "GET_CHATGPT_CONTEXT")?.targetTabId, undefined);
});

test("Background visits every Project with one reusable Collector Tab and merges Projectless chats", async () => {
  const harness = await createHarness();
  const collectionMessages = [];
  let rootCollectionMessage = null;
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    collectionMessages.push({ collection: message.collection, projectId: message.projectId });
    if (message.collection === "root") rootCollectionMessage = message;
    if (message.collection === "project" && message.projectId === "g-p-project-a") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          project_id: "g-p-project-a",
          title: "同名Project",
          url: "https://chatgpt.com/g/g-p-project-a/project"
        }],
        conversations: [{
          conversation_id: "conversation-a",
          title: "同名Chat",
          url: "https://chatgpt.com/g/g-p-project-a/c/conversation-a",
          project_id: "g-p-project-a",
          project_title: "同名Project"
        }],
        current: null
      };
    }
    if (message.collection === "project" && message.projectId === "g-p-project-b") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          project_id: "g-p-project-b",
          title: "同名Project",
          url: "https://chatgpt.com/g/g-p-project-b/project"
        }],
        conversations: [{
          conversation_id: "conversation-b",
          title: "同名Chat",
          url: "https://chatgpt.com/g/g-p-project-b/c/conversation-b",
          project_id: "g-p-project-b",
          project_title: "同名Project"
        }],
        current: null
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [
        {
          project_id: "g-p-project-a",
          title: "同名Project",
          url: "https://chatgpt.com/g/g-p-project-a/project"
        },
        {
          project_id: "g-p-project-b",
          title: "同名Project",
          url: "https://chatgpt.com/g/g-p-project-b/project"
        }
      ],
      conversations: [{
        conversation_id: "conversation-free",
        title: "Project外Chat",
        url: "https://chatgpt.com/c/conversation-free"
      }],
      current: null
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "complete-context-fixture"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.deepEqual(collectionMessages, [
    { collection: "root", projectId: undefined },
    { collection: "project", projectId: "g-p-project-a" },
    { collection: "project", projectId: "g-p-project-b" }
  ]);
  assert.equal(rootCollectionMessage.projectDiscoverySource, "existing_project_section_metadata");
  assert.equal(rootCollectionMessage.allowSidebarControls, true);
  assert.equal(rootCollectionMessage.resolveProjectIds, undefined);
  assert.equal(rootCollectionMessage.maxProjectResolutions, undefined);
  assert.deepEqual(
    harness.updatedTabs
      .filter((entry) => typeof entry.changes?.url === "string")
      .map((entry) => ({ tabId: entry.tabId, url: entry.changes.url })),
    [
      { tabId: harness.createdTabs[0].id, url: "https://chatgpt.com/g/g-p-project-a/project" },
      { tabId: harness.createdTabs[0].id, url: "https://chatgpt.com/g/g-p-project-b/project" }
    ]);
  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[0].autoDiscardable, false);
  assert.deepEqual(response.projects.map((project) => project.project_id), [
    "g-p-project-a",
    "g-p-project-b"
  ]);
  const resolution = harness.diagnostics
    .map(([, fields]) => fields)
    .find((fields) => fields?.stage === "collector_project_metadata_resolution");
  assert.equal(resolution.discovered_project_count, 2);
  assert.equal(resolution.resolved_project_count, 2);
  assert.equal(resolution.unresolved_project_count, 0);
  const resolutionItems = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_project_metadata_item");
  assert.deepEqual(resolutionItems.map((fields) => fields.project_index), [0, 1]);
  assert.ok(resolutionItems.every((fields) =>
    fields.title_present === true
    && fields.project_id_present === true
    && fields.url_present === true
    && fields.resolution_status === "resolved"
    && fields.unresolved_reason === "none"));
  const diagnosticEntries = harness.diagnostics.map(([eventName, fields]) => ({ eventName, fields }));
  const resultReceivedIndex = diagnosticEntries.findIndex((entry) =>
    entry.fields?.stage === "collector_project_result_received");
  const resolutionIndex = diagnosticEntries.findIndex((entry) =>
    entry.fields?.stage === "collector_project_metadata_resolution");
  const discoveryCompleteIndex = diagnosticEntries.findIndex((entry) =>
    entry.fields?.stage === "collector_project_discovery_complete");
  const projectNavigationIndexes = diagnosticEntries
    .map((entry, index) => entry.fields?.stage === "collector_project_url_navigation" ? index : -1)
    .filter((index) => index >= 0);
  assert.ok(resultReceivedIndex >= 0);
  assert.ok(resolutionIndex > resultReceivedIndex);
  assert.ok(discoveryCompleteIndex > resolutionIndex);
  assert.ok(projectNavigationIndexes.length > 0);
  assert.ok(projectNavigationIndexes.every((index) => index > discoveryCompleteIndex));
  assert.equal(resolution.background_projects_length, resolution.discovered_project_count);
  assert.deepEqual(response.conversations.map((conversation) => conversation.conversation_id), [
    "conversation-free",
    "conversation-a",
    "conversation-b"
  ]);
});

test("Background does not restart Project discovery after a Project Chat scan failure", async () => {
  const harness = await createHarness();
  const collectionMessages = [];
  let rootCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    collectionMessages.push(message.collection);
    if (message.collection === "root") {
      rootCalls += 1;
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{
          project_id: "g-p-chat-scan-failure",
          title: "Project with a failed Chat scan",
          url: "https://chatgpt.com/g/g-p-chat-scan-failure/project"
        }],
        conversations: [],
        current: null,
        sidebar_scroll_complete: true,
        project_section_found: true,
        sidebar_scroll_direction: "down",
        sidebar_restore_count: 1
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "error",
      errorCode: "collector_project_chat_scan_failed",
      message: "fixture failure"
    };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-project-chat-scan-failure"
  }, harness.socket);
  const response = await harness.waitForSocketMessage(
    previousCount,
    (message) => message.type === "chatgpt.context.list.response");

  assert.equal(response.status, "error");
  assert.equal(response.error_code, "collector_project_chat_scan_failed");
  assert.equal(rootCalls, 1);
  assert.deepEqual(collectionMessages, ["root", "project"]);
  const discoveryEvents = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage?.startsWith("collector_project_discovery_"));
  assert.equal(discoveryEvents.filter((fields) => fields.stage === "collector_project_discovery_start").length, 1);
  assert.equal(discoveryEvents.some((fields) => fields.stage === "collector_project_discovery_already_completed"), false);
});

test("Background returns the Collector Tab to the root before a later full refresh", async () => {
  const harness = await createHarness();
  const collectionMessages = [];
  harness.setContentHandler((message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    collectionMessages.push({ requestId: message.requestId, collection: message.collection });
    if (message.collection === "project") {
      return {
        type: "CHATGPT_CONTEXT_RESULT",
        requestId: message.requestId,
        mode: "list",
        status: "ok",
        projects: [{ project_id: "g-p-refresh", title: "Refresh Project", url: "https://chatgpt.com/g/g-p-refresh/project" }],
        conversations: [{
          conversation_id: "conversation-refresh",
          title: "Refresh Chat",
          url: "https://chatgpt.com/g/g-p-refresh/c/conversation-refresh",
          project_id: "g-p-refresh"
        }],
        current: null
      };
    }
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{ project_id: "g-p-refresh", title: "Refresh Project", url: "https://chatgpt.com/g/g-p-refresh/project" }],
      conversations: [],
      current: null
    };
  });

  const firstCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-root-first"
  }, harness.socket);
  await harness.waitForSocketMessage(firstCount, (message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-root-first");

  const secondCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-root-second"
  }, harness.socket);
  await harness.waitForSocketMessage(secondCount, (message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-root-second");

  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdTabs.length, 1);
  assert.ok(harness.updatedTabs.some((entry) => entry.changes.url === "https://chatgpt.com/"));
  assert.deepEqual(collectionMessages.map((entry) => entry.collection), [
    "root", "project", "root", "project"
  ]);
  const navigationStages = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields?.stage === "collector_root_url_navigation"
      || fields?.stage === "collector_project_url_navigation");
  assert.equal(navigationStages.filter((fields) => fields.stage === "collector_root_url_navigation").length, 1);
  assert.equal(navigationStages.filter((fields) => fields.stage === "collector_project_url_navigation").length, 2);
  assert.equal(navigationStages.find((fields) => fields.stage === "collector_root_url_navigation")
    .collector_navigation_target, "https://chatgpt.com/");
});

test("Background discards a stale Collector refresh result when a newer refresh starts", async () => {
  const harness = await createHarness();
  let oldRootStarted = false;
  let releaseOldRoot;
  const oldRoot = new Promise((resolve) => { releaseOldRoot = resolve; });
  harness.setContentHandler(async (message) => {
    if (message.type !== "GET_CHATGPT_CONTEXT") return {};
    if (message.requestId === "collector-stale-old" && message.collection === "root") {
      oldRootStarted = true;
      await oldRoot;
    }
    const isNew = message.requestId === "collector-stale-new";
    const projectId = isNew ? "g-p-new" : "g-p-old";
    return {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message.requestId,
      mode: "list",
      status: "ok",
      projects: [{
        project_id: projectId,
        title: isNew ? "New Project" : "Old Project",
        url: `https://chatgpt.com/g/${projectId}/project`
      }],
      conversations: [],
      current: null
    };
  });

  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-stale-old"
  }, harness.socket);
  for (let attempt = 0; attempt < 20 && !oldRootStarted; attempt += 1) await wait(2);
  assert.equal(oldRootStarted, true);

  const newCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-stale-new"
  }, harness.socket);
  releaseOldRoot();

  const newest = await harness.waitForSocketMessage(newCount, (message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-stale-new");
  assert.equal(newest.status, "ok");
  assert.deepEqual(newest.projects.map((project) => project.project_id), ["g-p-new"]);
  assert.equal(harness.socket.sent.some((message) =>
    message.type === "chatgpt.context.list.response" && message.request_id === "collector-stale-old"), false);
});

test("Background recovers a closed Collector Tab or Window without touching the Execution Window", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => ({
    type: "CHATGPT_CONTEXT_RESULT",
    requestId: message.requestId,
    mode: "list",
    status: "ok",
    projects: [{
      project_id: "g-p-state",
      title: "State Project",
      url: "https://chatgpt.com/g/g-p-state/project"
    }],
    conversations: [],
    current: null
  }));

  const firstRequestCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-recovery-first"
  }, harness.socket);
  await harness.waitForSocketMessage(firstRequestCount, (message) => message.request_id === "collector-recovery-first");
  const collectorWindowId = harness.createdWindows[0].id;
  const collectorTabId = harness.createdTabs[0].id;
  harness.removeTab(collectorTabId);

  const secondRequestCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-recovery-second"
  }, harness.socket);
  await harness.waitForSocketMessage(secondRequestCount, (message) => message.request_id === "collector-recovery-second");
  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdTabs.length, 2);
  assert.equal(harness.createdTabs[1].windowId, collectorWindowId);
  assert.equal(harness.createdTabs[1].active, true);
  assert.equal(harness.createdTabs[1].autoDiscardable, false);

  await harness.closeExecutionWindow(collectorWindowId);
  const thirdRequestCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage({
    type: "chatgpt.context.list.request",
    request_id: "collector-recovery-third"
  }, harness.socket);
  await harness.waitForSocketMessage(thirdRequestCount, (message) => message.request_id === "collector-recovery-third");
  assert.equal(harness.createdWindows.length, 2);
  assert.equal(harness.createdTabs[2].active, true);
  assert.equal(harness.createdTabs[2].autoDiscardable, false);
});

test("Background replaces discarded or frozen Collector Tabs without creating duplicates", async () => {
  const harness = await createHarness();
  harness.setContentHandler((message) => ({
    type: "CHATGPT_CONTEXT_RESULT",
    requestId: message.requestId,
    mode: "list",
    status: "ok",
    projects: [{
      project_id: "g-p-state",
      title: "State Project",
      url: "https://chatgpt.com/g/g-p-state/project"
    }],
    conversations: [],
    current: null
  }));

  const requestContext = async (requestId) => {
    const previousCount = harness.socket.sent.length;
    harness.context.handleBridgeMessage({
      type: "chatgpt.context.list.request",
      request_id: requestId
    }, harness.socket);
    return await harness.waitForSocketMessage(
      previousCount,
      (message) => message.type === "chatgpt.context.list.response" && message.request_id === requestId);
  };

  await requestContext("collector-state-first");
  const collectorWindowId = harness.createdWindows[0].id;
  let collectorTabId = harness.createdTabs[0].id;
  for (const [index, change] of [
    { discarded: true },
    { frozen: true }
  ].entries()) {
    harness.setTabLifecycle(collectorTabId, change);
    const response = await requestContext(`collector-state-${index + 2}`);
    assert.equal(response.status, "ok");
    assert.equal(harness.createdWindows.length, 1);
    assert.equal(harness.createdTabs.length, index + 2);
    assert.equal(harness.createdTabs.at(-1).windowId, collectorWindowId);
    assert.equal(harness.createdTabs.at(-1).active, true);
    assert.equal(harness.createdTabs.at(-1).autoDiscardable, false);
    assert.equal(harness.getTab(collectorTabId), undefined);
    collectorTabId = harness.createdTabs.at(-1).id;
  }

  await wait(5);
  const stateErrors = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields && fields.stage === "collector_tab_state_changed")
    .map((fields) => fields.error_code);
  assert.deepEqual(stateErrors, ["collector_tab_discarded", "collector_tab_frozen"]);
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

test("Background ignores a non-ChatGPT foreground tab", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 18, url: "https://example.invalid/", active: true }]);
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? { status: "watching" }
      : {
          request_id: request.request_id,
          handoff_id: request.handoff_id,
          status: "sent"
        };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[0].url, "https://chatgpt.com/");
  assert.equal(relayedMessages.every((message) => message.targetTabId !== 18), true);
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
  assert.equal(result.error_code, "response_watch_unavailable");
  assert.equal(result.stage, "response_watch_ready_timeout");
});

test("Background recovers an invalidated Content Script context before sending", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 21, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      }
    : { request_id: request.request_id, handoff_id: request.handoff_id, status: "sent" });
  harness.setContentError(new Error("Extension context invalidated."));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(harness.scriptInjectionCount, 1);
});

test("Background retries when navigation closes the Content Script message port", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 22, url: "https://chatgpt.com/c/fixture" }]);
  harness.setContentHandler((message) => message.type === "WATCH_ASSISTANT_RESPONSE"
    ? {
        request_id: request.request_id,
        session_id: request.session_id,
        handoff_id: request.handoff_id,
        boundary_id: request.boundary_id,
        status: "watching"
      }
    : { request_id: request.request_id, handoff_id: request.handoff_id, status: "sent" });
  harness.setContentError(new Error("The message port closed before a response was received."));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(harness.scriptInjectionCount, 1);
});

test("Background recreates the Managed Tab after it is closed while watching", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 20, url: "https://example.invalid/", active: true }]);
  const boundRequest = {
    ...request,
    request_id: "close-recovery-request-fixture",
    handoff_id: "close-recovery-handoff-fixture",
    boundary_id: "close-recovery-boundary-fixture",
    target_conversation_id: "conversation-recovery",
    target_conversation_url: "https://chatgpt.com/c/conversation-recovery"
  };
  let watcherCalls = 0;
  harness.setContentHandler((message) => {
    if (message.type === "WATCH_ASSISTANT_RESPONSE") watcherCalls += 1;
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? { status: "watching" }
      : {
          request_id: boundRequest.request_id,
          handoff_id: boundRequest.handoff_id,
          status: "sent"
        };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(boundRequest, harness.socket);
  const result = await harness.waitForResult(previousCount);

  assert.equal(result.status, "sent");
  assert.equal(harness.createdTabs.length, 1);
  const removedTabId = harness.managedTabId;
  const executionWindowId = harness.createdTabs[0].windowId;
  harness.removeTab(removedTabId);
  for (let attempt = 0; attempt < 50 && harness.createdTabs.length < 2; attempt += 1) await wait(5);
  assert.equal(harness.createdTabs.length, 2);
  assert.equal(harness.createdTabs[1].active, true);
  assert.equal(harness.createdTabs[1].autoDiscardable, false);
  assert.equal(harness.createdTabs[1].windowId, executionWindowId);
  assert.equal(harness.createdTabs[1].url, boundRequest.target_conversation_url);
  assert.ok(watcherCalls >= 2);

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: boundRequest.request_id,
    sessionId: boundRequest.session_id,
    handoffId: boundRequest.handoff_id,
    boundaryId: boundRequest.boundary_id,
    status: "received",
    payload: "response payload"
  }, { tab: { id: harness.managedTabId } });
  const response = await harness.waitForSocketMessage(previousCount, (message) => message.type === "assistant.response");
  assert.equal(response.status, "received");
  assert.equal(response.request_id, boundRequest.request_id);
  assert.equal(response.handoff_id, boundRequest.handoff_id);
});

test("Background recreates the Execution Window and rebinds the same Conversation after window close", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 23, url: "https://example.invalid/", active: true }]);
  const boundRequest = {
    ...request,
    request_id: "window-close-recovery-request-fixture",
    handoff_id: "window-close-recovery-handoff-fixture",
    boundary_id: "window-close-recovery-boundary-fixture",
    target_conversation_id: "conversation-window-recovery",
    target_conversation_url: "https://chatgpt.com/c/conversation-window-recovery"
  };
  const relayedMessages = [];
  let watcherCalls = 0;
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") watcherCalls += 1;
    return message.type === "WATCH_ASSISTANT_RESPONSE"
      ? { status: "watching" }
      : {
          request_id: boundRequest.request_id,
          handoff_id: boundRequest.handoff_id,
          status: "sent"
        };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(boundRequest, harness.socket);
  const result = await harness.waitForResult(previousCount);
  assert.equal(result.status, "sent");
  const originalWindowId = harness.createdTabs[0].windowId;
  const originalUserTab = harness.getTab(23);

  await harness.closeExecutionWindow(originalWindowId);
  for (let attempt = 0; attempt < 50 && harness.createdWindows.length < 2; attempt += 1) await wait(5);

  assert.equal(harness.createdWindows.length, 2);
  assert.equal(harness.getWindow(originalWindowId), undefined);
  const recoveredTab = harness.createdTabs.at(-1);
  assert.notEqual(recoveredTab.windowId, originalWindowId);
  assert.equal(recoveredTab.active, true);
  assert.equal(recoveredTab.autoDiscardable, false);
  assert.equal(harness.getWindow(recoveredTab.windowId).focused, false);
  assert.equal(originalUserTab.active, true);
  assert.equal(relayedMessages.filter((message) => message.type === "HANDOFF_SEND").length, 1);
  assert.ok(watcherCalls >= 2);
});

test("Background keeps one active Execution Window across Initial, Media, Review, and next-iteration handoffs", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 23, url: "https://example.invalid/", active: true }]);
  const reviewResponse = {
    request_id: "review-next-request-fixture",
    session_id: "session-fixture",
    handoff_id: "review-next-handoff-fixture",
    boundary_id: "review-next-boundary-fixture",
    targetConversationId: "fixture",
    targetConversationUrl: "https://chatgpt.com/c/fixture"
  };
  const nextReviewRequest = {
    ...reviewHandoffRequest,
    request_id: reviewResponse.request_id,
    handoff_id: reviewResponse.handoff_id,
    boundary_id: reviewResponse.boundary_id,
    review_iteration: 3,
    payload: "## Review Handoff\nhandoff_id: review-next-handoff-fixture\n"
  };
  const relayedMessages = [];
  harness.setContentHandler((message) => {
    relayedMessages.push(message);
    if (message.type === "WATCH_ASSISTANT_RESPONSE") {
      return { status: "watching" };
    }
    if (message.type === "HANDOFF_SEND") {
      return {
        request_id: message.requestId,
        session_id: message.sessionId,
        handoff_id: message.handoffId,
        boundary_id: message.boundaryId,
        status: "sent",
        stage: "user_message_correlated",
        current_context: {
          conversation_id: "fixture",
          url: "https://chatgpt.com/c/fixture"
        }
      };
    }
    if (message.type === "REVIEW_MEDIA_ATTACH_BEGIN") return { status: "receiving" };
    if (message.type === "REVIEW_MEDIA_ATTACH_CHUNK") return { status: "receiving" };
    if (message.type === "REVIEW_MEDIA_ATTACH_END") return { status: "attached" };
    return {};
  });
  harness.setMediaResponse({ bytes: new Uint8Array(reviewMediaRequest.size) });

  const initialCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(request, harness.socket);
  assert.equal((await harness.waitForResult(initialCount)).status, "sent");
  const managedTabId = harness.managedTabId;
  const executionWindowId = harness.createdTabs[0].windowId;

  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: request.request_id,
    sessionId: request.session_id,
    handoffId: request.handoff_id,
    boundaryId: request.boundary_id,
    status: "received",
    payload: "initial response",
    stage: "assistant_response_complete"
  }, { tab: { id: managedTabId } });
  assert.equal((await harness.waitForSocketMessage(initialCount, (message) => message.type === "assistant.response")).status, "received");

  const mediaCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewMediaRequest, harness.socket);
  const mediaResult = await harness.waitForSocketMessage(mediaCount, (message) => message.type === "review.media.result");
  assert.equal(mediaResult.status, "attached");

  const reviewCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewHandoffRequest, harness.socket);
  assert.equal((await harness.waitForResult(reviewCount)).status, "sent");
  harness.context.handleAssistantResponseFromContent({
    type: "ASSISTANT_RESPONSE_RESULT",
    requestId: reviewHandoffRequest.request_id,
    sessionId: reviewHandoffRequest.session_id,
    handoffId: reviewHandoffRequest.handoff_id,
    boundaryId: reviewHandoffRequest.boundary_id,
    status: "received",
    payload: "review response",
    targetConversationId: "fixture",
    targetConversationUrl: "https://chatgpt.com/c/fixture",
    stage: "assistant_response_complete"
  }, { tab: { id: managedTabId } });
  assert.equal((await harness.waitForSocketMessage(reviewCount, (message) => message.type === "assistant.response"
    && message.request_id === reviewHandoffRequest.request_id)).status, "received");

  const nextCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(nextReviewRequest, harness.socket);
  assert.equal((await harness.waitForResult(nextCount)).status, "sent");

  assert.equal(harness.createdWindows.length, 1);
  assert.equal(harness.createdTabs.length, 1);
  assert.equal(harness.createdTabs[0].windowId, executionWindowId);
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[0].autoDiscardable, false);
  assert.equal(harness.getTab(23).active, true);
  assert.equal(relayedMessages.filter((message) => message.type === "HANDOFF_SEND").length, 3);
  assert.equal(relayedMessages.filter((message) => message.type === "WATCH_ASSISTANT_RESPONSE").length, 3);
});

test("Background fetches media with the session token and attaches it through the active Managed Tab", async () => {
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
  const mediaMessages = relayedMessages.filter((message) => message.type.startsWith("REVIEW_MEDIA_ATTACH_"));
  assert.ok(mediaMessages.length >= 4, "Media should include begin, bounded chunks, and end messages");
  assert.ok(mediaMessages.every((message) => message.targetTabId === undefined), "Media messages must not receive local tab metadata");
  assert.equal(harness.createdTabs[0].active, true);
  assert.equal(harness.createdTabs[0].url, reviewMediaRequest.target_conversation_url);
  assert.equal(harness.fetchCalls.length, 1);
  assert.match(harness.fetchCalls[0].url, /\/api\/v1\/media\/media-fixture\?/);
  assert.equal(harness.fetchCalls[0].options.headers.Authorization, "Bearer session-fixture");
  assert.equal(harness.fetchCalls[0].options.headers["X-Connector-Client"], "browser-extension");
});

test("Background ignores stale Project metadata when media targets an existing Conversation", async () => {
  const harness = await createHarness();
  const requestWithStaleProject = {
    ...reviewMediaRequest,
    target_project_id: "Project (stale display label)"
  };
  harness.setActiveTabs([{ id: requestWithStaleProject.target_tab_id, url: requestWithStaleProject.target_tab_url }]);
  harness.setMediaResponse({ bytes: new Uint8Array(requestWithStaleProject.size) });
  harness.setContentHandler((message) => {
    if (message.type === "REVIEW_MEDIA_ATTACH_BEGIN") return { status: "receiving" };
    if (message.type === "REVIEW_MEDIA_ATTACH_CHUNK") return { status: "receiving" };
    if (message.type === "REVIEW_MEDIA_ATTACH_END") return { status: "attached", stage: "attachment_verified" };
    return null;
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(requestWithStaleProject, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");

  assert.equal(result.status, "attached");
  assert.equal(result.error_code, undefined);
});

test("Background still rejects invalid Project metadata when opening a new Conversation", async () => {
  const harness = await createHarness();
  const invalidNewConversation = {
    ...request,
    request_id: "new-conversation-invalid-project-request",
    handoff_id: "new-conversation-invalid-project-handoff",
    boundary_id: "new-conversation-invalid-project-boundary",
    new_conversation: true,
    target_project_id: "Project (stale display label)"
  };
  harness.setContentHandler(() => assert.fail("Invalid new-Conversation Project metadata must not reach Content Script"));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(invalidNewConversation, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "handoff.result");

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "target_project_invalid");
  assert.equal(result.stage, "target_project_check");
});

test("Background does not guess a Review conversation when its identity is missing", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 7, url: "https://chatgpt.com/c/other", active: true }]);
  const unboundRequest = {
    ...reviewMediaRequest,
    target_tab_id: undefined,
    target_tab_url: undefined,
    target_conversation_id: undefined,
    target_conversation_url: undefined
  };
  harness.setContentHandler(() => assert.fail("Content Script must not receive media for a missing target"));

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(unboundRequest, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");
  assert.equal(result.status, "error");
  assert.equal(result.error_code, "target_conversation_not_found");
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.createdTabs.length, 0);
});

test("Background rejects a Managed Tab whose reported Conversation is different", async () => {
  const harness = await createHarness();
  harness.setActiveTabs([{ id: 42, url: "https://chatgpt.com/c/another-conversation", active: true }]);
  harness.setContentHandler((message) => {
    if (message.type === "CHATGPT_EXECUTION_READY") {
      return {
        status: "ready",
        current_context: {
          conversation_id: "another-conversation",
          url: "https://chatgpt.com/c/another-conversation"
        }
      };
    }
    return { status: "attached" };
  });

  const previousCount = harness.socket.sent.length;
  harness.context.handleBridgeMessage(reviewMediaRequest, harness.socket);
  const result = await harness.waitForSocketMessage(previousCount, (message) => message.type === "review.media.result");

  assert.equal(result.status, "error");
  assert.equal(result.error_code, "target_conversation_mismatch");
  assert.equal(result.stage, "conversation_ready");
  assert.equal(harness.fetchCalls.length, 0);
});

test("Background preserves explicit media expiry and Content Script upload errors", async () => {
  const expired = await createHarness();
  expired.setActiveTabs([{ id: reviewMediaRequest.target_tab_id, url: reviewMediaRequest.target_tab_url }]);
  expired.setMediaResponse({ status: 410, bytes: [] });
  expired.setContentHandler((message) => {
    if (message.type === "CHATGPT_EXECUTION_READY") return null;
    return assert.fail("Expired media must not be dispatched");
  });
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
