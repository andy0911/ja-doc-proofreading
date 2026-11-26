#!/usr/bin/env node
// 「測る」：AIを使う前に自分で書いた文章を基準にして、新しい文書で急に増えた語や癖を数える。
// 依存なし。単語分割は Node 標準の Intl.Segmenter（ICU）を使う。日本語での精度は未検証。
//
//   node stylometry.mjs build --out baseline.json <自筆の文書...>
//   node stylometry.mjs compare --baseline baseline.json [--json] <新しい文書>
import { readFileSync, writeFileSync } from "node:fs";
import { maskNonProse, sentences } from "./structure-check.mjs";

const seg = new Intl.Segmenter("ja", { granularity: "word" });
const STOP = new Set(["こと", "もの", "ため", "よう", "これ", "それ", "あれ", "ここ", "そこ", "ます", "です", "した", "して", "する", "いる", "ある", "なる", "れる", "られ", "その", "この", "また", "など", "から", "まで", "ので", "のは", "には", "では", "とは"]);

function tokens(text) {
  const out = [];
  for (const s of seg.segment(text)) {
    if (!s.isWordLike) continue;
    const w = s.segment.trim();
    if (w.length < 2 || /^[0-9０-９.,]+$/.test(w) || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

function profile(text) {
  const masked = maskNonProse(text);
  const toks = tokens(masked);
  const freq = {};
  for (const t of toks) freq[t] = (freq[t] || 0) + 1;
  const sl = sentences(masked).map((s) => s.length);
  const mean = sl.length ? sl.reduce((a, b) => a + b, 0) / sl.length : 0;
  const sd = sl.length ? Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / sl.length) : 0;
  const ends = {};
  for (const s of sentences(masked)) {
    const e = /(でしょう|でした|ました|ません|です|ます|である|だ|た|ない)[。！？!?]?$/.exec(s);
    const k = e ? e[1] : "体言止めほか";
    ends[k] = (ends[k] || 0) + 1;
  }
  const chars = masked.replace(/\s/g, "").length;
  const count = (re) => (masked.match(re) || []).length;
  return {
    tokens: toks.length,
    chars,
    sentences: sl.length,
    sentenceLen: { mean, sd, cv: mean ? sd / mean : 0 },
    endings: ends,
    per1000: {
      contrast: (count(/(?:では|じゃ)なく/g) / Math.max(chars, 1)) * 1000,
      labelColon: (count(/^\s*(?:[-*+]\s+)?(?:\*\*)?[^\s:：*]{1,12}(?:\*\*)?[：:]/gm) / Math.max(chars, 1)) * 1000,
      katakana: (count(/[ァ-ヶー]{4,}/g) / Math.max(chars, 1)) * 1000,
    },
    freq,
  };
}

function merge(profiles) {
  const freq = {};
  let tokensN = 0, chars = 0, sentencesN = 0;
  const ends = {};
  const lens = [];
  for (const p of profiles) {
    tokensN += p.tokens; chars += p.chars; sentencesN += p.sentences;
    for (const [k, v] of Object.entries(p.freq)) freq[k] = (freq[k] || 0) + v;
    for (const [k, v] of Object.entries(p.endings)) ends[k] = (ends[k] || 0) + v;
    lens.push(p.sentenceLen);
  }
  const w = (k) => profiles.reduce((a, p) => a + p.per1000[k] * p.chars, 0) / Math.max(chars, 1);
  return {
    tokens: tokensN, chars, sentences: sentencesN,
    sentenceLen: {
      mean: profiles.reduce((a, p) => a + p.sentenceLen.mean * p.sentences, 0) / Math.max(sentencesN, 1),
      sd: profiles.reduce((a, p) => a + p.sentenceLen.sd * p.sentences, 0) / Math.max(sentencesN, 1),
    },
    endings: ends,
    per1000: { contrast: w("contrast"), labelColon: w("labelColon"), katakana: w("katakana") },
    freq,
  };
}

function share(ends) {
  const n = Object.values(ends).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(ends).map(([k, v]) => [k, v / n]));
}

function compare(base, cur) {
  // 語の出現率の比（加算スムージングつき）。基準でまれ、新しい文書で目立つ語を候補にする
  const words = [];
  const V = Object.keys(base.freq).length + 1;
  for (const [w, c] of Object.entries(cur.freq)) {
    if (c < 3) continue;
    const rc = c / cur.tokens;
    const rb = ((base.freq[w] || 0) + 0.5) / (base.tokens + 0.5 * V);
    const ratio = rc / rb;
    if (ratio >= 8) words.push({ word: w, count: c, baseCount: base.freq[w] || 0, ratio: Math.round(ratio) });
  }
  words.sort((a, b) => b.ratio - a.ratio || b.count - a.count);
  const bs = share(base.endings), cs = share(cur.endings);
  const endingShift = Object.keys({ ...bs, ...cs })
    .map((k) => ({ ending: k, base: bs[k] || 0, current: cs[k] || 0, diff: (cs[k] || 0) - (bs[k] || 0) }))
    .filter((x) => Math.abs(x.diff) >= 0.15)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const rates = Object.fromEntries(Object.keys(cur.per1000).map((k) => [k, { base: base.per1000[k], current: cur.per1000[k] }]));
  return {
    caveat: "日本語での精度は未検証です。候補は「自分が普段使わない語かもしれない」という目安で、そのまま台帳に入れず、人が見て判断してください。",
    baseline: { chars: base.chars, sentences: base.sentences },
    current: { chars: cur.chars, sentences: cur.sentences },
    sentenceLen: { base: base.sentenceLen, current: cur.sentenceLen },
    unusualWords: words.slice(0, 30),
    endingShift,
    rates,
    enoughData: base.chars >= 20000,
  };
}

const [cmd, ...rest] = process.argv.slice(2);
const opts = { out: null, baseline: null, json: false };
const files = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === "--out") opts.out = rest[++i];
  else if (rest[i] === "--baseline") opts.baseline = rest[++i];
  else if (rest[i] === "--json") opts.json = true;
  else files.push(rest[i]);
}

