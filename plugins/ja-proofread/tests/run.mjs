// 動作確認。node tests/run.mjs （依存は先に scripts/ensure-deps.mjs で入れる）
// 利用者の記録を汚さないよう、データ置き場は一時ディレクトリにする（依存だけは入れたものをリンクして使う）
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const S = (f) => join(ROOT, "scripts", f);
let failed = 0, passed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + String(detail).slice(0, 400)}`);
  if (cond) passed++; else failed++;
};
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
// 条件を調べる途中で例外が出ても、テスト全体を止めずに ✗ として数える
const safe = (f) => { try { return f(); } catch (e) { return false; } };

const OUTER_DATA = process.env.JA_PROOFREAD_DATA || process.env.CLAUDE_PLUGIN_DATA || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ja-proofread");
const DATA = tmp("jp-data-");
if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(DATA, "deps"));
const BASE_ENV = { ...process.env, JA_PROOFREAD_DATA: DATA };
delete BASE_ENV.CLAUDE_PLUGIN_DATA;
delete BASE_ENV.CLAUDE_PROJECT_DIR;
const WORK = tmp("jp-cwd-");
const run = (args, { env = {}, ...opts } = {}) => spawnSync(process.execPath, args, { encoding: "utf8", cwd: WORK, ...opts, env: { ...BASE_ENV, ...env } });
const json = (s) => { try { return JSON.parse(s); } catch { return {}; } };
const proofread = (file, extra = [], opts = {}) => json(run([S("proofread.mjs"), "--json", ...extra, file], opts).stdout);
const idsOf = (rep) => new Set((rep.files?.[0]?.findings || []).map((x) => x.ruleId));
const write = (dir, name, body) => { const p = join(dir, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, body); return p; };

// 1. 台帳と辞書の形
let r = run([S("ledger.mjs"), "validate"]);
ok("台帳と辞書の形と正規表現", r.status === 0, r.stderr);

// 2. AIっぽい文書で、期待する型が出る
const rep = proofread(join(ROOT, "tests/fixtures/ai-like.md"));
const ids = idsOf(rep);
for (const id of ["P001", "P002", "P004", "P005", "P006", "P007", "P008", "P009", "P011", "prh"]) ok(`ai-like.md で ${id} を検出`, ids.has(id), [...ids].join(","));
ok("textlint が実行できた", rep.ok === true && !rep.lintError, rep.lintError);

// 3. 普通の文書では指摘が少ない（誤検知の見張り）
const rep2 = proofread(join(ROOT, "tests/fixtures/plain.md"));
ok("plain.md は指摘0件", rep2.files?.[0]?.findings.length === 0, JSON.stringify(rep2.files?.[0]?.findings?.map((x) => x.ruleId)));
const human = proofread(join(ROOT, "tests/fixtures/human-report.md"));
const hf = human.files?.[0]?.findings || [];
ok("人が書いた見本（数千字）で台帳の型と表記辞書は0件", !hf.some((x) => /^[PR]\d+$|^prh$/.test(x.ruleId)), hf.map((x) => `${x.ruleId}:${x.line}`).join(","));
ok("人が書いた見本の指摘は5件以下", hf.length <= 5, hf.map((x) => `${x.ruleId}:${x.line}`).join(","));

// 誤検知だった語（ユーザビリティ、サーバント、以上の通り、以下の表）
const fpDoc = write(WORK, "fp.md", "# 確認\n\n画面のユーザビリティを調べました。サーバントリーダーシップの本も読みました。以上の通り、以下の表にまとめます。\n\nユーザ名とサーバの設定は右の図で確かめます。\n");
const fpRep = proofread(fpDoc);
const fpMsgs = (fpRep.files?.[0]?.findings || []).map((x) => `${x.ruleId} ${x.line} ${x.message}`);
ok("prh がユーザビリティ・サーバントに当たらない", !fpMsgs.some((m) => /^prh 3 /.test(m)), fpMsgs.join(" / "));
ok("prh は「ユーザ名」「サーバの」には当たる", fpMsgs.filter((m) => /^prh 5 /.test(m)).length === 2, fpMsgs.join(" / "));
ok("P011 が「以上の通り」「以下の表」に当たらず「右の図」には当たる", !fpMsgs.some((m) => /^P011 3 /.test(m)) && fpMsgs.some((m) => /^P011 5 /.test(m)), fpMsgs.join(" / "));

// 4. profile に ../ を入れても、一時ディレクトリの外は触らない
const victimDir = tmp("jp-victim-");
const victim = write(victimDir, "keep.json", "KEEP");
r = run([S("proofread.mjs"), "--profile", `/../../../../../../..${victim.replace(/\.json$/, "")}`, join(ROOT, "tests/fixtures/plain.md")]);
ok("--profile に知らない名前を渡すと1行のエラーで止まる", r.status === 2 && readFileSync(victim, "utf8") === "KEEP" && r.stderr.trim().split("\n").length === 1 && !/\n\s+at /.test(r.stderr), r.stderr);
const badCfg = tmp("jp-badcfg-");
writeFileSync(join(badCfg, ".ja-proofread.json"), JSON.stringify({ profiles: { "**": "../../etc/passwd" } }));
r = run([S("proofread.mjs"), join(ROOT, "tests/fixtures/plain.md")], { cwd: badCfg });
ok(".ja-proofread.json の profiles に知らない名前があると止まる", r.status === 2 && /使えません/.test(r.stderr), r.stderr + r.stdout);

// 5. 存在しないファイルは1行のエラー
r = run([S("proofread.mjs"), join(WORK, "nai.md")]);
ok("存在しないファイルはスタックトレースでなく1行のエラー", r.status === 2 && /見つかりません/.test(r.stderr) && r.stderr.trim().split("\n").length === 1, r.stderr);

// 6. textlint が落ちたら「0件」にしない
const fake = tmp("jp-fake-");
const hash = createHash("sha256").update(readFileSync(join(ROOT, "package.json")));
if (existsSync(join(ROOT, "package-lock.json"))) hash.update(readFileSync(join(ROOT, "package-lock.json")));
write(fake, "deps/.stamp", hash.digest("hex").slice(0, 16));
write(fake, "deps/node_modules/textlint/bin/textlint.js", 'process.stderr.write("Error: boom\\n"); process.exit(2);\n');
const crashed = proofread(join(ROOT, "tests/fixtures/ai-like.md"), [], { env: { JA_PROOFREAD_DATA: fake } });
ok("textlint が落ちると ok:false と lintError を返す", crashed.ok === false && /boom/.test(crashed.lintError || ""), JSON.stringify({ ok: crashed.ok, e: crashed.lintError }));
r = run([S("proofread.mjs"), join(ROOT, "tests/fixtures/ai-like.md")], { env: { JA_PROOFREAD_DATA: fake } });
ok("表示に textlint が動かなかったことが出る", /textlint が動かなかった/.test(r.stdout), r.stdout.slice(0, 300));
write(fake, "deps/node_modules/textlint/bin/textlint.js", 'process.stderr.write("Error: silent\\n"); process.exit(0);\n');
const silent = proofread(join(ROOT, "tests/fixtures/ai-like.md"), [], { env: { JA_PROOFREAD_DATA: fake } });
ok("終了コード0でも出力が空で stderr があれば失敗とみなす", silent.ok === false && /silent/.test(silent.lintError || ""), JSON.stringify(silent.lintError));

// 7. disable：台帳の正規表現の型、プリセット内のルール、プリセット全体
const disDir = tmp("jp-disable-");
const disDoc = write(disDir, "d.md", "# 例\n\n私は私は東京の大学に行った。網羅的な説明をします。\n\nシーン／ドライバー／エモーション／バックグラウンドを聞きます。右の図で確かめます。\n\n- **重要**: 大事です\n");
const before = idsOf(proofread(disDoc, [], { cwd: disDir }));
writeFileSync(join(disDir, ".ja-proofread.json"), JSON.stringify({ disable: ["P008", "P009", "P011", "ja-technical-writing/no-doubled-joshi", "@textlint-ja/preset-ai-writing"] }));
const after = idsOf(proofread(disDoc, [], { cwd: disDir }));
ok("disable の前は P008・P009・P011・no-doubled-joshi・ai-writing が出る", ["P008", "P009", "P011", "ja-technical-writing/no-doubled-joshi"].every((x) => before.has(x)) && [...before].some((x) => x.includes("ai-writing")), [...before].join(","));
ok("disable で台帳の regex 型とプリセットのルールが消える", !["P008", "P009", "P011", "ja-technical-writing/no-doubled-joshi"].some((x) => after.has(x)) && ![...after].some((x) => x.includes("ai-writing")), [...after].join(","));

// 8. textlint-disable の範囲は、件数・構成・正規表現の型でも対象外
const quoted = write(WORK, "quoted.md", "# 作例の紹介\n\n悪い例を引用します。\n\n<!-- textlint-disable -->\n\n> 大事なのは価格ではなく体験です。品質ではなく速さです。量ではなく質です。形ではなく中身です。網羅的に解説します。\n\n<!-- textlint-enable -->\n\n上の例は避けます。次の会議で決めます。\n");
const qids = idsOf(proofread(quoted));
ok("textlint-disable の中の作例で P001・P008 が出ない", !qids.has("P001") && !qids.has("P008"), [...qids].join(","));
const named = write(WORK, "named.md", "# 例\n\n<!-- textlint-disable P008 -->\n網羅的に解説します。\n<!-- textlint-enable P008 -->\n\n大事なのは価格ではなく体験です。品質ではなく速さです。量ではなく質です。形ではなく中身です。\n");
const nids = idsOf(proofread(named));
ok("ルール名つきの textlint-disable はそのルールだけ外す", !nids.has("P008") && nids.has("P001"), [...nids].join(","));

// 9. 存在しない prh は警告して外し、textlint は動かす
const prhDir = tmp("jp-prh-");
writeFileSync(join(prhDir, ".ja-proofread.json"), JSON.stringify({ prh: ["./proofread/team-prh.yml"] }));
const prhRep = proofread(join(ROOT, "tests/fixtures/ai-like.md"), [], { cwd: prhDir });
ok("存在しない prh は警告して外し、textlint の指摘は出る", prhRep.ok && (prhRep.warnings || []).some((w) => /team-prh/.test(w)) && idsOf(prhRep).has("prh"), JSON.stringify(prhRep.warnings) + prhRep.lintError);
const tpl = json(readFileSync(join(ROOT, "templates/ja-proofread.example.json"), "utf8"));
ok("設定の例の prh は空で、.claude と CLAUDE.md を外す", Array.isArray(tpl.prh) && tpl.prh.length === 0 && tpl.exclude.includes(".claude/**") && tpl.exclude.includes("**/CLAUDE.md"));

// 10. 検出の記録は日・ファイル・型ごとに1件
const hitDir = tmp("jp-hits-");
const hitDoc = write(hitDir, "h.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
for (let i = 0; i < 3; i++) run([S("proofread.mjs"), "--json", hitDoc], { env: { JA_PROOFREAD_DATA: hitDir } });
const hitLines = readFileSync(join(hitDir, "hits.jsonl"), "utf8").trim().split("\n");
r = run([S("ledger.mjs"), "stats"], { env: { JA_PROOFREAD_DATA: hitDir } });
ok("同じ日に同じファイルを3回校正しても、型ごとに1件", hitLines.length === 1 && /^P001\t1\t/m.test(r.stdout), hitLines.length + " " + r.stdout.slice(0, 200));
ok("記録は JA_PROOFREAD_DATA の場所に書かれる", !existsSync(join(DATA, "hits.jsonl")) || statSync(join(DATA, "hits.jsonl")).size > 0);

// 11. 長い文書でも構成チェックが速い
const { runStructureChecks } = await import(join(ROOT, "scripts/structure-check.mjs"));
const ledger = json(readFileSync(join(ROOT, "data/ledger.json"), "utf8"));
const big = "# 大きな文書\n\n" + "大事なのは価格ではなく体験です。\n".repeat(9000);
let t0 = Date.now();
runStructureChecks(big, ledger, "doc");
ok(`約${Math.round(big.length / 1000)}千字・9000か所の一致でも構成チェックが2秒以内（${Date.now() - t0}ms）`, Date.now() - t0 < 2000);

// 12. フック：設定がなければ黙る。あれば Claude に返す
const proj = tmp("jp-proj-");
cpSync(join(ROOT, "tests/fixtures/ai-like.md"), join(proj, "doc.md"));
const hookIn = (f) => JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(proj, f) }, cwd: proj });
const hook = (f, script = S("hook-post-edit.mjs")) => run([script], { input: hookIn(f), env: { CLAUDE_PROJECT_DIR: proj } });
r = hook("doc.md");
ok("設定がないプロジェクトではフックは何も返さない", r.status === 0 && r.stdout.trim() === "", r.stdout);
writeFileSync(join(proj, ".ja-proofread.json"), JSON.stringify({ profile: "doc" }));
let out = json(hook("doc.md").stdout);
ok("設定があればフックが block と理由を返す", out.decision === "block" && /指摘/.test(out.reason || ""), JSON.stringify(out).slice(0, 200));
out = json(hook("doc.md").stdout);
ok("同じ指摘が残るだけなら2回目は block しない（前回の結果と比べる）", !out.decision && /指摘/.test(out.hookSpecificOutput?.additionalContext || ""), JSON.stringify(out).slice(0, 200));
writeFileSync(join(proj, "doc.md"), readFileSync(join(proj, "doc.md"), "utf8") + "\n出来ることを書きます。\n");
out = json(hook("doc.md").stdout);
ok("新しい must が出たらまた block する", out.decision === "block" && /新しく出た指摘/.test(out.reason || ""), JSON.stringify(out).slice(0, 300));
write(proj, "soft.md", "# メモ\n\n網羅的に説明します。\n");
out = json(hook("soft.md").stdout);
ok("blockOn が must なら「直したい」「参考」だけでは block しない", !out.decision && /P008/.test(out.hookSpecificOutput?.additionalContext || ""), JSON.stringify(out).slice(0, 200));
write(proj, "a.js", "// これは網羅的なコードではなく");
r = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(proj, "a.js") }, cwd: proj }), env: { CLAUDE_PROJECT_DIR: proj } });
ok("対象外の拡張子ではフックは黙る", r.stdout.trim() === "", r.stdout);
write(proj, ".claude/notes.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
write(proj, "CLAUDE.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
ok("既定では .claude/ の下と CLAUDE.md を見ない", hook(".claude/notes.md").stdout.trim() === "" && hook("CLAUDE.md").stdout.trim() === "");
write(proj, "big.md", "# 大きい\n\n" + "これは長い文書の一文です。\n".repeat(16000));
out = json(hook("big.md").stdout);
ok("200KB を超えるファイルは飛ばし、その旨を返す", /200KB/.test(out.hookSpecificOutput?.additionalContext || ""), JSON.stringify(out).slice(0, 200));
const crashProj = tmp("jp-crash-");
writeFileSync(join(crashProj, ".ja-proofread.json"), "{}");
write(crashProj, "p.md", readFileSync(join(ROOT, "tests/fixtures/plain.md"), "utf8"));
r = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(crashProj, "p.md") }, cwd: crashProj }), env: { CLAUDE_PROJECT_DIR: crashProj, JA_PROOFREAD_DATA: fake } });
ok("textlint が動かなかったことをフックも返す", /textlint が動かなかった/.test(r.stdout), r.stdout.slice(0, 200));

// 13. プロジェクトへの同梱（クラウド向け）
writeFileSync(join(proj, ".ja-proofread.json"), JSON.stringify({ profile: "doc", hook: { blockOn: "must" } }));
mkdirSync(join(proj, ".claude"), { recursive: true });
writeFileSync(join(proj, ".claude/settings.json"), '{\n  // コメント\n  "permissions": {}\n}\n');
r = run([S("install-into-project.mjs"), proj]);
ok("settings.json が JSON として読めなければ止まり、何も変えない", r.status === 1 && readFileSync(join(proj, ".claude/settings.json"), "utf8").includes("// コメント") && !existsSync(join(proj, ".claude/ja-proofread")), r.stderr);
r = run([S("install-into-project.mjs"), proj, "--remove"]);
ok("--remove でも読めない settings.json は変えない", r.status === 1 && readFileSync(join(proj, ".claude/settings.json"), "utf8").includes("// コメント"), r.stderr);
writeFileSync(join(proj, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
r = run([S("install-into-project.mjs"), proj]);
ok("同梱が成功する", r.status === 0, r.stderr);
ok("書く前に settings.json.bak を作る", json(readFileSync(join(proj, ".claude/settings.json.bak"), "utf8")).permissions?.allow?.[0] === "Bash(ls)");
const st = json(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("settings.json に SessionStart と PostToolUse のフック、元の設定も残る", !!st.hooks?.SessionStart?.length && !!st.hooks?.PostToolUse?.length && st.permissions?.allow?.[0] === "Bash(ls)");
const skillDir = join(proj, ".claude/skills/ja-proofread-proofread");
const sk = readFileSync(join(skillDir, "SKILL.md"), "utf8");
ok("同梱したスキルの名前が変わり、プラグイン用の変数が残らない", /^name: ja-proofread-proofread$/m.test(sk) && !sk.includes("${CLAUDE_PLUGIN_") && !sk.includes("JA_PROOFREAD_DATA"));
const vendoredPaths = [...sk.matchAll(/\$\{CLAUDE_SKILL_DIR\}(\/[^\s"`]+)/g)].map((m) => skillDir + m[1]);
ok("同梱したスキルから見たスクリプトとテンプレートが実在する", vendoredPaths.length >= 3 && vendoredPaths.every((p) => existsSync(p)), vendoredPaths.filter((p) => !existsSync(p)).join(","));
for (const name of ["proofread", "grow-ledger", "write"]) {
  const src = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
  const cmds = src.split("\n").filter((l) => /node .*scripts\/(proofread|ensure-deps|ledger)\.mjs/.test(l) && !/plugins\/ja-proofread\/scripts/.test(l));
  ok(`プラグインの ${name} スキルは \${CLAUDE_PLUGIN_ROOT} で参照し、記録を使うスクリプトにはデータ置き場を渡す`, !src.includes("../../") && cmds.length > 0 && cmds.every((l) => l.includes('"${CLAUDE_PLUGIN_ROOT}/scripts/') && (/ledger\.mjs" list/.test(l) && name === "write" || l.includes('JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" node'))), cmds.join("\n"));
}
ok("サブエージェントが入る", existsSync(join(proj, ".claude/agents/ja-proofread-structure-reviewer.md")));
write(proj, "doc2.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
r = hook("doc2.md", join(proj, ".claude/ja-proofread/scripts/hook-post-edit.mjs"));
ok("同梱した版のフックが動く", /"decision":"block"/.test(r.stdout), r.stdout.slice(0, 200) + r.stderr);
r = hook("doc2.md");
ok("同梱があればプラグイン側のフックは黙る（二重指摘しない）", r.stdout.trim() === "", r.stdout.slice(0, 100));
r = run([S("install-into-project.mjs"), proj]);
const st2 = json(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("同梱をやり直してもフックが重複しない", st2.hooks.PostToolUse.length === 1 && st2.hooks.SessionStart.length === 1);
r = run([S("install-into-project.mjs"), proj, "--remove"]);
const st3 = json(readFileSync(join(proj, ".claude/settings.json"), "utf8"));
ok("同梱をやめるとフックと部品が消え、ほかの設定は残る", !st3.hooks && st3.permissions?.allow?.[0] === "Bash(ls)" && !existsSync(join(proj, ".claude/ja-proofread")));

// 14. 承認された候補の反映（git init したリポジトリの写しで）
const copyPlugin = (dest) => cpSync(ROOT, dest, { recursive: true, filter: (p) => !p.includes("node_modules") });
const makeRepo = (dir) => {
  mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
  writeFileSync(join(dir, ".claude-plugin/marketplace.json"), "{}");
  copyPlugin(join(dir, "plugins/ja-proofread"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  return join(dir, "plugins/ja-proofread/scripts/ledger.mjs");
};
const repo = tmp("jp-repo-");
const ledgerJs = makeRepo(repo);
const appr = join(tmp("jp-appr-"), "approved.json");
const snapshot = () => ["plugins/ja-proofread/data/ledger.json", "plugins/ja-proofread/data/prh.yml", "plugins/ja-proofread/.claude-plugin/plugin.json"].map((f) => readFileSync(join(repo, f), "utf8")).join("\0") + (existsSync(join(repo, "CHANGELOG.md")) ? readFileSync(join(repo, "CHANGELOG.md"), "utf8") : "");
const applyItems = (items, script = ledgerJs, env = {}) => { writeFileSync(appr, JSON.stringify(items)); return run([script, "apply", appr], { env }); };
const unchanged = (label, items) => { const s0 = snapshot(); const res = applyItems(items); ok(label, res.status === 1 && snapshot() === s0, res.stdout + res.stderr); };
unchanged("入れ子の量指定子 (あ+)+い を拒否し、ファイルは変わらない", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(あ+)+い" }, guidance: "x" }]);
unchanged("長い繰り返しで遅い正規表現を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex-count", pattern: "(?:あ|あ)*う", threshold: { minCount: 1 } }, guidance: "x" }]);
unchanged("長さ0で一致する正規表現を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(?=あ)" }, guidance: "x" }]);
unchanged("prh の /…/ 形式も同じ検査をする", [{ action: "prh", expected: "テスト", patterns: ["/(テ+)+ト/"] }]);
// 反映の見本には、本番の台帳や辞書に入りそうにない語を使う（grow-ledger の例と同じ語だと、本物の辞書に入ったときに落ちる）
const SAMPLE_EXPECTED = "試験用の語ゑ", SAMPLE_PATTERN = "しけんようのごゑ";
unchanged("途中で失敗したら prh.yml も書き換えない", [{ action: "prh", expected: SAMPLE_EXPECTED, patterns: [SAMPLE_PATTERN] }, { action: "add", name: "壊れた型", category: "語彙", detect: { type: "regex", pattern: "(" }, guidance: "x" }]);
unchanged("知らない action はエラー", [{ action: "delete", id: "P001" }]);
unchanged("prh の重複（既にある expected）はエラー", [{ action: "prh", expected: "ユーザー", patterns: ["ユーザ―"] }]);
unchanged("prh の重複（既にある pattern）はエラー", [{ action: "prh", expected: "お得な", patterns: ["おトク"] }]);
const before2 = json(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version;
r = applyItems([
  { notionPageId: "t1", action: "add", name: "テスト用の型", category: "言い回し", level: "should", detect: { type: "regex-count", pattern: "することが重要", threshold: { minCount: 2 } }, guidance: "具体的に書く" },
  { notionPageId: "t2", action: "prh", expected: SAMPLE_EXPECTED, patterns: [SAMPLE_PATTERN] },
]);
const after2 = safe(() => json(readFileSync(join(repo, "plugins/ja-proofread/.claude-plugin/plugin.json"), "utf8")).version);
const [a, b] = before2.split(".").map(Number);
ok("反映で2桁目のバージョンが上がる", r.status === 0 && after2 === `${a}.${b + 1}.0`, r.stderr + ` ${before2}->${after2}`);
ok("CHANGELOG に追記され、prh.yml にも足される", safe(() => /テスト用の型/.test(readFileSync(join(repo, "CHANGELOG.md"), "utf8")) && readFileSync(join(repo, "plugins/ja-proofread/data/prh.yml"), "utf8").includes(SAMPLE_PATTERN)), r.stderr);
r = run([ledgerJs, "validate"]);
ok("反映したあとの台帳と辞書も validate を通る", r.status === 0, r.stderr);
const lone = tmp("jp-lone-");
copyPlugin(join(lone, "a/b"));
r = applyItems([{ action: "retire", id: "P010" }], join(lone, "a/b/scripts/ledger.mjs"));
ok("マーケットプレイスの外では反映しない", r.status === 1, r.stdout);
const nogit = tmp("jp-nogit-");
mkdirSync(join(nogit, ".claude-plugin"), { recursive: true });
writeFileSync(join(nogit, ".claude-plugin/marketplace.json"), "{}");
copyPlugin(join(nogit, "plugins/ja-proofread"));
r = applyItems([{ action: "retire", id: "P010" }], join(nogit, "plugins/ja-proofread/scripts/ledger.mjs"));
ok("git の作業コピーでなければ反映しない", r.status === 1 && /git/.test(r.stderr), r.stderr);
const fakeHome = tmp("jp-home-");
const installed = makeRepo(join(fakeHome, ".claude/plugins/marketplaces/ja-doc-proofreading"));
r = applyItems([{ action: "retire", id: "P010" }], installed, { HOME: fakeHome });
ok("~/.claude/plugins の下では反映しない", r.status === 1 && /インストール済み/.test(r.stderr), r.stderr);
r = applyItems([{ action: "retire", id: "P010" }], ledgerJs, { CLAUDE_CODE_PLUGIN_CACHE_DIR: repo });
ok("CLAUDE_CODE_PLUGIN_CACHE_DIR の下では反映しない", r.status === 1 && /インストール済み/.test(r.stderr), r.stderr);

// 15. SessionStart で依存を入れられなかったら、Claude と利用者に知らせる
if (existsSync(join(ROOT, "node_modules", "textlint"))) {
  console.log("- （プラグインの中に node_modules があるため、依存を入れられないときの確認は飛ばしました）");
} else {
  const noDeps = tmp("jp-nodeps-");
  r = run([S("ensure-deps.mjs"), "--quiet"], { env: { JA_PROOFREAD_DATA: noDeps, npm_config_offline: "true", npm_config_cache: tmp("jp-npmcache-") } });
  const so = json(r.stdout);
  ok("依存を入れられないと additionalContext と systemMessage で知らせる", r.status === 0 && /入れられませんでした/.test(so.hookSpecificOutput?.additionalContext || "") && so.hookSpecificOutput?.hookEventName === "SessionStart" && /入れられませんでした/.test(so.systemMessage || ""), r.stdout.slice(0, 300) + r.stderr.slice(0, 300));
  ok("失敗してもロックを残さない", !existsSync(join(noDeps, "deps/.lock")));
}

// 16. 測る
const base = join(proj, "base.json");
r = run([S("stylometry.mjs"), "build", "--out", base, join(ROOT, "tests/fixtures/plain.md")]);
ok("基準を作れる", r.status === 0 && existsSync(base), r.stderr);
r = run([S("stylometry.mjs"), "compare", "--baseline", base, "--json", join(ROOT, "tests/fixtures/ai-like.md")]);
const cmp = json(r.stdout);
ok("比較で「ではなく」の頻度差が出る", cmp.rates?.contrast?.current > cmp.rates?.contrast?.base, r.stdout.slice(0, 200));

// 17. 0.1.2 で直した不具合の再現
// A. インラインコードやコードブロックの中の textlint-disable は範囲にしない
const codeDis = write(WORK, "code-disable.md", "# 書き方\n\n作例を外すときは `<!-- textlint-disable -->` と書きます。\n\n網羅的に調べました。さまざまな側面があります。\n\n価格ではなく体験です。品質ではなく速さです。量ではなく質です。形ではなく中身です。色ではなく形です。\n");
const cdRep = proofread(codeDis);
const cdIds = idsOf(cdRep);
ok("インラインコードの中の textlint-disable では指摘が消えない（P008 と P001 が出る）", cdIds.has("P008") && cdIds.has("P001") && (cdRep.files?.[0]?.findings || []).length >= 3, JSON.stringify((cdRep.files?.[0]?.findings || []).map((x) => x.ruleId)));
const fenceDis = write(WORK, "fence-disable.md", "# 書き方\n\n```markdown\n<!-- textlint-disable -->\n```\n\n網羅的に調べました。\n\n価格ではなく体験です。品質ではなく速さです。量ではなく質です。形ではなく中身です。色ではなく形です。\n");
const fdIds = idsOf(proofread(fenceDis));
ok("コードブロックの中の textlint-disable でも指摘が消えない", fdIds.has("P008") && fdIds.has("P001"), [...fdIds].join(","));
const { disabledRanges } = await import(join(ROOT, "scripts/structure-check.mjs"));
ok("本物の textlint-disable コメントは今までどおり範囲になる", disabledRanges("a\n<!-- textlint-disable -->\nb\n<!-- textlint-enable -->\n").length === 1 && disabledRanges("`<!-- textlint-disable -->`\n").length === 0);
// 文書全体の指摘（行1）は、1行目から始まる disable の範囲で消さない
const wholeDoc = write(WORK, "whole.md", "<!-- textlint-disable -->\n<!-- textlint-enable -->\n\n# 一覧\n\n- 赤\n- 青\n- 黄\n\n- 犬\n- 猫\n- 鳥\n\n- 春\n- 夏\n- 秋\n");
const wf = proofread(wholeDoc).files?.[0]?.findings || [];
ok("文書全体の指摘（3項目の箇条書きの割合）は1行目からの disable の範囲で消えない", wf.some((x) => x.ruleId === "P004" && x.line === 1), JSON.stringify(wf.map((x) => `${x.ruleId}:${x.line}`)));

// B. 正規表現の検査：漢字・全角の見本、繰り返す選択、長さ0
unchanged("(?:[一-龯]|[一-龯])+$ を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(?:[一-龯]|[一-龯])+$" }, guidance: "x" }]);
unchanged("(?:漢|漢字?)+$ を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(?:漢|漢字?)+$" }, guidance: "x" }]);
unchanged("(?:\\p{Script=Han}|\\p{Script=Han})+$（u）を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(?:\\p{Script=Han}|\\p{Script=Han})+$", flags: "u" }, guidance: "x" }]);
unchanged("後読みだけで長さ0になる (?<=漢) を拒否する", [{ action: "add", name: "x", category: "語彙", detect: { type: "regex", pattern: "(?<=漢)" }, guidance: "x" }]);
r = run([S("regex-safety.mjs"), "--probe", "(?:漢|漢字?)+$", ""], { timeout: 4000 });
ok("時間を測る見本に漢字が入っている（(?:漢|漢字?)+$ が見本で止まらない）", !!(r.error || r.signal) || json(r.stdout).ms > 200, JSON.stringify({ s: r.signal, out: r.stdout }));
const { checkRegex } = await import(join(ROOT, "scripts/regex-safety.mjs"));
ok("同梱の台帳の正規表現は新しい検査も通る", ledger.patterns.filter((p) => p.detect?.pattern).every((p) => checkRegex(p.detect.pattern, p.detect.flags).length === 0), ledger.patterns.map((p) => p.detect?.pattern && `${p.id}:${checkRegex(p.detect.pattern, p.detect.flags)}`).filter(Boolean).join(" "));
const prhBad = tmp("jp-prhbad-");
write(prhBad, "team.yml", "version: 1\nrules:\n  - expected: 漢字\n    patterns:\n      - /(?:漢|漢字?)+$/\n");
writeFileSync(join(prhBad, ".ja-proofread.json"), JSON.stringify({ prh: ["team.yml"] }));
const prhBadRep = proofread(join(ROOT, "tests/fixtures/ai-like.md"), [], { cwd: prhBad });
ok("プロジェクトの prh 辞書に危ない正規表現があれば、警告して辞書を外す", prhBadRep.ok && (prhBadRep.warnings || []).some((w) => /team\.yml/.test(w) && /使えない正規表現/.test(w)) && idsOf(prhBadRep).has("prh"), JSON.stringify(prhBadRep.warnings) + prhBadRep.lintError);

