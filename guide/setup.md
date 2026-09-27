# Check the environment

pair requires Node 20 or newer and has no dependencies. `pair start` checks what
a session needs and refuses with the reason: Node too old, the hub port taken by
another program, storage it cannot write, or a sandbox that blocks the hub. If
Node is unavailable or too old, explain the requirement and ask how the user
wants to provide it.

When `pair start` or another command fails, run `pair check`. It checks each
part on its own: that session storage is writable, that a local HTTP endpoint
works and which process owns the hub port. It reports the port as `free`, `hub`
(with the running hub's code version and live session count) or `busy` (another
program owns it). An optional path argument checks a different storage location.
If you pass one, use that location for the session too.

It also reports `components`: the path the builder reads for the user's own
components, `$XDG_CONFIG_HOME/pair/components` with `~/.config`
as the fallback, whether that directory exists, and what it and pair
hold. The builder skips it when it does not exist. The
[component index](components.md) states when to write there.

The hub needs a writable state directory and a listener on loopback. If the
sandbox blocks either operation, allow the `pair` command. Do not switch to
a different state directory. A session under a temp directory is invisible
to other sessions and to the hub on the fixed port.

- Codex: the sandbox blocks both operations. The first failed `pair`
  command identifies the sandbox, then the command runs again with approval. The
  approval reviewer may grant that retry without a prompt. Run
  `pair check --codex-rules` once outside the sandbox. It writes
  `~/.codex/rules/pair.rules`, a file of pair's own with an allow
  rule for `pair`. A command that matches it runs outside the sandbox on the
  first try with nothing to approve. Codex reads the file when it starts, so
  the current session still fails once on each `pair` command until Codex
  restarts. The check reports whether the file is present.
- Claude Code: nothing in auto mode. Otherwise allow the `pair` command in
  the permission settings.
- Copilot: nothing beyond the allow flags the session already needs.

Environment variables, all optional:

| Variable                | Default | Meaning                                                                 |
| ----------------------- | ------- | ----------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747    | The hub's fixed port on 127.0.0.1. `0` asks the OS for a port (tests).  |
| `PAIR_HUB_HOST`         | unset   | An extra address to bind, such as a Tailscale IP, to review on a phone. |
| `PAIR_HUB_IDLE_SECONDS` | 900     | Time with no live session after which the hub exits.                    |

Browser routes are unauthenticated, which is why the extra bind is opt in.
Agent routes require the per-session bearer token on every interface.

## When something fails

### Waking

`pair start` records how the hub wakes this agent, from the environment the
harness gives its shell commands. When it finds no wake path, it refuses,
creates nothing, and prints the instruction to give the user.

| Harness     | `pair start` records                                                                                                                     | The hub's wake call                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code | The inbox socket and token from `CLAUDE_CODE_MESSAGING_SOCKET` and `CLAUDE_CODE_MESSAGING_TOKEN`.                                        | Two JSON lines over the socket: the auth line, then a user message.               |
| Codex       | The thread ID from `CODEX_THREAD_ID`.                                                                                                    | `codex queue --thread ID --message TEXT`                                          |
| Copilot     | The session ID from `COPILOT_AGENT_SESSION_ID` and the port the Copilot process listens on, found by walking up from the `pair` process. | The SDK shipped inside the CLI resumes the session and sends with mode `enqueue`. |

Copilot listens only when started with `--ui-server`, so its refusal names
`copilot --ui-server --resume <session id>`. Its embedded server accepts any
local client when `COPILOT_CONNECTION_TOKEN` is unset. After a submission,
`pair status` reports the last wake under `wake.last`, with `ok` and, when it
failed, the `reason`. The browser then asks the reader to send a message in
chat.

### The hub

One hub process serves every live session. `pair start` spawns it when none is
running. A session is live from `pair start` until `pair complete`, `pair pause`
or closure from the browser. With no live session for `PAIR_HUB_IDLE_SECONDS`,
the hub exits and the next `pair start` creates a new one on the same port. When
`pair start` finds a hub running other code, it uses that hub and logs the
mismatch, and the hub restarts on the newer code once no session is live. A
running hub keeps the addresses it started with, so `PAIR_HUB_HOST` takes effect
only on a new hub.

### Storage

Everything lives under `$XDG_STATE_HOME/pair/`, or
`~/.local/state/pair/`:

- `hub/hub.json` holds the pid, port, hosts, code version and the local
  secret that registers sessions. `hub/hub.log` is the hub's log.
- `sessions/<dir>/status.json` holds the stage (`ready`, `updated`,
  `submitted`, `working` or `complete`), `openRound` while a round's pages
  are arriving, `paused` and `wake`. `pair status` prints it.
- `sessions/<dir>/connection.json` holds the session ID, the hub's origin,
  the agent token and the wake target. The directory name is not the
  session ID.
- The same directory holds `feedback/`, `uploads/` with the reviewer's
  images, `pages/<round>/` with the published page records,
  `src/<round>/<page-id>/` with each page's source, `rounds/` with the
  built rounds, and `acceptance.json` after acceptance.
- `guide/<hash>/` holds the copy of this guide that `next` lines name, with
  every link an absolute path. Each version of the guide gets its own copy in
  each installation.
