# Commands

`pair --help` lists all commands; `pair COMMAND --help` shows usage and flags
without running the command; `pair --version` prints the version.

| Command                                                | Behavior                                                                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair guide`, `pair guide FILE`                        | Prints `guide/pair.md`, or a specific guide file (`pages.md`), moment (`moments/read-thread.md`), or component markup (`components/NAME/markup.html`).                                                      |
| `pair components`                                      | Lists built-in and custom components with usage guidance and their `pair guide` commands.                                                                                                                   |
| `pair start --title TEXT`                              | Creates a session, sets the caller as holder, and prints its directory and URL.                                                                                                                             |
| `pair start --session-dir DIR`                         | Resumes the session in DIR or takes it over from another agent.                                                                                                                                             |
| `pair start --reopen --session-dir DIR`                | Reopens a closed session with the caller as holder (copied by the browser's Reopen button). Without `--reopen`, `pair start` reports that the session is closed.                                            |
| `pair start --from DIR --proposal ID`                  | Creates a linked session for an approved proposal of DIR and prints the proposal plus any joined proposals.                                                                                                 |
| `pair read`                                            | Prints the next unread submission (round or Start) and marks it read, plus unread threads, newly declined proposals, and newly closed linked sessions. `--submission ID` reprints a past submission read-only. |
| `pair read --thread ID`                                | Prints a full thread with reply instructions and marks it read.                                                                                                                                             |
| `pair search QUERY`                                    | Searches live sessions for what earlier sessions settled. Flags: `--closed`, `--kind`, `--this-session`, `--limit`.                                                                                         |
| `pair progress --page ID --note TEXT`                  | Marks a page started or posts a note on a page (or on the round without `--page`) for the progress card.                                                                                                    |
| `pair publish --file HTML`                             | Publishes a built page. First publish of a round is Agreed with `--pages`. Leaving unpublished pages with none started requires `--start ID` (with optional `--note TEXT`).                                 |
| `pair reply --thread ID --text TEXT`, or `--file HTML` | Posts a thread reply as plain text or a checked HTML fragment.                                                                                                                                              |
| `pair reply --thread ID --ack`                         | Acknowledges pending thread messages that need no reply ("Acknowledged by the agent").                                                                                                                      |
| `pair propose --id ID`                                 | Creates or updates a proposal (see [`pair propose`](#pair-propose)). Any agent may run it.                                                                                                                  |
| `pair status`                                          | Prints session status. Any agent may run it.                                                                                                                                                                |
| `pair pause --reason TEXT`                             | Pauses the session when you tell the agent to stop. Resume with `pair start --session-dir`; end by closing in the browser.                                                                                  |
| `pair register`                                        | Registers the current agent session in `pair agents` and prints its name and ID (see [`pair register` and `pair agents`](#pair-register-and-pair-agents)).                                                  |
| `pair agents`                                          | Lists running registered agent sessions.                                                                                                                                                                    |
| `pair message --to NAME --text TEXT`                   | Messages a running agent session (see [`pair message`](#pair-message)). Supports `--file PATH` and `--ack`.                                                                                                 |
| `pair spawn CLI`                                       | Launches a CLI session via your launch script and prints its name (see [`pair spawn`](#pair-spawn)).                                                                                                        |
| `pair build SOURCE.json OUTPUT.html`                   | Validates and builds a page from source; lists all structural errors (including unknown fields) without writing on failure, and refuses to overwrite OUTPUT.html.                                           |
| `pair diff BEFORE AFTER OUTPUT.json`                   | Builds `before-after` component input from two files.                                                                                                                                                       |
| `pair check`                                           | Verifies Node, storage, loopback, hub port, and Codex rules, printing one line per check.                                                                                                                   |
| `pair setup-codex`                                     | Writes `~/.codex/rules/pair.rules`, required by `pair start` under Codex.                                                                                                                                   |

## Session commands

Every session command except a fresh `pair start` takes `--session-dir DIR` and
prints, in order:

1. The next step.
2. The moment's instructions.
3. The result, with your words wrapped in `pair_` tags.

`pair read` opens with the round number, plan flag, and latest submission ID
(usable with `--submission`). If any page or proposal has been quiet for 10
minutes, the next step appends a reminder (see
[Quiet work](../concepts/architecture.md#quiet-work)).

Long outputs repeat the next step at the end. `--json` outputs a single JSON
object. If `pair read` or `pair status` exceeds 10,000 bytes, it writes the
result to the session's `output/` directory and prints the file path.

## pair propose

Create a proposal with `--id`, `--title`, `--delivers`, and `--recommend`
(`here`, `sub-session`, or `new-agent`), plus optional `--page ROUND/PAGE` or
`--thread ID` for origin. Update an existing proposal with one of these flags:

| Flag                         | Behavior                                                                                                                                                             |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--revise`                   | Updates supplied fields and keeps the rest. Refused once approved, declined, withdrawn, or done.                                                                     |
| `--start WHERE --quote TEXT` | Starts a proposal from your own words (`here`, `sub-session`, or `new-agent`) quoting you. When run by the holder, prints the started work like `pair read`.         |
| `--withdraw --reason TEXT`   | Withdraws an unapproved proposal with a reason.                                                                                                                      |
| `--done`                     | Marks a running-here proposal done after its final page. With `--where TEXT` (such as `"in #86"`), marks work finished elsewhere. Refused for linked-session work.   |
| `--join OTHER`               | Joins a Proposed card into OTHER (refused if OTHER is declined, withdrawn, done, joined, or in a linked session).                                                    |
| `--reopen`                   | Undoes the agent's `--done` or `--join` (refused if marked done by closing a linked session).                                                                        |
| `--status-left TEXT`         | Appends a remaining work part, or resets a matching part back to left.                                                                                               |
| `--status-done TEXT`         | Marks a matching work part done (errors if no part matches).                                                                                                         |
| `--status-drop TEXT`         | Marks a matching work part dropped (kept in the list; no flag deletes parts).                                                                                        |

