# Working on pair

pair is a local web application in which an agent and a reviewer work in
rounds of browser pages. The agent builds pages and publishes them with the
`pair` command, the hub serves them to the browser, and when the reviewer sends
feedback, the hub wakes the agent. [README.md](README.md) covers installing and
using pair. This file covers changing it.

## Development setup

The recommended setup for working on pair is one clone of this repository,
kept on `main` and linked with `npm link`, and a separate git worktree for each
change. `npm link` makes `pair` on the path run the linked clone, so every
agent session on the machine runs that clone's code, and an edit there changes
the next `pair` command of every running session. Those sessions run a change
made in a worktree only after it merges and is pulled into the linked clone.

In a worktree, run that worktree's code as `node src/cli.mjs`, not as `pair`,
because `pair` runs the linked clone. pair has no runtime dependencies and no
build step, so a checkout runs as it is, with no install.

## Modules

An agent runs `pair` commands. `pair build` checks a page source and builds
the page, and the session commands, such as `pair start` and `pair publish`,
send requests to the hub. The hub is one Node process that serves every live
session and stores each session on disk. It joins a round's published pages
with the frame, the browser code that shows a round, into one HTML file. When
the reviewer sends feedback, the frame posts it to the hub, and the hub wakes
the agent through the adapter for the agent's CLI.

Each module has its own folder, and a module's tests are in the folder of the
same name under `tests/`:

- The command, `src/cli.mjs` and `src/cli/`, reads the arguments and runs the
  command. `build`, `diff`, `check` and `guide` run on their own, and each
  session command sends a request to the hub.
- The hub, `src/hub/`, serves the HTTP routes on `127.0.0.1:4747`. A session
  command starts it when none is running, and it exits after 15 minutes with
  no live session. It wakes the holder, the agent that last ran `pair start`
  on a session. `src/hub/session/` has one session's state and actions: its
  rounds, its holder, the reviewer's submissions and uploads, its threads
  and its side work.
- The builder, `src/build/`, turns a page source into a page. `problems()`
  lists every structural problem in a source, and the assembler joins the
  frame, the components and the pages into one HTML file.
- The frame, `src/frame/`, runs in the browser. `app/` starts it and keeps the
  state every other part reads, `pages/` shows the pages and Agreed, `notes/`
  has the code for the reviewer's notes, threads, choices, answers and
  drawings, `review/` is the Review page and sending, and `sync/` reads
  rounds, sessions, activity and notifications from the hub.
- The components, `src/components/`, have one directory each, with the
  `markup.html` that a page author copies and the component's styles and
  behavior.
- The shared modules, `src/shared/`, are the ones that more than one of the
  command, the hub, the builder and the frame import, such as the offer
  registry in `src/shared/offers.mjs`.
- The adapters, `adapters/`, have one folder per agent CLI. Each folder's
  `wake.mjs` finds a running session of that CLI and wakes it.
- The guide, `guide/`, is what the agent reads while it runs a session.
  `pair guide` prints `guide/pair.md`.
- The installed skill, `skills/pair/`, contains the instruction to run
  `pair guide` and follow what it prints. `npx skills add` installs it.
- The repository skills, `.agents/skills/`, are for working on pair. npm and
  `npx skills add` leave them out.

This list names each module's folder and job, not its files, so it stays true
when a file moves within its folder. Change it when a module is added or
removed or its job changes.

## Rules for the code

Keep a file to 500 lines or fewer where you can, and never above 1000. ESLint
checks the length of each JavaScript file with its `max-lines` rule.
`eslint.config.mjs` sets the rule to fail a file over 1000 lines, and CI runs
ESLint a second time with the rule at 500 as a warning, which lists each file
over 500 lines without failing:

```sh
npx --yes eslint@10.11.0 --rule '{"max-lines": ["warn", 500]}' .
```

Frame modules import each other by `#frame/…` and `#shared/…` names. The
browser loads each module of a built page from a `data:` URL behind an import
map, where a relative name such as `./store.mjs` cannot resolve, so a relative
import passes `node --test` and breaks the page. Node resolves the same names
through `imports` in `package.json`. Only `src/frame/app/boot.mjs` touches
`document` when it loads, because a test imports every other frame module in
Node.

`src/build/assemble.mjs` lists the frame's stylesheets in cascade order, so a
new stylesheet goes into that list.

Ask before adding a dependency, because a checkout runs with no install only
while pair has none.

## Checks

CI runs these three on every push and pull request, and a change passes when
all three pass. Use a Node version that `engines.node` in `package.json`
allows.

```sh
node --test
npx --yes prettier@3.9.6 --check .
npx --yes eslint@10.11.0 .
```

Run one file with `node --test tests/hub/server.test.mjs`, and format a file
with `npx --yes prettier@3.9.6 --write PATH`. Prettier skips
`tests/fixture/*.html`, which `.prettierignore` lists, because reflowing breaks
the Mermaid and JSON text in those pages.

## Skills

Read `.agents/skills/test-audit/SKILL.md` before writing, changing or deleting
a test, and when asked to audit the tests.

Read `.agents/skills/writing/SKILL.md` before writing or changing `guide/`,
`skills/pair/`, a line the hub or a command prints, `src/shared/offers.mjs`,
the README, `docs/`, this file or a skill in `.agents/skills/`.

## Tests

A test that starts a hub, runs `pair` or builds a page gives it its own
`XDG_STATE_HOME` and `XDG_CONFIG_HOME` in a temporary directory and
`PAIR_HUB_PORT=0`. With those, no test reaches a running hub or a real
session, and no build bundles the components a developer keeps in
`~/.config/pair/components/`.

Git hands `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` to hooks and to the
commands `git rebase -x` runs, and they override the working directory. A test
that runs git strips every `GIT_*` variable from the environment it gives git.
A test that creates a repository also checks, before it writes anything, that
the repository git ended up in is the one it just created. Without both, a
suite run from `git rebase -x` runs git against this repository.

## Checking the frame in a browser

No test checks how the frame renders or behaves, so open a frame or component
change in a browser before calling it done.

For a component or the way a page renders, build the fixture and open the file:

```sh
fixture_dir=$(mktemp -d)
node tests/fixture/build.mjs "$fixture_dir/fixture.html"
```

Check every fixture page in the light and dark themes, at a wide window and at
375px. The fixture has no hub, so it cannot send feedback.

For anything that talks to the hub, such as sending feedback, the progress
card, rounds, sessions or notifications, run a scratch hub. Give every command
the same new state directory and a free port from 4880 to 4899:

```sh
state=$(mktemp -d)
XDG_STATE_HOME=$state PAIR_HUB_PORT=4880 node src/cli.mjs check
XDG_STATE_HOME=$state PAIR_HUB_PORT=4880 PAIR_HUB_IDLE_SECONDS=60 node src/cli.mjs start
```

`check` must report the hub port as `free`. `start` prints the session's
`sessionDir` and `url`. Build and publish a round in that session as
`guide/round.md` describes, open the URL, and use the change. When you send
feedback there, the hub wakes the agent that ran `start` with a line that names
the scratch session directory. Finish with
`node src/cli.mjs pause --session-dir DIR` under the same variables, and the
hub exits 60 seconds later.

Never use port 4747 or the default state directory, `~/.local/state/pair`.
They belong to the person using pair on this machine: a session started there
shows in their Live sessions, and a hub started there from your checkout serves
their sessions with your code.
