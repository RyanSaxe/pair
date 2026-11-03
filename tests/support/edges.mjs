import assert from "node:assert/strict";
import { open } from "./browser.mjs";
import { hub, planData } from "./hub.mjs";

export const PAGE_KEY = "pair:page-width";
export const SIDEBAR_KEY = "pair:sidebar-width";
export const wide = { width: 2000, height: 900 };

const prose =
  "The hub serves every live session from one Node process and stores each session on disk, so a change to the width of this paragraph would break its lines in other places. ".repeat(
    3,
  );
const shiki = `export async function codeToHtml(source) {
  return "<pre class='shiki'><code>" + source.replace(/</g, "&lt;") + "</code></pre>";
}`;
const code = (name) =>
  `<pre data-language="js" data-file="${name}.js">const retries = 3;\nconst delay = 8;</pre>`;
// This image is much wider than any column in these tests.
const image = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="3000" height="300"/>',
)}`;
const pages = [
  {
    id: "blocks",
    title: "Blocks",
    html: `<p id="words">${prose}</p>${code("blocks")}
<div data-prototype="probe"></div>
<figure><img src="${image}" alt="A wide image" style="width: 100%"></figure>`,
    prototypes: [
      {
        id: "probe",
        title: "Probe",
        height: 120,
        html: "<!doctype html><title>Probe</title><p>Probe</p>",
      },
    ],
  },
  {
    id: "long",
    title: "Long",
    html: Array.from(
      { length: 40 },
      (_, index) => `<p id="words-${index}">${prose}</p>${code(index)}`,
    ).join(""),
  },
];

export async function setup(
  t,
  engine,
  { viewport = wide, at = "blocks", ...options } = {},
) {
  const h = await hub(t);
  const session = await h.session();
  const published = await session.publish({ ...planData(), pages });
  assert.equal(published.code, 200, published.body.error);
  const url = (rest) => `${h.server.origin}${session.base}/${rest}`;
  const page = await open(t, "about:blank", { engine, viewport, ...options });
  if (!page) return null;
  await page.route(/esm\.sh\/shiki/, (route) =>
    route.fulfill({ body: shiki, contentType: "text/javascript" }),
  );
  await page.goto(url(`#${at}`));
  await page.locator(`#page-content[data-page-id="${at}"]`).waitFor();
  return { h, session, page, url };
}

export const box = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const { left, right, width, top } = element.getBoundingClientRect();
      return { left, right, width, top };
    });
export const saved = (page, key) =>
  page.evaluate((key) => localStorage.getItem(key), key);
// The browser fires resize at its next frame, so this waits for the attribute.
export const fullIs = (page, expected) =>
  page.waitForFunction(
    (expected) =>
      document.documentElement.hasAttribute("data-page-full") === expected,
    expected,
    { timeout: 3000 },
  );
export const save = (page, values) =>
  page.evaluate((values) => {
    for (const [key, value] of Object.entries(values))
      localStorage.setItem(key, value);
  }, values);

// A tab sits at its strip's left plus the ::after's own left.
export const tab = (page, side) =>
  page.locator(`.grip.${side}`).evaluate((grip) => {
    const strip = grip.getBoundingClientRect().left;
    const { left, width } = getComputedStyle(grip, "::after");
    const start = strip + parseFloat(left);
    return { left: start, right: start + parseFloat(width) };
  });
export const blueLine = (page, side) =>
  page.locator(`.grip.${side}`).evaluate((grip) => {
    const strip = grip.getBoundingClientRect().left;
    return strip + parseFloat(getComputedStyle(grip, "::before").left);
  });

export const Y = 450;
export async function press(page, x, y = Y) {
  await page.mouse.move(x, y);
  await page.mouse.down();
}
// Chrome delivers a pointer move with the next animation frame, so moveTo waits
// for the frame after that.
export async function moveTo(page, x, y = Y) {
  await page.mouse.move(x, y, { steps: 8 });
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}
export async function drag(page, from, to) {
  await press(page, from);
  await moveTo(page, to);
  await page.mouse.up();
}
export const near = (actual, expected, label = "") =>
  assert.ok(
    Math.abs(actual - expected) <= 1,
    `${label} at ${actual}, expected ${expected}`,
  );
