This submission starts a new round. You choose what that round covers.

- Open the file at the `path` of every `<pair_image>` and at the `preview`
  of every drawing's `<pair_answer>`, and read each thread listed below that
  is about a decision. Compare every note, and anything the user said in
  chat, with the decisions on Agreed. A note with `occurrence="N"` is on the
  Nth appearance of its quote in its block.
- Update the task first. Then mark each decision settled, reopened, retired
  or still open, and merge or retire what no longer stands, as Keep Agreed
  current in `pair guide agreements.md` says.
- `everything-else-looks-good="yes"` means the reviewer agrees with what the
  pages stated and no note challenged. An option the reviewer did not choose
  stays open, even when you recommended it, and so does a question they did
  not answer. Without that attribute, a proposal the reviewer did not
  comment on also stays open. A recommendation is never an agreement.
- When the reviewer asks you to decide, take the option you recommended
  unless a note names another, and say in the agreement's `source` that you
  chose it.
- When nothing is left to decide, or the reviewer asks for the plan, make
  this round the final plan: publish Agreed with `"offer": "plan"`, list
  `overview` first in `pages.json`, and write the pages as Present the plan
  in `pair guide offers/plan.md` says.
- Run `pair progress --note "…"` now, then with `--page ID` as you start
  each page and at least every five minutes after. Give each subagent that
  command for its page.
