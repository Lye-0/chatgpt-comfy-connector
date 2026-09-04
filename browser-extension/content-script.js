// The Content Script is the only Extension layer allowed to inspect or
// mutate the ChatGPT page. It never opens a localhost connection; all
// transport/authentication remains in background.js.
(() => {
  "use strict";

  const statusEventName = "chatgpt-comfy-connector:bridge-status";
  const handoffMessageType = "HANDOFF_SEND";
  const contextRequestMessageType = "GET_CHATGPT_CONTEXT";
  const collectorViewportRequestMessageType = "GET_COLLECTOR_VIEWPORT";
  const collectorRootHydrationRequestMessageType = "GET_COLLECTOR_ROOT_HYDRATION";
  const collectorProjectIdentityTelemetryMessageType = "COLLECTOR_PROJECT_IDENTITY_TELEMETRY";
  const collectorProjectChatTelemetryMessageType = "COLLECTOR_PROJECT_CHAT_TELEMETRY";
  const contextChangedMessageType = "CHATGPT_CONTEXT_CHANGED";
  const responseWatchMessageType = "WATCH_ASSISTANT_RESPONSE";
  const executionReadyMessageType = "CHATGPT_EXECUTION_READY";
  const cancelResponseWatchMessageType = "CANCEL_ASSISTANT_RESPONSE_WATCH";
  const responseResultMessageType = "ASSISTANT_RESPONSE_RESULT";
  const handoffSendConfirmedMessageType = "HANDOFF_SEND_CONFIRMED";
  const handoffAcceptanceCheckMessageType = "CHECK_HANDOFF_SENT";
  const reviewMediaAttachBeginMessageType = "REVIEW_MEDIA_ATTACH_BEGIN";
  const reviewMediaAttachChunkMessageType = "REVIEW_MEDIA_ATTACH_CHUNK";
  const reviewMediaAttachEndMessageType = "REVIEW_MEDIA_ATTACH_END";
  const sendAcceptanceTimeoutMs = 8000;
  const newConversationBindingTimeoutMs = 5000;
  const composerStateTimeoutMs = 1500;
  // A newly opened Conversation can reach document.readyState=complete before
  // ChatGPT mounts its React composer. Wait for that concrete composer rather
  // than treating the transient DOM as a permanent selector failure.
  const composerMountTimeoutMs = 20000;
  const composerPollIntervalMs = 100;
  // ChatGPT can keep the composer Send control disabled while a Review video
  // is being processed even after the attachment chip is visible.  Review
  // sends therefore get a bounded readiness window of their own; normal
  // Bootstrap sends keep the shorter interactive timeout.
  const reviewComposerStateTimeoutMs = 60000;
  const handoffAcceptancePollIntervalMs = 100;
  const attachmentControlTimeoutMs = 1500;
  const attachmentVerificationTimeoutMs = 15000;
  const maxMediaBytes = 512 * 1024 * 1024;
  const maxMediaChunkBase64Length = 96 * 1024;
  const responseTimeoutMs = 120000;
  const responseStabilityMs = 900;
  const responsePollIntervalMs = 100;
  // Lifecycle telemetry is intentionally sparse.  The watcher itself still
  // polls at responsePollIntervalMs for functional detection, but diagnostics
  // are emitted at most once per state transition or ten seconds.
  const responseLifecycleTelemetryIntervalMs = 10000;
  const locators = globalThis.ChatGptComfyConnectorLocators;
  const responseAnchors = new Map();
  const responseWatchers = new Map();
  const mediaTransfers = new Map();
  let contextMonitorTimer = null;
  let lastContextFingerprint = null;
  // The browser page is the source of truth for the visible attachment. This
  // short-lived map only remembers which authenticated media request was
  // verified during the current content-script lifetime; the DOM check below
  // is still required immediately before every Review send.
  const verifiedReviewAttachments = new Map();

  // Keep page diagnostics limited to request identity, stage, and the
  // outcome. The session token and Handoff body are never logged by the
  // Content Script.
  function collectorDebugTelemetryEnabled() {
    return globalThis.__CHATGPT_COMFY_CONNECTOR_DEBUG_TELEMETRY__ === true;
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

  function diagnostic(eventName, fields = {}) {
    const safe = {};
    for (const key of [
      "request_id",
      "session_id",
      "handoff_id",
      "boundary_id",
      "status",
      "error_code",
      "stage",
      "media_id",
      "iteration",
      "target_tab_id",
      "conversation_id",
      "conversation_url",
      "project_id",
      "current_project_id",
      "content_ready",
      "conversation_ready",
      "composer_ready",
      "watcher_ready",
      "composer_type",
      "extracted_length",
      "protocol_found",
      "handoff_id_found",
      "boundary_id_found",
      "document_visibility_state",
      "document_hidden",
      "document_was_discarded",
      "content_script_alive",
      "watcher_state",
      "assistant_state",
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
      "refresh_generation",
      "navigation_generation",
      "collector_tab_id",
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
      "unresolved_reason",
      "exit_reason",
      "internal_reason",
      "navigation_failure_reason",
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
      "current_project_identity_source",
      "current_project_identity_discovery_index",
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
      "scroll_position_changed",
      "reached_end",
      "scan_iteration",
      "failure_stage",
      "exception_name",
      "exception_reason",
      "project_chat_collection_error_reason",
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
      "title_observed_chat_count"
    ]) {
      if (typeof fields[key] === "string" && fields[key].length <= 128) safe[key] = fields[key];
      if (typeof fields[key] === "boolean") safe[key] = fields[key];
      if (Number.isSafeInteger(fields[key]) && fields[key] >= 0) safe[key] = fields[key];
    }
    if (!collectorDebugTelemetryEnabled()
      && isHighVolumeCollectorTelemetryStage(fields?.stage)) return;
    try {
      console.info(`[ChatGPT Comfy Connector] ${eventName}`, safe);
    } catch (_) {
      // Console access must never affect DOM automation.
    }
  }

  // chrome.runtime.sendMessage can throw synchronously when an older content
  // script survives an Extension reload. Keep that lifecycle event from
  // becoming an uncaught page error; message delivery is best effort and the
  // authenticated Background remains the transport owner.
  function sendRuntimeMessage(message, onFailure = null) {
    let pending;
    try {
      pending = chrome.runtime.sendMessage(message);
    } catch (_) {
      try { onFailure?.(); } catch (_) { }
      return Promise.resolve(undefined);
    }
    return Promise.resolve(pending).catch(() => {
      try { onFailure?.(); } catch (_) { }
      return undefined;
    });
  }

  function traceForMessage(message, fields = {}) {
    return {
      request_id: message?.requestId ?? message?.request_id,
      session_id: message?.sessionId ?? message?.session_id,
      handoff_id: message?.handoffId ?? message?.handoff_id,
      boundary_id: message?.boundaryId ?? message?.boundary_id,
      target_tab_id: message?.targetTabId ?? message?.target_tab_id,
      ...fields
    };
  }

  const collectorProjectIdentityTelemetryKeys = [
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
    "navigation_generation_match",
    "navigation_started_for_project",
    "navigation_completed_for_project",
    "navigation_target_verified_for_project",
    "navigation_owned_by_current_project",
    "navigation_owner_project_index",
    "stale_navigation_result_rejected",
    "current_url_used_as_identity",
    "navigation_target_verified",
    "project_url_pattern_valid",
    "project_id_extracted",
    "project_id_url_match",
    "resolution_success",
    "unresolved_reason",
    "exit_reason",
    "internal_reason",
    "navigation_failure_reason",
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
    "catalog_reused",
    "relocation_skipped_connected_row"
  ];

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
    "title_candidate_count",
    "title_character_count",
    "row_text_character_count",
    "title_element_found_count",
    "preview_element_found_count",
    "title_extraction_success_count",
    "title_fallback_used_count",
    "title_observed_chat_count",
    "error_code",
    "failure_stage",
    "internal_reason",
    "exception_name",
    "exception_reason",
    "project_chat_collection_error_reason"
  ];

  function collectorProjectIdentityTelemetryFor(message, event = {}) {
    const result = {
      type: collectorProjectIdentityTelemetryMessageType,
      request_id: message?.requestId || message?.request_id || ""
    };
    if (typeof event.stage === "string" && event.stage.length <= 128) {
      result.stage = event.stage;
    }
    if (Number.isSafeInteger(message?.refreshGeneration)) {
      result.refresh_generation = message.refreshGeneration;
    }
    if (typeof message?.navigationGeneration === "string"
      && message.navigationGeneration.length <= 128) {
      result.navigation_generation = message.navigationGeneration;
    }
    if (Number.isSafeInteger(message?.collectorTabId)) {
      result.collector_tab_id = message.collectorTabId;
    }
    for (const key of collectorProjectIdentityTelemetryKeys) {
      if (typeof event[key] === "boolean") result[key] = event[key];
      else if (Number.isSafeInteger(event[key]) && event[key] >= 0) result[key] = event[key];
      else if (typeof event[key] === "string" && event[key].length <= 128) result[key] = event[key];
    }
    if (!Number.isSafeInteger(result.total_projects)) {
      const fromMessage = Number.isSafeInteger(message?.totalProjects)
        ? message.totalProjects
        : (Array.isArray(message?.identityCatalog) ? message.identityCatalog.length : null);
      if (Number.isSafeInteger(fromMessage) && fromMessage >= 0) result.total_projects = fromMessage;
    }
    if (!Number.isSafeInteger(result.identity_catalog_count)
      && Array.isArray(message?.identityCatalog)) {
      result.identity_catalog_count = message.identityCatalog.length;
    }
    return result;
  }

  function emitCollectorProjectIdentityTelemetry(message, event = {}) {
    const telemetry = collectorProjectIdentityTelemetryFor(message, event);
    diagnostic("collector project identity navigation", traceForMessage(message, telemetry));
    // This is best-effort metadata only. A full navigation may destroy the
    // current Content Script immediately after row.click(), so the Background
    // also observes the exact Collector Tab through tabs.onUpdated.
    void sendRuntimeMessage(telemetry);
  }

  function collectorProjectChatTelemetryFor(message, event = {}) {
    const result = {
      type: collectorProjectChatTelemetryMessageType,
      request_id: message?.requestId || message?.request_id || ""
    };
    if (typeof event.stage === "string" && event.stage.length <= 128) {
      result.stage = event.stage;
    }
    if (Number.isSafeInteger(message?.refreshGeneration)) {
      result.refresh_generation = message.refreshGeneration;
    }
    if (typeof message?.navigationGeneration === "string"
      && message.navigationGeneration.length <= 128) {
      result.navigation_generation = message.navigationGeneration;
    }
    if (Number.isSafeInteger(message?.collectorTabId)) {
      result.collector_tab_id = message.collectorTabId;
    }
    for (const key of collectorProjectChatTelemetryKeys) {
      if (typeof event[key] === "boolean") result[key] = event[key];
      else if (Number.isSafeInteger(event[key]) && event[key] >= 0) result[key] = event[key];
      else if (typeof event[key] === "string" && event[key].length <= 128) result[key] = event[key];
    }
    return result;
  }

  function emitCollectorProjectChatTelemetry(message, event = {}) {
    const telemetry = collectorProjectChatTelemetryFor(message, event);
    diagnostic("collector project chat telemetry", traceForMessage(message, telemetry));
    void sendRuntimeMessage(telemetry);
  }

  function contentLifecycleTrace(watcher = null, fields = {}) {
    const trace = {
      ...(watcher ? traceForMessage({
        requestId: watcher.requestId,
        sessionId: watcher.sessionId,
        handoffId: watcher.handoffId,
        boundaryId: watcher.boundaryId,
        targetTabId: watcher.targetTabId
      }) : {}),
      content_script_alive: true,
      document_visibility_state: typeof document.visibilityState === "string"
        ? document.visibilityState
        : "unknown",
      watcher_state: watcher && !watcher.finished ? "armed" : "idle",
      ...fields
    };
    if (typeof document.hidden === "boolean") trace.document_hidden = document.hidden;
    if (typeof document.wasDiscarded === "boolean") trace.document_was_discarded = document.wasDiscarded;
    return trace;
  }

  function responseLifecycleTrace(watcher, fields = {}) {
    return contentLifecycleTrace(watcher, fields);
  }

  function watcherForLifecycleTelemetry() {
    return responseWatchers.values().next().value || null;
  }

  function emitResponseLifecycleTelemetry(watcher, assistantState, stage = "response_waiting_periodic", force = false) {
    if (!watcher) return;
    const now = Date.now();
    const changed = watcher.lifecycleTelemetryState !== assistantState;
    if (!force
      && !changed
      && now - (watcher.lifecycleTelemetryAt || 0) < responseLifecycleTelemetryIntervalMs) return;
    watcher.lifecycleTelemetryState = assistantState;
    watcher.lifecycleTelemetryAt = now;
    diagnostic("response lifecycle telemetry", responseLifecycleTrace(watcher, {
      status: assistantState === "completed" ? "completed" : "waiting",
      stage,
      assistant_state: assistantState
    }));
  }

  function assistantStateForResult(watcher, result) {
    if (result?.status === "received") return "completed";
    if (result?.errorCode === "response_stream_interrupted") return "streaming";
    if (watcher?.candidate && watcher.candidateText?.trim()) return "stable_wait";
    return "not_detected";
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

  function responseResultFor(message, status, errorCode, text, stage, payload) {
    const result = {
      request_id: message?.requestId || "",
      session_id: message?.sessionId || "",
      handoff_id: message?.handoffId || "",
      boundary_id: message?.boundaryId || "",
      status
    };
    if (payload) result.payload = payload;
    if (errorCode) result.error_code = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    return result;
  }

  function notifyHandoffSendConfirmed(message, result) {
    // This is a metadata-only lifecycle signal. It is intentionally separate
    // from the tabs.sendMessage response because a ChatGPT navigation can
    // destroy that response channel after the user message was accepted.
    // This notification is a best-effort, metadata-only side channel.  Do not
    // await the Background response here: ChatGPT can replace this document
    // immediately after the user message is accepted, which can leave the
    // runtime-message Promise pending while the tabs.sendMessage request is
    // waiting for handleHandoffSend() to return.  The Background races this
    // notification with the normal response and can recover it from the
    // marker-bearing user message after a navigation.
    void sendRuntimeMessage({
      type: handoffSendConfirmedMessageType,
      requestId: message?.requestId,
      sessionId: message?.sessionId,
      handoffId: message?.handoffId,
      boundaryId: message?.boundaryId,
      status: "sent",
      stage: result?.stage || "user_message_correlated",
      ...(result?.current_context ? { current_context: result.current_context } : {})
    });
  }

  async function handleHandoffAcceptanceCheck(message) {
    if (!locators || !locators.isChatGptPage?.()) {
      return resultFor(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    }
    if (!hasRequiredInputMarkers({
      protocol: message?.protocol,
      handoffId: message?.handoffId,
      boundaryId: message?.boundaryId
    })) {
      return resultFor(message, "error", "handoff_confirmation_not_correlated", "Handoffの確認に必要な識別子がありません。", "handoff_acceptance_check");
    }

    const deadline = Date.now() + sendAcceptanceTimeoutMs;
    let anchor = null;
    // CONTENT_SCRIPT_READY can precede React hydration in a newly opened Chat
    // tab. Poll only for the exact marker-bearing user message; this is a
    // read-only acceptance recovery and never posts the Handoff again.
    while (Date.now() < deadline) {
      anchor = locators.findUserMessageWithCorrelation?.(document, {
        protocol: message.protocol,
        handoffId: message.handoffId,
        boundaryId: message.boundaryId
      }) || null;
      if (anchor) break;
      await wait(handoffAcceptancePollIntervalMs);
    }
    if (!anchor) {
      return resultFor(message, "error", "handoff_not_sent", "今回のHandoffに対応するChatGPT user messageが見つかりません。", "handoff_acceptance_not_found");
    }

    const beforeAssistantMessages = locators.captureAssistantMessageSnapshot?.(document)
      || { count: 0, elements: new Set() };
    responseAnchors.set(responseCorrelationKey(message), {
      anchor,
      assistantElements: beforeAssistantMessages.elements,
      createdAt: Date.now()
    });
    diagnostic("handoff acceptance found", {
      ...traceForMessage(message),
      status: "sent",
      stage: "handoff_acceptance_recovered"
    });
    const result = resultFor(message, "sent", null, null, "user_message_already_correlated");
    result.current_context = await readCurrentContextAfterHandoff(message);
    return result;
  }

  function contextResultFor(message, status, errorCode, text, stage, data = {}) {
    const result = {
      type: "CHATGPT_CONTEXT_RESULT",
      requestId: message?.requestId || message?.request_id || "",
      mode: message?.mode === "current" ? "current" : "list",
      status,
      projects: Array.isArray(data.projects) ? data.projects : [],
      conversations: Array.isArray(data.conversations) ? data.conversations : [],
      current: data.current || null
    };
    if (Array.isArray(data.provisional_observations)) {
      result.provisional_observations = data.provisional_observations;
    }
    if (Number.isSafeInteger(message?.refreshGeneration)) {
      result.refresh_generation = message.refreshGeneration;
    }
    if (typeof message?.navigationGeneration === "string"
      && message.navigationGeneration.length <= 128) {
      result.navigation_generation = message.navigationGeneration;
    }
    if (Number.isSafeInteger(message?.collectorTabId)) {
      result.collector_tab_id = message.collectorTabId;
    }
    if (errorCode) result.errorCode = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    if (Number.isSafeInteger(data.unresolved_project_count)) {
      result.unresolved_project_count = data.unresolved_project_count;
    }
    if (typeof data.project_discovery_source === "string"
      && data.project_discovery_source.length <= 128) {
      result.project_discovery_source = data.project_discovery_source;
    }
    for (const key of [
      "non_navigation_resolved_count",
      "navigation_resolved_count",
      "unresolved_count",
      "current_project_index",
      "project_index",
      "total_projects"
    ]) {
      if (Number.isSafeInteger(data[key])) result[key] = data[key];
    }
    for (const key of [
      "project_identity_resolution_started",
      "project_identity_resolution_completed",
      "navigation_target_verified",
      "project_url_pattern_valid",
      "project_id_url_match"
    ]) {
      if (typeof data[key] === "boolean") result[key] = data[key];
    }
    if (data.resolution_method === "dom" || data.resolution_method === "navigation") {
      result.resolution_method = data.resolution_method;
    }
    if ([
      "no_more_control",
      "no_progress",
      "scroll_exhausted",
      "timeout",
      "stagnation"
    ].includes(data.hydration_stop_reason)) {
      result.hydration_stop_reason = data.hydration_stop_reason;
    }
    for (const key of ["exit_reason", "internal_reason", "navigation_failure_reason"]) {
      if (typeof data[key] === "string" && data[key].length <= 128) result[key] = data[key];
    }
    for (const key of [
      "sidebar_scroll_top",
      "sidebar_scroll_height",
      "sidebar_client_height",
      "visible_project_rows",
      "discovered_project_count",
      "no_growth_count",
      "sidebar_restore_count",
      "root_catalog_build_count",
      "root_catalog_reuse_count",
      "root_catalog_build_ms",
      "root_hydration_scroll_wait_ms",
      "more_click_wait_ms",
      "total_dom_wait_ms",
      "dom_remount_count",
      "sidebar_scroll_attempt_count",
      "sidebar_scroll_position_change_count",
      "sidebar_scroll_stagnation_count",
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
      "project_candidate_rejected_child_chat_count",
      "project_candidate_rejected_non_project_count",
      "title_only_reconcile_attempt_count",
      "title_only_reconcile_rejected_count",
      "title_only_observation_preserved_count",
      "title_hint_used_count",
      "stable_evidence_reconcile_count",
      "ambiguous_same_title_reconcile_count",
      "provisional_observation_created_count",
      "provisional_observation_reused_count",
      "provisional_observation_count",
      "confirmed_logical_project_count_before_identity",
      "final_catalog_index_count",
      "visible_chat_count",
      "discovered_chat_count",
      "deduped_chat_count",
      "duplicate_chat_count",
      "scroll_iteration",
      "scroll_top",
      "scroll_height",
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
      "current_project_identity_discovery_index",
      "main_projectless_count",
      "main_custom_gpt_count",
      "main_candidate_from_verified_project_region_count",
      "chat_scroll_container_count",
      "main_descendant_count",
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
      "selected_scroll_client_height",
      "selected_scroll_height",
      "selected_scroll_distance_from_chat_list",
      "mutation_count",
      "mutation_quiet_ms",
      "scan_iteration",
      "title_candidate_count",
      "title_character_count",
      "row_text_character_count",
      "title_element_found_count",
      "preview_element_found_count",
      "title_extraction_success_count",
      "title_fallback_used_count",
      "title_observed_chat_count"
    ]) {
      if (Number.isSafeInteger(data[key])) result[key] = data[key];
    }
    for (const key of [
      "sidebar_can_scroll",
      "sidebar_at_bottom",
      "project_section_found",
      "sidebar_scroll_complete",
      "sidebar_scroll_container_found",
      "hydration_completed_with_more_visible",
      "hydration_completed_after_more_no_progress",
      "more_visible_at_hydration_complete",
      "more_enabled_at_hydration_complete",
      "more_clickable_at_hydration_complete",
      "project_page_ready",
      "current_project_id_verified",
      "current_project_identity_navigation_fallback_used",
      "chat_container_found",
      "main_found",
      "main_region_found",
      "chat_tab_found",
      "chat_list_found",
      "selected_scroll_container_found",
      "scroll_complete",
      "project_chat_collection_complete",
      "relevant_region_present",
      "scroll_position_changed",
      "reached_end",
      "title_element_found",
      "preview_element_found",
      "title_extraction_success",
      "title_differs_from_row_text",
      "title_fallback_used",
      "project_chat_hydration_completed",
      "project_chat_hydration_timeout",
      "project_chat_membership_inconsistent",
      "project_route_segment_detected",
      "project_route_has_slug",
      "project_id_normalization_applied",
      "raw_route_project_id_matches_normalized",
      "normalized_project_id_match",
      "main_mismatch_all_same_project_id",
      "current_project_identity_navigation_fallback_used"
    ]) {
      if (typeof data[key] === "boolean") result[key] = data[key];
    }
    for (const key of [
      "project_more_control_found",
      "project_more_control_has_href",
      "project_more_control_aria_controls_present",
      "project_virtualized_candidate"
    ]) {
      if (typeof data[key] === "boolean") result[key] = data[key];
    }
    for (const key of [
      "project_more_control_role",
      "project_more_control_aria_expanded"
    ]) {
      if (typeof data[key] === "string" && data[key].length <= 128) result[key] = data[key];
    }
    if (data.sidebar_scroll_direction === "down" || data.sidebar_scroll_direction === "none") {
      result.sidebar_scroll_direction = data.sidebar_scroll_direction;
    }
    for (const key of [
      "document_ready_state",
      "failure_stage",
      "internal_reason",
      "exception_name",
      "exception_reason",
      "project_chat_collection_error_reason",
      "current_project_identity_source",
      "main_mismatch_project_id",
      "project_id_normalization_source",
      "chat_title_source"
    ]) {
      if (typeof data[key] === "string" && data[key].length <= 128) result[key] = data[key];
    }
    for (const key of ["final_catalog_indices", "descriptor_added_after_first_snapshot_indices"]) {
      if (!Array.isArray(data[key])) continue;
      result[key] = data[key]
        .filter((value) => Number.isSafeInteger(value) && value >= 0)
        .slice(0, 5000);
    }
    return result;
  }

  const projectChatErrorCodes = new Set([
    "context_project_page_unavailable",
    "context_project_chat_dom_unavailable",
    "context_project_chats_incomplete",
    "context_project_chat_membership_mismatch",
    "context_response_invalid",
    "context_response_correlation_failed",
    "context_extraction_failed"
  ]);

  function safeProjectChatExceptionName(error) {
    const name = typeof error?.name === "string" ? error.name : "";
    return [
      "AbortError",
      "DOMException",
      "Error",
      "RangeError",
      "ReferenceError",
      "SyntaxError",
      "TypeError"
    ].includes(name) ? name : "Error";
  }

  function safeProjectChatExceptionReason(error) {
    const name = safeProjectChatExceptionName(error);
    const reasons = {
      AbortError: "abort_error",
      DOMException: "dom_exception",
      RangeError: "range_error",
      ReferenceError: "reference_error",
      SyntaxError: "syntax_error",
      TypeError: "type_error"
    };
    return reasons[name] || "unexpected_exception";
  }

  function projectChatFailureResult(message, error = null, overrides = {}) {
    const errorCode = projectChatErrorCodes.has(overrides.errorCode)
      ? overrides.errorCode
      : (projectChatErrorCodes.has(error?.code) ? error.code : "context_extraction_failed");
    const failureStage = typeof overrides.failureStage === "string"
      && overrides.failureStage.length <= 128
      ? overrides.failureStage
      : (typeof error?.stage === "string" && error.stage.length <= 128
        ? error.stage
        : "project_chat_collection");
    const exceptionName = error ? safeProjectChatExceptionName(error) : "none";
    const exceptionReason = error
      ? safeProjectChatExceptionReason(error)
      : (overrides.exceptionReason || "none");
    const telemetry = {
      project_index: Number.isSafeInteger(message?.projectIndex) ? message.projectIndex : 0,
      total_projects: Number.isSafeInteger(message?.totalProjects) ? message.totalProjects : 0,
      current_project_id: message?.projectId || message?.project_id,
      project_page_ready: overrides.projectPageReady,
      current_project_id_verified: overrides.currentProjectIdVerified,
      candidate_chat_link_count: overrides.candidateChatLinkCount,
      candidate_chat_count: overrides.candidateChatCount,
      candidate_from_main_count: overrides.candidateFromMainCount,
      candidate_from_sidebar_count: overrides.candidateFromSidebarCount,
      candidate_from_other_count: overrides.candidateFromOtherCount,
      matching_project_chat_link_count: overrides.matchingProjectChatLinkCount,
      matching_project_chat_count: overrides.matchingProjectChatCount,
      rejected_projectless_chat_count: overrides.rejectedProjectlessChatCount,
      rejected_other_project_chat_count: overrides.rejectedOtherProjectChatCount,
      chat_scroll_container_count: overrides.chatScrollContainerCount,
      main_found: overrides.mainFound,
      main_region_found: overrides.mainRegionFound,
      main_descendant_count: overrides.mainDescendantCount,
      chat_tab_found: overrides.chatTabFound,
      chat_list_found: overrides.chatListFound,
      chat_list_candidate_count: overrides.chatListCandidateCount,
      chat_row_candidate_count: overrides.chatRowCandidateCount,
      anchor_count: overrides.anchorCount,
      button_count: overrides.buttonCount,
      role_button_count: overrides.roleButtonCount,
      role_link_count: overrides.roleLinkCount,
      href_element_count: overrides.hrefElementCount,
      data_attribute_candidate_count: overrides.dataAttributeCandidateCount,
      candidate_scroll_container_count: overrides.candidateScrollContainerCount,
      scrollable_chat_candidate_count: overrides.scrollableChatCandidateCount,
      selected_scroll_container_found: overrides.selectedScrollContainerFound,
      selected_scroll_client_height: overrides.selectedScrollClientHeight,
      selected_scroll_height: overrides.selectedScrollHeight,
      selected_scroll_distance_from_chat_list: overrides.selectedScrollDistanceFromChatList,
      relevant_region_present: overrides.relevantRegionPresent,
      document_ready_state: overrides.documentReadyState,
      mutation_count: overrides.mutationCount,
      mutation_quiet_ms: overrides.mutationQuietMs,
      discovered_chat_count: overrides.discoveredChatCount || 0,
      deduped_chat_count: overrides.dedupedChatCount || 0,
      scan_iteration: overrides.scanIteration || 0,
      scroll_position_changed: overrides.scrollPositionChanged,
      reached_end: overrides.reachedEnd,
      error_code: errorCode,
      failure_stage: failureStage,
      internal_reason: overrides.internalReason || safeProjectChatExceptionReason(error),
      exception_name: exceptionName,
      exception_reason: exceptionReason,
      project_chat_collection_error_reason: overrides.internalReason
        || safeProjectChatExceptionReason(error),
      status: "error",
      stage: "collector_project_chat_collection_failed"
    };
    diagnostic("collector project chat collection failed", traceForMessage(message, telemetry));
    emitCollectorProjectChatTelemetry(message, telemetry);
    return contextResultFor(
      message,
      "error",
      errorCode,
      "ChatGPT Project内のChat一覧を取得できませんでした。",
      failureStage,
      telemetry);
  }

  function collectorViewportResultFor(message, status, errorCode, text, stage, data = {}) {
    const result = {
      type: "COLLECTOR_VIEWPORT_RESULT",
      requestId: message?.requestId || message?.request_id || "",
      status,
      content_inner_width: Number.isSafeInteger(data.content_inner_width)
        ? data.content_inner_width : 0,
      content_inner_height: Number.isSafeInteger(data.content_inner_height)
        ? data.content_inner_height : 0,
      sidebar_container_exists: data.sidebar_container_exists === true,
      project_section_exists: data.project_section_exists === true,
      project_row_locator_ready: data.project_row_locator_ready === true,
      desktop_layout: data.desktop_layout === true,
      sidebar_expected_visible: data.sidebar_expected_visible === true,
      sidebar_scroll_container_found: data.sidebar_scroll_container_found === true,
      sidebar_ready: data.sidebar_ready === true
    };
    if (errorCode) result.errorCode = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    return result;
  }

  async function handleGetCollectorViewport(message) {
    if (!locators || !locators.isChatGptPage?.()) {
      return collectorViewportResultFor(
        message,
        "error",
        "active_tab_not_chatgpt",
        "Collector TabはChatGPTではありません。",
        "collector_viewport_page_check");
    }
    try {
      const viewport = locators.getChatGptCollectorViewport?.(document);
      if (!viewport) {
        return collectorViewportResultFor(
          message,
          "error",
          "collector_viewport_unavailable",
          "Collector viewportを取得できませんでした。",
          "collector_viewport_extraction");
      }
      return collectorViewportResultFor(message, "ok", null, null, "collector_viewport_observed", viewport);
    } catch (_) {
      return collectorViewportResultFor(
        message,
        "error",
        "collector_viewport_unavailable",
        "Collector viewportの取得に失敗しました。",
        "collector_viewport_extraction");
    }
  }

  function collectorRootHydrationResultFor(message, status, errorCode, text, stage, data = {}) {
    const result = {
      type: "COLLECTOR_ROOT_HYDRATION_RESULT",
      requestId: message?.requestId || message?.request_id || "",
      status,
      refresh_generation: Number.isSafeInteger(message?.refreshGeneration)
        ? message.refreshGeneration : null,
      navigation_generation: typeof message?.navigationGeneration === "string"
        ? message.navigationGeneration.slice(0, 128) : "",
      collector_tab_id: Number.isSafeInteger(message?.collectorTabId)
        ? message.collectorTabId : null,
      expected_root_url: typeof message?.expectedRootUrl === "string"
        ? message.expectedRootUrl.slice(0, 2048) : "",
      root_hydration_started: true,
      root_hydration_completed: data.root_hydration_completed === true,
      root_hydration_timeout: data.root_hydration_timeout === true,
      hydration_wait_ms: Number.isSafeInteger(data.hydration_wait_ms)
        ? data.hydration_wait_ms : 0,
      hydration_poll_count: Number.isSafeInteger(data.hydration_poll_count)
        ? data.hydration_poll_count : 0,
      hydration_poll_wait_ms: Number.isSafeInteger(data.hydration_poll_wait_ms)
        ? data.hydration_poll_wait_ms : 0,
      hydration_poll_interval_ms: Number.isSafeInteger(data.hydration_poll_interval_ms)
        ? data.hydration_poll_interval_ms : 0,
      document_ready_state: typeof data.document_ready_state === "string"
        ? data.document_ready_state : "unknown",
      sidebar_root_present: data.sidebar_root_present === true,
      sidebar_scroll_container_present: data.sidebar_scroll_container_present === true,
      sidebar_shell_present: data.sidebar_shell_present === true,
      sidebar_sections_stable: data.sidebar_sections_stable === true,
      mutation_count: Number.isSafeInteger(data.mutation_count) ? data.mutation_count : 0,
      mutation_quiet_ms: Number.isSafeInteger(data.mutation_quiet_ms)
        ? data.mutation_quiet_ms : 0,
      root_url_verified: data.root_url_verified === true
    };
    if (errorCode) result.errorCode = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    return result;
  }

  async function handleGetCollectorRootHydration(message) {
    if (!locators || !locators.isChatGptPage?.()) {
      return collectorRootHydrationResultFor(
        message,
        "error",
        "active_tab_not_chatgpt",
        "Collector TabはChatGPTではありません。",
        "collector_root_hydration_page_check");
    }
    try {
      const state = await locators.waitForChatGptRootSidebarHydrationAsync?.(
        document,
        message?.expectedRootUrl || "https://chatgpt.com/",
        {
          timeoutMs: message?.timeoutMs,
          quietMs: message?.quietMs,
          pollMs: message?.pollMs
        });
      if (!state) {
        return collectorRootHydrationResultFor(
          message,
          "error",
          "collector_root_hydration_unavailable",
          "Root Sidebar hydration状態を取得できませんでした。",
          "collector_root_hydration_extraction");
      }
      const result = collectorRootHydrationResultFor(
        message,
        state.status === "ok" ? "ok" : "error",
        state.errorCode || (state.status === "ok" ? null : "collector_root_hydration_timeout"),
        state.status === "ok" ? null : "Root Sidebarのhydrationが完了しませんでした。",
        state.status === "ok"
          ? "collector_root_hydration_completed"
          : "collector_root_hydration_timeout",
        state);
      diagnostic("collector root hydration", {
        request_id: message?.requestId,
        refresh_generation: message?.refreshGeneration,
        navigation_generation: message?.navigationGeneration,
        collector_tab_id: message?.collectorTabId,
        status: result.status,
        error_code: result.errorCode,
        stage: result.stage,
        root_hydration_started: true,
        root_hydration_completed: result.root_hydration_completed,
        root_hydration_timeout: result.root_hydration_timeout,
        hydration_wait_ms: result.hydration_wait_ms,
        hydration_poll_count: result.hydration_poll_count,
        hydration_poll_wait_ms: result.hydration_poll_wait_ms,
        hydration_poll_interval_ms: result.hydration_poll_interval_ms,
        document_ready_state: result.document_ready_state,
        sidebar_root_present: result.sidebar_root_present,
        sidebar_scroll_container_present: result.sidebar_scroll_container_present,
        sidebar_shell_present: result.sidebar_shell_present,
        sidebar_sections_stable: result.sidebar_sections_stable,
        mutation_count: result.mutation_count,
        mutation_quiet_ms: result.mutation_quiet_ms,
        root_url_verified: result.root_url_verified
      });
      return result;
    } catch (_) {
      return collectorRootHydrationResultFor(
        message,
        "error",
        "collector_root_hydration_timeout",
        "Root Sidebarのhydrationが完了しませんでした。",
        "collector_root_hydration_timeout");
    }
  }

  async function handleGetChatGptContext(message) {
    if (!locators || !locators.isChatGptPage()) {
      return contextResultFor(
        message,
        "error",
        "active_tab_not_chatgpt",
        "アクティブなタブはChatGPTではありません。",
        "active_tab_check");
    }

    const isProjectChatCollection = message?.collection === "project";
    try {
      const currentOnly = message?.mode === "current";
      let value;
      if (currentOnly) {
        value = locators.getCurrentChatGptContext?.(document, globalThis.location?.href);
      } else if (message?.collection === "project_identity"
        && typeof locators.resolveChatGptProjectIdentitiesAsync === "function") {
        value = await locators.resolveChatGptProjectIdentitiesAsync(
          document,
          globalThis.location?.href,
          Array.isArray(message.projects) ? message.projects : [],
          {
            identityMode: message.identityMode || message.identity_mode,
            requestId: message.requestId || message.request_id,
            refreshGeneration: message.refreshGeneration ?? message.refresh_generation,
            navigationGeneration: message.navigationGeneration || message.navigation_generation,
            navigationStartedForProject: message.navigationStartedForProject
              ?? message.navigation_started_for_project,
            navigationOwnerProjectIndex: message.navigationOwnerProjectIndex
              ?? message.navigation_owner_project_index,
            navigationOwnerRequestId: message.navigationOwnerRequestId
              || message.navigation_owner_request_id,
            navigationOwnerRefreshGeneration: message.navigationOwnerRefreshGeneration
              ?? message.navigation_owner_refresh_generation,
            identityCatalog: Array.isArray(message.identityCatalog)
              ? message.identityCatalog
              : (Array.isArray(message.identity_catalog) ? message.identity_catalog : []),
            navigationTimeoutMs: message.navigationTimeoutMs,
            totalProjects: Number.isSafeInteger(message.totalProjects)
              ? message.totalProjects
              : (Array.isArray(message.identityCatalog) ? message.identityCatalog.length : undefined),
            onTelemetry: (event) => emitCollectorProjectIdentityTelemetry(message, event)
          });
      } else if (message?.collection === "project"
        && typeof locators.collectChatGptProjectContextAsync === "function") {
        value = await locators.collectChatGptProjectContextAsync(
          document,
          globalThis.location?.href,
          message.projectId || message.project_id,
          {
            maxScrolls: message.maxScrolls,
            timeoutMs: message.timeoutMs,
            projectDiscoverySource: message.projectDiscoverySource,
            projectChatHydrationTimeoutMs: message.projectChatHydrationTimeoutMs,
            projectChatHydrationQuietMs: message.projectChatHydrationQuietMs,
            projectChatHydrationPollMs: message.projectChatHydrationPollMs,
            onTelemetry: (event) => emitCollectorProjectChatTelemetry(message, event)
          });
      } else if (typeof locators.collectChatGptContextAsync === "function") {
        value = await locators.collectChatGptContextAsync(document, globalThis.location?.href, {
          maxScrolls: message.maxScrolls,
          maxMoreClicks: message.maxMoreClicks,
          timeoutMs: message.timeoutMs,
          rootHydrationCompleted: message.rootHydrationCompleted === true,
          allowSidebarControls: message.allowSidebarControls !== false,
          projectDiscoverySource: message.projectDiscoverySource
        });
      } else {
        value = locators.collectChatGptContext?.(document, globalThis.location?.href);
      }
      if (!value) {
        if (isProjectChatCollection) {
          return projectChatFailureResult(message, null, {
            errorCode: "context_response_invalid",
            failureStage: "project_chat_result_validation",
            internalReason: "collector_result_missing",
            exceptionReason: "none"
          });
        }
        return contextResultFor(message, "error", "context_extraction_failed", "ChatGPTのContextを取得できませんでした。", "context_extraction");
      }
      if (isProjectChatCollection
        && (typeof value !== "object"
          || !Array.isArray(value.projects)
          || !Array.isArray(value.conversations))) {
        return projectChatFailureResult(message, null, {
          errorCode: "context_response_invalid",
          failureStage: "project_chat_result_validation",
          internalReason: "collector_result_malformed",
          exceptionReason: "none"
        });
      }
      return contextResultFor(message, "ok", null, null, "context_extracted", currentOnly
        ? { current: value }
        : value);
    } catch (error) {
      if (isProjectChatCollection) {
        return projectChatFailureResult(message, error, {
          failureStage: "project_chat_collection"
        });
      }
      // Metadata discovery must not expose page text or DOM errors to the
      // authenticated Bridge. The Desktop receives only a stable error code.
      return contextResultFor(message, "error", "context_extraction_failed", "ChatGPTのContext取得に失敗しました。", "context_extraction");
    }
  }

  function contextFingerprint(context) {
    if (!context || typeof context !== "object") return "";
    return [
      context.conversation_id || context.conversationId || "",
      context.project_id || context.projectId || "",
      context.url || "",
      context.title || ""
    ].join("\u001f");
  }

  function emitCurrentContext() {
    if (!locators?.getCurrentChatGptContext || !locators.isChatGptPage()) return;
    let context;
    try { context = locators.getCurrentChatGptContext(document, globalThis.location?.href); } catch (_) { return; }
    const fingerprint = contextFingerprint(context);
    if (fingerprint === lastContextFingerprint) return;
    lastContextFingerprint = fingerprint;
    void sendRuntimeMessage({
      type: contextChangedMessageType,
      context
    });
  }

  function scheduleCurrentContextNotification() {
    if (contextMonitorTimer !== null) clearTimeout(contextMonitorTimer);
    contextMonitorTimer = setTimeout(() => {
      contextMonitorTimer = null;
      emitCurrentContext();
    }, 350);
  }

  function installContextMonitor() {
    if (!locators?.isChatGptPage?.() || globalThis.__chatgptComfyContextMonitorInstalled) return;
    globalThis.__chatgptComfyContextMonitorInstalled = true;

    const historyObject = globalThis.history;
    if (historyObject) {
      for (const methodName of ["pushState", "replaceState"]) {
        const original = historyObject[methodName];
        if (typeof original !== "function") continue;
        historyObject[methodName] = function (...args) {
          const result = original.apply(this, args);
          scheduleCurrentContextNotification();
          return result;
        };
      }
    }
    globalThis.addEventListener?.("popstate", scheduleCurrentContextNotification);
    globalThis.addEventListener?.("hashchange", scheduleCurrentContextNotification);

    const MutationObserverConstructor = globalThis.MutationObserver;
    if (typeof MutationObserverConstructor === "function") {
      const observationTarget = document.documentElement || document.body || document;
      try {
        const observer = new MutationObserverConstructor(scheduleCurrentContextNotification);
        observer.observe(observationTarget, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href", "aria-current", "data-active", "data-state"]
        });
      } catch (_) { }
    }
    emitCurrentContext();
  }

  function installLifecycleTelemetry() {
    if (globalThis.__chatgptComfyLifecycleTelemetryInstalled
      || typeof document.addEventListener !== "function") return;
    globalThis.__chatgptComfyLifecycleTelemetryInstalled = true;
    document.addEventListener("visibilitychange", () => {
      const watcher = watcherForLifecycleTelemetry();
      diagnostic("document visibility changed", contentLifecycleTrace(watcher, {
        status: "observed",
        stage: "document_visibility_changed",
        assistant_state: watcher?.lifecycleTelemetryState || "not_detected"
      }));
    });
  }

  function responseCorrelationKey(message) {
    return [message?.requestId, message?.sessionId, message?.handoffId, message?.boundaryId]
      .map((value) => String(value || ""))
      .join("|");
  }

  function hasResponseContext(message) {
    return [message?.requestId, message?.sessionId, message?.handoffId, message?.boundaryId, message?.protocol]
      .every((value) => typeof value === "string" && value.trim().length > 0);
  }

  function hasRequiredInputMarkers(markers) {
    return [markers?.protocol, markers?.handoffId, markers?.boundaryId]
      .every((value) => typeof value === "string" && value.trim().length > 0);
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
      return accepted;
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

    if (inserted) return;

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

  async function waitForComposerInput(markers, preferredComposer) {
    const deadline = Date.now() + composerStateTimeoutMs;
    let lastStatus = null;
    while (Date.now() < deadline) {
      const current = locators.findComposer?.()
        || (preferredComposer?.isConnected === false ? null : preferredComposer);
      if (current) {
        lastStatus = locators.getComposerInputMarkerStatus(current, markers);
        if (lastStatus.all) return { composer: current, status: lastStatus };
      }
      await wait(25);
    }
    return { composer: null, status: lastStatus };
  }

  async function fillComposer(element, payload, markers) {
    element.focus({ preventScroll: true });
    if (element instanceof HTMLTextAreaElement || element.tagName?.toLowerCase() === "textarea") {
      if (!selectAll(element)) throw new Error("Textarea selection is unavailable.");
      setTextareaValue(element, payload);
    } else {
      setContentEditableValue(element, payload);
    }

    return waitForComposerInput(markers, element);
  }

  function mediaResultFor(message, status, errorCode, text, stage) {
    const result = {
      request_id: message?.requestId || "",
      session_id: message?.sessionId || "",
      iteration: message?.iteration,
      media_id: message?.mediaId || "",
      status
    };
    if (errorCode) result.error_code = errorCode;
    if (text) result.message = text;
    if (stage) result.stage = stage;
    diagnostic("content script media result", result);
    return result;
  }

  function hasValidMediaMetadata(message) {
    return typeof message?.requestId === "string"
      && message.requestId.length > 0
      && typeof message?.sessionId === "string"
      && message.sessionId.length > 0
      && Number.isSafeInteger(message?.iteration)
      && message.iteration > 0
      && typeof message?.mediaId === "string"
      && message.mediaId.length > 0
      && typeof message?.fileName === "string"
      && message.fileName.length > 0
      && message.fileName.length <= 255
      && !/[\\/\r\n"\u0000]/.test(message.fileName)
      && typeof message?.mimeType === "string"
      && ["video/mp4", "image/png", "image/jpeg", "image/webp"].includes(message.mimeType.toLowerCase())
      && Number.isSafeInteger(message?.size)
      && message.size > 0
      && message.size <= maxMediaBytes;
  }

  function decodeBase64(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > maxMediaChunkBase64Length) return null;
    try {
      if (typeof globalThis.atob === "function") {
        const binary = globalThis.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
      }
    } catch (_) {
      return null;
    }

    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const clean = value.replace(/=+$/, "");
    if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) return null;
    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const character of clean) {
      buffer = (buffer << 6) | alphabet.indexOf(character);
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 255);
      }
    }
    return new Uint8Array(bytes);
  }

  function mediaRequestMatchesTransfer(message, transfer) {
    return Boolean(transfer)
      && transfer.requestId === message?.requestId
      && transfer.sessionId === message?.sessionId
      && transfer.iteration === message?.iteration
      && transfer.mediaId === message?.mediaId;
  }

  function fileInputHasExpectedFile(fileInput, transfer) {
    const file = fileInput?.files?.[0];
    return Boolean(file
      && file.name === transfer.fileName
      && file.size === transfer.size
      && (!file.type || file.type.toLowerCase() === transfer.mimeType));
  }

  async function waitForAttachmentVerification(composer, transfer) {
    const deadline = Date.now() + attachmentVerificationTimeoutMs;
    let sawIndicator = false;
    let sawUploading = false;
    while (Date.now() < deadline) {
      const currentComposer = locators.findComposer?.() || composer;
      const indicator = locators.findAttachmentByFilename?.(document, transfer.fileName, currentComposer);
      if (indicator) {
        sawIndicator = true;
        const uploading = Boolean(locators.isAttachmentUploading?.(indicator));
        sawUploading ||= uploading;
        const isNewIndicator = !transfer.baselineIndicators?.has(indicator);
        const inputChanged = transfer.fileInput?.files?.[0]
          && transfer.fileInput.files[0] !== transfer.previousFile;
        const fileInputReady = fileInputHasExpectedFile(transfer.fileInput, transfer);
        diagnostic("attachment upload state", {
          stage: uploading ? "attachment_uploading" : "attachment_verified"
        });
        // A stale chip with the same filename is not sufficient. Either a
        // newly rendered indicator or the newly injected File must be present.
        if (!uploading && (isNewIndicator || (fileInputReady && inputChanged))) {
          return { verified: true, stage: "attachment_verified" };
        }
      }
      await wait(100);
    }
    return {
      verified: false,
      errorCode: sawUploading ? "attachment_timeout" : "attachment_verification_failed",
      stage: sawUploading ? "attachment_uploading" : (sawIndicator ? "attachment_verification" : "attachment_control_found")
    };
  }

  async function handleReviewMediaAttachBegin(message) {
    diagnostic("attachment begin requested", {
      request_id: message?.requestId,
      media_id: message?.mediaId,
      iteration: message?.iteration,
      stage: "attachment_control_requested"
    });
    if (!locators || !locators.isChatGptPage()) {
      return mediaResultFor(message, "error", "review_target_tab_not_found", "対象ページはChatGPTではありません。", "active_tab_check");
    }
    if (!hasValidMediaMetadata(message)) {
      return mediaResultFor(message, "error", "media_registration_failed", "添付メタデータが不正です。", "media_request_validation");
    }

    const composer = locators.findComposer?.();
    if (!composer) return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTの入力欄が見つかりません。", "attachment_control_found");
    let fileInput = locators.findFileInput?.(document, composer);
    if (!fileInput) {
      // The file input may be mounted only after ChatGPT's explicit
      // attachment control opens its menu. Do not click a generic toolbar
      // button: the locator helper returns only semantically attachment-like
      // controls in the composer scope.
      const attachmentControl = locators.findAttachmentControl?.(document, composer);
      if (attachmentControl) {
        try { attachmentControl.click(); } catch (_) { }
        const deadline = Date.now() + attachmentControlTimeoutMs;
        while (Date.now() < deadline && !fileInput) {
          fileInput = locators.findFileInput?.(document, composer);
          if (!fileInput) await wait(50);
        }
      }
    }
    if (!fileInput) {
      return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTのファイル添付入力が見つかりません。", "attachment_control_found");
    }

    mediaTransfers.set(message.requestId, {
      requestId: message.requestId,
      sessionId: message.sessionId,
      iteration: message.iteration,
      mediaId: message.mediaId,
      fileName: message.fileName,
      mimeType: message.mimeType.toLowerCase(),
      size: message.size,
      composer,
      fileInput,
      previousFile: fileInput.files?.[0] || null,
      baselineIndicators: new Set(locators.findAttachmentIndicators?.(document, message.fileName, composer) || []),
      chunks: [],
      received: 0
    });
    diagnostic("attachment control found", {
      request_id: message.requestId,
      media_id: message.mediaId,
      iteration: message.iteration,
      stage: "attachment_control_found"
    });
    return mediaResultFor(message, "receiving", null, null, "attachment_control_found");
  }

  function handleReviewMediaAttachChunk(message) {
    const transfer = mediaTransfers.get(message?.requestId);
    if (!mediaRequestMatchesTransfer(message, transfer)) {
      return mediaResultFor(message, "error", "attachment_input_failed", "添付データの受信状態が見つかりません。", "attachment_chunk_context");
    }
    const bytes = decodeBase64(message.chunk);
    const expectedOffset = transfer.received;
    if (!bytes || message.offset !== expectedOffset || transfer.received + bytes.length > transfer.size) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "添付データを正しく受信できませんでした。", "attachment_chunk_validation");
    }
    transfer.chunks.push(bytes);
    transfer.received += bytes.length;
    return mediaResultFor(message, "receiving", null, null, "attachment_injected");
  }

  async function handleReviewMediaAttachEnd(message) {
    const transfer = mediaTransfers.get(message?.requestId);
    if (!mediaRequestMatchesTransfer(message, transfer)
      || message.fileName !== transfer.fileName
      || message.mimeType?.toLowerCase() !== transfer.mimeType
      || message.size !== transfer.size) {
      mediaTransfers.delete(message?.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "添付対象の識別情報が一致しません。", "attachment_metadata_validation");
    }
    if (transfer.received !== transfer.size) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_upload_failed", "生成物を完全に受信できませんでした。", "attachment_uploading");
    }

    try {
      const FileConstructor = globalThis.File;
      const DataTransferConstructor = globalThis.DataTransfer;
      if (typeof FileConstructor !== "function" || typeof DataTransferConstructor !== "function") throw new Error("File API is unavailable.");
      const file = new FileConstructor(transfer.chunks, transfer.fileName, { type: transfer.mimeType });
      const composer = locators.findComposer?.() || transfer.composer;
      const fileInput = locators.findFileInput?.(document, composer) || transfer.fileInput;
      if (!fileInput) {
        mediaTransfers.delete(message.requestId);
        return mediaResultFor(message, "error", "attachment_control_not_found", "ChatGPTのファイル添付入力が見つかりません。", "attachment_control_found");
      }
      const dataTransfer = new DataTransferConstructor();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
      fileInput.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      fileInput.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      diagnostic("attachment injected", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        stage: "attachment_injected"
      });
      diagnostic("attachment uploading", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        stage: "attachment_uploading"
      });
      const verification = await waitForAttachmentVerification(composer, transfer);
      if (!verification.verified) {
        mediaTransfers.delete(message.requestId);
        return mediaResultFor(message, "error", verification.errorCode, "ChatGPTで添付完了を確認できませんでした。", verification.stage);
      }
      verifiedReviewAttachments.set(
        `${message.sessionId}|${message.iteration}|${message.mediaId}|${message.fileName}`,
        { fileName: message.fileName, mediaId: message.mediaId, verifiedAt: Date.now() });
      mediaTransfers.delete(message.requestId);
      diagnostic("attachment verified", {
        request_id: message.requestId,
        media_id: message.mediaId,
        iteration: message.iteration,
        status: "attached",
        stage: "attachment_verified"
      });
      return mediaResultFor(message, "attached", null, null, "attachment_verified");
    } catch (_) {
      mediaTransfers.delete(message.requestId);
      return mediaResultFor(message, "error", "attachment_input_failed", "ChatGPTのファイル添付入力へ生成物を設定できませんでした。", "attachment_input_failed");
    }
  }

  function wait(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  async function waitForComposer(message) {
    const deadline = Date.now() + composerMountTimeoutMs;
    let waitingDiagnosticSent = false;
    while (Date.now() < deadline) {
      const composer = locators.findComposer?.();
      if (composer) return composer;
      if (!waitingDiagnosticSent) {
        waitingDiagnosticSent = true;
        diagnostic("composer waiting", traceForMessage(message, {
          stage: "composer_waiting"
        }));
      }
      await wait(composerPollIntervalMs);
    }
    return locators.findComposer?.() || null;
  }

  function readCurrentContextSnapshot() {
    try {
      return locators.getCurrentChatGptContext?.(document, globalThis.location?.href) || null;
    } catch (_) {
      return null;
    }
  }

  function contextIdentityMatches(current, message) {
    const expectedConversationId = message?.expectedConversationId || message?.expected_conversation_id || "";
    const expectedConversationUrl = message?.expectedConversationUrl || message?.expected_conversation_url || "";
    const expectedProjectId = message?.expectedProjectId || message?.expected_project_id || "";
    const currentConversationUrl = current?.url || globalThis.location?.href || "";
    const currentConversationId = current?.conversation_id
      || current?.conversationId
      || locators?.conversationIdFromUrl?.(currentConversationUrl)
      || "";
    const currentProjectId = current?.project_id || current?.projectId || "";

    if (expectedConversationId && currentConversationId !== expectedConversationId) return false;
    if (expectedConversationUrl) {
      const expectedIdFromUrl = locators?.conversationIdFromUrl?.(expectedConversationUrl) || "";
      const currentIdFromUrl = currentConversationId
        || locators?.conversationIdFromUrl?.(currentConversationUrl)
        || "";
      if (expectedIdFromUrl && currentIdFromUrl !== expectedIdFromUrl) return false;
      if (!expectedIdFromUrl && currentConversationUrl !== expectedConversationUrl) return false;
    }
    if (expectedProjectId && currentProjectId && currentProjectId !== expectedProjectId) return false;
    if (expectedProjectId && !currentProjectId) {
      const projectIdFromUrl = locators?.projectIdFromUrl?.(currentConversationUrl) || "";
      if (projectIdFromUrl && projectIdFromUrl !== expectedProjectId) return false;
    }
    if (message?.newConversation === true && expectedConversationId) return false;
    return true;
  }

  function executionReadyResultFor(message, status, errorCode, text, stage, currentContext, composerReady = false) {
    const result = responseResultFor(message, status, errorCode, text, stage);
    result.composer_ready = composerReady;
    if (currentContext) result.current_context = currentContext;
    return result;
  }

  async function handleChatGptExecutionReady(message) {
    const trace = traceForMessage(message);
    diagnostic("execution readiness requested", {
      ...trace,
      status: "requested",
      stage: "conversation_ready_requested"
    });
    if (!locators || !locators.isChatGptPage?.()) {
      return executionReadyResultFor(
        message,
        "error",
        "managed_tab_not_chatgpt",
        "Managed ChatGPTタブがChatGPTページではありません。",
        "chatgpt_page_check");
    }

    const composer = await waitForComposer(message);
    if (!composer) {
      diagnostic("execution composer unavailable", {
        ...trace,
        status: "error",
        error_code: "composer_ready_timeout",
        stage: "composer_ready_timeout"
      });
      return executionReadyResultFor(
        message,
        "error",
        "composer_not_found",
        "Managed ChatGPTタブのcomposer準備がタイムアウトしました。",
        "composer_ready_timeout");
    }
    diagnostic("execution composer ready", {
      ...trace,
      status: "ready",
      stage: "composer_ready",
      composer_type: composerType(composer)
    });

    const deadline = Date.now() + composerMountTimeoutMs;
    let current = readCurrentContextSnapshot();
    while (Date.now() < deadline) {
      current = readCurrentContextSnapshot() || current;
      if (contextIdentityMatches(current, message)) break;
      await wait(composerPollIntervalMs);
    }
    current = readCurrentContextSnapshot() || current;
    if (!contextIdentityMatches(current, message)) {
      diagnostic("execution conversation mismatch", {
        ...trace,
        status: "error",
        error_code: "target_conversation_mismatch",
        stage: "conversation_ready"
      });
      return executionReadyResultFor(
        message,
        "error",
        "target_conversation_mismatch",
        "Managed ChatGPTタブのConversation準備が完了していません。",
        "conversation_ready",
        current,
        true);
    }

    diagnostic("execution conversation ready", {
      ...trace,
      status: "ready",
      stage: "conversation_ready"
    });
    return executionReadyResultFor(
      message,
      "ready",
      null,
      null,
      "conversation_ready",
      current,
      true);
  }

  async function readCurrentContextAfterHandoff(message) {
    let current = readCurrentContextSnapshot();
    if (message?.newConversation !== true
      || (current?.conversation_id && current?.url)) return current;

    // ChatGPT creates the conversation route asynchronously after accepting a
    // message on the new-chat page.  Bind only after the page exposes both
    // stable identity fields; never invent an ID from the visible title.
    const deadline = Date.now() + newConversationBindingTimeoutMs;
    while (Date.now() < deadline) {
      await wait(100);
      current = readCurrentContextSnapshot() || current;
      if (current?.conversation_id && current?.url) return current;
    }
    return current;
  }

  function reviewAttachmentKey(message) {
    return `${message?.sessionId || ""}|${message?.expectedAttachment?.iteration || message?.iteration || ""}|${message?.expectedAttachment?.mediaId || ""}|${message?.expectedAttachment?.fileName || ""}`;
  }

  function hasVerifiedReviewAttachment(message, composer) {
    const expected = message?.expectedAttachment;
    if (!expected || typeof expected.fileName !== "string" || expected.fileName.length === 0) return false;
    const remembered = verifiedReviewAttachments.get(reviewAttachmentKey(message));
    const indicator = locators.findAttachmentByFilename?.(document, expected.fileName, composer);
    const complete = Boolean(indicator
      && !locators.isAttachmentUploading?.(indicator)
      && (locators.isAttachmentUploadComplete?.(document, expected.fileName, composer) ?? true));
    // A service-worker/content-script restart loses the in-memory record, but
    // a visible, non-uploading ChatGPT attachment is still valid evidence.
    return complete && (!remembered || remembered.fileName === expected.fileName);
  }

  async function waitForSendButton(composer, markers, options = {}) {
    const timeoutMs = options.review ? reviewComposerStateTimeoutMs : composerStateTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    let candidate = null;
    let currentComposer = composer;
    let composerHadInput = Boolean(composer && locators.composerContainsInputMarkers(composer, markers));
    let composerStateWasLost = false;
    let waitingDiagnosticSent = false;
    while (Date.now() < deadline) {
      const locatedComposer = locators.findComposer?.();
      currentComposer = locatedComposer
        || (currentComposer?.isConnected === false ? null : currentComposer);
      const composerHasInput = Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers));
      if (composerHasInput) {
        composerHadInput = true;
        // ChatGPT may replace the editor node while it processes an
        // attachment. A transient marker miss is recoverable when the
        // replacement editor contains the same Handoff again.
        composerStateWasLost = false;
      } else if (composerHadInput) {
        composerStateWasLost = true;
      }
      candidate = locators.findSendButton(document, { includeDisabled: true, composer: currentComposer });
      if (composerHasInput && candidate && !locators.isDisabled(candidate)) {
        return { button: candidate, composer: currentComposer, composerStateWasLost, composerHasInput };
      }
      if (!waitingDiagnosticSent && composerHasInput && candidate && locators.isDisabled(candidate)) {
        waitingDiagnosticSent = true;
        diagnostic("send button waiting", {
          request_id: options.requestId,
          handoff_id: options.handoffId,
          stage: options.review ? "send_button_waiting_for_attachment" : "send_button_waiting"
        });
      }
      await wait(50);
    }
    const finalComposerHasInput = Boolean(currentComposer && locators.composerContainsInputMarkers(currentComposer, markers));
    return {
      button: candidate,
      composer: currentComposer,
      composerStateWasLost: composerStateWasLost && !finalComposerHasInput,
      composerHasInput: finalComposerHasInput
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
        const hasCorrelatedMessage = locators.hasNewUserMessageWithCorrelation(document, {
          handoffId: message.handoffId,
          boundaryId: message.boundaryId,
          protocol: message.protocol
        }, beforeSnapshot);
        const correlatedMessage = hasCorrelatedMessage
          ? locators.findNewUserMessages(document, beforeSnapshot).find((candidate) =>
            locators.messageContainsMarker(candidate, message.handoffId)
            && locators.messageContainsMarker(candidate, message.boundaryId)
            && (!message.protocol || locators.messageContainsMarker(candidate, message.protocol)))
          : null;
        if (correlatedMessage) {
          diagnostic("user message correlated", {
            request_id: message?.requestId,
            handoff_id: message?.handoffId,
            status: "sent",
            stage: "user_message_correlated"
          });
          return { accepted: true, stage: "user_message_correlated", anchor: correlatedMessage };
        }
      }

      // Clearing/replacing the composer is diagnostic evidence only. It is
      // never a send-success condition.
      const currentComposer = locators.findComposer?.() || composer;
      if (!composerCleared
        && (!currentComposer || !locators.composerContainsInputMarkers(currentComposer, {
          protocol: message?.protocol,
          handoffId: message?.handoffId,
          boundaryId: message?.boundaryId
        }))) {
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

  function assistantCandidatesFor(watcher) {
    if (!watcher?.anchor) return [];
    // The correlated user-message anchor is the authoritative boundary. Do
    // not discard a post-anchor assistant container merely because ChatGPT
    // reused/reconciled the same DOM node that existed in the pre-send
    // snapshot. Some conversation renderers create an empty assistant turn
    // before they append the user turn, then fill that turn in place. The
    // connector-command marker check below still prevents an unrelated
    // assistant/status node from becoming a response.
    return locators.findAssistantMessagesAfterAnchor(document, watcher.anchor);
  }

  function responseContextFor(watcher) {
    return {
      protocol: watcher.protocol,
      handoffId: watcher.handoffId,
      sessionId: watcher.sessionId
    };
  }

  function isConnectorResponseCandidate(candidate, watcher) {
    try {
      return Boolean(locators.hasConnectorCommandResponse?.(candidate, responseContextFor(watcher)));
    } catch (_) {
      return false;
    }
  }

  function sendAssistantResponseToBackground(watcher, result) {
    const currentContext = readCurrentContextSnapshot();
    const message = {
      type: responseResultMessageType,
      requestId: watcher.requestId,
      sessionId: watcher.sessionId,
      handoffId: watcher.handoffId,
      boundaryId: watcher.boundaryId,
      status: result.status
    };
    if (result.payload) message.payload = result.payload;
    if (result.errorCode) message.errorCode = result.errorCode;
    if (result.message) message.message = result.message;
    if (result.stage) message.stage = result.stage;
    if (currentContext?.conversation_id) message.targetConversationId = currentContext.conversation_id;
    if (currentContext?.url) message.targetConversationUrl = currentContext.url;

    diagnostic("assistant response emitted", {
      ...responseLifecycleTrace(watcher, {
      status: result.status,
      error_code: result.errorCode,
      stage: "assistant_response_emitted",
      target_tab_id: watcher.targetTabId,
      assistant_state: assistantStateForResult(watcher, result),
      watcher_state: "idle"
      })
    });

    void sendRuntimeMessage(message, () => {
      diagnostic("assistant response delivery failed", {
        ...responseLifecycleTrace(watcher, {
        status: "error",
        error_code: "bridge_disconnected",
        stage: "response_background_dispatch",
        watcher_state: "idle"
        })
      });
    });
  }

  function finishAssistantResponseWatcher(watcher, result) {
    if (watcher.finished) return;
    watcher.finished = true;
    emitResponseLifecycleTelemetry(
      watcher,
      assistantStateForResult(watcher, result),
      result.status === "received" ? "assistant_message_complete" : result.stage,
      true);
    if (watcher.observer) watcher.observer.disconnect();
    if (watcher.timer !== null) clearTimeout(watcher.timer);
    responseWatchers.delete(watcher.key);
    responseAnchors.delete(watcher.key);
    if (result.status === "received") {
      diagnostic("assistant message complete", {
        ...responseLifecycleTrace(watcher, {
        status: "received",
        stage: "assistant_message_complete",
        target_tab_id: watcher.targetTabId,
        assistant_state: "completed",
        watcher_state: "idle"
        })
      });
      diagnostic("assistant response correlated", {
        ...responseLifecycleTrace(watcher, {
        status: "received",
        stage: result.stage,
        target_tab_id: watcher.targetTabId,
        assistant_state: "completed",
        watcher_state: "idle"
        })
      });
    } else {
      diagnostic("assistant response failed", {
        ...responseLifecycleTrace(watcher, {
        status: "error",
        error_code: result.errorCode,
        stage: result.stage,
        target_tab_id: watcher.targetTabId,
        assistant_state: assistantStateForResult(watcher, result),
        watcher_state: "idle"
        })
      });
    }
    sendAssistantResponseToBackground(watcher, result);
  }

  function evaluateAssistantResponseWatcher(watcher) {
    if (watcher.finished) return;
    if (watcher.timer !== null) {
      clearTimeout(watcher.timer);
      watcher.timer = null;
    }
    const now = Date.now();

    // A pre-send watcher is deliberately armed before the Handoff is posted.
    // It must not use an older anchor and must not start its response timeout
    // until the marker-bearing user message for this exact request exists.
    if (!watcher.anchor) {
      const anchor = locators.findUserMessageWithCorrelation?.(document, {
        protocol: watcher.protocol,
        handoffId: watcher.handoffId,
        boundaryId: watcher.boundaryId
      }) || null;
      if (!anchor) {
        emitResponseLifecycleTelemetry(watcher, "not_detected", "response_anchor_waiting");
        watcher.timer = setTimeout(() => evaluateAssistantResponseWatcher(watcher), responsePollIntervalMs);
        return;
      }
      watcher.anchor = anchor;
      watcher.awaitingUserAnchor = false;
      watcher.deadline = now + responseTimeoutMs;
      responseAnchors.set(watcher.key, {
        anchor,
        assistantElements: watcher.baselineAssistantElements,
        createdAt: now
      });
      diagnostic(watcher.review === true ? "review anchor found" : "response anchor found", {
        request_id: watcher.requestId,
        session_id: watcher.sessionId,
        handoff_id: watcher.handoffId,
        boundary_id: watcher.boundaryId,
        status: "watching",
        stage: watcher.review === true ? "review_anchor_found" : "response_anchor_found",
        target_tab_id: watcher.targetTabId
      });
      emitResponseLifecycleTelemetry(watcher, "not_detected", "response_anchor_found", true);
    }

    const candidates = assistantCandidatesFor(watcher);
    // A visible assistant/status node is not by itself a Connector response.
    // Only the newest post-anchor assistant message whose own content has a
    // connector-command block may advance to extraction. This prevents
    // transient "Thinking"/tool-progress UI from completing the watcher.
    const latestCandidate = candidates.at(-1) || null;
    const connectorCandidates = candidates.filter((candidate) => isConnectorResponseCandidate(candidate, watcher));
    // Prefer the latest candidate that contains this watcher's Connector
    // identity. A later status/tool container must not hide a valid response
    // that is still streaming in an earlier assistant turn.
    const candidate = connectorCandidates.at(-1) || null;
    if (latestCandidate && !candidate) {
      watcher.sawAssistantMessage = true;
      watcher.sawNonConnectorAssistant = true;
      if (!watcher.ignoredAssistantElements.has(latestCandidate)) {
        watcher.ignoredAssistantElements.add(latestCandidate);
        diagnostic("assistant candidate ignored", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_response_candidate_non_connector",
          target_tab_id: watcher.targetTabId
        });
      }
    }
    if (candidate) {
      watcher.sawAssistantMessage = true;
      if (!watcher.connectorCandidateDetected) {
        watcher.connectorCandidateDetected = true;
        diagnostic("connector candidate detected", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          status: "observed",
          stage: "connector_candidate_detected",
          target_tab_id: watcher.targetTabId
        });
      }
      if (!watcher.observedAssistantElements.has(candidate)) {
        watcher.observedAssistantElements.add(candidate);
        diagnostic("assistant message observed", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_message_observed",
          target_tab_id: watcher.targetTabId
        });
      }
      let text = "";
      try {
        text = locators.readAssistantResponseText(candidate, responseContextFor(watcher));
      }
      catch (_) { text = ""; }
      if (candidate !== watcher.candidate || text !== watcher.candidateText) {
        watcher.candidate = candidate;
        watcher.candidateText = text;
        watcher.lastChangedAt = now;
        watcher.textStableReported = false;
        diagnostic("assistant response observed", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          stage: "assistant_message_observed",
          target_tab_id: watcher.targetTabId
        });
        diagnostic("assistant extraction complete", {
          request_id: watcher.requestId,
          session_id: watcher.sessionId,
          handoff_id: watcher.handoffId,
          boundary_id: watcher.boundaryId,
          status: text.trim() ? "extracted" : "empty",
          stage: "assistant_extraction_complete",
          extracted_length: text.length,
          target_tab_id: watcher.targetTabId
        });
        if (now - (watcher.domChangeTelemetryAt || 0) >= responseLifecycleTelemetryIntervalMs) {
          watcher.domChangeTelemetryAt = now;
          diagnostic("assistant DOM changed", responseLifecycleTrace(watcher, {
            status: "observed",
            stage: "assistant_dom_changed",
            assistant_state: watcher.sawGenerating ? "streaming" : "stable_wait",
            extracted_length: text.length,
            target_tab_id: watcher.targetTabId
          }));
        }
      }
      if (!text.trim()) watcher.extractionWasEmpty = true;
      watcher.hasCompletionActions = Boolean(locators.hasAssistantCompletionActions?.(candidate));
    }

    const generating = Boolean(locators.isGenerating?.(document));
    if (generating) {
      if (!watcher.sawGenerating) {
        diagnostic("assistant response streaming", responseLifecycleTrace(watcher, {
          stage: "assistant_response_streaming",
          assistant_state: "streaming",
          target_tab_id: watcher.targetTabId
        }));
      }
      watcher.sawGenerating = true;
      emitResponseLifecycleTelemetry(watcher, "streaming", "assistant_response_streaming");
    }

    const textStable = Boolean(candidate
      && watcher.candidateText.trim()
      && now - watcher.lastChangedAt >= responseStabilityMs);
    // ChatGPT's Stop control is page/composer scoped rather than tied to the
    // assistant turn being watched. During Review, it can remain visible for
    // unrelated page work even after this assistant turn exposes its enabled
    // completion actions. A stable Connector candidate with those per-turn
    // actions is therefore completion evidence; a global Stop control alone
    // must not keep a completed Review response in streaming forever.
    const assistantGenerationFinished = !generating || watcher.hasCompletionActions;
    if (textStable && !watcher.textStableReported) {
      watcher.textStableReported = true;
      diagnostic("assistant text stable", responseLifecycleTrace(watcher, {
        status: "stable",
        stage: "assistant_text_stable",
        assistant_state: assistantGenerationFinished ? "completed" : "stable_wait",
        target_tab_id: watcher.targetTabId
      }));
    }

    const assistantState = candidate && textStable && assistantGenerationFinished
      ? "completed"
      : generating
        ? "streaming"
        : candidate && watcher.candidateText.trim()
          ? "stable_wait"
          : "not_detected";
    emitResponseLifecycleTelemetry(
      watcher,
      assistantState,
      assistantState === "completed" ? "assistant_generation_finished" : "response_waiting_periodic",
      assistantState === "completed");
    if (assistantGenerationFinished && textStable && !watcher.generationFinishedReported) {
      watcher.generationFinishedReported = true;
      diagnostic("assistant generation finished", responseLifecycleTrace(watcher, {
        status: "complete",
        stage: "assistant_generation_finished",
        assistant_state: "completed",
        target_tab_id: watcher.targetTabId
      }));
    }

    if (candidate && textStable && assistantGenerationFinished) {
      diagnostic("connector candidate complete", responseLifecycleTrace(watcher, {
        status: "complete",
        stage: "connector_candidate_complete",
        assistant_state: "completed",
        target_tab_id: watcher.targetTabId
      }));
      finishAssistantResponseWatcher(watcher, {
        status: "received",
        payload: watcher.candidateText,
        stage: "assistant_response_complete"
      });
      return;
    }

    if (watcher.deadline !== null && now >= watcher.deadline) {
      const errorCode = !watcher.sawAssistantMessage
        ? "assistant_response_not_found"
        : watcher.sawGenerating || generating
          ? "response_stream_interrupted"
          : watcher.extractionWasEmpty
            ? "response_extraction_failed"
            : "response_timeout";
      const stage = !watcher.sawAssistantMessage
        ? "assistant_message_not_found"
        : watcher.sawGenerating || generating
          ? "assistant_response_streaming"
          : watcher.sawNonConnectorAssistant
            ? "assistant_response_non_connector"
          : watcher.extractionWasEmpty
            ? "assistant_response_empty"
            : "assistant_response_stability_timeout";
      finishAssistantResponseWatcher(watcher, {
        status: "error",
        errorCode,
        message: "ChatGPTのassistant応答を完了状態で取得できませんでした。",
        stage
      });
      return;
    }

    watcher.timer = setTimeout(() => evaluateAssistantResponseWatcher(watcher), responsePollIntervalMs);
  }

  function startAssistantResponseWatcher(watcher) {
    const MutationObserverConstructor = globalThis.MutationObserver;
    if (typeof MutationObserverConstructor === "function") {
      watcher.observer = new MutationObserverConstructor(() => evaluateAssistantResponseWatcher(watcher));
      const observationTarget = document.body || document.documentElement || document;
      watcher.observer.observe(observationTarget, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ["aria-label", "data-testid", "aria-disabled", "disabled"]
      });
    }
    evaluateAssistantResponseWatcher(watcher);
  }

  async function handleWatchAssistantResponse(message) {
    diagnostic(message?.review === true ? "review response watch requested" : "assistant response watch requested", traceForMessage(message, {
      status: "requested",
      stage: "response_watch_requested"
    }));
    if (!locators || !locators.isChatGptPage()) {
      return responseResultFor(message, "error", "active_tab_not_chatgpt", "アクティブなタブはChatGPTではありません。", "active_tab_check");
    }
    if (!hasResponseContext(message)) {
      return responseResultFor(message, "error", "response_extraction_failed", "応答監視に必要な識別子がありません。", "response_context_invalid");
    }

    const key = responseCorrelationKey(message);
    const existing = responseWatchers.get(key);
    if (existing) {
      diagnostic("response watch armed", contentLifecycleTrace(existing, {
        status: "watching",
        stage: "response_watch_armed",
        watcher_state: "armed"
      }));
      return responseResultFor(message, "watching", null, null, "response_watch_started");
    }

    if (message?.prepare === true) {
      const beforeAssistantMessages = locators.captureAssistantMessageSnapshot?.(document)
        || { count: 0, elements: new Set() };
      const watcher = {
        key,
        requestId: message.requestId,
        sessionId: message.sessionId,
        handoffId: message.handoffId,
        boundaryId: message.boundaryId,
        protocol: message.protocol,
        review: message.review === true,
        targetTabId: message?.targetTabId || message?.target_tab_id,
        anchor: null,
        awaitingUserAnchor: true,
        baselineAssistantElements: beforeAssistantMessages.elements,
        deadline: null,
        lastChangedAt: Date.now(),
        candidate: null,
        candidateText: "",
        sawAssistantMessage: false,
        sawGenerating: false,
        extractionWasEmpty: false,
        sawNonConnectorAssistant: false,
        observedAssistantElements: new Set(),
        ignoredAssistantElements: new Set(),
        connectorCandidateDetected: false,
        textStableReported: false,
        generationFinishedReported: false,
        hasCompletionActions: false,
        lifecycleTelemetryAt: 0,
        lifecycleTelemetryState: null,
        domChangeTelemetryAt: 0,
        observer: null,
        timer: null,
        finished: false
      };
      responseWatchers.set(key, watcher);
      diagnostic("response watch armed", contentLifecycleTrace(watcher, {
        status: "watching",
        stage: "response_watch_armed",
        watcher_state: "armed",
        target_tab_id: watcher.targetTabId
      }));
      emitResponseLifecycleTelemetry(watcher, "not_detected", "response_watch_armed", true);
      startAssistantResponseWatcher(watcher);
      return responseResultFor(message, "watching", null, null, "response_watch_ready");
    }

    const savedAnchor = responseAnchors.get(key);
    const savedAnchorElement = savedAnchor?.anchor?.isConnected === false
      ? null
      : savedAnchor?.anchor;
    // ChatGPT may replace a just-sent user-message node while it reconciles
    // the conversation. Re-locate the same marker-bearing message instead of
    // treating that harmless DOM replacement as an extraction failure.
    const locatedAnchor = locators.findUserMessageWithCorrelation(document, {
      protocol: message.protocol,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId
    });
    // Prefer the live marker-bearing message. ChatGPT's React reconciliation
    // can replace the accepted user-message node between HANDOFF_SEND and
    // WATCH_ASSISTANT_RESPONSE; retaining the old node would make the
    // post-anchor query miss the Review assistant turn.
    const anchor = locatedAnchor || savedAnchorElement;
    if (!anchor) {
      diagnostic(message?.review === true ? "review anchor missing" : "response anchor missing", traceForMessage(message, {
        status: "error",
        error_code: "response_anchor_not_found",
        stage: "response_anchor_not_found"
      }));
      return responseResultFor(message, "error", "assistant_response_not_found", "今回のHandoffに対応するChatGPT user messageが見つかりません。", "response_anchor_not_found");
    }
    diagnostic(message?.review === true ? "review anchor found" : "response anchor found", {
      ...traceForMessage(message),
      status: "watching",
      stage: message?.review === true ? "review_anchor_found" : "response_anchor_found"
    });

    const watcher = {
      key,
      requestId: message.requestId,
      sessionId: message.sessionId,
      handoffId: message.handoffId,
      boundaryId: message.boundaryId,
      protocol: message.protocol,
      review: message?.review === true,
      targetTabId: message?.targetTabId || message?.target_tab_id,
      anchor,
      baselineAssistantElements: savedAnchor?.assistantElements instanceof Set
        ? savedAnchor.assistantElements
        : new Set(),
      deadline: Date.now() + responseTimeoutMs,
      lastChangedAt: Date.now(),
      candidate: null,
      candidateText: "",
      sawAssistantMessage: false,
      sawGenerating: false,
      extractionWasEmpty: false,
      sawNonConnectorAssistant: false,
      observedAssistantElements: new Set(),
      ignoredAssistantElements: new Set(),
      connectorCandidateDetected: false,
      textStableReported: false,
      generationFinishedReported: false,
      hasCompletionActions: false,
      lifecycleTelemetryAt: 0,
      lifecycleTelemetryState: null,
      domChangeTelemetryAt: 0,
      observer: null,
      timer: null,
      finished: false
    };
    responseWatchers.set(key, watcher);
    diagnostic("response watch armed", contentLifecycleTrace(watcher, {
      status: "watching",
      stage: "response_watch_armed",
      watcher_state: "armed",
      target_tab_id: watcher.targetTabId
    }));
    emitResponseLifecycleTelemetry(watcher, "not_detected", "response_watch_armed", true);
    startAssistantResponseWatcher(watcher);
    return responseResultFor(message, "watching", null, null, "response_watch_started");
  }

  async function handleCancelResponseWatch(message) {
    if (!hasResponseContext(message)) {
      return responseResultFor(message, "error", "response_extraction_failed", "応答監視の識別情報がありません。", "response_context_invalid");
    }
    const key = responseCorrelationKey(message);
    const watcher = responseWatchers.get(key);
    if (watcher) {
      watcher.finished = true;
      watcher.observer?.disconnect?.();
      if (watcher.timer !== null) clearTimeout(watcher.timer);
      responseWatchers.delete(key);
      responseAnchors.delete(key);
    }
    diagnostic("response watch cancelled", contentLifecycleTrace(watcher, {
      ...traceForMessage(message),
      status: "cancelled",
      stage: "response_watch_cancelled",
      watcher_state: "idle"
    }));
    return responseResultFor(message, "cancelled", null, null, "response_watch_cancelled");
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

    // A Bridge retry can arrive after the first user message was accepted but
    // its transport ACK was delayed. Reuse the marker-bearing message before
    // touching the composer or Review attachment; posting the same immutable
    // Handoff a second time would create a duplicate ChatGPT turn.
    if (hasRequiredInputMarkers({
      protocol: message?.protocol,
      handoffId: message?.handoffId,
      boundaryId: message?.boundaryId
    })) {
      let existingAnchor = null;
      try {
        existingAnchor = locators.findUserMessageWithCorrelation?.(document, {
          protocol: message.protocol,
          handoffId: message.handoffId,
          boundaryId: message.boundaryId
        }) || null;
      } catch (_) { existingAnchor = null; }
      if (existingAnchor) {
        const beforeAssistantMessages = locators.captureAssistantMessageSnapshot?.(document)
          || { count: 0, elements: new Set() };
        responseAnchors.set(responseCorrelationKey(message), {
          anchor: existingAnchor,
          assistantElements: beforeAssistantMessages.elements,
          createdAt: Date.now()
        });
        diagnostic("user message already correlated", {
          ...traceForMessage(message),
          status: "sent",
          stage: "user_message_already_correlated"
        });
        const result = resultFor(message, "sent", null, null, "user_message_already_correlated");
        result.current_context = readCurrentContextSnapshot();
        // The marker-bearing user message is the transport success boundary.
        // Notify Background before optional context binding can yield across a
        // ChatGPT SPA navigation and invalidate this Content Script.
        notifyHandoffSendConfirmed(message, result);
        result.current_context = await readCurrentContextAfterHandoff(message);
        return result;
      }
    }

    const composer = await waitForComposer(message);
    if (!composer) {
      return resultFor(message, "error", "composer_not_found", "ChatGPTの入力欄が見つかりません。", "composer_mount_timeout");
    }
    diagnostic("composer found", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "composer_found",
      composer_type: composerType(composer)
    });

    if (message?.review === true) {
      const existingText = locators.normalizeComposerText?.(locators.readComposerText?.(composer) || "")
        || String(locators.readComposerText?.(composer) || "").trim();
      if (existingText.length > 0) {
        return resultFor(message, "error", "review_composer_not_clean", "Review送信前の入力欄に予期しない本文があります。", "review_composer_check");
      }
      if (!hasVerifiedReviewAttachment(message, composer)) {
        return resultFor(message, "error", "review_media_not_attached", "Review対象の生成物添付完了を確認できません。", "attachment_verification");
      }
    }

    const inputMarkers = {
      protocol: message?.protocol,
      handoffId: message?.handoffId,
      boundaryId: message?.boundaryId
    };
    if (!hasRequiredInputMarkers(inputMarkers)) {
      return resultFor(
        message,
        "error",
        "composer_input_verification_failed",
        "Handoffの送信確認に必要な識別子がありません。",
        "input_identifiers_missing");
    }

    const beforeUserMessages = locators.captureUserMessageSnapshot(document);
    const beforeAssistantMessages = locators.captureAssistantMessageSnapshot?.(document)
      || { count: 0, elements: new Set() };
    diagnostic("input attempted", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_attempted",
      composer_type: composerType(composer)
    });

    let inputResult;
    try {
      inputResult = await fillComposer(composer, message.payload, inputMarkers);
    } catch (_) {
      return resultFor(message, "error", "composer_input_failed", "ChatGPTの入力欄へHandoffを入力できませんでした。", "input_insertion_failed");
    }
    const activeComposer = inputResult?.composer;
    const markerStatus = inputResult?.status || {
      protocol: false,
      handoff_id: false,
      boundary_id: false,
      all: false
    };
    if (!activeComposer || !markerStatus.all) {
      diagnostic("input identifiers missing", {
        request_id: message?.requestId,
        handoff_id: message?.handoffId,
        stage: "input_identifiers_missing",
        protocol_found: markerStatus.protocol,
        handoff_id_found: markerStatus.handoff_id,
        boundary_id_found: markerStatus.boundary_id
      });
      return resultFor(
        message,
        "error",
        "composer_input_verification_failed",
        "Handoffの識別子が入力欄で確認できませんでした。",
        "input_identifiers_missing");
    }
    diagnostic("input identifiers found", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_identifiers_found",
      protocol_found: markerStatus.protocol,
      handoff_id_found: markerStatus.handoff_id,
      boundary_id_found: markerStatus.boundary_id
    });
    diagnostic("input visible", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      stage: "input_visible",
      composer_type: composerType(activeComposer)
    });

    if (message?.review === true && !hasVerifiedReviewAttachment(message, activeComposer)) {
      return resultFor(message, "error", "review_media_not_attached", "Handoff入力後もReview対象の添付を確認できません。", "attachment_verification");
    }

    const sendCandidate = await waitForSendButton(activeComposer, inputMarkers, {
      review: message?.review === true,
      requestId: message?.requestId,
      handoffId: message?.handoffId
    });
    if (sendCandidate.composerStateWasLost || !sendCandidate.composerHasInput) {
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
    if (acceptance.anchor) {
      responseAnchors.set(responseCorrelationKey(message), {
        anchor: acceptance.anchor,
        assistantElements: beforeAssistantMessages.elements,
        createdAt: Date.now()
      });
    }
    diagnostic("user message confirmed", {
      request_id: message?.requestId,
      handoff_id: message?.handoffId,
      status: "sent",
      stage: acceptance.stage
    });
    const result = resultFor(message, "sent", null, null, acceptance.stage);
    // Do not put the Desktop ACK behind new-Conversation URL discovery. Once
    // the correlated user message exists, the Handoff is already posted;
    // ChatGPT may replace this page/context while it creates the route.
    result.current_context = readCurrentContextSnapshot();
    notifyHandoffSendConfirmed(message, result);
    // For a new Chat, ChatGPT may create the conversation URL only after the
    // user message is accepted. Return metadata discovered from the page so
    // Desktop can bind the created conversation without syncing message text.
    result.current_context = await readCurrentContextAfterHandoff(message);
    return result;
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "BRIDGE_STATE_CHANGED") {
      window.dispatchEvent(new CustomEvent(statusEventName, { detail: message.state }));
      return false;
    }
    if (message?.type === contextRequestMessageType) {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      handleGetChatGptContext(message)
        .then(sendResponse)
        .catch((error) => sendResponse(
          message?.collection === "project"
            ? projectChatFailureResult(message, error)
            : contextResultFor(
              message,
              "error",
              "context_extraction_failed",
              "ChatGPTのContext取得に失敗しました。",
              "context_extraction")));
      return true;
    }
    if (message?.type === collectorViewportRequestMessageType) {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      handleGetCollectorViewport(message)
        .then(sendResponse)
        .catch(() => sendResponse(collectorViewportResultFor(
          message,
          "error",
          "collector_viewport_unavailable",
          "Collector viewportの取得に失敗しました。",
          "collector_viewport_extraction")));
      return true;
    }
    if (message?.type === collectorRootHydrationRequestMessageType) {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      handleGetCollectorRootHydration(message)
        .then(sendResponse)
        .catch(() => sendResponse(collectorRootHydrationResultFor(
          message,
          "error",
          "collector_root_hydration_timeout",
          "Root Sidebarのhydrationが完了しませんでした。",
          "collector_root_hydration_timeout")));
      return true;
    }
    if (message?.type === executionReadyMessageType) {
      if (sender?.id && sender.id !== chrome.runtime.id) return false;
      handleChatGptExecutionReady(message)
        .then(sendResponse)
        .catch(() => sendResponse(executionReadyResultFor(
          message,
          "error",
          "conversation_ready_failed",
          "Managed ChatGPTタブの準備に失敗しました。",
          "conversation_ready_unexpected")));
      return true;
    }
    if (message?.type !== handoffMessageType
      && message?.type !== handoffAcceptanceCheckMessageType
      && message?.type !== responseWatchMessageType
      && message?.type !== cancelResponseWatchMessageType
      && message?.type !== reviewMediaAttachBeginMessageType
      && message?.type !== reviewMediaAttachChunkMessageType
      && message?.type !== reviewMediaAttachEndMessageType) return false;
    if (sender?.id && sender.id !== chrome.runtime.id) return false;

    const operation = message?.type === responseWatchMessageType
      ? handleWatchAssistantResponse(message)
      : message?.type === cancelResponseWatchMessageType
        ? handleCancelResponseWatch(message)
      : message?.type === handoffAcceptanceCheckMessageType
        ? handleHandoffAcceptanceCheck(message)
      : message?.type === handoffMessageType
        ? handleHandoffSend(message)
        : message?.type === reviewMediaAttachBeginMessageType
          ? handleReviewMediaAttachBegin(message)
          : message?.type === reviewMediaAttachChunkMessageType
            ? Promise.resolve(handleReviewMediaAttachChunk(message))
            : handleReviewMediaAttachEnd(message);
    void operation
      .then(sendResponse)
      .catch(() => sendResponse(message?.type === responseWatchMessageType
        ? responseResultFor(message, "error", "response_extraction_failed", "assistant応答の監視を開始できませんでした。", "unexpected_error")
        : [reviewMediaAttachBeginMessageType, reviewMediaAttachChunkMessageType, reviewMediaAttachEndMessageType].includes(message?.type)
          ? mediaResultFor(message, "error", "attachment_upload_failed", "ChatGPTへの生成物添付処理に失敗しました。", "unexpected_error")
          : resultFor(message, "error", "send_failed", "ChatGPTへの送信処理に失敗しました。", "unexpected_error")));
    return true;
  });

  diagnostic("content script lifecycle", contentLifecycleTrace(null, {
    status: "ready",
    stage: "content_script_ready",
    assistant_state: "not_detected",
    watcher_state: "idle"
  }));
  void sendRuntimeMessage({
    type: "CONTENT_SCRIPT_READY",
    context: readCurrentContextSnapshot()
  });
  installLifecycleTelemetry();
  installContextMonitor();
})();
