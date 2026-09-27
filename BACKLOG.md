# Backlog

This file lists work that is planned for pair but not started. Each entry
says what the work is and why it matters. The pull request that does an
entry removes it from this file.

## Tooling

### Libraries from npm instead of CDNs

The frame loads Shiki, @pierre/diffs, Mermaid, KaTeX and ECharts from
esm.sh and jsdelivr, and the drawing editor loads Excalidraw and React from
esm.sh. A page opened offline, before the browser has cached them, shows
each figure's source instead of the figure. Only KaTeX and ECharts load
with an integrity hash. The others load through `import()`, which takes
no hash, so a changed file on the CDN runs unchecked. `npm outdated` and
Dependabot read `package.json`, so neither reports a newer release of a
library whose version is pinned in a URL.

Decide, library by library, whether pair installs it from npm and how a
page then loads it. The six libraries install 356 MiB in 389 npm packages,
or 265 MiB in 187 without Excalidraw. A browser rendering every figure in
the test fixture loads 15.9 MiB of them, decoded.

The build embeds each of the frame's modules as a `data:` URL behind an
import map, and the browser loads them as native modules with no bundler,
which suits a frame that takes no npm dependencies. Once the frame takes a
library from npm, a bundler becomes the better way to build it.

### Browser tests

`npm test` runs in Node, so nothing tests the frame's behavior in a
browser. Playwright as a devDependency, which the screenshot script below
also needs, lets CI open built pages in Chromium, and it adds nothing to
`npm install -g`, because npm skips a package's devDependencies. The first
tests:

- The Finish your review dialog, built with each offer.
- A note's highlight on its block after moving to another page and back.
- Every key the frame binds.
- Every figure in the test fixture renders, in the light and dark themes.
  Until the libraries install from npm, this test fails whenever esm.sh or
  jsdelivr is down.

Each CI run downloads Chrome Headless Shell, 114 MiB on Linux, unless CI
caches it.

### Browser checks before publishing

`pair build` checks a page's markup but does not parse Mermaid, ECharts
options or KaTeX, so a diagram, chart or formula with an error shows the
error only when someone opens the page. A browser check, such as
`pair check PAGE.html`, would open the built page in headless Chrome and
list each figure that failed to render and each script error, so the agent
fixes them before it publishes.

`playwright-core` as a dependency can drive the Chrome already installed,
which adds about 12 MiB to an install and downloads no browser. On an Apple
M3 Max, Chrome started in 0.3 s and rendered the 25 components of the test
fixture's Figures page in about 1 s. Playwright's own headless Chromium
would add 192 MiB on macOS instead. A machine without Chrome would skip the
check and say so.

### Screenshots

The README's two screenshots, `assets/plan.png` and `assets/diff.png`, were
taken by hand, so a change to the frame's look leaves them out of date, and
the pages under `docs/` have none. A committed script,
`scripts/screenshots.mjs` run as `npm run screenshots`, would start a hub on a
free port with its state in a temporary directory, publish a demo round
committed beside the script, and write each screenshot to `assets/` in the
light theme, 1160 CSS pixels wide at twice the pixel density. It needs
Playwright as a devDependency, because a screenshot taken from a URL alone
cannot select text or open a dialog. CI can run the script and report which
screenshots a frame change alters.

The docs would then show more of pair:

- A plan page on a phone, 390 pixels wide, with its options as tabs.
- A selected passage with the note dialog open, quoting it.
- The progress card on Agreed while a round's pages arrive, with the round's
  running time.
- The notification center with a session waiting and new events.

`files` in `package.json` lists only `src`, `guide`, `adapters` and `skills`,
so the npm package includes neither `assets/` nor `scripts/`.

### TypeScript

Move the source to `.ts` files with a compile step, as one of the last changes
before the first public release. Every file changes its name and a checkout
then runs only compiled code, so the move waits until the module structure has
settled. The hub, the commands, the frame and the adapters pass records such
as the session status, a submission and a round's pages between them as plain
objects, and nothing checks their shapes before the code runs.

At commit `4c0c2f7`, before the module split, `tsc` 6.0.3 with `allowJs`,
`checkJs` and `noEmit` reported 259 errors in 35 files and 12,990 lines, and
1,691 with `strict`. 94 of the 259 were names that one file used from another
only because the build pasted both into one script. The frame's imports remove
41 of those, and the component behaviors need imports or a declaration file
for the other 53. Most of the rest were DOM lookups typed more broadly than the
code uses them, and shapes `tsc` cannot infer without an annotation. Start
without `strict`, then turn it on one folder at a time.

A compile step changes how every part of pair runs:

- `npm install -g` puts pair under `node_modules`, where Node refuses to strip
  types with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, so the package
  ships compiled JavaScript. `package.json` gains `typescript` and
  `@types/node` as devDependencies, a `build` script that `prepack` runs, and
  `bin` and `files` that point at the compiled output.
- A checkout linked with `npm link` runs new code only after `npm run build`.
- The page builder embeds the frame's compiled files, because browsers run no
  TypeScript. Node's `module.stripTypeScriptTypes()` could strip them at build
  time with no dependency, but Node 26.7.0 marks it experimental and prints a
  warning.
- `tsc` emits only JavaScript, so a script copies the frame's HTML and CSS,
  the components and the Shiki language list beside the compiled output, or
  the compiled code reads them from `src/`.
- `node --test` runs `.ts` tests directly on Node 26.7.0, because the tests
  sit outside `node_modules`. Node 20 cannot strip types, so on Node 20 the
  tests run from the compiled output, or `engines.node` rises.

## Frame

### Page performance

A long page opens with a visible lag. Measure where the time goes before
changing anything, with a browser's performance profile of a long page from a
real session and of the test fixture: parsing the built HTML, loading the
frame's modules from their `data:` URLs, rendering the figures and diffs, and
the frame's setup of each block for notes and choices. Fix the largest cost,
then measure the same pages again.

## Features

### pi and opencode adapters

Add adapters that let the hub wake a pi session and an opencode session,
so pair works with five agent CLIs. Neither CLI lets another process send a
message into a running session, so each adapter includes a listener on a
Unix socket: a pi extension in `@ryansaxe/pair`, and an opencode plugin
published as `@ryansaxe/pair-opencode`.

## Release

### First public release

`"private": true` in `package.json` makes `npm publish` refuse, and
`npx skills add RyanSaxe/pair` needs the repository to be public. To release,
remove `"private": true`, make `RyanSaxe/pair` public, and run `npm publish`.
Then run the install and update commands in
`docs/getting-started/install.md` with `HOME` set to an empty directory. `LICENSE` and `"license": "MIT"` are already in place.
