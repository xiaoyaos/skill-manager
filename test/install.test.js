const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  installSkill,
  syncInstalls,
  uninstallSkill,
} = require("../src/install");
const { listInstalls } = require("../src/state");

function createWorkspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-test-"));
  const previousHome = process.env.SKILL_MANAGER_HOME;
  process.env.SKILL_MANAGER_HOME = path.join(root, "state");
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.SKILL_MANAGER_HOME;
    } else {
      process.env.SKILL_MANAGER_HOME = previousHome;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  const agent = {
    key: "codex-global",
    label: "Codex (Global)",
    skillsDir: path.join(root, "codex", "skills"),
  };
  return { root, agent };
}

test("copies a skill, records state and restores it with sync", (t) => {
  const { agent } = createWorkspace(t);
  const skillName = "nest-dev-tools";
  const result = installSkill({
    skillName,
    agent,
    mode: "copy",
    packageVersion: "0.2.0",
  });

  assert.equal(result.status, "installed");
  const target = path.join(agent.skillsDir, skillName);
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));
  assert.ok(fs.existsSync(path.join(target, ".skill-manager.json")));
  assert.equal(listInstalls().length, 1);

  assert.throws(
    () => installSkill({ skillName, agent, mode: "copy" }),
    (error) => error.code === "EEXIST",
  );

  fs.appendFileSync(path.join(target, "SKILL.md"), "\nlocal edit\n");
  const syncResults = syncInstalls({ packageVersion: "0.2.0" });
  assert.equal(syncResults[0].status, "updated");
  assert.ok(
    !fs.readFileSync(path.join(target, "SKILL.md"), "utf8").includes("local edit"),
  );

  const uninstallResult = uninstallSkill({ skillName, agent });
  assert.equal(uninstallResult.status, "uninstalled");
  assert.equal(fs.existsSync(target), false);
  assert.equal(listInstalls().length, 0);
});

test("dry-run detects installed copy updates without changing the target", (t) => {
  const { root, agent } = createWorkspace(t);
  const skillsDir = path.join(root, "skills");
  const source = path.join(skillsDir, "demo");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, "SKILL.md"),
    "---\nname: demo\ndescription: demo\n---\n",
  );

  installSkill({
    skillName: "demo",
    agent,
    mode: "copy",
    skillsDir,
    packageVersion: "0.2.0",
  });
  const target = path.join(agent.skillsDir, "demo");

  assert.equal(syncInstalls({ dryRun: true, skillsDir })[0].status, "up-to-date");

  fs.appendFileSync(path.join(source, "SKILL.md"), "\nsource update\n");
  const results = syncInstalls({ dryRun: true, skillsDir });

  assert.equal(results[0].status, "would-update");
  assert.doesNotMatch(
    fs.readFileSync(path.join(target, "SKILL.md"), "utf8"),
    /source update/,
  );
});

test("links and unlinks a skill", (t) => {
  const { agent } = createWorkspace(t);
  const skillName = "nest-lib-gen";
  const result = installSkill({ skillName, agent, mode: "link" });

  assert.equal(result.status, "installed");
  const target = path.join(agent.skillsDir, skillName);
  assert.ok(fs.lstatSync(target).isSymbolicLink());

  const uninstallResult = uninstallSkill({ skillName, agent });
  assert.equal(uninstallResult.status, "uninstalled");
  assert.equal(fs.existsSync(target), false);
});

test("refuses to remove unmanaged directories without force", (t) => {
  const { agent } = createWorkspace(t);
  const target = path.join(agent.skillsDir, "manual-skill");
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "SKILL.md"), "---\nname: manual\n---\n");

  assert.throws(
    () => uninstallSkill({ skillName: "manual-skill", agent }),
    (error) => error.code === "EUNMANAGED",
  );
  assert.ok(fs.existsSync(target));

  const result = uninstallSkill({
    skillName: "manual-skill",
    agent,
    force: true,
  });
  assert.equal(result.status, "uninstalled");
  assert.equal(fs.existsSync(target), false);
});
