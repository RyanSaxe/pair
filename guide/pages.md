# Page source and build

Give each page a source directory of its own under the system temp
directory, holding its JSON source and the files it names. Build it to a
path outside that directory before publishing:

```sh
pair build SRC/policy/policy.json OUT/policy.html
```

The build refuses to overwrite, so build a change to a new path or delete
the old output first. `pair publish --source SRC/policy` keeps that directory
under `src/<round>/<page-id>/` in the session, so keep built pages,
previews and scratch files out of it. Embed every local resource a page
uses. Do not install packages to author a plan.

A round changes its pages, their CSS, JavaScript and prototypes, and Agreed. The
frame, pair's components, the `pair` command and the hub are pair's own code. If
feedback asks to change one of them, say so in the chat and plan it as work on
pair.

Agreed and every other page share the outer fields. Agreed also requires a
`task`, whose fields are in [agreements.md](agreements.md):

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

| Field      | Contract                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| name       | Stable ID for the whole session, using letters, digits, underscores or hyphens.                |
| round      | The same value on every page of a round, and a new value for each round: `"1"`, `"2"`.         |
| offer      | Optional. `plan` on a complete plan, `finish` on a round in which you build the work.          |
| title      | The plan's title.                                                                              |
| page.file  | An HTML fragment, relative to the JSON file. `page.html` may hold the fragment inline instead. |
| page.css   | Optional page CSS. The frame scopes it to this page.                                           |
| page.js    | Optional module that exports `setup(root, planUI)`.                                            |
| prototypes | Optional prototypes for this page. See [prototypes.md](prototypes.md).                         |

Page IDs are unique within a round. Reusing a page ID in a later
round lets the reviewer's unsent draft on that page carry forward. `agreed`
is only for the Agreed page, and `feedback` is reserved. A round that offers
`plan` lists `overview` first after Agreed.

Page HTML is trusted markup written by the agent. Reviewer comments are
plain text. Never put them into executable HTML or JavaScript, and never put
the agent token in a page.
