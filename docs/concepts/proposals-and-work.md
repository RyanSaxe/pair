# Proposals and Work

Apart from the session's main task (built when you send a round with
**Build it**), the agent records suggested work as **proposals**. Each proposal
is a card stating what it delivers and where the agent recommends running it.
Press **Start** to approve only what the card describes.

If you ask in your own words for extra work, the agent creates or reuses a
proposal and starts it quoting you, so every approved piece of work has a card.

## The Work page

**Work** (in the sidebar above Review) lists all session proposals in three
tabs:

| Tab      | Lists                                                                                                                               |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Running  | Unfinished work approved to run in this session.                                                                                    |
| Proposed | Proposals waiting for you to start or decline.                                                                                      |
| Done     | Finished work, work running in its own session, joined proposals, and declined or withdrawn proposals.                              |

Proposals started in a sub-session or with a new agent move to Done immediately
with a link to their session and the words that started them.

Tab placement depends strictly on card state. An agent reply or a waiting round
in a linked session adds a bell row and updates the card's status line without
changing its tab.

Work opens on Proposed if any proposals wait there, or the first non-empty tab
otherwise. Clicking a card in the [bell](sessions-and-rounds.md#the-bell),
[Notifications](sessions-and-rounds.md#notifications), or a system notification
jumps directly to that card's tab. The sidebar's Work badge counts only Proposed
cards.

Cards on screen hold their position while you read. A card you start or decline
shows its new status in place until you switch tabs, so the tab count can
briefly be lower than the visible cards.

### Cards

Each card shows its title, status line, and deliverable; inline proposal cards
on pages have the same buttons.

- The status line shows state and links to the proposal's origin or linked
  session.
- Start messages appear in quotes. Work started from your words shows
  **Started from your words** with a link and quote.
- Running cards list parts in creation order (done, left, or crossed-off
  dropped) with a header summarizing completed vs. remaining non-dropped parts
  and the next part left (collapsed to that header below 720px until tapped).
  The agent updates parts with
  [`pair propose`](../reference/commands.md#pair-propose); no command deletes a
  part.

Unseen Proposed and Running cards carry a **New** label until at least half the
card scrolls into view on Work (viewing it on another page does not clear New).
Seen state syncs via the hub across devices. Done cards never show New.

### Writing your own item

**New work item** at the top of Work opens a form (title, up to 4,000-character
description, and optional images). Choose where it runs and click **Start**, or
**Save for later** to add it to Proposed. Unsubmitted text and images persist
across closes and reloads.

The hub hides saved cards from agents until you start them and refuses agent
attempts to revise, withdraw, or join user-written cards.

### Status lines

| Status line                                          | Meaning                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Proposed                                             | Not started yet.                                                                    |
| Working here                                         | Running in this session's rounds.                                                   |
| Opening a sub-session, Opening a new agent session   | Approved for its own session; agent has not created that session yet.               |
| Planning in a sub-session, Planning with a new agent | Started with Plan it first; Build it has not been chosen in that session yet.       |
| In its own session                                   | Running in a linked session (click **Open** beside it).                             |
| Waiting for you                                      | The linked session has a round waiting for you.                                     |
| Agent replied                                        | Unfinished card has an unread agent reply in the bell.                              |
| Done                                                 | Finished.                                                                           |
| Declined                                             | Declined by you.                                                                    |
| Withdrawn                                            | Withdrawn by the agent (card shows reason).                                         |

### What you can do with a card

| Action           | How                                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Approve work     | Press **Start**, pick where it runs, and optionally add a message or check **Plan it first**.                                     |
| Turn it down     | Press **Decline**. The agent drops it and does not re-propose it.                                                                 |
| Ask about it     | Click the card, then press the comment button or <kbd>c</kbd>, and send as a [thread](threads.md) for an immediate reply.         |
| Restore a card   | Press **Restore** on a declined or withdrawn card in Done to move it back to Proposed.                                            |

## Where the work runs

Pressing **Start** opens a drawer showing the deliverable, any joined proposals,
three execution targets (with the agent's recommendation marked), and an
optional message box:

| Choice           | Behavior                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Here             | This session's agent starts immediately and publishes pages in the current unpublished round or the next round.                                                                                             |
| In a sub-session | This session's agent opens a linked session and builds there using subagents while this session continues.                                                                                                  |
| With a new agent | A separate agent builds in a linked session. **Copy command** approves and copies `pair start --from DIR --proposal ID`; **Open a new agent session** asks this session's agent to launch that agent visibly. |

Check **Plan it first** (available for sub-sessions and new agents, disabled for
**Here**) so the linked session plans in rounds before building anything; the
status line shows **Planning** until you pick **Build it** there.

Starting work leaves the current round open and your drafts intact.

If `~/.config/pair/spawn` (or `spawn.ps1` on Windows) exists and is executable,
**Open a new agent session** becomes **Start agent**. Clicking it with no
message runs `spawn DIR COMMAND ARG…` (via PowerShell on Windows), launching the
same CLI in the session's directory with a prompt to run
`pair register --name ID` (falling back to the default name on collision),
`pair guide`, and `pair start --from`. If the script fails, the drawer shows its
error and the work stays approved as with Copy command.

Including a message (such as "codex, high effort, no approvals") routes through
this session's agent instead, which uses `pair spawn` if configured or starts
the agent another way and replies in a thread on the card. Add machine-specific
launch instructions in `~/.config/pair/moments/read-open-agent.md` (see
[the guide](../reference/the-guide.md)).

## When you ask in your own words

If you request work in a note, thread, or chat, the agent creates or reuses a
proposal and runs `pair propose --start` quoting you, using your chosen target
or its recommendation. The card shows **Started from your words**, your quote,
and a link to its source. Started cards have no cancel button; tell the agent if
you no longer want the work.

## Plans

A plan round gives any engineer or agent everything needed to build without
seeing earlier rounds:

- goal and rationale
- chosen approach and rejected alternatives
- changes with affected files and interfaces
- exact approved looks and interfaces
- out-of-scope boundaries
- verification steps

The agent writes a plan when you send with **Write a plan** or when it has
enough context, marking it with a grey **Plan** tag (see
[Plan a change](../guides/plan-a-change.md)). For proposals in linked sessions,
check **Plan it first** when starting them.

## When work is finished

- **Here**: After publishing the final review page, the agent runs
  `pair propose --done` and pair moves the card to Done. Until then, the agent
  continues the work on every round. Asking for changes in a later send makes
  the agent run `pair propose --reopen`, moving the card back to Running.
- **Sub-session or new agent**: Closing that linked session marks the proposal
  done (**Done in its own session**), which this session's agent sees on its
  next `pair read`. Reopening that session clears the done mark and returns the
  status line to **In its own session** (staying in Done).

## Done elsewhere, withdrawn or joined

- **Done elsewhere**: `pair propose --done --where TEXT` marks an unstarted or
  running-here proposal done with a location (for example, `Done · in #86`). Not
  allowed for linked-session proposals.
- **Withdrawn**: `pair propose --withdraw --reason TEXT` moves an unapproved
  proposal to Done (**Withdrawn**) with a reason. Press **Restore** to return it
  to Proposed.
- **Joined**: `pair propose --join OTHER` merges a redundant proposal into
  another so you track one card.

## Joined proposals

The hub accepts joining proposal A into proposal B only when A is in Proposed
and B is either unstarted or running here (never declined, withdrawn, done,
joined, or already running in its own session).

B's card and Start drawer list joined proposals under
**Joined into this proposal**. Joined cards move to Done with status
`Done · Joined <B's title>`. Joining a card that already has joined cards moves
those cards to B as well.

Starting B approves all joined proposals, which appear in `pair read`,
`pair propose --start`, `pair start --from`, and `pair status`. Joined cards
stay joined when B finishes or reopens; `pair propose --reopen` on a joined card
returns it to Proposed.

## Sub-sessions and new agent sessions

Both are linked sessions with two-way links to their parent. This session's
agent runs a sub-session; a separate agent runs a new agent session (reading the
parent for context without taking it over). Both behave identically in the
browser:

- Card status shows **Opening…** until created, then offers an **Open** link.
- The session list indents the linked session under its parent.
- A breadcrumb under the header links back to the parent session.
- Rounds work normally; closing the session marks the parent proposal done.
