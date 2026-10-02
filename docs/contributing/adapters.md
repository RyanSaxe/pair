# Adapters

pair wakes Claude Code, Codex, Copilot CLI, pi and opencode, each through
its folder under `adapters/`. A `wake.mjs` exports the CLI's `name`, such as
`Codex`, the `command` its executable is called, the `variables` it gives the
commands it runs, the `unwakeable` message for a session without all of them,
and three functions:

- `detect(env, tools)` returns the wake target for its agent CLI. It is
  called only for the adapter that `src/hub/wake.mjs` chose, once every one
  of the adapter's `variables` is set. `tools.ancestor` is the ancestor
  process that runs the adapter's `command`, or `null` when the adapter was
  chosen by its variables alone. It throws when the session still cannot be
  woken.
- `identity(target)` returns the part of a wake target that distinguishes one
  session of the CLI from another: the inbox socket, the thread ID or the
  session ID.
- `wake(target, line, run)` delivers one line to the running session, or
  throws with the reason. `run(file, args)` runs a program and rejects with
  its error output. `wake` resolves to `{ via, steerable }`, where `via` is
  the path the line took and `steerable` is `true` when the CLI reads a
  message in the middle of a turn. The hub records `via` in the wake's
  result and `steerable` as `holder.steerable` in `status.json`. The frame
  reads `holder.steerable` to choose the tooltip on "Sent to the agent" and
  on Message the agent.

`src/hub/wake.mjs` lists the adapters and chooses one for `pair start`. It
compares each ancestor process of the `pair` command, nearest first, with
every adapter's `command`, so the agent CLI that ran the command is chosen
over an outer one whose variables it inherited. When no ancestor runs an
adapter's `command`, it chooses the first adapter whose first variable is
set. It then calls that adapter's `detect`, or refuses with the adapter's
`unwakeable` message when one of its `variables` is unset.

## When the CLI reads the line

Where the agent CLI allows it, the adapter adds the line to the turn in
progress, so the agent reads it in the middle of the turn instead of after
it.

| Agent CLI   | `via`       | API                                                                      | While a turn runs, the agent reads the line                      |
| ----------- | ----------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Claude Code | `inbox`     | A user message over the inbox socket                                     | Between the steps of the turn                                    |
| Codex       | `steer`     | `turn/steer` on Codex's app-server daemon                                | Between the steps of the turn                                    |
| Codex       | `queue`     | `codex queue --thread ID --message TEXT`                                 | When the turn ends                                               |
| Copilot CLI | `immediate` | `session.send` with mode `immediate`, through the SDK inside Copilot CLI | At once. Copilot moves a running shell command to the background |
| Copilot CLI | `enqueue`   | `session.send` with mode `enqueue`                                       | When the turn ends                                               |
| pi          | `steer`     | `sendUserMessage` with `deliverAs: "steer"`, in pair's extension         | After the tool calls of the current model response               |
| opencode    | `prompt`    | `client.session.promptAsync`, in pair's plugin                           | After the tool calls of the current model response               |

Codex's adapter uses `turn/steer` only while a turn of the thread is in
progress on the daemon, and runs `codex queue` in every other case, and
after any error on the daemon's socket. Copilot's adapter sends with
`enqueue` only after Copilot refuses `immediate`. Every Copilot CLI from
1.0.70 to 1.0.91 lists `immediate` in its API schema. When the CLI is idle,
the line starts a turn on every path but `turn/steer`.

`steerable` is `false` after a wake through `enqueue`, and after a wake
through `codex queue` for a thread that the daemon does not run. It is
`true` after every other wake.

## A listener inside the CLI

Claude Code, Codex and Copilot CLI each accept a message from another
process: Claude Code through its inbox socket, Codex through `turn/steer` on
its app-server daemon or through `codex queue`, and Copilot CLI through its
SDK. pi and opencode accept none, so their adapters include code that runs
inside the CLI: the pi extension `adapters/pi/extension.js` and the opencode
plugin `adapters/opencode/plugin.js`. The user registers the file once. When
it is missing, `pair start` refuses with the `unwakeable` message, which
contains the file's absolute path and the command or config file that
registers it.
pair writes nothing into another CLI's settings.

The extension and the plugin both use `adapters/listener.mjs`:

- `listen(deliver)` runs inside the CLI. It creates a directory under the
  system's temporary directory that only the user can open, listens on the
  Unix socket `wake.sock` in it, and returns the socket's path and `close()`.
  The hub writes one JSON line on each connection. The listener calls
  `deliver` with the parsed line and answers `ok` once `deliver` returns, or
  the error's message when `deliver` throws.
- `send(socket, message)` runs in the hub, from the adapter's `wake`. It
  writes the line, waits up to 5 seconds for the answer, and rejects with
  the answer when it is not `ok`. The hub records that message as the
  wake's `reason`.

Neither side half-closes the socket before the answer, because Bun, which
runs opencode's plugins, closes a half-closed socket.

A CLI that exits cleanly closes its listener, which deletes the socket, so
`send` rejects with `the agent CLI has exited (ENOENT SOCKET)`. A CLI that is
killed leaves the socket file with nothing listening on it, and `send`
rejects with `the agent CLI has exited (ECONNREFUSED SOCKET)`.

The extension and the plugin set two variables for the commands the CLI
runs: the socket, and the ID of the CLI's session. The socket changes each
time the CLI starts, and the session ID stays the same after `pi --continue`
or `opencode --continue`, so `identity` returns the session ID.
