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
  visualWidth,
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
  const column = 34;
  const section = (title) => {
    console.log();
    console.log(`  ${pc.bold(pc.cyan(title))}`);
  };
  const row = (left, right, color = pc.cyan) => {
    console.log(
      `    ${color(padVisual(left, column))}  ${pc.dim(right)}`,
    );
  };
  const example = (command) => {
    console.log(`    ${pc.dim("$")} ${command.replace(/^skm/, pc.green("skm"))}`);
  };

  console.log(`  ${pc.bold("Skill Manager")} ${pc.dim(`v${packageVersion()}`)}`);
  console.log(`  ${pc.dim("UJoin 自研 AI Skills 全生命周期管理 CLI")}`);

  section("用法");
  console.log(`    ${pc.green("skm")} <command> [options]`);
  console.log(`    ${pc.green("skill-manager")} <command> [options]`);
  console.log(
    `    ${pc.dim("不指定命令时启动交互式终端；非 TTY 环境回退为帮助信息。")}`,
  );

  section("常用");
  row("skm", "交互式终端");
  row("skm ls", "查看 skill 库和安装状态");
  row("skm i <skill> --agent codex", "安装到 Codex");
  row("skm un <skill> --agent codex", "从 Codex 卸载");
  row("skm up", "更新本地仓库，不修改已安装 Skill");

  section("命令");
  row("list, ls", "查看 skill 库和安装状态");
  row("install, i, add [skill...]", "安装 skill 到 Agent");
  row("uninstall, un, rm [skill...]", "卸载 Agent 中的 skill");
  row("update, up, upgrade", "更新本地 CLI / 仓库");
  row("sync", "更新已安装 Skill 副本");
  row("doctor, status", "环境与安装诊断");
  row("agents", "查看支持的 Agent 及目录");
  row("link", "以 symlink 安装全部 skill");
  row("menu", "交互式终端");
  row("help, -h", "显示帮助");
  row("version, -v", "显示版本");

  section("Agent");
  row("--agent <key>", "codex / opencode / claude / cursor / windsurf", pc.yellow);
  row("--scope <global|project>", "默认 global", pc.yellow);
  row("--project <dir>", "项目目录，默认当前目录", pc.yellow);
  row("--path <dir>", "自定义 Agent skills 目录", pc.yellow);

  section("安装");
  row("--copy", "复制安装（默认）", pc.yellow);
  row("--link", "符号链接安装（本地开发）", pc.yellow);
  row("--all", "对所有 skill 操作", pc.yellow);
  row("--force", "覆盖目标，或删除未托管目录", pc.yellow);

  section("其他");
  row("--yes, -y", "跳过确认", pc.yellow);
  row("--check", "update 只检查本地仓库更新", pc.yellow);
  row("--dry-run", "sync 只检查已安装 Skill 更新", pc.yellow);
  row("--json", "list / agents 输出 JSON", pc.yellow);
  row("--verbose", "显示完整描述和路径", pc.yellow);

  section("示例");
  example("skm");
  example("skm i uj-weekly-report --agent codex");
  example("skm i --all --agent codex --link");
  example("skm un uj-weekly-report --agent codex --yes");
  example("skm up --check");
  example("skm sync --dry-run");
  example("skm sync");
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

function terminalWidth() {
  const columns = process.stdout.columns || 0;
  return Math.min(Math.max(columns || 120, 80), 160);
}

function colorTag(level) {
  const tag = `[${level}]`;
  switch (level) {
    case "PASS":
    case "OK":
      return pc.green(tag);
    case "WARN":
    case "SKIP":
      return pc.yellow(tag);
    case "FAIL":
    case "ERROR":
      return pc.red(tag);
    case "UPDATE":
    case "SYNC":
      return pc.cyan(tag);
    case "DRY-RUN":
      return pc.magenta(tag);
    case "INFO":
      return pc.dim(tag);
    default:
      return tag;
  }
}

function shortAgentLabel(label) {
  return String(label || "")
    .replace(/\s*\(Global\)$/i, "")
    .replace(/\s*\(Project\)$/i, " · project");
}

