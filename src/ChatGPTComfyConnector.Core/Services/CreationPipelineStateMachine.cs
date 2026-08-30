using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public static class CreationPipelineStateMachine
{
    public static readonly CreationStage[] OrderedStages =
    [
        CreationStage.Connect,
        CreationStage.Context,
        CreationStage.Idea,
        CreationStage.ToChatGpt,
        CreationStage.Command,
        CreationStage.Apply,
        CreationStage.Generate,
        CreationStage.Output,
        CreationStage.Review,
    ];

    public static void EnsureInitialized(CreationSession session)
    {
        session.Pipeline ??= new CreationPipelineSnapshot();
        session.Pipeline.Version = 7;
        EnsureRunInitialized(session);
        foreach (var stage in OrderedStages)
        {
            if (session.Pipeline.Stages.All(item => item.Stage != stage))
            {
                session.Pipeline.Stages.Add(new CreationStageStatus { Stage = stage });
            }
        }
        session.Pipeline.Stages = session.Pipeline.Stages.OrderBy(item => Array.IndexOf(OrderedStages, item.Stage)).ToList();

        if (session.Pipeline.Stages.All(item => item.State == CreationStageState.NotReached))
        {
            InferLegacyState(session);
        }

        // A confirmed Bootstrap Handoff is a durable pipeline boundary. If a
        // refresh or an older persisted snapshot ever leaves the stage at
        // NotReached while the immutable pending snapshot is still present,
        // restore the waiting state from the same source of truth. Explicit
        // kickoff/context edits clear both markers, so this does not mask a
        // genuine re-send boundary.
        if (session.Pipeline.ContextBound
            && session.Pipeline.SentIdeaSnapshot is not null
            && session.PendingHandoff is { } pending
            && PendingHandoffReuse.IsBootstrap(pending))
        {
            var handoff = session.Pipeline.Stages.Single(item => item.Stage == CreationStage.ToChatGpt);
            if (handoff.State == CreationStageState.NotReached)
            {
                var delivery = session.HandoffMessages.LastOrDefault(item =>
                    item.Direction == HandoffDirection.ConnectorToChatGpt
                    && item.Kind == HandoffMessageKind.CreationRequest
                    && PendingHandoffReuse.MatchesPayload(pending, item.Payload));
                if (delivery?.State is HandoffTransportState.Waiting or HandoffTransportState.Failed)
                {
                    Set(session, CreationStage.Idea, CreationStageState.Current, "送信エラー · 同じHandoffを再送できます");
                    Set(session, CreationStage.ToChatGpt, CreationStageState.Error, "自動送信が完了していません · 同じHandoffを再送できます");
                    ResetAfter(session, CreationStage.ToChatGpt);
                }
                else
                {
                    var wasSent = delivery?.State == HandoffTransportState.Sent;
                    var detail = wasSent
                        ? "Handoff送信済み · ChatGPTからの返答待ち"
                        : "Clipboardへコピー済み · ChatGPTへ貼り付け待ち";
                    Set(
                        session,
                        CreationStage.ToChatGpt,
                        CreationStageState.WaitingUser,
                        detail,
                        wasSent ? CreationWaitingReason.ChatGptResponseRequired : CreationWaitingReason.ChatGptPasteRequired);
                }
            }
        }
    }

    public static CreationStageStatus Get(CreationSession session, CreationStage stage)
    {
        EnsureInitialized(session);
        return session.Pipeline.Stages.Single(item => item.Stage == stage);
    }

    public static CreationStageStatus EvaluateConnectionGate(ConnectionState connectionState, bool hasSessionProgress)
    {
        var (state, detail, waitingReason) = connectionState switch
        {
            ConnectionState.Connecting => (CreationStageState.InProgress, "MCPへ接続中", CreationWaitingReason.None),
            ConnectionState.Connected => (CreationStageState.Completed, "MCP接続済み · ComfyUIの状態は必要な処理の直前に確認します", CreationWaitingReason.None),
            ConnectionState.Error or ConnectionState.Unavailable => (CreationStageState.Error, "制作通信を確立できませんでした · 接続診断を確認してください", CreationWaitingReason.None),
            _ when hasSessionProgress => (CreationStageState.WaitingUser, "制作データを保持しています · 再接続すると続行できます", CreationWaitingReason.ReconnectRequired),
            _ => (CreationStageState.Current, "CONNECTでMCP接続を確立してください", CreationWaitingReason.None),
        };
        return new CreationStageStatus { Stage = CreationStage.Connect, State = state, WaitingReason = waitingReason, Detail = detail };
    }

    /// <summary>
    /// Resolves the concise user-facing label for a stage state. WaitingUser is
    /// intentionally explained by its structured reason rather than its enum name.
    /// The stage fallback keeps older persisted snapshots understandable when the
    /// new WaitingReason field is absent.
    /// </summary>
    public static string GetStageStateLabel(CreationStageStatus status)
        => status.State switch
        {
            CreationStageState.Completed => "完了",
            CreationStageState.Current => "現在",
            CreationStageState.WaitingUser => GetWaitingReasonLabel(status.Stage, status.WaitingReason),
            CreationStageState.InProgress => "処理中",
            CreationStageState.Error => "エラー",
            CreationStageState.Cancelled => "キャンセル",
            CreationStageState.Skipped => "スキップ",
            _ => "未到達",
        };

    public static string GetWaitingReasonLabel(CreationStage stage, CreationWaitingReason reason)
        => reason switch
        {
            CreationWaitingReason.ComfyUiStartRequired => "ComfyUI起動待ち",
            CreationWaitingReason.ReconnectRequired => "再接続待ち",
            CreationWaitingReason.ConnectionCheckRequired => "接続確認待ち",
            CreationWaitingReason.ChatGptPasteRequired => "ChatGPTへ貼り付け待ち",
            CreationWaitingReason.ChatGptResponseRequired => "ChatGPT返答待ち",
            CreationWaitingReason.ReviewResponseRequired => "レビュー返答待ち",
            CreationWaitingReason.ContinueDecisionRequired => "続行判断待ち",
            CreationWaitingReason.UserActionRequired => "操作待ち",
            _ => stage switch
            {
                CreationStage.Connect => "再接続待ち",
                CreationStage.ToChatGpt => "ChatGPT返答待ち",
                CreationStage.Review => "レビュー返答待ち",
                _ => "確認待ち",
            },
        };

    public static void SynchronizeConnectionGate(CreationSession session, ConnectionState connectionState, string? detail = null)
    {
        EnsureInitialized(session);
        var hasSessionProgress = session.Pipeline.ContextBound
            || OrderedStages.Skip(2).Any(stage => Get(session, stage).State != CreationStageState.NotReached);
        var evaluated = EvaluateConnectionGate(connectionState, hasSessionProgress);
        Set(session, CreationStage.Connect, evaluated.State, detail ?? evaluated.Detail, evaluated.WaitingReason);
        if (!session.Pipeline.ContextBound)
        {
            Set(session, CreationStage.Context,
                evaluated.State == CreationStageState.Completed ? CreationStageState.Current : CreationStageState.NotReached,
                evaluated.State == CreationStageState.Completed ? "Workflow / Project / Chat / Maximum Iterations / Slot Schemaを設定してください" : string.Empty);
        }
    }

    public static void RequireConnection(CreationSession session)
    {
        EnsureInitialized(session);
        if (Get(session, CreationStage.Connect).State != CreationStageState.Completed)
        {
            throw new InvalidOperationException("MCP接続を確立してから制作を続行してください。");
        }
    }

    /// <summary>
    /// Blocks only the stage that actually needs a running ComfyUI instance.
    /// CONNECT remains an MCP-only gate; callers pass the latest running check
    /// immediately before invoking the ComfyUI-dependent operation.
    /// </summary>
    public static void RequireComfyUi(CreationSession session, CreationStage stage, bool comfyUiReachable)
    {
        RequireConnection(session);
        if (comfyUiReachable) return;

        Set(session, stage, CreationStageState.WaitingUser, "ComfyUIを起動してからこの工程を続行してください", CreationWaitingReason.ComfyUiStartRequired);
        throw new InvalidOperationException("ComfyUI起動待ちです。ComfyUIを起動してからもう一度実行してください。");
    }

    /// <summary>
    /// Marks a ComfyUI-dependent stage as actively starting the runtime.  This
    /// is intentionally different from <see cref="RequireComfyUi"/>: the
    /// normal GENERATE path starts ComfyUI itself, so it is not waiting for a
    /// user action while the endpoint becomes ready.
    /// </summary>
    public static void BeginComfyUiStartup(CreationSession session, CreationStage stage)
    {
        RequireConnection(session);
        SetGenerateExecutionState(session, GenerateExecutionState.StartingComfyUi);
        Set(session, stage, CreationStageState.InProgress, "ComfyUI起動中");
    }

    public static void WaitingForComfyUi(CreationSession session, CreationStage stage)
    {
        RequireConnection(session);
        SetGenerateExecutionState(session, GenerateExecutionState.WaitingForComfyUi);
        Set(session, stage, CreationStageState.InProgress, "ComfyUIのREADYを待機中");
    }

    /// <summary>
    /// Records a failed automatic/manual startup on the stage that requested
    /// ComfyUI.  Do not reset downstream stages here: a later iteration may
    /// still have a successful Output/Review that must remain visible.
    /// </summary>
    public static void ComfyUiStartupFailed(CreationSession session, CreationStage stage, string detail)
    {
        EnsureInitialized(session);
        SetGenerateExecutionState(session, GenerateExecutionState.GenerationFailed);
        Set(session, stage, CreationStageState.Error, detail);
    }

    public static void PrepareContext(CreationSession session, string detail = "CONNECTで制作通信を確認してください")
    {
        EnsureInitialized(session);
        session.PendingHandoff = null;
        // A new context cannot reuse a media registration or its Review
        // attachment evidence. The Desktop revokes the process-local media
        // registration before calling this boundary; the state machine also
        // clears the persisted projection so stale media is not shown.
        session.Pipeline.ReviewMediaAttachment = null;
        session.Pipeline.ContextBound = false;
        session.Pipeline.MaximumIterationSafetyStop = false;
        session.Pipeline.SentIdeaSnapshot = null;
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.AutomaticResponseExecution = null;
        session.Pipeline.ReviewHandoff = null;
        session.Pipeline.AutomaticIteration = null;
        session.Pipeline.CurrentRun = null;
        session.Pipeline.DeferredGenerate = null;
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        SetAllFrom(session, CreationStage.Connect, CreationStageState.NotReached);
        Set(session, CreationStage.Connect, CreationStageState.Current, detail);
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void BindContext(CreationSession session)
    {
        RequireConnection(session);
        if (session.BoundWorkflow is null || !session.HasBoundProjectChat || session.MaximumIterations < 1)
        {
            throw new InvalidOperationException("Workflow・Project・Chat・Maximum Iterationsをすべて設定してください。");
        }
        EnsureInitialized(session);
        // Rebinding Workflow / Project / Chat / iteration context is an
        // explicit Handoff boundary. Any response issued for the previous
        // binding must become stale instead of being accepted against the new
        // context.
        session.PendingHandoff = null;
        // Binding a new context starts a new Review/media boundary. The
        // Desktop revokes the old process-local registration before this call.
        session.Pipeline.ReviewMediaAttachment = null;
        session.Pipeline.ContextBound = true;
        session.Pipeline.IterationNumber = session.CurrentIteration;
        session.Pipeline.MaximumIterationSafetyStop = false;
        session.Pipeline.SentIdeaSnapshot = null;
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.AutomaticResponseExecution = null;
        session.Pipeline.ReviewHandoff = null;
        session.Pipeline.AutomaticIteration = null;
        session.Pipeline.DeferredGenerate = null;
        if (session.Pipeline.CurrentRun is null)
        {
            session.Pipeline.CurrentRun = new CreationRunSnapshot
            {
                RunId = Guid.NewGuid().ToString("N"),
                Number = 1,
                StartIteration = 0,
                IterationCount = session.CurrentIteration,
                StartedReason = "initial",
            };
        }
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        SetAllFrom(session, CreationStage.Context, CreationStageState.NotReached);
        Set(session, CreationStage.Context, CreationStageState.Completed, "制作セッションへContextをBinding済み");
        Set(session, CreationStage.Idea, CreationStageState.Current, "開始指示・補足は任意です · SEND TO CHATGPTで開始");
        session.Status = SessionStatus.Active;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void IdeaChanged(CreationSession session, string idea)
    {
        EnsureInitialized(session);
        if (!session.Pipeline.ContextBound) return;
        if (session.Pipeline.SentIdeaSnapshot is null)
        {
            if (session.PendingHandoff is not null
                && !string.Equals(
                    PendingHandoffReuse.NormalizeKickoffInstruction(PendingHandoffReuse.GetKickoffInstruction(session.PendingHandoff, session)),
                    PendingHandoffReuse.NormalizeKickoffInstruction(idea),
                    StringComparison.Ordinal))
            {
                // A kickoff edit made after Prepare but before confirmation
                // invalidates that issued snapshot as well. The next explicit
                // SEND creates a fresh identity for the new instruction.
                session.PendingHandoff = null;
            }
            Set(session, CreationStage.Idea, CreationStageState.Current, string.IsNullOrWhiteSpace(idea) ? "開始指示・補足は任意です · SEND TO CHATGPTで開始" : "開始指示を入力中 · SEND TO CHATGPTで開始");
            return;
        }
        if (string.Equals(
                PendingHandoffReuse.NormalizeKickoffInstruction(session.Pipeline.SentIdeaSnapshot),
                PendingHandoffReuse.NormalizeKickoffInstruction(idea),
                StringComparison.Ordinal))
        {
            return;
        }

        Set(session, CreationStage.Idea, CreationStageState.Current, "送信後に変更されました · 再送信が必要です");
        ResetAfter(session, CreationStage.Idea);
        session.PendingHandoff = null;
        session.Pipeline.SentIdeaSnapshot = null;
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.AutomaticResponseExecution = null;
        session.Pipeline.ReviewHandoff = null;
        session.Pipeline.AutomaticIteration = null;
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        session.Pipeline.MaximumIterationSafetyStop = false;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Records that the initial Handoff was copied. The kickoff instruction is
    /// optional; an empty value delegates the creative brief to the selected
    /// ChatGPT conversation's existing history.
    /// </summary>
    public static void BootstrapCopied(CreationSession session, string idea)
        => BootstrapTransported(
            session,
            idea,
            "制作ContextをClipboardへ生成済み",
            "Clipboardへコピー済み · ChatGPTへ貼り付け待ち",
            CreationWaitingReason.ChatGptPasteRequired);

    /// <summary>
    /// Records that the initial Handoff was delivered by the authenticated
    /// Browser Extension Bridge. This advances exactly the same pipeline
    /// boundary as the legacy Clipboard path while keeping the transport
    /// state visible as SENT.
    /// </summary>
    public static void BootstrapSent(CreationSession session, string idea)
        => BootstrapTransported(
            session,
            idea,
            "制作ContextをExtensionへ送信済み",
            "Handoff送信済み · ChatGPTからの返答待ち",
            CreationWaitingReason.ChatGptResponseRequired);

    /// <summary>
    /// Records an automatic Bootstrap delivery failure without destroying the
    /// issued PendingHandoff. The IDEA stage remains retryable and the
    /// TO CHATGPT stage carries the error until the user retries or explicitly
    /// chooses the timeline Clipboard action.
    /// </summary>
    public static void BootstrapSendFailed(CreationSession session, string detail)
    {
        EnsureInitialized(session);
        Set(session, CreationStage.Idea, CreationStageState.Current, "送信エラー · 同じHandoffを再送できます");
        Set(session, CreationStage.ToChatGpt, CreationStageState.Error, detail);
        ResetAfter(session, CreationStage.ToChatGpt);
    }

    /// <summary>
    /// Records that the assistant response belonging to the current sent
    /// Handoff was received. The Desktop may then choose the automatic
    /// strict-validate/apply/generate path or leave the Command waiting for
    /// the user's manual confirmation controls. This transition itself never
    /// performs validation or side effects.
    /// </summary>
    public static void ConnectorResponseReceived(CreationSession session)
    {
        EnsureInitialized(session);
        var isReviewResponse = IsReviewResponse(session);
        Set(session, CreationStage.ToChatGpt, CreationStageState.Completed, "ChatGPTのassistant応答を受信済み");
        Set(session, CreationStage.Command, CreationStageState.WaitingUser, "CHATGPT COMMANDを受信 · 読み込んで確認してください", CreationWaitingReason.UserActionRequired);
        // A Review response is allowed to decide the next iteration or to
        // complete the session, so its prior successful Output/Review evidence
        // must remain available while strict validation and automatic APPLY
        // begin. Bootstrap responses have no such downstream evidence and keep
        // the original reset behavior.
        if (!isReviewResponse) ResetAfter(session, CreationStage.Command);
    }

    /// <summary>
    /// Keeps the issued Pending Handoff intact when assistant response
    /// monitoring or Desktop-side validation fails.  The user can still use
    /// the existing Command editor or explicitly retry the Handoff boundary.
    /// </summary>
    public static void ConnectorResponseFailed(CreationSession session, string detail)
    {
        EnsureInitialized(session);
        var isReviewResponse = IsReviewResponse(session);
        Set(session, CreationStage.Command, CreationStageState.Error, detail);
        if (!isReviewResponse) ResetAfter(session, CreationStage.Command);
    }

    private static void BootstrapTransported(
        CreationSession session,
        string idea,
        string ideaDetail,
        string handoffDetail,
        CreationWaitingReason waitingReason)
    {
        RequireContext(session);
        session.Pipeline.SentIdeaSnapshot = PendingHandoffReuse.NormalizeKickoffInstruction(idea);
        session.Pipeline.AcceptedCommandAction = null;
        // A new transport attempt starts a new assistant-response execution
        // boundary. Keep the session and PendingHandoff identity intact, but
        // do not let the previous response's terminal idempotency record make
        // the next explicit send look already processed.
        session.Pipeline.AutomaticResponseExecution = null;
        session.Pipeline.ReviewHandoff = null;
        session.Pipeline.AutomaticIteration = null;
        Set(session, CreationStage.Idea, CreationStageState.Completed, ideaDetail);
        Set(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser, handoffDetail, waitingReason);
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        ResetAfter(session, CreationStage.ToChatGpt);
    }

    public static void BeginCommandValidation(CreationSession session)
    {
        RequireContext(session);
        var handoff = Get(session, CreationStage.ToChatGpt).State;
        // The pending snapshot is the durable response boundary.  In
        // particular, a Review response must remain identifiable even after
        // COMMAND validation starts changing transient pipeline states.
        var isReviewResponse = IsReviewResponse(session);
        if (handoff is not (CreationStageState.WaitingUser or CreationStageState.Completed)
            && !isReviewResponse)
        {
            throw new InvalidOperationException("先にSEND TO CHATGPTで制作ContextをHandoffしてください。");
        }
        Set(session, CreationStage.Command, CreationStageState.InProgress, "Connector Commandを解析・検証中");
        // A Bootstrap response starts a new command branch, so its downstream
        // stages are reset as before.  A Review response must retain the
        // successful Output, Review context, and history until validation has
        // completed; otherwise the response would erase the evidence needed
        // to accept `complete` or continue with `generate`.
        if (!isReviewResponse) ResetAfter(session, CreationStage.Command);
    }

    public static void CommandReplaced(CreationSession session)
    {
        EnsureInitialized(session);
        if (Get(session, CreationStage.Command).State == CreationStageState.NotReached) return;
        Set(session, CreationStage.Command, CreationStageState.Current, "Commandが変更されました · 再検証が必要です");
        if (!IsReviewResponse(session)) ResetAfter(session, CreationStage.Command);
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.MaximumIterationSafetyStop = false;
    }

    public static void CommandValidationFailed(CreationSession session, string detail)
    {
        Set(session, CreationStage.Command, CreationStageState.Error, detail);
        // Keep a Review response boundary and its successful Output intact so
        // the user can correct and resubmit the same command.  Bootstrap
        // validation keeps the original downstream reset behavior.
        if (!IsReviewResponse(session)) ResetAfter(session, CreationStage.Command);
    }

    public static void CommandValidated(CreationSession session, string action)
    {
        RequireContext(session);
        var isReviewResponse = IsReviewResponse(session);

        if (action == "complete")
        {
            if (!HasSuccessfulOutput(session) || !isReviewResponse)
            {
                Set(session, CreationStage.Command, CreationStageState.Error, "completeはOutput成功後のREVIEWでのみ受理できます");
                throw new InvalidOperationException("completeは、少なくとも1回Outputが成功したREVIEW工程でのみ受理できます。");
            }

            Set(session, CreationStage.Review, CreationStageState.Completed, "ChatGPTが完成を承認");
            Set(session, CreationStage.ToChatGpt, CreationStageState.Completed, "有効なConnector Commandを受信");
            Set(session, CreationStage.Command, CreationStageState.Completed, "Protocol・Action・Schema・Workflow整合性を確認済み");
            session.Pipeline.AcceptedCommandAction = action;
            SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
            return;
        }

        Set(session, CreationStage.ToChatGpt, CreationStageState.Completed, "有効なConnector Commandを受信");
        Set(session, CreationStage.Command, CreationStageState.Completed, "Protocol・Action・Schema・Workflow整合性を確認済み");
        session.Pipeline.AcceptedCommandAction = action;
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        if (isReviewResponse) Set(session, CreationStage.Review, CreationStageState.Completed, "次のIterationへ進みます");

        if (isReviewResponse && session.AtRunIterationLimit)
        {
            session.Pipeline.MaximumIterationSafetyStop = true;
            ResetFrom(session, CreationStage.Apply);
            Set(session, CreationStage.Review, CreationStageState.WaitingUser, "最大反復回数に達しました · 続行するか判断してください", CreationWaitingReason.ContinueDecisionRequired);
            return;
        }

        session.Pipeline.IterationNumber = session.CurrentIteration + 1;
        Set(session, CreationStage.Apply, CreationStageState.Current, "検証済みCommandをWorkflowへ反映できます");
        ResetAfter(session, CreationStage.Apply);
    }

    public static void BeginApply(CreationSession session)
    {
        RequireConnection(session);
        Set(session, CreationStage.Apply, CreationStageState.InProgress, "Backup → slot反映 → 保存 → validateを実行中");
    }

    public static void ApplyCompleted(CreationSession session)
    {
        Set(session, CreationStage.Apply, CreationStageState.Completed, "Backup・slot反映・保存・validate完了");
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        Set(session, CreationStage.Generate, CreationStageState.Current, "生成を開始できます");
        ResetAfter(session, CreationStage.Generate);
    }

    public static void ApplyFailed(CreationSession session, string detail)
    {
        Set(session, CreationStage.Apply, CreationStageState.Error, detail);
        // APPLY did not reach GENERATE. Keep the GENERATE substate retryable
        // and let the APPLY stage carry the failure itself.
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        ResetAfter(session, CreationStage.Apply);
    }

    public static void BeginGenerate(CreationSession session)
    {
        RequireConnection(session);
        if (session.Pipeline.MaximumIterationSafetyStop || session.Status == SessionStatus.LimitReached || session.AtRunIterationLimit)
            throw new InvalidOperationException("このRunの最大反復回数に達しています。RESUMEで次のRunを開始してください。");
        // A new generation owns a new Primary Output. Do not carry the prior
        // iteration's temporary attachment state into the next Review stage.
        session.Pipeline.ReviewMediaAttachment = null;
        SetGenerateExecutionState(session, GenerateExecutionState.Generating);
        Set(session, CreationStage.Generate, CreationStageState.InProgress, "Jobを投入しています");
        ResetAfter(session, CreationStage.Generate);
    }

    public static void JobStatusChanged(CreationSession session, JobStatus status, string? detail = null)
    {
        switch (status)
        {
            case JobStatus.Queued:
            case JobStatus.Running:
                SetGenerateExecutionState(session, GenerateExecutionState.Generating);
                Set(session, CreationStage.Generate, CreationStageState.InProgress, detail ?? status.ToString());
                break;
            case JobStatus.Completed:
                SetGenerateExecutionState(session, GenerateExecutionState.Generating);
                Set(session, CreationStage.Generate, CreationStageState.Completed, "ComfyUI Job完了");
                Set(session, CreationStage.Output, CreationStageState.InProgress, "出力ファイルを取得・確認中");
                break;
            case JobStatus.Failed:
                SetGenerateExecutionState(session, GenerateExecutionState.GenerationFailed);
                Set(session, CreationStage.Generate, CreationStageState.Error, detail ?? "ComfyUI Job失敗");
                ResetAfter(session, CreationStage.Generate);
                break;
            case JobStatus.Cancelled:
                SetGenerateExecutionState(session, GenerateExecutionState.GenerationFailed);
                Set(session, CreationStage.Generate, CreationStageState.Cancelled, detail ?? "ユーザーが生成をキャンセル");
                ResetAfter(session, CreationStage.Generate);
                break;
        }
    }

    public static void OutputCompleted(CreationSession session, IReadOnlyCollection<OutputArtifact> outputs)
    {
        var valid = outputs.Where(item => !item.IsMissing).ToArray();
        if (valid.Length == 0)
        {
            OutputFailed(session, outputs.Count == 0 ? "出力が0件です" : "取得した出力ファイルが見つかりません");
            return;
        }
        Set(session, CreationStage.Output, CreationStageState.Completed, $"有効な出力 {valid.Length}件を履歴へ登録済み");
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        // A completed iteration owns a new media attachment boundary. Do not
        // carry the previous iteration's media id into the new Review stage.
        // When legacy resume logic replays OutputCompleted for the same
        // iteration, only terminal attachment evidence is retained; an old
        // Preparing/Attaching state must not leave the Review stage stuck.
        var existingAttachment = session.Pipeline.ReviewMediaAttachment;
        if (existingAttachment is null
            || existingAttachment.Iteration != session.CurrentIteration
            || existingAttachment.State is ReviewMediaAttachmentState.Preparing or ReviewMediaAttachmentState.Attaching)
        {
            session.Pipeline.ReviewMediaAttachment = null;
        }
        var reviewDetail = session.Pipeline.ReviewMediaAttachment?.State switch
        {
            ReviewMediaAttachmentState.Attached => "生成結果をChatGPTへ添付済み · Review Handoff送信待ち",
            ReviewMediaAttachmentState.Failed => $"生成結果のChatGPT添付に失敗 · {session.Pipeline.ReviewMediaAttachment.ErrorCode ?? "再試行できます"} · 再試行できます",
            _ => "生成結果を確認しChatGPTへ渡してください",
        };
        var reviewState = session.Pipeline.ReviewMediaAttachment?.State == ReviewMediaAttachmentState.Failed
            ? CreationStageState.Error
            : CreationStageState.Current;
        Set(session, CreationStage.Review, reviewState, reviewDetail);
        session.Pipeline.IterationNumber = session.CurrentIteration;
    }

    public static void OutputFailed(CreationSession session, string detail)
    {
        // Output failure belongs to the current generation boundary. Any
        // attachment state left by a previous or partially fetched output is
        // stale; the Desktop revokes its process-local media registration
        // before starting the next generation.
        session.Pipeline.ReviewMediaAttachment = null;
        SetGenerateExecutionState(session, GenerateExecutionState.GenerationFailed);
        Set(session, CreationStage.Output, CreationStageState.Error, detail);
        Set(session, CreationStage.Review, CreationStageState.NotReached, string.Empty);
    }

    public static void ReviewCopied(CreationSession session)
        => Set(session, CreationStage.Review, CreationStageState.WaitingUser, "Manual Handoff · ChatGPTの評価待ち", CreationWaitingReason.ReviewResponseRequired);

    public static void ReviewMediaPreparing(
        CreationSession session,
        int iteration,
        string sessionId,
        string outputIdentity,
        string fileName,
        string mimeType,
        long size)
    {
        EnsureInitialized(session);
        session.Pipeline.ReviewMediaAttachment = new ReviewMediaAttachmentSnapshot
        {
            State = ReviewMediaAttachmentState.Preparing,
            SessionId = sessionId,
            Iteration = iteration,
            OutputIdentity = outputIdentity,
            FileName = fileName,
            MimeType = mimeType,
            Size = size,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        Set(session, CreationStage.Review, CreationStageState.InProgress, "生成結果をChatGPTへ添付準備中");
    }

    public static void ReviewMediaAttaching(
        CreationSession session,
        string requestId,
        string mediaId,
        int? targetTabId = null,
        string? targetTabUrl = null)
    {
        EnsureInitialized(session);
        var attachment = session.Pipeline.ReviewMediaAttachment
            ?? throw new InvalidOperationException("Review添付対象が準備されていません。");
        attachment.State = ReviewMediaAttachmentState.Attaching;
        attachment.RequestId = requestId;
        attachment.MediaId = mediaId;
        attachment.TargetTabId = targetTabId;
        attachment.TargetTabUrl = targetTabUrl;
        attachment.ErrorCode = null;
        attachment.ErrorStage = null;
        attachment.ErrorMessage = null;
        attachment.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.InProgress, "生成結果をChatGPTへ添付中");
    }

    public static void ReviewMediaAttached(CreationSession session, BrowserExtensionMediaAttachResult result)
    {
        EnsureInitialized(session);
        var attachment = session.Pipeline.ReviewMediaAttachment
            ?? throw new InvalidOperationException("Review添付対象が準備されていません。");
        attachment.State = ReviewMediaAttachmentState.Attached;
        attachment.RequestId = result.RequestId;
        attachment.MediaId = result.MediaId;
        attachment.ErrorCode = null;
        attachment.ErrorStage = null;
        attachment.ErrorMessage = null;
        attachment.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.Current, "生成結果をChatGPTへ添付済み · Review Handoff送信待ち");
    }

    public static void ReviewMediaFailed(
        CreationSession session,
        string errorCode,
        string? stage,
        string? message)
    {
        EnsureInitialized(session);
        var attachment = session.Pipeline.ReviewMediaAttachment
            ?? throw new InvalidOperationException("Review添付対象が準備されていません。");
        attachment.State = ReviewMediaAttachmentState.Failed;
        attachment.ErrorCode = errorCode;
        attachment.ErrorStage = stage;
        attachment.ErrorMessage = message;
        attachment.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.Error, $"生成結果のChatGPT添付に失敗 · {errorCode} · 再試行できます");
    }

    public static void AutomaticIterationStarted(CreationSession session)
    {
        EnsureInitialized(session);
        var current = session.Pipeline.AutomaticIteration;
        session.Pipeline.AutomaticIteration = new AutomaticIterationSnapshot
        {
            State = AutomaticIterationState.Running,
            SessionId = session.Id,
            Iteration = current?.Iteration ?? session.CurrentIteration,
            ReviewHandoffId = current?.ReviewHandoffId ?? string.Empty,
            ReviewBoundaryId = current?.ReviewBoundaryId ?? string.Empty,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void ReviewHandoffPreparing(
        CreationSession session,
        PendingHandoffSnapshot pending,
        int iteration,
        int? targetTabId,
        string? targetTabUrl)
    {
        EnsureInitialized(session);
        session.Pipeline.ReviewHandoff = new ReviewHandoffSnapshot
        {
            State = ReviewHandoffState.Preparing,
            SessionId = session.Id,
            Iteration = iteration,
            HandoffId = pending.HandoffId,
            BoundaryId = pending.BoundaryId,
            TargetTabId = targetTabId,
            TargetTabUrl = targetTabUrl,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        Set(session, CreationStage.Review, CreationStageState.InProgress, "Review Handoffを準備中");
    }

    public static void ReviewHandoffSending(CreationSession session, string requestId)
    {
        EnsureInitialized(session);
        var review = session.Pipeline.ReviewHandoff
            ?? throw new InvalidOperationException("Review Handoffの送信境界が準備されていません。");
        review.State = ReviewHandoffState.Sending;
        review.RequestId = requestId;
        review.ErrorCode = null;
        review.ErrorStage = null;
        review.ErrorMessage = null;
        review.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.InProgress, "Review HandoffをChatGPTへ送信中");
    }

    public static void ReviewHandoffSent(CreationSession session, BrowserExtensionHandoffSendResult result)
    {
        EnsureInitialized(session);
        var review = session.Pipeline.ReviewHandoff
            ?? throw new InvalidOperationException("Review Handoffの送信境界が準備されていません。");
        review.State = ReviewHandoffState.WaitingResponse;
        review.RequestId = result.RequestId;
        review.UpdatedAt = DateTimeOffset.UtcNow;
        session.Pipeline.AutomaticIteration ??= new AutomaticIterationSnapshot
        {
            SessionId = session.Id,
            Iteration = review.Iteration,
            ReviewHandoffId = review.HandoffId,
            ReviewBoundaryId = review.BoundaryId,
        };
        session.Pipeline.AutomaticIteration.State = AutomaticIterationState.WaitingForReviewResponse;
        session.Pipeline.AutomaticIteration.Iteration = review.Iteration;
        session.Pipeline.AutomaticIteration.ReviewHandoffId = review.HandoffId;
        session.Pipeline.AutomaticIteration.ReviewBoundaryId = review.BoundaryId;
        session.Pipeline.AutomaticIteration.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.WaitingUser, "Review Handoff送信済み · ChatGPTのレビュー返答待ち", CreationWaitingReason.ReviewResponseRequired);
    }

    public static void ReviewHandoffCopied(CreationSession session)
    {
        EnsureInitialized(session);
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.None;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        // Clipboard fallback is an explicit user choice.  If the automatic
        // loop was waiting for this boundary, close that loop so a late
        // assistant response cannot resume it after the user may already have
        // pasted the same Handoff manually.  Keep the session active: the
        // copied Handoff remains available for a later explicit recovery.
        if (session.Pipeline.AutomaticIteration is { State: AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse } automatic)
        {
            automatic.State = AutomaticIterationState.Stopped;
            automatic.ErrorCode = BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled;
            automatic.ErrorStage = "manual_clipboard_fallback";
            automatic.ErrorMessage = "ユーザーがReview HandoffをClipboardへコピーしました。";
            automatic.UpdatedAt = DateTimeOffset.UtcNow;
        }
        Set(session, CreationStage.Review, CreationStageState.WaitingUser, "Review HandoffをClipboardへコピー済み · ChatGPTのレビュー待ち", CreationWaitingReason.ReviewResponseRequired);
    }

    public static void ReviewHandoffFailed(CreationSession session, string errorCode, string? stage, string? message)
    {
        EnsureInitialized(session);
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Failed;
            review.ErrorCode = errorCode;
            review.ErrorStage = stage;
            review.ErrorMessage = message;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        if (session.Pipeline.AutomaticIteration is { } automatic)
        {
            automatic.State = AutomaticIterationState.Failed;
            automatic.ErrorCode = errorCode;
            automatic.ErrorStage = stage;
            automatic.ErrorMessage = message;
            automatic.UpdatedAt = DateTimeOffset.UtcNow;
        }
        Set(session, CreationStage.Review, CreationStageState.Error, $"Review Handoff送信に失敗 · {errorCode} · 再試行できます");
    }

    public static void ReviewHandoffResponseReceived(CreationSession session)
    {
        EnsureInitialized(session);
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Received;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        if (session.Pipeline.AutomaticIteration is { } automatic)
        {
            automatic.State = AutomaticIterationState.Running;
            automatic.UpdatedAt = DateTimeOffset.UtcNow;
        }
        Set(session, CreationStage.Review, CreationStageState.InProgress, "Review Responseを受信 · strict validation中");
    }

    public static void AutomaticIterationFailed(CreationSession session, string errorCode, string? stage, string? message)
    {
        EnsureInitialized(session);
        if (session.Pipeline.AutomaticIteration is { } automatic)
        {
            automatic.State = AutomaticIterationState.Failed;
            automatic.ErrorCode = errorCode;
            automatic.ErrorStage = stage;
            automatic.ErrorMessage = message;
            automatic.UpdatedAt = DateTimeOffset.UtcNow;
        }
        Set(session, CreationStage.Review, CreationStageState.Error, $"自動Iterationを停止 · {errorCode}");
    }

    public static void AutomaticIterationStopped(CreationSession session, string message = "ユーザーが自動Iterationを停止しました")
    {
        EnsureInitialized(session);
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Stopped;
            review.ErrorCode = BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled;
            review.ErrorStage = "automatic_iteration_cancelled";
            review.ErrorMessage = message;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        session.Pipeline.AutomaticIteration ??= new AutomaticIterationSnapshot { SessionId = session.Id, Iteration = session.CurrentIteration };
        session.Pipeline.AutomaticIteration.State = AutomaticIterationState.Stopped;
        session.Pipeline.AutomaticIteration.ErrorCode = BrowserExtensionHandoffErrorCodes.AutomaticIterationCancelled;
        session.Pipeline.AutomaticIteration.ErrorStage = "automatic_iteration_cancelled";
        session.Pipeline.AutomaticIteration.ErrorMessage = message;
        session.Pipeline.AutomaticIteration.UpdatedAt = DateTimeOffset.UtcNow;
        Set(session, CreationStage.Review, CreationStageState.Error, $"自動Iterationを停止 · {message}");
        session.Status = SessionStatus.Paused;
        session.PauseReason = message;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void AutomaticIterationCompleted(CreationSession session)
    {
        EnsureInitialized(session);
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Completed;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        if (session.Pipeline.AutomaticIteration is { } automatic)
        {
            automatic.State = AutomaticIterationState.Completed;
            automatic.UpdatedAt = DateTimeOffset.UtcNow;
        }
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Records the deliberate stop after a valid <c>generate</c> response at
    /// the current Run's limit.  The response has already been received and
    /// validated; it is therefore not a transport or protocol failure.  The
    /// original Review identity remains visible while the validated command
    /// is retained in <see cref="CreationPipelineSnapshot.DeferredGenerate"/>.
    /// </summary>
    public static void AutomaticIterationLimitReached(
        CreationSession session,
        string message,
        DeferredGenerateSnapshot? deferredGenerate = null)
    {
        EnsureInitialized(session);
        session.Status = SessionStatus.LimitReached;
        session.PauseReason = message;
        session.LastError = null;
        session.CompletionReason = null;
        session.Pipeline.MaximumIterationSafetyStop = true;
        if (deferredGenerate is not null) session.Pipeline.DeferredGenerate = deferredGenerate;

        // The Review Response itself is valid and received.  Do not turn the
        // Review transport into COMPLETED/FAILED merely because execution was
        // deferred to a later Run.
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Received;
            review.ErrorCode = null;
            review.ErrorStage = null;
            review.ErrorMessage = null;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }

        session.Pipeline.AutomaticIteration ??= new AutomaticIterationSnapshot
        {
            SessionId = session.Id,
            Iteration = session.CurrentIteration,
        };
        session.Pipeline.AutomaticIteration.State = AutomaticIterationState.LimitReached;
        session.Pipeline.AutomaticIteration.ErrorCode = null;
        session.Pipeline.AutomaticIteration.ErrorStage = "maximum_iterations";
        session.Pipeline.AutomaticIteration.ErrorMessage = message;
        session.Pipeline.AutomaticIteration.UpdatedAt = DateTimeOffset.UtcNow;
        Set(
            session,
            CreationStage.Review,
            CreationStageState.WaitingUser,
            deferredGenerate is null
                ? "このRunの最大反復回数に達しました · RESUMEまたは終了を選択"
                : "このRunの最大反復回数に達しました · 次のgenerateを保留中 · RESUMEで続行",
            CreationWaitingReason.ContinueDecisionRequired);
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    /// <summary>
    /// Arms the existing validated command for an explicit Resume after a
    /// limit stop.  The first call creates exactly one recovery Run; later
    /// calls reuse <see cref="DeferredGenerateSnapshot.RecoveryRunId"/> and
    /// never create another Run or Handoff.
    /// </summary>
    public static DeferredGenerateSnapshot? ResumeFromLimit(CreationSession session)
    {
        EnsureInitialized(session);
        var deferred = session.Pipeline.DeferredGenerate;
        if (session.Status != SessionStatus.LimitReached
            && !session.Pipeline.MaximumIterationSafetyStop
            && deferred is null)
        {
            return null;
        }

        if (deferred is not null && string.IsNullOrWhiteSpace(deferred.RecoveryRunId))
        {
            var run = session.StartNewRun("resume_deferred_generate");
            deferred.RecoveryRunId = run.RunId;
            deferred.UpdatedAt = DateTimeOffset.UtcNow;
        }
        else if (deferred is null
                 && (session.Pipeline.CurrentRun is null || session.Pipeline.CurrentRun.IterationCount > 0))
        {
            session.StartNewRun("resume_limit");
        }

        session.Resume();
        session.Pipeline.MaximumIterationSafetyStop = false;
        // The old Review is already received. Keep its Pending Handoff and
        // response identity for strict parsing/replay protection, but do not
        // leave the UI waiting for another response on that old boundary.
        if (session.Pipeline.ReviewHandoff is { } review)
        {
            review.State = ReviewHandoffState.Received;
            review.UpdatedAt = DateTimeOffset.UtcNow;
        }
        if (session.Pipeline.AutomaticIteration is not { } automatic)
        {
            automatic = new AutomaticIterationSnapshot
            {
                SessionId = session.Id,
                Iteration = session.CurrentIteration,
                ReviewHandoffId = session.PendingHandoff?.HandoffId ?? string.Empty,
                ReviewBoundaryId = session.PendingHandoff?.BoundaryId ?? string.Empty,
            };
            session.Pipeline.AutomaticIteration = automatic;
        }
        automatic.State = AutomaticIterationState.Running;
        automatic.ErrorCode = null;
        automatic.ErrorStage = null;
        automatic.ErrorMessage = null;
        automatic.UpdatedAt = DateTimeOffset.UtcNow;
        session.Pipeline.IterationNumber = session.CurrentIteration + 1;
        Set(session, CreationStage.Review, CreationStageState.Completed, "ユーザーがRESUMEを選択 · 保留中のgenerateを実行します");
        Set(session, CreationStage.Apply, CreationStageState.Current, "保留中のgenerateをWorkflowへ反映できます");
        ResetAfter(session, CreationStage.Apply);
        session.UpdatedAt = DateTimeOffset.UtcNow;
        return deferred;
    }

    /// <summary>
    /// Compatibility entry point for the existing safety-stop button. It no
    /// longer increases MaximumIterations; the limit is per Run and the
    /// ViewModel performs the actual deferred APPLY/GENERATE operation.
    /// </summary>
    public static void ContinueBeyondLimit(CreationSession session)
        => ResumeFromLimit(session);

    public static void Complete(CreationSession session, string reason)
    {
        if (!HasSuccessfulOutput(session) || Get(session, CreationStage.Review).State is not (CreationStageState.Current or CreationStageState.WaitingUser or CreationStageState.Completed))
        {
            throw new InvalidOperationException("Output成功後のREVIEW工程でのみ制作を完了できます。");
        }
        Set(session, CreationStage.Review, CreationStageState.Completed, reason);
        session.Complete(reason);
    }

    public static void Resume(CreationSession session)
    {
        EnsureInitialized(session);
        var wasCompleted = session.Status == SessionStatus.Completed;
        var resumeBoundaryIsActive = !wasCompleted
            && PendingHandoffReuse.IsResume(session.PendingHandoff)
            && session.Pipeline.ReviewHandoff is
                { State: ReviewHandoffState.Preparing or ReviewHandoffState.Sending or ReviewHandoffState.WaitingResponse or ReviewHandoffState.Received }
            && session.Pipeline.AutomaticIteration is
                { State: AutomaticIterationState.Running or AutomaticIterationState.WaitingForReviewResponse };
        if (resumeBoundaryIsActive)
        {
            // RESUME is idempotent while its fresh Handoff is in flight or its
            // response is being processed. Do not clear the active boundary or
            // create a second Run when a UI command is delivered twice.
            session.Resume();
            return;
        }

        var invalidatesConsumedReviewHandoff = wasCompleted
            && PendingHandoffReuse.IsReview(session.PendingHandoff);
        if (wasCompleted)
        {
            // COMPLETED is a run terminal state, not a permanent Session
            // terminal state. Preserve history/current output and move to a
            // fresh Run before preparing the new Resume Handoff.
            session.StartNewRun("user_resume_completed");
        }
        session.Resume();
        session.Pipeline.MaximumIterationSafetyStop = false;
        // A completed response has already crossed its protocol boundary.
        // Keep the timeline and generated media, but invalidate that consumed
        // Pending Handoff so an old `complete` response cannot be replayed
        // after RESUME.  The next review Handoff will issue a fresh identity
        // for the same session.
        if (invalidatesConsumedReviewHandoff)
        {
            session.PendingHandoff = null;
        }
        // RESUME starts a new user-directed boundary. Do not leave the old
        // completed assistant response as the active automation status while
        // the same session prepares its next Review Handoff.
        session.Pipeline.AutomaticResponseExecution = null;
        session.Pipeline.ReviewHandoff = null;
        session.Pipeline.AutomaticIteration = null;
        session.Pipeline.DeferredGenerate = null;
        session.Pipeline.IterationNumber = session.CurrentIteration;
        session.Pipeline.AcceptedCommandAction = null;
        SetGenerateExecutionState(session, GenerateExecutionState.ReadyToGenerate);
        Set(session, CreationStage.Review, CreationStageState.Current, "制作を再開しました · 次の指示をChatGPTと検討してください");
    }

    public static string GetGenerateExecutionStateLabel(GenerateExecutionState state)
        => state switch
        {
            GenerateExecutionState.ReadyToGenerate => "生成準備完了",
            GenerateExecutionState.StartingComfyUi => "ComfyUI起動中",
            GenerateExecutionState.WaitingForComfyUi => "ComfyUI READY待ち",
            GenerateExecutionState.Generating => "生成中",
            GenerateExecutionState.GenerationFailed => "生成失敗",
            _ => "生成準備完了",
        };

    private static void InferLegacyState(CreationSession session)
    {
        Set(session, CreationStage.Connect, CreationStageState.Current, "CONNECTで制作通信を再確認してください");
        var bound = session.BoundWorkflow is not null && session.HasBoundProjectChat && session.MaximumIterations > 0;
        if (!bound)
        {
            Set(session, CreationStage.Context, CreationStageState.NotReached, string.Empty);
            return;
        }
        session.Pipeline.ContextBound = true;
        Set(session, CreationStage.Context, CreationStageState.Completed, "既存SessionのContextを復元");
        Set(session, CreationStage.Idea, CreationStageState.Current, "開始指示・補足は任意です · SEND TO CHATGPTで開始");
        var latest = session.Iterations.LastOrDefault();
        if (latest is null) return;
        Set(session, CreationStage.Idea, CreationStageState.Completed, "既存Sessionから復元");
        Set(session, CreationStage.ToChatGpt, CreationStageState.Completed, "既存Sessionから復元");
        Set(session, CreationStage.Command, CreationStageState.Completed, "既存Sessionから復元");
        Set(session, CreationStage.Apply, CreationStageState.Completed, "既存Sessionから復元");
        JobStatusChanged(session, latest.Status, latest.Error);
        if (latest.Status == JobStatus.Completed) OutputCompleted(session, latest.Outputs);
        if (session.Status == SessionStatus.Completed) Set(session, CreationStage.Review, CreationStageState.Completed, session.CompletionReason ?? "制作完了");
    }

    private static void RequireContext(CreationSession session)
    {
        RequireConnection(session);
        EnsureInitialized(session);
        if (!session.Pipeline.ContextBound || Get(session, CreationStage.Context).State != CreationStageState.Completed)
        {
            throw new InvalidOperationException("先に制作ContextをSessionへBindingしてください。");
        }
    }

    private static bool HasSuccessfulOutput(CreationSession session)
        => session.Iterations.Any(iteration => iteration.Status == JobStatus.Completed && iteration.Outputs.Any(output => !output.IsMissing));

    private static bool IsReviewResponse(CreationSession session)
    {
        // New Handoffs carry an explicit immutable purpose.  A complete
        // permission is the compatibility signal for Review snapshots saved
        // before Purpose was introduced.  The transient stage fallback keeps
        // old in-memory callers/snapshots working when no PendingHandoff was
        // persisted, but is never used when a snapshot is available.
        if (session.PendingHandoff is not null)
        {
            return PendingHandoffReuse.IsReview(session.PendingHandoff);
        }

        var review = Get(session, CreationStage.Review).State;
        return review is CreationStageState.Current or CreationStageState.WaitingUser;
    }

    private static void ResetAfter(CreationSession session, CreationStage stage)
    {
        var index = Array.IndexOf(OrderedStages, stage);
        for (var i = index + 1; i < OrderedStages.Length; i++) Set(session, OrderedStages[i], CreationStageState.NotReached, string.Empty);
    }

    private static void ResetFrom(CreationSession session, CreationStage stage)
    {
        var index = Array.IndexOf(OrderedStages, stage);
        for (var i = index; i < OrderedStages.Length; i++) Set(session, OrderedStages[i], CreationStageState.NotReached, string.Empty);
    }

    private static void SetAllFrom(CreationSession session, CreationStage stage, CreationStageState state)
    {
        var index = Array.IndexOf(OrderedStages, stage);
        for (var i = index; i < OrderedStages.Length; i++) Set(session, OrderedStages[i], state, string.Empty);
    }

    private static void EnsureRunInitialized(CreationSession session)
    {
        if (session.Pipeline.CurrentRun is null)
        {
            // Snapshots written before Run existed are migrated into one
            // legacy Run. Its consumed count is the existing history count,
            // so an old session cannot silently exceed its configured budget
            // on the first post-upgrade generation.
            session.Pipeline.CurrentRun = new CreationRunSnapshot
            {
                RunId = Guid.NewGuid().ToString("N"),
                Number = 1,
                StartIteration = 0,
                IterationCount = Math.Max(session.CurrentIteration, session.Iterations.Count),
                StartedReason = "legacy-migration",
            };
            return;
        }

        var run = session.Pipeline.CurrentRun;
        run.StartIteration = Math.Clamp(run.StartIteration, 0, Math.Max(0, session.CurrentIteration));
        run.Number = Math.Max(1, run.Number);
        run.IterationCount = Math.Max(run.IterationCount, Math.Max(0, session.CurrentIteration - run.StartIteration));
        if (string.IsNullOrWhiteSpace(run.RunId)) run.RunId = Guid.NewGuid().ToString("N");
    }

    private static void SetGenerateExecutionState(CreationSession session, GenerateExecutionState state)
    {
        EnsureInitialized(session);
        session.Pipeline.GenerateExecutionState = state;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    private static void Set(CreationSession session, CreationStage stage, CreationStageState state, string detail, CreationWaitingReason waitingReason = CreationWaitingReason.None)
    {
        var item = session.Pipeline.Stages.Single(entry => entry.Stage == stage);
        item.State = state;
        item.WaitingReason = state == CreationStageState.WaitingUser ? waitingReason : CreationWaitingReason.None;
        item.Detail = detail;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
