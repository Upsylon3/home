// Turns Markdown into HTML safe to inject via dangerouslySetInnerHTML.
//
// Found during a security review: `marked` (like every Markdown parser
// that supports the CommonMark spec) passes raw HTML embedded in the
// source straight through unchanged — a note containing
// `<img src=x onerror="...">` or a literal `<script>` tag renders that
// tag verbatim. "It's the note owner's own content" is not a safe
// boundary here: every app on this origin shares one browser storage
// (see docs/SECURITY.md's "Shared-origin XSS" threat) and pasting
// content copied from somewhere else — a blog post, a README, a
// chatbot reply — into your own notes is completely ordinary use of a
// notes app, not a contrived attack. An unsanitized render here is a
// real path to a script running with this origin's full privileges,
// able to read every other app's token out of localStorage
// (apps/home/src/api.js, apps/homecloud/src/api.js, etc. each use their
// own key name, but none of that isolates them from a script that can
// simply call localStorage.getItem on any of them).
//
// This function is deliberately extracted, framework-free, and pure —
// the same reasoning apps/homevault/src/crypto.js is — so it has its
// own tests (../test/markdown.test.js) with real malicious payloads,
// run directly, not only indirectly through rendering a component.
// DOMPurify needs a real `window` to bind to; in this app that's always
// true (Vite bundles the browser build, and a browser always has one).
// The test file provides one via jsdom before importing this module,
// entirely on the test side — nothing here branches on environment.
import { marked } from "marked";
import DOMPurify from "dompurify";

export function renderMarkdownToSafeHtml(content) {
  const rawHtml = marked.parse(content || "");
  // No ADD_TAGS/ADD_ATTR overrides — default DOMPurify config already
  // allows the formatting Markdown produces (headings, emphasis, links,
  // images, lists, code blocks, tables) while stripping <script>, event
  // handler attributes (onerror, onload, ...), javascript:/data: URIs
  // in href/src, <iframe>, <object>, <style>, and everything else in
  // that family.
  return DOMPurify.sanitize(rawHtml);
}
