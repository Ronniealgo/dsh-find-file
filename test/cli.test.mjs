// dsh-find-file — test/cli.test.mjs
// Spawns the real CLI against a real temp tree plus one portable live check
// (search the node binary's own directory for node*). Zero npm deps.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/find-file.mjs", import.meta.url));
const NODE = process.execPath;

function runCli(args) {
  return spawnSync(NODE, [BIN, ...args], { encoding: "utf8" });
}

function makeTmpTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-find-file-cli-"));
  fs.writeFileSync(path.join(root, "alpha.txt"), "x");
  fs.writeFileSync(path.join(root, "beta.log"), "x");
  fs.mkdirSync(path.join(root, "gamma"));
  fs.writeFileSync(path.join(root, "gamma", "alpha.txt"), "x");
  return root;
}

test("default output is a JSON result document", () => {
  const root = makeTmpTree();
  try {
    const run = runCli([root, "*.txt"]);
    assert.equal(run.status, 0, run.stderr);
    const value = JSON.parse(run.stdout);
    assert.equal(value.matchedCount, 2);
    assert.equal(value.complete, true);
    assert.equal(value.pattern, "*.txt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("--quiet prints paths only", () => {
  const root = makeTmpTree();
  try {
    const run = runCli([root, "*.txt", "--quiet"]);
    assert.equal(run.status, 0);
    const lines = run.stdout.trim().split(/\r?\n/);
    assert.equal(lines.length, 2);
    assert.ok(lines.every((line) => path.isAbsolute(line) && line.endsWith(".txt")));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("usage errors exit 2 with a hint", () => {
  const noArgs = runCli([]);
  assert.equal(noArgs.status, 2);
  assert.match(noArgs.stderr, /usage|root/i);
  const unknown = runCli(["somewhere", "x", "--nonsense", "1"]);
  assert.equal(unknown.status, 2);
  const badPattern = runCli(["somewhere", "a/b"]);
  assert.equal(badPattern.status, 2);
});

test("missing root exits 1 with the reason", () => {
  const run = runCli([path.join(os.tmpdir(), "dsh-find-file-cli-ghost"), "x"]);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /root is not accessible/);
});

test("live: find node itself next to the running binary", () => {
  const dir = path.dirname(NODE);
  const run = runCli([dir, "node*"]);
  assert.equal(run.status, 0, run.stderr);
  const value = JSON.parse(run.stdout);
  assert.ok(value.matchedCount >= 1);
  assert.ok(
    value.matches.some((match) => path.normalize(match).toLowerCase() === path.normalize(NODE).toLowerCase()),
    `expected ${NODE} among ${JSON.stringify(value.matches)}`,
  );
});
