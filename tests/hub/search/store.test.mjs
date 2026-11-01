import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { searchStore } from "../../../src/hub/search/store.mjs";
import { hub, planData } from "../../support/hub.mjs";

const patch = [
  "--- a/retry.mjs",
  "+++ b/retry.mjs",
  "@@ -1,1 +1,1 @@",
  "-export const attempts = 3;",
  "+export const attempts = quokkaLimit;",
  "",
].join("\n");
// The whole files go in the page too, and only the patch is searchable.
const diffInput = JSON.stringify({
  before: "export const attempts = 3;\nconst untouchedMarmot = 1;\n",
  after: "export const attempts = quokkaLimit;\nconst untouchedMarmot = 1;\n",
  patch,
})
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;");
const pageHtml = `
<h2>Failure handling</h2>
<p>Retries use exponential backoff.</p>
some loose top-level words
<section class="change-review" data-kind="diff">
  <textarea data-diff-input hidden>${diffInput}</textarea>
  <div class="change-view"></div>
</section>
<pre data-language="js">const walrus = open();</pre>
<section class="visual-decision" data-choice="place" data-label="Place">
  <h3>Where should it go?</h3>
  <article class="visual-option" data-value="left" data-label="Left"><p>Beside the capybara.</p></article>
  <article class="visual-option" data-value="right" data-label="Right"><p>Beside the narwhal.</p></article>
</section>
<figure><img alt="A drawing of a pangolin" src="data:image/png;base64,${"A".repeat(2000)}" /></figure>`;

// A real hub writes each file search reads, so these tests read the format the
// hub writes rather than a copy of it.
async function session(t) {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    agreements: [
      {
        id: "scope",
        title: "Scope of the ocelot work",
        html: "<p>The ocelot stays out.</p>",
        sourceRefs: [{ kind: "conversation", text: "Said in chat." }],
      },
    ],
    pages: [{ id: "overview", title: "The lemur page", html: pageHtml }],
  });
  assert.equal(published.code, 200, published.body.error);
  return { h, a };
}

async function pageSession(t, html, { page, ...plan } = {}) {
  const h = await hub(t);
  const a = await h.session();
  const published = await a.publish({
    ...planData(),
    pages: [{ id: "overview", title: "Overview", html, ...page }],
    ...plan,
  });
  assert.equal(published.code, 200, published.body.error);
  return a;
}

async function reader(t, a) {
  const store = searchStore();
  t.after(() => store.close());
  await store.add(a.id, a.directory);
  return store;
}

const thread = (a, extra = {}) =>
  a.request(`${a.base}/api/threads`, {
    id: crypto.randomUUID(),
    round: "1",
    topic: "overview",
    anchor: "Failure handling",
    target: "block-overview-1",
    text: "Does the wombat retry?",
    ...extra,
  });

test("search finds each part of a page in its block, as the frame numbers blocks", async (t) => {
  const { a } = await session(t);
  const store = await reader(t, a);
  for (const [query, block] of [
    ["exponential backoff", 1],
    ["quokkaLimit", 2],
    ["walrus", 3],
    ["narwhal", 4],
    ["pangolin", 5],
  ]) {
    const { results } = await store.search({ query });
    assert.equal(results[0]?.block, block, query);
    assert.equal(results[0].page, "overview", query);
    assert.equal(results[0].pageTitle, "The lemur page", query);
    assert.equal(results[0].round, "1", query);
    assert.equal(results[0].kind, "pages", query);
  }
  assert.equal((await store.search({ query: "untouchedMarmot" })).total, 0);
  const loose = (await store.search({ query: "loose top-level" })).results[0];
  assert.equal(loose.block, null);
  assert.equal(
    (await store.search({ query: "backoff" })).results[0].heading,
    "Failure handling",
  );
});

