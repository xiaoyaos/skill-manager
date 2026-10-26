#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout, stderr } = require("node:process");

const SCRIPT_DIR = __dirname;
const PROJECT_DIR = path.resolve(SCRIPT_DIR, "..");
const SKILLS_DIR = path.join(PROJECT_DIR, "skills");
const CODEX_HOME_DEFAULT = process.env.CODEX_HOME || path.join(process.env.HOME || "", ".codex");

const AGENT_PROFILES = [
  {
    key: "codex-global",
    displayName: "Codex (Global)",
    pathTemplate: "{CODEX_HOME}/skills",
    invokeTip: "在 Codex 对话中输入：使用 $<skill-name>（路径：<installed-path>）",
  },
  {
    key: "codex-project",
    displayName: "Codex (Project)",
    pathTemplate: "{PROJECT_DIR}/.codex/skills",
    invokeTip: "在项目内 Codex 对话中输入：使用 $<skill-name>",
  },
  {
    key: "opencode-global",
    displayName: "OpenCode (Global)",
    pathTemplate: "{HOME}/.agents/skills",
    invokeTip: "在 OpenCode 对话中直接说：使用 <skill-name> skill",
  },
  {
    key: "claude-global",
    displayName: "Claude Code (Global)",
    pathTemplate: "{HOME}/.claude/skills",
    invokeTip: "在 Claude Code 对话中明确写：使用 <skill-name> skill（路径：<installed-path>）",
  },
  {
    key: "claude-project",
    displayName: "Claude Code (Project)",
    pathTemplate: "{PROJECT_DIR}/.claude/skills",
    invokeTip: "在项目上下文中写：使用 <skill-name> skill",
  },
  {
    key: "cursor-global",
    displayName: "Cursor (Global)",
    pathTemplate: "{HOME}/.cursor/skills",
    invokeTip: "在 Cursor Agent 提示词中写：Use skill <skill-name> at <installed-path>",
  },
  {
    key: "cursor-project",
    displayName: "Cursor (Project)",
    pathTemplate: "{PROJECT_DIR}/.cursor/skills",
    invokeTip: "在 Cursor 项目规则/agent 提示中显式指定 <skill-name> 与路径",
  },
  {
    key: "windsurf-global",
    displayName: "Windsurf (Global)",
    pathTemplate: "{HOME}/.codeium/windsurf/skills",
    invokeTip: "在 Windsurf Agent 提示词中显式写：use <skill-name> from <installed-path>",
  },
  {
    key: "windsurf-project",
    displayName: "Windsurf (Project)",
    pathTemplate: "{PROJECT_DIR}/.windsurf/skills",
    invokeTip: "在项目级 Windsurf Agent 提示中指定技能名与路径",
  },
];

function printLine() {
  console.log("------------------------------------------------------------");
}

function resolvePathTemplate(template) {
  return template
    .replaceAll("{HOME}", process.env.HOME || "")
    .replaceAll("{PROJECT_DIR}", PROJECT_DIR)
    .replaceAll("{CODEX_HOME}", CODEX_HOME_DEFAULT);
}

function hasSkillMarker(dirPath) {
  return fs.existsSync(path.join(dirPath, "SKILL.md"));
}

function listLocalSkills() {
  if (!fs.existsSync(SKILLS_DIR)) {
    return [];
  }

  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && hasSkillMarker(path.join(SKILLS_DIR, entry.name)))
    .map((entry) => entry.name);
}

function collectLocalSkills() {
  return listLocalSkills().sort((left, right) => left.localeCompare(right));
}

function showNumbered(items) {
  items.forEach((item, index) => {
    const number = String(index + 1).padStart(2, " ");
    console.log(`${number}. ${item}`);
  });
}

function showSkillLibrary() {
  printLine();
  console.log(`Skill 库列表（来源：${SKILLS_DIR}）`);
  printLine();

  const skills = collectLocalSkills();
  if (skills.length === 0) {
    console.log("当前 skills 目录未发现可安装 skill（缺少子目录中的 SKILL.md）。");
    return;
  }

  showNumbered(skills);
}

async function ask(rl, prompt) {
  const answer = await rl.question(prompt);
  return answer.trim();
}

async function chooseFromArray(rl, title, items) {
  if (items.length === 0) {
    return null;
  }

  console.error(title);
  items.forEach((item, index) => {
    console.error(`  ${index + 1}) ${item}`);
  });
  console.error("  0) 取消");

  while (true) {
    const pick = await ask(rl, "请输入编号: ");
    if (/^\d+$/.test(pick)) {
      const number = Number(pick);
      if (number === 0) {
        return null;
      }
      if (number >= 1 && number <= items.length) {
        return items[number - 1];
      }
    }
    console.error("输入无效，请重试。");
  }
}

