const BRIDGE_HTTP_ORIGIN = "http://127.0.0.1:43127";
const BRIDGE_HEALTH_URL = `${BRIDGE_HTTP_ORIGIN}/health`;
const BRIDGE_PAIR_URL = `${BRIDGE_HTTP_ORIGIN}/api/v1/pair`;
const BRIDGE_BOOTSTRAP_URL = `${BRIDGE_HTTP_ORIGIN}/api/v1/bootstrap`;
const BRIDGE_MEDIA_URL_PREFIX = `${BRIDGE_HTTP_ORIGIN}/api/v1/media/`;
const BRIDGE_WS_URL = "ws://127.0.0.1:43127/bridge";
const BRIDGE_PROTOCOL = "chatgpt-comfy-connector.bridge/1";
const HANDOFF_PROTOCOL = "comfy-connector/1";
const BRIDGE_CLIENT_HEADER = "X-Connector-Client";
const BRIDGE_CLIENT_VALUE = "browser-extension";
const RECONNECT_ALARM = "chatgpt-comfy-connector-reconnect";
const RECONNECT_DELAY_MS = 5000;
const PING_TIMEOUT_MS = 5000;
// MV3 service workers may be suspended after roughly 30 seconds without
// activity. Chrome 116+ keeps an active WebSocket alive when the extension
// sends traffic more frequently than that limit. Keep this below 30 seconds
// so a connected Desktop Bridge does not silently become a stale UI state.
const SOCKET_KEEPALIVE_INTERVAL_MS = 20000;
// Review Handoff dispatch can begin while ChatGPT is still processing a
// video attachment. Keep this transport timeout longer than the Content
// Script's bounded Send-readiness wait so a disabled button is not reported
// as a bridge failure prematurely.
const CONTENT_SCRIPT_TIMEOUT_MS = 75000;
// A newly opened ChatGPT Conversation returns from tabs.create before the
// page reaches document_idle.  Do not interpret the temporary absence of the
// manifest Content Script as a permanent dispatch failure.
const CONTENT_SCRIPT_READY_TIMEOUT_MS = 20000;
const CONTENT_SCRIPT_READY_POLL_INTERVAL_MS = 100;
// Execution is intentionally isolated from the user's foreground Chrome
// window. One active Managed ChatGPT Tab in a connector-owned Execution
// Window is the only tab that may receive a Handoff, media attachment, or
// response watch.
const MANAGED_TAB_STORAGE_KEY = "managedChatGptTab";
const MANAGED_EXECUTION_WINDOW_CREATE_TIMEOUT_MS = 15000;
// A half-width by half-height window occupies roughly one quarter of the
// available screen area while remaining large enough for ChatGPT's composer
// and response DOM.  Use the last-focused user window as a permission-free
// display-size approximation and keep a conservative fallback for startup.
const MANAGED_EXECUTION_WINDOW_SIZE_FACTOR = 0.5;
const MANAGED_EXECUTION_WINDOW_MIN_WIDTH = 640;
const MANAGED_EXECUTION_WINDOW_MIN_HEIGHT = 480;
const MANAGED_EXECUTION_WINDOW_FALLBACK_WIDTH = 960;
const MANAGED_EXECUTION_WINDOW_FALLBACK_HEIGHT = 540;
const MANAGED_TAB_NAVIGATION_TIMEOUT_MS = 30000;
const MANAGED_CONVERSATION_READY_TIMEOUT_MS = 30000;
const MANAGED_WATCHER_READY_TIMEOUT_MS = 20000;
const MANAGED_SEND_CONFIRMATION_TIMEOUT_MS = CONTENT_SCRIPT_TIMEOUT_MS;
// The Content Script emits the metadata-only send confirmation immediately
// after the new user message is visible, then waits briefly for ChatGPT to
// replace the new-chat route with its durable Conversation URL. Give that
// second result a bounded chance to bind the Conversation without delaying
// existing-conversation sends.
const NEW_CONVERSATION_BINDING_GRACE_MS = 6000;
// Context discovery has a separate Collector Window. It must never borrow the
// Managed Execution Window, because discovery and execution have different DOM
// lifecycles and a sidebar/project scan must not reset an active response watcher.
const COLLECTOR_WINDOW_STORAGE_KEY = "chatGptCollectorWindow";
const COLLECTOR_TAB_URL = "https://chatgpt.com/";
const COLLECTOR_WINDOW_CREATE_TIMEOUT_MS = 15000;
const COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS = 30000;
// Collector discovery needs ChatGPT's desktop sidebar. A quarter-width
// window can fall below the sidebar breakpoint, so use the same half-width /
// half-height area rule as Execution and enforce the content viewport below.
const COLLECTOR_WINDOW_SIZE_FACTOR = 0.5;
const COLLECTOR_CONTENT_MIN_WIDTH = 770;
const COLLECTOR_WINDOW_MIN_WIDTH = 820;
const COLLECTOR_WINDOW_MIN_HEIGHT = 480;
const COLLECTOR_WINDOW_FALLBACK_WIDTH = 960;
const COLLECTOR_WINDOW_FALLBACK_HEIGHT = 540;
const COLLECTOR_INITIAL_TAB_WAIT_MS = 1500;
const COLLECTOR_INITIAL_TAB_POLL_MS = 50;
const COLLECTOR_MAX_PROJECTS = 5000;
const COLLECTOR_MAX_CONVERSATIONS = 10000;
const COLLECTOR_PROJECT_SCROLL_MAX = 128;
const COLLECTOR_ROOT_TIMEOUT_MS = 120000;
const COLLECTOR_CONTEXT_TIMEOUT_MS = 150000;
const COLLECTOR_PROJECT_TIMEOUT_MS = 30000;
const COLLECTOR_VIEWPORT_MAX_RETRIES = 4;
const COLLECTOR_SIDEBAR_READY_MAX_RETRIES = 8;
const COLLECTOR_VIEWPORT_RETRY_DELAY_MS = 250;
// A replacement Content Script can become ready before ChatGPT has hydrated
// the newly opened conversation's message list. Keep checking the same
// marker-bearing user message without ever issuing another Handoff send.
const HANDOFF_ACCEPTANCE_RETRY_DELAY_MS = 500;
const HANDOFF_ACCEPTANCE_RETRY_TIMEOUT_MS = CONTENT_SCRIPT_TIMEOUT_MS;
const RESPONSE_WATCH_REARM_DELAY_MS = 500;
const RESPONSE_WATCH_REARM_TIMEOUT_MS = 120000;
// Lifecycle diagnostics are intentionally sparse.  A pending response watch
// gets one metadata-only snapshot every ten seconds; state-change events are
// still emitted immediately by the Chrome event listeners below.
const MANAGED_TAB_LIFECYCLE_TELEMETRY_INTERVAL_MS = 10000;
const HANDOFF_DELIVERY_CACHE_MS = 10 * 60 * 1000;
// A WebSocket send succeeding locally does not prove that the Desktop still
// owns that socket. Keep Handoff/assistant-response envelopes until the Desktop explicitly
// acknowledges receipt, and discard them after the longest response window.
const BRIDGE_DELIVERY_TTL_MS = 10 * 60 * 1000;
const PAIRING_STORAGE_KEY = "bridgePairing";
const RESPONSE_WATCH_MESSAGE_TYPE = "WATCH_ASSISTANT_RESPONSE";
const ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE = "ASSISTANT_RESPONSE_RESULT";
const HANDOFF_SEND_CONFIRMED_MESSAGE_TYPE = "HANDOFF_SEND_CONFIRMED";
const HANDOFF_ACCEPTANCE_CHECK_MESSAGE_TYPE = "CHECK_HANDOFF_SENT";
const CHATGPT_EXECUTION_READY_MESSAGE_TYPE = "CHATGPT_EXECUTION_READY";
const CHATGPT_CONTEXT_LIST_REQUEST_TYPE = "chatgpt.context.list.request";
const CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE = "chatgpt.context.current.request";
const CHATGPT_CONTEXT_LIST_RESPONSE_TYPE = "chatgpt.context.list.response";
const CHATGPT_CONTEXT_CURRENT_RESPONSE_TYPE = "chatgpt.context.current.response";
const CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE = "CHATGPT_CONTEXT_RESULT";
const CHATGPT_CONTEXT_CHANGED_MESSAGE_TYPE = "CHATGPT_CONTEXT_CHANGED";
const REVIEW_MEDIA_ATTACH_BEGIN_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_BEGIN";
const REVIEW_MEDIA_ATTACH_CHUNK_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_CHUNK";
const REVIEW_MEDIA_ATTACH_END_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_END";
const REVIEW_MEDIA_CHUNK_BYTES = 48 * 1024;
const MAX_REVIEW_MEDIA_BYTES = 512 * 1024 * 1024;

const defaultState = {
  status: "DISCONNECTED",
  bridgeUrl: BRIDGE_HTTP_ORIGIN,
  paired: false,
  pairingId: null,
  lastError: null,
  connectedAt: null,
  sessionExpiresAt: null,
  lastEvent: null,
  lastPingAt: null,
  lastPongAt: null
};

let state = { ...defaultState };
let pairing = { pairingId: null, credential: null };
let sessionToken = null;
let socket = null;
let acknowledgedSocket = null;
let connectPromise = null;
let reconnectTimer = null;
let manualDisconnect = false;
const pendingPings = new Map();
const responseWatches = new Map();
// Handoff and assistant-response messages are kept until an authenticated
// current socket accepts them.
// A navigation or service-worker reconnect must not turn a successful ChatGPT
// post into a lost Desktop ACK/assistant response.
const bridgeOutbox = new Map();
// Keep only metadata for an accepted Handoff.  This short-lived cache makes a
// retry after a lost/late ACK idempotent without retaining or logging payload
// text.  The Content Script also verifies the marker-bearing user message.
const acceptedHandoffs = new Map();
// A Content Script can be destroyed after clicking ChatGPT's Send control and
// before the tabs.sendMessage response callback is delivered. Keep a
// metadata-only completion channel so the accepted user message can still
// complete the Desktop Handoff request without posting a second message.
const pendingHandoffSends = new Map();
const contextRequests = new Map();
// A refresh is a replaceable discovery operation. The latest request owns
// the Collector Window result; an older request may finish a currently
// running Chrome call, but it must never send or publish its stale snapshot.
let collectorContextGeneration = 0;
let socketKeepaliveTimer = null;
let socketKeepaliveSocket = null;
const defaultManagedTabState = {
  tabId: null,
  executionWindowId: null,
  executionWindowState: "Idle",
  conversationId: null,
  conversationUrl: null,
  projectId: null,
  projectUrl: null,
  lifecycle: "Idle",
  contentReady: false,
  conversationReady: false,
  composerReady: false,
  watcherReady: false,
  currentRequestId: null,
  currentSessionId: null,
  currentHandoffId: null,
  currentBoundaryId: null
};
let managedTabState = { ...defaultManagedTabState };
let managedTabStateOperation = Promise.resolve();
const managedHandoffOperations = new Map();
const managedMediaOperations = new Map();
const contentScriptReadyTabs = new Map();
const managedTabTelemetrySnapshots = new Map();
const defaultCollectorWindowState = {
  windowId: null,
  tabId: null,
  windowState: "Idle",
  lifecycle: "Idle",
  projectDiscoverySource: "existing_project_section_metadata",
  currentProjectId: null,
  currentProjectUrl: null,
  collectorNavigationTarget: null,
  projectIndex: -1,
  totalProjects: 0,
  discoveredProjectCount: 0,
  discoveredChatCount: 0,
  retryCount: 0,
  projectDiscoveryRetryCount: 0,
  windowWidth: null,
  windowHeight: null,
  contentInnerWidth: null,
  contentInnerHeight: null,
  sidebarExpectedVisible: false,
  viewportRetryCount: 0,
  activeTabIdInWindow: null,
  collectorTabActive: false,
  tabCountInWindow: 0,
  sidebarScrollTop: null,
  sidebarScrollHeight: null,
  sidebarClientHeight: null,
  sidebarCanScroll: false,
  sidebarAtBottom: false,
  visibleProjectRows: 0,
  projectSectionFound: false,
  noGrowthCount: 0,
  refreshGeneration: null,
  projectDiscoveryRunId: null,
  projectDiscoveryCallCount: 0,
  projectDiscoveryStarted: false,
  projectDiscoveryCompleted: false,
  projectDiscoveryScanCompleted: false,
  projectDiscoveryCaller: null,
  projectDiscoveryInFlight: false,
  projectDiscoveryAlreadyCompleted: false,
  projectDiscoveryScrollDirection: null,
  projectDiscoveryRestoreCount: 0,
  projectIdentityResolutionStarted: false,
  projectIdentityResolutionCompleted: false,
  nonNavigationResolvedCount: 0,
  navigationResolvedCount: 0,
  identityUnresolvedCount: 0,
  currentProjectIndex: -1,
  identityResolutionMethod: null,
  navigationTargetVerified: false,
  projectUrlPatternValid: false,
  projectIdUrlMatch: false,
  requestId: null
};
let collectorWindowState = { ...defaultCollectorWindowState };
let collectorWindowStateOperation = Promise.resolve();
let projectDiscoverySequence = 0;

const managedTabStateReady = (async () => {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const stored = await storage.get(MANAGED_TAB_STORAGE_KEY);
    if (stored?.[MANAGED_TAB_STORAGE_KEY] && typeof stored[MANAGED_TAB_STORAGE_KEY] === "object") {
      managedTabState = { ...defaultManagedTabState, ...stored[MANAGED_TAB_STORAGE_KEY] };
    }
  } catch (_) {
    // A missing session-storage implementation must not prevent the Bridge
    // from starting. The managed tab will be created/rebound from the current
    // in-memory state when the first execution request arrives.
  }
  return managedTabState;
})();

const collectorWindowStateReady = (async () => {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const stored = await storage.get(COLLECTOR_WINDOW_STORAGE_KEY);
    if (stored?.[COLLECTOR_WINDOW_STORAGE_KEY] && typeof stored[COLLECTOR_WINDOW_STORAGE_KEY] === "object") {
      collectorWindowState = { ...defaultCollectorWindowState, ...stored[COLLECTOR_WINDOW_STORAGE_KEY] };
    }
  } catch (_) {
    // The Collector Window is recoverable state. A storage failure must not
    // prevent the next refresh from creating a fresh isolated window.
  }
  return collectorWindowState;
})();

const stateReady = (async () => {
  const stored = await chrome.storage.local.get(["bridgeState", PAIRING_STORAGE_KEY]);
  if (stored?.bridgeState && typeof stored.bridgeState === "object") {
    state = { ...defaultState, ...stored.bridgeState };
  }
  if (stored?.[PAIRING_STORAGE_KEY]?.credential) {
    pairing = {
      pairingId: stored[PAIRING_STORAGE_KEY].pairingId || null,
      credential: stored[PAIRING_STORAGE_KEY].credential
    };
    state = {
      ...state,
      paired: true,
      pairingId: pairing.pairingId
    };
  } else {
    state = {
      ...state,
      paired: false,
      pairingId: null
    };
  }
  return state;
})();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function bridgeError(message, status = 0, code = "bridge_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// Diagnostics deliberately whitelist identifiers and outcome fields. Never
// include the pairing credential, session token, or Handoff payload here.
function diagnostic(eventName, fields = {}) {
  const safe = {};
  for (const key of [
    "request_id",
    "session_id",
    "handoff_id",
    "boundary_id",
    "media_id",
    "conversation_id",
    "conversation_url",
    "project_id",
    "status",
    "error_code",
    "stage",
    "lifecycle",
    "execution_window_id",
    "execution_window_focused",
    "execution_window_state",
    "execution_window_exists",
    "execution_window_minimized",
    "collector_window_id",
    "collector_window_focused",
    "collector_window_state",
    "collector_window_exists",
    "collector_tab_id",
    "active_tab_id_in_collector_window",
    "collector_navigation_target",
    "project_discovery_source",
    "current_project_id",
    "current_project_url",
    "project_index",
    "total_projects",
    "discovered_project_count",
    "discovered_chat_count",
    "retry_count",
    "project_discovery_retry_count",
    "refresh_generation",
    "project_discovery_run_id",
    "project_discovery_call_count",
    "project_discovery_started",
    "project_discovery_completed",
    "project_discovery_scan_completed",
    "project_discovery_result_received",
    "project_discovery_caller",
    "project_discovery_in_flight",
    "project_discovery_already_completed",
    "project_discovery_scroll_direction",
    "project_discovery_restore_count",
    "content_discovered_project_count",
    "background_projects_length",
    "response_shape",
    "resolved_project_count",
    "unresolved_project_count",
    "reported_unresolved_project_count",
    "project_identity_resolution_started",
    "project_identity_resolution_completed",
    "non_navigation_resolved_count",
    "navigation_resolved_count",
    "unresolved_count",
    "current_project_index",
    "resolution_method",
    "navigation_target_verified",
    "project_url_pattern_valid",
    "project_id_url_match",
    "unresolved_reason_count",
    "title_present",
    "project_id_present",
    "url_present",
    "resolution_status",
    "unresolved_reason",
    "collector_window_width",
    "collector_window_height",
    "collector_content_inner_width",
    "collector_content_inner_height",
    "sidebar_expected_visible",
    "viewport_retry_count",
    "collector_tab_active",
    "tab_count_in_collector_window",
    "sidebar_container_exists",
    "project_section_exists",
    "project_row_locator_ready",
    "desktop_layout",
    "sidebar_ready",
    "sidebar_scroll_container_found",
    "sidebar_scroll_top",
    "sidebar_scroll_height",
    "sidebar_client_height",
    "sidebar_can_scroll",
    "sidebar_at_bottom",
    "visible_project_rows",
    "project_section_found",
    "no_growth_count",
    "sidebar_scroll_complete",
    "target_tab_id",
    "tab_id",
    "window_id",
    "event_tab_id",
    "event_window_id",
    "tab_active",
    "tab_discarded",
    "tab_frozen",
    "tab_auto_discardable",
    "window_focused",
    "tab_status",
    "managed_tab_exists",
    "content_script_alive",
    "watcher_state",
    "assistant_state",
    "changed_state",
    "content_ready",
    "conversation_ready",
    "composer_ready",
    "watcher_ready"
  ]) {
    if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
    if (typeof fields[key] === "number" && Number.isSafeInteger(fields[key])) safe[key] = fields[key];
    if (typeof fields[key] === "boolean") safe[key] = fields[key];
  }
  try {
    console.info(`[ChatGPT Comfy Connector] ${eventName}`, safe);
  } catch (_) {
    // Console access must never affect the Bridge transport.
  }
}

function traceForMessage(message, fields = {}) {
  return {
    request_id: message?.request_id ?? message?.requestId,
    session_id: message?.session_id ?? message?.sessionId,
    handoff_id: message?.handoff_id ?? message?.handoffId,
    boundary_id: message?.boundary_id ?? message?.boundaryId,
    target_tab_id: message?.target_tab_id ?? message?.targetTabId,
    ...fields
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function managedTabStorage() {
  return chrome.storage.session || chrome.storage.local;
}

function managedTabTrace(fields = {}) {
  return {
    ...(managedTabState.tabId !== null ? { target_tab_id: managedTabState.tabId } : {}),
    ...(Number.isSafeInteger(managedTabState.executionWindowId)
      ? { execution_window_id: managedTabState.executionWindowId }
      : {}),
    ...(typeof managedTabState.executionWindowState === "string"
      ? { execution_window_state: managedTabState.executionWindowState }
      : {}),
    ...(managedTabState.conversationId ? { conversation_id: managedTabState.conversationId } : {}),
    ...(managedTabState.conversationUrl ? { conversation_url: managedTabState.conversationUrl } : {}),
    ...fields
  };
}

function responseWatchForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
  const current = managedTabState.currentRequestId
    ? responseWatches.get(managedTabState.currentRequestId)
    : null;
  if (current?.tabId === tabId) return current;
  return [...responseWatches.values()].find((pending) => pending.tabId === tabId) || null;
}

function managedTabTelemetryIdentity(tabId) {
  const pending = responseWatchForTab(tabId);
  if (pending) {
    return {
      request_id: pending.requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId
    };
  }
  if (tabId === managedTabState.tabId) {
    return {
      request_id: managedTabState.currentRequestId,
      session_id: managedTabState.currentSessionId,
      handoff_id: managedTabState.currentHandoffId,
      boundary_id: managedTabState.currentBoundaryId
    };
  }
  return {};
}

async function readManagedTabLifecycleSnapshot(tabId, tabHint = null, fallbackWindowId = null) {
  const snapshot = {};
  if (Number.isSafeInteger(tabId) && tabId >= 0) {
    snapshot.tab_id = tabId;
    snapshot.target_tab_id = tabId;
  }

  let tab = tabHint;
  if (!tab && Number.isSafeInteger(tabId) && tabId >= 0 && typeof chrome.tabs?.get === "function") {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      tab = null;
    }
  }

  snapshot.managed_tab_exists = Boolean(tab);
  if (tab) {
    if (Number.isSafeInteger(tab.id)) {
      snapshot.tab_id = tab.id;
      snapshot.target_tab_id = tab.id;
    }
    if (Number.isSafeInteger(tab.windowId)) snapshot.window_id = tab.windowId;
    else if (Number.isSafeInteger(fallbackWindowId)) snapshot.window_id = fallbackWindowId;
    if (typeof tab.active === "boolean") snapshot.tab_active = tab.active;
    if (typeof tab.discarded === "boolean") snapshot.tab_discarded = tab.discarded;
    if (typeof tab.frozen === "boolean") snapshot.tab_frozen = tab.frozen;
    if (typeof tab.autoDiscardable === "boolean") snapshot.tab_auto_discardable = tab.autoDiscardable;
    if (typeof tab.status === "string") snapshot.tab_status = tab.status;
  } else if (Number.isSafeInteger(fallbackWindowId)) {
    snapshot.window_id = fallbackWindowId;
  }

  const isManagedTelemetryTarget = tabId === null || tabId === managedTabState.tabId;
  const executionWindowId = isManagedTelemetryTarget && Number.isSafeInteger(managedTabState.executionWindowId)
    ? managedTabState.executionWindowId
    : (isManagedTelemetryTarget && Number.isSafeInteger(tab?.windowId) ? tab.windowId : null);
  if (Number.isSafeInteger(executionWindowId)) {
    snapshot.execution_window_id = executionWindowId;
  }

  if (Number.isSafeInteger(snapshot.window_id) && typeof chrome.windows?.get === "function") {
    try {
      const window = await chrome.windows.get(snapshot.window_id);
      if (typeof window?.focused === "boolean") snapshot.window_focused = window.focused;
    } catch (_) {
      // Lifecycle telemetry must never affect the managed-tab transport.
    }
  }
  if (Number.isSafeInteger(executionWindowId) && typeof chrome.windows?.get === "function") {
    try {
      const executionWindow = await chrome.windows.get(executionWindowId);
      snapshot.execution_window_exists = true;
      if (typeof executionWindow?.focused === "boolean") {
        snapshot.execution_window_focused = executionWindow.focused;
      }
      if (typeof executionWindow?.state === "string") {
        snapshot.execution_window_state = executionWindow.state;
        snapshot.execution_window_minimized = executionWindow.state === "minimized";
      }
    } catch (_) {
      snapshot.execution_window_exists = false;
      snapshot.execution_window_state = "missing";
      snapshot.execution_window_minimized = false;
    }
  }
  if (Number.isSafeInteger(executionWindowId) && snapshot.execution_window_exists === undefined) {
    snapshot.execution_window_exists = false;
    snapshot.execution_window_state = "unknown";
  }
  return snapshot;
}

function recordManagedTabLifecycleTelemetry(stage, fields = {}, tabId = managedTabState.tabId, tabHint = null, fallbackWindowId = null) {
  const resolvedTabId = Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
  const pending = responseWatchForTab(resolvedTabId);
  const contentScriptAlive = resolvedTabId !== null
    && (contentScriptReadyTabs.has(resolvedTabId)
      || (resolvedTabId === managedTabState.tabId && managedTabState.contentReady === true));
  const base = {
    ...managedTabTelemetryIdentity(resolvedTabId),
    ...(resolvedTabId !== null ? { tab_id: resolvedTabId, target_tab_id: resolvedTabId } : {}),
    lifecycle: managedTabState.lifecycle,
    content_script_alive: contentScriptAlive,
    watcher_state: pending
      ? (pending.watcherReady ? "armed" : "requested")
      : (resolvedTabId === managedTabState.tabId && managedTabState.watcherReady ? "armed" : "idle"),
    ...fields,
    stage
  };

  void readManagedTabLifecycleSnapshot(resolvedTabId, tabHint, fallbackWindowId).then((snapshot) => {
    const telemetry = { ...base, ...snapshot, stage };
    const previous = resolvedTabId === null
      ? null
      : managedTabTelemetrySnapshots.get(resolvedTabId);
    const changedStates = [];
    for (const key of [
      "tab_discarded",
      "tab_frozen",
      "tab_active",
      "window_focused",
      "execution_window_focused",
      "execution_window_state",
      "execution_window_exists"
    ]) {
      if (previous
        && previous[key] !== undefined
        && telemetry[key] !== undefined
        && previous[key] !== telemetry[key]) {
        changedStates.push(key);
      }
    }
    if (previous
      && typeof previous.managed_tab_exists === "boolean"
      && previous.managed_tab_exists !== telemetry.managed_tab_exists) {
      changedStates.push("managed_tab_exists");
    }

    diagnostic("managed tab lifecycle telemetry", telemetry);
    if (changedStates.length > 0) {
      diagnostic("managed tab lifecycle state changed", {
        ...telemetry,
        status: "changed",
        stage: "managed_tab_state_changed",
        changed_state: changedStates.join(",")
      });
    }
    if (resolvedTabId !== null) managedTabTelemetrySnapshots.set(resolvedTabId, telemetry);
  }).catch(() => {
    diagnostic("managed tab lifecycle telemetry", {
      ...base,
      managed_tab_exists: false,
      status: "unknown",
      stage
    });
  });
}

function managedTabLifecycle(lifecycle, fields = {}) {
  managedTabState = {
    ...managedTabState,
    lifecycle,
    ...fields
  };
  void managedTabStorage().set({
    [MANAGED_TAB_STORAGE_KEY]: {
      tabId: managedTabState.tabId,
      executionWindowId: managedTabState.executionWindowId,
      executionWindowState: managedTabState.executionWindowState,
      conversationId: managedTabState.conversationId,
      conversationUrl: managedTabState.conversationUrl,
      projectId: managedTabState.projectId,
      projectUrl: managedTabState.projectUrl,
      lifecycle: managedTabState.lifecycle,
      contentReady: managedTabState.contentReady,
      conversationReady: managedTabState.conversationReady,
      composerReady: managedTabState.composerReady,
      watcherReady: managedTabState.watcherReady,
      currentRequestId: managedTabState.currentRequestId,
      currentSessionId: managedTabState.currentSessionId,
      currentHandoffId: managedTabState.currentHandoffId,
      currentBoundaryId: managedTabState.currentBoundaryId
    }
  }).catch(() => {});
  diagnostic("managed tab lifecycle", managedTabTrace({
    lifecycle,
    content_ready: managedTabState.contentReady,
    conversation_ready: managedTabState.conversationReady,
    composer_ready: managedTabState.composerReady,
    watcher_ready: managedTabState.watcherReady,
    ...fields
  }));
}

function clearManagedTabState(lifecycle = "Failed", options = {}) {
  // The tab is only an execution medium. Preserve the bound Conversation so
  // a later operation can recreate the active tab at the same destination.
  managedTabLifecycle(lifecycle, {
    tabId: null,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false,
    ...(options.clearExecutionWindow === true
      ? { executionWindowId: null, executionWindowState: "Idle" }
      : {})
  });
}

function managedTabError(code, stage, message) {
  const error = bridgeError(message, 0, code);
  error.stage = stage;
  return error;
}

function withManagedTabOperation(operation) {
  const next = managedTabStateOperation.then(operation, operation);
  managedTabStateOperation = next.catch(() => {});
  return next;
}

function withCollectorWindowOperation(operation) {
  const next = collectorWindowStateOperation.then(operation, operation);
  collectorWindowStateOperation = next.catch(() => {});
  return next;
}

function isCurrentCollectorRequest(pending) {
  return Number.isSafeInteger(pending?.generation)
    && pending.generation === collectorContextGeneration;
}

function throwIfCollectorRequestSuperseded(pending) {
  if (isCurrentCollectorRequest(pending)) return;
  throw bridgeError(
    "ChatGPT Contextの古いRefresh結果は破棄されました。",
    0,
    "context_refresh_superseded");
}

function createProjectDiscoveryState(pending) {
  projectDiscoverySequence += 1;
  const refreshGeneration = Number.isSafeInteger(pending?.generation)
    ? pending.generation
    : 0;
  return {
    refreshGeneration,
    runId: `refresh-${refreshGeneration}-project-${projectDiscoverySequence}`,
    callCount: 0,
    started: false,
    completed: false,
    scanCompleted: false,
    caller: null,
    inFlight: false,
    alreadyCompleted: false,
    scrollDirection: null,
    restoreCount: 0,
    result: null,
    promise: null
  };
}

function projectDiscoveryStateFor(pending) {
  if (!pending || typeof pending !== "object") return createProjectDiscoveryState(null);
  if (!pending.projectDiscovery) pending.projectDiscovery = createProjectDiscoveryState(pending);
  return pending.projectDiscovery;
}

function syncProjectDiscoveryTelemetry(pending, discovery) {
  if (!discovery || (pending && !isCurrentCollectorRequest(pending))) return;
  collectorWindowState = {
    ...collectorWindowState,
    refreshGeneration: discovery.refreshGeneration,
    projectDiscoveryRunId: discovery.runId,
    projectDiscoveryCallCount: discovery.callCount,
    projectDiscoveryStarted: discovery.started,
    projectDiscoveryCompleted: discovery.completed,
    projectDiscoveryScanCompleted: discovery.scanCompleted,
    projectDiscoveryCaller: discovery.caller,
    projectDiscoveryInFlight: discovery.inFlight,
    projectDiscoveryAlreadyCompleted: discovery.alreadyCompleted,
    projectDiscoveryScrollDirection: discovery.scrollDirection,
    projectDiscoveryRestoreCount: discovery.restoreCount
  };
}

function recordProjectDiscoveryTelemetry(eventName, pending, fields = {}) {
  const discovery = projectDiscoveryStateFor(pending);
  syncProjectDiscoveryTelemetry(pending, discovery);
  diagnostic(eventName, {
    request_id: pending?.requestId,
    refresh_generation: discovery.refreshGeneration,
    project_discovery_run_id: discovery.runId,
    project_discovery_call_count: discovery.callCount,
    project_discovery_started: discovery.started,
    project_discovery_completed: discovery.completed,
    project_discovery_scan_completed: discovery.scanCompleted,
    project_discovery_caller: discovery.caller,
    project_discovery_in_flight: discovery.inFlight,
    project_discovery_already_completed: discovery.alreadyCompleted,
    project_discovery_scroll_direction: discovery.scrollDirection,
    project_discovery_restore_count: discovery.restoreCount,
    ...fields
  });
}

function projectDiscoveryTraceFields(pending) {
  const discovery = pending?.projectDiscovery;
  if (!discovery) return {};
  return {
    refresh_generation: discovery.refreshGeneration,
    project_discovery_run_id: discovery.runId,
    project_discovery_call_count: discovery.callCount,
    project_discovery_started: discovery.started === true,
    project_discovery_completed: discovery.completed === true,
    project_discovery_scan_completed: discovery.scanCompleted === true,
    project_discovery_caller: discovery.caller,
    project_discovery_in_flight: discovery.inFlight === true,
    project_discovery_already_completed: discovery.alreadyCompleted === true,
    project_discovery_scroll_direction: discovery.scrollDirection,
    project_discovery_restore_count: discovery.restoreCount
  };
}

function markCollectorRequestMediumLost(tabId, windowId, reason) {
  for (const pending of contextRequests.values()) {
    if (!pending) continue;
    const sameTab = Number.isSafeInteger(tabId) && pending.tabId === tabId;
    const sameWindow = Number.isSafeInteger(windowId)
      && pending.collectorWindowId === windowId;
    if (!sameTab && !sameWindow) continue;
    pending.collectorMediumLost = true;
    pending.collectorMediumLossReason = reason || "collector_medium_lost";
    diagnostic("collector request medium lost", {
      request_id: pending.requestId,
      target_tab_id: tabId,
      event_window_id: windowId,
      status: "recoverable",
      error_code: pending.collectorMediumLossReason,
      stage: "collector_request_medium_lost"
    });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function createPendingHandoffSend(message, bridgeSocket, targetTab) {
  const operation = {
    requestId: message?.request_id,
    sessionId: message?.session_id,
    handoffId: message?.handoff_id,
    boundaryId: message?.boundary_id,
    handoffKind: message?.handoff_kind || null,
    bridgeSocket,
    targetTabId: targetTab?.id,
    targetTabUrl: typeof targetTab?.url === "string" ? targetTab.url : null,
    targetConversationId: safeContextIdentifier(message?.target_conversation_id),
    targetConversationUrl: safeChatGptContextUrl(message?.target_conversation_url),
    targetProjectId: safeContextIdentifier(message?.target_project_id),
    confirmation: deferred(),
    confirmed: false,
    recoveryInProgress: false,
    recoveryTimer: null,
    recoveryDeadline: Date.now() + HANDOFF_ACCEPTANCE_RETRY_TIMEOUT_MS
  };
  pendingHandoffSends.set(operation.requestId, operation);
  return operation;
}

function handoffMessageForPending(operation) {
  return {
    request_id: operation.requestId,
    session_id: operation.sessionId,
    handoff_id: operation.handoffId,
    boundary_id: operation.boundaryId,
    handoff_kind: operation.handoffKind
  };
}

function handoffAcceptanceCheckMessageForPending(operation) {
  return {
    type: HANDOFF_ACCEPTANCE_CHECK_MESSAGE_TYPE,
    requestId: operation.requestId,
    sessionId: operation.sessionId,
    handoffId: operation.handoffId,
    boundaryId: operation.boundaryId,
    protocol: HANDOFF_PROTOCOL,
    targetTabId: operation.targetTabId,
    ...(operation.handoffKind === "review" ? { review: true } : {})
  };
}

function resolvePendingHandoffConfirmation(pending, message, targetTabId, stage = "user_message_correlated") {
  if (pending.confirmed) return;
  pending.confirmed = true;
  if (pending.recoveryTimer !== null) {
    clearTimeout(pending.recoveryTimer);
    pending.recoveryTimer = null;
  }
  diagnostic("handoff confirmation received", {
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    status: "sent",
    stage,
    target_tab_id: targetTabId
  });
  const currentContext = normalizeCurrentContext(message?.current_context || message?.currentContext);
  if (currentContext?.conversation_id) pending.targetConversationId = currentContext.conversation_id;
  if (currentContext?.url) pending.targetConversationUrl = currentContext.url;
  if (currentContext?.project_id) pending.targetProjectId = currentContext.project_id;
  pending.confirmation.resolve({
    stage,
    current_context: currentContext
  });
}

function schedulePendingHandoffAcceptanceRecovery(pending) {
  if (!pending
    || pending.confirmed
    || pending.recoveryTimer !== null
    || pending.recoveryDeadline <= Date.now()) return;
  pending.recoveryTimer = setTimeout(() => {
    pending.recoveryTimer = null;
    if (pendingHandoffSends.get(pending.requestId) !== pending || pending.confirmed) return;
    void recoverPendingHandoffSendsForTab(pending.targetTabId);
  }, HANDOFF_ACCEPTANCE_RETRY_DELAY_MS);
}

async function handleHandoffSendConfirmedFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const sessionId = message?.sessionId || message?.session_id;
  const handoffId = message?.handoffId || message?.handoff_id;
  const boundaryId = message?.boundaryId || message?.boundary_id;
  const pending = pendingHandoffSends.get(requestId);
  const senderTabId = sender?.tab?.id;
  if (!pending
    || senderTabId !== pending.targetTabId
    || sessionId !== pending.sessionId
    || handoffId !== pending.handoffId
    || boundaryId !== pending.boundaryId
    || message?.status !== "sent") {
    diagnostic("handoff confirmation rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "handoff_confirmation_not_correlated",
      stage: "handoff_confirmation_context",
      target_tab_id: senderTabId
    });
    return { ok: false, error: "handoff_confirmation_not_correlated" };
  }

  resolvePendingHandoffConfirmation(
    pending,
    message,
    senderTabId,
    typeof message.stage === "string" ? message.stage : "user_message_correlated");
  return { ok: true };
}

async function recoverPendingHandoffSendsForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return;
  const pendingSends = [...pendingHandoffSends.values()]
    .filter((pending) => pending.targetTabId === tabId
      && !pending.confirmed
      && !pending.recoveryInProgress
      && pending.recoveryDeadline > Date.now());
  for (const pending of pendingSends) {
    if (pendingHandoffSends.get(pending.requestId) !== pending) continue;
    pending.recoveryInProgress = true;
    diagnostic("handoff acceptance check requested", {
      request_id: pending.requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId,
      status: "requested",
      stage: "handoff_acceptance_check_requested",
      target_tab_id: tabId
    });
    try {
      const checkResult = await dispatchToContentScript(
        tabId,
        handoffAcceptanceCheckMessageForPending(pending),
        handoffMessageForPending(pending));
      if (checkResult?.status === "sent"
        && checkResult.request_id === pending.requestId
        && checkResult.handoff_id === pending.handoffId) {
        resolvePendingHandoffConfirmation(pending, checkResult, tabId, "user_message_already_correlated");
        diagnostic("handoff acceptance recovered", {
          request_id: pending.requestId,
          session_id: pending.sessionId,
          handoff_id: pending.handoffId,
          boundary_id: pending.boundaryId,
          status: "sent",
          stage: "handoff_acceptance_recovered",
          target_tab_id: tabId
        });
      } else {
        diagnostic("handoff acceptance check pending", {
          request_id: pending.requestId,
          session_id: pending.sessionId,
          handoff_id: pending.handoffId,
          boundary_id: pending.boundaryId,
          status: "pending",
          error_code: checkResult?.error_code,
          stage: checkResult?.stage || "handoff_acceptance_not_found",
          target_tab_id: tabId
        });
        schedulePendingHandoffAcceptanceRecovery(pending);
      }
    } catch (error) {
      diagnostic("handoff acceptance check deferred", {
        request_id: pending.requestId,
        session_id: pending.sessionId,
        handoff_id: pending.handoffId,
        boundary_id: pending.boundaryId,
        status: "pending",
        error_code: isMissingContentScriptError(error) ? "content_script_unavailable" : "handoff_acceptance_check_failed",
        stage: error?.stage || "handoff_acceptance_check_dispatch",
        target_tab_id: tabId
      });
      schedulePendingHandoffAcceptanceRecovery(pending);
    } finally {
      pending.recoveryInProgress = false;
    }
  }
}

