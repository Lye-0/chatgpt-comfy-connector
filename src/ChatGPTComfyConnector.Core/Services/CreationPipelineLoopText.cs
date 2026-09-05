using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

/// <summary>
/// Resolves the short helper text shown beside the Creation Pipeline.
///
/// The text is a projection of the persisted pipeline state. It deliberately
/// does not infer progress from SessionStatus alone: the active stage, its
/// state, and any structured waiting reason remain the source of truth.
/// </summary>
public static class CreationPipelineLoopText
{
    public static string Resolve(
        CreationSession? session,
        bool isSessionActivated,
        ConnectionState connectionState,
        string? idea)
    {
        if (!isSessionActivated)
        {
            var connection = CreationPipelineStateMachine.EvaluateConnectionGate(connectionState, false);
            if (connection.State != CreationStageState.Completed) return ResolveStageText(connection, idea);
            if (session is null) return "WORKFLOW → Workflow / Slot Schemaを準備";
            CreationPipelineStateMachine.EnsureInitialized(session);
            var workflow = CreationPipelineStateMachine.Get(session, CreationStage.Workflow);
            if (workflow.State != CreationStageState.Completed)
                return workflow.State == CreationStageState.NotReached
                    ? "WORKFLOW → Workflow / Slot Schemaを準備"
                    : ResolveStageText(workflow, idea);
            return ResolveStageText(CreationPipelineStateMachine.Get(session, CreationStage.Chat), idea);
        }

        if (session is null)
        {
            return "CONNECT → MCPへ接続";
        }

        CreationPipelineStateMachine.EnsureInitialized(session);

        if (session.Status == SessionStatus.LimitReached)
        {
            return session.Pipeline.DeferredGenerate is null
                ? "LIMIT REACHED → RESUMEまたは終了を選択"
                : "LIMIT REACHED → 保留generateをRESUMEで実行";
        }

        if (session.Status == SessionStatus.Completed)
        {
            return "SESSION COMPLETE";
        }

        if (session.Pipeline.MaximumIterationSafetyStop)
        {
            return "SAFETY STOP → 続行または終了を選択";
        }

        var current = CreationPipelineStateMachine.OrderedStages
            .Select((stage, index) => (Status: CreationPipelineStateMachine.Get(session, stage), Index: index))
            .Where(item => IsActiveStage(item.Status))
            // A downstream stage may be InProgress while an earlier stage is
            // still WaitingUser (for example, COMMAND validation after the
            // ChatGPT handoff). UpdatedAt reflects the state-machine event
            // that most recently became actionable.
            .OrderByDescending(item => item.Status.UpdatedAt)
            .ThenByDescending(item => item.Index)
            .Select(item => item.Status)
            .FirstOrDefault();

        if (current is null)
        {
            // A session can briefly have every stage completed while the
            // Review command is being finalized. Keep the helper actionable
            // without inventing another pipeline state.
            return "REVIEW → ChatGPTへ結果を送信";
        }

        return ResolveStageText(current, idea ?? session.OriginalIdea);
    }

    private static bool IsActiveStage(CreationStageStatus status)
        => status.State is CreationStageState.Current
            or CreationStageState.InProgress
            or CreationStageState.WaitingUser
            or CreationStageState.Error
            or CreationStageState.Cancelled;

    private static string ResolveStageText(CreationStageStatus status, string? idea = null)
    {
        var stage = GetStageKey(status.Stage);
        return status.State switch
        {
            CreationStageState.Current => ResolveCurrentText(status.Stage, idea),
            CreationStageState.InProgress => $"{stage} → {GetInProgressText(status)}",
            CreationStageState.WaitingUser => ResolveWaitingText(status),
            CreationStageState.Error => $"{stage} → {GetErrorText(status.Stage)}",
            CreationStageState.Cancelled => $"{stage} → {GetCancelledText(status.Stage)}",
            _ => $"{stage} → {GetFallbackText(status)}",
        };
    }

