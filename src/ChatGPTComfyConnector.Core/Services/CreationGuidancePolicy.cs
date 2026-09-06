using ChatGPTComfyConnector.Core.Models;

namespace ChatGPTComfyConnector.Core.Services;

public enum CreationGuideTarget
{
    None, Setup, SetupForm, Connect, WorkflowLibrary, WorkflowRefresh, WorkflowSettings,
    WorkflowEditor, WorkflowRetry, WorkflowClose, ExtensionConnection, ChatReload, ProjectSelector,
    ChatSelector, ProjectCreation, ChatCreation, MaximumIterations, NewCreation,
    SendToChatGpt, Handoff, CommandInput, ImportCommand, ApplyGenerate, Generate,
    StartComfyUi, Output, AttachReviewOutput, IterationDecision, Resume,
}

public sealed record CreationGuidance(CreationGuideTarget Target, string Message, string? ItemId = null)
{
    public static readonly CreationGuidance None = new(CreationGuideTarget.None, string.Empty);
}

/// <summary>Current facts used by the guide; none of these grant execution permission.</summary>
public sealed record CreationGuideContext
{
    public CreationSession? Session { get; init; }
    public bool IsSessionActivated { get; init; }
    public ConnectionState Connection { get; init; }
    public bool IsOperationInProgress { get; init; }
    public bool IsSetupReady { get; init; } = true;
    public bool IsSetupVisible { get; init; }
    public WorkflowPreparation Workflow { get; init; } = new(null, SlotDiscoveryState.NotLoaded);
    public ChatPreparation Chat { get; init; } = new(ProjectChatCatalogLoadState.NotLoaded, null, null, 10);
    public bool IsWorkflowEditorVisible { get; init; }
    public bool HasWorkflowEntries { get; init; } = true;
    public bool RequiresChatRefresh { get; init; } = true;
    public bool IsExtensionConnected { get; init; }
    public bool IsCatalogRefreshed { get; init; }
    public bool IsProjectConfirmed { get; init; }
    public bool IsChatConfirmed { get; init; }
    public bool IsProjectCreateVisible { get; init; }
    public bool IsChatCreateVisible { get; init; }
    public bool HasMaximumIterationsInputError { get; init; }
    public bool HasPendingContextChange { get; init; }
    public bool CanRefreshChat { get; init; }
    public bool CanStartCreation { get; init; }
    public bool CanSend { get; init; }
    public bool CanApply { get; init; }
    public bool CanGenerate { get; init; }
    public bool CanAttachReviewOutput { get; init; }
    public bool CanResume { get; init; }
    public bool HasCommandText { get; init; }
    public bool IsCommandValid { get; init; }
    public bool HandoffNeedsPaste { get; init; }
    public string? HandoffItemId { get; init; }
}

