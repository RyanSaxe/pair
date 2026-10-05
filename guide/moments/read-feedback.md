This feedback begins a new round, and you decide what it covers.

- Open the file at the `path` of every `<pair_image>` and at the `preview`
  of every drawing's `<pair_answer>`. Read each thread listed below that is
  about a decision.
- Compare every note, and anything the reviewer said in the chat, with the
  alignments on Agreed. `occurrence="N"` on a note means the reviewer
  quoted the Nth appearance of that text in its block.
- Update Agreed's task first, then its alignments, as
  `pair guide agreements.md` describes.
- `everything-else-looks-good="yes"` means the reviewer agrees with
  everything your pages said, except where a note says otherwise. A
  decision where they chose no option is still not settled, even one you
  recommended, and neither is a question they did not answer. Without that
  attribute, treat a recommendation they did not comment on as unsettled.
- When the reviewer asks you to decide, take the option you recommended
  unless a note names another, and say in the alignment's `source` that you
  chose it.
- Keep building each proposal listed under "Proposals you are still
  building in this session", whether or not the feedback mentions it. List
  a page in this round for each part of that work the reviewer can judge
  by the end of the round.
- When a note asks you for a piece of work, record a proposal for it unless
  one already covers it. Before you build the work, mark that proposal
  started with
  `pair propose --session-dir PATH --id ID --start WHERE --quote "…"`,
  quoting the note, and add `--page ROUND/PAGE` with the note's round and
  page.
- When a proposal the reviewer has not approved no longer applies, withdraw
  it with `pair propose --session-dir PATH --id ID --withdraw --reason "…"`.
  When its work was finished some other way, run the same command with
  `--done --where "…"` instead, saying where.
- Run `pair progress --note "…"` now. After that, run it with `--page ID`
  when you start each page and at least every five minutes until you
  publish it, and give each subagent that command for its page.
