// 共通処理：設定の読み込み、依存の場所、textlint の実行、構成チェックの集約
import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir, homedir } from "node:os";
import { runStructureChecks } from "./structure-check.mjs";

// プラグインとして入れても、プロジェクトに同梱しても動くよう、スクリプトの位置から根を決める
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function dataDir() {
  const d =
    process.env.CLAUDE_PLUGIN_DATA ||
    process.env.JA_PROOFREAD_DATA ||
    join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ja-proofread");
  mkdirSync(d, { recursive: true });
  return d;
}

export function depsDir() {
  return join(dataDir(), "deps");
}

export function depsHash() {
  return createHash("sha256").update(readFileSync(join(ROOT, "package.json"))).digest("hex").slice(0, 16);
}

export function depsReady() {
  const stamp = join(depsDir(), ".stamp");
  return existsSync(stamp) && readFileSync(stamp, "utf8").trim() === depsHash() &&
    existsSync(join(depsDir(), "node_modules", "textlint", "bin", "textlint.js"));
}

export function readJSON(p, fallback = undefined) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return fallback; }
}

export function projectDir() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

// プロジェクトの .ja-proofread.json（無ければ既定値）。hook は、このファイルがあるときだけ動く
export function loadProjectConfig(dir = projectDir()) {
  const p = join(dir, ".ja-proofread.json");
  const user = readJSON(p, null);
  const cfg = {
    exists: user !== null,
    path: p,
    profile: "doc",
    include: ["**/*.md", "**/*.txt"],
    exclude: ["**/node_modules/**", "**/.git/**", "**/CHANGELOG.md"],
    profiles: {},
    disable: [],
    prh: [],
    baseline: null,
    hook: { enabled: true, blockOn: "must" },
    ...(user || {}),
  };
  cfg.hook = { enabled: true, blockOn: "must", ...((user && user.hook) || {}) };
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

// textlint の設定を実行時に組み立てる（辞書や台帳を絶対パスで渡すため）
export const LEDGER_RULE = join(ROOT, "rules", "ledger-patterns.js");

export function buildTextlintConfig(profile, cfg) {
  const base = readJSON(join(ROOT, "config", `${profile}.textlintrc.json`)) || readJSON(join(ROOT, "config", "doc.textlintrc.json"));
  const conf = JSON.parse(JSON.stringify(base));
  const prhPaths = [join(ROOT, "data", "prh.yml"), ...(cfg.prh || []).map((p) => resolve(dirname(cfg.path), p))];
  conf.rules = conf.rules || {};
  conf.rules.prh = { rulePaths: prhPaths };
  // rulesdir のルールには設定を渡せないため、ルールのファイルを絶対パスで指定する
  conf.rules[LEDGER_RULE] = { ledgerPath: join(ROOT, "data", "ledger.json"), profile };
  for (const id of cfg.disable || []) {
    if (id in conf.rules) conf.rules[id] = false;
  }
  return conf;
}

export function runTextlint(files, profile, cfg) {
  if (!depsReady()) {
    return { ok: false, error: "textlint の依存がまだ入っていません。`node " + join(ROOT, "scripts", "ensure-deps.mjs") + "` を実行してください。", results: [] };
  }
  const conf = buildTextlintConfig(profile, cfg);
  const confPath = join(tmpdir(), `ja-proofread-${process.pid}-${profile}.json`);
  writeFileSync(confPath, JSON.stringify(conf));
  const bin = join(depsDir(), "node_modules", "textlint", "bin", "textlint.js");
  const r = spawnSync(process.execPath, [bin, "--config", confPath, "-f", "json", ...files.map((f) => resolve(f))], {
    cwd: depsDir(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  rmSync(confPath, { force: true });
  let results = [];
  try { results = JSON.parse(r.stdout || "[]"); } catch {
    return { ok: false, error: (r.stderr || r.stdout || "textlint が失敗しました").slice(0, 2000), results: [] };
  }
  return { ok: true, results };
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
  for (const f of files) {
    const p = profile || profileFor(f, cfg);
    if (!byProfile.has(p)) byProfile.set(p, []);
    byProfile.get(p).push(f);
  }
  let lintError = null;
  for (const [p, group] of byProfile) {
    const tl = runTextlint(group, p, cfg);
    if (!tl.ok) lintError = tl.error;
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
      const structure = runStructureChecks(text, ledger, p).filter((s) => !(cfg.disable || []).includes(s.ruleId));
      out.push({ file: abs, profile: p, findings: [...lint, ...structure] });
    }
  }
  recordHits(out);
  return { files: out, lintError, ledgerVersion: ledger.version };
}

function recordHits(out) {
  try {
    const p = join(dataDir(), "hits.jsonl");
    const day = new Date().toISOString().slice(0, 10);
    for (const f of out) {
      const counts = {};
      for (const x of f.findings) counts[x.ruleId] = (counts[x.ruleId] || 0) + 1;
      const fileKey = createHash("sha256").update(f.file).digest("hex").slice(0, 12);
      appendFileSync(p, JSON.stringify({ day, file: fileKey, counts }) + "\n");
    }
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
  if (report.lintError) lines.push(`※ textlint は実行できませんでした：${report.lintError}`);
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
