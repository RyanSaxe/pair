import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { exists, requireValue } from "../../shared/util.mjs";

// Images and drawing scenes the reviewer adds to a session.
export function uploads(session) {
  const { directory } = session;
  // An upload is named by its ID and the extension of its type.
  async function uploadName(id) {
    const names = await fs.readdir(path.join(directory, "uploads"));
    return names.find((entry) => entry.startsWith(`${id}.`));
  }
  /* The hub names every file, so a caller never chooses a path and a name
     can never escape the uploads directory. */
  async function upload(bytes) {
    const kind = imageKind(bytes);
    requireValue(kind, "Only PNG, JPEG, WebP and GIF images are accepted", 415);
    const id = crypto.randomBytes(8).toString("hex");
    const file = path.join(directory, "uploads", `${id}.${kind.ext}`);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return { id, path: file, type: kind.type, bytes: bytes.length };
  }
  async function readUpload(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad image ID", 404);
    const name = await uploadName(id);
    requireValue(name, "No such image", 404);
    const bytes = await fs.readFile(path.join(directory, "uploads", name));
    const kind = imageKind(bytes);
    requireValue(kind, "No such image", 404);
    return { bytes, type: kind.type };
  }
  async function uploadScene(bytes) {
    let scene;
    try {
      scene = JSON.parse(bytes.toString("utf8"));
    } catch {
      requireValue(false, "Drawing scene must be JSON");
    }
    requireValue(
      scene?.type === "excalidraw" &&
        Array.isArray(scene.elements) &&
        scene.elements.length > 0 &&
        scene.appState &&
        typeof scene.appState === "object" &&
        !Array.isArray(scene.appState) &&
        scene.files &&
        typeof scene.files === "object" &&
        !Array.isArray(scene.files),
      "Drawing scene must contain Excalidraw elements, appState and files",
    );
    const id = crypto.randomBytes(8).toString("hex");
    const file = path.join(directory, "scenes", `${id}.excalidraw`);
    await fs.writeFile(file, bytes, { mode: 0o600 });
    return {
      id,
      path: file,
      type: "application/vnd.excalidraw+json",
      bytes: bytes.length,
    };
  }
  async function readScene(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad drawing scene ID", 404);
    const file = path.join(directory, "scenes", `${id}.excalidraw`);
    requireValue(await exists(file), "No such drawing scene", 404);
    return { bytes: await fs.readFile(file), path: file };
  }
  /* A note the reviewer removed takes its images with it. */
  async function removeUpload(id) {
    requireValue(/^[0-9a-f]{16}$/.test(id || ""), "Bad image ID");
    const name = await uploadName(id);
    if (name) await fs.rm(path.join(directory, "uploads", name));
    return { id, removed: Boolean(name) };
  }
  return {
    uploadName,
    upload,
    readUpload,
    uploadScene,
    readScene,
    removeUpload,
  };
}
/* An image is identified by its leading bytes, not by a Content-Type a
   caller sets or an extension a name carries. Anything else is refused, so
   the hub never writes a file it could not name. */
const signatures = [
  {
    type: "image/png",
    ext: "png",
    magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { type: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { type: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
];
function imageKind(bytes) {
  for (const entry of signatures)
    if (entry.magic.every((byte, at) => bytes[at] === byte)) return entry;
  // RIFF....WEBP: the four-byte size sits between the two markers.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return { type: "image/webp", ext: "webp" };
  return null;
}
/* One request is bounded, the session is not, which is how every other
   route here behaves: a publish takes 10MB and a session may hold any
   number of rounds. A reviewer attaching screenshots should never meet
   a ceiling mid-review. */
export const uploadBytes = 10 * 1024 * 1024;
export async function readBytes(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireValue(size <= limit, "Image is over 10MB", 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
