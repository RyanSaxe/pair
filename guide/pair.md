# Pair

pair lets an agent and a user work together in the browser. The agent
publishes pages in rounds. The user reads them, chooses options and comments
on anything, and when the user submits, the agent starts the next round. A
session can plan a change, build an accepted plan, or help the user
understand something, and one session can do all three.

## What a page contains

A page is about one subject and can contain any mix of these:

- Explanations. The agent helps the user understand something: code, a
  change, a system or a topic. The agent starts the page with the subject
  itself, often a diagram, quotes real code with its file and lines, and
  shows changes as diffs.
- Decisions. The agent puts what is still open on the page as proposals,
  options and questions, with the material needed to judge them. People
  judge by looking, so a page shows its subject with mocks, diagrams, code
  and diffs, and uses a visual decision when the options differ in something
  the user could see.
- Built work. The agent explains work that someone built, the agent or
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
ask every later question there. When the first Agreed publishes, open the
session in the user's default browser and give the link in chat.

After the last page of a round publishes, or after `pair pause`, the turn
ends. When the user submits feedback or an acceptance, the hub sends a wake
message that starts the next turn. When `pair start` refuses because the
harness cannot receive a wake message, give the user the printed instruction
and wait for a restart.

## Planning

The agent's job is to close the ambiguity between the request and a plan
that another engineer could implement. The ambiguity is of two kinds.
Ambiguity in the task is about what is being built and why. Ambiguity in the
work is about how to build it. The task usually has to be settled first,
because the work depends on it, but the agent can find ambiguity of either
kind in any round, in the feedback or in the code.

When nothing in the task or the work is left to decide, the agent presents
the complete plan, starting with an overview page. Only the complete plan's
Agreed names the `plan` offer, which lets the user accept it, as
[round.md](round.md) describes. The user accepts it or sends feedback. If
feedback reopens a settled choice, return to exploration before presenting
another complete plan.

An engineer or agent who saw none of the rounds and none of the
conversation implements the final plan. Every approved look, wording,
interface, piece of code and behavior appears in the plan itself, updated to
match everything agreed after it was shown. An approved mock is shown in the
plan, not described. [quality.md](quality.md) says how to carry approved
material into the plan, including material that was approved only in part.

The user accepts the plan with one of two actions:

- Start implementation: the holder, the agent that ran `pair start` on the
  session, builds the plan in the session's next round, as
  [offers/plan.md](offers/plan.md) describes.
- Save for later: the plan stays accepted in the session. The holder says
  the handoff line in chat and ends its turn. Any agent that later runs the
  line's command becomes the holder and builds the plan.

Follow the chosen action and the project's permissions. Do not change an
accepted plan.

## Files

- [round.md](round.md): the sequence for each round. The hub's wake message
  names `pair ack`, whose `next` line names this file.
- [quality.md](quality.md): what makes a page and a plan good. Read it
  before the first round.
- [writing.md](writing.md): the rules every sentence follows.
- [session.md](session.md): starting, resuming, accepting and handing over a
  session. Read it before `pair start`.
- [offers/plan.md](offers/plan.md): the two ways to accept a plan, and how
  to build it.
- [offers/finish.md](offers/finish.md): the two ways to accept built work.
- [component index](components.md): every component and its markup. A page
  copies a component's markup and nothing else.
- [the components README](../src/components/README.md): writing a
  component, when a page needs one or the user asks to keep one.
- [pages.md](pages.md), [agreements.md](agreements.md) and
  [prototypes.md](prototypes.md): the contracts. Look one up while writing a
  page.
- [setup.md](setup.md): when starting, waking or a command fails.
