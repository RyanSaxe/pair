# Advanced setup

Optional setup for pair beyond installing it: a launch script that opens a
new agent for you, messaging between agent sessions, your own text in pair's
instructions, and your own components.

## Start agent and pair spawn: the launch script

When you press Start on a proposal and choose With a new agent, pair can open
that agent for you. Save an executable script at `~/.config/pair/spawn`, or
`spawn.ps1` on Windows, and the button reads Start agent. Pressing it with no
message runs:

```text
~/.config/pair/spawn DIR COMMAND ARG…
```

`DIR` is the folder where your agent ran `pair start`. `COMMAND ARG…` starts
the same agent CLI with a prompt to run `pair guide` and then
`pair start --from` for the proposal. pair passes each part as its own
argument, with no shell between, so the script receives the prompt exactly as
pair wrote it. The script must open the command in a new terminal and exit
within 10 seconds. Without a script, Start offers Open a new agent session
and Copy command.

With a message, Start agent asks your session's agent to start the new agent
instead, so a message such as “claude opus, max effort” starts it in that CLI
with those settings. The agent can start it with `pair spawn`, which runs the
same script with the CLI's flags for those settings.

tmux, in a new window of the tmux server you already run:

```sh
#!/bin/sh
dir=$1
shift
exec tmux new-window -c "$dir" "$@"
```

macOS Terminal, which runs a `.command` file in a new window:

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

Windows, in a new console window, as `~/.config/pair/spawn.ps1`. No one has
run this example on Windows yet:

```powershell
$dir = $args[0]
$command = (Get-Command $args[1] -CommandType Application | Select-Object -First 1).Source
# Start-Process joins its arguments with spaces, so quote each one.
$arguments = $args | Select-Object -Skip 2 | ForEach-Object {
  '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}
Start-Process -FilePath $command -ArgumentList $arguments -WorkingDirectory $dir
```

`pair spawn` runs the same script from a terminal or from an agent, and
prints the name that `pair message --to` takes. It passes the arguments after
`--` to the CLI, as [`pair spawn`](../reference/commands.md#pair-spawn)
describes:

```console
$ pair spawn codex --dir ~/code/shop --prompt "Fix the failing checkout test." -- -m gpt-5.5
Started shop-3f (Codex) in ~/code/shop. Message it with: pair message --to shop-3f --text "…"
```

## Messaging between agent sessions

`pair message` lets an agent in Claude Code, Codex, Copilot CLI, pi or
opencode message a running session of any of them.
[Commands](../reference/commands.md) describes `pair register`, `pair agents`
and `pair message`.

```console
$ pair agents
NAME          CLI          DIRECTORY                      BRANCH     ID
fix-login-3f  Claude Code  ~/src/app-worktrees/fix-login  fix-login  claude-code:6f1c2a9e
api-d3        Codex        ~/src/api                      main       codex:0199c1d4

$ pair message --to fix-login-3f --text "The session table now has a revoked_at column."
Sent to fix-login-3f (Claude Code). It reads the message at once if it is idle, and otherwise between the steps of its current turn.
```

A session appears in `pair agents` once a `pair` command runs inside it. To
list every session as it starts, add the start hook for each CLI you use:

| CLI         | Start hook                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | In `~/.claude/settings.json`: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"pair register --hook"}]}]}}`                                                     |
| Codex       | The same JSON in `$CODEX_HOME/hooks.json`. Codex asks you once to trust it, and runs it when a session's first turn starts.                                                      |
| Copilot CLI | In `~/.copilot/hooks/pair.json`: `{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"pair register --hook","powershell":"pair register --hook","timeoutSec":30}]}}` |
| pi          | None. pair's extension, which [Install](../getting-started/install.md) sets up, registers each session.                                                                          |
| opencode    | None. pair's plugin, which [Install](../getting-started/install.md) sets up, registers each session.                                                                             |

Add this to a project's `AGENTS.md` so its agents use pair's messaging:

```md
Run `pair register` when you start. To tell another agent something, find it
with `pair agents` and run `pair message --to NAME --text "…"`. Answer every
message with the command at its end, or acknowledge it with the --ack command
there if you have nothing to say. Never answer an acknowledgement.
```

## Your own text in pair's instructions

pair prints its instructions to the agent from the files in its `guide/`
folder: `pair guide` prints `guide/pair.md`, and each command prints the file
of its moment from `guide/moments/`. When `~/.config/pair/` has a file with the
same path, pair prints yours after its own:

```text
~/.config/pair/
  pair.md                  # after pair's guide
  writing.md               # after pair guide writing.md
  moments/read-thread.md   # after the text pair read prints for a thread
```

Write what you want every session to do, such as "Use the write-docs skill for
any change to docs/". [guide/moments/](../../guide/moments/) has every moment's
file name.

## Your own components

A component is a block a page can use, such as a decision or a diagram. Put
your own in `~/.config/pair/components/NAME/`, and every page you build can use
it. A component with the same name as one of pair's replaces it.
`pair components` lists both, and `pair guide components/README.md` prints how
to write one.
