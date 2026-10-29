# Proposals and Work

The agent records each piece of work it thinks is worth doing as a
**proposal**, apart from the session's own task. The agent works on the
session's task across the rounds, and builds it when you choose Build it as
you send a round. A proposal is a card that describes what the work
delivers and where the agent recommends it runs. You decide what happens to
each one. You approve the work by pressing **Start** on the card, and you
approve only what the card describes.

When you ask the agent in your own words for work beside the session's
task, the agent records a proposal for it, or uses one that already covers
it, and starts it for you, quoting your words. Every such piece of work you
approve therefore has a card.

## The Work page

**Work**, in the sidebar above Review, lists every proposal of the session,
from the moment the agent records it, in four tabs:

| Tab       | Lists                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs you | Proposals with an agent reply that you have not cleared from the bell, and work running in its own session when that session has a round waiting for you. |
| Running   | Work you approved that is not finished yet.                                                                                                               |
| Proposed  | Proposals waiting for you to start or decline them.                                                                                                       |
| Done      | Finished work, proposals the agent joined into another, and proposals that you declined or the agent withdrew.                                            |

Work opens on the first tab that has a card in it. When you click a bell line
or a system notification about a card, Work opens on that card's tab instead,
with the card or the agent's reply in view. The Work row in the sidebar shows
two numbers. The grey number is the number of cards in Proposed, and the
orange one is the number in Needs you.

### Cards

Each card shows the work's title, a status line, and what the work
delivers. When the agent writes about a proposal on a page, it puts the same
card on the page, with the same buttons.

- The status line shows the state of the work. On most cards, it also links
  to where the proposal came from, or to the session the work runs in.
- When you started the work with a message, the card shows your message in
  quotes.
- When the agent started the work on your words, the card shows Started from
  your words, with a link to where you wrote them, and shows your words in
  quotes.
