<h1>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img alt="pair" src="assets/logo-light.svg">
</picture>
</h1>

## Pair programming, now that your agent writes the code.

In pair programming, one person drives and the other navigates. Agents write
most of the code now, so `pair` is built to help you navigate. You read what
the agent shows you, point out what is wrong, choose between the options it
lays out, and approve each piece of work before the agent edits your project
for it. You make the decisions, and you understand the code the agent
writes.

**Everything runs on your machine. Your agent works in the CLI you already
use, and you review its work in your browser.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/illustration-dark.png">
  <img alt="The agent's terminal beside pair in a browser, with arrows between them: pages go to the browser, feedback comes back to the agent, and a thread goes both ways. The terminal shows the pair commands the agent ran and the feedback it read. The browser shows a page that asks where to retry a charge, and a thread on a selected line of code with the agent's answer." src="assets/illustration-light.png">
</picture>

## Get started

`pair` needs Node 20.1.0 or newer.

```sh
npm install -g @ryansaxe/pair             # the application and the pair command
npx skills add RyanSaxe/pair -g           # the skill your agent CLI loads
```

Then, in your project, invoke the `pair` skill with what you want to work on:

> plan retrying a charge when the payment gateway times out

> help me understand how this service handles retries

The agent starts a session and opens it in your browser. When a pair tab is
already open, the agent gives you the link instead.
[Install](docs/getting-started/install.md) says what each agent CLI needs
first, and [Sessions and rounds](docs/concepts/sessions-and-rounds.md)
explains what happens next.

## How it works

<img alt="Working in pair: Explain, Decide, Plan and Build, in any order, each over the loop of every round, in which the agent publishes pages, you review them, and you send feedback. Start leads from that loop to a sub-session beside it, with the same loop of pages and feedback." src="guide/flow.svg">

A session is one task you work on with your agent. In a session, the agent
explains code, lays out decisions, plans the work and builds it, in whatever
order the task needs. You and the agent work in rounds. In each round, the
agent publishes a few pages, you read them and send feedback, and the agent
starts the next round from your feedback.

On each page, you can select any word or line and comment on it, or choose
between the options the agent lays out. When you want an answer before the
next round, you start a thread, and the agent replies while it keeps working.
The agent only edits your project for work you approve.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/work-dark.png">
  <img alt="Three phone screens, with arrows between them. On the Work page, a proposal to add idempotency keys to charges, with Decline, Comment and Start. Then the Start popup, with In a sub-session chosen and a message to the agent. Then the sub-session, with the agent's pages in progress." src="assets/work-light.png">
</picture>

The agent records each piece of work it suggests as a proposal, and the Work
page lists them all. You approve a proposal by pressing Start on it, or by
asking the agent for the work in your own words. On these phone screens, you
start a proposal in a sub-session, a second session beside the one you are
in, and follow the agent's progress there.

Your agent runs `pair` commands in its own shell. A small server on your
machine, the hub, serves the pages to your browser and wakes the agent when
you send feedback. [Architecture](docs/concepts/architecture.md) shows what
runs where, and [Concepts](docs/concepts/) explains each part.

## Documentation

- [Getting started](docs/getting-started/) explains how to install `pair`
  and its skill.
- [Concepts](docs/concepts/) explains sessions, rounds, pages, Agreed,
  proposals and the hub.
- [Guides](docs/guides/) covers planning a change, understanding code and
  building the work.
- [Reference](docs/reference/) lists every command and setting, and the
  files the agent reads.
- [Troubleshooting](docs/troubleshooting.md) explains how to fix known
  problems.

To change `pair`, start at [Contributing](docs/contributing/README.md).
[BACKLOG.md](BACKLOG.md) lists work that is planned but not started.

## License

[MIT](LICENSE)
