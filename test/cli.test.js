const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const CLI = path.join(PACKAGE_ROOT, "bin", "skill-manager.js");

function createEnvironment(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-manager-cli-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: path.join(home, ".codex"),
    SKILL_MANAGER_HOME: path.join(home, ".config", "skill-manager"),
  };
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, home, env };
}

function runCli(args, env) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: PACKAGE_ROOT,
    env,
    encoding: "utf8",
  });
}

test("lists the skill library as JSON", (t) => {
  const { env } = createEnvironment(t);
  const result = runCli(["list", "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.skills.length, 4);
  assert.ok(payload.skills.some((skill) => skill.dirName === "git-weekly-report"));
});

test("installs, lists and uninstalls a skill for Codex", (t) => {
  const { env, home } = createEnvironment(t);

  const install = runCli(
    ["install", "nest-lib-gen", "--agent", "codex", "--yes"],
    env,
  );
  assert.equal(install.status, 0, install.stderr);
  const target = path.join(home, ".codex", "skills", "nest-lib-gen");
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));

  const list = runCli(["list", "--json"], env);
  assert.equal(list.status, 0, list.stderr);
  const payload = JSON.parse(list.stdout);
  const skill = payload.skills.find((item) => item.dirName === "nest-lib-gen");
  assert.equal(skill.installed[0].agent, "codex-global");
  assert.equal(skill.installed[0].mode, "copy");

  const uninstall = runCli(
    ["uninstall", "nest-lib-gen", "--agent", "codex", "--yes"],
    env,
  );
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(fs.existsSync(target), false);
});

test("exposes short bin aliases", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"),
  );
  assert.equal(pkg.bin["skill-manager"], "bin/skill-manager.js");
  assert.equal(pkg.bin.skm, "bin/skill-manager.js");
  assert.equal(pkg.bin.sm, undefined);
});

test("supports short command aliases", (t) => {
  const { env, home } = createEnvironment(t);

  const install = runCli(["i", "nest-lib-gen", "--agent", "codex", "--yes"], env);
  assert.equal(install.status, 0, install.stderr);
  const target = path.join(home, ".codex", "skills", "nest-lib-gen");
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));

  const list = runCli(["ls", "--json"], env);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).skills.length, 4);

  const uninstall = runCli(
    ["un", "nest-lib-gen", "--agent", "codex", "--yes"],
    env,
  );
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(fs.existsSync(target), false);
});

test("reports agent directories and passes doctor checks", (t) => {
  const { env } = createEnvironment(t);

  const agents = runCli(["agents", "--json"], env);
  assert.equal(agents.status, 0, agents.stderr);
  const agentPayload = JSON.parse(agents.stdout);
  assert.ok(
    agentPayload.agents.some(
      (agent) => agent.key === "codex-global" && agent.scope === "global",
    ),
  );

  const doctor = runCli(["doctor"], env);
  assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);
  assert.match(doctor.stdout, /\[PASS\]/);
});

test("falls back to help when the menu runs without a TTY", (t) => {
  const { env } = createEnvironment(t);

  const result = runCli([], env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: skill-manager/);
  assert.match(result.stdout, /交互式终端/);
});

test("requires --agent when installing without a TTY", (t) => {
  const { env } = createEnvironment(t);

  const result = runCli(["install", "nest-lib-gen"], env);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--agent/);
});

test("requires --yes when uninstalling without a TTY", (t) => {
  const { env, home } = createEnvironment(t);

  const install = runCli(
    ["install", "nest-lib-gen", "--agent", "codex", "--yes"],
    env,
  );
  assert.equal(install.status, 0, install.stderr);

  const target = path.join(home, ".codex", "skills", "nest-lib-gen");
  const result = runCli(
    ["uninstall", "nest-lib-gen", "--agent", "codex"],
    env,
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--yes/);
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));
});