function formatInstallCell(skillName, installs) {
  const items = installs.filter((item) => item.skill === skillName);
  if (items.length === 0) {
    return { text: "—", installed: false, unmanaged: false };
  }
  const text = items
    .map(
      (item) =>
        `${shortAgentLabel(item.agentLabel)} · ${item.mode}${item.managed ? "" : "!"}`,
    )
    .join(", ");
  return {
    text,
    installed: true,
    unmanaged: items.some((item) => !item.managed),
  };
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
    console.log(`${colorTag("SKIP")} ${result.skill.dirName} 已安装：${result.target}`);
    return;
  }
  if (result.status === "would-install") {
    console.log(
      `${colorTag("DRY-RUN")} ${result.skill.dirName} -> ${result.agent.label} (${result.mode})`,
    );
    return;
  }
  console.log(
    `${colorTag("PASS")} ${result.skill.dirName} -> ${result.agent.label} (${result.mode})`,
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
            console.log(`${colorTag("WARN")} ${message}：${error.message}`);
          }
        } else if (interactive) {
          lines.push(`${pc.red("✗")} ${skill.dirName}: ${error.message}`);
        } else {
          console.log(`${colorTag("FAIL")} ${skill.dirName}: ${error.message}`);
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
          console.log(`${colorTag("SKIP")} ${name} 未安装：${result.target}`);
        } else if (result.status === "would-uninstall") {
          console.log(
            `${colorTag("DRY-RUN")} 卸载 ${name} <- ${agent.label}: ${result.target}`,
          );
        } else {
          console.log(`${colorTag("PASS")} 已卸载 ${name} <- ${agent.label}`);
        }
      } catch (error) {
        failures += 1;
        if (interactive) {
          lines.push(`${pc.red("✗")} ${name}: ${error.message}`);
        } else {
          console.log(`${colorTag("FAIL")} ${name}: ${error.message}`);
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
  const rows = skills.map((skill) => ({
    skill,
    status: formatInstallCell(skill.dirName, installs),
  }));

  const nameWidth = Math.max(
    4,
    ...rows.map((row) => Math.min(30, visualWidth(row.skill.dirName))),
  );
  const nameCellWidth = nameWidth + 2;
  const filesWidth = 5;
  const installedWidth = Math.min(
    34,
    Math.max(
      9,
      ...rows.map((row) => Math.min(34, visualWidth(row.status.text))),
    ),
  );
  const gap = 2;
  const indent = 2;
  const fixedWidth =
    indent + nameCellWidth + gap * 3 + filesWidth + installedWidth;
  const descriptionWidth = Math.max(
    16,
    Math.min(
      options.verbose ? 120 : 100,
      terminalWidth() - fixedWidth,
    ),
  );

  const header = [
    padVisual("NAME", nameCellWidth),
    padVisual("FILES", filesWidth),
    padVisual("INSTALLED", installedWidth),
    "DESCRIPTION",
  ]
    .map((cell) => pc.bold(cell))
    .join("  ");
  console.log(`  ${header}`);
  console.log(
    `  ${pc.dim(
      [
        "─".repeat(nameCellWidth),
        "─".repeat(filesWidth),
        "─".repeat(installedWidth),
        "─".repeat(descriptionWidth),
      ].join("  "),
    )}`,
  );

  let hasUnmanaged = false;
  for (const { skill, status } of rows) {
    if (status.unmanaged) {
      hasUnmanaged = true;
    }
    const dot = status.installed
      ? status.unmanaged
        ? pc.yellow("!")
        : pc.green("●")
      : pc.dim("○");
    const name = pc.bold(
      padVisual(truncateVisual(skill.dirName, nameWidth), nameWidth),
    );
    const files = pc.dim(padVisual(String(skill.fileCount), filesWidth));
    const installed = padVisual(
      truncateVisual(status.text, installedWidth),
      installedWidth,
    );
    const installedCell = status.installed
      ? status.unmanaged
        ? pc.yellow(installed)
        : installed
      : pc.dim(installed);
    const description = pc.dim(
      truncateVisual(
        options.verbose
          ? skill.description
          : skill.shortDescription || skill.description,
        descriptionWidth,
      ),
    );

    console.log(`  ${dot} ${name}  ${files}  ${installedCell}  ${description}`);
    if (options.verbose) {
      console.log(`    ${pc.dim(`path  ${skill.path}`)}`);
      console.log(`    ${pc.dim(`desc  ${skill.description}`)}`);
    }
  }

  const legend = [
    `${pc.green("●")} 已安装`,
    `${pc.dim("○")} 未安装`,
    hasUnmanaged ? `${pc.yellow("!")} 未托管` : "",
  ]
    .filter(Boolean)
    .join("  ");
  console.log();
  console.log(`  ${legend}`);
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

  const installedSkills = new Set(installs.map((item) => item.skill)).size;
  const installedAgents = new Set(installs.map((item) => item.agentKey)).size;
  console.log(
    `  ${pc.bold("Skill Manager")} ${pc.dim(`v${packageVersion()}`)}  ${pc.dim("·")}  ${pc.bold(String(skills.length))} 个 skill  ${pc.dim("·")}  ${pc.bold(String(installedSkills))} 个已安装  ${pc.dim("·")}  ${pc.bold(String(installedAgents))} 个 Agent`,
  );
  console.log(`  ${pc.dim(`库路径  ${displayPath(SKILLS_DIR)}`)}`);
  console.log();

  if (skills.length === 0) {
    console.log(`${colorTag("WARN")} 没有找到任何 skill。`);
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
    pathLabel: displayPath(agent.skillsDir),
    exists: exists(agent.skillsDir),
    skills: countSkillDirs(agent.skillsDir),
  }));

  if (flags.json) {
    console.log(JSON.stringify({ agents: rows }, null, 2));
    return 0;
  }

  const labelWidth = Math.max(
    6,
    ...rows.map((row) => Math.min(28, visualWidth(row.label))),
  );
  const labelCellWidth = labelWidth + 2;
  const keyWidth = Math.max(
    6,
    ...rows.map((row) => Math.min(20, visualWidth(row.key))),
  );
  const scopeWidth = 7;
  const skillsWidth = 6;
  const fixedWidth =
    2 + labelCellWidth + 2 * 4 + keyWidth + scopeWidth + skillsWidth;
  const maxPathWidth = Math.min(
    56,
    Math.max(16, ...rows.map((row) => visualWidth(row.pathLabel))),
  );
  const pathWidth = Math.max(
    12,
    Math.min(maxPathWidth, terminalWidth() - fixedWidth),
  );
  const existing = rows.filter((row) => row.exists).length;

  console.log(
    `  ${pc.bold("Agent 目录")}  ${pc.dim("·")}  ${pc.bold(String(rows.length))} 个  ${pc.dim("·")}  ${pc.bold(String(existing))} 个已创建`,
  );
  console.log();
  console.log(
    `  ${[
      padVisual("AGENT", labelCellWidth),
      padVisual("KEY", keyWidth),
      padVisual("SCOPE", scopeWidth),
      padVisual("SKILLS", skillsWidth),
      "PATH",
    ]
      .map((cell) => pc.bold(cell))
      .join("  ")}`,
  );
  console.log(
    `  ${pc.dim(
      [
        "─".repeat(labelCellWidth),
        "─".repeat(keyWidth),
        "─".repeat(scopeWidth),
        "─".repeat(skillsWidth),
        "─".repeat(pathWidth),
      ].join("  "),
    )}`,
  );

  for (const row of rows) {
    const dot = row.exists ? pc.green("●") : pc.dim("○");
    const label = padVisual(
      truncateVisual(row.label, labelWidth),
      labelWidth,
    );
    const key = pc.dim(padVisual(row.key, keyWidth));
    const scope = pc.dim(padVisual(row.scope, scopeWidth));
    const skills = row.skills > 0
      ? pc.green(padVisual(String(row.skills), skillsWidth))
      : pc.dim(padVisual("0", skillsWidth));
    const path = pc.dim(truncateVisual(row.pathLabel, pathWidth));
    console.log(
      `  ${dot} ${label}  ${key}  ${scope}  ${skills}  ${path}`,
    );
  }

  console.log();
  console.log(`  ${pc.green("●")} 目录存在  ${pc.dim("○")} 未创建`);
  return 0;
}

