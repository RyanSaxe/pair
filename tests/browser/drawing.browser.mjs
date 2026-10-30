import assert from "node:assert/strict";
import { test } from "node:test";
import { open, stubPele } from "../support/browser.mjs";
import { hub, planData, waitUntil } from "../support/hub.mjs";

// These modules stand in for React, ReactDOM, Excalidraw and its Mermaid
// converter from esm.sh, so the test runs offline. Like Excalidraw, the
// stand-in editor starts from initialData, raises an element's version on each
// edit to it, and calls onChange after each edit. A press, a drag and a release
// draw one stroke. The stand-in editor renders each element as a .stroke
// element with its text, and sets its theme on the surface. The stand-in
// converter makes one box labeled with the diagram's source.
const modules = {
  react:
    "export default { createElement: (type, props) => ({ type, props }) };",
  "react-dom":
    "export const createRoot = (node) => ({ render: ({ type, props }) => type(props, node) });",
  excalidraw: `document.fonts.add(new FontFace("Excalifont", "local(Arial)"));
export function Excalidraw({ initialData, onChange, theme, excalidrawAPI }, node) {
  let elements = [...initialData.elements];
  const surface = document.createElement("div");
  surface.className = "surface";
  surface.dataset.theme = theme;
  surface.style.cssText = "position: fixed; inset: 0; touch-action: none";
  const show = () =>
    surface.replaceChildren(
      ...elements.map((element) => Object.assign(document.createElement("i"), { className: "stroke", textContent: element.text || "" })),
    );
  excalidrawAPI?.({
    updateScene(scene) {
      elements = [...scene.elements];
      show();
      change();
    },
    addFiles() {},
    scrollToContent() {},
  });
  const change = () => onChange(elements, { viewBackgroundColor: "#ffffff" }, {});
  let stroke = null;
  surface.onpointerdown = (event) => {
    stroke = { id: String(Math.random()), type: "freedraw", version: 1, isDeleted: false, points: [[event.clientX, event.clientY]] };
    elements.push(stroke);
    change();
  };
  surface.onpointermove = (event) => {
    if (!stroke) return;
    stroke.points.push([event.clientX, event.clientY]);
    stroke.version += 1;
    change();
  };
  surface.onpointerup = () => {
    stroke = null;
    show();
  };
  node.append(surface);
  show();
}
export const convertToExcalidrawElements = (skeleton) =>
  skeleton.map((element, index) => ({ id: String(index), version: 1, isDeleted: false, ...element }));
export const exportToBlob = async () =>
  new Blob([Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=="), (char) => char.charCodeAt(0))], { type: "image/png" });`,
  converter: `export const parseMermaidToExcalidraw = async (source) => ({
  elements: [{ type: "rectangle", x: 0, y: 0, width: 100, height: 40, text: source }],
  files: {},
});`,
};
const stubExcalidraw = (page) =>
  page.route(/^https:\/\/esm\.sh\//, (route) => {
    const url = route.request().url();
    if (url.endsWith(".css"))
      return route.fulfill({ body: "", contentType: "text/css" });
    const name = url.includes("mermaid-to-excalidraw")
      ? "converter"
      : url.includes("excalidraw")
        ? "excalidraw"
        : url.includes("react-dom")
          ? "react-dom"
          : "react";
    // The editor's iframe is sandboxed, so its origin is null and its module
    // imports are cross-origin.
    return route.fulfill({
      body: modules[name],
      contentType: "text/javascript",
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  });

test("a drawing the reviewer backs out of opens again as they left it, after a reload too", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.pages[0].html = `<section class="drawing-question" data-drawing-question="layout" data-label="Layout">
  <h3>Sketch the layout</h3>
  <div class="drawing-stage"><div class="drawing-canvas"><img class="drawing-preview" alt="Saved drawing" hidden /></div><button class="btn" type="button" data-draw>Draw your answer</button></div>
  <p class="renderer-error" data-drawing-error role="status" hidden></p>
</section>`;
  assert.equal((await session.publish(plan)).code, 200);
  // Chrome gives a sandboxed iframe a process of its own. The editor's srcdoc
  // iframe starts loading in that process before Playwright routes its
  // requests, so its first requests can reach the real esm.sh. Chrome can also
  // lose a drag into a new iframe's process. Without site isolation, the iframe
  // shares the page's process and routes. The test does not disable
  // IsolateSandboxedIframes alone, because Chrome keeps only the last
  // --disable-features switch and would drop the features Playwright disables.
  const page = await open(t, "about:blank", {
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    args: ["--disable-site-isolation-trials"],
  });
  if (!page) return;
  await stubExcalidraw(page);
  await page.goto(`${h.server.origin}${session.base}/#overview`);

  const dialog = page.locator("#drawing-dialog");
  const editor = page.frameLocator("#drawing-frame");
  const strokes = editor.locator(".stroke");
  async function reopen() {
    await page.locator("[data-draw]").click();
    await editor.locator(".surface").waitFor();
  }

  await reopen();
  const box = await page.locator("#drawing-frame").boundingBox();
  await page.mouse.move(box.x + 60, box.y + 60);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 120, { steps: 5 });
  await page.mouse.up();
  assert.equal(await strokes.count(), 1);
  // The point (5, 5) is on the backdrop, outside the dialog.
  await page.touchscreen.tap(5, 5);
  await dialog.waitFor({ state: "hidden" });

  await reopen();
  assert.equal(await strokes.count(), 1);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });

  await page.reload();
  await reopen();
  assert.equal(await strokes.count(), 1);
});

