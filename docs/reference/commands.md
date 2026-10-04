# Commands

`pair --help` lists every command with its purpose, and `pair COMMAND --help`
prints a command's usage and flags and runs nothing. `pair --version` prints
the version.

| Command                                                   | What it does                                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair guide`, `pair guide FILE`                           | Print the agent's instructions, `guide/pair.md`, or the guide file FILE, such as `pages.md`, a moment such as `moments/read-thread.md`, or a component's markup, `components/NAME/markup.html`. |
| `pair components`                                         | List every component, pair's and yours, with its use and the `pair guide` command that prints its markup.                                                                                       |
| `pair start --title TEXT`, `pair start --session-dir DIR` | Start a session with a title, or resume or take over one. Prints the session's directory and URL.                                                                                               |
| `pair read`, `pair read --thread ID`                      | Print the reviewer's next submission and the threads since the last one, or one thread, and mark it read. `--submission ID` prints a past submission again.                                     |
| `pair progress --page ID --note TEXT`                     | Report a page started, a note on a page, or, without `--page`, a note on the round. The progress card shows each report.                                                                        |
| `pair publish --file HTML`                                | Publish a built page. A round's first publish is Agreed, with `--pages`.                                                                                                                        |
| `pair reply --thread ID --text TEXT`, or `--file HTML`    | Post the agent's reply in a thread: text, or an HTML fragment that `pair build`'s page checks accept.                                                                                           |
| `pair status`, `pause`                                    | Print the session's state, or pause it.                                                                                                                                                         |
| `pair build SOURCE.json OUTPUT.html`                      | Build a page from its source, or list every structural problem, including a field pair does not know, and write nothing.                                                                        |
| `pair diff BEFORE AFTER OUTPUT.json`                      | Write the input for the before-after component from two files.                                                                                                                                  |
| `pair check`                                              | Check Node, storage, loopback, the hub port and Codex's rules file, one line each.                                                                                                              |
| `pair setup-codex`                                        | Write the Codex allow rule for `pair` to `~/.codex/rules/pair.rules`, which `pair start` requires under Codex.                                                                                  |

Every session command takes `--session-dir DIR`, except `pair start` when it
creates a session. Each command prints the next step first, then the
moment's text, then its result, with the reviewer's words inside `pair_`
tags. `--json` prints the result as one JSON object instead. A session
command whose text is over 10,000 bytes writes it to a file in the session's
`output/` directory and prints the file's path.

## Environment variables

All six are optional.

| Variable                | Default          | Meaning                                                                                                               |
| ----------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747             | The hub's fixed port on 127.0.0.1. With `0`, the OS assigns a free port, as the tests do.                             |
| `PAIR_HUB_HOST`         | unset            | An extra address to bind, such as a Tailscale IP, to review on a phone.                                               |
| `PAIR_HUB_IDLE_SECONDS` | 900              | Time with no live session after which the hub exits.                                                                  |
| `PAIR_WAKE`             | on               | With `off`, the hub writes each wake line to its log instead of sending it. Refused with the default state directory. |
| `XDG_STATE_HOME`        | `~/.local/state` | Sessions and the hub's files are in its `pair/` folder.                                                               |
| `XDG_CONFIG_HOME`       | `~/.config`      | Your components, guide files and moment files are in its `pair/` folder.                                              |

Browser routes are unauthenticated, which is why the extra address is opt
in. Agent routes require the session's bearer token on every address.
