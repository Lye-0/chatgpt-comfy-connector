import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Script, createContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const locatorSource = await readFile(join(repositoryRoot, "browser-extension", "chatgpt-locators.js"), "utf8");

class FakeAnchor {
  constructor(document, href, text, attributes = {}) {
    this.ownerDocument = document;
    this.tagName = "A";
    this.attributes = new Map([["href", href], ...Object.entries(attributes)]);
    this._textContent = text;
    this.parentElement = null;
    this.children = [];
    this.hidden = false;
    this.isConnected = true;
  }

  get textContent() { return this._textContent; }
  get innerText() { return this._textContent; }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getClientRects() { return [{}]; }
  querySelectorAll() { return []; }
}

class FakeDocument {
  constructor(href, title = "ChatGPT") {
    this.location = { href };
    this.title = title;
    this.anchors = [];
  }

  appendAnchor(anchor) {
    this.anchors.push(anchor);
    return anchor;
  }

  querySelectorAll(selector) {
    return selector === "a[href]" ? this.anchors : [];
  }
}

class FakeMetadataNode {
  constructor(document, tagName, text = "", attributes = {}) {
    this.ownerDocument = document;
    this.tagName = tagName.toUpperCase();
    this.attributes = new Map(Object.entries(attributes));
    this._textContent = text;
    this.children = [];
    this.parentElement = null;
    this.hidden = false;
    this.isConnected = true;
  }

  get textContent() { return this._textContent + this.children.map((child) => child.textContent).join(""); }
  get innerText() { return this._textContent + this.children.map((child) => child.innerText).join(""); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  getClientRects() { return [{}]; }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  contains(candidate) {
    if (candidate === this) return true;
    return this.children.some((child) => child === candidate || child.contains?.(candidate));
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
    if (selector.includes("scrollport")) {
      return descendants.filter((element) => element.getAttribute("class")?.includes("scrollport"));
    }
    if (selector.includes("data-marquee-text")) {
      return descendants.filter((element) => element.getAttribute("data-marquee-text") !== null);
    }
    if (selector === "a[href]") return descendants.filter((element) => element.tagName === "A" && element.getAttribute("href"));
    if (selector === "[href]") return descendants.filter((element) => element.getAttribute("href") !== null);
    if (selector === "button") return descendants.filter((element) => element.tagName === "BUTTON");
    if (selector.includes('role="link"')) return descendants.filter((element) => element.getAttribute("role") === "link");
    if (selector.includes('role="button"')) return descendants.filter((element) => element.getAttribute("role") === "button");
    if (selector.includes('role="listitem"')) return descendants.filter((element) => element.getAttribute("role") === "listitem");
    if (selector.includes("data-sidebar-item")) return descendants.filter((element) => element.getAttribute("data-sidebar-item") === "true");
    if (selector.includes("data-conversation-id") || selector.includes('data-conversation]') || selector.includes('data-conversation-key')) {
      return descendants.filter((element) => element.getAttribute("data-conversation-id") !== null
        || element.getAttribute("data-conversation-id-value") !== null
        || element.getAttribute("data-conversation") !== null
        || element.getAttribute("data-conversation-key") !== null);
    }
    if (selector.includes("data-thread-id") || selector.includes('data-thread]') || selector.includes('data-thread-key')) {
      return descendants.filter((element) => element.getAttribute("data-thread-id") !== null
        || element.getAttribute("data-thread") !== null
        || element.getAttribute("data-thread-key") !== null);
    }
    if (selector.includes("data-chat-id") || selector.includes('data-chat]') || selector.includes('data-chat-key')) {
      return descendants.filter((element) => element.getAttribute("data-chat-id") !== null
        || element.getAttribute("data-chat-id-value") !== null
        || element.getAttribute("data-chat") !== null
        || element.getAttribute("data-chat-key") !== null);
    }
    if (selector.includes('data-testid*="conversation"') || selector.includes('data-testid*="chat"')
      || selector.includes('data-testid*="thread"')) {
      return descendants.filter((element) => /(?:conversation|chat|thread)/i.test(element.getAttribute("data-testid") || ""));
    }
    if (selector.includes('data-item-type="conversation"') || selector.includes('data-item-type="chat"')
      || selector.includes('data-item-type="thread"')) {
      return descendants.filter((element) => /^(?:conversation|chat|thread)$/i.test(element.getAttribute("data-item-type") || ""));
    }
    if (selector.includes('data-entity-type="conversation"') || selector.includes('data-entity-type="chat"')
      || selector.includes('data-entity-type="thread"')) {
      return descendants.filter((element) => /^(?:conversation|chat|thread)$/i.test(element.getAttribute("data-entity-type") || ""));
    }
    if (selector === "[data-id]") return descendants.filter((element) => element.getAttribute("data-id") !== null);
    if (selector === "[data-item-id]") return descendants.filter((element) => element.getAttribute("data-item-id") !== null);
    if (selector === "[data-entity-id]") return descendants.filter((element) => element.getAttribute("data-entity-id") !== null);
    if (selector === "[data-uuid]") return descendants.filter((element) => element.getAttribute("data-uuid") !== null);
    if (selector.includes("data-project-chat-list") || selector.includes("data-chat-list")) {
      return descendants.filter((element) => element.getAttribute("data-project-chat-list") !== null
        || element.getAttribute("data-chat-list") !== null);
    }
    if (selector === "ul" || selector === "ol") {
      return descendants.filter((element) => element.tagName === "UL" || element.tagName === "OL");
    }
    return [];
  }
}

class FakeSidebar extends FakeMetadataNode {
  constructor(document, projectNames, conversationNodes, projectAnchor, expandedProjectName = null, projectIds = []) {
    super(document, "NAV");
    this.projectRows = projectNames.map((name, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": name === expandedProjectName ? "true" : "false"
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", name, { "data-marquee-text": "true" }));
      const projectId = projectIds[index];
      if (projectId) {
        row.appendChild(new FakeMetadataNode(document, "A", name, {
          href: `/g/${projectId}/project`
        }));
      }
      return row;
    });
    this.conversationNodes = conversationNodes;
    this.projectAnchor = projectAnchor;
    this.expanded = false;
    this.scrollHistory = [];
    let currentScrollTop = 24;
    Object.defineProperty(this, "scrollTop", {
      configurable: true,
      get: () => currentScrollTop,
      set: (value) => {
        currentScrollTop = Number(value) || 0;
        this.scrollHistory.push(currentScrollTop);
      }
    });
    this.clientHeight = 100;
    this.scrollHeight = 300;
    this.itemWindow = 2;
    this.moreButton = new FakeMetadataNode(document, "BUTTON", "さらに表示", { role: "button" });
    this.moreButton.click = () => {
      this.expanded = true;
      this.scrollHeight = 500;
    };
  }

  get currentProjectRows() {
    const start = this.expanded ? Math.floor(this.scrollTop / this.clientHeight) : 0;
    return this.projectRows.slice(start, start + this.itemWindow);
  }

  querySelectorAll(selector) {
    if (selector.includes("data-sidebar-item")) return this.currentProjectRows;
    if (selector === "a[href]") {
      return [
        this.projectAnchor,
        ...this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector)),
        ...this.conversationNodes
      ].filter(Boolean);
    }
    if (selector === "button") return this.expanded ? [] : [this.moreButton];
    if (selector.includes('role="button"')) return [...this.currentProjectRows, ...(this.expanded ? [] : [this.moreButton])];
    if (selector.includes("data-marquee-text")) return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    return [];
  }
}

class BottomMoreSidebar extends FakeMetadataNode {
  constructor(document, projectCount) {
    super(document, "NAV");
    this.projectRows = Array.from({ length: projectCount }, (_, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false"
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", `Project ${index}`, {
        "data-marquee-text": "true"
      }));
      row.appendChild(new FakeMetadataNode(document, "A", `Project ${index}`, {
        href: `/g/g-p-bottom-${index}/project`
      }));
      return row;
    });
    this.expanded = false;
    this.clientHeight = 100;
    this.scrollHeight = 300;
    this.scrollHistory = [];
    let currentScrollTop = 0;
    Object.defineProperty(this, "scrollTop", {
      configurable: true,
      get: () => currentScrollTop,
      set: (value) => {
        currentScrollTop = Number(value) || 0;
        this.scrollHistory.push(currentScrollTop);
      }
    });
    this.moreButton = new FakeMetadataNode(document, "BUTTON", "さらに表示", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-controls": "project-list"
    });
    this.moreButton.click = () => {
      this.expanded = true;
      this.scrollHeight = 600;
    };
  }

  get currentProjectRows() {
    const start = Math.min(
      Math.max(0, this.projectRows.length - 2),
      Math.floor(this.scrollTop / 100) * 2);
    return this.projectRows.slice(start, start + 2);
  }

  get moreVisible() {
    return !this.expanded && this.scrollTop >= this.scrollHeight - this.clientHeight;
  }

  querySelectorAll(selector) {
    if (selector.includes("data-sidebar-item")) {
      return [...this.currentProjectRows, ...(this.moreVisible ? [this.moreButton] : [])];
    }
    if (selector === "button") return this.moreVisible ? [this.moreButton] : [];
    if (selector.includes('role="button"')) {
      return [...this.currentProjectRows, ...(this.moreVisible ? [this.moreButton] : [])];
    }
    if (selector.includes("data-marquee-text")) {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "a[href]") {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    return [];
  }
}

class FirstPageNestedMoreSidebar extends FakeMetadataNode {
  constructor(document, projectCount = 28, pageSize = 20) {
    super(document, "NAV");
    this.pageSize = pageSize;
    this.expanded = false;
    this.attributes.set("aria-label", "チャット履歴");
    this.clientHeight = 400;
    this.scrollHeight = 400;
    this.projectRows = Array.from({ length: projectCount }, (_, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false",
        "aria-controls": `first-page-${index}`
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", `Project ${index}`, {
        "data-marquee-text": "true"
      }));
      row.appendChild(new FakeMetadataNode(document, "A", `Project ${index}`, {
        href: `/g/g-p-page-${index}/project`
      }));
      return row;
    });
    this.scrollport = new FakeMetadataNode(document, "DIV", "", {
      class: "overflow-y-auto",
      "data-radix-scroll-area-viewport": ""
    });
    this.scrollport.clientHeight = 200;
    this.scrollport.scrollHeight = 800;
    this.scrollport._scrollTop = 0;
    Object.defineProperty(this.scrollport, "scrollTop", {
      configurable: true,
      get: () => this.scrollport._scrollTop,
      set: (value) => { this.scrollport._scrollTop = Number(value) || 0; }
    });
    this.projectRows.forEach((row) => this.scrollport.appendChild(row));
    this.appendChild(this.scrollport);
    this.moreButton = new FakeMetadataNode(document, "BUTTON", "さらに表示", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-controls": "project-list"
    });
    this.moreButton.click = () => {
      this.expanded = true;
      this.scrollport.scrollHeight = 1600;
    };
  }

  get currentProjectRows() {
    return this.expanded ? this.projectRows : this.projectRows.slice(0, this.pageSize);
  }

  get moreVisible() {
    return !this.expanded
      && this.scrollport.scrollTop >= this.scrollport.scrollHeight - this.scrollport.clientHeight - 1;
  }

  querySelectorAll(selector) {
    if (selector.includes("data-radix-scroll-area-viewport")
      || selector.includes("overflow-y-auto")
      || selector.includes("scrollport")
      || selector.includes("data-sidebar-scroll-container")) {
      return [this.scrollport];
    }
    if (selector.includes("data-sidebar-item")) {
      return [...this.currentProjectRows, ...(this.moreVisible ? [this.moreButton] : [])];
    }
    if (selector === "button") return this.moreVisible ? [this.moreButton] : [];
    if (selector.includes('role="button"')) {
      return [...this.currentProjectRows, ...(this.moreVisible ? [this.moreButton] : [])];
    }
    if (selector.includes("data-marquee-text")) {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "a[href]") {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    return [];
  }
}

class NestedScrollableSidebar extends FakeMetadataNode {
  constructor(document, projectNames) {
    super(document, "NAV");
    this.projectRows = projectNames.map((name, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false"
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", name, { "data-marquee-text": "true" }));
      row.appendChild(new FakeMetadataNode(document, "A", name, {
        href: `/g/g-p-${index}/project`
      }));
      return row;
    });
    this.scrollport = new FakeMetadataNode(document, "DIV", "", { class: "scrollport" });
    this.scrollport._scrollTop = 0;
    this.scrollport.clientHeight = 100;
    this.scrollport.scrollHeight = 500;
    Object.defineProperty(this.scrollport, "scrollTop", {
      configurable: true,
      get: () => this.scrollport._scrollTop,
      set: (value) => { this.scrollport._scrollTop = Number(value) || 0; }
    });
    this.projectRows.forEach((row) => this.scrollport.appendChild(row));
    this.appendChild(this.scrollport);
  }

  get currentProjectRows() {
    const start = Math.min(
      Math.max(0, this.projectRows.length - 2),
      Math.floor(this.scrollport.scrollTop / 80));
    return this.projectRows.slice(start, start + 2);
  }

  querySelectorAll(selector) {
    if (selector.includes("scrollport") || selector.includes("data-sidebar-scroll-container")) {
      return [this.scrollport];
    }
    if (selector.includes("data-sidebar-item")) return this.currentProjectRows;
    if (selector.includes('role="button"')) return this.currentProjectRows;
    if (selector.includes("data-marquee-text")) {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "a[href]") {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    return [];
  }
}

class VirtualizedProjectSidebar extends FakeMetadataNode {
  constructor(document, projectNames, {
    itemWindow = 8,
    projectIds = [],
    stableRowIds = [],
    nestedScroll = false,
    emptyUntilScroll = false
  } = {}) {
    super(document, "NAV");
    this.itemWindow = itemWindow;
    this.expanded = true;
    this.nestedScroll = nestedScroll;
    this.emptyUntilScroll = emptyUntilScroll;
    this.projectNames = projectNames;
    this.projectIds = projectIds;
    this.stableRowIds = stableRowIds;
    this.generation = 0;
    this.projectRows = [];
    this.scrollHistory = [];
    this.attributes.set("aria-label", "チャット履歴");
    this.rebuildRows();
    this.scrollport = new FakeMetadataNode(document, "DIV", "", {
      class: "overflow-y-auto",
      "data-radix-scroll-area-viewport": ""
    });
    this.scrollport.clientHeight = 100;
    this.scrollport.scrollHeight = Math.max(400, projectNames.length * 100);
    this.scrollport._scrollTop = 0;
    Object.defineProperty(this.scrollport, "scrollTop", {
      configurable: true,
      get: () => this.scrollport._scrollTop,
      set: (value) => {
        this.scrollport._scrollTop = Number(value) || 0;
        this.scrollHistory.push(this.scrollport._scrollTop);
      }
    });
    this.appendChild(this.scrollport);
    let currentScrollTop = 0;
    Object.defineProperty(this, "scrollTop", {
      configurable: true,
      get: () => (this.nestedScroll ? this.scrollport.scrollTop : currentScrollTop),
      set: (value) => {
        if (this.nestedScroll) {
          this.scrollport.scrollTop = value;
          return;
        }
        currentScrollTop = Number(value) || 0;
        this.scrollHistory.push(currentScrollTop);
      }
    });
    if (this.nestedScroll) {
      this.clientHeight = 100;
      this.scrollHeight = 100;
    } else {
      this.clientHeight = 100;
      this.scrollHeight = Math.max(400, projectNames.length * 100);
    }
  }

