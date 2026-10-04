import assert from "node:assert/strict";
import { test } from "node:test";
import { open } from "../support/browser.mjs";
import { hub, planData } from "../support/hub.mjs";

// Stand-ins for React, ReactDOM and Excalidraw from esm.sh, so the test runs
// offline. Like Excalidraw, the stand-in editor starts from initialData,
// raises an element's version on each edit to it, and calls onChange after
// each edit. A press, a drag and a release draw one stroke, and the editor
// shows each stroke as a .stroke element.
const modules = {
  react:
    "export default { createElement: (type, props) => ({ type, props }) };",
  "react-dom":
    "export const createRoot = (node) => ({ render: ({ type, props }) => type(props, node) });",
  excalidraw: `export function Excalidraw({ initialData, onChange }, node) {
  const elements = [...initialData.elements];
  const surface = document.createElement("div");
  surface.className = "surface";
  surface.style.cssText = "position: fixed; inset: 0; touch-action: none";
  const show = () =>
    surface.replaceChildren(
      ...elements.map(() => Object.assign(document.createElement("i"), { className: "stroke" })),
    );
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
export const exportToBlob = async () => new Blob([""], { type: "image/png" });`,
};
const stubExcalidraw = (page) =>
  page.route(/^https:\/\/esm\.sh\//, (route) => {
    const url = route.request().url();
    if (url.endsWith(".css"))
      return route.fulfill({ body: "", contentType: "text/css" });
    const name = url.includes("excalidraw")
      ? "excalidraw"
      : url.includes("react-dom")
        ? "react-dom"
        : "react";
    // The editor's frame is sandboxed, so its origin is null and its
    // module imports are cross-origin.
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
  // Chrome gives a sandboxed frame a process of its own, and the editor's
  // srcdoc frame starts loading in it before Playwright routes its
  // requests, so its first requests can reach the real esm.sh. A drag into
  // a new frame's process can be lost too. Without site isolation the frame
  // shares the page's process and routes. Chrome keeps only the last
  // --disable-features switch, so disabling IsolateSandboxedIframes alone
  // would drop the features Playwright disables.
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
  // A tap on the backdrop, outside the dialog.
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
