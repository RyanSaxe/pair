# Documentation

pair runs review sessions between you and a coding agent in the browser. Start
with the page that matches what you want to do.

## Use pair

- [Install](install.md) says how to install pair and its skill, what each
  agent CLI needs, how to update pair, and how to replace a skill already named
  pair.
- [How it works](how-it-works.md) explains how the hub wakes the agent, which
  agent is a session's holder and how another agent takes the session over, how
  long the hub runs, and what pair keeps on disk.
- [Commands](commands.md) lists every `pair` command and environment variable.
- [Troubleshooting](troubleshooting.md) covers Codex asking to approve every
  `pair` command.

## Change pair

- [Contributing](contributing/README.md) says how to run pair from a checkout,
  lists the repository's folders and gives the checks to run.
- [Adapters](contributing/adapters.md) is the contract a `wake.mjs` meets to
  wake an agent CLI.
- [Offers](contributing/offers.md) describes the registry behind the Accept
  actions in the Finish your review dialog.

The files under `guide/` are what the agent reads while it runs a session, and
`pair guide` prints them for the installed version.
