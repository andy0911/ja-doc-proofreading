#!/usr/bin/env node
// claude.ai/code の Projects で、リポジトリなしに使うための kit を書く。
// Projects のクラウドのスレッドは /mnt/project-files にあるファイルを持って始まるが、.claude/settings.json のフックは読まない。
// そこで、校正に要る一式と、スキル・サブエージェントの手順の本文（パスを kit の場所に置き換えたもの）と、
// プロジェクト指示に足す文（PROJECT-INSTRUCTIONS.md）を、指定したディレクトリに書く。スレッドは指示に従ってスクリプトを動かす。
// 詳しくは docs/install-projects.md を参照
//
//   node install-project-kit.mjs <kit のディレクトリ>            書く（前に書いた kit なら、新しい版に入れ替える）
//   node install-project-kit.mjs <kit のディレクトリ> --remove   消す（記録の置き場 ja-proofread-data は残す）
//   node install-project-kit.mjs <kit のディレクトリ> --as <使う場所>
//        手元で作ってプロジェクトの Context にアップロードするとき。手順と指示の中のパスを、使う場所（例：/mnt/project-files/ja-proofread-kit）で書く
//
// 消すのは、kit.json の files に並べた（kit が書いた）ファイルのうち、中身が変わっていないものだけ。
// 本人が置いたファイルと、書いたあとに変わったファイルは残す（入れ替えで同じ名前に書くときは、元のファイルを別の名前で残す）。
// 書くのは、まだないか空のディレクトリ、または前に書いた kit で、名前に kit という語を含むときだけ。
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, rmdirSync, readdirSync, statSync, lstatSync, renameSync, mkdtempSync } from "node:fs";
import { join, resolve, basename, dirname, relative, sep } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { ROOT, readJSON, KIT_DATA_REL } from "./lib.mjs";

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
const data = resolve(kit, KIT_DATA_REL);
// kit が書く、kit の直下の名前
const TOP = new Set(["PROJECT-INSTRUCTIONS.md", "kit.json", "kit.sha256", "scripts", "rules", "data", "config", "templates", "skills", "agents", "package.json", "package-lock.json"]);
// 照らし合わせ（kit.sha256）に入れないもの。kit.sha256 の値は PROJECT-INSTRUCTIONS.md に書き、kit.json にはそれ以外の全部の値を書くため
const NOT_IN_SUMS = new Set(["kit.json", "kit.sha256", "PROJECT-INSTRUCTIONS.md"]);
// kit では使わないスクリプト（同梱・kit・dist を作るもの、フック）
const SKIP_SCRIPTS = new Set(["build-setup.mjs", "install-into-project.mjs", "install-project-kit.mjs", "hook-post-edit.mjs"]);
// 入れ替えの途中のものを書く一時ディレクトリ（kit の中。同じファイルシステムで名前を変えて入れ替えるため）
const STAGE_PREFIX = ".ja-proofread-kit-new-";
const RAW = "https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs";
const BEGIN_LINE = "----- 貼る部分ここから（この行は貼らない） -----";
const END_LINE = "----- 貼る部分ここまで（この行は貼らない） -----";
const END_MARK = "（ja-proofread の指示はここまで）";

const stop = (msg, code = 1) => { console.error(msg); process.exit(code); };
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const listNames = (names, max = 10) => names.slice(0, max).join("、") + (names.length > max ? ` ほか ${names.length - max} 件` : "");

