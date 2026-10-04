`pair start --from` created this session for one proposal of the parent
session, printed below. By starting that proposal, the reviewer approved
what it says it delivers and may change, and nothing more. Where the
reviewer's message in `<pair_start>` differs from the proposal, follow the
message.

- Build the work in this session's rounds. When the proposal has a plan,
  build from the plan's page sources in the directory printed as Plan.
- Publish each part the reviewer can judge as soon as it exists.
- Read the parent's page sources, in its `src/` directory, when you need
  its context. Never run `pair start` on the parent session.
- Fix a problem you find while building only when the work needs the fix
  and the proposal allows that change. Record anything else with
  `pair propose` in this session.
- Run no `pair propose --done` for this proposal, because the hub marks it
  done when the reviewer closes this session.
