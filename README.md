# pair

pair is a local application where you and an agent work together in the
browser. The agent publishes pages in rounds. You read them, choose options
and comment on anything, and when you send feedback, the hub wakes the agent
to start the next round. A session can plan a change, build an accepted plan
or help you understand something, and the pages show mocks, diagrams, code
and diffs so you judge by looking.

## Install

pair needs Node 20 or newer. npm installs the application, and the `skills`
installer puts the skill where your agent CLI finds it. pair has no install
command of its own.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill, for Claude Code, Codex and Copilot CLI
```

`npx skills add` always installs the skill to `~/.agents/skills/pair`, which
Codex and Copilot CLI read. If you use Claude Code, select it when the
installer asks which agents to install to, and keep the default installation
method, Symlink. Claude Code then gets a link to that folder in
`~/.claude/skills` and offers the skill as `/pair`.

When `npx skills add` does not ask which agents to install to, it also reports
`✗ pair → PromptScript: PromptScript does not support global skill installation`.
That line is about PromptScript, another agent, and the skill is still
installed.

To update pair, run `npm update -g @ryansaxe/pair`. The skill only tells the
agent to run `pair guide`, which prints the instructions of the installed
version, so the skill never needs reinstalling.

### Codex and Copilot CLI

Codex needs no other step. Invoke the skill there as `$pair`. If Codex asks
you to approve every `pair` command, see [Troubleshooting](#troubleshooting).

Copilot CLI can be woken only when it was started as `copilot --ui-server`.
Version 1.0.86 has no setting that makes this the default, and `--ahp`, which
succeeds `--ui-server`, is behind a feature flag. Start Copilot with
`--ui-server` for any session that uses pair. In a Copilot session started
without it, `pair start` refuses and prints `copilot --ui-server --resume ID`,
which restarts that session so pair can wake it.

### A skill already named pair

If you already have a different skill named pair, rename it first: its folder
and the `name` in its `SKILL.md`. `npx skills add` lists the agents whose pair
skill it would overwrite and asks "Proceed with installation?". If you
proceed, it replaces `~/.agents/skills/pair` and turns `~/.claude/skills/pair`
into a link to it, even when that was a folder. With `-y` it replaces them
without asking.

## Run it from a checkout

pair needs Node 20 or newer and has no dependencies. In a clone of this
repository, `npm link` puts the `pair` command on your path, running the
checkout, so an edit takes effect at the next command:

```sh
npm link
pair start
```

`pair start` starts the hub on `127.0.0.1:4747` if none is running, creates a
session under `~/.local/state/pair/sessions/`, and prints its URL. An agent
runs it from its own shell, because the hub wakes that agent's session when
you send feedback. [guide/setup.md](guide/setup.md) lists the environment
variables, including `PAIR_HUB_PORT`, and what pair keeps on disk.

## Commands

| Command                                            | What it does                                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pair guide`                                       | Print the agent's instructions, `guide/pair.md`, with each link an absolute path. The skill runs it first. |
| `pair start`, `ack`, `read`, `publish`, `progress` | Run a round through the hub. Each prints the next step and names guide files by their absolute path.       |
| `pair status`, `pause`, `complete`                 | Print the session's state, pause it, or end it once the action for accepted work is done.                  |
| `pair build SOURCE.json OUTPUT.html`               | Build a page from its source, or list every structural problem and write nothing.                          |
| `pair diff BEFORE AFTER OUTPUT.json`               | Write the input for the before-after component from two files.                                             |
| `pair check`, `pair check --codex-rules`           | Check storage, loopback and the hub port, or write the Codex allow rule for `pair`.                        |

## Troubleshooting

### Codex asks to approve every pair command

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

## Layout

| Path           | What it holds                                                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/`         | The `pair` command, the hub, the page builder, and the browser frame with its components.                        |
| `guide/`       | What the agent reads while it works: `pair.md` first, `round.md` for each round, and the contracts it builds to. |
| `skills/pair/` | The skill an agent CLI loads. It tells the agent to run `pair guide`.                                            |
| `adapters/`    | One folder per agent CLI, each with a `wake.mjs` that finds and wakes a running session.                         |
| `tests/`       | The test suites, and a fixture page with every component.                                                        |

## Adapters

pair wakes Claude Code, Codex and Copilot CLI, each through its folder under
`adapters/`. A `wake.mjs` exports the CLI's `name`, such as `Codex`, the
`command` its executable is called, the `variables` it gives the commands it
runs, the `unwakeable` message for a session without all of them, and three
functions:

- `detect(env, tools)` returns the wake target for its agent CLI, once the
  CLI has claimed the environment and every one of its `variables` is set.
  `tools.ancestor` is the ancestor process being asked about, or `null` when
  `pair start` asks about the environment variables alone. It throws when
  the session still cannot be woken.
- `identity(target)` returns the part of a wake target that tells one session
  of the CLI from another: the inbox socket, the thread ID or the session ID.
- `wake(target, line, run)` delivers one line to the running session, or
  throws with the reason. `run(file, args)` runs a program and rejects with
  its error output.

`src/hub/wake.mjs` lists the adapters. `pair start` asks every adapter about
each ancestor process, nearest first, and the CLI whose `command` the
ancestor runs claims the environment, so the agent CLI that ran the command
wins over an outer one whose variables it inherited. When no ancestor
decides, the first adapter whose first variable is set claims it.

## Holders and handoff

One agent holds a session: the one that last ran `pair start` on it. The hub
wakes only that agent and refuses a command from any other. The next command
of an agent the session was taken from, `pair start` included, fails with the
time it lost the session. Every command sends the identity of the agent that
runs it, so a subagent works as its parent. Another agent takes a session
over with its handoff line, which the browser shows with Copy after Save for
later and after a failed wake:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

## Offers

A round can carry an offer, which the reviewer accepts in the Finish your
review dialog: `plan` on a complete plan and `finish` on complete work the
agent built. Each entry in `src/shared/offers.mjs` gives the dialog's Accept row and
the hint under Request changes, the page a round must open on when it names
one, and a guide file under `guide/offers/` that tells the agent what each
action asks. Each action's `after` says what the session does once the
reviewer accepts with it: Save for later saves it until an agent runs its
handoff line, Start implementation goes on to the build round, and the finish
actions complete it. The build, the hub and the frame all read this registry, so a
new offer is one entry there and one guide file.

## Development

```sh
node --test
npx prettier@3.9.6 --check .
npx eslint@10.11.0 .
```

CI runs all three on every push and pull request. ESLint fails a JavaScript
file over 1000 lines, and CI also lists each one over 500, the size a file
aims for. The fixture under `tests/fixture/` is a page with every component,
and its [README](tests/fixture/README.md) says how to build it and what to
check in it.
