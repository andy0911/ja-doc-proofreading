// 共通処理：設定の読み込み、依存の場所、textlint の実行、構成チェックの集約
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, rmSync, mkdtempSync, readdirSync, renameSync, accessSync, constants as fsConstants } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { performance } from "node:perf_hooks";
import { runStructureChecks, disabledRanges, useMarkdownParser } from "./structure-check.mjs";
import { checkShape, measureRegexes, regexKey, shapeCost, addJudgeVersion } from "./regex-safety.mjs";

// プラグインとして入れても、プロジェクトに同梱しても動くよう、スクリプトの位置から根を決める
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// データ置き場（依存・検出の記録・誤検知の記録・フックの前回結果）。
// フックには CLAUDE_PLUGIN_DATA が渡る。スキルから動かすときは JA_PROOFREAD_DATA に同じ場所を渡す。
// Projects 向けの kit（install-project-kit.mjs が書く）かどうかは、根の kit.sha256（照らし合わせの一覧）か kit.json があるかで決める。
// kit.json は照らし合わせに入らず、消されても照らし合わせは通るので、それだけには頼らない。kit.sha256 を消すと照らし合わせが通らない。
// kit として動くときは、記録の置き場を kit の隣の ja-proofread-data に決め（kit.json の data の値は案内で、使わない）、
// 根の中の node_modules を使わず、正規表現の検査の記録は共有の置き場でなくスレッドの中（既定の場所）に置く。
// 記録はスレッドをまたいで残したいので /mnt/project-files の下に置き、依存（node_modules）は既定の場所（~/.cache）に入れる
// 既定の場所は ~/.cache/ja-proofread（XDG_CACHE_HOME があればその下）。書けないとき（claude.ai のチャットのサンドボックスなど）は、
// 一時ディレクトリの下の ja-proofread-cache にする。スクリプトの根（スキルのフォルダ）には書かない
function writableDir(d) {
  try { mkdirSync(d, { recursive: true }); accessSync(d, fsConstants.W_OK); return true; } catch { return false; }
}
const defaultCache = () => {
  const d = join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ja-proofread");
  return writableDir(d) ? d : join(tmpdir(), "ja-proofread-cache");
};
const envData = () => process.env.JA_PROOFREAD_DATA || process.env.CLAUDE_PLUGIN_DATA || "";
export const KIT_DATA_REL = "../ja-proofread-data";
export function isKitRoot() {
  return existsSync(join(ROOT, "kit.sha256")) || existsSync(join(ROOT, "kit.json"));
}
function kitData() {
  return isKitRoot() ? resolve(ROOT, KIT_DATA_REL) : "";
}
// 安全の確認に使う記録（正規表現の検査の結果）の置き場。kit では、ほかのスレッドが書き換えられる共有の置き場を信じない
export function checkCacheDir() {
  const d = isKitRoot() ? (envData() || defaultCache()) : dataDir();
  mkdirSync(d, { recursive: true });
  return d;
}
export function dataDir() {
  const d = envData() || kitData() || defaultCache();
  mkdirSync(d, { recursive: true });
  return d;
}

// 依存は、データ置き場を環境変数で渡したときはその下、そうでなければ既定の場所（kit でも ~/.cache の下）に入れる
export function depsDir() {
  const base = envData() || defaultCache();
  mkdirSync(base, { recursive: true });
  return join(base, "deps");
}

export function depsHash() {
  const h = createHash("sha256").update(readFileSync(join(ROOT, "package.json")));
  const lock = join(ROOT, "package-lock.json");
  if (existsSync(lock)) h.update(readFileSync(lock));
  return h.digest("hex").slice(0, 16);
}

// textlint の場所。データ置き場に入れたものを先に使う。
// マーケットプレイスから入れた場合は、Claude Code がプラグインの中に node_modules を入れることがあるので、それも使う。
export function textlintBin() {
  const stamp = join(depsDir(), ".stamp");
  const inData = join(depsDir(), "node_modules", "textlint", "bin", "textlint.js");
  if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === depsHash() && existsSync(inData)) return inData;
  // kit の中の node_modules は使わない（照らし合わせはあとから足したファイルを見つけず、共有フォルダーではほかのスレッドが置けるため）
  const inRoot = join(ROOT, "node_modules", "textlint", "bin", "textlint.js");
  if (!isKitRoot() && existsSync(inRoot)) return inRoot;
  return null;
}

export function depsReady() {
  return textlintBin() !== null;
}

// 入れた依存の node_modules の親（textlint を動かす場所）。無ければ null
function depsBase() {
  const bin = textlintBin();
  return bin ? resolve(bin, "..", "..", "..", "..") : null;
}

// 入れた依存（textlint と同じ node_modules）から、CommonJS のパッケージを読む。無ければ null
function depsRequire() {
  const base = depsBase();
  return base ? createRequire(join(base, "package.json")) : null;
}

export function loadPrh() {
  try { return depsRequire()?.("prh") ?? null; } catch { return null; }
}

