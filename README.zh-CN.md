# GPK

**目标决定方向，项目推动进展，知识通过使用不断积累。**

GPK（Goals · Projects · Knowledge）是一套目标与项目驱动的个人知识系统，让人和
AI Agent 用同一种可移植的模型，把捕获的信息转化为有意推进的工作和可复用知识。

本文为中文辅助说明，[英文 README](README.md) 是产品定位与支持范围的主稿。

## 为什么需要 GPK

目标、任务、阅读材料和笔记往往分散在不同工具里，积累的信息很难与实际决策和工作
建立关系。不同 AI 客户端又只能看到部分上下文，更换工具容易变成重新搭建整套系统。

GPK 用六类实体连接长期方向、有限工作和实践后的学习：

| 实体 | 用途 |
|---|---|
| Area | 独立文档，承载长期方向与持续责任 |
| Project | 有限的预期改变，内置 Objective 和 Key Results |
| Task | 已接受的行动与有用结果，可以属于 Project，也可以独立存在 |
| Source | 有可追溯出处的保留材料与证据 |
| Wiki | 可独立使用、持续维护的解释与综合 |
| Output | 有意保留用于使用、交付、决策或运行的成果 |

Objective/KR 是 Project 内容，没有独立 Goal 实体；主题使用元数据表达。
Inbox 和 Daily Notes 是捕获与工作入口。准确的关系、状态和操作见
[领域模型](plugin/knowledge/domain-model.md)及[中文说明](plugin/knowledge/domain-model.zh-CN.md)。

## 产品思路

- 长期方向和责任影响注意力分配；信息通过支持决策、行动和学习发挥价值。
- KR 衡量结果证据，勾完 Task 不自动等于达成 Project 目标。
- planned Project 可以表达未来可能性；Full Plan 展示计划，Focus 帮助选择当前行动。
  Review 决定启动与调整，日期到达或前序完成不自动激活 Project。
- 日常行动保持轻量：Task 可以独立存在，结果可以就地保留，不强制创建成果文档。
- 调研分层：原始证据留在 Source，可复用综合进入 Wiki，Project 专属研究和决策留在
  Project。保留 Output 不必等待 Project 结束或对外发布。
- Agent 读取当前事实、保留用户内容，并在授权范围内行动。新内容无法判断时可以先放
  Inbox；迁移中的不确定旧内容进入 `Backup/Unsorted`，Backup 只用于恢复。
- 核心含义通过各工具的原生能力实现；嵌套过程文档和客户端切换都应保留领域关系。

产品由领域模型、共享 Agent Skills、轻量 Adapter 和默认模板组成。0.x 首先面向一个人
使用 Claude Code 或 Codex 配合 Craft 的场景，不要求新建编辑器、任务应用、通用知识
分类树、镜像数据库或同步服务，也不要求把每篇 Source 都变成 Task。团队治理与协作
属于后续范围。

成功标准是信息更容易转化为进展与学习，切换受支持客户端仍保留方向、工作和知识的
关系；更多 Backend 的可移植性由各自的 Adapter 与验收证明。

## 当前支持

领域基线为 **0.4**，插件包为 **0.1.0**。

| 组件 | 当前可用能力 |
|---|---|
| 共享 `gpk` Skill | 解释模型，对指定材料做只读评估 |
| Claude Code | 加载标准源包 `plugin/` 后使用 `/gpk:gpk` |
| Codex | 加载生成包 `adapters/codex/` 后使用 `$gpk` |
| Craft | 通过用户已有、已配置和授权的连接做限定范围读取 |

评估用户直接提供的材料无需连接。实时读取取决于当前客户端的工具与权限；GPK 不提供
Craft 凭据、Connector 或数据代理，API 访问需要另行配置与验证。

Setup、Ingest、Plan、Work、Review 目前只有不生效的 `SKILL.md.stub`。业务步骤、可用
默认模板、持久化 User Control 设置、写入、迁移和定期执行均待实现。其他客户端与
知识库只是后续候选，不能因为目录或接口存在就宣称支持。

[验收清单](plugin/knowledge/conformance-scenarios.md)中的行为仍待执行验证。包和文档检查
不等于安装后的 Agent 行为或真实 Craft 一致性已经通过。

## 从这里开始

- [构建、加载与验证](docs/getting-started.md)：当前基础能力的本地使用方法。仓库目录
  用于开发测试，中心 marketplace 的分发接入尚未完成。
- [架构中文说明](docs/architecture.zh-CN.md)：职责、文档权威与评审路径；详细设计以
  [英文架构](docs/architecture.md)链接的领域、工作流和 Adapter 契约为准。
- [交付路线](docs/roadmap.md)：功能实现与发布所需证据。

产品规范、设计、Skills、模板和测试，包括草稿，都在仓库中独立承载。个人 Project
上下文留在选定知识库，记录结果摘要与成果链接；仓库不依赖私人笔记。

## 许可

[MIT](LICENSE)
