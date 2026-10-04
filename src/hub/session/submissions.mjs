import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { idPattern } from "../../shared/records.mjs";
import { exists, read, requireValue } from "../../shared/util.mjs";

// What the reviewer sends: feedback on a round.
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
      data.groups &&
        typeof data.groups === "object" &&
        !Array.isArray(data.groups),
      "groups must be an object",
    );
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
    /* Images hang off the note they illustrate, and a note may only name an
       image this session holds, so a submission cannot point the agent at a
       path the hub never wrote. */
    if (Array.isArray(data.groups.notes)) {
      for (const note of data.groups.notes) {
        if (note?.attachments === undefined) continue;
        requireValue(
          Array.isArray(note.attachments),
          "A note's attachments must be an array",
        );
        for (const item of note.attachments) {
          requireValue(
            item &&
              typeof item.id === "string" &&
              typeof item.path === "string" &&
              typeof item.type === "string" &&
              Number.isInteger(item.bytes),
            "An attachment needs id, path, type and bytes",
          );
          requireValue(
            await session.uploadName(item.id),
            `Image ${item.id} is not in this session`,
          );
        }
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
    const event = await session.saveEvent(data);
    await transition({
      stage: session.state.stage === "working" ? "working" : "submitted",
      latestSubmissionId: data.id,
      // The round of a submission the agent answers with its next round.
      // The frame shows the agent's progress until that round is complete.
      latestSubmissionRound: data.round,
      // Every browser counts the agent's running time from this.
      roundStartedAt: event.receivedAt,
      wake: session.state.wake ? { ...session.state.wake, last: null } : null,
      takeover: null,
    });
    if (session.wake && !session.state.paused)
      setTimeout(() => exclusive(() => session.wakeAgent(data.round)), 0);
    return { id: data.id, saved: true, status: session.browserView() };
  }
  return { withDrawingPaths, submit };
}
