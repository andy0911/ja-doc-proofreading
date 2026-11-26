#!/usr/bin/env node
// 使い方: node proofread.mjs [--profile doc|slide] [--json] [--max N] <ファイル...>
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, proofreadFiles, summarize, depsReady, loadProjectConfig, checkProfile, isKitRoot, DEFAULT_EXCLUDE } from "./lib.mjs";

const fail = (msg, code = 2) => { console.error(`ja-proofread: ${msg}`); process.exit(code); };
const args = process.argv.slice(2);
const opt = { json: false, profile: undefined, max: 80 };
const files = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--json") opt.json = true;
  else if (a === "--profile") opt.profile = args[++i];
  else if (a === "--max") opt.max = Number(args[++i]);
  else files.push(a);
}
if (!files.length) fail("使い方: node proofread.mjs [--profile doc|slide] [--json] <ファイル...>");
try { if (opt.profile !== undefined) checkProfile(opt.profile, "--profile"); } catch (e) { fail(e.message); }
for (const f of files) {
  if (!existsSync(f)) fail(`ファイルが見つかりません：${f}`);
  if (!statSync(f).isFile()) fail(`ファイルではありません：${f}`);
}
let cfg;
try { cfg = loadProjectConfig(); } catch (e) { fail(e.message); }
if (!depsReady()) spawnSync(process.execPath, [join(ROOT, "scripts", "ensure-deps.mjs")], { stdio: ["ignore", "ignore", "inherit"] });
let report;
try { report = proofreadFiles(files, { cfg, profile: opt.profile }); } catch (e) { fail(e.message, 1); }
// kit として動くときは、作業しているディレクトリの .ja-proofread.json を使ったことを毎回1行で知らせる。
// 共有フォルダーでは、ほかのスレッドが置いた設定で規則を止め、指摘を減らせるため（読むこと自体は止めない）
let cfgNote = "";
if (isKitRoot() && cfg.exists) {
  const short = (xs) => xs.slice(0, 5).join("、") + (xs.length > 5 ? ` ほか ${xs.length - 5} 件` : "");
  const disable = cfg.disable || [];
  const exclude = (cfg.exclude || []).filter((x) => !DEFAULT_EXCLUDE.includes(x));
  const parts = [`止めた規則 ${disable.length} 件${disable.length ? `：${short(disable)}` : ""}`];
  if (exclude.length) parts.push(`除外 ${exclude.length} 件：${short(exclude)}`);
  if ((cfg.prh || []).length) parts.push(`追加の辞書 ${cfg.prh.length} 件`);
  cfgNote = `ja-proofread: 設定 ${cfg.path} を使いました（${parts.join("／")}）`;
}
if (opt.json) {
  if (cfgNote) console.error(cfgNote);
  console.log(JSON.stringify(report, null, 2));
} else console.log((cfgNote ? cfgNote + "\n" : "") + summarize(report, { max: opt.max }).text);
