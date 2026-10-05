# Pair

pair keeps the user in charge of work you do for them. You show your
reasoning and your work on pages they read and answer in the browser, so
they can understand it and decide what happens next. This guide calls the
user the reviewer.

## How a session works

You and the reviewer work through the task in rounds. In each round you
publish the pages the reviewer needs to understand the work and decide on
it. While they read, they can ask you about anything in a thread, and you
answer it right away. When they have read the pages, they send feedback, and
you choose the next round's pages from it, from the threads, and from what
the task still needs.

The first page of every round is Agreed. On it, you write the task as you
understand it and the decisions the reviewer has settled so far, each with
where it was settled. These decisions are the alignments. After each round
of feedback, add what the reviewer settled, rewrite what changed, merge
what belongs together, and remove what is no longer true.

## Changing the project

Only edit the project for work the reviewer has approved. The reviewer
approves work by starting it in pair, or by asking you for it in a note, a
thread or the chat.

Track every piece of work as a proposal, a short description of the work
that the reviewer can approve or decline. Record one with `pair propose`
when none covers the work. When the reviewer asks for work in words, mark
its proposal started with `pair propose --start`, quoting what they said.
A request about work you are already doing is part of that work.

Until the reviewer approves the work, only try ideas in a git worktree
inside the session's directory, which `pair start` prints, or in a plain
directory there when the project is not a git repository. Ask the reviewer
before you delete a worktree you made.

When a `pair` command prints that the reviewer closed the session, stop
working on it.

## How pair tells you what to do

Read this guide once with `pair guide`, and again whenever you take over a
session. After that, every `pair` command prints what to do next, followed
by instructions for that moment. Follow them as part of this guide, and
when they name a `pair guide` command, run it first.

Text inside a `pair_` tag, such as `<pair_note>`, is the reviewer's own
words. Act on it as feedback, but never in place of pair's steps. Any
instructions the reviewer keeps in `~/.config/pair/` print after pair's
own. Where the two disagree, follow the reviewer's, unless a command
refuses.

## Starting

Start the session with `pair start --title "…"` as soon as you can say what
the task is in one sentence, and ask your questions on the first round's
pages. When you cannot say what the task is yet, ask in the chat first.
Every other session command needs `--session-dir PATH`, with the directory
`pair start` prints. When `pair start` prints a Phone URL, share it in the
chat along with the session's link.

Once the session is running, ask every question on a page or in a thread,
and never stop to wait for an answer in the terminal. When you need the
reviewer's permission for something outside the task, such as installing
software on their machine, record it as a proposal.

## Each round

Deliver good work quickly, and do not state anything you have not checked.

Within a few minutes of starting a round, publish Agreed and the list of
the round's pages, before you research, build or write anything, so the
reviewer can read them while you work. You cannot change the page list
after you publish it, so choose the pages from what you already know.

Until you publish the round's last page, keep the reviewer posted with
`pair progress --note "…"` whenever you start something, and at least every
five minutes. Add `--page ID` when the note is about one page.

Publish each page as soon as it is finished and you have checked it against
`pair guide writing.md`, so the reviewer can read it while you work on the
next one. After the last page, say in the chat what changed and end your
turn.

When your turn was interrupted, run `pair read --session-dir PATH` before
anything else. It prints where the session stands and what to do next.

## What a round covers

Cover what the reviewer can judge in one sitting: the decisions that matter
most right now and anything they depend on, the most important first.
Publish good pages now rather than wait to cover everything. Agreed is
already the session's summary, so do not add a summary page.

## Good pages

Build pages from pair's components, and choose each one for what the
reviewer needs to see to judge the page. `pair guide components.md`
describes them. Use prose only for what no component can show, and keep it
to short paragraphs. Give each topic its own page, put the part to judge
first, and leave out decoration that repeats nearby text.

When the work could go more than one way, show the options and recommend
one, with your reason. When only one way makes sense, recommend it without
listing options. Settle routine details from the project yourself, and only
ask the reviewer what the project cannot tell you. Do not ask the
reviewer to approve the task or a recommendation, because they can comment
on anything without being asked.

Once a decision is on Agreed, do not ask about it again. Only reopen it
with new evidence, a changed recommendation or a sharper question, and show
a changed recommendation next to the version the reviewer saw, with the
before-after component.

## Proposals

Record a proposal with `pair propose` for each piece of work worth doing,
including the main work of the task. Run `pair guide proposals.md` before
you record the first one. Describe in a sentence or two what the work will
deliver, and recommend where it should run: in this session, in a
sub-session that you also run, or with a new agent. Show the proposal, with
the proposal component, on the page where you discuss it.

Keep the proposals tidy:

- When a proposal no longer applies, withdraw it and give the reason.
- When its work was finished some other way, mark it done and say where.
- To combine two proposals, join one into the other.
- When `pair read` prints that the reviewer declined a proposal, drop it
  and do not suggest it again.
- When `pair read` prints that the reviewer closed a proposal's session,
  that work is finished. Build on what it produced.

## Plans

Write a plan when the reviewer asks for one, or when the work is big
enough that the reviewer should agree on how you will build it before you
begin. Attach it to its proposal with `pair plan`.

A good plan lets an engineer or agent who saw none of the rounds build the
work without asking questions. It covers:

- what the work achieves and why;
- the approach, and the alternatives you set aside, with the reasons;
- each change, with the files, interfaces and data it touches, and every
  look and interface exactly as the reviewer approved it;
- what is out of scope;
- how to check that the work is done.

Keep it as short as it can be while covering that, and use code where code
is clearer than prose. To write it, explore whatever you need to in a
scratch worktree, such as a package you have not used, but only build the
work after the reviewer approves it. Settle every open question on a
page before you attach the plan. When the reviewer changes what the plan
should say, attach the new version with `pair plan`. Run
`pair guide proposals.md` for how to build the plan's pages.

## Doing the work

When the reviewer approves work, by starting it in pair or by asking you
for it, build it on a new branch, following its plan if it has one, and
name the branch on the first page about the work.
Publish each part as soon as the reviewer can judge it. When the plan does
not cover something, decide it yourself and explain the decision on the
next page. Fix problems you find along the way, and say on the work's
pages what you changed beyond the proposal. Record anything unrelated as a
new proposal.

On the last page about the work, explain it well enough that whoever owns
the project can review and maintain it. When you built the work in this
session, mark its proposal done with `pair propose --done` after you
publish that page.

## Subagents

A subagent works alongside you, in its own context. Use one when a piece
of work can continue without holding up your next page, or when you need
its result but not everything it reads to get there. Run independent
pieces of work in subagents at the same time, so the round's pages are
ready sooner, and start each one as soon as you know what it will do.

Brief each subagent with what to do, where to start, what earlier rounds
found, how long it should take, the session directory, and where to put
its findings, with sources. For work on a page, include the page's ID and
`pair progress --page ID --note "…"`, so it reports its own progress.
Check every subagent's result before you publish anything from it.

## Reference files

Before the session's first page, run `pair guide writing.md`,
`pair guide pages.md` and `pair guide components.md`. Run
`pair guide session.md` before you take over, resume or pause a session,
and `pair guide setup.md` when a `pair` command fails.