// 1. 書く場所を確かめる
// パスは手順の中で "…" に入れてシェルに渡すので、" $ ` \ と改行を含むものは使わない
const ROOTS = new Set(["/", "/mnt", "/mnt/project-files", "/tmp", resolve(homedir())]);
for (const [what, p] of [["kit の場所", kitDir], ["--as の場所", kit]]) {
  if (/["$`\\\r\n]/.test(p)) stop(`${what}（${p}）に " $ \` \\ や改行が入っています。手順の中でシェルに渡すので、これらを含まないパスにしてください。`);
  if (ROOTS.has(p)) stop(`${what}に ${p} は使えません。その下に kit 用のディレクトリを作って指定してください（例：/mnt/project-files/ja-proofread-kit）。`);
  // kit は区切られた語として入っていること（ja-proofread-kit、kit、my-kit。toolkit や kitchen は不可）
  if (!/(^|[^a-z0-9])kit([^a-z0-9]|$)/i.test(basename(p))) stop(`${what}（${p}）の名前に、kit という語が入っていません。ほかのファイルと混ざらないよう、名前に kit を区切って含むディレクトリを指定してください（例：/mnt/project-files/ja-proofread-kit）。`);
}
if (asPath && basename(kit) !== basename(kitDir)) console.error(`注意：書く場所の名前（${basename(kitDir)}）と --as の名前（${basename(kit)}）が違います。アップロードしたあとの場所が --as と同じになるか確かめてください。`);
if (resolve(ROOT) === kitDir) stop("kit の中のスクリプトからは実行できません。dist/ja-proofread-setup.mjs の --project-kit を使ってください。");
if (existsSync(kitDir) && !statSync(kitDir).isDirectory()) stop(`${kitDir} はディレクトリではないので止めました。`);

const entries = existsSync(kitDir) ? readdirSync(kitDir).filter((n) => !n.startsWith(STAGE_PREFIX)) : [];
const current = existsSync(join(kitDir, "kit.json")) ? readJSON(join(kitDir, "kit.json"), null) : null;
const hasKitJson = isObject(current) && current.name === KIT_NAME;
const foreignKitJson = existsSync(join(kitDir, "kit.json")) && !hasKitJson;
// kit.json がなくても、kit.sha256 があり、直下が kit の名前のものだけなら kit とみなす（入れ替えの途中で止まったときなど）
const looksKit = !hasKitJson && !foreignKitJson && entries.includes("kit.sha256") && entries.every((n) => TOP.has(n));
const isKit = hasKitJson || looksKit;
if (entries.length && !isKit) {
  stop(`${kitDir} は空でなく、ja-proofread の kit（kit.json）でもないので、何も変えずに止めました。新しいディレクトリか、前に kit を書いたディレクトリを指定してください。`);
}
// kit.json の files（kit からの相対パス → sha256）。前の版（0.1.10）の kit には無い
const safeRel = (rel) => typeof rel === "string" && /^[A-Za-z0-9._\-/]+$/.test(rel) && !rel.split("/").some((x) => x === ".." || x === "." || x === "");
const oldFiles = hasKitJson && isObject(current.files)
  ? Object.fromEntries(Object.entries(current.files).filter(([rel, h]) => safeRel(rel) && typeof h === "string"))
  : null;

// 前に入れ替えの途中で止まったときの一時ディレクトリは消す
for (const n of existsSync(kitDir) ? readdirSync(kitDir) : []) if (n.startsWith(STAGE_PREFIX)) rmSync(join(kitDir, n), { recursive: true, force: true });

const version = readJSON(join(ROOT, ".claude-plugin", "plugin.json"))?.version ?? "?";

function walkFiles(dir, base = dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const st = lstatSync(p);
    if (st.isDirectory()) out.push(...walkFiles(p, base));
    else out.push(relative(base, p).split(sep).join("/"));
  }
  return out.sort();
}

// ファイルを消し、そのあと空になった親のディレクトリも消す（kit の場所そのものは残す）
const touchedDirs = new Set();
function removeFile(rel) {
  rmSync(join(kitDir, rel), { force: true });
  for (let d = dirname(rel); d && d !== "."; d = dirname(d)) touchedDirs.add(d);
}
function pruneDirs() {
  for (const d of [...touchedDirs].sort((a, b) => b.split("/").length - a.split("/").length)) {
    try { if (!readdirSync(join(kitDir, d)).length) rmdirSync(join(kitDir, d)); } catch { /* 無い・空でない */ }
  }
}
// 中身が kit の書いたとおり（files の値か、これから書くものと同じ）なら true
function unchanged(rel, ...hashes) {
  try { if (!lstatSync(join(kitDir, rel)).isFile()) return false; } catch { return false; }
  const h = sha(join(kitDir, rel));
  return hashes.some((x) => x && x === h);
}

