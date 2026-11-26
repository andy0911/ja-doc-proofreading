#!/usr/bin/env node
// prh の辞書を prh 本体で読み（imports も入る）、組み立てた規則と targets の正規表現を JSON で返す。lib.mjs が子プロセスとして呼ぶ。
// prh は規則を作るときに specs の例文を正規表現に当てるので、危ない正規表現と長い例文の組み合わせで止まることがある。
// そのため、辞書は別プロセスで読み、親（lib.mjs）が時間で打ち切る。
//
//   node prh-load.mjs <依存の node_modules の親> <辞書のパス>
import { createRequire } from "node:module";
import { join } from "node:path";
import { writeSync } from "node:fs";

const [base, file] = process.argv.slice(2);
let out;
try {
  const prh = createRequire(join(base, "package.json"))("prh");
  const engine = prh.fromYAMLFilePath(file);
  const re = (r) => ({ source: r.source, flags: r.flags });
  out = {
    ok: true,
    version: engine.version,
    rules: engine.rules.map((rule) => ({ ...re(rule.pattern), expected: rule.expected, raw: rule.raw })),
    targets: engine.targets.map((t) => ({ file: re(t.file), patterns: [...(t.includes || []), ...(t.excludes || [])].map((x) => re(x.pattern)) })),
  };
} catch (e) {
  out = { ok: false, error: String(e?.message ?? e).split("\n")[0].slice(0, 200) };
}
writeSync(1, JSON.stringify(out));
