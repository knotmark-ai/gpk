# Build and distribution

[中文说明](distribution.zh-CN.md)

GPK uses **pnpm + TypeScript + Node scripts + GitHub Actions**. The source repository keeps
shared Skill content and platform metadata; generated artifacts are published
separately. No Makefile, workspace split or additional build framework is needed.

## Local commands

Use Node.js 22.13+ and pnpm **11.20.0**, pinned by `packageManager`. Release
packaging and archive tests require `zip` and `unzip` on PATH (macOS/Linux).
Local publication tests also use `bash`, `git` and `rsync`; they publish only to
temporary local Git repositories and require no GitHub credentials.
TypeScript **7.0.2** is the pinned development compiler. There are no runtime
Node dependencies; the installed Skill packages do not require TypeScript.

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm dist
```

- `pnpm typecheck` checks the TypeScript source interfaces.
- `pnpm build:types` creates declaration files in `dist/types/`.
- `pnpm test:types` compiles valid/invalid consumers of source and emitted contracts.
- `pnpm build` compiles declarations, then creates the Claude Code and Codex
  packages and local catalogs in `dist/marketplace/`; `pnpm build:plugins` performs
  Hook compilation and packaging without rebuilding domain declarations.
- `pnpm build:previews` additionally generates the OpenClaw, WorkBuddy and Hermes
  packaging previews. `pnpm build:claude`, `build:codex`, `build:openclaw`,
  `build:workbuddy` and `build:hermes` rebuild individual targets; run a full
  build to refresh catalogs.
- `pnpm test` builds and validates TypeScript contracts, Skill boundaries, metadata, isolated references,
  registered Hook commands, runtime fixture imports, executable permissions, output protection, release
  archives and distribution publication/retries against temporary local repositories.
- `pnpm test:clients` uses Claude CLI package/catalog/Skill validation and checks
  that the Codex CLI exposes plugin management. It does not validate Codex
  manifests through the CLI or install plugins.
- `pnpm dist` compiles declarations, refreshes the same `dist/marketplace/` tree
  from current sources and generates ZIPs/checksums in `dist/archives/`.
  It does not publish. Marketplace and archive ownership are checked before either
  tree is updated; type output is managed independently. `pnpm dist:previews`
  does the same with the three preview packages and their ZIPs included.

`package.json` owns package identity and version. Platform JSON files in
`platforms/` are metadata templates and Hook loading configuration; Skill and
routing instructions stay in `plugin/`. Hook compilation and packaged paths are
described in [plugin runtime](plugin-runtime.md#entry-hook-loading).
All generated output is under ignored `dist/`. TypeScript declarations stay separate
from plugin ZIPs; interfaces do not provide runtime adapter implementations.
Independent ownership inventories protect manually changed output; see [packaging and isolation](plugin-runtime.md#packaging-and-isolation).

## Release output

```text
dist/
├── types/                               Domain and port declarations
├── marketplace/                         One tree for development and distribution
│   ├── .claude-plugin/marketplace.json   source: ./claude/gpk
│   ├── .agents/plugins/marketplace.json  source.path: ./codex/gpk
│   ├── claude/gpk/
│   ├── codex/gpk/
│   ├── openclaw/gpk/                     --previews only
│   ├── workbuddy/<skill>/                --previews only
│   ├── skills/<skill>/                   Hermes Skill tap; --previews only
│   ├── release.json                      Version and optional source commit
│   ├── README.md
│   └── LICENSE
└── archives/
    ├── gpk-claude-<version>.zip
    ├── gpk-codex-<version>.zip
    ├── gpk-marketplace-<version>.zip
    ├── gpk-openclaw-<version>.zip        --previews only
    ├── <skill>-workbuddy-<version>.zip   --previews only; one per Skill
    ├── gpk-hermes-<version>.zip          --previews only
    └── SHA256SUMS
