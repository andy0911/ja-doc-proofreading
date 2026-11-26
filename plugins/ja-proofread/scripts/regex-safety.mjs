// 台帳と辞書の正規表現が、校正のたびに重くならないかを確かめる。依存なし（Node 標準のみ）
//
//   入れ子の量指定子（(あ+)+い など）は形で拒否する
//   長い繰り返し文字列（「あ」×40、カタカナ×40、空白×40 など）で時間を測り、遅いものを拒否する
//   長さ0で一致するもの（空文字、先読みだけ、など）を拒否する
//
// 時間を測る部分は、止まらない正規表現でも打ち切れるよう別プロセスで動かす（node regex-safety.mjs --probe）
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// グループの中に繰り返しがあり、そのグループ自体も繰り返す形を探す
export function nestedQuantifier(src) {
  const stack = [{ rep: false }];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { i++; continue; }
    if (c === "[") {
      for (i++; i < src.length && src[i] !== "]"; i++) if (src[i] === "\\") i++;
      const q = quantAt(src, i + 1);
      if (q) { if (q.max > 1) stack[stack.length - 1].rep = true; i += q.len; }
      continue;
    }
    if (c === "(") {
      stack.push({ rep: false });
      if (src[i + 1] === "?") {
        const m = /^\?(?::|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(src.slice(i + 1));
        if (m) i += m[0].length;
      }
      continue;
    }
    if (c === ")") {
      const g = stack.length > 1 ? stack.pop() : { rep: false };
      const q = quantAt(src, i + 1);
      if (q && q.max > 1 && g.rep) return true;
      if (g.rep || (q && q.max > 1)) stack[stack.length - 1].rep = true;
      if (q) i += q.len;
      continue;
    }
    const q = quantAt(src, i);
    if (q) { if (q.max > 1) stack[stack.length - 1].rep = true; i += q.len - 1; }
  }
  return false;
}

const SAMPLES = (() => {
  const base = ["あ", "ア", "ー", " ", "\n", "a", "1", "。", "、", "あア", "ア・"];
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
  if (nestedQuantifier(pattern)) return ["繰り返しの中に繰り返しがあります（(あ+)+ のような形）。長い文で止まるおそれがあるため使えません"];
  const r = spawnSync(process.execPath, [SELF, "--probe", pattern, f], { encoding: "utf8", timeout: KILL_MS });
  if (r.error || r.signal) return [`長い繰り返しの文字列で ${KILL_MS / 1000} 秒以内に終わりませんでした`];
  let res;
  try { res = JSON.parse(r.stdout); } catch { return [`時間を測れませんでした（${(r.stderr || "").trim().slice(0, 200)}）`]; }
  if (res.empty) errors.push("長さ0の文字列に一致します（空文字や先読みだけの形）");
  if (res.ms > MAX_MS) errors.push(`長い繰り返しの文字列で ${res.ms.toFixed(0)}ms かかりました（上限 ${MAX_MS}ms）`);
  return errors;
}

if (process.argv[2] === "--probe") {
  process.stdout.write(JSON.stringify(probe(process.argv[3], process.argv[4] || "")));
}
