# Proposals

Record work worth doing as a proposal with `pair propose`, whether the
task calls for it or you found it on the way. The reviewer starts the
proposal, declines it or comments on it. Starting it approves only what it
says it delivers and may change, so state both exactly.

```sh
pair propose --session-dir PATH --id phone-sidebar \
  --title "Slide the sidebar over the page on phones" \
  --delivers "The sidebar opens from an icon and slides over the page below 700px" \
  --changes "src/frame/app/ and the sidebar's CSS" \
  --recommend here \
  --reason "It changes only the frame, which this session already reads" \
  --source "From the Commenting page" --page 14/commenting
```

Give each proposal an ID of lowercase letters, digits and hyphens that the
session does not have. `--recommend` names where the work should run,
`here`, `sub-session` or `new-agent`, and `--reason` says why. `--source`
says where the work came from, with `--page ROUND/PAGE` or `--thread ID`
when it came from a page or a thread.

Show a proposal on the page where it comes up with the proposal component,
which `pair guide components/proposal/markup.html` prints, with the
proposal's ID in `data-proposal`.

Change a proposal with its `--id` and one of these flags:

- `--revise` with the fields to replace. The hub refuses it once the
  proposal is started, so record further work as a new proposal.
- `--start here`, only when the reviewer told you in their own words to do
  the work, with `--source` quoting those words and `--thread` or `--page`
  for where they wrote them.
- `--done` after you publish the last page of work started here, and
  `--reopen` when later feedback asks for changes to that work.

`pair read` prints each Start and each proposal the reviewer declined, with
what to do next.

## Plans

When nothing about a proposal's work is left to decide, or the reviewer asks
for its plan, write the plan and attach it to the proposal with `pair plan`.
Write it so that an engineer or agent who saw none of the rounds builds
exactly what the reviewer aligned on, without asking anything. Show every
approved look and interface as the reviewer approved it: copy it from its
page source in the session's `src/ROUND/PAGE/`, and change it to match what
was agreed after it was shown. State each behavior exactly, and say how to
check that the work is done. Include code where it makes the plan clearer,
but write the plan from what the rounds decided, without building the work
to find out. Settle every open question on a page before you attach the
plan.

Write each page of the plan as a page source, as `pair guide pages.md`
describes, with `"round": "plan"`, in a directory named by the page's ID.
Put the directories and a `pages.json` that lists the pages in order in one
directory, build each page, and attach them:

```sh
pair plan --session-dir PATH --proposal phone-sidebar --rounds 13-15 \
  --pages PLAN/pages.json --source PLAN \
  --file OUT/overview.html --file OUT/steps.html
```

`--rounds` names the rounds the plan came from, one round or a range. Give
one `--file` for each page in `pages.json`, in the same order.
