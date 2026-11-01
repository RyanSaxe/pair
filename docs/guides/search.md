# Search

Search finds anything you read or wrote in pair, without you remembering its
session or round. It covers pages, threads, notes, answers, proposals and
Agreed, in live and closed sessions.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/search-dark.png">
  <img alt="The search modal. The field, three filters and the results are on the left, and the block that matched is drawn on the right with the typed words highlighted." src="../assets/search-light.png">
</picture>

## Open it

Select the magnifying glass in the header, or press <kbd>⌘K</kbd> on macOS,
<kbd>Ctrl+K</kbd> elsewhere, or <kbd>/</kbd>. Type a few words, and the list
filters on every keystroke. Typos and partial words still match.

| Key                       | What it does                                         |
| ------------------------- | ---------------------------------------------------- |
| <kbd>↑</kbd> <kbd>↓</kbd> | Moves through the results                            |
| <kbd>Enter</kbd>          | Opens the selected result                            |
| <kbd>Option+S</kbd>       | Switches between this session and all sessions       |
| <kbd>Option+R</kbd>       | Switches between all rounds and the latest round     |
| <kbd>Tab</kbd>            | Moves through the kinds                              |
| <kbd>Esc</kbd>            | Closes search and keeps your words for the next time |

## Narrow it

Three buttons sit above the results. A search starts on this session, all
rounds and all kinds, and a button that has changed is tinted.

- **This session** switches to all sessions.
- **All rounds** switches to the latest round, which is each session's newest
  round.
- **All kinds** opens a menu of the six kinds, with how many results each has.

When a search finds nothing, a button offers to loosen one filter and keeps your
words.

## The preview

The preview draws the block that matched, as the real component: a diff is the
real diff, and a decision opens on the option that has your words. A thread shows
its message above the block it's on. Words a block doesn't draw as text, such as
an image's alt text, show in a strip under the block. On a phone, tap a result to
see its preview, and select Open to go to its page.

## Open a result

Enter or Open closes search and goes to the result, scrolled to the block with
your words highlighted until you move to another page. A result in another live
session opens that session, so you can still reply, and a result in a closed
session opens read-only. Back returns to where you were.

## What it leaves out

- Text inside images.
- The unchanged parts of a whole file behind a diff's folds. A diff's changed
  lines and their context are searchable.
- Words that come only from a script over 32 KB, such as a bundled library in a
  prototype.

A round keeps the frame it was published with, so a round published before
search has no search icon when you open its address directly.

## Agents

An agent runs `pair search` to find what an earlier session said, instead of
asking you again. See [Commands](../reference/commands.md).
