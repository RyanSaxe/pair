# Advanced setup

Optional setup beyond installing pair: a launch script for opening new agents,
messaging between agent sessions, custom guide text, and custom components.

## Start agent and pair spawn: the launch script

To let pair open a new agent when you start a proposal with
**With a new agent**, save an executable script at `~/.config/pair/spawn` (or
`spawn.ps1` on Windows). The button then reads **Start agent**. Pressing it with
no message runs:

```text
~/.config/pair/spawn DIR COMMAND ARG…
```

`DIR` is the directory where the session's agent ran `pair start`.
`COMMAND ARG…` starts the same agent CLI with a prompt to run `pair guide` and
`pair start --from` for the proposal. pair passes arguments directly with no
shell between, preserving the prompt intact. The script must launch the command
in a new terminal and exit within 10 seconds. Without a script, Start offers
**Open a new agent session** and **Copy command**.

When you include a message with **Start agent** (such as "claude opus, max
effort"), pair asks the session's agent instead of calling the script directly.
That agent can still run `pair spawn` with the requested CLI flags.

tmux (new window in your running tmux server):

```sh
#!/bin/sh
dir=$1
shift
exec tmux new-window -c "$dir" "$@"
```

macOS Terminal (opens a `.command` file in a new window):

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

Windows (`~/.config/pair/spawn.ps1`, untested on Windows):

```powershell
$dir = $args[0]
$command = (Get-Command $args[1] -CommandType Application | Select-Object -First 1).Source
# Start-Process joins its arguments with spaces, so quote each one.
$arguments = $args | Select-Object -Skip 2 | ForEach-Object {
  '"' + ($_ -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}
Start-Process -FilePath $command -ArgumentList $arguments -WorkingDirectory $dir
```

`pair spawn` calls the same script from any terminal or agent, prints the target
name for `pair message --to`, and forwards flags after `--` to the CLI (see
[`pair spawn`](../reference/commands.md#pair-spawn)):

```console
$ pair spawn codex --dir ~/code/shop --prompt "Fix the failing checkout test." -- -m gpt-5.5
Started shop-3f (Codex) in ~/code/shop. Message it with: pair message --to shop-3f --text "…"
```

## Messaging between agent sessions

`pair message` sends messages between running sessions across Claude Code,
Codex, Copilot CLI, pi, opencode, and Antigravity CLI (see
[Commands](../reference/commands.md)).

```console
$ pair agents
NAME          CLI          DIRECTORY                      BRANCH     ID
fix-login-3f  Claude Code  ~/src/app-worktrees/fix-login  fix-login  claude-code:6f1c2a9e
api-d3        Codex        ~/src/api                      main       codex:0199c1d4

$ pair message --to fix-login-3f --text "The session table now has a revoked_at column."
Sent to fix-login-3f (Claude Code). It reads the message at once if it is idle, and otherwise between the steps of its current turn.
```

A session enters `pair agents` after running any `pair` command. To register
every session at startup, configure a start hook:

| CLI             | Start hook                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | `~/.claude/settings.json`: `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"pair register --hook"}]}]}}`                                                                                                                                                   |
| Codex           | Same JSON in `$CODEX_HOME/hooks.json`. Codex asks once to trust it and runs it on the session's first turn.                                                                                                                                                                 |
| Copilot CLI     | `~/.copilot/hooks/pair.json`: `{"version":1,"hooks":{"sessionStart":[{"type":"command","bash":"pair register --hook","powershell":"pair register --hook","timeoutSec":30}]}}`                                                                                               |
| pi              | None; pair's extension from [Install](../getting-started/install.md) registers each session.                                                                                                                                                                                |
| opencode        | None; pair's plugin from [Install](../getting-started/install.md) registers each session.                                                                                                                                                                                   |
| Antigravity CLI | `~/.gemini/config/hooks.json`: `{"pair-register":{"PreInvocation":[{"type":"command","command":"pair register --hook"}]}}`. On the first turn (and after `agy -c`), `pair register --hook` prints JSON asking the agent to run `pair register`; once listed, it prints nothing. |

Add this snippet to a project's `AGENTS.md` so agents use messaging:

```md
Run `pair register` when you start. To tell another agent something, find it
with `pair agents` and run `pair message --to NAME --text "…"`. Answer every
message with the command at its end, or acknowledge it with the --ack command
there if you have nothing to say. Never answer an acknowledgement.
```

## Your own text in pair's instructions

`pair guide` prints `guide/pair.md`, and session commands print moment files
from `guide/moments/`. If a matching path exists under `~/.config/pair/`, pair
appends your file after its own:

```text
~/.config/pair/
  pair.md                  # after pair's guide
  writing.md               # after pair guide writing.md
  moments/read-thread.md   # after the text pair read prints for a thread
```

Use these files for standing instructions, such as "Use the write-docs skill for
any change to docs/". [guide/moments/](../../guide/moments/) lists every moment
file name.

## Your own components

Place custom page components in `~/.config/pair/components/NAME/` so any page
can use them. A component matching a built-in name overrides it. Run
`pair components` to list all components, and `pair guide components/README.md`
for authoring instructions.
