`pair start --from` created this session for one proposal from another
session, its parent, and the reviewer asked for a plan first. The proposal
and each proposal joined into it are printed below. Where the reviewer's
words in `<pair_start>` ask for something different, or more, follow their
words.

- Make this session's rounds lead to a plan, and only build after the
  reviewer chooses Build it.
- When you begin the build, record the parts of the work with
  `pair propose --session-dir PATH --id ID --status-left "…"`, using this
  session's directory and the proposal's ID printed below, with one flag for
  each part.
- When you need context from the parent session, read its page sources in
  its `src/` directory. Never run `pair start` on the parent session.
- Record any other work you find with `pair propose` in this session.
- Do not run `pair propose --done` for this proposal. The hub marks it done
  when the reviewer closes this session.
