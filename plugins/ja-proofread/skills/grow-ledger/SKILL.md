---
name: grow-ledger
description: 校正の「型の台帳」を育てるときに使う。新しい型の候補を Notion に登録する、承認された候補を台帳に反映してバージョンを上げる、誤検知を記録する、効かない型を見直す、自分が書いた文章を基準に語の癖を測る、と頼まれたとき。proofread スキルで台帳にない型が見つかったときにも使う。
---

# 台帳を育てる（見つける → 測る → 戻す）

台帳は、AIの文章に出やすい型を集めたデータです。決まった一覧だけでは、まだ誰も名前をつけていない型は拾えません。そこで、読者役テストの自由回答などで新しい型を「見つけ」、本人の過去の文章を基準に「測り」、本人が承認したものだけを台帳に「戻し」ます。

| 置き場所 | 中身 | 誰が書くか |
|---|---|---|
| Notion「文章校正 台帳候補」 | 候補の受付と承認 | Claude が登録、本人が承認 |
| `data/ledger.json` | 承認済みの型（検出方法と直し方） | `ledger.mjs apply` だけ |
| `data/prh.yml` | 表記の統一辞書 | `ledger.mjs apply` だけ |
| プラグインのデータ置き場 | 検出の記録、誤検知の記録 | スクリプトが自動で |

Notion の場所は `${CLAUDE_PLUGIN_ROOT}/data/settings.json` に書いてあります。プロジェクトの `.ja-proofread.json` に `notion.dataSourceUrl` があれば、そちらを使います。

スクリプトは、下のコマンドの形のまま動かします。頭の `JA_PROOFREAD_DATA=…` は、書いた直後のフックと同じデータ置き場を使うためのものです。外すと、検出の記録と誤検知の記録が別の場所に分かれ、`stats` の数が合わなくなります。

## 承認についての約束

「状態」を「承認」にするのは本人だけです。これは Claude への指示による約束で、仕組みで止めているわけではありません。Notion の権限があれば、Claude も含めて誰でも「承認」に変えられます。Claude は、本人に頼まれても「承認」には変えず、本人に Notion で変えてもらいます。反映（C）の前には、承認した人が本人かを Notion の更新履歴で確かめられるよう、対象の行を本人に見せます。

## A. 候補を登録する（見つける）

1. 候補の入口は、proofread スキルの読者役テストの自由回答、独立レビューの「台帳にない型」、頻度比較（B）の結果、誤検知の記録（D）です。
2. 同じ型がすでに台帳にないか `JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" list` で確かめます。Notion にも同じ候補がないか、候補名で検索します。
3. Notion のデータソースを fetch して列名を確かめてから、1候補を1ページとして登録します。列は次のとおりです（2026-11-26 に Notion のデータソースで確かめた名前）。

| 列 | 入れるもの |
|---|---|
| 候補名 | 型の短い名前 |
| 状態 | 「候補」で登録する。ほかに 保留／承認／PR中／反映済み／却下 |
| 種別 | 新しい型／型の変更／型の廃止／誤検知／表記の統一 |
| 分類 | 語彙／言い回し／書式／構成／表記 |
| 重さ | must／should／info（迷ったら should） |
| 見つけた経路 | 読者テスト／独立レビュー／頻度比較／誤検知の記録／手動 |
| 例文 | 本文から短く引用。個人名や社外秘の数字は伏せる |
| 直し方 | 書き手への指示を1〜2文で（台帳の guidance になる） |
| 検出方法 | 正規表現（1か所ずつ）／正規表現（件数）／構成チェック／レビュー観点のみ |
| 正規表現 | 検出方法が正規表現のときだけ。拾えないときは空にして「レビュー観点のみ」 |
| flags | 正規表現のフラグ（`m` など）。`g` は書かない |
| しきい値 | 件数や構成チェックのしきい値。例：`minCount 3 / per1000 1.5` |
| 検出器 | 検出方法が構成チェックのときだけ。repeated-skeleton／triplets／closing-lines／sentence-length |
| 正しい表記 | 表記の統一のときだけ。そろえる先 |
| ゆれの表記 | 表記の統一のときだけ。直したい書き方を1行に1つ |
| 対象の型ID | 変更・廃止・誤検知のときの台帳ID |
| 出典文書 | 見つけた文書の名前 |
| 台帳ID、反映版、PR | 反映のときに埋める。登録では空にする |
| 登録日 | Notion が自動で入れる |

