# The guide

The files under `guide/` instruct the agent throughout a session in three parts:

- **Core** (`guide/pair.md`): read at session start and after taking a session
  over. The `pair` skill simply instructs the agent to run `pair guide`, so the
  guide always matches your installed version without reinstalling the skill.
- **Moments** (`guide/moments/`): printed by each session command right after
  its next step.
- **Reference files**: loaded on demand via `pair guide FILE` commands named in
  the core and moments.

## Your own text

Put custom text at the matching path under `$XDG_CONFIG_HOME/pair/` (default
`~/.config/pair/`) to append it after pair's text. For example,
`~/.config/pair/pages.md` appends to `guide/pages.md`, and
`~/.config/pair/moments/read-open-agent.md` tells the agent how to open a new
agent session on your machine.

Where your text conflicts with pair's, the agent follows yours unless a command
refuses. None of these files is required, and none replaces pair's built-in
text.

## Moments

Session commands print the matching moment from `guide/moments/` after the next
step; `pair guide moments/NAME.md` prints one directly. After
`publish-agreed.md`, `pair publish` also prints the `pair components` list.

| File in `guide/moments/`    | Printed by                          | Trigger                                                                                                   |
| --------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `start.md`                  | `pair start`                        | Creates a session.                                                                                        |
| `start-from.md`             | `pair start --from`                 | Creates a linked session for a proposal (after `start.md`).                                               |
| `start-from-plan.md`        | `pair start --from`                 | Creates a linked session with Plan it first (after `start.md`, replacing `start-from.md`).                |
| `start-reopen.md`           | `pair start --reopen`               | Reopens a closed session.                                                                                 |
| `read-feedback.md`          | `pair read`                         | Prints what you sent.                                                                                     |
| `read-plan.md`              | `pair read`                         | Prints a send with Write a plan or Update the plan (after `read-feedback.md`).                            |
| `read-iterate.md`           | `pair read`                         | Prints a send with Back to iterating (after `read-feedback.md`).                                          |
| `read-build.md`             | `pair read`                         | Prints a send with Build it (after `read-feedback.md`).                                                   |
| `read-thread.md`            | `pair read --thread`                | Prints a thread.                                                                                          |
| `read-start-here.md`        | `pair read`, `pair propose --start` | Prints work approved to run in this session (via Start or your words).                                    |
| `read-start-sub-session.md` | `pair read`, `pair propose --start` | Prints work approved to run in a sub-session.                                                             |
| `read-open-agent.md`        | `pair read --thread`                | Prints an Open a new agent session / Start agent with message thread until a session links to it.         |
| `read-declined.md`          | `pair read`                         | Prints proposals declined since the last `pair read` (once each).                                         |
| `read-closed.md`            | `pair read`                         | Prints proposals whose linked session closed since the last `pair read` (once each).                      |
| `publish-agreed.md`         | `pair publish`                      | Publishes Agreed.                                                                                         |
| `publish-page.md`           | `pair publish`                      | Publishes a page while more pages remain.                                                                 |
| `publish-last-page.md`      | `pair publish`                      | Publishes the round's final page.                                                                         |

## Reference files

| File                                               | Command                    | When the agent reads it                                      |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| [`guide/agreements.md`](../../guide/agreements.md) | `pair guide agreements.md` | Before writing Agreed                                        |
| [`guide/pages.md`](../../guide/pages.md)           | `pair guide pages.md`      | Before the session's first page                              |
| [`guide/components.md`](../../guide/components.md) | `pair guide components.md` | Before the session's first page                              |
| [`guide/writing.md`](../../guide/writing.md)       | `pair guide writing.md`    | Before the first page, and to check each page and reply      |
| [`guide/prototypes.md`](../../guide/prototypes.md) | `pair guide prototypes.md` | When a page includes a prototype                             |
| [`guide/session.md`](../../guide/session.md)       | `pair guide session.md`    | Before taking over, resuming, or pausing a session           |
| [`guide/setup.md`](../../guide/setup.md)           | `pair guide setup.md`      | When a command fails                                         |
| [`guide/proposals.md`](../../guide/proposals.md)   | `pair guide proposals.md`  | Before recording the first proposal                          |

## Other files `pair guide` prints

- `pair guide components/README.md` prints
  [`src/components/README.md`](../../src/components/README.md) (how to write a
  custom component under `~/.config/pair/components/`).
- `pair guide components/NAME/markup.html` prints a built-in or custom
  component's markup.
- `pair guide flow.svg` prints the example SVG referenced by
  `guide/components.md`.
