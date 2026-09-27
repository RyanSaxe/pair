# The plan offer

A round whose Agreed names `"offer": "plan"` is a complete plan. The
reviewer accepts it with Save for later or Start implementation, and
`pair read` returns the acceptance with the chosen action in `action`. Both
actions keep the session, so never run `pair complete` for a plan.

Read the comments first. The acceptance's `groups` field contains the
comments and choices the reviewer drafted before accepting. Read them with
the plan. If one of them, or the guidance, changes an agreed requirement,
request a new review instead of acting on it.

## Start implementation

The action is `implement`. Build the accepted plan in this session's next
round, the build round, under the project's instructions, isolation
requirements and existing permissions. The acceptance may include `guidance`
of up to 4,000 characters. Follow it. Acceptance authorizes the plan and
nothing else.

1. Read the plan. Its pages are HTML fragments in the session's
   `src/<round>/<page-id>/`.
2. Before the first change, publish the build round's Agreed and page list,
   as [round.md](../round.md) describes. Agreed names `"offer": "finish"`
   and contains the task and none of the plan's decisions, as
   [agreements.md](../agreements.md) says for a build round. List one page
   per step of the plan unless another structure explains the work better,
   and make the pull request description the last page.
3. Report progress as [round.md](../round.md) describes: run
   `pair progress --start ID` as you begin each page's part of the work, and
   `pair ack --note "…"` whenever the work changes and at least every five
   minutes.
4. Commit on a branch as the project's instructions say, and open no pull
   request.
5. Publish each page when its part of the work is done and checked. The page
   shows what was built and states any departure from the plan, with the
   reason. Do not stop to ask. When the plan does not settle something,
   decide in line with the plan's intent, build it, and say on the page what
   you decided and why.
6. Write the last page as the pull request description: what the work is,
   why it matters, how to review it and what was done to trust it. If the
   reviewer chooses Open a PR, this page becomes the pull request's body, as
   [offers/finish.md](finish.md) describes.

When the reviewer sends feedback on the build instead of accepting it,
change the work and publish a follow-up round the same way. Its Agreed also
names `"offer": "finish"`, and its last page is the pull request description
again, updated to the work as it now stands.

## Save for later

The action is `save`, and the reviewer wants the plan built later, so do not
implement it when the Save arrives. The `next` line of `pair read` contains
the handoff line. Say the handoff line in chat, then end your turn. The plan
stays accepted, with its record in the session's `acceptance.json`.

## Build a saved plan

To have a saved plan built, the user gives an agent its handoff line. That
agent runs the `pair start --session-dir PATH` command in the line, becomes
the holder, and follows the `next` line, which says to read the acceptance
and build the plan. The acceptance keeps the action `save`. Build the plan
as Start implementation describes, in the place the project's instructions
name for the work.

When the user asks the agent that saved the plan to build it, that agent runs
the same command. Before its `pair read` has returned the Save, its
`pair start` resumes the session without building, as after an interrupted
turn.
