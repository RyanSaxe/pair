# Build the work

When you start a [proposal](../concepts/proposals-and-work.md), the agent
builds the work you approved, from the proposal's plan when it has one. Work
you start **Here** runs in the same session and tab. Work you start in a
sub-session or with a new agent runs in its own session, which you open from
the card.

## Follow the build

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/progress-card-dark.png">
  <img alt="The progress card: 2 of 4 pages ready, the page in progress with when it last changed, the agent's note under the title, and Message the agent" src="../assets/progress-card-light.png" width="390">
</picture>

- The agent builds the work on a new branch, and names the branch on the
  first page about the work.
- Agreed shows the task and a progress card. The card lists each page as
  Ready or Queued, or, for a page the agent is working on, how long ago the
  agent last reported on it, with the agent's note.
- The agent publishes each part as soon as you can judge it, so you can
  redirect the agent while it builds the rest.
- When the plan does not cover something, the agent decides it, keeps
  building, and explains the decision on the next page.
- When the agent fixes a problem it found along the way, it says so on the
  work's pages. It records unrelated work as a new proposal.
- The plan stays on the proposal's card. Open it from Work with **Open** on
  the card's Plan line.

## Steer it

| To                                  | Do this                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Change the work while it runs       | Ask for the change in a thread or a comment. The agent makes the change you ask for. |
| Add work the agent found on the way | Start the proposal the agent records for it.                                         |
| Stop                                | Tell the agent in chat. It pauses the session, and continues when you ask it to.     |

## Review the work

On the last page about the work, the agent explains it well enough for you
to review and maintain it. After the agent publishes that page, it marks the
proposal done, and pair moves the card to Done. When your feedback asks for
changes to the work, the agent reopens the proposal, pair moves the card
back to Running, and the agent publishes the changes in the next round.

Work in a sub-session or a new agent session is finished when you close
that session. When all the work is finished, tell the agent anything left
to do, such as opening the pull request, and then close the session.
