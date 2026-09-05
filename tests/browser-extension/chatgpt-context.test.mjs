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

  get nextElementSibling() {
    if (!this.parentElement?.children) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index < 0) return null;
    return siblings[index + 1] || null;
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
    emptyUntilScroll = false,
    remountOnScroll = false,
    maxPositionChanges = null,
    jitterHeightOnScroll = false,
    growHeightOnScroll = false,
    hiddenUntilScrollIndexes = [],
    hiddenForeverIndexes = []
  } = {}) {
    super(document, "NAV");
    this.itemWindow = itemWindow;
    this.expanded = true;
    this.nestedScroll = nestedScroll;
    this.emptyUntilScroll = emptyUntilScroll;
    this.remountOnScroll = remountOnScroll;
    this.maxPositionChanges = Number.isSafeInteger(maxPositionChanges) ? maxPositionChanges : null;
    this.jitterHeightOnScroll = jitterHeightOnScroll === true;
    this.growHeightOnScroll = growHeightOnScroll === true;
    this.hiddenUntilScrollIndexes = new Set(hiddenUntilScrollIndexes);
    this.hiddenForeverIndexes = new Set(hiddenForeverIndexes);
    this.positionChangeCount = 0;
    this.baseScrollHeight = Math.max(400, projectNames.length * 100);
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
        const next = Number(value) || 0;
        if (this.maxPositionChanges !== null
          && this.positionChangeCount >= this.maxPositionChanges
          && next !== this.scrollport._scrollTop) {
          this.scrollHistory.push(this.scrollport._scrollTop);
          if (this.jitterHeightOnScroll) {
            this.scrollport.scrollHeight = this.baseScrollHeight
              + (this.scrollHistory.length % 5);
          }
          return;
        }
        const changed = next !== this.scrollport._scrollTop;
        this.scrollport._scrollTop = next;
        this.scrollHistory.push(this.scrollport._scrollTop);
        if (changed) {
          this.positionChangeCount += 1;
          this.hiddenUntilScrollIndexes.clear();
        }
        if (changed && this.growHeightOnScroll) {
          this.baseScrollHeight += 80;
          this.scrollport.scrollHeight = this.baseScrollHeight;
        }
        if (this.jitterHeightOnScroll) {
          this.scrollport.scrollHeight = this.baseScrollHeight
            + (this.scrollHistory.length % 5);
        }
        if (this.remountOnScroll && changed) {
          this.projectRows.forEach((row) => { row.isConnected = false; });
          this.rebuildRows();
        }
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
        const next = Number(value) || 0;
        if (this.maxPositionChanges !== null
          && this.positionChangeCount >= this.maxPositionChanges
          && next !== currentScrollTop) {
          this.scrollHistory.push(currentScrollTop);
          if (this.jitterHeightOnScroll) {
            this.scrollHeight = this.baseScrollHeight + (this.scrollHistory.length % 5);
          }
          return;
        }
        const changed = next !== currentScrollTop;
        currentScrollTop = next;
        this.scrollHistory.push(currentScrollTop);
        if (changed) {
          this.positionChangeCount += 1;
          this.hiddenUntilScrollIndexes.clear();
        }
        if (changed && this.growHeightOnScroll) {
          this.baseScrollHeight += 80;
          this.scrollHeight = this.baseScrollHeight;
        }
        if (this.jitterHeightOnScroll) {
          this.scrollHeight = this.baseScrollHeight + (this.scrollHistory.length % 5);
        }
        if (this.remountOnScroll && changed) {
          this.projectRows.forEach((row) => { row.isConnected = false; });
          this.rebuildRows();
        }
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
    return this.projectRows.slice(start, start + this.itemWindow).filter((row, offset) => {
      const logical = start + offset;
      if (this.hiddenForeverIndexes.has(logical)) return false;
      if (this.hiddenUntilScrollIndexes.has(logical)) return false;
      return true;
    });
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
    this.hidden = false;
    this.visibilityState = "visible";
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
  assert.deepEqual(Array.from(snapshot.conversations, (item) => item.title), [
    "同じChat",
    "同じChat",
    "Project外Chat"
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
  assert.ok(result.hydration_poll_count >= 1);
  assert.ok(result.hydration_poll_wait_ms >= 0);
  assert.equal(result.hydration_poll_interval_ms, 25);
  assert.deepEqual(sidebar.scrollHistory, []);
});

test("Root Sidebar hydration ignores unrelated main-content mutation churn", async () => {
  const rootHref = "https://chatgpt.com/";
  const sidebar = new FakeSidebar(null, [], [], null, null, []);
  const content = new FakeMetadataNode(null, "MAIN");
  const document = new FakeProjectDocument(rootHref, sidebar, content);
  sidebar.ownerDocument = document;
  content.ownerDocument = document;
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
    { timeoutMs: 300, quietMs: 30, pollMs: 25 });
  await new Promise((resolve) => setTimeout(resolve, 15));
  const observer = FakeMutationObserver.instances.at(-1);
  assert.ok(observer);
  observer.emit([{ type: "childList", target: content }]);

  const result = await hydrationPromise;
  assert.equal(result.status, "ok");
  assert.equal(result.root_hydration_completed, true);
  assert.equal(result.mutation_count, 0);
  assert.ok(result.hydration_wait_ms >= 30);
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

test("conversation title extraction keeps title and preview structurally separate", () => {
  const document = new FakeDocument("https://chatgpt.com/c/current");
  const row = new FakeMetadataNode(document, "A", "", {
    href: "/c/title-preview",
    "aria-label": "全プロジェクト取得 プロンプトをください"
  });
  row.appendChild(new FakeMetadataNode(document, "DIV", "全プロジェクト取得", {
    class: "truncate"
  }));
  row.appendChild(new FakeMetadataNode(document, "DIV", "プロンプトをください", {
    class: "line-clamp-2 text-token-text-secondary"
  }));

  const locators = loadLocators(document);
  const extracted = locators.extractChatTitle(row);

  assert.equal(extracted.title, "全プロジェクト取得");
  assert.equal(extracted.title.includes("プロンプトをください"), false);
  assert.equal(extracted.chat_title_source, "title_element");
  assert.equal(extracted.title_element_found, true);
  assert.equal(extracted.preview_element_found, true);
  assert.equal(extracted.title_differs_from_row_text, true);
  assert.equal(extracted.title_fallback_used, false);
});

test("conversation title extraction supports long Japanese previews, title-only rows, and repeated titles", () => {
  const document = new FakeDocument("https://chatgpt.com/c/current");
  const makeRow = (id, title, preview = null) => {
    const row = new FakeMetadataNode(document, "A", "", {
      href: `/c/${id}`
    });
    row.appendChild(new FakeMetadataNode(document, "DIV", title, {
      class: "conversation-title"
    }));
    if (preview !== null) {
      row.appendChild(new FakeMetadataNode(document, "DIV", preview, {
        class: "conversation-preview"
      }));
    }
    return row;
  };
  const rows = [
    makeRow(
      "same-one",
      "追加実装",
      "一度、codex自身に判断してもらいながら、この、以前はできていたプロジェクト全取得が..."),
    makeRow("same-two", "追加実装"),
    makeRow("japanese-symbols", "日本語 Chat — v2!?"),
  ];
  const locators = loadLocators(document);

  assert.deepEqual(rows.map((row) => locators.extractChatTitle(row).title), [
    "追加実装",
    "追加実装",
    "日本語 Chat — v2!?"
  ]);
  assert.deepEqual(rows.map((row) => locators.extractChatTitle(row).preview_element_found), [
    true,
    false,
    false
  ]);
  const ambiguousRow = new FakeMetadataNode(document, "A", "", { href: "/c/ambiguous" });
  ambiguousRow.appendChild(new FakeMetadataNode(document, "DIV", "Title without marker"));
  ambiguousRow.appendChild(new FakeMetadataNode(document, "DIV", "Preview without marker"));
  const ambiguous = locators.extractChatTitle(ambiguousRow);
  assert.equal(ambiguous.title, "");
  assert.equal(ambiguous.title_extraction_success, false);
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
  assert.ok(snapshot.root_catalog_build_count > 0);
  assert.equal(snapshot.root_catalog_reuse_count, snapshot.root_catalog_build_count - 1);
  assert.ok(snapshot.root_catalog_build_count <= snapshot.sidebar_scroll_attempt_count + 1);
  assert.equal(
    snapshot.sidebar_scroll_position_change_count,
    snapshot.sidebar_scroll_attempt_count);
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

test("Project disclosure without a stable controlled-region identity still tries row navigation without adopting the root URL", async () => {
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

  assert.ok(clickCount >= 1);
  assert.equal(document.location.href, rootHref);
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.unresolved_count, 1);
  assert.equal(result.projects[0].navigation_eligible, true);
  const source = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
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
  assert.equal(result.unresolved_count, 1);
  assert.equal(result.projects[0].navigation_eligible, true);
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
  assert.equal(result.projects[0].unresolved_reason, "row_visibility_exhausted");
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
  alphaChat.appendChild(new FakeMetadataNode(null, "DIV", "Alpha chat", {
    class: "conversation-title"
  }));
  alphaChat.appendChild(new FakeMetadataNode(null, "DIV", "Alpha preview", {
    class: "conversation-preview"
  }));
  const secondAlphaChat = new FakeMetadataNode(null, "A", "", {
    href: "/g/g-p-alpha/c/conversation-second"
  });
  secondAlphaChat.appendChild(new FakeMetadataNode(null, "DIV", "Second alpha chat", {
    class: "conversation-title"
  }));
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
  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.title), [
    "Alpha chat",
    "Second alpha chat"
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
  assert.equal(structure.title_element_found, true);
  assert.equal(structure.preview_element_found, true);
  assert.equal(structure.title_extraction_success, true);
  assert.equal(structure.title_differs_from_row_text, true);
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

function attachCollapsedDisclosure(document, row, regionId, projectId) {
  row.attributes.set("aria-controls", regionId);
  row.attributes.set("aria-expanded", "false");
  const region = new FakeMetadataNode(document, "DIV", "", { id: regionId });
  document.registerElementById(region);
  row.click = () => {
    row.attributes.set("aria-expanded", "true");
    if (region.children.length === 0 && projectId) {
      region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
        href: `/g/${projectId}/c/${projectId}-chat`
      }));
    }
  };
  return region;
}

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

test("28 collapsed disclosure Projects resolve in one DOM pass without double relocation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 28 }, (_, index) => `Disclosure Project ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  const catalog = names.map((title, index) => {
    attachCollapsedDisclosure(
      document,
      sidebar.projectRows[index],
      `collapsed-${index}`,
      `g-p-collapsed-${index}`);
    return {
      project_index: index,
      discovery_index: index,
      title,
      discovery_key: `collapsed-${index}`
    };
  });
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    {
      identityMode: "dom",
      identityCatalog: catalog,
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 28);
  assert.equal(result.navigation_resolved_count, 0);
  assert.deepEqual(
    result.projects.map((project) => project.project_id),
    Array.from({ length: 28 }, (_, index) => `g-p-collapsed-${index}`));
  assert.equal(result.projects.every((project) => project.identity_source === "child_chat_url"), true);
  const starts = telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation_start");
  const relocations = telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.equal(starts.length, 28);
  assert.equal(relocations.length, 28);
  assert.equal(starts.every((event) => event.sidebar_dom_generation_changed !== true), true);
  assert.equal(relocations.filter((event) => event.catalog_reused === true).length, 27);
  assert.equal(telemetry.some((event) => event.stage === "collector_project_identity_navigation_wait"), false);
  assert.equal(telemetry.filter((event) =>
    event.stage === "collector_project_identity_disclosure_click").length, 28);
});

test("connected disclosure row does not force a second relocation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Connected Project"], [], null, null, []);
  document.sidebar = sidebar;
  attachCollapsedDisclosure(document, sidebar.projectRows[0], "connected-region", "g-p-connected");
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Connected Project", discovery_key: "connected-0" }],
    {
      identityMode: "dom",
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.projects[0].project_id, "g-p-connected");
  assert.equal(sidebar.projectRows[0].isConnected, true);
  assert.equal(telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation_start").length, 1);
  assert.equal(telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation").length, 1);
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_identity_row_relocation"
    && event.relocation_skipped_connected_row === true), true);
});

test("disconnected disclosure row is relocated instead of reused", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Remount Project"], [], null, null, []);
  document.sidebar = sidebar;
  const original = sidebar.projectRows[0];
  original.attributes.set("aria-controls", "remount-region");
  original.attributes.set("aria-expanded", "false");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "remount-region" });
  document.registerElementById(region);
  original.click = () => {
    original.isConnected = false;
    const replacement = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "true",
      "aria-controls": "remount-region"
    });
    replacement.appendChild(new FakeMetadataNode(document, "SPAN", "Remount Project", {
      "data-marquee-text": "true"
    }));
    replacement.isConnected = true;
    sidebar.projectRows[0] = replacement;
    if (region.children.length === 0) {
      region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
        href: "/g/g-p-remount/c/remount-chat"
      }));
    }
  };
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Remount Project", discovery_key: "remount-0" }],
    { identityMode: "dom" });
  assert.equal(original.isConnected, false);
  assert.equal(sidebar.projectRows[0].isConnected, true);
  assert.equal(result.projects[0].project_id, "g-p-remount");
  assert.equal(result.unresolved_count, 0);
});

