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
// Execution is intentionally isolated from the user's foreground ChatGPT
// tab. One inactive managed tab is the only tab that may receive a Handoff,
// media attachment, or response watch.
const MANAGED_TAB_STORAGE_KEY = "managedChatGptTab";
const MANAGED_TAB_CREATE_TIMEOUT_MS = 15000;
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
// Context discovery has a separate short-lived tab. It must never borrow the
// Managed Execution Tab, because discovery and execution have different DOM
// lifecycles and a sidebar scan must not reset an active response watcher.
const COLLECTOR_TAB_URL = "https://chatgpt.com/";
const COLLECTOR_TAB_CREATE_TIMEOUT_MS = 15000;
const COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS = 30000;
// A replacement Content Script can become ready before ChatGPT has hydrated
// the newly opened conversation's message list. Keep checking the same
// marker-bearing user message without ever issuing another Handoff send.
const HANDOFF_ACCEPTANCE_RETRY_DELAY_MS = 500;
const HANDOFF_ACCEPTANCE_RETRY_TIMEOUT_MS = CONTENT_SCRIPT_TIMEOUT_MS;
const RESPONSE_WATCH_REARM_DELAY_MS = 500;
const RESPONSE_WATCH_REARM_TIMEOUT_MS = 120000;
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
let socketKeepaliveTimer = null;
let socketKeepaliveSocket = null;
const defaultManagedTabState = {
  tabId: null,
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
let collectorTabState = { tabId: null, lifecycle: "Idle" };
let collectorTabStateOperation = Promise.resolve();

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
    "target_tab_id",
    "content_ready",
    "conversation_ready",
    "composer_ready",
    "watcher_ready"
  ]) {
    if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
    if (typeof fields[key] === "number" && Number.isSafeInteger(fields[key])) safe[key] = fields[key];
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
    ...(managedTabState.conversationId ? { conversation_id: managedTabState.conversationId } : {}),
    ...(managedTabState.conversationUrl ? { conversation_url: managedTabState.conversationUrl } : {}),
    ...fields
  };
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

