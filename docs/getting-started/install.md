# Install

`pair` needs Node 20.1.0 or newer.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill your agent CLI loads
```

To update, run `npm update -g @ryansaxe/pair`. The skill never needs
reinstalling. Before you update from 0.2 to 0.3, close every open session,
because 0.3 does not read the side work, offers or accepted plans an earlier
version stored.

## Your agent CLI

Claude Code lists the skill as `/pair`, and Codex as `$pair`.

| Agent CLI   | What it needs                                                                                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | When `npx skills add` asks which agents to install to, select Claude Code and keep Symlink.                                                                                            |
| Codex       | Run `pair setup-codex` once, then restart Codex. `pair start` refuses under Codex until you do. See [Troubleshooting](../troubleshooting.md#codex-asks-to-approve-every-pair-command). |
| Copilot CLI | Start it as `copilot --ui-server`, or the hub cannot wake it. `pair start` prints the command that restarts a session with it.                                                         |
| pi          | pi 0.79.3 or newer. Install pair's extension once with `pi install`, then restart pi. `pair start` prints the command with the extension's path on your machine.                       |
| opencode    | opencode 1.17.7 or newer. Add pair's plugin to `"plugin"` in opencode's global config once, then restart opencode. `pair start` prints the plugin's path and the config file.          |

A `codex exec` run needs permission to run `pair` outside Codex's sandbox
before it starts, and can be woken only while it is still running.

## Good to know

- `npx skills add` may print
  `✗ pair → PromptScript: PromptScript does not support global skill installation`.
  That is about another agent, and the skill is installed.
- If you already have a different skill named pair, rename it first, both
  its folder and the `name` in its `SKILL.md`. Otherwise `npx skills add`
  replaces it after asking "Proceed with installation?".
