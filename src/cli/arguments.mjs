export const usageError = (name, text) =>
  new Error(`${text} Run pair ${name} --help.`);

export const listing = (items) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const flagsOf = (entry) => Object.entries(entry.flags || {});
const flagName = ([key, flag]) =>
  flag.value ? `--${key} ${flag.value}` : `--${key}`;

export function findCommand(commands, argv) {
  const [name] = argv;
  return Object.hasOwn(commands, name)
    ? { name, entry: commands[name], rest: argv.slice(1) }
    : null;
}

// A command whose entry sets forwards, to the name of the program it starts,
// reads its own arguments and flags only before the first --, and passes
// every word after it, unread, to that program.
export function ownWords({ entry, rest }) {
  const end = entry.forwards ? rest.indexOf("--") : -1;
  return end === -1 ? rest : rest.slice(0, end);
}

function unknownFlagMessage({ name, entry, word, key, forwardHint }) {
  const flags = entry.flags || {};
  const takes = flagsOf(entry).map(([known]) => `--${known}`);
  // pair takes a flag's value only as the next word, so --prompt=TEXT
  // is pair's --prompt misspelled, not a flag for the program.
  const pairFlag = Object.hasOwn(flags, key.split("=")[0]);
  return `${word} is not a flag of pair ${name}, which takes ${takes.length ? listing(takes) : "only --help"}.${pairFlag ? "" : forwardHint}`;
}

function recordFlagValue({ name, word, key, flag, value, options }) {
  if (flag.repeats) {
    (options[key] ||= []).push(value);
    return;
  }
  if (Object.hasOwn(options, key)) {
    throw usageError(
      name,
      `${word} is given twice, and pair ${name} takes it once.`,
    );
  }
  options[key] = value;
}

function readFlag({ name, entry, own, index, options, forwardHint }) {
  const flags = entry.flags || {};
  const word = own[index];
  const key = word.slice(2);
  const flag = Object.hasOwn(flags, key) ? flags[key] : null;
  if (!flag) {
    throw usageError(
      name,
      unknownFlagMessage({ name, entry, word, key, forwardHint }),
    );
  }
  let next = index;
  let value = true;
  if (flag.value) {
    value = own[++next];
    if (value === undefined || value.startsWith("--")) {
      throw usageError(
        name,
        `${word} takes a value, as ${word} ${flag.value}.`,
      );
    }
  }
  recordFlagValue({ name, word, key, flag, value, options });
  return next;
}

function validateRequiredFlags(name, flags, options) {
  for (const [key, flag] of Object.entries(flags)) {
    if (flag.required && options[key] === undefined) {
      throw usageError(name, `pair ${name} requires ${flagName([key, flag])}.`);
    }
  }
}

function validateParsed({ name, entry, options, forwardHint }) {
  const slots = entry.args || [];
  const extra = options.args[slots.length];
  if (extra !== undefined) {
    const refusal = slots.length
      ? `${extra} is an extra argument, and pair ${name} takes ${listing(slots.map((slot) => slot.name))}.`
      : `pair ${name} takes no argument ${extra}.`;
    throw usageError(
      name,
      `${refusal}${extra.startsWith("-") ? forwardHint : ""}`,
    );
  }
  const missing = slots.slice(options.args.length).filter((s) => !s.optional);
  if (missing.length) {
    throw usageError(
      name,
      `pair ${name} requires ${listing(slots.filter((s) => !s.optional).map((s) => s.name))}.`,
    );
  }
  validateRequiredFlags(name, entry.flags || {}, options);
}

export function parse({ name, entry, rest }) {
  const own = ownWords({ entry, rest });
  const options = { args: [] };
  const forwardHint = entry.forwards
    ? ` Give it after -- to pass it to ${entry.forwards}.`
    : "";
  if (entry.forwards) options.forwarded = rest.slice(own.length + 1);
  for (let i = 0; i < own.length; i++) {
    if (own[i].startsWith("--")) {
      i = readFlag({ name, entry, own, index: i, options, forwardHint });
    } else {
      options.args.push(own[i]);
    }
  }
  validateParsed({ name, entry, options, forwardHint });
  return options;
}

function wrap(text, width, indent = "") {
  const lines = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].join(`\n${indent}`);
}

function usage(name, entry) {
  if (entry.usage) return entry.usage;
  const args = (entry.args || []).map((slot) =>
    slot.optional ? `[${slot.name}]` : slot.name,
  );
  const flags = flagsOf(entry)
    .filter(([key]) => key !== "json")
    .map((item) =>
      item[1].required
        ? flagName(item)
        : `[${flagName(item)}]${item[1].repeats ? "..." : ""}`,
    );
  return ["pair", name, ...args, ...flags].join(" ");
}

export function helpText({ name, entry }) {
  if (entry.help) return `${entry.help}\n`;
  const rows = [
    ...flagsOf(entry).map((item) => [
      flagName(item),
      `${item[1].text}${item[1].required ? " Required." : ""}`,
    ]),
    ["--help", "Print this help and run nothing."],
  ];
  const width = Math.max(...rows.map(([label]) => label.length)) + 2;
  return [
    wrap(entry.about, 80),
    "",
    `Usage: ${usage(name, entry)}`,
    "",
    "Flags:",
    ...rows.map(
      ([label, text]) =>
        `  ${label.padEnd(width)}${wrap(text, 78 - width, " ".repeat(width + 2))}`,
    ),
    // A footer line that starts with a space is an example, which the help
    // prints whole.
    ...(entry.footer
      ? [
          "",
          ...entry.footer
            .split("\n")
            .map((line) => (line.startsWith(" ") ? line : wrap(line, 80))),
        ]
      : []),
    "",
  ].join("\n");
}

const groups = {
  session: "Session commands, each taking --session-dir DIR:",
  messaging: "Messaging:",
  pages: "Pages:",
  setup: "Setup:",
};
export function overview(commands) {
  const listed = Object.entries(commands).filter(([, entry]) => !entry.hidden);
  const width = Math.max(...listed.map(([name]) => name.length)) + 2;
  return [
    "Work with an agent in the browser: plan a change, build it, and explain it.",
    "An agent starts with pair guide and follows what it prints.",
    "",
    "Usage: pair COMMAND [ARGUMENTS] [FLAGS]",
    ...Object.entries(groups).flatMap(([group, title]) =>
      ["", title].concat(
        listed
          .filter(([, entry]) => entry.group === group)
          .map(([name, entry]) => `  ${name.padEnd(width)}${entry.purpose}`),
      ),
    ),
    "",
    "Every command takes --help. Every command that prints a result takes --json.",
    "pair --version prints the version.",
    "",
  ].join("\n");
}
