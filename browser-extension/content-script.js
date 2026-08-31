// The Content Script is the only Extension layer allowed to inspect or
// mutate the ChatGPT page. It never opens a localhost connection; all
// transport/authentication remains in background.js.
(() => {
  "use strict";

  const statusEventName = "chatgpt-comfy-connector:bridge-status";
  const handoffMessageType = "HANDOFF_SEND";
  const contextRequestMessageType = "GET_CHATGPT_CONTEXT";
  const contextChangedMessageType = "CHATGPT_CONTEXT_CHANGED";
  const responseWatchMessageType = "WATCH_ASSISTANT_RESPONSE";
  const responseResultMessageType = "ASSISTANT_RESPONSE_RESULT";
  const reviewMediaAttachBeginMessageType = "REVIEW_MEDIA_ATTACH_BEGIN";
  const reviewMediaAttachChunkMessageType = "REVIEW_MEDIA_ATTACH_CHUNK";
  const reviewMediaAttachEndMessageType = "REVIEW_MEDIA_ATTACH_END";
  const sendAcceptanceTimeoutMs = 8000;
  const newConversationBindingTimeoutMs = 5000;
  const composerStateTimeoutMs = 1500;
  // ChatGPT can keep the composer Send control disabled while a Review video
  // is being processed even after the attachment chip is visible.  Review
  // sends therefore get a bounded readiness window of their own; normal
  // Bootstrap sends keep the shorter interactive timeout.
  const reviewComposerStateTimeoutMs = 60000;
  const attachmentControlTimeoutMs = 1500;
  const attachmentVerificationTimeoutMs = 15000;
  const maxMediaBytes = 512 * 1024 * 1024;
  const maxMediaChunkBase64Length = 96 * 1024;
  const responseTimeoutMs = 120000;
  const responseStabilityMs = 900;
  const responsePollIntervalMs = 100;
  const locators = globalThis.ChatGptComfyConnectorLocators;
  const responseAnchors = new Map();
  const responseWatchers = new Map();
  const mediaTransfers = new Map();
  let contextMonitorTimer = null;
  let lastContextFingerprint = null;
  // The browser page is the source of truth for the visible attachment. This
  // short-lived map only remembers which authenticated media request was
  // verified during the current content-script lifetime; the DOM check below
  // is still required immediately before every Review send.
  const verifiedReviewAttachments = new Map();

  // Keep page diagnostics limited to request identity, stage, and the
  // outcome. The session token and Handoff body are never logged by the
  // Content Script.
  function diagnostic(eventName, fields = {}) {
    const safe = {};
    for (const key of [
      "request_id",
      "session_id",
      "handoff_id",
      "boundary_id",
      "status",
      "error_code",
      "stage",
      "media_id",
      "iteration",
      "target_tab_id",
      "composer_type",
      "protocol_found",
      "handoff_id_found",
      "boundary_id_found"
    ]) {
      if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
      if (typeof fields[key] === "boolean") safe[key] = fields[key];
    }
    try {
      console.info(`[ChatGPT Comfy Connector] ${eventName}`, safe);
    } catch (_) {
      // Console access must never affect DOM automation.
    }
  }

  function traceForMessage(message, fields = {}) {
    return {
      request_id: message?.requestId ?? message?.request_id,
      session_id: message?.sessionId ?? message?.session_id,
      handoff_id: message?.handoffId ?? message?.handoff_id,
      boundary_id: message?.boundaryId ?? message?.boundary_id,
      target_tab_id: message?.targetTabId ?? message?.target_tab_id,
      ...fields
    };
  }

  function resultFor(message, status, errorCode, text, stage) {
    const result = {
      request_id: message?.requestId || "",
      handoff_id: message?.handoffId || "",
      status
    };
    if (errorCode) result.error_code = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    diagnostic("content script result", result);
    return result;
  }

  function responseResultFor(message, status, errorCode, text, stage, payload) {
    const result = {
      request_id: message?.requestId || "",
      session_id: message?.sessionId || "",
      handoff_id: message?.handoffId || "",
      boundary_id: message?.boundaryId || "",
      status
    };
    if (payload) result.payload = payload;
    if (errorCode) result.error_code = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    return result;
  }

  function contextResultFor(message, status, errorCode, text, stage, data = {}) {
    const result = {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message?.requestId || message?.request_id || "",
      mode: message?.mode === "current" ? "current" : "list",
      status,
      projects: Array.isArray(data.projects) ? data.projects : [],
      conversations: Array.isArray(data.conversations) ? data.conversations : [],
      current: data.current || null
    };
    if (errorCode) result.errorCode = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    return result;
  }

  async function handleGetChatGptContext(message) {
    if (!locators || !locators.isChatGptPage()) {
      return contextResultFor(
        message,
        "error",
        "active_tab_not_chatgpt",
        "アクティブなタブはChatGPTではありません。",
        "active_tab_check");
    }

    try {
      const currentOnly = message?.mode === "current";
      let value;
      if (currentOnly) {
        value = locators.getCurrentChatGptContext?.(document, globalThis.location?.href);
      } else if (typeof locators.collectChatGptContextAsync === "function") {
        value = await locators.collectChatGptContextAsync(document, globalThis.location?.href);
      } else {
        value = locators.collectChatGptContext?.(document, globalThis.location?.href);
      }
      if (!value) {
        return contextResultFor(message, "error", "context_extraction_failed", "ChatGPTのContextを取得できませんでした。", "context_extraction");
      }
      return contextResultFor(message, "ok", null, null, "context_extracted", currentOnly
        ? { current: value }
        : value);
    } catch (_) {
      // Metadata discovery must not expose page text or DOM errors to the
      // authenticated Bridge. The Desktop receives only a stable error code.
      return contextResultFor(message, "error", "context_extraction_failed", "ChatGPTのContext取得に失敗しました。", "context_extraction");
    }
  }

  function contextFingerprint(context) {
    if (!context || typeof context !== "object") return "";
    return [
      context.conversation_id || context.conversationId || "",
      context.project_id || context.projectId || "",
      context.url || "",
      context.title || ""
    ].join("\u001f");
  }

  function emitCurrentContext() {
    if (!locators?.getCurrentChatGptContext || !locators.isChatGptPage()) return;
    let context;
    try { context = locators.getCurrentChatGptContext(document, globalThis.location?.href); } catch (_) { return; }
    const fingerprint = contextFingerprint(context);
    if (fingerprint === lastContextFingerprint) return;
    lastContextFingerprint = fingerprint;
    Promise.resolve(chrome.runtime.sendMessage({
      type: contextChangedMessageType,
      context
    })).catch(() => {});
  }

  function scheduleCurrentContextNotification() {
    if (contextMonitorTimer !== null) clearTimeout(contextMonitorTimer);
    contextMonitorTimer = setTimeout(() => {
      contextMonitorTimer = null;
      emitCurrentContext();
    }, 350);
  }

  function installContextMonitor() {
    if (!locators?.isChatGptPage?.() || globalThis.__chatgptComfyContextMonitorInstalled) return;
    globalThis.__chatgptComfyContextMonitorInstalled = true;

    const historyObject = globalThis.history;
    if (historyObject) {
      for (const methodName of ["pushState", "replaceState"]) {
        const original = historyObject[methodName];
        if (typeof original !== "function") continue;
        historyObject[methodName] = function (...args) {
          const result = original.apply(this, args);
          scheduleCurrentContextNotification();
          return result;
        };
      }
    }
    globalThis.addEventListener?.("popstate", scheduleCurrentContextNotification);
    globalThis.addEventListener?.("hashchange", scheduleCurrentContextNotification);

    const MutationObserverConstructor = globalThis.MutationObserver;
    if (typeof MutationObserverConstructor === "function") {
      const observationTarget = document.documentElement || document.body || document;
      try {
        const observer = new MutationObserverConstructor(scheduleCurrentContextNotification);
        observer.observe(observationTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href", "aria-current", "data-active", "data-state"]
        });
      } catch (_) { }
    }
    emitCurrentContext();
  }

  function responseCorrelationKey(message) {
    return [message?.requestId, message?.sessionId, message?.handoffId, message?.boundaryId]
      .map((value) => String(value || ""))
      .join("|");
  }

  function hasResponseContext(message) {
    return [message?.requestId, message?.sessionId, message?.handoffId, message?.boundaryId, message?.protocol]
      .every((value) => typeof value === "string" && value.trim().length > 0);
  }

  function hasRequiredInputMarkers(markers) {
    return [markers?.protocol, markers?.handoffId, markers?.boundaryId]
      .every((value) => typeof value === "string" && value.trim().length > 0);
  }

  function createInputEvent(type, payload) {
    try {
      return new InputEvent(type, {
        bubbles: true,
        cancelable: type === "beforeinput",
        composed: true,
        inputType: "insertText",
        data: payload
      });
    } catch (_) {
      return new Event(type, { bubbles: true, cancelable: type === "beforeinput" });
    }
  }

  function selectAll(element) {
    if (typeof element.select === "function") {
      element.select();
      return true;
    }
    const ownerDocument = element.ownerDocument;
    const selection = ownerDocument?.getSelection?.();
    if (!selection) return false;
    const range = ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  function setTextareaValue(element, payload) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
    if (!descriptor?.set) throw new Error("Textarea native value setter is unavailable.");
    descriptor.set.call(element, payload);
    // Native setter + one input event is the controlled-textarea path. Do not
    // combine it with execCommand or a second synthetic input event.
    element.dispatchEvent(createInputEvent("input", payload));
  }

  function tryPasteContentEditableValue(element, payload) {
    const DataTransferConstructor = globalThis.DataTransfer;
    const ClipboardEventConstructor = globalThis.ClipboardEvent;
    if (typeof DataTransferConstructor !== "function" || typeof ClipboardEventConstructor !== "function") return false;

    try {
      const transfer = new DataTransferConstructor();
      transfer.setData("text/plain", payload);
      const accepted = element.dispatchEvent(new ClipboardEventConstructor("paste", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData: transfer
      }));
      return accepted;
    } catch (_) {
      return false;
    }
  }

  function setContentEditableValue(element, payload) {
    element.focus({ preventScroll: true });
    if (!selectAll(element)) throw new Error("Contenteditable selection is unavailable.");

    // execCommand is used only for contenteditable. It performs an actual
    // browser editing operation and lets Chromium emit the editor's input
    // event; directly assigning textContent would only create a visual flash
    // and React could immediately restore its previous state.
    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, payload);
    } catch (_) {
      inserted = false;
    }

    if (inserted) return;

    // Some editor builds handle a paste event but reject execCommand. This is
    // a conditional fallback only after the first editing operation failed;
    // it is never layered with a direct DOM assignment or a synthetic input.
    if (!selectAll(element) || !tryPasteContentEditableValue(element, payload)) {
      throw new Error("Contenteditable insertText was not accepted.");
    }
  }

  function composerType(element) {
    if (element?.tagName?.toLowerCase() === "textarea") return "textarea";
    if (element?.isContentEditable || element?.getAttribute("contenteditable") === "true") return "contenteditable";
    return "unknown";
  }

  async function waitForComposerInput(markers, preferredComposer) {
    const deadline = Date.now() + composerStateTimeoutMs;
    let lastStatus = null;
    while (Date.now() < deadline) {
      const current = locators.findComposer?.()
        || (preferredComposer?.isConnected === false ? null : preferredComposer);
      if (current) {
        lastStatus = locators.getComposerInputMarkerStatus(current, markers);
        if (lastStatus.all) return { composer: current, status: lastStatus };
      }
      await wait(25);
    }
    return { composer: null, status: lastStatus };
  }

  async function fillComposer(element, payload, markers) {
    element.focus({ preventScroll: true });
    if (element instanceof HTMLTextAreaElement || element.tagName?.toLowerCase() === "textarea") {
      if (!selectAll(element)) throw new Error("Textarea selection is unavailable.");
      setTextareaValue(element, payload);
    } else {
      setContentEditableValue(element, payload);
    }

    return waitForComposerInput(markers, element);
  }

  function mediaResultFor(message, status, errorCode, text, stage) {
    const result = {
      request_id: message?.requestId || "",
      session_id: message?.sessionId || "",
      iteration: message?.iteration,
      media_id: message?.mediaId || "",
      status
    };
    if (errorCode) result.error_code = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    diagnostic("content script media result", result);
    return result;
  }

  function hasValidMediaMetadata(message) {
    return typeof message?.requestId === "string"
      && message.requestId.length > 0
      && typeof message?.sessionId === "string"
      && message.sessionId.length > 0
      && Number.isSafeInteger(message?.iteration)
      && message.iteration > 0
      && typeof message?.mediaId === "string"
      && message.mediaId.length > 0
      && typeof message?.fileName === "string"
      && message.fileName.length > 0
      && message.fileName.length <= 255
      && !/[\\/\r\n"\u0000]/.test(message.fileName)
      && typeof message?.mimeType === "string"
      && ["video/mp4", "image/png", "image/jpeg", "image/webp"].includes(message.mimeType.toLowerCase())
      && Number.isSafeInteger(message?.size)
      && message.size > 0
      && message.size <= maxMediaBytes;
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxMediaChunkBase64Length) return null;
    try {
      if (typeof globalThis.atob === "function") {
        const binary = globalThis.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }
    } catch (_) {
      return null;
    }

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = value.replace(/=+$/, "");
    if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) return null;
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const character of clean) {
      buffer = (buffer << 6) | alphabet.indexOf(character);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    return new Uint8Array(bytes);
  }

  function mediaRequestMatchesTransfer(message, transfer) {
    return Boolean(transfer)
      && transfer.requestId === message?.requestId
      && transfer.sessionId === message?.sessionId
      && transfer.iteration === message?.iteration
      && transfer.mediaId === message?.mediaId;
  }

  function fileInputHasExpectedFile(fileInput, transfer) {
    const file = fileInput?.files?.[0];
    return Boolean(file
      && file.name === transfer.fileName
      && file.size === transfer.size
      && (!file.type || file.type.toLowerCase() === transfer.mimeType));
  }

  async function waitForAttachmentVerification(composer, transfer) {
    const deadline = Date.now() + attachmentVerificationTimeoutMs;
    let sawIndicator = false;
    let sawUploading = false;
    while (Date.now() < deadline) {
      const currentComposer = locators.findComposer?.() || composer;
      const indicator = locators.findAttachmentByFilename?.(document, transfer.fileName, currentComposer);
      if (indicator) {
        sawIndicator = true;
        const uploading = Boolean(locators.isAttachmentUploading?.(indicator));
        sawUploading ||= uploading;
        const isNewIndicator = !transfer.baselineIndicators?.has(indicator);
        const inputChanged = transfer.fileInput?.files?.[0]
          && transfer.fileInput.files[0] !== transfer.previousFile;
        const fileInputReady = fileInputHasExpectedFile(transfer.fileInput, transfer);
        diagnostic("attachment upload state", {
          stage: uploading ? "attachment_uploading" : "attachment_verified"
        });
        // A stale chip with the same filename is not sufficient. Either a
        // newly rendered indicator or the newly injected File must be present.
        if (!uploading && (isNewIndicator || (fileInputReady && inputChanged))) {
          return { verified: true, stage: "attachment_verified" };
        }
      }
      await wait(100);
    }
    return {
      verified: false,
      errorCode: sawUploading ? "attachment_timeout" : "attachment_verification_failed",
      stage: sawUploading ? "attachment_uploading" : (sawIndicator ? "attachment_verification" : "attachment_control_found")
    };
  }

  async function handleReviewMediaAttachBegin(message) {
    diagnostic("attachment begin requested", {
      request_id: message?.requestId,
      media_id: message?.mediaId,
      iteration: message?.iteration,
      stage: "attachment_control_requested"
    });
    if (!locators || !locators.isChatGptPage()) {
      return mediaResultFor(message, "error", "review_target_tab_not_found", "対象ページはChatGPTではありません。", "active_tab_check");
    }
    if (!hasValidMediaMetadata(message)) {
      return mediaResultFor(message, "error", "media_registration_failed", "添付メタデータが不正です。", "media_request_validation");
    }

    const composer = locators.findComposer?.();
    if (!composer) return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTの入力欄が見つかりません。", "attachment_control_found");
    let fileInput = locators.findFileInput?.(document, composer);
    if (!fileInput) {
      // The file input may be mounted only after ChatGPT's explicit
      // attachment control opens its menu. Do not click a generic toolbar
      // button: the locator helper returns only semantically attachment-like
      // controls in the composer scope.
      const attachmentControl = locators.findAttachmentControl?.(document, composer);
      if (attachmentControl) {
        try { attachmentControl.click(); } catch (_) { }
        const deadline = Date.now() + attachmentControlTimeoutMs;
        while (Date.now() < deadline && !fileInput) {
          fileInput = locators.findFileInput?.(document, composer);
          if (!fileInput) await wait(50);
        }
      }
    }
    if (!fileInput) {
      return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTのファイル添付入力が見つかりません。", "attachment_control_found");
    }

    mediaTransfers.set(message.requestId, {
      requestId: message.requestId,
      sessionId: message.sessionId,
      iteration: message.iteration,
      mediaId: message.mediaId,
      fileName: message.fileName,
      mimeType: message.mimeType.toLowerCase(),
      size: message.size,
      composer,
      fileInput,
      previousFile: fileInput.files?.[0] || null,
      baselineIndicators: new Set(locators.findAttachmentIndicators?.(document, message.fileName, composer) || []),
      chunks: [],
      received: 0
    });
    diagnostic("attachment control found", {
      request_id: message.requestId,
      media_id: message.mediaId,
      iteration: message.iteration,
      stage: "attachment_control_found"
    });
    return mediaResultFor(message, "receiving", null, null, "attachment_control_found");
  }

  function handleReviewMediaAttachChunk(message) {
    const transfer = mediaTransfers.get(message?.requestId);
    if (!mediaRequestMatchesTransfer(message, transfer)) {
      return mediaResultFor(message, "error", "attachment_input_failed", "添付データの受信状態が見つかりません。", "attachment_chunk_context");
    }
    const bytes = decodeBase64(message.chunk);
    const expectedOffset = transfer.received;
    if (!bytes || message.offset !== expectedOffset || transfer.received + bytes.length > transfer.size) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "添付データを正しく受信できませんでした。", "attachment_chunk_validation");
    }
    transfer.chunks.push(bytes);
    transfer.received += bytes.length;
    return mediaResultFor(message, "receiving", null, null, "attachment_injected");
  }

  async function handleReviewMediaAttachEnd(message) {
    const transfer = mediaTransfers.get(message?.requestId);
    if (!mediaRequestMatchesTransfer(message, transfer)
      || message.fileName !== transfer.fileName
      || message.mimeType?.toLowerCase() !== transfer.mimeType
      || message.size !== transfer.size) {
      mediaTransfers.delete(message?.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "添付対象の識別情報が一致しません。", "attachment_metadata_validation");
    }
    if (transfer.received !== transfer.size) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_upload_failed", "生成物を完全に受信できませんでした。", "attachment_uploading");
    }

    try {
      const FileConstructor = globalThis.File;
      const DataTransferConstructor = globalThis.DataTransfer;
      if (typeof FileConstructor !== "function" || typeof DataTransferConstructor !== "function") throw new Error("File API is unavailable.");
      const file = new FileConstructor(transfer.chunks, transfer.fileName, { type: transfer.mimeType });
      const composer = locators.findComposer?.() || transfer.composer;
      const fileInput = locators.findFileInput?.(document, composer) || transfer.fileInput;
      if (!fileInput) {
        mediaTransfers.delete(message.requestId);
        return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTのファイル添付入力が見つかりません。", "attachment_control_found");
      }
      const dataTransfer = new DataTransferConstructor();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      diagnostic("attachment injected", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        stage: "attachment_injected"
      });
      diagnostic("attachment uploading", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        stage: "attachment_uploading"
      });
      const verification = await waitForAttachmentVerification(composer, transfer);
      if (!verification.verified) {
        mediaTransfers.delete(message.requestId);
        return mediaResultFor(message, "error", verification.errorCode, "ChatGPTで添付完了を確認できませんでした。", verification.stage);
      }
      verifiedReviewAttachments.set(
        `${message.sessionId}|${message.iteration}|${message.mediaId}|${message.fileName}`,
        { fileName: message.fileName, mediaId: message.mediaId, verifiedAt: Date.now() });
      mediaTransfers.delete(message.requestId);
      diagnostic("attachment verified", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        status: "attached",
        stage: "attachment_verified"
      });
      return mediaResultFor(message, "attached", null, null, "attachment_verified");
    } catch (_) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "ChatGPTのファイル添付入力へ生成物を設定できませんでした。", "attachment_input_failed");
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function readCurrentContextAfterHandoff(message) {
    let current = null;
    try {
      current = locators.getCurrentChatGptContext?.(document, globalThis.location?.href) || null;
    } catch (_) { current = null; }
    if (message?.newConversation !== true
      || (current?.conversation_id && current?.url)) return current;

    // ChatGPT creates the conversation route asynchronously after accepting a
    // message on the new-chat page.  Bind only after the page exposes both
    // stable identity fields; never invent an ID from the visible title.
    const deadline = Date.now() + newConversationBindingTimeoutMs;
    while (Date.now() < deadline) {
      await wait(100);
      try {
        current = locators.getCurrentChatGptContext?.(document, globalThis.location?.href) || current;
      } catch (_) { }
      if (current?.conversation_id && current?.url) return current;
    }
    return current;
  }

  function reviewAttachmentKey(message) {
    return `${message?.sessionId || ""}|${message?.expectedAttachment?.iteration || message?.iteration || ""}|${message?.expectedAttachment?.mediaId || ""}|${message?.expectedAttachment?.fileName || ""}`;
  }

  function hasVerifiedReviewAttachment(message, composer) {
    const expected = message?.expectedAttachment;
    if (!expected || typeof expected.fileName !== "string" || expected.fileName.length === 0) return false;
    const remembered = verifiedReviewAttachments.get(reviewAttachmentKey(message));
    const indicator = locators.findAttachmentByFilename?.(document, expected.fileName, composer);
    const complete = Boolean(indicator
      && !locators.isAttachmentUploading?.(indicator)
      && (locators.isAttachmentUploadComplete?.(document, expected.fileName, composer) ?? true));
    // A service-worker/content-script restart loses the in-memory record, but
    // a visible, non-uploading ChatGPT attachment is still valid evidence.
    return complete && (!remembered || remembered.fileName === expected.fileName);
  }

  async function waitForSendButton(composer, markers, options = {}) {
    const timeoutMs = options.review ? reviewComposerStateTimeoutMs : composerStateTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let candidate = null;
    let currentComposer = composer;
    let composerHadInput = Boolean(composer && locators.composerContainsInputMarkers(composer, markers));
    let composerStateWasLost = false;
    let waitingDiagnosticSent = false;
    while (Date.now() < deadline) {
      const locatedComposer = locators.findComposer?.();
      currentComposer = locatedComposer
        || (currentComposer?.isConnected === false ? null : currentComposer);
      const composerHasInput = Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers));
      if (composerHasInput) {
        composerHadInput = true;
        // ChatGPT may replace the editor node while it processes an
        // attachment. A transient marker miss is recoverable when the
        // replacement editor contains the same Handoff again.
        composerStateWasLost = false;
      } else if (composerHadInput) {
        composerStateWasLost = true;
      }
      candidate = locators.findSendButton(document, { includeDisabled: true, composer: currentComposer });
      if (composerHasInput && candidate && !locators.isDisabled(candidate)) {
        return { button: candidate, composer: currentComposer, composerStateWasLost, composerHasInput };
      }
      if (!waitingDiagnosticSent && composerHasInput && candidate && locators.isDisabled(candidate)) {
        waitingDiagnosticSent = true;
        diagnostic("send button waiting", {
          request_id: options.requestId,
          handoff_id: options.handoffId,
          stage: options.review ? "send_button_waiting_for_attachment" : "send_button_waiting"
        });
      }
      await wait(50);
    }
    const finalComposerHasInput = Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers));
    return {
      button: candidate,
      composer: currentComposer,
      composerStateWasLost: composerStateWasLost && !finalComposerHasInput,
      composerHasInput: finalComposerHasInput
    };
  }

  async function waitForUserMessageAccepted(message, composer, beforeSnapshot) {
    const deadline = Date.now() + sendAcceptanceTimeoutMs;
    let messageObserved = false;
    let composerCleared = false;
    while (Date.now() < deadline) {
      const messages = locators.findUserMessages(document);
      if (messages.length > Number(beforeSnapshot?.count || 0)) {
        if (!messageObserved) {
          messageObserved = true;
          diagnostic("user message observed", {
            request_id: message?.requestId,
            handoff_id: message?.handoffId,
            stage: "user_message_observed"
          });
        }
        const hasCorrelatedMessage = locators.hasNewUserMessageWithCorrelation(document, {
          handoffId: message.handoffId,
          boundaryId: message.boundaryId,
          protocol: message.protocol
        }, beforeSnapshot);
        const correlatedMessage = hasCorrelatedMessage
          ? locators.findNewUserMessages(document, beforeSnapshot).find((candidate) =>
            locators.messageContainsMarker(candidate, message.handoffId)
            && locators.messageContainsMarker(candidate, message.boundaryId)
            && (!message.protocol || locators.messageContainsMarker(candidate, message.protocol)))
          : null;
        if (correlatedMessage) {
          diagnostic("user message correlated", {
            request_id: message?.requestId,
            handoff_id: message?.handoffId,
            status: "sent",
            stage: "user_message_correlated"
          });
          return { accepted: true, stage: "user_message_correlated", anchor: correlatedMessage };
        }
      }

      // Clearing/replacing the composer is diagnostic evidence only. It is
      // never a send-success condition.
      const currentComposer = locators.findComposer?.() || composer;
      if (!composerCleared
        && (!currentComposer || !locators.composerContainsInputMarkers(currentComposer, {
          protocol: message?.protocol,
          handoffId: message?.handoffId,
          boundaryId: message?.boundaryId
        }))) {
        composerCleared = true;
        diagnostic("composer cleared", {
          request_id: message?.requestId,
          handoff_id: message?.handoffId,
          stage: "composer_cleared"
        });
      }
      await wait(100);
    }
    return {
      accepted: false,
      stage: messageObserved ? "user_message_not_correlated" : "user_message_not_observed"
    };
  }

  function assistantCandidatesFor(watcher) {
    // The correlated user-message anchor is the authoritative boundary. Do
    // not discard a post-anchor assistant container merely because ChatGPT
    // reused/reconciled the same DOM node that existed in the pre-send
    // snapshot. Some conversation renderers create an empty assistant turn
    // before they append the user turn, then fill that turn in place. The
    // connector-command marker check below still prevents an unrelated
    // assistant/status node from becoming a response.
    return locators.findAssistantMessagesAfterAnchor(document, watcher.anchor);
  }

  function responseContextFor(watcher) {
    return {
      protocol: watcher.protocol,
      handoffId: watcher.handoffId,
      sessionId: watcher.sessionId
    };
  }

  function isConnectorResponseCandidate(candidate, watcher) {
    try {
      return Boolean(locators.hasConnectorCommandResponse?.(candidate, responseContextFor(watcher)));
    } catch (_) {
      return false;
    }
  }

  function sendAssistantResponseToBackground(watcher, result) {
    const message = {
      type: responseResultMessageType,
      requestId: watcher.requestId,
      sessionId: watcher.sessionId,
      handoffId: watcher.handoffId,
      boundaryId: watcher.boundaryId,
      status: result.status
    };
    if (result.payload) message.payload = result.payload;
    if (result.errorCode) message.errorCode = result.errorCode;
    if (result.message) message.message = result.message;
    if (result.stage) message.stage = result.stage;

    diagnostic("assistant response emitted", {
      request_id: watcher.requestId,
      session_id: watcher.sessionId,
      handoff_id: watcher.handoffId,
      boundary_id: watcher.boundaryId,
      status: result.status,
      error_code: result.errorCode,
      stage: "assistant_response_emitted",
      target_tab_id: watcher.targetTabId
    });

    chrome.runtime.sendMessage(message).catch(() => {
      diagnostic("assistant response delivery failed", {
        request_id: watcher.requestId,
        session_id: watcher.sessionId,
        handoff_id: watcher.handoffId,
        boundary_id: watcher.boundaryId,
        status: "error",
        error_code: "bridge_disconnected",
        stage: "response_background_dispatch"
      });
    });
  }

  function finishAssistantResponseWatcher(watcher, result) {
    if (watcher.finished) return;
    watcher.finished = true;
    if (watcher.observer) watcher.observer.disconnect();
    if (watcher.timer !== null) clearTimeout(watcher.timer);
    responseWatchers.delete(watcher.key);
    responseAnchors.delete(watcher.key);
    if (result.status === "received") {
      diagnostic("assistant message complete", {
        request_id: watcher.requestId,
        session_id: watcher.sessionId,
        handoff_id: watcher.handoffId,
        boundary_id: watcher.boundaryId,
        status: "received",
        stage: "assistant_message_complete",
        target_tab_id: watcher.targetTabId
      });
      diagnostic("assistant response correlated", {
        request_id: watcher.requestId,
        session_id: watcher.sessionId,
        handoff_id: watcher.handoffId,
        boundary_id: watcher.boundaryId,
        status: "received",
        stage: result.stage,
        target_tab_id: watcher.targetTabId
      });
    } else {
      diagnostic("assistant response failed", {
        request_id: watcher.requestId,
        session_id: watcher.sessionId,
        handoff_id: watcher.handoffId,
        boundary_id: watcher.boundaryId,
        status: "error",
        error_code: result.errorCode,
        stage: result.stage,
        target_tab_id: watcher.targetTabId
      });
    }
    sendAssistantResponseToBackground(watcher, result);
  }

  function evaluateAssistantResponseWatcher(watcher) {
    if (watcher.finished) return;
    if (watcher.timer !== null) {
      clearTimeout(watcher.timer);
      watcher.timer = null;
    }
    const now = Date.now();
    const candidates = assistantCandidatesFor(watcher);
    // A visible assistant/status node is not by itself a Connector response.
    // Only the newest post-anchor assistant message whose own content has a
    // connector-command block may advance to extraction. This prevents
    // transient "Thinking"/tool-progress UI from completing the watcher.
    const latestCandidate = candidates.at(-1) || null;
    const connectorCandidates = candidates.filter((candidate) => isConnectorResponseCandidate(candidate, watcher));
    // Prefer the latest candidate that contains this watcher's Connector
    // identity. A later status/tool container must not hide a valid response
    // that is still streaming in an earlier assistant turn.
    const candidate = connectorCandidates.at(-1) || null;
    if (latestCandidate && !candidate) {
      watcher.sawAssistantMessage = true;
      watcher.sawNonConnectorAssistant = true;
      if (!watcher.ignoredAssistantElements.has(latestCandidate)) {
        watcher.ignoredAssistantElements.add(latestCandidate);
        diagnostic("assistant candidate ignored", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_response_candidate_non_connector",
          target_tab_id: watcher.targetTabId
        });
      }
    }
    if (candidate) {
      watcher.sawAssistantMessage = true;
      if (!watcher.observedAssistantElements.has(candidate)) {
        watcher.observedAssistantElements.add(candidate);
        diagnostic("assistant message observed", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_message_observed",
          target_tab_id: watcher.targetTabId
        });
      }
      let text = "";
      try {
        text = locators.readAssistantResponseText(candidate, responseContextFor(watcher));
      }
      catch (_) { text = ""; }
      if (candidate !== watcher.candidate || text !== watcher.candidateText) {
        watcher.candidate = candidate;
        watcher.candidateText = text;
        watcher.lastChangedAt = now;
        diagnostic("assistant response observed", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_message_observed",
          target_tab_id: watcher.targetTabId
        });
      }
      if (!text.trim()) watcher.extractionWasEmpty = true;
      watcher.hasCompletionActions = Boolean(locators.hasAssistantCompletionActions?.(candidate));
    }

    const generating = Boolean(locators.isGenerating?.(document));
    if (generating) {
      if (!watcher.sawGenerating) {
        diagnostic("assistant response streaming", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_response_streaming",
          target_tab_id: watcher.targetTabId
        });
      }
      watcher.sawGenerating = true;
    }

    if (candidate
      && watcher.candidateText.trim()
      && now - watcher.lastChangedAt >= responseStabilityMs
      && !generating) {
      finishAssistantResponseWatcher(watcher, {
        status: "received",
        payload: watcher.candidateText,
        stage: "assistant_response_complete"
      });
      return;
    }

    if (now >= watcher.deadline) {
      const errorCode = !watcher.sawAssistantMessage
        ? "assistant_response_not_found"
        : watcher.sawGenerating || generating
          ? "response_stream_interrupted"
          : watcher.extractionWasEmpty
            ? "response_extraction_failed"
            : "response_timeout";
      const stage = !watcher.sawAssistantMessage
        ? "assistant_message_not_found"
        : watcher.sawGenerating || generating
          ? "assistant_response_streaming"
          : watcher.sawNonConnectorAssistant
            ? "assistant_response_non_connector"
          : watcher.extractionWasEmpty
            ? "assistant_response_empty"
            : "assistant_response_stability_timeout";
      finishAssistantResponseWatcher(watcher, {
        status: "error",
        errorCode,
        message: "ChatGPTのassistant応答を完了状態で取得できませんでした。",
        stage
      });
      return;
    }

    watcher.timer = setTimeout(() => evaluateAssistantResponseWatcher(watcher), responsePollIntervalMs);
  }

  function startAssistantResponseWatcher(watcher) {
    const MutationObserverConstructor = globalThis.MutationObserver;
    if (typeof MutationObserverConstructor === "function") {
      watcher.observer = new MutationObserverConstructor(() => evaluateAssistantResponseWatcher(watcher));
      const observationTarget = document.body || document.documentElement || document;
      watcher.observer.observe(observationTarget, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-label", "data-testid", "aria-disabled", "disabled"]
      });
    }
    evaluateAssistantResponseWatcher(watcher);
  }

  async function handleWatchAssistantResponse(message) {
    diagnostic(message?.review === true ? "review response watch requested" : "assistant response watch requested", traceForMessage(message, {
      status: "requested",
      stage: "response_watch_requested"
    }));
    if (!locators || !locators.isChatGptPage()) {
      return responseResultFor(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    }
    if (!hasResponseContext(message)) {
      return responseResultFor(message, "error", "response_extraction_failed", "応答監視に必要な識別子がありません。", "response_context_invalid");
    }

    const key = responseCorrelationKey(message);
    const existing = responseWatchers.get(key);
    if (existing) {
      diagnostic("response watch armed", {
        ...traceForMessage(message),
        status: "watching",
        stage: "response_watch_armed"
      });
      return responseResultFor(message, "watching", null, null, "response_watch_started");
    }

    const savedAnchor = responseAnchors.get(key);
    const savedAnchorElement = savedAnchor?.anchor?.isConnected === false
      ? null
      : savedAnchor?.anchor;
    // ChatGPT may replace a just-sent user-message node while it reconciles
    // the conversation. Re-locate the same marker-bearing message instead of
    // treating that harmless DOM replacement as an extraction failure.
    const locatedAnchor = locators.findUserMessageWithCorrelation(document, {
      protocol: message.protocol,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId
    });
    // Prefer the live marker-bearing message. ChatGPT's React reconciliation
    // can replace the accepted user-message node between HANDOFF_SEND and
    // WATCH_ASSISTANT_RESPONSE; retaining the old node would make the
    // post-anchor query miss the Review assistant turn.
    const anchor = locatedAnchor || savedAnchorElement;
    if (!anchor) {
      diagnostic(message?.review === true ? "review anchor missing" : "response anchor missing", traceForMessage(message, {
        status: "error",
        error_code: "response_anchor_not_found",
        stage: "response_anchor_not_found"
      }));
      return responseResultFor(message, "error", "assistant_response_not_found", "今回のHandoffに対応するChatGPT user messageが見つかりません。", "response_anchor_not_found");
    }
    diagnostic(message?.review === true ? "review anchor found" : "response anchor found", {
      ...traceForMessage(message),
      status: "watching",
      stage: message?.review === true ? "review_anchor_found" : "response_anchor_found"
    });

    const watcher = {
      key,
      requestId: message.requestId,
      sessionId: message.sessionId,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId,
      protocol: message.protocol,
      targetTabId: message?.targetTabId || message?.target_tab_id,
      anchor,
      baselineAssistantElements: savedAnchor?.assistantElements instanceof Set
        ? savedAnchor.assistantElements
        : new Set(),
      deadline: Date.now() + responseTimeoutMs,
      lastChangedAt: Date.now(),
      candidate: null,
      candidateText: "",
      sawAssistantMessage: false,
      sawGenerating: false,
      extractionWasEmpty: false,
      sawNonConnectorAssistant: false,
      observedAssistantElements: new Set(),
      ignoredAssistantElements: new Set(),
      hasCompletionActions: false,
      observer: null,
      timer: null,
      finished: false
    };
    responseWatchers.set(key, watcher);
    diagnostic("response watch armed", {
      request_id: watcher.requestId,
      session_id: watcher.sessionId,
      handoff_id: watcher.handoffId,
      boundary_id: watcher.boundaryId,
      status: "watching",
      stage: "response_watch_armed",
      target_tab_id: watcher.targetTabId
    });
    startAssistantResponseWatcher(watcher);
    return responseResultFor(message, "watching", null, null, "response_watch_started");
  }

  async function handleHandoffSend(message) {
    diagnostic("content script received", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId
    });
    if (!locators || !locators.isChatGptPage()) {
      return resultFor(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    }
    if (typeof message?.payload !== "string" || message.payload.length === 0) {
      return resultFor(message, "error", "composer_input_failed", "Handoff本文が空です。", "payload_validation");
    }

    const composer = locators.findComposer();
    if (!composer) {
      return resultFor(message, "error", "composer_not_found", "ChatGPTの入力欄が見つかりません。", "composer_not_found");
    }
    diagnostic("composer found", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "composer_found",
      composer_type: composerType(composer)
    });

    if (message?.review === true) {
      const existingText = locators.normalizeComposerText?.(locators.readComposerText?.(composer) || "")
        || String(locators.readComposerText?.(composer) || "").trim();
      if (existingText.length > 0) {
        return resultFor(message, "error", "review_composer_not_clean", "Review送信前の入力欄に予期しない本文があります。", "review_composer_check");
      }
      if (!hasVerifiedReviewAttachment(message, composer)) {
        return resultFor(message, "error", "review_media_not_attached", "Review対象の生成物添付完了を確認できません。", "attachment_verification");
      }
    }

    const inputMarkers = {
      protocol: message?.protocol,
      handoffId: message?.handoffId,
      boundaryId: message?.boundaryId
    };
    if (!hasRequiredInputMarkers(inputMarkers)) {
      return resultFor(
        message,
        "error",
        "composer_input_verification_failed",
        "Handoffの送信確認に必要な識別子がありません。",
        "input_identifiers_missing");
    }

    const beforeUserMessages = locators.captureUserMessageSnapshot(document);
    const beforeAssistantMessages = locators.captureAssistantMessageSnapshot?.(document)
      || { count: 0, elements: new Set() };
    diagnostic("input attempted", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_attempted",
      composer_type: composerType(composer)
    });

    let inputResult;
    try {
      inputResult = await fillComposer(composer, message.payload, inputMarkers);
    } catch (_) {
      return resultFor(message, "error", "composer_input_failed", "ChatGPTの入力欄へHandoffを入力できませんでした。", "input_insertion_failed");
    }
    const activeComposer = inputResult?.composer;
    const markerStatus = inputResult?.status || {
      protocol: false,
      handoff_id: false,
      boundary_id: false,
      all: false
    };
    if (!activeComposer || !markerStatus.all) {
      diagnostic("input identifiers missing", {
        request_id: message?.requestId,
        handoff_id: message?.handoffId,
        stage: "input_identifiers_missing",
        protocol_found: markerStatus.protocol,
        handoff_id_found: markerStatus.handoff_id,
        boundary_id_found: markerStatus.boundary_id
      });
      return resultFor(
        message,
        "error",
        "composer_input_verification_failed",
        "Handoffの識別子が入力欄で確認できませんでした。",
        "input_identifiers_missing");
    }
    diagnostic("input identifiers found", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_identifiers_found",
      protocol_found: markerStatus.protocol,
      handoff_id_found: markerStatus.handoff_id,
      boundary_id_found: markerStatus.boundary_id
    });
    diagnostic("input visible", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_visible",
      composer_type: composerType(activeComposer)
    });

    if (message?.review === true && !hasVerifiedReviewAttachment(message, activeComposer)) {
      return resultFor(message, "error", "review_media_not_attached", "Handoff入力後もReview対象の添付を確認できません。", "attachment_verification");
    }

    const sendCandidate = await waitForSendButton(activeComposer, inputMarkers, {
      review: message?.review === true,
      requestId: message?.requestId,
      handoffId: message?.handoffId
    });
    if (sendCandidate.composerStateWasLost || !sendCandidate.composerHasInput) {
      return resultFor(message, "error", "composer_input_failed", "入力欄の状態が送信前に失われました。", "composer_state_lost");
    }
    const sendButton = sendCandidate.button;
    if (!sendButton) {
      return resultFor(message, "error", "send_button_not_found", "ChatGPTの送信ボタンが見つかりません。", "send_button_not_found");
    }
    diagnostic("send button found", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "send_button_found"
    });
    if (locators.isDisabled(sendButton)) {
      diagnostic("send button not enabled", {
        request_id: message?.requestId,
        handoff_id: message?.handoffId,
        stage: "send_button_not_enabled"
      });
      return resultFor(message, "error", "composer_input_failed", "入力欄の内容をChatGPTが認識していないため送信できません。", "send_button_not_enabled");
    }
    diagnostic("send button enabled", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "send_button_enabled"
    });

    try {
      diagnostic("send button clicked", {
        request_id: message?.requestId,
        handoff_id: message?.handoffId,
        stage: "send_clicked"
      });
      sendButton.click();
    } catch (_) {
      return resultFor(message, "error", "send_failed", "ChatGPTの送信操作に失敗しました。", "send_click_failed");
    }

    const acceptance = await waitForUserMessageAccepted(message, activeComposer, beforeUserMessages);
    if (!acceptance.accepted) {
      return resultFor(message, "error", "send_failed", "ChatGPTの送信操作が成立したことを確認できませんでした。", acceptance.stage);
    }
    if (acceptance.anchor) {
      responseAnchors.set(responseCorrelationKey(message), {
        anchor: acceptance.anchor,
        assistantElements: beforeAssistantMessages.elements,
        createdAt: Date.now()
      });
    }
    diagnostic("user message confirmed", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      status: "sent",
      stage: acceptance.stage
    });
    const result = resultFor(message, "sent", null, null, acceptance.stage);
    // For a new Chat, ChatGPT may create the conversation URL only after the
    // user message is accepted. Return metadata discovered from the page so
    // Desktop can bind the created conversation without syncing message text.
    result.current_context = await readCurrentContextAfterHandoff(message);
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "BRIDGE_STATE_CHANGED") {
      window.dispatchEvent(new CustomEvent(statusEventName, { detail: message.state }));
      return false;
    }
    if (message?.type === contextRequestMessageType) {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      handleGetChatGptContext(message)
        .then(sendResponse)
        .catch(() => sendResponse(contextResultFor(
          message,
          "error",
          "context_extraction_failed",
          "ChatGPTのContext取得に失敗しました。",
          "context_extraction")));
      return true;
    }
    if (message?.type !== handoffMessageType
      && message?.type !== responseWatchMessageType
      && message?.type !== reviewMediaAttachBeginMessageType
      && message?.type !== reviewMediaAttachChunkMessageType
      && message?.type !== reviewMediaAttachEndMessageType) return false;
    if (sender?.id && sender.id !== chrome.runtime.id) return false;

    const operation = message?.type === responseWatchMessageType
      ? handleWatchAssistantResponse(message)
      : message?.type === handoffMessageType
        ? handleHandoffSend(message)
        : message?.type === reviewMediaAttachBeginMessageType
          ? handleReviewMediaAttachBegin(message)
          : message?.type === reviewMediaAttachChunkMessageType
            ? Promise.resolve(handleReviewMediaAttachChunk(message))
            : handleReviewMediaAttachEnd(message);
    void operation
      .then(sendResponse)
      .catch(() => sendResponse(message?.type === responseWatchMessageType
        ? responseResultFor(message, "error", "response_extraction_failed", "assistant応答の監視を開始できませんでした。", "unexpected_error")
        : [reviewMediaAttachBeginMessageType, reviewMediaAttachChunkMessageType, reviewMediaAttachEndMessageType].includes(message?.type)
          ? mediaResultFor(message, "error", "attachment_upload_failed", "ChatGPTへの生成物添付処理に失敗しました。", "unexpected_error")
          : resultFor(message, "error", "send_failed", "ChatGPTへの送信処理に失敗しました。", "unexpected_error")));
    return true;
  });

  chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {});
  installContextMonitor();
})();
