# Holders and handoff

Each session has one **holder**: the agent that last ran `pair start` on it. The
hub wakes only the holder. Subagents run in their parent's environment, so the
hub treats a subagent as its parent. A session's holder also holds its
[sub-sessions](proposals-and-work.md#sub-sessions-and-new-agent-sessions); a
separate agent holds each new agent session.

## Handing a session over

To move a session to another agent, give that agent the session's
**handoff line**:

```text
To take over pair session PATH, run pair start --session-dir PATH and follow what it prints.
```

Any supported agent CLI can run that command and become the holder. Copy it from
**Copy handoff line** in the session list, or from the progress card and thread
card when a wake fails.

## What other agents can run

| Command           | When a non-holder runs it                                           |
| ----------------- | ------------------------------------------------------------------- |
| `pair start`      | That agent becomes the holder.                                      |
| `pair status`     | Succeeds. Also works from a plain terminal while the hub runs.      |
| `pair propose`    | Succeeds, so subagents and other agents can record proposals.       |
| Any other command | Refused by the hub.                                                 |

After another agent takes over, `pair status` and `pair propose` keep working
for the former holder, and the hub refuses any other command from it, including
`pair start`, with the takeover time. The progress card shows which agent took
over and when until you send the next round.
