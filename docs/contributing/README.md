# Contributing

## Run it from a checkout

pair needs Node 22.23.5 or newer in 22, 24.22.3 or newer in 24, or 26.13.1 or
newer. It has no runtime dependencies and no build step. Run `npm link` in a
clone to put that clone's `pair` on your PATH; edits take effect on the next
`pair` command in every session. Once changes under `src/` and `adapters/` are
committed, the next session command (such as `pair status`) replaces the running
hub with the new code even while sessions are live.

```sh
npm link
pair start --title "Try pair"
```

Run `pair start` from an agent's shell (plain terminals fail because no agent
CLI exists to wake). It starts the hub on `127.0.0.1:4747` if needed, creates a
session under `~/.local/state/pair/sessions/`, and prints the directory and URL.
See [Commands](../reference/commands.md#environment-variables) for environment
variables (including `PAIR_HUB_PORT`) and
[Architecture](../concepts/architecture.md#storage) for disk layout.

To develop without affecting live sessions, keep the linked clone on `main` and
work in a separate git worktree using `node src/cli.mjs` instead of `pair`.
[AGENTS.md](../../AGENTS.md) details scratch hubs and browser verification.

## Layout

| Path              | Contents                                                                              |
| ----------------- | ------------------------------------------------------------------------------------- |
| `src/`            | CLI (`pair`), hub, page builder, and browser frame with its components.               |
| `guide/`          | Agent instructions: core (`pair.md`), moments (`moments/`), and reference files.      |
| `skills/pair/`    | Installed agent skill that instructs the agent to run `pair guide`.                   |
| `adapters/`       | One folder per agent CLI, each with a `wake.mjs` adapter.                             |
| `tests/`          | Unit tests, browser tests (`tests/browser/`), and the all-components fixture page.    |
| `docs/`           | Documentation and its assets (`docs/assets/`).                                        |
| `assets/`         | README logo and screenshots (`npm run screenshots` generates the PNGs).               |
| `scripts/`        | Screenshot generator and its demo session.                                            |
| `.agents/skills/` | Internal skills for developing pair (excluded from npm and `npx skills add`).         |

[AGENTS.md](../../AGENTS.md) lists modules inside `src/` and code rules.

## Checks

```sh
prek run --all-files
node --test
npm run test:browser
```

CI runs all three in `.github/workflows/check.yml`. Run `npm ci` and
`prek install` once in a checkout to install `oxfmt`, `oxlint`, and
`playwright-core`.

`tests/fixture/` builds a page showing every component; see its
[README](../../tests/fixture/README.md).

## Browser tests

Browser tests open built pages in Chrome for Testing via `playwright-core` (a
devDependency, skipped by `npm install -g`). Run `npm ci` and
`npx playwright-core install chromium` once before your first run. Without
Chrome for Testing, tests skip locally and fail when `CI` is set.

`npm run test:figures` checks that every figure in the fixture renders. CI runs
it in a separate `figures` job because CDN outages (esm.sh or jsDelivr) fail
those figures.

## Screenshots

`npm run screenshots` regenerates the README and docs PNGs from a demo session
in Chrome for Testing. It runs only on macOS because the frame uses the system
font and line breaks differ on other platforms.

### The screenshots workflow

For PRs not targeting `main`, `.github/workflows/screenshots.yml` runs on
GitHub's `macos-26` runner whenever a change touches `src/frame/`,
`src/components/`, `scripts/screenshots.mjs`, `scripts/screenshots/`, or
`scripts/demo/`.

The script fixes the clock, normalizes IDs, waits for layout to settle, and
ignores faint edge-pixel noise, so `github-actions[bot]` commits only changed
PNGs to the PR branch. Pull that commit before pushing again; someone with write
access must click **Approve workflows to run** so CI checks the bot's commit. On
failure, the job uploads `screenshots-failure/` as an artifact.

Fork PRs run the script without pushing (read-only token); for fork PRs or
changes outside those paths that alter screenshots, run `npm run screenshots` on
macOS and commit the updated PNGs yourself.

## Releasing

Merging into `main` publishes `@ryansaxe/pair` to npm unless the PR carries the
`skip-release` label.

- Target feature PRs at `develop`, the default branch (no publish happens
  there).
- Open a PR from `develop` into `main` to release. Before opening it, bump each
  Node floor in `engines.node` to the latest security release and update
  `package-lock.json`, the `test` matrix in `.github/workflows/check.yml`, the
  `main`/`develop` rulesets, `README.md`, `docs/`, and `guide/setup.md`.
- On merge to `main`, the release workflow runs tests, publishes via npm trusted
  publishing, and creates the `v` tag and GitHub release.
- Once `main` checks pass, the sync workflow fast-forwards `develop` to `main`.
  If new PRs already merged into `develop`, it catches up on the next release
  (or run `gh workflow run sync-develop.yml`).

| PR label into `main` | Version           |
| -------------------- | ----------------- |
| none                 | 0.1.4 → 0.1.5     |
| `minor`              | 0.1.4 → 0.2.0     |
| `major`              | 0.1.4 → 1.0.0     |
| `skip-release`       | nothing published |

The workflow calculates the next version from npm, so `package.json` stays at
`0.0.0-development` and the workflow never commits to `main`.
