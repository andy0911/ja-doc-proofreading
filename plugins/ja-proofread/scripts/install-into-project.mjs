#!/usr/bin/env node
// プラグインの部品を、プロジェクトの .claude/ に同梱する。
// クラウドセッション（Claude Code on the web）は、リポジトリの enabledPlugins や extraKnownMarketplaces を読まない。
// 一方、リポジトリの .claude/skills・.claude/agents・.claude/settings.json のフックは読む。そのための同梱方式。
//
//   node install-into-project.mjs <プロジェクトのディレクトリ>            同梱する（やり直すと最新版で入れ替える）
//   node install-into-project.mjs <プロジェクトのディレクトリ> --remove   同梱をやめる
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, readJSON } from "./lib.mjs";

const target = process.argv[2] && resolve(process.argv[2]);
const remove = process.argv.includes("--remove");
if (!target || !existsSync(target)) {
  console.error("使い方: node install-into-project.mjs <プロジェクトのディレクトリ> [--remove]");
  process.exit(2);
}

const claudeDir = join(target, ".claude");
const vendorDir = join(claudeDir, "ja-proofread");
const settingsPath = join(claudeDir, "settings.json");
const MARK = ".claude/ja-proofread/scripts/";
const SKILL_PREFIX = "ja-proofread-";
const AGENT_PREFIX = "ja-proofread-";

function removeHooks(settings) {
  if (!settings.hooks) return settings;
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = settings.hooks[ev]
      .map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !(h.command || "").includes(MARK)) }))
      .filter((g) => g.hooks.length);
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  return settings;
}

function removeVendored() {
  rmSync(vendorDir, { recursive: true, force: true });
  for (const sub of ["skills", "agents"]) {
    const d = join(claudeDir, sub);
    if (!existsSync(d)) continue;
    for (const n of readdirSync(d)) if (n.startsWith(sub === "skills" ? SKILL_PREFIX : AGENT_PREFIX)) rmSync(join(d, n), { recursive: true, force: true });
  }
}

if (resolve(ROOT) === resolve(vendorDir)) {
  console.error("同梱した版からは実行できません。インストールしたプラグインか、リポジトリの作業コピーの scripts/install-into-project.mjs を使ってください。");
  process.exit(1);
}

const settings = readJSON(settingsPath, {});
removeHooks(settings);
removeVendored();

if (remove) {
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  console.log("同梱をやめました（.ja-proofread.json は残しています）");
  process.exit(0);
}

// 1. 本体（スクリプト・ルール・台帳・設定・テンプレート）
mkdirSync(vendorDir, { recursive: true });
for (const d of ["scripts", "rules", "config", "data", "templates", ".claude-plugin"]) {
  cpSync(join(ROOT, d), join(vendorDir, d), { recursive: true });
}
cpSync(join(ROOT, "package.json"), join(vendorDir, "package.json"));

// 2. スキル（名前に接頭辞をつけ、相対パスを同梱先に合わせる）
for (const name of readdirSync(join(ROOT, "skills"))) {
  const src = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
  const out = src
    .replace(/^name:\s*(.+)$/m, `name: ${SKILL_PREFIX}$1`)
    .replaceAll("../../scripts/", "../../ja-proofread/scripts/")
    .replaceAll("../../data/", "../../ja-proofread/data/")
    .replaceAll("../../templates/", "../../ja-proofread/templates/");
  const dir = join(claudeDir, "skills", SKILL_PREFIX + name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), out);
}

// 3. サブエージェント（ファイル名だけ接頭辞。呼び出し名はプラグインと同じ）
mkdirSync(join(claudeDir, "agents"), { recursive: true });
for (const f of readdirSync(join(ROOT, "agents"))) cpSync(join(ROOT, "agents", f), join(claudeDir, "agents", AGENT_PREFIX + f));

// 4. フック
const cmd = (s, extra = "") => `node "$CLAUDE_PROJECT_DIR/${MARK}${s}"${extra}`;
settings.hooks = settings.hooks || {};
(settings.hooks.SessionStart ||= []).push({ matcher: "startup|resume", hooks: [{ type: "command", command: cmd("ensure-deps.mjs", " --quiet"), timeout: 300 }] });
(settings.hooks.PostToolUse ||= []).push({ matcher: "Write|Edit|MultiEdit", hooks: [{ type: "command", command: cmd("hook-post-edit.mjs"), timeout: 60 }] });
mkdirSync(claudeDir, { recursive: true });
writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");

// 5. プロジェクトの設定（無いときだけ作る。フックはこのファイルがあるときだけ動く）
const cfgPath = join(target, ".ja-proofread.json");
if (!existsSync(cfgPath)) {
  writeFileSync(cfgPath, JSON.stringify({ profile: "doc", include: ["**/*.md", "**/*.txt"], hook: { enabled: true, blockOn: "must" } }, null, 2) + "\n");
}

const v = readJSON(join(ROOT, ".claude-plugin", "plugin.json")).version;
console.log(`ja-proofread v${v} を ${target} に同梱しました。
- 本体: .claude/ja-proofread/
- スキル: .claude/skills/${SKILL_PREFIX}write, ${SKILL_PREFIX}proofread, ${SKILL_PREFIX}grow-ledger
- サブエージェント: structure-reviewer, fresh-eyes-reader
- フック: .claude/settings.json（SessionStart で依存を入れ、Write/Edit の後に校正）
- 設定: .ja-proofread.json
これらをコミットすると、クラウドセッションでも使えます。`);