function handoffIdentityKey(message) {
  return [message?.session_id, message?.handoff_id, message?.boundary_id]
    .map((value) => String(value || ""))
    .join("|");
}

function getAcceptedHandoff(message) {
  const key = handoffIdentityKey(message);
  const accepted = acceptedHandoffs.get(key);
  if (!accepted) return null;
  if (accepted.expiresAt <= Date.now()) {
    acceptedHandoffs.delete(key);
    return null;
  }
  return accepted;
}

function rememberAcceptedHandoff(message, result) {
  acceptedHandoffs.set(handoffIdentityKey(message), {
    tabId: result.target_tab_id,
    targetTabUrl: result.target_tab_url || null,
    targetConversationId: result.target_conversation_id || message.target_conversation_id || null,
    targetConversationUrl: result.target_conversation_url || message.target_conversation_url || null,
    targetProjectId: result.target_project_id || message.target_project_id || null,
    expiresAt: Date.now() + HANDOFF_DELIVERY_CACHE_MS
  });
}

function forgetResponseWatchesForIdentity(message, exceptRequestId = null) {
  for (const [requestId, pending] of responseWatches) {
    if (requestId !== exceptRequestId
      && pending.sessionId === message?.session_id
      && pending.handoffId === message?.handoff_id
      && pending.boundaryId === message?.boundary_id) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      void dispatchToContentScript(
        pending.tabId,
        {
          type: "CANCEL_ASSISTANT_RESPONSE_WATCH",
          requestId: pending.requestId,
          sessionId: pending.sessionId,
          handoffId: pending.handoffId,
          boundaryId: pending.boundaryId
        },
        pending,
        { timeoutMs: 2000, timeoutStage: "response_watch_cancel" }).catch(() => {});
    }
  }
}

async function setState(patch) {
  state = { ...state, ...patch, bridgeUrl: BRIDGE_HTTP_ORIGIN };
  await chrome.storage.local.set({ bridgeState: state });
  notifyExtensionPages();
  return state;
}

function notifyExtensionPages() {
  try {
    chrome.runtime.sendMessage({ type: "BRIDGE_STATE_CHANGED", state }).catch(() => {});
  } catch (_) {
    // There may be no popup open. The state is persisted for the next popup.
  }

  // Content scripts never access localhost. They receive the same state from
  // the background service worker and can expose a future page-level hook.
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs.sendMessage(tab.id, { type: "BRIDGE_STATE_CHANGED", state }).catch(() => {});
    }
  }).catch(() => {});
}

async function readJsonResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }
  if (!response.ok) {
    const code = body?.error || `http_${response.status}`;
    throw bridgeError(`Desktop Bridge request failed (${response.status}).`, response.status, code);
  }
  return body;
}

async function fetchBridge(url, options) {
  try {
    return await fetch(url, options);
  } catch (_) {
    throw bridgeError("Desktop Connector is unavailable.", 0, "desktop_unavailable");
  }
}

async function fetchHealth() {
  const response = await fetchBridge(BRIDGE_HEALTH_URL, {
    method: "GET",
    credentials: "omit",
    cache: "no-store"
  });
  const health = await readJsonResponse(response);
  if (!health?.ok || health.protocol !== BRIDGE_PROTOCOL) {
    throw bridgeError("Desktop Bridge protocol is unavailable.", response.status, "invalid_protocol");
  }
  return health;
}

async function fetchPairing(pairingCode) {
  const response = await fetchBridge(BRIDGE_PAIR_URL, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
    },
    body: JSON.stringify({ pairing_code: pairingCode })
  });
  const result = await readJsonResponse(response);
  if (!result?.ok || result.protocol !== BRIDGE_PROTOCOL || !result.pairing_id || !result.pairing_credential) {
    throw bridgeError("Desktop Bridge pairing response is invalid.", response.status, "invalid_pairing_response");
  }
  return result;
}

