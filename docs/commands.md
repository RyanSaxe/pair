# Commands

| Command                                            | What it does                                                                                                                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pair guide`, `pair guide NAME`                    | Print the agent's instructions, `guide/pair.md`, or the guide file NAME, such as `round.md`. Each link to another guide file appears as the `pair guide` command for that file. |
| `pair start`, `ack`, `read`, `publish`, `progress` | Run a round through the hub. Each prints the next step and the `pair guide` command for each guide file the step needs.                                                         |
| `pair status`, `pause`, `complete`                 | Print the session's state, pause it, or end it once the action for accepted work is done.                                                                                       |
| `pair build SOURCE.json OUTPUT.html`               | Build a page from its source, or list every structural problem and write nothing.                                                                                               |
| `pair diff BEFORE AFTER OUTPUT.json`               | Write the input for the before-after component from two files.                                                                                                                  |
| `pair check`, `pair check --codex-rules`           | Check storage, loopback and the hub port, or write the Codex allow rule for `pair`.                                                                                             |

`pair check` also reports `components`: the directory `pair build` reads for
your own components, `$XDG_CONFIG_HOME/pair/components` with `~/.config` as
the fallback, how many components it contains and their names, and how many
pair ships. An optional path argument checks storage under that directory
instead of the state directory.

## Environment variables

All three are optional.

| Variable                | Default | Meaning                                                                                   |
| ----------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `PAIR_HUB_PORT`         | 4747    | The hub's fixed port on 127.0.0.1. With `0`, the OS assigns a free port, as the tests do. |
| `PAIR_HUB_HOST`         | unset   | An extra address to bind, such as a Tailscale IP, to review on a phone.                   |
| `PAIR_HUB_IDLE_SECONDS` | 900     | Time with no live session after which the hub exits.                                      |

Browser routes are unauthenticated, which is why the extra address is opt
in. Agent routes require the session's bearer token on every address.
