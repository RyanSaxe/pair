# Pair

pair lets an agent and a user work together in the browser. The agent
publishes pages in rounds. The user reads them, chooses options and comments
on anything, and when the user submits, the agent starts the next round. A session
can plan a change, build an accepted plan, or help the user understand
something, and one session can do all three.

## What a page holds

A page is about one subject and can hold any mix of these:

- Explanations. The agent helps the user understand something: code, a
  change, a system or a topic. It starts with the subject itself, often a
  diagram, quotes real code with its file and lines, and shows changes as
  diffs.
- Decisions. The agent puts what is still open on the page as proposals,
  options and questions, with the material needed to judge them. People judge by looking,
  so show the subject with mocks, diagrams, code and diffs, and use a visual
  decision when the options differ in something the user could see.
- Built work. The page walks through work someone built, the agent or
  anyone else, such as a pull request under review, so that the user
  understands it well enough to own it without reading every line.

Agreed is the first page of every round, and it is the session's running
context. It starts with the task: a title and a few sentences on what the
session is working towards, as the agent currently understands it. The task
is not a list of decisions. The user corrects it by commenting, like anything
else, and the agent never asks them to approve it. The settled decisions
follow the task, each with its source. The agent rewrites Agreed from the
feedback at the start of every round, as [agreements.md](agreements.md) describes.

## Starting

The session begins in the conversation, and the aim is to reach the browser
quickly with enough context. Learn what you can from the project first. Then
ask a few specific questions about this task that the project cannot answer,
and put the ones whose answers do not depend on each other in one message.
Move to the browser as soon as you know enough to write the first page, and
ask every later question there. When
the first Agreed publishes, open the session in the user's default browser
and give the link in chat.

After the last page of a round publishes, or after `pause`, the turn ends.
The hub starts another turn when a submission arrives, including an
acceptance. When `start` refuses because the harness cannot receive a wake
event, give the user the printed instruction and wait for a restart.

## Planning

The agent's job is to close the ambiguity between the request and a plan
that another engineer could implement. The ambiguity is of two kinds.
Ambiguity in the task is about what is being built and why. Ambiguity in the
work is about how to build it. The task usually has to be settled first,
because the work depends on it, but either kind can surface at any point.

When nothing in the task or the work is left to decide, the agent presents
the complete plan, starting with an overview page. The user accepts it or
sends feedback. If feedback reopens a settled choice, return to exploration
before presenting another complete plan.

An engineer or agent who saw none of the rounds and none of the
conversation implements the final plan. Every approved look, wording,
interface, piece of code and behavior appears in the plan itself, updated to match
everything agreed after it was shown. An approved mock is shown in the plan,
not described. [quality.md](quality.md) says how to carry approved material into the plan,
including material that was approved only in part.

The user accepts the plan with one of two actions:

- Start implementation: the agent that holds the session builds the plan
  in this session, as Building describes.
- Save for later: the plan waits in the session. The agent gives the handoff
  line in chat and ends its turn. An agent that later runs `pair start` on the
  session holds it and builds the plan, as Building describes.

Follow the chosen action and the project's permissions. Do not change an
accepted plan.

## Building

Building is how the agent goes through an accepted plan while it codes.

1. Before the first change, publish a round: Agreed, then the list of pages
   the work will produce, one per plan step unless another structure
   explains the work better. Agreed holds the task and does not repeat the
   plan.
2. Report progress as [round.md](round.md) describes: `pair progress --start` on the
   page you are working on, and `pair ack --note` at least every five
   minutes.
3. Publish each page when its part is done and checked.
4. Do not stop to ask. When the plan does not settle something, decide in
   the direction of the plan's intent, build it, and say on the page what
   you decided and why.
5. Commit on a branch as the project's instructions say, and open no pull
   request. The round's last page is the pull request description: what the
   change is, why it matters, how to review it and what was done to trust
   it. When the work is complete, attach the `finish` offer. If the user
   chooses Open a PR there, that page becomes its body.

## Files

- [round.md](round.md): the sequence for each round. The hub's wake message
  names `ack`, which points to it.
- [quality.md](quality.md): what makes a page and a plan good. Read it
  before the first round.
- [writing.md](writing.md): the rules every sentence follows.
- [session.md](session.md): starting, resuming, accepting and handing over a
  session. Read it before `start`.
- [component index](components.md): every component and its markup. A page
  copies a component's markup and nothing else.
- [the components README](../src/components/README.md): writing a
  component, when a page needs one or the user asks to keep one.
- [pages.md](pages.md), [agreements.md](agreements.md), [frame.md](frame.md)
  and [prototypes.md](prototypes.md): the contracts. Look one up while
  building.
- [setup.md](setup.md): when starting, waking or a command fails.
