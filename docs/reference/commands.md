# Commands

`pair --help` lists every command with what it does, and
`pair COMMAND --help` prints that command's usage and flags without running
it. `pair --version` prints the version.

| Command                                                | What it does                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair guide`, `pair guide FILE`                        | Prints the agent's instructions, `guide/pair.md`. With FILE, it prints that file instead, such as the guide file `pages.md`, the moment `moments/read-thread.md` or a component's markup, `components/NAME/markup.html`.                                                                                               |
| `pair components`                                      | Lists every component, pair's and yours, with when to use it and the `pair guide` command that prints its markup.                                                                                                                                                                                                      |
| `pair start --title TEXT`                              | Creates a session, makes the agent that runs it the holder, and prints the session's directory and URL.                                                                                                                                                                                                                |
| `pair start --session-dir DIR`                         | Resumes the session in DIR, or takes it over from another agent.                                                                                                                                                                                                                                                       |
| `pair start --reopen --session-dir DIR`                | Makes the closed session in DIR live again, with the agent that runs it as the holder. The Reopen button on a closed session copies this command. Without `--reopen`, `pair start` on a closed session prints that you closed it.                                                                                      |
| `pair start --from DIR --proposal ID`                  | Creates a session for a proposal of the session in DIR that you approved to run in a sub-session or with a new agent. It links the two sessions and prints the proposal with the proposals joined into it.                                                                                                             |
| `pair read`                                            | Prints the next thing you sent that the agent has not read, a whole round or a Start, and marks it read. It lists each thread with a new message from you, and each proposal you declined or linked session you closed since the last `pair read`. `--submission ID` prints a past submission again and marks nothing. |
| `pair read --thread ID`                                | Prints one thread whole, with how to answer it, and marks it read.                                                                                                                                                                                                                                                     |
| `pair search QUERY`                                    | Prints the results that best match QUERY across live sessions, for the agent to find what an earlier session settled. `--closed` includes closed sessions, and `--kind`, `--this-session` and `--limit` narrow them.                                                                                                   |
| `pair progress --page ID --note TEXT`                  | Reports that the agent started a page, a note on a page, or, without `--page`, a note on the round. The progress card shows each report.                                                                                                                                                                               |
| `pair publish --file HTML`                             | Publishes a page that `pair build` wrote. The first publish of a round is Agreed, with the round's page list in `--pages`. A publish that would leave pages unpublished and none started needs `--start ID`, which starts the page the agent works on next, and `--note TEXT` gives that page a note.                  |
| `pair reply --thread ID --text TEXT`, or `--file HTML` | Posts the agent's reply in a thread, as plain text or as an HTML fragment that passes `pair build`'s page checks.                                                                                                                                                                                                      |
| `pair reply --thread ID --ack`                         | Acknowledges your messages in a thread that wait for an answer, in place of a reply, when they ask for nothing. pair shows "Acknowledged by the agent" in the thread.                                                                                                                                                  |
| `pair propose --id ID`                                 | Records a proposal, or changes the one with that ID, as [`pair propose`](#pair-propose) describes. Any agent may run it.                                                                                                                                                                                               |
| `pair status`                                          | Prints the session's status. Any agent may run it.                                                                                                                                                                                                                                                                     |
| `pair pause --reason TEXT`                             | Pauses the session when you tell the agent to stop. `pair start --session-dir` resumes it. You end a session by closing it in the browser.                                                                                                                                                                             |
| `pair register`                                        | Adds the agent session it runs in to pair's list of running agent sessions and prints the session's name and ID, as [`pair register` and `pair agents`](#pair-register-and-pair-agents) describes.                                                                                                                     |
| `pair agents`                                          | Lists the registered agent sessions that are running.                                                                                                                                                                                                                                                                  |
| `pair message --to NAME --text TEXT`                   | Sends a message to a running agent session, as [`pair message`](#pair-message) describes. `--file PATH` sends a file's text, and `--ack` acknowledges a message.                                                                                                                                                       |
| `pair spawn CLI`                                       | Starts a session of an agent CLI through your launch script and prints its name, as [`pair spawn`](#pair-spawn) describes.                                                                                                                                                                                             |
| `pair build SOURCE.json OUTPUT.html`                   | Builds a page from its source. When the source has problems, it lists every structural problem, including any unknown field, and writes nothing. It refuses to overwrite OUTPUT.html.                                                                                                                                  |
| `pair diff BEFORE AFTER OUTPUT.json`                   | Writes the input for the before-after component from two files.                                                                                                                                                                                                                                                        |
| `pair check`                                           | Checks Node, storage, loopback, the hub port and Codex's rules file, and prints one line for each.                                                                                                                                                                                                                     |
| `pair setup-codex`                                     | Writes the Codex allow rule for `pair` to `~/.codex/rules/pair.rules`, which `pair start` requires under Codex.                                                                                                                                                                                                        |

## Session commands

Every session command takes `--session-dir DIR`, except `pair start` when it
creates a session. A session command prints these, in order:

1. The next step.
2. The instructions for that moment of the session.
3. Its result, with your words inside `pair_` tags.

The result of `pair read` starts with the round, whether it is a plan, and the
latest submission's ID, which `--submission` takes.

While a page or a proposal has had no update for 10 minutes, the next step
ends with a line about it, as
[Quiet work](../concepts/architecture.md#quiet-work) describes.

When the output is long, it prints the next step again at the end. `--json`
prints the result as one JSON object instead. When the output of `pair read`
or `pair status` is over 10,000 bytes, the command writes its result to a
file in the session's `output/` directory and prints the file's path.

## pair propose

`pair propose` with `--id`, `--title`, `--delivers` and `--recommend`
records a new proposal. `--recommend` takes `here`, `sub-session` or
`new-agent`. Add `--page ROUND/PAGE` or `--thread ID` for where the work came
up. With one of the flags below, the command changes the proposal that has
the ID instead.

| Flag                         | What it does                                                                                                                                                                                                                                                     |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--revise`                   | Replaces the fields given and keeps the rest. The hub refuses it once you have approved the work, or once the proposal is declined, withdrawn or marked done.                                                                                                    |
| `--start WHERE --quote TEXT` | Marks the proposal started because you asked for the work in your own words, and quotes your words with `--quote`. WHERE is `here`, `sub-session` or `new-agent`. When the holder runs it, `pair propose` prints the started work as `pair read` prints a Start. |
| `--withdraw --reason TEXT`   | Withdraws a proposal that you have not approved and that no longer applies.                                                                                                                                                                                      |
| `--done`                     | Marks work that runs here done, after the agent publishes its last page. With `--where TEXT`, such as `--where "in #86"`, it marks a proposal done whose work was finished somewhere else.                                                                       |
| `--join OTHER`               | Joins a proposal that is still in Proposed into OTHER, whose work covers it. The hub refuses it when OTHER is declined, withdrawn, done or joined itself, or runs in a sub-session or with a new agent.                                                          |
| `--reopen`                   | Undoes the agent's own `--done` or `--join`. The hub refuses it for a proposal that it marked done because you closed its linked session.                                                                                                                        |
| `--status-left TEXT`         | Adds a part of approved work that is left, after the proposal's parts. When the proposal already has a part with that text, the hub sets that part back to left.                                                                                                 |
| `--status-done TEXT`         | Marks the part with that text done, and refuses text that matches none of the proposal's parts.                                                                                                                                                                  |
| `--status-drop TEXT`         | Marks the part with that text dropped. The part stays in the proposal's parts, and no flag removes one.                                                                                                                                                          |

