// 台帳と辞書の正規表現が、校正のたびに重くならないかを確かめる。依存なし（Node 標準のみ）
//
//   入れ子の量指定子（(あ+)+い など）は形で拒否する
//   繰り返すグループの中の選択（(?:漢|漢字?)+ など）も形で拒否する。選択肢が重なると、長い文で止まるため。
//     ただし、選択肢がどれも「1文字か文字クラス1つ」で、選択肢どうしが同じ文字に当たらないもの（(?:、|,)+ など）は通す
//     （選択肢がとても多く、確かめる手間が上限を超えるものは、確かめきれないとして拒否する）
//   長い繰り返し文字列（かな・カタカナ・漢字・全角英数字・記号・ASCII の記号・空白と改行の混ざった数万文字・
//     正規表現に出てくる文字×2000 など）で時間を測り、遅いものを拒否する
//   長さ0で一致し得るもの（空文字、? や * だけ、先読み・後読みだけ、など）を拒否する
//   flags は i m s u（と g）だけ。同じ文字を2回書いたもの（gg など）は拒否する
//
// 時間を測る部分は、止まらない正規表現でも打ち切れるよう別プロセスで動かす。
// 何件あっても子プロセスは1つで、その中の worker_threads で1件ずつ測り、1件ごとに打ち切る（node regex-safety.mjs --probe-batch）
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync, writeSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

const SELF = fileURLToPath(import.meta.url);
export const MAX_MS = 200;
export const KILL_MS = 1000;
// グループの入れ子の深さの上限。これより深いものは、確かめる途中で関数の呼び出しが深くなりすぎるため、安全と確かめられないとして拒否する
export const MAX_DEPTH = 200;
// 締め切りを越えて確かめ終わらなかったときに投げる印（shapeProblem の中から checkShape まで戻す）
const PENDING = Symbol("pending");

// 量指定子を読む。返すのは { len, max }（max は繰り返しの上限。上限なしは Infinity）。
// 回数が決まっている {n} は、文字の取り方が1通りなので繰り返しとして扱わない（max を 1 にする）
function quantAt(src, i) {
  const c = src[i];
  if (c === "*" || c === "+") return { len: 1 + (src[i + 1] === "?" ? 1 : 0), max: Infinity };
  if (c === "?") return { len: 1 + (src[i + 1] === "?" ? 1 : 0), max: 1 };
  if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}\??/.exec(src.slice(i));
    if (!m) return null;
    const max = m[2] === undefined ? 1 : m[3] === "" ? Infinity : Number(m[3]);
    return { len: m[0].length, max };
  }
  return null;
}

// 量指定子の最小の回数。返すのは { len, min }
function quantMin(src, i) {
  const c = src[i];
  if (c === "*" || c === "?") return { len: 1 + (src[i + 1] === "?" ? 1 : 0), min: 0 };
  if (c === "+") return { len: 1 + (src[i + 1] === "?" ? 1 : 0), min: 1 };
  if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}\??/.exec(src.slice(i));
    if (!m) return null;
    return { len: m[0].length, min: Number(m[1]) };
  }
  return null;
}

