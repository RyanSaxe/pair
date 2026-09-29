import "../support/env.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";
import { imageSize, sizeImages, svgSize } from "../../src/build/image-size.mjs";
import { buildPage } from "../../src/cli/build.mjs";
import { pageData } from "../../src/shared/records.mjs";

const png = () => {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(3, 16);
  bytes.writeUInt32BE(2, 20);
  return bytes;
};

const jpeg = (frame) =>
  Buffer.from([0xff, 0xd8, 0xff, frame, 0, 7, 8, 0, 2, 0, 3, 0xff, 0xd9]);

const webp = (chunk, length) => {
  const bytes = Buffer.alloc(length);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(length - 8, 4);
  bytes.write("WEBP", 8);
  bytes.write(chunk, 12);
  bytes.writeUInt32LE(length - 20, 16);
  return bytes;
};

const gif = () => Buffer.from([71, 73, 70, 56, 57, 97, 3, 0, 2, 0]);

test("imageSize reads PNG, JPEG, WebP and GIF headers", () => {
  const lossy = webp("VP8 ", 30);
  lossy.set([0x9d, 0x01, 0x2a], 23);
  lossy.writeUInt16LE(3, 26);
  lossy.writeUInt16LE(2, 28);

  const lossless = webp("VP8L", 25);
  lossless[20] = 0x2f;
  lossless.writeUInt32LE(2 | (1 << 14), 21);

  const extended = webp("VP8X", 30);
  extended[24] = 2;
  extended[27] = 1;

  for (const bytes of [
    png(),
    jpeg(0xc0),
    jpeg(0xc2),
    lossy,
    lossless,
    extended,
    gif(),
  ])
    assert.deepEqual(imageSize(bytes), { width: 3, height: 2 });

  assert.equal(imageSize(png().subarray(0, 20)), null);
  assert.equal(imageSize(jpeg(0xc0).subarray(0, 8)), null);
  assert.equal(imageSize(Buffer.from("not an image")), null);
});

test("svgSize reads the viewBox dimensions", () => {
  assert.deepEqual(svgSize('<svg viewBox="10 20 3 2"></svg>'), {
    width: 3,
    height: 2,
  });
  assert.deepEqual(svgSize("<svg viewBox='0, 0, 3, 2'></svg>"), {
    width: 3,
    height: 2,
  });
  assert.equal(svgSize("<svg></svg>"), null);
});

test("sizeImages adds dimensions only to unsized data images", () => {
  const source = `data:image/gif;base64,${gif().toString("base64")}`;
  const html = [
    `<img alt="One" src="${source}">`,
    `<img width="8" src="${source}">`,
    `<img height="4" src="${source}">`,
    '<img src="/image.gif">',
    '<img src="data:image/gif;base64,invalid">',
    `<img data-caption="width=8" src='${source}' />`,
    `<img src="${source}" alt="1 > 0">`,
  ].join("");

  assert.equal(
    sizeImages(html),
    [
      `<img alt="One" src="${source}" width="3" height="2">`,
      `<img width="8" src="${source}">`,
      `<img height="4" src="${source}">`,
      '<img src="/image.gif">',
      '<img src="data:image/gif;base64,invalid">',
      `<img data-caption="width=8" src='${source}' width="3" height="2"/>`,
      `<img src="${source}" alt="1 > 0" width="3" height="2">`,
    ].join(""),
  );
});

test("pair build sizes the images in a page, Agreed's task and an agreement", async () => {
  const image = `<img src="data:image/gif;base64,${gif().toString("base64")}">`;
  const build = (page) =>
    buildPage(path.join(os.tmpdir(), "images.json"), {
      name: "images",
      round: "1",
      title: "Images",
      page,
    });
  const sized = /width="3" height="2"/;
  const plain = await build({ id: "overview", title: "Overview", html: image });
  assert.match(pageData(plain).page.html, sized);
  const agreed = pageData(
    await build({
      id: "agreed",
      title: "Agreed so far",
      task: { title: "Images", html: image },
      agreements: [{ id: "image", title: "Image", html: image, source: "S" }],
    }),
  ).page;
  assert.match(agreed.task.html, sized);
  assert.match(agreed.agreements[0].html, sized);
});