The hub refuses `--done` for a proposal whose work runs in a sub-session or
with a new agent. When you close that session, the hub marks the proposal
done.

The three `--status` flags repeat, once for each part, and one command can
mix them. Each flag changes only the part with its text. The hub accepts
them only for work that you approved and that is not finished, in a command
with no other flag from this section. It refuses `--status-done` and
`--status-drop` for text that matches no part, with an error that lists the
proposal's parts. The hub applies the `--status-left` parts first, so one
command can add a part and mark it done. A proposal has at most 20 parts,
each at most 80 characters, and `--reopen` clears them.

## pair register and pair agents

`pair register` adds the agent session it runs in to pair's list of running
agent sessions, and `pair agents` prints the list. Neither needs the hub.

```console
$ pair register
Registered fix-login-54, claude-code:6f1c2a9e, in ~/src/app-worktrees/fix-login.

$ pair agents
NAME          CLI          DIRECTORY                      BRANCH     ID
fix-login-54  Claude Code  ~/src/app-worktrees/fix-login  fix-login  claude-code:6f1c2a9e
api-d3        Codex        ~/src/api                      main       codex:0199c1d4
```

A session is named for its folder and two hex characters from its ID, keeps
that name when its CLI restarts, and `--name NAME` sets another. `pair agents`
prints the start of each ID, `--json` prints whole IDs, and a session leaves
the list when its CLI exits. `pair start`, `pair message` and `pair spawn`
register the agent that runs them, and pair's pi extension and opencode
plugin register each session when it starts.

An agent CLI's start hook runs `pair register --hook`. With `--hook`,
`pair register` reads the session ID from the hook's JSON on stdin when the
environment has none, `session_id` from Codex and `sessionId` from Copilot
CLI, prints one line, and exits 0 even when it cannot register. Codex 0.169
and Copilot CLI 1.0.105 run the start hook when the session's first turn
starts, so a session registers then.

