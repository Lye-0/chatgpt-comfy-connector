using System.Text.Json;
using System.Text.Json.Nodes;
using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class HistoryOutcomeTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(
        Path.GetTempPath(),
        "ChatGPTComfyConnector.HistoryOutcomeTests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public void SuccessfulOutputIsRecordedAsGenerated()
    {
        var session = CreateSession(maximumIterations: 3);

        var iteration = AddCompletedIteration(session, "first generation");

        Assert.Equal(IterationOutcome.Generated, iteration.Outcome);
        Assert.False(iteration.IsFinal);
    }

    [Fact]
    public void RunLimitIsRecordedOnTheCurrentIterationAndIsIdempotent()
    {
        var session = CreateSession(maximumIterations: 1);
        var iteration = AddCompletedIteration(session, "limited generation");

        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached");
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached again");

        Assert.Equal(IterationOutcome.LimitReached, iteration.Outcome);
        Assert.Single(session.Iterations);
    }

    [Fact]
    public void ResumeKeepsPreviousOutcomesAndNewRunRecordsGeneratedIterations()
    {
        var session = CreateSession(maximumIterations: 1);
        var limited = AddCompletedIteration(session, "limited generation");
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "maximum reached");

        CreationPipelineStateMachine.ResumeFromLimit(session);
        var resumed = AddCompletedIteration(session, "resumed generation");

        Assert.Equal(IterationOutcome.LimitReached, limited.Outcome);
        Assert.Equal(IterationOutcome.Generated, resumed.Outcome);
        Assert.False(limited.IsFinal);
        Assert.False(resumed.IsFinal);
    }

    [Fact]
    public void ChatGptCompleteMarksTheCurrentSuccessfulIterationAsFinal()
    {
        var session = CreateSession(maximumIterations: 3);
        var iteration = AddCompletedIteration(session, "approved generation");

        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);

        Assert.Equal(IterationOutcome.ChatGptComplete, iteration.Outcome);
        Assert.True(iteration.IsFinal);
        Assert.Single(session.Iterations, item => item.IsFinal);
    }

    [Fact]
    public void CompletedResumeClearsOnlyFinalAndASecondCompleteCreatesOneNewFinal()
    {
        var session = CreateSession(maximumIterations: 2);
        var firstFinal = AddCompletedIteration(session, "first final");
        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);

        CreationPipelineStateMachine.Resume(session);

        Assert.Equal(IterationOutcome.ChatGptComplete, firstFinal.Outcome);
        Assert.False(firstFinal.IsFinal);

        var secondFinal = AddCompletedIteration(session, "second final");
        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);

        Assert.Equal(IterationOutcome.ChatGptComplete, firstFinal.Outcome);
        Assert.Equal(IterationOutcome.ChatGptComplete, secondFinal.Outcome);
        Assert.False(firstFinal.IsFinal);
        Assert.True(secondFinal.IsFinal);
        Assert.Single(session.Iterations, item => item.IsFinal);
    }

    [Fact]
    public void OutcomeHistoryMatchesRepeatedRunLimitAndChatGptCompletionSequence()
    {
        var session = CreateSession(maximumIterations: 2);

        AddCompletedIteration(session, "iteration 1");
        var iteration2 = AddCompletedIteration(session, "iteration 2");
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "run one maximum reached");
        CreationPipelineStateMachine.ResumeFromLimit(session);

        AddCompletedIteration(session, "iteration 3");
        var iteration4 = AddCompletedIteration(session, "iteration 4");
        CreationPipelineStateMachine.AutomaticIterationLimitReached(session, "run two maximum reached");
        CreationPipelineStateMachine.ResumeFromLimit(session);

        AddCompletedIteration(session, "iteration 5");
        var iteration6 = AddCompletedIteration(session, "iteration 6");
        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);
        CreationPipelineStateMachine.Resume(session);

        AddCompletedIteration(session, "iteration 7");
        var iteration8 = AddCompletedIteration(session, "iteration 8");
        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);

        Assert.Equal(
            [
                IterationOutcome.Generated,
                IterationOutcome.LimitReached,
                IterationOutcome.Generated,
                IterationOutcome.LimitReached,
                IterationOutcome.Generated,
                IterationOutcome.ChatGptComplete,
                IterationOutcome.Generated,
                IterationOutcome.ChatGptComplete,
            ],
            session.Iterations.Select(item => item.Outcome));
        Assert.False(iteration2.IsFinal);
        Assert.False(iteration4.IsFinal);
        Assert.False(iteration6.IsFinal);
        Assert.True(iteration8.IsFinal);
        Assert.Single(session.Iterations, item => item.IsFinal);
    }

    [Fact]
    public void OutcomeAndFinalSurviveSessionRoundTripAndResumeKeepsOutcome()
    {
        var session = CreateSession(maximumIterations: 3);
        var iteration = AddCompletedIteration(session, "persisted generation");
        CreationPipelineStateMachine.Complete(session, "ChatGPT completed the session.", chatGptComplete: true);

        var restored = JsonSerializer.Deserialize<CreationSession>(JsonSerializer.Serialize(session));
        Assert.NotNull(restored);

        CreationPipelineStateMachine.EnsureInitialized(restored!);
        var restoredIteration = Assert.Single(restored.Iterations);
        Assert.Equal(IterationOutcome.ChatGptComplete, restoredIteration.Outcome);
        Assert.True(restoredIteration.IsFinal);

        CreationPipelineStateMachine.Resume(restored);

        Assert.Equal(IterationOutcome.ChatGptComplete, restoredIteration.Outcome);
        Assert.False(restoredIteration.IsFinal);
    }

    [Fact]
    public void LegacyCompletedSessionGetsAStableHistoryOutcomeWithoutACompletedLabel()
    {
        var session = CreateSession(maximumIterations: 3);
        var iteration = AddCompletedIteration(session, "legacy generation");
        iteration.Outcome = IterationOutcome.Unknown;
        session.Status = SessionStatus.Completed;
        session.CompletionReason = "ChatGPT completed the session.";

        CreationPipelineStateMachine.EnsureInitialized(session);

        Assert.Equal(IterationOutcome.ChatGptComplete, iteration.Outcome);
        Assert.True(iteration.IsFinal);
    }

    [Fact]
    public void HistoryTemplateUsesThePersistedOutcomeAndIndependentFinalBadge()
    {
        var item = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "ViewModels", "GenerationHistoryItem.cs");
        var xaml = ReadRepoFile("src", "ChatGPTComfyConnector.Desktop", "MainWindow.xaml");
        var footerStart = xaml.IndexOf("<Grid Grid.Row=\"2\">", StringComparison.Ordinal);
        Assert.True(footerStart >= 0);
        var footerEnd = xaml.IndexOf("</Grid>", footerStart, StringComparison.Ordinal);
        Assert.True(footerEnd > footerStart);
        var footer = xaml[footerStart..footerEnd];

        Assert.Contains("public string OutcomeText", item, StringComparison.Ordinal);
        Assert.Contains("public bool IsFinal => Iteration.IsFinal;", item, StringComparison.Ordinal);
        Assert.Contains("Text=\"{Binding OutcomeText}\"", xaml, StringComparison.Ordinal);
        Assert.DoesNotContain("Text=\"{Binding StatusText}\"", footer, StringComparison.Ordinal);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory)) Directory.Delete(_tempDirectory, recursive: true);
    }

    private CreationSession CreateSession(int maximumIterations)
    {
        Directory.CreateDirectory(_tempDirectory);
        var session = new CreationSession
        {
            Id = "session-history-outcome-test",
            OriginalIdea = "idea",
            ProjectLabel = "Project",
            ChatLabel = "Chat",
            ContextProviderId = ContextProviderIds.LocalJson,
            ProjectContextKey = "project-history-outcome-test",
            ChatContextKey = "chat-history-outcome-test",
            BoundWorkflow = WorkflowIdentity.Create("workflow.json"),
            MaximumIterations = maximumIterations,
        };
        CreationPipelineStateMachine.SynchronizeConnectionGate(session, ConnectionState.Connected);
        CreationPipelineStateMachine.BindWorkflow(session, session.BoundWorkflow!, SlotDiscoveryState.Loaded);
        CreationPipelineStateMachine.BindChat(session);
        return session;
    }

    private SessionIteration AddCompletedIteration(CreationSession session, string prompt)
    {
        var number = session.CurrentIteration + 1;
        var outputPath = Path.Combine(_tempDirectory, $"output-{number}.mp4");
        File.WriteAllText(outputPath, "media");
        var iteration = session.StartIteration(prompt, new Dictionary<string, JsonNode?>());
        iteration.Status = JobStatus.Completed;
        iteration.Outputs =
        [
            new OutputArtifact
            {
                FileName = Path.GetFileName(outputPath),
                Type = "mp4",
                FullPath = outputPath,
            },
        ];
        CreationPipelineStateMachine.OutputCompleted(session, iteration.Outputs);
        return iteration;
    }

    private static string ReadRepoFile(params string[] parts)
    {
        var path = Path.Combine([AppContext.BaseDirectory, "..", "..", "..", "..", "..", .. parts]);
        return File.ReadAllText(Path.GetFullPath(path));
    }
}