/// <summary>
/// Chooses at most one actionable guide. It reads pipeline evidence and the
/// existing command guards without advancing stages or scheduling any work.
/// </summary>
public static class CreationGuidancePolicy
{
    public static CreationGuidance Resolve(CreationGuideContext input)
    {
        var session = input.IsSessionActivated ? input.Session : null;
        if (session?.Status == SessionStatus.Completed || input.IsOperationInProgress)
            return CreationGuidance.None;
        if (input.IsSetupVisible) return Guide(CreationGuideTarget.SetupForm, "接続設定を確認して保存してください");
        if (input.IsWorkflowEditorVisible && input.Workflow.SlotState != SlotDiscoveryState.Failed
            && session?.Pipeline.Stages.Any(item => item.Stage == CreationStage.Apply && item.State == CreationStageState.Error) != true)
            return Guide(CreationGuideTarget.WorkflowClose, "Workflow設定を閉じて制作を続けてください");
        if (!input.IsSetupReady) return Guide(CreationGuideTarget.Setup, "SETUPで接続先を設定してください");
        if (input.Connection == ConnectionState.Connecting) return CreationGuidance.None;
        if (input.Connection != ConnectionState.Connected) return Guide(CreationGuideTarget.Connect, "CONNECTでMCPへ接続してください");

        CreationStageStatus Stage(CreationStage stage) => session?.Pipeline.Stages.FirstOrDefault(item => item.Stage == stage)
            ?? new CreationStageStatus { Stage = stage };
        if (session is null || !session.Pipeline.IsPreparationBound
            || (input.HasPendingContextChange && Stage(CreationStage.Idea).State == CreationStageState.Current))
            return Preparation(input);

        if (session.Pipeline.MaximumIterationSafetyStop || session.Status == SessionStatus.LimitReached)
            return Guide(CreationGuideTarget.IterationDecision, "RESUMEで続行するか、この制作を終了するか選んでください");

        // Processing facts win over retained earlier waiting/error stages.
        if (session.Pipeline.Stages.Any(item => item.State == CreationStageState.InProgress)
            || session.Pipeline.ReviewMediaAttachment?.State is ReviewMediaAttachmentState.Preparing or ReviewMediaAttachmentState.Attaching
            || session.Pipeline.AutomaticResponseExecution?.State is AutomaticResponseExecutionState.Validating or AutomaticResponseExecutionState.Applying or AutomaticResponseExecutionState.Generating)
            return CreationGuidance.None;

        if (session.Pipeline.ReviewMediaAttachment?.State == ReviewMediaAttachmentState.Failed)
        {
            if (!input.IsExtensionConnected) return Extension();
            if (input.CanAttachReviewOutput) return Guide(CreationGuideTarget.AttachReviewOutput, "生成結果をChatGPTへ再添付してください");
        }

        var command = Stage(CreationStage.Command);
        if (command.State == CreationStageState.Error)
            return Guide(CreationGuideTarget.CommandInput, "エラー内容を確認してCommandを修正してください");
        if (input.HasCommandText && !input.IsCommandValid)
            return Guide(CreationGuideTarget.ImportCommand, "貼り付けたResponseを「読み込んで確認」で検証してください");
        if (command.State is CreationStageState.Current or CreationStageState.WaitingUser && !input.IsCommandValid)
            return Guide(CreationGuideTarget.CommandInput, "ChatGPTのResponse全文を貼り付けてください");

        if (Stage(CreationStage.Apply).State == CreationStageState.Error)
            return WorkflowRecovery(input, schemaFailure: false);
        var generate = Stage(CreationStage.Generate);
        if (generate.State == CreationStageState.WaitingUser && generate.WaitingReason == CreationWaitingReason.ComfyUiStartRequired)
            return Guide(CreationGuideTarget.StartComfyUi, "START COMFYUIで起動してから生成を続行してください");
        if (input.CanApply && Stage(CreationStage.Apply).State == CreationStageState.Current)
            return Guide(CreationGuideTarget.ApplyGenerate, "検証済みCommandを「適用して生成」で実行してください");
        if (input.CanGenerate && generate.State is CreationStageState.Current or CreationStageState.WaitingUser or CreationStageState.Error or CreationStageState.Cancelled)
            return Guide(CreationGuideTarget.Generate, "GENERATEで生成を開始してください");
        if (Stage(CreationStage.Output).State == CreationStageState.Error)
            return Guide(CreationGuideTarget.Output, "出力取得のエラー内容を確認してください");

        if (input.CanSend && (Stage(CreationStage.ToChatGpt).State == CreationStageState.Error
            || Stage(CreationStage.Review).State is CreationStageState.Current or CreationStageState.Error))
            return Guide(CreationGuideTarget.SendToChatGpt, "保存済みのHandoffを再送してください");
        if (input.HandoffNeedsPaste && input.HandoffItemId is not null)
            return new(CreationGuideTarget.Handoff, "コピーしたHandoffをChatGPTへ貼り付けて送信してください", input.HandoffItemId);
        if (input.CanSend && Stage(CreationStage.Idea).State is CreationStageState.Current or CreationStageState.WaitingUser)
            return Guide(CreationGuideTarget.SendToChatGpt, "SEND TO CHATGPTで開始してください（開始指示は任意です）");
        if (input.CanResume && session.Status is SessionStatus.Paused or SessionStatus.Stopped or SessionStatus.Error)
            return Guide(CreationGuideTarget.Resume, "RESUMEで制作を再開してください");
        return CreationGuidance.None;
    }

