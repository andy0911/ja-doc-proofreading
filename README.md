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

公開リポジトリなので、GitHub の認証は要りません。GitHub の SSH の鍵を使っていない端末では、先に `export CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` を設定しておくと、セッションの中の `/plugin` からの追加や更新も HTTPS で取得できます（[docs/install-local.md](docs/install-local.md) の 1.）。

```bash
claude plugin marketplace add andy0911/ja-doc-proofreading
claude plugin install ja-proofread@ja-doc-proofreading --scope user
```

- 手元の Claude Code：[docs/install-local.md](docs/install-local.md)
- クラウドセッション：[docs/install-cloud.md](docs/install-cloud.md)

クラウドセッション（claude.ai/code）には、上のコマンドで入れたプラグインは持ち込まれません。校正したいリポジトリを1つだけ選んでセッションを始め、その中で次の2行を実行し（Claude に頼んでもよい）、表示されたコマンドでコミットしてプッシュしてから、新しいセッションを始めます。手元にプラグインを入れていなくても済みます。版の固定や sha256 の確かめ方、手元からの同梱、やめ方は [docs/install-cloud.md](docs/install-cloud.md) の方法Aです。校正したいリポジトリが公開・社外共有なら同梱しないでください（Notion の場所も入るため）。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs
node /tmp/ja-proofread-setup.mjs
```

claude.ai/customize/plugins でアカウントにマーケットプレイスを足す方法は、持ち主の環境では追加ができなかったので、参考として [docs/install-cloud.md](docs/install-cloud.md) の B1 に回しています。

新しい版が出たら、次を実行して Claude Code を起動し直します（起動中のセッションなら `/reload-plugins` でも反映できます）。このマーケットプレイスは自動更新が既定でオフです。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

## 中身

```
.claude-plugin/marketplace.json   マーケットプレイスの定義
.github/                          テストと、版を上げ忘れたプルリクエストを落とす CI
dist/ja-proofread-setup.mjs       1ファイルで入る同梱の一式（クラウドセッションの中で curl と node で同梱する。build-setup.mjs が作る）
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
  scripts/prh-load.mjs            プロジェクトの prh 辞書を別のプロセスで読む（時間で打ち切るため）
  scripts/build-setup.mjs         dist/ja-proofread-setup.mjs を作る（--check で古くないか確かめる）
  package.json、package-lock.json textlint とルールの版の固定
  templates/                      読者役テスト、人の確認項目、プロジェクト設定の例
  tests/                          動作確認（npm test）
```

## 台帳を育てる流れ

1. 台帳にない型の候補は、読者役テストの自由回答、独立レビューの「台帳にない型」、自分の文章との頻度比較、誤検知の記録の4か所から出ます。
2. 候補を Notion の「文章校正 台帳候補」に1件1ページで登録するのは、本人が頼んだときか、プロジェクトの設定で `notion.autoRegisterCandidates` が `true` のときだけです。それ以外は候補を一覧にして本人に聞きます。
3. 「承認」にするのは本人だけ、という約束です。Claude への指示で決めているだけで、Notion の権限で止めているわけではありません。
4. 承認された候補を、このリポジトリの作業コピーの根で `node plugins/ja-proofread/scripts/ledger.mjs apply approved.json` にかけると、台帳と版が上がり、`CHANGELOG.md` に記録されます。全件を確かめてから書くので、1件でも問題があればどのファイルも変わりません。続けて `node plugins/ja-proofread/scripts/build-setup.mjs` で同梱の一式を新しい版で作り直します。
5. プルリクエストを出したら、Notion の行の「状態」を「PR中」にし、「台帳ID」「反映版」「PR」の列を埋めます。マージしたら「反映済み」にします。
6. 利用者は、上の「入れ方」の update の2つのコマンドを実行し、起動し直すと新しい版を使えます。

## テスト

```bash
cd plugins/ja-proofread
node scripts/ensure-deps.mjs
npm test
```

`plugins/ja-proofread/` の中を変えたら、`node scripts/build-setup.mjs` で `dist/ja-proofread-setup.mjs` を作り直します（`CHANGELOG.md` の今の版の項に、そのファイルの sha256 の行が書かれます）。作り直し忘れは、CI の `build-setup.mjs --check` とテストで落ちます。

## 使っているもの

- [textlint](https://github.com/textlint/textlint) 16.1.3
- [@textlint-ja/textlint-rule-preset-ai-writing](https://github.com/textlint-ja/textlint-rule-preset-ai-writing) 1.7.2
- [textlint-rule-preset-ja-technical-writing](https://github.com/textlint-ja/textlint-rule-preset-ja-technical-writing) 12.1.0
- [textlint-rule-prh](https://github.com/textlint-rule/textlint-rule-prh) 6.1.1
- [textlint-filter-rule-comments](https://github.com/textlint/textlint-filter-rule-comments) 1.3.0
