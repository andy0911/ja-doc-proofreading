// 台帳と辞書の正規表現が、校正のたびに重くならないかを確かめる。依存なし（Node 標準のみ）
//
//   入れ子の量指定子（(あ+)+い など）は形で拒否する
//   繰り返すグループの中の選択（(?:漢|漢字?)+ など）も形で拒否する。選択肢が重なると、長い文で止まるため
//   長い繰り返し文字列（かな・カタカナ・漢字・全角英数字・記号・空白×40 など）で時間を測り、遅いものを拒否する
//   長さ0で一致し得るもの（空文字、? や * だけ、先読み・後読みだけ、など）を拒否する
//
// 時間を測る部分は、止まらない正規表現でも打ち切れるよう別プロセスで動かす（node regex-safety.mjs --probe）
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const SELF = fileURLToPath(import.meta.url);
export const MAX_MS = 200;
const KILL_MS = 3000;

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
  let i = 0;
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
      const m = /^\((?:\?(?:(=|!|<=|<!)|:|<[A-Za-z_$][\w$]*>))?/.exec(src.slice(i));
      i += m[0].length;
      const inner = alt();
      i++; // )
      return m[1] ? 0 : inner; // 先読み・後読みは文字を取らない
    }
    if (c === "^" || c === "$") { i++; return 0; }
    i += src.codePointAt(i) > 0xffff ? 2 : 1;
    return 1;
  }
  return alt();
}

// 形の問題を探す。入れ子の繰り返し、繰り返すグループの中の選択。問題がなければ null
export function shapeProblem(src) {
  const stack = [{ rep: false, alt: false }];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
      const q = quantAt(src, i + 1);
      if (q) { if (q.max > 1) stack[stack.length - 1].rep = true; i += q.len; }
      continue;
    }
    if (c === "|") { stack[stack.length - 1].alt = true; continue; }
    if (c === "(") {
      stack.push({ rep: false, alt: false });
      if (src[i + 1] === "?") {
        const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(src.slice(i + 1));
        if (m) i += m[0].length;
      }
      continue;
    }
    if (c === ")") {
      const g = stack.length > 1 ? stack.pop() : { rep: false, alt: false };
      const q = quantAt(src, i + 1);
      if (q && q.max > 1 && g.rep) return "nested";
      if (q && q.max > 1 && g.alt) return "alternation";
      if (g.rep || (q && q.max > 1)) stack[stack.length - 1].rep = true;
      if (g.alt) stack[stack.length - 1].alt = true; // 中の選択は外のグループにも残る（(?:(?:a|aa))+ も拒否する）
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

const SAMPLES = (() => {
  const base = ["あ", "ア", "ー", " ", "\n", "a", "1", "。", "、", "あア", "ア・", "漢", "漢字", "々", "Ａ", "１", "＊", "■", "（", "　", "／"];
  const out = ["", "あいう\nかきく", "。\n\n"];
  for (const b of base) { out.push(b.repeat(40)); out.push(b.repeat(40) + "!"); out.push(b.repeat(2000)); }
  return out;
})();

function probe(pattern, flags) {
  const re = new RegExp(pattern, flags + "g");
  let empty = false;
  const t0 = process.hrtime.bigint();
  for (const s of SAMPLES) {
    for (const m of s.matchAll(re)) { if (m[0].length === 0) { empty = true; break; } }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { ms, empty };
}

// 1つの正規表現を確かめ、問題の説明の配列を返す（問題がなければ空）
export function checkRegex(pattern, flags = "") {
  const errors = [];
  if (typeof pattern !== "string" || !pattern) return ["正規表現が空です"];
  const f = String(flags || "").replace(/g/g, "");
  if (!/^[imsu]*$/.test(f)) return [`flags に使えるのは i m s u だけです（${flags}）`];
  try { new RegExp(pattern, f); } catch (e) { return [`正規表現が不正です（${e.message}）`]; }
  const shape = shapeProblem(pattern);
  if (shape === "nested") return ["繰り返しの中に繰り返しがあります（(あ+)+ のような形）。長い文で止まるおそれがあるため使えません"];
  if (shape === "alternation") return ["繰り返すグループの中に | があります（(?:漢|漢字?)+ のような形）。選択肢が重なると長い文で止まるおそれがあるため使えません。[漢字] のような文字クラスにするか、繰り返しの外で選んでください"];
  if (minLength(pattern) === 0) return ["長さ0の文字列に一致し得ます（空文字、? や * だけの形、先読み・後読みだけの形など）"];
  const r = spawnSync(process.execPath, [SELF, "--probe", pattern, f], { encoding: "utf8", timeout: KILL_MS });
  if (r.error || r.signal) return [`長い繰り返しの文字列で ${KILL_MS / 1000} 秒以内に終わりませんでした`];
  let res;
  try { res = JSON.parse(r.stdout); } catch { return [`時間を測れませんでした（${(r.stderr || "").trim().slice(0, 200)}）`]; }
  if (res.empty) errors.push("長さ0の文字列に一致します（空文字や先読みだけの形）");
  if (res.ms > MAX_MS) errors.push(`長い繰り返しの文字列で ${res.ms.toFixed(0)}ms かかりました（上限 ${MAX_MS}ms）`);
  return errors;
}

// prh の辞書（YAML）から、/…/ の形で書いた pattern を拾う。
// 「- /…/」「pattern: /…/」「patterns: /…/」と、それを "…" や '…' で囲んだ形に対応する（imports 先の辞書は見ない）
export function prhRegexes(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    const m = /^\s*(?:-\s+)?(?:(?:pattern|patterns|regexpMustEmpty)\s*:\s+)?("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|\/.*\/[a-z]*)\s*(?:#.*)?$/.exec(line);
    if (!m) return;
    let v = m[1];
    if (v.startsWith('"')) { try { v = JSON.parse(v); } catch { return; } }
    else if (v.startsWith("'")) v = v.slice(1, -1).replace(/''/g, "'");
    const r = /^\/(.*)\/([a-z]*)$/s.exec(v);
    if (r && r[1]) out.push({ line: i + 1, source: r[1], flags: r[2] });
  });
  return out;
}

// prh の辞書ファイルの正規表現をすべて確かめ、問題の説明の配列を返す
export function checkPrhText(text, name = "prh") {
  const errors = [];
  for (const r of prhRegexes(text)) for (const e of checkRegex(r.source, r.flags)) errors.push(`${name} ${r.line}行 /${r.source}/: ${e}`);
  return errors;
}

// 検査の中身が変わったら、記録しておいた結果を使い直さないための印
export const CHECKER_ID = createHash("sha256").update(readFileSync(SELF)).digest("hex").slice(0, 12);

if (process.argv[2] === "--probe") {
  process.stdout.write(JSON.stringify(probe(process.argv[3], process.argv[4] || "")));
}