async function fetchBootstrap(pairingCredential) {
  const response = await fetchBridge(BRIDGE_BOOTSTRAP_URL, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${pairingCredential}`,
      [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
    }
  });
  const result = await readJsonResponse(response);
  if (!result?.ok || result.protocol !== BRIDGE_PROTOCOL || !result.session_token) {
    throw bridgeError("Desktop Bridge session bootstrap is invalid.", response.status, "invalid_bootstrap_response");
  }
  return result;
}

async function storePairing(result) {
  pairing = {
    pairingId: result.pairing_id,
    credential: result.pairing_credential
  };
  await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: pairing });
  await setState({ paired: true, pairingId: pairing.pairingId, lastError: null });
}

async function clearPairing() {
  pairing = { pairingId: null, credential: null };
  sessionToken = null;
  await chrome.storage.local.remove(PAIRING_STORAGE_KEY);
  await setState({ paired: false, pairingId: null, sessionExpiresAt: null });
}

function closePendingPings(error) {
  for (const [id, pending] of pendingPings) {
    clearTimeout(pending.timeout);
    pending.reject(error);
    pendingPings.delete(id);
  }
}

function stopSocketKeepalive(bridgeSocket = null) {
  // An old socket can close after a replacement connection is already live.
  // It must not clear the replacement socket's keepalive timer.
  if (bridgeSocket !== null && socketKeepaliveSocket !== bridgeSocket) return;
  if (socketKeepaliveTimer !== null) clearInterval(socketKeepaliveTimer);
  socketKeepaliveTimer = null;
  socketKeepaliveSocket = null;
}

function startSocketKeepalive(bridgeSocket) {
  if (socket !== bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
  stopSocketKeepalive();
  socketKeepaliveSocket = bridgeSocket;
  socketKeepaliveTimer = setInterval(() => {
    if (socket !== bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      stopSocketKeepalive(bridgeSocket);
      return;
    }

    try {
      bridgeSocket.send(JSON.stringify({
        type: "ping",
        id: `keepalive-${crypto.randomUUID()}`
      }));
    } catch (_) {
      // The close handler will clear this timer and schedule the normal
      // reconnect path. Keepalive failures do not expose credentials or body.
      stopSocketKeepalive(bridgeSocket);
      try { bridgeSocket.close(); } catch (_) { }
    }
  }, SOCKET_KEEPALIVE_INTERVAL_MS);
}

function clearResponseWatchesForSocket(bridgeSocket, discard = false) {
  for (const [requestId, pending] of responseWatches) {
    if (pending.bridgeSocket !== bridgeSocket) continue;
    if (discard) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      continue;
    }
    // Keep the watcher alive across an automatic Bridge reconnect.  The
    // Content Script can still finish its observation, and the response will
    // be delivered through the next authenticated socket.
    pending.bridgeSocket = null;
    diagnostic("response watch bridge detached", {
      request_id: requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId,
      status: "pending",
      stage: "response_watch_bridge_detached",
      target_tab_id: pending.targetTabId
    });
  }
}

function detachBridgeOutboxForSocket(bridgeSocket) {
  for (const pending of bridgeOutbox.values()) {
    if (pending.sentSocket === bridgeSocket) pending.sentSocket = null;
  }
}

function clearContextRequestsForSocket(bridgeSocket) {
  for (const [requestId, pending] of contextRequests) {
    if (pending.bridgeSocket === bridgeSocket) contextRequests.delete(requestId);
  }
}

function isChatGptTab(tab) {
  try {
    const url = new URL(tab?.url || "");
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && url.port === "";
  } catch (_) {
    return false;
  }
}

function chatGptConversationKey(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch (_) {
    return null;
  }
}

function chatGptConversationId(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "c") continue;
      const id = decodeURIComponent(segments[index + 1]);
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : null;
    }
  } catch (_) { }
  return null;
}

function isSameChatGptConversation(actualUrl, expectedUrl, expectedConversationId = null) {
  if (expectedConversationId) {
    return chatGptConversationId(actualUrl) === expectedConversationId;
  }
  const actual = chatGptConversationKey(actualUrl);
  const expected = chatGptConversationKey(expectedUrl);
  return actual !== null && expected !== null && actual === expected;
}

function safeContextIdentifier(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text) ? text : null;
}

function safeChatGptContextUrl(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    const canonical = `${url.origin}${pathname}`;
    return canonical.length <= 2048 ? canonical : null;
  } catch (_) {
    return null;
  }
}

function normalizeCurrentContext(value) {
  if (!value || typeof value !== "object") return null;
  const conversationId = safeContextIdentifier(value.conversation_id || value.conversationId);
  const projectId = safeContextIdentifier(value.project_id || value.projectId);
  const url = safeChatGptContextUrl(value.url || value.conversation_url || value.conversationUrl);
  const title = typeof (value.title || value.current_title) === "string"
    ? String(value.title || value.current_title).trim().slice(0, 512)
    : "";
  const projectTitle = typeof (value.project_title || value.projectTitle) === "string"
    ? String(value.project_title || value.projectTitle).trim().slice(0, 512)
    : "";
  return {
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    ...(projectTitle ? { project_title: projectTitle } : {})
  };
}

function handoffResult(message, status, errorCode, text, stage, targetTab = null, currentContext = null) {
  const result = {
    type: "handoff.result",
    request_id: message?.request_id || "",
    handoff_id: message?.handoff_id || "",
    status
  };
  if (errorCode) result.error_code = errorCode;
  if (text) result.message = text;
  if (stage) result.stage = stage;
  if (status === "sent" && Number.isSafeInteger(targetTab?.id)) {
    result.target_tab_id = targetTab.id;
    if (typeof targetTab.url === "string" && targetTab.url.length <= 2048) result.target_tab_url = targetTab.url;
  }
  if (status === "sent") {
    const context = normalizeCurrentContext(currentContext);
    const requestedConversationId = safeContextIdentifier(message?.target_conversation_id);
    const requestedConversationUrl = safeChatGptContextUrl(message?.target_conversation_url);
    const requestedProjectId = safeContextIdentifier(message?.target_project_id);
    if (context?.conversation_id || requestedConversationId) {
      result.target_conversation_id = context?.conversation_id || requestedConversationId;
    }
    if (context?.url || requestedConversationUrl) {
      result.target_conversation_url = context?.url || requestedConversationUrl;
    }
    if (context?.project_id || requestedProjectId) {
      result.target_project_id = context?.project_id || requestedProjectId;
    }
  }
  return result;
}

function isMissingContentScriptError(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  return text.includes("Receiving end does not exist")
    || text.includes("Could not establish connection")
    || text.includes("Extension context invalidated")
    // When a page navigation destroys a content-script listener after it has
    // clicked Send, Chrome reports a closed message port rather than a missing
    // receiver. Treat that as a lifecycle transition so dispatch can wait for
    // the replacement script and retry the same correlated operation.
    || text.includes("The message port closed before a response was received")
    || text.includes("the message channel closed before a response was received")
    || text.includes("message channel closed");
}

function sendMessageWithTimeout(
  tabId,
  message,
  timeoutMs = CONTENT_SCRIPT_TIMEOUT_MS,
  timeoutStage = "content_script_timeout") {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      const timeoutError = bridgeError("ChatGPT Content Script did not respond.", 0, "send_failed");
      timeoutError.stage = timeoutStage;
      finish(reject, timeoutError);
    }, timeoutMs);

    try {
      Promise.resolve(chrome.tabs.sendMessage(tabId, message))
        .then((value) => finish(resolve, value))
        .catch((error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }
  });
}

function waitForTabReady(tabId, timeoutMs = CONTENT_SCRIPT_READY_TIMEOUT_MS) {
  if (!chrome.tabs?.get) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      chrome.tabs.onUpdated?.removeListener?.(handleUpdated);
    };
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ready);
    };
    const inspect = async () => {
      if (settled) return;
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (_) {
        finish(false);
        return;
      }
      if (!tab) {
        finish(false);
        return;
      }
      // Test doubles and some Chromium implementations omit status.  In
      // that case the tab is already usable for the dispatch retry.  When
      // status is present, wait until the navigation is complete.
      if (typeof tab.status !== "string" || tab.status === "complete") {
        finish(true);
        return;
      }
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      pollTimer = setTimeout(inspect, CONTENT_SCRIPT_READY_POLL_INTERVAL_MS);
    };
    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo?.status !== "complete") return;
      void inspect();
    };
    const deadline = Date.now() + timeoutMs;

    chrome.tabs.onUpdated?.addListener?.(handleUpdated);
    timeoutTimer = setTimeout(() => finish(false), timeoutMs);
    void inspect();
  });
}

function collectorWindowStorage() {
  return chrome.storage.session || chrome.storage.local;
}

function persistCollectorWindowState() {
  const stored = {
    windowId: collectorWindowState.windowId,
    tabId: collectorWindowState.tabId,
    windowState: collectorWindowState.windowState,
    lifecycle: collectorWindowState.lifecycle
  };
  return collectorWindowStorage().set({ [COLLECTOR_WINDOW_STORAGE_KEY]: stored }).catch(() => {});
}

function collectorWindowLifecycle(lifecycle, fields = {}) {
  collectorWindowState = {
    ...collectorWindowState,
    lifecycle,
    ...fields
  };
  void persistCollectorWindowState();
  diagnostic("collector window lifecycle", {
    lifecycle,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    project_discovery_source: collectorWindowState.projectDiscoverySource,
    current_project_id: collectorWindowState.currentProjectId,
    current_project_url: collectorWindowState.currentProjectUrl,
    collector_navigation_target: collectorWindowState.collectorNavigationTarget,
    project_index: collectorWindowState.projectIndex,
    total_projects: collectorWindowState.totalProjects,
    discovered_project_count: collectorWindowState.discoveredProjectCount,
    discovered_chat_count: collectorWindowState.discoveredChatCount,
    retry_count: collectorWindowState.retryCount,
    project_discovery_retry_count: collectorWindowState.projectDiscoveryRetryCount,
    refresh_generation: collectorWindowState.refreshGeneration,
    project_discovery_run_id: collectorWindowState.projectDiscoveryRunId,
    project_discovery_call_count: collectorWindowState.projectDiscoveryCallCount,
    project_discovery_started: collectorWindowState.projectDiscoveryStarted,
    project_discovery_completed: collectorWindowState.projectDiscoveryCompleted,
    project_discovery_scan_completed: collectorWindowState.projectDiscoveryScanCompleted,
    project_discovery_caller: collectorWindowState.projectDiscoveryCaller,
    project_discovery_in_flight: collectorWindowState.projectDiscoveryInFlight,
    project_discovery_already_completed: collectorWindowState.projectDiscoveryAlreadyCompleted,
    project_discovery_scroll_direction: collectorWindowState.projectDiscoveryScrollDirection,
    project_discovery_restore_count: collectorWindowState.projectDiscoveryRestoreCount,
    project_identity_resolution_started: collectorWindowState.projectIdentityResolutionStarted,
    project_identity_resolution_completed: collectorWindowState.projectIdentityResolutionCompleted,
    non_navigation_resolved_count: collectorWindowState.nonNavigationResolvedCount,
    navigation_resolved_count: collectorWindowState.navigationResolvedCount,
    unresolved_count: collectorWindowState.identityUnresolvedCount,
    current_project_index: collectorWindowState.currentProjectIndex,
    resolution_method: collectorWindowState.identityResolutionMethod,
    navigation_target_verified: collectorWindowState.navigationTargetVerified,
    project_url_pattern_valid: collectorWindowState.projectUrlPatternValid,
    project_id_url_match: collectorWindowState.projectIdUrlMatch,
    collector_window_width: collectorWindowState.windowWidth,
    collector_window_height: collectorWindowState.windowHeight,
    collector_content_inner_width: collectorWindowState.contentInnerWidth,
    collector_content_inner_height: collectorWindowState.contentInnerHeight,
    sidebar_expected_visible: collectorWindowState.sidebarExpectedVisible,
    viewport_retry_count: collectorWindowState.viewportRetryCount,
    active_tab_id_in_collector_window: collectorWindowState.activeTabIdInWindow,
    collector_tab_active: collectorWindowState.collectorTabActive,
    tab_count_in_collector_window: collectorWindowState.tabCountInWindow,
    sidebar_scroll_top: collectorWindowState.sidebarScrollTop,
    sidebar_scroll_height: collectorWindowState.sidebarScrollHeight,
    sidebar_client_height: collectorWindowState.sidebarClientHeight,
    sidebar_can_scroll: collectorWindowState.sidebarCanScroll,
    sidebar_at_bottom: collectorWindowState.sidebarAtBottom,
    visible_project_rows: collectorWindowState.visibleProjectRows,
    project_section_found: collectorWindowState.projectSectionFound,
    no_growth_count: collectorWindowState.noGrowthCount,
    status: lifecycle === "Failed" ? "error" : "pending",
    stage: `collector_window_${String(lifecycle || "unknown").toLowerCase()}`,
    target_tab_id: collectorWindowState.tabId,
    window_id: collectorWindowState.windowId
  });
}

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isSafeInteger(dimension) && dimension > 0 ? dimension : null;
}

function collectorTabTopology(tabs, collectorTab) {
  const members = Array.isArray(tabs) ? tabs : [];
  const activeTab = members.find((tab) => tab?.active === true) || null;
  const activeTabId = Number.isSafeInteger(activeTab?.id) ? activeTab.id : null;
  const collectorTabId = Number.isSafeInteger(collectorTab?.id) ? collectorTab.id : null;
  return {
    activeTabId,
    collectorTabId,
    collectorTabActive: collectorTabId !== null
      && activeTabId === collectorTabId
      && collectorTab?.active === true,
    tabCount: members.length
  };
}

function recordCollectorTabTopology(windowId, tabs, collectorTab, trace = {}) {
  const topology = collectorTabTopology(tabs, collectorTab);
  collectorWindowState = {
    ...collectorWindowState,
    windowId: Number.isSafeInteger(windowId) ? windowId : collectorWindowState.windowId,
    tabId: topology.collectorTabId,
    activeTabIdInWindow: topology.activeTabId,
    collectorTabActive: topology.collectorTabActive,
    tabCountInWindow: topology.tabCount
  };
  const valid = topology.tabCount === 1 && topology.collectorTabActive;
  diagnostic("collector tab topology observed", {
    ...trace,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: topology.collectorTabId,
    active_tab_id_in_collector_window: topology.activeTabId,
    collector_tab_active: topology.collectorTabActive,
    tab_count_in_collector_window: topology.tabCount,
    collector_window_exists: Number.isSafeInteger(collectorWindowState.windowId),
    status: valid ? "observed" : "error",
    error_code: valid ? undefined : "collector_tab_topology_invalid",
    stage: "collector_tab_topology"
  });
  void persistCollectorWindowState();
  return valid;
}

function chooseCollectorTab(tabs, preferredTabId = null) {
  const members = Array.isArray(tabs) ? tabs : [];
  return members.find((tab) => tab?.id === preferredTabId)
    || members.find((tab) => tab?.active === true && isChatGptTab(tab))
    || members.find((tab) => isChatGptTab(tab))
    || members.find((tab) => tab?.active === true)
    || members[0]
    || null;
}

async function reconcileCollectorWindowTabs(windowId, preferredTabId = null, trace = {}) {
  let tabs = await tabsInCollectorWindow(windowId);
  let collectorTab = chooseCollectorTab(tabs, preferredTabId);
  recordCollectorTabTopology(windowId, tabs, collectorTab, trace);

  if (tabs.length > 1) {
    diagnostic("collector tab count invalid", {
      ...trace,
      collector_window_id: windowId,
      collector_tab_id: collectorTab?.id,
      active_tab_id_in_collector_window: collectorTabTopology(tabs, collectorTab).activeTabId,
      collector_tab_active: collectorTab?.active === true,
      tab_count_in_collector_window: tabs.length,
      status: "recovering",
      error_code: "collector_tab_count_invalid",
      stage: "collector_tab_reconcile"
    });
    if (typeof chrome.tabs?.remove !== "function") {
      throw bridgeError(
        "Collector Window内のTab数を1つに修復できません。",
        0,
        "collector_tab_count_invalid");
    }
    if (!collectorTab || !Number.isSafeInteger(collectorTab.id)) {
      throw bridgeError(
        "Collector Tabを決定できません。",
        0,
        "collector_tab_count_invalid");
    }
    collectorWindowState = {
      ...collectorWindowState,
      windowId,
      tabId: collectorTab.id
    };
    for (const extra of tabs.filter((tab) => tab?.id !== collectorTab.id)) {
      if (!Number.isSafeInteger(extra?.id)) continue;
      try {
        await chrome.tabs.remove(extra.id);
      } catch (_) {
        // A concurrent close is harmless; the post-reconcile query below is
        // the authority for whether the Window is actually back to one Tab.
      }
    }
    tabs = await tabsInCollectorWindow(windowId);
    collectorTab = chooseCollectorTab(tabs, collectorTab.id);
    recordCollectorTabTopology(windowId, tabs, collectorTab, {
      ...trace,
      stage: "collector_tab_reconciled"
    });
    if (tabs.length !== 1 || !collectorTab) {
      throw bridgeError(
        "Collector Window内のTab数を1つに修復できません。",
        0,
        "collector_tab_count_invalid");
    }
  }

  collectorWindowState = {
    ...collectorWindowState,
    windowId,
    tabId: collectorTab?.id ?? null
  };
  return collectorTab;
}

function queueCollectorTabTopologyRepair(trace = {}) {
  if (!Number.isSafeInteger(collectorWindowState.windowId)) return Promise.resolve(null);
  return withCollectorWindowOperation(async () => {
    const window = await getCollectorWindow();
    if (!window) return null;
    const tab = await reconcileCollectorWindowTabs(
      window.id,
      collectorWindowState.tabId,
      trace);
    if (!tab) {
      const tabs = await tabsInCollectorWindow(window.id);
      if (tabs.length === 0) {
        return await ensureCollectorWindow(COLLECTOR_TAB_URL, {
          ...trace,
          stage: "collector_tab_topology_recreate"
        });
      }
      return null;
    }
    if (collectorTabNeedsRecovery(tab)) {
      await replaceCollectorTab(tab, trace);
      return await ensureCollectorWindow(COLLECTOR_TAB_URL, {
        ...trace,
        stage: "collector_tab_topology_recovery"
      });
    }
    const enforced = await enforceCollectorTab(tab, trace);
    recordCollectorTabTopology(
      window.id,
      await tabsInCollectorWindow(window.id),
      enforced,
      trace);
    return enforced;
  }).catch((error) => {
    diagnostic("collector tab topology repair failed", {
      ...trace,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      status: "error",
      error_code: error?.code || "collector_tab_topology_repair_failed",
      stage: error?.stage || "collector_tab_topology_repair"
    });
    return null;
  });
}

function recordCollectorViewportTelemetry(window, viewport, viewportRetryCount, trace = {}) {
  const windowWidth = positiveDimension(window?.width);
  const windowHeight = positiveDimension(window?.height);
  const contentInnerWidth = positiveDimension(viewport?.content_inner_width);
  const contentInnerHeight = positiveDimension(viewport?.content_inner_height);
  const sidebarExpectedVisible = viewport?.sidebar_expected_visible === true
    && contentInnerWidth !== null
    && contentInnerWidth >= COLLECTOR_CONTENT_MIN_WIDTH;
  collectorWindowState = {
    ...collectorWindowState,
    windowWidth,
    windowHeight,
    contentInnerWidth,
    contentInnerHeight,
    sidebarExpectedVisible,
    viewportRetryCount: Math.max(0, Number.isSafeInteger(viewportRetryCount) ? viewportRetryCount : 0)
  };
  diagnostic("collector viewport observed", {
    ...trace,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    collector_window_width: windowWidth,
    collector_window_height: windowHeight,
    collector_content_inner_width: contentInnerWidth,
    collector_content_inner_height: contentInnerHeight,
    sidebar_expected_visible: sidebarExpectedVisible,
    viewport_retry_count: collectorWindowState.viewportRetryCount,
    sidebar_container_exists: viewport?.sidebar_container_exists === true,
    project_section_exists: viewport?.project_section_exists === true,
    project_row_locator_ready: viewport?.project_row_locator_ready === true,
    desktop_layout: viewport?.desktop_layout === true,
    sidebar_ready: viewport?.sidebar_ready === true,
    sidebar_scroll_container_found: viewport?.sidebar_scroll_container_found === true,
    status: "observed",
    stage: "collector_viewport_observed",
    target_tab_id: collectorWindowState.tabId,
    window_id: collectorWindowState.windowId
  });
  void persistCollectorWindowState();
}

function recordCollectorScrollTelemetry(source, pending = null, trace = {}) {
  const integerOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const targetTabId = Number.isSafeInteger(pending?.tabId)
    ? pending.tabId
    : collectorWindowState.tabId;
  const sidebarScrollTop = integerOrNull(source?.sidebar_scroll_top);
  const sidebarScrollHeight = integerOrNull(source?.sidebar_scroll_height);
  const sidebarClientHeight = integerOrNull(source?.sidebar_client_height);
  const visibleProjectRows = integerOrNull(source?.visible_project_rows) || 0;
  const contentDiscoveredProjectCount = integerOrNull(source?.discovered_project_count);
  // The response array is the Background's source of truth.  The content
  // script's count is retained separately as a diagnostic so a stale or
  // differently-shaped response cannot make the two layers appear to agree.
  const discoveredProjectCount = Array.isArray(source?.projects)
    ? source.projects.length
    : contentDiscoveredProjectCount;
  const noGrowthCount = integerOrNull(source?.no_growth_count) || 0;
  const restoreCount = integerOrNull(source?.sidebar_restore_count);
  const scrollDirection = source?.sidebar_scroll_direction === "down"
    || source?.sidebar_scroll_direction === "none"
    ? source.sidebar_scroll_direction
    : null;
  collectorWindowState = {
    ...collectorWindowState,
    projectDiscoverySource: typeof source?.project_discovery_source === "string"
      && source.project_discovery_source.trim().length > 0
      ? source.project_discovery_source.trim().slice(0, 128)
      : collectorWindowState.projectDiscoverySource,
    sidebarScrollTop,
    sidebarScrollHeight,
    sidebarClientHeight,
    sidebarCanScroll: source?.sidebar_can_scroll === true,
    sidebarAtBottom: source?.sidebar_at_bottom === true,
    visibleProjectRows,
    discoveredProjectCount: discoveredProjectCount === null
      ? collectorWindowState.discoveredProjectCount
      : discoveredProjectCount,
    projectSectionFound: source?.project_section_found === true,
    noGrowthCount,
    ...(restoreCount === null ? {} : { projectDiscoveryRestoreCount: restoreCount }),
    ...(scrollDirection ? { projectDiscoveryScrollDirection: scrollDirection } : {})
  };
  if (pending?.projectDiscovery) {
    if (scrollDirection) pending.projectDiscovery.scrollDirection = scrollDirection;
    if (restoreCount !== null) pending.projectDiscovery.restoreCount = restoreCount;
    syncProjectDiscoveryTelemetry(pending, pending.projectDiscovery);
  }
  diagnostic("collector sidebar scroll observed", {
    ...trace,
    request_id: pending?.requestId || trace.request_id,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: targetTabId,
    project_discovery_source: collectorWindowState.projectDiscoverySource,
    sidebar_scroll_top: sidebarScrollTop,
    sidebar_scroll_height: sidebarScrollHeight,
    sidebar_client_height: sidebarClientHeight,
    sidebar_can_scroll: source?.sidebar_can_scroll === true,
    sidebar_at_bottom: source?.sidebar_at_bottom === true,
    visible_project_rows: visibleProjectRows,
    discovered_project_count: collectorWindowState.discoveredProjectCount,
    content_discovered_project_count: contentDiscoveredProjectCount,
    project_section_found: source?.project_section_found === true,
    no_growth_count: noGrowthCount,
    project_discovery_scroll_direction: scrollDirection,
    project_discovery_restore_count: restoreCount,
    sidebar_scroll_complete: source?.sidebar_scroll_complete === true,
    status: "observed",
    stage: trace.stage || "collector_sidebar_scroll_observed",
    target_tab_id: targetTabId
  });
  void persistCollectorWindowState();
}

function collectorProjectDiscoveryResultShape(source) {
  const hasProjectsArray = Array.isArray(source?.projects);
  const hasConversationsArray = Array.isArray(source?.conversations);
  const contentDiscoveredProjectCount = Number.isSafeInteger(source?.discovered_project_count)
    && source.discovered_project_count >= 0
    ? source.discovered_project_count
    : null;
  const backgroundProjectsLength = hasProjectsArray ? source.projects.length : 0;
  let responseShape = "invalid";
  if (hasProjectsArray && hasConversationsArray) responseShape = "top_level_arrays";
  else if (hasProjectsArray) responseShape = "top_level_projects_only";
  else if (source?.context && typeof source.context === "object"
    && Array.isArray(source.context.projects)) responseShape = "nested_context_projects";
  else if (source?.result && typeof source.result === "object"
    && Array.isArray(source.result.projects)) responseShape = "nested_result_projects";

  return {
    hasProjectsArray,
    hasConversationsArray,
    contentDiscoveredProjectCount,
    backgroundProjectsLength,
    responseShape,
    countMismatch: contentDiscoveredProjectCount !== null
      && contentDiscoveredProjectCount !== backgroundProjectsLength
  };
}

function recordCollectorProjectDiscoveryResult(source, pending) {
  const shape = collectorProjectDiscoveryResultShape(source);
  if (pending && typeof pending === "object") {
    pending.collectorProjectDiscoveryResultShape = shape;
  }
  const base = {
    project_discovery_result_received: true,
    discovered_project_count: shape.backgroundProjectsLength,
    background_projects_length: shape.backgroundProjectsLength,
    response_shape: shape.responseShape,
    target_tab_id: pending?.tabId
  };
  if (shape.contentDiscoveredProjectCount !== null) {
    base.content_discovered_project_count = shape.contentDiscoveredProjectCount;
  }
  recordProjectDiscoveryTelemetry("collector project discovery result received", pending, {
    ...base,
    status: shape.hasProjectsArray && shape.hasConversationsArray ? "received" : "error",
    error_code: shape.hasProjectsArray && shape.hasConversationsArray
      ? undefined
      : "collector_project_result_shape_mismatch",
    stage: "collector_project_result_received"
  });
  if (shape.countMismatch) {
    diagnostic("collector project result handoff mismatch", {
      request_id: pending?.requestId,
      refresh_generation: pending?.projectDiscovery?.refreshGeneration,
      project_discovery_run_id: pending?.projectDiscovery?.runId,
      project_discovery_call_count: pending?.projectDiscovery?.callCount,
      project_discovery_started: pending?.projectDiscovery?.started === true,
      project_discovery_completed: pending?.projectDiscovery?.completed === true,
      ...base,
      status: "error",
      error_code: "collector_project_result_handoff_mismatch",
      stage: "collector_project_result_handoff"
    });
  }
  return shape;
}

async function getCollectorWindow(windowId = collectorWindowState.windowId) {
  await collectorWindowStateReady;
  if (!Number.isSafeInteger(windowId) || windowId < 0 || typeof chrome.windows?.get !== "function") return null;
  try {
    const window = await chrome.windows.get(windowId);
    if (!window || window.type && window.type !== "normal") return null;
    return window;
  } catch (_) {
    return null;
  }
}

async function tabsInCollectorWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || typeof chrome.tabs?.query !== "function") return [];
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return Array.isArray(tabs) ? tabs : [];
  } catch (_) {
    return [];
  }
}

async function waitForCollectorWindowTabs(windowId, timeoutMs = COLLECTOR_INITIAL_TAB_WAIT_MS) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let tabs = await tabsInCollectorWindow(windowId);
  while (tabs.length === 0 && Date.now() < deadline) {
    await wait(Math.min(COLLECTOR_INITIAL_TAB_POLL_MS, Math.max(0, deadline - Date.now())));
    tabs = await tabsInCollectorWindow(windowId);
  }
  return tabs;
}

async function findCollectorWindowTab(windowId) {
  const tabs = await tabsInCollectorWindow(windowId);
  return tabs.find((tab) => tab?.id === collectorWindowState.tabId)
    || tabs.find((tab) => isChatGptTab(tab))
    || null;
}

async function makeCollectorWindowUsable(window, trace = {}) {
  if (!window || !Number.isSafeInteger(window.id)) return null;
  let usable = window;
  const changes = {};
  if (window.state === "minimized") changes.state = "normal";
  if (window.focused === true) changes.focused = false;
  if (Object.keys(changes).length > 0 && typeof chrome.windows?.update === "function") {
    try {
      usable = await chrome.windows.update(window.id, changes) || { ...window, ...changes };
    } catch (error) {
      diagnostic("collector window restore failed", {
        ...trace,
        collector_window_id: window.id,
        error_code: error?.code || "collector_window_restore_failed",
        status: "error",
        stage: "collector_window_restore"
      });
    }
  }
  collectorWindowState = {
    ...collectorWindowState,
    windowId: window.id,
    windowState: usable.state || "normal",
    windowWidth: positiveDimension(usable.width),
    windowHeight: positiveDimension(usable.height)
  };
  diagnostic("collector window usable", {
    ...trace,
    collector_window_id: usable.id,
    collector_window_focused: usable.focused === true,
    collector_window_state: usable.state || "normal",
    collector_window_exists: true,
    collector_window_width: collectorWindowState.windowWidth,
    collector_window_height: collectorWindowState.windowHeight,
    status: "ready",
    stage: "collector_window_usable"
  });
  return usable;
}

async function collectorWindowCreateData(url) {
  let referenceWindow = null;
  if (typeof chrome.windows?.getLastFocused === "function") {
    try { referenceWindow = await chrome.windows.getLastFocused({ populate: false }); } catch (_) { }
  }
  const referenceWidth = Number.isSafeInteger(referenceWindow?.width) && referenceWindow.width > 0
    ? referenceWindow.width : COLLECTOR_WINDOW_FALLBACK_WIDTH;
  const referenceHeight = Number.isSafeInteger(referenceWindow?.height) && referenceWindow.height > 0
    ? referenceWindow.height : COLLECTOR_WINDOW_FALLBACK_HEIGHT;
  return {
    url,
    focused: false,
    state: "normal",
    type: "normal",
    width: Math.max(COLLECTOR_WINDOW_MIN_WIDTH, Math.floor(referenceWidth * COLLECTOR_WINDOW_SIZE_FACTOR)),
    height: Math.max(COLLECTOR_WINDOW_MIN_HEIGHT, Math.floor(referenceHeight * COLLECTOR_WINDOW_SIZE_FACTOR))
  };
}

async function enforceCollectorTab(tab, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id)) return tab;
  if (tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector TabがCollector Windowにありません。", 0, "collector_tab_wrong_window");
  }
  if (tab.discarded === true || tab.frozen === true) {
    throw bridgeError("Collector Tabがdiscardedまたはfrozenになっています。", 0, "collector_tab_state_changed");
  }
  const changes = {};
  if (tab.active !== true) changes.active = true;
  if (tab.autoDiscardable !== false) changes.autoDiscardable = false;
  let normalized = tab;
  if (Object.keys(changes).length > 0 && typeof chrome.tabs?.update === "function") {
    try {
      normalized = await chrome.tabs.update(tab.id, changes) || { ...tab, ...changes };
    } catch (_) {
      throw bridgeError("Collector Tabの実行状態を設定できません。", 0, "collector_tab_state_failed");
    }
  }
  collectorWindowState = { ...collectorWindowState, tabId: normalized.id };
  diagnostic("collector tab state enforced", {
    ...trace,
    collector_window_id: normalized.windowId,
    collector_tab_id: normalized.id,
    target_tab_id: normalized.id,
    tab_active: normalized.active === true,
    tab_auto_discardable: normalized.autoDiscardable === false ? false : normalized.autoDiscardable,
    status: "enforced",
    stage: "collector_tab_state_enforced"
  });
  return normalized;
}

function collectorTabNeedsRecovery(tab) {
  return tab?.discarded === true || tab?.frozen === true;
}

async function replaceCollectorTab(tab, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id)
    || tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector TabのRecovery対象が一致しません。", 0, "collector_tab_wrong_window");
  }
  collectorWindowLifecycle("RecoveringTab", {
    windowId: tab.windowId,
    tabId: null,
    currentProjectId: null,
    projectIndex: -1
  });
  diagnostic("collector tab recovery requested", {
    ...trace,
    collector_window_id: tab.windowId,
    collector_tab_id: tab.id,
    target_tab_id: tab.id,
    tab_active: tab.active === true,
    tab_discarded: tab.discarded === true,
    tab_frozen: tab.frozen === true,
    tab_auto_discardable: tab.autoDiscardable,
    status: "recovering",
    error_code: tab.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen",
    stage: "collector_tab_recovery_requested"
  });
  if (typeof chrome.tabs?.remove !== "function") {
    throw bridgeError("Collector TabをRecoveryできません。", 0, "collector_tab_recovery_failed");
  }
  try {
    await chrome.tabs.remove(tab.id);
  } catch (_) {
    // The tab may have been closed concurrently. Verify the exact ID before
    // allowing the caller to create a replacement; otherwise two Collector
    // Tabs could be left in the same Window.
  }
  if (typeof chrome.tabs?.get === "function") {
    try {
      await chrome.tabs.get(tab.id);
      throw bridgeError("Collector Tabの旧インスタンスを閉じられませんでした。", 0, "collector_tab_recovery_failed");
    } catch (error) {
      if (error?.code === "collector_tab_recovery_failed") throw error;
    }
  }
  return null;
}

async function createCollectorTabInWindow(windowId, url, trace = {}) {
  if (typeof chrome.tabs?.create !== "function") {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  let created;
  try {
    created = await chrome.tabs.create({ url, windowId, active: true });
  } catch (_) {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  collectorWindowState = { ...collectorWindowState, windowId, tabId: created.id };
  collectorWindowLifecycle("PreparingTab", { windowId, tabId: created.id });
  diagnostic("collector tab created", {
    ...trace,
    collector_window_id: windowId,
    collector_tab_id: created.id,
    target_tab_id: created.id,
    status: "created",
    stage: "collector_tab_created"
  });
  return await enforceCollectorTab(created, trace);
}

async function ensureCollectorWindow(url = COLLECTOR_TAB_URL, trace = {}) {
  await collectorWindowStateReady;
  let window = await getCollectorWindow();
  if (!window) {
    if (Number.isSafeInteger(collectorWindowState.windowId)) {
      diagnostic("collector window unavailable", {
        ...trace,
        collector_window_id: collectorWindowState.windowId,
        collector_window_exists: false,
        status: "recovering",
        stage: "collector_window_lookup"
      });
    }
    if (typeof chrome.windows?.create !== "function") {
      throw bridgeError("ChatGPT Context収集用Windowを作成できません。", 0, "collector_window_create_failed");
    }
    collectorWindowLifecycle("PreparingWindow", { windowId: null, tabId: null });
    let created;
    let createTimeout = null;
    try {
      const data = await collectorWindowCreateData(url);
      created = await Promise.race([
        chrome.windows.create(data),
        new Promise((_, reject) => {
          createTimeout = setTimeout(() => reject(bridgeError(
            "ChatGPT Context収集用Windowの作成がタイムアウトしました。",
            0,
            "collector_window_create_timeout")), COLLECTOR_WINDOW_CREATE_TIMEOUT_MS);
        })
      ]);
    } finally {
      if (createTimeout !== null) clearTimeout(createTimeout);
    }
    if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
      throw bridgeError("ChatGPT Context収集用Windowを作成できません。", 0, "collector_window_create_failed");
    }
    window = await makeCollectorWindowUsable({ ...created, state: created.state || "normal" }, trace);
    diagnostic("collector window created", {
      ...trace,
      collector_window_id: window.id,
      collector_window_focused: window.focused === true,
      collector_window_state: window.state || "normal",
      collector_window_exists: true,
      status: "created",
      stage: "collector_window_created"
    });
  } else {
    window = await makeCollectorWindowUsable(window, trace);
  }

  // windows.create({ url }) already creates the first Tab. Reconcile the
  // complete Window before considering tabs.create so that the initial Tab is
  // reused and any stale duplicate is removed deterministically.
  // Chrome creates the initial Tab as part of windows.create({ url }). On a
  // real profile the tabs.query result can briefly lag that creation. Wait for
  // that authoritative Tab instead of creating a second one during the gap.
  await waitForCollectorWindowTabs(window.id);
  let tab = await reconcileCollectorWindowTabs(
    window.id,
    collectorWindowState.tabId,
    trace);
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab, trace);
    tab = null;
  }
  if (!tab) tab = await createCollectorTabInWindow(window.id, url, trace);
  else {
    collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: tab.id };
    collectorWindowLifecycle("PreparingTab", { windowId: window.id, tabId: tab.id });
    tab = await enforceCollectorTab(tab, trace);
  }
  tab = await reconcileCollectorWindowTabs(window.id, tab.id, trace);
  if (!tab) {
    throw bridgeError(
      "Collector Window内のCollector Tabを確認できません。",
      0,
      "collector_tab_count_invalid");
  }
  tab = await enforceCollectorTab(tab, trace);
  recordCollectorTabTopology(
    window.id,
    await tabsInCollectorWindow(window.id),
    tab,
    trace);
  if (!(await waitForTabReady(tab.id, COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS))) {
    collectorWindowLifecycle("Failed", { windowId: window.id, tabId: tab.id });
    throw bridgeError(
      "ChatGPT Context収集用タブの読み込みがタイムアウトしました。",
      0,
      "collector_tab_navigation_timeout");
  }
  collectorWindowLifecycle("WaitingContentScript", { windowId: window.id, tabId: tab.id });
  return tab;
}

async function navigateCollectorTab(tab, url, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id) || tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector Tabを移動できません。", 0, "collector_tab_wrong_window");
  }
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab, trace);
    tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, trace);
  }
  const targetUrl = safeChatGptContextUrl(url) || COLLECTOR_TAB_URL;
  const projectUrl = safeChatGptProjectUrl(targetUrl);
  const isProjectNavigation = projectUrl !== null;
  if (isProjectNavigation && trace.project_discovery_completed !== true) {
    diagnostic("collector Project navigation blocked before discovery", {
      request_id: trace.request_id,
      project_id: trace.project_id,
      project_index: trace.project_index,
      total_projects: trace.total_projects,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      collector_navigation_target: targetUrl,
      project_discovery_completed: false,
      status: "error",
      error_code: "collector_project_navigation_before_discovery",
      stage: "collector_project_navigation_guard",
      target_tab_id: tab.id
    });
    throw bridgeError(
      "Project一覧の確定前にProjectページへ移動することはできません。",
      0,
      "collector_project_navigation_before_discovery");
  }
  const currentUrl = safeChatGptContextUrl(tab.url);
  const navigationTrace = {
    ...trace,
    currentProjectId: isProjectNavigation
      ? (trace.project_id || chatGptProjectId(projectUrl))
      : null,
    currentProjectUrl: isProjectNavigation ? targetUrl : null,
    collectorNavigationTarget: targetUrl
  };
  collectorWindowState = {
    ...collectorWindowState,
    currentProjectId: navigationTrace.currentProjectId,
    // The root page is the discovery page, not a Project target. Keep the
    // state aligned with the normalized trace so a root transition cannot be
    // mistaken for an in-progress Project navigation by later orchestration.
    currentProjectUrl: navigationTrace.currentProjectUrl,
    collectorNavigationTarget: targetUrl
  };
  let updated = tab;
  if (currentUrl !== targetUrl && typeof chrome.tabs?.update === "function") {
    const navigationLifecycle = isProjectNavigation ? "NavigatingProject" : "NavigatingRoot";
    const navigationStage = isProjectNavigation
      ? "collector_project_url_navigation"
      : "collector_root_url_navigation";
    collectorWindowLifecycle(navigationLifecycle, { tabId: tab.id, ...navigationTrace });
    diagnostic("collector navigation requested", {
      ...navigationTrace,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      collector_navigation_target: targetUrl,
      status: "requested",
      stage: navigationStage,
      target_tab_id: tab.id
    });
    contentScriptReadyTabs.delete(tab.id);
    try {
      updated = await chrome.tabs.update(tab.id, {
        url: targetUrl,
        active: true,
        autoDiscardable: false
      }) || { ...tab, url: targetUrl, active: true, autoDiscardable: false };
    } catch (_) {
      throw bridgeError("Collector TabのProjectページ移動に失敗しました。", 0, "collector_tab_navigation_failed");
    }
  }
  updated = await enforceCollectorTab(updated, navigationTrace);
  if (!(await waitForTabReady(updated.id, COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS))) {
    throw bridgeError("Collector TabのProjectページ読み込みがタイムアウトしました。", 0, "collector_tab_navigation_timeout");
  }
  return updated;
}

async function readCollectorViewport(tab, trace = {}) {
  const requestId = trace.request_id || collectorWindowState.requestId || "collector-viewport";
  const result = await dispatchToContentScript(tab.id, {
    type: "GET_COLLECTOR_VIEWPORT",
    requestId
  }, trace, {
    timeoutMs: CONTENT_SCRIPT_TIMEOUT_MS,
    timeoutStage: "collector_viewport_timeout"
  });
  const responseRequestId = result?.requestId || result?.request_id;
  if (responseRequestId && requestId && responseRequestId !== requestId) {
    throw bridgeError(
      "Collector viewport responseの識別情報が一致しません。",
      0,
      "collector_viewport_response_correlation_failed");
  }
  if (!result || result.status !== "ok") {
    throw bridgeError(
      "Collector Tabのviewportを確認できませんでした。",
      0,
      result?.errorCode || result?.error_code || "collector_viewport_unavailable");
  }
  return result;
}

// Readiness only: this function may reconcile/resize/wait for the Collector
// medium, but it must not scroll the Sidebar or collect Project rows. Project
// discovery is deliberately owned by collectProjectsOnce().
async function ensureCollectorReady(tab, trace = {}) {
  let currentTab = await reconcileCollectorWindowTabs(
    collectorWindowState.windowId,
    tab?.id,
    trace);
  if (!currentTab) {
    throw bridgeError(
      "Collector Window内にCollector Tabがありません。",
      0,
      "collector_tab_count_invalid");
  }
  currentTab = await enforceCollectorTab(currentTab, trace);
  let viewportRetryCount = 0;
  let sidebarRetryCount = 0;
  while (true) {
    const window = await getCollectorWindow();
    if (!window) {
      throw bridgeError(
        "Collector Windowが存在しません。",
        0,
        "collector_window_unavailable");
    }
    const viewport = await readCollectorViewport(currentTab, trace);
    const contentWidth = positiveDimension(viewport.content_inner_width) || 0;
    const contentHeight = positiveDimension(viewport.content_inner_height);
    recordCollectorViewportTelemetry(window, viewport, viewportRetryCount, trace);

    const viewportReady = contentWidth >= COLLECTOR_CONTENT_MIN_WIDTH;
    const sidebarReady = viewport.sidebar_ready === true;
    if (viewportReady && sidebarReady) {
      collectorWindowLifecycle("SidebarReady", {
        windowId: window.id,
        tabId: currentTab.id,
        windowWidth: positiveDimension(window.width),
        windowHeight: positiveDimension(window.height),
        contentInnerWidth: contentWidth,
        contentInnerHeight: contentHeight,
        sidebarExpectedVisible: true,
        viewportRetryCount
      });
      return currentTab;
    }

    const retryLimitReached = viewportReady
      ? sidebarRetryCount >= COLLECTOR_SIDEBAR_READY_MAX_RETRIES
      : viewportRetryCount >= COLLECTOR_VIEWPORT_MAX_RETRIES;
    if (retryLimitReached) {
      const errorCode = viewportReady
        ? "collector_sidebar_not_ready"
        : "collector_viewport_too_narrow";
      const message = viewportReady
        ? "ChatGPT Project sidebarの準備が完了しませんでした。"
        : "Collector Windowのviewport幅が不足しています。";
      collectorWindowLifecycle("Failed", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount: viewportRetryCount
      });
      diagnostic("collector viewport readiness failed", {
        ...trace,
        collector_window_id: window.id,
        collector_tab_id: currentTab.id,
        collector_window_width: collectorWindowState.windowWidth,
        collector_window_height: collectorWindowState.windowHeight,
        collector_content_inner_width: collectorWindowState.contentInnerWidth,
        collector_content_inner_height: collectorWindowState.contentInnerHeight,
        sidebar_expected_visible: collectorWindowState.sidebarExpectedVisible,
        viewport_retry_count: viewportRetryCount,
        error_code: errorCode,
        status: "error",
        stage: "collector_viewport_readiness"
      });
      throw bridgeError(message, 0, errorCode);
    }

    if (!viewportReady) {
      viewportRetryCount += 1;
      const currentWidth = positiveDimension(window.width) || COLLECTOR_WINDOW_MIN_WIDTH;
      const currentHeight = positiveDimension(window.height) || COLLECTOR_WINDOW_FALLBACK_HEIGHT;
      const widthDeficit = Math.max(1, COLLECTOR_CONTENT_MIN_WIDTH - contentWidth);
      const nextWidth = Math.max(
        COLLECTOR_WINDOW_MIN_WIDTH,
        currentWidth + widthDeficit + 48,
        currentWidth + 1);
      collectorWindowLifecycle("ResizingViewport", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount
      });
      if (typeof chrome.windows?.update !== "function") {
        throw bridgeError(
          "Collector Windowのviewportを拡張できません。",
          0,
          "collector_viewport_resize_failed");
      }
      try {
        const resized = await chrome.windows.update(window.id, {
          width: nextWidth,
          height: currentHeight,
          state: "normal",
          focused: false
        });
        const resizedWindow = resized || await getCollectorWindow(window.id);
        if (!resizedWindow) {
          throw bridgeError("Collector Windowがresize後に見つかりません。", 0, "collector_window_unavailable");
        }
        collectorWindowState = {
          ...collectorWindowState,
          windowWidth: positiveDimension(resizedWindow.width) || nextWidth,
          windowHeight: positiveDimension(resizedWindow.height) || currentHeight
        };
      } catch (error) {
        if (error?.code === "collector_window_unavailable") throw error;
        throw bridgeError(
          "Collector Windowのviewportを拡張できません。",
          0,
          "collector_viewport_resize_failed");
      }
    } else {
      sidebarRetryCount += 1;
      collectorWindowLifecycle("WaitingSidebar", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount
      });
    }
    await wait(COLLECTOR_VIEWPORT_RETRY_DELAY_MS);
    currentTab = await reconcileCollectorWindowTabs(
      collectorWindowState.windowId,
      currentTab.id,
      trace);
    if (!currentTab) {
      throw bridgeError(
        "Collector Window内にCollector Tabがありません。",
        0,
        "collector_tab_count_invalid");
    }
    currentTab = await enforceCollectorTab(currentTab, trace);
  }
}

async function getCollectorTab() {
  await collectorWindowStateReady;
  const window = await getCollectorWindow();
  if (!window) {
    collectorWindowState = { ...defaultCollectorWindowState };
    void persistCollectorWindowState();
    return null;
  }
  const tab = await reconcileCollectorWindowTabs(
    window.id,
    collectorWindowState.tabId,
    { stage: "collector_tab_lookup" });
  if (!tab) {
    collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: null };
    void persistCollectorWindowState();
    return null;
  }
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab);
    return null;
  }
  collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: tab.id };
  return await enforceCollectorTab(tab);
}

async function releaseCollectorTab(tab) {
  if (!tab || collectorWindowState.tabId !== tab.id) return;
  let current = tab;
  try { current = await chrome.tabs.get(tab.id); } catch (_) { current = null; }
  if (!current) {
    collectorWindowState = { ...collectorWindowState, tabId: null, lifecycle: "Recoverable" };
    void persistCollectorWindowState();
    return;
  }
  if (collectorTabNeedsRecovery(current)) {
    await replaceCollectorTab(current);
    return;
  }
  try { await enforceCollectorTab(current); } catch (_) { }
  collectorWindowLifecycle("Ready", {
    tabId: current.id,
    currentProjectId: null,
    currentProjectUrl: null,
    collectorNavigationTarget: null,
    projectIndex: -1
  });
  diagnostic("collector window retained", {
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: current.id,
    target_tab_id: current.id,
    status: "ready",
    stage: "collector_window_retained"
  });
}

async function dispatchToContentScript(tabId, message, trace, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(100, options.timeoutMs)
    : CONTENT_SCRIPT_TIMEOUT_MS;
  const timeoutStage = typeof options.timeoutStage === "string"
    ? options.timeoutStage
    : "content_script_timeout";
  diagnostic("content script dispatched", {
    ...traceForMessage(trace, { target_tab_id: tabId })
  });
  try {
    return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
  } catch (error) {
    // A tab that was already open when the unpacked extension was reloaded
    // may not have received manifest content scripts yet. Inject the same
    // locator/DOM modules through the MV3 scripting API, then retry the
    // message. The injected code is still content-script.js; the background
    // does not inspect or mutate the ChatGPT DOM itself.
    if (!isMissingContentScriptError(error) || options.retryMissingContentScript === false) throw error;

    const ready = await waitForTabReady(tabId, Math.min(timeoutMs, CONTENT_SCRIPT_READY_TIMEOUT_MS));
    if (!ready) {
      const timeoutError = bridgeError("ChatGPT tab did not finish loading before Content Script dispatch.", 0, "content_script_unavailable");
      timeoutError.stage = timeoutStage === "content_script_timeout"
        ? "content_script_ready_timeout"
        : timeoutStage;
      throw timeoutError;
    }

    // The manifest Content Script may have become available while the tab
    // was loading.  Retry it before using executeScript so a normal page load
    // does not create a duplicate watcher/context monitor.
    try {
      return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
    } catch (retryError) {
      if (!isMissingContentScriptError(retryError) || !chrome.scripting?.executeScript) throw retryError;
    }

    diagnostic("content script injection requested", {
      ...traceForMessage(trace, { target_tab_id: tabId })
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["chatgpt-locators.js", "content-script.js"]
    });
    diagnostic("content script injected", {
      ...traceForMessage(trace, { target_tab_id: tabId })
    });
    return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
  }
}

function contextResultError(message, errorCode, text, stage) {
  return {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: message?.request_id || message?.requestId || "",
    mode: message?.mode === "current" ? "current" : "list",
    status: "error",
    projects: [],
    conversations: [],
    current: null,
    errorCode,
    message: text,
    stage
  };
}

function normalizeContextEntryId(value) {
  return safeContextIdentifier(value);
}

function normalizeContextDiscoveryKey(value) {
  return safeContextIdentifier(value);
}

function normalizeContextResult(contentResult, pending) {
  if (!contentResult || typeof contentResult !== "object") {
    return contextResultError(pending.message, "context_extraction_failed", "ChatGPT Content ScriptからContextを取得できませんでした。", "context_result_invalid");
  }
  const requestId = contentResult.requestId || contentResult.request_id;
  if (requestId !== pending.requestId
    || (contentResult.mode || "list") !== (pending.currentOnly ? "current" : "list")) {
    return contextResultError(pending.message, "context_response_correlation_failed", "ChatGPT Context responseの識別情報が一致しません。", "context_response_correlation");
  }
  if (contentResult.status === "error") {
    return contextResultError(
      pending.message,
      contentResult.errorCode || contentResult.error_code || "context_extraction_failed",
      contentResult.message || "ChatGPTのContext取得に失敗しました。",
      contentResult.stage || "context_extraction");
  }
  if (contentResult.status !== "ok") {
    return contextResultError(pending.message, "context_response_invalid", "ChatGPT Context responseが不正です。", "context_response_validation");
  }
  if (!Array.isArray(contentResult.projects) || !Array.isArray(contentResult.conversations)) {
    return contextResultError(pending.message, "context_response_invalid", "ChatGPT Context responseが不正です。", "context_metadata_validation");
  }

  const projects = [];
  const projectIds = new Set();
  const projectKeys = new Set();
  for (const item of contentResult.projects) {
    const projectId = normalizeContextEntryId(item?.project_id || item?.projectId);
    const discoveryKey = normalizeContextDiscoveryKey(item?.discovery_key || item?.discoveryKey);
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(item?.url);
    const hasProjectId = item && Object.prototype.hasOwnProperty.call(item, "project_id")
      && item.project_id !== null && item.project_id !== undefined;
    const hasDiscoveryKey = item && Object.prototype.hasOwnProperty.call(item, "discovery_key")
      && item.discovery_key !== null && item.discovery_key !== undefined;
    const hasUrl = item && Object.prototype.hasOwnProperty.call(item, "url") && item.url !== null && item.url !== undefined;
    if (!title
      || (hasProjectId && !projectId)
      || (hasDiscoveryKey && !discoveryKey)
      || (!projectId && !discoveryKey)
      || (hasUrl && !url)) {
      return contextResultError(pending.message, "context_metadata_invalid", "ChatGPT Project metadataが不正です。", "context_metadata_validation");
    }
    const projectKey = projectId ? `id:${projectId}` : `discovery:${discoveryKey}`;
    if (projectKeys.has(projectKey)) continue;
    projectKeys.add(projectKey);
    if (projectId) projectIds.add(projectId);
    projects.push({
      ...(projectId ? { project_id: projectId } : {}),
      title,
      ...(url ? { url } : {}),
      ...(discoveryKey ? { discovery_key: discoveryKey } : {})
    });
  }

  const conversations = [];
  const conversationIds = new Set();
  for (const item of contentResult.conversations) {
    const conversationId = normalizeContextEntryId(item?.conversation_id || item?.conversationId);
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(item?.url);
    const projectId = normalizeContextEntryId(item?.project_id || item?.projectId);
    const projectTitle = typeof (item?.project_title || item?.projectTitle) === "string"
      ? String(item.project_title || item.projectTitle).trim().slice(0, 512)
      : "";
    const hasProjectId = item && Object.prototype.hasOwnProperty.call(item, "project_id") && item.project_id !== null && item.project_id !== undefined;
    const hasProjectTitle = item && Object.prototype.hasOwnProperty.call(item, "project_title") && item.project_title !== null && item.project_title !== undefined;
    if (!conversationId || !title || !url || (hasProjectId && !projectId) || (hasProjectTitle && !projectTitle)) {
      return contextResultError(pending.message, "context_metadata_invalid", "ChatGPT Conversation metadataが不正です。", "context_metadata_validation");
    }
    if (conversationIds.has(conversationId)) continue;
    if (projectId && !projectIds.has(projectId)) {
      // A conversation may be visible before its project home link is
      // rendered. Preserve the relationship; Desktop will create a safe
      // placeholder Project option for it.
      projectIds.add(projectId);
    }
    conversationIds.add(conversationId);
    conversations.push({
      conversation_id: conversationId,
      title,
      url,
      ...(projectId ? { project_id: projectId } : {}),
      ...(projectTitle ? { project_title: projectTitle } : {})
    });
  }

  const current = normalizeCurrentContext(contentResult.current);
  return {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: pending.requestId,
    mode: pending.currentOnly ? "current" : "list",
    status: "ok",
    projects,
    conversations,
    current
  };
}

function sendChatGptContextResponseToBridge(result, pending) {
  const envelope = {
    type: pending.currentOnly ? CHATGPT_CONTEXT_CURRENT_RESPONSE_TYPE : CHATGPT_CONTEXT_LIST_RESPONSE_TYPE,
    request_id: result.requestId,
    status: result.status,
  };
  if (result.status === "ok") {
    envelope.projects = result.projects || [];
    envelope.conversations = result.conversations || [];
    envelope.current = result.current || null;
  }
  if (result.errorCode) envelope.error_code = result.errorCode;
  if (result.message) envelope.message = result.message;
  if (result.stage) envelope.stage = result.stage;

  if (pending.bridgeSocket?.readyState !== WebSocket.OPEN || socket !== pending.bridgeSocket) {
    diagnostic("chatgpt.context response dropped", {
      request_id: result.requestId,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_bridge_send",
      target_tab_id: pending.tabId
    });
    return false;
  }
  try {
    pending.bridgeSocket.send(JSON.stringify(envelope));
    diagnostic("chatgpt.context response sent", {
      request_id: result.requestId,
      status: result.status,
      error_code: result.errorCode,
      stage: result.stage || "context_response_sent",
      target_tab_id: pending.tabId
    });
    return true;
  } catch (_) {
    diagnostic("chatgpt.context response failed", {
      request_id: result.requestId,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_bridge_send",
      target_tab_id: pending.tabId
    });
    return false;
  }
}

async function completeContextRequest(contentResult, pending) {
  if (!pending || contextRequests.get(pending.requestId) !== pending) return;
  contextRequests.delete(pending.requestId);
  if (!isCurrentCollectorRequest(pending)) {
    diagnostic("chatgpt.context stale result discarded", {
      request_id: pending.requestId,
      status: "discarded",
      error_code: "context_refresh_superseded",
      stage: "context_stale_result_discarded",
      target_tab_id: pending.tabId
    });
    return;
  }
  const result = normalizeContextResult(contentResult, pending);
  diagnostic("chatgpt.context result", {
    request_id: pending.requestId,
    status: result.status,
    error_code: result.errorCode,
    stage: result.stage || "context_result",
    target_tab_id: pending.tabId
  });
  sendChatGptContextResponseToBridge(result, pending);
}

function collectorProjectTarget(project) {
  const explicitProjectId = safeContextIdentifier(project?.project_id || project?.projectId);
  const projectUrl = safeChatGptProjectUrl(project?.url);
  const urlProjectId = chatGptProjectId(projectUrl);
  if (!projectUrl || !urlProjectId) return null;
  const projectId = urlProjectId;
  if (urlProjectId && explicitProjectId && urlProjectId !== explicitProjectId) return null;
  return {
    projectId,
    projectUrl
  };
}

function mergeCollectorMetadata(destination, source, forcedProjectId = null) {
  if (!source || typeof source !== "object") {
    throw bridgeError("ChatGPT CollectorからContextを取得できませんでした。", 0, "context_extraction_failed");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== destination.requestId || (source.mode || "list") !== "list") {
    throw bridgeError("ChatGPT Context responseの識別情報が一致しません。", 0, "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPTのContext取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_extraction_failed");
  }
  if (source.status !== "ok"
    || !Array.isArray(source.projects)
    || !Array.isArray(source.conversations)) {
    throw bridgeError("ChatGPT Context responseが不正です。", 0, "context_response_invalid");
  }
  if (Number.isSafeInteger(source.unresolved_project_count) && source.unresolved_project_count > 0) {
    throw bridgeError(
      "ChatGPT ProjectのIDを完全には取得できませんでした。",
      0,
      "context_projects_incomplete");
  }

  for (const sourceProject of source.projects) {
    const projectId = safeContextIdentifier(sourceProject?.project_id || sourceProject?.projectId);
    const discoveryKey = safeContextIdentifier(sourceProject?.discovery_key || sourceProject?.discoveryKey);
    const title = typeof sourceProject?.title === "string" ? sourceProject.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(sourceProject?.url);
    if (forcedProjectId && projectId && forcedProjectId !== projectId) continue;
    // A Project-page response is scoped by the requested ID. If a stale
    // sidebar also contributes several title-only rows, none of those rows
    // is safe to relabel as the requested Project.
    if (forcedProjectId && !projectId && source.projects.length > 1) continue;
    const effectiveProjectId = forcedProjectId || projectId;
    if (!title || (!effectiveProjectId && !discoveryKey)) continue;
    const existing = destination.projects.find((candidate) =>
      effectiveProjectId && candidate.project_id === effectiveProjectId
        || !effectiveProjectId && discoveryKey && candidate.discovery_key === discoveryKey);
    if (!existing) {
      if (destination.projects.length >= COLLECTOR_MAX_PROJECTS) {
        throw bridgeError("ChatGPT Project metadataの件数上限を超えました。", 0, "context_metadata_limit");
      }
      destination.projects.push({
        ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}),
        title,
        ...(url ? { url } : {}),
        ...(discoveryKey ? { discovery_key: discoveryKey } : {})
      });
    } else {
      if (title && (!existing.title || /^Project\s*\(/i.test(existing.title))) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (effectiveProjectId) existing.project_id = effectiveProjectId;
      if (discoveryKey && !existing.discovery_key) existing.discovery_key = discoveryKey;
    }
  }

  for (const sourceConversation of source.conversations) {
    const conversationId = safeContextIdentifier(
      sourceConversation?.conversation_id || sourceConversation?.conversationId);
    const title = typeof sourceConversation?.title === "string"
      ? sourceConversation.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(sourceConversation?.url);
    const explicitProjectId = safeContextIdentifier(
      sourceConversation?.project_id || sourceConversation?.projectId);
    if (!conversationId || !title || !url) continue;
    if (forcedProjectId && explicitProjectId && forcedProjectId !== explicitProjectId) continue;
    const projectId = forcedProjectId || explicitProjectId;
    const projectTitle = typeof (sourceConversation?.project_title || sourceConversation?.projectTitle) === "string"
      ? String(sourceConversation.project_title || sourceConversation.projectTitle).trim().slice(0, 512) : "";
    const existing = destination.conversations.find((candidate) =>
      candidate.conversation_id === conversationId);
    if (!existing) {
      if (destination.conversations.length >= COLLECTOR_MAX_CONVERSATIONS) {
        throw bridgeError("ChatGPT Chat metadataの件数上限を超えました。", 0, "context_metadata_limit");
      }
      destination.conversations.push({
        conversation_id: conversationId,
        title,
        url,
        ...(projectId ? { project_id: projectId } : {}),
        ...(projectTitle ? { project_title: projectTitle } : {})
      });
    } else {
      if (title && (!existing.title || existing.title === conversationId)) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (projectId && !existing.project_id) existing.project_id = projectId;
      if (projectTitle && !existing.project_title) existing.project_title = projectTitle;
    }
  }
  if (!destination.current && source.current) destination.current = source.current;
}

function validateCollectorRootResult(source, pending) {
  if (!source || typeof source !== "object") {
    throw bridgeError("ChatGPT CollectorからContextを取得できませんでした。", 0, "context_extraction_failed");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== pending.requestId || (source.mode || "list") !== "list") {
    throw bridgeError("ChatGPT Context responseの識別情報が一致しません。", 0, "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPTのContext取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_extraction_failed");
  }
  if (source.status !== "ok"
      || !Array.isArray(source.projects)
      || !Array.isArray(source.conversations)) {
    throw bridgeError("ChatGPT Context responseが不正です。", 0, "context_response_invalid");
  }
  const reportedUnresolved = Number.isSafeInteger(source.unresolved_project_count)
    ? Math.max(0, source.unresolved_project_count)
    : 0;
  // The root scan is the only source of the Project catalog. A title-only row
  // is useful for display diagnostics, but it is not a safe navigation target
  // and must never make the final metadata snapshot look complete.
  const resolution = collectProjectMetadataResolution(source);
  return Math.max(reportedUnresolved, resolution.unresolvedCount);
}

function collectorProjectMetadataResolution(project) {
  const rawTitle = typeof project?.title === "string" ? project.title.trim() : "";
  const rawProjectIdValue = project?.project_id || project?.projectId;
  const rawProjectId = typeof rawProjectIdValue === "string" ? rawProjectIdValue.trim() : "";
  const rawProjectUrl = typeof project?.url === "string" ? project.url.trim() : "";
  const explicitProjectId = safeContextIdentifier(rawProjectIdValue);
  const projectUrl = safeChatGptProjectUrl(rawProjectUrl);
  const urlProjectId = chatGptProjectId(projectUrl);
  // A Project is complete only when its display metadata and stable
  // navigation identity are both present. The navigation helper intentionally
  // does not require a title because it is also used while checking a target,
  // but the final catalog must not publish a title-less Project.
  const resolved = rawTitle.length > 0 && collectorProjectTarget(project) !== null;
  let unresolvedReason = null;

  if (!resolved) {
    if (!rawTitle) unresolvedReason = "missing_title";
    else if (rawProjectId && !explicitProjectId) unresolvedReason = "invalid_project_id";
    else if (rawProjectUrl && !projectUrl) unresolvedReason = "invalid_project_url";
    else if (explicitProjectId && urlProjectId && explicitProjectId !== urlProjectId) {
      unresolvedReason = "project_id_url_mismatch";
    } else if (explicitProjectId && !explicitProjectId.toLowerCase().startsWith("g-p-")) {
      unresolvedReason = "invalid_project_id";
    } else {
      unresolvedReason = "missing_stable_identity";
    }
  }

  return {
    titlePresent: rawTitle.length > 0,
    projectIdPresent: rawProjectId.length > 0,
    urlPresent: rawProjectUrl.length > 0,
    resolved,
    unresolvedReason
  };
}

function collectProjectMetadataResolution(source) {
  const projects = Array.isArray(source?.projects) ? source.projects : [];
  const items = projects.map((project, projectIndex) => ({
    projectIndex,
    ...collectorProjectMetadataResolution(project)
  }));
  const unresolvedReasonCounts = new Map();
  for (const item of items) {
    if (item.resolved) continue;
    const reason = item.unresolvedReason || "missing_stable_identity";
    unresolvedReasonCounts.set(reason, (unresolvedReasonCounts.get(reason) || 0) + 1);
  }
  const resolvedCount = items.filter((item) => item.resolved).length;
  const reportedUnresolvedCount = Number.isSafeInteger(source?.unresolved_project_count)
    ? Math.max(0, source.unresolved_project_count)
    : 0;
  return {
    discoveredCount: items.length,
    resolvedCount,
    unresolvedCount: items.length - resolvedCount,
    reportedUnresolvedCount,
    items,
    unresolvedReasonCounts
  };
}

function recordCollectorProjectMetadataResolution(source, pending) {
  const resolution = collectProjectMetadataResolution(source);
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    project_discovery_result_received: pending?.collectorProjectDiscoveryResultShape !== undefined,
    background_projects_length: resolution.discoveredCount,
    response_shape: pending?.collectorProjectDiscoveryResultShape?.responseShape
  };
  const contentDiscoveredProjectCount = pending?.collectorProjectDiscoveryResultShape
    ?.contentDiscoveredProjectCount;
  if (Number.isSafeInteger(contentDiscoveredProjectCount)) {
    base.content_discovered_project_count = contentDiscoveredProjectCount;
  }
  diagnostic("Project metadata resolution", {
    ...base,
    discovered_project_count: resolution.discoveredCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    reported_unresolved_project_count: resolution.reportedUnresolvedCount,
    status: "observed",
    stage: "collector_project_metadata_resolution",
    target_tab_id: pending?.tabId
  });
  for (const item of resolution.items) {
    diagnostic("collector project metadata item", {
      ...base,
      project_index: item.projectIndex,
      title_present: item.titlePresent,
      project_id_present: item.projectIdPresent,
      url_present: item.urlPresent,
      resolution_status: item.resolved ? "resolved" : "unresolved",
      unresolved_reason: item.unresolvedReason || "none",
      status: "observed",
      stage: "collector_project_metadata_item",
      target_tab_id: pending?.tabId
    });
  }
  for (const [reason, count] of resolution.unresolvedReasonCounts) {
    diagnostic("collector project metadata unresolved reason", {
      ...base,
      unresolved_reason: reason,
      unresolved_reason_count: count,
      status: "observed",
      stage: "collector_project_metadata_unresolved_reason",
      target_tab_id: pending?.tabId
    });
  }
  if (resolution.reportedUnresolvedCount > 0 && resolution.unresolvedReasonCounts.size === 0) {
    diagnostic("collector project metadata unresolved reason", {
      ...base,
      unresolved_reason: "reported_by_content_script",
      unresolved_reason_count: resolution.reportedUnresolvedCount,
      status: "observed",
      stage: "collector_project_metadata_unresolved_reason",
      target_tab_id: pending?.tabId
    });
  }
  return resolution;
}

function recordCollectorProjectMetadataResolutionFailure(resolution, pending, errorCode) {
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    discovered_project_count: resolution.discoveredCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    reported_unresolved_project_count: resolution.reportedUnresolvedCount,
    status: "error",
    error_code: errorCode || "context_projects_incomplete",
    stage: "collector_project_metadata_resolution_failed",
    target_tab_id: pending?.tabId
  };
  diagnostic("collector project metadata resolution failed", base);
  for (const [reason, count] of resolution.unresolvedReasonCounts) {
    diagnostic("collector project metadata unresolved reason", {
      request_id: pending?.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: pending?.tabId,
      unresolved_reason: reason,
      unresolved_reason_count: count,
      status: "error",
      error_code: errorCode || "context_projects_incomplete",
      stage: "collector_project_metadata_unresolved_reason_failed",
      target_tab_id: pending?.tabId
    });
  }
  if (resolution.reportedUnresolvedCount > 0 && resolution.unresolvedReasonCounts.size === 0) {
    diagnostic("collector project metadata unresolved reason", {
      request_id: pending?.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: pending?.tabId,
      unresolved_reason: "reported_by_content_script",
      unresolved_reason_count: resolution.reportedUnresolvedCount,
      status: "error",
      error_code: errorCode || "context_projects_incomplete",
      stage: "collector_project_metadata_unresolved_reason_failed",
      target_tab_id: pending?.tabId
    });
  }
}

function collectorProjectIdentityDescriptor(project, projectIndex) {
  const descriptor = {
    project_index: projectIndex,
    discovery_index: Number.isSafeInteger(project?.discovery_index)
      && project.discovery_index >= 0
      ? project.discovery_index
      : projectIndex
  };
  if (typeof project?.title === "string" && project.title.trim().length > 0) {
    descriptor.title = project.title.trim().slice(0, 512);
  }
  const projectId = safeContextIdentifier(project?.project_id || project?.projectId);
  if (projectId) descriptor.project_id = projectId;
  const projectUrl = safeChatGptContextUrl(project?.url);
  if (projectUrl) descriptor.url = projectUrl;
  const discoveryKey = safeContextIdentifier(project?.discovery_key || project?.discoveryKey);
  if (discoveryKey) descriptor.discovery_key = discoveryKey;
  return descriptor;
}

function validateCollectorProjectIdentityResponse(source, pending) {
  if (!source || typeof source !== "object") {
    throw bridgeError(
      "ChatGPT Project identity responseを取得できませんでした。",
      0,
      "context_projects_incomplete");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== pending.requestId || (source.mode || "list") !== "list") {
    throw bridgeError(
      "ChatGPT Project identity responseの識別情報が一致しません。",
      0,
      "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPT Project identity取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_projects_incomplete");
  }
  if (source.status !== "ok"
    || !Array.isArray(source.projects)
    || !Array.isArray(source.conversations)) {
    throw bridgeError(
      "ChatGPT Project identity responseが不正です。",
      0,
      "context_response_invalid");
  }
}

function collectorProjectIdentityResponseItem(sourceProjects, projectIndex, expectedLength) {
  const indexed = sourceProjects.find((project) =>
    Number.isSafeInteger(project?.project_index) && project.project_index === projectIndex);
  if (indexed) return indexed;
  if (sourceProjects.length === expectedLength) return sourceProjects[projectIndex] || null;
  if (sourceProjects.length === 1 && expectedLength === 1) return sourceProjects[0];
  return null;
}

function mergeCollectorProjectIdentity(project, identityProject, projectIndex) {
  const merged = {
    ...(project && typeof project === "object" ? project : {}),
    project_index: projectIndex
  };
  if (typeof identityProject?.title === "string" && identityProject.title.trim().length > 0
    && (!merged.title || typeof merged.title !== "string")) {
    merged.title = identityProject.title.trim().slice(0, 512);
  }
  const projectId = safeContextIdentifier(identityProject?.project_id || identityProject?.projectId);
  if (projectId) merged.project_id = projectId;
  const projectUrl = safeChatGptContextUrl(identityProject?.url);
  if (projectUrl) merged.url = projectUrl;
  const discoveryKey = safeContextIdentifier(identityProject?.discovery_key || identityProject?.discoveryKey);
  if (discoveryKey && !merged.discovery_key) merged.discovery_key = discoveryKey;
  const discoveryIndex = Number.isSafeInteger(identityProject?.discovery_index)
    && identityProject.discovery_index >= 0
    ? identityProject.discovery_index
    : (Number.isSafeInteger(merged.discovery_index) && merged.discovery_index >= 0
      ? merged.discovery_index
      : projectIndex);
  merged.discovery_index = discoveryIndex;
  return merged;
}

function mergeCollectorProjectIdentityResponse(projects, source) {
  return projects.map((project, projectIndex) => {
    const item = collectorProjectIdentityResponseItem(source.projects, projectIndex, projects.length);
    return item ? mergeCollectorProjectIdentity(project, item, projectIndex) : project;
  });
}

function collectorProjectIdentityState(pending, projects, fields = {}) {
  const resolution = collectProjectMetadataResolution({ projects });
  const stateFields = {
    projectIdentityResolutionStarted: fields.project_identity_resolution_started
      ?? collectorWindowState.projectIdentityResolutionStarted,
    projectIdentityResolutionCompleted: fields.project_identity_resolution_completed
      ?? collectorWindowState.projectIdentityResolutionCompleted,
    nonNavigationResolvedCount: Number.isSafeInteger(fields.non_navigation_resolved_count)
      ? fields.non_navigation_resolved_count
      : collectorWindowState.nonNavigationResolvedCount,
    navigationResolvedCount: Number.isSafeInteger(fields.navigation_resolved_count)
      ? fields.navigation_resolved_count
      : collectorWindowState.navigationResolvedCount,
    identityUnresolvedCount: resolution.unresolvedCount,
    currentProjectIndex: Number.isSafeInteger(fields.current_project_index)
      ? fields.current_project_index
      : collectorWindowState.currentProjectIndex,
    identityResolutionMethod: fields.resolution_method || collectorWindowState.identityResolutionMethod,
    navigationTargetVerified: typeof fields.navigation_target_verified === "boolean"
      ? fields.navigation_target_verified
      : collectorWindowState.navigationTargetVerified,
    projectUrlPatternValid: typeof fields.project_url_pattern_valid === "boolean"
      ? fields.project_url_pattern_valid
      : collectorWindowState.projectUrlPatternValid,
    projectIdUrlMatch: typeof fields.project_id_url_match === "boolean"
      ? fields.project_id_url_match
      : collectorWindowState.projectIdUrlMatch
  };
  collectorWindowState = { ...collectorWindowState, ...stateFields };
  return resolution;
}

function recordCollectorProjectIdentityResolution(
  eventName,
  pending,
  projects,
  fields = {}) {
  const resolution = collectorProjectIdentityState(pending, projects, fields);
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    project_identity_resolution_started: collectorWindowState.projectIdentityResolutionStarted,
    project_identity_resolution_completed: collectorWindowState.projectIdentityResolutionCompleted,
    non_navigation_resolved_count: collectorWindowState.nonNavigationResolvedCount,
    navigation_resolved_count: collectorWindowState.navigationResolvedCount,
    unresolved_count: resolution.unresolvedCount,
    discovered_project_count: resolution.discoveredCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    current_project_index: collectorWindowState.currentProjectIndex,
    resolution_method: collectorWindowState.identityResolutionMethod,
    navigation_target_verified: collectorWindowState.navigationTargetVerified,
    project_url_pattern_valid: collectorWindowState.projectUrlPatternValid,
    project_id_url_match: collectorWindowState.projectIdUrlMatch,
    status: fields.status || "observed",
    stage: fields.stage || "collector_project_identity_resolution",
    target_tab_id: pending?.tabId
  };
  diagnostic(eventName, { ...base, ...fields });
  return resolution;
}

function collectorProjectIdentityFromTab(tab) {
  const projectUrl = safeChatGptProjectUrl(tab?.url);
  const projectId = chatGptProjectId(projectUrl);
  if (!projectUrl || !projectId) return null;
  return { projectId, projectUrl };
}

async function waitForCollectorProjectIdentityTab(tabId, timeoutMs = COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS) {
  const deadline = Date.now() + Math.max(250, Math.min(30000, Number(timeoutMs) || 10000));
  while (Date.now() <= deadline) {
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch (_) { return null; }
    const identity = collectorProjectIdentityFromTab(tab);
    const loading = typeof tab?.status === "string" && tab.status !== "complete";
    if (identity && !loading) return identity;
    await wait(Math.min(100, Math.max(0, deadline - Date.now())));
  }
  return null;
}

async function resolveCollectorProjectIdentities(tab, pending, request, rootResult) {
  throwIfCollectorRequestSuperseded(pending);
  const discovery = projectDiscoveryStateFor(pending);
  const sourceProjects = Array.isArray(pending.projectIdentityResult?.projects)
    ? pending.projectIdentityResult.projects
    : rootResult.projects;
  let projects = sourceProjects.map((project, index) =>
    collectorProjectIdentityDescriptor(project, index));
  const initialResolution = collectProjectMetadataResolution({ projects });
  const initialUnresolvedIndexes = initialResolution.items
    .filter((item) => !item.resolved)
    .map((item) => item.projectIndex);

  recordCollectorProjectIdentityResolution(
    "collector project identity resolution started",
    pending,
    projects,
    {
      project_identity_resolution_started: true,
      project_identity_resolution_completed: false,
      current_project_index: -1,
      resolution_method: "dom",
      navigation_target_verified: false,
      project_url_pattern_valid: false,
      project_id_url_match: false,
      status: "started",
      stage: "collector_project_identity_resolution_start"
    });

  // Projects that already carry a verified ID + canonical URL are resolved
  // by the metadata received from the discovery pass. Count them as the
  // non-navigation portion of identity resolution even when no DOM resolver
  // message is needed for this refresh.
  let nonNavigationResolvedCount = initialResolution.resolvedCount;
  let navigationResolvedCount = 0;
  let domChecked = initialResolution.resolvedCount > 0;
  if (initialUnresolvedIndexes.length > 0) {
    const domResult = await dispatchToContentScript(tab.id, {
      type: "GET_CHATGPT_CONTEXT",
      requestId: pending.requestId,
      mode: "list",
      collection: "project_identity",
      identityMode: "dom",
      projects,
      navigationTimeoutMs: 10000
    }, request, {
      timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
      timeoutStage: "collector_project_identity_dom_timeout"
    });
    throwIfCollectorRequestSuperseded(pending);
    validateCollectorProjectIdentityResponse(domResult, pending);
    const beforeDom = projects;
    projects = mergeCollectorProjectIdentityResponse(projects, domResult);
    nonNavigationResolvedCount += projects.reduce((count, project, index) =>
      count + (!collectorProjectTarget(beforeDom[index]) && collectorProjectTarget(project) ? 1 : 0), 0);
    domChecked = true;
    pending.projectIdentityResult = {
      ...rootResult,
      projects,
      unresolved_project_count: collectProjectMetadataResolution({ projects }).unresolvedCount
    };
    recordCollectorProjectIdentityResolution(
      "collector project identity DOM resolution observed",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: 0,
        current_project_index: -1,
        resolution_method: "dom",
        navigation_target_verified: false,
        project_url_pattern_valid: false,
        project_id_url_match: false,
        status: "observed",
        stage: "collector_project_identity_dom"
      });
  }

  let unresolvedIndexes = collectProjectMetadataResolution({ projects }).items
    .filter((item) => !item.resolved)
    .map((item) => item.projectIndex);
  for (const projectIndex of unresolvedIndexes) {
    throwIfCollectorRequestSuperseded(pending);
    const descriptor = collectorProjectIdentityDescriptor(projects[projectIndex], projectIndex);
    tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
      request_id: pending.requestId,
      project_index: projectIndex,
      total_projects: projects.length,
      project_discovery_completed: false,
      project_discovery_scan_completed: true,
      project_discovery_run_id: discovery.runId,
      project_discovery_result_received: true,
      stage: "collector_project_identity_root_navigation"
    });
    tab = await ensureCollectorReady(tab, {
      request_id: pending.requestId,
      project_index: projectIndex,
      total_projects: projects.length,
      stage: "collector_project_identity_root_ready"
    });
    pending.tabId = tab.id;
    collectorWindowState = {
      ...collectorWindowState,
      currentProjectIndex: projectIndex,
      identityResolutionMethod: "navigation",
      navigationTargetVerified: false,
      projectUrlPatternValid: false,
      projectIdUrlMatch: false
    };
    diagnostic("collector project identity navigation started", {
      request_id: pending.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      project_index: projectIndex,
      total_projects: projects.length,
      resolution_method: "navigation",
      status: "started",
      stage: "collector_project_identity_navigation_start",
      target_tab_id: tab.id
    });

    let identityResult;
    try {
      identityResult = await dispatchToContentScript(tab.id, {
        type: "GET_CHATGPT_CONTEXT",
        requestId: pending.requestId,
        mode: "list",
        collection: "project_identity",
        identityMode: "navigation",
        projects: [descriptor],
        navigationTimeoutMs: 10000
      }, request, {
        timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
        timeoutStage: "collector_project_identity_navigation_timeout",
        // A full page navigation can close the message port after the row
        // click. Do not blindly replay the click; inspect the resulting tab
        // URL below and let the Content Script's route check be idempotent.
        retryMissingContentScript: false
      });
    } catch (error) {
      // A full navigation can close the Content Script message port before
      // tabs.update/onUpdated has exposed the final URL to this turn. Poll
      // the exact Collector Tab until navigation is complete before deciding
      // whether the click succeeded. This avoids replaying a click that was
      // already accepted by ChatGPT.
      const fromTab = await waitForCollectorProjectIdentityTab(
        tab.id,
        COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS);
      identityResult = fromTab
        ? {
          type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
          requestId: pending.requestId,
          mode: "list",
          status: "ok",
          projects: [{ ...descriptor, project_id: fromTab.projectId, url: fromTab.projectUrl }],
          conversations: [],
          current: null,
          navigation_target_verified: true,
          project_url_pattern_valid: true,
          project_id_url_match: true
        }
        : {
          // Keep the normal identity-validation path for a navigation that
          // landed on a non-Project route (or disappeared). It records the
          // unresolved metadata and returns context_projects_incomplete,
          // without replaying the click or inventing an ID.
          type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
          requestId: pending.requestId,
          mode: "list",
          status: "ok",
          projects: [descriptor],
          conversations: [],
          current: null,
          navigation_target_verified: false,
          project_url_pattern_valid: false,
          project_id_url_match: false
        };
    }
    throwIfCollectorRequestSuperseded(pending);
    validateCollectorProjectIdentityResponse(identityResult, pending);
    const beforeNavigation = projects;
    projects = mergeCollectorProjectIdentityResponse(projects, identityResult);
    const target = collectorProjectTarget(projects[projectIndex]);
    const navigationResolved = !collectorProjectTarget(beforeNavigation[projectIndex]) && Boolean(target);
    if (!target) {
      const failedResolution = collectProjectMetadataResolution({ projects });
      recordCollectorProjectMetadataResolution({ projects }, pending);
      recordCollectorProjectMetadataResolutionFailure(
        failedResolution,
        pending,
        "context_projects_incomplete");
      recordCollectorProjectIdentityResolution(
        "collector project identity navigation failed",
        pending,
        projects,
        {
          project_identity_resolution_started: true,
          project_identity_resolution_completed: false,
          non_navigation_resolved_count: nonNavigationResolvedCount,
          navigation_resolved_count: navigationResolvedCount,
          current_project_index: projectIndex,
          resolution_method: "navigation",
          navigation_target_verified: identityResult.navigation_target_verified === true,
          project_url_pattern_valid: identityResult.project_url_pattern_valid === true,
          project_id_url_match: identityResult.project_id_url_match === true,
          status: "error",
          error_code: "context_projects_incomplete",
          stage: "collector_project_identity_navigation_failed"
        });
      throw bridgeError(
        "ChatGPT ProjectのStable ID / URLを取得できませんでした。",
        0,
        "context_projects_incomplete");
    }
    if (navigationResolved) navigationResolvedCount += 1;
    pending.projectIdentityResult = {
      ...rootResult,
      projects,
      unresolved_project_count: collectProjectMetadataResolution({ projects }).unresolvedCount
    };
    recordCollectorProjectIdentityResolution(
      "collector project identity navigation resolved",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: navigationResolvedCount,
        current_project_index: projectIndex,
        resolution_method: "navigation",
        navigation_target_verified: identityResult.navigation_target_verified !== false,
        project_url_pattern_valid: identityResult.project_url_pattern_valid !== false,
        project_id_url_match: identityResult.project_id_url_match !== false,
        status: "resolved",
        stage: "collector_project_identity_navigation_resolved"
      });
    // Always return to the discovery/root page before attempting the next
    // confirmed Project row. This is identity resolution only; Project
    // discovery itself is not re-entered.
    tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
      request_id: pending.requestId,
      project_index: projectIndex,
      total_projects: projects.length,
      project_discovery_completed: false,
      project_discovery_scan_completed: true,
      project_discovery_run_id: discovery.runId,
      stage: "collector_project_identity_root_restore"
    });
    pending.tabId = tab.id;
    unresolvedIndexes = collectProjectMetadataResolution({ projects }).items
      .filter((item) => !item.resolved)
      .map((item) => item.projectIndex);
  }

  const finalResolution = collectProjectMetadataResolution({ projects });
  if (finalResolution.unresolvedCount > 0) {
    recordCollectorProjectIdentityResolution(
      "collector project identity resolution failed",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: navigationResolvedCount,
        current_project_index: collectorWindowState.currentProjectIndex,
        resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
        status: "error",
        error_code: "context_projects_incomplete",
        stage: "collector_project_identity_resolution_failed"
      });
    throw bridgeError(
      "ChatGPT ProjectのStable ID / URLを完全には取得できませんでした。",
      0,
      "context_projects_incomplete");
  }

  collectorWindowState = {
    ...collectorWindowState,
    currentProjectIndex: -1,
    identityResolutionMethod: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
    navigationTargetVerified: navigationResolvedCount > 0
      ? collectorWindowState.navigationTargetVerified
      : false,
    projectUrlPatternValid: finalResolution.items.every((item) => item.resolved),
    projectIdUrlMatch: finalResolution.items.every((item) => item.resolved)
  };
  recordCollectorProjectIdentityResolution(
    "collector project identity resolution completed",
    pending,
    projects,
    {
      project_identity_resolution_started: true,
      project_identity_resolution_completed: true,
      non_navigation_resolved_count: nonNavigationResolvedCount,
      navigation_resolved_count: navigationResolvedCount,
      unresolved_count: 0,
      current_project_index: -1,
      resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
      navigation_target_verified: navigationResolvedCount > 0
        ? collectorWindowState.navigationTargetVerified
        : false,
      project_url_pattern_valid: true,
      project_id_url_match: true,
      status: "completed",
      stage: "collector_project_identity_resolution_complete"
    });
  return {
    ...rootResult,
    projects,
    unresolved_project_count: 0,
    project_identity_resolution_started: true,
    project_identity_resolution_completed: true,
    non_navigation_resolved_count: nonNavigationResolvedCount,
    navigation_resolved_count: navigationResolvedCount,
    unresolved_count: 0,
    resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
    navigation_target_verified: navigationResolvedCount > 0
      ? collectorWindowState.navigationTargetVerified
      : false,
    project_url_pattern_valid: true,
    project_id_url_match: true
  };
}

function validateCollectorProjectResult(source, pending) {
  validateCollectorRootResult(source, pending);
  if (source.sidebar_scroll_complete === true) return;
  diagnostic("collector project sidebar scan incomplete", {
    request_id: pending.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending.tabId,
    current_project_id: pending.currentProjectId,
    sidebar_scroll_top: source.sidebar_scroll_top,
    sidebar_scroll_height: source.sidebar_scroll_height,
    sidebar_client_height: source.sidebar_client_height,
    sidebar_can_scroll: source.sidebar_can_scroll === true,
    sidebar_at_bottom: source.sidebar_at_bottom === true,
    visible_project_rows: source.visible_project_rows,
    discovered_project_count: source.discovered_project_count,
    project_section_found: source.project_section_found === true,
    no_growth_count: source.no_growth_count,
    sidebar_scroll_complete: false,
    status: "error",
    error_code: "context_projects_incomplete",
    stage: "collector_project_sidebar_scan_incomplete",
    target_tab_id: pending.tabId
  });
  throw bridgeError(
    "ChatGPT Project内のChat一覧を完全には取得できませんでした。",
    0,
    "context_projects_incomplete");
}

async function collectProjectsOnce(tab, pending, request) {
  throwIfCollectorRequestSuperseded(pending);
  const rootResult = await dispatchToContentScript(tab.id, {
    type: "GET_CHATGPT_CONTEXT",
    requestId: pending.requestId,
    mode: "list",
    collection: "root",
    maxScrolls: COLLECTOR_PROJECT_SCROLL_MAX,
    // Project discovery reuses the established metadata-only Sidebar scan.
    // An explicitly labelled "さらに表示/もっと見る" control may be
    // expanded so virtualized Project metadata can appear. It is not a
    // Project candidate and is never used to infer an ID; generic Sidebar
    // rows remain non-clickable.
    maxMoreClicks: 12,
    allowSidebarControls: true,
    timeoutMs: COLLECTOR_ROOT_TIMEOUT_MS,
    projectDiscoverySource: "existing_project_section_metadata"
  }, request, {
    timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
    timeoutStage: "collector_content_script_timeout"
  });
  // A newer Refresh may supersede this request while the Content Script was
  // scanning. Do not let that old response update Collector telemetry or
  // become the input to metadata resolution even if the Chrome message call
  // itself completed successfully.
  throwIfCollectorRequestSuperseded(pending);
  recordCollectorProjectDiscoveryResult(rootResult, pending);
  // Validate only the response envelope and correlation here. Project
  // identity resolution belongs to the orchestration layer, after this
  // completed Sidebar scan has handed its immutable arrays to Background.
  validateCollectorRootResult(rootResult, pending);
  recordCollectorScrollTelemetry(rootResult, pending, {
    project_index: -1,
    stage: "collector_root_sidebar_scan"
  });

  if (rootResult.sidebar_scroll_complete === true
    && rootResult.project_section_found === true) {
    return rootResult;
  }

  diagnostic("collector root sidebar scan incomplete", {
    request_id: pending.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending.tabId,
    sidebar_scroll_top: rootResult.sidebar_scroll_top,
    sidebar_scroll_height: rootResult.sidebar_scroll_height,
    sidebar_client_height: rootResult.sidebar_client_height,
    sidebar_can_scroll: rootResult.sidebar_can_scroll === true,
    sidebar_at_bottom: rootResult.sidebar_at_bottom === true,
    visible_project_rows: rootResult.visible_project_rows,
    discovered_project_count: rootResult.projects.length,
    content_discovered_project_count: rootResult.discovered_project_count,
    project_section_found: rootResult.project_section_found === true,
    no_growth_count: rootResult.no_growth_count,
    sidebar_scroll_complete: rootResult.sidebar_scroll_complete === true,
    status: "error",
    error_code: "context_projects_incomplete",
    stage: "collector_root_sidebar_scan_incomplete",
    target_tab_id: pending.tabId
  });
  throw bridgeError("ChatGPT Projectを取得できませんでした。", 0, "context_projects_incomplete");
}

function collectCollectorRootResult(tab, pending, request, caller = "refresh_orchestration") {
  const discovery = projectDiscoveryStateFor(pending);
  if (discovery.completed && discovery.result) {
    discovery.alreadyCompleted = true;
    recordProjectDiscoveryTelemetry("collector project discovery duplicate suppressed", pending, {
      project_discovery_caller: caller,
      status: "suppressed",
      stage: "collector_project_discovery_already_completed",
      target_tab_id: pending.tabId
    });
    return Promise.resolve(discovery.result);
  }
  if (discovery.inFlight && discovery.promise) {
    recordProjectDiscoveryTelemetry("collector project discovery in-flight duplicate suppressed", pending, {
      project_discovery_caller: caller,
      status: "suppressed",
      stage: "collector_project_discovery_in_flight",
      target_tab_id: pending.tabId
    });
    return discovery.promise;
  }

  const scanAlreadyCompleted = discovery.scanCompleted === true
    && pending.projectDiscoveryScanResult
    && Array.isArray(pending.projectDiscoveryScanResult.projects);
  if (!scanAlreadyCompleted) {
    discovery.callCount += 1;
    discovery.started = true;
    discovery.caller = caller;
    discovery.inFlight = true;
    discovery.alreadyCompleted = false;
    recordProjectDiscoveryTelemetry("collector project discovery started", pending, {
      project_discovery_caller: caller,
      status: "started",
      stage: "collector_project_discovery_start",
      target_tab_id: pending.tabId
    });
  } else {
    discovery.inFlight = true;
    discovery.caller = caller;
    recordProjectDiscoveryTelemetry("collector project identity resolution resumed", pending, {
      project_discovery_caller: caller,
      status: "resumed",
      stage: "collector_project_identity_resolution_resumed",
      target_tab_id: pending.tabId
    });
  }

  const runPromise = (async () => {
    try {
      const rootResult = scanAlreadyCompleted
        ? pending.projectDiscoveryScanResult
        : await collectProjectsOnce(tab, pending, request);
      throwIfCollectorRequestSuperseded(pending);
      const resultShape = pending.collectorProjectDiscoveryResultShape
        || recordCollectorProjectDiscoveryResult(rootResult, pending);
      const projectDataLostBetweenLayers = resultShape.contentDiscoveredProjectCount !== null
        && resultShape.contentDiscoveredProjectCount > resultShape.backgroundProjectsLength;
      if (projectDataLostBetweenLayers || rootResult.projects.length === 0) {
        const errorCode = "context_projects_incomplete";
        const projectResolution = collectProjectMetadataResolution(rootResult);
        recordCollectorProjectMetadataResolutionFailure(projectResolution, pending, errorCode);
        diagnostic("collector project result handoff incomplete", {
          request_id: pending.requestId,
          refresh_generation: projectDiscoveryStateFor(pending).refreshGeneration,
          project_discovery_run_id: projectDiscoveryStateFor(pending).runId,
          project_discovery_call_count: projectDiscoveryStateFor(pending).callCount,
          project_discovery_result_received: true,
          discovered_project_count: rootResult.projects.length,
          background_projects_length: resultShape.backgroundProjectsLength,
          content_discovered_project_count: resultShape.contentDiscoveredProjectCount,
          response_shape: resultShape.responseShape,
          status: "error",
          error_code: projectDataLostBetweenLayers
            ? "collector_project_result_handoff_mismatch"
            : errorCode,
          stage: "collector_project_result_handoff_incomplete",
          target_tab_id: pending.tabId
        });
        throw bridgeError(
          projectDataLostBetweenLayers
            ? "ChatGPT Projectのmetadataを完全には取得できませんでした。"
            : "ChatGPT Projectを取得できませんでした。",
          0,
          errorCode);
      }
      if (!scanAlreadyCompleted) {
        discovery.scanCompleted = true;
        pending.projectDiscoveryScanResult = rootResult;
        pending.projectIdentityResult = null;
        recordProjectDiscoveryTelemetry("collector project discovery scan completed", pending, {
          project_discovery_caller: caller,
          project_discovery_scan_completed: true,
          status: "completed",
          stage: "collector_project_discovery_scan_complete",
          discovered_project_count: rootResult.projects.length,
          discovered_chat_count: rootResult.conversations.length,
          target_tab_id: pending.tabId
        });
      }
      const resolvedRootResult = await resolveCollectorProjectIdentities(
        tab,
        pending,
        request,
        rootResult);
      throwIfCollectorRequestSuperseded(pending);
      const projectResolution = recordCollectorProjectMetadataResolution(resolvedRootResult, pending);
      const unresolvedProjectCount = validateCollectorRootResult(resolvedRootResult, pending);
      if (unresolvedProjectCount > 0) {
        recordCollectorProjectMetadataResolutionFailure(
          projectResolution,
          pending,
          "context_projects_incomplete");
        throw bridgeError(
          "ChatGPT Projectのmetadataを完全には取得できませんでした。",
          0,
          "context_projects_incomplete");
      }
      discovery.result = resolvedRootResult;
      discovery.completed = true;
      pending.projectDiscoveryResult = resolvedRootResult;
      pending.projectIdentityResult = resolvedRootResult;
      discovery.inFlight = false;
      recordProjectDiscoveryTelemetry("collector project discovery completed", pending, {
        project_discovery_caller: caller,
        status: "completed",
        stage: "collector_project_discovery_complete",
        discovered_project_count: rootResult.projects.length,
        discovered_chat_count: rootResult.conversations.length,
        target_tab_id: pending.tabId
      });
      return resolvedRootResult;
    } catch (error) {
      discovery.result = null;
      discovery.completed = false;
      discovery.inFlight = false;
      recordProjectDiscoveryTelemetry("collector project discovery failed", pending, {
        project_discovery_caller: caller,
        status: "error",
        error_code: error?.code || "context_projects_incomplete",
        stage: error?.stage || "collector_project_discovery_failed",
        target_tab_id: pending.tabId
      });
      throw error;
    } finally {
      if (discovery.promise === runPromise) discovery.promise = null;
      syncProjectDiscoveryTelemetry(pending, discovery);
    }
  })();
  discovery.promise = runPromise;
  return runPromise;
}

async function collectCompleteChatGptContext(tab, pending, request) {
  throwIfCollectorRequestSuperseded(pending);
  const aggregate = {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: pending.requestId,
    mode: "list",
    status: "ok",
    projects: [],
    conversations: [],
    current: null
  };
  // Project discovery is completed by the refresh orchestration before this
  // function is entered. Chat retries resume from that immutable catalog and
  // must never re-enter Project discovery merely because a later Project-page
  // Chat scan or navigation failed.
  const rootResult = pending.projectDiscoveryResult;
  const discovery = projectDiscoveryStateFor(pending);
  if (!rootResult || !discovery.completed || discovery.result !== rootResult) {
    diagnostic("collector Project navigation blocked before discovery", {
      request_id: pending.requestId,
      refresh_generation: discovery.refreshGeneration,
      project_discovery_run_id: discovery.runId,
      project_discovery_call_count: discovery.callCount,
      project_discovery_completed: discovery.completed,
      project_discovery_result_received: Boolean(rootResult),
      status: "error",
      error_code: "collector_project_navigation_before_discovery",
      stage: "collector_project_navigation_guard",
      target_tab_id: pending.tabId
    });
    throw bridgeError(
      "ChatGPT Project metadataが確定していません。",
      0,
      "context_projects_incomplete");
  }
  mergeCollectorMetadata(aggregate, rootResult);
  throwIfCollectorRequestSuperseded(pending);
  collectorWindowLifecycle("CollectingProjects", {
    tabId: tab.id,
    currentProjectId: null,
    currentProjectUrl: null,
    collectorNavigationTarget: null,
    projectDiscoverySource: rootResult.project_discovery_source
      || collectorWindowState.projectDiscoverySource,
    projectIndex: -1,
    totalProjects: aggregate.projects.length,
    discoveredProjectCount: aggregate.projects.length,
    discoveredChatCount: aggregate.conversations.length
  });

  const projects = aggregate.projects.slice(0, COLLECTOR_MAX_PROJECTS);
  for (let index = 0; index < projects.length; index += 1) {
    throwIfCollectorRequestSuperseded(pending);
    const target = collectorProjectTarget(projects[index]);
    collectorWindowLifecycle("CollectingProject", {
      tabId: tab.id,
      currentProjectId: target?.projectId || null,
      currentProjectUrl: target?.projectUrl || null,
      collectorNavigationTarget: target?.projectUrl || null,
      projectIndex: index,
      totalProjects: projects.length,
      discoveredProjectCount: aggregate.projects.length,
      discoveredChatCount: aggregate.conversations.length
    });
    if (!target) {
      diagnostic("collector project identity invalid", {
        request_id: pending.requestId,
        project_index: index,
        total_projects: projects.length,
        status: "error",
        error_code: "context_projects_incomplete",
        stage: "collector_project_identity_missing"
      });
      throw bridgeError(
        "ChatGPT ProjectのIDまたはURLを取得できませんでした。",
        0,
        "context_projects_incomplete");
    }
    tab = await navigateCollectorTab(
      await ensureCollectorWindow(COLLECTOR_TAB_URL, {
        request_id: pending.requestId,
        project_id: target.projectId,
        project_index: index,
        total_projects: projects.length,
        project_discovery_completed: true,
        project_discovery_run_id: discovery.runId,
        project_discovery_result_received: true,
        stage: "collector_project_navigation"
      }),
      target.projectUrl,
      {
        request_id: pending.requestId,
        project_id: target.projectId,
        project_index: index,
        total_projects: projects.length,
        project_discovery_completed: true,
        project_discovery_run_id: discovery.runId,
        project_discovery_result_received: true,
        stage: "collector_project_navigation"
      });
    tab = await reconcileCollectorWindowTabs(
      collectorWindowState.windowId,
      tab.id,
      {
        request_id: pending.requestId,
        project_id: target.projectId,
        project_index: index,
        total_projects: projects.length,
        stage: "collector_project_tab_reconciled"
      });
    if (!tab) {
      throw bridgeError(
        "Collector Window内のCollector Tabを確認できません。",
        0,
        "collector_tab_count_invalid");
    }
    tab = await enforceCollectorTab(tab, {
      request_id: pending.requestId,
      project_id: target.projectId,
      project_index: index,
      total_projects: projects.length,
      stage: "collector_project_tab_enforced"
    });
    pending.tabId = tab.id;
    throwIfCollectorRequestSuperseded(pending);
    const projectResult = await dispatchToContentScript(tab.id, {
      type: "GET_CHATGPT_CONTEXT",
      requestId: pending.requestId,
      mode: "list",
      collection: "project",
      projectId: target.projectId,
      maxScrolls: COLLECTOR_PROJECT_SCROLL_MAX,
      timeoutMs: COLLECTOR_PROJECT_TIMEOUT_MS
    }, request, {
      timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
      timeoutStage: "collector_project_content_script_timeout"
    });
    throwIfCollectorRequestSuperseded(pending);
    pending.currentProjectId = target.projectId;
    validateCollectorProjectResult(projectResult, pending);
    recordCollectorScrollTelemetry(projectResult, pending, {
      project_id: target.projectId,
      project_index: index,
      stage: "collector_project_sidebar_scan"
    });
    mergeCollectorMetadata(aggregate, projectResult, target.projectId);
    collectorWindowLifecycle("CollectingProject", {
      tabId: tab.id,
      currentProjectId: target.projectId,
      currentProjectUrl: target.projectUrl,
      collectorNavigationTarget: target.projectUrl,
      projectIndex: index,
      totalProjects: projects.length,
      discoveredProjectCount: aggregate.projects.length,
      discoveredChatCount: aggregate.conversations.length
    });
  }
  collectorWindowLifecycle("Collected", {
    tabId: tab.id,
    currentProjectId: null,
    currentProjectUrl: null,
    collectorNavigationTarget: null,
    projectIndex: projects.length,
    totalProjects: projects.length,
    discoveredProjectCount: aggregate.projects.length,
    discoveredChatCount: aggregate.conversations.length
  });
  return aggregate;
}

async function collectContextWithRecovery(tab, pending, request) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      throwIfCollectorRequestSuperseded(pending);
      if (attempt > 0) {
        collectorWindowLifecycle("Recovering", {
          retryCount: attempt,
          currentProjectId: null,
          projectIndex: -1
        });
        tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, {
          request_id: pending.requestId,
          retry_count: attempt
        });
        pending.tabId = tab.id;
        pending.collectorWindowId = collectorWindowState.windowId;
        pending.collectorMediumLost = false;
        pending.collectorMediumLossReason = null;
      }
      tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
        request_id: pending.requestId,
        retry_count: attempt,
        stage: "collector_root_navigation"
      });
      pending.tabId = tab.id;
      tab = await ensureCollectorReady(tab, {
        request_id: pending.requestId,
        retry_count: attempt,
        stage: "collector_viewport_required"
      });
      pending.tabId = tab.id;
      pending.collectorWindowId = collectorWindowState.windowId;
      if (!pending.currentOnly
        && (!pending.projectDiscoveryResult || !projectDiscoveryStateFor(pending).completed)) {
        // This is the single explicit Project discovery entry point for the
        // current Refresh generation. Recovery after a completed root scan
        // skips it and reuses pending.projectDiscoveryResult.
        await collectCollectorRootResult(tab, pending, request, "refresh_orchestration");
      }
      return await collectCompleteChatGptContext(tab, pending, request);
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) throw error;
      lastError = error;
      const terminalError = [
        "context_projects_incomplete",
        "collector_viewport_too_narrow",
        "collector_sidebar_not_ready",
        "collector_viewport_resize_failed"
      ].includes(error?.code);
      // A failed metadata scan is one-shot. The only permitted second Project
      // scan is a genuine Collector medium loss reported by the Chrome
      // lifecycle listeners while that scan was in flight. Ordinary DOM
      // readiness/retry paths must surface the error instead of starting a
      // second scan and moving the Sidebar back to the top.
      const canRecover = pending.collectorMediumLost === true && attempt === 0;
      if (!canRecover || (terminalError && pending.collectorMediumLost !== true)) {
        diagnostic("collector refresh terminal failure", {
          request_id: pending.requestId,
          retry_count: attempt,
          error_code: error.code,
          status: "error",
          stage: "collector_refresh_terminal_failure",
          target_tab_id: pending.tabId
        });
        break;
      }
      collectorWindowState = { ...collectorWindowState, retryCount: attempt + 1 };
      diagnostic("collector recovery requested", {
        request_id: pending.requestId,
        retry_count: attempt + 1,
        error_code: error?.code || "collector_collection_failed",
        status: "recovering",
        stage: "collector_recovery_requested"
      });
    }
  }
  throw lastError || bridgeError("ChatGPT Context収集に失敗しました。", 0, "context_extraction_failed");
}

async function requestChatGptContext(message, bridgeSocket, currentOnly) {
  const requestId = message?.request_id;
  const request = { ...message, mode: currentOnly ? "current" : "list" };
  if (!safeContextIdentifier(requestId)) {
    const pending = { requestId: String(requestId || ""), currentOnly, bridgeSocket, tabId: null, message: request };
    sendChatGptContextResponseToBridge(
      contextResultError(request, "invalid_context_request", "ChatGPT Context requestが不正です。", "context_request_validation"),
      pending);
    return;
  }
  if (bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
    const pending = { requestId, currentOnly, bridgeSocket, tabId: null, message: request };
    sendChatGptContextResponseToBridge(
      contextResultError(request, "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection"),
      pending);
    return;
  }

  const generation = ++collectorContextGeneration;

  // Context discovery is deliberately isolated from execution. A single
  // active tab inside the connector-owned Collector Window is reused for the
  // root sidebar scan and every Project page; it is never reused as the
  // Managed Execution Tab or a user's foreground tab.
  await withCollectorWindowOperation(async () => {
    let tab = null;
    const pending = {
      requestId,
      currentOnly,
      bridgeSocket,
      tabId: null,
      collectorWindowId: null,
      collectorMediumLost: false,
      collectorMediumLossReason: null,
      projectDiscoveryResult: null,
      projectDiscoveryScanResult: null,
      projectIdentityResult: null,
      message: request,
      generation
    };
    const projectDiscovery = currentOnly ? null : projectDiscoveryStateFor(pending);
    try {
      throwIfCollectorRequestSuperseded(pending);
      if (bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
        await completeContextRequest(
          contextResultError(request, "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection"),
          pending);
        return;
      }
      collectorWindowState = {
        ...collectorWindowState,
        requestId,
        refreshGeneration: generation,
        retryCount: 0,
        projectDiscoveryRetryCount: 0,
        projectDiscoveryRunId: projectDiscovery?.runId || null,
        projectDiscoveryCallCount: projectDiscovery?.callCount || 0,
        projectDiscoveryStarted: projectDiscovery?.started === true,
        projectDiscoveryCompleted: projectDiscovery?.completed === true,
        projectDiscoveryScanCompleted: projectDiscovery?.scanCompleted === true,
        projectDiscoveryCaller: projectDiscovery?.caller || null,
        projectDiscoveryInFlight: projectDiscovery?.inFlight === true,
        projectDiscoveryAlreadyCompleted: false,
        projectDiscoveryScrollDirection: null,
        projectDiscoveryRestoreCount: 0,
        viewportRetryCount: 0,
        windowWidth: null,
        windowHeight: null,
        contentInnerWidth: null,
        contentInnerHeight: null,
        sidebarExpectedVisible: false,
        activeTabIdInWindow: null,
        collectorTabActive: false,
        tabCountInWindow: 0,
        sidebarScrollTop: null,
        sidebarScrollHeight: null,
        sidebarClientHeight: null,
        sidebarCanScroll: false,
        sidebarAtBottom: false,
        visibleProjectRows: 0,
        projectSectionFound: false,
        noGrowthCount: 0,
        currentProjectId: null,
        projectIndex: -1,
        projectDiscoverySource: "existing_project_section_metadata",
        currentProjectUrl: null,
        collectorNavigationTarget: null,
        totalProjects: 0,
        discoveredProjectCount: 0,
        discoveredChatCount: 0,
        projectIdentityResolutionStarted: false,
        projectIdentityResolutionCompleted: false,
        nonNavigationResolvedCount: 0,
        navigationResolvedCount: 0,
        identityUnresolvedCount: 0,
        currentProjectIndex: -1,
        identityResolutionMethod: null,
        navigationTargetVerified: false,
        projectUrlPatternValid: false,
        projectIdUrlMatch: false
      };
      tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, {
        request_id: requestId,
        stage: currentOnly ? "context_current_requested" : "context_list_requested"
      });
      // Full refreshes enter collectContextWithRecovery with the existing
      // Collector Tab still on whatever page the previous scan used. That
      // orchestration step is the single owner of the root navigation. Do
      // not navigate here as well; doing so both duplicated the transition
      // and made a root return look like Project navigation in telemetry.
      if (currentOnly) {
        tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
          request_id: requestId,
          stage: "context_current_navigation"
        });
      }
      pending.tabId = tab.id;
      pending.collectorWindowId = collectorWindowState.windowId;
      contextRequests.set(requestId, pending);
      diagnostic("chatgpt.context request dispatched", {
        request_id: requestId,
        status: "requested",
        stage: currentOnly ? "context_current_requested" : "context_list_requested",
        target_tab_id: tab.id,
        collector_window_id: collectorWindowState.windowId,
        collector_tab_id: tab.id
      });
      const contentResult = pending.currentOnly
        ? await dispatchToContentScript(tab.id, {
          type: "GET_CHATGPT_CONTEXT",
          requestId,
          mode: "current",
          collection: "root"
        }, request, {
          timeoutMs: CONTENT_SCRIPT_TIMEOUT_MS,
          timeoutStage: "collector_content_script_timeout"
        })
        : await collectContextWithRecovery(tab, pending, request);
      throwIfCollectorRequestSuperseded(pending);
      await completeContextRequest(contentResult, pending);
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) {
        if (contextRequests.get(requestId) === pending) contextRequests.delete(requestId);
        diagnostic("chatgpt.context request superseded", {
          request_id: requestId,
          status: "discarded",
          error_code: "context_refresh_superseded",
          stage: "context_request_superseded",
          target_tab_id: pending.tabId
        });
        return;
      }
      const errorCode = error?.code || "context_extraction_failed";
      const errorStage = error?.stage || "context_content_script_dispatch";
      if (!contextRequests.has(requestId)) {
        sendChatGptContextResponseToBridge(
          contextResultError(request, errorCode, "ChatGPT Context収集に失敗しました。", errorStage),
          pending);
      } else {
        await completeContextRequest(
          contextResultError(request, errorCode, "ChatGPT Context収集に失敗しました。", errorStage),
          pending);
      }
    } finally {
      contextRequests.delete(requestId);
      // The Collector Tab is reusable, but a medium-loss recovery can replace
      // its ID while collectContextWithRecovery is running. Release the tab
      // currently owned by the pending request rather than the stale local
      // reference captured before recovery.
      if (Number.isSafeInteger(pending.tabId)) {
        try { tab = await chrome.tabs.get(pending.tabId); } catch (_) { tab = null; }
      }
      if (!tab) tab = await getCollectorTab();
      await releaseCollectorTab(tab);
    }
  });
}

async function handleContextResultFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const pending = contextRequests.get(requestId);
  if (!pending || sender?.tab?.id !== pending.tabId) {
    diagnostic("chatgpt.context response rejected", {
      request_id: requestId,
      status: "error",
      error_code: "context_response_not_correlated",
      stage: "context_response_correlation",
      target_tab_id: sender?.tab?.id
    });
    return;
  }
  await completeContextRequest(message, pending);
}

async function handleContextChangedFromContent(message, sender) {
  const context = normalizeCurrentContext(message?.context);
  const tabId = sender?.tab?.id;
  if (!context || !Number.isSafeInteger(tabId) || !isChatGptTab(sender?.tab)) {
    diagnostic("chatgpt.context current rejected", {
      status: "error",
      error_code: "invalid_current_context",
      stage: "context_current_validation",
      target_tab_id: tabId
    });
    return false;
  }

  // The conversation is the durable identity; a managed tab is only its
  // current browser medium. When ChatGPT finishes an SPA/new-chat
  // transition, bind the newly discovered conversation to the managed state
  // and to every pending watcher/send on that same managed tab.
  if (tabId === managedTabState.tabId) {
    const conversationId = context.conversation_id || managedTabState.conversationId || null;
    const conversationUrl = context.conversation_id
      ? (context.url || managedTabState.conversationUrl || null)
      : managedTabState.conversationUrl || null;
    managedTabState = {
      ...managedTabState,
      conversationId,
      conversationUrl,
      projectId: context.project_id || managedTabState.projectId || null,
      contentReady: true,
      conversationReady: Boolean(conversationId || conversationUrl),
      composerReady: managedTabState.composerReady || false
    };
    managedTabLifecycle("WaitingWatcher", {
      tabId,
      conversationId,
      conversationUrl,
      projectId: managedTabState.projectId,
      contentReady: true,
      conversationReady: managedTabState.conversationReady
    });
    for (const pending of responseWatches.values()) {
      if (pending.tabId !== tabId) continue;
      if (conversationId) pending.targetConversationId = conversationId;
      if (conversationUrl) pending.targetConversationUrl = conversationUrl;
      if (conversationUrl) pending.targetTabUrl = conversationUrl;
    }
    for (const pending of pendingHandoffSends.values()) {
      if (pending.targetTabId !== tabId) continue;
      if (conversationId) pending.targetConversationId = conversationId;
      if (conversationUrl) pending.targetConversationUrl = conversationUrl;
      if (conversationUrl) pending.targetTabUrl = conversationUrl;
    }
    diagnostic("managed conversation bound", {
      conversation_id: conversationId,
      conversation_url: conversationUrl,
      project_id: managedTabState.projectId,
      status: "bound",
      stage: "conversation_bound",
      target_tab_id: tabId
    });
  }

  if (socket?.readyState !== WebSocket.OPEN) return false;
  const envelope = {
    type: "chatgpt.context.changed",
    context
  };
  try {
    socket.send(JSON.stringify(envelope));
    diagnostic("chatgpt.context current forwarded", {
      status: "ok",
      stage: "context_current_forwarded",
      target_tab_id: tabId
    });
    return true;
  } catch (_) {
    diagnostic("chatgpt.context current failed", {
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_current_forwarded",
      target_tab_id: tabId
    });
    return false;
  }
}

function authenticatedBridgeSocket(fallbackSocket = null) {
  // A message received from the Bridge already crossed the authenticated
  // hello handshake.  It is therefore safe to reply on that same current
  // socket even if the local hello.ack bookkeeping has not run yet.  The
  // fallback is important during the very small window between the server's
  // hello.ack and the Extension's onmessage callback; without it a successful
  // ChatGPT post could be put in the outbox forever.
  if (fallbackSocket
    && fallbackSocket === socket
    && fallbackSocket.readyState === WebSocket.OPEN) {
    return fallbackSocket;
  }
  if (acknowledgedSocket
    && socket === acknowledgedSocket
    && acknowledgedSocket.readyState === WebSocket.OPEN) {
    return acknowledgedSocket;
  }
  return null;
}

function bridgeEnvelopeKey(envelope) {
  return `${envelope.type}:${envelope.request_id || ""}`;
}

function bridgeEnvelopeDiagnostic(eventName, envelope, trace = null, fields = {}) {
  diagnostic(eventName, {
    ...traceForMessage(trace),
    request_id: envelope.request_id,
    session_id: envelope.session_id,
    handoff_id: envelope.handoff_id,
    boundary_id: envelope.boundary_id,
    status: envelope.status,
    error_code: envelope.error_code,
    target_tab_id: envelope.target_tab_id,
    ...fields
  });
}

function queueBridgeEnvelope(envelope, trace = null, reason = "bridge_disconnected") {
  const key = bridgeEnvelopeKey(envelope);
  const existing = bridgeOutbox.get(key);
  // Do not retain the original Handoff object (which contains its body) just
  // for a later diagnostic. The envelope is needed for delivery; trace data is
  // reduced to the identifier-only allowlist.
  bridgeOutbox.set(key, {
    envelope,
    trace: trace ? traceForMessage(trace) : existing?.trace || null,
    sentSocket: null,
    createdAt: existing?.createdAt || Date.now()
  });
  bridgeEnvelopeDiagnostic(
    envelope.type === "handoff.result" ? "handoff.result queued" : "assistant response queued",
    envelope,
    trace,
    {
      error_code: reason,
      stage: envelope.type === "handoff.result" ? "handoff_result_queued" : "assistant_response_queued"
    }
  );
}

function flushBridgeOutbox() {
  const bridgeSocket = authenticatedBridgeSocket();
  if (!bridgeSocket) return false;

  let flushed = false;
  for (const [key, pending] of bridgeOutbox) {
    if (authenticatedBridgeSocket() !== bridgeSocket) break;
    if (pending.createdAt + BRIDGE_DELIVERY_TTL_MS <= Date.now()) {
      bridgeOutbox.delete(key);
      continue;
    }
    // The current socket already received this envelope. Wait for its
    // application-level ACK instead of creating a duplicate delivery.
    if (pending.sentSocket === bridgeSocket) continue;
    try {
      bridgeSocket.send(JSON.stringify(pending.envelope));
      pending.sentSocket = bridgeSocket;
      bridgeEnvelopeDiagnostic(
        pending.envelope.type === "handoff.result" ? "handoff.result sent" : "assistant response sent",
        pending.envelope,
        pending.trace,
        { stage: pending.envelope.stage }
      );
      if (pending.envelope.type === "assistant.response") {
        bridgeEnvelopeDiagnostic("assistant response forwarded", pending.envelope, pending.trace, {
          stage: "assistant_response_forwarded"
        });
      }
      flushed = true;
    } catch (_) {
      // Keep the envelope for the next authenticated socket. The close handler
      // schedules reconnect and does not expose body contents in diagnostics.
      break;
    }
  }
  return flushed;
}

function sendBridgeEnvelope(envelope, bridgeSocket, trace = null) {
  const key = bridgeEnvelopeKey(envelope);
  const existing = bridgeOutbox.get(key);
  const pending = existing || {
    envelope,
    trace: trace ? traceForMessage(trace) : null,
    sentSocket: null,
    createdAt: Date.now()
  };
  pending.envelope = envelope;
  if (trace) pending.trace = traceForMessage(trace);
  bridgeOutbox.set(key, pending);

  const targetSocket = authenticatedBridgeSocket(bridgeSocket);
  if (!targetSocket) {
    pending.sentSocket = null;
    queueBridgeEnvelope(envelope, trace);
    return false;
  }

  // A previous synchronous send is still awaiting the Desktop ACK. The
  // caller may be handling a duplicate lifecycle event; do not send it
  // twice on the same authenticated socket.
  if (pending.sentSocket === targetSocket) return true;

  try {
    targetSocket.send(JSON.stringify(envelope));
    pending.sentSocket = targetSocket;
    bridgeEnvelopeDiagnostic(
      envelope.type === "handoff.result" ? "handoff.result sent" : "assistant response sent",
      envelope,
      trace,
      { stage: envelope.stage }
    );
    if (envelope.type === "assistant.response") {
      bridgeEnvelopeDiagnostic("assistant response forwarded", envelope, trace, {
        stage: "assistant_response_forwarded"
      });
    }
    return true;
  } catch (_) {
    pending.sentSocket = null;
    queueBridgeEnvelope(envelope, trace, "bridge_send_failed");
    if (envelope.type === "assistant.response") {
      bridgeEnvelopeDiagnostic("assistant response delivery failed", envelope, trace, {
        status: "error",
        error_code: "bridge_disconnected",
        stage: "response_bridge_send"
      });
    }
    return false;
  }
}

function sendHandoffResultToBridge(result, bridgeSocket, trace = null) {
  return sendBridgeEnvelope(result, bridgeSocket, trace);
}

function sendAssistantResponseToBridge(response, bridgeSocket) {
  const envelope = {
    type: "assistant.response",
    request_id: response.request_id,
    session_id: response.session_id,
    handoff_id: response.handoff_id,
    boundary_id: response.boundary_id,
    status: response.status
  };
  if (response.status === "received" && typeof response.payload === "string") envelope.payload = response.payload;
  if (response.error_code) envelope.error_code = response.error_code;
  if (response.message) envelope.message = response.message;
  if (response.stage) envelope.stage = response.stage;
  if (Number.isSafeInteger(response.target_tab_id)) envelope.target_tab_id = response.target_tab_id;
  if (typeof response.target_tab_url === "string" && response.target_tab_url.length <= 2048) envelope.target_tab_url = response.target_tab_url;
  if (typeof response.target_conversation_id === "string" && response.target_conversation_id.length <= 128) {
    envelope.target_conversation_id = response.target_conversation_id;
  }
  if (typeof response.target_conversation_url === "string" && response.target_conversation_url.length <= 2048) {
    envelope.target_conversation_url = response.target_conversation_url;
  }
  return sendBridgeEnvelope(envelope, bridgeSocket);
}

function responseWatchMessageForPending(pending) {
  return {
    type: RESPONSE_WATCH_MESSAGE_TYPE,
    requestId: pending.requestId,
    sessionId: pending.sessionId,
    handoffId: pending.handoffId,
    boundaryId: pending.boundaryId,
    protocol: HANDOFF_PROTOCOL,
    targetTabId: pending.targetTabId,
    ...(pending.targetConversationId ? { targetConversationId: pending.targetConversationId } : {}),
    ...(pending.targetConversationUrl ? { targetConversationUrl: pending.targetConversationUrl } : {}),
    ...(pending.isReview ? { review: true } : {}),
    ...(pending.preSend ? { prepare: true } : {})
  };
}

function responseWatchTraceForPending(pending, fields = {}) {
  return {
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    target_tab_id: pending.targetTabId,
    ...fields
  };
}

function stopResponseWatchLifecycleTelemetry(pending) {
  if (!pending || pending.lifecycleTelemetryTimer === null) return;
  clearTimeout(pending.lifecycleTelemetryTimer);
  pending.lifecycleTelemetryTimer = null;
}

function scheduleResponseWatchLifecycleTelemetry(pending) {
  if (!pending || pending.lifecycleTelemetryTimer !== null) return;
  pending.lifecycleTelemetryTimer = setTimeout(() => {
    pending.lifecycleTelemetryTimer = null;
    if (responseWatches.get(pending.requestId) !== pending) return;
    recordManagedTabLifecycleTelemetry(
      "response_waiting_periodic",
      responseWatchTraceForPending(pending, {
        status: "waiting",
        watcher_state: pending.watcherReady ? "armed" : "requested"
      }),
      pending.tabId);
    scheduleResponseWatchLifecycleTelemetry(pending);
  }, MANAGED_TAB_LIFECYCLE_TELEMETRY_INTERVAL_MS);
  // Node-based regression tests should not be held open by an observational
  // timer. Chrome timers do not expose unref(), so production behavior is
  // unchanged.
  pending.lifecycleTelemetryTimer?.unref?.();
}

function scheduleResponseWatchRearm(pending) {
  if (!pending || pending.rearmTimer !== null || pending.rearmDeadline <= Date.now()) return;
  pending.rearmTimer = setTimeout(() => {
    pending.rearmTimer = null;
    if (responseWatches.get(pending.requestId) !== pending) return;
    void rearmResponseWatchesForTab(pending.tabId);
  }, RESPONSE_WATCH_REARM_DELAY_MS);
}

function failResponseWatch(pending, errorCode, stage, message = "ChatGPTのassistant応答監視を開始できませんでした。") {
  if (responseWatches.get(pending.requestId) !== pending) return;
  if (pending.rearmTimer !== null) {
    clearTimeout(pending.rearmTimer);
    pending.rearmTimer = null;
  }
  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(pending.requestId);
  diagnostic("assistant response watch failed", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage
  }));
  recordManagedTabLifecycleTelemetry("response_watch_failed", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage,
    assistant_state: errorCode === "response_stream_interrupted" ? "streaming" : "not_detected",
    watcher_state: "idle"
  }), pending.tabId);
  sendAssistantResponseToBridge({
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    status: "error",
    error_code: errorCode,
    message,
    stage,
    ...(pending.isReview ? {
      target_tab_id: pending.targetTabId,
      target_tab_url: pending.targetTabUrl
    } : {})
  }, pending.bridgeSocket);
}

async function rearmResponseWatchesForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return;
  const pendingWatches = [...responseWatches.values()]
    .filter((pending) => pending.tabId === tabId && !pending.watchDispatching && !pending.rearmInProgress);
  if (pendingWatches.length > 0) {
    diagnostic("content script ready with pending response watch", {
      target_tab_id: tabId,
      status: "pending",
      stage: "response_watch_rearm_scan"
    });
  }
  for (const pending of pendingWatches) {
    if (responseWatches.get(pending.requestId) !== pending) continue;
    if (pending.rearmDeadline <= Date.now()) {
      failResponseWatch(pending, "content_script_unavailable", "response_watch_rearm_timeout");
      continue;
    }

    pending.rearmInProgress = true;
    diagnostic(
      pending.isReview ? "review response watch rearm requested" : "response watch rearm requested",
      responseWatchTraceForPending(pending, {
        status: "requested",
        stage: "response_watch_rearm_requested"
      })
    );
    try {
      const watchResult = await dispatchToContentScript(
        tabId,
        responseWatchMessageForPending(pending),
        pending);
      const valid = watchResult
        && watchResult.request_id === pending.requestId
        && watchResult.session_id === pending.sessionId
        && watchResult.handoff_id === pending.handoffId
        && watchResult.boundary_id === pending.boundaryId
        && watchResult.status === "watching";
      if (valid) {
        if (pending.rearmTimer !== null) {
          clearTimeout(pending.rearmTimer);
          pending.rearmTimer = null;
        }
        diagnostic("response watch rearmed", responseWatchTraceForPending(pending, {
          status: "watching",
          stage: "response_watch_rearmed"
        }));
        recordManagedTabLifecycleTelemetry("response_watch_rearmed", responseWatchTraceForPending(pending, {
          status: "watching",
          stage: "response_watch_rearmed",
          watcher_state: "armed"
        }), pending.tabId);
      } else {
        const errorCode = watchResult?.error_code || "content_script_unavailable";
        const stage = watchResult?.stage || "response_watch_rearm_result_invalid";
        diagnostic("response watch rearm deferred", responseWatchTraceForPending(pending, {
          status: "pending",
          error_code: errorCode,
          stage
        }));
        scheduleResponseWatchRearm(pending);
      }
    } catch (error) {
      const errorCode = error?.code || (isMissingContentScriptError(error) ? "content_script_unavailable" : "response_watch_dispatch_failed");
      const stage = error?.stage || "response_watch_rearm_dispatch";
      diagnostic("response watch rearm deferred", responseWatchTraceForPending(pending, {
        status: "pending",
        error_code: errorCode,
        stage
      }));
      scheduleResponseWatchRearm(pending);
    } finally {
      pending.rearmInProgress = false;
    }
  }
}

let managedMediumRecoveryOperation = null;

function scheduleManagedMediumRecovery(removedTabId = null, removedWindowId = null, reason = "managed_tab_removed") {
  if (managedMediumRecoveryOperation) {
    diagnostic("managed execution recovery duplicate suppressed", {
      target_tab_id: removedTabId,
      event_window_id: removedWindowId,
      status: "pending",
      stage: "managed_execution_recovery_duplicate_suppressed"
    });
    return managedMediumRecoveryOperation;
  }
  const operation = recoverManagedTabAfterRemoval(removedTabId, removedWindowId, reason);
  managedMediumRecoveryOperation = operation;
  void operation.finally(() => {
    if (managedMediumRecoveryOperation === operation) managedMediumRecoveryOperation = null;
  }).catch(() => {});
  return operation;
}

async function recoverManagedTabAfterRemoval(removedTabId = null, removedWindowId = null, reason = "managed_tab_removed") {
  await managedTabStateReady;
  const previousTabId = managedTabState.tabId;
  const previousExecutionWindowId = managedTabState.executionWindowId;
  const executionWindowRemoved = reason === "execution_window_removed";
  const affectedTabIds = new Set(
    [removedTabId, previousTabId].filter((value) => Number.isSafeInteger(value) && value >= 0));
  const pendingWatches = [...responseWatches.values()]
    .filter((pending) => affectedTabIds.has(pending.tabId)
      || affectedTabIds.has(pending.targetTabId));
  const pendingSends = [...pendingHandoffSends.values()]
    .filter((pending) => affectedTabIds.has(pending.targetTabId));
  const recoverySource = pendingWatches[0] || pendingSends[0];
  const conversationId = recoverySource?.targetConversationId || managedTabState.conversationId;
  const conversationUrl = recoverySource?.targetConversationUrl
    || managedTabState.conversationUrl
    || (recoverySource?.targetTabUrl && chatGptConversationId(recoverySource.targetTabUrl)
      ? recoverySource.targetTabUrl
      : null);

  for (const pending of pendingWatches) {
    pending.tabId = null;
    pending.targetTabId = null;
  }
  for (const pending of pendingSends) pending.targetTabId = null;

  if (executionWindowRemoved
    && Number.isSafeInteger(previousExecutionWindowId)
    && previousExecutionWindowId >= 0) {
    managedTabLifecycle("PreparingTab", {
      tabId: null,
      executionWindowId: null,
      executionWindowState: "Idle",
      contentReady: false,
      conversationReady: false,
      composerReady: false,
      watcherReady: false
    });
  } else if (managedTabState.tabId === removedTabId) {
    clearManagedTabState("PreparingTab");
  }

  if (!conversationId && !conversationUrl) {
    diagnostic("managed tab recovery deferred", {
      status: "pending",
      error_code: "target_conversation_not_found",
      stage: "managed_tab_recovery_identity_missing",
      target_tab_id: removedTabId,
      event_window_id: removedWindowId
    });
    return;
  }

  const source = recoverySource || {};
  const recoveryMessage = {
    request_id: source.requestId || managedTabState.currentRequestId || "managed-tab-recovery",
    session_id: source.sessionId || managedTabState.currentSessionId || "managed-tab-recovery",
    handoff_id: source.handoffId || managedTabState.currentHandoffId || "managed-tab-recovery",
    boundary_id: source.boundaryId || managedTabState.currentBoundaryId || "managed-tab-recovery",
    handoff_kind: source.handoffKind || (source.isReview ? "review" : "bootstrap"),
    target_conversation_id: conversationId,
    target_conversation_url: conversationUrl,
    target_project_id: source.targetProjectId || managedTabState.projectId || null,
    new_conversation: false
  };

  diagnostic("managed tab recovery requested", {
    ...traceForMessage(recoveryMessage, { target_tab_id: removedTabId }),
    conversation_id: conversationId,
    conversation_url: conversationUrl,
    event_window_id: removedWindowId,
    status: "requested",
    stage: "managed_tab_recovery_requested"
  });
  try {
    await withManagedTabOperation(async () => {
      const prepared = await ensureManagedExecutionTab(
        recoveryMessage,
        traceForMessage(recoveryMessage));
      const newTabId = prepared.tab.id;
      const currentContext = prepared.currentContext;
      const newConversationId = currentContext?.conversation_id || conversationId || null;
      const newConversationUrl = currentContext?.url || conversationUrl || null;
      for (const pending of pendingWatches) {
        pending.tabId = newTabId;
        pending.targetTabId = newTabId;
        if (newConversationId) pending.targetConversationId = newConversationId;
        if (newConversationUrl) {
          pending.targetConversationUrl = newConversationUrl;
          pending.targetTabUrl = newConversationUrl;
        }
      }
      for (const pending of pendingSends) {
        pending.targetTabId = newTabId;
        if (newConversationId) pending.targetConversationId = newConversationId;
        if (newConversationUrl) {
          pending.targetConversationUrl = newConversationUrl;
          pending.targetTabUrl = newConversationUrl;
        }
      }
      managedTabLifecycle("WaitingWatcher", {
        tabId: newTabId,
        conversationId: newConversationId,
        conversationUrl: newConversationUrl,
        contentReady: true,
        conversationReady: true,
        composerReady: prepared.readyResult?.composer_ready !== false,
        watcherReady: false
      });
      diagnostic("managed tab recovered", {
        ...traceForMessage(recoveryMessage, { target_tab_id: newTabId }),
        conversation_id: newConversationId,
        conversation_url: newConversationUrl,
        execution_window_id: managedTabState.executionWindowId,
        execution_window_state: managedTabState.executionWindowState,
        status: "ready",
        stage: "managed_tab_recovered"
      });
      await recoverPendingHandoffSendsForTab(newTabId);
      await rearmResponseWatchesForTab(newTabId);
    });
  } catch (error) {
    diagnostic("managed tab recovery failed", {
      ...traceForMessage(recoveryMessage, { target_tab_id: removedTabId }),
      event_window_id: removedWindowId,
      status: "error",
      error_code: error?.code || "managed_tab_recovery_failed",
      stage: error?.stage || "managed_tab_recovery"
    });
    for (const pending of pendingWatches) {
      pending.tabId = null;
      pending.targetTabId = null;
    }
    for (const pending of pendingSends) pending.targetTabId = null;
  }
}

function acknowledgeBridgeEnvelope(message, bridgeSocket) {
  if (authenticatedBridgeSocket(bridgeSocket) !== bridgeSocket) return;
  const deliveryType = message?.delivery_type;
  const requestId = message?.request_id;
  if (deliveryType !== "handoff.result" && deliveryType !== "assistant.response") return;
  if (typeof requestId !== "string" || requestId.length === 0) return;

  const key = `${deliveryType}:${requestId}`;
  const pending = bridgeOutbox.get(key);
  if (!pending) return;
  if (message?.handoff_id && pending.envelope.handoff_id !== message.handoff_id) return;
  bridgeOutbox.delete(key);
  bridgeEnvelopeDiagnostic(
    deliveryType === "handoff.result" ? "handoff.result acknowledged" : "assistant response acknowledged",
    pending.envelope,
    pending.trace,
    { stage: "bridge_delivery_acknowledged" }
  );
}

function reviewMediaResult(message, status, errorCode, text, stage) {
  const result = {
    type: "review.media.result",
    request_id: message?.request_id || "",
    session_id: message?.session_id || "",
    iteration: message?.iteration,
    media_id: message?.media_id || "",
    status
  };
  if (errorCode) result.error_code = errorCode;
  if (text) result.message = text;
  if (stage) result.stage = stage;
  return result;
}

function sendReviewMediaResultToBridge(result, bridgeSocket) {
  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("review.media.result dropped", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: result.status,
      error_code: result.error_code || "bridge_disconnected",
      stage: result.stage || "bridge_disconnected"
    });
    return false;
  }
  try {
    bridgeSocket.send(JSON.stringify(result));
    diagnostic("review.media.result sent", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: result.status,
      error_code: result.error_code,
      stage: result.stage
    });
    return true;
  } catch (_) {
    diagnostic("review.media.result delivery failed", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "media_bridge_send"
    });
    return false;
  }
}

function isValidReviewMediaMessage(message) {
  const hasTargetTabId = message?.target_tab_id !== undefined && message?.target_tab_id !== null;
  const hasTargetTabUrl = message?.target_tab_url !== undefined && message?.target_tab_url !== null;
  const targetConversationId = message?.target_conversation_id === undefined || message?.target_conversation_id === null
    ? null
    : safeContextIdentifier(message.target_conversation_id);
  const targetConversationUrl = message?.target_conversation_url === undefined || message?.target_conversation_url === null
    ? null
    : safeChatGptContextUrl(message.target_conversation_url);
  const targetConversationUrlId = targetConversationUrl ? chatGptConversationId(targetConversationUrl) : null;
  return typeof message?.request_id === "string"
    && message.request_id.length > 0
    && typeof message?.session_id === "string"
    && message.session_id.length > 0
    && typeof message?.media_id === "string"
    && message.media_id.length > 0
    && Number.isSafeInteger(message?.iteration)
    && message.iteration > 0
    && typeof message?.filename === "string"
    && message.filename.length > 0
    && message.filename.length <= 255
    && !/[\\/\r\n"\u0000]/.test(message.filename)
    && typeof message?.mime_type === "string"
    && ["video/mp4", "image/png", "image/jpeg", "image/webp"].includes(message.mime_type.toLowerCase())
    && Number.isSafeInteger(message?.size)
    && message.size > 0
    && message.size <= MAX_REVIEW_MEDIA_BYTES
    && (!hasTargetTabId || (Number.isSafeInteger(message.target_tab_id) && message.target_tab_id >= 0))
    && (!hasTargetTabUrl || (typeof message.target_tab_url === "string"
      && message.target_tab_url.length > 0
      && message.target_tab_url.length <= 2048
      && safeChatGptContextUrl(message.target_tab_url) !== null))
    && (message?.target_conversation_id === undefined
      || message?.target_conversation_id === null
      || targetConversationId !== null)
    && (message?.target_conversation_url === undefined
      || message?.target_conversation_url === null
      || targetConversationUrl !== null)
    && (!targetConversationId || !targetConversationUrl || targetConversationUrlId === targetConversationId);
}

function chatGptProjectId(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
      try { return decodeURIComponent(segment); } catch (_) { return segment; }
    });
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "g") continue;
      const projectId = safeContextIdentifier(segments[index + 1]);
      if (projectId?.toLowerCase().startsWith("g-p-")) return projectId;
    }
  } catch (_) { }
  return null;
}

function safeChatGptProjectUrl(value) {
  const canonical = safeChatGptContextUrl(value);
  if (!canonical || chatGptProjectId(canonical) === null) return null;
  try {
    const url = new URL(canonical);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1)?.toLowerCase() === "project" ? canonical : null;
  } catch (_) {
    return null;
  }
}

function conversationTargetFromMessage(message) {
  const hasConversationId = message?.target_conversation_id !== undefined
    && message?.target_conversation_id !== null;
  const hasConversationUrl = message?.target_conversation_url !== undefined
    && message?.target_conversation_url !== null;
  const conversationId = safeContextIdentifier(message?.target_conversation_id);
  const conversationUrl = safeChatGptContextUrl(message?.target_conversation_url);
  if ((hasConversationId && !conversationId) || (hasConversationUrl && !conversationUrl)) {
    return { errorCode: "target_conversation_invalid", errorStage: "target_conversation_check" };
  }
  if (conversationId && conversationUrl && chatGptConversationId(conversationUrl) !== conversationId) {
    return { errorCode: "target_conversation_invalid", errorStage: "target_conversation_check" };
  }
  return { conversationId, conversationUrl };
}

function managedConversationTarget(message, identity) {
  const targetTabUrl = safeChatGptContextUrl(message?.target_tab_url);
  const managedConversationId = safeContextIdentifier(managedTabState.conversationId);
  const managedConversationUrl = safeChatGptContextUrl(managedTabState.conversationUrl);

  if (message?.new_conversation === true) {
    return {
      newConversation: true,
      conversationId: null,
      conversationUrl: null,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
        || (safeChatGptContextUrl(message?.target_project_url) === "https://chatgpt.com/"
          ? "https://chatgpt.com/"
          : null)
        || "https://chatgpt.com/"
    };
  }

  if (identity?.conversationId || identity?.conversationUrl) {
    return {
      newConversation: false,
      conversationId: identity.conversationId,
      conversationUrl: identity.conversationUrl,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // Older Desktop snapshots carry the bound conversation as target_tab_url.
  // Treat its conversation identity as data, never as permission to operate
  // that foreground tab.
  const legacyConversationId = chatGptConversationId(targetTabUrl);
  if (legacyConversationId) {
    return {
      newConversation: false,
      conversationId: legacyConversationId,
      conversationUrl: targetTabUrl,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // Review/media/resume messages normally include the bound conversation.
  // If an old persisted message does not, the managed tab is the only safe
  // recovery source. The user's active tab is deliberately never consulted.
  if ((message?.handoff_kind === "review" || message?.type === "review.media.attach")
    && (managedConversationId || managedConversationUrl)) {
    return {
      newConversation: false,
      conversationId: managedConversationId,
      conversationUrl: managedConversationUrl,
      projectId: managedTabState.projectId,
      projectUrl: managedTabState.projectUrl
    };
  }

  // A review/media operation without a bound conversation must not guess from
  // the foreground tab or silently create a different conversation.
  if (message?.handoff_kind === "review" || message?.type === "review.media.attach") {
    return {
      newConversation: false,
      conversationId: null,
      conversationUrl: null,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // A legacy unbound bootstrap is treated as a new managed conversation. It
  // is safer to create an isolated ChatGPT conversation than to borrow the
  // conversation the user happens to be viewing.
  return {
    newConversation: true,
    conversationId: null,
    conversationUrl: null,
    projectId: safeContextIdentifier(message?.target_project_id),
    projectUrl: safeChatGptProjectUrl(message?.target_project_url)
      || (safeChatGptContextUrl(message?.target_project_url) === "https://chatgpt.com/"
        ? "https://chatgpt.com/"
        : null)
      || "https://chatgpt.com/"
  };
}

function managedTabMatchesTarget(tab, target) {
  if (!tab || !isChatGptTab(tab)) return false;
  if (!target?.newConversation) {
    return isSameChatGptConversation(tab.url, target.conversationUrl, target.conversationId);
  }
  return chatGptConversationId(tab.url) === null
    && (!target.projectUrl || safeChatGptContextUrl(tab.url) === target.projectUrl);
}

function executionWindowState(window) {
  return typeof window?.state === "string" && window.state.length > 0
    ? window.state
    : "normal";
}

async function getManagedExecutionWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId < 0 || typeof chrome.windows?.get !== "function") return null;
  try {
    return await chrome.windows.get(windowId);
  } catch (_) {
    return null;
  }
}

async function tabsInManagedExecutionWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || typeof chrome.tabs?.query !== "function") return [];
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return Array.isArray(tabs) ? tabs : [];
  } catch (_) {
    return [];
  }
}

async function findManagedExecutionWindowTab(windowId) {
  const tabs = await tabsInManagedExecutionWindow(windowId);
  return tabs.find((tab) => tab?.id === managedTabState.tabId)
    || tabs.find((tab) => isChatGptTab(tab))
    || tabs[0]
    || null;
}

async function makeManagedExecutionWindowUsable(window, trace = {}) {
  if (!window || !Number.isSafeInteger(window.id)) return null;
  let usable = window;
  const windowChanges = {};
  if (executionWindowState(window) === "minimized") windowChanges.state = "normal";
  if (window.focused === true) windowChanges.focused = false;
  if (Object.keys(windowChanges).length > 0 && typeof chrome.windows?.update === "function") {
    try {
      usable = await chrome.windows.update(window.id, windowChanges) || {
        ...window,
        ...windowChanges
      };
      diagnostic("managed execution window restored", {
        ...trace,
        execution_window_id: window.id,
        execution_window_focused: usable.focused,
        execution_window_state: executionWindowState(usable),
        status: "restored",
        stage: "execution_window_restored"
      });
    } catch (error) {
      diagnostic("managed execution window restore failed", {
        ...trace,
        execution_window_id: window.id,
        error_code: error?.code || "execution_window_restore_failed",
        status: "error",
        stage: "execution_window_restore"
      });
    }
  }
  managedTabState = {
    ...managedTabState,
    executionWindowId: window.id,
    executionWindowState: executionWindowState(usable)
  };
  return usable;
}

async function managedExecutionWindowCreateData(url) {
  let referenceWindow = null;
  if (typeof chrome.windows?.getLastFocused === "function") {
    try {
      referenceWindow = await chrome.windows.getLastFocused({ populate: false });
    } catch (_) {
      referenceWindow = null;
    }
  }
  const referenceWidth = Number.isSafeInteger(referenceWindow?.width) && referenceWindow.width > 0
    ? referenceWindow.width
    : MANAGED_EXECUTION_WINDOW_FALLBACK_WIDTH;
  const referenceHeight = Number.isSafeInteger(referenceWindow?.height) && referenceWindow.height > 0
    ? referenceWindow.height
    : MANAGED_EXECUTION_WINDOW_FALLBACK_HEIGHT;
  return {
    url,
    focused: false,
    state: "normal",
    type: "normal",
    width: Math.max(
      MANAGED_EXECUTION_WINDOW_MIN_WIDTH,
      Math.floor(referenceWidth * MANAGED_EXECUTION_WINDOW_SIZE_FACTOR)),
    height: Math.max(
      MANAGED_EXECUTION_WINDOW_MIN_HEIGHT,
      Math.floor(referenceHeight * MANAGED_EXECUTION_WINDOW_SIZE_FACTOR))
  };
}

async function ensureManagedExecutionWindow(url, trace = {}) {
  await managedTabStateReady;
  const existingWindowId = managedTabState.executionWindowId;
  if (Number.isSafeInteger(existingWindowId) && existingWindowId >= 0) {
    const existing = await getManagedExecutionWindow(existingWindowId);
    if (existing) {
      return makeManagedExecutionWindowUsable(existing, trace);
    }
    diagnostic("managed execution window unavailable", {
      ...trace,
      execution_window_id: existingWindowId,
      error_code: "execution_window_closed",
      status: "error",
      stage: "execution_window_lookup"
    });
    clearManagedTabState("PreparingTab", { clearExecutionWindow: true });
  }

  if (typeof chrome.windows?.create !== "function") {
    throw managedTabError(
      "managed_execution_window_create_failed",
      "execution_window_create",
      "Managed ChatGPT Execution Windowを作成できません。");
  }

  diagnostic("managed execution window create requested", {
    ...trace,
    status: "requested",
    stage: "execution_window_create"
  });
  let created;
  let createTimeout = null;
  try {
    const createData = await managedExecutionWindowCreateData(url);
    created = await Promise.race([
      chrome.windows.create(createData),
      new Promise((_, reject) => {
        createTimeout = setTimeout(() => reject(managedTabError(
          "managed_execution_window_create_timeout",
          "execution_window_create_timeout",
          "Managed ChatGPT Execution Windowの作成がタイムアウトしました。")), MANAGED_EXECUTION_WINDOW_CREATE_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    throw error?.code
      ? error
      : managedTabError(
        "managed_execution_window_create_failed",
        "execution_window_create",
        "Managed ChatGPT Execution Windowを作成できません。");
  } finally {
    if (createTimeout !== null) clearTimeout(createTimeout);
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw managedTabError(
      "managed_execution_window_create_failed",
      "execution_window_create",
      "Managed ChatGPT Execution Windowを作成できません。"
    );
  }
  const usable = await makeManagedExecutionWindowUsable({
    ...created,
    state: executionWindowState(created),
    focused: created.focused === true
  }, trace);
  diagnostic("managed execution window created", {
    ...trace,
    execution_window_id: usable.id,
    execution_window_focused: usable.focused,
    execution_window_state: executionWindowState(usable),
    status: "created",
    stage: "execution_window_created"
  });
  recordManagedTabLifecycleTelemetry("execution_window_created", {
    ...trace,
    execution_window_id: usable.id,
    execution_window_focused: usable.focused,
    execution_window_state: executionWindowState(usable),
    execution_window_exists: true,
    status: "created",
    stage: "execution_window_created"
  }, null, null, usable.id);
  return usable;
}

async function enforceManagedExecutionTab(tab, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id) || typeof chrome.tabs?.update !== "function") return tab;
  if (!Number.isSafeInteger(managedTabState.executionWindowId)
    || tab.windowId !== managedTabState.executionWindowId) return tab;
  const changes = {};
  if (tab.active !== true) changes.active = true;
  if (tab.autoDiscardable !== false) changes.autoDiscardable = false;
  if (Object.keys(changes).length === 0) return tab;
  try {
    const updated = await chrome.tabs.update(tab.id, changes);
    const normalized = updated && updated.id !== undefined
      ? updated
      : { ...tab, ...changes };
    diagnostic("managed execution tab state enforced", {
      ...trace,
      target_tab_id: normalized.id,
      execution_window_id: normalized.windowId,
      tab_active: normalized.active,
      tab_auto_discardable: normalized.autoDiscardable,
      status: "enforced",
      stage: "managed_execution_tab_state_enforced"
    });
    recordManagedTabLifecycleTelemetry("managed_execution_tab_state_enforced", {
      ...trace,
      target_tab_id: normalized.id,
      status: "enforced",
      stage: "managed_execution_tab_state_enforced"
    }, normalized.id, normalized);
    return normalized;
  } catch (error) {
    throw managedTabError(
      error?.code || "managed_execution_tab_state_failed",
      "managed_execution_tab_state",
      "Managed ChatGPTタブの実行状態を設定できません。");
  }
}

async function getManagedExecutionTab(trace) {
  await managedTabStateReady;
  if (!Number.isSafeInteger(managedTabState.tabId) || managedTabState.tabId < 0) return null;
  if (!Number.isSafeInteger(managedTabState.executionWindowId)
    || managedTabState.executionWindowId < 0) {
    diagnostic("legacy managed tab rejected", {
      ...managedTabTrace(trace),
      status: "error",
      error_code: "managed_execution_window_required",
      stage: "managed_tab_lookup"
    });
    clearManagedTabState("PreparingTab");
    return null;
  }
  try {
    const tab = await chrome.tabs.get(managedTabState.tabId);
    if (!tab || tab.id === undefined || !isChatGptTab(tab)) {
      diagnostic("managed tab unavailable", {
        ...managedTabTrace(trace),
        status: "error",
        error_code: "managed_tab_unavailable",
        stage: "managed_tab_lookup"
      });
      clearManagedTabState("Failed");
      return null;
    }
    if (tab.windowId !== managedTabState.executionWindowId) {
      diagnostic("managed tab outside execution window", {
        ...managedTabTrace(trace),
        target_tab_id: tab.id,
        window_id: tab.windowId,
        error_code: "managed_tab_wrong_window",
        status: "error",
        stage: "managed_tab_lookup"
      });
      clearManagedTabState("PreparingTab");
      return null;
    }
    const window = await getManagedExecutionWindow(managedTabState.executionWindowId);
    if (!window) {
      diagnostic("managed execution window unavailable", {
        ...managedTabTrace(trace),
        error_code: "execution_window_closed",
        status: "error",
        stage: "execution_window_lookup"
      });
      clearManagedTabState("PreparingTab", { clearExecutionWindow: true });
      return null;
    }
    await makeManagedExecutionWindowUsable(window, trace);
    return await enforceManagedExecutionTab(tab, trace);
  } catch (error) {
    diagnostic("managed tab unavailable", {
      ...managedTabTrace(trace),
      status: "error",
      error_code: error?.code || "managed_tab_closed",
      stage: error?.stage || "managed_tab_lookup"
    });
    clearManagedTabState("Failed");
    return null;
  }
}

async function createManagedTabInExecutionWindow(url, windowId, trace) {
  if (typeof chrome.tabs?.create !== "function") {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  let created;
  try {
    created = await chrome.tabs.create({ url, windowId, active: true });
  } catch (_) {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  managedTabState = {
    ...managedTabState,
    tabId: created.id,
    executionWindowId: windowId,
    executionWindowState: managedTabState.executionWindowState || "normal"
  };
  managedTabLifecycle("PreparingTab", {
    tabId: created.id,
    executionWindowId: windowId,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  const normalized = await enforceManagedExecutionTab(created, trace);
  diagnostic("managed tab created", {
    ...trace,
    status: "created",
    stage: "managed_tab_created",
    target_tab_id: normalized.id,
    execution_window_id: windowId
  });
  recordManagedTabLifecycleTelemetry("managed_tab_created", {
    ...trace,
    status: "created",
    stage: "managed_tab_created",
    target_tab_id: normalized.id,
    execution_window_id: windowId
  }, normalized.id, normalized, windowId);
  return normalized;
}

async function createManagedExecutionTab(url, trace) {
  const previousExecutionWindowId = managedTabState.executionWindowId;
  managedTabLifecycle("PreparingTab", {
    tabId: null,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  const window = await ensureManagedExecutionWindow(url, trace);
  let created = await findManagedExecutionWindowTab(window.id);
  if (!created) created = await createManagedTabInExecutionWindow(url, window.id, trace);
  else {
    managedTabState = {
      ...managedTabState,
      tabId: created.id,
      executionWindowId: window.id,
      executionWindowState: executionWindowState(window)
    };
    managedTabLifecycle("PreparingTab", { tabId: created.id });
    created = await enforceManagedExecutionTab(created, trace);
  }
  if (previousExecutionWindowId !== window.id) {
    diagnostic("managed tab created", {
      ...trace,
      status: "created",
      stage: "managed_tab_created",
      target_tab_id: created.id,
      execution_window_id: window.id
    });
    recordManagedTabLifecycleTelemetry("managed_tab_created", {
      ...trace,
      status: "created",
      stage: "managed_tab_created",
      target_tab_id: created.id,
      execution_window_id: window.id
    }, created.id, created, window.id);
  }
  return created;
}

async function navigateManagedExecutionTab(tab, url, trace) {
  if (!tab || tab.id === undefined || typeof chrome.tabs?.update !== "function") {
    throw managedTabError("managed_tab_navigation_failed", "managed_tab_navigation", "Managed ChatGPTタブを移動できません。");
  }
  if (tab.windowId !== managedTabState.executionWindowId) {
    throw managedTabError("managed_tab_wrong_window", "managed_tab_navigation", "Managed ChatGPTタブがExecution Windowにありません。");
  }
  managedTabLifecycle("PreparingTab", {
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  contentScriptReadyTabs.delete(tab.id);
  diagnostic("managed tab navigation requested", {
    ...trace,
    status: "requested",
    stage: "managed_tab_navigation",
    target_tab_id: tab.id,
    execution_window_id: managedTabState.executionWindowId
  });
  try {
    const updated = await chrome.tabs.update(tab.id, { url, active: true, autoDiscardable: false });
    return await enforceManagedExecutionTab(
      updated && updated.id !== undefined ? updated : { ...tab, url, active: true, autoDiscardable: false },
      trace);
  } catch (_) {
    throw managedTabError("managed_tab_navigation_failed", "managed_tab_navigation", "Managed ChatGPTタブを移動できません。");
  }
}

function executionReadyMessage(message, target) {
  return {
    type: CHATGPT_EXECUTION_READY_MESSAGE_TYPE,
    requestId: message?.request_id,
    sessionId: message?.session_id,
    handoffId: message?.handoff_id,
    boundaryId: message?.boundary_id,
    targetTabId: managedTabState.tabId,
    ...(target?.conversationId ? { expectedConversationId: target.conversationId } : {}),
    ...(target?.conversationUrl ? { expectedConversationUrl: target.conversationUrl } : {}),
    ...(target?.projectId ? { expectedProjectId: target.projectId } : {}),
    newConversation: target?.newConversation === true,
    requireComposer: true
  };
}

function executionIdentityMatches(message, request) {
  if (!message
    || message.request_id !== request?.request_id
    || message.session_id !== request?.session_id) return false;
  if (request?.handoff_id !== undefined
    && request?.handoff_id !== null
    && message.handoff_id !== request.handoff_id) return false;
  if (request?.boundary_id !== undefined
    && request?.boundary_id !== null
    && message.boundary_id !== request.boundary_id) return false;
  return true;
}

async function ensureManagedExecutionTab(message, trace = traceForMessage(message)) {
  await managedTabStateReady;
  if (message?.new_conversation !== undefined && typeof message.new_conversation !== "boolean") {
    throw managedTabError("target_conversation_invalid", "target_conversation_check", "新規Conversation指定が不正です。");
  }
  const identity = conversationTargetFromMessage(message);
  if (identity.errorCode) throw managedTabError(identity.errorCode, identity.errorStage, "ChatGPTの対象Conversation情報が不正です。");

  const target = managedConversationTarget(message, identity);
  // Conversation ID/URL is the durable execution identity. Project metadata
  // is only required when the operation has to open a new Conversation; for
  // an existing Conversation, stale Project metadata must never block media
  // delivery or Handoff routing.
  const requiresProjectMetadata = target.newConversation === true;
  const requestedProjectId = message?.target_project_id === undefined || message?.target_project_id === null
    ? null
    : safeContextIdentifier(message.target_project_id);
  const requestedProjectUrl = message?.target_project_url === undefined || message?.target_project_url === null
    ? null
    : safeChatGptProjectUrl(message.target_project_url)
      || (safeChatGptContextUrl(message.target_project_url) === "https://chatgpt.com/"
        ? "https://chatgpt.com/"
        : null);
  if (requiresProjectMetadata
    && message?.target_project_id !== undefined
    && message?.target_project_id !== null
    && !requestedProjectId) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project情報が不正です。");
  }
  if (requiresProjectMetadata
    && message?.target_project_url !== undefined
    && message?.target_project_url !== null
    && !requestedProjectUrl) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project URLが不正です。");
  }
  if (requiresProjectMetadata
    && requestedProjectId
    && requestedProjectUrl !== "https://chatgpt.com/"
    && chatGptProjectId(requestedProjectUrl) !== requestedProjectId) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project IDとURLが一致しません。");
  }
  const destination = target.newConversation
    ? target.projectUrl || "https://chatgpt.com/"
    : target.conversationUrl || (target.conversationId
      ? `https://chatgpt.com/c/${encodeURIComponent(target.conversationId)}`
      : null);
  if (!destination) {
    throw managedTabError("target_conversation_not_found", "target_conversation_check", "保存済みのChatGPT Conversation URLがありません。");
  }
  let tab = await getManagedExecutionTab(trace);
  if (!tab) {
    tab = await createManagedExecutionTab(destination, trace);
  }
  if (!managedTabMatchesTarget(tab, target)) {
    tab = await navigateManagedExecutionTab(tab, destination, trace);
  } else {
    diagnostic("managed tab reused", {
      ...trace,
      status: "reused",
      stage: "managed_tab_reused",
      target_tab_id: tab.id
    });
  }
  tab = await enforceManagedExecutionTab(tab, trace);

  managedTabState = {
    ...managedTabState,
    tabId: tab.id,
    executionWindowId: Number.isSafeInteger(tab.windowId)
      ? tab.windowId
      : managedTabState.executionWindowId,
    projectId: target.projectId || managedTabState.projectId || null,
    projectUrl: target.projectUrl || managedTabState.projectUrl || null,
    conversationId: target.conversationId || (target.newConversation ? null : managedTabState.conversationId),
    conversationUrl: target.conversationUrl || (target.newConversation ? null : managedTabState.conversationUrl),
    currentRequestId: message?.request_id || null,
    currentSessionId: message?.session_id || null,
    currentHandoffId: message?.handoff_id || null,
    currentBoundaryId: message?.boundary_id || null
  };
  managedTabLifecycle("WaitingContentScript", {
    tabId: tab.id,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });

  const tabReady = await waitForTabReady(tab.id, MANAGED_TAB_NAVIGATION_TIMEOUT_MS);
  if (!tabReady) {
    throw managedTabError("managed_tab_navigation_timeout", "managed_tab_navigation_timeout", "Managed ChatGPTタブの読み込みがタイムアウトしました。");
  }

  managedTabLifecycle("WaitingContentScript", { tabId: tab.id });
  let readyResult;
  try {
    readyResult = await dispatchToContentScript(
      tab.id,
      executionReadyMessage(message, target),
      message,
      {
        timeoutMs: MANAGED_CONVERSATION_READY_TIMEOUT_MS,
        timeoutStage: "conversation_ready_timeout"
      });
  } catch (error) {
    throw error?.code
      ? error
      : managedTabError("content_script_ready_timeout", "content_script_ready_timeout", "ChatGPT Content Scriptの準備がタイムアウトしました。");
  }
  if (!executionIdentityMatches(readyResult, message)
    || readyResult.status !== "ready") {
    throw managedTabError(
      readyResult?.error_code || "conversation_not_ready",
      readyResult?.stage || "conversation_ready",
      readyResult?.message || "対象ChatGPT Conversationの準備が完了していません。");
  }
  const currentContext = normalizeCurrentContext(readyResult.current_context || readyResult.currentContext);
  const resolvedTab = await chrome.tabs.get(tab.id).catch(() => tab);
  const actualConversationId = currentContext?.conversation_id || chatGptConversationId(resolvedTab?.url);
  const actualConversationUrl = currentContext?.url || safeChatGptContextUrl(resolvedTab?.url);
  if (!target.newConversation
    && ((target.conversationId && actualConversationId !== target.conversationId)
      || (target.conversationUrl && !isSameChatGptConversation(actualConversationUrl, target.conversationUrl, target.conversationId)))) {
    throw managedTabError("target_conversation_mismatch", "conversation_ready", "Managed ChatGPTタブのConversationが対象と一致しません。");
  }

  managedTabState = {
    ...managedTabState,
    tabId: resolvedTab?.id ?? tab.id,
    conversationId: actualConversationId || (target.newConversation ? null : target.conversationId),
    conversationUrl: actualConversationUrl || (target.newConversation ? null : target.conversationUrl),
    projectId: currentContext?.project_id || target.projectId || managedTabState.projectId || null,
    contentReady: true,
    conversationReady: true,
    composerReady: readyResult.composer_ready !== false
  };
  managedTabLifecycle("WaitingWatcher", {
    tabId: managedTabState.tabId,
    contentReady: true,
    conversationReady: true,
    composerReady: managedTabState.composerReady
  });
  diagnostic("managed tab conversation ready", managedTabTrace({
    ...trace,
    status: "ready",
    stage: "conversation_ready"
  }));
  return {
    tab: resolvedTab || tab,
    target,
    currentContext,
    readyResult
  };
}

