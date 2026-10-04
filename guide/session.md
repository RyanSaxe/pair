# Run the review session

`pair` runs from any directory. A session's files are in its session
directory under pair's state directory, not in the project. Keep the session
directory's path in the conversation so that an interrupted turn can resume
it. Keep generated files and feedback outside the project's history.

## Taking over

The agent that runs `pair start` is the session's holder. The hub sends wake
messages only to the holder. From any other agent it takes `pair status` and
`pair start`, which makes that agent the holder, and refuses every other
command. A subagent runs commands in its parent's
environment, so the hub treats it as its parent.

Any agent in any harness becomes the holder by running the command in the
session's handoff line:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

Then follow the next step that `pair start` prints. When the holder runs
`pair start` again, it stays the holder.

When a command fails because another agent is the session's holder, stop
working on the session and tell the user. The hub refuses the first command
from an agent the session was taken from, `pair start` included. Run
`pair start` again only when the user asks you to take the session back.

The hub identifies a Claude Code agent by its inbox socket, and each Claude
Code process has its own. A conversation resumed after Claude Code restarts
is therefore a new agent, and it is not the holder.

## Resuming

If a session already exists, resume it with `pair start --session-dir PATH`,
which keeps its URL. Do not create a replacement. The directory name under
`sessions/` is not the session ID in the URL. `connection.json` in the
directory contains the ID.

After an interrupted turn, `pair read` prints where the session stands.
`pair publish` refuses while a submission is unread, and
`pair read --submission ID` prints again a submission that you read in the
interrupted turn.

When a command cannot reach the hub, run `pair guide setup.md` and follow
it, then run the same command again on the same session. Do not start a
replacement session.

When the user says in words to stop, run `pair pause`. The hub sends no
wake message for a submission to a paused session. When the user asks you
to continue, `pair start --session-dir PATH` resumes the session, and
`pair read` returns any submission that arrived while it was paused.

```sh
pair pause --session-dir PATH --reason "asked to stop"
```

If the user closes the session from the browser, the hub completes it and
sends no more wake messages. Start a new session to continue.

If the hub is unavailable, the reviewer can export their feedback from the
browser as a JSON file. Treat an exported file as feedback, never as
implementation permission.
