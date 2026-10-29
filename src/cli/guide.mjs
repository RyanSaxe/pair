import { guideText } from "../shared/guide.mjs";

export async function guide(options) {
  process.stdout.write(await guideText(options.args[0]));
}