function base64FromBytes(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  if (typeof globalThis.btoa === "function") return globalThis.btoa(binary);

  // Test/runtime fallback for environments without Window.btoa. This is
  // deliberately per-chunk; the full media file is never base64-embedded in
  // a WebSocket or one JSON message.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    const second = index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
    const third = index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
    const combined = (first << 16) | (second << 8) | third;
    encoded += alphabet[(combined >> 18) & 63];
    encoded += alphabet[(combined >> 12) & 63];
    encoded += index + 1 < binary.length ? alphabet[(combined >> 6) & 63] : "=";
    encoded += index + 2 < binary.length ? alphabet[combined & 63] : "=";
  }
  return encoded;
}

function contentResultError(result, fallbackCode, fallbackStage) {
  if (!result || typeof result !== "object") {
    return { code: fallbackCode, stage: fallbackStage, message: "ChatGPT Content Scriptから有効な添付結果を受け取れませんでした。" };
  }
  return {
    code: result.error_code || fallbackCode,
    stage: result.stage || fallbackStage,
    message: result.message || "ChatGPTへの生成物添付に失敗しました。"
  };
}

async function sendReviewMediaToTarget(message, bridgeSocket) {
  let result;
  const trace = {
    request_id: message?.request_id,
    media_id: message?.media_id,
    iteration: message?.iteration
  };
  diagnostic("review.media.attach received", trace);
  if (!isValidReviewMediaMessage(message)) {
    result = reviewMediaResult(message, "error", "media_registration_failed", "Review添付メタデータが不正です。", "media_request_validation");
  } else if (!sessionToken || bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
    result = reviewMediaResult(message, "error", "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection");
  } else {
    let targetTab;
    try {
      const prepared = await ensureManagedExecutionTab(message, trace);
      targetTab = prepared.tab;
      diagnostic("managed media target ready", {
        ...trace,
        status: "ready",
        stage: "conversation_ready",
        target_tab_id: targetTab.id
      });
    } catch (error) {
      const code = error?.code || "review_target_tab_not_found";
      const stage = error?.stage || "managed_tab_ready";
      result = reviewMediaResult(message, "error", code, error?.message || "Managed ChatGPTタブの準備に失敗しました。", stage);
    }
    if (!result) {
      diagnostic("review target tab found", { ...trace, target_tab_id: targetTab.id, stage: "target_tab_found" });
      try {
        const mediaUrl = `${BRIDGE_MEDIA_URL_PREFIX}${encodeURIComponent(message.media_id)}?session_id=${encodeURIComponent(message.session_id)}&iteration=${encodeURIComponent(String(message.iteration))}`;
        diagnostic("media fetching", { ...trace, stage: "media_fetching" });
        const response = await fetchBridge(mediaUrl, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
          }
        });
        if (!response.ok) {
          const code = response.status === 410 ? "media_expired" : response.status === 413 ? "media_too_large" : "media_fetch_failed";
          result = reviewMediaResult(message, "error", code, "Desktop Bridgeから生成物を取得できませんでした。", "media_fetch_failed");
        } else {
          const contentLength = Number(response.headers?.get?.("content-length") || 0);
          if (contentLength > MAX_REVIEW_MEDIA_BYTES || (contentLength > 0 && contentLength !== message.size)) {
            result = reviewMediaResult(message, "error", contentLength > MAX_REVIEW_MEDIA_BYTES ? "media_too_large" : "media_fetch_failed", "生成物のサイズ確認に失敗しました。", "media_size_validation");
          } else {
            const begin = await dispatchToContentScript(targetTab.id, {
              type: REVIEW_MEDIA_ATTACH_BEGIN_MESSAGE_TYPE,
              requestId: message.request_id,
              sessionId: message.session_id,
              iteration: message.iteration,
              mediaId: message.media_id,
              fileName: message.filename,
              mimeType: message.mime_type,
              size: message.size
            }, trace);
            if (!begin || begin.status !== "receiving") {
              const failure = contentResultError(begin, "attachment_control_not_found", "attachment_control_found");
              result = reviewMediaResult(message, "error", failure.code, failure.message, failure.stage);
            } else {
              let transferred = 0;
              const reader = response.body?.getReader?.();
              const sendChunk = async (bytes) => {
                if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
                if (bytes.length === 0) return;
                // ReadableStream implementations are free to return a much
                // larger chunk than the MV3 message budget. Split every
                // reader chunk before base64 encoding so a video never turns
                // into one oversized tabs.sendMessage payload.
                for (let offset = 0; offset < bytes.length; offset += REVIEW_MEDIA_CHUNK_BYTES) {
                  const part = bytes.slice(offset, Math.min(offset + REVIEW_MEDIA_CHUNK_BYTES, bytes.length));
                  if (part.length === 0) continue;
                  const nextTransferred = transferred + part.length;
                  if (nextTransferred > message.size || nextTransferred > MAX_REVIEW_MEDIA_BYTES) {
                    throw bridgeError("Review media is too large.", 0, nextTransferred > MAX_REVIEW_MEDIA_BYTES ? "media_too_large" : "media_fetch_failed");
                  }
                  const chunkResult = await dispatchToContentScript(targetTab.id, {
                    type: REVIEW_MEDIA_ATTACH_CHUNK_MESSAGE_TYPE,
                    requestId: message.request_id,
                    sessionId: message.session_id,
                    iteration: message.iteration,
                    mediaId: message.media_id,
                    offset: transferred,
                    chunk: base64FromBytes(part)
                  }, trace);
                  if (!chunkResult || chunkResult.status !== "receiving") {
                    const failure = contentResultError(chunkResult, "attachment_input_failed", "attachment_injected");
                    throw bridgeError(failure.message, 0, failure.code);
                  }
                  transferred = nextTransferred;
                }
              };

              if (reader) {
                while (true) {
                  const part = await reader.read();
                  if (part.done) break;
                  await sendChunk(part.value);
                }
              } else {
                const bytes = new Uint8Array(await response.arrayBuffer());
                for (let offset = 0; offset < bytes.length; offset += REVIEW_MEDIA_CHUNK_BYTES) {
                  await sendChunk(bytes.slice(offset, offset + REVIEW_MEDIA_CHUNK_BYTES));
                }
              }

              if (transferred !== message.size) {
                result = reviewMediaResult(message, "error", "media_fetch_failed", "生成物の受信サイズが一致しません。", "media_size_validation");
              } else {
                diagnostic("media ready", { ...trace, stage: "media_ready" });
                const end = await dispatchToContentScript(targetTab.id, {
                  type: REVIEW_MEDIA_ATTACH_END_MESSAGE_TYPE,
                  requestId: message.request_id,
                  sessionId: message.session_id,
                  iteration: message.iteration,
                  mediaId: message.media_id,
                  fileName: message.filename,
                  mimeType: message.mime_type,
                  size: message.size
                }, trace);
                if (end?.status === "attached") {
                  result = reviewMediaResult(message, "attached", null, null, end.stage || "attachment_verified");
                } else {
                  const failure = contentResultError(end, "attachment_verification_failed", "attachment_verified");
                  result = reviewMediaResult(message, "error", failure.code, failure.message, failure.stage);
                }
              }
            }
          }
        }
      } catch (error) {
        const code = error?.code || (isMissingContentScriptError(error) ? "content_script_unavailable" : "media_fetch_failed");
        const stage = error?.stage || (code === "content_script_unavailable" ? "content_script_dispatch" : "media_fetching");
        result = reviewMediaResult(message, "error", code, error?.message || "生成物の添付に失敗しました。", stage);
      }
    }
  }

  diagnostic("review media result", {
    ...trace,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  sendReviewMediaResultToBridge(result, bridgeSocket);
  return result;
}

async function startAssistantResponseWatch(tabId, message, bridgeSocket, options = {}) {
  const requestId = message.request_id;
  const preSend = options.preSend === true;
  // A retry rotates request_id but intentionally keeps the same immutable
  // Handoff boundary. Do not let a late watcher from the previous attempt
  // compete with the current request or forward a stale response.
  forgetResponseWatchesForIdentity(message, requestId);
  diagnostic(message.handoff_kind === "review" ? "review response watch requested" : "response watch requested", traceForMessage(message, {
    status: "requested",
    stage: "response_watch_requested",
    target_tab_id: tabId
  }));
  const pending = {
    requestId,
    tabId,
    targetTabId: tabId,
    sessionId: message.session_id,
    handoffId: message.handoff_id,
    boundaryId: message.boundary_id,
    isReview: message.handoff_kind === "review",
    targetTabUrl: message.target_tab_url || managedTabState.conversationUrl || null,
    targetConversationId: message.target_conversation_id || managedTabState.conversationId || null,
    targetConversationUrl: message.target_conversation_url || managedTabState.conversationUrl || null,
    preSend,
    watcherReady: false,
    bridgeSocket,
    watchDispatching: true,
    rearmInProgress: false,
    rearmTimer: null,
    rearmDeadline: Date.now() + RESPONSE_WATCH_REARM_TIMEOUT_MS,
    lifecycleTelemetryTimer: null
  };
  responseWatches.set(requestId, pending);
  scheduleResponseWatchLifecycleTelemetry(pending);

  let watchResult;
  try {
    watchResult = await dispatchToContentScript(tabId, {
      type: RESPONSE_WATCH_MESSAGE_TYPE,
      requestId: message.request_id,
      sessionId: message.session_id,
      handoffId: message.handoff_id,
      boundaryId: message.boundary_id,
      protocol: HANDOFF_PROTOCOL,
      targetTabId: tabId,
      ...(message.handoff_kind === "review" ? { review: true } : {}),
      ...(preSend ? { prepare: true } : {})
    },
    message,
    { timeoutMs: MANAGED_WATCHER_READY_TIMEOUT_MS, timeoutStage: "response_watch_ready_timeout" });
  } catch (error) {
    const errorCode = error?.code || "content_script_unavailable";
    const stage = error?.stage || "response_watch_dispatch";
    diagnostic("assistant response watch deferred", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "pending",
      error_code: errorCode,
      stage
    });
    pending.watchDispatching = false;
    if (preSend) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      managedTabLifecycle("Failed", { tabId, watcherReady: false });
    } else {
      scheduleResponseWatchRearm(pending);
    }
    return false;
  }

  if (!watchResult
    || watchResult.request_id !== requestId
    || watchResult.session_id !== message.session_id
    || watchResult.handoff_id !== message.handoff_id
    || watchResult.boundary_id !== message.boundary_id
    || watchResult.status !== "watching") {
    const errorCode = watchResult?.error_code || "response_watch_unavailable";
    const stage = watchResult?.stage || "response_watch_result_invalid";
    diagnostic("assistant response watch deferred", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "pending",
      error_code: errorCode,
      stage
    });
    pending.watchDispatching = false;
    if (preSend) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      managedTabLifecycle("Failed", { tabId, watcherReady: false });
    } else {
      scheduleResponseWatchRearm(pending);
    }
    return false;
  }

  pending.watchDispatching = false;
  pending.watcherReady = true;
  managedTabLifecycle(managedTabState.lifecycle === "Sending" ? "Sending" : "WaitingWatcher", {
    tabId,
    watcherReady: true
  });
  diagnostic("response watch armed", {
    ...traceForMessage(message, { target_tab_id: tabId }),
    status: "watching",
    stage: preSend ? "response_watch_ready" : "response_watch_armed",
    target_tab_id: tabId
  });
  recordManagedTabLifecycleTelemetry("response_watch_armed", responseWatchTraceForPending(pending, {
    status: "watching",
    stage: "response_watch_armed",
    watcher_state: "armed"
  }), tabId);
  return true;
}

