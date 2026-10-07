import { release } from "node:os";
import { chromium, webkit } from "playwright-core";
import "./env.mjs";

// launch() throws one of these when the browser is not installed. open()
// skips the test with it, and fails the test when CI is set, so CI cannot
// pass by skipping.
const missing = {
  chrome: "Google Chrome is not installed",
  webkit: "Playwright's WebKit is not installed",
};

// engine is "chrome", the installed Google Chrome, or "webkit", the WebKit
// that Playwright installs. args are switches for Chrome.
export async function launch({ args, engine = "chrome" } = {}) {
  try {
    return engine === "webkit"
      ? await webkit.launch()
      : await chromium.launch({ channel: "chrome", args });
  } catch (error) {
    const message = error.message || String(error);
    if (
      /Chromium distribution ['"]chrome['"] is not found|Chrome (?:is )?not found|Executable doesn't exist/i.test(
        message,
      )
    )
      throw Error(missing[engine], { cause: error });
    throw error;
  }
}

// On macOS 14 and earlier, Playwright installs an older WebKit build, in
// which playwright-core 1.63 never finishes opening a page: the build
// refuses the PushAPIEnabled setting. open() skips the WebKit tests there,
// and CI runs them on Linux.
const oldMac =
  process.platform === "darwin" && Number(release().split(".")[0]) < 24;
const tooOld = "Playwright's WebKit does not run on macOS 14 or earlier";

// Opens url in a new page of the browser that engine names, and closes the
// browser when the test ends. With html, the page is served at
// http://pair.localhost/, and args are switches for Chrome.
export async function open(
  t,
  url,
  { html, args, engine = "chrome", ...pageOptions } = {},
) {
  if (engine === "webkit" && oldMac && !process.env.CI) {
    t.skip(tooOld);
    return null;
  }
  let browser;
  try {
    browser = await launch({ args, engine });
  } catch (error) {
    if (process.env.CI || error.message !== missing[engine]) throw error;
    t.skip(missing[engine]);
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

// Stands in for Mermaid from jsDelivr, so a test runs offline. Like
// Mermaid, render() draws a full-size element to measure the diagram, in
// the container it is given or else at the end of the body, and removes it
// when the render ends.
const mermaid = `export default {
  initialize() {},
  registerLayoutLoaders() {},
  async render(id, source, container = document.body) {
    const drawing = document.createElement("div");
    drawing.id = "d" + id;
    drawing.style.height = "3000px";
    container.append(drawing);
    await new Promise((resolve) => setTimeout(resolve, 300));
    drawing.remove();
    return { svg: '<svg viewBox="0 0 120 40"></svg>' };
  },
};`;

export const stubMermaid = (page) =>
  page.route(/mermaid\.esm\.min\.mjs$|mermaid-layout-elk/, (route) =>
    route.fulfill({ body: mermaid, contentType: "text/javascript" }),
  );
