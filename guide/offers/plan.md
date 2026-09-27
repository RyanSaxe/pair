# The plan offer

A round with `"offer": "plan"` is a complete plan. The reviewer accepts it
with Save for later or Start implementation, and `pair read` returns the
acceptance with the chosen action in `action`.

Read the comments first. The acceptance's `groups` hold the comments and
choices the reviewer drafted before accepting, and `pair complete` returns
them again. Read them with the plan. If one of them, or the guidance,
changes an agreed requirement, request a new review instead of acting on
it.

## Start implementation

The action is `implement`. Run `pair complete`, then build the accepted plan
under the project's instructions, isolation requirements and existing
permissions. The acceptance may carry `guidance` of up to 4,000 characters,
which `pair complete` also returns. Build the plan with it. Acceptance
authorizes the plan and nothing else.

## Save for later

The action is `save`. Run `pair complete`, give the user `planPath`, and do
not implement. The plan stays accepted, with its record in the session's
`acceptance.json`, so any agent can take it over and build it later.

[session.md](../session.md) says what `pair complete` returns and where the
plan's pages are.