function updateInfoLines(info) {
  const lines = [
    `${pc.dim("模式")}      ${info.mode === "git" ? "git checkout" : "npm global"}`,
    `${pc.dim("目录")}      ${displayPath(info.root)}`,
    `${pc.dim("当前版本")}  ${info.current}`,
  ];
  if (info.branch) {
    lines.push(
      `${pc.dim("分支")}      ${info.branch}${info.upstream ? ` -> ${info.upstream}` : ""}`,
    );
  }

  switch (info.status) {
    case "available":
      lines.push(
        `${colorTag("UPDATE")} 有新版本: ${info.current}${info.latest ? ` -> ${info.latest}` : ""}${
          info.behind ? `（落后 ${info.behind} 个提交）` : ""
        }`,
      );
      if (info.ahead) {
        lines.push(
          `${colorTag("WARN")} 本地领先 upstream ${info.ahead} 个提交`,
        );
      }
      if (info.dirty) {
        lines.push(
          `${colorTag("WARN")} Git 工作区有未提交改动，自动更新会被拒绝`,
        );
      }
      break;
    case "up-to-date":
      lines.push(
        `${colorTag("PASS")} 已是最新版本${info.ahead ? `（本地领先 ${info.ahead} 个提交）` : ""}`,
      );
      break;
    case "no-remote":
    case "no-upstream":
      lines.push(`${colorTag("WARN")} ${info.message}`);
      break;
    case "fetch-failed":
      lines.push(`${colorTag("FAIL")} 拉取远端失败: ${info.message}`);
      break;
    case "unpublished":
      lines.push(`${colorTag("WARN")} ${info.message}`);
      lines.push(
        `${colorTag("INFO")} 当前是本地/未发布安装；更新请回到源码仓库执行 git pull，或重新 npm install -g <path>`,
      );
      break;
    default:
      lines.push(`${colorTag("INFO")} ${info.message || info.status}`);
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

const PENDING_INSTALL_STATUSES = new Set([
  "would-update",
  "would-install",
  "would-relink",
]);
const INSTALL_ISSUE_STATUSES = new Set(["conflict", "missing-source"]);

function installedUpdateCheckLines(results) {
  if (results.length === 0) {
    return [`${colorTag("INFO")} 没有记录到通过本 CLI 安装的副本。`];
  }

  const pending = results.filter((result) =>
    PENDING_INSTALL_STATUSES.has(result.status),
  );
  const issues = results.filter((result) =>
    INSTALL_ISSUE_STATUSES.has(result.status),
  );
  const lines = [];

  for (const result of pending) {
    const action =
      result.status === "would-update"
        ? "副本与源不一致，可同步更新"
        : result.status === "would-install"
          ? "目标缺失，可重新安装"
          : "符号链接有变化，可重新链接";
    lines.push(
      `${colorTag("UPDATE")} ${result.skill} @ ${result.agentKey}: ${action}${
        result.target ? ` -> ${result.target}` : ""
      }`,
    );
  }
  for (const result of issues) {
    lines.push(
      `${colorTag("WARN")} ${result.skill} @ ${result.agentKey}: ${
        result.message || result.status
      }`,
    );
  }

  if (pending.length === 0 && issues.length === 0) {
    lines.push(`${colorTag("PASS")} 本地安装 ${results.length} 个，全部为最新`);
  } else {
    lines.push(
      `${colorTag("INFO")} 本地安装 ${results.length} 个：${pending.length} 个可同步，${issues.length} 个异常`,
    );
  }
  return lines;
}

function printInstalledUpdateCheck(results) {
  console.log(`${colorTag("INFO")} 本地安装更新检查`);
  for (const line of installedUpdateCheckLines(results)) {
    console.log(line);
  }
}

async function runUpdate(flags, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  const check = context.checkUpdate || checkUpdate;
  const applyUpdate = context.performUpdate || performUpdate;
  const ui = context.ui || tui;

  let info;
  if (interactive) {
    info = await ui.withSpinner(
      { start: "检查本地仓库更新…", success: "检查完成", failure: "检查更新失败" },
      () => check(),
    );
    await ui.note(updateInfoLines(info).join("\n"), "本地仓库更新检查");
  } else {
    info = await check();
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
      console.log(`${colorTag("INFO")} 非交互环境，确认更新请加 --yes`);
      return 0;
    }
    const result = await applyUpdate(info, { yes: true });
    if (result.status === "updated") {
      console.log(`${colorTag("PASS")} 本地仓库更新完成，当前版本 ${result.version}`);
      console.log(`${colorTag("INFO")} 如需更新已安装 Skill，请运行 skill-manager sync`);
    }
    return 0;
  }

  if (!flags.yes) {
    const ok = await ui.confirmAction("确认更新本地仓库？", {
      initialValue: true,
    });
    if (!ok) {
      await ui.cancel("已取消更新");
      return 0;
    }
  }

  const result = await ui.withSpinner(
    {
      start: info.mode === "git" ? "正在更新本地仓库…" : "正在更新 CLI…",
      success: (outcome) =>
        outcome.status === "updated"
          ? `本地仓库已更新：v${outcome.version}`
          : "已跳过",
      failure: "本地仓库更新失败",
    },
    () =>
      applyUpdate(info, {
        yes: true,
        quiet: true,
      }),
  );

  if (result.status === "cancelled") {
    await ui.cancel("已取消更新");
    return 0;
  }
  if (result.status === "updated") {
    await ui.note(
      `${pc.green("✓")} 当前版本 ${pc.bold(result.version)}\n${pc.dim("已安装 Skill 未变更；如需同步请选择“更新已安装 Skill”。")}`,
      "本地仓库更新完成",
    );
    await ui.outro("本地仓库已更新");
  }
  return 0;
}

async function runSync(flags, context = {}) {
  const interactive = context.interactive ?? isInteractive();
  const ui = context.ui || tui;
  const force = Boolean(flags.force);
  const dryRun = Boolean(flags["dry-run"]);

  if (!interactive) {
    const results = syncInstalls({
      dryRun,
      force,
      packageVersion: packageVersion(),
    });

    if (results.length === 0) {
      console.log(`${colorTag("INFO")} 没有记录到通过本 CLI 安装的副本。`);
      return 0;
    }

    for (const result of results) {
      const label =
        result.status === "up-to-date"
          ? "OK"
          : INSTALL_ISSUE_STATUSES.has(result.status)
            ? "WARN"
            : "PASS";
      console.log(
        `${colorTag(label)} ${result.status}: ${result.skill} @ ${result.agentKey}${
          result.target ? ` -> ${result.target}` : ""
        }${result.message ? ` (${result.message})` : ""}`,
      );
    }
    return results.some((result) => INSTALL_ISSUE_STATUSES.has(result.status))
      ? 1
      : 0;
  }

  const preview = syncInstalls({
    dryRun: true,
    force,
    packageVersion: packageVersion(),
  });
  if (preview.length === 0) {
    await ui.note(
      `${colorTag("INFO")} 没有记录到通过本 CLI 安装的副本。`,
      "已安装 Skill 更新检查",
    );
    return 0;
  }

  const pending = preview.filter((result) =>
    PENDING_INSTALL_STATUSES.has(result.status),
  );
  const hasIssues = preview.some((result) =>
    INSTALL_ISSUE_STATUSES.has(result.status),
  );
  await ui.note(
    installedUpdateCheckLines(preview).join("\n"),
    "已安装 Skill 更新检查",
  );

  if (dryRun) {
    return hasIssues ? 1 : 0;
  }
  if (pending.length === 0) {
    await ui.outro(hasIssues ? "存在需要处理的安装异常" : "已安装 Skill 均为最新");
    return hasIssues ? 1 : 0;
  }

  if (!flags.yes) {
    const shouldSync = await ui.confirmAction(
      `发现 ${pending.length} 个已安装 Skill 可更新，是否立即更新？`,
      { initialValue: true },
    );
    if (!shouldSync) {
      await ui.cancel("已取消更新已安装 Skill");
      return 0;
    }
  }

  const syncResults = await ui.withSpinner(
    {
      start: "正在更新已安装 Skill…",
      success: "已安装 Skill 更新完成",
      failure: "已安装 Skill 更新失败",
    },
    () =>
      syncInstalls({
        force,
        packageVersion: packageVersion(),
      }),
  );
  const lines = [formatSyncSummary(syncResults) || "没有发生变更"];
  for (const result of syncResults) {
    if (INSTALL_ISSUE_STATUSES.has(result.status)) {
      lines.push(
        `${colorTag("WARN")} ${result.skill} @ ${result.agentKey}: ${
          result.message || result.status
        }`,
      );
    }
  }
  await ui.note(lines.join("\n"), "已安装 Skill 更新结果");
  await ui.outro("重新打开 Agent 会话后生效");
  return syncResults.some((result) =>
    INSTALL_ISSUE_STATUSES.has(result.status),
  )
    ? 1
    : 0;
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
    console.log(`${colorTag(check.level)} ${check.message}`);
  }
  const errors = checks.filter((check) => check.level === "FAIL").length;
  const warnings = checks.filter((check) => check.level === "WARN").length;
  console.log();
  console.log(
    `${colorTag(errors > 0 ? "FAIL" : "PASS")} ${checks.length} 项检查，${pc.bold(String(errors))} error(s)，${pc.bold(String(warnings))} warning(s)`,
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
      {
        value: "repo-check",
        label: "检查并更新本地仓库",
        hint: "有更新时确认",
      },
      {
        value: "skills-check",
        label: "检查并更新已安装 Skill",
        hint: "有更新时确认",
      },
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
        case "repo-check":
          await runUpdate({}, { interactive: true });
          break;
        case "skills-check":
          await runSync({}, { interactive: true });
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
        return await runSync(parsed.flags);
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
  runSync,
  runUpdate,
};
