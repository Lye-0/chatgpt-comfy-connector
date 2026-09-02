import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const locatorSource = await readFile(join(repositoryRoot, "browser-extension", "chatgpt-locators.js"), "utf8");
const contentSource = await readFile(join(repositoryRoot, "browser-extension", "content-script.js"), "utf8");

class FakeElement {
  constructor(document, tagName, attributes = {}) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.disabled = false;
    this.isConnected = true;
    this.isContentEditable = attributes.contenteditable === "true";
    this.readTextTransform = attributes.readTextTransform;
    this._textContent = attributes.textContent || "";
    this.files = [];
    this.listeners = new Map();
  }

  get innerText() {
    const ownText = typeof this.readTextTransform === "function"
      ? this.readTextTransform(this._textContent)
      : this._textContent;
    return ownText + this.children.map((child) => child.innerText).join("");
  }
  set innerText(value) { this.textContent = value; }
  get textContent() {
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }
  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
    child.isConnected = false;
    return child;
  }

  closest(selector) {
    let current = this;
    while (current) {
      if (selector === "form" && current.tagName === "FORM") return current;
      current = current.parentElement;
    }
    return null;
  }

  contains(element) {
    let current = element;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const descendants = [];
    const visit = (element) => {
      for (const child of element.children) {
        descendants.push(child);
        visit(child);
      }
    };
    visit(this);
    if (selector === "*") return descendants;
    if (selector.includes("input[type=\"file\"]") || selector.includes("input[type='file']")) {
      return descendants.filter((element) => element.tagName === "INPUT"
        && (element.getAttribute("type") || "").toLowerCase() === "file");
    }
    if (selector.includes("data-file-name")
      || selector.includes("data-filename")
      || selector.includes("data-testid*=\"attachment\"")
      || selector.includes("data-testid*=\"file\"")
      || selector.includes("data-testid*=\"upload\"")
      || selector.includes("aria-label*=\"attachment\"")
      || selector.includes("aria-label*=\"file\"")
      || selector.includes("aria-label*=\"添付\"")
      || selector.includes("aria-label*=\"ファイル\"")
      || selector.includes("aria-label*=\"アップロード\"")
      || selector.includes("role=\"progressbar\"")) {
      return descendants.filter((element) => {
        const testId = (element.getAttribute("data-testid") || "").toLowerCase();
        const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
        return element.getAttribute("data-file-name") !== null
          || element.getAttribute("data-filename") !== null
          || testId.includes("attachment")
          || testId.includes("file")
          || testId.includes("upload")
          || ariaLabel.includes("attachment")
          || ariaLabel.includes("file")
          || ariaLabel.includes("添付")
          || ariaLabel.includes("ファイル")
          || ariaLabel.includes("アップロード")
          || element.getAttribute("role") === "progressbar";
      });
    }
    if (selector === "pre") return descendants.filter((element) => element.tagName === "PRE");
    if (selector === "code") return descendants.filter((element) => element.tagName === "CODE");
    if (selector === "[data-message-content]") {
      return descendants.filter((element) => element.getAttribute("data-message-content") !== null);
    }
    if (selector.includes("data-testid*=") && selector.includes("message-content")) {
      return descendants.filter((element) => (element.getAttribute("data-testid") || "").includes("message-content"));
    }
    if (selector.includes("data-testid*=") && selector.includes("markdown")) {
      return descendants.filter((element) => (element.getAttribute("data-testid") || "").includes("markdown"));
    }
    if (selector.includes("class*=") && selector.includes("markdown")) {
      return descendants.filter((element) => (element.getAttribute("class") || "").includes("markdown"));
    }
    if (selector.includes("class*=") && selector.includes("prose")) {
      return descendants.filter((element) => (element.getAttribute("class") || "").includes("prose"));
    }
    return descendants.filter((element) => {
      if (selector.includes("textarea")) return element.tagName === "TEXTAREA";
      if (selector.includes("contenteditable")) return element.isContentEditable;
      if (selector.includes("button") || selector.includes('role="button"')) {
        if (element.tagName !== "BUTTON" && element.getAttribute("role") !== "button") return false;
      if (selector.includes("copy")) return (element.getAttribute("data-testid") || "").includes("copy");
      if (selector.includes("retry")) return (element.getAttribute("data-testid") || "").includes("retry");
      if (selector.includes("regenerate")) return (element.getAttribute("data-testid") || "").includes("regenerate");
        if (selector.includes("stop") || selector.includes("停止")) {
          return (element.getAttribute("data-testid") || "").includes("stop")
            || (element.getAttribute("aria-label") || "").toLowerCase().includes("stop")
            || (element.getAttribute("title") || "").toLowerCase().includes("stop")
            || (element.getAttribute("aria-label") || "").includes("停止")
            || (element.getAttribute("title") || "").includes("停止");
        }
        return true;
      }
      return false;
    });
  }

  compareDocumentPosition(other) {
    const ordered = this.ownerDocument.allElements();
    const left = ordered.indexOf(this);
    const right = ordered.indexOf(other);
    if (left < 0 || right < 0 || left === right) return 0;
    return right > left ? 4 : 2;
  }

  getClientRects() { return [{}]; }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.ownerDocument.activeElement = this; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatchEvent(event) {
    if (event.type === "paste" && this.ownerDocument.contentEditableInsert === "paste") {
      this.textContent = event.clipboardData?.getData("text/plain") || "";
    }
    if (event.type === "change"
      && this.tagName === "INPUT"
      && (this.getAttribute("type") || "").toLowerCase() === "file") {
      this.ownerDocument.onFileInputChanged(this);
    }
    if (event.type === "input") this.ownerDocument.onComposerInput?.(this);
    this.listeners.get(event.type)?.(event);
    return true;
  }

  cloneNode(deep = false) {
    const clone = new FakeElement(this.ownerDocument, this.tagName, Object.fromEntries(this.attributes));
    clone.hidden = this.hidden;
    clone.disabled = this.disabled;
    clone.isConnected = this.isConnected;
    clone.isContentEditable = this.isContentEditable;
    clone.readTextTransform = this.readTextTransform;
    clone._textContent = this._textContent;
    if (deep) {
      for (const child of this.children) clone.appendChild(child.cloneNode(true));
    }
    return clone;
  }
}

class FakeTextArea extends FakeElement {
  constructor(document, attributes = {}) {
    super(document, "textarea", attributes);
    this._value = "";
  }

  get value() { return this._value; }
  set value(value) { this._value = String(value); }
}

class FakeButton extends FakeElement {
  constructor(document, attributes = {}, onClick = () => {}) {
    super(document, "button", attributes);
    this.onClick = onClick;
  }

  click() { this.onClick(); }
}

class FakeEvent {
  constructor(type) { this.type = type; }
}

