# クラウドで使う（Claude Code on the web、claude.ai の Projects）

## 先に、どこで動くか

| 使う場所 | このプラグインの使い方 | 確かめた程度 |
|---|---|---|
| claude.ai/code で、リポジトリを1つだけ選んだセッション | 方法A（リポジトリに同梱） | コンテナの中の CLI で確認。実際のセッションでは未確認 |
| claude.ai/code で、リポジトリを複数選んだセッション | 方法A。ただしフックは動かない | 未確認 |
| claude.ai の Projects のスレッド | 方法Aは使えない。方法Bの2か3 | 未確認 |

クラウドセッションは、毎回まっさらなコンテナでリポジトリを開きます。手元で入れたプラグインは持ち込まれません。公式の説明では、リポジトリの設定やユーザー設定で有効にしたプラグインも読み込まれません。読まれるのは、リポジトリの `.claude/skills/`、`.claude/agents/`、`.claude/commands/`、`CLAUDE.md` です。`.claude/settings.json` の `hooks` は、リポジトリを1つだけ選んだセッションでだけ読まれます（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。

Projects のスレッドはさらに狭く、リポジトリから読むのは `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/` だけです。`.claude/skills/`、`.claude/agents/`、`.claude/settings.json` のフックは読まれません（[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。そのため、方法Aで同梱しても Projects のスレッドでは動きません。

## 方法A：リポジトリに同梱する（コンテナの中の CLI で確認。実際のセッションでは未確認）

プラグインの部品を対象のリポジトリにコピーしてコミットします。同梱した版のスクリプトとフックのスクリプトが動くことは、コンテナの中で `npm test` を動かして確かめています。claude.ai/code の実際のセッションで、スキルの一覧に出るか、フックが呼ばれるかはまだ確かめていません。

### 注意：公開リポジトリには同梱しない

同梱すると `.claude/ja-proofread/data/settings.json` もコミットされます。この中に、台帳候補を受け付ける Notion データベースの場所が入っています。公開リポジトリや、社外の人と共有しているリポジトリには同梱しないでください。

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
| `.claude/settings.json` | フック2つを追記（ほかの設定はそのまま）。書く前に `settings.json.bak` を作る |
| `.ja-proofread.json` | 校正の設定（無いときだけ作る） |

`.claude/settings.json` が JSON として読めない（コメントが入っているなど）ときは、何も変えずに止まります。直してからもう一度実行します。

同梱したスキルは、スクリプトを `${CLAUDE_SKILL_DIR}/../../ja-proofread/` で指します。`${CLAUDE_SKILL_DIR}` はプラグインでないスキルでも置き換わると読める説明ですが（[Skills](https://code.claude.com/docs/en/skills)）、実際のセッションでは確かめていません。

### 2. コミットしてプッシュする

同梱したものだけを足します。`.claude/settings.json.bak` や、ほかの `.claude/` の中身はコミットしません。

```bash
cd <対象のリポジトリ>
git add .claude/ja-proofread .claude/skills/ja-proofread-* .claude/agents/ja-proofread-* .claude/settings.json .ja-proofread.json
git commit -m "ja-proofread を同梱"
git push
```

### 3. クラウドセッションを開く

1. そのリポジトリだけを選んでセッションを始めます。複数のリポジトリを選ぶと、`.claude/settings.json` のフックは読まれません。そのときスキルとサブエージェントが使えるかは、公式の説明では確かめられていません。
2. 環境のネットワーク設定は「Trusted」（既定）のままにします。Trusted には registry.npmjs.org が入っていて、最初に textlint を入れるのに使います。「None」にすると textlint は動きませんが、構成の型のチェックと台帳の語句チェックの一部は動きます。
3. 最初の起動で依存が入ります（数十秒）。入れる先はコンテナの中なので、セッションのたびに入れ直します。入れられなかったときは、その旨が Claude と画面に出ます。
4. 「この文書を校正して」と頼むか、`/ja-proofread-proofread` を呼びます。

### 新しい版にする

台帳が育ってマーケットプレイスの版が上がったら、1と2をもう一度実行します。同梱した部品は最新版に入れ替わり、フックは重複しません。

### やめる

```bash
node <プラグインの場所>/scripts/install-into-project.mjs <対象のリポジトリ> --remove
```

フックと部品が消えます。`.ja-proofread.json` は残すので、要らなければ手で消します。

## 方法B：リポジトリに同梱しない（どれも確かめていない）

### B1. リポジトリを1つ選んだクラウドセッション

リポジトリの設定（`enabledPlugins`、`extraKnownMarketplaces`）でプラグインを有効にしても、クラウドセッションでは読み込まれません（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。claude.ai のアカウントで入れたプラグインがクラウドセッションに読み込まれるかは、公式の説明で確かめられませんでした。このため、今は方法Aを使ってください。

### B2. Projects のスレッド

Projects では、プラグインをプロジェクトの設定（Project settings の Plugins）から足します（[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。このマーケットプレイスは非公開の GitHub リポジトリなので、そこで追加できるかは確かめていません。

### B3. claude.ai のアカウントのスキル

claude.ai のアカウントで有効にしたスキルは、クラウドセッションでも読み込まれると説明されています（[Skills](https://code.claude.com/docs/en/skills)、[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。ただし入るのはスキルだけで、フックと textlint は入りません。このプラグインのスキルはスクリプトを `${CLAUDE_PLUGIN_ROOT}` で指しているので、そのままアップロードしても機械チェックは動かないはずです（試していません）。台帳を読んで書く `write` スキルの考え方だけを使う、という使い方になります。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| スキルが一覧に出ない | `.claude/skills/ja-proofread-*` をコミットしたか。プッシュ前のブランチでセッションを始めていないか。Projects のスレッドでは出ません |
| 書いた直後の校正が動かない | リポジトリを1つだけ選んで始めたか。`.ja-proofread.json` がリポジトリの直下にあるか |
| 「textlint の依存がまだ入っていません」と出る | 環境のネットワークが Trusted か。`node .claude/ja-proofread/scripts/ensure-deps.mjs` を実行して npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 指摘が二重に出る | 手元で同じリポジトリを開いたときは、同梱した版が優先され、プラグイン側のフックは黙ります。それでも二重なら `.claude/settings.json` のフックが重複していないか見る |