test("Stable ID from a controlled region ends identity without navigation search", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Region Project"], [], null, null, []);
  document.sidebar = sidebar;
  attachCollapsedDisclosure(document, sidebar.projectRows[0], "region-id", "g-p-region");
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Region Project" }],
    {
      identityMode: "dom",
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.projects[0].project_id, "g-p-region");
  assert.equal(result.projects[0].identity_source, "child_chat_url");
  assert.equal(telemetry.some((event) => event.stage === "collector_project_identity_navigation_wait"), false);
  assert.equal(telemetry.some((event) => event.stage === "collector_project_identity_row_structure"), false);
  const classification = telemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(classification.resolution_success, true);
  assert.ok(Number.isSafeInteger(classification.identity_elapsed_ms));
});

test("descriptor Stable ID skips disclosure entirely", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Metadata Project"], [], null, null, []);
  document.sidebar = sidebar;
  let clickCount = 0;
  attachCollapsedDisclosure(document, sidebar.projectRows[0], "meta-region", "g-p-meta");
  sidebar.projectRows[0].click = () => {
    clickCount += 1;
  };
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{
      project_index: 0,
      discovery_index: 0,
      title: "Metadata Project",
      project_id: "g-p-meta",
      url: "https://chatgpt.com/g/g-p-meta/project"
    }],
    {
      identityMode: "dom",
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(clickCount, 0);
  assert.equal(result.projects[0].project_id, "g-p-meta");
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_identity_disclosure_click"), false);
  assert.equal(telemetry.some((event) =>
    event.stage === "collector_project_identity_row_relocation_start"), false);
});

test("DOM generation change rebuilds the identity candidate catalog", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = ["First Catalog Project", "Second Catalog Project"];
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  names.forEach((title, index) => {
    const row = sidebar.projectRows[index];
    attachCollapsedDisclosure(document, row, `gen-${index}`, `g-p-gen-${index}`);
    const originalClick = row.click;
    row.click = () => {
      originalClick();
      if (index === 0) {
        row.isConnected = false;
        const replacement = new FakeMetadataNode(document, "DIV", "", {
          role: "button",
          "data-sidebar-item": "true",
          "aria-expanded": "true",
          "aria-controls": `gen-${index}`
        });
        replacement.appendChild(new FakeMetadataNode(document, "SPAN", title, {
          "data-marquee-text": "true"
        }));
        sidebar.projectRows[index] = replacement;
      }
    };
  });
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `gen-${index}`
  }));
  const locators = loadLocators(document);
  const telemetry = [];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    {
      identityMode: "dom",
      identityCatalog: catalog,
      onTelemetry: (event) => telemetry.push(event)
    });
  assert.equal(result.unresolved_count, 0);
  const relocations = telemetry.filter((event) =>
    event.stage === "collector_project_identity_row_relocation");
  assert.ok(relocations.some((event) => event.catalog_reused === true)
    || relocations.some((event) => event.catalog_reused === false));
  assert.equal(relocations[0].catalog_reused, false);
});

test("duplicate titles are not bound by title alone during identity", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["同じProject", "同じProject"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  attachCollapsedDisclosure(document, sidebar.projectRows[0], "dup-a", "g-p-dup-a");
  attachCollapsedDisclosure(document, sidebar.projectRows[1], "dup-b", "g-p-dup-b");
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  assert.equal(discovered.projects.length, 2);
  assert.notEqual(discovered.projects[0].discovery_key, discovered.projects[1].discovery_key);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    discovered.projects.map((project, index) => ({
      ...project,
      project_index: index,
      discovery_index: index
    })),
    { identityMode: "dom", identityCatalog: discovered.projects });
  assert.equal(result.projects[0].project_id, "g-p-dup-a");
  assert.equal(result.projects[1].project_id, "g-p-dup-b");
  assert.equal(result.unresolved_count, 0);
});

test("one Project uses navigation fallback after DOM disclosure identity", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Resolved Project", "Fallback Project"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  attachCollapsedDisclosure(document, sidebar.projectRows[0], "resolved-region", "g-p-resolved");
  const fallbackRow = sidebar.projectRows[1];
  fallbackRow.attributes.set("aria-controls", "fallback-empty");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", {
    id: "fallback-empty"
  }));
  const fallbackLink = new FakeMetadataNode(document, "DIV", "Fallback Project", { role: "link" });
  fallbackRow.click = () => {
    fallbackRow.attributes.set("aria-expanded", "true");
  };
  fallbackLink.click = () => {
    document.location.href = "https://chatgpt.com/g/g-p-fallback/project";
  };
  fallbackRow.appendChild(fallbackLink);
  const catalog = [
    { project_index: 0, discovery_index: 0, title: "Resolved Project", discovery_key: "resolved-0" },
    { project_index: 20, discovery_index: 20, title: "Fallback Project", discovery_key: "fallback-20" }
  ];
  const locators = loadLocators(document);
  const domTelemetry = [];
  const dom = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    {
      identityMode: "dom",
      identityCatalog: catalog,
      navigationTimeoutMs: 400,
      onTelemetry: (event) => domTelemetry.push(event)
    });
  assert.equal(dom.projects[0].project_id, "g-p-resolved");
  assert.equal(dom.projects[1].project_id, undefined);
  assert.equal(dom.unresolved_count, 1);
  assert.equal(domTelemetry.some((event) =>
    event.stage === "collector_project_identity_navigation_wait"), false);

  document.location.href = rootHref;
  const navigationTelemetry = [];
  const navigation = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [catalog[1]],
    {
      identityMode: "navigation",
      identityCatalog: catalog,
      navigationTimeoutMs: 500,
      onTelemetry: (event) => navigationTelemetry.push(event)
    });
  assert.equal(navigation.projects[0].project_id, "g-p-fallback");
  assert.equal(navigation.projects[0].identity_source, "navigation_url");
  const classification = navigationTelemetry.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(classification.navigation_fallback_attempted, true);
  assert.equal(classification.navigation_fallback_success, true);
  assert.equal(classification.project_index, 20);
  assert.equal(navigationTelemetry.filter((event) =>
    event.stage === "collector_project_identity_navigation_wait"
    && event.navigation_detected === true).length >= 1, true);
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

class RemountingMoreSidebar extends FakeMetadataNode {
  constructor(document, names) {
    super(document, "NAV");
    this.attributes.set("aria-label", "チャット履歴");
    this.names = names;
    this.clickCount = 0;
    this.moreGeneration = 0;
    this.clientHeight = 400;
    this.scrollHeight = 400;
    this.scrollTop = 0;
    this.projectRows = names.map((name, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false",
        "aria-controls": `more-side-${index}`
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", name, { "data-marquee-text": "true" }));
      return row;
    });
    this.rebuildMore();
  }

  rebuildMore() {
    this.moreGeneration += 1;
    this.moreButton = new FakeMetadataNode(this.ownerDocument, "BUTTON", "さらに表示", {
      role: "button",
      "aria-controls": `more-remount-${this.moreGeneration}`
    });
    this.moreButton.click = () => {
      this.clickCount += 1;
      this.rebuildMore();
    };
  }

  querySelectorAll(selector) {
    if (selector.includes("data-sidebar-item")) return this.projectRows;
    if (selector === "button") return [this.moreButton];
    if (selector.includes('role="button"')) return [...this.projectRows, this.moreButton];
    if (selector.includes("data-marquee-text")) {
      return this.projectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "a[href]") return [];
    return [];
  }
}

class PaginatedMoreSidebar extends FakeMetadataNode {
  constructor(document, names, options = {}) {
    super(document, "NAV");
    this.attributes.set("aria-label", "チャット履歴");
    this.names = names;
    this.pageSizes = Array.isArray(options.pageSizes) && options.pageSizes.length > 0
      ? options.pageSizes
      : [10, 20, names.length];
    this.pageIndex = 0;
    this.clickCount = 0;
    this.moreGeneration = 0;
    this.remountMore = options.remountMore !== false;
    this.hideMoreAfterClickMs = Math.max(0, Number(options.hideMoreAfterClickMs) || 0);
    this.moreHidden = false;
    this.moreDisabled = false;
    this.disableAfterClick = options.disableAfterClick === true;
    this.infiniteNoProgress = options.infiniteNoProgress === true;
    this.clientHeight = 400;
    this.scrollHeight = 400;
    this.scrollTop = 0;
    this.rebuildRows();
    this.rebuildMore();
  }

  get loadedCount() {
    return Math.min(this.names.length, this.pageSizes[this.pageIndex] || this.names.length);
  }

  rebuildRows() {
    this.projectRows = this.names.slice(0, this.loadedCount).map((name, index) => {
      const row = new FakeMetadataNode(this.ownerDocument, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false",
        "aria-controls": `paged-side-${index}`
      });
      row.appendChild(new FakeMetadataNode(this.ownerDocument, "SPAN", name, {
        "data-marquee-text": "true"
      }));
      row.appendChild(new FakeMetadataNode(this.ownerDocument, "A", name, {
        href: `/g/g-p-paged-${index}/project`
      }));
      return row;
    });
  }

  rebuildMore() {
    this.moreGeneration += 1;
    this.moreButton = new FakeMetadataNode(this.ownerDocument, "BUTTON", "さらに表示", {
      role: "button",
      "aria-controls": "project-more"
    });
    this.moreButton.disabled = this.moreDisabled;
    if (this.moreDisabled) this.moreButton.attributes.set("aria-disabled", "true");
    this.moreButton.click = () => this.handleMoreClick();
  }

  handleMoreClick() {
    this.clickCount += 1;
    if (this.infiniteNoProgress) {
      if (this.remountMore) this.rebuildMore();
      return;
    }
    if (this.pageIndex + 1 < this.pageSizes.length) {
      this.pageIndex += 1;
      this.scrollHeight += 240;
      this.rebuildRows();
    }
    if (this.disableAfterClick) this.moreDisabled = true;
    if (this.hideMoreAfterClickMs > 0) {
      this.moreHidden = true;
      const show = () => {
        this.moreHidden = false;
        if (this.remountMore) this.rebuildMore();
      };
      if (typeof setTimeout === "function") setTimeout(show, this.hideMoreAfterClickMs);
      else show();
      return;
    }
    if (this.remountMore) this.rebuildMore();
  }

  get moreAvailable() {
    if (this.moreHidden) return false;
    if (this.infiniteNoProgress) return true;
    return this.loadedCount < this.names.length;
  }

  querySelectorAll(selector) {
    const more = this.moreAvailable ? [this.moreButton] : [];
    if (selector.includes("data-sidebar-item")) return [...this.projectRows, ...more];
    if (selector === "button") return more;
    if (selector.includes('role="button"')) return [...this.projectRows, ...more];
    if (selector.includes("data-marquee-text")) {
      return this.projectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    if (selector === "a[href]") {
      return this.projectRows.flatMap((row) => row.querySelectorAll(selector));
    }
    return [];
  }
}

class NestedChildChatSidebar extends FakeMetadataNode {
  constructor(document) {
    super(document, "NAV");
    this.attributes.set("aria-label", "チャット履歴");
    this.clientHeight = 400;
    this.scrollHeight = 400;
    this.scrollTop = 0;
    this.projectRow = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "true",
      "aria-controls": "nested-child-region"
    });
    this.projectRow.appendChild(new FakeMetadataNode(document, "SPAN", "Parent Project", {
      "data-marquee-text": "true"
    }));
    this.childChat = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true"
    });
    this.childChat.appendChild(new FakeMetadataNode(document, "SPAN", "Nested Chat", {
      "data-marquee-text": "true"
    }));
    this.projectRow.appendChild(this.childChat);
    this.appendChild(this.projectRow);
  }
}

test("28 unique Projects without remount stay 28 logical descriptors", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Logical Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 28 });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 4,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
  assert.equal(snapshot.descriptor_added_count, 28);
});

test("full Sidebar remount keeps 28 logical Projects instead of appending a second generation", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Remount Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
  assert.ok(
    snapshot.descriptor_remount_reconciled_count >= 1
    || snapshot.title_only_reconcile_rejected_count >= 1);
});

test("aria-controls regeneration does not create duplicate logical Projects", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Volatile Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 28 });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const first = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 2,
    initialSettleMs: 0
  });
  sidebar.remount();
  const second = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 2,
    initialSettleMs: 0
  });
  assert.equal(first.projects.length, 28);
  assert.equal(second.projects.length, 28);
  assert.notEqual(first.projects[0].discovery_key, second.projects[0].discovery_key);
});

test("same-title Projects visible only in separate snapshots are not title-merged", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Twin Project", "Twin Project"], {
    itemWindow: 1,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  assert.ok((snapshot.provisional_observations || []).length >= 1);
  assert.ok(snapshot.title_only_reconcile_rejected_count >= 1);
  assert.ok(snapshot.title_only_observation_preserved_count >= 1);
  assert.equal(snapshot.discovery_logical_project_count_final, 1);
  assert.equal(snapshot.descriptor_remount_reconciled_count, 0);
});

