// npm run screenshots runs this script. It stages a demo session on a hub of
// its own and writes the PNGs for the README and the docs from Google Chrome.
// It then stages a second session by running the pair command as an agent does,
// and writes the illustration of a session and the picture of starting work on
// a phone.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stage } from "./screenshots/capture.mjs";
import { saveFailure } from "./screenshots/failure.mjs";
import { illustrate } from "./screenshots/illustration.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// The screenshots workflow, .github/workflows/screenshots.yml, uploads this
// directory.
const failures = "screenshots-failure";

async function main() {
  if (process.platform !== "darwin") {
    console.error(
      "npm run screenshots runs on macOS, because the frame's font is the system font.",
    );
    process.exitCode = 1;
    return;
  }
  await fs.rm(path.join(root, failures), { recursive: true, force: true });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-screenshots-"));
  // hub() and open() from tests/support take a node:test context, so t stands
  // in for one. They register their cleanups with t.after(), and open() reports
  // a missing Chrome with t.skip().
  const cleanups = [];
  const t = {
    after: (cleanup) => cleanups.push(cleanup),
    skip: (reason) => {
      throw new Error(reason);
    },
  };
  let images, failure;
  try {
    images = await stage(t, scratch);
    const pictures = await illustrate(t, path.join(scratch, "illustration"));
    for (const [file, png] of pictures) images.set(file, png);
  } catch (error) {
    failure = error;
    // The cleanups close Chrome, so saveFailure() runs before them.
    try {
      if (await saveFailure(path.join(root, failures)))
        failure = new Error(
          `${error.message}\nSaved a screenshot and the console log of each browser window in ${failures}/.`,
          { cause: error },
        );
    } catch (saving) {
      failure = new Error(
        `${error.message}\nSaving the browser windows failed: ${saving.message}`,
        { cause: error },
      );
    }
  }
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup();
    } catch (error) {
      failure ??= error;
    }
  }
  await fs.rm(scratch, { recursive: true, force: true });
  if (failure) throw failure;
  for (const [file, png] of images)
    await fs.writeFile(path.join(root, file), png);
  console.log(`Wrote ${images.size} screenshots.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
