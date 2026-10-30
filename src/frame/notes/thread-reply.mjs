import { persist, state } from "#frame/app/store.mjs";
import { $, typingIn } from "#frame/app/util.mjs";
import {
  acceptImages,
  forgetImages,
  imageFigure,
  imageTypes,
  uploadImages,
} from "#frame/notes/images.mjs";
import { sendKey, sendKeyLabel, sendKeyName } from "#frame/notes/threads.mjs";

/* replyForm keeps the reply's text and images in state.replyDrafts until
   Send, so a reload keeps them. */

const redraws = new WeakMap();
// refreshReplies shows the reply drafts that another tab changed in the
// forms on screen, and leaves the box the reviewer is typing in as it is.
export function refreshReplies() {
  for (const form of document.querySelectorAll("form.thread-reply"))
    redraws.get(form)?.();
}
const draftOf = (id) =>
  state.replyDrafts?.[id] ?? { text: "", attachments: [] };
function keep(id, draft) {
  const drafts = (state.replyDrafts ||= {});
  if (draft.text || draft.attachments.length) drafts[id] = draft;
  else delete drafts[id];
  persist();
}
const element = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};
// send(text, attachments) posts the message. It returns false when the
// thread no longer exists, and replyForm then keeps the draft.
export function replyForm(id, send) {
  const form = element("form", "thread-reply");
  const field = element("textarea");
  field.rows = 1;
  field.placeholder = "Reply";
  field.setAttribute("aria-label", "Reply in this thread");
  field.value = draftOf(id).text;
  field.oninput = () => keep(id, { ...draftOf(id), text: field.value });
  field.onkeydown = (event) => {
    if (!sendKey(event)) return;
    event.preventDefault();
    form.requestSubmit();
  };
  const pick = element("button", "btn thread-image-pick");
  pick.type = "button";
  pick.setAttribute("aria-label", "Add an image");
  pick.title = "Add an image";
  pick.append($("note-image-pick").querySelector("svg").cloneNode(true));
  const input = element("input");
  input.type = "file";
  input.accept = imageTypes.join(",");
  input.multiple = true;
  input.hidden = true;
  const submit = element("button", "btn");
  submit.type = "submit";
  submit.setAttribute("aria-keyshortcuts", sendKeyName());
  const key = element("kbd");
  key.textContent = sendKeyLabel();
  submit.append("Send ", key);
  const strip = element("div", "note-images");
  const problem = element("p", "renderer-error");
  const error = (message) => {
    problem.textContent = message;
    problem.hidden = !message;
  };
  const draw = () => {
    const { attachments } = draftOf(id);
    strip.hidden = !attachments.length;
    strip.replaceChildren(
      ...attachments.map((item) =>
        imageFigure(item, () => {
          const draft = draftOf(id);
          keep(id, {
            ...draft,
            attachments: draft.attachments.filter(
              (held) => held.id !== item.id,
            ),
          });
          forgetImages([item]);
          draw();
        }),
      ),
    );
  };
  const attach = (files) =>
    uploadImages(
      files,
      (record) => {
        const draft = draftOf(id);
        keep(id, { ...draft, attachments: [...draft.attachments, record] });
        draw();
      },
      error,
    );
  pick.onclick = () => input.click();
  input.onchange = () => {
    attach(input.files);
    input.value = "";
  };
  acceptImages(form, attach);
  form.onsubmit = (event) => {
    event.preventDefault();
    const text = field.value.trim();
    if (!text || send(text, draftOf(id).attachments) === false) return;
    field.value = "";
    keep(id, { text: "", attachments: [] });
    error("");
    draw();
  };
  form.append(field, pick, submit, input, strip, problem);
  error("");
  draw();
  let attached = JSON.stringify(draftOf(id).attachments);
  redraws.set(form, () => {
    const draft = draftOf(id);
    if (typingIn(field)) return;
    if (field.value !== draft.text) field.value = draft.text;
    if (JSON.stringify(draft.attachments) === attached) return;
    attached = JSON.stringify(draft.attachments);
    draw();
  });
  return form;
}
