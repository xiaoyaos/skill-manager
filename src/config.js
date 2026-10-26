const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");

function homeDir() {
  return process.env.HOME || os.homedir();
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(homeDir(), ".codex");
}

function stateDir() {
  if (process.env.SKILL_MANAGER_HOME) {
    return path.resolve(process.env.SKILL_MANAGER_HOME);
  }
  const configHome = process.env.XDG_CONFIG_HOME
    ? path.resolve(process.env.XDG_CONFIG_HOME)
    : path.join(homeDir(), ".config");
  return path.join(configHome, "skill-manager");
}

function stateFile() {
  return path.join(stateDir(), "state.json");
}

function readPackage() {
  return JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
}

function packageVersion() {
  return readPackage().version;
}

function packageName() {
  return readPackage().name;
}

module.exports = {
  PACKAGE_ROOT,
  SKILLS_DIR,
  codexHome,
  homeDir,
  packageName,
  packageVersion,
  readPackage,
  stateDir,
  stateFile,
};
