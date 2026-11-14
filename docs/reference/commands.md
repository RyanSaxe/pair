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
| `pair propose --id ID`                                 | Records a proposal, or changes the one with that ID, as [`pair propose`](#pair-propose) describes. Any agent may run it.                                                                                                                                                                                               |
| `pair status`                                          | Prints the session's status. Any agent may run it.                                                                                                                                                                                                                                                                     |
| `pair pause --reason TEXT`                             | Pauses the session when you tell the agent to stop. `pair start --session-dir` resumes it. You end a session by closing it in the browser.                                                                                                                                                                             |
| `pair register`                                        | Adds the agent session it runs in to pair's list of running agent sessions, or updates its entry, and prints the session's name and ID, as [pair register and pair agents](#pair-register-and-pair-agents) describes. `--name NAME` names the session, and `--hook` is for an agent CLI's start hook.                  |
| `pair agents`                                          | Lists the registered agent sessions whose CLI is still running.                                                                                                                                                                                                                                                        |
| `pair message --to NAME --text TEXT`                   | Sends a message to a running agent session, as [pair message](#pair-message) describes. `--file PATH` sends a file's text, and `--from LABEL` names a sender outside any agent CLI.                                                                                                                                    |
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
agent sessions, and `pair agents` prints the list. Neither takes
`--session-dir` or needs the hub.

```console
$ pair register
Registered fix-login-3f, claude-code:6f1c2a9e, in ~/src/app-worktrees/fix-login.

$ pair agents
NAME          CLI          DIRECTORY                      BRANCH     ID
fix-login-3f  Claude Code  ~/src/app-worktrees/fix-login  fix-login  claude-code:6f1c2a9e
api-d3        Codex        ~/src/api                      main       codex:0199c1d4
```

A session's ID is the CLI and the session ID that the CLI keeps when the
session resumes. pair prints the start of the ID, eight characters of the
session ID or more when two sessions' IDs start the same way, and `--json`
prints whole IDs.

A session's name is its folder's name, lowercased, with each character other
than a letter, digit or hyphen turned into a hyphen, then a hyphen and two
hex characters from a hash of the session's ID, or the next value when a
running session has that name. A session therefore gets the same name each
time it registers, also after its CLI restarts. `--name NAME` sets another
name and refuses one that a running session has, and a running session that
registers again keeps the name it has.

pair keeps one file for each session in `$XDG_STATE_HOME/pair/agents/`, which
only you can read, because the file holds the CLI's wake target, and Claude
Code's includes its inbox token. An entry counts as running while a process
with the entry's process ID and start time runs, so a process that gets the
same ID after a restart does not count. That process is the CLI's, except
for a Codex session on Codex's app-server daemon, whose commands run under
the daemon. pair counts such a session as running while the daemon has its
thread loaded, which ends about a minute after the session exits.
`pair register` and `pair agents` delete every entry that is not running.
A session that a CLI starts in the same process, as Claude Code's `/clear`
and pi's `/new` do, replaces that process's other entries when it registers,
except in opencode, whose one process serves several sessions.

`pair start` registers the agent that runs it. When registering fails, it
prints why on stderr and starts the session as usual. pair's pi extension
registers each pi session when it starts, and pair's opencode plugin
registers each opencode session but a subagent's when opencode creates it.

`pair register` refuses outside an agent CLI, and when pair finds no process
of the CLI among the command's parent processes. It also refuses a Codex
subagent, which has a thread of its own, and prints the `NAME/SUBAGENT` that
reaches it through the session that started it. pair reads processes with
`ps` on macOS and Linux and with PowerShell on Windows. With `--hook`, which
an agent CLI's start hook runs, it reads the session ID from the hook's JSON
on stdin when the environment has none, `session_id` from Codex and
`sessionId` from Copilot CLI, prints one line, and exits 0 even when it cannot
register. Codex 0.169 runs its SessionStart hook when the session's first turn
starts, so a Codex session registers then, not when Codex opens.

## pair message

`pair message` sends a message to a running agent session through its agent
CLI, and prints when the session's agent reads it. It takes no
`--session-dir` and needs no hub.

```console
$ pair message --to fix-login-3f --text "The session table now has a revoked_at column. Use it for logout."
Sent to fix-login-3f (Claude Code). It reads the message at once if it is idle, and otherwise between the steps of its current turn.
```

The agent in `fix-login-3f` reads this:

```text
pair message from api-d3 (Codex in ~/src/api):

The session table now has a revoked_at column. Use it for logout.

To answer, run: pair message --to codex:0199c1d4-1111-7000-8000-000000000000 --text "…"
```

`--to` takes a name or an ID that `pair agents` prints, or the start of one
ID. `pair message` first deletes every entry that is not running, as
`pair agents` does. It refuses a name or ID that no running session has, and
a start of an ID that more than one session's ID has. `--text` and `--file`
take at most 100 KB of text. Claude Code 2.1.325, Codex 0.169 and pi 1.5.0
each received a 100 KB message whole.

Inside an agent CLI, `pair message` registers the session it runs in, as
`pair register` does, and sends nothing when it cannot. The first line names
that session, and the last line gives the command that answers it, with the
whole ID, because another session can take the name after this one exits.
A Codex subagent has no entry, so a message from it names it as
`PARENT/NICKNAME`, which reaches it through its parent, such as
`api-d3/Goodall`.
Outside any agent CLI, the first line is `pair message from your user:`, and
`--from LABEL` makes it `pair message from LABEL:`. Neither message has a
command to answer it, so each ends with the line `This message has no answer
command. Answer in your own chat, if at all.`

`--to NAME/SUBAGENT` sends the message to a subagent of the session:

| Agent CLI   | How the message reaches the subagent                                                                                                                                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | The parent receives it, with a first line that asks the parent's agent to pass it on unchanged with `SendMessage`.                                                                                                                                                                       |
| Codex       | The parent receives it, with a first line that asks the parent's agent to pass it on unchanged with `followup_task` and the subagent's agent path, such as `/root/echo`. pair finds the subagent on Codex's daemon by the name the parent gave it or by its nickname, such as `Goodall`. |
| Copilot CLI | Copilot's SDK sends it to the subagent's task, found by its name or its task. When that fails, the parent receives it, with a first line that asks the parent's agent to pass it on with `write_agent`.                                                                                  |
| opencode    | pair's plugin prompts the subagent's session, found by its title, its task or its agent.                                                                                                                                                                                                 |
| pi          | `pair message` refuses, because pair's extension cannot send to a pi subagent.                                                                                                                                                                                                           |

## Environment variables

All six are optional.

| Variable                | Default          | Meaning                                                                                                                                                                           |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747             | The hub's port on 127.0.0.1. With `0`, the system assigns a free port, as the tests do.                                                                                           |
| `PAIR_HUB_HOST`         | unset            | An extra address for the hub to listen on, such as a Tailscale IP, so you can review on a phone.                                                                                  |
| `PAIR_HUB_IDLE_SECONDS` | 900              | How long the hub keeps running with no live session.                                                                                                                              |
| `PAIR_WAKE`             | on               | With `off`, the hub writes each wake line to its log instead of sending it, and `pair message` writes its message to stderr. pair refuses `off` with the default state directory. |
| `XDG_STATE_HOME`        | `~/.local/state` | pair stores the sessions and the hub's files in its `pair/` folder.                                                                                                               |
| `XDG_CONFIG_HOME`       | `~/.config`      | pair reads your components, guide files and moment files from its `pair/` folder.                                                                                                 |

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
