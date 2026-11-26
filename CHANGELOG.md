# 変更履歴

## 0.1.1（2026-11-26）
- 2回の独立レビューの指摘を直した。台帳も 0.1.1 にした（P009 と P011 の正規表現を変えたため。型の数は同じ）。
- 安全：`--profile` と設定の `profiles` は config/ にある名前（doc、slide）だけを受け付ける。textlint の設定は mkdtemp で作った一時ディレクトリに置く。
- 安全：`ledger.mjs validate` と `apply` が、入れ子の量指定子、長い文字列で遅い正規表現、長さ0で一致する正規表現を拒否する。prh の `/…/` も同じ検査をし、重複も止める。
- 安全：`apply` は全件をメモリの上で組み立てて確かめてから書く。知らない action はエラー。インストール済みの場所や git の作業コピーでない場所では動かない。
- 安全：`install-into-project.mjs` は、`.claude/settings.json` が JSON として読めなければ止まり、書く前に `settings.json.bak` を作る（`--remove` も同じ）。
- textlint が落ちたときに「0件」と出さず、textlint が動かなかったと表示する（フックも同じ）。
- フック：`blockOn` の判定の向きを直した。前回の結果になかった指摘だけで止める。200KB を超えるファイルは飛ばす。
- `disable` で、台帳の正規表現の型（P008、P009、P011）、プリセットの中のルール、プリセット全体を止められるようにした。
- `textlint-disable` の範囲を、件数・構成・正規表現の型の検査でも外す。
- 誤検知を減らした。prh は「ユーザビリティ」「サーバント」を、P011 は「以上の通り」「以下の表」を指摘しない。
- 検出の記録は、日・ファイル・型ごとに1件と数える。
- 既定で `.claude/**` と `**/CLAUDE.md` を校正しない。設定の例の `prh` を空にし、無い辞書は警告して外す。
- 依存：package-lock.json を入れ、`npm ci --omit=dev --ignore-scripts` で入れる。ロックの扱いを直し、入れられなかったときは SessionStart で Claude と利用者に知らせる。
- スキルからスクリプトを `${CLAUDE_PLUGIN_ROOT}` で呼び、データ置き場を `JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}"` で渡す。
- CI：plugins/ を変えたのに plugin.json の version が main と同じプルリクエストを落とす。
- 文書：クラウドで動く範囲、手で動かすときのデータ置き場、更新と外し方を書き直した。

## 0.1.0（2026-11-26）
- 最初の版。台帳13型（P001〜P011、R001〜R002）、表記辞書5件。
- スキル3つ（write、proofread、grow-ledger）、サブエージェント2つ（structure-reviewer、fresh-eyes-reader）、フック2つ（SessionStart、PostToolUse）。
- クラウドセッション向けに、プロジェクトへ同梱するスクリプト install-into-project.mjs。
