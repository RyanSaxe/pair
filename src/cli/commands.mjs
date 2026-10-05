import { main as build } from "./build.mjs";
import { check, setupCodex } from "./check.mjs";
import { components } from "./components.mjs";
import { main as diff } from "./diff.mjs";
import { guide } from "./guide.mjs";
import { plan, publish, runHub, start } from "./session.mjs";
import { pause, progress, propose, read, reply, status } from "./actions.mjs";

const sessionDir = {
  value: "DIR",
  required: true,
  text: "The session's directory.",
};
const json = { text: "Print the result as one JSON object." };

// Every command, in the order pair --help lists them. An entry has the line
// pair --help prints (purpose), the paragraph its own --help starts with
// (about), its flags and arguments, and the function that runs it.
export const commands = {
  start: {
    group: "session",
    purpose: "Start a session, or resume or take over one with --session-dir",
    about:
      "Create a session, or take over the one --session-dir names, so the hub wakes this agent when the reviewer sends feedback, and print the session's directory and URL. With --from and --proposal, create a session that builds one proposal of another session, linked to that session.",
    usage:
      "pair start (--title TEXT | --session-dir DIR | --from DIR --proposal ID)",
    flags: {
      title: {
        value: "TEXT",
        text: "The new session's title, until the title of the first Agreed you publish replaces it. pair start needs it to create a session without --from.",
      },
      "session-dir": {
        value: "DIR",
        text: "Resume that session, or take it over from another agent. It takes no --title.",
      },
      from: {
        value: "DIR",
        text: "Create a session for a proposal of the session in DIR, linked to that session both ways, with the proposal's title. It takes --proposal.",
      },
      proposal: {
        value: "ID",
        text: "The proposal the new session builds, which the reviewer approved to run in a sub-session or with a new agent. Give it with --from.",
      },
      json,
    },
    run: start,
  },
  read: {
    group: "session",
    purpose: "Print the reviewer's next submission, a past one, or a thread",
    about:
      "Print what the reviewer sent that you have not read yet, and mark it read. Then list each thread where the reviewer wrote, or agreed with one of your messages, since their previous submission.",
    usage: "pair read --session-dir DIR [--submission ID | --thread ID]",
    flags: {
      "session-dir": sessionDir,
      submission: {
        value: "ID",
        text: "Print that submission again without marking anything, when you resume after an interruption.",
      },
      thread: {
        value: "ID",
        text: "Print that thread whole, with how to answer it, and mark it read.",
      },
      json,
    },
    run: read,
  },
  progress: {
    group: "session",
    purpose:
      "Report that you started a page, or post a note on a page or the round",
    about:
      "Report that you started a page, or post a note about a page or the round, so the reviewer can follow what you are doing.",
    flags: {
      "session-dir": sessionDir,
      page: {
        value: "ID",
        repeats: true,
        text: "A page of the open round, which pair progress marks as started. Give --page once for each page you work on at the same time.",
      },
      note: {
        value: "TEXT",
        text: "What you are doing, in at most 80 characters. With --page, the note is about those pages, and without it, about the round.",
      },
      json,
    },
    footer: "Give --page, --note or both.",
    run: progress,
  },
  publish: {
    group: "session",
    purpose: "Publish a built page, and with Agreed the round's page list",
    about:
      "Publish one built page. A round's first publish is Agreed, with --pages.",
    flags: {
      "session-dir": sessionDir,
      file: {
        value: "HTML",
        required: true,
        text: "A page that pair build wrote.",
      },
      pages: {
        value: "JSON",
        text: "The round's page list. Give it only when you publish Agreed.",
      },
      source: {
        value: "DIR",
        text: "The page's source directory, which pair copies into the session so you can start the next round from it.",
      },
      json,
    },
    run: publish,
  },
  reply: {
    group: "session",
    purpose: "Post your reply in a thread",
    about:
      "Post your reply in a thread. pair read --thread ID prints the thread.",
    usage:
      "pair reply --session-dir DIR --thread ID (--text TEXT | --file HTML)",
    flags: {
      "session-dir": sessionDir,
      thread: {
        value: "ID",
        required: true,
        text: "The thread, from the wake message or pair read.",
      },
      text: { value: "TEXT", text: "Your reply as plain text." },
      file: {
        value: "HTML",
        text: "Your reply as an HTML fragment that passes pair build's page checks.",
      },
      json,
    },
    footer: "Give --text or --file, not both.",
    run: reply,
  },
  pause: {
    group: "session",
    purpose: "Pause the session when the reviewer tells you to stop",
    about:
      "Pause the session when the reviewer tells you to stop. pair start resumes it.",
    flags: {
      "session-dir": sessionDir,
      reason: {
        value: "TEXT",
        required: true,
        text: "Why you paused the session, in a few words.",
      },
      json,
    },
    run: pause,
  },
  status: {
    group: "session",
    purpose: "Print where the session stands. Any agent may run it.",
    about:
      "Print where the session stands. Any agent may run it. The output starts with the next step only for the session's holder, the agent that last ran pair start on it.",
    flags: { "session-dir": sessionDir, json },
    run: status,
  },
  propose: {
    group: "session",
    purpose:
      "Record a proposal, or revise, start, withdraw, finish, join or reopen one",
    about:
      "Record a piece of work as a proposal, which the reviewer can approve, decline or comment on. With one of --revise, --start, --withdraw, --done, --join or --reopen, act on the proposal that --id names. Any agent may run it. The output starts with the next step only for the session's holder, the agent that last ran pair start on it.",
    usage:
      "pair propose --session-dir DIR --id ID [--revise | --start WHERE | --withdraw | --done | --join TASK | --reopen] [FIELDS]",
    flags: {
      "session-dir": sessionDir,
      id: {
        value: "ID",
        required: true,
        text: "The proposal's ID, a slug of lowercase letters, digits and hyphens, such as phone-sidebar. A new proposal needs an ID the session does not have yet.",
      },
      title: { value: "TEXT", text: "The work, in at most 80 characters." },
      delivers: {
        value: "TEXT",
        text: "What the work delivers, in at most 400 characters.",
      },
      recommend: {
        value: "WHERE",
        text: "Where you recommend the work runs: here, sub-session or new-agent.",
      },
      thread: {
        value: "ID",
        text: "The thread the work came from, or with --start the thread the reviewer's words are in.",
      },
      page: {
        value: "ROUND/PAGE",
        text: "The page the work came from, or with --start the page the reviewer's words are on, such as 14/commenting.",
      },
      revise: {
        text: "Replace the fields you give and keep the rest. The hub refuses it once the reviewer has approved the proposal.",
      },
      start: {
        value: "WHERE",
        text: "Mark the proposal started when the reviewer asks you for the work in their own words, and give those words with --quote. WHERE is here, sub-session or new-agent.",
      },
      quote: {
        value: "TEXT",
        text: "With --start, the reviewer's words that asked for the work, in at most 4,000 characters.",
      },
      withdraw: {
        text: "Withdraw a proposal the reviewer has not approved when it no longer applies, and say why with --reason.",
      },
      reason: {
        value: "TEXT",
        text: "With --withdraw, why the proposal no longer applies, in at most 400 characters.",
      },
      done: {
        text: "Mark the proposal done after you publish the last page about work you built in this session. With --where, mark any proposal done whose work was finished somewhere else.",
      },
      where: {
        value: "TEXT",
        text: 'With --done, where the work was finished, such as "in #86", in at most 120 characters.',
      },
      join: {
        value: "TASK",
        text: "Merge this proposal into proposal TASK when TASK's work covers it. Only join a proposal the reviewer has not approved, into a TASK that is not marked done and is not running in another session. The hub then marks this proposal done as joined into TASK.",
      },
      reopen: {
        text: "Undo your --done when the reviewer asks for changes to the work or it is not finished, or undo your --join when TASK's work does not cover this proposal.",
      },
      json,
    },
    footer: "A new proposal needs --title, --delivers and --recommend.",
    run: propose,
  },
  plan: {
    group: "session",
    purpose: "Attach a plan to a proposal, or replace the plan it has",
    about:
      "Attach the plan's pages to the proposal that --proposal names, or replace its plan, with the rounds the plan came from. Any agent may run it. The output starts with the next step only for the session's holder, the agent that last ran pair start on it.",
    usage:
      "pair plan --session-dir DIR --proposal ID --rounds ROUNDS --pages JSON --file HTML... --source DIR",
    flags: {
      "session-dir": sessionDir,
      proposal: {
        value: "ID",
        required: true,
        text: "The proposal the plan is for. The hub refuses a proposal that the reviewer declined, that is withdrawn, or that is marked done.",
      },
      rounds: {
        value: "ROUNDS",
        required: true,
        text: "The rounds the plan came from: one round, such as 4, or a range, such as 13-15.",
      },
      pages: {
        value: "JSON",
        required: true,
        text: "The plan's page list, in the shape of a round's pages.json.",
      },
      file: {
        value: "HTML",
        required: true,
        repeats: true,
        text: "A page that pair build wrote. Give one for each page in --pages, in the same order.",
      },
      source: {
        value: "DIR",
        required: true,
        text: "The plan's source directory, with each page's source in a directory named by the page's ID. pair copies it into the session beside the plan.",
      },
      json,
    },
    run: plan,
  },
  guide: {
    group: "pages",
    purpose: "Print a guide file or a component's markup",
    about:
      "Print guide/pair.md, or FILE, then, for a Markdown file, your file at the same path under ~/.config/pair/ when there is one. FILE is a file under guide/ by its path there, such as agreements.md, moments/read-feedback.md or flow.svg, or components/README.md, or components/NAME/markup.html, which prints your component's markup when you have a component named NAME.",
    args: [{ name: "FILE", optional: true }],
    run: guide,
  },
  components: {
    group: "pages",
    purpose: "List the components, pair's and yours",
    about:
      "List every component, pair's and yours in ~/.config/pair/components/, one line each: its name, when to use it, and the pair guide command that prints its markup.",
    flags: { json },
    run: components,
  },
  build: {
    group: "pages",
    purpose: "Build a page from its source, or print every problem in it",
    about:
      "Build the page that SOURCE.json describes into OUTPUT.html, or print every structural problem in the source and write nothing. pair build refuses to overwrite OUTPUT.html.",
    args: [{ name: "SOURCE.json" }, { name: "OUTPUT.html" }],
    flags: { json },
    run: build,
  },
  diff: {
    group: "pages",
    purpose: "Write the before-after component's input from two files",
    about:
      "Write the before-after component's input from two whole files with git diff to OUTPUT.json. pair diff refuses to overwrite OUTPUT.json.",
    args: [{ name: "BEFORE" }, { name: "AFTER" }, { name: "OUTPUT.json" }],
    flags: { json },
    run: diff,
  },
  check: {
    group: "setup",
    purpose: "Check Node, storage, loopback, the hub port and Codex's rules",
    about:
      "Check Node, storage, loopback, the hub port and Codex's rules file, and print each result on its own line. XDG_STATE_HOME=DIR pair check checks storage under another state directory.",
    flags: { json },
    run: check,
  },
  "setup-codex": {
    group: "setup",
    purpose: "Let Codex run pair commands outside its sandbox without asking",
    about:
      "Write ~/.codex/rules/pair.rules, or the same file under CODEX_HOME, so Codex runs a command made only of pair calls outside its sandbox without asking. Run it once, outside the sandbox, after the user agrees, then ask them to restart Codex.",
    flags: { json },
    run: setupCodex,
  },
  hub: {
    hidden: true,
    help: "The hub process that pair start spawns. An agent never runs it.",
    run: runHub,
  },
};