test("unique title without stable evidence is not reconciled by title", async () => {
  const href = "https://chatgpt.com/";
  const names = ["Solo Project"];
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 1,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  assert.ok(snapshot.title_only_reconcile_attempt_count >= 1);
  assert.ok(snapshot.title_only_reconcile_rejected_count >= 1);
  assert.ok((snapshot.provisional_observations || []).length >= 1);
  assert.equal(snapshot.projects.filter((project) => project.stable_locator_key).length, 0);
});

test("project_id match still reconciles across remount", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 4 }, (_, index) => `Id Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 4,
    remountOnScroll: true,
    projectIds: names.map((_, index) => `g-p-id-${index}`)
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 4);
  assert.equal(
    snapshot.projects.filter((project) => /^g-p-id-/.test(project.project_id || "")).length,
    4);
  assert.ok((snapshot.stable_evidence_reconcile_count || 0) >= 0);
  assert.ok((snapshot.hydration_snapshot_unchanged_count || 0)
    + (snapshot.stable_evidence_reconcile_count || 0) >= 1);
});

test("same-title Projects are not merged by title during remount", async () => {
  const href = "https://chatgpt.com/";
  const names = ["同じProject", "同じProject"];
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 2,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.projects.filter((project) => project.title === "同じProject").length, 2);
  assert.notEqual(snapshot.projects[0].discovery_key, snapshot.projects[1].discovery_key);
});

test("stable locator remount reconciles onto the existing descriptor", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Stable Locator ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    remountOnScroll: true,
    stableRowIds: names.map((_, index) => `stable-row-${index}`)
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 8);
  assert.equal(snapshot.projects.filter((project) => project.stable_locator_key).length, 8);
  assert.ok(snapshot.descriptor_updated_count >= 1 || snapshot.descriptor_added_count === 8);
});

test("ambiguous same-title remount does not invent extra descriptors", async () => {
  const href = "https://chatgpt.com/";
  const names = ["Ambiguous", "Ambiguous"];
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 2,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 2);
  assert.ok(snapshot.descriptor_ambiguous_reconcile_count >= 0);
});

test("remounted More control is not clicked again without growth", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Listed Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new RemountingMoreSidebar(document, names);
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    maxMoreClicks: 12,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(sidebar.clickCount, 1);
  assert.equal(snapshot.project_more_control_click_count, 1);
  assert.ok(snapshot.more_control_duplicate_suppressed_count >= 1);
  assert.equal(snapshot.more_control_logical_unique_count, 1);
  assert.ok(snapshot.more_click_no_progress_count >= 1);
  assert.equal(snapshot.hydration_stop_reason, "no_progress");
});

test("multi-page More keeps clicking the same logical control after progress", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Paged Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10, 20, 28],
    remountMore: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    maxMoreClicks: 8,
    initialSettleMs: 0,
    moreSettleMs: 40,
    moreQuietMs: 20
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
  assert.equal(sidebar.clickCount, 2);
  assert.equal(snapshot.project_more_control_click_count, 2);
  assert.ok(snapshot.more_click_progress_count >= 2);
  assert.ok(snapshot.more_reclick_allowed_count >= 1);
  assert.equal(snapshot.more_clickable_at_hydration_complete, false);
});

test("paginated More remount still reclicks after Project count increases", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Remount Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10, 20, 28],
    remountMore: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 4,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(sidebar.clickCount, 2);
  assert.ok(snapshot.more_reappeared_after_click_count >= 1);
});

test("same logical More with no progress is not clicked again", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 10 }, (_, index) => `Static Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10],
    remountMore: true,
    infiniteNoProgress: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    maxMoreClicks: 12,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.equal(snapshot.projects.length, 10);
  assert.equal(sidebar.clickCount, 1);
  assert.ok(snapshot.more_click_no_progress_count >= 1);
  assert.ok(snapshot.more_reclick_suppressed_count >= 1);
  assert.equal(snapshot.hydration_stop_reason, "no_progress");
  assert.equal(snapshot.hydration_completed_after_more_no_progress, true);
});

test("More disappearing after the last page completes hydration", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 20 }, (_, index) => `Final Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10, 20]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 4,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.equal(snapshot.projects.length, 20);
  assert.equal(sidebar.clickCount, 1);
  assert.equal(snapshot.more_visible_at_hydration_complete, false);
  assert.equal(snapshot.more_clickable_at_hydration_complete, false);
});

test("disabled More after a page load does not retry infinitely", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Disabled Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10, 20, 28],
    disableAfterClick: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    maxMoreClicks: 12,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.ok(sidebar.clickCount <= 2);
  assert.equal(snapshot.more_clickable_at_hydration_complete, false);
  assert.ok(["no_progress", "no_more_control", "scroll_exhausted"].includes(snapshot.hydration_stop_reason));
});

test("delayed More reappearance is clicked instead of completing early", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Delayed Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, {
    pageSizes: [10, 20, 28],
    hideMoreAfterClickMs: 20
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document, { setTimeout, clearTimeout });
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    moreSettleMs: 80,
    moreQuietMs: 20
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(sidebar.clickCount, 2);
});

test("More remount without catalog growth is not treated as pagination progress", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 20 }, (_, index) => `Remount Only ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new RemountingMoreSidebar(document, names);
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 4,
    maxMoreClicks: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 20);
  assert.equal(sidebar.clickCount, 1);
  assert.equal(snapshot.more_click_progress_count || 0, 0);
});

test("paginated More 28 Project catalog still resolves 28 identities", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Identity Page ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, { pageSizes: [10, 20, 28] });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.equal(discovered.projects.length, 28);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    discovered.projects.map((project, index) => ({
      ...project,
      project_index: index,
      discovery_index: index
    })),
    { identityMode: "dom" });
  assert.equal(identity.projects.filter((project) => project.project_id).length, 28);
});

test("20-project first More page does not complete while another page remains", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Early Stop ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new PaginatedMoreSidebar(document, names, { pageSizes: [10, 20, 28] });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    moreSettleMs: 40
  });
  assert.notEqual(snapshot.projects.length, 20);
  assert.equal(snapshot.projects.length, 28);
  assert.ok(sidebar.clickCount >= 2);
});

test("More click that regenerates the same Project rows does not duplicate the catalog", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Regenerated ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new RemountingMoreSidebar(document, names);
  sidebar.moreButton.click = () => {
    sidebar.clickCount += 1;
    sidebar.projectRows.forEach((row) => { row.isConnected = false; });
    sidebar.projectRows = names.map((name, index) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": "false",
        "aria-controls": `regen-${sidebar.clickCount}-${index}`
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", name, { "data-marquee-text": "true" }));
      return row;
    });
    sidebar.rebuildMore();
  };
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    maxMoreClicks: 12,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
});

test("nested child Chat rows are rejected as Project candidates", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new NestedChildChatSidebar(document);
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 2,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.projects[0].title, "Parent Project");
  assert.ok(snapshot.project_candidate_rejected_child_chat_count >= 1);
});

test("untitled non-Project rows increment the rejected non-project count", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new FakeMetadataNode(document, "NAV");
  sidebar.attributes.set("aria-label", "チャット履歴");
  sidebar.clientHeight = 400;
  sidebar.scrollHeight = 400;
  sidebar.scrollTop = 0;
  const blank = new FakeMetadataNode(document, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true"
  });
  const titled = new FakeMetadataNode(document, "DIV", "", {
    role: "button",
    "data-sidebar-item": "true"
  });
  titled.appendChild(new FakeMetadataNode(document, "SPAN", "Kept Project", {
    "data-marquee-text": "true"
  }));
  sidebar.appendChild(blank);
  sidebar.appendChild(titled);
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 2,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  assert.ok(snapshot.project_candidate_rejected_non_project_count >= 1);
});

test("repeated catalog rebuilds do not grow a 28 Project logical catalog", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Rebuild Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.ok(snapshot.root_catalog_build_count >= 2);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
});

