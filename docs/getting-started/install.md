# Install

`pair` needs Node 20.1.0 or newer.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill your agent CLI loads
```

To update, run `npm update -g @ryansaxe/pair`. You never need to reinstall
the skill, because the skill only tells the agent to run `pair guide`, which
prints the instructions of the `pair` you have installed.

Before you update from 0.2 to 0.3, close every open session. Version 0.3
cannot read the side work, offers or accepted plans that earlier versions
stored.

## Your agent CLI

Claude Code lists the skill as `/pair`, and Codex as `$pair`.

| Agent CLI   | What it needs                                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | When `npx skills add` asks which agents to install to, select Claude Code and keep Symlink.                                                                                                   |
| Codex       | Run `pair setup-codex` once, then restart Codex. `pair start` refuses to run under Codex until you do. See [Troubleshooting](../troubleshooting.md#codex-asks-to-approve-every-pair-command). |
| Copilot CLI | Start it as `copilot --ui-server`, or the hub cannot wake it. When you started it without that flag, `pair start` prints the command that restarts your Copilot session with it.              |
| pi          | pi 0.79.3 or newer. Install pair's extension once with `pi install`, then restart pi. `pair start` prints the full command, with the extension's path on your machine.                        |
| opencode    | opencode 1.17.7 or newer. Add pair's plugin to `"plugin"` in opencode's global config once, then restart opencode. `pair start` prints the plugin's path and the config file to add it to.    |

A `codex exec` run needs permission to run `pair` outside Codex's sandbox
before it starts. The hub can only wake a `codex exec` run while it is
still running.

## Good to know

- `npx skills add` may print
  `✗ pair → PromptScript: PromptScript does not support global skill installation`.
  That message is about another agent, and the skill is still installed.
- If you already have a different skill named pair, rename it first, both
  its folder and the `name` in its `SKILL.md`. Otherwise `npx skills add`
  replaces it after it asks "Proceed with installation?".