async function resolveHandoffTarget(message) {
  try {
    const prepared = await ensureManagedExecutionTab(message, traceForMessage(message));
    return { tab: prepared.tab, target: prepared.target, currentContext: prepared.currentContext, error: null };
  } catch (error) {
    return {
      tab: null,
      error: handoffResult(
        message,
        "error",
        error?.code || "managed_tab_ready_failed",
        error?.message || "Managed ChatGPTタブの準備に失敗しました。",
        error?.stage || "managed_tab_ready")
    };
  }
}

function markManagedTabAfterHandoff(tab, message, currentContext, lifecycle = "Sent") {
  const context = normalizeCurrentContext(currentContext);
  const tabUrl = safeChatGptContextUrl(tab?.url);
  const conversationId = context?.conversation_id || chatGptConversationId(tab?.url);
  const conversationUrl = context?.url || tabUrl;
  managedTabState = {
    ...managedTabState,
    tabId: tab?.id ?? managedTabState.tabId,
    conversationId: conversationId || managedTabState.conversationId || null,
    conversationUrl: conversationUrl || managedTabState.conversationUrl || null,
    projectId: context?.project_id || managedTabState.projectId || null,
    currentRequestId: message?.request_id || managedTabState.currentRequestId,
    currentSessionId: message?.session_id || managedTabState.currentSessionId,
    currentHandoffId: message?.handoff_id || managedTabState.currentHandoffId,
    currentBoundaryId: message?.boundary_id || managedTabState.currentBoundaryId,
    contentReady: true,
    conversationReady: true,
    composerReady: true,
    watcherReady: true
  };
  managedTabLifecycle(lifecycle, {
    tabId: managedTabState.tabId,
    conversationId: managedTabState.conversationId,
    conversationUrl: managedTabState.conversationUrl,
    contentReady: true,
    conversationReady: true,
    composerReady: true,
    watcherReady: true
  });
}

