#!/usr/bin/env bash
# plugins/ を変えたのに plugin.json の version が比べる先（既定は origin/main）と同じなら失敗する。
# 使い方：bash .github/scripts/check-version-bump.sh [比べる先]
set -eu
base="${1:-origin/main}"
manifest=plugins/ja-proofread/.claude-plugin/plugin.json
if [ -z "$(git diff --name-only "$base"...HEAD -- plugins/)" ]; then
  echo "plugins/ に変更はありません"
  exit 0
fi
old=$(git show "$base:$manifest" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>console.log(JSON.parse(s).version))')
new=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$manifest")
echo "比べる先: $old / この変更: $new"
if [ "$old" = "$new" ]; then
  echo "::error file=$manifest::plugins/ を変えたときは plugin.json の version を上げてください（今は $new のまま）"
  exit 1
fi
