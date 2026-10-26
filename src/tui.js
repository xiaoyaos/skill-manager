const pc = require("picocolors");

let clackPromise = null;

function loadClack() {
  if (!clackPromise) {
    clackPromise = import("@clack/prompts");
  }
  return clackPromise;
}

function isInteractive() {
  return Boolean(
    process.stdin.isTTY &&
      process.stdout.isTTY &&
      !process.env.SKILL_MANAGER_NO_TUI,
  );
}

function isCancel(value) {
  return typeof value === "symbol";
}

async function intro(title) {
  const p = await loadClack();
  p.intro(title);
}

async function outro(message) {
  const p = await loadClack();
  p.outro(message);
}

async function cancel(message) {
  const p = await loadClack();
  p.cancel(message);
}

async function note(message, title) {
  const p = await loadClack();
  p.note(message, title);
}

async function log(message, level = "info") {
  const p = await loadClack();
  const writer = p.log[level] || p.log.info;
  writer(message);
}

async function banner({ version, skillCount, installCount }) {
  const p = await loadClack();
  p.intro(pc.bgCyan(pc.black(pc.bold(` Skill Manager v${version} `))));
  p.note(
    [
      `${pc.dim("Skill 库")}  ${pc.bold(String(skillCount))} 个`,
      `${pc.dim("已安装")}   ${pc.bold(String(installCount))} 个副本`,
      `${pc.dim("命令")}     ${pc.cyan("skm")} / ${pc.cyan("skill-manager")}`,
    ].join("\n"),
    "当前状态",
  );
}

async function chooseMenu(message, options) {
  const p = await loadClack();
  const result = await p.select({
    message,
    options,
    maxItems: options.length,
  });
  return p.isCancel(result) ? null : result;
}

async function chooseOne({ message, options, placeholder, initialValue, maxItems = 12 }) {
  const p = await loadClack();
  const result = await p.autocomplete({
    message,
    options,
    placeholder,
    initialValue,
    maxItems,
  });
  return p.isCancel(result) ? null : result;
}

async function chooseMany({
  message,
  options,
  placeholder,
  initialValues,
  required = true,
  maxItems = 12,
}) {
  const p = await loadClack();
  const result = await p.autocompleteMultiselect({
    message,
    options,
    placeholder,
    initialValues,
    required,
    maxItems,
  });
  return p.isCancel(result) ? null : result;
}

async function confirmAction(message, { initialValue = true } = {}) {
  const p = await loadClack();
  const result = await p.confirm({ message, initialValue });
  return p.isCancel(result) ? null : result;
}

async function askText(message, { placeholder, defaultValue, validate } = {}) {
  const p = await loadClack();
  const result = await p.text({
    message,
    placeholder,
    defaultValue,
    validate,
  });
  return p.isCancel(result) ? null : result;
}

async function withSpinner({ start, success, failure }, task) {
  const p = await loadClack();
  const spinner = p.spinner();
  spinner.start(start);
  try {
    const result = await task();
    const done = typeof success === "function" ? success(result) : success;
    spinner.stop(done);
    return result;
  } catch (error) {
    const done =
      typeof failure === "function" ? failure(error) : failure || "操作失败";
    spinner.stop(done);
    throw error;
  }
}

module.exports = {
  askText,
  banner,
  cancel,
  chooseMany,
  chooseMenu,
  chooseOne,
  confirmAction,
  intro,
  isCancel,
  isInteractive,
  loadClack,
  log,
  note,
  outro,
  pc,
  withSpinner,
};