The three `--status` flags repeat and combine in one standalone command for
unfinished approved work (up to 20 parts, 80 characters each; `--reopen` clears
them). `--status-left` applies first so one call can add and complete a part.
Unmatched `--status-done` / `--status-drop` errors list the existing parts.

## pair register and pair agents

`pair register` adds the current agent session to the running list without
needing the hub, and `pair agents` displays it:

```console
$ pair register
Registered fix-login-54, claude-code:6f1c2a9e, in ~/src/app-worktrees/fix-login.

$ pair agents
NAME          CLI          DIRECTORY                      BRANCH     ID
fix-login-54  Claude Code  ~/src/app-worktrees/fix-login  fix-login  claude-code:6f1c2a9e
api-d3        Codex        ~/src/api                      main       codex:0199c1d4
```

Sessions default to `<folder>-<2 hex chars>` (preserved across CLI restarts;
override with `--name NAME`) and drop from the list when their CLI exits.
`pair agents` abbreviates IDs; `--json` prints full IDs. `pair start`,
`pair message`, `pair spawn`, and pair's pi/opencode integrations register
automatically.

Start hooks run `pair register --hook`, reading stdin JSON when env lacks the ID
(`session_id` in Codex 0.169, `sessionId` in Copilot CLI 1.0.105, both invoked
on the first turn), printing one line, and always exiting 0. Because Antigravity
CLI omits its language-server env vars in hooks, `pair register --hook` in a
`PreInvocation` hook emits JSON telling an unlisted interactive `agy` session to
run `pair register` (silent once listed, in subagents, or in headless `-p`
runs).

## pair message

`pair message` sends text directly to a running agent session through its CLI
(no hub required) and reports when the recipient will read it:

```console
$ pair message --to fix-login-54 --text "The session table now has a revoked_at column."
Sent to fix-login-54 (Claude Code). It reads the message at once if it is idle, and otherwise between the steps of its current turn.
```

Delivered message when sent by `api-d3`:

```text
pair message from api-d3 (Codex in ~/src/api):

The session table now has a revoked_at column.

To answer, run: pair message --to codex:0199c1d4-1111-7000-8000-000000000000 --text "…"
If you have nothing to say, acknowledge it: pair message --to codex:0199c1d4-1111-7000-8000-000000000000 --ack
```

`--to` accepts a name, full ID, or unique ID prefix from `pair agents`. `--text`
and `--file` accept up to 100 KB (verified intact on Claude Code 2.1.325, Codex
0.169, pi 1.5.0, Copilot CLI 1.0.105, and opencode 2.2.5).

| Sender                   | Header                                 | Footer                                                                   |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| Agent session            | `pair message from NAME (CLI in DIR):` | Reply and `--ack` commands with the sender's full ID                     |
| Plain terminal           | `pair message from your user:`         | `This message has no answer command. Answer in your own chat, if at all.` |
| `--from LABEL`, anywhere | `pair message from LABEL:`             | Same as plain terminal                                                   |

Inside an agent session, `pair message` registers the sender first (aborting if
registration fails). Codex, opencode, and Antigravity subagents identify through
their parent (such as `api-d3/Goodall`); Copilot CLI subagents require `--from`.
`--ack` (agent sessions only) sends a single acknowledgement line with no reply
command:

