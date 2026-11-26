#!/usr/bin/env node
// プラグインの部品を、プロジェクトの .claude/ に同梱する。
// claude.ai/code で1つのリポジトリを選んで始めるクラウドセッションは、リポジトリの enabledPlugins や extraKnownMarketplaces を読まない。
// 一方、そのリポジトリの .claude/skills・.claude/agents・.claude/settings.json のフックは読む。そのための同梱方式。
// （claude.ai の Projects のスレッドは、どれも読まない。docs/install-cloud.md を参照）
//
//   node install-into-project.mjs <プロジェクトのディレクトリ>            同梱する（やり直すと最新版で入れ替える）
//   node install-into-project.mjs <プロジェクトのディレクトリ> --remove   同梱をやめる
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, copyFileSync } from "node:fs";
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
    if (!Array.isArray(settings.hooks[ev])) continue;
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

// 書く前に、同梱のフックが入っていない settings.json を settings.json.bak に残す。
// すでにフックが入っている settings.json（2回目の同梱や --remove の前）は .bak にしない。
// 上書きすると、.bak がフック入りの設定になり、元に戻す役に立たなくなるため
const hasOurHooks = (st) => Object.values(st?.hooks || {}).some((gs) => Array.isArray(gs) && gs.some((g) => (g.hooks || []).some((h) => (h.command || "").includes(MARK))));
function writeSettings(settings, original) {
  mkdirSync(claudeDir, { recursive: true });
  if (existsSync(settingsPath) && !hasOurHooks(original)) copyFileSync(settingsPath, settingsPath + ".bak");
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

if (resolve(ROOT) === resolve(vendorDir)) {
  console.error("同梱した版からは実行できません。インストールしたプラグインか、リポジトリの作業コピーの scripts/install-into-project.mjs を使ってください。");
  process.exit(1);
}

// 既存の settings.json は、JSON として読めなければ何も変えずに止める（コメントや末尾のカンマを消してしまわないため）
let settings = {};
if (existsSync(settingsPath)) {
  try { settings = JSON.parse(readFileSync(settingsPath, "utf8")); }
  catch (e) {
    console.error(`${settingsPath} を JSON として読めないため、何も変えずに止めました（${e.message}）。コメントや末尾のカンマがあれば消してから、もう一度実行してください。`);
    process.exit(1);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    console.error(`${settingsPath} の中身がオブジェクトではないため、何も変えずに止めました。`);
    process.exit(1);
  }
}
const original = JSON.parse(JSON.stringify(settings));
removeHooks(settings);
removeVendored();

if (remove) {
  if (existsSync(settingsPath)) writeSettings(settings, original);
  const bak = existsSync(settingsPath + ".bak") ? "同梱する前の settings.json は settings.json.bak にあります（同梱のフックが入る前の、最後の状態です）" : "settings.json.bak はありません";
  console.log(`同梱をやめました（.ja-proofread.json は残しています。${bak}）`);
  process.exit(0);
}

// 1. 本体（スクリプト・ルール・台帳・設定・テンプレート）
mkdirSync(vendorDir, { recursive: true });
for (const d of ["scripts", "rules", "config", "data", "templates", ".claude-plugin"]) {
  cpSync(join(ROOT, d), join(vendorDir, d), { recursive: true });
}
for (const f of ["package.json", "package-lock.json"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(vendorDir, f));

// 2. スキル（名前に接頭辞をつけ、プラグイン用の変数を同梱先の場所に置き換える）
//    ${CLAUDE_PLUGIN_ROOT} と ${CLAUDE_PLUGIN_DATA} はプラグインのスキルでしか置き換わらない。
//    同梱したスキルでは ${CLAUDE_SKILL_DIR} から本体を指し、データ置き場はフックと同じ既定の場所を使う
for (const name of readdirSync(join(ROOT, "skills"))) {
  const src = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
  const out = src
    .replace(/^name:\s*(.+)$/m, `name: ${SKILL_PREFIX}$1`)
    .replaceAll('JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" ', "")
    .replace(/頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?/g, "")
    // プラグインとして入れたときだけの案内は消す（同梱した版から install-into-project は動かせないため）
    .replace(/[ \t]*<!-- plugin-only -->[\s\S]*?<!-- \/plugin-only -->\n?/g, "")
    // 同梱したサブエージェントは、プラグインの接頭辞なしの名前で呼ぶ
    .replace(/\bja-proofread:(structure-reviewer|fresh-eyes-reader)\b/g, "$1")
    .replace(/（呼ぶときは、この接頭辞つきの名前で指定します）/g, "")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", "${CLAUDE_SKILL_DIR}/../../ja-proofread");
  if (out.includes("${CLAUDE_PLUGIN_")) {
    console.error(`skills/${name}/SKILL.md に、同梱先で置き換えられない \${CLAUDE_PLUGIN_…} が残っています。`);
    process.exit(1);
  }
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
writeSettings(settings, original);

// 5. プロジェクトの設定（無いときだけ作る。フックはこのファイルがあるときだけ動く）
const cfgPath = join(target, ".ja-proofread.json");
if (!existsSync(cfgPath)) {
  writeFileSync(cfgPath, JSON.stringify({ profile: "doc", include: ["**/*.md", "**/*.txt"], hook: { enabled: true, blockOn: "must" } }, null, 2) + "\n");
}

const v = readJSON(join(ROOT, ".claude-plugin", "plugin.json")).version;
console.log(`ja-proofread v${v} を ${target} に同梱しました。
- 本体: .claude/ja-proofread/
- スキル: .claude/skills/${SKILL_PREFIX}write, ${SKILL_PREFIX}proofread, ${SKILL_PREFIX}grow-ledger
- サブエージェント: .claude/agents/${AGENT_PREFIX}structure-reviewer.md, ${AGENT_PREFIX}fresh-eyes-reader.md
- フック: .claude/settings.json（SessionStart で依存を入れ、Write/Edit の後に校正。元のファイルは settings.json.bak）
- 設定: .ja-proofread.json
コミットするパス：.claude/ja-proofread .claude/skills/ja-proofread-* .claude/agents/ja-proofread-* .claude/settings.json .ja-proofread.json
（settings.json.bak はコミットしません。Notion の場所も入るので、公開リポジトリや社外と共有するリポジトリには同梱しないでください）`);
