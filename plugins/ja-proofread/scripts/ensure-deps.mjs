#!/usr/bin/env node
// textlint などの依存を、プラグインの更新で消えない場所（データ置き場の deps/）に入れる。
// package.json か package-lock.json が変わったときだけ入れ直す。SessionStart フックと、校正の実行前に呼ばれる。
//   --quiet  フックから呼ぶとき。成功しても何も出さず、失敗したときだけ Claude と利用者に知らせる JSON を出す
//   --force  入れるのに失敗したばかりでも、待たずにもう一度試す
// 入れるのに失敗したら、依存の置き場に印（.failed）を書き、10分は試さない（校正のたびに npm を待たせないため）
import { copyFileSync, writeFileSync, existsSync, mkdirSync, rmSync, statSync, openSync, closeSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, depsDir, depsHash, depsReady } from "./lib.mjs";

const quiet = process.argv.includes("--quiet");
const force = process.argv.includes("--force");
const RETRY_AFTER_MS = 10 * 60 * 1000;
const log = (m) => { if (!quiet) process.stderr.write(m + "\n"); };
const STALE_MS = 15 * 60 * 1000;

// 失敗を知らせる。フックからなら、Claude には additionalContext、利用者には systemMessage で見せる
function report(msg) {
  if (quiet) {
    process.stdout.write(JSON.stringify({
      systemMessage: `ja-proofread: ${msg}`,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: `ja-proofread: ${msg} 校正では、Node だけで動く構成の型と件数で数える型だけが動き、textlint の指摘（表記・文法・AIっぽい語句、台帳の語句の型）は出ません。校正の結果を伝えるときは、このことを利用者に伝えてください。` },
    }));
  } else process.stderr.write(`ja-proofread: ${msg}\n`);
}

if (process.env.JA_PROOFREAD_SKIP_INSTALL === "1") process.exit(0);
if (depsReady()) { log("ja-proofread: 依存は入っています"); process.exit(0); }

const dir = depsDir();
mkdirSync(dir, { recursive: true });
const lock = join(dir, ".lock");
const failMark = join(dir, ".failed");

// 少し前に同じ依存（package.json と lock が同じ）で失敗していたら、試さずに知らせて終える
if (!force) {
  let mark = null;
  try { mark = JSON.parse(readFileSync(failMark, "utf8")); } catch { /* 印なし */ }
  const age = mark ? Date.now() - Number(mark.at) : NaN;
  if (mark && mark.hash === depsHash() && age >= 0 && age < RETRY_AFTER_MS) {
    const min = Math.max(1, Math.ceil((RETRY_AFTER_MS - age) / 60000));
    report(`textlint などの依存は、少し前に入れられませんでした（${mark.why || "理由は不明"}）。あと${min}分は試しません。すぐに試すときは \`node "${join(ROOT, "scripts", "ensure-deps.mjs")}" --force\` を実行してください。`);
    process.exit(0);
  }
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// ロックは作るときに排他（wx）で取る。中の PID が動いていなければ、古いロックとして消して取り直す
function takeLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lock, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let pid = NaN, age = 0;
      try { pid = Number(readFileSync(lock, "utf8").trim()); age = Date.now() - statSync(lock).mtimeMs; } catch { /* 消えた直後 */ }
      if (alive(pid) && age < STALE_MS) return false;
      rmSync(lock, { force: true });
    }
  }
  return false;
}

if (!takeLock()) { log("ja-proofread: 別の処理が依存を入れています"); process.exit(0); }
try {
  copyFileSync(join(ROOT, "package.json"), join(dir, "package.json"));
  const hasLock = existsSync(join(ROOT, "package-lock.json"));
  if (hasLock) copyFileSync(join(ROOT, "package-lock.json"), join(dir, "package-lock.json"));
  log("ja-proofread: textlint とルールを入れています（初回のみ、30秒ほど）");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  // ロックファイルの版をそのまま入れる。パッケージのインストールスクリプトは動かさない
  const common = ["--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", "--fetch-retries=1", "--fetch-timeout=20000", "--update-notifier=false"];
  const r = spawnSync(npm, [hasLock ? "ci" : "install", ...common], { cwd: dir, encoding: "utf8", shell: process.platform === "win32", timeout: 280000, killSignal: "SIGKILL" });
  if (r.error || r.status !== 0) {
    const errLines = (r.stderr || "").split("\n").filter((l) => /^npm (error|ERR!)/.test(l) && !/complete log/.test(l));
    const why = r.error ? r.error.message : (errLines.slice(0, 3).join(" ") || (r.stderr || "").trim().slice(-400));
    report(`textlint などの依存を入れられませんでした。ネットワーク（registry.npmjs.org）を確かめてください。${why ? `npm の出力：${why}` : ""}`);
    try { writeFileSync(failMark, JSON.stringify({ at: Date.now(), hash: depsHash(), why: (why || "").slice(0, 300) })); } catch { /* 印を書けなくても続ける */ }
    process.exitCode = 0; // セッションは止めない
  } else {
    writeFileSync(join(dir, ".stamp"), depsHash());
    rmSync(failMark, { force: true });
    log("ja-proofread: 依存を入れました");
  }
} finally {
  rmSync(lock, { force: true });
}
