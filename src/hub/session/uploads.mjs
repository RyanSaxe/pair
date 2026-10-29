import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { exists, requireValue } from "../../shared/util.mjs";

export function uploads(session) {
  const { directory } = session;
  async function uploadName(id) {
    const names = await fs.readdir(path.join(directory, "uploads"));
    return names.find((entry) => entry.startsWith(`${id}.`));
  }
  /* upload chooses every file name, so a caller never supplies a path and
     no name can escape the uploads directory. */
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
  /* A note or a thread message refers to an image by its ID, and a sketch's
     image also refers to the scene it was drawn from. storedAttachment adds
     the path, type and size of the file the hub wrote, so a submission
     cannot point the agent at a path the hub never wrote. */
  async function storedAttachment(item) {
    const name = await uploadName(item.id);
    requireValue(name, `Image ${item.id} is not in this session`);
    const { bytes, type } = await readUpload(item.id);
    const image = {
      id: item.id,
      path: path.join(directory, "uploads", name),
      type,
      bytes: bytes.length,
    };
    if (item.scene === undefined) return image;
    const id = item.scene?.id;
    const file =
      /^[0-9a-f]{16}$/.test(id || "") &&
      path.join(directory, "scenes", `${id}.excalidraw`);
    requireValue(
      file && (await exists(file)),
      `Sketch scene ${id} is not in this session`,
    );
    return { ...image, scene: { id, path: file } };
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
    storedAttachment,
    uploadScene,
    readScene,
    removeUpload,
  };
}
/* imageKind identifies an image by its leading bytes, not by a Content-Type
   or a file extension that a caller sets. upload refuses any other bytes, so
   the hub never writes a file it cannot name. */
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
  // A WebP file starts with RIFF, a four-byte size and WEBP.
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return { type: "image/webp", ext: "webp" };
  return null;
}
/* The hub limits each upload to 10MB and sets no limit for the session, as
   it does for publishes, which take 10MB each in any number of rounds. A
   session limit would refuse a reviewer's screenshot in the middle of a
   review. */
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
