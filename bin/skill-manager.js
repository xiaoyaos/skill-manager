#!/usr/bin/env node

const { main } = require("../src/cli");

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    console.error(`[ERROR] CLI 运行失败：${error.message}`);
    process.exitCode = 1;
  });
