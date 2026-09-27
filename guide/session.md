# Run the review session

Keep the session directory's path in the conversation so that an
interrupted turn can resume it. Keep generated files and feedback outside
the project's history.

## Starting

```sh
pair start
```

`start` starts the hub if none is running, registers the session and prints
`{sessionId, sessionDir, url, wake}` as JSON, with `hostUrl` when the hub
also listens on a phone-reachable address. Every later command takes
`--session-dir PATH` with the printed `sessionDir`. When the harness cannot
receive a wake event, `start` creates nothing and prints an instruction.
Give it to the user, and run `start` again after the restart.

If a session already exists, resume it with `start --session-dir PATH`,
which keeps its URL. Do not create a replacement. The directory name under
`sessions/` is not the session ID in the URL. `connection.json` in the
directory holds the ID. Sessions that interactive-plan created stay under
`~/.local/state/interactive-plan/`, and `start` refuses to resume one that
published a round, so start a new session instead.

On the first Agreed publication, open the URL in the operating system's
default browser (macOS `open`, Windows PowerShell `Start-Process`, Linux
`xdg-open`, with the URL quoted) and give the link in chat, with `hostUrl`
beside it when `start` printed one. If the launch fails, say so and keep the
link available. Do not open another tab on later rounds. The open tab
shows new pages and rounds in place.

## Resuming

If a turn is interrupted, the next turn runs `ack` before doing anything else.
It prints where the session stands and the next step. `publish` refuses
while a submission is unread. A failed request to the hub is not completion: check
that the hub is alive, retry the same session, and inspect the recorded owner
before any recovery. Never delete ownership files without reading them.

```sh
pair ack --session-dir PATH
```

When the user says in words to stop, run `pause`. The page tells the reader
that the agent stopped and that a message in the chat resumes the session.
A submission to a paused session wakes no one. `read` returns it after
`start --session-dir PATH` resumes the session.

```sh
pair pause --session-dir PATH --reason "asked to stop"
```

If the user closes the session from the browser, the hub completes it and
sends no more wake events. Start a new session to continue.

If the hub is unavailable, the browser offers the reader a JSON export of
their feedback. Treat an exported file as feedback, never as implementation
permission.

## Acceptance

An `accept-plan` event includes an explicit `mode`:

- `save`: acknowledge, complete, and report the durable plan path. Do not
  implement.
- `implement`: acknowledge, complete, and read the accepted plan. The event
  may include `guidance` of up to 4,000 characters. Read it with the plan
  and implement under the project's instructions, isolation requirements,
  and existing permissions. If the guidance changes an agreed requirement,
  request a new review. Acceptance authorizes nothing else.

In either mode, the event's `groups` field contains the comments and
choices the reader wrote on the plan before accepting it, and `complete`
returns them as `groups`. Read them with the plan. If one of them changes an
agreed requirement, request a new review, as with guidance.

```sh
pair complete --session-dir PATH
```

`complete` returns `nextAction`, `planPath` and any `guidance`. `planPath` is
the built plan to open in a browser. The same pages, as HTML fragments with
their prototypes, are in the session's `src/<round>/<page-id>/` and are
the faster way for an agent to read the plan. Do not infer implementation
permission from feedback, a recommendation or an acknowledgement. Leave
accepted rounds and the acceptance record unchanged. A later change
requires a new round and a new review.
