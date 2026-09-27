<h1>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
  <img alt="pair" src="assets/logo-light.svg">
</picture>
</h1>

## Pair programming, now that your agent writes the code.

When an agent writes most of the code, the hard part is thinking the work
through with it: what to build, how it should work, and whether you
understand what it did. `pair` gives the two of you one place to do that. The
agent lays its thinking out as pages, with mocks, diagrams, code and diffs.
You choose between its options, comment on anything, and ask questions that
it answers right away. Each round it brings everything together in new
pages, until you have a plan you trust, a build you understand, or an answer
you can explain.

**It runs on your machine, inside the agent CLI you already use.**

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/pair-dark.png">
  <img alt="pair planning its own threads: code with a line selected, a side-by-side choice of where an answer appears, and a thread the agent answered, beside a phone showing the next round arriving" src="assets/pair-light.png">
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

The agent opens the session in your browser.
[Sessions and rounds](docs/concepts/sessions-and-rounds.md) explains what
happens there, and [Install](docs/getting-started/install.md) says what each
agent CLI needs first.

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/session-dark.svg">
  <img alt="A session: you ask, then work through rounds until something is understood, a plan is accepted, or the work is accepted" src="docs/assets/session-light.svg">
</picture>

A session is a series of rounds. In each round the agent publishes pages and
you respond: choose, comment, send feedback, or start a thread for an answer
right away. A session that explains something can go round as long as you
like. When a plan is complete you accept it, and the same session builds it,
one page per part, until you accept the work.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-dark.svg">
  <img alt="What runs where: your agent CLI, the pair hub on your machine, and your browser" src="docs/assets/architecture-light.svg">
</picture>

Your agent runs `pair` commands in its own shell. The `pair` hub, on your
machine, serves the pages to your browser and wakes the agent when you
respond. [Concepts](docs/concepts/) explains each part in more depth.

## Documentation

- [Getting started](docs/getting-started/) installs `pair` and runs a first
  session.
- [Concepts](docs/concepts/) explains sessions, rounds, pages, Agreed and the
  hub.
- [Guides](docs/guides/) covers planning, understanding code, building and
  handing a session over.
- [Reference](docs/reference/) lists every command and setting, and what the
  agent reads.
- [Troubleshooting](docs/troubleshooting.md) covers the problems people hit.

To change `pair`, start at [Contributing](docs/contributing/README.md).
[BACKLOG.md](BACKLOG.md) lists work planned but not started.

## License

[MIT](LICENSE)
