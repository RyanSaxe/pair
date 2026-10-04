# Pair

## What a session is

You and the reviewer work toward the session's task in rounds. In each
round you publish pages, and the reviewer answers them with feedback.
Agreed is the first page of every round. It states the task as you
understand it, then every decision the reviewer has settled, with its
source. Each settled decision on Agreed is an alignment.

Only change the reviewer's project when they told you to make a specific
change, by starting a proposal or in their own words. A question, a
suggestion or agreement with a page is not an instruction, and when you
cannot tell, treat the words as not one and record a proposal. An
instruction covers the change it names and nothing more. When you make a
change from their words, show it on the next page and quote them.

Before you have an instruction, research, plan and try changes only in a
git worktree inside the session's directory, which `pair start` prints, or
in a plain directory there when the project is not a git repository. The
hub deletes nothing when the reviewer closes the session. Once the work you
tried in a worktree there is done or declined, offer to remove the worktrees
you made by recording a proposal or asking a question on a page, and remove
them only when the reviewer starts that proposal or answers yes. When a
`pair` command prints that the session is complete, stop working on the
session.

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

Learn what you can from the project. Ask the user the few questions the
project cannot answer, in one message, then run `pair start --title "…"`.
Ask every later question on a page. Every other session command takes
`--session-dir PATH`, with the directory `pair start` prints. When
`pair start` prints a Phone URL, give it in chat beside the session's link.

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

A proposal is work you suggest and the reviewer decides on. Record one with
`pair propose` as soon as you see work worth doing, including the work the
task itself calls for, and run `pair guide proposals.md` before the first
one for its commands. Say exactly what it delivers, because starting it
approves only that. Recommend where it should run and whether it needs a
plan first.

Show a proposal on the page where it came up, with the proposal component,
so the reviewer can start it from there. When `pair read` prints that the
reviewer declined a proposal, drop it and do not propose it again. When it
prints that a linked session closed, treat that work as finished and build
on its result.

## A good plan

When nothing is left to decide, or the reviewer asks for the plan, write
the plan and attach it to its proposal with `pair plan`. Write it so that
an engineer or agent who saw none of the rounds builds exactly what the
reviewer aligned on, without asking anything. Show every approved look and
interface as the reviewer approved it, state each behavior exactly, and say
how to check that the work is done. Include code where it makes the plan
clearer, but write the plan from what the conversation decided, without
building the work to find out. Settle every open question on a page before
you attach the plan. `pair guide proposals.md` says how to build the plan's
pages and attach them.

## Building

Build the approved work from its plan, when it has one. Publish each part
as soon as the reviewer can judge it, so they can redirect you while you
build the rest. When the plan leaves something open, decide in line with
the plan, keep building, and say on the next page what you decided and why.
Fix a problem you find while building only when the approved result needs
the fix, say so on the next page, and propose anything else.
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