test("a genuinely new Project is appended once", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 27 }, (_, index) => `Growing Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 28,
    nestedScroll: true
  });
  let added = false;
  Object.defineProperty(sidebar.scrollport, "scrollTop", {
    configurable: true,
    get: () => sidebar.scrollport._scrollTop,
    set: (value) => {
      sidebar.scrollport._scrollTop = Number(value) || 0;
      sidebar.scrollHistory.push(sidebar.scrollport._scrollTop);
      if (!added) {
        added = true;
        sidebar.projectNames = [...sidebar.projectNames, "Growing Project 27"];
        sidebar.rebuildRows();
      }
    }
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.projects.filter((project) => project.title === "Growing Project 27").length, 1);
});

test("a hidden Project keeps its stale descriptor instead of collapsing the catalog", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Stale Project ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 28,
    nestedScroll: true
  });
  const originalQuery = sidebar.querySelectorAll.bind(sidebar);
  sidebar.querySelectorAll = (selector) => {
    const rows = originalQuery(selector);
    if (selector.includes("data-sidebar-item") && sidebar.scrollHistory.length >= 1) {
      return rows.slice(0, 27);
    }
    return rows;
  };
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
});

function identityTargetsFromSnapshot(snapshot) {
  return [
    ...(snapshot.projects || []).map((project) => ({ ...project, observation_role: "confirmed" })),
    ...(snapshot.provisional_observations || []).map((project) => ({
      ...project,
      observation_role: "provisional"
    }))
  ];
}

test("same-title virtualized Projects stay distinct after identity", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Test", "Test"], {
    itemWindow: 1,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(discovered.projects.length, 1);
  assert.ok((discovered.provisional_observations || []).length >= 1);
  const targets = [
    {
      ...discovered.projects[0],
      observation_role: "confirmed",
      project_id: "g-p-test-a",
      url: "https://chatgpt.com/g/g-p-test-a/project"
    },
    {
      ...discovered.provisional_observations[0],
      observation_role: "provisional",
      occupancy_source_index: 0,
      project_id: "g-p-test-b",
      url: "https://chatgpt.com/g/g-p-test-b/project"
    }
  ];
  const finalized = locators.finalizeProvisionalProjectObservations(targets);
  assert.equal(finalized.projects.length, 2);
  const ids = new Set(finalized.projects.map((project) => project.project_id));
  assert.equal(ids.size, 2);
  assert.ok(ids.has("g-p-test-a"));
  assert.ok(ids.has("g-p-test-b"));
  assert.ok(finalized.sameTitleIdentityDistinctProjectCount >= 1);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 0);
  assert.equal(finalized.provisionalObservationPromotedNewProjectCount, 1);
});

test("same-title remount observations collapse after matching Stable IDs", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Test"], {
    itemWindow: 1,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(discovered.projects.length, 1);
  assert.ok((discovered.provisional_observations || []).length >= 1);
  const targets = [
    {
      ...discovered.projects[0],
      observation_role: "confirmed",
      project_id: "g-p-test-same",
      url: "https://chatgpt.com/g/g-p-test-same/project"
    },
    ...discovered.provisional_observations.map((project) => ({
      ...project,
      observation_role: "provisional",
      occupancy_source_index: 0,
      project_id: "g-p-test-same",
      url: "https://chatgpt.com/g/g-p-test-same/project"
    }))
  ];
  const finalized = locators.finalizeProvisionalProjectObservations(targets);
  assert.equal(finalized.projects.length, 1);
  assert.equal(finalized.projects[0].project_id, "g-p-test-same");
  assert.ok(
    finalized.provisionalObservationMergedExistingCount >= 1
    || finalized.sameTitleIdentitySameProjectCount >= 1
    || finalized.provisionalObservationPromotedNewProjectCount >= 1);
});

test("same-title provisional stays unresolved without identity evidence", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Test", "Test"], {
    itemWindow: 1,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  const targets = identityTargetsFromSnapshot(discovered);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    targets,
    { identityMode: "dom", identityCatalog: targets });
  const finalized = locators.finalizeProvisionalProjectObservations(identity.projects);
  assert.equal(discovered.projects.length, 1);
  assert.ok(finalized.provisionalObservationUnresolvedCount >= 1);
  assert.equal(finalized.projects.filter((project) => project.project_id).length, 0);
  assert.ok(finalized.projects.length <= 1);
  assert.ok(finalized.incompleteDueToUnresolvedProvisionalCount >= 1);
});

test("same-title occupancy sibling without Stable ID stays unresolved", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "occ-a",
      project_id: "g-p-alpha",
      url: "https://chatgpt.com/g/g-p-alpha/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "occ-b"
    }
  ]);
  assert.equal(finalized.projects.length, 1);
  assert.equal(finalized.projects[0].project_id, "g-p-alpha");
  assert.equal(finalized.provisionalObservationUnresolvedCount, 1);
  assert.equal(finalized.provisionalUnresolvedKeptCount, 1);
  assert.equal(finalized.provisionalUnresolvedDiscardedAsProvenDuplicateCount, 0);
  assert.ok(finalized.provisionalUnresolvedDiscardRejectedCount >= 1);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 1);
});

test("same-title observations with the same Stable ID merge to one project", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "same-a",
      project_id: "g-p-shared",
      url: "https://chatgpt.com/g/g-p-shared/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "same-b",
      project_id: "g-p-shared",
      url: "https://chatgpt.com/g/g-p-shared/project"
    }
  ]);
  assert.equal(finalized.projects.length, 1);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 0);
  assert.equal(finalized.provisionalResolvedSameExistingCount, 1);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 0);
});

test("same-title observations with distinct Stable IDs promote two projects", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "confirmed",
      discovery_key: "distinct-a",
      project_id: "g-p-left",
      url: "https://chatgpt.com/g/g-p-left/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "distinct-b",
      project_id: "g-p-right",
      url: "https://chatgpt.com/g/g-p-right/project"
    }
  ]);
  assert.equal(finalized.projects.length, 2);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 0);
  assert.equal(finalized.provisionalResolvedDistinctProjectCount, 1);
  assert.ok(finalized.sameTitleIdentityDistinctProjectCount >= 1);
});

test("unresolved provisional with matching stable_locator_key is a proven duplicate", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "confirmed",
      discovery_key: "loc-a",
      stable_locator_key: "stable-row-shared",
      project_id: "g-p-locator",
      url: "https://chatgpt.com/g/g-p-locator/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "loc-b",
      stable_locator_key: "stable-row-shared"
    }
  ]);
  assert.equal(finalized.projects.length, 1);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 0);
  assert.equal(finalized.provisionalUnresolvedDiscardedAsProvenDuplicateCount, 1);
  assert.equal(finalized.provisionalDuplicateProofStableLocatorCount, 1);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 0);
});

test("title and occupancy alone do not prove a stale remount duplicate", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "confirmed",
      occupancy_source_index: 0,
      discovery_key: "weak-a",
      project_id: "g-p-weak",
      url: "https://chatgpt.com/g/g-p-weak/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "weak-b"
    }
  ]);
  assert.equal(finalized.provisionalUnresolvedKeptCount, 1);
  assert.equal(finalized.provisionalUnresolvedDiscardedAsProvenDuplicateCount, 0);
  assert.ok(finalized.provisionalUnresolvedDiscardRejectedCount >= 1);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 1);
});

test("disconnected remount without stable evidence stays unresolved", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "disc-new",
      project_id: "g-p-disc",
      url: "https://chatgpt.com/g/g-p-disc/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      occupancy_source_index: 0,
      discovery_key: "disc-old",
      disconnected: true
    }
  ]);
  assert.equal(finalized.provisionalUnresolvedKeptCount, 1);
  assert.equal(finalized.provisionalUnresolvedDiscardedAsProvenDuplicateCount, 0);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 1);
});

test("matching snapshot generation alone does not prove a duplicate", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Test",
      observation_role: "provisional",
      snapshot_generation: 2,
      discovery_key: "snap-a",
      project_id: "g-p-snap",
      url: "https://chatgpt.com/g/g-p-snap/project"
    },
    {
      title: "Test",
      observation_role: "provisional",
      snapshot_generation: 2,
      discovery_key: "snap-b"
    }
  ]);
  assert.equal(finalized.provisionalUnresolvedKeptCount, 1);
  assert.equal(finalized.provisionalUnresolvedDiscardedAsProvenDuplicateCount, 0);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 1);
});

test("28 unique remount catalog does not grow to 33", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Remount Catalog ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.notEqual(snapshot.projects.length, 33);
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  assert.equal(snapshot.projects.length, 28);
  assert.ok(prepared.identityCatalog.length >= 28);
});

test("provisional observations reuse the same discovery key instead of duplicating", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Solo Project"], {
    itemWindow: 1,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  const created = snapshot.provisional_observation_created_count || 0;
  const pending = snapshot.provisional_observations || [];
  assert.ok(created >= 1);
  assert.equal(pending.length, created);
  const keys = pending.map((item) => item.discovery_key);
  assert.equal(new Set(keys).size, keys.length);
});

test("root hydration stops after consecutive logical stagnation even when scrollHeight jitters", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Hydration ${index}`);
  const ids = names.map((_, index) => `g-p-hydration-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 28,
    projectIds: ids,
    nestedScroll: true,
    maxPositionChanges: 4,
    jitterHeightOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 128,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.sidebar_scroll_position_change_count, 4);
  assert.ok(snapshot.sidebar_scroll_stagnation_count < 10);
  assert.ok(snapshot.sidebar_scroll_attempt_count < 12);
  assert.ok(snapshot.descriptor_updated_count < 200);
  assert.ok(snapshot.hydration_consecutive_stagnation_max >= 2);
  assert.ok(snapshot.hydration_stagnation_break_count >= 1);
  assert.equal(snapshot.hydration_stop_reason, "stagnation");
});

test("same catalog reconcile is not hydration progress", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Static ${index}`);
  const ids = names.map((_, index) => `g-p-static-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    projectIds: ids,
    nestedScroll: true,
    remountOnScroll: true,
    maxPositionChanges: 2,
    jitterHeightOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 128,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.projects.length, 8);
  assert.ok(snapshot.hydration_same_logical_state_count >= 1);
  assert.ok(snapshot.sidebar_scroll_attempt_count < 10);
  assert.ok(snapshot.descriptor_updated_count < 80);
});

test("scrollHeight growth is hydration progress", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 6 }, (_, index) => `Grow ${index}`);
  const ids = names.map((_, index) => `g-p-grow-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 6,
    projectIds: ids,
    nestedScroll: true,
    growHeightOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.projects.length, 6);
  assert.ok(snapshot.hydration_progress_scroll_height_increase >= 1);
  assert.ok(snapshot.hydration_stagnation_reset_reason_counts.scroll_height >= 1);
});

test("virtualized 28 Project sidebar still discovers 28 after early stagnation is avoided", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Virt ${index}`);
  const ids = names.map((_, index) => `g-p-virt-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    projectIds: ids,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 128,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
});

test("28 Project remount discovery still resolves 28 identities", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Identity Remount ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  names.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `identity-remount-${index}`,
      `g-p-identity-remount-${index}`,
      1);
  });
  const locators = loadLocators(document);
  const discovered = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 4,
    initialSettleMs: 0
  });
  assert.equal(discovered.projects.length, 28);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    discovered.projects.map((project, index) => ({
      ...project,
      project_index: index,
      discovery_index: index
    })),
    { identityMode: "dom", identityCatalog: discovered.projects });
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 28);
});

test("hydration loops while document is hidden increment the hidden counter", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 6 }, (_, index) => `Hidden ${index}`);
  const ids = names.map((_, index) => `g-p-hidden-${index}`);
  const document = new FakeMetadataDocument(href, null);
  document.hidden = true;
  document.visibilityState = "hidden";
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 6,
    projectIds: ids,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.document_visibility_state_at_collection_start, "hidden");
  assert.ok(snapshot.hydration_loops_while_document_hidden >= 1);
  assert.equal(snapshot.hydration_loops_while_document_visible, 0);
});

test("hydration loops while document is visible increment the visible counter", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 6 }, (_, index) => `Visible ${index}`);
  const ids = names.map((_, index) => `g-p-visible-${index}`);
  const document = new FakeMetadataDocument(href, null);
  document.hidden = false;
  document.visibilityState = "visible";
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 6,
    projectIds: ids,
    nestedScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0,
    settleMs: 0
  });
  assert.equal(snapshot.document_visibility_state_at_collection_start, "visible");
  assert.ok(snapshot.hydration_loops_while_document_visible >= 1);
  assert.equal(snapshot.hydration_loops_while_document_hidden, 0);
});

function identityCatalogFromSidebar(sidebar, titlePrefix = "Project") {
  return sidebar.projectRows.map((row, index) => ({
    project_index: index,
    discovery_index: index,
    title: row.textContent || `${titlePrefix} ${index}`,
    discovery_key: `identity-${index}`
  }));
}

function attachSiblingChildChats(document, row, projectId, count, mixedIds = null) {
  const parent = row.parentElement || document.sidebar;
  if (!row.parentElement) parent.appendChild(row);
  row.attributes.set("aria-expanded", "true");
  row.attributes.set("aria-controls", `missing-${projectId}`);
  const region = new FakeMetadataNode(document, "DIV", "", { role: "list" });
  const ids = mixedIds || Array.from({ length: count }, () => projectId);
  ids.forEach((id, index) => {
    region.appendChild(new FakeMetadataNode(document, "A", `Chat ${index}`, {
      href: `/g/${id}/c/${id}-chat-${index}`
    }));
  });
  parent.appendChild(region);
  const children = parent.children;
  const rowIndex = children.indexOf(row);
  const regionIndex = children.indexOf(region);
  if (rowIndex >= 0 && regionIndex !== rowIndex + 1) {
    children.splice(regionIndex, 1);
    children.splice(rowIndex + 1, 0, region);
  }
  return region;
}

function summaryEvent(events) {
  return events.find((event) => event.stage === "collector_project_identity_performance_summary");
}

function phaseEvent(events) {
  return events.find((event) => event.stage === "collector_project_identity_phase_performance_summary");
}

function incrementalIdentityFixture(count = 2, stable = true, globals = {}) {
  const document = new FakeMetadataDocument("https://chatgpt.com/", null);
  const names = Array.from({ length: count }, () => "Same title");
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = count;
  document.sidebar = sidebar;
  const locators = loadLocators(document, globals);
  let clicks = 0;
  let regions = [];
  const collapse = (ids = names.map((_, index) => `g-p-reuse-${index}`)) => {
    regions = sidebar.projectRows.map((row, index) => {
      if (stable && !row.attributes.has("data-sidebar-item-id")) {
        row.attributes.set("data-sidebar-item-id", `durable-row-${index}`);
      }
      const region = attachCollapsedDisclosure(document, row, `reuse-region-${index}`, ids[index]);
      const click = row.click;
      row.click = () => { clicks += 1; click(); };
      return region;
    });
  };
  collapse();
  const catalog = () => locators.collectChatGptContext(document, document.location.href).projects
    .map((project, index) => ({ ...project, project_index: index, discovery_index: index }));
  const run = async (projects = catalog()) => {
    const events = [];
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document, document.location.href, projects,
      { identityMode: "dom", identityCatalog: projects, onTelemetry: (event) => events.push(event) });
    return { result, phase: phaseEvent(events) };
  };
  return { document, sidebar, locators, collapse, catalog, run,
    get clicks() { return clicks; }, get regions() { return regions; } };
}

test("incremental identity keeps 28 same-title Projects distinct and skips all warm disclosures", async () => {
  const fixture = incrementalIdentityFixture(28);
  assert.equal(fixture.catalog().length, 28);
  const cold = await fixture.run();
  assert.equal(cold.result.unresolved_count, 0);
  assert.equal(cold.phase.incremental_reuse_learned_count, 28);
  assert.equal(fixture.clicks, 28);
  fixture.collapse();
  const warm = await fixture.run();
  assert.equal(warm.result.projects.length, 28);
  assert.equal(warm.result.non_navigation_resolved_count, 28);
  assert.equal(warm.result.navigation_resolved_count, 0);
  assert.equal(warm.result.unresolved_count, 0);
  assert.equal(new Set(warm.result.projects.map((item) => item.project_id)).size, 28);
  assert.equal(warm.phase.incremental_reuse_hit_count, 28);
  assert.equal(warm.phase.disclosure_required_count, 0);
  assert.equal(fixture.clicks, 28);
});

test("incremental identity refuses volatile-only evidence across refresh", async () => {
  const fixture = incrementalIdentityFixture(1, false);
  await fixture.run();
  fixture.collapse(["g-p-replacement"]);
  const warm = await fixture.run();
  assert.equal(warm.phase.incremental_reuse_hit_count, 0);
  assert.equal(warm.phase.incremental_reuse_no_proof_count, 1);
  assert.equal(warm.result.projects[0].project_id, "g-p-replacement");
  assert.equal(fixture.clicks, 2);
});

test("incremental identity rehydrates recycled or remounted rows and provisional observations", async () => {
  for (const change of ["attribute", "remount", "provisional", "fingerprint", "sidebar", "document"]) {
    const fixture = incrementalIdentityFixture(1);
    await fixture.run();
    if (change === "attribute") fixture.sidebar.projectRows[0].attributes.set("data-sidebar-item-id", "changed-durable-row");
    if (change === "remount") {
      const old = fixture.sidebar.projectRows[0];
      old.isConnected = false;
      const replacement = new FakeSidebar(fixture.document, ["Same title"], [], null, null, []).projectRows[0];
      fixture.sidebar.projectRows[0] = replacement;
    }
    if (change === "sidebar") {
      const replacement = new FakeSidebar(fixture.document, [], [], null, null, []);
      replacement.projectRows = fixture.sidebar.projectRows;
      fixture.document.sidebar = replacement;
    }
    fixture.collapse(["g-p-replacement"]);
    let catalog = fixture.catalog();
    if (change === "provisional") catalog[0].observation_role = "provisional";
    if (change === "fingerprint") catalog[0].stable_locator_key = "stable-mismatch";
    if (change === "document") {
      const doc = new FakeMetadataDocument("https://chatgpt.com/", null);
      doc.sidebar = fixture.sidebar;
      const result = await fixture.locators.resolveChatGptProjectIdentitiesAsync(
        doc, doc.location.href, catalog, { identityMode: "dom", identityCatalog: catalog });
      assert.notEqual(result.projects[0].identity_source, "incremental_cache");
      continue;
    }
    const warm = await fixture.run(catalog);
    assert.equal(warm.phase.incremental_reuse_hit_count, 0, change);
    assert.notEqual(warm.result.projects[0].project_id, "g-p-reuse-0", change);
  }
});

