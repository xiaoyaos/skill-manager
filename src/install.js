const fs = require("node:fs");
const path = require("node:path");

const { SKILLS_DIR } = require("./config");
const {
  METADATA_FILE,
  copySkillDir,
  findSkill,
  hashDirectory,
  isSkillDir,
  listSkills,
  readInstallMetadata,
  writeInstallMetadata,
} = require("./skills");
const {
  getInstall,
  listInstalls,
  loadState,
  recordInstall,
  removeInstall,
  saveState,
} = require("./state");
const { exists, isInside, lstatSafe, removePath, timestamp } = require("./util");

function ensureMode(mode) {
  if (mode !== "copy" && mode !== "link") {
    throw new Error(`invalid install mode: ${mode}; use "copy" or "link"`);
  }
}

function resolveLinkTarget(targetPath) {
  const link = fs.readlinkSync(targetPath);
  return path.resolve(path.dirname(targetPath), link);
}

function buildMetadata(entry) {
  return {
    managedBy: "skill-manager",
    skill: entry.skill,
    source: entry.source,
    version: entry.packageVersion,
    mode: entry.mode,
    installedAt: entry.installedAt,
  };
}

function installSkill(options) {
  const {
    skillName,
    agent,
    mode = "copy",
    force = false,
    dryRun = false,
    skillsDir = SKILLS_DIR,
    packageVersion = "",
  } = options;

  ensureMode(mode);
  if (!agent || !agent.skillsDir) {
    throw new Error("agent.skillsDir is required");
  }

  const skill = findSkill(skillName, { skillsDir });
  if (!skill) {
    throw new Error(`skill not found: ${skillName}`);
  }

  const target = path.join(agent.skillsDir, skill.dirName);
  const stat = lstatSafe(target);

  if (stat) {
    if (stat.isSymbolicLink()) {
      const current = resolveLinkTarget(target);
      if (path.resolve(current) === path.resolve(skill.path)) {
        return {
          status: "already",
          skill,
          agent,
          target,
          mode: "link",
        };
      }
    }
    if (!force) {
      const error = new Error(`target already exists: ${target}`);
      error.code = "EEXIST";
      throw error;
    }
    if (!dryRun) {
      removePath(target);
    }
  }

  const entry = {
    agentKey: agent.key,
    agentLabel: agent.label,
    skillsDir: agent.skillsDir,
    skill: skill.dirName,
    mode,
    source: skill.path,
    sourceHash: skill.sourceHash,
    packageVersion,
    installedAt: timestamp(),
  };

  if (dryRun) {
    return { status: "would-install", skill, agent, target, mode };
  }

  fs.mkdirSync(agent.skillsDir, { recursive: true });
  if (mode === "link") {
    fs.symlinkSync(
      skill.path,
      target,
      process.platform === "win32" ? "junction" : "dir",
    );
  } else {
    copySkillDir(skill.path, target);
    writeInstallMetadata(target, buildMetadata(entry));
  }

  recordInstall(entry);
  return { status: "installed", skill, agent, target, mode };
}

function uninstallSkill(options) {
  const {
    skillName,
    agent,
    force = false,
    dryRun = false,
  } = options;

  if (!agent || !agent.skillsDir) {
    throw new Error("agent.skillsDir is required");
  }

  const target = path.join(agent.skillsDir, skillName);
  const stat = lstatSafe(target);
  const stateEntry = getInstall(agent.key, skillName);
  const metadata = stat && !stat.isSymbolicLink() ? readInstallMetadata(target) : null;
  let managed = Boolean(stateEntry || metadata);

  if (stat && stat.isSymbolicLink()) {
    try {
      managed = managed || isInside(resolveLinkTarget(target), SKILLS_DIR);
    } catch {
      managed = managed || false;
    }
  }

  if (!stat) {
    if (!dryRun) {
      removeInstall(agent.key, skillName);
    }
    return { status: "missing", skill: skillName, agent, target };
  }

  if (!managed && !force) {
    const error = new Error(
      `refusing to remove unmanaged path: ${target}; use --force to remove it`,
    );
    error.code = "EUNMANAGED";
    throw error;
  }

  if (stat.isSymbolicLink() && !force) {
    const current = resolveLinkTarget(target);
    if (!isInside(current, SKILLS_DIR)) {
      const error = new Error(
        `refusing to remove symlink that points outside this repository: ${target} -> ${current}; use --force`,
      );
      error.code = "EUNMANAGED";
      throw error;
    }
  }

  if (dryRun) {
    return { status: "would-uninstall", skill: skillName, agent, target };
  }

  removePath(target);
  removeInstall(agent.key, skillName);
  return { status: "uninstalled", skill: skillName, agent, target };
}