    private static string ResolveCurrentText(CreationStage stage, string? idea)
        => stage switch
        {
            CreationStage.Connect => "CONNECT → MCPへ接続",
            CreationStage.Workflow => "WORKFLOW → Workflow / Slot Schemaを準備",
            CreationStage.Chat => "CHAT → Project / Chatを確認して制作開始",
            CreationStage.Idea => string.IsNullOrWhiteSpace(idea)
                ? "IDEA → SEND TO CHATGPT（入力は任意）"
                : "IDEA → SEND TO CHATGPT",
            CreationStage.ToChatGpt => "TO CHATGPT → ChatGPTへ送信",
            CreationStage.Command => "COMMAND → ChatGPTの返答を読み込む",
            CreationStage.Apply => "APPLY → Workflowへ反映",
            CreationStage.Generate => "GENERATE → 生成を開始",
            CreationStage.Output => "OUTPUT → 生成結果を取得",
            CreationStage.Review => "REVIEW → ChatGPTへ結果を送信",
            _ => "制作を続行",
        };

    private static string ResolveWaitingText(CreationStageStatus status)
    {
        if (status.WaitingReason == CreationWaitingReason.ContinueDecisionRequired)
        {
            return "SAFETY STOP → 続行または終了を選択";
        }

        if (status.WaitingReason is CreationWaitingReason.None or CreationWaitingReason.UserActionRequired
            && !string.IsNullOrWhiteSpace(status.Detail))
        {
            return $"{GetStageKey(status.Stage)} → {NormalizeDetail(status.Detail)}";
        }

        var reason = CreationPipelineStateMachine.GetWaitingReasonLabel(status.Stage, status.WaitingReason);
        return $"{GetStageKey(status.Stage)} → {reason}";
    }

    private static string NormalizeDetail(string detail)
    {
        var compact = string.Join(" · ", detail
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return compact.Length <= 80 ? compact : compact[..77] + "…";
    }

    private static string GetInProgressText(CreationStageStatus status)
        => status.Stage switch
        {
            CreationStage.Connect => "MCP接続中",
            CreationStage.Workflow => "Workflow / Slot Schemaを読込中",
            CreationStage.Chat => NormalizeDetail(status.Detail),
            CreationStage.Command => "コマンド確認中",
            CreationStage.Apply => "反映・検証中",
            // Automatic runtime startup is still an active GENERATE stage,
            // but users need to know why the job has not been submitted yet.
            CreationStage.Generate when string.Equals(status.Detail, "ComfyUI起動中", StringComparison.Ordinal) => "ComfyUI起動中",
            CreationStage.Generate when string.Equals(status.Detail, "ComfyUIのREADYを待機中", StringComparison.Ordinal) => "ComfyUI READY待ち",
            CreationStage.Generate => "生成中",
            CreationStage.Output => "生成結果を取得・確認中",
            _ => "処理中",
        };

    private static string GetErrorText(CreationStage stage)
        => stage switch
        {
            CreationStage.Connect => "MCP接続エラー",
            CreationStage.Workflow => "Workflow / Slot Schemaを確認・再読込",
            CreationStage.Chat => "Project / Chatの準備エラーを確認",
            CreationStage.ToChatGpt => "送信エラー · 再送できます",
            CreationStage.Command => "修正が必要",
            CreationStage.Apply => "反映エラー",
            CreationStage.Generate => "再実行できます",
            CreationStage.Output => "出力取得エラー",
            _ => "エラーを確認してください",
        };

    private static string GetCancelledText(CreationStage stage)
        => stage switch
        {
            CreationStage.Generate => "キャンセル済み · 再実行できます",
            _ => "キャンセル済み",
        };

    private static string GetFallbackText(CreationStageStatus status)
        => status.State switch
        {
            CreationStageState.NotReached => "次の工程を待機中",
            CreationStageState.Skipped => "スキップ済み",
            CreationStageState.Completed => "完了",
            _ when !string.IsNullOrWhiteSpace(status.Detail) => status.Detail,
            _ => "状態を確認してください",
        };

    private static string GetStageKey(CreationStage stage)
        => stage switch
        {
            CreationStage.Connect => "CONNECT",
            CreationStage.Workflow => "WORKFLOW",
            CreationStage.Chat => "CHAT",
            CreationStage.Idea => "IDEA",
            CreationStage.ToChatGpt => "TO CHATGPT",
            CreationStage.Command => "COMMAND",
            CreationStage.Apply => "APPLY",
            CreationStage.Generate => "GENERATE",
            CreationStage.Output => "OUTPUT",
            CreationStage.Review => "REVIEW",
            _ => stage.ToString().ToUpperInvariant(),
        };
}
