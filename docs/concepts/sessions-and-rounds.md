# Sessions and rounds

A session is one piece of work you do with your agent: understanding
something, planning a change, building it, or all three in turn. It lives at
one URL, and each round appears in the same tab. It runs until you close it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/session-dark.svg">
  <img alt="A session: you ask, then work through rounds with feedback. The agent proposes work on the Work page, and work you start runs in the session's next rounds or in a sub-session. A session ends when you close it." src="../assets/session-light.svg">
</picture>

## A round

1. The agent publishes **Agreed** and the names of the round's pages, then
   each page as it finishes. You can start reading straight away.
2. You respond on the pages: choose, answer, comment.
3. You press **Send feedback**. The agent reads it and publishes the next
   round.

Every round ends with your feedback. While the agent works, a card at the
top of Agreed shows what it is doing and how many pages are ready.

## The sidebar

The sidebar lists the round's pages, then **Work** and **Review**. The first
button in the header opens and closes it, and the frame keeps your choice in
this browser. At 720px and below the sidebar starts closed and opens over
the page, and choosing a page closes it. Its **Last round** tab shows the
round before this one. A round you open from the Rounds button, the clock in
the header, takes that tab as **Round N**.

## The sidebar

The sidebar lists the round's pages, then **Review**. The first button in
the header opens and closes it, and the frame keeps your choice in this
browser. At 720px and below the sidebar starts closed and opens over the
page, and choosing a page closes it. Its **Last round** tab shows the round
before this one. A round you open from the Rounds button, the clock in the
header, takes that tab as **Round N**.

## What you can do on a page

| To                        | Do this                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Choose between options    | Press an option. **Recommended** is only a suggestion until you choose.                                               |
| Answer a question         | Type in its box, or draw when it asks for a drawing.                                                                  |
| Comment on words          | Select them and press **Comment** just above the selection.                                                           |
| Comment on a block        | Click the block and press its **Comment** button, or <kbd>c</kbd>. <kbd>j</kbd> and <kbd>k</kbd> move between blocks. |
| Comment on the page       | Press **Comment on this page** beside its title.                                                                      |
| Get an answer now         | Send the comment as a [thread](threads.md).                                                                           |
| Start or decline work     | Use a proposal's buttons, on the page or on [Work](proposals-and-work.md).                                            |
| Review what you will send | Press <kbd>r</kbd>.                                                                                                   |

## Agreed

Agreed is the first page of every round. It holds the **task**, what the
session is working towards, and under **Alignments**, every decision you
have settled so far, each with a link to where you settled it. Comment on
anything there that is wrong.

| Tag               | Meaning                             |
| ----------------- | ----------------------------------- |
| New, Updated      | Changed in this round.              |
| Revisiting        | Your feedback reopened it.          |
| No longer applies | Folded at the end, with the reason. |

## What lets the agent change your project

The agent changes your project only on your instruction: when you start one
of its [proposals](proposals-and-work.md), or when you tell it in your own
words to make a specific change, in a comment, a thread, the feedback or the
chat. A question, a suggestion or agreeing with a page is not an
instruction, and when the agent cannot tell, it records a proposal instead.
Until then, it tries changes only in a git worktree inside the session's
directory, so your checkout and branches stay as they are.

## Sessions and notifications

The Sessions button, second in the header, or <kbd>g</kbd>, opens the session
list: every live session in the order it started, with each
[sub-session](proposals-and-work.md#sub-sessions-and-new-agent-sessions)
under the session it came from, after an arrow, ↳, in place of a number.
Each row has **Copy handoff line** and ✕, which closes the session.

- The button's number counts the other sessions that need you. It is orange
  when one has a round waiting for you or an agent that could not be woken,
  and blue when the others that need you have pages you have not opened.
  When no other session needs you, a grey number counts your other live
  sessions. The session in this tab never counts.
- <kbd>1</kbd>–<kbd>9</kbd> open a session by its number. Only sessions that are not
  sub-sessions have one. <kbd>w</kbd> opens the next session waiting for you,
  sub-sessions included.
- ✕ opens a dialog that asks before it closes the session. A closed session
  is read-only with every round kept, its agent gets no message, and the hub
  removes each git worktree inside the session's directory that has no
  uncommitted changes.
- **New** marks each page of a round that you have not opened.
- A session is listed from the moment it starts. Until the agent publishes
  its first Agreed, the session's page shows its title, its agent and the
  progress card.

The bell, or <kbd>n</kbd>, lists agent replies from every session, and each
other session that starts or has a round waiting for you. A line leaves when you click it or its ✕, a waiting round's line leaves
once you send that round, a reply in a thread clears that thread's lines,
and a thumbs up on an agent's reply clears that reply's line.
**Clear all** empties the list. The bell's orange number is the number of
lines. With notifications on in Settings, you also get a system notification
for each new line and when an agent cannot be woken, unless its session is
open in the tab you are using.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/bell-dark.png">
  <img alt="The bell's list with another session's start and waiting round and an agent's reply, and the session button in orange because that session waits for you" src="../assets/bell-light.png">
</picture>

## Closing a session

A session ends when you close it, after you have told the agent anything
left to do. ✕ on its row in the session list opens a dialog that asks
first. A closed session is read-only with every round kept, and its agent
gets no message. The hub removes each git worktree inside the session's
directory, where the agent tried changes, and keeps their branches. A
worktree with uncommitted changes stays, and the dialog lists each one with
its path before you close. Your checkout and branches stay as they are. A closed session that still has
open sub-sessions stays in the list as a grey heading over them, and leaves
with the last one.

## Feedback

- Everything you do is a draft in your browser until you send it.
- **Everything else looks good**, on by default, agrees with whatever the
  pages recommended that no comment of yours challenges. It never answers a
  choice for you.
