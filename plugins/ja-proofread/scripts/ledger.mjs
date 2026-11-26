#!/usr/bin/env node
// 台帳の操作。育てる部分（型・辞書・誤検知の記録）はすべてデータファイルで持つ。
//
//   node ledger.mjs list                      台帳の型を一覧する
//   node ledger.mjs validate                  台帳と辞書の形と正規表現を確かめる（CIでも使う）
//   node ledger.mjs fp <型ID> --text "…" --reason "…"   誤検知を記録する
//   node ledger.mjs stats                     型ごとの検出数と誤検知数。効かない型を見つける
//   node ledger.mjs apply <approved.json>     Notionで承認された候補を台帳と辞書に反映し、版を上げる
//     approved.json の各要素の action: add（新しい型）/ update / retire（廃止）/ prh（表記の統一）
import { readFileSync, writeFileSync, existsSync, appendFileSync, realpathSync, renameSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { ROOT, dataDir, loadLedger, readJSON } from "./lib.mjs";
import { checkRegex } from "./regex-safety.mjs";

const LEDGER = join(ROOT, "data", "ledger.json");
const PRH = join(ROOT, "data", "prh.yml");
const PLUGIN_JSON = join(ROOT, ".claude-plugin", "plugin.json");
const REPO = resolve(ROOT, "..", "..");
const CATEGORIES = ["語彙", "言い回し", "書式", "構成", "表記"];
const LEVELS = ["must", "should", "info"];
const TYPES = ["regex", "regex-count", "structure", "review"];
const DETECTORS = ["repeated-skeleton", "triplets", "closing-lines", "sentence-length"];
const ACTIONS = ["add", "update", "retire", "prh"];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function validateLedger(ledger) {
  const errors = [];
  const ids = new Set();
  if (!/^\d+\.\d+\.\d+$/.test(ledger.version || "")) errors.push("version が x.y.z の形ではありません");
  for (const p of ledger.patterns || []) {
    const where = `${p.id || "(IDなし)"} ${p.name || ""}`;
    if (!/^[PR]\d{3,}$/.test(p.id || "")) errors.push(`${where}: id は P001 / R001 の形にしてください`);
    if (ids.has(p.id)) errors.push(`${where}: id が重複しています`);
    ids.add(p.id);
    if (!p.name) errors.push(`${where}: name がありません`);
    if (!CATEGORIES.includes(p.category)) errors.push(`${where}: category は ${CATEGORIES.join("/")} のどれかです`);
    if (!LEVELS.includes(p.level)) errors.push(`${where}: level は ${LEVELS.join("/")} のどれかです`);
    if (!p.guidance) errors.push(`${where}: guidance（直し方）がありません`);
    if (!["active", "retired"].includes(p.status)) errors.push(`${where}: status は active / retired です`);
    const t = p.detect?.type;
    if (!TYPES.includes(t)) { errors.push(`${where}: detect.type は ${TYPES.join("/")} のどれかです`); continue; }
    if (t === "regex" || t === "regex-count" || p.detect.pattern) {
      for (const e of checkRegex(p.detect.pattern, p.detect.flags)) errors.push(`${where}: ${e}`);
    }
    if (t === "structure" && !DETECTORS.includes(p.detect.detector)) errors.push(`${where}: detector は ${DETECTORS.join("/")} のどれかです`);
    if (t === "review" && !p.id.startsWith("R")) errors.push(`${where}: レビュー観点だけの型は R から始まる id にしてください`);
  }
  return errors;
}

// prh.yml を読む。このリポジトリの書き方（- expected: と patterns: の下に - で1行ずつ）だけに対応する
function unquote(v) {
  v = v.trim();
  if (v.startsWith('"')) return JSON.parse(v);
  if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}
export function parsePrh(text) {
  const rules = [];
  const errors = [];
  let cur = null, inPatterns = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(#|$)/.test(line)) return;
    let m;
    if ((m = /^\s*-\s+expected:\s*(.*)$/.exec(line))) { cur = { expected: unquote(m[1]), patterns: [], line: i + 1 }; rules.push(cur); inPatterns = false; return; }
    if (cur && /^\s+patterns:\s*$/.test(line)) { inPatterns = true; return; }
    if (cur && /^\s+patterns:\s*\S/.test(line)) { errors.push(`prh.yml ${i + 1}行: patterns は1行に1つずつ「- 」で書いてください`); return; }
    if (cur && inPatterns && (m = /^\s+-\s+(.*)$/.exec(line))) { cur.patterns.push(unquote(m[1])); return; }
    if (cur && /^\s+[\w-]+:/.test(line)) { inPatterns = false; return; }
  });
  return { rules, errors };
}