test("search reads titles, Agreed, threads, feedback, proposals and the draft", async (t) => {
  const { a } = await session(t);
  assert.equal((await thread(a)).code, 201);
  const event = a.event("feedback-only", "1", {
    message: "Ship the toucan first.",
    groups: {
      notes: [
        {
          id: "n1",
          round: "1",
          topic: "overview",
          anchor: "Failure handling",
          text: "Rename the iguana.",
        },
      ],
      answers: {
        "overview/q1": {
          round: "1",
          topic: "overview",
          label: "Which one?",
          text: "The axolotl one.",
        },
      },
      choices: {
        "overview/place": {
          round: "1",
          topic: "overview",
          label: "Place",
          value: "right",
          valueLabel: "Right of the okapi",
        },
      },
    },
  });
  assert.equal((await a.feedback(event)).code, 200);
  const proposed = await a.action("propose", {
    id: "tapir-work",
    title: "Teach the tapir",
    delivers: "A tapir that can swim.",
    why: "It sinks.",
    recommend: "here",
    agent: a.agent,
  });
  assert.equal(proposed.code, 200, proposed.body.error);
  const drafted = await a.request(`${a.base}/api/draft`, {
    changes: {
      "note/d1": {
        id: "d1",
        round: "1",
        topic: "overview",
        anchor: "Failure handling",
        text: "Still thinking about the gecko.",
      },
    },
  });
  assert.equal(drafted.code, 200, drafted.body.error);
  const store = await reader(t, a);
  for (const [query, kind, fields] of [
    ["lemur", "pages", { type: "page title", block: 0, round: "1" }],
    ["ocelot", "agreed", { item: "scope", page: "agreed", round: "1" }],
    ["wombat", "threads", { block: 1, from: "reviewer", page: "overview" }],
    ["toucan", "notes", { type: "send message", page: "feedback" }],
    ["iguana", "notes", { type: "note", item: "n1" }],
    ["axolotl", "answers", { type: "typed answer" }],
    ["okapi", "answers", { type: "chosen option" }],
    ["tapir", "proposals", { item: "tapir-work", page: "work" }],
    ["gecko", "notes", { draft: true }],
  ]) {
    const { results } = await store.search({ query, kinds: [kind] });
    assert.ok(results[0], query);
    for (const [key, value] of Object.entries(fields))
      assert.equal(results[0][key], value, `${query} ${key}`);
  }
});

test("search never reads a session's secrets", async (t) => {
  const { a } = await session(t);
  const store = await reader(t, a);
  assert.equal((await store.search({ query: a.connection.token })).total, 0);
  await store.close();
  const cache = await fs.readFile(
    path.join(a.directory, "search.jsonl"),
    "utf8",
  );
  assert.ok(!cache.includes(a.connection.token));
  assert.ok(!cache.includes(a.inbox.token));
});

test("a copy across rounds is one row at the newest round", async (t) => {
  const { a } = await session(t);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const next = await a.publish({
    ...planData("2"),
    pages: [
      {
        id: "overview",
        title: "The lemur page",
        html: "<h2>Failure handling</h2><p>Retries use exponential backoff.</p><p>Something new.</p>",
      },
    ],
  });
  assert.equal(next.code, 200, next.body.error);
  const store = await reader(t, a);
  const { results } = await store.search({ query: "exponential backoff" });
  const rows = results.filter((row) => row.kind === "pages");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].round, "2");
  assert.deepEqual(rows[0].also, ["1"]);
});

test("a result names its page's title even when another page shares that title", async (t) => {
  const { a } = await session(t);
  assert.equal((await a.feedback(a.event())).code, 200);
  assert.equal((await a.action("read")).code, 200);
  const next = await a.publish({
    ...planData("2"),
    pages: [{ id: "renamed", title: "The lemur page", html: "<p>New.</p>" }],
  });
  assert.equal(next.code, 200, next.body.error);
  const store = await reader(t, a);
  const [row] = (await store.search({ query: "exponential backoff" })).results;
  assert.equal(row.page, "overview");
  assert.equal(row.pageTitle, "The lemur page");
  const titles = await store.search({ query: "lemur", kinds: ["pages"] });
  assert.deepEqual(
    titles.results
      .filter((result) => result.type === "page title")
      .map((result) => result.page)
      .sort(),
    ["overview", "renamed"],
  );
});

