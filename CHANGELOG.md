# 変更履歴

## 0.1.2（2026-11-26）
- 独立レビューの指摘を直した。台帳も 0.1.2 にした（P011 の正規表現を変えたため。型の数は同じ）。
- `textlint-disable` の範囲：インラインコードやコードブロックの中に書いた `<!-- textlint-disable -->` を範囲として数えない。これまでは、説明の文に書いただけで以降の指摘がすべて消えていた。
- 文書全体についての指摘（箇条書きの3項目の割合、文の長さのばらつき）は、1行目から始まる `textlint-disable` の範囲で消さない。
- 正規表現の検査：時間を測る見本に、漢字・全角英数字・全角記号・全角空白を足した。繰り返すグループの中の `|`（`(?:漢|漢字?)+` など）を形で拒否する。長さ0で一致し得るもの（`?` や `*` だけ、先読み・後読みだけの形など）を形で拒否する。同梱の台帳と辞書は、この検査を書き換えなしで通る。
- プロジェクトの prh 辞書（設定の `prh`）の `/…/` も同じ検査にかけ、通らない辞書は警告して外す。結果はデータ置き場に記録し、辞書が変わるまで測り直さない。
- フック：textlint が動かなかった回に、前回の結果のうち textlint の分を消さず引き継ぐ。これまでは、textlint が一度落ちると、次に動いたときにもとからある指摘で止めていた。
- フック：依存が入っていないときの注意を1回だけ出す（これまでは3回）。
- `.ja-proofread.json` が JSON として読めないときは、黙って既定値にせず、フックは Claude に知らせ、`proofread.mjs` は終了コード2で止まる。
- 設定の `exclude` は、既定の除外（`.claude/**`、`**/CLAUDE.md`、`**/node_modules/**` など）に足す。これまでは置き換わっていた。
- `install-into-project.mjs`：同梱のフックが入った settings.json は `settings.json.bak` にしない。2回同梱してから `--remove` しても、`.bak` は同梱する前の設定のまま。
- `install-into-project.mjs`：同梱したスキルでは、サブエージェントを接頭辞なしの名前で呼び、同梱した版から install-into-project を動かす案内を消す。
- P011（指示語が文字だけで追えない）：「地下の表示」「壇上の表彰式」「机上の図面」「川上の点検口」のような熟語に当たらないよう、前が漢字のときと、「図」「表」の後に漢字が続くときを外した。
- `ledger.mjs validate`：`profiles` の値、`threshold.minCount`（1以上の整数）などの値、台帳の version と plugin.json・marketplace.json の version が同じかを確かめる。`apply` は marketplace.json の version もそろえる。
- 構成チェックの closing-lines が `detect.flags` を使う。
- CI：`check-version-bump.sh` は、版が上がったかを数字で比べる（下げた版や同じ版は落とす）。
- スキル：サブエージェントを `ja-proofread:structure-reviewer` のように接頭辞つきで呼ぶ。proofread の例から `--profile slide` の固定を外した。grow-ledger の反映（C-4）は作業コピーのスクリプトだけを示し、配る（E）は作業コピーから同梱し直すよう書き直した。
- 文書：SSH で取得する条件（ssh-agent と known_hosts）、`/reload-plugins` と自動更新の待ち時間、`include` の glob の確かめ方、初めて触る文書では以前からある指摘でも1回止まること、同梱をやめたあとのコミット、プラグインと同梱を両方使うと記録が分かれること、Projects のスレッドを Remote Control で動かす案（未確認）を書いた。

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
