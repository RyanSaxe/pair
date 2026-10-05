# Components

A component is a directory that `pair build` bundles into every page. Copy
its `markup.html` into a page and replace the content and IDs. pair adds
its styles and behavior to every page, so do not copy them into the page's
`css` or `js`. Component CSS outranks page CSS, so do not restyle a
component. A component is as wide as the reading column.

`pair components` lists every component, pair's and the reviewer's, with its use
and the `pair guide` command that prints its markup. Before you choose a
component, print the markup of each one you might use. The reviewer's own
components are in `$XDG_CONFIG_HOME/pair/components/`, or in
`~/.config/pair/components/` when `XDG_CONFIG_HOME` is not set, and one with
the same name as one of pair's components replaces it.

When a page needs a shape no component has, build it in the page's own `css`
and `js`. When the reviewer asks to keep it for later plans, run
`pair guide components/README.md`, move the shape into
`$XDG_CONFIG_HOME/pair/components/<name>/` as it describes, and say the path.
Never suggest this to the reviewer.

## Escaping

A code block, a diagram's Mermaid text and the before-after JSON in
`textarea[data-diff-input]` are HTML text. Write `&lt;` for each `<` and
`&amp;` for each `&` in them. `pair build` does not catch a missed one, and
the browser reads a bare `<` as the start of a tag. So `<T>` in code hides
the rest of its line, and `<br/>` in a Mermaid label loses its line break,
with no error.
Leave `>` as it is, so `-->` and `->>` stay as written. In a formula inside
a JSON string, write each backslash twice.

## Code and figures

`data-language` is the language's name in Shiki, the highlighter: `ts`,
`python`, `shell`, `json`, or `text` for plain text. `pair build` refuses a
name that is not a Shiki language ID and suggests the nearest one.

`data-file` on a code block puts the file's name above the code. `data-caption` on
code, a diagram or a chart adds a caption line, and `data-title` on a chart
adds a header.

| Attribute    | On                | What it does                                                                                                                         |
| ------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| data-lines   | `[data-language]` | `"7"`, `"3-4"` or `"3-4, 9"`. Numbers the lines, highlights the named lines and dims the rest.                                       |
| data-numbers | `[data-language]` | Takes no value. Numbers the lines and dims nothing.                                                                                  |
| data-notes   | `[data-language]` | `[{"line": 3, "text": "…"}]`. Attaches the note to each named line. Needs no range.                                                  |
| data-terms   | `[data-math]`     | `[{"symbol": "t", "meaning": "…", "value": "8 s"}]`. Names the formula's coloured terms under it, entry N for the Nth literal below. |

Line numbers count from the block's first line, so name a quoted excerpt's
real range in `data-caption`, such as `Lines 611-621`.

Only use `data-lines` when the selected range is the subject of the
review, and only use `data-notes` when the exact line needs an explanation.
Leave both off routine code examples.

Write a multi-line code block as a `<pre>`, which keeps its line breaks. Use
the code component for source code, never a bare block.

A formula term takes its colour from a literal in the source, because KaTeX
refuses `\htmlClass`: write `\textcolor{#1d4ed8}`, `\textcolor{#a16207}`,
`\textcolor{#047857}` or `\textcolor{#9333ea}`. Only these four colors
change with the light and dark themes.

A prototype's markup names an entry in the page's `prototypes`. Run
`pair guide prototypes.md` for that entry's fields.

## Decisions

Use the visual decision whenever the options differ in something the
reviewer could see: a layout, a flow, a structure, code, a chart or a
prototype. Put that figure in each option: a diagram, code, a chart, an
image, a prototype, or a mock drawn in the page's own HTML and CSS with the
frame's tokens. Only use the plain decision when a title and one line are
enough to judge each option. Put the recommended option first, with the
Recommended tag.
Give each option one line of consequence that is specific to it.

## Questions and checklists

Use a question when the answer is prose, not a selection. Keep it to one
sentence, and say what you will decide with the answer. Use a drawing
question when the reviewer needs to sketch a boundary, flow or layout.

Start each checklist with no boxes checked, because you cannot tell a box
the reviewer checked from one that started checked. Mark the items you
recommend with the `Recommended` tag. Keep the count line above the rows.
The component updates it.

## Matched sections

The comparison aligns matching sections across options. Set
`--comparison-rows` to the number of direct children per option, including
the header and the footer, or use `data-layout="independent"` when the
options have different structures. Every option needs the same number of
children for the rows to line up, so include an empty section when an option
has nothing for it: `class="comparison-content empty"` with one line that
says so. Keep the selection button separate from links, charts and other
interactive content inside an option.

## Before and after

For text or code, generate the input with Git:

```sh
pair diff BEFORE AFTER OUTPUT.json
```

Give it the whole files, not excerpts, so the patch numbers each line as the
file does. Show each file's change as its own diff.

Put that JSON in the markup's `textarea[data-diff-input]`, escaped, and put
the file name in `data-file` on the section. The patch names the file by
AFTER's base name, so give the proposed copy the file's real name, or a name
that says what it is. `pair diff` requires Git and refuses to overwrite an
existing output.

For visual changes, fill the before and proposed slots and explain the
change in the legend. Put the `added`, `removed` or `changed` class on
changed content or Mermaid nodes. The component colors them for both themes,
so do not set fixed colors in Mermaid `classDef` declarations.

## Diagrams

Mermaid is the default. Draw a loop as a flowchart when the loop is the
structure, a sequence diagram when the order of waits is the point, and a
state diagram for modes. When Mermaid cannot draw the idea cleanly, draw the
SVG by hand with the frame's tokens. `pair guide flow.svg` prints an
example. A diagram renders at its drawn size and scrolls sideways when it is
wider than the column.

The text of `data-diagram` is the Mermaid source, one statement per line,
escaped, so a line break in a label is `&lt;br/&gt;`. A click on a node
whose ID matches a page ID opens that page. `pair build` does not check
Mermaid.

1. **Edges into a group.** An edge into a subgraph's first node passes
   through the subgraph's title. Point the edge at the group, or lay the
   flow out left to right.
2. **Long chains.** A ten-hop line can stay at natural size when the order
   is the whole point. Group the same flow when it needs to fit the column,
   and label each group.
3. **Labels.** Put one to three words in a node and the sentence in the
   caption. Long labels widen every node in the rank and push the chain past
   the column.

In these examples, `·` stands for a line break.

```text
1, avoid    flowchart TB · E["Pricing"] --> F · subgraph pay [Payments]
            F["PaymentClient"] --> G["Breaker"] --> H["Gateway"] · end · H --> I["Ledger"]
1, prefer   flowchart TB · E["Pricing"] --> pay · subgraph pay [Payments]
            F["PaymentClient"] --> G["Breaker"] --> H["Gateway"] · end · pay --> I["Ledger"]
2, grouped  flowchart TB · subgraph front [Front] direction LR · Browser --> Edge · end
            · subgraph core [Core] direction LR · Checkout API --> Cart service --> Pricing · end
            · subgraph pay [Payments] direction LR · PaymentClient --> Breaker --> Gateway · end
            · front --> core --> pay --> Ledger --> Notifier
3, avoid    flowchart LR · A["Checkout API validates the cart and prices"]
            --> B["PaymentClient with a five-failure breaker"] --> C["Gateway, 8 s timeout"]
3, prefer   flowchart LR · A["Checkout API"] --> B["PaymentClient"] --> C["Gateway"]
            caption: Checkout validates and prices. The client trips after five
            failures. The gateway times out at 8 s.
```
