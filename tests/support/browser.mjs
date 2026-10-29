import { createHash } from "node:crypto";
import { release } from "node:os";
import { chromium, webkit } from "playwright-core";
import { libraries, moduleIntegrity } from "../../src/shared/libraries.mjs";
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

// A fixed Pele-shaped rendering fixture for frame navigation and dialogs.
// Real diagram syntax and drawing are covered by the figure suite.
const pele = `export function mount(element, source, options = {}) {
  element.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"><rect width="300" height="100" fill="transparent"/><g class="pele-node" data-id="details" transform="translate(10 10)"><rect width="100" height="30"/><text class="pele-label" x="5" y="20">Details</text></g><g class="pele-node" data-id="native" transform="translate(150 10)"><a href="https://example.test/native"><rect width="100" height="30"/><text class="pele-label" x="5" y="20">Native link</text></a></g><g class="pele-node" data-id="gate" transform="translate(10 60)"><rect width="140" height="30"/><text class="pele-label" x="5" y="20"><tspan>Payment</tspan><tspan>gateway</tspan></text></g></svg>';
  const result = { width: 300, height: 100 };
  options.onRender?.(result);
  return { result, error: null, destroy() { element.replaceChildren(); } };
};`;

const peleHash = `sha384-${createHash("sha384").update(pele).digest("base64")}`;

// The hub's pages carry Pele's hash in their import map, so the stand-in
// loads only where each page names the stand-in's hash instead.
export async function stubPele(page) {
  await page.route(/^http:\/\/127\.0\.0\.1:\d+\//, async (route) => {
    if (route.request().resourceType() !== "document") return route.fallback();
    const response = await route.fetch();
    const body = (await response.text()).replaceAll(
      moduleIntegrity[libraries.pele],
      peleHash,
    );
    return route.fulfill({ response, body });
  });
  await page.route(/pele@[^/]+\/dist\/pele\.js$/, (route) =>
    route.fulfill({ body: pele, contentType: "text/javascript" }),
  );
}
