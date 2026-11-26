#!/usr/bin/env node
// claude.ai のチャット（チャットのプロジェクト）に上げるスキルの zip と、プロジェクトの指示に足す文を作る。
// claude.ai のカスタムスキルは、Customize > Skills で zip を上げて入れる。zip の最上位にフォルダを置き、<name>/SKILL.md とする。
// チャットでは、スキルのフォルダが丸ごとコード実行のサンドボックスに写されるが、サブエージェントとフックは使えない。
// そこで、校正の一式（スクリプト・台帳・辞書・設定・テンプレート・package.json と lock）と、チャット向けに書き直した手順
// （references/）を1つのスキルにまとめる。依存（node_modules）は入れず、実行するときに npm ci で書き込める場所に入れる。
// 詳しくは docs/install-claude-ai.md を参照
//
//   node build-claude-ai-skill.mjs            作る（リポジトリの根の dist/claude-ai/ に書き、CHANGELOG.md の今の版の項に zip の sha256 の行を書く）
//   node build-claude-ai-skill.mjs --check    作り直したものが dist/claude-ai/ のファイルとバイト単位で同じか、CHANGELOG にその sha256 があるかを確かめる
//   node build-claude-ai-skill.mjs --out <ディレクトリ>   ほかの場所に書く（CHANGELOG は変えない）
//
// zip は、中身の順（パスの順）と日時（2026-01-01 00:00）を固定して作るので、同じ中身なら同じ sha256 になる
import { readFileSync, writeFileSync, lstatSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = resolve(ROOT, "..", "..");
const OUT_DIR = join(REPO, "dist", "claude-ai");
const ZIP_NAME = "ja-proofread-skill.zip";
const PI_NAME = "PROJECT-INSTRUCTIONS.md";
const CHANGELOG = join(REPO, "CHANGELOG.md");
export const SKILL_NAME = "ja-proofread";
// スキルでは使わないスクリプト（同梱・kit・一式・このスクリプト、フック）
const SKIP_SCRIPTS = new Set(["build-setup.mjs", "build-claude-ai-skill.mjs", "install-into-project.mjs", "install-project-kit.mjs", "hook-post-edit.mjs"]);
const DIR = "$D";
const BEGIN_LINE = "----- 貼る部分ここから（この行は貼らない） -----";
const END_LINE = "----- 貼る部分ここまで（この行は貼らない） -----";
const END_MARK = "（ja-proofread の指示はここまで）";
const RAW_ZIP = "https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/claude-ai/ja-proofread-skill.zip";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const version = () => JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8")).version;

// 入れるファイルは git が追跡しているもの（git ls-files）で決める（build-setup.mjs と同じ。手元にだけあるファイルを入れると、CI で作り直したものと合わなくなるため）
function tracked() {
  const r = spawnSync("git", ["ls-files", "-z", "--", "scripts", "rules", "data", "config", "templates", "skills", "agents", "package.json", "package-lock.json"], { cwd: ROOT, encoding: "utf8" });
  if (r.error || r.status !== 0) throw new Error(`git ls-files でファイルを決められないので止めました。このリポジトリの git の作業コピーの中で動かしてください（${r.error ? r.error.message : (r.stderr || "").trim()}）`);
  const files = r.stdout.split("\0").filter((p) => p && !p.split("/").some((n) => n.startsWith(".") || n === "node_modules"));
  if (!files.includes("scripts/proofread.mjs")) throw new Error("git が追跡しているファイルに scripts/proofread.mjs がないので止めました。このリポジトリの git の作業コピーの中で動かしてください");
  const bad = files.filter((p) => { try { return !lstatSync(join(ROOT, p)).isFile(); } catch { return true; } });
  if (bad.length) throw new Error(`git が追跡しているのに、ふつうのファイルとして読めないものがあります：${bad.join(" ")}`);
  return files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// SKILL.md（スキルの入口）。claude.ai のチャットで ${CLAUDE_SKILL_DIR} が置き換わるかは分からないので、最初の手順でスキルのフォルダを D に決める。
// 置き換わっていればそれを使う（find は動かさない）。空なら、決まった候補を見て、無いときだけ find（/proc・/sys・/dev は見ない）で探す。
// 候補にするのは、印の skill.json の name が ja-proofread-claude-ai で、version がこの版のものだけ。候補が2つ以上なら止めて、本人に尋ねる
const findD = (v) => `V="${v}"; D="\${CLAUDE_SKILL_DIR}"
ok() { [ -f "$1/scripts/proofread.mjs" ] && grep -q '"name": "ja-proofread-claude-ai"' "$1/skill.json" 2>/dev/null && grep -q "\\"version\\": \\"$V\\"" "$1/skill.json"; }
if [ -z "$D" ]; then
  C=$(for d in /mnt/skills/*/ja-proofread /mnt/skills/ja-proofread "$HOME/.claude/skills/ja-proofread"; do ok "$d" && (cd "$d" && pwd -P); done | sort -u)
  [ -n "$C" ] || C=$(find / \\( -path /proc -o -path /sys -o -path /dev \\) -prune -o -path '*/ja-proofread/skill.json' -print 2>/dev/null | while read -r f; do d=$(dirname "$f"); ok "$d" && (cd "$d" && pwd -P); done | sort -u)
  N=$(printf '%s\\n' "$C" | grep -c .)
  if [ "$N" -eq 1 ]; then D="$C"; elif [ "$N" -gt 1 ]; then echo "ja-proofread のスキルのフォルダの候補が $N 件です:"; printf '%s\\n' "$C"; fi
fi
if [ -n "$D" ] && ok "$D"; then echo "D=$D"; node -v; else echo "ja-proofread（v$V）のスキルのフォルダを決められませんでした"; fi`;
function skillMd(v) {
  return `---
name: ${SKILL_NAME}
description: プロジェクトの指示で日本語の文書の校正を頼まれているとき、または本人が日本語の文書の校正を頼んだとき（「校正して」「AIっぽさを消して」「読みやすいか見て」「出す前に見て」など）に使う。文書をファイルに保存し、textlint と「AIの文章に出やすい型」の台帳で機械チェックして、「必ず直す」の指摘を直してから渡す。依存を入れるのに数十秒かかるので、頼まれていない会話では使わない。
---

# 日本語の文書の校正（ja-proofread v${v}、claude.ai のチャット向け）

このスキルのフォルダ（この SKILL.md があるフォルダ）に、校正のスクリプト（\`scripts/\`）、台帳と表記の辞書（\`data/\`）、手順の本文（\`references/\`）があります。下と references/ では、このフォルダを \`${DIR}\` と書きます。スキルのフォルダには書き込みません（書けないことがあるため）。依存と記録は、書き込める場所（\`~/.cache/ja-proofread\`、書けなければ一時ディレクトリの下）にスクリプトが置きます。環境変数 \`JA_PROOFREAD_DATA\` は付けません。

## 毎回の校正（日本語の文書を書いた・直したら）

1. スキルのフォルダを決め、Node が動くか確かめます。次を、そのまま実行します。
   \`\`\`bash
${findD(v).split("\n").map((l) => "   " + l).join("\n")}
   \`\`\`
   \`D=…\` の行が出たら、そのパスがスキルのフォルダです。一度決めた D は、同じ会話の中で使い回し、1をもう一度実行しません。下のコマンドの \`${DIR}\` は、毎回、先頭に \`D="<そのパス>";\` を付けて実行します（コマンドごとにシェルが変わっても動くように）。
   - 「候補が N 件です」と出たら（2件以上）、どれも使わずに止め、表示されたパスを本人に見せて、どれを使うか尋ねます。
   - 「決められませんでした」と出たら、スキルが見つからないので、校正したことにせず、校正できなかったと伝えます。
   - \`node -v\` が失敗したときは、下の「コード実行や Node が使えないとき」に従います。
2. 書いた文書を、作業用のファイル（例：\`/tmp/ja-proofread-work/文書.md\`）に Markdown で保存します。アーティファクトや返答で渡す文書は、その本文を保存します。スライドは、1枚を \`## 番号 見出し\` の節にして書き出します。
3. 依存を入れてから校正します。依存は会話の最初だけ数十秒かかります。スライドや体言止めの多い資料は、\`--profile slide\` をファイルの前に付けます。
   \`\`\`bash
   D="<1のパス>"; node "${DIR}/scripts/ensure-deps.mjs" && node "${DIR}/scripts/proofread.mjs" /tmp/ja-proofread-work/文書.md
   \`\`\`
4. 「必ず」の指摘を直し、元の文書（アーティファクト・ファイル・返答）にも同じ直しを入れて、3の proofread をもう一度実行します。誤検知と判断したもの以外の「必ず」が0件になってから渡します。誤検知と判断したものは直さず、渡すときにそう書きます。「直したい」は文脈を見て直します。
5. 渡すときに、校正の件数（必ず・直したい・参考、直す前 → 直した後）を1行で伝えます。

「textlint が動かなかった」と出たら、表記と文法の指摘は確かめられていないと伝えます。

## コード実行や Node が使えないとき、依存が入らないとき

- Node はあるが依存が入らない（npm が無い、registry.npmjs.org に届かない）：proofread.mjs はそのまま動き、構成の型と件数で数える型だけを点検します。件数を伝えるときに、textlint は動かなかったと書きます。
- コード実行や Node が使えない：校正はできません。校正したとは書かず、校正できなかった（textlint もスクリプトも動かなかった）と伝えます。代わりに、\`${DIR}/data/ledger.json\`（台帳の型）と \`${DIR}/data/prh.yml\`（表記の辞書）を読んで文書を点検してもかまいませんが、それは「目で見た点検」として伝え、校正の件数は書きません。

## 書く前（新しく書くとき）

\`${DIR}/references/write.md\` を読み、その手順（台帳の型を避けて書く）に従います。

## 仕上げ（「校正して」「出す前に見て」と頼まれたときだけ）

\`${DIR}/references/proofread.md\` の手順に従います。チャットではサブエージェントを使えないので、構成の型の点検（独立レビュー）と読者役テストは、同じ会話の中で、\`${DIR}/references/agents/\` の役の指示に従って行います。書いた本人と同じ会話なので、独立性は低くなります。本人には「対象の文書と役の指示を別の会話に貼って読ませると、独立性が上がる」と伝えます。

## 新しい型の候補と誤検知

\`${DIR}/references/grow-ledger.md\` の手順に従います。新しい型の候補を Notion の候補一覧（Notion のコネクタ）に登録するのは、本人が頼んだときだけです。台帳のファイル（\`data/\`）は書き換えません。

## 記録

検出と誤検知の記録は \`~/.cache/ja-proofread\`（書けなければ一時ディレクトリの下の、自分だけが使える \`ja-proofread-cache-<uid>\`）に残ります。会話をまたいで残るかは分からないので、残らない前提で使います。
`;
}

// プロジェクトの指示に足す文
function pasteText(v) {
  return `## 日本語の文書の校正（ja-proofread v${v}）

このプロジェクトで日本語の文書を書いたら、ja-proofread スキルで毎回校正してから渡します。

- 対象：アーティファクト、作ったファイル、文書として渡す長めの返答（報告・説明・お知らせ・メールの文案など）。短い返事やふだんの会話は対象にしません。
- 手順：ja-proofread スキルの SKILL.md の「毎回の校正」に従います。文書をファイルに保存し、ensure-deps と proofread を実行し、誤検知と判断したもの以外の「必ず」を直してから渡します。渡すときに、校正の件数（必ず・直したい・参考）を1行で書きます。
- 新しく書く前は、スキルの references/write.md を読み、台帳の型を避けて書きます。
- 「校正して」「出す前に見て」と頼まれたときだけ、references/proofread.md の仕上げ（構成の型の点検と読者役）を、同じ会話の中で行います。
- ja-proofread スキルが見つからない、コード実行や Node が使えないときは、校正したとは書かず、校正できなかった（textlint が動かなかった）と伝えます。スキルの台帳と辞書を読んで点検してもかまいませんが、校正の件数は書きません。
- 依存が入らず textlint だけが動かないときは、できた点検の件数を書き、textlint は動かなかったと添えます。
- 新しい型の候補を Notion の候補一覧に登録するのは、本人が頼んだときだけです。

${END_MARK}`;
}

function piFile(v) {
  return `# ja-proofread を claude.ai のチャットのプロジェクトで使う（プロジェクトの指示に足す文）

先に、ja-proofread のスキル（ja-proofread-skill.zip）を Customize > Skills で上げておきます。そのあと、下の「${BEGIN_LINE}」と「${END_LINE}」の2行の間（その2行は除く）を、プロジェクトの指示（Instructions）に足します。スキルを新しい版に上げ直したら、前の版の部分を「${END_MARK}」の行まで消してから、新しい版のものを足します。やめるときも、その行まで消します。詳しくは https://github.com/andy0911/ja-doc-proofreading/blob/main/docs/install-claude-ai.md を見てください。

${BEGIN_LINE}
${pasteText(v)}
${END_LINE}
`;
}

const DIR_NOTE = `この文書の \`${DIR}\` は、このスキルのフォルダ（SKILL.md があるフォルダ）です。SKILL.md の「毎回の校正」の1で決めたパスを使い、コマンドは先頭に \`D="<そのパス>";\` を付けて実行します。`;

// 役の指示（agents/）を、チャット向けにする。Claude Code 向けの frontmatter（name・description・tools）は消す
function chatAgent(name, src) {
  const body = src.replace(/^---\n[\s\S]*?\n---\n\n?/, "");
  if (/^---\n/.test(body) || /\btools:/.test(body.split("\n").slice(0, 3).join("\n"))) throw new Error(`references/agents/${name} の frontmatter を外せませんでした`);
  return `<!-- ja-proofread の役の指示（${name.replace(/\.md$/, "")}）。チャットでは、同じ会話の中でこの指示を読み、書き手の立場を離れて行う。別の会話に貼って読ませると独立性が上がる。 -->\n\n` + body;
}

// templates/ のうち、チャットで読み替えが要るもの
function chatTemplate(p, buf) {
  if (p !== "templates/reader-test.md") return buf;
  const src = buf.toString("utf8");
  const re = /2〜3体を、別々の `fresh-eyes-reader` サブエージェントとして起動します（[^）]*）。/;
  if (!re.test(src)) throw new Error("templates/reader-test.md の、読者役を起動する文が見つかりません（チャット向けに書き直せません）");
  const out = src.replace(re, `読者役を2〜3人分、1人ずつ順に行います。チャットではサブエージェントを使えないので、同じ会話の中で、\`${DIR}/references/agents/fresh-eyes-reader.md\` を役の指示として読み、書き手の立場を離れて読みます（${DIR} はスキルのフォルダ。対象の文書と役の指示を別の会話に貼って読ませると、独立性が上がります）。`);
  if (/サブエージェントとして起動|ja-proofread:/.test(out)) throw new Error("templates/reader-test.md に、サブエージェントの名前が残っています");
  return Buffer.from(out, "utf8");
}

// 手順の本文（プラグインのスキル）を、チャット向けに書き直す
function chatReference(name, src) {
  const refOf = (n) => `\`${DIR}/references/${n}.md\` の手順`;
  const roleRef = (n) => `\`${n}\` の役（\`${DIR}/references/agents/${n}.md\`）`;
  const roleNote = `チャットでの読み替え：チャットではサブエージェントを使えません。下で「サブエージェント」「起動」「〜体」とある役は、同じ会話の中で、その役の指示（\`${DIR}/references/agents/\` の下の .md）を読み、書き手の立場を離れて、1役ずつ順に行います。渡すものは、役の指示に書いたものだけにします。書いた本人と同じ会話なので独立性は低くなります。本人には「対象の文書と役の指示を別の会話に貼って読ませると、独立性が上がる」と伝えます。`;
  const dataNote = "検出と誤検知の記録は `~/.cache/ja-proofread`（書けなければ一時ディレクトリの下の、自分だけが使える `ja-proofread-cache-<uid>`）に残ります。会話をまたいで残るかは分からないので、残らない前提で使います。環境変数 `JA_PROOFREAD_DATA` は付けません。";
  let out = src
    .replace(/^---\n[\s\S]*?\n---\n\n?/, "")
    .replaceAll('JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" ', "")
    .replace(/^スクリプトは、下のコマンドの形のまま動かします。頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?$/gm, `スクリプトは、下のコマンドの形のまま動かします。${dataNote}`)
    .replace(/頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?/g, "")
    .replaceAll("| プラグインのデータ置き場 |", "| 記録の置き場（`~/.cache/ja-proofread`。会話をまたいで残らない前提） |")
    .replace(/[ \t]*<!-- plugin-only -->[\s\S]*?<!-- \/plugin-only -->\n?/g, "")
    .replace(/`ja-proofread:(structure-reviewer|fresh-eyes-reader)` サブエージェント/g, (_, n) => roleRef(n))
    .replace(/\bja-proofread:(structure-reviewer|fresh-eyes-reader)\b/g, "$1")
    .replace(/（呼ぶときは、この接頭辞つきの名前で指定します）/g, "")
    .replace(/、または ?(?:プロジェクトの設定 ?|`\.ja-proofread\.json` の )`notion\.autoRegisterCandidates` が `true` のとき/g, "")
    .replace(/## 4\. 書き終えたら\n\n[^\n]*\n?/, `## 4. 書き終えたら\n\n\`${DIR}/SKILL.md\` の「毎回の校正」を行います（機械チェックと「必ず」の修正）。構成の型の点検と読者役テストを含む仕上げ（${refOf("proofread")}）は、本人に頼まれたときだけ行います。\n`)
    .replace(/`?(write|proofread|grow-ledger)`? スキル/g, (_, n) => refOf(n))
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", DIR);
  if (name === "grow-ledger") {
    out = out
      .replace(/## C\. 承認された候補を反映する（戻す）\n/, "## C. 承認された候補を反映する（戻す）\n\nこの段階は、チャットではできません。このマーケットプレイスのリポジトリの作業コピー（Claude Code）で行います。下は、その手順です。\n")
      .replace(/## E\. 配る[\s\S]*$/, `## E. 配る（claude.ai のスキルを新しい版にする）

台帳が育ったとき（新しい版が出たとき）は、新しい zip（${RAW_ZIP}）を取り、Customize > Skills で ja-proofread を上げ直します。プロジェクトの指示に足した部分も、新しい版の PROJECT-INSTRUCTIONS.md のものに置き換えます（「${END_MARK}」の行まで消してから足す）。手順は docs/install-claude-ai.md にあります。
`);
  }
  const head = { write: "書く前の準備", proofread: "仕上げ（頼まれたときだけ）", "grow-ledger": "台帳を育てる" }[name] || name;
  out = `<!-- ja-proofread のプラグインの ${name} スキルを、claude.ai のチャット向けに書き直したもの（${head}）。 -->\n\n${DIR_NOTE}\n\n` + out;
  if (name === "proofread") out = out.replace(/^(# [^\n]*\n\n)/m, `$1${roleNote}\n\n`);
  if (out.includes("${CLAUDE_PLUGIN_")) throw new Error(`references/${name}.md に、置き換えられない \${CLAUDE_PLUGIN_…} が残っています`);
  if (/autoRegisterCandidates/.test(out)) throw new Error(`references/${name}.md に、Notion への自動の登録の記述が残っています`);
  return out;
}

// zip に入れるもの（パス → 中身）。パスは ja-proofread/ から始まる
export function skillEntries() {
  const v = version();
  const files = new Map();
  const add = (rel, buf) => files.set(`${SKILL_NAME}/${rel}`, Buffer.isBuffer(buf) ? buf : Buffer.from(buf, "utf8"));
  add("SKILL.md", skillMd(v));
  add("skill.json", JSON.stringify({ name: "ja-proofread-claude-ai", version: v, note: "ja-proofread を claude.ai のチャットのスキルとして使うための印（SKILL.md の手順で、スキルのフォルダを探すのにも使う）。依存と記録はスキルのフォルダに書かず、~/.cache/ja-proofread（書けなければ一時ディレクトリ）に置く" }, null, 2) + "\n");
  const list = tracked();
  for (const p of list) {
    const [top, ...rest] = p.split("/");
    if (["rules", "data", "config", "templates"].includes(top) || p === "package.json" || p === "package-lock.json") add(p, chatTemplate(p, readFileSync(join(ROOT, p))));
    else if (top === "scripts" && rest.length === 1 && !SKIP_SCRIPTS.has(rest[0])) add(p, readFileSync(join(ROOT, p)));
    else if (top === "skills" && rest.length === 2 && rest[1] === "SKILL.md") add(`references/${rest[0]}.md`, chatReference(rest[0], readFileSync(join(ROOT, p), "utf8")));
    else if (top === "agents" && rest.length === 1) add(`references/agents/${rest[0]}`, chatAgent(rest[0], readFileSync(join(ROOT, p), "utf8")));
  }
  return { version: v, files: new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) };
}

// CRC-32（zip の各ファイルに要る）
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// 決まった順と日時で zip を作る（ディレクトリの項目も入れる。ファイルは deflate、日時は 2026-01-01 00:00）
export function makeZip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  const dirs = new Set();
  for (const p of files.keys()) { const parts = p.split("/"); for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/") + "/"); }
  const entries = [...[...dirs].map((d) => [d, null]), ...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const isDir = data === null;
    const raw = isDir ? Buffer.alloc(0) : data;
    const comp = isDir ? raw : deflateRawSync(raw, { level: 9 });
    const method = isDir ? 0 : 8;
    const crc = isDir ? 0 : crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(isDir ? 0x10 : 0, 36);
    central.writeUInt32LE((((isDir ? 0o40755 : 0o100644) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

export function buildClaudeAi() {
  const { version: v, files } = skillEntries();
  const zip = makeZip(files);
  const pi = Buffer.from(piFile(v), "utf8");
  return { version: v, files, zip, pi, paste: pasteText(v) };
}

// CHANGELOG の今の版の項に書く行
const shaLine = (sha) => `- claude.ai のスキル \`dist/claude-ai/ja-proofread-skill.zip\` の sha256：\`${sha}\``;
const SHA_LINE_RE = /^- claude\.ai のスキル `dist\/claude-ai\/ja-proofread-skill\.zip` の sha256：`[0-9a-f]*`$/;
function versionSection(lines, v) {
  const start = lines.findIndex((l) => l.startsWith(`## ${v}（`) || l === `## ${v}`);
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end < 0) end = lines.length;
  return { start, end };
}
function changelogWithSha(text, v, sha) {
  const lines = text.split("\n");
  const sec = versionSection(lines, v);
  if (!sec) return null;
  const i = lines.slice(sec.start, sec.end).findIndex((l) => SHA_LINE_RE.test(l));
  if (i >= 0) lines[sec.start + i] = shaLine(sha);
  else {
    // 一式の sha256 の行があれば、その次に置く
    const j = lines.slice(sec.start, sec.end).findIndex((l) => l.startsWith("- 同梱の一式 `dist/ja-proofread-setup.mjs` の sha256"));
    lines.splice(sec.start + (j >= 0 ? j + 1 : 1), 0, shaLine(sha));
  }
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let built;
  try { built = buildClaudeAi(); } catch (e) { console.error(e.message); process.exit(1); }
  const { version: v, files, zip, pi, paste } = built;
  const sha = sha256(zip);
  const info = `v${v}、${files.size}ファイル、${zip.length}バイト、sha256 ${sha}、貼る部分 ${[...paste].length}字`;
  if (args.includes("--check")) {
    const problems = [];
    const zp = join(OUT_DIR, ZIP_NAME), pp = join(OUT_DIR, PI_NAME);
    if (!existsSync(zp) || !readFileSync(zp).equals(zip)) problems.push(`dist/claude-ai/${ZIP_NAME} が無いか古いままです（作り直すと sha256 は ${sha}）`);
    if (!existsSync(pp) || !readFileSync(pp).equals(pi)) problems.push(`dist/claude-ai/${PI_NAME} が無いか古いままです`);
    const lines = (existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : "").split("\n");
    const sec = versionSection(lines, v);
    if (!sec) problems.push(`CHANGELOG.md に ## ${v} の項がありません`);
    else if (!lines.slice(sec.start, sec.end).includes(shaLine(sha))) problems.push(`CHANGELOG.md の ${v} の項に、sha256 の行（${shaLine(sha)}）がありません`);
    if (problems.length) {
      console.error(problems.map((p) => "- " + p).join("\n") + "\n直すには、plugins/ja-proofread で node scripts/build-claude-ai-skill.mjs を実行してコミットします");
      process.exit(1);
    }
    console.log(`dist/claude-ai/ は最新です（${info}）`);
    process.exit(0);
  }
  const oi = args.indexOf("--out");
  if (oi >= 0) {
    const out = args[oi + 1];
    if (!out) { console.error("使い方: node build-claude-ai-skill.mjs [--check | --out <ディレクトリ>]"); process.exit(2); }
    mkdirSync(resolve(out), { recursive: true });
    writeFileSync(join(resolve(out), ZIP_NAME), zip);
    writeFileSync(join(resolve(out), PI_NAME), pi);
    console.log(`${resolve(out)} に ${ZIP_NAME} と ${PI_NAME} を作りました（${info}）`);
    process.exit(0);
  }
  const cl = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, "utf8") : null;
  const next = cl === null ? null : changelogWithSha(cl, v, sha);
  if (next === null) { console.error(`CHANGELOG.md に ## ${v} の項がないため、作るのをやめました。先に項を書いてから、もう一度実行してください`); process.exit(1); }
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, ZIP_NAME), zip);
  writeFileSync(join(OUT_DIR, PI_NAME), pi);
  if (next !== cl) writeFileSync(CHANGELOG, next);
  console.log(`dist/claude-ai/${ZIP_NAME} と ${PI_NAME} を作りました（${info}）\n（CHANGELOG.md の ${v} の項に sha256 を書きました）`);
}
