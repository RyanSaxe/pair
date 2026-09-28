# Contributing

## Run it from a checkout

pair needs Node 20.1.0 or newer and has no dependencies. In a clone of this
repository, `npm link` puts the `pair` command on your path, running the
checkout, so an edit takes effect at the next command:

```sh
npm link
pair start
```

`pair start` starts the hub on `127.0.0.1:4747` if none is running, creates a
session under `~/.local/state/pair/sessions/`, and prints its URL. An agent
runs it from its own shell, because the hub wakes that agent's session when
you send feedback.
[Commands](../reference/commands.md#environment-variables) lists the
environment variables, including `PAIR_HUB_PORT`, and
[Architecture](../concepts/architecture.md#storage) says what pair keeps on
disk.

## Layout

| Path              | Contents                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/`            | The `pair` command, the hub, the page builder, and the browser frame with its components.                        |
| `guide/`          | What the agent reads while it works: `pair.md` first, `round.md` for each round, and the contracts it builds to. |
| `skills/pair/`    | The skill an agent CLI loads. Its one instruction is to run `pair guide`.                                        |
| `adapters/`       | One folder per agent CLI, each with a `wake.mjs` that finds and wakes a running session.                         |
| `tests/`          | The test suites, and a fixture page with every component.                                                        |
| `docs/`           | These pages.                                                                                                     |
| `assets/`         | The README's screenshots.                                                                                        |
| `.agents/skills/` | The skills an agent reads when it changes pair. npm and `npx skills add` leave them out.                         |

[AGENTS.md](../../AGENTS.md) names the modules inside `src/` and the rules an
agent follows when it changes them.

## Development

```sh
node --test
npx prettier@3.9.6 --check .
npx eslint@10.11.0 .
```

CI runs all three on every push and pull request. ESLint fails a JavaScript
file over 1000 lines, and CI also lists each one over 500, the size a file
aims for. The fixture under `tests/fixture/` is a page with every component,
and its [README](../../tests/fixture/README.md) says how to build it and what
to check in it.

## Releasing

Every merge into `main` publishes a new version of `@ryansaxe/pair` to npm.

- Pull requests go to `develop`, the default branch. Nothing publishes from it,
  so iterate there.
- A pull request from `develop` into `main` is a release. `main` takes only
  pull requests whose checks pass.
- When it merges, the release workflow runs the tests, publishes the next
  version with npm's trusted publishing, and creates the `v` tag and GitHub
  release with generated notes.

| Label on the pull request into `main` | Version           |
| ------------------------------------- | ----------------- |
| none                                  | 0.1.4 → 0.1.5     |
| `minor`                               | 0.1.4 → 0.2.0     |
| `major`                               | 0.1.4 → 1.0.0     |
| `skip-release`                        | nothing published |

npm holds the versions, so `package.json` in the repository stays at
`0.0.0-development`, and the workflow never commits to `main`.
