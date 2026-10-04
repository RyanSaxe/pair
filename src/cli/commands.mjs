import { main as build } from "./build.mjs";
import { check, setupCodex } from "./check.mjs";
import { components } from "./components.mjs";
import { main as diff } from "./diff.mjs";
import { guide } from "./guide.mjs";
import { plan, publish, runHub, start } from "./session.mjs";
import {
  ack,
  complete,
  pause,
  progress,
  propose,
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
// (about), its flags and arguments, and the function that runs it. A flag or
// argument with a removed line is a form this release still runs, which
// pair --help and the command's --help leave out; 0.3 deletes them here.
export const commands = {
  start: {
    group: "session",
    purpose: "Start a session, or resume or take over one with --session-dir",
    about:
      "Make this agent the holder of a new session, or of the one --session-dir names, and print the session's directory and URL. With --from and --proposal, create a session for a proposal of another session, linked to it.",
    usage:
      "pair start (--title TEXT | --session-dir DIR | --from DIR --proposal ID)",
    flags: {
      title: {
        value: "TEXT",
        text: "The new session's title, which the reviewer sees until the first Agreed replaces it. Required when pair start creates a session without --from.",
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
        text: "The proposal the new session runs, which the reviewer started in a sub-session or with a new agent. Given with --from.",
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
      "Print where the session stands. Any agent may run it, and only the holder's output starts with the next step.",
    flags: { "session-dir": sessionDir, json },
    run: status,
  },
  propose: {
    group: "session",
    purpose: "Record a proposal, or revise, start, finish or reopen one",
    about:
      "Record a proposal of work as a card, which the reviewer starts, declines or comments on. With one of --revise, --start, --done and --reopen, change the card that has --id. Any agent may run it, and only the holder's output starts with the next step.",
    usage:
      "pair propose --session-dir DIR --id ID [--revise | --start WHERE | --done | --reopen] [FIELDS]",
    flags: {
      "session-dir": sessionDir,
      id: {
        value: "ID",
        required: true,
        text: "The card's ID, a slug of lowercase letters, digits and hyphens, such as phone-sidebar. A new card takes an ID the session does not have.",
      },
      title: { value: "TEXT", text: "The work, in at most 80 characters." },
      delivers: {
        value: "TEXT",
        text: "What the work delivers, in at most 400 characters.",
      },
      changes: {
        value: "TEXT",
        text: "What the work may change, in at most 400 characters. Starting the card approves only these changes.",
      },
      recommend: {
        value: "WHERE",
        text: "Where you recommend the work runs: here, sub-session or new-agent.",
      },
      reason: {
        value: "TEXT",
        text: "Why you recommend that, in at most 400 characters.",
      },
      source: {
        value: "TEXT",
        text: 'Where the work came from, such as "From the churn chart page", or with --start the reviewer\'s words.',
      },
      thread: {
        value: "ID",
        text: "The thread the work or the reviewer's words came from.",
      },
      page: {
        value: "ROUND/PAGE",
        text: "The page the work or the reviewer's words came from, such as 14/commenting.",
      },
      revise: {
        text: "Replace the fields given and keep the rest. Refused once the card is started.",
      },
      start: {
        value: "WHERE",
        text: "Start the card on the reviewer's words, quoted with --source, with --thread or --page for where they wrote them. WHERE is here, sub-session or new-agent.",
      },
      done: {
        text: "Mark work started here done, after you publish its last page.",
      },
      reopen: {
        text: "Put work started here back to running, when feedback asks for changes to it.",
      },
      json,
    },
    footer:
      "A new card takes --title, --delivers, --changes, --recommend, --reason and --source.",
    run: propose,
  },
  plan: {
    group: "session",
    purpose: "Attach a plan to a proposal, or replace the plan it has",
    about:
      "Attach the plan's pages to the proposal --proposal names, or replace the plan it has, with the rounds the plan came from. Any agent may run it, and only the holder's output starts with the next step.",
    usage:
      "pair plan --session-dir DIR --proposal ID --rounds ROUNDS --pages JSON --file HTML... --source DIR",
    flags: {
      "session-dir": sessionDir,
      proposal: {
        value: "ID",
        required: true,
        text: "The proposal the plan is for. The hub refuses a declined or done proposal.",
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
        removed:
          "pair check --codex-rules is replaced by pair setup-codex. It works in this release only.",
      },
      json,
    },
    run: (options) =>
      options["codex-rules"] ? setupCodex(options) : check(options),
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