function cancelResponseWatch(requestId) {
  const pending = responseWatches.get(requestId);
  if (!pending) return;
  if (pending.rearmTimer !== null) clearTimeout(pending.rearmTimer);
  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(requestId);
  void dispatchToContentScript(
    pending.tabId,
    {
      type: "CANCEL_ASSISTANT_RESPONSE_WATCH",
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      handoffId: pending.handoffId,
      boundaryId: pending.boundaryId
    },
    pending,
    { timeoutMs: 2000, timeoutStage: "response_watch_cancel" }).catch(() => {});
}

async function sendHandoffToManagedTab(message, bridgeSocket) {
  return withManagedTabOperation(async () => {
  let result;
  let targetTab = null;
  let targetTabId = null;
  let handoffCurrentContext = null;
  let pendingSend = null;
  let responseWatchReady = false;
  let responseWatchPreArmed = false;
  try {
    recordManagedTabLifecycleTelemetry("handoff_send_before", {
      ...traceForMessage(message),
      status: "pending",
      stage: "handoff_send_before"
    });
    const target = await resolveHandoffTarget(message);
    if (target.error) {
      result = target.error;
    } else {
      targetTab = target.tab;
      targetTabId = targetTab?.id ?? null;
      handoffCurrentContext = target.currentContext || null;
      const accepted = getAcceptedHandoff(message);
      if (accepted) {
        // The first attempt may have posted successfully even if its Bridge
        // ACK was delayed. Reuse that accepted delivery and only create a new
        // response-watch request; never post the same marker-bearing Handoff
        // twice.
        diagnostic("handoff duplicate suppressed", {
          ...traceForMessage(message, { target_tab_id: targetTabId }),
          status: "sent",
          stage: "handoff_duplicate_suppressed"
        });
        result = handoffResult(
          message,
          "sent",
          null,
          null,
          "handoff_duplicate_suppressed",
          targetTab,
          {
            conversation_id: accepted.targetConversationId,
            url: accepted.targetConversationUrl,
            project_id: accepted.targetProjectId
          });
        handoffCurrentContext = {
          conversation_id: accepted.targetConversationId,
          url: accepted.targetConversationUrl,
          project_id: accepted.targetProjectId
        };
        responseWatchReady = await startAssistantResponseWatch(targetTab.id, message, bridgeSocket, { preSend: false });
      } else {
        // Watcher readiness is a prerequisite of sending. This two-phase
        // registration prevents a fast ChatGPT response or a navigation from
        // racing the observer that is meant to correlate it.
        managedTabLifecycle("WaitingWatcher", {
          tabId: targetTabId,
          watcherReady: false,
          currentRequestId: message.request_id,
          currentSessionId: message.session_id,
          currentHandoffId: message.handoff_id,
          currentBoundaryId: message.boundary_id
        });
        responseWatchPreArmed = true;
        responseWatchReady = await startAssistantResponseWatch(targetTab.id, message, bridgeSocket, { preSend: true });
        if (!responseWatchReady) {
          result = handoffResult(
            message,
            "error",
            "response_watch_unavailable",
            "ChatGPTのassistant応答監視を準備できないため送信を開始できません。",
            "response_watch_ready_timeout");
        }
      }

      if (!result && !accepted) {
        managedTabLifecycle("Sending", { tabId: targetTabId, watcherReady: true });
        pendingSend = createPendingHandoffSend(message, bridgeSocket, targetTab);
        let contentResult;
        try {
          diagnostic("handoff send requested", {
            ...traceForMessage(message, { target_tab_id: targetTabId }),
            status: "requested",
            stage: "handoff_send_requested"
          });
          const dispatchTask = dispatchToContentScript(targetTab.id, {
            type: "HANDOFF_SEND",
            requestId: message.request_id,
            sessionId: message.session_id,
            handoffId: message.handoff_id,
            boundaryId: message.boundary_id,
            protocol: HANDOFF_PROTOCOL,
            payload: message.payload,
            ...(message.new_conversation === true ? {
              newConversation: true,
              ...(typeof message.target_project_url === "string"
                ? { targetProjectUrl: message.target_project_url }
                : {})
            } : {}),
            ...(message.handoff_kind === "review" ? {
              review: true,
              expectedAttachment: {
                mediaId: message.review_media_id,
                fileName: message.review_file_name,
                iteration: message.review_iteration
              }
            } : {})
          }, message, { timeoutMs: MANAGED_SEND_CONFIRMATION_TIMEOUT_MS, timeoutStage: "send_confirmation_timeout" });
          // The Content Script emits HANDOFF_SEND_CONFIRMED immediately after
          // it observes the new marker-bearing user message. Race that
          // metadata-only signal with the tabs.sendMessage response: a page
          // navigation may invalidate the original response channel even
          // though ChatGPT has already accepted the post.
          const dispatchOutcome = await Promise.race([
            dispatchTask
              .then((value) => ({ kind: "dispatch", value }))
              .catch((error) => ({ kind: "error", error })),
            pendingSend.confirmation.promise
              .then((value) => ({ kind: "confirmed", value }))
          ]);
          if (dispatchOutcome.kind === "confirmed") {
            let confirmation = dispatchOutcome.value;
            if (message.new_conversation === true) {
              const bindingOutcome = await Promise.race([
                dispatchTask
                  .then((value) => ({ kind: "dispatch", value }))
                  .catch((error) => ({ kind: "error", error })),
                wait(NEW_CONVERSATION_BINDING_GRACE_MS).then(() => ({ kind: "grace" }))
              ]);
              if (bindingOutcome.kind === "dispatch"
                && bindingOutcome.value?.status === "sent") {
                confirmation = bindingOutcome.value;
                diagnostic("new conversation bound after confirmation", {
                  ...traceForMessage(message, { target_tab_id: targetTabId }),
                  status: "bound",
                  stage: "conversation_bound_after_send"
                });
              }
            }
            result = handoffResult(
              message,
              "sent",
              null,
              null,
              confirmation.stage,
              targetTab,
              confirmation.current_context || confirmation.currentContext);
            handoffCurrentContext = confirmation.current_context
              || confirmation.currentContext
              || handoffCurrentContext;
            diagnostic("handoff completion recovered", {
              ...traceForMessage(message, { target_tab_id: targetTabId }),
              status: "sent",
              stage: "handoff_confirmation_recovered"
            });
          } else if (dispatchOutcome.kind === "error") {
            throw dispatchOutcome.error;
          } else {
            contentResult = dispatchOutcome.value;
          }
        } catch (error) {
          const errorCode = error?.code === "send_failed" ? "send_failed" : "content_script_unavailable";
          const stage = error?.stage || (errorCode === "send_failed" ? "send_confirmation_timeout" : "content_script_dispatch");
          diagnostic("content script dispatch failed", {
            ...traceForMessage(message, { target_tab_id: targetTabId }),
            error_code: errorCode,
            stage
          });
          result = handoffResult(
            message,
            "error",
            errorCode,
            errorCode === "send_failed"
              ? "ChatGPTの送信結果を確認できませんでした。"
              : "ChatGPTのContent Scriptへ接続できません。",
            stage);
        }

        if (!result) {
          if (!contentResult || contentResult.request_id !== message.request_id || contentResult.handoff_id !== message.handoff_id) {
            result = handoffResult(message, "error", "content_script_unavailable", "Content Scriptから有効な送信結果を受け取れませんでした。", "send_confirmation_result_invalid");
          } else if (contentResult.status === "sent") {
            // A new Chat starts at the project/root URL, then ChatGPT replaces
            // it with the newly created conversation URL after the first user
            // message is accepted. Refresh the tab metadata before persisting
            // the result so the legacy target-tab fallback also retains the
            // current conversation URL when the Content Script could not yet
            // report a conversation identity.
            let resultTargetTab = targetTab;
            if (targetTab?.id !== undefined) {
              try {
                const refreshedTargetTab = await chrome.tabs.get(targetTab.id);
                if (refreshedTargetTab && isChatGptTab(refreshedTargetTab)) resultTargetTab = refreshedTargetTab;
              } catch (_) { }
            }
            result = handoffResult(
              message,
              "sent",
              null,
              null,
              contentResult.stage,
              resultTargetTab,
              contentResult.current_context || contentResult.currentContext);
            handoffCurrentContext = contentResult.current_context || contentResult.currentContext || handoffCurrentContext;
            diagnostic("content script send confirmed", {
              ...traceForMessage(message, { target_tab_id: resultTargetTab?.id ?? targetTabId }),
              status: "sent",
              stage: "user_message_correlated"
            });
          } else if (contentResult.status === "error") {
            result = handoffResult(
              message,
              "error",
              contentResult.error_code || "send_failed",
              contentResult.message || "ChatGPTへの送信に失敗しました。",
              contentResult.stage);
          } else {
            result = handoffResult(message, "error", "send_failed", "Content Scriptの送信結果が不正です。", "content_result_invalid");
          }
        }
        if (result.status === "sent") {
          rememberAcceptedHandoff(message, result);
          markManagedTabAfterHandoff(targetTab, message, handoffCurrentContext, "Sent");
          const pendingWatch = responseWatches.get(message.request_id);
          if (pendingWatch) {
            pendingWatch.preSend = false;
            pendingWatch.targetTabUrl = managedTabState.conversationUrl || pendingWatch.targetTabUrl;
            pendingWatch.targetConversationId = managedTabState.conversationId || pendingWatch.targetConversationId;
            pendingWatch.targetConversationUrl = managedTabState.conversationUrl || pendingWatch.targetConversationUrl;
          }
        }
      }
    }
  } catch (error) {
    if (!result || result.status !== "sent") {
      result = handoffResult(
        message,
        "error",
        error?.code || "managed_tab_ready_failed",
        error?.message || "Managed ChatGPTタブの準備に失敗しました。",
        error?.stage || "managed_tab_ready",
        targetTab);
    }
  }

  if (!result) {
    result = handoffResult(message, "error", "managed_tab_ready_failed", "Managed ChatGPTタブの処理結果を確認できませんでした。", "managed_tab_result_invalid");
  }

  if (result.status !== "sent" && responseWatchPreArmed) cancelResponseWatch(message.request_id);

  diagnostic("result status", {
    ...traceForMessage(message, { target_tab_id: targetTabId }),
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  if (result.status === "sent") {
    managedTabLifecycle("WaitingAssistant", {
      tabId: targetTabId,
      watcherReady: responseWatchReady || Boolean(responseWatches.get(message.request_id)),
      currentRequestId: message.request_id,
      currentSessionId: message.session_id,
      currentHandoffId: message.handoff_id,
      currentBoundaryId: message.boundary_id
    });
    recordManagedTabLifecycleTelemetry(
      message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent",
      {
        ...traceForMessage(message, { target_tab_id: targetTabId }),
        status: "sent",
        stage: message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent",
        watcher_state: responseWatches.has(message.request_id) ? "armed" : "idle"
      },
      targetTabId);
  } else {
    managedTabLifecycle("Failed", { tabId: targetTabId, watcherReady: false });
  }
  diagnostic("handoff ACK ready", {
    ...traceForMessage(message, { target_tab_id: targetTabId }),
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: "handoff_ack_ready"
  });
  const resultSent = sendHandoffResultToBridge(result, bridgeSocket, message);
  if (resultSent && result.status === "sent") {
    diagnostic(message.handoff_kind === "review" ? "review handoff sent" : "handoff sent", {
      ...traceForMessage(message, { target_tab_id: targetTabId }),
      request_id: result.request_id,
      handoff_id: result.handoff_id,
      status: result.status,
      stage: message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent"
    });
  }
  if (pendingSend && pendingHandoffSends.get(pendingSend.requestId) === pendingSend) {
    if (pendingSend.recoveryTimer !== null) {
      clearTimeout(pendingSend.recoveryTimer);
      pendingSend.recoveryTimer = null;
    }
    pendingHandoffSends.delete(pendingSend.requestId);
  }
  return result;
  });
}

function runManagedHandoff(message, bridgeSocket) {
  const key = handoffIdentityKey(message);
  const existing = managedHandoffOperations.get(key);
  if (existing) {
    diagnostic("handoff operation duplicate suppressed", {
      ...traceForMessage(message),
      status: "pending",
      stage: "handoff_operation_duplicate_suppressed"
    });
    // A retry may be associated with a newly connected Desktop socket or a
    // rotated request_id. Reuse the in-flight result, but never invoke the
    // Content Script send path a second time.
    void existing.then((result) => {
      if (!result) return;
      const retryResult = { ...result, request_id: message.request_id };
      sendHandoffResultToBridge(retryResult, bridgeSocket, message);
    }).catch(() => {});
    return existing;
  }

  const operation = sendHandoffToManagedTab(message, bridgeSocket);
  managedHandoffOperations.set(key, operation);
  void operation.finally(() => {
    if (managedHandoffOperations.get(key) === operation) managedHandoffOperations.delete(key);
  }).catch(() => {});
  return operation;
}

function runManagedMediaAttachment(message, bridgeSocket) {
  const key = `${message?.session_id || ""}|${message?.request_id || ""}|${message?.media_id || ""}`;
  const existing = managedMediaOperations.get(key);
  if (existing) {
    diagnostic("media operation duplicate suppressed", {
      request_id: message?.request_id,
      session_id: message?.session_id,
      media_id: message?.media_id,
      status: "pending",
      stage: "media_operation_duplicate_suppressed"
    });
    return existing;
  }
  const operation = withManagedTabOperation(() => sendReviewMediaToTarget(message, bridgeSocket));
  managedMediaOperations.set(key, operation);
  void operation.finally(() => {
    if (managedMediaOperations.get(key) === operation) managedMediaOperations.delete(key);
  }).catch(() => {});
  return operation;
}

async function handleAssistantResponseFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const sessionId = message?.sessionId || message?.session_id;
  const handoffId = message?.handoffId || message?.handoff_id;
  const boundaryId = message?.boundaryId || message?.boundary_id;
  const pending = responseWatches.get(requestId);
  if (!pending || sender?.tab?.id !== pending.tabId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_watch_context"
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_watch_context",
      watcher_state: "idle"
    }, sender?.tab?.id);
    return;
  }
  if (Number.isSafeInteger(managedTabState.tabId) && managedTabState.tabId !== pending.tabId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "managed_tab_context",
      target_tab_id: sender?.tab?.id
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "managed_tab_context",
      watcher_state: "idle"
    }, sender?.tab?.id);
    return;
  }
  diagnostic("response correlation started", {
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status: "started",
    stage: "response_correlation_started",
    target_tab_id: sender?.tab?.id
  });
  if (sessionId !== pending.sessionId || handoffId !== pending.handoffId || boundaryId !== pending.boundaryId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_identity_mismatch"
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_identity_mismatch",
      watcher_state: "armed"
    }, pending.tabId);
    return;
  }

  // Review responses are bound to the tab/conversation that accepted the
  // Review Handoff. A content script can survive an SPA navigation, so the
  // sender tab id alone is not sufficient. Re-check the current URL before
  // forwarding the response; otherwise a response from a different ChatGPT
  // conversation could be correlated as the current iteration's result.
  if (pending.isReview) {
    let targetTab;
    try {
      targetTab = await chrome.tabs.get(pending.tabId);
    } catch (_) {
      targetTab = null;
    }
    const responseConversationId = safeContextIdentifier(
      message?.targetConversationId || message?.target_conversation_id);
    const responseConversationUrl = safeChatGptContextUrl(
      message?.targetConversationUrl || message?.target_conversation_url);
    const hasBoundConversation = Boolean(pending.targetConversationId || pending.targetConversationUrl);
    const targetConversationMatches = !hasBoundConversation
      || (responseConversationId
        ? (!pending.targetConversationId || responseConversationId === pending.targetConversationId)
        : responseConversationUrl
          ? isSameChatGptConversation(responseConversationUrl, pending.targetConversationUrl, pending.targetConversationId)
          : isSameChatGptConversation(targetTab?.url, pending.targetConversationUrl, pending.targetConversationId));
    if (!targetTab
      || targetTab.id !== pending.tabId
      || !isChatGptTab(targetTab)
      || !targetConversationMatches) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      diagnostic("response correlation rejected", {
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "review_target_tab_not_found",
        stage: "target_tab_check",
        target_tab_id: pending.tabId
      });
      recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
        status: "error",
        error_code: "review_target_tab_not_found",
        stage: "target_tab_check",
        watcher_state: "idle"
      }), pending.tabId);
      sendAssistantResponseToBridge({
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "review_target_tab_not_found",
        message: "Review Handoffの対象ChatGPT会話が変わったため応答を受け付けません。",
        stage: "target_tab_check",
        target_tab_id: pending.tabId,
        target_tab_url: pending.targetTabUrl,
        target_conversation_id: pending.targetConversationId,
        target_conversation_url: pending.targetConversationUrl
      }, pending.bridgeSocket);
      return;
    }

    if (responseConversationId
      && pending.targetConversationId
      && responseConversationId !== pending.targetConversationId) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      diagnostic("response correlation rejected", {
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "target_conversation_mismatch",
        stage: "response_conversation_check",
        target_tab_id: pending.tabId
      });
      recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
        status: "error",
        error_code: "target_conversation_mismatch",
        stage: "response_conversation_check",
        watcher_state: "idle"
      }), pending.tabId);
      sendAssistantResponseToBridge({
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "target_conversation_mismatch",
        message: "assistant応答のConversationが現在のManaged Conversationと一致しません。",
        stage: "response_conversation_check",
        target_tab_id: pending.tabId,
        target_tab_url: pending.targetTabUrl,
        target_conversation_id: pending.targetConversationId,
        target_conversation_url: pending.targetConversationUrl
      }, pending.bridgeSocket);
      return;
    }
  }

  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(requestId);
  let status = message?.status;
  let errorCode = message?.errorCode || message?.error_code;
  let responsePayload = message?.payload;
  let responseMessage = message?.message;
  let stage = message?.stage;
  if (status === "received" && (typeof responsePayload !== "string" || responsePayload.length === 0)) {
    status = "error";
    errorCode = "response_extraction_failed";
    responseMessage = "assistant応答本文を取得できませんでした。";
    stage = "response_payload_invalid";
    responsePayload = null;
  }
  if (status !== "received" && status !== "error") {
    status = "error";
    errorCode = "response_extraction_failed";
    responseMessage = "assistant応答結果が不正です。";
    stage = "response_result_invalid";
    responsePayload = null;
  }

  diagnostic("assistant response received", {
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status,
    error_code: errorCode,
    stage: "assistant_response_received",
    target_tab_id: pending.tabId
  });
  recordManagedTabLifecycleTelemetry("assistant_response_received", responseWatchTraceForPending(pending, {
    status,
    error_code: errorCode,
    stage: "assistant_response_received",
    assistant_state: status === "received"
      ? "completed"
      : errorCode === "response_stream_interrupted"
        ? "streaming"
        : "not_detected",
    watcher_state: "idle"
  }), pending.tabId);
  if (status === "received") {
    managedTabLifecycle("ResponseReceived", {
      tabId: pending.tabId,
      watcherReady: false,
      currentRequestId: requestId,
      currentSessionId: sessionId,
      currentHandoffId: handoffId,
      currentBoundaryId: boundaryId
    });
    diagnostic("response correlation accepted", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "accepted",
      stage: "response_correlation_accepted",
      target_tab_id: pending.tabId
    });
    recordManagedTabLifecycleTelemetry("response_correlation_accepted", responseWatchTraceForPending(pending, {
      status: "accepted",
      stage: "response_correlation_accepted",
      assistant_state: "completed",
      watcher_state: "idle"
    }), pending.tabId);
  } else {
    diagnostic("response correlation rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: errorCode,
      stage: "response_correlation_rejected",
      target_tab_id: pending.tabId
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
      status: "error",
      error_code: errorCode,
      stage: "response_correlation_rejected",
      assistant_state: errorCode === "response_stream_interrupted" ? "streaming" : "not_detected",
      watcher_state: "idle"
    }), pending.tabId);
  }
  sendAssistantResponseToBridge({
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status,
    payload: responsePayload,
    error_code: errorCode,
    message: responseMessage,
    stage,
    ...(pending.isReview ? {
      target_tab_id: pending.tabId,
      target_tab_url: pending.targetTabUrl,
      target_conversation_id: pending.targetConversationId,
      target_conversation_url: pending.targetConversationUrl
    } : {})
  }, pending.bridgeSocket);
}