const prhGood = tmp("jp-prhgood-");
write(prhGood, "team.yml", "version: 1\nrules:\n  - expected: 問い合わせ\n    patterns:\n      - \"/問合わ?せ/\"\n");
writeFileSync(join(prhGood, ".ja-proofread.json"), JSON.stringify({ prh: ["team.yml"] }));
const goodDoc = write(prhGood, "g.md", "# 窓口\n\n問合せは窓口で受けます。\n");
const goodRep1 = proofread(goodDoc, [], { cwd: prhGood });
const goodRep2 = proofread(goodDoc, [], { cwd: prhGood });
ok("安全な正規表現だけのプロジェクトの prh 辞書は使われる（2回目は記録を使う）", [goodRep1, goodRep2].every((x) => !(x.warnings || []).length && (x.files?.[0]?.findings || []).some((f) => f.ruleId === "prh" && /問い合わせ/.test(f.message))), JSON.stringify([goodRep1.warnings, goodRep1.files?.[0]?.findings?.map((f) => f.message)]));

// C. textlint が一度落ちても、次に動いたとき、もとからある指摘で止めない
const lfProj = tmp("jp-lintfail-");
writeFileSync(join(lfProj, ".ja-proofread.json"), JSON.stringify({ profile: "doc" }));
write(lfProj, "m.md", "# メモ\n\n出来ることを書きます。\n");
const lfData = tmp("jp-lfdata-");
if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(lfData, "deps"));
const lfFake = tmp("jp-lffake-");
write(lfFake, "deps/.stamp", readFileSync(join(fake, "deps/.stamp"), "utf8"));
write(lfFake, "deps/node_modules/textlint/bin/textlint.js", 'process.stderr.write("Error: boom\\n"); process.exit(2);\n');
const lfHook = (data) => json(run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(lfProj, "m.md") }, cwd: lfProj }), env: { CLAUDE_PROJECT_DIR: lfProj, JA_PROOFREAD_DATA: data } }).stdout);
const lf1 = lfHook(lfData);
ok("（準備）最初は must の指摘で止める", lf1.decision === "block", JSON.stringify(lf1).slice(0, 200));
// textlint が落ちる回は、同じ記録の場所で偽の textlint を使う
cpSync(join(lfData, "hook-last.json"), join(lfFake, "hook-last.json"));
const lf2 = lfHook(lfFake);
cpSync(join(lfFake, "hook-last.json"), join(lfData, "hook-last.json"));
const lf3 = lfHook(lfData);
ok("textlint が落ちた回のあとに動いても、前からある指摘では止めない", !lf2.decision && !lf3.decision && /prh/.test(lf3.hookSpecificOutput?.additionalContext || ""), JSON.stringify({ lf2: lf2.decision, lf3 }).slice(0, 300));