if (cmd === "build" && opts.out && files.length) {
  const b = merge(files.map((f) => profile(readFileSync(f, "utf8"))));
  b.builtAt = new Date().toISOString().slice(0, 10);
  b.sourceCount = files.length;
  writeFileSync(opts.out, JSON.stringify(b));
  console.log(`基準を作りました：${files.length}ファイル、${b.chars}字、${b.sentences}文 → ${opts.out}`);
  if (b.chars < 20000) console.log("基準の文章が2万字より少ないため、語の比較はぶれやすくなります。");
} else if (cmd === "compare" && opts.baseline && files.length) {
  const base = JSON.parse(readFileSync(opts.baseline, "utf8"));
  const cur = merge(files.map((f) => profile(readFileSync(f, "utf8"))));
  const r = compare(base, cur);
  if (opts.json) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
  console.log(`自筆の基準（${r.baseline.chars}字）と比べた結果`);
  console.log(`- 文の長さ：基準 平均${r.sentenceLen.base.mean.toFixed(0)}字・ばらつき${r.sentenceLen.base.sd.toFixed(0)} → 今回 平均${r.sentenceLen.current.mean.toFixed(0)}字・ばらつき${r.sentenceLen.current.sd.toFixed(0)}`);
  for (const [k, v] of Object.entries(r.rates)) {
    const name = { contrast: "「ではなく」", labelColon: "ラベル＋コロン行", katakana: "長いカタカナ語" }[k];
    console.log(`- ${name}（1000字あたり）：基準 ${v.base.toFixed(1)} → 今回 ${v.current.toFixed(1)}`);
  }
  for (const e of r.endingShift) console.log(`- 文末「${e.ending}」の割合：基準 ${(e.base * 100).toFixed(0)}% → 今回 ${(e.current * 100).toFixed(0)}%`);
  console.log(r.unusualWords.length ? `- 基準ではまれで今回目立つ語：${r.unusualWords.map((w) => `${w.word}(${w.count}回)`).join("、")}` : "- 基準と比べて目立つ語はありません");
  if (!r.enoughData) console.log("※ 基準が2万字未満のため、語の比較はぶれやすい結果です。");
  console.log(`※ ${r.caveat}`);
} else {
  console.error("使い方:\n  node stylometry.mjs build --out baseline.json <自筆の文書...>\n  node stylometry.mjs compare --baseline baseline.json [--json] <新しい文書...>");
  process.exit(2);
}
