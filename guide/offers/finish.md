# The finish offer

A round with `"offer": "finish"` holds built work that is complete, and its
last page is the pull request description. The reviewer accepts it with
Finish without a PR or Open a PR, and `pair read` returns the acceptance with
the chosen action in `action`.

Read the comments first. The acceptance's `groups` hold the comments and
choices the reviewer drafted before accepting.

## Finish without a PR

The action is `finish`. The work stays committed on its branch. Run
`pair complete` and say in chat which branch holds the work.

## Open a PR

The action is `pull-request`. Open a pull request from the build's branch
the way the project's own instructions say. Use the round's last page as its
body: its source is the HTML fragment in the session's
`src/<round>/<page-id>/`. The acceptance may carry `guidance` of up to 4,000
characters about the pull request. Follow it.

Watch the pull request's CI until it passes, and fix each failure on the
branch. Then give the pull request's link in chat and run `pair complete`.
