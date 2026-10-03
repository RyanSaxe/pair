# Prototypes

A prototype is a self-contained HTML document that shows an interaction
working, so the implementer sees the behavior instead of a description of
it.

| Field  | Contract                                                                 |
| ------ | ------------------------------------------------------------------------ |
| id     | Unique stable ID with the same character rules as page IDs.              |
| title  | Accessible, descriptive title.                                           |
| html   | Complete self-contained HTML document, including its styles and scripts. |
| file   | Page-source alternative to html, resolved relative to the page JSON.     |
| height | Positive preview height in pixels.                                       |

Put a prototype in its page's `prototypes` array. IDs are unique within the
round. Put `data-prototype="ID"` on the element where the prototype
belongs. The document runs in a sandboxed iframe with no same-origin access
to the review frame, so its controls cannot submit real feedback. Scripts,
forms and popup links work inside the sandbox. The embed has no background,
so give the document its own and follow the viewer's theme with a
`prefers-color-scheme` rule.

An embed is about 820px wide. A component mock renders at its natural width
without scaling. A layout mock designed wider than the embed collapses
unless it scales. Give it a stage at the design width (1120 works for a
three-column layout) with `transform: scale(min(1, innerWidth / 1120))`
and a control to switch to 100%.
