# The plan offer

A round with `"offer": "plan"` is a complete plan. The reviewer accepts it
with Save for later or Start implementation, and `pair read` returns the
acceptance with the chosen action in `action`. Both actions keep the
session, so never run `pair complete` for a plan.

Read the comments first. The acceptance's `groups` hold the comments and
choices the reviewer drafted before accepting. Read them with the plan. If
one of them, or the guidance, changes an agreed requirement, request a new
review instead of acting on it.

## Start implementation

The action is `implement`. Build the accepted plan in this session's next
round, the build round, under the project's instructions, isolation
requirements and existing permissions. The acceptance may carry `guidance`
of up to 4,000 characters. Build the plan with it. Acceptance authorizes the
plan and nothing else.

1. Read the plan. Its pages are HTML fragments in the session's
   `src/<round>/<page-id>/`.
2. Before the first change, publish the build round's Agreed and page list,
   as [round.md](../round.md) describes, with Agreed as
   [agreements.md](../agreements.md) says for a build round. List one page
   per step of the plan unless another structure explains the work better.
   The last page is the pull request description. Agreed and every page
   carry `"offer": "finish"`, although the work is not done yet.
3. Commit on a branch as the project's instructions say, and open no pull
   request.
4. Publish each page when its part of the work is done. The page shows what
   was built and states any departure from the plan, with the reason. When
   the plan does not settle something, make the choice the plan's intent
   points to, build it, and say on the page what you chose and why.
5. Write the last page as the pull request description: what the work is,
   why it matters, how to review it and what was done to trust it. The
   finish offer's Open a PR uses this page as the pull request's body.

## Save for later

The action is `save`, and the reviewer wants the plan built later, so do not
implement it when the Save arrives. `pair read` prints the handoff line. Say it
in chat, then end your turn. The plan stays accepted, with its record in the
session's `acceptance.json`.

## Build a saved plan

The handoff line is how the reviewer asks for the build. It runs
`pair start --session-dir PATH` in any agent and any harness, including the
agent that saved the plan once `pair read` has returned the Save. Until then,
that agent's own `pair start` changes nothing, as after an interrupted turn.
When the user asks you to build a plan you saved, run that command yourself.
Its `next` line says that you now build the round. The acceptance that
`pair read` prints keeps the action `save`, the way the reviewer accepted the
plan. Build it as Start implementation describes. Where you work follows the project's own rules.
