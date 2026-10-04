# Threads

A **thread** gets you an answer now, without waiting for the next round.

Write a comment, then press **Start a thread** (<kbd>⌘</kbd>
<kbd>Enter</kbd>, or <kbd>Ctrl</kbd> <kbd>Enter</kbd> off a Mac) instead of
**Add to feedback**. The comment goes to the agent at once, and its reply
appears in a card under the block you commented on. **Comment** on a
[proposal](proposals-and-work.md) starts a thread on that proposal, which
shows under its card.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/note-dialog-dark.png">
  <img alt="The note dialog quoting a selected line of code, with Add to feedback and Start a thread" src="../assets/note-dialog-light.png">
</picture>

The first line of a card shows what the thread is on. For a comment on a
block, it shows the block's name. For words you selected, it shows the table
row, line of code, option or checklist item that contains them, and the card
quotes the words. When a block has four or more threads, the frame collapses
all but the two newest, and a card you expand or collapse stays that way.

- A reply can hold text, code, diffs and diagrams. Anything bigger, or
  anything you need to decide, comes as a page in the next round.
- A thread does not change the round's pages, but it can settle a decision,
  and the alignment on Agreed then credits the thread.
- When you ask in a thread for a specific change to the work the agent is
  doing, the agent makes it, as an instruction in your own words.
- Press the thumbs up beside a reply's name to agree with the reply without
  writing a message. The agent treats what the reply proposed as settled, as
  it does a decision you settle in words, and does not answer it. The hub
  sends the agent no wake for it, and the agent reads it the next time it
  runs `pair read` or reads the thread. The reply's line leaves the bell, and
  pressing the thumbs up again takes it back.

When the agent reads a thread depends on its agent CLI:

| Agent CLI                                                                         | Reads a thread                                                              |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Claude Code, pi, opencode                                                         | Between the steps of its turn, after the tool call it is running            |
| Codex whose app-server daemon runs the thread, as a plain `codex` from 0.160 does | Between the steps of its turn                                               |
| Copilot CLI                                                                       | At once. It moves a running shell command to the background                 |
| Any other Codex                                                                   | When its turn ends, so while it writes a round, after the round's last page |

A reply can take a minute while the agent finishes a long step. The tooltip
on the ⓘ beside "Sent to the agent", and on the progress card's **Message the
agent**, shows which row applies.

The line under your message says where the thread is:

| Line                      | Meaning                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| Sent to the agent         | The agent has been woken to read it.                               |
| Read · replying           | The agent is writing its reply.                                    |
| Could not reach the agent | Another agent can [take the session over](holders-and-handoff.md). |
