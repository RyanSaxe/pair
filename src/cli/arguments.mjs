// A refusal of the arguments, which names what is wrong and where the
// command's help is.
export const usageError = (name, text) =>
  new Error(`${text} Run pair ${name} --help.`);

// "a", "a and b", "a, b and c".
export const listing = (items) =>
  items.length < 2
    ? items.join("")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const shown = (entry) =>
  Object.entries(entry.flags || {}).filter(([, flag]) => !flag.removed);
const flagName = ([key, flag]) =>
  flag.value ? `--${key} ${flag.value}` : `--${key}`;

// The command the arguments name in the table, with the arguments after its
// name.
export function findCommand(commands, argv) {
  const [name] = argv;
  return Object.hasOwn(commands, name)
    ? { name, entry: commands[name], rest: argv.slice(1) }
    : null;
}

// Reads a command's arguments: a flag is --name VALUE, or --name alone for a
// flag without a value. An unknown flag, an extra argument and a flag given
// twice are refused, except a flag that repeats. Returns the options, with
// the arguments in args, and the line of each removed form the arguments
// use.
export function parse({ name, entry, rest }) {
  const refuse = (text) => {
    throw usageError(name, text);
  };
  const flags = entry.flags || {};
  const options = { args: [] };
  const removed = entry.removed ? [entry.removed] : [];
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (!word.startsWith("--")) {
      options.args.push(word);
      continue;
    }
    const key = word.slice(2);
    const flag = Object.hasOwn(flags, key) ? flags[key] : null;
    if (!flag) {
      const takes = shown(entry).map(([known]) => `--${known}`);
      refuse(
        `${word} is not a flag of pair ${name}, which takes ${takes.length ? listing(takes) : "only --help"}.`,
      );
    }
    let value = true;
    if (flag.value) {
      value = rest[++i];
      if (value === undefined || value.startsWith("--"))
        refuse(`${word} takes a value, as ${word} ${flag.value}.`);
    }
    if (flag.repeats) (options[key] ||= []).push(value);
    else if (Object.hasOwn(options, key))
      refuse(`${word} is given twice, and pair ${name} takes it once.`);
    else options[key] = value;
    if (flag.removed) removed.push(flag.removed);
  }
  const slots = entry.args || [];
  if (options.args.length > slots.length)
    refuse(
      slots.length
        ? `${options.args[slots.length]} is an extra argument, and pair ${name} takes ${listing(slots.map((slot) => slot.name))}.`
        : `pair ${name} takes no argument ${options.args[0]}.`,
    );
  const missing = slots.slice(options.args.length).filter((s) => !s.optional);
  if (missing.length)
    refuse(
      `pair ${name} requires ${listing(slots.filter((s) => !s.optional).map((s) => s.name))}.`,
    );
  for (const [index, slot] of slots.entries())
    if (slot.removed && index < options.args.length) removed.push(slot.removed);
  for (const [key, flag] of Object.entries(flags)) {
    const given = (wanted) => options[wanted] !== undefined;
    const standIn = Object.entries(flags).some(
      ([other, item]) => item.replaces === key && given(other),
    );
    if (flag.required && !given(key) && !standIn)
      refuse(`pair ${name} requires ${flagName([key, flag])}.`);
  }
  return { options, removed };
}

// Wraps text to width columns, with indent before every line but the first.
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
  const args = (entry.args || [])
    .filter((slot) => !slot.removed)
    .map((slot) => (slot.optional ? `[${slot.name}]` : slot.name));
  const flags = shown(entry)
    .filter(([key]) => key !== "json")
    .map((item) =>
      item[1].required
        ? flagName(item)
        : `[${flagName(item)}]${item[1].repeats ? "..." : ""}`,
    );
  return ["pair", name, ...args, ...flags].join(" ");
}

// What pair COMMAND --help prints: the command's purpose, its usage, and
// each flag with the required ones marked.
export function helpText({ name, entry }) {
  if (entry.help || entry.removed) return `${entry.help || entry.removed}\n`;
  const rows = [
    ...shown(entry).map((item) => [
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
    ...(entry.footer ? ["", entry.footer] : []),
    "",
  ].join("\n");
}

const groups = {
  session: "Session commands, each taking --session-dir DIR:",
  pages: "Pages:",
  setup: "Setup:",
};
// What pair --help prints: every command in the table with its purpose, by
// group.
export function overview(commands) {
  const listed = Object.entries(commands).filter(([, entry]) => !entry.hidden);
  const width = Math.max(...listed.map(([name]) => name.length)) + 2;
  return [
    "Work with an agent in the browser: plan a change, build it, and explain it.",
    "An agent starts with pair guide and follows what it prints.",
    "",
    "Usage: pair COMMAND [ARGUMENTS] [FLAGS]",
    ...Object.entries(groups).flatMap(([group, title]) => [
      "",
      title,
      ...listed
        .filter(([, entry]) => entry.group === group)
        .map(([name, entry]) => `  ${name.padEnd(width)}${entry.purpose}`),
    ]),
    "",
    "Every command takes --help. Every command that prints a result takes --json.",
    "pair --version prints the version.",
    "",
  ].join("\n");
}
