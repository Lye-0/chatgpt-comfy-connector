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

  const assistantMessageSelectors = [
    '[data-message-author-role="assistant"]',
    '[data-turn="assistant"]',
    '[data-author-role="assistant"]',
    '[data-testid*="assistant-message"]',
    '[data-testid*="conversation-turn-assistant"]',
    '[data-testid*="conversation-turn"] [data-message-author-role="assistant"]',
    'article[data-testid*="conversation-turn-assistant"]'
  ];

  const assistantCompletionActionSelectors = [
    'button[data-testid*="copy"]',
    'button[data-testid*="retry"]',
    'button[data-testid*="regenerate"]',
    '[role="button"][data-testid*="copy"]',
    '[role="button"][data-testid*="retry"]',
    '[role="button"][data-testid*="regenerate"]',
    'button[aria-label]',
    '[role="button"][aria-label]'
  ];

  // ChatGPT renders the answer body inside a narrower content element, while
  // progress/live-region controls can live beside or inside the assistant
  // turn.  Prefer the content element when one is available so extraction
  // never starts from a broad conversation-turn container by accident.
  const assistantContentSelectors = [
    '[data-message-content]',
    '[data-testid*="message-content"]',
    '[data-testid*="markdown"]',
    '[class*="markdown"]',
    '[class*="prose"]'
  ];

  const stopButtonSelectors = [
    'button[data-testid*="stop"]',
    '[role="button"][data-testid*="stop"]',
    'button[aria-label*="stop" i]',
    '[role="button"][aria-label*="stop" i]',
    'button[title*="stop" i]',
    '[role="button"][title*="stop" i]',
    'button[aria-label*="停止"]',
    '[role="button"][aria-label*="停止"]',
    'button[title*="停止"]',
    '[role="button"][title*="停止"]'
  ];

  const fileInputSelectors = [
    'input[type="file"][data-testid*="file"]',
    'input[type="file"][data-testid*="upload"]',
    'input[type="file"][accept]',
    'input[type="file"]'
  ];

  const attachmentControlSelectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="attach"]',
    '[data-testid*="upload"]',
    '[data-testid*="file"]',
    '[aria-label*="attachment" i]',
    '[aria-label*="attach" i]',
    '[aria-label*="upload" i]',
    '[aria-label*="file" i]',
    '[aria-label*="photo" i]',
    '[aria-label*="image" i]',
    '[aria-label*="添付"]',
    '[aria-label*="ファイル"]',
    '[aria-label*="写真"]',
    '[aria-label*="画像"]',
    '[aria-label*="アップロード"]'
  ];

  const attachmentIndicatorSelectors = [
    '[data-testid*="attachment"]',
    '[data-testid*="file"]',
    '[data-testid*="upload"]',
    '[data-file-name]',
    '[data-filename]',
    '[aria-label*="attachment" i]',
    '[aria-label*="file" i]',
    '[aria-label*="添付"]',
    '[aria-label*="ファイル"]',
    '[aria-label*="アップロード"]',
    '[role="progressbar"]'
  ];

  const zeroWidthPattern = /[\u200b\u200c\u200d\u2060\ufeff]/g;

  const transientRolePattern = /^(?:status|progressbar|alert|log|marquee)$/i;
  const transientSemanticPattern = /(?:^|[\s:_-])(?:status|progress|loading|thinking|generating|generation|streaming|live(?:-|_)?region|tool(?:-|_)?progress|image(?:-|_)?generation|stop(?:-|_)?button|cancel)(?:$|[\s:_-])/i;
  const transientTextPattern = /^(?:thinking|思考中|generating|生成中|より詳細な画像を生成しています[。.!！]?少々お待ちください[。.!！]?|画像を生成しています[。.!！]?|回答を生成中[。.!！]?|応答を生成中[。.!！]?|streaming[…\.。]*)$/i;

  // The composer toolbar contains several visible buttons.  A button that
  // happens to be near the composer is never a safe Send candidate unless its
  // semantics say "send/submit", or it is a submit control in the same form.
  // These exclusions intentionally cover both the English and Japanese UI.
  const excludedActionPattern = /(?:\b(?:attachment|attach|upload|add|plus|tool|tools|microphone|mic|voice|stop|file|files|photo|photos|image|images|library|browse)\b|添付|ファイル|写真|画像|追加|プラス|ツール|マイク|音声|停止)/i;
  const excludedAttachmentControlPattern = /(?:\b(?:remove|delete|cancel|close|library|browse|search|tool|tools|microphone|mic|voice|stop)\b|削除|閉じる|キャンセル|ライブラリ|検索|ツール|マイク|音声|停止)/i;
  const attachmentControlPattern = /(?:\b(?:attachment|attach|upload|file|files|photo|photos|image|images)\b|添付|ファイル|写真|画像|アップロード)/i;
  const sendActionPattern = /(?:\b(?:send|submit)\b|送信|メッセージを送る|メッセージを送信|送る)/i;
  const completionActionPattern = /(?:\b(?:copy|retry|regenerate|redo|edit|share|like|dislike)\b|コピー|再試行|再生成|編集|共有|いいね|よくない)/i;

  // Context discovery is metadata-only.  Keep the limits here as well as in
  // the authenticated Desktop Bridge so a malformed or unexpectedly large
  // ChatGPT page never becomes a large message from the Content Script.
  const metadataIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  const metadataTitleMaxLength = 512;
  const metadataUrlMaxLength = 2048;

  // These are the selectors used by the previously successful Project
  // discovery implementation. Keep the Project catalogue path deliberately
  // small: it reads metadata from the known ChatGPT history sidebar and never
  // clicks an unknown row to infer an identity.
  const sidebarRootSelectors = [
    'nav[aria-label="チャット履歴"]',
    'nav[aria-label="Chat history"]',
    'nav[data-sidebar]'
  ];
  const sidebarScrollContainerSelectors = [
    '[data-sidebar-scroll-container="true"]',
    '[data-radix-scroll-area-viewport]',
    '[class*="scrollport"]',
    '[class*="overflow-y-auto"]'
  ];
  const projectRowSelectors = [
    '[role="button"][data-sidebar-item="true"]',
    '[data-sidebar-item="true"][role="button"]'
  ];
  const metadataEntrySelectors = [
    'a[href]',
    '[role="link"][href]',
    '[data-href]',
    '[data-url]',
    '[data-conversation-url]',
    '[data-project-url]',
    '[data-conversation-id]',
    '[data-conversation-id-value]',
    '[data-thread-id]'
  ];
  const projectSectionSelectors = [
    '[data-sidebar-section="projects"]',
    '[data-sidebar-section*="project" i]',
    '[data-testid*="project" i]',
    '[aria-label*="project" i]',
    '[aria-label*="プロジェクト"]'
  ];
  const visibleTitleSelectors = [
    '[data-marquee-text="true"]',
    '[data-marquee-text]',
    '[data-sidebar-item-title]',
    '[data-conversation-title]',
    '[data-project-title]'
  ];
  const moreButtonSelectors = [
    'button',
    '[role="button"]'
  ];
  const moreButtonTextPattern = /(?:さらに表示|もっと見る|\b(?:show|see|load)\s+more\b|\bmore\s+(?:chats?|projects?|conversations?)\b)/i;
  const projectFallbackTitlePattern = /^Project\s*\([^)]*\)$/i;
  const projectFallbackIdPattern = /^Project\s*\(\s*([A-Za-z0-9][A-Za-z0-9._-]{0,127})\s*\)$/i;

  function isChatGptPage(url = globalThis.location?.href) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "https:" && parsed.hostname === "chatgpt.com";
    } catch (_) {
      return false;
    }
  }

  function metadataIdentifier(value) {
    const text = String(value ?? "").trim();
    return metadataIdentifierPattern.test(text) ? text : null;
  }

  function metadataTitle(value, fallback = "") {
    const text = String(value ?? "")
      .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return (text || fallback).slice(0, metadataTitleMaxLength);
  }

  function chatGptMetadataUrl(value, baseUrl = globalThis.location?.href) {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    try {
      const parsed = new URL(value, baseUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com" || parsed.port !== "") return null;
      const pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
      const canonical = `${parsed.origin}${pathname}`;
      return canonical.length <= metadataUrlMaxLength ? canonical : null;
    } catch (_) {
      return null;
    }
  }

  function decodedPathSegments(value, baseUrl = globalThis.location?.href) {
    if (typeof value !== "string" || value.trim().length === 0) return [];
    try {
      const parsed = new URL(value, baseUrl);
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com" || parsed.port !== "") return [];
      return parsed.pathname.split("/").filter(Boolean).map((segment) => {
        try { return decodeURIComponent(segment); } catch (_) { return segment; }
      });
    } catch (_) {
      return [];
    }
  }

  function conversationIdFromUrl(value = globalThis.location?.href) {
    const segments = decodedPathSegments(value);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "c") continue;
      return metadataIdentifier(segments[index + 1]);
    }
    return null;
  }

  function projectIdFromUrl(value = globalThis.location?.href) {
    try {
      const parsed = new URL(value || "", globalThis.location?.href);
      if (parsed.protocol !== "https:" || parsed.hostname !== "chatgpt.com" || parsed.port !== "") return null;
      for (const name of ["project_id", "projectId"]) {
        const fromQuery = metadataIdentifier(parsed.searchParams.get(name));
        if (fromQuery) return fromQuery;
      }
    } catch (_) { }

    const segments = decodedPathSegments(value);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "g") continue;
      const projectId = metadataIdentifier(segments[index + 1]);
      // /g/g-... is also used by custom GPTs.  Project routes observed in
      // ChatGPT use the g-p-* identity; do not misclassify a GPT as a
      // Project merely because it contains a conversation link.
      if (projectId?.toLowerCase().startsWith("g-p-")) return projectId;
    }

    return null;
  }

  function isProjectHomeUrl(value) {
    const segments = decodedPathSegments(value);
    return segments.at(-1)?.toLowerCase() === "project" && projectIdFromUrl(value) !== null;
  }

  function isProjectRouteUrl(value) {
    if (isProjectHomeUrl(value)) return true;
    const segments = decodedPathSegments(value);
    const projectId = projectIdFromUrl(value);
    if (!projectId) return false;
    // Some ChatGPT builds link the Project root as `/g/g-p-...` and let the
    // router append `/project` after activation. Treat that route as Project
    // metadata, but keep generic `/g/g-...` GPT routes excluded by the
    // g-p-* identity check in projectIdFromUrl().
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() === "g"
        && segments[index + 1] === projectId
        && segments.length === index + 2) return true;
    }
    return false;
  }

  function projectUrlFromConversationUrl(value, projectId) {
    const canonical = chatGptMetadataUrl(value);
    if (!canonical || !projectId) return null;
    try {
      const parsed = new URL(canonical);
      const segments = decodedPathSegments(canonical);
      const projectSegmentIndex = segments.findIndex((segment) => segment === projectId);
      if (projectSegmentIndex >= 1 && segments[projectSegmentIndex - 1].toLowerCase() === "g") {
        const prefix = segments.slice(0, projectSegmentIndex + 1).map((segment) => encodeURIComponent(segment)).join("/");
        return `${parsed.origin}/${prefix}/project`;
      }
    } catch (_) { }
    return null;
  }

  function stableMetadataKey(prefix, value) {
    const text = String(value ?? "");
    // This is a display/discovery key only. It is never used as a Project
    // identity or as a navigation target.
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}-${(hash >>> 0).toString(16)}`;
  }

  function projectDiscoveryKeyForRow(row, title, discoveryIndex) {
    // A title is not an identity: two Projects may deliberately have the same
    // name. Prefer a row-local DOM token that remains stable while the
    // virtualized Sidebar is rescanned. `aria-controls` is the usual token for
    // the current disclosure row; the other attributes cover older ChatGPT
    // layouts. The value is hashed before it leaves this module and is never
    // emitted as telemetry.
    const rowToken = [
      "aria-controls",
      "id",
      "data-project-key",
      "data-sidebar-item-id",
      "data-item-id",
      "data-key",
      "data-index",
      "data-item-index",
      "aria-posinset"
    ].map((name) => attributeValue(row, name).trim())
      .find((value) => value.length > 0);
    const position = Number.isSafeInteger(discoveryIndex) && discoveryIndex >= 0
      ? discoveryIndex
      : "unknown";
    const identityToken = rowToken
      ? `token:${rowToken}`
      : `position:${position}`;
    return stableMetadataKey(
      "project",
      `${identityToken}:${metadataTextKey(title)}`);
  }

  function metadataTextKey(value) {
    return normalizeText(value).replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }

  function stripMetadataDescriptionSuffix(value) {
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(?:、|,\s*)?(?:プロジェクト\s+.+?\s+内のチャット|project\s+.+?\s+(?:inside|under)\s+(?:the\s+)?project|ピン留めされた(?:会話|チャット)|pinned\s+(?:conversation|chat))$/i, "")
      .trim();
  }

  function fallbackProjectIdFromTitle(value) {
    const match = String(value ?? "").trim().match(projectFallbackIdPattern);
    return match ? metadataIdentifier(match[1]) : null;
  }

  function visibleElementText(element) {
    if (!element || !isVisible(element)) return "";
    for (const property of ["innerText", "textContent"]) {
      try {
        const value = element[property];
        if (typeof value === "string" && value.trim().length > 0) return value;
      } catch (_) {
        // A stale virtualized node may expose only one representation.
      }
    }
    return "";
  }

  function visibleTitleFromElement(element, fallback = "") {
    if (!element) return metadataTitle(fallback);
    const titleElements = uniqueElements(visibleTitleSelectors, element)
      .filter((candidate) => isVisible(candidate));
    for (const titleElement of titleElements) {
      const title = metadataTitle(visibleElementText(titleElement));
      if (title) return title;
    }

    const direct = stripMetadataDescriptionSuffix(visibleElementText(element));
    return metadataTitle(direct, fallback);
  }

  function conversationTitleFromAnchor(anchor, conversationId) {
    const visible = visibleTitleFromElement(anchor);
    if (visible) return visible;

    const explicit = [
      attributeValue(anchor, "data-title"),
      attributeValue(anchor, "data-conversation-title"),
      attributeValue(anchor, "title")
    ].find((value) => value.trim().length > 0);
    if (explicit) return metadataTitle(stripMetadataDescriptionSuffix(explicit), conversationId);

    // Do not use aria-label as the title. It is an accessible description on
    // ChatGPT and commonly contains Project/Pinned suffixes.
    return metadataTitle(stripMetadataDescriptionSuffix(visibleElementText(anchor)), conversationId);
  }

  function projectTitleFromAnchor(anchor, projectId) {
    const visible = visibleTitleFromElement(anchor, "");
    if (visible) return visible;

    const explicit = [
      attributeValue(anchor, "data-project-title"),
      attributeValue(anchor, "data-project-name")
    ].find((value) => value.trim().length > 0);
    if (explicit) return metadataTitle(stripMetadataDescriptionSuffix(explicit));

    return metadataTitle(stripMetadataDescriptionSuffix(visibleElementText(anchor))) || null;
  }

  function projectIdFromElement(element, baseUrl) {
    const explicit = [
      attributeValue(element, "data-project-id"),
      attributeValue(element, "data-project-id-value")
    ].map((value) => metadataIdentifier(value)).find(Boolean);
    if (explicit) return explicit;
    const href = chatGptMetadataUrl(attributeValue(element, "href"), baseUrl);
    return projectIdFromUrl(href);
  }

  function projectUrlFromElement(element, baseUrl) {
    const projectId = projectIdFromElement(element, baseUrl);
    const explicit = chatGptMetadataUrl(attributeValue(element, "data-project-url"), baseUrl)
      || chatGptMetadataUrl(attributeValue(element, "href"), baseUrl);
    return explicit && isProjectHomeUrl(explicit) ? explicit : null;
  }

  function projectTitleFromRelatedAnchor(anchor, projectId, projectAnchors = [], projectRows = []) {
    const direct = [
      attributeValue(anchor, "data-project-title"),
      attributeValue(anchor, "data-project-name")
    ].map((value) => stripMetadataDescriptionSuffix(value)).find((value) => value.length > 0);
    if (direct) return direct;

    let ancestor = anchor?.parentElement;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      const ancestorProjectId = projectIdFromElement(ancestor);
      if (ancestorProjectId === projectId && isProjectRouteUrl(attributeValue(ancestor, "href"))) {
        const title = visibleTitleFromElement(ancestor);
        if (title) return title;
      }
      if (projectRows.includes(ancestor)) {
        const title = visibleTitleFromElement(ancestor);
        if (title) return title;
      }
      for (const attribute of ["data-project-title", "data-project-name"]) {
        const value = attributeValue(ancestor, attribute);
        if (value) return metadataTitle(stripMetadataDescriptionSuffix(value));
      }
    }

    const explicit = projectAnchors.find((candidate) => projectIdFromElement(candidate) === projectId);
    if (explicit) return projectTitleFromAnchor(explicit, projectId);

    const projectRow = projectRows.find((candidate) => projectIdFromElement(candidate) === projectId);
    return projectRow ? visibleTitleFromElement(projectRow) : null;
  }

  function metadataElementsInRoot(root) {
    return uniqueElements(metadataEntrySelectors, root);
  }

  function findSidebarRoot(root = globalThis.document) {
    const matches = uniqueElements(sidebarRootSelectors, root)
      .filter((element) => element !== root);
    return matches[0] || root;
  }

  function projectRowsInSidebar(sidebar, baseUrl = globalThis.location?.href) {
    if (!sidebar?.querySelectorAll) return [];
    return sortInDocumentOrder(uniqueElements(projectRowSelectors, sidebar)
      .filter((element) => isVisible(element)));
  }

  function expandedProjectRowsInSidebar(sidebar) {
    if (!sidebar?.querySelectorAll) return [];
    const candidates = uniqueElements([
      '[data-sidebar-item="true"]',
      '[role="treeitem"]',
      '[role="button"]'
    ], sidebar);
    return candidates.filter((element) => isVisible(element)
      && attributeValue(element, "aria-expanded").toLowerCase() === "true"
      && Boolean(visibleTitleFromElement(element, "")));
  }

  function findProjectRows(root = globalThis.document) {
    const sidebar = findSidebarRoot(root);
    return projectRowsInSidebar(sidebar, documentHref(root));
  }

  function metadataHrefFromElement(element, baseUrl = globalThis.location?.href) {
    for (const attribute of [
      "href",
      "data-href",
      "data-url",
      "data-conversation-url",
      "data-project-url"
    ]) {
      const value = chatGptMetadataUrl(attributeValue(element, attribute), baseUrl);
      if (value) return value;
    }
    return null;
  }

  function getChatGptCollectorViewport(root = globalThis.document) {
    const ownerWindow = root?.defaultView
      || root?.ownerDocument?.defaultView
      || globalThis;
    const widthValue = Number(ownerWindow?.innerWidth);
    const heightValue = Number(ownerWindow?.innerHeight);
    const contentInnerWidth = Number.isSafeInteger(widthValue) && widthValue > 0 ? widthValue : 0;
    const contentInnerHeight = Number.isSafeInteger(heightValue) && heightValue > 0 ? heightValue : 0;
    const sidebarMatches = uniqueElements(sidebarRootSelectors, root);
    const sidebar = findSidebarRoot(root);
    const sidebarContainerExists = sidebarMatches.length > 0;
    let projectRowLocatorReady = false;
    for (const selector of projectRowSelectors) {
      try {
        sidebar?.querySelectorAll?.(selector);
        projectRowLocatorReady = true;
        break;
      } catch (_) {
        // A selector can become temporarily unavailable while ChatGPT swaps
        // its virtualized sidebar subtree.
      }
    }
    // Readiness must not perform Project discovery. In particular, do not
    // enumerate the current virtualized rows or select/probe a scrollport
    // here. The one-shot discovery routine owns that work and freezes the
    // selected Sidebar/scroll container for the duration of its scan.
    const projectSectionExists = sidebarContainerExists
      && (uniqueElements(projectSectionSelectors, sidebar).some((element) => isVisible(element))
        || metadataElementsInRoot(sidebar)
          .some((element) => isProjectRouteUrl(metadataHrefFromElement(element))));
    const knownScrollContainerExists = sidebar
      && (Boolean(scrollMetricsFor(sidebar))
        || sidebarScrollContainerSelectors.some((selector) => {
          try { return sidebar.querySelectorAll?.(selector)?.length > 0; } catch (_) { return false; }
        }));
    const desktopLayout = contentInnerWidth >= 770;
    const sidebarExpectedVisible = desktopLayout;
    return {
      type: "COLLECTOR_VIEWPORT_RESULT",
      status: "ok",
      content_inner_width: contentInnerWidth,
      content_inner_height: contentInnerHeight,
      sidebar_container_exists: sidebarContainerExists,
      project_section_exists: projectSectionExists,
      project_row_locator_ready: projectRowLocatorReady,
      desktop_layout: desktopLayout,
      sidebar_expected_visible: sidebarExpectedVisible,
      // This is a non-mutating structural check only. The actual container
      // is selected once by collectChatGptContextAsync and is never re-bound
      // from this readiness path.
      sidebar_scroll_container_found: Boolean(knownScrollContainerExists),
      sidebar_ready: desktopLayout
        && sidebarContainerExists
        && projectRowLocatorReady
    };
  }

  function collectorRootUrl(value = globalThis.location?.href) {
    const canonical = chatGptMetadataUrl(value, value);
    if (!canonical) return null;
    try {
      const parsed = new URL(canonical);
      return parsed.pathname === "/" ? canonical : null;
    } catch (_) {
      return null;
    }
  }

  function rootSidebarStructureStats(sidebar) {
    if (!sidebar) return { childCount: 0, descendantCount: 0, sectionCount: 0, buttonCount: 0 };
    let childCount = 0;
    let descendantCount = 0;
    let sectionCount = 0;
    let buttonCount = 0;
    try { childCount = Number(sidebar.children?.length) || 0; } catch (_) { }
    try { descendantCount = Number(sidebar.querySelectorAll?.("*")?.length) || 0; } catch (_) { }
    for (const selector of ["section", '[role="region"]', '[data-sidebar-section]']) {
      try { sectionCount += Number(sidebar.querySelectorAll?.(selector)?.length) || 0; } catch (_) { }
    }
    for (const selector of ["button", '[role="button"]']) {
      try { buttonCount += Number(sidebar.querySelectorAll?.(selector)?.length) || 0; } catch (_) { }
    }
    return { childCount, descendantCount, sectionCount, buttonCount };
  }

  function rootSidebarStructureFingerprint(sidebar) {
    const stats = rootSidebarStructureStats(sidebar);
    return [stats.childCount, stats.descendantCount, stats.sectionCount, stats.buttonCount].join(":");
  }

  function getChatGptRootSidebarHydrationState(
    root = globalThis.document,
    expectedRootUrl = "https://chatgpt.com/") {
    const currentUrl = documentHref(root, globalThis.location?.href);
    const expectedUrl = collectorRootUrl(expectedRootUrl);
    const rootUrlVerified = Boolean(expectedUrl && collectorRootUrl(currentUrl) === expectedUrl);
    const documentReadyState = String(root?.readyState || "unknown").toLowerCase();
    const sidebarMatches = uniqueElements(sidebarRootSelectors, root)
      .filter((element) => element !== root);
    const sidebar = sidebarMatches[0] || null;
    const sidebarRootPresent = Boolean(sidebar);
    const sidebarStructureStats = rootSidebarStructureStats(sidebar);
    const sidebarShellPresent = sidebarRootPresent
      && isVisible(sidebar)
      && (sidebarStructureStats.childCount > 0
        || sidebarStructureStats.descendantCount > 0
        || sidebarStructureStats.sectionCount > 0
        || sidebarStructureStats.buttonCount > 0);
    const scrollContainer = sidebarRootPresent
      ? findSidebarScrollContainer(root, sidebar)
      : null;
    const scrollMetrics = scrollMetricsFor(scrollContainer);
    const sidebarScrollContainerPresent = Boolean(scrollContainer && scrollMetrics);
    const sidebarStructureFingerprint = rootSidebarStructureFingerprint(sidebar);

    return {
      root_url_verified: rootUrlVerified,
      document_ready_state: documentReadyState,
      sidebar_root_present: sidebarRootPresent,
      sidebar_shell_present: sidebarShellPresent,
      sidebar_scroll_container_present: sidebarScrollContainerPresent,
      sidebar_sections_stable: false,
      sidebar_structure_fingerprint: sidebarStructureFingerprint,
      sidebar_scroll_container_found: sidebarScrollContainerPresent
    };
  }

  async function waitForChatGptRootSidebarHydrationAsync(
    root = globalThis.document,
    expectedRootUrl = "https://chatgpt.com/",
    options = {}) {
    const ownerWindow = root?.defaultView
      || root?.ownerDocument?.defaultView
      || globalThis;
    const setTimer = ownerWindow?.setTimeout || globalThis.setTimeout;
    const clearTimer = ownerWindow?.clearTimeout || globalThis.clearTimeout;
    const MutationObserverCtor = ownerWindow?.MutationObserver
      || root?.ownerDocument?.defaultView?.MutationObserver
      || globalThis.MutationObserver;
    const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 30000));
    const quietTargetMs = Math.max(100, Math.min(5000, Number(options.quietMs) || 600));
    const pollMs = Math.max(25, Math.min(1000, Number(options.pollMs) || 100));
    const startedAt = Date.now();

    return await new Promise((resolve) => {
      let mutationCount = 0;
      let lastMutationAt = startedAt;
      let lastFingerprint = null;
      let fingerprintStableAt = startedAt;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;
      let settled = false;

      const finish = (state, completed, errorCode = null) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (pollTimer !== null) clearTimer?.(pollTimer);
        if (timeoutTimer !== null) clearTimer?.(timeoutTimer);
        const now = Date.now();
        resolve({
          type: "COLLECTOR_ROOT_HYDRATION_RESULT",
          status: completed ? "ok" : "error",
          root_hydration_completed: completed,
          root_hydration_timeout: !completed && errorCode === "collector_root_hydration_timeout",
          hydration_wait_ms: Math.max(0, now - startedAt),
          mutation_count: mutationCount,
          mutation_quiet_ms: Math.max(0, now - lastMutationAt),
          sidebar_sections_stable: completed || state.sidebar_sections_stable === true,
          ...state,
          ...(errorCode ? { errorCode } : {})
        });
      };

      const inspect = () => {
        if (settled) return;
        const state = getChatGptRootSidebarHydrationState(root, expectedRootUrl);
        const fingerprint = state.sidebar_structure_fingerprint;
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          fingerprintStableAt = Date.now();
        }
        const now = Date.now();
        const mutationQuietMs = Math.max(0, now - lastMutationAt);
        const fingerprintStableMs = Math.max(0, now - fingerprintStableAt);
        const sectionsStable = Boolean(
          state.root_url_verified
          && state.document_ready_state === "complete"
          && state.sidebar_root_present
          && state.sidebar_shell_present
          && state.sidebar_scroll_container_present
          && mutationQuietMs >= quietTargetMs
          && fingerprintStableMs >= quietTargetMs);
        state.sidebar_sections_stable = sectionsStable;
        if (sectionsStable) {
          finish(state, true);
          return;
        }
        if (now - startedAt >= timeoutMs) {
          finish(state, false, "collector_root_hydration_timeout");
          return;
        }
        pollTimer = setTimer(inspect, pollMs);
      };

      if (typeof MutationObserverCtor === "function") {
        try {
          observer = new MutationObserverCtor((records) => {
            mutationCount += Number.isSafeInteger(records?.length) && records.length > 0
              ? records.length
              : 1;
            lastMutationAt = Date.now();
          });
          const observationTarget = root?.documentElement || root;
          observer.observe(observationTarget, {
            childList: true,
            subtree: true,
            characterData: true
          });
        } catch (_) {
          observer = null;
        }
      }

      if (typeof setTimer !== "function") {
        finish(
          getChatGptRootSidebarHydrationState(root, expectedRootUrl),
          false,
          "collector_root_hydration_timeout");
        return;
      }
      timeoutTimer = setTimer(() => {
        if (!settled) finish(
          getChatGptRootSidebarHydrationState(root, expectedRootUrl),
          false,
          "collector_root_hydration_timeout");
      }, timeoutMs);
      inspect();
    });
  }

  function scrollMetricsFor(container) {
    if (!container
      || typeof container.scrollTop !== "number"
      || typeof container.scrollHeight !== "number"
      || typeof container.clientHeight !== "number") return null;
    const scrollTop = Math.max(0, Number(container.scrollTop) || 0);
    const scrollHeight = Math.max(0, Number(container.scrollHeight) || 0);
    const clientHeight = Math.max(0, Number(container.clientHeight) || 0);
    const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
    return {
      scrollTop,
      scrollHeight,
      clientHeight,
      canScroll: scrollHeight > clientHeight,
      atBottom: scrollTop >= maxScrollTop - 1
    };
  }

  function canMoveScrollContainer(container, metrics = scrollMetricsFor(container)) {
    if (!metrics?.canScroll) return false;
    const originalTop = metrics.scrollTop;
    const maxScrollTop = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
    const probeTop = originalTop < maxScrollTop
      ? Math.min(maxScrollTop, originalTop + 1)
      : Math.max(0, originalTop - 1);
    if (probeTop === originalTop) return false;
    try {
      container.scrollTop = probeTop;
      const movedTop = Number(container.scrollTop);
      container.scrollTop = originalTop;
      return Number.isFinite(movedTop) && Math.abs(movedTop - originalTop) > 0;
    } catch (_) {
      try { container.scrollTop = originalTop; } catch (_) { }
      return false;
    }
  }

  function projectSectionState(root = globalThis.document, sidebarOverride = null) {
    const sidebar = sidebarOverride || findSidebarRoot(root);
    const rows = sidebar ? projectRowsInSidebar(sidebar, documentHref(root)) : [];
    const markers = sidebar
      ? uniqueElements(projectSectionSelectors, sidebar).filter((element) => isVisible(element))
      : [];
    let projectAnchors = [];
    try {
      projectAnchors = sidebar
        ? metadataElementsInRoot(sidebar)
          .filter((anchor) => isProjectRouteUrl(metadataHrefFromElement(anchor)))
        : [];
    } catch (_) {
      projectAnchors = [];
    }
    return {
      rows,
      projectSectionFound: rows.length > 0 || markers.length > 0 || projectAnchors.length > 0
    };
  }

  function sidebarScrollTelemetry(
    root = globalThis.document,
    scrollContainer = null,
    noGrowthCount = 0,
    discoveredProjectCount = 0,
    scrollComplete = null,
    sidebarOverride = null,
    scrollDirection = null,
    restoreCount = 0) {
    const sidebar = sidebarOverride || findSidebarRoot(root);
    const metrics = scrollMetricsFor(scrollContainer);
    const section = projectSectionState(root, sidebar);
    const normalizedNoGrowth = Math.max(0, Math.round(Number(noGrowthCount) || 0));
    const normalizedProjectCount = Math.max(0, Math.round(Number(discoveredProjectCount) || 0));
    const complete = scrollComplete === null
      ? Boolean(metrics && (!metrics.canScroll || metrics.atBottom || normalizedNoGrowth >= 2))
      : scrollComplete === true;
    return {
      sidebar_scroll_top: metrics ? Math.round(metrics.scrollTop) : 0,
      sidebar_scroll_height: metrics ? Math.round(metrics.scrollHeight) : 0,
      sidebar_client_height: metrics ? Math.round(metrics.clientHeight) : 0,
      sidebar_can_scroll: metrics?.canScroll === true,
      sidebar_at_bottom: metrics?.atBottom === true,
      visible_project_rows: section.rows.length,
      discovered_project_count: normalizedProjectCount,
      project_section_found: section.projectSectionFound,
      no_growth_count: normalizedNoGrowth,
      sidebar_scroll_complete: complete,
      sidebar_scroll_container_found: Boolean(scrollContainer),
      sidebar_scroll_direction: scrollDirection === "down" || scrollDirection === "none"
        ? scrollDirection
        : null,
      sidebar_restore_count: Math.max(0, Math.round(Number(restoreCount) || 0))
    };
  }

  function discoveredScrollContainerCandidates(root) {
    if (!root?.querySelectorAll) return [];
    const candidates = [];
    let elements = [];
    try { elements = Array.from(root.querySelectorAll("*")); } catch (_) { return candidates; }
    const ownerWindow = root?.defaultView || root?.ownerDocument?.defaultView || globalThis;
    for (const element of elements) {
      const metrics = scrollMetricsFor(element);
      if (!metrics) continue;
      let overflowY = "";
      try { overflowY = ownerWindow?.getComputedStyle?.(element)?.overflowY || ""; } catch (_) { }
      if (metrics.canScroll || /(?:auto|scroll|overlay)/i.test(overflowY)) candidates.push(element);
    }
    return candidates;
  }

  function findSidebarScrollContainer(root = globalThis.document, sidebarOverride = null) {
    const sidebar = sidebarOverride || findSidebarRoot(root);
    const rows = projectRowsInSidebar(sidebar, documentHref(root));
    const candidates = [sidebar, ...uniqueElements(sidebarScrollContainerSelectors, sidebar)];
    const containsProjectRow = (candidate) => candidate === sidebar
      || rows.some((row) => candidate === row || candidate.contains?.(row));
    const hasScrollMetrics = (candidate) => candidate
      && typeof candidate.scrollTop === "number"
      && typeof candidate.scrollHeight === "number"
      && typeof candidate.clientHeight === "number";
    const scrollable = candidates.find((candidate) =>
      containsProjectRow(candidate)
      && hasScrollMetrics(candidate)
      && candidate.scrollHeight > candidate.clientHeight);
    if (scrollable) return scrollable;
    return candidates.find((candidate) => containsProjectRow(candidate) && hasScrollMetrics(candidate)) || sidebar;
  }

  function isMoreButton(element) {
    if (!element || !isVisible(element)) return false;
    const explicitlyMarked = attributeValue(element, "data-sidebar-more") === "true";
    // ChatGPT uses the same role/button primitives for Project rows, Chat
    // rows, and utility controls. Only a dedicated More marker may override
    // the identity guard; a generic sidebar item must never be clicked just
    // because its title happens to contain "more"/"さらに表示".
    if (!explicitlyMarked && attributeValue(element, "data-sidebar-item") === "true") return false;
    if (!explicitlyMarked && conversationIdFromElement(element)) return false;
    if (explicitlyMarked) return true;
    const visible = visibleElementText(element);
    const label = `${visible} ${attributeValue(element, "aria-label")}`.trim();
    // A role=button is also used by Project and conversation rows. The old
    // discovery route only expands an actual utility button unless ChatGPT
    // marks it explicitly, so a generic row named "さらに表示" cannot be
    // navigated or treated as a discovery control.
    return element.tagName === "BUTTON" && moreButtonTextPattern.test(label);
  }

  function findMoreButtons(root = globalThis.document, sidebarOverride = null) {
    const sidebar = sidebarOverride || findSidebarRoot(root);
    return sortInDocumentOrder(uniqueElements(moreButtonSelectors, sidebar)
      .filter((element) => isMoreButton(element)));
  }

  function waitForSidebarMutation(root, timeoutMs = 150) {
    const MutationObserverCtor = root?.ownerDocument?.defaultView?.MutationObserver
      || globalThis.MutationObserver;
    if (typeof MutationObserverCtor !== "function" || typeof globalThis.setTimeout !== "function") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let observer = null;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (timer !== null) globalThis.clearTimeout?.(timer);
        resolve();
      };
      try {
        observer = new MutationObserverCtor(finish);
        observer.observe(root, { childList: true, subtree: true, characterData: true });
      } catch (_) {
        observer = null;
      }
      timer = globalThis.setTimeout(finish, Math.max(20, Number(timeoutMs) || 150));
    });
  }

  async function expandSidebarMoreButtons(root, options = {}, sidebarOverride = null) {
    const maxClicks = Math.max(0, Math.min(12, Number(options.maxMoreClicks) || 8));
    const clicked = new Set();
    let clicks = 0;
    while (clicks < maxClicks) {
      const button = findMoreButtons(root, sidebarOverride)
        .find((candidate) => !clicked.has(candidate));
      if (!button) break;
      clicked.add(button);
      try { button.click?.(); } catch (_) { break; }
      clicks += 1;
      await waitForSidebarMutation(root, options.settleMs);
    }
    return clicks;
  }

  function upsertContextProject(projects, item) {
    if (!item || typeof item !== "object") return null;
    const projectId = metadataIdentifier(item.project_id || item.projectId);
    const title = metadataTitle(item.title);
    const url = chatGptMetadataUrl(item.url);
    const discoveryKey = metadataIdentifier(item.discovery_key || item.discoveryKey);
    const discoveryIndex = Number.isSafeInteger(item.discovery_index)
      && item.discovery_index >= 0
      ? item.discovery_index
      : (Number.isSafeInteger(item.discoveryIndex) && item.discoveryIndex >= 0
        ? item.discoveryIndex
        : null);
    const titleKey = metadataTextKey(title);
    let existing = projectId
      ? projects.find((candidate) => candidate.project_id === projectId)
      : null;
    if (!existing && discoveryKey) {
      const keyCandidate = projects.find((candidate) => candidate.discovery_key === discoveryKey);
      // A discovery key may join a later metadata-bearing observation to the
      // same row, but it must not override a different stable Project ID.
      if (keyCandidate && (!projectId
        || !keyCandidate.project_id
        || keyCandidate.project_id === projectId)) {
        existing = keyCandidate;
      }
    }
    if (!existing && projectId && titleKey) {
      const titleCandidates = projects.filter((candidate) => !candidate.project_id
        && metadataTextKey(candidate.title) === titleKey);
      // Title fallback is retained only for the unambiguous historical case.
      // If two same-title rows exist, creating a new ID-bearing entry is safer
      // than assigning that ID to the wrong Project.
      if (titleCandidates.length === 1) existing = titleCandidates[0];
    }
    if (!existing && projectId) {
      const fallbackCandidates = projects.filter((candidate) => !candidate.project_id
        && fallbackProjectIdFromTitle(candidate.title) === projectId);
      if (fallbackCandidates.length === 1) existing = fallbackCandidates[0];
    }
    if (!existing && !projectId && !discoveryKey && titleKey) {
      const titleCandidates = projects.filter((candidate) => !candidate.project_id
        && metadataTextKey(candidate.title) === titleKey);
      if (titleCandidates.length === 1) existing = titleCandidates[0];
    }

    if (existing) {
      if (projectId) existing.project_id = projectId;
      if (title && (!existing.title || projectFallbackTitlePattern.test(existing.title))) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (discoveryKey && !existing.discovery_key) existing.discovery_key = discoveryKey;
      if (discoveryIndex !== null && existing.discovery_index === undefined) {
        existing.discovery_index = discoveryIndex;
      }
      return existing;
    }
    if (!title || (!projectId && !discoveryKey)) return null;
    const entry = {
      ...(projectId ? { project_id: projectId } : {}),
      title,
      ...(url ? { url } : {}),
      ...(discoveryKey ? { discovery_key: discoveryKey } : {}),
      ...(discoveryIndex !== null ? { discovery_index: discoveryIndex } : {})
    };
    projects.push(entry);
    return entry;
  }

  function mergeContextProjectCatalog(destination, source) {
    for (const project of source?.projects || []) upsertContextProject(destination.projects, project);
  }

  function mergeContextConversationCatalog(destination, source) {
    for (const item of source?.conversations || []) {
      if (!item?.conversation_id) continue;
      const existing = destination.conversations.find((candidate) =>
        candidate.conversation_id === item.conversation_id);
      if (!existing) {
        destination.conversations.push({ ...item });
        continue;
      }
      if (item.title && (!existing.title || existing.title === existing.conversation_id)) existing.title = item.title;
      if (item.url && !existing.url) existing.url = item.url;
      if (item.project_id && !existing.project_id) existing.project_id = item.project_id;
      if (item.project_title && !existing.project_title) existing.project_title = item.project_title;
    }
  }

  function collectContextEntries(
    root = globalThis.document,
    url = globalThis.location?.href,
    sidebarOverride = null) {
    const projects = [];
    const conversations = [];
    const projectById = new Map();
    const conversationById = new Map();
    const sidebarRoot = sidebarOverride || findSidebarRoot(root);
    let anchors = [];
    try { anchors = Array.from(sidebarRoot?.querySelectorAll?.("a[href]") || []); } catch (_) { anchors = []; }
    const projectAnchors = anchors.filter((anchor) => isProjectHomeUrl(attributeValue(anchor, "href")));
    const projectRows = projectRowsInSidebar(sidebarRoot, documentHref(root));
    const currentProjectId = projectIdFromUrl(url);

    const upsertProject = (projectId, title, projectUrl, discoveryKey, discoveryIndex = null) => {
      const entry = upsertContextProject(projects, {
        ...(projectId ? { project_id: projectId } : {}),
        title,
        ...(projectUrl ? { url: projectUrl } : {}),
        ...(discoveryKey ? { discovery_key: discoveryKey } : {}),
        ...(Number.isSafeInteger(discoveryIndex) && discoveryIndex >= 0
          ? { discovery_index: discoveryIndex }
          : {})
      });
      if (entry?.project_id) projectById.set(entry.project_id, entry);
      return entry;
    };

    // This is the old successful discovery route: read the visible Project
    // rows and anchors from the known history sidebar. Rows are never clicked
    // and no Project ID is inferred from a navigation side effect.
    for (const [discoveryIndex, row] of projectRows.entries()) {
      const title = visibleTitleFromElement(row);
      if (!title) continue;
      // Keep the historical metadata-only scan, but accept the stable
      // Project carrier ChatGPT currently renders inside the row.  It may be
      // a non-anchor href for a Project conversation (`/g/g-p-*/c/*`).
      // `projectIdentityFromElement` normalizes that carrier to `/project`
      // without clicking or changing the discovery/scroll path.
      const rowIdentity = projectIdentityFromElement(row, url);
      const projectId = rowIdentity.projectId || projectIdFromElement(row, url);
      const projectUrl = rowIdentity.projectUrl || projectUrlFromElement(row, url);
      const discoveryKey = projectDiscoveryKeyForRow(row, title, discoveryIndex);
      upsertProject(
        projectId,
        title,
        projectUrl,
        discoveryKey,
        discoveryIndex);
    }

    // Current ChatGPT Project rows are rendered as expandable buttons and do
    // not expose the Project ID in their DOM attributes. The current route is
    // the only safe ID source in that case. Associate it only with the
    // visibly expanded row; never infer an ID from a title or from row order.
    if (currentProjectId) {
      const expandedProjectIndex = projectRows.findIndex((row) =>
        attributeValue(row, "aria-expanded").toLowerCase() === "true");
      const expandedProjectRow = expandedProjectIndex >= 0
        ? projectRows[expandedProjectIndex]
        : null;
      const currentProjectTitle = visibleTitleFromElement(expandedProjectRow, "");
      if (currentProjectTitle) {
        const currentProjectUrl = isProjectHomeUrl(url)
          ? chatGptMetadataUrl(url, url)
          : projectUrlFromConversationUrl(url, currentProjectId);
        upsertProject(
          currentProjectId,
          currentProjectTitle,
          currentProjectUrl,
          projectDiscoveryKeyForRow(
            expandedProjectRow,
            currentProjectTitle,
            expandedProjectIndex),
          expandedProjectIndex);
      }
    }

    for (const anchor of projectAnchors) {
      const projectUrl = chatGptMetadataUrl(attributeValue(anchor, "href"), url);
      const projectId = projectIdFromUrl(projectUrl);
      if (!projectId) continue;
      upsertProject(projectId, projectTitleFromAnchor(anchor, projectId), projectUrl);
    }

    for (const anchor of anchors) {
      const href = chatGptMetadataUrl(attributeValue(anchor, "href"), url);
      const conversationId = conversationIdFromUrl(href);
      if (!href || !conversationId) continue;
      const projectId = projectIdFromUrl(href);
      const projectTitle = projectId
        ? projectTitleFromRelatedAnchor(anchor, projectId, projectAnchors, projectRows)
          || projectById.get(projectId)?.title
        : null;
      if (projectId) {
        const projectUrl = projectUrlFromConversationUrl(href, projectId)
          || projectUrlFromElement(anchor, url);
        const existingProject = projectById.get(projectId);
        const project = upsertProject(projectId, projectTitle, projectUrl);
        if (project) projectById.set(projectId, project);
        else if (existingProject) projectById.set(projectId, existingProject);
      }
      const entry = {
        conversation_id: conversationId,
        title: conversationTitleFromAnchor(anchor, conversationId),
        url: href
          || (projectId
            ? `https://chatgpt.com/g/${encodeURIComponent(projectId)}/c/${encodeURIComponent(conversationId)}`
            : `https://chatgpt.com/c/${encodeURIComponent(conversationId)}`),
        ...(projectId ? { project_id: projectId } : {}),
        ...(projectTitle ? { project_title: projectTitle } : {})
      };
      const existing = conversationById.get(conversationId);
      if (!existing) {
        conversationById.set(conversationId, entry);
        conversations.push(entry);
      } else {
        if (entry.title && (!existing.title || existing.title === conversationId)) existing.title = entry.title;
        if (entry.project_id && !existing.project_id) existing.project_id = entry.project_id;
        if (entry.project_title && !existing.project_title) existing.project_title = entry.project_title;
        if (entry.url && !existing.url) existing.url = entry.url;
      }
    }

    return { projects, conversations };
  }

  function canonicalProjectUrl(projectId, value = null, baseUrl = globalThis.location?.href) {
    const id = metadataIdentifier(projectId);
    if (!id || !id.toLowerCase().startsWith("g-p-")) return null;
    const supplied = chatGptMetadataUrl(value, baseUrl);
    if (supplied && isProjectHomeUrl(supplied)) return supplied;
    try {
      const base = new URL(supplied || baseUrl || "https://chatgpt.com/");
      if (base.protocol !== "https:" || base.hostname !== "chatgpt.com" || base.port !== "") return null;
      return `${base.origin}/g/${encodeURIComponent(id)}/project`;
    } catch (_) {
      return null;
    }
  }

  function projectIdentityFromUrlCandidate(value, baseUrl = globalThis.location?.href) {
    const canonical = chatGptMetadataUrl(value, baseUrl);
    if (!canonical) return null;
    const projectId = projectIdFromUrl(canonical);
    if (!projectId) return null;

    // The historical Project discovery path also found Project identity on
    // conversation links rendered inside the Project row.  Those links use
    // `/g/g-p-.../c/...`, not the Project home route.  Normalize that
    // metadata-only carrier to the canonical Project URL without navigating.
    const projectUrl = isProjectRouteUrl(canonical)
      ? canonicalProjectUrl(projectId, canonical, baseUrl)
      : conversationIdFromUrl(canonical)
        ? projectUrlFromConversationUrl(canonical, projectId)
        : null;
    if (!projectId || !projectUrl) return null;
    return { projectId, projectUrl };
  }

  function projectIdentityFromProjectMetadata(project, baseUrl = globalThis.location?.href) {
    const rawProjectId = project?.project_id || project?.projectId;
    const explicitProjectId = metadataIdentifier(rawProjectId);
    if (rawProjectId !== undefined
      && rawProjectId !== null
      && String(rawProjectId).trim().length > 0
      && (!explicitProjectId || !explicitProjectId.toLowerCase().startsWith("g-p-"))) {
      return { reason: "invalid_project_id" };
    }

    const fromUrl = projectIdentityFromUrlCandidate(project?.url, baseUrl);
    const rawUrl = typeof project?.url === "string" ? project.url.trim() : "";
    if (rawUrl && !fromUrl) return { reason: "invalid_project_url" };
    if (explicitProjectId && fromUrl && explicitProjectId !== fromUrl.projectId) {
      return { reason: "project_id_url_mismatch" };
    }
    const projectId = explicitProjectId || fromUrl?.projectId || null;
    if (!projectId) return { reason: "missing_stable_identity" };
    const projectUrl = canonicalProjectUrl(projectId, fromUrl?.projectUrl || project?.url, baseUrl);
    if (!projectUrl) return { reason: "invalid_project_url" };
    return { projectId, projectUrl };
  }

  function projectIdentityCarrier(element, baseUrl = globalThis.location?.href) {
    if (!element) return false;
    const tagName = String(element.tagName || "").toLowerCase();
    if (tagName === "a") return true;
    for (const name of [
      "data-project-id",
      "data-project-id-value",
      "data-project-url",
      "data-href",
      "data-url",
      "data-conversation-url"
    ]) {
      const value = attributeValue(element, name);
      if (!value) continue;
      if (name.startsWith("data-project-") || projectIdentityFromUrlCandidate(value, baseUrl)) return true;
    }
    return false;
  }

  function findElementByAriaControlId(root, controlId) {
    const normalizedId = String(controlId ?? "").trim();
    // `aria-controls` values are opaque DOM IDs.  Do not interpolate them
    // into a selector; compare the attribute after resolving through the DOM
    // API so a malformed value cannot escape the collector's metadata scope.
    if (!normalizedId || normalizedId.length > 256 || /\s/.test(normalizedId)) return null;
    const sources = [];
    const addSource = (source) => {
      if (!source || sources.includes(source)) return;
      sources.push(source);
    };
    addSource(root);
    addSource(root?.ownerDocument);
    addSource(globalThis.document);
    for (const source of sources) {
      try {
        const direct = source.getElementById?.(normalizedId);
        if (direct) return direct;
      } catch (_) { }
    }
    for (const source of sources) {
      try {
        const candidates = source.querySelectorAll?.("[id]") || [];
        for (const candidate of candidates) {
          if (attributeValue(candidate, "id") === normalizedId) return candidate;
        }
      } catch (_) { }
    }
    return null;
  }

  function projectDisclosureRegionForRow(row, root = row?.ownerDocument || globalThis.document) {
    const controls = attributeValue(row, "aria-controls").trim();
    if (!controls) return null;
    // ARIA permits a space-separated list.  ChatGPT normally exposes one
    // controlled list, but accepting the first resolvable ID keeps this read
    // bounded and avoids treating arbitrary Sidebar nodes as a Project.
    for (const controlId of controls.split(/\s+/).slice(0, 4)) {
      const region = findElementByAriaControlId(root, controlId);
      if (!region || region === row) continue;
      const rowDocument = row?.ownerDocument;
      const regionDocument = region?.ownerDocument;
      if (rowDocument && regionDocument && rowDocument !== regionDocument) continue;
      return region;
    }
    return null;
  }

  function projectDisclosureElements(region) {
    if (!region) return [];
    const elements = [region];
    try { elements.push(...Array.from(region.querySelectorAll?.("*") || [])); } catch (_) { }
    return elements;
  }

  function projectDisclosureStructureForRow(
    row,
    root = row?.ownerDocument || globalThis.document,
    baseUrl = globalThis.location?.href) {
    const controls = attributeValue(row, "aria-controls").trim();
    const region = projectDisclosureRegionForRow(row, root);
    const regionElements = projectDisclosureElements(region);
    const projectChatLinks = new Set();
    const projectHomeLinks = new Set();
    for (const element of regionElements) {
      for (const attribute of [
        "href",
        "data-project-url",
        "data-href",
        "data-url",
        "data-conversation-url"
      ]) {
        const candidateUrl = chatGptMetadataUrl(attributeValue(element, attribute), baseUrl);
        const identity = projectIdentityFromUrlCandidate(candidateUrl, baseUrl);
        if (!identity) continue;
        const conversationId = conversationIdFromUrl(candidateUrl);
        if (conversationId) projectChatLinks.add(`${identity.projectId}:${conversationId}`);
        else projectHomeLinks.add(identity.projectId);
      }
    }
    const identity = region
      ? projectIdentityFromElement(region, baseUrl)
      : { reason: "controlled_region_not_found" };
    const ariaExpanded = safeAriaToken(row, "aria-expanded");
    return {
      rowIsDisclosureControl: Boolean(controls),
      ariaControlsPresent: Boolean(controls),
      controlledRegionFound: Boolean(region),
      controlledRegionVisible: Boolean(region && isVisible(region)),
      controlledRegionElementCount: regionElements.length,
      controlledRegionProjectChatLinkCount: projectChatLinks.size,
      controlledRegionProjectHomeLinkCount: projectHomeLinks.size,
      controlledRegionProjectIdentityPresent: Boolean(identity?.projectId),
      controlledRegionIdentityReason: identity?.projectId
        ? "none"
        : (identity?.reason || "missing_stable_identity"),
      ariaExpanded,
      identity,
      region
    };
  }

  function projectIdentityElementsForRow(row, baseUrl = globalThis.location?.href) {
    const elements = [];
    const seen = new Set();
    const add = (element) => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      elements.push(element);
    };
    add(row);
    try {
      for (const element of row?.querySelectorAll?.("*") || []) add(element);
    } catch (_) { }
    // A current ChatGPT Project row is a disclosure button. Its controlled
    // chat list is a sibling region, not a descendant, so include only the
    // region explicitly named by aria-controls. This is still a metadata-only
    // read and never broadens the scan to generic Sidebar controls.
    const controlledRegion = projectDisclosureRegionForRow(row);
    for (const element of projectDisclosureElements(controlledRegion)) add(element);
    let ancestor = row?.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
      if (projectIdentityCarrier(ancestor, baseUrl)) add(ancestor);
    }
    return elements;
  }

  function projectIdentityFromElement(element, baseUrl = globalThis.location?.href) {
    let invalidReason = null;
    for (const candidate of projectIdentityElementsForRow(element, baseUrl)) {
      const rawProjectId = attributeValue(candidate, "data-project-id")
        || attributeValue(candidate, "data-project-id-value");
      const explicitProjectId = metadataIdentifier(rawProjectId);
      if (rawProjectId && (!explicitProjectId || !explicitProjectId.toLowerCase().startsWith("g-p-"))) {
        invalidReason = invalidReason || "invalid_project_id";
        continue;
      }

      let fromUrl = null;
      for (const attribute of [
        "data-project-url",
        "href",
        "data-href",
        "data-url",
        "data-conversation-url"
      ]) {
        const candidateUrl = attributeValue(candidate, attribute);
        if (!candidateUrl) continue;
        const identity = projectIdentityFromUrlCandidate(candidateUrl, baseUrl);
        if (identity) {
          fromUrl = identity;
          break;
        }
      }
      if (explicitProjectId && fromUrl && explicitProjectId !== fromUrl.projectId) {
        return { reason: "project_id_url_mismatch" };
      }
      const projectId = explicitProjectId || fromUrl?.projectId || null;
      if (!projectId) continue;
      const projectUrl = canonicalProjectUrl(projectId, fromUrl?.projectUrl, baseUrl);
      if (projectUrl) return { projectId, projectUrl };
      invalidReason = invalidReason || "invalid_project_url";
    }
    return { reason: invalidReason || "missing_stable_identity" };
  }

  function safeAriaToken(element, name) {
    const value = attributeValue(element, name).trim().toLowerCase();
    if (!value) return "none";
    if (["true", "false", "menu", "listbox", "dialog", "tree", "grid", "none"].includes(value)) {
      return value;
    }
    return "other";
  }

  function projectInteractiveControlFlags(element) {
    const tagName = String(element?.tagName || "").toLowerCase();
    const role = attributeValue(element, "role").trim().toLowerCase();
    const ariaHasPopup = attributeValue(element, "aria-haspopup").trim().toLowerCase();
    const ariaLabelAndTitle = [
      attributeValue(element, "aria-label"),
      attributeValue(element, "title")
    ].join(" ");
    const dataSemantic = [
      attributeValue(element, "data-testid"),
      attributeValue(element, "data-test-id"),
      attributeValue(element, "data-state")
    ].join(" ");
    // Do not treat arbitrary class/id tokens such as `group/menu-item` as
    // proof that the Project row is a menu control.  ChatGPT uses menu-like
    // CSS names for ordinary Project rows.  Only accessibility semantics and
    // narrowly named test hooks are strong enough to exclude a target.
    const hasMenuSemantic = /(?:\bmenu\b|\bcontext[-_ ]?menu\b|メニュー|コンテキスト)/i.test(
      ariaLabelAndTitle);
    const hasOverflowSemantic = /(?:\boverflow\b|\bkebab\b|\bellipsis\b|\bmore\b|\boptions?\b|\bactions?\b|さらに表示|もっと見る|その他(?:の| )?(?:オプション|操作)?)/i.test(
      ariaLabelAndTitle);
    const hasKnownMenuData = /(?:^|[-_ ])(?:menu-button|menu-trigger|menu-control|context-menu|overflow-menu)(?:$|[-_ ])/i.test(dataSemantic);
    const hasKnownOverflowData = /(?:^|[-_ ])(?:overflow-button|kebab-button|ellipsis-button|more-options|more-button)(?:$|[-_ ])/i.test(dataSemantic);
    const menu = role === "menu"
      || role === "menuitem"
      || (ariaHasPopup.length > 0 && ariaHasPopup !== "false")
      || hasMenuSemantic
      || hasKnownMenuData;
    const overflow = hasOverflowSemantic || hasKnownOverflowData;
    let menuControlReason = "none";
    if (role === "menu") menuControlReason = "menu_role";
    else if (role === "menuitem") menuControlReason = "menuitem_role";
    else if (ariaHasPopup === "menu") menuControlReason = "aria_haspopup_menu";
    else if (ariaHasPopup.length > 0 && ariaHasPopup !== "false") menuControlReason = "aria_haspopup";
    else if (hasOverflowSemantic && ariaLabelAndTitle.trim().length > 0) menuControlReason = "overflow_aria_label";
    else if (hasKnownOverflowData) menuControlReason = "overflow_data_attribute";
    else if (hasKnownMenuData) menuControlReason = "known_menu_selector";
    else if (hasMenuSemantic) menuControlReason = "menu_aria_label";
    return {
      tagName,
      isMenuControl: menu,
      isOverflowControl: overflow,
      menuControlReason
    };
  }

  function projectInteractiveNavigationValue(element) {
    for (const attribute of [
      "href",
      "data-project-url",
      "data-href",
      "data-url",
      "data-conversation-url"
    ]) {
      const value = attributeValue(element, attribute).trim();
      if (value) return value;
    }
    return "";
  }

  function projectInteractiveShape(element) {
    const tagName = String(element?.tagName || "").toLowerCase();
    const role = attributeValue(element, "role").trim().toLowerCase();
    const hasHref = attributeValue(element, "href").trim().length > 0;
    const hasTabIndex = hasAttribute(element, "tabindex");
    const hasInlineClick = typeof element?.onclick === "function" || hasAttribute(element, "onclick");
    return (tagName === "a" && hasHref)
      || role === "link"
      || tagName === "button"
      || role === "button"
      || hasTabIndex
      || hasInlineClick;
  }

  function projectInteractivePriority(element) {
    const tagName = String(element?.tagName || "").toLowerCase();
    const role = attributeValue(element, "role").trim().toLowerCase();
    if (tagName === "a" && attributeValue(element, "href").trim()) return 0;
    if (role === "link") return 1;
    if (tagName === "button") return 2;
    if (role === "button") return 2;
    return 3;
  }

  function projectInteractiveTargetType(element) {
    if (!element) return "none";
    const tagName = String(element.tagName || "").toLowerCase();
    const role = attributeValue(element, "role").trim().toLowerCase();
    if (tagName === "a" && attributeValue(element, "href").trim()) return "anchor";
    if (role === "link") return "role_link";
    if (tagName === "button") return "button";
    if (role === "button") return "role_button";
    if (hasAttribute(element, "tabindex")) return "tabindex";
    if (typeof element.onclick === "function" || hasAttribute(element, "onclick")) return "onclick";
    return "interactive";
  }

  function projectRowDescendantsForInspection(row) {
    const descendants = [];
    const shadowDescendants = new Set();
    const seen = new Set();
    const add = (element, fromShadow = false) => {
      if (!element || seen.has(element)) return;
      seen.add(element);
      descendants.push(element);
      if (fromShadow) shadowDescendants.add(element);
    };
    try {
      for (const element of row?.querySelectorAll?.("*") || []) add(element);
    } catch (_) { }
    const visitedShadowHosts = new Set();
    const visitShadowRoot = (host, depth = 0) => {
      if (!host || depth > 8 || visitedShadowHosts.has(host)) return;
      visitedShadowHosts.add(host);
      let shadowRoot = null;
      try { shadowRoot = host.shadowRoot || null; } catch (_) { shadowRoot = null; }
      if (!shadowRoot) return;
      let shadowElements = [];
      try { shadowElements = Array.from(shadowRoot.querySelectorAll?.("*") || []); } catch (_) { shadowElements = []; }
      for (const element of shadowElements) add(element, true);
      for (const element of shadowElements) visitShadowRoot(element, depth + 1);
    };
    visitShadowRoot(row);
    for (const element of [...descendants]) visitShadowRoot(element);
    return {
      descendants,
      shadowDescendants,
      shadowRootPresent: shadowDescendants.size > 0
    };
  }

  function projectInteractiveAncestorForRow(row) {
    let current = row?.parentElement || null;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (projectInteractiveShape(current)) return current;
    }
    return null;
  }

  function projectRowHasInteractiveEvidence(row, baseUrl = globalThis.location?.href) {
    if (!row) return false;
    const tagName = String(row.tagName || "").toLowerCase();
    const role = attributeValue(row, "role").trim().toLowerCase();
    const navigationValue = projectInteractiveNavigationValue(row);
    return Boolean(
      (tagName === "a" && navigationValue && projectIdentityFromUrlCandidate(navigationValue, baseUrl))
      || tagName === "button"
      || role === "link"
      || role === "button"
      || hasAttribute(row, "tabindex")
      || typeof row.onclick === "function"
      || hasAttribute(row, "onclick"));
  }

  function projectRowStructureFor(row, baseUrl = globalThis.location?.href) {
    const inspection = projectRowDescendantsForInspection(row);
    const descendants = inspection.descendants;
    const rowControls = projectInteractiveControlFlags(row);
    const disclosure = projectDisclosureStructureForRow(row, row?.ownerDocument, baseUrl);
    const nearestInteractiveAncestor = projectInteractiveAncestorForRow(row);
    const count = (predicate) => descendants.reduce((total, element) => total + (predicate(element) ? 1 : 0), 0);
    const tagNameOf = (element) => String(element?.tagName || "").toLowerCase();
    const roleOf = (element) => attributeValue(element, "role").trim().toLowerCase();
    const hrefPresent = (element) => attributeValue(element, "href").trim().length > 0;
    return {
      descendants,
      rowTag: String(row?.tagName || "").toUpperCase() || "none",
      rowRole: attributeValue(row, "role").trim().toLowerCase() || "none",
      rowTabIndexPresent: hasAttribute(row, "tabindex"),
      rowHrefPresent: hrefPresent(row),
      rowAriaHasPopup: safeAriaToken(row, "aria-haspopup"),
      rowAriaExpanded: safeAriaToken(row, "aria-expanded"),
      rowAriaControlsPresent: attributeValue(row, "aria-controls").trim().length > 0,
      directChildCount: (() => {
        try { return Array.from(row?.children || []).length; } catch (_) { return 0; }
      })(),
      descendantCount: descendants.length,
      descendantAnchorCount: count((element) => tagNameOf(element) === "a"),
      descendantButtonCount: count((element) => tagNameOf(element) === "button"),
      descendantRoleLinkCount: count((element) => roleOf(element) === "link"),
      descendantRoleButtonCount: count((element) => roleOf(element) === "button"),
      descendantTabIndexCount: count((element) => hasAttribute(element, "tabindex")),
      descendantHrefCount: count(hrefPresent),
      shadowRootPresent: inspection.shadowRootPresent,
      shadowDescendantCount: inspection.shadowDescendants.size,
      nearestInteractiveAncestorPresent: Boolean(nearestInteractiveAncestor),
      nearestInteractiveAncestorTag: nearestInteractiveAncestor
        ? String(nearestInteractiveAncestor.tagName || "").toUpperCase() || "UNKNOWN"
        : "none",
      nearestInteractiveAncestorRole: nearestInteractiveAncestor
        ? (attributeValue(nearestInteractiveAncestor, "role").trim().toLowerCase() || "none")
        : "none",
      rowIsMenuControl: rowControls.isMenuControl,
      rowIsOverflowControl: rowControls.isOverflowControl,
      rowIsDisclosureControl: disclosure.rowIsDisclosureControl,
      controlledRegionFound: disclosure.controlledRegionFound,
      controlledRegionVisible: disclosure.controlledRegionVisible,
      controlledRegionElementCount: disclosure.controlledRegionElementCount,
      controlledRegionProjectChatLinkCount: disclosure.controlledRegionProjectChatLinkCount,
      controlledRegionProjectHomeLinkCount: disclosure.controlledRegionProjectHomeLinkCount,
      controlledRegionProjectIdentityPresent: disclosure.controlledRegionProjectIdentityPresent,
      controlledRegionIdentityReason: disclosure.controlledRegionIdentityReason,
      rowInteractiveEvidence: projectRowHasInteractiveEvidence(row, baseUrl),
      rowMenuControlReason: rowControls.menuControlReason
    };
  }

  function projectInteractiveSelectionReason(element) {
    const type = projectInteractiveTargetType(element);
    return {
      anchor: "anchor_href",
      role_link: "role_link",
      button: "button",
      role_button: "role_button",
      tabindex: "tabindex",
      onclick: "onclick",
      interactive: "interactive"
    }[type] || "interactive";
  }

  function projectElementIsInsideRow(row, element) {
    if (!row || !element) return false;
    if (row === element) return true;
    try {
      if (typeof row.contains === "function") return row.contains(element) === true;
    } catch (_) { }
    let current = element?.parentElement;
    for (let depth = 0; current && depth < 64; depth += 1, current = current.parentElement) {
      if (current === row) return true;
    }
    let rootNode = null;
    try { rootNode = element?.getRootNode?.() || null; } catch (_) { rootNode = null; }
    for (let depth = 0; rootNode?.host && depth < 8; depth += 1) {
      if (rootNode.host === row) return true;
      if (typeof row.contains === "function" && row.contains(rootNode.host)) return true;
      try { rootNode = rootNode.host.getRootNode?.() || null; } catch (_) { rootNode = null; }
    }
    return false;
  }

  function projectInteractiveTargetForRow(row, baseUrl = globalThis.location?.href) {
    const structure = projectRowStructureFor(row, baseUrl);
    const descendants = structure.descendants || [];
    const shapedCandidates = descendants.filter((element) => projectInteractiveShape(element));
    const candidates = shapedCandidates.filter((element) => {
      const controls = projectInteractiveControlFlags(element);
      if (controls.isMenuControl || controls.isOverflowControl) return false;
      const navigationValue = projectInteractiveNavigationValue(element);
      return !navigationValue || Boolean(projectIdentityFromUrlCandidate(navigationValue, baseUrl));
    });
    const visibleCandidates = candidates.filter((element) => {
      try { return isVisible(element); } catch (_) { return false; }
    });
    visibleCandidates.sort((left, right) => projectInteractivePriority(left) - projectInteractivePriority(right));
    let target = visibleCandidates[0] || null;
    let targetType = projectInteractiveTargetType(target);
    let selectionReason = target ? projectInteractiveSelectionReason(target) : null;
    const rowCanFallback = !target
      && structure.rowInteractiveEvidence
      && !structure.rowIsMenuControl
      && !structure.rowIsOverflowControl
      && (typeof row?.click === "function" || typeof row?.dispatchEvent === "function");
    if (rowCanFallback) {
      target = row;
      targetType = "row";
      selectionReason = "row_fallback";
    }
    if (!target) selectionReason = "no_safe_project_navigation_target";
    const controls = projectInteractiveControlFlags(target || row);
    return {
      target,
      candidateCount: shapedCandidates.length,
      safeCandidateCount: candidates.length,
      visibleSafeCandidateCount: visibleCandidates.length,
      targetType,
      selectionReason,
      targetHasHref: Boolean(target && attributeValue(target, "href").trim()),
      targetRole: target ? (attributeValue(target, "role").trim() || "none") : "none",
      targetTag: target ? (String(target.tagName || "").toUpperCase() || "UNKNOWN") : "none",
      targetInsideProjectRow: projectElementIsInsideRow(row, target),
      targetIsMenuControl: Boolean(target && controls.isMenuControl),
      targetIsOverflowControl: Boolean(target && controls.isOverflowControl),
      menuControlReason: target ? controls.menuControlReason : structure.rowMenuControlReason,
      structure
    };
  }

  function dispatchProjectInteractiveEventSequence(target, row, root, initialUrl) {
    if (!projectElementIsInsideRow(row, target) || typeof target?.dispatchEvent !== "function") {
      return { dispatched: false, eventCount: 0 };
    }
    const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
    const ownerWindow = target.ownerDocument?.defaultView || globalThis;
    let eventCount = 0;
    for (const type of eventTypes) {
      const constructors = type.startsWith("pointer")
        ? [ownerWindow?.PointerEvent, ownerWindow?.MouseEvent, ownerWindow?.Event, globalThis.PointerEvent, globalThis.MouseEvent, globalThis.Event]
        : [ownerWindow?.MouseEvent, ownerWindow?.Event, globalThis.MouseEvent, globalThis.Event];
      let event = null;
      for (const EventConstructor of constructors) {
        if (typeof EventConstructor !== "function") continue;
        try {
          event = new EventConstructor(type, {
            bubbles: true,
            cancelable: true,
            view: ownerWindow
          });
          break;
        } catch (_) { }
      }
      if (!event) event = { type, bubbles: true, cancelable: true };
      try {
        target.dispatchEvent(event);
        eventCount += 1;
      } catch (_) {
        continue;
      }
      if (initialUrl && documentHref(root, globalThis.location?.href) !== initialUrl) break;
    }
    return { dispatched: eventCount > 0, eventCount };
  }

  function projectRowRelocationForIdentityDescriptor(
    sidebar,
    rows,
    descriptor,
    baseUrl = globalThis.location?.href) {
    const candidateCount = Number.isSafeInteger(rows?.length) ? rows.length : 0;
    const projectIndex = Number.isSafeInteger(descriptor?.discovery_index)
      && descriptor.discovery_index >= 0
      ? descriptor.discovery_index
      : (Number.isSafeInteger(descriptor?.project_index) && descriptor.project_index >= 0
        ? descriptor.project_index
        : null);
    const sectionVerified = Boolean(sidebar && typeof sidebar.querySelectorAll === "function");
    if (projectIndex === null) {
      return {
        row: null,
        candidateCount,
        rowFound: false,
        matchMethod: "none",
        sectionVerified,
        reason: "project_row_not_found"
      };
    }
    const expectedTitle = metadataTextKey(metadataTitle(descriptor?.title));
    const matchingRows = expectedTitle
      ? (rows || []).filter((candidate) => metadataTextKey(visibleTitleFromElement(candidate, "")) === expectedTitle)
      : [];
    const expectedDiscoveryKey = metadataIdentifier(descriptor?.discovery_key || descriptor?.discoveryKey);
    const fingerprintRows = expectedDiscoveryKey
      ? (rows || []).filter((candidate, candidateIndex) =>
        projectDiscoveryKeyForRow(
          candidate,
          visibleTitleFromElement(candidate, ""),
          candidateIndex) === expectedDiscoveryKey)
      : [];
    let row = null;
    // Keep the historical telemetry value for index-based relocation. A
    // discovery key is an additional disambiguator, not a new public match
    // category for callers that already consume discovery_fingerprint.
    let matchMethod = "discovery_fingerprint";
    if (expectedDiscoveryKey) {
      if (fingerprintRows.length === 1) {
        row = fingerprintRows[0];
        matchMethod = "discovery_fingerprint";
      } else if (fingerprintRows.length === 0
        && matchingRows.length === 1
        && rows?.[projectIndex]
        && metadataTextKey(visibleTitleFromElement(rows[projectIndex], "")) === expectedTitle) {
        // React may regenerate an aria-controls/id token after returning to
        // the root. The original discovery index plus a unique title is a
        // bounded relocation fallback; duplicate titles remain rejected.
        row = rows[projectIndex];
        matchMethod = "discovery_index_title";
      } else {
        return {
          row: null,
          candidateCount,
          rowFound: false,
          matchMethod: fingerprintRows.length > 1
            ? "ambiguous_discovery_fingerprint"
            : "discovery_fingerprint",
          sectionVerified,
          reason: fingerprintRows.length > 1
            ? "ambiguous_project_row_match"
            : "project_row_fingerprint_mismatch"
        };
      }
    } else {
      row = rows?.[projectIndex] || null;
    }
    if (!row) {
      return {
        row: null,
        candidateCount,
        rowFound: false,
        matchMethod: matchingRows.length > 1 ? "ambiguous_title_only_rejected" : matchMethod,
        sectionVerified,
        reason: matchingRows.length > 1
          ? "ambiguous_project_row_match"
          : "project_row_not_found"
      };
    }
    const actualTitle = metadataTextKey(visibleTitleFromElement(row, ""));
    if (!expectedTitle || actualTitle !== expectedTitle) {
      return {
        row: null,
        candidateCount,
        rowFound: false,
        matchMethod: matchingRows.length > 1 ? "ambiguous_title_only_rejected" : matchMethod,
        sectionVerified,
        reason: matchingRows.length > 1
          ? "ambiguous_project_row_match"
          : "project_row_fingerprint_mismatch"
      };
    }
    const expectedProjectId = metadataIdentifier(descriptor?.project_id || descriptor?.projectId);
    if (expectedProjectId) {
      const rowIdentity = projectIdentityFromElement(row, baseUrl);
      if (rowIdentity.projectId && rowIdentity.projectId !== expectedProjectId) {
        return {
          row: null,
          candidateCount,
          rowFound: false,
          matchMethod,
          sectionVerified,
          reason: "project_row_fingerprint_mismatch"
        };
      }
    }
    return {
      row,
      candidateCount,
      rowFound: true,
      matchMethod,
      sectionVerified,
      reason: null
    };
  }

  function projectRowForIdentityDescriptor(rows, descriptor, baseUrl = globalThis.location?.href) {
    return projectRowRelocationForIdentityDescriptor(null, rows, descriptor, baseUrl).row;
  }

  async function resolveProjectIdentityFromDisclosureAsync(
    root,
    initialRow,
    descriptor,
    baseUrl = globalThis.location?.href,
    options = {}) {
    let row = initialRow || null;
    const initialUrl = documentHref(root, globalThis.location?.href);
    const timeoutMs = Math.max(
      250,
      Math.min(10000, Number(options.disclosureTimeoutMs)
        || Number(options.navigationTimeoutMs)
        || 2500));
    const startedAt = Date.now();
    let clickAttempted = false;
    let clickDispatched = false;
    let eventFallbackAttempted = false;
    let eventFallbackDispatched = false;
    let urlChanged = false;
    let navigationIdentity = null;
    const before = projectDisclosureStructureForRow(row, root, baseUrl);
    let after = before;
    let lastReason = before.controlledRegionFound
      ? before.controlledRegionIdentityReason
      : "controlled_region_not_found";

    const expectedProjectId = metadataIdentifier(descriptor?.project_id || descriptor?.projectId);
    const currentRow = () => {
      try {
        const relocated = options.relocateRow?.();
        if (relocated) row = relocated;
      } catch (_) { }
      return row;
    };
    const inspect = () => {
      currentRow();
      after = projectDisclosureStructureForRow(row, root, baseUrl);
      let identity = after.identity?.projectId ? after.identity : null;
      if (!identity && row) {
        const rowIdentity = projectIdentityFromElement(row, baseUrl);
        if (rowIdentity?.projectId) identity = rowIdentity;
        else if (rowIdentity?.reason && rowIdentity.reason !== "missing_stable_identity") {
          lastReason = rowIdentity.reason;
        }
      }
      const currentUrl = documentHref(root, globalThis.location?.href);
      urlChanged = currentUrl !== initialUrl;
      if (urlChanged && !identity) {
        const routeIdentity = projectIdentityFromUrlCandidate(currentUrl, currentUrl);
        if (routeIdentity) {
          navigationIdentity = routeIdentity;
          identity = routeIdentity;
        }
      }
      if (identity && expectedProjectId && identity.projectId !== expectedProjectId) {
        lastReason = "project_id_url_mismatch";
        return null;
      }
      if (identity) {
        lastReason = "none";
      } else if (urlChanged) {
        lastReason = "disclosure_navigation_target_not_project";
      } else if (after.controlledRegionIdentityReason) {
        lastReason = after.controlledRegionIdentityReason;
      }
      return identity;
    };
    const result = (identity, reason = null) => ({
      isDisclosure: before.rowIsDisclosureControl === true,
      identity: identity || null,
      navigationIdentity,
      row,
      before,
      after,
      clickAttempted,
      clickDispatched,
      eventFallbackAttempted,
      eventFallbackDispatched,
      urlChanged,
      navigationDetected: Boolean(navigationIdentity),
      elapsedMs: Math.max(0, Date.now() - startedAt),
      reason: reason || (identity ? "none" : lastReason || "project_disclosure_identity_not_found")
    });

    if (!before.rowIsDisclosureControl) return result(null, "not_a_disclosure_control");

    let identity = inspect();
    if (identity) return result(identity);

    // An expanded region may be present but still hydrating. Do not click it
    // again; the bounded wait below gives its metadata a chance to arrive.
    if (before.ariaExpanded !== "true") {
      const target = currentRow();
      if (!target || (typeof target.click !== "function"
        && typeof target.dispatchEvent !== "function")) {
        return result(null, "project_disclosure_not_clickable");
      }
      clickAttempted = true;
      try {
        if (typeof target.click === "function") {
          target.click();
          clickDispatched = true;
        }
      } catch (_) {
        clickDispatched = false;
      }

      // Give React's click handler a short opportunity to update aria-expanded
      // or mount the controlled list before considering an event fallback.
      await waitForLocatorDelay(Math.min(150, Math.max(0, timeoutMs)));
      identity = inspect();
      const stateChanged = before.ariaExpanded !== after.ariaExpanded
        || before.controlledRegionFound !== after.controlledRegionFound
        || before.controlledRegionElementCount !== after.controlledRegionElementCount
        || before.controlledRegionProjectChatLinkCount !== after.controlledRegionProjectChatLinkCount
        || before.controlledRegionProjectHomeLinkCount !== after.controlledRegionProjectHomeLinkCount;
      if (!identity
        && !stateChanged
        && !urlChanged
        && typeof row?.dispatchEvent === "function") {
        eventFallbackAttempted = true;
        const eventResult = dispatchProjectInteractiveEventSequence(row, row, root, initialUrl);
        eventFallbackDispatched = eventResult.dispatched;
        await waitForLocatorDelay(Math.min(100, Math.max(0, timeoutMs)));
        identity = inspect();
      }
    }

    if (identity) return result(identity);
    const deadline = startedAt + timeoutMs;
    while (Date.now() <= deadline) {
      await waitForLocatorDelay(Math.min(100, Math.max(0, deadline - Date.now())));
      identity = inspect();
      if (identity) return result(identity);
    }
    return result(
      null,
      urlChanged ? "disclosure_navigation_target_not_project" : "project_disclosure_identity_not_found");
  }

  async function waitForProjectHomeNavigation(root, timeoutMs = 10000, options = {}) {
    const deadline = Date.now() + Math.max(250, Math.min(30000, Number(timeoutMs) || 10000));
    const startedAt = Date.now();
    const projectIndex = Number.isSafeInteger(options.projectIndex) ? options.projectIndex : 0;
    const emit = typeof options.emit === "function" ? options.emit : () => {};
    const initialUrl = typeof options.initialUrl === "string"
      ? options.initialUrl
      : documentHref(root, globalThis.location?.href);
    let urlChanged = false;
    emit("collector_project_identity_navigation_wait", {
      project_index: projectIndex,
      navigation_wait_started: true,
      url_changed: false,
      navigation_detected: false,
      content_script_reloaded: false,
      tab_update_observed: false,
      navigation_wait_ms: 0,
      navigation_timeout: false
    });
    while (Date.now() <= deadline) {
      const currentUrl = documentHref(root, globalThis.location?.href);
      if (!urlChanged && currentUrl !== initialUrl) {
        urlChanged = true;
        emit("collector_project_identity_navigation_wait", {
          project_index: projectIndex,
          navigation_wait_started: true,
          url_changed: true,
          navigation_detected: false,
          content_script_reloaded: false,
          tab_update_observed: false,
          navigation_wait_ms: Math.max(0, Date.now() - startedAt),
          navigation_timeout: false
        });
      }
      const identity = projectIdentityFromUrlCandidate(currentUrl, currentUrl);
      if (identity && isProjectHomeUrl(currentUrl)) {
        emit("collector_project_identity_navigation_wait", {
          project_index: projectIndex,
          navigation_wait_started: true,
          url_changed: urlChanged,
          navigation_detected: true,
          content_script_reloaded: false,
          tab_update_observed: false,
          navigation_wait_ms: Math.max(0, Date.now() - startedAt),
          navigation_timeout: false
        });
        return identity;
      }
      await waitForLocatorDelay(Math.min(100, Math.max(0, deadline - Date.now())));
    }
    emit("collector_project_identity_navigation_wait", {
      project_index: projectIndex,
      navigation_wait_started: true,
      url_changed: urlChanged,
      navigation_detected: false,
      content_script_reloaded: false,
      tab_update_observed: false,
      navigation_wait_ms: Math.max(0, Date.now() - startedAt),
      navigation_timeout: true
    });
    return null;
  }

  function identityProjectResult(project, projectIndex, identity, method, reason, navigationVerified) {
    const resolved = Boolean(
      metadataTitle(project?.title, "")
      && identity?.projectId
      && identity?.projectUrl);
    const effectiveReason = !metadataTitle(project?.title, "")
      ? "missing_title"
      : reason;
    return {
      ...(project && typeof project === "object" ? project : {}),
      project_index: projectIndex,
      ...(identity?.projectId ? { project_id: identity.projectId } : {}),
      ...(identity?.projectUrl ? { url: identity.projectUrl } : {}),
      resolution_method: method,
      navigation_target_verified: navigationVerified === true,
      project_url_pattern_valid: Boolean(identity?.projectId
        && identity?.projectUrl
        && isProjectHomeUrl(identity.projectUrl)),
      project_id_url_match: Boolean(identity?.projectId
        && identity?.projectUrl
        && projectIdFromUrl(identity.projectUrl) === identity.projectId),
      ...(resolved ? {} : { unresolved_reason: effectiveReason || "missing_stable_identity" })
    };
  }

  async function resolveChatGptProjectIdentitiesAsync(
    root = globalThis.document,
    url = globalThis.location?.href,
    projects = [],
    options = {}) {
    const descriptors = Array.isArray(projects) ? projects : [];
    const mode = options.identityMode === "navigation" ? "navigation" : "dom";
    const baseUrl = documentHref(root, url);
    const output = descriptors.map((project, index) => ({
      ...(project && typeof project === "object" ? project : {}),
      project_index: Number.isSafeInteger(project?.project_index)
        ? project.project_index
        : index
    }));
    let nonNavigationResolvedCount = 0;
    let navigationResolvedCount = 0;
    let currentProjectIndex = -1;
    let navigationTargetVerified = false;
    let projectUrlPatternValid = false;
    let projectIdUrlMatch = false;
    let navigationInternalReason = "none";
    const navigationTelemetryKeys = [
      "project_index",
      "candidate_count",
      "row_found",
      "match_method",
      "section_verified",
      "stale_element_reused",
      "clickable_element_found",
      "click_attempted",
      "click_dispatched",
      "click_method",
      "click_target_is_project_row",
      "click_target_section_verified",
      "interactive_candidate_count",
      "selected_target_type",
      "selected_target_has_href",
      "selected_target_role",
      "selected_target_tag",
      "selected_target_inside_project_row",
      "selected_target_is_menu_control",
      "selected_target_is_overflow_control",
      "safe_candidate_count",
      "visible_safe_candidate_count",
      "selection_reason",
      "menu_control_reason",
      "row_tag",
      "row_role",
      "row_aria_haspopup",
      "row_aria_expanded",
      "row_is_menu_control",
      "row_is_overflow_control",
      "row_is_disclosure_control",
      "controlled_region_found",
      "controlled_region_visible",
      "controlled_region_element_count",
      "controlled_region_project_chat_link_count",
      "controlled_region_project_home_link_count",
      "controlled_region_project_identity_present",
      "controlled_region_identity_reason",
      "aria_expanded_before",
      "aria_expanded_after",
      "disclosure_click_attempted",
      "disclosure_click_dispatched",
      "disclosure_event_fallback_attempted",
      "disclosure_event_fallback_dispatched",
      "disclosure_state_changed",
      "disclosure_url_changed",
      "disclosure_resolution_method",
      "row_interactive_evidence",
      "row_tabindex_present",
      "row_href_present",
      "row_aria_controls_present",
      "direct_child_count",
      "descendant_count",
      "descendant_anchor_count",
      "descendant_button_count",
      "descendant_role_link_count",
      "descendant_role_button_count",
      "descendant_tabindex_count",
      "descendant_href_count",
      "shadow_root_present",
      "shadow_descendant_count",
      "nearest_interactive_ancestor_present",
      "nearest_interactive_ancestor_tag",
      "nearest_interactive_ancestor_role",
      "exit_reason",
      "internal_reason",
      "navigation_failure_reason",
      "navigation_wait_started",
      "url_changed",
      "navigation_detected",
      "content_script_reloaded",
      "tab_update_observed",
      "navigation_wait_ms",
      "navigation_timeout",
      "navigation_target_verified",
      "project_url_pattern_valid",
      "project_id_extracted",
      "project_id_url_match",
      "resolution_success",
      "unresolved_reason"
    ];
    const navigationTelemetry = [];
    const emitNavigationTelemetry = (stage, fields = {}) => {
      const event = {
        stage: typeof stage === "string" ? stage.slice(0, 128) : "collector_project_identity_navigation"
      };
      for (const key of navigationTelemetryKeys) {
        if (typeof fields[key] === "boolean") event[key] = fields[key];
        else if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) event[key] = fields[key];
        else if (typeof fields[key] === "string" && fields[key].length <= 128) event[key] = fields[key];
      }
      navigationTelemetry.push(event);
      try { options.onTelemetry?.(event); } catch (_) { }
    };

    // This resolver intentionally performs only bounded DOM reads in `dom`
    // mode. It never selects a new scrollport, scrolls the Sidebar, or calls
    // the Project discovery routine again.
    if (mode === "dom") {
      const sidebar = findSidebarRoot(root);
      const rows = projectRowsInSidebar(sidebar, baseUrl);
      for (let index = 0; index < output.length; index += 1) {
        const descriptor = output[index];
        const existing = projectIdentityFromProjectMetadata(descriptor, baseUrl);
        let identity = existing.projectId ? existing : null;
        let reason = existing.reason;
        if (!identity) {
          const row = projectRowForIdentityDescriptor(rows, descriptor, baseUrl);
          const fromRow = row ? projectIdentityFromElement(row, baseUrl) : { reason: "project_row_not_found" };
          identity = fromRow.projectId ? fromRow : null;
          reason = fromRow.reason || reason;
        }
        output[index] = identityProjectResult(
          descriptor,
          Number.isSafeInteger(descriptor.project_index) ? descriptor.project_index : index,
          identity,
          "dom",
          reason,
          false);
        if (identity) nonNavigationResolvedCount += 1;
      }
    } else if (output.length > 0) {
      const descriptor = output[0];
      currentProjectIndex = Number.isSafeInteger(descriptor.project_index)
        ? descriptor.project_index
        : 0;
      const currentUrl = documentHref(root, globalThis.location?.href);
      const currentIdentity = projectIdentityFromUrlCandidate(currentUrl, currentUrl);
      const expectedProjectId = metadataIdentifier(descriptor.project_id || descriptor.projectId);
      let identity = currentIdentity
        && (!expectedProjectId || expectedProjectId === currentIdentity.projectId)
        ? currentIdentity
        : null;
      let reason = currentIdentity && expectedProjectId !== currentIdentity.projectId
        ? "project_id_url_mismatch"
        : null;
      let observedIdentity = currentIdentity;
      let targetInfo = null;
      navigationInternalReason = reason || "none";
      if (!identity) {
        const sidebar = findSidebarRoot(root);
        const rows = projectRowsInSidebar(sidebar, baseUrl);
        emitNavigationTelemetry("collector_project_identity_row_relocation_start", {
          project_index: currentProjectIndex
        });
        const relocation = projectRowRelocationForIdentityDescriptor(
          sidebar,
          rows,
          descriptor,
          baseUrl);
        emitNavigationTelemetry("collector_project_identity_row_relocation", {
          project_index: currentProjectIndex,
          candidate_count: relocation.candidateCount,
          row_found: relocation.rowFound,
          match_method: relocation.matchMethod,
          section_verified: relocation.sectionVerified,
          stale_element_reused: false,
          unresolved_reason: relocation.reason || "none"
        });
        const row = relocation.row;
        let disclosureResult = null;
        if (row) {
          const relocateRow = () => {
            const currentSidebar = findSidebarRoot(root);
            const currentRows = projectRowsInSidebar(currentSidebar, baseUrl);
            return projectRowRelocationForIdentityDescriptor(
              currentSidebar,
              currentRows,
              descriptor,
              baseUrl).row;
          };
          disclosureResult = await resolveProjectIdentityFromDisclosureAsync(
            root,
            row,
            descriptor,
            baseUrl,
            {
              navigationTimeoutMs: options.navigationTimeoutMs,
              relocateRow
            });
          const beforeDisclosure = disclosureResult.before || {};
          const afterDisclosure = disclosureResult.after || {};
          const disclosureStateChanged = beforeDisclosure.ariaExpanded
            !== afterDisclosure.ariaExpanded
            || beforeDisclosure.controlledRegionFound
            !== afterDisclosure.controlledRegionFound
            || beforeDisclosure.controlledRegionElementCount
            !== afterDisclosure.controlledRegionElementCount
            || beforeDisclosure.controlledRegionProjectChatLinkCount
            !== afterDisclosure.controlledRegionProjectChatLinkCount
            || beforeDisclosure.controlledRegionProjectHomeLinkCount
            !== afterDisclosure.controlledRegionProjectHomeLinkCount;
          emitNavigationTelemetry("collector_project_identity_disclosure_structure", {
            project_index: currentProjectIndex,
            row_is_disclosure_control: beforeDisclosure.rowIsDisclosureControl,
            row_aria_controls_present: beforeDisclosure.ariaControlsPresent,
            row_aria_expanded: beforeDisclosure.ariaExpanded,
            controlled_region_found: afterDisclosure.controlledRegionFound,
            controlled_region_visible: afterDisclosure.controlledRegionVisible,
            controlled_region_element_count: afterDisclosure.controlledRegionElementCount,
            controlled_region_project_chat_link_count: afterDisclosure.controlledRegionProjectChatLinkCount,
            controlled_region_project_home_link_count: afterDisclosure.controlledRegionProjectHomeLinkCount,
            controlled_region_project_identity_present: afterDisclosure.controlledRegionProjectIdentityPresent,
            controlled_region_identity_reason: afterDisclosure.controlledRegionIdentityReason,
            aria_expanded_before: beforeDisclosure.ariaExpanded,
            aria_expanded_after: afterDisclosure.ariaExpanded,
            disclosure_state_changed: disclosureStateChanged,
            disclosure_url_changed: disclosureResult.urlChanged,
            disclosure_resolution_method: disclosureResult.identity
              ? (disclosureResult.navigationIdentity ? "navigation" : "dom")
              : "none"
          });
          if (disclosureResult.clickAttempted || disclosureResult.eventFallbackAttempted) {
            emitNavigationTelemetry("collector_project_identity_disclosure_click", {
              project_index: currentProjectIndex,
              clickable_element_found: Boolean(
                typeof disclosureResult.row?.click === "function"
                || typeof disclosureResult.row?.dispatchEvent === "function"),
              click_attempted: disclosureResult.clickAttempted,
              click_dispatched: disclosureResult.clickDispatched,
              click_method: disclosureResult.eventFallbackAttempted
                ? "event_sequence"
                : "disclosure.click",
              click_target_is_project_row: true,
              click_target_section_verified: relocation.sectionVerified,
              disclosure_click_attempted: disclosureResult.clickAttempted,
              disclosure_click_dispatched: disclosureResult.clickDispatched,
              disclosure_event_fallback_attempted: disclosureResult.eventFallbackAttempted,
              disclosure_event_fallback_dispatched: disclosureResult.eventFallbackDispatched,
              disclosure_state_changed: disclosureStateChanged,
              disclosure_url_changed: disclosureResult.urlChanged
            });
          }
          if (disclosureResult.identity) {
            identity = disclosureResult.identity;
            observedIdentity = disclosureResult.navigationIdentity;
            reason = null;
            navigationInternalReason = "none";
          } else if (disclosureResult.isDisclosure) {
            reason = disclosureResult.reason || "project_disclosure_identity_not_found";
            navigationInternalReason = "project_row_disclosure_identity_unresolved";
          }
          if (disclosureResult.isDisclosure) {
            emitNavigationTelemetry("collector_project_identity_disclosure_result", {
              project_index: currentProjectIndex,
              navigation_target_verified: Boolean(disclosureResult.navigationIdentity),
              project_url_pattern_valid: Boolean(
                disclosureResult.identity?.projectUrl
                && isProjectHomeUrl(disclosureResult.identity.projectUrl)),
              project_id_extracted: Boolean(disclosureResult.identity?.projectId),
              project_id_url_match: Boolean(
                disclosureResult.identity?.projectId
                && disclosureResult.identity?.projectUrl
                && projectIdFromUrl(disclosureResult.identity.projectUrl)
                  === disclosureResult.identity.projectId),
              resolution_success: Boolean(disclosureResult.identity),
              exit_reason: disclosureResult.identity
                ? "resolved"
                : (disclosureResult.reason || "project_disclosure_identity_not_found"),
              internal_reason: disclosureResult.identity
                ? "none"
                : "project_row_disclosure_identity_unresolved",
              unresolved_reason: disclosureResult.identity
                ? "none"
                : (disclosureResult.reason || "project_disclosure_identity_not_found"),
              disclosure_state_changed: disclosureStateChanged,
              disclosure_url_changed: disclosureResult.urlChanged,
              disclosure_resolution_method: disclosureResult.identity
                ? (disclosureResult.navigationIdentity ? "navigation" : "dom")
                : "none"
            });
          }
        }
        targetInfo = projectInteractiveTargetForRow(row, baseUrl);
        const structure = targetInfo.structure || {};
        emitNavigationTelemetry("collector_project_identity_row_structure", {
          project_index: currentProjectIndex,
          row_tag: structure.rowTag,
          row_role: structure.rowRole,
          row_tabindex_present: structure.rowTabIndexPresent,
          row_href_present: structure.rowHrefPresent,
          row_aria_haspopup: structure.rowAriaHasPopup,
          row_aria_expanded: structure.rowAriaExpanded,
          row_aria_controls_present: structure.rowAriaControlsPresent,
          direct_child_count: structure.directChildCount,
          descendant_count: structure.descendantCount,
          descendant_anchor_count: structure.descendantAnchorCount,
          descendant_button_count: structure.descendantButtonCount,
          descendant_role_link_count: structure.descendantRoleLinkCount,
          descendant_role_button_count: structure.descendantRoleButtonCount,
          descendant_tabindex_count: structure.descendantTabIndexCount,
          descendant_href_count: structure.descendantHrefCount,
          shadow_root_present: structure.shadowRootPresent,
          shadow_descendant_count: structure.shadowDescendantCount,
          nearest_interactive_ancestor_present: structure.nearestInteractiveAncestorPresent,
          nearest_interactive_ancestor_tag: structure.nearestInteractiveAncestorTag,
          nearest_interactive_ancestor_role: structure.nearestInteractiveAncestorRole,
          row_is_menu_control: structure.rowIsMenuControl,
          row_is_overflow_control: structure.rowIsOverflowControl,
          row_is_disclosure_control: structure.rowIsDisclosureControl,
          controlled_region_found: structure.controlledRegionFound,
          controlled_region_visible: structure.controlledRegionVisible,
          controlled_region_element_count: structure.controlledRegionElementCount,
          controlled_region_project_chat_link_count: structure.controlledRegionProjectChatLinkCount,
          controlled_region_project_home_link_count: structure.controlledRegionProjectHomeLinkCount,
          controlled_region_project_identity_present: structure.controlledRegionProjectIdentityPresent,
          controlled_region_identity_reason: structure.controlledRegionIdentityReason,
          row_interactive_evidence: structure.rowInteractiveEvidence,
          menu_control_reason: structure.rowMenuControlReason
        });
        emitNavigationTelemetry("collector_project_identity_click_target", {
          project_index: currentProjectIndex,
          interactive_candidate_count: targetInfo.candidateCount,
          safe_candidate_count: targetInfo.safeCandidateCount,
          visible_safe_candidate_count: targetInfo.visibleSafeCandidateCount,
          selected_target_type: targetInfo.targetType,
          selection_reason: targetInfo.selectionReason,
          selected_target_has_href: targetInfo.targetHasHref,
          selected_target_role: targetInfo.targetRole,
          selected_target_tag: targetInfo.targetTag,
          selected_target_inside_project_row: targetInfo.targetInsideProjectRow,
          selected_target_is_menu_control: targetInfo.targetIsMenuControl,
          selected_target_is_overflow_control: targetInfo.targetIsOverflowControl,
          menu_control_reason: targetInfo.menuControlReason,
          row_is_menu_control: structure.rowIsMenuControl,
          row_is_overflow_control: structure.rowIsOverflowControl,
          row_is_disclosure_control: structure.rowIsDisclosureControl,
          controlled_region_found: structure.controlledRegionFound,
          controlled_region_project_identity_present: structure.controlledRegionProjectIdentityPresent,
          row_interactive_evidence: structure.rowInteractiveEvidence
        });
        if (!row) {
          reason = reason || relocation.reason || "project_row_not_found";
          navigationInternalReason = reason;
        } else {
          // A Project href or explicit Project data attribute is a stable
          // identity. Resolve it without clicking, even in navigation mode.
          // This keeps the fallback limited to rows that discovery already
          // confirmed and avoids turning a metadata read into navigation.
          const identityCandidates = [targetInfo.target, row].filter(Boolean);
          let identityCandidateReason = null;
          for (const identityCandidate of identityCandidates) {
            const candidateIdentity = projectIdentityFromElement(identityCandidate, baseUrl);
            if (candidateIdentity?.projectId) {
              if (expectedProjectId && expectedProjectId !== candidateIdentity.projectId) {
                reason = "project_id_url_mismatch";
                navigationInternalReason = reason;
                identityCandidateReason = reason;
                break;
              }
              identity = candidateIdentity;
              reason = null;
              break;
            }
            if (candidateIdentity?.reason && candidateIdentity.reason !== "missing_stable_identity") {
              identityCandidateReason = identityCandidateReason || candidateIdentity.reason;
            }
          }

          if (identity) {
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: Boolean(targetInfo.target),
              click_attempted: false,
              click_dispatched: false,
              click_method: disclosureResult?.identity ? "disclosure_identity" : "dom_identity",
              click_target_is_project_row: targetInfo.targetInsideProjectRow,
              click_target_section_verified: relocation.sectionVerified
            });
          } else if (identityCandidateReason === "project_id_url_mismatch") {
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: Boolean(targetInfo.target),
              click_attempted: false,
              click_dispatched: false,
              click_method: "identity_rejected",
              click_target_is_project_row: targetInfo.targetInsideProjectRow,
              click_target_section_verified: relocation.sectionVerified,
              unresolved_reason: identityCandidateReason
            });
            reason = identityCandidateReason;
            navigationInternalReason = reason;
          } else if (disclosureResult?.isDisclosure) {
            const disclosureFailureReason = disclosureResult.reason
              || "project_disclosure_identity_not_found";
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: Boolean(targetInfo.target),
              click_attempted: disclosureResult.clickAttempted,
              click_dispatched: disclosureResult.clickDispatched,
              click_method: disclosureResult.eventFallbackAttempted
                ? "event_sequence"
                : "disclosure.click",
              click_target_is_project_row: true,
              click_target_section_verified: relocation.sectionVerified,
              disclosure_click_attempted: disclosureResult.clickAttempted,
              disclosure_click_dispatched: disclosureResult.clickDispatched,
              disclosure_event_fallback_attempted: disclosureResult.eventFallbackAttempted,
              disclosure_event_fallback_dispatched: disclosureResult.eventFallbackDispatched,
              disclosure_url_changed: disclosureResult.urlChanged,
              unresolved_reason: disclosureFailureReason,
              exit_reason: disclosureFailureReason,
              internal_reason: "project_row_disclosure_identity_unresolved",
              navigation_failure_reason: disclosureFailureReason
            });
            reason = disclosureFailureReason;
            navigationInternalReason = "project_row_disclosure_identity_unresolved";
        } else if (targetInfo.targetIsMenuControl
          || targetInfo.targetIsOverflowControl
          || !targetInfo.target
            || (typeof targetInfo.target.click !== "function"
              && typeof targetInfo.target.dispatchEvent !== "function")) {
          const noSafeTarget = targetInfo.targetIsMenuControl
            || targetInfo.targetIsOverflowControl
            || targetInfo.selectionReason === "no_safe_project_navigation_target";
          const clickFailureReason = noSafeTarget
            ? "no_safe_project_navigation_target"
            : (identityCandidateReason || "project_row_not_clickable");
          const internalReason = targetInfo.targetIsMenuControl || structure.rowIsMenuControl
            ? "project_row_is_menu_control"
            : targetInfo.targetIsOverflowControl || structure.rowIsOverflowControl
              ? "project_row_is_overflow_control"
              : clickFailureReason;
          emitNavigationTelemetry("collector_project_identity_click", {
            project_index: currentProjectIndex,
            clickable_element_found: Boolean(targetInfo.target),
            click_attempted: false,
            click_dispatched: false,
            click_method: noSafeTarget
              ? "no_safe_project_navigation_target"
              : (targetInfo.targetType === "row" ? "row.click" : "target.click"),
            click_target_is_project_row: Boolean(row),
            click_target_section_verified: relocation.sectionVerified,
            selected_target_is_menu_control: targetInfo.targetIsMenuControl,
            selected_target_is_overflow_control: targetInfo.targetIsOverflowControl,
            selection_reason: targetInfo.selectionReason,
            menu_control_reason: targetInfo.menuControlReason,
            unresolved_reason: clickFailureReason,
            exit_reason: clickFailureReason,
            internal_reason: internalReason,
            navigation_failure_reason: clickFailureReason
          });
            reason = clickFailureReason;
            navigationInternalReason = internalReason;
          } else {
            const target = targetInfo.target;
            const clickMethod = target === row ? "row.click" : "target.click";
          emitNavigationTelemetry("collector_project_identity_click", {
            project_index: currentProjectIndex,
            clickable_element_found: true,
            click_attempted: false,
            click_dispatched: false,
            click_method: clickMethod,
            click_target_is_project_row: targetInfo.targetInsideProjectRow,
            click_target_section_verified: relocation.sectionVerified
          });
          try {
            // Only a row selected from the already discovered Project-row
            // collection is allowed to navigate. Generic Sidebar controls are
            // never queried or clicked here.
            const preClickUrl = documentHref(root, globalThis.location?.href);
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: true,
              click_attempted: true,
              click_dispatched: false,
              click_method: clickMethod,
              click_target_is_project_row: targetInfo.targetInsideProjectRow,
              click_target_section_verified: relocation.sectionVerified
            });
            const clickStartedAt = Date.now();
            let clickDispatched = false;
            let clickError = null;
            if (typeof target.click === "function") {
              try {
                target.click();
                clickDispatched = true;
              } catch (error) {
                clickError = error;
              }
            }
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: true,
              click_attempted: true,
              click_dispatched: clickDispatched,
              click_method: clickMethod,
              click_target_is_project_row: targetInfo.targetInsideProjectRow,
              click_target_section_verified: relocation.sectionVerified,
              ...(clickError ? { unresolved_reason: "project_navigation_click_failed" } : {})
            });
            const navigationTimeoutMs = Math.max(
              250,
              Math.min(30000, Number(options.navigationTimeoutMs) || 10000));
            const navigationProbeTimeoutMs = Math.min(
              navigationTimeoutMs,
              Math.max(250, Math.min(1000, Number(options.navigationProbeTimeoutMs) || 1000)));
            observedIdentity = await waitForProjectHomeNavigation(root, navigationProbeTimeoutMs, {
              projectIndex: currentProjectIndex,
              emit: emitNavigationTelemetry,
              initialUrl: preClickUrl
            });
            const currentUrlAfterClick = documentHref(root, globalThis.location?.href);
            let fallbackNavigationWaitCompleted = false;
            const canTryEventFallback = !observedIdentity
              && currentUrlAfterClick === preClickUrl
              && targetInfo.targetInsideProjectRow
              && !targetInfo.targetIsMenuControl
              && !targetInfo.targetIsOverflowControl
              && target?.isConnected !== false
              && typeof target?.dispatchEvent === "function";
            if (canTryEventFallback) {
              emitNavigationTelemetry("collector_project_identity_click", {
                project_index: currentProjectIndex,
                clickable_element_found: true,
                click_attempted: true,
                click_dispatched: false,
                click_method: "event_sequence",
                click_target_is_project_row: true,
                click_target_section_verified: relocation.sectionVerified
              });
              const eventResult = dispatchProjectInteractiveEventSequence(
                target,
                row,
                root,
                preClickUrl);
              emitNavigationTelemetry("collector_project_identity_click", {
                project_index: currentProjectIndex,
                clickable_element_found: true,
                click_attempted: true,
                click_dispatched: eventResult.dispatched,
                click_method: "event_sequence",
                click_target_is_project_row: true,
                click_target_section_verified: relocation.sectionVerified,
                ...(eventResult.dispatched ? {} : { unresolved_reason: "project_navigation_event_failed" })
              });
              if (eventResult.dispatched) {
                const elapsedMs = Math.max(0, Date.now() - clickStartedAt);
                const remainingTimeoutMs = Math.max(250, navigationTimeoutMs - elapsedMs);
                observedIdentity = await waitForProjectHomeNavigation(root, remainingTimeoutMs, {
                  projectIndex: currentProjectIndex,
                  emit: emitNavigationTelemetry,
                  initialUrl: preClickUrl
                });
                fallbackNavigationWaitCompleted = true;
              }
            }
            if (!observedIdentity
              && !fallbackNavigationWaitCompleted
              && navigationProbeTimeoutMs < navigationTimeoutMs) {
              const elapsedMs = Math.max(0, Date.now() - clickStartedAt);
              observedIdentity = await waitForProjectHomeNavigation(
                root,
                Math.max(250, navigationTimeoutMs - elapsedMs),
                {
                  projectIndex: currentProjectIndex,
                  emit: emitNavigationTelemetry,
                  initialUrl: preClickUrl
                });
            }
            identity = observedIdentity;
            if (!identity) {
              reason = "navigation_target_not_project";
              navigationInternalReason = reason;
            } else if (expectedProjectId && expectedProjectId !== identity.projectId) {
              identity = null;
              reason = "project_id_url_mismatch";
              navigationInternalReason = reason;
            }
          } catch (_) {
            emitNavigationTelemetry("collector_project_identity_click", {
              project_index: currentProjectIndex,
              clickable_element_found: true,
              click_attempted: true,
              click_dispatched: false,
              click_method: clickMethod,
              click_target_is_project_row: targetInfo.targetInsideProjectRow,
              click_target_section_verified: relocation.sectionVerified,
              unresolved_reason: "project_navigation_failed"
            });
            reason = "project_navigation_failed";
            navigationInternalReason = reason;
          }
        }
        }
      }
      const navigationResultIdentity = observedIdentity || identity;
      const navigationResolved = Boolean(observedIdentity);
      emitNavigationTelemetry("collector_project_identity_navigation_result", {
        project_index: currentProjectIndex,
        navigation_target_verified: navigationResolved,
        project_url_pattern_valid: Boolean(
          navigationResultIdentity?.projectUrl
          && isProjectHomeUrl(navigationResultIdentity.projectUrl)),
        project_id_extracted: Boolean(navigationResultIdentity?.projectId),
        project_id_url_match: Boolean(
          navigationResultIdentity?.projectId
          && navigationResultIdentity?.projectUrl
          && projectIdFromUrl(navigationResultIdentity.projectUrl) === navigationResultIdentity.projectId),
        resolution_success: Boolean(identity),
        unresolved_reason: identity ? "none" : (reason || "missing_stable_identity"),
        exit_reason: identity ? "resolved" : (reason || "missing_stable_identity"),
        internal_reason: identity
          ? "none"
          : (navigationInternalReason || reason || "missing_stable_identity"),
        navigation_failure_reason: identity ? "none" : (reason || "missing_stable_identity")
      });
      output[0] = identityProjectResult(
        descriptor,
        currentProjectIndex,
        identity,
        navigationResolved ? "navigation" : "dom",
        reason,
        navigationResolved);
      if (identity) {
        if (navigationResolved) navigationResolvedCount = 1;
        else nonNavigationResolvedCount = 1;
        navigationTargetVerified = navigationResolved;
        projectUrlPatternValid = isProjectHomeUrl(identity.projectUrl);
        projectIdUrlMatch = projectIdFromUrl(identity.projectUrl) === identity.projectId;
      }
    }

    const unresolvedCount = output.reduce((count, project) => {
      const identity = projectIdentityFromProjectMetadata(project, baseUrl);
      return count + (metadataTitle(project?.title, "") && identity.projectId ? 0 : 1);
    }, 0);
    return {
      projects: output,
      conversations: [],
      current: null,
      project_identity_resolution_started: true,
      project_identity_resolution_completed: true,
      non_navigation_resolved_count: nonNavigationResolvedCount,
      navigation_resolved_count: navigationResolvedCount,
      unresolved_count: unresolvedCount,
      current_project_index: currentProjectIndex,
      resolution_method: mode,
      navigation_target_verified: navigationTargetVerified,
      project_url_pattern_valid: projectUrlPatternValid,
      project_id_url_match: projectIdUrlMatch,
      navigation_failure_reason: output.find((project) => project?.unresolved_reason)?.unresolved_reason || "none",
      internal_reason: output.find((project) => project?.unresolved_reason)
        ? (navigationInternalReason || "missing_stable_identity")
        : "none",
      navigation_telemetry: navigationTelemetry
    };
  }

  function documentHref(root, fallbackUrl = globalThis.location?.href) {
    let href = "";
    try { href = root?.location?.href || globalThis.location?.href || ""; } catch (_) { href = ""; }
    return chatGptMetadataUrl(href, fallbackUrl)
      || chatGptMetadataUrl(fallbackUrl, fallbackUrl)
      || String(fallbackUrl || "");
  }

  function waitForLocatorDelay(milliseconds) {
    const delay = Math.max(0, Number(milliseconds) || 0);
    if (delay === 0 || typeof globalThis.setTimeout !== "function") return Promise.resolve();
    return new Promise((resolve) => globalThis.setTimeout(resolve, delay));
  }

  function documentTitleFallback(root, conversationId) {
    let title = "";
    try { title = root?.title || ""; } catch (_) { title = ""; }
    title = title.replace(/\s*[|·-]\s*ChatGPT\s*$/i, "").trim();
    return metadataTitle(title, conversationId || "ChatGPT");
  }

  function getCurrentChatGptContextFromEntries(entries, root = globalThis.document, url = globalThis.location?.href) {
    const currentUrl = chatGptMetadataUrl(url, url);
    const conversationId = conversationIdFromUrl(currentUrl || url);
    const projectId = projectIdFromUrl(currentUrl || url);
    const matching = conversationId
      ? entries.conversations.find((conversation) => conversation.conversation_id === conversationId)
      : null;
    const title = matching?.title || documentTitleFallback(root, conversationId);
    const projectTitle = matching?.project_title
      || (projectId
        ? entries.projects.find((project) => project.project_id === projectId)?.title || null
        : null);
    return {
      ...(conversationId ? { conversation_id: conversationId } : {}),
      title,
      ...(currentUrl ? { url: currentUrl } : {}),
      ...(projectId ? { project_id: projectId } : {}),
      ...(projectTitle ? { project_title: projectTitle } : {})
    };
  }

  function getCurrentChatGptContext(root = globalThis.document, url = globalThis.location?.href) {
    return getCurrentChatGptContextFromEntries(collectContextEntries(root, url), root, url);
  }

  function collectChatGptContext(root = globalThis.document, url = globalThis.location?.href) {
    const entries = collectContextEntries(root, url);
    return {
      projects: entries.projects,
      conversations: entries.conversations,
      current: getCurrentChatGptContext(root, url)
    };
  }

  async function collectChatGptContextAsync(
    root = globalThis.document,
    url = globalThis.location?.href,
    options = {}) {
    const merged = { projects: [], conversations: [] };
    // Resolve the Sidebar and its scroll container exactly once for the root
    // Project scan. Do not let virtualized DOM updates or final telemetry
    // replace either object while the monotonic scan is in progress.
    const sidebar = findSidebarRoot(root);
    const scrollContainer = findSidebarScrollContainer(root, sidebar);
    const canScroll = scrollContainer && typeof scrollContainer.scrollTop === "number"
      && typeof scrollContainer.scrollHeight === "number"
      && typeof scrollContainer.clientHeight === "number";
    const originalScrollTop = canScroll ? scrollContainer.scrollTop : null;
    const maxScrolls = Math.max(1, Math.min(64, Number(options.maxScrolls) || 32));
    const deadline = Date.now() + Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 30000));
    const initialSettleMs = options.initialSettleMs === undefined
      ? 250
      : Math.max(0, Math.min(2000, Number(options.initialSettleMs) || 0));
    const ensureCollectionActive = () => {
      if (options.signal?.aborted) {
        const error = new Error("Collection cancelled");
        error.name = "AbortError";
        throw error;
      }
      return Date.now() < deadline;
    };
    const allowSidebarControls = options.allowSidebarControls !== false;
    const projectDiscoverySource = typeof options.projectDiscoverySource === "string"
      && options.projectDiscoverySource.trim().length > 0
      ? options.projectDiscoverySource.trim().slice(0, 128)
      : "existing_project_section_metadata";
    let stagnantPasses = 0;
    let sidebarScrollComplete = !canScroll;
    const scrollDirection = canScroll ? "down" : "none";
    let sidebarRestoreCount = 0;
    let result = null;
    try {
      ensureCollectionActive();
      if (initialSettleMs > 0) await waitForSidebarMutation(root, initialSettleMs);
      ensureCollectionActive();
      const initial = collectContextEntries(root, url, sidebar);
      mergeContextProjectCatalog(merged, initial);
      mergeContextConversationCatalog(merged, initial);
      if (allowSidebarControls) await expandSidebarMoreButtons(root, options, sidebar);
      for (let pass = 0; pass < maxScrolls; pass += 1) {
        if (!ensureCollectionActive()) break;
        const beforeCount = merged.projects.length + merged.conversations.length;
        const beforeTop = canScroll ? Number(scrollContainer.scrollTop) || 0 : 0;
        const beforeHeight = canScroll ? Number(scrollContainer.scrollHeight) || 0 : 0;
        const clientHeight = canScroll ? Number(scrollContainer.clientHeight) || 0 : 0;
        const snapshot = collectContextEntries(root, url, sidebar);
        mergeContextProjectCatalog(merged, snapshot);
        mergeContextConversationCatalog(merged, snapshot);
        const added = merged.projects.length + merged.conversations.length - beforeCount;
        if (!canScroll) break;

        const maxTop = Math.max(0, beforeHeight - clientHeight);
        if (beforeTop >= maxTop) {
          sidebarScrollComplete = true;
          break;
        }
        const step = Math.max(1, Math.floor(Math.max(1, clientHeight) * 0.8));
        const nextTop = Math.min(maxTop, beforeTop + step);
        if (nextTop <= beforeTop) break;
        try { scrollContainer.scrollTop = nextTop; } catch (_) { break; }
        await waitForSidebarMutation(root, options.settleMs);
        if (!ensureCollectionActive()) break;
        const afterTop = Number(scrollContainer.scrollTop) || 0;
        const afterHeight = Number(scrollContainer.scrollHeight) || 0;
        if (added === 0 && afterTop === beforeTop && afterHeight === beforeHeight) {
          stagnantPasses += 1;
        } else {
          stagnantPasses = 0;
        }
        // Keep the old scan order: the next pass collects the rows exposed by
        // this scroll, including the final viewport at the bottom.
        if (stagnantPasses >= 2) {
          sidebarScrollComplete = true;
          break;
        }
      }
      const finalMetrics = scrollMetricsFor(scrollContainer);
      sidebarScrollComplete = sidebarScrollComplete
        || Boolean(finalMetrics && (!finalMetrics.canScroll
          || finalMetrics.atBottom
          || stagnantPasses >= 2));
      result = {
        // Project discovery is deliberately kept metadata-only. The
        // Collector receives these established Project URLs and performs the
        // later Chat scan by direct navigation in its single Collector Tab.
        projects: merged.projects,
        conversations: merged.conversations,
        current: getCurrentChatGptContextFromEntries(merged, root, url),
        project_discovery_source: projectDiscoverySource,
        ...sidebarScrollTelemetry(
          root,
          scrollContainer,
          stagnantPasses,
          merged.projects.length,
          sidebarScrollComplete,
          sidebar,
          scrollDirection,
          0)
      };
    } finally {
      if (scrollContainer && originalScrollTop !== null) {
        try {
          scrollContainer.scrollTop = originalScrollTop;
          sidebarRestoreCount = 1;
        } catch (_) { }
      }
    }
    if (result) {
      result.sidebar_restore_count = sidebarRestoreCount;
    }
    return result;
  }

  function conversationIdFromElement(element) {
    const explicit = [
      attributeValue(element, "data-conversation-id"),
      attributeValue(element, "data-conversation-id-value"),
      attributeValue(element, "data-thread-id")
    ].map((value) => metadataIdentifier(value)).find(Boolean);
    if (explicit) return explicit;
    for (const attribute of ["href", "data-href", "data-url", "data-conversation-url"]) {
      const conversationId = conversationIdFromUrl(attributeValue(element, attribute));
      if (conversationId) return conversationId;
    }
    return null;
  }

  function isDescendantOf(element, ancestor) {
    if (!element || !ancestor) return false;
    if (element === ancestor) return true;
    let current = element.parentElement;
    for (let depth = 0; current && depth < 32; depth += 1, current = current.parentElement) {
      if (current === ancestor) return true;
    }
    return false;
  }

  function projectTitleFromPage(root, projectId, url) {
    const sidebar = findSidebarRoot(root);
    const rows = projectRowsInSidebar(sidebar, url)
      .filter((row) => projectIdFromElement(row, url) === projectId);
    const rowTitle = rows.map((row) => visibleTitleFromElement(row, "")).find(Boolean);
    if (rowTitle) return rowTitle;

    const pageTitleSelectors = [
      "h1",
      '[data-project-title]',
      '[data-project-name]',
      '[data-testid*="project-title"]',
      '[data-testid*="project-name"]'
    ];
    for (const candidate of uniqueElements(pageTitleSelectors, root)
      .filter((element) => isVisible(element) && !isDescendantOf(element, sidebar))) {
      const title = visibleTitleFromElement(candidate, "");
      if (title) return title;
    }

    let documentTitle = "";
    try { documentTitle = root?.title || ""; } catch (_) { documentTitle = ""; }
    documentTitle = documentTitle.replace(/\s*[|·-]\s*ChatGPT\s*$/i, "").trim();
    return metadataTitle(documentTitle, `Project (${projectId})`);
  }

  function projectPageConversationElements(root) {
    return uniqueElements([
      "a[href]",
      "[href]",
      '[role="link"][href]',
      '[data-href]',
      '[data-url]',
      '[data-conversation-url]',
      "[data-conversation-id]",
      "[data-conversation-id-value]",
      "[data-thread-id]"
    ], root);
  }

  function documentReadyStateFor(root) {
    try {
      const state = root?.readyState || root?.ownerDocument?.readyState;
      return typeof state === "string" && state.length > 0 ? state : "complete";
    } catch (_) {
      return "unknown";
    }
  }

  function projectPageRelevantRegionElements(root, sidebar) {
    const hasSidebar = Boolean(sidebar && sidebar !== root);
    return uniqueElements([
      "main",
      '[role="main"]',
      '[data-project-id]',
      '[data-project-page]'
    ], root)
      .filter((element) => isVisible(element))
      .filter((element) => !hasSidebar || !isDescendantOf(element, sidebar));
  }

  function projectPageHydrationState(root, projectId, sidebarOverride = null) {
    const currentUrl = documentHref(root);
    const normalizedProjectId = metadataIdentifier(projectId);
    const currentProjectId = projectIdFromUrl(currentUrl);
    const projectPageReady = isProjectHomeUrl(currentUrl)
      && currentProjectId === normalizedProjectId;
    const sidebar = sidebarOverride || findSidebarRoot(root);
    const candidates = projectPageConversationElements(root);
    const relevantRegions = projectPageRelevantRegionElements(root, sidebar);
    const hasSidebar = Boolean(sidebar && sidebar !== root);
    const pageCandidates = candidates.filter((element) =>
      !hasSidebar || !isDescendantOf(element, sidebar));
    const containers = findProjectPageScrollContainers(root, sidebar, normalizedProjectId);
    return {
      project_page_ready: projectPageReady,
      document_ready_state: documentReadyStateFor(root),
      sidebar_root_present: Boolean(sidebar && sidebar !== root),
      sidebar_scroll_container_present: Boolean(findSidebarScrollContainer(root, sidebar)),
      candidate_chat_link_count: pageCandidates.filter((element) =>
        Boolean(conversationIdFromElement(element)
          || conversationIdFromUrl(metadataHrefFromElement(element, currentUrl)))).length,
      chat_scroll_container_count: containers.length,
      relevant_region_present: relevantRegions.length > 0
        || containers.length > 0
        || pageCandidates.length > 0
    };
  }

  function waitForProjectChatHydrationAsync(
    root,
    projectId,
    options = {}) {
    const initialState = projectPageHydrationState(root, projectId);
    const setTimer = typeof globalThis.setTimeout === "function"
      ? globalThis.setTimeout.bind(globalThis)
      : null;
    const clearTimer = typeof globalThis.clearTimeout === "function"
      ? globalThis.clearTimeout.bind(globalThis)
      : null;
    const MutationObserverCtor = root?.ownerDocument?.defaultView?.MutationObserver
      || globalThis.MutationObserver;
    const timeoutMs = Math.max(250, Math.min(15000,
      Number(options.projectChatHydrationTimeoutMs) || 10000));
    const quietTargetMs = Math.max(50, Math.min(3000,
      Number(options.projectChatHydrationQuietMs) || 350));
    const pollMs = Math.max(25, Math.min(500,
      Number(options.projectChatHydrationPollMs) || 100));

    // Unit-test/minimal DOM hosts may not expose timers. In that environment
    // there is no asynchronous lifecycle to wait for; the caller still gets
    // the structural state and the real browser path uses the observer below.
    if (!setTimer) {
      return Promise.resolve({
        ...initialState,
        mutation_count: 0,
        mutation_quiet_ms: 0,
        project_chat_hydration_completed: initialState.project_page_ready,
        project_chat_hydration_timeout: false
      });
    }

    return new Promise((resolve) => {
      const startedAt = Date.now();
      let lastMutationAt = startedAt;
      let stableAt = startedAt;
      let lastFingerprint = "";
      let mutationCount = 0;
      let observer = null;
      let pollTimer = null;
      let timeoutTimer = null;
      let settled = false;

      const stateWithTiming = (state, completed, errorCode = null) => ({
        ...state,
        mutation_count: mutationCount,
        mutation_quiet_ms: Math.max(0, Date.now() - lastMutationAt),
        project_chat_hydration_completed: completed,
        project_chat_hydration_timeout: !completed,
        ...(errorCode ? { errorCode } : {})
      });
      const finish = (state, completed, errorCode = null) => {
        if (settled) return;
        settled = true;
        if (observer) observer.disconnect();
        if (pollTimer !== null) clearTimer?.(pollTimer);
        if (timeoutTimer !== null) clearTimer?.(timeoutTimer);
        resolve(stateWithTiming(state, completed, errorCode));
      };
      const inspect = () => {
        if (settled) return;
        const state = projectPageHydrationState(root, projectId);
        const fingerprint = [
          state.project_page_ready,
          state.document_ready_state,
          state.sidebar_root_present,
          state.sidebar_scroll_container_present,
          state.candidate_chat_link_count,
          state.chat_scroll_container_count,
          state.relevant_region_present
        ].join("|");
        if (fingerprint !== lastFingerprint) {
          lastFingerprint = fingerprint;
          stableAt = Date.now();
        }
        const now = Date.now();
        const quietMs = Math.max(0, now - lastMutationAt);
        const fingerprintStableMs = Math.max(0, now - stableAt);
        const ready = state.project_page_ready
          && state.document_ready_state !== "loading"
          && state.relevant_region_present
          && quietMs >= quietTargetMs
          && fingerprintStableMs >= quietTargetMs;
        if (ready) {
          finish(state, true);
          return;
        }
        if (now - startedAt >= timeoutMs) {
          finish(state, false, "context_project_chat_dom_unavailable");
          return;
        }
        pollTimer = setTimer(inspect, pollMs);
      };

      if (typeof MutationObserverCtor === "function") {
        try {
          observer = new MutationObserverCtor((records) => {
            mutationCount += Number.isSafeInteger(records?.length) && records.length > 0
              ? records.length
              : 1;
            lastMutationAt = Date.now();
          });
          observer.observe(root?.documentElement || root, {
            childList: true,
            subtree: true,
            characterData: true
          });
        } catch (_) {
          observer = null;
        }
      }
      timeoutTimer = setTimer(() => {
        if (!settled) finish(
          projectPageHydrationState(root, projectId),
          false,
          "context_project_chat_dom_unavailable");
      }, timeoutMs);
      inspect();
    });
  }

  function sidebarConversationBelongsToProject(
    element,
    sidebar,
    normalizedProjectId,
    projectTitle,
    projectRows,
    url) {
    if (!element || !sidebar) return false;
    const currentProjectId = projectIdFromUrl(chatGptMetadataUrl(url, url));
    const normalizedTitle = String(projectTitle || "").trim().toLowerCase();
    let current = element;
    for (let depth = 0; current && depth < 32; depth += 1, current = current.parentElement) {
      if (projectIdFromElement(current, url) === normalizedProjectId) return true;
      if (metadataIdentifier(attributeValue(current, "data-project-id")) === normalizedProjectId) return true;
      if (projectRows.includes(current)
        && attributeValue(current, "aria-expanded").toLowerCase() === "true"
        && currentProjectId === normalizedProjectId) return true;
    }

    // On current ChatGPT builds a nested Project chat can be rendered as a
    // plain /c/<id> link. Its accessible label/data metadata is the only
    // stable relation left after virtualization removes the Project row.
    const relationText = [
      attributeValue(element, "aria-label"),
      attributeValue(element, "data-project-title"),
      attributeValue(element, "data-project-name")
    ].join(" ").toLowerCase();
    if (normalizedTitle && relationText.includes(normalizedTitle)) return true;

    // The current Project route alone does not establish ownership for a
    // plain /c/<id> link in the global Sidebar: that Sidebar can still contain
    // Projectless and other-Project conversations. Without an explicit
    // Project-scoped link, relation metadata, or an expanded owning row, keep
    // the entry out of this Project scan.
    return false;
  }

  function collectProjectContextEntries(
    root = globalThis.document,
    url = globalThis.location?.href,
    projectId) {
    const normalizedProjectId = metadataIdentifier(projectId);
    if (!normalizedProjectId) return { projects: [], conversations: [] };

    const sidebar = findSidebarRoot(root);
    const projectUrl = isProjectHomeUrl(url)
      ? chatGptMetadataUrl(url, url)
      : projectUrlFromConversationUrl(url, normalizedProjectId)
        || `https://chatgpt.com/g/${encodeURIComponent(normalizedProjectId)}/project`;
    const projectTitle = projectTitleFromPage(root, normalizedProjectId, url);
    const projects = [{
      project_id: normalizedProjectId,
      title: projectTitle,
      ...(projectUrl ? { url: projectUrl } : {})
    }];
    const conversations = [];
    const conversationById = new Map();
    const candidateElements = projectPageConversationElements(root);
    const conversationCandidates = candidateElements.filter((element) =>
      Boolean(conversationIdFromElement(element)
        || conversationIdFromUrl(metadataHrefFromElement(element, url))));
    const collectionTelemetry = {
      candidate_chat_link_count: conversationCandidates.length,
      matching_project_chat_link_count: 0,
      rejected_projectless_chat_count: 0,
      rejected_other_project_chat_count: 0
    };

    for (const element of candidateElements) {
      const href = metadataHrefFromElement(element, url);
      const conversationId = conversationIdFromElement(element) || conversationIdFromUrl(href);
      if (!conversationId) continue;
      const isInSidebar = sidebar !== root && isDescendantOf(element, sidebar);
      const explicitProjectId = projectIdFromUrl(href);
      if (explicitProjectId && explicitProjectId !== normalizedProjectId) {
        collectionTelemetry.rejected_other_project_chat_count += 1;
        continue;
      }
      // A /c/<id> link inside the sidebar is not enough to prove that it
      // belongs to the opened Project. Accept it only when the expanded row,
      // relation metadata, or current Project route provides that scope.
      if (isInSidebar && !explicitProjectId
        && !sidebarConversationBelongsToProject(
          element,
          sidebar,
          normalizedProjectId,
          projectTitle,
          projectRowsInSidebar(sidebar, url),
          url)) {
        collectionTelemetry.rejected_projectless_chat_count += 1;
        continue;
      }
      collectionTelemetry.matching_project_chat_link_count += 1;
      const conversationUrl = href
        || `https://chatgpt.com/g/${encodeURIComponent(normalizedProjectId)}/c/${encodeURIComponent(conversationId)}`;
      const entry = {
        conversation_id: conversationId,
        title: conversationTitleFromAnchor(element, conversationId),
        url: conversationUrl,
        project_id: normalizedProjectId,
        project_title: projectTitle
      };
      const existing = conversationById.get(conversationId);
      if (!existing) {
        conversationById.set(conversationId, entry);
        conversations.push(entry);
      } else {
        if (entry.title && (!existing.title || existing.title === conversationId)) existing.title = entry.title;
        if (entry.url && !existing.url) existing.url = entry.url;
      }
    }
    return { projects, conversations, ...collectionTelemetry };
  }

  function findProjectPageScrollContainers(root, sidebar, projectId = null) {
    const normalizedProjectId = metadataIdentifier(projectId);
    const sidebarContainer = findSidebarScrollContainer(root, sidebar);
    const candidates = [
      sidebarContainer,
      ...uniqueElements(sidebarScrollContainerSelectors, root),
      ...discoveredScrollContainerCandidates(root)
    ]
      .filter(Boolean)
      .filter((candidate, index, all) => all.indexOf(candidate) === index)
      .map((candidate) => ({ candidate, metrics: scrollMetricsFor(candidate) }))
      .filter((item) => item.metrics)
      .map((item) => item.candidate);
    const conversationElements = projectPageConversationElements(root);
    const hasSidebar = Boolean(sidebar && sidebar !== root);
    const projectRows = hasSidebar ? projectRowsInSidebar(sidebar, documentHref(root)) : [];
    const projectTitle = normalizedProjectId
      ? projectTitleFromPage(root, normalizedProjectId, documentHref(root))
      : "";
    const sidebarConversationElements = hasSidebar && normalizedProjectId
      ? conversationElements.filter((element) => {
        if (!isDescendantOf(element, sidebar)) return false;
        const href = metadataHrefFromElement(element, documentHref(root));
        const explicitProjectId = projectIdFromUrl(href);
        if (explicitProjectId) return explicitProjectId === normalizedProjectId;
        return sidebarConversationBelongsToProject(
          element,
          sidebar,
          normalizedProjectId,
          projectTitle,
          projectRows,
          documentHref(root));
      })
      : [];
    const pageConversationElements = conversationElements.filter((element) =>
      !hasSidebar || !isDescendantOf(element, sidebar));
    const containsConversation = (candidate, elements) => elements.some((element) =>
      candidate === element || isDescendantOf(element, candidate));
    const pageCandidates = candidates.filter((candidate) =>
      (!hasSidebar || (candidate !== sidebar && !isDescendantOf(candidate, sidebar)))
      && containsConversation(candidate, pageConversationElements));
    const sidebarCandidates = candidates.filter((candidate) =>
      hasSidebar
      && (candidate === sidebar || isDescendantOf(candidate, sidebar))
      && containsConversation(candidate, sidebarConversationElements));
    // A Project page may expose the current Project's chats in both the main
    // list and an expanded Project branch in the global Sidebar. The Sidebar
    // candidates have already been scoped by the current Project ID/owner;
    // retain both sets so a second virtualized list cannot hide chats from the
    // final ID-based merge.
    const relevant = [...pageCandidates, ...sidebarCandidates]
      .filter((candidate, index, all) => all.indexOf(candidate) === index);
    const scrollableRelevant = relevant.filter((candidate) => scrollMetricsFor(candidate)?.canScroll);
    // A Project page can have two independent virtualized lists: the global
    // ChatGPT sidebar and the Project's main chat list. Scanning only the
    // sidebar made the first visible chat look like the complete Project.
    // Visit every relevant movable container, preserving DOM order and
    // retaining the deepest candidate when a clipping shell contains the
    // actual scrollport. The old first-ancestor rule could discard the
    // Project page's real virtualized list.
    if (scrollableRelevant.length > 0) {
      return scrollableRelevant.filter((candidate, index, all) =>
        !all.some((other, otherIndex) => otherIndex !== index && isDescendantOf(other, candidate)));
    }
    if (sidebarContainer && scrollMetricsFor(sidebarContainer)) return [sidebarContainer];
    return relevant;
  }

  async function collectChatGptProjectContextAsync(
    root = globalThis.document,
    url = globalThis.location?.href,
    projectId,
    options = {}) {
    const normalizedProjectId = metadataIdentifier(projectId);
    if (!normalizedProjectId) return { projects: [], conversations: [], current: getCurrentChatGptContext(root, url) };

    const merged = { projects: [], conversations: [] };
    const currentUrl = documentHref(root, url);
    const currentProjectId = projectIdFromUrl(currentUrl);
    const projectPageReady = isProjectHomeUrl(currentUrl)
      && currentProjectId === normalizedProjectId;
    const deadline = Date.now() + Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 30000));
    const maxScrolls = Math.max(1, Math.min(128, Number(options.maxScrolls) || 64));
    const initialSettleMs = options.initialSettleMs === undefined
      ? 250
      : Math.max(0, Math.min(2000, Number(options.initialSettleMs) || 0));
    const emitTelemetry = (event = {}) => {
      try { options.onTelemetry?.(event); } catch (_) { }
    };
    const hydration = await waitForProjectChatHydrationAsync(root, normalizedProjectId, {
      projectChatHydrationTimeoutMs: options.projectChatHydrationTimeoutMs,
      projectChatHydrationQuietMs: options.projectChatHydrationQuietMs === undefined
        ? Math.max(150, initialSettleMs)
        : options.projectChatHydrationQuietMs,
      projectChatHydrationPollMs: options.projectChatHydrationPollMs
    });
    let sidebar = findSidebarRoot(root);
    let containers = findProjectPageScrollContainers(root, sidebar, normalizedProjectId);
    const hydrationTelemetry = {
      mutation_count: hydration.mutation_count,
      mutation_quiet_ms: hydration.mutation_quiet_ms,
      document_ready_state: hydration.document_ready_state,
      relevant_region_present: hydration.relevant_region_present,
      chat_scroll_container_count: containers.length
    };
    const hydrationSnapshot = collectProjectContextEntries(root, url, normalizedProjectId);
    const hydrationStructure = {
      ...hydrationTelemetry,
      candidate_chat_link_count: hydrationSnapshot.candidate_chat_link_count,
      matching_project_chat_link_count: hydrationSnapshot.matching_project_chat_link_count,
      rejected_projectless_chat_count: hydrationSnapshot.rejected_projectless_chat_count,
      rejected_other_project_chat_count: hydrationSnapshot.rejected_other_project_chat_count,
      current_project_id: normalizedProjectId,
      project_page_ready: projectPageReady,
      stage: "collector_project_chat_dom_structure"
    };
    emitTelemetry(hydrationStructure);
    if (!hydration.project_chat_hydration_completed) {
      emitTelemetry({
        ...hydrationStructure,
        error_code: hydration.errorCode || "context_project_chat_dom_unavailable",
        failure_stage: "project_chat_hydration",
        internal_reason: "project_page_not_hydrated",
        exception_reason: "none",
        resolution_success: false,
        stage: "collector_project_chat_collection_failed"
      });
      return {
        projects: hydrationSnapshot.projects,
        conversations: [],
        current: getCurrentChatGptContextFromEntries(hydrationSnapshot, root, url),
        project_page_ready: projectPageReady,
        current_project_id_verified: currentProjectId === normalizedProjectId,
        chat_container_found: false,
        visible_chat_count: 0,
        discovered_chat_count: 0,
        deduped_chat_count: 0,
        duplicate_chat_count: 0,
        scroll_iteration: 0,
        scroll_top: 0,
        scroll_height: 0,
        scroll_complete: false,
        project_chat_collection_complete: false,
        ...hydrationTelemetry,
        candidate_chat_link_count: hydrationSnapshot.candidate_chat_link_count || 0,
        matching_project_chat_link_count: hydrationSnapshot.matching_project_chat_link_count || 0,
        rejected_projectless_chat_count: hydrationSnapshot.rejected_projectless_chat_count || 0,
        rejected_other_project_chat_count: hydrationSnapshot.rejected_other_project_chat_count || 0,
        project_chat_hydration_completed: false,
        project_chat_hydration_timeout: true
      };
    }
    let noGrowthCount = 0;
    // No scroll container means the page exposed a static Chat list. That is
    // a completed scan once a Project Chat container (or entry) is observed;
    // only a detected container that fails its bounded scan makes this false.
    let sidebarScrollComplete = true;
    let visibleChatCount = 0;
    let scrollIteration = 0;
    let lastScrollMetrics = null;
    let duplicateChatCount = 0;
    let chatContainerFound = containers.length > 0;
    const hasSidebar = Boolean(sidebar && sidebar !== root);
    let scrollPositionChanged = false;
    let latestSnapshot = hydrationSnapshot;
    let lastScanTelemetry = "";
    const emitScanTelemetry = (reachedEnd = false, force = false) => {
      const scan = {
        current_project_id: normalizedProjectId,
        discovered_chat_count: merged.conversations.length,
        deduped_chat_count: merged.conversations.length,
        scan_iteration: scrollIteration,
        mutation_count: hydration.mutation_count,
        mutation_quiet_ms: hydration.mutation_quiet_ms,
        scroll_position_changed: scrollPositionChanged,
        reached_end: reachedEnd,
        stage: "collector_project_chat_scan"
      };
      const signature = JSON.stringify(scan);
      if (force || signature !== lastScanTelemetry) {
        lastScanTelemetry = signature;
        emitTelemetry(scan);
      }
    };
    const collect = () => {
      if (options.signal?.aborted) {
        const error = new Error("Collection cancelled");
        error.name = "AbortError";
        throw error;
      }
      if (Date.now() >= deadline) return false;
      const beforeCount = merged.conversations.length;
      const snapshot = collectProjectContextEntries(root, url, normalizedProjectId);
      latestSnapshot = snapshot;
      mergeContextProjectCatalog(merged, snapshot);
      mergeContextConversationCatalog(merged, snapshot);
      visibleChatCount = Math.max(visibleChatCount, snapshot.conversations.length);
      duplicateChatCount += Math.max(0, snapshot.conversations.length
        - (merged.conversations.length - beforeCount));
      chatContainerFound = chatContainerFound
        || snapshot.conversations.length > 0;
      return true;
    };

    if (initialSettleMs > 0) await waitForSidebarMutation(root, initialSettleMs);
    if (!collect()) sidebarScrollComplete = false;
    emitScanTelemetry(false, true);
    for (const [containerIndex, container] of containers.entries()) {
      let activeContainer = container;
      const initialMetrics = scrollMetricsFor(activeContainer);
      const originalScrollTop = initialMetrics?.scrollTop ?? 0;
      let containerNoGrowthCount = 0;
      let containerComplete = Boolean(initialMetrics && !initialMetrics.canScroll);
      try {
        const canExploreContainer = !(initialMetrics?.canScroll)
          || canMoveScrollContainer(activeContainer, initialMetrics);
        if (!canExploreContainer) {
          containerComplete = false;
        } else {
          for (let pass = 0; pass < maxScrolls && Date.now() < deadline; pass += 1) {
            const refreshedContainers = findProjectPageScrollContainers(
              root,
              findSidebarRoot(root),
              normalizedProjectId);
            // React may replace a virtualized scrollport after each lazy-load.
            // Keep the same logical list by identity first, then by its
            // stable container position; never jump to container zero while
            // scanning a later Project-page list.
            const refreshedContainer = refreshedContainers.find((candidate) => candidate === activeContainer)
              || refreshedContainers[containerIndex]
              || null;
            if (refreshedContainer && refreshedContainer !== activeContainer) {
              const previousTop = scrollMetricsFor(activeContainer)?.scrollTop;
              if (Number.isFinite(previousTop)) {
                try { refreshedContainer.scrollTop = previousTop; } catch (_) { }
              }
              activeContainer = refreshedContainer;
            } else if (!refreshedContainer && activeContainer?.isConnected === false) {
              containerComplete = false;
              break;
            }
            const beforeCount = merged.conversations.length;
            const beforeMetrics = scrollMetricsFor(activeContainer);
            if (!beforeMetrics) {
              containerComplete = false;
              break;
            }
            lastScrollMetrics = beforeMetrics;
            if (!collect()) {
              containerComplete = false;
              break;
            }
            if (!beforeMetrics.canScroll || beforeMetrics.atBottom) {
              containerComplete = true;
              break;
            }
            const maxTop = Math.max(0, beforeMetrics.scrollHeight - beforeMetrics.clientHeight);
            const step = Math.max(1, Math.floor(Math.max(1, beforeMetrics.clientHeight) * 0.8));
            const nextTop = Math.min(maxTop, beforeMetrics.scrollTop + step);
            if (nextTop <= beforeMetrics.scrollTop) {
              containerNoGrowthCount += 1;
              if (containerNoGrowthCount >= 2) containerComplete = true;
              if (containerComplete) break;
              continue;
            }
            try {
              activeContainer.scrollTop = nextTop;
              scrollIteration += 1;
              scrollPositionChanged = true;
            } catch (_) {
              containerNoGrowthCount += 1;
              if (containerNoGrowthCount >= 2) containerComplete = true;
              if (containerComplete) break;
              continue;
            }
            await waitForSidebarMutation(root, options.settleMs);
            if (!collect()) {
              containerComplete = false;
              break;
            }
            const afterMetrics = scrollMetricsFor(activeContainer);
            if (!afterMetrics) {
              containerComplete = false;
              break;
            }
            lastScrollMetrics = afterMetrics;
            const added = merged.conversations.length - beforeCount;
            if (added === 0
              && afterMetrics.scrollTop === beforeMetrics.scrollTop
              && afterMetrics.scrollHeight === beforeMetrics.scrollHeight) {
              containerNoGrowthCount += 1;
            } else {
              containerNoGrowthCount = 0;
            }
            if (afterMetrics.atBottom || containerNoGrowthCount >= 2) {
              containerComplete = true;
              emitScanTelemetry(true, true);
              break;
            }
            emitScanTelemetry(false, added > 0);
          }
        }
        if (!containerComplete && Date.now() >= deadline) sidebarScrollComplete = false;
      } finally {
        try { activeContainer.scrollTop = originalScrollTop; } catch (_) { }
      }
      noGrowthCount = Math.max(noGrowthCount, containerNoGrowthCount);
      sidebarScrollComplete = sidebarScrollComplete && containerComplete;
    }

    const visibleProjectPageContainers = uniqueElements([
      "main",
      '[role="main"]',
      '[data-testid*="project"]'
    ], root)
      .filter((element) => isVisible(element))
      .filter((element) => !hasSidebar || !isDescendantOf(element, sidebar));
    chatContainerFound = chatContainerFound || visibleProjectPageContainers.length > 0;
    const finalMetrics = lastScrollMetrics
      || scrollMetricsFor(containers.at(-1))
      || scrollMetricsFor(findSidebarScrollContainer(root, sidebar));
    const projectChatCollectionComplete = projectPageReady
      && chatContainerFound
      && sidebarScrollComplete;
    const finalRelevantRegion = projectPageRelevantRegionElements(root, sidebar).length > 0
      || containers.length > 0;
    emitScanTelemetry(
      projectChatCollectionComplete
        || containers.every((container) => scrollMetricsFor(container)?.atBottom !== false),
      true);

    return {
      projects: merged.projects,
      conversations: merged.conversations,
      current: getCurrentChatGptContextFromEntries(merged, root, url),
      project_page_ready: projectPageReady,
      current_project_id_verified: currentProjectId === normalizedProjectId,
      chat_container_found: chatContainerFound,
      visible_chat_count: visibleChatCount,
      discovered_chat_count: merged.conversations.length,
      deduped_chat_count: merged.conversations.length,
      duplicate_chat_count: duplicateChatCount,
      scroll_iteration: scrollIteration,
      scroll_top: finalMetrics ? Math.round(finalMetrics.scrollTop) : 0,
      scroll_height: finalMetrics ? Math.round(finalMetrics.scrollHeight) : 0,
      scroll_complete: projectChatCollectionComplete,
      project_chat_collection_complete: projectChatCollectionComplete,
      project_chat_hydration_completed: true,
      project_chat_hydration_timeout: false,
      candidate_chat_link_count: latestSnapshot.candidate_chat_link_count || 0,
      matching_project_chat_link_count: latestSnapshot.matching_project_chat_link_count || 0,
      rejected_projectless_chat_count: latestSnapshot.rejected_projectless_chat_count || 0,
      rejected_other_project_chat_count: latestSnapshot.rejected_other_project_chat_count || 0,
      chat_scroll_container_count: containers.length,
      relevant_region_present: finalRelevantRegion,
      document_ready_state: documentReadyStateFor(root),
      mutation_count: hydration.mutation_count,
      mutation_quiet_ms: hydration.mutation_quiet_ms,
      scroll_position_changed: scrollPositionChanged,
      reached_end: projectChatCollectionComplete
        || containers.every((container) => scrollMetricsFor(container)?.atBottom !== false),
      ...sidebarScrollTelemetry(
        root,
        finalMetrics ? containers.at(-1) : null,
        noGrowthCount,
        merged.projects.length,
        projectChatCollectionComplete)
    };
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

  function sortInDocumentOrder(elements) {
    return [...elements].sort((left, right) => {
      if (left === right) return 0;
      if (typeof left?.compareDocumentPosition === "function") {
        const position = left.compareDocumentPosition(right);
        if ((position & 4) !== 0) return -1;
        if ((position & 2) !== 0) return 1;
      }
      return 0;
    });
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

  function semanticElementAttributes(element) {
    return [
      attributeValue(element, "data-testid"),
      attributeValue(element, "data-state"),
      attributeValue(element, "data-status"),
      attributeValue(element, "aria-label"),
      attributeValue(element, "title"),
      attributeValue(element, "class")
    ].join(" ").toLowerCase();
  }

  function isStatusOrProgressElement(element) {
    if (!element) return false;
    const role = attributeValue(element, "role").toLowerCase();
    if (transientRolePattern.test(role)) return true;
    if (hasAttribute(element, "aria-live")) return true;
    return transientSemanticPattern.test(semanticElementAttributes(element));
  }

  function isAssistantActionElement(element) {
    if (!element) return false;
    const tagName = element.tagName?.toLowerCase();
    const role = attributeValue(element, "role").toLowerCase();
    return tagName === "button"
      || tagName === "input"
      || role === "button"
      || role === "toolbar"
      || role === "menu"
      || role === "menuitem";
  }

  function hasCodeDescendant(element) {
    if (!element) return false;
    if (element.tagName?.toLowerCase() === "pre") return true;
    try {
      return Boolean(element.querySelector?.("pre"));
    } catch (_) {
      return false;
    }
  }

  function isTransientTextElement(element) {
    if (!element || hasCodeDescendant(element)) return false;
    const text = normalizeLineEndings(rawElementText(element))
      .replace(zeroWidthPattern, "")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > 0 && text.length <= 240 && transientTextPattern.test(text);
  }

  function isAssistantNoiseElement(element) {
    return isStatusOrProgressElement(element)
      || isAssistantActionElement(element)
      || isTransientTextElement(element);
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

  function composerScope(composer) {
    if (!composer) return null;
    const form = composer.closest?.("form");
    if (form) return form;

    // ChatGPT variants without a form still keep the composer controls in a
    // small ancestor container. Stop before the document body so an unrelated
    // file input elsewhere on the page is never selected.
    let current = composer.parentElement;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      if (current.getAttribute?.("role") === "group"
        || current.getAttribute?.("data-testid")?.toLowerCase().includes("composer")) return current;
    }
    return composer.parentElement || composer;
  }

  function isFileInput(element) {
    return element?.tagName?.toLowerCase() === "input"
      && (element.getAttribute("type") || "text").toLowerCase() === "file";
  }

  function fileInputScore(element, composer) {
    if (!isFileInput(element)) return -10000;
    const accept = attributeValue(element, "accept").toLowerCase();
    const testId = attributeValue(element, "data-testid").toLowerCase();
    const label = semanticActionText(element);
    let score = 10;
    if (accept.includes("image") || accept.includes("video")) score += 60;
    if (testId.includes("file") || testId.includes("upload")) score += 30;
    if (/(?:attachment|upload|file|添付|ファイル|アップロード)/i.test(label)) score += 20;
    if (element.closest?.("form") && element.closest("form") === composer?.closest?.("form")) score += 100;
    return score;
  }

  function findFileInput(root = globalThis.document, composer = findComposer(root)) {
    if (!root?.querySelectorAll || !composer) return null;
    const scope = composerScope(composer);
    const scopedElements = uniqueElements(fileInputSelectors, scope || root);
    const rootElements = scope && scope !== root ? uniqueElements(fileInputSelectors, root) : [];
    const candidates = [...new Set([...scopedElements, ...rootElements])]
      .filter((element) => isFileInput(element))
      .map((element) => ({
        element,
        score: fileInputScore(element, composer),
        isScoped: scopedElements.includes(element)
      }))
      // A file input outside the composer scope is acceptable only when its
      // own accept/test-id metadata strongly identifies it as ChatGPT's
      // upload control. This avoids selecting an unrelated page form.
      .filter((candidate) => candidate.isScoped ? candidate.score > 0 : candidate.score >= 40)
      .sort((left, right) => right.score - left.score);
    return candidates[0]?.element || null;
  }

  function attachmentControlScore(element, composer) {
    if (!element || isFileInput(element)) return -10000;
    const tagName = element.tagName?.toLowerCase();
    const role = attributeValue(element, "role").toLowerCase();
    if (tagName !== "button" && role !== "button") return -10000;
    const label = semanticActionText(element);
    if (!attachmentControlPattern.test(label) || excludedAttachmentControlPattern.test(label)) return -10000;

    let score = 10;
    const testId = attributeValue(element, "data-testid").toLowerCase();
    const ariaLabel = attributeValue(element, "aria-label").toLowerCase();
    if (testId.includes("attachment") || testId.includes("attach")) score += 150;
    if (testId.includes("upload") || testId.includes("file")) score += 130;
    if (ariaLabel.includes("attachment") || ariaLabel.includes("attach")) score += 110;
    if (ariaLabel.includes("upload") || ariaLabel.includes("file")) score += 100;
    if (ariaLabel.includes("photo") || ariaLabel.includes("image") || /添付|ファイル|写真|画像|アップロード/.test(ariaLabel)) score += 80;
    if (element.closest?.("form") && element.closest("form") === composer?.closest?.("form")) score += 100;
    return score;
  }

  function findAttachmentControl(root = globalThis.document, composer = findComposer(root)) {
    if (!root?.querySelectorAll || !composer) return null;
    const scope = composerScope(composer);
    const ranked = uniqueElements(attachmentControlSelectors, scope || root)
      .filter((element) => isVisible(element))
      .map((element) => ({ element, score: attachmentControlScore(element, composer) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score);
    if (ranked.length === 0) return null;
    const best = ranked[0];
    const next = ranked[1];
    return next && next.score === best.score ? null : best.element;
  }

  function attachmentText(element) {
    if (!element) return "";
    return [
      attributeValue(element, "data-file-name"),
      attributeValue(element, "data-filename"),
      attributeValue(element, "aria-label"),
      attributeValue(element, "title"),
      rawElementText(element)
    ].filter(Boolean).join(" ");
  }

  function attachmentNameMatches(element, fileName) {
    const expected = String(fileName || "").trim().toLowerCase();
    if (!expected) return false;
    return attachmentText(element).toLowerCase().includes(expected);
  }

  function isAttachmentUploading(element) {
    if (!element) return false;
    let current = element;
    for (let depth = 0; current && depth < 5; depth += 1, current = current.parentElement) {
      const role = attributeValue(current, "role").toLowerCase();
      const semantic = semanticElementAttributes(current);
      const state = `${attributeValue(current, "data-state")} ${attributeValue(current, "data-status")}`.toLowerCase();
      const ariaBusy = attributeValue(current, "aria-busy").toLowerCase();
      if (role === "progressbar"
        || ariaBusy === "true"
        || /(?:uploading|pending|loading|processing|アップロード中|読み込み中|処理中)/i.test(`${semantic} ${state} ${attachmentText(current)}`)) return true;
    }
    return false;
  }

  function findAttachmentIndicators(root = globalThis.document, fileName, composer = findComposer(root)) {
    if (!composer) return [];
    const scope = composerScope(composer) || root;
    const candidates = uniqueElements(attachmentIndicatorSelectors, scope);
    // Some ChatGPT builds render a plain filename chip without a stable
    // data-testid. Search only the composer scope, never the whole document.
    try {
      for (const element of Array.from(scope.querySelectorAll?.("*") || [])) {
        if (attachmentNameMatches(element, fileName) && !candidates.includes(element)) candidates.push(element);
      }
    } catch (_) { }
    return candidates.filter((element) => attachmentNameMatches(element, fileName));
  }

  function findAttachmentByFilename(root = globalThis.document, fileName, composer = findComposer(root)) {
    const indicators = findAttachmentIndicators(root, fileName, composer);
    return indicators.find((element) => isVisible(element) || isAttachmentUploading(element)) || null;
  }

  function isAttachmentUploadComplete(root = globalThis.document, fileName, composer = findComposer(root)) {
    const indicator = findAttachmentByFilename(root, fileName, composer);
    return Boolean(indicator && !isAttachmentUploading(indicator));
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
    const candidates = [element.innerText, element.textContent]
      .filter((value) => typeof value === "string");
    return normalizeText(candidates.find((value) => value.trim().length > 0) || candidates[0] || "");
  }

  function normalizeLineEndings(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n");
  }

  function rawElementText(element) {
    if (!element) return "";
    try {
      if (typeof element.textContent === "string") return element.textContent;
    } catch (_) {
      // A stale node can still have a usable innerText representation.
    }
    try {
      if (typeof element.innerText === "string") return element.innerText;
    } catch (_) {
      // The caller will report an empty extraction if both representations fail.
    }
    return "";
  }

  function directChildren(element) {
    try {
      return Array.from(element?.children || []);
    } catch (_) {
      return [];
    }
  }

  function attributeValue(element, name) {
    try {
      return element?.getAttribute?.(name) || "";
    } catch (_) {
      return "";
    }
  }

  function hasAttribute(element, name) {
    try {
      return element?.getAttribute?.(name) !== null && element?.getAttribute?.(name) !== undefined;
    } catch (_) {
      return false;
    }
  }

  function hasConnectorCommandLanguage(element) {
    if (!element) return false;
    const semanticValues = [
      attributeValue(element, "data-language"),
      attributeValue(element, "data-code-language"),
      attributeValue(element, "data-lang"),
      attributeValue(element, "data-testid"),
      attributeValue(element, "lang"),
      attributeValue(element, "class"),
      attributeValue(element, "aria-label"),
      attributeValue(element, "title")
    ];
    return semanticValues.some((value) => /(?:^|\s)(?:language-|lang-)?connector-command(?:\s|$)/i.test(value.trim()));
  }

  function hasConnectorCommandHeader(pre, code) {
    const containers = [pre, pre?.parentElement, pre?.parentElement?.parentElement].filter(Boolean);
    for (const container of containers) {
      for (const child of directChildren(container)) {
        if (child === pre || child === code) continue;
        if (hasConnectorCommandLanguage(child)) return true;
        const label = rawElementText(child).replace(/\s+/g, " ").trim();
        if (label.toLowerCase() === "connector-command") return true;
      }
    }
    return false;
  }

  function hasJsonStringField(text, fieldName, expectedValue) {
    if (typeof expectedValue !== "string" || expectedValue.length === 0) return false;
    const pattern = new RegExp(
      `"${escapeRegExp(fieldName)}"\\s*:\\s*"${escapeRegExp(expectedValue)}"`,
      ""
    );
    return pattern.test(normalizeLineEndings(text));
  }

  function matchesResponseContext(codeText, responseContext) {
    const normalized = normalizeLineEndings(codeText).trim();
    if (!normalized.startsWith("{") || !normalized.endsWith("}")) return false;
    return hasJsonStringField(normalized, "protocol", responseContext?.protocol)
      && hasJsonStringField(normalized, "handoff_id", responseContext?.handoffId || responseContext?.handoff_id)
      && hasJsonStringField(normalized, "session_id", responseContext?.sessionId || responseContext?.session_id);
  }

  function isConnectorCommandCodeBlock(pre, code, responseContext) {
    if (hasConnectorCommandLanguage(pre) || hasConnectorCommandLanguage(code)) return true;
    for (const child of directChildren(pre)) {
      if (child !== code && hasConnectorCommandLanguage(child)) return true;
    }
    if (hasConnectorCommandHeader(pre, code)) return true;
    // Some renderers retain only <pre><code> and discard both the source
    // fence language and the visible language label. Use the already-bound
    // response context as a narrow structural discriminator; this is not a
    // Connector Protocol parser and does not validate slots or payloads.
    return matchesResponseContext(rawElementText(code), responseContext);
  }

  function findCodeBlocks(root) {
    if (!root) return [];
    const blocks = [];
    if (root.tagName?.toLowerCase() === "pre") blocks.push(root);
    try {
      for (const block of Array.from(root.querySelectorAll?.("pre") || [])) {
        if (!blocks.includes(block)) blocks.push(block);
      }
    } catch (_) {
      // The rendered message may be a lightweight/stale node.
    }
    return blocks;
  }

  function findCodeElement(pre) {
    try {
      return pre?.querySelector?.("code") || pre;
    } catch (_) {
      return pre;
    }
  }

  function stripCodeBoundaryLineEndings(value) {
    return normalizeLineEndings(value).replace(/^\n+/, "").replace(/\n+$/, "");
  }

  function connectorCommandFence(codeText) {
    return `\`\`\`connector-command\n${stripCodeBoundaryLineEndings(codeText)}\n\`\`\``;
  }

  function elementDepth(element) {
    let depth = 0;
    let current = element?.parentElement;
    while (current) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  }

  function assistantContentScore(element, message, responseContext) {
    if (!element || isStatusOrProgressElement(element) || isAssistantActionElement(element)) return -10000;
    if (element === message) return hasCodeDescendant(element) ? 100 : 0;

    const testId = attributeValue(element, "data-testid").toLowerCase();
    const className = attributeValue(element, "class").toLowerCase();
    let score = 10;
    if (hasAttribute(element, "data-message-content")) score += 240;
    if (testId.includes("message-content")) score += 220;
    if (testId.includes("markdown")) score += 190;
    if (className.includes("markdown")) score += 180;
    if (className.includes("prose")) score += 160;
    if (hasCodeDescendant(element)) score += 100;
    if (findCodeBlocks(element).some((pre) => isConnectorCommandCodeBlock(pre, findCodeElement(pre), responseContext))) {
      score += 80;
    }
    // If two renderers expose equivalent content wrappers, prefer the more
    // specific/deeper one. This keeps action/status siblings outside the root.
    return score + elementDepth(element) / 1000;
  }

  function findAssistantContentRoot(message, responseContext = null) {
    if (!message) return null;
    const candidates = [message, ...uniqueElements(assistantContentSelectors, message)]
      .filter((element, index, all) => all.indexOf(element) === index)
      .filter((element) => element === message || (isVisible(element) && !isStatusOrProgressElement(element) && !isAssistantActionElement(element)));
    // If a renderer places the command block beside (rather than inside) its
    // preferred text wrapper, keep the message root as the extraction scope.
    // Conversely, when the block is inside a Markdown wrapper, use that
    // narrower root and leave sibling status UI out of the clone.
    const responseCandidates = candidates.filter((element) =>
      findCodeBlocks(element).some((pre) => isConnectorCommandCodeBlock(pre, findCodeElement(pre), responseContext))
      || hasRawConnectorCommandFence(element));
    return (responseCandidates.length > 0 ? responseCandidates : candidates).sort((left, right) =>
      assistantContentScore(right, message, responseContext) - assistantContentScore(left, message, responseContext))[0] || message;
  }

  function removeAssistantNoise(root) {
    if (!root?.querySelectorAll) return;
    let descendants = [];
    try {
      descendants = Array.from(root.querySelectorAll("*"));
    } catch (_) {
      descendants = [];
    }
    // Remove deepest nodes first. A status/live region can contain several
    // nested spans; removing the region itself is the important boundary.
    for (const element of descendants.reverse()) {
      if (!isAssistantNoiseElement(element)) continue;
      try {
        element.parentElement?.removeChild(element);
      } catch (_) {
        // A concurrently reconciled message is safe to skip; extraction will
        // still be gated by the connector-command structural guard.
      }
    }
  }

  function hasRawConnectorCommandFence(root) {
    const text = normalizeLineEndings(renderedElementText(root));
    const match = text.match(/```[ \t]*connector-command(?:[ \t]*\r?\n)([\s\S]*?)```/i);
    if (!match) return false;
    // This is only a structural guard. Desktop remains responsible for the
    // strict JSON/slot/payload validation at the transport boundary.
    return /["']protocol["']\s*:\s*["']comfy-connector\/1["']/i.test(match[1]);
  }

  function hasConnectorCommandResponse(element, responseContext = null) {
    const root = findAssistantContentRoot(element, responseContext);
    if (!root) return false;
    return findCodeBlocks(root).some((pre) =>
      isConnectorCommandCodeBlock(pre, findCodeElement(pre), responseContext))
      || hasRawConnectorCommandFence(root);
  }

  const blockElementTags = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
    "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
    "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
    "PRE", "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL"
  ]);

  function childNodesOf(element) {
    try {
      if (element?.childNodes) return Array.from(element.childNodes);
    } catch (_) {
      // Fall back to element children for lightweight test DOMs and stale nodes.
    }
    return directChildren(element);
  }

  function isBlockElement(element) {
    return blockElementTags.has(element?.tagName?.toUpperCase());
  }

  function renderedDomNodeText(node) {
    if (!node) return "";
    if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue || "";

    const children = childNodesOf(node);
    if (children.length === 0) return rawElementText(node);

    // Fake DOM fixtures do not expose text nodes. In a real DOM, direct text
    // is already present in childNodes and this private-field branch is never
    // used.
    const ownText = !node.childNodes && typeof node._textContent === "string"
      ? node._textContent
      : "";
    return ownText + renderedDomSequenceText(children);
  }

  function renderedDomSequenceText(nodes) {
    let result = "";
    for (const node of nodes) {
      const text = renderedDomNodeText(node);
      if (!text && !isBlockElement(node)) continue;
      if (isBlockElement(node) && result && !result.endsWith("\n")) result += "\n";
      result += text;
      if (isBlockElement(node) && !result.endsWith("\n")) result += "\n";
    }
    return result;
  }

  function renderedElementText(element) {
    if (!element) return "";
    const structuralText = renderedDomNodeText(element);
    if (structuralText.trim().length > 0) {
      return normalizeLineEndings(structuralText).replace(/^\n+/, "").replace(/\n+$/, "");
    }
    const candidates = [];
    try {
      if (typeof element.innerText === "string") candidates.push(element.innerText);
    } catch (_) { }
    try {
      if (typeof element.textContent === "string") candidates.push(element.textContent);
    } catch (_) { }
    return normalizeLineEndings(candidates.find((value) => value.trim().length > 0) || candidates[0] || "");
  }

  // Markdown renderers remove the source fence from <pre><code> DOM. Work on
  // a clone so the page is never mutated, preserve raw code/payload text, and
  // restore only the Connector command fence that the Desktop grammar expects.
  function readAssistantResponseText(element, responseContext = null) {
    if (!element) return "";
    const sourceRoot = findAssistantContentRoot(element, responseContext) || element;
    const clone = typeof sourceRoot.cloneNode === "function" ? sourceRoot.cloneNode(true) : null;
    if (!clone) return readMessageText(sourceRoot);

    // The assistant turn may contain a generating/status live region and
    // action toolbar next to the actual Markdown body. Never include those
    // UI strings in the response sent to Desktop.
    removeAssistantNoise(clone);

    for (const pre of findCodeBlocks(clone)) {
      const code = findCodeElement(pre);
      const codeText = rawElementText(code);
      const replacement = isConnectorCommandCodeBlock(pre, code, responseContext)
        ? connectorCommandFence(codeText)
        : normalizeLineEndings(codeText);
      try {
        // Replacing the whole cloned <pre> also removes copy buttons and
        // language-label UI text, while leaving COMFY_PAYLOAD content intact.
        pre.textContent = replacement;
      } catch (_) {
        // If a browser-specific node is not writable, the final rendered text
        // still provides the safest available response representation.
      }
    }

    return renderedElementText(clone);
  }

  function isStatusOnlyAssistantMessage(element) {
    if (!element || findCodeBlocks(element).length > 0) return false;
    let descendants = [];
    try {
      descendants = Array.from(element.querySelectorAll?.("*") || []);
    } catch (_) {
      descendants = [];
    }
    if (!descendants.some((candidate) => isStatusOrProgressElement(candidate))) return false;

    const clone = typeof element.cloneNode === "function" ? element.cloneNode(true) : null;
    if (!clone) return false;
    removeAssistantNoise(clone);
    return renderedElementText(clone).trim().length === 0;
  }

  function comparableMessageText(value) {
    return normalizeText(value)
      .replace(/\u200b/g, "")
      // ChatGPT may expose a synthetic final newline through innerText.
      .replace(/\n+$/, "");
  }

  function isAssistantMessageElement(element) {
    if (!element || isAssistantActionElement(element)) return false;
    const roles = [
      attributeValue(element, "data-message-author-role"),
      attributeValue(element, "data-turn"),
      attributeValue(element, "data-author-role")
    ].map((value) => value.toLowerCase());
    const hasAssistantRole = roles.includes("assistant");

    const testId = attributeValue(element, "data-testid").toLowerCase();
    const hasAssistantTestId = testId.includes("assistant-message") || testId.includes("conversation-turn-assistant");
    // An assistant turn may itself be announced with aria-live while it is
    // streaming. Keep the explicit message container, but reject standalone
    // status/live-region nodes that only happen to contain assistant text.
    return (hasAssistantRole || hasAssistantTestId)
      && (!isStatusOrProgressElement(element) || hasAssistantRole);
  }

  function findUserMessages(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    return sortInDocumentOrder(uniqueElements(userMessageSelectors, root)
      .filter((element) => isVisible(element)));
  }

  function findAssistantMessages(root = globalThis.document) {
    if (!root?.querySelectorAll) return [];
    return sortInDocumentOrder(uniqueElements(assistantMessageSelectors, root)
      .filter((element) => isVisible(element)
        && isAssistantMessageElement(element)
        && !isStatusOnlyAssistantMessage(element)));
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

  function captureAssistantMessageSnapshot(root = globalThis.document) {
    const messages = findAssistantMessages(root);
    return {
      count: messages.length,
      elements: new Set(messages)
    };
  }

  function findNewAssistantMessages(root, snapshot) {
    const messages = findAssistantMessages(root);
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

  function findUserMessageWithCorrelation(root, correlation) {
    const handoffId = correlation?.handoffId || correlation?.handoff_id;
    const boundaryId = correlation?.boundaryId || correlation?.boundary_id;
    if (!handoffId || !boundaryId) return null;
    const protocol = correlation?.protocol;
    return findUserMessages(root).filter((message) =>
      messageContainsMarker(message, handoffId)
      && messageContainsMarker(message, boundaryId)
      && (!protocol || messageContainsMarker(message, protocol))).at(-1) || null;
  }

  function isAfterAnchor(root, anchor, candidate) {
    if (!anchor || !candidate || anchor === candidate) return false;
    if (typeof anchor.compareDocumentPosition === "function") {
      // Node.DOCUMENT_POSITION_FOLLOWING is 4. Avoid depending on the global
      // Node constructor so this helper remains usable in lightweight tests.
      return (anchor.compareDocumentPosition(candidate) & 4) !== 0;
    }

    try {
      const ordered = Array.from(root.querySelectorAll("*"));
      const anchorIndex = ordered.indexOf(anchor);
      const candidateIndex = ordered.indexOf(candidate);
      return anchorIndex >= 0 && candidateIndex > anchorIndex;
    } catch (_) {
      return false;
    }
  }

  function findAssistantMessagesAfterAnchor(root, anchor) {
    if (!anchor) return [];
    return findAssistantMessages(root).filter((message) => isAfterAnchor(root, anchor, message));
  }

  function findAssistantMessageWithCorrelation(root, correlation) {
    const anchor = findUserMessageWithCorrelation(root, correlation);
    return findAssistantMessagesAfterAnchor(root, anchor).at(-1) || null;
  }

  function hasAssistantCompletionActions(message) {
    if (!message?.querySelectorAll) return false;
    return uniqueElements(assistantCompletionActionSelectors, message).some((element) =>
      isVisible(element) && !isDisabled(element) && completionActionPattern.test(semanticActionText(element)));
  }

  function isGenerating(root = globalThis.document) {
    if (!root?.querySelectorAll) return false;
    return uniqueElements(stopButtonSelectors, root).some((element) => isVisible(element) && !isDisabled(element));
  }

  globalThis.ChatGptComfyConnectorLocators = Object.freeze({
    composerSelectors: Object.freeze([...composerSelectors]),
    sendButtonSelectors: Object.freeze([...sendButtonSelectors]),
    userMessageSelectors: Object.freeze([...userMessageSelectors]),
    assistantMessageSelectors: Object.freeze([...assistantMessageSelectors]),
    stopButtonSelectors: Object.freeze([...stopButtonSelectors]),
    isChatGptPage,
    conversationIdFromUrl,
    projectIdFromUrl,
    collectChatGptContext,
    collectChatGptContextAsync,
    resolveChatGptProjectIdentitiesAsync,
    collectChatGptProjectContextAsync,
    getCurrentChatGptContext,
    getChatGptCollectorViewport,
    getChatGptRootSidebarHydrationState,
    waitForChatGptRootSidebarHydrationAsync,
    findSidebarRoot,
    findSidebarScrollContainer,
    sidebarScrollTelemetry,
    findProjectRows,
    findMoreButtons,
    visibleTitleFromElement,
    stripMetadataDescriptionSuffix,
    fallbackProjectIdFromTitle,
    projectDisclosureStructureForRow,
    projectInteractiveTargetForRow,
    sidebarRootSelectors: Object.freeze([...sidebarRootSelectors]),
    sidebarScrollContainerSelectors: Object.freeze([...sidebarScrollContainerSelectors]),
    projectRowSelectors: Object.freeze([...projectRowSelectors]),
    visibleTitleSelectors: Object.freeze([...visibleTitleSelectors]),
    isVisible,
    isDisabled,
    findComposer,
    findSendButton,
    fileInputSelectors: Object.freeze([...fileInputSelectors]),
    attachmentIndicatorSelectors: Object.freeze([...attachmentIndicatorSelectors]),
    attachmentControlSelectors: Object.freeze([...attachmentControlSelectors]),
    composerScope,
    findFileInput,
    findAttachmentControl,
    findAttachmentIndicators,
    findAttachmentByFilename,
    isAttachmentUploading,
    isAttachmentUploadComplete,
    readComposerText,
    readComposerTextCandidates,
    normalizeComposerText,
    composerContainsText,
    getComposerInputMarkerStatus,
    composerContainsInputMarkers,
    readMessageText,
    assistantContentSelectors: Object.freeze([...assistantContentSelectors]),
    findAssistantContentRoot,
    isStatusOrProgressElement,
    hasConnectorCommandResponse,
    readAssistantResponseText,
    findUserMessages,
    findAssistantMessages,
    captureUserMessageSnapshot,
    findNewUserMessages,
    captureAssistantMessageSnapshot,
    findNewAssistantMessages,
    messageContainsMarker,
    hasNewUserMessageWithCorrelation,
    findUserMessageWithCorrelation,
    findAssistantMessagesAfterAnchor,
    findAssistantMessageWithCorrelation,
    hasAssistantCompletionActions,
    isGenerating
  });
})();
