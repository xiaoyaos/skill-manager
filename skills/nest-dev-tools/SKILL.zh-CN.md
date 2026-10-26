# Nest 开发工具集

该 skill 面向 nest-base 生态，提供“框架识别 + 开发 + 检查”的工具流：

1. 识别框架
2. 进行开发
3. 检查项目问题

## 固定流程

必须按顺序执行：

1. 先识别项目技术栈（Node / NestJS / nest-base）。
2. 再根据栈进行代码开发。
3. 最后运行检查并输出问题清单。

## 第一步：识别框架

执行命令：

```bash
bash scripts/framework_dev_check.sh <project-dir>
```

需要明确：

1. 项目是 Node 通用包，还是 NestJS 应用/库。
2. 是否存在 `nest-base` 接入要求。
3. 当前目录更像“应用项目”还是“组件库项目”。

## 第二步：进行开发

根据识别结果执行开发：

1. Node 通用包：保持框架无关。
2. NestJS 包：遵循 Module/Provider/DI 规范。
3. NestJS + nest-base 应用：保持 `setupNestCommon` 与 `NestCommonModule.forRoot` 约定。

## 第三步：检查项目问题

开发后至少执行：

1. 再次运行 `framework_dev_check.sh`。
2. 执行构建/测试（若脚本存在）。
3. 输出失败项、告警项、遗留风险。

## 输出规范

最终输出需包含：

1. 框架识别结果。
2. 修改文件与修改原因。
3. 验证命令与结果。
4. 风险与下一步建议。

## 参考

详细流程见：
`references/workflow.md`
