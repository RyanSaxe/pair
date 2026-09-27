# How it works

## Waking

`pair start` records how the hub wakes the agent, from the environment the
agent CLI gives its shell commands. When it finds no wake path, it refuses,
creates nothing, and prints the instruction to give the reviewer.

| Agent CLI   | `pair start` records                                                                                                                     | The hub's wake call                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code | The inbox socket and token from `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`.                                        | Two JSON lines over the socket: the auth line, then a user message.               |
| Codex       | The thread ID from `CODEX_THREAD_ID`.                                                                                                    | `codex queue --thread ID --message TEXT`                                          |
| Copilot CLI | The session ID from `COPILOT_AGENT_SESSION_ID`, and the port the Copilot process listens on, found among the `pair` process's ancestors. | The SDK shipped inside the CLI resumes the session and sends with mode `enqueue`. |

The agent whose wake target `pair start` records is the session's holder,
and the hub identifies it by the same value: the inbox socket, the thread ID
or the session ID. Every command sends the identity of the agent that runs
it, and the hub refuses every command but `pair status` from any agent but
the holder. `pair status` also runs from a plain terminal, where it sends no
identity, while the hub that serves the session runs. When that hub has
exited, `pair status` starts a new hub and registers the session with it,
which needs an agent's identity, so it fails from a plain terminal.

Copilot CLI listens for the hub only when it is started with `--ui-server`,
so for Copilot CLI, `pair start` refuses with
`copilot --ui-server --resume <session id>`. Its embedded server accepts any
local client when `COPILOT_CONNECTION_TOKEN` is unset.

## Feedback that did not wake the agent

After a submission, `pair status` reports the last wake under `wake.last`,
with `ok` and, when it failed, the `reason`. When the wake failed, the
progress card at the top of Agreed says "Could not wake the agent. Send a
message in chat." and shows the handoff line, which another agent runs to
take the session over.

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

## The hub's address

`http://127.0.0.1:4747/` opens the session that needs you. When none does,
it opens the last session you viewed in that browser, and otherwise the
first live session. Bookmark it to reach whichever session is waiting.

## Settings

pair reads three environment variables, all optional:

| Variable                | Default | Meaning                                                                                   |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747    | The hub's fixed port on 127.0.0.1. With `0`, the OS assigns a free port, as the tests do. |
| `PAIR_HUB_HOST`         | unset   | An extra address to bind, such as a Tailscale IP, to review on a phone.                   |
| `PAIR_HUB_IDLE_SECONDS` | 900     | Time with no live session after which the hub exits.                                      |

Browser routes are unauthenticated, which is why the extra address is opt
in. Agent routes require the session's bearer token on every address.

## Files on disk

pair stores everything under `$XDG_STATE_HOME/pair/`, or
`~/.local/state/pair/`:

- `hub/hub.json` contains the pid, port, hosts, code version and the local
  secret that registers sessions. `hub/hub.log` is the hub's log.
- `sessions/<dir>/status.json` contains the stage (`ready`, `updated`,
  `submitted`, `working`, `saved` or `complete`), `openRound` while a
  round's pages are arriving, `paused`, `wake`, `holder`, the agent that
  runs the session and when it registered, and `formerHolders`, the agents
  it was taken from that have not run a command other than `pair status`
  since. `pair status` prints this file without `formerHolders` or any
  agent's socket or thread, and adds `handoff`, the line another agent runs
  to take the session over.
- `sessions/<dir>/connection.json` contains the session ID, the hub's
  origin, the agent token and the wake target. The directory name is not
  the session ID.
- The same directory contains `feedback/`, `uploads/` with the reviewer's
  images, `pages/<round>/` with the published page records,
  `src/<round>/<page-id>/` with each page's source, `rounds/` with the
  built rounds, and `acceptance.json` after acceptance.

## Images in a note

A note can have images attached. The hub accepts PNG, JPEG, GIF and WebP,
identified by the file's first bytes rather than its name, up to 10 MB each,
and sets no limit on how many a session keeps.

## pair check

`pair check` also reports `components`: the directory `pair build` reads for
your own components, `$XDG_CONFIG_HOME/pair/components` with `~/.config` as
the fallback, how many components it contains and their names, and how many
pair ships. An optional path argument checks storage under that directory
instead of the state directory.
