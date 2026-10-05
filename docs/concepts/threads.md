# Threads

Start a **thread** when you want the agent to answer a comment right away,
before the next round.

Write a comment, then press **Start a thread** instead of **Add to
feedback**. The shortcut is <kbd>⌘</kbd> <kbd>Enter</kbd> on a Mac, and
<kbd>Ctrl</kbd> <kbd>Enter</kbd> elsewhere. The hub sends the comment to the
agent at once, and pair shows the agent's reply in a card under the block
you commented on. Pressing **Comment** on a
[proposal](proposals-and-work.md) starts a thread on it, which pair shows
under the proposal's card.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/note-dialog-dark.png">
  <img alt="The note dialog quoting a selected line of code, with Add to feedback and Start a thread" src="../assets/note-dialog-light.png">
</picture>

The first line of a thread's card shows what the thread is about. For a
comment on a block, it shows the block's name. For words you selected, it
shows the table row, line of code, option or checklist item that contains
them, and the card shows the words in quotes. When a block has four or more
threads, pair collapses all but the two newest. When you expand or collapse
a card yourself, pair keeps it that way.

- The agent can reply with text, code, diffs, diagrams, charts, formulas or
  a prototype from this round. When an answer is too long for a thread, or
  you need to decide something, the agent puts it on a page in the next
  round.
- The round's pages stay as they are when you start a thread. When you
  settle a decision in a thread, the agent adds it to Agreed in the next
  round, with a link to the thread.
- When you ask in a thread for a change to the work the agent is doing, the
  agent makes the change. When you ask for other work, the agent records a
  proposal and starts it, quoting you, as [When you ask in your own
  words](proposals-and-work.md#when-you-ask-in-your-own-words) describes.
- To agree with a reply without writing anything, press the thumbs up beside
  the agent's name. The agent then treats what that reply suggested as
  settled, as if you had settled it in words, and does not answer it. The
  hub sends no wake for a thumbs up, so the agent sees it the next time it
  runs `pair read` or reads the thread. pair removes the reply's line from
  the bell. Press the thumbs up again to take it back.

## When the agent reads a thread

How soon the agent reads a thread depends on its agent CLI.

| Agent CLI                                                                         | The agent reads a thread                                                         |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Claude Code, pi, opencode                                                         | Between the steps of its turn, after the tool call it is running                 |
| Codex whose app-server daemon runs the thread, as a plain `codex` from 0.160 does | Between the steps of its turn                                                    |
| Copilot CLI                                                                       | At once. Copilot moves a running shell command to the background                 |
| Any other Codex                                                                   | When its turn ends, so while it writes a round, after it publishes the last page |

A reply can take a minute while the agent finishes a long step. The tooltip
on the ⓘ beside "Sent to the agent", and on **Message the agent** on the
progress card, shows which of these applies.

The line under your message shows where the thread stands.

| Line                      | Meaning                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sent to the agent         | The hub woke the agent to read the thread.                                                                                                                           |
| Read · replying           | The agent read the thread and is writing its reply.                                                                                                                  |
| Could not reach the agent | The hub could not wake the agent. The card shows the session's handoff line, which you can give to another agent to [take the session over](holders-and-handoff.md). |
