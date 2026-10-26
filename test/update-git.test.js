const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { checkUpdate, performUpdate } = require("../src/update");

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function writePackage(dir, version) {
  fs.writeFileSync(
    path.join(dir, "package.json"),
    `${JSON.stringify({ name: "fixture", version }, null, 2)}\n`,
  );
}

test("detects and applies a git update", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const remote = path.join(root, "remote.git");
  const seed = path.join(root, "seed");
  const local = path.join(root, "local");
  fs.mkdirSync(seed);

  git(root, "init", "--bare", remote);
  git(seed, "init");
  git(seed, "config", "user.email", "test@example.com");
  git(seed, "config", "user.name", "Test");
  writePackage(seed, "0.2.0");
  fs.mkdirSync(path.join(seed, "skills", "demo"), { recursive: true });
  fs.writeFileSync(
    path.join(seed, "skills", "demo", "SKILL.md"),
    "---\nname: demo\ndescription: demo\n---\n",
  );
  git(seed, "add", ".");
  git(seed, "commit", "-m", "initial");
  git(seed, "branch", "-M", "main");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-u", "origin", "main");

  git(root, "clone", remote, local);
  git(local, "config", "user.email", "test@example.com");
  git(local, "config", "user.name", "Test");

  const before = checkUpdate({ root: local });
  assert.equal(before.status, "up-to-date");

  writePackage(seed, "0.2.1");
  fs.appendFileSync(path.join(seed, "skills", "demo", "SKILL.md"), "\nupdated\n");
  git(seed, "add", ".");
  git(seed, "commit", "-m", "release 0.2.1");
  git(seed, "push");

  const available = checkUpdate({ root: local });
  assert.equal(available.status, "available");
  assert.equal(available.latest, "0.2.1");
  assert.equal(available.behind, 1);

  const result = await performUpdate(available, {
    yes: true,
    noSync: true,
    quiet: true,
  });
  assert.equal(result.status, "updated");
  assert.equal(result.version, "0.2.1");
  assert.match(
    fs.readFileSync(path.join(local, "skills", "demo", "SKILL.md"), "utf8"),
    /updated/,
  );
});
