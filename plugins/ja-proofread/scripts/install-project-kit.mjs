#!/usr/bin/env node
// claude.ai/code の Projects で、リポジトリなしに使うための kit を書く。
// Projects のクラウドのスレッドは /mnt/project-files にあるファイルを持って始まるが、.claude/settings.json のフックは読まない。
// そこで、校正に要る一式と、スキル・サブエージェントの手順の本文（パスを kit の場所に置き換えたもの）と、
// プロジェクト指示に貼る文（PROJECT-INSTRUCTIONS.md）を、指定したディレクトリに書く。スレッドは指示に従ってスクリプトを動かす。
// 詳しくは docs/install-projects.md を参照
//
//   node install-project-kit.mjs <kit のディレクトリ>            書く（あれば上書きして版を更新する）
//   node install-project-kit.mjs <kit のディレクトリ> --remove   消す（記録の置き場 ja-proofread-data は残す）
//   node install-project-kit.mjs <kit のディレクトリ> --as <使う場所>
//        手元で作ってプロジェクトの Context にアップロードするとき。手順と指示の中のパスを、使う場所（例：/mnt/project-files/ja-proofread-kit）で書く
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, rmdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { ROOT, readJSON } from "./lib.mjs";

const args = process.argv.slice(2);
const USAGE = "使い方: node install-project-kit.mjs <kit のディレクトリ> [--as <使う場所>] [--remove]";
let asPath = null;
const ai = args.indexOf("--as");
if (ai >= 0) {
  asPath = args[ai + 1];
  if (!asPath || asPath.startsWith("-") || !asPath.startsWith("/")) { console.error("--as のあとに、kit を使う場所を / で始まるパスで指定します（例：--as /mnt/project-files/ja-proofread-kit）\n" + USAGE); process.exit(2); }
  args.splice(ai, 2);
}
const remove = args.includes("--remove");
const pos = args.filter((a) => !a.startsWith("--"));
if (pos.length !== 1 || args.some((a) => a.startsWith("--") && a !== "--remove")) {
  console.error(USAGE);
  process.exit(2);
}
const kitDir = resolve(pos[0]);
// 手順と指示に書く kit の場所（--as があればそこ。無ければ書く場所）
const kit = asPath ? resolve(asPath) : kitDir;
const KIT_NAME = "ja-proofread-kit";
// 記録（検出・誤検知・正規表現の検査の結果）の置き場。kit の隣に置き、kit を入れ替えても消さない
const DATA_REL = "../ja-proofread-data";
const data = resolve(kit, DATA_REL);
// kit が書くもの。入れ替えるときと消すときは、これだけを消す（利用者が kit に置いたほかのファイルは残す）
const MANAGED = ["PROJECT-INSTRUCTIONS.md", "kit.json", "scripts", "rules", "data", "config", "templates", "skills", "agents", "package.json", "package-lock.json"];
// kit では使わないスクリプト（同梱・kit・dist を作るもの、フック）
const SKIP_SCRIPTS = new Set(["build-setup.mjs", "install-into-project.mjs", "install-project-kit.mjs", "hook-post-edit.mjs"]);
// 貼る部分の目安の上限（字）。プロジェクト指示は最大16,000字で、ほかの指示の分を残すため
export const PASTE_LIMIT = 3000;

if (resolve(ROOT) === kitDir) {
  console.error("kit の中のスクリプトからは実行できません。dist/ja-proofread-setup.mjs の --project-kit を使ってください。");
  process.exit(1);
}
if (existsSync(kitDir) && !statSync(kitDir).isDirectory()) {
  console.error(`${kitDir} はディレクトリではないので止めました。`);
  process.exit(1);
}
const current = existsSync(kitDir) ? readJSON(join(kitDir, "kit.json"), null) : null;
const isKit = current && current.name === KIT_NAME;
if (existsSync(kitDir) && !isKit && readdirSync(kitDir).length) {
  console.error(`${kitDir} は空でなく、ja-proofread の kit（kit.json）でもないので、何も変えずに止めました。新しいディレクトリか、前に kit を書いたディレクトリを指定してください。`);
  process.exit(1);
}

