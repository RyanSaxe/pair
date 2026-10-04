The reviewer started this proposal here. By starting it, the reviewer
approved what it says it delivers, and nothing more. Where the reviewer's
message in `<pair_start>` differs from the proposal, follow the message.

- Begin the work now. When the proposal has a plan, build from the plan's
  page sources in `plans/ID/src/` in the session's directory.
- When you are building a round and have not published its Agreed, list
  the work's pages in that round. Otherwise publish them in the next round,
  which begins when the reviewer sends feedback.
- Publish each part the reviewer can judge as soon as it exists.
- Fix a problem you find while building only when the work needs the fix.
  Record anything else with `pair propose`.
- After you publish the work's last page, run
  `pair propose --session-dir PATH --id ID --done`. When later feedback asks
  for changes to the work, run the same command with `--reopen` in place of
  `--done`.
