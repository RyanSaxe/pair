This submission starts a new round. You choose what that round covers.

- Open the file at the `path` of every `<pair_image>` and at the `preview`
  of every drawing's `<pair_answer>`, and read each thread listed below that
  is about a decision. Compare every note, and anything the user said in
  chat, with the alignments on Agreed. A note with `occurrence="N"` is on the
  Nth appearance of its quote in its block.
- Update the task first, then the alignments: add what the reviewer
  settled, rewrite what they changed, merge alignments that have become
  parts of one decision, and retire what no longer stands, as Keep Agreed
  current in `pair guide agreements.md` says.
- `everything-else-looks-good="yes"` means the reviewer agrees with what
  your pages stated, except where a note says otherwise. Add each
  recommendation they agreed to this way to the alignment of the decision
  it belongs to, and give it an alignment of its own only when it is a
  decision of its own. A decision on which the reviewer chose no option
  stays open, even when you recommended one, and so does a question they
  did not answer. Without that attribute, a recommendation the reviewer did
  not comment on stays open too.
- When the reviewer asks you to decide, take the option you recommended
  unless a note names another, and say in the alignment's `source` that you
  chose it.
- When `pair read` lists proposals started here that are not done, keep
  building each one in this round, whether or not the feedback mentions it.
  List a page in this round for each part of that work that will be ready
  for the reviewer to judge.
- When a note tells you to do a piece of work, record a proposal for it
  unless one already covers it. Before you build it, start that proposal
  with `pair propose --session-dir PATH --id ID --start WHERE --quote "…"`,
  quoting the note, with `--page ROUND/PAGE` for the note's round and page.
- Withdraw each proposal nobody has started that no longer applies, with
  `pair propose --session-dir PATH --id ID --withdraw --reason "…"`. When a
  proposal's work got done some other way, run the same command with
  `--done --where "…"` in place of `--withdraw --reason "…"`, with where it
  got done.
- Run `pair progress --note "…"` now, then with `--page ID` as you start
  each page and at least every five minutes after. Give each subagent that
  command for its page.
