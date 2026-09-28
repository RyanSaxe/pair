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
  its error output.

`src/hub/wake.mjs` lists the adapters and chooses one for `pair start`. It
compares each ancestor process of the `pair` command, nearest first, with
every adapter's `command`, so the agent CLI that ran the command is chosen
over an outer one whose variables it inherited. When no ancestor runs an
adapter's `command`, it chooses the first adapter whose first variable is
set. It then calls that adapter's `detect`, or refuses with the adapter's
`unwakeable` message when one of its `variables` is unset.

## A listener inside the CLI

Claude Code, Codex and Copilot CLI each accept a message from another
process, through the inbox socket, `codex queue` and the SDK. pi and opencode
accept none, so their adapters include code that runs inside the CLI: the pi
extension `adapters/pi/extension.js` and the opencode plugin
`adapters/opencode/plugin.js`. The user registers the file once. When it is
missing, `pair start` refuses with the `unwakeable` message, which contains
the file's absolute path and the command or config file that registers it.
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