function pasteText(sumsHash) {
  return `## 日本語の文書の校正（ja-proofread v${version}）

日本語の文書は、ja-proofread の kit（\`${kit}\`）で校正します。書いた直後に自動で動くフックはないので、次をあなたが毎回実行します。kit が見つからないとき（自分のコンピューターで動くスレッドなど）は校正せず、校正できなかったと本人に伝えます。

### 対象
人が読む日本語の文書で、拡張子が \`.md\` か \`.txt\` のもの。スライドなどは作業用の Markdown に書き出してから。\`CHANGELOG.md\`・\`CLAUDE.md\`、\`.claude/\`・\`node_modules/\`・\`.git/\` の下、kit と \`${data}\` の中のファイルは除きます。

### 書いた・直したら毎回
1. kit が書き換えられていないかを照らし合わせてから、依存を入れて校正します（依存はスレッドの初回だけ数十秒かかる。スライドや体言止めの多い資料は \`--profile slide\` をファイルの前に付ける）。
   \`\`\`
   (cd "${kit}" && echo "${sumsHash}  kit.sha256" | sha256sum -c --quiet - && sha256sum -c --quiet kit.sha256) && node "${kit}/scripts/ensure-deps.mjs" && node "${kit}/scripts/proofread.mjs" <ファイル>
   \`\`\`
   照らし合わせ（sha256sum）が合わないときは、校正せず、kit が書き換えられたか、kit の版がこの指示と違う（貼り直しが要る）ことを本人に伝えます。
2. 「必ず」の指摘を直し、proofread をもう一度実行します。誤検知と判断したもの以外の「必ず」が0件になってから渡します。誤検知と判断したものは直さず、渡すときにそう書きます。「直したい」は文脈を見て直します。
3. 「textlint が動かなかった」と出たら、表記と文法の指摘は確かめられていないと本人に伝えます。
4. 作業しているディレクトリに \`.ja-proofread.json\` があれば、その設定が使われ、「設定 … を使いました」の1行が出ます。出たら、止めた規則で指摘が減っていることがあるので、そのことを本人に1行で伝えます。読めないと校正が止まるので、そのときも伝えます。

渡すときは、校正の件数（必ず・直したい・参考）を1行で書きます。

### 書く前
\`${kit}/skills/write/SKILL.md\` を読み、その手順（台帳の型を避けて書く）に従います。

### 仕上げ（「校正して」「出す前に見て」と頼まれたときだけ）
\`${kit}/skills/proofread/SKILL.md\` の手順に従います。独立レビューと読者役テストは、Agent ツールで、読むだけの種類（Explore など）のサブエージェントを起動して行います。読むだけの種類が使えなければ、汎用の種類で、ファイルを書き換えないよう頼みます。役の指示には \`${kit}/agents/structure-reviewer.md\` と \`${kit}/agents/fresh-eyes-reader.md\` の本文（先頭の --- で囲んだ部分を除く）を使います。

### 新しい型の候補と誤検知
\`${kit}/skills/grow-ledger/SKILL.md\` の手順に従います。Notion の候補一覧（Notion のコネクタ）に登録するのは、本人が頼んだときだけです。kit の中のファイルは書き換えません。

### データの置き場所
検出と誤検知の記録は \`${data}\` に残ります（スレッドをまたいで残る）。textlint の依存は \`~/.cache/ja-proofread/deps\` に入ります（スレッドごとに入れ直す）。環境変数 \`JA_PROOFREAD_DATA\` は付けません（付けると、どちらもその下に変わる）。

${END_MARK}`;
}

