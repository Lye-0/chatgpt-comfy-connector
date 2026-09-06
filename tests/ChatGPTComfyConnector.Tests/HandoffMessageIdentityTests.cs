using ChatGPTComfyConnector.Core.Models;
using ChatGPTComfyConnector.Core.Services;

namespace ChatGPTComfyConnector.Tests;

public sealed class HandoffMessageIdentityTests
{
    [Fact]
    public void CompleteResponseReceivedAndCompletedStatesShareOneTimelineIdentity()
    {
        var received = Message(HandoffTransportState.Received, iteration: 1);
        var completed = Message(HandoffTransportState.Completed, iteration: null);

        Assert.True(HandoffMessageIdentity.Matches(received, completed));
        Assert.True(HandoffMessageIdentity.Matches(completed, received));
    }

    [Fact]
    public void DifferentCompleteResponsePayloadsRemainSeparateBoundaries()
    {
        var first = Message(HandoffTransportState.Received, iteration: 1, payload: "first-response");
        var second = Message(HandoffTransportState.Received, iteration: null, payload: "second-response");

        Assert.False(HandoffMessageIdentity.Matches(first, second));
    }

    [Fact]
    public void GenerationResponseReceivedAndImportedStatesShareOneTimelineIdentity()
    {
        var received = new HandoffMessage
        {
            Direction = HandoffDirection.ChatGptToComfy,
            Kind = HandoffMessageKind.GenerationCommand,
            State = HandoffTransportState.Received,
            IterationNumber = 1,
            Payload = "same-payload",
        };
        var differentIteration = new HandoffMessage
        {
            Direction = received.Direction,
            Kind = received.Kind,
            State = HandoffTransportState.Completed,
            IterationNumber = null,
            Payload = received.Payload,
        };

        Assert.True(HandoffMessageIdentity.Matches(received, differentIteration));
    }

    [Fact]
    public void DifferentGenerationResponsePayloadsRemainSeparateBoundaries()
    {
        var first = new HandoffMessage
        {
            Direction = HandoffDirection.ChatGptToComfy,
            Kind = HandoffMessageKind.GenerationCommand,
            State = HandoffTransportState.Received,
            IterationNumber = 1,
            Payload = "response handoff_id=first boundary_id=first-boundary seed=7358",
        };
        var second = new HandoffMessage
        {
            Direction = first.Direction,
            Kind = first.Kind,
            State = HandoffTransportState.Received,
            IterationNumber = null,
            Payload = "response handoff_id=second boundary_id=second-boundary seed=7358",
        };

        Assert.False(HandoffMessageIdentity.Matches(first, second));
    }

    [Fact]
    public void OutgoingMessagesStillRequireTheSameIterationProjection()
    {
        var received = new HandoffMessage
        {
            Direction = HandoffDirection.ComfyToChatGpt,
            Kind = HandoffMessageKind.GenerationResult,
            State = HandoffTransportState.Attached,
            IterationNumber = 1,
            Payload = "same-payload",
        };
        var differentIteration = new HandoffMessage
        {
            Direction = received.Direction,
            Kind = received.Kind,
            State = HandoffTransportState.Attached,
            IterationNumber = null,
            Payload = received.Payload,
        };

        Assert.False(HandoffMessageIdentity.Matches(received, differentIteration));
    }

    private static HandoffMessage Message(
        HandoffTransportState state,
        int? iteration,
        string payload = "same-complete-response")
        => new()
        {
            Direction = HandoffDirection.ChatGptToComfy,
            Kind = HandoffMessageKind.Complete,
            State = state,
            IterationNumber = iteration,
            Payload = payload,
        };
}