  rebuildRows() {
    this.generation += 1;
    this.projectRows = this.projectNames.map((name, index) => {
      const attributes = {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false",
        "aria-controls": `virt-${this.generation}-${index}`
      };
      const stableRowId = this.stableRowIds[index];
      if (stableRowId) attributes["data-sidebar-item-id"] = stableRowId;
      const row = new FakeMetadataNode(this.ownerDocument, "DIV", "", attributes);
      row.appendChild(new FakeMetadataNode(this.ownerDocument, "SPAN", name, {
        "data-marquee-text": "true"
      }));
      const projectId = this.projectIds[index];
      if (projectId) {
        row.appendChild(new FakeMetadataNode(this.ownerDocument, "A", name, {
          href: `/g/${projectId}/project`
        }));
      }
      if (this.scrollport) this.scrollport.appendChild(row);
      return row;
    });
  }

  remount(projectIds = this.projectIds, projectNames = this.projectNames, stableRowIds = this.stableRowIds) {
    this.projectRows.forEach((row) => { row.isConnected = false; });
    this.projectIds = projectIds;
    this.projectNames = projectNames;
    this.stableRowIds = stableRowIds;
    this.scrollTop = 0;
    this.rebuildRows();
  }

  get scrollerTop() {
    return this.nestedScroll ? Number(this.scrollport.scrollTop) || 0 : Number(this.scrollTop) || 0;
  }

  get currentProjectRows() {
    if (this.emptyUntilScroll && this.scrollerTop === 0) return [];
    const maxStart = Math.max(0, this.projectRows.length - this.itemWindow);
    const start = Math.min(maxStart, Math.floor(this.scrollerTop / this.clientHeight));
    return this.projectRows.slice(start, start + this.itemWindow);
  }

  querySelectorAll(selector) {
    if (selector.includes("data-radix-scroll-area-viewport")
      || selector.includes("overflow-y-auto")
      || selector.includes("scrollport")
      || selector.includes("data-sidebar-scroll-container")) {
      return this.nestedScroll ? [this.scrollport] : [];
    }
    if (selector.includes("data-sidebar-item")) return this.currentProjectRows;
    if (selector === "a[href]") {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "button") return [];
    if (selector.includes('role="button"')) return this.currentProjectRows;
    if (selector.includes("data-marquee-text")) {
      return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    return [];
  }
}

class FakeMetadataDocument extends FakeMetadataNode {
  constructor(href, sidebar) {
    super(null, "DOCUMENT");
    this.ownerDocument = this;
    this.location = { href };
    this.title = "ChatGPT";
    this.sidebar = sidebar;
    this.elementsById = new Map();
  }

  registerElementById(element, id = element?.getAttribute?.("id")) {
    if (element && id) this.elementsById.set(id, element);
    return element;
  }

  getElementById(id) {
    return this.elementsById.get(id) || null;
  }

  querySelectorAll(selector) {
    if (selector.startsWith("nav[")) return [this.sidebar];
    if (selector === "a[href]") return this.sidebar.querySelectorAll(selector);
    return this.sidebar.querySelectorAll(selector);
  }
}

class FakeProjectDocument extends FakeMetadataNode {
  constructor(href, sidebar, content, title = "Project A | ChatGPT") {
    super(null, "DOCUMENT");
    this.ownerDocument = this;
    this.location = { href };
    this.title = title;
    this.sidebar = sidebar;
    this.content = content;
    this.appendChild(sidebar);
    this.appendChild(content);
  }

  querySelectorAll(selector) {
    if (selector.startsWith("nav[")) return [this.sidebar];
    if (selector === "main" || selector === '[role="main"]') return [this.content];
    return super.querySelectorAll(selector);
  }
}

class MultiSidebarDocument extends FakeMetadataNode {
  constructor(href, sidebars) {
    super(null, "DOCUMENT");
    this.ownerDocument = this;
    this.location = { href };
    this.title = "ChatGPT";
    this.sidebars = sidebars;
    sidebars.forEach((sidebar) => this.appendChild(sidebar));
  }

  querySelectorAll(selector) {
    if (selector.startsWith("nav[")
      || selector === "nav"
      || selector.includes('role="navigation"')
      || selector.includes("data-testid=\"sidebar\"")) {
      return this.sidebars.filter((sidebar) => {
        if (selector === "nav") return sidebar.tagName === "NAV";
        if (selector.includes('role="navigation"')) return sidebar.getAttribute("role") === "navigation";
        return sidebar.tagName === "NAV";
      });
    }
    return super.querySelectorAll(selector);
  }
}

class FakeMutationObserver {
  static instances = [];

  constructor(callback) {
    this.callback = callback;
    this.observing = false;
    FakeMutationObserver.instances.push(this);
  }

  observe(target, options) {
    this.target = target;
    this.options = options;
    this.observing = true;
  }

  disconnect() {
    this.observing = false;
  }

  emit(records = [{ type: "childList" }]) {
    if (this.observing) this.callback(records, this);
  }
}

function loadLocators(document, globals = {}) {
  const context = createContext({
    URL,
    Map,
    Set,
    String,
    Boolean,
    document,
    location: document.location,
    ...globals,
    globalThis: null,
    console
  });
  context.globalThis = context;
  new Script(locatorSource).runInContext(context);
  return context.ChatGptComfyConnectorLocators;
}

function anchor(document, href, text, attributes = {}) {
  return document.appendAnchor(new FakeAnchor(document, href, text, attributes));
}

test("conversation and project identities are extracted from ChatGPT URLs", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/c/current"));

  assert.equal(
    locators.conversationIdFromUrl("https://chatgpt.com/g/g-p-project-a/c/conversation-01"),
    "conversation-01");
  assert.equal(
    locators.projectIdFromUrl("https://chatgpt.com/g/g-p-project-a/c/conversation-01"),
    "g-p-project-a");
  assert.equal(
    locators.projectIdFromUrl("https://chatgpt.com/g/g-custom/c/conversation-01"),
    null);
  assert.equal(
    locators.projectIdFromUrl("https://chatgpt.com/g/g-p-project-a"),
    "g-p-project-a");
  assert.equal(
    locators.conversationIdFromUrl("https://example.invalid/c/not-chatgpt"),
    null);

  const stable = "g-p-6a623bd670d881918ce24d063b799b30";
  const slugged = `${stable}-chatgpt-comfy-connector-comfyui-x-chatgpt`;
  assert.equal(
    locators.projectIdFromUrl(`https://chatgpt.com/g/${stable}/project`),
    stable);
  assert.equal(
    locators.projectIdFromUrl(`https://chatgpt.com/g/${slugged}/c/chat1`),
    stable);
  assert.equal(
    locators.projectIdFromUrl(`https://chatgpt.com/g/${slugged}/project`),
    stable);
  assert.equal(locators.stableProjectIdFromValue(slugged), stable);
  assert.equal(locators.stableProjectIdFromValue("g-p-project-a"), "g-p-project-a");
  assert.equal(locators.projectIdFromUrl("https://chatgpt.com/c/chat1"), null);
});

test("sidebar metadata keeps same-title conversations distinct and classifies projectless chats", () => {
  const document = new FakeDocument("https://chatgpt.com/g/g-p-project-a/c/conversation-01");
  anchor(document, "/g/g-p-project-a/project", "Project A");
  anchor(document, "/g/g-p-project-b/project", "Project B");
  anchor(document, "/g/g-p-project-a/c/conversation-01", "同じChat", { "data-title": "同じChat" });
  // A duplicate rendered link must not duplicate the metadata entry.
  anchor(document, "/g/g-p-project-a/c/conversation-01", "同じChat (duplicate)", { "data-title": "同じChat" });
  anchor(document, "/g/g-p-project-b/c/conversation-02", "同じChat", { "data-title": "同じChat" });
  anchor(document, "/c/conversation-03", "Project外Chat", { "data-title": "Project外Chat" });

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, document.location.href);

  assert.deepEqual(Array.from(snapshot.projects, (item) => item.project_id), ["g-p-project-a", "g-p-project-b"]);
  assert.deepEqual(Array.from(snapshot.conversations, (item) => item.conversation_id), [
    "conversation-01",
    "conversation-02",
    "conversation-03"
  ]);
  assert.equal(snapshot.conversations[0].project_id, "g-p-project-a");
  assert.equal(snapshot.conversations[1].project_id, "g-p-project-b");
  assert.equal(snapshot.conversations[2].project_id, undefined);
  assert.equal(snapshot.current.conversation_id, "conversation-01");
  assert.equal(snapshot.current.project_id, "g-p-project-a");
  assert.equal(snapshot.current.project_title, "Project A");
});

test("current context follows SPA URL changes without requiring conversation body sync", () => {
  const document = new FakeDocument("https://chatgpt.com/c/conversation-old", "Old title | ChatGPT");
  anchor(document, "/c/conversation-old", "Old title", { "data-title": "Old title" });
  anchor(document, "/c/conversation-new", "New title", { "data-title": "New title" });
  const locators = loadLocators(document);

  const before = locators.getCurrentChatGptContext(document, document.location.href);
  document.location.href = "https://chatgpt.com/c/conversation-new";
  const after = locators.getCurrentChatGptContext(document, document.location.href);

  assert.equal(before.conversation_id, "conversation-old");
  assert.equal(before.title, "Old title");
  assert.equal(after.conversation_id, "conversation-new");
  assert.equal(after.title, "New title");
  assert.equal(after.url, "https://chatgpt.com/c/conversation-new");
});

test("missing sidebar DOM safely falls back to current URL and bounded document title", () => {
  const document = new FakeDocument("https://chatgpt.com/g/g-p-project-a/c/conversation-99", "Conversation 99 | ChatGPT");
  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, document.location.href);

  assert.equal(snapshot.projects.length, 0);
  assert.equal(snapshot.conversations.length, 0);
  assert.deepEqual({ ...snapshot.current }, {
    conversation_id: "conversation-99",
    title: "Conversation 99",
    url: "https://chatgpt.com/g/g-p-project-a/c/conversation-99",
    project_id: "g-p-project-a"
  });
});

test("Collector viewport reports the desktop sidebar breakpoint and readiness separately", () => {
  const document = new FakeMetadataDocument("https://chatgpt.com/", null);
  const sidebar = new FakeSidebar(document, ["Project A"], [], null, null, ["g-p-viewport"]);
  document.sidebar = sidebar;
  document.defaultView = {
    innerWidth: 769,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; }
  };
  const locators = loadLocators(document);

  const narrow = locators.getChatGptCollectorViewport(document);
  assert.equal(narrow.content_inner_width, 769);
  assert.equal(narrow.sidebar_expected_visible, false);
  assert.equal(narrow.desktop_layout, false);
  assert.equal(narrow.sidebar_ready, false);
  assert.deepEqual(sidebar.scrollHistory, []);

  document.defaultView.innerWidth = 770;
  const desktop = locators.getChatGptCollectorViewport(document);
  assert.equal(desktop.content_inner_width, 770);
  assert.equal(desktop.sidebar_expected_visible, true);
  assert.equal(desktop.desktop_layout, true);
  assert.equal(desktop.sidebar_container_exists, true);
  assert.equal(desktop.project_section_exists, true);
  assert.equal(desktop.project_row_locator_ready, true);
  assert.equal(desktop.sidebar_ready, true);
  assert.deepEqual(sidebar.scrollHistory, []);
});

test("Root Sidebar hydration waits for DOM mutation quiet before completing", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  // Project rows are intentionally absent: root hydration only proves that
  // the Sidebar shell is mounted; Project discovery owns the later scan.
  const sidebar = new FakeSidebar(document, [], [], null, null, []);
  document.sidebar = sidebar;
  document.readyState = "complete";
  document.documentElement = document;
  document.defaultView = {
    innerWidth: 1024,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; },
    setTimeout,
    clearTimeout,
    MutationObserver: FakeMutationObserver
  };
  FakeMutationObserver.instances.length = 0;
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });

  const hydrationPromise = locators.waitForChatGptRootSidebarHydrationAsync(
    document,
    rootHref,
    { timeoutMs: 300, quietMs: 30, pollMs: 5 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const observer = FakeMutationObserver.instances.at(-1);
  assert.ok(observer);
  observer.emit([{ type: "childList" }]);

  const result = await hydrationPromise;
  assert.equal(result.status, "ok");
  assert.equal(result.root_hydration_completed, true);
  assert.equal(result.root_hydration_timeout, false);
  assert.equal(result.root_url_verified, true);
  assert.equal(result.document_ready_state, "complete");
  assert.equal(result.sidebar_root_present, true);
  assert.equal(result.sidebar_scroll_container_present, true);
  assert.equal(result.sidebar_shell_present, true);
  assert.equal(result.sidebar_sections_stable, true);
  assert.equal(result.mutation_count, 1);
  assert.ok(result.mutation_quiet_ms >= 30);
  assert.ok(result.hydration_wait_ms >= 30);
  assert.deepEqual(sidebar.scrollHistory, []);
});

test("sidebar discovery uses the first known history sidebar", () => {
  const document = new MultiSidebarDocument("https://chatgpt.com/", []);
  const expandedSidebar = new FakeMetadataNode(document, "NAV", "", {
    role: "navigation",
    class: "sidebar current-project"
  });
  const expandedProject = new FakeMetadataNode(document, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true",
    "aria-expanded": "true"
  });
  expandedProject.appendChild(new FakeMetadataNode(document, "SPAN", "ChatGPT-Comfy-Connector", {
    "data-marquee-text": "true"
  }));
  expandedProject.appendChild(new FakeMetadataNode(document, "A", "追加実装", {
    href: "/c/connector-chat"
  }));
  expandedSidebar.appendChild(expandedProject);

  const fullSidebar = new FakeMetadataNode(document, "NAV", "", {
    role: "navigation"
  });
  for (const [index, name] of ["Others", "Chess", "Git", "Python", "Web Atlas"].entries()) {
    const row = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "false"
    });
    row.appendChild(new FakeMetadataNode(document, "SPAN", name, {
      "data-marquee-text": "true"
    }));
    row.appendChild(new FakeMetadataNode(document, "A", name, {
      href: `/g/g-p-full-${index}/project`
    }));
    fullSidebar.appendChild(row);
  }
  fullSidebar.scrollTop = 0;
  fullSidebar.clientHeight = 100;
  fullSidebar.scrollHeight = 500;
  expandedSidebar.scrollTop = 0;
  expandedSidebar.clientHeight = 100;
  expandedSidebar.scrollHeight = 100;
  document.sidebars = [expandedSidebar, fullSidebar];

  const locators = loadLocators(document);
  assert.equal(locators.findSidebarRoot(document), expandedSidebar);
  assert.deepEqual(
    Array.from(locators.findProjectRows(document), (row) => locators.visibleTitleFromElement(row)),
    ["ChatGPT-Comfy-Connector"]);
});

test("Project row lookup keeps the selected outer Sidebar when it contains an expanded inner shell", () => {
  const document = new MultiSidebarDocument("https://chatgpt.com/", []);
  const outerSidebar = new FakeMetadataNode(document, "NAV", "", {
    role: "navigation",
    class: "sidebar desktop"
  });
  const innerSidebar = new FakeMetadataNode(document, "NAV", "", {
    role: "navigation",
    class: "sidebar current-project"
  });
  const currentProject = new FakeMetadataNode(document, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true",
    "aria-expanded": "true"
  });
  currentProject.appendChild(new FakeMetadataNode(document, "SPAN", "Current Project", {
    "data-marquee-text": "true"
  }));
  currentProject.appendChild(new FakeMetadataNode(document, "A", "Current Project", {
    href: "/g/g-p-current/project"
  }));
  currentProject.appendChild(new FakeMetadataNode(document, "A", "Current chat", {
    href: "/c/current-chat"
  }));
  innerSidebar.appendChild(currentProject);
  outerSidebar.appendChild(innerSidebar);
  for (const [index, name] of ["Project A", "Project B", "Project C"].entries()) {
    const row = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "false"
    });
    row.appendChild(new FakeMetadataNode(document, "SPAN", name, {
      "data-marquee-text": "true"
    }));
    row.appendChild(new FakeMetadataNode(document, "A", name, {
      href: `/g/g-p-outer-${index}/project`
    }));
    outerSidebar.appendChild(row);
  }
  document.sidebars = [outerSidebar, innerSidebar];

  const locators = loadLocators(document);
  assert.equal(locators.findSidebarRoot(document), outerSidebar);
  assert.deepEqual(
    Array.from(locators.findProjectRows(document), (row) => locators.visibleTitleFromElement(row)),
    ["Current Project", "Project A", "Project B", "Project C"]);
});

