# Prototypes

A prototype is a self-contained HTML document that shows an interaction
working, so the reviewer and whoever builds the work can try the behavior
instead of reading about it.

| Field  | Contract                                                                 |
| ------ | ------------------------------------------------------------------------ |
| id     | Unique stable ID with the same character rules as page IDs.              |
| title  | Accessible, descriptive title.                                           |
| html   | Complete self-contained HTML document, including its styles and scripts. |
| file   | Page-source alternative to html, resolved relative to the page JSON.     |
| height | Positive preview height in pixels.                                       |

Put each prototype in its page's `prototypes` array, with an ID that no
other prototype in the round uses, and put `data-prototype="ID"` on the
element where it belongs. The frame runs the document in a sandboxed
iframe with no access to the frame itself, so the prototype's controls
cannot send real feedback. Scripts, forms and popup links work inside it.
The iframe has no background, so give the document one, and match the
reviewer's light or dark theme with a `prefers-color-scheme` rule.

The iframe is about 820px wide. A mock of one component fits at its natural
width. A layout designed wider than that collapses unless you scale it. Put
it on a stage at its design width, such as 1120px for three columns, with
`transform: scale(min(1, innerWidth / 1120))`, and add a control that
switches to 100%.
