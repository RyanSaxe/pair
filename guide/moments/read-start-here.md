The reviewer approved this proposal, and each proposal joined into it, and
asked you to build the work in this session. Where the reviewer's words in
`<pair_start>` ask for something different from the proposal, or more,
follow their words.

- Begin now, on a new branch. If the proposal has a plan, build from the
  plan's page sources in `plans/ID/src/` in the session's directory.
- Before you build, record the parts of the work with
  `pair propose --session-dir PATH --id ID --status-left "…"`, with one flag
  for each part.
- If you are in the middle of a round and have not published its Agreed
  yet, list the pages about this work in that round. Otherwise, publish
  them in the next round, which begins when the reviewer sends feedback.
- After you publish the last page about the work, run
  `pair propose --session-dir PATH --id ID --done`. If later feedback asks
  for changes to the work, run the same command with `--reopen` instead of
  `--done`.
