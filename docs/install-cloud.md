# クラウドセッション（Claude Code on the web）で使う

クラウドセッションは、毎回まっさらなコンテナでリポジトリを開きます。手元で入れたプラグインは持ち込まれません。リポジトリの `.claude/settings.json` に書いた `enabledPlugins` や `extraKnownMarketplaces` も読まれません（フォルダを信頼する確認が出せないためです）。

一方で、リポジトリの次のものは読まれます。

| 読まれるもの | このプラグインでの使い道 |
|---|---|
| `.claude/skills/` | 校正のスキル |
| `.claude/agents/` | 独立レビューと読者役のサブエージェント |
| `.claude/settings.json` の `hooks` | 依存を入れるフックと、書いた直後の校正 |
| `CLAUDE.md` | 書くときのルールを常に効かせたいとき |

そこで、プラグインの部品を対象のリポジトリにコピーしてコミットする「同梱」方式を使います。

## 方法A：リポジトリに同梱する（確かめ済み）

### 1. 同梱する

手元か、このマーケットプレイスのリポジトリを開いたセッションで実行します。`<対象のリポジトリ>` は、クラウドで校正したい文書があるリポジトリの作業コピーです。

```bash
git clone https://github.com/andy0911/ja-doc-proofreading.git
node ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>
```

手元にプラグインを入れていれば、クローンせずに次でも同じです。

```bash
node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>
```

入るものは次のとおりです。

| 場所 | 中身 |
|---|---|
| `.claude/ja-proofread/` | スクリプト、ルール、台帳、設定、テンプレート |
| `.claude/skills/ja-proofread-write` ほか2つ | スキル（名前に `ja-proofread-` がつく） |
| `.claude/agents/ja-proofread-*.md` | サブエージェント |
| `.claude/settings.json` | フック2つを追記（ほかの設定はそのまま） |
| `.ja-proofread.json` | 校正の設定（無いときだけ作る） |

### 2. コミットしてプッシュする

```bash
cd <対象のリポジトリ>
git add .claude .ja-proofread.json
git commit -m "ja-proofread を同梱"
git push
```

### 3. クラウドセッションを開く

1. そのリポジトリだけを選んでセッションを始めます。複数のリポジトリを選ぶと、`.claude/settings.json` のフックは読まれません（スキルとサブエージェントは使えます）。
2. 環境のネットワーク設定は「Trusted」（既定）のままにします。最初に textlint を registry.npmjs.org から入れるためです。「None」にすると textlint は動きませんが、構成の型のチェックと台帳の語句チェックの一部は動きます。
3. 最初の起動で依存が入ります（数十秒）。入れる先はコンテナの中なので、セッションのたびに入れ直します。
4. 「この文書を校正して」と頼むか、`/ja-proofread-proofread` を呼びます。

### 新しい版にする

台帳が育ってマーケットプレイスの版が上がったら、1と2をもう一度実行します。同梱した部品は最新版に入れ替わり、フックは重複しません。

### やめる

```bash
node <プラグインの場所>/scripts/install-into-project.mjs <対象のリポジトリ> --remove
```

フックと部品が消えます。`.ja-proofread.json` は残すので、要らなければ手で消します。

## 方法B：claude.ai のアカウントで入れたプラグイン（確かめていない）

claude.ai の設定で入れたプラグインがクラウドセッションにも読み込まれる、という説明は公式ドキュメントにあります。ただ、このマーケットプレイスは非公開リポジトリなので、claude.ai 側から読めるかどうかと、フックが動くかどうかは確かめていません。確実に動かしたいときは方法Aを使ってください。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| スキルが一覧に出ない | `.claude/skills/ja-proofread-*` をコミットしたか。プッシュ前のブランチでセッションを始めていないか |
| 書いた直後の校正が動かない | 単一のリポジトリで始めたか。`.ja-proofread.json` がリポジトリの直下にあるか |
| 「textlint の依存がまだ入っていません」と出る | 環境のネットワークが Trusted か。`node .claude/ja-proofread/scripts/ensure-deps.mjs` を実行して npm のエラーを見る |
| 指摘が二重に出る | 手元で同じリポジトリを開いたときは、同梱した版が優先され、プラグイン側のフックは黙ります。それでも二重なら `.claude/settings.json` のフックが重複していないか見る |