// D. 壊れた .ja-proofread.json は黙って無視しない
const brokenCfg = tmp("jp-broken-");
writeFileSync(join(brokenCfg, ".ja-proofread.json"), '{ "profile": "doc", }');
write(brokenCfg, "b.md", "# メモ\n\n出来ることを書きます。\n");
r = run([S("proofread.mjs"), join(brokenCfg, "b.md")], { cwd: brokenCfg });
ok("壊れた .ja-proofread.json では CLI が終了コード2で止まる", r.status === 2 && /JSON として読めません/.test(r.stderr), r.status + r.stderr);
const bh = json(run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(brokenCfg, "b.md") }, cwd: brokenCfg }), env: { CLAUDE_PROJECT_DIR: brokenCfg } }).stdout);
ok("壊れた .ja-proofread.json はフックが additionalContext で知らせる", /設定を読めない/.test(bh.hookSpecificOutput?.additionalContext || "") && !bh.decision, JSON.stringify(bh).slice(0, 200));

// E. 2回同梱してから --remove しても、settings.json.bak はフックの入っていない設定
const bakProj = tmp("jp-bak-");
mkdirSync(join(bakProj, ".claude"), { recursive: true });
writeFileSync(join(bakProj, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }));
run([S("install-into-project.mjs"), bakProj]);
run([S("install-into-project.mjs"), bakProj]);
const vsk = readFileSync(join(bakProj, ".claude/skills/ja-proofread-proofread/SKILL.md"), "utf8");
const vgl = readFileSync(join(bakProj, ".claude/skills/ja-proofread-grow-ledger/SKILL.md"), "utf8");
r = run([S("install-into-project.mjs"), bakProj, "--remove"]);
const bak = readFileSync(join(bakProj, ".claude/settings.json.bak"), "utf8");
ok("2回同梱して --remove しても .bak にフックが入らない", r.status === 0 && !bak.includes(".claude/ja-proofread/scripts/") && json(bak).permissions?.allow?.[0] === "Bash(ls)", bak.slice(0, 200));
ok("同梱したスキルは、サブエージェントを接頭辞なしで呼び、同梱版から install-into-project を動かす案内がない", !/ja-proofread:(structure-reviewer|fresh-eyes-reader)/.test(vsk) && /`structure-reviewer`/.test(vsk) && !vgl.includes("plugin-only") && !/CLAUDE_SKILL_DIR[^\n]*install-into-project/.test(vgl));

