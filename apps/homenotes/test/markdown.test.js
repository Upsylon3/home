import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// DOMPurify auto-detects a DOM by checking for `window` at *import* time —
// it has no API to hand one in explicitly. That means `global.window`
// must exist before ../src/markdown.js (and therefore its own `import
// DOMPurify from "dompurify"`) is ever evaluated. A normal static
// `import { renderMarkdownToSafeHtml } from "../src/markdown.js"` at the
// top of this file would be hoisted above the two lines below that set
// up `global.window` — so this file uses a dynamic import() after the
// jsdom window is in place instead. Confirmed empirically in this
// session (both directions): with the static-import-first ordering,
// `DOMPurify.sanitize` comes back as `"DOMPurify.sanitize is not a
// function"`; with jsdom's window set first, exactly as done here, it
// works. This is a real ordering requirement, not defensive paranoia.
const dom = new JSDOM("<!DOCTYPE html>");
global.window = dom.window;
global.document = dom.window.document;

const { renderMarkdownToSafeHtml } = await import("../src/markdown.js");

// --- malicious payloads: each of these is a real, confirmed exploit
// against the pre-fix code path (raw `marked.parse()` straight into
// `dangerouslySetInnerHTML`, see NoteEditor.jsx's git history) that led
// to this fix. Every one of them must come out with its dangerous part
// gone — not just escaped/visible-but-inert, actually removed, since
// the output is injected as real DOM via dangerouslySetInnerHTML.

test("strips a raw <script> tag entirely", () => {
  const out = renderMarkdownToSafeHtml("before <script>alert(document.cookie)</script> after");
  assert.ok(!out.includes("<script"), `script tag survived: ${out}`);
  assert.ok(!out.includes("alert("), `script contents survived: ${out}`);
});

test("strips onerror= from an <img> tag, keeps the tag itself", () => {
  const out = renderMarkdownToSafeHtml('<img src=x onerror="alert(document.cookie)">');
  assert.ok(!out.includes("onerror"), `onerror handler survived: ${out}`);
  // The <img> itself is legitimate Markdown/HTML content (this is how
  // Markdown image syntax compiles down) — only the handler is the
  // problem, so DOMPurify keeps the tag and drops the attribute.
  assert.ok(out.includes("<img"), `expected the <img> tag itself to survive: ${out}`);
});

test("strips a javascript: URI from a Markdown link's href", () => {
  const out = renderMarkdownToSafeHtml("[click me](javascript:alert(document.cookie))");
  assert.ok(!out.includes("javascript:"), `javascript: URI survived: ${out}`);
  assert.ok(!out.includes("href"), `expected the href to be dropped entirely, not just neutered: ${out}`);
});

test("strips an <iframe> entirely", () => {
  const out = renderMarkdownToSafeHtml('<iframe src="javascript:alert(1)"></iframe>');
  assert.ok(!out.includes("<iframe"), `iframe survived: ${out}`);
});

test("strips onload= from an <svg> tag", () => {
  const out = renderMarkdownToSafeHtml("<svg onload=alert(document.cookie)>");
  assert.ok(!out.includes("onload"), `onload handler survived: ${out}`);
});

test("strips a <style> block entirely (CSS can exfiltrate via url())", () => {
  const out = renderMarkdownToSafeHtml("<style>body{background:url(javascript:alert(1))}</style>");
  assert.ok(!out.includes("<style"), `style tag survived: ${out}`);
  assert.ok(!out.includes("javascript:"), `javascript: URI inside style survived: ${out}`);
});

// --- legitimate Markdown must still render normally — a sanitizer that
// breaks ordinary notes isn't a fix people will keep, it's a fix
// people will find a way to route around.

test("still renders bold/emphasis correctly", () => {
  const out = renderMarkdownToSafeHtml("this is **bold** and this is *italic*");
  assert.ok(out.includes("<strong>bold</strong>"), out);
  assert.ok(out.includes("<em>italic</em>"), out);
});

test("still renders a real https:// link with a working href", () => {
  const out = renderMarkdownToSafeHtml("[Anthropic](https://www.anthropic.com)");
  assert.ok(out.includes('href="https://www.anthropic.com"'), out);
  assert.ok(out.includes(">Anthropic<"), out);
});

test("still renders fenced code blocks", () => {
  const out = renderMarkdownToSafeHtml("```js\nconst x = 1;\n```");
  assert.ok(out.includes("<pre>"), out);
  assert.ok(out.includes("<code"), out);
  assert.ok(out.includes("const x = 1;"), out);
});

test("still renders an image with a real src", () => {
  const out = renderMarkdownToSafeHtml("![a diagram](https://example.com/diagram.png)");
  assert.ok(out.includes('src="https://example.com/diagram.png"'), out);
  assert.ok(out.includes('alt="a diagram"'), out);
});

test("empty/undefined content renders as empty output rather than throwing", () => {
  assert.equal(renderMarkdownToSafeHtml(""), "");
  assert.equal(renderMarkdownToSafeHtml(undefined), "");
});
