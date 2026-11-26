// 文書全体を見て数える構成チェック。textlint の1か所ずつの検出では拾えない型を扱う
// 依存なし（Node 標準のみ）

// コードブロック・インラインコード・URL・HTMLコメントを空白に置き換え、行番号は保つ
export function maskNonProse(text) {
  let t = text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
  t = t.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, (m) => m.replace(/[^\n]/g, " "));
  t = t.replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length));
  t = t.replace(/https?:\/\/\S+/g, (m) => " ".repeat(m.length));
  return t;
}

// 行番号の計算。改行の位置を文書ごとに一度だけ数え、二分探索で引く
let lineCache = { text: null, starts: [] };
function lineOf(text, index) {
  if (lineCache.text !== text) {
    const starts = [0];
    for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    lineCache = { text, starts };
  }
  const s = lineCache.starts;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid] <= index) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
}

// <!-- textlint-disable --> から <!-- textlint-enable --> までの範囲（行番号）。
// ルール名つき（<!-- textlint-disable P001,P008 -->）なら、そのルールだけを外す。enable がなければ文末まで
const DISABLE_RE = /<!--\s*textlint-(disable|enable)\b([^>]*?)-->/g;
export function disabledRanges(text) {
  const ranges = [];
  const open = [];
  for (const m of text.matchAll(DISABLE_RE)) {
    const rules = m[2].split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    const line = lineOf(text, m.index);
    if (m[1] === "disable") open.push({ from: line, start: m.index, rules });
    else {
      // ルール名なしの enable はすべてを閉じる。名前つきは同じ名前の disable を閉じる
      for (let i = open.length - 1; i >= 0; i--) {
        const o = open[i];
        if (!rules.length || rules.join(",") === o.rules.join(",")) {
          ranges.push({ ...o, to: line, end: m.index + m[0].length });
          open.splice(i, 1);
          if (rules.length) break;
        }
      }
    }
  }
  for (const o of open) ranges.push({ ...o, to: Infinity, end: text.length });
  return ranges;
}

function blank(text, ranges) {
  if (!ranges.length) return text;
  const chars = [...text.split("")];
  for (const r of ranges) for (let i = r.start; i < r.end && i < chars.length; i++) if (chars[i] !== "\n") chars[i] = " ";
  return chars.join("");
}

export function proseLength(text) {
  return text.replace(/\s/g, "").length;
}

// 文に分ける（見出し・表・空行を除く）
export function sentences(text) {
  const body = text
    .split("\n")
    .filter((l) => !/^\s*(#|\||[-*+]\s*$|>?\s*$)/.test(l))
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/\*\*/g, ""))
    .join("\n");
  return body
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s。、]/g, "").length >= 2);
}

// 見出しで節に分け、各節の「形」を記号列にする
export function sections(text) {
  const lines = text.split("\n");
  const heads = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6})\s+(.*)$/.exec(l);
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), line: i });
  });
  if (!heads.length) return [];
  // いちばん数の多い見出しレベルを「節」とみなす
  const counts = {};
  for (const h of heads) counts[h.level] = (counts[h.level] || 0) + 1;
  const level = Number(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);
  const hs = heads.filter((h) => h.level === level);
  return hs.map((h, k) => {
    const end = k + 1 < hs.length ? hs[k + 1].line : lines.length;
    // 上位の見出しが来たらそこで切る
    let stop = end;
    for (const h2 of heads) if (h2.line > h.line && h2.line < stop && h2.level < level) stop = h2.line;
    const body = lines.slice(h.line + 1, stop);
    return { title: h.title, line: h.line + 1, body, shape: shapeOf(body) };
  });
}

function shapeOf(body) {
  const sig = [];
  let listLen = 0;
  const flushList = () => { if (listLen) { sig.push(`L${Math.min(listLen, 6)}`); listLen = 0; } };
  for (const l of body) {
    if (/^\s*$/.test(l)) { flushList(); continue; }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(l)) { listLen++; continue; }
    flushList();
    if (/^#{1,6}\s/.test(l)) sig.push("H");
    else if (/^\s*\|/.test(l)) { if (sig[sig.length - 1] !== "T") sig.push("T"); }
    else if (/^\s*>/.test(l)) { if (sig[sig.length - 1] !== "Q") sig.push("Q"); }
    else if (/^\s*(?:\*\*)?[^\s:：*]{1,12}(?:\*\*)?[：:]/.test(l)) sig.push("C");
    else sig.push("P");
  }
  flushList();
  return sig.join(" ");
}

function listsIn(text) {
  const lists = [];
  let cur = 0;
  for (const l of text.split("\n")) {
    if (/^(?:[-*+]|\d+[.)])\s+/.test(l)) cur++;
    else if (/^\s+(?:[-*+]|\d+[.)])\s+/.test(l)) continue; // 入れ子は数えない
    else { if (cur) lists.push(cur); cur = 0; }
  }
  if (cur) lists.push(cur);
  return lists;
}