class FakeDataTransfer {
  constructor() {
    this.values = new Map();
    this.files = [];
    this.items = {
      add: (file) => {
        this.files.push(file);
      }
    };
  }
  setData(type, value) { this.values.set(type, String(value)); }
  getData(type) { return this.values.get(type) || ""; }
}

class FakeFile {
  constructor(parts, name, options = {}) {
    this.name = String(name);
    this.type = String(options.type || "");
    this.parts = parts;
    this.size = parts.reduce((total, part) => {
      if (typeof part === "string") return total + part.length;
      return total + (part?.byteLength ?? part?.length ?? 0);
    }, 0);
  }
}

class FakeClipboardEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type);
    this.clipboardData = init.clipboardData;
  }
}

class FakeDocument {
  constructor({ composer = "textarea", composerMountDelayMs = 0, sendButton = "ready", sendButtonReadyAfterMs = 0, plusLabel = "写真やファイルを追加", contentEditableInsert = "exec-command", composerReadTransform = null, url = "https://chatgpt.com/c/fixture", initialAssistantMessages = [], fileInput = true, attachmentVerification = true, attachmentUploading = false } = {}) {
    this.activeElement = null;
    this.listeners = new Map();
    this.visibilityState = "visible";
    this.hidden = false;
    this.wasDiscarded = false;
    this.composers = [];
    this.sendButtons = [];
    this.buttons = [];
    this.userMessages = [];
    this.assistantMessages = [];
    this.plusMenuOpened = false;
    this.sendClicked = false;
    this.fileInputEnabled = fileInput;
    this.attachmentVerification = attachmentVerification;
    this.attachmentUploading = attachmentUploading;
    this.sendButtonReadyAfterMs = sendButtonReadyAfterMs;
    this.delayedSendButtonTimerStarted = false;
    this.delayedSendButton = null;
    this.fileInput = null;
    this.attachmentIndicators = [];
    this.contentEditableInsert = contentEditableInsert;
    this.defaultView = { getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
    this.location = { href: url };
    this.body = new FakeElement(this, "body");
    const composerForm = new FakeElement(this, "form");
    this.body.appendChild(composerForm);

    const mountComposer = () => {
      if (this.composers.length > 0 || composer === "missing") return;
      if (composer === "textarea") {
        const textarea = new FakeTextArea(this, {
          "data-testid": "prompt-textarea",
          placeholder: "メッセージを入力"
        });
        composerForm.appendChild(textarea);
        this.composers.push(textarea);
      } else if (composer === "contenteditable") {
        const contentEditable = new FakeElement(this, "div", {
          contenteditable: "true",
          role: "textbox",
          "aria-label": "メッセージを入力",
          readTextTransform: composerReadTransform
        });
        composerForm.appendChild(contentEditable);
        this.composers.push(contentEditable);
      }
    };
    if (composerMountDelayMs > 0) setTimeout(mountComposer, composerMountDelayMs);
    else mountComposer();

    if (fileInput) {
      this.fileInput = new FakeElement(this, "input", {
        type: "file",
        accept: "image/*,video/mp4",
        "data-testid": "file-upload"
      });
      composerForm.appendChild(this.fileInput);
    }

    const plusButton = new FakeButton(this, {
      "data-testid": "attachment-button",
      "aria-label": plusLabel
    }, () => {
      this.plusMenuOpened = true;
    });
    composerForm.appendChild(plusButton);
    this.buttons.push(plusButton);

    if (sendButton !== "missing" && sendButton !== "plus-only") {
      const button = new FakeButton(this, {
        "data-testid": "send-button",
        "aria-label": "Send",
        type: "submit",
        ...(sendButton === "disabled" ? { "aria-disabled": "true" } : {})
      }, () => {
        this.sendClicked = true;
        if (sendButton === "ready" || sendButton === "no-message" || sendButton === "wrong-message") {
          const active = this.composers[0];
          this.lastPayload = active instanceof FakeTextArea ? active.value : active?.textContent || "";
          if (active instanceof FakeTextArea) active.value = "";
          else if (active) active.textContent = "";
        }
        if (sendButton === "ready") this.appendUserMessage(this.lastPayload);
        if (sendButton === "wrong-message") this.appendUserMessage("unrelated user message");
      });
      composerForm.appendChild(button);
      this.sendButtons.push(button);
      this.buttons.push(button);
      if (sendButton === "disabled") button.disabled = true;
      if (sendButtonReadyAfterMs > 0) {
        button.disabled = true;
        this.delayedSendButton = button;
      }
      if (sendButton === "ambiguous") {
        const duplicate = new FakeButton(this, {
          "data-testid": "send-button",
          "aria-label": "Send",
          type: "submit"
        });
        composerForm.appendChild(duplicate);
        this.sendButtons.push(duplicate);
        this.buttons.push(duplicate);
      }
    }
    for (const payload of initialAssistantMessages) this.appendAssistantMessage(payload);
  }

  allElements() {
    const ordered = [];
    const visit = (element) => {
      ordered.push(element);
      for (const child of element.children) visit(child);
    };
    visit(this.body);
    return ordered;
  }

  appendUserMessage(payload) {
    const message = new FakeElement(this, "div", {
      "data-message-author-role": "user"
    });
    message.textContent = payload;
    this.body.appendChild(message);
    this.userMessages.push(message);
  }

  appendAssistantMessage(payload, { withCopyAction = false } = {}) {
    const message = new FakeElement(this, "div", {
      "data-message-author-role": "assistant"
    });
    message.textContent = payload;
    if (withCopyAction) {
      message.appendChild(new FakeButton(this, {
        "data-testid": "copy-turn",
        "aria-label": "Copy"
      }));
    }
    this.body.appendChild(message);
    this.assistantMessages.push(message);
    return message;
  }

  onFileInputChanged(fileInput) {
    if (!this.attachmentVerification || !fileInput.files?.[0]) return;
    if (this.attachmentIndicators.some((indicator) => indicator.getAttribute("data-file-name") === fileInput.files[0].name)) return;
    const indicator = new FakeElement(this, "div", {
      "data-testid": "file-attachment",
      "data-file-name": fileInput.files[0].name,
      "aria-label": fileInput.files[0].name,
      ...(this.attachmentUploading ? { "aria-busy": "true" } : {})
    });
    this.fileInput.parentElement?.appendChild(indicator);
    this.attachmentIndicators.push(indicator);
  }

  onComposerInput(element) {
    if (this.delayedSendButtonTimerStarted
      || !this.composers.includes(element)
      || !this.delayedSendButton
      || this.sendButtonReadyAfterMs <= 0) return;
    this.delayedSendButtonTimerStarted = true;
    setTimeout(() => { this.delayedSendButton.disabled = false; }, this.sendButtonReadyAfterMs);
  }

  appendAssistantStatusMessage(statusText) {
    const message = new FakeElement(this, "div", {
      "data-message-author-role": "assistant"
    });
    message.appendChild(new FakeElement(this, "div", {
      role: "status",
      "aria-live": "polite",
      "data-testid": "assistant-response-status",
      textContent: statusText
    }));
    this.body.appendChild(message);
    this.assistantMessages.push(message);
    return message;
  }

  appendAssistantCodeMessage({ codeText, language = "connector-command", classLanguage = language, header = false, before = "", after = "", rawCodeText = null, statusText = "", contentRoot = false }) {
    const message = new FakeElement(this, "div", {
      "data-message-author-role": "assistant"
    });
    message._textContent = before;
    if (statusText) {
      message.appendChild(new FakeElement(this, "div", {
        role: "status",
        "aria-live": "polite",
        "data-testid": "assistant-response-status",
        textContent: statusText
      }));
    }
    const content = contentRoot
      ? new FakeElement(this, "div", { "data-message-content": "true" })
      : message;
    const pre = new FakeElement(this, "pre");
    if (header) {
      pre.appendChild(new FakeElement(this, "div", { textContent: language }));
    }
    const codeAttributes = classLanguage ? { class: `language-${classLanguage}` } : {};
    pre.appendChild(new FakeElement(this, "code", { ...codeAttributes, textContent: codeText }));
    content.appendChild(pre);
    if (rawCodeText !== null) {
      const rawPre = new FakeElement(this, "pre");
      rawPre.appendChild(new FakeElement(this, "code", { textContent: rawCodeText }));
      content.appendChild(rawPre);
    }
    if (after) content.appendChild(new FakeElement(this, "p", { textContent: after }));
    if (contentRoot) message.appendChild(content);
    this.body.appendChild(message);
    this.assistantMessages.push(message);
    return message;
  }

  addStopButton() {
    const button = new FakeButton(this, {
      "data-testid": "stop-button",
      "aria-label": "Stop"
    });
    this.body.appendChild(button);
    this.buttons.push(button);
    return button;
  }

  removeButton(button) {
    this.body.removeChild(button);
    this.buttons = this.buttons.filter((candidate) => candidate !== button);
  }

  querySelectorAll(selector) {
    const elements = this.allElements();
    if (selector.includes("input[type=\"file\"]") || selector.includes("input[type='file']")) {
      return elements.filter((element) => element.tagName === "INPUT"
        && (element.getAttribute("type") || "").toLowerCase() === "file");
    }
    if (selector.includes("data-file-name")
      || selector.includes("data-filename")
      || selector.includes("data-testid*=\"attachment\"")
      || selector.includes("data-testid*=\"file\"")
      || selector.includes("data-testid*=\"upload\"")
      || selector.includes("aria-label*=\"attachment\"")
      || selector.includes("aria-label*=\"file\"")
      || selector.includes("aria-label*=\"添付\"")
      || selector.includes("aria-label*=\"ファイル\"")
      || selector.includes("aria-label*=\"アップロード\"")
      || selector.includes("role=\"progressbar\"")) {
      return elements.filter((element) => {
        const testId = (element.getAttribute("data-testid") || "").toLowerCase();
        const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
        return element.getAttribute("data-file-name") !== null
          || element.getAttribute("data-filename") !== null
          || testId.includes("attachment")
          || testId.includes("file")
          || testId.includes("upload")
          || ariaLabel.includes("attachment")
          || ariaLabel.includes("file")
          || ariaLabel.includes("添付")
          || ariaLabel.includes("ファイル")
          || ariaLabel.includes("アップロード")
          || element.getAttribute("role") === "progressbar";
      });
    }
    if (selector.includes("assistant")) return this.assistantMessages;
    if (selector.includes("textarea")) return this.composers.filter((element) => element.tagName === "TEXTAREA");
    if (selector.includes("contenteditable") || selector.includes("role=\"textbox\"")) {
      return this.composers.filter((element) => element.isContentEditable);
    }
    if (selector === "*") return this.allElements();
    if (selector.includes("data-message-author-role")
      || selector.includes("user-message")
      || selector.includes("conversation-turn-user")) return this.userMessages;
    if (selector.includes("stop") || selector.includes("停止")) {
      return this.buttons.filter((button) =>
        (button.getAttribute("data-testid") || "").toLowerCase().includes("stop")
        || (button.getAttribute("aria-label") || "").toLowerCase().includes("stop")
        || (button.getAttribute("title") || "").toLowerCase().includes("stop")
        || (button.getAttribute("aria-label") || "").includes("停止")
        || (button.getAttribute("title") || "").includes("停止"));
    }
    if (selector.includes("button") || selector.includes("role=\"button\"")) return this.buttons;
    return [];
  }

  createRange() {
    return { selectNodeContents() {} };
  }

  getSelection() {
    return { removeAllRanges() {}, addRange() {} };
  }

  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatchEvent(event) {
    this.listeners.get(event.type)?.(event);
    return true;
  }

  execCommand(command, _showUi, payload) {
    if (command !== "insertText" || !this.activeElement || this.contentEditableInsert === "paste") return false;
    this.activeElement.textContent = payload;
    return true;
  }
}

async function createHarness(options) {
  const document = new FakeDocument(options);
  const runtimeListeners = [];
  const runtimeMessages = [];
  const diagnostics = [];
  const context = createContext({
    console: {
      info(...args) { diagnostics.push(args); },
      warn() {},
      error() {},
      log() {}
    },
    URL,
    Promise,
    Map,
    Set,
    Date,
    Error,
    String,
    Boolean,
    InputEvent: FakeEvent,
    Event: FakeEvent,
    DataTransfer: FakeDataTransfer,
    File: FakeFile,
    Uint8Array,
    ClipboardEvent: FakeClipboardEvent,
    CustomEvent: class extends FakeEvent { constructor(type, init) { super(type); this.detail = init?.detail; } },
    HTMLTextAreaElement: FakeTextArea,
    document,
    location: document.location,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (callback) => setTimeout(callback, 0),
    window: { dispatchEvent() {} },
    chrome: {
      runtime: {
        id: "fixture-extension",
        onMessage: { addListener: (listener) => runtimeListeners.push(listener) },
        sendMessage: options?.runtimeContextInvalidated
          ? () => { throw new Error("Extension context invalidated."); }
          : options?.runtimeMessageNeverSettles
            ? () => new Promise(() => {})
          : async (message) => {
            runtimeMessages.push(message);
            return { ok: true };
          }
      }
    }
  });
  new Script(locatorSource).runInContext(context);
  if (options?.locatorOverrides) {
    // The production locator object is frozen. Replace the global object in
    // the fixture before loading Content Script so error-envelope tests can
    // exercise the same boundary without altering the page fixtures.
    context.ChatGptComfyConnectorLocators = {
      ...context.ChatGptComfyConnectorLocators,
      ...options.locatorOverrides
    };
  }
  // Keep the production wait long enough for a real ChatGPT render, while
  // keeping the negative fixture fast and deterministic.
  const fixtureContentSource = contentSource.replace(
    "const sendAcceptanceTimeoutMs = 8000;",
    "const sendAcceptanceTimeoutMs = 50;"
  ).replace(
    "const handoffAcceptancePollIntervalMs = 100;",
    "const handoffAcceptancePollIntervalMs = 5;"
  ).replace(
    "const composerStateTimeoutMs = 1500;",
    "const composerStateTimeoutMs = 50;"
  ).replace(
    "const composerMountTimeoutMs = 20000;",
    "const composerMountTimeoutMs = 100;"
  ).replace(
    "const newConversationBindingTimeoutMs = 5000;",
    "const newConversationBindingTimeoutMs = 800;"
  ).replace(
    "const composerPollIntervalMs = 100;",
    "const composerPollIntervalMs = 5;"
  ).replace(
    "const reviewComposerStateTimeoutMs = 60000;",
    "const reviewComposerStateTimeoutMs = 150;"
  ).replace(
    "const responseTimeoutMs = 120000;",
    "const responseTimeoutMs = 300;"
  ).replace(
    "const responseStabilityMs = 900;",
    "const responseStabilityMs = 20;"
  ).replace(
    "const responsePollIntervalMs = 100;",
    "const responsePollIntervalMs = 5;"
  ).replace(
    "const attachmentVerificationTimeoutMs = 15000;",
    "const attachmentVerificationTimeoutMs = 50;"
  ).replace(
    "      await wait(100);",
    "      await wait(5);"
  );
  new Script(fixtureContentSource).runInContext(context);
  return {
    context,
    document,
    get diagnostics() { return diagnostics; },
    async send(message) {
      let response;
      const listener = runtimeListeners.find((candidate) => candidate(message, { id: "fixture-extension" }, (value) => { response = value; }) === true);
      assert.ok(listener, "Content Script handler should accept the message");
      while (!response) await new Promise((resolve) => setTimeout(resolve, 0));
      return response;
    },
    messages: runtimeMessages,
    async waitForRuntimeMessage(predicate = () => true) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const message = runtimeMessages.find(predicate);
        if (message) return message;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.fail("Content Script did not report the expected runtime message");
    }
  };
}

