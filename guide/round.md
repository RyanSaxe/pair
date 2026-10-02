# Run one round

## Required in every round

Follow these in every round, the first included:

1. Publish Agreed and the page list within minutes of reading the feedback,
   or of starting the first round, before you research, build or write any
   page.
2. From reading the feedback, or starting the first round, until the
   round's last page publishes, report what you are doing with
   `pair ack --note` at least every five minutes: without `--page` before
   Agreed publishes, and with `--page ID` for each page in progress after
   it.
3. Publish each page as soon as it is complete. Never keep finished pages
   back to publish them together.

## Goals

In every round, deliver good work quickly. Good work is correct, gives the
reviewer what they need, and states nothing you have not checked. Quickly
means the reviewer is reading within minutes, new pages keep arriving, and
your latest progress note says what you are working on. This holds in a
build round as much as in a planning round, because the reviewer reads each
page while you work on the next. How much a round covers depends on its
kind, as Kinds of rounds describes.

Work in parallel to get both. Give any of the round's work that would delay
the next page to a background subagent, and keep publishing while it runs.
The Subagents section explains how.

Show each subject with the visual that lets the reviewer understand or judge
it. Before you write a page, look through every component you can use. The
components pair ships are in the [component index](components.md), and the
user's own are in `$XDG_CONFIG_HOME/pair/components/`, or in
`~/.config/pair/components/` when `XDG_CONFIG_HOME` is not set.
[quality.md](quality.md) has the detail behind these goals. Reread it
whenever these paragraphs are not enough for a page or the plan.

When the reviewer submits, the hub sends you a wake message that names
`pair ack`. Every session command is `pair COMMAND --session-dir PATH`, with
the path from the wake message. `pair start`, `pair ack`, `pair read`,
`pair progress` and `pair publish` print the next step. `pair guide`,
`pair build` and `pair diff` take no session.

## Kinds of rounds

Each round is a planning round, a build round or a round that explains.
How much it covers, whether you change the project and what its pages are
depend on its kind. The rules above apply to every kind.

In a planning round, research a decision by reading the code, running it
or building a prototype in your work directory. Do not make the change the
plan describes, because the reviewer has not accepted the plan, and their
feedback can change it.

Before the final plan, move the plan in each round as far as the reviewer
can take it in one sitting. With too few decisions, planning takes more
rounds than it needs. With too many, the reviewer skims and decides without
judging. Put the decisions that matter most now in the round, together with
the decisions they depend on, in coherent pages with the most
consequential first. Shipping beats perfection in these rounds: publish
sound pages the reviewer can use now instead of waiting to cover
everything. Agreed is the only running context, so add no overview or
summary page.

In the last planning round, present the final plan. It describes all of
the work in detail and leaves nothing for a later round, because an
engineer or agent who saw none of the rounds builds from it alone.
[quality.md](quality.md) says what it contains.

The rounds in which you build an accepted plan are build rounds: the first
after the acceptance, and each one after feedback on the build. Build every
step of the plan, and leave nothing for a later round. The pages are the
steps of the plan and then the pull request description, as
[offers/plan.md](offers/plan.md) describes.

In a round that explains, you help the reviewer understand code, a change
or a topic. As before the final plan, cover what the reviewer can take in
one sitting and leave the rest for a later round.

## Subagents

A subagent runs work at the same time as you and keeps that work's detail
out of your context. Decide how many to run and what each one does, and
start each one as soon as you know what it will do. Give a subagent only
the kind of work you do in that round: research in a planning round or a
round that explains, and steps of the plan in a build round.

Divide the work so that each page depends on as little of it as possible,
and publish each page as soon as it is complete, whether you or a subagent
wrote it. You answer for every page, so check a subagent's results before
they reach the reviewer.

Before the final plan, and in a round that explains, keep research that will
take much longer than the rest off this round's pages, because the reviewer
cannot send feedback until every page has published. Run it in the
background as a hedge. Starting it now can spend tokens on research that
the feedback makes unnecessary, but starting it in a later round makes the
reviewer wait for it. When the next round starts, decide with the feedback
whether its results become a page, change a page, or only inform your own
work. Most of the research is done by then, so adapting it takes little
time.

A build round has no hedges, because every step of the plan is on one of
its pages.

Tell each subagent what to do, where to start and what earlier rounds
already found, so that it does not repeat their work. Give it a rough
estimate of how long the work should take, the session directory and the ID
of the page it works on, so that it reports its own progress with
`pair ack --note "…" --page ID`, or without `--page` for a hedge, and says
when it expects to take longer. Have it put its results in your work directory,
with their sources and anything it could not settle.

When a subagent starts or finishes, say so in a note on its page, or in a
note without `--page` for a hedge. If one is still running when the round's
last page is ready, publish the page and end your turn.

## Tell the reviewer what you are doing

Run `pair ack` first when a wake message arrives. It shows the reviewer that
you have their submission, without reading it, and prints the next step.

From the first round on, run `pair ack --note "…"` whenever you start
something the reviewer would want to know about, such as reading their
feedback, checking the code a page depends on, planning the pages, writing a
page or waiting for subagents. Write the note for the reviewer, in 80
characters or fewer. `pair progress --start` shows which page you are on.
Add `--page ID` to a note about one page's work, and the note shows on that
page's row of the progress card:
`pair ack --note "Adding last month's CI failures" --page retry`. A note
without `--page` shows under the progress card's title, for work that is not
one page's, such as reading the feedback, planning the pages or a hedge for
a later round.

Report whenever the work changes, as well as every five minutes as Required
in every round says. A page's note stays until the page publishes or gets a
newer one. `pair read`, `pair progress`, `pair publish` and `pair reply`
count as reports too. A subagent that writes a page reports with
`pair progress` and `pair ack --page` itself.