// 依存があれば、コードの範囲を Markdown の構文木（@textlint/markdown-to-ast）で取る。無ければ structure-check の正規表現を使う
try {
  const req = depsRequire();
  if (req) {
    const mod = await import(pathToFileURL(req.resolve("@textlint/markdown-to-ast")).href);
    if (typeof mod.parse === "function") useMarkdownParser(mod.parse);
  }
} catch { /* 正規表現で隠す */ }

export function readJSON(p, fallback = undefined) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

// 使える種類は config/ にある名前だけ（doc、slide）。パスとして使うので、ほかの文字列は通さない
export const PROFILES = readdirSync(join(ROOT, "config"))
  .map((f) => /^([a-z0-9-]+)\.textlintrc\.json$/.exec(f)?.[1])
  .filter(Boolean);

export function checkProfile(p, where = "profile") {
  if (!PROFILES.includes(p)) throw new Error(`${where} に「${p}」は使えません。${PROFILES.join(" か ")} を指定してください`);
  return p;
}

export const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/.git/**", "**/CHANGELOG.md", ".claude/**", "**/CLAUDE.md"];

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
export const BLOCK_ON = ["must", "should", "info", "never"];

// 設定の型を確かめる。違えば、どこをどう直すかを書いて止める（黙って既定値にしたり、フックが止まったりしないため）
function checkConfigTypes(user, p) {
  const bad = (key, want, value) => { throw new Error(`${p} の ${key} は${want}にしてください（今は ${JSON.stringify(value)}）`); };
  for (const k of ["include", "exclude", "disable", "prh"]) if (user[k] !== undefined && !isStringArray(user[k])) bad(k, `文字列の配列（例：["**/*.md"]）`, user[k]);
  if (user.profile !== undefined && typeof user.profile !== "string") bad("profile", "文字列", user.profile);
  if (user.profiles !== undefined && !isObject(user.profiles)) bad("profiles", `オブジェクト（例：{"slides/**": "slide"}）`, user.profiles);
  if (user.hook !== undefined) {
    if (!isObject(user.hook)) bad("hook", `オブジェクト（例：{"enabled": true, "blockOn": "must"}）`, user.hook);
    if (user.hook.enabled !== undefined && typeof user.hook.enabled !== "boolean") bad("hook.enabled", "真偽値（true か false）", user.hook.enabled);
    if (user.hook.blockOn !== undefined && !BLOCK_ON.includes(user.hook.blockOn)) bad("hook.blockOn", `次のどれか（${BLOCK_ON.join("・")}）`, user.hook.blockOn);
  }
  if (user.baseline !== undefined && user.baseline !== null && typeof user.baseline !== "string") bad("baseline", "文字列（基準ファイルのパス）", user.baseline);
  if (user.notion !== undefined && !isObject(user.notion)) bad("notion", "オブジェクト", user.notion);
}

// プロジェクトの .ja-proofread.json（無ければ既定値）。hook は、このファイルがあるときだけ動く。
// ファイルがあるのに JSON として読めないときは、黙って既定値にせずエラーにする
export function loadProjectConfig(dir = projectDir()) {
  const p = join(dir, ".ja-proofread.json");
  let user = null;
  if (existsSync(p)) {
    try { user = JSON.parse(readFileSync(p, "utf8")); }
    catch (e) { throw new Error(`${p} を JSON として読めません（${e.message}）。直すまで校正の設定は使えません`); }
    if (!isObject(user)) throw new Error(`${p} の中身がオブジェクト（{…}）ではありません`);
    checkConfigTypes(user, p);
  }
  const cfg = {
    exists: user !== null,
    path: p,
    profile: "doc",
    include: ["**/*.md", "**/*.txt"],
    profiles: {},
    disable: [],
    prh: [],
    baseline: null,
    ...(user || {}),
  };
  // exclude は既定の除外（node_modules・.claude/**・CLAUDE.md など）に足す。書いても既定は消えない
  cfg.exclude = [...new Set([...DEFAULT_EXCLUDE, ...(Array.isArray(user?.exclude) ? user.exclude : [])])];
  cfg.hook = { enabled: true, blockOn: "must", ...((user && user.hook) || {}) };
  checkProfile(cfg.profile, `${p} の profile`);
  for (const [g, v] of Object.entries(cfg.profiles || {})) checkProfile(v, `${p} の profiles["${g}"]`);
  return cfg;
}

export function loadLedger() {
  return readJSON(join(ROOT, "data", "ledger.json"));
}

// 簡易 glob（** と * と ? のみ）
export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") { re += glob[i + 2] === "/" ? "(?:.*/)?" : ".*"; i += glob[i + 2] === "/" ? 2 : 1; }
      else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}

export function matchesAny(rel, globs) {
  return globs.some((g) => globToRegExp(g).test(rel));
}

export function profileFor(file, cfg) {
  const rel = toRel(file, cfg);
  for (const [glob, prof] of Object.entries(cfg.profiles || {})) {
    if (globToRegExp(glob).test(rel)) return prof;
  }
  return cfg.profile || "doc";
}

export function toRel(file, cfg) {
  const base = dirname(cfg.path);
  const abs = isAbsolute(file) ? file : resolve(file);
  return relative(base, abs).split("\\").join("/");
}