const handoff = {
  type: "HANDOFF_SEND",
  requestId: "request-fixture",
  sessionId: "session-fixture",
  handoffId: "handoff-fixture",
  boundaryId: "boundary-fixture",
  protocol: "comfy-connector/1",
  payload: "## Handoff\nProtocol: comfy-connector/1\nhandoff_id: handoff-fixture\nboundary_id: boundary-fixture\n"
};

test("Content Script preserves Project identity navigation stages in its safe runtime relay", async () => {
  const harness = await createHarness({ url: "https://chatgpt.com/" });
  const result = await harness.send({
    type: "GET_CHATGPT_CONTEXT",
    requestId: "project-identity-telemetry-fixture",
    refreshGeneration: 3,
    navigationGeneration: "refresh-3-identity-0",
    collectorTabId: 100,
    mode: "list",
    collection: "project_identity",
    identityMode: "navigation",
    projects: [{ project_index: 0, discovery_index: 0, title: "Project without a DOM row" }]
  });

  assert.equal(result.status, "ok");
  const relocation = await harness.waitForRuntimeMessage((message) =>
    message.type === "COLLECTOR_PROJECT_IDENTITY_TELEMETRY"
      && message.stage === "collector_project_identity_row_relocation");
  assert.equal(relocation.request_id, "project-identity-telemetry-fixture");
  assert.equal(relocation.refresh_generation, 3);
  assert.equal(relocation.navigation_generation, "refresh-3-identity-0");
  assert.equal(relocation.project_index, 0);
  assert.equal(relocation.row_found, false);
  assert.equal(Object.hasOwn(relocation, "project_title"), false);
  const target = await harness.waitForRuntimeMessage((message) =>
    message.type === "COLLECTOR_PROJECT_IDENTITY_TELEMETRY"
      && message.stage === "collector_project_identity_click_target");
  assert.equal(target.selected_target_type, "none");
  assert.equal(target.selected_target_inside_project_row, false);
  assert.equal(target.interactive_candidate_count, 0);
  assert.equal(target.safe_candidate_count, 0);
  assert.equal(target.selection_reason, "no_safe_project_navigation_target");
  assert.equal(Object.hasOwn(target, "project_title"), false);
  assert.equal(result.navigation_failure_reason, "project_row_fingerprint_mismatch");
  assert.equal(result.internal_reason, "project_row_fingerprint_mismatch");
});

