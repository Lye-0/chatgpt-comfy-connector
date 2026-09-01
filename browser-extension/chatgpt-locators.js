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
    const titleKey = metadataTextKey(title);
    let existing = projectId
      ? projects.find((candidate) => candidate.project_id === projectId)
      : null;
    if (!existing && projectId && titleKey) {
      existing = projects.find((candidate) => !candidate.project_id
        && metadataTextKey(candidate.title) === titleKey);
    }
    if (!existing && projectId) {
      existing = projects.find((candidate) => !candidate.project_id
        && fallbackProjectIdFromTitle(candidate.title) === projectId);
    }
    if (!existing && discoveryKey) {
      existing = projects.find((candidate) => candidate.discovery_key === discoveryKey);
    }
    if (!existing && !projectId && titleKey) {
      existing = projects.find((candidate) => !candidate.project_id
        && metadataTextKey(candidate.title) === titleKey);
    }

    if (existing) {
      if (projectId) existing.project_id = projectId;
      if (title && (!existing.title || projectFallbackTitlePattern.test(existing.title))) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (discoveryKey && !existing.discovery_key) existing.discovery_key = discoveryKey;
      return existing;
    }
    if (!title || (!projectId && !discoveryKey)) return null;
    const entry = {
      ...(projectId ? { project_id: projectId } : {}),
      title,
      ...(url ? { url } : {}),
      ...(discoveryKey ? { discovery_key: discoveryKey } : {})
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

    const upsertProject = (projectId, title, projectUrl, discoveryKey) => {
      const entry = upsertContextProject(projects, {
        ...(projectId ? { project_id: projectId } : {}),
        title,
        ...(projectUrl ? { url: projectUrl } : {}),
        ...(discoveryKey ? { discovery_key: discoveryKey } : {})
      });
      if (entry?.project_id) projectById.set(entry.project_id, entry);
      return entry;
    };

    // This is the old successful discovery route: read the visible Project
    // rows and anchors from the known history sidebar. Rows are never clicked
    // and no Project ID is inferred from a navigation side effect.
    for (const row of projectRows) {
      const title = visibleTitleFromElement(row);
      if (!title) continue;
      const projectId = projectIdFromElement(row, url);
      const projectUrl = projectUrlFromElement(row, url);
      upsertProject(projectId, title, projectUrl, projectId ? null : stableMetadataKey("project", title));
    }

    // Current ChatGPT Project rows are rendered as expandable buttons and do
    // not expose the Project ID in their DOM attributes. The current route is
    // the only safe ID source in that case. Associate it only with the
    // visibly expanded row; never infer an ID from a title or from row order.
    if (currentProjectId) {
      const expandedProjectRow = projectRows.find((row) =>
        attributeValue(row, "aria-expanded").toLowerCase() === "true");
      const currentProjectTitle = visibleTitleFromElement(expandedProjectRow, "");
      if (currentProjectTitle) {
        const currentProjectUrl = isProjectHomeUrl(url)
          ? chatGptMetadataUrl(url, url)
          : projectUrlFromConversationUrl(url, currentProjectId);
        upsertProject(currentProjectId, currentProjectTitle, currentProjectUrl);
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
      '[role="link"][href]',
      '[data-href]',
      '[data-url]',
      '[data-conversation-url]',
      "[data-conversation-id]",
      "[data-conversation-id-value]",
      "[data-thread-id]"
    ], root);
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
    const expandedProjectRows = expandedProjectRowsInSidebar(sidebar);
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

    // Keep the route-based fallback deliberately narrow: one expanded row and
    // one visible Project row means the sidebar has an unambiguous owner.
    return currentProjectId === normalizedProjectId
      && expandedProjectRows.length === 1;
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

    for (const element of projectPageConversationElements(root)) {
      const href = metadataHrefFromElement(element, url);
      const conversationId = conversationIdFromElement(element) || conversationIdFromUrl(href);
      if (!conversationId) continue;
      const explicitProjectId = projectIdFromUrl(href);
      if (explicitProjectId && explicitProjectId !== normalizedProjectId) continue;
      // A /c/<id> link inside the sidebar is not enough to prove that it
      // belongs to the opened Project. Accept it only when the expanded row,
      // relation metadata, or current Project route provides that scope.
      if (!explicitProjectId
        && sidebar !== root
        && isDescendantOf(element, sidebar)
        && !sidebarConversationBelongsToProject(
          element,
          sidebar,
          normalizedProjectId,
          projectTitle,
          projectRowsInSidebar(sidebar, url),
          url)) continue;
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
    return { projects, conversations };
  }

  function findProjectPageScrollContainers(root, sidebar) {
    const sidebarContainer = findSidebarScrollContainer(root);
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
    const containsConversation = (candidate) => candidate === sidebar
      || candidate === sidebarContainer
      || conversationElements.some((element) =>
        candidate === element || isDescendantOf(element, candidate));
    const relevant = candidates.filter(containsConversation);
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
    if (sidebarContainer) return [sidebarContainer];
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
    const sidebar = findSidebarRoot(root);
    const containers = findProjectPageScrollContainers(root, sidebar);
    const deadline = Date.now() + Math.max(1000, Math.min(120000, Number(options.timeoutMs) || 30000));
    const maxScrolls = Math.max(1, Math.min(128, Number(options.maxScrolls) || 64));
    const initialSettleMs = options.initialSettleMs === undefined
      ? 250
      : Math.max(0, Math.min(2000, Number(options.initialSettleMs) || 0));
    let noGrowthCount = 0;
    let sidebarScrollComplete = containers.length === 0;
    const collect = () => {
      if (options.signal?.aborted) {
        const error = new Error("Collection cancelled");
        error.name = "AbortError";
        throw error;
      }
      if (Date.now() >= deadline) return false;
      const snapshot = collectProjectContextEntries(root, url, normalizedProjectId);
      mergeContextProjectCatalog(merged, snapshot);
      mergeContextConversationCatalog(merged, snapshot);
      return true;
    };

    if (initialSettleMs > 0) await waitForSidebarMutation(root, initialSettleMs);
    if (!collect()) sidebarScrollComplete = false;
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
            const refreshedContainers = findProjectPageScrollContainers(root, findSidebarRoot(root));
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
              break;
            }
          }
        }
        if (!containerComplete && Date.now() >= deadline) sidebarScrollComplete = false;
      } finally {
        try { activeContainer.scrollTop = originalScrollTop; } catch (_) { }
      }
      noGrowthCount = Math.max(noGrowthCount, containerNoGrowthCount);
      sidebarScrollComplete = sidebarScrollComplete && containerComplete;
    }

    return {
      projects: merged.projects,
      conversations: merged.conversations,
      current: getCurrentChatGptContextFromEntries(merged, root, url),
      ...sidebarScrollTelemetry(
        root,
        findSidebarScrollContainer(root),
        noGrowthCount,
        merged.projects.length,
        sidebarScrollComplete)
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
    collectChatGptProjectContextAsync,
    getCurrentChatGptContext,
    getChatGptCollectorViewport,
    findSidebarRoot,
    findSidebarScrollContainer,
    sidebarScrollTelemetry,
    findProjectRows,
    findMoreButtons,
    visibleTitleFromElement,
    stripMetadataDescriptionSuffix,
    fallbackProjectIdFromTitle,
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