// F. P011 は熟語の一部に当たらない
const p11 = write(WORK, "p11.md", "# 現場\n\n地下の表示を確かめます。壇上の表彰式に出ます。机上の図面を広げます。川上の点検口を開けます。この上の表示を消します。\n\n結果は下の表にまとめます。\n");
const p11f = (proofread(p11).files?.[0]?.findings || []).filter((x) => x.ruleId === "P011");
ok("P011 が「地下の表示」「壇上の表彰式」「机上の図面」「川上の点検口」「上の表示」に当たらず、「下の表に」には当たる", p11f.length === 1 && p11f[0].line === 5, JSON.stringify(p11f.map((x) => `${x.line}:${x.message.slice(0, 40)}`)));

// 参考の指摘
const exProj = tmp("jp-exclude-");
writeFileSync(join(exProj, ".ja-proofread.json"), JSON.stringify({ exclude: ["drafts/**"] }));
write(exProj, "CLAUDE.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
write(exProj, "drafts/x.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
const exHook = (f) => run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(exProj, f) }, cwd: exProj }), env: { CLAUDE_PROJECT_DIR: exProj } }).stdout.trim();
ok("exclude を書いても既定の除外（CLAUDE.md）は残り、書いた除外も効く", exHook("CLAUDE.md") === "" && exHook("drafts/x.md") === "");
const noDepsData = tmp("jp-nodeps2-");
const ndOut = json(run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(lfProj, "m.md") }, cwd: lfProj }), env: { CLAUDE_PROJECT_DIR: lfProj, JA_PROOFREAD_DATA: noDepsData } }).stdout);
const ndText = ndOut.reason || ndOut.hookSpecificOutput?.additionalContext || "";
ok("依存がないときの注意はフックの結果に1回だけ出る", existsSync(join(ROOT, "node_modules", "textlint")) || (ndText.match(/依存がまだ入っていません|依存がまだ入っていない/g) || []).length === 1, ndText.slice(0, 400));
const vRepo = tmp("jp-vrepo-");
const vLedgerJs = makeRepo(vRepo);
const vLedgerPath = join(vRepo, "plugins/ja-proofread/data/ledger.json");
const vl = json(readFileSync(vLedgerPath, "utf8"));
vl.patterns[0].detect.threshold.minCount = 0;
vl.patterns[1].profiles = ["doc", "poster"];
vl.version = "9.9.9";
writeFileSync(vLedgerPath, JSON.stringify(vl));
r = run([vLedgerJs, "validate"]);
ok("validate が minCount 0、知らない profiles、plugin.json と違う台帳の版を拒否する", r.status === 1 && /minCount/.test(r.stderr) && /poster/.test(r.stderr) && /9\.9\.9/.test(r.stderr), r.stderr);
const { runStructureChecks: rsc } = await import(join(ROOT, "scripts/structure-check.mjs"));
const flagLedger = { patterns: [{ id: "P900", name: "t", status: "active", level: "should", guidance: "g", detect: { type: "structure", detector: "closing-lines", pattern: "KEY。$", flags: "i", threshold: { minCount: 2 } } }] };
const flagOut = rsc("# 一\n\n本文です。最後は key。\n\n# 二\n\n本文です。これも key。\n", flagLedger, "doc");
ok("closing-lines が flags を使う", flagOut.length === 2, JSON.stringify(flagOut));
// 版の確かめ：下げた版は通さない
const vb = tmp("jp-vbump-");
const g = (...a) => spawnSync("git", a, { cwd: vb, encoding: "utf8" });
g("init", "-q"); g("config", "user.email", "t@example.invalid"); g("config", "user.name", "t");
write(vb, "plugins/ja-proofread/.claude-plugin/plugin.json", JSON.stringify({ version: "0.2.0" }));
g("add", "-A"); g("commit", "-qm", "base"); g("branch", "base");
const bumpScript = resolve(ROOT, "..", "..", ".github/scripts/check-version-bump.sh");
const bumpTo = (v) => { write(vb, "plugins/ja-proofread/.claude-plugin/plugin.json", JSON.stringify({ version: v })); g("commit", "-qam", v); return spawnSync("bash", [bumpScript, "base"], { cwd: vb, encoding: "utf8" }); };
ok("check-version-bump.sh は版を下げると落ちる", bumpTo("0.1.9").status === 1);
ok("check-version-bump.sh は版を上げると通る", bumpTo("0.10.0").status === 0);

