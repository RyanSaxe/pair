# Running a session

`pair` runs from any directory. A session's files are in its own directory
under pair's state directory, not in the project. Keep the session
directory's path in the conversation, so you can resume after an
interrupted turn. Do not commit pages or feedback to the project.

## Taking over

The agent that last ran `pair start` on a session is its holder, and the
hub wakes only the holder. From any other agent, the hub accepts only
`pair status`, `pair propose`, `pair plan` and `pair start`, and
`pair start` makes that agent the holder. A subagent runs its commands in
its parent's environment, so the hub treats it as its parent.

Any agent, in any agent CLI, can take over a session by running the
command in the session's handoff line:

```text
To take over pair session PATH, run pair start --session-dir PATH and follow what it prints.
```

Then follow the next step `pair start` prints. When you are already the
holder, running `pair start` again keeps you the holder.

When a command fails because another agent has taken over the session,
stop working on it and tell the reviewer. After another agent takes over,
the hub refuses your first command, even `pair start`. Only run
`pair start` again when the reviewer asks you to take the session back.

## Resuming

To resume a session, run `pair start --session-dir PATH`, which keeps its
URL. Do not start a new session in its place. The session's directory name
is not the ID in its URL. The ID is in `connection.json` in that directory.

After an interrupted turn, run `pair read`, which prints where the session
stands. `pair publish` refuses while there is feedback you have not read.
To see feedback again that you read in the interrupted turn, run
`pair read --submission ID`.

When a command cannot reach the hub, run `pair guide setup.md` and follow
it, then run the command again. Do not start a new session in its place.

When the reviewer tells you to stop, run `pair pause`:

```sh
pair pause --session-dir PATH --reason "asked to stop"
```

The hub does not wake you for feedback while the session is paused. When
the reviewer asks you to continue, run `pair start --session-dir PATH`,
then `pair read`, which prints any feedback that arrived in the meantime.

After the reviewer closes the session, start a new session if they ask you
to continue the work.

When the hub is down, the reviewer can export their feedback from the
browser as a JSON file. Treat that file as feedback.
