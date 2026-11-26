// 動作確認。node tests/run.mjs （依存は先に scripts/ensure-deps.mjs で入れる）
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const S = (f) => join(ROOT, "scripts", f);
let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + detail}`);
  if (!cond) failed++;
};
const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: "utf8", ...opts });

// 1. 台帳の形
let r = run([S("ledger.mjs"), "validate"]);
ok("台帳の形と正規表現", r.status === 0, r.stderr);

// 2. AIっぽい文書で、期待する型が出る
r = run([S("proofread.mjs"), "--json", join(ROOT, "tests/fixtures/ai-like.md")]);
const rep = JSON.parse(r.stdout || "{}");
const ids = new Set((rep.files?.[0]?.findings || []).map((x) => x.ruleId));
for (const id of ["P001", "P002", "P004", "P005", "P006", "P007", "P008", "P009", "P011", "prh"]) ok(`ai-like.md で ${id} を検出`, ids.has(id), [...ids].join(","));
ok("textlint が実行できた", !rep.lintError, rep.lintError);

// 3. 普通の文書では何も出ない（誤検知の見張り）
r = run([S("proofread.mjs"), "--json", join(ROOT, "tests/fixtures/plain.md")]);
const rep2 = JSON.parse(r.stdout || "{}");
ok("plain.md は指摘0件", rep2.files?.[0]?.findings.length === 0, JSON.stringify(rep2.files?.[0]?.findings?.map((x) => x.ruleId)));

// 4. フック：設定がなければ黙る。あれば Claude に返す
const proj = mkdtempSync(join(tmpdir(), "jp-proj-"));
cpSync(join(ROOT, "tests/fixtures/ai-like.md"), join(proj, "doc.md"));
const hookInput = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(proj, "doc.md") }, cwd: proj });
r = run([S("hook-post-edit.mjs")], { input: hookInput, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
ok("設定がないプロジェクトではフックは何も返さない", r.status === 0 && r.stdout.trim() === "", r.stdout);
writeFileSync(join(proj, ".ja-proofread.json"), JSON.stringify({ profile: "doc" }));
r = run([S("hook-post-edit.mjs")], { input: hookInput, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
let hookOut = {};
try { hookOut = JSON.parse(r.stdout); } catch {}
ok("設定があればフックが block と理由を返す", hookOut.decision === "block" && /指摘/.test(hookOut.reason || ""), r.stdout.slice(0, 200));
const codeInput = JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(proj, "a.js") }, cwd: proj });
writeFileSync(join(proj, "a.js"), "// これは網羅的なコードではなく");
r = run([S("hook-post-edit.mjs")], { input: codeInput, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
ok("対象外の拡張子ではフックは黙る", r.stdout.trim() === "", r.stdout);

// 5. プロジェクトへの同梱（クラウド向け）
r = run([S("install-into-project.mjs"), proj]);
ok("同梱が成功する", r.status === 0, r.stderr);
const st = JSON.parse(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("settings.json に SessionStart と PostToolUse のフック", !!st.hooks?.SessionStart?.length && !!st.hooks?.PostToolUse?.length);
const sk = readFileSync(join(proj, ".claude/skills/ja-proofread-proofread/SKILL.md"), "utf8");
ok("同梱したスキルの名前とパスが書き換わる", /^name: ja-proofread-proofread$/m.test(sk) && sk.includes("../../ja-proofread/scripts/") && !sk.includes("../../scripts/"));
ok("同梱したスキルから見たスクリプトが実在する", existsSync(resolve(proj, ".claude/skills/ja-proofread-proofread", "../../ja-proofread/scripts/proofread.mjs")));
ok("サブエージェントが入る", existsSync(join(proj, ".claude/agents/ja-proofread-structure-reviewer.md")));
r = run([join(proj, ".claude/ja-proofread/scripts/hook-post-edit.mjs")], { input: hookInput, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
ok("同梱した版のフックが動く", /"decision":"block"/.test(r.stdout), r.stdout.slice(0, 200) + r.stderr);
r = run([S("hook-post-edit.mjs")], { input: hookInput, env: { ...process.env, CLAUDE_PROJECT_DIR: proj } });
ok("同梱があればプラグイン側のフックは黙る（二重指摘しない）", r.stdout.trim() === "", r.stdout.slice(0, 100));
r = run([S("install-into-project.mjs"), proj]);
const st2 = JSON.parse(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("同梱をやり直してもフックが重複しない", st2.hooks.PostToolUse.length === 1 && st2.hooks.SessionStart.length === 1);
r = run([S("install-into-project.mjs"), proj, "--remove"]);
const st3 = JSON.parse(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("同梱をやめるとフックと部品が消える", !st3.hooks && !existsSync(join(proj, ".claude/ja-proofread")));

// 6. 承認された候補の反映（リポジトリの写しで）
const repo = mkdtempSync(join(tmpdir(), "jp-repo-"));
mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
writeFileSync(join(repo, ".claude-plugin/marketplace.json"), "{}");
cpSync(ROOT, join(repo, "plugins/ja-proofread"), { recursive: true, filter: (p) => !p.includes("node_modules") });
const appr = join(repo, "approved.json");
writeFileSync(appr, JSON.stringify([
  { notionPageId: "t1", action: "add", name: "テスト用の型", category: "言い回し", level: "should", detect: { type: "regex-count", pattern: "することが重要", threshold: { minCount: 2 } }, guidance: "具体的に書く" },
  { notionPageId: "t2", action: "prh", expected: "問い合わせ", patterns: ["問合せ"] },
]));
const before = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version;
r = run([join(repo, "plugins/ja-proofread/scripts/ledger.mjs"), "apply", appr]);
const after = JSON.parse(readFileSync(join(repo, "plugins/ja-proofread/.claude-plugin/plugin.json"), "utf8")).version;
const [a, b] = before.split(".").map(Number);
ok("反映で2桁目のバージョンが上がる", r.status === 0 && after === `${a}.${b + 1}.0`, r.stderr + ` ${before}->${after}`);
ok("CHANGELOG に追記される", /テスト用の型/.test(readFileSync(join(repo, "CHANGELOG.md"), "utf8")));
writeFileSync(appr, JSON.stringify([{ action: "add", name: "壊れた型", category: "語彙", detect: { type: "regex", pattern: "(" }, guidance: "x" }]));
r = run([join(repo, "plugins/ja-proofread/scripts/ledger.mjs"), "apply", appr]);
ok("壊れた正規表現は反映を止める", r.status === 1);
const lone = mkdtempSync(join(tmpdir(), "jp-lone-"));
cpSync(ROOT, join(lone, "a/b"), { recursive: true, filter: (p) => !p.includes("node_modules") });
writeFileSync(appr, JSON.stringify([{ action: "retire", id: "P010" }]));
r = run([join(lone, "a/b/scripts/ledger.mjs"), "apply", appr]);
ok("リポジトリの外（インストール済みの場所など）では反映しない", r.status === 1, r.stdout);

// 7. 測る
const base = join(proj, "base.json");
r = run([S("stylometry.mjs"), "build", "--out", base, join(ROOT, "tests/fixtures/plain.md")]);
ok("基準を作れる", r.status === 0 && existsSync(base), r.stderr);
r = run([S("stylometry.mjs"), "compare", "--baseline", base, "--json", join(ROOT, "tests/fixtures/ai-like.md")]);
let cmp = {};
try { cmp = JSON.parse(r.stdout); } catch {}
ok("比較で「ではなく」の頻度差が出る", cmp.rates?.contrast?.current > cmp.rates?.contrast?.base, r.stdout.slice(0, 200));

console.log(failed ? `\n${failed} 件失敗` : "\nすべて成功");
process.exit(failed ? 1 : 0);