test("incremental identity rejects conflicting current evidence and learns its replacement", async () => {
  const fixture = incrementalIdentityFixture(1);
  await fixture.run();
  fixture.collapse(["g-p-replacement"]);
  const catalog = fixture.catalog();
  fixture.sidebar.projectRows[0].click();
  const changed = await fixture.run(catalog);
  assert.equal(changed.result.projects[0].project_id, "g-p-replacement");
  assert.equal(changed.phase.incremental_reuse_hit_count, 0);
  assert.equal(changed.phase.incremental_reuse_rejected_count, 1);
  fixture.collapse(["g-p-replacement"]);
  const warm = await fixture.run();
  assert.equal(warm.phase.incremental_reuse_hit_count, 0);
  assert.equal(warm.result.projects[0].project_id, "g-p-replacement");
  fixture.collapse(["g-p-replacement"]);
  assert.equal((await fixture.run()).phase.incremental_reuse_hit_count, 1);
});

test("incremental identity cannot mask an ambiguous child region", async () => {
  const fixture = incrementalIdentityFixture(1);
  await fixture.run();
  fixture.collapse();
  const catalog = fixture.catalog();
  attachExclusiveChildChats(fixture.document, fixture.sidebar.projectRows[0], "reuse-region-0", null, 2,
    ["g-p-reuse-0", "g-p-other"]);
  const warm = await fixture.run(catalog);
  assert.equal(warm.phase.incremental_reuse_hit_count, 0);
  assert.equal(warm.phase.incremental_reuse_rejected_count, 1);
  assert.equal(warm.result.unresolved_count, 1);
});

test("incremental identity expires from last DOM proof, not from last reuse", async () => {
  let now = 0;
  const fixture = incrementalIdentityFixture(1, true, { Date: { now: () => now } });
  await fixture.run();
  now = 4 * 60 * 1000;
  fixture.collapse();
  assert.equal((await fixture.run()).phase.incremental_reuse_hit_count, 1);
  now = 5 * 60 * 1000 + 1;
  fixture.collapse(["g-p-expired-replacement"]);
  const expired = await fixture.run();
  assert.equal(expired.phase.incremental_reuse_hit_count, 0);
  assert.equal(expired.phase.incremental_reuse_rejected_count, 1);
  assert.equal(expired.result.projects[0].project_id, "g-p-expired-replacement");
});

test("incremental identity only hydrates changed rows in a mixed refresh", async () => {
  const fixture = incrementalIdentityFixture(3);
  await fixture.run();
  fixture.sidebar.projectRows[1].attributes.set("data-sidebar-item-id", "new-project-key");
  fixture.collapse(["g-p-reuse-0", "g-p-new-project", "g-p-reuse-2"]);
  const mixed = await fixture.run();
  assert.equal(mixed.phase.incremental_reuse_hit_count, 2);
  assert.equal(mixed.phase.disclosure_required_count, 1);
  assert.equal(mixed.result.projects.length, 3);
  assert.equal(mixed.result.unresolved_count, 0);
  assert.deepEqual(Array.from(mixed.result.projects, (item) => item.project_id),
    ["g-p-reuse-0", "g-p-new-project", "g-p-reuse-2"]);
});

test("incremental identity refuses duplicate locator claims without dropping descriptors", async () => {
  const fixture = incrementalIdentityFixture(2);
  await fixture.run();
  fixture.collapse();
  const catalog = fixture.catalog();
  catalog[1].stable_locator_key = catalog[0].stable_locator_key;
  const duplicate = await fixture.run(catalog);
  assert.equal(duplicate.phase.incremental_reuse_hit_count, 0);
  assert.equal(duplicate.result.projects.length, 2);
});

test("incremental identity invalidates a cache even when Root already resolved the replacement", async () => {
  const fixture = incrementalIdentityFixture(1);
  await fixture.run();
  fixture.collapse(["g-p-new-root-id"]);
  fixture.sidebar.projectRows[0].click();
  const direct = await fixture.run();
  assert.equal(direct.result.projects[0].project_id, "g-p-new-root-id");
  assert.equal(direct.phase.incremental_reuse_rejected_count, 1);
  fixture.collapse(["g-p-new-root-id"]);
  const next = await fixture.run();
  assert.equal(next.phase.incremental_reuse_hit_count, 0);
  assert.equal(next.result.projects[0].project_id, "g-p-new-root-id");
});

test("incremental identity does not learn a row whose durable key changes during disclosure", async () => {
  const fixture = incrementalIdentityFixture(1);
  const row = fixture.sidebar.projectRows[0];
  const click = row.click;
  row.click = () => { row.attributes.set("data-sidebar-item-id", "changed-during-hydration"); click(); };
  const first = await fixture.run();
  assert.equal(first.phase.incremental_reuse_learned_count, 0);
  fixture.collapse(["g-p-new-binding"]);
  const next = await fixture.run();
  assert.equal(next.phase.incremental_reuse_hit_count, 0);
  assert.equal(next.result.projects[0].project_id, "g-p-new-binding");
});

test("child region identity early-successes from immediate exclusive Chat hrefs", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = ["Alpha", "Beta", "Gamma"];
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 3;
  document.sidebar = sidebar;
  names.forEach((_, index) => sidebar.appendChild(sidebar.projectRows[index]));
  attachExclusiveChildChats(document, sidebar.projectRows[0], "imm-0", "g-p-imm-0", 1);
  attachExclusiveChildChats(document, sidebar.projectRows[1], "imm-1", "g-p-imm-1", 3);
  attachExclusiveChildChats(document, sidebar.projectRows[2], "imm-2", "g-p-imm-2", 1);
  const events = [];
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  const summary = summaryEvent(events);
  assert.equal(result.unresolved_count, 0);
  assert.deepEqual(result.projects.map((project) => project.project_id), [
    "g-p-imm-0",
    "g-p-imm-1",
    "g-p-imm-2"
  ]);
  assert.equal(summary.child_region_immediate_hit_count, 3);
  assert.equal(summary.child_region_timeout_count, 0);
  assert.ok(summary.child_region_wait_total_ms < 50);
  assert.ok(summary.child_region_early_success_count >= 3);
});

test("empty child region waits and sibling Chat hrefs resolve without aria-controls region", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Empty", "Sibling"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  sidebar.projectRows.forEach((row) => sidebar.appendChild(row));
  const emptyRow = sidebar.projectRows[0];
  emptyRow.attributes.set("aria-controls", "empty-region");
  emptyRow.attributes.set("aria-expanded", "true");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", { id: "empty-region" }));
  attachSiblingChildChats(document, sidebar.projectRows[1], "g-p-sibling", 1);
  const events = [];
  const locators = loadLocators(document, { setTimeout, clearTimeout });
  const startedAt = Date.now();
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    {
      identityMode: "dom",
      navigationTimeoutMs: 250,
      onTelemetry: (event) => events.push(event)
    });
  const elapsed = Date.now() - startedAt;
  const summary = summaryEvent(events);
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[1].project_id, "g-p-sibling");
  assert.equal(summary.child_region_candidate_zero_count, 1);
  assert.equal(summary.child_region_timeout_count, 1);
  assert.ok(summary.child_region_wait_max_ms >= 200);
  assert.ok(elapsed < 1500);
});

test("distinct Stable IDs in one child region stay incomplete", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Collision"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  attachExclusiveChildChats(
    document,
    sidebar.projectRows[0],
    "collision",
    "g-p-collision",
    2,
    ["g-p-one", "g-p-two"]);
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    { identityMode: "dom", navigationTimeoutMs: 250 });
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.unresolved_count, 1);
});

test("delayed child region mount uses observer then exits", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Late"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "late-region");
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "late-region" });
  document.registerElementById(region);
  document.defaultView = {
    innerWidth: 1024,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  };
  FakeMutationObserver.instances.length = 0;
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const events = [];
  const pending = locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    {
      identityMode: "dom",
      navigationTimeoutMs: 800,
      onTelemetry: (event) => events.push(event)
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
    href: "/g/g-p-late/c/g-p-late-chat"
  }));
  FakeMutationObserver.instances.at(-1)?.emit([{ type: "childList" }]);
  const result = await pending;
  const summary = summaryEvent(events);
  assert.equal(result.projects[0].project_id, "g-p-late");
  assert.ok(summary.child_region_observer_needed_count >= 1);
  assert.ok(summary.child_region_wait_total_ms < 800);
});

test("stale remounted disclosure row is not reused for identity", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Remount"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const stale = sidebar.projectRows[0];
  attachExclusiveChildChats(document, stale, "stale-region", "g-p-stale", 1);
  stale.isConnected = false;
  const fresh = new FakeMetadataNode(document, "DIV", "Remount", {
    role: "button",
    "data-sidebar-item": "true",
    "aria-expanded": "true"
  });
  fresh.appendChild(new FakeMetadataNode(document, "SPAN", "Remount", { "data-marquee-text": "true" }));
  attachExclusiveChildChats(document, fresh, "fresh-region", "g-p-fresh", 1);
  sidebar.projectRows[0] = fresh;
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Remount", discovery_key: "remount-0" }],
    { identityMode: "dom" });
  assert.equal(result.projects[0].project_id, "g-p-fresh");
});

test("unrelated Sidebar mutations and nested other-Project chats are ignored", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Keep", "Other"], [], null, null, []);
  sidebar.itemWindow = 2;
  document.sidebar = sidebar;
  sidebar.projectRows.forEach((row) => sidebar.appendChild(row));
  attachExclusiveChildChats(document, sidebar.projectRows[0], "keep", "g-p-keep", 1);
  attachExclusiveChildChats(document, sidebar.projectRows[1], "other", "g-p-other", 1);
  const events = [];
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  assert.deepEqual(result.projects.map((project) => project.project_id), ["g-p-keep", "g-p-other"]);
  assert.equal(summaryEvent(events).child_region_distinct_id_collision_count, 0);
});

test("duplicate child Chat hrefs dedupe to one Stable ID", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Dupes"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "dupes", "g-p-dupe", 1);
  const region = document.getElementById("dupes");
  region.appendChild(new FakeMetadataNode(document, "A", "Chat copy", {
    href: "/g/g-p-dupe/c/g-p-dupe-chat-0"
  }));
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    { identityMode: "dom" });
  assert.equal(result.projects[0].project_id, "g-p-dupe");
  assert.equal(result.unresolved_count, 0);
});

