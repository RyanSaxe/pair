# Pair

## What a session is

In a pair session, you publish pages in rounds. The reviewer reads each
round in the browser, comments on any part of it and submits feedback. A
page explains code, a change or a topic, or puts proposals, options and
questions to the reviewer. A page about built work, yours or anyone's, such
as a pull request under review, explains it well enough that the reviewer
can own it without reading every line.

Agreed is the first page of every round. It states the task as you
understand it, then each decision settled so far, with its source. Change
the project only to carry out an offer the reviewer accepted.

Before then, try changes only in a git worktree inside the session directory
that `pair start` prints, or in a plain directory there when the project is
not a git repository. When the reviewer closes the session, the hub removes
each git worktree in the session directory and keeps its branch, so commit
there anything you need later. When a `pair` command prints that the
session is complete, stop working on the session.

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

Publish Agreed and the page list within minutes of starting a round, before
you research, build or write any page, so the reviewer can read the task
and the decisions while you work. The page list cannot change after that,
so choose the pages from what you already know.

Until the round's last page is published, report what you are doing with
`pair progress --note "…"` whenever a piece of work starts and at least
every five minutes, with `--page ID` for work on one page. The reviewer
sees each note as you send it. Waiting on a subagent is work in progress,
so keep reporting while you wait.

Publish each page as soon as it is complete and you have read it against
`pair guide writing.md`, whether you or a subagent wrote it, so the
reviewer can read it while you work on the next. After the last page, say
in chat what changed and end your turn.

Whenever you return to a session, after a wake message, an interrupted turn
or a takeover, run `pair read --session-dir PATH` first. It prints the
submission, or where the session stands, and the next step.

## What a round covers

Each submission starts a new round, and you choose what that round covers.
Cover what the reviewer can judge in one sitting: the decisions that matter
most now and the decisions they depend on, the most consequential first.
Publish sound pages now rather than wait to cover everything.

A planning round settles what the work is and why, then how to do it,
until another engineer could build it from the plan. Research by reading
and running the code, or by building a prototype in your work directory,
and change nothing the plan describes until the reviewer accepts it.
Agreed is the session's running summary, so add no summary page.

The reviewer can accept a round only when its Agreed names an offer in its
source: `"offer": "plan"` on the final plan, and `"offer": "finish"` on
every round in which you build the work. A build round builds every step
of the accepted plan.

When nothing in the task or the work is left to decide, or the reviewer
asks for the plan, make the next round the final plan, which someone who
saw none of the rounds builds from alone. Publish its Agreed with
`"offer": "plan"` and `overview` first in the page list, and write its
pages as Present the plan in `pair guide offers/plan.md` says.

## A good page

A page is about one subject and starts with it. Show each subject as a
figure, such as the code, a diagram, a mock or a chart, and write only what
the figure cannot show. Choose each component by what the reviewer must
see, and show a change to existing text or code in the before-after
component.

Where the work could go more than one credible way, show each way as an
option and recommend one. Each option is a different plan, not a different
label. When only one way is credible, propose it with no options. Resolve
routine details from the project, and ask a question only for context you
cannot learn from it. Never ask the reviewer to approve the task or a
proposal, because they can comment on anything without being asked.

When color marks something, say the same thing in text. Add no decorative
cards, labels, tags or pills that repeat nearby text. Delete any sentence
that could appear unchanged in another plan.

Once Agreed records a decision or an answer, leave its control out of later
rounds, so you do not ask the reviewer again. Return to an open decision
only with new evidence, a changed proposal or a sharper question, and show
a changed proposal against the version the reviewer saw, in the
before-after component. When decisions stay open across rounds, put them on
one page with a recommendation for each.

## Subagents

A subagent works beside you, in its own context. Use one when a piece of
work can go on without holding up your next page, or when you need its
result but not the detail it reads to get there. Start each one as soon as
you know what it will do.

Brief it with what to do, where to start, what earlier rounds found, about
how long it should take, the session directory, and where to put what it
finds, with the sources. For work on a page, add the page's ID and
`pair progress --page ID --note "…"`. Check each subagent's result before
you publish anything from it.

## Lookup files

Before the session's first page, run `pair guide writing.md`,
`pair guide pages.md` and `pair guide components.md`. Run
`pair guide session.md` before you take a session over, resume it or pause
it, and `pair guide setup.md` when a `pair` command fails.
