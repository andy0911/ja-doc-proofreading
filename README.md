# ja-doc-proofreading

AI で書いた日本語の文書やスライドを校正する Claude Code のプラグイン「ja-proofread」と、その配布用マーケットプレイスです。

校正で見つけた「AI の文章に出やすい型」を台帳に足していくので、使うほど拾える型が増えます。ただし、まだ名前のついていない癖まで含めてゼロにできる保証はありません。

## できること

| 段階 | 中身 |
|---|---|
| 書く前 | `write` スキルが、台帳の型を避けて書くよう Claude に指示する |
| 書いた直後 | フックが textlint と台帳でファイルを調べ、重い指摘は Claude に直させる |
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

## 中身

```
.claude-plugin/marketplace.json   マーケットプレイスの定義
plugins/ja-proofread/
  .claude-plugin/plugin.json      プラグインの定義（版はここで上げる）
  skills/                         write、proofread、grow-ledger
  agents/                         structure-reviewer、fresh-eyes-reader
  hooks/hooks.json                SessionStart（依存を入れる）、PostToolUse（書いた直後に校正）
  data/ledger.json                型の台帳（正本）
  data/prh.yml                    表記の統一辞書
  data/settings.json              Notion の候補データベースの場所
  config/                         textlint の設定（doc と slide）
  rules/ledger-patterns.js        台帳の正規表現を textlint のルールにしたもの
  scripts/                        校正、構成チェック、頻度比較、台帳の反映、同梱
  templates/                      読者役テスト、人の確認項目、プロジェクト設定の例
  tests/                          動作確認（npm test）
```

## 台帳を育てる流れ

1. 校正のたびに、読者役テストの自由回答と独立レビューから、台帳にない型の候補が出ます。
2. 候補は Notion の「文章校正 台帳候補」に1件1ページで入ります。承認するのは人だけです。
3. 承認された候補を `scripts/ledger.mjs apply` で台帳に入れると、版が上がり、`CHANGELOG.md` に記録されます。
4. プルリクエストをマージすると、利用者は `claude plugin marketplace update` で新しい版を受け取れます。

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