// ルールIDの書き方をそろえる（preset- や textlint-rule- の有無を問わない）
export function normalizeRuleId(id) {
  return String(id).replace(/^textlint-rule-/, "").replace(/(^|\/)preset-/, "$1");
}

// disable に書いたIDが、この指摘のルールに当たるか。プリセット名だけならプリセット全体に当たる
export function isDisabled(ruleId, disable = []) {
  const r = normalizeRuleId(ruleId);
  return disable.some((d) => {
    const n = normalizeRuleId(d);
    return n === r || r.startsWith(n + "/");
  });
}

// textlint の設定を実行時に組み立てる（辞書や台帳を絶対パスで渡すため）
export const LEDGER_RULE = join(ROOT, "rules", "ledger-patterns.js");

// tmp を渡すと、プロジェクトの prh 辞書を検査して、通った規則だけを書いた辞書をそこに置く。
// prhDeadline は、すべての辞書の読み込みと検査で分け合う締め切り（performance.now() の値。時計が巻き戻っても延びないよう、単調に進む時刻を使う）。
// 後ろの辞書（見つかるもの）には1つあたり PRH_DICT_MIN_MS だけを残し、残りは今の辞書が使う（辞書が多いと、等分では1つの辞書に回せる時間が
// 小さくなり、重い規則がいつまでも確かめ終わらないため）。ただし、今の辞書には少なくとも等分した時間を回す。
// 早く終わった辞書の残りの時間は、後の辞書に回る。prhBudgetMs は警告に書く上限（実際に使う時間）。
// prhState は、1回の校正（種類 doc・slide ごとに何度か呼ぶ）で分け合う状態（newPrhState）。渡したときは、時間内に確かめ終わらなかった
// 規則の知らせを返さず、呼んだ側がすべての種類を見終えてから prhPendingWarnings で1回だけ作る。渡さないときは、この中で作って返す
export const PRH_DICT_MIN_MS = 2000;
export function newPrhState() {
  return { progressed: false, pending: new Map(), timedOut: new Set() };
}
export function buildTextlintConfig(profile, cfg, { tmp = null, prhDeadline = performance.now() + PRH_BUDGET_MS, prhBudgetMs = prhDeadline - performance.now(), prhState = null } = {}) {
  checkProfile(profile);
  const base = readJSON(join(ROOT, "config", `${profile}.textlintrc.json`));
  const conf = JSON.parse(JSON.stringify(base));
  const warnings = [];
  const extra = [];
  const dicts = (cfg.prh || []).map((p) => ({ p, abs: resolve(dirname(cfg.path), p) }));
  const state = prhState || newPrhState();
  // 見つからない辞書と、この校正で読み込みが時間切れになった辞書は、時間を分ける数に入れない
  const usable = dicts.map((d) => existsSync(d.abs) && !state.timedOut.has(d.abs));
  dicts.forEach(({ p, abs }, n) => {
    if (!existsSync(abs)) { warnings.push(`prh の辞書 ${p} が見つからないため外しました`); return; }
    // 読み込みが時間切れになった辞書は、この校正の中で読み直さない（警告は1回目に出している）
    if (state.timedOut.has(abs)) return;
    const now = performance.now();
    const left = Math.max(0, prhDeadline - now);
    const later = usable.slice(n + 1).filter(Boolean).length;
    const dictMs = Math.max(left - later * PRH_DICT_MIN_MS, left / (later + 1));
    const dictDeadline = now + dictMs;
    // プロジェクトの辞書も、同梱の辞書と同じ検査を通す。通らない規則だけを外した辞書を、一時ディレクトリに書いて渡す
    const r = checkedPrhDictionary(abs, p, tmp && join(tmp, `prh-${n}.yml`), dictDeadline, { budgetMs: prhBudgetMs, dictMs, dicts: later + 1, state });
    warnings.push(...r.warnings);
    if (r.path) extra.push(r.path);
  });
  if (!prhState) warnings.push(...prhPendingWarnings(state, prhBudgetMs));
  conf.rules = conf.rules || {};
  conf.rules.prh = { rulePaths: [join(ROOT, "data", "prh.yml"), ...extra] };
  // rulesdir のルールには設定を渡せないため、ルールのファイルを絶対パスで指定する
  conf.rules[LEDGER_RULE] = { ledgerPath: join(ROOT, "data", "ledger.json"), profile, disable: cfg.disable || [] };
  for (const d of cfg.disable || []) {
    const n = normalizeRuleId(d);
    for (const key of Object.keys(conf.rules)) {
      const short = normalizeRuleId(key);
      if (n === short) conf.rules[key] = false;
      else if (n.startsWith(short + "/") && conf.rules[key] !== false) {
        if (typeof conf.rules[key] !== "object") conf.rules[key] = {};
        conf.rules[key][n.slice(short.length + 1)] = false;
      }
    }
  }
  return { conf, warnings };
}

