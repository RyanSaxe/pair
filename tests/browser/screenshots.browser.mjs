import assert from "node:assert/strict";
import { test } from "node:test";
import { samePicture } from "../../scripts/screenshots/unchanged.mjs";
import { open } from "../support/browser.mjs";

test("samePicture ignores rendering noise and sees a real change", async (t) => {
  const page = await open(t, "about:blank");
  if (!page) return;
  // png() draws a grey picture with a patch, whose size sets how much changes.
  const png = (patch, colour, width = 200) =>
    page
      .evaluate(
        ({ patch, colour, width }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = 200;
          const context = canvas.getContext("2d");
          context.fillStyle = "rgb(100, 100, 100)";
          context.fillRect(0, 0, width, 200);
          context.fillStyle = colour;
          context.fillRect(0, 0, patch, patch);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        { patch, colour, width },
      )
      .then((base64) => Buffer.from(base64, "base64"));
  const picture = await png(0, "black");
  for (const [name, other, same] of [
    ["the same picture", picture, true],
    [
      "a colour level off everywhere",
      await png(200, "rgb(101, 100, 99)"),
      true,
    ],
    ["a few faint edge pixels", await png(4, "rgb(120, 100, 100)"), true],
    [
      "a faint new colour over an area",
      await png(40, "rgb(120, 100, 100)"),
      false,
    ],
    [
      "one strong pixel, as new text has",
      await png(1, "rgb(240, 100, 100)"),
      false,
    ],
    ["a different size", await png(0, "black", 300), false],
  ])
    assert.equal(await samePicture(page, picture, other), same, name);
});
