# Holders and handoff

Each session has one **holder**, the agent that last ran `pair start` on it.
The hub only wakes the holder. A subagent runs its commands in its parent's
environment, so the hub treats a subagent as its parent. The agent that
holds a session also holds its
[sub-sessions](proposals-and-work.md#sub-sessions-and-new-agent-sessions),
and a separate agent holds each new agent session.

## Handing a session over

To move a session to another agent, give that agent the session's **handoff
line**:

```text
To take over pair session PATH, run pair start --session-dir PATH and follow what it prints.
```

The agent runs the command in the line and becomes the holder. It can be an
agent in any supported agent CLI, such as one in a new conversation where
you want to carry on. Each row of the session list has **Copy handoff
line**. When the hub cannot wake the agent, the progress card and the
thread's card also show the line, with a button that copies it.

## What other agents can run

| Command                     | When an agent that is not the holder runs it                                      |
| --------------------------- | --------------------------------------------------------------------------------- |
| `pair start`                | That agent becomes the holder.                                                    |
| `pair status`               | It works. You can also run it from a plain terminal while the hub is running.     |
| `pair propose`, `pair plan` | They work, so a subagent or another agent can record a proposal or attach a plan. |
| Any other command           | The hub refuses it.                                                               |

`pair status`, `pair propose` and `pair plan` keep working for an agent
after another agent takes its session over. The hub refuses the former
holder's next command of any other kind, `pair start` included, with the
time the takeover happened. The progress card shows which agent took over,
and when, until you next send feedback.
