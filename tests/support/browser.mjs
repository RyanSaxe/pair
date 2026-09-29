import { chromium } from "playwright-core";
import "./env.mjs";

// launch() throws this when Google Chrome is not installed. open() skips the
// test with it, and fails the test when CI is set, so CI cannot pass by
// skipping.
const missing = "Google Chrome is not installed";

export async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (error) {
    const message = error.message || String(error);
    if (
      /Chromium distribution ['"]chrome['"] is not found|Chrome (?:is )?not found/i.test(
        message,
      )
    )
      throw Error(missing, { cause: error });
    throw error;
  }
}

// Opens url in a new page of the installed Chrome, and closes Chrome when
// the test ends. With html, the page is served at http://pair.localhost/.
export async function open(t, url, { html, ...pageOptions } = {}) {
  let browser;
  try {
    browser = await launch();
  } catch (error) {
    if (process.env.CI || error.message !== missing) throw error;
    t.skip(missing);
    return null;
  }
  t.after(() => browser.close());
  const page = await browser.newPage(pageOptions);
  if (html !== undefined)
    await page.route("http://pair.localhost/", (route) =>
      route.fulfill({ body: html, contentType: "text/html" }),
    );
  await page.goto(url);
  return page;
}
