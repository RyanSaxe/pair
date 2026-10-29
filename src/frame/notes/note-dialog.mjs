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
// settleNoteImages deletes an image added here, such as a sketch, when the
// reviewer backs out of the dialog, as it does for an attached image.
export function addNoteImage(record) {
  noteImages.push(record);
  drawNoteImages();
}
export function imageError(message) {
  const line = $("note-image-error");
  line.textContent = message;
  line.hidden = !message;
}
/* Safari and Firefox have no CSS field-sizing, so fitNoteText measures the
   text. At height auto, the text area's scrollHeight is the text's height.
   fitNoteText hides the scrollbar while it measures, so the scrollbar
   cannot narrow the text, and then restores the scroll positions that the
   short measuring height changed. */
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
/* settleNoteImages deletes the images that a dialog uploaded when the
   reviewer backs out of it, so the session keeps no image that no note
   refers to. The frame calls it when the reviewer closes the dialog with
   its ×, Escape or a click outside, and again before the next note opens.
   The dialog's close event cannot call it, because saving a note also
   fires that event. */
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
  // A new window width wraps the text again and changes its height.
  addEventListener("resize", () => {
    if ($("note-dialog").open) fitNoteText();
  });
  $("note-image-pick").onclick = () => $("note-image-input").click();
  $("note-image-input").onchange = (event) => {
    attach(event.target.files);
    event.target.value = "";
  };
  acceptImages($("note-dialog"), attach);
  /* startThread sends the note to the hub now instead of keeping it for
     Send feedback, so this handler deletes the note's draft and keeps its
     images. */
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
  // Shift+Enter also submits the form, so the handler adds nothing to
  // feedback while the Add to feedback button is hidden.
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
