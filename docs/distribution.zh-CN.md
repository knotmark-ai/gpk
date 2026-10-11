# 构建与分发

[English](distribution.md) 是发布流程的完整说明。

采用 **pnpm + TypeScript + Node 构建脚本 + GitHub Actions**。`src/` 保存可编程接口和 Hook 加载器，
`plugin/` 保存共享 Skills、路由、知识和 Agent 行为指南；`platforms/` 保存平台元数据与加载配置；`package.json` 统一维护版本。
暂不拆 pnpm workspace，也不引入 Makefile 或额外构建框架。

## 本地使用

需要 Node.js 22.13+、项目锁定的 pnpm 11.20.0，以及用于 ZIP 打包和检查的 `zip`、
`unzip` 命令（macOS/Linux）。发布测试还使用 `bash`、`git`、`rsync`，只操作临时本地
Git 仓库，不需要 GitHub 凭据。TypeScript 7.0.2 是锁定的开发依赖；没有 Node 运行时
依赖，安装后的 Skill 不需要 TypeScript。

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm dist
```

- `pnpm typecheck`：严格检查 TypeScript 接口源码。
- `pnpm build:types`：生成 `dist/types/` 中的类型声明。
- `pnpm test:types`：检查源码及生成声明的调用方，包括应被拒绝的非法调用。
- `pnpm build`：编译类型声明，再生成 Claude Code、Codex 两个包和本地 marketplace 索引；
  `pnpm build:plugins` 编译 Hook 并打包，不重建领域声明。
- `pnpm build:previews`：在此基础上额外生成 OpenClaw、WorkBuddy、Hermes 三个预览包。
  `pnpm build:codex` 等命令只重建对应平台，保留其他平台；索引由完整构建刷新。
- `pnpm test`：构建并检查 TypeScript 契约、Skill 边界、资源引用、元数据、Hook 注册命令、执行权限、输出保护和 ZIP，
  并在临时本地仓库中验证分发发布、重试和版本回退保护。
- `pnpm test:clients`：Claude 校验插件、索引和 Skills；Codex 只检查版本及插件管理
  命令是否可用，不通过 CLI 校验 manifest，也不安装插件。
- `pnpm dist`：先编译类型声明，再从当前源码刷新同一个 `dist/marketplace/`，并把三个版本
  ZIP（Claude、Codex、marketplace）与 `SHA256SUMS` 写入 `dist/archives/`。打包前检查两个
  输出的归属，类型目录独立维护。`pnpm dist:previews` 会同时包含三个预览包及其 ZIP。

所有生成产物都在 `dist/`：`types/`、`marketplace/`、`archives/`，均不提交 Git。类型声明不混入插件 ZIP，
它们也不会自动提供运行时 Adapter 或工具入口。生成目录中的清单记录文件归属；构建器可以移除
过期生成文件，但遇到未知文件或人工修改会拒绝覆盖。先保存修改，再清理对应生成目录重建。

## 各平台输出

| 平台 | 本地输出 | 分发方式 |
|---|---|---|
| Claude Code | `dist/marketplace/claude/gpk/` | 分发仓库 marketplace 引用 `claude/gpk/` |
| Codex | `dist/marketplace/codex/gpk/` | 分发仓库 marketplace 引用 `codex/gpk/` |
| OpenClaw（预览） | `dist/marketplace/openclaw/gpk/`，仅 `--previews` 生成 | 使用该目录，不含 Claude/Codex 的 Hook 绑定 |
| WorkBuddy（预览） | `dist/marketplace/workbuddy/<skill>/`，仅 `--previews` 生成 | 上传或导入独立 Skill ZIP，每个 Skill 一个包 |
| Hermes（预览） | `dist/marketplace/skills/gpk/`，仅 `--previews` 生成 | 分发仓库的 `skills/gpk/`，通过 Skill tap 安装 |

每个 Skill 都带齐自身引用的资源，独立复制后不依赖源码目录。WorkBuddy 会添加平台
要求的中英文描述、版本和作者；Hermes 不生成 Python 原生插件。OpenClaw、WorkBuddy、
Hermes 是**可选的打包预览**：默认构建和 Release 不包含它们，也尚未完成实际客户端和
后端验证。

本地 marketplace 的根目录改为构建后的 `dist/marketplace/`，源码仓库本身不再是可安装的
marketplace。远端安装改用分发仓库；已有缓存安装不会被本次改造自动更新。

## CI 发布

`validate.yml` 在 push 和 PR 时执行验证，并确认构建没有修改被跟踪的源码。
`release.yml` 支持手动构建预览；推送 `v<package.json 版本>` 标签时发布 Release ZIP
和校验和。分支上的手动执行只上传临时 workflow artifact；在标签上手动执行则与
推送标签一样进入发布流程，并要求标签与软件包版本严格匹配。

`0.2.0-rc.1` 这类 SemVer 预发布版本会标记为 GitHub prerelease，并显式设置
`--latest=false`。分发更新步骤会在修改或打标签前退出，保留 marketplace 的正式版本，
也不会阻止后续发布 `0.1.1` 等正式补丁。`0.1.2+build-1` 只有构建元数据，仍属于正式版本。
当前没有独立预览 marketplace；预发布包通过 Release 附件下载。

要同时更新独立分发仓库，需要配置：

1. 建立专用分发仓库，用 README 初始化 `main` 并设为默认分支。普通内容全部由 CI
   维护；同步会清理过期文件，仅保留 `.git/`、`.github/`。不能使用源码仓库或混放人工文件。
2. 源仓库变量 `GPK_DISTRIBUTION_REPOSITORY`：填写分发仓库的 `owner/repo`。
3. 源仓库 Secret `GPK_DISTRIBUTION_TOKEN`：授权写入分发仓库 Contents 的凭据。
4. 如果目标分支不是 `main`，配置 `GPK_DISTRIBUTION_BRANCH`，并将其设为分发仓库
   默认分支，以便 Hermes 等读取默认分支的客户端使用。

CI 只上传 `dist/archives/`，下载后的 artifact 根目录就是 ZIP 和校验值，不重复传输解压目录
或类型声明。解压 marketplace ZIP 后提交到分发仓库，并创建版本标签；不会回写源码仓库。
使用 ZIP 恢复目录，避免 workflow artifact 传输丢失脚本执行权限。目标仓库检查不区分大小写。
未配置分发仓库变量时，该步骤跳过，Release ZIP 仍可发布。已存在的 Release 资源只接受
内容完全一致的重试，不覆盖不同内容；有变更应升级版本。按版本递增发布；已有旧版本
标签的重试只验证生成内容，不受保留的 `.github/` 配置变更影响，也不回退分发分支。
首次发布到分发仓库的版本必须按 SemVer 高于分支中 `release.json` 的版本；旧版本或
相同版本会在同步前报错。

ZIP 使用固定文件时间、排序和标准权限（可执行资源为 755，其余文件为 644），在同一
工具链中不受调用方 umask 影响，可重复生成。`GPK_SOURCE_SHA` 可记录源码
提交号，CI 会自动设置。workflow artifact 只用于 CI 中转，正式下载链接来自 Release。
分发同步会比较文件内容校验和，避免固定时间戳和相同文件大小使更新被误判为未变化。

仓库中的流程配置不代表远端仓库、Secret 或 Release 已创建。各平台实际安装、市场提交
和 Craft 行为验证仍需单独完成。格式依据及完整目录见[英文分发说明](distribution.md)。
