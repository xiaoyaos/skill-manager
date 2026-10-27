const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runSync, runUpdate } = require("../src/cli");
const { installSkill } = require("../src/install");

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
  assert.equal(payload.skills.length, 6);
  assert.ok(payload.skills.some((skill) => skill.dirName === "uj-weekly-report"));
  assert.ok(payload.skills.some((skill) => skill.dirName === "task-forge"));
  assert.ok(payload.skills.some((skill) => skill.dirName === "spec-workflow"));
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

test("update --check only checks the local repository", async (t) => {
  const { home, env } = createEnvironment(t);
  const previousHome = process.env.SKILL_MANAGER_HOME;
  process.env.SKILL_MANAGER_HOME = env.SKILL_MANAGER_HOME;
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.SKILL_MANAGER_HOME;
    } else {
      process.env.SKILL_MANAGER_HOME = previousHome;
    }
  });

  const agent = {
    key: "codex-global",
    label: "Codex (Global)",
    skillsDir: path.join(home, ".codex", "skills"),
  };
  installSkill({
    skillName: "nest-lib-gen",
    agent,
    mode: "copy",
    packageVersion: "0.3.0",
  });
  const target = path.join(agent.skillsDir, "nest-lib-gen");
  fs.appendFileSync(path.join(target, "SKILL.md"), "\nlocal edit\n");

  const logs = [];
  t.mock.method(console, "log", (line) => logs.push(String(line)));
  const exitCode = await runUpdate(
    { check: true },
    {
      interactive: false,
      checkUpdate: async () => ({
        mode: "git",
        status: "up-to-date",
        current: "0.3.0",
        latest: "0.3.0",
        root: PACKAGE_ROOT,
      }),
    },
  );

  const output = logs.join("\n");
  assert.equal(exitCode, 0);
  assert.match(output, /已是最新版本/);
  assert.doesNotMatch(output, /本地安装更新检查|已安装 Skill 更新检查/);
  assert.match(
    fs.readFileSync(path.join(target, "SKILL.md"), "utf8"),
    /local edit/,
  );
});

test("interactive repository update does not modify installed skills", async (t) => {
  const { home, env } = createEnvironment(t);
  const previousHome = process.env.SKILL_MANAGER_HOME;
  process.env.SKILL_MANAGER_HOME = env.SKILL_MANAGER_HOME;
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.SKILL_MANAGER_HOME;
    } else {
      process.env.SKILL_MANAGER_HOME = previousHome;
    }
  });

  const agent = {
    key: "codex-global",
    label: "Codex (Global)",
    skillsDir: path.join(home, ".codex", "skills"),
  };
  installSkill({
    skillName: "nest-lib-gen",
    agent,
    mode: "copy",
    packageVersion: "0.3.0",
  });
  const target = path.join(agent.skillsDir, "nest-lib-gen");
  fs.appendFileSync(path.join(target, "SKILL.md"), "\nlocal edit\n");

  const notes = [];
  let updateCalled = false;
  const ui = {
    withSpinner: async (_options, task) => task(),
    note: async (message, title) => notes.push({ message, title }),
    confirmAction: async () => true,
    cancel: async () => {},
    outro: async () => {},
  };

  const exitCode = await runUpdate(
    {},
    {
      interactive: true,
      checkUpdate: async () => ({
        mode: "git",
        status: "available",
        current: "0.3.0",
        latest: "0.3.1",
        behind: 1,
        root: PACKAGE_ROOT,
      }),
      performUpdate: async () => {
        updateCalled = true;
        return { status: "updated", version: "0.3.1" };
      },
      ui,
    },
  );

  assert.equal(exitCode, 0);
  assert.equal(updateCalled, true);
  assert.ok(notes.some((entry) => entry.title === "本地仓库更新完成"));
  assert.match(
    fs.readFileSync(path.join(target, "SKILL.md"), "utf8"),
    /local edit/,
  );
});

test("interactive skill update only syncs installed copies", async (t) => {
  const { home, env } = createEnvironment(t);
  const previousHome = process.env.SKILL_MANAGER_HOME;
  process.env.SKILL_MANAGER_HOME = env.SKILL_MANAGER_HOME;
  t.after(() => {
    if (previousHome === undefined) {
      delete process.env.SKILL_MANAGER_HOME;
    } else {
      process.env.SKILL_MANAGER_HOME = previousHome;
    }
  });

  const agent = {
    key: "codex-global",
    label: "Codex (Global)",
    skillsDir: path.join(home, ".codex", "skills"),
  };
  installSkill({
    skillName: "nest-lib-gen",
    agent,
    mode: "copy",
    packageVersion: "0.3.0",
  });
  const target = path.join(agent.skillsDir, "nest-lib-gen");
  fs.appendFileSync(path.join(target, "SKILL.md"), "\nlocal edit\n");

  const notes = [];
  const prompts = [];
  const ui = {
    withSpinner: async (_options, task) => task(),
    note: async (message, title) => notes.push({ message, title }),
    confirmAction: async (message) => {
      prompts.push(message);
      return true;
    },
    cancel: async () => {},
    outro: async () => {},
  };

  const exitCode = await runSync({}, { interactive: true, ui });

  assert.equal(exitCode, 0);
  assert.match(prompts[0], /1 个已安装 Skill 可更新/);
  assert.ok(notes.some((entry) => entry.title === "已安装 Skill 更新结果"));
  assert.doesNotMatch(
    fs.readFileSync(path.join(target, "SKILL.md"), "utf8"),
    /local edit/,
  );
});

test("supports short command aliases", (t) => {
  const { env, home } = createEnvironment(t);

  const install = runCli(["i", "nest-lib-gen", "--agent", "codex", "--yes"], env);
  assert.equal(install.status, 0, install.stderr);
  const target = path.join(home, ".codex", "skills", "nest-lib-gen");
  assert.ok(fs.existsSync(path.join(target, "SKILL.md")));

  const list = runCli(["ls", "--json"], env);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(JSON.parse(list.stdout).skills.length, 6);

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
  assert.match(result.stdout, /skill-manager <command> \[options\]/);
  assert.match(result.stdout, /交互式终端/);
});

test("prints grouped help with -h and keeps piped output plain", (t) => {
  const { env } = createEnvironment(t);

  const help = runCli(["-h"], env);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /用法/);
  assert.match(help.stdout, /常用/);
  assert.match(help.stdout, /示例/);
  assert.doesNotMatch(help.stdout, /\x1b\[/);

  const list = runCli(["ls"], env);
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /个 skill/);
  assert.match(list.stdout, /NAME\s+FILES\s+INSTALLED\s+DESCRIPTION/);
  assert.match(list.stdout, /uj-weekly-report/);
  assert.doesNotMatch(list.stdout, /\x1b\[/);
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
