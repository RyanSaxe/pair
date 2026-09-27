# Run the review session

`pair` runs from any directory. A session's files are in its session
directory under pair's state directory, not in the project. Keep the session
directory's path in the conversation so that an interrupted turn can resume
it. Keep generated files and feedback outside the project's history.

## Starting

```sh
pair start
```

`pair start` starts the hub if none is running, registers the session and prints
`{sessionId, sessionDir, url, wake}` as JSON, with `hostUrl` when the hub
also listens on a phone-reachable address. Every later session command takes
`--session-dir PATH` with the printed `sessionDir`. When the harness cannot
receive a wake message, `pair start` creates nothing and prints an
instruction. Give it to the user, and run `pair start` again after the
restart.

If a session already exists, resume it with `pair start --session-dir PATH`,
which keeps its URL. Do not create a replacement. The directory name under
`sessions/` is not the session ID in the URL. `connection.json` in the
directory contains the ID.

On the first Agreed publication, open the URL in the operating system's default
browser (macOS `open`, Windows PowerShell `Start-Process`, Linux `xdg-open`,
with the URL quoted) and give the link in chat, with `hostUrl` beside it when
`pair start` printed one. If the launch fails, say so and keep the link
available. Do not open another tab on later rounds. The open tab shows new pages
and rounds in place.

## Taking over

The agent that runs `pair start` is the session's holder. The hub sends wake
messages only to the holder and refuses every command but `pair status` and
`pair side-work` from any other agent. A subagent runs commands in its
parent's environment, so the hub treats it as its parent.

Any agent in any harness becomes the holder by running the command in the
session's handoff line:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

Then follow the `next` line that `pair start` prints. When the holder runs
`pair start` again, it stays the holder.

An agent that is not the holder gets one of two refusals:

- A former holder's first command other than `pair status` or
  `pair side-work` after the takeover, `pair start` included, fails with
  "Another agent took this session over at 14:02. Stop working on it." Stop,
  and tell the user.
- Every other command but those two fails with the time the holder took
  the session and the `pair start` command that takes it over. Run that
  command only when the user asks you to.

pair tells Claude Code agents apart by their inbox socket, and each Claude
Code process has its own. A conversation resumed after Claude Code restarts
is therefore a new agent, and it is not the holder.

## Resuming

If a turn is interrupted, the next turn runs `pair ack` before doing anything
else. It prints where the session stands and the next step. `pair publish`
refuses while a submission is unread.

```sh
pair ack --session-dir PATH
```

When a command cannot reach the hub, follow [setup.md](setup.md), then run
the same command again on the same session. Do not start a replacement
session.

When the user says in words to stop, run `pair pause`. A submission to a
paused session sends no wake message. When the user asks you to continue,
`pair start --session-dir PATH` resumes the session, and `pair read` returns
any submission that arrived while it was paused.

```sh
pair pause --session-dir PATH --reason "asked to stop"
```

If the user closes the session from the browser, the hub completes it and
sends no more wake messages. Start a new session to continue.

If the hub is unavailable, the reviewer can export their feedback from the
browser as a JSON file. Treat an exported file as feedback, never as
implementation permission.

## Acceptance

A round whose Agreed names an `offer` lets the reviewer accept it. An
`accept` event names the round's `offer` and the `action` the reviewer
chose. The `next` line of `pair read` names the offer's guide file, which
says what each action asks of you.

`pair complete` ends the session. Run it after the reviewer accepts built
work, once you have done the action they chose. After a plan's acceptance it
refuses, because both plan actions keep the session open.

```sh
pair complete --session-dir PATH
```

`acceptance.json` in the session directory records the acceptance, with the
accepted round's built file in `path` to open in a browser. The same pages, as
HTML fragments with their prototypes, are in the session's
`src/<round>/<page-id>/` and are the faster way for an agent to read them. Do
not infer implementation permission from feedback, a recommendation or an
acknowledgement. Leave accepted rounds and the acceptance record unchanged. A
later change requires a new round and a new review.