// 18. 0.1.3 で直した不具合の再現
const hasDeps = existsSync(join(OUTER_DATA, "deps", "node_modules", "prh"));
const prhProj = (yml, extra = {}) => {
  const d = tmp("jp-prh3-");
  for (const [name, body] of Object.entries({ "team.yml": yml, ...extra })) write(d, name, body);
  writeFileSync(join(d, ".ja-proofread.json"), JSON.stringify({ prh: ["team.yml"] }));
  return d;
};
const prhWarn = (rep) => (rep.warnings || []).join(" / ");
const prhMsgs = (rep) => (rep.files?.[0]?.findings || []).filter((f) => f.ruleId === "prh").map((f) => f.message);
if (!hasDeps) console.log("- （依存がないため、プロジェクトの prh 辞書の確認は飛ばしました）");
else {
  // 1. imports 先と、1行の配列の patterns も検査する。外すのは使えない規則だけ
  const impDir = prhProj("version: 1\nimports:\n  - ./sub.yml\nrules:\n  - expected: 正しい語甲\n    patterns:\n      - ただしいごこう\n", {
    "sub.yml": "version: 1\nrules:\n  - expected: 危ない語\n    patterns: [ \"/(?:あ+)+い/\" ]\n  - expected: 正しい語乙\n    patterns: [ \"/ただしいごおつ(?!ゑ)/\" ]\n",
  });
  const impDoc = write(impDir, "d.md", "# 語\n\nただしいごこうとただしいごおつを書きます。\n");
  const impRep = proofread(impDoc, [], { cwd: impDir, timeout: 60000 });
  ok("prh の imports 先にある危ない正規表現も見つけて、その規則だけを外す", /危ない語/.test(prhWarn(impRep)) && /その規則だけを外しました/.test(prhWarn(impRep)), prhWarn(impRep));
  ok("imports 先の使える規則と、元の辞書の規則は使われる", prhMsgs(impRep).some((m) => /正しい語甲/.test(m)) && prhMsgs(impRep).some((m) => /正しい語乙/.test(m)), JSON.stringify(prhMsgs(impRep)));
  const arrDir = prhProj("version: 1\nrules:\n  - expected: 危ない語\n    patterns: [ \"/(?:あ+)+い/\" ]   # 行末のコメント\n  - expected: 正しい語丙\n    pattern: ただしいごへい\n");
  const arrRep = proofread(write(arrDir, "d.md", "# 語\n\nただしいごへいを書きます。\n"), [], { cwd: arrDir, timeout: 60000 });
  ok("1行の配列 patterns: [ \"/(?:あ+)+い/\" ] も検査して外し、ほかの規則は使う", /危ない語/.test(prhWarn(arrRep)) && prhMsgs(arrRep).some((m) => /正しい語丙/.test(m)), prhWarn(arrRep) + JSON.stringify(prhMsgs(arrRep)));

  // 2. 831件の辞書：検査は全件を1つの子プロセスで測り、結果は正規表現ごとに残す。1件拒否しても毎回測り直さない
  const kana = "アイウエオカキクケコサシスセソタチツテトナニヌネノ";
  const big = ["version: 1", "rules:"];
  for (let i = 0; i < 831; i++) {
    const w = kana[i % 25] + kana[(i * 7) % 25] + kana[(i * 11) % 25] + i;
    if (i % 3 === 0) big.push(`  - expected: 正${i}`, "    patterns:", `      - /${w}(?![ァ-ヶー])/`);
    else if (i % 3 === 1) big.push(`  - expected: 正${i}`, `    patterns: [ "${w}", "/${w}ゑ?/" ]`);
    else big.push(`  - expected: 正${i}`, `    pattern: ${w}`);
  }
  big.push("  - expected: 遅い語", "    patterns:", "      - /-*-*-*[^-]/");
  const bigDir = prhProj(big.join("\n") + "\n");
  const bigData = tmp("jp-bigdata-");
  symlinkSync(join(OUTER_DATA, "deps"), join(bigData, "deps"));
  const bigDoc = write(bigDir, "d.md", "# 語\n\nアアア0 とイクシ1 を書きます。\n");
  const timeRun = () => { const t = Date.now(); const rep = proofread(bigDoc, [], { cwd: bigDir, env: { JA_PROOFREAD_DATA: bigData }, timeout: 120000 }); return { rep, ms: Date.now() - t }; };
  const b1 = timeRun(), b2 = timeRun();
  const bigOk = (x) => /遅い語/.test(prhWarn(x.rep)) && prhMsgs(x.rep).some((m) => /正0/.test(m)) && prhMsgs(x.rep).some((m) => /正1/.test(m));
  ok(`831件の辞書：1件だけ外して残りを使う（1回目 ${b1.ms}ms、2回目 ${b2.ms}ms）`, bigOk(b1) && bigOk(b2), prhWarn(b1.rep) + JSON.stringify(prhMsgs(b1.rep)));
  ok("831件の辞書の検査は1回目でも8秒以内、2回目は記録を使い5秒以内", b1.ms < 8000 && b2.ms < 5000, `${b1.ms} / ${b2.ms}`);
  const cacheFile = safe(() => json(readFileSync(join(bigData, "regex-checked.json"), "utf8")));
  ok("拒否した結果も正規表現ごとに記録する", !!cacheFile && Object.values(cacheFile).some((v) => Array.isArray(v) && v.some((e) => /秒以内|ms かかりました/.test(e))) && Object.keys(cacheFile).length >= 832, cacheFile && Object.keys(cacheFile).length);
}

