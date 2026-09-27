import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { assemble } from "../../../src/build/assemble.mjs";
import { renderFinish } from "../../../src/frame/review/send.mjs";
import { offers } from "../../../src/shared/offers.mjs";
import { readPlanData } from "../../../src/shared/records.mjs";
import { exists, hub, planData, root } from "../../support/hub.mjs";

test("a plan can be reopened, and only the current round's offer is accepted", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1", "plan"));
  const feedback = a.event();
  await a.feedback(feedback);
  await a.action("read");
  assert.equal((await a.publish(planData("2"))).code, 200);
  const save = { offer: "plan", action: "save" };
  assert.equal((await a.feedback(a.event("accept", "1", save))).code, 409);
  assert.equal((await a.feedback(a.event("accept", "2", save))).code, 409);
  const choice = a.event("feedback-only", "2", {
    text: "Use per-item results.",
  });
  await a.feedback(choice);
  await a.action("read");
  await a.publish(planData("3", "plan"));
  for (const [offer, action, code] of [
    ["finish", "finish", 409],
    ["plan", "finish", 400],
    ["plan", undefined, 400],
  ])
    assert.equal(
      (await a.feedback(a.event("accept", "3", { offer, action }))).code,
      code,
    );
  const acceptance = a.event("accept", "3", save);
  assert.equal((await a.feedback(acceptance)).code, 200);
  await a.action("read");
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(a.directory, "acceptance.json"), "utf8"),
    ).path,
    path.join(a.directory, "rounds/example.3.html"),
  );
  assert.equal(
    readPlanData(
      await fs.readFile(
        path.join(a.directory, "rounds/example.1.html"),
        "utf8",
      ),
    ).offer,
    "plan",
  );
});

// Finish your review as the frame renders it for the frame's fixture built
// with the offer. The frame may write only to elements the built dialog has.
async function fixtureDialog(offer, accept) {
  const directory = path.join(root, "tests/fixture");
  const read = async ({ file, ...item }) => ({
    ...item,
    html: await fs.readFile(path.join(directory, file), "utf8"),
  });
  const source = JSON.parse(
    await fs.readFile(path.join(directory, "fixture.json"), "utf8"),
  );
  const [first, ...rest] = await Promise.all(source.pages.map(read));
  const built = await assemble({
    ...source,
    offer,
    pages: [{ ...first, id: offers[offer].firstPage || first.id }, ...rest],
    prototypes: await Promise.all(source.prototypes.map(read)),
  });
  const dialog = built.match(
    /<dialog[^>]*id="finish-dialog"[\s\S]*?<\/dialog>/,
  )[0];
  const elements = new Map();
  const document = {
    getElementById(name) {
      if (!dialog.includes(`id="${name}"`)) return null;
      if (!elements.has(name))
        elements.set(name, {
          replaceChildren(...children) {
            this.children = children;
          },
        });
      return elements.get(name);
    },
    createElement: () => ({}),
  };
  renderFinish(document, readPlanData(built), offers, accept);
  return elements;
}

