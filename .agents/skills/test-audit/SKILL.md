---
name: test-audit
description: "Invoke whenever writing, changing, reviewing, or sweeping tests. It contains the authoring gate for new tests and the audit workflow for low-value, implementation-coupled, or duplicative tests and the test-only production seams they require."
metadata:
  # npx skills add searches .agents/skills/ too, and skips a skill marked
  # internal unless INSTALL_INTERNAL_SKILLS=1 is set.
  internal: true
---

# Test Audit

The skill has two modes and one value bar. In authoring mode, check every new
or changed test against the authoring gate as you write it. In audit mode, run
focused sweeps for tests that re-assert source, duplicate stronger proof,
couple behavior to implementation, or keep test-only production seams alive.
Continue broad audits as separate coherent follow-up PRs. Optimize for
confidence, not deletion count.

## Authoring gate

Before adding any test, answer four questions. A missing answer means do not
add it yet.

1. What observable behavior, invariant, or independent contract does it protect?
2. What credible regression makes it fail?
3. Why does existing coverage not already catch that failure? Each contract has
   one primary test owner at the strongest boundary. Another layer needs its
   own distinct risk, such as a transport or lifecycle failure the owner cannot
   reach. Prefer extending a table-driven case or shared fixture over a
   near-duplicate test, and consolidate duplicated setup in the same change.
4. Does it need a production seam (export, flag, wrapper, injection hook) that no
   production caller needs? If yes, move the test to the real boundary instead.

Then check the test against every [junk pattern](#junk-patterns). A match fails
the gate unless the [retention bar](#retention-bar) names the contract it
independently guards. A test that would break under behavior-preserving
refactoring asserts implementation, not behavior. Rewrite it at the
owning boundary before landing it.

Bug regression tests must fail on the pre-fix code for the intended reason and
pass after the owner-boundary repair. A regression test that never demonstrably
failed proves the mock, not the fix. One regression at the owner boundary
covers the bug, so do not replay the same scenario at every layer it crosses.

## Junk patterns

Both modes share this checklist. A new test that matches one fails the
authoring gate, and an audit looks for existing tests that match one.

- assertion-free coverage probes;
- self-comparisons and identity copiers;
- copied fixtures, inventories, manifests, or export lists;
- exact source, import, or string greps;
- private predicate or call-shape tests duplicated at real boundaries;
- duplicate invocations of the same contract;
- provider-local replays of shared helpers;
- tests whose only purpose is preserving test-only exports, globals, or wrappers;
- dead production code whose only callers are tests;
- expected values produced by the helper or renderer under test;
- mocks that implement the asserted behavior, or one identical mock standing in
  for different APIs;
- fixtures that supply the receipt, admission, or callback ordering the owner
  should produce, or persistence asserted against a store the path never writes;
- capability tests that restate declared flags instead of exercising the
  delivery or acknowledgement the flag declares;
- negative controls that pass for an unrelated reason, such as a denial from a
  different guard or a rejection the production path never reaches;
- test names or fixtures that describe more than the input exercises, such as
  a "retires the window" test asserting the window was not cleared.

## Value bar

A test is worth its maintenance cost when it protects behavior, guards against
a credible regression, or enforces an independently meaningful contract. In an
audit, an existing test that must change for a behavior-preserving source
reorganization is suspect, but not automatically deletable. A new test like
that fails the authoring gate.

Before judging a candidate, read the complete test and production owner, its
entry point, callers, callees, sibling implementations, overlapping tests and
relevant history. Read `AGENTS.md` first. When the test asserts behavior of
git, Node or a browser library, read that program's documentation or source
directly.

## Discovery

Keep discovery read-only and report evidence before editing. For broad scope,
run parallel discovery lanes when available:

- the hub and commands (`src/hub/`, `src/cli/`, `src/shared/`);
- the frame (`src/frame/`);
- the builder and components (`src/build/`, `src/components/`);
- the adapters (`adapters/`);
- a cross-cutting pattern sweep.

Prefer a few high-confidence candidates over a large speculative inventory.
Look for the [junk patterns](#junk-patterns).

## Retention bar

Keep a test when it independently enforces one of pair's contracts:

- the `pair` command's arguments, output and exit status;
- the hub's HTTP routes;
- page sources, and what `pair build` accepts and refuses;
- the files the hub writes to a session directory;
- the wake line, and each adapter's `detect`, `identity` and `wake`;
- the guide's links and the paths `pair guide` prints;
- security rules, such as the escaping of plan data embedded in a page;
- the files npm packs.

Also keep:

- call ordering when order is observable behavior;
- regressions with a credible failure mode;
- source inspection when it is the cheapest independent guard: it fails when
  the contract changes (the user-facing key, byte, or path) and survives an
  identifier-only refactor;
- a retained test that fails on the baseline: treat it as a possible product
  bug, reproduce it, and repair the owner rather than deleting it.

Static or slow is not a deletion reason. A test that resembles implementation
may still be the independent contract, so prove otherwise before removing it.

## Candidate evidence

Record every field below before editing. A missing field means the candidate is
not ready for deletion:

- exact test name and location;
- what failure it can actually detect;
- non-test callers of the covered production or support seam;
- stronger remaining owner-boundary proof, or why no proof is needed;
- relevant history and the reason the test or seam exists;
- production or test-support deletion unlocked;
- risk and the focused validation command.

## Edit shape

Choose one coherent owner-boundary batch. Delete obsolete test-only exports,
globals, wrappers, and dead production paths instead of preserving aliases.
Move retained regressions to their canonical owners. Consolidate repeated
package or dependency assertions into one generic contract.

Prefer net-negative production LOC. Do not add replacement tests that restate
the same implementation, and do not convert uncertain candidates into cleanup
to increase deletion counts.

## Validation

1. Run the owner and sibling test files with `node --test <path>`.
2. For removed source greps or copied inventories, run the command whose
   output is the real contract, such as `node src/cli.mjs build` or
   `node tests/fixture/build.mjs`.
3. Run `npx --yes prettier@3.9.6 --write` on the changed files, then
   `git diff --check`.
4. Run the three CI checks: `node --test`, `npx --yes prettier@3.9.6 --check .`
   and `npx --yes eslint@10.11.0 .`.
5. Inspect `git diff --numstat`, and report production and tooling separately
   from tests and test support.

## Handoff

Report:

- root cause and removed low-value categories;
- production owner simplifications;
- retained false positives and why they remain valuable;
- focused and full proof actually run;
- production versus test LOC;
- PR and merge state;
- named follow-ups.
