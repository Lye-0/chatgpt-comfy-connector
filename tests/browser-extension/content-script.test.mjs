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
    this._textContent = attributes.textContent || "";
    this.listeners = new Map();
  }

  get innerText() { return this._textContent; }
  set innerText(value) { this._textContent = String(value); }
  get textContent() { return this._textContent; }
  set textContent(value) { this._textContent = String(value); }

  getAttribute(name) { return this.attributes.get(name) ?? null; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
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
    if (selector.includes("textarea")) {
      return this.children.find((child) => child.tagName === "TEXTAREA") || null;
    }
    if (selector.includes("contenteditable")) {
      return this.children.find((child) => child.isContentEditable) || null;
    }
    return null;
  }

  getClientRects() { return [{}]; }
  focus() { this.ownerDocument.activeElement = this; }
  select() { this.ownerDocument.activeElement = this; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatchEvent(event) {
    if (event.type === "paste" && this.ownerDocument.contentEditableInsert === "paste") {
      this.textContent = event.clipboardData?.getData("text/plain") || "";
    }
    this.listeners.get(event.type)?.(event);
    return true;
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
  constructor() { this.values = new Map(); }
  setData(type, value) { this.values.set(type, String(value)); }
  getData(type) { return this.values.get(type) || ""; }
}

class FakeClipboardEvent extends FakeEvent {
  constructor(type, init = {}) {
    super(type);
    this.clipboardData = init.clipboardData;
  }
}

class FakeDocument {
  constructor({ composer = "textarea", sendButton = "ready", plusLabel = "写真やファイルを追加", contentEditableInsert = "exec-command", url = "https://chatgpt.com/c/fixture" } = {}) {
    this.activeElement = null;
    this.composers = [];
    this.sendButtons = [];
    this.buttons = [];
    this.userMessages = [];
    this.plusMenuOpened = false;
    this.sendClicked = false;
    this.contentEditableInsert = contentEditableInsert;
    this.defaultView = { getComputedStyle: () => ({ display: "block", visibility: "visible" }) };
    this.location = { href: url };
    this.body = new FakeElement(this, "body");
    const composerForm = new FakeElement(this, "form");
    this.body.appendChild(composerForm);

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
        "aria-label": "メッセージを入力"
      });
      composerForm.appendChild(contentEditable);
      this.composers.push(contentEditable);
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
  }

  appendUserMessage(payload) {
    const message = new FakeElement(this, "div", {
      "data-message-author-role": "user"
    });
    message.textContent = payload;
    this.body.appendChild(message);
    this.userMessages.push(message);
  }

  querySelectorAll(selector) {
    if (selector.includes("textarea")) return this.composers.filter((element) => element.tagName === "TEXTAREA");
    if (selector.includes("contenteditable") || selector.includes("role=\"textbox\"")) {
      return this.composers.filter((element) => element.isContentEditable);
    }
    if (selector.includes("data-message-author-role")
      || selector.includes("user-message")
      || selector.includes("conversation-turn-user")) return this.userMessages;
    if (selector.includes("button") || selector.includes("role=\"button\"")) return this.buttons;
    return [];
  }

  createRange() {
    return { selectNodeContents() {} };
  }

  getSelection() {
    return { removeAllRanges() {}, addRange() {} };
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
  const context = createContext({
    console,
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
        sendMessage: async () => ({ ok: true })
      }
    }
  });
  new Script(locatorSource).runInContext(context);
  // Keep the production wait long enough for a real ChatGPT render, while
  // keeping the negative fixture fast and deterministic.
  const fixtureContentSource = contentSource.replace(
    "const sendAcceptanceTimeoutMs = 8000;",
    "const sendAcceptanceTimeoutMs = 50;"
  );
  new Script(fixtureContentSource).runInContext(context);
  return {
    document,
    async send(message) {
      let response;
      const listener = runtimeListeners.find((candidate) => candidate(message, { id: "fixture-extension" }, (value) => { response = value; }) === true);
      assert.ok(listener, "Content Script handler should accept the message");
      while (!response) await new Promise((resolve) => setTimeout(resolve, 0));
      return response;
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

test("Content Script fills a textarea with React-visible input and confirms send", async () => {
  const harness = await createHarness({ composer: "textarea", sendButton: "ready" });
  const result = await harness.send(handoff);
  assert.deepEqual({ ...result }, {
    request_id: handoff.requestId,
    handoff_id: handoff.handoffId,
    status: "sent",
    stage: "user_message_correlated"
  });
  assert.equal(harness.document.composers[0].value, "");
  assert.equal(harness.document.plusMenuOpened, false, "the attachment/plus button must never be clicked");
  assert.equal(harness.document.sendClicked, true);
  assert.equal(harness.document.userMessages.length, 1);
  assert.equal(harness.document.userMessages[0].textContent, handoff.payload);
});

test("Content Script also supports a contenteditable composer", async () => {
  const harness = await createHarness({ composer: "contenteditable", sendButton: "ready" });
  const result = await harness.send(handoff);
  assert.equal(result.status, "sent");
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
