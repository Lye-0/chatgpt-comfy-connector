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
const CONTENT_SCRIPT_TIMEOUT_MS = 15000;
const PAIRING_STORAGE_KEY = "bridgePairing";
const RESPONSE_WATCH_MESSAGE_TYPE = "WATCH_ASSISTANT_RESPONSE";
const ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE = "ASSISTANT_RESPONSE_RESULT";
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
  for (const key of ["request_id", "handoff_id", "media_id", "status", "error_code", "stage"]) {
    if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
    if (typeof fields[key] === "number" && Number.isSafeInteger(fields[key])) safe[key] = fields[key];
  }
  try {
    console.info(`[ChatGPT Comfy Connector] ${eventName}`, safe);
  } catch (_) {
    // Console access must never affect the Bridge transport.
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

function clearResponseWatchesForSocket(bridgeSocket) {
  for (const [requestId, pending] of responseWatches) {
    if (pending.bridgeSocket === bridgeSocket) responseWatches.delete(requestId);
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

function isSameChatGptConversation(actualUrl, expectedUrl) {
  const actual = chatGptConversationKey(actualUrl);
  const expected = chatGptConversationKey(expectedUrl);
  return actual !== null && expected !== null && actual === expected;
}

function handoffResult(message, status, errorCode, text, stage, targetTab = null) {
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
    request_id: trace?.request_id,
    handoff_id: trace?.handoff_id
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
      request_id: trace?.request_id,
      handoff_id: trace?.handoff_id
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["chatgpt-locators.js", "content-script.js"]
    });
    diagnostic("content script injected", {
      request_id: trace?.request_id,
      handoff_id: trace?.handoff_id
    });
    return await sendMessageWithTimeout(tabId, message);
  }
}

function sendHandoffResultToBridge(result, bridgeSocket) {
  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("handoff.result dropped", {
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

  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("assistant response dropped", {
      request_id: response.request_id,
      handoff_id: response.handoff_id,
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
      handoff_id: response.handoff_id,
      status: response.status,
      error_code: response.error_code,
      stage: response.stage
    });
    return true;
  } catch (_) {
    diagnostic("assistant response delivery failed", {
      request_id: response.request_id,
      handoff_id: response.handoff_id,
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
      targetTab = await chrome.tabs.get(message.target_tab_id);
    } catch (_) {
      targetTab = null;
    }

    if (!targetTab
      || targetTab.id !== message.target_tab_id
      || !isChatGptTab(targetTab)
      || !isSameChatGptConversation(targetTab.url, message.target_tab_url)) {
      result = reviewMediaResult(message, "error", "review_target_tab_not_found", "初回Handoffと同じChatGPTタブが見つかりません。", "target_tab_check");
    } else {
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
  responseWatches.set(requestId, {
    tabId,
    sessionId: message.session_id,
    handoffId: message.handoff_id,
    boundaryId: message.boundary_id,
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
      protocol: HANDOFF_PROTOCOL
    }, message);
  } catch (error) {
    responseWatches.delete(requestId);
    const errorCode = "content_script_unavailable";
    const stage = error?.stage || "response_watch_dispatch";
    diagnostic("assistant response watch failed", {
      request_id: requestId,
      handoff_id: message.handoff_id,
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
      stage
    }, bridgeSocket);
    return;
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
      request_id: requestId,
      handoff_id: message.handoff_id,
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
      stage
    }, bridgeSocket);
    return;
  }

  diagnostic("assistant response watch started", {
    request_id: requestId,
    handoff_id: message.handoff_id,
    status: "watching",
    stage: watchResult.stage || "response_watch_started"
  });
}

async function sendHandoffToActiveTab(message, bridgeSocket) {
  let result;
  let activeTabId = null;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const activeTab = tabs?.[0];
    if (!activeTab || !isChatGptTab(activeTab)) {
      result = handoffResult(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    } else if (activeTab.id === undefined) {
      result = handoffResult(message, "error", "content_script_unavailable", "アクティブなChatGPTタブを操作できません。", "tab_id_unavailable");
    } else {
      activeTabId = activeTab.id;
      let contentResult;
      try {
        contentResult = await dispatchToContentScript(activeTab.id, {
          type: "HANDOFF_SEND",
          requestId: message.request_id,
          sessionId: message.session_id,
          handoffId: message.handoff_id,
          boundaryId: message.boundary_id,
          protocol: HANDOFF_PROTOCOL,
          payload: message.payload
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
          result = handoffResult(message, "sent", null, null, contentResult.stage, activeTab);
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
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  const resultSent = sendHandoffResultToBridge(result, bridgeSocket);
  if (resultSent && result.status === "sent" && activeTabId !== null) {
    // Confirm the Phase 2 user message to Desktop first. The response watcher
    // is started on the same tab only after that boundary is durable there.
    await startAssistantResponseWatch(activeTabId, message, bridgeSocket);
  }
}

function handleAssistantResponseFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const sessionId = message?.sessionId || message?.session_id;
  const handoffId = message?.handoffId || message?.handoff_id;
  const boundaryId = message?.boundaryId || message?.boundary_id;
  const pending = responseWatches.get(requestId);
  if (!pending || sender?.tab?.id !== pending.tabId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      handoff_id: handoffId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_watch_context"
    });
    return;
  }
  if (sessionId !== pending.sessionId || handoffId !== pending.handoffId || boundaryId !== pending.boundaryId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      handoff_id: handoffId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_identity_mismatch"
    });
    return;
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
    handoff_id: handoffId,
    status,
    error_code: errorCode,
    stage
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
    stage
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

  if (message.type === "handoff.send") {
    // Background only selects the active tab and relays the request. All DOM
    // discovery and mutation remains in the ChatGPT Content Script.
    diagnostic("background received", {
      request_id: message.request_id,
      handoff_id: message.handoff_id
    });
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
  if (message?.type === ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE) {
    handleAssistantResponseFromContent(message, _sender);
    sendResponse({ ok: true });
    return false;
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