test("Content Script preserves safe diagnostics when Project Chat collection throws", async () => {
  const harness = await createHarness({
    url: "https://chatgpt.com/g/g-p-project-page/project",
    locatorOverrides: {
      collectChatGptProjectContextAsync: async () => {
        const error = new Error("sensitive page details must not cross the boundary");
        error.name = "ReferenceError";
        throw error;
      }
    }
  });
  const result = await harness.send({
    type: "GET_CHATGPT_CONTEXT",
    requestId: "project-chat-error-fixture",
    refreshGeneration: 4,
    collectorTabId: 101,
    projectIndex: 0,
    totalProjects: 10,
    projectId: "g-p-project-page",
    mode: "list",
    collection: "project"
  });

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "context_extraction_failed");
  assert.equal(result.failure_stage, "project_chat_collection");
  assert.equal(result.internal_reason, "reference_error");
  assert.equal(Object.hasOwn(result, "exception_message"), false);
  const failure = await harness.waitForRuntimeMessage((message) =>
    message.type === "COLLECTOR_PROJECT_CHAT_TELEMETRY"
      && message.stage === "collector_project_chat_collection_failed");
  assert.equal(failure.current_project_id, "g-p-project-page");
  assert.equal(failure.project_index, 0);
  assert.equal(failure.total_projects, 10);
  assert.equal(failure.exception_name, "ReferenceError");
  assert.equal(failure.exception_reason, "reference_error");
  assert.equal(Object.hasOwn(failure, "exception_message"), false);
  assert.equal(JSON.stringify(failure).includes("sensitive page details"), false);
});

