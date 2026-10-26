const fs = require("node:fs");
const path = require("node:path");

const {
  PACKAGE_ROOT,
  SKILLS_DIR,
  packageVersion,
  readPackage,
} = require("./config");
const {
  findProfile,
  listAgentProfiles,
  resolveAgent,
} = require("./agents");
const {
  detectInstalls,
  installSkill,
  installStatusForSkill,
  syncInstalls,
  uninstallSkill,
} = require("./install");
const { hashDirectory, listSkills } = require("./skills");
const { listInstalls, loadState, stateFile } = require("./state");
const { checkUpdate, gitState, performUpdate } = require("./update");
const {
  ask,
  choose,
  chooseMany,
  confirm,
  createInterface,
  isInteractive,
  printLine,
} = require("./ui");
const {
  exists,
  padVisual,
  truncateVisual,
} = require("./util");

const VALUE_FLAGS = new Set([
  "agent",
  "scope",
  "project",
  "path",
  "name",
  "mode",
]);

const COMMAND_ALIASES = {
  add: "install",
  ls: "list",
  remove: "uninstall",
  rm: "uninstall",
  status: "doctor",
  upgrade: "update",
};

function parseArgs(argv) {
  const parsed = { _: [], flags: {} };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      parsed._.push(...argv.slice(index + 1));
      break;
    }
    if (argument === "-h") {
      parsed.flags.help = true;
      continue;
    }
    if (argument === "-v") {
      parsed.flags.version = true;
      continue;
    }
    if (argument === "-y") {
      parsed.flags.yes = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      parsed._.push(argument);
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const key =
      equalsIndex === -1
        ? argument.slice(2)
        : argument.slice(2, equalsIndex);
    const inlineValue =
      equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);

    if (inlineValue !== undefined) {
      parsed.flags[key] = inlineValue;
      continue;
    }
    if (VALUE_FLAGS.has(key)) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("-")) {
        throw new Error(`--${key} requires a value`);
      }
      parsed.flags[key] = next;
      index += 1;
      continue;
    }
    parsed.flags[key] = true;
  }
  return parsed;
}

function header() {
  const skills = listSkills();
  console.log(`Skill Manager v${packageVersion()}`);
  console.log(`Skill 库: ${SKILLS_DIR} (${skills.length} skills)`);
}

function printHelp() {
  console.log(`Usage: skill-manager <command> [options]

Commands:
  list                查看 skill 库和安装状态
  install [skill...]  安装 skill 到 Agent
  uninstall [skill]   卸载 Agent 中的 skill
  update              更新 CLI/仓库，并同步已安装副本
  sync                同步已安装副本到当前版本
  doctor              环境与安装诊断
  agents              查看支持的 Agent 及目录
  link                把所有 skill 以 symlink 安装到 Agent
  menu                交互式菜单（默认）
  help                显示帮助
  version             显示版本

Options:
  --agent <key>       codex / opencode / claude / cursor / windsurf，或完整 key
  --scope <scope>     global | project（默认 global）
  --project <dir>     project scope 的项目目录（默认当前目录）
  --path <dir>        自定义 Agent skills 目录
  --copy              复制安装（默认）
  --link              符号链接安装（适合本地开发）
  --all               对所有 skill 操作
  --force             覆盖已存在目标，或删除未托管目标
  --dry-run           只显示将要做什么
  --check             只检查更新
  --yes, -y           跳过确认
  --no-sync           update 后不同步已安装副本
  --json              list / agents 输出 JSON
  --verbose           显示完整描述和路径

Examples:
  skill-manager list
  skill-manager install git-weekly-report --agent codex
  skill-manager install --all --agent codex --link
  skill-manager install git-weekly-report --agent codex --scope project
  skill-manager uninstall git-weekly-report --agent codex
  skill-manager update --check
  skill-manager update --yes
  skill-manager doctor`);
}

function resolveMode(flags) {
  if (flags.mode && flags.mode !== "copy" && flags.mode !== "link") {
    throw new Error(`invalid --mode: ${flags.mode}; use copy or link`);
  }
  if (flags.link && flags.copy) {
    throw new Error("--link and --copy cannot be used together");
  }
  if (flags.mode) {
    return flags.mode;
  }
  if (flags.link) {
    return "link";
  }
  if (flags.copy) {
    return "copy";
  }
  return null;
}

