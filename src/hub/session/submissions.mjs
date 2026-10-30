import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { idPattern } from "../../shared/records.mjs";
import { exists, read, requireValue, timestamp } from "../../shared/util.mjs";
import { message } from "./proposal-fields.mjs";

// A submission from a tab opened before pair offered the next-round choice
// has no next, and nextOf treats it as iterate.
export const nextChoices = ["iterate", "plan", "build"];
export const nextOf = (payload) => payload.next ?? "iterate";

export function submissions(session) {
  const { directory, transition, sameRound, exclusive } = session;
  function withDrawingPaths(event) {
    const answers = event.payload.groups?.answers;
    if (
      !answers ||
      !Object.values(answers).some((item) => item.kind === "drawing")
    )
      return event;
    const mapped = Object.fromEntries(
      Object.entries(answers).map(([key, answer]) => [
        key,
        answer.kind === "drawing"
          ? {
              ...answer,
              scenePath: path.join(
                directory,
                "scenes",
                `${answer.sceneId}.excalidraw`,
              ),
              previewPath: path.join(
                directory,
                "uploads",
                `${answer.previewId}.png`,
              ),
            }
          : answer,
      ]),
    );
    return {
      ...event,
      payload: {
        ...event.payload,
        groups: { ...event.payload.groups, answers: mapped },
      },
    };
  }
  async function submit(data) {
    // A tab opened before the session closed can still post, and a submission
    // would reopen the session and wake an agent that has finished.
    requireValue(
      session.state.stage !== "complete",
      "This session is closed",
      409,
    );
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    requireValue(
      idPattern.test(data.id || "") &&
        typeof data.text === "string" &&
        data.text.trim(),
      "Submission requires ID and text",
    );
    requireValue(data.intent === "feedback-only", "Invalid submission intent");
    requireValue(
      data.next === undefined || nextChoices.includes(data.next),
      `next is one of ${nextChoices.join(", ")}`,
    );
    message(data);
    requireValue(
      data.groups &&
        typeof data.groups === "object" &&
        !Array.isArray(data.groups),
      "groups must be an object",
    );
    // The notes loop below replaces each note's attachments with the hub's
    // record of them, so submit copies the groups first for draftSent to
    // compare with the draft.
    const sent = structuredClone({ groups: data.groups });
    if (data.groups.alignUnflagged !== undefined)
      requireValue(
        typeof data.groups.alignUnflagged === "boolean",
        "alignUnflagged must be a boolean",
      );
    if (data.groups.answers !== undefined) {
      requireValue(
        data.groups.answers &&
          typeof data.groups.answers === "object" &&
          !Array.isArray(data.groups.answers),
        "answers must be an object",
      );
      for (const answer of Object.values(data.groups.answers)) {
        if (answer?.kind === "drawing") {
          requireValue(
            ["label", "topic", "round", "sceneId", "previewId"].every(
              (key) => typeof answer[key] === "string" && answer[key],
            ),
            "Drawing answers require label, topic, round and both file IDs",
          );
          await session.readScene(answer.sceneId);
          const preview = await session.readUpload(answer.previewId);
          requireValue(
            preview.type === "image/png",
            "Drawing preview must be PNG",
          );
        } else
          requireValue(
            answer &&
              answer.kind === undefined &&
              ["label", "text", "topic"].every(
                (key) => typeof answer[key] === "string",
              ) &&
              answer.text.trim(),
            "Answers require label, text, and topic",
          );
      }
    }
    /* Each image belongs to the note it illustrates, and storedAttachment
       accepts only an image the hub stored for this session, so a
       submission cannot point the agent at a path the hub never wrote. */
    if (data.groups.notes !== undefined) {
      requireValue(Array.isArray(data.groups.notes), "notes must be an array");
      for (const note of data.groups.notes) {
        requireValue(
          note &&
            ["id", "topic", "anchor", "text"].every(
              (key) => typeof note[key] === "string",
            ) &&
            note.text.trim(),
          "Notes require id, topic, anchor and text",
        );
        requireValue(
          note.quote === undefined || typeof note.quote === "string",
          "A note's quote must be text",
        );
        if (note.attachments === undefined) continue;
        requireValue(
          Array.isArray(note.attachments),
          "A note's attachments must be an array",
        );
        const images = [];
        for (const item of note.attachments) {
          requireValue(
            item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              typeof item.type === "string" &&
              Number.isInteger(item.bytes),
            "An attachment needs id, path, type and bytes",
          );
          images.push(await session.storedAttachment(item));
        }
        note.attachments = images;
      }
    }
    const file = path.join(directory, "feedback", data.id + ".json");
    if (await exists(file)) {
      const original = await read(file);
      requireValue(
        isDeepStrictEqual(original.payload, data),
        "Submission ID already has different content",
        409,
      );
      return { id: data.id, saved: true, status: session.browserView() };
    }
    requireValue(
      sameRound(data),
      "Review the current round before submitting; export older drafts if needed",
      409,
    );
    requireValue(
      !session.state.openRound,
      "Finish every listed page before submitting feedback",
      409,
    );
    // A tab can send before its next status poll shows that another tab or
    // device sent this round's feedback. The agent acts on the first submission
    // as soon as the hub wakes it, so the hub keeps that one and refuses this
    // one.
    requireValue(
      session.state.latestSubmissionRound !== data.round,
      `Round ${data.round} already has feedback, so the hub did not save what you just sent. Your comments and message stay in your draft for the next round.`,
      409,
    );
    const event = await session.saveEvent(data);
    await session.draftSent(sent);
    await transition({
      stage: "submitted",
      latestSubmissionId: data.id,
      // The agent answers this submission with its next round, and the
      // frame shows the agent's progress until that round is complete.
      latestSubmissionRound: data.round,
      // The frame in every browser counts the agent's running time from
      // roundStartedAt.
      roundStartedAt: event.receivedAt,
      wake: session.state.wake ? { ...session.state.wake, last: null } : null,
      takeover: null,
      // With Build it, the reviewer approves the work, and the agent builds
      // it in this session from now on.
      ...(data.next === "build"
        ? {
            build: { round: data.round, submission: data.id, at: timestamp() },
          }
        : {}),
    });
    if (data.next === "build") await session.buildLinked();
    if (session.wake && !session.state.paused)
      setTimeout(() => exclusive(() => session.wakeAgent(data.round)), 0);
    return { id: data.id, saved: true, status: session.browserView() };
  }
  return { withDrawingPaths, submit };
}
