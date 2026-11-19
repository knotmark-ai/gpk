# GPK

**目标决定方向，项目推动进展，知识通过使用不断积累。**

GPK（Goals · Projects · Knowledge）是一款面向目标与项目驱动的个人知识工作的开源
方法论插件。它希望借助你选择的 AI Agent 和知识工具，连接你想实现的目标、正在做的
事情，以及从中获得的知识。

本文为中文辅助说明，[英文 README](README.md) 是产品定位与支持范围的主稿。

GPK 仍处于早期开发阶段。以下原则描述产品希望实现的方向；已经可用的能力见
[当前支持](#当前支持)。

## 为什么需要 GPK

保存信息很容易，让信息参与工作、再把工作中的经验留下来却更难。阅读清单不断增长， 任务不断被勾选，有用的决策却散落在旧笔记和 AI 对话里。做得更多，不一定意味着更
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

首期集成目标是 Codex、Claude Code、Antigravity 与 Craft：Craft 保存知识及原生可编辑实体模板，用户明确选定的本地 `.gpk`
目录保存设置与授权；同一实例由获授权的桌面客户端共用，不为每个 Project 建一份。
本机每个 OS 用户共享一个 GPK 服务。宿主可通过 Streamable HTTP 直连，或通过 stdio 桥接。远程部署和移动端接入留待后续。
更多客户端与存储是后续扩展方向，
不是已经普遍兼容的承诺；每种集成都需要验证实际保留了什么，并说明能力限制。
这套方法不要求新建编辑器、托管 GPK 服务或中央镜像数据库；团队治理与协作不属于
首期个人使用范围。

## 共享模型

GPK 用少量概念连接方向、工作和知识：

| 实体    | 用途                                                     |
| ------- | -------------------------------------------------------- |
| Area    | 独立文档，承载长期方向与持续责任                         |
| Project | 有限的预期改变，内置 Objective 和 Key Results            |
| Task    | 已接受的行动与有用结果，可以属于 Project，也可以独立存在 |
| Source  | 有可追溯出处的保留材料与证据                             |
| Wiki    | 可独立使用、持续维护的解释与综合                         |
| Output  | 有意保留用于使用、交付、决策或运行的成果                 |

Objective/KR 是 Project 内容，没有独立 Goal 实体；主题使用元数据表达。
Inbox 和 Daily Notes 是捕获与工作入口。准确的关系、状态和操作见
[领域模型](plugin/knowledge/domain-model.md)及[中文说明](plugin/knowledge/domain-model.zh-CN.md)。

成功意味着下一步更清晰、行动产生有意义的结果、积累的知识能够帮助后续工作，同时
减少维护负担，并能在受支持的工具之间延续。

## 当前支持

领域基线为 **0.4**，插件包为 **0.1.0**。当前能力以
[英文 README](README.md#current-support) 为准。

| 组件                  | 当前可用能力                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpk-setup` Skill     | 打开 GPK 的本地浏览器控制台，完成之前不能执行知识读写：连接 Craft，选择专用或共用工作区、元数据语言和名称，一键创建或接入结构（宿主文档、带视图的 Areas / Projects Collections、Sources / Wikis / Outputs 文件夹、模板）并自动写入全部 8 个工作区容器的非破坏性读写授权。只写 `settings.json` 和 `grants.json`。 |
| `gpk-plan` Skill      | 以 Collection 行创建 Area 和 Project（Objective、KR、范围、主 Area），在 Project 内按计划顺序添加和排序 Task，附加过程材料，更改主 Area，在 Project 与独立之间移动 Task |
| `gpk-work` Skill      | 把 Inbox / Daily Note 捕获澄清为 Task（独立或归属 Project）、推进或改期、记录结果、在独立与 Project Task 之间给出下一步选择，并在 Task 处置完毕后关闭 Project |
| `gpk-ingest` Skill    | 先确认 Capture、Study 或 Deep Research 深度：保留文件原件或原文链接，整合与研究会关联当前目标和任务；Deep Research 使用宿主搜索工具比较独立来源，并支持按导入指南结构化迁移现有集合（Markdown/Obsidian、Notion、其他 Craft 空间，含图片与附件） |
| `gpk-review` Skill    | 日 / 周 / 月及临时回顾：一次读取回顾全量（捕获、逾期／今日／即将／进行中／等待的 Task、各状态 Project 及注意信号、Area 下的 Project 数、遍历范围与缺口），结论通过实体工具写回原记录 |
| `gpk` Skill           | 解释方法、处理通用查询与独立 Daily Note 活动记录，并路由到五个工作流 |
| 本地服务和 CLI        | `gpk open` 打开本地浏览器控制台，精简为 **状态（Status）**、**配置（Configuration）** 与 **MCP 与技能（MCP & Skills，展示 6 个 Skill 与 28 个工具的编排链路及结构化参数表）** 三大页面。首次设置、选填 Craft 二进制附件上传接口、会话自动沉淀与写作偏好均在配置页完成。`gpk status` 查看 PID、端口、控制目录与初始化状态，`gpk connection` 定位 HTTP 客户端连接配置，`gpk start`、`gpk stop` 和 `gpk restart` 管理服务的启停与重启。 |
| Daily Note            | 各工作流默认记录当天的实际活动（可在复合创建／更新工具中通过 `activitySummary` 一步写入，保存 Source 与完成会话沉淀时自动记录，或通过 `gpk_daily_record` 独立记录）。 |
| MCP 运行时            | 28 个粗粒度 Agent BFF 工具：`gpk_status`（就绪状态、语言／时区偏好、自定义模板回传及可选授权／能力／模板／Setup 诊断）、`gpk_setup_open`、`gpk_preferences_update`、`gpk_captures_get`、`gpk_daily_record`、六类实体的 `get/create/update` 三元组（支持 ID/URL 直接解析、Project 上下文展开、批量创建 Task、`append`/`replaceContent` 更新、复合流转／关联／材料及结构化 `partial` 进度回执）、`gpk_links`、`gpk_review_inventory`、`gpk_sessions_next`、`gpk_sessions_apply` 与 `gpk_checkpoints` |
| Craft Adapter         | GPK 自己的 OAuth 客户端连接 Craft MCP 端点（动态注册、PKCE、CSRF state 校验、回环回调、令牌刷新存于宿主无关的密钥库，每个控制根一套令牌）；支持工作区建立、Craft 原生模板区安装／沿用与实时读回（`templates.read`）、全部实体的读写操作和链接；检查点的版本保留与恢复已用 fake 测试，真实空间待验证；创建时正文里的图片和文件原位复制：有网址的经 MCP（已实测），本地文件读取权限直接跟随 Agent 宿主并经选填的 Craft REST 上传接口传入（已用 fake 测试，真实空间待验证） |
| 本地控制 Adapter      | 通过带 `fsync` 的原子文件替换、进程锁与摘要冲突检测读写所选 `.gpk` 根下的 `settings.json`（含 `metadataLanguage`、`contentLanguage`、时区、布局、模板绑定与会话自动沉淀策略）与 `grants.json` |
| 授权                  | 每次知识写入由运行时从 `grants.json` 读取当前 `ControlGrant[]` 传入 `GrantedWriteGuard`，由 Adapter 复核目标真实容器与操作权限；归属移动按目标根授权并拒绝非 GPK 文档来源；工作区初始化或接入时由本地浏览器控制台自动启用工作区完整非破坏性权限，工具参数不携带任何权限 |
| Hook                  | Claude Code / Codex 加载路由规则和提醒，Antigravity 通过原生 `rules/AGENTS.md` 加载共享路由规则并在 `SessionStart` 注入补处理提示；开启会话自动沉淀时，三类宿主的 `Stop` 请求当前宿主 Agent 执行 `gpk-ingest`（`gpk_sessions_next` / `gpk_sessions_apply`），带循环保护并在下次活跃会话补处理 |
| 会话沉淀              | 手动补录最近 N 天和自动沉淀共用 Claude Code / Codex / Antigravity JSONL 读取器（未指定自定义路径时自动识别 `~/.claude/projects`、`~/.codex/sessions` 与 `~/.gemini/antigravity-cli/brain`）、原生会话身份、逐轮指纹、带租约恢复的本地锁及 `gpk_sessions_next` / `gpk_sessions_apply` 后端检查点；同一会话持续复用一个 Source。Fake-Craft 操作测试与隔离 Hook 命令已通过，真实客户端语义执行与真实 Craft 会话验收仍待进行 |
| 原生优先实体模板      | Setup 将五类文档／行实体模板安装或沿用到 Craft 原生 `Templates` 区并绑定到 `settings.templates` 与 `gpk/layout`（已初始化旧空间也会自动发现无歧义的 `GPK <Role>` 模板）；运行时实时读回用户在 Craft 中修改的模板（保留 callout 等方言并自动转义误写的任务复选框），按需随 `gpk_status` 和 `gpk_*_get` 捎带给 Agent，缺失或清空时平滑回退内置默认模板 |
| Claude / Codex / Antigravity 安装包 | 包含 Skill、路由规则／Hook、stdio 桥接程序与共享 HTTP 服务、启动配置及依赖许可；仅需 Node 22.13+，运行不依赖 pnpm 或源码目录 |
| TypeScript Port       | 面向多后端可移植的 `KnowledgeBackendPort`（工作区、模板、六类实体、捕获、链接、检查点）与精简的 `UserControlPort`（具名 Settings 与授权，支持 `mcp`、`api` 及 `local` 本地库连接），`src/runtime/operations.ts` 与具体 Adapter 完全解耦 |

已完成四个纵向切片：Setup（全程通过工具完成，不需手写文件）、报销提醒场景 A1
（从捕获到记录结果）、基于 Collections 的 Project 闭环（Area / Project 为带
Status 与 Area 列的行，Task 为 Project 行内按计划顺序排列的任务块，过程材料为嵌套页面，
仍有未处置 Task 时拒绝关闭），以及 Setup 建立的文件夹中的知识实体（Source / Wiki / Output
为文档，上下文链接是发起记录正文里的列表项，处理检查点保存在 `GPK System` 页面）。
Review 基于一次读取的全量进行，结论写回原记录。GPK 位置之外文档中的任务块不受管理。所有失败都是规范化的
`Result` 并带 MCP `isError: true`；没有工具会伪造记录或回执。

文本查询按大小写不敏感的子串匹配当前范围内记录的标题和正文（会话 Source 身份恢复继续校验精确行标记）。嵌套页面读取会跟随
各层子块分页，并受有限遍历预算约束；正文中的原生 Collection 会使记录读取保持部分覆盖。
入链发现仍依赖标题搜索且不扫描独立 Task 正文，因此链接及 `relatedTo` 结果明确返回
部分覆盖。创建会回读核对追加正文和复制的本地媒体；无法比较的后端渲染结果返回效果
不确定，需检查后继续。Setup 自动同步默认工作区完整权限、应用配置时区与 `contentLanguage`、绑定原生 Craft 模板供实时读回，并在 Craft
保留结构创建的中断进度供重试验证。这些修复有本地回归测试，未增加真实 Craft 实测证据。

测试覆盖控制文件信封、针对复现实测命令面的 fake 连接的 Craft 映射、原生模板修改读回与缺失回退、授权解析、
bootstrap 绑定、Claude Code／Codex／Antigravity 隔离安装包的 stdio 启动与两类协议协商、输入检查和进程退出。
真实 Craft 行为以带日期的证据记录在 [Craft 映射](docs/adapters/craft.md)；Codex + 真实 Craft 端到端验证已覆盖 Area、Project、Task、过程子页面、Source、Wiki、Output、原生模板修改读回及 Daily Note 活动记录。

后续实现：实体归档／恢复／删除、更多知识后端（Notion、飞书、Obsidian）、重复执行和用户要求的定时运行（[工作流设计](docs/workflow-design.md)第 5 节）。自动会话处理需要桌面 Agent 活跃运行；客户端关闭后的执行及自动 Daily Note 摘要未实现。
移动与远程部署仍待实现。OpenClaw、WorkBuddy、Hermes 仍为可选预览，
不包含 GPK MCP 运行时，未经实际客户端验证。

[验收清单](docs/conformance-scenarios.md)描述目标行为。

## 从这里开始

- [用户需求与场景](docs/requirements.zh-CN.md)：行动管理、知识管理及两者结合，说明设计要服务的需求。
- [构建、加载与验证](docs/getting-started.md)：当前基础能力的本地使用方法。安装包和索引
  由 `pnpm build` 生成，用于开发测试。
- [架构中文说明](docs/architecture.zh-CN.md)：职责、文档权威与评审路径；详细设计以
  [英文架构](docs/architecture.md)链接的领域、工作流和存取契约为准。
- [构建与分发说明](docs/distribution.zh-CN.md)：pnpm 命令、Release 压缩包与 CI 分发仓库规则。
- [交付路线](docs/roadmap.md)：产品里程碑与完成条件。

产品规范、设计、Skills、模板和测试，包括草稿，都在仓库中独立承载。个人 Project
上下文留在选定知识库，记录结果摘要与成果链接；仓库不依赖私人笔记。

## 许可

[MIT](LICENSE)