test("root Project discovery does not select a deeper Chat-only scrollport", () => {
  const document = new FakeMetadataDocument("https://chatgpt.com/", null);
  const sidebar = new FakeMetadataNode(document, "NAV");
  sidebar.scrollTop = 0;
  sidebar.clientHeight = 100;
  sidebar.scrollHeight = 500;
  const projectRow = new FakeMetadataNode(document, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true",
    "aria-expanded": "true"
  });
  projectRow.appendChild(new FakeMetadataNode(document, "SPAN", "Current Project", {
    "data-marquee-text": "true"
  }));
  const chatScrollport = new FakeMetadataNode(document, "DIV", "", { class: "scrollport" });
  chatScrollport.scrollTop = 0;
  chatScrollport.clientHeight = 100;
  chatScrollport.scrollHeight = 400;
  const chat = new FakeMetadataNode(document, "A", "Chat", { href: "/c/current-chat" });
  chatScrollport.appendChild(chat);
  projectRow.appendChild(chatScrollport);
  sidebar.appendChild(projectRow);
  document.sidebar = sidebar;

  const locators = loadLocators(document);
  assert.equal(locators.findSidebarScrollContainer(document), sidebar);
});

test("sidebar metadata uses visible title nodes and excludes aria descriptions", () => {
  const document = new FakeDocument("https://chatgpt.com/c/current");
  const anchorNode = new FakeMetadataNode(document, "A", "", {
    href: "/c/conversation-visible",
    "aria-label": "2週目以降の自走、プロジェクト ChatGPT-Comfy-Connector 内のチャット"
  });
  anchorNode.appendChild(new FakeMetadataNode(document, "SPAN", "2週目以降の自走", { "data-marquee-text": "true" }));
  document.anchors.push(anchorNode);
  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, document.location.href);

  assert.equal(snapshot.conversations[0].title, "2週目以降の自走");
  assert.equal(locators.stripMetadataDescriptionSuffix("OpenAIアップデート情報(Tasks)、ピン留めされた会話"), "OpenAIアップデート情報(Tasks)");
});

test("async sidebar discovery expands more, scans virtualized rows, deduplicates, and restores scroll", async () => {
  const href = "https://chatgpt.com/g/g-p-alpha/c/conversation-alpha";
  const document = new FakeMetadataDocument(href, null);
  const projectAnchor = new FakeMetadataNode(document, "A", "Alpha", {
    href: "/g/g-p-alpha/project"
  });
  const conversation = new FakeMetadataNode(document, "A", "", {
    href: "/g/g-p-alpha/c/conversation-alpha",
    "data-project-title": "Alpha",
    "aria-label": "Alpha chat、プロジェクト Alpha 内のチャット"
  });
  conversation.appendChild(new FakeMetadataNode(document, "SPAN", "Alpha chat", { "data-marquee-text": "true" }));
  const duplicate = new FakeMetadataNode(document, "A", "", {
    href: "/g/g-p-alpha/c/conversation-alpha",
    "data-project-title": "Alpha"
  });
  duplicate.appendChild(new FakeMetadataNode(document, "SPAN", "Alpha chat", { "data-marquee-text": "true" }));
  const sidebar = new FakeSidebar(
    document,
    ["Alpha", "Beta", "Git Lines", "Web Atlas", "Others", "Chess"],
    [conversation, duplicate],
    projectAnchor,
    null,
    ["g-p-alpha", "g-p-beta", "g-p-git-lines", "g-p-web-atlas", "g-p-others", "g-p-chess"]);
  document.sidebar = sidebar;

  const locators = loadLocators(document);
  const initialScrollTop = sidebar.scrollTop;
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 12,
    maxMoreClicks: 2
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.title), [
    "Alpha",
    "Beta",
    "Git Lines",
    "Web Atlas",
    "Others",
    "Chess"
  ]);
  assert.equal(snapshot.projects[0].project_id, "g-p-alpha");
  assert.equal(snapshot.projects.filter((project) => project.title === "Alpha").length, 1);
  assert.equal(snapshot.conversations.length, 1);
  assert.equal(snapshot.conversations[0].title, "Alpha chat");
  assert.equal(sidebar.expanded, true);
  assert.equal(snapshot.sidebar_scroll_direction, "down");
  assert.equal(snapshot.sidebar_restore_count, 1);
  const discoveryScrollWrites = sidebar.scrollHistory.slice(0, -1);
  assert.ok(discoveryScrollWrites.length > 0);
  assert.deepEqual(discoveryScrollWrites, [...discoveryScrollWrites].sort((left, right) => left - right));
  assert.equal(sidebar.scrollHistory.at(-1), initialScrollTop);
  assert.equal(sidebar.scrollTop, initialScrollTop);
});

test("sidebar discovery selects the real nested scroll container and reports completion telemetry", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new NestedScrollableSidebar(document, [
    "Project 0",
    "Project 1",
    "Project 2",
    "Project 3",
    "Project 4",
    "Project 5"
  ]);
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  assert.equal(locators.findSidebarScrollContainer(document), sidebar.scrollport);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 12,
    initialSettleMs: 0
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), [
    "g-p-0",
    "g-p-1",
    "g-p-2",
    "g-p-3",
    "g-p-4",
    "g-p-5"
  ]);
  assert.equal(snapshot.sidebar_scroll_container_found, true);
  assert.equal(snapshot.sidebar_can_scroll, true);
  assert.equal(snapshot.sidebar_at_bottom, true);
  assert.equal(snapshot.sidebar_scroll_complete, true);
  assert.equal(snapshot.project_section_found, true);
  assert.equal(snapshot.discovered_project_count, 6);
  assert.equal(snapshot.sidebar_scroll_direction, "down");
  assert.equal(snapshot.sidebar_restore_count, 1);
  assert.equal(sidebar.scrollport.scrollTop, 0);
});

test("async sidebar discovery expands a bottom Project disclosure and continues past the initial window", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new BottomMoreSidebar(document, 12);
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 16,
    maxMoreClicks: 4,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 12);
  assert.deepEqual(
    Array.from(snapshot.projects, (project) => project.project_id),
    Array.from({ length: 12 }, (_, index) => `g-p-bottom-${index}`));
  assert.equal(snapshot.project_more_control_found, true);
  assert.equal(snapshot.project_more_control_click_count, 1);
  assert.equal(snapshot.project_virtualized_candidate, true);
  assert.equal(snapshot.sidebar_scroll_complete, true);
  assert.equal(sidebar.scrollTop, 0);
  const scanWrites = sidebar.scrollHistory.slice(0, -1);
  assert.ok(scanWrites.length > 0);
  assert.deepEqual(scanWrites, [...scanWrites].sort((left, right) => left - right));
});

test("async sidebar discovery keeps all 28 Projects when the first page only shows 20 and さらに表示 is below the nested fold", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new FirstPageNestedMoreSidebar(document, 28, 20);
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    maxMoreClicks: 4,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovered_project_count, 28);
  assert.deepEqual(
    Array.from(snapshot.projects, (project) => project.project_id),
    Array.from({ length: 28 }, (_, index) => `g-p-page-${index}`));
  assert.equal(snapshot.project_more_control_click_count, 1);
  assert.equal(snapshot.sidebar_scroll_complete, true);
});

test("async sidebar discovery keeps all 36 Projects when the first page only shows 20 and さらに表示 is below the nested fold", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new FirstPageNestedMoreSidebar(document, 36, 20);
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    maxMoreClicks: 4,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 36);
  assert.equal(snapshot.discovered_project_count, 36);
  assert.deepEqual(
    Array.from(snapshot.projects, (project) => project.project_id),
    Array.from({ length: 36 }, (_, index) => `g-p-page-${index}`));
});

test("async sidebar discovery ranks the Project-bearing Sidebar over an empty first nav", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const decoy = new FakeMetadataNode(document, "NAV");
  decoy.attributes.set("aria-label", "チャット履歴");
  const names = Array.from({ length: 28 }, (_, index) => `Project ${index}`);
  const real = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    projectIds: Array.from({ length: 28 }, (_, index) => `g-p-rank-${index}`)
  });
  const multi = new MultiSidebarDocument(href, [decoy, real]);
  const locators = loadLocators(multi);

  const snapshot = await locators.collectChatGptContextAsync(multi, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovered_project_count, 28);
});

test("async sidebar discovery keeps 28 virtualized Projects when only 20 rows are mounted at a time", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    projectIds: Array.from({ length: 28 }, (_, index) => `g-p-virt-disc-${index}`)
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovered_project_count, 28);
});

test("async sidebar discovery does not collapse same-title Projects", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Shared ${index % 14}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    projectIds: Array.from({ length: 28 }, (_, index) => `g-p-dup-${index}`)
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);

  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });

  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.projects.filter((project) => project.title === "Shared 0").length, 2);
});

test("metadata-only Project discovery never clicks generic Sidebar rows", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeMetadataNode(document, "NAV");
  const genericRows = ["スケジュール", "プラグイン", "さらに表示", "同名Project"].map((name) => {
    const row = new FakeMetadataNode(document, "DIV", name, { role: "button" });
    row.click = () => {
      clickCount += 1;
      document.location.href = "https://chatgpt.com/schedule";
    };
    sidebar.appendChild(row);
    return row;
  });
  sidebar.querySelectorAll = (selector) => {
    if (selector === "button") return [];
    if (selector.includes('role="button"') && !selector.includes("data-sidebar-item")) return genericRows;
    return [];
  };
  document.sidebar = sidebar;
  let clickCount = 0;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, rootHref, {
    maxScrolls: 4,
    maxMoreClicks: 1,
    initialSettleMs: 0
  });

  assert.equal(clickCount, 0);
  assert.equal(snapshot.projects.length, 0);
  assert.equal(document.location.href, rootHref);
  assert.equal(snapshot.project_discovery_source, "existing_project_section_metadata");
});

test("metadata-only Project discovery follows Project anchors without SPA probing", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const projectIds = ["g-p-first", "g-p-second", "g-p-third"];
  const sidebar = new FakeSidebar(
    document,
    ["同名Project", "同名Project", "別Project"],
    [],
    null,
    null,
    projectIds);
  document.sidebar = sidebar;
  let clickCount = 0;
  sidebar.projectRows.forEach((row) => {
    row.click = () => { clickCount += 1; };
  });

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, rootHref, {
    maxScrolls: 8,
    maxMoreClicks: 1,
    initialSettleMs: 0
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), projectIds);
  assert.equal(snapshot.projects.every((project) => project.url.endsWith("/project")), true);
  assert.equal(clickCount, 0);
  assert.equal(document.location.href, rootHref);
});

test("Project identity resolution reads row, descendant, and ancestor metadata without navigation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeMetadataNode(document, "NAV");
  const ownRow = new FakeMetadataNode(document, "DIV", "Own identity", {
    role: "button",
    "data-sidebar-item": "true",
    "data-project-id": "g-p-own",
    "data-project-url": "/g/g-p-own/project"
  });
  const ownTitle = new FakeMetadataNode(document, "SPAN", "Own identity", {
    "data-marquee-text": "true"
  });
  ownRow.appendChild(ownTitle);

  const descendantRow = new FakeMetadataNode(document, "DIV", "Descendant identity", {
    role: "button",
    "data-sidebar-item": "true"
  });
  descendantRow.appendChild(new FakeMetadataNode(document, "SPAN", "Descendant identity", {
    "data-marquee-text": "true"
  }));
  descendantRow.appendChild(new FakeMetadataNode(document, "A", "Descendant identity", {
    href: "/g/g-p-descendant/project"
  }));

  const ancestorAnchor = new FakeMetadataNode(document, "A", "Ancestor identity", {
    href: "/g/g-p-ancestor/project"
  });
  const ancestorRow = new FakeMetadataNode(document, "DIV", "Ancestor identity", {
    role: "button",
    "data-sidebar-item": "true"
  });
  ancestorRow.appendChild(new FakeMetadataNode(document, "SPAN", "Ancestor identity", {
    "data-marquee-text": "true"
  }));
  ancestorAnchor.appendChild(ancestorRow);
  sidebar.appendChild(ownRow);
  sidebar.appendChild(descendantRow);
  sidebar.appendChild(ancestorAnchor);
  document.sidebar = sidebar;
  let clickCount = 0;
  for (const row of [ownRow, descendantRow, ancestorRow]) row.click = () => { clickCount += 1; };

  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [
      { project_index: 0, discovery_index: 0, title: "Own identity" },
      { project_index: 1, discovery_index: 1, title: "Descendant identity" },
      { project_index: 2, discovery_index: 2, title: "Ancestor identity" }
    ],
    { identityMode: "dom" });

  assert.deepEqual(result.projects.map((project) => project.project_id), [
    "g-p-own",
    "g-p-descendant",
    "g-p-ancestor"
  ]);
  assert.equal(result.projects.every((project) => project.resolution_method === "dom"), true);
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 3);
  assert.equal(clickCount, 0);
  assert.equal(document.location.href, rootHref);
});

test("Project identity navigation fallback clicks only the confirmed row and verifies the Project URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Other", "Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  let clickedIndex = -1;
  sidebar.projectRows.forEach((row, index) => {
    row.click = () => {
      clickedIndex = index;
      document.location.href = "https://chatgpt.com/g/g-p-target/project";
    };
  });

  const locators = loadLocators(document);
  const navigationTelemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 1, discovery_index: 1, title: "Target Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 500,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(clickedIndex, 1);
  assert.equal(result.projects[0].project_id, "g-p-target");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-target/project");
  assert.equal(result.projects[0].resolution_method, "navigation");
  assert.equal(result.projects[0].navigation_target_verified, true);
  assert.equal(result.project_url_pattern_valid, true);
  assert.equal(result.project_id_url_match, true);
  assert.equal(result.unresolved_count, 0);
  const relocation = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.deepEqual({
    candidate_count: relocation.candidate_count,
    row_found: relocation.row_found,
    match_method: relocation.match_method,
    section_verified: relocation.section_verified,
    stale_element_reused: relocation.stale_element_reused
  }, {
    candidate_count: 2,
    row_found: true,
    match_method: "discovery_fingerprint",
    section_verified: true,
    stale_element_reused: false
  });
  const clickEvents = navigationTelemetry.filter((event) =>
    event.stage === "collector_project_identity_click");
  assert.equal(clickEvents.length, 3);
  assert.equal(clickEvents[0].click_attempted, false);
  assert.equal(clickEvents[1].click_attempted, true);
  assert.equal(clickEvents[1].click_dispatched, false);
  assert.equal(clickEvents[2].click_dispatched, true);
  assert.equal(clickEvents[2].click_target_is_project_row, true);
  assert.equal(clickEvents[2].click_target_section_verified, true);
  assert.ok(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"
    && event.navigation_wait_started === true));
  assert.ok(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"
    && event.url_changed === true
    && event.navigation_detected === true));
  assert.deepEqual(Object.fromEntries(Object.entries(navigationTelemetry.at(-1))), {
    stage: "collector_project_identity_navigation_result",
    project_index: 1,
    exit_reason: "resolved",
    internal_reason: "none",
    navigation_failure_reason: "none",
    navigation_generation_match: false,
    navigation_started_for_project: true,
    navigation_completed_for_project: true,
    navigation_target_verified_for_project: true,
    navigation_owned_by_current_project: false,
    current_url_used_as_identity: false,
    navigation_target_verified: true,
    project_url_pattern_valid: true,
    project_id_extracted: true,
    project_id_url_match: true,
    resolution_success: true,
    stale_navigation_result_rejected: false,
    unresolved_reason: "none"
  });
});

