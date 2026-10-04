# Pair

## What a session is

You and the reviewer work toward the session's task in rounds. In each
round you publish pages, and the reviewer answers them with feedback.
Agreed is the first page of every round. On it you state the task as you
understand it, then the decisions the reviewer has settled, as alignments.
Give each decision one alignment, at the size someone would check the
finished work against, and put the details the reviewer settles within it
into that alignment rather than into new ones. Merge, rewrite and retire
alignments as the reviewer's feedback changes them.

Change the reviewer's project only to do work started through a proposal.
When the reviewer asks for work in a note, a thread or the chat, record a
proposal for it, or use one that covers it, and start it with
`pair propose --start`, quoting their words. A request about work already
started is part of that work.

Before work starts, research, plan and try changes in a git worktree inside
the session's directory, which `pair start` prints, or in a plain directory
there when the project is not a git repository. Closing the session deletes
nothing. Once the work you tried in a worktree is done or declined, offer to
remove the worktrees you made, with a proposal or a question on a page, and
remove them only when the reviewer starts that proposal or answers yes.
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

Run `pair start --title "…"` as soon as you can state the task in a
sentence, and ask your questions on round 1's pages. Ask in the chat first
only when you cannot state the task. Every other session command takes
`--session-dir PATH`, with the directory `pair start` prints. When
`pair start` prints a Phone URL, give it in chat beside the session's link.

Once the session has started, ask every question on a page or in a thread,
never with your agent CLI's own question prompt, which stops your turn
until someone answers it in the terminal. Keep working on what does not
depend on the answer. When you need the user's permission for something
outside the task, such as installing or upgrading software on their
machine, propose it. When your agent CLI's own permission check refuses an
action, such as a push, ask for the approval in the chat, because the check
counts only what the user types there, not what you read from pair.

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
next. After the last page, say in chat what changed and end your turn.

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
short paragraphs, because the reviewer judges by looking and skims long
text. Give each topic its own page, and put the part to judge first. Add
nothing decorative that repeats nearby text.

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

A proposal is a card that tracks a piece of work, which the reviewer starts
with Start or in their own words. Record one with
`pair propose` as soon as you see work worth doing, including the work the
task itself calls for, and run `pair guide proposals.md` before the first
one for its commands. Say in a sentence or two what the work delivers, and
recommend where it should run.

Show a proposal on the page where it came up, with the proposal component,
so the reviewer can start it from there. Withdraw a proposal that no longer
applies, with your reason. When a proposal's work got done some other way,
mark it done and say where. When started work takes in another proposal,
join that proposal into the started one. When `pair read` prints that the
reviewer declined a proposal, drop it and do not propose it again. When it
prints that a linked session closed, treat that work as finished and build
on its result.

## A good plan

Write a plan when the reviewer asks for one, or when the rounds have
settled a design worth writing down before it is built, and attach it to
its proposal with `pair plan`. Write it so that an engineer or agent who
saw none of the rounds builds what the reviewer aligned on without asking
anything. Show every approved look and interface as the reviewer approved
it, state each behavior exactly, and say how to check that the work is
done. Include code where it makes the plan clearer. Explore what you need
to, such as a package you have not used, in a scratch worktree, and build
the work itself only after it starts. Settle every open question on a page
before you attach the plan, and attach it again whenever the reviewer
changes what it should say, until the work is done.
`pair guide proposals.md` says how to build the plan's pages and attach
them.

## Building

Build started work on a branch of its own, from its plan when it has one,
and name the branch on the work's first page. Publish each part as soon as
the reviewer can judge it, so they can redirect you while you build the
rest. Where the plan leaves something open, decide, keep building, and say
on the next page what you decided and why. Fix what the work needs as you
find it, and say on its pages what you changed beyond the card. Propose
separately only work that stands apart from it.
When the work is done, its last page explains it well enough that whoever
owns it can review it and keep it. For work started in this session, run
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