function resolveAgentFromFlags(flags) {
  if (flags.path) {
    return resolveAgent({
      customPath: flags.path,
      customName: flags.name,
    });
  }
  if (flags.agent) {
    const exact = findProfile(flags.agent);
    if (exact) {
      return resolveAgent({ key: exact.key, projectDir: flags.project });
    }
    return resolveAgent({
      agent: flags.agent,
      scope: flags.scope,
      projectDir: flags.project,
    });
  }
  if (flags.scope) {
    return resolveAgent({
      agent: "codex",
      scope: flags.scope,
      projectDir: flags.project,
    });
  }
  return null;
}

function defaultAgent(flags) {
  return resolveAgent({
    agent: "codex",
    scope: flags.scope || "global",
    projectDir: flags.project,
  });
}

function agentChoices(flags) {
  return listAgentProfiles().map((profile) =>
    resolveAgent({ key: profile.key, projectDir: flags.project }),
  );
}

async function chooseAgent(rl, flags) {
  const agents = agentChoices(flags);
  const custom = {
    key: "custom",
    label: "自定义 Agent 路径",
    skillsDir: "",
  };
  const selected = await choose(
    rl,
    "请选择目标 Agent:",
    [...agents, custom],
    {
      display: (agent) =>
        agent.key === "custom"
          ? agent.label
          : `${agent.label}  ${agent.skillsDir}`,
    },
  );
  if (!selected) {
    return null;
  }
  if (selected.key !== "custom") {
    return selected;
  }

  const customName = await ask(rl, "请输入自定义 Agent 名称: ");
  const customPath = await ask(rl, "请输入该 Agent 的 skills 目录绝对路径: ");
  if (!customPath) {
    return null;
  }
  return resolveAgent({
    customPath,
    customName: customName || "Custom Agent",
  });
}

async function chooseInstallMode(rl) {
  const selected = await choose(rl, "请选择安装方式:", [
    { key: "copy", label: "复制（推荐，独立副本）" },
    { key: "link", label: "符号链接（本地开发，随仓库更新）" },
  ], { display: (item) => item.label });
  return selected ? selected.key : null;
}

function countSkillDirs(dirPath) {
  if (!exists(dirPath)) {
    return 0;
  }
  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => {
      const target = path.join(dirPath, entry.name);
      return exists(path.join(target, "SKILL.md"));
    }).length;
}

