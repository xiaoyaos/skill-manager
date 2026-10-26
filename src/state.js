const { stateFile } = require("./config");
const { exists, readJson, writeJsonAtomic } = require("./util");

const STATE_VERSION = 1;

function emptyState() {
  return {
    version: STATE_VERSION,
    installs: {},
  };
}

function loadState() {
  const filePath = stateFile();
  if (!exists(filePath)) {
    return emptyState();
  }
  let data;
  try {
    data = readJson(filePath, emptyState());
  } catch (error) {
    throw new Error(`invalid state file ${filePath}: ${error.message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`invalid state file ${filePath}: expected an object`);
  }
  if (!data.installs || typeof data.installs !== "object" || Array.isArray(data.installs)) {
    data.installs = {};
  }
  data.version = STATE_VERSION;
  return data;
}

function saveState(state) {
  writeJsonAtomic(stateFile(), state);
}

function installKey(agentKey, skillName) {
  return `${agentKey}:${skillName}`;
}

function getInstall(agentKey, skillName) {
  return loadState().installs[installKey(agentKey, skillName)] || null;
}

function recordInstall(entry) {
  const state = loadState();
  state.installs[installKey(entry.agentKey, entry.skill)] = entry;
  saveState(state);
  return entry;
}

function removeInstall(agentKey, skillName) {
  const state = loadState();
  const key = installKey(agentKey, skillName);
  if (!state.installs[key]) {
    return false;
  }
  delete state.installs[key];
  saveState(state);
  return true;
}

function listInstalls() {
  const state = loadState();
  return Object.values(state.installs).sort((left, right) => {
    const agentCompare = String(left.agentKey).localeCompare(String(right.agentKey));
    if (agentCompare !== 0) {
      return agentCompare;
    }
    return String(left.skill).localeCompare(String(right.skill));
  });
}

module.exports = {
  STATE_VERSION,
  emptyState,
  getInstall,
  installKey,
  listInstalls,
  loadState,
  recordInstall,
  removeInstall,
  saveState,
  stateFile,
};
