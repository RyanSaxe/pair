import { main as build } from "./build.mjs";
import { check, setupCodex } from "./check.mjs";
import { components } from "./components.mjs";
import { main as diff } from "./diff.mjs";
import { guide } from "./guide.mjs";
import { publish, runHub, start } from "./session.mjs";
import {
  complete,
  pause,
  progress,
  read,
  reply,
  status,
} from "./actions.mjs";

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
      "Make this agent the holder of a new session, or of the one --session-dir names, and print the session's directory and URL.",
    usage: "pair start (--title TEXT | --session-dir DIR)",
    flags: {
      title: {
        value: "TEXT",
        text: "The new session's title, which the reviewer sees until the first Agreed replaces it. Required when pair start creates a session.",
      },
      "session-dir": {
        value: "DIR",
        text: "Resume that session, or take it over from another agent. It takes no --title.",
      },
      json,
    },
    run: start,
  },
  read: {
    group: "session",
    purpose: "Print the reviewer's next submission, a past one, or a thread",
    about:
      "Print the reviewer's next submission and mark it received and read, then list each thread the reviewer started or added to since the submission before it.",
    usage: "pair read --session-dir DIR [--submission ID | --thread ID]",
    flags: {
      "session-dir": sessionDir,
      submission: {
        value: "ID",
        text: "Print that past submission again and mark nothing, for a turn that resumes after an interruption.",
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
    purpose: "Report a page started, or a note on a page or the round",
    about:
      "Report what you are doing, which the progress card shows: a page started, a note on a page, or a note on the round.",
    flags: {
      "session-dir": sessionDir,
      page: {
        value: "ID",
        repeats: true,
        text: "A page of the round. A report on a page marks it started. Give it once for each page worked on at the same time.",
      },
      note: {
        value: "TEXT",
        text: "What you are doing, in at most 80 characters. With --page it goes on that page's row. Alone it is a note on the round, before or after Agreed.",
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
        text: "The round's page list, given with Agreed only.",
      },
      source: {
        value: "DIR",
        text: "The page's source directory, which pair copies into the session so the next round starts from it.",
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
    purpose: "Pause the session when the user says to stop",
    about:
      "Pause the session when the user says to stop. pair start resumes it.",
    flags: {
      "session-dir": sessionDir,
      reason: {
        value: "TEXT",
        required: true,
        text: "Why the session stopped, which the progress card shows.",
      },
      json,
    },
    run: pause,
  },
  status: {
    group: "session",
    purpose: "Print where the session stands. Any agent may run it.",
    about:
      "Print where the session stands. Any agent may run it, and only the holder's output starts with the next step.",
    flags: { "session-dir": sessionDir, json },
    run: status,
  },
  complete: {
    group: "session",
    purpose: "End the session once the accepted work is done",
    about:
      "End the session once the reviewer accepts built work and the accepted action is done.",
    flags: { "session-dir": sessionDir, json },
    run: complete,
  },
  guide: {
    group: "pages",
    purpose: "Print a guide file, a moment or a component's markup",
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
      "Write ~/.codex/rules/pair.rules, or the same file under CODEX_HOME, so Codex runs a command made only of pair calls outside its sandbox without asking. Run it once, outside the sandbox, after the user says yes, then ask the user to restart Codex.",
    flags: { json },
    run: setupCodex,
  },
  hub: {
    hidden: true,
    help: "The hub process that pair start spawns. An agent never runs it.",
    run: runHub,
  },
};
