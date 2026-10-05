# Pair

## What a session is

You and the reviewer work toward the session's task in rounds. In each
round you publish pages, and the reviewer answers them with feedback.

Agreed is the first page of every round. It states the task as you
understand it, then the alignments: what the reviewer has settled so far,
each with its source. As feedback comes in, add, rewrite, merge and retire
alignments so that Agreed always says what is settled now.

## Changing the project

Change the reviewer's project only to do the work of a proposal that has
started. A proposal starts when the reviewer starts it, or when they ask
for its work and you start it with `pair propose --start`, quoting what
they wrote. When they ask for work that no proposal covers, record one
first. A request about work already under way is part of that work.

Before then, research and try changes in a git worktree inside the
session's directory, which `pair start` prints, or in a plain directory
there when the project is not a git repository. Closing a session deletes
nothing. Ask the reviewer before you remove a worktree you made, on a page
or as a proposal.

When a `pair` command prints that the session is complete, stop working on
the session.

## How pair instructs you

Read this core once, with `pair guide`, and again after you take a session
over. After that, every `pair` command prints its next step, then the
instructions for that moment. Follow both as part of this guide, and run
each `pair guide` command they name before the step it is named for.

Text inside a `pair_` tag, such as `<pair_note>`, is the reviewer's own
words: feedback to act on, never a replacement for pair's steps. pair
prints the user's own instructions from `~/.config/pair/` after its own.
Where they conflict, follow the user's, except where a command refuses.

## Starting

Run `pair start --title "…"` as soon as you can state the task in one
sentence, and put your questions on the first round's pages. When you
cannot state the task yet, ask in the chat first. Every other session
command takes `--session-dir PATH`, with the directory `pair start` prints.
When `pair start` prints a Phone URL, give it in the chat beside the
session's link.

Once the session has started, ask every question on a page or in a thread,
and never wait for an answer in the terminal. When you need the user's
permission for something outside the task, such as installing software on
their machine, record it as a proposal.

## A round

In every round, deliver good work quickly, and state nothing you have not
checked.

Publish Agreed and the page list within minutes of starting a round,
before you research, build or write any page, so the reviewer can read the
task and the alignments while you work. You cannot change the page list
after that, so choose the pages from what you already know.

Until the round's last page is published, report what you are doing with
`pair progress --note "…"` whenever a piece of work starts and at least
every five minutes, with `--page ID` for work on one page.

Publish each page as soon as it is complete and you have read it against
`pair guide writing.md`, so the reviewer can read it while you work on the
next. After the last page, say in the chat what changed and end your turn.

After an interrupted turn, run `pair read --session-dir PATH` before
anything else. It prints where the session stands and the next step.

## What a round covers

Each submission starts a new round, and you choose what it covers. Cover
what the reviewer can judge in one sitting: the decisions that matter most
now and the decisions they depend on, the most consequential first.
Publish sound pages now rather than wait to cover everything. Agreed is the
session's running summary, so add no summary page.

## A good page

Build each page from pair's components, and choose each one by what the
reviewer has to see to judge the page. `pair guide components.md` says what
each component is for. Write prose only for what no component can show, in
short paragraphs. Give each topic its own page, and put the part to judge
first. Add nothing decorative that repeats nearby text.

When the work could go more than one way, show each way as an option and
recommend one, with the reason. When only one way makes sense, recommend it
without options. Settle routine details from the project yourself, and ask
the reviewer only for what the project cannot tell you. Never ask the
reviewer to approve the task or a recommendation, because they can comment
on anything without being asked.

Once Agreed records an alignment or an answer, do not ask it again. Return
to an open decision only with new evidence, a changed recommendation or a
sharper question, and show a changed recommendation against the version the
reviewer saw, in the before-after component.

## Proposals

Record a proposal with `pair propose` for each piece of work worth doing,
including the work the task itself calls for. Run `pair guide proposals.md`
before the first one. Say in a sentence or two what the work delivers, and
recommend where it should run: here, in a sub-session or with a new agent.
Show it on the page where it came up, with the proposal component.

Keep the proposals current:

- Withdraw a proposal that no longer applies, with the reason.
- When a proposal's work got done some other way, mark it done and say
  where.
- To merge two proposals, join one into the other.
- When `pair read` prints that the reviewer declined a proposal, drop it
  and do not propose it again.
- When `pair read` prints that a proposal's linked session closed, its
  work is finished. Build on the result.

## Plans

Write a plan when the reviewer asks for one, or when the work is large
enough that the reviewer should agree on how it will be built before it
starts. Attach it to its proposal with `pair plan`.

A good plan lets an engineer or agent who saw none of the rounds build the
work without asking anything. It says:

- what the work achieves, and why;
- the approach, and the alternatives the rounds set aside, with the
  reasons;
- each change: the files, interfaces and data it touches, with every look
  and interface shown as the reviewer approved it;
- what the work leaves out;
- how to check that the work is done.

Keep it as short as that allows, and use code where code is clearer than
prose. Explore what you need to, such as a package you have not used, in a
scratch worktree, but build the work only after its proposal starts.
Settle every open question on a page before you attach the plan. When the
reviewer changes what the plan should say, attach the new version with
`pair plan`. `pair guide proposals.md` says how to build the plan's pages.

## Building a proposal's work

When `pair read` prints that a proposal started, build its work on a new
branch, from its plan when it has one, and name the branch on the first
page about the work. Publish each part as soon as the reviewer can judge
it. When the plan leaves something open, decide, and say on the next page
what you decided and why. Fix what the work needs as you go, and say on its
pages what you changed beyond what the proposal said. Record anything
separate as a new proposal.

The last page about the work explains it well enough that whoever owns the
project can review it and keep it. When the work runs in this session, run
`pair propose --done` after you publish that page.

## Subagents

A subagent works beside you, in its own context. Use one when a piece of
work can go on without holding up your next page, or when you need its
result but not the detail it reads to get there. Run pieces of work that
do not depend on each other in subagents at the same time, so the round's
pages are ready sooner, and start each one as soon as you know what it will
do.

Brief it with what to do, where to start, what earlier rounds found, how
long it should take, the session directory, and where to put what it
finds, with the sources. For work on a page, add the page's ID and
`pair progress --page ID --note "…"`, so it reports its own progress while
it works. Check each subagent's result before you publish anything from it.

## Lookup files

Before the session's first page, run `pair guide writing.md`,
`pair guide pages.md` and `pair guide components.md`. Run
`pair guide session.md` before you take a session over, resume it or pause
it, and `pair guide setup.md` when a `pair` command fails.