test("27 immediate child-chat Projects do not accumulate multi-second waits", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 27 }, (_, index) => `Fast ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 27;
  document.sidebar = sidebar;
  names.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `fast-${index}`,
      `g-p-fast-${index}`,
      1);
  });
  const events = [];
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar, "Fast"),
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  const summary = summaryEvent(events);
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 27);
  assert.equal(summary.child_region_immediate_hit_count, 27);
  assert.equal(summary.child_region_timeout_count, 0);
  assert.ok(summary.child_region_wait_total_ms < 250, summary.child_region_wait_total_ms);
  assert.ok(summary.child_region_wait_average_ms < 20);
});

test("document hidden false keeps identity performance counters on the visible path", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  document.hidden = false;
  document.visibilityState = "visible";
  const sidebar = new FakeSidebar(document, ["Visible"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  attachExclusiveChildChats(document, sidebar.projectRows[0], "visible", "g-p-visible", 1);
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar),
    { identityMode: "dom" });
  assert.equal(result.identity_attempts_while_hidden, 0);
  assert.ok(result.identity_attempts_while_visible >= 1);
  assert.equal(result.projects[0].project_id, "g-p-visible");
});

test("disclosure hydration waits for a region and child mounted after the probe deadline", async () => {
  for (const regionDelay of [40, 280]) {
    const document = new FakeMetadataDocument("https://chatgpt.com/", null);
    const sidebar = new FakeSidebar(document, ["Delayed region"], [], null, null, []);
    document.sidebar = sidebar;
    const row = sidebar.projectRows[0];
    row.attributes.set("aria-controls", "async-region");
    const region = new FakeMetadataNode(document, "DIV", "", { id: "async-region" });
    let clicks = 0;
    const timers = [];
    row.click = () => {
      clicks += 1;
      row.attributes.set("aria-expanded", "true");
      timers.push(setTimeout(() => document.registerElementById(region), regionDelay));
      timers.push(setTimeout(() => region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
        href: "/g/g-p-async-region/c/chat"
      })), 330));
    };
    const locators = loadLocators(document, { setTimeout, clearTimeout });
    try {
      const result = await locators.resolveChatGptProjectIdentitiesAsync(
        document, document.location.href, identityCatalogFromSidebar(sidebar),
        { identityMode: "dom", disclosureTimeoutMs: 800, probeTimeoutMs: 100 });
      assert.equal(result.projects[0].project_id, "g-p-async-region", `region delay ${regionDelay}`);
      assert.equal(result.unresolved_count, 0);
      assert.equal(result.navigation_resolved_count, 0);
      assert.equal(clicks, 1);
    } finally { timers.forEach(clearTimeout); }
  }
});

test("disclosure hydration never replays a native click awaiting asynchronous DOM commit", async () => {
  const document = new FakeMetadataDocument("https://chatgpt.com/", null);
  const sidebar = new FakeSidebar(document, ["Async toggle"], [], null, null, []);
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "async-toggle");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "async-toggle" });
  document.registerElementById(region);
  let clicks = 0;
  let queuedExpanded = false;
  const timers = [];
  row.click = () => {
    clicks += 1;
    queuedExpanded = !queuedExpanded;
    timers.push(setTimeout(() => {
      row.attributes.set("aria-expanded", String(queuedExpanded));
      if (queuedExpanded && !region.children.length) region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
        href: "/g/g-p-async-toggle/c/chat"
      }));
    }, 30));
  };
  row.dispatchEvent = (event) => { if (event.type === "click") row.click(); };
  const locators = loadLocators(document, { setTimeout, clearTimeout });
  try {
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document, document.location.href, identityCatalogFromSidebar(sidebar),
      { identityMode: "dom", disclosureTimeoutMs: 500 });
    assert.equal(clicks, 1);
    assert.equal(result.projects[0].project_id, "g-p-async-toggle");
    assert.equal(result.unresolved_count, 0);
  } finally { timers.forEach(clearTimeout); }
});

test("28 Projects including 8 late-mounted tail regions resolve in one DOM pass", async () => {
  const document = new FakeMetadataDocument("https://chatgpt.com/", null);
  const names = Array.from({ length: 28 }, (_, index) => `Async Project ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  const clicks = Array(28).fill(0);
  const timers = [];
  for (let index = 0; index < 28; index += 1) {
    const row = sidebar.projectRows[index];
    const regionId = `async-tail-${index}`;
    row.attributes.set("aria-controls", regionId);
    row.click = () => {
      clicks[index] += 1;
      row.attributes.set("aria-expanded", "true");
      const mount = () => {
        const region = new FakeMetadataNode(document, "DIV", "", { id: regionId });
        region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
          href: `/g/g-p-async-tail-${index}/c/chat-${index}`
        }));
        document.registerElementById(region);
      };
      if (index < 20) mount();
      else timers.push(setTimeout(mount, 330));
    };
  }
  const locators = loadLocators(document, { setTimeout, clearTimeout });
  const root = locators.collectChatGptContext(document, document.location.href);
  const events = [];
  assert.equal(root.projects.length, 28);
  try {
    const result = await locators.resolveChatGptProjectIdentitiesAsync(
      document, document.location.href, root.projects,
      { identityMode: "dom", disclosureTimeoutMs: 1000, onTelemetry: (event) => events.push(event) });
    assert.equal(result.projects.length, 28);
    assert.equal(result.non_navigation_resolved_count, 28);
    assert.equal(result.unresolved_count, 0);
    assert.equal(result.navigation_resolved_count, 0);
    assert.equal(new Set(result.projects.map((item) => item.project_id)).size, 28);
    assert.equal(clicks.every((count) => count === 1), true);
    assert.equal(phaseEvent(events).incremental_reuse_hit_count, 0);
    assert.equal(summaryEvent(events).timeout_ceiling_hit_count, 0);
  } finally { timers.forEach(clearTimeout); }
});

test("disclosure hydration retains synthetic dispatch when native click is unavailable", async () => {
  const fixture = incrementalIdentityFixture(1, false);
  const row = fixture.sidebar.projectRows[0];
  const nativeClick = row.click;
  row.click = undefined;
  row.dispatchEvent = (event) => { if (event.type === "click") nativeClick(); };
  const resolved = await fixture.run();
  assert.equal(resolved.result.unresolved_count, 0);
  assert.equal(resolved.result.projects[0].project_id, "g-p-reuse-0");
});

test("disclosure hydration remains bounded when an expanded row never mounts a region", async () => {
  const fixture = incrementalIdentityFixture(1, false, { setTimeout, clearTimeout });
  fixture.document.elementsById.clear();
  fixture.sidebar.projectRows[0].click = () => {
    fixture.sidebar.projectRows[0].attributes.set("aria-expanded", "true");
  };
  const events = [];
  const result = await fixture.locators.resolveChatGptProjectIdentitiesAsync(
    fixture.document, fixture.document.location.href, fixture.catalog(),
    { identityMode: "dom", disclosureTimeoutMs: 250, onTelemetry: (event) => events.push(event) });
  assert.equal(result.unresolved_count, 1);
  assert.equal(summaryEvent(events).timeout_ceiling_hit_count, 1);
  assert.ok(summaryEvent(events).child_region_wait_total_ms < 1000);
});

test("explicit probe policy escalates empty disclosures before the 2500ms hydrate ceiling", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 8 }, (_, index) => `Tail ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 8;
  document.sidebar = sidebar;
  names.forEach((_, index) => {
    const row = sidebar.projectRows[index];
    row.attributes.set("aria-controls", `missing-tail-${index}`);
    row.attributes.set("aria-expanded", "false");
    row.click = () => { row.attributes.set("aria-expanded", "true"); };
  });
  const events = [];
  const locators = loadLocators(document);
  const catalog = names.map((title, index) => ({
    project_index: index + 20,
    discovery_index: index + 20,
    title,
    discovery_key: `tail-${index}`
  }));
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    {
      identityMode: "dom",
      childRegionWaitPolicy: "probe",
      disclosureTimeoutMs: 2500,
      onTelemetry: (event) => events.push(event)
    });
  const summary = summaryEvent(events);
  assert.equal(result.unresolved_count, 8);
  assert.ok(summary.early_escalation_count >= 8, summary.early_escalation_count);
  assert.ok(summary.child_region_wait_max_ms < 500, summary.child_region_wait_max_ms);
  assert.ok(summary.child_region_wait_total_ms < 2500, summary.child_region_wait_total_ms);
  assert.equal(summary.timeout_ceiling_hit_count, 0);
});

test("disconnected disclosure row escalates without the hydrate ceiling", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Gone"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "gone-region");
  row.attributes.set("aria-expanded", "true");
  row.isConnected = false;
  const events = [];
  const locators = loadLocators(document);
  await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Gone", discovery_key: "gone" }],
    {
      identityMode: "dom",
      disclosureTimeoutMs: 2500,
      onTelemetry: (event) => events.push(event)
    });
  const summary = summaryEvent(events);
  assert.ok(summary.child_region_wait_max_ms < 500, summary.child_region_wait_max_ms);
});

test("delayed empty-region child Chat still hydrates after 80ms", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Late"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "late-hydrate");
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "late-hydrate" });
  document.registerElementById(region);
  document.defaultView = {
    innerWidth: 1024,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  };
  FakeMutationObserver.instances.length = 0;
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const pending = locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Late", discovery_key: "late" }],
    { identityMode: "dom", disclosureTimeoutMs: 2500 });
  await new Promise((resolve) => setTimeout(resolve, 80));
  region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
    href: "/g/g-p-late-hydrate/c/chat-1"
  }));
  FakeMutationObserver.instances.at(-1)?.emit([{ type: "childList" }]);
  const result = await pending;
  assert.equal(result.projects[0].project_id, "g-p-late-hydrate");
});

test("delayed child Chat at 500ms still hydrates without shrinking the found-region budget", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Late Region"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "late-500");
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "late-500" });
  document.registerElementById(region);
  document.defaultView = {
    innerWidth: 1024,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  };
  FakeMutationObserver.instances.length = 0;
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const pending = locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Late Region", discovery_key: "late-500" }],
    { identityMode: "dom", disclosureTimeoutMs: 2500 });
  await new Promise((resolve) => setTimeout(resolve, 500));
  region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
    href: "/g/g-p-late-500/c/chat-1"
  }));
  FakeMutationObserver.instances.at(-1)?.emit([{ type: "childList" }]);
  const result = await pending;
  assert.equal(result.projects[0].project_id, "g-p-late-500");
});

test("explicit probe resolves 20 immediate identities and briefly checks 8 absent regions", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const immediateNames = Array.from({ length: 20 }, (_, index) => `Ready ${index}`);
  const tailNames = Array.from({ length: 8 }, (_, index) => `Tail ${index}`);
  const sidebar = new FakeSidebar(document, [...immediateNames, ...tailNames], [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  immediateNames.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `ready-${index}`,
      `g-p-ready-${index}`,
      1);
  });
  tailNames.forEach((_, index) => {
    const row = sidebar.projectRows[index + 20];
    row.attributes.set("aria-controls", `missing-combo-${index}`);
    row.attributes.set("aria-expanded", "false");
    row.click = () => { row.attributes.set("aria-expanded", "true"); };
  });
  const events = [];
  const locators = loadLocators(document);
  const catalog = [...immediateNames, ...tailNames].map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `combo-${index}`
  }));
  const startedAt = Date.now();
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    {
      identityMode: "dom",
      childRegionWaitPolicy: "probe",
      disclosureTimeoutMs: 2500,
      onTelemetry: (event) => events.push(event)
    });
  const elapsed = Date.now() - startedAt;
  const summary = summaryEvent(events);
  assert.equal(result.unresolved_count, 8);
  assert.equal(result.projects.filter((project) => project.project_id).length, 20);
  assert.ok(summary.early_escalation_count >= 8, summary.early_escalation_count);
  assert.ok(summary.child_region_wait_total_ms < 4000, summary.child_region_wait_total_ms);
  assert.ok(elapsed < 8000, elapsed);
  assert.equal(summary.timeout_ceiling_hit_count, 0);
});

test("navigation identity does not spend the 10s child-region ceiling after a verified URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Nav Project"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "nav-empty");
  row.attributes.set("aria-expanded", "false");
  document.registerElementById(new FakeMetadataNode(document, "DIV", "", { id: "nav-empty" }));
  const link = new FakeMetadataNode(document, "DIV", "Nav Project", { role: "link" });
  row.click = () => { row.attributes.set("aria-expanded", "true"); };
  link.click = () => {
    document.location.href = "https://chatgpt.com/g/g-p-nav-ok/project";
  };
  row.appendChild(link);
  const events = [];
  const locators = loadLocators(document);
  const startedAt = Date.now();
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 20, discovery_index: 20, title: "Nav Project", discovery_key: "nav-20" }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 10000,
      identityCatalog: [{ project_index: 20, discovery_index: 20, title: "Nav Project", discovery_key: "nav-20" }],
      onTelemetry: (event) => events.push(event)
    });
  const elapsed = Date.now() - startedAt;
  const classification = events.find((event) =>
    event.stage === "collector_project_identity_source_classification");
  assert.equal(result.projects[0].project_id, "g-p-nav-ok");
  assert.ok(elapsed < 1500, elapsed);
  assert.ok((classification?.identity_child_region_wait_ms || 0) < 1500,
    classification?.identity_child_region_wait_ms);
  assert.equal(events.some((event) => event.stage === "collector_project_identity_performance_summary"), false);
});

test("later DOM pass skips already resolved logical identities", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 7 }, (_, index) => `Remain ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 7;
  document.sidebar = sidebar;
  names.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `remain-${index}`,
      `g-p-remain-${index}`,
      1);
  });
  const catalog = [
    ...Array.from({ length: 21 }, (_, index) => ({
      project_index: index,
      discovery_index: index,
      title: `Resolved ${index}`,
      discovery_key: `resolved-${index}`,
      project_id: `g-p-resolved-${index}`,
      url: `https://chatgpt.com/g/g-p-resolved-${index}/project`
    })),
    ...names.map((title, index) => ({
      project_index: index + 21,
      discovery_index: index + 21,
      title,
      discovery_key: `remain-${index}`
    }))
  ];
  const events = [];
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    { identityMode: "dom", identityPassKind: "post_navigation", onTelemetry: (event) => events.push(event) });
  const summary = summaryEvent(events);
  assert.equal(result.unresolved_count, 0);
  assert.equal(summary.resolved_identity_skipped_count, 21);
  assert.equal(result.projects[20].project_id, "g-p-resolved-20");
  assert.equal(result.projects[21].project_id, "g-p-remain-0");
});

