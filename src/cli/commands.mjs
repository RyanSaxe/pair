import { agents, register } from "./agents.mjs";
import { main as build } from "./build.mjs";
import { check, setupCodex } from "./check.mjs";
import { components } from "./components.mjs";
import { main as diff } from "./diff.mjs";
import { guide } from "./guide.mjs";
import { message } from "./message.mjs";
import { search } from "./search.mjs";
import { publish, runHub, start } from "./session.mjs";
import { spawn } from "./spawn.mjs";
import { pause, progress, propose, read, reply, status } from "./actions.mjs";

const sessionDir = {
  value: "DIR",
  required: true,
  text: "The session's directory.",
};
const json = { text: "Print the result as one JSON object." };

// pair --help lists the commands in this order. purpose is the line that pair
// --help prints for a command, and about is the paragraph that the command's
// own --help starts with.
export const commands = {
  start: {
    group: "session",
    purpose: "Start a session, or resume or take over one with --session-dir",
    about:
      "Create a session, or take over the one --session-dir names, so the hub wakes this agent when the reviewer sends feedback, and print the session's directory and URL. With --from and --proposal, create a session that builds one proposal of another session, linked to that session.",
    usage:
      "pair start (--title TEXT | --session-dir DIR [--reopen] | --from DIR --proposal ID)",
    flags: {
      title: {
        value: "TEXT",
        text: "The new session's title, until the title of the first Agreed you publish replaces it. pair start needs it to create a session without --from.",
      },
      "session-dir": {
        value: "DIR",
        text: "Resume that session, or take it over from another agent. It takes no --title.",
      },
      reopen: {
        text: "With --session-dir, make a session the reviewer closed live again. Use it only when the reviewer gives you this command. On a session that is not closed, pair start runs as it does without this flag.",
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
  search: {
    group: "session",
    purpose: "Search what live sessions said, for what an earlier one settled",
    about:
      "Print the results that best match QUERY across live sessions, or closed ones too with --closed, with the session, round and page of each. A result is a record of what was said at the time, so check it against the code before you rely on it. QUERY works best as the two or three most distinctive words.",
    usage:
      "pair search --session-dir DIR QUERY [--kind KINDS] [--this-session] [--closed] [--limit N]",
    args: [{ name: "QUERY" }],
    flags: {
      "session-dir": sessionDir,
      kind: {
        value: "KINDS",
        text: "Limit results to these kinds, separated by commas: pages, threads, notes, answers, proposals and agreed.",
      },
      "this-session": { text: "Limit results to this session." },
      closed: { text: "Include closed sessions." },
      limit: {
        value: "N",
        text: "Change how many results print. The default is 10.",
      },
      json,
    },
    run: search,
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
      start: {
        value: "ID",
        repeats: true,
        text: "A page of the round that you work on next, which pair publish marks as started. While pages are left and none has started, pair publish needs it.",
      },
      note: {
        value: "TEXT",
        text: "What you are doing on the pages you name with --start, in at most 80 characters.",
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
    purpose: "Post your reply in a thread, or acknowledge it",
    about:
      "Post your reply in a thread, or acknowledge the reviewer's messages without a reply. pair read --thread ID prints the thread.",
    usage:
      "pair reply --session-dir DIR --thread ID (--text TEXT | --file HTML | --ack)",
    flags: {
      "session-dir": sessionDir,
      thread: {
        value: "ID",
        required: true,
        text: "The thread, from the wake message or pair read.",
      },
      text: {
        value: "TEXT",
        text: "Your reply as plain text. It refuses Markdown, which the reviewer would see as typed.",
      },
      file: {
        value: "HTML",
        text: "Your reply as an HTML fragment that passes pair build's page checks. Use it for links, bold, code and lists.",
      },
      ack: {
        text: "Acknowledge the reviewer's messages that wait for an answer, in place of a reply, when they ask for nothing and you have nothing to add.",
      },
      json,
    },
    footer: "Give one of --text, --file and --ack.",
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
      "pair propose --session-dir DIR --id ID [--revise | --start WHERE | --withdraw | --done | --join OTHER | --reopen] [FIELDS]",
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
        value: "OTHER",
        text: "Merge this proposal into proposal OTHER when OTHER's work covers it. Only join a proposal the reviewer has not approved, and only into a proposal that is not marked done and is not running in another session. The hub then marks this proposal done as joined into OTHER.",
      },
      reopen: {
        text: "Undo your --done when the reviewer asks for changes to the work or it is not finished, or undo your --join when OTHER's work does not cover this proposal.",
      },
      "status-done": {
        value: "TEXT",
        repeats: true,
        text: "A part of the approved work that you have finished, in at most 80 characters. The hub marks the part with that text done, and refuses text that matches none of the proposal's parts. Give one flag for each part. Each flag changes only the part it names.",
      },
      "status-left": {
        value: "TEXT",
        repeats: true,
        text: "A part of the approved work that is left, in at most 80 characters. The hub adds it after the proposal's parts, and when the proposal already lists a part with that text, the hub sets that part back to left. Give one flag for each part, the next one first. A proposal has at most 20 parts.",
      },
      "status-drop": {
        value: "TEXT",
        repeats: true,
        text: "A part the proposal lists that the work no longer needs. The hub marks it dropped, and no flag removes a part from the proposal. Give one flag for each part.",
      },
      json,
    },
    footer: "A new proposal needs --title, --delivers and --recommend.",
    run: propose,
  },
  register: {
    group: "messaging",
    purpose: "Add this agent session to the list that pair agents prints",
    about:
      "Add this agent session to pair's list of running agent sessions, or update its entry, and print its name and ID. The name is the folder's name, a hyphen and two hex characters from a hash of the session's ID, unless --name sets another, and the session keeps it each time it registers again.",
    flags: {
      name: {
        value: "NAME",
        text: "Name the session NAME, in up to 64 letters, digits and hyphens. pair register refuses a name that another running session has.",
      },
      hook: {
        text: "Run as an agent CLI's start hook: read the session ID from the hook's JSON on stdin when the environment has none, and exit 0 even when pair register fails.",
      },
      json,
    },
    run: register,
  },
  agents: {
    group: "messaging",
    purpose: "List the registered agent sessions that are running",
    about:
      "List each registered agent session whose CLI is still running, with its name, CLI, folder, branch and ID, the most recently registered first. pair agents deletes the entry of every session whose CLI has exited.",
    flags: { json },
    run: agents,
  },
  message: {
    group: "messaging",
    purpose: "Send a message to a running agent session",
    about:
      "Send a message to the running agent session that --to names, through its agent CLI, and print when the session's agent reads it. Run inside an agent CLI, pair message registers this session first, and the message names this session in its first line and ends with the commands that answer and acknowledge it. Outside any agent CLI, the first line says the message is from your user.",
    usage:
      "pair message --to NAME|ID|NAME/SUBAGENT (--text TEXT | --file PATH | --ack) [--from LABEL]",
    flags: {
      to: {
        value: "NAME",
        required: true,
        text: "The session's name or ID, or a start of its ID, as pair agents prints them. NAME/SUBAGENT sends the message to that subagent of the session.",
      },
      text: { value: "TEXT", text: "The message." },
      file: { value: "PATH", text: "A file whose text is the message." },
      ack: {
        text: "Acknowledge the session's message instead of answering it, when you have nothing to say. pair message sends one line, which asks the session's agent not to answer.",
      },
      from: {
        value: "LABEL",
        text: "Name the sender LABEL, such as a script. The message then has no command to answer it, also inside an agent CLI.",
      },
    },
    footer: "Give one of --text, --file and --ack.",
    run: message,
  },
  spawn: {
    group: "messaging",
    purpose: "Start an agent session in a new terminal, and print its name",
    about:
      'Start a session of CLI, which is claude, codex, copilot, pi or opencode, through your launch script, ~/.config/pair/spawn, or spawn.ps1 on Windows, which opens the CLI in a new terminal. The session\'s first prompt is "In your own shell, run pair register first." followed by --prompt or --file. Run inside an agent CLI, pair spawn registers this session first, so the new session can message it. pair spawn waits up to 30 seconds for the new session to register, then prints the name that pair message --to takes.',
    usage:
      "pair spawn CLI [--dir DIR] [--name NAME] [--prompt TEXT | --file PATH] [-- ARG...]",
    args: [{ name: "CLI" }],
    forwards: "the CLI",
    flags: {
      dir: {
        value: "DIR",
        text: "Start the session in DIR. The default is the current folder.",
      },
      name: {
        value: "NAME",
        text: "Have the session register as NAME, in up to 64 letters, digits and hyphens. The default is the name pair register gives. pair spawn refuses a name that a running session has.",
      },
      prompt: {
        value: "TEXT",
        text: "The rest of the first prompt. Without --prompt or --file, the session only registers.",
      },
      file: {
        value: "PATH",
        text: "A file whose text is the rest of the first prompt, in place of --prompt.",
      },
    },
    footer: [
      "pair spawn passes every ARG after -- to CLI, before the first prompt:",
      "",
      "  pair spawn claude --prompt TEXT -- --model sonnet",
      "",
      "Give the prompt with --prompt or --file, not after --. Without --name, pair spawn finds the new session by its folder, so give --name when an ARG makes CLI run in another folder, as Codex's -C and --worktree do.",
      "",
      "A codex session reads a message in the middle of a turn only on Codex's app-server daemon, and pair spawn warns by Codex 0.169's rules for it. With -m, -s, -a, -C, -i, --add-dir, --worktree or --no-alt-screen, Codex starts the session on the daemon. With a -c that sets anything but a feature, tui.fullscreen_transcript or suppress_unstable_features_warning, or with -p, --profile, --search, --oss, --approve-for-me, --strict-config, --dangerously-bypass-hook-trust or --no-daemon, Codex starts the session without the daemon, so the session reads a message that arrives during a turn only when the turn ends. When the daemon has another setting for a feature that --enable, --disable or -c features.NAME=true or false sets, Codex stops in the new terminal until someone chooses whether to restart the daemon, which can interrupt other Codex sessions, or to start the session without it. pair spawn prints a warning for each of the last two cases.",
    ].join("\n"),
    run: spawn,
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
