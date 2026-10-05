import fs from "node:fs/promises";
import path from "node:path";
import { guideText } from "../shared/guide.mjs";

// A session command's text over this many bytes goes to a file, because an
// agent CLI cuts a command's output past a limit.
const longOutput = 10_000;
// The next step repeats at the end when the parts between it take more
// lines than this.
const longParts = 20;

// The text of the moment a command names, from guide/moments/NAME.md and the
// user's file of the same name. The hub has already acted on the command, so
// a missing file only adds a line on stderr.
async function momentText(name) {
  try {
    return (await guideText(`moments/${name}.md`)).trim();
  } catch {
    console.error(`pair: guide/moments/${name}.md is missing.`);
    return "";
  }
}

// Writes a session command's output in one shape: the next step, the text
// of each moment it names, then the data, each after a blank line, and the
// next step again when the output is long. With --json it writes output.json instead.
// A session command's output names its session directory, where data too
// long to print goes, in a file whose path prints in its place.
export async function print(output, { json, command }) {
  if (json) return console.log(JSON.stringify(output.json, null, 2));
  const next = output.next && `Next: ${output.next}`;
  const moments = [output.moment].flat().filter(Boolean);
  const moment = (await Promise.all(moments.map(momentText)))
    .filter(Boolean)
    .join("\n\n");
  let data = output.data || "";
  const whole = [next, moment, data].filter(Boolean).join("\n\n");
  const between = [moment, data].filter(Boolean).join("\n\n");
  let repeat = between.split("\n").length > longParts;
  if (output.sessionDir && Buffer.byteLength(whole) > longOutput) {
    const folder = path.join(output.sessionDir, "output");
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, `${command}-${Date.now()}.txt`);
    await fs.writeFile(file, `${data}\n`, { mode: 0o600 });
    const size = Math.round(Buffer.byteLength(data) / 1000);
    data = [
      `The ${output.subject || "output"} is ${size} KB of text, more than pair prints, so pair wrote it to`,
      file,
      "Read all of that file before you act on it.",
    ].join("\n");
    repeat = true;
  }
  const parts = [next, moment, data, repeat && next].filter(Boolean);
  if (parts.length) console.log(parts.join("\n\n"));
}

// pair build and pair diff write OUTPUT with the wx flag, so the write
// fails when the file exists, and the agent reads why.
export const refuseOverwrite = (output) => (error) => {
  if (error.code !== "EEXIST") throw error;
  throw new Error(
    `${output} already exists, and pair never overwrites a file. Write to a new path, or delete that file first.`,
  );
};

// Lines of a label and a value, with the values in one column.
export function rows(pairs) {
  const shown = pairs.filter(([, value]) => value !== undefined && value);
  const width = Math.max(...shown.map(([label]) => label.length)) + 2;
  return shown.map(([label, value]) => label.padEnd(width) + value).join("\n");
}
