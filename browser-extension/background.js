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
const PAIRING_STORAGE_KEY = "bridgePairing";
const RESPONSE_WATCH_MESSAGE_TYPE = "WATCH_ASSISTANT_RESPONSE";
const ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE = "ASSISTANT_RESPONSE_RESULT";
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
let connectPromise = null;
let reconnectTimer = null;
let manualDisconnect = false;
const pendingPings = new Map();
const responseWatches = new Map();
const contextRequests = new Map();
let socketKeepaliveTimer = null;
let socketKeepaliveSocket = null;

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
  for (const key of ["request_id", "session_id", "handoff_id", "boundary_id", "media_id", "status", "error_code", "stage", "target_tab_id"]) {
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

function clearResponseWatchesForSocket(bridgeSocket) {
  for (const [requestId, pending] of responseWatches) {
    if (pending.bridgeSocket === bridgeSocket) responseWatches.delete(requestId);
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
    || text.includes("Could not establish connection");
}

function sendMessageWithTimeout(tabId, message) {
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
      timeoutError.stage = "content_script_timeout";
      finish(reject, timeoutError);
    }, CONTENT_SCRIPT_TIMEOUT_MS);

    try {
      Promise.resolve(chrome.tabs.sendMessage(tabId, message))
        .then((value) => finish(resolve, value))
        .catch((error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }
  });
}