    private static CreationGuidance Preparation(CreationGuideContext input)
    {
        var workflow = CreationPreparationPolicy.EvaluateWorkflow(input.Workflow);
        if (workflow.State == CreationStageState.InProgress) return CreationGuidance.None;
        if (workflow.State == CreationStageState.Error)
            return input.Workflow.Workflow is null
                ? Guide(CreationGuideTarget.WorkflowRefresh, "Workflow一覧を更新してください。見つからない場合はSETUPのパスを確認してください")
                : WorkflowRecovery(input, schemaFailure: true);
        if (workflow.State != CreationStageState.Completed)
            return Guide(input.HasWorkflowEntries ? CreationGuideTarget.WorkflowLibrary : CreationGuideTarget.WorkflowRefresh,
                input.HasWorkflowEntries ? "制作に使うWorkflowを一覧から選んでください" : "Workflow一覧を更新してください");

        if (input.Chat.IsBinding || input.Chat.IsLoadingChats || input.Chat.CatalogState == ProjectChatCatalogLoadState.Loading)
            return CreationGuidance.None;
        if (input.IsProjectCreateVisible) return Guide(CreationGuideTarget.ProjectCreation, "Project名を入力して作成してください");
        if (input.IsChatCreateVisible) return Guide(CreationGuideTarget.ChatCreation, "Chat名を入力して作成してください");
        if (input.RequiresChatRefresh && (!input.IsCatalogRefreshed
            || input.Chat.CatalogState is ProjectChatCatalogLoadState.Error or ProjectChatCatalogLoadState.Disconnected or ProjectChatCatalogLoadState.NotLoaded
            || !string.IsNullOrWhiteSpace(input.Chat.Error)))
        {
            if (!input.IsExtensionConnected) return Extension();
            return input.CanRefreshChat ? Guide(CreationGuideTarget.ChatReload, "↻でProject / Chatを再取得してください") : CreationGuidance.None;
        }
        if (!input.IsProjectConfirmed || input.Chat.Project is not { IsCreateAction: false, IsTargetResolvable: true })
            return Guide(CreationGuideTarget.ProjectSelector, "Projectを選択・確認してください");
        if (!input.IsChatConfirmed || input.Chat.Chat is not { IsCreateAction: false })
            return Guide(CreationGuideTarget.ChatSelector, "使用するChatを選択・確認してください");
        if (input.HasMaximumIterationsInputError || input.Chat.MaximumIterations is < 1 or > 1000)
            return Guide(CreationGuideTarget.MaximumIterations, "Maximum Iterationsを1〜1000で指定してください");
        if (input.CanStartCreation) return Guide(CreationGuideTarget.NewCreation, "「新しい制作を開始」を押してください");
        return Guide(CreationGuideTarget.ChatSelector, "Project / Chatの準備状況を確認してください");
    }

    private static CreationGuidance WorkflowRecovery(CreationGuideContext input, bool schemaFailure)
        => Guide(input.IsWorkflowEditorVisible
                ? schemaFailure ? CreationGuideTarget.WorkflowRetry : CreationGuideTarget.WorkflowEditor
                : CreationGuideTarget.WorkflowSettings,
            schemaFailure ? "Workflow設定のRETRYでSlot Schemaを再読み込みしてください" : "Workflow設定で反映エラーを確認してください");
    private static CreationGuidance Extension() => Guide(CreationGuideTarget.ExtensionConnection, "ブラウザー拡張機能からConnectorへ接続してください");
    private static CreationGuidance Guide(CreationGuideTarget target, string message) => new(target, message);
}