```text
pair message from fix-login-54 (Claude Code in ~/src/app-worktrees/fix-login) acknowledges your message. Don't answer it.
```

`--to NAME/SUBAGENT` targets a subagent. On Claude Code, Codex (matched by name
or nickname), Copilot CLI, and Antigravity CLI, the parent receives an
instruction to forward verbatim via `SendMessage`, `followup_task`,
`write_agent`, or `send_message`. On opencode, pair's plugin prompts the
subagent directly (matched by task or agent). pi has no native subagents;
extension-spawned pi processes register independently.

## pair spawn

`pair spawn` launches a new CLI session in a directory with an optional first
prompt and prints its `pair message --to` name:

```console
$ pair spawn codex --dir ~/code/shop --prompt "Fix the failing checkout test, then message shop-ea when it passes."
Started shop-3f (Codex) in ~/code/shop. Message it with: pair message --to shop-3f --text "…"
```

| Argument                         | Meaning                                                          |
| -------------------------------- | ---------------------------------------------------------------- |
| `CLI`                            | `claude`, `codex`, `copilot`, `pi`, `opencode`, or `agy`.        |
| `--dir DIR`                      | Working directory (default: current directory).                  |
| `--name NAME`                    | Target registration name (default: `pair register` default).     |
| `--prompt TEXT` or `--file PATH` | Initial prompt (if omitted, the session only registers).         |
| `-- ARG…`                        | Extra CLI flags (such as `-- --model sonnet`), not the prompt.   |

`pair spawn` invokes `~/.config/pair/spawn DIR COMMAND ARG…` (or `spawn.ps1` on
Windows), prepending `In your own shell, run pair register first.` (or
`pair register --name NAME` with fallback if `--name` is set, rejecting
duplicate live names before launch). It fails if the script is missing, errors,
or exceeds 10 seconds.

For `claude`, `codex`, and `pi`, flags after `--` end with `--` before the
prompt so multi-value flags (such as `--add-dir`) cannot swallow the prompt; any
flags added by your launch script belong right after `COMMAND`.

Without `--name`, `pair spawn` matches the new session by directory; pass
`--name` when a CLI flag changes directories (such as Codex's `-C` or
`--worktree`). Inside an agent session, `pair spawn` registers the caller first
(continuing with a warning on failure).

`pair spawn` waits up to 30 seconds for registration; if the CLI stalls (for
example, at a folder-trust prompt), it exits 0 with:

```console
Started Codex in ~/code/shop. It appears in pair agents once it runs pair register.
```

pair never skips folder-trust prompts; add trust flags in your launch script or
after `--`. Codex sessions launched with `-c`, `--profile`, or `--search` bypass
its shared daemon (unlike `-m`), so messages arrive only between turns.

## Environment variables

All six are optional:

| Variable                | Default          | Meaning                                                                                                                                    |
| ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `PAIR_HUB_PORT`         | 4747             | Hub port on `127.0.0.1` (`0` assigns a free port, as in tests).                                                                            |
| `PAIR_HUB_HOST`         | unset            | Additional bind address (such as a Tailscale IP) for phone review.                                                                         |
| `PAIR_HUB_IDLE_SECONDS` | 900              | Seconds the hub stays up with no live sessions.                                                                                            |
| `PAIR_WAKE`             | on               | Set `off` to log wakes and write `pair message` to stderr instead of delivering. Refused with the default state directory.                 |
| `XDG_STATE_HOME`        | `~/.local/state` | Parent folder for pair's `pair/` state directory.                                                                                          |
| `XDG_CONFIG_HOME`       | `~/.config`      | Parent folder for pair's `pair/` config directory (components, guide overrides, launch script).                                            |

Browser routes require no token, so bind `PAIR_HUB_HOST` only to a trusted
network address (such as Tailscale); anyone able to reach it can read sessions
and send rounds. pair refuses `0.0.0.0` and `::`. Agent routes always require a
bearer token.

Each state directory needs its own `PAIR_HUB_PORT` while another hub runs.

Plain Codex (0.160+ without `-c`) executes commands in its daemon's environment,
ignoring variables exported in your terminal. Pass them inline with `env`:

```sh
env XDG_STATE_HOME=/tmp/pair-state PAIR_HUB_PORT=4800 pair start --title "Try pair"
```

`pair start` records the hub origin in `connection.json` for subsequent
`--session-dir` commands, but resuming or falling back when that hub is down
uses the command's own environment, so keep the `env` prefix on those calls too.