test("Project identity never adopts a prior Project URL without owned navigation evidence", async () => {
  const staleProjectUrl = "https://chatgpt.com/g/g-p-prior/project";
  const document = new FakeMetadataDocument(staleProjectUrl, null);
  document.sidebar = null;
  const locators = loadLocators(document);
  const telemetry = [];

  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    staleProjectUrl,
    [{ project_index: 21, discovery_index: 21, title: "Next Project" }],
    {
      identityMode: "navigation",
      requestId: "identity-isolation-fixture",
      refreshGeneration: 4,
      navigationGeneration: "refresh-4-identity-20",
      navigationStartedForProject: true,
      navigationOwnerProjectIndex: 20,
      navigationOwnerRequestId: "identity-isolation-fixture",
      navigationOwnerRefreshGeneration: 4,
      navigationTimeoutMs: 250,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.unresolved_count, 1);
  const evidence = telemetry.find((event) =>
    event.stage === "collector_project_identity_navigation_evidence");
  assert.equal(evidence.navigation_generation_match, false);
  assert.equal(evidence.navigation_owned_by_current_project, false);
  assert.equal(evidence.current_url_used_as_identity, false);
  assert.equal(evidence.stale_navigation_result_rejected, true);
});

test("Project-scoped conversation href reuses the historical metadata identity path without navigation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  // ChatGPT can render the Project row as a DIV and expose the only stable
  // Project carrier as a href-bearing descendant rather than an <a>.
  row.attributes.set("class", "group/menu-item rounded");
  row.appendChild(new FakeMetadataNode(document, "DIV", "", {
    href: "/g/g-p-from-chat/c/conversation-01"
  }));
  let rowClickCount = 0;
  row.click = () => { rowClickCount += 1; };

  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Target Project" }],
    { identityMode: "navigation" });

  assert.equal(result.projects[0].project_id, "g-p-from-chat");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-from-chat/project");
  assert.equal(result.projects[0].resolution_method, "dom");
  assert.equal(result.projects[0].navigation_target_verified, false);
  assert.equal(result.non_navigation_resolved_count, 1);
  assert.equal(result.navigation_resolved_count, 0);
  assert.equal(result.unresolved_count, 0);
  assert.equal(rowClickCount, 0);
});

test("Project disclosure row resolves identity from its aria-controls region without Project navigation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Disclosure Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "project-chat-list-0");
  const controlledRegion = new FakeMetadataNode(document, "DIV", "", {
    id: "project-chat-list-0"
  });
  document.registerElementById(controlledRegion);
  const projectChat = new FakeMetadataNode(document, "DIV", "Disclosure chat", {
    href: "/g/g-p-disclosure/c/disclosure-chat"
  });
  let clickCount = 0;
  row.click = () => {
    clickCount += 1;
    row.attributes.set("aria-expanded", "true");
    controlledRegion.appendChild(projectChat);
  };

  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Disclosure Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 500,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(clickCount, 1);
  assert.equal(document.location.href, rootHref);
  assert.equal(result.projects[0].project_id, "g-p-disclosure");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-disclosure/project");
  assert.equal(result.projects[0].resolution_method, "dom");
  assert.equal(result.navigation_resolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 1);
  assert.equal(result.unresolved_count, 0);
  const structure = telemetry.find((event) =>
    event.stage === "collector_project_identity_disclosure_structure");
  assert.equal(structure.row_is_disclosure_control, true);
  assert.equal(structure.aria_expanded_before, "false");
  assert.equal(structure.aria_expanded_after, "true");
  assert.equal(structure.controlled_region_found, true);
  assert.equal(structure.controlled_region_project_chat_link_count, 1);
  assert.equal(structure.disclosure_state_changed, true);
  const click = telemetry.find((event) =>
    event.stage === "collector_project_identity_disclosure_click");
  assert.equal(click.click_attempted, true);
  assert.equal(click.click_dispatched, true);
  assert.equal(click.click_method, "disclosure.click");
  assert.equal(click.click_target_is_project_row, true);
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"), false);
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(source.identity_source, "child_chat_url");
  assert.equal(source.empty_project_candidate, false);
  assert.equal(source.resolution_success, true);
  assert.equal(source.child_chat_count, 1);
});

test("Project disclosure without a stable controlled-region identity does not fall through to URL navigation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Empty Disclosure Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-project-chat-list");
  const controlledRegion = new FakeMetadataNode(document, "DIV", "", {
    id: "empty-project-chat-list"
  });
  document.registerElementById(controlledRegion);
  let clickCount = 0;
  row.click = () => {
    clickCount += 1;
    row.attributes.set("aria-expanded", "true");
  };

  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Empty Disclosure Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(clickCount, 1);
  assert.equal(document.location.href, rootHref);
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "project_disclosure_identity_not_found");
  assert.equal(result.unresolved_count, 1);
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"), false);
  const disclosureResult = telemetry.find((event) =>
    event.stage === "collector_project_identity_disclosure_result");
  assert.equal(disclosureResult.resolution_success, false);
  assert.equal(disclosureResult.unresolved_reason, "project_disclosure_identity_not_found");
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(source.empty_project_candidate, true);
  assert.equal(source.sidebar_child_identity_unavailable, true);
  assert.equal(source.navigation_fallback_attempted, false);
  assert.equal(source.resolution_success, false);
  assert.equal(source.identity_source, "none");
});

test("Empty Project disclosure resolves identity from an exclusive-shell Project home URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-network-list");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "empty-network-list"
  }));
  const wrapper = new FakeMetadataNode(document, "DIV", "", { class: "group/project-item" });
  const projectHome = new FakeMetadataNode(document, "A", "", {
    href: "/g/g-p-network-empty/project"
  });
  wrapper.appendChild(row);
  wrapper.appendChild(projectHome);
  let rowClickCount = 0;
  row.click = () => { rowClickCount += 1; };

  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "ネットワーク" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, "g-p-network-empty");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-network-empty/project");
  assert.equal(result.projects[0].resolution_method, "dom");
  assert.equal(result.unresolved_count, 0);
  assert.equal(rowClickCount, 0);
  assert.equal(document.location.href, rootHref);
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(source.identity_source, "nested_url");
  assert.equal(source.nested_project_url_found, true);
  assert.equal(source.resolution_success, true);
  assert.equal(source.navigation_fallback_attempted, false);
});

test("Empty Project disclosure resolves identity from a row-local g-p-* data attribute", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-attr-list");
  row.attributes.set("data-sidebar-item-id", "g-p-attr-empty");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "empty-attr-list"
  }));
  let clickCount = 0;
  row.click = () => { clickCount += 1; };

  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "ネットワーク" }],
    { identityMode: "navigation", navigationTimeoutMs: 250 });

  assert.equal(result.projects[0].project_id, "g-p-attr-empty");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-attr-empty/project");
  assert.equal(result.unresolved_count, 0);
  assert.equal(clickCount, 0);
});

test("Empty Project disclosure navigates a nested role=link instead of re-clicking the disclosure", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-nav-list");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "empty-nav-list"
  }));
  const projectLink = new FakeMetadataNode(document, "DIV", "ネットワーク", { role: "link" });
  let rowClickCount = 0;
  let linkClickCount = 0;
  row.click = () => {
    rowClickCount += 1;
    row.attributes.set("aria-expanded", "true");
  };
  projectLink.click = () => {
    linkClickCount += 1;
    document.location.href = "https://chatgpt.com/g/g-p-nav-empty/project";
  };
  row.appendChild(projectLink);

  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "ネットワーク" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 400,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, "g-p-nav-empty");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-nav-empty/project");
  assert.equal(result.projects[0].resolution_method, "navigation");
  assert.equal(result.unresolved_count, 0);
  assert.equal(rowClickCount, 1);
  assert.equal(linkClickCount, 1);
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(source.empty_project_candidate, true);
  assert.equal(source.sidebar_child_identity_unavailable, true);
  assert.equal(source.navigation_fallback_attempted, true);
  assert.equal(source.navigation_fallback_success, true);
  assert.equal(source.identity_source, "navigation_url");
});

test("Multiple empty Projects resolve to distinct Stable IDs from their own shells", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク", "ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const ids = ["g-p-empty-one", "g-p-empty-two"];
  sidebar.projectRows.forEach((row, index) => {
    row.attributes.set("aria-controls", `empty-multi-${index}`);
    document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
      id: `empty-multi-${index}`
    }));
    const wrapper = new FakeMetadataNode(document, "DIV", "", { class: "group/project-item" });
    wrapper.appendChild(row);
    wrapper.appendChild(new FakeMetadataNode(document, "A", "", {
      href: `/g/${ids[index]}/project`
    }));
  });

  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  const catalog = discovered.projects.map((project, index) => ({
    ...project,
    project_index: index,
    discovery_index: index
  }));
  const first = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[0]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });
  const second = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[1]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });

  assert.equal(first.projects[0].project_id, "g-p-empty-one");
  assert.equal(second.projects[0].project_id, "g-p-empty-two");
  assert.notEqual(first.projects[0].project_id, second.projects[0].project_id);
});

test("Empty Project identity ignores nearby other-Project chats, Projectless chats, and custom GPT routes", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク", "Other Project"], [], null, null, []);
  document.sidebar = sidebar;
  const emptyRow = sidebar.projectRows[0];
  const otherRow = sidebar.projectRows[1];
  emptyRow.attributes.set("aria-controls", "empty-ignore-list");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "empty-ignore-list"
  }));
  const wrapper = new FakeMetadataNode(document, "DIV", "", { class: "group/project-item" });
  wrapper.appendChild(emptyRow);
  wrapper.appendChild(new FakeMetadataNode(document, "A", "Projectless", {
    href: "/c/projectless-nearby"
  }));
  wrapper.appendChild(new FakeMetadataNode(document, "A", "Custom GPT", {
    href: "/g/g-custom/c/custom-nearby"
  }));
  otherRow.appendChild(new FakeMetadataNode(document, "A", "Other chat", {
    href: "/g/g-p-other-nearby/c/other-chat"
  }));
  emptyRow.click = () => { emptyRow.attributes.set("aria-expanded", "true"); };

  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "ネットワーク" }],
    { identityMode: "navigation", navigationTimeoutMs: 250 });

  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "project_disclosure_identity_not_found");
  assert.equal(result.unresolved_count, 1);
});

test("Empty Project identity then collects zero chats on a verified Project page with a tiny unrelated scrollport", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-collect-list");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "empty-collect-list"
  }));
  const wrapper = new FakeMetadataNode(document, "DIV", "", { class: "group/project-item" });
  wrapper.appendChild(row);
  wrapper.appendChild(new FakeMetadataNode(document, "A", "", {
    href: "/g/g-p-empty-collect/project"
  }));

  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "ネットワーク" }],
    { identityMode: "navigation", navigationTimeoutMs: 250 });
  assert.equal(identity.projects[0].project_id, "g-p-empty-collect");

  const href = identity.projects[0].url;
  const pageSidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  content.appendChild(new FakeMetadataNode(null, "DIV", "プロジェクトのチャットはありません"));
  const tinyUnrelatedScrollport = new FakeMetadataNode(null, "DIV", "", {
    class: "header-scrollport"
  });
  tinyUnrelatedScrollport.scrollTop = 0;
  tinyUnrelatedScrollport.clientHeight = 52;
  tinyUnrelatedScrollport.scrollHeight = 56;
  content.appendChild(tinyUnrelatedScrollport);
  const projectDocument = new FakeProjectDocument(href, pageSidebar, content, "ネットワーク | ChatGPT");
  for (const node of [pageSidebar, content, tinyUnrelatedScrollport]) {
    node.ownerDocument = projectDocument;
  }

  const snapshot = await locators.collectChatGptProjectContextAsync(
    projectDocument,
    href,
    "g-p-empty-collect",
    { timeoutMs: 5000 });
  assert.equal(snapshot.conversations.length, 0);
  assert.equal(snapshot.project_page_ready, true);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.scroll_complete, true);
});

test("Project discovery promotes a row's Project conversation href to stable metadata", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  sidebar.projectRows[0].appendChild(new FakeMetadataNode(document, "DIV", "", {
    href: "/g/g-p-from-discovery/c/conversation-02"
  }));

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, rootHref);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].project_id, "g-p-from-discovery");
  assert.equal(snapshot.projects[0].url, "https://chatgpt.com/g/g-p-from-discovery/project");
});

test("Project discovery reads a controlled disclosure region without clicking the Project row", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Controlled Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "controlled-project-list");
  const controlledRegion = new FakeMetadataNode(document, "DIV", "", {
    id: "controlled-project-list"
  });
  controlledRegion.appendChild(new FakeMetadataNode(document, "DIV", "Controlled chat", {
    href: "/g/g-p-controlled/c/controlled-chat"
  }));
  document.registerElementById(controlledRegion);
  let clickCount = 0;
  row.click = () => { clickCount += 1; };

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, rootHref);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].project_id, "g-p-controlled");
  assert.equal(snapshot.projects[0].url, "https://chatgpt.com/g/g-p-controlled/project");
  assert.equal(clickCount, 0);
  assert.equal(document.location.href, rootHref);
});

test("same-title Project disclosure rows remain distinct and are merged by stable Project ID", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["同じProject", "同じProject"], [], null, null, []);
  document.sidebar = sidebar;
  const projectRows = sidebar.projectRows;
  const regions = [
    new FakeMetadataNode(document, "DIV", "", { id: "same-title-project-a" }),
    new FakeMetadataNode(document, "DIV", "", { id: "same-title-project-b" })
  ];
  const projectIds = ["g-p-same-title-a", "g-p-same-title-b"];
  projectRows.forEach((row, index) => {
    row.attributes.set("aria-controls", regions[index].getAttribute("id"));
    document.registerElementById(regions[index]);
    regions[index].appendChild(new FakeMetadataNode(document, "DIV", "", {
      href: `/g/${projectIds[index]}/c/conversation-${index}`
    }));
  });

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, rootHref);

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), projectIds);
  assert.equal(snapshot.projects.length, 2);
  assert.notEqual(snapshot.projects[0].discovery_key, snapshot.projects[1].discovery_key);
});

test("Project identity relocation tolerates regenerated disclosure tokens only for a unique titled row", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Regenerated disclosure"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "old-disclosure-region");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "old-disclosure-region"
  }));
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  assert.equal(discovered.projects.length, 1);
  assert.equal(discovered.projects[0].project_id, undefined);
  assert.ok(discovered.projects[0].discovery_key);

  const regeneratedRegion = new FakeMetadataNode(document, "DIV", "", {
    id: "new-disclosure-region"
  });
  regeneratedRegion.appendChild(new FakeMetadataNode(document, "DIV", "", {
    href: "/g/g-p-regenerated/c/regenerated-chat"
  }));
  document.registerElementById(regeneratedRegion);
  row.attributes.set("aria-controls", "new-disclosure-region");
  let clickCount = 0;
  row.click = () => { clickCount += 1; };

  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    discovered.projects,
    { identityMode: "navigation" });

  assert.equal(result.projects[0].project_id, "g-p-regenerated");
  assert.equal(result.projects[0].url, "https://chatgpt.com/g/g-p-regenerated/project");
  assert.equal(result.projects[0].resolution_method, "dom");
  assert.equal(result.unresolved_count, 0);
  assert.equal(clickCount, 0);
});

