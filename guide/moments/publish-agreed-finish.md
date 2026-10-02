In this round you build the work, with a page for each step and the pull
request description last.

- Before you change anything for a step, run
  `pair progress --page ID --note "…"` for the page that shows it, and again
  at least every five minutes while you or a subagent build it. Include that
  command for its page in every brief to a subagent that builds a step.
- Publish a step's page once the step is built and checked, with any
  departure from the plan and its reason.
- When the plan does not settle something, decide in line with its intent,
  build it, and say on the page what you decided and why.
- Commit on a branch as the project's instructions say, and open no pull
  request.

Start implementation in [offers/plan.md](../offers/plan.md) has the steps.
