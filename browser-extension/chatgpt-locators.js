// ChatGPT DOM locator candidates are intentionally isolated from transport
// code. When ChatGPT changes its UI, this file is the only place that should
// normally need locator updates.
(() => {
  "use strict";

  const composerSelectors = [
    'textarea[data-testid*="prompt"]',
    'textarea[aria-label]',
    'textarea[placeholder]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"][data-testid*="prompt"]',
    '[contenteditable="true"][data-testid*="composer"]',
    '[contenteditable="true"]'
  ];

  const sendButtonSelectors = [
    'button[data-testid*="send"]',
    '[role="button"][data-testid*="send"]',
    'button[data-testid*="submit"]',
    '[role="button"][data-testid*="submit"]',
    'button[aria-label]',
    '[role="button"][aria-label]',
    'button[title]',
    '[role="button"][title]',
    'button[type="submit"]',
    '[role="button"][type="submit"]',
    'button',
    '[role="button"]'
  ];

  const userMessageSelectors = [
    '[data-message-author-role="user"]',
    '[data-turn="user"]',
    '[data-author-role="user"]',
    '[data-testid*="user-message"]',
    '[data-testid*="conversation-turn-user"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="user"]',
    '[data-testid*="conversation-turn-user"] article',
    'article[data-testid*="conversation-turn-user"]'
  ];

  const zeroWidthPattern = /[\u200b\u200c\u200d\u2060\ufeff]/g;

  // The composer toolbar contains several visible buttons.  A button that
  // happens to be near the composer is never a safe Send candidate unless its
  // semantics say "send/submit", or it is a submit control in the same form.
  // These exclusions intentionally cover both the English and Japanese UI.
  const excludedActionPattern = /(?:\b(?:attachment|attach|upload|add|plus|tool|tools|microphone|mic|voice|stop|file|files|photo|photos|image|images|library|browse)\b|添付|ファイル|写真|画像|追加|プラス|ツール|マイク|音声|停止)/i;
  const sendActionPattern = /(?:\b(?:send|submit)\b|送信|メッセージを送る|メッセージを送信|送る)/i;

  function isChatGptPage(url = globalThis.location?.href) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com";
    } catch (_) {
      return false;
    }
  }

  function isVisible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const ownerWindow = element.ownerDocument?.defaultView;
    if (ownerWindow) {
      const style = ownerWindow.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return typeof element.getClientRects !== "function" || element.getClientRects().length > 0;
  }

  function isDisabled(element) {
    return Boolean(element.disabled)
      || element.getAttribute("aria-disabled") === "true"
      || element.getAttribute("readonly") !== null;
  }

  function uniqueElements(selectors, root) {
    const found = [];
    const seen = new Set();
    for (const selector of selectors) {
      let elements = [];
      try {
        elements = Array.from(root.querySelectorAll(selector));
      } catch (_) {
        continue;
      }
      for (const element of elements) {
        if (seen.has(element)) continue;
        seen.add(element);
        found.push(element);
      }
    }
    return found;
  }

  function composerScore(element) {
    const tagName = element.tagName?.toLowerCase();
    const testId = (element.getAttribute("data-testid") || "").toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();
    const label = `${element.getAttribute("aria-label") || ""} ${element.getAttribute("placeholder") || ""}`.toLowerCase();
    let score = tagName === "textarea" ? 100 : 80;
    if (element.isContentEditable || element.getAttribute("contenteditable") === "true") score += 20;
    if (testId.includes("prompt") || testId.includes("composer")) score += 30;
    if (role === "textbox") score += 10;
    if (label.includes("message") || label.includes("prompt") || label.includes("メッセージ")) score += 10;
    if (element.closest?.("form")) score += 5;
    return score;
  }

  function findComposer(root = globalThis.document) {
    if (!root?.querySelectorAll) return null;
    return uniqueElements(composerSelectors, root)
      .filter((element) => isVisible(element) && !isDisabled(element))
      .sort((left, right) => composerScore(right) - composerScore(left))[0] || null;
  }

  function semanticActionText(element) {
    return [
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("name"),
      element.getAttribute("value"),
      element.textContent
    ]
      .filter((value) => value !== null && value !== undefined)
      .join(" ")
      .toLowerCase();
  }

  function belongsToComposerScope(element, composer) {
    if (!element || !composer) return false;

    const composerForm = composer.closest?.("form") || null;
    const candidateForm = element.closest?.("form") || null;
    if (composerForm || candidateForm) {
      return composerForm !== null && candidateForm === composerForm;
    }

    // Some ChatGPT variants do not render a form element. Walk only the
    // candidate's ancestor chain and require a real common DOM container.
    let ancestor = element.parentElement;
    while (ancestor) {
      if (typeof ancestor.contains === "function" && ancestor.contains(composer)) return true;
      ancestor = ancestor.parentElement;
    }
    return false;
  }

  function sendButtonScore(element) {
    const testId = (element.getAttribute("data-testid") || "").toLowerCase();
    const label = semanticActionText(element);
    if (excludedActionPattern.test(label)) return -1000;

    let score = 0;
    if (testId.includes("send")) score += 100;
    if (testId.includes("submit")) score += 50;
    if (sendActionPattern.test(label)) score += 80;
    if (element.getAttribute("type") === "submit") score += 40;
    // A plain button with no send semantics is deliberately left at zero.
    // There is no "last button" or "nearest button" fallback.
    return score;
  }

  function findSendButton(root = globalThis.document, options = {}) {
    if (!root?.querySelectorAll) return null;
    const composer = options.composer || findComposer(root);
    if (!composer) return null;
    const ranked = uniqueElements(sendButtonSelectors, root)
      .filter((element) => isVisible(element) && belongsToComposerScope(element, composer))
      .filter((element) => options.includeDisabled === true || !isDisabled(element))
      .map((element) => ({ element, score: sendButtonScore(element) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => {
        const disabledDifference = Number(isDisabled(left.element)) - Number(isDisabled(right.element));
        return disabledDifference || right.score - left.score;
      });
    if (ranked.length === 0) return null;

    const best = ranked[0];
    const next = ranked[1];
    if (next
      && isDisabled(best.element) === isDisabled(next.element)
      && best.score === next.score) {
      // Two equally plausible visible controls are not safely distinguishable.
      // Returning null is safer than guessing and clicking a toolbar action.
      return null;
    }
    return best.element;
  }

  function readComposerText(element) {
    if (!element) return "";
    if ("value" in element && typeof element.value === "string") return element.value;
    return element.innerText ?? element.textContent ?? "";
  }

  function readComposerTextCandidates(element) {
    if (!element) return [];
    const values = [];
    if ("value" in element && typeof element.value === "string") values.push(element.value);
    for (const property of ["innerText", "textContent"]) {
      try {
        const value = element[property];
        if (typeof value === "string") values.push(value);
      } catch (_) {
        // A stale DOM node must not prevent another representation from being
        // checked. The Content Script will report verification failure later.
      }
    }
    return [...new Set(values)];
  }

  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(zeroWidthPattern, "");
  }

  // ChatGPT's editor can expose the same input with different line, whitespace,
  // and DOM-node serialization. This normalizer is intentionally used only for
  // structural verification, never as a reason to declare a send successful.
  function normalizeComposerText(value) {
    return normalizeText(value)
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function composerContainsText(element, expected) {
    const actual = normalizeText(readComposerText(element));
    const target = normalizeText(expected);
    if (actual === target) return true;
    // Browsers can expose one synthetic trailing newline for a contenteditable
    // root. Ignore only that presentation artifact; never trim the body.
    if (element?.isContentEditable || element?.getAttribute("contenteditable") === "true") {
      return actual.replace(/\n+$/, "") === target.replace(/\n+$/, "");
    }
    return false;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function hasStructuredFieldValue(text, fieldNames, expectedValue) {
    if (typeof expectedValue !== "string" || expectedValue.trim().length === 0) return false;
    const actual = normalizeComposerText(text);
    const normalizedExpected = normalizeComposerText(expectedValue);
    if (!actual || !normalizedExpected) return false;

    const names = (Array.isArray(fieldNames) ? fieldNames : [fieldNames])
      .filter((name) => typeof name === "string" && name.length > 0)
      .map(escapeRegExp)
      .join("|");
    if (!names) return false;

    const valuePattern = escapeRegExp(normalizedExpected).replace(/\s+/g, "\\s+");
    const pattern = new RegExp(
      `(?:^|[\\s"'([{*-])(?:${names})["']?\\s*[:=]\\s*["']?${valuePattern}(?=$|[\\s"',;)}\\]])`,
      "i"
    );
    return pattern.test(actual);
  }

  function getComposerInputMarkerStatus(element, markers) {
    const protocol = markers?.protocol;
    const handoffId = markers?.handoffId || markers?.handoff_id;
    const boundaryId = markers?.boundaryId || markers?.boundary_id;
    const candidates = readComposerTextCandidates(element);
    const status = {
      protocol: false,
      handoff_id: false,
      boundary_id: false,
      all: false
    };

    for (const text of candidates) {
      status.protocol ||= hasStructuredFieldValue(text, "protocol", protocol);
      status.handoff_id ||= hasStructuredFieldValue(text, ["handoff_id", "handoffId"], handoffId);
      status.boundary_id ||= hasStructuredFieldValue(text, ["boundary_id", "boundaryId"], boundaryId);
    }
    status.all = status.protocol && status.handoff_id && status.boundary_id;
    return status;
  }

  function composerContainsInputMarkers(element, markers) {
    return getComposerInputMarkerStatus(element, markers).all;
  }

  function readMessageText(element) {
    if (!element) return "";
    return normalizeText(element.innerText ?? element.textContent ?? "");
  }

  function comparableMessageText(value) {
    return normalizeText(value)
      .replace(/\u200b/g, "")
      // ChatGPT may expose a synthetic final newline through innerText.
      .replace(/\n+$/, "");
  }

  function findUserMessages(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    return uniqueElements(userMessageSelectors, root)
      .filter((element) => isVisible(element));
  }

  function captureUserMessageSnapshot(root = globalThis.document) {
    const messages = findUserMessages(root);
    return {
      count: messages.length,
      elements: new Set(messages)
    };
  }

  function findNewUserMessages(root, snapshot) {
    const messages = findUserMessages(root);
    const beforeCount = Number(snapshot?.count || 0);
    const beforeElements = snapshot?.elements instanceof Set ? snapshot.elements : new Set();
    if (messages.length <= beforeCount) return [];
    return messages.filter((message) => !beforeElements.has(message));
  }

  function comparableMarker(value) {
    return comparableMessageText(value).trim();
  }

  function messageContainsMarker(message, marker) {
    const normalizedMarker = comparableMarker(marker);
    return normalizedMarker.length > 0
      && comparableMessageText(readMessageText(message)).includes(normalizedMarker);
  }

  function hasNewUserMessageWithCorrelation(root, correlation, snapshot) {
    const handoffId = correlation?.handoffId || correlation?.handoff_id;
    const boundaryId = correlation?.boundaryId || correlation?.boundary_id;
    if (!handoffId || !boundaryId) return false;

    const protocol = correlation?.protocol;
    return findNewUserMessages(root, snapshot).some((message) =>
      messageContainsMarker(message, handoffId)
      && messageContainsMarker(message, boundaryId)
      && (!protocol || messageContainsMarker(message, protocol)));
  }

  globalThis.ChatGptComfyConnectorLocators = Object.freeze({
    composerSelectors: Object.freeze([...composerSelectors]),
    sendButtonSelectors: Object.freeze([...sendButtonSelectors]),
    userMessageSelectors: Object.freeze([...userMessageSelectors]),
    isChatGptPage,
    isVisible,
    isDisabled,
    findComposer,
    findSendButton,
    readComposerText,
    readComposerTextCandidates,
    normalizeComposerText,
    composerContainsText,
    getComposerInputMarkerStatus,
    composerContainsInputMarkers,
    readMessageText,
    findUserMessages,
    captureUserMessageSnapshot,
    findNewUserMessages,
    messageContainsMarker,
    hasNewUserMessageWithCorrelation
  });
})();
