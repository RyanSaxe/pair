# Documentation

`pair` lets you and your coding agent work through a change together, in
your browser. Start with the section that matches what you want to do.

## Getting started

- [Install](getting-started/install.md) explains how to install and update
  `pair` and its skill, and what each agent CLI needs.

## Concepts

- [Sessions and rounds](concepts/sessions-and-rounds.md) explains sessions,
  rounds, pages, Agreed, feedback and closing a session.
- [Proposals and Work](concepts/proposals-and-work.md) explains how the
  agent suggests work, how you approve it, where it runs, plans, and how
  work is finished.
- [Threads](concepts/threads.md) explains how to get an answer before the
  next round.
- [Holders and handoff](concepts/holders-and-handoff.md) explains which
  agent the hub wakes for a session, and how another agent takes the
  session over.
- [Architecture](concepts/architecture.md) explains the hub, how it wakes
  the agent, and what `pair` stores on disk.

## Guides

- [Plan a change](guides/plan-a-change.md) explains how to plan a change
  until you have a plan you can approve.
- [Understand code](guides/understand-code.md) explains how to use a
  session to learn a codebase, a module or a pull request.
- [Build the work](guides/build-the-work.md) explains how to follow the
  work you approved while the agent builds it, and how to review the result.

## Reference

- [Commands](reference/commands.md) lists every `pair` command and
  environment variable.
- [The guide](reference/the-guide.md) lists the files the agent reads, and
  when it reads each one.
- [Troubleshooting](troubleshooting.md) explains how to fix known problems.

## Change pair

- [Contributing](contributing/README.md) explains how to run `pair` from a
  checkout, lists the repository's folders and gives the checks to run.
- [Adapters](contributing/adapters.md) describes what a `wake.mjs` exports
  so that the hub can wake an agent CLI.
