<h1>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img alt="pair" src="assets/logo-light.svg">
</picture>
</h1>

## Pair programming, now that your agent writes the code.

In pair programming, one person drives and the other navigates. Your agent
drives now, so `pair` puts you in the navigator's seat. You decide what
matters, question what doesn't add up, and send the agent back when it's off
course. You finish with a plan you trust and a solution you understand.

**It runs on your machine, inside the agent CLI you already use.**

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

The agent opens the session in your browser, or gives you its link when a
pair tab is already open.
[Sessions and rounds](docs/concepts/sessions-and-rounds.md) explains what
happens there, and [Install](docs/getting-started/install.md) says what each
agent CLI needs first.

## How it works

<img alt="Working in pair: Explain, Decide, Plan and Build, in any order, each over the loop of every round, in which the agent publishes pages, you review them, and you send feedback. Start leads from that loop to a sub-session beside it, with the same loop of pages and feedback." src="guide/flow.svg">

In a session, the agent can explain code, lay out the options for a
decision, plan the work and build it, in any order. In every round, the agent
publishes pages, you review them and send feedback, and the agent publishes
the next round.

Your agent shows its work as pages in your browser, and you point at exactly
what to change, choose between options, or ask in a thread and get an answer
right away. The agent changes your project only to do work you start.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/work-dark.png">
  <img alt="Three phone screens, with arrows between them. On the Work page, a proposal to add idempotency keys to charges, with Decline, Comment and Start. Then the Start popup, with In a sub-session chosen and a message to the agent. Then the sub-session, with the agent's pages in progress." src="assets/work-light.png">
</picture>

The agent records the work it thinks is worth doing as proposals on the
Work page. In these phone screens, you start a proposal in a sub-session,
beside the session you are in, and follow the agent's progress there.

Your agent runs `pair` commands in its own shell. The `pair` hub, on your
machine, serves the pages to your browser and wakes the agent when you
respond. [Architecture](docs/concepts/architecture.md) explains what runs
where, and [Concepts](docs/concepts/) explains each part in more depth.

## Documentation

- [Getting started](docs/getting-started/) installs `pair` and runs a first
  session.
- [Concepts](docs/concepts/) explains sessions, rounds, pages, Agreed,
  proposals and the hub.
- [Guides](docs/guides/) covers planning, understanding code and building
  the work.
- [Reference](docs/reference/) lists every command and setting, and what the
  agent reads.
- [Troubleshooting](docs/troubleshooting.md) covers the problems people hit.

To change `pair`, start at [Contributing](docs/contributing/README.md).
[BACKLOG.md](BACKLOG.md) lists work planned but not started.

## License

[MIT](LICENSE)
