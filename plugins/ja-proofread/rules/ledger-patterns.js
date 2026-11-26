// 台帳（data/ledger.json）の detect.type === "regex" の型を、1か所ずつ textlint の指摘にする
"use strict";
const fs = require("fs");

let cache = null;
function load(ledgerPath) {
  if (cache && cache.path === ledgerPath) return cache.patterns;
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  const patterns = ledger.patterns.filter((p) => p.status === "active" && p.detect && p.detect.type === "regex");
  cache = { path: ledgerPath, patterns };
  return patterns;
}

module.exports = function (context, options = {}) {
  const { Syntax, RuleError, report, getSource } = context;
  if (!options.ledgerPath) return {};
  const profile = options.profile || "doc";
  const disable = options.disable || [];
  const patterns = load(options.ledgerPath).filter((p) => (!p.profiles || p.profiles.includes(profile)) && !disable.includes(p.id));
  return {
    [Syntax.Str](node) {
      const text = getSource(node);
      for (const p of patterns) {
        const re = new RegExp(p.detect.pattern, (p.detect.flags || "").replace("g", "") + "g");
        for (const m of text.matchAll(re)) {
          report(node, new RuleError(`[${p.level}] [${p.id}] ${p.name}：「${m[0]}」。${p.guidance}`, { index: m.index }));
        }
      }
    },
  };
};
