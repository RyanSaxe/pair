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
| `pair start --from DIR --proposal ID`                  | Creates a session for a proposal of the session in DIR that you approved to run in a sub-session or with a new agent. It links the two sessions and prints the proposal with the proposals joined into it.                                                                                                             |
| `pair read`                                            | Prints the next thing you sent that the agent has not read, your feedback or a Start, and marks it read. It lists each thread with a new message from you, and each proposal you declined or linked session you closed since the last `pair read`. `--submission ID` prints a past submission again and marks nothing. |
| `pair read --thread ID`                                | Prints one thread whole, with how to answer it, and marks it read.                                                                                                                                                                                                                                                     |
| `pair progress --page ID --note TEXT`                  | Reports that the agent started a page, a note on a page, or, without `--page`, a note on the round. The progress card shows each report.                                                                                                                                                                               |
| `pair publish --file HTML`                             | Publishes a page that `pair build` wrote. The first publish of a round is Agreed, with the round's page list in `--pages`.                                                                                                                                                                                             |
| `pair reply --thread ID --text TEXT`, or `--file HTML` | Posts the agent's reply in a thread, as text or as an HTML fragment that passes `pair build`'s page checks.                                                                                                                                                                                                            |
| `pair propose --id ID`                                 | Records a proposal, or changes the one with that ID, as [`pair propose`](#pair-propose) describes. Any agent may run it.                                                                                                                                                                                               |
| `pair status`                                          | Prints where the session stands. Any agent may run it.                                                                                                                                                                                                                                                                 |
| `pair pause --reason TEXT`                             | Pauses the session when you tell the agent to stop. `pair start --session-dir` resumes it. You end a session by closing it in the browser.                                                                                                                                                                             |
| `pair build SOURCE.json OUTPUT.html`                   | Builds a page from its source. When the source has problems, it lists every structural problem, including any field pair does not know, and writes nothing. It refuses to overwrite OUTPUT.html.                                                                                                                       |
| `pair diff BEFORE AFTER OUTPUT.json`                   | Writes the input for the before-after component from two files.                                                                                                                                                                                                                                                        |
| `pair check`                                           | Checks Node, storage, loopback, the hub port and Codex's rules file, and prints one line for each.                                                                                                                                                                                                                     |
| `pair setup-codex`                                     | Writes the Codex allow rule for `pair` to `~/.codex/rules/pair.rules`, which `pair start` requires under Codex.                                                                                                                                                                                                        |

## Session commands

Every session command takes `--session-dir DIR`, except `pair start` when it
creates a session. A session command prints these, in order:

1. The next step.
2. The instructions for that moment of the session.
3. Its result, with your words inside `pair_` tags.

While a page or a proposal has had no update for 10 minutes, the next step
ends with a line that names it, as
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
| `--status-left TEXT`         | Adds a part of approved work that is left, after the proposal's parts. A part with that text that the proposal already lists keeps its state.                                                                                                                    |
| `--status-done TEXT`         | Marks the part with that text done, or adds it as done when the proposal does not list it.                                                                                                                                                                       |
| `--status-drop TEXT`         | Marks a part the proposal lists dropped. The part stays in the proposal's parts, and no flag removes one.                                                                                                                                                        |

The hub refuses `--done` for a proposal whose work runs in a sub-session or
with a new agent. When you close that session, the hub marks the proposal
done.

The three `--status` flags repeat, once for each part, and one command can
mix them. Each flag changes only the part it names. The hub takes them only
for work that you approved and that is not finished, in a command with no
other flag from this section. It refuses `--status-drop` for text that
matches no part, with an error that lists the proposal's parts. A proposal
has at most 20 parts, each at most 80 characters, and `--reopen` clears
them.

## Environment variables

All six are optional.

| Variable                | Default          | Meaning                                                                                                                          |
| ----------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747             | The hub's port on 127.0.0.1. With `0`, the system assigns a free port, as the tests do.                                          |
| `PAIR_HUB_HOST`         | unset            | An extra address for the hub to listen on, such as a Tailscale IP, so you can review on a phone.                                 |
| `PAIR_HUB_IDLE_SECONDS` | 900              | How long the hub keeps running with no live session.                                                                             |
| `PAIR_WAKE`             | on               | With `off`, the hub writes each wake line to its log instead of sending it. pair refuses `off` with the default state directory. |
| `XDG_STATE_HOME`        | `~/.local/state` | pair keeps the sessions and the hub's files in its `pair/` folder.                                                               |
| `XDG_CONFIG_HOME`       | `~/.config`      | pair reads your components, guide files and moment files from its `pair/` folder.                                                |

The hub's browser routes need no token, so the hub only listens on an extra
address when you set `PAIR_HUB_HOST`. The routes that agents use need the
session's bearer token on every address.

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
command that finds no hub at that address, use the hub that their own
environment names, so they need the variables in front of them too.
