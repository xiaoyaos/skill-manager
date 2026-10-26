const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function lstatSafe(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function exists(target) {
  return lstatSafe(target) !== null;
}

function readJson(filePath, fallback = null) {
  if (!exists(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function commandExists(command) {
  const result = run("sh", ["-c", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
  return result.status === 0;
}

function isInside(childPath, parentPath) {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function removePath(target) {
  const stat = lstatSafe(target);
  if (!stat) {
    return false;
  }
  if (stat.isSymbolicLink() || stat.isFile()) {
    fs.unlinkSync(target);
  } else {
    fs.rmSync(target, { recursive: true, force: true });
  }
  return true;
}

function timestamp() {
  return new Date().toISOString();
}

function charWidth(char) {
  const code = char.codePointAt(0);
  if (
    code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  ) {
    return 2;
  }
  return 1;
}

function visualWidth(value) {
  return Array.from(String(value)).reduce((total, char) => total + charWidth(char), 0);
}

function padVisual(value, width) {
  const text = String(value);
  return text + " ".repeat(Math.max(0, width - visualWidth(text)));
}

function truncateVisual(value, width) {
  const text = String(value);
  if (visualWidth(text) <= width) {
    return text;
  }
  let result = "";
  let used = 0;
  for (const char of Array.from(text)) {
    const next = charWidth(char);
    if (used + next > width - 1) {
      break;
    }
    result += char;
    used += next;
  }
  return `${result}…`;
}

module.exports = {
  commandExists,
  exists,
  isInside,
  lstatSafe,
  padVisual,
  readJson,
  removePath,
  run,
  timestamp,
  truncateVisual,
  visualWidth,
  writeJsonAtomic,
};
