# Install

pair needs Node 20.1.0 or newer. npm installs the application, and the
`skills` installer puts the skill where your agent CLI finds it. pair has no
install command of its own.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill, for Claude Code, Codex and Copilot CLI
```

`npx skills add` always installs the skill to `~/.agents/skills/pair`, which
Codex and Copilot CLI read. If you use Claude Code, select it when the
installer asks which agents to install to, and keep the default installation
method, Symlink. Claude Code then gets a link to that folder in
`~/.claude/skills` and lists the skill as `/pair`.

When `npx skills add` does not ask which agents to install to, it also reports
`✗ pair → PromptScript: PromptScript does not support global skill installation`.
That line is about PromptScript, another agent, and the skill is still
installed.

## Update

Run `npm update -g @ryansaxe/pair`. The skill's one instruction is to run
`pair guide`, which prints the instructions of the installed version, so the
skill never needs reinstalling.

## Codex and Copilot CLI

Codex needs no other step. Invoke the skill there as `$pair`. If Codex asks
you to approve every `pair` command, see
[Troubleshooting](troubleshooting.md#codex-asks-to-approve-every-pair-command).

A `codex exec` run needs permission to run `pair` commands outside Codex's
sandbox before it starts, because the sandbox blocks the hub. The hub can wake
a `codex exec` run only while it is still running. After the run exits,
`codex queue` still succeeds, so `pair status` reports the wake as ok, and the
progress card shows "Waiting for the agent" with no handoff line.

Copilot CLI can be woken only when it was started as `copilot --ui-server`.
Version 1.0.86 has no setting that makes this the default, and `--ahp`, which
succeeds `--ui-server`, is behind a feature flag. Start Copilot with
`--ui-server` for any session that uses pair. In a Copilot session started
without it, `pair start` refuses and prints `copilot --ui-server --resume ID`,
which restarts that session so pair can wake it.

## A skill already named pair

If you already have a different skill named pair, rename it first: its folder
and the `name` in its `SKILL.md`. `npx skills add` lists the agents whose pair
skill it would overwrite and asks "Proceed with installation?". If you
proceed, it replaces `~/.agents/skills/pair` and turns `~/.claude/skills/pair`
into a link to it, even when that was a folder. With `-y` it replaces them
without asking.
