// dsh-find-file — test/match.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { compilePattern } from "../lib/match.js";

test("exact name matches itself", () => {
  assert.ok(compilePattern("app.js").test("app.js"));
  assert.ok(!compilePattern("app.js").test("App.js")); // case-sensitive default
  assert.ok(compilePattern("app.js", { caseInsensitive: true }).test("APP.JS"));
});

test("dots are literal: pdftotext.exe must not match pdftotextXexe", () => {
  const rx = compilePattern("pdftotext.exe");
  assert.ok(rx.test("pdftotext.exe"));
  assert.ok(!rx.test("pdftotextXexe"));
  assert.ok(!rx.test("pdftotext-exe"));
});

test("* matches any run including none", () => {
  const rx = compilePattern("*.pdf");
  assert.ok(rx.test("a.pdf"));
  assert.ok(rx.test("long.name.pdf"));
  assert.ok(rx.test(".pdf"));
  assert.ok(!rx.test("a.pdf.bak"));
});

test("* may appear several times", () => {
  const rx = compilePattern("a*b*c");
  assert.ok(rx.test("abc"));
  assert.ok(rx.test("a-x-b-y-c"));
  assert.ok(!rx.test("a-x-z-c"));
});

test("? matches exactly one character", () => {
  const rx = compilePattern("file?.txt");
  assert.ok(rx.test("file1.txt"));
  assert.ok(!rx.test("file12.txt"));
  assert.ok(!rx.test("file.txt"));
});

test("regex metacharacters are literal", () => {
  const rx = compilePattern("a+b(1)[x].txt");
  assert.ok(rx.test("a+b(1)[x].txt"));
  assert.ok(!rx.test("aab(1)[x].txt"));
});

test("anchored: *.js does not match x.js.bak", () => {
  assert.ok(!compilePattern("*.js").test("x.js.bak"));
});

test("path separators are rejected", () => {
  assert.throws(() => compilePattern("a/b"), TypeError);
  assert.throws(() => compilePattern("a\\b"), TypeError);
  assert.throws(() => compilePattern("**/x"), TypeError);
});

test("invalid patterns are rejected", () => {
  assert.throws(() => compilePattern(""), TypeError);
  assert.throws(() => compilePattern(123), TypeError);
  assert.throws(() => compilePattern("a".repeat(513)), TypeError);
  assert.throws(() => compilePattern("bad\0name"), TypeError);
});