## pair message

`pair message` sends a message to a running agent session through its agent
CLI, without the hub, and prints when the session's agent reads it.

```console
$ pair message --to fix-login-54 --text "The session table now has a revoked_at column."
Sent to fix-login-54 (Claude Code). It reads the message at once if it is idle, and otherwise between the steps of its current turn.
```

When `api-d3` sent it, the agent in `fix-login-54` reads this:

```text
pair message from api-d3 (Codex in ~/src/api):

The session table now has a revoked_at column.

To answer, run: pair message --to codex:0199c1d4-1111-7000-8000-000000000000 --text "…"
If you have nothing to say, acknowledge it: pair message --to codex:0199c1d4-1111-7000-8000-000000000000 --ack
```

`--to` takes a name or ID that `pair agents` prints, or the start of one ID.
`--text` and `--file` take at most 100 KB of text, which Claude Code 2.1.325,
Codex 0.169, pi 1.5.0, Copilot CLI 1.0.105 and opencode 2.2.5 each received
whole.

| Sender                   | First line                             | Last lines                                                                |
| ------------------------ | -------------------------------------- | ------------------------------------------------------------------------- |
| An agent session         | `pair message from NAME (CLI in DIR):` | The commands that answer and acknowledge it, with the sender's whole ID   |
| A plain terminal         | `pair message from your user:`         | `This message has no answer command. Answer in your own chat, if at all.` |
| `--from LABEL`, anywhere | `pair message from LABEL:`             | The same line as from a plain terminal                                    |

Inside an agent session, `pair message` registers that session first, and
sends nothing when it cannot. A subagent of Codex or opencode has no entry,
so its message names it through its parent, as `api-d3/Goodall`, and a
Copilot CLI subagent sends only with `--from`. `--ack`, in
place of `--text`, sends one line and no command to answer it, and works only
inside an agent session:

```text
pair message from fix-login-54 (Claude Code in ~/src/app-worktrees/fix-login) acknowledges your message. Don't answer it.
```

`--to NAME/SUBAGENT` sends the message to a subagent of the session. In
Claude Code, Codex and Copilot CLI the parent receives it, with a first line
that asks the parent's agent to pass it on unchanged: with `SendMessage` in
Claude Code, `followup_task` and the subagent's agent path in Codex, and
`write_agent` in Copilot CLI. pair finds a Codex subagent by the name the
parent gave it or by its nickname. In opencode, pair's plugin prompts the
subagent's session, found by its task or its agent. pi has no subagents of its
own, and a pi that an extension runs with pair's extension registers as a
session of its own.

## pair spawn

`pair spawn` starts a new session of an agent CLI in a folder, with a first
prompt, and prints the name that `pair message --to` takes.

```console
$ pair spawn codex --dir ~/code/shop --prompt "Fix the failing checkout test, then message shop-ea when it passes."
Started shop-3f (Codex) in ~/code/shop. Message it with: pair message --to shop-3f --text "…"
```

| Part                             | Meaning                                                                    |
| -------------------------------- | -------------------------------------------------------------------------- |
| `CLI`                            | `claude`, `codex`, `copilot`, `pi` or `opencode`.                          |
| `--dir DIR`                      | The folder to start it in. The default is the current folder.              |
| `--name NAME`                    | The name it registers under. The default is the one `pair register` gives. |
| `--prompt TEXT` or `--file PATH` | The first prompt. Without one, the session only registers.                 |
| `-- ARG…`                        | Options for the CLI, such as `-- --model sonnet`, but not the prompt.      |

`pair spawn` runs your launch script, `~/.config/pair/spawn DIR COMMAND ARG…`,
or `spawn.ps1` on Windows, which is the script the hub runs when you press
Start agent on a proposal. `COMMAND ARG…` starts the CLI with the arguments
after `--`, then the first prompt
`In your own shell, run pair register first.`, followed by your prompt. With
`--name NAME`, the first prompt starts with
`In your own shell, run pair register --name NAME first. If another running session has that name, run pair register without --name.`
instead, and `pair spawn` refuses a NAME that a running session already has
before it runs the script. Without a launch script, `pair spawn` refuses and
starts nothing. When the script fails, or runs longer than 10 seconds,
`pair spawn` fails with the script's error.

When you give arguments after `--`, `pair spawn` ends them with `--` for
`claude`, `codex` and `pi`, so a flag that takes several values, such as
`--add-dir`, cannot take the prompt as one of them. A flag that your launch
script adds then belongs right after COMMAND, not after the prompt.