// 一致する文字列の最短の長さ（文字の数の下限）。0 なら空文字に一致し得る。
// 後方参照は 0 と数える（安全側）。正しい正規表現であることは先に new RegExp で確かめておく
export function minLength(src) {
  let i = 0, depth = 0;
  function alt() {
    let best = seq();
    while (src[i] === "|") { i++; best = Math.min(best, seq()); }
    return best;
  }
  function seq() {
    let total = 0;
    while (i < src.length && src[i] !== "|" && src[i] !== ")") {
      const a = atom();
      const q = quantMin(src, i);
      if (q) { total += a * q.min; i += q.len; } else total += a;
    }
    return total;
  }
  function atom() {
    const c = src[i];
    if (c === "\\") {
      const d = src[i + 1];
      if (d === "b" || d === "B") { i += 2; return 0; }
      if (/[1-9]/.test(d)) { i += 1; while (/\d/.test(src[i])) i++; return 0; }
      if (d === "k" && src[i + 2] === "<") { i = src.indexOf(">", i) + 1; return 0; }
      if ((d === "p" || d === "P" || d === "u") && src[i + 2] === "{") { i = src.indexOf("}", i) + 1; return 1; }
      if (d === "u" && /^[0-9a-fA-F]{4}/.test(src.slice(i + 2))) { i += 6; return 1; }
      if (d === "x" && /^[0-9a-fA-F]{2}/.test(src.slice(i + 2))) { i += 4; return 1; }
      if (d === "c" && /[A-Za-z]/.test(src[i + 2] || "")) { i += 3; return 1; }
      i += 2;
      return 1;
    }
    if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
      i++;
      return 1;
    }
    if (c === "(") {
      // 入れ子が深すぎると呼び出しが深くなりすぎる（RangeError で校正全体が止まる）ので、先に止める
      if (++depth > MAX_DEPTH) throw new RangeError(`グループの入れ子が ${MAX_DEPTH} 段を超えています`);
      const m = /^\((?:\?(?:(=|!|<=|<!)|:|<[A-Za-z_$][\w$]*>))?/.exec(src.slice(i));
      i += m[0].length;
      const inner = alt();
      depth--;
      i++; // )
      return m[1] ? 0 : inner; // 先読み・後読みは文字を取らない
    }
    if (c === "^" || c === "$") { i++; return 0; }
    i += src.codePointAt(i) > 0xffff ? 2 : 1;
    return 1;
  }
  return alt();
}

// グループの入れ子のいちばん深い段数（エスケープと文字クラスの中は数えない）。再帰しないので、深くても止まらない
export function groupDepth(src) {
  let depth = 0, max = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") { for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++; continue; }
    if (c === "(") max = Math.max(max, ++depth);
    else if (c === ")") depth--;
  }
  return max;
}

// 1つの選択肢が「1文字か文字クラス1つ」か（\s \d \p{…} 　 . [^…] などを含む）
const SINGLE_ATOM = /^(?:\\u\{[0-9a-fA-F]+\}|\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}|\\c[A-Za-z]|\\[pP]\{[^}]+\}|\\[^1-9bBkc]|\[(?:\\[\s\S]|[^\]\\])*\]|\.|[^\\[\](){}|*+?^$.])$/su;