async function chooseLocalSkillForInstall(rl, agentSkillsDir) {
  const skills = collectLocalSkills();
  if (skills.length === 0) {
    console.error("[ERROR] 没有可安装的本地 skill。");
    return null;
  }

  while (true) {
    console.error("请选择要安装的 skill（当前项目）:");
    skills.forEach((skillName, index) => {
      const installedDir = path.join(agentSkillsDir, skillName);
      const suffix = hasSkillMarker(installedDir) ? " [已安装]" : "";
      console.error(`  ${index + 1}) ${skillName}${suffix}`);
    });
    console.error("  0) 返回");

    const pick = await ask(rl, "请输入编号: ");
    if (/^\d+$/.test(pick)) {
      const number = Number(pick);
      if (number === 0) {
        return null;
      }
      if (number >= 1 && number <= skills.length) {
        const selectedSkill = skills[number - 1];
        const targetDir = path.join(agentSkillsDir, selectedSkill);
        if (hasSkillMarker(targetDir)) {
          console.error("该 skill 已安装，请重新选择。");
          continue;
        }
        return selectedSkill;
      }
    }

    console.error("输入无效，请重试。");
  }
}

async function chooseAgentProfile(rl) {
  const options = AGENT_PROFILES.map((profile) => profile.displayName);
  options.push("自定义 Agent 路径");

  const chosenDisplay = await chooseFromArray(rl, "请选择目标 Agent:", options);
  if (!chosenDisplay) {
    return null;
  }

  if (chosenDisplay === "自定义 Agent 路径") {
    const customName = await ask(rl, "请输入自定义 Agent 名称: ");
    const customPath = await ask(rl, "请输入该 Agent 的 skills 目录绝对路径: ");
    const customTip = `在该 Agent 的提示词中显式指定 skill 名称与路径：${customPath}/<skill-name>`;

    return {
      key: "custom",
      displayName: customName,
      skillsDir: customPath,
      invokeTip: customTip,
    };
  }

  const matched = AGENT_PROFILES.find((profile) => profile.displayName === chosenDisplay);
  if (!matched) {
    return null;
  }

  return {
    key: matched.key,
    displayName: matched.displayName,
    skillsDir: resolvePathTemplate(matched.pathTemplate),
    invokeTip: matched.invokeTip,
  };
}

async function ensureAgentDir(rl, agentSkillsDir) {
  if (!fs.existsSync(agentSkillsDir)) {
    console.log("[CHECK] Agent skills 目录不存在。");
    const createDir = await ask(rl, "是否创建该目录？(y/N): ");
    if (/^[Yy]$/.test(createDir)) {
      fs.mkdirSync(agentSkillsDir, { recursive: true });
      console.log(`[PASS] 已创建目录：${agentSkillsDir}`);
      return true;
    }
    return false;
  }

  console.log("[PASS] Agent skills 目录存在。");
  return true;
}

function showInstalledSkills(agentSkillsDir) {
  if (!fs.existsSync(agentSkillsDir)) {
    console.log("[INFO] 未发现已安装 skill。");
    return false;
  }

  const installed = fs
    .readdirSync(agentSkillsDir, { withFileTypes: true })
    .filter((entry) => hasSkillMarker(path.join(agentSkillsDir, entry.name)))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  if (installed.length === 0) {
    console.log("[INFO] 未发现已安装 skill。");
    return false;
  }

  showNumbered(installed);
  return true;
}

function listLocalInstalledForAgent(agentSkillsDir) {
  return collectLocalSkills().filter((skillName) => hasSkillMarker(path.join(agentSkillsDir, skillName)));
}

