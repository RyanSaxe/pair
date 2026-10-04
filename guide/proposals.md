# Proposals

Record each proposal with `pair propose`:

```sh
pair propose --session-dir PATH --id phone-sidebar \
  --title "Slide the sidebar over the page on phones" \
  --delivers "The sidebar opens from an icon and slides over the page below 700px" \
  --recommend here --page 14/commenting
```

Give each proposal an ID of lowercase letters, digits and hyphens that the
session does not have. Give `--delivers` a sentence or two on what the work
delivers, and `--recommend` where it should run: `here`, `sub-session` or
`new-agent`. Add `--page ROUND/PAGE` or `--thread ID` when the work came up
on a page or in a thread.

Show a proposal on the page where it comes up with the proposal component,
which `pair guide components/proposal/markup.html` prints, with the
proposal's ID in `data-proposal`.

Change a proposal with its `--id` and one of these flags:

- `--revise` with the fields to replace. The hub refuses it once the
  proposal is started, so record further work as a new proposal.
- `--start WHERE --quote "…"` when the reviewer tells you in their own
  words, in a note, a thread or the chat, to do the work. Record a proposal
  for the work first unless one already covers it. Quote their words, and
  add `--page ROUND/PAGE` or `--thread ID` for where they wrote them. WHERE
  is `here`, `sub-session` or `new-agent`: where they said the work runs,
  or where you recommend when they did not say.
- `--withdraw` when a proposal nobody has started no longer applies, with
  `--reason "…"` saying why.
- `--done` after you publish the last page of work started here, and
  `--reopen` when later feedback asks for changes to that work.

`pair read` prints each Start, each proposal the reviewer declined and
each proposal whose linked session closed, with what to do next.

## Plans

Copy each approved look and interface into the plan from its page source in
the session's `src/ROUND/PAGE/`, and change it to match every alignment made
after the reviewer saw it.

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
one `--file` for each page in `pages.json`, in the same order. In a session
that `pair start --from` created, `--proposal` can name the proposal the
session runs, and `--rounds` names this session's rounds.
