# Holders and handoff

One agent at a time holds a session: the **holder**, the agent that last ran
`pair start` on it. The hub wakes only the holder. A subagent counts as its
parent.

## Handing a session over

Give another agent, in any supported agent CLI, the session's **handoff
line**:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

The page shows it with a Copy button after **Save for later** and after a
failed wake, and the session list has **Copy handoff line** on each session. You
might also hand over to carry on in a new conversation.

## What other agents can run

| Command       | From an agent that is not the holder |
| ------------- | ------------------------------------ |
| `pair start`  | Takes the session over.              |
| `pair status` | Works, also from a plain terminal.   |
| Anything else | Refused.                             |

After a takeover, the former holder's next command other than `pair status`,
`pair start` included, fails with the time it lost the session.
