import { main as build } from "./build.mjs";
import { check } from "./check.mjs";
import { main as diff } from "./diff.mjs";
import { guide } from "./guide.mjs";
import { publish, runHub, start } from "./session.mjs";
import {
  ack,
  complete,
  pause,
  progress,
  read,
  reply,
  sideWork,
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
// (about), its flags and arguments, and the function that runs it. A flag or
// argument with a removed line is a form this release still runs, which
// pair --help and the command's --help leave out; 0.3 deletes them here.
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
      id: {
        value: "ID",
        removed:
          "--id on pair read is replaced by --submission. --id works in this release only.",
      },
      json,
    },
    run: read,
  },
  ack: {
    hidden: true,
    removed:
      "pair ack is replaced by pair read, which marks the feedback received as it prints it, and by pair progress --note for a note. pair ack works in this release only.",
    flags: {
      "session-dir": sessionDir,
      note: { value: "TEXT" },
      page: { value: "ID" },
      json,
    },
    run: ack,
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
      start: {
        value: "ID",
        removed:
          "--start on pair progress is replaced by --page, given once for each page. --start works in this release only.",
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
      note: {
        value: "ID",
        replaces: "thread",
        removed:
          "pair reply --note ID is replaced by pair read --thread ID to read a thread and pair reply --thread ID to post. --note on pair reply works in this release only.",
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
      "Print where the session stands, with its side work. Any agent may run it, and only the holder's output starts with the next step.",
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
  "side-work": {
    group: "session",
    purpose: "Record work outside the task, and report its state",
    about:
      "Record work outside the session's task, which the reviewer can start in parallel from Agreed, and report each change to it. Any agent may run it.",
    subcommands: {
      add: {
        about:
          "Record work outside the session's task, which the reviewer can start in parallel from Agreed. Any agent may run it.",
        flags: {
          "session-dir": sessionDir,
          title: { value: "TEXT", required: true, text: "The item's title." },
          text: { value: "TEXT", required: true, text: "What the work is." },
          source: {
            value: "TEXT",
            required: true,
            text: 'Where the work came from, such as "From the conversation".',
          },
          json,
        },
        run: (options) => sideWork("add", options),
      },
      update: {
        about: "Report a change to side-work item ID. Any agent may run it.",
        args: [{ name: "ID" }],
        flags: {
          "session-dir": sessionDir,
          state: {
            value: "STATE",
            required: true,
            text: "working, pr and done follow a start from Agreed, moved sends the item to a new session, and planned joins it to this session's plan.",
          },
          url: {
            value: "URL",
            text: "The pull request with pr, or the new session's URL with moved.",
          },
          json,
        },
        run: (options) => sideWork("update", options),
      },
    },
  },
  guide: {
    group: "pages",
    purpose: "Print a guide file or a moment",
    about:
      "Print guide/pair.md, or FILE, then your file at the same path under ~/.config/pair/ when there is one. FILE is a Markdown file under guide/ by its path there, such as round.md or moments/read-feedback.md, or components/README.md.",
    args: [{ name: "FILE", optional: true }],
    run: guide,
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
    args: [
      {
        name: "STATE_DIR",
        optional: true,
        removed:
          "pair check STATE_DIR is replaced by XDG_STATE_HOME=STATE_DIR pair check. It works in this release only.",
      },
    ],
    flags: {
      "codex-rules": {
        text: "Write Codex's allow rule for pair to ~/.codex/rules/pair.rules, or the same file under CODEX_HOME, and check nothing.",
      },
      json,
    },
    run: check,
  },
  hub: {
    hidden: true,
    help: "The hub process that pair start spawns. An agent never runs it.",
    run: runHub,
  },
};
