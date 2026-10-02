# Side work

Record side work when you find something outside the task, in a comment or
in your own work, and when the reviewer asks for it in a note. Leave it out
of the task.

```sh
pair side-work add --title "Delete visual-review" --text "The skill is deprecated but still installed." --source "From the conversation" --session-dir PATH
```

The title names the work in a few words, the text says what it is and why in
a sentence or two, and the source says where it came from, such as the
reviewer's note or the command that showed it. The reviewer can comment on
an item, drop it or start it in parallel. A note on an item has the item's
ID in `sideWorkId`, and `pair status` lists every item.

An item starts as `recorded`. Move it to another state with
`pair side-work update ID --state STATE --session-dir PATH`:

- When the reviewer starts an item in parallel, the hub sends you a wake
  message with the steps for the item. Move it to `working` as the work
  starts, to `pr` with `--url` and the pull request's link once the pull
  request is open, and to `done` once it is merged.
- When the reviewer asks for the item in this session's plan, add it to
  Agreed and move it to `planned`.
- When a new session plans the item, move it to `moved` with `--url` and the
  new session's URL.

To correct an item's link, repeat its state with the new `--url`. The hub
takes `pair side-work` from any agent, so an agent you brief can report its
own progress.
