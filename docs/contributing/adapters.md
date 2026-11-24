# Adapters

The hub wakes Claude Code, Codex, Copilot CLI, pi, opencode, and Antigravity CLI
through each CLI's folder under `adapters/`.

## What `wake.mjs` exports

Required values:

| Export       | Value                                                    |
| ------------ | -------------------------------------------------------- |
| `name`       | Display name, such as `Codex`.                           |
| `command`    | Executable command name.                                 |
| `variables`  | Environment variables the CLI passes to child commands.  |
| `unwakeable` | Error message when any variable in `variables` is unset. |

Required functions:

- `detect(env, tools)`: returns the wake target once all `variables` are set.
  `tools.ancestor` is the matching ancestor process (or `null` when chosen by
  variables alone). Throw if the session still cannot be woken.
- `identity(target)`: returns the session identifier (inbox socket for Claude
  Code, thread ID for Codex, conversation ID for Antigravity CLI, session ID for
  others).
- `wake(target, line, run)`: delivers one line or throws with the reason.
  `run(file, args, env)` executes a program with `env` added to the hub's
  environment and rejects with stderr (or stdout when stderr is empty, as with
  agy's `agentapi`). Resolves to `{ via, steerable }`, stored in the wake result
  and `holder.steerable` in `status.json` for frame tooltips.
- `launch({ name, prompt, args })`: returns the argv array starting a new
  session with `prompt` (named `name` where supported) and `args` from
  `pair spawn --` placed before the prompt. Use `endOptions(args)` from
  `src/shared/launch.mjs` for CLIs with positional prompts.

Optional exports for `src/cli/agents.mjs`:

| Export                                                     | Value                                                                                                                                                                     |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sessionId(target)`                                        | Persistent ID across resumes when `identity` differs (for example, Claude Code's inbox socket).                                                                           |
| `hookVariables(input)`                                     | Extracts wake variables from start-hook stdin JSON when omitted from env (Codex, Copilot CLI).                                                                            |
| `hookResponse(ancestor, { readAgents, env, input, name })` | Custom JSON output for `pair register --hook` (`null` prints nothing; `undefined` continues normally). Used by Antigravity CLI's `PreInvocation` hook.                    |
| `pidVariable`                                              | Env var where in-CLI pair code records the CLI PID when the process name is generic (such as `node`).                                                                     |
| `recognizes(ancestor)`                                     | Returns `true` for renamed/wrapped processes (such as Copilot CLI running under `node` with `index.js` in nixpkgs).                                                       |
| `parentSession(target)`                                    | Returns `{ sessionId, nickname }` of a subagent's parent, or `null`.                                                                                                      |
| `sharesProcess(cliProcess)`                                | Returns `true` when one process hosts multiple sessions (Codex daemon, opencode), keeping siblings listed.                                                                |
| `subagentTool(target, name)`                               | Tool name for parent forwarding via `pair message --to NAME/SUBAGENT` (`SendMessage`, `followup_task`, `write_agent`, `send_message`), or `null` for direct delivery (opencode). |
| `running(target, cliProcess)`                              | Checks liveness for long-lived processes (Codex daemon, opencode 2 background server). Called by `pair agents` after the process check passes.                            |

## How the hub chooses an adapter

`detectAgent` in `src/hub/wake.mjs` selects the adapter for `pair start`,
`pair register`, and `pair message` (returning `null` for a plain terminal):

1. Walks ancestor processes nearest first, matching `command`, `pidVariable`,
   then `recognizes`, so an inner CLI wins over an outer CLI whose variables it
   inherited.
2. If no ancestor matches, picks the first adapter whose first variable is set.
3. Calls `detect`, or refuses with `unwakeable` if any variable in `variables`
   is missing.

## When the CLI reads the line

Adapters steer into an active turn where the CLI supports it:

| Agent CLI       | `via`          | API                                                                      | During an active turn, the agent reads the line                |
| --------------- | -------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Claude Code     | `inbox`        | User message over the inbox socket                                       | Between turn steps                                             |
| Codex           | `steer`        | `turn/steer` on Codex's app-server daemon                                | Between turn steps                                             |
| Codex           | `queue`        | `thread/queue/add` + `thread/queue/start` on daemon, or `codex queue`    | When the turn ends                                             |
| Codex           | `parent`       | `steer` or `queue` to the parent thread of a spawned subagent            | After the parent forwards it with `followup_task`              |
| Copilot CLI     | `immediate`    | `session.send` with mode `immediate` via Copilot CLI SDK                 | Immediately (moves running shell commands to the background)   |
| Copilot CLI     | `enqueue`      | `session.send` with mode `enqueue`                                       | When the turn ends                                             |
| pi              | `steer`        | `sendUserMessage` (`deliverAs: "steer"`) in pair's extension             | After the current model response's tool calls                  |
| opencode        | `prompt`       | `ctx.session.prompt` (opencode 2) or `client.session.promptAsync` (v1)   | After the current model response's tool calls                  |
| Antigravity CLI | `send-message` | `agy agentapi send-message CONVERSATION LINE` against agy's LS           | After the tool call in progress                                |

- **Codex**: Uses `turn/steer` when a turn is active on the daemon. When idle on
  the daemon, queues via `thread/queue/add` and starts a turn via
  `thread/queue/start` (needed after user interrupts, where Codex leaves queued
  lines idle; requires `experimentalApi` in `initialize`). If
  `thread/queue/start` fails with the line queued on an idle thread, `wake`
  throws. Otherwise, or on socket error before queueing, falls back to
  `codex queue`.
- **Codex subagents**: When `thread/read` reports a `subAgent.thread_spawn`
  source, Codex rejects external input unless the daemon loaded the subagent.
  The adapter instead wakes the parent thread with the subagent's agent ID and
  asks it to forward via `followup_task` (or older `send_input`; `send_message`
  does not start a turn). An in-process parent reads that only after its own
  turn ends.
- **Copilot CLI**: Falls back to `enqueue` only when Copilot rejects `immediate`
  (supported in 1.0.70 through 1.0.91).

Idle CLIs start a turn on every path except `turn/steer`. `steerable` is `false`
for `enqueue`, non-daemon `codex queue`, and Codex subagent `parent` wakes, and
`true` otherwise.

## A listener inside the CLI

Claude Code (inbox socket), Codex (daemon/`codex queue`), Copilot CLI (SDK), and
Antigravity CLI (`agy agentapi send-message` with `ANTIGRAVITY_LS_ADDRESS` and
`ANTIGRAVITY_CSRF_TOKEN`) accept external messages natively. Because agy hooks
only receive `ANTIGRAVITY_CONVERSATION_ID`, `pair register --hook` in
`PreInvocation` emits an `ephemeralMessage` telling the agent to run
`pair register` once per unlisted interactive `agy` process.

pi and opencode require in-CLI code registered once by the user (`pair` never
modifies another CLI's settings):

- pi: `adapters/pi/extension.js`
- opencode 2: `adapters/opencode` (`server.js` in the background server,
  `tui.js` in each window to report open sessions)
- opencode 1: `adapters/opencode/plugin.js`

Missing registration makes `pair start` refuse with `unwakeable`, printing the
absolute path and registration command or config file.

### The shared listener

Both use `adapters/listener.mjs`:

- `listen(deliver)` runs inside the CLI, creates a user-only temp directory, and
  listens on `wake.sock` (or a Windows named pipe). Each connection writes one
  JSON line; the listener calls `deliver`, then replies `ok` (plus optional JSON
  value, such as opencode's parent, title, and window status) or an error
  message.
- `send(socket, message)` runs in the hub and `pair` commands, writes the JSON
  line, waits up to 5 seconds, resolves with any value after `ok`, and rejects
  with non-`ok` replies (recorded as wake `reason`).

Neither side half-closes before the reply because Bun (running opencode plugins)
drops half-closed sockets.

### When the CLI exits

- Clean exit closes the listener and removes the socket; `send` rejects with
  `the agent CLI has exited (ENOENT SOCKET)`.
- Killed processes leave a stale socket; `send` rejects with
  `the agent CLI has exited (ECONNREFUSED SOCKET)`.

### The session's variables

The extension and plugin export the socket path, session ID (opencode 2 sets
`OPENCODE_SESSION_ID` itself), and CLI PID (`pidVariable`) to child commands.
Because the socket changes on restart while the session ID persists across
`--continue`, `identity` returns the session ID.

### Registering at start

The pi extension registers at `session_start` and the opencode plugin at
`session.created` (skipping subagents with a `parentID`). Both call
`register(cwd, variables)` in `adapters/register.mjs`, running
`node src/cli.mjs register --hook` asynchronously using `node` from PATH (since
pi may run older Node and opencode runs Bun) and ignoring failures. Unregistered
sessions still register on their first `pair` command.