test("Sidebar child Chat 0 does not mean the Project is empty; Project page collection still finds chats", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["ネットワーク"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "network-empty-sidebar-list");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "network-empty-sidebar-list"
  }));
  const projectLink = new FakeMetadataNode(document, "DIV", "ネットワーク", { role: "link" });
  row.click = () => { row.attributes.set("aria-expanded", "true"); };
  projectLink.click = () => {
    document.location.href = "https://chatgpt.com/g/g-p-network/project";
  };
  row.appendChild(projectLink);

  const locators = loadLocators(document);
  const telemetry = [];
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 20, discovery_index: 20, title: "ネットワーク", discovery_key: "stale-network-20" }],
    {
      identityMode: "navigation",
      identityCatalog: Array.from({ length: 28 }, (_, index) => ({
        project_index: index,
        discovery_index: index,
        title: index === 20 ? "ネットワーク" : `Project ${index}`,
        discovery_key: `stale-${index}`
      })),
      navigationTimeoutMs: 400,
      onTelemetry: (event) => telemetry.push(event)
    });

  assert.equal(identity.projects[0].project_id, "g-p-network");
  assert.equal(identity.unresolved_count, 0);
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(source.child_chat_count, 0);
  assert.equal(source.empty_project_candidate, true);
  assert.equal(source.sidebar_child_identity_unavailable, true);
  assert.equal(source.identity_source, "navigation_url");
  const consistency = telemetry.find((event) =>
    event.stage === "collector_project_identity_candidate_consistency");
  assert.equal(consistency.project_index, 20);
  assert.equal(consistency.stable_identity_candidate_count, 0);
  assert.equal(consistency.distinct_candidate_project_id_count, 0);
  assert.equal(consistency.identity_candidate_consistent, true);
  assert.equal(consistency.navigation_fallback_attempted, true);
  assert.equal(consistency.navigation_fallback_success, true);
  assert.equal(consistency.resolution_success, true);

  const href = "https://chatgpt.com/g/g-p-network/project";
  const projectSidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  for (const [slug, title] of [
    ["vpn", "VPN"],
    ["ssl", "SSLの理解"],
    ["dns", "DNSサーバの仕組み"]
  ]) {
    const chat = new FakeMetadataNode(null, "A", "", { href: `/g/g-p-network/c/${slug}` });
    chat.appendChild(new FakeMetadataNode(null, "SPAN", title, { "data-marquee-text": "true" }));
    content.appendChild(chat);
  }
  const projectDocument = new FakeProjectDocument(href, projectSidebar, content, "ネットワーク | ChatGPT");
  for (const node of [projectSidebar, content]) node.ownerDocument = projectDocument;
  const pageLocators = loadLocators(projectDocument);
  const snapshot = await pageLocators.collectChatGptProjectContextAsync(
    projectDocument,
    href,
    "g-p-network",
    { timeoutMs: 5000 });

  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id),
    ["vpn", "ssl", "dns"]);
  assert.equal(snapshot.conversations.length, 3);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Navigation identity continues after a remounted virtualized Sidebar regenerates row tokens", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => (
    index === 20 ? "ネットワーク" : `Project ${index}`));
  const projectIds = Array.from({ length: 28 }, (_, index) => `g-p-virt-${index}`);
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 8 });
  document.sidebar = sidebar;
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-fingerprint-${index}`
  }));
  const locators = loadLocators(document);
  const resolved = [];
  for (const projectIndex of [20, 21, 22, 23, 24, 25, 26, 27]) {
    document.location.href = rootHref;
    sidebar.remount(projectIds);
    const telemetry = [];
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document,
      rootHref,
      [catalog[projectIndex]],
      {
        identityMode: "navigation",
        identityCatalog: catalog,
        navigationTimeoutMs: 400,
        onTelemetry: (event) => telemetry.push(event)
      });
    const relocation = telemetry.filter((event) =>
      event.stage === "collector_project_identity_row_relocation").at(-1);
    assert.equal(result.projects[0].project_id, projectIds[projectIndex]);
    assert.equal(result.unresolved_count, 0);
    assert.equal(relocation.row_found, true);
    assert.equal(relocation.relocation_success, true);
    assert.equal(relocation.match_method, "unique_catalog_title");
    assert.equal(relocation.fingerprint_match, false);
    resolved.push(result.projects[0].project_id);
  }
  assert.deepEqual(resolved, [
    "g-p-virt-20",
    "g-p-virt-21",
    "g-p-virt-22",
    "g-p-virt-23",
    "g-p-virt-24",
    "g-p-virt-25",
    "g-p-virt-26",
    "g-p-virt-27"
  ]);
});

test("Duplicate Project titles stay unresolved after fingerprint regeneration", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["ネットワーク", "ネットワーク", "Other"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    projectIds: ["g-p-dup-a", "g-p-dup-b", "g-p-other"]
  });
  document.sidebar = sidebar;
  sidebar.remount();
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-dup-${index}`
  }));
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[0]],
    {
      identityMode: "navigation",
      identityCatalog: catalog,
      navigationTimeoutMs: 250
    });
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "ambiguous_project_row_match");
  assert.equal(result.unresolved_count, 1);
});

test("Same-title Projects rematch by discovery-time Stable ID after Sidebar remount", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["ネットワーク", "ネットワーク", "Other"];
  const projectIds = ["g-p-dup-a", "g-p-dup-b", "g-p-other"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    projectIds,
    stableRowIds: ["row-identity-a", "row-identity-b", "row-identity-other"]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  assert.equal(discovered.projects.length, 3);
  assert.deepEqual(
    Array.from(discovered.projects, (project) => project.project_id),
    projectIds);
  assert.notEqual(discovered.projects[0].discovery_key, discovered.projects[1].discovery_key);
  assert.ok(discovered.projects[0].stable_locator_key);
  assert.notEqual(discovered.projects[0].stable_locator_key, discovered.projects[1].stable_locator_key);

  sidebar.projectRows.forEach((row) => { row.isConnected = false; });
  sidebar.remount(projectIds);
  const catalog = discovered.projects.map((project, index) => ({
    ...project,
    project_index: index,
    discovery_index: index
  }));

  const first = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[0]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });
  const second = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[1]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });

  assert.equal(first.projects[0].project_id, "g-p-dup-a");
  assert.equal(second.projects[0].project_id, "g-p-dup-b");
  assert.equal(first.unresolved_count, 0);
  assert.equal(second.unresolved_count, 0);
});

test("Identity does not adopt the first same-title row by title or index", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["ネットワーク", "ネットワーク", "Other"];
  const projectIds = ["g-p-dup-a", "g-p-dup-b", "g-p-other"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 8, projectIds });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  sidebar.remount(projectIds);
  const catalog = discovered.projects.map((project, index) => ({
    ...project,
    project_index: index,
    discovery_index: index
  }));
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[1]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });
  assert.equal(result.projects[0].project_id, "g-p-dup-b");
  assert.notEqual(result.projects[0].project_id, "g-p-dup-a");
});

test("Reordered same-title Sidebar rows still bind by Stable ID", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["ネットワーク", "ネットワーク", "Other"];
  const projectIds = ["g-p-dup-a", "g-p-dup-b", "g-p-other"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 8, projectIds });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  sidebar.remount(
    ["g-p-dup-b", "g-p-dup-a", "g-p-other"],
    ["ネットワーク", "ネットワーク", "Other"]);
  const catalog = discovered.projects.map((project, index) => ({
    ...project,
    project_index: index,
    discovery_index: index
  }));
  const first = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[0]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });
  assert.equal(first.projects[0].project_id, "g-p-dup-a");
});

test("Same-title rows with only regenerated aria-controls stay unresolved", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["ネットワーク", "ネットワーク"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 8 });
  document.sidebar = sidebar;
  sidebar.projectRows.forEach((row, index) => {
    row.attributes.set("aria-controls", `old-region-${index}`);
  });
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  assert.equal(discovered.projects.length, 2);
  assert.equal(discovered.projects[0].project_id, undefined);
  sidebar.remount();
  const catalog = discovered.projects.map((project, index) => ({
    ...project,
    project_index: index,
    discovery_index: index
  }));
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[0]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 250 });
  assert.equal(result.projects[0].project_id, undefined);
  assert.ok(
    result.projects[0].unresolved_reason === "ambiguous_project_row_match"
    || result.projects[0].unresolved_reason === "project_row_fingerprint_mismatch");
});

test("Unchanged relocation candidate set stops extra Sidebar scroll retries", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => (
    index === 20 || index === 21 ? "ネットワーク" : `Project ${index}`));
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 28 });
  document.sidebar = sidebar;
  sidebar.clientHeight = 400;
  sidebar.scrollHeight = 400;
  sidebar.scrollport.clientHeight = 400;
  sidebar.scrollport.scrollHeight = 400;
  const locators = loadLocators(document);
  const telemetry = [];
  await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{
      project_index: 20,
      discovery_index: 20,
      title: "ネットワーク",
      discovery_key: "stale-fingerprint-20"
    }],
    {
      identityMode: "navigation",
      identityCatalog: names.map((title, index) => ({
        project_index: index,
        discovery_index: index,
        title,
        discovery_key: `stale-fingerprint-${index}`
      })),
      navigationTimeoutMs: 250,
      onTelemetry: (event) => telemetry.push(event)
    });
  const relocations = telemetry.filter((event) => event.stage === "collector_project_identity_row_relocation");
  assert.ok(relocations.length > 0);
  assert.ok(relocations.length <= 6);
  assert.ok((relocations.at(-1).scroll_attempts || 0) <= 2);
  const fingerprint = telemetry.find((event) => event.stage === "collector_project_identity_row_fingerprint");
  assert.ok(fingerprint);
  assert.equal(fingerprint.title_duplicate_count, 2);
  const candidates = telemetry.find((event) => event.stage === "collector_project_identity_relocation_candidates");
  assert.ok(candidates);
  assert.equal(candidates.selected_candidate_found, false);
});

test("36 unique Projects complete identity after Sidebar remount", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = Array.from({ length: 36 }, (_, index) => `Project ${index}`);
  const projectIds = Array.from({ length: 36 }, (_, index) => `g-p-virt-${index}`);
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 36 });
  document.sidebar = sidebar;
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-fingerprint-${index}`
  }));
  const locators = loadLocators(document);
  document.location.href = rootHref;
  sidebar.remount(projectIds);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    { identityMode: "dom", identityCatalog: catalog });
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.projects.length, 36);
  assert.deepEqual(
    Array.from(result.projects, (project) => project.project_id),
    projectIds);
});

test("Identity relocation does not adopt another visible Project when the target row is absent", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Other A", "Other B"], {
    itemWindow: 8,
    projectIds: ["g-p-other-a", "g-p-other-b"]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{
      project_index: 22,
      discovery_index: 22,
      title: "ネットワーク",
      discovery_key: "stale-missing-22"
    }],
    {
      identityMode: "navigation",
      identityCatalog: [
        { project_index: 22, discovery_index: 22, title: "ネットワーク", discovery_key: "stale-missing-22" },
        { project_index: 0, discovery_index: 0, title: "Other A", discovery_key: "stale-0" },
        { project_index: 1, discovery_index: 1, title: "Other B", discovery_key: "stale-1" }
      ],
      navigationTimeoutMs: 250
    });
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "project_row_not_visible");
  assert.equal(result.unresolved_count, 1);
});

test("Identity relocation scrolls a nested Project scrollport after a 0-row remount paint", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => (
    index === 22 ? "ネットワーク" : `Project ${index}`));
  const projectIds = Array.from({ length: 28 }, (_, index) => `g-p-nested-${index}`);
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    emptyUntilScroll: true
  });
  document.sidebar = sidebar;
  const staleRows = [...sidebar.projectRows];
  sidebar.remount(projectIds);
  assert.equal(staleRows.every((row) => row.isConnected === false), true);
  assert.equal(sidebar.currentProjectRows.length, 0);
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-nested-${index}`
  }));
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[22]],
    {
      identityMode: "navigation",
      identityCatalog: catalog,
      navigationTimeoutMs: 400,
      onTelemetry: (event) => telemetry.push(event)
    });
  const relocations = telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.equal(relocations[0].current_sidebar_candidate_count, 0);
  assert.equal(relocations[0].row_found, false);
  assert.ok(relocations.some((event) => event.scroll_attempts > 0));
  assert.ok(relocations.some((event) => event.relocation_phase === "sidebar_scroll_scan"
    || event.scroll_attempts > 0));
  const success = relocations.find((event) => event.relocation_success === true);
  assert.ok(success);
  assert.equal(success.match_method, "unique_catalog_title");
  assert.equal(success.catalog_title_unique, true);
  assert.equal(result.projects[0].project_id, "g-p-nested-22");
  assert.equal(result.unresolved_count, 0);
  assert.equal(sidebar.projectRows[22].isConnected, true);
  assert.equal(staleRows.includes(result.projects[0]), false);
});

test("Identity relocation clicks さらに表示 before scrolling to a later unique Project", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Project ${index}`);
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, names, [], null, null, names.map((_, index) => `g-p-more-${index}`));
  document.sidebar = sidebar;
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-more-${index}`
  }));
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[5]],
    {
      identityMode: "navigation",
      identityCatalog: catalog,
      navigationTimeoutMs: 400,
      onTelemetry: (event) => telemetry.push(event)
    });
  const relocations = telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.ok(relocations.some((event) => event.more_clicked === true || event.more_attempted === true));
  assert.equal(result.projects[0].project_id, "g-p-more-5");
  assert.equal(result.unresolved_count, 0);
});

test("Project identity resolution rejects Projectless and custom GPT conversation hrefs", async () => {
  for (const href of [
    "/c/projectless-conversation",
    "/g/g-custom/c/custom-gpt-conversation"
  ]) {
    const rootHref = "https://chatgpt.com/";
    const document = new FakeMetadataDocument(rootHref, null);
    const sidebar = new FakeSidebar(document, ["Not a Project identity"], [], null, null, []);
    document.sidebar = sidebar;
    sidebar.projectRows[0].appendChild(new FakeMetadataNode(document, "DIV", "", { href }));

    const locators = loadLocators(document);
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document,
      rootHref,
      [{ project_index: 0, discovery_index: 0, title: "Not a Project identity" }],
      { identityMode: "dom" });

    assert.equal(result.projects[0].project_id, undefined);
    assert.equal(result.projects[0].unresolved_reason, "missing_stable_identity");
    assert.equal(result.unresolved_count, 1);
  }
});

test("menu-like CSS class names on a Project row do not suppress its row fallback", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("class", "group/menu-item");
  row.attributes.set("data-testid", "project-menu-item");
  row.click = () => {};

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);

  assert.equal(target.target, row);
  assert.equal(target.targetType, "row");
  assert.equal(target.selectionReason, "row_fallback");
  assert.equal(target.structure.rowIsMenuControl, false);
  assert.equal(target.structure.rowMenuControlReason, "none");
});