async function installSkillForAgent(rl, agentName, agentSkillsDir, agentTip) {
  if (!(await ensureAgentDir(rl, agentSkillsDir))) {
    console.log("已取消安装。");
    return;
  }

  const selectedSkill = await chooseLocalSkillForInstall(rl, agentSkillsDir);
  if (!selectedSkill) {
    console.log("已取消。");
    return;
  }

  const sourceDir = path.join(SKILLS_DIR, selectedSkill);
  const targetDir = path.join(agentSkillsDir, selectedSkill);

  console.log();
  console.log("选择结果：");
  console.log(`- Agent: ${agentName}`);
  console.log(`- Skill: ${selectedSkill}`);
  console.log(`- Agent skills 目录: ${agentSkillsDir}`);

  if (hasSkillMarker(targetDir)) {
    console.log("[CHECK] 该 skill 已安装，请重新选择或返回。");
    return;
  }

  const confirm = await ask(rl, `确认安装 ${selectedSkill} -> ${agentName} ? (y/N): `);
  if (!/^[Yy]$/.test(confirm)) {
    console.log("已取消安装。");
    return;
  }

  fs.cpSync(sourceDir, targetDir, { recursive: true });

  console.log();
  console.log(`[PASS] 安装完成：${targetDir}`);
  console.log();
  console.log(`调用方式提示（${agentName}）：`);
  console.log(`- ${agentTip}`);
  console.log(`- 推荐显式写法：使用 ${selectedSkill}（路径：${targetDir}）`);
  console.log();
}

async function uninstallSkillForAgent(rl, agentName, agentSkillsDir) {
  if (!fs.existsSync(agentSkillsDir)) {
    console.log("[WARN] Agent skills 目录不存在。");
    return;
  }

  const removable = listLocalInstalledForAgent(agentSkillsDir);
  if (removable.length === 0) {
    console.log("[INFO] 当前 Agent 没有可卸载的“当前项目 skill”。");
    return;
  }

  const selectedSkill = await chooseFromArray(rl, "请选择要卸载的 skill（仅当前项目）:", removable);
  if (!selectedSkill) {
    console.log("已取消。");
    return;
  }

  const targetDir = path.join(agentSkillsDir, selectedSkill);
  const confirm = await ask(rl, `确认卸载 ${selectedSkill} <- ${agentName} ? (y/N): `);
  if (!/^[Yy]$/.test(confirm)) {
    console.log("已取消卸载。");
    return;
  }

  const targetStat = fs.lstatSync(targetDir);
  if (targetStat.isSymbolicLink()) {
    fs.unlinkSync(targetDir);
  } else {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  console.log(`[PASS] 已卸载：${targetDir}`);
}

async function manageAgentSkills(rl) {
  printLine();
  console.log("Agent 技能管理（安装/卸载）");
  printLine();

  const selectedAgent = await chooseAgentProfile(rl);
  if (!selectedAgent) {
    console.log("已取消。");
    return;
  }

  while (true) {
    printLine();
    console.log(`当前 Agent: ${selectedAgent.displayName}`);
    console.log(`Skills 目录: ${selectedAgent.skillsDir}`);
    printLine();
    console.log("已安装skill：");
    if (!fs.existsSync(selectedAgent.skillsDir)) {
      console.log("[INFO] 目录不存在，当前已安装 skill 为 0。");
    } else {
      showInstalledSkills(selectedAgent.skillsDir);
    }
    printLine();
    console.log("1) 安装skill（仅当前项目）");
    console.log("2) 卸载skill（仅当前项目）");
    console.log("0) 返回上级");

    const sub = await ask(rl, "请选择: ");
    switch (sub) {
      case "1":
        await installSkillForAgent(
          rl,
          selectedAgent.displayName,
          selectedAgent.skillsDir,
          selectedAgent.invokeTip,
        );
        break;
      case "2":
        await uninstallSkillForAgent(rl, selectedAgent.displayName, selectedAgent.skillsDir);
        break;
      case "0":
        return;
      default:
        console.log("输入无效，请重试。");
        break;
    }
  }
}

async function mainMenu(rl) {
  while (true) {
    printLine();
    console.log("Skill 交互管理器");
    console.log(`目录: ${SKILLS_DIR}`);
    printLine();
    console.log("1) 查看 skill 库列表");
    console.log("2) Agent管理");
    console.log("0) 退出");

    const choice = await ask(rl, "请选择: ");
    switch (choice) {
      case "1":
        showSkillLibrary();
        break;
      case "2":
        await manageAgentSkills(rl);
        break;
      case "0":
        console.log("已退出。");
        return;
      default:
        console.log("输入无效，请重试。");
        break;
    }
  }
}

async function run() {
  if (!fs.existsSync(SKILLS_DIR)) {
    console.error(`[ERROR] skills 目录不存在：${SKILLS_DIR}`);
    process.exitCode = 1;
    return;
  }

  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: Boolean(stdin.isTTY && stdout.isTTY),
  });

  process.on("SIGINT", () => {
    rl.close();
    stderr.write("\n已中断。\n");
    process.exit(130);
  });

  try {
    await mainMenu(rl);
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error("[ERROR] CLI 运行失败：", error.message);
  process.exitCode = 1;
});