// 3. コードの隠し方：二重バッククォート、4つのフェンスの中の ```、箇条書きの中のフェンス、4字下げのコード、閉じないフェンス
const codeCases = {
  "二重バッククォート": "作例は ``<!-- textlint-disable -->`` と書きます。\n",
  "4つのバッククォートのフェンス": "````markdown\n```\n<!-- textlint-disable -->\n```\n````\n",
  "箇条書きの中の字下げしたフェンス": "- 手順\n\n  ```\n  <!-- textlint-disable -->\n  ```\n",
  "4字下げのコードブロック": "例：\n\n    <!-- textlint-disable -->\n",
};
const { disabledRanges: dr2, maskCode: mc2, codeRanges: cr2 } = await import(join(ROOT, "scripts/structure-check.mjs"));
for (const [label, body] of Object.entries(codeCases)) {
  const doc = write(WORK, `code-${Object.keys(codeCases).indexOf(label)}.md`, `# 書き方\n\n${body}\n網羅的に調べました。\n`);
  const ids3 = idsOf(proofread(doc));
  ok(`${label}の中の textlint-disable で以降の指摘が消えない（依存ありの構文木）`, ids3.has("P008"), [...ids3].join(","));
  const text = readFileSync(doc, "utf8");
  ok(`${label}の中の textlint-disable を範囲にしない（依存なしの正規表現）`, safe(() => dr2(text).length === 0), safe(() => JSON.stringify(dr2(text))));
}
const unclosed = "# 書き方\n\n網羅的に調べました。\n\n```\n<!-- textlint-disable -->\n網羅的なコード\n";
ok("閉じないフェンスは文末までコードとして隠す（依存なし）", safe(() => dr2(unclosed).length === 0 && !mc2(unclosed).includes("網羅的なコード") && mc2(unclosed).includes("網羅的に調べました")), safe(() => JSON.stringify(mc2(unclosed))));
const posDoc = "a ``b`` c\n\n```\nx\n```\n\n    y\n";
ok("隠しても長さと改行の位置は変わらない", safe(() => mc2(posDoc).length === posDoc.length && [...mc2(posDoc)].every((ch, i) => (ch === "\n") === (posDoc[i] === "\n")) && cr2(posDoc).length === 3), safe(() => JSON.stringify(mc2(posDoc))));
ok("本物の textlint-disable は、フェンスやコードのあとでも範囲になる（依存なし）", safe(() => dr2("```\nx\n```\n\n`a`\n\n<!-- textlint-disable -->\nb\n").length === 1));

