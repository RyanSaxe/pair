# Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/architecture-dark.svg">
  <img alt="What runs where: your agent CLI, the pair hub on your machine, and your browser" src="../assets/architecture-light.svg">
</picture>

Your agent runs `pair` commands in its own shell. They go to the **hub**, one
process on your machine that serves every live session to your browser and
wakes the agent when you respond.

## The hub

- `pair start` starts the hub when none is running.
- A session is live from `pair start` until you close it or its agent
  pauses it. The hub exits after `PAIR_HUB_IDLE_SECONDS` with no live
  session, and the next `pair start` starts a new one on the same port.
- A new hub loads every session from disk, so each keeps its URL.
- Every tab reads the session list every 5 seconds, with each session's
  latest events for the bell.
- The hub keeps the time of the last session-list request from this
  machine. When a new session's first Agreed publishes, the `next` line of
  `pair publish` tells the agent to open the URL only when no request came
  in the last 90 seconds, and otherwise to give the link in chat.
- When `pair start` finds a hub running other code, it uses it and logs the
  mismatch. The hub is replaced the next time no session is live.
- The root URL, `http://127.0.0.1:4747/` by default, opens the session
  waiting longest for your review, or else the one you last opened.
  Bookmark it.

## Waking

`pair start` records how to wake the agent that ran it. When it finds no
way, it refuses and prints what to do.

| Agent CLI   | Recorded                                                               | Wake                                                                                                              |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Claude Code | `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`       | A message over the inbox socket.                                                                                  |
| Codex       | `CODEX_THREAD_ID`, and the socket of Codex's app-server daemon         | `turn/steer` over the daemon's socket into the turn in progress, or else `codex queue --thread ID --message TEXT` |
| Copilot CLI | `COPILOT_AGENT_SESSION_ID` and the port Copilot listens on             | The SDK inside Copilot CLI sends the message with mode `immediate`, or with `enqueue` when Copilot refuses that.  |
| pi          | `PAIR_PI_SOCKET` and `PAIR_PI_SESSION`, from pair's extension          | A JSON line over the extension's socket. The extension gives pi the message as a steering message.                |
| opencode    | `PAIR_OPENCODE_SOCKET` and `PAIR_OPENCODE_SESSION`, from pair's plugin | A JSON line over the plugin's socket. The plugin sends the message with `promptAsync` at once.                    |

A plain `codex` from version 0.160 runs its threads on a shared app-server
daemon, which listens on `app-server-control/app-server-control.sock` under
`CODEX_HOME`, or under `~/.codex`. When a turn of the thread is in progress,
the hub connects to that socket and sends the line with `turn/steer`, and
Codex reads it between the steps of the turn. In every other case the hub
runs `codex queue`. When Codex is idle, it starts a turn with the line at
once. When the daemon does not run the thread, as with a Codex older than
0.160, Codex reads the line when its turn ends.

Copilot CLI listens only when started with `--ui-server`. Without it,
`pair start` refuses and prints `copilot --ui-server --resume <session id>`.

Codex asks you to approve each command its sandbox blocks, every `pair`
command included, unless an allow rule names it. `pair start` refuses under
Codex until `~/.codex/rules/pair.rules` exists, and `pair setup-codex` writes
it.

pi and opencode take a message from the hub only through pair's extension
and plugin, which you register once. When pi runs without the extension, or
opencode without the plugin, `pair start` refuses and prints the
`pi install` command, or the plugin's path and the opencode config file to
add it to. `wake.last.ok` is `true` once pi or the plugin has taken
the message, which is before the agent reads it. When pi or opencode
has exited, the wake fails with `the agent CLI has exited (ENOENT …)` after a
clean exit, or `(ECONNREFUSED …)` after the CLI was killed.

Every agent CLI that pair wakes reads the message in the middle of a turn
in progress, apart from an older Codex and a Copilot CLI that refuses
`immediate`, which read it when the turn ends.
[Adapters](../contributing/adapters.md#when-the-cli-reads-the-line) has a
table of when each one reads it.

`pair status` shows the holder and the last wake for a submission. The
result of each wake has `via`, the path the message took, such as `steer` or
`queue` for Codex. Each wake sets `holder.steerable` in `status.json`, which
is `true` when the agent CLI reads a message in the middle of a turn.
When a wake fails, the progress card says "Could not wake the agent. Send a
message in chat." and shows the [handoff line](holders-and-handoff.md).

A [thread](threads.md) wakes the holder too, once for each message, naming
the `pair read --thread` command that prints it. It does so even while the
session is paused, because you are waiting for the answer. Starting a
[proposal](proposals-and-work.md) here or in a sub-session wakes the holder
with your message, unless the session is paused. Declining a proposal and
closing a linked session wake no one, and the holder's next `pair read`
prints them.

## Storage

Everything lives under `$XDG_STATE_HOME/pair/`, or `~/.local/state/pair/`.

```text
hub/
  hub.json           pid, port, hosts, code version, registration secret
  hub.log
sessions/<dir>/      the directory name is not the session ID
  status.json        title, stage, holder, wake, open round, linked parent; pair status prints it
  connection.json    session ID, hub origin, agent token, wake target
  pages/<round>/     published page records
  src/<round>/<id>/  each page's source
  rounds/            built rounds
  feedback/          your submissions
  uploads/           images on your comments: PNG, JPEG, GIF or WebP, up to 10 MB
  scenes/            editable shapes of drawing answers
  threads/           one file per thread
  proposals/         one file per proposal
  plans/<id>/        a proposal's plan: plan.html, pages.json and each page's source
  activity.json      the last 50 events, for the bell
  output/            command output too long to print
```

The agent's scratch git worktrees are inside the session's directory too.
The hub deletes nothing when a session closes. The agent removes the
worktrees it made only after the reviewer starts its proposal to remove them
or answers yes to its question on a page.

Sessions from interactive-plan, `pair`'s predecessor, stay under
`~/.local/state/interactive-plan/`. Start a new session instead of resuming
one.
