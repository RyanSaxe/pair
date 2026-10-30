import { base } from "#frame/app/view.mjs";

/* The browser gives no path for a screenshot pasted from the clipboard or a
   file dropped from Finder, so uploadImages sends the bytes to the hub,
   which writes the file and returns a record. A note, a thread message and
   a draft contain only that record, because localStorage has a limit of
   about 5MB. */
export const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const source = (item) => `${base}/api/upload/${encodeURIComponent(item.id)}`;

/* uploadImages calls add with each uploaded image's record, and error with
   a message, or with "" to clear the message. */
export async function uploadImages(files, add, error) {
  const images = [...files].filter((file) => imageTypes.includes(file.type));
  if (!images.length) {
    error("Attach a PNG, JPEG, WebP or GIF.");
    return;
  }
  error("");
  for (const file of images) {
    try {
      const response = await fetch(`${base}/api/upload`, {
        method: "POST",
        body: file,
      });
      const record = await response.json();
      if (!response.ok) throw Error(record.error || "Upload failed.");
      add(record);
    } catch (problem) {
      error(problem.message);
    }
  }
}
export function acceptImages(zone, attach) {
  zone.addEventListener("paste", (event) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    attach(files);
  });
  for (const type of ["dragover", "dragenter"])
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("dropping");
    });
  for (const type of ["dragleave", "drop"])
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      if (type === "dragleave" && zone.contains(event.relatedTarget)) return;
      zone.classList.remove("dropping");
      if (type === "drop") attach(event.dataTransfer.files);
    });
}
export function imageFigure(item, remove) {
  const figure = document.createElement("figure");
  figure.className = "note-image";
  const image = document.createElement("img");
  image.src = source(item);
  image.alt = "";
  const drop = document.createElement("button");
  drop.type = "button";
  drop.className = "icon-btn";
  drop.textContent = "✕";
  drop.setAttribute("aria-label", "Remove this image");
  drop.onclick = remove;
  figure.append(image, drop);
  return figure;
}
/* The frame deletes the uploads of a note the reviewer discarded, so the
   session keeps no image that nothing refers to. */
export function forgetImages(items) {
  for (const item of items || [])
    fetch(source(item), { method: "DELETE" }).catch(() => {});
}
