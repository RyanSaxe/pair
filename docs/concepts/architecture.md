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
- A session is live from `pair start` until it completes, pauses or is saved
  for later. The hub exits after `PAIR_HUB_IDLE_SECONDS` with no live
  session, and the next `pair start` starts a new one on the same port.
- A new hub loads every session from disk, so each keeps its URL.
- Every tab reads the session list every 5 seconds, with each session's
  latest events for the notification center.
- When `pair start` finds a hub running other code, it uses it and logs the
  mismatch. The hub is replaced the next time no session is live.
- The root URL, `http://127.0.0.1:4747/` by default, opens the session
  waiting longest for your review, or else the one you last opened.
  Bookmark it.

## Waking

`pair start` records how to wake the agent that ran it. When it finds no
way, it refuses and prints what to do.

| Agent CLI   | Recorded                                                               | Wake                                                                                                            |
| ----------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Claude Code | `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`       | A message over the inbox socket.                                                                                |
| Codex       | `CODEX_THREAD_ID`                                                      | `codex queue --thread ID --message TEXT`                                                                        |
| Copilot CLI | `COPILOT_AGENT_SESSION_ID` and the port Copilot listens on             | The SDK inside Copilot CLI sends the message as `enqueue`.                                                      |
| pi          | `PAIR_PI_SOCKET` and `PAIR_PI_SESSION`, from pair's extension          | A JSON line over the extension's socket. pi queues the message as a follow-up.                                  |
| opencode    | `PAIR_OPENCODE_SOCKET` and `PAIR_OPENCODE_SESSION`, from pair's plugin | A JSON line over the plugin's socket. The plugin sends the message with `promptAsync` once the session is idle. |

Copilot CLI listens only when started with `--ui-server`. Without it,
`pair start` refuses and prints `copilot --ui-server --resume <session id>`.

pi and opencode take a message from the hub only through pair's extension
and plugin, which you register once. When pi runs without the extension, or
opencode without the plugin, `pair start` refuses and prints the
`pi install` command, or the plugin's path and the opencode config file to
add it to. `wake.last.ok` is `true` once pi or the plugin has taken
the message, which can be before the agent's turn starts. When pi or opencode
has exited, the wake fails with `the agent CLI has exited (ENOENT …)` after a
clean exit, or `(ECONNREFUSED …)` after the CLI was killed.

`pair status` shows the last wake under `wake.last`. When a wake fails, the
progress card says "Could not wake the agent. Send a message in chat." and
shows the [handoff line](holders-and-handoff.md).

A [thread](threads-and-side-work.md) wakes the holder too, once for each
message, naming the `pair reply` command that prints it. It does so even
while the session is paused, because you are waiting for the answer.

## Storage

Everything lives under `$XDG_STATE_HOME/pair/`, or `~/.local/state/pair/`.

```text
hub/
  hub.json           pid, port, hosts, code version, registration secret
  hub.log
sessions/<dir>/      the directory name is not the session ID
  status.json        stage, holder, wake, open round; pair status prints it
  connection.json    session ID, hub origin, agent token, wake target
  pages/<round>/     published page records
  src/<round>/<id>/  each page's source
  rounds/            built rounds
  feedback/          your submissions
  uploads/           images on your comments: PNG, JPEG, GIF or WebP, up to 10 MB
  scenes/            editable shapes of drawing answers
  threads/           one file per thread
  side-work/         one file per side-work item
  activity.json      the last 50 events, for the notification center
  acceptance.json    after you accept
```

Sessions from interactive-plan, `pair`'s predecessor, stay under
`~/.local/state/interactive-plan/`. Start a new session instead of resuming
one.
