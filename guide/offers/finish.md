# The finish offer

Agreed names `"offer": "finish"` on the build round and on each follow-up
round after feedback on the build. The last page of such a round is the pull
request description. The reviewer accepts the work with Finish without a PR or
Open a PR, and `pair read` returns the acceptance with the chosen action in
`action`.

Read the comments first. The acceptance's `groups` field contains the
comments and choices the reviewer drafted before accepting.

## Finish without a PR

The action is `finish`. The work stays committed on its branch. Run
`pair complete` and say in chat which branch the work is on.

## Open a PR

The action is `pull-request`. Open a pull request from the build's branch as
the project's own instructions say. Use the round's last page as its body:
its source is the HTML fragment in the session's `src/<round>/<page-id>/`.
The acceptance may include `guidance` of up to 4,000 characters about the
pull request. Follow it.

Watch the pull request's CI until it passes, and fix each failure on the
branch. Then give the pull request's link in chat and run `pair complete`.