function handleBridgeMessage(message, bridgeSocket) {
  if (!message || typeof message !== "object") return;

  if (message.type === "bridge.delivery.ack") {
    acknowledgeBridgeEnvelope(message, bridgeSocket);
    return;
  }

  if (message.type === "pong" && message.id && pendingPings.has(message.id)) {
    const pending = pendingPings.get(message.id);
    pendingPings.delete(message.id);
    clearTimeout(pending.timeout);
    void setState({ lastPongAt: new Date().toISOString(), lastError: null });
    pending.resolve(message);
    return;
  }

  if (message.type === "event") {
    void setState({ lastEvent: message, lastError: null });
    return;
  }

  if (message.type === CHATGPT_CONTEXT_LIST_REQUEST_TYPE
    || message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE) {
    diagnostic("background received", {
      request_id: message.request_id,
      status: "requested",
      stage: message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE
        ? "context_current_requested"
        : "context_list_requested"
    });
    void requestChatGptContext(
      message,
      bridgeSocket,
      message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE);
    return;
  }

  if (message.type === "handoff.send") {
    // The Background owns one active Managed ChatGPT Tab inside its
    // connector-created Execution Window. All DOM discovery and mutation
    // remains in the ChatGPT Content Script; the user's foreground tab is
    // never selected as an execution target.
    diagnostic("background received", traceForMessage(message, {
      stage: message.handoff_kind === "review" ? "review_handoff_received" : "handoff_received"
    }));
    void runManagedHandoff(message, bridgeSocket);
    return;
  }

  if (message.type === "review.media.attach") {
    // The Background owns authenticated media retrieval and tab routing. The
    // Content Script receives only bounded file chunks and never contacts the
    // localhost Bridge itself.
    void runManagedMediaAttachment(message, bridgeSocket);
  }
}

