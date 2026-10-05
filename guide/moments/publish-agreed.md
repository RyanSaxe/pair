Now write the round's pages.

- When you start a page, run `pair progress --page ID --note "…"`, and run
  it again at least every five minutes until you publish the page, also
  while a subagent writes it.
- Hand a page to a subagent when its research or writing would hold up the
  other pages. Give the subagent the session directory, the page's ID and
  the `pair progress` command, so it posts its own notes.
- Publish each page as soon as it builds and you have checked it against
  `pair guide writing.md`. Check a subagent's page the same way, and check
  its facts too.
- Choose each component from the list below by what the reviewer needs to
  see. Before the session's first page, run `pair guide writing.md` and
  `pair guide components.md`.
- In a code block, a diagram's Mermaid text and the before-after
  component's JSON, write `&lt;` for each `<` and `&amp;` for each `&`.
  `pair build` does not catch a missed one, and the browser reads a bare `<`
  as the start of a tag, so the text after it disappears without an error.