test("Content Script rejects a malformed Project Chat collection result with a safe reason", async () => {
  const harness = await createHarness({
    url: "https://chatgpt.com/g/g-p-project-page/project",
    locatorOverrides: {
      collectChatGptProjectContextAsync: async () => ({
        projects: [],
        conversations: "not-an-array"
      })
    }
  });
  const result = await harness.send({
    type: "GET_CHATGPT_CONTEXT",
    requestId: "project-chat-malformed-fixture",
    projectId: "g-p-project-page",
    mode: "list",
    collection: "project"
  });

  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "context_response_invalid");
  assert.equal(result.internal_reason, "collector_result_malformed");
  const failure = await harness.waitForRuntimeMessage((message) =>
    message.type === "COLLECTOR_PROJECT_CHAT_TELEMETRY"
      && message.stage === "collector_project_chat_collection_failed");
  assert.equal(failure.error_code, "context_response_invalid");
  assert.equal(failure.internal_reason, "collector_result_malformed");
  assert.equal(failure.exception_reason, "none");
});

test("Content Script reports Managed Tab readiness only after the composer and bound Conversation are ready", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const result = await harness.send({
    type: "CHATGPT_EXECUTION_READY",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    expectedConversationId: "fixture",
    expectedConversationUrl: "https://chatgpt.com/c/fixture",
    requireComposer: true
  });

  assert.equal(result.status, "ready");
  assert.equal(result.stage, "conversation_ready");
  assert.equal(result.composer_ready, true);
  assert.equal(result.current_context.conversation_id, "fixture");
  assert.equal(result.current_context.url, "https://chatgpt.com/c/fixture");
});

test("Content Script can arm a pre-send watcher, then bind it to the newly posted user message", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const watching = await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol,
    prepare: true
  });
  assert.equal(watching.status, "watching");
  assert.equal(watching.stage, "response_watch_ready");

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(harness.messages.some((message) => message.type === "ASSISTANT_RESPONSE_RESULT"), false);

  const sent = await harness.send(handoff);
  assert.equal(sent.status, "sent");
  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "complete",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    reason: "approved"
  });
  harness.document.appendAssistantCodeMessage({
    codeText: command,
    language: "connector-command",
    classLanguage: null
  });

  const response = await harness.waitForRuntimeMessage((message) =>
    message.type === "ASSISTANT_RESPONSE_RESULT" && message.status === "received");
  assert.equal(response.requestId, handoff.requestId);
  assert.equal(response.payload, `\`\`\`connector-command\n${command}\n\`\`\``);
});

test("Content Script fills a textarea with React-visible input and confirms send", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const result = await harness.send(handoff);
  assert.deepEqual({ ...result, current_context: undefined }, {
    request_id: handoff.requestId,
    handoff_id: handoff.handoffId,
    status: "sent",
    stage: "user_message_correlated",
    current_context: undefined
  });
  assert.equal(result.current_context?.conversation_id, "fixture");
  assert.equal(result.current_context?.title, "fixture");
  assert.equal(result.current_context?.url, "https://chatgpt.com/c/fixture");
  assert.equal(harness.document.composers[0].value, "");
  assert.equal(harness.document.plusMenuOpened, false, "the attachment/plus button must never be clicked");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.userMessages.length, 1);
  assert.equal(harness.document.userMessages[0].textContent, handoff.payload);
  const confirmation = harness.messages.find((message) => message.type === "HANDOFF_SEND_CONFIRMED");
  assert.ok(confirmation);
  assert.equal(confirmation.requestId, handoff.requestId);
  assert.equal(confirmation.sessionId, handoff.sessionId);
  assert.equal(confirmation.handoffId, handoff.handoffId);
  assert.equal(confirmation.boundaryId, handoff.boundaryId);
  assert.equal(confirmation.payload, undefined);
});

test("Content Script confirms a new-chat post before optional route binding completes", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready",
    url: "https://chatgpt.com/g/g-p-fixture"
  });
  const newChatHandoff = {
    ...handoff,
    requestId: "request-new-chat-fixture",
    handoffId: "handoff-new-chat-fixture",
    boundaryId: "boundary-new-chat-fixture",
    newConversation: true,
    payload: handoff.payload
      .replaceAll(handoff.handoffId, "handoff-new-chat-fixture")
      .replaceAll(handoff.boundaryId, "boundary-new-chat-fixture")
  };

  const sendPromise = harness.send(newChatHandoff);
  const confirmation = await harness.waitForRuntimeMessage((message) =>
    message.type === "HANDOFF_SEND_CONFIRMED"
      && message.requestId === newChatHandoff.requestId);
  assert.equal(confirmation.status, "sent");
  assert.equal(confirmation.handoffId, newChatHandoff.handoffId);

  const result = await sendPromise;
  assert.equal(result.status, "sent");
  assert.equal(harness.document.userMessages.length, 1);
});

test("Content Script waits for a newly loaded ChatGPT composer before sending", async () => {
  const harness = await createHarness({
    composer: "textarea",
    composerMountDelayMs: 20,
    sendButton: "ready"
  });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.userMessages[0].textContent, handoff.payload);
});

test("Content Script reuses an already accepted Handoff instead of posting it twice", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready",
    fileInput: false,
    attachmentVerification: false
  });
  harness.document.appendUserMessage(handoff.payload);

  const result = await harness.send({
    ...handoff,
    requestId: "request-fixture-retry",
    review: true,
    expectedAttachment: {
      mediaId: "media-fixture",
      fileName: "already-sent.mp4",
      iteration: 1
    }
  });

  assert.equal(result.status, "sent");
  assert.equal(result.stage, "user_message_already_correlated");
  assert.equal(harness.document.sendClicked, false);
  assert.equal(harness.document.userMessages.length, 1);
});

test("Content Script confirms an already accepted Handoff after its original context was replaced", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready"
  });
  harness.document.appendUserMessage(handoff.payload);

  const result = await harness.send({
    type: "CHECK_HANDOFF_SENT",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol,
    targetTabId: 17
  });

  assert.equal(result.status, "sent");
  assert.equal(result.stage, "user_message_already_correlated");
  assert.equal(harness.document.sendClicked, false);
  assert.equal(harness.document.userMessages.length, 1);
});

test("Content Script waits for the accepted user message after a new-tab hydration gap", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready"
  });
  const checkPromise = harness.send({
    type: "CHECK_HANDOFF_SENT",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol,
    targetTabId: 17
  });
  setTimeout(() => harness.document.appendUserMessage(handoff.payload), 10);

  const result = await checkPromise;
  assert.equal(result.status, "sent");
  assert.equal(result.stage, "user_message_already_correlated");
  assert.equal(harness.document.userMessages.length, 1);
});

test("Content Script tolerates an invalidated Extension context during best-effort notifications", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready",
    runtimeContextInvalidated: true
  });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
});

test("Content Script does not block a confirmed post on the notification response", async () => {
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready",
    runtimeMessageNeverSettles: true
  });

  const result = await Promise.race([
    harness.send(handoff),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Handoff completion was blocked by notification ACK")), 100))
  ]);

  assert.equal(result.status, "sent");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.messages.length, 0);
});