function detectInstalls(options = {}) {
  const skillsDir = options.skillsDir || SKILLS_DIR;
  const skills = options.skills || listSkills({ skillsDir });
  const agents = [...(options.agents || [])];

  try {
    for (const entry of listInstalls()) {
      if (!agents.some((agent) => agent.key === entry.agentKey)) {
        agents.push({
          key: entry.agentKey,
          label: entry.agentLabel || entry.agentKey,
          skillsDir: entry.skillsDir,
        });
      }
    }
  } catch {
    // A broken state file should not break "list"; doctor reports it separately.
  }

  const result = [];
  for (const skill of skills) {
    for (const agent of agents) {
      if (!agent.skillsDir) {
        continue;
      }
      const target = path.join(agent.skillsDir, skill.dirName);
      const stat = lstatSafe(target);
      if (!stat) {
        continue;
      }

      let mode = "copy";
      let managed = false;
      if (stat.isSymbolicLink()) {
        mode = "link";
        try {
          const current = resolveLinkTarget(target);
          managed = isInside(current, skillsDir);
        } catch {
          managed = false;
        }
      } else if (stat.isDirectory() && isSkillDir(target)) {
        managed = Boolean(readInstallMetadata(target));
      } else {
        continue;
      }

      result.push({
        skill: skill.dirName,
        skillName: skill.name,
        agentKey: agent.key,
        agentLabel: agent.label,
        path: target,
        mode,
        managed,
      });
    }
  }

  return result;
}

function installStatusForSkill(skillName, installs) {
  return installs
    .filter((item) => item.skill === skillName)
    .map((item) => `${item.agentKey}:${item.mode}${item.managed ? "" : "?"}`);
}

function syncInstalls(options = {}) {
  const {
    dryRun = false,
    force = false,
    skillsDir = SKILLS_DIR,
    packageVersion = "",
  } = options;

  const state = loadState();
  const results = [];
  let changed = false;

  for (const entry of Object.values(state.installs)) {
    const skill = findSkill(entry.skill, { skillsDir });
    const source = skill ? skill.path : entry.source;

    if (!source || !exists(source)) {
      results.push({
        status: "missing-source",
        skill: entry.skill,
        agentKey: entry.agentKey,
        message: `source not found: ${source}`,
      });
      continue;
    }

    const target = path.join(entry.skillsDir, entry.skill);
    const stat = lstatSafe(target);

    if (entry.mode === "link") {
      if (stat && stat.isSymbolicLink()) {
        let current = "";
        try {
          current = resolveLinkTarget(target);
        } catch {
          current = "";
        }
        if (path.resolve(current) === path.resolve(source)) {
          results.push({
            status: "up-to-date",
            skill: entry.skill,
            agentKey: entry.agentKey,
            target,
          });
          continue;
        }
      }
      if (stat && !force) {
        results.push({
          status: "conflict",
          skill: entry.skill,
          agentKey: entry.agentKey,
          target,
          message: "target exists and is not the expected symlink; use --force",
        });
        continue;
      }
      if (dryRun) {
        results.push({
          status: "would-relink",
          skill: entry.skill,
          agentKey: entry.agentKey,
          target,
        });
        continue;
      }
      if (stat) {
        removePath(target);
      }
      fs.mkdirSync(entry.skillsDir, { recursive: true });
      fs.symlinkSync(
        source,
        target,
        process.platform === "win32" ? "junction" : "dir",
      );
      entry.source = source;
      entry.sourceHash = skill ? skill.sourceHash : entry.sourceHash;
      entry.packageVersion = packageVersion;
      entry.installedAt = timestamp();
      changed = true;
      results.push({
        status: "relinked",
        skill: entry.skill,
        agentKey: entry.agentKey,
        target,
      });
      continue;
    }

    const sourceHash = skill ? skill.sourceHash : null;
    const targetHash =
      stat && stat.isDirectory() ? hashDirectory(target) : null;
    const sameHash =
      sourceHash &&
      entry.sourceHash === sourceHash &&
      targetHash === sourceHash;
    if (stat && sameHash && !force) {
      results.push({
        status: "up-to-date",
        skill: entry.skill,
        agentKey: entry.agentKey,
        target,
      });
      continue;
    }

    if (dryRun) {
      results.push({
        status: stat ? "would-update" : "would-install",
        skill: entry.skill,
        agentKey: entry.agentKey,
        target,
      });
      continue;
    }

    if (stat) {
      removePath(target);
    }
    fs.mkdirSync(entry.skillsDir, { recursive: true });
    copySkillDir(source, target);
    entry.source = source;
    entry.sourceHash = sourceHash || entry.sourceHash;
    entry.packageVersion = packageVersion;
    entry.installedAt = timestamp();
    writeInstallMetadata(target, buildMetadata(entry));
    changed = true;
    results.push({
      status: stat ? "updated" : "reinstalled",
      skill: entry.skill,
      agentKey: entry.agentKey,
      target,
    });
  }

  if (changed && !dryRun) {
    saveState(state);
  }

  return results;
}

function staleInstalls(options = {}) {
  const skillsDir = options.skillsDir || SKILLS_DIR;
  const skills = options.skills || listSkills({ skillsDir });
  const byName = new Map(skills.map((skill) => [skill.dirName, skill]));
  const result = [];

  for (const entry of listInstalls()) {
    if (entry.mode !== "copy") {
      continue;
    }
    const skill = byName.get(entry.skill);
    if (!skill) {
      result.push({
        skill: entry.skill,
        agentKey: entry.agentKey,
        reason: "source-missing",
      });
      continue;
    }
    if (entry.sourceHash && entry.sourceHash !== skill.sourceHash) {
      result.push({
        skill: entry.skill,
        agentKey: entry.agentKey,
        reason: "content-changed",
      });
    }
  }
  return result;
}

module.exports = {
  METADATA_FILE,
  detectInstalls,
  installSkill,
  installStatusForSkill,
  staleInstalls,
  syncInstalls,
  uninstallSkill,
};
