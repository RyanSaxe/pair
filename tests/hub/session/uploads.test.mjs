import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { exists, hub, planData } from "../../support/hub.mjs";

// A reviewer's screenshot arrives as bytes with no name and no type worth
// trusting, so the hub decides both and writes the file itself.
test("an image upload is decided by its bytes, capped, and named by the hub", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const send = (body, headers = {}) =>
    fetch(`${h.server.origin}${a.base}/api/upload`, {
      method: "POST",
      headers: { Origin: h.server.origin, ...headers },
      body,
    });
  const pad = (magic, size = 64) =>
    Buffer.concat([Buffer.from(magic), Buffer.alloc(size)]);
  const png = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const jpeg = pad([0xff, 0xd8, 0xff]);
  const gif = pad([0x47, 0x49, 0x46, 0x38]);
  const webp = Buffer.concat([
    Buffer.from("RIFF"),
    Buffer.alloc(4),
    Buffer.from("WEBP"),
    Buffer.alloc(64),
  ]);

  const accepted = await send(png);
  const record = await accepted.json();
  assert.equal(accepted.status, 201, record.error);
  assert.equal(record.type, "image/png");
  assert.equal(record.bytes, png.length);
  assert.match(record.id, /^[0-9a-f]{16}$/);
  // The hub names the file, so the caller never picks a path.
  assert.equal(
    record.path,
    path.join(a.directory, "uploads", `${record.id}.png`),
  );
  assert.deepEqual(await fs.readFile(record.path), png);

  for (const [bytes, type] of [
    [jpeg, "image/jpeg"],
    [gif, "image/gif"],
    [webp, "image/webp"],
  ])
    assert.equal((await send(bytes).then((r) => r.json())).type, type);

  // A HEIC from a phone, and a PNG signature that a name cannot fake.
  const heic = Buffer.concat([
    Buffer.alloc(4),
    Buffer.from("ftypheic"),
    Buffer.alloc(64),
  ]);
  const refused = await send(heic);
  assert.equal(refused.status, 415);
  assert.match((await refused.json()).error, /PNG, JPEG, WebP and GIF/);

  const tooBig = await send(
    Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]),
  );
  assert.equal(tooBig.status, 413);
  assert.match((await tooBig.json()).error, /10MB/);

  assert.equal((await send(png, { Origin: "http://example.com" })).status, 403);

  // One request is bounded and the session is not, so a long review never
  // meets a ceiling.
  for (let n = 0; n < 30; n++) assert.equal((await send(png)).status, 201);
  assert.equal(
    (await fs.readdir(path.join(a.directory, "uploads"))).length,
    34,
  );
});

test("a note carries its images by path, and removing one deletes the file", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  const stored = await fetch(`${h.server.origin}${a.base}/api/upload`, {
    method: "POST",
    headers: { Origin: h.server.origin },
    body: png,
  }).then((r) => r.json());

  const note = (attachments) => ({
    id: crypto.randomUUID(),
    topic: "overview",
    anchor: "The strip under the header",
    text: "This is what I mean.",
    attachments,
  });
  // A note may only name an image this session holds.
  const rejected = await a.feedback(
    a.event("feedback-only", "1", {
      groups: {
        notes: [
          note([
            {
              id: "0".repeat(16),
              path: "/tmp/x.png",
              type: "image/png",
              bytes: 1,
            },
          ]),
        ],
      },
    }),
  );
  assert.equal(rejected.code, 400);
  assert.match(rejected.body.error, /not in this session/);

  const event = a.event("feedback-only", "1", {
    groups: { notes: [note([stored])] },
  });
  assert.equal((await a.feedback(event)).code, 200);
  // The agent reads the path off the note, and the bytes are on disk under it.
  const delivered = (await a.action("read", { id: event.id })).body.event;
  assert.deepEqual(delivered.payload.groups.notes[0].attachments, [stored]);
  assert(await exists(stored.path));

  const removed = await fetch(
    `${h.server.origin}${a.base}/api/upload/${stored.id}`,
    { method: "DELETE", headers: { Origin: h.server.origin } },
  );
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), { id: stored.id, removed: true });
  assert.equal(await exists(stored.path), false);
  // Removing the same image twice is not an error, so a retry is safe.
  assert.deepEqual(
    await fetch(`${h.server.origin}${a.base}/api/upload/${stored.id}`, {
      method: "DELETE",
      headers: { Origin: h.server.origin },
    }).then((r) => r.json()),
    { id: stored.id, removed: false },
  );
});

test("a drawing answer saves a scene and PNG preview in its own session", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  const other = await h.session();
  assert.equal((await a.publish(planData())).code, 200);
  const scene = {
    type: "excalidraw",
    version: 2,
    elements: [{ id: "shape" }],
    appState: {},
    files: {},
  };
  const post = (suffix, body) =>
    fetch(`${h.server.origin}${a.base}/api/${suffix}`, {
      method: "POST",
      headers: { Origin: h.server.origin },
      body,
    });
  const saved = await post("drawing-scene", JSON.stringify(scene));
  assert.equal(saved.status, 201);
  const drawing = await saved.json();
  assert.equal(
    drawing.path,
    path.join(a.directory, "scenes", `${drawing.id}.excalidraw`),
  );
  assert.deepEqual(JSON.parse(await fs.readFile(drawing.path, "utf8")), scene);
  assert.deepEqual(
    await fetch(
      `${h.server.origin}${a.base}/api/drawing-scene/${drawing.id}`,
    ).then((r) => r.json()),
    scene,
  );
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);
  const preview = await (await post("upload", png)).json();
  const answer = {
    kind: "drawing",
    topic: "overview",
    label: "System boundary",
    round: "1",
    sceneId: drawing.id,
    previewId: preview.id,
  };
  const event = a.event("feedback-only", "1", {
    groups: { answers: { "overview/boundary": answer } },
  });
  assert.equal((await a.feedback(event)).code, 200);
  const read = (await a.action("read", { id: event.id })).body.event.payload
    .groups.answers["overview/boundary"];
  assert.equal(read.scenePath, drawing.path);
  assert.equal(read.previewPath, preview.path);
  assert(await exists(read.scenePath));
  assert(await exists(read.previewPath));
  const foreign = await (
    await fetch(`${h.server.origin}${other.base}/api/drawing-scene`, {
      method: "POST",
      headers: { Origin: h.server.origin },
      body: JSON.stringify(scene),
    })
  ).json();
  assert.equal(
    (
      await a.feedback(
        a.event("feedback-only", "1", {
          groups: {
            answers: {
              "overview/foreign": { ...answer, sceneId: foreign.id },
            },
          },
        }),
      )
    ).code,
    404,
  );
  assert.equal((await post("drawing-scene", "not JSON")).status, 400);
  assert.equal(
    (await post("drawing-scene", JSON.stringify({ ...scene, elements: [] })))
      .status,
    400,
  );
  assert.equal(
    (await post("drawing-scene", Buffer.alloc(10 * 1024 * 1024 + 1))).status,
    413,
  );
  assert.equal(
    (
      await fetch(`${h.server.origin}${a.base}/api/drawing-scene`, {
        method: "POST",
        headers: { Origin: "http://example.com" },
        body: JSON.stringify(scene),
      })
    ).status,
    403,
  );
});
