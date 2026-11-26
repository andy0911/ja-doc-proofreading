#!/usr/bin/env node
// textlint などの依存を、プラグインの更新で消えない場所（CLAUDE_PLUGIN_DATA）に入れる。
// package.json が変わったときだけ入れ直す。SessionStart フックと、校正の実行前に呼ばれる。
import { copyFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, depsDir, depsHash, depsReady } from "./lib.mjs";

const quiet = process.argv.includes("--quiet");
const log = (m) => { if (!quiet) process.stderr.write(m + "\n"); };

if (process.env.JA_PROOFREAD_SKIP_INSTALL === "1") process.exit(0);
if (depsReady()) { log("ja-proofread: 依存は入っています"); process.exit(0); }

const dir = depsDir();
mkdirSync(dir, { recursive: true });
const lock = join(dir, ".lock");
if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs < 10 * 60 * 1000) {
  log("ja-proofread: 別の処理が依存を入れています");
  process.exit(0);
}
writeFileSync(lock, String(process.pid));
try {
  copyFileSync(join(ROOT, "package.json"), join(dir, "package.json"));
  log("ja-proofread: textlint とルールを入れています（初回のみ、30秒ほど）");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const r = spawnSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) {
    process.stderr.write("ja-proofread: 依存を入れられませんでした。ネットワーク（registry.npmjs.org）を確認してください。\n" + (r.stderr || "").slice(-1500) + "\n");
    process.exit(0); // セッションは止めない
  }
  writeFileSync(join(dir, ".stamp"), depsHash());
  log("ja-proofread: 依存を入れました");
} finally {
  rmSync(lock, { force: true });
}