test("Project identity fallback prefers a Project anchor and resolves its href without clicking", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  const menuButton = new FakeMetadataNode(document, "BUTTON", "", {
    "aria-label": "More options",
    "data-testid": "project-menu"
  });
  const projectAnchor = new FakeMetadataNode(document, "A", "Target Project", {
    href: "/g/g-p-target/project"
  });
  row.appendChild(menuButton);
  row.appendChild(projectAnchor);
  let rowClickCount = 0;
  let anchorClickCount = 0;
  row.click = () => { rowClickCount += 1; };
  projectAnchor.click = () => { anchorClickCount += 1; };

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);
  assert.equal(target.target, projectAnchor);
  assert.equal(target.candidateCount, 2);
  assert.equal(target.targetType, "anchor");
  assert.equal(target.targetHasHref, true);
  assert.equal(target.targetRole, "none");
  assert.equal(target.targetTag, "A");
  assert.equal(target.targetInsideProjectRow, true);
  assert.equal(target.targetIsMenuControl, false);
  assert.equal(target.targetIsOverflowControl, false);
  assert.equal(target.safeCandidateCount, 1);
  assert.equal(target.structure.rowTag, "DIV");
  assert.equal(target.structure.rowRole, "button");
  assert.equal(target.structure.directChildCount, 3);
  assert.equal(target.structure.descendantCount, 3);
  assert.equal(target.structure.descendantAnchorCount, 1);
  assert.equal(target.structure.descendantButtonCount, 1);
  assert.equal(target.structure.rowIsMenuControl, false);
  assert.equal(target.structure.rowMenuControlReason, "none");

  const navigationTelemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Target Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, "g-p-target");
  assert.equal(result.projects[0].resolution_method, "dom");
  assert.equal(rowClickCount, 0);
  assert.equal(anchorClickCount, 0);
  assert.equal(document.location.href, rootHref);
  const targetEvent = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_click_target");
  assert.deepEqual({
    interactive_candidate_count: targetEvent.interactive_candidate_count,
    selected_target_type: targetEvent.selected_target_type,
    selected_target_has_href: targetEvent.selected_target_has_href,
    selected_target_role: targetEvent.selected_target_role,
    selected_target_tag: targetEvent.selected_target_tag,
    selected_target_inside_project_row: targetEvent.selected_target_inside_project_row,
    selected_target_is_menu_control: targetEvent.selected_target_is_menu_control,
    selected_target_is_overflow_control: targetEvent.selected_target_is_overflow_control
  }, {
    interactive_candidate_count: 2,
    selected_target_type: "anchor",
    selected_target_has_href: true,
    selected_target_role: "none",
    selected_target_tag: "A",
    selected_target_inside_project_row: true,
    selected_target_is_menu_control: false,
    selected_target_is_overflow_control: false
  });
  assert.equal(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_click"
      && event.click_method === "dom_identity"), true);
});

test("Project row role=button alone is not treated as a menu control", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.click = () => {};

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);
  assert.equal(target.candidateCount, 0);
  assert.equal(target.safeCandidateCount, 0);
  assert.equal(target.target, row);
  assert.equal(target.targetType, "row");
  assert.equal(target.targetIsMenuControl, false);
  assert.equal(target.targetIsOverflowControl, false);
  assert.equal(target.selectionReason, "row_fallback");
  assert.equal(target.structure.rowIsMenuControl, false);
  assert.equal(target.structure.rowMenuControlReason, "none");
});

test("Project row menu control never becomes an unsafe row fallback", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-haspopup", "menu");
  let rowClickCount = 0;
  row.click = () => { rowClickCount += 1; };

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);
  assert.equal(target.candidateCount, 0);
  assert.equal(target.safeCandidateCount, 0);
  assert.equal(target.target, null);
  assert.equal(target.selectionReason, "no_safe_project_navigation_target");
  assert.equal(target.targetIsMenuControl, false);
  assert.equal(target.structure.rowIsMenuControl, true);
  assert.equal(target.structure.rowMenuControlReason, "aria_haspopup_menu");

  const navigationTelemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Target Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(rowClickCount, 0);
  assert.equal(result.projects[0].unresolved_reason, "no_safe_project_navigation_target");
  assert.equal(result.navigation_failure_reason, "no_safe_project_navigation_target");
  assert.equal(result.internal_reason, "project_row_is_menu_control");
  const structure = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_row_structure");
  assert.equal(structure.row_is_menu_control, true);
  assert.equal(structure.menu_control_reason, "aria_haspopup_menu");
  const targetEvent = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_click_target");
  assert.equal(targetEvent.interactive_candidate_count, 0);
  assert.equal(targetEvent.safe_candidate_count, 0);
  assert.equal(targetEvent.selected_target_type, "none");
  assert.equal(targetEvent.selection_reason, "no_safe_project_navigation_target");
  assert.equal(targetEvent.menu_control_reason, "aria_haspopup_menu");
  const failureEvent = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_navigation_result");
  assert.equal(failureEvent.exit_reason, "no_safe_project_navigation_target");
  assert.equal(failureEvent.internal_reason, "project_row_is_menu_control");
  assert.equal(failureEvent.navigation_failure_reason, "no_safe_project_navigation_target");
  assert.equal(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"), false);
});

test("Project identity fallback selects a non-menu role link inside the confirmed row", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  const menuButton = new FakeMetadataNode(document, "BUTTON", "", {
    "aria-label": "Project menu",
    "aria-haspopup": "menu"
  });
  const roleLink = new FakeMetadataNode(document, "DIV", "Target Project", { role: "link" });
  roleLink.click = () => {};
  row.appendChild(menuButton);
  row.appendChild(roleLink);

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);
  assert.equal(target.target, roleLink);
  assert.equal(target.candidateCount, 2);
  assert.equal(target.targetType, "role_link");
  assert.equal(target.targetHasHref, false);
  assert.equal(target.targetRole, "link");
  assert.equal(target.targetTag, "DIV");
  assert.equal(target.targetInsideProjectRow, true);
  assert.equal(target.targetIsMenuControl, false);
  assert.equal(target.targetIsOverflowControl, false);
});

test("Project identity fallback ignores non-Project links and controls outside the confirmed row", () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  const unsafeLink = new FakeMetadataNode(document, "A", "", { href: "/schedule" });
  const outsideControl = new FakeMetadataNode(document, "BUTTON", "", {
    "aria-label": "Plugins"
  });
  row.appendChild(unsafeLink);
  sidebar.appendChild(outsideControl);
  row.click = () => {};

  const locators = loadLocators(document);
  const target = locators.projectInteractiveTargetForRow(row, rootHref);
  assert.equal(target.candidateCount, 1);
  assert.equal(target.target, row);
  assert.equal(target.targetType, "row");
  assert.equal(target.targetInsideProjectRow, true);
  assert.notEqual(target.target, unsafeLink);
  assert.notEqual(target.target, outsideControl);
});

test("Project identity fallback uses the event sequence once when target.click does not navigate", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Target Project"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  const target = new FakeMetadataNode(document, "DIV", "Target Project", { role: "button" });
  let targetClickCount = 0;
  const eventTypes = [];
  target.click = () => { targetClickCount += 1; };
  target.dispatchEvent = (event) => {
    eventTypes.push(event.type);
    if (event.type === "click") document.location.href = "https://chatgpt.com/g/g-p-target/project";
  };
  row.appendChild(target);

  const locators = loadLocators(document);
  const navigationTelemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Target Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, "g-p-target");
  assert.equal(result.projects[0].resolution_method, "navigation");
  assert.equal(targetClickCount, 1);
  assert.deepEqual(eventTypes, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
  assert.equal(navigationTelemetry.filter((event) =>
    event.stage === "collector_project_identity_click"
      && event.click_method === "event_sequence"
      && event.click_dispatched === true).length, 1);
  assert.equal(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_click_target"
      && event.selected_target_type === "role_button"
      && event.selected_target_inside_project_row === true), true);
});

test("Project identity navigation rejects a confirmed row that lands on a non-Project URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Unsafe Project"], [], null, null, []);
  document.sidebar = sidebar;
  const navigationTelemetry = [];
  sidebar.projectRows[0].click = () => {
    document.location.href = "https://chatgpt.com/schedule";
  };

  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Unsafe Project" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "navigation_target_not_project");
  assert.equal(result.navigation_resolved_count, 0);
  assert.equal(result.unresolved_count, 1);
  assert.equal(document.location.href, "https://chatgpt.com/schedule");
  assert.ok(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"
    && event.url_changed === true
    && event.navigation_detected === false));
});

test("Project identity navigation refuses ambiguous title-only row relocation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Duplicate", "Duplicate"], [], null, null, []);
  document.sidebar = sidebar;
  let clickCount = 0;
  sidebar.projectRows.forEach((row) => { row.click = () => { clickCount += 1; }; });

  const locators = loadLocators(document);
  const navigationTelemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 1, discovery_index: 8, title: "Duplicate" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });

  assert.equal(clickCount, 0);
  assert.equal(result.projects[0].unresolved_reason, "ambiguous_project_row_match");
  const relocation = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.equal(relocation.candidate_count, 2);
  assert.equal(relocation.row_found, false);
  assert.equal(relocation.match_method, "ambiguous_title_only_rejected");
  assert.equal(relocation.section_verified, true);
  assert.equal(relocation.stale_element_reused, false);
  assert.equal(navigationTelemetry.some((event) =>
    event.stage === "collector_project_identity_click"), false);
});

test("current expanded Project row receives the ID from the current route and classifies its chats", () => {
  const href = "https://chatgpt.com/g/g-p-current/c/conversation-current";
  const document = new FakeMetadataDocument(href, null);
  const conversation = new FakeMetadataNode(document, "A", "", {
    href: "/g/g-p-current/c/conversation-current",
    "aria-label": "Current chat、プロジェクト Current Project 内のチャット"
  });
  conversation.appendChild(new FakeMetadataNode(document, "SPAN", "Current chat", { "data-marquee-text": "true" }));
  const sidebar = new FakeSidebar(document, ["Current Project", "Another Project"], [conversation], null, "Current Project");
  document.sidebar = sidebar;

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, href);
  const project = assertProject(snapshot.projects, "g-p-current");

  assert.equal(project.title, "Current Project");
  assert.equal(project.url, "https://chatgpt.com/g/g-p-current/project");
  assert.equal(snapshot.conversations[0].project_id, "g-p-current");
  assert.equal(snapshot.conversations[0].project_title, "Current Project");
  assert.equal(snapshot.current.project_title, "Current Project");
  assert.equal(snapshot.projects.filter((item) => item.title === "Current Project").length, 1);
});

test("merges an ID-bearing Project link into a fallback row without a ghost entry", () => {
  const href = "https://chatgpt.com/c/conversation-current";
  const document = new FakeMetadataDocument(href, null);
  const projectAnchor = new FakeMetadataNode(document, "A", "Project A", {
    href: "/g/g-p-alpha/project"
  });
  const sidebar = new FakeSidebar(document, ["Project (g-p-alpha)"], [], projectAnchor);
  document.sidebar = sidebar;

  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, href);

  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].project_id, "g-p-alpha");
  assert.equal(snapshot.projects[0].title, "Project A");
  assert.equal(snapshot.projects[0].url, "https://chatgpt.com/g/g-p-alpha/project");
  assert.equal(snapshot.projects[0].discovery_key !== undefined, true);
});

test("Project page collection scans conversation metadata outside the sidebar and scopes it by Project ID", async () => {
  const href = "https://chatgpt.com/g/g-p-alpha/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN", "", {
    // A broad Project-region wrapper may carry an unrelated page-level
    // metadata attribute. It must not classify every nested /c link by it.
    "data-project-id": "g-p-other"
  });
  const alphaChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-alpha/c/conversation-alpha"
  });
  alphaChat.appendChild(new FakeMetadataNode(null, "SPAN", "Alpha chat", { "data-marquee-text": "true" }));
  const secondAlphaChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-alpha/c/conversation-second"
  });
  secondAlphaChat.appendChild(new FakeMetadataNode(null, "SPAN", "Second alpha chat", { "data-marquee-text": "true" }));
  const otherProjectChat = new FakeMetadataNode(null, "A", "Other", {
    href: "/g/g-p-beta/c/conversation-other"
  });
  content.appendChild(alphaChat);
  content.appendChild(secondAlphaChat);
  content.appendChild(otherProjectChat);
  const document = new FakeProjectDocument(href, sidebar, content);
  for (const node of [sidebar, content, alphaChat, secondAlphaChat, otherProjectChat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const telemetry = [];
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-alpha", {
    onTelemetry: (event) => telemetry.push(event)
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), ["g-p-alpha"]);
  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id), [
    "conversation-alpha",
    "conversation-second"
  ]);
  assert.ok(snapshot.conversations.every((conversation) => conversation.project_id === "g-p-alpha"));
  assert.equal(snapshot.project_page_ready, true);
  assert.equal(snapshot.current_project_id_verified, true);
  assert.equal(snapshot.chat_container_found, true);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.scroll_complete, true);
  assert.equal(snapshot.project_chat_hydration_completed, true);
  assert.equal(snapshot.project_chat_hydration_timeout, false);
  const structure = telemetry.find((event) => event.stage === "collector_project_chat_dom_structure");
  assert.equal(structure.project_page_ready, true);
  assert.equal(structure.candidate_chat_link_count, 3);
  assert.equal(structure.matching_project_chat_link_count, 2);
  assert.equal(structure.rejected_other_project_chat_count, 1);
  assert.equal(structure.rejected_projectless_chat_count, 0);
  assert.equal(telemetry.some((event) => event.stage === "collector_project_chat_collection_failed"), false);
});

test("Project page collection prioritizes the central current-Project list over Sidebar noise", async () => {
  const href = "https://chatgpt.com/g/g-p-central/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const sidebarOther = new FakeMetadataNode(null, "A", "Other Project chat", {
    href: "/g/g-p-sidebar/c/sidebar-other"
  });
  const sidebarProjectless = new FakeMetadataNode(null, "A", "Projectless chat", {
    href: "/c/sidebar-projectless"
  });
  sidebar.appendChild(sidebarOther);
  sidebar.appendChild(sidebarProjectless);

  const content = new FakeMetadataNode(null, "MAIN", "", { class: "project-chat-list scrollport" });
  let contentScrollTop = 0;
  const contentScrollWrites = [];
  Object.defineProperty(content, "scrollTop", {
    configurable: true,
    get: () => contentScrollTop,
    set: (value) => {
      contentScrollTop = Number(value) || 0;
      contentScrollWrites.push(contentScrollTop);
    }
  });
  content.clientHeight = 120;
  content.scrollHeight = 360;

  const currentAnchor = new FakeMetadataNode(null, "A", "Same title", {
    href: "/g/g-p-central/c/current-anchor"
  });
  const currentNestedRow = new FakeMetadataNode(null, "DIV", "", {
    role: "button",
    "data-conversation-id": "current-data",
    "data-project-id": "g-p-central"
  });
  currentNestedRow.appendChild(new FakeMetadataNode(null, "SPAN", "Same title", {
    "data-marquee-text": "true"
  }));
  const currentSecondAnchor = new FakeMetadataNode(null, "A", "Second current", {
    href: "/g/g-p-central/c/current-second"
  });
  content.appendChild(currentAnchor);
  content.appendChild(currentNestedRow);
  content.appendChild(currentSecondAnchor);

  // This element has scroll metrics but contains no Project Chat row. It is
  // the kind of tiny header/control scrollport that the old root-wide scan
  // could accidentally select.
  const tinyUnrelatedScrollport = new FakeMetadataNode(null, "DIV", "", {
    class: "header-scrollport"
  });
  tinyUnrelatedScrollport.scrollTop = 0;
  tinyUnrelatedScrollport.clientHeight = 24;
  tinyUnrelatedScrollport.scrollHeight = 48;
  content.appendChild(tinyUnrelatedScrollport);

  const document = new FakeProjectDocument(href, sidebar, content, "Central | ChatGPT");
  for (const node of [
    sidebar,
    sidebarOther,
    sidebarProjectless,
    content,
    currentAnchor,
    currentNestedRow,
    currentSecondAnchor,
    tinyUnrelatedScrollport
  ]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const telemetry = [];
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-central", {
    maxScrolls: 8,
    timeoutMs: 5000,
    onTelemetry: (event) => telemetry.push(event)
  });

  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id).sort(),
    ["current-anchor", "current-data", "current-second"].sort());
  assert.equal(snapshot.candidate_chat_count, 5);
  assert.equal(snapshot.candidate_from_main_count, 3);
  assert.equal(snapshot.candidate_from_sidebar_count, 2);
  assert.equal(snapshot.matching_project_chat_count, 3);
  assert.equal(snapshot.rejected_other_project_chat_count, 1);
  assert.equal(snapshot.rejected_projectless_chat_count, 1);
  assert.equal(snapshot.selected_scroll_container_found, true);
  assert.equal(snapshot.selected_scroll_client_height, 120);
  assert.equal(snapshot.selected_scroll_height, 360);
  assert.equal(snapshot.chat_scroll_container_count, 1);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(contentScrollTop, 0);
  assert.ok(contentScrollWrites.some((value) => value > 0));
  assert.equal(tinyUnrelatedScrollport.scrollTop, 0);

  const source = telemetry.find((event) =>
    event.stage === "collector_project_chat_source_classification");
  assert.equal(source.candidate_from_main_count, 3);
  assert.equal(source.candidate_from_sidebar_count, 2);
  const scroll = telemetry.find((event) =>
    event.stage === "collector_project_chat_scroll_candidates");
  assert.equal(scroll.selected_scroll_client_height, 120);
  assert.equal(scroll.selected_scroll_height, 360);
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_chat_collection_complete"), true);
});