function isTransientConnectionError(error) {
  return error?.code === "desktop_unavailable"
    || error?.code === "websocket_error"
    || error?.code === "hello_not_acknowledged";
}

function connectionFailureState(error) {
  return error?.code === "pairing_required" || isTransientConnectionError(error)
    ? "DISCONNECTED"
    : "ERROR";
}

function openSocket(nextSessionToken) {
  return new Promise((resolve, reject) => {
    let candidate;
    try {
      candidate = new WebSocket(BRIDGE_WS_URL);
    } catch (error) {
      reject(error);
      return;
    }

    socket = candidate;
    let acknowledged = false;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    candidate.onopen = () => {
      diagnostic("websocket hello sent");
      try {
        candidate.send(JSON.stringify({
          type: "hello",
          protocol: BRIDGE_PROTOCOL,
          client: "browser-extension",
          token: nextSessionToken
        }));
      } catch (_) {
        fail(bridgeError("Desktop Bridge hello could not be sent.", 0, "websocket_error"));
      }
    };

    candidate.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        fail(bridgeError("Desktop Bridge sent invalid JSON.", 0, "invalid_json"));
        return;
      }

      handleBridgeMessage(message, candidate);
      if (message.type === "hello.ack") {
        if (message.protocol !== BRIDGE_PROTOCOL) {
          fail(bridgeError("Desktop Bridge protocol is unavailable.", 0, "invalid_protocol"));
          return;
        }
        acknowledged = true;
        if (socket === candidate) {
          acknowledgedSocket = candidate;
          for (const pending of responseWatches.values()) {
            if (!pending.bridgeSocket) pending.bridgeSocket = candidate;
          }
          flushBridgeOutbox();
        }
        startSocketKeepalive(candidate);
        diagnostic("bridge connected");
        if (!settled) {
          settled = true;
          resolve(message);
        }
      }
      if (message.type === "error" && !acknowledged) {
        fail(bridgeError(`Desktop Bridge rejected the connection (${message.code || "error"}).`, 0, message.code || "bridge_error"));
      }
    };

    candidate.onerror = () => {
      if (!acknowledged) fail(bridgeError("Desktop Bridge WebSocket connection failed.", 0, "websocket_error"));
    };

    candidate.onclose = () => {
      stopSocketKeepalive(candidate);
      detachBridgeOutboxForSocket(candidate);
      clearResponseWatchesForSocket(candidate);
      if (acknowledgedSocket === candidate) acknowledgedSocket = null;
      clearContextRequestsForSocket(candidate);
      if (socket === candidate) {
        socket = null;
        sessionToken = null;
        diagnostic("bridge disconnected");
        closePendingPings(new Error("Desktop Bridge WebSocket closed."));
        void setState({ status: "DISCONNECTED", lastError: manualDisconnect ? null : "Desktop Connectorから切断されました。", connectedAt: null, sessionExpiresAt: null });
        if (!acknowledged) {
          fail(bridgeError("Desktop Bridge closed before hello.ack.", 0, "hello_not_acknowledged"));
        }
        if (!manualDisconnect) scheduleReconnect();
      } else if (!acknowledged) {
        fail(bridgeError("Desktop Bridge WebSocket closed before hello.ack.", 0, "hello_not_acknowledged"));
      }
    };
  });
}

async function connect() {
  await stateReady;
  if (socket?.readyState === WebSocket.OPEN && state.status === "CONNECTED") return state;
  if (connectPromise) return connectPromise;

  manualDisconnect = false;
  connectPromise = (async () => {
    clearReconnectTimer();
    await setState({ status: "CONNECTING", lastError: null });
    await fetchHealth();
    if (!pairing.credential) {
      throw bridgeError("初回接続にはDesktopのPairing codeが必要です。", 0, "pairing_required");
    }
    const bootstrap = await fetchBootstrap(pairing.credential);
    sessionToken = bootstrap.session_token;
    await openSocket(sessionToken);
    await setState({
      status: "CONNECTED",
      paired: true,
      pairingId: bootstrap.pairing_id || pairing.pairingId,
      lastError: null,
      connectedAt: new Date().toISOString(),
      sessionExpiresAt: bootstrap.session_expires_at || null
    });
    return state;
  })().catch(async (error) => {
    if (error.code === "invalid_pairing_credential") await clearPairing();
    await setState({
      status: connectionFailureState(error),
      lastError: error.code === "pairing_required"
        ? "DesktopのBROWSER EXTENSION欄に表示されたPairing codeを入力してください。"
        : errorMessage(error)
    });
    scheduleReconnect();
    throw error;
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

async function pair(pairingCode) {
  await stateReady;
  manualDisconnect = false;
  const normalized = String(pairingCode || "").trim();
  if (!normalized) throw bridgeError("Pairing codeを入力してください。", 0, "invalid_pairing_code");

  connectPromise = (async () => {
    clearReconnectTimer();
    await setState({ status: "CONNECTING", lastError: null });
    await fetchHealth();
    const result = await fetchPairing(normalized);
    await storePairing(result);
    const bootstrap = await fetchBootstrap(result.pairing_credential);
    sessionToken = bootstrap.session_token;
    await openSocket(sessionToken);
    await setState({
      status: "CONNECTED",
      paired: true,
      pairingId: result.pairing_id,
      lastError: null,
      connectedAt: new Date().toISOString(),
      sessionExpiresAt: bootstrap.session_expires_at || null
    });
    return state;
  })().catch(async (error) => {
    await setState({ status: connectionFailureState(error), lastError: errorMessage(error) });
    scheduleReconnect();
    throw error;
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (manualDisconnect || reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {});
  }, RECONNECT_DELAY_MS);
}

async function disconnect() {
  manualDisconnect = true;
  clearReconnectTimer();
  const current = socket;
  socket = null;
  acknowledgedSocket = null;
  sessionToken = null;
  stopSocketKeepalive(current);
  closePendingPings(new Error("Disconnected by the user."));
  clearResponseWatchesForSocket(current, true);
  clearContextRequestsForSocket(current);
  bridgeOutbox.clear();
  if (current && current.readyState === WebSocket.OPEN) current.close(1000, "user disconnect");
  return setState({ status: "DISCONNECTED", lastError: null, connectedAt: null, sessionExpiresAt: null });
}

async function ping() {
  await connect();
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Desktop Bridge is not connected.");

  const id = crypto.randomUUID();
  const request = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPings.delete(id);
      reject(new Error("Desktop Bridge ping timed out."));
    }, PING_TIMEOUT_MS);
    pendingPings.set(id, { resolve, reject, timeout });
  });

  await setState({ lastPingAt: new Date().toISOString(), lastError: null });
  try {
    socket.send(JSON.stringify({ type: "ping", id }));
  } catch (error) {
    pendingPings.delete(id);
    throw error;
  }
  return request;
}

function ensureReconnectAlarm() {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && !manualDisconnect) connect().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  manualDisconnect = false;
  ensureReconnectAlarm();
  connect().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  manualDisconnect = false;
  ensureReconnectAlarm();
  connect().catch(() => {});
});

// A full ChatGPT navigation replaces the page's Content Script.  Re-arm every
// still-pending watcher when the replacement reports ready; the Background is
// the owner of the correlation identity, so the new script can safely locate
// the same marker-bearing user message and continue from there.
chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  const isManagedExecutionTab = Number.isSafeInteger(managedTabState.tabId)
    && tabId === managedTabState.tabId
    && Number.isSafeInteger(managedTabState.executionWindowId)
    && tab?.windowId === managedTabState.executionWindowId;
  const isCollectorWindowTab = Number.isSafeInteger(collectorWindowState.tabId)
    && tabId === collectorWindowState.tabId
    && Number.isSafeInteger(collectorWindowState.windowId)
    && tab?.windowId === collectorWindowState.windowId;
  const isCollectorWindowMember = Number.isSafeInteger(collectorWindowState.windowId)
    && tab?.windowId === collectorWindowState.windowId;
  const collectorTabLifecycleChanged = [
    "status",
    "active",
    "discarded",
    "frozen",
    "autoDiscardable",
    "url"
  ].some((key) => Object.prototype.hasOwnProperty.call(changeInfo || {}, key));
  if (isCollectorWindowMember && collectorTabLifecycleChanged) {
    void queueCollectorTabTopologyRepair({
      event_tab_id: tabId,
      event_window_id: tab?.windowId,
      stage: "collector_tabs_on_updated"
    });
  }
  if (isCollectorWindowTab
    && collectorTabLifecycleChanged) {
    diagnostic("collector tab updated", {
      status: "observed",
      stage: "collector_tabs_on_updated",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      target_tab_id: tabId,
      tab_active: tab?.active === true,
      tab_discarded: tab?.discarded === true,
      tab_frozen: tab?.frozen === true,
      tab_auto_discardable: tab?.autoDiscardable,
      tab_status: typeof tab?.status === "string" ? tab.status : changeInfo?.status
    });
  }
  if (isCollectorWindowTab && changeInfo?.status === "loading") {
    contentScriptReadyTabs.delete(tabId);
    collectorWindowLifecycle("WaitingContentScript", {
      windowId: collectorWindowState.windowId,
      tabId,
      currentProjectId: collectorWindowState.currentProjectId
    });
  }
  if (isCollectorWindowTab
    && (changeInfo?.discarded === true || changeInfo?.frozen === true)) {
    markCollectorRequestMediumLost(
      tabId,
      tab?.windowId,
      changeInfo.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen");
    collectorWindowLifecycle("Recoverable", {
      windowId: collectorWindowState.windowId,
      tabId,
      currentProjectId: null,
      projectIndex: -1
    });
    diagnostic("collector tab recovery requested", {
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      target_tab_id: tabId,
      tab_active: tab?.active === true,
      tab_discarded: tab?.discarded === true,
      tab_frozen: tab?.frozen === true,
      tab_auto_discardable: tab?.autoDiscardable,
      status: "requested",
      error_code: changeInfo.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen",
      stage: "collector_tab_state_changed"
    });
  }
  if (isManagedExecutionTab
    && ["status", "active", "discarded", "frozen", "autoDiscardable", "url"]
      .some((key) => Object.prototype.hasOwnProperty.call(changeInfo || {}, key))) {
    recordManagedTabLifecycleTelemetry("tabs_on_updated", {
      status: "observed",
      stage: "tabs_on_updated"
    }, tabId, tab);
  }
  if (isManagedExecutionTab
    && (changeInfo?.discarded === true || changeInfo?.frozen === true)) {
    diagnostic("managed execution tab recovery requested", {
      ...managedTabTrace({ target_tab_id: tabId }),
      status: "requested",
      error_code: changeInfo.discarded === true ? "managed_tab_discarded" : "managed_tab_frozen",
      stage: "managed_execution_tab_state_changed"
    });
    clearManagedTabState("PreparingTab");
    void scheduleManagedMediumRecovery(tabId, tab.windowId, "managed_tab_state_changed");
    return;
  }
  if (isManagedExecutionTab
    && changeInfo?.status === "loading") {
    contentScriptReadyTabs.delete(tabId);
    managedTabLifecycle("WaitingContentScript", {
      tabId,
      contentReady: false,
      conversationReady: false,
      composerReady: false,
      watcherReady: false
    });
    diagnostic("managed tab loading", {
      target_tab_id: tabId,
      status: "pending",
      stage: "managed_tab_loading"
    });
  }
  if (changeInfo?.status === "complete") {
    if (isManagedExecutionTab) {
      managedTabLifecycle("WaitingContentScript", {
        tabId,
        contentReady: false,
        conversationReady: false,
        composerReady: false,
        watcherReady: false
      });
    }
    void recoverPendingHandoffSendsForTab(tabId);
    void rearmResponseWatchesForTab(tabId);
  }
  if (isManagedExecutionTab) {
    void enforceManagedExecutionTab(tab, {
      status: "observed",
      stage: "tabs_on_updated_enforce"
    }).catch((error) => {
      diagnostic("managed execution tab state enforcement failed", {
        ...managedTabTrace({ target_tab_id: tabId }),
        error_code: error?.code || "managed_execution_tab_state_failed",
        status: "error",
        stage: error?.stage || "tabs_on_updated_enforce"
      });
    });
  }
});

chrome.tabs.onCreated?.addListener?.((tab) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || tab?.windowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab created in managed window", {
    status: "observed",
    stage: "collector_tabs_on_created",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tab?.id,
    event_window_id: tab?.windowId,
    tab_active: tab?.active === true,
    tab_discarded: tab?.discarded === true,
    tab_frozen: tab?.frozen === true,
    tab_auto_discardable: tab?.autoDiscardable,
    tab_status: tab?.status
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tab?.id,
    event_window_id: tab?.windowId,
    stage: "collector_tabs_on_created"
  });
});

chrome.tabs.onAttached?.addListener?.((tabId, attachInfo) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || attachInfo?.newWindowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab attached to managed window", {
    status: "observed",
    stage: "collector_tabs_on_attached",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tabId,
    event_window_id: attachInfo?.newWindowId
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tabId,
    event_window_id: attachInfo?.newWindowId,
    stage: "collector_tabs_on_attached"
  });
});

chrome.tabs.onDetached?.addListener?.((tabId, detachInfo) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || detachInfo?.oldWindowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab detached from managed window", {
    status: "observed",
    stage: "collector_tabs_on_detached",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tabId,
    event_window_id: detachInfo?.oldWindowId
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tabId,
    event_window_id: detachInfo?.oldWindowId,
    stage: "collector_tabs_on_detached"
  });
});

chrome.tabs.onActivated?.addListener?.((activeInfo) => {
  const hasCollectorWindow = Number.isSafeInteger(collectorWindowState.windowId);
  if (hasCollectorWindow) {
    diagnostic("collector tab activated", {
      status: "observed",
      stage: "collector_tabs_on_activated",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      target_tab_id: activeInfo?.tabId,
      event_tab_id: activeInfo?.tabId,
      event_window_id: activeInfo?.windowId,
      tab_active: activeInfo?.windowId === collectorWindowState.windowId
        && activeInfo?.tabId === collectorWindowState.tabId
    });
    if (activeInfo?.windowId === collectorWindowState.windowId) {
      diagnostic("collector tab activation restore requested", {
        collector_window_id: collectorWindowState.windowId,
        collector_tab_id: collectorWindowState.tabId,
        target_tab_id: activeInfo?.tabId,
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId,
        status: "requested",
        stage: "collector_tab_activation_restore"
      });
      void queueCollectorTabTopologyRepair({
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId,
        stage: "collector_tab_activation_restore"
      });
    }
  }
  if (!Number.isSafeInteger(managedTabState.tabId)) return;
  recordManagedTabLifecycleTelemetry("tabs_on_activated", {
    status: "observed",
    stage: "tabs_on_activated",
    event_tab_id: activeInfo?.tabId,
    event_window_id: activeInfo?.windowId
  }, managedTabState.tabId, null, activeInfo?.windowId);
  if (activeInfo?.windowId === managedTabState.executionWindowId
    && activeInfo?.tabId !== managedTabState.tabId
    && typeof chrome.tabs?.get === "function") {
    diagnostic("managed execution tab activation restored", {
      ...managedTabTrace({
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId
      }),
      status: "requested",
      stage: "managed_execution_tab_activation_restore"
    });
    chrome.tabs.get(managedTabState.tabId)
      .then((tab) => enforceManagedExecutionTab(tab, {
        status: "restored",
        stage: "managed_execution_tab_activation_restore"
      }))
      .catch((error) => {
        diagnostic("managed execution tab activation restore failed", {
          ...managedTabTrace({ target_tab_id: managedTabState.tabId }),
          error_code: error?.code || "managed_execution_tab_state_failed",
          status: "error",
          stage: "managed_execution_tab_activation_restore"
        });
      });
  }
});

chrome.windows?.onFocusChanged?.addListener?.((windowId) => {
  const hasCollectorWindow = Number.isSafeInteger(collectorWindowState.windowId);
  if (hasCollectorWindow) {
    diagnostic("collector window focus changed", {
      status: "observed",
      stage: "collector_windows_on_focus_changed",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      collector_window_focused: windowId === collectorWindowState.windowId,
      event_window_id: windowId
    });
    if (windowId === collectorWindowState.windowId
      && typeof chrome.windows?.get === "function") {
      void getCollectorWindow(windowId)
        .then((window) => makeCollectorWindowUsable(window, {
          event_window_id: windowId,
          stage: "collector_window_focus_restore"
        }))
        .then(() => queueCollectorTabTopologyRepair({
          event_window_id: windowId,
          stage: "collector_window_focus_restore"
        }))
        .catch((error) => {
          diagnostic("collector window focus restoration failed", {
            collector_window_id: collectorWindowState.windowId,
            collector_tab_id: collectorWindowState.tabId,
            event_window_id: windowId,
            status: "error",
            error_code: error?.code || "collector_window_focus_restore_failed",
            stage: "collector_window_focus_restore"
          });
        });
    }
  }
  if (!Number.isSafeInteger(managedTabState.tabId)
    && !Number.isSafeInteger(managedTabState.executionWindowId)) return;
  recordManagedTabLifecycleTelemetry("windows_on_focus_changed", {
    status: "observed",
    stage: "windows_on_focus_changed",
    event_window_id: windowId
  }, managedTabState.tabId, null, windowId);
  if (windowId === managedTabState.executionWindowId
    && typeof chrome.windows?.get === "function") {
    diagnostic("managed execution window focus restoration requested", {
      ...managedTabTrace({ event_window_id: windowId }),
      status: "requested",
      stage: "execution_window_focus_restore"
    });
    void getManagedExecutionWindow(windowId)
      .then((window) => makeManagedExecutionWindowUsable(window, {
        event_window_id: windowId,
        stage: "execution_window_focus_restore"
      }))
      .catch((error) => {
        diagnostic("managed execution window focus restoration failed", {
          ...managedTabTrace({ event_window_id: windowId }),
          status: "error",
          error_code: error?.code || "execution_window_focus_restore_failed",
          stage: "execution_window_focus_restore"
        });
      });
  }
});

chrome.tabs.onRemoved?.addListener?.((tabId, removeInfo) => {
  if (tabId === collectorWindowState.tabId) {
    markCollectorRequestMediumLost(tabId, removeInfo?.windowId, "collector_tab_removed");
  }
  if (tabId === collectorWindowState.tabId) {
    collectorWindowState = {
      ...collectorWindowState,
      tabId: null,
      lifecycle: "Recoverable"
    };
    void persistCollectorWindowState();
    diagnostic("collector tab removed", {
      status: "pending",
      stage: "collector_tab_removed",
      target_tab_id: tabId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      collector_window_exists: true
    });
  }
  if (Number.isSafeInteger(collectorWindowState.windowId)
    && removeInfo?.windowId === collectorWindowState.windowId
    && removeInfo?.isWindowClosing !== true) {
    void queueCollectorTabTopologyRepair({
      event_tab_id: tabId,
      event_window_id: removeInfo.windowId,
      stage: "collector_tab_removed"
    });
  }
  if (tabId !== managedTabState.tabId) return;
  contentScriptReadyTabs.delete(tabId);
  recordManagedTabLifecycleTelemetry("tabs_on_removed", {
    status: "error",
    error_code: "managed_tab_closed",
    stage: "tabs_on_removed",
    managed_tab_exists: false
  }, tabId, null, removeInfo?.windowId);
  diagnostic("managed tab removed", {
    ...managedTabTrace({ target_tab_id: tabId }),
    status: "error",
    error_code: "managed_tab_closed",
    stage: "managed_tab_removed"
  });
  clearManagedTabState("Failed");
  void scheduleManagedMediumRecovery(
    tabId,
    removeInfo?.windowId,
    removeInfo?.isWindowClosing === true ? "execution_window_removed" : "managed_tab_removed");
});

chrome.windows?.onRemoved?.addListener?.((windowId) => {
  if (windowId === collectorWindowState.windowId) {
    markCollectorRequestMediumLost(null, windowId, "collector_window_removed");
    const collectorTabId = collectorWindowState.tabId;
    collectorWindowState = { ...defaultCollectorWindowState };
    void persistCollectorWindowState();
    diagnostic("collector window removed", {
      status: "pending",
      stage: "collector_window_removed",
      collector_window_id: windowId,
      collector_tab_id: collectorTabId,
      collector_window_exists: false,
      target_tab_id: collectorTabId
    });
  }
  if (windowId !== managedTabState.executionWindowId) return;
  const managedTabId = managedTabState.tabId;
  recordManagedTabLifecycleTelemetry("windows_on_removed", {
    status: "error",
    error_code: "execution_window_closed",
    stage: "windows_on_removed",
    event_window_id: windowId,
    managed_tab_exists: false
  }, managedTabId, null, windowId);
  diagnostic("managed execution window removed", {
    ...managedTabTrace({
      target_tab_id: managedTabId,
      event_window_id: windowId
    }),
    status: "error",
    error_code: "execution_window_closed",
    stage: "execution_window_removed"
  });
  void scheduleManagedMediumRecovery(managedTabId, windowId, "execution_window_removed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE) {
    handleContextResultFromContent(message, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "context_response_relay_failed" }));
    return true;
  }
  if (message?.type === CHATGPT_CONTEXT_CHANGED_MESSAGE_TYPE) {
    handleContextChangedFromContent(message, _sender)
      .then((forwarded) => sendResponse({ ok: forwarded }))
      .catch(() => sendResponse({ ok: false, error: "context_change_relay_failed" }));
    return true;
  }
  if (message?.type === ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE) {
    // Keep the MV3 service worker event alive until the Review target check
    // and authenticated WebSocket relay have completed. Returning before the
    // async tab lookup can otherwise let the worker suspend and silently lose
    // a valid assistant.response.
    handleAssistantResponseFromContent(message, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "assistant_response_relay_failed" }));
    return true;
  }
  if (message?.type === HANDOFF_SEND_CONFIRMED_MESSAGE_TYPE) {
    handleHandoffSendConfirmedFromContent(message, _sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "handoff_confirmation_relay_failed" }));
    return true;
  }

  const operation = (async () => {
    await stateReady;
    switch (message?.type) {
      case "GET_STATE":
        return { ok: true, state };
      case "CONTENT_SCRIPT_READY":
        if (Number.isSafeInteger(_sender?.tab?.id)) {
          const readyTabId = _sender.tab.id;
          const wasReady = contentScriptReadyTabs.has(readyTabId);
          const context = normalizeCurrentContext(message?.context);
          contentScriptReadyTabs.set(readyTabId, {
            readyAt: Date.now(),
            context
          });
          diagnostic("content script ready", {
            target_tab_id: readyTabId,
            status: "ready",
            stage: "content_script_ready"
          });
          recordManagedTabLifecycleTelemetry(
            wasReady ? "content_script_reconnect" : "content_script_ready",
            {
              status: "ready",
              stage: wasReady ? "content_script_reconnect" : "content_script_ready",
              content_script_alive: true
            },
            readyTabId,
            _sender.tab);
          if (readyTabId === managedTabState.tabId) {
            managedTabLifecycle("WaitingContentScript", {
              tabId: readyTabId,
              contentReady: true
            });
          }
          void recoverPendingHandoffSendsForTab(readyTabId);
          void rearmResponseWatchesForTab(readyTabId);
        }
        return { ok: true, state };
      case "CONNECT":
        return { ok: true, state: await connect() };
      case "PAIR":
        return { ok: true, state: await pair(message.pairingCode) };
      case "DISCONNECT":
        return { ok: true, state: await disconnect() };
      case "PING":
        return { ok: true, pong: await ping(), state };
      default:
        return { ok: false, error: "unsupported_message" };
    }
  })();

  operation.then(sendResponse).catch((error) => sendResponse({ ok: false, error: errorMessage(error), state }));
  return true;
});

ensureReconnectAlarm();
connect().catch(() => {});
