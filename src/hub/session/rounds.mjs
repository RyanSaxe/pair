import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  assemble,
  frameBundle,
  pageScripts,
  pageStyles,
} from "../../build/assemble.mjs";
import { linkProblems } from "../../build/lint.mjs";
import { choiceText } from "../../shared/choices.mjs";
import {
  idPattern,
  orderAgreements,
  pageData,
  pageList,
  roundPattern,
  sourceItem,
} from "../../shared/records.mjs";
import {
  atomic,
  embedConfig,
  json,
  jsonScript,
  read,
  requireValue,
  timestamp,
} from "../../shared/util.mjs";

// Publishing a round's pages, and reading the rounds a session keeps.
export function rounds(session) {
  const { directory, origin, base, transition, events, pending, view } =
    session;
  async function resolvePageAgreements(entries) {
    for (const entry of entries) {
      delete entry.sourceRecords;
      if (!entry.sourceRefs) continue;
      entry.sourceRecords = [];
      for (const ref of entry.sourceRefs) {
        if (ref.kind === "conversation") {
          entry.sourceRecords.push({ kind: ref.kind, text: ref.text });
          continue;
        }
        if (ref.kind === "thread") {
          entry.sourceRecords.push(
            threadRecord(session.threadSource(ref.threadId)),
          );
          continue;
        }
        const event = events.find((item) => item.id === ref.submissionId);
        requireValue(event, "Source submission not found");
        const item = sourceItem(event.payload, ref);
        requireValue(
          item && typeof item.topic === "string",
          "Source item not found",
        );
        const text = ref.kind === "choice" ? choiceText(item) : item.text;
        const label = ref.kind === "note" ? item.anchor : item.label;
        requireValue(
          typeof text === "string" && typeof label === "string",
          "Source item has invalid content",
        );
        const target =
          typeof item.target === "string" && idPattern.test(item.target)
            ? item.target
            : null;
        const payload = event.payload;
        requireValue(
          idPattern.test(payload.name || "") &&
            roundPattern.test(payload.round || ""),
          "Invalid source round",
        );
        const href = `./${payload.name}.${payload.round}.html${target ? "?target=" + encodeURIComponent(target) : ""}#${encodeURIComponent(item.topic)}`;
        entry.sourceRecords.push({
          kind: ref.kind,
          submissionId: ref.submissionId,
          text,
          label,
          topic: item.topic,
          name: payload.name,
          round: payload.round,
          href,
          ...(target ? { target } : {}),
          ...(ref.kind === "choice" ? { choice: item } : {}),
          ...(typeof item.quote === "string" ? { quote: item.quote } : {}),
          ...(Number.isInteger(item.occurrence) && item.occurrence > 1
            ? { occurrence: item.occurrence }
            : {}),
        });
      }
    }
  }
  // A thread settles a decision as a note does, and Agreed links to the
  // block it is on.
  function threadRecord(thread) {
    const href = `./${thread.name}.${thread.round}.html${thread.target ? "?target=" + encodeURIComponent(thread.target) : ""}#${encodeURIComponent(thread.topic)}`;
    return {
      kind: "thread",
      threadId: thread.id,
      text: thread.messages[0].text,
      label: thread.anchor,
      topic: thread.topic,
      name: thread.name,
      round: thread.round,
      href,
      ...(thread.target ? { target: thread.target } : {}),
      ...(thread.quote ? { quote: thread.quote } : {}),
      ...(thread.occurrence ? { occurrence: thread.occurrence } : {}),
    };
  }
  const storedPagePath = (set, file) =>
    path.join(directory, "pages", set.round, path.basename(file));
  async function renderPageRound(set, complete) {
    const bundle = await read(storedPagePath(set, set.bundlePath));
    const agreed = await read(storedPagePath(set, set.agreed));
    const records = await Promise.all(
      set.pages
        .filter((slot) => slot.recordPath)
        .map((slot) => read(storedPagePath(set, slot.recordPath))),
    );
    const ready = new Map(
      records.map((record) => [record.page.id, record.page]),
    );
    const pages = set.pages.map((slot) => ({
      id: slot.id,
      title: slot.title,
      html: ready.get(slot.id)?.html || "",
      pending: !slot.recordPath,
      working: slot.state === "active",
    }));
    const all = [agreed.page, ...records.map((record) => record.page)];
    const data = {
      name: set.name,
      round: set.round,
      title: set.title,
      ...(complete ? {} : { pageMode: "partial" }),
      pages,
      agreements: agreed.page.agreements,
      task: agreed.page.task,
      prototypes: all.flatMap((page) => page.prototypes || []),
    };
    return assemble(data, {
      css: pageStyles(all, set.round),
      js: pageScripts(all, set.round),
      // Each page's links were checked when it published, and a page
      // published before that check must not keep its round from completing.
      allowUnknownPages: true,
      bundle,
    });
  }
  async function commitPageRound(set, source = null) {
    const complete = set.pages.every((slot) => slot.recordPath);
    let current = session.state.current;
    if (!current || current.round !== set.round || complete) {
      let html;
      try {
        html = await renderPageRound(set, complete);
      } catch (error) {
        error.statusCode ||= 400;
        throw error;
      }
      const stored = embedConfig(html, {
        sessionId: session.state.sessionId,
        base,
      });
      const name = complete
        ? `${set.name}.${set.round}.html`
        : `${set.name}.${set.round}.live.html`;
      const file = path.join(directory, "rounds", name);
      await atomic(file, stored);
      current = {
        name: set.name,
        round: set.round,
        title: set.title,
        path: file,
        url: base + "/",
        sha256: crypto.createHash("sha256").update(stored).digest("hex"),
        publishedAt: timestamp(),
        source,
      };
    }
    const rounds = complete
      ? [
          ...(session.state.rounds || []),
          {
            name: set.name,
            round: set.round,
            title: set.title,
            publishedAt: current.publishedAt,
            url: `${base}/r/${encodeURIComponent(set.round)}`,
          },
        ]
      : session.state.rounds || [];
    await transition({
      ...session.report(),
      openRound: complete ? null : set,
      roundPages: { ...(session.state.roundPages || {}), [set.round]: set },
      pageSetGeneration: set.generation,
      stage: complete ? "updated" : "working",
      current,
      title: set.title,
      rounds,
    });
    // The hub served the open round from the live file while its pages
    // arrived, and serves the complete file from now on. The round waits
    // for the reviewer, and every pair tab's bell says so.
    if (complete) {
      await fs.rm(
        path.join(directory, "rounds", `${set.name}.${set.round}.live.html`),
        { force: true },
      );
      await session.addActivity({ kind: "waiting", round: set.round });
    }
    return {
      status: view(),
      url: origin + current.url,
      roundComplete: complete,
      next: await session.nextStep(),
    };
  }
  async function publishPage(html, source, pages) {
    requireValue(
      !(await pending()).length,
      "Read pending feedback before publishing",
      409,
    );
    requireValue(
      ["ready", "working"].includes(session.state.stage),
      "Read feedback before publishing a page",
      409,
    );
    requireValue(
      source === undefined ||
        (typeof source === "string" &&
          path.resolve(source).startsWith(directory + path.sep)),
      "Source must be a directory inside the session directory",
    );
    requireValue(
      jsonScript("session-config").test(html),
      "HTML requires a session-config JSON script",
    );
    requireValue(
      jsonScript("page-data").test(html),
      "HTML requires a page-data JSON script",
    );
    const record = pageData(html);
    const { page } = record;
    requireValue(
      page.id === "agreed" || pages === undefined,
      "--pages is only valid when publishing Agreed",
    );
    let set;
    if (page.id === "agreed") {
      const slots = pageList(pages);
      requireValue(
        !session.state.openRound,
        "Agreed is already published for this round",
        409,
      );
      requireValue(
        !(session.state.rounds || []).some(
          (item) => item.round === record.round,
        ),
        `Round ${record.round} is already used`,
        409,
      );
      // pages.md makes the name a stable ID for the whole session.
      requireValue(
        !session.state.current || record.name === session.state.current.name,
        `This session's plan is named ${session.state.current?.name}. Keep that name in every round.`,
        409,
      );
      await resolvePageAgreements(page.agreements);
      const previous = session.state.roundPages?.[session.state.current?.round];
      orderAgreements(
        page.agreements,
        previous?.agreed
          ? (await read(storedPagePath(previous, previous.agreed))).page
              .agreements
          : [],
      );
      set = {
        name: record.name,
        round: record.round,
        title: record.title,
        agreed: null,
        pages: slots,
        bundlePath: null,
        generation: 1,
      };
    } else {
      requireValue(
        session.state.openRound,
        "Publish Agreed before other pages",
        409,
      );
      set = structuredClone(session.state.openRound);
      requireValue(
        ["name", "round", "title"].every((key) => record[key] === set[key]),
        "Page does not match this round",
        409,
      );
      const slot = set.pages?.find((item) => item.id === page.id);
      requireValue(
        slot && slot.title === page.title,
        "Page is not in this round's list",
        409,
      );
      requireValue(!slot.recordPath, "Page is already published", 409);
      // Agreed's list names every page of the round, so a page's links are
      // checked as it publishes. A bad link found only when the round
      // completes would sit in a page that can no longer change.
      const badLinks = linkProblems(
        page.html || "",
        `page "${page.id}"`,
        new Set([...set.pages.map((item) => item.id), "agreed", "feedback"]),
      );
      requireValue(!badLinks.length, badLinks.join("\n"));
      const used = new Set();
      for (const file of [
        set.agreed,
        ...set.pages
          .filter((item) => item.recordPath)
          .map((item) => item.recordPath),
      ])
        for (const item of (await read(storedPagePath(set, file))).page
          .prototypes || [])
          used.add(item.id);
      requireValue(
        !(page.prototypes || []).some((item) => used.has(item.id)),
        "Prototype ID is already used in this round",
        409,
      );
    }
    const opening = page.id === "agreed" && !session.state.current;
    const recordDir = path.join(directory, "pages", record.round);
    await fs.mkdir(recordDir, { recursive: true, mode: 0o700 });
    const recordPath = path.join(
      recordDir,
      `${page.id}.${crypto.randomUUID()}.json`,
    );
    const recordBytes = json(record);
    await fs.writeFile(recordPath, recordBytes, { mode: 0o600, flag: "wx" });
    const version = crypto
      .createHash("sha256")
      .update(recordBytes)
      .digest("hex");
    let result;
    try {
      if (page.id === "agreed") {
        set.agreed = recordPath;
        set.agreedVersion = version;
        set.agreedAt = timestamp();
        // The round keeps the frame it started with, so an update to
        // pair mid-round cannot mix two frames in one built file.
        set.bundlePath = path.join(
          recordDir,
          `frame.${crypto.randomUUID()}.json`,
        );
        await fs.writeFile(set.bundlePath, json(await frameBundle()), {
          mode: 0o600,
          flag: "wx",
        });
      } else {
        const slot = set.pages.find((item) => item.id === page.id);
        slot.recordPath = recordPath;
        slot.state = "ready";
        delete slot.note;
        slot.version = version;
        set.generation++;
      }
      result = await commitPageRound(set, source);
      if (opening)
        result.next = `${session.browserLine(result.url)} Then: ${result.next}`;
    } catch (error) {
      // A publish that fails leaves the round's files as they were, so no
      // record or frame of a page that never published stays behind.
      await fs.rm(recordPath, { force: true });
      if (page.id === "agreed" && set.bundlePath)
        await fs.rm(set.bundlePath, { force: true });
      throw error;
    }
    return {
      ...result,
      moment:
        page.id === "agreed"
          ? "publish-agreed"
          : result.roundComplete
            ? "publish-last-page"
            : "publish-page",
      page: {
        id: page.id,
        round: record.round,
        version,
        recordPath,
      },
    };
  }
  async function pageProgress(data) {
    requireValue(
      session.state.openRound && session.state.stage === "working",
      "Publish Agreed first",
      409,
    );
    const set = structuredClone(session.state.openRound);
    requireValue(
      Array.isArray(data.start) && data.start.length > 0,
      "Name each page with --page ID. Publishing a page marks it done.",
    );
    for (const id of data.start) {
      const slot = set.pages.find((item) => item.id === id);
      requireValue(
        slot && !slot.recordPath,
        `Unknown or ready page ${id}`,
        409,
      );
      slot.state = "active";
      slot.startedAt ??= timestamp();
    }
    set.generation++;
    return commitPageRound(set);
  }
  function roundEntry(round) {
    const entry = (session.state.rounds || []).find(
      (item) => item.round === round,
    );
    if (entry)
      return {
        ...entry,
        path: path.join(
          directory,
          "rounds",
          `${entry.name}.${entry.round}.html`,
        ),
      };
    if (session.state.current?.round === round) return session.state.current;
    return null;
  }
  function pageSet(round) {
    requireValue(roundPattern.test(round || ""), "Invalid round");
    const set = session.state.roundPages?.[round];
    requireValue(set, "Unknown round", 404);
    return {
      round,
      generation: set.generation,
      complete: set.pages.every((slot) => slot.recordPath),
      pages: [
        {
          id: "agreed",
          title: "Agreed so far",
          state: "ready",
          version: set.agreedVersion,
        },
        ...set.pages.map(({ id, title, state, version }) => ({
          id,
          title,
          state,
          version,
        })),
      ],
    };
  }
  async function pageRecord(round, id, version) {
    const manifest = pageSet(round);
    requireValue(
      idPattern.test(id || "") && /^[0-9a-f]{64}$/.test(version || ""),
      "Invalid page or version",
    );
    const slot = manifest.pages.find((item) => item.id === id);
    requireValue(slot && slot.version === version, "Unknown page version", 404);
    const set = session.state.roundPages[round];
    return read(
      storedPagePath(
        set,
        id === "agreed"
          ? set.agreed
          : set.pages.find((item) => item.id === id).recordPath,
      ),
    );
  }
  async function prototype(round, id) {
    requireValue(idPattern.test(id || ""), "Invalid prototype ID");
    const manifest = pageSet(round);
    for (const slot of manifest.pages.filter((item) => item.version)) {
      const record = await pageRecord(round, slot.id, slot.version);
      const item = record.page.prototypes?.find((entry) => entry.id === id);
      if (item) return item;
    }
    requireValue(false, "Unknown prototype", 404);
  }
  return {
    publishPage,
    pageProgress,
    roundEntry,
    pageSet,
    pageRecord,
    prototype,
  };
}
