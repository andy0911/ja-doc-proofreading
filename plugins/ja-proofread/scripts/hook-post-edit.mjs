#!/usr/bin/env node
// PostToolUse フック：Write / Edit / MultiEdit の直後に、対象が文書なら校正して結果を Claude に返す。
// プロジェクトに .ja-proofread.json があるときだけ動く（コードのリポジトリで README を直すたびに口を出さないため）。
// Claude に直させる（block）のは、前回の結果になかった指摘のうち、重さが hook.blockOn 以上のものがあるときだけ。
// 既存の文書にもともとある指摘のために、関係ない編集のたびに止め続けないため。
import { existsSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { ROOT, loadProjectConfig, matchesAny, toRel, proofreadFiles, summarize, depsReady, dataDir, fileKey } from "./lib.mjs";

export const MAX_BYTES = 200 * 1024;
const ORDER = { must: 0, should: 1, info: 2 };
const FOOTER = "\n\n指摘は機械的な候補です。直す前に文脈を確かめ、誤検知なら ja-proofread の grow-ledger スキルで誤検知として記録してください。";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try { main(JSON.parse(raw || "{}")); } catch (e) { process.stderr.write(`ja-proofread hook: ${e.message}\n`); process.exit(0); }
});

const context = (text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } }));

function main(input) {
  const file = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!file) return;
  const abs = resolve(input.cwd || process.cwd(), file);
  if (!existsSync(abs)) return;
  const proj = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  // プロジェクトに同梱した版があれば、そちらのフックに任せる（二重に指摘しないため）
  const vendored = join(proj, ".claude", "ja-proofread");
  if (resolve(ROOT) !== resolve(vendored) && existsSync(join(vendored, "scripts", "hook-post-edit.mjs"))) return;
  if (!existsSync(join(proj, ".ja-proofread.json"))) return;
  let cfg;
  try { cfg = loadProjectConfig(proj); } catch (e) { context(`ja-proofread: 設定を読めないため校正しませんでした。${e.message}`); return; }
  if (!cfg.exists || cfg.hook.enabled === false) return;
  const rel = toRel(abs, cfg);
  if (rel.startsWith("..")) return;
  if (!matchesAny(rel, cfg.include) || matchesAny(rel, cfg.exclude)) return;
  const size = statSync(abs).size;
  if (size > MAX_BYTES) {
    context(`ja-proofread: ${rel} は ${Math.round(size / 1024)}KB あり、書いた直後の校正の上限（${MAX_BYTES / 1024}KB）を超えるため飛ばしました。校正するときは proofread スキルを使ってください。`);
    return;
  }
  const prefix = depsReady() ? "" : "ja-proofread: textlint の依存がまだ入っていないため、構成チェックだけ実行しました。\n";
  const report = proofreadFiles([abs], { cfg });
  const s = summarize(report, { max: 25 });
  const findings = report.files[0]?.findings || [];

  // 前回の結果と比べて、新しく出た指摘だけを数える
  const fresh = newFindings(abs, findings);
  const blockOn = cfg.hook.blockOn || "must";
  const blocking = blockOn === "never" ? [] : fresh.filter((x) => ORDER[x.level] <= (ORDER[blockOn] ?? 0));

  if (s.total === 0 && !report.lintError && !(report.warnings || []).length) return;
  let text = prefix + s.text;
  if (report.lintError) text = "ja-proofread: textlint が動かなかったため、textlint の指摘は確かめられていません。\n" + text;
  if (blocking.length) text += `\n\n今回の編集で新しく出た指摘のうち、直してほしいもの：${blocking.length}件（${blocking.slice(0, 5).map((x) => `${x.line ? x.line + "行 " : ""}${x.ruleId}`).join("、")}${blocking.length > 5 ? "ほか" : ""}）`;
  text += FOOTER;
  const payload = blocking.length
    ? { decision: "block", reason: text }
    : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } };
  process.stdout.write(JSON.stringify(payload));
}

// 指摘の見分け方。行番号や回数は編集でずれるので、数字は伏せて比べる
const sig = (x) => `${x.ruleId}|${String(x.message).replace(/[0-9０-９]+/g, "#")}`;

function newFindings(abs, findings) {
  const path = join(dataDir(), "hook-last.json");
  let state = {};
  try { state = JSON.parse(readFileSync(path, "utf8")); } catch { state = {}; }
  const key = fileKey(abs);
  const prev = new Map();
  for (const s of state[key]?.sigs || []) prev.set(s, (prev.get(s) || 0) + 1);
  const fresh = [];
  for (const x of findings) {
    const s = sig(x);
    const n = prev.get(s) || 0;
    if (n > 0) prev.set(s, n - 1);
    else fresh.push(x);
  }
  state[key] = { at: Date.now(), sigs: findings.map(sig) };
  // 古いものから捨て、500ファイル分までにする
  const keys = Object.keys(state).sort((a, b) => (state[b].at || 0) - (state[a].at || 0));
  for (const k of keys.slice(500)) delete state[k];
  try { writeFileSync(path, JSON.stringify(state)); } catch { /* 保存できなくても校正の結果は返す */ }
  return fresh;
}
