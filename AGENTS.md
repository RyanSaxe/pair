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
  command. `build`, `diff`, `check`, `setup-codex`, `guide` and `components`
  run on their own, and each session command sends a request to the hub.
- The hub, `src/hub/`, serves the HTTP routes on `127.0.0.1:4747`. A session
  command starts it when none is running, and it exits after 15 minutes with
  no live session. It wakes the holder, the agent that last ran `pair start`
  on a session. `src/hub/session/` has one session's state and actions: its
  rounds, its holder, the reviewer's submissions and uploads, its threads,
  its proposals and their plans, and its link to the session it came from.
- The builder, `src/build/`, turns a page source into a page. `problems()`
  lists every structural problem in a source, and the assembler joins the
  frame, the components and the pages into one HTML file.
- The frame, `src/frame/`, runs in the browser. `app/` starts it and keeps the
  state every other part reads, `pages/` shows the pages, Agreed, Work and
  the home view of a session with nothing published, `notes/` has the code for the
  reviewer's notes, threads, choices, answers and drawings, `review/` is the
  Review page and sending, and `sync/` reads rounds, sessions, activity and
  notifications from the hub.
- The components, `src/components/`, have one directory each, with the
  `markup.html` that a page author copies and the component's styles and
  behavior.
- The shared modules, `src/shared/`, are the ones that more than one of the
  command, the hub, the builder and the frame import, such as
  `src/shared/choices.mjs`, which writes a reviewer's choice as text.
- The adapters, `adapters/`, have one folder per agent CLI. Each folder's
  `wake.mjs` finds a running session of that CLI and wakes it. For a CLI
  that takes no message from another process, the folder also contains the
  code that runs inside the CLI and listens for the hub's wake on a socket.
- The guide, `guide/`, is what the agent reads while it runs a session.
  `pair guide` prints `guide/pair.md`, and each command prints the text of
  the moment it names, from `guide/moments/`, after its next step.
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

Text under `guide/` and in `skills/pair/` tells the agent only what it acts
on. Never write how the frame shows something to the reviewer, such as which
tab lists an item, what a card or a fold shows, or which color marks a
state, unless the agent must act on it, and then write the action, not the
display. Never give a reason for what the reviewer does, because pair cannot
know it. Leave out any other sentence the agent cannot act on, such as a
requirement that every session already meets. The agent reads each sentence
as an instruction, and it cannot follow one about the display or the
reviewer's motives.

Text the agent reads, under `guide/`, in `skills/pair/` and in
`src/components/README.md`, names another file by the command that prints
it, written literally, such as ``run `pair guide writing.md` ``, and never by
a Markdown link, because `pair guide` prints a file as it is and the agent
cannot resolve a relative path.

## Checks

CI runs these four on every push and pull request, and a change passes when
all four pass. Use a Node version that `engines.node` in `package.json`
allows.

```sh
node --test
npx --yes prettier@3.9.6 --check .
npx --yes eslint@10.11.0 .
npm run test:browser
```

`npm run test:browser` opens built pages in the installed Google Chrome
through `playwright-core`. Run `npm ci` once in a checkout to install it.
Without Google Chrome, a browser test skips with "Google Chrome is not
installed". When the `CI` environment variable is set, as it is in GitHub
Actions, the test fails instead of skipping.

`npm run test:figures` checks that every figure in the test fixture renders in
the light and dark themes. CI runs it in its own `figures` job, because a
figure whose library loads from esm.sh or jsDelivr fails the test while that
CDN is down.

Run one file with `node --test tests/hub/server.test.mjs`, and format a file
with `npx --yes prettier@3.9.6 --write PATH`. Prettier skips
`tests/fixture/*.html`, which `.prettierignore` lists, because reflowing breaks
the Mermaid and JSON text in those pages.

## Skills

Read `.agents/skills/test-audit/SKILL.md` before writing, changing or deleting
a test, and when asked to audit the tests.

Read `.agents/skills/writing/SKILL.md` before writing or changing `guide/`,
`skills/pair/`, a line the hub or a command prints, the README, `docs/`, this
file or a skill in `.agents/skills/`.

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

The browser tests are in `tests/browser/`. `npm run test:browser` runs each
file named `NAME.browser.mjs`, and `npm run test:figures` runs `figures.mjs`.
No file there matches the default patterns of `node --test`, such as
`*.test.mjs`, so `node --test` runs none of them and passes with no install.
In `tests/support/browser.mjs`, `launch()` starts Chrome, and
`open(t, url, options)` opens a page and closes Chrome when the test ends.

## Checking the frame in a browser

The browser tests check what the frame does, such as sending feedback, a
note's highlight and the keys, and that every fixture figure renders. No test
checks how a page looks, so open a frame or component change in a browser
before calling it done.

For a component or the way a page renders, build the fixture and open the file:

```sh
fixture_dir=$(mktemp -d)
node tests/fixture/build.mjs "$fixture_dir/fixture.html"
```

Check every fixture page in the light and dark themes, at a wide window and at
375px. The fixture has no hub, so it cannot send feedback.

For anything that talks to the hub, such as sending feedback, the progress
card, rounds, sessions or notifications, run a scratch hub. Give every command
the same new state directory, a free port from 4880 to 4899 and
`PAIR_WAKE=off`:

```sh
state=$(mktemp -d)
XDG_STATE_HOME=$state PAIR_HUB_PORT=4880 PAIR_WAKE=off node src/cli.mjs check
XDG_STATE_HOME=$state PAIR_HUB_PORT=4880 PAIR_WAKE=off PAIR_HUB_IDLE_SECONDS=60 node src/cli.mjs start --title "Scratch"
```

`check` must report the hub port as `free`. `start` prints the session's
directory and URL. Build and publish a round in that session as
`guide/pages.md` describes, open the URL, and use the change. With
`PAIR_WAKE=off` the hub sends no wake message when you send feedback, start
a thread or start a proposal. It saves the submission, thread message or
start as usual and writes the line it would have sent to `$state/pair/hub/hub.log`. Leave `PAIR_WAKE` unset only to check a change to
the wake itself, and then the hub wakes the agent that ran `start`. Finish with
`node src/cli.mjs pause --session-dir DIR --reason "Done"` under the same
variables, and the hub exits 60 seconds later.

Never use port 4747 or the default state directory, `~/.local/state/pair`.
They belong to the person using pair on this machine: a session started there
shows in their Live sessions, and a hub started there from your checkout serves
their sessions with your code.

When a pull request into a branch other than `main` changes `src/frame/`,
`src/components/`, `scripts/screenshots.mjs`, `scripts/screenshots/` or
`scripts/demo/`, the `screenshots` job in `.github/workflows/screenshots.yml`
runs `npm run screenshots` on GitHub's macOS 26 runner and pushes the PNGs
it rewrote to the pull request's branch. The illustration's terminal shows
IDs that each run creates anew, so the job pushes a commit after every push
to such a pull request. Pull that commit before you push to the branch again.
GitHub runs the checks on the job's commit only after someone with write
access selects Approve workflows to run on the pull request.

For a change elsewhere that alters what the README's or the docs'
screenshots show, and for a pull request from a fork, run
`npm run screenshots` on macOS and commit the PNGs it rewrites. The script
starts its own hub on a port the system assigns, with its state in a
temporary directory, and takes each screenshot in the installed Google
Chrome. The frame's text is the system font, so the script refuses to run on
another system, where lines would break in other places.
