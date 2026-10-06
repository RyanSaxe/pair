# Sessions and rounds

A session is one task you work on with your agent, such as understanding
some code, planning a change or building it, or all three in turn. Each
session has its own URL, and pair shows every round of it in the same tab.
The session lasts until you close it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/session-dark.svg">
  <img alt="A session: you ask, then work through rounds with feedback. The agent proposes work on the Work page, and work you start runs in the session's next rounds or in a sub-session. A session ends when you close it." src="../assets/session-light.svg">
</picture>

## A round

The agent shows you its work in rounds. A round is a set of pages that the
agent publishes together, and you answer the whole round with one piece of
feedback.

1. The agent publishes **Agreed** and the list of the round's pages first,
   then publishes each page as soon as it is finished. You can start reading
   as soon as the agent publishes Agreed.
2. You respond on the pages. You choose between options, answer questions
   and comment.
3. You press **Send feedback**, choose what comes next, and send. The agent
   reads your feedback and publishes the next round.

While the agent works, a progress card at the top of Agreed shows what it is
doing and how many pages are ready. Once the agent has published every page,
the round is waiting for you.

Sending feedback is the one thing that ends a round. When you start work from
a proposal or ask a question in a thread, the round stays as it is, and you
can still send feedback on it.

## The sidebar

The sidebar lists the round's pages, then **Work** and **Review**. The first
button in the header opens and closes the sidebar. On a screen wider than
720px, the sidebar starts open, and your browser remembers when you close
it. At 720px and narrower, the sidebar starts closed and slides over the
page when you open it, and choosing a page closes it again.

The **Last round** tab at the top of the sidebar shows the round before this
one. To read an older round, open it from the Rounds button, the clock in
the header. The tab then shows that round and reads **Round N**.

## What you can do on a page

| To                        | Do this                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Choose between options    | Press an option. The agent does not count an option marked **Recommended** as your choice until you press it.                           |
| Answer a question         | Type in its box, or draw when the question asks for a drawing.                                                                          |
| Comment on words          | Select them and press **Comment on selection** at the bottom right.                                                                     |
| Comment on a block        | Click the block, then press the button at the bottom right or <kbd>c</kbd>. Press <kbd>j</kbd> and <kbd>k</kbd> to move between blocks. |
| Comment on the page       | With nothing selected, press the comment button at the bottom right, or <kbd>c</kbd>.                                                   |
| Get an answer now         | Send the comment as a [thread](threads.md).                                                                                             |
| Approve or decline work   | Use the buttons on a proposal, on the page or on [Work](proposals-and-work.md).                                                         |
| Review what you will send | Press <kbd>r</kbd>.                                                                                                                     |
| See every key             | Press <kbd>?</kbd>.                                                                                                                     |

## Feedback

Your browser keeps everything you do on the pages as a draft until you send
it. **Send feedback** in the header opens a popup where you choose what the
agent does next, and the popup's button sends the round.

In most rounds, the choices are:

- **Keep iterating**: the agent takes your comments into the next pages.
- **Write a plan**: the agent makes the next round a plan you can build
  from.
- **Build it**: the agent applies your comments, then builds what Agreed
  describes, in this session.

In a plan round, the choices are:

- **Update the plan**: the agent revises the plan with your comments.
- **Back to iterating**: the agent sets the plan aside and keeps exploring.
- **Build it**: the agent applies your comments, then builds the plan, in
  this session.

The popup starts on the first choice, and never on Build it. The button
reads **Build it** when you choose Build it, and **Send** otherwise. The
agent can also make a round a plan without your asking, when it judges that
it knows enough to write one.

The popup also has a box for a message to the agent, which stays in your
draft until you send it, and the switch **Everything else looks good**,
which is on by default. When the switch is on, the agent treats everything
the pages stated as agreed, except where one of your comments challenges
it. The switch never chooses an option or answers a question for you.

After you send, the Review page lists what you sent, with your choice and
your message.

## Agreed