test("no_region_possible Project row click still resolves from a verified navigation URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["No Region"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "missing-no-region");
  row.attributes.set("aria-expanded", "false");
  row.click = () => {
    if (row.attributes.get("aria-expanded") !== "true") {
      row.attributes.set("aria-expanded", "true");
      return;
    }
    document.location.href = "https://chatgpt.com/g/g-p-no-region/project";
  };
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  const live = discovered.projects[0];
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{
      project_index: 22,
      discovery_index: 22,
      title: live.title,
      discovery_key: live.discovery_key,
      stable_locator_key: live.stable_locator_key
    }],
    {
      identityMode: "navigation",
      navigationTimeoutMs: 1000,
      identityCatalog: [{
        project_index: 22,
        discovery_index: 22,
        title: live.title,
        discovery_key: live.discovery_key,
        stable_locator_key: live.stable_locator_key
      }]
    });
  assert.equal(result.projects[0].project_id, "g-p-no-region");
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.projects[0].navigation_eligible, false);
});

test("virtualized and no_region_possible remain navigation eligible", () => {
  const locators = loadLocators(new FakeMetadataDocument("https://chatgpt.com/", null));
  assert.equal(locators.projectIdentityNavigationEligible("virtualized"), true);
  assert.equal(locators.projectIdentityNavigationEligible("no_region_possible"), true);
  assert.equal(locators.projectIdentityNavigationEligible("row_unavailable"), true);
  assert.equal(locators.projectIdentityNavigationEligible("project_disclosure_identity_not_found"), true);
  assert.equal(locators.projectIdentityNavigationEligible("project_row_not_visible"), true);
  assert.equal(locators.projectIdentityNavigationEligible("row_visibility_exhausted"), false);
  assert.equal(locators.projectIdentityNavigationEligible("project_row_fingerprint_mismatch"), false);
});

test("ambiguous identity does not adopt a later navigation URL", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Ambiguous"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  attachExclusiveChildChats(
    document,
    row,
    "amb-region",
    "g-p-amb-a",
    2,
    ["g-p-amb-a", "g-p-amb-b"]);
  row.click = () => {
    document.location.href = "https://chatgpt.com/g/g-p-amb-nav/project";
  };
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Ambiguous", discovery_key: "amb-0" }],
    { identityMode: "navigation", navigationTimeoutMs: 250 });
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "ambiguous_project_identity");
  assert.equal(result.projects[0].navigation_eligible, false);
});

test("tail remount with shared stable_locator_key stays one logical Project", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Locator Remount ${index}`);
  const stableRowIds = names.map((_, index) => `stable-row-id-${String(index).padStart(2, "0")}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    remountOnScroll: true,
    stableRowIds
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 28);
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  assert.equal(prepared.identityCatalog.length, 28);
  assert.equal(prepared.remainingProvisionalCount, 0);
});

test("project_id proof folds a remount provisional into the same existing Project", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [{
    title: "Alpha",
    discovery_key: "old-alpha",
    observation_role: "confirmed",
    project_id: "g-p-alpha"
  }];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Alpha",
    discovery_key: "new-alpha",
    observation_role: "provisional",
    project_id: "g-p-alpha"
  }]);
  assert.equal(prepared.identityCatalog.length, 1);
  assert.equal(prepared.provisionalSameProjectIdProofCount, 1);
  assert.equal(confirmed[0].discovery_key, "new-alpha");
});

test("stable_locator_key proof folds a remount provisional without project_id", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [{
    title: "Beta",
    discovery_key: "old-beta",
    stable_locator_key: "locator-beta",
    observation_role: "confirmed"
  }];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Beta",
    discovery_key: "new-beta",
    stable_locator_key: "locator-beta",
    observation_role: "provisional"
  }]);
  assert.equal(prepared.identityCatalog.length, 1);
  assert.equal(prepared.provisionalSameStableLocatorProofCount, 1);
  assert.equal(confirmed[0].discovery_key, "new-beta");
});

test("title-only provisional is not merged into a confirmed sibling", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [{
    title: "Test",
    discovery_key: "test-a",
    observation_role: "confirmed"
  }];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Test",
    discovery_key: "test-b",
    observation_role: "provisional",
    occupancy_source_index: 0
  }]);
  assert.equal(prepared.identityCatalog.length, 2);
  assert.equal(prepared.remainingProvisionalCount, 1);
});

test("index-only occupancy is not remount proof", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [
    { title: "One", discovery_key: "one", observation_role: "confirmed" },
    { title: "Two", discovery_key: "two", observation_role: "confirmed" }
  ];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Other",
    discovery_key: "other",
    observation_role: "provisional",
    occupancy_source_index: 1
  }]);
  assert.equal(prepared.identityCatalog.length, 3);
  assert.equal(prepared.remainingProvisionalCount, 1);
});

test("occupancy-only remount without predecessor key stays provisional", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [
    { title: "Head", discovery_key: "head", observation_role: "confirmed" },
    { title: "Tail", discovery_key: "tail-old", observation_role: "confirmed" }
  ];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Tail",
    discovery_key: "tail-new",
    observation_role: "provisional",
    occupancy_source_index: 1
  }]);
  assert.equal(prepared.identityCatalog.length, 3);
  assert.equal(prepared.remainingProvisionalCount, 1);
});

test("predecessor discovery key plus occupancy is not remount proof", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [
    { title: "Head", discovery_key: "head", observation_role: "confirmed" },
    { title: "Tail", discovery_key: "tail-old", observation_role: "confirmed" }
  ];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Tail",
    discovery_key: "tail-new",
    observation_role: "provisional",
    occupancy_source_index: 1,
    predecessor_discovery_key: "tail-old"
  }]);
  assert.equal(prepared.identityCatalog.length, 3);
  assert.equal(prepared.remainingProvisionalCount, 1);
  assert.equal(confirmed[1].discovery_key, "tail-old");
});

test("same-title distinct Stable IDs stay two Projects after identity prepare", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = [{
    title: "Test",
    discovery_key: "test-a",
    project_id: "g-p-left",
    observation_role: "confirmed"
  }];
  const prepared = locators.prepareIdentityProjectCatalog(confirmed, [{
    title: "Test",
    discovery_key: "test-b",
    project_id: "g-p-right",
    observation_role: "provisional"
  }]);
  assert.equal(prepared.identityCatalog.length, 2);
  const finalized = locators.finalizeProvisionalProjectObservations(prepared.identityCatalog);
  assert.equal(finalized.projects.length, 2);
});

test("unresolved provisional is not silently discarded", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const finalized = locators.finalizeProvisionalProjectObservations([
    {
      title: "Known",
      observation_role: "confirmed",
      discovery_key: "known",
      project_id: "g-p-known",
      url: "https://chatgpt.com/g/g-p-known/project"
    },
    {
      title: "Known",
      observation_role: "provisional",
      discovery_key: "unknown",
      occupancy_source_index: 0
    }
  ]);
  assert.equal(finalized.projects.length, 1);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 1);
  assert.equal(finalized.incompleteDueToUnresolvedProvisionalCount, 1);
});

test("current 28-plus-8 remount regression folds identity input to 28", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Regression ${index}`);
  const ids = names.map((_, index) => `g-p-regression-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 20,
    nestedScroll: true,
    remountOnScroll: true,
    projectIds: ids
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 32,
    initialSettleMs: 0
  });
  assert.equal(snapshot.discovery_logical_project_count_final, 28);
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  assert.equal(prepared.identityCatalog.length, 28);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    prepared.identityCatalog,
    { identityMode: "dom", identityCatalog: prepared.identityCatalog });
  const finalized = locators.finalizeProvisionalProjectObservations(identity.projects);
  assert.equal(finalized.projects.filter((project) => project.project_id).length, 28);
  assert.equal(finalized.provisionalObservationUnresolvedCount, 0);
  const uniqueIds = new Set(finalized.projects.map((project) => project.project_id).filter(Boolean));
  assert.equal(uniqueIds.size, 28);
});

test("orphan child-chat hrefs do not inflate confirmed Project catalog", () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Logical ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const conversations = names.slice(20).map((_, index) => {
    const logical = 20 + index;
    return new FakeMetadataNode(document, "A", `Chat of ${logical}`, {
      href: `/g/g-p-orphan-${logical}/c/c-orphan-${logical}`
    });
  });
  const sidebar = new FakeSidebar(document, names, conversations, null, null, []);
  sidebar.itemWindow = 28;
  sidebar.expanded = true;
  sidebar.clientHeight = 10000;
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = locators.collectChatGptContext(document, href);
  assert.equal(snapshot.projects.length, 28);
  assert.equal(snapshot.projects.filter((project) => project.project_id).length, 0);
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  assert.equal(prepared.identityCatalog.length, 28);
  assert.equal(prepared.remainingProvisionalCount, 0);
});

test("Identity compact folds tail remount observations with the same durable owner", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const confirmed = Array.from({ length: 28 }, (_, index) => ({
    title: `Logical ${index}`,
    discovery_key: `row-${index}`,
    stable_locator_key: index >= 20 ? `locator-${index}` : undefined,
    project_id: index < 20 ? `g-p-log-${index}` : undefined
  }));
  const remountTail = Array.from({ length: 8 }, (_, index) => ({
    title: `Logical ${20 + index}`,
    discovery_key: `remount-${20 + index}`,
    stable_locator_key: `locator-${20 + index}`,
    project_id: `g-p-log-${20 + index}`
  }));
  const prepared = locators.prepareIdentityProjectCatalog(
    [...confirmed, ...remountTail],
    []);
  assert.equal(prepared.rawConfirmedCountBeforeCompact, 36);
  assert.equal(prepared.identityCatalog.length, 28);
  assert.equal(prepared.identityDuplicateDescriptorCount, 8);
  assert.equal(prepared.duplicateSameStableLocatorCount, 8);
  assert.equal(prepared.remainingProvisionalCount, 0);
});

test("same project_id confirmed descriptors fold to one Identity input", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const prepared = locators.prepareIdentityProjectCatalog([
    { title: "Alpha", discovery_key: "alpha-row", project_id: "g-p-alpha" },
    { title: "Alpha chat", discovery_key: "alpha-chat", project_id: "g-p-alpha" }
  ], []);
  assert.equal(prepared.identityCatalog.length, 1);
  assert.equal(prepared.duplicateSameProjectIdCount, 1);
});

test("same current discovery_key folds only within the current mount", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const sameKey = locators.prepareIdentityProjectCatalog([
    { title: "Alpha", discovery_key: "same-mount" },
    { title: "Alpha", discovery_key: "same-mount" }
  ], []);
  assert.equal(sameKey.identityCatalog.length, 1);
  assert.equal(sameKey.duplicateSameCurrentDiscoveryKeyCount, 1);
  const remountKeys = locators.prepareIdentityProjectCatalog([
    { title: "Alpha", discovery_key: "mount-a" },
    { title: "Alpha", discovery_key: "mount-b" }
  ], []);
  assert.equal(remountKeys.identityCatalog.length, 2);
});

test("same-title occupancy without durable proof stays distinct for Identity", () => {
  const locators = loadLocators(new FakeDocument("https://chatgpt.com/"));
  const prepared = locators.prepareIdentityProjectCatalog([
    { title: "Same", discovery_key: "slot-a", occupancy_source_index: 0 }
  ], [
    { title: "Same", discovery_key: "slot-b", occupancy_source_index: 0 }
  ]);
  assert.equal(prepared.identityCatalog.length, 2);
  assert.equal(prepared.remainingProvisionalCount, 1);
});

test("unique catalog title does not click a Project row", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["Only Unique", "Other"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 2;
  sidebar.expanded = true;
  document.sidebar = sidebar;
  let rowClicks = 0;
  sidebar.projectRows[0].click = () => { rowClicks += 1; };
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{
      project_index: 0,
      discovery_index: 0,
      title: "Only Unique",
      discovery_key: "stale-unique"
    }],
    {
      identityMode: "navigation",
      identityCatalog: names.map((title, index) => ({
        project_index: index,
        discovery_index: index,
        title,
        discovery_key: `stale-${index}`
      })),
      navigationTimeoutMs: 250
    });
  assert.equal(rowClicks, 0);
  assert.equal(result.projects[0].project_id, undefined);
  assert.equal(result.projects[0].unresolved_reason, "project_row_fingerprint_mismatch");
});

test("stale descriptor still fails fingerprint relocation safety", async () => {
  const rootHref = "https://chatgpt.com/";
  const names = ["Safety Twin", "Safety Twin"];
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, { itemWindow: 8 });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const discovered = locators.collectChatGptContext(document, rootHref);
  sidebar.remount();
  const stale = {
    ...discovered.projects[0],
    project_index: 0,
    discovery_index: 0
  };
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [stale],
    {
      identityMode: "navigation",
      identityCatalog: discovered.projects.map((project, index) => ({
        ...project,
        project_index: index,
        discovery_index: index
      })),
      navigationTimeoutMs: 250
    });
  assert.equal(result.projects[0].project_id, undefined);
  assert.ok(
    result.projects[0].unresolved_reason === "project_row_fingerprint_mismatch"
    || result.projects[0].unresolved_reason === "ambiguous_project_row_match"
    || result.projects[0].navigation_failure_reason === "project_row_fingerprint_mismatch");
});

