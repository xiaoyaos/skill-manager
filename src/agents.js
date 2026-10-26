const path = require("node:path");

const { codexHome, homeDir } = require("./config");

const AGENT_PROFILES = [
  {
    key: "codex-global",
    label: "Codex (Global)",
    agent: "codex",
    scope: "global",
    pathTemplate: "{CODEX_HOME}/skills",
    invokeTip: "在 Codex 对话中输入：使用 $<skill-name>（路径：<installed-path>）",
  },
  {
    key: "codex-project",
    label: "Codex (Project)",
    agent: "codex",
    scope: "project",
    pathTemplate: "{CWD}/.codex/skills",
    invokeTip: "在项目内 Codex 对话中输入：使用 $<skill-name>",
  },
  {
    key: "opencode-global",
    label: "OpenCode (Global)",
    agent: "opencode",
    scope: "global",
    pathTemplate: "{HOME}/.agents/skills",
    invokeTip: "在 OpenCode 对话中直接说：使用 <skill-name> skill",
  },
  {
    key: "claude-global",
    label: "Claude Code (Global)",
    agent: "claude",
    scope: "global",
    pathTemplate: "{HOME}/.claude/skills",
    invokeTip: "在 Claude Code 对话中明确写：使用 <skill-name> skill（路径：<installed-path>）",
  },
  {
    key: "claude-project",
    label: "Claude Code (Project)",
    agent: "claude",
    scope: "project",
    pathTemplate: "{CWD}/.claude/skills",
    invokeTip: "在项目上下文中写：使用 <skill-name> skill",
  },
  {
    key: "cursor-global",
    label: "Cursor (Global)",
    agent: "cursor",
    scope: "global",
    pathTemplate: "{HOME}/.cursor/skills",
    invokeTip: "在 Cursor Agent 提示词中写：Use skill <skill-name> at <installed-path>",
  },
  {
    key: "cursor-project",
    label: "Cursor (Project)",
    agent: "cursor",
    scope: "project",
    pathTemplate: "{CWD}/.cursor/skills",
    invokeTip: "在 Cursor 项目规则/agent 提示中显式指定 <skill-name> 与路径",
  },
  {
    key: "windsurf-global",
    label: "Windsurf (Global)",
    agent: "windsurf",
    scope: "global",
    pathTemplate: "{HOME}/.codeium/windsurf/skills",
    invokeTip: "在 Windsurf Agent 提示词中显式写：use <skill-name> from <installed-path>",
  },
  {
    key: "windsurf-project",
    label: "Windsurf (Project)",
    agent: "windsurf",
    scope: "project",
    pathTemplate: "{CWD}/.windsurf/skills",
    invokeTip: "在项目级 Windsurf Agent 提示中指定技能名与路径",
  },
];

function resolvePathTemplate(template, options = {}) {
  const cwd = options.projectDir ? path.resolve(options.projectDir) : process.cwd();
  return template
    .replaceAll("{HOME}", homeDir())
    .replaceAll("{CODEX_HOME}", codexHome())
    .replaceAll("{CWD}", cwd);
}

function materialize(profile, options = {}) {
  return {
    ...profile,
    skillsDir: resolvePathTemplate(profile.pathTemplate, options),
  };
}

function listAgentProfiles() {
  return AGENT_PROFILES.map((profile) => ({ ...profile }));
}

function findProfile(key) {
  const normalized = String(key || "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return (
    AGENT_PROFILES.find((profile) => profile.key === normalized) ||
    AGENT_PROFILES.find((profile) => profile.label.toLowerCase() === normalized) ||
    null
  );
}

function resolveAgent(options = {}) {
  if (options.customPath) {
    const skillsDir = path.resolve(options.customPath);
    return {
      key: "custom",
      label: options.customName || "Custom Agent",
      agent: "custom",
      scope: "custom",
      pathTemplate: skillsDir,
      skillsDir,
      invokeTip: `在该 Agent 的提示词中显式指定 skill 名称与路径：${skillsDir}/<skill-name>`,
    };
  }

  let profile = null;
  if (options.key) {
    profile = findProfile(options.key);
    if (!profile) {
      throw new Error(
        `unknown agent: ${options.key}. Run "skill-manager agents" to list supported agents.`,
      );
    }
  }

  if (!profile && options.agent) {
    const agent = String(options.agent).toLowerCase();
    const matches = AGENT_PROFILES.filter((item) => item.agent === agent);
    if (matches.length === 0) {
      throw new Error(
        `unknown agent: ${options.agent}. Run "skill-manager agents" to list supported agents.`,
      );
    }
    if (options.scope) {
      if (options.scope !== "global" && options.scope !== "project") {
        throw new Error(`invalid scope: ${options.scope}; use global or project`);
      }
      profile = matches.find((item) => item.scope === options.scope) || null;
      if (!profile) {
        throw new Error(
          `agent ${options.agent} does not support ${options.scope} scope`,
        );
      }
    } else {
      profile = matches.find((item) => item.scope === "global") || matches[0];
    }
  }

  if (!profile) {
    profile = AGENT_PROFILES[0];
  }

  return materialize(profile, options);
}

function agentByKey(key) {
  const profile = AGENT_PROFILES.find((item) => item.key === key);
  return profile ? materialize(profile) : null;
}

module.exports = {
  AGENT_PROFILES,
  agentByKey,
  findProfile,
  listAgentProfiles,
  resolveAgent,
  resolvePathTemplate,
};
