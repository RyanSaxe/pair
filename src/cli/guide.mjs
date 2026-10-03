import { guideText } from "../shared/guide.mjs";

// pair guide prints a guide file as it is, so the skill's one instruction
// prints guide/pair.md and the next lines name the other files the same way.
export async function guide(options) {
  process.stdout.write(await guideText(options.args[0]));
}
