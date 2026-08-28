// The Content Script is the only Extension layer allowed to inspect or
// mutate the ChatGPT page. It never opens a localhost connection; all
// transport/authentication remains in background.js.
(() => {
  "use strict";

  const statusEventName = "chatgpt-comfy-connector:bridge-status";
  const handoffMessageType = "HANDOFF_SEND";
  const responseWatchMessageType = "WATCH_ASSISTANT_RESPONSE";
  const responseResultMessageType = "ASSISTANT_RESPONSE_RESULT";
  const sendAcceptanceTimeoutMs = 8000;
  const composerStateTimeoutMs = 1500;
  const responseTimeoutMs = 120000;
  const responseStabilityMs = 900;
  const responsePollIntervalMs = 100;
  const locators = globalThis.ChatGptComfyConnectorLocators;
  const responseAnchors = new Map();
  const responseWatchers = new Map();

  // Keep page diagnostics limited to request identity, stage, and the
  // outcome. The session token and Handoff body are never logged by the
  // Content Script.
  function diagnostic(eventName, fields = {}) {
    const safe = {};
    for (const key of [
      "request_id",
      "handoff_id",
      "status",
      "error_code",
      "stage",
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

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForSendButton(composer, markers) {
    const deadline = Date.now() + composerStateTimeoutMs;
    let candidate = null;
    let currentComposer = composer;
    let composerHadInput = Boolean(composer && locators.composerContainsInputMarkers(composer, markers));
    let composerStateWasLost = false;
    while (Date.now() < deadline) {
      const locatedComposer = locators.findComposer?.();
      currentComposer = locatedComposer
        || (currentComposer?.isConnected === false ? null : currentComposer);
      const composerHasInput = Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers));
      if (composerHasInput) {
        composerHadInput = true;
      } else if (composerHadInput) {
        composerStateWasLost = true;
      }
      candidate = locators.findSendButton(document, { includeDisabled: true, composer: currentComposer });
      if (composerHasInput && candidate && !locators.isDisabled(candidate)) {
        return { button: candidate, composer: currentComposer, composerStateWasLost, composerHasInput };
      }
      await wait(50);
    }
    return {
      button: candidate,
      composer: currentComposer,
      composerStateWasLost,
      composerHasInput: Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers))
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
    const candidates = locators.findAssistantMessagesAfterAnchor(document, watcher.anchor);
    return candidates.filter((candidate) => !watcher.baselineAssistantElements.has(candidate));
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

    chrome.runtime.sendMessage(message).catch(() => {
      diagnostic("assistant response delivery failed", {
        request_id: watcher.requestId,
        handoff_id: watcher.handoffId,
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
      diagnostic("assistant response correlated", {
        request_id: watcher.requestId,
        handoff_id: watcher.handoffId,
        status: "received",
        stage: result.stage
      });
    } else {
      diagnostic("assistant response failed", {
        request_id: watcher.requestId,
        handoff_id: watcher.handoffId,
        status: "error",
        error_code: result.errorCode,
        stage: result.stage
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
    const candidate = candidates.at(-1) || null;
    if (candidate) {
      watcher.sawAssistantMessage = true;
      let text = "";
      try {
        text = locators.readAssistantResponseText(candidate, {
          protocol: watcher.protocol,
          handoffId: watcher.handoffId,
          sessionId: watcher.sessionId
        });
      }
      catch (_) { text = ""; }
      if (candidate !== watcher.candidate || text !== watcher.candidateText) {
        watcher.candidate = candidate;
        watcher.candidateText = text;
        watcher.lastChangedAt = now;
        diagnostic("assistant response observed", {
          request_id: watcher.requestId,
          handoff_id: watcher.handoffId,
          stage: "assistant_message_observed"
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
          handoff_id: watcher.handoffId,
          stage: "assistant_response_streaming"
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
    diagnostic("assistant response watch requested", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "response_watch_requested"
    });
    if (!locators || !locators.isChatGptPage()) {
      return responseResultFor(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    }
    if (!hasResponseContext(message)) {
      return responseResultFor(message, "error", "response_extraction_failed", "応答監視に必要な識別子がありません。", "response_context_invalid");
    }

    const key = responseCorrelationKey(message);
    const existing = responseWatchers.get(key);
    if (existing) return responseResultFor(message, "watching", null, null, "response_watch_started");

    const savedAnchor = responseAnchors.get(key);
    const savedAnchorElement = savedAnchor?.anchor?.isConnected === false
      ? null
      : savedAnchor?.anchor;
    // ChatGPT may replace a just-sent user-message node while it reconciles
    // the conversation. Re-locate the same marker-bearing message instead of
    // treating that harmless DOM replacement as an extraction failure.
    const anchor = savedAnchorElement || locators.findUserMessageWithCorrelation(document, {
      protocol: message.protocol,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId
    });
    if (!anchor) {
      return responseResultFor(message, "error", "assistant_response_not_found", "今回のHandoffに対応するChatGPT user messageが見つかりません。", "response_anchor_not_found");
    }

    const watcher = {
      key,
      requestId: message.requestId,
      sessionId: message.sessionId,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId,
      protocol: message.protocol,
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
      hasCompletionActions: false,
      observer: null,
      timer: null,
      finished: false
    };
    responseWatchers.set(key, watcher);
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

    const sendCandidate = await waitForSendButton(activeComposer, inputMarkers);
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
    return resultFor(message, "sent", null, null, acceptance.stage);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "BRIDGE_STATE_CHANGED") {
      window.dispatchEvent(new CustomEvent(statusEventName, { detail: message.state }));
      return false;
    }
    if (message?.type !== handoffMessageType && message?.type !== responseWatchMessageType) return false;
    if (sender?.id && sender.id !== chrome.runtime.id) return false;

    const operation = message?.type === responseWatchMessageType
      ? handleWatchAssistantResponse(message)
      : handleHandoffSend(message);
    void operation
      .then(sendResponse)
      .catch(() => sendResponse(message?.type === responseWatchMessageType
        ? responseResultFor(message, "error", "response_extraction_failed", "assistant応答の監視を開始できませんでした。", "unexpected_error")
        : resultFor(message, "error", "send_failed", "ChatGPTへの送信処理に失敗しました。", "unexpected_error")));
    return true;
  });

  chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {});
})();
