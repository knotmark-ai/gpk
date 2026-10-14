# GPK

**目标决定方向，项目推动进展，知识通过使用不断积累。**

GPK（Goals · Projects · Knowledge）是一款面向目标与项目驱动的个人知识工作的开源
方法论插件。它希望借助你选择的 AI Agent 和知识工具，连接你想实现的目标、正在做的
事情，以及从中获得的知识。

本文为中文辅助说明，[英文 README](README.md) 是产品定位与支持范围的主稿。

GPK 仍处于早期开发阶段。以下原则描述产品希望实现的方向；已经可用的能力见
[当前支持](#当前支持)。

## 为什么需要 GPK

保存信息很容易，让信息参与工作、再把工作中的经验留下来却更难。阅读清单不断增长，
任务不断被勾选，有用的决策却散落在旧笔记和 AI 对话里。做得更多，不一定意味着更
接近真正想要的结果。

GPK 面向同时进行创造、研究与自主学习的人。它连接两个方向：目标推动项目、行动和
资料研究；新信息与实践经验又能改变理解、调整计划，甚至产生新的目标。行动结果再
回到知识和后续工作中，形成持续积累。

例如，一篇论文可以同时支持一个项目决策、引出一个实验，并补充已有的知识解释。
实验结果又能修正计划和解释。论文始终保留为可追溯的证据，不必因此另建一个项目，
也不必拆成一堆互不关联的摘要。

目的不是收藏更多内容或设计更复杂的目录，而是让下一步更容易选择，让过去学到的
东西更容易再次发挥作用。

## 产品思路

1. **让行动有方向。** 从真正重要的事情和希望发生的变化出发，明确有意义的结果，
   选择范围适当的项目，并在推进中复盘证据。关注有用的下一步，而不是令人焦虑的
   完整待办清单；完成计划不自动等于达成目标。
2. **让知识参与工作。** 按用途决定材料需要摘要、翻译、精读，还是与其他来源比较。
   持续维护能够连接证据、分歧和开放问题的解释。知识的使用也包括学习、查询和改善
   决策，不仅是发表文章或交付产品。
3. **让做过的事情留下积累。** 保留任务、项目和 AI 对话中的有用发现、决策与结果，
   回流到相关知识和计划，让下一次工作有基础可用。简短结果可以留在任务里，不要求
   每个行动都生成新文档。
4. **降低维护系统的负担。** 让 Agent 帮助准备资料、关联想法、维护知识和复盘计划。
   人保留对意图、优先级和重要决策的控制；Agent 依据当前记录、保留用户修改，并在
   授权范围内行动。

日常提醒、好奇心和暂时没有用途的材料同样可以进入系统。不是所有事情都需要
Objective 或 KR，也不是每份 Source 都必须变成 Task。方法应当服务工作，而不是
让维护系统本身成为主要工作。

## 为什么是插件

你的知识和工作进展，不应该只存在于某一段 AI 对话、某个客户端或某款笔记软件里。
GPK 的核心是一套共享方法，通过 Agent Skills、模板和明确的操作来表达，而不是
新建编辑器或替代现有 Agent 客户端。

设计上将领域含义与存取端口、具体 Adapter 分开，希望切换到另一个受支持的客户端，
以及未来的其他知识后端时，仍能继续相同的工作，保留原有含义与关系。知识和进展由
选定的知识后端保存，不只依赖 Agent 的对话记忆，也不在 GPK 内部暗藏另一套副本。

首期集成目标是 Codex、Claude Code 与 Craft：Craft 保存知识，用户明确选定的本地 `.gpk`
目录保存设置、授权与个人模板；同一实例由获授权的桌面客户端共用，不为每个 Project 建一份。
首个可执行工具运行时以 **MCP stdio** 为目标；[架构说明](docs/architecture.zh-CN.md)明确进程
边界和复用同一操作的 Streamable HTTP 扩展。远程部署与控制访问以后再实现，配置不混入
日常知识文档。更多客户端与存储是后续扩展方向，
不是已经普遍兼容的承诺；每种集成都需要验证实际保留了什么，并说明能力限制。
这套方法不要求新建编辑器、托管 GPK 服务或中央镜像数据库；团队治理与协作不属于
首期个人使用范围。

## 共享模型

GPK 用少量概念连接方向、工作和知识：

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

成功意味着下一步更清晰、行动产生有意义的结果、积累的知识能够帮助后续工作，同时
减少维护负担，并能在受支持的工具之间延续。

## 当前支持

领域基线为 **0.4**，插件包为 **0.1.0**。当前能力以
[英文 README](README.md#current-support) 为准。

| 组件 | 当前可用能力 |
|---|---|
| `gpk-setup` Skill | 打开 GPK 的本地 onboarding 页面，完成之前不能做任何其他工作：连接 Craft，选择专用或共用工作区、工作语言与元数据语言和名称，创建结构（宿主文档、带视图的 Areas / Projects Collections、Sources / Wikis / Outputs 文件夹、模板），勾选权限。只写 `settings.json` 和 `grants.json`，授权只能在这个页面上创建 |
| `gpk-plan` Skill | 以 Collection 行创建 Area 和 Project（Objective、KR、范围、主 Area），在 Project 内按计划顺序添加和排序 Task，附加过程材料，更改主 Area，在 Project 与独立之间移动 Task |
| `gpk-work` Skill | 把 Inbox / Daily Note 捕获澄清为 Task（独立或归属 Project）、推进或改期、记录结果、在独立与 Project Task 之间给出下一步选择，并在 Task 处置完毕后关闭 Project |
| `gpk-ingest` Skill | 登记带来源与访问证据的 Source，修订或创建受影响的 Wiki 并以链接作引用，留存 Output，为记录之间添加带说明的链接，用检查点保存可续处理进度 |
| `gpk-review` Skill | 日 / 周 / 月及临时回顾：一次读取回顾全量（捕获、逾期／今日／即将／进行中／等待的 Task、各状态 Project 及注意信号、Area 下的 Project 数、遍历范围与缺口），结论通过实体工具写回原记录 |
| `gpk` Skill | 解释方法并路由到五个工作流 |
| stdio MCP 运行时 | 60 个工具：运行、连接与 Setup 诊断，onboarding 页面，Settings 读写，授权列表／撤销，能力报告，Inbox / Daily Note 捕获，Task 的解析／读取／查询／创建／更新／流转／排期／归属，Area 与 Project 的解析／读取／查询／创建／更新／流转，Project 的主 Area 指派与 Task 排序，Project 材料的列表／读取／追加／更新，Source / Wiki / Output 的解析／读取／查询／创建／更新，链接的查询／添加／移除，检查点的读取／保存，回顾全量读取 |
| Craft Adapter | GPK 自己的 OAuth 客户端连接 Craft MCP 端点（动态注册、PKCE、回环回调、令牌刷新存于宿主无关的密钥库，每个控制根一套令牌）；全部实体的读写操作、链接与检查点已在两个真实空间验证；归档、恢复与删除未实现 |
| 本地控制 Adapter | 通过原子文件替换和摘要冲突检测读写所选 `.gpk` 根下的 `settings.json` 与 `grants.json`；个人模板未实现 |
| 授权 | 每次写入都从 `grants.json` 解析后端、根与操作对应的授权（布局中的 Collection 或文件夹、`daily-notes`、`inbox` 或 `system`）；Adapter 复核记录所在容器；归属移动按目标根授权，链接按发起记录授权；工具参数不携带任何权限 |
| 入口 Hook | Claude Code / Codex 加载路由规则和提醒，不执行业务操作 |
| 默认模板 | 六类实体的中英文资产，Setup 会把它们安装到 Craft 的模板区 |
| Codex / Claude 安装包 | 包含 Skill、Hook、独立的 `mcp/stdio.mjs`、启动配置及依赖许可；运行不依赖 pnpm 或源码目录 |
| TypeScript Port | 按实体的知识操作及具名 Settings／模板／授权契约；Task、Area、Project 的写契约已有真实调用方 |

已完成四个纵向切片：Setup（全程通过工具完成，不需手写文件）、报销提醒场景 A1
（从捕获到记录结果）、基于 Collections 的 Project 闭环（Area / Project 为带
Status 与 Area 列的行，Task 为 Project 行内按计划顺序排列的任务块，过程材料为嵌套页面，
仍有未处置 Task 时拒绝关闭），以及 Setup 建立的文件夹中的知识实体（Source / Wiki / Output
为文档，上下文链接是发起记录正文里的列表项，处理检查点保存在 `GPK System` 页面）。
Review 基于一次读取的全量进行，结论写回原记录。GPK 位置之外文档中的任务块不受管理。所有失败都是规范化的
`Result` 并带 MCP `isError: true`；没有工具会伪造记录或回执。

测试覆盖控制文件信封、针对复现实测命令面的 fake 连接的 Craft 映射、授权解析、
bootstrap 绑定、Codex／Claude 隔离安装包的 stdio 启动与两类协议协商、输入检查和进程退出。
真实 Craft 行为以带日期的证据记录在 [Craft 映射](docs/adapters/craft.md)；
Codex 的 Hook 仍需宿主审阅和信任，见[加载说明](docs/plugin-runtime.md#entry-hook-loading)。

后续实现：归档／恢复／删除、个人模板、周期与重复执行（[工作流设计](docs/workflow-design.md)第 5 节）。
共享注册及处理器保留了未来 Streamable HTTP 入口的扩展边界；
HTTP、远程控制和独立 CLI 尚未实现。OpenClaw、WorkBuddy、Hermes 仍为可选预览，
不包含 GPK MCP 运行时，未经实际客户端验证。

[验收清单](docs/conformance-scenarios.md)描述目标行为；骨架测试不代表首个用户闭环已完成。

## 从这里开始

- [用户需求与场景](docs/requirements.zh-CN.md)：行动管理、知识管理及两者结合，说明设计要服务的需求。
- [构建、加载与验证](docs/getting-started.md)：当前基础能力的本地使用方法。安装包和索引
  由 `pnpm build` 生成，用于开发测试。
- [架构中文说明](docs/architecture.zh-CN.md)：职责、文档权威与评审路径；详细设计以
  [英文架构](docs/architecture.md)链接的领域、工作流和存取契约为准。
- [交付路线](docs/roadmap.md)：产品里程碑与完成条件。

产品规范、设计、Skills、模板和测试，包括草稿，都在仓库中独立承载。个人 Project
上下文留在选定知识库，记录结果摘要与成果链接；仓库不依赖私人笔记。

## 构建与分发

使用 pnpm、TypeScript 和 Node 脚本统一构建，接口源码在 `src/`，Skill 内容在
`plugin/`，平台元数据在 `platforms/`。所有生成产物统一在 `dist/`，不提交到源码仓库；CI 生成分发仓库内容和 Release ZIP。
配置和发布方法见[分发说明](docs/distribution.zh-CN.md)。

## 许可

[MIT](LICENSE)
