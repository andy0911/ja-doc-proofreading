// 動作確認。node tests/run.mjs （依存は先に scripts/ensure-deps.mjs で入れる）
// 利用者の記録を汚さないよう、データ置き場は一時ディレクトリにする（依存だけは入れたものをリンクして使う）
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync, mkdirSync, symlinkSync, statSync, rmSync, readdirSync, lstatSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const S = (f) => join(ROOT, "scripts", f);
let failed = 0, passed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${name}${cond ? "" : "  " + String(detail).slice(0, 400)}`);
  if (cond) passed++; else failed++;
};
// 作った一時ディレクトリは覚えておき、終わりに消す（中の deps はリンクなので、リンクだけが消える）
const made = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); made.push(d); return d; };
const cleanup = () => { for (const d of made.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* 消せなくても続ける */ } } };
process.on("exit", cleanup);
// 条件を調べる途中で例外が出ても、テスト全体を止めずに ✗ として数える
const safe = (f) => { try { return f(); } catch (e) { return false; } };

const OUTER_DATA = process.env.JA_PROOFREAD_DATA || process.env.CLAUDE_PLUGIN_DATA || join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ja-proofread");
const DATA = tmp("jp-data-");
if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(DATA, "deps"));
// 子プロセスの一時ディレクトリ（runTextlint が作る ja-proofread-*）は、このテストだけの場所に作らせる。
// /tmp を見ると、同じ計算機で動くほかのプロセス（ほかのテストやフック）が作ったものまで数えてしまうため
const CHILD_TMP = tmp("jp-childtmp-");
const BASE_ENV = { ...process.env, JA_PROOFREAD_DATA: DATA, TMPDIR: CHILD_TMP };
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

// 19. 0.1.4 で直した不具合の再現
const SLOW_SPEC = `  - expected: b\n    pattern: /(a+)+b/\n    specs:\n      - from: ${"a".repeat(40)}!\n        to: ${"a".repeat(40)}!\n`;
if (!hasDeps) console.log("- （依存がないため、prh の specs と時間の上限の確認は飛ばしました）");
else {
  // 7・9. specs で止まる辞書は、子プロセスで読んで時間で打ち切り、辞書ごと外す。上限は2つの辞書で1つを分け合う
  const specDir = tmp("jp-spec-");
  write(specDir, "team.yml", "version: 1\nrules:\n" + SLOW_SPEC);
  write(specDir, "team2.yml", "version: 1\nrules:\n" + SLOW_SPEC.replace("expected: b", "expected: c"));
  write(specDir, "good.yml", "version: 1\nrules:\n  - expected: 問い合わせ\n    pattern: 問合せ\n");
  writeFileSync(join(specDir, ".ja-proofread.json"), JSON.stringify({ prh: ["good.yml", "team.yml", "team2.yml"] }));
  write(specDir, "d.md", "# 窓口\n\n問合せは窓口で受けます。\n");
  t0 = Date.now();
  r = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(specDir, "d.md") }, cwd: specDir }), env: { CLAUDE_PROJECT_DIR: specDir, JA_PROOFREAD_PRH_BUDGET_MS: "3000" }, timeout: 30000 });
  const specMs = Date.now() - t0;
  const specOut = json(r.stdout).hookSpecificOutput?.additionalContext || json(r.stdout).reason || "";
  ok(`specs で止まる prh 辞書があってもフックが戻り、その辞書だけを外す（${specMs}ms）`, !r.error && /team\.yml を時間内に読み終えなかった/.test(specOut) && /team2\.yml を時間内に読み終えなかった/.test(specOut), (r.error?.message || "") + specOut.slice(0, 400));
  ok("2つの辞書が止まっても、上限（3秒）は辞書ごとではなく1つを分け合う（12秒以内に戻る）", !r.error && specMs < 12000, specMs);
  ok("止まる辞書を外しても、ほかの辞書の規則は使う", /問い合わせ/.test(specOut), specOut.slice(0, 300));

  // 10. フックから呼ぶ textlint は締め切りまでに打ち切る
  const hangData = tmp("jp-hang-");
  write(hangData, "deps/.stamp", readFileSync(join(fake, "deps/.stamp"), "utf8"));
  write(hangData, "deps/node_modules/textlint/bin/textlint.js", "setInterval(() => {}, 1000);\n");
  const hangScript = write(tmp("jp-hangjs-"), "t.mjs", `import { runTextlint, loadProjectConfig } from ${JSON.stringify(S("lib.mjs"))};\nconst t = performance.now();\nconst r = runTextlint([${JSON.stringify(join(ROOT, "tests/fixtures/plain.md"))}], "doc", loadProjectConfig(), { deadline: performance.now() + 2000 });\nconsole.log(JSON.stringify({ ms: Math.round(performance.now() - t), ok: r.ok, e: r.lintError }));\n`);
  r = run([hangScript], { env: { JA_PROOFREAD_DATA: hangData }, timeout: 30000 });
  const hang = json(r.stdout);
  ok(`締め切りを渡すと、止まった textlint を打ち切って lintError を返す（${hang.ms}ms）`, !r.error && hang.ok === false && /時間内/.test(hang.e || "") && hang.ms < 8000, (r.error?.message || "") + r.stdout + r.stderr.slice(0, 200));
  const hookSrc = readFileSync(S("hook-post-edit.mjs"), "utf8");
  const hooksJson = json(readFileSync(join(ROOT, "hooks/hooks.json"), "utf8"));
  const hookTimeout = hooksJson.hooks.PostToolUse[0].hooks[0].timeout;
  ok("フックは締め切りを proofreadFiles に渡し、HOOK_TIMEOUT_MS は hooks.json と同梱の timeout と同じ", /proofreadFiles\(\[abs\], \{ cfg, deadline \}\)/.test(hookSrc) && new RegExp(`HOOK_TIMEOUT_MS = ${hookTimeout * 1000};`).test(hookSrc) && readFileSync(S("install-into-project.mjs"), "utf8").includes(`cmd("hook-post-edit.mjs"), timeout: ${hookTimeout} }`), hookTimeout);
}

// 8. 繰り返さないグループの選択は、重ならないかを当てて確かめない。u でも BMP の外に当たらない選択肢なら BMP だけを当てる
const rs8 = await import(join(ROOT, "scripts/regex-safety.mjs"));
t0 = Date.now();
for (let i = 0; i < 60; i++) rs8.shapeProblem(`(?:${String.fromCharCode(0x7000 + i * 2)}|${String.fromCharCode(0x7001 + i * 2)})x`, "mu");
const unrepMs = Date.now() - t0;
t0 = Date.now();
for (let i = 0; i < 20; i++) rs8.shapeProblem(`(?:${String.fromCharCode(0x7100 + i * 2)}|${String.fromCharCode(0x7101 + i * 2)})+x`, "mu");
const bmpMs = Date.now() - t0;
ok(`繰り返さないグループの選択60件の形の検査が200ms以内（${unrepMs}ms）、u つきで繰り返す選択20件が600ms以内（${bmpMs}ms）`, unrepMs < 200 && bmpMs < 600);
const shapes8 = safe(() => [
  ["(?:(?:、|,)x)+", ""], ["(?:(?:[一-龯]|[一-龯])x)+", ""], ["(?:\\u{1F600}|\\uD83D\\uDE00)+", "u"], ["(?:\\S|😀)+", "u"], ["(?:😀|😁)+", "u"], ["(?:[^a]|😀)+", "u"], ["(?:(?:a|aa))+", ""], ["(?:a|b)(?:c|cc)", ""],
].map(([p, f]) => rs8.shapeProblem(p, f))) || [];
ok("中の選択は、外のグループが繰り返すときに確かめる（重なるものは拒否、BMP の外の文字に当たり得るものは全体を当てる）", JSON.stringify(shapes8) === JSON.stringify([null, "alternation", "alternation", "alternation", null, "alternation", "alternation", null]), JSON.stringify(shapes8));
// 形の検査の時間も締め切りに入れる
const { checkRegexesCached } = await import(join(ROOT, "scripts/lib.mjs"));
const slowShapes = Array.from({ length: 60 }, (_, i) => ({ source: `(?:\\p{Script=Han}|${String.fromCharCode(0x3041 + i)})+`, flags: "u" }));
// この中で記録を書くので、データ置き場は一時ディレクトリにする（利用者の記録を汚さない）
const outerEnvData = process.env.JA_PROOFREAD_DATA;
process.env.JA_PROOFREAD_DATA = tmp("jp-budget-");
t0 = Date.now();
const budgetRes = safe(() => checkRegexesCached(slowShapes, { budgetMs: 300 })) || [];
const budgetMs8 = Date.now() - t0;
if (outerEnvData === undefined) delete process.env.JA_PROOFREAD_DATA; else process.env.JA_PROOFREAD_DATA = outerEnvData;
ok(`形の検査も締め切りに入れ、300ms の上限なら2秒以内に戻り、残りは未確認（null）にする（${budgetMs8}ms）`, budgetMs8 < 2000 && budgetRes.length === 60 && budgetRes.some((x) => x === null), budgetMs8 + " " + JSON.stringify(budgetRes.slice(-2)));
if (hasDeps) {
  const altLines = ["version: 1", "rules:"];
  for (let i = 0; i < 400; i++) altLines.push(`  - expected: 正${i}`, "    patterns:", `      - /(?:${String.fromCharCode(0x4e00 + i * 2)}|${String.fromCharCode(0x4e01 + i * 2)})ウエ${i}/`);
  const altDir = prhProj(altLines.join("\n") + "\n");
  const altData = tmp("jp-altdata-");
  symlinkSync(join(OUTER_DATA, "deps"), join(altData, "deps"));
  const altDoc = write(altDir, "d.md", "# 語\n\n丁ウエ0を書きます。\n");
  t0 = Date.now();
  const altRep = proofread(altDoc, [], { cwd: altDir, env: { JA_PROOFREAD_DATA: altData }, timeout: 120000 });
  const altMs = Date.now() - t0;
  ok(`選択肢つきの規則400件の辞書の初回が6秒以内で、規則が使われる（${altMs}ms）`, altMs < 6000 && !(altRep.warnings || []).length && prhMsgs(altRep).some((m) => /正0/.test(m)), altMs + JSON.stringify(altRep.warnings));
}

// 11. 子プロセスが一時的に失敗した「時間を測れませんでした」は記録に残さず、次に測り直す
const crashMod = write(tmp("jp-crashmod-"), "crash.mjs", 'if (process.argv.includes("--probe-batch")) process.exit(3);\n');
const tData = tmp("jp-transient-");
const tScript = write(tmp("jp-transjs-"), "t.mjs", `import { checkRegexesCached } from ${JSON.stringify(S("lib.mjs"))};\nconsole.log(JSON.stringify(checkRegexesCached([{ source: "ただしいご(?:こう|おつ)ゑ", flags: "u" }])));\n`);
const tRun = (env = {}) => json(run([tScript], { env: { JA_PROOFREAD_DATA: tData, ...env } }).stdout);
const t1 = tRun({ NODE_OPTIONS: `--import=${pathToFileURL(crashMod).href}` });
const tCache = safe(() => json(readFileSync(join(tData, "regex-checked.json"), "utf8"))) || {};
const t2 = tRun();
ok("測る子プロセスが止まったときは拒否するが、記録には残さない", Array.isArray(t1?.[0]) && /時間を測れませんでした/.test(t1[0][0] || "") && !Object.values(tCache).some((v) => Array.isArray(v) && v.some((e) => /時間を測れませんでした/.test(e))), JSON.stringify({ t1, tCache }));
ok("次の校正では測り直して通す", Array.isArray(t2?.[0]) && t2[0].length === 0, JSON.stringify(t2));

// 参考. 記録を使ったものは新しい扱いにし、古いものから捨てるときに残す
const lruData = tmp("jp-lru-");
const lruScript = write(tmp("jp-lrujs-"), "t.mjs", `import { checkRegexesCached } from ${JSON.stringify(S("lib.mjs"))};\nimport { regexKey } from ${JSON.stringify(S("regex-safety.mjs"))};\nimport { writeFileSync, readFileSync } from "node:fs";\nimport { join } from "node:path";\nconst p = join(process.env.JA_PROOFREAD_DATA, "regex-checked.json");\nconst keep = regexKey("よくつかうご", "u");\nconst data = { [keep]: [] };\nfor (let i = 1; i < 20000; i++) data["k" + i] = [];\nwriteFileSync(p, JSON.stringify(data));\ncheckRegexesCached([{ source: "よくつかうご", flags: "u" }, { source: "あたらしいご", flags: "u" }]);\nconst after = JSON.parse(readFileSync(p, "utf8"));\nconsole.log(JSON.stringify({ kept: keep in after, n: Object.keys(after).length }));\n`);
const lru = json(run([lruScript], { env: { JA_PROOFREAD_DATA: lruData }, timeout: 60000 }).stdout);
ok("記録が上限を超えて古いものを捨てるとき、今回使ったものは残す", lru.kept === true && lru.n === 20000, JSON.stringify(lru));

// 13. hook-last.json は一時ファイルに書いてから置き換える（リンクの先を書き換えない、書きかけを残さない）
const atomProj = tmp("jp-atom-");
writeFileSync(join(atomProj, ".ja-proofread.json"), JSON.stringify({ profile: "doc" }));
write(atomProj, "m.md", "# メモ\n\n網羅的に書きます。\n");
const atomData = tmp("jp-atomdata-");
if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(atomData, "deps"));
const atomVictim = write(tmp("jp-atomvictim-"), "keep.json", "KEEP");
symlinkSync(atomVictim, join(atomData, "hook-last.json"));
r = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(atomProj, "m.md") }, cwd: atomProj }), env: { CLAUDE_PROJECT_DIR: atomProj, JA_PROOFREAD_DATA: atomData } });
ok("hook-last.json は置き換えて書く（リンク先は変えず、一時ファイルを残さない）", readFileSync(atomVictim, "utf8") === "KEEP" && !lstatSync(join(atomData, "hook-last.json")).isSymbolicLink() && Object.values(json(readFileSync(join(atomData, "hook-last.json"), "utf8"))).length === 1 && !readdirSync(atomData).some((f) => f.includes(".tmp-")), readFileSync(atomVictim, "utf8").slice(0, 100) + r.stderr.slice(0, 200));

// 4. update の detect は丸ごと置き換わる。flags の m を落として ^ を使う正規表現は止め、ほかに消えた項目は知らせる
const p2now = ledger.patterns.find((p) => p.id === "P002").detect;
unchanged("update で P002 の flags の m を落とすと止まる", [{ action: "update", id: "P002", detect: { type: "regex-count", pattern: p2now.pattern, threshold: { minCount: 10, per1000: 4 } } }]);
const uRepo = tmp("jp-urepo-");
const uLedgerJs = makeRepo(uRepo);
writeFileSync(appr, JSON.stringify([{ action: "update", id: "P002", detect: { type: "regex-count", pattern: p2now.pattern, flags: "m", threshold: { minCount: 10 } } }]));
r = run([uLedgerJs, "apply", appr]);
const uP2 = safe(() => json(readFileSync(join(uRepo, "plugins/ja-proofread/data/ledger.json"), "utf8")).patterns.find((p) => p.id === "P002").detect);
ok("flags を書いた update は通り、書き忘れた threshold.per1000 は「注意：」で知らせる", r.status === 0 && uP2?.flags === "m" && uP2?.threshold?.minCount === 10 && /注意：.*threshold\.per1000/.test(r.stdout), r.stdout + r.stderr);
const glSkill = readFileSync(join(ROOT, "skills/grow-ledger/SKILL.md"), "utf8");
ok("grow-ledger の update の例に flags と per1000 があり、丸ごと置き換わると書いてある", /"action": "update", "id": "P002", "detect": \{[^}]*"flags": "m"[^}]*"per1000": 4/.test(glSkill) && /丸ごと置き換わります/.test(glSkill));

// 参考. targets を使う辞書：警告は「辞書ごと」の1つだけ。targets の file は長さ0で一致してもよい
if (hasDeps) {
  const tgBad = prhProj("version: 1\ntargets:\n  - file: /\\.md$/\nrules:\n  - expected: 危ない語\n    pattern: /(?:あ+)+い/\n  - expected: 正しい語\n    pattern: ただしいご\n");
  const tgBadRep = proofread(write(tgBad, "d.md", "# 語\n\nただしいごを書きます。\n"), [], { cwd: tgBad, timeout: 60000 });
  const tgw = tgBadRep.warnings || [];
  ok("targets を使う辞書で規則が外れるときの警告は「辞書ごと外しました」の1つだけ", tgw.length === 1 && /辞書ごと外しました/.test(tgw[0]) && !tgw.some((w) => /その規則だけ/.test(w)), JSON.stringify(tgw));
  const tgEmpty = prhProj("version: 1\ntargets:\n  - file: /.*/\nrules:\n  - expected: 正しい語\n    pattern: ただしいご\n");
  const tgEmptyRep = proofread(write(tgEmpty, "d.md", "# 語\n\nただしいごを書きます。\n"), [], { cwd: tgEmpty, timeout: 60000 });
  ok("targets の file: /.*/（長さ0で一致し得る）は拒否せず、辞書を使う", !(tgEmptyRep.warnings || []).length && prhMsgs(tgEmptyRep).some((m) => /正しい語/.test(m)), JSON.stringify(tgEmptyRep.warnings) + JSON.stringify(prhMsgs(tgEmptyRep)));
}

// 20. 0.1.5 で直した不具合の再現
// 1. 記録を引くたびに記録の数を数え直さない（規則数×記録数に比例して遅くならない）
const linData = tmp("jp-lin-");
const linScript = write(tmp("jp-linjs-"), "t.mjs", `import { checkRegexesCached } from ${JSON.stringify(S("lib.mjs"))};\nimport { regexKey } from ${JSON.stringify(S("regex-safety.mjs"))};\nimport { writeFileSync } from "node:fs";\nimport { join } from "node:path";\nconst p = join(process.env.JA_PROOFREAD_DATA, "regex-checked.json");\nconst list = Array.from({ length: 10000 }, (_, i) => ({ source: "きろくのご" + i, flags: "u" }));\nconst data = {};\nfor (const x of list) data[regexKey(x.source, x.flags)] = [];\nfor (let i = list.length; i < 20000; i++) data["k" + i] = [];\nwriteFileSync(p, JSON.stringify(data));\nconst t = performance.now();\nconst out = checkRegexesCached(list, { budgetMs: 600000 });\nconsole.log(JSON.stringify({ ms: Math.round(performance.now() - t), ok: out.every((x) => Array.isArray(x) && x.length === 0) }));\n`);
const lin = json(run([linScript], { env: { JA_PROOFREAD_DATA: linData }, timeout: 120000 }).stdout);
ok(`記録2万件から規則1万件を引いても3秒以内（${lin.ms}ms。0.1.4 では約28秒）`, lin.ok === true && lin.ms < 3000, JSON.stringify(lin));
ok("regexCache は記録の数を最初に1回だけ数え、get では数え直さない", /let size = Object\.keys\(data\)\.length;/.test(readFileSync(S("lib.mjs"), "utf8")) && !/get\(k\) \{[^}]*Object\.keys\(data\)\.length/.test(readFileSync(S("lib.mjs"), "utf8")));

// 2. update で detect の pattern を書き忘れると止める。closing-lines には pattern が要る
{
  const s0 = snapshot();
  const res = applyItems([{ action: "update", id: "P005", detect: { type: "structure", detector: "closing-lines", threshold: { minCount: 2 } } }]);
  ok("update で P005 の pattern を書き忘れると止まり、ファイルは変わらない", res.status === 1 && snapshot() === s0 && /P005 の detect は丸ごと置き換わるため、今の pattern が無くなります/.test(res.stderr), res.stdout + res.stderr);
  const vRepo = tmp("jp-vrepo-");
  const vLedgerJs = makeRepo(vRepo);
  const vPath = join(vRepo, "plugins/ja-proofread/data/ledger.json");
  const vLedger = json(readFileSync(vPath, "utf8"));
  delete vLedger.patterns.find((p) => p.id === "P005").detect.pattern;
  writeFileSync(vPath, JSON.stringify(vLedger));
  r = run([vLedgerJs, "validate"]);
  ok("validate は pattern の無い closing-lines を拒否する", r.status === 1 && /P005.*closing-lines には pattern/.test(r.stderr), r.stderr);
}

// 3-1. 時間の上限の環境変数が Infinity や負の数、数でないものなら既定値にする
const budgetOf = (v) => run(["--input-type=module", "-e", `import { PRH_BUDGET_MS } from ${JSON.stringify(pathToFileURL(S("lib.mjs")).href)}; console.log(PRH_BUDGET_MS);`], { env: { JA_PROOFREAD_PRH_BUDGET_MS: v } }).stdout.trim();
const budgets = ["Infinity", "-5", "abc", "1e400", "0", "5000", "500"].map(budgetOf);
ok("JA_PROOFREAD_PRH_BUDGET_MS は有限の正の数だけを使い、下限は1000（Infinity・-5・abc・1e400・0 は既定の20000、5000 は 5000、500 は 1000）", JSON.stringify(budgets) === JSON.stringify(["20000", "20000", "20000", "20000", "20000", "5000", "1000"]), JSON.stringify(budgets));
if (hasDeps) {
  const infDir = prhProj("version: 1\nrules:\n  - expected: 問い合わせ\n    pattern: 問合せ\n");
  const infRun = run([S("proofread.mjs"), "--json", write(infDir, "d.md", "# 窓口\n\n問合せは窓口で受けます。\n")], { cwd: infDir, env: { JA_PROOFREAD_PRH_BUDGET_MS: "Infinity" }, timeout: 60000 });
  const infRep = json(infRun.stdout);
  ok("JA_PROOFREAD_PRH_BUDGET_MS=Infinity でも校正が落ちず、プロジェクトの辞書を使う", infRun.status !== null && infRep.ok === true && prhMsgs(infRep).some((m) => /問い合わせ/.test(m)), infRun.stderr.slice(0, 300) + JSON.stringify(infRep.warnings));
}

// 3-2. 締め切りは performance.now() で測る（Date.now() が巻き戻っても延びない）
const backScript = write(tmp("jp-backjs-"), "t.mjs", `let t = 4e12;\nDate.now = () => (t -= 1000);\nconst { checkRegexesCached } = await import(${JSON.stringify(pathToFileURL(S("lib.mjs")).href)});\nconst list = ${JSON.stringify(slowShapes)};\nconst t0 = performance.now();\nconst out = checkRegexesCached(list, { budgetMs: 300 });\nconsole.log(JSON.stringify({ ms: Math.round(performance.now() - t0), pending: out.filter((x) => x === null).length }));\n`);
const back = json(run([backScript], { env: { JA_PROOFREAD_DATA: tmp("jp-back-") }, timeout: 120000 }).stdout);
ok(`Date.now() が巻き戻っても、300ms の上限なら2秒以内に戻り、残りは未確認にする（${back.ms}ms）`, back.ms < 2000 && back.pending > 0, JSON.stringify(back));
ok("締め切りの計算に Date.now() を使わない（lib.mjs・regex-safety.mjs・hook-post-edit.mjs の締め切り）", !/Date\.now\(\)/.test(readFileSync(S("lib.mjs"), "utf8") + readFileSync(S("regex-safety.mjs"), "utf8")) && /const deadline = HOOK_TIMEOUT_MS - HOOK_MARGIN_MS;/.test(readFileSync(S("hook-post-edit.mjs"), "utf8")));

// 3-3. 深い入れ子は再帰で止まらず、その規則だけを拒否する
const deep = "(".repeat(5000) + "ふかいご" + ")".repeat(5000);
const deepRes = safe(() => rs8.checkShape(deep, "u"));
const deepMin = (() => { try { rs8.minLength(deep); return "no throw"; } catch (e) { return e instanceof RangeError && /200 段/.test(e.message) ? "limit" : e.message; } })();
ok("5000段の入れ子は例外を出さずに「安全と確かめられない」として拒否し、minLength も深さの上限で止まる", Array.isArray(deepRes) && deepRes.length === 1 && /入れ子が 200 段を超え/.test(deepRes[0]) && deepMin === "limit", JSON.stringify(deepRes) + deepMin);
ok("200段までの入れ子は形の検査を通す", safe(() => rs8.checkShape("(".repeat(200) + "ふかいご" + ")".repeat(200), "u").length === 0));
if (hasDeps) {
  const deepDir = prhProj(`version: 1\nrules:\n  - expected: 深い語\n    pattern: /${deep}/\n  - expected: 問い合わせ\n    pattern: 問合せ\n`);
  const deepRun = run([S("proofread.mjs"), "--json", write(deepDir, "d.md", "# 窓口\n\n問合せは窓口で受けます。\n")], { cwd: deepDir, timeout: 60000 });
  const deepRep = json(deepRun.stdout);
  ok("5000段の入れ子の prh 規則があっても校正全体は止まらず、その規則だけを外す", deepRep.ok === true && /1件の規則に使えない正規表現/.test(prhWarn(deepRep)) && /入れ子/.test(prhWarn(deepRep)) && prhMsgs(deepRep).some((m) => /問い合わせ/.test(m)), deepRun.stderr.slice(0, 300) + prhWarn(deepRep));
}

// 3-4. 選択肢のとても多い繰り返しも、形の検査の途中で締め切りを見る（0.1.6 からは、締め切りの前に確かめ終える）
const manyAlt = "(?:" + Array.from({ length: 1500 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("|") + "|\\p{Script=Greek})+";
const altData = tmp("jp-manyalt-");
process.env.JA_PROOFREAD_DATA = altData;
t0 = performance.now();
const manyRes = safe(() => checkRegexesCached([{ source: manyAlt, flags: "u" }, { source: "むがいなご", flags: "u" }], { budgetMs: 20000 })) || [];
const manyMs = Math.round(performance.now() - t0);
if (outerEnvData === undefined) delete process.env.JA_PROOFREAD_DATA; else process.env.JA_PROOFREAD_DATA = outerEnvData;
const manyCache = safe(() => json(readFileSync(join(altData, "regex-checked.json"), "utf8"))) || {};
ok(`選択肢1501個の繰り返しを、20秒の上限を使い切らずに確かめ（${manyMs}ms）、後ろの無害な規則も通して記録に残す`, manyMs < 8000 && manyRes.length === 2 && Array.isArray(manyRes[0]) && !manyRes[0].length && Array.isArray(manyRes[1]) && !manyRes[1].length && Object.keys(manyCache).length >= 2, manyMs + JSON.stringify(manyRes));

// 21. 0.1.6 で直した不具合の再現
// 1. 選択肢の多い規則が毎回未確認になり、予算を使い切って後ろの無害な規則まで外れていた
// 記録や覚えた結果を使わないよう、上と別の文字で作る
const manyAlt2 = "(?:" + Array.from({ length: 1500 }, (_, i) => String.fromCharCode(0x5800 + i)).join("|") + "|\\p{Script=Greek})+";
t0 = performance.now();
const v8 = safe(() => rs8.shapeProblem(manyAlt2, "u"));
const manyShapeMs = Math.round(performance.now() - t0);
ok(`選択肢1501個（\\p{Script=Greek} を含み、BMP の外まで当てる）の形の検査が2秒以内（${manyShapeMs}ms。0.1.5 では数分）`, v8 === null && manyShapeMs < 2000, JSON.stringify(v8) + manyShapeMs);
// 1文字そのものの選択肢はまとめて当てられるので軽く数える（0.1.7）。手間が上限を超えるのは、文字クラスの選択肢がとても多いもの
const tooMany = "(?:" + Array.from({ length: 3000 }, (_, i) => `[${String.fromCharCode(0x4e00 + 2 * i)}${String.fromCharCode(0x4e01 + 2 * i)}]`).join("|") + "|\\p{Script=Greek})+";
const tmData = tmp("jp-toomany-");
process.env.JA_PROOFREAD_DATA = tmData;
t0 = performance.now();
const tm1 = safe(() => checkRegexesCached([{ source: tooMany, flags: "u" }], { budgetMs: 20000 })) || [];
const tmMs = Math.round(performance.now() - t0);
const tm2 = safe(() => checkRegexesCached([{ source: tooMany, flags: "u" }], { budgetMs: 1 })) || [];
if (outerEnvData === undefined) delete process.env.JA_PROOFREAD_DATA; else process.env.JA_PROOFREAD_DATA = outerEnvData;
ok(`確かめる手間が上限を超える選択（文字クラスの選択肢3001個）は、時刻によらず「確かめきれない」と拒否して記録に残し、次は記録を使う（${tmMs}ms）`, tmMs < 2000 && /手間が上限/.test(tm1[0]?.[0] || "") && /手間が上限/.test(tm2[0]?.[0] || ""), tmMs + JSON.stringify(tm1) + JSON.stringify(tm2));
// 軽い規則から確かめる。重い規則で締め切りになっても、無害な規則は確かめ終え、記録が増えるので次の校正で進む
const lightData = tmp("jp-light-");
process.env.JA_PROOFREAD_DATA = lightData;
const lightList = [...slowShapes, { source: "かるいご", flags: "u" }];
const l1 = safe(() => checkRegexesCached(lightList, { budgetMs: 1500 })) || [];
const l2 = safe(() => checkRegexesCached(lightList, { budgetMs: 1500 })) || [];
const stuck = safe(() => checkRegexesCached([{ source: "(?:\\p{Script=Han}|ぽ)+", flags: "u" }], { budgetMs: 2 })) || [];
if (outerEnvData === undefined) delete process.env.JA_PROOFREAD_DATA; else process.env.JA_PROOFREAD_DATA = outerEnvData;
const nulls = (x) => x.filter((v) => v === null).length;
ok("重い規則が先に並んでいても、後ろの無害な規則は1回目で確かめ終える", Array.isArray(l1[60]) && l1[60].length === 0 && nulls(l1) > 0, JSON.stringify(l1.slice(-2)) + nulls(l1));
ok("確かめ終えたものが増えたときだけ progressed になり、次の校正では未確認が減る", l1.progressed === true && nulls(l2) < nulls(l1) && stuck[0] === null && stuck.progressed === false, `${l1.progressed} ${nulls(l1)} ${nulls(l2)} ${stuck.progressed}`);
const libSrc = readFileSync(S("lib.mjs"), "utf8");
ok("「次の校正で続きを確かめます」は、記録が増えたときだけ書く（知らせは1か所で作る）", /state\.progressed\s*\?\s*`[^`]*次の校正で続きを確かめます/.test(libSrc) && (libSrc.match(/\?\s*`[^`]*次の校正で続きを確かめます/g) || []).length === 1);
if (hasDeps) {
  const altDir2 = prhProj(`version: 1\nrules:\n  - expected: 多い語\n    pattern: /${manyAlt}/\n  - expected: 問い合わせ\n    pattern: 問合せ\n`);
  const altDoc2 = write(altDir2, "d.md", "# 窓口\n\n問合せは窓口で聞きます。\n");
  const altData2 = tmp("jp-altdata2-");
  symlinkSync(join(OUTER_DATA, "deps"), join(altData2, "deps"));
  const hookRun = () => {
    const t = performance.now();
    const rr = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: altDoc2 }, cwd: altDir2 }), env: { CLAUDE_PROJECT_DIR: altDir2, JA_PROOFREAD_DATA: altData2, JA_PROOFREAD_PRH_BUDGET_MS: "20000" }, timeout: 60000 });
    return { ms: Math.round(performance.now() - t), err: rr.error, out: json(rr.stdout).hookSpecificOutput?.additionalContext || json(rr.stdout).reason || "" };
  };
  const h1 = hookRun(), h2 = hookRun();
  ok(`選択肢1501個の prh 規則の後ろの無害な規則が、2回目までに使われる（1回目 ${h1.ms}ms、2回目 ${h2.ms}ms）`, !h1.err && !h2.err && /問い合わせ/.test(h2.out) && !/確かめ終わらなかった/.test(h2.out), h1.out.slice(0, 300) + " / " + h2.out.slice(0, 300));
  ok("選択肢1501個の prh 規則があっても、フックは prh の予算（20秒）を使い切らない", h1.ms < 15000 && h2.ms < 15000, `${h1.ms} / ${h2.ms}`);
}
// 2. specs で止まる1つ目の辞書が予算を使い切っても、2つ目の正常な辞書は使う（辞書ごとに時間を分ける）
if (hasDeps) {
  const spec2Dir = tmp("jp-spec2-");
  write(spec2Dir, "team.yml", "version: 1\nrules:\n" + SLOW_SPEC);
  write(spec2Dir, "good.yml", "version: 1\nrules:\n  - expected: 問い合わせ\n    pattern: 問合せ\n");
  writeFileSync(join(spec2Dir, ".ja-proofread.json"), JSON.stringify({ prh: ["team.yml", "good.yml"] }));
  write(spec2Dir, "d.md", "# 窓口\n\n問合せは窓口で受けます。\n");
  r = run([S("hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(spec2Dir, "d.md") }, cwd: spec2Dir }), env: { CLAUDE_PROJECT_DIR: spec2Dir, JA_PROOFREAD_PRH_BUDGET_MS: "4000" }, timeout: 30000 });
  const spec2Out = json(r.stdout).hookSpecificOutput?.additionalContext || json(r.stdout).reason || "";
  ok("specs で止まる辞書が1つ目でも、2つ目の正常な辞書の規則は使い、止まる辞書だけを外す", !r.error && /team\.yml を時間内に読み終えなかった/.test(spec2Out) && !/good\.yml/.test(spec2Out) && /問い合わせ/.test(spec2Out) && /この辞書に回せた時間は [12](\.\d)?秒/.test(spec2Out), (r.error?.message || "") + spec2Out.slice(0, 500));
}
// 3. 巨大な正規表現でも RangeError で止まらない（形の検査の push、validate と apply が使う checkRegexes）
const hugeSrc = "(?:" + "(?:あ|い)".repeat(200000) + ")x";
const hugeShape = (() => { try { return rs8.shapeProblem(hugeSrc, ""); } catch (e) { return "throw " + e.message; } })();
const hugeChk = (() => { try { const x = rs8.checkRegexes([{ source: hugeSrc, flags: "" }, { source: "ふつうのご", flags: "" }]); return x; } catch (e) { return "throw " + e.message; } })();
ok("選択を20万個含む正規表現でも、形の検査は RangeError で止まらない", hugeShape === null, String(hugeShape).slice(0, 200));
ok("checkRegexes は例外を出さず、ほかの規則も確かめる", Array.isArray(hugeChk) && hugeChk.length === 2 && Array.isArray(hugeChk[1]) && hugeChk[1].length === 0, String(JSON.stringify(hugeChk)).slice(0, 200));
// 4. 記録の鍵に lib.mjs 側の判定の版も入る
const idScript = write(tmp("jp-idjs-"), "t.mjs", `const rs = await import(${JSON.stringify(pathToFileURL(S("regex-safety.mjs")).href)});\nconst a = rs.CHECKER_ID, ka = rs.regexKey("かぎのご", "u");\nawait import(${JSON.stringify(pathToFileURL(S("lib.mjs")).href)});\nconsole.log(JSON.stringify({ a, b: rs.CHECKER_ID, ka, kb: rs.regexKey("かぎのご", "u") }));\n`);
const ids6 = json(run([idScript]).stdout);
ok("lib.mjs を読み込むと CHECKER_ID と記録の鍵が変わる（lib.mjs 側の判定の版が入る）", ids6.a && ids6.b && ids6.a !== ids6.b && ids6.ka !== ids6.kb && /addJudgeVersion\(createHash\("sha256"\)\.update\(checkRegexesCached\.toString\(\)\)/.test(libSrc), JSON.stringify(ids6));

// 22. 0.1.7 で直した不具合の再現
// 1. u なしの \u{2} は「u を2回」なので、(?:\u{2}|u)+す は重なる選択（指数時間）。形の検査で拒否し、時間を測っても拒否する
const NONU = String.raw`(?:\u{2}|u)+す`;
const nonuShape = safe(() => rs8.checkShape(NONU, "")) || [];
const nonuP = safe(() => [String.raw`(?:\p{L}|p)+す`, String.raw`(?:\P{L}|p)+す`].map((x) => rs8.shapeProblem(x, ""))) || [];
const nonuU = safe(() => [rs8.shapeProblem(NONU, "u"), rs8.shapeProblem(String.raw`(?:\p{Script=Han}|ぽ)+`, "u")]) || [];
ok("u なしの (?:\\u{2}|u)+す・(?:\\p{L}|p)+す・(?:\\P{L}|p)+す は、重なり得る選択として形の検査で拒否する（u つきは今までどおり通す）", /繰り返すグループの中に \|/.test(nonuShape[0] || "") && JSON.stringify(nonuP) === JSON.stringify(["alternation", "alternation"]) && JSON.stringify(nonuU) === JSON.stringify([null, null]), JSON.stringify({ nonuShape, nonuP, nonuU }));
ok("u なしの \\u{0} は長さ0に一致し得ると数える", safe(() => rs8.minLength(String.raw`\u{0}`, "")) === 0 && safe(() => rs8.minLength(String.raw`\u{0}`, "u")) === 1);
t0 = performance.now();
const nonuMeasured = safe(() => rs8.measureRegexes([{ source: NONU, flags: "" }])) || [];
const nonuMs = Math.round(performance.now() - t0);
ok(`形の検査を通ったとしても、時間を測る見本（文字×40＋2バイトの文字）で (?:\\u{2}|u)+す を拒否する（${nonuMs}ms）`, Array.isArray(nonuMeasured[0]) && nonuMeasured[0].some((e) => /秒以内に終わりませんでした|ms かかりました/.test(e)) && safe(() => rs8.samplesFor(NONU, "").includes("u".repeat(40) + "￿")), JSON.stringify(nonuMeasured));
{
  const nRepo = tmp("jp-nonurepo-");
  const nLedgerJs = makeRepo(nRepo);
  const nPath = join(nRepo, "plugins/ja-proofread/data/ledger.json");
  const nLedger = json(readFileSync(nPath, "utf8"));
  const p1 = nLedger.patterns.find((p) => p.id === "P001");
  p1.detect.pattern = NONU;
  delete p1.detect.flags;
  writeFileSync(nPath, JSON.stringify(nLedger));
  r = run([nLedgerJs, "validate"], { timeout: 60000 });
  ok("台帳に u なしの (?:\\u{2}|u)+す を書くと validate が拒否する", r.status === 1 && /P001/.test(r.stderr), r.stdout + r.stderr);
}
// 2. 1文字そのものの選択肢の手間は、まとめて当てる分（log n 程度）で見積もる。常用漢字相当2136字と😀の選択（u つき）を通す
const joyo = "(?:" + Array.from({ length: 2136 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("|") + "|😀)+です";
t0 = performance.now();
const joyoShape = safe(() => rs8.checkShape(joyo, "u"));
const joyoMs = Math.round(performance.now() - t0);
const joyoBad = "(?:" + Array.from({ length: 2136 }, (_, i) => String.fromCharCode(0x4e00 + i)).join("|") + "|一)+です";
ok(`常用漢字相当2136字と😀の選択（u つき）は、確かめきれないとせず通す（${joyoMs}ms）。同じ字が2つあれば拒否する`, Array.isArray(joyoShape) && joyoShape.length === 0 && joyoMs < 3000 && safe(() => rs8.shapeProblem(joyoBad, "u")) === "alternation", JSON.stringify(joyoShape) + joyoMs);
if (hasDeps) {
  // 3. 1回の校正に doc と slide が混ざっても、確かめ終わらなかった規則の知らせは1つ、読み込みで止まる辞書の警告も1つ
  const heavy = ["version: 1", "rules:"];
  // prh は正規表現に gmu をつけるので、\p{…} は文字クラス。1件ごとに BMP の外まで当てて確かめるため、300件は数秒では確かめ終わらない
  for (let i = 0; i < 300; i++) heavy.push(`  - expected: 重${i}`, `    pattern: /(?:\\p{Script=Han}|${String.fromCharCode(0x3041 + i)})+/`);
  heavy.push("  - expected: 問い合わせ", "    pattern: 問合せ");
  const mixDir = tmp("jp-mix-");
  write(mixDir, "heavy.yml", heavy.join("\n") + "\n");
  write(mixDir, "team.yml", "version: 1\nrules:\n" + SLOW_SPEC);
  writeFileSync(join(mixDir, ".ja-proofread.json"), JSON.stringify({ prh: ["heavy.yml", "team.yml"], profiles: { "slides/**": "slide" } }));
  const mixDoc = write(mixDir, "d.md", "# 窓口\n\n問合せは窓口で受けます。\n");
  const mixSlide = write(mixDir, "slides/s.md", "# 窓口\n\n問合せは窓口で\n");
  const mixData = tmp("jp-mixdata-");
  symlinkSync(join(OUTER_DATA, "deps"), join(mixData, "deps"));
  const mixRun = run([S("proofread.mjs"), "--json", mixDoc, mixSlide], { cwd: mixDir, env: { JA_PROOFREAD_DATA: mixData, JA_PROOFREAD_PRH_BUDGET_MS: "4000" }, timeout: 120000 });
  const mixRep = json(mixRun.stdout);
  const mw = mixRep.warnings || [];
  const pendW = mw.filter((w) => /heavy\.yml の \d+件の規則は/.test(w));
  const loadW = mw.filter((w) => /team\.yml を時間内に読み終えなかった/.test(w));
  ok("doc と slide が混ざっても、確かめ終わらなかった規則の知らせは辞書ごとに1つで、「続きを確かめます」と「同じところで止まります」が同時に出ない", mixRep.files?.length === 2 && new Set(mixRep.files.map((f) => f.profile)).size === 2 && pendW.length === 1 && !(mw.some((w) => /次の校正で続きを確かめます/.test(w)) && mw.some((w) => /同じところで止まります/.test(w))), JSON.stringify(mw).slice(0, 600) + mixRun.stderr.slice(0, 200));
  ok("specs で止まる辞書は、2つ目の種類では読み直さず、警告も1つだけ", loadW.length === 1, JSON.stringify(mw).slice(0, 600));
  // 4. 後ろの辞書には最低限の時間（1つあたり2秒）だけを残し、見つからない辞書は数えない。警告にはその辞書に回せた時間を書く
  const { buildTextlintConfig, PRH_DICT_MIN_MS } = await import(join(ROOT, "scripts/lib.mjs"));
  const shareDir = tmp("jp-share-");
  write(shareDir, "heavy.yml", heavy.join("\n") + "\n");
  write(shareDir, "good.yml", "version: 1\nrules:\n  - expected: 問い合わせ\n    pattern: 問合せ\n");
  const shareCfgPath = write(shareDir, ".ja-proofread.json", "{}");
  const shareCfg = { path: shareCfgPath, prh: ["heavy.yml", "missing1.yml", "missing2.yml", "missing3.yml", "good.yml"] };
  process.env.JA_PROOFREAD_DATA = tmp("jp-sharedata-");
  symlinkSync(join(OUTER_DATA, "deps"), join(process.env.JA_PROOFREAD_DATA, "deps"));
  t0 = performance.now();
  const shared = safe(() => buildTextlintConfig("doc", shareCfg, { prhDeadline: performance.now() + 6000, prhBudgetMs: 6000 })) || { warnings: [] };
  const shareMs = Math.round(performance.now() - t0);
  if (outerEnvData === undefined) delete process.env.JA_PROOFREAD_DATA; else process.env.JA_PROOFREAD_DATA = outerEnvData;
  const sw = shared.warnings.find((w) => /heavy\.yml の \d+件の規則は/.test(w)) || "";
  const swSec = Number((/この辞書に回せた時間（([\d.]+)秒/.exec(sw) || [])[1]);
  ok(`辞書が多くても、今の辞書には後ろの見つかる辞書の分（1つあたり${PRH_DICT_MIN_MS / 1000}秒）だけを残した時間を回し、警告にその時間を書く（${swSec}秒、${shareMs}ms）`, PRH_DICT_MIN_MS === 2000 && swSec >= 3.5 && swSec <= 4.1 && shared.conf?.rules?.prh?.rulePaths?.length >= 1, JSON.stringify(shared.warnings).slice(0, 600));
}
// 6. 形の検査を通った印（shape-ok:）は、最終の結果を記録したら消す
{
  const soData = tmp("jp-shapeok-");
  const soScript = write(tmp("jp-shapeokjs-"), "t.mjs", `import { checkRegexesCached } from ${JSON.stringify(S("lib.mjs"))};\nimport { readFileSync } from "node:fs";\nimport { join } from "node:path";\nconst r = checkRegexesCached([{ source: "しるしのご(?:こ|お)", flags: "u" }]);\nconst data = JSON.parse(readFileSync(join(process.env.JA_PROOFREAD_DATA, "regex-checked.json"), "utf8"));\nconsole.log(JSON.stringify({ r, keys: Object.keys(data) }));\n`);
  const so = json(run([soScript], { env: { JA_PROOFREAD_DATA: soData } }).stdout);
  ok("形の検査を通った印（shape-ok:）は、最終の結果を記録したら消す", Array.isArray(so.r?.[0]) && so.r[0].length === 0 && so.keys?.length === 1 && !so.keys.some((k) => k.startsWith("shape-ok:")), JSON.stringify(so));
}

// 参考. 同梱の案内と、同梱したスキルの説明
const nbProj = tmp("jp-nobak-");
const nbOut = run([S("install-into-project.mjs"), nbProj]).stdout;
const wbProj = tmp("jp-withbak-");
mkdirSync(join(wbProj, ".claude"), { recursive: true });
writeFileSync(join(wbProj, ".claude/settings.json"), "{}");
const wbOut = run([S("install-into-project.mjs"), wbProj]).stdout;
ok("settings.json が無かったプロジェクトに同梱しても .bak の案内を出さず、あったときは出す", !nbOut.includes("settings.json.bak") && /もともと無かった/.test(nbOut) && !existsSync(join(nbProj, ".claude/settings.json.bak")) && /元のファイルは settings\.json\.bak/.test(wbOut) && existsSync(join(wbProj, ".claude/settings.json.bak")), nbOut + wbOut);
const wbOut2 = run([S("install-into-project.mjs"), wbProj]).stdout;
ok("2回目の同梱では .bak を作らないので、.bak の案内を出さない", !wbOut2.includes("元のファイルは settings.json.bak") && !/もともと無かった/.test(wbOut2) && existsSync(join(wbProj, ".claude/settings.json.bak")), wbOut2);
ok("同梱したスキルに、プラグインのデータ置き場の説明が残らず、XDG_CACHE_HOME のときの場所も書く", ![vsk, vgl].some((x) => /JA_PROOFREAD_DATA=…|プラグインのデータ置き場/.test(x)) && /データ置き場は、書いた直後のフックと同じ既定の場所/.test(vsk) && /データ置き場は、書いた直後のフックと同じ既定の場所/.test(vgl) && [vsk, vgl].every((x) => /\$XDG_CACHE_HOME\/ja-proofread\//.test(x)));

// 20. 1ファイルで入る同梱の一式（dist/ja-proofread-setup.mjs。クラウドセッションの中で、手元のプラグインなしに同梱する）
{
  const DIST = resolve(ROOT, "..", "..", "dist", "ja-proofread-setup.mjs");
  r = run([S("build-setup.mjs"), "--check"]);
  ok("dist/ja-proofread-setup.mjs は作り直したものと同じで、CHANGELOG の今の版の項にその sha256 がある", r.status === 0, r.stdout + r.stderr);
  const outDir = tmp("jp-setupout-");
  r = run([S("build-setup.mjs"), "--out", join(outDir, "s.mjs")]);
  ok("作り直すと dist のファイルとバイト単位で同じ", r.status === 0 && existsSync(DIST) && readFileSync(join(outDir, "s.mjs")).equals(readFileSync(DIST)), r.stderr);
  const gitInit = (d) => { spawnSync("git", ["init", "-q"], { cwd: d }); return d; };
  const viaSetup = gitInit(tmp("jp-setup-"));
  const viaInstall = gitInit(tmp("jp-setupcmp-"));
  r = run([DIST], { cwd: viaSetup });
  run([S("install-into-project.mjs"), viaInstall]);
  // 2つのプロジェクトの .claude/ と .ja-proofread.json を、パスと中身で比べる
  const tree = (d) => {
    const out = [];
    const walk = (rel) => { for (const n of readdirSync(join(d, rel)).sort()) { const p = rel ? `${rel}/${n}` : n; if (statSync(join(d, p)).isDirectory()) walk(p); else out.push(p + "\0" + createHash("sha256").update(readFileSync(join(d, p))).digest("hex")); } };
    walk(".claude");
    out.push(".ja-proofread.json\0" + createHash("sha256").update(readFileSync(join(d, ".ja-proofread.json"))).digest("hex"));
    return out.join("\n");
  };
  ok("引数なしで、カレントディレクトリのリポジトリに install-into-project と同じものを書く", r.status === 0 && safe(() => tree(viaSetup) === tree(viaInstall)), r.stdout.slice(0, 300) + r.stderr);
  const sst = json(readFileSync(join(viaSetup, ".claude/settings.json"), "utf8"));
  const cmds = Object.values(sst.hooks || {}).flatMap((gs) => gs.flatMap((g) => g.hooks.map((h) => h.command)));
  ok("フックのコマンドは $CLAUDE_PROJECT_DIR/.claude/ja-proofread/scripts/ を指す", cmds.length === 2 && cmds.every((c) => c.includes('"$CLAUDE_PROJECT_DIR/.claude/ja-proofread/scripts/')), cmds.join(" | "));
  const addLine = r.stdout.split("\n").find((l) => l.includes("git add ")) || "";
  ok("最後に、同梱したものの名前だけのコミットするパスと git add … && git commit … && git push -u origin HEAD の例を出す", /コミットするパス：\.claude\/ja-proofread \.claude\/skills\/ja-proofread-grow-ledger /.test(r.stdout) && /git add \.claude\/ja-proofread .*\.ja-proofread\.json && git commit -m "ja-proofread を同梱" && git push -u origin HEAD$/.test(addLine) && !addLine.includes("ja-proofread-*") && (r.stdout.match(/コミットするパス：/g) || []).length === 1 && /新しいセッションを始めて/.test(r.stdout), r.stdout);
  ok("同梱に build-setup.mjs と install-project-kit.mjs は入らない（一式で同梱しても install-into-project で同梱しても）。一式は build-setup.mjs を持たない", ["build-setup.mjs", "install-project-kit.mjs"].every((f) => !existsSync(join(viaSetup, ".claude/ja-proofread/scripts", f)) && !existsSync(join(viaInstall, ".claude/ja-proofread/scripts", f))) && existsSync(join(viaSetup, ".claude/ja-proofread/scripts/install-into-project.mjs")) && !run([DIST, "--list"]).stdout.includes("build-setup.mjs"));
  write(viaSetup, "doc.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
  const hr = run([join(viaSetup, ".claude/ja-proofread/scripts/hook-post-edit.mjs")], { input: JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(viaSetup, "doc.md") }, cwd: viaSetup }), env: { CLAUDE_PROJECT_DIR: viaSetup } });
  ok("一式で同梱したフックが動き、必ず直す指摘を返す", /"decision":"block"/.test(hr.stdout) && /必ず直す [1-9]/.test(hr.stdout), hr.stdout.slice(0, 200) + hr.stderr);
  // 作業コピーの根でないところ、git でないところ、壊れたファイルでは何も書かない
  const sub = join(gitInit(tmp("jp-setupsub-")), "sub");
  mkdirSync(sub);
  r = run([DIST, sub]);
  ok("git の作業コピーの根でなければ止め、何も書かない", r.status === 1 && /作業コピーの根ではありません/.test(r.stderr) && readdirSync(sub).length === 0 && !existsSync(join(sub, "..", ".claude")), r.stderr);
  const nogitDir = tmp("jp-setupnogit-");
  r = run([DIST, nogitDir], { env: { GIT_CEILING_DIRECTORIES: dirname(nogitDir) } });
  ok("git の作業コピーでなければ止め、何も書かない", r.status === 1 && /git の作業コピーではありません/.test(r.stderr) && readdirSync(nogitDir).length === 0, r.stderr);
  const src = readFileSync(DIST, "utf8");
  const m = src.match(/\["scripts\/lib\.mjs","([0-9a-f])/);
  const bad = write(outDir, "bad.mjs", m ? src.replace(m[0], m[0].slice(0, -1) + (m[1] === "0" ? "1" : "0")) : "");
  const badProj = gitInit(tmp("jp-setupbad-"));
  r = run([bad, badProj]);
  ok("中のファイルの sha256 が合わなければ、何も書かずに止める", !!m && r.status === 1 && /sha256 が合わない/.test(r.stderr) && readdirSync(badProj).filter((f) => f !== ".git").length === 0, r.stderr);
  // 同梱をコミットしてからやめる（ステージの例は、コミットしていたものだけを出す）
  spawnSync("git", ["add", "-A"], { cwd: viaSetup });
  spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", "commit", "-qm", "vendor"], { cwd: viaSetup });
  r = run([DIST, viaSetup, "--remove"]);
  ok("--remove で同梱をやめ、.ja-proofread.json は残し、git add -A の例を出す", r.status === 0 && !existsSync(join(viaSetup, ".claude")) && existsSync(join(viaSetup, ".ja-proofread.json")) && /git add -A -- \.claude\/ja-proofread /.test(r.stdout), r.stdout + r.stderr);
  // 同梱が無いリポジトリで --remove：何も変えず、コミットするパスと例を出さない（自分の .claude/settings.json があっても）
  const noVend = gitInit(tmp("jp-setupnov-"));
  write(noVend, ".claude/settings.json", JSON.stringify({ permissions: { allow: ["Bash(ls)"] } }) + "\n");
  spawnSync("git", ["add", "-A"], { cwd: noVend });
  r = run([DIST, noVend, "--remove"]);
  ok("同梱が無いときの --remove は、何も変えず、コミットするパスと例を出さずに終える", r.status === 0 && /同梱されていません/.test(r.stdout) && !/コミットするパス|git add|git push/.test(r.stdout) && json(readFileSync(join(noVend, ".claude/settings.json"), "utf8")).permissions?.allow?.[0] === "Bash(ls)", r.stdout + r.stderr);
  // 表示した例は、上流のない作業用ブランチでもそのまま通る（git push -u origin HEAD）
  const bare = tmp("jp-setupbare-");
  spawnSync("git", ["init", "-q", "--bare", bare]);
  const clone = join(tmp("jp-setupclone-"), "w");
  spawnSync("git", ["clone", "-q", bare, clone]);
  const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.invalid" };
  const gitIn = (args, cwd = clone) => spawnSync("git", args, { cwd, encoding: "utf8", env: { ...BASE_ENV, ...gitEnv } });
  write(clone, "README.md", "# x\n");
  gitIn(["add", "-A"]); gitIn(["commit", "-qm", "init"]); gitIn(["push", "-q", "origin", "HEAD"]);
  gitIn(["checkout", "-q", "-b", "claude/work"]);
  r = run([DIST], { cwd: clone });
  const pushLine = (out) => (out.split("\n").find((l) => /^ {2}cd .* && git add /.test(l)) || "").trim();
  let pr = spawnSync("bash", ["-c", pushLine(r.stdout)], { encoding: "utf8", env: { ...BASE_ENV, ...gitEnv } });
  const remoteFiles = () => gitIn(["ls-tree", "-r", "--name-only", "claude/work"], bare).stdout;
  ok("表示した git add … && git push -u origin HEAD の例が、上流のない作業用ブランチで通る", r.status === 0 && pr.status === 0 && remoteFiles().includes(".claude/ja-proofread/scripts/install-into-project.mjs") && remoteFiles().includes(".ja-proofread.json") && gitIn(["rev-parse", "--abbrev-ref", "claude/work@{upstream}"]).stdout.trim() === "origin/claude/work", pushLine(r.stdout) + pr.stdout + pr.stderr);
  r = run([DIST, "--remove"], { cwd: clone });
  pr = spawnSync("bash", ["-c", pushLine(r.stdout)], { encoding: "utf8", env: { ...BASE_ENV, ...gitEnv } });
  ok("--remove で表示した例も通り、リモートの作業用ブランチから同梱が消える", r.status === 0 && pr.status === 0 && !remoteFiles().includes(".claude/") && remoteFiles().includes(".ja-proofread.json"), pushLine(r.stdout) + pr.stdout + pr.stderr + remoteFiles());
  // build-setup.mjs は git が追跡しているファイルだけを入れ、git の外では止める
  const bRepo = tmp("jp-buildrepo-");
  cpSync(ROOT, join(bRepo, "plugins/ja-proofread"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  spawnSync("git", ["init", "-q"], { cwd: bRepo });
  spawnSync("git", ["add", "-A"], { cwd: bRepo });
  write(bRepo, "plugins/ja-proofread/templates/untracked-memo.md", "追跡していないメモ\n");
  write(bRepo, "plugins/ja-proofread/scripts/untracked.mjs", "// 追跡していない\n");
  r = run([join(bRepo, "plugins/ja-proofread/scripts/build-setup.mjs"), "--out", join(bRepo, "out/s.mjs")]);
  const bList = run([join(bRepo, "out/s.mjs"), "--list"]).stdout;
  ok("build-setup.mjs は git が追跡していないファイルを入れない", r.status === 0 && bList.includes("scripts/install-into-project.mjs") && !bList.includes("untracked") && !bList.includes("build-setup.mjs"), r.stderr + bList.slice(0, 300));
  const nRepo = tmp("jp-buildnogit-");
  cpSync(ROOT, join(nRepo, "plugins/ja-proofread"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  r = run([join(nRepo, "plugins/ja-proofread/scripts/build-setup.mjs"), "--out", join(nRepo, "out/s.mjs")], { env: { GIT_CEILING_DIRECTORIES: nRepo } });
  ok("build-setup.mjs は git の外では止め、何も書かない", r.status === 1 && /git ls-files/.test(r.stderr) && !existsSync(join(nRepo, "out")), r.stderr);
  r = run([DIST, "--version"]);
  ok("一式の版は plugin.json と同じ", r.stdout.trim() === json(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version, r.stdout);
}

// 21. Projects 向けの kit（--project-kit。リポジトリなしで、/mnt/project-files のような所に一式と手順と指示を書く）
{
  const DIST = resolve(ROOT, "..", "..", "dist", "ja-proofread-setup.mjs");
  const pf = tmp("jp-kitpf-");
  const kit = join(pf, "ja-proofread-kit");
  const kdata = join(pf, "ja-proofread-data");
  r = run([DIST, "--project-kit", kit], { env: { GIT_CEILING_DIRECTORIES: pf } });
  const allFiles = (d) => { const out = []; const walk = (x) => { for (const n of readdirSync(x)) { const p = join(x, n); out.push(p); if (statSync(p).isDirectory()) walk(p); } }; walk(d); return out; };
  ok("--project-kit は git の作業コピーでなくても kit を書く", r.status === 0 && existsSync(join(kit, "kit.json")) && existsSync(join(kit, "PROJECT-INSTRUCTIONS.md")) && existsSync(join(kit, "scripts/proofread.mjs")) && existsSync(join(kit, "rules/ledger-patterns.js")) && existsSync(join(kit, "agents/structure-reviewer.md")) && existsSync(join(kit, "skills/proofread/SKILL.md")), r.stdout.slice(0, 300) + r.stderr);
  ok("kit に隠しファイルと、kit では使わないスクリプト（同梱・kit・dist・フック）を書かない", safe(() => !allFiles(kit).some((p) => basename(p).startsWith(".")) && ["build-setup.mjs", "install-into-project.mjs", "install-project-kit.mjs", "hook-post-edit.mjs"].every((f) => !existsSync(join(kit, "scripts", f)))));
  const kj = json(readFileSync(join(kit, "kit.json"), "utf8"));
  ok("kit.json に版と記録の置き場（kit の隣の ja-proofread-data）がある", kj.name === "ja-proofread-kit" && kj.version === json(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version && resolve(kit, kj.data) === kdata, JSON.stringify(kj));
  const ksk = ["write", "proofread", "grow-ledger"].map((n) => readFileSync(join(kit, "skills", n, "SKILL.md"), "utf8")).join("\n");
  const kpaths = [...ksk.matchAll(new RegExp(kit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(/[^\\s\"`）)]+)", "g"))].map((m) => kit + m[1]);
  ok("kit の手順の本文に、プラグイン用の変数とプラグインだけの案内が残らず、指すファイルが実在する", !ksk.includes("${CLAUDE_") && !ksk.includes("plugin-only") && !/JA_PROOFREAD_DATA=/.test(ksk) && !/ja-proofread:(structure-reviewer|fresh-eyes-reader)/.test(ksk) && kpaths.length >= 5 && kpaths.every((p) => existsSync(p)), kpaths.filter((p) => !existsSync(p)).join(","));
  ok("kit の proofread の手順は、サブエージェントを Agent ツールで起動し、kit の agents の本文を渡す", /Agent ツールで起動し、`[^`]*\/agents\/structure-reviewer\.md` の本文/.test(ksk) && /\/agents\/fresh-eyes-reader\.md` の本文/.test(ksk));
  const pi = readFileSync(join(kit, "PROJECT-INSTRUCTIONS.md"), "utf8");
  const paste = (pi.split("<!-- 貼る部分ここから -->\n")[1] || "").split("\n<!-- 貼る部分ここまで -->")[0];
  ok("PROJECT-INSTRUCTIONS.md の貼る部分は3,000字以下で、毎回の ensure-deps と proofread、手順の本文、記録の置き場を kit の場所で書く", paste.length > 500 && [...paste].length <= 3000 && paste.includes(`node "${kit}/scripts/ensure-deps.mjs"`) && paste.includes(`node "${kit}/scripts/proofread.mjs" <ファイル>`) && ["write", "proofread", "grow-ledger"].every((n) => paste.includes(`${kit}/skills/${n}/SKILL.md`)) && paste.includes(kdata) && /本人が頼んだときだけ/.test(paste) && r.stdout.includes(paste), [...paste].length);
  // 空の HOME・既定のデータ置き場（環境変数なし）で動く。依存は ~/.cache の下、記録は kit の隣に残る
  const khome = tmp("jp-kithome-");
  mkdirSync(join(khome, ".cache/ja-proofread"), { recursive: true });
  if (existsSync(join(OUTER_DATA, "deps"))) symlinkSync(join(OUTER_DATA, "deps"), join(khome, ".cache/ja-proofread/deps"));
  const kenv = { ...BASE_ENV, HOME: khome };
  delete kenv.JA_PROOFREAD_DATA; delete kenv.XDG_CACHE_HOME;
  const krun = (a) => spawnSync(process.execPath, a, { encoding: "utf8", cwd: WORK, env: kenv });
  const kdoc = write(tmp("jp-kitdoc-"), "doc.md", readFileSync(join(ROOT, "tests/fixtures/ai-like.md"), "utf8"));
  r = krun([join(kit, "scripts/ensure-deps.mjs")]);
  const kr = krun([join(kit, "scripts/proofread.mjs"), kdoc]);
  ok("kit の ensure-deps と proofread が動き、必ず直す指摘を返し、検出の記録を kit の隣の ja-proofread-data に残す", r.status === 0 && /必ず直す [1-9]/.test(kr.stdout) && existsSync(join(kdata, "hits.jsonl")) && !existsSync(join(kdata, "deps")), kr.stdout.slice(0, 200) + kr.stderr);
  krun([join(kit, "scripts/ledger.mjs"), "fp", "P002", "--text", "x", "--reason", "テスト"]);
  ok("kit で記録した誤検知も ja-proofread-data に残る", existsSync(join(kdata, "false-positives.jsonl")));
  // 上書き（版の更新）、ほかのファイルは残す、kit でない空でないディレクトリには書かない、--remove
  write(kit, "mine.txt", "利用者のメモ\n");
  writeFileSync(join(kit, "scripts/old.mjs"), "// 前の版の残り\n");
  r = run([DIST, "--project-kit", kit]);
  ok("kit をもう一度書くと入れ替え、前の版の残りは消え、利用者のファイルは残る", r.status === 0 && !existsSync(join(kit, "scripts/old.mjs")) && existsSync(join(kit, "mine.txt")) && existsSync(join(kit, "scripts/proofread.mjs")), r.stderr);
  r = run([DIST, "--project-kit", pf]);
  ok("kit でない、空でないディレクトリには何も書かずに止める", r.status === 1 && /kit（kit.json）でもない/.test(r.stderr) && !existsSync(join(pf, "kit.json")), r.stderr);
  r = run([DIST, "--project-kit", kit, "--remove"]);
  ok("--project-kit … --remove で kit の分だけ消し、利用者のファイルと記録の置き場は残す", r.status === 0 && readdirSync(kit).join(",") === "mine.txt" && existsSync(join(kdata, "hits.jsonl")), readdirSync(kit).join(",") + r.stderr);
  const asKit = join(tmp("jp-kitas-"), "kit");
  r = run([DIST, "--project-kit", asKit, "--as", "/mnt/project-files/ja-proofread-kit"]);
  const asText = ["PROJECT-INSTRUCTIONS.md", "skills/proofread/SKILL.md"].map((f) => readFileSync(join(asKit, f), "utf8")).join("\n");
  ok("--as を付けると、手元で作った kit の手順と指示のパスを使う場所で書く（アップロード向け）", r.status === 0 && asText.includes('node "/mnt/project-files/ja-proofread-kit/scripts/proofread.mjs"') && asText.includes("/mnt/project-files/ja-proofread-data") && !asText.includes(asKit), r.stderr);
  r = run([DIST, "--project-kit", join(pf, "none"), "--remove"]);
  ok("kit が無いときの --remove は何も変えずに終える", r.status === 0 && /kit はありません/.test(r.stdout) && !existsSync(join(pf, "none")), r.stdout + r.stderr);
}

// 12. 一時ディレクトリを残さない（このテストが作ったものは、ここで消す）
// 子プロセスが作る ja-proofread-* は、子プロセスが終わってから消える。終わりきるまで（最大10秒）待ってから確かめる
const childLeft = () => { try { return readdirSync(CHILD_TMP).filter((f) => /^(jp-|ja-proofread-)/.test(f)); } catch { return []; } };
const sleeper = new Int32Array(new SharedArrayBuffer(4));
for (let i = 0; i < 100 && childLeft().length; i++) Atomics.wait(sleeper, 0, 0, 100);
const leftChild = childLeft();
const ours = [...made];
cleanup();
const leftover = [...leftChild, ...ours.filter((d) => existsSync(d))];
ok("テストが作った一時ディレクトリ（jp-*、子プロセスの ja-proofread-*）は終わりに消える", leftover.length === 0, leftover.slice(0, 5).join(","));

console.log(failed ? `\n${passed + failed} 項目中 ${failed} 件失敗` : `\n${passed} 項目すべて成功`);
process.exit(failed ? 1 : 0);