test("Project page collection scopes plain main links to a verified current Project region", async () => {
  const href = "https://chatgpt.com/g/g-p-data/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN", "", {
    // A broad Project-region wrapper may carry unrelated metadata. It is not
    // a membership boundary for every nested conversation link.
    "data-project-id": "g-p-other"
  });
  const projectless = new FakeMetadataNode(null, "A", "Unscoped", {
    href: "/c/unscoped-main"
  });
  const dataRow = new FakeMetadataNode(null, "DIV", "", {
    "data-conversation-id": "data-backed",
    "data-project-id": "g-p-data"
  });
  dataRow.appendChild(new FakeMetadataNode(null, "SPAN", "Data backed", {
    "data-marquee-text": "true"
  }));
  content.appendChild(projectless);
  content.appendChild(dataRow);
  const document = new FakeProjectDocument(href, sidebar, content, "Data Project | ChatGPT");
  for (const node of [sidebar, content, projectless, dataRow]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(
    document,
    href,
    "g-p-data",
    { timeoutMs: 5000 });

  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id),
    ["unscoped-main", "data-backed"]);
  assert.equal(snapshot.rejected_projectless_chat_count, 0);
  assert.equal(snapshot.matching_project_chat_count, 2);
  assert.equal(snapshot.current_project_id_verified, true);
  assert.equal(snapshot.main_candidate_without_project_id_count, 0);
  assert.equal(snapshot.main_current_project_match_count, 2);
  assert.equal(snapshot.project_id_source_project_wrapper_count, 1);
  assert.equal(snapshot.project_id_source_data_attribute_count, 1);
  assert.equal(snapshot.main_candidate_from_verified_project_region_count, 2);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection adopts a verified Project chat route in main", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const chat = new FakeMetadataNode(null, "A", "Chat 1", {
    href: "/g/g-p-A/c/chat1"
  });
  content.appendChild(chat);
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, chat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.deepEqual(Array.from(snapshot.conversations, (item) => item.conversation_id), ["chat1"]);
  assert.equal(snapshot.main_current_project_match_count, 1);
  assert.equal(snapshot.project_id_source_chat_href_count, 1);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.project_chat_membership_inconsistent, false);
});

test("Project Chat href slugs normalize to the same Stable ID as the Project page", async () => {
  const stable = "g-p-6a623bd670d881918ce24d063b799b30";
  const currentSlug = `${stable}-chatgpt-comfy-connector-comfyui-x-chatgpt`;
  const otherSlug = "g-p-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-other-project-name";
  const href = `https://chatgpt.com/g/${stable}/project`;
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const currentChats = [
    new FakeMetadataNode(null, "A", "Current slug", { href: `/g/${currentSlug}/c/chat-slug` }),
    new FakeMetadataNode(null, "A", "Current plain", { href: `/g/${stable}/c/chat-plain` })
  ];
  const otherChat = new FakeMetadataNode(null, "A", "Other", {
    href: `/g/${otherSlug}/c/chat-other`
  });
  const customGpt = new FakeMetadataNode(null, "A", "Custom GPT", {
    href: "/g/g-custom/c/custom-chat"
  });
  for (const node of [...currentChats, otherChat, customGpt]) content.appendChild(node);
  const document = new FakeProjectDocument(href, sidebar, content, "Connector | ChatGPT");
  for (const node of [sidebar, content, ...content.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, stable, {
    timeoutMs: 5000
  });

  assert.equal(snapshot.current_project_id_verified, true);
  assert.equal(snapshot.project_id_source_chat_href_count, 3);
  assert.equal(snapshot.main_current_project_match_count, 2);
  assert.equal(snapshot.main_project_mismatch_count, 1);
  assert.equal(snapshot.matching_project_chat_count, 2);
  assert.equal(snapshot.rejected_other_project_chat_count, 2);
  assert.equal(snapshot.main_custom_gpt_count, 1);
  assert.deepEqual(
    Array.from(snapshot.conversations, (item) => item.conversation_id).sort(),
    ["chat-plain", "chat-slug"]);
  assert.equal(snapshot.conversations.every((item) => item.project_id === stable), true);
  assert.equal(snapshot.project_chat_membership_inconsistent, false);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.project_id_normalization_applied_count >= 1, true);
});

test("Identity resolution and navigation URLs share the slug-aware Stable ID", async () => {
  const stable = "g-p-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const slugged = `${stable}-multi-hyphen-project-slug`;
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Slug Project"], [], null, null, []);
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "slug-list", slugged, 1);

  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Slug Project", discovery_key: "slug-0" }],
    { identityMode: "dom" });
  assert.equal(identity.projects[0].project_id, stable);

  document.location.href = `https://chatgpt.com/g/${slugged}/project`;
  const navigation = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    document.location.href,
    [{ project_index: 0, discovery_index: 0, title: "Slug Project", discovery_key: "slug-0" }],
    { identityMode: "navigation" });
  assert.equal(navigation.projects[0].project_id, stable);
  assert.equal(navigation.projects[0].url, `https://chatgpt.com/g/${stable}/project`);
});

test("Project page collection does not complete empty when every main chat belongs to another Project", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  for (let index = 0; index < 9; index += 1) {
    content.appendChild(new FakeMetadataNode(null, "A", `Other ${index}`, {
      href: `/g/g-p-B/c/other-${index}`
    }));
  }
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, ...content.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.equal(snapshot.conversations.length, 0);
  assert.equal(snapshot.main_project_mismatch_count, 9);
  assert.equal(snapshot.main_current_project_match_count, 0);
  assert.equal(snapshot.main_mismatch_all_same_project_id, true);
  assert.equal(snapshot.main_mismatch_same_project_id_count, 9);
  assert.equal(snapshot.main_mismatch_project_id, "g-p-B");
  assert.equal(snapshot.project_id_source_chat_href_count, 9);
  assert.equal(snapshot.project_chat_membership_inconsistent, true);
  assert.equal(snapshot.project_chat_collection_complete, false);
  assert.equal(snapshot.errorCode, "context_project_chat_membership_mismatch");
});

test("Project page collection keeps current Project chats and rejects other Project chats", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  for (let index = 0; index < 5; index += 1) {
    content.appendChild(new FakeMetadataNode(null, "A", `Current ${index}`, {
      href: `/g/g-p-A/c/current-${index}`
    }));
  }
  for (let index = 0; index < 4; index += 1) {
    content.appendChild(new FakeMetadataNode(null, "A", `Other ${index}`, {
      href: `/g/g-p-B/c/other-${index}`
    }));
  }
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, ...content.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.equal(snapshot.conversations.length, 5);
  assert.equal(snapshot.main_current_project_match_count, 5);
  assert.equal(snapshot.main_project_mismatch_count, 4);
  assert.equal(snapshot.project_chat_membership_inconsistent, false);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection ignores Projectless Sidebar chats while keeping verified main chats", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  for (let index = 0; index < 11; index += 1) {
    sidebar.appendChild(new FakeMetadataNode(null, "A", `Sidebar ${index}`, {
      href: `/c/sidebar-${index}`
    }));
  }
  const content = new FakeMetadataNode(null, "MAIN");
  for (let index = 0; index < 9; index += 1) {
    content.appendChild(new FakeMetadataNode(null, "A", `Main ${index}`, {
      href: `/g/g-p-A/c/main-${index}`
    }));
  }
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, ...sidebar.children, ...content.children]) {
    node.ownerDocument = document;
  }

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.equal(snapshot.conversations.length, 9);
  assert.equal(snapshot.candidate_from_sidebar_count, 11);
  assert.equal(snapshot.rejected_projectless_chat_count, 11);
  assert.equal(snapshot.main_current_project_match_count, 9);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection prefers the Chat route over wrapper metadata", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const wrapper = new FakeMetadataNode(null, "DIV", "", {
    "data-project-id": "g-p-B",
    "data-project-url": "/g/g-p-B/project"
  });
  const row = new FakeMetadataNode(null, "DIV", "", {
    "data-conversation-id": "priority-chat"
  });
  row.appendChild(new FakeMetadataNode(null, "A", "Nested current", {
    href: "/g/g-p-A/c/priority-chat"
  }));
  wrapper.appendChild(row);
  content.appendChild(wrapper);
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, wrapper, row, ...row.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.ok(snapshot.conversations.some((item) => item.conversation_id === "priority-chat"));
  assert.equal(snapshot.main_project_mismatch_count, 0);
  assert.equal(snapshot.project_id_source_nested_href_count >= 1
    || snapshot.project_id_source_chat_href_count >= 1, true);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection does not guess when one row exposes two Project chat routes", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const row = new FakeMetadataNode(null, "BUTTON", "", {
    "data-conversation-id": "ambiguous-row"
  });
  row.appendChild(new FakeMetadataNode(null, "A", "A", {
    href: "/g/g-p-A/c/nested-a"
  }));
  row.appendChild(new FakeMetadataNode(null, "A", "B", {
    href: "/g/g-p-B/c/nested-b"
  }));
  content.appendChild(row);
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, row, ...row.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = locators.collectProjectContextEntries(document, href, "g-p-A");

  assert.equal(snapshot.conversations.some((item) => item.conversation_id === "ambiguous-row"), false);
  assert.deepEqual(
    Array.from(snapshot.conversations, (item) => item.conversation_id).sort(),
    ["nested-a"]);
});

test("Verified Project page with a list wrapper ID still treats /c/ chats as the current Project", async () => {
  const href = "https://chatgpt.com/g/g-p-A/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const list = new FakeMetadataNode(null, "DIV", "", {
    "data-project-id": "g-p-B"
  });
  for (let index = 0; index < 9; index += 1) {
    list.appendChild(new FakeMetadataNode(null, "A", `Chat ${index}`, {
      href: `/c/plain-${index}`
    }));
  }
  content.appendChild(list);
  const document = new FakeProjectDocument(href, sidebar, content, "Project A | ChatGPT");
  for (const node of [sidebar, content, list, ...list.children]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-A", {
    timeoutMs: 5000
  });

  assert.equal(snapshot.conversations.length, 9);
  assert.equal(snapshot.main_project_mismatch_count, 0);
  assert.equal(snapshot.project_id_source_project_wrapper_count, 9);
  assert.equal(snapshot.project_chat_membership_inconsistent, false);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page rejects plain main links when the current Project route is not verified", () => {
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const plainChat = new FakeMetadataNode(null, "A", "Unverified", {
    href: "/c/unverified-main"
  });
  content.appendChild(plainChat);
  const document = new FakeProjectDocument(
    "https://chatgpt.com/c/unverified-page",
    sidebar,
    content,
    "Unverified | ChatGPT");
  for (const node of [sidebar, content, plainChat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = locators.collectProjectContextEntries(
    document,
    document.location.href,
    "g-p-data");

  assert.equal(snapshot.conversations.length, 0);
  assert.equal(snapshot.current_project_id_verified, false);
  assert.equal(snapshot.main_candidate_without_project_id_count, 1);
  assert.equal(snapshot.main_projectless_count, 1);
  assert.equal(snapshot.rejected_projectless_chat_count, 1);
});

test("Project page collection finds a marked central list without a semantic main and supports nested data-backed rows", async () => {
  const href = "https://chatgpt.com/g/g-p-marked/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const sidebarChat = new FakeMetadataNode(null, "A", "Sidebar chat", {
    href: "/g/g-p-other/c/sidebar-chat"
  });
  sidebar.appendChild(sidebarChat);
  const content = new FakeMetadataNode(null, "DIV", "", {
    "data-project-chat-list": "true",
    class: "project-chat-list scrollport"
  });
  content.scrollTop = 0;
  content.clientHeight = 100;
  content.scrollHeight = 220;
  const dataButton = new FakeMetadataNode(null, "BUTTON", "Marked button", {
    "data-conversation-id": "marked-button"
  });
  const nestedRow = new FakeMetadataNode(null, "DIV", "", {
    "data-testid": "conversation-item"
  });
  nestedRow.appendChild(new FakeMetadataNode(null, "A", "Nested anchor", {
    href: "/g/g-p-marked/c/nested-anchor"
  }));
  content.appendChild(dataButton);
  content.appendChild(nestedRow);

  const document = new FakeProjectDocument(href, sidebar, content, "Marked | ChatGPT");
  // This fixture models a layout that has no <main>, while preserving the
  // marked central Project list used to select the collection region.
  document.querySelectorAll = (selector) => {
    if (selector.startsWith("nav[")) return [sidebar];
    if (selector === "main" || selector === '[role="main"]') return [];
    return FakeMetadataNode.prototype.querySelectorAll.call(document, selector);
  };
  for (const node of [sidebar, sidebarChat, content, dataButton, nestedRow, ...nestedRow.children]) {
    node.ownerDocument = document;
  }

  const locators = loadLocators(document);
  const telemetry = [];
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-marked", {
    maxScrolls: 6,
    timeoutMs: 5000,
    onTelemetry: (event) => telemetry.push(event)
  });

  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id).sort(),
    ["marked-button", "nested-anchor"].sort());
  assert.equal(snapshot.main_found, false);
  assert.equal(snapshot.main_region_found, true);
  assert.equal(snapshot.candidate_from_main_count >= 2, true);
  assert.equal(snapshot.matching_project_chat_count >= 2, true);
  assert.equal(snapshot.rejected_other_project_chat_count, 1);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(telemetry.some((event) => event.stage === "collector_project_chat_dom_structure"), true);
});

test("Project page collection rejects custom GPT routes even when they are rendered in the central region", async () => {
  const href = "https://chatgpt.com/g/g-p-strict/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const current = new FakeMetadataNode(null, "A", "Current", {
    href: "/g/g-p-strict/c/current-chat"
  });
  const customGpt = new FakeMetadataNode(null, "A", "Custom GPT", {
    href: "/g/g-custom/c/custom-chat"
  });
  content.appendChild(current);
  content.appendChild(customGpt);
  const document = new FakeProjectDocument(href, sidebar, content, "Strict | ChatGPT");
  for (const node of [sidebar, content, current, customGpt]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(
    document,
    href,
    "g-p-strict",
    { timeoutMs: 5000 });

  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id),
    ["current-chat"]);
  assert.equal(snapshot.rejected_other_project_chat_count, 1);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection accepts a stable, hydrated Project page with zero chats", async () => {
  const href = "https://chatgpt.com/g/g-p-empty/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const document = new FakeProjectDocument(href, sidebar, content, "Empty Project | ChatGPT");
  for (const node of [sidebar, content]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const telemetry = [];
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-empty", {
    onTelemetry: (event) => telemetry.push(event)
  });

  assert.equal(snapshot.conversations.length, 0);
  assert.equal(snapshot.project_page_ready, true);
  assert.equal(snapshot.relevant_region_present, true);
  assert.equal(snapshot.project_chat_hydration_completed, true);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.scroll_complete, true);
  const scan = telemetry.filter((event) => event.stage === "collector_project_chat_scan").at(-1);
  assert.equal(scan.discovered_chat_count, 0);
  assert.equal(scan.deduped_chat_count, 0);
  assert.equal(scan.reached_end, true);
});

