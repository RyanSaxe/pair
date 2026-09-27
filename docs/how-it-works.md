# How it works

## Waking

`pair start` records how the hub wakes the agent that ran it, from the
environment the agent CLI gives its shell commands. When it finds no wake
path, it refuses, creates nothing, and prints an instruction for you.

| Agent CLI   | `pair start` records                                                                                                                     | The hub's wake call                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code | The inbox socket and token from `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`.                                        | Two JSON lines over the socket: the auth line, then a user message.               |
| Codex       | The thread ID from `CODEX_THREAD_ID`.                                                                                                    | `codex queue --thread ID --message TEXT`                                          |
| Copilot CLI | The session ID from `COPILOT_AGENT_SESSION_ID`, and the port the Copilot process listens on, found among the `pair` process's ancestors. | The SDK shipped inside the CLI resumes the session and sends with mode `enqueue`. |

Copilot CLI listens for the hub only when it is started with `--ui-server`,
so for Copilot CLI, `pair start` refuses with
`copilot --ui-server --resume <session id>`. Its embedded server accepts any
local client when `COPILOT_CONNECTION_TOKEN` is unset.

After a submission, `pair status` reports the last wake under `wake.last`,
with `ok` and, when it failed, the `reason`. When the wake failed, the
progress card at the top of Agreed says "Could not wake the agent. Send a
message in chat." and shows the handoff line, which another agent runs to
take the session over.

A thread wakes the holder too, once for each message you send in it, with a
line that names the thread and the `pair reply` command that prints it. The
hub sends it while the session is paused as well, because you are waiting
for the answer. When that wake fails, the thread's card says "Could not
reach the agent" and shows the handoff line.

## Holders and handoff

A session's holder is the agent that last ran `pair start` on it. The hub
identifies the holder by part of its wake target: the inbox socket, the
thread ID or the session ID. Every command sends the identity of the agent
that runs it, so a subagent works as its parent. The hub wakes only the
holder and refuses every command but `pair status` and `pair side-work`
from any other agent, because an agent the holder briefs can do side work.
After a takeover, the former holder's first command other than those two,
`pair start` included, fails with the time it lost the session.

`pair status` and `pair side-work` also run from a plain terminal, or from
an agent the hub cannot wake, where they send no identity, while the hub
that serves the session runs. When that hub has exited, they start a new hub
and register the session with it, which needs an agent's identity, so they
fail from a plain terminal.

Another agent takes a session over with its handoff line, which the browser
shows with Copy after Save for later and after a failed wake:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

## Side work

The agent records work that turns up outside the session's task with
`pair side-work add`, and the frame lists it on Agreed after the decisions.
When you press Start in parallel on an item, the hub wakes the holder once
with a message that asks for the work in a separate git worktree, on its own
branch from the session's branch, ending in a pull request into that branch.
The guide tells the agent to use the repository's default branch when the
session has no branch of its own there. The agent reports Working, Pull
request with its link, and Done with `pair side-work update`, and the frame
shows each change within 1.5 seconds. The hub accepts an update to the item's
next state, or to its current state to correct the link, so an item is Done
only after it has a pull request. When the wake fails, the item returns to
Recorded and reads "Could not reach the agent to start this. Try again." You
can drop an item at any state before Done, and the frame folds Done and
dropped items under Finished.

## The hub

One hub process serves every live session. `pair start` spawns it when none
is running. A session is live from `pair start` until `pair complete`,
`pair pause`, Save for later or closure from the browser. With no live
session for `PAIR_HUB_IDLE_SECONDS`, the hub exits, and the next
`pair start` starts a new one on the same port. A new hub loads every
session from disk, so a saved session stays in Live sessions at the same
URL. When `pair start` finds a hub running other code, it uses that hub and
logs the mismatch, and the next `pair start` that finds no live session
replaces it with a hub on its own code. A running hub keeps the addresses
it started with, so `PAIR_HUB_HOST` takes effect only on a new hub.

The hub redirects its root URL, `http://127.0.0.1:4747/` by default, to the
session that is waiting for your review, the one whose round was published
first when several are waiting. When none is waiting, it redirects to the
session you last opened in that browser, and otherwise to the session
updated most recently. Bookmark the root URL to reach whichever session is
waiting.

## Storage

pair stores everything under `$XDG_STATE_HOME/pair/`, or
`~/.local/state/pair/`:

- `hub/hub.json` contains the pid, port, hosts, code version and the local
  secret that registers sessions. `hub/hub.log` is the hub's log.
- `sessions/<dir>/status.json` contains the stage (`ready`, `updated`,
  `submitted`, `working`, `saved` or `complete`), `openRound` while a
  round's pages are arriving, `paused`, `wake`, `holder`, the session's
  holder and when it registered, and `formerHolders`, the agents it was
  taken from that have not run a command other than `pair status` or
  `pair side-work` since. `pair status` prints this file without
  `formerHolders` or any agent's socket or thread, and adds `handoff`, the
  line another agent runs to take the session over, and `sideWork`, the
  session's side-work items.
- `sessions/<dir>/connection.json` contains the session ID, the hub's
  origin, the agent token and the wake target. The directory name is not
  the session ID.
- The same directory contains `feedback/`, `uploads/` with the reviewer's
  images, `pages/<round>/` with the published page records,
  `src/<round>/<page-id>/` with each page's source, `rounds/` with the
  built rounds, `threads/` with one file per thread, `side-work/` with one
  file for each side-work item, and `acceptance.json` after acceptance.

The hub accepts an image attached to a note in PNG, JPEG, GIF or WebP, which
it identifies by the file's first bytes rather than its name or
`Content-Type`, and refuses one over 10 MB. A session can have any number of
uploads.

Sessions that interactive-plan, pair's predecessor, created stay under
`~/.local/state/interactive-plan/`, and `pair start` refuses to resume one
that published a round, so start a new session instead.
