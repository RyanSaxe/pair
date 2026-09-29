# Backlog

This file lists work that is planned for pair but not started. Each entry
says what the work is and why it matters. The pull request that does an
entry removes it from this file.

## Tooling

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
