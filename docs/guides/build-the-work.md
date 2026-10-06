# Build the work

The agent builds work when you choose **Build it** as you send a round, or
when you start a [proposal](../concepts/proposals-and-work.md).

- When you choose **Build it**, the agent builds what Agreed describes,
  following the last plan if there is one, in this session's rounds.
- A proposal you start **Here** runs in the same session and tab. One you
  start in a sub-session or with a new agent runs in its own session, which
  you open from the card. When you check **Plan it first** in the Start
  popup, that session plans the work in its rounds and builds nothing until
  you choose Build it there.

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

## Steer it

| To                                  | Do this                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| Change the work while it runs       | Ask for the change in a thread or a comment. The agent makes the change you ask for. |
| Add work the agent found on the way | Start the proposal the agent records for it.                                         |
| Stop                                | Tell the agent in chat. It pauses the session, and continues when you ask it to.     |

## Review the work

On the last page about the work, the agent explains it well enough for you
to review and maintain it. When the work is a proposal that runs here, the
agent marks it done after it publishes that page, and pair moves the card to
Done. When your feedback asks for changes to the work, the agent reopens the
proposal, pair moves the card back to Running, and the agent publishes the
changes in the next round.

Work in a sub-session or a new agent session is finished when you close
that session. When all the work is finished, tell the agent anything left
to do, such as opening the pull request, and then close the session.
