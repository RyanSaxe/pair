# Contributing

## Run it from a checkout

pair needs Node 20.1.0 or newer. It has no runtime dependencies and no build
step, so you can run a checkout as it is. In a clone of this repository,
`npm link` puts the `pair` command on your path, and that command then runs the
clone's code. An edit in the clone takes effect at the next `pair` command, in
every agent session on your machine.

```sh
npm link
pair start --title "Try pair"
```

`pair start` starts the hub on `127.0.0.1:4747` if none is running, creates
a session under `~/.local/state/pair/sessions/`, and prints the session's
directory and URL. Run it from an agent's shell. In a plain terminal,
`pair start` refuses, because the hub needs an agent to wake when you send
feedback. [Commands](../reference/commands.md#environment-variables) lists
the environment variables, including `PAIR_HUB_PORT`, and
[Architecture](../concepts/architecture.md#storage) says what pair stores on
disk.

To work on a change without changing the code your sessions run, keep the
linked clone on `main` and make each change in a separate git worktree. In a
worktree, run `node src/cli.mjs` in place of `pair`.
[AGENTS.md](../../AGENTS.md) describes this setup, and how to check a change
in the browser against a scratch hub with its own port and state directory.

## Layout

| Path              | Contents                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/`            | The `pair` command, the hub, the page builder, and the browser frame with its components.                      |
| `guide/`          | What the agent reads while it works: the core, `pair.md`, the moments in `moments/`, and the reference files.  |
| `skills/pair/`    | The skill an agent CLI loads. It tells the agent to run `pair guide`, then to follow what each command prints. |
| `adapters/`       | One folder per agent CLI, each with a `wake.mjs` that finds and wakes a running session of that CLI.           |
| `tests/`          | The test suites, the browser tests in `tests/browser/`, and a fixture page with every component.               |
| `docs/`           | These pages, with their pictures in `docs/assets/`.                                                            |
| `assets/`         | The README's logo and screenshots. `npm run screenshots` writes the screenshots.                               |
| `scripts/`        | The script that `npm run screenshots` runs, and the demo session it stages.                                    |
| `.agents/skills/` | The skills an agent reads when it changes pair. npm and `npx skills add` leave them out.                       |

[AGENTS.md](../../AGENTS.md) names the modules inside `src/` and the rules an
agent follows when it changes them.

## Checks

```sh
node --test
npx --yes prettier@3.9.6 --check .
npx --yes eslint@10.11.0 .
npm run test:browser
```

CI runs all four on every push and pull request. ESLint reports an error for a
JavaScript file over 1000 lines, and CI also lists each file over 500 lines, the
size a file should stay under where it can.

The fixture under `tests/fixture/` is a page with every component, and its
[README](../../tests/fixture/README.md) says how to build it and what to check
in it.

## Browser tests

The browser tests open built pages in the installed Google Chrome through
`playwright-core`, a devDependency. `npm install -g` skips devDependencies,
so an installed `pair` has no `playwright-core`. Run `npm ci` once in a
checkout before the first run. Without Google Chrome, a browser test skips.
When the `CI` environment variable is set, as it is in GitHub Actions, the
test fails instead.

`npm run test:figures` checks that every figure in the fixture renders. CI
runs it in a separate `figures` job, because a figure whose library loads
from esm.sh or jsDelivr fails the test while that CDN is down.

## Screenshots

`npm run screenshots` writes the README's and the docs' PNGs from a demo
session, in Google Chrome through the same `playwright-core`. It only runs
on macOS, because the frame uses the system font, and lines break in other
places on another system.

### The screenshots workflow

The `screenshots` workflow runs the script on GitHub's macOS 26 runner for a
pull request into a branch other than `main` that changes any of these:

- `src/frame/`
- `src/components/`
- `scripts/screenshots.mjs`
- `scripts/screenshots/`
- `scripts/demo/`

The workflow pushes the PNGs that the script rewrote to the pull request's
branch, as a commit by `github-actions[bot]`. The illustration's terminal
shows IDs that each run creates anew, so the workflow pushes one of these
commits after every push to such a pull request.

Pull that commit before you push again. GitHub only runs the checks on that
commit after someone with write access selects **Approve workflows to run**
on the pull request.

When the script fails, it saves a screenshot and the console log of each of
its browser windows in `screenshots-failure/`, and the workflow uploads that
directory as an artifact of the run.

The workflow runs the script for a pull request from a fork, but pushes no
commit to it. For a fork's pull request, and for a change elsewhere that
alters a screenshot, run `npm run screenshots` yourself and commit the PNGs
it rewrites.

## Releasing

After every merge into `main`, the release workflow publishes a new version
of `@ryansaxe/pair` to npm, unless the pull request has the `skip-release`
label.

- Pull requests go to `develop`, the default branch. The workflow publishes
  nothing from `develop`, so iterate there.
- A pull request from `develop` into `main` is a release. GitHub only merges
  a pull request into `main` when its checks pass.
- When such a pull request merges, the release workflow runs the tests,
  publishes the next version with npm's trusted publishing, and creates the
  `v` tag and a GitHub release with generated notes.

| Label on the pull request into `main` | Version           |
| ------------------------------------- | ----------------- |
| none                                  | 0.1.4 → 0.1.5     |
| `minor`                               | 0.1.4 → 0.2.0     |
| `major`                               | 0.1.4 → 1.0.0     |
| `skip-release`                        | nothing published |

npm keeps the version numbers, so `package.json` in the repository stays at
`0.0.0-development`, and the release workflow never commits to `main`.
