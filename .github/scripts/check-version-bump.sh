#!/usr/bin/env bash
# plugins/ を変えたのに plugin.json の version が比べる先（既定は origin/main）より上がっていなければ失敗する。
# 版は x.y.z の数字として比べる（下げた版や、同じ版は通さない）。
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
# 新しい版が古い版より大きければ 0、そうでなければ 1、x.y.z の形でなければ 2 で終わる
cmp=0
node -e '
const p = (v) => /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : null;
const [a, b] = [p(process.argv[1]), p(process.argv[2])];
if (!a || !b) process.exit(2);
for (let i = 0; i < 3; i++) if (b[i] !== a[i]) process.exit(b[i] > a[i] ? 0 : 1);
process.exit(1);
' "$old" "$new" || cmp=$?
if [ "$cmp" -eq 2 ]; then
  echo "::error file=$manifest::version は x.y.z の形にしてください（比べる先 $old / この変更 $new）"
  exit 1
fi
if [ "$cmp" -ne 0 ]; then
  echo "::error file=$manifest::plugins/ を変えたときは plugin.json の version を上げてください（比べる先 $old / この変更 $new）"
  exit 1
fi
echo "版が上がっています"
