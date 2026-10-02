# The plan offer

## Present the plan

An engineer or agent who saw none of the rounds and none of the
conversation implements the plan. They know only what the plan shows.

Build the plan from Agreed and from everything the conversation and the
feedback settled. Agreed names `"offer": "plan"`, and the first page after
it is `overview`, which `pair publish` requires of a plan round. On
`overview`, state the outcome and how the parts relate. Organize the pages
after it the way the work is best understood, as pages an implementer can
work from. Each states the behavior its part of the work produces, the
interfaces it changes by their real paths, and how to verify it. The pages
depend on Agreed, not on each other, so subagents can write them at once.

Reuse the approved material instead of drawing it again or describing it.
Copy the mock, the prototype, the diagram, the code or the wording from its
page source in the session's `src/<round>/<page-id>/`, and change it to
match everything agreed after it was shown. An earlier mock may have been
approved on one point and rejected on another. Show what was agreed, and say
which parts are binding and which are illustrative.

Before publishing the plan, reread Agreed and the feedback, and check that
every approved item appears in the plan as it was agreed. When
implementation must answer a question, state in the plan what to find out,
how, and what result is acceptable. Match the detail to the work.

## Start implementation

The action is `implement`. Build the accepted plan in this session's next
round, the build round, under the project's instructions, isolation
requirements and existing permissions. The acceptance may include `guidance`
of up to 4,000 characters. Follow it. Acceptance authorizes the plan and
nothing else.

1. Read the plan. Its pages are HTML fragments in the session's
   `src/<round>/<page-id>/`.
2. Before the first change, publish the build round's Agreed and page list,
   as [pages.md](../pages.md) describes. Agreed names `"offer": "finish"`
   and contains the task and none of the plan's decisions. It does not
   repeat or link the plan, because the reviewer opens the plan from the
   Rounds dialog. List one page per step of the plan unless another
   structure explains the work better, and make the pull request
   description the last page.
3. Build the plan one step at a time. Before you change anything for a
   step, run `pair progress --page ID --note "…"` with the ID of the page
   that shows it, so the reviewer sees which step you are building, not
   only which page you are writing. For steps you build at the same time,
   give `--page` once for each. Report again whenever the work changes and
   at least every five minutes.
4. Commit on a branch as the project's instructions say, and open no pull
   request.
5. When a step is done and checked, publish its page before you start the
   next step. The page shows what was built and states any departure from the plan, with the
   reason. Do not stop to ask. When the plan does not settle something,
   decide in line with the plan's intent, build it, and say on the page what
   you decided and why.
6. Write the last page as the pull request description: what the work is,
   why it matters, how to review it and what was done to trust it. If the
   reviewer chooses Open a PR, this page becomes the pull request's body, as
   [offers/finish.md](finish.md) describes.

When the reviewer sends feedback on the build instead of accepting it,
change the work and publish a follow-up round the same way. Its Agreed also
names `"offer": "finish"` and lists what the reviewer's comments settled,
and its last page is the pull request description again, updated to the
work as it now stands.

## Save for later

The action is `save`, and the reviewer wants the plan built later, so do not
implement it when the Save arrives. The next step that `pair read` prints
contains the handoff line. Say the handoff line in chat, then end your turn.
The plan stays accepted, with its record in the session's `acceptance.json`.

## Build a saved plan

To have a saved plan built, the user gives an agent its handoff line. That
agent runs the `pair start --session-dir PATH` command in the line, becomes
the holder, and follows the next step it prints, which says to read the
acceptance and build the plan. The acceptance keeps the action `save`. Build
the plan as Start implementation describes, in the place the project's
instructions name for the work.

When the user asks the agent that saved the plan to build it, that agent runs
the same command. Before its `pair read` has returned the Save, its
`pair start` resumes the session without building, as after an interrupted
turn.
