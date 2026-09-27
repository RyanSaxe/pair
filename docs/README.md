# Documentation

`pair` is where you and your coding agent work a change through together, in
your browser. Start with the section that matches what you want to do.

## Getting started

- [Install](getting-started/install.md) installs `pair` and its skill, says
  what each agent CLI needs, and how to update.

## Concepts

- [Sessions and rounds](concepts/sessions-and-rounds.md) explains sessions,
  rounds, pages, Agreed and feedback.
- [Offers and building](concepts/offers-and-building.md) explains accepting a
  plan, the build round and accepting the work.
- [Threads and side work](concepts/threads-and-side-work.md) explains asking a
  question now and setting work aside.
- [Holders and handoff](concepts/holders-and-handoff.md) explains which agent
  holds a session and how another agent takes it over.
- [Architecture](concepts/architecture.md) explains the hub, how it wakes the
  agent, and what `pair` keeps on disk.

## Guides

- [Plan a change](guides/plan-a-change.md) gets you to a plan you trust.
- [Understand code](guides/understand-code.md) uses a session to learn a
  codebase, a module or a pull request.
- [Build a plan](guides/build-a-plan.md) follows a build and reviews what it
  made.

## Reference

- [Commands](reference/commands.md) lists every `pair` command and
  environment variable.
- [The guide](reference/the-guide.md) lists what the agent reads, file by
  file.
- [Troubleshooting](troubleshooting.md) covers the problems people hit.

## Change pair

- [Contributing](contributing/README.md) says how to run `pair` from a
  checkout, lists the repository's folders and gives the checks to run.
- [Adapters](contributing/adapters.md) is the contract a `wake.mjs` meets to
  wake an agent CLI.
- [Offers](contributing/offers.md) describes the registry behind the Accept
  actions in the Finish your review dialog.