function clearManagedTabState(lifecycle = "Failed") {
  // The tab is only an execution medium. Preserve the bound Conversation so
  // a later operation can recreate an inactive tab at the same destination.
  managedTabLifecycle(lifecycle, {
    tabId: null,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
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

function withCollectorTabOperation(operation) {
  const next = collectorTabStateOperation.then(operation, operation);
  collectorTabStateOperation = next.catch(() => {});
  return next;
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

function collectorTabLifecycle(lifecycle, fields = {}) {
  collectorTabState = {
    ...collectorTabState,
    lifecycle,
    ...fields
  };
  diagnostic("collector tab lifecycle", {
    lifecycle,
    status: lifecycle === "Failed" ? "error" : "pending",
    stage: `collector_tab_${String(lifecycle || "unknown").toLowerCase()}`,
    target_tab_id: collectorTabState.tabId
  });
}

async function getCollectorTab() {
  if (!Number.isSafeInteger(collectorTabState.tabId) || collectorTabState.tabId < 0) return null;
  try {
    const tab = await chrome.tabs.get(collectorTabState.tabId);
    if (!tab || tab.id === undefined || !isChatGptTab(tab)) {
      collectorTabState = { tabId: null, lifecycle: "Idle" };
      return null;
    }
    return tab;
  } catch (_) {
    collectorTabState = { tabId: null, lifecycle: "Idle" };
    return null;
  }
}

async function createCollectorTab(trace) {
  const existing = await getCollectorTab();
  if (existing) {
    collectorTabLifecycle("Ready", { tabId: existing.id });
    diagnostic("collector tab reused", {
      ...trace,
      status: "reused",
      stage: "collector_tab_reused",
      target_tab_id: existing.id
    });
    return existing;
  }
  if (typeof chrome.tabs.create !== "function") {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }

  collectorTabLifecycle("Preparing", { tabId: null });
  diagnostic("collector tab create requested", {
    ...trace,
    status: "requested",
    stage: "collector_tab_create"
  });
  let created;
  let createTimeout = null;
  try {
    created = await Promise.race([
      chrome.tabs.create({ url: COLLECTOR_TAB_URL, active: false }),
      new Promise((_, reject) => {
        createTimeout = setTimeout(() => reject(bridgeError(
          "ChatGPT Context収集用タブの作成がタイムアウトしました。",
          0,
          "collector_tab_create_timeout")), COLLECTOR_TAB_CREATE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (createTimeout !== null) clearTimeout(createTimeout);
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  collectorTabState = { tabId: created.id, lifecycle: "Preparing" };
  collectorTabLifecycle("Preparing", { tabId: created.id });
  diagnostic("collector tab created", {
    ...trace,
    status: "created",
    stage: "collector_tab_created",
    target_tab_id: created.id
  });

  if (!(await waitForTabReady(created.id, COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS))) {
    collectorTabLifecycle("Failed", { tabId: created.id });
    throw bridgeError(
      "ChatGPT Context収集用タブの読み込みがタイムアウトしました。",
      0,
      "collector_tab_navigation_timeout");
  }
  collectorTabLifecycle("WaitingContentScript", { tabId: created.id });
  return created;
}

async function releaseCollectorTab(tab) {
  if (!tab || collectorTabState.tabId !== tab.id) return;
  collectorTabState = { tabId: null, lifecycle: "Idle" };
  let current = tab;
  try { current = await chrome.tabs.get(tab.id); } catch (_) { current = null; }

  // Never close a collector tab after the user has explicitly brought it to
  // the foreground. The tab was created inactive, but keeping it avoids
  // changing a user's browser state if they chose to inspect it.
  if (current?.active === true || typeof chrome.tabs.remove !== "function") {
    diagnostic("collector tab retained", {
      status: "ready",
      stage: "collector_tab_retained",
      target_tab_id: tab.id
    });
    return;
  }
  try {
    await chrome.tabs.remove(tab.id);
    diagnostic("collector tab released", {
      status: "completed",
      stage: "collector_tab_released",
      target_tab_id: tab.id
    });
  } catch (_) {
    // The tab may already have been closed by the browser. Discovery has
    // completed, so this cleanup failure must not affect its result.
  }
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
    if (!isMissingContentScriptError(error)) throw error;

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

  // Context discovery is deliberately isolated from execution. A temporary
  // inactive Collector Tab can collect the sidebar even when the user has no
  // ChatGPT tab open; it is never reused as the Managed Execution Tab.
  await withCollectorTabOperation(async () => {
    let tab = null;
    const pending = { requestId, currentOnly, bridgeSocket, tabId: null, message: request };
    try {
      if (bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
        await completeContextRequest(
          contextResultError(request, "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection"),
          pending);
        return;
      }
      tab = await createCollectorTab({
        request_id: requestId,
        stage: currentOnly ? "context_current_requested" : "context_list_requested"
      });
      pending.tabId = tab.id;
      contextRequests.set(requestId, pending);
      diagnostic("chatgpt.context request dispatched", {
        request_id: requestId,
        status: "requested",
        stage: currentOnly ? "context_current_requested" : "context_list_requested",
        target_tab_id: tab.id
      });
      const contentResult = await dispatchToContentScript(tab.id, {
        type: "GET_CHATGPT_CONTEXT",
        requestId,
        mode: pending.currentOnly ? "current" : "list"
      }, request, {
        timeoutMs: CONTENT_SCRIPT_TIMEOUT_MS,
        timeoutStage: "collector_content_script_timeout"
      });
      await completeContextRequest(contentResult, pending);
    } catch (error) {
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
  responseWatches.delete(pending.requestId);
  diagnostic("assistant response watch failed", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage
  }));
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

async function recoverManagedTabAfterRemoval(removedTabId) {
  await managedTabStateReady;
  const pendingWatches = [...responseWatches.values()]
    .filter((pending) => pending.tabId === removedTabId);
  const pendingSends = [...pendingHandoffSends.values()]
    .filter((pending) => pending.targetTabId === removedTabId);
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

  if (!conversationId && !conversationUrl) {
    diagnostic("managed tab recovery deferred", {
      status: "pending",
      error_code: "target_conversation_not_found",
      stage: "managed_tab_recovery_identity_missing",
      target_tab_id: removedTabId
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
        status: "ready",
        stage: "managed_tab_recovered"
      });
      await recoverPendingHandoffSendsForTab(newTabId);
      await rearmResponseWatchesForTab(newTabId);
    });
  } catch (error) {
    diagnostic("managed tab recovery failed", {
      ...traceForMessage(recoveryMessage, { target_tab_id: removedTabId }),
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

async function getManagedExecutionTab(trace) {
  await managedTabStateReady;
  if (!Number.isSafeInteger(managedTabState.tabId) || managedTabState.tabId < 0) return null;
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
    return tab;
  } catch (_) {
    diagnostic("managed tab unavailable", {
      ...managedTabTrace(trace),
      status: "error",
      error_code: "managed_tab_closed",
      stage: "managed_tab_lookup"
    });
    clearManagedTabState("Failed");
    return null;
  }
}

async function createManagedExecutionTab(url, trace) {
  if (typeof chrome.tabs.create !== "function") {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  managedTabLifecycle("PreparingTab", {
    tabId: null,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  diagnostic("managed tab create requested", {
    ...trace,
    status: "requested",
    stage: "managed_tab_create"
  });
  let created;
  let createTimeout = null;
  try {
    created = await Promise.race([
      chrome.tabs.create({ url, active: false }),
      new Promise((_, reject) => {
        createTimeout = setTimeout(() => reject(managedTabError(
          "managed_tab_create_timeout",
          "managed_tab_create_timeout",
          "Managed ChatGPTタブの作成がタイムアウトしました.")), MANAGED_TAB_CREATE_TIMEOUT_MS);
      })
    ]);
  } catch (error) {
    throw error?.code ? error : managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  } finally {
    if (createTimeout !== null) clearTimeout(createTimeout);
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  managedTabState = {
    ...defaultManagedTabState,
    tabId: created.id,
    lifecycle: "PreparingTab"
  };
  managedTabLifecycle("PreparingTab", { tabId: created.id });
  diagnostic("managed tab created", {
    ...trace,
    status: "created",
    stage: "managed_tab_created",
    target_tab_id: created.id
  });
  return created;
}

async function navigateManagedExecutionTab(tab, url, trace) {
  if (!tab || tab.id === undefined || typeof chrome.tabs.update !== "function") {
    throw managedTabError("managed_tab_navigation_failed", "managed_tab_navigation", "Managed ChatGPTタブを移動できません。");
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
    target_tab_id: tab.id
  });
  try {
    const updated = await chrome.tabs.update(tab.id, { url, active: false });
    return updated && updated.id !== undefined ? updated : { ...tab, url };
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
  let tab = await getManagedExecutionTab(trace);
  if (!tab) {
    const startUrl = target.newConversation
      ? target.projectUrl || "https://chatgpt.com/"
      : target.conversationUrl || (target.conversationId
        ? `https://chatgpt.com/c/${encodeURIComponent(target.conversationId)}`
        : null);
    if (!startUrl) {
      throw managedTabError("target_conversation_not_found", "target_conversation_check", "保存済みのChatGPT Conversation URLがありません。");
    }
    tab = await createManagedExecutionTab(startUrl, trace);
  } else if (!managedTabMatchesTarget(tab, target)) {
    const destination = target.newConversation
      ? target.projectUrl || "https://chatgpt.com/"
      : target.conversationUrl || (target.conversationId
        ? `https://chatgpt.com/c/${encodeURIComponent(target.conversationId)}`
        : null);
    if (!destination) {
      throw managedTabError("target_conversation_not_found", "target_conversation_check", "保存済みのChatGPT Conversation URLがありません。");
    }
    tab = await navigateManagedExecutionTab(tab, destination, trace);
  } else {
    diagnostic("managed tab reused", {
      ...trace,
      status: "reused",
      stage: "managed_tab_reused",
      target_tab_id: tab.id
    });
  }

  managedTabState = {
    ...managedTabState,
    tabId: tab.id,
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
    rearmDeadline: Date.now() + RESPONSE_WATCH_REARM_TIMEOUT_MS
  };
  responseWatches.set(requestId, pending);

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
    // The Background owns one inactive Managed Execution Tab. All DOM
    // discovery and mutation remains in the ChatGPT Content Script; the
    // user's foreground tab is never selected as an execution target.
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
chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo) => {
  if (Number.isSafeInteger(managedTabState.tabId) && tabId === managedTabState.tabId
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
    if (Number.isSafeInteger(managedTabState.tabId) && tabId === managedTabState.tabId) {
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
});

chrome.tabs.onRemoved?.addListener?.((tabId) => {
  if (tabId === collectorTabState.tabId) {
    collectorTabState = { tabId: null, lifecycle: "Idle" };
    diagnostic("collector tab removed", {
      status: "pending",
      stage: "collector_tab_removed",
      target_tab_id: tabId
    });
  }
  if (tabId !== managedTabState.tabId) return;
  contentScriptReadyTabs.delete(tabId);
  diagnostic("managed tab removed", {
    ...managedTabTrace({ target_tab_id: tabId }),
    status: "error",
    error_code: "managed_tab_closed",
    stage: "managed_tab_removed"
  });
  clearManagedTabState("Failed");
  void recoverManagedTabAfterRemoval(tabId);
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
