#!/usr/bin/env node
// 使い方: node proofread.mjs [--profile doc|slide] [--json] [--max N] <ファイル...>
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { ROOT, proofreadFiles, summarize, depsReady, loadProjectConfig } from "./lib.mjs";

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
if (!files.length) {
  console.error("使い方: node proofread.mjs [--profile doc|slide] [--json] <ファイル...>");
  process.exit(2);
}
if (!depsReady()) spawnSync(process.execPath, [join(ROOT, "scripts", "ensure-deps.mjs")], { stdio: "inherit" });
const report = proofreadFiles(files, { cfg: loadProjectConfig(), profile: opt.profile });
if (opt.json) console.log(JSON.stringify(report, null, 2));
else console.log(summarize(report, { max: opt.max }).text);
