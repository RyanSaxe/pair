# The guide

The files under `guide/` are the instructions the agent reads while it runs
a session. They come in three parts:

- The core, `guide/pair.md`. The agent reads it once at the start of a
  session, and again after it takes a session over. The `pair` skill tells
  the agent to run `pair guide`, which prints the core, so the instructions
  always match the installed `pair`, and the skill never needs reinstalling.
- The moments, in `guide/moments/`. Each session command prints its next
  step first, then the text of the moment at which the agent runs it.
- The reference files. The core and the moments name each one by the
  `pair guide` command that prints it, before the step that needs it.

You can add your own text to any of these files. Put it in a file at the
same path under `$XDG_CONFIG_HOME/pair/`, or `~/.config/pair/`, and `pair`
prints it after pair's own text. For example, `pair` prints
`~/.config/pair/pages.md` after `guide/pages.md`. In
`~/.config/pair/moments/read-open-agent.md` you can say how the agent opens
a new agent session on your machine. Where your text and pair's disagree,
the agent follows yours, unless a command refuses. You do not need any of
these files, and none of them replaces pair's text.

## Moments

A command prints the text of the moment it names after its next step. Each
moment is a Markdown file in `guide/moments/`, and
`pair guide moments/NAME.md` prints one. After `publish-agreed.md`,
`pair publish` also prints the list that `pair components` prints.

| File in `guide/moments/`    | Printed by           | When the command                                                                                |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `start.md`                  | `pair start`         | Creates a session.                                                                              |
| `start-from.md`             | `pair start --from`  | Creates a session for a proposal, after `start.md`.                                             |
| `read-feedback.md`          | `pair read`          | Prints your feedback.                                                                           |
| `read-thread.md`            | `pair read --thread` | Prints a thread.                                                                                |
| `read-start-here.md`        | `pair read`          | Prints work you approved to run in this session, with Start or in your own words.               |
| `read-start-sub-session.md` | `pair read`          | Prints work you approved to run in a sub-session.                                               |
| `read-open-agent.md`        | `pair read --thread` | Prints the thread that Open a new agent session started, until a session links to the proposal. |
| `read-declined.md`          | `pair read`          | Prints the proposals you declined since the last `pair read`, each once.                        |
| `read-closed.md`            | `pair read`          | Prints the proposals whose linked session you closed since the last `pair read`, each once.     |
| `plan.md`                   | `pair plan`          | Attaches a plan to a proposal, or replaces the plan the proposal has.                           |
| `publish-agreed.md`         | `pair publish`       | Publishes Agreed.                                                                               |
| `publish-page.md`           | `pair publish`       | Publishes a page, and more pages remain.                                                        |
| `publish-last-page.md`      | `pair publish`       | Publishes the round's last page.                                                                |

## Reference files

| File                                               | Command                    | The agent reads it                                        |
| -------------------------------------------------- | -------------------------- | --------------------------------------------------------- |
| [`guide/agreements.md`](../../guide/agreements.md) | `pair guide agreements.md` | Before it writes Agreed                                   |
| [`guide/pages.md`](../../guide/pages.md)           | `pair guide pages.md`      | Before the session's first page                           |
| [`guide/components.md`](../../guide/components.md) | `pair guide components.md` | Before the session's first page                           |
| [`guide/writing.md`](../../guide/writing.md)       | `pair guide writing.md`    | Before the session's first page, and to check each page   |
| [`guide/prototypes.md`](../../guide/prototypes.md) | `pair guide prototypes.md` | When a page has a prototype                               |
| [`guide/session.md`](../../guide/session.md)       | `pair guide session.md`    | Before it takes a session over, resumes it or pauses it   |
| [`guide/setup.md`](../../guide/setup.md)           | `pair guide setup.md`      | When a command fails                                      |
| [`guide/proposals.md`](../../guide/proposals.md)   | `pair guide proposals.md`  | Before it records its first proposal, and to build a plan |

`pair guide components/README.md` prints
[`src/components/README.md`](../../src/components/README.md), which says how
to write a component. The agent reads it when you ask it to keep a shape it
built for a page as a component of your own, in
`~/.config/pair/components/`. `pair guide components/NAME/markup.html`
prints a component's markup, or yours when you have a component named NAME.
`pair guide flow.svg` prints the hand-drawn diagram that
`guide/components.md` gives as an example.
