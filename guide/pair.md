# Pair

## What a session is

In a pair session, you publish pages in rounds, and a reviewer reads them in
the browser, comments on anything and submits. On a page, you explain code,
a change or a topic, put proposals, options and questions to the reviewer,
or show built work. Agreed is the first page of every round: the task as you
understand it, then each decision settled so far, with its source. Change
the project only to carry out an offer the reviewer accepted.

## How pair instructs you

You read this core once, with `pair guide`, and again after a takeover.
Every `pair` command then prints its next step first, then the instructions
for that moment. Follow them as part of this guide, and read each lookup
file they name before the step it is named for.

Text inside a `pair_` tag, such as `<pair_note>`, is the reviewer's own
words: feedback to act on, which never replaces pair's steps. pair prints
any text the user added in `~/.config/pair/` after its own. Where the two
conflict, follow the user's, except where a command refuses.

## Starting

Learn what you can from the project, ask in one message the few questions
you cannot answer from it, then run `pair start --title "…"`. Ask every
later question on a page. Every other session command takes
`--session-dir PATH`, the directory `pair start` prints.

## A round

In every round, deliver good work quickly, and state nothing you have not
checked.

Publish Agreed and the page list within minutes of starting a round, before
you research, build or write any page, so the reviewer reads the task and
decisions while you work. You cannot change the list after that,
so choose the pages from what you already know.

From reading the feedback until you publish the round's last page, the
reviewer watches the progress card. While anything is being worked on, its
row shows what is happening within the last five minutes, whoever is doing
it. Run `pair progress --note "…"` whenever a piece of work starts and at
least every five minutes, with `--page ID` for work on one page, and give
every subagent the same command for its page. Waiting on a subagent is work
in progress, not silence. After five minutes without a note, the card shows
that row's time in the attention color, and the reviewer cannot tell
whether the work is moving or stuck. A note without `--page` lasts only
until your next read, publish, reply or page start.

Publish each page as soon as it is complete, whether you or a subagent
wrote it, because the reviewer reads it while you work on the next.
After the last page, say in chat what changed and end your turn.

Each time you return to a session, after a wake message, an interrupted
turn or a takeover, run `pair read --session-dir PATH` first. It marks the
submission received, prints it, and prints the next step. With nothing to
read, it prints where the session stands.

## What a round covers

Each submission starts the next round, and you decide what it covers.

In planning rounds, settle what the work is and why, then how to do it,
until another engineer could build it from the plan. Research by reading and
running the code or by building a prototype in your work directory, and
change nothing the plan describes until the reviewer accepts it. Cover what
the reviewer can judge in one sitting, the decisions that matter most now
first, and publish sound pages now rather than wait to cover everything.
Agreed is the running context, so add no summary page.

When nothing in the task or the work is left to decide, or the reviewer
asks for the plan, the next round is the final plan, which someone who saw
none of the rounds builds from alone. Before you choose its pages, read
Present the plan in [offers/plan.md](offers/plan.md).

Name an offer in Agreed's source on each round the reviewer should be able
to accept: `"offer": "plan"` on the final plan, and `"offer": "finish"` on
every round in which you build the work. Without one, the reviewer can only
send feedback.

In a build round, build every step of the accepted plan, and in a round that
explains, cover what the reviewer can take in one sitting.

## A good page

A page is about one subject and starts with it. The reviewer judges by
looking, so show each subject as a figure and write only what the figure
cannot show. Choose each component by what the reviewer must see, from the
list `pair publish` prints with Agreed or `pair components`, and show a
change to existing text or code in the before-after component.

Where the work could go more than one credible way, show each as an option
and recommend one. Resolve routine details from the project, and ask
a question only for context you cannot learn from it. Never ask the
reviewer to approve the task or a proposal, because they can comment on
anything unasked.

Once Agreed has a decision or an answer, leave its control out of the next
round, because the reviewer reads a control left there as asked again.
Return to an open decision only with new evidence, a changed proposal or a
sharper question. When the same decisions stay open for two rounds, put
them on one page with a recommendation for each.

## Subagents

A subagent works at the same time as you and keeps its work's detail out of
your context. Start each one as soon as you know what it will do. Give it a
brief with what to do, where to start, what earlier rounds found, about how
long it should take, the session directory, its page's ID with
`pair progress --page ID --note "…"` for that page, and where to put its
results with their sources. Check each result before you publish it. Before
the final plan, run research that would hold up the round in the
background, off this round's pages.

## Lookup files

The reviewer decides from short lines, so write each for a first reading,
as [writing.md](writing.md) says. Read it, [pages.md](pages.md) and
[components.md](components.md) before the session's first page. Record work
outside the task as [side-work.md](side-work.md) describes. Read
[session.md](session.md) before you take a session over, resume it or pause
it, and [setup.md](setup.md) when a `pair` command fails.