function installedNamesForAgent(agent) {
  const names = new Set();
  if (exists(agent.skillsDir)) {
    for (const entry of fs.readdirSync(agent.skillsDir, { withFileTypes: true })) {
      const target = path.join(agent.skillsDir, entry.name);
      if (exists(path.join(target, "SKILL.md"))) {
        names.add(entry.name);
      }
    }
  }
  for (const install of listInstalls()) {
    if (install.agentKey === agent.key) {
      names.add(install.skill);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

async function maybeWithRl(context, action) {
  if (context.rl) {
    return action(context.rl);
  }
  if (!isInteractive()) {
    return action(null);
  }
  const rl = createInterface();
  try {
    return await action(rl);
  } finally {
    rl.close();
  }
}

function printInstallResult(result, invokeTip) {
  if (result.status === "already") {
    console.log(`[SKIP] ${result.skill.dirName} 已安装：${result.target}`);
    return;
  }
  if (result.status === "would-install") {
    console.log(
      `[DRY-RUN] ${result.skill.dirName} -> ${result.agent.label} (${result.mode})`,
    );
    return;
  }
  console.log(
    `[PASS] ${result.skill.dirName} -> ${result.agent.label} (${result.mode})`,
  );
  console.log(`       ${result.target}`);
  console.log(`       调用提示：${invokeTip.replaceAll("<installed-path>", result.target).replaceAll("<skill-name>", result.skill.dirName)}`);
}

async function runInstall(flags, positional, context = {}) {
  return maybeWithRl(context, async (rl) => {
    let agent = resolveAgentFromFlags(flags);
    if (!agent) {
      if (!rl) {
        throw new Error("非交互环境请指定 --agent，或使用 --path");
      }
      agent = await chooseAgent(rl, flags);
      if (!agent) {
        console.log("已取消。");
        return 0;
      }
    }

    let selected = [];
    if (flags.all) {
      selected = listSkills();
    } else if (positional.length > 0) {
      selected = positional.map((name) => {
        const skill = listSkills().find(
          (item) => item.dirName === name || item.name === name,
        );
        if (!skill) {
          throw new Error(`skill not found: ${name}`);
        }
        return skill;
      });
    } else if (rl) {
      const installed = new Set(installedNamesForAgent(agent));
      selected = await chooseMany(
        rl,
        `请选择要安装到 ${agent.label} 的 skill:`,
        listSkills(),
        {
          display: (skill) =>
            `${skill.dirName}${installed.has(skill.dirName) ? " [已安装]" : ""}  ${truncateVisual(skill.shortDescription || skill.description, 60)}`,
        },
      );
    }

    if (selected.length === 0) {
      console.log("未选择 skill。");
      return 0;
    }

    let mode = resolveMode(flags);
    if (!mode) {
      mode = rl ? await chooseInstallMode(rl) : "copy";
      if (!mode) {
        console.log("已取消。");
        return 0;
      }
    }

    if (!flags.yes && rl && !flags["dry-run"]) {
      const ok = await confirm(
        rl,
        `确认将 ${selected.length} 个 skill 以 ${mode} 方式安装到 ${agent.label}？`,
        { defaultYes: true },
      );
      if (!ok) {
        console.log("已取消。");
        return 0;
      }
    }

    let failures = 0;
    for (const skill of selected) {
      try {
        const result = installSkill({
          skillName: skill.dirName,
          agent,
          mode,
          force: Boolean(flags.force),
          dryRun: Boolean(flags["dry-run"]),
          packageVersion: packageVersion(),
        });
        printInstallResult(result, agent.invokeTip);
      } catch (error) {
        failures += 1;
        if (error.code === "EEXIST") {
          console.log(
            `[WARN] ${skill.dirName} 已存在于 ${agent.label}；使用 --force 覆盖：${error.message}`,
          );
        } else {
          console.log(`[FAIL] ${skill.dirName}: ${error.message}`);
        }
      }
    }
    return failures > 0 ? 1 : 0;
  });
}

async function runUninstall(flags, positional, context = {}) {
  return maybeWithRl(context, async (rl) => {
    let agent = resolveAgentFromFlags(flags);
    if (!agent) {
      if (!rl) {
        throw new Error("非交互环境请指定 --agent，或使用 --path");
      }
      agent = await chooseAgent(rl, flags);
      if (!agent) {
        console.log("已取消。");
        return 0;
      }
    }

    let names = [];
    if (flags.all) {
      names = installedNamesForAgent(agent);
    } else if (positional.length > 0) {
      names = positional;
    } else if (rl) {
      const installed = installedNamesForAgent(agent);
      if (installed.length === 0) {
        console.log(`[INFO] ${agent.label} 没有已安装的 skill。`);
        return 0;
      }
      names = await chooseMany(
        rl,
        `请选择要从 ${agent.label} 卸载的 skill:`,
        installed,
      );
    }

    if (names.length === 0) {
      console.log("未选择 skill。");
      return 0;
    }

    if (!flags.yes && rl && !flags["dry-run"]) {
      const ok = await confirm(
        rl,
        `确认从 ${agent.label} 卸载 ${names.length} 个 skill？`,
      );
      if (!ok) {
        console.log("已取消。");
        return 0;
      }
    }
    if (!rl && !flags.yes && !flags["dry-run"]) {
      throw new Error("非交互卸载请加 --yes");
    }

    let failures = 0;
    for (const name of names) {
      try {
        const resolved = listSkills().find(
          (skill) => skill.dirName === name || skill.name === name,
        );
        const targetName = resolved ? resolved.dirName : name;
        const result = uninstallSkill({
          skillName: targetName,
          agent,
          force: Boolean(flags.force),
          dryRun: Boolean(flags["dry-run"]),
        });
        if (result.status === "missing") {
          console.log(`[SKIP] ${name} 未安装：${result.target}`);
        } else if (result.status === "would-uninstall") {
          console.log(`[DRY-RUN] 卸载 ${name} <- ${agent.label}: ${result.target}`);
        } else {
          console.log(`[PASS] 已卸载 ${name} <- ${agent.label}`);
        }
      } catch (error) {
        failures += 1;
        console.log(`[FAIL] ${name}: ${error.message}`);
      }
    }
    return failures > 0 ? 1 : 0;
  });
}

function printSkillTable(skills, installs, options = {}) {
  const nameWidth = Math.max(
    4,
    ...skills.map((skill) => Math.min(28, skill.dirName.length)),
  );
  const filesWidth = 5;
  const installedWidth = Math.min(
    36,
    Math.max(
      9,
      ...skills.map((skill) =>
        Math.min(
          36,
          installStatusForSkill(skill.dirName, installs).join(", ").length,
        ),
      ),
    ),
  );
  const descriptionWidth = options.verbose ? 100 : 64;

  console.log(
    [
      padVisual("NAME", nameWidth),
      padVisual("FILES", filesWidth),
      padVisual("INSTALLED", installedWidth),
      "DESCRIPTION",
    ].join("  "),
  );
  console.log(
    [
      "-".repeat(nameWidth),
      "-".repeat(filesWidth),
      "-".repeat(installedWidth),
      "-".repeat(descriptionWidth),
    ].join("  "),
  );

  for (const skill of skills) {
    const installed = installStatusForSkill(skill.dirName, installs).join(", ") || "-";
    console.log(
      [
        padVisual(truncateVisual(skill.dirName, nameWidth), nameWidth),
        padVisual(String(skill.fileCount), filesWidth),
        padVisual(truncateVisual(installed, installedWidth), installedWidth),
        truncateVisual(
          options.verbose
            ? skill.description
            : skill.shortDescription || skill.description,
          descriptionWidth,
        ),
      ].join("  "),
    );
    if (options.verbose) {
      console.log(`  path: ${skill.path}`);
    }
  }
}

function runList(flags) {
  const skills = listSkills();
  const explicitAgent = resolveAgentFromFlags(flags);
  const agents = explicitAgent
    ? [explicitAgent]
    : agentChoices(flags);
  const installs = detectInstalls({ skills, agents });

  if (flags.json) {
    const payload = {
      version: packageVersion(),
      packageRoot: PACKAGE_ROOT,
      skillsDir: SKILLS_DIR,
      skills: skills.map((skill) => ({
        name: skill.name,
        dirName: skill.dirName,
        description: skill.description,
        shortDescription: skill.shortDescription,
        path: skill.path,
        files: skill.fileCount,
        installed: installs
          .filter((item) => item.skill === skill.dirName)
          .map((item) => ({
            agent: item.agentKey,
            agentLabel: item.agentLabel,
            mode: item.mode,
            managed: item.managed,
            path: item.path,
          })),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(`Skill 库 v${packageVersion()} (${skills.length} skills)`);
  console.log(`Source: ${SKILLS_DIR}`);
  console.log();
  if (skills.length === 0) {
    console.log("[WARN] 没有找到任何 skill。");
    return 0;
  }
  printSkillTable(skills, installs, { verbose: Boolean(flags.verbose) });
  return 0;
}

function runAgents(flags) {
  const agents = agentChoices(flags);
  const rows = agents.map((agent) => ({
    key: agent.key,
    label: agent.label,
    agent: agent.agent,
    scope: agent.scope,
    path: agent.skillsDir,
    exists: exists(agent.skillsDir),
    skills: countSkillDirs(agent.skillsDir),
  }));

  if (flags.json) {
    console.log(JSON.stringify({ agents: rows }, null, 2));
    return 0;
  }

  const keyWidth = Math.max(6, ...rows.map((row) => row.key.length));
  const labelWidth = Math.max(6, ...rows.map((row) => row.label.length));
  const pathWidth = Math.min(
    52,
    Math.max(12, ...rows.map((row) => row.path.length)),
  );
  console.log(
    [
      padVisual("KEY", keyWidth),
      padVisual("AGENT", labelWidth),
      padVisual("SCOPE", 7),
      padVisual("SKILLS", 6),
      "PATH",
    ].join("  "),
  );
  console.log(
    [
      "-".repeat(keyWidth),
      "-".repeat(labelWidth),
      "-".repeat(7),
      "-".repeat(6),
      "-".repeat(pathWidth),
    ].join("  "),
  );
  for (const row of rows) {
    console.log(
      [
        padVisual(row.key, keyWidth),
        padVisual(row.label, labelWidth),
        padVisual(row.scope, 7),
        padVisual(String(row.skills), 6),
        truncateVisual(row.path, pathWidth),
      ].join("  "),
    );
  }
  return 0;
}

function printUpdateInfo(info) {
  console.log(`模式: ${info.mode === "git" ? "git checkout" : "npm global"}`);
  console.log(`目录: ${info.root}`);
  console.log(`当前版本: ${info.current}`);
  if (info.branch) {
    console.log(`分支: ${info.branch}${info.upstream ? ` -> ${info.upstream}` : ""}`);
  }

  switch (info.status) {
    case "available":
      console.log(
        `[UPDATE] 有新版本: ${info.current}${info.latest ? ` -> ${info.latest}` : ""}${
          info.behind ? `（落后 ${info.behind} 个提交）` : ""
        }`,
      );
      if (info.ahead) {
        console.log(`[WARN] 本地领先 upstream ${info.ahead} 个提交`);
      }
      if (info.dirty) {
        console.log("[WARN] Git 工作区有未提交改动，自动更新会被拒绝");
      }
      break;
    case "up-to-date":
      console.log(`[PASS] 已是最新版本${info.ahead ? `（本地领先 ${info.ahead} 个提交）` : ""}`);
      break;
    case "no-remote":
      console.log(`[WARN] ${info.message}`);
      break;
    case "no-upstream":
      console.log(`[WARN] ${info.message}`);
      break;
    case "fetch-failed":
      console.log(`[FAIL] 拉取远端失败: ${info.message}`);
      break;
    case "unpublished":
      console.log(`[WARN] ${info.message}`);
      console.log("[INFO] 当前是本地/未发布安装；更新请回到源码仓库执行 git pull，或重新 npm install -g <path>");
      break;
    default:
      console.log(`[INFO] ${info.message || info.status}`);
      break;
  }
}

function summarizeSyncResults(results) {
  if (results.length === 0) {
    return;
  }
  const counts = new Map();
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) || 0) + 1);
  }
  console.log(
    `[SYNC] ${[...counts.entries()]
      .map(([status, count]) => `${status}: ${count}`)
      .join(", ")}`,
  );
  for (const result of results) {
    if (["conflict", "missing-source"].includes(result.status)) {
      console.log(
        `[WARN] ${result.skill} @ ${result.agentKey}: ${result.message || result.status}`,
      );
    }
  }
}

async function runUpdate(flags, context = {}) {
  return maybeWithRl(context, async (rl) => {
    const info = checkUpdate();
    printUpdateInfo(info);

    if (flags.check) {
      return info.status === "fetch-failed" ? 1 : 0;
    }
    if (info.status !== "available") {
      return info.status === "fetch-failed" ? 1 : 0;
    }

    if (!flags.yes && !rl) {
      console.log("[INFO] 非交互环境，确认更新请加 --yes");
      return 0;
    }

    const result = await performUpdate(info, {
      yes: Boolean(flags.yes),
      noSync: Boolean(flags["no-sync"]),
      confirm: flags.yes
        ? null
        : () => confirm(rl, "确认执行更新？", { defaultYes: true }),
    });

    if (result.status === "cancelled") {
      console.log("已取消更新。");
      return 0;
    }
    if (result.status === "needs-confirmation") {
      console.log("[INFO] 需要确认，请加 --yes");
      return 0;
    }
    if (result.status === "updated") {
      console.log(`[PASS] 更新完成，当前版本 ${result.version}`);
      summarizeSyncResults(result.syncResults);
      console.log("[INFO] 重新打开 Agent 会话后生效。");
    }
    return 0;
  });
}

function runSync(flags) {
  const results = syncInstalls({
    dryRun: Boolean(flags["dry-run"]),
    force: Boolean(flags.force),
    packageVersion: packageVersion(),
  });

  if (results.length === 0) {
    console.log("[INFO] 没有记录到通过本 CLI 安装的副本。");
    return 0;
  }

  for (const result of results) {
    const label =
      result.status === "up-to-date"
        ? "OK"
        : result.status === "conflict" || result.status === "missing-source"
          ? "WARN"
          : "PASS";
    console.log(
      `[${label}] ${result.status}: ${result.skill} @ ${result.agentKey}${
        result.target ? ` -> ${result.target}` : ""
      }${result.message ? ` (${result.message})` : ""}`,
    );
  }
  return results.some((result) => result.status === "conflict") ? 1 : 0;
}

function addCheck(checks, level, message) {
  checks.push({ level, message });
}

function runDoctor(flags) {
  const checks = [];
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 12)) {
    addCheck(checks, "PASS", `Node.js ${process.versions.node}`);
  } else {
    addCheck(checks, "FAIL", `Node.js ${process.versions.node}，需要 >= 18.12`);
  }

  const pkg = readPackage();
  addCheck(checks, "INFO", `CLI 版本: ${pkg.version} (${pkg.name})`);
  addCheck(checks, "INFO", `包目录: ${PACKAGE_ROOT}`);

  if (exists(SKILLS_DIR)) {
    const skills = listSkills();
    addCheck(checks, skills.length > 0 ? "PASS" : "FAIL", `skill 库: ${skills.length} 个`);
  } else {
    addCheck(checks, "FAIL", `skills 目录不存在: ${SKILLS_DIR}`);
  }

  const git = gitState(PACKAGE_ROOT);
  if (!git.gitAvailable) {
    addCheck(checks, "WARN", "未找到 git，无法使用 git 方式更新");
  } else if (!git.isGit) {
    addCheck(checks, "INFO", "当前是 npm 安装副本，更新走 npm registry");
  } else {
    addCheck(
      checks,
      git.remote ? "PASS" : "WARN",
      git.remote ? `git remote: ${git.remote}` : "git 仓库没有 origin remote",
    );
    if (git.remote) {
      addCheck(
        checks,
        git.upstream ? "PASS" : "WARN",
        git.upstream
          ? `upstream: ${git.upstream}`
          : "当前分支没有 upstream，无法自动 git pull",
      );
    }
    if (git.dirty) {
      addCheck(checks, "WARN", "Git 工作区有未提交改动");
    }
  }

  try {
    const state = loadState();
    addCheck(
      checks,
      "PASS",
      `状态文件: ${stateFile()} (${Object.keys(state.installs).length} 条安装记录)`,
    );
  } catch (error) {
    addCheck(checks, "FAIL", error.message);
  }

  const agents = agentChoices(flags);
  for (const agent of agents) {
    const count = countSkillDirs(agent.skillsDir);
    addCheck(
      checks,
      exists(agent.skillsDir) ? "PASS" : "INFO",
      `${agent.key}: ${exists(agent.skillsDir) ? "存在" : "不存在"}，${count} 个 skill (${agent.skillsDir})`,
    );
  }

  let installs = [];
  try {
    installs = listInstalls();
  } catch {
    installs = [];
  }
  for (const install of installs) {
    const target = path.join(install.skillsDir, install.skill);
    if (!exists(target)) {
      addCheck(
        checks,
        "WARN",
        `安装记录指向的目标不存在: ${install.agentKey}/${install.skill}`,
      );
      continue;
    }
    const skill = listSkills().find((item) => item.dirName === install.skill);
    if (!skill) {
      addCheck(
        checks,
        "WARN",
        `安装记录对应的源 skill 已不存在: ${install.agentKey}/${install.skill}`,
      );
      continue;
    }
    if (install.mode === "copy") {
      try {
        const targetHash = hashDirectory(target);
        if (targetHash !== skill.sourceHash) {
          addCheck(
            checks,
            "WARN",
            `副本内容与当前源不一致: ${install.agentKey}/${install.skill}，运行 skill-manager sync`,
          );
        }
      } catch (error) {
        addCheck(
          checks,
          "WARN",
          `无法读取副本 ${install.agentKey}/${install.skill}: ${error.message}`,
        );
      }
    }
  }

  for (const agent of agents) {
    if (!exists(agent.skillsDir)) {
      continue;
    }
    for (const entry of fs.readdirSync(agent.skillsDir, { withFileTypes: true })) {
      if (!entry.isSymbolicLink()) {
        continue;
      }
      const target = path.join(agent.skillsDir, entry.name);
      if (!exists(target)) {
        addCheck(checks, "WARN", `断开的 symlink: ${target}`);
      }
    }
  }

  const errors = checks.filter((check) => check.level === "FAIL").length;
  const warnings = checks.filter((check) => check.level === "WARN").length;
  for (const check of checks) {
    console.log(`[${check.level}] ${check.message}`);
  }
  console.log();
  console.log(
    `[${errors > 0 ? "FAIL" : "PASS"}] ${checks.length} 项检查，${errors} error(s)，${warnings} warning(s)`,
  );
  return errors > 0 ? 1 : 0;
}

async function runMenu(context) {
  const rl = context.rl || createInterface();
  const ownsRl = !context.rl;
  try {
    while (true) {
      printLine();
      header();
      printLine();
      console.log("1) 查看 skill 库");
      console.log("2) 安装 skill 到 Agent");
      console.log("3) 卸载 Agent 中的 skill");
      console.log("4) 检查更新");
      console.log("5) 更新并同步");
      console.log("6) 环境诊断");
      console.log("7) 查看 Agent 目录");
      console.log("0) 退出");

      const choice = await ask(rl, "请选择: ");
      try {
        switch (choice) {
          case "1":
            runList({});
            break;
          case "2":
            await runInstall({}, [], { rl });
            break;
          case "3":
            await runUninstall({}, [], { rl });
            break;
          case "4":
            await runUpdate({ check: true }, { rl });
            break;
          case "5":
            await runUpdate({}, { rl });
            break;
          case "6":
            runDoctor({});
            break;
          case "7":
            runAgents({});
            break;
          case "0":
            console.log("已退出。");
            return 0;
          default:
            console.log("输入无效，请重试。");
            break;
        }
      } catch (error) {
        console.log(`[ERROR] ${error.message}`);
      }
    }
  } finally {
    if (ownsRl) {
      rl.close();
    }
  }
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    return 2;
  }

  if (parsed.flags.version || parsed._[0] === "version") {
    console.log(packageVersion());
    return 0;
  }
  if (parsed.flags.help || parsed._[0] === "help") {
    printHelp();
    return 0;
  }

  let command = parsed._.shift() || (isInteractive() ? "menu" : "help");
  command = COMMAND_ALIASES[command] || command;

  try {
    switch (command) {
      case "list":
        return runList(parsed.flags);
      case "agents":
        return runAgents(parsed.flags);
      case "install":
        return await runInstall(parsed.flags, parsed._);
      case "uninstall":
        return await runUninstall(parsed.flags, parsed._);
      case "update":
        return await runUpdate(parsed.flags);
      case "sync":
        return runSync(parsed.flags);
      case "doctor":
        return runDoctor(parsed.flags);
      case "link": {
        const flags = {
          ...parsed.flags,
          all: true,
          link: true,
          agent: parsed.flags.agent || "opencode-global",
        };
        return await runInstall(flags, []);
      }
      case "menu":
        return await runMenu({});
      case "help":
        printHelp();
        return 0;
      default:
        console.error(`[ERROR] unknown command: ${command}`);
        console.error('Run "skill-manager help" for usage.');
        return 2;
    }
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    return 1;
  }
}

module.exports = {
  main,
  parseArgs,
  resolveMode,
};
