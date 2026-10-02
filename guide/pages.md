# Pages

## Source and build

Keep one work directory for the session under the system temp directory, or
under the scratch directory your agent CLI gives you. For round N, put each
page's source in `WORK/src/N/<page-id>/`: its JSON source and the files it
names. Write the round's `pages.json` to `WORK/src/N/`, beside the page
directories, and build pages to `WORK/out/N/`. `pages.json` lists the pages
that follow Agreed, in order, as
`{ "pages": [{ "id": "policy", "title": "Retry policy" }] }`.

Build Agreed and publish it with the page list, then build and publish each
page as soon as it is done. In the commands, `SRC` is `WORK/src/N` and `OUT`
is `WORK/out/N`:

```sh
pair build SRC/agreed/agreed.json OUT/agreed.html
pair publish --file OUT/agreed.html --pages SRC/pages.json --source SRC/agreed --session-dir PATH
pair build SRC/policy/policy.json OUT/policy.html
pair publish --file OUT/policy.html --source SRC/policy --session-dir PATH
```

`pair build` lists every structural problem in a source and writes nothing
when it finds one. It refuses to overwrite, so build a change to a new path
or delete the old output first. `pair publish --source SRC/policy` copies
that directory to the session's `src/<round>/<page-id>/`, so keep built
pages, previews and scratch files out of it. To revise an earlier round's
page, copy its source from there and change its `round` to this one. Embed
every local resource a page uses. Do not install packages to author a plan.

A published page cannot change in its round. `pair publish` checks each `#`
link on the pages after Agreed, and refuses a page whose link names neither
a page of the round nor an element on its own page. Open a page in a browser
only when it has CSS or a script you wrote and you cannot judge it from the
source.

In a round, you change the pages, their CSS, JavaScript and prototypes, and
Agreed. The frame, pair's components, the `pair` command and the hub are
pair's own code. If the reviewer asks to change one of them, say so in the
chat and plan it as work on pair.

## Source fields

Agreed and every other page share the outer fields `name`, `round` and
`title`. Agreed also requires a `task`. Run `pair guide agreements.md` for
its fields.

```json
{
  "name": "retry",
  "round": "1",
  "title": "Retry policy",
  "page": {
    "id": "agreed",
    "title": "Agreed so far",
    "task": {
      "title": "Retry policy",
      "html": "<p>Checkout retries a failed charge once, so a brief gateway outage costs one slow request instead of a failed order.</p>"
    },
    "agreements": []
  }
}
```

```json
{
  "name": "retry",
  "round": "1",
  "title": "Retry policy",
  "page": {
    "id": "policy",
    "title": "Retry policy",
    "file": "policy.html",
    "css": "policy.css",
    "js": "policy.mjs",
    "prototypes": []
  }
}
```

| Field      | Contract                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| name       | Stable ID for the whole session, using letters, digits, underscores or hyphens.                   |
| round      | The same value on every page of a round, and a new value for each round: `"1"`, `"2"`.            |
| offer      | Agreed's source only, and optional: `plan` or `finish`. `pair guide` prints when to name each.    |
| title      | The plan's title.                                                                                 |
| page.file  | An HTML fragment, relative to the JSON file. `page.html` may contain the fragment inline instead. |
| page.css   | Optional page CSS. `pair build` scopes it to this page.                                           |
| page.js    | Optional module that exports `setup(root, planUI)`.                                               |
| prototypes | Optional prototypes for this page. Run `pair guide prototypes.md` for their fields.               |

Page IDs are unique within a round. `agreed` is only for the Agreed page,
and `feedback` is reserved.

Page HTML is trusted markup written by the agent. Reviewer comments are
plain text. Never put them into executable HTML or JavaScript, and never put
the agent token in a page.

## Page content

The frame draws the header, the navigation, the page title and the comment
control. Page HTML is a fragment that starts below the title and must not
contain an `h1`. `pair build` refuses a page that contains one. Lay the page
out with its own HTML and CSS. The frame provides basic typography, tables,
code, theme colors, focus and selected-choice states, and no card or column
layouts.

`pair build` scopes a page's CSS to that page and puts it in a cascade layer
beneath the components, so page CSS does not restyle another page, and does
not restyle a component unless the rule is marked `!important`.

