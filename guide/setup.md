# Check the environment

pair requires Node 20.1.0 or newer and has no dependencies. `pair start`
checks what a session needs and refuses with the reason: Node too old, the
hub port taken by another program, storage it cannot write, or a sandbox
that blocks the hub. If Node is unavailable or too old, explain the
requirement and ask the reviewer how they want to provide it.

When `pair start` or another command fails, run `pair check`. It checks each
part on its own: that session storage is writable, that a local HTTP
endpoint works and which process owns the hub port. It reports the port as
`free`, `hub` (with the running hub's code version and live session count)
or `busy` (another program owns it).

## Sandboxes

The hub needs a writable state directory and a listener on loopback. If the
sandbox blocks either operation, allow the `pair` command. Do not switch to
a different state directory. A session under a temp directory is invisible
to other sessions and to the hub on the fixed port.

- Codex: the sandbox blocks both operations. The first `pair` command fails
  with an error that names the sandbox, and Codex runs it again with
  approval. Codex's approval reviewer may grant that retry without a prompt.
  Run `pair check --codex-rules` once outside the sandbox. It writes
  `~/.codex/rules/pair.rules`, a separate file that contains only pair's
  allow rule. A command that matches it runs outside the sandbox on the
  first try with nothing to approve. Codex reads the file when it starts, so
  the current session still fails once on each `pair` command until Codex
  restarts. `pair check` reports whether the file is present.
- Claude Code: nothing in auto mode. Otherwise allow the `pair` command in
  the permission settings.
- Copilot CLI: nothing beyond the allow flags the session already needs.

## A submission that did not wake you

When the reviewer says in chat that a submission did not reach you, run
`pair ack`, which prints the next step. `pair status` shows the last wake
under `wake.last`, with `ok` and, when the wake failed, the `reason`.
