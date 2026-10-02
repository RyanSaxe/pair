This round is the final plan, which an engineer or agent who saw none of
the rounds builds from alone.

- On `overview`, state the outcome and how the parts relate. On each later
  page, state its part's behavior, the interfaces it changes by their real
  paths, and how to verify it.
- Copy approved mocks, diagrams, code and wording from the session's
  `src/<round>/<page-id>/`, updated to match Agreed, and say which parts are
  binding.
- Where implementation must find something out, say what, how, and what
  result is acceptable.
- Subagents can write the pages at once, because each depends only on
  Agreed. Brief each with this list and `pair progress --page ID --note "…"`
  for its page, and keep every row current with a note at least every five
  minutes.
- Before the last page, check the plan against Agreed, the feedback and the
  Present the plan section of `pair guide offers/plan.md`.