// Every registry entry: the round opens on the offer's first page, the frame's
// fixture built with the offer renders the entry in Finish your review, and
// the button for each action is accepted with a drafted comment and sends the
// agent to the offer's guide file.
for (const [id, offer] of Object.entries(offers))
  for (const action of offer.accept.actions)
    test(`a round that offers ${id} is accepted with ${action.id}`, async (t) => {
      const h = await hub(t);
      const a = await h.session();
      const first = offer.firstPage || "summary";
      const pages = [
        { id: first, title: "First", html: "<p>The first page.</p>" },
        { id: "detail", title: "Detail", html: "<p>The detail.</p>" },
      ];
      if (offer.firstPage) {
        const refused = await a.publish({
          ...planData("1", id),
          pages: [...pages].reverse(),
        });
        assert.equal(refused.code, 400);
        assert.match(refused.body.error, new RegExp(`lists ${first} first`));
      }
      assert.equal(
        (await a.publish({ ...planData("1", id), pages })).code,
        200,
      );
      const built = await fs.readFile(
        path.join(a.directory, "rounds/example.1.html"),
        "utf8",
      );
      assert.equal(readPlanData(built).offer, id);
      let pressed;
      const shown = await fixtureDialog(id, (chosen) => (pressed = chosen));
      const text = (element) => shown.get(element).textContent;
      assert.equal(text("finish-detail"), "Component fixture, round 1");
      assert.deepEqual(
        [
          "accept-label",
          "accept-hint",
          "changes-hint",
          "accept-note",
          "accept-guidance-label",
          "accept-guidance-detail",
        ].map(text),
        [
          offer.accept.label,
          offer.accept.hint,
          offer.changes,
          offer.accept.note,
          offer.accept.guidance.label,
          offer.accept.guidance.hint,
        ],
      );
      // Plain actions on the left, and the primary one on the right.
      const buttons = shown.get("accept-actions").children;
      assert.deepEqual(
        buttons.map((button) => [button.textContent, button.className]),
        offer.accept.actions.map((item, index, all) => [
          item.label,
          index === all.length - 1 ? "btn primary" : "btn",
        ]),
      );
      buttons.find((button) => button.textContent === action.label).onclick();
      assert.equal(pressed, action);
      // The sessions list says which rounds wait to be accepted.
      const [listed] = (await a.request("/api/sessions")).body.sessions;
      assert.equal(listed.offer, id);
      assert.equal((await a.action("complete")).code, 409);
      const note = {
        id: "note-1",
        topic: first,
        anchor: "First",
        quote: "",
        text: "Keep the diff small.",
        round: "1",
      };
      const guidance =
        action.id === offer.accept.guidance.action
          ? { guidance: "Start with the tests." }
          : {};
      const acceptance = a.event("accept", "1", {
        offer: id,
        action: pressed.id,
        groups: { alignUnflagged: true, choices: {}, notes: [note] },
        ...guidance,
      });
      assert.equal((await a.feedback(acceptance)).code, 200);
      assert.equal((await a.action("complete")).code, 409);
      const guide = new RegExp(`/guide/offers/${id}\\.md`);
      const ack = (await a.action("ack")).body.next;
      assert.match(ack, /^Read \S+, then run: pair read /);
      assert.match(ack, guide);
      const read = (await a.action("read")).body;
      assert.deepEqual(read.event.payload.groups.notes, [note]);
      // The next line names the offer's guide file, and a saved round also
      // gives the handoff line the holder says before it ends its turn.
      const [, named, file] = read.next.match(
        action.after === "saved"
          ? /^Round 1 is saved for later, as the (\S+) action in (\S+) describes\. Say this line in chat, then end your turn: /
          : /^Follow the (\S+) action in (\S+)\.$/,
      );
      assert.equal(named, action.id);
      assert.match(file, guide);
      assert.ok(path.isAbsolute(file) && (await exists(file)));
      if (action.after === "saved")
        assert.ok(read.next.endsWith(`: ${read.status.handoff}`));
      const record = JSON.parse(
        await fs.readFile(path.join(a.directory, "acceptance.json"), "utf8"),
      );
      assert.equal(record.offer, id);
      assert.equal(record.action, action.id);
      assert.equal(record.guidance, guidance.guidance);
      assert.deepEqual(record.groups.notes, [note]);
      assert.equal(
        record.sha256,
        crypto
          .createHash("sha256")
          .update(await fs.readFile(record.path))
          .digest("hex"),
      );
      // Only accepted work completes. A plan's acceptance keeps the session:
      // it is saved, or the agent builds it in the next round.
      const complete = await a.action("complete");
      const sessions = () =>
        a.request("/api/sessions").then(({ body }) => body.sessions);
      if (action.after === "complete") {
        assert.equal(complete.code, 200);
        assert.deepEqual(await sessions(), []);
        assert.equal((await a.publish(planData("2", id))).code, 409);
      } else {
        assert.equal(complete.code, 409);
        assert.match(complete.body.error, /keeps the session/);
        assert.deepEqual(
          (await sessions()).map((item) => item.stage),
          [action.after === "saved" ? "saved" : "working"],
        );
      }
    });

