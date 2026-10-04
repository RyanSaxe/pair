# The guide

The files under `guide/` are what the agent reads while it runs a session,
in three parts:

- The core, `guide/pair.md`, which the agent reads once and again after it
  takes a session over. The `pair` skill's first instruction is to run
  `pair guide`, which prints the core, so the guide always matches the
  installed `pair` and the skill never needs reinstalling.
- The moments, in `guide/moments/`. Each session command prints its next
  step first, then the text of the moment at which the agent runs it.
- The lookup files, which the core and the moments name by the `pair guide`
  command that prints each, before the step that needs it.

Your own file at the same path under `$XDG_CONFIG_HOME/pair/`, or
`~/.config/pair/`, prints after pair's, such as `~/.config/pair/pages.md`
after `guide/pages.md`. Nothing there is required, and nothing replaces
pair's text.

## Moments

A command prints the text of the moment it names after its next step. Each
moment is a Markdown file in `guide/moments/`, and
`pair guide moments/NAME.md` prints one. After `publish-agreed.md`,
`pair publish` also prints the list that `pair components` prints.

| File in `guide/moments/` | Printed by           | When                                   |
| ------------------------ | -------------------- | -------------------------------------- |
| `start.md`               | `pair start`         | It creates a session.                  |
| `read-feedback.md`       | `pair read`          | It prints feedback.                    |
| `read-thread.md`         | `pair read --thread` | It prints a thread.                    |
| `publish-agreed.md`      | `pair publish`       | It publishes Agreed.                   |
| `publish-page.md`        | `pair publish`       | It publishes a page, and pages remain. |
| `publish-last-page.md`   | `pair publish`       | It publishes the round's last page.    |

## Lookup files

| File                                               | Command                    | The agent reads it                                      |
| -------------------------------------------------- | -------------------------- | ------------------------------------------------------- |
| [`guide/agreements.md`](../../guide/agreements.md) | `pair guide agreements.md` | Before it writes Agreed                                 |
| [`guide/pages.md`](../../guide/pages.md)           | `pair guide pages.md`      | Before the session's first page                         |
| [`guide/components.md`](../../guide/components.md) | `pair guide components.md` | Before the session's first page                         |
| [`guide/writing.md`](../../guide/writing.md)       | `pair guide writing.md`    | Before the session's first page                         |
| [`guide/prototypes.md`](../../guide/prototypes.md) | `pair guide prototypes.md` | When a page has a prototype                             |
| [`guide/session.md`](../../guide/session.md)       | `pair guide session.md`    | Before it takes a session over, resumes it or pauses it |
| [`guide/setup.md`](../../guide/setup.md)           | `pair guide setup.md`      | When a command fails                                    |

`pair guide components/README.md` prints
[`src/components/README.md`](../../src/components/README.md), which says how
to write a component when a page needs one or the user asks to keep one,
`pair guide components/NAME/markup.html` prints a component's markup, yours
when you have a component named NAME, and `pair guide flow.svg` prints the
hand-drawn diagram that `guide/components.md` gives as an example.
