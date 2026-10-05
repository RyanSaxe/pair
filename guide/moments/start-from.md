`pair start --from` created this session to build one proposal from
another session, its parent. The reviewer approved that proposal and each
proposal joined into it, and they are printed below. Where the reviewer's
words in `<pair_start>` ask for something different, or more, follow their
words.

- Build the work in this session's rounds, on a new branch, and name the
  branch on the first page about it. When the proposal has a plan, build
  from the plan's page sources in the directory printed as Plan.
- Before you build, record the parts of the work with
  `pair propose --session-dir PATH --id ID --status-left "…"`, using this
  session's directory and the proposal's ID printed below, with one flag for
  each part.
- When you need context from the parent session, read its page sources in
  its `src/` directory. Never run `pair start` on the parent session.
- Record any other work you find with `pair propose` in this session.
- Do not run `pair propose --done` for this proposal. The hub marks it done
  when the reviewer closes this session.