test("Project page collection waits for delayed chat hydration before scanning", async () => {
  const href = "https://chatgpt.com/g/g-p-delayed/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN");
  const document = new FakeProjectDocument(href, sidebar, content, "Delayed Project | ChatGPT");
  for (const node of [sidebar, content]) node.ownerDocument = document;
  document.readyState = "complete";
  document.documentElement = document;
  document.defaultView = {
    getComputedStyle() { return { display: "", visibility: "" }; },
    MutationObserver: FakeMutationObserver
  };
  FakeMutationObserver.instances.length = 0;

  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const collectionPromise = locators.collectChatGptProjectContextAsync(
    document,
    href,
    "g-p-delayed",
    {
      initialSettleMs: 0,
      projectChatHydrationQuietMs: 30,
      projectChatHydrationPollMs: 5,
      projectChatHydrationTimeoutMs: 300
    });

  await new Promise((resolve) => setTimeout(resolve, 15));
  const delayedChat = new FakeMetadataNode(null, "A", "Delayed chat", {
    href: "/g/g-p-delayed/c/delayed-chat"
  });
  delayedChat.ownerDocument = document;
  content.appendChild(delayedChat);
  const observer = FakeMutationObserver.instances.at(-1);
  assert.ok(observer);
  observer.emit([{ type: "childList" }]);

  const snapshot = await collectionPromise;
  assert.deepEqual(
    Array.from(snapshot.conversations, (conversation) => conversation.conversation_id),
    ["delayed-chat"]);
  assert.equal(snapshot.project_chat_hydration_completed, true);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

test("Project page collection follows lazy Project chat growth with bounded scrolling", async () => {
  const href = "https://chatgpt.com/g/g-p-lazy/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN", "", { class: "scrollport" });
  content.scrollTop = 0;
  content.clientHeight = 100;
  content.scrollHeight = 280;
  const firstChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-lazy/c/conversation-lazy-first"
  });
  firstChat.appendChild(new FakeMetadataNode(null, "SPAN", "First lazy chat", { "data-marquee-text": "true" }));
  const secondChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-lazy/c/conversation-lazy-second"
  });
  secondChat.appendChild(new FakeMetadataNode(null, "SPAN", "Second lazy chat", { "data-marquee-text": "true" }));
  content.appendChild(firstChat);
  let lazyChatAttached = false;
  Object.defineProperty(content, "scrollTop", {
    configurable: true,
    get() { return this._scrollTop || 0; },
    set(value) {
      this._scrollTop = value;
      if (value > 0 && !lazyChatAttached) {
        lazyChatAttached = true;
        this.appendChild(secondChat);
      }
    }
  });
  const document = new FakeProjectDocument(href, sidebar, content, "Lazy Project | ChatGPT");
  for (const node of [sidebar, content, firstChat, secondChat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-lazy", {
    maxScrolls: 8,
    timeoutMs: 5000
  });

  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id), [
    "conversation-lazy-first",
    "conversation-lazy-second"
  ]);
  assert.equal(content.scrollTop, 0);
});

test("Project page collection keeps independent sidebar and main-list scrollports separate", async () => {
  const href = "https://chatgpt.com/g/g-p-two-lists/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  sidebar.scrollTop = 0;
  sidebar.clientHeight = 100;
  sidebar.scrollHeight = 280;
  const content = new FakeMetadataNode(null, "MAIN", "", { class: "scrollport" });
  content.scrollTop = 0;
  content.clientHeight = 100;
  content.scrollHeight = 280;
  const firstChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-two-lists/c/conversation-two-lists-first"
  });
  firstChat.appendChild(new FakeMetadataNode(null, "SPAN", "First list chat", { "data-marquee-text": "true" }));
  const secondChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-two-lists/c/conversation-two-lists-second"
  });
  secondChat.appendChild(new FakeMetadataNode(null, "SPAN", "Second list chat", { "data-marquee-text": "true" }));
  content.appendChild(firstChat);
  let secondAttached = false;
  Object.defineProperty(content, "scrollTop", {
    configurable: true,
    get() { return this._scrollTop || 0; },
    set(value) {
      this._scrollTop = value;
      if (value > 0 && !secondAttached) {
        secondAttached = true;
        this.appendChild(secondChat);
      }
    }
  });
  const document = new FakeProjectDocument(href, sidebar, content, "Two Lists | ChatGPT");
  for (const node of [sidebar, content, firstChat, secondChat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-two-lists", {
    maxScrolls: 8,
    timeoutMs: 5000
  });

  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id), [
    "conversation-two-lists-first",
    "conversation-two-lists-second"
  ]);
  assert.equal(snapshot.project_page_ready, true);
  assert.equal(snapshot.current_project_id_verified, true);
  assert.equal(snapshot.chat_container_found, true);
  assert.equal(snapshot.discovered_chat_count, 2);
  assert.equal(snapshot.deduped_chat_count, 2);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.scroll_complete, true);
  assert.equal(content.scrollTop, 0);
  assert.equal(sidebar.scrollTop, 0);
});

test("Project page collection includes scoped Sidebar chats without importing Projectless chats", async () => {
  const href = "https://chatgpt.com/g/g-p-scoped/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  sidebar.scrollTop = 0;
  sidebar.clientHeight = 100;
  sidebar.scrollHeight = 220;
  const scopedChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-scoped/c/sidebar-scoped"
  });
  scopedChat.appendChild(new FakeMetadataNode(null, "SPAN", "Scoped Sidebar chat", {
    "data-marquee-text": "true"
  }));
  const projectlessChat = new FakeMetadataNode(null, "A", "", {
    href: "/c/sidebar-projectless"
  });
  projectlessChat.appendChild(new FakeMetadataNode(null, "SPAN", "Projectless Sidebar chat", {
    "data-marquee-text": "true"
  }));
  sidebar.appendChild(scopedChat);
  sidebar.appendChild(projectlessChat);
  const content = new FakeMetadataNode(null, "MAIN");
  const mainChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-scoped/c/main-scoped"
  });
  mainChat.appendChild(new FakeMetadataNode(null, "SPAN", "Main scoped chat", {
    "data-marquee-text": "true"
  }));
  content.appendChild(mainChat);
  const document = new FakeProjectDocument(href, sidebar, content, "Scoped | ChatGPT");
  for (const node of [sidebar, scopedChat, projectlessChat, content, mainChat]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-scoped", {
    maxScrolls: 8,
    timeoutMs: 5000
  });

  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id).sort(), [
    "main-scoped",
    "sidebar-scoped"
  ]);
  assert.equal(snapshot.project_chat_collection_complete, true);
  assert.equal(snapshot.scroll_complete, true);
  assert.equal(sidebar.scrollTop, 0);
});

test("Project page collection handles a plain Chat link under the expanded current Project row", async () => {
  const href = "https://chatgpt.com/g/g-p-expanded/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const projectRow = new FakeMetadataNode(null, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true",
    "aria-expanded": "true"
  });
  projectRow.appendChild(new FakeMetadataNode(null, "SPAN", "Expanded Project", {
    "data-marquee-text": "true"
  }));
  const nestedChat = new FakeMetadataNode(null, "A", "", {
    href: "/c/expanded-project-chat"
  });
  nestedChat.appendChild(new FakeMetadataNode(null, "SPAN", "Expanded Project chat", {
    "data-marquee-text": "true"
  }));
  projectRow.appendChild(nestedChat);
  sidebar.appendChild(projectRow);
  const document = new FakeProjectDocument(
    href,
    sidebar,
    new FakeMetadataNode(null, "MAIN"),
    "Expanded Project | ChatGPT");
  for (const node of [sidebar, projectRow, nestedChat, document.content]) node.ownerDocument = document;

  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-expanded", {
    maxScrolls: 4,
    timeoutMs: 5000
  });

  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id), [
    "expanded-project-chat"
  ]);
  assert.equal(snapshot.project_chat_collection_complete, true);
});

function attachExclusiveChildChats(document, row, regionId, projectId, count, mixedIds = null) {
  row.attributes.set("aria-controls", regionId);
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: regionId });
  const ids = mixedIds || Array.from({ length: count }, () => projectId);
  ids.forEach((id, index) => {
    region.appendChild(new FakeMetadataNode(document, "A", `Chat ${index}`, {
      href: `/g/${id}/c/${id}-chat-${index}`
    }));
  });
  document.registerElementById(region);
  return region;
}

test("28 Project rows with exclusive child Chat identities keep unique Stable IDs", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 28 }, (_, index) => `Unique Project ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  const catalog = names.map((title, index) => {
    attachExclusiveChildChats(document, sidebar.projectRows[index], `exclusive-${index}`, `g-p-unique-${index}`, 1);
    return {
      project_index: index,
      discovery_index: index,
      title,
      discovery_key: `unique-${index}`
    };
  });
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    { identityMode: "dom" });
  const ids = result.projects.map((project) => project.project_id);
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 28);
  assert.equal(new Set(ids).size, 28);
  assert.deepEqual(ids, Array.from({ length: 28 }, (_, index) => `g-p-unique-${index}`));
});

test("Five child Chat URLs for one Project all pointing at the same g-p-* resolve consistently", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Same ID Project"], [], null, null, []);
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "same-id-list", "g-p-same", 5);
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 26, discovery_index: 26, title: "Same ID Project", discovery_key: "same-26" }],
    {
      identityMode: "navigation",
      identityCatalog: [{ project_index: 26, discovery_index: 26, title: "Same ID Project" }],
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.projects[0].project_id, "g-p-same");
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.projects[0].identity_source, "child_chat_url");
  assert.equal(result.projects[0].navigation_target_verified, false);
  const consistency = telemetry.find((event) =>
    event.stage === "collector_project_identity_candidate_consistency");
  assert.equal(consistency.stable_identity_candidate_count, 5);
  assert.equal(consistency.distinct_candidate_project_id_count, 1);
  assert.equal(consistency.candidate_project_id_fingerprints, "pid-1");
  assert.equal(consistency.resolved_project_id_fingerprint, "pid-1");
  assert.equal(consistency.identity_candidate_consistent, true);
  assert.equal(consistency.identity_source, "child_chat_url");
  assert.equal(consistency.resolution_success, true);
});

test("Mixed g-p-* child Chat candidates in one Project scope stay unresolved", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Mixed ID Project"], [], null, null, []);
  document.sidebar = sidebar;
  attachExclusiveChildChats(
    document,
    sidebar.projectRows[0],
    "mixed-id-list",
    "g-p-a",
    5,
    ["g-p-a", "g-p-a", "g-p-a", "g-p-b", "g-p-b"]);
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Mixed ID Project", discovery_key: "mixed-0" }],
    {
      identityMode: "navigation",
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "ambiguous_project_identity");
  assert.equal(result.unresolved_count, 1);
  const consistency = telemetry.find((event) =>
    event.stage === "collector_project_identity_candidate_consistency");
  assert.equal(consistency.stable_identity_candidate_count, 5);
  assert.equal(consistency.distinct_candidate_project_id_count, 2);
  assert.equal(consistency.candidate_project_id_fingerprints, "pid-1,pid-2");
  assert.equal(consistency.identity_candidate_consistent, false);
  assert.equal(consistency.resolution_success, false);
});

test("Neighbor Project child Chats outside the exclusive controlled region are not adopted", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Project A", "Project B"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "list-a", "g-p-alpha", 2);
  attachExclusiveChildChats(document, sidebar.projectRows[1], "list-b", "g-p-beta", 2);
  const leaked = new FakeMetadataNode(document, "A", "Leaked", {
    href: "/g/g-p-beta/c/leaked-into-a"
  });
  sidebar.projectRows[0].parentElement = sidebar;
  sidebar.projectRows[1].parentElement = sidebar;
  sidebar.appendChild(leaked);
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [
      { project_index: 0, discovery_index: 0, title: "Project A", discovery_key: "a" },
      { project_index: 1, discovery_index: 1, title: "Project B", discovery_key: "b" }
    ],
    { identityMode: "dom" });
  assert.equal(result.projects[0].project_id, "g-p-alpha");
  assert.equal(result.projects[1].project_id, "g-p-beta");
  assert.equal(result.unresolved_count, 0);
});

test("Shared aria-controls list is not used as identity for either Project row", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Shared A", "Shared B"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  const shared = attachExclusiveChildChats(
    document,
    sidebar.projectRows[0],
    "shared-list",
    "g-p-shared-list",
    5);
  sidebar.projectRows[1].attributes.set("aria-controls", "shared-list");
  sidebar.projectRows[1].attributes.set("aria-expanded", "true");
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [
      { project_index: 26, discovery_index: 26, title: "Shared A", discovery_key: "shared-a" },
      { project_index: 27, discovery_index: 27, title: "Shared B", discovery_key: "shared-b" }
    ],
    { identityMode: "dom" });
  assert.equal(shared.getAttribute("id"), "shared-list");
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[1].project_id, undefined);
  assert.equal(result.unresolved_count, 2);
});

test("Ancestor wrapper that contains another Project row is not used as identity", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Wrapped A", "Wrapped B"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  const wrapper = new FakeMetadataNode(document, "DIV", "", { "data-project-id": "g-p-wrapper" });
  wrapper.appendChild(sidebar.projectRows[0]);
  wrapper.appendChild(sidebar.projectRows[1]);
  sidebar.appendChild(wrapper);
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [
      { project_index: 0, discovery_index: 0, title: "Wrapped A", discovery_key: "wrap-a" },
      { project_index: 1, discovery_index: 1, title: "Wrapped B", discovery_key: "wrap-b" }
    ],
    { identityMode: "dom" });
  assert.notEqual(result.projects[0].project_id, "g-p-wrapper");
  assert.notEqual(result.projects[1].project_id, "g-p-wrapper");
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[1].project_id, undefined);
});

test("Index 26 and 27 with five distinct child Chat identities stay unique", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Late Project 26", "Late Project 27"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "list-26", "g-p-late-26", 5);
  attachExclusiveChildChats(document, sidebar.projectRows[1], "list-27", "g-p-late-27", 5);
  const locators = loadLocators(document);
  const ids = [];
  for (const [index, title] of [[26, "Late Project 26"], [27, "Late Project 27"]]) {
    const telemetry = [];
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document,
      rootHref,
      [{
        project_index: index,
        discovery_index: index,
        title,
        discovery_key: `late-${index}`
      }],
      {
        identityMode: "navigation",
        identityCatalog: [
          { project_index: 26, discovery_index: 26, title: "Late Project 26" },
          { project_index: 27, discovery_index: 27, title: "Late Project 27" }
        ],
        onTelemetry: (event) => telemetry.push(event)
      });
    const consistency = telemetry.find((event) =>
      event.stage === "collector_project_identity_candidate_consistency");
    assert.equal(consistency.stable_identity_candidate_count, 5);
    assert.equal(consistency.distinct_candidate_project_id_count, 1);
    assert.equal(consistency.identity_candidate_consistent, true);
    assert.equal(consistency.navigation_target_verified, false);
    assert.equal(result.projects[0].project_id, `g-p-late-${index}`);
    ids.push(result.projects[0].project_id);
  }
  assert.deepEqual(ids, ["g-p-late-26", "g-p-late-27"]);
});

function assertProject(projects, projectId) {
  const project = projects.find((item) => item.project_id === projectId);
  assert.ok(project, `expected Project ${projectId}`);
  return project;
}