// 2. 新しい版の kit を一時ディレクトリに作る
function buildStage(stage) {
  const noHidden = (src) => !basename(src).startsWith(".") || resolve(src) === ROOT;
  for (const d of ["rules", "data", "config", "templates"]) cpSync(join(ROOT, d), join(stage, d), { recursive: true, filter: noHidden });
  mkdirSync(join(stage, "scripts"), { recursive: true });
  for (const f of readdirSync(join(ROOT, "scripts"))) {
    if (SKIP_SCRIPTS.has(f) || f.startsWith(".")) continue;
    cpSync(join(ROOT, "scripts", f), join(stage, "scripts", f), { recursive: true });
  }
  for (const f of ["package.json", "package-lock.json"]) if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(stage, f));

  // スキルの手順の本文。スレッドが読んで従えるよう、プラグイン用の変数を kit の場所に、スキルの名前をファイルのパスに置き換える。
  // kit にはサブエージェントが登録されていないので、Agent ツールで起動し、kit の agents の本文を指示として渡す形にする
  const skillRef = (n) => `\`${kit}/skills/${n}/SKILL.md\` の手順`;
  const agentRef = (name) => `\`${name}\` の役のサブエージェント（Agent ツールで、読むだけの種類（Explore など）で起動し、\`${kit}/agents/${name}.md\` の本文（先頭の --- で囲んだ部分を除く）を役の指示として渡す。読むだけの種類が使えなければ、汎用の種類で、ファイルを書き換えないよう頼む）`;
  const dataNote = `検出と誤検知の記録は \`${data}\` に残ります（kit に \`kit.json\` があると、スクリプトは kit の隣を記録の置き場にします）。textlint の依存は \`~/.cache/ja-proofread/deps\` に入ります。環境変数 \`JA_PROOFREAD_DATA\` を付けると、どちらもその下に変わるので付けません。`;
  const kitUpdate = `## E. 配る（kit を新しい版にする）

この kit を新しい版にするときは、どれかのスレッドで次の1行を実行します。そのあと、プロジェクト指示の ja-proofread の部分を「${END_MARK}」の行まで消し、新しい版の \`PROJECT-INSTRUCTIONS.md\` の貼る部分を足します。kit の照らし合わせの値は版ごとに変わるので、貼り直さないと、次のスレッドからの校正が照らし合わせで止まります。

\`\`\`bash
curl -fsSLo /tmp/ja-proofread-setup.mjs ${RAW} && node /tmp/ja-proofread-setup.mjs --project-kit "${kit}"
\`\`\`

この1行は、その時点の \`main\` の版を信じて使うことになります。版を固定するときは、docs/install-projects.md の「版を固定する」を見てください。台帳への反映（C）は、このマーケットプレイスのリポジトリの作業コピーで行い、kit の中ではしません。
`;
  for (const name of readdirSync(join(ROOT, "skills"))) {
    const src = readFileSync(join(ROOT, "skills", name, "SKILL.md"), "utf8");
    let out = src
      .replaceAll('JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" ', "")
      .replace(/^スクリプトは、下のコマンドの形のまま動かします。頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?$/gm, `スクリプトは、下のコマンドの形のまま動かします。${dataNote}`)
      .replace(/頭の `JA_PROOFREAD_DATA=…` は[^。]*。(?:外すと[^。]*。)?/g, "")
      .replaceAll("| プラグインのデータ置き場 |", `| 記録の置き場（\`${data}\`） |`)
      .replace(/[ \t]*<!-- plugin-only -->[\s\S]*?<!-- \/plugin-only -->\n?/g, "")
      .replace(/`ja-proofread:(structure-reviewer|fresh-eyes-reader)` サブエージェント/g, (_, n) => agentRef(n))
      .replace(/\bja-proofread:(structure-reviewer|fresh-eyes-reader)\b/g, "$1")
      .replace(/（呼ぶときは、この接頭辞つきの名前で指定します）/g, "")
      // Notion への自動の登録はしない（kit では、登録は本人が頼んだときだけ）
      .replace(/、または ?(?:プロジェクトの設定 ?|`\.ja-proofread\.json` の )`notion\.autoRegisterCandidates` が `true` のとき/g, "")
      // write の「書き終えたら」は、毎回の機械チェックだけにする（仕上げのサブエージェントは頼まれたときだけ）
      .replace("書き終えたら proofread スキルで校正する。", "書き終えたら、プロジェクト指示の「書いた・直したら毎回」を行う。")
      .replace(/## 4\. 書き終えたら\n\n[^\n]*\n?/, `## 4. 書き終えたら\n\nプロジェクト指示の「書いた・直したら毎回」を行います（kit の照らし合わせ、ensure-deps と proofread、「必ず」の修正）。独立レビューと読者役テストを含む仕上げ（${skillRef("proofread")}）は、本人に頼まれたときだけ行います。\n`)
      .replace(/`?(write|proofread|grow-ledger)`? スキル/g, (_, n) => skillRef(n))
      .replaceAll("${CLAUDE_PLUGIN_ROOT}", kit);
    if (name === "grow-ledger") out = out.replace(/## E\. 配る[\s\S]*$/, kitUpdate);
    if (out.includes("${CLAUDE_PLUGIN_")) throw new Error(`skills/${name}/SKILL.md に、kit で置き換えられない \${CLAUDE_PLUGIN_…} が残っています。`);
    if (/autoRegisterCandidates/.test(out)) throw new Error(`skills/${name}/SKILL.md に、Notion への自動の登録の記述が残っています。`);
    mkdirSync(join(stage, "skills", name), { recursive: true });
    writeFileSync(join(stage, "skills", name, "SKILL.md"), out);
  }
  // サブエージェントの本文（役の指示としてそのまま渡す）
  cpSync(join(ROOT, "agents"), join(stage, "agents"), { recursive: true, filter: noHidden });

  // 照らし合わせの一覧（sha256sum -c で確かめる形）。記録の置き場は kit の外なので入らない
  const sums = walkFiles(stage).filter((rel) => !NOT_IN_SUMS.has(rel)).map((rel) => `${sha(join(stage, rel))}  ${rel}\n`).join("");
  writeFileSync(join(stage, "kit.sha256"), sums);
  const sumsHash = sha(join(stage, "kit.sha256"));

  const paste = pasteText(sumsHash);
  writeFileSync(join(stage, "PROJECT-INSTRUCTIONS.md"), `# ja-proofread を Projects で使う（プロジェクト指示に足す文）

プロジェクトの会話で「\`${kit}/PROJECT-INSTRUCTIONS.md\` の貼る部分を、一字も変えずにプロジェクト指示に足して」と頼みます。手で貼るときは、下の「${BEGIN_LINE}」と「${END_LINE}」の2行の間（その2行は除く）を、Project settings > Memory > Project instructions に足します。新しく始めたスレッドから効きます。

この kit を入れ替えた（版を上げた）ら、プロジェクト指示の前の版の部分を「${END_MARK}」の行まで消してから、新しい版の貼る部分を足します。照らし合わせの値が版ごとに変わるので、貼り直さないと校正が照らし合わせで止まります。やめるときも、その行まで消します。詳しくは https://github.com/andy0911/ja-doc-proofreading/blob/main/docs/install-projects.md を見てください。

${BEGIN_LINE}
${paste}
${END_LINE}
`);
  return { paste, sumsHash };
}

// 同じ名前に書くとき、本人のファイルや書いたあとに変わったファイルは、別の名前で残す
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
function setAside(rel) {
  let to = `${rel}.mine-${stamp}`;
  for (let i = 2; existsSync(join(kitDir, to)); i++) to = `${rel}.mine-${stamp}-${i}`;
  renameSync(join(kitDir, rel), join(kitDir, to));
  return to;
}

if (remove) {
  if (!isKit) {
    console.log(`${kitDir} に ja-proofread の kit はありません。何も変えていません。`);
    process.exit(0);
  }
  // 消すのは、kit.json に並べたファイルのうち中身が変わっていないもの。前の版（一覧のない kit）なら、この版が書くものと同じ中身のものだけ
  let canon = oldFiles;
  if (!canon) {
    const stage = mkdtempSync(join(kitDir, STAGE_PREFIX));
    try {
      buildStage(stage);
      canon = Object.fromEntries(walkFiles(stage).map((rel) => [rel, sha(join(stage, rel))]));
    } finally { rmSync(stage, { recursive: true, force: true }); }
  }
  let removed = 0;
  for (const [rel, h] of Object.entries(canon)) if (unchanged(rel, h)) { removeFile(rel); removed++; }
  rmSync(join(kitDir, "kit.json"), { force: true });
  pruneDirs();
  const left = walkFiles(kitDir);
  const dataDir = resolve(kitDir, KIT_DATA_REL);
  const dataState = existsSync(dataDir)
    ? `記録の置き場（${dataDir}）は残しています。要らなければ消してください。`
    : `記録の置き場（${dataDir}）はありません（まだ作られていません）。`;
  let leftMsg;
  if (!left.length) {
    // ファイルは残っていない（空のディレクトリだけ）ので、kit の場所ごと消す
    rmSync(kitDir, { recursive: true, force: true });
    leftMsg = `${kitDir} は空になったので消しました。`;
  } else {
    // 残ったファイルがあるときは、印の kit.json を置く（あとで同じ場所に kit を書き直せるように）
    writeFileSync(join(kitDir, "kit.json"), JSON.stringify({ name: KIT_NAME, removed: true, files: {}, note: "ja-proofread の kit を消したあとの印。残ったファイルは、本人が置いたものか、kit が書いたあとに変わったもの。要らなければ、この kit.json ごと消してかまいません" }, null, 2) + "\n");
    leftMsg = `残したファイル（本人が置いたものか、kit が書いたあとに変わったもの）：${listNames(left)}。同じ場所に kit を書き直せるよう、印の kit.json を置いています。要らなければ、ディレクトリごと消してください。`;
  }
  console.log(`ja-proofread の kit を ${kitDir} から消しました（${removed} ファイル）。
${leftMsg}
${dataState}
プロジェクト指示（Project settings > Memory > Project instructions）に足した ja-proofread の部分も、「${END_MARK}」の行まで消してください。消すまで、新しいスレッドは無い kit を使おうとします。`);
  process.exit(0);
}

// 3. 書く。一時ディレクトリに作ってから入れ替え、kit.json は最後に書く（途中で止まっても前の kit.json が残り、書き直せる）
mkdirSync(kitDir, { recursive: true });
const stage = mkdtempSync(join(kitDir, STAGE_PREFIX));
const setAsideNames = [];
let built;
try {
  built = buildStage(stage);
  // kit.sha256 を最初に移す（途中で止まっても、次の実行で kit とみなされ、kit として動くように）
  const newRels = walkFiles(stage).sort((a, b) => (b === "kit.sha256") - (a === "kit.sha256"));
  const newFiles = Object.fromEntries(newRels.map((rel) => [rel, sha(join(stage, rel))]));
  // 前の版で書いたもののうち、新しい版に無く、中身が変わっていないものを消す
  if (oldFiles) for (const [rel, h] of Object.entries(oldFiles)) if (!(rel in newFiles) && unchanged(rel, h)) removeFile(rel);
  for (const rel of newRels) {
    // 親の場所にファイルがあれば（ディレクトリを置けないので）別の名前で残す
    for (let d = dirname(rel); d && d !== "."; d = dirname(d)) {
      let st = null;
      try { st = lstatSync(join(kitDir, d)); } catch { /* 無い */ }
      if (st && !st.isDirectory()) setAsideNames.push(`${d} → ${setAside(d)}`);
    }
    const target = join(kitDir, rel);
    let st = null;
    try { st = lstatSync(target); } catch { /* 無い */ }
    // 前の版が書いたまま、またはこれから書くものと同じなら、そのまま上書き。前の版（一覧のない kit）のファイルも上書きする。
    // それ以外（本人のファイル、書いたあとに変わったファイル、ディレクトリ）は別の名前で残す
    if (st && !(st.isFile() && (unchanged(rel, oldFiles?.[rel], newFiles[rel]) || (!oldFiles && isKit)))) setAsideNames.push(`${rel} → ${setAside(rel)}`);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(join(stage, rel), target);
  }
  writeFileSync(join(stage, "kit.json"), JSON.stringify({
    name: KIT_NAME,
    version,
    data: KIT_DATA_REL,
    note: "ja-proofread の Projects 向けの kit。dist/ja-proofread-setup.mjs --project-kit が書いた。中を手で直さない（入れ替えると、files に並べたファイルは新しい版になる）。記録の置き場は kit の隣の ja-proofread-data に決まっている（data は案内）",
    files: newFiles,
  }, null, 2) + "\n");
  renameSync(join(stage, "kit.json"), join(kitDir, "kit.json"));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
pruneDirs();

const { paste, sumsHash } = built;
const chars = [...paste].length;
console.log(`ja-proofread v${version} の kit を ${kitDir} に書きました。${asPath ? `手順と指示の中のパスは、使う場所の ${kit} で書いています（この場所に置いてから使います）。` : ""}
- 校正の一式: scripts, rules, data, config, templates, package.json, package-lock.json
- 手順の本文: skills/write, skills/proofread, skills/grow-ledger（SKILL.md）、agents/structure-reviewer.md, agents/fresh-eyes-reader.md
- 照らし合わせの一覧: kit.sha256（その sha256 ${sumsHash} は貼る部分に入っています）
- プロジェクト指示に足す文: PROJECT-INSTRUCTIONS.md（貼る部分は ${chars} 字）
- 記録の置き場: ${data}（使うときに作られ、kit を入れ替えても残ります）
${setAsideNames.length ? `同じ名前にあった本人のファイル・書いたあとに変わったファイルは、別の名前で残しました：${listNames(setAsideNames)}\n` : ""}
次に、プロジェクトの会話で「${kit}/PROJECT-INSTRUCTIONS.md の貼る部分を、一字も変えずにプロジェクト指示に足して」と頼みます（手で貼るなら、下の2行の間を Project settings > Memory > Project instructions に足します）。前の版を足してあるときは、その部分を「${END_MARK}」の行まで消してから足します。新しく始めたスレッドから効きます。

${BEGIN_LINE}
${paste}
${END_LINE}`);
