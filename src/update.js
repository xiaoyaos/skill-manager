const fs = require("node:fs");
const path = require("node:path");

const { PACKAGE_ROOT, readPackage } = require("./config");
const { commandExists, run, runAsync } = require("./util");

function parseSemver(value) {
  const match = String(value || "")
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
  };
}

function comparePrerelease(left, right) {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return 1;
  }
  if (!right) {
    return -1;
  }
  const leftParts = left.split(".");
  const rightParts = right.split(".");
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) {
      return -1;
    }
    if (rightPart === undefined) {
      return 1;
    }
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const difference = Number(leftPart) - Number(rightPart);
      if (difference !== 0) {
        return difference > 0 ? 1 : -1;
      }
      continue;
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    const difference = leftPart.localeCompare(rightPart);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

function compareVersions(left, right) {
  const leftVersion = parseSemver(left);
  const rightVersion = parseSemver(right);
  if (!leftVersion || !rightVersion) {
    return String(left).localeCompare(String(right));
  }
  for (const key of ["major", "minor", "patch"]) {
    if (leftVersion[key] !== rightVersion[key]) {
      return leftVersion[key] > rightVersion[key] ? 1 : -1;
    }
  }
  return comparePrerelease(leftVersion.prerelease, rightVersion.prerelease);
}

function gitState(root) {
  if (!commandExists("git")) {
    return { isGit: false, gitAvailable: false };
  }
  const inside = run("git", ["-C", root, "rev-parse", "--is-inside-work-tree"]);
  if (inside.status !== 0 || inside.stdout.trim() !== "true") {
    return { isGit: false, gitAvailable: true };
  }

  const remote = run("git", ["-C", root, "remote", "get-url", "origin"]);
  const branch = run("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]);
  const upstream = run("git", [
    "-C",
    root,
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  const dirty = run("git", ["-C", root, "status", "--porcelain"]);

  return {
    isGit: true,
    gitAvailable: true,
    remote: remote.status === 0 ? remote.stdout.trim() : "",
    branch: branch.status === 0 ? branch.stdout.trim() : "",
    upstream: upstream.status === 0 ? upstream.stdout.trim() : "",
    dirty: dirty.status === 0 ? dirty.stdout.trim().length > 0 : false,
  };
}

async function checkGitUpdate(root, pkg, git) {
  if (!git.remote) {
    return {
      mode: "git",
      status: "no-remote",
      current: pkg.version,
      root,
      branch: git.branch,
      message:
        "本地 Git 仓库没有 origin remote；先执行 git remote add origin <url>，或改用 npm 安装",
    };
  }
  if (!git.upstream) {
    return {
      mode: "git",
      status: "no-upstream",
      current: pkg.version,
      root,
      branch: git.branch,
      remote: git.remote,
      message:
        "当前分支没有 upstream；先执行 git branch --set-upstream-to=origin/<branch>",
    };
  }

  const fetched = await runAsync("git", ["-C", root, "fetch", "--quiet", "--prune"], {
    timeout: 60000,
  });
  if (fetched.status !== 0) {
    return {
      mode: "git",
      status: "fetch-failed",
      current: pkg.version,
      root,
      branch: git.branch,
      upstream: git.upstream,
      message: (fetched.stderr || fetched.stdout || "git fetch failed").trim(),
    };
  }

  const counts = run("git", [
    "-C",
    root,
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${git.upstream}`,
  ]);
  let ahead = 0;
  let behind = 0;
  if (counts.status === 0) {
    const [aheadValue, behindValue] = counts.stdout.trim().split(/\s+/).map(Number);
    ahead = Number.isFinite(aheadValue) ? aheadValue : 0;
    behind = Number.isFinite(behindValue) ? behindValue : 0;
  }

  let latest = "";
  const upstreamPackage = run("git", [
    "-C",
    root,
    "show",
    `${git.upstream}:package.json`,
  ]);
  if (upstreamPackage.status === 0) {
    try {
      latest = JSON.parse(upstreamPackage.stdout).version || "";
    } catch {
      latest = "";
    }
  }

  if (behind > 0) {
    return {
      mode: "git",
      status: "available",
      current: pkg.version,
      latest: latest || "",
      ahead,
      behind,
      dirty: git.dirty,
      root,
      branch: git.branch,
      upstream: git.upstream,
    };
  }
  return {
    mode: "git",
    status: "up-to-date",
    current: pkg.version,
    latest: latest || pkg.version,
    ahead,
    behind,
    dirty: git.dirty,
    root,
    branch: git.branch,
    upstream: git.upstream,
  };
}

async function checkNpmUpdate(pkg) {
  const result = await runAsync("npm", ["view", pkg.name, "version", "--json"], {
    timeout: 30000,
  });
  if (result.status !== 0) {
    return {
      mode: "npm",
      status: "unpublished",
      current: pkg.version,
      root: PACKAGE_ROOT,
      message: `${pkg.name} 尚未发布到 npm registry，或当前 registry 不可达`,
    };
  }

  let latest = "";
  try {
    latest = JSON.parse(result.stdout);
  } catch {
    latest = result.stdout.trim().replace(/^"|"$/g, "");
  }
  if (Array.isArray(latest)) {
    latest = latest[latest.length - 1] || "";
  }
  if (!latest) {
    return {
      mode: "npm",
      status: "unpublished",
      current: pkg.version,
      root: PACKAGE_ROOT,
      message: `npm registry 没有返回 ${pkg.name} 的版本`,
    };
  }

  const comparison = compareVersions(latest, pkg.version);
  return {
    mode: "npm",
    status: comparison > 0 ? "available" : "up-to-date",
    current: pkg.version,
    latest,
    pkgName: pkg.name,
    root: PACKAGE_ROOT,
  };
}

async function checkUpdate(options = {}) {
  const root = options.root || PACKAGE_ROOT;
  const pkg = options.pkg || readPackage();
  const git = gitState(root);
  if (git.isGit) {
    return checkGitUpdate(root, pkg, git);
  }
  return checkNpmUpdate(pkg);
}

async function performUpdate(info, options = {}) {
  const { yes = false, confirm = null, quiet = false } = options;
  if (info.status !== "available") {
    return { status: "skipped", info };
  }

  if (info.mode === "git" && info.dirty) {
    throw new Error(
      "Git 工作区有未提交改动，已拒绝自动更新；先提交或 stash 后再运行 update",
    );
  }

  if (!yes) {
    if (!confirm) {
      return { status: "needs-confirmation", info };
    }
    if (!(await confirm())) {
      return { status: "cancelled", info };
    }
  }

  const stdio = quiet ? "pipe" : "inherit";
  let result;
  if (info.mode === "git") {
    result = await runAsync("git", ["-C", info.root, "pull", "--ff-only"], {
      stdio,
      timeout: 120000,
    });
    if (result.status !== 0) {
      throw new Error(
        `git pull --ff-only 失败，请手动检查仓库状态${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
      );
    }
  } else {
    result = await runAsync("npm", ["install", "-g", `${info.pkgName || ""}@latest`], {
      stdio,
      timeout: 180000,
    });
    if (result.status !== 0) {
      throw new Error(
        `npm 全局更新失败，请检查 npm 权限或 registry${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
      );
    }
  }

  const updatedPackage = JSON.parse(
    fs.readFileSync(path.join(info.root, "package.json"), "utf8"),
  );

  return {
    status: "updated",
    info,
    version: updatedPackage.version,
  };
}

module.exports = {
  checkUpdate,
  compareVersions,
  gitState,
  parseSemver,
  performUpdate,
};