// 4. P002 は改行に当たらない。コードを空白にした長い文書でも速い
const { checkRegex: cr4, checkRegexes: crs4 } = await import(join(ROOT, "scripts/regex-safety.mjs"));
ok("古い P002（^\\s*…、m）は、空白と改行の混ざった見本で拒否される", safe(() => cr4("^\\s*(?:[-*+]\\s+|\\d+[.)]\\s+)?(?:\\*\\*)?[^\\s:：*]{1,12}(?:\\*\\*)?[：:](?!//)", "m").length > 0));
const p2 = ledger.patterns.find((p) => p.id === "P002");
ok("新しい P002 は改行に当たらない形（^[ \\t]*）で、検査を通る", safe(() => p2.detect.pattern.startsWith("^[ \\t]*") && cr4(p2.detect.pattern, p2.detect.flags).length === 0), p2.detect.pattern);
const codeHeavy = "# 大きな文書\n\n" + ("説明の文です。\n\n```js\n" + "    const value = compute(alpha, beta);\n".repeat(30) + "```\n\n").repeat(400);
t0 = Date.now();
runStructureChecks(codeHeavy, ledger, "doc");
const chMs = Date.now() - t0;
ok(`コードの多い約${Math.round(codeHeavy.length / 1024)}KB の文書でも構成チェックが3秒以内（${chMs}ms）`, chMs < 3000);
const chDoc = write(WORK, "code-heavy.md", codeHeavy);
t0 = Date.now();
const chRep = proofread(chDoc, [], { timeout: 120000 });
ok(`同じ文書の校正全体が60秒以内（${Date.now() - t0}ms）`, Date.now() - t0 < 60000 && chRep.files?.length === 1, chRep.lintError);

