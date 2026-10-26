# 示例

以下示例均为脱敏数据，只用于说明结构，不代表真实项目。

## 1. 输入摘要

`commits.json` 的关键字段：

```json
{
  "period": {
    "start": "2026-10-19",
    "end": "2026-10-25",
    "label": "2026/10/19-2026/10/25",
    "week": "W43",
    "iso_year": 2026
  },
  "commits": [
    {
      "hash": "abc1234",
      "date": "2026-10-20",
      "week": "W43",
      "iso_year": 2026,
      "project": "Example Platform",
      "repo": "platform",
      "subject": "feat(app-access): 内部微服务豁免租户白名单并返回应用类别",
      "norm": "内部微服务豁免租户白名单并返回应用类别"
    }
  ],
  "unmapped": [],
  "stats": {
    "total": 16,
    "by_project": {
      "Example Platform": 12,
      "Example Tooling": 4
    }
  }
}
```

## 2. 输出 `report.json`

```json
{
  "period": "2026/10/19-2026/10/25",
  "week": "W43",
  "sections": [
    {
      "label": "重点项目",
      "items": [
        {
          "name": "示例平台应用接入与网关鉴权",
          "goal": "完成平台应用接入、租户白名单与网关鉴权能力。",
          "progress": "实现应用类别透传与租户列表返回；修复应用无角色时的处理；调整请求限制并补充鉴权主体字段说明。",
          "status": "完成",
          "deviation": "无",
          "evidence": {
            "projects": ["Example Platform"],
            "repos": ["platform", "packages/platform-gateway"],
            "commit_count": 8,
            "sample_commits": [
              "内部微服务豁免租户白名单并返回应用类别",
              "鉴权主体新增应用类别与租户列表",
              "修复应用无角色时处理"
            ]
          }
        },
        {
          "name": "示例平台任务生命周期闭环",
          "goal": "补全任务生命周期闭环，完善任务追溯与管理后台。",
          "progress": "补全任务生命周期状态流转；重构生命周期页为可交互流程图；新增任务生命周期页面并优化筛选条件。",
          "status": "进行中",
          "deviation": "异常任务补偿逻辑待联调，顺延到下周。",
          "evidence": {
            "projects": ["Example Platform"],
            "repos": ["platform"],
            "commit_count": 4,
            "sample_commits": [
              "补全任务生命周期闭环",
              "重构生命周期页为单版本可交互流程图",
              "新增任务生命周期页面"
            ]
          }
        }
      ]
    },
    {
      "label": "日常工作",
      "items": [
        {
          "name": "示例工具链构建配置维护",
          "goal": "保障测试环境与构建产物稳定。",
          "progress": "调整测试环境消息队列地址；构建阶段关闭静态资源监听，避免产物截断。",
          "status": "完成",
          "deviation": "无",
          "evidence": {
            "projects": ["Example Tooling"],
            "repos": ["tools/example"],
            "commit_count": 2,
            "sample_commits": [
              "调整测试环境消息队列地址",
              "构建阶段关闭静态资源监听"
            ]
          }
        },
        {
          "name": "示例工具链文档补充",
          "goal": "补齐使用文档，降低接入成本。",
          "progress": "补充环境变量说明；补充常见问题与排查步骤。",
          "status": "完成",
          "deviation": "无",
          "evidence": {
            "projects": ["Example Tooling"],
            "repos": ["tools/example"],
            "commit_count": 2,
            "sample_commits": [
              "补充环境变量说明",
              "补充常见问题与排查步骤"
            ]
          }
        }
      ]
    }
  ]
}
```

## 3. 为什么这样拆

- 同一个项目 `Example Platform` 有 12 条提交，但按主题拆成“应用接入与网关鉴权”和“任务生命周期闭环”，而不是逐条列 commit。
- 第二条状态是 `进行中`，所以 `deviation` 写具体原因，不写 `无`。
- 日常工作只保留构建配置和文档两类，避免把重点项目拆碎。
- 每条 `evidence.commit_count` 不超过对应项目的实际提交数；`sample_commits` 来自真实提交标题。
- 总条目 4 条，A4 横向单页压力较小。

## 4. 常见反例

### 反例 1：逐条罗列提交

```json
{
  "name": "feat: 增加接口",
  "progress": "增加接口；增加字段；增加页面；增加配置；增加日志；增加测试。"
}
```

问题：没有主题，读者不知道做了什么；`progress` 像 commit 列表。

### 反例 2：状态与偏差矛盾

```json
{
  "status": "进行中",
  "deviation": "无"
}
```

问题：未完成却没有偏差说明，周报会失真。应写“等待联调”或“范围新增，顺延”。

### 反例 3：编造结果

```json
{
  "progress": "已上线生产，客户验收通过，性能提升 30%。"
}
```

问题：提交里没有上线、验收和性能数据，不能写。

### 反例 4：项目未覆盖

`commits.json` 里有 `Example Tooling` 的提交，但 `report.json` 只写了 `Example Platform`。校验会报“有提交的项目未被周报覆盖”。

### 反例 5：手改 Excel

直接改 `.xlsx` 后，下一次重新渲染会覆盖；而且校验无法追溯内容来源。正确做法是改 `report.json` 再渲染。
