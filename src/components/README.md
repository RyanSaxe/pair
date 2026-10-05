# Writing a component

A component directory contains `markup.html`, and `styles.css` and
`behavior.mjs` when the component needs them. `pair build` reads those three
files and nothing else.
`pair guide components.md` prints the list of components for page authors.

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

Write a component so nothing on the page moves after it appears. Only
return a promise from `setup` when the element's height is not final until
the promise settles, as a diagram's height is until Mermaid draws it. The
frame keeps the page hidden until every such promise settles, for at most
10 seconds, and then restores the scroll position. When a component's box
has its final size at once, return nothing, so the page does not wait for
it. The chart draws into a box of fixed height, a code block's plain source
already has its highlighted height, and the diff reserves its height before
it draws.

The frame renders a page by replacing `#page-content`, so `setup` runs again
on every visit. Keep no state between renders. Keep a viewing preference the
reviewer chose, such as a layout, in `planUI.prefs`, keyed by `page.id` and
the element's own ID so two of the same component on a page stay separate.

The frame provides these functions for a component's script: `figure()` for
a figure's header, actions and caption, `copyButton()`, `failed()` for a
renderer error in place, `script()` with the pinned CDN locations in
`libraries`, `color()` for a token's current value, and `readData()` for a
JSON array in a data attribute. To use another component, call it through
`planUI`, as the prototype does with `planUI.enhance` for its source fold,
and the chart does with `planUI.chart`.

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

When a component's root is a direct child of the page, the frame puts 14px
above it and 22px below it. To use the component's own margin there
instead, add `:scope > ROOT { margin: revert-layer; }` to its styles, as
the code and formula components do.

Put a component's authored content in a slot. The frame zeroes the top
margin of a slot's first child and the bottom margin of its last, so a
`<pre>`, a `<div>`, a figure and a table all sit the same distance from the
slot's edges. The frame's rule covers these slots. In a new component, zero
the same margins in its own slot in `styles.css`:

| Component       | Slot                      |
| --------------- | ------------------------- |
| visual-decision | `.visual-option > figure` |
| comparison      | `.comparison-content`     |
| before-after    | `.change-content`         |
| behavior-cases  | `.behavior-case > div`    |

## Components outside pair

`pair build` also reads `$XDG_CONFIG_HOME/pair/components/`, with
`~/.config` as the fallback. A directory there with the same name replaces
pair's component, and updating pair never changes it. To keep a
page's one-off shape, write `markup.html`, `styles.css` and `behavior.mjs`
there and move the code out of the page's files.
