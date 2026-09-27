import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { actionOf, idPattern, offerFor } from "../../shared/records.mjs";
import { exists, read, requireValue } from "../../shared/util.mjs";

// Every event carries groups, which are often empty. An acceptance record
// keeps them only when they hold a note, a choice or an answer.
export function heldItems(groups) {
  return (
    Boolean(groups) &&
    ((Array.isArray(groups.notes) && groups.notes.length > 0) ||
      Object.keys(groups.choices || {}).length > 0 ||
      Object.keys(groups.answers || {}).length > 0)
  );
}
// What the reviewer sends: feedback and acceptances.
export function submissions(session) {
  const { directory, transition, pending, sameRound, exclusive, view } =
    session;
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
    requireValue(
      ["feedback-only", "accept"].includes(data.intent),
      "Invalid submission intent",
    );
    requireValue(
      data.groups &&
        typeof data.groups === "object" &&
        !Array.isArray(data.groups),
      "groups must be an object",
    );
    if (
      data.intent === "feedback-only" &&
      data.groups.alignUnflagged !== undefined
    )
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
    if (data.intent === "accept") {
      const accept = offerFor(data.offer)?.accept;
      requireValue(
        accept?.actions.some((action) => action.id === data.action),
        "An acceptance names an offer and one of its actions",
      );
      if (data.guidance !== undefined) {
        requireValue(
          data.action === accept.guidance.action &&
            typeof data.guidance === "string",
          `Only ${accept.guidance.action} takes guidance`,
        );
        data.guidance = data.guidance.trim();
        requireValue(
          data.guidance.length <= 4000,
          "Guidance exceeds 4,000 characters",
        );
        if (!data.guidance) delete data.guidance;
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
      return { id: data.id, saved: true, status: view() };
    }
    requireValue(
      sameRound(data),
      "Review the current round before submitting; export older drafts if needed",
      409,
    );
    if (data.intent === "accept") {
      requireValue(
        data.offer === session.state.current.offer,
        `Round ${session.state.current.round} does not offer ${data.offer}`,
        409,
      );
      requireValue(
        ["ready", "updated"].includes(session.state.stage) &&
          !(await pending()).length,
        "Resolve feedback before accepting the current round",
        409,
      );
    }
    requireValue(
      !session.state.openRound,
      "Finish every listed page before submitting feedback",
      409,
    );
    await session.saveEvent(data);
    const after = data.intent === "accept" ? actionOf(data).after : null;
    await transition({
      stage:
        after === "saved"
          ? "saved"
          : data.intent === "feedback-only" && session.state.stage === "working"
            ? "working"
            : "submitted",
      latestSubmissionId: data.id,
      // The round of a submission the agent answers with its next round.
      // The frame shows the agent's progress until that round is complete.
      latestSubmissionRound:
        data.intent === "feedback-only" || after === "round"
          ? data.round
          : null,
      wake: session.state.wake ? { ...session.state.wake, last: null } : null,
      accepted: null,
      takeover: null,
    });
    if (session.wake && !session.state.paused)
      setTimeout(() => exclusive(() => session.wakeAgent(data.round)), 0);
    return { id: data.id, saved: true, status: view() };
  }
  return { withDrawingPaths, submit };
}
