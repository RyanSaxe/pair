# pair

pair is a local application where you and an agent work together in the
browser. The agent publishes pages in rounds. You read them, choose options
and comment on anything, and when you send feedback, the hub wakes the agent
to start the next round. A session can plan a change, and the pages show
mocks, diagrams, code and diffs so you judge by looking.

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

| Command                                            | What it does                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pair start`, `ack`, `read`, `publish`, `progress` | Run a round through the hub. Each prints the next step and names guide files by their absolute path. |
| `pair status`, `pause`, `complete`                 | Print the session's state, pause it, or end it once the action for accepted work is done.            |
| `pair build SOURCE.json OUTPUT.html`               | Build a page from its source, or list every structural problem and write nothing.                    |
| `pair diff BEFORE AFTER OUTPUT.json`               | Write the input for the before-after component from two files.                                       |
| `pair check`, `pair check --codex-rules`           | Check storage, loopback and the hub port, or write the Codex allow rule for `pair`.                  |

## Layout

| Path           | What it holds                                                                                   |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `src/`         | The `pair` command, the hub, the page builder, and the browser frame with its components.       |
| `guide/`       | What the agent reads while it works: `round.md` for each round, and the contracts it builds to. |
| `skills/pair/` | The skill an agent CLI loads.                                                                   |
| `adapters/`    | One folder per agent CLI, each with a `wake.mjs` that finds and wakes a running session.        |
| `tests/`       | The test suites, and a fixture page with every component.                                       |

## Adapters

pair wakes Claude Code, Codex and Copilot CLI, each through its folder under
`adapters/`. A `wake.mjs` exports the CLI's `name`, such as `Codex`, and
three functions:

- `detect(env, tools)` returns the wake target for its agent CLI, or `null`
  when the environment belongs to another CLI. `tools.ancestor` is the
  ancestor process being asked about, or `null` when `pair start` asks about
  the environment variables alone. It throws when the environment is its CLI's
  but the session cannot be woken.
- `identity(target)` returns the part of a wake target that tells one session
  of the CLI from another: the inbox socket, the thread ID or the session ID.
- `wake(target, line, run)` delivers one line to the running session, or
  throws with the reason. `run(file, args)` runs a program and rejects with
  its error output.

`src/session.mjs` lists the adapters. `pair start` asks every adapter about
each ancestor process, nearest first, so the agent CLI that ran the command
wins over an outer one whose variables it inherited. When no ancestor
decides, the first adapter whose variables are set decides.

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
review dialog: `plan` on a complete plan and `finish` on built work that is
complete. Each entry in `src/offers.mjs` gives the dialog's Accept row and
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
```

CI runs both on every push and pull request. The fixture under `tests/fixture/`
is a page with every component, and its [README](tests/fixture/README.md) says
how to build it and what to check in it.