test("guidance goes only with its action, is trimmed and bounded, and is saved once", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1", "plan"));
  const accept = (action, guidance) =>
    a.event("accept", "1", { offer: "plan", action, guidance });
  assert.equal((await a.feedback(accept("save", "Do this"))).code, 400);
  assert.equal(
    (await a.feedback(accept("implement", "x".repeat(4001)))).code,
    400,
  );
  const acceptance = accept(
    "implement",
    "  Start with the drawing question.  ",
  );
  assert.equal((await a.feedback(acceptance)).code, 200);
  assert.equal((await a.feedback(acceptance)).code, 200);
  assert.equal(
    (await a.feedback({ ...acceptance, guidance: "Different work" })).code,
    409,
  );
  const read = await a.action("read");
  assert.equal(
    read.body.event.payload.guidance,
    "Start with the drawing question.",
  );
  const record = JSON.parse(
    await fs.readFile(path.join(a.directory, "acceptance.json"), "utf8"),
  );
  assert.equal(record.guidance, "Start with the drawing question.");
});

test("unread feedback blocks an acceptance", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1", "plan"));
  await a.feedback(a.event("feedback-only", "1"));
  const save = { offer: "plan", action: "save" };
  assert.equal((await a.feedback(a.event("accept", "1", save))).code, 409);
});

test("an acceptance with nothing drafted records no comments", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1", "plan"));
  const acceptance = a.event("accept", "1", {
    offer: "plan",
    action: "save",
    groups: { alignUnflagged: true, choices: {}, notes: [] },
  });
  assert.equal((await a.feedback(acceptance)).code, 200);
  await a.action("read");
  const record = JSON.parse(
    await fs.readFile(path.join(a.directory, "acceptance.json"), "utf8"),
  );
  assert.equal(record.groups, undefined);
});

test("Start implementation goes on to a build round the reviewer follows", async (t) => {
  const h = await hub(t);
  const a = await h.session();
  await a.publish(planData("1", "plan"));
  const accept = a.event("accept", "1", { offer: "plan", action: "implement" });
  assert.equal((await a.feedback(accept)).code, 200);
  // The frame shows the agent's progress from the acceptance until the build
  // round is complete, in every browser.
  assert.equal((await a.status()).body.latestSubmissionRound, "1");
  assert.match((await a.action("read")).body.next, /^Follow the implement/);
  const build = {
    ...planData("2"),
    pages: [
      { id: "step-1", title: "Step 1", html: "<p>Built.</p>" },
      { id: "pr", title: "Pull request", html: "<p>The description.</p>" },
    ],
  };
  assert.equal((await a.publish(build)).code, 200);
  const status = (await a.status()).body;
  assert.equal(status.latestSubmissionRound, "1");
  assert.equal(status.current.round, "2");
  assert.equal(status.stage, "updated");
});

test("the holder's start resumes an unread Save, and builds the plan once it is read", async (t) => {
  const h = await hub(t);
  const a = await h.session("holder");
  await a.publish(planData("1", "plan"));
  const save = a.event("accept", "1", { offer: "plan", action: "save" });
  assert.equal((await a.feedback(save)).code, 200);
  const start = () =>
    a.request(
      "/agent/register",
      {
        sessionDir: a.directory,
        wake: { harness: "codex", thread: "thread-holder" },
        start: true,
      },
      { authorization: `Bearer ${h.record.secret}` },
    );
  // A holder whose turn was interrupted before it read the Save runs start
  // again, reads the Save and says the handoff line.
  const resumed = await start();
  assert.equal(resumed.code, 200);
  assert.equal((await a.status()).body.stage, "saved");
  const read = (await a.action("read")).body;
  assert.equal(read.event.payload.action, "save");
  assert.match(read.next, /^Round 1 is saved for later, as the save action/);
  // The same agent given the line later, such as a new conversation in the
  // same Claude Code process, builds the plan.
  const built = await start();
  assert.match(built.body.next, /^Round 1 was saved for later, and you now/);
  const status = (await a.status()).body;
  assert.equal(status.stage, "working");
  assert.equal(status.latestSubmissionRound, "1");
  assert.equal(status.takeover, null);
  assert.match(
    (await a.action("ack")).body.next,
    /^Round 1 was saved for later, and you are building it now\. Build it as the implement action in \S+\/plan\.md describes\.$/,
  );
});
