# Install

`pair` needs Node 22.23.5 or newer in 22, 24.22.3 or newer in 24, or 26.13.1 or
newer.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill your agent CLI loads
```

## Your agent CLI

Claude Code lists the skill as `/pair`, and Codex lists it as `$pair`.

| Agent CLI       | Setup                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code     | Select Claude Code when `npx skills add` prompts, and keep Symlink.                                                                                                                                                                                                    |
| Codex           | Run `pair setup-codex` once, then restart Codex. `pair start` refuses under Codex until you do. See [Troubleshooting](../troubleshooting.md#codex-asks-to-approve-every-pair-command).                                                                                 |
| Copilot CLI     | Start with `copilot --ui-server` so the hub can wake it. Without that flag, `pair start` prints the restart command.                                                                                                                                                   |
| pi              | Requires pi 0.79.3 or newer. Run `pi install` once with pair's extension, then restart pi. `pair start` prints the full command and path.                                                                                                                              |
| opencode        | Requires opencode 1.17.7 or newer. Add pair's plugin to `"plugin"` in opencode's global config once, then restart opencode: folder `adapters/opencode` on opencode 2, file `adapters/opencode/plugin.js` on opencode 1. `pair start` prints both paths and the config. |
| Antigravity CLI | Requires Antigravity CLI 1.5.6 or newer. Select Antigravity CLI during `npx skills add`. To skip per-command approvals, add `"permissions": {"allow": ["command(pair)"]}` to `~/.gemini/antigravity-cli/settings.json`.                                                |

A `codex exec` run needs permission to run `pair` outside Codex's sandbox before
it starts. The hub can wake `codex exec` only while it is running.

Copilot CLI asks "Allow path access" on the first `pair` command that references
the session directory under `~/.local/state/pair/`. Allow that directory at
startup:

```sh
copilot --ui-server --add-dir ~/.local/state/pair
```

If `XDG_STATE_HOME` is set, pass `$XDG_STATE_HOME/pair` instead. Copilot CLI
1.0.92 has no config setting for allowed directories, so alias both flags. Avoid
`--allow-all-paths`, which disables path checks for every directory.

## Good to know

- `npx skills add` may print
  `✗ pair → PromptScript: PromptScript does not support global skill installation`.
  Ignore it; the skill installs for your selected agents.
- If you already have another skill named `pair`, rename its folder and the
  `name` in its `SKILL.md` first, or `npx skills add` replaces it after asking
  "Proceed with installation?".

## Update

Run `npm update -g @ryansaxe/pair`. You never need to reinstall the skill,
because it only instructs the agent to run `pair guide`, which prints the
installed version's guide.

Close all open sessions before updating from 0.2 to 0.3. Version 0.3 cannot read
side work, offers, or accepted plans stored by earlier versions.
