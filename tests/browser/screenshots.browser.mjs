import assert from "node:assert/strict";
import { test } from "node:test";
import { samePicture } from "../../scripts/screenshots/unchanged.mjs";
import { open } from "../support/browser.mjs";

test("samePicture ignores rendering noise and sees a real change", async (t) => {
  const page = await open(t, "about:blank");
  if (!page) return;
  const png = (width, fill, dot) =>
    page
      .evaluate(
        ({ width, fill, dot }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = 20;
          const context = canvas.getContext("2d");
          context.fillStyle = fill;
          context.fillRect(0, 0, width, 20);
          context.fillStyle = dot;
          context.fillRect(3, 3, 1, 1);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        { width, fill, dot },
      )
      .then((base64) => Buffer.from(base64, "base64"));
  const picture = await png(20, "rgb(100, 100, 100)", "rgb(100, 100, 100)");
  const noisy = await png(20, "rgb(100, 100, 100)", "rgb(101, 100, 99)");
  const changed = await png(20, "rgb(100, 100, 100)", "rgb(200, 100, 100)");
  const wider = await png(30, "rgb(100, 100, 100)", "rgb(100, 100, 100)");
  assert.equal(await samePicture(page, picture, picture), true);
  assert.equal(await samePicture(page, picture, noisy), true);
  assert.equal(await samePicture(page, picture, changed), false);
  assert.equal(await samePicture(page, picture, wider), false);
});
