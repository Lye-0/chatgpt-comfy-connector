using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class CreationPipelineLoopTextTests : IDisposable
{
    private readonly string _temp = Path.Combine(Path.GetTempPath(), "connector-loop-text-" + Guid.NewGuid().ToString("N"));

    public CreationPipelineLoopTextTests() => Directory.CreateDirectory(_temp);

    [Fact]
    public void StartupAndContextUseTheConnectionAndContextStages()
    {
        Assert.Equal(
            "CONNECT → MCPへ接続",
            CreationPipelineLoopText.Resolve(null, false, ConnectionState.Disconnected, null));

        var session = new CreationSession();
        Assert.Equal(
            "CONTEXT → 制作設定を確認",
            CreationPipelineLoopText.Resolve(session, false, ConnectionState.Connected, null));
    }

    [Fact]
    public void IdeaTextTreatsTheKickoffInstructionAsOptional()
    {
        var session = BoundSession();

        Assert.Equal(
            "IDEA → SEND TO CHATGPT（入力は任意）",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, string.Empty));

        const string idea = "夜の東京を走る車";
        CreationPipelineStateMachine.IdeaChanged(session, idea);
        Assert.Equal(
            "IDEA → SEND TO CHATGPT",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, idea));
    }

    [Fact]
    public void HandoffAndCommandStagesDescribeTheirNextAction()
    {
        var session = SentIdeaSession();
        Assert.Equal(
            "TO CHATGPT → ChatGPT返答待ち",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.BeginCommandValidation(session);
        Assert.Equal(
            "COMMAND → コマンド確認中",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.CommandValidationFailed(session, "invalid json");
        Assert.Equal(
            "COMMAND → 修正が必要",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        Assert.Equal(
            "APPLY → Workflowへ反映",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));
    }

    [Fact]
    public void ApplyGenerateAndOutputStatesUseStageSpecificText()
    {
        var session = CommandReadySession();

        CreationPipelineStateMachine.BeginApply(session);
        Assert.Equal(
            "APPLY → 反映・検証中",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.ApplyCompleted(session);
        Assert.Equal(
            "GENERATE → 生成を開始",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.BeginComfyUiStartup(session, CreationStage.Generate);
        Assert.Equal(
            "GENERATE → ComfyUI起動中",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        Assert.Throws<InvalidOperationException>(() => CreationPipelineStateMachine.RequireComfyUi(session, CreationStage.Generate, false));
        Assert.Equal(
            "GENERATE → ComfyUI起動待ち",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.BeginGenerate(session);
        Assert.Equal(
            "GENERATE → 生成中",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Failed, "job failed");
        Assert.Equal(
            "GENERATE → 再実行できます",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.BeginGenerate(session);
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Cancelled, "cancelled");
        Assert.Equal(
            "GENERATE → キャンセル済み · 再実行できます",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));
    }

    [Fact]
    public void OutputAndReviewStatesDescribeRetrievalAndFeedback()
    {
        var session = CommandReadySession();
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Completed);

        Assert.Equal(
            "OUTPUT → 生成結果を取得・確認中",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        CreationPipelineStateMachine.OutputFailed(session, "output missing");
        Assert.Equal(
            "OUTPUT → 出力取得エラー",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        var reviewSession = CommandReadySession();
        CreationPipelineStateMachine.ApplyCompleted(reviewSession);
        CreationPipelineStateMachine.BeginGenerate(reviewSession);
        CreationPipelineStateMachine.JobStatusChanged(reviewSession, JobStatus.Completed);
        var outputPath = Path.Combine(_temp, "result.mp4");
        File.WriteAllText(outputPath, "output");
        var iteration = reviewSession.StartIteration("prompt", new Dictionary<string, System.Text.Json.Nodes.JsonNode?>());
        iteration.Status = JobStatus.Completed;
        iteration.Outputs = [new OutputArtifact { FullPath = outputPath, FileName = "result.mp4", Type = "mp4" }];
        CreationPipelineStateMachine.OutputCompleted(reviewSession, iteration.Outputs);

        Assert.Equal(
            "REVIEW → ChatGPTへ結果を送信",
            CreationPipelineLoopText.Resolve(reviewSession, true, ConnectionState.Connected, reviewSession.OriginalIdea));

        CreationPipelineStateMachine.ReviewCopied(reviewSession);
        Assert.Equal(
            "REVIEW → レビュー返答待ち",
            CreationPipelineLoopText.Resolve(reviewSession, true, ConnectionState.Connected, reviewSession.OriginalIdea));

        CreationPipelineStateMachine.BeginCommandValidation(reviewSession);
        CreationPipelineStateMachine.CommandValidated(reviewSession, "generate");
        Assert.Equal(
            "APPLY → Workflowへ反映",
            CreationPipelineLoopText.Resolve(reviewSession, true, ConnectionState.Connected, reviewSession.OriginalIdea));
    }

    [Fact]
    public void SafetyStopAndCompletedSessionHaveDedicatedMessages()
    {
        var session = ReviewSession(maximumIterations: 1);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        Assert.Equal(
            "SAFETY STOP → 続行または終了を選択",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Connected, session.OriginalIdea));

        var completed = ReviewSession(maximumIterations: 2);
        CreationPipelineStateMachine.Complete(completed, "approved");
        Assert.Equal(
            "SESSION COMPLETE",
            CreationPipelineLoopText.Resolve(completed, true, ConnectionState.Connected, completed.OriginalIdea));
    }

    [Fact]
    public void ConnectionAndWaitingReasonsRemainStageSpecific()
    {
        var session = BoundSession();
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Disconnected);
        Assert.Equal(
            "CONNECT → 再接続待ち",
            CreationPipelineLoopText.Resolve(session, true, ConnectionState.Disconnected, null));

        var connecting = CreationPipelineLoopText.Resolve(
            new CreationSession(), false, ConnectionState.Connecting, null);
        Assert.Equal("CONNECT → MCP接続中", connecting);
    }

    private static CreationSession BoundSession(int maximumIterations = 3)
    {
        var session = new CreationSession
        {
            BoundWorkflow = WorkflowIdentity.Create("test.json"),
            LocalProjectContextId = "project",
            LocalChatContextId = "chat",
            ProjectLabel = "Project",
            ChatLabel = "Chat",
            MaximumIterations = maximumIterations,
        };
        CreationPipelineStateMachine.PrepareContext(session);
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindContext(session);
        return session;
    }

    private static CreationSession SentIdeaSession()
    {
        var session = BoundSession();
        session.OriginalIdea = "idea";
        CreationPipelineStateMachine.BootstrapCopied(session, session.OriginalIdea);
        return session;
    }

    private static CreationSession CommandReadySession()
    {
        var session = SentIdeaSession();
        CreationPipelineStateMachine.BeginCommandValidation(session);
        CreationPipelineStateMachine.CommandValidated(session, "generate");
        return session;
    }

    private static CreationSession ReviewSession(int maximumIterations)
    {
        var session = CommandReadySession();
        session.MaximumIterations = maximumIterations;
        CreationPipelineStateMachine.ApplyCompleted(session);
        CreationPipelineStateMachine.BeginGenerate(session);
        var iteration = session.StartIteration("prompt", new Dictionary<string, System.Text.Json.Nodes.JsonNode?>());
        iteration.Status = JobStatus.Completed;
        iteration.Outputs = [new OutputArtifact
        {
            FullPath = typeof(CreationPipelineLoopTextTests).Assembly.Location,
            FileName = "result.mp4",
            Type = "mp4",
        }];
        CreationPipelineStateMachine.JobStatusChanged(session, JobStatus.Completed);
        CreationPipelineStateMachine.OutputCompleted(session, iteration.Outputs);
        return session;
    }

    public void Dispose()
    {
        if (Directory.Exists(_temp)) Directory.Delete(_temp, true);
    }
}
