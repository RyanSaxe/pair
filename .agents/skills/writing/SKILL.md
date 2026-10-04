---
name: writing
description: "Read before writing or changing text that an agent or a person reads in pair: the guide, the installed skill, the lines the hub and the commands print, the README, docs, AGENTS.md and the repository skills. It names each text's reader and gives the sentence rules, what personification is and why pair's text avoids it, pair's terms, and the checks to run before you finish."
metadata:
  # npx skills add searches .agents/skills/ too, and skips a skill marked
  # internal unless INSTALL_INTERNAL_SKILLS=1 is set.
  internal: true
---

# Writing for pair

pair's text has two kinds of reader. An agent reads the guide and every line
the hub and the `pair` command print, and acts on each sentence in the middle
of a session. People read the README and `docs/`. Both read each sentence
literally, so each sentence states what a thing is or does.

## The text and its reader

| Text                    | Files                                                                                                                                                                                                                   | Reader                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| The guide               | `guide/`, which `pair guide` prints                                                                                                                                                                                     | The agent running a session                 |
| The installed skill     | `skills/pair/SKILL.md`                                                                                                                                                                                                  | The agent, before it runs `pair guide`      |
| Prompts                 | The moment texts in `guide/moments/`, the `next` lines from `nextStep()` in `src/hub/session/agent.mjs`, the wake line, the handoff line, the help text in `src/cli/commands.mjs`, and errors in `src/` and `adapters/` | The agent, in the middle of its task        |
| README and docs         | `README.md`, `docs/`                                                                                                                                                                                                    | A person installing, using or changing pair |
| Repository instructions | `AGENTS.md`, `.agents/skills/`                                                                                                                                                                                          | An agent changing pair                      |

## Sentences

Every sentence follows `guide/writing.md`, the rules pair gives an agent for
plan pages. Read it before you start. pair's own text follows two more rules:

- A fragment does not stand in for a claim. Write "One hub process serves every
  live session", not "One hub, many sessions."
- A sentence keeps the usual word order and states its fact plainly, with no
  aphorism. Write "They know only what the plan shows", not "Anything the plan
  does not show, they do not know."

## Personification

Personification is writing a thing as the actor of an action it does not
perform, or as having a thought, a wish or an intention that only a person has:
a line of text that runs a command, a submission that wakes someone, a field
that knows a value. pair's text avoids it because the reader of a personified
sentence cannot tell who acts, and in pair the actor is what the reader needs
to know.

- An agent acts on the guide and the prompts one sentence at a time. When a
  sentence makes a file, a line of text or a page the actor, the agent does
  not learn that the step is its own to do, or which program does it.
- A person debugging pair looks for the code that performs each action. After
  a sentence with the wrong actor, they search the wrong module, or look for a
  component that does not exist.
- A sentence with a figurative verb has no mechanism in it. "The hub knows the
  session" does not say how. "The hub identifies the session by its inbox
  socket" names the socket, which is what to check when a wake fails.
- Some ordinary words are also pair's terms. The holder is the agent that runs
  a session. A reader takes a sentence in which a field "holds" data as a
  statement about that term.

A verb whose subject performs it is not personification: `pair build` refuses a
page, the hub wakes the holder, the frame stores the draft, a page renders. The
same verb can be right in one sentence and wrong in the next, so judge each
sentence by whether its subject performs its verb, not by the verb.

These rewrites are from pair's guide:

| Before                                                                                                                         | After                                                                                                                         | Why                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| The handoff line is how the reviewer asks for the build. It runs `pair start --session-dir PATH` in any agent and any harness. | The reviewer asks for the build by giving the handoff line to any agent, and that agent runs `pair start --session-dir PATH`. | A line of text runs nothing. The agent that receives the line runs the command.                       |
| Claude Code tells its sessions apart by process.                                                                               | The hub identifies a Claude Code session by its inbox socket, and each Claude Code process has its own socket.                | The hub compares the sockets, in `adapters/claude-code/wake.mjs`, so a failed wake is debugged there. |
| The hub restarts on the newer code once no session is live.                                                                    | The next `pair start` that finds no live session replaces the hub with one on its own code.                                   | `pair start` stops the old hub and starts a new one. Nothing restarts the hub on its own.             |
| A submission to a paused session wakes no one.                                                                                 | The hub sends no wake event for a submission to a paused session.                                                             | The hub sends wake events. A submission is data.                                                      |
| The page tells the reader that the agent stopped and that a message in the chat resumes the session.                           | The progress card at the top of Agreed shows "Agent paused" with the reason, and "Send a message in chat."                    | The frame shows the card. The rewrite names the card and quotes what it shows.                        |

## Terms

Use one name for one thing, in one file and across the guide, the prompts and
the docs.

| Term         | Meaning                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hub          | The one process that serves every live session, on `127.0.0.1:4747` unless `PAIR_HUB_PORT` names another port.                                         |
| session      | One piece of work between an agent and a reviewer, from `pair start` until it completes, with its own directory under `~/.local/state/pair/sessions/`. |
| round        | The pages the agent publishes together, which the reviewer answers with one submission.                                                                |
| Agreed       | The first page of every round, with the task and the decisions settled so far.                                                                         |
| frame        | The browser page that shows a round and sends feedback. Its code is in `src/frame/`.                                                                   |
| holder       | The agent that last ran `pair start` on a session. The hub wakes only the holder, and other agents can run only `pair status` and `pair propose`.      |
| reviewer     | The person who reads a round's pages in the browser and sends feedback.                                                                                |
| proposal     | A card for one piece of work, which an agent records with `pair propose` and the reviewer starts, declines or comments on from Work.                   |
| agent CLI    | Claude Code, Codex, Copilot CLI, pi or opencode, each with a folder under `adapters/`.                                                                 |
| handoff line | The line that another agent runs to take a session over.                                                                                               |

## Instructions for the agent

The guide and the prompts are instructions: each sentence says what the agent
does next.

- Write each step as an instruction to the agent: "Run `pair read` first when
  the hub wakes you."
- Give the whole command with its arguments. Name a guide file by the
  `pair guide` command that prints it, written literally, such as
  ``run `pair guide writing.md` ``, and never with a Markdown link, as
  `AGENTS.md` says. A prompt names any other file by its absolute path.
- Put a condition before the action it controls: "When `pair start` refuses,
  run `pair check`."
- State each rule in one file, and name that file by its command in the
  others.
- Leave out what the agent does not need in order to act, as the rule for
  guide text in `AGENTS.md` says: how the frame shows something to the
  reviewer, why the reviewer does something, how the hub stores state, why a
  design was chosen, or how pair got here. The last three go in `docs/`.

## README and docs

- `README.md` says what pair is and does and that it is named for pair
  programming, shows one or two screenshots, and gives the install. It links
  to `docs/` for everything else, names no particular agent CLI, and has no
  FAQ.
- Describe the current behavior, and check it before you write it. Do not
  document a feature that has not shipped.

## Before you finish

1. Read each changed sentence again against this skill and `guide/writing.md`.
   Where the subject is a thing, check that the thing performs the verb.
2. Wrap Markdown prose at 80 columns. Prettier keeps line breaks where you put
   them, because `.prettierrc` sets `proseWrap` to `preserve`.
3. Run `npx --yes prettier@3.9.6 --check .`.