export function validatePrh(parsed) {
  const errors = [...parsed.errors];
  const expected = new Map();
  const patterns = new Map();
  for (const r of parsed.rules) {
    const where = `prh.yml ${r.line}行「${r.expected}」`;
    if (!r.expected) errors.push(`${where}: expected が空です`);
    if (expected.has(r.expected)) errors.push(`${where}: expected が ${expected.get(r.expected)}行と重複しています`);
    expected.set(r.expected, r.line);
    if (!r.patterns.length) errors.push(`${where}: patterns がありません`);
    for (const p of r.patterns) {
      if (!p) { errors.push(`${where}: 空の pattern があります`); continue; }
      if (patterns.has(p)) errors.push(`${where}: pattern「${p}」が ${patterns.get(p)}行と重複しています`);
      patterns.set(p, r.line);
      const m = /^\/(.*)\/([a-z]*)$/.exec(p);
      if (m) for (const e of checkRegex(m[1], m[2])) errors.push(`${where}: pattern ${p}: ${e}`);
    }
  }
  return errors;
}

function bump(v, kind) {
  const [a, b, c] = v.split(".").map(Number);
  return kind === "minor" ? `${a}.${b + 1}.0` : `${a}.${b}.${c + 1}`;
}

function nextId(ledger, prefix) {
  const n = ledger.patterns.filter((p) => p.id.startsWith(prefix)).map((p) => Number(p.id.slice(1)));
  return prefix + String((n.length ? Math.max(...n) : 0) + 1).padStart(3, "0");
}

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
const inside = (child, parent) => child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

// 反映してよい場所か。インストール済みのプラグイン（次の更新で消える）や、git の作業コピーでない場所では反映しない
function repoProblem() {
  const root = real(ROOT);
  const managed = [
    join(homedir(), ".claude", "plugins"),
    process.env.CLAUDE_CONFIG_DIR && join(process.env.CLAUDE_CONFIG_DIR, "plugins"),
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR,
  ].filter(Boolean).map(real);
  for (const m of managed) if (inside(root, m)) return `インストール済みのプラグインの場所（${m}）の下では反映しません。次の更新で消えるためです。`;
  if (!existsSync(join(REPO, ".claude-plugin", "marketplace.json"))) return "マーケットプレイスのリポジトリ（.claude-plugin/marketplace.json がある所）の作業コピーではありません。";
  const g = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: REPO, encoding: "utf8" });
  if (g.error || g.status !== 0) return "git の作業コピーではありません。";
  if (real(g.stdout.trim()) !== real(REPO)) return `git のリポジトリの根（${g.stdout.trim()}）が、マーケットプレイスの根（${REPO}）と一致しません。`;
  return null;
}

const cmd = process.argv[2];

