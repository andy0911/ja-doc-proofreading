#!/usr/bin/env node
// 台帳の操作。育てる部分（型・辞書・誤検知の記録）はすべてデータファイルで持つ。
//
//   node ledger.mjs list                      台帳の型を一覧する
//   node ledger.mjs validate                  台帳の形と正規表現を確かめる（CIでも使う）
//   node ledger.mjs fp <型ID> --text "…" --reason "…"   誤検知を記録する
//   node ledger.mjs stats                     型ごとの検出数と誤検知数。効かない型を見つける
//   node ledger.mjs apply <approved.json>     Notionで承認された候補を台帳と辞書に反映し、版を上げる
//     approved.json の各要素の action: add（新しい型）/ update / retire（廃止）/ prh（表記の統一）
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROOT, dataDir, loadLedger, readJSON } from "./lib.mjs";

const LEDGER = join(ROOT, "data", "ledger.json");
const PLUGIN_JSON = join(ROOT, ".claude-plugin", "plugin.json");
const REPO = resolve(ROOT, "..", "..");
const CATEGORIES = ["語彙", "言い回し", "書式", "構成", "表記"];
const LEVELS = ["must", "should", "info"];
const TYPES = ["regex", "regex-count", "structure", "review"];
const DETECTORS = ["repeated-skeleton", "triplets", "closing-lines", "sentence-length"];

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
      try {
        const re = new RegExp(p.detect.pattern, (p.detect.flags || "").replace("g", ""));
        if (re.test("")) errors.push(`${where}: 空文字にも一致する正規表現です`);
      } catch (e) { errors.push(`${where}: 正規表現が不正です（${e.message}）`); }
    }
    if (t === "structure" && !DETECTORS.includes(p.detect.detector)) errors.push(`${where}: detector は ${DETECTORS.join("/")} のどれかです`);
    if (t === "review" && !p.id.startsWith("R")) errors.push(`${where}: レビュー観点だけの型は R から始まる id にしてください`);
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

const cmd = process.argv[2];

if (cmd === "list") {
  const l = loadLedger();
  console.log(`台帳 v${l.version}（${l.patterns.filter((p) => p.status === "active").length}件が有効）`);
  for (const p of l.patterns) console.log(`${p.id}\t${p.status === "active" ? "" : "[廃止] "}${p.name}\t${p.category}\t${p.level}\t${p.detect.type}`);
} else if (cmd === "validate") {
  const errors = validateLedger(loadLedger());
  if (errors.length) { console.error(errors.map((e) => "- " + e).join("\n")); process.exit(1); }
  console.log("台帳に問題はありません");
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
  for (const h of read(join(dataDir(), "hits.jsonl"))) for (const [k, v] of Object.entries(h.counts || {})) hits[k] = (hits[k] || 0) + v;
  for (const f of read(join(dataDir(), "false-positives.jsonl"))) fps[f.id] = (fps[f.id] || 0) + 1;
  console.log("型ID\t検出\t誤検知\t判定");
  for (const p of l.patterns) {
    const h = hits[p.id] || 0, f = fps[p.id] || 0;
    const verdict = f >= 5 && f / Math.max(h, 1) >= 0.5 ? "見直し候補（誤検知が半分以上）" : h === 0 ? "まだ検出なし" : "";
    console.log(`${p.id}\t${h}\t${f}\t${verdict}`);
  }
  console.log(`\n記録の場所：${dataDir()}`);
} else if (cmd === "apply") {
  const file = process.argv[3];
  if (!file) { console.error("使い方: node ledger.mjs apply <approved.json>"); process.exit(2); }
  if (!existsSync(join(REPO, ".claude-plugin", "marketplace.json"))) {
    console.error("リポジトリの作業コピーで実行してください（インストール済みのプラグインを直接書き換えると、次の更新で消えます）。");
    process.exit(1);
  }
  const items = JSON.parse(readFileSync(file, "utf8"));
  const ledger = loadLedger();
  const before = JSON.stringify(ledger);
  const applied = [];
  const prhAdded = [];
  let kind = "patch";
  for (const it of items) {
    const action = it.action || "add";
    if (action === "add") {
      const id = nextId(ledger, it.detect?.type === "review" ? "R" : "P");
      const entry = {
        id, name: it.name, category: it.category, level: it.level || "should",
        detect: it.detect, guidance: it.guidance, example: it.example,
        profiles: it.profiles || ["doc", "slide"], source: it.source || "Notion 台帳候補",
        status: "active", since: null,
      };
      ledger.patterns.push(entry);
      applied.push({ notionPageId: it.notionPageId, id, action });
      kind = "minor";
    } else if (action === "prh") {
      // 表記の統一：prh 辞書に1件足す
      if (!it.expected || !Array.isArray(it.patterns) || !it.patterns.length) { console.error("表記の統一には expected と patterns が要ります"); process.exit(1); }
      const yml = join(ROOT, "data", "prh.yml");
      const q = (x) => JSON.stringify(String(x));
      appendFileSync(yml, `  - expected: ${q(it.expected)}\n    patterns:\n${it.patterns.map((x) => `      - ${q(x)}`).join("\n")}\n` + (it.reason ? `    prh: ${q(it.reason)}\n` : ""));
      prhAdded.push(it.expected);
      applied.push({ notionPageId: it.notionPageId, id: `prh:${it.expected}`, action });
    } else if (action === "retire" || action === "update") {
      const p = ledger.patterns.find((x) => x.id === it.id);
      if (!p) { console.error(`${it.id} は台帳にありません`); process.exit(1); }
      if (action === "retire") p.status = "retired";
      else for (const k of ["name", "category", "level", "detect", "guidance", "example", "profiles"]) if (it[k] !== undefined) p[k] = it[k];
      applied.push({ notionPageId: it.notionPageId, id: p.id, action });
    }
  }
  const errors = validateLedger(ledger);
  if (errors.length) { console.error("反映をやめました。台帳の形に問題があります：\n" + errors.map((e) => "- " + e).join("\n")); process.exit(1); }
  if (JSON.stringify(ledger) === before && !prhAdded.length) { console.log("変更はありません"); process.exit(0); }
  const plugin = readJSON(PLUGIN_JSON);
  const newVersion = bump(plugin.version, kind);
  for (const p of ledger.patterns) if (p.since === null) p.since = newVersion;
  ledger.version = newVersion;
  ledger.updated = new Date().toISOString().slice(0, 10);
  plugin.version = newVersion;
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + "\n");
  writeFileSync(PLUGIN_JSON, JSON.stringify(plugin, null, 2) + "\n");
  const lines = applied.map((a) => {
    if (a.action === "prh") return `- 表記の統一：${a.id.slice(4)}`;
    const p = ledger.patterns.find((x) => x.id === a.id);
    return `- ${{ add: "追加", retire: "廃止", update: "変更" }[a.action]}：${a.id} ${p.name}`;
  });
  const cl = join(REPO, "CHANGELOG.md");
  const head = existsSync(cl) ? readFileSync(cl, "utf8") : "# 変更履歴\n";
  const [title, ...rest] = head.split("\n");
  writeFileSync(cl, [title, "", `## ${newVersion}（${ledger.updated}）`, ...lines, ...rest].join("\n"));
  console.log(`台帳を v${newVersion} にしました`);
  console.log(lines.join("\n"));
  console.log("\nNotion に書き戻す対応表：\n" + JSON.stringify(applied, null, 2));
} else {
  console.error("使い方: node ledger.mjs list | validate | fp <型ID> --text … | stats | apply <approved.json>");
  process.exit(2);
}