- 登録するのは、本人が台帳を育てることを頼んだとき、またはプロジェクトの設定 `notion.autoRegisterCandidates` が `true` のときだけです。そうでなければ、候補を一覧にして本人に聞きます。
- Notion につながらないときは、候補を報告に書くだけにして、台帳ファイルは触りません。

## B. 測る（自分の文章との比較）

本人がAIを使う前に書いた文章（2万字以上が目安）を基準にします。どの文章を基準にするかは本人に選んでもらいます。

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/stylometry.mjs" build --out 基準.json 自筆1.md 自筆2.md …
node "${CLAUDE_PLUGIN_ROOT}/scripts/stylometry.mjs" compare --baseline 基準.json 新しい文書.md
```

- 出るのは、基準ではまれなのに新しい文書で目立つ語、文末の割合の変化、文の長さ、「ではなく」やラベル行の頻度です。
- 日本語での精度は確かめられていません。結果は候補の目安で、そのまま台帳には入れず、Aの手順で登録して本人の承認を待ちます。
- 基準ファイルには本人の文章の語の頻度が入ります。共有のリポジトリには置かず、`.ja-proofread.json` の `baseline` で場所を指定します。

## C. 承認された候補を反映する（戻す）

台帳の正本はマーケットプレイスのリポジトリです。`ledger.mjs apply` は、インストール済みのプラグインの場所（`~/.claude/plugins` の下）や、git の作業コピーでない場所では止まります。

1. リポジトリの作業コピーで作業します（クラウドセッションなら、そのリポジトリを開いたセッション）。
2. Notion で「状態」が「承認」の行を取り出し、本人に一覧を見せて確かめます。
3. 各行を次の形に変換して、作業ディレクトリに `approved.json` として保存します。

```json
[
  { "notionPageId": "…", "action": "add", "name": "候補名", "category": "構成", "level": "should",
    "detect": { "type": "regex-count", "pattern": "…", "flags": "m", "threshold": { "minCount": 3 } },
    "guidance": "直し方", "example": { "before": "例文", "after": "" }, "source": "出典文書（見つけた経路）" },
  { "notionPageId": "…", "action": "add", "name": "候補名", "category": "構成", "level": "should",
    "detect": { "type": "structure", "detector": "triplets", "threshold": { "minCount": 3 } }, "guidance": "直し方" },
  { "notionPageId": "…", "action": "retire", "id": "P010" },
  { "notionPageId": "…", "action": "update", "id": "P002", "detect": { "type": "regex-count", "pattern": "…", "flags": "m", "threshold": { "minCount": 10, "per1000": 4 } } },
  { "notionPageId": "…", "action": "prh", "expected": "問い合わせ", "patterns": ["問合せ"], "reason": "…" }
]
```

   `update` の `detect` は、項目ごとに足すのではなく丸ごと置き換わります。変えない項目（`flags`、`threshold` の残りの値、`detector` など）も、今の台帳（`data/ledger.json`。`ledger.mjs list` には出ません）の値をそのまま書きます。上の例は P002 の `minCount` だけを変えるもので、今の `"flags": "m"` と `"per1000": 4` も書いています。`flags` の `m` が無くなり、正規表現が `^` や `$` を使っているときは、意味が変わる（行の先頭ではなく文書の先頭にしか当たらなくなる）ため、反映は止まります。ほかの項目が無くなったときは、反映したあとに「注意：」の行で知らせます。

   列と項目の対応は次のとおりです。

| Notion の列 | approved.json |
|---|---|
| 種別 | `action`。新しい型＝add、型の変更＝update、型の廃止＝retire、表記の統一＝prh。誤検知は内容に応じて update（正規表現やしきい値を直す）か retire |
| 検出方法 | `detect.type`。正規表現（1か所ずつ）＝regex、正規表現（件数）＝regex-count、構成チェック＝structure、レビュー観点のみ＝review |
| 正規表現、flags | `detect.pattern`、`detect.flags` |
| しきい値 | `detect.threshold`（`minCount 3 / per1000 1.5` なら `{"minCount": 3, "per1000": 1.5}`） |
| 検出器 | `detect.detector`。既存の4つしか使えない。新しい検出器が要るときは、コードの変更として別に扱う |
| 正しい表記、ゆれの表記 | `expected`、`patterns`（1行を1要素に） |
| 対象の型ID | `id` |
| 分類、重さ、直し方、例文 | `category`、`level`、`guidance`、`example.before` |

4. 反映します。新しい型があれば2桁目、変更・廃止・表記だけなら3桁目のバージョンが上がり、`CHANGELOG.md` に1行ずつ足されます。全件を確かめてから書くので、1件でも問題があれば、どのファイルも変わりません。正規表現は、入れ子の繰り返し、繰り返すグループの中の `|`（`(?:漢|漢字?)+` など）、長い文字列（かな・漢字・全角の英数字や記号）で遅いもの、長さ0で一致し得るもの（先読み・後読みだけの形を含む）を拒否します。

   反映は、リポジトリの作業コピーの根で、作業コピーのスクリプトを使って動かします。インストール済みのプラグインや同梱した版のスクリプトから動かすと、上の確認で必ず止まります。

```bash
node plugins/ja-proofread/scripts/ledger.mjs apply approved.json
```

   続けて、1ファイルで入る同梱の一式（`dist/ja-proofread-setup.mjs`）を新しい版で作り直し、確かめます。作り直すと、`CHANGELOG.md` の新しい版の項に、そのファイルの sha256 の行が足されます。作り直し忘れは CI とテストで落ちます。

```bash
node plugins/ja-proofread/scripts/build-setup.mjs
node plugins/ja-proofread/scripts/ledger.mjs validate
npm test --prefix plugins/ja-proofread
```

5. テストが通ったら、ブランチを切ってコミットし、プルリクエストを出します。マージは本人がします。
6. プルリクエストを出したら、出力された対応表を使い、Notion の各行の「状態」を「PR中」にし、「台帳ID」「反映版」「PR」を埋めます。
7. プルリクエストがマージされたのを確かめてから、「状態」を「反映済み」にします。マージされずに閉じたときは「承認」に戻し、「台帳ID」「反映版」を消します。
8. `approved.json` は消します。

## D. 誤検知を記録し、効かない型を見直す

- 指摘が誤検知だったら、その場で記録します。

```bash
JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" fp P002 --text "誤って指摘された文" --reason "見出しとして形をそろえているため"
```

- 定期的に `JA_PROOFREAD_DATA="${CLAUDE_PLUGIN_DATA}" node "${CLAUDE_PLUGIN_ROOT}/scripts/ledger.mjs" stats` を見ます。検出は「日・ファイル・型」ごとに1件と数えます。誤検知が5件以上で、検出の半分以上が誤検知の型は「見直し候補」と出ます。Aの手順で「誤検知」または「型の廃止」の候補として登録します。
- 型を増やすだけだと、指摘が増えて誰も読まなくなります。効かない型を削るのも、育てる作業の一部です。

## E. 配る

- 手元の利用者は、次を実行してから Claude Code を起動し直すと新しい版を使えます。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

- プロジェクトに同梱している場合（クラウドセッション向け）は、1ファイルで入る同梱の一式を取り直し、プロジェクトの根で動かして、同梱した版を入れ替えます。手元のプラグインは要らず、クラウドセッションの中でも動きます。終わったら、表示されたコマンド（`git add … && git commit … && git push -u origin HEAD`）でコミットしてプッシュし、新しいセッションを始めます。同梱した版のスクリプト（`.claude/ja-proofread/scripts/`）からは同梱し直せません。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs <プロジェクト>
```

  手元（macOS など、`/tmp` をほかと共有している環境）では、`mktemp -d` で作った場所に落とします。

```bash
f="$(mktemp -d)/ja-proofread-setup.mjs" && curl -fsSLo "$f" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node "$f" <プロジェクト>
```

  マーケットプレイスの作業コピーがあるときは、`git pull` のあと `node <マーケットプレイスの作業コピー>/plugins/ja-proofread/scripts/install-into-project.mjs <プロジェクト>` でも同じです。

<!-- plugin-only -->プラグインとして入れている環境なら、`claude plugin marketplace update ja-doc-proofreading` のあと `node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <プロジェクト>` でも同じです。マーケットプレイスの写し（`marketplaces/` の下）は update で最新になりますが、`${CLAUDE_PLUGIN_ROOT}` は今のセッションが読み込んだキャッシュの版（`cache/` の下）を指すので、そちらから動かすと古い版が同梱されます。`CLAUDE_CODE_PLUGIN_CACHE_DIR` を設定しているときは、`~/.claude/plugins` をその場所に読み替えます。<!-- /plugin-only -->
