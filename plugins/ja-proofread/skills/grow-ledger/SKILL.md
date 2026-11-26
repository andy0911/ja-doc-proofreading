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

Notion の場所は `../../data/settings.json` に書いてあります。プロジェクトの `.ja-proofread.json` に `notion.dataSourceUrl` があれば、そちらを使います。スクリプトは、このスキルのディレクトリから見て `../../scripts/` にあります（以下 `<scripts>`）。

## A. 候補を登録する（見つける）

1. 候補は、proofread スキルの読者役の自由回答、独立レビューの「台帳にない型」、頻度比較の結果、誤検知の記録から集めます。
2. 同じ型がすでに台帳にないか `node <scripts>/ledger.mjs list` で確かめます。Notion にも同じ候補がないか、候補名で検索します。
3. Notion のデータソースを fetch して列名を確かめてから、1候補を1ページとして登録します。

| 列 | 入れるもの |
|---|---|
| 候補名 | 型の短い名前 |
| 状態 | 「候補」 |
| 種別 | 新しい型／型の変更／型の廃止／誤検知／表記の統一 |
| 分類 | 語彙／言い回し／書式／構成／表記 |
| 重さ | must／should／info（迷ったら should） |
| 見つけた経路 | 読者テスト／独立レビュー／頻度比較／誤検知の記録／手動 |
| 例文 | 本文から短く引用。個人名や社外秘の数字は伏せる |
| 直し方 | 書き手への指示を1〜2文で |
| 検出方法 | 正規表現（1か所ずつ）／正規表現（件数）／構成チェック／レビュー観点のみ |
| 正規表現・しきい値 | 正規表現で拾えるときだけ。拾えないときは空にして「レビュー観点のみ」 |
| 対象の型ID | 変更・廃止・誤検知のときの台帳ID |
| 出典文書 | 見つけた文書の名前 |

- 登録するのは、本人が台帳を育てることを頼んでいるとき、またはプロジェクトの設定 `notion.autoRegisterCandidates` が `true` のときだけです。そうでなければ、候補を一覧にして本人に聞きます。
- 「状態」を「承認」にするのは本人だけです。Claude は承認にしません。
- Notion につながらないときは、候補を報告に書くだけにして、台帳ファイルは触りません。

## B. 測る（自分の文章との比較）

本人がAIを使う前に書いた文章（2万字以上が目安）を基準にします。どの文章を基準にするかは本人に選んでもらいます。

```bash
node <scripts>/stylometry.mjs build --out 基準.json 自筆1.md 自筆2.md …
node <scripts>/stylometry.mjs compare --baseline 基準.json 新しい文書.md
```

- 出るのは、基準ではまれなのに新しい文書で目立つ語、文末の割合の変化、文の長さ、「ではなく」やラベル行の頻度です。
- 日本語での精度は確かめられていません。結果は候補の目安で、そのまま台帳には入れず、Aの手順で登録して本人の承認を待ちます。
- 基準ファイルには本人の文章の語の頻度が入ります。共有のリポジトリには置かず、`.ja-proofread.json` の `baseline` で場所を指定します。

## C. 承認された候補を反映する（戻す）

台帳の正本はマーケットプレイスのリポジトリです。インストール済みのプラグインを書き換えても、次の更新で消えます。

1. リポジトリの作業コピーで作業します（クラウドセッションなら、そのリポジトリを開いたセッション）。
2. Notion で「状態」が「承認」の行を取り出します。
3. 各行を次の形に変換して、作業ディレクトリに `approved.json` として保存します。

```json
[
  { "notionPageId": "…", "action": "add", "name": "候補名", "category": "構成", "level": "should",
    "detect": { "type": "regex-count", "pattern": "…", "threshold": { "minCount": 3 } },
    "guidance": "直し方", "example": { "before": "例文", "after": "" }, "source": "出典文書（見つけた経路）" },
  { "notionPageId": "…", "action": "retire", "id": "P010" },
  { "notionPageId": "…", "action": "update", "id": "P002", "detect": { "type": "regex-count", "pattern": "…", "threshold": { "minCount": 10 } } },
  { "notionPageId": "…", "action": "prh", "expected": "問い合わせ", "patterns": ["問合せ"], "reason": "…" }
]
```

   種別と action の対応は、新しい型＝add、型の変更＝update、型の廃止＝retire、表記の統一＝prh です。誤検知は、内容に応じて update（正規表現やしきい値を直す）か retire にします。検出方法の対応は、正規表現（1か所ずつ）＝`regex`、正規表現（件数）＝`regex-count`、構成チェック＝`structure`、レビュー観点のみ＝`review` です。構成チェックは既存の検出器（`repeated-skeleton`、`triplets`、`closing-lines`、`sentence-length`）しか使えません。新しい検出器が要るときは、コードの変更として別に扱います。

4. 反映します。新しい型があれば2桁目、変更・廃止・表記だけなら3桁目のバージョンが上がり、`CHANGELOG.md` に1行ずつ足されます。

```bash
node <scripts>/ledger.mjs apply approved.json
node <scripts>/ledger.mjs validate
npm test --prefix plugins/ja-proofread
```

5. テストが通ったら、ブランチを切ってコミットし、プルリクエストを出します。マージは本人がします。
6. 出力された対応表を使い、Notion の各行の「状態」を「反映済み」に、「台帳ID」と「反映版」を埋めます。
7. `approved.json` は消します。

## D. 誤検知を記録し、効かない型を見直す

- 指摘が誤検知だったら、その場で記録します。

```bash
node <scripts>/ledger.mjs fp P002 --text "誤って指摘された文" --reason "見出しとして形をそろえているため"
```

- 定期的に `node <scripts>/ledger.mjs stats` を見ます。誤検知が5件以上で、検出の半分以上が誤検知の型は「見直し候補」と出ます。Aの手順で「誤検知」または「型の廃止」の候補として登録します。
- 型を増やすだけだと、指摘が増えて誰も読まなくなります。効かない型を削るのも、育てる作業の一部です。

## E. 配る

- 手元の利用者は `claude plugin marketplace update ja-doc-proofreading` のあと `/reload-plugins` か再起動で新しい版を使えます。
- プロジェクトに同梱している場合（クラウドセッション向け）は、`node <scripts>/install-into-project.mjs <プロジェクト>` をもう一度実行して、同梱した版を入れ替えます。