test("Content Script also supports a contenteditable composer", async () => {
  const harness = await createHarness({ composer: "contenteditable", sendButton: "ready" });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
});

test("Content Script accepts structural markers when contenteditable text serialization differs", async () => {
  const harness = await createHarness({
    composer: "contenteditable",
    sendButton: "ready",
    composerReadTransform: (value) => value
      .replace(/ /g, "\u00a0")
      .replace(/\n/g, "\n\n")
      .replace(/boundary_id:/g, "boundary_id: \u200b")
  });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.plusMenuOpened, false);
});

test("Content Script does not send when the handoff identifier is missing", async () => {
  const harness = await createHarness({ composer: "contenteditable", sendButton: "ready" });
  const result = await harness.send({
    ...handoff,
    payload: handoff.payload.replace("handoff_id: handoff-fixture\n", "")
  });
  assert.equal(result.error_code, "composer_input_verification_failed");
  assert.equal(result.stage, "input_identifiers_missing");
  assert.equal(harness.document.sendClicked, false);
});

test("Content Script does not send when the boundary identifier is missing", async () => {
  const harness = await createHarness({ composer: "contenteditable", sendButton: "ready" });
  const result = await harness.send({
    ...handoff,
    payload: handoff.payload.replace("boundary_id: boundary-fixture\n", "")
  });
  assert.equal(result.error_code, "composer_input_verification_failed");
  assert.equal(result.stage, "input_identifiers_missing");
  assert.equal(harness.document.sendClicked, false);
});

test("Content Script does not send when the protocol marker is missing", async () => {
  const harness = await createHarness({ composer: "contenteditable", sendButton: "ready" });
  const result = await harness.send({
    ...handoff,
    payload: handoff.payload.replace("Protocol: comfy-connector/1\n", "")
  });
  assert.equal(result.error_code, "composer_input_verification_failed");
  assert.equal(result.stage, "input_identifiers_missing");
  assert.equal(harness.document.sendClicked, false);
});

test("Content Script conditionally uses the editor paste route when execCommand is unavailable", async () => {
  const harness = await createHarness({ composer: "contenteditable", contentEditableInsert: "paste", sendButton: "ready" });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
  assert.equal(harness.document.plusMenuOpened, false);
});

test("Content Script rejects a non-ChatGPT page", async () => {
  const harness = await createHarness({ url: "https://example.invalid/" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "active_tab_not_chatgpt");
});

test("Content Script reports missing composer and unavailable send button", async () => {
  const missingComposer = await createHarness({ composer: "missing", sendButton: "ready" });
  assert.equal((await missingComposer.send(handoff)).error_code, "composer_not_found");

  const missingButton = await createHarness({ composer: "textarea", sendButton: "missing" });
  assert.equal((await missingButton.send(handoff)).error_code, "send_button_not_found");
});

test("Content Script reports a disabled send button", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "disabled" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "composer_input_failed");
  assert.equal(result.stage, "send_button_not_enabled");
  assert.equal(harness.document.sendClicked, false);
});

test("Content Script refuses to click the plus button when no safe Send candidate exists", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "plus-only" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "send_button_not_found");
  assert.equal(harness.document.plusMenuOpened, false);
  assert.equal(harness.document.sendClicked, false);
});

test("Content Script rejects an English attachment label as a Send candidate", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "plus-only", plusLabel: "Add files" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "send_button_not_found");
  assert.equal(harness.document.plusMenuOpened, false);
});

test("Content Script refuses to guess when two Send candidates are equally plausible", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ambiguous" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "send_button_not_found");
  assert.equal(harness.document.sendClicked, false);
  assert.equal(harness.document.plusMenuOpened, false);
});

test("Content Script does not report sent when clicking Send does not add a user message", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "no-message" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "send_failed");
  assert.equal(harness.document.plusMenuOpened, false);
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.userMessages.length, 0);
  assert.equal(result.stage, "user_message_not_observed");
});

test("Content Script does not report sent for an unrelated new user message", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "wrong-message" });
  const result = await harness.send(handoff);
  assert.equal(result.error_code, "send_failed");
  assert.equal(result.stage, "user_message_not_correlated");
  assert.equal(harness.document.userMessages.length, 1);
});

test("Content Script reconstructs the connector-command fence and preserves a raw payload block", async () => {
  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "generate",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    slots: { "6.text": { payload_id: "prompt-main" } }
  });
  const payload = "<<<COMFY_PAYLOAD:prompt-main:boundary-fixture>>>\n近未来の都市 {raw: true}\n<<<END_COMFY_PAYLOAD:prompt-main:boundary-fixture>>>";
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const message = harness.document.appendAssistantCodeMessage({
    codeText: command,
    language: "connector-command",
    header: true,
    rawCodeText: payload
  });

  const extracted = harness.context.ChatGptComfyConnectorLocators.readAssistantResponseText(message);
  assert.equal(extracted, `\`\`\`connector-command\n${command}\n\`\`\`${"\n"}${payload}`);
  assert.equal(extracted.includes(payload), true);
});

test("Content Script reconstructs a connector-command fence for a payload-free complete response", async () => {
  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "complete",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    reason: "完成"
  });
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const message = harness.document.appendAssistantCodeMessage({
    codeText: command,
    language: "connector-command",
    classLanguage: null,
    header: false
  });

  const extracted = harness.context.ChatGptComfyConnectorLocators.readAssistantResponseText(message, {
    protocol: handoff.protocol,
    handoffId: handoff.handoffId,
    sessionId: handoff.sessionId
  });
  assert.equal(extracted, `\`\`\`connector-command\n${command}\n\`\`\``);
});

test("Content Script sends the canonical rendered generate response through the watcher", async () => {
  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "generate",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    slots: { "6.text": { payload_id: "prompt-main" } }
  });
  const payload = "<<<COMFY_PAYLOAD:prompt-main:boundary-fixture>>>\nraw prompt\n<<<END_COMFY_PAYLOAD:prompt-main:boundary-fixture>>>";
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  assert.equal((await harness.send(handoff)).status, "sent");
  assert.equal((await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  })).status, "watching");

  harness.document.appendAssistantCodeMessage({
    codeText: command,
    language: "connector-command",
    classLanguage: null,
    rawCodeText: payload
  });
  const result = await harness.waitForRuntimeMessage((message) =>
    message.type === "ASSISTANT_RESPONSE_RESULT" && message.status === "received");
  assert.equal(result.payload, `\`\`\`connector-command\n${command}\n\`\`\`${"\n"}${payload}`);
});

