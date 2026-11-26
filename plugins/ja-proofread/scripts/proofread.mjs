#!/usr/bin/env node
// 使い方: node proofread.mjs [--profile doc|slide] [--json] [--max N] <ファイル...>
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, proofreadFiles, summarize, depsReady, loadProjectConfig, checkProfile } from "./lib.mjs";

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
if (opt.json) console.log(JSON.stringify(report, null, 2));
else console.log(summarize(report, { max: opt.max }).text);