```

Plugin ZIPs contain a top-level `gpk/` directory with its hidden manifest.
WorkBuddy ZIPs each contain a standalone `<skill>/SKILL.md` and supporting files.
Hermes' ZIP contains all entrypoints under `skills/`. Marketplace ZIP contents can
be extracted directly into a dedicated distribution repository. Checksums cover every ZIP; fixed file
timestamps, normalized file permissions (755 for executable resources, 644 for
other files) and sorted archive entries make repeated packaging reproducible on
the same toolchain, independently of the caller's umask. Set `GPK_SOURCE_SHA` to
embed source provenance in `release.json`.

The source repository is no longer itself an installable marketplace. For local
development, register its generated `dist/marketplace/` directory. For remote installs,
register the distribution repository. Existing cached installations are not
changed by this refactor; updating them requires the client's installation flow.

## Delivery by platform

| Platform | Artifact / delivery | Verification boundary |
|---|---|---|
| Claude Code | Git marketplace → `claude/gpk/` | Existing read-only package scope |
| Codex | Git marketplace → `codex/gpk/` | Existing read-only package scope |
| OpenClaw | `openclaw/gpk/` directory without Claude/Codex Hook bindings | Opt-in preview (`--previews`); not published by the release workflow; no native code plugin or live verification |
| WorkBuddy | Upload/import the standalone Skill ZIP | Opt-in preview; required publication metadata generated; no platform submission performed |
| Hermes | Distribution repository as a Skill tap, reading `skills/gpk/` | Opt-in preview; standard Skill package; no native Python plugin or live verification |

There is no universal assumption that every marketplace can fetch a Release ZIP.
Use Git directories for catalogs and publish ZIPs as an additional delivery route.
The complete marketplace tree includes all referenced files and hidden manifests.

## GitHub Actions

`validate.yml` runs on pushes and pull requests. It installs the pinned pnpm,
validates packages and archives, and checks that builds leave tracked source
unchanged. It needs no publishing credentials.

`release.yml` runs on `v*` tags or manual dispatch. Manual runs from branches only
build and upload a workflow artifact for review. Manual dispatch on a tag follows
the same publication path as a tag push. Tag runs require the exact
`v<package.json version>` and then publish the ZIPs `pnpm dist` produces (Claude
Code, Codex and the marketplace tree) plus `SHA256SUMS` to a GitHub Release. CI uploads only `dist/archives/`; the downloaded artifact has ZIPs
and checksums at its root. The unpacked marketplace and type declarations are not
uploaded again. The workflow artifact is temporary CI transport; Release assets
are the user-facing downloads. Re-running a tag accepts identical existing assets
and refuses to overwrite different bytes. Bump the version for changed releases.

SemVer prereleases such as `0.2.0-rc.1` are published with GitHub's prerelease
flag and `--latest=false`. Their distribution update exits before modifying or
tagging the marketplace repository, preserving its stable version and allowing
later stable patches such as `0.1.1`. Build metadata alone, including a hyphen
in `0.1.2+build-1`, does not make a version a prerelease. There is no separate
preview marketplace channel; prerelease packages are available as Release assets.

To enable the optional distribution job:

1. Create a **dedicated generated-content repository**, initialize its `main`
   branch with a README, and make that its default branch. Do not use the source
   repository or a repository containing unrelated hand-maintained files.
2. Set source repository variable `GPK_DISTRIBUTION_REPOSITORY` to its `owner/repo`.
   If the destination branch differs from `main`, set `GPK_DISTRIBUTION_BRANCH`
   and make that branch the destination repository's default branch for Skill taps.
3. Set source repository secret `GPK_DISTRIBUTION_TOKEN` to a credential with
   Contents read/write access to that destination. The source repository's normal
   `GITHUB_TOKEN` publishes its Release; cross-repository writes use this secret.
4. Push the matching stable version tag after validation. The workflow restores the
   marketplace ZIP, commits that generated tree and creates the same version
   tag in the destination. It never commits generated files back to source.

The destination synchronization removes stale files; `.git/` and `.github/` are
preserved. Its ordinary content must therefore be CI-owned. If the distribution
variable is absent, Release ZIP publication still works and the distribution job
is skipped. A configured destination with missing credentials fails visibly.
Publish versions in increasing order; old-version tag reruns verify their existing
distribution tag without moving the current distribution branch. Changes to the
preserved `.github/` configuration are excluded from that comparison. A previously
unpublished version must have higher SemVer precedence than the distribution
branch's `release.json`; an older/equal version fails before synchronization.
The destination guard compares repository names without case sensitivity.

The distribution job extracts the marketplace ZIP after downloading the workflow
artifact, restoring executable bits that directory artifact transport discards.
Synchronization compares file checksums because normalized archive timestamps and
equal file sizes cannot establish that content is unchanged.

Workflow configuration does not mean a remote repository, secret, release or
marketplace entry has already been created. Client installations and live Craft
validation remain separate steps.

## Format references

- [TypeScript declaration-only output](https://www.typescriptlang.org/tsconfig/emitDeclarationOnly.html)
- [pnpm setup action](https://github.com/pnpm/action-setup)
- [Claude marketplace sources](https://code.claude.com/docs/en/plugins/marketplace-reference)
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenClaw compatible bundles](https://docs.openclaw.ai/plugins/bundles)
- [OpenClaw installation and marketplace restrictions](https://docs.openclaw.ai/cli/plugins/install)
- [WorkBuddy Skill structure and publication fields](https://open.workbuddy.cn/en/docs/skill)
- [Hermes Skills and GitHub taps](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/)
