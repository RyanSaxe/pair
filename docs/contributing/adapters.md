# Adapters

The hub wakes Claude Code, Codex, Copilot CLI, pi and opencode, each through
the CLI's folder under `adapters/`.

## What `wake.mjs` exports

Each folder's `wake.mjs` exports these values:

| Export       | Value                                                    |
| ------------ | -------------------------------------------------------- |
| `name`       | The CLI's name, such as `Codex`.                         |
| `command`    | The command that runs its executable.                    |
| `variables`  | The variables the CLI gives the commands it runs.        |
| `unwakeable` | The message for a session that lacks any of `variables`. |

It also exports these functions:

- `detect(env, tools)` returns the wake target for the adapter's agent CLI.
  `src/hub/wake.mjs` calls it only for the adapter it chose, once every one
  of that adapter's `variables` is set. `tools.ancestor` is the ancestor
  process that runs the adapter's `command`, or `null` when
  `src/hub/wake.mjs` chose the adapter by its variables alone. `detect`
  throws when the session still cannot be woken.
- `identity(target)` returns the part of a wake target that distinguishes
  one session of the CLI from another. Claude Code's adapter returns the inbox
  socket, Codex's the thread ID, and the others the session ID.
- `wake(target, line, run)` delivers one line to the running session, or
  throws with the reason. `run(file, args)` runs a program and rejects with
  its error output. `wake` resolves to `{ via, steerable }`, where `via` is
  the name of the delivery path, and `steerable` is `true` when the CLI reads a
  message in the middle of a turn. The hub records `via` in the wake's
  result, and `steerable` as `holder.steerable` in `status.json`. The frame
  reads `holder.steerable` to choose the tooltip on "Sent to the agent" and
  on Message the agent.
- `launch({ name, prompt, args })` returns the command line, as an array,
  that starts a new session of the CLI with `prompt` as its first message,
  named `name` where the CLI takes a name. `args` are the arguments for the
  CLI that `pair spawn` takes after `--`, and `launch` puts them before the
  prompt. For a CLI whose prompt is a positional argument, `endOptions(args)`
  from `src/shared/launch.mjs` ends them with `--`. The hub and `pair spawn`
  pass the command line to the user's launch script, as
  `src/shared/launch.mjs` describes.

An adapter exports these too when its CLI needs them, for the list of
running sessions that `src/cli/agents.mjs` keeps:

