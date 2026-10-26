const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { SKILLS_DIR } = require("./config");
const { parseFrontmatter } = require("./frontmatter");
const { lstatSafe, removePath } = require("./util");

const SKILL_MARKER = "SKILL.md";
const METADATA_FILE = ".skill-manager.json";
const IGNORED_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".pytest_cache",
  ".ruff_cache",
  "__pycache__",
  METADATA_FILE,
]);

function isIgnored(name) {
  return IGNORED_NAMES.has(name) || name.endsWith(".pyc");
}

function isSkillDir(dirPath) {
  return fs.existsSync(path.join(dirPath, SKILL_MARKER));
}

function walkFiles(dirPath, baseDir = dirPath, result = []) {
  if (!fs.existsSync(dirPath)) {
    return result;
  }
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (isIgnored(entry.name)) {
      continue;
    }
    const absolute = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, baseDir, result);
    } else if (entry.isFile()) {
      result.push(absolute);
    }
  }
  return result;
}

function countFiles(dirPath) {
  return walkFiles(dirPath).length;
}

function hashDirectory(dirPath) {
  const hash = crypto.createHash("sha256");
  const files = walkFiles(dirPath).sort();
  for (const file of files) {
    const relative = path.relative(dirPath, file).split(path.sep).join("/");
    hash.update(relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function loadSkill(dirName, options = {}) {
  const skillsDir = options.skillsDir || SKILLS_DIR;
  const skillPath = path.join(skillsDir, dirName);
  const text = fs.readFileSync(path.join(skillPath, SKILL_MARKER), "utf8");
  const meta = parseFrontmatter(text);
  const metadata =
    meta.metadata && typeof meta.metadata === "object" ? meta.metadata : {};

  return {
    dirName,
    name:
      typeof meta.name === "string" && meta.name.trim()
        ? meta.name.trim()
        : dirName,
    description:
      typeof meta.description === "string" ? meta.description.trim() : "",
    shortDescription:
      typeof metadata["short-description"] === "string"
        ? metadata["short-description"].trim()
        : "",
    path: skillPath,
    fileCount: countFiles(skillPath),
    sourceHash: hashDirectory(skillPath),
  };
}

function listSkills(options = {}) {
  const skillsDir = options.skillsDir || SKILLS_DIR;
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && isSkillDir(path.join(skillsDir, entry.name)),
    )
    .map((entry) => loadSkill(entry.name, { skillsDir }))
    .sort((left, right) => left.dirName.localeCompare(right.dirName));
}

function findSkill(name, options = {}) {
  const skills = listSkills(options);
  return (
    skills.find((skill) => skill.dirName === name) ||
    skills.find((skill) => skill.name === name) ||
    null
  );
}

function copySkillDir(sourceDir, targetDir) {
  fs.cpSync(sourceDir, targetDir, {
    recursive: true,
    filter: (source) => !isIgnored(path.basename(source)),
  });
}

function writeInstallMetadata(targetDir, metadata) {
  fs.writeFileSync(
    path.join(targetDir, METADATA_FILE),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

function readInstallMetadata(targetDir) {
  const filePath = path.join(targetDir, METADATA_FILE);
  const stat = lstatSafe(filePath);
  if (!stat || !stat.isFile()) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function removeSkillDir(targetDir) {
  return removePath(targetDir);
}

module.exports = {
  METADATA_FILE,
  SKILL_MARKER,
  copySkillDir,
  countFiles,
  findSkill,
  hashDirectory,
  isSkillDir,
  listSkills,
  loadSkill,
  readInstallMetadata,
  removeSkillDir,
  walkFiles,
  writeInstallMetadata,
};
