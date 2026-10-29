import { persist, save, state } from "#frame/app/store.mjs";
import { $, uuid } from "#frame/app/util.mjs";
import {
  feedbackEditable,
  noteEditable,
  page,
  plan,
} from "#frame/app/view.mjs";
import {
  editing,
  noteContext,
  noteDraftKey,
  openAgentMessage,
} from "#frame/notes/notes.mjs";
import { editSketch } from "#frame/notes/drawing.mjs";
import {
  acceptImages,
  forgetImages,
  imageFigure,
  uploadImages,
} from "#frame/notes/images.mjs";
import { sendKey, sendKeyName, startThread } from "#frame/notes/threads.mjs";
import { show } from "#frame/pages/pages.mjs";
import { cardsEditable } from "#frame/pages/work.mjs";

/* The images on the note in the dialog. */
let noteImages = [];
let noteImagesAtOpen = [];
let noteImagesSaved = false;
export function setNoteImages(images) {
  noteImages = images;
  noteImagesAtOpen = images.map((item) => item.id);
}
export function drawNoteImages() {
  const box = $("note-images");
  box.replaceChildren();
  box.hidden = !noteImages.length;
  for (const item of noteImages) {
    const figure = imageFigure(item, () => {
      noteImages = noteImages.filter((held) => held.id !== item.id);
      forgetImages([item]);
      drawNoteImages();
    });
    // A sketch opens again in the drawing editor, and saving replaces it.
    if (item.scene) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn note-image-edit";
      edit.textContent = "Edit sketch";
      edit.onclick = () =>
        editSketch(item, (sketch) => {
          noteImages = noteImages.map((held) =>
            held.id === item.id ? sketch : held,
          );
          forgetImages([item]);
          drawNoteImages();
        }).catch((error) => imageError(error.message));
      figure.append(edit);
    }
    box.append(figure);
  }
}
// An image the frame made for the note, such as a sketch, which backing out
// of the dialog drops like one the reviewer attached.
export function addNoteImage(record) {
  noteImages.push(record);
  drawNoteImages();
}
export function imageError(message) {
  const line = $("note-image-error");
  line.textContent = message;
  line.hidden = !message;
}
/* The note's text area is as tall as its text, within the heights its box
   allows. Safari and Firefox have no field-sizing, so the text is measured:
   at height auto, the text area's scrollHeight is its text's height. The
   scrollbar is hidden while measuring so it cannot narrow the text, and the
   scroll positions the short measuring height moved are put back. */
export function fitNoteText() {
  const area = $("note-text");
  const body = area.closest(".dialog-body");
  const scrolled = [area.scrollTop, body.scrollTop];
  area.style.height = "auto";
  area.style.overflowY = "hidden";
  const height = area.scrollHeight;
  area.style.overflowY = "";
  area.style.height = `${height}px`;
  [area.scrollTop, body.scrollTop] = scrolled;
}
const attach = (files) =>
  uploadImages(
    files,
    (record) => {
      noteImages.push(record);
      drawNoteImages();
    },
    imageError,
  );
/* A dialog the reviewer abandoned drops what it uploaded, so the session
   never keeps bytes no note refers to. This runs when the reviewer backs
   out of the dialog, by its ×, Escape or a click outside, and again before
   the next one opens, rather than on the dialog's close event, which
   saving a note also raises. */
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
  $("note-text").addEventListener("input", fitNoteText);
  // A new window width wraps the text again.
  addEventListener("resize", () => {
    if ($("note-dialog").open) fitNoteText();
  });
  $("note-image-pick").onclick = () => $("note-image-input").click();
  $("note-image-input").onchange = (event) => {
    attach(event.target.files);
    event.target.value = "";
  };
  acceptImages($("note-dialog"), attach);
  /* Start a thread sends the note to the agent now instead of keeping it
     for Send feedback, so the note leaves the draft and its images stay. */
  $("note-thread").setAttribute("aria-keyshortcuts", sendKeyName());
  $("note-thread").onclick = () => {
    const allowed = noteContext.proposal ? cardsEditable() : noteEditable();
    if (!allowed || $("note-thread").hidden) return;
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
  $("activity-message").onclick = openAgentMessage;
  // The form's submit, which Shift+Enter also triggers, adds nothing to
  // feedback while Add to feedback is hidden.
  $("note-form").onsubmit = (event) => {
    event.preventDefault();
    if (!feedbackEditable() || $("note-save").hidden) return;
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