if (cmd === "list") {
  const l = loadLedger();
  console.log(`台帳 v${l.version}（${l.patterns.filter((p) => p.status === "active").length}件が有効）`);
  for (const p of l.patterns) console.log(`${p.id}\t${p.status === "active" ? "" : "[廃止] "}${p.name}\t${p.category}\t${p.level}\t${p.detect.type}`);
} else if (cmd === "validate") {
  const errors = [...validateLedger(loadLedger()), ...validatePrh(parsePrh(readFileSync(PRH, "utf8")))];
  if (errors.length) { console.error(errors.map((e) => "- " + e).join("\n")); process.exit(1); }
  console.log("台帳と辞書に問題はありません");
} else if (cmd === "fp") {
  const id = process.argv[3];
  const text = arg("--text"), reason = arg("--reason");
  if (!id || !text) { console.error('使い方: node ledger.mjs fp <型ID> --text "誤って指摘された文" --reason "なぜ誤検知か"'); process.exit(2); }
  const rec = { day: new Date().toISOString().slice(0, 10), id, text: text.slice(0, 200), reason: reason || "" };
  appendFileSync(join(dataDir(), "false-positives.jsonl"), JSON.stringify(rec) + "\n");
  console.log(`誤検知を記録しました（${id}）。Notion の候補に「誤検知」として登録すると、型の見直しにつながります。`);
  console.log(JSON.stringify({ 候補名: `${id} の誤検知`, 種別: "誤検知", 対象の型ID: id, 例文: rec.text, 理由: rec.reason }, null, 2));
} else if (cmd === "stats") {
  const l = loadLedger();
  const hits = {}, fps = {};
  const read = (f) => existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((x) => { try { return JSON.parse(x); } catch { return null; } }).filter(Boolean) : [];
  // 検出は「日・ファイル・型」ごとに1件と数える（古い形式の counts も1件として読む）
  const seen = new Set();
  for (const h of read(join(dataDir(), "hits.jsonl"))) {
    for (const id of h.ids || Object.keys(h.counts || {})) {
      const k = `${h.day}|${h.file}|${id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      hits[id] = (hits[id] || 0) + 1;
    }
  }
  for (const f of read(join(dataDir(), "false-positives.jsonl"))) fps[f.id] = (fps[f.id] || 0) + 1;
  console.log("型ID\t検出\t誤検知\t判定");
  for (const p of l.patterns) {
    const h = hits[p.id] || 0, f = fps[p.id] || 0;
    const verdict = f >= 5 && f / Math.max(h, 1) >= 0.5 ? "見直し候補（誤検知が半分以上）" : h === 0 ? "まだ検出なし" : "";
    console.log(`${p.id}\t${h}\t${f}\t${verdict}`);
  }
  console.log(`\n検出は、日・ファイル・型ごとに1件と数えています。記録の場所：${dataDir()}`);
} else if (cmd === "apply") {
  const file = process.argv[3];
  if (!file) { console.error("使い方: node ledger.mjs apply <approved.json>"); process.exit(2); }
  const problem = repoProblem();
  if (problem) { console.error(`反映をやめました。${problem}リポジトリの作業コピーで実行してください。`); process.exit(1); }
  let items;
  try { items = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`${file} を読めませんでした（${e.message}）`); process.exit(1); }
  if (!Array.isArray(items)) { console.error("approved.json は配列にしてください"); process.exit(1); }

  // すべてをメモリの上で組み立て、確かめてから書く（途中で失敗してもファイルは変わらない）
  const ledger = JSON.parse(JSON.stringify(loadLedger()));
  const before = JSON.stringify(ledger);
  let prhText = readFileSync(PRH, "utf8");
  if (!prhText.endsWith("\n")) prhText += "\n";
  const errors = [];
  const applied = [];
  let kind = "patch";
  items.forEach((it, n) => {
    const where = `${n + 1}件目`;
    const action = it.action ?? "add";
    if (!ACTIONS.includes(action)) { errors.push(`${where}: 知らない action「${action}」です（${ACTIONS.join("/")}）`); return; }
    if (action === "add") {
      const id = nextId(ledger, it.detect?.type === "review" ? "R" : "P");
      ledger.patterns.push({
        id, name: it.name, category: it.category, level: it.level || "should",
        detect: it.detect, guidance: it.guidance, example: it.example,
        profiles: it.profiles || ["doc", "slide"], source: it.source || "Notion 台帳候補",
        status: "active", since: null,
      });
      applied.push({ notionPageId: it.notionPageId, id, action });
      kind = "minor";
    } else if (action === "prh") {
      if (typeof it.expected !== "string" || !it.expected || !Array.isArray(it.patterns) || !it.patterns.length || it.patterns.some((x) => typeof x !== "string" || !x)) {
        errors.push(`${where}: 表記の統一には expected（文字列）と patterns（文字列の配列）が要ります`);
        return;
      }
      const q = (x) => JSON.stringify(String(x));
      prhText += `  - expected: ${q(it.expected)}\n    patterns:\n${it.patterns.map((x) => `      - ${q(x)}`).join("\n")}\n` + (it.reason ? `    prh: ${q(it.reason)}\n` : "");
      applied.push({ notionPageId: it.notionPageId, id: `prh:${it.expected}`, action });
    } else {
      const p = ledger.patterns.find((x) => x.id === it.id);
      if (!p) { errors.push(`${where}: ${it.id} は台帳にありません`); return; }
      if (action === "retire") p.status = "retired";
      else for (const k of ["name", "category", "level", "detect", "guidance", "example", "profiles"]) if (it[k] !== undefined) p[k] = it[k];
      applied.push({ notionPageId: it.notionPageId, id: p.id, action });
    }
  });
  errors.push(...validateLedger(ledger), ...validatePrh(parsePrh(prhText)));
  if (errors.length) { console.error("反映をやめました。ファイルは変えていません：\n" + errors.map((e) => "- " + e).join("\n")); process.exit(1); }
  const prhChanged = prhText !== readFileSync(PRH, "utf8") && applied.some((a) => a.action === "prh");
  if (JSON.stringify(ledger) === before && !prhChanged) { console.log("変更はありません"); process.exit(0); }

  const plugin = readJSON(PLUGIN_JSON);
  const newVersion = bump(plugin.version, kind);
  for (const p of ledger.patterns) if (p.since === null) p.since = newVersion;
  ledger.version = newVersion;
  ledger.updated = new Date().toISOString().slice(0, 10);
  plugin.version = newVersion;
  const lines = applied.map((a) => {
    if (a.action === "prh") return `- 表記の統一：${a.id.slice(4)}`;
    const p = ledger.patterns.find((x) => x.id === a.id);
    return `- ${{ add: "追加", retire: "廃止", update: "変更" }[a.action]}：${a.id} ${p.name}`;
  });
  const cl = join(REPO, "CHANGELOG.md");
  const head = existsSync(cl) ? readFileSync(cl, "utf8") : "# 変更履歴\n";
  const [title, ...rest] = head.split("\n");
  const outputs = [
    [LEDGER, JSON.stringify(ledger, null, 2) + "\n"],
    [PRH, prhText],
    [PLUGIN_JSON, JSON.stringify(plugin, null, 2) + "\n"],
    [cl, [title, "", `## ${newVersion}（${ledger.updated}）`, ...lines, ...rest].join("\n")],
  ];
  // 一時ファイルに全部書いてから、まとめて置き換える
  const tmps = [];
  try {
    for (const [p, body] of outputs) { const t = `${p}.tmp-${process.pid}`; writeFileSync(t, body); tmps.push([t, p]); }
  } catch (e) {
    for (const [t] of tmps) rmSync(t, { force: true });
    console.error(`反映をやめました。書き込めませんでした（${e.message}）`);
    process.exit(1);
  }
  for (const [t, p] of tmps) renameSync(t, p);
  console.log(`台帳を v${newVersion} にしました`);
  console.log(lines.join("\n"));
  console.log("\nNotion に書き戻す対応表（状態は、プルリクエストを出したら「PR中」、マージしたら「反映済み」）：\n" + JSON.stringify(applied.map((a) => ({ ...a, version: newVersion })), null, 2));
} else {
  console.error("使い方: node ledger.mjs list | validate | fp <型ID> --text … | stats | apply <approved.json>");
  process.exit(2);
}