test("the cache stands in for a file until the file changes", async (t) => {
  const { a } = await session(t);
  const first = await reader(t, a);
  await first.close();
  const cacheFile = path.join(a.directory, "search.jsonl");
  const cached = await fs.readFile(cacheFile, "utf8");
  assert.ok(cached.includes("exponential"));
  // Only a read of the cache can find this word, because no session file has it.
  await fs.writeFile(cacheFile, cached.replaceAll("exponential", "bilby"));
  const second = await reader(t, a);
  assert.equal((await second.search({ query: "bilby" })).total, 1);
  await second.close();
  const folder = path.join(a.directory, "pages", "1");
  const name = (await fs.readdir(folder)).find((file) =>
    file.startsWith("overview."),
  );
  const file = path.join(folder, name);
  const record = await fs.readFile(file, "utf8");
  await fs.writeFile(file, record.replace("exponential", "linear quoll"));
  const third = await reader(t, a);
  assert.equal((await third.search({ query: "bilby" })).total, 0);
  assert.equal((await third.search({ query: "quoll" })).total, 1);
});

test("a change is found only after the session is marked changed", async (t) => {
  const { a } = await session(t);
  const store = await reader(t, a);
  assert.equal((await store.search({ query: "wombat" })).total, 0);
  assert.equal((await thread(a)).code, 201);
  assert.equal((await store.search({ query: "wombat" })).total, 0);
  store.markChanged(a.id);
  assert.equal((await store.search({ query: "wombat" })).total, 1);
});

test("a search during another search's read waits for that read", async (t) => {
  const { a } = await session(t);
  const store = await reader(t, a);
  assert.equal((await thread(a)).code, 201);
  store.markChanged(a.id);
  const first = store.search({ query: "" });
  assert.equal((await store.search({ query: "wombat" })).total, 1);
  await first;
});

test("few results add rows for missing words and for words across a page", async (t) => {
  const { a } = await session(t);
  const store = await reader(t, a);
  const wrongWord = await store.search({
    query: "exponential backoff zebra",
  });
  assert.equal(wrongWord.results[0].partial, "Has 2 of 3 words");
  assert.equal(wrongWord.results[0].block, 1);
  const acrossBlocks = await store.search({ query: "walrus narwhal" });
  assert.equal(acrossBlocks.results[0].partial, "All words on this page");
  assert.equal(acrossBlocks.results[0].page, "overview");
});

test("a block with every word ranks above a block that misses one", async (t) => {
  const a = await pageSession(
    t,
    "<p>The dugong swims in warm bays.</p><p>The dugong swims at night.</p>",
  );
  const store = await reader(t, a);
  const { results } = await store.search({ query: "dugong swims warm" });
  assert.deepEqual(
    results.map((row) => [row.block, row.partial]),
    [
      [0, null],
      [1, "Has 2 of 3 words"],
    ],
  );
});

test("a long block's row carries only the words around its match", async (t) => {
  const filler = "lorem ipsum ".repeat(400);
  const a = await pageSession(
    t,
    `<p>${filler} the dugong sleeps ${filler}</p>`,
  );
  const store = await reader(t, a);
  const [row] = (await store.search({ query: "dugong" })).results;
  assert.ok(row.text.length <= 600);
  const [[from, to]] = row.ranges;
  assert.equal(row.text.slice(from, to).toLowerCase(), "dugong");
});

test("a word only in an attribute ranks below a word on a block, and a row shows only words on the block", async (t) => {
  const a = await pageSession(
    t,
    `<x-card data-note="bandicoot">Visible words</x-card>
     <p>The bandicoot digs.</p>
     <x-card data-note="solo numbat"></x-card>
     <x-card data-note="first pika"></x-card>
     <x-card data-note="second pika"></x-card>`,
  );
  const store = await reader(t, a);
  const { results } = await store.search({ query: "bandicoot" });
  assert.deepEqual(
    results.map((row) => [row.block, row.text, row.ranges.length]),
    [
      [1, "The bandicoot digs.", 1],
      [0, "Visible words", 0],
    ],
  );
  // A block with no words on it has only its attributes to show.
  const [alone] = (await store.search({ query: "numbat" })).results;
  assert.equal(alone.block, 2);
  assert.equal(alone.text, "solo numbat");
  assert.deepEqual(
    alone.ranges.map(([from, to]) => alone.text.slice(from, to)),
    ["numbat"],
  );
  // Copies are told apart by exact comparison, which includes the attributes.
  assert.equal((await store.search({ query: "pika" })).total, 2);
});

