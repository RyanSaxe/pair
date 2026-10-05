# Proposals

Record each proposal with `pair propose`:

```sh
pair propose --session-dir PATH --id phone-sidebar \
  --title "Slide the sidebar over the page on phones" \
  --delivers "The sidebar opens from an icon and slides over the page below 700px" \
  --recommend here --page 14/commenting
```

Give each proposal an ID of lowercase letters, digits and hyphens that the
session does not have yet. In `--delivers`, say in a sentence or two what
the work will produce, and set `--recommend` to where you think it should
run: `here`, `sub-session` or `new-agent`. Add `--page ROUND/PAGE` or
`--thread ID` when the work came up on a page or in a thread.

Show a proposal on the page where you discuss it with the proposal
component, which `pair guide components/proposal/markup.html` prints, with
the proposal's ID in `data-proposal`.

Change a proposal by running `pair propose` with its `--id` and one of
these flags:

- `--revise`, with the fields to replace. The hub refuses it once the work
  is approved, so record any further work as a new proposal.
- `--start WHERE --quote "…"`, when the reviewer asks you for the work in
  their own words, in a note, a thread or the chat. Record a proposal for
  the work first unless one already covers it. Quote their words, and add
  `--page ROUND/PAGE` or `--thread ID` for where they wrote them. Set WHERE
  to `here`, `sub-session` or `new-agent`, wherever they said the work
  should run, or where you recommend if they did not say.
- `--join TASK`, to merge this proposal into the proposal TASK when the two
  belong together. Only join a proposal the reviewer has not approved, into
  a TASK that is not finished and is not running in another session. When
  you build TASK, also build the work of each proposal joined into it.
- `--withdraw --reason "…"`, when a proposal the reviewer has not approved
  no longer applies, saying why.
- `--done`, after you publish the last page about work you built in this
  session. When a proposal's work was finished some other way, add
  `--where` to say where, such as `--where "in #86"`. Do not run `--done`
  for work in a sub-session or another agent's session. The hub marks that
  work done when the reviewer closes its session.
- `--reopen`, after `--done`, when later feedback asks for changes to that
  work.

`pair read` prints each proposal the reviewer starts or declines, and each
proposal whose session they close, with what to do next.

## Plans

Copy each look and interface the reviewer approved into the plan from its
page source, in the session's `src/ROUND/PAGE/`, and update it to match
every alignment settled after the reviewer saw it.

Write each page of the plan as a page source, as `pair guide pages.md`
describes, with `"round": "plan"`, in a directory named by the page's ID.
Put the directories and a `pages.json` that lists the pages in order in one
directory, build each page, and attach them:

```sh
pair plan --session-dir PATH --proposal phone-sidebar --rounds 13-15 \
  --pages PLAN/pages.json --source PLAN \
  --file OUT/overview.html --file OUT/steps.html
```

`--rounds` is the round, or the range of rounds, the plan came from. Give
one `--file` for each page in `pages.json`, in the same order. In a session
that `pair start --from` created, `--proposal` can name the proposal the
session builds, and `--rounds` refers to this session's rounds.
