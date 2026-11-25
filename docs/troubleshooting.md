# Troubleshooting

## Codex asks to approve every pair command

Codex sandboxes commands and blocks both network sockets and writes outside your
project. Because `pair` needs both to reach the hub and save session files,
Codex prompts for approval on every `pair` command without an allow rule.
`pair start` refuses under Codex until that rule exists.

Add the rule once in a terminal, or approve when the agent offers to run it:

```sh
pair setup-codex
```

This writes `~/.codex/rules/pair.rules` (or under `CODEX_HOME` if set). Commands
consisting solely of `pair` calls, including calls chained with `&&`, then run
outside the sandbox without prompts. Pipelines such as `pair guide | head -3` do
not match and remain sandboxed.

Restart Codex to load the new rules file. `pair` writes this file only when you
or the agent run `pair setup-codex`.
