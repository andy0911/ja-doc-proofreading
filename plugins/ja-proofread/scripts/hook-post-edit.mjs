#!/usr/bin/env node
// PostToolUse フック：Write / Edit / MultiEdit の直後に、対象が文書なら校正して結果を Claude に返す。
// プロジェクトに .ja-proofread.json があるときだけ動く（コードのリポジトリで README を直すたびに口を出さないため）。
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { ROOT, loadProjectConfig, matchesAny, toRel, proofreadFiles, summarize, depsReady } from "./lib.mjs";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try { main(JSON.parse(raw || "{}")); } catch (e) { process.stderr.write(`ja-proofread hook: ${e.message}\n`); process.exit(0); }
});

function main(input) {
  const file = input?.tool_input?.file_path || input?.tool_input?.path;
  if (!file) return;
  const abs = resolve(input.cwd || process.cwd(), file);
  if (!existsSync(abs)) return;
  const proj = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  // プロジェクトに同梱した版があれば、そちらのフックに任せる（二重に指摘しないため）
  const vendored = join(proj, ".claude", "ja-proofread");
  if (resolve(ROOT) !== resolve(vendored) && existsSync(join(vendored, "scripts", "hook-post-edit.mjs"))) return;
  const cfg = loadProjectConfig(proj);
  if (!cfg.exists || cfg.hook.enabled === false) return;
  const rel = toRel(abs, cfg);
  if (rel.startsWith("..")) return;
  if (!matchesAny(rel, cfg.include) || matchesAny(rel, cfg.exclude)) return;
  if (!depsReady()) {
    out({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "ja-proofread: textlint の依存がまだ入っていないため、構成チェックだけ実行しました。" } }, abs, cfg);
    return;
  }
  out(null, abs, cfg);
}

function out(prefix, abs, cfg) {
  const report = proofreadFiles([abs], { cfg });
  const s = summarize(report, { max: 25 });
  if (s.total === 0) return;
  const order = { must: 0, should: 1, info: 2, never: 3 };
  const blockOn = cfg.hook.blockOn || "must";
  const shouldBlock = (s.levels.must > 0 && order[blockOn] <= 0) || (s.levels.should > 0 && order[blockOn] <= 1) || (s.levels.info > 0 && order[blockOn] <= 2);
  const text = (prefix ? prefix.hookSpecificOutput.additionalContext + "\n" : "") + s.text +
    "\n\n指摘は機械的な候補です。直す前に文脈を確かめ、誤検知なら ja-proofread の grow-ledger スキルで誤検知として記録してください。";
  const payload = shouldBlock
    ? { decision: "block", reason: text }
    : { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: text } };
  process.stdout.write(JSON.stringify(payload));
}