Style what the page draws itself with the frame's design tokens, and do not
redefine them. Each token has a light and a dark value: `--ground` (the page
behind the frame, panels, and figure grounds), `--panel` (the frame, cards,
popovers), `--line` and `--line-strong`, `--ink`, `--muted`, `--accent`,
`--accent-ink` (text on an `--accent` fill, not accent-colored text),
`--accent-soft`, `--attention` and `--attention-bg` (needs you), `--ok` and
`--ok-bg` (sent, accepted), `--danger` and `--danger-bg` (removed), `--code`,
and `--mark` (noted text). Do not color preferred options green or
alternatives red to express preference. When color marks something, say the
same in the text, and add no decorative cards, labels, tags or pills that
repeat nearby text.

Type is the system stack: 13px chrome, 13.5px to 15px reading, 22px page
titles, uppercase 10.5px labels. Radii are 10px for cards, 7px for buttons,
6px for rows. The reading column is at most 822px wide.

## Controls

| Interface                            | Contract                                                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| data-choice                          | Stable choice-group ID on a group of native buttons. Use data-label for a readable label.                                                                          |
| data-multiselect                     | Stable checklist-group ID on a group of native labeled checkboxes. Use data-label for a readable question or group label.                                          |
| data-question                        | Stable question ID on a section with a textarea. Use data-label for the answer's label.                                                                            |
| data-drawing-question                | Stable drawing-question ID on a section using the drawing-question component. Use data-label for the answer's label.                                               |
| data-value                           | Stable option ID on a button in data-choice, or a checkbox in data-multiselect.                                                                                    |
| data-label on an option              | Readable option label. The build refuses one over 24 characters. A group's data-label has no limit. Buttons fall back to their text, and checkboxes to data-value. |
| data-kind on a block                 | The noun the comment control uses after "this", as in "Comment on this decision". A component sets it on its own root.                                             |
| data-comment                         | A button that opens a note on the nearest ancestor with an ID, using the attribute as its label.                                                                   |
| planUI.comment(anchor, quote)        | Open a note from a custom control.                                                                                                                                 |
| planUI.enhance(element)              | Render components in content a script added.                                                                                                                       |
| planUI.define(name, {match, setup})  | Register a component. `pair guide components/README.md` prints how.                                                                                                |
| planUI.chart(element, options)       | Return an ECharts instance asynchronously.                                                                                                                         |
| planUI.diff(element, input, options) | Render one Git file patch. Input has before, after and patch strings. options.diffStyle is split or unified.                                                       |
| planUI.prefs.get(key), set(key, v)   | Remember a viewing preference in the browser.                                                                                                                      |
| planUI.mode                          | live, readonly or preview.                                                                                                                                         |
| plan:page, plan:theme                | Window events after each page render (detail has page, element and round) and after a theme change.                                                                |

The frame sets `aria-pressed` and checkbox state from the reviewer's draft,
so do not author `aria-pressed` or `checked`. Group IDs are unique within a
page across all kinds, and option IDs within a group. When a topic continues
in the next round, keep its page ID, control IDs and labels, so the frame
keeps the reviewer's unsent draft on it. Put checklist markup in the page
HTML, not in a script, so every checklist is in the submission, including
lists on pages the reviewer never opened. Keep authored controls focusable.

## Page JavaScript

Page JavaScript exports `setup(root, planUI)`, which the frame calls each
time the page renders, with the page's content element as `root`. Script
elements inside page HTML do not execute.

Change only elements inside `root`. `pair build` refuses a script that
writes to `document.body` or `document.documentElement`, such as setting
their `style`, `className`, `classList`, `dataset` or `innerHTML` or calling
their `setAttribute`, `append`, `prepend` or `remove`, because those change
the whole frame. Reading them, such as the body's width, is allowed.

## Comments

The reviewer can comment on the page, on any block or on selected text, and
needs no authored control to do it. A note on a block is filed under the
block's heading, `data-title`, `data-file`, figure title or caption, and
otherwise under the heading above it. Give each block a distinct name so
every note identifies its block.

## Figures

Code, formulas, diagrams, charts and prototypes are components.
`pair components` lists them, and `pair guide components.md` prints their
attributes.