| Export                        | Value                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId(target)`           | The ID that the CLI keeps when the session resumes, when `identity` is something else, as for Claude Code, whose `identity` is the inbox socket.                                                                                                                                                                                  |
| `hookVariables(input)`        | The variables that the JSON on a start hook's stdin gives, when the CLI leaves them out of the hook's environment, as Codex and Copilot CLI do.                                                                                                                                                                                   |
| `pidVariable`                 | The variable in which pair's code inside the CLI sets the CLI's process ID, for a CLI whose process has another name, such as `node`.                                                                                                                                                                                             |
| `recognizes(ancestor)`        | `true` for an ancestor process that runs the CLI under another name, as Copilot CLI's `node` with its `index.js` in nixpkgs.                                                                                                                                                                                                      |
| `parentSession(target)`       | The `{ sessionId, nickname }` of the session that started a subagent, or `null` for a session that is not a subagent.                                                                                                                                                                                                             |
| `sharesProcess(cliProcess)`   | `true` when the CLI's process serves several sessions, as Codex's daemon and opencode's process do, so a new session leaves the others listed.                                                                                                                                                                                    |
| `subagentTool(target, name)`  | The tool with which the parent's agent passes a message on to its subagent `name`, which `pair message --to NAME/SUBAGENT` names in its first line: `SendMessage`, `followup_task` with the agent path, or `write_agent`, or `null` when `wake` delivers to the subagent that `target.subagent` names, as opencode's plugin does. |
| `running(target, cliProcess)` | Whether the session runs, for a process that outlives its sessions: Codex's daemon, and opencode 2's background server, whose session runs while a window has it open. `pair agents` asks it once the process check passes.                                                                                                       |

## How the hub chooses an adapter

`src/hub/wake.mjs` lists the adapters, and `detectAgent` chooses one for
`pair start`, `pair register` and the sender of `pair message`, which
names the sender as your user when it returns `null`:

1. It compares each ancestor process of the `pair` command, nearest first,
   with every adapter's `command` and `pidVariable`, and then asks each
   adapter's `recognizes`. That way it chooses the agent CLI that ran the
   command over an outer CLI whose variables the inner one inherited.
2. When no ancestor matches, it chooses the first adapter whose first
   variable is set.
3. It then calls that adapter's `detect`, or refuses with the adapter's
   `unwakeable` message when one of its `variables` is unset.

## When the CLI reads the line

Where the agent CLI allows it, the adapter adds the line to the turn in
progress, so the agent reads it in the middle of the turn instead of after
it.

| Agent CLI   | `via`       | API                                                                                                    | While a turn runs, the agent reads the line                      |
| ----------- | ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Claude Code | `inbox`     | A user message over the inbox socket                                                                   | Between the steps of the turn                                    |
| Codex       | `steer`     | `turn/steer` on Codex's app-server daemon                                                              | Between the steps of the turn                                    |
| Codex       | `queue`     | `thread/queue/add` and `thread/queue/start` on the daemon, or `codex queue --thread ID --message TEXT` | When the turn ends                                               |
| Codex       | `parent`    | The `steer` or `queue` path to the parent thread of a spawned subagent                                 | After the parent passes the line on with `followup_task`         |
| Copilot CLI | `immediate` | `session.send` with mode `immediate`, through the SDK inside Copilot CLI                               | At once. Copilot moves a running shell command to the background |
| Copilot CLI | `enqueue`   | `session.send` with mode `enqueue`                                                                     | When the turn ends                                               |
| pi          | `steer`     | `sendUserMessage` with `deliverAs: "steer"`, in pair's extension                                       | After the tool calls of the current model response               |
| opencode    | `prompt`    | `ctx.session.prompt` in pair's plugin on opencode 2, `client.session.promptAsync` on opencode 1        | After the tool calls of the current model response               |

- Codex's adapter uses `turn/steer` only while a turn of the thread is in
  progress on the daemon. When the daemon runs the thread and no turn is in
  progress, the adapter adds the line to the thread's queue with
  `thread/queue/add`, then starts a turn with the line through
  `thread/queue/start`. Codex starts a turn with a queued line when the
  thread goes idle, except after the user interrupts a turn. Then Codex
  leaves the line in the queue until the user sends a message, and
  `thread/queue/start` starts the turn in that case too. When
  `thread/queue/start` fails and the line is still in the queue of an idle
  thread, `wake` throws. Codex refuses the `thread/queue` methods unless the
  adapter's `initialize` request declares the `experimentalApi` capability.
  In every other case, and after any error on the daemon's socket before the
  line is queued, the adapter runs `codex queue`.
- Codex refuses input from another process to a subagent that another
  thread spawned when the daemon has not loaded the subagent, as when the
  parent runs in-process. When `thread/read` gives the thread a
  `subAgent.thread_spawn` source, Codex's adapter sends the parent thread,
  by the same methods as above, a line with the subagent's agent ID and an
  instruction to pass the hub's line on to it with `followup_task`, or with
  `send_input` in Codex's older multi-agent tools. `send_message`
  would leave the line in the subagent's mailbox without starting a turn.
  A parent that runs in-process reads the line only when its own turn ends,
  so a parent that waits on its subagent passes the line on after the
  subagent finishes.
- Copilot's adapter sends with `enqueue` only after Copilot refuses
  `immediate`. Every Copilot CLI from 1.0.70 to 1.0.91 lists `immediate` in
  its API schema.

When the CLI is idle, it starts a turn with the line on every path except
`turn/steer`.

`steerable` is `false` after a wake through `enqueue`, after a wake
through `codex queue` for a thread that the daemon does not run, and after
a wake through a Codex subagent's parent. It is `true` after every other
wake.

## A listener inside the CLI

Claude Code, Codex and Copilot CLI each accept a message from another
process:

- Claude Code accepts it through its inbox socket.
- Codex accepts it through `turn/steer` and the `thread/queue` methods on
  its app-server daemon, or through `codex queue`.
- Copilot CLI accepts it through its SDK.

pi and opencode accept no message from another process, so their adapters
include code that runs inside the CLI. That code is the pi extension
`adapters/pi/extension.js` and the opencode plugin. opencode 2 loads the
folder `adapters/opencode`, and runs its `server.js` in opencode's background
server and its `tui.js` in each window, which lists the sessions the window
has open. opencode 1 loads `adapters/opencode/plugin.js`.

The user registers the file once. When it is missing, `pair start` refuses
with the `unwakeable` message, which contains the file's absolute path and
the command or config file that registers it. pair writes nothing into
another CLI's settings.

### The shared listener

The extension and the plugin both use `adapters/listener.mjs`:

- `listen(deliver)` runs inside the CLI. It creates a directory under the
  system's temporary directory that only the user can open, and listens on
  the Unix socket `wake.sock` in it, or on a named pipe on Windows. It
  returns the socket's path and `close()`. The hub writes one JSON line on
  each connection. The listener calls `deliver` with the parsed line, and
  replies with `ok` once `deliver` returns, followed by the value it returns
  as JSON when there is one, or with the error's message when `deliver`
  throws. The opencode plugins return a session's parent, its title and
  whether a window has it open, which opencode 1's always says it has.
- `send(socket, message)` runs in the hub, from the adapter's `wake`, and in
  `pair` commands that ask the plugin about a session. It writes the line,
  waits up to 5 seconds for the reply, resolves with the value after `ok`,
  and rejects with the reply when it is not `ok`. The hub records that
  message as the wake's `reason`.

Neither side half-closes the socket before the reply, because Bun, which
runs opencode's plugins, closes a half-closed socket.

### When the CLI exits

- A CLI that exits cleanly closes its listener, which deletes the socket, so
  `send` rejects with `the agent CLI has exited (ENOENT SOCKET)`.
- A CLI that is killed leaves the socket file with nothing listening on it,
  and `send` rejects with `the agent CLI has exited (ECONNREFUSED SOCKET)`.

### The session's variables

The extension and the plugin set three variables for the commands the CLI
runs: the socket, the ID of the CLI's session and, in the adapter's
`pidVariable`, the CLI's process ID. opencode 2 sets the session's ID itself,
as `OPENCODE_SESSION_ID`. The socket changes each time the CLI
starts, and the session ID stays the same after `pi --continue` or
`opencode --continue`, so `identity` returns the session ID.

### Registering at start

The extension registers each pi session at pi's `session_start`, and the
plugin each opencode session at opencode's `session.created`, except a
subagent's session, which has a `parentID`. Both call `register(cwd,
variables)` in `adapters/register.mjs`, which runs
`node src/cli.mjs register --hook` with the session's variables. It runs the
`node` on the path, because pi may run on an older Node than pair needs and
opencode runs plugins on Bun. The CLI does not wait for the command and
ignores its failures, and a session that it does not register registers at
its first `pair` command.
