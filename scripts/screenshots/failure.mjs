// npm run screenshots saves a screenshot and the console log of each
// browser window when it fails, so a failure on a CI runner, where nobody
// watches Chrome, can be diagnosed from the files.
import fs from "node:fs/promises";
import path from "node:path";

const windows = [];

// Records the page's console messages, page errors and failed requests from
// now on. saveFailure() writes them and a screenshot under the name given.
export function watch(page, name) {
  const lines = [];
  const started = Date.now();
  const log = (line) =>
    lines.push(`${((Date.now() - started) / 1000).toFixed(3)}s ${line}`);
  page.on("console", (message) => {
    const { url, lineNumber } = message.location();
    const at = url ? ` (${url}:${lineNumber + 1})` : "";
    log(`console.${message.type()}: ${message.text()}${at}`);
  });
  page.on("pageerror", (error) =>
    log(`page error: ${error.stack || error.message}`),
  );
  page.on("requestfailed", (request) =>
    log(`request failed: ${request.url()} (${request.failure()?.errorText})`),
  );
  windows.push({ page, name, lines });
  return page;
}

// Writes NAME.png and NAME-console.txt in the directory for each watched
// page that is still open, and returns how many pages it saved.
export async function saveFailure(directory) {
  let saved = 0;
  for (const { page, name, lines } of windows) {
    if (page.isClosed()) continue;
    await fs.mkdir(directory, { recursive: true });
    const head = [`URL: ${page.url()}`];
    try {
      const png = await page.screenshot({ timeout: 10_000 });
      await fs.writeFile(path.join(directory, `${name}.png`), png);
    } catch (error) {
      head.push(`The screenshot failed: ${error.message}`);
    }
    await fs.writeFile(
      path.join(directory, `${name}-console.txt`),
      [...head, ...lines, ""].join("\n"),
    );
    saved++;
  }
  return saved;
}
