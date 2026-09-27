import "../support/env.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assemble } from "../../src/build/assemble.mjs";
import { build, buildPage } from "../../src/cli/build.mjs";
import { pageData, readPlanData } from "../../src/shared/records.mjs";
import { frameSource } from "../support/frame.mjs";
import { exec, pair, root } from "../support/hub.mjs";

const data = {
  name: "t",
  round: "1",
  title: "T",
  pages: [{ id: "p", title: "P", html: "<p>x</p>" }],
};

test("page CSS uses its own scope outside the frame content scope", async () => {
  const html = await buildPage(path.join(os.tmpdir(), "page.json"), {
    name: "t",
    round: "1",
    title: "T",
    page: { id: "p", title: "P", html: "<p>x</p>", cssText: "p{color:red}" },
  });
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.match(style, /@layer frame, plan, components;/);
  assert.match(
    style,
    /@layer plan \{\n@scope \(#page-content\[data-page-id="p"\]\[data-round="1"\]\) \{ p\{color:red\} \}/,
  );
  assert.ok(
    style.indexOf('@scope (#page-content[data-page-id="p"][data-round="1"])') <
      style.indexOf("@scope (#page-content)"),
  );
});

// The cascade ranks an unlayered rule above every layered one, so an
// unlayered frame stylesheet would outrank both other layers.
test("frame CSS is layered, and the component layer comes last", async () => {
  const html = await assemble(data);
  const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
  assert.match(style, /@layer frame \{\n:root \{/);
  assert.ok(
    style.indexOf("@layer plan {") < style.indexOf("@layer components {"),
    "the plan layer is written before the component layer",
  );
});

test("a component's styles and behavior are bundled", async () => {
  const html = await assemble(data);
  assert.match(html, /\/\* components\/question\/styles\.css \*\//);
  assert.match(html, /\/\* components\/question\/behavior\.mjs \*\//);
  assert.match(html, /planUI\.define\("question"/);
});

// A plan's script runs after the frame's module, so planUI.define is
// available to it before the first page renders.
test("the plan's script is the last module in the document", async () => {
  const html = await assemble(data, { js: 'planUI.define("mine", {});' });
  const modules = html.split('<script type="module">').slice(1);
  assert.equal(modules.length, 2, "the frame's module and the plan's");
  assert.match(modules[0], /planUI\.define\("question"/);
  assert.match(modules[1], /^\nplanUI\.define\("mine", \{\}\);\n<\/script>/);
});

// A round builds every page from the bundle stored with its Agreed, so a
// round published before the frame's modules existed keeps its frame.
test("a bundle stored before the frame's modules builds its one script", async () => {
  const parts = [
    "offers",
    "finish",
    "notifications",
    "choices",
    "draft",
    "activity",
    "script",
    "componentJs",
  ];
  const bundle = {
    shell:
      "<!doctype html><title>t</title><!-- FRAME_STYLE --><!-- DRAWING_EDITOR -->" +
      '<script type="application/json" id="plan-data">{}</script>' +
      "<!-- FRAME_SCRIPT --><!-- CUSTOM_SCRIPT -->",
    style: "",
    drawingEditor: "",
    componentCss: "",
    ...Object.fromEntries(parts.map((part) => [part, `/* ${part} */`])),
  };
  const html = await assemble(data, { bundle });
  assert.ok(!html.includes('<script type="importmap">'));
  const modules = html.split('<script type="module">').slice(1);
  assert.equal(modules.length, 2, "the frame's module and the plan's");
  assert.ok(
    modules[0].startsWith(
      `\n${parts.map((part) => `/* ${part} */`).join("\n")}\n</script>`,
    ),
  );
});

test("a closing style tag in plan CSS is refused", async () => {
  await assert.rejects(
    assemble(data, { css: "</style><script>1</script>" }),
    /closing style/,
  );
});

test("the build refuses an offer the registry does not define", async () => {
  await assert.rejects(
    buildPage(path.join(os.tmpdir(), "page.json"), {
      name: "t",
      round: "1",
      offer: "ship",
      title: "T",
      page: { id: "p", title: "P", html: "<p>x</p>" },
    }),
    /Unknown offer "ship"\. The offers are plan, finish\./,
  );
});

test("page JavaScript cannot restyle the frame", async () => {
  await assert.rejects(
    buildPage(path.join(os.tmpdir(), "page.json"), {
      name: "t",
      round: "1",
      title: "T",
      page: {
        id: "p",
        title: "P",
        html: "<p>x</p>",
        jsText:
          "export function setup() { document.body.style.color = 'red'; }",
      },
    }),
    /restyles document\.body/,
  );
});

const page = (html, extra = {}) => ({
  ...data,
  pages: [{ id: "p", title: "P", html }],
  ...extra,
});

const decision = (options) =>
  `<section data-choice="d" data-label="D">${options}</section>`;

const option = (value = "a") =>
  `<button data-value="${value}" data-label="${value}">${value}</button>`;

const refused = (plan, message, js) =>
  assert.rejects(assemble(plan, { js }), (error) => {
    assert.match(error.message, message);
    return true;
  });

test("an option label of exactly 24 characters is accepted", async () => {
  const long = "x".repeat(24);
  const html = await assemble(
    page(
      decision(
        `<button data-value="a" data-label="${long}">a</button>${option("b")}`,
      ),
    ),
  );
  assert.match(html, /x{24}/);
});

// The rule is "no h1", not "no repeated words".
test("a page may repeat its title in a lower heading", async () => {
  await assert.doesNotReject(assemble(page("<h2>P</h2><p>x</p>")));
});

test("a group's label is not held to the option limit", async () => {
  const html = await assemble(
    page(
      `<section data-choice="d" data-label="${"y".repeat(60)}">${option()}${option("b")}</section>`,
    ),
  );
  assert.match(html, /y{60}/);
});

test("the build refuses each structural problem and names it", async () => {
  await refused(
    { ...data, pages: [data.pages[0], data.pages[0]] },
    /^page "p" appears twice$/m,
  );
  await refused(
    page(decision(option() + option("b")) + decision(option() + option("b"))),
    /^page "p": control "d" appears twice$/m,
  );
  await refused(
    page(`<section data-choice="d">${option()}${option("b")}</section>`),
    /^page "p": control "d" has no data-label$/m,
  );
  await refused(
    page(
      decision(
        `<button data-value="a" data-label="${"x".repeat(25)}">a</button>${option("b")}`,
      ),
    ),
    /^page "p": option label "x{25}" is 25 characters, over 24$/m,
  );
  await refused(
    page("<h1>P</h1><p>x</p>"),
    /^page "p": the frame draws the page title, so a page has no h1$/m,
  );
  await refused(
    page(decision(option() + `<button data-value="">x</button>`)),
    /^page "p": an option in "d" has no data-value$/m,
  );
  await refused(
    page(decision(option())),
    /^page "p": decision "d" has 1 option$/m,
  );
  await refused(
    page(`<section data-question="q" data-label="Q"><h3>?</h3></section>`),
    /^page "p": question "q" has no textarea$/m,
  );
  await refused(
    page("<pre>x</pre>"),
    /^page "p": a code block has no data-language$/m,
  );
  await refused(
    page(`<div data-file="a.ts">x</div>`),
    /^page "p": a code block has no data-language$/m,
  );
  await refused(
    page(`<pre data-language="diff">- a\n+ b</pre>`),
    /^page "p": a code block marked diff belongs in before-after\. Run pair diff BEFORE AFTER OUT\.json$/m,
  );
  await refused(
    page(`<pre data-language="golang">x</pre>`),
    /^page "p": data-language "golang" is not a language Shiki highlights\. Did you mean "go"\?$/m,
  );
  await refused(
    page(`<pre data-language="Dockerfile">x</pre>`),
    /Did you mean "dockerfile"\?$/m,
  );
  await refused(
    page(`<pre data-language="zzz">x</pre>`),
    /^page "p": data-language "zzz" is not a language Shiki highlights\. Use a Shiki language ID, such as ts, python, shell or text\.$/m,
  );
  await refused(
    page(
      `<fieldset data-multiselect="s" data-label="S"><label><input type="checkbox" data-value="a" checked> A</label></fieldset>`,
    ),
    /^page "p": checklist "s" has a checked box\. Start every box unchecked\.$/m,
  );
  await refused(
    page(`<textarea data-diff-input hidden>{"before":""}</textarea>`),
    /^page "p": a diff input is not JSON with before, after and patch$/m,
  );
  await refused(
    page(`<a href="#nope">x</a>`),
    /^page "p": link "#nope" names no page$/m,
  );
  await refused(
    page(`<div data-prototype="ghost"></div>`),
    /^page "p": prototype "ghost" does not exist$/m,
  );
  await refused(
    data,
    /^plan\.js line 2 restyles document\.body$/m,
    "1;\ndocument.body.style.background = 'red';",
  );
});

test("well-formed controls, anchors and blocks pass", async () => {
  const html = await assemble(
    page(
      decision(option() + option("b")) +
        `<section data-question="q" data-label="Q"><textarea></textarea></section>` +
        `<div data-language="ts" data-file="a.ts">x</div><pre data-diff-source="before"></pre>` +
        `<a href="#p">p</a><a href="#agreed">a</a><a href="#local">l</a><i id="local"></i>` +
        `<div data-prototype="demo"></div>` +
        `<textarea data-diff-input hidden>{"before":"a","after":"b","patch":"p"}</textarea>`,
      {
        prototypes: [
          { id: "demo", title: "Demo", html: "<p>d</p>", height: 100 },
        ],
      },
    ),
    { js: "const wide = document.body.clientWidth > 900;" },
  );
  assert.match(html, /id="plan-data"/);
});

test("an Agreed page opens with a task, and the plan data carries it", async () => {
  const agreed = (page) =>
    buildPage(path.join(os.tmpdir(), "agreed.json"), {
      name: "t",
      round: "1",
      title: "T",
      page: { id: "agreed", title: "Agreed so far", agreements: [], ...page },
    });
  await assert.rejects(
    agreed({}),
    /page "agreed": Agreed has no task\. State what the plan is building towards\./,
  );
  await assert.rejects(
    agreed({ task: { title: " ", html: "<p>x</p>" } }),
    /page "agreed": the task has no title/,
  );
  const task = { title: "Retries", html: "<p>Checkout retries once.</p>" };
  const html = await agreed({ task });
  const data = JSON.parse(
    html
      .match(/id="plan-data">([\s\S]*?)<\/script>/)[1]
      .replaceAll("\\u003c", "<"),
  );
  assert.deepEqual(data.task, task);
});

test("a page source builds a standalone preview without executing content", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-build-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  // The frame draws the page title, so the page's own heading is an h2.
  const content =
    '<h2>Interface</h2><pre data-language="text">literal </script> and $&</pre>';
  await fs.writeFile(path.join(directory, "interface.html"), content);
  await fs.writeFile(
    path.join(directory, "custom.css"),
    ".prototype { color: var(--attention); }",
  );
  await fs.writeFile(
    path.join(directory, "custom.js"),
    'export function setup(root) { root.dataset.test = "ready"; }',
  );
  const source = path.join(directory, "source.json");
  await fs.writeFile(
    source,
    JSON.stringify({
      name: "build",
      round: "1",
      offer: "plan",
      title: "Build",
      page: {
        id: "overview",
        title: "Overview",
        file: "interface.html",
        css: "custom.css",
        js: "custom.js",
      },
    }),
  );
  const html = await build(source);
  assert.equal(pageData(html).page.html, content);
  assert.equal(pageData(html).page.file, undefined);
  assert.equal(
    pageData(html).page.cssText,
    ".prototype { color: var(--attention); }",
  );
  assert.equal(
    pageData(html).page.jsText,
    'export function setup(root) { root.dataset.test = "ready"; }',
  );
  assert(html.includes(".prototype { color: var(--attention); }"));
  assert(frameSource(html).includes("export function loadDraft"));
  assert(!html.includes("<!-- FRAME_"));
  assert(!html.includes('src="frame.js"'));
  const output = path.join(directory, "round.html");
  await exec(process.execPath, [pair, "build", source, output]);
  assert.equal(await fs.readFile(output, "utf8"), html);
  await assert.rejects(
    exec(process.execPath, [pair, "build", source, output]),
    /EEXIST/,
  );

  // npm installs the command as a symlink to src/cli.mjs.
  const link = path.join(directory, "pair");
  await fs.symlink(pair, link);
  const linked = path.join(directory, "linked.html");
  await exec(process.execPath, [link, "build", source, linked]);
  assert.equal(await fs.readFile(linked, "utf8"), html);
  await assert.rejects(exec(process.execPath, [link, "build"]), /Usage/);
});

test("preserved prototypes retain exact executable source without escaping into the frame", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-prototype-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const html =
    '<!doctype html><button id="try">Try</button><script>document.querySelector("button").onclick = () => alert("$&");</script>';
  await fs.writeFile(path.join(directory, "prototype.html"), html);
  const data = {
    name: "example",
    round: "1",
    title: "Example work",
    page: {
      id: "overview",
      title: "Preview",
      html: '<div data-prototype="demo"></div><code>data-prototype="ID"</code>',
      prototypes: [
        {
          id: "demo",
          title: "Approved interaction",
          file: "prototype.html",
          height: 420,
        },
      ],
    },
  };
  const source = path.join(directory, "source.json");
  await fs.writeFile(source, JSON.stringify(data));
  const result = await build(source);
  const parsed = pageData(result);
  assert.equal(parsed.page.prototypes[0].html, html);
  assert.equal(parsed.page.prototypes[0].file, undefined);
  assert(!result.includes(html));
  for (const prototypes of [
    [],
    [null],
    [{ ...parsed.page.prototypes[0], height: 0 }],
    [{ ...parsed.page.prototypes[0], html: "" }],
    [parsed.page.prototypes[0], parsed.page.prototypes[0]],
  ])
    await assert.rejects(
      buildPage(source, { ...parsed, page: { ...parsed.page, prototypes } }),
    );
  await fs.writeFile(
    source,
    JSON.stringify({
      ...data,
      page: {
        ...data.page,
        prototypes: [{ ...data.page.prototypes[0], html }],
      },
    }),
  );
  await assert.rejects(build(source), /file.*html|html.*file/);
});

test("the component fixture builds, so every component's markup stays valid", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "plan-fixture-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "fixture.html");
  await exec(process.execPath, [
    path.join(root, "tests/fixture/build.mjs"),
    output,
  ]);
  // The fixture is the one place every component is rendered with real
  // content, so a structural mistake in it is a mistake in a component:
  // src/build/lint.mjs refuses duplicate control IDs, a missing data-label,
  // a decision with one option, and an option label over 24 characters.
  const pages = readPlanData(await fs.readFile(output, "utf8")).pages;
  const html = pages.map((page) => page.html).join("");
  for (const attribute of [
    'data-choice="retry"',
    'data-multiselect="scope"',
    'data-question="threshold"',
    'data-drawing-question="boundary"',
    'data-lines="3-4"',
    "data-notes=",
    "data-terms=",
  ])
    assert.ok(html.includes(attribute), `fixture lost ${attribute}`);
});
