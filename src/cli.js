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
const {
  hashDirectory,
  listSkills,
  readInstallMetadata,
} = require("./skills");
const { listInstalls, loadState, stateFile } = require("./state");
const { checkUpdate, gitState, performUpdate } = require("./update");
const tui = require("./tui");
const { isInteractive } = tui;
const pc = require("picocolors");
const {
  exists,
  isInside,
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
  i: "install",
  ls: "list",
  remove: "uninstall",
  rm: "uninstall",
  un: "uninstall",
  status: "doctor",
  upgrade: "update",
  up: "update",
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

function printHelp() {
  console.log(`Usage: skill-manager <command> [options]
       skm <command> [options]     (short alias)

不指定命令时启动交互式终端（需要 Node.js >= 20.12，且终端支持 TTY）。
非交互环境自动回退为帮助信息。

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

Command aliases:
  i / add             install
  ls                  list
  un / rm / remove    uninstall
  up / upgrade        update
  status              doctor

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

function displayPath(target) {
  const home = process.env.HOME || "";
  if (home && target === home) {
    return "~";
  }
  if (home && target.startsWith(`${home}${path.sep}`)) {
    return `~${target.slice(home.length)}`;
  }
  return target;
}

function expandHome(target) {
  const value = String(target || "").trim();
  if (value === "~") {
    return process.env.HOME || value;
  }
  if (value.startsWith(`~${path.sep}`)) {
    return path.join(process.env.HOME || "", value.slice(2));
  }
  return value;
}

async function chooseAgent(flags) {
  const agents = agentChoices(flags);
  const custom = { key: "custom", label: "自定义 Agent 路径", skillsDir: "" };
  const selected = await tui.chooseOne({
    message: "选择目标 Agent",
    options: [
      ...agents.map((agent) => ({
        value: agent,
        label: agent.label,
        hint: displayPath(agent.skillsDir),
      })),
      {
        value: custom,
        label: custom.label,
        hint: "手动输入 skills 目录",
      },
    ],
    placeholder: "输入 Agent 名称过滤…",
    maxItems: 10,
  });
  if (!selected) {
    return null;
  }
  if (selected.key !== "custom") {
    return selected;
  }

  const customName = await tui.askText("自定义 Agent 名称", {
    placeholder: "My Agent",
    defaultValue: "Custom Agent",
  });
  if (customName === null) {
    return null;
  }
  const customPath = await tui.askText("skills 目录绝对路径", {
    placeholder: "~/.my-agent/skills",
  });
  if (!customPath) {
    return null;
  }
  return resolveAgent({
    customPath: expandHome(customPath),
    customName: customName || "Custom Agent",
  });
}

async function chooseInstallMode() {
  return tui.chooseOne({
    message: "选择安装方式",
    options: [
      { value: "copy", label: "复制安装", hint: "独立副本，推荐" },
      { value: "link", label: "符号链接", hint: "本地开发，随仓库更新" },
    ],
    maxItems: 4,
  });
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

function managedSkillNames(agent) {
  const names = new Set(
    listInstalls()
      .filter((install) => install.agentKey === agent.key)
      .map((install) => install.skill),
  );
  if (!exists(agent.skillsDir)) {
    return names;
  }

  for (const entry of fs.readdirSync(agent.skillsDir, { withFileTypes: true })) {
    const target = path.join(agent.skillsDir, entry.name);
    if (!exists(path.join(target, "SKILL.md"))) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      try {
        const link = fs.readlinkSync(target);
        const resolved = path.resolve(path.dirname(target), link);
        if (isInside(resolved, SKILLS_DIR)) {
          names.add(entry.name);
        }
      } catch {
        // Broken symlink; uninstall reports it separately.
      }
    } else if (readInstallMetadata(target)) {
      names.add(entry.name);
    }
  }
  return names;
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

function formatInstallResultTui(result) {
  if (result.status === "already") {
    return `${pc.yellow("○")} ${result.skill.dirName} 已安装`;
  }
  if (result.status === "would-install") {
    return `${pc.dim("○")} ${result.skill.dirName} → ${result.agent.label} ${pc.dim("(dry-run)")}`;
  }
  return `${pc.green("✓")} ${pc.bold(result.skill.dirName)} → ${result.agent.label} ${pc.dim(`(${result.mode})`)}\n  ${pc.dim(result.target)}`;
}

async function runInstall(flags, positional, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  let agent = resolveAgentFromFlags(flags);
  if (!agent) {
    if (!interactive) {
      throw new Error("非交互环境请指定 --agent，或使用 --path");
    }
    agent = await chooseAgent(flags);
    if (!agent) {
      await tui.cancel("已取消安装");
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
  } else if (interactive) {
    const installed = new Set(installedNamesForAgent(agent));
    const picked = await tui.chooseMany({
      message: `选择要安装到 ${agent.label} 的 skill`,
      options: listSkills().map((skill) => ({
        value: skill,
        label: `${skill.dirName}${installed.has(skill.dirName) ? " [已安装]" : ""}`,
        hint: truncateVisual(
          skill.shortDescription || skill.description,
          72,
        ),
      })),
      placeholder: "输入名称或描述过滤…",
      maxItems: 12,
      required: true,
    });
    if (!picked) {
      await tui.cancel("已取消安装");
      return 0;
    }
    selected = picked;
  }

  if (selected.length === 0) {
    if (interactive) {
      await tui.log("未选择 skill", "warn");
    } else {
      console.log("未选择 skill。");
    }
    return 0;
  }

  let mode = resolveMode(flags);
  if (!mode) {
    if (!interactive) {
      mode = "copy";
    } else {
      mode = await chooseInstallMode();
      if (!mode) {
        await tui.cancel("已取消安装");
        return 0;
      }
    }
  }

  if (interactive && !flags.yes && !flags["dry-run"]) {
    await tui.note(
      [
        `${pc.dim("Agent")}   ${agent.label}`,
        `${pc.dim("目录")}    ${displayPath(agent.skillsDir)}`,
        `${pc.dim("Skills")}  ${selected.map((skill) => skill.dirName).join(", ")}`,
        `${pc.dim("方式")}    ${mode === "copy" ? "复制" : "符号链接"}`,
      ].join("\n"),
      "安装确认",
    );
    const ok = await tui.confirmAction("开始安装？", { initialValue: true });
    if (!ok) {
      await tui.cancel("已取消安装");
      return 0;
    }
  }

  const run = () => {
    let failures = 0;
    const lines = [];
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
        if (interactive) {
          lines.push(formatInstallResultTui(result));
        } else {
          printInstallResult(result, agent.invokeTip);
        }
      } catch (error) {
        failures += 1;
        if (error.code === "EEXIST") {
          const message = `${skill.dirName} 已存在于 ${agent.label}；使用 --force 覆盖`;
          if (interactive) {
            lines.push(`${pc.yellow("!")} ${message}`);
          } else {
            console.log(`[WARN] ${message}：${error.message}`);
          }
        } else if (interactive) {
          lines.push(`${pc.red("✗")} ${skill.dirName}: ${error.message}`);
        } else {
          console.log(`[FAIL] ${skill.dirName}: ${error.message}`);
        }
      }
    }
    return { failures, lines };
  };

  let outcome;
  if (interactive) {
    outcome = await tui.withSpinner(
      {
        start: "安装中…",
        success: (result) =>
          result.failures > 0
            ? `安装结束：${result.failures} 个失败`
            : `安装完成：${selected.length} 个 skill`,
        failure: "安装失败",
      },
      run,
    );
    if (outcome.lines.length > 0) {
      await tui.note(
        outcome.lines.join("\n"),
        outcome.failures > 0 ? "安装结果（有失败）" : "安装结果",
      );
    }
  } else {
    outcome = run();
  }

  return outcome.failures > 0 ? 1 : 0;
}

async function runUninstall(flags, positional, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  let agent = resolveAgentFromFlags(flags);
  if (!agent) {
    if (!interactive) {
      throw new Error("非交互环境请指定 --agent，或使用 --path");
    }
    agent = await chooseAgent(flags);
    if (!agent) {
      await tui.cancel("已取消卸载");
      return 0;
    }
  }

  const installed = installedNamesForAgent(agent);
  let names = [];
  if (flags.all) {
    names = installed;
  } else if (positional.length > 0) {
    names = positional;
  } else if (interactive) {
    if (installed.length === 0) {
      await tui.log(`${agent.label} 没有已安装的 skill`, "info");
      return 0;
    }
    const managed = managedSkillNames(agent);
    const picked = await tui.chooseMany({
      message: `选择要从 ${agent.label} 卸载的 skill`,
      options: installed.map((name) => ({
        value: name,
        label: managed.has(name) ? name : `${name} [未托管]`,
        hint: managed.has(name)
          ? displayPath(path.join(agent.skillsDir, name))
          : "未由本 CLI 安装，需要强制删除",
      })),
      placeholder: "输入名称过滤…",
      maxItems: 12,
      required: true,
    });
    if (!picked) {
      await tui.cancel("已取消卸载");
      return 0;
    }
    names = picked;
  }

  if (names.length === 0) {
    if (interactive) {
      await tui.log("未选择 skill", "warn");
    } else {
      console.log("未选择 skill。");
    }
    return 0;
  }

  if (!interactive && !flags.yes && !flags["dry-run"]) {
    throw new Error("非交互卸载请加 --yes");
  }

  const managed = managedSkillNames(agent);
  const unmanaged = names.filter((name) => !managed.has(name));

  if (interactive && !flags.yes && !flags["dry-run"]) {
    const lines = [
      `${pc.dim("Agent")}   ${agent.label}`,
      `${pc.dim("目录")}    ${displayPath(agent.skillsDir)}`,
      `${pc.dim("Skills")}  ${names.join(", ")}`,
    ];
    if (unmanaged.length > 0) {
      lines.push(
        `${pc.yellow("!")} 未托管，将被强制删除: ${unmanaged.join(", ")}`,
      );
    }
    await tui.note(lines.join("\n"), "卸载确认");

    const ok = await tui.confirmAction(
      `确认从 ${agent.label} 卸载 ${names.length} 个 skill？`,
      { initialValue: true },
    );
    if (!ok) {
      await tui.cancel("已取消卸载");
      return 0;
    }
    if (unmanaged.length > 0) {
      const forceOk = await tui.confirmAction(
        `强制删除 ${unmanaged.length} 个未托管目录？此操作不可恢复`,
        { initialValue: false },
      );
      if (!forceOk) {
        await tui.cancel("已取消卸载");
        return 0;
      }
    }
  }

  const run = () => {
    let failures = 0;
    const lines = [];
    for (const name of names) {
      try {
        const resolved = listSkills().find(
          (skill) => skill.dirName === name || skill.name === name,
        );
        const targetName = resolved ? resolved.dirName : name;
        const result = uninstallSkill({
          skillName: targetName,
          agent,
          force: Boolean(flags.force) || unmanaged.includes(name),
          dryRun: Boolean(flags["dry-run"]),
        });
        if (interactive) {
          if (result.status === "missing") {
            lines.push(`${pc.yellow("○")} ${name} 未安装`);
          } else if (result.status === "would-uninstall") {
            lines.push(
              `${pc.dim("○")} 将卸载 ${name} ${pc.dim(result.target)}`,
            );
          } else {
            lines.push(`${pc.green("✓")} 已卸载 ${pc.bold(name)}`);
          }
        } else if (result.status === "missing") {
          console.log(`[SKIP] ${name} 未安装：${result.target}`);
        } else if (result.status === "would-uninstall") {
          console.log(`[DRY-RUN] 卸载 ${name} <- ${agent.label}: ${result.target}`);
        } else {
          console.log(`[PASS] 已卸载 ${name} <- ${agent.label}`);
        }
      } catch (error) {
        failures += 1;
        if (interactive) {
          lines.push(`${pc.red("✗")} ${name}: ${error.message}`);
        } else {
          console.log(`[FAIL] ${name}: ${error.message}`);
        }
      }
    }
    return { failures, lines };
  };

  let outcome;
  if (interactive) {
    outcome = await tui.withSpinner(
      {
        start: "卸载中…",
        success: (result) =>
          result.failures > 0
            ? `卸载结束：${result.failures} 个失败`
            : `卸载完成：${names.length} 个 skill`,
        failure: "卸载失败",
      },
      run,
    );
    if (outcome.lines.length > 0) {
      await tui.note(
        outcome.lines.join("\n"),
        outcome.failures > 0 ? "卸载结果（有失败）" : "卸载结果",
      );
    }
  } else {
    outcome = run();
  }

  return outcome.failures > 0 ? 1 : 0;
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

function updateInfoLines(info) {
  const lines = [
    `模式: ${info.mode === "git" ? "git checkout" : "npm global"}`,
    `目录: ${info.root}`,
    `当前版本: ${info.current}`,
  ];
  if (info.branch) {
    lines.push(`分支: ${info.branch}${info.upstream ? ` -> ${info.upstream}` : ""}`);
  }

  switch (info.status) {
    case "available":
      lines.push(
        `[UPDATE] 有新版本: ${info.current}${info.latest ? ` -> ${info.latest}` : ""}${
          info.behind ? `（落后 ${info.behind} 个提交）` : ""
        }`,
      );
      if (info.ahead) {
        lines.push(`[WARN] 本地领先 upstream ${info.ahead} 个提交`);
      }
      if (info.dirty) {
        lines.push("[WARN] Git 工作区有未提交改动，自动更新会被拒绝");
      }
      break;
    case "up-to-date":
      lines.push(
        `[PASS] 已是最新版本${info.ahead ? `（本地领先 ${info.ahead} 个提交）` : ""}`,
      );
      break;
    case "no-remote":
    case "no-upstream":
      lines.push(`[WARN] ${info.message}`);
      break;
    case "fetch-failed":
      lines.push(`[FAIL] 拉取远端失败: ${info.message}`);
      break;
    case "unpublished":
      lines.push(`[WARN] ${info.message}`);
      lines.push(
        "[INFO] 当前是本地/未发布安装；更新请回到源码仓库执行 git pull，或重新 npm install -g <path>",
      );
      break;
    default:
      lines.push(`[INFO] ${info.message || info.status}`);
      break;
  }
  return lines;
}

function printUpdateInfo(info) {
  for (const line of updateInfoLines(info)) {
    console.log(line);
  }
}

function syncCounts(results) {
  const counts = new Map();
  for (const result of results) {
    counts.set(result.status, (counts.get(result.status) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([status, count]) => `${status}: ${count}`)
    .join(", ");
}

function formatSyncSummary(results) {
  const counts = syncCounts(results);
  return counts ? `同步: ${counts}` : null;
}

function summarizeSyncResults(results) {
  const counts = syncCounts(results);
  if (!counts) {
    return;
  }
  console.log(`[SYNC] ${counts}`);
  for (const result of results) {
    if (["conflict", "missing-source"].includes(result.status)) {
      console.log(
        `[WARN] ${result.skill} @ ${result.agentKey}: ${result.message || result.status}`,
      );
    }
  }
}

async function runUpdate(flags, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  const noSync = Boolean(flags["no-sync"]);

  let info;
  if (interactive) {
    info = await tui.withSpinner(
      { start: "检查更新…", success: "检查完成", failure: "检查更新失败" },
      () => checkUpdate(),
    );
    await tui.note(updateInfoLines(info).join("\n"), "更新检查");
  } else {
    info = await checkUpdate();
    printUpdateInfo(info);
  }

  if (flags.check) {
    return info.status === "fetch-failed" ? 1 : 0;
  }
  if (info.status !== "available") {
    return info.status === "fetch-failed" ? 1 : 0;
  }

  if (!interactive) {
    if (!flags.yes) {
      console.log("[INFO] 非交互环境，确认更新请加 --yes");
      return 0;
    }
    const result = await performUpdate(info, { yes: true, noSync });
    if (result.status === "updated") {
      console.log(`[PASS] 更新完成，当前版本 ${result.version}`);
      summarizeSyncResults(result.syncResults);
      console.log("[INFO] 重新打开 Agent 会话后生效。");
    }
    return 0;
  }

  if (!flags.yes) {
    const ok = await tui.confirmAction("确认执行更新？", {
      initialValue: true,
    });
    if (!ok) {
      await tui.cancel("已取消更新");
      return 0;
    }
  }

  const result = await tui.withSpinner(
    {
      start: info.mode === "git" ? "正在 git pull…" : "正在 npm 更新…",
      success: (outcome) =>
        outcome.status === "updated"
          ? `更新完成：v${outcome.version}`
          : "已跳过",
      failure: "更新失败",
    },
    () =>
      performUpdate(info, {
        yes: true,
        noSync,
        quiet: true,
      }),
  );

  if (result.status === "cancelled") {
    await tui.cancel("已取消更新");
    return 0;
  }
  if (result.status === "updated") {
    const lines = [`${pc.green("✓")} 当前版本 ${pc.bold(result.version)}`];
    const summary = formatSyncSummary(result.syncResults);
    if (summary) {
      lines.push(summary);
    }
    await tui.note(lines.join("\n"), "更新完成");
    await tui.outro("重新打开 Agent 会话后生效");
  }
  return 0;
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

function collectDoctorChecks(flags) {
  const checks = [];
  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  if (nodeMajor > 20 || (nodeMajor === 20 && nodeMinor >= 12)) {
    addCheck(checks, "PASS", `Node.js ${process.versions.node}`);
  } else {
    addCheck(checks, "FAIL", `Node.js ${process.versions.node}，需要 >= 20.12`);
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

  return checks;
}

function printDoctorChecks(checks) {
  for (const check of checks) {
    console.log(`[${check.level}] ${check.message}`);
  }
  const errors = checks.filter((check) => check.level === "FAIL").length;
  const warnings = checks.filter((check) => check.level === "WARN").length;
  console.log();
  console.log(
    `[${errors > 0 ? "FAIL" : "PASS"}] ${checks.length} 项检查，${errors} error(s)，${warnings} warning(s)`,
  );
}

function formatDoctorChecks(checks) {
  const symbol = {
    PASS: pc.green("✓"),
    FAIL: pc.red("✗"),
    WARN: pc.yellow("!"),
    INFO: pc.blue("ℹ"),
  };
  return checks
    .map((check) => `${symbol[check.level] || "·"} ${check.message}`)
    .join("\n");
}

async function runDoctor(flags, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  if (!interactive) {
    const checks = collectDoctorChecks(flags);
    printDoctorChecks(checks);
    return checks.some((check) => check.level === "FAIL") ? 1 : 0;
  }

  const checks = await tui.withSpinner(
    { start: "检查环境中…", success: "检查完成", failure: "检查失败" },
    async () => collectDoctorChecks(flags),
  );
  await tui.note(formatDoctorChecks(checks), "环境诊断");
  const errors = checks.filter((check) => check.level === "FAIL").length;
  const warnings = checks.filter((check) => check.level === "WARN").length;
  await tui.outro(
    errors > 0
      ? `发现 ${errors} 个错误，${warnings} 个警告`
      : warnings > 0
        ? `通过，${warnings} 个警告`
        : "全部检查通过",
  );
  return errors > 0 ? 1 : 0;
}

async function runMenu() {
  if (!isInteractive()) {
    printHelp();
    return 0;
  }

  const skills = listSkills();
  let installCount = 0;
  try {
    installCount = listInstalls().length;
  } catch {
    installCount = 0;
  }

  await tui.banner({
    version: packageVersion(),
    skillCount: skills.length,
    installCount,
  });

  while (true) {
    const choice = await tui.chooseMenu("你想做什么？", [
      {
        value: "list",
        label: "查看 Skill 库",
        hint: `${skills.length} 个 skill`,
      },
      {
        value: "install",
        label: "安装 Skill 到 Agent",
        hint: "Codex / OpenCode / Claude / Cursor",
      },
      {
        value: "uninstall",
        label: "卸载 Agent 中的 Skill",
        hint: "清理已安装副本",
      },
      { value: "check", label: "检查更新", hint: "git / npm registry" },
      { value: "update", label: "更新并同步", hint: "pull + sync" },
      { value: "doctor", label: "环境诊断", hint: "目录 / 状态 / 副本" },
      { value: "agents", label: "查看 Agent 目录", hint: "支持列表" },
      { value: "exit", label: "退出", hint: "bye" },
    ]);

    if (!choice || choice === "exit") {
      await tui.outro("已退出 Skill Manager");
      return 0;
    }

    try {
      switch (choice) {
        case "list":
          runList({});
          break;
        case "install":
          await runInstall({}, [], { interactive: true });
          break;
        case "uninstall":
          await runUninstall({}, [], { interactive: true });
          break;
        case "check":
          await runUpdate({ check: true }, { interactive: true });
          break;
        case "update":
          await runUpdate({}, { interactive: true });
          break;
        case "doctor":
          await runDoctor({}, { interactive: true });
          break;
        case "agents":
          runAgents({});
          break;
        default:
          break;
      }
    } catch (error) {
      await tui.log(error.message, "error");
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
        return await runDoctor(parsed.flags);
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
        return await runMenu();
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
