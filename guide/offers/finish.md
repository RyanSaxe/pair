# The finish offer

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
