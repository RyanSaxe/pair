import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { accepts, isClosed, lifecycle } from "../../shared/lifecycle.mjs";
import { proposalState } from "../../shared/proposal-state.mjs";
import { idPattern } from "../../shared/records.mjs";
import { atomic, read, requireValue, timestamp } from "../../shared/util.mjs";
import { adapters, identify, wakeRunner } from "../wake.mjs";
import { nextOf } from "./submissions.mjs";

// Only the reviewer's feedback answers a round. A Start leaves the round as
// it was, wherever its work runs.
export const answersRound = (event) => event.payload.intent !== "start";
const sameAgent = (a, b) => a?.harness === b?.harness && a?.id === b?.id;
export function agent(session) {
  const { directory, config, transition, pending, view } = session;
  const command = (name) => `pair ${name} --session-dir ${directory}`;
  const closed = "The reviewer closed this session. Stop working on it.";
  const handoff = `To take over pair session ${directory}, run ${command("start")} and follow what it prints.`;
  // The hub records every agent command as a report, and the frame shows
  // when the last report came. Only ack sends a note, so any other report
  // sets note to null. noteAt is the time of the last note, which the frame
  // shows beside the note under the progress card's title, so a report
  // without a note leaves noteAt as it was.
  const report = (note = null) => {
    const at = timestamp();
    const noteAt = note ? at : session.state.report?.noteAt;
    return { report: { at, note, ...(noteAt ? { noteAt } : {}) } };
  };
  const receive = (event) =>
    event && session.state.lastReceivedId !== event.id
      ? { lastReceivedId: event.id, receivedAt: timestamp() }
      : {};
  const startedHere = () =>
    session.proposalItems().filter((card) => proposalState(card) === "running");
  // Every agent command prints nextStep, so an agent that lost its place
  // learns where the session stands.
  async function nextStep() {
    return [
      await step(),
      session.unansweredLine(),
      session.finishedLine(),
      session.quietLine(),
    ]
      .filter(Boolean)
      .join("\n");
  }
  async function step() {
    if (isClosed(session.state)) return closed;
    const [event] = await pending();
    if (event) return `Run ${command("read")} to see what the reviewer sent.`;
    if (lifecycle(session.state) === "paused")
      return `You paused this session. Tell the reviewer, and when they ask you to continue, run ${command("start")}.`;
    if (!session.state.current)
      return "Publish Agreed with round 1's page list, using pair publish, within a few minutes and before you research or write any other page.";
    if (session.state.openRound) {
      const slots = session.state.openRound.pages.filter(
        (slot) => !slot.recordPath,
      );
      const left = slots.map((slot) =>
        slot.state === "active" ? `${slot.id} (started)` : slot.id,
      );
      // pair publish leaves a page started while pages are left, and reopen
      // marks every page not started.
      const none = slots.some((slot) => slot.state === "active")
        ? ""
        : " None of them has started, so run pair progress --page ID for the page you work on next.";
      return `You still have to publish these pages: ${left.join(", ")}.${none} When you begin any work a page will report, such as the code it describes or what it measures, and at least every five minutes while you or a subagent do that work, run pair progress --page ID --note "…". Publish each page with pair publish as soon as pair build has built it, with --start ID for the page you work on next while other pages are left.`;
    }
    if (session.stage() === "working")
      return "Edit Agreed's task and alignments to match this feedback. Then publish Agreed with the round's page list, using pair publish, within a few minutes and before you research or write any other page.";
    const { round } = session.state.current;
    // Work started here after the agent published this round's page list has
    // no page in the round, so the agent builds it now for the next round.
    const ids = startedHere()
      .filter((card) => card.started.round === round)
      .map((card) => card.id);
    if (session.needsYou() && ids.length) {
      const named =
        ids.length === 1
          ? `proposal ${ids[0]}`
          : `proposals ${ids.slice(0, -1).join(", ")} and ${ids.at(-1)}`;
      const its = ids.length === 1 ? "its" : "their";
      return `You published round ${round}, and the reviewer has not sent feedback on it yet. If you have not told the reviewer in the chat what changed, tell them now. Then build ${named}, which the reviewer approved for this session, and end your turn when you have done what you can. Update ${its} status each time you finish a part. When the reviewer sends feedback, the hub wakes you, and you publish the pages about this work in the next round.`;
    }
    return `You published round ${round}. If you have not told the reviewer in the chat what changed, tell them, then end your turn. The hub wakes you when the reviewer sends feedback.`;
  }
  // publishPage prints browserLine with a session's first Agreed. A pair tab
  // that polled the hub recently already lists the new session in its bell
  // and session list, so the agent opens a new tab only when no tab polled.
  const browserLine = (url) =>
    session.tabOpen()
      ? `The reviewer already has pair open in their browser. Give them the link ${url} in the chat, and do not open another tab.`
      : `Open ${url} in the reviewer's default browser (macOS open, Windows Start-Process, Linux xdg-open, with the URL quoted), and give them the link in the chat.`;
  // Every wake goes through sendWake, for a submission, a thread message or a
  // Start in parallel. sendWake also sets holder.steerable, which the frame
  // reads to show when the agent will read a message.
  async function sendWake(line) {
    let result;
    try {
      requireValue(session.wake, "The session has no agent to wake");
      result = (await wakeRunner(session.wake, line, session.config)) || {};
    } catch (error) {
      return { at: timestamp(), ok: false, reason: error.message };
    }
    if (result.steerable !== undefined && session.state.holder)
      await transition({
        holder: { ...session.state.holder, steerable: result.steerable },
      });
    return {
      at: timestamp(),
      ok: true,
      ...(result.via ? { via: result.via } : {}),
    };
  }
  // The wake for a send, the reviewer's feedback or a Start, records its
  // result in wake.last, which wakeState reads.
  async function wakeForSend(line) {
    const last = await sendWake(line);
    await transition({ wake: { harness: session.wake.harness, last } });
  }
  // submit schedules wakeAgent after it saves the submission, outside the
  // browser's request, so a slow or failing agent CLI never delays the
  // reviewer's Sent state.
  const wakeAgent = (round) =>
    wakeForSend(
      `pair: the reviewer sent feedback on round ${round} of session ${directory}. Run ${command("read")} first, which prints the feedback and your next step.`,
    );
  // The reviewer closes a session from the browser. The hub sends the agent
  // no wake, and act refuses the agent's next command with closed. close
  // deletes no file and leaves the round as it was.
  async function close() {
    await transition({ closedAt: timestamp() });
    await session.closeLinked();
    return { status: view() };
  }
  // No agent has worked on the open round since the session closed, so reopen
  // marks each started page as not started, and the progress card and the quiet
  // check do not count the time since the close.
  function restartPages() {
    if (!session.state.openRound) return {};
    const set = structuredClone(session.state.openRound);
    for (const slot of set.pages) {
      if (slot.state !== "active") continue;
      slot.state = "queued";
      delete slot.startedAt;
      delete slot.note;
      set.generation++;
    }
    return {
      openRound: set,
      roundPages: { ...session.state.roundPages, [set.round]: set },
      pageSetGeneration: set.generation,
    };
  }
  // pair start --reopen is the only command that undoes close. The reviewer
  // gives it to an agent, which can be a former holder, so reopen also removes
  // that agent's takeover notice, and requireHolder lets the agent start.
  //
  // Nothing from before the reopen notifies the reviewer on any device, also
  // for a session whose IDs the seen lists dropped at its close. reopen empties
  // the events first, and the transition that lists the session again records
  // the command of the agent that becomes the holder, which answers a failed
  // wake, so no poll announces them. The seen lists drop the keys of a session
  // that is not listed, so markSeen runs right after the transition, before
  // the hub handles another request.
  async function reopen(agent, holder) {
    await session.clearActivity();
    await transition({
      ...report(),
      ...restartPages(),
      closedAt: null,
      holder,
      formerHolders: (session.state.formerHolders || []).filter(
        (item) => !sameAgent(item, agent),
      ),
    });
    const { sessionId } = session.state;
    const { round, ids } = session.listing().readyPages;
    await session.markSeen({
      opened: ids.map((page) => `${sessionId}/${round}/${page}`),
      cards: session.proposalItems().map((card) => `${sessionId}/${card.id}`),
    });
    await session.reopenLinked();
  }
  // act runs this check for every command except pair status and pair
  // propose, and hold runs it for pair start. The first command from an agent
  // that lost the session fails with the time of the takeover, and
  // requireHolder removes that agent from formerHolders, so the agent stops
  // instead of publishing over its successor. After that, a command other
  // than start from any agent but the holder fails with the message to take
  // the session over with pair start if the reviewer asks.
  async function requireHolder(agent, start = false) {
    const clock = (at) => new Date(at).toTimeString().slice(0, 5);
    const former = (session.state.formerHolders || []).find((item) =>
      sameAgent(item, agent),
    );
    if (former) {
      await transition({
        formerHolders: session.state.formerHolders.filter(
          (item) => item !== former,
        ),
      });
      requireValue(
        false,
        `Another agent took this session over at ${clock(former.until)}. Stop working on it.`,
        409,
      );
    }
    if (
      !start &&
      session.state.holder &&
      !sameAgent(session.state.holder, agent)
    )
      requireValue(
        false,
        `Another agent has run this session since ${clock(session.state.holder.at)}, so stop working on it. If the reviewer asks you to take it over, run ${command("start")}.`,
        409,
      );
  }
  // act and hold record the time of each command from the holder, which
  // wakeState and the quiet check read. A closed session has no wake to
  // answer, so a pair status there leaves its status.json as it was.
  const commandRan = () =>
    accepts(session.state, "change") &&
    transition({
      holder: { ...session.state.holder, commandAt: timestamp() },
    });
  // pair read lists each thread with a reviewer message since the
  // submission before the one it prints, or since the latest submission
  // when none is pending.
  function readAnswer(event, before) {
    return {
      threads: session.threadsSince(before?.receivedAt),
      threadsSince: before?.payload.round ?? null,
      ...(event
        ? { event: session.withDrawingPaths(event), ...eventRead(event) }
        : { event: null }),
    };
  }
  // Each choice for the next round has its own moment, except Keep
  // iterating, which needs none. On a plan round, iterate is the Back to
  // iterating choice, which has the read-iterate moment.
  function choiceMoment(payload) {
    const next = nextOf(payload);
    if (next !== "iterate") return `read-${next}`;
    return session.roundEntry(payload.round)?.plan ? "read-iterate" : null;
  }
  // pair read prints a Start with the card it started, so the agent reads
  // what the reviewer approved. It prints feedback with every card started
  // here that is not done, so the agent keeps building that work in the round
  // the feedback begins.
  function eventRead(event) {
    if (event.payload.intent !== "start")
      return {
        moment: ["read-feedback", choiceMoment(event.payload)].filter(Boolean),
        running: startedHere(),
      };
    return {
      moment: `read-start-${event.payload.where}`,
      proposal: session
        .proposalItems()
        .find((card) => card.id === event.payload.proposal),
    };
  }
  const submissionBefore = (sequence = Infinity) =>
    session.events
      .filter((item) => item.sequence < sequence)
      .sort((a, b) => b.sequence - a.sequence)[0];
  async function readFeedback(data) {
    // With an id, readFeedback returns that submission again and changes
    // nothing, for an agent turn that resumes after an interruption.
    if (data.id !== undefined) {
      requireValue(
        idPattern.test(data.id || "") &&
          session.events.some((item) => item.id === data.id),
        `This session has no submission ${data.id}. Give --submission the ID of a submission that pair read printed.`,
        404,
      );
      const event = await read(
        path.join(directory, "feedback", data.id + ".json"),
      );
      return {
        status: view(),
        ...readAnswer(event, submissionBefore(event.sequence)),
        next: await nextStep(),
      };
    }
    const [event] = await pending();
    const declined = await session.reportDeclined();
    const closed = await session.reportClosed();
    if (!event)
      return {
        status: view(),
        ...readAnswer(null, submissionBefore()),
        declined,
        closed,
        next: await nextStep(),
      };
    const patch = {
      ...report(),
      ...receive(event),
      acknowledged: [...session.state.acknowledged, event.id],
      acknowledgedAt: timestamp(),
      lastAcknowledgedId: event.id,
    };
    await transition(patch);
    const { proposal, where } = event.payload;
    return {
      status: view(),
      ...readAnswer(event, submissionBefore(event.sequence)),
      declined,
      closed,
      next: await startNext(where, proposal),
    };
  }
  // A Start in a sub-session leaves this session's round as it was, so the
  // next step is the command that creates the sub-session.
  const startNext = async (where, id) =>
    where === "sub-session"
      ? `Run pair start --from ${directory} --proposal ${id}, then follow what it prints.`
      : nextStep();
  async function ack(data) {
    requireValue(
      data.note === undefined ||
        (typeof data.note === "string" && data.note.trim().length <= 80),
      "A progress note is text of at most 80 characters",
    );
    requireValue(
      data.page === undefined || Boolean(data.note?.trim()),
      "A note on a page takes its text with --note",
    );
    const [event] = await pending();
    await transition(
      data.page === undefined
        ? { ...report(data.note?.trim() || null), ...receive(event) }
        : {
            ...session.notePage(data.page, data.note.trim()),
            // A page note updates only the report's time, and ack leaves the
            // note under the card's title and its noteAt as they were.
            report: { ...session.state.report, at: timestamp() },
            ...receive(event),
          },
    );
    return {
      status: view(),
      received: event ? { id: event.id, intent: event.payload.intent } : null,
      next: await nextStep(),
    };
  }
  async function pause(data) {
    requireValue(
      typeof data.reason === "string" && data.reason.trim(),
      "pause requires a reason",
    );
    await transition({
      paused: { at: timestamp(), reason: data.reason.trim() },
    });
    return { status: view(), next: await nextStep() };
  }
  const actions = {
    status: async (data) => ({
      status: view(),
      ...(sameAgent(session.state.holder, data.agent)
        ? { next: await nextStep() }
        : {}),
    }),
    read: readFeedback,
    ack,
    progress: (data) => session.pageProgress(data),
    pause,
    publish: (data) => session.publishPage(data),
    reply: (data) => session.reply(data),
    // When the agent starts work with a new agent on the reviewer's words,
    // nothing runs until another agent runs pair start --from, as after Open
    // a new agent session. When the holder starts work here or in a
    // sub-session, the hub saves nothing for pair read, so propose returns
    // the moment and the joined cards that pair read prints for any other
    // Start.
    propose: async (data) => {
      const holder = sameAgent(session.state.holder, data.agent);
      const proposal = await session.propose(data, holder);
      const parent = session.cardOwner(proposal.id, "pair propose");
      const next =
        data.start === "new-agent"
          ? `Open a new agent session and have it run pair start --from ${directory} --proposal ${proposal.id} first. If you cannot open one, give the reviewer that command in the chat. Then go back to what you were doing.`
          : await startNext(data.start, proposal.id);
      const own = holder && ["here", "sub-session"].includes(data.start);
      return {
        sessionId: session.state.sessionId,
        proposal,
        ...(own
          ? {
              moment: `read-start-${data.start}`,
              joined: session.joinedInto(proposal.id),
            }
          : {}),
        ...(parent ? { parent: { id: parent.id, title: parent.title() } } : {}),
        ...(holder ? { next } : {}),
      };
    },
  };
  // pi, opencode and Copilot keep their identity when they restart and then
  // listen on a new socket or port. Each command sends the agent's current
  // wake target, and the hub wakes the holder at the one its latest command
  // sent. Like hold, refreshTarget keeps the target in wake.json only.
  async function refreshTarget(target) {
    if (
      !target ||
      typeof target !== "object" ||
      !Object.hasOwn(adapters, target.harness) ||
      !sameAgent(identify(target), session.state.holder) ||
      isDeepStrictEqual(target, session.wake)
    )
      return;
    await atomic(session.wakeFile, target);
    session.wake = target;
  }
  async function act({ wake, ...data }) {
    requireValue(
      data.sessionId === session.state.sessionId,
      "Wrong session",
      409,
    );
    // status only reads, so any agent, or none, can run it, also on a closed
    // session. Any agent can record a proposal, such as a subagent that finds
    // work worth doing.
    if (data.action !== "status") {
      requireValue(accepts(session.state, "change"), closed, 409);
      if (data.action !== "propose") await requireHolder(data.agent);
    }
    await refreshTarget(wake);
    requireValue(Object.hasOwn(actions, data.action), "Unknown agent action");
    if (sameAgent(session.state.holder, data.agent)) await commandRan();
    return actions[data.action](data);
  }
  // pair start makes its agent the holder, the one agent the hub wakes. Any
  // other registration, such as a command that reattaches to a new hub,
  // changes nothing when it comes from an agent other than the holder, and
  // it leaves a paused session paused, because only pair start resumes one.
  async function hold(target, options = {}) {
    const start = options.start === true;
    const { created } = options;
    const title = typeof options.title === "string" && options.title.trim();
    const agent = identify(target);
    const held = session.state.holder;
    const same = sameAgent(held, agent);
    // act then runs or refuses the command. Without this return, a former
    // holder's pair status would make requireHolder use up its takeover
    // notice.
    if (!start && held && !same) return {};
    const at = timestamp();
    const holder = { ...(same ? held : { ...agent, at }), commandAt: at };
    const reopening =
      start && options.reopen === true && accepts(session.state, "reopen");
    if (reopening) await reopen(agent, holder);
    await requireHolder(agent, start);
    const resuming = start && lifecycle(session.state) === "paused";
    await atomic(session.wakeFile, target);
    session.wake = target;
    const patch = {
      wake: { harness: target.harness, last: session.state.wake?.last || null },
      holder,
      ...(start ? { paused: null } : {}),
      // title() returns this title until the first Agreed publishes, and
      // then returns Agreed's title.
      ...(created && title ? { title } : {}),
    };
    // The frame shows takeover on the reviewer's progress card until submit
    // clears it.
    if (!same && held)
      Object.assign(patch, report(), {
        takeover: { name: adapters[agent.harness].name, at },
        formerHolders: [
          ...(session.state.formerHolders || []),
          { harness: held.harness, id: held.id, until: at },
        ],
      });
    await transition(patch);
    if (resuming) await session.heldSent();
    if (start && !held && !session.state.current)
      await session.addActivity({
        kind: "session",
        agent: adapters[target.harness].name,
      });
    if (start && created)
      return {
        moment: session.state.parent
          ? ["start", session.plansFirst() ? "start-from-plan" : "start-from"]
          : "start",
        next: await nextStep(),
      };
    const next = start && (await nextStep());
    if (!next) return {};
    const moment = reopening ? { moment: "start-reopen" } : {};
    if (same) return { next, ...moment };
    // An agent that takes the session over may never have run pair guide,
    // and it has not read the feedback that the previous holder read. An open
    // round answers that feedback. With stage "working" and no open round, the
    // next round answers it, because the previous holder read it and has not
    // published Agreed yet.
    const answers = session.state.openRound
      ? "This round answers"
      : session.stage() === "working" && "The next round answers";
    const answered = answers && session.state.latestSubmissionId;
    const feedback = answered
      ? ` ${answers} the reviewer's feedback in submission ${answered}, which the previous agent read. Run ${command("read")} --submission ${answered} to read it.`
      : "";
    return {
      next: `If you have not run pair guide in this conversation, run it first.${feedback} ${next}`,
      ...moment,
    };
  }
  return {
    handoff,
    report,
    nextStep,
    browserLine,
    sendWake,
    wakeForSend,
    wakeAgent,
    close,
    act,
    hold,
  };
}