async function dispatchToContentScript(tabId, message, trace) {
  diagnostic("content script dispatched", {
    ...traceForMessage(trace, { target_tab_id: tabId })
  });
  try {
    return await sendMessageWithTimeout(tabId, message);
  } catch (error) {
    // A tab that was already open when the unpacked extension was reloaded
    // may not have received manifest content scripts yet. Inject the same
    // locator/DOM modules through the MV3 scripting API, then retry the
    // message. The injected code is still content-script.js; the background
    // does not inspect or mutate the ChatGPT DOM itself.
    if (!isMissingContentScriptError(error) || !chrome.scripting?.executeScript) throw error;
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
    return await sendMessageWithTimeout(tabId, message);
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

  let tabs;
  try { tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (_) { tabs = []; }
  const tab = tabs?.[0];
  if (!tab || tab.id === undefined || !isChatGptTab(tab)) {
    const pending = { requestId, currentOnly, bridgeSocket, tabId: null, message: request };
    sendChatGptContextResponseToBridge(
      contextResultError(request, "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check"),
      pending);
    return;
  }

  const pending = { requestId, currentOnly, bridgeSocket, tabId: tab.id, message: request };
  contextRequests.set(requestId, pending);
  diagnostic("chatgpt.context request dispatched", {
    request_id: requestId,
    status: "requested",
    stage: currentOnly ? "context_current_requested" : "context_list_requested",
    target_tab_id: tab.id
  });
  try {
    const contentResult = await dispatchToContentScript(tab.id, {
      type: "GET_CHATGPT_CONTEXT",
      requestId,
      mode: pending.currentOnly ? "current" : "list"
    }, request);
    await completeContextRequest(contentResult, pending);
  } catch (error) {
    await completeContextRequest(
      contextResultError(request, "context_extraction_failed", "ChatGPT Content Scriptへ接続できません。", error?.stage || "context_content_script_dispatch"),
      pending);
  }
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

function sendHandoffResultToBridge(result, bridgeSocket, trace = null) {
  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("handoff.result dropped", {
      ...traceForMessage(trace),
      request_id: result.request_id,
      handoff_id: result.handoff_id,
      status: result.status,
      error_code: result.error_code || "bridge_disconnected",
      stage: result.stage || "bridge_disconnected"
    });
    return false;
  }
  try {
    bridgeSocket.send(JSON.stringify(result));
    diagnostic("handoff.result sent", {
      ...traceForMessage(trace),
      request_id: result.request_id,
      handoff_id: result.handoff_id,
      status: result.status,
      error_code: result.error_code,
      stage: result.stage
    });
    return true;
  } catch (_) {
    return false;
  }
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

  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("assistant response dropped", {
      request_id: response.request_id,
      session_id: response.session_id,
      handoff_id: response.handoff_id,
      boundary_id: response.boundary_id,
      status: response.status,
      error_code: response.error_code || "bridge_disconnected",
      stage: response.stage || "bridge_disconnected"
    });
    return false;
  }
  try {
    bridgeSocket.send(JSON.stringify(envelope));
    diagnostic("assistant response sent", {
      request_id: response.request_id,
      session_id: response.session_id,
      handoff_id: response.handoff_id,
      boundary_id: response.boundary_id,
      status: response.status,
      error_code: response.error_code,
      stage: response.stage
    });
    diagnostic("assistant response forwarded", {
      request_id: response.request_id,
      session_id: response.session_id,
      handoff_id: response.handoff_id,
      boundary_id: response.boundary_id,
      status: response.status,
      error_code: response.error_code,
      stage: "assistant_response_forwarded",
      target_tab_id: response.target_tab_id
    });
    return true;
  } catch (_) {
    diagnostic("assistant response delivery failed", {
      request_id: response.request_id,
      session_id: response.session_id,
      handoff_id: response.handoff_id,
      boundary_id: response.boundary_id,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "response_bridge_send"
    });
    return false;
  }
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
    && Number.isSafeInteger(message?.target_tab_id)
    && message.target_tab_id >= 0
    && typeof message?.target_tab_url === "string"
    && message.target_tab_url.length > 0
    && message.target_tab_url.length <= 2048
    && chatGptConversationKey(message.target_tab_url) !== null;
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

async function findOrOpenConversationTarget(conversationId, conversationUrl, trace) {
  const allTabs = await chrome.tabs.query({});
  const matchingTab = (allTabs || []).find((tab) =>
    isChatGptTab(tab)
    && isSameChatGptConversation(tab.url, conversationUrl, conversationId));
  if (matchingTab?.id !== undefined) {
    diagnostic("target conversation tab found", {
      ...trace,
      stage: "target_conversation_found",
      target_tab_id: matchingTab.id
    });
    return matchingTab;
  }

  // Re-open only the exact saved conversation URL.  Never navigate an
  // unrelated ChatGPT tab or guess from a title.
  if (conversationUrl && typeof chrome.tabs.create === "function") {
    try {
      const created = await chrome.tabs.create({ url: conversationUrl, active: true });
      if (created?.id !== undefined) {
        diagnostic("target conversation tab opened", {
          ...trace,
          stage: "target_conversation_opened",
          target_tab_id: created.id
        });
        return created;
      }
    } catch (_) { }
  }
  return null;
}

async function findOrOpenNewConversationTarget(message, targetProjectId, targetProjectUrl, trace) {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs?.[0];
  const activeProjectId = chatGptProjectId(activeTab?.url);
  const activeUrl = safeChatGptContextUrl(activeTab?.url);
  const activeMatchesProject = isChatGptTab(activeTab)
    && chatGptConversationId(activeTab.url) === null
    && (!targetProjectUrl || activeUrl === targetProjectUrl)
    && (!targetProjectId || activeProjectId === targetProjectId);
  if (activeMatchesProject && activeTab.id !== undefined) {
    diagnostic("new conversation tab found", {
      ...trace,
      stage: "new_conversation_target_found",
      target_tab_id: activeTab.id
    });
    return activeTab;
  }

  const newConversationUrl = targetProjectUrl || "https://chatgpt.com/";
  if (typeof chrome.tabs.create === "function") {
    try {
      const created = await chrome.tabs.create({ url: newConversationUrl, active: true });
      if (created?.id !== undefined) {
        diagnostic("new conversation tab opened", {
          ...trace,
          stage: "new_conversation_target_opened",
          target_tab_id: created.id
        });
        return created;
      }
    } catch (_) { }
  }
  return null;
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
    const targetIdentity = conversationTargetFromMessage(message);
    let targetTab;
    if (targetIdentity.errorCode) {
      result = reviewMediaResult(message, "error", targetIdentity.errorCode, "保存済みのChatGPT Conversation情報が不正です。", targetIdentity.errorStage);
    } else if (targetIdentity.conversationId || targetIdentity.conversationUrl) {
      targetTab = await findOrOpenConversationTarget(
        targetIdentity.conversationId,
        targetIdentity.conversationUrl,
        traceForMessage(message, { media_id: message.media_id, target_tab_id: message.target_tab_id }));
    } else {
      try {
        targetTab = await chrome.tabs.get(message.target_tab_id);
      } catch (_) {
        targetTab = null;
      }
    }

    const hasBoundConversation = Boolean(targetIdentity.conversationId || targetIdentity.conversationUrl);
    const targetConversationMatches = hasBoundConversation
      ? isSameChatGptConversation(targetTab?.url, targetIdentity.conversationUrl, targetIdentity.conversationId)
      : isSameChatGptConversation(targetTab?.url, message.target_tab_url);
    if (!result && (!targetTab
      || targetTab.id === undefined
      || (!hasBoundConversation && targetTab.id !== message.target_tab_id)
      || !isChatGptTab(targetTab)
      || !targetConversationMatches)) {
      result = reviewMediaResult(message, "error", "review_target_tab_not_found", "初回Handoffと同じChatGPTタブが見つかりません。", "target_tab_check");
    } else if (!result) {
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
}

async function startAssistantResponseWatch(tabId, message, bridgeSocket) {
  const requestId = message.request_id;
  diagnostic(message.handoff_kind === "review" ? "review response watch requested" : "response watch requested", traceForMessage(message, {
    status: "requested",
    stage: "response_watch_requested",
    target_tab_id: tabId
  }));
  responseWatches.set(requestId, {
    tabId,
    targetTabId: tabId,
    sessionId: message.session_id,
    handoffId: message.handoff_id,
    boundaryId: message.boundary_id,
    isReview: message.handoff_kind === "review",
    targetTabUrl: message.target_tab_url || null,
    targetConversationId: message.target_conversation_id || null,
    targetConversationUrl: message.target_conversation_url || null,
    bridgeSocket
  });

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
      ...(message.handoff_kind === "review" ? { review: true } : {})
    }, message);
  } catch (error) {
    responseWatches.delete(requestId);
    const errorCode = "content_script_unavailable";
    const stage = error?.stage || "response_watch_dispatch";
    diagnostic("assistant response watch failed", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "error",
      error_code: errorCode,
      stage
    });
    sendAssistantResponseToBridge({
      request_id: requestId,
      session_id: message.session_id,
      handoff_id: message.handoff_id,
      boundary_id: message.boundary_id,
      status: "error",
      error_code: errorCode,
      message: "ChatGPTのassistant応答監視を開始できませんでした。",
      stage,
      ...(message.handoff_kind === "review" ? {
        target_tab_id: message.target_tab_id,
        target_tab_url: message.target_tab_url
      } : {})
    }, bridgeSocket);
    return false;
  }

  if (!watchResult
    || watchResult.request_id !== requestId
    || watchResult.session_id !== message.session_id
    || watchResult.handoff_id !== message.handoff_id
    || watchResult.boundary_id !== message.boundary_id
    || watchResult.status !== "watching") {
    responseWatches.delete(requestId);
    const errorCode = watchResult?.error_code || "content_script_unavailable";
    const stage = watchResult?.stage || "response_watch_result_invalid";
    diagnostic("assistant response watch failed", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "error",
      error_code: errorCode,
      stage
    });
    sendAssistantResponseToBridge({
      request_id: requestId,
      session_id: message.session_id,
      handoff_id: message.handoff_id,
      boundary_id: message.boundary_id,
      status: "error",
      error_code: errorCode,
      message: watchResult?.message || "ChatGPTのassistant応答監視を開始できませんでした。",
      stage,
      ...(message.handoff_kind === "review" ? {
        target_tab_id: message.target_tab_id,
        target_tab_url: message.target_tab_url
      } : {})
    }, bridgeSocket);
    return false;
  }

  diagnostic("response watch armed", {
    ...traceForMessage(message, { target_tab_id: tabId }),
    status: "watching",
    stage: "response_watch_armed",
    target_tab_id: tabId
  });
  return true;
}

