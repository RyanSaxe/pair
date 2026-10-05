# Setup

pair needs Node 20.1.0 or newer and has no dependencies. `pair start`
checks what a session needs and refuses with the reason: Node too old, the
hub port taken by another program, storage it cannot write, or a sandbox
that blocks the hub. If Node is missing or too old, tell the reviewer that
pair needs Node 20.1.0 or newer, and ask how they want to install it.

When `pair start` or another command fails, run `pair check`. It prints one
line for each thing a session needs: the Node version, whether it can write
session storage, whether 127.0.0.1 answers, whether the hub port is free,
in use by a pair hub or in use by another program, and, when Codex is
installed, whether Codex's rules file matches pair's rule.

## Sandboxes

The hub needs to write its state directory and listen on 127.0.0.1. If a
sandbox blocks either, allow the `pair` command to run outside it. Do not
switch to a different state directory, because the hub on the usual port
cannot find a session stored anywhere else.

- Under Codex, the sandbox blocks both. The first `pair` command fails with
  an error that names the sandbox, and Codex asks for approval to run it
  again outside the sandbox. Codex may approve that retry by itself.
  `pair start` refuses under Codex until `~/.codex/rules/pair.rules`
  exists. With the reviewer's permission, run `pair setup-codex` once
  outside the sandbox. It writes that file, which contains only pair's
  allow rule, so a `pair` command then runs outside the sandbox on the
  first try. Codex reads the file when it starts, so ask the reviewer to
  restart Codex.
- Under Claude Code in auto mode, nothing is needed. In any other mode,
  allow the `pair` command in the permission settings.
- Under Copilot CLI, pi and opencode, nothing is needed beyond the allow
  flags the session already uses.

## When feedback did not wake you

When the reviewer says in the chat that their feedback did not reach you,
run `pair read`, which prints it and the next step. `pair status` prints
the holder and the last wake, with the reason if the wake failed.