// 時間内に確かめ終わらなかった規則の知らせ。すべての辞書（と、すべての種類）を見てから1回だけ作る。
// 「次の校正で続きを確かめます」と書くのは、今回どれかの辞書で記録が増えたとき（次の校正が今回より先に進むとき）だけ
export function prhPendingWarnings(state, budgetMs) {
  const out = [];
  for (const [label, x] of state.pending) {
    out.push(state.progressed
      ? `prh の辞書 ${label} の ${x.count}件の規則は、この辞書に回せた時間（${seconds(x.dictMs)}秒）に確かめ終わらなかったため今回は外しました（次の校正で続きを確かめます）`
      : `prh の辞書 ${label} の ${x.count}件の規則は、この辞書に回せた時間（${seconds(x.dictMs)}秒。上限 ${seconds(budgetMs)}秒のうち）に確かめ終わらなかったため外しました。今回は確かめ終えたものが無く、次の校正でも同じところで止まります。環境変数 JA_PROOFREAD_PRH_BUDGET_MS で上限を延ばすか、選択肢の多い規則を分けるか、辞書の数を減らしてください`);
  }
  return out;
}

// 正規表現ごとの検査の記録（データ置き場の regex-checked.json。kit ではスレッドの中の既定の場所）。通ったものも、拒否したものも残す。
// 鍵は検査の版・正規表現・flags なので、辞書の imports 先を含めて中身が変われば、変わった正規表現だけを測り直す。
// 子プロセスが止まって測れなかったもの（一時的な失敗かもしれない）は残さず、次の校正で測り直す
// 時間の上限は既定で20秒。遅い計算機やテストでは JA_PROOFREAD_PRH_BUDGET_MS（ミリ秒）で変えられる
// 有限の正の数だけを使い、それ以外（Infinity・負の数・数でないもの）は既定値にする（子プロセスの timeout に渡せないため）。
// 小さすぎると辞書を読むだけで終わり、毎回すべての規則が外れるので、下限を PRH_BUDGET_MIN_MS にする
export const PRH_BUDGET_MIN_MS = 1000;
const budgetEnv = Number(process.env.JA_PROOFREAD_PRH_BUDGET_MS);
export const PRH_BUDGET_MS = Number.isFinite(budgetEnv) && budgetEnv > 0 ? Math.max(PRH_BUDGET_MIN_MS, budgetEnv) : 20000;
// 秒の表し方（警告の文言に使う）。1.5 秒のように小数1桁まで
const seconds = (ms) => `${Math.round(Math.max(0, ms) / 100) / 10}`;
const CACHE_MAX = 20000;
function regexCache() {
  const path = join(checkCacheDir(), "regex-checked.json");
  let data = readJSON(path, {});
  if (!isObject(data)) data = {};
  let dirty = false;
  let order = null; // 古い順の位置。使ったものを新しい扱いにするときだけ作る
  // 記録の数は最初に1回だけ数え、新しい鍵を足したときだけ増やす（get のたびに数え直すと、規則数×記録数に比例して遅くなる）
  let size = Object.keys(data).length;
  return {
    get(k) {
      if (!Object.hasOwn(data, k) || !Array.isArray(data[k])) return undefined;
      // 使ったものは新しい扱いにする（よく使う辞書の結果が、古いものから捨てるときに消えないため）。
      // 毎回書き直さないよう、記録が多く、古い側の半分にあるものだけを動かす（動かしても数は変わらない）
      if (size > CACHE_MAX / 2) {
        order ??= new Map(Object.keys(data).map((key, i) => [key, i]));
        if ((order.get(k) ?? size) < size / 2) { const v = data[k]; delete data[k]; data[k] = v; order.set(k, Infinity); dirty = true; }
      }
      return data[k];
    },
    set(k, v) {
      if (Object.hasOwn(data, k)) delete data[k]; else size++;
      data[k] = v;
      order?.set(k, Infinity);
      dirty = true;
    },
    delete(k) {
      if (!Object.hasOwn(data, k)) return;
      delete data[k];
      size--;
      order?.delete(k);
      dirty = true;
    },
    size: () => size,
    save() {
      if (!dirty) return;
      const keys = Object.keys(data);
      for (const k of keys.slice(0, Math.max(0, keys.length - CACHE_MAX))) delete data[k];
      try { const t = `${path}.tmp-${process.pid}`; writeFileSync(t, JSON.stringify(data)); renameSync(t, path); } catch { /* 記録できなくても続ける */ }
    },
  };
}