if (remove) {
  if (!isKit) {
    console.log(`${kitDir} に ja-proofread の kit はありません。何も変えていません。`);
    process.exit(0);
  }
  for (const e of MANAGED) rmSync(join(kitDir, e), { recursive: true, force: true });
  try { if (!readdirSync(kitDir).length) rmdirSync(kitDir); } catch { /* 消せなくても続ける */ }
  console.log(`ja-proofread の kit を ${kitDir} から消しました。
記録の置き場（${resolve(kitDir, DATA_REL)}）は残しています。要らなければ消してください。
プロジェクト指示（Project settings > Memory > Project instructions）に貼った ja-proofread の部分も消してください。消すまで、新しいスレッドは無い kit を使おうとします。`);
  process.exit(0);
}

const version = readJSON(join(ROOT, ".claude-plugin", "plugin.json"))?.version ?? "?";

// 1. 入れ替える前に、前の版で書いたものを消す
mkdirSync(kitDir, { recursive: true });
for (const e of MANAGED) rmSync(join(kitDir, e), { recursive: true, force: true });

// 2. 校正に要る一式（隠しファイルは書かない。Projects のファイルに隠しファイルを置かないため）
const noHidden = (src) => !basename(src).startsWith(".") || resolve(src) === ROOT;
for (const d of ["rules", "data", "config", "templates"]) cpSync(join(ROOT, d), join(kitDir, d), { recursive: true, filter: noHidden });
mkdirSync(join(kitDir, "scripts"), { recursive: true });
for (const f of readdirSync(join(ROOT, "scripts"))) {
  if (SKIP_SCRIPTS.has(f) || f.startsWith(".")) continue;
  cpSync(join(ROOT, "scripts", f), join(kitDir, "scripts", f), { recursive: true });
}
for (const f of ["package.json", "package-lock.json"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(kitDir, f));

// 3. スキルの手順の本文。スレッドが読んで従えるよう、プラグイン用の変数を kit の場所に置き換える。
//    kit にはサブエージェントが登録されていないので、Agent ツールで起動し、kit の agents の本文を指示として渡す形にする
const agentRef = (name) => `\`${name}\` の役のサブエージェント（Agent ツールで起動し、\`${kit}/agents/${name}.md\` の本文（先頭の --- で囲んだ部分を除く）を役の指示として渡す）`;
const dataNote = `データ置き場は kit の \`kit.json\` で決めてあります（検出と誤検知の記録は \`${data}\`、textlint の依存は \`~/.cache/ja-proofread/deps\`）。環境変数は付けません。`;
for (const name of readdirSync(join(ROOT, "skills"))) {
  const src = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
  const out = src
    .replaceAll('JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" ', "")
    .replace(/^スクリプトは、下のコマンドの形のまま動かします。頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?$/gm, `スクリプトは、下のコマンドの形のまま動かします。${dataNote}`)
    .replace(/頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?/g, "")
    .replaceAll("| プラグインのデータ置き場 |", `| データ置き場（\`${data}\`） |`)
    .replace(/[ \t]*<!-- plugin-only -->[\s\S]*?<!-- \/plugin-only -->\n?/g, "")
    .replace(/`ja-proofread:(structure-reviewer|fresh-eyes-reader)` サブエージェント/g, (_, n) => agentRef(n))
    .replace(/\bja-proofread:(structure-reviewer|fresh-eyes-reader)\b/g, "$1")
    .replace(/（呼ぶときは、この接頭辞つきの名前で指定します）/g, "")
    .replaceAll("${CLAUDE_PLUGIN_ROOT}", kit);
  if (out.includes("${CLAUDE_PLUGIN_")) {
    console.error(`skills/${name}/SKILL.md に、kit で置き換えられない \${CLAUDE_PLUGIN_…} が残っています。`);
    process.exit(1);
  }
  mkdirSync(join(kitDir, "skills", name), { recursive: true });
  writeFileSync(join(kitDir, "skills", name, "SKILL.md"), out);
}

// 4. サブエージェントの本文（役の指示としてそのまま渡す）
cpSync(join(ROOT, "agents"), join(kitDir, "agents"), { recursive: true, filter: noHidden });

// 5. プロジェクト指示に貼る文
const paste = `## 日本語の文書の校正（ja-proofread v${version}）

日本語の文書は、ja-proofread の kit（\`${kit}\`）で校正します。書いた直後に自動で動くフックはないので、次をあなたが毎回実行します。

### 対象
人が読む日本語の文書で、拡張子が \`.md\` か \`.txt\` のもの。スライドなどは作業用の Markdown に書き出してから。\`CHANGELOG.md\`・\`CLAUDE.md\`、\`.claude/\`・\`node_modules/\`・\`.git/\` の下、kit と \`${data}\` の中のファイルは除きます。

### 書いた・直したら毎回
1. \`node "${kit}/scripts/ensure-deps.mjs"\`（スレッドの初回だけ数十秒かかる）
2. \`node "${kit}/scripts/proofread.mjs" <ファイル>\`（スライドや体言止めの多い資料は \`--profile slide\` をファイルの前に付ける）
3. 「必ず」の指摘を直し、2をもう一度実行して「必ず」が0件になってから渡します。「直したい」は文脈を見て直します。誤検知と判断したものは直さず、渡すときにそう書きます。
4. 「textlint が動かなかった」と出たら、表記と文法の指摘は確かめられていないと本人に伝えます。

渡すときは、校正の件数（必ず・直したい・参考）を1行で書きます。

### 書く前
\`${kit}/skills/write/SKILL.md\` を読み、その手順（台帳の型を避けて書く）に従います。

### 仕上げ（「校正して」「出す前に見て」と頼まれたとき）
\`${kit}/skills/proofread/SKILL.md\` の手順に従います。独立レビューと読者役テストは、Agent ツールでサブエージェントを起動して行います。役の指示には \`${kit}/agents/structure-reviewer.md\` と \`${kit}/agents/fresh-eyes-reader.md\` の本文（先頭の --- で囲んだ部分を除く）を使います。

### 新しい型の候補と誤検知
\`${kit}/skills/grow-ledger/SKILL.md\` の手順に従います。Notion の候補一覧（Notion のコネクタ）に登録するのは、本人が頼んだときだけです。台帳のファイル（kit の \`data/\`）は書き換えません。

### データの置き場所
textlint の依存は \`~/.cache/ja-proofread/deps\` に入ります（スレッドごとに入れ直す）。検出と誤検知の記録は \`${data}\` に残ります（スレッドをまたいで残る）。どちらも kit の \`kit.json\` で決めてあるので、環境変数は付けません。`;
const START = "<!-- 貼る部分ここから -->";
const END = "<!-- 貼る部分ここまで -->";
writeFileSync(join(kitDir, "PROJECT-INSTRUCTIONS.md"), `# ja-proofread を Projects で使う（プロジェクト指示に貼る文）

下の「貼る部分ここから」から「貼る部分ここまで」の間（その2行は除く）を、Project settings > Memory > Project instructions に貼ります（プロジェクトの会話で Claude に足してもらってもかまいません）。新しく始めたスレッドから効きます。この kit を入れ替えた（版を上げた）ら、貼った部分も貼り直します。詳しくは https://github.com/andy0911/ja-doc-proofreading/blob/main/docs/install-projects.md を見てください。

${START}
${paste}
${END}
`);
writeFileSync(join(kitDir, "kit.json"), JSON.stringify({ name: KIT_NAME, version, data: DATA_REL, note: "ja-proofread の Projects 向けの kit。dist/ja-proofread-setup.mjs --project-kit が書いた。中を手で直さない（入れ替えると消える）" }, null, 2) + "\n");

const chars = [...paste].length;
console.log(`ja-proofread v${version} の kit を ${kitDir} に書きました。${asPath ? `手順と指示の中のパスは、使う場所の ${kit} で書いています（この場所に置いてから使います）。` : ""}
- 校正の一式: scripts, rules, data, config, templates, package.json, package-lock.json
- 手順の本文: skills/write, skills/proofread, skills/grow-ledger（SKILL.md）、agents/structure-reviewer.md, agents/fresh-eyes-reader.md
- プロジェクト指示に貼る文: PROJECT-INSTRUCTIONS.md（貼る部分は ${chars} 字）
- 記録の置き場: ${data}（使うときに作られ、kit を入れ替えても残ります）
${chars > PASTE_LIMIT ? `注意：貼る部分が ${PASTE_LIMIT} 字を超えています（${chars} 字）\n` : ""}
次に、下の「貼る部分」を Project settings > Memory > Project instructions に貼ってください。新しく始めたスレッドから効きます。

----- 貼る部分ここから -----
${paste}
----- 貼る部分ここまで -----`);
