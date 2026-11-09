Now write the round's pages.

- When you publish a page and other pages are left, add `--start ID` for the
  page you work on next. Until you publish a page you started, run
  `pair progress --page ID --note "…"` for it at least every five minutes,
  also while a subagent does the work.
- Hand a page to a subagent when its research or writing would hold up the
  other pages. Give the subagent the session directory, the page's ID and
  the `pair progress` command, so it posts its own notes.
- Publish each page as soon as it builds and you have checked it against
  `pair guide writing.md`. Check a subagent's page the same way, and check
  its facts too.
- Choose each component from the list below by what the reviewer needs to
  see. Before the session's first page, run `pair guide writing.md` and
  `pair guide components.md`.
- In a code block, a diagram's Mermaid text and before-after JSON pasted
  into the component's textarea, write `&lt;` for each `<` and `&amp;` for
  each `&`. `pair build` refuses a code block or a diagram with a `<` before
  a letter, `/`, `!` or `?`, and does not catch a missed `&`.