- While the work runs, the card lists its parts in the order the agent added
  them, each marked done, left or dropped, with a dropped part crossed off.
  Above the parts, it shows how many parts are done, leaving out the dropped
  ones, and the next part left. Narrower than 720px, the card shows only that
  line until you tap it. The agent records the parts with
  [`pair propose`](../reference/commands.md#pair-propose), and no command
  removes a part.

pair labels a card **New** until you have seen it on Work, as it labels an
unopened page in the sidebar. pair records a card as seen once half of it is
on screen on Work, and a card you see only on another page stays New. The
hub stores which cards you have seen, so a phone and a computer on the same
hub show the same New labels. pair never labels a card in Done as New.

### Status lines

| Status line                                          | Meaning                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Proposed                                             | Nobody has started the work.                                                             |
| Working here                                         | The work runs in this session's rounds.                                                  |
| Opening a sub-session, Opening a new agent session   | You started the work in its own session, and the agent has not created that session yet. |
| Planning in a sub-session, Planning with a new agent | You started the work with Plan it first, and have not chosen Build it in its session.    |
| Working                                              | The work runs in its own session.                                                        |
| Waiting for you                                      | The session the work runs in has a round waiting for you.                                |
| Agent replied                                        | The agent replied in a thread on the card, and you have not cleared it from the bell.    |
| Done                                                 | The work is finished.                                                                    |
| Declined                                             | You declined the proposal.                                                               |
| Withdrawn                                            | The agent withdrew the proposal, and the card shows its reason.                          |

### What you can do with a card

| To                    | Do this                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Approve the work      | Press **Start**, choose where the work runs, and add a message to the agent or check Plan it first if you want.                             |
| Turn it down          | Press **Decline**. The agent drops the proposal and does not suggest it again.                                                              |
| Ask about it          | Click the card, then press the comment button at the bottom right, or <kbd>c</kbd>. Send it as a [thread](threads.md) to get an answer now. |
| Bring a proposal back | Press **Restore** on a declined or withdrawn card in Done. pair moves the card back to Proposed.                                            |

## Where the work runs

When you press Start, a popup shows what the proposal delivers, the titles
of any proposals joined into it, and the three places the work can run, with
the agent's recommendation marked. It also has a box for a message to the
agent.

| Choice           | What happens                                                                                                                                                                                                                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Here             | This session's agent starts the work right away. It publishes the work's pages in the session's next round, or in the round it is writing when it has not yet published that round's Agreed.                                                                                                                    |
| In a sub-session | This session's agent creates a session linked to this one and builds the work there, with subagents doing the steps, so this session's rounds continue.                                                                                                                                                         |
| With a new agent | A separate agent builds the work in its own session, linked to this one. Pressing **Copy command** approves the work and copies `pair start --from DIR --proposal ID` for you to paste into any agent. With **Open a new agent session**, you ask this session's agent to open that agent where you can see it. |

Below the message box is the **Plan it first** checkbox. When you check it,
the agent in the work's own session works towards a plan in that session's
rounds, and builds nothing until you choose Build it in one of them. The
card's status line starts with Planning until then. When you choose Here,
the checkbox turns off and cannot be checked, because a plan round in this
session would mix with its other work.

Starting work never ends the round you are reading. Your drafts on the
round stay, and you can start more work before you send feedback.

The agent cannot always open a new agent session. It replies in a thread
on the card with what it opened, or with the command when it cannot open an
agent. To tell the agent how to open one on your machine, such as in a tmux
pane, write your instructions in `~/.config/pair/moments/read-open-agent.md`.
`pair` prints that file after its own instructions for that step, as
[the guide](../reference/the-guide.md) describes.

## When you ask in your own words

When you tell the agent in a note, a thread or the chat to do a piece of
work, the agent records a proposal for it, or uses one that already covers
it. Then it starts the proposal with `pair propose --start`, quoting you.
The work runs as if you had pressed Start, where you said it should run, or
where the agent recommends when you did not say.

The card reads Started from your words, shows your words in quotes, and
links to the page or thread where you wrote them. Once work has started, its
card has no button that stops it, so tell the agent when you do not want the
work.

## Plans

A plan is a round from which an engineer or agent who saw none of the
rounds could build the work without asking questions. It contains:

- what the work achieves and why
- the approach and the alternatives set aside
- each change, with the files and interfaces it touches
- every look and interface, exactly as you approved it
- what is out of scope
- how to check that the work is done

The agent makes a round a plan when you choose Write a plan as you send a
round, or when it judges that it knows enough to write one. pair marks a
plan round with a grey Plan tag. [Plan a change](../guides/plan-a-change.md)
explains how you read a plan and build from it. For a proposal that runs in
its own session, check Plan it first when you start it, and the agent in
that session plans the work before it builds it.

## When work is finished

How work finishes depends on where it runs.

- Work that runs here is finished when the agent publishes the last page
  about it. On that page, the agent explains the work well enough for you to
  review and maintain it. The agent then marks the proposal done with
  `pair propose --done`, and pair moves the card to Done. Until then, the
  agent keeps building the work in every round after your feedback,
  whether or not you mention the work in it. When you ask for changes to
  finished work in your feedback, the agent reopens the proposal with
  `pair propose --reopen`, and pair moves the card back to Running.
- Work that runs in a sub-session or a new agent session is finished when
  you close that session. The hub then marks the proposal done. This
  session's agent sees that the proposal is done the next time it runs
  `pair read`, and builds on the work done in that session.

## Done elsewhere, withdrawn or joined

The agent also keeps the cards up to date as the session goes on:

- When a proposal's work was finished some other way, such as in a pull
  request, the agent marks the proposal done with `pair propose --done` and
  `--where`. The status line then shows Done and the place, such as Done ·
  in #86. The agent can do this for a proposal you have not approved, or one
  that runs here, but not for one whose work runs in its own session. That work
  finishes when you close its session.
- When a proposal you have not approved no longer applies, the agent withdraws
  it with `pair propose --withdraw` and gives a reason. pair moves the card
  to Done, marked Withdrawn, with the agent's reason. Press Restore to put
  it back in Proposed.
- When the work of one proposal covers another, the agent joins the second
  into the first with `pair propose --join`, so you follow one card.

## Joined proposals

The agent can join proposal A into proposal B when B's work covers A's. The
hub accepts the join only when both of these are true:

- A is in Proposed.
- B's work has not started or runs here. The agent that builds B reads the
  proposals joined into it when the work starts, so the hub refuses to join
  a proposal into one whose work already runs in its own session.

The hub also refuses to join a proposal into one that is declined,
withdrawn, done or joined into another.

B's card, and its Start popup, list the joined proposals under Joined into
this proposal. pair moves each joined card to Done, and its status line shows
Done and Joined with B's title, such as Done · Joined Retry a charge on a
timeout. When the agent joins a card that other cards were joined into, the
hub moves those cards to B as well.

When you start B, you approve the work of every proposal joined into it, and
the agent builds all of it. The agent sees the joined proposals in the output of
these commands:

- `pair read`, when you start B and while B's work runs here
- `pair propose --start`, when the holder starts B on your words
- `pair start --from`, when B runs in a linked session
- `pair status`

Joined cards stay joined when B's work finishes or the agent reopens B. When
the agent runs `pair propose --reopen` on a joined card, pair moves that
card back to Proposed.

## Sub-sessions and new agent sessions

A sub-session and a new agent session are both sessions linked to this one,
and each one links to the other. This session's agent runs a
sub-session alongside this one. A separate agent runs a new agent session.
That agent can read this session for context, but never takes it over. In
the browser, the two kinds work the same way:

- The card shows Opening a sub-session, or Opening a new agent session,
  until the agent creates the session. Then the card's status line has an
  **Open** link to it.
- The session list shows the session indented under this one.
- The line under its header shows this session's name, a chevron and its
  own name. Click this session's name to go back.
- You send feedback on its rounds as in any session. When you close it, the
  hub marks the proposal done in this session.