test("attribute matches don't stop a search adding rows for few matches on blocks", async (t) => {
  const cards = Array.from(
    { length: 30 },
    (_, index) =>
      `<x-card data-note="zorilla genet mongoose ratel ${index}"></x-card>`,
  ).join("");
  const a = await pageSession(
    t,
    `${cards}<p>The zorilla met a genet and a rattel.</p>`,
  );
  const store = await reader(t, a);
  const { results } = await store.search({ query: "zorilla genet mongoose" });
  assert.equal(results[0].block, 30);
  assert.equal(results[0].partial, "Has 2 of 3 words");
  const typo = await store.search({ query: "ratel" });
  assert.equal(typo.results[0].block, 30);
});

test("markup and a diff's own controls are not words on a block", async (t) => {
  const a = await pageSession(
    t,
    `<p>Read this: button, checkbox, 1600, auto, true, set of cases, hazel-rail, side by side, layout split, exact source.</p>
     <section class="decision" data-choice="hazel-rail" data-label="Rail">
       <h3>Which one?</h3>
       <button class="decision-option" type="button" data-value="moss" data-label="Moss"><b>Moss</b></button>
       <button class="decision-option" type="button" data-value="fern" data-label="Fern"><b>Fern</b></button>
     </section>
     <div class="scope-list" data-multiselect="scope" data-label="Scope">
       <label class="scope-row"><span>Heather</span><input type="checkbox" class="scope-check" data-value="heather" data-label="Heather" /></label>
     </div>
     <img width="1600" height="900" alt="" src="data:image/png;base64,AAAA" />
     <video preload="auto" controls src="data:video/mp4;base64,AAAA"></video>
     <div class="behavior-cases" data-kind="set of cases"><span aria-hidden="true">Clover</span></div>
     <section class="change-review" data-kind="diff">
       <div class="change-controls">
         <span class="change-layout" role="group" aria-label="Layout">
           <button type="button" data-diff-style="split">Side by side</button>
           <button type="button" data-diff-style="unified">Unified</button>
         </span>
       </div>
       <textarea data-diff-input hidden>${diffInput}</textarea>
       <div class="change-view" aria-label="Before and proposed changes"></div>
       <details class="change-source">
         <summary>Exact source and Git patch</summary>
         <h3>Before</h3><pre data-diff-source="before"></pre>
       </details>
     </section>`,
  );
  const store = await reader(t, a);
  for (const query of [
    "button",
    "checkbox",
    "1600",
    "auto",
    "true",
    "set of cases",
    "hazel-rail",
    "side by side",
    "layout split",
    "exact source",
  ]) {
    const { results } = await store.search({ query });
    assert.deepEqual(
      results.map((row) => row.block),
      [0],
      query,
    );
  }
  const [diff] = (await store.search({ query: "quokkaLimit" })).results;
  assert.ok(diff.text.startsWith("--- a/retry.mjs"), diff.text);
});

test("a row's text holds no raw markup", async (t) => {
  const escaped = JSON.stringify({
    before: "",
    after: "",
    patch: "+export const pick = () => tayra();\n",
  })
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const notes = JSON.stringify([{ line: 1, text: "The cooldown is reread." }]);
  const a = await pageSession(
    t,
    `<pre data-language="typescript" data-file="src/breaker.ts" data-notes='${notes}'>const jerboa = 1;</pre>
     <section class="change-review" data-kind="diff"><textarea data-diff-input hidden>${escaped}</textarea></section>
     <div data-prototype="demo"></div>
     <section class="visual-decision" data-choice="tabs" data-label="Tabs">
       <h3>Which?</h3>
       <article class="visual-option" data-value="a" data-label="Kiwi tab"><p>Beside the emu.</p></article>
       <article class="visual-option" data-value="b" data-label="Second"><header>Second</header><p>Beside the rail.</p></article>
     </section>`,
    {
      page: {
        prototypes: [
          {
            id: "demo",
            title: "A demo",
            height: 200,
            html: '<!doctype html><div class="hero"><b>Hello tamarin</b></div><script>const kinkajou = 1;</script>',
          },
        ],
      },
    },
  );
  const store = await reader(t, a);
  for (const [query, expected] of [
    ["jerboa", "src/breaker.ts The cooldown is reread. const jerboa = 1;"],
    ["cooldown", "src/breaker.ts The cooldown is reread. const jerboa = 1;"],
    ["tayra", "+export const pick = () => tayra();"],
    ["tamarin", "A demo Hello tamarin"],
    // A script's words stay findable, and the row keeps to the words on screen.
    ["kinkajou", "A demo Hello tamarin"],
    // A visual option's label is drawn on its tab.
    ["kiwi", "Which? Kiwi tab Beside the emu. Second Beside the rail."],
  ]) {
    const [row] = (await store.search({ query })).results;
    assert.equal(row.text, expected, query);
  }
  // A language is not on the block, and still finds it.
  assert.equal(
    (await store.search({ query: "typescript" })).results[0].block,
    0,
  );
});

