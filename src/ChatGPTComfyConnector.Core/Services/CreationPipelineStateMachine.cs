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
        session.Pipeline.Version = 2;
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
    }

    public static CreationStageStatus Get(CreationSession session, CreationStage stage)
    {
        EnsureInitialized(session);
        return session.Pipeline.Stages.Single(item => item.Stage == stage);
    }

    public static CreationStageStatus EvaluateConnectionGate(ConnectionState connectionState, bool comfyUiReachable, bool hasSessionProgress)
    {
        var (state, detail) = connectionState switch
        {
            ConnectionState.Connecting => (CreationStageState.InProgress, "MCPへ接続しComfyUI到達性を確認中"),
            ConnectionState.Connected when comfyUiReachable => (CreationStageState.Completed, "MCP接続とComfyUI到達性を確認済み"),
            ConnectionState.Connected => (CreationStageState.WaitingUser, "MCP接続済み · ComfyUIを起動して再接続してください"),
            ConnectionState.Error or ConnectionState.Unavailable => (CreationStageState.Error, "制作通信を確立できませんでした · 接続診断を確認してください"),
            ConnectionState.Stopped => (CreationStageState.WaitingUser, "ComfyUIを起動してCONNECTしてください"),
            _ when hasSessionProgress => (CreationStageState.WaitingUser, "制作データを保持しています · 再接続すると続行できます"),
            _ => (CreationStageState.Current, "CONNECTでMCP接続とComfyUI到達性を確認してください"),
        };
        return new CreationStageStatus { Stage = CreationStage.Connect, State = state, Detail = detail };
    }

    public static void SynchronizeConnectionGate(CreationSession session, ConnectionState connectionState, bool comfyUiReachable, string? detail = null)
    {
        EnsureInitialized(session);
        var hasSessionProgress = session.Pipeline.ContextBound
            || OrderedStages.Skip(2).Any(stage => Get(session, stage).State != CreationStageState.NotReached);
        var evaluated = EvaluateConnectionGate(connectionState, comfyUiReachable, hasSessionProgress);
        Set(session, CreationStage.Connect, evaluated.State, detail ?? evaluated.Detail);
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
            throw new InvalidOperationException("MCP接続とComfyUI到達性を確認してから制作を続行してください。");
        }
    }

    public static void PrepareContext(CreationSession session, string detail = "CONNECTで制作通信を確認してください")
    {
        EnsureInitialized(session);
        session.Pipeline.ContextBound = false;
        session.Pipeline.MaximumIterationSafetyStop = false;
        session.Pipeline.SentIdeaSnapshot = null;
        session.Pipeline.AcceptedCommandAction = null;
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
        session.Pipeline.ContextBound = true;
        session.Pipeline.IterationNumber = session.CurrentIteration;
        session.Pipeline.MaximumIterationSafetyStop = false;
        SetAllFrom(session, CreationStage.Context, CreationStageState.NotReached);
        Set(session, CreationStage.Context, CreationStageState.Completed, "制作セッションへContextをBinding済み");
        Set(session, CreationStage.Idea, CreationStageState.Current, "制作アイデアを入力してください");
        session.Status = SessionStatus.Active;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void IdeaChanged(CreationSession session, string idea)
    {
        EnsureInitialized(session);
        if (!session.Pipeline.ContextBound) return;
        if (session.Pipeline.SentIdeaSnapshot is null)
        {
            Set(session, CreationStage.Idea, CreationStageState.Current, string.IsNullOrWhiteSpace(idea) ? "制作アイデアを入力してください" : "入力中 · SEND TO CHATGPTで確定");
            return;
        }
        if (string.Equals(session.Pipeline.SentIdeaSnapshot, idea, StringComparison.Ordinal)) return;

        Set(session, CreationStage.Idea, CreationStageState.Current, "送信後に変更されました · 再送信が必要です");
        ResetAfter(session, CreationStage.Idea);
        session.Pipeline.SentIdeaSnapshot = null;
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.MaximumIterationSafetyStop = false;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }

    public static void BootstrapCopied(CreationSession session, string idea)
    {
        RequireContext(session);
        if (string.IsNullOrWhiteSpace(idea)) throw new InvalidOperationException("制作アイデアを入力してください。");
        session.Pipeline.SentIdeaSnapshot = idea;
        session.Pipeline.AcceptedCommandAction = null;
        Set(session, CreationStage.Idea, CreationStageState.Completed, "制作ContextをClipboardへ生成済み");
        Set(session, CreationStage.ToChatGpt, CreationStageState.WaitingUser, "Manual Handoff · ChatGPTからの返答待ち");
        ResetAfter(session, CreationStage.ToChatGpt);
    }

    public static void BeginCommandValidation(CreationSession session)
    {
        RequireContext(session);
        var handoff = Get(session, CreationStage.ToChatGpt).State;
        var review = Get(session, CreationStage.Review).State;
        if (handoff is not (CreationStageState.WaitingUser or CreationStageState.Completed)
            && review is not (CreationStageState.Current or CreationStageState.WaitingUser))
        {
            throw new InvalidOperationException("先にSEND TO CHATGPTで制作ContextをHandoffしてください。");
        }
        Set(session, CreationStage.Command, CreationStageState.InProgress, "Connector Commandを解析・検証中");
        ResetAfter(session, CreationStage.Command);
    }

    public static void CommandReplaced(CreationSession session)
    {
        EnsureInitialized(session);
        if (Get(session, CreationStage.Command).State == CreationStageState.NotReached) return;
        Set(session, CreationStage.Command, CreationStageState.Current, "Commandが変更されました · 再検証が必要です");
        ResetAfter(session, CreationStage.Command);
        session.Pipeline.AcceptedCommandAction = null;
        session.Pipeline.MaximumIterationSafetyStop = false;
    }

    public static void CommandValidationFailed(CreationSession session, string detail)
    {
        Set(session, CreationStage.Command, CreationStageState.Error, detail);
        ResetAfter(session, CreationStage.Command);
    }

    public static void CommandValidated(CreationSession session, string action)
    {
        RequireContext(session);
        var review = Get(session, CreationStage.Review);
        var isReviewResponse = review.State is CreationStageState.Current or CreationStageState.WaitingUser;
        if (isReviewResponse) Set(session, CreationStage.Review, CreationStageState.Completed, action == "complete" ? "ChatGPTが完成を承認" : "次のIterationへ進みます");

        Set(session, CreationStage.ToChatGpt, CreationStageState.Completed, "有効なConnector Commandを受信");
        Set(session, CreationStage.Command, CreationStageState.Completed, "Protocol・Action・Schema・Workflow整合性を確認済み");
        session.Pipeline.AcceptedCommandAction = action;

        if (action == "complete")
        {
            if (!HasSuccessfulOutput(session) || !isReviewResponse)
            {
                Set(session, CreationStage.Command, CreationStageState.Error, "completeはOutput成功後のREVIEWでのみ受理できます");
                throw new InvalidOperationException("completeは、少なくとも1回Outputが成功したREVIEW工程でのみ受理できます。");
            }
            return;
        }

        if (isReviewResponse && session.AtIterationLimit)
        {
            session.Pipeline.MaximumIterationSafetyStop = true;
            ResetFrom(session, CreationStage.Apply);
            Set(session, CreationStage.Review, CreationStageState.WaitingUser, "最大反復回数に達しました · 続行するか判断してください");
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
        Set(session, CreationStage.Generate, CreationStageState.Current, "生成を開始できます");
        ResetAfter(session, CreationStage.Generate);
    }

    public static void ApplyFailed(CreationSession session, string detail)
    {
        Set(session, CreationStage.Apply, CreationStageState.Error, detail);
        ResetAfter(session, CreationStage.Apply);
    }

    public static void BeginGenerate(CreationSession session)
    {
        RequireConnection(session);
        if (session.Pipeline.MaximumIterationSafetyStop) throw new InvalidOperationException("最大反復回数に達しています。続行するか終了するか選択してください。");
        Set(session, CreationStage.Generate, CreationStageState.InProgress, "Jobを投入しています");
        ResetAfter(session, CreationStage.Generate);
    }

    public static void JobStatusChanged(CreationSession session, JobStatus status, string? detail = null)
    {
        switch (status)
        {
            case JobStatus.Queued:
            case JobStatus.Running:
                Set(session, CreationStage.Generate, CreationStageState.InProgress, detail ?? status.ToString());
                break;
            case JobStatus.Completed:
                Set(session, CreationStage.Generate, CreationStageState.Completed, "ComfyUI Job完了");
                Set(session, CreationStage.Output, CreationStageState.InProgress, "出力ファイルを取得・確認中");
                break;
            case JobStatus.Failed:
                Set(session, CreationStage.Generate, CreationStageState.Error, detail ?? "ComfyUI Job失敗");
                ResetAfter(session, CreationStage.Generate);
                break;
            case JobStatus.Cancelled:
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
        Set(session, CreationStage.Review, CreationStageState.Current, "生成結果を確認しChatGPTへ渡してください");
        session.Pipeline.IterationNumber = session.CurrentIteration;
    }

    public static void OutputFailed(CreationSession session, string detail)
    {
        Set(session, CreationStage.Output, CreationStageState.Error, detail);
        Set(session, CreationStage.Review, CreationStageState.NotReached, string.Empty);
    }

    public static void ReviewCopied(CreationSession session)
        => Set(session, CreationStage.Review, CreationStageState.WaitingUser, "Manual Handoff · ChatGPTの評価待ち");

    public static void ContinueBeyondLimit(CreationSession session)
    {
        if (!session.Pipeline.MaximumIterationSafetyStop) return;
        session.MaximumIterations = Math.Max(session.MaximumIterations + 1, session.CurrentIteration + 1);
        session.Pipeline.MaximumIterationSafetyStop = false;
        Set(session, CreationStage.Review, CreationStageState.Completed, "ユーザーが次Iterationへの続行を承認");
        Set(session, CreationStage.Apply, CreationStageState.Current, "検証済みCommandをWorkflowへ反映できます");
        ResetAfter(session, CreationStage.Apply);
    }

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
        session.Resume();
        session.Pipeline.MaximumIterationSafetyStop = false;
        Set(session, CreationStage.Review, CreationStageState.Current, "制作を再開しました · 次の指示をChatGPTと検討してください");
    }

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
        Set(session, CreationStage.Idea, CreationStageState.Current, "制作アイデアを確認してください");
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

    private static void Set(CreationSession session, CreationStage stage, CreationStageState state, string detail)
    {
        var item = session.Pipeline.Stages.Single(entry => entry.Stage == stage);
        item.State = state;
        item.Detail = detail;
        item.UpdatedAt = DateTimeOffset.UtcNow;
        session.UpdatedAt = DateTimeOffset.UtcNow;
    }
}
