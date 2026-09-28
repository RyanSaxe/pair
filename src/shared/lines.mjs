/** The lines a code block's data-lines names: lines and ranges separated by
    commas, such as "7", "3-4" or "3-4, 9", counted from the block's first
    line. Returns [from, to] pairs, or null when any part is not a line
    number from 1 or a range whose end is not before its start. `pair build`
    refuses a value that returns null, and the frame lights no line for it. */
export function lineRanges(value) {
  const ranges = [];
  for (const part of value.split(",")) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2] ?? match[1]);
    if (from < 1 || to < from) return null;
    ranges.push([from, to]);
  }
  return ranges;
}