test("a page's script is left out of results", async (t) => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "pair-search-"));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const js = path.join(folder, "page.js");
  await fs.writeFile(js, "export function setup() { const tarsier = 1; }");
  const a = await pageSession(t, "<p>Words.</p>", { page: { js } });
  const store = await reader(t, a);
  assert.equal((await store.search({ query: "tarsier" })).total, 0);
});

test("a result names the DOM id of the block that holds it", async (t) => {
  const a = await pageSession(
    t,
    `<h2 id="own-id">The capybara</h2>
     <p>The viscacha.</p>
     loose agouti words`,
    {
      agreements: [
        {
          id: "scope",
          title: "Scope",
          html: "<p>The ocelot stays out.</p>",
          sourceRefs: [{ kind: "conversation", text: "Said in chat." }],
        },
      ],
    },
  );
  const store = await reader(t, a);
  for (const [query, blockId] of [
    ["capybara", "own-id"],
    ["viscacha", "block-overview-1"],
    ["agouti", null],
    ["ocelot", null],
  ]) {
    const [row] = (await store.search({ query })).results;
    assert.equal(row.blockId, blockId, query);
  }
  // A page title draws the first block of its page.
  const [title] = (await store.search({ query: "Overview" })).results;
  assert.equal(title.type, "page title");
  assert.equal(title.blockId, "own-id");
});

test("a thread resolves its target to the block that holds it, from a page read or cached", async (t) => {
  const a = await pageSession(
    t,
    `<section id="named"><p>Named.</p></section>
     <div><span id="inner-part">Nested.</span></div>
     <div><div data-multiselect="opts" data-label="Options"><p>A nested control.</p></div></div>
     <p>Plain.</p>`,
  );
  const cases = [
    ["named", "rhea", 0, "named"],
    ["inner-part", "serval", 1, "block-overview-1"],
    ["multiselect-overview-0", "caracal", 2, "block-overview-2"],
    ["block-overview-3", "margay", 3, "block-overview-3"],
    ["not-on-the-page", "ocelot", null, null],
  ];
  const check = async (store, [target, word, block, blockId]) => {
    assert.equal(
      (await thread(a, { target, text: `Is it the ${word}?` })).code,
      201,
    );
    store.markChanged(a.id);
    const [row] = (await store.search({ query: word })).results;
    assert.equal(row.block, block, target);
    assert.equal(row.blockId, blockId, target);
  };
  const first = await reader(t, a);
  for (const entry of cases) await check(first, entry);
  await first.close();
  // Only the page's cached entry can say which block holds this thread's target.
  const second = await reader(t, a);
  await check(second, ["inner-part", "jaguarundi", 1, "block-overview-1"]);
});

test("a thread on an Agreed card is headed by its card", async (t) => {
  const { a } = await session(t);
  const onAgreed = { topic: "agreed", target: "agreement-scope" };
  assert.equal(
    (
      await thread(a, {
        ...onAgreed,
        anchor: "Scope of the ocelot work",
        text: "Why the jaguarundi?",
      })
    ).code,
    201,
  );
  assert.equal(
    (
      await thread(a, {
        ...onAgreed,
        anchor: "Agreed so far",
        target: undefined,
        text: "And the coati?",
      })
    ).code,
    201,
  );
  const store = await reader(t, a);
  for (const [query, heading] of [
    ["jaguarundi", "Scope of the ocelot work"],
    ["coati", "Agreed so far"],
  ]) {
    const [row] = (await store.search({ query })).results;
    assert.equal(row.heading, heading, query);
    assert.equal(row.page, "agreed", query);
  }
});