test("reconciled remount descriptor does not require fingerprint mismatch", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Fresh ${index}`);
  const ids = names.map((_, index) => `g-p-fresh-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    remountOnScroll: true,
    nestedScroll: true,
    projectIds: ids
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    prepared.identityCatalog,
    { identityMode: "dom", identityCatalog: prepared.identityCatalog });
  assert.equal(identity.projects.filter((project) => project.project_id).length, 8);
  assert.equal(
    identity.projects.filter((project) =>
      project.unresolved_reason === "project_row_fingerprint_mismatch").length,
    0);
});

test("same-title alternating virtualization does not merge A and B", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Same", "Same"], {
    itemWindow: 1,
    nestedScroll: true,
    remountOnScroll: true
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const snapshot = await locators.collectChatGptContextAsync(document, href, {
    maxScrolls: 8,
    initialSettleMs: 0
  });
  assert.equal(snapshot.projects.length, 1);
  assert.ok((snapshot.provisional_observations || []).length >= 1);
  const prepared = locators.prepareIdentityProjectCatalog(
    snapshot.projects,
    snapshot.provisional_observations || []);
  assert.ok(prepared.identityCatalog.length >= 2);
  assert.ok(prepared.remainingProvisionalCount >= 1);
});

test("visibility recovery rematerializes hidden tail rows 22-24 and 27", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Recover ${index}`);
  const ids = names.map((_, index) => `g-p-recover-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    projectIds: ids,
    hiddenUntilScrollIndexes: [22, 23, 24, 27]
  });
  document.sidebar = sidebar;
  sidebar.scrollport.scrollTop = 20 * 100;
  const locators = loadLocators(document);
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-recover-${index}`
  }));
  const unresolved = [20, 21, 22, 23, 24, 25, 26, 27];
  const results = [];
  for (const index of unresolved) {
    const identity = await locators.resolveChatGptProjectIdentitiesAsync(
      document,
      href,
      [catalog[index]],
      {
        identityMode: "navigation",
        identityCatalog: catalog,
        navigationTimeoutMs: 400,
        settleMs: 0
      });
    results.push(identity.projects[0]);
  }
  assert.equal(results.filter((project) => project.project_id).length, 8);
  assert.deepEqual(results.map((project) => project.project_id), unresolved.map((index) => ids[index]));
});

test("virtualized row recovers after bounded sidebar scan", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Scan ${index}`);
  const ids = names.map((_, index) => `g-p-scan-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    projectIds: ids
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `stale-scan-${index}`
  }));
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [catalog[22]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 400, settleMs: 0 });
  assert.equal(identity.projects[0].project_id, "g-p-scan-22");
});

test("row that never materializes exhausts visibility recovery", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Stuck ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    hiddenForeverIndexes: [7]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const started = Date.now();
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [{
      project_index: 7,
      discovery_index: 7,
      title: "Stuck 7",
      discovery_key: "missing-7"
    }],
    {
      identityMode: "navigation",
      identityCatalog: names.map((title, index) => ({
        project_index: index,
        discovery_index: index,
        title,
        discovery_key: `stuck-${index}`
      })),
      navigationTimeoutMs: 250,
      settleMs: 0,
      maxAttempts: 8,
      maxScrollAttempts: 6
    });
  assert.equal(identity.projects[0].project_id, undefined);
  assert.equal(identity.projects[0].unresolved_reason, "row_visibility_exhausted");
  assert.equal(identity.projects[0].navigation_started_for_project, false);
  assert.ok(Date.now() - started < 4000);
});

test("scrollHeight jitter is not visibility recovery progress", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 8 }, (_, index) => `Jitter ${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    jitterHeightOnScroll: true,
    hiddenForeverIndexes: [7]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [{ project_index: 7, discovery_index: 7, title: "Jitter 7", discovery_key: "jitter-7" }],
    {
      identityMode: "navigation",
      identityCatalog: names.map((title, index) => ({
        project_index: index,
        discovery_index: index,
        title,
        discovery_key: `jitter-${index}`
      })),
      navigationTimeoutMs: 250,
      settleMs: 0,
      maxAttempts: 8
    });
  assert.equal(identity.projects[0].unresolved_reason, "row_visibility_exhausted");
});

test("index-only candidate is not clicked when the target row is absent", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Other A", "Other B"], {
    itemWindow: 8,
    projectIds: ["g-p-other-a", "g-p-other-b"]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [{
      project_index: 22,
      discovery_index: 22,
      title: "Missing Tail",
      discovery_key: "missing-tail"
    }],
    {
      identityMode: "navigation",
      identityCatalog: [
        { project_index: 22, discovery_index: 22, title: "Missing Tail", discovery_key: "missing-tail" }
      ],
      navigationTimeoutMs: 250,
      settleMs: 0
    });
  assert.equal(identity.projects[0].project_id, undefined);
  assert.equal(identity.projects[0].navigation_started_for_project, false);
});

test("title-only visible row is not clicked when the catalog title is duplicated", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Copy", "Other"], {
    itemWindow: 8,
    projectIds: ["g-p-copy-visible", "g-p-other"]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [{
      project_index: 22,
      discovery_index: 22,
      title: "Copy",
      discovery_key: "hidden-copy"
    }],
    {
      identityMode: "navigation",
      identityCatalog: [
        { project_index: 0, discovery_index: 0, title: "Copy", discovery_key: "visible-copy" },
        { project_index: 22, discovery_index: 22, title: "Copy", discovery_key: "hidden-copy" }
      ],
      navigationTimeoutMs: 250,
      settleMs: 0
    });
  assert.equal(identity.projects[0].project_id, undefined);
  assert.equal(identity.projects[0].navigation_started_for_project, false);
});

test("fingerprint mismatch remains a terminal reject", async () => {
  const href = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, ["Target", "Decoy"], {
    itemWindow: 8,
    projectIds: ["g-p-target", "g-p-decoy"]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [{
      project_index: 0,
      discovery_index: 0,
      title: "Target",
      discovery_key: "stale-target",
      project_id: "g-p-other-id"
    }],
    {
      identityMode: "navigation",
      identityCatalog: [{
        project_index: 0,
        discovery_index: 0,
        title: "Target",
        discovery_key: "stale-target",
        project_id: "g-p-other-id"
      }],
      navigationTimeoutMs: 250,
      settleMs: 0
    });
  assert.equal(identity.projects[0].unresolved_reason, "project_row_fingerprint_mismatch");
  assert.equal(identity.projects[0].navigation_started_for_project, false);
  assert.notEqual(identity.projects[0].url, "https://chatgpt.com/g/g-p-target/project");
});

test("visibility recovery then navigation starts at most once", async () => {
  const href = "https://chatgpt.com/";
  const names = Array.from({ length: 28 }, (_, index) => `Once ${index}`);
  const ids = names.map((_, index) => `g-p-once-${index}`);
  const document = new FakeMetadataDocument(href, null);
  const sidebar = new VirtualizedProjectSidebar(document, names, {
    itemWindow: 8,
    nestedScroll: true,
    projectIds: ids,
    hiddenUntilScrollIndexes: [22]
  });
  document.sidebar = sidebar;
  const locators = loadLocators(document);
  const catalog = names.map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `once-${index}`
  }));
  const clicks = [];
  const original = sidebar.projectRows[22].click;
  sidebar.projectRows[22].click = function clickProxy() {
    clicks.push(1);
    if (typeof original === "function") original.call(this);
  };
  const identity = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    href,
    [catalog[22]],
    { identityMode: "navigation", identityCatalog: catalog, navigationTimeoutMs: 400, settleMs: 0 });
  assert.equal(identity.projects[0].project_id, "g-p-once-22");
  assert.ok(clicks.length <= 1);
});

function assertProject(projects, projectId) {
  const project = projects.find((item) => item.project_id === projectId);
  assert.ok(project, `expected Project ${projectId}`);
  return project;
}

test("batch immediate exclusive child evidence resolves 28 Projects without disclosure click", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const names = Array.from({ length: 28 }, (_, index) => `Batch ${index}`);
  const sidebar = new FakeSidebar(document, names, [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  const clicks = Array.from({ length: 28 }, () => 0);
  names.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `batch-${index}`,
      `g-p-batch-${index}`,
      1);
    const row = sidebar.projectRows[index];
    const original = row.click;
    row.click = () => {
      clicks[index] += 1;
      if (typeof original === "function") original.call(row);
    };
  });
  const events = [];
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    identityCatalogFromSidebar(sidebar, "Batch"),
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  const phase = phaseEvent(events);
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 28);
  assert.equal(clicks.reduce((sum, value) => sum + value, 0), 0);
  assert.equal(phase.batch_immediate_resolved_count, 28);
  assert.equal(phase.disclosure_required_count, 0);
  assert.equal(phase.observer_wait_count, 0);
  assert.equal(phase.identity_resolved_before_click_count, 28);
  assert.equal(summaryEvent(events).child_region_wait_total_ms, 0);
});

test("20 exclusive rows skip wait while 8 collapsed rows hydrate", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const immediateNames = Array.from({ length: 20 }, (_, index) => `Ready ${index}`);
  const delayedNames = Array.from({ length: 8 }, (_, index) => `Hydrate ${index}`);
  const sidebar = new FakeSidebar(document, [...immediateNames, ...delayedNames], [], null, null, []);
  sidebar.itemWindow = 28;
  document.sidebar = sidebar;
  immediateNames.forEach((_, index) => {
    attachExclusiveChildChats(
      document,
      sidebar.projectRows[index],
      `ready-phase-${index}`,
      `g-p-ready-phase-${index}`,
      1);
  });
  delayedNames.forEach((_, index) => {
    attachCollapsedDisclosure(
      document,
      sidebar.projectRows[index + 20],
      `hydrate-phase-${index}`,
      `g-p-hydrate-phase-${index}`);
  });
  const events = [];
  const locators = loadLocators(document);
  const catalog = [...immediateNames, ...delayedNames].map((title, index) => ({
    project_index: index,
    discovery_index: index,
    title,
    discovery_key: `phase-mix-${index}`
  }));
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    catalog,
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  const phase = phaseEvent(events);
  assert.equal(result.unresolved_count, 0);
  assert.equal(result.non_navigation_resolved_count, 28);
  assert.equal(phase.batch_immediate_resolved_count, 20);
  assert.equal(phase.disclosure_required_count, 8);
  assert.equal(phase.identity_resolved_before_click_count, 20);
  assert.equal(phase.identity_resolved_immediately_after_click_count, 8);
  assert.equal(phase.observer_wait_count, 0);
});

test("zero-chat exclusive Project home evidence still resolves without child Chat", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Empty Home"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "empty-home");
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "empty-home" });
  region.appendChild(new FakeMetadataNode(document, "A", "Project", {
    href: "/g/g-p-empty-home/project"
  }));
  document.registerElementById(region);
  const events = [];
  const locators = loadLocators(document);
  const result = await locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Empty Home", discovery_key: "empty-home" }],
    { identityMode: "dom", onTelemetry: (event) => events.push(event) });
  const phase = phaseEvent(events);
  assert.equal(result.projects[0].project_id, "g-p-empty-home");
  assert.equal(result.unresolved_count, 0);
  assert.equal(phase.batch_immediate_resolved_count, 1);
  assert.equal(phase.disclosure_required_count, 0);
});

test("observer noise without owned evidence is not treated as identity progress", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["Noisy"], [], null, null, []);
  sidebar.itemWindow = 1;
  document.sidebar = sidebar;
  const row = sidebar.projectRows[0];
  row.attributes.set("aria-controls", "noisy-region");
  row.attributes.set("aria-expanded", "true");
  const region = new FakeMetadataNode(document, "DIV", "", { id: "noisy-region" });
  document.registerElementById(region);
  document.defaultView = {
    innerWidth: 1024,
    innerHeight: 540,
    getComputedStyle() { return { display: "", visibility: "" }; },
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  };
  FakeMutationObserver.instances.length = 0;
  const locators = loadLocators(document, {
    MutationObserver: FakeMutationObserver,
    setTimeout,
    clearTimeout
  });
  const events = [];
  const pending = locators.resolveChatGptProjectIdentitiesAsync(
    document,
    rootHref,
    [{ project_index: 0, discovery_index: 0, title: "Noisy", discovery_key: "noisy-0" }],
    {
      identityMode: "dom",
      disclosureTimeoutMs: 800,
      onTelemetry: (event) => events.push(event)
    });
  await new Promise((resolve) => setTimeout(resolve, 20));
  for (let index = 0; index < 8; index += 1) {
    FakeMutationObserver.instances.at(-1)?.emit([{ type: "childList" }]);
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  region.appendChild(new FakeMetadataNode(document, "A", "Chat", {
    href: "/g/g-p-noisy/c/g-p-noisy-chat"
  }));
  FakeMutationObserver.instances.at(-1)?.emit([{ type: "childList" }]);
  const result = await pending;
  const phase = phaseEvent(events);
  assert.equal(result.projects[0].project_id, "g-p-noisy");
  assert.ok(phase.observer_wake_without_target_progress_count >= 1, phase.observer_wake_without_target_progress_count);
  assert.equal(phase.identity_resolved_after_observer_count, 1);
});
