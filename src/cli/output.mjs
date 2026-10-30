import fs from "node:fs/promises";
import path from "node:path";
import { guideText } from "../shared/guide.mjs";
import { agentRequestBytes } from "../shared/settings.mjs";

// print() writes a session command's text over this many bytes to a file,
// because an agent CLI cuts a command's output past a limit.
const longOutput = 10_000;
// print() repeats the next step at the end when the parts after it take more
// lines than this.
const longParts = 20;

// The hub has already acted on the command when momentText() runs, so a missing
// moment file only adds a line on stderr.
async function momentText(name) {
  try {
    return (await guideText(`moments/${name}.md`)).trim();
  } catch {
    console.error(`pair: guide/moments/${name}.md is missing.`);
    return "";
  }
}

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

// pair build and pair diff write OUTPUT with the wx flag, so the write fails
// with EEXIST when the file exists.
export const refuseOverwrite = (output) => (error) => {
  if (error.code !== "EEXIST") throw error;
  throw new Error(
    `${output} already exists, and pair never overwrites a file. Write to a new path, or delete that file first.`,
  );
};

const megabytes = (bytes) => `${Number((bytes / 1_000_000).toFixed(1))} MB`;
// pair build and pair publish each measure the request that pair publish sends.
// pair build writes a page's content into the built file twice, and base64 makes
// an image a third larger, so images can take 3/8 of the limit, less the size of
// the frame. A third of the limit stays under that.
export function tooBigToPublish(subject, request) {
  const bytes = Buffer.byteLength(JSON.stringify(request));
  return bytes <= agentRequestBytes
    ? []
    : [
        `${subject} is too big to publish. The publish would send the hub ${megabytes(bytes)}, and the hub accepts at most ${megabytes(agentRequestBytes)}. pair build writes a page's content into the built file twice, so the images embedded in one page can total about ${megabytes(agentRequestBytes / 3)}. Crop or resize the images, or save them as JPEG or WebP. Then build the page again and publish the new file.`,
      ];
}

export function rows(pairs) {
  const shown = pairs.filter(([, value]) => value !== undefined && value);
  const width = Math.max(...shown.map(([label]) => label.length)) + 2;
  return shown.map(([label, value]) => label.padEnd(width) + value).join("\n");
}