Without `--name`, `pair spawn` finds the new session by its folder. Give
`--name` with an argument that makes the CLI run in another folder, such as
Codex's `-C` or `--worktree`.

Inside an agent session, `pair spawn` registers that session first, so the
new session can message it. When that fails, `pair spawn` prints why and
starts the new session anyway.

`pair spawn` waits up to 30 seconds for the new session to register. When it
does not, as while the CLI waits at its folder-trust prompt, `pair spawn`
prints this and exits 0:

```console
Started Codex in ~/code/shop. It appears in pair agents once it runs pair register.
```

pair adds no flag that skips a CLI's folder-trust prompt. Your launch script
can add one, or you can give it after `--`.

A Codex session reads a message in the middle of its turn only when it runs
on Codex's app-server daemon, as [Codex](../concepts/architecture.md#codex)
describes. For `codex`, `pair spawn` follows Codex 0.169's rules for the
daemon:

| Arguments                                                                                                                                                                                                        | What Codex does                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `-m` or `--model`, `-s` or `--sandbox`, `-a` or `--ask-for-approval`, `-C` or `--cd`, `-i` or `--image`, `--add-dir`, `--worktree`, `--no-alt-screen`                                                            | Starts the session on the daemon.                                                                                                                                                                                                          |
| `--enable`, `--disable`, and `-c` or `--config` when it sets a feature to `true` or `false`, as `-c features.NAME=true` does                                                                                     | Starts the session on the daemon when the daemon has the same setting for each feature. Otherwise it asks in the new terminal whether to restart the daemon, which can interrupt other Codex sessions, or to start the session without it. |
| Any other `-c` or `--config`, such as `-c model_reasoning_effort=high`, and `-p` or `--profile`, `--search`, `--oss`, `--approve-for-me`, `--strict-config`, `--dangerously-bypass-hook-trust` and `--no-daemon` | Starts the session without the daemon, so the session reads each message only when its turn ends.                                                                                                                                          |

For the arguments in the last two rows, `pair spawn` prints a warning that
names them, then starts the session:

```console
$ pair spawn codex --dir ~/code/shop --prompt "Fix the failing checkout test." -- -m gpt-5.5 -c model_reasoning_effort=high
pair: With -c model_reasoning_effort=high, Codex starts the session without its app-server daemon, so the session reads each message only when its current turn ends.
Started shop-3f (Codex) in ~/code/shop. Message it with: pair message --to shop-3f --text "…"
```

## Environment variables

All six are optional.

| Variable                | Default          | Meaning                                                                                                                                                                           |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747             | The hub's port on 127.0.0.1. With `0`, the system assigns a free port, as the tests do.                                                                                           |
| `PAIR_HUB_HOST`         | unset            | An extra address for the hub to listen on, such as a Tailscale IP, so you can review on a phone.                                                                                  |
| `PAIR_HUB_IDLE_SECONDS` | 900              | How long the hub keeps running with no live session.                                                                                                                              |
| `PAIR_WAKE`             | on               | With `off`, the hub writes each wake line to its log instead of sending it, and `pair message` writes its message to stderr. pair refuses `off` with the default state directory. |
| `XDG_STATE_HOME`        | `~/.local/state` | pair stores the sessions and the hub's files in its `pair/` folder.                                                                                                               |
| `XDG_CONFIG_HOME`       | `~/.config`      | pair reads your components, guide files, moment files and launch script from its `pair/` folder.                                                                                  |

The hub's browser routes need no token, so the hub listens on an extra address
only when you set `PAIR_HUB_HOST`. Anyone who can reach that address can
read your sessions and send rounds that your agent acts on as yours, so set
it only to an address on a network you trust, such as your own Tailscale IP.
pair refuses `0.0.0.0` and `::`, which would make the hub reachable from every
network the machine is on. The routes that agents use need the session's
bearer token on every address.

While a hub runs, `pair start` refuses to use its port for another state
directory, so give each state directory its own `PAIR_HUB_PORT`.

A Codex from version 0.160 started with no `-c` override runs the agent's
commands on its app-server daemon, with the daemon's environment, so a variable
you export in the terminal before you start Codex does not reach `pair`. To run
a session under Codex on another port or state directory, ask the agent to put
the variables in front of `pair start` with `env`:

```sh
env XDG_STATE_HOME=/tmp/pair-state PAIR_HUB_PORT=4800 pair start --title "Try pair"
```

`pair start` writes the address of its hub to the session's
`connection.json`, and every other command with `--session-dir` sends its
request to that address. A `pair start` that resumes the session, and a
command that finds no hub at that address, use the hub that the variables in
their own environment give, so they need the variables in front of them too.