Agreed is the first page of every round, and the sidebar lists it as Agreed
so far. It shows the **task**, which says what you and the agent are working
towards. Under **Alignments**, it lists every decision you have settled so
far, each with a link to where you settled it. When something on Agreed is
wrong, comment on it.

A plan round has a grey **Plan** tag beside the title of its Agreed, and
beside the round in the Rounds panel.

| Tag               | Meaning                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| New, Updated      | The agent added or changed the alignment in this round.                                    |
| Revisiting        | Your feedback reopened the decision.                                                       |
| No longer applies | The agent retired the alignment and says why. Retired alignments are in a fold at the end. |

## When the agent edits your project

The agent only edits your project for work you have approved. You approve
work by choosing **Build it** when you send a round, by starting one of its
[proposals](proposals-and-work.md), or by asking the agent for the work in
your own words, in a comment, a thread, your feedback or the chat. When you
ask in words for work beside the session's task, the agent records the
request as a proposal and starts it, quoting you, so the Work page lists
every piece of work you approved beside the task.

Before you approve anything, the agent only tries ideas in a git worktree
inside the session's directory, or in a plain directory there when your
project is not a git repository. Your checkout and your branches stay as
they are. The agent asks you before it deletes a worktree it made.

## Sessions and notifications

### The session list

The Sessions button, second in the header, or <kbd>g</kbd>, opens the
session list. It lists every live session in the order the sessions
started. A
[sub-session](proposals-and-work.md#sub-sessions-and-new-agent-sessions)
is listed under the session it came from, with an arrow, ↳, in place of a
number. Each row has **Copy handoff line**, and ✕, which you press to close
the session.

- The number on the Sessions button shows how many other sessions need you.
  A session needs you when it has a round waiting for you, an agent the hub
  could not wake, or pages you have not opened. The number is orange when at
  least one of those sessions has a waiting round or an agent the hub could
  not wake, and blue otherwise. When no other session needs you, a grey
  number shows how many other live sessions you have. pair never counts the
  session in this tab.
- <kbd>1</kbd>–<kbd>9</kbd> open a session by its number. Sub-sessions have
  no number. <kbd>w</kbd> opens the next session with a round waiting for
  you, sub-sessions included.
- pair marks each page of a round that you have not opened as **New**.
- The list shows a session as soon as the agent starts it. Until the
  agent publishes the first Agreed, the session's page shows its title, its
  agent and the progress card.

### The bell

The bell, or <kbd>n</kbd>, opens a list of notifications. The orange number
on the bell, also shown in the browser tab's title, is the number of lines.
The list has a line for each agent reply in a thread and each proposal an
agent records, from every live session. It also has a line for each other
session that starts or has a round waiting for you.

| When you                          | pair removes        |
| --------------------------------- | ------------------- |
| Click a line or its ✕             | That line           |
| Send a waiting round              | That round's line   |
| Reply in a thread                 | That thread's lines |
| Give an agent's reply a thumbs up | That reply's line   |
| Press **Clear all**               | Every line          |

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/bell-dark.png">
  <img alt="The bell's list with another session's start and waiting round and an agent's reply, and the session button in orange because that session waits for you" src="../assets/bell-light.png">
</picture>

### System notifications

When you turn notifications on in Settings, your browser also shows a system
notification for each new line and for each agent the hub cannot wake,
except for the session in the tab you are using.

## Closing a session

Close a session when you are done with it, after you have told the agent
anything left to do. Press ✕ on the session's row in the session list, and
confirm in the dialog that opens. The session becomes read-only, with every
round kept. The hub sends the agent no message. When the agent next runs a
`pair` command other than `pair status`, the hub refuses it with a line that
says you closed the session.

Closing deletes no files. The git worktrees where the agent tried ideas stay
until the agent deletes them with your approval. When you close a
sub-session, the hub marks its proposal done in the session it came from. A
closed session that still has open sub-sessions stays in the list as a grey
heading above them, and pair removes it from the list once you close the
last of them.
