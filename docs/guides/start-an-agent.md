# Start an agent in a new terminal

When you start a proposal with a new agent, pair can open that agent for
you. Save a launch script for your terminal at `~/.config/pair/spawn` and
make it executable, and Start shows **Start agent** in place of Open a new
agent session.

## tmux

This script opens the agent in a new window of the tmux server you already
run:

```sh
#!/bin/sh
dir=$1
shift
exec tmux new-window -c "$dir" "$@"
```

## macOS Terminal

Terminal runs a `.command` file in a new window, so this script writes one
that starts the agent and deletes itself:

```sh
#!/bin/bash
dir=$1
shift
file=$(mktemp "${TMPDIR:-/tmp}/pair-spawn-XXXXXX")
mv "$file" "$file.command"
file=$file.command
{
  printf '#!/bin/bash\nrm -f %q\ncd %q || exit\nexec' "$file" "$dir"
  printf ' %q' "$@"
  printf '\n'
} > "$file"
chmod +x "$file"
open -a Terminal "$file"
```

## What the script receives

When you press Start agent on the proposal `round-cents` in a Claude Code
session, the hub runs:

```text
~/.config/pair/spawn ~/code/shop claude --name round-cents --session-id 4ed68fab-… "Run pair guide and follow what it prints. Then run pair start --from SESSION --proposal round-cents."
```

| Argument | Value                                                                                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| First    | The folder in which this session's agent ran `pair start`.                                                                   |
| The rest | The command that starts a new session of the same agent CLI, with a prompt to run `pair guide` and then `pair start --from`. |

Each argument arrives on its own, with no shell in between. The script must
open the command in a new terminal and exit within 10 seconds. The script
runs in the hub's environment, which comes from the agent that started the
hub, so open the command in a terminal that has its own environment, as both
scripts above do.

When the script exits with an error, Start shows the error and the hub leaves
the proposal as it was. With `XDG_CONFIG_HOME` set, pair reads the script
from `$XDG_CONFIG_HOME/pair/spawn`.