async function resolveHandoffTarget(message) {
  const identity = conversationTargetFromMessage(message);
  if (identity.errorCode) {
    return {
      tab: null,
      error: handoffResult(message, "error", identity.errorCode, "ChatGPTの対象Conversation情報が不正です。", identity.errorStage)
    };
  }

  const hasNewConversation = message?.new_conversation !== undefined
    && message?.new_conversation !== null;
  if (hasNewConversation && typeof message.new_conversation !== "boolean") {
    return {
      tab: null,
      error: handoffResult(message, "error", "target_conversation_invalid", "新しいChatの送信指定が不正です。", "target_conversation_check")
    };
  }

  const hasProjectId = message?.target_project_id !== undefined
    && message?.target_project_id !== null;
  const targetProjectId = safeContextIdentifier(message?.target_project_id);
  if (hasProjectId && !targetProjectId) {
    return {
      tab: null,
      error: handoffResult(message, "error", "target_project_invalid", "ChatGPTの対象Project情報が不正です。", "target_project_check")
    };
  }

  const hasProjectUrl = message?.target_project_url !== undefined
    && message?.target_project_url !== null;
  const rawProjectUrl = typeof message?.target_project_url === "string"
    ? message.target_project_url.trim()
    : "";
  const canonicalProjectOrRootUrl = safeChatGptContextUrl(rawProjectUrl);
  const targetProjectUrl = canonicalProjectOrRootUrl === "https://chatgpt.com/"
    ? canonicalProjectOrRootUrl
    : safeChatGptProjectUrl(rawProjectUrl);
  if (hasProjectUrl && (!targetProjectUrl || (targetProjectId && chatGptProjectId(targetProjectUrl) !== targetProjectId))) {
    return {
      tab: null,
      error: handoffResult(message, "error", "target_project_invalid", "ChatGPTの対象Project URLが不正です。", "target_project_check")
    };
  }

  const trace = traceForMessage(message);
  if (message?.new_conversation === true) {
    if (identity.conversationId || identity.conversationUrl) {
      return {
        tab: null,
        error: handoffResult(message, "error", "target_conversation_invalid", "新しいChatに既存Conversationを同時指定できません。", "target_conversation_check")
      };
    }
    const newTab = await findOrOpenNewConversationTarget(message, targetProjectId, targetProjectUrl, trace);
    if (newTab?.id !== undefined) return { tab: newTab, error: null };
    return {
      tab: null,
      error: handoffResult(message, "error", "new_conversation_target_not_found", "新しいChatGPT Conversationを安全に開けません。", "new_conversation_target_check")
    };
  }

  if (identity.conversationId || identity.conversationUrl) {
    const targetTab = await findOrOpenConversationTarget(
      identity.conversationId,
      identity.conversationUrl,
      trace);
    if (targetTab?.id !== undefined) return { tab: targetTab, error: null };
    return {
      tab: null,
      error: handoffResult(message, "error", "target_conversation_not_found", "保存済みのChatGPT Conversationを安全に開けません。", "target_conversation_check")
    };
  }

  if (message?.handoff_kind === "review") {
    if (!Number.isSafeInteger(message.target_tab_id) || message.target_tab_id < 0
      || typeof message.target_tab_url !== "string"
      || chatGptConversationKey(message.target_tab_url) === null) {
      return {
        tab: null,
        error: handoffResult(message, "error", "review_target_tab_not_found", "初回Handoffと同じChatGPTタブ情報がありません。", "target_tab_check")
      };
    }

    try {
      const targetTab = await chrome.tabs.get(message.target_tab_id);
      if (!targetTab
        || targetTab.id !== message.target_tab_id
        || !isChatGptTab(targetTab)
        || !isSameChatGptConversation(targetTab.url, message.target_tab_url)) {
        return {
          tab: null,
          error: handoffResult(message, "error", "review_target_tab_not_found", "初回Handoffと同じChatGPTタブが見つかりません。", "target_tab_check")
        };
      }
      diagnostic("review target tab found", {
        ...trace,
        stage: "target_tab_found",
        target_tab_id: targetTab.id
      });
      return { tab: targetTab, error: null };
    } catch (_) {
      return {
        tab: null,
        error: handoffResult(message, "error", "review_target_tab_not_found", "初回Handoffと同じChatGPTタブを確認できません。", "target_tab_check")
      };
    }
  }

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs?.[0];

  if (!activeTab || !isChatGptTab(activeTab)) {
    return {
      tab: null,
      error: handoffResult(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check")
    };
  }
  if (activeTab.id === undefined) {
    return {
      tab: null,
      error: handoffResult(message, "error", "content_script_unavailable", "アクティブなChatGPTタブを操作できません。", "tab_id_unavailable")
    };
  }
  return { tab: activeTab, error: null };
}

async function sendHandoffToActiveTab(message, bridgeSocket) {
  let result;
  let activeTabId = null;
  try {
    const target = await resolveHandoffTarget(message);
    const targetTab = target.tab;
    if (target.error) {
      result = target.error;
    } else {
      activeTabId = targetTab.id;
      let contentResult;
      try {
        contentResult = await dispatchToContentScript(targetTab.id, {
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
        }, message);
      } catch (error) {
        const errorCode = error?.code === "send_failed" ? "send_failed" : "content_script_unavailable";
        const stage = error?.stage || (errorCode === "send_failed" ? "content_script_timeout" : "content_script_dispatch");
        diagnostic("content script dispatch failed", {
          request_id: message.request_id,
          handoff_id: message.handoff_id,
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
          result = handoffResult(message, "error", "content_script_unavailable", "Content Scriptから有効な送信結果を受け取れませんでした。", "content_result_invalid");
        } else if (contentResult.status === "sent") {
          // A new Chat starts at the project/root URL, then ChatGPT replaces
          // it with the newly created conversation URL after the first user
          // message is accepted. Refresh the tab metadata before persisting
          // the result so the legacy target-tab fallback also retains the
          // current conversation URL when the Content Script could not yet
          // report a conversation identity.
          let resultTargetTab = targetTab;
          if (message.new_conversation === true && targetTab?.id !== undefined) {
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
    }
  } catch (_) {
    result = handoffResult(message, "error", "content_script_unavailable", "アクティブなChatGPTタブを確認できませんでした。", "active_tab_check");
  }

  diagnostic("result status", {
    ...traceForMessage(message, { target_tab_id: activeTabId }),
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  if (result.status === "sent" && activeTabId !== null) {
    // Arm the response watcher before acknowledging handoff.result. ChatGPT
    // may begin generating immediately after the user message is accepted;
    // arming afterwards creates a race in which a fast Review response can be
    // emitted before the Background has a correlation entry. Desktop already
    // queues an assistant.response that races SENT persistence, so this order
    // preserves both transport boundaries without weakening validation.
    await startAssistantResponseWatch(activeTabId, message, bridgeSocket);
  }
  const resultSent = sendHandoffResultToBridge(result, bridgeSocket, message);
  if (resultSent && result.status === "sent") {
    diagnostic(message.handoff_kind === "review" ? "review handoff sent" : "handoff sent", {
      ...traceForMessage(message, { target_tab_id: activeTabId }),
      request_id: result.request_id,
      handoff_id: result.handoff_id,
      status: result.status,
      stage: message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent"
    });
  }
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
    const hasBoundConversation = Boolean(pending.targetConversationId || pending.targetConversationUrl);
    const targetConversationMatches = hasBoundConversation
      ? isSameChatGptConversation(targetTab?.url, pending.targetConversationUrl, pending.targetConversationId)
      : isSameChatGptConversation(targetTab?.url, pending.targetTabUrl);
    if (!targetTab
      || targetTab.id !== pending.tabId
      || !isChatGptTab(targetTab)
      || !targetConversationMatches) {
      responseWatches.delete(requestId);
      diagnostic("assistant response rejected", {
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
        target_tab_url: pending.targetTabUrl
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
      target_tab_url: pending.targetTabUrl
    } : {})
  }, pending.bridgeSocket);
}

function handleBridgeMessage(message, bridgeSocket) {
  if (!message || typeof message !== "object") return;

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
    // Background only selects the active tab and relays the request. All DOM
    // discovery and mutation remains in the ChatGPT Content Script.
    diagnostic("background received", traceForMessage(message, {
      stage: message.handoff_kind === "review" ? "review_handoff_received" : "handoff_received"
    }));
    void sendHandoffToActiveTab(message, bridgeSocket);
    return;
  }

  if (message.type === "review.media.attach") {
    // The Background owns authenticated media retrieval and tab routing. The
    // Content Script receives only bounded file chunks and never contacts the
    // localhost Bridge itself.
    void sendReviewMediaToTarget(message, bridgeSocket);
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
      clearResponseWatchesForSocket(candidate);
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
  sessionToken = null;
  stopSocketKeepalive(current);
  closePendingPings(new Error("Disconnected by the user."));
  clearResponseWatchesForSocket(current);
  clearContextRequestsForSocket(current);
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

  const operation = (async () => {
    await stateReady;
    switch (message?.type) {
      case "GET_STATE":
      case "CONTENT_SCRIPT_READY":
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
