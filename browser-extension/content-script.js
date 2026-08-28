// The Content Script is the only Extension layer allowed to inspect or
// mutate the ChatGPT page. It never opens a localhost connection; all
// transport/authentication remains in background.js.
(() => {
  "use strict";

  const statusEventName = "chatgpt-comfy-connector:bridge-status";
  const handoffMessageType = "HANDOFF_SEND";
  const sendAcceptanceTimeoutMs = 8000;
  const composerStateTimeoutMs = 1500;
  const locators = globalThis.ChatGptComfyConnectorLocators;

  // Keep page diagnostics limited to request identity, stage, and the
  // outcome. The session token and Handoff body are never logged by the
  // Content Script.
  function diagnostic(eventName, fields = {}) {
    const safe = {};
    for (const key of ["request_id", "handoff_id", "status", "error_code", "stage", "composer_type"]) {
      if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
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
      return accepted && locators.composerContainsText(element, payload);
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

    if (inserted && locators.composerContainsText(element, payload)) return;

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

  async function waitForComposerValue(payload, preferredComposer) {
    const deadline = Date.now() + composerStateTimeoutMs;
    while (Date.now() < deadline) {
      const current = locators.findComposer?.()
        || (preferredComposer?.isConnected === false ? null : preferredComposer);
      if (current && locators.composerContainsText(current, payload)) return current;
      await wait(25);
    }
    return null;
  }

  async function fillComposer(element, payload) {
    element.focus({ preventScroll: true });
    if (element instanceof HTMLTextAreaElement || element.tagName?.toLowerCase() === "textarea") {
      if (!selectAll(element)) throw new Error("Textarea selection is unavailable.");
      setTextareaValue(element, payload);
    } else {
      setContentEditableValue(element, payload);
    }

    return waitForComposerValue(payload, element);
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForSendButton(composer, payload) {
    const deadline = Date.now() + composerStateTimeoutMs;
    let candidate = null;
    let currentComposer = composer;
    let composerHadPayload = Boolean(composer && locators.composerContainsText(composer, payload));
    let composerStateWasLost = false;
    while (Date.now() < deadline) {
      const locatedComposer = locators.findComposer?.();
      currentComposer = locatedComposer
        || (currentComposer?.isConnected === false ? null : currentComposer);
      const composerHasPayload = Boolean(currentComposer && locators.composerContainsText(currentComposer, payload));
      if (composerHasPayload) {
        composerHadPayload = true;
      } else if (composerHadPayload) {
        composerStateWasLost = true;
      }
      candidate = locators.findSendButton(document, { includeDisabled: true, composer: currentComposer });
      if (composerHasPayload && candidate && !locators.isDisabled(candidate)) {
        return { button: candidate, composer: currentComposer, composerStateWasLost, composerHasPayload };
      }
      await wait(50);
    }
    return {
      button: candidate,
      composer: currentComposer,
      composerStateWasLost,
      composerHasPayload: Boolean(currentComposer && locators.composerContainsText(currentComposer, payload))
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
        if (locators.hasNewUserMessageWithCorrelation(document, {
          handoffId: message?.handoffId,
          boundaryId: message?.boundaryId,
          protocol: message?.protocol
        }, beforeSnapshot)) {
          diagnostic("user message correlated", {
            request_id: message?.requestId,
            handoff_id: message?.handoffId,
            status: "sent",
            stage: "user_message_correlated"
          });
          return { accepted: true, stage: "user_message_correlated" };
        }
      }

      // Clearing/replacing the composer is diagnostic evidence only. It is
      // never a send-success condition.
      const currentComposer = locators.findComposer?.() || composer;
      if (!composerCleared
        && (!currentComposer || !locators.composerContainsText(currentComposer, message.payload))) {
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

    const beforeUserMessages = locators.captureUserMessageSnapshot(document);
    diagnostic("input attempted", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_attempted",
      composer_type: composerType(composer)
    });

    let activeComposer;
    try {
      activeComposer = await fillComposer(composer, message.payload);
    } catch (_) {
      return resultFor(message, "error", "composer_input_failed", "ChatGPTの入力欄へHandoffを入力できませんでした。", "input_insertion_failed");
    }
    if (!activeComposer) {
      return resultFor(message, "error", "composer_input_failed", "Handoff本文が入力欄へ反映されませんでした。", "input_not_visible");
    }
    diagnostic("input visible", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_visible",
      composer_type: composerType(activeComposer)
    });

    const sendCandidate = await waitForSendButton(activeComposer, message.payload);
    if (sendCandidate.composerStateWasLost || !sendCandidate.composerHasPayload) {
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
    if (message?.type !== handoffMessageType) return false;
    if (sender?.id && sender.id !== chrome.runtime.id) return false;

    void handleHandoffSend(message)
      .then(sendResponse)
      .catch(() => sendResponse(resultFor(message, "error", "send_failed", "ChatGPTへの送信処理に失敗しました。", "unexpected_error")));
    return true;
  });

  chrome.runtime.sendMessage({ type: "CONTENT_SCRIPT_READY" }).catch(() => {});
})();
