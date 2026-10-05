# Proposals and Work

A **proposal** is work the agent suggests and you decide on. The agent
records one whenever it sees work worth doing, including the work your task
calls for, with what it delivers and where the agent recommends it runs.
When you start a proposal, you approve what it delivers, and nothing more.
When you ask for work in your own words, the agent starts a proposal for
it, quoting you.

## The Work page

**Work**, in the sidebar above Review, holds every proposal of the session
for its whole life, in four tabs with counts:

| Tab       | Lists                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------- |
| Needs you | Work in its own session whose round waits for you, and any proposal with an agent reply in the bell. |
| Running   | Started work the agent is building.                                                                  |
| Proposed  | Proposals nobody has started, declined or withdrawn.                                                 |
| Done      | Finished work, joined proposals, and declined and withdrawn proposals with **Restore**.              |

Work opens on the first tab with anything in it, and the number on its row
counts what needs you. Each card shows what the work delivers, a started
card quotes the message you sent with Start, if any, and the line under
its title links to where the proposal came from or where the work runs. A
card started here reads Working here until the agent marks it done. A page
or a thread shows a proposal as the same card, with the same buttons.

A card you have not had on screen on Work reads **New**, as a page you have
not opened does in the sidebar. Your browser stores which cards you have
seen, and a card on a page counts as seen only once Work shows it. A card
in Done never reads New.

| To                | Do this                                                               |
| ----------------- | --------------------------------------------------------------------- |
| Start the work    | Press **Start**, choose where it runs, and add a message if you want. |
| Turn it down      | Press **Decline**. The agent drops it and does not propose it again.  |
| Ask about it      | Press **Comment**, which starts a [thread](threads.md) on the card.   |
| Bring a card back | Press **Restore** on a declined or withdrawn card in Done.            |

## Where the work runs

The Start popup shows what the proposal delivers, the titles of the
proposals joined into it, the three places the work can run, with the
agent's recommendation marked, and a message to the agent.

| Choice           | What happens                                                                                                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Here             | This session's agent begins it at once and publishes its pages in this session's next rounds. A round that waits for you stays open, with your drafts on it, until you send feedback, so you can start more work first.                                            |
| In a sub-session | This session's agent builds it in a session linked to this one and gives its steps to subagents, so this session's rounds continue.                                                                                                                                |
| With a new agent | A separate agent builds it in its own session linked to this one. **Copy command** copies `pair start --from DIR --proposal ID` for you to paste into any agent. With **Open a new agent session**, you ask this session's agent to open one where you can see it. |

Open a new agent session does not always work. The agent answers in a
thread on the card with what it opened, or with the command when it cannot
open one. Your own instructions for opening an agent, such as in a tmux
pane, go in `~/.config/pair/moments/read-open-agent.md`, which `pair`
prints after its own text for that moment, as
[the guide](../reference/the-guide.md) describes.

## When you ask in your own words

When you tell the agent to do a piece of work in a note, a thread or the
chat, the agent records a proposal for it, or uses one that already covers
it, and starts it with `pair propose --start`, quoting you. The work then
runs as if you had pressed Start, where you said or, when you did not, where
the agent recommends. The card says that your words started it, quotes
them, and links to the page or thread where you wrote them. It has no button
that stops the work, so tell the agent when you do not want it.

## Plans

When nothing is left to decide, or you ask for it, the agent writes the plan
and attaches it to the proposal. A plan is the pages someone who saw none of
the rounds needs to build exactly what you aligned on, with every approved
mock, wording and interface. The card then has a **Plan** tag, says which
rounds the plan came from, and has **Open plan** and **Download plan**.

Open plan opens the plan in the tab, read-only, with its pages in the
sidebar. The line under the header reads Work, the card's title and Plan,
and Work leads back. With Download plan, your browser saves the plan as one
HTML file, which opens with no hub. When later rounds change the plan, the agent
attaches it again, and it replaces the old one. Simple work can start
without a plan.

## When work is done

- Work started here is done when the agent publishes its last page, which
  explains the work well enough for you to review it and keep it. The agent
  marks the card done then, and feedback that asks for changes to it puts
  the card back in Running. Until then, the agent keeps building it in each
  round your feedback starts, whether or not your feedback mentions it.
- Work in a sub-session or a new agent session is done when you close that
  session. The hub marks the card done, and this session's agent learns of
  it the next time it runs `pair read`, then builds on its result.
- When a proposal's work got done some other way, such as in a pull
  request, the agent marks the card done and names where, whether the card
  was not started or started here. A card whose work runs in its own
  session finishes only when that session closes.
  The line under the card's title reads Done and where, such as
  Done · in #86.
- The agent withdraws a proposal nobody started when it no longer applies,
  with its reason. The card moves to Done as Withdrawn and shows the
  reason, and Restore puts it back in Proposed.
- When the work of one proposal covers another that nobody started, the agent
  merges the two with `pair propose --join`, so you follow one card. The hub
  joins a proposal into one that is proposed or started here, and refuses one
  running in a sub-session or a new agent session, because the agent that builds
  a proposal learns of the joined ones when its work starts. The merged card
  lists the joined ones under Joined into this task. Each joined card moves to
  Done, and the line under its title reads Done and Joined with the other card's
  title, such as Done · Joined Retry a charge on a timeout. `pair read` prints
  the joined proposals with a Start and with the work started here,
  `pair start --from` prints them with the proposal a linked session runs, and
  `pair status` lists them, so the agent that builds the card builds them too.
  The hub refuses to join a proposal into one that is itself joined, and when
  the agent joins a card that others joined into, the hub moves those cards
  along with it. The joined cards stay joined when the card they joined finishes
  or reopens, and the agent's `--reopen` on a joined card puts it back in
  Proposed.

## Sub-sessions and new agent sessions

A sub-session and a new agent session are both sessions linked to this one,
both ways. This session's agent holds a sub-session. A separate agent holds a
new agent session, and can read this session for context but never takes it
over. For you they look and work the same:

- The card reads Opening a sub-session, or Opening a new agent session,
  until the session starts, and then **Open** leads to it.
- The session list shows it indented under this session.
- The line under its header reads this session's name, a chevron and its
  own name. This session's name leads back.
- You send feedback on its rounds as in any session, and when you close it,
  the hub marks the card done.
