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

## The core

`pair guide` prints [`guide/pair.md`](../../guide/pair.md): what a session
is, how pair's instructions reach the agent, how to start, what every round
requires, what a round covers, what makes a page good, how to brief a
subagent, and when to read each lookup file. A test keeps it to 1,100 words
or fewer.

## Moments

A command prints the text of the moment it names after its next step. Each
moment is a Markdown file of at most 150 words in `guide/moments/`, and
`pair guide moments/NAME.md` prints one. After `publish-agreed.md` and
`publish-agreed-plan.md`, `pair publish` also prints the list that
`pair components` prints.

| File in `guide/moments/`  | Printed by           | When                                                                                                                     |
| ------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `start.md`                | `pair start`         | It creates a session.                                                                                                    |
| `read-feedback.md`        | `pair read`          | It prints feedback.                                                                                                      |
| `read-accept-ACTION.md`   | `pair read`          | It prints an acceptance, by the action's ID in `src/shared/offers.mjs`: `save`, `implement`, `finish` or `pull-request`. |
| `read-thread.md`          | `pair read --thread` | It prints a thread.                                                                                                      |
| `publish-agreed.md`       | `pair publish`       | It publishes an Agreed that names no offer.                                                                              |
| `publish-agreed-OFFER.md` | `pair publish`       | It publishes an Agreed that names the `plan` or `finish` offer.                                                          |
| `publish-page.md`         | `pair publish`       | It publishes a page, and pages remain.                                                                                   |
| `publish-last-page.md`    | `pair publish`       | It publishes the round's last page.                                                                                      |

## Lookup files

| File                                                     | Command                       | The agent reads it                                                   | What it contains                                                                                                       |
| -------------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| [`guide/agreements.md`](../../guide/agreements.md)       | `pair guide agreements.md`    | Before it writes Agreed                                              | The task, the fields of each decision and its sources, and how to keep Agreed short.                                   |
| [`guide/pages.md`](../../guide/pages.md)                 | `pair guide pages.md`         | Before the session's first page                                      | Where page sources and built pages go, how to publish them, the source fields, controls, page CSS and page JavaScript. |
| [`guide/components.md`](../../guide/components.md)       | `pair guide components.md`    | Before the session's first page                                      | How to escape a component's text, the attributes of code and figures, decisions, questions, before-after and diagrams. |
| [`guide/writing.md`](../../guide/writing.md)             | `pair guide writing.md`       | Before the session's first page                                      | The rules every sentence on a page follows, with examples of what to avoid and what to write instead.                  |
| [`guide/prototypes.md`](../../guide/prototypes.md)       | `pair guide prototypes.md`    | When a page has a prototype                                          | The prototype contract: a self-contained HTML document that shows an interaction working, and the frame it runs in.    |
| [`guide/side-work.md`](../../guide/side-work.md)         | `pair guide side-work.md`     | When it records side work, or the reviewer presses Start in parallel | How to record side work, and each state an item moves through.                                                         |
| [`guide/session.md`](../../guide/session.md)             | `pair guide session.md`       | Before it takes a session over, resumes it or pauses it              | Taking a session over, resuming and pausing it, and the acceptance record.                                             |
| [`guide/setup.md`](../../guide/setup.md)                 | `pair guide setup.md`         | When a command fails                                                 | The Node requirement, `pair check`, each agent CLI's sandbox, and a submission that did not wake the agent.            |
| [`guide/offers/plan.md`](../../guide/offers/plan.md)     | `pair guide offers/plan.md`   | Before the final plan, and after the reviewer accepts it             | Present the plan, Start implementation and Save for later, and how to build a saved plan.                              |
| [`guide/offers/finish.md`](../../guide/offers/finish.md) | `pair guide offers/finish.md` | After the reviewer accepts built work                                | Finish without a PR and Open a PR, and what the agent does for each.                                                   |

`pair guide components/README.md` prints
[`src/components/README.md`](../../src/components/README.md), which says how
to write a component when a page needs one or the user asks to keep one, and
`pair guide components/NAME/markup.html` prints a component's markup, yours
when you have a component named NAME.
