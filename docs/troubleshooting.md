# Troubleshooting

## Codex asks to approve every pair command

Codex runs each command in a sandbox that blocks network sockets and writes
outside your project. `pair` needs both to reach its hub and to save the
session, so without an allow rule for `pair`, Codex asks you to approve every
`pair` command. `pair start` refuses to run under Codex until the rule exists,
and prints an instruction for the agent to ask you for it.

To add the rule, run this once in a terminal, or say yes when the agent asks
to run it:

```sh
pair setup-codex
```

The command writes the rule to `~/.codex/rules/pair.rules`, or to the same
file under `CODEX_HOME` when you set that variable. With the rule, Codex
runs a command made only of `pair` calls outside the sandbox on its first
try, with nothing for you to approve. That includes several `pair` calls
joined with `&&`. A pipeline such as `pair guide | head -3` does not match
the rule, so Codex still runs it in the sandbox.

Codex only reads its rules when it starts, so restart Codex after you run
`pair setup-codex`. `pair` only writes this file when you or the agent run
`pair setup-codex`.