// 正規表現をまとめて確かめる。記録にあるものは使い、無いものだけを測る。
// list の要素は { source, flags, allowEmpty? }。返すのは問題の説明の配列か null（締め切りまでに確かめ終わらなかったもの）。
// 形の検査（重ならない選択かを当てて確かめるため、1件で数十ms かかることがある）と時間を測るのを合わせて、deadline までに収める。
// 重い1件が締め切りまで使っても、ほかの規則が毎回外れないよう、次のようにする。
//   ・軽いもの（短いもの）から順に形を確かめる
//   ・形の検査は、時間を測る分を残した締め切りまでにする
//   ・形の検査を通ったことも記録に残す（次の校正では、形を確かめ直さずに時間を測る）。最終の結果を記録したら、その印は消す
// 返す配列の progressed は、今回、記録に新しく足したものがあるか（無ければ、次の校正でも同じところで止まる）
const SHAPE_OK = "shape-ok:";
const MEASURE_RESERVE_MS = 500, MEASURE_RESERVE_PER_MS = 5;
export function checkRegexesCached(list, { budgetMs = PRH_BUDGET_MS, deadline = performance.now() + budgetMs } = {}) {
  const cache = regexCache();
  const keys = list.map((x) => regexKey(x.source, x.flags, x));
  const out = keys.map((k) => cache.get(k));
  let added = 0;
  const put = (k, v) => { cache.set(k, v); added++; };
  const order = [];
  for (let k = 0; k < list.length; k++) if (out[k] === undefined) order.push(k);
  order.sort((a, b) => shapeCost(list[a].source, list[a].flags) - shapeCost(list[b].source, list[b].flags) || a - b);
  const left = deadline - performance.now();
  const shapeDeadline = deadline - Math.min(left / 2, MEASURE_RESERVE_MS + MEASURE_RESERVE_PER_MS * order.length);
  const todo = [];
  for (const k of order) {
    if (cache.get(SHAPE_OK + keys[k])) { todo.push(k); continue; }
    if (performance.now() >= shapeDeadline) { out[k] = null; continue; }
    // 形の検査も1件の中で締め切りを見る。締め切りまでに確かめ終わらなかったものは未確認（null）にし、記録には残さない。
    // 思わぬ例外（深すぎる入れ子など）でも校正全体は止めず、その規則だけを拒否する
    let shape;
    try { shape = checkShape(list[k].source, list[k].flags, { ...list[k], deadline: shapeDeadline }); }
    catch (e) { shape = [`形を確かめられませんでした（${String(e?.message || e).slice(0, 100)}）`]; }
    if (shape.pending) { out[k] = null; continue; }
    if (shape.length) { out[k] = shape; put(keys[k], shape); }
    else { put(SHAPE_OK + keys[k], []); todo.push(k); }
  }
  // 同じ正規表現は1回だけ測る
  const uniq = [...new Map(todo.map((k) => [keys[k], k])).values()];
  const unmeasured = new Map();
  if (uniq.length && deadline > performance.now()) {
    const measured = measureRegexes(uniq.map((k) => list[k]), { budgetMs: deadline - performance.now() });
    uniq.forEach((k, n) => {
      const m = measured[n];
      if (m && m.transient) unmeasured.set(keys[k], m);
      else if (m) { put(keys[k], m); cache.delete(SHAPE_OK + keys[k]); }
    });
  }
  for (const k of todo) out[k] = cache.get(keys[k]) ?? unmeasured.get(keys[k]) ?? null;
  cache.save();
  Object.defineProperty(out, "progressed", { value: added > 0 });
  return out;
}

// prh の辞書を子プロセスで読む。prh は規則を作るときに specs を当てるので、危ない正規表現と長い例文の組み合わせで止まることがある。
// 締め切りまでに読み終わらなければ打ち切る。返すのは prh-load.mjs の出力か { timeout: true }。
// 同じ辞書を1回の校正で何度も読まないよう、読んだ結果はこのプロセスの中で覚えておく
const prhLoaded = new Map();
function loadPrhInChild(abs, deadline) {
  if (prhLoaded.has(abs)) return prhLoaded.get(abs);
  const left = deadline - performance.now();
  if (left <= 0) return { timeout: true };
  const r = spawnSync(process.execPath, [join(ROOT, "scripts", "prh-load.mjs"), depsBase(), abs], {
    encoding: "utf8", timeout: Number.isFinite(left) ? Math.ceil(left) : undefined, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024,
  });
  let out;
  if (r.error?.code === "ETIMEDOUT" || (r.signal && performance.now() >= deadline)) out = { timeout: true };
  else {
    try { out = JSON.parse(r.stdout); } catch { out = null; }
    if (!out || typeof out !== "object") out = { ok: false, error: (r.error?.message || r.signal || (r.stderr || "").trim().split("\n")[0] || "子プロセスが止まりました").slice(0, 200) };
  }
  if (!out.timeout) prhLoaded.set(abs, out);
  return out;
}