test("Content Script watches only the assistant response after the correlated user anchor", async () => {
  const oldResponse = "```connector-command\n{\"protocol\":\"comfy-connector/1\",\"action\":\"complete\"}\n```";
  const newResponse = "```connector-command\n"
    + JSON.stringify({
      protocol: "comfy-connector/1",
      action: "complete",
      handoff_id: handoff.handoffId,
      boundary_id: handoff.boundaryId
    })
    + "\n```";
  const harness = await createHarness({
    composer: "textarea",
    sendButton: "ready",
    initialAssistantMessages: [oldResponse]
  });
  assert.equal(harness.context.ChatGptComfyConnectorLocators.isGenerating(harness.document), false);
  assert.equal((await harness.send(handoff)).status, "sent");
  const watching = await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  });
  assert.equal(watching.status, "watching");

  harness.document.appendAssistantMessage(newResponse, { withCopyAction: true });
  const result = await harness.waitForRuntimeMessage((message) =>
    message.type === "ASSISTANT_RESPONSE_RESULT" && message.status === "received");
  assert.equal(result.requestId, handoff.requestId);
  assert.equal(result.handoffId, handoff.handoffId);
  assert.equal(result.boundaryId, handoff.boundaryId);
  assert.equal(result.payload, newResponse);
  assert.equal(result.stage, "assistant_response_complete");
});

test("Content Script waits for streaming to stop before reporting assistant response", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  assert.equal((await harness.send(handoff)).status, "sent");
  assert.equal((await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  })).status, "watching");
  const stopButton = harness.document.addStopButton();
  harness.document.appendAssistantStatusMessage("思考中");
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(harness.messages.some((message) => message.type === "ASSISTANT_RESPONSE_RESULT"), false);
  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "complete",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    reason: "approved"
  });
  harness.document.appendAssistantCodeMessage({
    codeText: command,
    classLanguage: "connector-command",
    statusText: "より詳細な画像を生成しています。少々お待ちください。",
    contentRoot: true
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(harness.messages.some((message) => message.type === "ASSISTANT_RESPONSE_RESULT"), false);
  harness.document.removeButton(stopButton);
  const result = await harness.waitForRuntimeMessage((message) => message.type === "ASSISTANT_RESPONSE_RESULT");
  assert.equal(result.status, "received");
  assert.equal(result.stage, "assistant_response_complete");
  assert.equal(result.payload.includes("思考中"), false);
  assert.equal(result.payload.includes("より詳細な画像を生成しています"), false);
});

test("Content Script ignores progress-only assistant turns and reports one final response after repeated mutations", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  assert.equal((await harness.send(handoff)).status, "sent");
  assert.equal((await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  })).status, "watching");

  const statusMessage = harness.document.appendAssistantStatusMessage("より詳細な画像を生成しています。少々お待ちください。");
  assert.equal(harness.context.ChatGptComfyConnectorLocators.findAssistantMessages(harness.document).includes(statusMessage), false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(harness.messages.some((message) => message.type === "ASSISTANT_RESPONSE_RESULT"), false);

  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "generate",
    handoff_id: handoff.handoffId,
    session_id: handoff.sessionId,
    slots: { "6.text": { payload_id: "prompt-main" } }
  });
  const payload = "<<<COMFY_PAYLOAD:prompt-main:boundary-fixture>>>\nraw prompt\n<<<END_COMFY_PAYLOAD:prompt-main:boundary-fixture>>>";
  const finalMessage = harness.document.appendAssistantCodeMessage({
    codeText: command,
    classLanguage: "connector-command",
    statusText: "思考中",
    rawCodeText: payload,
    contentRoot: true
  });
  assert.equal(
    harness.context.ChatGptComfyConnectorLocators.findAssistantContentRoot(finalMessage),
    finalMessage.children.at(-1));

  const result = await harness.waitForRuntimeMessage((message) =>
    message.type === "ASSISTANT_RESPONSE_RESULT" && message.status === "received");
  assert.equal(result.payload.includes("思考中"), false);
  assert.equal(result.payload.includes("より詳細な画像を生成しています"), false);
  assert.equal(result.payload.includes(payload), true);

  // A later DOM update to the same assistant turn must not emit a second
  // response after the watcher has completed.
  finalMessage.appendChild(new FakeElement(harness.document, "p", { textContent: "追加の表示更新" }));
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(harness.messages.filter((message) => message.type === "ASSISTANT_RESPONSE_RESULT").length, 1);
});

test("Content Script reports an explicit timeout when no post-anchor assistant response appears", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  assert.equal((await harness.send(handoff)).status, "sent");
  assert.equal((await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  })).status, "watching");
  const result = await harness.waitForRuntimeMessage((message) => message.type === "ASSISTANT_RESPONSE_RESULT");
  assert.equal(result.status, "error");
  assert.equal(result.errorCode, "assistant_response_not_found");
  assert.equal(result.stage, "assistant_message_not_found");
});

test("Content Script records visibility and the final watcher state when response waiting times out", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  assert.equal((await harness.send(handoff)).status, "sent");
  assert.equal((await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: handoff.requestId,
    sessionId: handoff.sessionId,
    handoffId: handoff.handoffId,
    boundaryId: handoff.boundaryId,
    protocol: handoff.protocol
  })).status, "watching");

  harness.document.visibilityState = "hidden";
  harness.document.hidden = true;
  harness.document.wasDiscarded = true;
  harness.document.dispatchEvent(new FakeEvent("visibilitychange"));
  const result = await harness.waitForRuntimeMessage((message) => message.type === "ASSISTANT_RESPONSE_RESULT");
  assert.equal(result.status, "error");

  const lifecycleEntries = harness.diagnostics
    .map(([, fields]) => fields)
    .filter((fields) => fields && typeof fields === "object");
  const visibility = lifecycleEntries.find((fields) => fields.stage === "document_visibility_changed");
  assert.equal(visibility.document_visibility_state, "hidden");
  assert.equal(visibility.document_hidden, true);
  assert.equal(visibility.document_was_discarded, true);
  assert.equal(visibility.content_script_alive, true);
  assert.equal(visibility.watcher_state, "armed");
  assert.equal(visibility.request_id, handoff.requestId);
  const finalState = lifecycleEntries.find((fields) =>
    fields.stage === "assistant_message_not_found" && fields.watcher_state === "idle");
  assert.equal(finalState.assistant_state, "not_detected");
});

const mediaBegin = {
  type: "REVIEW_MEDIA_ATTACH_BEGIN",
  requestId: "media-request-fixture",
  sessionId: "session-fixture",
  iteration: 2,
  mediaId: "media-fixture",
  fileName: "MiniMax_H3_00015_.mp4",
  mimeType: "video/mp4",
  size: 3
};

