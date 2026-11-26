# ja-doc-proofreading

AI で書いた日本語の文書やスライドを校正する Claude Code のプラグイン「ja-proofread」と、その配布用マーケットプレイスです。

校正で見つけた「AI の文章に出やすい型」を台帳に足していくので、使うほど拾える型が増えます。ただし、まだ名前のついていない癖まで含めてゼロにできる保証はありません。

## できること

| 段階 | 中身 |
|---|---|
| 書く前 | `write` スキルが、台帳の型を避けて書くよう Claude に指示する |
| 書いた直後 | プロジェクトの直下に `.ja-proofread.json` があるときだけ、フックが textlint と台帳でファイルを調べ、新しく出た重い指摘は Claude に直させる。調べるのは、設定の `include` に合い `exclude` に合わないファイルだけ |
| 仕上げ | `proofread` スキルが、機械チェック、独立レビュー、修正、読者役テストを順に行い、件数つきで報告する |
| 育てる | `grow-ledger` スキルが、新しい型の候補を Notion に登録し、承認されたものだけを台帳に入れて版を上げる |

## 入れ方

非公開リポジトリなので、先に git の認証（`gh auth login` と `gh auth setup-git`、または SSH 鍵）が要ります。

```bash
claude plugin marketplace add andy0911/ja-doc-proofreading
claude plugin install ja-proofread@ja-doc-proofreading --scope user
```

- 手元の Claude Code：[docs/install-local.md](docs/install-local.md)
- クラウドセッション：[docs/install-cloud.md](docs/install-cloud.md)

新しい版が出たら、次を実行して Claude Code を起動し直します（起動中のセッションなら `/reload-plugins` でも反映できます）。このマーケットプレイスは自動更新が既定でオフです。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

## 中身

```
.claude-plugin/marketplace.json   マーケットプレイスの定義
.github/                          テストと、版を上げ忘れたプルリクエストを落とす CI
plugins/ja-proofread/
  .claude-plugin/plugin.json      プラグインの定義（版はここだけに書き、ここで上げる。marketplace.json には書かない）
  skills/                         write、proofread、grow-ledger
  agents/                         structure-reviewer、fresh-eyes-reader
  hooks/hooks.json                SessionStart（依存を入れる）、PostToolUse（書いた直後に校正）
  data/ledger.json                型の台帳（正本）
  data/prh.yml                    表記の統一辞書
  data/settings.json              Notion の候補データベースの場所
  config/                         textlint の設定（doc と slide）
  rules/ledger-patterns.js        台帳の正規表現を textlint のルールにしたもの
  scripts/                        校正、構成チェック、頻度比較、台帳の反映、同梱
  scripts/regex-safety.mjs        台帳と辞書の正規表現が遅くならないかの検査
  package.json、package-lock.json textlint とルールの版の固定
  templates/                      読者役テスト、人の確認項目、プロジェクト設定の例
  tests/                          動作確認（npm test）
```

## 台帳を育てる流れ

1. 台帳にない型の候補は、読者役テストの自由回答、独立レビューの「台帳にない型」、自分の文章との頻度比較、誤検知の記録の4か所から出ます。
2. 候補を Notion の「文章校正 台帳候補」に1件1ページで登録するのは、本人が頼んだときか、プロジェクトの設定で `notion.autoRegisterCandidates` が `true` のときだけです。それ以外は候補を一覧にして本人に聞きます。
3. 「承認」にするのは本人だけ、という約束です。Claude への指示で決めているだけで、Notion の権限で止めているわけではありません。
4. 承認された候補を、このリポジトリの作業コピーの根で `node plugins/ja-proofread/scripts/ledger.mjs apply approved.json` にかけると、台帳と版が上がり、`CHANGELOG.md` に記録されます。全件を確かめてから書くので、1件でも問題があればどのファイルも変わりません。
5. プルリクエストを出したら Notion の行を「PR中」に、マージしたら「反映済み」にします。
6. 利用者は、上の「入れ方」の update の2つのコマンドを実行し、起動し直すと新しい版を使えます。

## テスト

```bash
cd plugins/ja-proofread
node scripts/ensure-deps.mjs
npm test
```

## 使っているもの

- [textlint](https://github.com/textlint/textlint) 16.1.3
- [@textlint-ja/textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing) 1.7.2
- [textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing) 12.1.0
- [textlint-rule-prh](https://github.com/textlint-rule/textlint-rule-prh) 6.1.1
- [textlint-filter-rule-comments](https://github.com/textlint/textlint-filter-rule-comments) 1.3.0
