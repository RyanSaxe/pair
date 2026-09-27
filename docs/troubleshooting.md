# Troubleshooting

## Codex asks to approve every pair command

Codex runs commands in a sandbox that blocks pair's hub. With Codex's default
approval, a `pair` command the sandbox blocks runs again outside the sandbox
without asking. If Codex asks you to approve every `pair` command instead, run
this once in a terminal:

```sh
pair check --codex-rules
```

It writes `~/.codex/rules/pair.rules`, which allows `pair`. A command made only
of `pair` calls, including several joined with `&&`, then runs outside the
sandbox on its first try, with no retry and nothing to approve. A pipeline
such as `pair guide | head -3` does not match the rule and still runs in the
sandbox. Codex reads its rules when it starts, so restart Codex afterwards.
pair never writes this file on its own.