// 5. .ja-proofread.json の型
const typeCases = [
  [{ include: "**/*.md" }, /include は文字列の配列/],
  [{ exclude: [1] }, /exclude は文字列の配列/],
  [{ disable: "P001" }, /disable は文字列の配列/],
  [{ prh: "team.yml" }, /prh は文字列の配列/],
  [{ profiles: ["slide"] }, /profiles はオブジェクト/],
  [{ hook: true }, /hook はオブジェクト/],
  [{ hook: { blockOn: "sometimes" } }, /hook\.blockOn は/],
  [{ hook: { enabled: "yes" } }, /hook\.enabled は真偽値/],
];
for (const [conf, re] of typeCases) {
  const d = tmp("jp-type-");
  writeFileSync(join(d, ".ja-proofread.json"), JSON.stringify(conf));
  write(d, "b.md", "# メモ\n\n出来ることを書きます。\n");
  const cli = run([S("proofread.mjs"), join(d, "b.md")], { cwd: d });
  const hk = json(run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(d, "b.md") }, cwd: d }), env: { CLAUDE_PROJECT_DIR: d } }).stdout);
  ok(`.ja-proofread.json ${JSON.stringify(conf)} は CLI が止まり、フックが知らせる`, cli.status === 2 && re.test(cli.stderr) && re.test(hk.hookSpecificOutput?.additionalContext || ""), cli.stderr + JSON.stringify(hk));
}
const badIn = run([S("hook-post-edit.mjs")], { input: "これは JSON ではない" });
ok("フックの中で思わぬ失敗があっても additionalContext で知らせる", /校正していません/.test(json(badIn.stdout).hookSpecificOutput?.additionalContext || "") && badIn.status === 0, badIn.stdout + badIn.stderr);

// 6. 繰り返すグループの中の選択：重ならない1文字の選択は通し、重なるものは拒否する
const altRes = safe(() => crs4([
  { source: "(?:、|,)+", flags: "" }, { source: "(?:の|が){2,}", flags: "" }, { source: "(?:\\s|\\u2028)+x", flags: "" }, { source: "(?:[a-z]|\\d)+", flags: "" },
  { source: "(?:[一-龯]|[一-龯])+", flags: "" }, { source: "(?:\\s|　)+$", flags: "" }, { source: "(?:a|A)+b", flags: "i" }, { source: "(?:、|,|、、)+", flags: "" },
])) || [];
ok("(?:、|,)+、(?:の|が){2,}、(?:[a-z]|\\d)+ は通る", safe(() => altRes[0].length === 0 && altRes[1].length === 0 && altRes[3].length === 0), JSON.stringify(altRes.slice(0, 4)));
ok("重なる選択（[一-龯]|[一-龯]、\\s|全角空白、i での a|A、2文字の選択肢）は拒否する", altRes.length === 8 && altRes.slice(2, 3).concat(altRes.slice(4)).every((x) => x.length > 0), JSON.stringify(altRes));

// 7. ASCII の記号と、正規表現に出てくる文字の長い繰り返し
const symRes = safe(() => [["-*-*-*[^-]", ""], ["=*=*=*[^=]", ""], ["ゑ*ゑ*ゑ*[^ゑ]", ""], ["[ゐゑ]*[ゐゑ]*[ゐゑ]*x", ""]].map(([p, f]) => cr4(p, f))) || [];
ok("-*-*-*[^-] などの ASCII 記号と、正規表現に出てくる文字（ゑ、[ゐゑ]）の繰り返しで遅いものを拒否する", symRes.length === 4 && symRes.every((x) => x.length > 0), JSON.stringify(symRes));

// 8. 壊れた hook-last.json
for (const broken of ["null", '{"x":null,"y":{"sigs":null},"z":[1]}', "[]", '{"a":{"sigs":[1,2]}}']) {
  const d = tmp("jp-last-");
  writeFileSync(join(d, ".ja-proofread.json"), JSON.stringify({ profile: "doc" }));
  write(d, "m.md", "# メモ\n\n網羅的に書きます。\n");
  const data = tmp("jp-lastdata-");
  if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(data, "deps"));
  writeFileSync(join(data, "hook-last.json"), broken);
  const hr = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(d, "m.md") }, cwd: d }), env: { CLAUDE_PROJECT_DIR: d, JA_PROOFREAD_DATA: data } });
  const after = safe(() => json(readFileSync(join(data, "hook-last.json"), "utf8")));
  ok(`hook-last.json が ${broken} でもフックが動き、作り直す`, /P008/.test(json(hr.stdout).hookSpecificOutput?.additionalContext || "") && after && typeof after === "object" && Object.values(after).every((v) => Array.isArray(v?.sigs)), hr.stdout.slice(0, 200) + hr.stderr.slice(0, 200));
}

// 9. --remove は同梱したものだけを消す
const rmProj = tmp("jp-rm-");
r = run([S("install-into-project.mjs"), rmProj, "--remove"]);
ok("同梱したことのないプロジェクトでは --remove は何もしない", r.status === 0 && !existsSync(join(rmProj, ".claude")), r.stdout + r.stderr);
r = run([S("install-into-project.mjs"), rmProj]);
write(rmProj, ".claude/skills/ja-proofread-mine/SKILL.md", "---\nname: ja-proofread-mine\n---\n自分のスキル\n");
r = run([S("install-into-project.mjs"), rmProj]);
ok("同梱をやり直しても、利用者の ja-proofread-mine は消えない", existsSync(join(rmProj, ".claude/skills/ja-proofread-mine/SKILL.md")), r.stderr);
r = run([S("install-into-project.mjs"), rmProj, "--remove"]);
ok("--remove は利用者の ja-proofread-mine を残し、同梱したスキルとサブエージェントを消す", r.status === 0 && existsSync(join(rmProj, ".claude/skills/ja-proofread-mine/SKILL.md")) && !existsSync(join(rmProj, ".claude/skills/ja-proofread-proofread")) && !existsSync(join(rmProj, ".claude/agents")), r.stderr);
ok("同梱で作った {} だけの settings.json と空の agents/ は消える", !existsSync(join(rmProj, ".claude/settings.json")) && !existsSync(join(rmProj, ".claude/settings.json.bak")), safe(() => readFileSync(join(rmProj, ".claude/settings.json"), "utf8")));
const rmProj2 = tmp("jp-rm2-");
run([S("install-into-project.mjs"), rmProj2]);
r = run([S("install-into-project.mjs"), rmProj2, "--remove"]);
ok("何もなかったプロジェクトに同梱して --remove すると .claude ごと消える", r.status === 0 && !existsSync(join(rmProj2, ".claude")), r.stdout + r.stderr);

// 10. flags の gg、marketplace.json の version
ok("flags の gg を拒否する", safe(() => cr4("あ", "gg").length > 0 && cr4("あ", "g").length === 0));
const mRepo = tmp("jp-mrepo-");
const mLedgerJs = makeRepo(mRepo);
const mVersion = json(readFileSync(join(mRepo, "plugins/ja-proofread/.claude-plugin/plugin.json"), "utf8")).version;
writeFileSync(join(mRepo, ".claude-plugin/marketplace.json"), JSON.stringify({ name: "x", plugins: [{ name: "ja-proofread", source: "./plugins/ja-proofread", version: mVersion }] }));
r = run([mLedgerJs, "validate"]);
ok("validate は marketplace.json の version を、plugin.json と同じ版でも拒否する（版は plugin.json だけに書く）", r.status === 1 && /marketplace\.json/.test(r.stderr), r.stderr);
const realMarket = json(readFileSync(resolve(ROOT, "..", "..", ".claude-plugin/marketplace.json"), "utf8"));
ok("このリポジトリの marketplace.json に version がない", !realMarket.plugins?.some((p) => p.version !== undefined));

console.log(failed ? `\n${passed + failed} 項目中 ${failed} 件失敗` : `\n${passed} 項目すべて成功`);
process.exit(failed ? 1 : 0);
