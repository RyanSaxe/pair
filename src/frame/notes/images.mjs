import { base } from "#frame/app/view.mjs";

/* Images on a note or a thread message. A screenshot pasted from the
   clipboard has no filename and no path, and a file dropped from Finder
   arrives as a File the browser will not give a path for, so the bytes go
   to the hub and it writes the file. What comes back is a reference, which
   is what the note, the message and the draft carry; localStorage holds
   about 5MB and would not survive bytes. */
export const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
const source = (item) => `${base}/api/upload/${encodeURIComponent(item.id)}`;

/* Paste, drop and the picker all arrive here. add receives each uploaded
   image's reference, and error a message, or "" to clear it. */
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
/* An image pasted or dropped on zone goes to attach, and zone has the class
   dropping while a file is over it. A paste of text pastes as usual. */
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
/* An attached image's thumbnail, with the ✕ that calls remove. */
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
/* A note the reviewer dropped takes its images with it, so the session does
   not keep bytes nothing refers to. */
export function forgetImages(items) {
  for (const item of items || [])
    fetch(source(item), { method: "DELETE" }).catch(() => {});
}
