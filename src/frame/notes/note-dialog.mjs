import { persist, save, state } from "#frame/app/store.mjs";
import { $, uuid } from "#frame/app/util.mjs";
import {
  base,
  feedbackEditable,
  noteEditable,
  page,
  plan,
} from "#frame/app/view.mjs";
import { editing, noteContext, noteDraftKey } from "#frame/notes/notes.mjs";
import { sendKey, sendKeyName, startThread } from "#frame/notes/threads.mjs";
import { show } from "#frame/pages/pages.mjs";

/* Images on a note. A screenshot pasted from the clipboard has no filename
   and no path, and a file dropped from Finder arrives as a File the browser
   will not give a path for, so the bytes go to the hub and it writes the
   file. What comes back is a reference, which is what the note and the
   draft carry; localStorage holds about 5MB and would not survive bytes. */
let noteImages = [];
let noteImagesAtOpen = [];
let noteImagesSaved = false;
export function setNoteImages(images) {
  noteImages = images;
  noteImagesAtOpen = images.map((item) => item.id);
}
const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export function drawNoteImages() {
  const box = $("note-images");
  box.replaceChildren();
  box.hidden = !noteImages.length;
  for (const item of noteImages) {
    const figure = document.createElement("figure");
    figure.className = "note-image";
    const image = document.createElement("img");
    image.src = `${base}/api/upload/${encodeURIComponent(item.id)}`;
    image.alt = "";
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "icon-btn";
    drop.textContent = "✕";
    drop.setAttribute("aria-label", "Remove this image");
    drop.onclick = () => {
      noteImages = noteImages.filter((held) => held.id !== item.id);
      forgetImages([item]);
      drawNoteImages();
    };
    figure.append(image, drop);
    box.append(figure);
  }
}
export function imageError(message) {
  const line = $("note-image-error");
  line.textContent = message;
  line.hidden = !message;
}
/* Paste, drop and the picker all arrive here. */
async function attach(files) {
  const images = [...files].filter((file) => imageTypes.includes(file.type));
  if (!images.length) {
    imageError("Attach a PNG, JPEG, WebP or GIF.");
    return;
  }
  imageError("");
  for (const file of images) {
    try {
      const response = await fetch(`${base}/api/upload`, {
        method: "POST",
        body: file,
      });
      const record = await response.json();
      if (!response.ok) throw Error(record.error || "Upload failed.");
      noteImages.push(record);
      drawNoteImages();
    } catch (error) {
      imageError(error.message);
    }
  }
}
/* A note the reviewer dropped takes its images with it, so the session does
   not keep bytes nothing refers to. */
export function forgetImages(items) {
  for (const item of items || [])
    fetch(`${base}/api/upload/${encodeURIComponent(item.id)}`, {
      method: "DELETE",
    }).catch(() => {});
}
/* A dialog the reviewer abandoned drops what it uploaded, so the session
   never keeps bytes no note refers to. This runs when the dialog is closed
   by its own control and again before the next one opens, rather than on
   the dialog's close event, which a note saved by Escape would also raise
   and which this frame cannot observe. */
export function settleNoteImages() {
  if (!noteImagesSaved)
    forgetImages(
      noteImages.filter((item) => !noteImagesAtOpen.includes(item.id)),
    );
  noteImages = [];
  noteImagesAtOpen = [];
  noteImagesSaved = false;
}

export function installNoteDialog() {
  $("note-image-pick").onclick = () => $("note-image-input").click();
  $("note-image-input").onchange = (event) => {
    attach(event.target.files);
    event.target.value = "";
  };
  $("note-dialog").addEventListener("paste", (event) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) return;
    event.preventDefault();
    attach(files);
  });
  for (const type of ["dragover", "dragenter"])
    $("note-dialog").addEventListener(type, (event) => {
      event.preventDefault();
      $("note-dialog").classList.add("dropping");
    });
  for (const type of ["dragleave", "drop"])
    $("note-dialog").addEventListener(type, (event) => {
      event.preventDefault();
      if (
        type === "dragleave" &&
        $("note-dialog").contains(event.relatedTarget)
      )
        return;
      $("note-dialog").classList.remove("dropping");
      if (type === "drop") attach(event.dataTransfer.files);
    });
  /* Start a thread sends the note to the agent now instead of keeping it
     for Send feedback or Finish review, so the note leaves the draft and its
     images stay. */
  $("note-thread").setAttribute("aria-keyshortcuts", sendKeyName());
  $("note-thread").onclick = () => {
    if (!noteEditable() || $("note-thread").hidden) return;
    const text = $("note-text").value.trim();
    if (!text) {
      $("note-form").reportValidity();
      return;
    }
    startThread(noteContext, text, noteImages);
    if (state.noteDrafts) delete state.noteDrafts[noteDraftKey];
    noteImagesSaved = true;
    persist();
    $("note-dialog").close();
  };
  $("note-text").addEventListener("keydown", (event) => {
    if (!sendKey(event)) return;
    event.preventDefault();
    $("note-thread").click();
  });
  $("note-form").onsubmit = (event) => {
    event.preventDefault();
    if (!feedbackEditable()) return;
    const text = $("note-text").value.trim();
    if (!text) return;
    const note = {
      ...noteContext,
      id: editing || uuid(),
      text,
      round: plan.round,
      ...(noteImages.length ? { attachments: noteImages } : {}),
    };
    if (editing)
      state.notes = state.notes.map((item) =>
        item.id === editing ? note : item,
      );
    else state.notes.push(note);
    if (state.noteDrafts) delete state.noteDrafts[noteDraftKey];
    noteImagesSaved = true;
    save();
    $("note-dialog").close();
    if (note.topic === page.id && !$("reading").hidden)
      show(page.id, null, { keepScroll: true });
  };
}