// プロジェクトの prh 辞書を prh 本体で読み（imports や配列の patterns も入る）、規則ごとに組み立てた正規表現を確かめる。
// 通らない規則は外し、残りを1つの辞書に書き出して、textlint にはそれを渡す。
// 返すのは { path（textlint に渡す辞書。使わないときは null）, warnings }
// state を渡すと、時間内に確かめ終わらなかった規則（state.pending）と、記録が増えたか（state.progressed）をそこに足す。
// 渡さないときは、その知らせをこの辞書の警告に入れる
function checkedPrhDictionary(abs, label, outPath, deadline = performance.now() + PRH_BUDGET_MS, { budgetMs = deadline - performance.now(), dictMs = budgetMs, dicts = 1, state = null } = {}) {
  if (!loadPrh()) return { path: null, warnings: [`textlint の依存（prh）が見つからないため、prh の辞書 ${label} は使いません`] };
  const engine = loadPrhInChild(abs, deadline);
  const share = dicts > 1 ? `この辞書に回せた時間は ${seconds(dictMs)}秒です（上限 ${seconds(budgetMs)}秒のうち、後ろの辞書に1つあたり${seconds(PRH_DICT_MIN_MS)}秒までを残しています）` : `この辞書に回せた時間は ${seconds(dictMs)}秒です（上限 ${seconds(budgetMs)}秒）`;
  if (engine.timeout) state?.timedOut.add(abs);
  if (engine.timeout) return { path: null, warnings: [`prh の辞書 ${label} を時間内に読み終えなかったため、辞書ごと外しました（prh は読み込むときに specs の例文を正規表現に当てるため、止まるおそれのある正規表現と長い例文があると終わりません。${share}）`] };
  if (!engine.ok) return { path: null, warnings: [`prh の辞書 ${label} を読めないため外しました（${engine.error}）`] };
  const items = [];
  engine.rules.forEach((rule, k) => items.push({ kind: "rule", k, source: rule.source, flags: rule.flags, name: rule.expected }));
  engine.targets.forEach((t, k) => {
    // targets の file は本文ではなくファイルのパスに当てるので、長さ0で一致してもよい
    items.push({ kind: "target", k, source: t.file.source, flags: t.file.flags, allowEmpty: true, name: `targets[${k}].file` });
    for (const x of t.patterns) items.push({ kind: "target", k, source: x.source, flags: x.flags, name: `targets[${k}]` });
  });
  const results = checkRegexesCached(items, { deadline });
  if (state && results.progressed) state.progressed = true;
  const badRules = new Set(), pending = new Set(), msgs = [];
  let badTarget = false, pendingTarget = false;
  items.forEach((it, n) => {
    const r = results[n];
    if (r === null) { if (it.kind === "rule") pending.add(it.k); else pendingTarget = true; return; }
    if (!r.length) return;
    if (it.kind === "rule") badRules.add(it.k); else badTarget = true;
    msgs.push(`「${it.name}」/${it.source.slice(0, 60)}/: ${r[0]}`);
  });
  const shown = (xs) => `${xs.slice(0, 3).join("／")}${xs.length > 3 ? ` ほか${xs.length - 3}件` : ""}`;
  const detail = msgs.length ? "：" + shown(msgs) : "";
  if (badTarget || pendingTarget) return { path: null, warnings: [`prh の辞書 ${label} の targets に${badTarget ? "使えない正規表現があるため" : ""}${badTarget && pendingTarget ? "、また" : ""}${pendingTarget ? "時間内に確かめ終わらなかった正規表現があるため" : ""}、辞書ごと外しました${detail}`] };
  // targets は書き出せないため、外す規則があれば辞書ごと外す（「その規則だけ外した」とは言わない）
  if (engine.targets.length && (badRules.size || pending.size)) {
    const why = [badRules.size && `${badRules.size}件の規則に使えない正規表現があり`, pending.size && `${pending.size}件の規則は時間内に確かめ終わらず`].filter(Boolean).join("、");
    return { path: null, warnings: [`prh の辞書 ${label} は、${why}、targets を使っているため規則だけを外せないので、辞書ごと外しました${detail}`] };
  }
  const warnings = [];
  if (badRules.size) warnings.push(`prh の辞書 ${label} の ${badRules.size}件の規則に使えない正規表現があるため、その規則だけを外しました：${shown(msgs)}`);
  if (pending.size) {
    // 種類（doc・slide）ごとに同じ辞書を見るので、辞書ごとに1つにまとめる（外した数がいちばん多かった回の数と、その回に回せた時間）
    const st = state || newPrhState();
    const prev = st.pending.get(label);
    if (!prev || pending.size > prev.count) st.pending.set(label, { count: pending.size, dictMs });
    if (!state) { st.progressed = results.progressed; warnings.push(...prhPendingWarnings(st, budgetMs)); }
  }
  // 外す規則がなくても、確かめたものと同じ中身を渡すため、書き出したものを使う。
  // 一時ディレクトリがないとき（buildTextlintConfig だけを呼んだとき）は、外す規則がなければ元の辞書を指す
  if (!outPath || engine.targets.length) return { path: badRules.size || pending.size ? null : abs, warnings };
  // specs は読み込んだときに確かめ終えているので、書き出す辞書には入れない（textlint の中でもう一度当てないため）
  const kept = engine.rules.filter((_, k) => !badRules.has(k) && !pending.has(k)).map((rule) => {
    if (!isObject(rule.raw)) return rule.raw;
    const { specs, ...rest } = rule.raw;
    return rest;
  });
  if (!kept.length) return { path: null, warnings };
  // YAML は JSON を含むので、JSON で書けば prh がそのまま読める。imports は読み込み済みなので書かない
  writeFileSync(outPath, JSON.stringify({ version: engine.version, rules: kept }));
  return { path: outPath, warnings };
}

