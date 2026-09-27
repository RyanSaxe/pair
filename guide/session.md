# Run the review session

Keep the session directory's path in the conversation so that an
interrupted turn can resume it. Keep generated files and feedback outside
the project's history.

## Starting

```sh
pair start
```

`pair start` starts the hub if none is running, registers the session and prints
`{sessionId, sessionDir, url, wake}` as JSON, with `hostUrl` when the hub
also listens on a phone-reachable address. Every later command takes
`--session-dir PATH` with the printed `sessionDir`. When the harness cannot
receive a wake event, `pair start` creates nothing and prints an instruction.
Give it to the user, and run `pair start` again after the restart.

If a session already exists, resume it with `pair start --session-dir PATH`,
which keeps its URL. Do not create a replacement. The directory name under
`sessions/` is not the session ID in the URL. `connection.json` in the
directory holds the ID. Sessions that interactive-plan created stay under
`~/.local/state/interactive-plan/`, and `pair start` refuses to resume one that
published a round, so start a new session instead.

On the first Agreed publication, open the URL in the operating system's default
browser (macOS `open`, Windows PowerShell `Start-Process`, Linux `xdg-open`,
with the URL quoted) and give the link in chat, with `hostUrl` beside it when
`pair start` printed one. If the launch fails, say so and keep the link
available. Do not open another tab on later rounds. The open tab shows new pages
and rounds in place.

## Taking over

The agent that runs `pair start` holds the session. The hub wakes only the
holder and refuses every command but `pair status` from any other agent. A
subagent runs commands in its parent's environment, so it works as its
parent.

Any agent in any harness takes a session over with its handoff line. The
holder says it in chat after a Save for later, the accepted banner shows it
then, and the Feedback card shows it after a failed wake:

```text
Take over pair session PATH: run pair start --session-dir PATH and follow what it prints.
```

The new holder follows the `next` line that `pair start` prints. The holder
running `pair start` again changes nothing, because it already holds the
session. On a saved plan, that holds only until `pair read` returns the Save.
From then on, `pair start` on the session builds the plan, whichever agent runs
it, the holder included, and its `next` line says to read the acceptance and
build the plan.

After a takeover, the previous holder's first command other than
`pair status` fails, `pair start` included, with "Another agent took this
session over at 14:02. Stop working on it." Stop working on the session and
tell the user.

Any other command but `pair status` from an agent that does not hold the
session, the previous holder's later commands included, is refused with the
time the holder took it and the `pair start` command that takes it over. Run
that command only when the user asks you to. Claude Code tells its sessions
apart by process, so a conversation resumed after Claude Code restarts does
not hold the session.

## Resuming

If a turn is interrupted, the next turn runs `pair ack` before doing anything
else. It prints where the session stands and the next step. `pair publish`
refuses while a submission is unread. A failed request to the hub is not
completion: check that the hub is alive, retry the same session, and inspect the
recorded owner before any recovery. Never delete ownership files without reading
them.

```sh
pair ack --session-dir PATH
```

When the user says in words to stop, run `pair pause`. The page tells the reader
that the agent stopped and that a message in the chat resumes the session.
A submission to a paused session wakes no one. `pair read` returns it after
`pair start --session-dir PATH` resumes the session.

```sh
pair pause --session-dir PATH --reason "asked to stop"
```

If the user closes the session from the browser, the hub completes it and
sends no more wake events. Start a new session to continue.

If the hub is unavailable, the browser offers the reader a JSON export of
their feedback. Treat an exported file as feedback, never as implementation
permission.

## Acceptance

A round that carries an `offer` lets the reader accept it. An `accept` event
names the round's `offer` and the `action` the reader chose. Its `groups`
field contains the comments and choices the reader wrote on the round before
accepting it, and it may include `guidance` of up to 4,000 characters. The
`next` line of `pair read` names the offer's guide file, which says what each
action asks of you.

Accepting a plan keeps the session. Start implementation goes on to the build
round. Save for later saves the session: the holder says the handoff line
that `pair read` prints in chat and ends its turn, and the line builds the plan
in whichever agent runs it later.
`pair complete` ends the session once the agent has done the action the reader
accepted work with, and it refuses after a plan's acceptance.

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