test("Content Script builds a File from bounded chunks and verifies the ChatGPT attachment", async () => {
  const harness = await createHarness({ fileInput: true, attachmentVerification: true });
  const begin = await harness.send(mediaBegin);
  assert.equal(begin.status, "receiving");

  const chunk = await harness.send({
    type: "REVIEW_MEDIA_ATTACH_CHUNK",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    offset: 0,
    chunk: "AQID"
  });
  assert.equal(chunk.status, "receiving");

  const end = await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  });
  assert.deepEqual({ ...end }, {
    request_id: mediaBegin.requestId,
    session_id: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    media_id: mediaBegin.mediaId,
    status: "attached",
    stage: "attachment_verified"
  });
  assert.equal(harness.document.fileInput.files.length, 1);
  assert.equal(harness.document.fileInput.files[0].name, mediaBegin.fileName);
  assert.equal(harness.document.fileInput.files[0].type, mediaBegin.mimeType);
  assert.equal(harness.document.fileInput.files[0].size, mediaBegin.size);
});

test("Content Script waits for the Review Send control after video processing", async () => {
  const harness = await createHarness({ sendButton: "ready", sendButtonReadyAfterMs: 80 });
  assert.equal((await harness.send(mediaBegin)).status, "receiving");
  await harness.send({
    type: "REVIEW_MEDIA_ATTACH_CHUNK",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    offset: 0,
    chunk: "AQID"
  });
  assert.equal((await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  })).status, "attached");

  const review = {
    ...handoff,
    requestId: "review-request-fixture",
    handoffId: "review-handoff-fixture",
    boundaryId: "review-boundary-fixture",
    review: true,
    expectedAttachment: {
      mediaId: mediaBegin.mediaId,
      fileName: mediaBegin.fileName,
      iteration: mediaBegin.iteration
    },
    payload: "## Review Handoff\nProtocol: comfy-connector/1\nhandoff_id: review-handoff-fixture\nboundary_id: review-boundary-fixture\n"
  };
  const result = await harness.send(review);
  assert.equal(result.status, "sent");
  assert.equal(result.stage, "user_message_correlated");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.plusMenuOpened, false);
});

test("Content Script arms a Review response watcher with the Review identity and anchor", async () => {
  const harness = await createHarness({ sendButton: "ready", fileInput: true, attachmentVerification: true });
  assert.equal((await harness.send(handoff)).status, "sent");

  assert.equal((await harness.send(mediaBegin)).status, "receiving");
  await harness.send({
    type: "REVIEW_MEDIA_ATTACH_CHUNK",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    offset: 0,
    chunk: "AQID"
  });
  assert.equal((await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  })).status, "attached");

  const review = {
    ...handoff,
    requestId: "review-request-watcher-fixture",
    handoffId: "review-handoff-watcher-fixture",
    boundaryId: "review-boundary-watcher-fixture",
    review: true,
    expectedAttachment: {
      mediaId: mediaBegin.mediaId,
      fileName: mediaBegin.fileName,
      iteration: mediaBegin.iteration
    },
    payload: "## Review Handoff\nProtocol: comfy-connector/1\nhandoff_id: review-handoff-watcher-fixture\nboundary_id: review-boundary-watcher-fixture\n"
  };
  const watching = await harness.send({
    type: "WATCH_ASSISTANT_RESPONSE",
    requestId: review.requestId,
    sessionId: review.sessionId,
    handoffId: review.handoffId,
    boundaryId: review.boundaryId,
    protocol: review.protocol,
    targetTabId: 42,
    prepare: true,
    review: true
  });
  assert.equal(watching.status, "watching");
  assert.equal((await harness.send(review)).status, "sent");

  const command = JSON.stringify({
    protocol: "comfy-connector/1",
    action: "complete",
    handoff_id: review.handoffId,
    session_id: review.sessionId,
    reason: "approved"
  });
  const finalMessage = harness.document.appendAssistantCodeMessage({
    codeText: command,
    language: "connector-command",
    classLanguage: null
  });
  // ChatGPT can leave its page-level Stop control visible for unrelated work.
  // The enabled action on this exact assistant turn is the stronger completion
  // signal and must allow the Review response to be emitted.
  harness.document.addStopButton();
  finalMessage.appendChild(new FakeButton(harness.document, {
    "data-testid": "copy-turn",
    "aria-label": "Copy"
  }));
  const result = await harness.waitForRuntimeMessage((message) =>
    message.type === "ASSISTANT_RESPONSE_RESULT" && message.status === "received");

  assert.equal(result.requestId, review.requestId);
  assert.equal(result.sessionId, review.sessionId);
  assert.equal(result.handoffId, review.handoffId);
  assert.equal(result.boundaryId, review.boundaryId);
  assert.equal(result.payload.includes(review.handoffId), true);
  assert.equal(result.payload.includes(handoff.handoffId), false);
});

test("Content Script uses only a semantic attachment control before returning a missing-input error", async () => {
  const harness = await createHarness({ fileInput: false });
  const result = await harness.send(mediaBegin);
  assert.equal(result.error_code, "attachment_control_not_found");
  assert.equal(result.stage, "attachment_control_found");
  // Opening a specifically identified attachment menu is only a discovery
  // step; no file is accepted until the real file input is found and verified.
  assert.equal(harness.document.plusMenuOpened, true);
});

test("Content Script does not report attached when ChatGPT exposes no attachment indicator", async () => {
  const harness = await createHarness({ attachmentVerification: false });
  assert.equal((await harness.send(mediaBegin)).status, "receiving");
  assert.equal((await harness.send({
    type: "REVIEW_MEDIA_ATTACH_CHUNK",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    offset: 0,
    chunk: "AQID"
  })).status, "receiving");
  const result = await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  });
  assert.equal(result.error_code, "attachment_verification_failed");
  assert.equal(result.stage, "attachment_control_found");
});

test("Content Script keeps waiting while the attachment indicator is uploading", async () => {
  const harness = await createHarness({ attachmentUploading: true });
  assert.equal((await harness.send(mediaBegin)).status, "receiving");
  await harness.send({
    type: "REVIEW_MEDIA_ATTACH_CHUNK",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    offset: 0,
    chunk: "AQID"
  });
  const result = await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  });
  assert.equal(result.error_code, "attachment_timeout");
  assert.equal(result.stage, "attachment_uploading");
});

test("Content Script rejects an incomplete media transfer before touching the file input", async () => {
  const harness = await createHarness();
  assert.equal((await harness.send(mediaBegin)).status, "receiving");
  const result = await harness.send({
    type: "REVIEW_MEDIA_ATTACH_END",
    requestId: mediaBegin.requestId,
    sessionId: mediaBegin.sessionId,
    iteration: mediaBegin.iteration,
    mediaId: mediaBegin.mediaId,
    fileName: mediaBegin.fileName,
    mimeType: mediaBegin.mimeType,
    size: mediaBegin.size
  });
  assert.equal(result.error_code, "attachment_upload_failed");
  assert.equal(harness.document.fileInput.files.length, 0);
});
