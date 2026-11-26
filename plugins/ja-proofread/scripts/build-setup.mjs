#!/usr/bin/env node
// 1ファイルで入る同梱の一式（リポジトリの根の dist/ja-proofread-setup.mjs）を作る。
// claude.ai/code のクラウドセッションには手元のプラグインの写しがないので、install-into-project.mjs を直接は動かせない。
// そこで、同梱に要るファイル（install-into-project.mjs がコピーするものと、その元になるスキル・サブエージェント）を
// base64 で中に持つ、依存なしの Node スクリプトを1つ作る。curl で取って node で動かすだけで同梱できる。
//
//   node build-setup.mjs            作る。CHANGELOG.md の今の版の項に、できたファイルの sha256 の行を書く
//   node build-setup.mjs --check    作り直したものが dist のファイルとバイト単位で同じか、CHANGELOG の今の版の項に
//                                   その sha256 があるかを確かめる（CI とテストが使う。古いまま出荷しないため）
//   node build-setup.mjs --out <パス> ほかの場所に書く（CHANGELOG は変えない）
import { readFileSync, writeFileSync, lstatSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..", "..");
export const DIST = join(REPO, "dist", "ja-proofread-setup.mjs");
const CHANGELOG = join(REPO, "CHANGELOG.md");

// install-into-project.mjs が読むもの・コピーするもの。tests と hooks は同梱しないので入れない。
// build-setup.mjs 自身も、同梱先では使わないので入れない（install-into-project.mjs もコピーしない）
const DIRS = [".claude-plugin", "agents", "config", "data", "rules", "scripts", "skills", "templates"];
const TOP_FILES = ["package.json", "package-lock.json"];
const SELF = "scripts/build-setup.mjs";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// 入れるファイルは git が追跡しているもの（git ls-files）で決める。手元にだけある追跡していないファイル
// （approved.json の写しや作業中のメモなど）は、CI のチェックアウトには無く、入れると作り直したものが合わなくなるため。
// git の外で動かしたとき（git が無い、作業コピーでない、ファイルを追跡していない）は止める
export function collect() {
  const r = spawnSync("git", ["ls-files", "-z", "--", ...DIRS, ...TOP_FILES], { cwd: ROOT, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`git ls-files でファイルを決められないので止めました。このリポジトリの git の作業コピーの中で動かしてください（${r.error ? r.error.message : (r.stderr || "").trim()}）`);
  const files = r.stdout.split("\0").filter((p) => p && p !== SELF);
  if (!files.some((p) => p === "scripts/install-into-project.mjs")) throw new Error("git が追跡しているファイルに scripts/install-into-project.mjs がないので止めました。このリポジトリの git の作業コピーの中で動かしてください");
  const bad = files.filter((p) => { try { return !lstatSync(join(ROOT, p)).isFile(); } catch { return true; } });
  if (bad.length) throw new Error(`git が追跡しているのに、ふつうのファイルとして読めないものがあります：${bad.join(" ")}`);
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function buildSetup() {
  const version = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8")).version;
  const files = collect().map((p) => {
    const buf = readFileSync(join(ROOT, p));
    return [p, sha256(buf), buf.toString("base64")];
  });
  const body = SETUP_TEMPLATE
    .replaceAll("@@VERSION@@", version)
    .replace("@@FILES@@", () => files.map((f) => JSON.stringify(f)).join(",\n"));
  return { version, files, buf: Buffer.from(body, "utf8") };
}

// CHANGELOG の今の版の項に書く行
const shaLine = (sha) => `- 同梱の一式 \`dist/ja-proofread-setup.mjs\` の sha256：\`${sha}\``;
const SHA_LINE_RE = /^- 同梱の一式 `dist\/ja-proofread-setup\.mjs` の sha256：`[0-9a-f]*`$/;

// 今の版の項（## <版>（…） から次の ## の前まで）の位置を返す
function versionSection(lines, version) {
  const start = lines.findIndex((l) => l.startsWith(`## ${version}（`) || l === `## ${version}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return { start, end };
}

function changelogWithSha(text, version, sha) {
  const lines = text.split("\n");
  const sec = versionSection(lines, version);
  if (!sec) return null;
  const i = lines.slice(sec.start, sec.end).findIndex((l) => SHA_LINE_RE.test(l));
  if (i >= 0) lines[sec.start + i] = shaLine(sha);
  else lines.splice(sec.start + 1, 0, shaLine(sha));
  return lines.join("\n");
}

// ここから下が、作るファイルの中身。@@VERSION@@ と @@FILES@@ を置き換える
const SETUP_TEMPLATE = String.raw`#!/usr/bin/env node
// ja-proofread v@@VERSION@@ の同梱の一式。このファイル1つで、校正したいリポジトリの .claude/ に ja-proofread を同梱する。
// plugins/ja-proofread/scripts/build-setup.mjs が作ったファイルです。手で直さないでください。
// 手元にプラグインを入れていなくても動きます（claude.ai/code のクラウドセッションの中でも）。依存はなく、Node だけで動きます。
// 中のファイルの sha256 をすべて確かめてから一時ディレクトリに書き出し、その中の install-into-project.mjs を動かして、一時ディレクトリを消します。
//
//   node ja-proofread-setup.mjs [リポジトリ]            同梱する（省略時はカレントディレクトリ。git の作業コピーの根であること）
//   node ja-proofread-setup.mjs [リポジトリ] --remove   同梱をやめる
//   node ja-proofread-setup.mjs --list                  中のファイルと sha256 を表示する
//   node ja-proofread-setup.mjs --version               版を表示する
import { existsSync, statSync, realpathSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const VERSION = "@@VERSION@@";
// [プラグインの中のパス, sha256, base64]
const FILES = [
@@FILES@@
];

const USAGE = "使い方: node ja-proofread-setup.mjs [リポジトリ] [--remove] | --list | --version";
const fail = (msg, code = 1) => { console.error(msg); process.exit(code); };
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) { console.log(USAGE); process.exit(0); }
if (args.includes("--version")) { console.log(VERSION); process.exit(0); }
if (args.includes("--list")) { for (const [p, sha] of FILES) console.log(sha + "  " + p); process.exit(0); }
const unknown = args.filter((a) => a.startsWith("-") && a !== "--remove");
if (unknown.length) fail("知らないオプションです: " + unknown.join(" ") + "\n" + USAGE, 2);
const pos = args.filter((a) => !a.startsWith("-"));
if (pos.length > 1) fail("リポジトリは1つだけ指定します\n" + USAGE, 2);
const remove = args.includes("--remove");
const target = resolve(pos[0] ?? process.cwd());
if (!existsSync(target) || !statSync(target).isDirectory()) fail(target + " はディレクトリではありません\n" + USAGE, 2);

// git の作業コピーの根でなければ止める（.claude/ はリポジトリの根に置かないと読まれないため）
const git = (a, opts = {}) => spawnSync("git", a, { cwd: target, encoding: "utf8", ...opts });
const top = git(["rev-parse", "--show-toplevel"]);
if (top.error) fail("git が見つかりません。git の作業コピーの根で動かしてください（" + top.error.message + "）");
if (top.status !== 0) fail(target + " は git の作業コピーではありません。校正したいリポジトリの根を指定してください\n" + (top.stderr || "").trim());
const root = top.stdout.trim();
if (realpathSync(root) !== realpathSync(target)) fail(target + " は git の作業コピーの根ではありません。根（" + root + "）を指定してください");

// 書く前に、すべてのファイルの sha256 を確かめる（壊れていれば何も書かない）
const bufs = [];
for (const [p, sha, b64] of FILES) {
  if (typeof p !== "string" || !p || isAbsolute(p) || p.split("/").some((s) => s === ".." || s === "")) fail("中のファイルの名前がおかしいので止めました: " + p);
  const buf = Buffer.from(b64, "base64");
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha) fail(p + " の sha256 が合わないので、何も書かずに止めました（期待 " + sha + "、実際 " + got + "）。このファイルが壊れているので、取り直してください");
  bufs.push([p, buf]);
}

// やめるときにステージするパスは、やめる前の一覧（vendored.json）から作る
const readManifest = () => { try { return JSON.parse(readFileSync(join(target, ".claude", "ja-proofread", "vendored.json"), "utf8")); } catch { return null; } };
const names = (v, re) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && re.test(x)) : []);
const before = readManifest();
// 同梱があるか（install-into-project.mjs と同じ見方：.claude/ja-proofread/ があるか、settings.json に同梱のフックがあるか）。
// やめるときに同梱が無ければ、install-into-project.mjs が「同梱されていません」と出して何も変えないので、コミットの例も出さない
const hasOurHooks = () => {
  try {
    const st = JSON.parse(readFileSync(join(target, ".claude", "settings.json"), "utf8"));
    return Object.values(st?.hooks || {}).some((gs) => Array.isArray(gs) && gs.some((g) => (g?.hooks || []).some((h) => String(h?.command || "").includes(".claude/ja-proofread/scripts/"))));
  } catch { return false; }
};
const vendoredBefore = before !== null || existsSync(join(target, ".claude", "ja-proofread")) || hasOurHooks();

const work = mkdtempSync(join(tmpdir(), "ja-proofread-setup-"));
let status = 1;
try {
  for (const [p, buf] of bufs) {
    const dest = join(work, p);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
  }
  // install-into-project.mjs の「コミットするパス」の行（ja-proofread-* の書き方）は、下で同梱したものの名前だけの行に置き換える
  const r = spawnSync(process.execPath, [join(work, "scripts", "install-into-project.mjs"), target, ...(remove ? ["--remove"] : [])], { stdio: ["inherit", "pipe", "inherit"], encoding: "utf8" });
  process.stdout.write((r.stdout || "").split("\n").filter((l) => !l.startsWith("コミットするパス：")).join("\n"));
  status = r.status ?? 1;
  if (r.error) console.error(r.error.message);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (status !== 0) process.exit(status);
if (remove && !vendoredBefore) process.exit(0);

const q = (s) => (/^[A-Za-z0-9_\/.:@%+=,-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'");
const manifest = remove ? before : readManifest();
const skills = names(manifest?.skills, /^ja-proofread-[A-Za-z0-9_-]+$/);
const agents = names(manifest?.agents, /^ja-proofread-[A-Za-z0-9_.-]+\.md$/);
let paths = [".claude/ja-proofread", ...skills.map((n) => ".claude/skills/" + n), ...agents.map((f) => ".claude/agents/" + f), ".claude/settings.json"];
if (remove) {
  // 消えたもののうち、コミットしていたものだけをステージする（無いパスを git add に渡すと失敗するため）
  paths = paths.filter((p) => existsSync(join(target, p)) || git(["ls-files", "--", p]).stdout.trim());
  console.log("\nコミットするパス：" + (paths.join(" ") || "（なし）"));
  if (paths.length) console.log("コミットしてプッシュする例：\n  cd " + q(target) + " && git add -A -- " + paths.join(" ") + ' && git commit -m "ja-proofread の同梱をやめる" && git push -u origin HEAD');
} else {
  paths.push(".ja-proofread.json");
  const ignored = paths.filter((p) => git(["check-ignore", "-q", "--", p]).status === 0);
  console.log("\nコミットするパス：" + paths.join(" "));
  if (ignored.length) console.log("注意：" + ignored.join(" ") + " は .gitignore で除かれています。.gitignore を直すか、git add -f で足してください");
  console.log("コミットしてプッシュする例：\n  cd " + q(target) + " && git add " + paths.join(" ") + ' && git commit -m "ja-proofread を同梱" && git push -u origin HEAD');
  console.log("プッシュしたら、新しいセッションを始めてください。起動のときの依存の準備（SessionStart のフック）と書いた直後の校正は、新しいセッションから動きます。");
}
`;

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  let built;
  try { built = buildSetup(); } catch (e) { console.error(e.message); process.exit(1); }
  const { version, files, buf } = built;
  const sha = sha256(buf);
  if (args.includes("--check")) {
    const problems = [];
    if (!existsSync(DIST)) problems.push(`${DIST} がありません`);
    else if (!readFileSync(DIST).equals(buf)) problems.push(`dist/ja-proofread-setup.mjs が古いままです（作り直すと sha256 は ${sha}、今のファイルは ${sha256(readFileSync(DIST))}）`);
    const cl = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "";
    const lines = cl.split("\n");
    const sec = versionSection(lines, version);
    if (!sec) problems.push(`CHANGELOG.md に ## ${version} の項がありません`);
    else if (!lines.slice(sec.start, sec.end).includes(shaLine(sha))) problems.push(`CHANGELOG.md の ${version} の項に、sha256 の行（${shaLine(sha)}）がありません`);
    if (problems.length) {
      console.error(problems.map((p) => "- " + p).join("\n") + "\n直すには、plugins/ja-proofread で node scripts/build-setup.mjs を実行してコミットします");
      process.exit(1);
    }
    console.log(`dist/ja-proofread-setup.mjs は最新です（v${version}、${files.length}ファイル、${buf.length}バイト、sha256 ${sha}）`);
    process.exit(0);
  }
  if (outIdx >= 0) {
    const out = args[outIdx + 1];
    if (!out) { console.error("使い方: node build-setup.mjs [--check | --out <パス>]"); process.exit(2); }
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), buf);
    console.log(`${resolve(out)} を作りました（v${version}、${files.length}ファイル、${buf.length}バイト、sha256 ${sha}）`);
    process.exit(0);
  }
  const cl = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : null;
  const next = cl === null ? null : changelogWithSha(cl, version, sha);
  if (next === null) {
    console.error(`CHANGELOG.md に ## ${version} の項がないため、作るのをやめました。先に項を書いてから、もう一度実行してください`);
    process.exit(1);
  }
  mkdirSync(dirname(DIST), { recursive: true });
  writeFileSync(DIST, buf);
  if (next !== cl) writeFileSync(CHANGELOG, next);
  console.log(`dist/ja-proofread-setup.mjs を作りました（v${version}、${files.length}ファイル、${buf.length}バイト）\nsha256 ${sha}（CHANGELOG.md の ${version} の項に書きました）`);
}