// グループの中身を、いちばん外の | で分ける
function topAlternatives(content) {
  const parts = [];
  let depth = 0, cur = "";
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === "\\") { cur += c + (content[i + 1] ?? ""); i++; continue; }
    if (c === "[") {
      let j = i + 1;
      for (; j < content.length && content[j] !== "]"; j++) if (content[j] === "\\") j++;
      cur += content.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "|" && depth === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

// 選択肢がどれも1文字か文字クラス1つで、どの2つも同じ文字に当たらないか。
// 当たる文字は、実際に当てて確かめる。u なしは UTF-16 の0〜FFFF。u ありでも、選択肢に BMP の外の文字に当たり得るもの
// （. \S \W \D \p \P 否定の文字クラス \u{…} サロゲートの \uD800〜\uDFFF BMP の外の文字そのもの）が無ければ、
// 0〜FFFFだけを当てる（BMP の外の文字には、どの選択肢も当たらないため）
//
// 速く確かめるため、選択肢を1つずつ当てずに、全部をまとめた正規表現 ^(?:a|b|…)$ を各文字に1回だけ当てる。
// 当たった文字だけを、選択肢を半分ずつにまとめた正規表現（二分木）で確かめ、2つ以上に当たるかを数える。
// 1文字そのものの選択肢と文字クラスの選択肢は、別の木にする（文字クラスをまとめた正規表現は、1文字のものより重いため）。
//
// 確かめる手間（選択肢の重さの合計×当てる文字の数と、当たった文字を木で確かめた分）には上限 MAX_DISJOINT_WORK を設ける。
// 超えるものは「確かめきれない」（unverifiable）として拒否する。時刻ではなく手間で決まるので、記録に残してよい
const ASTRAL_CAPABLE = /\.|\\[SWDpP]|\[\^|\\u\{|\\u[dD][89a-fA-F]|[\uD800-\uDFFF]/;
// 文字クラスの選択肢（[…] . \s \d \w \p{…} とその否定）。それ以外は1文字そのもの（エスケープを含む）
const CLASS_LIKE = /^(?:\[|\.$|\\[sSdDwWpP])/;
// 文字クラスの選択肢の重さ（1文字の選択肢を1とする）。手間を見積もるときに使う
export const CLASS_WEIGHT = 16;
export const MAX_DISJOINT_WORK = 2e9;
const disjointMemo = new Map();
// deadline（performance.now() の値）を渡すと、当てる途中でも一定の文字数ごとに時刻を確かめ、越えたら PENDING を投げる
// （時刻で止まったものは覚えない。手間の上限を超えたものは、時刻によらず決まるので覚える）
const CHECK_EVERY = 4096;
// 返すのは "yes"（重ならない）・"no"（重なる、または1文字か文字クラス1つでない選択肢がある）・"unverifiable"（手間の上限を超える）
export function disjointVerdict(content, flags = "", { deadline = Infinity } = {}) {
  const f = [...new Set(String(flags).replace(/[^isu]/g, ""))].join("");
  const key = f + "\0" + content;
  if (disjointMemo.has(key)) return disjointMemo.get(key);
  let v = "no";
  const parts = topAlternatives(content);
  if (parts.length >= 2 && parts.every((p) => SINGLE_ATOM.test(p))) {
    try { v = disjointByScan(parts, f, deadline); }
    catch (e) { if (e === PENDING) throw e; v = "no"; }
  }
  disjointMemo.set(key, v);
  return v;
}

// 互換のため残す。重ならないと確かめられたときだけ true
export function simpleDisjointAlternation(content, flags = "", opts = {}) {
  return disjointVerdict(content, flags, opts) === "yes";
}

// 選択肢をまとめた正規表現の二分木。w はその節の選択肢の重さの合計（当てたときの手間として数える）
function buildTree(parts, f, weight) {
  if (!parts.length) return null;
  const build = (lo, hi) => {
    const node = { re: new RegExp(`^(?:${parts.slice(lo, hi).join("|")})$`, f), w: (hi - lo) * weight, l: null, r: null };
    if (hi - lo > 1) { const mid = (lo + hi) >> 1; node.l = build(lo, mid); node.r = build(mid, hi); }
    return node;
  };
  return build(0, parts.length);
}

function disjointByScan(parts, f, deadline) {
  const u = f.includes("u");
  const max = u && parts.some((p) => ASTRAL_CAPABLE.test(p)) ? 0x10ffff : 0xffff;
  const lits = parts.filter((p) => !CLASS_LIKE.test(p));
  const classes = parts.filter((p) => CLASS_LIKE.test(p));
  // まとめた正規表現を全部の文字に1回ずつ当てる手間。先に見積もり、上限を超えるなら当てずに決める
  let work = (max + 1) * (lits.length + classes.length * CLASS_WEIGHT);
  if (work > MAX_DISJOINT_WORK) return "unverifiable";
  const trees = [buildTree(lits, f, 1), buildTree(classes, f, CLASS_WEIGHT)].filter(Boolean);
  // 節 node に当たると分かっている文字 s が、その下の選択肢のいくつに当たるか（need 個まで数えたら止める）
  const count = (node, s, need) => {
    if (!node.l) return 1;
    let n = 0;
    for (const c of [node.l, node.r]) {
      work += c.w;
      if (c.re.test(s)) { n += count(c, s, need - n); if (n >= need) break; }
    }
    return n;
  };
  for (let cp = 0; cp <= max; cp++) {
    if (cp % CHECK_EVERY === 0 && performance.now() >= deadline) throw PENDING;
    // u ありで BMP の中だけを当てるときも、サロゲートの半分は1文字として当てる（u ありの [^…] などと同じ扱い）
    const s = u ? String.fromCodePoint(cp) : String.fromCharCode(cp);
    let n = 0;
    for (const t of trees) {
      if (!t.re.test(s)) continue;
      n += count(t, s, 2 - n);
      if (n >= 2) return "no";
    }
    if (n && work > MAX_DISJOINT_WORK) return "unverifiable";
  }
  return "yes";
}

// 見積もりの重さ（軽いものから確かめる順を決めるためだけに使う）。正規表現の長さと、BMP の外まで当てるか
export function shapeCost(source, flags = "") {
  const src = String(source ?? "");
  return src.length * (String(flags || "").includes("u") && ASTRAL_CAPABLE.test(src) ? 17 : 1);
}

// 形の問題を探す。入れ子の繰り返し、繰り返すグループの中の選択。問題がなければ null
// own：そのグループ自身の | 、deep：中のグループから伝わった、重なり得る | 、
// cands：中のグループから伝わった、重ならない1文字の選択かもしれない | （確かめるのは、繰り返すグループに入っていると分かったときだけ。
// 重ならないかを当てて確かめるのは時間がかかるため、繰り返さないグループでは確かめない）
// deadline を渡すと、重ならないかを当てて確かめる途中で締め切りを見る。越えたら "pending" を返す
export function shapeProblem(src, flags = "", { deadline = Infinity } = {}) {
  try { return shapeProblemInner(src, flags, deadline); }
  catch (e) { if (e === PENDING) return "pending"; throw e; }
}
function shapeProblemInner(src, flags, deadline) {
  const frame = (start) => ({ rep: false, own: false, deep: false, cands: [], start });
  const stack = [frame(0)];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
      const q = quantAt(src, i + 1);
      if (q) { if (q.max > 1) stack[stack.length - 1].rep = true; i += q.len; }
      continue;
    }
    if (c === "|") { stack[stack.length - 1].own = true; continue; }
    if (c === "(") {
      let start = i + 1;
      if (src[i + 1] === "?") {
        const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(src.slice(i + 1));
        if (m) { i += m[0].length; start = i + 1; }
      }
      stack.push(frame(start));
      continue;
    }
    if (c === ")") {
      const g = stack.length > 1 ? stack.pop() : frame(i);
      const q = quantAt(src, i + 1);
      const repeated = !!q && q.max > 1;
      // このグループ自身の | が、重ならない1文字の選択の候補か（候補でなければ、重なり得る選択）
      const cand = g.own && !g.deep && !g.rep ? src.slice(g.start, i) : null;
      const deep = g.deep || (g.own && cand === null);
      const cands = cand === null ? g.cands : [...g.cands, cand];
      if (repeated && g.rep) return "nested";
      if (repeated && deep) return "alternation";
      if (repeated) {
        for (const x of cands) {
          const v = disjointVerdict(x, flags, { deadline });
          if (v === "no") return "alternation";
          if (v === "unverifiable") return "unverifiable";
        }
      }
      const parent = stack[stack.length - 1];
      if (g.rep || repeated) parent.rep = true;
      // 中の選択は外のグループにも残る（(?:(?:a|aa))+ も拒否する）。繰り返して確かめ終えた候補は、もう伝えない
      if (deep) parent.deep = true;
      // 1つずつ足す（push(...cands) は、選択肢のとても多い正規表現で引数が多すぎて RangeError になるため）
      if (!repeated) for (const x of cands) parent.cands.push(x);
      if (q) i += q.len;
      continue;
    }
    const q = quantAt(src, i);
    if (q) { if (q.max > 1) stack[stack.length - 1].rep = true; i += q.len - 1; }
  }
  return null;
}

// グループの中に繰り返しがあり、そのグループ自体も繰り返す形を探す（互換のため残す）
export function nestedQuantifier(src) {
  return shapeProblem(src) === "nested";
}

// 時間を測る見本。どの正規表現にも使う固定の見本と、その正規表現に出てくる文字から作る見本
const BASE = [
  "あ", "ア", "ー", " ", "\n", "\t", "a", "1", "。", "、", "あア", "ア・", "漢", "漢字", "々", "Ａ", "１", "＊", "■", "（", "　", "／",
  "-", "=", "|", "#", "*", ".", "_", "/", "+", "~", ":", ";", ",", "!", "?", "(", ")", "[", "]", "{", "}", "<", ">", "@", "$", "%", "&", "^", "\\", "`", "\"", "'", " \n", "-.",
];
const FIXED = (() => {
  const out = ["", "あいう\nかきく", "。\n\n"];
  for (const b of BASE) { out.push(b.repeat(40)); out.push(b.repeat(40) + "!"); out.push(b.repeat(2000)); }
  // 空白と改行の混ざった数万文字（^\s* のように改行をまたいで戻る形は、ここで2乗に遅くなる）
  out.push("  \n\t \n\n   \n".repeat(4000));
  return out;
})();

// 正規表現の中のエスケープ1つを、それが表す1文字にする（\p{…} や \b などは null）
function escapeChar(src, i) {
  const d = src[i + 1];
  let m;
  if ((m = /^\\u\{([0-9a-fA-F]+)\}/.exec(src.slice(i))) && parseInt(m[1], 16) <= 0x10ffff) return { ch: String.fromCodePoint(parseInt(m[1], 16)), end: i + m[0].length };
  if ((m = /^\\u([0-9a-fA-F]{4})/.exec(src.slice(i)))) return { ch: String.fromCharCode(parseInt(m[1], 16)), end: i + 6 };
  if ((m = /^\\x([0-9a-fA-F]{2})/.exec(src.slice(i)))) return { ch: String.fromCharCode(parseInt(m[1], 16)), end: i + 4 };
  if ((d === "p" || d === "P") && src[i + 2] === "{") return { ch: null, end: src.indexOf("}", i) + 1 || i + 2 };
  const map = { t: "\t", n: "\n", r: "\r", f: "\f", v: "\v", s: " ", S: "a", d: "1", D: "a", w: "a", W: "-", 0: "\0" };
  if (d === undefined || d === "b" || d === "B" || /[1-9]/.test(d)) return { ch: null, end: i + 2 };
  return { ch: map[d] ?? d, end: i + 2 };
}

// 正規表現に出てくる文字（文字そのもの、エスケープ、文字クラスの中の文字と範囲の両端）を、出てきた順に最大40個
export function regexChars(src) {
  const out = new Set();
  const add = (ch) => { if (ch && out.size < 40) out.add(ch); };
  for (let i = 0; i < src.length && out.size < 40; i++) {
    const c = src[i];
    if (c === "\\") { const e = escapeChar(src, i); add(e.ch); i = e.end - 1; continue; }
    if (c === "[") {
      let j = i + 1;
      if (src[j] === "^") j++;
      for (; j < src.length && src[j] !== "]"; j++) {
        if (src[j] === "\\") { const e = escapeChar(src, j); add(e.ch); j = e.end - 1; continue; }
        const cp = src.codePointAt(j);
        add(String.fromCodePoint(cp));
        if (cp > 0xffff) j++;
      }
      i = j;
      continue;
    }
    if ("()|*+?^$.".includes(c)) continue;
    const cp = src.codePointAt(i);
    add(String.fromCodePoint(cp));
    if (cp > 0xffff) i++;
  }
  return [...out];
}

export function samplesFor(pattern) {
  const chars = regexChars(pattern).filter((c) => !BASE.includes(c));
  const out = [...FIXED];
  for (const c of chars) { out.push(c.repeat(2000)); out.push(c.repeat(40) + "\u0001"); }
  const all = regexChars(pattern);
  for (let k = 0; k + 1 < all.length && k < 10; k++) out.push((all[k] + all[k + 1]).repeat(1000));
  return out;
}

function probe(pattern, flags) {
  const re = new RegExp(pattern, flags + "g");
  let empty = false;
  const t0 = process.hrtime.bigint();
  for (const s of samplesFor(pattern)) {
    for (const m of s.matchAll(re)) { if (m[0].length === 0) { empty = true; break; } }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, empty };
}

// 形と書き方だけを確かめる（速い）。問題の説明の配列を返す（問題がなければ空）。
// allowEmpty：長さ0の一致を問題にしない（prh の targets の file のように、本文ではなくファイルのパスに当てるもの）
// deadline（performance.now() の値）を渡すと、締め切りまでに確かめ終わらなかったときは pending の印がついた空の配列を返す
// （問題があるとも無いとも決めていないので、記録に残さず、次の校正で確かめ直す）
export function checkShape(pattern, flags = "", { allowEmpty = false, deadline = Infinity } = {}) {
  if (typeof pattern !== "string" || !pattern) return ["正規表現が空です"];
  const raw = String(flags ?? "");
  if (!/^[gimsu]*$/.test(raw)) return [`flags に使えるのは i m s u だけです（${flags}）`];
  if (new Set(raw).size !== raw.length) return [`flags に同じ文字が2回以上あります（${flags}）`];
  const f = raw.replace("g", "");
  if (groupDepth(pattern) > MAX_DEPTH) return [`グループの入れ子が ${MAX_DEPTH} 段を超えているため、安全と確かめられず使えません`];
  try { new RegExp(pattern, f); } catch (e) { return [`正規表現が不正です（${e.message}）`]; }
  const shape = shapeProblem(pattern, f, { deadline });
  if (shape === "pending") { const out = []; Object.defineProperty(out, "pending", { value: true }); return out; }
  if (shape === "nested") return ["繰り返しの中に繰り返しがあります（(あ+)+ のような形）。長い文で止まるおそれがあるため使えません"];
  if (shape === "unverifiable") return [`繰り返すグループの中の選択肢が多く、互いに同じ文字に当たらないかを確かめる手間が上限（${MAX_DISJOINT_WORK / 1e8}億）を超えるため、安全と確かめられず使えません。選択肢をいくつかの文字クラス（[…]）にまとめるか、規則を分けてください`];
  if (shape === "alternation") return ["繰り返すグループの中に | があります（(?:漢|漢字?)+ のような形）。選択肢が重なると長い文で止まるおそれがあるため使えません。[漢字] のような文字クラスにするか、繰り返しの外で選んでください（選択肢がどれも1文字か文字クラス1つで、互いに同じ文字に当たらないときは使えます）"];
  let min;
  try { min = minLength(pattern); } catch (e) { return [`形を確かめられませんでした（${String(e?.message || e).slice(0, 100)}）`]; }
  if (!allowEmpty && min === 0) return ["長さ0の文字列に一致し得ます（空文字、? や * だけの形、先読み・後読みだけの形など）"];
  return [];
}

// 測れなかった（子プロセスや worker が止まった）結果の印。一時的な失敗かもしれないので、記録には残さない
export function unmeasured(why) {
  const out = [`時間を測れませんでした（${String(why).slice(0, 200)}）`];
  Object.defineProperty(out, "transient", { value: true });
  return out;
}

// 時間を測った結果を、問題の説明の配列にする
function verdict(res, item = {}) {
  if (res.timeout) return [`長い繰り返しの文字列で ${KILL_MS / 1000} 秒以内に終わりませんでした`];
  if (res.error) return unmeasured(res.error);
  const errors = [];
  if (res.empty && !item.allowEmpty) errors.push("長さ0の文字列に一致します（空文字や先読みだけの形）");
  if (res.ms > MAX_MS) errors.push(`長い繰り返しの文字列で ${res.ms.toFixed(0)}ms かかりました（上限 ${MAX_MS}ms）`);
  return errors;
}

// 時間だけを測る。items は形の検査を通った { source, flags, allowEmpty? } の配列。
// 返すのは items と同じ並びの配列で、各要素は問題の説明の配列、または null（budgetMs のうちに測り終えなかったもの）。
// 子プロセスが止まって測れなかったものは、transient の印がついた配列（unmeasured）になる
export function measureRegexes(items, { budgetMs } = {}) {
  const results = new Array(items.length).fill(undefined);
  const flagsOf = (x) => String(x.flags || "").replace("g", "");
  let start = 0;
  const until = budgetMs === undefined ? Infinity : performance.now() + budgetMs;
  while (start < items.length) {
    const left = Math.ceil(until - performance.now());
    if (left <= 0) break;
    const rest = items.slice(start).map((x) => ({ source: x.source, flags: flagsOf(x) }));
    const killAfter = Number.isFinite(left) ? left + KILL_MS * 2 + 5000 : rest.length * (KILL_MS + 500) + 10000;
    const r = spawnSync(process.execPath, [SELF, "--probe-batch"], {
      input: JSON.stringify({ items: rest, budgetMs: Number.isFinite(left) ? left : null }),
      encoding: "utf8", timeout: killAfter, killSignal: "SIGKILL", maxBuffer: 64 * 1024 * 1024,
    });
    let done = null;
    for (const line of (r.stdout || "").split("\n")) {
      if (!line.trim()) continue;
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (o.done) { done = o; continue; }
      if (Number.isInteger(o.i) && o.i >= 0 && start + o.i < items.length && results[start + o.i] === undefined) results[start + o.i] = verdict(o, items[start + o.i]);
    }
    let first = start;
    while (first < items.length && results[first] !== undefined) first++;
    if (first >= items.length) break;
    if (done && done.budget) break; // 時間切れ。残りは測っていない
    if (!done || first === start) {
      // 子プロセスが途中で止まった。測り終えなかった最初の1件は拒否して、その次から続ける
      results[first] = unmeasured(r.error?.message || r.signal || (r.stderr || "").trim().slice(0, 200) || "子プロセスが止まりました");
      start = first + 1;
    } else start = first;
  }
  return results.map((x) => (x === undefined ? null : x));
}

// 正規表現をまとめて確かめる。list は { source, flags } の配列。返すのは同じ並びで、問題の説明の配列か null（時間切れ）
// 形の検査の思わぬ例外（巨大な正規表現など）は、その規則だけの拒否にする（validate と apply が止まらないため）
export function checkRegexes(list, { budgetMs } = {}) {
  const out = list.map((x) => {
    try { return checkShape(x.source, x.flags, x); }
    catch (e) { return [`形を確かめられませんでした（${String(e?.message || e).slice(0, 100)}）`]; }
  });
  const todo = [];
  out.forEach((p, k) => { if (!p.length) todo.push(k); });
  if (todo.length) {
    const measured = measureRegexes(todo.map((k) => list[k]), { budgetMs });
    todo.forEach((k, n) => { out[k] = measured[n]; });
  }
  return out;
}

// 1つの正規表現を確かめ、問題の説明の配列を返す（問題がなければ空）
export function checkRegex(pattern, flags = "") {
  return checkRegexes([{ source: pattern, flags }])[0] ?? ["時間を測れませんでした"];
}

// 検査の中身が変わったら、記録しておいた結果を使い直さないための印。このファイルの中身から作り、
// lib.mjs が読み込まれると、lib.mjs 側の判定（記録の使い方・長さ0を許すもの・辞書の規則の外し方など）の版も足す（addJudgeVersion）
const SELF_HASH = createHash("sha256").update(readFileSync(SELF)).digest("hex");
export let CHECKER_ID = SELF_HASH.slice(0, 12);
export function addJudgeVersion(part) {
  CHECKER_ID = createHash("sha256").update(SELF_HASH).update("\0").update(String(part)).digest("hex").slice(0, 12);
}

// 記録に使う鍵。検査の版・正規表現・flags（と、長さ0を許すか）から作る
export function regexKey(source, flags = "", { allowEmpty = false } = {}) {
  const h = createHash("sha256").update(CHECKER_ID).update("\0").update(String(source)).update("\0").update(String(flags || "").replace("g", ""));
  if (allowEmpty) h.update("\0allowEmpty");
  return h.digest("hex").slice(0, 32);
}

const emit = (o) => writeSync(1, JSON.stringify(o) + "\n");

// 子プロセスの中：worker で1件ずつ測り、KILL_MS のあいだ返事がなければ worker を止めて次へ進む
async function probeBatch() {
  const { items, budgetMs } = JSON.parse(readFileSync(0, "utf8"));
  const deadline = budgetMs == null ? Infinity : performance.now() + budgetMs;
  let next = 0;
  while (next < items.length) {
    if (performance.now() >= deadline) { emit({ done: true, budget: true }); process.exit(0); }
    next = await new Promise((resolveNext) => {
      let last = next - 1, settled = false, timer;
      const w = new Worker(SELF, { workerData: { jaProofreadProbe: true, items, start: next } });
      const finish = (n) => { if (settled) return; settled = true; clearTimeout(timer); resolveNext(n); };
      const arm = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { emit({ i: last + 1, timeout: true }); w.terminate(); finish(last + 2); }, KILL_MS);
      };
      arm();
      w.on("message", (m) => {
        if (settled) return;
        emit(m);
        last = m.i;
        if (performance.now() >= deadline) { w.terminate(); finish(last + 1); return; }
        arm();
      });
      w.on("error", (e) => { if (settled) return; emit({ i: last + 1, error: e.message }); finish(last + 2); });
      w.on("exit", () => finish(last + 1));
    });
  }
  emit({ done: true });
  process.exit(0);
}

if (!isMainThread && workerData?.jaProofreadProbe) {
  const { items, start } = workerData;
  for (let k = start; k < items.length; k++) {
    let r;
    try { r = probe(items[k].source, items[k].flags); } catch (e) { r = { error: e.message }; }
    parentPort.postMessage({ i: k, ...r });
  }
} else if (isMain() && process.argv[2] === "--probe") {
  process.stdout.write(JSON.stringify(probe(process.argv[3], process.argv[4] || "")));
} else if (isMain() && process.argv[2] === "--probe-batch") {
  probeBatch();
}

function isMain() {
  try { return realpathSync(process.argv[1]) === SELF; } catch { return false; }
}
