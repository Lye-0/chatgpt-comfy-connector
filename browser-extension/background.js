const BRIDGE_HTTP_ORIGIN = "http://127.0.0.1:43127";
const BRIDGE_HEALTH_URL = `${BRIDGE_HTTP_ORIGIN}/health`;
const BRIDGE_PAIR_URL = `${BRIDGE_HTTP_ORIGIN}/api/v1/pair`;
const BRIDGE_BOOTSTRAP_URL = `${BRIDGE_HTTP_ORIGIN}/api/v1/bootstrap`;
const BRIDGE_MEDIA_URL_PREFIX = `${BRIDGE_HTTP_ORIGIN}/api/v1/media/`;
const BRIDGE_WS_URL = "ws://127.0.0.1:43127/bridge";
const BRIDGE_PROTOCOL = "chatgpt-comfy-connector.bridge/1";
const HANDOFF_PROTOCOL = "comfy-connector/1";
const BRIDGE_CLIENT_HEADER = "X-Connector-Client";
const BRIDGE_CLIENT_VALUE = "browser-extension";
const RECONNECT_ALARM = "chatgpt-comfy-connector-reconnect";
const RECONNECT_DELAY_MS = 5000;
const PING_TIMEOUT_MS = 5000;
// MV3 service workers may be suspended after roughly 30 seconds without
// activity. Chrome 116+ keeps an active WebSocket alive when the extension
// sends traffic more frequently than that limit. Keep this below 30 seconds
// so a connected Desktop Bridge does not silently become a stale UI state.
const SOCKET_KEEPALIVE_INTERVAL_MS = 20000;
// Review Handoff dispatch can begin while ChatGPT is still processing a
// video attachment. Keep this transport timeout longer than the Content
// Script's bounded Send-readiness wait so a disabled button is not reported
// as a bridge failure prematurely.
const CONTENT_SCRIPT_TIMEOUT_MS = 75000;
// A newly opened ChatGPT Conversation returns from tabs.create before the
// page reaches document_idle.  Do not interpret the temporary absence of the
// manifest Content Script as a permanent dispatch failure.
const CONTENT_SCRIPT_READY_TIMEOUT_MS = 20000;
const CONTENT_SCRIPT_READY_POLL_INTERVAL_MS = 100;
// Execution is intentionally isolated from the user's foreground Chrome
// window. One active Managed ChatGPT Tab in a connector-owned Execution
// Window is the only tab that may receive a Handoff, media attachment, or
// response watch.
const MANAGED_TAB_STORAGE_KEY = "managedChatGptTab";
const MANAGED_EXECUTION_WINDOW_CREATE_TIMEOUT_MS = 15000;
// A half-width by half-height window occupies roughly one quarter of the
// available screen area while remaining large enough for ChatGPT's composer
// and response DOM.  Use the last-focused user window as a permission-free
// display-size approximation and keep a conservative fallback for startup.
const MANAGED_EXECUTION_WINDOW_SIZE_FACTOR = 0.5;
const MANAGED_EXECUTION_WINDOW_MIN_WIDTH = 640;
const MANAGED_EXECUTION_WINDOW_MIN_HEIGHT = 480;
const MANAGED_EXECUTION_WINDOW_FALLBACK_WIDTH = 960;
const MANAGED_EXECUTION_WINDOW_FALLBACK_HEIGHT = 540;
const MANAGED_TAB_NAVIGATION_TIMEOUT_MS = 30000;
const MANAGED_CONVERSATION_READY_TIMEOUT_MS = 30000;
const MANAGED_WATCHER_READY_TIMEOUT_MS = 20000;
const MANAGED_SEND_CONFIRMATION_TIMEOUT_MS = CONTENT_SCRIPT_TIMEOUT_MS;
// The Content Script emits the metadata-only send confirmation immediately
// after the new user message is visible, then waits briefly for ChatGPT to
// replace the new-chat route with its durable Conversation URL. Give that
// second result a bounded chance to bind the Conversation without delaying
// existing-conversation sends.
const NEW_CONVERSATION_BINDING_GRACE_MS = 6000;
// Context discovery has a separate Collector Window. It must never borrow the
// Managed Execution Window, because discovery and execution have different DOM
// lifecycles and a sidebar/project scan must not reset an active response watcher.
const COLLECTOR_WINDOW_STORAGE_KEY = "chatGptCollectorWindow";
const COLLECTOR_IDENTITY_MESSAGE_GET = "GET_COLLECTOR_IDENTITY";
const COLLECTOR_IDENTITY_MESSAGE_SET = "SET_COLLECTOR_IDENTITY";
const COLLECTOR_TAB_URL = "https://chatgpt.com/";
const COLLECTOR_WINDOW_CREATE_TIMEOUT_MS = 15000;
const COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS = 30000;
// Collector discovery needs ChatGPT's desktop sidebar. A quarter-width
// window can fall below the sidebar breakpoint, so use the same half-width /
// half-height area rule as Execution and enforce the content viewport below.
const COLLECTOR_WINDOW_SIZE_FACTOR = 0.5;
const COLLECTOR_CONTENT_MIN_WIDTH = 770;
const COLLECTOR_WINDOW_MIN_WIDTH = 820;
const COLLECTOR_WINDOW_MIN_HEIGHT = 480;
const COLLECTOR_WINDOW_FALLBACK_WIDTH = 960;
const COLLECTOR_WINDOW_FALLBACK_HEIGHT = 540;
const COLLECTOR_INITIAL_TAB_WAIT_MS = 1500;
const COLLECTOR_INITIAL_TAB_POLL_MS = 50;
const COLLECTOR_MAX_PROJECTS = 5000;
const COLLECTOR_MAX_CONVERSATIONS = 10000;
const COLLECTOR_PROJECT_SCROLL_MAX = 128;
const COLLECTOR_ROOT_TIMEOUT_MS = 120000;
const COLLECTOR_CONTEXT_TIMEOUT_MS = 150000;
const COLLECTOR_PROJECT_TIMEOUT_MS = 30000;
const COLLECTOR_VIEWPORT_MAX_RETRIES = 4;
const COLLECTOR_SIDEBAR_READY_MAX_RETRIES = 8;
const COLLECTOR_VIEWPORT_RETRY_DELAY_MS = 250;
// Content Script ready and a visible Sidebar do not guarantee that ChatGPT's
// React history shell has finished hydrating.  Wait for a bounded quiet DOM
// interval before entering the one-shot Project discovery pass.
const COLLECTOR_ROOT_HYDRATION_TIMEOUT_MS = 30000;
const COLLECTOR_ROOT_HYDRATION_QUIET_MS = 600;
const COLLECTOR_ROOT_HYDRATION_POLL_MS = 100;
const COLLECTOR_SLOW_IDENTITY_MS = 2000;
// A replacement Content Script can become ready before ChatGPT has hydrated
// the newly opened conversation's message list. Keep checking the same
// marker-bearing user message without ever issuing another Handoff send.
const HANDOFF_ACCEPTANCE_RETRY_DELAY_MS = 500;
const HANDOFF_ACCEPTANCE_RETRY_TIMEOUT_MS = CONTENT_SCRIPT_TIMEOUT_MS;
const RESPONSE_WATCH_REARM_DELAY_MS = 500;
const RESPONSE_WATCH_REARM_TIMEOUT_MS = 120000;
// Lifecycle diagnostics are intentionally sparse.  A pending response watch
// gets one metadata-only snapshot every ten seconds; state-change events are
// still emitted immediately by the Chrome event listeners below.
const MANAGED_TAB_LIFECYCLE_TELEMETRY_INTERVAL_MS = 10000;
const HANDOFF_DELIVERY_CACHE_MS = 10 * 60 * 1000;
// A WebSocket send succeeding locally does not prove that the Desktop still
// owns that socket. Keep Handoff/assistant-response envelopes until the Desktop explicitly
// acknowledges receipt, and discard them after the longest response window.
const BRIDGE_DELIVERY_TTL_MS = 10 * 60 * 1000;
const PAIRING_STORAGE_KEY = "bridgePairing";
const RESPONSE_WATCH_MESSAGE_TYPE = "WATCH_ASSISTANT_RESPONSE";
const ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE = "ASSISTANT_RESPONSE_RESULT";
const ASSISTANT_RESPONSE_WATCH_TELEMETRY_MESSAGE_TYPE = "ASSISTANT_RESPONSE_WATCH_TELEMETRY";
const HANDOFF_SEND_CONFIRMED_MESSAGE_TYPE = "HANDOFF_SEND_CONFIRMED";
const HANDOFF_ACCEPTANCE_CHECK_MESSAGE_TYPE = "CHECK_HANDOFF_SENT";
const CHATGPT_EXECUTION_READY_MESSAGE_TYPE = "CHATGPT_EXECUTION_READY";
const CHATGPT_CONTEXT_LIST_REQUEST_TYPE = "chatgpt.context.list.request";
const CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE = "chatgpt.context.current.request";
const CHATGPT_CONTEXT_LIST_RESPONSE_TYPE = "chatgpt.context.list.response";
const CHATGPT_CONTEXT_CURRENT_RESPONSE_TYPE = "chatgpt.context.current.response";
const CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE = "CHATGPT_CONTEXT_RESULT";
const CHATGPT_CONTEXT_CHANGED_MESSAGE_TYPE = "CHATGPT_CONTEXT_CHANGED";
const COLLECTOR_PROJECT_IDENTITY_TELEMETRY_MESSAGE_TYPE = "COLLECTOR_PROJECT_IDENTITY_TELEMETRY";
const COLLECTOR_PROJECT_CHAT_TELEMETRY_MESSAGE_TYPE = "COLLECTOR_PROJECT_CHAT_TELEMETRY";
const REVIEW_MEDIA_ATTACH_BEGIN_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_BEGIN";
const REVIEW_MEDIA_ATTACH_CHUNK_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_CHUNK";
const REVIEW_MEDIA_ATTACH_END_MESSAGE_TYPE = "REVIEW_MEDIA_ATTACH_END";
const REVIEW_MEDIA_CHUNK_BYTES = 48 * 1024;
const MAX_REVIEW_MEDIA_BYTES = 512 * 1024 * 1024;

const defaultState = {
  status: "DISCONNECTED",
  bridgeUrl: BRIDGE_HTTP_ORIGIN,
  paired: false,
  pairingId: null,
  lastError: null,
  connectedAt: null,
  sessionExpiresAt: null,
  lastEvent: null,
  lastPingAt: null,
  lastPongAt: null
};

let state = { ...defaultState };
let pairing = { pairingId: null, credential: null };
let sessionToken = null;
let socket = null;
let acknowledgedSocket = null;
let connectPromise = null;
let reconnectTimer = null;
let manualDisconnect = false;
const pendingPings = new Map();
const responseWatches = new Map();
// Handoff and assistant-response messages are kept until an authenticated
// current socket accepts them.
// A navigation or service-worker reconnect must not turn a successful ChatGPT
// post into a lost Desktop ACK/assistant response.
const bridgeOutbox = new Map();
// Keep only metadata for an accepted Handoff.  This short-lived cache makes a
// retry after a lost/late ACK idempotent without retaining or logging payload
// text.  The Content Script also verifies the marker-bearing user message.
const acceptedHandoffs = new Map();
// A Content Script can be destroyed after clicking ChatGPT's Send control and
// before the tabs.sendMessage response callback is delivered. Keep a
// metadata-only completion channel so the accepted user message can still
// complete the Desktop Handoff request without posting a second message.
const pendingHandoffSends = new Map();
const contextRequests = new Map();
// A refresh is a replaceable discovery operation. The latest request owns
// the Collector Window result; an older request may finish a currently
// running Chrome call, but it must never send or publish its stale snapshot.
let collectorContextGeneration = 0;
let socketKeepaliveTimer = null;
let socketKeepaliveSocket = null;
const defaultManagedTabState = {
  tabId: null,
  executionWindowId: null,
  executionWindowState: "Idle",
  executionGeneration: 0,
  conversationId: null,
  conversationUrl: null,
  projectId: null,
  projectUrl: null,
  lifecycle: "Idle",
  contentReady: false,
  conversationReady: false,
  composerReady: false,
  watcherReady: false,
  currentRequestId: null,
  currentSessionId: null,
  currentHandoffId: null,
  currentBoundaryId: null
};
let managedTabState = { ...defaultManagedTabState };
let managedTabStateOperation = Promise.resolve();
let managedExecutionWindowEnsureInFlight = null;
let managedExecutionTabEnsureInFlight = null;
let managedExecutionTabEnsureMutex = Promise.resolve();
let managedExecutionTabCreateInFlight = null;
let connectorManagedWindowEnsureInFlight = null;
let connectorManagedWindowInitialTabRole = null;
let connectorManagedWindowCreatedCount = 0;
let connectorManagedWindowReusedCount = 0;
let managedExecutionGeneration = 0;
const managedExecutionOwnedWindowIds = new Set();
const managedExecutionOwnedTabIds = new Set();
const managedExecutionCreatedInitialTabIds = new Set();
const managedExecutionWindowInitialTabs = new Map();
const managedExecutionRequestBindings = new Map();
const managedExecutionResolutions = new Map();
const managedHandoffOperations = new Map();
const managedMediaOperations = new Map();
const contentScriptReadyTabs = new Map();
const managedTabTelemetrySnapshots = new Map();
const defaultCollectorWindowState = {
  windowId: null,
  tabId: null,
  windowState: "Idle",
  lifecycle: "Idle",
  projectDiscoverySource: "existing_project_section_metadata",
  currentProjectId: null,
  currentProjectUrl: null,
  collectorNavigationTarget: null,
  projectIndex: -1,
  totalProjects: 0,
  discoveredProjectCount: 0,
  discoveredChatCount: 0,
  retryCount: 0,
  projectDiscoveryRetryCount: 0,
  windowWidth: null,
  windowHeight: null,
  contentInnerWidth: null,
  contentInnerHeight: null,
  sidebarExpectedVisible: false,
  viewportRetryCount: 0,
  activeTabIdInWindow: null,
  collectorTabActive: false,
  tabCountInWindow: 0,
  sidebarScrollTop: null,
  sidebarScrollHeight: null,
  sidebarClientHeight: null,
  sidebarCanScroll: false,
  sidebarAtBottom: false,
  visibleProjectRows: 0,
  projectSectionFound: false,
  noGrowthCount: 0,
  refreshGeneration: null,
  projectDiscoveryRunId: null,
  projectDiscoveryCallCount: 0,
  projectDiscoveryStarted: false,
  projectDiscoveryCompleted: false,
  projectDiscoveryScanCompleted: false,
  projectDiscoveryCaller: null,
  projectDiscoveryInFlight: false,
  projectDiscoveryAlreadyCompleted: false,
  projectDiscoveryScrollDirection: null,
  projectDiscoveryRestoreCount: 0,
  projectIdentityResolutionStarted: false,
  projectIdentityResolutionCompleted: false,
  nonNavigationResolvedCount: 0,
  navigationResolvedCount: 0,
  identityUnresolvedCount: 0,
  currentProjectIndex: -1,
  identityResolutionMethod: null,
  navigationTargetVerified: false,
  projectUrlPatternValid: false,
  projectIdUrlMatch: false,
  rootHydrationStarted: false,
  rootHydrationCompleted: false,
  rootHydrationTimeout: false,
  hydrationWaitMs: 0,
  documentReadyState: null,
  sidebarRootPresent: false,
  sidebarScrollContainerPresent: false,
  sidebarShellPresent: false,
  sidebarSectionsStable: false,
  mutationCount: 0,
  mutationQuietMs: 0,
  rootUrlVerified: false,
  rootNavigationGeneration: null,
  requestId: null,
  instanceId: null,
  managedGeneration: 0,
  managedAt: 0
};
let collectorWindowState = { ...defaultCollectorWindowState };
let collectorWindowStateOperation = Promise.resolve();
let lastHandoffSendTabFingerprint = null;
let lastResponseMonitorTabFingerprint = null;
let projectDiscoverySequence = 0;
let lastCollectorTabEnforcementTelemetrySignature = null;
let lastCollectorTabTopologyTelemetrySignature = null;

const managedTabStateReady = (async () => {
  try {
    const storage = chrome.storage.session || chrome.storage.local;
    const stored = await storage.get(MANAGED_TAB_STORAGE_KEY);
    if (stored?.[MANAGED_TAB_STORAGE_KEY] && typeof stored[MANAGED_TAB_STORAGE_KEY] === "object") {
      managedTabState = { ...defaultManagedTabState, ...stored[MANAGED_TAB_STORAGE_KEY] };
      if (Number.isSafeInteger(managedTabState.executionGeneration)) {
        managedExecutionGeneration = managedTabState.executionGeneration;
      }
      if (Number.isSafeInteger(managedTabState.executionWindowId)) {
        managedExecutionOwnedWindowIds.add(managedTabState.executionWindowId);
      }
      if (Number.isSafeInteger(managedTabState.tabId) && managedTabState.tabId >= 0) {
        managedExecutionOwnedTabIds.add(managedTabState.tabId);
      }
    }
  } catch (_) {
    // A missing session-storage implementation must not prevent the Bridge
    // from starting. The managed tab will be created/rebound from the current
    // in-memory state when the first execution request arrives.
  }
  return managedTabState;
})();

const collectorWindowStateReady = (async () => {
  try {
    const stored = await readPersistedCollectorWindowState();
    if (stored && typeof stored === "object") {
      collectorWindowState = { ...defaultCollectorWindowState, ...stored };
    }
  } catch (_) {
    // The Collector Window is recoverable state. A storage failure must not
    // prevent the next refresh from creating a fresh isolated window.
  }
  return collectorWindowState;
})();

const stateReady = (async () => {
  const stored = await chrome.storage.local.get(["bridgeState", PAIRING_STORAGE_KEY]);
  if (stored?.bridgeState && typeof stored.bridgeState === "object") {
    state = { ...defaultState, ...stored.bridgeState };
  }
  if (stored?.[PAIRING_STORAGE_KEY]?.credential) {
    pairing = {
      pairingId: stored[PAIRING_STORAGE_KEY].pairingId || null,
      credential: stored[PAIRING_STORAGE_KEY].credential
    };
    state = {
      ...state,
      paired: true,
      pairingId: pairing.pairingId
    };
  } else {
    state = {
      ...state,
      paired: false,
      pairingId: null
    };
  }
  return state;
})();

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function bridgeError(message, status = 0, code = "bridge_error") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function collectorDebugTelemetryEnabled() {
  return globalThis.__CHATGPT_COMFY_CONNECTOR_DEBUG_TELEMETRY__ === true;
}

function isCollectorTelemetrySummaryStage(stage) {
  return typeof stage === "string"
    && (stage.endsWith("_complete")
      || stage.endsWith("_failure_summary")
      || stage === "collector_project_discovery_efficiency_summary"
      || stage === "collector_project_identity_performance_summary"
      || stage === "collector_project_identity_phase_performance_summary"
      || stage === "collector_project_identity_navigation_summary"
      || stage === "collector_project_provisional_reconciliation_summary"
    || stage === "collector_window_resolution_summary");
}

function isHighVolumeCollectorTelemetryStage(stage) {
  if (typeof stage !== "string") return false;
  return stage === "collector_project_identity_row_relocation"
    || stage === "collector_project_identity_row_fingerprint"
    || stage === "collector_project_identity_relocation_candidates"
    || stage.endsWith("_navigation_wait")
    || stage.endsWith("_hydration_probe")
    || stage.endsWith("_poll");
}

function createCollectorProjectDiscoveryEfficiencyState(pending) {
  return {
    requestId: pending?.requestId || null,
    refreshGeneration: Number.isSafeInteger(pending?.generation)
      ? pending.generation
      : null,
    startedAt: Date.now(),
    rootNavigationCount: 0,
    rootUrlVerificationCount: 0,
    tabUpdateNavigationRequestCount: 0,
    tabUpdateRootRequestCount: 0,
    tabUpdateProjectRequestCount: 0,
    observedUrlChangeCount: 0,
    observedLoadingCount: 0,
    observedCompleteCount: 0,
    contentScriptBootCount: 0,
    contentScriptReconnectCount: 0,
    documentNavigationCount: 0,
    spaRouteChangeCount: 0,
    domRemountCount: 0,
    reloadApiCallCount: 0,
    rootNavigationRequested: false,
    rootReturnRequested: false,
    rootHydrationRunCount: 0,
    rootHydrationScrollCount: 0,
    rootCatalogBuildCount: 0,
    rootCatalogReuseCount: 0,
    projectIdentityAttemptCount: 0,
    rowRelocationAttemptCount: 0,
    rowRelocationSuccessCount: 0,
    candidateSearchCount: 0,
    candidateSearchTotalCandidateCount: 0,
    stableLocatorMatchCount: 0,
    uniqueTitleMatchCount: 0,
    ambiguousMatchCount: 0,
    sidebarScrollAttemptCount: 0,
    sidebarScrollPositionChangeCount: 0,
    sidebarScrollStagnationCount: 0,
    moreClickCount: 0,
    discoverySnapshotCount: 0,
    discoverySnapshotProjectCandidateCountTotal: 0,
    discoveryLogicalProjectCountFinal: 0,
    descriptorAddedCount: 0,
    descriptorUpdatedCount: 0,
    descriptorReplacedCount: 0,
    descriptorRemovedCount: 0,
    descriptorDuplicateRejectedCount: 0,
    descriptorRemountReconciledCount: 0,
    descriptorAmbiguousReconcileCount: 0,
    titleOnlyReconcileAttemptCount: 0,
    titleOnlyReconcileRejectedCount: 0,
    titleHintUsedCount: 0,
    stableEvidenceReconcileCount: 0,
    ambiguousSameTitleReconcileCount: 0,
    titleOnlyObservationPreservedCount: 0,
    provisionalObservationCreatedCount: 0,
    provisionalObservationReusedCount: 0,
    provisionalObservationResolvedCount: 0,
    provisionalObservationMergedExistingCount: 0,
    provisionalObservationPromotedNewProjectCount: 0,
    provisionalObservationUnresolvedCount: 0,
    provisionalResolvedSameExistingCount: 0,
    provisionalResolvedDistinctProjectCount: 0,
    provisionalUnresolvedKeptCount: 0,
    provisionalUnresolvedDiscardedAsProvenDuplicateCount: 0,
    provisionalUnresolvedDiscardRejectedCount: 0,
    provisionalDuplicateProofProjectIdCount: 0,
    provisionalDuplicateProofStableLocatorCount: 0,
    provisionalDuplicateProofOtherStableEvidenceCount: 0,
    provisionalSameProjectIdProofCount: 0,
    provisionalSameStableLocatorProofCount: 0,
    provisionalLineageProofCount: 0,
    provisionalFoldedSameDescriptorCount: 0,
    uniqueTitleVolatileRemountCount: 0,
    identityInputCount: 0,
    identityCatalogInvariantPassed: false,
    identityDuplicateDescriptorCount: 0,
    compactProvisionalTransitions: "",
    provisionalCreatedIndices: "",
    provisionalMergedExistingIndices: "",
    confirmedFingerprintChangedIndices: "",
    stableLocatorChangedIndices: "",
    discoveryKeyChangedIndices: "",
    incompleteDueToUnresolvedProvisionalCount: 0,
    sameTitleIdentitySameProjectCount: 0,
    sameTitleIdentityDistinctProjectCount: 0,
    confirmedLogicalProjectCountBeforeIdentity: 0,
    confirmedLogicalProjectCountAfterIdentity: 0,
    provisionalObservationCountBeforeIdentity: 0,
    provisionalObservationCountAfterIdentity: 0,
    collectionTriggerSource: null,
    collectorWindowCreated: false,
    collectorTabCreated: false,
    collectorTabReused: false,
    collectorCreationReason: null,
    collectorResolutionReason: null,
    collectorFoundByPersistedId: false,
    collectorFoundByMarker: false,
    collectorFoundByHandshake: false,
    collectorCandidateWindowCount: 0,
    collectorCandidateTabCount: 0,
    collectorCandidateFocusedCount: 0,
    collectorCandidateActiveCount: 0,
    duplicateCollectorCandidateCount: 0,
    persistedWindowIdPresent: false,
    persistedTabIdPresent: false,
    persistedWindowIdValid: false,
    persistedTabIdValid: false,
    collectorFocusRequiredForMatch: false,
    collectorActiveRequiredForMatch: false,
    selectedCollectorWindowFingerprint: null,
    selectedCollectorTabFingerprint: null,
    collectorWindowStateAtCreation: "unknown",
    collectorWindowStateAtCollectionStart: "unknown",
    collectorWindowStateAtCollectionEnd: "unknown",
    collectorWindowFocusedAtCreation: false,
    collectorWindowFocusedAtCollectionStart: false,
    collectorWindowFocusedAtCollectionEnd: false,
    collectorWindowStateChangeCount: 0,
    collectorWindowUnminimizedByConnector: false,
    collectorWindowMinimizedDuringCollection: false,
    collectorTabActiveAtCreation: false,
    collectorTabActiveAtCollectionStart: false,
    collectorTabActiveAtCollectionEnd: false,
    collectorTabDiscardedAtCollectionStart: false,
    collectorTabStatusAtCollectionStart: "unknown",
    documentVisibilityStateAtCollectionStart: "unknown",
    documentVisibilityStateAtCollectionEnd: "unknown",
    documentVisibilityChangeCount: 0,
    documentHiddenObserved: false,
    documentHiddenDurationMs: 0,
    documentVisibleDurationMs: 0,
    documentBecameVisibleDuringCollection: false,
    documentBecameHiddenDuringCollection: false,
    hydrationLoopsWhileDocumentHidden: 0,
    hydrationLoopsWhileDocumentVisible: 0,
    scrollAttemptsWhileHidden: 0,
    scrollAttemptsWhileVisible: 0,
    mutationCountWhileHidden: 0,
    mutationCountWhileVisible: 0,
    pollWaitMsWhileHidden: 0,
    pollWaitMsWhileVisible: 0,
    identityAttemptsWhileHidden: 0,
    identityAttemptsWhileVisible: 0,
    identityWaitMsWhileHidden: 0,
    identityWaitMsWhileVisible: 0,
    slowIdentityIndicesWhileHidden: [],
    slowIdentityIndicesWhileVisible: [],
    lastObservedCollectorWindowState: null,
    duplicateDiscoveryKeyCount: 0,
    discoveryKeyChangedForSameLogicalProjectCount: 0,
    moreControlSeenCount: 0,
    moreControlLogicalUniqueCount: 0,
    moreControlDuplicateSuppressedCount: 0,
    morePaginationRoundCount: 0,
    moreClickProgressCount: 0,
    moreClickNoProgressCount: 0,
    moreReappearedAfterClickCount: 0,
    moreReclickAllowedCount: 0,
    moreReclickSuppressedCount: 0,
    moreProjectCountBeforeClickTotal: 0,
    moreProjectCountAfterClickTotal: 0,
    moreScrollHeightIncreasedCount: 0,
    moreCandidateCountIncreasedCount: 0,
    moreDescriptorCountIncreasedCount: 0,
    hydrationCompletedWithMoreVisible: false,
    hydrationCompletedAfterMoreNoProgress: false,
    moreVisibleAtHydrationComplete: false,
    moreEnabledAtHydrationComplete: false,
    moreClickableAtHydrationComplete: false,
    hydrationStopReason: null,
    hydrationLoopCount: 0,
    hydrationProgressCount: 0,
    hydrationNoProgressCount: 0,
    hydrationConsecutiveStagnationMax: 0,
    hydrationStagnationBreakCount: 0,
    hydrationSameLogicalStateCount: 0,
    hydrationCatalogUnchangedCount: 0,
    hydrationSnapshotUnchangedCount: 0,
    hydrationProgressProjectCountIncrease: 0,
    hydrationProgressProvisionalCountIncrease: 0,
    hydrationProgressScrollPositionChange: 0,
    hydrationProgressScrollHeightIncrease: 0,
    hydrationProgressMorePagination: 0,
    hydrationStagnationResetCount: 0,
    hydrationStagnationResetReasonCounts: {
      project_count: 0,
      provisional_count: 0,
      scroll_position: 0,
      scroll_height: 0,
      more_pagination: 0
    },
    postNavigationIdentityCount: 0,
    postNavigationIdentityWaitMs: 0,
    postNavigationChildRegionWaitMs: 0,
    postNavigationRelocationWaitMs: 0,
    postNavigationIdentityActive: false,
    postNavigationRetryInputCount: 0,
    postNavigationRetryIndices: [],
    postNavigationRetryMs: 0,
    initialDomPassChildRegionWaitMs: 0,
    initialDomPassResolvedCount: 0,
    initialDomPassUnresolvedIndices: [],
    navigationIdentityResolutionMs: 0,
    navigationIdentityResolvedIndex: -1,
    navigationSuccessDomWaitMs: 0,
    navigationSuccessExtraDomWaitCount: 0,
    earlyEscalationCount: 0,
    timeoutCeilingHitCount: 0,
    resolvedIdentitySkippedCount: 0,
    logicalIdentityInvalidatedCount: 0,
    rootReturnRevalidationMs: 0,
    rootReturnDomRefreshCount: 0,
    rootReturnCacheInvalidationCount: 0,
    identityElapsedBeforeNavigationMs: new Map(),
    projectCandidateRejectedChildChatCount: 0,
    projectCandidateRejectedNonProjectCount: 0,
    finalCatalogIndexCount: 0,
    finalCatalogIndices: [],
    descriptorAddedAfterFirstSnapshotIndices: [],
    disclosureOpenCount: 0,
    disclosureCloseCount: 0,
    domGenerationChangeCount: 0,
    navigationFallbackAttemptCount: 0,
    navigationFallbackSuccessCount: 0,
    projectNavigationCount: 0,
    rootReturnNavigationCount: 0,
    spaNavigationCount: 0,
    fullPageNavigationCount: 0,
    staleNavigationResultRejectedCount: 0,
    duplicateStableProjectIdCount: 0,
    missingStableIdentityCount: 0,
    identityCollisionCount: 0,
    telemetryEventCountTotal: 0,
    telemetryEventCountDetail: 0,
    telemetryEventCountSummary: 0,
    rootNavigationWaitMs: 0,
    rootUrlVerificationWaitMs: 0,
    rootHydrationWaitMs: 0,
    rootHydrationPollCount: 0,
    rootHydrationPollWaitMs: 0,
    rootHydrationPollIntervalMs: 0,
    rootHydrationScrollWaitMs: 0,
    moreClickWaitMs: 0,
    catalogBuildMs: 0,
    identityResolutionMs: 0,
    identityDisclosureWaitMs: 0,
    identityDomRemountWaitMs: 0,
    identityCandidateSearchMs: 0,
    identityRelocationWaitMs: 0,
    identityChildRegionWaitMs: 0,
    childRegionWaitAverageMs: 0,
    childRegionWaitMaxMs: 0,
    childRegionWaitP50Ms: 0,
    childRegionWaitP95Ms: 0,
    childRegionImmediateHitCount: 0,
    childRegionObserverNeededCount: 0,
    childRegionPollNeededCount: 0,
    childRegionEarlySuccessCount: 0,
    childRegionTimeoutCount: 0,
    childRegionAmbiguousCount: 0,
    childRegionCandidateZeroCount: 0,
    childRegionUniqueCandidateCount: 0,
    childRegionSameIdMultiCandidateCount: 0,
    childRegionDistinctIdCollisionCount: 0,
    mutationQuietWaitTotalMs: 0,
    disclosureOpenWaitTotalMs: 0,
    remountRecoveryWaitTotalMs: 0,
    identityPerformanceSlowProjectIndices: "",
    identityPerformanceSlowProjectMs: "",
    identityNavigationWaitMs: 0,
    identityMiscWaitMs: 0,
    identitySourceRowMetadataCount: 0,
    identitySourceChildChatCount: 0,
    identitySourceControlledRegionCount: 0,
    identitySourceNavigationCount: 0,
    identitySourceNestedUrlCount: 0,
    navigationFallbackProjectIndices: [],
    navigationFallbackSuccessProjectIndices: [],
    navigationFallbackFailureProjectIndices: [],
    identityProjectElapsedMs: new Map(),
    observedIdentitySourceProjects: new Set(),
    rowRelocationMs: 0,
    navigationFallbackMs: 0,
    rootReturnWaitMs: 0,
    collectorRecoveryWaitMs: 0,
    miscellaneousWaitMs: 0,
    totalExplicitDelayMs: 0,
    totalPollWaitMs: 0,
    totalDomWaitMs: 0,
    totalNavigationWaitMs: 0,
    efficiencySummaryEmitted: false,
    relocationScrollAttempts: new Map(),
    relocationMoreClickCounts: new Map(),
    observedStableLocatorProjects: new Set(),
    observedUniqueTitleProjects: new Set(),
    observedAmbiguousProjects: new Set(),
    observedNavigationFallbackAttempts: new Set(),
    observedNavigationFallbackSuccesses: new Set(),
    observedProjectNavigations: new Set(),
    observedSpaNavigations: new Set(),
    observedDocumentNavigations: new Set(),
    observedDomRemounts: new Set(),
    observedDisclosureChanges: new Set()
  };
}

function collectorProjectDiscoveryEfficiencyFor(pending) {
  if (!pending || typeof pending !== "object") return null;
  if (!pending.projectDiscoveryEfficiency) {
    pending.projectDiscoveryEfficiency = createCollectorProjectDiscoveryEfficiencyState(pending);
  }
  return pending.projectDiscoveryEfficiency;
}

function incrementCollectorProjectDiscoveryEfficiency(pending, key, amount = 1) {
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (!efficiency || !Object.prototype.hasOwnProperty.call(efficiency, key)) return;
  const normalized = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  efficiency[key] = Math.max(0, efficiency[key] + normalized);
}

function addCollectorProjectDiscoveryEfficiencyDuration(pending, key, durationMs) {
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (!efficiency || !Object.prototype.hasOwnProperty.call(efficiency, key)) return;
  const normalized = Number.isFinite(Number(durationMs)) ? Number(durationMs) : 0;
  efficiency[key] = Math.max(0, efficiency[key] + normalized);
}

function collectorProjectDiscoveryEfficiencyForRequest(requestId) {
  if (!requestId) return null;
  return collectorProjectDiscoveryEfficiencyFor(contextRequests.get(requestId));
}

function recordCollectorProjectDiscoveryEfficiencyNavigationRequest(
  requestId,
  navigationType) {
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(requestId);
  if (!efficiency) return;
  efficiency.tabUpdateNavigationRequestCount += 1;
  if (navigationType === "root" || navigationType === "root_return") {
    efficiency.tabUpdateRootRequestCount += 1;
    efficiency.rootNavigationRequested = true;
    if (navigationType === "root_return") efficiency.rootReturnRequested = true;
  }
  if (navigationType === "project") efficiency.tabUpdateProjectRequestCount += 1;
}

function recordCollectorProjectDiscoveryEfficiencyDocumentNavigation(
  requestId,
  navigationKey) {
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(requestId);
  if (!efficiency || efficiency.observedDocumentNavigations.has(navigationKey)) return;
  efficiency.observedDocumentNavigations.add(navigationKey);
  efficiency.documentNavigationCount += 1;
  efficiency.fullPageNavigationCount = efficiency.documentNavigationCount;
}

function recordCollectorIdentitySource(efficiency, source, projectKey) {
  if (!efficiency || !projectKey || typeof source !== "string" || source === "none") return;
  if (efficiency.observedIdentitySourceProjects.has(projectKey)) return;
  efficiency.observedIdentitySourceProjects.add(projectKey);
  if (source === "child_chat_url") efficiency.identitySourceChildChatCount += 1;
  else if (source === "controlled_region") efficiency.identitySourceControlledRegionCount += 1;
  else if (source === "navigation_url") efficiency.identitySourceNavigationCount += 1;
  else if (source === "nested_url") efficiency.identitySourceNestedUrlCount += 1;
  else if (source === "row_url" || source === "other") efficiency.identitySourceRowMetadataCount += 1;
}

function recordCollectorProjectDiscoveryEfficiencyObservedEvent(
  requestId,
  key) {
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(requestId);
  if (!efficiency) return;
  efficiency[key] += 1;
}

function recordCollectorProjectDiscoveryEfficiencyNavigationWait(
  pending,
  navigationStartedAt,
  isProjectNavigation,
  navigationType) {
  if (navigationStartedAt === null) return;
  const navigationWaitMs = Math.max(0, Date.now() - navigationStartedAt);
  addCollectorProjectDiscoveryEfficiencyDuration(
    pending,
    isProjectNavigation ? "navigationFallbackMs"
      : navigationType === "root_return" ? "rootReturnWaitMs" : "rootNavigationWaitMs",
    navigationWaitMs);
  addCollectorProjectDiscoveryEfficiencyDuration(
    pending,
    "totalNavigationWaitMs",
    navigationWaitMs);
}

function recordCollectorProjectDiscoveryEfficiencyEvent(fields = {}, options = {}) {
  const pending = contextRequests.get(fields?.request_id);
  const efficiency = pending?.projectDiscoveryEfficiency;
  if (!efficiency) return;
  const stage = fields?.stage;
  // Operation counters are updated even when high-volume console output is
  // gated. Telemetry counters are updated only for events that are emitted.
  if (options.countTelemetry !== false
    && stage !== "collector_project_discovery_efficiency_summary") {
    efficiency.telemetryEventCountTotal += 1;
    if (isCollectorTelemetrySummaryStage(stage)) efficiency.telemetryEventCountSummary += 1;
    else efficiency.telemetryEventCountDetail += 1;
  }
  const projectIndex = Number.isSafeInteger(fields?.project_index)
    ? fields.project_index
    : null;
  const projectKey = projectIndex === null ? null : String(projectIndex);
  if (stage === "collector_project_identity_row_relocation_start") {
    efficiency.rowRelocationAttemptCount += 1;
    if (fields.sidebar_dom_generation_changed === true) {
      efficiency.domGenerationChangeCount += 1;
      const remountKey = `${projectKey ?? "unknown"}:${fields.navigation_generation || ""}`;
      if (!efficiency.observedDomRemounts.has(remountKey)) {
        efficiency.observedDomRemounts.add(remountKey);
        efficiency.domRemountCount += 1;
      }
    }
  }
  if (stage === "collector_project_identity_row_relocation") {
    const candidateCount = Number.isSafeInteger(fields.candidate_count)
      ? fields.candidate_count
      : 0;
    efficiency.candidateSearchCount += 1;
    efficiency.candidateSearchTotalCandidateCount += candidateCount;
    if (fields.relocation_success === true && projectKey !== null) {
      efficiency.rowRelocationSuccessCount += 1;
    }
    if (fields.stable_fingerprint_match_count > 0 && projectKey !== null
      && !efficiency.observedStableLocatorProjects.has(projectKey)) {
      efficiency.observedStableLocatorProjects.add(projectKey);
      efficiency.stableLocatorMatchCount += 1;
    }
    if (fields.selected_match_method === "unique_catalog_title" && projectKey !== null
      && !efficiency.observedUniqueTitleProjects.has(projectKey)) {
      efficiency.observedUniqueTitleProjects.add(projectKey);
      efficiency.uniqueTitleMatchCount += 1;
    }
    const ambiguousCount = Number.isSafeInteger(fields.ambiguous_count)
      ? fields.ambiguous_count
      : (Number.isSafeInteger(fields.ambiguous_candidate_count)
        ? fields.ambiguous_candidate_count
        : 0);
    if (ambiguousCount > 0 && projectKey !== null
      && !efficiency.observedAmbiguousProjects.has(projectKey)) {
      efficiency.observedAmbiguousProjects.add(projectKey);
      efficiency.ambiguousMatchCount += 1;
    }
    if (projectKey !== null) {
      const scrollAttempts = Number.isSafeInteger(fields.scroll_attempts)
        ? fields.scroll_attempts
        : 0;
      const previousScrollAttempts = efficiency.relocationScrollAttempts.get(projectKey) || 0;
      if (scrollAttempts > previousScrollAttempts) {
        efficiency.sidebarScrollAttemptCount += scrollAttempts - previousScrollAttempts;
        efficiency.relocationScrollAttempts.set(projectKey, scrollAttempts);
      }
      const moreClickCount = Number.isSafeInteger(fields.more_click_count)
        ? fields.more_click_count
        : 0;
      const previousMoreClickCount = efficiency.relocationMoreClickCounts.get(projectKey) || 0;
      if (moreClickCount > previousMoreClickCount) {
        efficiency.moreClickCount += moreClickCount - previousMoreClickCount;
        efficiency.relocationMoreClickCounts.set(projectKey, moreClickCount);
      }
      if (fields.scroll_position_changed === true) {
        efficiency.sidebarScrollPositionChangeCount += 1;
      }
      if (fields.relocation_stagnated === true || fields.scroll_search_stagnated === true) {
        efficiency.sidebarScrollStagnationCount += 1;
      }
    if ((fields.relocation_success === true
      || fields.relocation_stagnated === true
      || fields.scroll_search_stagnated === true)
      && Number.isSafeInteger(fields.relocation_elapsed_ms)) {
      efficiency.rowRelocationMs += fields.relocation_elapsed_ms;
      efficiency.totalDomWaitMs += fields.relocation_elapsed_ms;
    }
    }
  }
  if ((stage === "collector_project_identity_disclosure_click"
    || stage === "collector_project_identity_disclosure_structure")
    && fields.disclosure_state_changed === true
    && projectKey !== null) {
    const before = fields.aria_expanded_before;
    const after = fields.aria_expanded_after;
    const changeKey = `${projectKey}:${before}:${after}`;
    if (!efficiency.observedDisclosureChanges.has(changeKey)) {
      efficiency.observedDisclosureChanges.add(changeKey);
      if (after === "true" && before !== "true") efficiency.disclosureOpenCount += 1;
      if (after === "false" && before !== "false") efficiency.disclosureCloseCount += 1;
    }
  }
  if (fields.navigation_fallback_attempted === true && projectKey !== null
    && !efficiency.observedNavigationFallbackAttempts.has(projectKey)) {
    efficiency.observedNavigationFallbackAttempts.add(projectKey);
    efficiency.navigationFallbackAttemptCount += 1;
    if (!efficiency.navigationFallbackProjectIndices.includes(projectIndex)) {
      efficiency.navigationFallbackProjectIndices.push(projectIndex);
    }
  }
  if (fields.navigation_fallback_success === true && projectKey !== null
    && !efficiency.observedNavigationFallbackSuccesses.has(projectKey)) {
    efficiency.observedNavigationFallbackSuccesses.add(projectKey);
    efficiency.navigationFallbackSuccessCount += 1;
    if (!efficiency.navigationFallbackSuccessProjectIndices.includes(projectIndex)) {
      efficiency.navigationFallbackSuccessProjectIndices.push(projectIndex);
    }
  }
  if (fields.navigation_fallback_attempted === true
    && fields.navigation_fallback_success === false
    && projectKey !== null
    && Number.isSafeInteger(projectIndex)
    && !efficiency.navigationFallbackFailureProjectIndices.includes(projectIndex)
    && (stage === "collector_project_identity_source_classification"
      || stage === "collector_project_identity_navigation_result")) {
    efficiency.navigationFallbackFailureProjectIndices.push(projectIndex);
  }
  if (stage === "collector_project_identity_source_classification") {
    if (Number.isSafeInteger(fields.identity_disclosure_wait_ms)) {
      efficiency.identityDisclosureWaitMs += fields.identity_disclosure_wait_ms;
    }
    if (Number.isSafeInteger(fields.identity_relocation_wait_ms)) {
      efficiency.identityRelocationWaitMs += fields.identity_relocation_wait_ms;
      if (efficiency.postNavigationIdentityActive === true) {
        efficiency.postNavigationRelocationWaitMs += fields.identity_relocation_wait_ms;
      }
    }
    if (Number.isSafeInteger(fields.identity_child_region_wait_ms)) {
      efficiency.identityChildRegionWaitMs += fields.identity_child_region_wait_ms;
      if (efficiency.postNavigationIdentityActive === true) {
        efficiency.postNavigationChildRegionWaitMs += fields.identity_child_region_wait_ms;
      }
    }
    if (Number.isSafeInteger(fields.identity_candidate_search_ms)) {
      efficiency.identityCandidateSearchMs += fields.identity_candidate_search_ms;
    }
    if (Number.isSafeInteger(fields.identity_elapsed_ms) && projectKey !== null) {
      const previous = efficiency.identityProjectElapsedMs.get(projectKey) || 0;
      efficiency.identityProjectElapsedMs.set(projectKey, previous + fields.identity_elapsed_ms);
    }
    recordCollectorIdentitySource(efficiency, fields.identity_source, projectKey);
  }
  if (stage === "collector_project_identity_performance_summary") {
    efficiency.childRegionWaitAverageMs = Number.isSafeInteger(fields.child_region_wait_average_ms)
      ? fields.child_region_wait_average_ms
      : efficiency.childRegionWaitAverageMs;
    efficiency.childRegionWaitMaxMs = Number.isSafeInteger(fields.child_region_wait_max_ms)
      ? fields.child_region_wait_max_ms
      : efficiency.childRegionWaitMaxMs;
    efficiency.childRegionWaitP50Ms = Number.isSafeInteger(fields.child_region_wait_p50_ms)
      ? fields.child_region_wait_p50_ms
      : efficiency.childRegionWaitP50Ms;
    efficiency.childRegionWaitP95Ms = Number.isSafeInteger(fields.child_region_wait_p95_ms)
      ? fields.child_region_wait_p95_ms
      : efficiency.childRegionWaitP95Ms;
    efficiency.childRegionImmediateHitCount = Number.isSafeInteger(fields.child_region_immediate_hit_count)
      ? fields.child_region_immediate_hit_count
      : efficiency.childRegionImmediateHitCount;
    efficiency.childRegionObserverNeededCount = Number.isSafeInteger(fields.child_region_observer_needed_count)
      ? fields.child_region_observer_needed_count
      : efficiency.childRegionObserverNeededCount;
    efficiency.childRegionPollNeededCount = Number.isSafeInteger(fields.child_region_poll_needed_count)
      ? fields.child_region_poll_needed_count
      : efficiency.childRegionPollNeededCount;
    efficiency.childRegionEarlySuccessCount = Number.isSafeInteger(fields.child_region_early_success_count)
      ? fields.child_region_early_success_count
      : efficiency.childRegionEarlySuccessCount;
    efficiency.childRegionTimeoutCount = Number.isSafeInteger(fields.child_region_timeout_count)
      ? fields.child_region_timeout_count
      : efficiency.childRegionTimeoutCount;
    efficiency.childRegionAmbiguousCount = Number.isSafeInteger(fields.child_region_ambiguous_count)
      ? fields.child_region_ambiguous_count
      : efficiency.childRegionAmbiguousCount;
    efficiency.childRegionCandidateZeroCount = Number.isSafeInteger(fields.child_region_candidate_zero_count)
      ? fields.child_region_candidate_zero_count
      : efficiency.childRegionCandidateZeroCount;
    efficiency.childRegionUniqueCandidateCount = Number.isSafeInteger(fields.child_region_unique_candidate_count)
      ? fields.child_region_unique_candidate_count
      : efficiency.childRegionUniqueCandidateCount;
    efficiency.childRegionSameIdMultiCandidateCount =
      Number.isSafeInteger(fields.child_region_same_id_multi_candidate_count)
        ? fields.child_region_same_id_multi_candidate_count
        : efficiency.childRegionSameIdMultiCandidateCount;
    efficiency.childRegionDistinctIdCollisionCount =
      Number.isSafeInteger(fields.child_region_distinct_id_collision_count)
        ? fields.child_region_distinct_id_collision_count
        : efficiency.childRegionDistinctIdCollisionCount;
    efficiency.mutationQuietWaitTotalMs = Number.isSafeInteger(fields.mutation_quiet_wait_total_ms)
      ? fields.mutation_quiet_wait_total_ms
      : efficiency.mutationQuietWaitTotalMs;
    efficiency.disclosureOpenWaitTotalMs = Number.isSafeInteger(fields.disclosure_open_wait_total_ms)
      ? fields.disclosure_open_wait_total_ms
      : efficiency.disclosureOpenWaitTotalMs;
    efficiency.remountRecoveryWaitTotalMs = Number.isSafeInteger(fields.remount_recovery_wait_total_ms)
      ? fields.remount_recovery_wait_total_ms
      : efficiency.remountRecoveryWaitTotalMs;
    if (typeof fields.slow_project_indices === "string") {
      efficiency.identityPerformanceSlowProjectIndices = fields.slow_project_indices.slice(0, 128);
    }
    if (typeof fields.slow_project_ms === "string") {
      efficiency.identityPerformanceSlowProjectMs = fields.slow_project_ms.slice(0, 128);
    }
    if (Number.isSafeInteger(fields.early_escalation_count)) {
      efficiency.earlyEscalationCount += fields.early_escalation_count;
    }
    if (Number.isSafeInteger(fields.timeout_ceiling_hit_count)) {
      efficiency.timeoutCeilingHitCount += fields.timeout_ceiling_hit_count;
    }
    if (Number.isSafeInteger(fields.resolved_identity_skipped_count)) {
      efficiency.resolvedIdentitySkippedCount += fields.resolved_identity_skipped_count;
    }
    if (fields.identity_pass_kind === "initial_dom") {
      if (Number.isSafeInteger(fields.child_region_wait_total_ms)) {
        efficiency.initialDomPassChildRegionWaitMs = fields.child_region_wait_total_ms;
      }
    }
    if (fields.identity_pass_kind === "navigation") {
      if (Number.isSafeInteger(fields.child_region_wait_total_ms)) {
        efficiency.navigationSuccessDomWaitMs += fields.child_region_wait_total_ms;
      }
      if (Number.isSafeInteger(fields.timeout_ceiling_hit_count)
        && fields.timeout_ceiling_hit_count > 0) {
        efficiency.navigationSuccessExtraDomWaitCount += fields.timeout_ceiling_hit_count;
      }
    }
  }
  if (fields.stale_navigation_result_rejected === true) {
    efficiency.staleNavigationResultRejectedCount += 1;
  }
  if (stage === "collector_project_identity_navigation_wait"
    && fields.navigation_detected === true
    && projectKey !== null) {
    if (!efficiency.observedProjectNavigations.has(projectKey)) {
      efficiency.observedProjectNavigations.add(projectKey);
      efficiency.projectNavigationCount += 1;
    }
    if (fields.content_script_reloaded !== true
      && !efficiency.observedSpaNavigations.has(projectKey)) {
      efficiency.observedSpaNavigations.add(projectKey);
      efficiency.spaNavigationCount += 1;
      efficiency.spaRouteChangeCount += 1;
    }
    if (Number.isSafeInteger(fields.navigation_wait_ms)) {
      efficiency.navigationFallbackMs += fields.navigation_wait_ms;
      efficiency.totalNavigationWaitMs += fields.navigation_wait_ms;
      efficiency.identityNavigationWaitMs += fields.navigation_wait_ms;
    }
  }
}

function recordCollectorProjectDiscoveryEfficiencyNavigation(
  requestId,
  navigationType,
  projectIndex = null,
  navigationKey = null) {
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(requestId);
  if (!efficiency) return;
  const key = navigationKey || (projectIndex === null ? String(Date.now()) : String(projectIndex));
  if (navigationType === "root") {
    efficiency.rootNavigationCount += 1;
    efficiency.rootNavigationRequested = true;
  }
  if (navigationType === "root_return") {
    efficiency.rootReturnNavigationCount += 1;
    efficiency.rootNavigationRequested = true;
    efficiency.rootReturnRequested = true;
  }
  if (navigationType === "project") efficiency.projectNavigationCount += 1;
  if (navigationType === "full_page") {
    recordCollectorProjectDiscoveryEfficiencyDocumentNavigation(requestId, key);
  }
}

function recordCollectorProvisionalReconciliationSummary(pending, fields = {}) {
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  diagnostic("collector project provisional reconciliation summary", {
    request_id: pending?.requestId,
    refresh_generation: pending?.generation,
    confirmed_count_before_identity: Number(fields.confirmed_count_before_identity) || 0,
    provisional_count_before_identity: Number(fields.provisional_count_before_identity) || 0,
    identity_input_count: Number(fields.identity_input_count) || 0,
    provisional_same_project_id_proof_count:
      Number(fields.provisional_same_project_id_proof_count) || 0,
    provisional_same_stable_locator_proof_count:
      Number(fields.provisional_same_stable_locator_proof_count) || 0,
    provisional_lineage_proof_count: Number(fields.provisional_lineage_proof_count) || 0,
    remaining_provisional_count: Number(fields.remaining_provisional_count) || 0,
    unique_title_volatile_remount_count: efficiency?.uniqueTitleVolatileRemountCount || 0,
    compact_provisional_transitions: efficiency?.compactProvisionalTransitions || "",
    provisional_created_indices: efficiency?.provisionalCreatedIndices || "",
    provisional_merged_existing_indices: efficiency?.provisionalMergedExistingIndices || "",
    confirmed_fingerprint_changed_indices: efficiency?.confirmedFingerprintChangedIndices || "",
    stable_locator_changed_indices: efficiency?.stableLocatorChangedIndices || "",
    discovery_key_changed_indices: efficiency?.discoveryKeyChangedIndices || "",
    final_logical_project_count: efficiency?.discoveryLogicalProjectCountFinal || 0,
    stage: "collector_project_provisional_reconciliation_summary",
    target_tab_id: pending?.tabId
  });
}

function recordCollectorIdentityCatalogInvariantSummary(pending, fields = {}) {
  if (!pending || pending.identityCatalogInvariantSummaryEmitted === true) return;
  pending.identityCatalogInvariantSummaryEmitted = true;
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  const rootLogical = Number.isSafeInteger(fields.root_logical_project_count)
    ? fields.root_logical_project_count
    : (efficiency?.discoveryLogicalProjectCountFinal || 0);
  const confirmedCount = Number.isSafeInteger(fields.confirmed_count_before_identity)
    ? fields.confirmed_count_before_identity
    : 0;
  const provisionalCount = Number.isSafeInteger(fields.provisional_count_before_identity)
    ? fields.provisional_count_before_identity
    : 0;
  const identityInputCount = Number.isSafeInteger(fields.identity_input_count)
    ? fields.identity_input_count
    : 0;
  const duplicateCount = Number.isSafeInteger(fields.identity_duplicate_descriptor_count)
    ? fields.identity_duplicate_descriptor_count
    : 0;
  const passed = identityInputCount === confirmedCount + provisionalCount
    && (provisionalCount > 0 || rootLogical <= 0 || identityInputCount === rootLogical)
    && (provisionalCount > 0 || identityInputCount === confirmedCount);
  if (efficiency) {
    efficiency.identityCatalogInvariantPassed = passed;
    efficiency.identityDuplicateDescriptorCount = duplicateCount;
    efficiency.identityInputCount = identityInputCount;
    efficiency.confirmedLogicalProjectCountBeforeIdentity = confirmedCount;
    efficiency.provisionalObservationCountBeforeIdentity = provisionalCount;
  }
  const payload = {
    request_id: pending?.requestId,
    refresh_generation: pending?.generation,
    root_logical_project_count: rootLogical,
    root_discovered_logical_project_count: rootLogical,
    confirmed_count_before_identity: confirmedCount,
    provisional_count_before_identity: provisionalCount,
    identity_input_count: identityInputCount,
    identity_duplicate_descriptor_count: duplicateCount,
    duplicate_same_project_id_count: Number(fields.duplicate_same_project_id_count) || 0,
    duplicate_same_stable_locator_count: Number(fields.duplicate_same_stable_locator_count) || 0,
    duplicate_same_current_discovery_key_count:
      Number(fields.duplicate_same_current_discovery_key_count) || 0,
    duplicate_same_logical_owner_count: duplicateCount,
    identity_catalog_invariant_passed: passed,
    duplicate_descriptor_source_counts: fields.duplicate_descriptor_source_counts || {
      project_id: 0,
      stable_locator: 0,
      current_discovery_key: 0
    },
    duplicate_descriptor_indices: Array.isArray(fields.duplicate_descriptor_indices)
      ? fields.duplicate_descriptor_indices.filter((index) => Number.isSafeInteger(index) && index >= 0)
      : [],
    stage: "collector_project_identity_catalog_invariant_summary",
    target_tab_id: pending?.tabId
  };
  diagnostic("collector project identity catalog invariant summary", payload);
  if (!passed) {
    diagnostic("identity_catalog_invariant_failed", {
      ...payload,
      status: "error",
      error_code: "identity_catalog_invariant_failed",
      stage: "identity_catalog_invariant_failed"
    });
  }
}

async function emitCollectorProjectDiscoveryEfficiencySummary(pending, result = null, errorCode = null) {
  if (!pending || pending.projectOnly || pending.currentOnly
    || !isCurrentCollectorRequest(pending)
    || pending.projectDiscoveryEfficiency?.efficiencySummaryEmitted === true) return;
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (!efficiency) return;
  const projects = Array.isArray(result?.projects)
    ? result.projects
    : (Array.isArray(pending.projectIdentityResult?.projects)
      ? pending.projectIdentityResult.projects
      : (Array.isArray(pending.projectDiscoveryScanResult?.projects)
        ? pending.projectDiscoveryScanResult.projects
        : []));
  const resolution = collectProjectMetadataResolution({ projects });
  const collision = stableProjectIdCollisionDetails(projects);
  efficiency.duplicateStableProjectIdCount =
    collision?.duplicate_stable_project_id_count || 0;
  efficiency.identityCollisionCount =
    collision?.duplicate_stable_project_id_group_count || 0;
  efficiency.missingStableIdentityCount = resolution.items.filter((item) =>
    !item.resolved && (item.unresolvedReason || "missing_stable_identity")
      === "missing_stable_identity").length;
  efficiency.telemetryEventCountTotal += 1;
  efficiency.telemetryEventCountSummary += 1;
  efficiency.efficiencySummaryEmitted = true;
  await recordCollectorPresentationPhase("collection_end", { request_id: pending.requestId });
  for (const project of projects) {
    const projectIndex = Number.isSafeInteger(project?.project_index)
      ? project.project_index
      : null;
    recordCollectorIdentitySource(
      efficiency,
      project?.identity_source,
      projectIndex === null ? null : String(projectIndex));
  }
  const identityElapsedValues = [...efficiency.identityProjectElapsedMs.entries()]
    .map(([key, value]) => ({ index: Number(key), value }))
    .filter((item) => Number.isSafeInteger(item.index) && item.index >= 0);
  const identityElapsedSum = identityElapsedValues.reduce((sum, item) => sum + item.value, 0);
  const averageIdentityMs = identityElapsedValues.length > 0
    ? Math.round(identityElapsedSum / identityElapsedValues.length)
    : 0;
  const maxIdentityMs = identityElapsedValues.reduce(
    (max, item) => Math.max(max, item.value),
    0);
  const slowIdentityProjectIndices = identityElapsedValues
    .filter((item) => item.value >= COLLECTOR_SLOW_IDENTITY_MS)
    .map((item) => item.index)
    .sort((left, right) => left - right);
  const identityAccountedMs = efficiency.identityDisclosureWaitMs
    + efficiency.identityDomRemountWaitMs
    + efficiency.identityCandidateSearchMs
    + efficiency.identityRelocationWaitMs
    + efficiency.identityChildRegionWaitMs
    + efficiency.identityNavigationWaitMs;
  efficiency.identityMiscWaitMs = Math.max(0, efficiency.identityResolutionMs - identityAccountedMs);
  mergeCollectorVisibilityTelemetry(efficiency, result);
  mergeCollectorVisibilityTelemetry(efficiency, pending.projectDiscoveryScanResult);
  mergeCollectorVisibilityTelemetry(efficiency, pending.projectIdentityResult);
  diagnostic("collector project discovery efficiency summary", {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    discovered_project_count: efficiency.discoveryLogicalProjectCountFinal
      || resolution.discoveredCount,
    root_discovered_logical_project_count: efficiency.discoveryLogicalProjectCountFinal || 0,
    identity_catalog_count: efficiency.identityInputCount || resolution.discoveredCount,
    identity_catalog_invariant_passed: efficiency.identityCatalogInvariantPassed === true,
    identity_duplicate_descriptor_count: efficiency.identityDuplicateDescriptorCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    elapsed_ms: Math.max(0, Date.now() - efficiency.startedAt),
    root_navigation_count: efficiency.rootNavigationCount,
    root_url_verification_count: efficiency.rootUrlVerificationCount,
    root_hydration_run_count: efficiency.rootHydrationRunCount,
    root_hydration_scroll_count: efficiency.rootHydrationScrollCount,
    root_catalog_build_count: efficiency.rootCatalogBuildCount,
    root_catalog_reuse_count: efficiency.rootCatalogReuseCount,
    project_identity_attempt_count: efficiency.projectIdentityAttemptCount,
    row_relocation_attempt_count: efficiency.rowRelocationAttemptCount,
    row_relocation_success_count: efficiency.rowRelocationSuccessCount,
    candidate_search_count: efficiency.candidateSearchCount,
    candidate_search_total_candidate_count: efficiency.candidateSearchTotalCandidateCount,
    stable_locator_match_count: efficiency.stableLocatorMatchCount,
    unique_title_match_count: efficiency.uniqueTitleMatchCount,
    ambiguous_match_count: efficiency.ambiguousMatchCount,
    sidebar_scroll_attempt_count: efficiency.sidebarScrollAttemptCount,
    sidebar_scroll_position_change_count: efficiency.sidebarScrollPositionChangeCount,
    sidebar_scroll_stagnation_count: efficiency.sidebarScrollStagnationCount,
    more_click_count: efficiency.moreClickCount,
    discovery_snapshot_count: efficiency.discoverySnapshotCount,
    discovery_snapshot_project_candidate_count_total:
      efficiency.discoverySnapshotProjectCandidateCountTotal,
    discovery_logical_project_count_final: efficiency.discoveryLogicalProjectCountFinal,
    descriptor_added_count: efficiency.descriptorAddedCount,
    descriptor_updated_count: efficiency.descriptorUpdatedCount,
    descriptor_replaced_count: efficiency.descriptorReplacedCount,
    descriptor_removed_count: efficiency.descriptorRemovedCount,
    descriptor_duplicate_rejected_count: efficiency.descriptorDuplicateRejectedCount,
    descriptor_remount_reconciled_count: efficiency.descriptorRemountReconciledCount,
    descriptor_ambiguous_reconcile_count: efficiency.descriptorAmbiguousReconcileCount,
    title_only_reconcile_attempt_count: efficiency.titleOnlyReconcileAttemptCount,
    title_only_reconcile_rejected_count: efficiency.titleOnlyReconcileRejectedCount,
    title_hint_used_count: efficiency.titleHintUsedCount,
    stable_evidence_reconcile_count: efficiency.stableEvidenceReconcileCount,
    ambiguous_same_title_reconcile_count: efficiency.ambiguousSameTitleReconcileCount,
    title_only_observation_preserved_count: efficiency.titleOnlyObservationPreservedCount,
    provisional_observation_created_count: efficiency.provisionalObservationCreatedCount,
    provisional_observation_reused_count: efficiency.provisionalObservationReusedCount,
    provisional_observation_resolved_count: efficiency.provisionalObservationResolvedCount,
    provisional_observation_merged_existing_count: efficiency.provisionalObservationMergedExistingCount,
    provisional_observation_promoted_new_project_count:
      efficiency.provisionalObservationPromotedNewProjectCount,
    provisional_observation_unresolved_count: efficiency.provisionalObservationUnresolvedCount,
    provisional_resolved_same_existing_count: efficiency.provisionalResolvedSameExistingCount,
    provisional_resolved_distinct_project_count: efficiency.provisionalResolvedDistinctProjectCount,
    provisional_unresolved_kept_count: efficiency.provisionalUnresolvedKeptCount,
    provisional_unresolved_discarded_as_proven_duplicate_count:
      efficiency.provisionalUnresolvedDiscardedAsProvenDuplicateCount,
    provisional_unresolved_discard_rejected_count:
      efficiency.provisionalUnresolvedDiscardRejectedCount,
    provisional_duplicate_proof_project_id_count: efficiency.provisionalDuplicateProofProjectIdCount,
    provisional_duplicate_proof_stable_locator_count:
      efficiency.provisionalDuplicateProofStableLocatorCount,
    provisional_duplicate_proof_other_stable_evidence_count:
      efficiency.provisionalDuplicateProofOtherStableEvidenceCount,
    unique_title_volatile_remount_count: efficiency.uniqueTitleVolatileRemountCount,
    provisional_same_project_id_proof_count: efficiency.provisionalSameProjectIdProofCount,
    provisional_same_stable_locator_proof_count: efficiency.provisionalSameStableLocatorProofCount,
    provisional_lineage_proof_count: efficiency.provisionalLineageProofCount,
    provisional_folded_same_descriptor_count: efficiency.provisionalFoldedSameDescriptorCount,
    identity_input_count: efficiency.identityInputCount,
    compact_provisional_transitions: efficiency.compactProvisionalTransitions,
    provisional_created_indices: efficiency.provisionalCreatedIndices,
    provisional_merged_existing_indices: efficiency.provisionalMergedExistingIndices,
    confirmed_fingerprint_changed_indices: efficiency.confirmedFingerprintChangedIndices,
    stable_locator_changed_indices: efficiency.stableLocatorChangedIndices,
    discovery_key_changed_indices: efficiency.discoveryKeyChangedIndices,
    incomplete_due_to_unresolved_provisional_count:
      efficiency.incompleteDueToUnresolvedProvisionalCount,
    same_title_identity_same_project_count: efficiency.sameTitleIdentitySameProjectCount,
    same_title_identity_distinct_project_count: efficiency.sameTitleIdentityDistinctProjectCount,
    confirmed_logical_project_count_before_identity:
      efficiency.confirmedLogicalProjectCountBeforeIdentity,
    confirmed_logical_project_count_after_identity:
      efficiency.confirmedLogicalProjectCountAfterIdentity,
    provisional_observation_count_before_identity:
      efficiency.provisionalObservationCountBeforeIdentity,
    provisional_observation_count_after_identity:
      efficiency.provisionalObservationCountAfterIdentity,
    collection_trigger_source: efficiency.collectionTriggerSource,
    collector_window_created: efficiency.collectorWindowCreated,
    collector_tab_created: efficiency.collectorTabCreated,
    collector_tab_reused: efficiency.collectorTabReused,
    collector_creation_reason: efficiency.collectorCreationReason,
    collector_resolution_reason: efficiency.collectorResolutionReason,
    collector_found_by_persisted_id: efficiency.collectorFoundByPersistedId === true,
    collector_found_by_marker: efficiency.collectorFoundByMarker === true,
    collector_found_by_handshake: efficiency.collectorFoundByHandshake === true,
    collector_candidate_window_count: efficiency.collectorCandidateWindowCount,
    collector_candidate_tab_count: efficiency.collectorCandidateTabCount,
    collector_candidate_focused_count: efficiency.collectorCandidateFocusedCount,
    collector_candidate_active_count: efficiency.collectorCandidateActiveCount,
    duplicate_collector_candidate_count: efficiency.duplicateCollectorCandidateCount,
    persisted_window_id_present: efficiency.persistedWindowIdPresent === true,
    persisted_tab_id_present: efficiency.persistedTabIdPresent === true,
    persisted_window_id_valid: efficiency.persistedWindowIdValid === true,
    persisted_tab_id_valid: efficiency.persistedTabIdValid === true,
    collector_focus_required_for_match: false,
    collector_active_required_for_match: false,
    selected_collector_window_fingerprint: efficiency.selectedCollectorWindowFingerprint,
    selected_collector_tab_fingerprint: efficiency.selectedCollectorTabFingerprint,
    duplicate_discovery_key_count: efficiency.duplicateDiscoveryKeyCount,
    discovery_key_changed_for_same_logical_project_count:
      efficiency.discoveryKeyChangedForSameLogicalProjectCount,
    more_control_seen_count: efficiency.moreControlSeenCount,
    more_control_logical_unique_count: efficiency.moreControlLogicalUniqueCount,
    more_control_duplicate_suppressed_count: efficiency.moreControlDuplicateSuppressedCount,
    more_pagination_round_count: efficiency.morePaginationRoundCount,
    more_click_progress_count: efficiency.moreClickProgressCount,
    more_click_no_progress_count: efficiency.moreClickNoProgressCount,
    more_reappeared_after_click_count: efficiency.moreReappearedAfterClickCount,
    more_reclick_allowed_count: efficiency.moreReclickAllowedCount,
    more_reclick_suppressed_count: efficiency.moreReclickSuppressedCount,
    more_project_count_before_click_total: efficiency.moreProjectCountBeforeClickTotal,
    more_project_count_after_click_total: efficiency.moreProjectCountAfterClickTotal,
    more_scroll_height_increased_count: efficiency.moreScrollHeightIncreasedCount,
    more_candidate_count_increased_count: efficiency.moreCandidateCountIncreasedCount,
    more_descriptor_count_increased_count: efficiency.moreDescriptorCountIncreasedCount,
    hydration_completed_with_more_visible: efficiency.hydrationCompletedWithMoreVisible === true,
    hydration_completed_after_more_no_progress:
      efficiency.hydrationCompletedAfterMoreNoProgress === true,
    more_visible_at_hydration_complete: efficiency.moreVisibleAtHydrationComplete === true,
    more_enabled_at_hydration_complete: efficiency.moreEnabledAtHydrationComplete === true,
    more_clickable_at_hydration_complete: efficiency.moreClickableAtHydrationComplete === true,
    hydration_stop_reason: efficiency.hydrationStopReason,
    hydration_loop_count: efficiency.hydrationLoopCount,
    hydration_progress_count: efficiency.hydrationProgressCount,
    hydration_no_progress_count: efficiency.hydrationNoProgressCount,
    hydration_consecutive_stagnation_max: efficiency.hydrationConsecutiveStagnationMax,
    hydration_stagnation_break_count: efficiency.hydrationStagnationBreakCount,
    hydration_same_logical_state_count: efficiency.hydrationSameLogicalStateCount,
    hydration_catalog_unchanged_count: efficiency.hydrationCatalogUnchangedCount,
    hydration_snapshot_unchanged_count: efficiency.hydrationSnapshotUnchangedCount,
    hydration_progress_project_count_increase: efficiency.hydrationProgressProjectCountIncrease,
    hydration_progress_provisional_count_increase:
      efficiency.hydrationProgressProvisionalCountIncrease,
    hydration_progress_scroll_position_change: efficiency.hydrationProgressScrollPositionChange,
    hydration_progress_scroll_height_increase: efficiency.hydrationProgressScrollHeightIncrease,
    hydration_progress_more_pagination: efficiency.hydrationProgressMorePagination,
    hydration_stagnation_reset_count: efficiency.hydrationStagnationResetCount,
    hydration_stagnation_reset_reason_counts: {
      project_count: efficiency.hydrationStagnationResetReasonCounts.project_count,
      provisional_count: efficiency.hydrationStagnationResetReasonCounts.provisional_count,
      scroll_position: efficiency.hydrationStagnationResetReasonCounts.scroll_position,
      scroll_height: efficiency.hydrationStagnationResetReasonCounts.scroll_height,
      more_pagination: efficiency.hydrationStagnationResetReasonCounts.more_pagination
    },
    collector_window_state_at_creation: efficiency.collectorWindowStateAtCreation,
    collector_window_state_at_collection_start: efficiency.collectorWindowStateAtCollectionStart,
    collector_window_state_at_collection_end: efficiency.collectorWindowStateAtCollectionEnd,
    collector_window_focused_at_creation: efficiency.collectorWindowFocusedAtCreation === true,
    collector_window_focused_at_collection_start:
      efficiency.collectorWindowFocusedAtCollectionStart === true,
    collector_window_focused_at_collection_end:
      efficiency.collectorWindowFocusedAtCollectionEnd === true,
    collector_window_state_change_count: efficiency.collectorWindowStateChangeCount,
    collector_window_unminimized_by_connector:
      efficiency.collectorWindowUnminimizedByConnector === true,
    collector_window_minimized_during_collection:
      efficiency.collectorWindowMinimizedDuringCollection === true,
    collector_tab_active_at_creation: efficiency.collectorTabActiveAtCreation === true,
    collector_tab_active_at_collection_start: efficiency.collectorTabActiveAtCollectionStart === true,
    collector_tab_active_at_collection_end: efficiency.collectorTabActiveAtCollectionEnd === true,
    collector_tab_discarded_at_collection_start:
      efficiency.collectorTabDiscardedAtCollectionStart === true,
    collector_tab_status_at_collection_start: efficiency.collectorTabStatusAtCollectionStart,
    document_visibility_state_at_collection_start:
      efficiency.documentVisibilityStateAtCollectionStart,
    document_visibility_state_at_collection_end: efficiency.documentVisibilityStateAtCollectionEnd,
    document_visibility_change_count: efficiency.documentVisibilityChangeCount,
    document_hidden_observed: efficiency.documentHiddenObserved === true,
    document_hidden_duration_ms: efficiency.documentHiddenDurationMs,
    document_visible_duration_ms: efficiency.documentVisibleDurationMs,
    document_became_visible_during_collection:
      efficiency.documentBecameVisibleDuringCollection === true,
    document_became_hidden_during_collection:
      efficiency.documentBecameHiddenDuringCollection === true,
    hydration_loops_while_document_hidden: efficiency.hydrationLoopsWhileDocumentHidden,
    hydration_loops_while_document_visible: efficiency.hydrationLoopsWhileDocumentVisible,
    scroll_attempts_while_hidden: efficiency.scrollAttemptsWhileHidden,
    scroll_attempts_while_visible: efficiency.scrollAttemptsWhileVisible,
    mutation_count_while_hidden: efficiency.mutationCountWhileHidden,
    mutation_count_while_visible: efficiency.mutationCountWhileVisible,
    poll_wait_ms_while_hidden: efficiency.pollWaitMsWhileHidden,
    poll_wait_ms_while_visible: efficiency.pollWaitMsWhileVisible,
    identity_attempts_while_hidden: efficiency.identityAttemptsWhileHidden,
    identity_attempts_while_visible: efficiency.identityAttemptsWhileVisible,
    identity_wait_ms_while_hidden: efficiency.identityWaitMsWhileHidden,
    identity_wait_ms_while_visible: efficiency.identityWaitMsWhileVisible,
    slow_identity_indices_while_hidden: [...efficiency.slowIdentityIndicesWhileHidden],
    slow_identity_indices_while_visible: [...efficiency.slowIdentityIndicesWhileVisible],
    project_candidate_rejected_child_chat_count:
      efficiency.projectCandidateRejectedChildChatCount,
    project_candidate_rejected_non_project_count:
      efficiency.projectCandidateRejectedNonProjectCount,
    final_catalog_index_count: efficiency.finalCatalogIndexCount,
    final_catalog_indices: [...efficiency.finalCatalogIndices],
    descriptor_added_after_first_snapshot_indices:
      [...efficiency.descriptorAddedAfterFirstSnapshotIndices],
    disclosure_open_count: efficiency.disclosureOpenCount,
    disclosure_close_count: efficiency.disclosureCloseCount,
    dom_generation_change_count: efficiency.domGenerationChangeCount,
    navigation_fallback_attempt_count: efficiency.navigationFallbackAttemptCount,
    navigation_fallback_success_count: efficiency.navigationFallbackSuccessCount,
    project_navigation_count: efficiency.projectNavigationCount,
    root_return_navigation_count: efficiency.rootReturnNavigationCount,
    spa_navigation_count: efficiency.spaNavigationCount,
    full_page_navigation_count: efficiency.fullPageNavigationCount,
    stale_navigation_result_rejected_count: efficiency.staleNavigationResultRejectedCount,
    tab_update_navigation_request_count: efficiency.tabUpdateNavigationRequestCount,
    tab_update_root_request_count: efficiency.tabUpdateRootRequestCount,
    tab_update_project_request_count: efficiency.tabUpdateProjectRequestCount,
    observed_url_change_count: efficiency.observedUrlChangeCount,
    observed_loading_count: efficiency.observedLoadingCount,
    observed_complete_count: efficiency.observedCompleteCount,
    content_script_boot_count: efficiency.contentScriptBootCount,
    content_script_reconnect_count: efficiency.contentScriptReconnectCount,
    document_navigation_count: efficiency.documentNavigationCount,
    spa_route_change_count: efficiency.spaRouteChangeCount,
    dom_remount_count: efficiency.domRemountCount,
    reload_api_call_count: efficiency.reloadApiCallCount,
    root_navigation_requested: efficiency.rootNavigationRequested,
    root_return_requested: efficiency.rootReturnRequested,
    duplicate_stable_project_id_count: efficiency.duplicateStableProjectIdCount,
    missing_stable_identity_count: efficiency.missingStableIdentityCount,
    identity_collision_count: efficiency.identityCollisionCount,
    root_navigation_wait_ms: efficiency.rootNavigationWaitMs,
    root_url_verification_wait_ms: efficiency.rootUrlVerificationWaitMs,
    root_hydration_wait_ms: efficiency.rootHydrationWaitMs,
    root_hydration_poll_count: efficiency.rootHydrationPollCount,
    root_hydration_poll_wait_ms: efficiency.rootHydrationPollWaitMs,
    root_hydration_poll_interval_ms: efficiency.rootHydrationPollIntervalMs,
    root_hydration_scroll_wait_ms: efficiency.rootHydrationScrollWaitMs,
    more_click_wait_ms: efficiency.moreClickWaitMs,
    catalog_build_ms: efficiency.catalogBuildMs,
    identity_resolution_ms: efficiency.identityResolutionMs,
    identity_disclosure_wait_ms: efficiency.identityDisclosureWaitMs,
    identity_dom_remount_wait_ms: efficiency.identityDomRemountWaitMs,
    identity_candidate_search_ms: efficiency.identityCandidateSearchMs,
    identity_relocation_wait_ms: efficiency.identityRelocationWaitMs,
    identity_child_region_wait_ms: efficiency.identityChildRegionWaitMs,
    child_region_wait_average_ms: efficiency.childRegionWaitAverageMs,
    child_region_wait_max_ms: efficiency.childRegionWaitMaxMs,
    child_region_wait_p50_ms: efficiency.childRegionWaitP50Ms,
    child_region_wait_p95_ms: efficiency.childRegionWaitP95Ms,
    child_region_immediate_hit_count: efficiency.childRegionImmediateHitCount,
    child_region_observer_needed_count: efficiency.childRegionObserverNeededCount,
    child_region_poll_needed_count: efficiency.childRegionPollNeededCount,
    child_region_early_success_count: efficiency.childRegionEarlySuccessCount,
    child_region_timeout_count: efficiency.childRegionTimeoutCount,
    child_region_ambiguous_count: efficiency.childRegionAmbiguousCount,
    child_region_candidate_zero_count: efficiency.childRegionCandidateZeroCount,
    child_region_unique_candidate_count: efficiency.childRegionUniqueCandidateCount,
    child_region_same_id_multi_candidate_count: efficiency.childRegionSameIdMultiCandidateCount,
    child_region_distinct_id_collision_count: efficiency.childRegionDistinctIdCollisionCount,
    mutation_quiet_wait_total_ms: efficiency.mutationQuietWaitTotalMs,
    disclosure_open_wait_total_ms: efficiency.disclosureOpenWaitTotalMs,
    remount_recovery_wait_total_ms: efficiency.remountRecoveryWaitTotalMs,
    slow_project_indices: efficiency.identityPerformanceSlowProjectIndices,
    slow_project_ms: efficiency.identityPerformanceSlowProjectMs,
    identity_navigation_wait_ms: efficiency.identityNavigationWaitMs,
    identity_misc_wait_ms: efficiency.identityMiscWaitMs,
    identity_source_row_metadata_count: efficiency.identitySourceRowMetadataCount,
    identity_source_child_chat_count: efficiency.identitySourceChildChatCount,
    identity_source_controlled_region_count: efficiency.identitySourceControlledRegionCount,
    identity_source_navigation_count: efficiency.identitySourceNavigationCount,
    identity_source_nested_url_count: efficiency.identitySourceNestedUrlCount,
    average_identity_ms: averageIdentityMs,
    max_identity_ms: maxIdentityMs,
    slow_identity_project_indices: slowIdentityProjectIndices,
    slow_identity_before_navigation_indices: [...efficiency.identityElapsedBeforeNavigationMs.entries()]
      .map(([key, value]) => ({ index: Number(key), value }))
      .filter((item) => Number.isSafeInteger(item.index) && item.index >= 0
        && item.value >= COLLECTOR_SLOW_IDENTITY_MS)
      .map((item) => item.index)
      .sort((left, right) => left - right),
    slow_identity_after_navigation_indices: identityElapsedValues
      .filter((item) => {
        const before = efficiency.identityElapsedBeforeNavigationMs.get(String(item.index))
          || efficiency.identityElapsedBeforeNavigationMs.get(item.index)
          || 0;
        return (item.value - before) >= COLLECTOR_SLOW_IDENTITY_MS;
      })
      .map((item) => item.index)
      .sort((left, right) => left - right),
    post_navigation_identity_count: efficiency.postNavigationIdentityCount,
    post_navigation_identity_wait_ms: efficiency.postNavigationIdentityWaitMs,
    post_navigation_child_region_wait_ms: efficiency.postNavigationChildRegionWaitMs,
    post_navigation_relocation_wait_ms: efficiency.postNavigationRelocationWaitMs,
    post_navigation_retry_input_count: efficiency.postNavigationRetryInputCount,
    post_navigation_retry_indices: (efficiency.postNavigationRetryIndices || []).join(","),
    post_navigation_retry_ms: efficiency.postNavigationRetryMs,
    initial_dom_pass_ms: efficiency.initialDomPassChildRegionWaitMs,
    initial_dom_pass_resolved_count: efficiency.initialDomPassResolvedCount,
    initial_dom_pass_unresolved_indices: (efficiency.initialDomPassUnresolvedIndices || []).join(","),
    navigation_identity_resolution_ms: efficiency.navigationIdentityResolutionMs,
    navigation_identity_resolved_index: efficiency.navigationIdentityResolvedIndex,
    early_escalation_count: efficiency.earlyEscalationCount,
    timeout_ceiling_hit_count: efficiency.timeoutCeilingHitCount,
    navigation_success_dom_wait_ms: efficiency.navigationSuccessDomWaitMs,
    navigation_success_extra_dom_wait_count: efficiency.navigationSuccessExtraDomWaitCount,
    resolved_identity_skipped_count: efficiency.resolvedIdentitySkippedCount,
    resolved_identity_rechecked_count: 0,
    dom_cache_invalidated_count: efficiency.rootReturnCacheInvalidationCount,
    logical_identity_invalidated_count: efficiency.logicalIdentityInvalidatedCount,
    root_return_revalidation_ms: efficiency.rootReturnRevalidationMs,
    root_return_dom_refresh_count: efficiency.rootReturnDomRefreshCount,
    root_return_cache_invalidation_count: efficiency.rootReturnCacheInvalidationCount,
    navigation_fallback_project_indices: efficiency.navigationFallbackProjectIndices,
    navigation_fallback_success_project_indices: efficiency.navigationFallbackSuccessProjectIndices,
    navigation_fallback_failure_project_indices: efficiency.navigationFallbackFailureProjectIndices,
    row_relocation_ms: efficiency.rowRelocationMs,
    navigation_fallback_ms: efficiency.navigationFallbackMs,
    root_return_wait_ms: efficiency.rootReturnWaitMs,
    collector_recovery_wait_ms: efficiency.collectorRecoveryWaitMs,
    miscellaneous_wait_ms: efficiency.miscellaneousWaitMs,
    total_explicit_delay_ms: efficiency.totalExplicitDelayMs,
    total_poll_wait_ms: efficiency.totalPollWaitMs,
    total_dom_wait_ms: efficiency.totalDomWaitMs,
    total_navigation_wait_ms: efficiency.totalNavigationWaitMs,
    telemetry_event_count_total: efficiency.telemetryEventCountTotal,
    telemetry_event_count_detail: efficiency.telemetryEventCountDetail,
    telemetry_event_count_summary: efficiency.telemetryEventCountSummary,
    status: errorCode ? "error" : "completed",
    ...(errorCode ? { error_code: errorCode } : {}),
    stage: "collector_project_discovery_efficiency_summary",
    target_tab_id: pending.tabId
  });
}

// Diagnostics deliberately whitelist identifiers and outcome fields. Never
// include the pairing credential, session token, or Handoff payload here.
function diagnostic(eventName, fields = {}) {
  const shouldEmit = collectorDebugTelemetryEnabled()
    || !isHighVolumeCollectorTelemetryStage(fields?.stage);
  recordCollectorProjectDiscoveryEfficiencyEvent(fields, {
    countTelemetry: shouldEmit
  });
  const safe = {};
  for (const key of [
    "request_id",
    "session_id",
    "handoff_id",
    "boundary_id",
    "media_id",
    "conversation_id",
    "conversation_url",
    "project_id",
    "status",
    "error_code",
    "stage",
    "lifecycle",
    "execution_window_id",
    "execution_window_focused",
    "execution_window_state",
    "execution_window_exists",
    "execution_window_minimized",
    "execution_generation",
    "ensure_call_count",
    "ensure_joined_inflight_count",
    "ensure_new_creation_count",
    "execution_window_create_requested_count",
    "execution_window_created_count",
    "execution_window_reused_count",
    "managed_tab_create_requested_count",
    "managed_tab_created_count",
    "managed_tab_reused_count",
    "recovery_attempt_count",
    "recovery_joined_inflight_count",
    "duplicate_creation_prevented_count",
    "final_execution_window_count",
    "final_managed_tab_count",
    "final_execution_window_physical_tab_count",
    "execution_window_physical_tab_count_at_creation",
    "execution_window_physical_tab_count_after_tab_resolution",
    "execution_window_physical_tab_count_final",
    "initial_window_tab_found",
    "initial_window_tab_reused",
    "initial_window_tab_closed",
    "managed_tab_created_via_tabs_create",
    "managed_tab_adopted_from_window_create",
    "managed_window_exists",
    "managed_window_created_count",
    "managed_window_reused_count",
    "collector_tab_exists",
    "collector_tab_owned",
    "execution_tab_exists",
    "execution_tab_owned",
    "collector_and_execution_same_window",
    "collector_and_execution_same_tab",
    "owned_tab_count",
    "physical_tab_count",
    "user_unmanaged_tab_count",
    "topology_valid",
    "collector_tab_fingerprint",
    "execution_tab_fingerprint",
    "managed_window_id",
    "handoff_bound_window_fingerprint",
    "handoff_bound_tab_fingerprint",
    "watcher_window_fingerprint",
    "watcher_tab_fingerprint",
    "sender_window_fingerprint",
    "sender_tab_fingerprint",
    "same_execution_tab_for_handoff_watch_send",
    "execution_target_changed_during_request",
    "collector_window_id",
    "collector_window_focused",
    "collector_window_state",
    "collector_window_exists",
    "collector_tab_id",
    "active_tab_id_in_collector_window",
    "collector_navigation_target",
    "project_discovery_source",
    "current_project_id",
    "current_project_identity_source",
    "current_project_identity_navigation_fallback_used",
    "current_project_identity_discovery_index",
    "current_project_url",
    "project_index",
    "total_projects",
    "discovered_project_count",
    "discovered_chat_count",
    "retry_count",
    "project_discovery_retry_count",
    "refresh_generation",
    "project_discovery_run_id",
    "project_discovery_call_count",
    "project_discovery_started",
    "project_discovery_completed",
    "project_discovery_scan_completed",
    "project_discovery_result_received",
    "project_discovery_caller",
    "project_discovery_in_flight",
    "project_discovery_already_completed",
    "project_discovery_scroll_direction",
    "project_discovery_restore_count",
    "content_discovered_project_count",
    "background_projects_length",
    "response_shape",
    "resolved_project_count",
    "unresolved_project_count",
    "reported_unresolved_project_count",
    "project_identity_resolution_started",
    "project_identity_resolution_completed",
    "non_navigation_resolved_count",
    "navigation_resolved_count",
    "unresolved_count",
    "current_project_index",
    "resolution_method",
    "navigation_target_verified",
    "project_url_pattern_valid",
    "project_id_url_match",
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
    "row_tabindex_present",
    "row_href_present",
    "row_aria_haspopup",
    "row_aria_expanded",
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
    "row_is_menu_control",
    "row_is_overflow_control",
    "row_interactive_evidence",
    "navigation_wait_started",
    "url_changed",
    "navigation_detected",
    "content_script_reloaded",
    "tab_update_observed",
    "navigation_wait_ms",
    "navigation_timeout",
    "project_id_extracted",
    "resolution_success",
    "success",
    "target_project_present",
    "project_index_valid",
    "collector_tab_present",
    "collector_tab_matches",
    "refresh_generation_matches",
    "navigation_generation_present",
    "navigation_generation_matches",
    "navigation_generation_match",
    "navigation_started_for_project",
    "navigation_completed_for_project",
    "navigation_target_verified_for_project",
    "navigation_owned_by_current_project",
    "navigation_owner_project_index",
    "stale_navigation_result_rejected",
    "current_url_used_as_identity",
    "root_state_ready",
    "discovery_snapshot_present",
    "discovery_fingerprint_present",
    "project_section_snapshot_present",
    "navigation_failure_reason",
    "internal_reason",
    "exit_reason",
    "disclosure_found",
    "child_chat_count",
    "child_project_url_count",
    "row_project_url_found",
    "nested_project_url_found",
    "stable_identity_candidate_count",
    "distinct_candidate_project_id_count",
    "candidate_project_id_fingerprints",
    "resolved_project_id_fingerprint",
    "identity_candidate_consistent",
    "discovery_key_present",
    "duplicate_project_id_fingerprint",
    "duplicate_project_indices",
    "duplicate_discovery_key_count",
    "duplicate_rows_same_discovery_key",
    "collision_identity_sources",
    "collision_candidate_consistency",
    "collision_first_index",
    "collision_second_index",
    "identity_source",
    "empty_project_candidate",
    "sidebar_child_identity_unavailable",
    "navigation_fallback_attempted",
    "navigation_fallback_success",
    "relocation_attempted",
    "relocation_success",
    "fingerprint_match",
    "fingerprint_match_component_count",
    "fingerprint_mismatch_component_count",
    "discovery_row_still_connected",
    "discovery_row_reused",
    "current_sidebar_candidate_count",
    "exact_candidate_count",
    "ambiguous_candidate_count",
    "sidebar_dom_generation_changed",
    "aria_controls_changed",
    "row_position_changed",
    "navigation_since_discovery",
    "relocation_method",
    "failure_reason",
    "relocation_attempt",
    "relocation_skip_reason",
    "candidate_search_attempted",
    "scroll_search_attempted",
    "scroll_search_stagnated",
    "more_clicked",
    "more_attempted",
    "scroll_attempts",
    "relocation_phase",
    "catalog_entry_found",
    "catalog_title_unique",
    "catalog_title_match_count",
    "title_match_count",
    "discovery_key_match_count",
    "stable_locator_match_count",
    "volatile_locator_match_count",
    "fingerprint_version",
    "fingerprint_component_count",
    "stable_component_count",
    "volatile_component_count",
    "title_duplicate_count",
    "aria_controls_present",
    "stable_fingerprint_match_count",
    "partial_match_count",
    "ambiguous_count",
    "remount_detected",
    "candidate_set_changed",
    "selected_candidate_found",
    "selected_match_method",
    "relocation_stagnated",
    "visible_project_row_count",
    "project_section_found",
    "project_scroll_container_found",
    "scroll_required",
    "scroll_position_changed",
    "more_available",
    "relocation_elapsed_ms",
    "rows_reenumerated_after_navigation",
    "stale_discovery_row_discarded",
    "identity_catalog_count",
    "identity_resolution_input_count",
    "identity_resolution_resolved_count",
    "discovery_catalog_count",
    "final_project_count",
    "collector_final_project_count",
    "collector_final_chat_count",
    "context_result_project_count",
    "context_result_chat_count",
    "source_collector_project_count",
    "forwarded_project_count",
    "forwarded_chat_count",
    "forwarding_source",
    "context_normalized_skipped_project_count",
    "unique_stable_project_id_count",
    "duplicate_stable_project_id_count",
    "duplicate_stable_project_id_group_count",
    "failed_project_indices",
    "failures",
    "source_project_index",
    "source_project_count",
    "normalization_status",
    "skip_reason",
    "has_project_id",
    "project_id_pattern_valid",
    "has_discovery_key",
    "has_title",
    "has_url",
    "url_pattern_valid",
    "duplicate_project_id",
    "duplicate_discovery_key",
    "duplicate_normalized_key",
    "normalized_identity_source",
    "output_project_index",
    "output_project_count",
    "root_hydration_started",
    "root_hydration_completed",
    "root_hydration_timeout",
    "hydration_wait_ms",
    "hydration_poll_count",
    "hydration_poll_wait_ms",
    "hydration_poll_interval_ms",
    "document_ready_state",
    "sidebar_root_present",
    "sidebar_scroll_container_present",
    "sidebar_shell_present",
    "sidebar_sections_stable",
    "mutation_count",
    "mutation_quiet_ms",
    "root_url_verified",
    "expected_root_url",
    "root_navigation_generation",
    "navigation_generation",
    "unresolved_reason_count",
    "title_present",
    "project_id_present",
    "url_present",
    "resolution_status",
    "unresolved_reason",
    "collector_window_width",
    "collector_window_height",
    "collector_content_inner_width",
    "collector_content_inner_height",
    "sidebar_expected_visible",
    "viewport_retry_count",
    "collector_tab_active",
    "tab_count_in_collector_window",
    "sidebar_container_exists",
    "project_section_exists",
    "project_row_locator_ready",
    "desktop_layout",
    "sidebar_ready",
    "sidebar_scroll_container_found",
    "sidebar_scroll_top",
    "sidebar_scroll_height",
    "sidebar_client_height",
    "sidebar_can_scroll",
    "sidebar_at_bottom",
    "visible_project_rows",
    "project_section_found",
    "no_growth_count",
    "sidebar_scroll_complete",
    "project_page_ready",
    "current_project_id_verified",
    "chat_container_found",
    "candidate_chat_link_count",
    "candidate_chat_count",
    "candidate_from_main_count",
    "candidate_from_sidebar_count",
    "candidate_from_other_count",
    "matching_project_chat_link_count",
    "matching_project_chat_count",
    "rejected_projectless_chat_count",
    "rejected_other_project_chat_count",
    "project_more_control_count",
    "project_more_control_click_count",
    "project_more_control_found",
    "project_more_control_has_href",
    "project_more_control_aria_controls_present",
    "project_virtualized_candidate",
    "main_candidate_with_project_id_count",
    "main_candidate_without_project_id_count",
    "main_current_project_match_count",
    "main_project_mismatch_count",
    "main_candidate_project_id_unique_count",
    "main_mismatch_project_id_unique_count",
    "main_current_project_id_occurrence_count",
    "main_mismatch_all_same_project_id",
    "main_mismatch_same_project_id_count",
    "main_mismatch_project_id",
    "project_id_source_chat_href_count",
    "project_id_source_nested_href_count",
    "project_id_source_data_attribute_count",
    "project_id_source_ancestor_count",
    "project_id_source_project_wrapper_count",
    "project_id_source_unknown_count",
    "project_chat_membership_inconsistent",
    "project_route_segment_detected",
    "project_route_has_slug",
    "project_id_normalization_applied",
    "project_id_normalization_source",
    "raw_route_project_id_matches_normalized",
    "normalized_project_id_match",
    "project_id_parse_failure_count",
    "project_id_normalization_applied_count",
    "main_projectless_count",
    "main_custom_gpt_count",
    "main_candidate_from_verified_project_region_count",
    "chat_scroll_container_count",
    "main_found",
    "main_region_found",
    "main_descendant_count",
    "chat_tab_found",
    "chat_list_found",
    "chat_list_candidate_count",
    "chat_row_candidate_count",
    "anchor_count",
    "button_count",
    "role_button_count",
    "role_link_count",
    "href_element_count",
    "data_attribute_candidate_count",
    "candidate_scroll_container_count",
    "scrollable_chat_candidate_count",
    "selected_scroll_container_found",
    "selected_scroll_client_height",
    "selected_scroll_height",
    "selected_scroll_distance_from_chat_list",
    "relevant_region_present",
    "document_ready_state",
    "mutation_count",
    "mutation_quiet_ms",
    "visible_chat_count",
    "deduped_chat_count",
    "duplicate_chat_count",
    "scroll_iteration",
    "scroll_top",
    "scroll_height",
    "scroll_complete",
    "project_chat_collection_complete",
    "project_chat_collection_error_reason",
    "chat_title_source",
    "title_element_found",
    "preview_element_found",
    "title_extraction_success",
    "title_differs_from_row_text",
    "title_fallback_used",
    "title_candidate_count",
    "title_character_count",
    "row_text_character_count",
    "title_element_found_count",
    "preview_element_found_count",
    "title_extraction_success_count",
    "title_fallback_used_count",
    "title_observed_chat_count",
    "root_navigation_count",
    "root_url_verification_count",
    "root_hydration_run_count",
    "root_hydration_scroll_count",
    "root_catalog_build_count",
    "root_catalog_reuse_count",
    "project_identity_attempt_count",
    "row_relocation_attempt_count",
    "row_relocation_success_count",
    "candidate_search_count",
    "candidate_search_total_candidate_count",
    "stable_locator_match_count",
    "unique_title_match_count",
    "ambiguous_match_count",
    "sidebar_scroll_attempt_count",
    "sidebar_scroll_position_change_count",
    "sidebar_scroll_stagnation_count",
    "more_click_count",
    "discovery_snapshot_count",
    "discovery_snapshot_project_candidate_count_total",
    "discovery_logical_project_count_final",
    "descriptor_added_count",
    "descriptor_updated_count",
    "descriptor_replaced_count",
    "descriptor_removed_count",
    "descriptor_duplicate_rejected_count",
    "descriptor_remount_reconciled_count",
    "descriptor_ambiguous_reconcile_count",
    "title_only_reconcile_attempt_count",
    "title_only_reconcile_rejected_count",
    "title_hint_used_count",
    "stable_evidence_reconcile_count",
    "ambiguous_same_title_reconcile_count",
    "title_only_observation_preserved_count",
    "provisional_observation_created_count",
    "provisional_observation_reused_count",
    "provisional_observation_resolved_count",
    "provisional_observation_merged_existing_count",
    "provisional_observation_promoted_new_project_count",
    "provisional_observation_unresolved_count",
    "provisional_resolved_same_existing_count",
    "provisional_resolved_distinct_project_count",
    "provisional_unresolved_kept_count",
    "provisional_unresolved_discarded_as_proven_duplicate_count",
    "provisional_unresolved_discard_rejected_count",
    "provisional_duplicate_proof_project_id_count",
    "provisional_duplicate_proof_stable_locator_count",
    "provisional_duplicate_proof_other_stable_evidence_count",
    "unique_title_volatile_remount_count",
    "provisional_same_project_id_proof_count",
    "provisional_same_stable_locator_proof_count",
    "provisional_lineage_proof_count",
    "provisional_folded_same_descriptor_count",
    "identity_input_count",
    "identity_duplicate_descriptor_count",
    "duplicate_same_project_id_count",
    "duplicate_same_stable_locator_count",
    "duplicate_same_current_discovery_key_count",
    "duplicate_same_logical_owner_count",
    "identity_catalog_invariant_passed",
    "root_logical_project_count",
    "root_discovered_logical_project_count",
    "compact_provisional_transitions",
    "provisional_created_indices",
    "provisional_merged_existing_indices",
    "confirmed_fingerprint_changed_indices",
    "stable_locator_changed_indices",
    "discovery_key_changed_indices",
    "remaining_provisional_count",
    "confirmed_count_before_identity",
    "incomplete_due_to_unresolved_provisional_count",
    "same_title_identity_same_project_count",
    "same_title_identity_distinct_project_count",
    "confirmed_logical_project_count_before_identity",
    "confirmed_logical_project_count_after_identity",
    "provisional_observation_count_before_identity",
    "provisional_observation_count_after_identity",
    "collection_trigger_source",
    "collector_creation_reason",
    "collector_resolution_reason",
    "collector_found_by_persisted_id",
    "collector_found_by_marker",
    "collector_found_by_handshake",
    "collector_candidate_window_count",
    "collector_candidate_tab_count",
    "collector_candidate_focused_count",
    "collector_candidate_active_count",
    "duplicate_collector_candidate_count",
    "persisted_window_id_present",
    "persisted_tab_id_present",
    "persisted_window_id_valid",
    "persisted_tab_id_valid",
    "collector_focus_required_for_match",
    "collector_active_required_for_match",
    "selected_collector_window_fingerprint",
    "selected_collector_tab_fingerprint",
    "handoff_send_collector_tab_fingerprint",
    "response_monitor_collector_tab_fingerprint",
    "same_collector_tab_for_send_and_monitor",
    "collector_window_created",
    "collector_tab_created",
    "collector_tab_reused",
    "collector_reused",
    "collector_created",
    "trigger_source",
    "collector_window_state_at_creation",
    "collector_window_state_at_collection_start",
    "collector_window_state_at_collection_end",
    "collector_window_focused_at_creation",
    "collector_window_focused_at_collection_start",
    "collector_window_focused_at_collection_end",
    "collector_window_state_change_count",
    "collector_window_unminimized_by_connector",
    "collector_window_minimized_during_collection",
    "collector_tab_active_at_creation",
    "collector_tab_active_at_collection_start",
    "collector_tab_active_at_collection_end",
    "collector_tab_discarded_at_collection_start",
    "collector_tab_status_at_collection_start",
    "collector_tab_active",
    "collector_tab_discarded",
    "collector_tab_status",
    "document_visibility_state_at_collection_start",
    "document_visibility_state_at_collection_end",
    "document_visibility_change_count",
    "document_hidden_observed",
    "document_hidden_duration_ms",
    "document_visible_duration_ms",
    "document_became_visible_during_collection",
    "document_became_hidden_during_collection",
    "hydration_loops_while_document_hidden",
    "hydration_loops_while_document_visible",
    "scroll_attempts_while_hidden",
    "scroll_attempts_while_visible",
    "mutation_count_while_hidden",
    "mutation_count_while_visible",
    "poll_wait_ms_while_hidden",
    "poll_wait_ms_while_visible",
    "identity_attempts_while_hidden",
    "identity_attempts_while_visible",
    "identity_wait_ms_while_hidden",
    "identity_wait_ms_while_visible",
    "startup_collection_suppressed",
    "manual_refresh_started",
    "manual_refresh_completed",
    "duplicate_discovery_key_count",
    "discovery_key_changed_for_same_logical_project_count",
    "more_control_seen_count",
    "more_control_logical_unique_count",
    "more_control_duplicate_suppressed_count",
    "more_pagination_round_count",
    "more_click_progress_count",
    "more_click_no_progress_count",
    "more_reappeared_after_click_count",
    "more_reclick_allowed_count",
    "more_reclick_suppressed_count",
    "more_project_count_before_click_total",
    "more_project_count_after_click_total",
    "more_scroll_height_increased_count",
    "more_candidate_count_increased_count",
    "more_descriptor_count_increased_count",
    "hydration_completed_with_more_visible",
    "hydration_completed_after_more_no_progress",
    "more_visible_at_hydration_complete",
    "more_enabled_at_hydration_complete",
    "more_clickable_at_hydration_complete",
    "hydration_stop_reason",
    "hydration_loop_count",
    "hydration_progress_count",
    "hydration_no_progress_count",
    "hydration_consecutive_stagnation_max",
    "hydration_stagnation_break_count",
    "hydration_same_logical_state_count",
    "hydration_catalog_unchanged_count",
    "hydration_snapshot_unchanged_count",
    "hydration_progress_project_count_increase",
    "hydration_progress_provisional_count_increase",
    "hydration_progress_scroll_position_change",
    "hydration_progress_scroll_height_increase",
    "hydration_progress_more_pagination",
    "hydration_stagnation_reset_count",
    "post_navigation_identity_count",
    "post_navigation_identity_wait_ms",
    "post_navigation_child_region_wait_ms",
    "post_navigation_relocation_wait_ms",
    "root_return_revalidation_ms",
    "root_return_dom_refresh_count",
    "root_return_cache_invalidation_count",
    "project_candidate_rejected_child_chat_count",
    "project_candidate_rejected_non_project_count",
    "final_catalog_index_count",
    "disclosure_open_count",
    "disclosure_close_count",
    "dom_generation_change_count",
    "navigation_fallback_attempt_count",
    "navigation_fallback_success_count",
    "project_navigation_count",
    "root_return_navigation_count",
    "spa_navigation_count",
    "full_page_navigation_count",
    "stale_navigation_result_rejected_count",
    "tab_update_navigation_request_count",
    "tab_update_root_request_count",
    "tab_update_project_request_count",
    "observed_url_change_count",
    "observed_loading_count",
    "observed_complete_count",
    "content_script_boot_count",
    "content_script_reconnect_count",
    "document_navigation_count",
    "spa_route_change_count",
    "dom_remount_count",
    "reload_api_call_count",
    "root_navigation_requested",
    "root_return_requested",
    "identity_collision_count",
    "missing_stable_identity_count",
    "root_navigation_wait_ms",
    "root_url_verification_wait_ms",
    "root_hydration_wait_ms",
    "root_hydration_poll_count",
    "root_hydration_poll_wait_ms",
    "root_hydration_poll_interval_ms",
    "root_hydration_scroll_wait_ms",
    "more_click_wait_ms",
    "catalog_build_ms",
    "identity_resolution_ms",
    "identity_disclosure_wait_ms",
    "identity_dom_remount_wait_ms",
    "identity_candidate_search_ms",
    "identity_relocation_wait_ms",
    "identity_child_region_wait_ms",
    "child_region_wait_average_ms",
    "child_region_wait_max_ms",
    "child_region_wait_p50_ms",
    "child_region_wait_p95_ms",
    "child_region_immediate_hit_count",
    "child_region_observer_needed_count",
    "child_region_poll_needed_count",
    "child_region_early_success_count",
    "child_region_timeout_count",
    "child_region_ambiguous_count",
    "child_region_candidate_zero_count",
    "child_region_unique_candidate_count",
    "child_region_same_id_multi_candidate_count",
    "child_region_distinct_id_collision_count",
    "mutation_quiet_wait_total_ms",
    "disclosure_open_wait_total_ms",
    "remount_recovery_wait_total_ms",
    "slow_project_count",
    "slow_project_indices",
    "slow_project_ms",
    "slow_project_details",
    "identity_pass_kind",
    "timeout_ceiling_hit_count",
    "timeout_ceiling_hit_indices",
    "early_escalation_count",
    "early_escalation_indices",
    "early_escalation_reason_counts",
    "resolved_identity_skipped_count",
    "resolved_identity_rechecked_count",
    "incremental_reuse_eligible_count",
    "incremental_reuse_hit_count",
    "incremental_reuse_miss_count",
    "incremental_reuse_rejected_count",
    "incremental_reuse_learned_count",
    "incremental_reuse_no_proof_count",
    "batch_immediate_resolved_count",
    "batch_immediate_resolved_indices",
    "disclosure_required_count",
    "disclosure_required_indices",
    "per_project_disclosure_click_total_ms",
    "per_project_post_click_immediate_scan_total_ms",
    "per_project_observer_wait_total_ms",
    "per_project_poll_wait_total_ms",
    "per_project_relocation_total_ms",
    "observer_wait_count",
    "observer_wake_count",
    "observer_wake_without_target_progress_count",
    "fixed_settle_wait_total_ms",
    "controlled_region_materialized_count",
    "child_anchor_materialized_count",
    "identity_resolved_before_click_count",
    "identity_resolved_immediately_after_click_count",
    "identity_resolved_after_observer_count",
    "identity_resolved_after_poll_count",
    "slow_project_phase",
    "post_navigation_retry_input_count",
    "post_navigation_retry_indices",
    "post_navigation_retry_ms",
    "initial_dom_pass_ms",
    "initial_dom_pass_resolved_count",
    "initial_dom_pass_unresolved_indices",
    "navigation_identity_resolution_ms",
    "navigation_identity_resolved_index",
    "initial_unresolved_indices",
    "navigation_candidate_indices",
    "navigation_attempted_indices",
    "navigation_success_indices",
    "navigation_failure_indices",
    "navigation_not_started_indices",
    "navigation_terminal_failure_indices",
    "navigation_started_count",
    "visibility_recovery_attempt_count",
    "visibility_recovery_indices",
    "visibility_recovery_success_indices",
    "visibility_recovery_failure_indices",
    "visibility_recovery_scroll_attempt_count",
    "visibility_recovery_scroll_position_change_count",
    "visibility_recovery_stagnation_count",
    "navigation_selected_count",
    "row_not_visible_recoverable_count",
    "row_visibility_exhausted_count",
    "navigation_skipped_indices",
    "navigation_skip_reason_counts",
    "remaining_navigation_eligible_indices",
    "remaining_navigation_ineligible_indices",
    "identity_state_transitions",
    "navigation_loop_iteration_count",
    "navigation_attempt_limit",
    "navigation_attempt_limit_hit",
    "resolved_count_before_navigation",
    "resolved_count_after_navigation",
    "final_unresolved_indices",
    "navigation_eligible",
    "navigation_success_dom_wait_ms",
    "navigation_success_extra_dom_wait_count",
    "dom_cache_invalidated_count",
    "logical_identity_invalidated_count",
    "identity_navigation_wait_ms",
    "identity_misc_wait_ms",
    "identity_elapsed_ms",
    "identity_source_row_metadata_count",
    "identity_source_child_chat_count",
    "identity_source_controlled_region_count",
    "identity_source_navigation_count",
    "identity_source_nested_url_count",
    "average_identity_ms",
    "max_identity_ms",
    "catalog_reused",
    "relocation_skipped_connected_row",
    "row_relocation_ms",
    "navigation_fallback_ms",
    "root_return_wait_ms",
    "collector_recovery_wait_ms",
    "miscellaneous_wait_ms",
    "total_explicit_delay_ms",
    "total_poll_wait_ms",
    "total_dom_wait_ms",
    "total_navigation_wait_ms",
    "telemetry_event_count_total",
    "telemetry_event_count_detail",
    "telemetry_event_count_summary",
    "elapsed_ms",
    "scan_iteration",
    "scroll_position_changed",
    "reached_end",
    "failure_stage",
    "exception_name",
    "exception_reason",
    "project_chat_hydration_completed",
    "project_chat_hydration_timeout",
    "target_tab_id",
    "tab_id",
    "window_id",
    "event_tab_id",
    "event_window_id",
    "tab_active",
    "tab_discarded",
    "tab_frozen",
    "tab_auto_discardable",
    "window_focused",
    "tab_status",
    "managed_tab_exists",
    "content_script_alive",
    "watcher_state",
    "assistant_state",
    "changed_state",
    "content_ready",
    "conversation_ready",
    "composer_ready",
    "watcher_ready",
    "target_tab_fingerprint",
    "watch_started_at_relative_ms",
    "send_confirmed_at_relative_ms",
    "assistant_observed_at_relative_ms",
    "streaming_started_at_relative_ms",
    "completion_observed_at_relative_ms",
    "total_watch_ms",
    "absolute_timeout_ms",
    "inactivity_timeout_ms",
    "hard_timeout_ms",
    "poll_count",
    "meaningful_progress_count",
    "last_progress_age_ms",
    "text_growth_event_count",
    "response_remount_count",
    "streaming_state_change_count",
    "thinking_state_observed",
    "generation_alive_observation_count",
    "document_visibility_state_at_start",
    "document_hidden_observed",
    "tab_active_at_start",
    "window_focused_at_start",
    "timeout_triggered",
    "timeout_kind",
    "assistant_streaming_at_failure",
    "assistant_generation_alive_at_failure",
    "response_node_present_at_failure",
    "completion_detected",
    "final_status"
  ]) {
    if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
    if (typeof fields[key] === "number" && Number.isSafeInteger(fields[key])) safe[key] = fields[key];
    if (typeof fields[key] === "boolean") safe[key] = fields[key];
  }
  if (Array.isArray(fields.failed_project_indices)) {
    safe.failed_project_indices = fields.failed_project_indices
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
      .slice(0, 5000);
  }
  for (const key of [
    "navigation_fallback_project_indices",
    "navigation_fallback_success_project_indices",
    "navigation_fallback_failure_project_indices",
    "slow_identity_project_indices",
    "slow_identity_before_navigation_indices",
    "slow_identity_after_navigation_indices",
    "slow_identity_indices_while_hidden",
    "slow_identity_indices_while_visible",
    "final_catalog_indices",
    "descriptor_added_after_first_snapshot_indices",
    "duplicate_descriptor_indices"
  ]) {
    if (!Array.isArray(fields[key])) continue;
    safe[key] = fields[key]
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
      .slice(0, 5000);
  }
  if (fields.hydration_stagnation_reset_reason_counts
    && typeof fields.hydration_stagnation_reset_reason_counts === "object") {
    const counts = {};
    for (const key of [
      "project_count",
      "provisional_count",
      "scroll_position",
      "scroll_height",
      "more_pagination"
    ]) {
      const value = fields.hydration_stagnation_reset_reason_counts[key];
      if (Number.isSafeInteger(value) && value >= 0) counts[key] = value;
    }
    safe.hydration_stagnation_reset_reason_counts = counts;
  }
  if (Array.isArray(fields.failures)) {
    const failureKeys = new Set([
      "project_index",
      "unresolved_reason",
      "identity_source",
      "stable_identity_candidate_count",
      "distinct_candidate_project_id_count",
      "identity_candidate_consistent",
      "project_id_extracted",
      "row_relocation_attempted",
      "row_relocation_success",
      "selected_match_method",
      "relocation_skip_reason",
      "candidate_search_attempted",
      "scroll_search_attempted",
      "scroll_search_stagnated",
      "fingerprint_match",
      "stable_fingerprint_match_count",
      "title_match_count",
      "title_duplicate_count",
      "child_chat_count",
      "child_project_url_count",
      "nested_project_url_found",
      "navigation_fallback_attempted",
      "navigation_fallback_success",
      "navigation_target_verified",
      "collision_detected",
      "navigation_generation_match",
      "navigation_started_for_project",
      "navigation_completed_for_project",
      "navigation_target_verified_for_project",
      "navigation_owned_by_current_project",
      "navigation_owner_project_index",
      "stale_navigation_result_rejected",
      "current_url_used_as_identity"
    ]);
    safe.failures = fields.failures.slice(0, 5000).map((failure) => {
      const sanitized = {};
      if (!failure || typeof failure !== "object") return sanitized;
      for (const key of failureKeys) {
        if (typeof failure[key] === "boolean") sanitized[key] = failure[key];
        else if (Number.isSafeInteger(failure[key]) && failure[key] >= 0) sanitized[key] = failure[key];
        else if (typeof failure[key] === "string" && failure[key].length <= 128) sanitized[key] = failure[key];
      }
      return sanitized;
    });
  }
  if (!shouldEmit) return;
  try {
    console.info(`[ChatGPT Comfy Connector] ${eventName}`, safe);
  } catch (_) {
    // Console access must never affect the Bridge transport.
  }
}

function traceForMessage(message, fields = {}) {
  return {
    request_id: message?.request_id ?? message?.requestId,
    session_id: message?.session_id ?? message?.sessionId,
    handoff_id: message?.handoff_id ?? message?.handoffId,
    boundary_id: message?.boundary_id ?? message?.boundaryId,
    target_tab_id: message?.target_tab_id ?? message?.targetTabId,
    ...fields
  };
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function managedTabStorage() {
  return chrome.storage.session || chrome.storage.local;
}

function managedTabTrace(fields = {}) {
  return {
    ...(managedTabState.tabId !== null ? { target_tab_id: managedTabState.tabId } : {}),
    ...(Number.isSafeInteger(managedTabState.executionWindowId)
      ? { execution_window_id: managedTabState.executionWindowId }
      : {}),
    ...(typeof managedTabState.executionWindowState === "string"
      ? { execution_window_state: managedTabState.executionWindowState }
      : {}),
    ...(managedTabState.conversationId ? { conversation_id: managedTabState.conversationId } : {}),
    ...(managedTabState.conversationUrl ? { conversation_url: managedTabState.conversationUrl } : {}),
    ...fields
  };
}

function responseWatchForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return null;
  const current = managedTabState.currentRequestId
    ? responseWatches.get(managedTabState.currentRequestId)
    : null;
  if (current?.tabId === tabId) return current;
  return [...responseWatches.values()].find((pending) => pending.tabId === tabId) || null;
}

function managedTabTelemetryIdentity(tabId) {
  const pending = responseWatchForTab(tabId);
  if (pending) {
    return {
      request_id: pending.requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId
    };
  }
  if (tabId === managedTabState.tabId) {
    return {
      request_id: managedTabState.currentRequestId,
      session_id: managedTabState.currentSessionId,
      handoff_id: managedTabState.currentHandoffId,
      boundary_id: managedTabState.currentBoundaryId
    };
  }
  return {};
}

async function readManagedTabLifecycleSnapshot(tabId, tabHint = null, fallbackWindowId = null) {
  const snapshot = {};
  if (Number.isSafeInteger(tabId) && tabId >= 0) {
    snapshot.tab_id = tabId;
    snapshot.target_tab_id = tabId;
  }

  let tab = tabHint;
  if (!tab && Number.isSafeInteger(tabId) && tabId >= 0 && typeof chrome.tabs?.get === "function") {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch (_) {
      tab = null;
    }
  }

  snapshot.managed_tab_exists = Boolean(tab);
  if (tab) {
    if (Number.isSafeInteger(tab.id)) {
      snapshot.tab_id = tab.id;
      snapshot.target_tab_id = tab.id;
    }
    if (Number.isSafeInteger(tab.windowId)) snapshot.window_id = tab.windowId;
    else if (Number.isSafeInteger(fallbackWindowId)) snapshot.window_id = fallbackWindowId;
    if (typeof tab.active === "boolean") snapshot.tab_active = tab.active;
    if (typeof tab.discarded === "boolean") snapshot.tab_discarded = tab.discarded;
    if (typeof tab.frozen === "boolean") snapshot.tab_frozen = tab.frozen;
    if (typeof tab.autoDiscardable === "boolean") snapshot.tab_auto_discardable = tab.autoDiscardable;
    if (typeof tab.status === "string") snapshot.tab_status = tab.status;
  } else if (Number.isSafeInteger(fallbackWindowId)) {
    snapshot.window_id = fallbackWindowId;
  }

  const isManagedTelemetryTarget = tabId === null || tabId === managedTabState.tabId;
  const executionWindowId = isManagedTelemetryTarget && Number.isSafeInteger(managedTabState.executionWindowId)
    ? managedTabState.executionWindowId
    : (isManagedTelemetryTarget && Number.isSafeInteger(tab?.windowId) ? tab.windowId : null);
  if (Number.isSafeInteger(executionWindowId)) {
    snapshot.execution_window_id = executionWindowId;
  }

  if (Number.isSafeInteger(snapshot.window_id) && typeof chrome.windows?.get === "function") {
    try {
      const window = await chrome.windows.get(snapshot.window_id);
      if (typeof window?.focused === "boolean") snapshot.window_focused = window.focused;
    } catch (_) {
      // Lifecycle telemetry must never affect the managed-tab transport.
    }
  }
  if (Number.isSafeInteger(executionWindowId) && typeof chrome.windows?.get === "function") {
    try {
      const executionWindow = await chrome.windows.get(executionWindowId);
      snapshot.execution_window_exists = true;
      if (typeof executionWindow?.focused === "boolean") {
        snapshot.execution_window_focused = executionWindow.focused;
      }
      if (typeof executionWindow?.state === "string") {
        snapshot.execution_window_state = executionWindow.state;
        snapshot.execution_window_minimized = executionWindow.state === "minimized";
      }
    } catch (_) {
      snapshot.execution_window_exists = false;
      snapshot.execution_window_state = "missing";
      snapshot.execution_window_minimized = false;
    }
  }
  if (Number.isSafeInteger(executionWindowId) && snapshot.execution_window_exists === undefined) {
    snapshot.execution_window_exists = false;
    snapshot.execution_window_state = "unknown";
  }
  return snapshot;
}

function recordManagedTabLifecycleTelemetry(stage, fields = {}, tabId = managedTabState.tabId, tabHint = null, fallbackWindowId = null) {
  const resolvedTabId = Number.isSafeInteger(tabId) && tabId >= 0 ? tabId : null;
  const pending = responseWatchForTab(resolvedTabId);
  const contentScriptAlive = resolvedTabId !== null
    && (contentScriptReadyTabs.has(resolvedTabId)
      || (resolvedTabId === managedTabState.tabId && managedTabState.contentReady === true));
  const base = {
    ...managedTabTelemetryIdentity(resolvedTabId),
    ...(resolvedTabId !== null ? { tab_id: resolvedTabId, target_tab_id: resolvedTabId } : {}),
    lifecycle: managedTabState.lifecycle,
    content_script_alive: contentScriptAlive,
    watcher_state: pending
      ? (pending.watcherReady ? "armed" : "requested")
      : (resolvedTabId === managedTabState.tabId && managedTabState.watcherReady ? "armed" : "idle"),
    ...fields,
    stage
  };

  void readManagedTabLifecycleSnapshot(resolvedTabId, tabHint, fallbackWindowId).then((snapshot) => {
    const telemetry = { ...base, ...snapshot, stage };
    const previous = resolvedTabId === null
      ? null
      : managedTabTelemetrySnapshots.get(resolvedTabId);
    const changedStates = [];
    for (const key of [
      "tab_discarded",
      "tab_frozen",
      "tab_active",
      "window_focused",
      "execution_window_focused",
      "execution_window_state",
      "execution_window_exists"
    ]) {
      if (previous
        && previous[key] !== undefined
        && telemetry[key] !== undefined
        && previous[key] !== telemetry[key]) {
        changedStates.push(key);
      }
    }
    if (previous
      && typeof previous.managed_tab_exists === "boolean"
      && previous.managed_tab_exists !== telemetry.managed_tab_exists) {
      changedStates.push("managed_tab_exists");
    }

    diagnostic("managed tab lifecycle telemetry", telemetry);
    if (changedStates.length > 0) {
      diagnostic("managed tab lifecycle state changed", {
        ...telemetry,
        status: "changed",
        stage: "managed_tab_state_changed",
        changed_state: changedStates.join(",")
      });
    }
    if (resolvedTabId !== null) managedTabTelemetrySnapshots.set(resolvedTabId, telemetry);
  }).catch(() => {
    diagnostic("managed tab lifecycle telemetry", {
      ...base,
      managed_tab_exists: false,
      status: "unknown",
      stage
    });
  });
}

function managedTabLifecycle(lifecycle, fields = {}) {
  managedTabState = {
    ...managedTabState,
    lifecycle,
    ...fields
  };
  void managedTabStorage().set({
    [MANAGED_TAB_STORAGE_KEY]: {
      tabId: managedTabState.tabId,
      executionWindowId: managedTabState.executionWindowId,
      executionWindowState: managedTabState.executionWindowState,
      executionGeneration: managedTabState.executionGeneration || managedExecutionGeneration,
      conversationId: managedTabState.conversationId,
      conversationUrl: managedTabState.conversationUrl,
      projectId: managedTabState.projectId,
      projectUrl: managedTabState.projectUrl,
      lifecycle: managedTabState.lifecycle,
      contentReady: managedTabState.contentReady,
      conversationReady: managedTabState.conversationReady,
      composerReady: managedTabState.composerReady,
      watcherReady: managedTabState.watcherReady,
      currentRequestId: managedTabState.currentRequestId,
      currentSessionId: managedTabState.currentSessionId,
      currentHandoffId: managedTabState.currentHandoffId,
      currentBoundaryId: managedTabState.currentBoundaryId
    }
  }).catch(() => {});
  diagnostic("managed tab lifecycle", managedTabTrace({
    lifecycle,
    content_ready: managedTabState.contentReady,
    conversation_ready: managedTabState.conversationReady,
    composer_ready: managedTabState.composerReady,
    watcher_ready: managedTabState.watcherReady,
    ...fields
  }));
}

function clearManagedTabState(lifecycle = "Failed", options = {}) {
  // The tab is only an execution medium. Preserve the bound Conversation so
  // a later operation can recreate the active tab at the same destination.
  managedTabLifecycle(lifecycle, {
    tabId: null,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false,
    ...(options.clearExecutionWindow === true
      ? { executionWindowId: null, executionWindowState: "Idle" }
      : {})
  });
}

function managedTabError(code, stage, message) {
  const error = bridgeError(message, 0, code);
  error.stage = stage;
  return error;
}

function withManagedTabOperation(operation) {
  const next = managedTabStateOperation.then(operation, operation);
  managedTabStateOperation = next.catch(() => {});
  return next;
}

function createManagedExecutionResolution(requestId, handoffId) {
  return {
    requestId: requestId || null,
    handoffId: handoffId || null,
    ensureCallCount: 0,
    ensureJoinedInflightCount: 0,
    ensureNewCreationCount: 0,
    executionWindowCreateRequestedCount: 0,
    executionWindowCreatedCount: 0,
    executionWindowReusedCount: 0,
    managedTabCreateRequestedCount: 0,
    managedTabCreatedCount: 0,
    managedTabReusedCount: 0,
    recoveryAttemptCount: 0,
    recoveryJoinedInflightCount: 0,
    duplicateCreationPreventedCount: 0,
    executionWindowPhysicalTabCountAtCreation: 0,
    executionWindowPhysicalTabCountAfterTabResolution: 0,
    executionWindowPhysicalTabCountFinal: 0,
    initialWindowTabFound: false,
    initialWindowTabReused: false,
    initialWindowTabClosed: false,
    managedTabCreatedViaTabsCreate: false,
    managedTabAdoptedFromWindowCreate: false,
    finalExecutionWindowCount: null,
    finalManagedTabCount: null,
    handoffBoundWindowFingerprint: "none",
    handoffBoundTabFingerprint: "none",
    watcherWindowFingerprint: "none",
    watcherTabFingerprint: "none",
    senderWindowFingerprint: "none",
    senderTabFingerprint: "none"
  };
}

function managedExecutionResolutionFor(requestId, handoffId = null) {
  const key = typeof requestId === "string" && requestId.length > 0 ? requestId : "_global";
  if (!managedExecutionResolutions.has(key)) {
    managedExecutionResolutions.set(key, createManagedExecutionResolution(requestId, handoffId));
  }
  const resolution = managedExecutionResolutions.get(key);
  if (handoffId && !resolution.handoffId) resolution.handoffId = handoffId;
  return resolution;
}

function bindManagedExecutionToRequest(requestId, windowId, tabId, generation) {
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  const existing = managedExecutionRequestBindings.get(requestId);
  if (existing && Number.isSafeInteger(existing.targetTabId) && existing.targetTabId >= 0) return existing;
  const binding = {
    requestId,
    executionWindowId: Number.isSafeInteger(windowId) ? windowId : null,
    targetTabId: Number.isSafeInteger(tabId) ? tabId : null,
    executionGeneration: Number.isSafeInteger(generation) ? generation : managedExecutionGeneration
  };
  managedExecutionRequestBindings.set(requestId, binding);
  return binding;
}

function managedExecutionBindingForRequest(requestId) {
  if (typeof requestId !== "string" || requestId.length === 0) return null;
  return managedExecutionRequestBindings.get(requestId) || null;
}

async function liveManagedExecutionBinding(requestId) {
  const binding = managedExecutionBindingForRequest(requestId);
  if (!binding || !Number.isSafeInteger(binding.targetTabId)) return null;
  try {
    const tab = await chrome.tabs.get(binding.targetTabId);
    if (!tab || !isUsableManagedExecutionTab(tab, binding.executionWindowId)) {
      if (!tab || !isOwnedManagedExecutionTab(tab)) {
        managedExecutionRequestBindings.delete(requestId);
      }
      return null;
    }
    if (Number.isSafeInteger(binding.executionWindowId)
      && tab.windowId !== binding.executionWindowId) {
      managedExecutionRequestBindings.delete(requestId);
      return null;
    }
    return { binding, tab };
  } catch (_) {
    managedExecutionRequestBindings.delete(requestId);
    return null;
  }
}

async function countOwnedExecutionWindows() {
  let count = 0;
  for (const windowId of managedExecutionOwnedWindowIds) {
    if (await getManagedExecutionWindow(windowId)) count += 1;
  }
  return count;
}

async function countOwnedExecutionTabs(windowId) {
  const tabs = await tabsInManagedExecutionWindow(windowId);
  const owned = tabs.filter((tab) => isOwnedManagedExecutionTab(tab)
    && (isChatGptTab(tab) || isPlaceholderExecutionTab(tab)));
  if (owned.length > 0) return owned.length;
  return tabs.filter((tab) => isChatGptTab(tab)
    && (tab.id === managedTabState.tabId
      || [...managedExecutionRequestBindings.values()].some((binding) => binding.targetTabId === tab.id))).length;
}

async function countPhysicalExecutionWindowTabs(windowId) {
  return (await tabsInManagedExecutionWindow(windowId)).length;
}

async function emitConnectorManagedWindowTopologySummary(requestId = null) {
  const windowId = Number.isSafeInteger(collectorWindowState.windowId)
    ? collectorWindowState.windowId
    : managedTabState.executionWindowId;
  const physical = Number.isSafeInteger(windowId) ? await countPhysicalExecutionWindowTabs(windowId) : 0;
  const collectorExists = Number.isSafeInteger(collectorWindowState.tabId);
  const executionExists = Number.isSafeInteger(managedTabState.tabId);
  const sameWindow = collectorExists
    && executionExists
    && collectorWindowState.windowId === managedTabState.executionWindowId;
  const sameTab = collectorExists && executionExists && collectorWindowState.tabId === managedTabState.tabId;
  const ownedTabCount = (collectorExists ? 1 : 0) + (executionExists ? 1 : 0);
  diagnostic("connector managed window topology summary", {
    request_id: requestId,
    collector_window_id: collectorWindowState.windowId,
    execution_window_id: managedTabState.executionWindowId,
    managed_window_exists: Number.isSafeInteger(windowId),
    managed_window_id: windowId,
    managed_window_created_count: connectorManagedWindowCreatedCount,
    managed_window_reused_count: connectorManagedWindowReusedCount,
    collector_tab_exists: collectorExists,
    collector_tab_owned: collectorExists,
    execution_tab_exists: executionExists,
    execution_tab_owned: executionExists,
    collector_and_execution_same_window: sameWindow === true,
    collector_and_execution_same_tab: sameTab === true,
    owned_tab_count: ownedTabCount,
    physical_tab_count: physical,
    user_unmanaged_tab_count: Math.max(0, physical - ownedTabCount),
    topology_valid: sameTab !== true && (!collectorExists || !executionExists || sameWindow === true),
    collector_tab_fingerprint: collectorHandleFingerprint(
      collectorWindowState.windowId,
      collectorWindowState.tabId),
    execution_tab_fingerprint: collectorHandleFingerprint(
      managedTabState.executionWindowId,
      managedTabState.tabId),
    status: "observed",
    stage: "connector_managed_window_topology_summary"
  });
}

function emitManagedExecutionResolutionSummary(requestId, extra = {}) {
  const resolution = managedExecutionResolutionFor(requestId);
  if (Number.isSafeInteger(extra.finalExecutionWindowCount)) {
    resolution.finalExecutionWindowCount = extra.finalExecutionWindowCount;
  }
  if (Number.isSafeInteger(extra.finalManagedTabCount)) {
    resolution.finalManagedTabCount = extra.finalManagedTabCount;
  }
  if (Number.isSafeInteger(extra.finalExecutionWindowPhysicalTabCount)) {
    resolution.executionWindowPhysicalTabCountFinal = extra.finalExecutionWindowPhysicalTabCount;
  }
  const binding = managedExecutionBindingForRequest(requestId);
  const boundFingerprint = collectorHandleFingerprint(
    binding?.executionWindowId,
    binding?.targetTabId);
  const globalChanged = Boolean(binding
    && Number.isSafeInteger(managedTabState.tabId)
    && managedTabState.tabId !== binding.targetTabId);
  diagnostic("managed execution resolution summary", {
    request_id: resolution.requestId,
    handoff_id: resolution.handoffId,
    execution_generation: binding?.executionGeneration || managedExecutionGeneration,
    ensure_call_count: resolution.ensureCallCount,
    ensure_joined_inflight_count: resolution.ensureJoinedInflightCount,
    ensure_new_creation_count: resolution.ensureNewCreationCount,
    execution_window_create_requested_count: resolution.executionWindowCreateRequestedCount,
    execution_window_created_count: resolution.executionWindowCreatedCount,
    execution_window_reused_count: resolution.executionWindowReusedCount,
    managed_tab_create_requested_count: resolution.managedTabCreateRequestedCount,
    managed_tab_created_count: resolution.managedTabCreatedCount,
    managed_tab_reused_count: resolution.managedTabReusedCount,
    recovery_attempt_count: resolution.recoveryAttemptCount,
    recovery_joined_inflight_count: resolution.recoveryJoinedInflightCount,
    duplicate_creation_prevented_count: resolution.duplicateCreationPreventedCount,
    execution_window_physical_tab_count_at_creation: resolution.executionWindowPhysicalTabCountAtCreation,
    execution_window_physical_tab_count_after_tab_resolution: resolution.executionWindowPhysicalTabCountAfterTabResolution,
    execution_window_physical_tab_count_final: extra.finalExecutionWindowPhysicalTabCount
      ?? resolution.executionWindowPhysicalTabCountFinal,
    initial_window_tab_found: resolution.initialWindowTabFound === true,
    initial_window_tab_reused: resolution.initialWindowTabReused === true,
    initial_window_tab_closed: resolution.initialWindowTabClosed === true,
    managed_tab_created_via_tabs_create: resolution.managedTabCreatedViaTabsCreate === true,
    managed_tab_adopted_from_window_create: resolution.managedTabAdoptedFromWindowCreate === true,
    final_execution_window_count: extra.finalExecutionWindowCount ?? resolution.finalExecutionWindowCount,
    final_managed_tab_count: extra.finalManagedTabCount ?? resolution.finalManagedTabCount,
    final_execution_window_physical_tab_count: extra.finalExecutionWindowPhysicalTabCount
      ?? resolution.executionWindowPhysicalTabCountFinal,
    handoff_bound_window_fingerprint: resolution.handoffBoundWindowFingerprint,
    handoff_bound_tab_fingerprint: resolution.handoffBoundTabFingerprint,
    watcher_window_fingerprint: resolution.watcherWindowFingerprint,
    watcher_tab_fingerprint: resolution.watcherTabFingerprint,
    sender_window_fingerprint: resolution.senderWindowFingerprint,
    sender_tab_fingerprint: resolution.senderTabFingerprint,
    same_execution_tab_for_handoff_watch_send: extra.sameExecutionTab === true
      || (
        resolution.handoffBoundTabFingerprint !== "none"
        && resolution.handoffBoundTabFingerprint === resolution.watcherTabFingerprint
        && resolution.handoffBoundTabFingerprint === resolution.senderTabFingerprint),
    execution_target_changed_during_request: globalChanged,
    status: "observed",
    stage: "managed_execution_resolution_summary"
  });
}

function withCollectorWindowOperation(operation) {
  const next = collectorWindowStateOperation.then(operation, operation);
  collectorWindowStateOperation = next.catch(() => {});
  return next;
}

function isCurrentCollectorRequest(pending) {
  return Number.isSafeInteger(pending?.generation)
    && pending.generation === collectorContextGeneration;
}

function throwIfCollectorRequestSuperseded(pending) {
  if (isCurrentCollectorRequest(pending)) return;
  throw bridgeError(
    "ChatGPT Contextの古いRefresh結果は破棄されました。",
    0,
    "context_refresh_superseded");
}

function createProjectDiscoveryState(pending) {
  projectDiscoverySequence += 1;
  const refreshGeneration = Number.isSafeInteger(pending?.generation)
    ? pending.generation
    : 0;
  return {
    refreshGeneration,
    runId: `refresh-${refreshGeneration}-project-${projectDiscoverySequence}`,
    callCount: 0,
    started: false,
    completed: false,
    scanCompleted: false,
    caller: null,
    inFlight: false,
    alreadyCompleted: false,
    scrollDirection: null,
    restoreCount: 0,
    result: null,
    promise: null
  };
}

function projectDiscoveryStateFor(pending) {
  if (!pending || typeof pending !== "object") return createProjectDiscoveryState(null);
  if (!pending.projectDiscovery) pending.projectDiscovery = createProjectDiscoveryState(pending);
  return pending.projectDiscovery;
}

function syncProjectDiscoveryTelemetry(pending, discovery) {
  if (!discovery || (pending && !isCurrentCollectorRequest(pending))) return;
  collectorWindowState = {
    ...collectorWindowState,
    refreshGeneration: discovery.refreshGeneration,
    projectDiscoveryRunId: discovery.runId,
    projectDiscoveryCallCount: discovery.callCount,
    projectDiscoveryStarted: discovery.started,
    projectDiscoveryCompleted: discovery.completed,
    projectDiscoveryScanCompleted: discovery.scanCompleted,
    projectDiscoveryCaller: discovery.caller,
    projectDiscoveryInFlight: discovery.inFlight,
    projectDiscoveryAlreadyCompleted: discovery.alreadyCompleted,
    projectDiscoveryScrollDirection: discovery.scrollDirection,
    projectDiscoveryRestoreCount: discovery.restoreCount
  };
}

function recordProjectDiscoveryTelemetry(eventName, pending, fields = {}) {
  const discovery = projectDiscoveryStateFor(pending);
  syncProjectDiscoveryTelemetry(pending, discovery);
  diagnostic(eventName, {
    request_id: pending?.requestId,
    refresh_generation: discovery.refreshGeneration,
    project_discovery_run_id: discovery.runId,
    project_discovery_call_count: discovery.callCount,
    project_discovery_started: discovery.started,
    project_discovery_completed: discovery.completed,
    project_discovery_scan_completed: discovery.scanCompleted,
    project_discovery_caller: discovery.caller,
    project_discovery_in_flight: discovery.inFlight,
    project_discovery_already_completed: discovery.alreadyCompleted,
    project_discovery_scroll_direction: discovery.scrollDirection,
    project_discovery_restore_count: discovery.restoreCount,
    root_hydration_started: collectorWindowState.rootHydrationStarted,
    root_hydration_completed: collectorWindowState.rootHydrationCompleted,
    root_hydration_timeout: collectorWindowState.rootHydrationTimeout,
    hydration_wait_ms: collectorWindowState.hydrationWaitMs,
    document_ready_state: collectorWindowState.documentReadyState,
    sidebar_root_present: collectorWindowState.sidebarRootPresent,
    sidebar_scroll_container_present: collectorWindowState.sidebarScrollContainerPresent,
    sidebar_shell_present: collectorWindowState.sidebarShellPresent,
    sidebar_sections_stable: collectorWindowState.sidebarSectionsStable,
    mutation_count: collectorWindowState.mutationCount,
    mutation_quiet_ms: collectorWindowState.mutationQuietMs,
    root_url_verified: collectorWindowState.rootUrlVerified,
    root_navigation_generation: collectorWindowState.rootNavigationGeneration,
    ...fields
  });
}

function projectDiscoveryTraceFields(pending) {
  const discovery = pending?.projectDiscovery;
  if (!discovery) return {};
  return {
    refresh_generation: discovery.refreshGeneration,
    project_discovery_run_id: discovery.runId,
    project_discovery_call_count: discovery.callCount,
    project_discovery_started: discovery.started === true,
    project_discovery_completed: discovery.completed === true,
    project_discovery_scan_completed: discovery.scanCompleted === true,
    project_discovery_caller: discovery.caller,
    project_discovery_in_flight: discovery.inFlight === true,
    project_discovery_already_completed: discovery.alreadyCompleted === true,
    project_discovery_scroll_direction: discovery.scrollDirection,
    project_discovery_restore_count: discovery.restoreCount,
    root_hydration_started: collectorWindowState.rootHydrationStarted,
    root_hydration_completed: collectorWindowState.rootHydrationCompleted,
    root_hydration_timeout: collectorWindowState.rootHydrationTimeout,
    hydration_wait_ms: collectorWindowState.hydrationWaitMs,
    document_ready_state: collectorWindowState.documentReadyState,
    sidebar_root_present: collectorWindowState.sidebarRootPresent,
    sidebar_scroll_container_present: collectorWindowState.sidebarScrollContainerPresent,
    sidebar_shell_present: collectorWindowState.sidebarShellPresent,
    sidebar_sections_stable: collectorWindowState.sidebarSectionsStable,
    mutation_count: collectorWindowState.mutationCount,
    mutation_quiet_ms: collectorWindowState.mutationQuietMs,
    root_url_verified: collectorWindowState.rootUrlVerified,
    root_navigation_generation: collectorWindowState.rootNavigationGeneration
  };
}

function markCollectorRequestMediumLost(tabId, windowId, reason) {
  for (const pending of contextRequests.values()) {
    if (!pending) continue;
    const sameTab = Number.isSafeInteger(tabId) && pending.tabId === tabId;
    const sameWindow = Number.isSafeInteger(windowId)
      && pending.collectorWindowId === windowId;
    if (!sameTab && !sameWindow) continue;
    pending.collectorMediumLost = true;
    pending.collectorMediumLossReason = reason || "collector_medium_lost";
    diagnostic("collector request medium lost", {
      request_id: pending.requestId,
      target_tab_id: tabId,
      event_window_id: windowId,
      status: "recoverable",
      error_code: pending.collectorMediumLossReason,
      stage: "collector_request_medium_lost"
    });
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

function createPendingHandoffSend(message, bridgeSocket, targetTab) {
  const operation = {
    requestId: message?.request_id,
    sessionId: message?.session_id,
    handoffId: message?.handoff_id,
    boundaryId: message?.boundary_id,
    handoffKind: message?.handoff_kind || null,
    bridgeSocket,
    targetTabId: targetTab?.id,
    executionWindowId: Number.isSafeInteger(targetTab?.windowId) ? targetTab.windowId : managedTabState.executionWindowId,
    targetTabUrl: typeof targetTab?.url === "string" ? targetTab.url : null,
    targetConversationId: safeContextIdentifier(message?.target_conversation_id),
    targetConversationUrl: safeChatGptContextUrl(message?.target_conversation_url),
    targetProjectId: safeContextIdentifier(message?.target_project_id),
    confirmation: deferred(),
    confirmed: false,
    recoveryInProgress: false,
    recoveryTimer: null,
    recoveryDeadline: Date.now() + HANDOFF_ACCEPTANCE_RETRY_TIMEOUT_MS
  };
  pendingHandoffSends.set(operation.requestId, operation);
  return operation;
}

function handoffMessageForPending(operation) {
  return {
    request_id: operation.requestId,
    session_id: operation.sessionId,
    handoff_id: operation.handoffId,
    boundary_id: operation.boundaryId,
    handoff_kind: operation.handoffKind
  };
}

function handoffAcceptanceCheckMessageForPending(operation) {
  return {
    type: HANDOFF_ACCEPTANCE_CHECK_MESSAGE_TYPE,
    requestId: operation.requestId,
    sessionId: operation.sessionId,
    handoffId: operation.handoffId,
    boundaryId: operation.boundaryId,
    protocol: HANDOFF_PROTOCOL,
    targetTabId: operation.targetTabId,
    ...(operation.handoffKind === "review" ? { review: true } : {})
  };
}

function resolvePendingHandoffConfirmation(pending, message, targetTabId, stage = "user_message_correlated") {
  if (pending.confirmed) return;
  pending.confirmed = true;
  if (pending.recoveryTimer !== null) {
    clearTimeout(pending.recoveryTimer);
    pending.recoveryTimer = null;
  }
  diagnostic("handoff confirmation received", {
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    status: "sent",
    stage,
    target_tab_id: targetTabId
  });
  const currentContext = normalizeCurrentContext(message?.current_context || message?.currentContext);
  if (currentContext?.conversation_id) pending.targetConversationId = currentContext.conversation_id;
  if (currentContext?.url) pending.targetConversationUrl = currentContext.url;
  if (currentContext?.project_id) pending.targetProjectId = currentContext.project_id;
  pending.confirmation.resolve({
    stage,
    current_context: currentContext
  });
}

function schedulePendingHandoffAcceptanceRecovery(pending) {
  if (!pending
    || pending.confirmed
    || pending.recoveryTimer !== null
    || pending.recoveryDeadline <= Date.now()) return;
  pending.recoveryTimer = setTimeout(() => {
    pending.recoveryTimer = null;
    if (pendingHandoffSends.get(pending.requestId) !== pending || pending.confirmed) return;
    void recoverPendingHandoffSendsForTab(pending.targetTabId);
  }, HANDOFF_ACCEPTANCE_RETRY_DELAY_MS);
}

async function handleHandoffSendConfirmedFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const sessionId = message?.sessionId || message?.session_id;
  const handoffId = message?.handoffId || message?.handoff_id;
  const boundaryId = message?.boundaryId || message?.boundary_id;
  const pending = pendingHandoffSends.get(requestId);
  const senderTabId = sender?.tab?.id;
  if (!pending
    || senderTabId !== pending.targetTabId
    || sessionId !== pending.sessionId
    || handoffId !== pending.handoffId
    || boundaryId !== pending.boundaryId
    || message?.status !== "sent") {
    diagnostic("handoff confirmation rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "handoff_confirmation_not_correlated",
      stage: "handoff_confirmation_context",
      target_tab_id: senderTabId
    });
    return { ok: false, error: "handoff_confirmation_not_correlated" };
  }

  resolvePendingHandoffConfirmation(
    pending,
    message,
    senderTabId,
    typeof message.stage === "string" ? message.stage : "user_message_correlated");
  return { ok: true };
}

async function recoverPendingHandoffSendsForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return;
  const pendingSends = [...pendingHandoffSends.values()]
    .filter((pending) => pending.targetTabId === tabId
      && !pending.confirmed
      && !pending.recoveryInProgress
      && pending.recoveryDeadline > Date.now());
  for (const pending of pendingSends) {
    if (pendingHandoffSends.get(pending.requestId) !== pending) continue;
    pending.recoveryInProgress = true;
    diagnostic("handoff acceptance check requested", {
      request_id: pending.requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId,
      status: "requested",
      stage: "handoff_acceptance_check_requested",
      target_tab_id: tabId
    });
    try {
      const checkResult = await dispatchToContentScript(
        tabId,
        handoffAcceptanceCheckMessageForPending(pending),
        handoffMessageForPending(pending));
      if (checkResult?.status === "sent"
        && checkResult.request_id === pending.requestId
        && checkResult.handoff_id === pending.handoffId) {
        resolvePendingHandoffConfirmation(pending, checkResult, tabId, "user_message_already_correlated");
        diagnostic("handoff acceptance recovered", {
          request_id: pending.requestId,
          session_id: pending.sessionId,
          handoff_id: pending.handoffId,
          boundary_id: pending.boundaryId,
          status: "sent",
          stage: "handoff_acceptance_recovered",
          target_tab_id: tabId
        });
      } else {
        diagnostic("handoff acceptance check pending", {
          request_id: pending.requestId,
          session_id: pending.sessionId,
          handoff_id: pending.handoffId,
          boundary_id: pending.boundaryId,
          status: "pending",
          error_code: checkResult?.error_code,
          stage: checkResult?.stage || "handoff_acceptance_not_found",
          target_tab_id: tabId
        });
        schedulePendingHandoffAcceptanceRecovery(pending);
      }
    } catch (error) {
      diagnostic("handoff acceptance check deferred", {
        request_id: pending.requestId,
        session_id: pending.sessionId,
        handoff_id: pending.handoffId,
        boundary_id: pending.boundaryId,
        status: "pending",
        error_code: isMissingContentScriptError(error) ? "content_script_unavailable" : "handoff_acceptance_check_failed",
        stage: error?.stage || "handoff_acceptance_check_dispatch",
        target_tab_id: tabId
      });
      schedulePendingHandoffAcceptanceRecovery(pending);
    } finally {
      pending.recoveryInProgress = false;
    }
  }
}

function handoffIdentityKey(message) {
  return [message?.session_id, message?.handoff_id, message?.boundary_id]
    .map((value) => String(value || ""))
    .join("|");
}

function getAcceptedHandoff(message) {
  const key = handoffIdentityKey(message);
  const accepted = acceptedHandoffs.get(key);
  if (!accepted) return null;
  if (accepted.expiresAt <= Date.now()) {
    acceptedHandoffs.delete(key);
    return null;
  }
  return accepted;
}

function rememberAcceptedHandoff(message, result) {
  acceptedHandoffs.set(handoffIdentityKey(message), {
    tabId: result.target_tab_id,
    targetTabUrl: result.target_tab_url || null,
    targetConversationId: result.target_conversation_id || message.target_conversation_id || null,
    targetConversationUrl: result.target_conversation_url || message.target_conversation_url || null,
    targetProjectId: result.target_project_id || message.target_project_id || null,
    expiresAt: Date.now() + HANDOFF_DELIVERY_CACHE_MS
  });
}

function forgetResponseWatchesForIdentity(message, exceptRequestId = null) {
  for (const [requestId, pending] of responseWatches) {
    if (requestId !== exceptRequestId
      && pending.sessionId === message?.session_id
      && pending.handoffId === message?.handoff_id
      && pending.boundaryId === message?.boundary_id) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      void dispatchToContentScript(
        pending.tabId,
        {
          type: "CANCEL_ASSISTANT_RESPONSE_WATCH",
          requestId: pending.requestId,
          sessionId: pending.sessionId,
          handoffId: pending.handoffId,
          boundaryId: pending.boundaryId
        },
        pending,
        { timeoutMs: 2000, timeoutStage: "response_watch_cancel" }).catch(() => {});
    }
  }
}

async function setState(patch) {
  state = { ...state, ...patch, bridgeUrl: BRIDGE_HTTP_ORIGIN };
  await chrome.storage.local.set({ bridgeState: state });
  notifyExtensionPages();
  return state;
}

function notifyExtensionPages() {
  try {
    chrome.runtime.sendMessage({ type: "BRIDGE_STATE_CHANGED", state }).catch(() => {});
  } catch (_) {
    // There may be no popup open. The state is persisted for the next popup.
  }

  // Content scripts never access localhost. They receive the same state from
  // the background service worker and can expose a future page-level hook.
  chrome.tabs.query({}).then((tabs) => {
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      chrome.tabs.sendMessage(tab.id, { type: "BRIDGE_STATE_CHANGED", state }).catch(() => {});
    }
  }).catch(() => {});
}

async function readJsonResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch (_) {
    body = null;
  }
  if (!response.ok) {
    const code = body?.error || `http_${response.status}`;
    throw bridgeError(`Desktop Bridge request failed (${response.status}).`, response.status, code);
  }
  return body;
}

async function fetchBridge(url, options) {
  try {
    return await fetch(url, options);
  } catch (_) {
    throw bridgeError("Desktop Connector is unavailable.", 0, "desktop_unavailable");
  }
}

async function fetchHealth() {
  const response = await fetchBridge(BRIDGE_HEALTH_URL, {
    method: "GET",
    credentials: "omit",
    cache: "no-store"
  });
  const health = await readJsonResponse(response);
  if (!health?.ok || health.protocol !== BRIDGE_PROTOCOL) {
    throw bridgeError("Desktop Bridge protocol is unavailable.", response.status, "invalid_protocol");
  }
  return health;
}

async function fetchPairing(pairingCode) {
  const response = await fetchBridge(BRIDGE_PAIR_URL, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
    },
    body: JSON.stringify({ pairing_code: pairingCode })
  });
  const result = await readJsonResponse(response);
  if (!result?.ok || result.protocol !== BRIDGE_PROTOCOL || !result.pairing_id || !result.pairing_credential) {
    throw bridgeError("Desktop Bridge pairing response is invalid.", response.status, "invalid_pairing_response");
  }
  return result;
}

async function fetchBootstrap(pairingCredential) {
  const response = await fetchBridge(BRIDGE_BOOTSTRAP_URL, {
    method: "POST",
    credentials: "omit",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${pairingCredential}`,
      [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
    }
  });
  const result = await readJsonResponse(response);
  if (!result?.ok || result.protocol !== BRIDGE_PROTOCOL || !result.session_token) {
    throw bridgeError("Desktop Bridge session bootstrap is invalid.", response.status, "invalid_bootstrap_response");
  }
  return result;
}

async function storePairing(result) {
  pairing = {
    pairingId: result.pairing_id,
    credential: result.pairing_credential
  };
  await chrome.storage.local.set({ [PAIRING_STORAGE_KEY]: pairing });
  await setState({ paired: true, pairingId: pairing.pairingId, lastError: null });
}

async function clearPairing() {
  pairing = { pairingId: null, credential: null };
  sessionToken = null;
  await chrome.storage.local.remove(PAIRING_STORAGE_KEY);
  await setState({ paired: false, pairingId: null, sessionExpiresAt: null });
}

function closePendingPings(error) {
  for (const [id, pending] of pendingPings) {
    clearTimeout(pending.timeout);
    pending.reject(error);
    pendingPings.delete(id);
  }
}

function stopSocketKeepalive(bridgeSocket = null) {
  // An old socket can close after a replacement connection is already live.
  // It must not clear the replacement socket's keepalive timer.
  if (bridgeSocket !== null && socketKeepaliveSocket !== bridgeSocket) return;
  if (socketKeepaliveTimer !== null) clearInterval(socketKeepaliveTimer);
  socketKeepaliveTimer = null;
  socketKeepaliveSocket = null;
}

function startSocketKeepalive(bridgeSocket) {
  if (socket !== bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) return;
  stopSocketKeepalive();
  socketKeepaliveSocket = bridgeSocket;
  socketKeepaliveTimer = setInterval(() => {
    if (socket !== bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      stopSocketKeepalive(bridgeSocket);
      return;
    }

    try {
      bridgeSocket.send(JSON.stringify({
        type: "ping",
        id: `keepalive-${crypto.randomUUID()}`
      }));
    } catch (_) {
      // The close handler will clear this timer and schedule the normal
      // reconnect path. Keepalive failures do not expose credentials or body.
      stopSocketKeepalive(bridgeSocket);
      try { bridgeSocket.close(); } catch (_) { }
    }
  }, SOCKET_KEEPALIVE_INTERVAL_MS);
}

function clearResponseWatchesForSocket(bridgeSocket, discard = false) {
  for (const [requestId, pending] of responseWatches) {
    if (pending.bridgeSocket !== bridgeSocket) continue;
    if (discard) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      continue;
    }
    // Keep the watcher alive across an automatic Bridge reconnect.  The
    // Content Script can still finish its observation, and the response will
    // be delivered through the next authenticated socket.
    pending.bridgeSocket = null;
    diagnostic("response watch bridge detached", {
      request_id: requestId,
      session_id: pending.sessionId,
      handoff_id: pending.handoffId,
      boundary_id: pending.boundaryId,
      status: "pending",
      stage: "response_watch_bridge_detached",
      target_tab_id: pending.targetTabId
    });
  }
}

function detachBridgeOutboxForSocket(bridgeSocket) {
  for (const pending of bridgeOutbox.values()) {
    if (pending.sentSocket === bridgeSocket) pending.sentSocket = null;
  }
}

function clearContextRequestsForSocket(bridgeSocket) {
  for (const [requestId, pending] of contextRequests) {
    if (pending.bridgeSocket === bridgeSocket) contextRequests.delete(requestId);
  }
}

function isChatGptUrlValue(value) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" && url.hostname === "chatgpt.com" && url.port === "";
  } catch (_) {
    return false;
  }
}

function isChatGptTab(tab) {
  return isChatGptUrlValue(tab?.url) || isChatGptUrlValue(tab?.pendingUrl);
}

function isPlaceholderExecutionTab(tab) {
  const candidates = [tab?.url, tab?.pendingUrl]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (candidates.length === 0) return true;
  return candidates.every((url) => {
    const lower = url.toLowerCase();
    return lower === "about:blank"
      || lower === "about:newtab"
      || lower.startsWith("chrome://newtab")
      || lower.startsWith("chrome://new-tab-page")
      || lower.startsWith("edge://newtab");
  });
}

function isCollectorReservedTab(tab) {
  return Boolean(tab && Number.isSafeInteger(tab.id) && tab.id === collectorWindowState.tabId);
}

function isOwnedManagedExecutionTab(tab) {
  if (!tab || !Number.isSafeInteger(tab.id) || tab.id < 0) return false;
  if (isCollectorReservedTab(tab)) return false;
  if (tab.id === managedTabState.tabId) return true;
  if (managedExecutionOwnedTabIds.has(tab.id)) return true;
  if (managedExecutionCreatedInitialTabIds.has(tab.id)) return true;
  for (const binding of managedExecutionRequestBindings.values()) {
    if (binding.targetTabId === tab.id) return true;
  }
  return false;
}

function isUsableManagedExecutionTab(tab, expectedWindowId = null) {
  if (!tab || !Number.isSafeInteger(tab.id) || tab.id < 0) return false;
  if (Number.isSafeInteger(expectedWindowId)
    && expectedWindowId >= 0
    && tab.windowId !== expectedWindowId) return false;
  return isChatGptTab(tab) || (isOwnedManagedExecutionTab(tab) && isPlaceholderExecutionTab(tab));
}

function stampManagedExecutionTab(tab, windowId) {
  if (!tab || !Number.isSafeInteger(tab.id) || tab.id < 0) return;
  managedExecutionOwnedTabIds.add(tab.id);
  managedTabState = {
    ...managedTabState,
    tabId: tab.id,
    executionWindowId: Number.isSafeInteger(windowId) ? windowId : (tab.windowId ?? managedTabState.executionWindowId)
  };
}

function rememberCreatedExecutionWindowTabs(windowId, tabs) {
  if (!Number.isSafeInteger(windowId) || windowId < 0 || !Array.isArray(tabs)) return;
  const ids = [];
  for (const tab of tabs) {
    if (!Number.isSafeInteger(tab?.id) || tab.id < 0) continue;
    managedExecutionCreatedInitialTabIds.add(tab.id);
    ids.push(tab.id);
  }
  if (ids.length > 0) managedExecutionWindowInitialTabs.set(windowId, ids);
}

function forgetManagedExecutionTabId(tabId) {
  if (!Number.isSafeInteger(tabId)) return;
  managedExecutionOwnedTabIds.delete(tabId);
  managedExecutionCreatedInitialTabIds.delete(tabId);
}

function chatGptConversationKey(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin}${pathname}`;
  } catch (_) {
    return null;
  }
}

function chatGptConversationId(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const segments = url.pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "c") continue;
      const id = decodeURIComponent(segments[index + 1]);
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : null;
    }
  } catch (_) { }
  return null;
}

function isSameChatGptConversation(actualUrl, expectedUrl, expectedConversationId = null) {
  if (expectedConversationId) {
    return chatGptConversationId(actualUrl) === expectedConversationId;
  }
  const actual = chatGptConversationKey(actualUrl);
  const expected = chatGptConversationKey(expectedUrl);
  return actual !== null && expected !== null && actual === expected;
}

function safeContextIdentifier(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(text) ? text : null;
}

function safeChatGptContextUrl(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    const canonical = `${url.origin}${pathname}`;
    return canonical.length <= 2048 ? canonical : null;
  } catch (_) {
    return null;
  }
}

function normalizeCurrentContext(value) {
  if (!value || typeof value !== "object") return null;
  const conversationId = safeContextIdentifier(value.conversation_id || value.conversationId);
  const projectId = safeContextIdentifier(value.project_id || value.projectId);
  const url = safeChatGptContextUrl(value.url || value.conversation_url || value.conversationUrl);
  const title = typeof (value.title || value.current_title) === "string"
    ? String(value.title || value.current_title).trim().slice(0, 512)
    : "";
  const projectTitle = typeof (value.project_title || value.projectTitle) === "string"
    ? String(value.project_title || value.projectTitle).trim().slice(0, 512)
    : "";
  return {
    ...(conversationId ? { conversation_id: conversationId } : {}),
    ...(title ? { title } : {}),
    ...(url ? { url } : {}),
    ...(projectId ? { project_id: projectId } : {}),
    ...(projectTitle ? { project_title: projectTitle } : {})
  };
}

function handoffResult(message, status, errorCode, text, stage, targetTab = null, currentContext = null) {
  const result = {
    type: "handoff.result",
    request_id: message?.request_id || "",
    handoff_id: message?.handoff_id || "",
    status
  };
  if (errorCode) result.error_code = errorCode;
  if (text) result.message = text;
  if (stage) result.stage = stage;
  if (status === "sent" && Number.isSafeInteger(targetTab?.id)) {
    result.target_tab_id = targetTab.id;
    if (typeof targetTab.url === "string" && targetTab.url.length <= 2048) result.target_tab_url = targetTab.url;
  }
  if (status === "sent") {
    const context = normalizeCurrentContext(currentContext);
    const requestedConversationId = safeContextIdentifier(message?.target_conversation_id);
    const requestedConversationUrl = safeChatGptContextUrl(message?.target_conversation_url);
    const requestedProjectId = safeContextIdentifier(message?.target_project_id);
    if (context?.conversation_id || requestedConversationId) {
      result.target_conversation_id = context?.conversation_id || requestedConversationId;
    }
    if (context?.url || requestedConversationUrl) {
      result.target_conversation_url = context?.url || requestedConversationUrl;
    }
    if (context?.project_id || requestedProjectId) {
      result.target_project_id = context?.project_id || requestedProjectId;
    }
  }
  return result;
}

function isMissingContentScriptError(error) {
  const text = error instanceof Error ? error.message : String(error || "");
  return text.includes("Receiving end does not exist")
    || text.includes("Could not establish connection")
    || text.includes("Extension context invalidated")
    // When a page navigation destroys a content-script listener after it has
    // clicked Send, Chrome reports a closed message port rather than a missing
    // receiver. Treat that as a lifecycle transition so dispatch can wait for
    // the replacement script and retry the same correlated operation.
    || text.includes("The message port closed before a response was received")
    || text.includes("the message channel closed before a response was received")
    || text.includes("message channel closed");
}

function sendMessageWithTimeout(
  tabId,
  message,
  timeoutMs = CONTENT_SCRIPT_TIMEOUT_MS,
  timeoutStage = "content_script_timeout") {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      const timeoutError = bridgeError("ChatGPT Content Script did not respond.", 0, "send_failed");
      timeoutError.stage = timeoutStage;
      finish(reject, timeoutError);
    }, timeoutMs);

    try {
      Promise.resolve(chrome.tabs.sendMessage(tabId, message))
        .then((value) => finish(resolve, value))
        .catch((error) => finish(reject, error));
    } catch (error) {
      finish(reject, error);
    }
  });
}

function waitForTabReady(
  tabId,
  timeoutMs = CONTENT_SCRIPT_READY_TIMEOUT_MS,
  timingPending = null) {
  if (!chrome.tabs?.get) return Promise.resolve(true);

  return new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let timeoutTimer = null;

    const cleanup = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      chrome.tabs.onUpdated?.removeListener?.(handleUpdated);
    };
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(ready);
    };
    const inspect = async () => {
      if (settled) return;
      let tab;
      try {
        tab = await chrome.tabs.get(tabId);
      } catch (_) {
        finish(false);
        return;
      }
      if (!tab) {
        finish(false);
        return;
      }
      // Test doubles and some Chromium implementations omit status.  In
      // that case the tab is already usable for the dispatch retry.  When
      // status is present, wait until the navigation is complete.
      if (typeof tab.status !== "string" || tab.status === "complete") {
        finish(true);
        return;
      }
      if (Date.now() >= deadline) {
        finish(false);
        return;
      }
      const pollScheduledAt = Date.now();
      pollTimer = setTimeout(() => {
        addCollectorProjectDiscoveryEfficiencyDuration(
          timingPending,
          "totalPollWaitMs",
          Math.max(0, Date.now() - pollScheduledAt));
        inspect();
      }, CONTENT_SCRIPT_READY_POLL_INTERVAL_MS);
    };
    const handleUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId || changeInfo?.status !== "complete") return;
      void inspect();
    };
    const deadline = Date.now() + timeoutMs;

    chrome.tabs.onUpdated?.addListener?.(handleUpdated);
    timeoutTimer = setTimeout(() => finish(false), timeoutMs);
    void inspect();
  });
}

function collectorWindowStorageTargets() {
  const targets = [];
  if (chrome.storage?.local) targets.push(chrome.storage.local);
  if (chrome.storage?.session && chrome.storage.session !== chrome.storage.local) {
    targets.push(chrome.storage.session);
  }
  return targets;
}

function persistedCollectorWindowRecord() {
  return {
    windowId: collectorWindowState.windowId,
    tabId: collectorWindowState.tabId,
    windowState: collectorWindowState.windowState,
    lifecycle: collectorWindowState.lifecycle,
    instanceId: collectorWindowState.instanceId,
    managedGeneration: Number.isSafeInteger(collectorWindowState.managedGeneration)
      ? collectorWindowState.managedGeneration
      : 0,
    managedAt: Number.isSafeInteger(collectorWindowState.managedAt)
      ? collectorWindowState.managedAt
      : 0
  };
}

function persistCollectorWindowState() {
  const stored = persistedCollectorWindowRecord();
  return Promise.all(collectorWindowStorageTargets().map((storage) =>
    storage.set({ [COLLECTOR_WINDOW_STORAGE_KEY]: stored }).catch(() => {})));
}

async function readPersistedCollectorWindowState() {
  let sessionValue = null;
  let localValue = null;
  try {
    const stored = await chrome.storage?.session?.get?.(COLLECTOR_WINDOW_STORAGE_KEY);
    if (stored?.[COLLECTOR_WINDOW_STORAGE_KEY] && typeof stored[COLLECTOR_WINDOW_STORAGE_KEY] === "object") {
      sessionValue = stored[COLLECTOR_WINDOW_STORAGE_KEY];
    }
  } catch (_) { }
  try {
    const stored = await chrome.storage?.local?.get?.(COLLECTOR_WINDOW_STORAGE_KEY);
    if (stored?.[COLLECTOR_WINDOW_STORAGE_KEY] && typeof stored[COLLECTOR_WINDOW_STORAGE_KEY] === "object") {
      localValue = stored[COLLECTOR_WINDOW_STORAGE_KEY];
    }
  } catch (_) { }
  const sessionHasId = Number.isSafeInteger(sessionValue?.windowId) || Number.isSafeInteger(sessionValue?.tabId);
  const localHasId = Number.isSafeInteger(localValue?.windowId) || Number.isSafeInteger(localValue?.tabId);
  if (sessionHasId) return sessionValue;
  if (localHasId) return localValue;
  return sessionValue || localValue || null;
}

function generateCollectorInstanceId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch (_) { }
  return `collector-${Date.now()}`;
}

function ensureCollectorInstanceId() {
  if (typeof collectorWindowState.instanceId === "string"
    && collectorWindowState.instanceId.length > 0) {
    return collectorWindowState.instanceId;
  }
  collectorWindowState = {
    ...collectorWindowState,
    instanceId: generateCollectorInstanceId()
  };
  void persistCollectorWindowState();
  return collectorWindowState.instanceId;
}

function collectorHandleFingerprint(windowId, tabId) {
  if (!Number.isSafeInteger(windowId) || !Number.isSafeInteger(tabId)) return "none";
  return `w:${windowId}:t:${tabId}`;
}

async function hydrateCollectorWindowState() {
  await collectorWindowStateReady;
  const stored = await readPersistedCollectorWindowState();
  if (!stored || typeof stored !== "object") {
    ensureCollectorInstanceId();
    return;
  }
  const memoryLost = !Number.isSafeInteger(collectorWindowState.windowId)
    && !Number.isSafeInteger(collectorWindowState.tabId);
  if (memoryLost) {
    collectorWindowState = { ...defaultCollectorWindowState, ...stored };
  } else {
    if (!collectorWindowState.instanceId && stored.instanceId) {
      collectorWindowState.instanceId = stored.instanceId;
    }
    if (!Number.isSafeInteger(collectorWindowState.managedGeneration)
      && Number.isSafeInteger(stored.managedGeneration)) {
      collectorWindowState.managedGeneration = stored.managedGeneration;
    }
  }
  ensureCollectorInstanceId();
}

async function getChromeWindowById(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId < 0 || typeof chrome.windows?.get !== "function") {
    return null;
  }
  try {
    const window = await chrome.windows.get(windowId);
    if (!window || (window.type && window.type !== "normal")) return null;
    return window;
  } catch (_) {
    return null;
  }
}

async function getChromeTabById(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0 || typeof chrome.tabs?.get !== "function") return null;
  try {
    return await chrome.tabs.get(tabId);
  } catch (_) {
    return null;
  }
}

function normalizeChromeWindowState(state) {
  if (state === "normal" || state === "minimized" || state === "maximized" || state === "fullscreen") {
    return state;
  }
  return "unknown";
}

function normalizeCollectorTabStatus(status) {
  if (status === "loading" || status === "complete") return status;
  return "unknown";
}

function normalizeDocumentVisibilityState(value) {
  if (value === "visible" || value === "hidden" || value === "prerender") return value;
  return "unknown";
}

async function snapshotCollectorChromePresentation() {
  const window = await getChromeWindowById(collectorWindowState.windowId);
  const tab = await getChromeTabById(collectorWindowState.tabId);
  return {
    windowState: normalizeChromeWindowState(window?.state),
    focused: window?.focused === true,
    tabActive: tab?.active === true,
    discarded: tab?.discarded === true,
    tabStatus: normalizeCollectorTabStatus(tab?.status)
  };
}

function collectorEfficiencyFromTrace(trace = {}) {
  return collectorProjectDiscoveryEfficiencyForRequest(trace.request_id || collectorWindowState.requestId);
}

function noteCollectorWindowState(efficiency, windowState) {
  if (!efficiency) return;
  const normalized = normalizeChromeWindowState(windowState);
  if (efficiency.lastObservedCollectorWindowState
    && efficiency.lastObservedCollectorWindowState !== normalized) {
    efficiency.collectorWindowStateChangeCount += 1;
  }
  efficiency.lastObservedCollectorWindowState = normalized;
  if (normalized === "minimized") efficiency.collectorWindowMinimizedDuringCollection = true;
}

async function recordCollectorPresentationPhase(phase, trace = {}, snapshot = null) {
  const efficiency = collectorEfficiencyFromTrace(trace);
  const observed = snapshot || await snapshotCollectorChromePresentation();
  noteCollectorWindowState(efficiency, observed.windowState);
  if (efficiency && phase === "creation") {
    efficiency.collectorWindowStateAtCreation = observed.windowState;
    efficiency.collectorWindowFocusedAtCreation = observed.focused === true;
    efficiency.collectorTabActiveAtCreation = observed.tabActive === true;
  }
  if (efficiency && phase === "collection_start") {
    efficiency.collectorWindowStateAtCollectionStart = observed.windowState;
    efficiency.collectorWindowFocusedAtCollectionStart = observed.focused === true;
    efficiency.collectorTabActiveAtCollectionStart = observed.tabActive === true;
    efficiency.collectorTabDiscardedAtCollectionStart = observed.discarded === true;
    efficiency.collectorTabStatusAtCollectionStart = observed.tabStatus;
  }
  if (efficiency && phase === "collection_end") {
    efficiency.collectorWindowStateAtCollectionEnd = observed.windowState;
    efficiency.collectorWindowFocusedAtCollectionEnd = observed.focused === true;
    efficiency.collectorTabActiveAtCollectionEnd = observed.tabActive === true;
  }
  diagnostic("collector window presentation", {
    ...trace,
    stage: `collector_window_presentation_${phase}`,
    collector_window_state: observed.windowState,
    collector_window_focused: observed.focused === true,
    collector_tab_active: observed.tabActive === true,
    collector_tab_discarded: observed.discarded === true,
    collector_tab_status: observed.tabStatus,
    collector_window_state_change_count: efficiency?.collectorWindowStateChangeCount || 0,
    collector_window_unminimized_by_connector: efficiency?.collectorWindowUnminimizedByConnector === true,
    collector_window_minimized_during_collection: efficiency?.collectorWindowMinimizedDuringCollection === true,
    status: "observed"
  });
  return observed;
}

function normalizeCollectorIdentity(value) {
  if (!value || typeof value !== "object") return null;
  const role = value.collector_role || value.collectorRole;
  if (role !== "collector") return null;
  const instanceId = typeof (value.collector_instance_id || value.instanceId) === "string"
    ? String(value.collector_instance_id || value.instanceId).slice(0, 128)
    : "";
  if (!instanceId) return null;
  const managedGeneration = Number.isSafeInteger(value.collector_managed_generation)
    ? value.collector_managed_generation
    : (Number.isSafeInteger(value.managedGeneration) ? value.managedGeneration : 0);
  const managedAt = Number.isSafeInteger(value.collector_managed_at)
    ? value.collector_managed_at
    : (Number.isSafeInteger(value.managedAt) ? value.managedAt : 0);
  return { instanceId, managedGeneration, managedAt };
}

async function queryCollectorTabIdentity(tabId) {
  if (!Number.isSafeInteger(tabId) || typeof chrome.tabs?.sendMessage !== "function") return null;
  try {
    const result = await chrome.tabs.sendMessage(tabId, { type: COLLECTOR_IDENTITY_MESSAGE_GET });
    return normalizeCollectorIdentity(result);
  } catch (_) {
    return null;
  }
}

async function stampCollectorTabIdentity(tab) {
  if (!tab || !Number.isSafeInteger(tab.id)) return null;
  const instanceId = ensureCollectorInstanceId();
  const managedGeneration = Math.max(1, (Number(collectorWindowState.managedGeneration) || 0) + 1);
  const managedAt = Date.now();
  collectorWindowState = {
    ...collectorWindowState,
    windowId: Number.isSafeInteger(tab.windowId) ? tab.windowId : collectorWindowState.windowId,
    tabId: tab.id,
    instanceId,
    managedGeneration,
    managedAt
  };
  void persistCollectorWindowState();
  if (typeof chrome.tabs?.sendMessage === "function") {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: COLLECTOR_IDENTITY_MESSAGE_SET,
        collector_role: "collector",
        collector_instance_id: instanceId,
        collector_managed_generation: managedGeneration,
        collector_managed_at: managedAt
      });
    } catch (_) { }
  }
  return { instanceId, managedGeneration, managedAt };
}

async function listCollectorCandidateWindows() {
  if (typeof chrome.windows?.getAll !== "function") return [];
  try {
    const windows = await chrome.windows.getAll();
    return Array.isArray(windows) ? windows.filter((window) => !window?.type || window.type === "normal") : [];
  } catch (_) {
    return [];
  }
}

async function discoverMarkedCollectorCandidates() {
  const windows = await listCollectorCandidateWindows();
  const candidates = [];
  let focusedCount = 0;
  let activeCount = 0;
  for (const window of windows) {
    if (window?.focused === true) focusedCount += 1;
    const tabs = Array.isArray(window?.tabs) ? window.tabs : await tabsInCollectorWindow(window?.id);
    for (const tab of tabs) {
      if (tab?.active === true) activeCount += 1;
      if (!isChatGptTab(tab) && !(typeof tab?.url === "string" && tab.url.startsWith("https://chatgpt.com"))) {
        continue;
      }
      const identity = await queryCollectorTabIdentity(tab.id);
      if (!identity) continue;
      candidates.push({
        window,
        tab,
        identity,
        focused: window?.focused === true,
        active: tab?.active === true,
        minimized: window?.state === "minimized"
      });
    }
  }
  return { windows, candidates, focusedCount, activeCount };
}

function selectMarkedCollectorCandidate(candidates, persistedTabId, persistedWindowId, instanceId) {
  const marked = Array.isArray(candidates) ? [...candidates] : [];
  if (marked.length === 0) return { selected: null, reason: "no_existing_collector", duplicateCount: 0 };
  const matchingInstance = instanceId
    ? marked.filter((item) => item.identity?.instanceId === instanceId)
    : marked;
  const pool = matchingInstance.length > 0 ? matchingInstance : marked;
  if (pool.length === 0) {
    return { selected: null, reason: "no_existing_collector", duplicateCount: 0 };
  }
  const persisted = pool.find((item) => item.tab?.id === persistedTabId)
    || pool.find((item) => item.window?.id === persistedWindowId);
  if (persisted) {
    return {
      selected: persisted,
      reason: "recovered_marker",
      duplicateCount: pool.length
    };
  }
  pool.sort((left, right) => {
    const generationDelta = (right.identity?.managedGeneration || 0) - (left.identity?.managedGeneration || 0);
    if (generationDelta !== 0) return generationDelta;
    const managedAtDelta = (right.identity?.managedAt || 0) - (left.identity?.managedAt || 0);
    if (managedAtDelta !== 0) return managedAtDelta;
    const windowDelta = (right.window?.id || 0) - (left.window?.id || 0);
    if (windowDelta !== 0) return windowDelta;
    return (right.tab?.id || 0) - (left.tab?.id || 0);
  });
  const uniqueTop = pool.length === 1
    || (pool[0].identity?.managedGeneration || 0) !== (pool[1].identity?.managedGeneration || 0)
    || (pool[0].identity?.managedAt || 0) !== (pool[1].identity?.managedAt || 0);
  if (!uniqueTop) {
    return { selected: null, reason: "ambiguous_existing_collectors", duplicateCount: pool.length };
  }
  return {
    selected: pool[0],
    reason: pool.length > 1 ? "recovered_marker" : "recovered_handshake",
    duplicateCount: pool.length
  };
}

function emptyCollectorResolution(fields = {}) {
  return {
    window: null,
    tab: null,
    reason: "no_existing_collector",
    foundByPersistedId: false,
    foundByMarker: false,
    foundByHandshake: false,
    persistedWindowIdPresent: false,
    persistedTabIdPresent: false,
    persistedWindowIdValid: false,
    persistedTabIdValid: false,
    candidateWindowCount: 0,
    candidateTabCount: 0,
    candidateFocusedCount: 0,
    candidateActiveCount: 0,
    duplicateCount: 0,
    focusRequiredForMatch: false,
    activeRequiredForMatch: false,
    ...fields
  };
}

async function resolveExistingCollector() {
  const persistedWindowId = collectorWindowState.windowId;
  const persistedTabId = collectorWindowState.tabId;
  const instanceId = collectorWindowState.instanceId;
  const persistedWindowIdPresent = Number.isSafeInteger(persistedWindowId);
  const persistedTabIdPresent = Number.isSafeInteger(persistedTabId);
  const persistedWindow = persistedWindowIdPresent ? await getChromeWindowById(persistedWindowId) : null;
  const persistedTab = persistedTabIdPresent ? await getChromeTabById(persistedTabId) : null;
  const persistedWindowIdValid = Boolean(persistedWindow);
  const persistedTabIdValid = Boolean(persistedTab)
    && (!persistedWindowIdValid || persistedTab.windowId === persistedWindow.id);

  if (persistedWindowIdValid && persistedTabIdValid) {
    return emptyCollectorResolution({
      window: persistedWindow,
      tab: persistedTab,
      reason: "persisted_id",
      foundByPersistedId: true,
      persistedWindowIdPresent,
      persistedTabIdPresent,
      persistedWindowIdValid,
      persistedTabIdValid
    });
  }

  if (persistedWindowIdValid) {
    const tabs = await tabsInCollectorWindow(persistedWindow.id);
    const preferred = await chooseCollectorTab(tabs, persistedTabId);
    return emptyCollectorResolution({
      window: persistedWindow,
      tab: preferred,
      reason: persistedTabIdPresent && !persistedTabIdValid ? "stale_persisted_id" : "persisted_id",
      foundByPersistedId: true,
      persistedWindowIdPresent,
      persistedTabIdPresent,
      persistedWindowIdValid,
      persistedTabIdValid,
      candidateWindowCount: 1,
      candidateTabCount: tabs.length
    });
  }

  const discovered = await discoverMarkedCollectorCandidates();
  const selection = selectMarkedCollectorCandidate(
    discovered.candidates,
    persistedTabId,
    persistedWindowId,
    instanceId);
  const base = {
    persistedWindowIdPresent,
    persistedTabIdPresent,
    persistedWindowIdValid,
    persistedTabIdValid,
    candidateWindowCount: discovered.windows.length,
    candidateTabCount: discovered.candidates.length,
    candidateFocusedCount: discovered.focusedCount,
    candidateActiveCount: discovered.activeCount,
    duplicateCount: selection.duplicateCount,
    foundByMarker: selection.reason === "recovered_marker",
    foundByHandshake: selection.reason === "recovered_handshake"
      || selection.reason === "recovered_marker"
  };
  if (!selection.selected) {
    const reason = selection.reason === "ambiguous_existing_collectors"
      ? "ambiguous_existing_collectors"
      : (persistedWindowIdPresent || persistedTabIdPresent
        ? "stale_persisted_id"
        : selection.reason);
    return emptyCollectorResolution({
      ...base,
      reason
    });
  }
  return emptyCollectorResolution({
    ...base,
    window: selection.selected.window,
    tab: selection.selected.tab,
    reason: selection.reason
  });
}

function recordCollectorWindowResolution(resolution, trace = {}, created = false, reused = false) {
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(trace.request_id);
  const fingerprintWindow = collectorHandleFingerprint(
    resolution?.window?.id || collectorWindowState.windowId,
    resolution?.tab?.id || collectorWindowState.tabId);
  if (efficiency) {
    efficiency.persistedWindowIdPresent = resolution.persistedWindowIdPresent === true;
    efficiency.persistedTabIdPresent = resolution.persistedTabIdPresent === true;
    efficiency.persistedWindowIdValid = resolution.persistedWindowIdValid === true;
    efficiency.persistedTabIdValid = resolution.persistedTabIdValid === true;
    efficiency.collectorFoundByPersistedId = resolution.foundByPersistedId === true;
    efficiency.collectorFoundByMarker = resolution.foundByMarker === true;
    efficiency.collectorFoundByHandshake = resolution.foundByHandshake === true;
    efficiency.collectorCandidateWindowCount = Number(resolution.candidateWindowCount) || 0;
    efficiency.collectorCandidateTabCount = Number(resolution.candidateTabCount) || 0;
    efficiency.collectorCandidateFocusedCount = Number(resolution.candidateFocusedCount) || 0;
    efficiency.collectorCandidateActiveCount = Number(resolution.candidateActiveCount) || 0;
    efficiency.duplicateCollectorCandidateCount = Number(resolution.duplicateCount) || 0;
    efficiency.collectorFocusRequiredForMatch = false;
    efficiency.collectorActiveRequiredForMatch = false;
    efficiency.collectorResolutionReason = resolution.reason || (created ? "no_existing_collector" : "persisted_id");
    efficiency.selectedCollectorWindowFingerprint = fingerprintWindow;
    efficiency.selectedCollectorTabFingerprint = fingerprintWindow;
    if (created) {
      efficiency.collectorWindowCreated = true;
      efficiency.collectorTabCreated = true;
      efficiency.collectorCreationReason = "missing_collector_window";
    } else if (reused) {
      efficiency.collectorTabReused = true;
    }
  }
  diagnostic("collector window resolution summary", {
    ...trace,
    trigger_source: efficiency?.collectionTriggerSource || trace.collection_trigger || "none",
    persisted_window_id_present: resolution.persistedWindowIdPresent === true,
    persisted_tab_id_present: resolution.persistedTabIdPresent === true,
    persisted_window_id_valid: resolution.persistedWindowIdValid === true,
    persisted_tab_id_valid: resolution.persistedTabIdValid === true,
    collector_candidate_window_count: Number(resolution.candidateWindowCount) || 0,
    collector_candidate_tab_count: Number(resolution.candidateTabCount) || 0,
    collector_found_by_persisted_id: resolution.foundByPersistedId === true,
    collector_found_by_marker: resolution.foundByMarker === true,
    collector_found_by_handshake: resolution.foundByHandshake === true,
    collector_candidate_focused_count: Number(resolution.candidateFocusedCount) || 0,
    collector_candidate_active_count: Number(resolution.candidateActiveCount) || 0,
    collector_reused: reused === true,
    collector_created: created === true,
    collector_resolution_reason: resolution.reason || (created ? "no_existing_collector" : "persisted_id"),
    collector_focus_required_for_match: false,
    collector_active_required_for_match: false,
    duplicate_collector_candidate_count: Number(resolution.duplicateCount) || 0,
    selected_collector_window_fingerprint: fingerprintWindow,
    selected_collector_tab_fingerprint: fingerprintWindow,
    status: "observed",
    stage: "collector_window_resolution_summary",
    target_tab_id: resolution?.tab?.id || collectorWindowState.tabId,
    window_id: resolution?.window?.id || collectorWindowState.windowId
  });
}

function collectorWindowLifecycle(lifecycle, fields = {}) {
  collectorWindowState = {
    ...collectorWindowState,
    lifecycle,
    ...fields
  };
  void persistCollectorWindowState();
  diagnostic("collector window lifecycle", {
    lifecycle,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    project_discovery_source: collectorWindowState.projectDiscoverySource,
    current_project_id: collectorWindowState.currentProjectId,
    current_project_url: collectorWindowState.currentProjectUrl,
    collector_navigation_target: collectorWindowState.collectorNavigationTarget,
    project_index: collectorWindowState.projectIndex,
    total_projects: collectorWindowState.totalProjects,
    discovered_project_count: collectorWindowState.discoveredProjectCount,
    discovered_chat_count: collectorWindowState.discoveredChatCount,
    collector_final_project_count: collectorWindowState.discoveredProjectCount,
    collector_final_chat_count: collectorWindowState.discoveredChatCount,
    retry_count: collectorWindowState.retryCount,
    project_discovery_retry_count: collectorWindowState.projectDiscoveryRetryCount,
    refresh_generation: collectorWindowState.refreshGeneration,
    project_discovery_run_id: collectorWindowState.projectDiscoveryRunId,
    project_discovery_call_count: collectorWindowState.projectDiscoveryCallCount,
    project_discovery_started: collectorWindowState.projectDiscoveryStarted,
    project_discovery_completed: collectorWindowState.projectDiscoveryCompleted,
    project_discovery_scan_completed: collectorWindowState.projectDiscoveryScanCompleted,
    project_discovery_caller: collectorWindowState.projectDiscoveryCaller,
    project_discovery_in_flight: collectorWindowState.projectDiscoveryInFlight,
    project_discovery_already_completed: collectorWindowState.projectDiscoveryAlreadyCompleted,
    project_discovery_scroll_direction: collectorWindowState.projectDiscoveryScrollDirection,
    project_discovery_restore_count: collectorWindowState.projectDiscoveryRestoreCount,
    project_identity_resolution_started: collectorWindowState.projectIdentityResolutionStarted,
    project_identity_resolution_completed: collectorWindowState.projectIdentityResolutionCompleted,
    non_navigation_resolved_count: collectorWindowState.nonNavigationResolvedCount,
    navigation_resolved_count: collectorWindowState.navigationResolvedCount,
    unresolved_count: collectorWindowState.identityUnresolvedCount,
    current_project_index: collectorWindowState.currentProjectIndex,
    resolution_method: collectorWindowState.identityResolutionMethod,
    navigation_target_verified: collectorWindowState.navigationTargetVerified,
    project_url_pattern_valid: collectorWindowState.projectUrlPatternValid,
    project_id_url_match: collectorWindowState.projectIdUrlMatch,
    root_hydration_started: collectorWindowState.rootHydrationStarted,
    root_hydration_completed: collectorWindowState.rootHydrationCompleted,
    root_hydration_timeout: collectorWindowState.rootHydrationTimeout,
    hydration_wait_ms: collectorWindowState.hydrationWaitMs,
    document_ready_state: collectorWindowState.documentReadyState,
    sidebar_root_present: collectorWindowState.sidebarRootPresent,
    sidebar_scroll_container_present: collectorWindowState.sidebarScrollContainerPresent,
    sidebar_shell_present: collectorWindowState.sidebarShellPresent,
    sidebar_sections_stable: collectorWindowState.sidebarSectionsStable,
    mutation_count: collectorWindowState.mutationCount,
    mutation_quiet_ms: collectorWindowState.mutationQuietMs,
    root_url_verified: collectorWindowState.rootUrlVerified,
    root_navigation_generation: collectorWindowState.rootNavigationGeneration,
    collector_window_width: collectorWindowState.windowWidth,
    collector_window_height: collectorWindowState.windowHeight,
    collector_content_inner_width: collectorWindowState.contentInnerWidth,
    collector_content_inner_height: collectorWindowState.contentInnerHeight,
    sidebar_expected_visible: collectorWindowState.sidebarExpectedVisible,
    viewport_retry_count: collectorWindowState.viewportRetryCount,
    active_tab_id_in_collector_window: collectorWindowState.activeTabIdInWindow,
    collector_tab_active: collectorWindowState.collectorTabActive,
    tab_count_in_collector_window: collectorWindowState.tabCountInWindow,
    sidebar_scroll_top: collectorWindowState.sidebarScrollTop,
    sidebar_scroll_height: collectorWindowState.sidebarScrollHeight,
    sidebar_client_height: collectorWindowState.sidebarClientHeight,
    sidebar_can_scroll: collectorWindowState.sidebarCanScroll,
    sidebar_at_bottom: collectorWindowState.sidebarAtBottom,
    visible_project_rows: collectorWindowState.visibleProjectRows,
    project_section_found: collectorWindowState.projectSectionFound,
    no_growth_count: collectorWindowState.noGrowthCount,
    status: lifecycle === "Failed" ? "error" : "pending",
    stage: `collector_window_${String(lifecycle || "unknown").toLowerCase()}`,
    target_tab_id: collectorWindowState.tabId,
    window_id: collectorWindowState.windowId
  });
}

function positiveDimension(value) {
  const dimension = Number(value);
  return Number.isSafeInteger(dimension) && dimension > 0 ? dimension : null;
}

function collectorTabTopology(tabs, collectorTab) {
  const members = Array.isArray(tabs) ? tabs : [];
  const activeTab = members.find((tab) => tab?.active === true) || null;
  const activeTabId = Number.isSafeInteger(activeTab?.id) ? activeTab.id : null;
  const collectorTabId = Number.isSafeInteger(collectorTab?.id) ? collectorTab.id : null;
  return {
    activeTabId,
    collectorTabId,
    collectorTabActive: collectorTabId !== null
      && activeTabId === collectorTabId
      && collectorTab?.active === true,
    tabCount: members.length
  };
}

function recordCollectorTabTopology(windowId, tabs, collectorTab, trace = {}) {
  const topology = collectorTabTopology(tabs, collectorTab);
  collectorWindowState = {
    ...collectorWindowState,
    windowId: Number.isSafeInteger(windowId) ? windowId : collectorWindowState.windowId,
    tabId: topology.collectorTabId,
    activeTabIdInWindow: topology.activeTabId,
    collectorTabActive: topology.collectorTabActive,
    tabCountInWindow: topology.tabCount
  };
  const valid = topology.collectorTabId !== null;
  const signature = [
    collectorWindowState.windowId,
    topology.collectorTabId,
    topology.activeTabId,
    topology.collectorTabActive,
    topology.tabCount
  ].join(":");
  if (signature !== lastCollectorTabTopologyTelemetrySignature) {
    lastCollectorTabTopologyTelemetrySignature = signature;
    diagnostic("collector tab topology observed", {
      ...trace,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: topology.collectorTabId,
      active_tab_id_in_collector_window: topology.activeTabId,
      collector_tab_active: topology.collectorTabActive,
      tab_count_in_collector_window: topology.tabCount,
      collector_window_exists: Number.isSafeInteger(collectorWindowState.windowId),
      status: valid ? "observed" : "error",
      error_code: valid ? undefined : "collector_tab_topology_invalid",
      stage: "collector_tab_topology"
    });
  }
  void persistCollectorWindowState();
  return valid;
}

async function chooseCollectorTab(tabs, preferredTabId = null) {
  const members = Array.isArray(tabs) ? tabs : [];
  const executionTabId = managedTabState.tabId;
  const eligible = members.filter((tab) => !Number.isSafeInteger(executionTabId) || tab?.id !== executionTabId);
  const preferred = eligible.find((tab) => tab?.id === preferredTabId)
    || eligible.find((tab) => tab?.id === collectorWindowState.tabId);
  if (preferred) return preferred;
  for (const tab of eligible) {
    if (!Number.isSafeInteger(tab?.id)) continue;
    const identity = await queryCollectorTabIdentity(tab.id);
    if (identity) return tab;
  }
  return null;
}

async function reconcileCollectorWindowTabs(windowId, preferredTabId = null, trace = {}) {
  const tabs = await tabsInCollectorWindow(windowId);
  const collectorTab = await chooseCollectorTab(tabs, preferredTabId);
  recordCollectorTabTopology(windowId, tabs, collectorTab, trace);
  if (collectorTab && Number.isSafeInteger(collectorTab.id)) {
    collectorWindowState = {
      ...collectorWindowState,
      windowId,
      tabId: collectorTab.id
    };
  }
  return collectorTab;
}

function queueCollectorTabTopologyRepair(trace = {}) {
  if (!Number.isSafeInteger(collectorWindowState.windowId)) return Promise.resolve(null);
  if (connectorManagedWindowEnsureInFlight
    || managedExecutionWindowEnsureInFlight
    || managedExecutionTabEnsureInFlight
    || managedExecutionTabCreateInFlight) {
    return Promise.resolve(null);
  }
  return withCollectorWindowOperation(async () => {
    const window = await getCollectorWindow();
    if (!window) return null;
    const tab = await reconcileCollectorWindowTabs(
      window.id,
      collectorWindowState.tabId,
      trace);
    if (!tab) {
      if (collectorWindowState.lifecycle !== "Recoverable"
        && !Number.isSafeInteger(collectorWindowState.tabId)) {
        return null;
      }
      return await ensureCollectorWindow(COLLECTOR_TAB_URL, {
        ...trace,
        stage: "collector_tab_topology_recreate"
      });
    }
    if (collectorTabNeedsRecovery(tab)) {
      await replaceCollectorTab(tab, trace);
      return await ensureCollectorWindow(COLLECTOR_TAB_URL, {
        ...trace,
        stage: "collector_tab_topology_recovery"
      });
    }
    const enforced = await enforceCollectorTab(tab, trace, { activate: false });
    recordCollectorTabTopology(
      window.id,
      await tabsInCollectorWindow(window.id),
      enforced,
      trace);
    return enforced;
  }).catch((error) => {
    diagnostic("collector tab topology repair failed", {
      ...trace,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      status: "error",
      error_code: error?.code || "collector_tab_topology_repair_failed",
      stage: error?.stage || "collector_tab_topology_repair"
    });
    return null;
  });
}

function recordCollectorViewportTelemetry(window, viewport, viewportRetryCount, trace = {}) {
  const windowWidth = positiveDimension(window?.width);
  const windowHeight = positiveDimension(window?.height);
  const contentInnerWidth = positiveDimension(viewport?.content_inner_width);
  const contentInnerHeight = positiveDimension(viewport?.content_inner_height);
  const sidebarExpectedVisible = viewport?.sidebar_expected_visible === true
    && contentInnerWidth !== null
    && contentInnerWidth >= COLLECTOR_CONTENT_MIN_WIDTH;
  collectorWindowState = {
    ...collectorWindowState,
    windowWidth,
    windowHeight,
    contentInnerWidth,
    contentInnerHeight,
    sidebarExpectedVisible,
    viewportRetryCount: Math.max(0, Number.isSafeInteger(viewportRetryCount) ? viewportRetryCount : 0)
  };
  diagnostic("collector viewport observed", {
    ...trace,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    collector_window_width: windowWidth,
    collector_window_height: windowHeight,
    collector_content_inner_width: contentInnerWidth,
    collector_content_inner_height: contentInnerHeight,
    sidebar_expected_visible: sidebarExpectedVisible,
    viewport_retry_count: collectorWindowState.viewportRetryCount,
    sidebar_container_exists: viewport?.sidebar_container_exists === true,
    project_section_exists: viewport?.project_section_exists === true,
    project_row_locator_ready: viewport?.project_row_locator_ready === true,
    desktop_layout: viewport?.desktop_layout === true,
    sidebar_ready: viewport?.sidebar_ready === true,
    sidebar_scroll_container_found: viewport?.sidebar_scroll_container_found === true,
    status: "observed",
    stage: "collector_viewport_observed",
    target_tab_id: collectorWindowState.tabId,
    window_id: collectorWindowState.windowId
  });
  void persistCollectorWindowState();
}

function recordCollectorRootHydrationTelemetry(source, pending = null, trace = {}) {
  const integerOrZero = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
  const navigationGeneration = typeof trace.root_navigation_generation === "string"
    ? trace.root_navigation_generation
    : (typeof source?.navigation_generation === "string"
      ? source.navigation_generation : collectorWindowState.rootNavigationGeneration);
  collectorWindowState = {
    ...collectorWindowState,
    rootHydrationStarted: trace.root_hydration_started !== undefined
      ? trace.root_hydration_started === true
      : source?.root_hydration_started === true
        || collectorWindowState.rootHydrationStarted,
    rootHydrationCompleted: trace.root_hydration_completed !== undefined
      ? trace.root_hydration_completed === true
      : source?.root_hydration_completed === true,
    rootHydrationTimeout: trace.root_hydration_timeout !== undefined
      ? trace.root_hydration_timeout === true
      : source?.root_hydration_timeout === true,
    hydrationWaitMs: integerOrZero(trace.hydration_wait_ms ?? source?.hydration_wait_ms),
    documentReadyState: typeof (trace.document_ready_state || source?.document_ready_state) === "string"
      ? String(trace.document_ready_state || source.document_ready_state).slice(0, 128)
      : collectorWindowState.documentReadyState,
    sidebarRootPresent: trace.sidebar_root_present !== undefined
      ? trace.sidebar_root_present === true
      : source?.sidebar_root_present === true,
    sidebarScrollContainerPresent: trace.sidebar_scroll_container_present !== undefined
      ? trace.sidebar_scroll_container_present === true
      : source?.sidebar_scroll_container_present === true,
    sidebarShellPresent: trace.sidebar_shell_present !== undefined
      ? trace.sidebar_shell_present === true
      : source?.sidebar_shell_present === true,
    sidebarSectionsStable: trace.sidebar_sections_stable !== undefined
      ? trace.sidebar_sections_stable === true
      : source?.sidebar_sections_stable === true,
    mutationCount: integerOrZero(trace.mutation_count ?? source?.mutation_count),
    mutationQuietMs: integerOrZero(trace.mutation_quiet_ms ?? source?.mutation_quiet_ms),
    rootUrlVerified: trace.root_url_verified !== undefined
      ? trace.root_url_verified === true
      : source?.root_url_verified === true,
    rootNavigationGeneration: navigationGeneration || collectorWindowState.rootNavigationGeneration
  };
  diagnostic("collector root hydration", {
    ...trace,
    request_id: pending?.requestId || trace.request_id,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId || collectorWindowState.tabId,
    root_hydration_started: collectorWindowState.rootHydrationStarted,
    root_hydration_completed: collectorWindowState.rootHydrationCompleted,
    root_hydration_timeout: collectorWindowState.rootHydrationTimeout,
    hydration_wait_ms: collectorWindowState.hydrationWaitMs,
    hydration_poll_count: source?.hydration_poll_count,
    hydration_poll_wait_ms: source?.hydration_poll_wait_ms,
    hydration_poll_interval_ms: source?.hydration_poll_interval_ms,
    document_ready_state: collectorWindowState.documentReadyState,
    sidebar_root_present: collectorWindowState.sidebarRootPresent,
    sidebar_scroll_container_present: collectorWindowState.sidebarScrollContainerPresent,
    sidebar_shell_present: collectorWindowState.sidebarShellPresent,
    sidebar_sections_stable: collectorWindowState.sidebarSectionsStable,
    mutation_count: collectorWindowState.mutationCount,
    mutation_quiet_ms: collectorWindowState.mutationQuietMs,
    root_url_verified: collectorWindowState.rootUrlVerified,
    expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
    root_navigation_generation: collectorWindowState.rootNavigationGeneration,
    status: trace.status || (collectorWindowState.rootHydrationCompleted ? "completed" : "waiting"),
    stage: trace.stage || "collector_root_hydration",
    target_tab_id: pending?.tabId || collectorWindowState.tabId
  });
  return collectorWindowState;
}

function recordCollectorScrollTelemetry(source, pending = null, trace = {}) {
  const integerOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const targetTabId = Number.isSafeInteger(pending?.tabId)
    ? pending.tabId
    : collectorWindowState.tabId;
  const sidebarScrollTop = integerOrNull(source?.sidebar_scroll_top);
  const sidebarScrollHeight = integerOrNull(source?.sidebar_scroll_height);
  const sidebarClientHeight = integerOrNull(source?.sidebar_client_height);
  const visibleProjectRows = integerOrNull(source?.visible_project_rows) || 0;
  const contentDiscoveredProjectCount = integerOrNull(source?.discovered_project_count);
  const projectMoreControlCount = integerOrNull(source?.project_more_control_count);
  const projectMoreControlClickCount = integerOrNull(source?.project_more_control_click_count);
  const projectMoreControlFound = source?.project_more_control_found === true;
  const projectVirtualizedCandidate = source?.project_virtualized_candidate === true;
  // The response array is the Background's source of truth.  The content
  // script's count is retained separately as a diagnostic so a stale or
  // differently-shaped response cannot make the two layers appear to agree.
  const discoveredProjectCount = Array.isArray(source?.projects)
    ? source.projects.length
    : contentDiscoveredProjectCount;
  const noGrowthCount = integerOrNull(source?.no_growth_count) || 0;
  const restoreCount = integerOrNull(source?.sidebar_restore_count);
  const scrollDirection = source?.sidebar_scroll_direction === "down"
    || source?.sidebar_scroll_direction === "none"
    ? source.sidebar_scroll_direction
    : null;
  collectorWindowState = {
    ...collectorWindowState,
    projectDiscoverySource: typeof source?.project_discovery_source === "string"
      && source.project_discovery_source.trim().length > 0
      ? source.project_discovery_source.trim().slice(0, 128)
      : collectorWindowState.projectDiscoverySource,
    sidebarScrollTop,
    sidebarScrollHeight,
    sidebarClientHeight,
    sidebarCanScroll: source?.sidebar_can_scroll === true,
    sidebarAtBottom: source?.sidebar_at_bottom === true,
    visibleProjectRows,
    discoveredProjectCount: discoveredProjectCount === null
      ? collectorWindowState.discoveredProjectCount
      : discoveredProjectCount,
    projectSectionFound: source?.project_section_found === true,
    noGrowthCount,
    ...(restoreCount === null ? {} : { projectDiscoveryRestoreCount: restoreCount }),
    ...(scrollDirection ? { projectDiscoveryScrollDirection: scrollDirection } : {})
  };
  if (pending?.projectDiscovery) {
    if (scrollDirection) pending.projectDiscovery.scrollDirection = scrollDirection;
    if (restoreCount !== null) pending.projectDiscovery.restoreCount = restoreCount;
    syncProjectDiscoveryTelemetry(pending, pending.projectDiscovery);
  }
  diagnostic("collector sidebar scroll observed", {
    ...trace,
    request_id: pending?.requestId || trace.request_id,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: targetTabId,
    project_discovery_source: collectorWindowState.projectDiscoverySource,
    sidebar_scroll_top: sidebarScrollTop,
    sidebar_scroll_height: sidebarScrollHeight,
    sidebar_client_height: sidebarClientHeight,
    sidebar_can_scroll: source?.sidebar_can_scroll === true,
    sidebar_at_bottom: source?.sidebar_at_bottom === true,
    visible_project_rows: visibleProjectRows,
    discovered_project_count: collectorWindowState.discoveredProjectCount,
    content_discovered_project_count: contentDiscoveredProjectCount,
    project_more_control_found: projectMoreControlFound,
    project_more_control_count: projectMoreControlCount,
    project_more_control_click_count: projectMoreControlClickCount,
    project_virtualized_candidate: projectVirtualizedCandidate,
    project_more_control_has_href: source?.project_more_control_has_href === true,
    project_more_control_aria_controls_present:
      source?.project_more_control_aria_controls_present === true,
    project_more_control_role: source?.project_more_control_role,
    project_more_control_aria_expanded: source?.project_more_control_aria_expanded,
    project_section_found: source?.project_section_found === true,
    no_growth_count: noGrowthCount,
    project_discovery_scroll_direction: scrollDirection,
    project_discovery_restore_count: restoreCount,
    sidebar_scroll_complete: source?.sidebar_scroll_complete === true,
    status: "observed",
    stage: trace.stage || "collector_sidebar_scroll_observed",
    target_tab_id: targetTabId
  });
  void persistCollectorWindowState();
}

function collectorProjectDiscoveryResultShape(source) {
  const hasProjectsArray = Array.isArray(source?.projects);
  const hasConversationsArray = Array.isArray(source?.conversations);
  const contentDiscoveredProjectCount = Number.isSafeInteger(source?.discovered_project_count)
    && source.discovered_project_count >= 0
    ? source.discovered_project_count
    : null;
  const backgroundProjectsLength = hasProjectsArray ? source.projects.length : 0;
  let responseShape = "invalid";
  if (hasProjectsArray && hasConversationsArray) responseShape = "top_level_arrays";
  else if (hasProjectsArray) responseShape = "top_level_projects_only";
  else if (source?.context && typeof source.context === "object"
    && Array.isArray(source.context.projects)) responseShape = "nested_context_projects";
  else if (source?.result && typeof source.result === "object"
    && Array.isArray(source.result.projects)) responseShape = "nested_result_projects";

  return {
    hasProjectsArray,
    hasConversationsArray,
    contentDiscoveredProjectCount,
    backgroundProjectsLength,
    responseShape,
    countMismatch: contentDiscoveredProjectCount !== null
      && contentDiscoveredProjectCount !== backgroundProjectsLength
  };
}

function mergeCollectorVisibilityTelemetry(efficiency, source) {
  if (!efficiency || !source || typeof source !== "object") return;
  if (source.document_visibility_state_at_collection_start) {
    efficiency.documentVisibilityStateAtCollectionStart = normalizeDocumentVisibilityState(
      source.document_visibility_state_at_collection_start);
  }
  if (source.document_visibility_state_at_collection_end) {
    efficiency.documentVisibilityStateAtCollectionEnd = normalizeDocumentVisibilityState(
      source.document_visibility_state_at_collection_end);
  }
  if (Number.isSafeInteger(source.document_visibility_change_count)
    && source.document_visibility_change_count >= 0) {
    efficiency.documentVisibilityChangeCount += source.document_visibility_change_count;
  }
  if (source.document_hidden_observed === true) efficiency.documentHiddenObserved = true;
  if (source.document_became_visible_during_collection === true) {
    efficiency.documentBecameVisibleDuringCollection = true;
  }
  if (source.document_became_hidden_during_collection === true) {
    efficiency.documentBecameHiddenDuringCollection = true;
  }
  if (Number.isSafeInteger(source.document_hidden_duration_ms)
    && source.document_hidden_duration_ms >= 0) {
    efficiency.documentHiddenDurationMs += source.document_hidden_duration_ms;
  }
  if (Number.isSafeInteger(source.document_visible_duration_ms)
    && source.document_visible_duration_ms >= 0) {
    efficiency.documentVisibleDurationMs += source.document_visible_duration_ms;
  }
  const addMetric = (stateKey, sourceKey) => {
    const value = source[sourceKey];
    if (Number.isSafeInteger(value) && value >= 0) efficiency[stateKey] += value;
  };
  addMetric("hydrationLoopsWhileDocumentHidden", "hydration_loops_while_document_hidden");
  addMetric("hydrationLoopsWhileDocumentVisible", "hydration_loops_while_document_visible");
  addMetric("scrollAttemptsWhileHidden", "scroll_attempts_while_hidden");
  addMetric("scrollAttemptsWhileVisible", "scroll_attempts_while_visible");
  addMetric("mutationCountWhileHidden", "mutation_count_while_hidden");
  addMetric("mutationCountWhileVisible", "mutation_count_while_visible");
  addMetric("pollWaitMsWhileHidden", "poll_wait_ms_while_hidden");
  addMetric("pollWaitMsWhileVisible", "poll_wait_ms_while_visible");
  addMetric("identityAttemptsWhileHidden", "identity_attempts_while_hidden");
  addMetric("identityAttemptsWhileVisible", "identity_attempts_while_visible");
  addMetric("identityWaitMsWhileHidden", "identity_wait_ms_while_hidden");
  addMetric("identityWaitMsWhileVisible", "identity_wait_ms_while_visible");
  for (const key of ["slow_identity_indices_while_hidden", "slow_identity_indices_while_visible"]) {
    if (!Array.isArray(source[key])) continue;
    const target = key.endsWith("hidden")
      ? "slowIdentityIndicesWhileHidden"
      : "slowIdentityIndicesWhileVisible";
    for (const index of source[key]) {
      if (Number.isSafeInteger(index) && index >= 0) efficiency[target].push(index);
    }
  }
}

function recordCollectorProjectDiscoveryResult(source, pending) {
  const shape = collectorProjectDiscoveryResultShape(source);
  if (pending && typeof pending === "object") {
    pending.collectorProjectDiscoveryResultShape = shape;
  }
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (efficiency) {
    const nonNegativeInteger = (value) =>
      Number.isSafeInteger(value) && value >= 0 ? value : null;
    const assignRootMetric = (key, value) => {
      const normalized = nonNegativeInteger(value);
      if (normalized !== null) efficiency[key] = normalized;
    };
    const addRootDuration = (key, value) => {
      const normalized = nonNegativeInteger(value);
      if (normalized !== null) efficiency[key] += normalized;
    };
    assignRootMetric("rootCatalogBuildCount", source?.root_catalog_build_count);
    assignRootMetric("rootCatalogReuseCount", source?.root_catalog_reuse_count);
    addRootDuration("catalogBuildMs", source?.root_catalog_build_ms);
    addRootDuration("rootHydrationScrollWaitMs", source?.root_hydration_scroll_wait_ms);
    addRootDuration("moreClickWaitMs", source?.more_click_wait_ms);
    addRootDuration("totalDomWaitMs", source?.total_dom_wait_ms);
    const remountCount = nonNegativeInteger(source?.dom_remount_count);
    if (remountCount !== null) efficiency.domRemountCount += remountCount;
    const scrollAttempts = nonNegativeInteger(source?.sidebar_scroll_attempt_count);
    if (scrollAttempts !== null) {
      efficiency.rootHydrationScrollCount = scrollAttempts;
      efficiency.sidebarScrollAttemptCount += scrollAttempts;
    }
    const scrollChanges = nonNegativeInteger(source?.sidebar_scroll_position_change_count);
    if (scrollChanges !== null) {
      efficiency.sidebarScrollPositionChangeCount += scrollChanges;
    }
    const scrollStagnation = nonNegativeInteger(source?.sidebar_scroll_stagnation_count);
    if (scrollStagnation !== null) {
      efficiency.sidebarScrollStagnationCount += scrollStagnation;
    }
    const moreClicks = nonNegativeInteger(source?.project_more_control_click_count);
    if (moreClicks !== null) efficiency.moreClickCount += moreClicks;
    const assignIntegrityMetric = (stateKey, sourceKey) => {
      const normalized = nonNegativeInteger(source?.[sourceKey]);
      if (normalized !== null) efficiency[stateKey] = normalized;
    };
    assignIntegrityMetric("discoverySnapshotCount", "discovery_snapshot_count");
    assignIntegrityMetric(
      "discoverySnapshotProjectCandidateCountTotal",
      "discovery_snapshot_project_candidate_count_total");
    assignIntegrityMetric("discoveryLogicalProjectCountFinal", "discovery_logical_project_count_final");
    assignIntegrityMetric("descriptorAddedCount", "descriptor_added_count");
    assignIntegrityMetric("descriptorUpdatedCount", "descriptor_updated_count");
    assignIntegrityMetric("descriptorReplacedCount", "descriptor_replaced_count");
    assignIntegrityMetric("descriptorRemovedCount", "descriptor_removed_count");
    assignIntegrityMetric("descriptorDuplicateRejectedCount", "descriptor_duplicate_rejected_count");
    assignIntegrityMetric("descriptorRemountReconciledCount", "descriptor_remount_reconciled_count");
    assignIntegrityMetric("descriptorAmbiguousReconcileCount", "descriptor_ambiguous_reconcile_count");
    assignIntegrityMetric("titleOnlyReconcileAttemptCount", "title_only_reconcile_attempt_count");
    assignIntegrityMetric("titleOnlyReconcileRejectedCount", "title_only_reconcile_rejected_count");
    assignIntegrityMetric("titleHintUsedCount", "title_hint_used_count");
    assignIntegrityMetric("stableEvidenceReconcileCount", "stable_evidence_reconcile_count");
    assignIntegrityMetric("ambiguousSameTitleReconcileCount", "ambiguous_same_title_reconcile_count");
    assignIntegrityMetric("titleOnlyObservationPreservedCount", "title_only_observation_preserved_count");
    assignIntegrityMetric("provisionalObservationCreatedCount", "provisional_observation_created_count");
    assignIntegrityMetric("provisionalObservationReusedCount", "provisional_observation_reused_count");
    assignIntegrityMetric("uniqueTitleVolatileRemountCount", "unique_title_volatile_remount_count");
    assignIntegrityMetric("provisionalFoldedSameDescriptorCount", "provisional_folded_same_descriptor_count");
    assignIntegrityMetric("provisionalSameProjectIdProofCount", "provisional_same_project_id_proof_count");
    assignIntegrityMetric("provisionalSameStableLocatorProofCount", "provisional_same_stable_locator_proof_count");
    assignIntegrityMetric("provisionalLineageProofCount", "provisional_lineage_proof_count");
    if (Array.isArray(source?.compact_provisional_transitions)) {
      efficiency.compactProvisionalTransitions = source.compact_provisional_transitions.join(",");
    }
    if (Array.isArray(source?.provisional_created_indices)) {
      efficiency.provisionalCreatedIndices = source.provisional_created_indices.join(",");
    }
    if (Array.isArray(source?.provisional_merged_existing_indices)) {
      efficiency.provisionalMergedExistingIndices = source.provisional_merged_existing_indices.join(",");
    }
    if (Array.isArray(source?.confirmed_fingerprint_changed_indices)) {
      efficiency.confirmedFingerprintChangedIndices = source.confirmed_fingerprint_changed_indices.join(",");
    }
    if (Array.isArray(source?.stable_locator_changed_indices)) {
      efficiency.stableLocatorChangedIndices = source.stable_locator_changed_indices.join(",");
    }
    if (Array.isArray(source?.discovery_key_changed_indices)) {
      efficiency.discoveryKeyChangedIndices = source.discovery_key_changed_indices.join(",");
    }
    assignIntegrityMetric(
      "provisionalObservationCountBeforeIdentity",
      "provisional_observation_count");
    assignIntegrityMetric(
      "confirmedLogicalProjectCountBeforeIdentity",
      "confirmed_logical_project_count_before_identity");
    assignIntegrityMetric("duplicateDiscoveryKeyCount", "duplicate_discovery_key_count");
    assignIntegrityMetric(
      "discoveryKeyChangedForSameLogicalProjectCount",
      "discovery_key_changed_for_same_logical_project_count");
    assignIntegrityMetric("moreControlSeenCount", "more_control_seen_count");
    assignIntegrityMetric("moreControlLogicalUniqueCount", "more_control_logical_unique_count");
    assignIntegrityMetric(
      "moreControlDuplicateSuppressedCount",
      "more_control_duplicate_suppressed_count");
    assignIntegrityMetric("morePaginationRoundCount", "more_pagination_round_count");
    assignIntegrityMetric("moreClickProgressCount", "more_click_progress_count");
    assignIntegrityMetric("moreClickNoProgressCount", "more_click_no_progress_count");
    assignIntegrityMetric("moreReappearedAfterClickCount", "more_reappeared_after_click_count");
    assignIntegrityMetric("moreReclickAllowedCount", "more_reclick_allowed_count");
    assignIntegrityMetric("moreReclickSuppressedCount", "more_reclick_suppressed_count");
    assignIntegrityMetric("moreProjectCountBeforeClickTotal", "more_project_count_before_click_total");
    assignIntegrityMetric("moreProjectCountAfterClickTotal", "more_project_count_after_click_total");
    assignIntegrityMetric("moreScrollHeightIncreasedCount", "more_scroll_height_increased_count");
    assignIntegrityMetric("moreCandidateCountIncreasedCount", "more_candidate_count_increased_count");
    assignIntegrityMetric("moreDescriptorCountIncreasedCount", "more_descriptor_count_increased_count");
    const moreStopReasons = new Set([
      "no_more_control",
      "no_progress",
      "scroll_exhausted",
      "timeout",
      "stagnation"
    ]);
    assignIntegrityMetric("hydrationLoopCount", "hydration_loop_count");
    assignIntegrityMetric("hydrationProgressCount", "hydration_progress_count");
    assignIntegrityMetric("hydrationNoProgressCount", "hydration_no_progress_count");
    assignIntegrityMetric("hydrationConsecutiveStagnationMax", "hydration_consecutive_stagnation_max");
    assignIntegrityMetric("hydrationStagnationBreakCount", "hydration_stagnation_break_count");
    assignIntegrityMetric("hydrationSameLogicalStateCount", "hydration_same_logical_state_count");
    assignIntegrityMetric("hydrationCatalogUnchangedCount", "hydration_catalog_unchanged_count");
    assignIntegrityMetric("hydrationSnapshotUnchangedCount", "hydration_snapshot_unchanged_count");
    assignIntegrityMetric(
      "hydrationProgressProjectCountIncrease",
      "hydration_progress_project_count_increase");
    assignIntegrityMetric(
      "hydrationProgressProvisionalCountIncrease",
      "hydration_progress_provisional_count_increase");
    assignIntegrityMetric(
      "hydrationProgressScrollPositionChange",
      "hydration_progress_scroll_position_change");
    assignIntegrityMetric(
      "hydrationProgressScrollHeightIncrease",
      "hydration_progress_scroll_height_increase");
    assignIntegrityMetric("hydrationProgressMorePagination", "hydration_progress_more_pagination");
    assignIntegrityMetric("hydrationStagnationResetCount", "hydration_stagnation_reset_count");
    const resetReasons = source?.hydration_stagnation_reset_reason_counts;
    if (resetReasons && typeof resetReasons === "object") {
      for (const key of [
        "project_count",
        "provisional_count",
        "scroll_position",
        "scroll_height",
        "more_pagination"
      ]) {
        const normalized = nonNegativeInteger(resetReasons[key]);
        if (normalized !== null) {
          efficiency.hydrationStagnationResetReasonCounts[key] = normalized;
        }
      }
    }
    if (moreStopReasons.has(source?.hydration_stop_reason)) {
      efficiency.hydrationStopReason = source.hydration_stop_reason;
    }
    if (source?.hydration_completed_with_more_visible === true) {
      efficiency.hydrationCompletedWithMoreVisible = true;
    }
    if (source?.hydration_completed_after_more_no_progress === true) {
      efficiency.hydrationCompletedAfterMoreNoProgress = true;
    }
    if (source?.more_visible_at_hydration_complete === true) {
      efficiency.moreVisibleAtHydrationComplete = true;
    }
    if (source?.more_enabled_at_hydration_complete === true) {
      efficiency.moreEnabledAtHydrationComplete = true;
    }
    if (source?.more_clickable_at_hydration_complete === true) {
      efficiency.moreClickableAtHydrationComplete = true;
    }
    mergeCollectorVisibilityTelemetry(efficiency, source);
    assignIntegrityMetric(
      "projectCandidateRejectedChildChatCount",
      "project_candidate_rejected_child_chat_count");
    assignIntegrityMetric(
      "projectCandidateRejectedNonProjectCount",
      "project_candidate_rejected_non_project_count");
    assignIntegrityMetric("finalCatalogIndexCount", "final_catalog_index_count");
    const copyIndexList = (stateKey, sourceKey) => {
      if (!Array.isArray(source?.[sourceKey])) return;
      efficiency[stateKey] = source[sourceKey]
        .filter((value) => Number.isSafeInteger(value) && value >= 0)
        .slice(0, 5000);
    };
    copyIndexList("finalCatalogIndices", "final_catalog_indices");
    copyIndexList(
      "descriptorAddedAfterFirstSnapshotIndices",
      "descriptor_added_after_first_snapshot_indices");
  }
  const base = {
    project_discovery_result_received: true,
    discovered_project_count: shape.backgroundProjectsLength,
    background_projects_length: shape.backgroundProjectsLength,
    response_shape: shape.responseShape,
    target_tab_id: pending?.tabId
  };
  if (shape.contentDiscoveredProjectCount !== null) {
    base.content_discovered_project_count = shape.contentDiscoveredProjectCount;
  }
  recordProjectDiscoveryTelemetry("collector project discovery result received", pending, {
    ...base,
    status: shape.hasProjectsArray && shape.hasConversationsArray ? "received" : "error",
    error_code: shape.hasProjectsArray && shape.hasConversationsArray
      ? undefined
      : "collector_project_result_shape_mismatch",
    stage: "collector_project_result_received"
  });
  if (shape.countMismatch) {
    diagnostic("collector project result handoff mismatch", {
      request_id: pending?.requestId,
      refresh_generation: pending?.projectDiscovery?.refreshGeneration,
      project_discovery_run_id: pending?.projectDiscovery?.runId,
      project_discovery_call_count: pending?.projectDiscovery?.callCount,
      project_discovery_started: pending?.projectDiscovery?.started === true,
      project_discovery_completed: pending?.projectDiscovery?.completed === true,
      ...base,
      status: "error",
      error_code: "collector_project_result_handoff_mismatch",
      stage: "collector_project_result_handoff"
    });
  }
  return shape;
}

async function getCollectorWindow(windowId = collectorWindowState.windowId) {
  await hydrateCollectorWindowState();
  return getChromeWindowById(windowId);
}

async function tabsInCollectorWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || typeof chrome.tabs?.query !== "function") return [];
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return Array.isArray(tabs) ? tabs : [];
  } catch (_) {
    return [];
  }
}

async function waitForCollectorWindowTabs(windowId, timeoutMs = COLLECTOR_INITIAL_TAB_WAIT_MS) {
  const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
  let tabs = await tabsInCollectorWindow(windowId);
  while (tabs.length === 0 && Date.now() < deadline) {
    await wait(Math.min(COLLECTOR_INITIAL_TAB_POLL_MS, Math.max(0, deadline - Date.now())));
    tabs = await tabsInCollectorWindow(windowId);
  }
  return tabs;
}

async function findCollectorWindowTab(windowId) {
  const tabs = await tabsInCollectorWindow(windowId);
  return tabs.find((tab) => tab?.id === collectorWindowState.tabId)
    || tabs.find((tab) => isChatGptTab(tab))
    || null;
}

async function makeCollectorWindowUsable(window, trace = {}) {
  if (!window || !Number.isSafeInteger(window.id)) return null;
  let usable = window;
  const changes = {};
  if (window.state === "minimized") {
    changes.state = "normal";
    const efficiency = collectorEfficiencyFromTrace(trace);
    if (efficiency) efficiency.collectorWindowUnminimizedByConnector = true;
  }
  if (window.focused === true) changes.focused = false;
  if (Object.keys(changes).length > 0 && typeof chrome.windows?.update === "function") {
    try {
      usable = await chrome.windows.update(window.id, changes) || { ...window, ...changes };
    } catch (error) {
      diagnostic("collector window restore failed", {
        ...trace,
        collector_window_id: window.id,
        error_code: error?.code || "collector_window_restore_failed",
        status: "error",
        stage: "collector_window_restore"
      });
    }
  }
  collectorWindowState = {
    ...collectorWindowState,
    windowId: window.id,
    windowState: usable.state || "normal",
    windowWidth: positiveDimension(usable.width),
    windowHeight: positiveDimension(usable.height)
  };
  diagnostic("collector window usable", {
    ...trace,
    collector_window_id: usable.id,
    collector_window_focused: usable.focused === true,
    collector_window_state: usable.state || "normal",
    collector_window_exists: true,
    collector_window_width: collectorWindowState.windowWidth,
    collector_window_height: collectorWindowState.windowHeight,
    status: "ready",
    stage: "collector_window_usable"
  });
  return usable;
}

async function collectorWindowCreateData(url) {
  let referenceWindow = null;
  if (typeof chrome.windows?.getLastFocused === "function") {
    try { referenceWindow = await chrome.windows.getLastFocused({ populate: false }); } catch (_) { }
  }
  const referenceWidth = Number.isSafeInteger(referenceWindow?.width) && referenceWindow.width > 0
    ? referenceWindow.width : COLLECTOR_WINDOW_FALLBACK_WIDTH;
  const referenceHeight = Number.isSafeInteger(referenceWindow?.height) && referenceWindow.height > 0
    ? referenceWindow.height : COLLECTOR_WINDOW_FALLBACK_HEIGHT;
  return {
    url,
    focused: false,
    state: "normal",
    type: "normal",
    width: Math.max(COLLECTOR_WINDOW_MIN_WIDTH, Math.floor(referenceWidth * COLLECTOR_WINDOW_SIZE_FACTOR)),
    height: Math.max(COLLECTOR_WINDOW_MIN_HEIGHT, Math.floor(referenceHeight * COLLECTOR_WINDOW_SIZE_FACTOR))
  };
}

function bindConnectorManagedWindowId(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId < 0) return;
  collectorWindowState = { ...collectorWindowState, windowId };
  managedTabState = {
    ...managedTabState,
    executionWindowId: windowId,
    executionWindowState: managedTabState.executionWindowState || "normal"
  };
  managedExecutionOwnedWindowIds.add(windowId);
}

async function liveConnectorManagedWindow() {
  await hydrateCollectorWindowState();
  await managedTabStateReady;
  if (Number.isSafeInteger(collectorWindowState.windowId)) {
    const existing = await getCollectorWindow();
    if (existing) return existing;
  }
  const ownedLive = [];
  for (const windowId of managedExecutionOwnedWindowIds) {
    const owned = await getManagedExecutionWindow(windowId);
    if (owned) ownedLive.push(owned);
  }
  if (ownedLive.length > 1) {
    throw managedTabError(
      "ambiguous_managed_execution_windows",
      "execution_window_lookup",
      "Managed Execution Windowの候補が複数あり、一意に特定できません。");
  }
  if (ownedLive.length === 1) return ownedLive[0];
  if (Number.isSafeInteger(managedTabState.executionWindowId)) {
    return getManagedExecutionWindow(managedTabState.executionWindowId);
  }
  return null;
}

async function ensureConnectorManagedWindowUnlocked(url, trace = {}, options = {}) {
  const existing = await liveConnectorManagedWindow();
  if (existing) {
    bindConnectorManagedWindowId(existing.id);
    connectorManagedWindowReusedCount += 1;
    diagnostic("connector managed window reused", {
      ...trace,
      collector_window_id: existing.id,
      execution_window_id: existing.id,
      status: "reused",
      stage: "connector_managed_window_reused"
    });
    return { window: existing, created: false };
  }
  if (typeof chrome.windows?.create !== "function") {
    throw bridgeError("Connector Managed Windowを作成できません。", 0, "collector_window_create_failed");
  }
  diagnostic("connector managed window create requested", {
    ...trace,
    status: "requested",
    stage: "connector_managed_window_create"
  });
  let created;
  let createTimeout = null;
  try {
    const data = await collectorWindowCreateData(url);
    created = await Promise.race([
      chrome.windows.create(data),
      new Promise((_, reject) => {
        createTimeout = setTimeout(() => reject(bridgeError(
          "Connector Managed Windowの作成がタイムアウトしました。",
          0,
          "collector_window_create_timeout")), COLLECTOR_WINDOW_CREATE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (createTimeout !== null) clearTimeout(createTimeout);
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw bridgeError("Connector Managed Windowを作成できません。", 0, "collector_window_create_failed");
  }
  bindConnectorManagedWindowId(created.id);
  connectorManagedWindowCreatedCount += 1;
  const createResultTabs = Array.isArray(created.tabs) ? created.tabs : [];
  const queried = await tabsInCollectorWindow(created.id);
  const initial = createResultTabs[0] || queried[0] || null;
  const collectorInitial = options.role === "collector";
  if (initial && Number.isSafeInteger(initial.id)) {
    if (collectorInitial) {
      collectorWindowState = { ...collectorWindowState, windowId: created.id, tabId: initial.id };
      connectorManagedWindowInitialTabRole = "collector";
    } else {
      connectorManagedWindowInitialTabRole = "execution";
      rememberCreatedExecutionWindowTabs(created.id, [initial, ...queried]);
    }
  }
  diagnostic("connector managed window created", {
    ...trace,
    collector_window_id: created.id,
    execution_window_id: created.id,
    status: "created",
    stage: "connector_managed_window_created"
  });
  if (options.role === "execution") {
    const resolution = managedExecutionResolutionFor(trace.request_id, trace.handoff_id);
    resolution.executionWindowPhysicalTabCountAtCreation = (createResultTabs.length || queried.length);
    resolution.initialWindowTabFound = Boolean(initial && Number.isSafeInteger(initial.id));
  }
  const initialWindowState = created.state;
  const initialTabActive = initial?.active === true;
  const usable = options.role === "collector"
    ? await makeCollectorWindowUsable({
      ...created,
      state: created.state || "normal"
    }, trace)
    : await makeManagedExecutionWindowUsable(created, trace);
  return {
    window: usable || created,
    created: true,
    initialWindowState,
    initialTabActive
  };
}

async function ensureConnectorManagedWindow(url, trace = {}, options = {}) {
  if (connectorManagedWindowEnsureInFlight) return connectorManagedWindowEnsureInFlight;
  let operation;
  operation = (async () => {
    try {
      return await ensureConnectorManagedWindowUnlocked(url, trace, options);
    } finally {
      if (connectorManagedWindowEnsureInFlight === operation) connectorManagedWindowEnsureInFlight = null;
    }
  })();
  connectorManagedWindowEnsureInFlight = operation;
  return operation;
}

function collectorCollectionIsInFlight() {
  if (collectorWindowState.projectDiscoveryInFlight === true) return true;
  for (const pending of contextRequests.values()) {
    if (pending?.generation === collectorContextGeneration
      && pending?.projectDiscovery?.inFlight === true) {
      return true;
    }
  }
  return false;
}

async function waitForCollectorCollectionIdle() {
  if (!collectorCollectionIsInFlight()) return;
  const operation = collectorWindowStateOperation;
  await Promise.race([
    Promise.resolve(operation).catch(() => {}),
    wait(120000)
  ]);
}

async function enforceCollectorTab(tab, trace = {}, options = {}) {
  if (!tab || !Number.isSafeInteger(tab.id)) return tab;
  if (tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector TabがCollector Windowにありません。", 0, "collector_tab_wrong_window");
  }
  if (tab.discarded === true || tab.frozen === true) {
    throw bridgeError("Collector Tabがdiscardedまたはfrozenになっています。", 0, "collector_tab_state_changed");
  }
  const activate = options.activate !== false
    && !managedExecutionTabEnsureInFlight
    && !managedExecutionTabCreateInFlight;
  const changes = {};
  if (activate && tab.active !== true) changes.active = true;
  if (tab.autoDiscardable !== false) changes.autoDiscardable = false;
  let normalized = tab;
  if (Object.keys(changes).length > 0 && typeof chrome.tabs?.update === "function") {
    try {
      normalized = await chrome.tabs.update(tab.id, changes) || { ...tab, ...changes };
    } catch (_) {
      throw bridgeError("Collector Tabの実行状態を設定できません。", 0, "collector_tab_state_failed");
    }
  }
  collectorWindowState = { ...collectorWindowState, tabId: normalized.id };
  const signature = [
    normalized.windowId,
    normalized.id,
    normalized.active === true,
    normalized.autoDiscardable === false,
    normalized.discarded === true,
    normalized.frozen === true
  ].join(":");
  if (signature !== lastCollectorTabEnforcementTelemetrySignature || Object.keys(changes).length > 0) {
    lastCollectorTabEnforcementTelemetrySignature = signature;
    diagnostic("collector tab state enforced", {
      ...trace,
      collector_window_id: normalized.windowId,
      collector_tab_id: normalized.id,
      target_tab_id: normalized.id,
      tab_active: normalized.active === true,
      tab_auto_discardable: normalized.autoDiscardable === false ? false : normalized.autoDiscardable,
      status: "enforced",
      stage: "collector_tab_state_enforced"
    });
  }
  return normalized;
}

function collectorTabNeedsRecovery(tab) {
  return tab?.discarded === true || tab?.frozen === true;
}

async function replaceCollectorTab(tab, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id)
    || tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector TabのRecovery対象が一致しません。", 0, "collector_tab_wrong_window");
  }
  collectorWindowLifecycle("RecoveringTab", {
    windowId: tab.windowId,
    tabId: null,
    currentProjectId: null,
    projectIndex: -1
  });
  diagnostic("collector tab recovery requested", {
    ...trace,
    collector_window_id: tab.windowId,
    collector_tab_id: tab.id,
    target_tab_id: tab.id,
    tab_active: tab.active === true,
    tab_discarded: tab.discarded === true,
    tab_frozen: tab.frozen === true,
    tab_auto_discardable: tab.autoDiscardable,
    status: "recovering",
    error_code: tab.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen",
    stage: "collector_tab_recovery_requested"
  });
  if (typeof chrome.tabs?.remove !== "function") {
    throw bridgeError("Collector TabをRecoveryできません。", 0, "collector_tab_recovery_failed");
  }
  try {
    await chrome.tabs.remove(tab.id);
  } catch (_) {
    // The tab may have been closed concurrently. Verify the exact ID before
    // allowing the caller to create a replacement; otherwise two Collector
    // Tabs could be left in the same Window.
  }
  if (typeof chrome.tabs?.get === "function") {
    try {
      await chrome.tabs.get(tab.id);
      throw bridgeError("Collector Tabの旧インスタンスを閉じられませんでした。", 0, "collector_tab_recovery_failed");
    } catch (error) {
      if (error?.code === "collector_tab_recovery_failed") throw error;
    }
  }
  return null;
}

async function createCollectorTabInWindow(windowId, url, trace = {}) {
  if (typeof chrome.tabs?.create !== "function") {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  let created;
  try {
    created = await chrome.tabs.create({ url, windowId, active: true });
  } catch (_) {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw bridgeError("ChatGPT Context収集用タブを作成できません。", 0, "collector_tab_create_failed");
  }
  collectorWindowState = { ...collectorWindowState, windowId, tabId: created.id };
  collectorWindowLifecycle("PreparingTab", { windowId, tabId: created.id });
  diagnostic("collector tab created", {
    ...trace,
    collector_window_id: windowId,
    collector_tab_id: created.id,
    target_tab_id: created.id,
    status: "created",
    stage: "collector_tab_created"
  });
  return await enforceCollectorTab(created, trace);
}

async function ensureCollectorWindow(url = COLLECTOR_TAB_URL, trace = {}) {
  await hydrateCollectorWindowState();
  let rootNavigationCreated = false;
  let windowCreated = false;
  let tabCreated = false;
  const resolution = await resolveExistingCollector();
  let window = resolution.window;
  if (!window && resolution.reason === "ambiguous_existing_collectors") {
    recordCollectorWindowResolution(resolution, trace, false, false);
    throw bridgeError(
      "Collector Windowの候補が複数あり、一意に特定できません。",
      0,
      "ambiguous_existing_collectors");
  }
  if (!window) {
    if (Number.isSafeInteger(collectorWindowState.windowId)) {
      diagnostic("collector window unavailable", {
        ...trace,
        collector_window_id: collectorWindowState.windowId,
        collector_window_exists: false,
        status: "recovering",
        stage: "collector_window_lookup"
      });
    }
    collectorWindowLifecycle("PreparingWindow", { windowId: null, tabId: collectorWindowState.tabId });
    const ensured = await ensureConnectorManagedWindow(url, trace, { role: "collector" });
    window = ensured.window;
    windowCreated = ensured.created === true;
    bindConnectorManagedWindowId(window.id);
    if (windowCreated) {
      await recordCollectorPresentationPhase("creation", trace, {
        windowState: normalizeChromeWindowState(ensured.initialWindowState || window.state),
        focused: window.focused === true,
        tabActive: ensured.initialTabActive === true
      });
      if (isCollectorRootUrl(safeChatGptContextUrl(url))) {
        rootNavigationCreated = true;
        recordCollectorProjectDiscoveryEfficiencyNavigation(
          trace.request_id,
          "root",
          null,
          `${trace.request_id || "collector"}:created-window:${window.id}`);
        recordCollectorProjectDiscoveryEfficiencyNavigation(
          trace.request_id,
          "full_page",
          null,
          `${trace.request_id || "collector"}:created-window:${window.id}:root`);
      }
      diagnostic("collector window created", {
        ...trace,
        collector_window_id: window.id,
        collector_window_focused: window.focused === true,
        collector_window_state: window.state || "normal",
        collector_window_exists: true,
        status: "created",
        stage: "collector_window_created"
      });
    } else {
      window = await makeCollectorWindowUsable(window, trace);
    }
  } else {
    bindConnectorManagedWindowId(window.id);
    window = await makeCollectorWindowUsable(window, trace);
  }

  // windows.create({ url }) already creates the first Tab. Reconcile the
  // complete Window before considering tabs.create so that the initial Tab is
  // reused and any stale duplicate is removed deterministically.
  // Chrome creates the initial Tab as part of windows.create({ url }). On a
  // real profile the tabs.query result can briefly lag that creation. Wait for
  // that authoritative Tab instead of creating a second one during the gap.
  await waitForCollectorWindowTabs(window.id);
  let tab = await reconcileCollectorWindowTabs(
    window.id,
    resolution.tab?.id || collectorWindowState.tabId,
    trace);
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab, trace);
    tab = null;
  }
  if (!tab) {
    tab = await createCollectorTabInWindow(window.id, url, trace);
    tabCreated = true;
    if (!rootNavigationCreated && isCollectorRootUrl(safeChatGptContextUrl(url))) {
      recordCollectorProjectDiscoveryEfficiencyNavigation(
        trace.request_id,
        "root",
        null,
        `${trace.request_id || "collector"}:created-tab:${tab.id}`);
      recordCollectorProjectDiscoveryEfficiencyNavigation(
        trace.request_id,
        "full_page",
        null,
        `${trace.request_id || "collector"}:created-tab:${tab.id}:root`);
    }
  }
  else {
    collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: tab.id };
    collectorWindowLifecycle("PreparingTab", { windowId: window.id, tabId: tab.id });
    tab = await enforceCollectorTab(tab, trace);
  }
  tab = await reconcileCollectorWindowTabs(window.id, tab.id, trace);
  if (!tab) {
    throw bridgeError(
      "Collector Window内のCollector Tabを確認できません。",
      0,
      "collector_tab_count_invalid");
  }
  tab = await enforceCollectorTab(tab, trace);
  recordCollectorTabTopology(
    window.id,
    await tabsInCollectorWindow(window.id),
    tab,
    trace);
  if (!(await waitForTabReady(tab.id, COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS))) {
    collectorWindowLifecycle("Failed", { windowId: window.id, tabId: tab.id });
    throw bridgeError(
      "ChatGPT Context収集用タブの読み込みがタイムアウトしました。",
      0,
      "collector_tab_navigation_timeout");
  }
  collectorWindowLifecycle("WaitingContentScript", { windowId: window.id, tabId: tab.id });
  await stampCollectorTabIdentity(tab);
  recordCollectorWindowResolution(
    {
      ...resolution,
      window,
      tab,
      reason: windowCreated
        ? (resolution.reason === "stale_persisted_id" ? "stale_persisted_id" : "no_existing_collector")
        : (resolution.reason || "persisted_id")
    },
    trace,
    windowCreated,
    !windowCreated && !tabCreated);
  const efficiency = collectorProjectDiscoveryEfficiencyForRequest(trace.request_id);
  if (efficiency && tabCreated && !windowCreated) {
    efficiency.collectorTabCreated = true;
    if (!efficiency.collectorCreationReason) {
      efficiency.collectorCreationReason = "missing_collector_tab";
    }
  }
  await emitConnectorManagedWindowTopologySummary(trace.request_id);
  return tab;
}

async function navigateCollectorTab(tab, url, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id) || tab.windowId !== collectorWindowState.windowId) {
    throw bridgeError("Collector Tabを移動できません。", 0, "collector_tab_wrong_window");
  }
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab, trace);
    tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, trace);
  }
  if (typeof chrome.tabs?.get === "function") {
    try {
      tab = await chrome.tabs.get(tab.id) || tab;
    } catch (_) {
      // Keep the caller's tab object if the browser removes it between
      // reconciliation and navigation; the normal tab guards below still
      // fail safely in that case.
    }
  }
  const targetUrl = safeChatGptContextUrl(url) || COLLECTOR_TAB_URL;
  const projectUrl = safeChatGptProjectUrl(targetUrl);
  const isProjectNavigation = projectUrl !== null;
  const projectNavigationAuthorized = trace.project_discovery_completed === true
    || trace.project_selection_target_verified === true;
  if (isProjectNavigation && !projectNavigationAuthorized) {
    diagnostic("collector Project navigation blocked before discovery", {
      request_id: trace.request_id,
      project_id: trace.project_id,
      project_index: trace.project_index,
      total_projects: trace.total_projects,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      collector_navigation_target: targetUrl,
      project_discovery_completed: trace.project_discovery_completed === true,
      project_selection_target_verified: trace.project_selection_target_verified === true,
      status: "error",
      error_code: "collector_project_navigation_before_discovery",
      stage: "collector_project_navigation_guard",
      target_tab_id: tab.id
    });
    throw bridgeError(
      "Project一覧の確定前にProjectページへ移動することはできません。",
      0,
      "collector_project_navigation_before_discovery");
  }
  const currentUrl = safeChatGptContextUrl(tab.url);
  const navigationTrace = {
    ...trace,
    currentProjectId: isProjectNavigation
      ? (trace.project_id || chatGptProjectId(projectUrl))
      : null,
    currentProjectUrl: isProjectNavigation ? targetUrl : null,
    collectorNavigationTarget: targetUrl
  };
  const requestId = trace.request_id;
  collectorWindowState = {
    ...collectorWindowState,
    currentProjectId: navigationTrace.currentProjectId,
    // The root page is the discovery page, not a Project target. Keep the
    // state aligned with the normalized trace so a root transition cannot be
    // mistaken for an in-progress Project navigation by later orchestration.
    currentProjectUrl: navigationTrace.currentProjectUrl,
    collectorNavigationTarget: targetUrl
  };
  let updated = tab;
  let navigationWaitStartedAt = null;
  let navigationWaitType = null;
  let navigationKey = null;
  if (currentUrl !== targetUrl && typeof chrome.tabs?.update === "function") {
    navigationWaitStartedAt = Date.now();
    navigationWaitType = isProjectNavigation
      ? "project"
      : (typeof trace.stage === "string" && trace.stage.includes("root_restore")
        ? "root_return"
        : "root");
    navigationKey =
      `${requestId || "collector"}:${trace.stage || "navigation"}:${currentUrl || "unknown"}->${targetUrl}`;
    recordCollectorProjectDiscoveryEfficiencyNavigationRequest(
      requestId,
      navigationWaitType);
    const navigationLifecycle = isProjectNavigation ? "NavigatingProject" : "NavigatingRoot";
    const navigationStage = isProjectNavigation
      ? "collector_project_url_navigation"
      : "collector_root_url_navigation";
    collectorWindowLifecycle(navigationLifecycle, { tabId: tab.id, ...navigationTrace });
    diagnostic("collector navigation requested", {
      ...navigationTrace,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      collector_navigation_target: targetUrl,
      status: "requested",
      stage: navigationStage,
      target_tab_id: tab.id
    });
    contentScriptReadyTabs.delete(tab.id);
    try {
      updated = await chrome.tabs.update(tab.id, {
        url: targetUrl,
        active: true,
        autoDiscardable: false
      }) || { ...tab, url: targetUrl, active: true, autoDiscardable: false };
    } catch (_) {
      recordCollectorProjectDiscoveryEfficiencyNavigationWait(
        contextRequests.get(requestId),
        navigationWaitStartedAt,
        isProjectNavigation,
        navigationWaitType);
      throw bridgeError("Collector TabのProjectページ移動に失敗しました。", 0, "collector_tab_navigation_failed");
    }
  }
  updated = await enforceCollectorTab(updated, navigationTrace);
  const navigationReady = await waitForTabReady(
    updated.id,
    COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS,
    contextRequests.get(requestId));
  if (!navigationReady) {
    recordCollectorProjectDiscoveryEfficiencyNavigationWait(
      contextRequests.get(requestId),
      navigationWaitStartedAt,
      isProjectNavigation,
      navigationWaitType);
    throw bridgeError("Collector TabのProjectページ読み込みがタイムアウトしました。", 0, "collector_tab_navigation_timeout");
  }
  if (navigationWaitStartedAt !== null) {
    // A tabs.update call is only a request. Count its document navigation
    // after the tab has reached the ready state so a rejected or timed-out
    // request cannot inflate full_page_navigation_count.
    recordCollectorProjectDiscoveryEfficiencyNavigation(
      requestId,
      navigationWaitType,
      Number.isSafeInteger(trace.project_index) ? trace.project_index : null);
    recordCollectorProjectDiscoveryEfficiencyDocumentNavigation(
      requestId,
      navigationKey);
  }
  recordCollectorProjectDiscoveryEfficiencyNavigationWait(
    contextRequests.get(requestId),
    navigationWaitStartedAt,
    isProjectNavigation,
    navigationWaitType);
  if (!isProjectNavigation) {
    diagnostic("collector root navigation completed", {
      ...navigationTrace,
      status: "completed",
      stage: "collector_root_url_navigation_completed",
      target_tab_id: updated.id
    });
  }
  return updated;
}

async function readCollectorViewport(tab, trace = {}) {
  const requestId = trace.request_id || collectorWindowState.requestId || "collector-viewport";
  const result = await dispatchToContentScript(tab.id, {
    type: "GET_COLLECTOR_VIEWPORT",
    requestId
  }, trace, {
    timeoutMs: CONTENT_SCRIPT_TIMEOUT_MS,
    timeoutStage: "collector_viewport_timeout"
  });
  const responseRequestId = result?.requestId || result?.request_id;
  if (responseRequestId && requestId && responseRequestId !== requestId) {
    throw bridgeError(
      "Collector viewport responseの識別情報が一致しません。",
      0,
      "collector_viewport_response_correlation_failed");
  }
  if (!result || result.status !== "ok") {
    throw bridgeError(
      "Collector Tabのviewportを確認できませんでした。",
      0,
      result?.errorCode || result?.error_code || "collector_viewport_unavailable");
  }
  return result;
}

function validateCollectorRootHydrationResponse(source, pending, tab, navigationGeneration) {
  const requestId = source?.requestId || source?.request_id;
  const responseGeneration = source?.refresh_generation;
  const responseNavigationGeneration = source?.navigation_generation;
  if (!source || typeof source !== "object"
    || source.type !== "COLLECTOR_ROOT_HYDRATION_RESULT"
    || requestId !== pending.requestId
    || responseGeneration !== pending.generation
    || responseNavigationGeneration !== navigationGeneration
    || source.collector_tab_id !== tab.id) {
    throw bridgeError(
      "Root Sidebar hydration responseの識別情報が一致しません。",
      0,
      "collector_root_hydration_correlation_failed");
  }
  if (!isCollectorRootUrl(source.expected_root_url)
    || source.root_url_verified !== true
    || source.document_ready_state !== "complete"
    || source.root_hydration_completed !== true
    || source.sidebar_root_present !== true
    || source.sidebar_scroll_container_present !== true
    || source.sidebar_shell_present !== true
    || source.sidebar_sections_stable !== true) {
    throw bridgeError(
      "Root Sidebarのhydrationが完了しませんでした。",
      0,
      source.errorCode || source.error_code || "collector_root_hydration_timeout");
  }
  return source;
}

async function waitForRootSidebarHydration(tab, pending, request, attempt = 0) {
  throwIfCollectorRequestSuperseded(pending);
  incrementCollectorProjectDiscoveryEfficiency(pending, "rootHydrationRunCount");
  const navigationGeneration = "refresh-" + pending.generation + "-root-" + (attempt + 1);
  const startedAt = Date.now();
  pending.rootNavigationGeneration = navigationGeneration;
  collectorWindowState = {
    ...collectorWindowState,
    rootHydrationStarted: true,
    rootHydrationCompleted: false,
    rootHydrationTimeout: false,
    hydrationWaitMs: 0,
    documentReadyState: null,
    sidebarRootPresent: false,
    sidebarScrollContainerPresent: false,
    sidebarShellPresent: false,
    sidebarSectionsStable: false,
    mutationCount: 0,
    mutationQuietMs: 0,
    rootUrlVerified: false,
    rootNavigationGeneration: navigationGeneration
  };
  diagnostic("collector root hydration started", {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: tab.id,
    expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
    root_navigation_generation: navigationGeneration,
    root_hydration_started: true,
    root_hydration_completed: false,
    root_hydration_timeout: false,
    status: "started",
    stage: "collector_root_hydration_start",
    target_tab_id: tab.id
  });

  let source;
  let hydrationWaitRecorded = false;
  try {
    source = await dispatchToContentScript(tab.id, {
      type: "GET_COLLECTOR_ROOT_HYDRATION",
      requestId: pending.requestId,
      refreshGeneration: pending.generation,
      navigationGeneration,
      collectorTabId: tab.id,
      expectedRootUrl: COLLECTOR_TAB_URL,
      timeoutMs: COLLECTOR_ROOT_HYDRATION_TIMEOUT_MS,
      quietMs: COLLECTOR_ROOT_HYDRATION_QUIET_MS,
      pollMs: COLLECTOR_ROOT_HYDRATION_POLL_MS
    }, {
      ...request,
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      root_navigation_generation: navigationGeneration,
      expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
      stage: "collector_root_hydration_wait"
    }, {
      timeoutMs: COLLECTOR_ROOT_HYDRATION_TIMEOUT_MS + 5000,
      timeoutStage: "collector_root_hydration_timeout"
    });
    // Count an actual root URL verification result, not every caller-side
    // no-op navigation check. The Content Script has already evaluated the
    // expected URL as part of this hydration response.
    incrementCollectorProjectDiscoveryEfficiency(
      pending,
      "rootUrlVerificationCount");
    const hydrationElapsed = Math.max(0, Date.now() - startedAt);
    if (Number.isSafeInteger(source?.hydration_poll_count) && source.hydration_poll_count >= 0) {
      pending.projectDiscoveryEfficiency.rootHydrationPollCount += source.hydration_poll_count;
    }
    if (Number.isSafeInteger(source?.hydration_poll_wait_ms) && source.hydration_poll_wait_ms >= 0) {
      pending.projectDiscoveryEfficiency.rootHydrationPollWaitMs += source.hydration_poll_wait_ms;
      pending.projectDiscoveryEfficiency.totalPollWaitMs += source.hydration_poll_wait_ms;
    }
    if (Number.isSafeInteger(source?.hydration_poll_interval_ms)
      && source.hydration_poll_interval_ms >= 0) {
      pending.projectDiscoveryEfficiency.rootHydrationPollIntervalMs =
        source.hydration_poll_interval_ms;
    }
    mergeCollectorVisibilityTelemetry(pending.projectDiscoveryEfficiency, source);
    addCollectorProjectDiscoveryEfficiencyDuration(
      pending,
      "rootHydrationWaitMs",
      hydrationElapsed);
    addCollectorProjectDiscoveryEfficiencyDuration(
      pending,
      "totalDomWaitMs",
      hydrationElapsed);
    hydrationWaitRecorded = true;
  } catch (error) {
    const elapsed = Math.max(0, Date.now() - startedAt);
    if (!hydrationWaitRecorded) {
      addCollectorProjectDiscoveryEfficiencyDuration(
        pending,
        "rootHydrationWaitMs",
        elapsed);
      addCollectorProjectDiscoveryEfficiencyDuration(
        pending,
        "totalDomWaitMs",
        elapsed);
    }
    const timeoutLike = error?.code === "send_failed"
      || error?.code === "collector_root_hydration_timeout";
    collectorWindowState = {
      ...collectorWindowState,
      rootHydrationCompleted: false,
      rootHydrationTimeout: timeoutLike,
      hydrationWaitMs: elapsed
    };
    diagnostic("collector root hydration failed", {
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
      root_navigation_generation: navigationGeneration,
      root_hydration_started: true,
      root_hydration_completed: false,
      root_hydration_timeout: timeoutLike,
      hydration_wait_ms: elapsed,
      status: "error",
      error_code: timeoutLike ? "collector_root_hydration_timeout" : error?.code,
      stage: error?.stage || "collector_root_hydration_dispatch",
      target_tab_id: tab.id
    });
    throw bridgeError(
      "Root Sidebarのhydrationが完了しませんでした。",
      0,
      timeoutLike ? "collector_root_hydration_timeout" : error?.code || "collector_root_hydration_failed");
  }

  recordCollectorRootHydrationTelemetry(source, pending, {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    root_navigation_generation: navigationGeneration,
    status: source.status === "ok" ? "observed" : "error",
    error_code: source.errorCode || source.error_code,
    stage: source.stage || "collector_root_hydration_observed"
  });

  try {
    validateCollectorRootHydrationResponse(source, pending, tab, navigationGeneration);
    const rootVerificationStartedAt = Date.now();
    try {
      const currentTab = typeof chrome.tabs?.get === "function"
        ? await chrome.tabs.get(tab.id)
        : tab;
      if (!currentTab || currentTab.windowId !== collectorWindowState.windowId
        || !isCollectorRootUrl(currentTab.url)
        || (typeof currentTab.status === "string" && currentTab.status !== "complete")) {
        throw bridgeError(
          "Root navigation generationが一致しません。",
          0,
          "collector_root_navigation_generation_mismatch");
      }
      recordCollectorRootHydrationTelemetry(source, pending, {
        request_id: pending.requestId,
        refresh_generation: pending.generation,
        root_navigation_generation: navigationGeneration,
        root_hydration_started: true,
        root_hydration_completed: true,
        root_hydration_timeout: false,
        root_url_verified: true,
        status: "completed",
        stage: "collector_root_hydration_complete"
      });
      return currentTab;
    } finally {
      // This is only the final background-side URL/tab verification phase.
      // Content Script hydration and its polling are accounted separately.
      addCollectorProjectDiscoveryEfficiencyDuration(
        pending,
        "rootUrlVerificationWaitMs",
        Math.max(0, Date.now() - rootVerificationStartedAt));
    }
  } catch (error) {
    const elapsed = Math.max(0, Date.now() - startedAt);
    const errorCode = error?.code || "collector_root_hydration_timeout";
    collectorWindowState = {
      ...collectorWindowState,
      rootHydrationCompleted: false,
      rootHydrationTimeout: errorCode === "collector_root_hydration_timeout",
      hydrationWaitMs: Math.max(collectorWindowState.hydrationWaitMs, elapsed)
    };
    diagnostic("collector root hydration failed", {
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tab.id,
      expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
      root_navigation_generation: navigationGeneration,
      root_hydration_started: true,
      root_hydration_completed: false,
      root_hydration_timeout: errorCode === "collector_root_hydration_timeout",
      hydration_wait_ms: Math.max(collectorWindowState.hydrationWaitMs, elapsed),
      status: "error",
      error_code: errorCode,
      stage: error?.stage || "collector_root_hydration_validation",
      target_tab_id: tab.id
    });
    throw error;
  }
}

// Readiness only: this function may reconcile/resize/wait for the Collector
// medium, but it must not scroll the Sidebar or collect Project rows. Project
// discovery is deliberately owned by collectProjectsOnce().
async function ensureCollectorReady(tab, trace = {}) {
  let currentTab = await reconcileCollectorWindowTabs(
    collectorWindowState.windowId,
    tab?.id,
    trace);
  if (!currentTab) {
    throw bridgeError(
      "Collector Window内にCollector Tabがありません。",
      0,
      "collector_tab_count_invalid");
  }
  currentTab = await enforceCollectorTab(currentTab, trace);
  let viewportRetryCount = 0;
  let sidebarRetryCount = 0;
  while (true) {
    const window = await getCollectorWindow();
    if (!window) {
      throw bridgeError(
        "Collector Windowが存在しません。",
        0,
        "collector_window_unavailable");
    }
    const viewport = await readCollectorViewport(currentTab, trace);
    const contentWidth = positiveDimension(viewport.content_inner_width) || 0;
    const contentHeight = positiveDimension(viewport.content_inner_height);
    recordCollectorViewportTelemetry(window, viewport, viewportRetryCount, trace);

    const viewportReady = contentWidth >= COLLECTOR_CONTENT_MIN_WIDTH;
    const sidebarReady = viewport.sidebar_ready === true;
    if (viewportReady && sidebarReady) {
      collectorWindowLifecycle("SidebarReady", {
        windowId: window.id,
        tabId: currentTab.id,
        windowWidth: positiveDimension(window.width),
        windowHeight: positiveDimension(window.height),
        contentInnerWidth: contentWidth,
        contentInnerHeight: contentHeight,
        sidebarExpectedVisible: true,
        viewportRetryCount
      });
      return currentTab;
    }

    const retryLimitReached = viewportReady
      ? sidebarRetryCount >= COLLECTOR_SIDEBAR_READY_MAX_RETRIES
      : viewportRetryCount >= COLLECTOR_VIEWPORT_MAX_RETRIES;
    if (retryLimitReached) {
      const errorCode = viewportReady
        ? "collector_sidebar_not_ready"
        : "collector_viewport_too_narrow";
      const message = viewportReady
        ? "ChatGPT Project sidebarの準備が完了しませんでした。"
        : "Collector Windowのviewport幅が不足しています。";
      collectorWindowLifecycle("Failed", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount: viewportRetryCount
      });
      diagnostic("collector viewport readiness failed", {
        ...trace,
        collector_window_id: window.id,
        collector_tab_id: currentTab.id,
        collector_window_width: collectorWindowState.windowWidth,
        collector_window_height: collectorWindowState.windowHeight,
        collector_content_inner_width: collectorWindowState.contentInnerWidth,
        collector_content_inner_height: collectorWindowState.contentInnerHeight,
        sidebar_expected_visible: collectorWindowState.sidebarExpectedVisible,
        viewport_retry_count: viewportRetryCount,
        error_code: errorCode,
        status: "error",
        stage: "collector_viewport_readiness"
      });
      throw bridgeError(message, 0, errorCode);
    }

    if (!viewportReady) {
      viewportRetryCount += 1;
      const currentWidth = positiveDimension(window.width) || COLLECTOR_WINDOW_MIN_WIDTH;
      const currentHeight = positiveDimension(window.height) || COLLECTOR_WINDOW_FALLBACK_HEIGHT;
      const widthDeficit = Math.max(1, COLLECTOR_CONTENT_MIN_WIDTH - contentWidth);
      const nextWidth = Math.max(
        COLLECTOR_WINDOW_MIN_WIDTH,
        currentWidth + widthDeficit + 48,
        currentWidth + 1);
      collectorWindowLifecycle("ResizingViewport", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount
      });
      if (typeof chrome.windows?.update !== "function") {
        throw bridgeError(
          "Collector Windowのviewportを拡張できません。",
          0,
          "collector_viewport_resize_failed");
      }
      try {
        const resized = await chrome.windows.update(window.id, {
          width: nextWidth,
          height: currentHeight,
          state: "normal",
          focused: false
        });
        const resizedWindow = resized || await getCollectorWindow(window.id);
        if (!resizedWindow) {
          throw bridgeError("Collector Windowがresize後に見つかりません。", 0, "collector_window_unavailable");
        }
        collectorWindowState = {
          ...collectorWindowState,
          windowWidth: positiveDimension(resizedWindow.width) || nextWidth,
          windowHeight: positiveDimension(resizedWindow.height) || currentHeight
        };
      } catch (error) {
        if (error?.code === "collector_window_unavailable") throw error;
        throw bridgeError(
          "Collector Windowのviewportを拡張できません。",
          0,
          "collector_viewport_resize_failed");
      }
    } else {
      sidebarRetryCount += 1;
      collectorWindowLifecycle("WaitingSidebar", {
        windowId: window.id,
        tabId: currentTab.id,
        viewportRetryCount
      });
    }
    const retryWaitStartedAt = Date.now();
    await wait(COLLECTOR_VIEWPORT_RETRY_DELAY_MS);
    const retryWaitMs = Math.max(0, Date.now() - retryWaitStartedAt);
    const retryPending = contextRequests.get(
      trace.request_id || collectorWindowState.requestId);
    addCollectorProjectDiscoveryEfficiencyDuration(
      retryPending,
      "totalExplicitDelayMs",
      retryWaitMs);
    addCollectorProjectDiscoveryEfficiencyDuration(
      retryPending,
      "miscellaneousWaitMs",
      retryWaitMs);
    currentTab = await reconcileCollectorWindowTabs(
      collectorWindowState.windowId,
      currentTab.id,
      trace);
    if (!currentTab) {
      throw bridgeError(
        "Collector Window内にCollector Tabがありません。",
        0,
        "collector_tab_count_invalid");
    }
    currentTab = await enforceCollectorTab(currentTab, trace);
  }
}

async function getCollectorTab() {
  await hydrateCollectorWindowState();
  const window = await getCollectorWindow();
  if (!window) {
    collectorWindowState = {
      ...defaultCollectorWindowState,
      instanceId: collectorWindowState.instanceId,
      managedGeneration: collectorWindowState.managedGeneration,
      managedAt: collectorWindowState.managedAt
    };
    void persistCollectorWindowState();
    return null;
  }
  const tab = await reconcileCollectorWindowTabs(
    window.id,
    collectorWindowState.tabId,
    { stage: "collector_tab_lookup" });
  if (!tab) {
    collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: null };
    void persistCollectorWindowState();
    return null;
  }
  if (collectorTabNeedsRecovery(tab)) {
    await replaceCollectorTab(tab);
    return null;
  }
  collectorWindowState = { ...collectorWindowState, windowId: window.id, tabId: tab.id };
  return await enforceCollectorTab(tab);
}

async function releaseCollectorTab(tab) {
  if (!tab || collectorWindowState.tabId !== tab.id) return;
  let current = tab;
  try { current = await chrome.tabs.get(tab.id); } catch (_) { current = null; }
  if (!current) {
    collectorWindowState = { ...collectorWindowState, tabId: null, lifecycle: "Recoverable" };
    void persistCollectorWindowState();
    return;
  }
  if (collectorTabNeedsRecovery(current)) {
    await replaceCollectorTab(current);
    return;
  }
  try { await enforceCollectorTab(current); } catch (_) { }
  collectorWindowLifecycle("Ready", {
    tabId: current.id,
    currentProjectId: null,
    currentProjectUrl: null,
    collectorNavigationTarget: null,
    projectIndex: -1
  });
  diagnostic("collector window retained", {
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: current.id,
    target_tab_id: current.id,
    status: "ready",
    stage: "collector_window_retained"
  });
}

async function dispatchToContentScript(tabId, message, trace, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.max(100, options.timeoutMs)
    : CONTENT_SCRIPT_TIMEOUT_MS;
  const timeoutStage = typeof options.timeoutStage === "string"
    ? options.timeoutStage
    : "content_script_timeout";
  diagnostic("content script dispatched", {
    ...traceForMessage(trace, { target_tab_id: tabId })
  });
  try {
    return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
  } catch (error) {
    // A tab that was already open when the unpacked extension was reloaded
    // may not have received manifest content scripts yet. Inject the same
    // locator/DOM modules through the MV3 scripting API, then retry the
    // message. The injected code is still content-script.js; the background
    // does not inspect or mutate the ChatGPT DOM itself.
    if (!isMissingContentScriptError(error) || options.retryMissingContentScript === false) throw error;

    const ready = await waitForTabReady(tabId, Math.min(timeoutMs, CONTENT_SCRIPT_READY_TIMEOUT_MS));
    if (!ready) {
      const timeoutError = bridgeError("ChatGPT tab did not finish loading before Content Script dispatch.", 0, "content_script_unavailable");
      timeoutError.stage = timeoutStage === "content_script_timeout"
        ? "content_script_ready_timeout"
        : timeoutStage;
      throw timeoutError;
    }

    // The manifest Content Script may have become available while the tab
    // was loading.  Retry it before using executeScript so a normal page load
    // does not create a duplicate watcher/context monitor.
    try {
      return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
    } catch (retryError) {
      if (!isMissingContentScriptError(retryError) || !chrome.scripting?.executeScript) throw retryError;
    }

    diagnostic("content script injection requested", {
      ...traceForMessage(trace, { target_tab_id: tabId })
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["chatgpt-locators.js", "content-script.js"]
    });
    diagnostic("content script injected", {
      ...traceForMessage(trace, { target_tab_id: tabId })
    });
    return await sendMessageWithTimeout(tabId, message, timeoutMs, timeoutStage);
  }
}

function contextResultError(message, errorCode, text, stage) {
  return {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: message?.request_id || message?.requestId || "",
    mode: message?.mode === "current" ? "current" : "list",
    status: "error",
    projects: [],
    conversations: [],
    current: null,
    errorCode,
    message: text,
    stage
  };
}

function normalizeContextEntryId(value) {
  return safeContextIdentifier(value);
}

function normalizeContextDiscoveryKey(value) {
  return safeContextIdentifier(value);
}

function uniqueStableProjectIdCount(projects) {
  return stableProjectIdCollisionStats(projects).unique_stable_project_id_count;
}

function stableProjectIdCollisionStats(projects) {
  const details = stableProjectIdCollisionDetails(projects);
  return {
    unique_stable_project_id_count: details.unique_stable_project_id_count,
    duplicate_stable_project_id_count: details.duplicate_stable_project_id_count,
    duplicate_stable_project_id_group_count: details.duplicate_stable_project_id_group_count
  };
}

function stableProjectIdCollisionDetails(projects) {
  const fingerprints = new Map();
  const groups = new Map();
  const seenDiscoveryKeys = new Set();
  const list = Array.isArray(projects) ? projects : [];
  for (let index = 0; index < list.length; index += 1) {
    const project = list[index];
    const discoveryKey = normalizeContextDiscoveryKey(project?.discovery_key || project?.discoveryKey);
    if (discoveryKey) {
      if (seenDiscoveryKeys.has(discoveryKey)) continue;
      seenDiscoveryKeys.add(discoveryKey);
    }
    const projectId = stableChatGptProjectId(project?.project_id || project?.projectId);
    if (!projectId) continue;
    if (!fingerprints.has(projectId)) fingerprints.set(projectId, `pid-${fingerprints.size + 1}`);
    const group = groups.get(projectId) || {
      fingerprint: fingerprints.get(projectId),
      indices: [],
      discoveryKeys: new Set(),
      sources: [],
      candidateConsistency: []
    };
    group.indices.push(Number.isSafeInteger(project?.project_index) ? project.project_index : index);
    if (discoveryKey) group.discoveryKeys.add(discoveryKey);
    const source = typeof project?.identity_source === "string" && project.identity_source
      ? project.identity_source
      : "unknown";
    if (!group.sources.includes(source)) group.sources.push(source);
    if (typeof project?.identity_candidate_consistent === "boolean") {
      group.candidateConsistency.push(project.identity_candidate_consistent);
    }
    groups.set(projectId, group);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.indices.length > 1);
  let duplicateCount = 0;
  for (const group of duplicateGroups) duplicateCount += group.indices.length - 1;
  const primary = duplicateGroups[0] || null;
  const sameDiscoveryKey = primary
    ? primary.indices.length > 1 && primary.discoveryKeys.size === 1
    : false;
  let candidateConsistency = "unknown";
  if (primary && primary.candidateConsistency.length > 0) {
    candidateConsistency = primary.candidateConsistency.every((value) => value === true)
      ? "consistent"
      : "inconsistent";
  }
  return {
    unique_stable_project_id_count: groups.size,
    duplicate_stable_project_id_count: duplicateCount,
    duplicate_stable_project_id_group_count: duplicateGroups.length,
    duplicate_project_id_fingerprint: primary?.fingerprint || null,
    duplicate_project_indices: primary ? primary.indices.join(",") : "",
    duplicate_discovery_key_count: primary ? primary.discoveryKeys.size : 0,
    duplicate_rows_same_discovery_key: sameDiscoveryKey,
    collision_identity_sources: primary ? primary.sources.join(",") : "",
    collision_candidate_consistency: candidateConsistency,
    collision_first_index: primary ? primary.indices[0] : null,
    collision_second_index: primary && primary.indices.length > 1 ? primary.indices[1] : null
  };
}

function normalizeContextResult(contentResult, pending) {
  if (!contentResult || typeof contentResult !== "object") {
    return contextResultError(pending.message, "context_extraction_failed", "ChatGPT Content ScriptからContextを取得できませんでした。", "context_result_invalid");
  }
  const requestId = contentResult.requestId || contentResult.request_id;
  if (requestId !== pending.requestId
    || (contentResult.mode || "list") !== (pending.currentOnly ? "current" : "list")) {
    return contextResultError(pending.message, "context_response_correlation_failed", "ChatGPT Context responseの識別情報が一致しません。", "context_response_correlation");
  }
  if (contentResult.status === "error") {
    return contextResultError(
      pending.message,
      contentResult.errorCode || contentResult.error_code || "context_extraction_failed",
      contentResult.message || "ChatGPTのContext取得に失敗しました。",
      contentResult.stage || "context_extraction");
  }
  if (contentResult.status !== "ok") {
    return contextResultError(pending.message, "context_response_invalid", "ChatGPT Context responseが不正です。", "context_response_validation");
  }
  if (!Array.isArray(contentResult.projects) || !Array.isArray(contentResult.conversations)) {
    return contextResultError(pending.message, "context_response_invalid", "ChatGPT Context responseが不正です。", "context_metadata_validation");
  }

  const projects = [];
  const projectIds = new Set();
  const discoveryKeys = new Set();
  let skippedProjectCount = 0;
  const sourceProjectCount = contentResult.projects.length;
  for (let sourceIndex = 0; sourceIndex < contentResult.projects.length; sourceIndex += 1) {
    const item = contentResult.projects[sourceIndex];
    const projectId = normalizeContextEntryId(item?.project_id || item?.projectId);
    const discoveryKey = normalizeContextDiscoveryKey(item?.discovery_key || item?.discoveryKey);
    const stableLocatorKey = normalizeContextDiscoveryKey(item?.stable_locator_key || item?.stableLocatorKey);
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(item?.url);
    const hasProjectId = Boolean(item && Object.prototype.hasOwnProperty.call(item, "project_id")
      && item.project_id !== null && item.project_id !== undefined);
    const hasDiscoveryKey = Boolean(item && Object.prototype.hasOwnProperty.call(item, "discovery_key")
      && item.discovery_key !== null && item.discovery_key !== undefined);
    const hasUrl = Boolean(item && Object.prototype.hasOwnProperty.call(item, "url") && item.url !== null && item.url !== undefined);
    const hasTitle = title.length > 0;
    const projectIdPatternValid = !hasProjectId || Boolean(projectId);
    const urlPatternValid = !hasUrl || Boolean(url);
    if (!hasTitle
      || (hasProjectId && !projectId)
      || (hasDiscoveryKey && !discoveryKey)
      || (!projectId && !discoveryKey)
      || (hasUrl && !url)) {
      return contextResultError(pending.message, "context_metadata_invalid", "ChatGPT Project metadataが不正です。", "context_metadata_validation");
    }

    const duplicateDiscoveryKey = Boolean(discoveryKey && discoveryKeys.has(discoveryKey));
    const duplicateProjectId = Boolean(projectId && projectIds.has(projectId));
    let skipReason = null;
    if (duplicateDiscoveryKey) skipReason = "duplicate_discovery_key";
    else if (duplicateProjectId && !discoveryKey) skipReason = "duplicate_project_id";
    const duplicateNormalizedKey = skipReason !== null;
    const kept = skipReason === null;
    if (!kept) {
      skippedProjectCount += 1;
    } else {
      if (projectId) projectIds.add(projectId);
      if (discoveryKey) discoveryKeys.add(discoveryKey);
      projects.push({
        ...(projectId ? { project_id: projectId } : {}),
        title,
        ...(url ? { url } : {}),
        ...(discoveryKey ? { discovery_key: discoveryKey } : {}),
        ...(stableLocatorKey ? { stable_locator_key: stableLocatorKey } : {})
      });
    }

    diagnostic("chatgpt.context project normalization", {
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      stage: "context_project_normalization",
      source_project_index: sourceIndex,
      source_project_count: sourceProjectCount,
      normalization_status: kept ? "kept" : "skipped",
      skip_reason: skipReason || "none",
      has_project_id: Boolean(projectId),
      project_id_pattern_valid: projectIdPatternValid,
      has_discovery_key: Boolean(discoveryKey),
      has_title: hasTitle,
      has_url: Boolean(url),
      url_pattern_valid: urlPatternValid,
      duplicate_project_id: duplicateProjectId,
      duplicate_discovery_key: duplicateDiscoveryKey,
      duplicate_normalized_key: duplicateNormalizedKey,
      normalized_identity_source: projectId && discoveryKey
        ? "project_id_and_discovery_key"
        : (projectId ? "project_id" : "discovery_key"),
      output_project_index: kept ? projects.length - 1 : -1,
      output_project_count: projects.length,
      status: kept ? "ok" : "skipped",
      target_tab_id: pending.tabId
    });
  }

  const conversations = [];
  const conversationIds = new Set();
  for (const item of contentResult.conversations) {
    const conversationId = normalizeContextEntryId(item?.conversation_id || item?.conversationId);
    const title = typeof item?.title === "string" ? item.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(item?.url);
    const projectId = normalizeContextEntryId(item?.project_id || item?.projectId);
    const projectTitle = typeof (item?.project_title || item?.projectTitle) === "string"
      ? String(item.project_title || item.projectTitle).trim().slice(0, 512)
      : "";
    const hasProjectId = item && Object.prototype.hasOwnProperty.call(item, "project_id") && item.project_id !== null && item.project_id !== undefined;
    const hasProjectTitle = item && Object.prototype.hasOwnProperty.call(item, "project_title") && item.project_title !== null && item.project_title !== undefined;
    if (!conversationId || !title || !url || (hasProjectId && !projectId) || (hasProjectTitle && !projectTitle)) {
      return contextResultError(pending.message, "context_metadata_invalid", "ChatGPT Conversation metadataが不正です。", "context_metadata_validation");
    }
    if (conversationIds.has(conversationId)) continue;
    if (projectId && !projectIds.has(projectId)) {
      // A conversation may be visible before its project home link is
      // rendered. Preserve the relationship; Desktop will create a safe
      // placeholder Project option for it.
      projectIds.add(projectId);
    }
    conversationIds.add(conversationId);
    conversations.push({
      conversation_id: conversationId,
      title,
      url,
      ...(projectId ? { project_id: projectId } : {}),
      ...(projectTitle ? { project_title: projectTitle } : {})
    });
  }

  const current = normalizeCurrentContext(contentResult.current);
  return {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: pending.requestId,
    mode: pending.currentOnly ? "current" : "list",
    status: "ok",
    projects,
    conversations,
    current,
    context_normalized_skipped_project_count: skippedProjectCount,
    source_collector_project_count: contentResult.projects.length
  };
}

function sendChatGptContextResponseToBridge(result, pending) {
  const envelope = {
    type: pending.currentOnly ? CHATGPT_CONTEXT_CURRENT_RESPONSE_TYPE : CHATGPT_CONTEXT_LIST_RESPONSE_TYPE,
    request_id: result.requestId,
    status: result.status,
  };
  if (result.status === "ok") {
    envelope.projects = result.projects || [];
    envelope.conversations = result.conversations || [];
    envelope.current = result.current || null;
  }
  if (result.errorCode) envelope.error_code = result.errorCode;
  if (result.message) envelope.message = result.message;
  if (result.stage) envelope.stage = result.stage;

  if (pending.bridgeSocket?.readyState !== WebSocket.OPEN || socket !== pending.bridgeSocket) {
    diagnostic("chatgpt.context response dropped", {
      request_id: result.requestId,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_bridge_send",
      target_tab_id: pending.tabId
    });
    return false;
  }
  try {
    pending.bridgeSocket.send(JSON.stringify(envelope));
    diagnostic("chatgpt.context response sent", {
      request_id: result.requestId,
      refresh_generation: pending.generation,
      status: result.status,
      error_code: result.errorCode,
      stage: result.stage || "context_response_sent",
      context_result_project_count: Array.isArray(envelope.projects) ? envelope.projects.length : 0,
      context_result_chat_count: Array.isArray(envelope.conversations) ? envelope.conversations.length : 0,
      forwarded_project_count: Array.isArray(envelope.projects) ? envelope.projects.length : 0,
      forwarded_chat_count: Array.isArray(envelope.conversations) ? envelope.conversations.length : 0,
      forwarding_source: pending.currentOnly
        ? "request_current"
        : (pending.projectOnly ? "refresh_result" : "refresh_result"),
      target_tab_id: pending.tabId
    });
    return true;
  } catch (_) {
    diagnostic("chatgpt.context response failed", {
      request_id: result.requestId,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_bridge_send",
      target_tab_id: pending.tabId
    });
    return false;
  }
}

async function completeContextRequest(contentResult, pending) {
  if (!pending || contextRequests.get(pending.requestId) !== pending) return;
  contextRequests.delete(pending.requestId);
  if (!isCurrentCollectorRequest(pending)) {
    diagnostic("chatgpt.context stale result discarded", {
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      status: "discarded",
      error_code: "context_refresh_superseded",
      stage: "context_stale_result_discarded",
      source_collector_project_count: Array.isArray(contentResult?.projects)
        ? contentResult.projects.length
        : 0,
      target_tab_id: pending.tabId
    });
    return;
  }
  const catalogSource = !pending.currentOnly && !pending.projectOnly
    && Array.isArray(pending.projectDiscoveryResult?.projects)
    && pending.projectDiscoveryResult.projects.length > 0
    ? pending.projectDiscoveryResult
    : contentResult;
  const publishSource = catalogSource === contentResult
    ? contentResult
    : {
      ...contentResult,
      status: contentResult?.status || catalogSource.status,
      projects: catalogSource.projects,
      conversations: Array.isArray(contentResult?.conversations)
        ? contentResult.conversations
        : catalogSource.conversations,
      current: contentResult?.current ?? catalogSource.current
    };
  if (catalogSource !== contentResult
    && Array.isArray(contentResult?.projects)
    && contentResult.projects.length !== catalogSource.projects.length) {
    diagnostic("chatgpt.context catalog preserved from collector final", {
      request_id: pending.requestId,
      refresh_generation: pending.generation,
      source_collector_project_count: catalogSource.projects.length,
      context_result_project_count: contentResult.projects.length,
      collector_final_project_count: catalogSource.projects.length,
      status: "preserved",
      stage: "context_catalog_preserved",
      target_tab_id: pending.tabId
    });
  }
  const result = normalizeContextResult(publishSource, pending);
  diagnostic("chatgpt.context result", {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    status: result.status,
    error_code: result.errorCode,
    stage: result.stage || "context_result",
    source_collector_project_count: Array.isArray(publishSource?.projects)
      ? publishSource.projects.length
      : 0,
    collector_final_project_count: Array.isArray(pending.projectDiscoveryResult?.projects)
      ? pending.projectDiscoveryResult.projects.length
      : (Array.isArray(publishSource?.projects) ? publishSource.projects.length : 0),
    collector_final_chat_count: Array.isArray(pending.projectDiscoveryResult?.conversations)
      ? pending.projectDiscoveryResult.conversations.filter(isProjectlessCollectorConversation).length
      : (Array.isArray(publishSource?.conversations) ? publishSource.conversations.length : 0),
    context_result_project_count: Array.isArray(result.projects) ? result.projects.length : 0,
    context_result_chat_count: Array.isArray(result.conversations) ? result.conversations.length : 0,
    context_normalized_skipped_project_count: result.context_normalized_skipped_project_count,
    unique_stable_project_id_count: uniqueStableProjectIdCount(result.projects),
    target_tab_id: pending.tabId
  });
  sendChatGptContextResponseToBridge(result, pending);
}

function collectorProjectTarget(project) {
  const explicitProjectId = stableChatGptProjectId(project?.project_id || project?.projectId);
  const projectUrl = safeChatGptProjectUrl(project?.url);
  const urlProjectId = chatGptProjectId(projectUrl);
  if (!projectUrl || !urlProjectId) return null;
  const projectId = urlProjectId;
  if (urlProjectId && explicitProjectId && urlProjectId !== explicitProjectId) return null;
  return {
    projectId,
    projectUrl,
    identitySource: typeof project?.identity_source === "string" ? project.identity_source : null,
    navigationFallbackUsed: project?.navigation_fallback_attempted === true
      || project?.navigation_fallback_success === true,
    discoveryIndex: Number.isSafeInteger(project?.discovery_index) && project.discovery_index >= 0
      ? project.discovery_index
      : null
  };
}

function mergeCollectorMetadata(destination, source, forcedProjectId = null) {
  if (!source || typeof source !== "object") {
    throw bridgeError("ChatGPT CollectorからContextを取得できませんでした。", 0, "context_extraction_failed");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== destination.requestId || (source.mode || "list") !== "list") {
    throw bridgeError("ChatGPT Context responseの識別情報が一致しません。", 0, "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPTのContext取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_extraction_failed");
  }
  if (source.status !== "ok"
    || !Array.isArray(source.projects)
    || !Array.isArray(source.conversations)) {
    throw bridgeError("ChatGPT Context responseが不正です。", 0, "context_response_invalid");
  }
  if (Number.isSafeInteger(source.unresolved_project_count) && source.unresolved_project_count > 0) {
    throw bridgeError(
      "ChatGPT ProjectのIDを完全には取得できませんでした。",
      0,
      "context_projects_incomplete");
  }

  for (const sourceProject of source.projects) {
    const projectId = safeContextIdentifier(sourceProject?.project_id || sourceProject?.projectId);
    const discoveryKey = safeContextIdentifier(sourceProject?.discovery_key || sourceProject?.discoveryKey);
    const stableLocatorKey = safeContextIdentifier(sourceProject?.stable_locator_key || sourceProject?.stableLocatorKey);
    const title = typeof sourceProject?.title === "string" ? sourceProject.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(sourceProject?.url);
    if (forcedProjectId && projectId && forcedProjectId !== projectId) continue;
    // A Project-page response is scoped by the requested ID. If a stale
    // sidebar also contributes several title-only rows, none of those rows
    // is safe to relabel as the requested Project.
    if (forcedProjectId && !projectId && source.projects.length > 1) continue;
    const effectiveProjectId = forcedProjectId || projectId;
    if (!title || (!effectiveProjectId && !discoveryKey)) continue;
    const existing = destination.projects.find((candidate) =>
      effectiveProjectId && candidate.project_id === effectiveProjectId
        || !effectiveProjectId && discoveryKey && candidate.discovery_key === discoveryKey);
    if (!existing) {
      if (destination.projects.length >= COLLECTOR_MAX_PROJECTS) {
        throw bridgeError("ChatGPT Project metadataの件数上限を超えました。", 0, "context_metadata_limit");
      }
      destination.projects.push({
        ...(effectiveProjectId ? { project_id: effectiveProjectId } : {}),
        title,
        ...(url ? { url } : {}),
        ...(discoveryKey ? { discovery_key: discoveryKey } : {}),
        ...(stableLocatorKey ? { stable_locator_key: stableLocatorKey } : {})
      });
    } else {
      if (title && (!existing.title || /^Project\s*\(/i.test(existing.title))) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (effectiveProjectId) existing.project_id = effectiveProjectId;
      if (discoveryKey && !existing.discovery_key) existing.discovery_key = discoveryKey;
      if (stableLocatorKey && !existing.stable_locator_key) existing.stable_locator_key = stableLocatorKey;
    }
  }

  for (const sourceConversation of source.conversations) {
    const conversationId = safeContextIdentifier(
      sourceConversation?.conversation_id || sourceConversation?.conversationId);
    const title = typeof sourceConversation?.title === "string"
      ? sourceConversation.title.trim().slice(0, 512) : "";
    const url = safeChatGptContextUrl(sourceConversation?.url);
    const explicitProjectId = safeContextIdentifier(
      sourceConversation?.project_id || sourceConversation?.projectId);
    if (!conversationId || !title || !url) continue;
    if (forcedProjectId && explicitProjectId && forcedProjectId !== explicitProjectId) continue;
    const projectId = forcedProjectId || explicitProjectId;
    const projectTitle = typeof (sourceConversation?.project_title || sourceConversation?.projectTitle) === "string"
      ? String(sourceConversation.project_title || sourceConversation.projectTitle).trim().slice(0, 512) : "";
    const existing = destination.conversations.find((candidate) =>
      candidate.conversation_id === conversationId);
    if (!existing) {
      if (destination.conversations.length >= COLLECTOR_MAX_CONVERSATIONS) {
        throw bridgeError("ChatGPT Chat metadataの件数上限を超えました。", 0, "context_metadata_limit");
      }
      destination.conversations.push({
        conversation_id: conversationId,
        title,
        url,
        ...(projectId ? { project_id: projectId } : {}),
        ...(projectTitle ? { project_title: projectTitle } : {})
      });
    } else {
      if (title && (!existing.title || existing.title === conversationId)) existing.title = title;
      if (url && !existing.url) existing.url = url;
      if (projectId && !existing.project_id) existing.project_id = projectId;
      if (projectTitle && !existing.project_title) existing.project_title = projectTitle;
    }
  }
  if (!destination.current && source.current) destination.current = source.current;
}

function validateCollectorRootResult(source, pending) {
  if (!source || typeof source !== "object") {
    throw bridgeError("ChatGPT CollectorからContextを取得できませんでした。", 0, "context_extraction_failed");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== pending.requestId || (source.mode || "list") !== "list") {
    throw bridgeError("ChatGPT Context responseの識別情報が一致しません。", 0, "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPTのContext取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_extraction_failed");
  }
  if (source.status !== "ok"
      || !Array.isArray(source.projects)
      || !Array.isArray(source.conversations)) {
    throw bridgeError("ChatGPT Context responseが不正です。", 0, "context_response_invalid");
  }
  const reportedUnresolved = Number.isSafeInteger(source.unresolved_project_count)
    ? Math.max(0, source.unresolved_project_count)
    : 0;
  // The root scan is the only source of the Project catalog. A title-only row
  // is useful for display diagnostics, but it is not a safe navigation target
  // and must never make the final metadata snapshot look complete.
  const resolution = collectProjectMetadataResolution(source);
  const scanProjects = pending?.projectDiscoveryScanResult?.projects;
  const scanCount = Array.isArray(scanProjects) ? scanProjects.length : 0;
  const provisionalCount = collectorDiscoveryProvisionals(pending?.projectDiscoveryScanResult).length;
  const identityInputCount = Number.isSafeInteger(
    pending?.projectDiscoveryEfficiency?.identityInputCount)
    ? pending.projectDiscoveryEfficiency.identityInputCount
    : 0;
  const expectedLogicalCount = identityInputCount > 0
    ? identityInputCount
    : scanCount;
  if (expectedLogicalCount > 0) {
    const finalCount = source.projects.length;
    if (finalCount < expectedLogicalCount
      || finalCount > expectedLogicalCount + Math.max(0, provisionalCount)) {
      return Math.max(
        1,
        Math.max(reportedUnresolved, resolution.unresolvedCount));
    }
  }
  return Math.max(reportedUnresolved, resolution.unresolvedCount);
}

function collectorProjectMetadataResolution(project) {
  const rawTitle = typeof project?.title === "string" ? project.title.trim() : "";
  const rawProjectIdValue = project?.project_id || project?.projectId;
  const rawProjectId = typeof rawProjectIdValue === "string" ? rawProjectIdValue.trim() : "";
  const rawProjectUrl = typeof project?.url === "string" ? project.url.trim() : "";
  const explicitProjectId = safeContextIdentifier(rawProjectIdValue);
  const projectUrl = safeChatGptProjectUrl(rawProjectUrl);
  const urlProjectId = chatGptProjectId(projectUrl);
  // A Project is complete only when its display metadata and stable
  // navigation identity are both present. The navigation helper intentionally
  // does not require a title because it is also used while checking a target,
  // but the final catalog must not publish a title-less Project.
  const resolved = rawTitle.length > 0 && collectorProjectTarget(project) !== null;
  let unresolvedReason = null;

  if (!resolved) {
    if (!rawTitle) unresolvedReason = "missing_title";
    else if (rawProjectId && !explicitProjectId) unresolvedReason = "invalid_project_id";
    else if (rawProjectUrl && !projectUrl) unresolvedReason = "invalid_project_url";
    else if (explicitProjectId && urlProjectId && explicitProjectId !== urlProjectId) {
      unresolvedReason = "project_id_url_mismatch";
    } else if (explicitProjectId && !explicitProjectId.toLowerCase().startsWith("g-p-")) {
      unresolvedReason = "invalid_project_id";
    } else {
      unresolvedReason = "missing_stable_identity";
    }
  }

  return {
    titlePresent: rawTitle.length > 0,
    projectIdPresent: rawProjectId.length > 0,
    urlPresent: rawProjectUrl.length > 0,
    resolved,
    unresolvedReason
  };
}

function collectProjectMetadataResolution(source) {
  const projects = Array.isArray(source?.projects) ? source.projects : [];
  const items = projects.map((project, projectIndex) => ({
    projectIndex,
    ...collectorProjectMetadataResolution(project)
  }));
  const unresolvedReasonCounts = new Map();
  for (const item of items) {
    if (item.resolved) continue;
    const reason = item.unresolvedReason || "missing_stable_identity";
    unresolvedReasonCounts.set(reason, (unresolvedReasonCounts.get(reason) || 0) + 1);
  }
  const resolvedCount = items.filter((item) => item.resolved).length;
  const reportedUnresolvedCount = Number.isSafeInteger(source?.unresolved_project_count)
    ? Math.max(0, source.unresolved_project_count)
    : 0;
  return {
    discoveredCount: items.length,
    resolvedCount,
    unresolvedCount: items.length - resolvedCount,
    reportedUnresolvedCount,
    items,
    unresolvedReasonCounts
  };
}

function updateCollectorProjectIdentityDiagnostic(pending, projectIndex, fields = {}) {
  if (!pending || !Number.isSafeInteger(projectIndex) || projectIndex < 0) return;
  if (!(pending.identityDiagnostics instanceof Map)) {
    pending.identityDiagnostics = new Map();
  }
  const prior = pending.identityDiagnostics.get(projectIndex) || {};
  const next = { ...prior };
  for (const key of [
    "unresolved_reason",
    "identity_source",
    "selected_match_method",
    "match_method",
    "navigation_failure_reason",
    "internal_reason",
    "relocation_skip_reason"
  ]) {
    if (typeof fields[key] === "string" && fields[key].length <= 128) next[key] = fields[key];
  }
  for (const key of [
    "stable_identity_candidate_count",
    "distinct_candidate_project_id_count",
    "stable_fingerprint_match_count",
    "title_match_count",
    "title_duplicate_count",
    "catalog_title_match_count",
    "child_chat_count",
    "child_project_url_count",
    "navigation_owner_project_index"
  ]) {
    if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) next[key] = fields[key];
  }
  for (const key of [
    "identity_candidate_consistent",
    "project_id_extracted",
    "relocation_attempted",
    "relocation_success",
    "fingerprint_match",
    "nested_project_url_found",
    "navigation_fallback_attempted",
    "navigation_fallback_success",
    "navigation_target_verified",
    "collision_detected",
    "navigation_generation_match",
    "navigation_started_for_project",
    "navigation_completed_for_project",
    "navigation_target_verified_for_project",
    "navigation_owned_by_current_project",
    "stale_navigation_result_rejected",
    "current_url_used_as_identity",
    "candidate_search_attempted",
    "scroll_search_attempted",
    "scroll_search_stagnated",
    "visibility_recovery_attempted",
    "visibility_recovery_success"
  ]) {
    if (typeof fields[key] === "boolean") next[key] = fields[key];
  }
  pending.identityDiagnostics.set(projectIndex, next);
}

function recordCollectorProjectMetadataResolution(source, pending) {
  const resolution = collectProjectMetadataResolution(source);
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    project_discovery_result_received: pending?.collectorProjectDiscoveryResultShape !== undefined,
    background_projects_length: resolution.discoveredCount,
    response_shape: pending?.collectorProjectDiscoveryResultShape?.responseShape
  };
  const contentDiscoveredProjectCount = pending?.collectorProjectDiscoveryResultShape
    ?.contentDiscoveredProjectCount;
  if (Number.isSafeInteger(contentDiscoveredProjectCount)) {
    base.content_discovered_project_count = contentDiscoveredProjectCount;
  }
  diagnostic("Project metadata resolution", {
    ...base,
    discovered_project_count: resolution.discoveredCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    reported_unresolved_project_count: resolution.reportedUnresolvedCount,
    status: "observed",
    stage: "collector_project_metadata_resolution",
    target_tab_id: pending?.tabId
  });
  for (const item of resolution.items) {
    const project = Array.isArray(source?.projects) ? source.projects[item.projectIndex] : null;
    updateCollectorProjectIdentityDiagnostic(pending, item.projectIndex, {
      project_id_extracted: item.projectIdPresent,
      unresolved_reason: item.unresolvedReason || "none",
      identity_source: typeof project?.identity_source === "string"
        ? project.identity_source.trim().slice(0, 128)
        : undefined,
      navigation_fallback_attempted: project?.navigation_fallback_attempted,
      navigation_fallback_success: project?.navigation_fallback_success,
      identity_candidate_consistent: project?.identity_candidate_consistent
    });
    diagnostic("collector project metadata item", {
      ...base,
      project_index: item.projectIndex,
      title_present: item.titlePresent,
      project_id_present: item.projectIdPresent,
      url_present: item.urlPresent,
      resolution_status: item.resolved ? "resolved" : "unresolved",
      unresolved_reason: item.unresolvedReason || "none",
      status: "observed",
      stage: "collector_project_metadata_item",
      target_tab_id: pending?.tabId
    });
  }
  for (const [reason, count] of resolution.unresolvedReasonCounts) {
    diagnostic("collector project metadata unresolved reason", {
      ...base,
      unresolved_reason: reason,
      unresolved_reason_count: count,
      status: "observed",
      stage: "collector_project_metadata_unresolved_reason",
      target_tab_id: pending?.tabId
    });
  }
  if (resolution.reportedUnresolvedCount > 0 && resolution.unresolvedReasonCounts.size === 0) {
    diagnostic("collector project metadata unresolved reason", {
      ...base,
      unresolved_reason: "reported_by_content_script",
      unresolved_reason_count: resolution.reportedUnresolvedCount,
      status: "observed",
      stage: "collector_project_metadata_unresolved_reason",
      target_tab_id: pending?.tabId
    });
  }
  return resolution;
}

function recordCollectorProjectMetadataResolutionFailure(resolution, pending, errorCode) {
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    discovered_project_count: efficiency?.discoveryLogicalProjectCountFinal
      || resolution.discoveredCount,
    root_discovered_logical_project_count: efficiency?.discoveryLogicalProjectCountFinal || 0,
    identity_catalog_count: efficiency?.identityInputCount || resolution.discoveredCount,
    identity_catalog_invariant_passed: efficiency?.identityCatalogInvariantPassed === true,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    reported_unresolved_project_count: resolution.reportedUnresolvedCount,
    status: "error",
    error_code: errorCode || "context_projects_incomplete",
    stage: "collector_project_metadata_resolution_failed",
    target_tab_id: pending?.tabId
  };
  diagnostic("collector project metadata resolution failed", base);
  for (const [reason, count] of resolution.unresolvedReasonCounts) {
    diagnostic("collector project metadata unresolved reason", {
      request_id: pending?.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: pending?.tabId,
      unresolved_reason: reason,
      unresolved_reason_count: count,
      status: "error",
      error_code: errorCode || "context_projects_incomplete",
      stage: "collector_project_metadata_unresolved_reason_failed",
      target_tab_id: pending?.tabId
    });
  }
  if (resolution.reportedUnresolvedCount > 0 && resolution.unresolvedReasonCounts.size === 0) {
    diagnostic("collector project metadata unresolved reason", {
      request_id: pending?.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: pending?.tabId,
      unresolved_reason: "reported_by_content_script",
      unresolved_reason_count: resolution.reportedUnresolvedCount,
      status: "error",
      error_code: errorCode || "context_projects_incomplete",
      stage: "collector_project_metadata_unresolved_reason_failed",
      target_tab_id: pending?.tabId
    });
  }
}

function collectorProjectNavigationEligible(project) {
  if (collectorProjectTarget(project)) return false;
  if (project?.navigation_eligible === false) return false;
  const reason = typeof project?.unresolved_reason === "string" ? project.unresolved_reason : "";
  if (reason === "ambiguous_project_identity"
    || reason === "project_id_url_mismatch"
    || reason === "row_visibility_exhausted"
    || reason === "project_row_fingerprint_mismatch"
    || reason === "ambiguous_project_row_match") {
    return false;
  }
  return true;
}

function collectorProjectIdentityDescriptor(project, projectIndex) {
  const descriptor = {
    project_index: projectIndex,
    discovery_index: Number.isSafeInteger(project?.discovery_index)
      && project.discovery_index >= 0
      ? project.discovery_index
      : projectIndex
  };
  if (typeof project?.title === "string" && project.title.trim().length > 0) {
    descriptor.title = project.title.trim().slice(0, 512);
  }
  const projectId = stableChatGptProjectId(project?.project_id || project?.projectId);
  if (projectId) descriptor.project_id = projectId;
  const projectUrl = safeChatGptContextUrl(project?.url);
  if (projectUrl) descriptor.url = projectUrl;
  const discoveryKey = safeContextIdentifier(project?.discovery_key || project?.discoveryKey);
  if (discoveryKey) descriptor.discovery_key = discoveryKey;
  const stableLocatorKey = safeContextIdentifier(project?.stable_locator_key || project?.stableLocatorKey);
  if (stableLocatorKey) descriptor.stable_locator_key = stableLocatorKey;
  const identitySource = typeof project?.identity_source === "string"
    ? project.identity_source.trim().slice(0, 128)
    : "";
  if (identitySource) descriptor.identity_source = identitySource;
  if (typeof project?.navigation_fallback_attempted === "boolean") {
    descriptor.navigation_fallback_attempted = project.navigation_fallback_attempted;
  }
  if (typeof project?.navigation_fallback_success === "boolean") {
    descriptor.navigation_fallback_success = project.navigation_fallback_success;
  }
  if (typeof project?.identity_candidate_consistent === "boolean") {
    descriptor.identity_candidate_consistent = project.identity_candidate_consistent;
  }
  return descriptor;
}

function validateCollectorProjectIdentityResponse(source, pending, expected = {}) {
  if (!source || typeof source !== "object") {
    throw bridgeError(
      "ChatGPT Project identity responseを取得できませんでした。",
      0,
      "context_projects_incomplete");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== pending.requestId || (source.mode || "list") !== "list") {
    throw bridgeError(
      "ChatGPT Project identity responseの識別情報が一致しません。",
      0,
      "context_response_correlation_failed");
  }
  const sourceGeneration = source.refresh_generation ?? source.refreshGeneration;
  const sourceNavigationGeneration = source.navigation_generation
    ?? source.navigationGeneration;
  const sourceCollectorTabId = source.collector_tab_id ?? source.collectorTabId;
  if ((Number.isSafeInteger(sourceGeneration) && sourceGeneration !== pending.generation)
    || (Number.isSafeInteger(sourceCollectorTabId) && sourceCollectorTabId !== pending.tabId)
    || (expected.navigationGeneration
      && sourceNavigationGeneration
      && sourceNavigationGeneration !== expected.navigationGeneration)) {
    throw bridgeError(
      "ChatGPT Project identity responseの識別情報が一致しません。",
      0,
      "context_response_correlation_failed");
  }
  if (source.status === "error") {
    throw bridgeError(
      source.message || "ChatGPT Project identity取得に失敗しました。",
      0,
      source.errorCode || source.error_code || "context_projects_incomplete");
  }
  if (source.status !== "ok"
    || !Array.isArray(source.projects)
    || !Array.isArray(source.conversations)) {
    throw bridgeError(
      "ChatGPT Project identity responseが不正です。",
      0,
      "context_response_invalid");
  }
}

function collectorProjectIdentityResponseItem(sourceProjects, projectIndex, expectedLength) {
  const list = Array.isArray(sourceProjects) ? sourceProjects : [];
  const indexed = list.find((project) =>
    Number.isSafeInteger(project?.project_index) && project.project_index === projectIndex);
  if (indexed) return indexed;
  const hasExplicitIndexes = list.some((project) => Number.isSafeInteger(project?.project_index));
  if (hasExplicitIndexes) return null;
  if (list.length === expectedLength) return list[projectIndex] || null;
  if (list.length === 1 && expectedLength === 1) return list[0];
  return null;
}

function mergeCollectorProjectIdentity(project, identityProject, projectIndex) {
  const merged = {
    ...(project && typeof project === "object" ? project : {}),
    project_index: projectIndex
  };
  if (typeof identityProject?.title === "string" && identityProject.title.trim().length > 0
    && (!merged.title || typeof merged.title !== "string")) {
    merged.title = identityProject.title.trim().slice(0, 512);
  }
  const projectId = stableChatGptProjectId(identityProject?.project_id || identityProject?.projectId);
  if (projectId) merged.project_id = projectId;
  const projectUrl = safeChatGptContextUrl(identityProject?.url);
  if (projectUrl) merged.url = projectUrl;
  const discoveryKey = safeContextIdentifier(identityProject?.discovery_key || identityProject?.discoveryKey);
  if (discoveryKey && !merged.discovery_key) merged.discovery_key = discoveryKey;
  const stableLocatorKey = safeContextIdentifier(identityProject?.stable_locator_key || identityProject?.stableLocatorKey);
  if (stableLocatorKey && !merged.stable_locator_key) merged.stable_locator_key = stableLocatorKey;
  const identitySource = typeof identityProject?.identity_source === "string"
    ? identityProject.identity_source.trim().slice(0, 128)
    : "";
  if (identitySource) merged.identity_source = identitySource;
  if (typeof identityProject?.navigation_fallback_attempted === "boolean") {
    merged.navigation_fallback_attempted = identityProject.navigation_fallback_attempted;
  }
  if (typeof identityProject?.navigation_fallback_success === "boolean") {
    merged.navigation_fallback_success = identityProject.navigation_fallback_success;
  }
  if (typeof identityProject?.identity_candidate_consistent === "boolean") {
    merged.identity_candidate_consistent = identityProject.identity_candidate_consistent;
  }
  if (typeof identityProject?.navigation_eligible === "boolean") {
    merged.navigation_eligible = identityProject.navigation_eligible;
  }
  const unresolvedReason = typeof identityProject?.unresolved_reason === "string"
    ? identityProject.unresolved_reason.trim().slice(0, 128)
    : "";
  if (projectId && projectUrl) {
    delete merged.unresolved_reason;
    merged.navigation_eligible = false;
  } else if (unresolvedReason) {
    merged.unresolved_reason = unresolvedReason;
  }
  const discoveryIndex = Number.isSafeInteger(identityProject?.discovery_index)
    && identityProject.discovery_index >= 0
    ? identityProject.discovery_index
    : (Number.isSafeInteger(merged.discovery_index) && merged.discovery_index >= 0
      ? merged.discovery_index
      : projectIndex);
  merged.discovery_index = discoveryIndex;
  return merged;
}

function mergeIdentityProgressOntoDiscovery(discoveryProjects, identityProjects) {
  const prior = Array.isArray(identityProjects) ? identityProjects : [];
  return (Array.isArray(discoveryProjects) ? discoveryProjects : []).map((project, index) => {
    const base = collectorProjectIdentityDescriptor(project, index);
    const fromPrior = prior.find((item) => {
      const priorKey = safeContextIdentifier(item?.discovery_key || item?.discoveryKey);
      if (base.discovery_key && priorKey === base.discovery_key) return true;
      if (Number.isSafeInteger(item?.project_index) && item.project_index === index) return true;
      if (Number.isSafeInteger(item?.discovery_index)
        && Number.isSafeInteger(base.discovery_index)
        && item.discovery_index === base.discovery_index) {
        return true;
      }
      return false;
    });
    return fromPrior ? mergeCollectorProjectIdentity(base, fromPrior, index) : base;
  });
}

function mergeCollectorProjectIdentityResponse(projects, source) {
  return projects.map((project, projectIndex) => {
    const item = collectorProjectIdentityResponseItem(source.projects, projectIndex, projects.length);
    return item ? mergeCollectorProjectIdentity(project, item, projectIndex) : project;
  });
}

function collectorProjectIdentityState(pending, projects, fields = {}) {
  const resolution = collectProjectMetadataResolution({ projects });
  const stateFields = {
    projectIdentityResolutionStarted: fields.project_identity_resolution_started
      ?? collectorWindowState.projectIdentityResolutionStarted,
    projectIdentityResolutionCompleted: fields.project_identity_resolution_completed
      ?? collectorWindowState.projectIdentityResolutionCompleted,
    nonNavigationResolvedCount: Number.isSafeInteger(fields.non_navigation_resolved_count)
      ? fields.non_navigation_resolved_count
      : collectorWindowState.nonNavigationResolvedCount,
    navigationResolvedCount: Number.isSafeInteger(fields.navigation_resolved_count)
      ? fields.navigation_resolved_count
      : collectorWindowState.navigationResolvedCount,
    identityUnresolvedCount: resolution.unresolvedCount,
    currentProjectIndex: Number.isSafeInteger(fields.current_project_index)
      ? fields.current_project_index
      : collectorWindowState.currentProjectIndex,
    identityResolutionMethod: fields.resolution_method || collectorWindowState.identityResolutionMethod,
    navigationTargetVerified: typeof fields.navigation_target_verified === "boolean"
      ? fields.navigation_target_verified
      : collectorWindowState.navigationTargetVerified,
    projectUrlPatternValid: typeof fields.project_url_pattern_valid === "boolean"
      ? fields.project_url_pattern_valid
      : collectorWindowState.projectUrlPatternValid,
    projectIdUrlMatch: typeof fields.project_id_url_match === "boolean"
      ? fields.project_id_url_match
      : collectorWindowState.projectIdUrlMatch
  };
  collectorWindowState = { ...collectorWindowState, ...stateFields };
  return resolution;
}

function recordCollectorProjectIdentityResolution(
  eventName,
  pending,
  projects,
  fields = {}) {
  const resolution = collectorProjectIdentityState(pending, projects, fields);
  const base = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    project_identity_resolution_started: collectorWindowState.projectIdentityResolutionStarted,
    project_identity_resolution_completed: collectorWindowState.projectIdentityResolutionCompleted,
    non_navigation_resolved_count: collectorWindowState.nonNavigationResolvedCount,
    navigation_resolved_count: collectorWindowState.navigationResolvedCount,
    unresolved_count: resolution.unresolvedCount,
    discovered_project_count: resolution.discoveredCount,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    current_project_index: collectorWindowState.currentProjectIndex,
    resolution_method: collectorWindowState.identityResolutionMethod,
    navigation_target_verified: collectorWindowState.navigationTargetVerified,
    project_url_pattern_valid: collectorWindowState.projectUrlPatternValid,
    project_id_url_match: collectorWindowState.projectIdUrlMatch,
    status: fields.status || "observed",
    stage: fields.stage || "collector_project_identity_resolution",
    target_tab_id: pending?.tabId
  };
  diagnostic(eventName, { ...base, ...fields });
  return resolution;
}

const collectorProjectIdentityNavigationTelemetryKeys = [
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
  "row_tabindex_present",
  "row_href_present",
  "row_aria_haspopup",
  "row_aria_expanded",
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
  "success",
  "target_project_present",
  "project_index_valid",
  "collector_tab_present",
  "collector_tab_matches",
  "refresh_generation_matches",
  "navigation_generation_present",
  "navigation_generation_matches",
  "navigation_generation_match",
  "navigation_started_for_project",
  "navigation_completed_for_project",
  "navigation_target_verified_for_project",
  "navigation_owned_by_current_project",
  "navigation_owner_project_index",
  "stale_navigation_result_rejected",
  "current_url_used_as_identity",
  "root_state_ready",
  "discovery_snapshot_present",
  "discovery_fingerprint_present",
  "project_section_snapshot_present",
  "navigation_failure_reason",
  "internal_reason",
  "exit_reason",
  "unresolved_reason",
  "disclosure_found",
  "child_chat_count",
  "child_project_url_count",
  "row_project_url_found",
  "nested_project_url_found",
  "stable_identity_candidate_count",
  "distinct_candidate_project_id_count",
  "candidate_project_id_fingerprints",
  "resolved_project_id_fingerprint",
  "identity_candidate_consistent",
  "discovery_key_present",
  "identity_source",
  "empty_project_candidate",
  "sidebar_child_identity_unavailable",
  "navigation_fallback_attempted",
  "navigation_fallback_success",
  "relocation_attempted",
  "relocation_success",
  "fingerprint_match",
  "fingerprint_match_component_count",
  "fingerprint_mismatch_component_count",
  "discovery_row_still_connected",
  "discovery_row_reused",
  "current_sidebar_candidate_count",
  "exact_candidate_count",
  "ambiguous_candidate_count",
  "sidebar_dom_generation_changed",
  "aria_controls_changed",
  "row_position_changed",
  "navigation_since_discovery",
  "relocation_method",
  "failure_reason",
  "relocation_attempt",
  "relocation_skip_reason",
  "candidate_search_attempted",
  "scroll_search_attempted",
  "scroll_search_stagnated",
  "more_clicked",
  "more_click_count",
  "more_attempted",
  "scroll_attempts",
  "relocation_phase",
  "catalog_entry_found",
  "catalog_title_unique",
  "catalog_title_match_count",
  "title_match_count",
  "discovery_key_match_count",
  "stable_locator_match_count",
  "volatile_locator_match_count",
  "fingerprint_version",
  "fingerprint_component_count",
  "stable_component_count",
  "volatile_component_count",
  "title_duplicate_count",
  "aria_controls_present",
  "stable_fingerprint_match_count",
  "partial_match_count",
  "ambiguous_count",
  "remount_detected",
  "candidate_set_changed",
  "selected_candidate_found",
  "selected_match_method",
  "relocation_stagnated",
  "visible_project_row_count",
  "project_section_found",
  "project_scroll_container_found",
  "scroll_required",
  "scroll_position_changed",
  "more_available",
  "relocation_elapsed_ms",
  "rows_reenumerated_after_navigation",
  "stale_discovery_row_discarded",
  "identity_catalog_count",
  "total_projects",
  "identity_elapsed_ms",
  "identity_disclosure_wait_ms",
  "identity_child_region_wait_ms",
  "identity_candidate_search_ms",
  "identity_relocation_wait_ms",
  "project_count",
  "child_chat_resolved_count",
  "navigation_resolved_count",
  "child_region_wait_total_ms",
  "child_region_wait_average_ms",
  "child_region_wait_max_ms",
  "child_region_wait_p50_ms",
  "child_region_wait_p95_ms",
  "child_region_immediate_hit_count",
  "child_region_observer_needed_count",
  "child_region_poll_needed_count",
  "child_region_early_success_count",
  "child_region_timeout_count",
  "child_region_ambiguous_count",
  "child_region_candidate_zero_count",
  "child_region_unique_candidate_count",
  "child_region_same_id_multi_candidate_count",
  "child_region_distinct_id_collision_count",
  "mutation_quiet_wait_total_ms",
  "disclosure_open_wait_total_ms",
  "remount_recovery_wait_total_ms",
  "slow_project_count",
  "slow_project_indices",
  "slow_project_ms",
  "slow_project_details",
  "identity_pass_kind",
  "timeout_ceiling_hit_count",
  "timeout_ceiling_hit_indices",
  "early_escalation_count",
  "early_escalation_indices",
  "early_escalation_reason_counts",
  "resolved_identity_skipped_count",
  "resolved_identity_rechecked_count",
  "incremental_reuse_eligible_count",
  "incremental_reuse_hit_count",
  "incremental_reuse_miss_count",
  "incremental_reuse_rejected_count",
  "incremental_reuse_learned_count",
  "incremental_reuse_no_proof_count",
  "batch_immediate_resolved_count",
  "batch_immediate_resolved_indices",
  "disclosure_required_count",
  "disclosure_required_indices",
  "per_project_disclosure_click_total_ms",
  "per_project_post_click_immediate_scan_total_ms",
  "per_project_observer_wait_total_ms",
  "per_project_poll_wait_total_ms",
  "per_project_relocation_total_ms",
  "observer_wait_count",
  "observer_wake_count",
  "observer_wake_without_target_progress_count",
  "fixed_settle_wait_total_ms",
  "controlled_region_materialized_count",
  "child_anchor_materialized_count",
  "identity_resolved_before_click_count",
  "identity_resolved_immediately_after_click_count",
  "identity_resolved_after_observer_count",
  "identity_resolved_after_poll_count",
  "slow_project_phase",
  "catalog_reused",
  "relocation_skipped_connected_row"
];

function collectorProjectIdentityNavigationTelemetryFields(source = {}) {
  const fields = {};
  for (const key of collectorProjectIdentityNavigationTelemetryKeys) {
    if (typeof source[key] === "boolean") fields[key] = source[key];
    else if (Number.isSafeInteger(source[key]) && source[key] >= 0) fields[key] = source[key];
    else if (typeof source[key] === "string" && source[key].length <= 128) fields[key] = source[key];
  }
  if (typeof source.stage === "string" && source.stage.length <= 128) {
    fields.stage = source.stage;
  }
  return fields;
}

function recordCollectorProjectIdentityNavigationTelemetry(eventName, pending, fields = {}) {
  const safeFields = collectorProjectIdentityNavigationTelemetryFields(fields);
  updateCollectorProjectIdentityDiagnostic(pending, safeFields.project_index, safeFields);
  diagnostic(eventName, {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    ...projectDiscoveryTraceFields(pending),
    project_index: Number.isSafeInteger(safeFields.project_index)
      ? safeFields.project_index
      : pending?.identityNavigationProjectIndex,
    refresh_generation: pending?.generation,
    navigation_generation: pending?.identityNavigationGeneration,
    target_tab_id: pending?.tabId,
    ...safeFields,
    total_projects: Number.isSafeInteger(pending?.identityNavigationTotalProjects)
      ? pending.identityNavigationTotalProjects
      : (Number.isSafeInteger(safeFields.total_projects)
        ? safeFields.total_projects
        : collectorWindowState.totalProjects),
    identity_catalog_count: Number.isSafeInteger(safeFields.identity_catalog_count)
      ? safeFields.identity_catalog_count
      : (Number.isSafeInteger(pending?.identityNavigationTotalProjects)
        ? pending.identityNavigationTotalProjects
        : undefined),
    stage: safeFields.stage || "collector_project_identity_navigation"
  });
}

function emitCollectorProjectIdentityFailureSummary(pending, projects, errorCode = "context_projects_incomplete", collision = null) {
  if (!pending || pending.identityFailureSummaryEmitted === true) return;
  const resolution = collectProjectMetadataResolution({ projects });
  const collisionDetails = collision || stableProjectIdCollisionDetails(projects);
  const duplicateProjectIndices = typeof collisionDetails?.duplicate_project_indices === "string"
    ? collisionDetails.duplicate_project_indices.trim()
    : "";
  const collisionIndexes = duplicateProjectIndices
    ? duplicateProjectIndices
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isSafeInteger(value) && value >= 0)
    : [];
  const failedIndexes = [...new Set([
    ...resolution.items.filter((item) => !item.resolved).map((item) => item.projectIndex),
    ...collisionIndexes
  ])].sort((left, right) => left - right);
  const failures = failedIndexes.map((projectIndex) => {
    const item = resolution.items.find((candidate) => candidate.projectIndex === projectIndex);
    const project = Array.isArray(projects) ? projects[projectIndex] : null;
    const detail = pending.identityDiagnostics instanceof Map
      ? pending.identityDiagnostics.get(projectIndex) || {}
      : {};
    const collisionDetected = collisionIndexes.includes(projectIndex);
    return {
      project_index: projectIndex,
      unresolved_reason: collisionDetected
        ? "duplicate_stable_project_id"
        : (item?.unresolvedReason
          || (detail.unresolved_reason && detail.unresolved_reason !== "none"
            ? detail.unresolved_reason
            : "missing_stable_identity")),
      identity_source: detail.identity_source
        || project?.identity_source
        || "none",
      stable_identity_candidate_count: detail.stable_identity_candidate_count || 0,
      distinct_candidate_project_id_count: detail.distinct_candidate_project_id_count || 0,
      identity_candidate_consistent: detail.identity_candidate_consistent !== false,
      project_id_extracted: detail.project_id_extracted === true
        || Boolean(project?.project_id || project?.projectId),
      row_relocation_attempted: detail.relocation_attempted === true,
      row_relocation_success: detail.relocation_success === true,
      selected_match_method: detail.selected_match_method
        || detail.match_method
        || "none",
      relocation_skip_reason: detail.relocation_skip_reason || "none",
      candidate_search_attempted: detail.candidate_search_attempted === true,
      scroll_search_attempted: detail.scroll_search_attempted === true,
      scroll_search_stagnated: detail.scroll_search_stagnated === true,
      fingerprint_match: detail.fingerprint_match === true,
      stable_fingerprint_match_count: detail.stable_fingerprint_match_count || 0,
      title_match_count: detail.title_match_count
        ?? detail.catalog_title_match_count
        ?? 0,
      title_duplicate_count: detail.title_duplicate_count
        ?? detail.catalog_title_match_count
        ?? 0,
      child_chat_count: detail.child_chat_count || 0,
      child_project_url_count: detail.child_project_url_count || 0,
      nested_project_url_found: detail.nested_project_url_found === true,
      navigation_fallback_attempted: detail.navigation_fallback_attempted === true,
      navigation_fallback_success: detail.navigation_fallback_success === true,
      navigation_target_verified: detail.navigation_target_verified === true,
      navigation_generation_match: detail.navigation_generation_match === true,
      navigation_started_for_project: detail.navigation_started_for_project === true,
      navigation_completed_for_project: detail.navigation_completed_for_project === true,
      navigation_target_verified_for_project: detail.navigation_target_verified_for_project === true,
      navigation_owned_by_current_project: detail.navigation_owned_by_current_project === true,
      navigation_owner_project_index: detail.navigation_owner_project_index ?? null,
      stale_navigation_result_rejected: detail.stale_navigation_result_rejected === true,
      current_url_used_as_identity: detail.current_url_used_as_identity === true,
      collision_detected: collisionDetected
    };
  });
  pending.identityFailureSummaryEmitted = true;
  diagnostic("collector project identity failure summary", {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    discovered_project_count: resolution.discoveredCount,
    identity_catalog_count: Array.isArray(projects) ? projects.length : 0,
    resolved_project_count: resolution.resolvedCount,
    unresolved_project_count: resolution.unresolvedCount,
    unique_stable_project_id_count: collisionDetails?.unique_stable_project_id_count || 0,
    duplicate_stable_project_id_count: collisionDetails?.duplicate_stable_project_id_count || 0,
    failed_project_indices: failedIndexes,
    failures,
    status: "error",
    error_code: errorCode,
    stage: "collector_project_identity_failure_summary",
    target_tab_id: pending.tabId
  });
}

function collectorProjectIdentityNavigationExitReason(error, fallback = "unexpected_exception") {
  const code = typeof error?.code === "string" ? error.code : "";
  if (code === "context_refresh_superseded") return "refresh_generation_mismatch";
  if (code === "collector_tab_unavailable"
    || code === "collector_tab_navigation_timeout"
    || code === "collector_tab_navigation_failed") return "collector_tab_not_ready";
  if (code === "context_response_correlation_failed") return "navigation_generation_mismatch";
  if (code === "collector_project_identity_navigation_timeout") return "navigation_timeout";
  return fallback;
}

function collectorProjectIdentityNavigationFailureReason(identityResult, target, responseProject) {
  const reportedReason = typeof identityResult?.navigation_failure_reason === "string"
    ? identityResult.navigation_failure_reason.trim()
    : "";
  if (reportedReason && reportedReason !== "none") return reportedReason;
  const itemReason = typeof responseProject?.unresolved_reason === "string"
    ? responseProject.unresolved_reason.trim()
    : "";
  if (itemReason && itemReason !== "none") return itemReason;
  if (identityResult?.navigation_target_verified !== true) return "navigation_target_not_verified";
  if (identityResult?.project_url_pattern_valid !== true) return "project_url_pattern_invalid";
  if (identityResult?.project_id_url_match !== true) return "project_id_url_mismatch";
  if (!responseProject?.project_id) return "project_id_not_extracted";
  if (!target) return "project_identity_unresolved";
  return "none";
}

function collectorProjectIdentityNavigationInternalReason(
  identityResult,
  target,
  responseProject,
  failureReason) {
  const reportedReason = typeof identityResult?.internal_reason === "string"
    ? identityResult.internal_reason.trim()
    : "";
  if (reportedReason && reportedReason !== "none") return reportedReason;
  if (failureReason === "no_safe_project_navigation_target") {
    const itemReason = typeof responseProject?.unresolved_reason === "string"
      ? responseProject.unresolved_reason.trim()
      : "";
    if (itemReason === "project_row_is_menu_control") return itemReason;
    if (itemReason === "project_row_is_overflow_control") return itemReason;
    return failureReason;
  }
  if (failureReason === "none" && target) return "none";
  return `project_identity_${failureReason || "unexpected_exception"}`;
}

function collectorProjectIdentityNavigationPreconditions(
  tab,
  pending,
  descriptor,
  targetProject,
  projectIndex,
  totalProjects,
  discovery,
  rootResult,
  rootStateReady = false) {
  const projectIndexValid = Number.isSafeInteger(projectIndex)
    && projectIndex >= 0
    && projectIndex < totalProjects;
  const discoverySnapshotPresent = Array.isArray(rootResult?.projects)
    && rootResult.projects.length > 0
    && totalProjects > 0;
  const discoveryFingerprintPresent = Boolean(
    Number.isSafeInteger(descriptor?.discovery_index)
    || (typeof descriptor?.discovery_key === "string" && descriptor.discovery_key.length > 0));
  return {
    target_project_present: Boolean(targetProject && typeof targetProject === "object"),
    project_index_valid: projectIndexValid,
    collector_tab_present: Boolean(tab && Number.isSafeInteger(tab.id)),
    collector_tab_matches: Boolean(
      tab && Number.isSafeInteger(tab.id)
      && Number.isSafeInteger(pending?.tabId)
      && tab.id === pending.tabId),
    refresh_generation_matches: Number.isSafeInteger(pending?.generation)
      && pending.generation === discovery?.refreshGeneration,
    navigation_generation_present: typeof pending?.identityNavigationGeneration === "string"
      && pending.identityNavigationGeneration.length > 0,
    navigation_generation_matches: typeof pending?.identityNavigationGeneration === "string"
      && pending.identityNavigationGeneration.length > 0
      && pending.identityNavigationGeneration === `refresh-${pending.generation}-identity-${projectIndex}`,
    root_state_ready: rootStateReady === true,
    discovery_snapshot_present: discoverySnapshotPresent,
    discovery_fingerprint_present: discoveryFingerprintPresent,
    project_section_snapshot_present: rootResult?.project_section_found === true
      || collectorWindowState.projectSectionFound === true
  };
}

function collectorProjectIdentityPendingForTab(tabId) {
  if (!Number.isSafeInteger(tabId)) return null;
  for (const pending of contextRequests.values()) {
    if (pending?.tabId === tabId
      && pending.identityNavigationActive === true
      && Number.isSafeInteger(pending.identityNavigationProjectIndex)) return pending;
  }
  return null;
}

async function handleCollectorProjectIdentityTelemetryFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const senderTabId = sender?.tab?.id;
  const pending = contextRequests.get(requestId);
  const messageGeneration = message?.refresh_generation ?? message?.refreshGeneration;
  const messageNavigationGeneration = message?.navigation_generation
    ?? message?.navigationGeneration;
  const messageCollectorTabId = message?.collector_tab_id ?? message?.collectorTabId;
  const messageProjectIndex = message?.project_index ?? message?.projectIndex;
  const identityTelemetryActive = pending?.identityTelemetryActive === true;
  const correlationValid = Boolean(
    pending
    && (pending.identityNavigationActive === true || identityTelemetryActive)
    && senderTabId === pending.tabId
    && (!Number.isSafeInteger(messageGeneration) || messageGeneration === pending.generation)
    && (!Number.isSafeInteger(messageCollectorTabId) || messageCollectorTabId === senderTabId)
    && (!Number.isSafeInteger(messageProjectIndex)
      || identityTelemetryActive
      || messageProjectIndex === pending.identityNavigationProjectIndex)
    && (!messageNavigationGeneration
      || messageNavigationGeneration === pending.identityNavigationGeneration));
  if (!correlationValid) {
    diagnostic("collector project identity navigation telemetry rejected", {
      request_id: requestId,
      refresh_generation: Number.isSafeInteger(messageGeneration) ? messageGeneration : undefined,
      collector_tab_id: messageCollectorTabId,
      target_tab_id: senderTabId,
      project_index: Number.isSafeInteger(messageProjectIndex) ? messageProjectIndex : undefined,
      navigation_generation: typeof messageNavigationGeneration === "string"
        ? messageNavigationGeneration : undefined,
      status: "error",
      error_code: "collector_project_identity_telemetry_not_correlated",
      stage: "collector_project_identity_telemetry_correlation"
    });
    return { ok: false, error: "collector_project_identity_telemetry_not_correlated" };
  }
  const fields = collectorProjectIdentityNavigationTelemetryFields(message);
  recordCollectorProjectIdentityNavigationTelemetry(
    "collector project identity navigation telemetry",
    pending,
    fields);
  return { ok: true };
}

const collectorProjectChatTelemetryKeys = [
  "project_index",
  "total_projects",
  "current_project_id",
  "current_project_identity_source",
  "current_project_identity_navigation_fallback_used",
  "current_project_identity_discovery_index",
  "project_page_ready",
  "current_project_id_verified",
  "candidate_chat_link_count",
  "candidate_chat_count",
  "candidate_from_main_count",
  "candidate_from_sidebar_count",
  "candidate_from_other_count",
  "matching_project_chat_link_count",
  "matching_project_chat_count",
  "rejected_projectless_chat_count",
  "rejected_other_project_chat_count",
  "project_more_control_count",
  "project_more_control_click_count",
  "main_candidate_with_project_id_count",
  "main_candidate_without_project_id_count",
  "main_current_project_match_count",
  "main_project_mismatch_count",
  "main_candidate_project_id_unique_count",
  "main_mismatch_project_id_unique_count",
  "main_current_project_id_occurrence_count",
  "main_mismatch_all_same_project_id",
  "main_mismatch_same_project_id_count",
  "main_mismatch_project_id",
  "project_id_source_chat_href_count",
  "project_id_source_nested_href_count",
  "project_id_source_data_attribute_count",
  "project_id_source_ancestor_count",
  "project_id_source_project_wrapper_count",
  "project_id_source_unknown_count",
  "project_chat_membership_inconsistent",
  "project_route_segment_detected",
  "project_route_has_slug",
  "project_id_normalization_applied",
  "project_id_normalization_source",
  "raw_route_project_id_matches_normalized",
  "normalized_project_id_match",
  "project_id_parse_failure_count",
  "project_id_normalization_applied_count",
  "main_projectless_count",
  "main_custom_gpt_count",
  "main_candidate_from_verified_project_region_count",
  "chat_scroll_container_count",
  "main_found",
  "main_region_found",
  "main_descendant_count",
  "chat_tab_found",
  "chat_list_found",
  "chat_list_candidate_count",
  "chat_row_candidate_count",
  "anchor_count",
  "button_count",
  "role_button_count",
  "role_link_count",
  "href_element_count",
  "data_attribute_candidate_count",
  "candidate_scroll_container_count",
  "scrollable_chat_candidate_count",
  "selected_scroll_container_found",
  "selected_scroll_client_height",
  "selected_scroll_height",
  "selected_scroll_distance_from_chat_list",
  "relevant_region_present",
  "document_ready_state",
  "mutation_count",
  "mutation_quiet_ms",
  "discovered_chat_count",
  "deduped_chat_count",
  "scan_iteration",
  "scroll_position_changed",
  "reached_end",
  "scroll_complete",
  "project_chat_collection_complete",
  "project_chat_hydration_completed",
  "project_chat_hydration_timeout",
  "chat_title_source",
  "title_element_found",
  "preview_element_found",
  "title_extraction_success",
  "title_differs_from_row_text",
  "title_fallback_used",
  "title_candidate_count",
  "title_character_count",
  "row_text_character_count",
  "title_element_found_count",
  "preview_element_found_count",
  "title_extraction_success_count",
  "title_fallback_used_count",
  "title_observed_chat_count",
  "error_code",
  "unresolved_reason",
  "failure_stage",
  "internal_reason",
  "exception_name",
  "exception_reason",
  "project_chat_collection_error_reason"
];

function collectorProjectChatTelemetryFields(source = {}) {
  const fields = {};
  for (const key of collectorProjectChatTelemetryKeys) {
    if (typeof source[key] === "boolean") fields[key] = source[key];
    else if (Number.isSafeInteger(source[key]) && source[key] >= 0) fields[key] = source[key];
    else if (typeof source[key] === "string" && source[key].length <= 128) fields[key] = source[key];
  }
  if (typeof source.stage === "string" && source.stage.length <= 128) fields.stage = source.stage;
  return fields;
}

function collectorProjectChatTelemetryEventName(stage) {
  const names = {
    collector_project_chat_dom_structure: "collector project chat dom structure",
    collector_project_chat_source_classification: "collector project chat source classification",
    collector_project_chat_scroll_candidates: "collector project chat scroll candidates",
    collector_project_chat_scan: "collector project chat scan",
    collector_project_chat_collection_complete: "collector project chat collection complete",
    collector_project_chat_collection_failed: "collector project chat collection failed"
  };
  return names[stage] || "collector project chat telemetry";
}

async function handleCollectorProjectChatTelemetryFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const senderTabId = sender?.tab?.id;
  const pending = contextRequests.get(requestId);
  const messageGeneration = message?.refresh_generation ?? message?.refreshGeneration;
  const messageCollectorTabId = message?.collector_tab_id ?? message?.collectorTabId;
  const messageProjectId = message?.current_project_id || message?.project_id;
  const pendingProjectId = pending?.currentProjectId || null;
  const correlationValid = Boolean(
    pending
    && senderTabId === pending.tabId
    && (!Number.isSafeInteger(messageGeneration) || messageGeneration === pending.generation)
    && (!Number.isSafeInteger(messageCollectorTabId) || messageCollectorTabId === senderTabId)
    && (!messageProjectId || !pendingProjectId || messageProjectId === pendingProjectId));
  if (!correlationValid) {
    diagnostic("collector project chat telemetry rejected", {
      request_id: requestId,
      collector_tab_id: messageCollectorTabId,
      target_tab_id: senderTabId,
      status: "error",
      error_code: "collector_project_chat_telemetry_not_correlated",
      stage: "collector_project_chat_telemetry_correlation"
    });
    return { ok: false, error: "collector_project_chat_telemetry_not_correlated" };
  }
  const fields = collectorProjectChatTelemetryFields(message);
  const projectIndex = Number.isSafeInteger(fields.project_index)
    ? fields.project_index
    : (Number.isSafeInteger(collectorWindowState.projectIndex)
      ? collectorWindowState.projectIndex
      : 0);
  recordCollectorProjectChatTelemetry(
    collectorProjectChatTelemetryEventName(fields.stage),
    pending,
    { projectId: pendingProjectId },
    projectIndex,
    message,
    fields);
  return { ok: true };
}

function collectorProjectIdentityFromTab(tab) {
  const projectUrl = safeChatGptProjectUrl(tab?.url);
  const projectId = chatGptProjectId(projectUrl);
  if (!projectUrl || !projectId) return null;
  return { projectId, projectUrl };
}

async function waitForCollectorProjectIdentityTab(
  tabId,
  timeoutMs = COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS,
  initialUrl = null,
  timingPending = null) {
  const startedAt = Date.now();
  const deadline = Date.now() + Math.max(250, Math.min(30000, Number(timeoutMs) || 10000));
  const initialContextUrl = safeChatGptContextUrl(initialUrl);
  while (Date.now() <= deadline) {
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch (_) { return null; }
    const identity = collectorProjectIdentityFromTab(tab);
    const loading = typeof tab?.status === "string" && tab.status !== "complete";
    const currentContextUrl = safeChatGptContextUrl(tab?.url);
    if (identity && !loading && (!initialContextUrl || currentContextUrl !== initialContextUrl)) {
      const elapsed = Math.max(0, Date.now() - startedAt);
      addCollectorProjectDiscoveryEfficiencyDuration(
        timingPending,
        "navigationFallbackMs",
        elapsed);
      addCollectorProjectDiscoveryEfficiencyDuration(
        timingPending,
        "totalNavigationWaitMs",
        elapsed);
      return identity;
    }
    const pollStartedAt = Date.now();
    await wait(Math.min(100, Math.max(0, deadline - Date.now())));
    addCollectorProjectDiscoveryEfficiencyDuration(
      timingPending,
      "totalPollWaitMs",
      Math.max(0, Date.now() - pollStartedAt));
  }
  const elapsed = Math.max(0, Date.now() - startedAt);
  addCollectorProjectDiscoveryEfficiencyDuration(
    timingPending,
    "navigationFallbackMs",
    elapsed);
  addCollectorProjectDiscoveryEfficiencyDuration(
    timingPending,
    "totalNavigationWaitMs",
    elapsed);
  return null;
}

function collectorDiscoveryProvisionals(source) {
  return Array.isArray(source?.provisional_observations) ? source.provisional_observations : [];
}

function applyCollectorProjectFields(existing, item) {
  const projectId = stableChatGptProjectId(item?.project_id || item?.projectId);
  const discoveryKey = safeContextIdentifier(item?.discovery_key || item?.discoveryKey);
  const stableLocatorKey = remountSafeLocatorKey(item);
  const url = typeof item?.url === "string" ? item.url : "";
  if (projectId) existing.project_id = projectId;
  if (url && !existing.url) existing.url = url;
  if (discoveryKey) existing.discovery_key = discoveryKey;
  if (stableLocatorKey && !existing.stable_locator_key) existing.stable_locator_key = stableLocatorKey;
}

function foldCollectorProvisionalIntoConfirmed(confirmed, observation, stats) {
  const id = stableChatGptProjectId(observation?.project_id || observation?.projectId);
  if (id) {
    const matches = confirmed.filter((candidate) =>
      stableChatGptProjectId(candidate?.project_id || candidate?.projectId) === id);
    if (matches.length === 1) {
      applyCollectorProjectFields(matches[0], observation);
      stats.provisionalSameProjectIdProofCount += 1;
      stats.provisionalObservationMergedExistingCount += 1;
      return "project_id";
    }
    if (matches.length > 1) return null;
  }
  const locator = remountSafeLocatorKey(observation);
  if (locator) {
    const matches = confirmed.filter((candidate) => remountSafeLocatorKey(candidate) === locator);
    if (matches.length === 1) {
      applyCollectorProjectFields(matches[0], observation);
      stats.provisionalSameStableLocatorProofCount += 1;
      stats.provisionalObservationMergedExistingCount += 1;
      return "stable_locator";
    }
  }
  const currentKey = safeContextIdentifier(observation?.discovery_key || observation?.discoveryKey);
  if (currentKey) {
    const matches = confirmed.filter((candidate) =>
      safeContextIdentifier(candidate?.discovery_key || candidate?.discoveryKey) === currentKey);
    if (matches.length === 1) {
      stats.provisionalFoldedSameDescriptorCount += 1;
      return "same_current_descriptor";
    }
  }
  return null;
}

function durableCollectorConfirmedIdentityProof(left, right) {
  const leftId = stableChatGptProjectId(left?.project_id || left?.projectId);
  const rightId = stableChatGptProjectId(right?.project_id || right?.projectId);
  if (leftId && rightId && leftId !== rightId) return null;
  if (leftId && rightId && leftId === rightId) return "project_id";
  const leftLocator = remountSafeLocatorKey(left);
  const rightLocator = remountSafeLocatorKey(right);
  if (leftLocator && rightLocator && leftLocator === rightLocator) return "stable_locator";
  const leftKey = safeContextIdentifier(left?.discovery_key || left?.discoveryKey);
  const rightKey = safeContextIdentifier(right?.discovery_key || right?.discoveryKey);
  if (leftKey && rightKey && leftKey === rightKey) return "current_discovery_key";
  return null;
}

function compactCollectorConfirmedIdentityDescriptors(confirmed, stats) {
  const source = Array.isArray(confirmed) ? confirmed : [];
  const kept = [];
  const duplicateIndices = [];
  const sourceCounts = {
    project_id: 0,
    stable_locator: 0,
    current_discovery_key: 0
  };
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    let owner = null;
    let proof = null;
    for (const candidate of kept) {
      proof = durableCollectorConfirmedIdentityProof(candidate, item);
      if (proof) {
        owner = candidate;
        break;
      }
    }
    if (!owner) {
      kept.push(item);
      continue;
    }
    applyCollectorProjectFields(owner, item);
    duplicateIndices.push(index);
    if (proof === "project_id") sourceCounts.project_id += 1;
    else if (proof === "stable_locator") sourceCounts.stable_locator += 1;
    else sourceCounts.current_discovery_key += 1;
  }
  stats.identityDuplicateDescriptorCount = duplicateIndices.length;
  stats.duplicateSameProjectIdCount = sourceCounts.project_id;
  stats.duplicateSameStableLocatorCount = sourceCounts.stable_locator;
  stats.duplicateSameCurrentDiscoveryKeyCount = sourceCounts.current_discovery_key;
  stats.duplicateDescriptorIndices = duplicateIndices;
  stats.duplicateDescriptorSourceCounts = sourceCounts;
  stats.rawConfirmedCountBeforeCompact = source.length;
  return kept;
}

function prepareCollectorIdentityProjects(confirmed, provisionals) {
  const stats = {
    provisionalSameProjectIdProofCount: 0,
    provisionalSameStableLocatorProofCount: 0,
    provisionalLineageProofCount: 0,
    provisionalFoldedSameDescriptorCount: 0,
    provisionalObservationMergedExistingCount: 0,
    remainingProvisionalCount: 0,
    identityDuplicateDescriptorCount: 0,
    duplicateSameProjectIdCount: 0,
    duplicateSameStableLocatorCount: 0,
    duplicateSameCurrentDiscoveryKeyCount: 0,
    duplicateDescriptorIndices: [],
    duplicateDescriptorSourceCounts: {
      project_id: 0,
      stable_locator: 0,
      current_discovery_key: 0
    },
    rawConfirmedCountBeforeCompact: 0
  };
  const projects = compactCollectorConfirmedIdentityDescriptors(
    Array.isArray(confirmed) ? confirmed : [],
    stats);
  for (const project of projects) {
    project.observation_role = "confirmed";
  }
  const kept = [];
  for (const observation of Array.isArray(provisionals) ? provisionals : []) {
    if (foldCollectorProvisionalIntoConfirmed(projects, observation, stats)) continue;
    kept.push({
      ...observation,
      observation_role: "provisional"
    });
  }
  stats.remainingProvisionalCount = kept.length;
  return {
    identityCatalog: [...projects, ...kept],
    remainingProvisionals: kept,
    ...stats
  };
}

function buildCollectorIdentityProjects(confirmed, provisionals) {
  return prepareCollectorIdentityProjects(confirmed, provisionals).identityCatalog;
}

function stripCollectorObservationBookkeeping(project) {
  if (!project || typeof project !== "object") return project;
  const copy = { ...project };
  delete copy.observation_role;
  delete copy.unresolved_reason;
  delete copy.snapshot_generation;
  delete copy.occupancy_source_index;
  delete copy.predecessor_discovery_key;
  delete copy.row_metadata_present;
  delete copy.child_identity_candidate_available;
  delete copy._unresolved_confirmed_index;
  return copy;
}

function remountSafeLocatorKey(item) {
  return safeContextIdentifier(item?.stable_locator_key || item?.stableLocatorKey);
}

function remountSafeDuplicateProof(unresolved, resolved) {
  const unresolvedId = stableChatGptProjectId(unresolved?.project_id || unresolved?.projectId);
  const resolvedId = stableChatGptProjectId(resolved?.project_id || resolved?.projectId);
  if (unresolvedId && resolvedId && unresolvedId === resolvedId) return "project_id";
  const left = remountSafeLocatorKey(unresolved);
  const right = remountSafeLocatorKey(resolved);
  if (left && right && left === right) return "stable_locator";
  return null;
}

function provenDuplicateAgainstResolved(unresolved, resolvedItems) {
  const matches = [];
  for (const resolved of resolvedItems || []) {
    const proof = remountSafeDuplicateProof(unresolved, resolved);
    if (!proof) continue;
    matches.push({
      proof,
      id: stableChatGptProjectId(resolved?.project_id || resolved?.projectId),
      resolved
    });
  }
  const withIds = matches.filter((item) => item.id);
  if (withIds.length > 0) {
    const uniqueIds = [...new Set(withIds.map((item) => item.id))];
    if (uniqueIds.length !== 1) return null;
    return withIds[0];
  }
  const locatorMatches = matches.filter((item) => item.proof === "stable_locator");
  if (locatorMatches.length === 1) return locatorMatches[0];
  return null;
}

function recordCollectorDuplicateProof(stats, proof) {
  if (proof === "project_id") stats.provisionalDuplicateProofProjectIdCount += 1;
  else if (proof === "stable_locator") stats.provisionalDuplicateProofStableLocatorCount += 1;
  else if (proof) stats.provisionalDuplicateProofOtherStableEvidenceCount += 1;
}

function createCollectorProvisionalFinalizeStats(items) {
  return {
    provisionalObservationResolvedCount: 0,
    provisionalObservationMergedExistingCount: 0,
    provisionalObservationPromotedNewProjectCount: 0,
    provisionalObservationUnresolvedCount: 0,
    provisionalResolvedSameExistingCount: 0,
    provisionalResolvedDistinctProjectCount: 0,
    provisionalUnresolvedKeptCount: 0,
    provisionalUnresolvedDiscardedAsProvenDuplicateCount: 0,
    provisionalUnresolvedDiscardRejectedCount: 0,
    provisionalDuplicateProofProjectIdCount: 0,
    provisionalDuplicateProofStableLocatorCount: 0,
    provisionalDuplicateProofOtherStableEvidenceCount: 0,
    incompleteDueToUnresolvedProvisionalCount: 0,
    sameTitleIdentitySameProjectCount: 0,
    sameTitleIdentityDistinctProjectCount: 0,
    confirmedLogicalProjectCountBeforeIdentity:
      items.filter((item) => item?.observation_role !== "provisional").length,
    provisionalObservationCountBeforeIdentity:
      items.filter((item) => item?.observation_role === "provisional").length
  };
}

function finalizeCollectorIdentityProjects(identityProjects) {
  const items = Array.isArray(identityProjects) ? identityProjects : [];
  const stats = createCollectorProvisionalFinalizeStats(items);
  const byId = new Map();
  const logical = [];
  const titleIdSets = new Map();
  const titleKeyOf = (project) => {
    const title = typeof project?.title === "string" ? project.title.trim().toLocaleLowerCase() : "";
    return title.replace(/\s+/g, " ");
  };
  const rememberTitleId = (project, id) => {
    const titleKey = titleKeyOf(project);
    if (!titleKey || !id) return;
    if (!titleIdSets.has(titleKey)) titleIdSets.set(titleKey, new Set());
    titleIdSets.get(titleKey).add(id);
  };
  const mergeOrAdd = (item, role) => {
    const id = stableChatGptProjectId(item?.project_id || item?.projectId);
    if (id && byId.has(id)) {
      const existing = byId.get(id);
      applyCollectorProjectFields(existing, item);
      if (role === "provisional") {
        stats.provisionalObservationMergedExistingCount += 1;
        stats.provisionalResolvedSameExistingCount += 1;
        stats.sameTitleIdentitySameProjectCount += 1;
      }
      return existing;
    }
    const published = stripCollectorObservationBookkeeping(item);
    logical.push(published);
    if (id) byId.set(id, published);
    rememberTitleId(item, id);
    if (role === "provisional") {
      stats.provisionalObservationPromotedNewProjectCount += 1;
      stats.provisionalResolvedDistinctProjectCount += 1;
    }
    return published;
  };

  items.forEach((item, index) => {
    if (item?.observation_role === "provisional") return;
    const id = stableChatGptProjectId(item?.project_id || item?.projectId);
    if (id) mergeOrAdd(item, "confirmed");
    else logical.push({ ...stripCollectorObservationBookkeeping(item), _unresolved_confirmed_index: index });
  });

  const resolvedPool = items.filter((candidate) =>
    stableChatGptProjectId(candidate?.project_id || candidate?.projectId)
    || remountSafeLocatorKey(candidate));
  for (const item of items) {
    if (item?.observation_role !== "provisional") continue;
    const id = stableChatGptProjectId(item?.project_id || item?.projectId);
    if (!id) {
      const proof = provenDuplicateAgainstResolved(item, resolvedPool);
      if (proof) {
        if (proof.resolved) applyCollectorProjectFields(proof.resolved, item);
        stats.provisionalUnresolvedDiscardedAsProvenDuplicateCount += 1;
        stats.provisionalObservationMergedExistingCount += 1;
        stats.provisionalResolvedSameExistingCount += 1;
        recordCollectorDuplicateProof(stats, proof.proof);
        continue;
      }
      if (Number.isSafeInteger(item.occupancy_source_index) || item.disconnected === true) {
        stats.provisionalUnresolvedDiscardRejectedCount += 1;
      }
      stats.provisionalObservationUnresolvedCount += 1;
      stats.provisionalUnresolvedKeptCount += 1;
      continue;
    }
    stats.provisionalObservationResolvedCount += 1;
    const existing = byId.get(id);
    mergeOrAdd(item, "provisional");
    if (!existing) {
      const ids = titleIdSets.get(titleKeyOf(item));
      if (ids && ids.size > 1) stats.sameTitleIdentityDistinctProjectCount += 1;
    }
  }

  for (let index = logical.length - 1; index >= 0; index -= 1) {
    const item = logical[index];
    const confirmedIndex = item._unresolved_confirmed_index;
    if (!Number.isSafeInteger(confirmedIndex)
      || stableChatGptProjectId(item?.project_id || item?.projectId)) {
      delete item._unresolved_confirmed_index;
      continue;
    }
    const proof = provenDuplicateAgainstResolved(item, resolvedPool);
    if (proof) {
      logical.splice(index, 1);
      stats.provisionalUnresolvedDiscardedAsProvenDuplicateCount += 1;
      recordCollectorDuplicateProof(stats, proof.proof);
      stats.sameTitleIdentitySameProjectCount += 1;
      continue;
    }
    delete item._unresolved_confirmed_index;
  }

  stats.confirmedLogicalProjectCountAfterIdentity = logical.filter((item) =>
    stableChatGptProjectId(item?.project_id || item?.projectId)).length;
  stats.provisionalObservationCountAfterIdentity = stats.provisionalUnresolvedKeptCount;
  stats.incompleteDueToUnresolvedProvisionalCount = stats.provisionalUnresolvedKeptCount;
  return { projects: logical, stats };
}

async function applyCollectorDomIdentityPass(
  tab,
  pending,
  request,
  rootResult,
  projects,
  { resetSidebarCatalog = false, afterNavigation = false, identityCatalog = null } = {}) {
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  const startedAt = Date.now();
  const catalog = Array.isArray(identityCatalog) && identityCatalog.length > 0
    ? identityCatalog
    : projects;
  const unresolvedProjects = (Array.isArray(projects) ? projects : [])
    .filter((project) => !collectorProjectTarget(project));
  const dispatchProjects = unresolvedProjects.length > 0 ? unresolvedProjects : projects;
  if (efficiency && afterNavigation) {
    efficiency.postNavigationRetryInputCount = dispatchProjects.length;
    efficiency.postNavigationRetryIndices = dispatchProjects
      .map((project) => project?.project_index)
      .filter((index) => Number.isSafeInteger(index));
  }
  pending.identityTelemetryActive = true;
  let domResult;
  try {
    domResult = await dispatchToContentScript(tab.id, {
      type: "GET_CHATGPT_CONTEXT",
      requestId: pending.requestId,
      refreshGeneration: pending.generation,
      collectorTabId: tab.id,
      mode: "list",
      collection: "project_identity",
      identityMode: "dom",
      projects: dispatchProjects,
      identityCatalog: catalog,
      totalProjects: catalog.length,
      resetSidebarCatalog: resetSidebarCatalog === true,
      identityPassKind: afterNavigation ? "post_navigation" : "initial_dom",
      navigationTimeoutMs: 10000,
      disclosureTimeoutMs: 2500,
      childRegionWaitPolicy: "hydrate",
      probeTimeoutMs: 200
    }, request, {
      timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
      timeoutStage: "collector_project_identity_dom_timeout"
    });
  } finally {
    pending.identityTelemetryActive = false;
  }
  throwIfCollectorRequestSuperseded(pending);
  validateCollectorProjectIdentityResponse(domResult, pending);
  const beforeDom = projects;
  const merged = mergeCollectorProjectIdentityResponse(projects, domResult);
  if (efficiency && !afterNavigation) {
    efficiency.initialDomPassUnresolvedIndices = collectProjectMetadataResolution({ projects: merged }).items
      .filter((item) => !item.resolved)
      .map((item) => item.projectIndex);
  }
  const newlyResolved = merged.reduce((count, project, index) =>
    count + (!collectorProjectTarget(beforeDom[index]) && collectorProjectTarget(project) ? 1 : 0), 0);
  pending.projectIdentityResult = {
    ...rootResult,
    projects: merged,
    unresolved_project_count: collectProjectMetadataResolution({ projects: merged }).unresolvedCount
  };
  mergeCollectorVisibilityTelemetry(efficiency, domResult);
  if (efficiency && afterNavigation) {
    efficiency.postNavigationIdentityCount += 1;
    efficiency.postNavigationIdentityWaitMs += Math.max(0, Date.now() - startedAt);
    efficiency.postNavigationRetryMs += Math.max(0, Date.now() - startedAt);
  }
  return { projects: merged, newlyResolved };
}

async function resolveCollectorProjectIdentities(tab, pending, request, rootResult) {
  throwIfCollectorRequestSuperseded(pending);
  pending.identityResolutionAttempted = true;
  const discovery = projectDiscoveryStateFor(pending);
  const discoveryProjects = Array.isArray(pending.projectDiscoveryScanResult?.projects)
    && pending.projectDiscoveryScanResult.projects.length > 0
    ? pending.projectDiscoveryScanResult.projects
    : (Array.isArray(rootResult?.projects) ? rootResult.projects : []);
  const provisionals = collectorDiscoveryProvisionals(
    pending.projectDiscoveryScanResult || rootResult);
  const preparedIdentity = prepareCollectorIdentityProjects(discoveryProjects, provisionals);
  const identityCatalog = preparedIdentity.identityCatalog;
  const logicalConfirmedCount = Math.max(
    0,
    identityCatalog.length - (preparedIdentity.remainingProvisionalCount || 0));
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "provisionalSameProjectIdProofCount",
    preparedIdentity.provisionalSameProjectIdProofCount);
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "provisionalSameStableLocatorProofCount",
    preparedIdentity.provisionalSameStableLocatorProofCount);
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "provisionalLineageProofCount",
    preparedIdentity.provisionalLineageProofCount);
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "provisionalFoldedSameDescriptorCount",
    preparedIdentity.provisionalFoldedSameDescriptorCount);
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "provisionalObservationMergedExistingCount",
    preparedIdentity.provisionalObservationMergedExistingCount);
  recordCollectorProvisionalReconciliationSummary(pending, {
    confirmed_count_before_identity: logicalConfirmedCount,
    provisional_count_before_identity: provisionals.length,
    identity_input_count: identityCatalog.length,
    provisional_same_project_id_proof_count: preparedIdentity.provisionalSameProjectIdProofCount,
    provisional_same_stable_locator_proof_count: preparedIdentity.provisionalSameStableLocatorProofCount,
    provisional_lineage_proof_count: preparedIdentity.provisionalLineageProofCount,
    remaining_provisional_count: preparedIdentity.remainingProvisionalCount
  });
  recordCollectorIdentityCatalogInvariantSummary(pending, {
    root_logical_project_count: collectorProjectDiscoveryEfficiencyFor(pending)
      ?.discoveryLogicalProjectCountFinal || 0,
    confirmed_count_before_identity: logicalConfirmedCount,
    provisional_count_before_identity: preparedIdentity.remainingProvisionalCount,
    identity_input_count: identityCatalog.length,
    identity_duplicate_descriptor_count: preparedIdentity.identityDuplicateDescriptorCount,
    duplicate_same_project_id_count: preparedIdentity.duplicateSameProjectIdCount,
    duplicate_same_stable_locator_count: preparedIdentity.duplicateSameStableLocatorCount,
    duplicate_same_current_discovery_key_count:
      preparedIdentity.duplicateSameCurrentDiscoveryKeyCount,
    duplicate_descriptor_source_counts: preparedIdentity.duplicateDescriptorSourceCounts,
    duplicate_descriptor_indices: preparedIdentity.duplicateDescriptorIndices
  });
  const identityEfficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (identityEfficiency) identityEfficiency.identityInputCount = identityCatalog.length;
  let projects = mergeIdentityProgressOntoDiscovery(
    identityCatalog,
    pending.projectIdentityResult?.projects);
  const initialResolution = collectProjectMetadataResolution({ projects });
  incrementCollectorProjectDiscoveryEfficiency(
    pending,
    "projectIdentityAttemptCount",
    projects.length);
  const initialUnresolvedIndexes = initialResolution.items
    .filter((item) => !item.resolved)
    .map((item) => item.projectIndex);

  recordCollectorProjectIdentityResolution(
    "collector project identity resolution started",
    pending,
    projects,
    {
      project_identity_resolution_started: true,
      project_identity_resolution_completed: false,
      identity_resolution_input_count: projects.length,
      discovery_catalog_count: logicalConfirmedCount,
      provisional_observation_count_before_identity: provisionals.length,
      confirmed_logical_project_count_before_identity: logicalConfirmedCount,
      current_project_index: -1,
      resolution_method: "dom",
      navigation_target_verified: false,
      project_url_pattern_valid: false,
      project_id_url_match: false,
      status: "started",
      stage: "collector_project_identity_resolution_start"
    });

  // Projects that already carry a verified ID + canonical URL are resolved
  // by the metadata received from the discovery pass. Count them as the
  // non-navigation portion of identity resolution even when no DOM resolver
  // message is needed for this refresh.
  let nonNavigationResolvedCount = initialResolution.resolvedCount;
  let navigationResolvedCount = 0;
  let domChecked = initialResolution.resolvedCount > 0;
  if (initialUnresolvedIndexes.length > 0) {
    const domPass = await applyCollectorDomIdentityPass(
      tab,
      pending,
      request,
      rootResult,
      projects);
    projects = domPass.projects;
    nonNavigationResolvedCount += domPass.newlyResolved;
    domChecked = true;
    const efficiencyAfterDom = collectorProjectDiscoveryEfficiencyFor(pending);
    if (efficiencyAfterDom) {
      efficiencyAfterDom.identityElapsedBeforeNavigationMs = new Map(
        efficiencyAfterDom.identityProjectElapsedMs);
      efficiencyAfterDom.initialDomPassResolvedCount = collectProjectMetadataResolution({ projects }).resolvedCount;
    }
    recordCollectorProjectIdentityResolution(
      "collector project identity DOM resolution observed",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: 0,
        current_project_index: -1,
        resolution_method: "dom",
        navigation_target_verified: false,
        project_url_pattern_valid: false,
        project_id_url_match: false,
        status: "observed",
        stage: "collector_project_identity_dom"
      });
  }

  const resolutionAfterDom = collectProjectMetadataResolution({ projects });
  const unresolvedBeforeNavigationIndexes = resolutionAfterDom.items
    .filter((item) => !item.resolved)
    .map((item) => item.projectIndex);
  const resolvedCountBeforeNavigation = resolutionAfterDom.resolvedCount;
  const navigationStartedIndexes = new Set();
  const visibilityRecoveryIndexes = new Set();
  const visibilityRecoverySuccessIndexes = [];
  const visibilityRecoveryFailureIndexes = [];
  const terminalNavigationIndexes = new Set();
  const navigationNotStartedIndexes = [];
  const selectedForNavigationIndexes = new Set();
  let visibilityRecoveryScrollAttemptCount = 0;
  let visibilityRecoveryScrollPositionChangeCount = 0;
  let visibilityRecoveryStagnationCount = 0;
  const compactNavigationTransitions = new Map();
  const recordNavTransition = (index, token) => {
    const previous = compactNavigationTransitions.get(index);
    compactNavigationTransitions.set(index, previous ? `${previous}>${token}` : `${index}:${token}`);
  };
  const isTerminalNavigationReason = (reason) => reason === "row_visibility_exhausted"
    || reason === "project_row_fingerprint_mismatch"
    || reason === "ambiguous_project_row_match"
    || reason === "ambiguous_project_identity"
    || reason === "project_id_url_mismatch"
    || reason === "no_safe_project_navigation_target";
  const navigationSuccessIndexes = [];
  const navigationFailureIndexes = [];
  const navigationSkipReasonCounts = {};
  const navigationSkippedIndexes = new Set();
  let navigationLoopIterationCount = 0;
  const navigationAttemptLimit = projects.length;
  while (true) {
    const unresolvedItems = collectProjectMetadataResolution({ projects }).items
      .filter((item) => !item.resolved);
    const unresolvedIndexes = unresolvedItems.map((item) => item.projectIndex);
    const projectIndex = unresolvedIndexes.find((index) => {
      if (navigationStartedIndexes.has(index) || terminalNavigationIndexes.has(index)) return false;
      if (!collectorProjectNavigationEligible(projects[index])) {
        if (!navigationSkippedIndexes.has(index)) {
          navigationSkippedIndexes.add(index);
          const reason = projects[index]?.unresolved_reason || "navigation_ineligible";
          navigationSkipReasonCounts[reason] = (navigationSkipReasonCounts[reason] || 0) + 1;
        }
        return false;
      }
      return true;
    });
    if (projectIndex === undefined) break;
    if (navigationStartedIndexes.size + terminalNavigationIndexes.size >= navigationAttemptLimit) break;
    navigationLoopIterationCount += 1;
    selectedForNavigationIndexes.add(projectIndex);
    recordNavTransition(projectIndex, "unresolved>nav_candidate");
    const identityNavigationGeneration = `refresh-${pending.generation}-identity-${projectIndex}`;
    const targetProject = projects[projectIndex];
    const descriptor = collectorProjectIdentityDescriptor(targetProject, projectIndex);
    pending.identityNavigationProjectIndex = projectIndex;
    pending.identityNavigationTotalProjects = projects.length;
    pending.identityNavigationGeneration = identityNavigationGeneration;
    pending.identityNavigationActive = false;
    let navigationExitEmitted = false;
    let navigationFailureReason = null;
    const emitNavigationExit = (success, exitReason, fields = {}) => {
      if (navigationExitEmitted) return;
      navigationExitEmitted = true;
      const reason = typeof exitReason === "string" && exitReason.length > 0
        ? exitReason
        : (success ? "resolved" : "unexpected_exception");
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation exit",
        pending,
        {
          project_index: projectIndex,
          success: success === true,
          resolution_success: success === true,
          exit_reason: reason,
          navigation_failure_reason: success === true ? "none" : reason,
          internal_reason: fields.internal_reason || reason,
          ...fields,
          stage: "collector_project_identity_navigation_exit"
        });
    };
    recordCollectorProjectIdentityNavigationTelemetry(
      "collector project identity navigation entry",
      pending,
      {
        ...collectorProjectIdentityNavigationPreconditions(
          tab,
          pending,
          descriptor,
          targetProject,
          projectIndex,
          projects.length,
          discovery,
          rootResult,
          isCollectorRootUrl(tab?.url)),
        exit_reason: "none",
        project_index: projectIndex,
        stage: "collector_project_identity_navigation_entry"
      });
    try {
      throwIfCollectorRequestSuperseded(pending);
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation precondition",
        pending,
        {
          ...collectorProjectIdentityNavigationPreconditions(
            tab,
            pending,
            descriptor,
            targetProject,
            projectIndex,
            projects.length,
            discovery,
            rootResult,
            isCollectorRootUrl(tab?.url)),
          project_index: projectIndex,
          exit_reason: "none",
          stage: "collector_project_identity_navigation_precondition"
        });
      tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
        request_id: pending.requestId,
        project_index: projectIndex,
        total_projects: projects.length,
        project_discovery_completed: false,
        project_discovery_scan_completed: true,
        project_discovery_run_id: discovery.runId,
        project_discovery_result_received: true,
        stage: "collector_project_identity_root_navigation"
      });
      tab = await ensureCollectorReady(tab, {
        request_id: pending.requestId,
        project_index: projectIndex,
        total_projects: projects.length,
        stage: "collector_project_identity_root_ready"
      });
      pending.tabId = tab.id;
      const identityRootUrlVerified = isCollectorRootUrl(tab?.url);
      if (!identityRootUrlVerified) {
        recordCollectorProjectIdentityNavigationTelemetry(
          "collector project identity root precondition failed",
          pending,
          {
            project_index: projectIndex,
            navigation_started_for_project: false,
            navigation_owned_by_current_project: false,
            current_url_used_as_identity: false,
            stale_navigation_result_rejected: true,
            failure_reason: "collector_root_url_not_verified",
            unresolved_reason: "collector_root_url_not_verified",
            stage: "collector_project_identity_root_precondition_failed"
          });
        throw bridgeError(
          "Project Identity用のRootページを確認できませんでした。",
          0,
          "collector_project_identity_root_not_verified");
      }
      const navigationInitialUrl = safeChatGptContextUrl(tab?.url);
      const navigationAttemptStartedAt = Date.now();
      pending.identityNavigationActive = true;
      collectorWindowState = {
        ...collectorWindowState,
        currentProjectIndex: projectIndex,
        identityResolutionMethod: "navigation",
        navigationTargetVerified: false,
        projectUrlPatternValid: false,
        projectIdUrlMatch: false
      };
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation precondition",
        pending,
        {
          ...collectorProjectIdentityNavigationPreconditions(
            tab,
            pending,
            descriptor,
            targetProject,
            projectIndex,
            projects.length,
            discovery,
            rootResult,
            isCollectorRootUrl(tab?.url)),
          project_index: projectIndex,
          navigation_generation_match: true,
          current_url_used_as_identity: false,
          exit_reason: "none",
          stage: "collector_project_identity_navigation_precondition_ready"
        });
      pending.identityNavigationContentReadyBeforeDispatch = contentScriptReadyTabs.has(tab.id);
      diagnostic("collector project identity navigation started", {
        request_id: pending.requestId,
        collector_window_id: collectorWindowState.windowId,
        collector_tab_id: tab.id,
        project_index: projectIndex,
        total_projects: projects.length,
        refresh_generation: pending.generation,
        navigation_generation: identityNavigationGeneration,
        resolution_method: "navigation",
        status: "started",
        stage: "collector_project_identity_navigation_start",
        target_tab_id: tab.id
      });
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation dispatch requested",
        pending,
        {
          project_index: projectIndex,
          navigation_wait_started: false,
          url_changed: false,
          navigation_detected: false,
          content_script_reloaded: false,
          tab_update_observed: false,
          navigation_wait_ms: 0,
          navigation_timeout: false,
          resolution_success: false,
          stage: "collector_project_identity_navigation_dispatch"
        });

    let identityResult;
    try {
      identityResult = await dispatchToContentScript(tab.id, {
        type: "GET_CHATGPT_CONTEXT",
        requestId: pending.requestId,
        refreshGeneration: pending.generation,
        navigationGeneration: identityNavigationGeneration,
        collectorTabId: tab.id,
        navigationStartedForProject: true,
        navigationOwnerProjectIndex: projectIndex,
        navigationOwnerRequestId: pending.requestId,
        navigationOwnerRefreshGeneration: pending.generation,
        mode: "list",
        collection: "project_identity",
        identityMode: "navigation",
        projects: [descriptor],
        identityCatalog: projects.map((project, index) =>
          collectorProjectIdentityDescriptor(project, index)),
        totalProjects: projects.length,
        identityPassKind: "navigation",
        navigationTimeoutMs: 10000,
        disclosureTimeoutMs: 200,
        childRegionWaitPolicy: "probe",
        probeTimeoutMs: 200
      }, request, {
        timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
        timeoutStage: "collector_project_identity_navigation_timeout",
        // A full page navigation can close the message port after the row
        // click. Do not blindly replay the click; inspect the resulting tab
        // URL below and let the Content Script's route check be idempotent.
        retryMissingContentScript: false
      });
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation response received",
        pending,
        {
          project_index: projectIndex,
          navigation_wait_started: true,
          navigation_target_verified: identityResult?.navigation_target_verified === true,
          project_url_pattern_valid: identityResult?.project_url_pattern_valid === true,
          project_id_extracted: Boolean(identityResult?.projects?.[0]?.project_id),
          project_id_url_match: identityResult?.project_id_url_match === true,
          navigation_completed_for_project: identityResult?.navigation_target_verified === true,
          navigation_target_verified_for_project: identityResult?.navigation_target_verified === true,
          resolution_success: identityResult?.status === "ok"
            && (identityResult?.navigation_target_verified === true
              || identityResult?.resolution_method === "dom"),
          navigation_timeout: false,
          stage: "collector_project_identity_navigation_response"
        });
    } catch (error) {
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation dispatch failed",
        pending,
        {
          project_index: projectIndex,
          navigation_wait_started: true,
          navigation_timeout: false,
          content_script_reloaded: contentScriptReadyTabs.has(tab.id)
            && pending.identityNavigationContentReadyBeforeDispatch !== true,
          stage: "collector_project_identity_navigation_dispatch_failed"
        });
      // A full navigation can close the Content Script message port before
      // tabs.update/onUpdated has exposed the final URL to this turn. Poll
      // the exact Collector Tab until navigation is complete before deciding
      // whether the click succeeded. This avoids replaying a click that was
      // already accepted by ChatGPT.
      const fromTab = await waitForCollectorProjectIdentityTab(
        tab.id,
        COLLECTOR_TAB_NAVIGATION_TIMEOUT_MS,
        navigationInitialUrl,
        pending);
      recordCollectorProjectIdentityNavigationTelemetry(
        "collector project identity navigation tab result",
        pending,
        {
          project_index: projectIndex,
          navigation_wait_started: true,
          navigation_detected: Boolean(fromTab),
          navigation_target_verified: Boolean(fromTab),
          project_url_pattern_valid: Boolean(fromTab),
          project_id_extracted: Boolean(fromTab?.projectId),
          project_id_url_match: Boolean(fromTab?.projectId && fromTab?.projectUrl),
          resolution_success: Boolean(fromTab),
          navigation_timeout: !fromTab,
          content_script_reloaded: contentScriptReadyTabs.has(tab.id)
            && pending.identityNavigationContentReadyBeforeDispatch !== true,
          stage: "collector_project_identity_navigation_tab_result"
        });
      identityResult = fromTab
        ? {
          type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
          requestId: pending.requestId,
          mode: "list",
          status: "ok",
          projects: [{ ...descriptor, project_id: fromTab.projectId, url: fromTab.projectUrl }],
          conversations: [],
          current: null,
          navigation_target_verified: true,
          project_url_pattern_valid: true,
          project_id_url_match: true
        }
        : {
          // Keep the normal identity-validation path for a navigation that
          // landed on a non-Project route (or disappeared). It records the
          // unresolved metadata and returns context_projects_incomplete,
          // without replaying the click or inventing an ID.
          type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
          requestId: pending.requestId,
          mode: "list",
          status: "ok",
          projects: [descriptor],
          conversations: [],
          current: null,
          navigation_target_verified: false,
          project_url_pattern_valid: false,
          project_id_url_match: false
        };
    }
    throwIfCollectorRequestSuperseded(pending);
    validateCollectorProjectIdentityResponse(identityResult, pending, {
      navigationGeneration: pending.identityNavigationGeneration
    });
    const beforeNavigation = projects;
    projects = mergeCollectorProjectIdentityResponse(projects, identityResult);
    const target = collectorProjectTarget(projects[projectIndex]);
    const responseProject = collectorProjectIdentityResponseItem(
      identityResult.projects,
      projectIndex,
      1);
    recordCollectorProjectIdentityNavigationTelemetry(
      "collector project identity metadata resolution",
      pending,
      {
        project_index: projectIndex,
        navigation_target_verified: identityResult.navigation_target_verified === true,
        project_url_pattern_valid: identityResult.project_url_pattern_valid === true,
        project_id_extracted: Boolean(responseProject?.project_id),
        project_id_url_match: identityResult.project_id_url_match === true,
        navigation_completed_for_project: identityResult.navigation_target_verified === true,
        navigation_target_verified_for_project: identityResult.navigation_target_verified === true,
        resolution_success: Boolean(target),
        navigation_timeout: false,
        stage: "collector_project_identity_metadata_resolution"
      });
    recordCollectorProjectMetadataResolution({ projects }, pending);
    const navigationResolved = !collectorProjectTarget(beforeNavigation[projectIndex]) && Boolean(target);
    const resolvedWithoutNavigation = navigationResolved && identityResult?.resolution_method === "dom";
    const startedNavigation = identityResult.navigation_started_for_project === true
      || responseProject?.navigation_started_for_project === true
      || responseProject?.navigation_fallback_attempted === true
      || (Boolean(target)
        && identityResult.navigation_target_verified === true
        && identityResult?.resolution_method !== "dom");
    const visibilityAttempted = identityResult.visibility_recovery_attempted === true
      || responseProject?.visibility_recovery_attempted === true
      || Number(identityResult.visibility_recovery_scroll_attempt_count) > 0
      || Number(responseProject?.visibility_recovery_scroll_attempt_count) > 0;
    const visibilitySuccess = identityResult.visibility_recovery_success === true
      || responseProject?.visibility_recovery_success === true;
    visibilityRecoveryScrollAttemptCount += Number(identityResult.visibility_recovery_scroll_attempt_count)
      || Number(responseProject?.visibility_recovery_scroll_attempt_count)
      || 0;
    visibilityRecoveryScrollPositionChangeCount += Number(identityResult.visibility_recovery_scroll_position_change_count)
      || Number(responseProject?.visibility_recovery_scroll_position_change_count)
      || 0;
    visibilityRecoveryStagnationCount += Number(identityResult.visibility_recovery_stagnation_count)
      || Number(responseProject?.visibility_recovery_stagnation_count)
      || 0;
    if (visibilityAttempted) visibilityRecoveryIndexes.add(projectIndex);
    if (visibilitySuccess && !visibilityRecoverySuccessIndexes.includes(projectIndex)) {
      visibilityRecoverySuccessIndexes.push(projectIndex);
    }
    if (startedNavigation) {
      navigationStartedIndexes.add(projectIndex);
      recordNavTransition(projectIndex, "navigation_started");
    } else {
      navigationNotStartedIndexes.push(projectIndex);
      recordNavTransition(projectIndex, visibilityAttempted
        ? "row_not_visible>visibility_recovery"
        : "locate_row");
    }
    if (navigationResolved) {
      const navEfficiency = collectorProjectDiscoveryEfficiencyFor(pending);
      if (navEfficiency) {
        navEfficiency.navigationIdentityResolutionMs += Math.max(
          0,
          Date.now() - navigationAttemptStartedAt);
        navEfficiency.navigationIdentityResolvedIndex = projectIndex;
      }
    }
    if (!target) {
      navigationFailureReason = collectorProjectIdentityNavigationFailureReason(
        identityResult,
        target,
        responseProject);
      const failedResolution = collectProjectMetadataResolution({ projects });
      recordCollectorProjectMetadataResolutionFailure(
        failedResolution,
        pending,
        "context_projects_incomplete");
      recordCollectorProjectIdentityResolution(
        "collector project identity navigation failed",
        pending,
        projects,
        {
          project_identity_resolution_started: true,
          project_identity_resolution_completed: false,
          non_navigation_resolved_count: nonNavigationResolvedCount,
          navigation_resolved_count: navigationResolvedCount,
          current_project_index: projectIndex,
          resolution_method: "navigation",
          navigation_target_verified: identityResult.navigation_target_verified === true,
          project_url_pattern_valid: identityResult.project_url_pattern_valid === true,
          project_id_url_match: identityResult.project_id_url_match === true,
          navigation_failure_reason: navigationFailureReason,
          internal_reason: collectorProjectIdentityNavigationInternalReason(
            identityResult,
            target,
            responseProject,
            navigationFailureReason),
          status: "error",
          error_code: "context_projects_incomplete",
          stage: "collector_project_identity_navigation_failed"
        });
      pending.projectIdentityResult = {
        ...rootResult,
        projects,
        unresolved_project_count: failedResolution.unresolvedCount
      };
      pending.identityNavigationActive = false;
      emitNavigationExit(false, navigationFailureReason, {
        navigation_target_verified: identityResult.navigation_target_verified === true,
        project_url_pattern_valid: identityResult.project_url_pattern_valid === true,
        project_id_url_match: identityResult.project_id_url_match === true,
        navigation_completed_for_project: identityResult.navigation_target_verified === true,
        navigation_target_verified_for_project: identityResult.navigation_target_verified === true,
        current_url_used_as_identity: false,
        internal_reason: collectorProjectIdentityNavigationInternalReason(
          identityResult,
          target,
          responseProject,
          navigationFailureReason)
      });
      pending.identityNavigationProjectIndex = null;
      pending.identityNavigationTotalProjects = null;
      pending.identityNavigationGeneration = null;
      if (visibilityAttempted && !visibilitySuccess) {
        visibilityRecoveryFailureIndexes.push(projectIndex);
      }
      // Visibility recovery already ran inside the Content Script relocate.
      // A not_visible/exhausted result is terminal for this index so the loop
      // cannot retry forever, but it is not a started navigation.
      terminalNavigationIndexes.add(projectIndex);
      recordNavTransition(
        projectIndex,
        navigationFailureReason === "row_visibility_exhausted"
          || navigationFailureReason === "project_row_not_visible"
          || navigationFailureReason === "project_row_not_found"
          ? "sweep_exhausted>row_visibility_exhausted"
          : (startedNavigation ? "terminal_failure" : "row_visibility_exhausted"));
      navigationFailureIndexes.push(projectIndex);
      continue;
    }
    if (resolvedWithoutNavigation) nonNavigationResolvedCount += 1;
    else if (navigationResolved) navigationResolvedCount += 1;
    if (navigationResolved) {
      navigationSuccessIndexes.push(projectIndex);
      recordNavTransition(projectIndex, visibilitySuccess
        ? "row_materialized>nav_success"
        : "nav_success");
    }
    pending.projectIdentityResult = {
      ...rootResult,
      projects,
      unresolved_project_count: collectProjectMetadataResolution({ projects }).unresolvedCount
    };
    recordCollectorProjectIdentityResolution(
      "collector project identity navigation resolved",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: navigationResolvedCount,
        current_project_index: projectIndex,
        resolution_method: resolvedWithoutNavigation ? "dom" : "navigation",
        navigation_target_verified: identityResult.navigation_target_verified !== false,
        project_url_pattern_valid: identityResult.project_url_pattern_valid !== false,
        project_id_url_match: identityResult.project_id_url_match !== false,
        status: "resolved",
        stage: "collector_project_identity_navigation_resolved"
      });
    pending.identityNavigationActive = false;
    const alreadyOnRoot = isCollectorRootUrl(tab?.url) === true;
    if (!resolvedWithoutNavigation || !alreadyOnRoot) {
      tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
        request_id: pending.requestId,
        project_index: projectIndex,
        total_projects: projects.length,
        project_discovery_completed: false,
        project_discovery_scan_completed: true,
        project_discovery_run_id: discovery.runId,
        stage: "collector_project_identity_root_restore"
      });
      pending.tabId = tab.id;
    }
    const revalidationStartedAt = Date.now();
    tab = await ensureCollectorReady(tab, {
      request_id: pending.requestId,
      project_index: projectIndex,
      total_projects: projects.length,
      stage: "collector_project_identity_root_return_ready"
    });
    pending.tabId = tab.id;
    const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
    if (efficiency) {
      efficiency.rootReturnRevalidationMs += Math.max(0, Date.now() - revalidationStartedAt);
      efficiency.rootReturnDomRefreshCount += 1;
      efficiency.rootReturnCacheInvalidationCount += 1;
      efficiency.postNavigationIdentityActive = true;
    }
    emitNavigationExit(true, "resolved", {
      navigation_target_verified: true,
      project_url_pattern_valid: true,
      project_id_url_match: true,
      internal_reason: "project_identity_resolved"
    });
    pending.identityNavigationProjectIndex = null;
    pending.identityNavigationTotalProjects = null;
    pending.identityNavigationGeneration = null;
    const remainingAfterReturn = collectProjectMetadataResolution({ projects }).items
      .filter((item) => !item.resolved)
      .map((item) => item.projectIndex);
    if (remainingAfterReturn.length > 0) {
      const retry = await applyCollectorDomIdentityPass(
        tab,
        pending,
        request,
        rootResult,
        projects,
        { resetSidebarCatalog: true, afterNavigation: true, identityCatalog: projects });
      projects = retry.projects;
      nonNavigationResolvedCount += retry.newlyResolved;
      recordCollectorProjectIdentityResolution(
        "collector project identity DOM resolution observed",
        pending,
        projects,
        {
          project_identity_resolution_started: true,
          project_identity_resolution_completed: false,
          non_navigation_resolved_count: nonNavigationResolvedCount,
          navigation_resolved_count: navigationResolvedCount,
          current_project_index: -1,
          resolution_method: "dom",
          navigation_target_verified: false,
          project_url_pattern_valid: false,
          project_id_url_match: false,
          status: "observed",
          stage: "collector_project_identity_dom_after_root_return"
        });
    }
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) throw error;
      const exitReason = navigationFailureReason
        || collectorProjectIdentityNavigationExitReason(error);
      // Stop attributing late tabs.onUpdated / CONTENT_SCRIPT_READY events to
      // this identity click once the current fallback attempt has exited.
      // Keep the index/generation until after EXIT telemetry is emitted so the
      // failure remains correlated, but make the attempt inactive first.
      pending.identityNavigationActive = false;
      if (!navigationFailureReason) {
        navigationFailureReason = exitReason;
        recordCollectorProjectIdentityNavigationTelemetry(
          "collector project identity navigation failed",
          pending,
          {
            project_index: projectIndex,
            navigation_target_verified: false,
            project_url_pattern_valid: false,
            project_id_url_match: false,
            resolution_success: false,
            navigation_failure_reason: exitReason,
            internal_reason: `project_identity_${exitReason}`,
            exit_reason: exitReason,
            stage: "collector_project_identity_navigation_failed"
          });
      }
      emitNavigationExit(false, exitReason, {
        internal_reason: `project_identity_${exitReason}`
      });
      pending.projectIdentityResult = {
        ...rootResult,
        projects,
        unresolved_project_count: collectProjectMetadataResolution({ projects }).unresolvedCount
      };
      pending.identityNavigationProjectIndex = null;
      pending.identityNavigationTotalProjects = null;
      pending.identityNavigationGeneration = null;
      terminalNavigationIndexes.add(projectIndex);
      recordNavTransition(projectIndex, "terminal_failure");
      navigationFailureIndexes.push(projectIndex);
      continue;
    }
  }

  const selectedNavigationIndexes = [...selectedForNavigationIndexes].sort((left, right) => left - right);
  const emitIdentityNavigationProgressionSummary = (finalUnresolvedIndexes) => {
    const remainingEligible = finalUnresolvedIndexes.filter((index) =>
      collectorProjectNavigationEligible(projects[index])
      && !navigationStartedIndexes.has(index)
      && !terminalNavigationIndexes.has(index));
    const remainingIneligible = finalUnresolvedIndexes.filter((index) =>
      !collectorProjectNavigationEligible(projects[index]));
    diagnostic("collector project identity navigation summary", {
      request_id: pending.requestId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: pending.tabId,
      initial_unresolved_indices: unresolvedBeforeNavigationIndexes.join(","),
      navigation_candidate_indices: selectedNavigationIndexes.join(","),
      navigation_selected_count: selectedForNavigationIndexes.size,
      navigation_attempted_indices: [...navigationStartedIndexes].sort((left, right) => left - right).join(","),
      navigation_success_indices: navigationSuccessIndexes.join(","),
      navigation_failure_indices: navigationFailureIndexes.join(","),
      navigation_not_started_indices: [...new Set(navigationNotStartedIndexes)].sort((left, right) => left - right).join(","),
      navigation_terminal_failure_indices: [...terminalNavigationIndexes]
        .filter((index) => !navigationSuccessIndexes.includes(index))
        .sort((left, right) => left - right)
        .join(","),
      navigation_started_count: navigationStartedIndexes.size,
      visibility_recovery_attempt_count: visibilityRecoveryIndexes.size,
      visibility_recovery_indices: [...visibilityRecoveryIndexes].sort((left, right) => left - right).join(","),
      visibility_recovery_success_indices: visibilityRecoverySuccessIndexes.join(","),
      visibility_recovery_failure_indices: visibilityRecoveryFailureIndexes.join(","),
      visibility_recovery_scroll_attempt_count: visibilityRecoveryScrollAttemptCount,
      visibility_recovery_scroll_position_change_count: visibilityRecoveryScrollPositionChangeCount,
      visibility_recovery_stagnation_count: visibilityRecoveryStagnationCount,
      row_not_visible_recoverable_count: visibilityRecoveryIndexes.size,
      row_visibility_exhausted_count: [...terminalNavigationIndexes]
        .filter((index) => projects[index]?.unresolved_reason === "row_visibility_exhausted"
          || projects[index]?.unresolved_reason === "project_row_not_visible")
        .length,
      navigation_skip_reason_counts: Object.entries(navigationSkipReasonCounts)
        .map(([reason, count]) => `${reason}:${count}`)
        .join(",")
        .slice(0, 128),
      remaining_navigation_eligible_indices: remainingEligible.join(","),
      remaining_navigation_ineligible_indices: remainingIneligible.join(","),
      navigation_skipped_indices: [...navigationSkippedIndexes].sort((left, right) => left - right).join(","),
      navigation_loop_iteration_count: navigationLoopIterationCount,
      navigation_attempt_limit: navigationAttemptLimit,
      navigation_attempt_limit_hit: (navigationStartedIndexes.size + terminalNavigationIndexes.size)
        >= navigationAttemptLimit
        && remainingEligible.length > 0,
      resolved_count_before_navigation: resolvedCountBeforeNavigation,
      resolved_count_after_navigation: collectProjectMetadataResolution({ projects }).resolvedCount,
      final_unresolved_indices: finalUnresolvedIndexes.join(","),
      identity_state_transitions: [...compactNavigationTransitions.values()]
        .join(",")
        .slice(0, 256),
      stage: "collector_project_identity_navigation_summary",
      target_tab_id: pending.tabId
    });
  };
  emitIdentityNavigationProgressionSummary(
    collectProjectMetadataResolution({ projects }).items
      .filter((item) => !item.resolved)
      .map((item) => item.projectIndex));

  if (projects.length !== identityCatalog.length) {
    emitCollectorProjectIdentityFailureSummary(
      pending,
      projects,
      "context_projects_incomplete");
    throw bridgeError(
      "ChatGPT Projectのmetadataを完全には取得できませんでした。",
      0,
      "context_projects_incomplete");
  }
  const finalized = finalizeCollectorIdentityProjects(projects);
  const efficiency = collectorProjectDiscoveryEfficiencyFor(pending);
  if (efficiency) {
    efficiency.provisionalObservationResolvedCount = finalized.stats.provisionalObservationResolvedCount;
    efficiency.provisionalObservationMergedExistingCount =
      finalized.stats.provisionalObservationMergedExistingCount;
    efficiency.provisionalObservationPromotedNewProjectCount =
      finalized.stats.provisionalObservationPromotedNewProjectCount;
    efficiency.provisionalObservationUnresolvedCount =
      finalized.stats.provisionalObservationUnresolvedCount;
    efficiency.provisionalResolvedSameExistingCount =
      finalized.stats.provisionalResolvedSameExistingCount;
    efficiency.provisionalResolvedDistinctProjectCount =
      finalized.stats.provisionalResolvedDistinctProjectCount;
    efficiency.provisionalUnresolvedKeptCount = finalized.stats.provisionalUnresolvedKeptCount;
    efficiency.provisionalUnresolvedDiscardedAsProvenDuplicateCount =
      finalized.stats.provisionalUnresolvedDiscardedAsProvenDuplicateCount;
    efficiency.provisionalUnresolvedDiscardRejectedCount =
      finalized.stats.provisionalUnresolvedDiscardRejectedCount;
    efficiency.provisionalDuplicateProofProjectIdCount =
      finalized.stats.provisionalDuplicateProofProjectIdCount;
    efficiency.provisionalDuplicateProofStableLocatorCount =
      finalized.stats.provisionalDuplicateProofStableLocatorCount;
    efficiency.provisionalDuplicateProofOtherStableEvidenceCount =
      finalized.stats.provisionalDuplicateProofOtherStableEvidenceCount;
    efficiency.incompleteDueToUnresolvedProvisionalCount =
      finalized.stats.incompleteDueToUnresolvedProvisionalCount;
    efficiency.sameTitleIdentitySameProjectCount = finalized.stats.sameTitleIdentitySameProjectCount;
    efficiency.sameTitleIdentityDistinctProjectCount =
      finalized.stats.sameTitleIdentityDistinctProjectCount;
    efficiency.confirmedLogicalProjectCountBeforeIdentity =
      finalized.stats.confirmedLogicalProjectCountBeforeIdentity;
    efficiency.confirmedLogicalProjectCountAfterIdentity =
      finalized.stats.confirmedLogicalProjectCountAfterIdentity;
    efficiency.provisionalObservationCountBeforeIdentity =
      finalized.stats.provisionalObservationCountBeforeIdentity;
    efficiency.provisionalObservationCountAfterIdentity =
      finalized.stats.provisionalObservationCountAfterIdentity;
  }
  projects = finalized.projects;
  const finalResolution = collectProjectMetadataResolution({ projects });
  if (finalResolution.unresolvedCount > 0
    || finalized.stats.provisionalObservationUnresolvedCount > 0) {
    emitCollectorProjectIdentityFailureSummary(
      pending,
      projects,
      "context_projects_incomplete");
    recordCollectorProjectIdentityResolution(
      "collector project identity resolution failed",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        non_navigation_resolved_count: nonNavigationResolvedCount,
        navigation_resolved_count: navigationResolvedCount,
        current_project_index: collectorWindowState.currentProjectIndex,
        resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
        status: "error",
        error_code: "context_projects_incomplete",
        stage: "collector_project_identity_resolution_failed"
      });
    throw bridgeError(
      "ChatGPT ProjectのStable ID / URLを完全には取得できませんでした。",
      0,
      "context_projects_incomplete");
  }

  const collision = stableProjectIdCollisionDetails(projects);
  if (collision.duplicate_stable_project_id_group_count > 0) {
    emitCollectorProjectIdentityFailureSummary(
      pending,
      projects,
      "context_project_identity_collision",
      collision);
    recordCollectorProjectIdentityResolution(
      "collector project identity resolution failed",
      pending,
      projects,
      {
        project_identity_resolution_started: true,
        project_identity_resolution_completed: false,
        identity_resolution_input_count: projects.length,
        identity_resolution_resolved_count: finalResolution.resolvedCount,
        resolved_project_count: finalResolution.resolvedCount,
        discovery_catalog_count: discoveryProjects.length,
        final_project_count: projects.length,
        unique_stable_project_id_count: collision.unique_stable_project_id_count,
        duplicate_stable_project_id_count: collision.duplicate_stable_project_id_count,
        duplicate_stable_project_id_group_count: collision.duplicate_stable_project_id_group_count,
        duplicate_project_id_fingerprint: collision.duplicate_project_id_fingerprint,
        duplicate_project_indices: collision.duplicate_project_indices,
        duplicate_discovery_key_count: collision.duplicate_discovery_key_count,
        duplicate_rows_same_discovery_key: collision.duplicate_rows_same_discovery_key,
        collision_identity_sources: collision.collision_identity_sources,
        collision_candidate_consistency: collision.collision_candidate_consistency,
        collision_first_index: collision.collision_first_index,
        collision_second_index: collision.collision_second_index,
        unresolved_count: 0,
        status: "error",
        error_code: "context_project_identity_collision",
        stage: "collector_project_identity_collision"
      });
    throw bridgeError(
      "ChatGPT ProjectのStable IDが複数行に重複して割り当てられました。",
      0,
      "context_projects_incomplete");
  }

  collectorWindowState = {
    ...collectorWindowState,
    currentProjectIndex: -1,
    identityResolutionMethod: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
    navigationTargetVerified: navigationResolvedCount > 0
      ? collectorWindowState.navigationTargetVerified
      : false,
    projectUrlPatternValid: finalResolution.items.every((item) => item.resolved),
    projectIdUrlMatch: finalResolution.items.every((item) => item.resolved)
  };
  recordCollectorProjectIdentityResolution(
    "collector project identity resolution completed",
    pending,
    projects,
    {
      project_identity_resolution_started: true,
      project_identity_resolution_completed: true,
      non_navigation_resolved_count: nonNavigationResolvedCount,
      navigation_resolved_count: navigationResolvedCount,
      identity_resolution_input_count: projects.length,
      identity_resolution_resolved_count: finalResolution.resolvedCount,
      discovery_catalog_count: discoveryProjects.length,
      final_project_count: projects.length,
      unresolved_count: 0,
      current_project_index: -1,
      resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
      navigation_target_verified: navigationResolvedCount > 0
        ? collectorWindowState.navigationTargetVerified
        : false,
      project_url_pattern_valid: true,
      project_id_url_match: true,
      unique_stable_project_id_count: collision.unique_stable_project_id_count,
      duplicate_stable_project_id_count: collision.duplicate_stable_project_id_count,
      duplicate_stable_project_id_group_count: collision.duplicate_stable_project_id_group_count,
      unresolved_project_count: 0,
      resolved_project_count: finalResolution.resolvedCount,
      status: "completed",
      stage: "collector_project_identity_resolution_complete"
    });
  return {
    ...rootResult,
    projects,
    provisional_observations: [],
    unresolved_project_count: 0,
    project_identity_resolution_started: true,
    project_identity_resolution_completed: true,
    non_navigation_resolved_count: nonNavigationResolvedCount,
    navigation_resolved_count: navigationResolvedCount,
    unresolved_count: 0,
    resolution_method: domChecked && navigationResolvedCount > 0 ? "navigation" : "dom",
    navigation_target_verified: navigationResolvedCount > 0
      ? collectorWindowState.navigationTargetVerified
      : false,
    project_url_pattern_valid: true,
    project_id_url_match: true
  };
}

function recordCollectorProjectChatTelemetry(eventName, pending, target, projectIndex, source = null, fields = {}) {
  const discoveredChatCount = Array.isArray(source?.conversations)
    ? source.conversations.length
    : 0;
  const numberOrNull = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const sourceOrField = (key) => fields[key] !== undefined ? fields[key] : source?.[key];
  const telemetry = {
    request_id: pending?.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending?.tabId,
    current_project_id: target?.projectId || pending?.currentProjectId,
    current_project_identity_source: fields.current_project_identity_source
      || target?.identitySource
      || null,
    current_project_identity_navigation_fallback_used: fields.current_project_identity_navigation_fallback_used
      !== undefined
      ? fields.current_project_identity_navigation_fallback_used
      : (target?.navigationFallbackUsed === true),
    current_project_identity_discovery_index: Number.isSafeInteger(fields.current_project_identity_discovery_index)
      ? fields.current_project_identity_discovery_index
      : (Number.isSafeInteger(target?.discoveryIndex) ? target.discoveryIndex : null),
    project_index: projectIndex,
    total_projects: fields.total_projects,
    current_project_id_verified: sourceOrField("current_project_id_verified"),
    project_page_ready: sourceOrField("project_page_ready"),
    candidate_chat_link_count: numberOrNull(sourceOrField("candidate_chat_link_count")),
    candidate_chat_count: numberOrNull(sourceOrField("candidate_chat_count")),
    candidate_from_main_count: numberOrNull(sourceOrField("candidate_from_main_count")),
    candidate_from_sidebar_count: numberOrNull(sourceOrField("candidate_from_sidebar_count")),
    candidate_from_other_count: numberOrNull(sourceOrField("candidate_from_other_count")),
    matching_project_chat_link_count: numberOrNull(sourceOrField("matching_project_chat_link_count")),
    matching_project_chat_count: numberOrNull(sourceOrField("matching_project_chat_count")),
    rejected_projectless_chat_count: numberOrNull(sourceOrField("rejected_projectless_chat_count")),
    rejected_other_project_chat_count: numberOrNull(sourceOrField("rejected_other_project_chat_count")),
    main_candidate_with_project_id_count: numberOrNull(
      sourceOrField("main_candidate_with_project_id_count")),
    main_candidate_without_project_id_count: numberOrNull(
      sourceOrField("main_candidate_without_project_id_count")),
    main_current_project_match_count: numberOrNull(
      sourceOrField("main_current_project_match_count")),
    main_project_mismatch_count: numberOrNull(
      sourceOrField("main_project_mismatch_count")),
    main_candidate_project_id_unique_count: numberOrNull(
      sourceOrField("main_candidate_project_id_unique_count")),
    main_mismatch_project_id_unique_count: numberOrNull(
      sourceOrField("main_mismatch_project_id_unique_count")),
    main_current_project_id_occurrence_count: numberOrNull(
      sourceOrField("main_current_project_id_occurrence_count")),
    main_mismatch_all_same_project_id: sourceOrField("main_mismatch_all_same_project_id"),
    main_mismatch_same_project_id_count: numberOrNull(
      sourceOrField("main_mismatch_same_project_id_count")),
    main_mismatch_project_id: sourceOrField("main_mismatch_project_id"),
    project_id_source_chat_href_count: numberOrNull(
      sourceOrField("project_id_source_chat_href_count")),
    project_id_source_nested_href_count: numberOrNull(
      sourceOrField("project_id_source_nested_href_count")),
    project_id_source_data_attribute_count: numberOrNull(
      sourceOrField("project_id_source_data_attribute_count")),
    project_id_source_ancestor_count: numberOrNull(
      sourceOrField("project_id_source_ancestor_count")),
    project_id_source_project_wrapper_count: numberOrNull(
      sourceOrField("project_id_source_project_wrapper_count")),
    project_id_source_unknown_count: numberOrNull(
      sourceOrField("project_id_source_unknown_count")),
    project_chat_membership_inconsistent: sourceOrField("project_chat_membership_inconsistent"),
    main_projectless_count: numberOrNull(sourceOrField("main_projectless_count")),
    main_custom_gpt_count: numberOrNull(sourceOrField("main_custom_gpt_count")),
    main_candidate_from_verified_project_region_count: numberOrNull(
      sourceOrField("main_candidate_from_verified_project_region_count")),
    chat_scroll_container_count: numberOrNull(sourceOrField("chat_scroll_container_count")),
    main_found: sourceOrField("main_found"),
    main_region_found: sourceOrField("main_region_found"),
    main_descendant_count: numberOrNull(sourceOrField("main_descendant_count")),
    chat_tab_found: sourceOrField("chat_tab_found"),
    chat_list_found: sourceOrField("chat_list_found"),
    chat_list_candidate_count: numberOrNull(sourceOrField("chat_list_candidate_count")),
    chat_row_candidate_count: numberOrNull(sourceOrField("chat_row_candidate_count")),
    anchor_count: numberOrNull(sourceOrField("anchor_count")),
    button_count: numberOrNull(sourceOrField("button_count")),
    role_button_count: numberOrNull(sourceOrField("role_button_count")),
    role_link_count: numberOrNull(sourceOrField("role_link_count")),
    href_element_count: numberOrNull(sourceOrField("href_element_count")),
    data_attribute_candidate_count: numberOrNull(sourceOrField("data_attribute_candidate_count")),
    candidate_scroll_container_count: numberOrNull(sourceOrField("candidate_scroll_container_count")),
    scrollable_chat_candidate_count: numberOrNull(sourceOrField("scrollable_chat_candidate_count")),
    selected_scroll_container_found: sourceOrField("selected_scroll_container_found"),
    selected_scroll_client_height: numberOrNull(sourceOrField("selected_scroll_client_height")),
    selected_scroll_height: numberOrNull(sourceOrField("selected_scroll_height")),
    selected_scroll_distance_from_chat_list: numberOrNull(sourceOrField("selected_scroll_distance_from_chat_list")),
    relevant_region_present: sourceOrField("relevant_region_present"),
    document_ready_state: sourceOrField("document_ready_state"),
    mutation_count: numberOrNull(sourceOrField("mutation_count")),
    mutation_quiet_ms: numberOrNull(sourceOrField("mutation_quiet_ms")),
    chat_container_found: sourceOrField("chat_container_found"),
    visible_chat_count: numberOrNull(sourceOrField("visible_chat_count")),
    discovered_chat_count: numberOrNull(sourceOrField("discovered_chat_count")) ?? discoveredChatCount,
    deduped_chat_count: numberOrNull(sourceOrField("deduped_chat_count")) ?? discoveredChatCount,
    duplicate_chat_count: numberOrNull(sourceOrField("duplicate_chat_count")),
    scroll_iteration: numberOrNull(sourceOrField("scroll_iteration")),
    scan_iteration: numberOrNull(sourceOrField("scan_iteration")),
    scroll_top: numberOrNull(sourceOrField("scroll_top")),
    scroll_height: numberOrNull(sourceOrField("scroll_height")),
    scroll_complete: sourceOrField("scroll_complete"),
    scroll_position_changed: sourceOrField("scroll_position_changed"),
    reached_end: sourceOrField("reached_end"),
    project_chat_collection_complete: sourceOrField("project_chat_collection_complete"),
    project_chat_hydration_completed: sourceOrField("project_chat_hydration_completed"),
    project_chat_hydration_timeout: sourceOrField("project_chat_hydration_timeout"),
    chat_title_source: sourceOrField("chat_title_source"),
    title_element_found: sourceOrField("title_element_found"),
    preview_element_found: sourceOrField("preview_element_found"),
    title_extraction_success: sourceOrField("title_extraction_success"),
    title_differs_from_row_text: sourceOrField("title_differs_from_row_text"),
    title_fallback_used: sourceOrField("title_fallback_used"),
    title_candidate_count: numberOrNull(sourceOrField("title_candidate_count")),
    title_character_count: numberOrNull(sourceOrField("title_character_count")),
    row_text_character_count: numberOrNull(sourceOrField("row_text_character_count")),
    title_element_found_count: numberOrNull(sourceOrField("title_element_found_count")),
    preview_element_found_count: numberOrNull(sourceOrField("preview_element_found_count")),
    title_extraction_success_count: numberOrNull(
      sourceOrField("title_extraction_success_count")),
    title_fallback_used_count: numberOrNull(sourceOrField("title_fallback_used_count")),
    title_observed_chat_count: numberOrNull(sourceOrField("title_observed_chat_count")),
    status: fields.status || "observed",
    error_code: fields.error_code || source?.errorCode || source?.error_code,
    unresolved_reason: sourceOrField("unresolved_reason"),
    failure_stage: sourceOrField("failure_stage"),
    internal_reason: sourceOrField("internal_reason"),
    exception_name: sourceOrField("exception_name"),
    exception_reason: sourceOrField("exception_reason"),
    project_chat_collection_error_reason: sourceOrField("project_chat_collection_error_reason"),
    stage: fields.stage,
    target_tab_id: pending?.tabId
  };
  pending.projectChatDiagnostic = {
    ...(pending.projectChatDiagnostic || {}),
    ...telemetry
  };
  diagnostic(eventName, telemetry);
}

function emitCollectorProjectChatFailureSummary(pending, target, projectIndex, source = {}) {
  if (!pending || pending.projectChatFailureSummaryEmitted === true) return;
  const prior = pending.projectChatDiagnostic || {};
  const value = (key, fallback = null) => source[key] !== undefined
    ? source[key]
    : (prior[key] !== undefined ? prior[key] : fallback);
  const count = (key) => Number.isSafeInteger(value(key)) && value(key) >= 0 ? value(key) : 0;
  const errorCode = typeof value("error_code") === "string" && value("error_code")
    ? value("error_code")
    : "context_project_chats_incomplete";
  const unresolvedReason = typeof value("unresolved_reason") === "string"
    && value("unresolved_reason")
    ? value("unresolved_reason")
    : (typeof value("internal_reason") === "string" && value("internal_reason")
      ? value("internal_reason")
      : (typeof value("project_chat_collection_error_reason") === "string"
        && value("project_chat_collection_error_reason")
        ? value("project_chat_collection_error_reason")
        : errorCode));
  pending.projectChatFailureSummaryEmitted = true;
  diagnostic("collector project chat failure summary", {
    request_id: pending.requestId,
    refresh_generation: pending.generation,
    project_index: Number.isSafeInteger(projectIndex) ? projectIndex : 0,
    current_project_id_verified: value("current_project_id_verified") === true,
    project_page_ready: value("project_page_ready") === true,
    project_chat_hydration_completed: value("project_chat_hydration_completed") === true,
    project_chat_hydration_timeout: value("project_chat_hydration_timeout") === true,
    candidate_from_main_count: count("candidate_from_main_count"),
    candidate_from_sidebar_count: count("candidate_from_sidebar_count"),
    main_current_project_match_count: count("main_current_project_match_count"),
    main_project_mismatch_count: count("main_project_mismatch_count"),
    main_projectless_count: count("main_projectless_count"),
    project_id_source_chat_href_count: count("project_id_source_chat_href_count"),
    project_id_source_nested_href_count: count("project_id_source_nested_href_count"),
    project_id_source_data_attribute_count: count("project_id_source_data_attribute_count"),
    project_id_source_project_wrapper_count: count("project_id_source_project_wrapper_count"),
    project_id_source_ancestor_count: count("project_id_source_ancestor_count"),
    discovered_chat_count: count("discovered_chat_count"),
    deduped_chat_count: count("deduped_chat_count"),
    selected_scroll_container_found: value("selected_scroll_container_found") === true,
    scroll_complete: value("scroll_complete") === true,
    reached_end: value("reached_end") === true,
    project_chat_membership_inconsistent: value("project_chat_membership_inconsistent") === true,
    chat_title_source: typeof value("chat_title_source") === "string"
      ? value("chat_title_source")
      : "none",
    title_element_found: value("title_element_found") === true,
    preview_element_found: value("preview_element_found") === true,
    title_extraction_success: value("title_extraction_success") === true,
    title_differs_from_row_text: value("title_differs_from_row_text") === true,
    title_fallback_used: value("title_fallback_used") === true,
    title_candidate_count: count("title_candidate_count"),
    title_character_count: count("title_character_count"),
    row_text_character_count: count("row_text_character_count"),
    title_element_found_count: count("title_element_found_count"),
    preview_element_found_count: count("preview_element_found_count"),
    title_extraction_success_count: count("title_extraction_success_count"),
    title_fallback_used_count: count("title_fallback_used_count"),
    title_observed_chat_count: count("title_observed_chat_count"),
    error_code: errorCode,
    unresolved_reason: unresolvedReason,
    status: "error",
    stage: "collector_project_chat_failure_summary",
    target_tab_id: pending.tabId
  });
}

function validateCollectorProjectChatResult(source, pending, target, projectIndex, tab) {
  if (!source || typeof source !== "object") {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_response_invalid",
        failure_stage: "project_chat_result_validation",
        internal_reason: "collector_result_missing",
        exception_name: "none",
        exception_reason: "none",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPT Project内のChat一覧を取得できませんでした。",
      0,
      "context_project_chats_incomplete");
  }
  const requestId = source.requestId || source.request_id;
  if (requestId !== pending.requestId || (source.mode || "list") !== "list") {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_response_correlation_failed",
        failure_stage: "project_chat_result_validation",
        internal_reason: "context_response_correlation_failed",
        exception_name: "none",
        exception_reason: "none",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPT Project内Chat responseの識別情報が一致しません。",
      0,
      "context_response_correlation_failed");
  }
  if (source.status === "error") {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: source.errorCode || source.error_code || "context_extraction_failed",
        failure_stage: source.failure_stage || source.stage || "project_chat_collection",
        internal_reason: source.internal_reason
          || source.project_chat_collection_error_reason
          || "content_script_collection_failed",
        exception_name: source.exception_name || "none",
        exception_reason: source.exception_reason || "none",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      source.message || "ChatGPT Project内のChat一覧を取得できませんでした。",
      0,
      source.errorCode || source.error_code || "context_project_chats_incomplete");
  }
  if (source.status !== "ok"
    || !Array.isArray(source.projects)
    || !Array.isArray(source.conversations)) {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_response_invalid",
        failure_stage: "project_chat_result_validation",
        internal_reason: "collector_result_malformed",
        exception_name: "none",
        exception_reason: "none",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPT Project内Chat responseが不正です。",
      0,
      "context_response_invalid");
  }

  const actualProjectUrl = safeChatGptContextUrl(tab?.url);
  const actualProjectId = chatGptProjectId(actualProjectUrl);
  const targetProjectId = target?.projectId || null;
  const routeVerified = Boolean(
    actualProjectUrl
    && safeChatGptProjectUrl(actualProjectUrl)
    && targetProjectId
    && actualProjectId === targetProjectId);
  const pageReady = source.project_page_ready === undefined
    ? routeVerified
    : source.project_page_ready === true;
  const currentProjectVerified = source.current_project_id_verified === undefined
    ? routeVerified
    : source.current_project_id_verified === true;
  const projectChatComplete = source.project_chat_collection_complete === undefined
    ? source.sidebar_scroll_complete === true
    : source.project_chat_collection_complete === true;
  const chatContainerFound = source.chat_container_found === undefined
    ? projectChatComplete
    : source.chat_container_found === true;

  if (!routeVerified || !pageReady || !currentProjectVerified) {
    recordCollectorProjectChatTelemetry(
      "collector project page validation failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_page_unavailable",
        failure_stage: "project_page_validation",
        internal_reason: "project_route_not_verified",
        project_page_ready: pageReady,
        current_project_id_verified: currentProjectVerified,
        stage: "collector_project_page_validation"
      });
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_page_unavailable",
        failure_stage: "project_page_validation",
        internal_reason: "project_route_not_verified",
        project_page_ready: pageReady,
        current_project_id_verified: currentProjectVerified,
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPTのProjectページを確認できませんでした。",
      0,
      "context_project_page_unavailable");
  }

  if (source.project_chat_membership_inconsistent === true) {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection incomplete",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_chat_membership_mismatch",
        failure_stage: "project_chat_membership",
        internal_reason: "main_candidates_all_other_project",
        stage: "collector_project_chat_collection_incomplete"
      });
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_chat_membership_mismatch",
        failure_stage: "project_chat_membership",
        internal_reason: "main_candidates_all_other_project",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPT Project内のChat所属判定が一致しませんでした。",
      0,
      "context_project_chat_membership_mismatch");
  }

  if (!projectChatComplete || !chatContainerFound) {
    recordCollectorProjectChatTelemetry(
      "collector project chat collection incomplete",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_chats_incomplete",
        failure_stage: "project_chat_scan",
        internal_reason: source.project_chat_hydration_timeout === true
          ? "project_page_not_hydrated"
          : "project_chat_scan_incomplete",
        exception_name: "none",
        exception_reason: "none",
        stage: "collector_project_chat_collection_incomplete"
      });
    recordCollectorProjectChatTelemetry(
      "collector project chat collection failed",
      pending,
      target,
      projectIndex,
      source,
      {
        status: "error",
        error_code: "context_project_chats_incomplete",
        failure_stage: "project_chat_scan",
        internal_reason: source.project_chat_hydration_timeout === true
          ? "project_page_not_hydrated"
          : "project_chat_scan_incomplete",
        exception_name: "none",
        exception_reason: "none",
        stage: "collector_project_chat_collection_failed"
      });
    throw bridgeError(
      "ChatGPT Project内のChat一覧を完全には取得できませんでした。",
      0,
      "context_project_chats_incomplete");
  }
  return {
    routeVerified,
    pageReady,
    currentProjectVerified,
    projectChatComplete,
    chatContainerFound
  };
}

async function collectProjectsOnce(tab, pending, request) {
  throwIfCollectorRequestSuperseded(pending);
  const rootResult = await dispatchToContentScript(tab.id, {
    type: "GET_CHATGPT_CONTEXT",
    requestId: pending.requestId,
    mode: "list",
    collection: "root",
    maxScrolls: COLLECTOR_PROJECT_SCROLL_MAX,
    // Project discovery reuses the established metadata-only Sidebar scan.
    // An explicitly labelled "さらに表示/もっと見る" control may be
    // expanded so virtualized Project metadata can appear. It is not a
    // Project candidate and is never used to infer an ID; generic Sidebar
    // rows remain non-clickable.
    maxMoreClicks: 12,
    allowSidebarControls: true,
    timeoutMs: COLLECTOR_ROOT_TIMEOUT_MS,
    rootHydrationCompleted: collectorWindowState.rootHydrationCompleted === true,
    projectDiscoverySource: "existing_project_section_metadata"
  }, request, {
    timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
    timeoutStage: "collector_content_script_timeout"
  });
  // A newer Refresh may supersede this request while the Content Script was
  // scanning. Do not let that old response update Collector telemetry or
  // become the input to metadata resolution even if the Chrome message call
  // itself completed successfully.
  throwIfCollectorRequestSuperseded(pending);
  recordCollectorProjectDiscoveryResult(rootResult, pending);
  // Validate only the response envelope and correlation here. Project
  // identity resolution belongs to the orchestration layer, after this
  // completed Sidebar scan has handed its immutable arrays to Background.
  validateCollectorRootResult(rootResult, pending);
  recordCollectorScrollTelemetry(rootResult, pending, {
    project_index: -1,
    stage: "collector_root_sidebar_scan"
  });

  if (rootResult.sidebar_scroll_complete === true
    && rootResult.project_section_found === true) {
    return rootResult;
  }

  diagnostic("collector root sidebar scan incomplete", {
    request_id: pending.requestId,
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: pending.tabId,
    sidebar_scroll_top: rootResult.sidebar_scroll_top,
    sidebar_scroll_height: rootResult.sidebar_scroll_height,
    sidebar_client_height: rootResult.sidebar_client_height,
    sidebar_can_scroll: rootResult.sidebar_can_scroll === true,
    sidebar_at_bottom: rootResult.sidebar_at_bottom === true,
    visible_project_rows: rootResult.visible_project_rows,
    discovered_project_count: rootResult.projects.length,
    content_discovered_project_count: rootResult.discovered_project_count,
    project_section_found: rootResult.project_section_found === true,
    no_growth_count: rootResult.no_growth_count,
    sidebar_scroll_complete: rootResult.sidebar_scroll_complete === true,
    status: "error",
    error_code: "context_projects_incomplete",
    stage: "collector_root_sidebar_scan_incomplete",
    target_tab_id: pending.tabId
  });
  throw bridgeError("ChatGPT Projectを取得できませんでした。", 0, "context_projects_incomplete");
}

function collectCollectorRootResult(tab, pending, request, caller = "refresh_orchestration") {
  const discovery = projectDiscoveryStateFor(pending);
  if (discovery.completed && discovery.result) {
    discovery.alreadyCompleted = true;
    recordProjectDiscoveryTelemetry("collector project discovery duplicate suppressed", pending, {
      project_discovery_caller: caller,
      status: "suppressed",
      stage: "collector_project_discovery_already_completed",
      target_tab_id: pending.tabId
    });
    return Promise.resolve(discovery.result);
  }
  if (discovery.inFlight && discovery.promise) {
    recordProjectDiscoveryTelemetry("collector project discovery in-flight duplicate suppressed", pending, {
      project_discovery_caller: caller,
      status: "suppressed",
      stage: "collector_project_discovery_in_flight",
      target_tab_id: pending.tabId
    });
    return discovery.promise;
  }

  const scanAlreadyCompleted = discovery.scanCompleted === true
    && pending.projectDiscoveryScanResult
    && Array.isArray(pending.projectDiscoveryScanResult.projects);
  // A Project discovery scan is one-shot for a Refresh generation.  Once a
  // scan has started, a lost Collector medium must not silently re-enter the
  // scan and move the Sidebar a second time.  Identity resolution may still
  // resume from `scanAlreadyCompleted`, but an incomplete scan is surfaced to
  // the caller with its original snapshot boundary intact.
  if (!scanAlreadyCompleted && discovery.callCount > 0) {
    discovery.alreadyCompleted = false;
    recordProjectDiscoveryTelemetry("collector project discovery duplicate blocked", pending, {
      project_discovery_caller: caller,
      status: "error",
      error_code: "collector_project_discovery_already_attempted",
      stage: "collector_project_discovery_duplicate_blocked",
      internal_reason: "project_discovery_already_attempted",
      target_tab_id: pending.tabId
    });
    throw bridgeError(
      "ChatGPT Project discoveryは同じRefreshで再実行できません。",
      0,
      "context_projects_incomplete");
  }
  if (!scanAlreadyCompleted) {
    discovery.callCount += 1;
    discovery.started = true;
    discovery.caller = caller;
    discovery.inFlight = true;
    discovery.alreadyCompleted = false;
    recordProjectDiscoveryTelemetry("collector project discovery started", pending, {
      project_discovery_caller: caller,
      status: "started",
      stage: "collector_project_discovery_start",
      target_tab_id: pending.tabId
    });
  } else {
    discovery.inFlight = true;
    discovery.caller = caller;
    recordProjectDiscoveryTelemetry("collector project identity resolution resumed", pending, {
      project_discovery_caller: caller,
      status: "resumed",
      stage: "collector_project_identity_resolution_resumed",
      target_tab_id: pending.tabId
    });
  }

  const runPromise = (async () => {
    try {
      const rootResult = scanAlreadyCompleted
        ? pending.projectDiscoveryScanResult
        : await collectProjectsOnce(tab, pending, request);
      throwIfCollectorRequestSuperseded(pending);
      const resultShape = pending.collectorProjectDiscoveryResultShape
        || recordCollectorProjectDiscoveryResult(rootResult, pending);
      const projectDataLostBetweenLayers = resultShape.contentDiscoveredProjectCount !== null
        && resultShape.contentDiscoveredProjectCount > resultShape.backgroundProjectsLength;
      if (projectDataLostBetweenLayers || rootResult.projects.length === 0) {
        const errorCode = "context_projects_incomplete";
        const projectResolution = collectProjectMetadataResolution(rootResult);
        recordCollectorProjectMetadataResolutionFailure(projectResolution, pending, errorCode);
        diagnostic("collector project result handoff incomplete", {
          request_id: pending.requestId,
          refresh_generation: projectDiscoveryStateFor(pending).refreshGeneration,
          project_discovery_run_id: projectDiscoveryStateFor(pending).runId,
          project_discovery_call_count: projectDiscoveryStateFor(pending).callCount,
          project_discovery_result_received: true,
          discovered_project_count: rootResult.projects.length,
          background_projects_length: resultShape.backgroundProjectsLength,
          content_discovered_project_count: resultShape.contentDiscoveredProjectCount,
          response_shape: resultShape.responseShape,
          status: "error",
          error_code: projectDataLostBetweenLayers
            ? "collector_project_result_handoff_mismatch"
            : errorCode,
          stage: "collector_project_result_handoff_incomplete",
          target_tab_id: pending.tabId
        });
        throw bridgeError(
          projectDataLostBetweenLayers
            ? "ChatGPT Projectのmetadataを完全には取得できませんでした。"
            : "ChatGPT Projectを取得できませんでした。",
          0,
          errorCode);
      }
      if (!scanAlreadyCompleted) {
        discovery.scanCompleted = true;
        pending.projectDiscoveryScanResult = rootResult;
        pending.projectIdentityResult = null;
        recordProjectDiscoveryTelemetry("collector project discovery scan completed", pending, {
          project_discovery_caller: caller,
          project_discovery_scan_completed: true,
          status: "completed",
          stage: "collector_project_discovery_scan_complete",
          discovered_project_count: rootResult.projects.length,
          discovered_chat_count: rootResult.conversations.length,
          target_tab_id: pending.tabId
        });
      }
      const identityResolutionStartedAt = Date.now();
      let resolvedRootResult;
      try {
        resolvedRootResult = await resolveCollectorProjectIdentities(
          tab,
          pending,
          request,
          rootResult);
      } finally {
        addCollectorProjectDiscoveryEfficiencyDuration(
          pending,
          "identityResolutionMs",
          Math.max(0, Date.now() - identityResolutionStartedAt));
      }
      throwIfCollectorRequestSuperseded(pending);
      const projectResolution = recordCollectorProjectMetadataResolution(resolvedRootResult, pending);
      const unresolvedProjectCount = validateCollectorRootResult(resolvedRootResult, pending);
      if (unresolvedProjectCount > 0) {
        recordCollectorProjectMetadataResolutionFailure(
          projectResolution,
          pending,
          "context_projects_incomplete");
        throw bridgeError(
          "ChatGPT Projectのmetadataを完全には取得できませんでした。",
          0,
          "context_projects_incomplete");
      }
      discovery.result = resolvedRootResult;
      discovery.completed = true;
      pending.projectDiscoveryResult = resolvedRootResult;
      pending.projectIdentityResult = resolvedRootResult;
      discovery.inFlight = false;
      recordProjectDiscoveryTelemetry("collector project discovery completed", pending, {
        project_discovery_caller: caller,
        status: "completed",
        stage: "collector_project_discovery_complete",
        discovered_project_count: rootResult.projects.length,
        discovered_chat_count: rootResult.conversations.length,
        target_tab_id: pending.tabId
      });
      return resolvedRootResult;
    } catch (error) {
      discovery.result = null;
      discovery.completed = false;
      discovery.inFlight = false;
      recordProjectDiscoveryTelemetry("collector project discovery failed", pending, {
        project_discovery_caller: caller,
        status: "error",
        error_code: error?.code || "context_projects_incomplete",
        stage: error?.stage || "collector_project_discovery_failed",
        target_tab_id: pending.tabId
      });
      throw error;
    } finally {
      if (discovery.promise === runPromise) discovery.promise = null;
      syncProjectDiscoveryTelemetry(pending, discovery);
    }
  })();
  discovery.promise = runPromise;
  return runPromise;
}

function isProjectlessCollectorConversation(conversation) {
  const explicitProjectId = safeContextIdentifier(
    conversation?.project_id || conversation?.projectId);
  if (explicitProjectId) return false;
  return chatGptProjectId(safeChatGptContextUrl(conversation?.url)) === null;
}

async function collectRootChatGptContext(tab, pending) {
  throwIfCollectorRequestSuperseded(pending);
  const rootResult = pending.projectDiscoveryResult;
  const discovery = projectDiscoveryStateFor(pending);
  if (!rootResult || !discovery.completed || discovery.result !== rootResult) {
    diagnostic("collector root result unavailable", {
      request_id: pending.requestId,
      refresh_generation: discovery.refreshGeneration,
      project_discovery_run_id: discovery.runId,
      project_discovery_call_count: discovery.callCount,
      project_discovery_completed: discovery.completed,
      project_discovery_result_received: Boolean(rootResult),
      status: "error",
      error_code: "collector_project_discovery_result_unavailable",
      stage: "collector_root_result_guard",
      target_tab_id: pending.tabId
    });
    throw bridgeError(
      "ChatGPT Project一覧を確定できませんでした。",
      0,
      "context_projects_incomplete");
  }

  const result = {
    ...rootResult,
    // A root refresh publishes Project metadata and Projectless Chats only.
    // Project-page Chats are deliberately loaded by the selection path.
    conversations: rootResult.conversations.filter(isProjectlessCollectorConversation)
  };
  collectorWindowLifecycle("Collected", {
    tabId: tab?.id || pending.tabId,
    currentProjectId: null,
    currentProjectUrl: null,
    collectorNavigationTarget: null,
    projectDiscoverySource: rootResult.project_discovery_source
      || collectorWindowState.projectDiscoverySource,
    projectIndex: -1,
    totalProjects: result.projects.length,
    discoveredProjectCount: result.projects.length,
    discoveredChatCount: result.conversations.length
  });
  return result;
}

async function collectProjectChatForTarget(tab, pending, request, target, projectIndex = 0, totalProjects = 1) {
  throwIfCollectorRequestSuperseded(pending);
  if (!target) {
    throw bridgeError(
      "ChatGPT Projectの識別情報が不正です。",
      0,
      "context_project_target_invalid");
  }
  const discovery = pending.projectDiscovery ? projectDiscoveryStateFor(pending) : null;
  const navigationTrace = {
    request_id: pending.requestId,
    project_id: target.projectId,
    project_index: projectIndex,
    total_projects: totalProjects,
    project_discovery_completed: discovery?.completed === true,
    project_discovery_run_id: discovery?.runId || null,
    project_discovery_result_received: Boolean(pending.projectDiscoveryResult),
    project_selection_target_verified: pending.projectOnly === true,
    project_selection: pending.projectOnly === true,
    stage: "collector_project_navigation"
  };
  pending.currentProjectId = target.projectId;
  recordCollectorProjectChatTelemetry(
    "collector project chat collection start",
    pending,
    target,
    projectIndex,
    null,
    {
      total_projects: totalProjects,
      status: "started",
      stage: "collector_project_chat_collection_start"
    });

  tab = await navigateCollectorTab(
    await ensureCollectorWindow(COLLECTOR_TAB_URL, navigationTrace),
    target.projectUrl,
    navigationTrace);
  tab = await reconcileCollectorWindowTabs(
    collectorWindowState.windowId,
    tab.id,
    {
      request_id: pending.requestId,
      project_id: target.projectId,
      project_index: projectIndex,
      total_projects: totalProjects,
      stage: "collector_project_tab_reconciled"
    });
  if (!tab) {
    throw bridgeError(
      "Collector Window内のCollector Tabを確認できません。",
      0,
      "collector_tab_count_invalid");
  }
  tab = await enforceCollectorTab(tab, {
    request_id: pending.requestId,
    project_id: target.projectId,
    project_index: projectIndex,
    total_projects: totalProjects,
    stage: "collector_project_tab_enforced"
  });
  pending.tabId = tab.id;
  throwIfCollectorRequestSuperseded(pending);
  const currentProjectUrl = safeChatGptContextUrl(tab.url);
  const currentProjectId = chatGptProjectId(currentProjectUrl);
  const projectPageReady = Boolean(currentProjectId === target.projectId
    && safeChatGptProjectUrl(currentProjectUrl));
  recordCollectorProjectChatTelemetry(
    "collector project page ready",
    pending,
    target,
    projectIndex,
    null,
    {
      total_projects: totalProjects,
      current_project_id_verified: projectPageReady,
      project_page_ready: projectPageReady,
      status: "ready",
      stage: "collector_project_page_ready"
    });
  const projectResult = await dispatchToContentScript(tab.id, {
    type: "GET_CHATGPT_CONTEXT",
    requestId: pending.requestId,
    mode: "list",
    collection: "project",
    projectId: target.projectId,
    projectIndex,
    totalProjects,
    refreshGeneration: pending.generation,
    collectorTabId: tab.id,
    maxScrolls: COLLECTOR_PROJECT_SCROLL_MAX,
    timeoutMs: COLLECTOR_PROJECT_TIMEOUT_MS
  }, request, {
    timeoutMs: COLLECTOR_CONTEXT_TIMEOUT_MS,
    timeoutStage: "collector_project_content_script_timeout"
  });
  throwIfCollectorRequestSuperseded(pending);

  // Preserve the established selected-Project scan and its diagnostics. The
  // result is intentionally not mixed into the root catalog until validation
  // has proved that it belongs to the requested Project page.
  recordCollectorProjectChatTelemetry(
    "collector project chat dom structure",
    pending,
    target,
    projectIndex,
    projectResult,
    {
      total_projects: totalProjects,
      status: projectResult?.status === "error" ? "error" : "observed",
      stage: "collector_project_chat_dom_structure"
    });
  recordCollectorProjectChatTelemetry(
    "collector project chat source classification",
    pending,
    target,
    projectIndex,
    projectResult,
    {
      total_projects: totalProjects,
      status: projectResult?.status === "error" ? "error" : "observed",
      stage: "collector_project_chat_source_classification"
    });
  recordCollectorProjectChatTelemetry(
    "collector project chat scroll candidates",
    pending,
    target,
    projectIndex,
    projectResult,
    {
      total_projects: totalProjects,
      status: projectResult?.status === "error" ? "error" : "observed",
      stage: "collector_project_chat_scroll_candidates"
    });
  recordCollectorProjectChatTelemetry(
    "collector project chat scan",
    pending,
    target,
    projectIndex,
    projectResult,
    {
      total_projects: totalProjects,
      status: "observed",
      stage: "collector_project_chat_scan"
    });
  validateCollectorProjectChatResult(projectResult, pending, target, projectIndex, tab);
  recordCollectorProjectChatTelemetry(
    "collector project chat collection complete",
    pending,
    target,
    projectIndex,
    projectResult,
    {
      total_projects: totalProjects,
      current_project_id_verified: true,
      project_page_ready: true,
      status: "completed",
      stage: "collector_project_chat_collection_complete"
    });
  return { tab, projectResult };
}

async function collectSelectedProjectChatContext(tab, pending, request, target) {
  throwIfCollectorRequestSuperseded(pending);
  const aggregate = {
    type: CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE,
    requestId: pending.requestId,
    mode: "list",
    status: "ok",
    projects: [],
    conversations: [],
    current: null
  };
  const result = await collectProjectChatForTarget(tab, pending, request, target, 0, 1);
  pending.tabId = result.tab.id;
  mergeCollectorMetadata(aggregate, result.projectResult, target.projectId);
  collectorWindowLifecycle("Collected", {
    tabId: result.tab.id,
    currentProjectId: target.projectId,
    currentProjectUrl: target.projectUrl,
    collectorNavigationTarget: target.projectUrl,
    projectIndex: 0,
    totalProjects: 1,
    discoveredProjectCount: aggregate.projects.length,
    discoveredChatCount: aggregate.conversations.length
  });
  return aggregate;
}

async function collectSelectedProjectChatWithRecovery(tab, pending, request, target) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      throwIfCollectorRequestSuperseded(pending);
      if (attempt > 0) {
        collectorWindowLifecycle("Recovering", {
          retryCount: attempt,
          currentProjectId: target.projectId,
          projectIndex: 0
        });
        tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, {
          request_id: pending.requestId,
          project_id: target.projectId,
          retry_count: attempt,
          project_selection_target_verified: true,
          stage: "collector_project_selection_recovery"
        });
        pending.tabId = tab.id;
        pending.collectorWindowId = collectorWindowState.windowId;
        pending.collectorMediumLost = false;
        pending.collectorMediumLossReason = null;
      }
      return await collectSelectedProjectChatContext(tab, pending, request, target);
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) throw error;
      lastError = error;
      const canRecover = pending.collectorMediumLost === true && attempt === 0;
      if (!canRecover) break;
      diagnostic("collector selected Project recovery requested", {
        request_id: pending.requestId,
        project_id: target.projectId,
        retry_count: attempt + 1,
        error_code: error?.code || "collector_collection_failed",
        status: "recovering",
        stage: "collector_selected_project_recovery_requested"
      });
    }
  }
  emitCollectorProjectChatFailureSummary(
    pending,
    target,
    0,
    {
      error_code: lastError?.code || "context_project_chats_incomplete",
      ...(lastError?.stage ? { internal_reason: lastError.stage } : {})
    });
  throw lastError || bridgeError(
    "ChatGPT Project内のChat一覧を取得できませんでした。",
    0,
    "context_project_chats_incomplete");
}

async function collectContextWithRecovery(tab, pending, request) {
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      throwIfCollectorRequestSuperseded(pending);
      if (attempt > 0) {
        collectorWindowLifecycle("Recovering", {
          retryCount: attempt,
          currentProjectId: null,
          projectIndex: -1
        });
        tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, {
          request_id: pending.requestId,
          retry_count: attempt
        });
        pending.tabId = tab.id;
        pending.collectorWindowId = collectorWindowState.windowId;
        pending.collectorMediumLost = false;
        pending.collectorMediumLossReason = null;
      }
      const needsRootHydration = !pending.currentOnly
        && !(
          projectDiscoveryStateFor(pending).scanCompleted === true
          && pending.projectDiscoveryScanResult
          && Array.isArray(pending.projectDiscoveryScanResult.projects)
        );
      const rootNavigationGeneration = "refresh-"
        + pending.generation
        + "-root-"
        + (attempt + 1);
      tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
        request_id: pending.requestId,
        retry_count: attempt,
        refresh_generation: pending.generation,
        expected_root_url: safeChatGptContextUrl(COLLECTOR_TAB_URL),
        root_navigation_generation: rootNavigationGeneration,
        stage: "collector_root_navigation"
      });
      pending.tabId = tab.id;
      tab = await ensureCollectorReady(tab, {
        request_id: pending.requestId,
        retry_count: attempt,
        stage: "collector_viewport_required"
      });
      pending.tabId = tab.id;
      pending.collectorWindowId = collectorWindowState.windowId;
      if (needsRootHydration) {
        tab = await waitForRootSidebarHydration(
          tab,
          pending,
          request,
          attempt);
        pending.tabId = tab.id;
        pending.collectorWindowId = collectorWindowState.windowId;
      }
      if (!pending.currentOnly
        && (!pending.projectDiscoveryResult || !projectDiscoveryStateFor(pending).completed)) {
        // This is the single explicit Project discovery entry point for the
        // current Refresh generation. Recovery after a completed root scan
        // skips it and reuses pending.projectDiscoveryResult.
        await collectCollectorRootResult(tab, pending, request, "refresh_orchestration");
      }
      return await collectRootChatGptContext(tab, pending);
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) throw error;
      lastError = error;
      const terminalError = [
        "context_projects_incomplete",
        "collector_viewport_too_narrow",
        "collector_sidebar_not_ready",
        "collector_viewport_resize_failed"
      ].includes(error?.code);
      // A failed metadata scan is one-shot. The only permitted second Project
      // scan is a genuine Collector medium loss reported by the Chrome
      // lifecycle listeners while that scan was in flight. Ordinary DOM
      // readiness/retry paths must surface the error instead of starting a
      // second scan and moving the Sidebar back to the top.
      const discovery = projectDiscoveryStateFor(pending);
      const discoveryCanResume = discovery.callCount === 0
        || discovery.scanCompleted === true;
      const canRecover = pending.collectorMediumLost === true
        && attempt === 0
        && discoveryCanResume;
      if (pending.collectorMediumLost === true
        && attempt === 0
        && !discoveryCanResume) {
        diagnostic("collector project discovery recovery blocked", {
          request_id: pending.requestId,
          retry_count: attempt + 1,
          refresh_generation: discovery.refreshGeneration,
          project_discovery_run_id: discovery.runId,
          project_discovery_call_count: discovery.callCount,
          project_discovery_started: discovery.started,
          project_discovery_scan_completed: discovery.scanCompleted,
          error_code: "collector_project_discovery_already_attempted",
          internal_reason: "project_discovery_already_attempted",
          status: "error",
          stage: "collector_project_discovery_recovery_blocked",
          target_tab_id: pending.tabId
        });
      }
      if (!canRecover || (terminalError && pending.collectorMediumLost !== true)) {
        if (pending.identityResolutionAttempted === true) {
          const identityProjects = Array.isArray(pending.projectIdentityResult?.projects)
            ? pending.projectIdentityResult.projects
            : (Array.isArray(pending.projectDiscoveryScanResult?.projects)
              ? pending.projectDiscoveryScanResult.projects
              : []);
          emitCollectorProjectIdentityFailureSummary(
            pending,
            identityProjects,
            error?.code || "context_projects_incomplete");
        }
        diagnostic("collector refresh terminal failure", {
          request_id: pending.requestId,
          retry_count: attempt,
          error_code: error.code,
          status: "error",
          stage: "collector_refresh_terminal_failure",
          target_tab_id: pending.tabId
        });
        break;
      }
      collectorWindowState = { ...collectorWindowState, retryCount: attempt + 1 };
      diagnostic("collector recovery requested", {
        request_id: pending.requestId,
        retry_count: attempt + 1,
        error_code: error?.code || "collector_collection_failed",
        status: "recovering",
        stage: "collector_recovery_requested"
      });
    }
  }
  throw lastError || bridgeError("ChatGPT Context収集に失敗しました。", 0, "context_extraction_failed");
}

async function requestChatGptContext(message, bridgeSocket, currentOnly) {
  const requestId = message?.request_id;
  const request = { ...message, mode: currentOnly ? "current" : "list" };
  const projectOnly = !currentOnly && request.collection === "project";
  const selectedProjectTarget = projectOnly
    ? collectorProjectTarget({
      project_id: request.project_id || request.projectId,
      url: request.project_url || request.projectUrl
    })
    : null;
  if (!safeContextIdentifier(requestId)) {
    const pending = { requestId: String(requestId || ""), currentOnly, bridgeSocket, tabId: null, message: request };
    sendChatGptContextResponseToBridge(
      contextResultError(request, "invalid_context_request", "ChatGPT Context requestが不正です。", "context_request_validation"),
      pending);
    return;
  }
  if (bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
    const pending = { requestId, currentOnly, bridgeSocket, tabId: null, message: request };
    sendChatGptContextResponseToBridge(
      contextResultError(request, "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection"),
      pending);
    return;
  }
  if (projectOnly && !selectedProjectTarget) {
    const pending = {
      requestId,
      currentOnly,
      projectOnly,
      bridgeSocket,
      tabId: null,
      message: request
    };
    sendChatGptContextResponseToBridge(
      contextResultError(
        request,
        "context_project_target_invalid",
        "ChatGPT Projectの識別情報が不正です。",
        "context_project_target_validation"),
      pending);
    return;
  }

  const generation = ++collectorContextGeneration;

  // Context discovery is deliberately isolated from execution. A single
  // active tab inside the connector-owned Collector Window is reused for the
  // root sidebar scan and every Project page; it is never reused as the
  // Managed Execution Tab or a user's foreground tab.
  await withCollectorWindowOperation(async () => {
    let tab = null;
    const pending = {
      requestId,
      currentOnly,
      projectOnly,
      selectedProjectTarget,
      bridgeSocket,
      tabId: null,
      collectorWindowId: null,
      collectorMediumLost: false,
      collectorMediumLossReason: null,
      projectDiscoveryResult: null,
      projectDiscoveryScanResult: null,
      projectIdentityResult: null,
      identityDiagnostics: new Map(),
      identityResolutionAttempted: false,
      identityFailureSummaryEmitted: false,
      identityTelemetryActive: false,
      projectChatDiagnostic: null,
      projectChatFailureSummaryEmitted: false,
      projectDiscoveryEfficiency: null,
      rootNavigationGeneration: null,
      message: request,
      generation
    };
    collectorProjectDiscoveryEfficiencyFor(pending);
    const allowedCollectionTriggers = new Set([
      "manual_refresh",
      "startup",
      "recovery",
      "project_selection"
    ]);
    const collectionTrigger = allowedCollectionTriggers.has(request.collection_trigger)
      ? request.collection_trigger
      : (allowedCollectionTriggers.has(request.collectionTrigger)
        ? request.collectionTrigger
        : null);
    if (collectionTrigger && pending.projectDiscoveryEfficiency) {
      pending.projectDiscoveryEfficiency.collectionTriggerSource = collectionTrigger;
    }
    const projectDiscovery = currentOnly || projectOnly ? null : projectDiscoveryStateFor(pending);
    try {
      throwIfCollectorRequestSuperseded(pending);
      contextRequests.set(requestId, pending);
      if (bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
        await completeContextRequest(
          contextResultError(request, "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection"),
          pending);
        return;
      }
      collectorWindowState = {
        ...collectorWindowState,
        requestId,
        refreshGeneration: generation,
        retryCount: 0,
        projectDiscoveryRetryCount: 0,
        projectDiscoveryRunId: projectDiscovery?.runId || null,
        projectDiscoveryCallCount: projectDiscovery?.callCount || 0,
        projectDiscoveryStarted: projectDiscovery?.started === true,
        projectDiscoveryCompleted: projectDiscovery?.completed === true,
        projectDiscoveryScanCompleted: projectDiscovery?.scanCompleted === true,
        projectDiscoveryCaller: projectDiscovery?.caller || null,
        projectDiscoveryInFlight: projectDiscovery?.inFlight === true,
        projectDiscoveryAlreadyCompleted: false,
        projectDiscoveryScrollDirection: null,
        projectDiscoveryRestoreCount: 0,
        viewportRetryCount: 0,
        windowWidth: null,
        windowHeight: null,
        contentInnerWidth: null,
        contentInnerHeight: null,
        sidebarExpectedVisible: false,
        activeTabIdInWindow: null,
        collectorTabActive: false,
        tabCountInWindow: 0,
        sidebarScrollTop: null,
        sidebarScrollHeight: null,
        sidebarClientHeight: null,
        sidebarCanScroll: false,
        sidebarAtBottom: false,
        visibleProjectRows: 0,
        projectSectionFound: false,
        noGrowthCount: 0,
        currentProjectId: null,
        projectIndex: -1,
        projectDiscoverySource: "existing_project_section_metadata",
        currentProjectUrl: null,
        collectorNavigationTarget: null,
        totalProjects: 0,
        discoveredProjectCount: 0,
        discoveredChatCount: 0,
        projectIdentityResolutionStarted: false,
        projectIdentityResolutionCompleted: false,
        nonNavigationResolvedCount: 0,
        navigationResolvedCount: 0,
        identityUnresolvedCount: 0,
        currentProjectIndex: -1,
        identityResolutionMethod: null,
        navigationTargetVerified: false,
        projectUrlPatternValid: false,
        projectIdUrlMatch: false,
        rootHydrationStarted: false,
        rootHydrationCompleted: false,
        rootHydrationTimeout: false,
        hydrationWaitMs: 0,
        documentReadyState: null,
        sidebarRootPresent: false,
        sidebarScrollContainerPresent: false,
        sidebarShellPresent: false,
        sidebarSectionsStable: false,
        mutationCount: 0,
        mutationQuietMs: 0,
        rootUrlVerified: false,
        rootNavigationGeneration: null
      };
      const collectorEnsureStartedAt = Date.now();
      tab = await ensureCollectorWindow(COLLECTOR_TAB_URL, {
          request_id: requestId,
          stage: currentOnly
            ? "context_current_requested"
            : projectOnly ? "context_project_requested" : "context_list_requested"
        });
      await recordCollectorPresentationPhase("collection_start", { request_id: requestId });
      addCollectorProjectDiscoveryEfficiencyDuration(
        pending,
        "collectorRecoveryWaitMs",
        Math.max(0, Date.now() - collectorEnsureStartedAt));
      // Full refreshes enter collectContextWithRecovery with the existing
      // Collector Tab still on whatever page the previous scan used. That
      // orchestration step is the single owner of the root navigation. Do
      // not navigate here as well; doing so both duplicated the transition
      // and made a root return look like Project navigation in telemetry.
      if (currentOnly) {
        tab = await navigateCollectorTab(tab, COLLECTOR_TAB_URL, {
          request_id: requestId,
          stage: "context_current_navigation"
        });
      }
      pending.tabId = tab.id;
      pending.collectorWindowId = collectorWindowState.windowId;
      diagnostic("chatgpt.context request dispatched", {
        request_id: requestId,
        status: "requested",
        stage: currentOnly
          ? "context_current_requested"
          : projectOnly ? "context_project_requested" : "context_list_requested",
        target_tab_id: tab.id,
        collector_window_id: collectorWindowState.windowId,
        collector_tab_id: tab.id
      });
      const contentResult = pending.currentOnly
        ? await dispatchToContentScript(tab.id, {
          type: "GET_CHATGPT_CONTEXT",
          requestId,
          mode: "current",
          collection: "root"
        }, request, {
          timeoutMs: CONTENT_SCRIPT_TIMEOUT_MS,
          timeoutStage: "collector_content_script_timeout"
        })
        : pending.projectOnly
          ? await collectSelectedProjectChatWithRecovery(
            tab,
            pending,
            request,
            pending.selectedProjectTarget)
        : await collectContextWithRecovery(tab, pending, request);
      throwIfCollectorRequestSuperseded(pending);
      await completeContextRequest(contentResult, pending);
    } catch (error) {
      if (!isCurrentCollectorRequest(pending)) {
        if (contextRequests.get(requestId) === pending) contextRequests.delete(requestId);
        diagnostic("chatgpt.context request superseded", {
          request_id: requestId,
          status: "discarded",
          error_code: "context_refresh_superseded",
          stage: "context_request_superseded",
          target_tab_id: pending.tabId
        });
        return;
      }
      const errorCode = error?.code || "context_extraction_failed";
      const errorStage = error?.stage || "context_content_script_dispatch";
      pending.finalErrorCode = errorCode;
      if (!contextRequests.has(requestId)) {
        sendChatGptContextResponseToBridge(
          contextResultError(request, errorCode, "ChatGPT Context収集に失敗しました。", errorStage),
          pending);
      } else {
        await completeContextRequest(
          contextResultError(request, errorCode, "ChatGPT Context収集に失敗しました。", errorStage),
          pending);
      }
    } finally {
      await emitCollectorProjectDiscoveryEfficiencySummary(
        pending,
        pending.projectDiscoveryResult || pending.projectIdentityResult
          || pending.projectDiscoveryScanResult,
        pending.finalErrorCode || null);
      contextRequests.delete(requestId);
      // The Collector Tab is reusable, but a medium-loss recovery can replace
      // its ID while collectContextWithRecovery is running. Release the tab
      // currently owned by the pending request rather than the stale local
      // reference captured before recovery.
      if (Number.isSafeInteger(pending.tabId)) {
        try { tab = await chrome.tabs.get(pending.tabId); } catch (_) { tab = null; }
      }
      if (!tab) tab = await getCollectorTab();
      await releaseCollectorTab(tab);
    }
  });
}

async function handleContextResultFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const pending = contextRequests.get(requestId);
  if (!pending || sender?.tab?.id !== pending.tabId) {
    diagnostic("chatgpt.context response rejected", {
      request_id: requestId,
      status: "error",
      error_code: "context_response_not_correlated",
      stage: "context_response_correlation",
      target_tab_id: sender?.tab?.id
    });
    return;
  }
  // List and selected-Project refreshes are completed by the Collector
  // orchestrator. A mid-scan Content Script result must not publish a
  // shorter catalog as the Refresh outcome.
  if (!pending.currentOnly) {
    diagnostic("chatgpt.context unsolicited result ignored", {
      request_id: requestId,
      refresh_generation: pending.generation,
      source_collector_project_count: Array.isArray(message?.projects)
        ? message.projects.length
        : 0,
      forwarding_source: "unsolicited_content",
      status: "ignored",
      stage: "context_unsolicited_result_ignored",
      target_tab_id: sender?.tab?.id
    });
    return;
  }
  await completeContextRequest(message, pending);
}

async function handleContextChangedFromContent(message, sender) {
  const context = normalizeCurrentContext(message?.context);
  const tabId = sender?.tab?.id;
  if (!context || !Number.isSafeInteger(tabId) || !isChatGptTab(sender?.tab)) {
    diagnostic("chatgpt.context current rejected", {
      status: "error",
      error_code: "invalid_current_context",
      stage: "context_current_validation",
      target_tab_id: tabId
    });
    return false;
  }

  // The conversation is the durable identity; a managed tab is only its
  // current browser medium. When ChatGPT finishes an SPA/new-chat
  // transition, bind the newly discovered conversation to the managed state
  // and to every pending watcher/send on that same managed tab.
  if (tabId === managedTabState.tabId) {
    const conversationId = context.conversation_id || managedTabState.conversationId || null;
    const conversationUrl = context.conversation_id
      ? (context.url || managedTabState.conversationUrl || null)
      : managedTabState.conversationUrl || null;
    managedTabState = {
      ...managedTabState,
      conversationId,
      conversationUrl,
      projectId: context.project_id || managedTabState.projectId || null,
      contentReady: true,
      conversationReady: Boolean(conversationId || conversationUrl),
      composerReady: managedTabState.composerReady || false
    };
    managedTabLifecycle("WaitingWatcher", {
      tabId,
      conversationId,
      conversationUrl,
      projectId: managedTabState.projectId,
      contentReady: true,
      conversationReady: managedTabState.conversationReady
    });
    for (const pending of responseWatches.values()) {
      if (pending.tabId !== tabId) continue;
      if (conversationId) pending.targetConversationId = conversationId;
      if (conversationUrl) pending.targetConversationUrl = conversationUrl;
      if (conversationUrl) pending.targetTabUrl = conversationUrl;
    }
    for (const pending of pendingHandoffSends.values()) {
      if (pending.targetTabId !== tabId) continue;
      if (conversationId) pending.targetConversationId = conversationId;
      if (conversationUrl) pending.targetConversationUrl = conversationUrl;
      if (conversationUrl) pending.targetTabUrl = conversationUrl;
    }
    diagnostic("managed conversation bound", {
      conversation_id: conversationId,
      conversation_url: conversationUrl,
      project_id: managedTabState.projectId,
      status: "bound",
      stage: "conversation_bound",
      target_tab_id: tabId
    });
  }

  if (socket?.readyState !== WebSocket.OPEN) return false;
  const envelope = {
    type: "chatgpt.context.changed",
    context
  };
  try {
    socket.send(JSON.stringify(envelope));
    diagnostic("chatgpt.context current forwarded", {
      status: "ok",
      stage: "context_current_forwarded",
      forwarding_source: "live_current",
      forwarded_project_count: 0,
      forwarded_chat_count: 0,
      target_tab_id: tabId
    });
    return true;
  } catch (_) {
    diagnostic("chatgpt.context current failed", {
      status: "error",
      error_code: "bridge_disconnected",
      stage: "context_current_forwarded",
      target_tab_id: tabId
    });
    return false;
  }
}

function authenticatedBridgeSocket(fallbackSocket = null) {
  // A message received from the Bridge already crossed the authenticated
  // hello handshake.  It is therefore safe to reply on that same current
  // socket even if the local hello.ack bookkeeping has not run yet.  The
  // fallback is important during the very small window between the server's
  // hello.ack and the Extension's onmessage callback; without it a successful
  // ChatGPT post could be put in the outbox forever.
  if (fallbackSocket
    && fallbackSocket === socket
    && fallbackSocket.readyState === WebSocket.OPEN) {
    return fallbackSocket;
  }
  if (acknowledgedSocket
    && socket === acknowledgedSocket
    && acknowledgedSocket.readyState === WebSocket.OPEN) {
    return acknowledgedSocket;
  }
  return null;
}

function bridgeEnvelopeKey(envelope) {
  return `${envelope.type}:${envelope.request_id || ""}`;
}

function bridgeEnvelopeDiagnostic(eventName, envelope, trace = null, fields = {}) {
  diagnostic(eventName, {
    ...traceForMessage(trace),
    request_id: envelope.request_id,
    session_id: envelope.session_id,
    handoff_id: envelope.handoff_id,
    boundary_id: envelope.boundary_id,
    status: envelope.status,
    error_code: envelope.error_code,
    target_tab_id: envelope.target_tab_id,
    ...fields
  });
}

function queueBridgeEnvelope(envelope, trace = null, reason = "bridge_disconnected") {
  const key = bridgeEnvelopeKey(envelope);
  const existing = bridgeOutbox.get(key);
  // Do not retain the original Handoff object (which contains its body) just
  // for a later diagnostic. The envelope is needed for delivery; trace data is
  // reduced to the identifier-only allowlist.
  bridgeOutbox.set(key, {
    envelope,
    trace: trace ? traceForMessage(trace) : existing?.trace || null,
    sentSocket: null,
    createdAt: existing?.createdAt || Date.now()
  });
  bridgeEnvelopeDiagnostic(
    envelope.type === "handoff.result" ? "handoff.result queued" : "assistant response queued",
    envelope,
    trace,
    {
      error_code: reason,
      stage: envelope.type === "handoff.result" ? "handoff_result_queued" : "assistant_response_queued"
    }
  );
}

function flushBridgeOutbox() {
  const bridgeSocket = authenticatedBridgeSocket();
  if (!bridgeSocket) return false;

  let flushed = false;
  for (const [key, pending] of bridgeOutbox) {
    if (authenticatedBridgeSocket() !== bridgeSocket) break;
    if (pending.createdAt + BRIDGE_DELIVERY_TTL_MS <= Date.now()) {
      bridgeOutbox.delete(key);
      continue;
    }
    // The current socket already received this envelope. Wait for its
    // application-level ACK instead of creating a duplicate delivery.
    if (pending.sentSocket === bridgeSocket) continue;
    try {
      bridgeSocket.send(JSON.stringify(pending.envelope));
      pending.sentSocket = bridgeSocket;
      bridgeEnvelopeDiagnostic(
        pending.envelope.type === "handoff.result" ? "handoff.result sent" : "assistant response sent",
        pending.envelope,
        pending.trace,
        { stage: pending.envelope.stage }
      );
      if (pending.envelope.type === "assistant.response") {
        bridgeEnvelopeDiagnostic("assistant response forwarded", pending.envelope, pending.trace, {
          stage: "assistant_response_forwarded"
        });
      }
      flushed = true;
    } catch (_) {
      // Keep the envelope for the next authenticated socket. The close handler
      // schedules reconnect and does not expose body contents in diagnostics.
      break;
    }
  }
  return flushed;
}

function sendBridgeEnvelope(envelope, bridgeSocket, trace = null) {
  const key = bridgeEnvelopeKey(envelope);
  const existing = bridgeOutbox.get(key);
  const pending = existing || {
    envelope,
    trace: trace ? traceForMessage(trace) : null,
    sentSocket: null,
    createdAt: Date.now()
  };
  pending.envelope = envelope;
  if (trace) pending.trace = traceForMessage(trace);
  bridgeOutbox.set(key, pending);

  const targetSocket = authenticatedBridgeSocket(bridgeSocket);
  if (!targetSocket) {
    pending.sentSocket = null;
    queueBridgeEnvelope(envelope, trace);
    return false;
  }

  // A previous synchronous send is still awaiting the Desktop ACK. The
  // caller may be handling a duplicate lifecycle event; do not send it
  // twice on the same authenticated socket.
  if (pending.sentSocket === targetSocket) return true;

  try {
    targetSocket.send(JSON.stringify(envelope));
    pending.sentSocket = targetSocket;
    bridgeEnvelopeDiagnostic(
      envelope.type === "handoff.result" ? "handoff.result sent" : "assistant response sent",
      envelope,
      trace,
      { stage: envelope.stage }
    );
    if (envelope.type === "assistant.response") {
      bridgeEnvelopeDiagnostic("assistant response forwarded", envelope, trace, {
        stage: "assistant_response_forwarded"
      });
    }
    return true;
  } catch (_) {
    pending.sentSocket = null;
    queueBridgeEnvelope(envelope, trace, "bridge_send_failed");
    if (envelope.type === "assistant.response") {
      bridgeEnvelopeDiagnostic("assistant response delivery failed", envelope, trace, {
        status: "error",
        error_code: "bridge_disconnected",
        stage: "response_bridge_send"
      });
    }
    return false;
  }
}

function sendHandoffResultToBridge(result, bridgeSocket, trace = null) {
  return sendBridgeEnvelope(result, bridgeSocket, trace);
}

function sendAssistantResponseToBridge(response, bridgeSocket) {
  const envelope = {
    type: "assistant.response",
    request_id: response.request_id,
    session_id: response.session_id,
    handoff_id: response.handoff_id,
    boundary_id: response.boundary_id,
    status: response.status
  };
  if (response.status === "received" && typeof response.payload === "string") envelope.payload = response.payload;
  if (response.error_code) envelope.error_code = response.error_code;
  if (response.message) envelope.message = response.message;
  if (response.stage) envelope.stage = response.stage;
  if (typeof response.timeout_kind === "string"
    && response.timeout_kind.length <= 64
    && response.timeout_kind !== "none") {
    envelope.timeout_kind = response.timeout_kind;
  }
  if (Number.isSafeInteger(response.target_tab_id)) envelope.target_tab_id = response.target_tab_id;
  if (typeof response.target_tab_url === "string" && response.target_tab_url.length <= 2048) envelope.target_tab_url = response.target_tab_url;
  if (typeof response.target_conversation_id === "string" && response.target_conversation_id.length <= 128) {
    envelope.target_conversation_id = response.target_conversation_id;
  }
  if (typeof response.target_conversation_url === "string" && response.target_conversation_url.length <= 2048) {
    envelope.target_conversation_url = response.target_conversation_url;
  }
  return sendBridgeEnvelope(envelope, bridgeSocket);
}

function responseWatchMessageForPending(pending) {
  return {
    type: RESPONSE_WATCH_MESSAGE_TYPE,
    requestId: pending.requestId,
    sessionId: pending.sessionId,
    handoffId: pending.handoffId,
    boundaryId: pending.boundaryId,
    protocol: HANDOFF_PROTOCOL,
    targetTabId: pending.targetTabId,
    ...(pending.targetConversationId ? { targetConversationId: pending.targetConversationId } : {}),
    ...(pending.targetConversationUrl ? { targetConversationUrl: pending.targetConversationUrl } : {}),
    ...(pending.isReview ? { review: true } : {}),
    ...(pending.preSend ? { prepare: true } : {}),
    ...(typeof pending.tabActive === "boolean" ? { tabActive: pending.tabActive } : {}),
    ...(typeof pending.windowFocused === "boolean" ? { windowFocused: pending.windowFocused } : {})
  };
}

function responseWatchTraceForPending(pending, fields = {}) {
  return {
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    target_tab_id: pending.targetTabId,
    ...fields
  };
}

function stopResponseWatchLifecycleTelemetry(pending) {
  if (!pending || pending.lifecycleTelemetryTimer === null) return;
  clearTimeout(pending.lifecycleTelemetryTimer);
  pending.lifecycleTelemetryTimer = null;
}

function scheduleResponseWatchLifecycleTelemetry(pending) {
  if (!pending || pending.lifecycleTelemetryTimer !== null) return;
  pending.lifecycleTelemetryTimer = setTimeout(() => {
    pending.lifecycleTelemetryTimer = null;
    if (responseWatches.get(pending.requestId) !== pending) return;
    recordManagedTabLifecycleTelemetry(
      "response_waiting_periodic",
      responseWatchTraceForPending(pending, {
        status: "waiting",
        watcher_state: pending.watcherReady ? "armed" : "requested"
      }),
      pending.tabId);
    scheduleResponseWatchLifecycleTelemetry(pending);
  }, MANAGED_TAB_LIFECYCLE_TELEMETRY_INTERVAL_MS);
  // Node-based regression tests should not be held open by an observational
  // timer. Chrome timers do not expose unref(), so production behavior is
  // unchanged.
  pending.lifecycleTelemetryTimer?.unref?.();
}

function scheduleResponseWatchRearm(pending) {
  if (!pending || pending.rearmTimer !== null || pending.rearmDeadline <= Date.now()) return;
  pending.rearmTimer = setTimeout(() => {
    pending.rearmTimer = null;
    if (responseWatches.get(pending.requestId) !== pending) return;
    void rearmResponseWatchesForTab(pending.tabId);
  }, RESPONSE_WATCH_REARM_DELAY_MS);
}

function timeoutKindForWatchError(errorCode, stage) {
  if (errorCode === "tab_closed" || stage === "assistant_response_tab_closed") return "tab_closed";
  if (errorCode === "content_script_unavailable") return "content_script_lost";
  if (stage === "assistant_response_aborted") return "explicit_abort";
  return "none";
}

function failResponseWatch(pending, errorCode, stage, message = "ChatGPTのassistant応答監視を開始できませんでした。") {
  if (responseWatches.get(pending.requestId) !== pending) return;
  if (pending.rearmTimer !== null) {
    clearTimeout(pending.rearmTimer);
    pending.rearmTimer = null;
  }
  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(pending.requestId);
  const timeoutKind = timeoutKindForWatchError(errorCode, stage);
  diagnostic("assistant response watch failed", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage,
    timeout_kind: timeoutKind
  }));
  diagnostic("assistant response watch failure summary", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage: "assistant_response_watch_failure_summary",
    timeout_kind: timeoutKind,
    timeout_triggered: timeoutKind !== "none" && timeoutKind !== "explicit_abort",
    content_script_alive: errorCode !== "content_script_unavailable",
    final_status: "error"
  }));
  recordManagedTabLifecycleTelemetry("response_watch_failed", responseWatchTraceForPending(pending, {
    status: "error",
    error_code: errorCode,
    stage,
    assistant_state: errorCode === "response_stream_interrupted" ? "interrupted" : "not_detected",
    watcher_state: "idle",
    timeout_kind: timeoutKind
  }), pending.tabId);
  sendAssistantResponseToBridge({
    request_id: pending.requestId,
    session_id: pending.sessionId,
    handoff_id: pending.handoffId,
    boundary_id: pending.boundaryId,
    status: "error",
    error_code: errorCode,
    message,
    stage,
    timeout_kind: timeoutKind,
    ...(pending.isReview ? {
      target_tab_id: pending.targetTabId,
      target_tab_url: pending.targetTabUrl
    } : {})
  }, pending.bridgeSocket);
}

function failResponseWatchesForClosedTab(tabId) {
  if (!Number.isSafeInteger(tabId)) return;
  for (const pending of [...responseWatches.values()]) {
    if (pending.tabId === tabId || pending.targetTabId === tabId) {
      failResponseWatch(
        pending,
        "tab_closed",
        "assistant_response_tab_closed",
        "監視中のChatGPTタブが閉じられました。");
    }
  }
}

async function rearmResponseWatchesForTab(tabId) {
  if (!Number.isSafeInteger(tabId) || tabId < 0) return;
  const pendingWatches = [...responseWatches.values()]
    .filter((pending) => pending.tabId === tabId && !pending.watchDispatching && !pending.rearmInProgress);
  if (pendingWatches.length > 0) {
    diagnostic("content script ready with pending response watch", {
      target_tab_id: tabId,
      status: "pending",
      stage: "response_watch_rearm_scan"
    });
  }
  for (const pending of pendingWatches) {
    if (responseWatches.get(pending.requestId) !== pending) continue;
    if (pending.rearmDeadline <= Date.now()) {
      failResponseWatch(pending, "content_script_unavailable", "response_watch_rearm_timeout");
      continue;
    }

    pending.rearmInProgress = true;
    diagnostic(
      pending.isReview ? "review response watch rearm requested" : "response watch rearm requested",
      responseWatchTraceForPending(pending, {
        status: "requested",
        stage: "response_watch_rearm_requested"
      })
    );
    try {
      const watchResult = await dispatchToContentScript(
        tabId,
        responseWatchMessageForPending(pending),
        pending);
      const valid = watchResult
        && watchResult.request_id === pending.requestId
        && watchResult.session_id === pending.sessionId
        && watchResult.handoff_id === pending.handoffId
        && watchResult.boundary_id === pending.boundaryId
        && watchResult.status === "watching";
      if (valid) {
        if (pending.rearmTimer !== null) {
          clearTimeout(pending.rearmTimer);
          pending.rearmTimer = null;
        }
        diagnostic("response watch rearmed", responseWatchTraceForPending(pending, {
          status: "watching",
          stage: "response_watch_rearmed"
        }));
        recordManagedTabLifecycleTelemetry("response_watch_rearmed", responseWatchTraceForPending(pending, {
          status: "watching",
          stage: "response_watch_rearmed",
          watcher_state: "armed"
        }), pending.tabId);
      } else {
        const errorCode = watchResult?.error_code || "content_script_unavailable";
        const stage = watchResult?.stage || "response_watch_rearm_result_invalid";
        diagnostic("response watch rearm deferred", responseWatchTraceForPending(pending, {
          status: "pending",
          error_code: errorCode,
          stage
        }));
        scheduleResponseWatchRearm(pending);
      }
    } catch (error) {
      const errorCode = error?.code || (isMissingContentScriptError(error) ? "content_script_unavailable" : "response_watch_dispatch_failed");
      const stage = error?.stage || "response_watch_rearm_dispatch";
      diagnostic("response watch rearm deferred", responseWatchTraceForPending(pending, {
        status: "pending",
        error_code: errorCode,
        stage
      }));
      scheduleResponseWatchRearm(pending);
    } finally {
      pending.rearmInProgress = false;
    }
  }
}

let managedMediumRecoveryOperation = null;

function scheduleManagedMediumRecovery(removedTabId = null, removedWindowId = null, reason = "managed_tab_removed") {
  if (managedMediumRecoveryOperation) {
    diagnostic("managed execution recovery duplicate suppressed", {
      target_tab_id: removedTabId,
      event_window_id: removedWindowId,
      status: "pending",
      stage: "managed_execution_recovery_duplicate_suppressed"
    });
    return managedMediumRecoveryOperation;
  }
  const operation = recoverManagedTabAfterRemoval(removedTabId, removedWindowId, reason);
  managedMediumRecoveryOperation = operation;
  void operation.finally(() => {
    if (managedMediumRecoveryOperation === operation) managedMediumRecoveryOperation = null;
  }).catch(() => {});
  return operation;
}

async function recoverManagedTabAfterRemoval(removedTabId = null, removedWindowId = null, reason = "managed_tab_removed") {
  await managedTabStateReady;
  const resolution = managedExecutionResolutionFor(
    managedTabState.currentRequestId,
    managedTabState.currentHandoffId);
  resolution.recoveryAttemptCount += 1;
  if (managedExecutionWindowEnsureInFlight || managedExecutionTabEnsureInFlight) {
    resolution.recoveryJoinedInflightCount += 1;
    diagnostic("managed execution recovery joined inflight", {
      target_tab_id: removedTabId,
      event_window_id: removedWindowId,
      status: "pending",
      stage: "managed_execution_recovery_joined_inflight"
    });
    try {
      await (managedExecutionTabEnsureInFlight || managedExecutionWindowEnsureInFlight);
    } catch (_) { }
    return;
  }
  const previousTabId = managedTabState.tabId;
  const previousExecutionWindowId = managedTabState.executionWindowId;
  const executionWindowRemoved = reason === "execution_window_removed";
  const affectedTabIds = new Set(
    [removedTabId, previousTabId].filter((value) => Number.isSafeInteger(value) && value >= 0));
  const pendingWatches = [...responseWatches.values()]
    .filter((pending) => affectedTabIds.has(pending.tabId)
      || affectedTabIds.has(pending.targetTabId));
  const pendingSends = [...pendingHandoffSends.values()]
    .filter((pending) => affectedTabIds.has(pending.targetTabId));
  const recoverySource = pendingWatches[0] || pendingSends[0];
  const conversationId = recoverySource?.targetConversationId || managedTabState.conversationId;
  const conversationUrl = recoverySource?.targetConversationUrl
    || managedTabState.conversationUrl
    || (recoverySource?.targetTabUrl && chatGptConversationId(recoverySource.targetTabUrl)
      ? recoverySource.targetTabUrl
      : null);

  for (const pending of pendingWatches) {
    const live = await liveManagedExecutionBinding(pending.requestId);
    if (live && live.tab.id !== removedTabId) continue;
    pending.tabId = null;
    pending.targetTabId = null;
  }
  for (const pending of pendingSends) {
    const live = await liveManagedExecutionBinding(pending.requestId);
    if (live && live.tab.id !== removedTabId) continue;
    pending.targetTabId = null;
  }

  if (executionWindowRemoved
    && Number.isSafeInteger(previousExecutionWindowId)
    && previousExecutionWindowId >= 0) {
    managedTabLifecycle("PreparingTab", {
      tabId: null,
      executionWindowId: null,
      executionWindowState: "Idle",
      contentReady: false,
      conversationReady: false,
      composerReady: false,
      watcherReady: false
    });
  } else if (managedTabState.tabId === removedTabId) {
    clearManagedTabState("PreparingTab");
  }

  if (executionWindowRemoved) {
    managedExecutionRequestBindings.clear();
    diagnostic("managed execution recovery skipped after window removal", {
      target_tab_id: removedTabId,
      event_window_id: removedWindowId,
      status: "pending",
      stage: "managed_execution_recovery_window_cleared"
    });
    return;
  }

  if (!conversationId && !conversationUrl) {
    diagnostic("managed tab recovery deferred", {
      status: "pending",
      error_code: "target_conversation_not_found",
      stage: "managed_tab_recovery_identity_missing",
      target_tab_id: removedTabId,
      event_window_id: removedWindowId
    });
    return;
  }

  const source = recoverySource || {};
  const recoveryMessage = {
    request_id: source.requestId || managedTabState.currentRequestId || "managed-tab-recovery",
    session_id: source.sessionId || managedTabState.currentSessionId || "managed-tab-recovery",
    handoff_id: source.handoffId || managedTabState.currentHandoffId || "managed-tab-recovery",
    boundary_id: source.boundaryId || managedTabState.currentBoundaryId || "managed-tab-recovery",
    handoff_kind: source.handoffKind || (source.isReview ? "review" : "bootstrap"),
    target_conversation_id: conversationId,
    target_conversation_url: conversationUrl,
    target_project_id: source.targetProjectId || managedTabState.projectId || null,
    new_conversation: false
  };

  diagnostic("managed tab recovery requested", {
    ...traceForMessage(recoveryMessage, { target_tab_id: removedTabId }),
    conversation_id: conversationId,
    conversation_url: conversationUrl,
    event_window_id: removedWindowId,
    status: "requested",
    stage: "managed_tab_recovery_requested"
  });
  try {
    await withManagedTabOperation(async () => {
      const prepared = await ensureManagedExecutionTab(
        recoveryMessage,
        traceForMessage(recoveryMessage));
      const newTabId = prepared.tab.id;
      const currentContext = prepared.currentContext;
      const newConversationId = currentContext?.conversation_id || conversationId || null;
      const newConversationUrl = currentContext?.url || conversationUrl || null;
      for (const pending of pendingWatches) {
        pending.tabId = newTabId;
        pending.targetTabId = newTabId;
        if (newConversationId) pending.targetConversationId = newConversationId;
        if (newConversationUrl) {
          pending.targetConversationUrl = newConversationUrl;
          pending.targetTabUrl = newConversationUrl;
        }
      }
      for (const pending of pendingSends) {
        pending.targetTabId = newTabId;
        if (newConversationId) pending.targetConversationId = newConversationId;
        if (newConversationUrl) {
          pending.targetConversationUrl = newConversationUrl;
          pending.targetTabUrl = newConversationUrl;
        }
      }
      managedTabLifecycle("WaitingWatcher", {
        tabId: newTabId,
        conversationId: newConversationId,
        conversationUrl: newConversationUrl,
        contentReady: true,
        conversationReady: true,
        composerReady: prepared.readyResult?.composer_ready !== false,
        watcherReady: false
      });
      diagnostic("managed tab recovered", {
        ...traceForMessage(recoveryMessage, { target_tab_id: newTabId }),
        conversation_id: newConversationId,
        conversation_url: newConversationUrl,
        execution_window_id: managedTabState.executionWindowId,
        execution_window_state: managedTabState.executionWindowState,
        status: "ready",
        stage: "managed_tab_recovered"
      });
      await recoverPendingHandoffSendsForTab(newTabId);
      await rearmResponseWatchesForTab(newTabId);
    });
  } catch (error) {
    diagnostic("managed tab recovery failed", {
      ...traceForMessage(recoveryMessage, { target_tab_id: removedTabId }),
      event_window_id: removedWindowId,
      status: "error",
      error_code: error?.code || "managed_tab_recovery_failed",
      stage: error?.stage || "managed_tab_recovery"
    });
    for (const pending of pendingWatches) {
      pending.tabId = null;
      pending.targetTabId = null;
    }
    for (const pending of pendingSends) pending.targetTabId = null;
  }
}

function acknowledgeBridgeEnvelope(message, bridgeSocket) {
  if (authenticatedBridgeSocket(bridgeSocket) !== bridgeSocket) return;
  const deliveryType = message?.delivery_type;
  const requestId = message?.request_id;
  if (deliveryType !== "handoff.result" && deliveryType !== "assistant.response") return;
  if (typeof requestId !== "string" || requestId.length === 0) return;

  const key = `${deliveryType}:${requestId}`;
  const pending = bridgeOutbox.get(key);
  if (!pending) return;
  if (message?.handoff_id && pending.envelope.handoff_id !== message.handoff_id) return;
  bridgeOutbox.delete(key);
  bridgeEnvelopeDiagnostic(
    deliveryType === "handoff.result" ? "handoff.result acknowledged" : "assistant response acknowledged",
    pending.envelope,
    pending.trace,
    { stage: "bridge_delivery_acknowledged" }
  );
}

function reviewMediaResult(message, status, errorCode, text, stage) {
  const result = {
    type: "review.media.result",
    request_id: message?.request_id || "",
    session_id: message?.session_id || "",
    iteration: message?.iteration,
    media_id: message?.media_id || "",
    status
  };
  if (errorCode) result.error_code = errorCode;
  if (text) result.message = text;
  if (stage) result.stage = stage;
  return result;
}

function sendReviewMediaResultToBridge(result, bridgeSocket) {
  if (bridgeSocket.readyState !== WebSocket.OPEN || socket !== bridgeSocket) {
    diagnostic("review.media.result dropped", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: result.status,
      error_code: result.error_code || "bridge_disconnected",
      stage: result.stage || "bridge_disconnected"
    });
    return false;
  }
  try {
    bridgeSocket.send(JSON.stringify(result));
    diagnostic("review.media.result sent", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: result.status,
      error_code: result.error_code,
      stage: result.stage
    });
    return true;
  } catch (_) {
    diagnostic("review.media.result delivery failed", {
      request_id: result.request_id,
      media_id: result.media_id,
      status: "error",
      error_code: "bridge_disconnected",
      stage: "media_bridge_send"
    });
    return false;
  }
}

function isValidReviewMediaMessage(message) {
  const hasTargetTabId = message?.target_tab_id !== undefined && message?.target_tab_id !== null;
  const hasTargetTabUrl = message?.target_tab_url !== undefined && message?.target_tab_url !== null;
  const targetConversationId = message?.target_conversation_id === undefined || message?.target_conversation_id === null
    ? null
    : safeContextIdentifier(message.target_conversation_id);
  const targetConversationUrl = message?.target_conversation_url === undefined || message?.target_conversation_url === null
    ? null
    : safeChatGptContextUrl(message.target_conversation_url);
  const targetConversationUrlId = targetConversationUrl ? chatGptConversationId(targetConversationUrl) : null;
  return typeof message?.request_id === "string"
    && message.request_id.length > 0
    && typeof message?.session_id === "string"
    && message.session_id.length > 0
    && typeof message?.media_id === "string"
    && message.media_id.length > 0
    && Number.isSafeInteger(message?.iteration)
    && message.iteration > 0
    && typeof message?.filename === "string"
    && message.filename.length > 0
    && message.filename.length <= 255
    && !/[\\/\r\n"\u0000]/.test(message.filename)
    && typeof message?.mime_type === "string"
    && ["video/mp4", "image/png", "image/jpeg", "image/webp"].includes(message.mime_type.toLowerCase())
    && Number.isSafeInteger(message?.size)
    && message.size > 0
    && message.size <= MAX_REVIEW_MEDIA_BYTES
    && (!hasTargetTabId || (Number.isSafeInteger(message.target_tab_id) && message.target_tab_id >= 0))
    && (!hasTargetTabUrl || (typeof message.target_tab_url === "string"
      && message.target_tab_url.length > 0
      && message.target_tab_url.length <= 2048
      && safeChatGptContextUrl(message.target_tab_url) !== null))
    && (message?.target_conversation_id === undefined
      || message?.target_conversation_id === null
      || targetConversationId !== null)
    && (message?.target_conversation_url === undefined
      || message?.target_conversation_url === null
      || targetConversationUrl !== null)
    && (!targetConversationId || !targetConversationUrl || targetConversationUrlId === targetConversationId);
}

function chatGptProjectId(value) {
  try {
    const url = new URL(value || "");
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com" || url.port !== "") return null;
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => {
      try { return decodeURIComponent(segment); } catch (_) { return segment; }
    });
    for (let index = 0; index < segments.length - 1; index += 1) {
      if (segments[index].toLowerCase() !== "g") continue;
      const projectId = stableChatGptProjectId(segments[index + 1]);
      if (projectId) return projectId;
    }
  } catch (_) { }
  return null;
}

function stableChatGptProjectId(value) {
  const id = safeContextIdentifier(value);
  if (!id || !id.toLowerCase().startsWith("g-p-")) return null;
  const rest = id.slice(4);
  const separator = rest.indexOf("-");
  if (separator <= 0) return id;
  const token = rest.slice(0, separator);
  if (!/^[0-9a-f]+$/i.test(token)) return id;
  return id.slice(0, 4 + separator);
}

function safeChatGptProjectUrl(value) {
  const canonical = safeChatGptContextUrl(value);
  if (!canonical || chatGptProjectId(canonical) === null) return null;
  try {
    const url = new URL(canonical);
    const segments = url.pathname.split("/").filter(Boolean);
    return segments.at(-1)?.toLowerCase() === "project" ? canonical : null;
  } catch (_) {
    return null;
  }
}

function isCollectorRootUrl(value) {
  return safeChatGptContextUrl(value) === safeChatGptContextUrl(COLLECTOR_TAB_URL);
}

function conversationTargetFromMessage(message) {
  const hasConversationId = message?.target_conversation_id !== undefined
    && message?.target_conversation_id !== null;
  const hasConversationUrl = message?.target_conversation_url !== undefined
    && message?.target_conversation_url !== null;
  const conversationId = safeContextIdentifier(message?.target_conversation_id);
  const conversationUrl = safeChatGptContextUrl(message?.target_conversation_url);
  if ((hasConversationId && !conversationId) || (hasConversationUrl && !conversationUrl)) {
    return { errorCode: "target_conversation_invalid", errorStage: "target_conversation_check" };
  }
  if (conversationId && conversationUrl && chatGptConversationId(conversationUrl) !== conversationId) {
    return { errorCode: "target_conversation_invalid", errorStage: "target_conversation_check" };
  }
  return { conversationId, conversationUrl };
}

function managedConversationTarget(message, identity) {
  const targetTabUrl = safeChatGptContextUrl(message?.target_tab_url);
  const managedConversationId = safeContextIdentifier(managedTabState.conversationId);
  const managedConversationUrl = safeChatGptContextUrl(managedTabState.conversationUrl);

  if (message?.new_conversation === true) {
    return {
      newConversation: true,
      conversationId: null,
      conversationUrl: null,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
        || (safeChatGptContextUrl(message?.target_project_url) === "https://chatgpt.com/"
          ? "https://chatgpt.com/"
          : null)
        || "https://chatgpt.com/"
    };
  }

  if (identity?.conversationId || identity?.conversationUrl) {
    return {
      newConversation: false,
      conversationId: identity.conversationId,
      conversationUrl: identity.conversationUrl,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // Older Desktop snapshots carry the bound conversation as target_tab_url.
  // Treat its conversation identity as data, never as permission to operate
  // that foreground tab.
  const legacyConversationId = chatGptConversationId(targetTabUrl);
  if (legacyConversationId) {
    return {
      newConversation: false,
      conversationId: legacyConversationId,
      conversationUrl: targetTabUrl,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // Review/media/resume messages normally include the bound conversation.
  // If an old persisted message does not, the managed tab is the only safe
  // recovery source. The user's active tab is deliberately never consulted.
  if ((message?.handoff_kind === "review" || message?.type === "review.media.attach")
    && (managedConversationId || managedConversationUrl)) {
    return {
      newConversation: false,
      conversationId: managedConversationId,
      conversationUrl: managedConversationUrl,
      projectId: managedTabState.projectId,
      projectUrl: managedTabState.projectUrl
    };
  }

  // A review/media operation without a bound conversation must not guess from
  // the foreground tab or silently create a different conversation.
  if (message?.handoff_kind === "review" || message?.type === "review.media.attach") {
    return {
      newConversation: false,
      conversationId: null,
      conversationUrl: null,
      projectId: safeContextIdentifier(message?.target_project_id),
      projectUrl: safeChatGptProjectUrl(message?.target_project_url)
    };
  }

  // A legacy unbound bootstrap is treated as a new managed conversation. It
  // is safer to create an isolated ChatGPT conversation than to borrow the
  // conversation the user happens to be viewing.
  return {
    newConversation: true,
    conversationId: null,
    conversationUrl: null,
    projectId: safeContextIdentifier(message?.target_project_id),
    projectUrl: safeChatGptProjectUrl(message?.target_project_url)
      || (safeChatGptContextUrl(message?.target_project_url) === "https://chatgpt.com/"
        ? "https://chatgpt.com/"
        : null)
      || "https://chatgpt.com/"
  };
}

function managedTabMatchesTarget(tab, target) {
  if (!tab || !isChatGptTab(tab)) return false;
  if (!target?.newConversation) {
    return isSameChatGptConversation(tab.url, target.conversationUrl, target.conversationId);
  }
  return chatGptConversationId(tab.url) === null
    && (!target.projectUrl || safeChatGptContextUrl(tab.url) === target.projectUrl);
}

function executionWindowState(window) {
  return typeof window?.state === "string" && window.state.length > 0
    ? window.state
    : "normal";
}

async function getManagedExecutionWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || windowId < 0 || typeof chrome.windows?.get !== "function") return null;
  try {
    return await chrome.windows.get(windowId);
  } catch (_) {
    return null;
  }
}

async function tabsInManagedExecutionWindow(windowId) {
  if (!Number.isSafeInteger(windowId) || typeof chrome.tabs?.query !== "function") return [];
  try {
    const tabs = await chrome.tabs.query({ windowId });
    return Array.isArray(tabs) ? tabs : [];
  } catch (_) {
    return [];
  }
}

async function rememberedExecutionWindowTabs(windowId) {
  const remembered = [];
  const ids = managedExecutionWindowInitialTabs.get(windowId) || [];
  if (typeof chrome.tabs?.get !== "function") return remembered;
  for (const tabId of ids) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab && tab.windowId === windowId) remembered.push(tab);
    } catch (_) { }
  }
  return remembered;
}

async function physicalTabsInExecutionWindow(windowId, extraTabs = []) {
  const queried = await tabsInManagedExecutionWindow(windowId);
  const byId = new Map();
  for (const tab of [...extraTabs, ...queried, ...await rememberedExecutionWindowTabs(windowId)]) {
    if (Number.isSafeInteger(tab?.id) && tab.id >= 0) byId.set(tab.id, tab);
  }
  return [...byId.values()];
}

function executionTabNeedsDestination(tab, destination) {
  if (!tab || !isChatGptTab(tab)) return true;
  const actual = tab.url || tab.pendingUrl;
  const conversationId = chatGptConversationId(destination);
  if (conversationId) return !isSameChatGptConversation(actual, destination, conversationId);
  const actualKey = chatGptConversationKey(actual);
  const expectedKey = chatGptConversationKey(destination);
  return actualKey === null || expectedKey === null || actualKey !== expectedKey;
}

async function findManagedExecutionWindowTab(windowId, extraTabs = []) {
  if (Number.isSafeInteger(managedTabState.tabId)
    && managedTabState.tabId >= 0
    && managedTabState.tabId !== collectorWindowState.tabId
    && typeof chrome.tabs?.get === "function") {
    try {
      const bound = await chrome.tabs.get(managedTabState.tabId);
      if (bound && bound.windowId === windowId && !isCollectorReservedTab(bound)) return bound;
    } catch (_) { }
  }
  const tabs = (await physicalTabsInExecutionWindow(windowId, extraTabs))
    .filter((tab) => !isCollectorReservedTab(tab));
  const owned = tabs.filter((tab) => isOwnedManagedExecutionTab(tab));
  if (owned.length === 1) return owned[0];
  if (owned.length > 1) {
    throw managedTabError(
      "ambiguous_managed_execution_tabs",
      "managed_tab_lookup",
      "Managed Execution Tabの候補が複数あり、一意に特定できません。");
  }
  const createdInitial = tabs.filter((tab) => managedExecutionCreatedInitialTabIds.has(tab.id)
    && connectorManagedWindowInitialTabRole === "execution");
  if (createdInitial.length === 1) return createdInitial[0];
  if (createdInitial.length > 1) {
    const createdChatGpt = createdInitial.filter((tab) => isChatGptTab(tab));
    if (createdChatGpt.length === 1) return createdChatGpt[0];
    throw managedTabError(
      "ambiguous_managed_execution_tabs",
      "managed_tab_lookup",
      "Managed Execution Tabの候補が複数あり、一意に特定できません。");
  }
  if (tabs.length === 1
    && managedExecutionOwnedWindowIds.has(windowId)
    && connectorManagedWindowInitialTabRole === "execution"
    && (isPlaceholderExecutionTab(tabs[0]) || isOwnedManagedExecutionTab(tabs[0]))) {
    return tabs[0];
  }
  const chatgpt = tabs.filter((tab) => isChatGptTab(tab));
  if (chatgpt.length > 1) {
    throw managedTabError(
      "ambiguous_managed_execution_tabs",
      "managed_tab_lookup",
      "Managed Execution Tabの候補が複数あり、一意に特定できません。");
  }
  return null;
}

async function closeProvenCreatedInitialPlaceholder(windowId, keepTabId, resolution) {
  if (!Number.isSafeInteger(windowId) || typeof chrome.tabs?.remove !== "function") return;
  const tabs = await physicalTabsInExecutionWindow(windowId);
  const leftover = tabs.filter((tab) => tab.id !== keepTabId
    && tab.id !== collectorWindowState.tabId
    && managedExecutionCreatedInitialTabIds.has(tab.id)
    && isPlaceholderExecutionTab(tab)
    && !isChatGptTab(tab)
    && !isCollectorReservedTab(tab));
  if (leftover.length !== 1) return;
  try {
    await chrome.tabs.remove(leftover[0].id);
    forgetManagedExecutionTabId(leftover[0].id);
    if (resolution) resolution.initialWindowTabClosed = true;
    diagnostic("initial execution tab closed", {
      execution_window_id: windowId,
      event_tab_id: leftover[0].id,
      target_tab_id: keepTabId,
      status: "closed",
      stage: "initial_tab_closed"
    });
  } catch (_) { }
}

async function makeManagedExecutionWindowUsable(window, trace = {}) {
  if (!window || !Number.isSafeInteger(window.id)) return null;
  let usable = window;
  const windowChanges = {};
  if (executionWindowState(window) === "minimized") windowChanges.state = "normal";
  if (window.focused === true) windowChanges.focused = false;
  if (Object.keys(windowChanges).length > 0 && typeof chrome.windows?.update === "function") {
    try {
      usable = await chrome.windows.update(window.id, windowChanges) || {
        ...window,
        ...windowChanges
      };
      diagnostic("managed execution window restored", {
        ...trace,
        execution_window_id: window.id,
        execution_window_focused: usable.focused,
        execution_window_state: executionWindowState(usable),
        status: "restored",
        stage: "execution_window_restored"
      });
    } catch (error) {
      diagnostic("managed execution window restore failed", {
        ...trace,
        execution_window_id: window.id,
        error_code: error?.code || "execution_window_restore_failed",
        status: "error",
        stage: "execution_window_restore"
      });
    }
  }
  managedTabState = {
    ...managedTabState,
    executionWindowId: window.id,
    executionWindowState: executionWindowState(usable)
  };
  return usable;
}

async function managedExecutionWindowCreateData(url) {
  let referenceWindow = null;
  if (typeof chrome.windows?.getLastFocused === "function") {
    try {
      referenceWindow = await chrome.windows.getLastFocused({ populate: false });
    } catch (_) {
      referenceWindow = null;
    }
  }
  const referenceWidth = Number.isSafeInteger(referenceWindow?.width) && referenceWindow.width > 0
    ? referenceWindow.width
    : MANAGED_EXECUTION_WINDOW_FALLBACK_WIDTH;
  const referenceHeight = Number.isSafeInteger(referenceWindow?.height) && referenceWindow.height > 0
    ? referenceWindow.height
    : MANAGED_EXECUTION_WINDOW_FALLBACK_HEIGHT;
  return {
    url,
    focused: false,
    state: "normal",
    type: "normal",
    width: Math.max(
      MANAGED_EXECUTION_WINDOW_MIN_WIDTH,
      Math.floor(referenceWidth * MANAGED_EXECUTION_WINDOW_SIZE_FACTOR)),
    height: Math.max(
      MANAGED_EXECUTION_WINDOW_MIN_HEIGHT,
      Math.floor(referenceHeight * MANAGED_EXECUTION_WINDOW_SIZE_FACTOR))
  };
}

async function adoptCreatedManagedExecutionWindow(created, trace, resolution) {
  const existingWindowId = managedTabState.executionWindowId;
  if (Number.isSafeInteger(existingWindowId)
    && existingWindowId >= 0
    && existingWindowId !== created.id) {
    const existing = await getManagedExecutionWindow(existingWindowId);
    if (existing) {
      resolution.duplicateCreationPreventedCount += 1;
      managedExecutionOwnedWindowIds.delete(created.id);
      if (typeof chrome.windows?.remove === "function") {
        try { await chrome.windows.remove(created.id); } catch (_) { }
      }
      diagnostic("managed execution duplicate window closed", {
        ...trace,
        execution_window_id: existingWindowId,
        event_window_id: created.id,
        status: "suppressed",
        error_code: "duplicate_execution_window_prevented",
        stage: "execution_window_duplicate_prevented"
      });
      resolution.executionWindowReusedCount += 1;
      return makeManagedExecutionWindowUsable(existing, trace);
    }
  }
  managedExecutionOwnedWindowIds.add(created.id);
  managedExecutionGeneration += 1;
  managedTabState = {
    ...managedTabState,
    executionGeneration: managedExecutionGeneration
  };
  const createResultTabs = Array.isArray(created.tabs) ? created.tabs : [];
  rememberCreatedExecutionWindowTabs(created.id, createResultTabs);
  const physicalTabs = await physicalTabsInExecutionWindow(created.id, createResultTabs);
  rememberCreatedExecutionWindowTabs(created.id, physicalTabs);
  resolution.executionWindowPhysicalTabCountAtCreation = physicalTabs.length;
  resolution.initialWindowTabFound = physicalTabs.length >= 1;
  const uniquePhysical = physicalTabs.length === 1 ? physicalTabs[0] : null;
  const uniqueCreatedChatGpt = physicalTabs.filter((tab) => isChatGptTab(tab));
  const initialTab = uniquePhysical
    || (uniqueCreatedChatGpt.length === 1 ? uniqueCreatedChatGpt[0] : null);
  if (initialTab && Number.isSafeInteger(initialTab.id)) {
    stampManagedExecutionTab(initialTab, created.id);
    diagnostic("initial execution tab detected", {
      ...trace,
      execution_window_id: created.id,
      target_tab_id: initialTab.id,
      execution_generation: managedExecutionGeneration,
      status: "observed",
      stage: "initial_tab_detected"
    });
  }
  const usable = await makeManagedExecutionWindowUsable({
    ...created,
    state: executionWindowState(created),
    focused: created.focused === true
  }, trace);
  diagnostic("managed execution window created", {
    ...trace,
    execution_window_id: usable.id,
    execution_window_focused: usable.focused,
    execution_window_state: executionWindowState(usable),
    execution_generation: managedExecutionGeneration,
    status: "created",
    stage: "execution_window_created"
  });
  recordManagedTabLifecycleTelemetry("execution_window_created", {
    ...trace,
    execution_window_id: usable.id,
    execution_window_focused: usable.focused,
    execution_window_state: executionWindowState(usable),
    execution_window_exists: true,
    execution_generation: managedExecutionGeneration,
    status: "created",
    stage: "execution_window_created"
  }, null, null, usable.id);
  resolution.executionWindowCreatedCount += 1;
  resolution.ensureNewCreationCount += 1;
  return usable;
}

async function ensureManagedExecutionWindowUnlocked(url, trace, resolution) {
  await managedTabStateReady;
  await hydrateCollectorWindowState();
  const ensured = await ensureConnectorManagedWindow(url, trace, { role: "execution" });
  const window = ensured.window;
  bindConnectorManagedWindowId(window.id);
  if (ensured.created === true && connectorManagedWindowInitialTabRole === "execution") {
    resolution.ensureNewCreationCount += 1;
  } else {
    resolution.executionWindowReusedCount += 1;
  }
  return makeManagedExecutionWindowUsable(window, trace);
}

async function ensureManagedExecutionWindow(url, trace = {}) {
  const resolution = managedExecutionResolutionFor(trace.request_id, trace.handoff_id);
  if (managedExecutionWindowEnsureInFlight) {
    resolution.ensureJoinedInflightCount += 1;
    return managedExecutionWindowEnsureInFlight;
  }
  let operation;
  operation = (async () => {
    try {
      return await ensureManagedExecutionWindowUnlocked(url, trace, resolution);
    } finally {
      if (managedExecutionWindowEnsureInFlight === operation) managedExecutionWindowEnsureInFlight = null;
    }
  })();
  managedExecutionWindowEnsureInFlight = operation;
  return operation;
}

async function enforceManagedExecutionTab(tab, trace = {}) {
  if (!tab || !Number.isSafeInteger(tab.id) || typeof chrome.tabs?.update !== "function") return tab;
  if (!Number.isSafeInteger(managedTabState.executionWindowId)
    || tab.windowId !== managedTabState.executionWindowId) return tab;
  const changes = {};
  if (tab.active !== true) changes.active = true;
  if (tab.autoDiscardable !== false) changes.autoDiscardable = false;
  if (Object.keys(changes).length === 0) return tab;
  try {
    const updated = await chrome.tabs.update(tab.id, changes);
    const normalized = updated && updated.id !== undefined
      ? updated
      : { ...tab, ...changes };
    diagnostic("managed execution tab state enforced", {
      ...trace,
      target_tab_id: normalized.id,
      execution_window_id: normalized.windowId,
      tab_active: normalized.active,
      tab_auto_discardable: normalized.autoDiscardable,
      status: "enforced",
      stage: "managed_execution_tab_state_enforced"
    });
    recordManagedTabLifecycleTelemetry("managed_execution_tab_state_enforced", {
      ...trace,
      target_tab_id: normalized.id,
      status: "enforced",
      stage: "managed_execution_tab_state_enforced"
    }, normalized.id, normalized);
    return normalized;
  } catch (error) {
    throw managedTabError(
      error?.code || "managed_execution_tab_state_failed",
      "managed_execution_tab_state",
      "Managed ChatGPTタブの実行状態を設定できません。");
  }
}

async function getManagedExecutionTab(trace) {
  await managedTabStateReady;
  if (!Number.isSafeInteger(managedTabState.tabId) || managedTabState.tabId < 0) return null;
  if (!Number.isSafeInteger(managedTabState.executionWindowId)
    || managedTabState.executionWindowId < 0) {
    diagnostic("legacy managed tab rejected", {
      ...managedTabTrace(trace),
      status: "error",
      error_code: "managed_execution_window_required",
      stage: "managed_tab_lookup"
    });
    clearManagedTabState("PreparingTab");
    return null;
  }
  try {
    const tab = await chrome.tabs.get(managedTabState.tabId);
    if (!tab || tab.id === undefined || !isUsableManagedExecutionTab(tab, managedTabState.executionWindowId)) {
      diagnostic("managed tab unavailable", {
        ...managedTabTrace(trace),
        status: "error",
        error_code: "managed_tab_unavailable",
        stage: "managed_tab_lookup"
      });
      if (!tab || !isOwnedManagedExecutionTab(tab)) clearManagedTabState("Failed");
      return null;
    }
    if (tab.windowId !== managedTabState.executionWindowId) {
      diagnostic("managed tab outside execution window", {
        ...managedTabTrace(trace),
        target_tab_id: tab.id,
        window_id: tab.windowId,
        error_code: "managed_tab_wrong_window",
        status: "error",
        stage: "managed_tab_lookup"
      });
      clearManagedTabState("PreparingTab");
      return null;
    }
    const window = await getManagedExecutionWindow(managedTabState.executionWindowId);
    if (!window) {
      diagnostic("managed execution window unavailable", {
        ...managedTabTrace(trace),
        error_code: "execution_window_closed",
        status: "error",
        stage: "execution_window_lookup"
      });
      clearManagedTabState("PreparingTab", { clearExecutionWindow: true });
      return null;
    }
    await makeManagedExecutionWindowUsable(window, trace);
    return await enforceManagedExecutionTab(tab, trace);
  } catch (error) {
    diagnostic("managed tab unavailable", {
      ...managedTabTrace(trace),
      status: "error",
      error_code: error?.code || "managed_tab_closed",
      stage: error?.stage || "managed_tab_lookup"
    });
    clearManagedTabState("Failed");
    return null;
  }
}

async function createManagedTabInExecutionWindow(url, windowId, trace) {
  const resolution = managedExecutionResolutionFor(trace.request_id, trace.handoff_id);
  if (managedExecutionTabCreateInFlight) {
    resolution.ensureJoinedInflightCount += 1;
    return managedExecutionTabCreateInFlight;
  }
  if (typeof chrome.tabs?.create !== "function") {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  resolution.managedTabCreateRequestedCount += 1;
  let operation;
  operation = (async () => {
    try {
      return await createManagedTabInExecutionWindowUnlocked(url, windowId, trace, resolution);
    } finally {
      if (managedExecutionTabCreateInFlight === operation) managedExecutionTabCreateInFlight = null;
    }
  })();
  managedExecutionTabCreateInFlight = operation;
  return operation;
}

async function createManagedTabInExecutionWindowUnlocked(url, windowId, trace, resolution) {
  let created;
  try {
    created = await chrome.tabs.create({ url, windowId, active: true });
  } catch (_) {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  if (!created || !Number.isSafeInteger(created.id) || created.id < 0) {
    throw managedTabError("managed_tab_create_failed", "managed_tab_create", "Managed ChatGPTタブを作成できません。");
  }
  managedTabState = {
    ...managedTabState,
    tabId: created.id,
    executionWindowId: windowId,
    executionWindowState: managedTabState.executionWindowState || "normal"
  };
  stampManagedExecutionTab(created, windowId);
  managedTabLifecycle("PreparingTab", {
    tabId: created.id,
    executionWindowId: windowId,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  const normalized = await enforceManagedExecutionTab(created, trace);
  resolution.managedTabCreatedCount += 1;
  diagnostic("managed tab created", {
    ...trace,
    status: "created",
    stage: "managed_tab_created",
    target_tab_id: normalized.id,
    execution_window_id: windowId
  });
  recordManagedTabLifecycleTelemetry("managed_tab_created", {
    ...trace,
    status: "created",
    stage: "managed_tab_created",
    target_tab_id: normalized.id,
    execution_window_id: windowId
  }, normalized.id, normalized, windowId);
  return normalized;
}

async function createManagedExecutionTab(url, trace) {
  const previousExecutionWindowId = managedTabState.executionWindowId;
  managedTabLifecycle("PreparingTab", {
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  const window = await ensureManagedExecutionWindow(url, trace);
  const resolution = managedExecutionResolutionFor(trace.request_id, trace.handoff_id);
  const createResultTabs = Array.isArray(window?.tabs) ? window.tabs : [];
  let created = await findManagedExecutionWindowTab(window.id, createResultTabs);
  if (created
    && !isCollectorReservedTab(created)
    && (isOwnedManagedExecutionTab(created)
      || isChatGptTab(created)
      || isPlaceholderExecutionTab(created))) {
    stampManagedExecutionTab(created, window.id);
    managedTabLifecycle("PreparingTab", { tabId: created.id });
    if (executionTabNeedsDestination(created, url)) {
      created = await navigateManagedExecutionTab(created, url, trace);
    }
    created = await enforceManagedExecutionTab(created, trace);
    resolution.initialWindowTabFound = resolution.initialWindowTabFound || managedExecutionCreatedInitialTabIds.has(created.id);
    if (connectorManagedWindowInitialTabRole === "execution"
      && managedExecutionCreatedInitialTabIds.has(created.id)) {
      resolution.initialWindowTabReused = true;
      resolution.managedTabAdoptedFromWindowCreate = true;
      diagnostic("initial execution tab adopted", {
        ...trace,
        status: "adopted",
        stage: "initial_tab_adopted",
        target_tab_id: created.id,
        execution_window_id: window.id
      });
    } else {
      resolution.managedTabReusedCount += 1;
    }
  } else if (!created) {
    created = await createManagedTabInExecutionWindow(url, window.id, trace);
    resolution.managedTabCreatedViaTabsCreate = true;
    await closeProvenCreatedInitialPlaceholder(window.id, created.id, resolution);
  } else {
    throw managedTabError(
      "ambiguous_managed_execution_tabs",
      "managed_tab_lookup",
      "Managed Execution Tabの候補が複数あり、一意に特定できません。");
  }
  resolution.executionWindowPhysicalTabCountAfterTabResolution = await countPhysicalExecutionWindowTabs(window.id);
  resolution.executionWindowPhysicalTabCountFinal = resolution.executionWindowPhysicalTabCountAfterTabResolution;
  if (previousExecutionWindowId !== window.id) {
    diagnostic("managed tab created", {
      ...trace,
      status: resolution.managedTabCreatedViaTabsCreate === true ? "created" : "adopted",
      stage: "managed_tab_created",
      target_tab_id: created.id,
      execution_window_id: window.id
    });
    recordManagedTabLifecycleTelemetry("managed_tab_created", {
      ...trace,
      status: resolution.managedTabCreatedViaTabsCreate === true ? "created" : "adopted",
      stage: "managed_tab_created",
      target_tab_id: created.id,
      execution_window_id: window.id
    }, created.id, created, window.id);
    diagnostic("managed tab ready", {
      ...trace,
      status: "ready",
      stage: "managed_tab_ready",
      target_tab_id: created.id,
      execution_window_id: window.id
    });
    recordManagedTabLifecycleTelemetry("managed_tab_ready", {
      ...trace,
      status: "ready",
      stage: "managed_tab_ready",
      target_tab_id: created.id,
      execution_window_id: window.id
    }, created.id, created, window.id);
  }
  return created;
}

async function navigateManagedExecutionTab(tab, url, trace) {
  if (!tab || tab.id === undefined || typeof chrome.tabs?.update !== "function") {
    throw managedTabError("managed_tab_navigation_failed", "managed_tab_navigation", "Managed ChatGPTタブを移動できません。");
  }
  if (tab.windowId !== managedTabState.executionWindowId) {
    throw managedTabError("managed_tab_wrong_window", "managed_tab_navigation", "Managed ChatGPTタブがExecution Windowにありません。");
  }
  managedTabLifecycle("PreparingTab", {
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });
  contentScriptReadyTabs.delete(tab.id);
  diagnostic("managed tab navigation requested", {
    ...trace,
    status: "requested",
    stage: "managed_tab_navigation",
    target_tab_id: tab.id,
    execution_window_id: managedTabState.executionWindowId
  });
  try {
    const updated = await chrome.tabs.update(tab.id, { url, active: true, autoDiscardable: false });
    return await enforceManagedExecutionTab(
      updated && updated.id !== undefined ? updated : { ...tab, url, active: true, autoDiscardable: false },
      trace);
  } catch (_) {
    throw managedTabError("managed_tab_navigation_failed", "managed_tab_navigation", "Managed ChatGPTタブを移動できません。");
  }
}

function executionReadyMessage(message, target) {
  return {
    type: CHATGPT_EXECUTION_READY_MESSAGE_TYPE,
    requestId: message?.request_id,
    sessionId: message?.session_id,
    handoffId: message?.handoff_id,
    boundaryId: message?.boundary_id,
    targetTabId: managedTabState.tabId,
    ...(target?.conversationId ? { expectedConversationId: target.conversationId } : {}),
    ...(target?.conversationUrl ? { expectedConversationUrl: target.conversationUrl } : {}),
    ...(target?.projectId ? { expectedProjectId: target.projectId } : {}),
    newConversation: target?.newConversation === true,
    requireComposer: true
  };
}

function executionIdentityMatches(message, request) {
  if (!message
    || message.request_id !== request?.request_id
    || message.session_id !== request?.session_id) return false;
  if (request?.handoff_id !== undefined
    && request?.handoff_id !== null
    && message.handoff_id !== request.handoff_id) return false;
  if (request?.boundary_id !== undefined
    && request?.boundary_id !== null
    && message.boundary_id !== request.boundary_id) return false;
  return true;
}

async function ensureManagedExecutionTab(message, trace = traceForMessage(message)) {
  await managedTabStateReady;
  if (message?.new_conversation !== undefined && typeof message.new_conversation !== "boolean") {
    throw managedTabError("target_conversation_invalid", "target_conversation_check", "新規Conversation指定が不正です。");
  }
  const identity = conversationTargetFromMessage(message);
  if (identity.errorCode) throw managedTabError(identity.errorCode, identity.errorStage, "ChatGPTの対象Conversation情報が不正です。");

  const target = managedConversationTarget(message, identity);
  // Conversation ID/URL is the durable execution identity. Project metadata
  // is only required when the operation has to open a new Conversation; for
  // an existing Conversation, stale Project metadata must never block media
  // delivery or Handoff routing.
  const requiresProjectMetadata = target.newConversation === true;
  const requestedProjectId = message?.target_project_id === undefined || message?.target_project_id === null
    ? null
    : safeContextIdentifier(message.target_project_id);
  const requestedProjectUrl = message?.target_project_url === undefined || message?.target_project_url === null
    ? null
    : safeChatGptProjectUrl(message.target_project_url)
      || (safeChatGptContextUrl(message.target_project_url) === "https://chatgpt.com/"
        ? "https://chatgpt.com/"
        : null);
  if (requiresProjectMetadata
    && message?.target_project_id !== undefined
    && message?.target_project_id !== null
    && !requestedProjectId) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project情報が不正です。");
  }
  if (requiresProjectMetadata
    && message?.target_project_url !== undefined
    && message?.target_project_url !== null
    && !requestedProjectUrl) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project URLが不正です。");
  }
  if (requiresProjectMetadata
    && requestedProjectId
    && requestedProjectUrl !== "https://chatgpt.com/"
    && chatGptProjectId(requestedProjectUrl) !== requestedProjectId) {
    throw managedTabError("target_project_invalid", "target_project_check", "ChatGPT Project IDとURLが一致しません。");
  }
  const destination = target.newConversation
    ? target.projectUrl || "https://chatgpt.com/"
    : target.conversationUrl || (target.conversationId
      ? `https://chatgpt.com/c/${encodeURIComponent(target.conversationId)}`
      : null);
  if (!destination) {
    throw managedTabError("target_conversation_not_found", "target_conversation_check", "保存済みのChatGPT Conversation URLがありません。");
  }
  const resolution = managedExecutionResolutionFor(message?.request_id, message?.handoff_id);
  resolution.ensureCallCount += 1;
  if (managedExecutionTabEnsureInFlight) resolution.ensureJoinedInflightCount += 1;
  let releaseMutex = () => {};
  const previousMutex = managedExecutionTabEnsureMutex;
  managedExecutionTabEnsureMutex = new Promise((resolve) => { releaseMutex = resolve; });
  try {
    await previousMutex;
  } catch (_) { }
  const operation = completeManagedExecutionTabEnsure(message, trace, target, destination, resolution);
  managedExecutionTabEnsureInFlight = operation;
  try {
    return await operation;
  } finally {
    if (managedExecutionTabEnsureInFlight === operation) managedExecutionTabEnsureInFlight = null;
    releaseMutex();
  }
}

async function completeManagedExecutionTabEnsure(message, trace, target, destination, resolution) {
  await waitForCollectorCollectionIdle();
  const liveBound = await liveManagedExecutionBinding(message?.request_id);
  let tab = liveBound?.tab || null;
  if (!tab) tab = await getManagedExecutionTab(trace);
  if (liveBound?.tab) resolution.managedTabReusedCount += 1;
  if (!tab) {
    tab = await createManagedExecutionTab(destination, trace);
  } else if (!liveBound?.tab) {
    resolution.managedTabReusedCount += 1;
  }
  if (!managedTabMatchesTarget(tab, target)) {
    tab = await navigateManagedExecutionTab(tab, destination, trace);
  } else {
    diagnostic("managed tab reused", {
      ...trace,
      status: "reused",
      stage: "managed_tab_reused",
      target_tab_id: tab.id
    });
  }
  tab = await enforceManagedExecutionTab(tab, trace);
  stampManagedExecutionTab(tab, tab.windowId ?? managedTabState.executionWindowId);
  bindManagedExecutionToRequest(
    message?.request_id,
    tab.windowId ?? managedTabState.executionWindowId,
    tab.id,
    managedTabState.executionGeneration || managedExecutionGeneration);

  managedTabState = {
    ...managedTabState,
    tabId: tab.id,
    executionWindowId: Number.isSafeInteger(tab.windowId)
      ? tab.windowId
      : managedTabState.executionWindowId,
    projectId: target.projectId || managedTabState.projectId || null,
    projectUrl: target.projectUrl || managedTabState.projectUrl || null,
    conversationId: target.conversationId || (target.newConversation ? null : managedTabState.conversationId),
    conversationUrl: target.conversationUrl || (target.newConversation ? null : managedTabState.conversationUrl),
    currentRequestId: message?.request_id || null,
    currentSessionId: message?.session_id || null,
    currentHandoffId: message?.handoff_id || null,
    currentBoundaryId: message?.boundary_id || null
  };
  managedTabLifecycle("WaitingContentScript", {
    tabId: tab.id,
    contentReady: false,
    conversationReady: false,
    composerReady: false,
    watcherReady: false
  });

  const tabReady = await waitForTabReady(tab.id, MANAGED_TAB_NAVIGATION_TIMEOUT_MS);
  if (!tabReady) {
    throw managedTabError("managed_tab_navigation_timeout", "managed_tab_navigation_timeout", "Managed ChatGPTタブの読み込みがタイムアウトしました。");
  }

  managedTabLifecycle("WaitingContentScript", { tabId: tab.id });
  let readyResult;
  try {
    readyResult = await dispatchToContentScript(
      tab.id,
      executionReadyMessage(message, target),
      message,
      {
        timeoutMs: MANAGED_CONVERSATION_READY_TIMEOUT_MS,
        timeoutStage: "conversation_ready_timeout"
      });
  } catch (error) {
    throw error?.code
      ? error
      : managedTabError("content_script_ready_timeout", "content_script_ready_timeout", "ChatGPT Content Scriptの準備がタイムアウトしました。");
  }
  if (!executionIdentityMatches(readyResult, message)
    || readyResult.status !== "ready") {
    throw managedTabError(
      readyResult?.error_code || "conversation_not_ready",
      readyResult?.stage || "conversation_ready",
      readyResult?.message || "対象ChatGPT Conversationの準備が完了していません。");
  }
  const currentContext = normalizeCurrentContext(readyResult.current_context || readyResult.currentContext);
  const resolvedTab = await chrome.tabs.get(tab.id).catch(() => tab);
  const actualConversationId = currentContext?.conversation_id || chatGptConversationId(resolvedTab?.url);
  const actualConversationUrl = currentContext?.url || safeChatGptContextUrl(resolvedTab?.url);
  if (!target.newConversation
    && ((target.conversationId && actualConversationId !== target.conversationId)
      || (target.conversationUrl && !isSameChatGptConversation(actualConversationUrl, target.conversationUrl, target.conversationId)))) {
    throw managedTabError("target_conversation_mismatch", "conversation_ready", "Managed ChatGPTタブのConversationが対象と一致しません。");
  }

  managedTabState = {
    ...managedTabState,
    tabId: resolvedTab?.id ?? tab.id,
    conversationId: actualConversationId || (target.newConversation ? null : target.conversationId),
    conversationUrl: actualConversationUrl || (target.newConversation ? null : target.conversationUrl),
    projectId: currentContext?.project_id || target.projectId || managedTabState.projectId || null,
    contentReady: true,
    conversationReady: true,
    composerReady: readyResult.composer_ready !== false
  };
  managedTabLifecycle("WaitingWatcher", {
    tabId: managedTabState.tabId,
    contentReady: true,
    conversationReady: true,
    composerReady: managedTabState.composerReady
  });
  diagnostic("managed tab conversation ready", managedTabTrace({
    ...trace,
    status: "ready",
    stage: "conversation_ready"
  }));
  const bound = bindManagedExecutionToRequest(
    message?.request_id,
    resolvedTab?.windowId ?? tab.windowId ?? managedTabState.executionWindowId,
    resolvedTab?.id ?? tab.id,
    managedTabState.executionGeneration || managedExecutionGeneration);
  const boundFingerprint = collectorHandleFingerprint(
    bound?.executionWindowId,
    bound?.targetTabId);
  resolution.handoffBoundWindowFingerprint = boundFingerprint;
  resolution.handoffBoundTabFingerprint = boundFingerprint;
  emitManagedExecutionResolutionSummary(message?.request_id, {
    finalExecutionWindowCount: await countOwnedExecutionWindows(),
    finalManagedTabCount: await countOwnedExecutionTabs(
      bound?.executionWindowId || managedTabState.executionWindowId),
    finalExecutionWindowPhysicalTabCount: await countPhysicalExecutionWindowTabs(
      bound?.executionWindowId || managedTabState.executionWindowId),
    sameExecutionTab: true
  });
  await emitConnectorManagedWindowTopologySummary(message?.request_id);
  return {
    tab: resolvedTab || tab,
    target,
    currentContext,
    readyResult
  };
}

function base64FromBytes(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  if (typeof globalThis.btoa === "function") return globalThis.btoa(binary);

  // Test/runtime fallback for environments without Window.btoa. This is
  // deliberately per-chunk; the full media file is never base64-embedded in
  // a WebSocket or one JSON message.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let index = 0; index < binary.length; index += 3) {
    const first = binary.charCodeAt(index);
    const second = index + 1 < binary.length ? binary.charCodeAt(index + 1) : 0;
    const third = index + 2 < binary.length ? binary.charCodeAt(index + 2) : 0;
    const combined = (first << 16) | (second << 8) | third;
    encoded += alphabet[(combined >> 18) & 63];
    encoded += alphabet[(combined >> 12) & 63];
    encoded += index + 1 < binary.length ? alphabet[(combined >> 6) & 63] : "=";
    encoded += index + 2 < binary.length ? alphabet[combined & 63] : "=";
  }
  return encoded;
}

function contentResultError(result, fallbackCode, fallbackStage) {
  if (!result || typeof result !== "object") {
    return { code: fallbackCode, stage: fallbackStage, message: "ChatGPT Content Scriptから有効な添付結果を受け取れませんでした。" };
  }
  return {
    code: result.error_code || fallbackCode,
    stage: result.stage || fallbackStage,
    message: result.message || "ChatGPTへの生成物添付に失敗しました。"
  };
}

async function sendReviewMediaToTarget(message, bridgeSocket) {
  let result;
  const trace = {
    request_id: message?.request_id,
    media_id: message?.media_id,
    iteration: message?.iteration
  };
  diagnostic("review.media.attach received", trace);
  if (!isValidReviewMediaMessage(message)) {
    result = reviewMediaResult(message, "error", "media_registration_failed", "Review添付メタデータが不正です。", "media_request_validation");
  } else if (!sessionToken || bridgeSocket !== socket || bridgeSocket.readyState !== WebSocket.OPEN) {
    result = reviewMediaResult(message, "error", "bridge_disconnected", "Desktop Bridgeに接続されていません。", "bridge_connection");
  } else {
    let targetTab;
    try {
      const prepared = await ensureManagedExecutionTab(message, trace);
      targetTab = prepared.tab;
      diagnostic("managed media target ready", {
        ...trace,
        status: "ready",
        stage: "conversation_ready",
        target_tab_id: targetTab.id
      });
    } catch (error) {
      const code = error?.code || "review_target_tab_not_found";
      const stage = error?.stage || "managed_tab_ready";
      result = reviewMediaResult(message, "error", code, error?.message || "Managed ChatGPTタブの準備に失敗しました。", stage);
    }
    if (!result) {
      diagnostic("review target tab found", { ...trace, target_tab_id: targetTab.id, stage: "target_tab_found" });
      try {
        const mediaUrl = `${BRIDGE_MEDIA_URL_PREFIX}${encodeURIComponent(message.media_id)}?session_id=${encodeURIComponent(message.session_id)}&iteration=${encodeURIComponent(String(message.iteration))}`;
        diagnostic("media fetching", { ...trace, stage: "media_fetching" });
        const response = await fetchBridge(mediaUrl, {
          method: "GET",
          credentials: "omit",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            [BRIDGE_CLIENT_HEADER]: BRIDGE_CLIENT_VALUE
          }
        });
        if (!response.ok) {
          const code = response.status === 410 ? "media_expired" : response.status === 413 ? "media_too_large" : "media_fetch_failed";
          result = reviewMediaResult(message, "error", code, "Desktop Bridgeから生成物を取得できませんでした。", "media_fetch_failed");
        } else {
          const contentLength = Number(response.headers?.get?.("content-length") || 0);
          if (contentLength > MAX_REVIEW_MEDIA_BYTES || (contentLength > 0 && contentLength !== message.size)) {
            result = reviewMediaResult(message, "error", contentLength > MAX_REVIEW_MEDIA_BYTES ? "media_too_large" : "media_fetch_failed", "生成物のサイズ確認に失敗しました。", "media_size_validation");
          } else {
            const begin = await dispatchToContentScript(targetTab.id, {
              type: REVIEW_MEDIA_ATTACH_BEGIN_MESSAGE_TYPE,
              requestId: message.request_id,
              sessionId: message.session_id,
              iteration: message.iteration,
              mediaId: message.media_id,
              fileName: message.filename,
              mimeType: message.mime_type,
              size: message.size
            }, trace);
            if (!begin || begin.status !== "receiving") {
              const failure = contentResultError(begin, "attachment_control_not_found", "attachment_control_found");
              result = reviewMediaResult(message, "error", failure.code, failure.message, failure.stage);
            } else {
              let transferred = 0;
              const reader = response.body?.getReader?.();
              const sendChunk = async (bytes) => {
                if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
                if (bytes.length === 0) return;
                // ReadableStream implementations are free to return a much
                // larger chunk than the MV3 message budget. Split every
                // reader chunk before base64 encoding so a video never turns
                // into one oversized tabs.sendMessage payload.
                for (let offset = 0; offset < bytes.length; offset += REVIEW_MEDIA_CHUNK_BYTES) {
                  const part = bytes.slice(offset, Math.min(offset + REVIEW_MEDIA_CHUNK_BYTES, bytes.length));
                  if (part.length === 0) continue;
                  const nextTransferred = transferred + part.length;
                  if (nextTransferred > message.size || nextTransferred > MAX_REVIEW_MEDIA_BYTES) {
                    throw bridgeError("Review media is too large.", 0, nextTransferred > MAX_REVIEW_MEDIA_BYTES ? "media_too_large" : "media_fetch_failed");
                  }
                  const chunkResult = await dispatchToContentScript(targetTab.id, {
                    type: REVIEW_MEDIA_ATTACH_CHUNK_MESSAGE_TYPE,
                    requestId: message.request_id,
                    sessionId: message.session_id,
                    iteration: message.iteration,
                    mediaId: message.media_id,
                    offset: transferred,
                    chunk: base64FromBytes(part)
                  }, trace);
                  if (!chunkResult || chunkResult.status !== "receiving") {
                    const failure = contentResultError(chunkResult, "attachment_input_failed", "attachment_injected");
                    throw bridgeError(failure.message, 0, failure.code);
                  }
                  transferred = nextTransferred;
                }
              };

              if (reader) {
                while (true) {
                  const part = await reader.read();
                  if (part.done) break;
                  await sendChunk(part.value);
                }
              } else {
                const bytes = new Uint8Array(await response.arrayBuffer());
                for (let offset = 0; offset < bytes.length; offset += REVIEW_MEDIA_CHUNK_BYTES) {
                  await sendChunk(bytes.slice(offset, offset + REVIEW_MEDIA_CHUNK_BYTES));
                }
              }

              if (transferred !== message.size) {
                result = reviewMediaResult(message, "error", "media_fetch_failed", "生成物の受信サイズが一致しません。", "media_size_validation");
              } else {
                diagnostic("media ready", { ...trace, stage: "media_ready" });
                const end = await dispatchToContentScript(targetTab.id, {
                  type: REVIEW_MEDIA_ATTACH_END_MESSAGE_TYPE,
                  requestId: message.request_id,
                  sessionId: message.session_id,
                  iteration: message.iteration,
                  mediaId: message.media_id,
                  fileName: message.filename,
                  mimeType: message.mime_type,
                  size: message.size
                }, trace);
                if (end?.status === "attached") {
                  result = reviewMediaResult(message, "attached", null, null, end.stage || "attachment_verified");
                } else {
                  const failure = contentResultError(end, "attachment_verification_failed", "attachment_verified");
                  result = reviewMediaResult(message, "error", failure.code, failure.message, failure.stage);
                }
              }
            }
          }
        }
      } catch (error) {
        const code = error?.code || (isMissingContentScriptError(error) ? "content_script_unavailable" : "media_fetch_failed");
        const stage = error?.stage || (code === "content_script_unavailable" ? "content_script_dispatch" : "media_fetching");
        result = reviewMediaResult(message, "error", code, error?.message || "生成物の添付に失敗しました。", stage);
      }
    }
  }

  diagnostic("review media result", {
    ...trace,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  sendReviewMediaResultToBridge(result, bridgeSocket);
  return result;
}

async function startAssistantResponseWatch(tabId, message, bridgeSocket, options = {}) {
  const requestId = message.request_id;
  const bound = managedExecutionBindingForRequest(requestId);
  if (bound && Number.isSafeInteger(bound.targetTabId)) {
    const liveBound = await liveManagedExecutionBinding(requestId);
    if (liveBound) tabId = liveBound.tab.id;
  }
  const preSend = options.preSend === true;
  let monitorWindowId = bound?.executionWindowId || managedTabState.executionWindowId;
  let tabActive = null;
  let windowFocused = null;
  if (typeof chrome.tabs?.get === "function") {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (Number.isSafeInteger(tab?.windowId)) monitorWindowId = tab.windowId;
      if (typeof tab?.active === "boolean") tabActive = tab.active;
      if (Number.isSafeInteger(tab?.windowId) && typeof chrome.windows?.get === "function") {
        try {
          const windowInfo = await chrome.windows.get(tab.windowId);
          if (typeof windowInfo?.focused === "boolean") windowFocused = windowInfo.focused;
        } catch (_) { }
      }
    } catch (_) { }
  }
  lastResponseMonitorTabFingerprint = collectorHandleFingerprint(monitorWindowId, tabId);
  const watchResolution = managedExecutionResolutionFor(requestId, message.handoff_id);
  watchResolution.watcherWindowFingerprint = lastResponseMonitorTabFingerprint;
  watchResolution.watcherTabFingerprint = lastResponseMonitorTabFingerprint;
  // A retry rotates request_id but intentionally keeps the same immutable
  // Handoff boundary. Do not let a late watcher from the previous attempt
  // compete with the current request or forward a stale response.
  forgetResponseWatchesForIdentity(message, requestId);
  diagnostic(message.handoff_kind === "review" ? "review response watch requested" : "response watch requested", traceForMessage(message, {
    status: "requested",
    stage: "response_watch_requested",
    target_tab_id: tabId,
    handoff_send_collector_tab_fingerprint: lastHandoffSendTabFingerprint || "none",
    response_monitor_collector_tab_fingerprint: lastResponseMonitorTabFingerprint,
    same_collector_tab_for_send_and_monitor: Boolean(lastHandoffSendTabFingerprint)
      && lastHandoffSendTabFingerprint === lastResponseMonitorTabFingerprint
  }));
  const pending = {
    requestId,
    tabId,
    targetTabId: tabId,
    sessionId: message.session_id,
    handoffId: message.handoff_id,
    boundaryId: message.boundary_id,
    isReview: message.handoff_kind === "review",
    targetTabUrl: message.target_tab_url || managedTabState.conversationUrl || null,
    targetConversationId: message.target_conversation_id || managedTabState.conversationId || null,
    targetConversationUrl: message.target_conversation_url || managedTabState.conversationUrl || null,
    preSend,
    watcherReady: false,
    bridgeSocket,
    watchDispatching: true,
    rearmInProgress: false,
    rearmTimer: null,
    rearmDeadline: Date.now() + RESPONSE_WATCH_REARM_TIMEOUT_MS,
    lifecycleTelemetryTimer: null,
    tabActive,
    windowFocused
  };
  responseWatches.set(requestId, pending);
  scheduleResponseWatchLifecycleTelemetry(pending);

  let watchResult;
  try {
    watchResult = await dispatchToContentScript(tabId, {
      type: RESPONSE_WATCH_MESSAGE_TYPE,
      requestId: message.request_id,
      sessionId: message.session_id,
      handoffId: message.handoff_id,
      boundaryId: message.boundary_id,
      protocol: HANDOFF_PROTOCOL,
      targetTabId: tabId,
      ...(message.handoff_kind === "review" ? { review: true } : {}),
      ...(preSend ? { prepare: true } : {}),
      ...(typeof tabActive === "boolean" ? { tabActive } : {}),
      ...(typeof windowFocused === "boolean" ? { windowFocused } : {})
    },
    message,
    { timeoutMs: MANAGED_WATCHER_READY_TIMEOUT_MS, timeoutStage: "response_watch_ready_timeout" });
  } catch (error) {
    const errorCode = error?.code || "content_script_unavailable";
    const stage = error?.stage || "response_watch_dispatch";
    diagnostic("assistant response watch deferred", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "pending",
      error_code: errorCode,
      stage
    });
    pending.watchDispatching = false;
    if (preSend) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      managedTabLifecycle("Failed", { tabId, watcherReady: false });
    } else {
      scheduleResponseWatchRearm(pending);
    }
    return false;
  }

  if (!watchResult
    || watchResult.request_id !== requestId
    || watchResult.session_id !== message.session_id
    || watchResult.handoff_id !== message.handoff_id
    || watchResult.boundary_id !== message.boundary_id
    || watchResult.status !== "watching") {
    const errorCode = watchResult?.error_code || "response_watch_unavailable";
    const stage = watchResult?.stage || "response_watch_result_invalid";
    diagnostic("assistant response watch deferred", {
      ...traceForMessage(message, { target_tab_id: tabId }),
      status: "pending",
      error_code: errorCode,
      stage
    });
    pending.watchDispatching = false;
    if (preSend) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      managedTabLifecycle("Failed", { tabId, watcherReady: false });
    } else {
      scheduleResponseWatchRearm(pending);
    }
    return false;
  }

  pending.watchDispatching = false;
  pending.watcherReady = true;
  managedTabLifecycle(managedTabState.lifecycle === "Sending" ? "Sending" : "WaitingWatcher", {
    tabId,
    watcherReady: true
  });
  diagnostic("response watch armed", {
    ...traceForMessage(message, { target_tab_id: tabId }),
    status: "watching",
    stage: preSend ? "response_watch_ready" : "response_watch_armed",
    target_tab_id: tabId
  });
  recordManagedTabLifecycleTelemetry("response_watch_armed", responseWatchTraceForPending(pending, {
    status: "watching",
    stage: "response_watch_armed",
    watcher_state: "armed"
  }), tabId);
  return true;
}

async function resolveHandoffTarget(message) {
  try {
    const prepared = await ensureManagedExecutionTab(message, traceForMessage(message));
    return { tab: prepared.tab, target: prepared.target, currentContext: prepared.currentContext, error: null };
  } catch (error) {
    return {
      tab: null,
      error: handoffResult(
        message,
        "error",
        error?.code || "managed_tab_ready_failed",
        error?.message || "Managed ChatGPTタブの準備に失敗しました。",
        error?.stage || "managed_tab_ready")
    };
  }
}

function markManagedTabAfterHandoff(tab, message, currentContext, lifecycle = "Sent") {
  const context = normalizeCurrentContext(currentContext);
  const tabUrl = safeChatGptContextUrl(tab?.url);
  const conversationId = context?.conversation_id || chatGptConversationId(tab?.url);
  const conversationUrl = context?.url || tabUrl;
  managedTabState = {
    ...managedTabState,
    tabId: tab?.id ?? managedTabState.tabId,
    conversationId: conversationId || managedTabState.conversationId || null,
    conversationUrl: conversationUrl || managedTabState.conversationUrl || null,
    projectId: context?.project_id || managedTabState.projectId || null,
    currentRequestId: message?.request_id || managedTabState.currentRequestId,
    currentSessionId: message?.session_id || managedTabState.currentSessionId,
    currentHandoffId: message?.handoff_id || managedTabState.currentHandoffId,
    currentBoundaryId: message?.boundary_id || managedTabState.currentBoundaryId,
    contentReady: true,
    conversationReady: true,
    composerReady: true,
    watcherReady: true
  };
  managedTabLifecycle(lifecycle, {
    tabId: managedTabState.tabId,
    conversationId: managedTabState.conversationId,
    conversationUrl: managedTabState.conversationUrl,
    contentReady: true,
    conversationReady: true,
    composerReady: true,
    watcherReady: true
  });
}

function cancelResponseWatch(requestId) {
  const pending = responseWatches.get(requestId);
  if (!pending) return;
  if (pending.rearmTimer !== null) clearTimeout(pending.rearmTimer);
  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(requestId);
  void dispatchToContentScript(
    pending.tabId,
    {
      type: "CANCEL_ASSISTANT_RESPONSE_WATCH",
      requestId: pending.requestId,
      sessionId: pending.sessionId,
      handoffId: pending.handoffId,
      boundaryId: pending.boundaryId
    },
    pending,
    { timeoutMs: 2000, timeoutStage: "response_watch_cancel" }).catch(() => {});
}

async function sendHandoffToManagedTab(message, bridgeSocket) {
  return withManagedTabOperation(async () => {
  let result;
  let targetTab = null;
  let targetTabId = null;
  let handoffCurrentContext = null;
  let pendingSend = null;
  let responseWatchReady = false;
  let responseWatchPreArmed = false;
  try {
    recordManagedTabLifecycleTelemetry("handoff_send_before", {
      ...traceForMessage(message),
      status: "pending",
      stage: "handoff_send_before"
    });
    const target = await resolveHandoffTarget(message);
    if (target.error) {
      result = target.error;
    } else {
      targetTab = target.tab;
      targetTabId = targetTab?.id ?? null;
      lastHandoffSendTabFingerprint = collectorHandleFingerprint(
        targetTab?.windowId,
        targetTabId);
      const sendResolution = managedExecutionResolutionFor(message.request_id, message.handoff_id);
      sendResolution.senderWindowFingerprint = lastHandoffSendTabFingerprint;
      sendResolution.senderTabFingerprint = lastHandoffSendTabFingerprint;
      sendResolution.handoffBoundWindowFingerprint = lastHandoffSendTabFingerprint;
      sendResolution.handoffBoundTabFingerprint = lastHandoffSendTabFingerprint;
      handoffCurrentContext = target.currentContext || null;
      const accepted = getAcceptedHandoff(message);
      if (accepted) {
        // The first attempt may have posted successfully even if its Bridge
        // ACK was delayed. Reuse that accepted delivery and only create a new
        // response-watch request; never post the same marker-bearing Handoff
        // twice.
        diagnostic("handoff duplicate suppressed", {
          ...traceForMessage(message, { target_tab_id: targetTabId }),
          status: "sent",
          stage: "handoff_duplicate_suppressed"
        });
        result = handoffResult(
          message,
          "sent",
          null,
          null,
          "handoff_duplicate_suppressed",
          targetTab,
          {
            conversation_id: accepted.targetConversationId,
            url: accepted.targetConversationUrl,
            project_id: accepted.targetProjectId
          });
        handoffCurrentContext = {
          conversation_id: accepted.targetConversationId,
          url: accepted.targetConversationUrl,
          project_id: accepted.targetProjectId
        };
        responseWatchReady = await startAssistantResponseWatch(targetTab.id, message, bridgeSocket, { preSend: false });
      } else {
        // Watcher readiness is a prerequisite of sending. This two-phase
        // registration prevents a fast ChatGPT response or a navigation from
        // racing the observer that is meant to correlate it.
        managedTabLifecycle("WaitingWatcher", {
          tabId: targetTabId,
          watcherReady: false,
          currentRequestId: message.request_id,
          currentSessionId: message.session_id,
          currentHandoffId: message.handoff_id,
          currentBoundaryId: message.boundary_id
        });
        responseWatchPreArmed = true;
        lastHandoffSendTabFingerprint = collectorHandleFingerprint(
          targetTab.windowId,
          targetTab.id);
        responseWatchReady = await startAssistantResponseWatch(targetTab.id, message, bridgeSocket, { preSend: true });
        if (!responseWatchReady) {
          result = handoffResult(
            message,
            "error",
            "response_watch_unavailable",
            "ChatGPTのassistant応答監視を準備できないため送信を開始できません。",
            "response_watch_ready_timeout");
        }
      }

      if (!result && !accepted) {
        managedTabLifecycle("Sending", { tabId: targetTabId, watcherReady: true });
        pendingSend = createPendingHandoffSend(message, bridgeSocket, targetTab);
        let contentResult;
        try {
          diagnostic("handoff send requested", {
            ...traceForMessage(message, { target_tab_id: targetTabId }),
            status: "requested",
            stage: "handoff_send_requested"
          });
          const dispatchTask = dispatchToContentScript(targetTab.id, {
            type: "HANDOFF_SEND",
            requestId: message.request_id,
            sessionId: message.session_id,
            handoffId: message.handoff_id,
            boundaryId: message.boundary_id,
            protocol: HANDOFF_PROTOCOL,
            payload: message.payload,
            ...(message.new_conversation === true ? {
              newConversation: true,
              ...(typeof message.target_project_url === "string"
                ? { targetProjectUrl: message.target_project_url }
                : {})
            } : {}),
            ...(message.handoff_kind === "review" ? {
              review: true,
              expectedAttachment: {
                mediaId: message.review_media_id,
                fileName: message.review_file_name,
                iteration: message.review_iteration
              }
            } : {})
          }, message, { timeoutMs: MANAGED_SEND_CONFIRMATION_TIMEOUT_MS, timeoutStage: "send_confirmation_timeout" });
          // The Content Script emits HANDOFF_SEND_CONFIRMED immediately after
          // it observes the new marker-bearing user message. Race that
          // metadata-only signal with the tabs.sendMessage response: a page
          // navigation may invalidate the original response channel even
          // though ChatGPT has already accepted the post.
          const dispatchOutcome = await Promise.race([
            dispatchTask
              .then((value) => ({ kind: "dispatch", value }))
              .catch((error) => ({ kind: "error", error })),
            pendingSend.confirmation.promise
              .then((value) => ({ kind: "confirmed", value }))
          ]);
          if (dispatchOutcome.kind === "confirmed") {
            let confirmation = dispatchOutcome.value;
            if (message.new_conversation === true) {
              const bindingOutcome = await Promise.race([
                dispatchTask
                  .then((value) => ({ kind: "dispatch", value }))
                  .catch((error) => ({ kind: "error", error })),
                wait(NEW_CONVERSATION_BINDING_GRACE_MS).then(() => ({ kind: "grace" }))
              ]);
              if (bindingOutcome.kind === "dispatch"
                && bindingOutcome.value?.status === "sent") {
                confirmation = bindingOutcome.value;
                diagnostic("new conversation bound after confirmation", {
                  ...traceForMessage(message, { target_tab_id: targetTabId }),
                  status: "bound",
                  stage: "conversation_bound_after_send"
                });
              }
            }
            result = handoffResult(
              message,
              "sent",
              null,
              null,
              confirmation.stage,
              targetTab,
              confirmation.current_context || confirmation.currentContext);
            handoffCurrentContext = confirmation.current_context
              || confirmation.currentContext
              || handoffCurrentContext;
            diagnostic("handoff completion recovered", {
              ...traceForMessage(message, { target_tab_id: targetTabId }),
              status: "sent",
              stage: "handoff_confirmation_recovered"
            });
          } else if (dispatchOutcome.kind === "error") {
            throw dispatchOutcome.error;
          } else {
            contentResult = dispatchOutcome.value;
          }
        } catch (error) {
          const errorCode = error?.code === "send_failed" ? "send_failed" : "content_script_unavailable";
          const stage = error?.stage || (errorCode === "send_failed" ? "send_confirmation_timeout" : "content_script_dispatch");
          diagnostic("content script dispatch failed", {
            ...traceForMessage(message, { target_tab_id: targetTabId }),
            error_code: errorCode,
            stage
          });
          result = handoffResult(
            message,
            "error",
            errorCode,
            errorCode === "send_failed"
              ? "ChatGPTの送信結果を確認できませんでした。"
              : "ChatGPTのContent Scriptへ接続できません。",
            stage);
        }

        if (!result) {
          if (!contentResult || contentResult.request_id !== message.request_id || contentResult.handoff_id !== message.handoff_id) {
            result = handoffResult(message, "error", "content_script_unavailable", "Content Scriptから有効な送信結果を受け取れませんでした。", "send_confirmation_result_invalid");
          } else if (contentResult.status === "sent") {
            // A new Chat starts at the project/root URL, then ChatGPT replaces
            // it with the newly created conversation URL after the first user
            // message is accepted. Refresh the tab metadata before persisting
            // the result so the legacy target-tab fallback also retains the
            // current conversation URL when the Content Script could not yet
            // report a conversation identity.
            let resultTargetTab = targetTab;
            if (targetTab?.id !== undefined) {
              try {
                const refreshedTargetTab = await chrome.tabs.get(targetTab.id);
                if (refreshedTargetTab && isChatGptTab(refreshedTargetTab)) resultTargetTab = refreshedTargetTab;
              } catch (_) { }
            }
            result = handoffResult(
              message,
              "sent",
              null,
              null,
              contentResult.stage,
              resultTargetTab,
              contentResult.current_context || contentResult.currentContext);
            handoffCurrentContext = contentResult.current_context || contentResult.currentContext || handoffCurrentContext;
            diagnostic("content script send confirmed", {
              ...traceForMessage(message, { target_tab_id: resultTargetTab?.id ?? targetTabId }),
              status: "sent",
              stage: "user_message_correlated"
            });
          } else if (contentResult.status === "error") {
            result = handoffResult(
              message,
              "error",
              contentResult.error_code || "send_failed",
              contentResult.message || "ChatGPTへの送信に失敗しました。",
              contentResult.stage);
          } else {
            result = handoffResult(message, "error", "send_failed", "Content Scriptの送信結果が不正です。", "content_result_invalid");
          }
        }
        if (result.status === "sent") {
          rememberAcceptedHandoff(message, result);
          markManagedTabAfterHandoff(targetTab, message, handoffCurrentContext, "Sent");
          const pendingWatch = responseWatches.get(message.request_id);
          if (pendingWatch) {
            pendingWatch.preSend = false;
            pendingWatch.targetTabUrl = managedTabState.conversationUrl || pendingWatch.targetTabUrl;
            pendingWatch.targetConversationId = managedTabState.conversationId || pendingWatch.targetConversationId;
            pendingWatch.targetConversationUrl = managedTabState.conversationUrl || pendingWatch.targetConversationUrl;
          }
        }
      }
    }
  } catch (error) {
    if (!result || result.status !== "sent") {
      result = handoffResult(
        message,
        "error",
        error?.code || "managed_tab_ready_failed",
        error?.message || "Managed ChatGPTタブの準備に失敗しました。",
        error?.stage || "managed_tab_ready",
        targetTab);
    }
  }

  if (!result) {
    result = handoffResult(message, "error", "managed_tab_ready_failed", "Managed ChatGPTタブの処理結果を確認できませんでした。", "managed_tab_result_invalid");
  }

  if (result.status !== "sent" && responseWatchPreArmed) cancelResponseWatch(message.request_id);

  diagnostic("result status", {
    ...traceForMessage(message, { target_tab_id: targetTabId }),
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: result.stage
  });
  if (result.status === "sent") {
    managedTabLifecycle("WaitingAssistant", {
      tabId: targetTabId,
      watcherReady: responseWatchReady || Boolean(responseWatches.get(message.request_id)),
      currentRequestId: message.request_id,
      currentSessionId: message.session_id,
      currentHandoffId: message.handoff_id,
      currentBoundaryId: message.boundary_id
    });
    recordManagedTabLifecycleTelemetry(
      message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent",
      {
        ...traceForMessage(message, { target_tab_id: targetTabId }),
        status: "sent",
        stage: message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent",
        watcher_state: responseWatches.has(message.request_id) ? "armed" : "idle"
      },
      targetTabId);
  } else {
    managedTabLifecycle("Failed", { tabId: targetTabId, watcherReady: false });
  }
  diagnostic("handoff ACK ready", {
    ...traceForMessage(message, { target_tab_id: targetTabId }),
    request_id: result.request_id,
    handoff_id: result.handoff_id,
    status: result.status,
    error_code: result.error_code,
    stage: "handoff_ack_ready"
  });
  const resultSent = sendHandoffResultToBridge(result, bridgeSocket, message);
  if (resultSent && result.status === "sent") {
    diagnostic(message.handoff_kind === "review" ? "review handoff sent" : "handoff sent", {
      ...traceForMessage(message, { target_tab_id: targetTabId }),
      request_id: result.request_id,
      handoff_id: result.handoff_id,
      status: result.status,
      stage: message.handoff_kind === "review" ? "review_handoff_sent" : "handoff_sent"
    });
  }
  if (pendingSend && pendingHandoffSends.get(pendingSend.requestId) === pendingSend) {
    if (pendingSend.recoveryTimer !== null) {
      clearTimeout(pendingSend.recoveryTimer);
      pendingSend.recoveryTimer = null;
    }
    pendingHandoffSends.delete(pendingSend.requestId);
  }
  emitManagedExecutionResolutionSummary(message.request_id, { sameExecutionTab: true });
  return result;
  });
}

function runManagedHandoff(message, bridgeSocket) {
  const key = handoffIdentityKey(message);
  const existing = managedHandoffOperations.get(key);
  if (existing) {
    diagnostic("handoff operation duplicate suppressed", {
      ...traceForMessage(message),
      status: "pending",
      stage: "handoff_operation_duplicate_suppressed"
    });
    // A retry may be associated with a newly connected Desktop socket or a
    // rotated request_id. Reuse the in-flight result, but never invoke the
    // Content Script send path a second time.
    void existing.then((result) => {
      if (!result) return;
      const retryResult = { ...result, request_id: message.request_id };
      sendHandoffResultToBridge(retryResult, bridgeSocket, message);
    }).catch(() => {});
    return existing;
  }

  const operation = sendHandoffToManagedTab(message, bridgeSocket);
  managedHandoffOperations.set(key, operation);
  void operation.finally(() => {
    if (managedHandoffOperations.get(key) === operation) managedHandoffOperations.delete(key);
  }).catch(() => {});
  return operation;
}

function runManagedMediaAttachment(message, bridgeSocket) {
  const key = `${message?.session_id || ""}|${message?.request_id || ""}|${message?.media_id || ""}`;
  const existing = managedMediaOperations.get(key);
  if (existing) {
    diagnostic("media operation duplicate suppressed", {
      request_id: message?.request_id,
      session_id: message?.session_id,
      media_id: message?.media_id,
      status: "pending",
      stage: "media_operation_duplicate_suppressed"
    });
    return existing;
  }
  const operation = withManagedTabOperation(() => sendReviewMediaToTarget(message, bridgeSocket));
  managedMediaOperations.set(key, operation);
  void operation.finally(() => {
    if (managedMediaOperations.get(key) === operation) managedMediaOperations.delete(key);
  }).catch(() => {});
  return operation;
}

async function handleAssistantResponseFromContent(message, sender) {
  const requestId = message?.requestId || message?.request_id;
  const sessionId = message?.sessionId || message?.session_id;
  const handoffId = message?.handoffId || message?.handoff_id;
  const boundaryId = message?.boundaryId || message?.boundary_id;
  const pending = responseWatches.get(requestId);
  if (!pending || sender?.tab?.id !== pending.tabId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_watch_context"
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_watch_context",
      watcher_state: "idle"
    }, sender?.tab?.id);
    return;
  }
  if (Number.isSafeInteger(managedTabState.tabId)
    && managedTabState.tabId !== pending.tabId
    && managedExecutionBindingForRequest(requestId)?.targetTabId !== pending.tabId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "managed_tab_context",
      target_tab_id: sender?.tab?.id
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "managed_tab_context",
      watcher_state: "idle"
    }, sender?.tab?.id);
    return;
  }
  diagnostic("response correlation started", {
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status: "started",
    stage: "response_correlation_started",
    target_tab_id: sender?.tab?.id
  });
  if (sessionId !== pending.sessionId || handoffId !== pending.handoffId || boundaryId !== pending.boundaryId) {
    diagnostic("assistant response rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_identity_mismatch"
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: "response_not_correlated",
      stage: "response_identity_mismatch",
      watcher_state: "armed"
    }, pending.tabId);
    return;
  }

  // Review responses are bound to the tab/conversation that accepted the
  // Review Handoff. A content script can survive an SPA navigation, so the
  // sender tab id alone is not sufficient. Re-check the current URL before
  // forwarding the response; otherwise a response from a different ChatGPT
  // conversation could be correlated as the current iteration's result.
  if (pending.isReview) {
    let targetTab;
    try {
      targetTab = await chrome.tabs.get(pending.tabId);
    } catch (_) {
      targetTab = null;
    }
    const responseConversationId = safeContextIdentifier(
      message?.targetConversationId || message?.target_conversation_id);
    const responseConversationUrl = safeChatGptContextUrl(
      message?.targetConversationUrl || message?.target_conversation_url);
    const hasBoundConversation = Boolean(pending.targetConversationId || pending.targetConversationUrl);
    const targetConversationMatches = !hasBoundConversation
      || (responseConversationId
        ? (!pending.targetConversationId || responseConversationId === pending.targetConversationId)
        : responseConversationUrl
          ? isSameChatGptConversation(responseConversationUrl, pending.targetConversationUrl, pending.targetConversationId)
          : isSameChatGptConversation(targetTab?.url, pending.targetConversationUrl, pending.targetConversationId));
    if (!targetTab
      || targetTab.id !== pending.tabId
      || !isChatGptTab(targetTab)
      || !targetConversationMatches) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      diagnostic("response correlation rejected", {
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "review_target_tab_not_found",
        stage: "target_tab_check",
        target_tab_id: pending.tabId
      });
      recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
        status: "error",
        error_code: "review_target_tab_not_found",
        stage: "target_tab_check",
        watcher_state: "idle"
      }), pending.tabId);
      sendAssistantResponseToBridge({
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "review_target_tab_not_found",
        message: "Review Handoffの対象ChatGPT会話が変わったため応答を受け付けません。",
        stage: "target_tab_check",
        target_tab_id: pending.tabId,
        target_tab_url: pending.targetTabUrl,
        target_conversation_id: pending.targetConversationId,
        target_conversation_url: pending.targetConversationUrl
      }, pending.bridgeSocket);
      return;
    }

    if (responseConversationId
      && pending.targetConversationId
      && responseConversationId !== pending.targetConversationId) {
      stopResponseWatchLifecycleTelemetry(pending);
      responseWatches.delete(requestId);
      diagnostic("response correlation rejected", {
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "target_conversation_mismatch",
        stage: "response_conversation_check",
        target_tab_id: pending.tabId
      });
      recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
        status: "error",
        error_code: "target_conversation_mismatch",
        stage: "response_conversation_check",
        watcher_state: "idle"
      }), pending.tabId);
      sendAssistantResponseToBridge({
        request_id: requestId,
        session_id: sessionId,
        handoff_id: handoffId,
        boundary_id: boundaryId,
        status: "error",
        error_code: "target_conversation_mismatch",
        message: "assistant応答のConversationが現在のManaged Conversationと一致しません。",
        stage: "response_conversation_check",
        target_tab_id: pending.tabId,
        target_tab_url: pending.targetTabUrl,
        target_conversation_id: pending.targetConversationId,
        target_conversation_url: pending.targetConversationUrl
      }, pending.bridgeSocket);
      return;
    }
  }

  stopResponseWatchLifecycleTelemetry(pending);
  responseWatches.delete(requestId);
  let status = message?.status;
  let errorCode = message?.errorCode || message?.error_code;
  let responsePayload = message?.payload;
  let responseMessage = message?.message;
  let stage = message?.stage;
  let timeoutKind = typeof message?.timeoutKind === "string"
    ? message.timeoutKind
    : (typeof message?.timeout_kind === "string" ? message.timeout_kind : "none");
  if (status === "received" && (typeof responsePayload !== "string" || responsePayload.length === 0)) {
    status = "error";
    errorCode = "response_extraction_failed";
    responseMessage = "assistant応答本文を取得できませんでした。";
    stage = "response_payload_invalid";
    responsePayload = null;
  }
  if (status !== "received" && status !== "error") {
    status = "error";
    errorCode = "response_extraction_failed";
    responseMessage = "assistant応答結果が不正です。";
    stage = "response_result_invalid";
    responsePayload = null;
  }

  diagnostic("assistant response received", {
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status,
    error_code: errorCode,
    stage: "assistant_response_received",
    target_tab_id: pending.tabId,
    timeout_kind: timeoutKind
  });
  recordManagedTabLifecycleTelemetry("assistant_response_received", responseWatchTraceForPending(pending, {
    status,
    error_code: errorCode,
    stage: "assistant_response_received",
    assistant_state: status === "received"
      ? "completed"
      : errorCode === "response_stream_interrupted"
        ? "interrupted"
        : timeoutKind === "inactivity_timeout" || timeoutKind === "hard_timeout"
          ? "stalled"
          : "not_detected",
    watcher_state: "idle",
    timeout_kind: timeoutKind
  }), pending.tabId);
  if (status === "received") {
    managedTabLifecycle("ResponseReceived", {
      tabId: pending.tabId,
      watcherReady: false,
      currentRequestId: requestId,
      currentSessionId: sessionId,
      currentHandoffId: handoffId,
      currentBoundaryId: boundaryId
    });
    diagnostic("response correlation accepted", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "accepted",
      stage: "response_correlation_accepted",
      target_tab_id: pending.tabId
    });
    recordManagedTabLifecycleTelemetry("response_correlation_accepted", responseWatchTraceForPending(pending, {
      status: "accepted",
      stage: "response_correlation_accepted",
      assistant_state: "completed",
      watcher_state: "idle"
    }), pending.tabId);
  } else {
    diagnostic("response correlation rejected", {
      request_id: requestId,
      session_id: sessionId,
      handoff_id: handoffId,
      boundary_id: boundaryId,
      status: "error",
      error_code: errorCode,
      stage: "response_correlation_rejected",
      target_tab_id: pending.tabId
    });
    recordManagedTabLifecycleTelemetry("response_correlation_rejected", responseWatchTraceForPending(pending, {
      status: "error",
      error_code: errorCode,
      stage: "response_correlation_rejected",
      assistant_state: errorCode === "response_stream_interrupted" ? "interrupted" : "not_detected",
      watcher_state: "idle",
      timeout_kind: timeoutKind
    }), pending.tabId);
  }
  sendAssistantResponseToBridge({
    request_id: requestId,
    session_id: sessionId,
    handoff_id: handoffId,
    boundary_id: boundaryId,
    status,
    payload: responsePayload,
    error_code: errorCode,
    message: responseMessage,
    stage,
    timeout_kind: timeoutKind,
    ...(pending.isReview ? {
      target_tab_id: pending.tabId,
      target_tab_url: pending.targetTabUrl,
      target_conversation_id: pending.targetConversationId,
      target_conversation_url: pending.targetConversationUrl
    } : {})
  }, pending.bridgeSocket);
}

function handleBridgeMessage(message, bridgeSocket) {
  if (!message || typeof message !== "object") return;

  if (message.type === "bridge.delivery.ack") {
    acknowledgeBridgeEnvelope(message, bridgeSocket);
    return;
  }

  if (message.type === "pong" && message.id && pendingPings.has(message.id)) {
    const pending = pendingPings.get(message.id);
    pendingPings.delete(message.id);
    clearTimeout(pending.timeout);
    void setState({ lastPongAt: new Date().toISOString(), lastError: null });
    pending.resolve(message);
    return;
  }

  if (message.type === "event") {
    void setState({ lastEvent: message, lastError: null });
    return;
  }

  if (message.type === CHATGPT_CONTEXT_LIST_REQUEST_TYPE
    || message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE) {
    diagnostic("background received", {
      request_id: message.request_id,
      status: "requested",
      stage: message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE
        ? "context_current_requested"
        : "context_list_requested"
    });
    void requestChatGptContext(
      message,
      bridgeSocket,
      message.type === CHATGPT_CONTEXT_CURRENT_REQUEST_TYPE);
    return;
  }

  if (message.type === "handoff.send") {
    // The Background owns one Connector Managed Window with a Collector Tab
    // and a separate Execution Tab. Handoff/watch/send never target the
    // Collector Tab or a user's foreground ChatGPT tab.
    diagnostic("background received", traceForMessage(message, {
      stage: message.handoff_kind === "review" ? "review_handoff_received" : "handoff_received"
    }));
    void runManagedHandoff(message, bridgeSocket);
    return;
  }

  if (message.type === "review.media.attach") {
    // The Background owns authenticated media retrieval and tab routing. The
    // Content Script receives only bounded file chunks and never contacts the
    // localhost Bridge itself.
    void runManagedMediaAttachment(message, bridgeSocket);
  }
}

function isTransientConnectionError(error) {
  return error?.code === "desktop_unavailable"
    || error?.code === "websocket_error"
    || error?.code === "hello_not_acknowledged";
}

function connectionFailureState(error) {
  return error?.code === "pairing_required" || isTransientConnectionError(error)
    ? "DISCONNECTED"
    : "ERROR";
}

function openSocket(nextSessionToken) {
  return new Promise((resolve, reject) => {
    let candidate;
    try {
      candidate = new WebSocket(BRIDGE_WS_URL);
    } catch (error) {
      reject(error);
      return;
    }

    socket = candidate;
    let acknowledged = false;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    candidate.onopen = () => {
      diagnostic("websocket hello sent");
      try {
        candidate.send(JSON.stringify({
          type: "hello",
          protocol: BRIDGE_PROTOCOL,
          client: "browser-extension",
          token: nextSessionToken
        }));
      } catch (_) {
        fail(bridgeError("Desktop Bridge hello could not be sent.", 0, "websocket_error"));
      }
    };

    candidate.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (_) {
        fail(bridgeError("Desktop Bridge sent invalid JSON.", 0, "invalid_json"));
        return;
      }

      handleBridgeMessage(message, candidate);
      if (message.type === "hello.ack") {
        if (message.protocol !== BRIDGE_PROTOCOL) {
          fail(bridgeError("Desktop Bridge protocol is unavailable.", 0, "invalid_protocol"));
          return;
        }
        acknowledged = true;
        if (socket === candidate) {
          acknowledgedSocket = candidate;
          for (const pending of responseWatches.values()) {
            if (!pending.bridgeSocket) pending.bridgeSocket = candidate;
          }
          flushBridgeOutbox();
        }
        startSocketKeepalive(candidate);
        diagnostic("bridge connected");
        if (!settled) {
          settled = true;
          resolve(message);
        }
      }
      if (message.type === "error" && !acknowledged) {
        fail(bridgeError(`Desktop Bridge rejected the connection (${message.code || "error"}).`, 0, message.code || "bridge_error"));
      }
    };

    candidate.onerror = () => {
      if (!acknowledged) fail(bridgeError("Desktop Bridge WebSocket connection failed.", 0, "websocket_error"));
    };

    candidate.onclose = () => {
      stopSocketKeepalive(candidate);
      detachBridgeOutboxForSocket(candidate);
      clearResponseWatchesForSocket(candidate);
      if (acknowledgedSocket === candidate) acknowledgedSocket = null;
      clearContextRequestsForSocket(candidate);
      if (socket === candidate) {
        socket = null;
        sessionToken = null;
        diagnostic("bridge disconnected");
        closePendingPings(new Error("Desktop Bridge WebSocket closed."));
        void setState({ status: "DISCONNECTED", lastError: manualDisconnect ? null : "Desktop Connectorから切断されました。", connectedAt: null, sessionExpiresAt: null });
        if (!acknowledged) {
          fail(bridgeError("Desktop Bridge closed before hello.ack.", 0, "hello_not_acknowledged"));
        }
        if (!manualDisconnect) scheduleReconnect();
      } else if (!acknowledged) {
        fail(bridgeError("Desktop Bridge WebSocket closed before hello.ack.", 0, "hello_not_acknowledged"));
      }
    };
  });
}

async function connect() {
  await stateReady;
  if (socket?.readyState === WebSocket.OPEN && state.status === "CONNECTED") return state;
  if (connectPromise) return connectPromise;

  manualDisconnect = false;
  connectPromise = (async () => {
    clearReconnectTimer();
    await setState({ status: "CONNECTING", lastError: null });
    await fetchHealth();
    if (!pairing.credential) {
      throw bridgeError("初回接続にはDesktopのPairing codeが必要です。", 0, "pairing_required");
    }
    const bootstrap = await fetchBootstrap(pairing.credential);
    sessionToken = bootstrap.session_token;
    await openSocket(sessionToken);
    await setState({
      status: "CONNECTED",
      paired: true,
      pairingId: bootstrap.pairing_id || pairing.pairingId,
      lastError: null,
      connectedAt: new Date().toISOString(),
      sessionExpiresAt: bootstrap.session_expires_at || null
    });
    return state;
  })().catch(async (error) => {
    if (error.code === "invalid_pairing_credential") await clearPairing();
    await setState({
      status: connectionFailureState(error),
      lastError: error.code === "pairing_required"
        ? "DesktopのBROWSER EXTENSION欄に表示されたPairing codeを入力してください。"
        : errorMessage(error)
    });
    scheduleReconnect();
    throw error;
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

async function pair(pairingCode) {
  await stateReady;
  manualDisconnect = false;
  const normalized = String(pairingCode || "").trim();
  if (!normalized) throw bridgeError("Pairing codeを入力してください。", 0, "invalid_pairing_code");

  connectPromise = (async () => {
    clearReconnectTimer();
    await setState({ status: "CONNECTING", lastError: null });
    await fetchHealth();
    const result = await fetchPairing(normalized);
    await storePairing(result);
    const bootstrap = await fetchBootstrap(result.pairing_credential);
    sessionToken = bootstrap.session_token;
    await openSocket(sessionToken);
    await setState({
      status: "CONNECTED",
      paired: true,
      pairingId: result.pairing_id,
      lastError: null,
      connectedAt: new Date().toISOString(),
      sessionExpiresAt: bootstrap.session_expires_at || null
    });
    return state;
  })().catch(async (error) => {
    await setState({ status: connectionFailureState(error), lastError: errorMessage(error) });
    scheduleReconnect();
    throw error;
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (manualDisconnect || reconnectTimer !== null) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect().catch(() => {});
  }, RECONNECT_DELAY_MS);
}

async function disconnect() {
  manualDisconnect = true;
  clearReconnectTimer();
  const current = socket;
  socket = null;
  acknowledgedSocket = null;
  sessionToken = null;
  stopSocketKeepalive(current);
  closePendingPings(new Error("Disconnected by the user."));
  clearResponseWatchesForSocket(current, true);
  clearContextRequestsForSocket(current);
  bridgeOutbox.clear();
  if (current && current.readyState === WebSocket.OPEN) current.close(1000, "user disconnect");
  return setState({ status: "DISCONNECTED", lastError: null, connectedAt: null, sessionExpiresAt: null });
}

async function ping() {
  await connect();
  if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Desktop Bridge is not connected.");

  const id = crypto.randomUUID();
  const request = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingPings.delete(id);
      reject(new Error("Desktop Bridge ping timed out."));
    }, PING_TIMEOUT_MS);
    pendingPings.set(id, { resolve, reject, timeout });
  });

  await setState({ lastPingAt: new Date().toISOString(), lastError: null });
  try {
    socket.send(JSON.stringify({ type: "ping", id }));
  } catch (error) {
    pendingPings.delete(id);
    throw error;
  }
  return request;
}

function ensureReconnectAlarm() {
  chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM && !manualDisconnect) connect().catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  manualDisconnect = false;
  ensureReconnectAlarm();
  connect().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  manualDisconnect = false;
  ensureReconnectAlarm();
  connect().catch(() => {});
});

// A full ChatGPT navigation replaces the page's Content Script.  Re-arm every
// still-pending watcher when the replacement reports ready; the Background is
// the owner of the correlation identity, so the new script can safely locate
// the same marker-bearing user message and continue from there.
chrome.tabs.onUpdated?.addListener?.((tabId, changeInfo, tab) => {
  const isManagedExecutionTab = (
    (Number.isSafeInteger(managedTabState.tabId) && tabId === managedTabState.tabId)
    || managedExecutionOwnedTabIds.has(tabId)
  )
    && Number.isSafeInteger(managedTabState.executionWindowId)
    && tab?.windowId === managedTabState.executionWindowId;
  const isCollectorWindowTab = Number.isSafeInteger(collectorWindowState.tabId)
    && tabId === collectorWindowState.tabId
    && Number.isSafeInteger(collectorWindowState.windowId)
    && tab?.windowId === collectorWindowState.windowId;
  const isCollectorWindowMember = Number.isSafeInteger(collectorWindowState.windowId)
    && tab?.windowId === collectorWindowState.windowId;
  const collectorTabLifecycleChanged = [
    "status",
    "active",
    "discarded",
    "frozen",
    "autoDiscardable",
    "url"
  ].some((key) => Object.prototype.hasOwnProperty.call(changeInfo || {}, key));
  if (isCollectorWindowTab && (changeInfo?.discarded === true || changeInfo?.frozen === true)) {
    void queueCollectorTabTopologyRepair({
      event_tab_id: tabId,
      event_window_id: tab?.windowId,
      stage: "collector_tabs_on_updated"
    });
  }
  if (isCollectorWindowTab
    && collectorTabLifecycleChanged) {
    diagnostic("collector tab updated", {
      status: "observed",
      stage: "collector_tabs_on_updated",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      target_tab_id: tabId,
      tab_active: tab?.active === true,
      tab_discarded: tab?.discarded === true,
      tab_frozen: tab?.frozen === true,
      tab_auto_discardable: tab?.autoDiscardable,
      tab_status: typeof tab?.status === "string" ? tab.status : changeInfo?.status
    });
  }
  const efficiencyPending = [...contextRequests.values()].find((pending) => pending.tabId === tabId)
    || contextRequests.get(collectorWindowState.requestId);
  if (efficiencyPending?.tabId === tabId) {
      if (Object.prototype.hasOwnProperty.call(changeInfo || {}, "url")) {
        recordCollectorProjectDiscoveryEfficiencyObservedEvent(
          efficiencyPending.requestId,
          "observedUrlChangeCount");
      }
      if (changeInfo?.status === "loading") {
        recordCollectorProjectDiscoveryEfficiencyObservedEvent(
          efficiencyPending.requestId,
          "observedLoadingCount");
      }
      if (changeInfo?.status === "complete") {
        recordCollectorProjectDiscoveryEfficiencyObservedEvent(
          efficiencyPending.requestId,
          "observedCompleteCount");
      }
  }
  const identityNavigationPending = isCollectorWindowTab
    ? collectorProjectIdentityPendingForTab(tabId)
    : null;
  if (identityNavigationPending) {
    if (changeInfo?.status === "loading") {
      recordCollectorProjectDiscoveryEfficiencyNavigation(
        identityNavigationPending.requestId,
        "full_page",
        identityNavigationPending.identityNavigationProjectIndex,
        `${identityNavigationPending.requestId}:identity:${identityNavigationPending.identityNavigationGeneration}:loading`);
    }
    const urlChanged = Object.prototype.hasOwnProperty.call(changeInfo || {}, "url");
    const navigationDetected = Boolean(collectorProjectIdentityFromTab(tab));
    recordCollectorProjectIdentityNavigationTelemetry(
      "collector project identity navigation tab update",
      identityNavigationPending,
      {
        project_index: identityNavigationPending.identityNavigationProjectIndex,
        navigation_wait_started: true,
        url_changed: urlChanged,
        navigation_detected: navigationDetected,
        content_script_reloaded: false,
        tab_update_observed: true,
        navigation_wait_ms: 0,
        navigation_timeout: false,
        // A tabs.onUpdated URL observation is not, by itself, proof that
        // this project caused the navigation. The Content Script response
        // or the post-dispatch tab poll supplies that causal evidence.
        navigation_target_verified: false,
        project_url_pattern_valid: false,
        project_id_extracted: false,
        project_id_url_match: false,
        resolution_success: false,
        stage: "collector_project_identity_navigation_tab_update"
      });
  }
  if (isCollectorWindowTab && changeInfo?.status === "loading") {
    contentScriptReadyTabs.delete(tabId);
    collectorWindowLifecycle("WaitingContentScript", {
      windowId: collectorWindowState.windowId,
      tabId,
      currentProjectId: collectorWindowState.currentProjectId
    });
  }
  if (isCollectorWindowTab
    && (changeInfo?.discarded === true || changeInfo?.frozen === true)) {
    markCollectorRequestMediumLost(
      tabId,
      tab?.windowId,
      changeInfo.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen");
    collectorWindowLifecycle("Recoverable", {
      windowId: collectorWindowState.windowId,
      tabId,
      currentProjectId: null,
      projectIndex: -1
    });
    diagnostic("collector tab recovery requested", {
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      target_tab_id: tabId,
      tab_active: tab?.active === true,
      tab_discarded: tab?.discarded === true,
      tab_frozen: tab?.frozen === true,
      tab_auto_discardable: tab?.autoDiscardable,
      status: "requested",
      error_code: changeInfo.discarded === true ? "collector_tab_discarded" : "collector_tab_frozen",
      stage: "collector_tab_state_changed"
    });
  }
  if (isManagedExecutionTab
    && ["status", "active", "discarded", "frozen", "autoDiscardable", "url"]
      .some((key) => Object.prototype.hasOwnProperty.call(changeInfo || {}, key))) {
    recordManagedTabLifecycleTelemetry("tabs_on_updated", {
      status: "observed",
      stage: "tabs_on_updated"
    }, tabId, tab);
  }
  if (isManagedExecutionTab
    && (changeInfo?.discarded === true || changeInfo?.frozen === true)) {
    diagnostic("managed execution tab recovery requested", {
      ...managedTabTrace({ target_tab_id: tabId }),
      status: "requested",
      error_code: changeInfo.discarded === true ? "managed_tab_discarded" : "managed_tab_frozen",
      stage: "managed_execution_tab_state_changed"
    });
    clearManagedTabState("PreparingTab");
    void scheduleManagedMediumRecovery(tabId, tab.windowId, "managed_tab_state_changed");
    return;
  }
  if (isManagedExecutionTab
    && changeInfo?.status === "loading") {
    contentScriptReadyTabs.delete(tabId);
    managedTabLifecycle("WaitingContentScript", {
      tabId,
      contentReady: false,
      conversationReady: false,
      composerReady: false,
      watcherReady: false
    });
    diagnostic("managed tab loading", {
      target_tab_id: tabId,
      status: "pending",
      stage: "managed_tab_loading"
    });
  }
  if (changeInfo?.status === "complete") {
    if (isManagedExecutionTab) {
      managedTabLifecycle("WaitingContentScript", {
        tabId,
        contentReady: false,
        conversationReady: false,
        composerReady: false,
        watcherReady: false
      });
    }
    void recoverPendingHandoffSendsForTab(tabId);
    void rearmResponseWatchesForTab(tabId);
  }
  if (isManagedExecutionTab) {
    void enforceManagedExecutionTab(tab, {
      status: "observed",
      stage: "tabs_on_updated_enforce"
    }).catch((error) => {
      diagnostic("managed execution tab state enforcement failed", {
        ...managedTabTrace({ target_tab_id: tabId }),
        error_code: error?.code || "managed_execution_tab_state_failed",
        status: "error",
        stage: error?.stage || "tabs_on_updated_enforce"
      });
    });
  }
});

chrome.tabs.onCreated?.addListener?.((tab) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || tab?.windowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab created in managed window", {
    status: "observed",
    stage: "collector_tabs_on_created",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tab?.id,
    event_window_id: tab?.windowId,
    tab_active: tab?.active === true,
    tab_discarded: tab?.discarded === true,
    tab_frozen: tab?.frozen === true,
    tab_auto_discardable: tab?.autoDiscardable,
    tab_status: tab?.status
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tab?.id,
    event_window_id: tab?.windowId,
    stage: "collector_tabs_on_created"
  });
});

chrome.tabs.onAttached?.addListener?.((tabId, attachInfo) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || attachInfo?.newWindowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab attached to managed window", {
    status: "observed",
    stage: "collector_tabs_on_attached",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tabId,
    event_window_id: attachInfo?.newWindowId
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tabId,
    event_window_id: attachInfo?.newWindowId,
    stage: "collector_tabs_on_attached"
  });
});

chrome.tabs.onDetached?.addListener?.((tabId, detachInfo) => {
  if (!Number.isSafeInteger(collectorWindowState.windowId)
    || detachInfo?.oldWindowId !== collectorWindowState.windowId) return;
  diagnostic("collector tab detached from managed window", {
    status: "observed",
    stage: "collector_tabs_on_detached",
    collector_window_id: collectorWindowState.windowId,
    collector_tab_id: collectorWindowState.tabId,
    event_tab_id: tabId,
    event_window_id: detachInfo?.oldWindowId
  });
  void queueCollectorTabTopologyRepair({
    event_tab_id: tabId,
    event_window_id: detachInfo?.oldWindowId,
    stage: "collector_tabs_on_detached"
  });
});

chrome.tabs.onActivated?.addListener?.((activeInfo) => {
  const hasCollectorWindow = Number.isSafeInteger(collectorWindowState.windowId);
  if (hasCollectorWindow) {
    diagnostic("collector tab activated", {
      status: "observed",
      stage: "collector_tabs_on_activated",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      target_tab_id: activeInfo?.tabId,
      event_tab_id: activeInfo?.tabId,
      event_window_id: activeInfo?.windowId,
      tab_active: activeInfo?.windowId === collectorWindowState.windowId
        && activeInfo?.tabId === collectorWindowState.tabId
    });
    if (activeInfo?.windowId === collectorWindowState.windowId
      && activeInfo?.tabId !== managedTabState.tabId) {
      diagnostic("collector tab activation restore requested", {
        collector_window_id: collectorWindowState.windowId,
        collector_tab_id: collectorWindowState.tabId,
        target_tab_id: activeInfo?.tabId,
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId,
        status: "requested",
        stage: "collector_tab_activation_restore"
      });
      void queueCollectorTabTopologyRepair({
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId,
        stage: "collector_tab_activation_restore"
      });
    }
  }
  if (!Number.isSafeInteger(managedTabState.tabId)) return;
  recordManagedTabLifecycleTelemetry("tabs_on_activated", {
    status: "observed",
    stage: "tabs_on_activated",
    event_tab_id: activeInfo?.tabId,
    event_window_id: activeInfo?.windowId
  }, managedTabState.tabId, null, activeInfo?.windowId);
  if (activeInfo?.windowId === managedTabState.executionWindowId
    && activeInfo?.tabId !== managedTabState.tabId
    && activeInfo?.tabId !== collectorWindowState.tabId
    && !collectorCollectionIsInFlight()
    && typeof chrome.tabs?.get === "function") {
    diagnostic("managed execution tab activation restored", {
      ...managedTabTrace({
        event_tab_id: activeInfo?.tabId,
        event_window_id: activeInfo?.windowId
      }),
      status: "requested",
      stage: "managed_execution_tab_activation_restore"
    });
    chrome.tabs.get(managedTabState.tabId)
      .then((tab) => enforceManagedExecutionTab(tab, {
        status: "restored",
        stage: "managed_execution_tab_activation_restore"
      }))
      .catch((error) => {
        diagnostic("managed execution tab activation restore failed", {
          ...managedTabTrace({ target_tab_id: managedTabState.tabId }),
          error_code: error?.code || "managed_execution_tab_state_failed",
          status: "error",
          stage: "managed_execution_tab_activation_restore"
        });
      });
  }
});

chrome.windows?.onBoundsChanged?.addListener?.((window) => {
  if (!window || window.id !== collectorWindowState.windowId) return;
  void recordCollectorPresentationPhase("bounds_changed", {
    request_id: collectorWindowState.requestId,
    event_window_id: window.id
  }, {
    windowState: normalizeChromeWindowState(window.state),
    focused: window.focused === true,
    tabActive: false,
    discarded: false,
    tabStatus: "unknown"
  });
});

chrome.windows?.onFocusChanged?.addListener?.((windowId) => {
  const hasCollectorWindow = Number.isSafeInteger(collectorWindowState.windowId);
  if (hasCollectorWindow) {
    diagnostic("collector window focus changed", {
      status: "observed",
      stage: "collector_windows_on_focus_changed",
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: collectorWindowState.tabId,
      collector_window_focused: windowId === collectorWindowState.windowId,
      event_window_id: windowId
    });
    void recordCollectorPresentationPhase("focus_changed", {
      request_id: collectorWindowState.requestId,
      event_window_id: windowId
    });
    if (windowId === collectorWindowState.windowId
      && typeof chrome.windows?.get === "function") {
      void getCollectorWindow(windowId)
        .then((window) => makeCollectorWindowUsable(window, {
          event_window_id: windowId,
          stage: "collector_window_focus_restore"
        }))
        .then(() => queueCollectorTabTopologyRepair({
          event_window_id: windowId,
          stage: "collector_window_focus_restore"
        }))
        .catch((error) => {
          diagnostic("collector window focus restoration failed", {
            collector_window_id: collectorWindowState.windowId,
            collector_tab_id: collectorWindowState.tabId,
            event_window_id: windowId,
            status: "error",
            error_code: error?.code || "collector_window_focus_restore_failed",
            stage: "collector_window_focus_restore"
          });
        });
    }
  }
  if (!Number.isSafeInteger(managedTabState.tabId)
    && !Number.isSafeInteger(managedTabState.executionWindowId)) return;
  recordManagedTabLifecycleTelemetry("windows_on_focus_changed", {
    status: "observed",
    stage: "windows_on_focus_changed",
    event_window_id: windowId
  }, managedTabState.tabId, null, windowId);
  if (windowId === managedTabState.executionWindowId
    && typeof chrome.windows?.get === "function") {
    diagnostic("managed execution window focus restoration requested", {
      ...managedTabTrace({ event_window_id: windowId }),
      status: "requested",
      stage: "execution_window_focus_restore"
    });
    void getManagedExecutionWindow(windowId)
      .then((window) => makeManagedExecutionWindowUsable(window, {
        event_window_id: windowId,
        stage: "execution_window_focus_restore"
      }))
      .catch((error) => {
        diagnostic("managed execution window focus restoration failed", {
          ...managedTabTrace({ event_window_id: windowId }),
          status: "error",
          error_code: error?.code || "execution_window_focus_restore_failed",
          stage: "execution_window_focus_restore"
        });
      });
  }
});

chrome.tabs.onRemoved?.addListener?.((tabId, removeInfo) => {
  if (removeInfo?.isWindowClosing === true) {
    failResponseWatchesForClosedTab(tabId);
  }
  if (tabId === collectorWindowState.tabId) {
    markCollectorRequestMediumLost(tabId, removeInfo?.windowId, "collector_tab_removed");
  }
  if (tabId === collectorWindowState.tabId) {
    collectorWindowState = {
      ...collectorWindowState,
      tabId: null,
      lifecycle: "Recoverable"
    };
    void persistCollectorWindowState();
    diagnostic("collector tab removed", {
      status: "pending",
      stage: "collector_tab_removed",
      target_tab_id: tabId,
      collector_window_id: collectorWindowState.windowId,
      collector_tab_id: tabId,
      collector_window_exists: true
    });
  }
  if (Number.isSafeInteger(collectorWindowState.windowId)
    && removeInfo?.windowId === collectorWindowState.windowId
    && removeInfo?.isWindowClosing !== true) {
    void queueCollectorTabTopologyRepair({
      event_tab_id: tabId,
      event_window_id: removeInfo.windowId,
      stage: "collector_tab_removed"
    });
  }
  forgetManagedExecutionTabId(tabId);
  if (tabId !== managedTabState.tabId) {
    for (const [requestId, binding] of managedExecutionRequestBindings) {
      if (binding.targetTabId === tabId) managedExecutionRequestBindings.delete(requestId);
    }
    return;
  }
  for (const [requestId, binding] of managedExecutionRequestBindings) {
    if (binding.targetTabId === tabId) managedExecutionRequestBindings.delete(requestId);
  }
  contentScriptReadyTabs.delete(tabId);
  recordManagedTabLifecycleTelemetry("tabs_on_removed", {
    status: "error",
    error_code: "managed_tab_closed",
    stage: "tabs_on_removed",
    managed_tab_exists: false
  }, tabId, null, removeInfo?.windowId);
  diagnostic("managed tab removed", {
    ...managedTabTrace({ target_tab_id: tabId }),
    status: "error",
    error_code: "managed_tab_closed",
    stage: "managed_tab_removed"
  });
  clearManagedTabState("Failed");
  void scheduleManagedMediumRecovery(
    tabId,
    removeInfo?.windowId,
    removeInfo?.isWindowClosing === true ? "execution_window_removed" : "managed_tab_removed");
});

chrome.windows?.onRemoved?.addListener?.((windowId) => {
  if (windowId === collectorWindowState.windowId) {
    markCollectorRequestMediumLost(null, windowId, "collector_window_removed");
    const collectorTabId = collectorWindowState.tabId;
    const instanceId = collectorWindowState.instanceId;
    const managedGeneration = collectorWindowState.managedGeneration;
    const managedAt = collectorWindowState.managedAt;
    collectorWindowState = {
      ...defaultCollectorWindowState,
      instanceId,
      managedGeneration,
      managedAt
    };
    void persistCollectorWindowState();
    diagnostic("collector window removed", {
      status: "pending",
      stage: "collector_window_removed",
      collector_window_id: windowId,
      collector_tab_id: collectorTabId,
      collector_window_exists: false,
      target_tab_id: collectorTabId
    });
  }
  if (windowId !== managedTabState.executionWindowId
    && !managedExecutionOwnedWindowIds.has(windowId)) return;
  managedExecutionOwnedWindowIds.delete(windowId);
  managedExecutionWindowInitialTabs.delete(windowId);
  if (windowId !== managedTabState.executionWindowId) return;
  const managedTabId = managedTabState.tabId;
  recordManagedTabLifecycleTelemetry("windows_on_removed", {
    status: "error",
    error_code: "execution_window_closed",
    stage: "windows_on_removed",
    event_window_id: windowId,
    managed_tab_exists: false
  }, managedTabId, null, windowId);
  diagnostic("managed execution window removed", {
    ...managedTabTrace({
      target_tab_id: managedTabId,
      event_window_id: windowId
    }),
    status: "error",
    error_code: "execution_window_closed",
    stage: "execution_window_removed"
  });
  void scheduleManagedMediumRecovery(managedTabId, windowId, "execution_window_removed");
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === COLLECTOR_PROJECT_IDENTITY_TELEMETRY_MESSAGE_TYPE) {
    handleCollectorProjectIdentityTelemetryFromContent(message, _sender)
      .then(sendResponse)
      .catch(() => sendResponse({
        ok: false,
        error: "collector_project_identity_telemetry_relay_failed"
      }));
    return true;
  }
  if (message?.type === COLLECTOR_PROJECT_CHAT_TELEMETRY_MESSAGE_TYPE) {
    handleCollectorProjectChatTelemetryFromContent(message, _sender)
      .then(sendResponse)
      .catch(() => sendResponse({
        ok: false,
        error: "collector_project_chat_telemetry_relay_failed"
      }));
    return true;
  }
  if (message?.type === CHATGPT_CONTEXT_RESULT_MESSAGE_TYPE) {
    handleContextResultFromContent(message, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "context_response_relay_failed" }));
    return true;
  }
  if (message?.type === CHATGPT_CONTEXT_CHANGED_MESSAGE_TYPE) {
    handleContextChangedFromContent(message, _sender)
      .then((forwarded) => sendResponse({ ok: forwarded }))
      .catch(() => sendResponse({ ok: false, error: "context_change_relay_failed" }));
    return true;
  }
  if (message?.type === ASSISTANT_RESPONSE_WATCH_TELEMETRY_MESSAGE_TYPE) {
    diagnostic(
      message.stage === "assistant_response_watch_failure_summary"
        ? "assistant response watch failure summary"
        : "assistant response watch summary",
      {
        request_id: message.request_id || message.requestId,
        session_id: message.session_id || message.sessionId,
        handoff_id: message.handoff_id || message.handoffId,
        boundary_id: message.boundary_id || message.boundaryId,
        target_tab_id: message.target_tab_id,
        target_tab_fingerprint: message.target_tab_fingerprint,
        watch_started_at_relative_ms: message.watch_started_at_relative_ms,
        send_confirmed_at_relative_ms: message.send_confirmed_at_relative_ms,
        assistant_observed_at_relative_ms: message.assistant_observed_at_relative_ms,
        streaming_started_at_relative_ms: message.streaming_started_at_relative_ms,
        completion_observed_at_relative_ms: message.completion_observed_at_relative_ms,
        total_watch_ms: message.total_watch_ms,
        absolute_timeout_ms: message.absolute_timeout_ms,
        inactivity_timeout_ms: message.inactivity_timeout_ms,
        hard_timeout_ms: message.hard_timeout_ms,
        poll_count: message.poll_count,
        meaningful_progress_count: message.meaningful_progress_count,
        last_progress_age_ms: message.last_progress_age_ms,
        text_growth_event_count: message.text_growth_event_count,
        response_remount_count: message.response_remount_count,
        streaming_state_change_count: message.streaming_state_change_count,
        thinking_state_observed: message.thinking_state_observed,
        generation_alive_observation_count: message.generation_alive_observation_count,
        document_visibility_state_at_start: message.document_visibility_state_at_start,
        document_hidden_observed: message.document_hidden_observed,
        tab_active_at_start: message.tab_active_at_start,
        window_focused_at_start: message.window_focused_at_start,
        timeout_triggered: message.timeout_triggered,
        timeout_kind: message.timeout_kind,
        assistant_streaming_at_failure: message.assistant_streaming_at_failure,
        assistant_generation_alive_at_failure: message.assistant_generation_alive_at_failure,
        response_node_present_at_failure: message.response_node_present_at_failure,
        completion_detected: message.completion_detected,
        final_status: message.final_status,
        error_code: message.error_code,
        status: message.status,
        stage: message.stage || "assistant_response_watch_summary"
      });
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === ASSISTANT_RESPONSE_RESULT_MESSAGE_TYPE) {
    // Keep the MV3 service worker event alive until the Review target check
    // and authenticated WebSocket relay have completed. Returning before the
    // async tab lookup can otherwise let the worker suspend and silently lose
    // a valid assistant.response.
    handleAssistantResponseFromContent(message, _sender)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false, error: "assistant_response_relay_failed" }));
    return true;
  }
  if (message?.type === HANDOFF_SEND_CONFIRMED_MESSAGE_TYPE) {
    handleHandoffSendConfirmedFromContent(message, _sender)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false, error: "handoff_confirmation_relay_failed" }));
    return true;
  }

  const operation = (async () => {
    await stateReady;
    switch (message?.type) {
      case "GET_STATE":
        return { ok: true, state };
      case "CONTENT_SCRIPT_READY":
        if (Number.isSafeInteger(_sender?.tab?.id)) {
          const readyTabId = _sender.tab.id;
          const wasReady = contentScriptReadyTabs.has(readyTabId);
          const efficiencyPending = [...contextRequests.values()]
            .find((candidate) => candidate?.tabId === readyTabId);
          if (efficiencyPending) {
            recordCollectorProjectDiscoveryEfficiencyObservedEvent(
              efficiencyPending.requestId,
              wasReady ? "contentScriptReconnectCount" : "contentScriptBootCount");
          }
          const context = normalizeCurrentContext(message?.context);
          contentScriptReadyTabs.set(readyTabId, {
            readyAt: Date.now(),
            context,
            collectorIdentity: normalizeCollectorIdentity(message)
          });
          diagnostic("content script ready", {
            target_tab_id: readyTabId,
            status: "ready",
            stage: "content_script_ready"
          });
          const identityNavigationPending = collectorProjectIdentityPendingForTab(readyTabId);
          if (identityNavigationPending) {
            recordCollectorProjectIdentityNavigationTelemetry(
              "collector project identity content script ready",
              identityNavigationPending,
              {
                project_index: identityNavigationPending.identityNavigationProjectIndex,
                navigation_wait_started: true,
                content_script_reloaded: !wasReady,
                tab_update_observed: !wasReady,
                navigation_timeout: false,
                stage: "collector_project_identity_content_script_ready"
              });
          }
          recordManagedTabLifecycleTelemetry(
            wasReady ? "content_script_reconnect" : "content_script_ready",
            {
              status: "ready",
              stage: wasReady ? "content_script_reconnect" : "content_script_ready",
              content_script_alive: true
            },
            readyTabId,
            _sender.tab);
          if (readyTabId === managedTabState.tabId) {
            managedTabLifecycle("WaitingContentScript", {
              tabId: readyTabId,
              contentReady: true
            });
          }
          void recoverPendingHandoffSendsForTab(readyTabId);
          void rearmResponseWatchesForTab(readyTabId);
        }
        return { ok: true, state };
      case "CONNECT":
        return { ok: true, state: await connect() };
      case "PAIR":
        return { ok: true, state: await pair(message.pairingCode) };
      case "DISCONNECT":
        return { ok: true, state: await disconnect() };
      case "PING":
        return { ok: true, pong: await ping(), state };
      default:
        return { ok: false, error: "unsupported_message" };
    }
  })();

  operation.then(sendResponse).catch((error) => sendResponse({ ok: false, error: errorMessage(error), state }));
  return true;
});

ensureReconnectAlarm();
connect().catch(() => {});