const DETECTORS = {
  "repeated-skeleton"(text, p) {
    const secs = sections(text).filter((s) => s.shape.length > 0);
    const minRun = p.detect.threshold?.minRun ?? 4;
    const groups = new Map();
    for (const s of secs) {
      if (s.shape.split(" ").length < 2) continue; // 1要素だけの節は比べない
      if (!groups.has(s.shape)) groups.set(s.shape, []);
      groups.get(s.shape).push(s);
    }
    const out = [];
    for (const [shape, ss] of groups) {
      if (ss.length >= minRun) {
        out.push({ line: ss[0].line, message: `${ss.length}つの節が同じ形（${shape}）で並んでいます：${ss.slice(0, 6).map((s) => `「${s.title}」`).join("、")}${ss.length > 6 ? "ほか" : ""}` });
      }
    }
    return out;
  },
  triplets(text, p) {
    const th = p.detect.threshold || {};
    const re = /(?:3|３|三)つ(?:の|に|目)|(?:3|３|三)(?:点|段階|ステップ|本柱|要素|原則)/g;
    const hits = [...text.matchAll(re)];
    const lists = listsIn(text);
    const threes = lists.filter((n) => n === 3).length;
    const ratio = lists.length ? threes / lists.length : 0;
    const out = [];
    if (hits.length >= (th.minCount ?? 3)) {
      out.push({ line: lineOf(text, hits[0].index), message: `「3つの〜」の形が ${hits.length} 回あります（${[...new Set(hits.map((h) => h[0]))].join("、")}）` });
    }
    if (lists.length >= 3 && ratio >= (th.listRatio ?? 0.6)) {
      out.push({ line: 1, message: `箇条書き ${lists.length} 個のうち ${threes} 個がちょうど3項目です` });
    }
    return out;
  },
  "closing-lines"(text, p) {
    const re = new RegExp(p.detect.pattern);
    const secs = sections(text);
    const out = [];
    const targets = secs.length ? secs.map((s) => ({ line: s.line, body: s.body, start: s.line })) : [{ line: 1, body: text.split("\n"), start: 0 }];
    for (const s of targets) {
      const sents = sentences(s.body.join("\n"));
      const last = sents[sents.length - 1];
      if (last && last.length <= 40 && re.test(last)) {
        const idx = s.body.findIndex((l) => l.includes(last.slice(0, 8)));
        out.push({ line: s.start + (idx >= 0 ? idx + 1 : 0), message: `節の最後が決め台詞の形です：「${last}」` });
      }
    }
    return out.length >= (p.detect.threshold?.minCount ?? 2) ? out : [];
  },
  "sentence-length"(text, p) {
    const th = p.detect.threshold || {};
    const s = sentences(text).map((x) => x.length);
    if (s.length < (th.minSentences ?? 15)) return [];
    const mean = s.reduce((a, b) => a + b, 0) / s.length;
    const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
    const cv = sd / mean;
    if (cv <= (th.maxCv ?? 0.3)) {
      return [{ line: 1, message: `文の長さのばらつきが小さめです（${s.length}文、平均${mean.toFixed(0)}字、変動係数${cv.toFixed(2)}）` }];
    }
    return [];
  },
};

export function stats(text) {
  const masked = maskNonProse(text);
  const s = sentences(masked).map((x) => x.length);
  const mean = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
  const sd = s.length ? Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length) : 0;
  return { chars: proseLength(masked), sentences: s.length, meanLen: mean, sdLen: sd, cv: mean ? sd / mean : 0 };
}

export function runStructureChecks(text, ledger, profile = "doc") {
  // textlint-disable の範囲は、件数と構成のチェックからも外す（範囲を空白にして行番号は保つ）
  const ranges = disabledRanges(text);
  const all = ranges.filter((r) => !r.rules.length);
  const named = ranges.filter((r) => r.rules.length);
  const base = blank(text, all);
  const maskedAll = maskNonProse(base);
  const len = Math.max(proseLength(maskedAll), 1);
  const out = [];
  for (const p of ledger.patterns) {
    if (p.status !== "active") continue;
    if (p.profiles && !p.profiles.includes(profile)) continue;
    const mine = named.filter((r) => r.rules.includes(p.id));
    const masked = mine.length ? maskNonProse(blank(base, mine)) : maskedAll;
    const t = p.detect?.type;
    if (t === "regex-count") {
      const re = new RegExp(p.detect.pattern, (p.detect.flags || "").replace("g", "") + "g");
      const hits = [...masked.matchAll(re)];
      const th = p.detect.threshold || {};
      const per1000 = (hits.length / len) * 1000;
      const over = hits.length >= (th.minCount ?? 1) && (th.per1000 === undefined || per1000 >= th.per1000 || hits.length >= (th.minCount ?? 1) * 2);
      if (over) {
        const lines = [...new Set(hits.map((h) => lineOf(masked, h.index)))];
        out.push({
          source: "structure", ruleId: p.id, level: p.level, line: lines[0],
          message: `[${p.id}] ${p.name}：${hits.length}回（1000字あたり${per1000.toFixed(1)}回、${lines.slice(0, 8).join("・")}行目${lines.length > 8 ? "ほか" : ""}）。${p.guidance}`,
        });
      }
    } else if (t === "structure" && DETECTORS[p.detect.detector]) {
      for (const h of DETECTORS[p.detect.detector](masked, p)) {
        out.push({ source: "structure", ruleId: p.id, level: p.level, line: h.line, message: `[${p.id}] ${p.name}：${h.message}。${p.guidance}` });
      }
    }
  }
  return out;
}
