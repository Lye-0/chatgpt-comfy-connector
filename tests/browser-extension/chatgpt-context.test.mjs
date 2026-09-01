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
    if (selector === "button") return descendants.filter((element) => element.tagName === "BUTTON");
    if (selector.includes('role="button"')) return descendants.filter((element) => element.getAttribute("role") === "button");
    if (selector.includes("data-sidebar-item")) return descendants.filter((element) => element.getAttribute("data-sidebar-item") === "true");
    return [];
  }
}

class FakeSidebar extends FakeMetadataNode {
  constructor(document, projectNames, conversationNodes, projectAnchor, expandedProjectName = null) {
    super(document, "NAV");
    this.projectRows = projectNames.map((name) => {
      const row = new FakeMetadataNode(document, "DIV", "", {
        role: "button",
        "data-sidebar-item": "true",
        "aria-expanded": name === expandedProjectName ? "true" : "false"
      });
      row.appendChild(new FakeMetadataNode(document, "SPAN", name, { "data-marquee-text": "true" }));
      return row;
    });
    this.conversationNodes = conversationNodes;
    this.projectAnchor = projectAnchor;
    this.expanded = false;
    this.scrollTop = 24;
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
    if (selector === "a[href]") return [this.projectAnchor, ...this.conversationNodes].filter(Boolean);
    if (selector === "button") return this.expanded ? [] : [this.moreButton];
    if (selector.includes('role="button"')) return [...this.currentProjectRows, ...(this.expanded ? [] : [this.moreButton])];
    if (selector.includes("data-marquee-text")) return this.currentProjectRows.flatMap((row) => row.querySelectorAll(selector));
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

class FakeMetadataDocument extends FakeMetadataNode {
  constructor(href, sidebar) {
    super(null, "DOCUMENT");
    this.ownerDocument = this;
    this.location = { href };
    this.title = "ChatGPT";
    this.sidebar = sidebar;
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
  const sidebar = new FakeSidebar(document, ["Project A"], [], null);
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

  document.defaultView.innerWidth = 770;
  const desktop = locators.getChatGptCollectorViewport(document);
  assert.equal(desktop.content_inner_width, 770);
  assert.equal(desktop.sidebar_expected_visible, true);
  assert.equal(desktop.desktop_layout, true);
  assert.equal(desktop.sidebar_container_exists, true);
  assert.equal(desktop.project_section_exists, true);
  assert.equal(desktop.project_row_locator_ready, true);
  assert.equal(desktop.sidebar_ready, true);
});

test("sidebar discovery prefers the visible shell containing the full Project catalog", () => {
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
  for (const name of ["Others", "Chess", "Git", "Python", "Web Atlas"]) {
    const row = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "false"
    });
    row.appendChild(new FakeMetadataNode(document, "SPAN", name, {
      "data-marquee-text": "true"
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
  assert.equal(locators.findSidebarRoot(document), fullSidebar);
  assert.deepEqual(
    Array.from(locators.findProjectRows(document), (row) => locators.visibleTitleFromElement(row)),
    ["Others", "Chess", "Git", "Python", "Web Atlas"]);
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
  currentProject.appendChild(new FakeMetadataNode(document, "A", "Current chat", {
    href: "/c/current-chat"
  }));
  innerSidebar.appendChild(currentProject);
  outerSidebar.appendChild(innerSidebar);
  for (const name of ["Project A", "Project B", "Project C"]) {
    const row = new FakeMetadataNode(document, "DIV", "", {
      role: "button",
      "data-sidebar-item": "true",
      "aria-expanded": "false"
    });
    row.appendChild(new FakeMetadataNode(document, "SPAN", name, {
      "data-marquee-text": "true"
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
  const sidebar = new FakeSidebar(document, ["Alpha", "Beta", "Git Lines", "Web Atlas", "Others", "Chess"], [conversation, duplicate], projectAnchor);
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
  assert.equal(sidebar.scrollport.scrollTop, 0);
});

test("async sidebar discovery resolves title-only Project rows from their navigated IDs", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const sidebar = new FakeSidebar(document, ["同名Project", "同名Project"], [], null);
  document.sidebar = sidebar;
  const projectIds = ["g-p-first", "g-p-second"];
  sidebar.projectRows.forEach((row, index) => {
    row.click = () => {
      document.location.href = `https://chatgpt.com/g/${projectIds[index]}/project`;
    };
  });
  const history = {
    back() { document.location.href = rootHref; }
  };

  const locators = loadLocators(document, {
    history,
    setTimeout,
    clearTimeout
  });
  const snapshot = await locators.collectChatGptContextAsync(document, rootHref, {
    maxScrolls: 4,
    maxMoreClicks: 1,
    resolveProjectIds: true,
    projectResolutionTimeoutMs: 500
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), projectIds);
  assert.equal(snapshot.projects.every((project) => project.url.endsWith("/project")), true);
  assert.equal(snapshot.unresolved_project_count, 0);
  assert.equal(document.location.href, rootHref);
});

test("async Project discovery rebinds the Sidebar after each SPA navigation", async () => {
  const rootHref = "https://chatgpt.com/";
  const document = new FakeMetadataDocument(rootHref, null);
  const projectIds = ["g-p-replaced-first", "g-p-replaced-second", "g-p-replaced-third"];
  let navigationIndex = -1;

  const createRootSidebar = () => {
    const sidebar = new FakeSidebar(document, ["First", "Second", "Third"], [], null);
    sidebar.itemWindow = 3;
    sidebar.scrollTop = 0;
    sidebar.clientHeight = 100;
    sidebar.scrollHeight = 100;
    sidebar.projectRows.forEach((row, index) => {
      row.click = () => {
        navigationIndex = index;
        document.location.href = `https://chatgpt.com/g/${projectIds[index]}/project`;
      };
    });
    return sidebar;
  };
  document.sidebar = createRootSidebar();
  const history = {
    back() {
      document.location.href = rootHref;
      // ChatGPT replaces the nav/scrollport after the Project route returns.
      document.sidebar = createRootSidebar();
    }
  };

  const locators = loadLocators(document, {
    history,
    setTimeout,
    clearTimeout
  });
  const snapshot = await locators.collectChatGptContextAsync(document, rootHref, {
    maxScrolls: 2,
    maxMoreClicks: -1,
    resolveProjectIds: true,
    projectResolutionTimeoutMs: 500,
    initialSettleMs: 0
  });

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), projectIds);
  assert.equal(navigationIndex, 2);
  assert.equal(snapshot.unresolved_project_count, 0);
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
  const content = new FakeMetadataNode(null, "MAIN");
  const alphaChat = new FakeMetadataNode(null, "A", "", {
    href: "/c/conversation-alpha"
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
  const snapshot = await locators.collectChatGptProjectContextAsync(document, href, "g-p-alpha");

  assert.deepEqual(Array.from(snapshot.projects, (project) => project.project_id), ["g-p-alpha"]);
  assert.deepEqual(Array.from(snapshot.conversations, (conversation) => conversation.conversation_id), [
    "conversation-alpha",
    "conversation-second"
  ]);
  assert.ok(snapshot.conversations.every((conversation) => conversation.project_id === "g-p-alpha"));
});

test("Project page collection follows lazy Project chat growth with bounded scrolling", async () => {
  const href = "https://chatgpt.com/g/g-p-lazy/project";
  const sidebar = new FakeMetadataNode(null, "NAV");
  const content = new FakeMetadataNode(null, "MAIN", "", { class: "scrollport" });
  content.scrollTop = 0;
  content.clientHeight = 100;
  content.scrollHeight = 280;
  const firstChat = new FakeMetadataNode(null, "A", "", { href: "/c/conversation-lazy-first" });
  firstChat.appendChild(new FakeMetadataNode(null, "SPAN", "First lazy chat", { "data-marquee-text": "true" }));
  const secondChat = new FakeMetadataNode(null, "A", "", { href: "/c/conversation-lazy-second" });
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
  const firstChat = new FakeMetadataNode(null, "A", "", { href: "/c/conversation-two-lists-first" });
  firstChat.appendChild(new FakeMetadataNode(null, "SPAN", "First list chat", { "data-marquee-text": "true" }));
  const secondChat = new FakeMetadataNode(null, "A", "", { href: "/c/conversation-two-lists-second" });
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
  assert.equal(content.scrollTop, 0);
  assert.equal(sidebar.scrollTop, 0);
});

function assertProject(projects, projectId) {
  const project = projects.find((item) => item.project_id === projectId);
  assert.ok(project, `expected Project ${projectId}`);
  return project;
}
