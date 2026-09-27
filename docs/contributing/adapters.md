# Adapters

pair wakes Claude Code, Codex and Copilot CLI, each through its folder under
`adapters/`. A `wake.mjs` exports the CLI's `name`, such as `Codex`, the
`command` its executable is called, the `variables` it gives the commands it
runs, the `unwakeable` message for a session without all of them, and three
functions:

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
