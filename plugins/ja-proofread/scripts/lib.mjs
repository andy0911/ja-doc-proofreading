// 共通処理：設定の読み込み、依存の場所、textlint の実行、構成チェックの集約
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, rmSync, mkdtempSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir, homedir } from "node:os";
import { runStructureChecks, disabledRanges, useMarkdownParser } from "./structure-check.mjs";
import { checkShape, measureRegexes, regexKey } from "./regex-safety.mjs";

// プラグインとして入れても、プロジェクトに同梱しても動くよう、スクリプトの位置から根を決める
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// データ置き場（依存・検出の記録・誤検知の記録・フックの前回結果）。
// フックには CLAUDE_PLUGIN_DATA が渡る。スキルから動かすときは JA_PROOFREAD_DATA に同じ場所を渡す。
export function dataDir() {
  const d =
    process.env.JA_PROOFREAD_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ja-proofread");
  mkdirSync(d, { recursive: true });
  return d;
}

export function depsDir() {
  return join(dataDir(), "deps");
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
  const inRoot = join(ROOT, "node_modules", "textlint", "bin", "textlint.js");
  if (existsSync(inRoot)) return inRoot;
  return null;
}

export function depsReady() {
  return textlintBin() !== null;
}

// 入れた依存（textlint と同じ node_modules）から、CommonJS のパッケージを読む。無ければ null
function depsRequire() {
  const bin = textlintBin();
  if (!bin) return null;
  return createRequire(join(resolve(bin, "..", "..", "..", ".."), "package.json"));
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

// tmp を渡すと、プロジェクトの prh 辞書を検査して、通った規則だけを書いた辞書をそこに置く
export function buildTextlintConfig(profile, cfg, { tmp = null } = {}) {
  checkProfile(profile);
  const base = readJSON(join(ROOT, "config", `${profile}.textlintrc.json`));
  const conf = JSON.parse(JSON.stringify(base));
  const warnings = [];
  const extra = [];
  (cfg.prh || []).forEach((p, n) => {
    const abs = resolve(dirname(cfg.path), p);
    if (!existsSync(abs)) { warnings.push(`prh の辞書 ${p} が見つからないため外しました`); return; }
    // プロジェクトの辞書も、同梱の辞書と同じ検査を通す。通らない規則だけを外した辞書を、一時ディレクトリに書いて渡す
    const r = checkedPrhDictionary(abs, p, tmp && join(tmp, `prh-${n}.yml`));
    warnings.push(...r.warnings);
    if (r.path) extra.push(r.path);
  });
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

// 正規表現ごとの検査の記録（データ置き場の regex-checked.json）。通ったものも、拒否したものも残す。
// 鍵は検査の版・正規表現・flags なので、辞書の imports 先を含めて中身が変われば、変わった正規表現だけを測り直す
export const PRH_BUDGET_MS = 20000;
function regexCache() {
  const path = join(dataDir(), "regex-checked.json");
  let data = readJSON(path, {});
  if (!isObject(data)) data = {};
  let dirty = false;
  return {
    get: (k) => (Array.isArray(data[k]) ? data[k] : undefined),
    set: (k, v) => { delete data[k]; data[k] = v; dirty = true; },
    save() {
      if (!dirty) return;
      const keys = Object.keys(data);
      for (const k of keys.slice(0, Math.max(0, keys.length - 20000))) delete data[k];
      try { const t = `${path}.tmp-${process.pid}`; writeFileSync(t, JSON.stringify(data)); renameSync(t, path); } catch { /* 記録できなくても続ける */ }
    },
  };
}

// 正規表現をまとめて確かめる。記録にあるものは使い、無いものだけを測る。返すのは問題の説明の配列か null（時間切れで未確認）
export function checkRegexesCached(list, { budgetMs = PRH_BUDGET_MS } = {}) {
  const cache = regexCache();
  const keys = list.map((x) => regexKey(x.source, x.flags));
  const out = keys.map((k) => cache.get(k));
  const todo = [];
  out.forEach((v, k) => {
    if (v !== undefined) return;
    const shape = checkShape(list[k].source, list[k].flags);
    if (shape.length) { out[k] = shape; cache.set(keys[k], shape); } else todo.push(k);
  });
  // 同じ正規表現は1回だけ測る
  const uniq = [...new Map(todo.map((k) => [keys[k], k])).values()];
  if (uniq.length) {
    const measured = measureRegexes(uniq.map((k) => list[k]), { budgetMs });
    uniq.forEach((k, n) => { if (measured[n]) cache.set(keys[k], measured[n]); });
    for (const k of todo) out[k] = cache.get(keys[k]) ?? null;
  }
  cache.save();
  return out;
}

// プロジェクトの prh 辞書を prh 本体で読み（imports や配列の patterns も入る）、規則ごとに組み立てた正規表現を確かめる。
// 通らない規則は外し、残りを1つの辞書に書き出して、textlint にはそれを渡す。
// 返すのは { path（textlint に渡す辞書。使わないときは null）, warnings }
function checkedPrhDictionary(abs, label, outPath) {
  const prh = loadPrh();
  if (!prh) return { path: null, warnings: [`textlint の依存（prh）が見つからないため、prh の辞書 ${label} は使いません`] };
  let engine;
  try { engine = prh.fromYAMLFilePath(abs); }
  catch (e) { return { path: null, warnings: [`prh の辞書 ${label} を読めないため外しました（${String(e.message).split("\n")[0].slice(0, 200)}）`] }; }
  const items = [];
  engine.rules.forEach((rule, k) => items.push({ kind: "rule", k, source: rule.pattern.source, flags: rule.pattern.flags, name: rule.expected }));
  engine.targets.forEach((t, k) => {
    items.push({ kind: "target", k, source: t.file.source, flags: t.file.flags, name: `targets[${k}].file` });
    for (const x of [...(t.includes || []), ...(t.excludes || [])]) items.push({ kind: "target", k, source: x.pattern.source, flags: x.pattern.flags, name: `targets[${k}]` });
  });
  const results = checkRegexesCached(items);
  const badRules = new Set(), pending = new Set(), msgs = [];
  let badTarget = false;
  items.forEach((it, n) => {
    const r = results[n];
    if (r === null) { if (it.kind === "rule") pending.add(it.k); else badTarget = true; return; }
    if (!r.length) return;
    if (it.kind === "rule") badRules.add(it.k); else badTarget = true;
    msgs.push(`「${it.name}」/${it.source.slice(0, 60)}/: ${r[0]}`);
  });
  const warnings = [];
  const shown = (xs) => `${xs.slice(0, 3).join("／")}${xs.length > 3 ? ` ほか${xs.length - 3}件` : ""}`;
  if (badTarget) return { path: null, warnings: [`prh の辞書 ${label} の targets に使えない正規表現があるか、確かめ終わらなかったため、辞書ごと外しました${msgs.length ? "：" + shown(msgs) : ""}`] };
  if (badRules.size) warnings.push(`prh の辞書 ${label} の ${badRules.size}件の規則に使えない正規表現があるため、その規則だけを外しました：${shown(msgs)}`);
  if (pending.size) warnings.push(`prh の辞書 ${label} の ${pending.size}件の規則は、時間内に確かめ終わらなかったため今回は外しました（次の校正で続きを確かめます）`);
  // 外す規則がなくても、確かめたものと同じ中身を渡すため、書き出したものを使う。
  // 一時ディレクトリがないとき（buildTextlintConfig だけを呼んだとき）は、外す規則がなければ元の辞書を指す
  if (!outPath) return { path: badRules.size || pending.size ? null : abs, warnings };
  if (engine.targets.length) {
    // targets は書き出せないため、外す規則がなければ元の辞書を使い、あれば辞書ごと外す
    if (badRules.size || pending.size) return { path: null, warnings: [...warnings, `prh の辞書 ${label} は targets を使っているため、規則だけを外せず、辞書ごと外しました`] };
    return { path: abs, warnings };
  }
  const kept = engine.rules.filter((_, k) => !badRules.has(k) && !pending.has(k)).map((rule) => rule.raw);
  if (!kept.length) return { path: null, warnings };
  // YAML は JSON を含むので、JSON で書けば prh がそのまま読める。imports は読み込み済みなので書かない
  writeFileSync(outPath, JSON.stringify({ version: engine.version, rules: kept }));
  return { path: outPath, warnings };
}

export function runTextlint(files, profile, cfg) {
  const bin = textlintBin();
  if (!bin) {
    return { ok: false, lintError: "textlint の依存がまだ入っていません。`node " + join(ROOT, "scripts", "ensure-deps.mjs") + "` を実行してください。", results: [], warnings: [] };
  }
  // 設定ファイルと書き出した辞書は、自分だけの一時ディレクトリに固定の名前で置く（profile などの値をパスに使わない）
  const tmp = mkdtempSync(join(tmpdir(), "ja-proofread-"));
  let r, warnings = [];
  try {
    const built = buildTextlintConfig(profile, cfg, { tmp });
    warnings = built.warnings;
    const confPath = join(tmp, "textlintrc.json");
    writeFileSync(confPath, JSON.stringify(built.conf));
    r = spawnSync(process.execPath, [bin, "--config", confPath, "-f", "json", ...files.map((f) => resolve(f))], {
      cwd: resolve(bin, "..", "..", "..", ".."), // node_modules の親。ルールはここから探される
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120000,
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const fail = (why) => ({ ok: false, lintError: why.slice(0, 2000), results: [], warnings });
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

export function proofreadFiles(files, { cfg = loadProjectConfig(), profile } = {}) {
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
  for (const [p, group] of byProfile) {
    const tl = runTextlint(group, p, cfg);
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
