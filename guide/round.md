# Run one review round

Every round has the same goals. The reviewer should be reading within
minutes and never reading something half done. Publish Agreed and the page
names first, then each page once it is complete, so a thorough round
still starts quickly. Research what this round's pages need, not
everything the final plan will. Give the reviewer a round they can work
through in one sitting, and show each subject with the visual that lets
them judge it. The final plan must stand on its own for someone who saw
none of the rounds. [quality.md](quality.md) has the detail behind these
goals. Reread it when a page or the plan needs more than this paragraph.

When the reviewer submits, the hub sends you a wake message that names
`pair ack`. Every session command is `pair COMMAND --session-dir PATH`, with
the path from the wake message. `pair start`, `pair ack`, `pair read`,
`pair progress` and `pair publish` print the next step. `pair guide`,
`pair build` and `pair diff` take no session.

## Tell the reviewer what you are doing

Run `pair ack` first when a wake message arrives. It shows the reviewer that
you have their submission, without reading it, and prints the next step.

From the first round on, run `pair ack --note "…"` whenever you start
something the reviewer would want to know about, such as reading their
feedback, checking the code a page depends on, planning the pages, writing a
page or waiting for subagents. Write the note for the reviewer, in 80
characters or fewer. `pair progress --start` shows which page you are on,
and a note says what you are doing on it:
`pair ack --note "Adding last month's CI failures to the retry page"`.

Report whenever the work changes, and at least every five minutes.
`pair read`, `pair progress` and `pair publish` are reports too, and each
clears the last note. A subagent that writes a page reports with
`pair progress` and `pair ack` itself.

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
- Open the image at every `attachments` path on a note, and the
  `previewPath` PNG of a drawing answer. `scenePath` names the file with the
  drawing's editable shapes.

Update the task first, because feedback can change what is being built.
Then mark each decision settled, reopened, retired or still open. A
recommendation is not an agreement. Read [agreements.md](agreements.md)
before changing Agreed.

## Publish the round

1. Plan the round: the decisions that matter most now, in coherent pages
   the reviewer can work through in one sitting, the most consequential
   first. Write the pages that follow Agreed to `pages.json` as
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
   same time. Independent pages can be worked on in parallel, by subagents
   where the harness has them. To revise an earlier page, copy its source
   from the session's `src/<round>/<page-id>/` and change its `round` to
   this one.
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
failure. Open a page in a browser only when it has CSS or a script you wrote
and you cannot judge it from the source.
