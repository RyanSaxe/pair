// npm run screenshots: stages a demo session on a hub of its own and writes
// the README's and the docs' PNGs from Google Chrome. Then it stages a
// second session with the pair command, as an agent runs it, and writes the
// illustration of a session and the picture of starting work on a phone.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stage } from "./screenshots/capture.mjs";
import { saveFailure } from "./screenshots/failure.mjs";
import { illustrate } from "./screenshots/illustration.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
// A failed run saves each browser window here, under the root, and the
// screenshots workflow uploads the directory.
const failures = "screenshots-failure";

async function main() {
  // The frame draws text in the system font, and only macOS has San
  // Francisco, so a run elsewhere changes the text in every PNG.
  if (process.platform !== "darwin") {
    console.error(
      "npm run screenshots runs on macOS, because the frame's font is the system font.",
    );
    process.exitCode = 1;
    return;
  }
  // The directory shows only the last run's failure.
  await fs.rm(path.join(root, failures), { recursive: true, force: true });
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "pair-screenshots-"));
  // hub() and open() from tests/support take a node:test context. They stop
  // the hub and Chrome with its after(), and open() reports a missing Chrome
  // with its skip().
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
    // The cleanups below close Chrome, so the windows are saved first.
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
