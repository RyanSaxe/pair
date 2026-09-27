# The guide

The files under `guide/` are what the agent reads while it runs a session.

- The `pair` skill's one instruction is to run `pair guide`, so the guide
  always matches the installed `pair` and the skill never needs
  reinstalling.
- `pair guide NAME` prints one file, such as `round.md` or `offers/plan.md`.
- Each session command prints the next step, naming the guide files it
  needs.

| File                                                     | Command                            | What it tells the agent                                                                                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`guide/pair.md`](../../guide/pair.md)                   | `pair guide`, `pair guide pair.md` | What `pair` is, what a page contains, how to start a session and how to plan. It ends with the list of the other guide files and when to read each.                                                             |
| [`guide/session.md`](../../guide/session.md)             | `pair guide session.md`            | How to start, take over, resume and pause a session, and what `pair complete` and the acceptance record mean. The agent reads it before `pair start`.                                                           |
| [`guide/round.md`](../../guide/round.md)                 | `pair guide round.md`              | The steps of one round: `pair ack` when a wake message arrives, `pair read` for the feedback, then Agreed and each page published as soon as it is done. `pair ack` names this file in the next step it prints. |
| [`guide/quality.md`](../../guide/quality.md)             | `pair guide quality.md`            | What makes a page, a round of exploration and a final plan good, including how to carry approved material into the plan. The agent reads it before the first round.                                             |
| [`guide/writing.md`](../../guide/writing.md)             | `pair guide writing.md`            | The rules every sentence on a page follows, with examples of what to avoid and what to write instead.                                                                                                           |
| [`guide/pages.md`](../../guide/pages.md)                 | `pair guide pages.md`              | The page contract: where page sources and built pages go, the source fields, content, controls, page JavaScript, comments and figures.                                                                          |
| [`guide/agreements.md`](../../guide/agreements.md)       | `pair guide agreements.md`         | The Agreed contract: the task, the fields of each decision, and what Agreed contains in a build round.                                                                                                          |
| [`guide/prototypes.md`](../../guide/prototypes.md)       | `pair guide prototypes.md`         | The prototype contract: a self-contained HTML document that shows an interaction working, its fields, and the sandboxed frame it runs in.                                                                       |
| [`guide/components.md`](../../guide/components.md)       | `pair guide components.md`         | The component index: what each component is for and the markup a page copies.                                                                                                                                   |
| [`guide/setup.md`](../../guide/setup.md)                 | `pair guide setup.md`              | What to do when starting, waking or a command fails: the Node requirement, `pair check`, each agent CLI's sandbox, and a submission that did not wake the agent.                                                |
| [`guide/offers/plan.md`](../../guide/offers/plan.md)     | `pair guide offers/plan.md`        | The two ways to accept a plan, Start implementation and Save for later, and how to build the plan, including one saved for later.                                                                               |
| [`guide/offers/finish.md`](../../guide/offers/finish.md) | `pair guide offers/finish.md`      | The two ways to accept built work, Finish without a PR and Open a PR, and what the agent does for each.                                                                                                         |

`pair guide components/README.md` prints
[`src/components/README.md`](../../src/components/README.md), which says how
to write a component when a page needs one or the user asks to keep one.