## Answer a thread

The reviewer can send a note to you at once as a thread, and the hub sends
you a wake message for each message in it, whether or not you are working.
Run the `pair reply` command in the wake message. `pair reply` prints the
thread and how to answer it. When the reviewer settles a decision in a
thread, cite the thread as the decision's source on Agreed, as
[agreements.md](agreements.md) describes.

## Read the feedback

Run `pair read`. It returns the submission as `event.payload` and marks it
read. Its `intent` is `feedback-only` for feedback and `accept` for an
acceptance, and its `groups` field contains the choices, answers and notes.
Also read anything the user said in the chat since the last round. For an
acceptance, read the offer's guide file that the `next` line names, and
follow the action the reviewer chose.

- `groups.alignUnflagged: true` means the reviewer agrees with what the
  pages stated that no note challenges: a proposed design, wording or plan.
  It answers no control. A choice with nothing selected stays open, even when
  an option was recommended, and a checklist is exactly the boxes the
  reviewer left checked, which can be none. A submission may contain nothing
  but this. When the field is `false` or missing, silence is not agreement.
- The reviewer anchors a note to one block but may mean it for other
  decisions too. Read each note against every decision.
- A note on words the reviewer selected has them in `quote`. When those
  words appear more than once in the note's block, `occurrence` is the
  number of the one the reviewer selected, such as 2 for the second. A note
  without `occurrence` is on the first.
- Open the image at every `attachments` path on a note, and the
  `previewPath` PNG of a drawing answer. `scenePath` names the file with the
  drawing's editable shapes.

Update the task first, because feedback can change what is being built.
Then mark each decision settled, reopened, retired or still open. A
recommendation is not an agreement. Read [agreements.md](agreements.md)
before changing Agreed.

A choice or question the reviewer did not answer stays open, even one with a
recommended option, whatever `groups.alignUnflagged` says. Do not repeat an
open decision's unchanged page. Return to it with new evidence, a changed
proposal or a sharper question. When the reviewer asks you to decide, or
asks for the complete plan while a choice is still open, decide. Take the
recommended option unless the reviewer chose another in a note. Record the
decision on Agreed and continue. When a proposal changes, show it against
the version the reviewer saw. If two rounds in a row resolve nothing, put
what remains on one page with a recommendation for each item.

## Publish the round

1. Choose the round's pages from what you already know, as Kinds of rounds
   describes for this round's kind. Start the research or the build after
   Agreed publishes, as Required in every round says. The page list cannot
   change after that. Write the pages that follow Agreed to `pages.json` as
   `{ "pages": [{ "id": "topic", "title": "Topic" }] }`. A settled topic
   leaves the list, and an unchanged page is not repeated.
2. Decide whether the round has an offer, which lets the reviewer accept
   it. Name the offer in Agreed's source only, because `pair build` refuses
   any other page whose source names one. An offer is optional, and a round
   without one lets the reviewer only send feedback.
   - `"offer": "plan"` only on a complete plan: nothing in the task or the
     work is left to decide, the pages follow the final plan section of
     [quality.md](quality.md), and `overview` is first in `pages.json`.
   - `"offer": "finish"` on a round in which you build the work: the build
     round, and each follow-up round after feedback on the build. Name it
     when you publish Agreed, before the work is done.
   - No offer on any other round.
3. Build Agreed and publish it with the list before writing any other page.
   [pages.md](pages.md) says where the source directories, built pages and
   `pages.json` go.

   ```sh
   pair build SRC/agreed/agreed.json OUT/agreed.html
   pair publish --file OUT/agreed.html --pages SRC/pages.json --source SRC/agreed
   ```

4. Mark a page started as soon as work on it begins, research included:
   `pair progress --start ID`, or `--start "a|b"` for pages worked on at the
   same time. Independent pages can be worked on in parallel by subagents.
   To revise an earlier page, copy its source from the session's
   `src/<round>/<page-id>/` and change its `round` to this one.
5. Read each page against [quality.md](quality.md) and
   [writing.md](writing.md), then build and publish it as soon as it is
   done. Do not keep finished pages back to publish them together at the
   end. Publishing marks the page ready.

   ```sh
   pair build SRC/ID/ID.json OUT/ID.html
   pair publish --file OUT/ID.html --source SRC/ID
   ```

6. Publishing the last page completes the round. Say in the chat what
   changed, then end your turn.

A published page cannot change in this round. `pair build` is the
publication check: it lists every structural problem and writes nothing on
failure. It cannot know the round's other pages, so `pair publish` checks
that each `#` link names a page of the round or an element on its own page,
and refuses the page when one does not. Open a page in a browser only when
it has CSS or a script you wrote and you cannot judge it from the source.

## Side work

Record side work when a comment or your own work turns up something outside
the task, and when the reviewer asks for it in a note. Do not add it to the
task.

```sh
pair side-work add --title "Delete visual-review" --text "The skill is deprecated but still installed." --source "From the conversation"
```

The title names the work in a few words, the text says what it is and why in
a sentence or two, and the source says where it came from, such as the
reviewer's note or the command that showed it. The frame lists each item in
Agreed's Side work tab, where the reviewer can comment on it, drop it or
start it in parallel. A note on an item has the item's ID in `sideWorkId`,
and `pair status` lists every item under `sideWork`.

When the reviewer presses Start in parallel, the hub sends you a wake message
with the steps for the item. Follow them, and report each change with the
`pair side-work update` command in the message. The hub takes
`pair side-work` from any agent, so an agent you brief can report its own
progress.

When the reviewer asks for a side-work item in this session's plan, add the
item to Agreed, then run
`pair side-work update ID --state planned --session-dir PATH`.