// lib.mjs 側の判定（記録の使い方・形の検査の順・辞書の規則の外し方）の版を、正規表現の検査の記録の鍵（CHECKER_ID）に足す。
// 判定の関数の中身から作るので、判定を変えると古い記録は使われない
addJudgeVersion(createHash("sha256").update(checkRegexesCached.toString()).update("\0").update(checkedPrhDictionary.toString()).digest("hex"));

// deadline（performance.now() の値）を渡すと、textlint をそれまでに打ち切る（フックの時間の上限に収めるため）。渡さなければ120秒
export const TEXTLINT_TIMEOUT_MS = 120000;
const TEXTLINT_RESERVE_MS = 10000;
export function runTextlint(files, profile, cfg, { deadline, prhDeadline, prhBudgetMs, prhState } = {}) {
  const bin = textlintBin();
  if (!bin) {
    return { ok: false, lintError: "textlint の依存がまだ入っていません。`node " + join(ROOT, "scripts", "ensure-deps.mjs") + "` を実行してください。", results: [], warnings: [] };
  }
  // 設定ファイルと書き出した辞書は、自分だけの一時ディレクトリに固定の名前で置く（profile などの値をパスに使わない）
  const tmp = mkdtempSync(join(tmpdir(), "ja-proofread-"));
  let r, warnings = [], timeoutMs;
  try {
    const built = buildTextlintConfig(profile, cfg, { tmp, prhState, ...(prhDeadline ? { prhDeadline } : {}), ...(prhBudgetMs ? { prhBudgetMs } : {}) });
    warnings = built.warnings;
    const confPath = join(tmp, "textlintrc.json");
    writeFileSync(confPath, JSON.stringify(built.conf));
    timeoutMs = deadline === undefined ? TEXTLINT_TIMEOUT_MS : Math.max(1000, Math.ceil(deadline - performance.now()));
    r = spawnSync(process.execPath, [bin, "--config", confPath, "-f", "json", ...files.map((f) => resolve(f))], {
      cwd: resolve(bin, "..", "..", "..", ".."), // node_modules の親。ルールはここから探される
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const fail = (why) => ({ ok: false, lintError: why.slice(0, 2000), results: [], warnings });
  if (r.error?.code === "ETIMEDOUT") return fail(`textlint が時間内（${Math.round(timeoutMs / 1000)}秒）に終わらなかったため打ち切りました`);
  if (r.error) return fail(`textlint を起動できませんでした（${r.error.message}）`);
  // textlint は指摘なしで 0、指摘ありで 1 を返す。それ以外は落ちている
  if (r.status !== 0 && r.status !== 1) return fail(`textlint が終了コード ${r.status ?? r.signal} で止まりました。${(r.stderr || "").trim()}`);
  if (!(r.stdout || "").trim()) {
    if ((r.stderr || "").trim()) return fail(`textlint が結果を返しませんでした。${r.stderr.trim()}`);
    return fail("textlint が結果を返しませんでした");
  }
  try { return { ok: true, results: JSON.parse(r.stdout), warnings }; }
  catch { return fail(`textlint の出力を読めませんでした。${(r.stderr || r.stdout).trim()}`); }
}

// ルールごとの重さ。textlint v16 では severity: info が効かなかったため、ここで分類する
const LEVEL_BY_RULE = [
  [/^prh$/, "must"],
  [/^[PR]\d+$/, "should"],
  [/ai-writing/, "should"],
  [/ja-technical-writing\/(?:no-doubled-joshi|no-dropping-the-ra|no-double-negative-ja|ja-no-mixed-period|no-mix-dearu-desumasu)/, "must"],
];
export function levelOf(ruleId, message = "") {
  const m = /^\[(must|should|info)\]/.exec(message);
  if (m) return m[1];
  for (const [re, lv] of LEVEL_BY_RULE) if (re.test(ruleId)) return lv;
  return "info";
}

// deadline（performance.now() の値）を渡すと、prh の辞書の検査と textlint をそれまでに収める（フックから呼ぶとき）。
// prh の辞書の検査の時間（PRH_BUDGET_MS）は、すべての辞書と、種類（doc・slide）ごとの textlint の実行で分け合う
export function proofreadFiles(files, { cfg = loadProjectConfig(), profile, deadline } = {}) {
  // 締め切りがあるときは、textlint の分（TEXTLINT_RESERVE_MS）を残す
  const start = performance.now();
  const prhDeadline = Math.min(start + PRH_BUDGET_MS, (deadline ?? Infinity) - TEXTLINT_RESERVE_MS);
  // 警告に書く上限は、実際に使う時間（フックの締め切りで短くなることがある）
  const prhBudgetMs = Math.max(0, prhDeadline - start);
  const ledger = loadLedger();
  const out = [];
  const byProfile = new Map();
  if (profile) checkProfile(profile, "--profile");
  for (const f of files) {
    const p = profile || profileFor(f, cfg);
    if (!byProfile.has(p)) byProfile.set(p, []);
    byProfile.get(p).push(f);
  }
  let lintError = null;
  const warnings = new Set();
  const disable = cfg.disable || [];
  // prh の辞書の状態（記録が増えたか・確かめ終わらなかった規則・読み込みが時間切れになった辞書）は、すべての種類で1つを分け合う
  const prhState = newPrhState();
  for (const [p, group] of byProfile) {
    const tl = runTextlint(group, p, cfg, { deadline, prhDeadline, prhBudgetMs, prhState });
    if (!tl.ok) lintError = tl.lintError;
    for (const w of tl.warnings || []) warnings.add(w);
    const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
    const tlByFile = new Map(tl.results.map((r) => [real(r.filePath), r.messages]));
    for (const f of group) {
      const abs = resolve(f);
      const text = readFileSync(abs, "utf8");
      const lint = (tlByFile.get(real(abs)) || []).map((m) => ({
        source: "textlint",
        ruleId: m.ruleId === LEDGER_RULE || /ledger-patterns\.js$/.test(m.ruleId) ? ((/\[(P\d+|R\d+)\]/.exec(m.message) || [])[1] || "ledger") : m.ruleId,
        level: levelOf(m.ruleId, m.message),
        line: m.line,
        column: m.column,
        message: m.message.replace(/^\[(must|should|info)\]\s*/, "").split("\n").filter(Boolean).slice(0, 2).join(" "),
      }));
      const structure = runStructureChecks(text, ledger, p);
      // textlint-disable の範囲（ルール名つきならそのルールだけ）と、設定の disable を、すべての指摘に当てる
      const ranges = disabledRanges(text);
      // 文書全体についての指摘（whole）は、行番号が目安なので範囲では消さない
      const inRange = (x) => x.line && !x.whole && ranges.some((r) => x.line >= r.from && x.line <= r.to && (!r.rules.length || isDisabled(x.ruleId, r.rules)));
      const findings = [...lint, ...structure].filter((x) => !isDisabled(x.ruleId, disable) && !inRange(x));
      out.push({ file: abs, profile: p, findings });
    }
  }
  // 時間内に確かめ終わらなかった規則の知らせは、すべての種類を見終えてから1回だけ作る
  for (const w of prhPendingWarnings(prhState, prhBudgetMs)) warnings.add(w);
  recordHits(out);
  return { files: out, ok: !lintError, lintError, warnings: [...warnings], ledgerVersion: ledger.version };
}

export function fileKey(file) {
  return createHash("sha256").update(resolve(file)).digest("hex").slice(0, 12);
}

// 検出の記録は「日・ファイル・型」ごとに1件。同じ日に同じファイルを何度直しても1件と数える
function recordHits(out) {
  try {
    const p = join(dataDir(), "hits.jsonl");
    const day = new Date().toISOString().slice(0, 10);
    const seen = new Set();
    if (existsSync(p)) {
      for (const line of readFileSync(p, "utf8").split("\n")) {
        if (!line.includes(`"${day}"`)) continue;
        try {
          const h = JSON.parse(line);
          for (const id of h.ids || Object.keys(h.counts || {})) seen.add(`${h.day}|${h.file}|${id}`);
        } catch { /* 壊れた行は読み飛ばす */ }
      }
    }
    let lines = "";
    for (const f of out) {
      const key = fileKey(f.file);
      const ids = [...new Set(f.findings.map((x) => x.ruleId))].filter((id) => !seen.has(`${day}|${key}|${id}`));
      if (ids.length) lines += JSON.stringify({ day, file: key, ids }) + "\n";
    }
    if (lines) appendFileSync(p, lines);
  } catch { /* 記録できなくても校正は続ける */ }
}

export function summarize(report, { max = 40, cwd = projectDir() } = {}) {
  const lines = [];
  let total = 0;
  const lv = { must: 0, should: 0, info: 0 };
  for (const f of report.files) {
    total += f.findings.length;
    for (const x of f.findings) lv[x.level]++;
  }
  lines.push(`ja-proofread（台帳 v${report.ledgerVersion}）：指摘 ${total} 件（必ず直す ${lv.must}／直したい ${lv.should}／参考 ${lv.info}）`);
  if (report.lintError) lines.push(`※ textlint が動かなかったため、textlint の指摘（表記・文法・AIっぽい語句）は0件ではなく未確認です：${report.lintError}`);
  for (const w of report.warnings || []) lines.push(`※ ${w}`);
  let shown = 0;
  const order = { must: 0, should: 1, info: 2 };
  for (const f of report.files) {
    if (!f.findings.length) continue;
    lines.push(`\n■ ${relative(cwd, f.file) || f.file}（${f.profile}）`);
    const sorted = [...f.findings].sort((a, b) => order[a.level] - order[b.level] || (a.line || 0) - (b.line || 0));
    for (const x of sorted) {
      if (shown >= max) break;
      const label = { must: "必ず", should: "直したい", info: "参考" }[x.level];
      lines.push(`- [${label}] ${x.line ? `${x.line}行: ` : ""}${x.message}（${x.ruleId}）`);
      shown++;
    }
  }
  if (shown < total) lines.push(`\n…ほか ${total - shown} 件。全件は proofread.mjs --json で確認できます。`);
  return { text: lines.join("\n"), total, levels: lv };
}
