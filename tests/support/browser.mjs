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
