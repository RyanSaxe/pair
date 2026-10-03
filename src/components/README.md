# Writing a component

A component directory contains `markup.html`, and `styles.css` and
`behavior.mjs` when the component needs them. `pair build` reads those three
files and nothing else.
`pair guide components.md` prints the catalog a plan author reads.

## Behavior

`behavior.mjs` registers the component with `planUI.define`, and the frame
runs every registration over each page as it renders:

```js
planUI.define("scope-checklist", {
  match: ".scope-list[data-multiselect]",
  setup(list, { page, planUI }) {
    // Runs once per matching element, on every page render.
  },
});
```

`match` is a CSS selector. `setup` runs once for each element the selector
finds. When `setup` throws or its promise rejects, the frame shows the error
in the element's place and renders the rest of the page.

Nothing on a page moves once it appears. A `setup` returns a promise only
when its element's height is not final until the promise settles, as a
diagram's is until Mermaid draws it. The frame keeps the page hidden until
every such promise settles, for at most 10 seconds, and restores the scroll
position after them. A component whose box is final at once returns
nothing, so the page does not wait for it: the chart draws into a box of
fixed height, a code block's plain source already has its highlighted
height, and the diff reserves its height before it draws.

A page renders by replacing `#page-content`, so `setup` runs again on every
visit. Keep no state between renders. Keep a viewing preference the reviewer
chose, such as a layout, in `planUI.prefs`, keyed by `page.id` and the
element's own ID so two of the same component on a page stay separate.

The frame provides these functions for a component's script: `figure()` for
a figure's header, actions and caption, `copyButton()`, `failed()` for a
renderer error in place, `script()` with the pinned CDN locations in
`libraries`, `color()` for a token's current value, and `readData()` for a
JSON array in a data attribute. A component calls another through `planUI`:
the prototype renders its source fold with `planUI.enhance`, and the chart
calls `planUI.chart`.

Set `data-kind` on the component's root to a singular noun that follows
"this", so the comment control names it.

## Styles

`styles.css` needs no wrapper. `pair build` puts it in a cascade layer above
page CSS and the frame's own styles, so a component's type and spacing rules
override the frame's. Use the design tokens that `pair guide pages.md`
prints.

`pair build` also scopes component CSS to `#page-content`, so a selector
that starts at `:root` or `html` never matches. Follow the theme with
`light-dark()`, which reads the `color-scheme` that the frame sets.

At the top of a page the frame sets the space around a component's root, 14px
above and 22px below. A root that sets its own margin elsewhere gives it up
there with `:scope > ROOT { margin: revert-layer; }`, as the code and formula
components do.

A component with authored content puts that content in a slot. The frame
zeroes the top margin of a slot's first child and the bottom margin of its
last, so a `<pre>`, a `<div>`, a figure and a table all sit the same
distance from the slot's edges. The frame's rule covers these slots, and a
new component's `styles.css` zeroes the same margins in its own slot:

| Component       | Slot                      |
| --------------- | ------------------------- |
| visual-decision | `.visual-option > figure` |
| comparison      | `.comparison-content`     |
| before-after    | `.change-content`         |
| behavior-cases  | `.behavior-case > div`    |

## Components outside pair

`pair build` also reads `$XDG_CONFIG_HOME/pair/components/`, with
`~/.config` as the fallback. A directory there with the same name replaces
pair's component, and an update to pair never touches it. To keep a
page's one-off shape, write `markup.html`, `styles.css` and `behavior.mjs`
there and move the code out of the page's files.