test("Sketch on this diagram opens its boxes in the drawing editor in the frame's theme, and a thread from the sketch's note sends its image and scene", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  const source = "flowchart LR\n  gate --> details";
  plan.pages[0].html = `<div data-diagram data-caption="Payment flow">${source}</div>`;
  assert.equal((await session.publish(plan)).code, 200);
  // The switch keeps the editor's iframe in the page's process, for the reason
  // the first test gives.
  const page = await open(t, "about:blank", {
    colorScheme: "dark",
    args: ["--disable-site-isolation-trials"],
  });
  if (!page) return;
  await stubPele(page);
  await stubExcalidraw(page);
  await page.goto(`${h.server.origin}${session.base}/#overview`);
  await page.locator("[data-diagram] svg").click({ position: { x: 2, y: 2 } });
  await page.getByRole("button", { name: "Sketch on this diagram" }).click();

  const editor = page.frameLocator("#drawing-frame");
  await editor.locator(".stroke").filter({ hasText: "gate" }).waitFor();
  assert.deepEqual(await editor.locator(".stroke").allTextContents(), [source]);
  assert.equal(
    await editor.locator(".surface").getAttribute("data-theme"),
    "dark",
  );
  await page.getByRole("button", { name: "Save sketch" }).click();
  await page.locator("#note-dialog[open]").waitFor();
  assert.equal(
    await page.locator("#note-anchor").textContent(),
    "Overview › Payment flow",
  );
  assert.equal(await page.locator("#note-images img").count(), 1);
  await page.getByRole("button", { name: "Edit sketch" }).waitFor();
  await page.locator("#note-text").fill("Put a queue here.");
  await page.getByRole("button", { name: "Start a thread" }).click();

  const sent = async () => (await session.status()).body.threads?.[0];
  await waitUntil(async () => Boolean(await sent()));
  const [image] = (await sent()).messages[0].attachments;
  assert.equal(image.type, "image/png");
  assert.match(image.scene.path, /\/scenes\/[0-9a-f]{16}\.excalidraw$/);
});

test("a redrawn sketch replaces the note's old sketch only when the edit is saved", async (t) => {
  const h = await hub(t);
  const session = await h.session();
  const plan = planData();
  plan.pages[0].html = `<div data-diagram data-caption="Payment flow">flowchart LR\n  gate --> details</div>`;
  assert.equal((await session.publish(plan)).code, 200);
  const page = await open(t, "about:blank", {
    args: ["--disable-site-isolation-trials"],
  });
  if (!page) return;
  await stubPele(page);
  await stubExcalidraw(page);
  const url = `${h.server.origin}${session.base}/`;
  await page.goto(`${url}#overview`);
  const dialog = page.locator("#note-dialog");
  const onHub = async (id) =>
    (await session.request(`${session.base}/api/upload/${id}`)).code === 200;
  const shown = async () =>
    (await page.locator("#note-images img").getAttribute("src"))
      .split("/")
      .pop();
  const redraw = async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("button", { name: "Edit sketch" }).click();
    await page.frameLocator("#drawing-frame").locator(".stroke").waitFor();
    await page.getByRole("button", { name: "Save sketch" }).click();
    await page.locator("#drawing-dialog").waitFor({ state: "hidden" });
    return shown();
  };

  await page.locator("[data-diagram] svg").click({ position: { x: 2, y: 2 } });
  await page.getByRole("button", { name: "Sketch on this diagram" }).click();
  await page.getByRole("button", { name: "Save sketch" }).click();
  await page.locator("#note-dialog[open]").waitFor();
  const saved = await shown();
  await page.locator("#note-text").fill("Put a queue here.");
  await page.locator("#note-save").click();
  await dialog.waitFor({ state: "hidden" });
  await page.goto(`${url}#feedback`);

  const dropped = await redraw();
  assert.notEqual(dropped, saved);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await waitUntil(async () => !(await onHub(dropped))), true);
  assert.equal(await onHub(saved), true);

  const replacement = await redraw();
  await page.locator("#note-save").click();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await waitUntil(async () => !(await onHub(saved))), true);
  assert.equal(await onHub(replacement), true);
});
