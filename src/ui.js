const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

function printLine() {
  console.log("------------------------------------------------------------");
}

function isInteractive() {
  return Boolean(stdin.isTTY && stdout.isTTY);
}

function createInterface() {
  return readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: isInteractive(),
  });
}

async function ask(rl, prompt) {
  const answer = await rl.question(prompt);
  return answer.trim();
}

async function choose(rl, title, items, options = {}) {
  if (!items || items.length === 0) {
    return null;
  }
  const display = options.display || ((item) => String(item));
  const cancelLabel = options.cancelLabel || "取消";

  console.log(title);
  items.forEach((item, index) => {
    console.log(`  ${String(index + 1).padStart(2, " ")}. ${display(item)}`);
  });
  console.log(`   0. ${cancelLabel}`);

  while (true) {
    const answer = await ask(rl, "请输入编号: ");
    if (/^\d+$/.test(answer)) {
      const number = Number(answer);
      if (number === 0) {
        return null;
      }
      if (number >= 1 && number <= items.length) {
        return items[number - 1];
      }
    }
    console.log("输入无效，请重试。");
  }
}

async function chooseMany(rl, title, items, options = {}) {
  if (!items || items.length === 0) {
    return [];
  }
  const display = options.display || ((item) => String(item));

  console.log(title);
  items.forEach((item, index) => {
    console.log(`  ${String(index + 1).padStart(2, " ")}. ${display(item)}`);
  });
  console.log("  支持输入多个编号，用逗号分隔；输入 all 选择全部；0 取消");

  while (true) {
    const answer = await ask(rl, "请输入编号: ");
    if (answer === "0") {
      return [];
    }
    if (answer.toLowerCase() === "all") {
      return [...items];
    }
    const numbers = answer
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);
    if (
      numbers.length > 0 &&
      numbers.every(
        (number) => Number.isInteger(number) && number >= 1 && number <= items.length,
      )
    ) {
      return [...new Set(numbers)].map((number) => items[number - 1]);
    }
    console.log("输入无效，请重试。");
  }
}

async function confirm(rl, message, options = {}) {
  const defaultYes = Boolean(options.defaultYes);
  const suffix = defaultYes ? "(Y/n): " : "(y/N): ";
  const answer = await ask(rl, `${message} ${suffix}`);
  if (!answer) {
    return defaultYes;
  }
  return /^[Yy]$/.test(answer);
}

module.exports = {
  ask,
  choose,
  chooseMany,
  confirm,
  createInterface,
  isInteractive,
  printLine,
};
