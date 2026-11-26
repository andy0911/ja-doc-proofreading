# クラウドで使う（Claude Code on the web、claude.ai の Projects）

## 先に、どこで動くか

| 使う場所 | このプラグインの使い方 | 確かめた程度 |
|---|---|---|
| claude.ai/code で、リポジトリを1つだけ選んだセッション | 方法A（リポジトリに同梱） | コンテナの中の CLI で確認。実際のセッションでは未確認 |
| claude.ai/code で、リポジトリを複数選んだセッション | 方法A。ただしフックは動かない | 未確認 |
| claude.ai の Projects のスレッドで、クラウドで動くもの | 方法Aは使えない。方法Bの2か3 | 未確認 |
| claude.ai の Projects のスレッドで、自分のコンピューターで動かすもの（Remote Control） | そのコンピューターの Claude Code が動くので、手元に入れたプラグインか、方法Aで同梱したリポジトリが使える見込み（下の B4） | 未確認 |

クラウドセッションは、毎回まっさらなコンテナでリポジトリを開きます。手元で入れたプラグインは持ち込まれません。公式の説明では、リポジトリの設定やユーザー設定で有効にしたプラグインも読み込まれません。読まれるのは、リポジトリの `.claude/skills/`、`.claude/agents/`、`.claude/commands/`、`CLAUDE.md` です。`.claude/settings.json` の `hooks` は、リポジトリを1つだけ選んだセッションでだけ読まれます（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。

Projects のスレッドのうちクラウドで動くものはさらに狭く、リポジトリから読むのは `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/` だけです。`.claude/skills/`、`.claude/agents/`、`.claude/settings.json` のフックは読まれません（[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。そのため、方法Aで同梱しても、クラウドで動く Projects のスレッドでは動きません。自分のコンピューターで動かすスレッドは別で、下の B4 を見てください。

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
| `.ja-proofread.json` | 校正の設定（無いときだけ作る）。作るときの `include` は `**/*.md` と `**/*.txt` なので、`README.md` などリポジトリの中のすべての Markdown とテキストが、書いた直後の校正の対象になります。狭めたいときは `include` と `exclude` を書き換えます |

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

1. そのリポジトリだけを選んでセッションを始めます。複数のリポジトリを選ぶと、`.claude/settings.json` のフックは読まれません。SessionStart のフックも動かないので、依存は proofread スキルの準備（`ensure-deps.mjs`）で入れることになります（未確認）。そのときスキルとサブエージェントが使えるかは、公式の説明では確かめられていません。
2. 環境のネットワーク設定は「Trusted」（既定）のままにします。Trusted には registry.npmjs.org が入っていて、最初に textlint を入れるのに使います。「None」にすると textlint は動きませんが、構成の型のチェックと台帳の語句チェックの一部は動きます。
3. 最初の起動で依存が入ります（数十秒）。入れる先はコンテナの中なので、セッションのたびに入れ直します。入れられなかったときは、その旨が Claude と画面に出ます。
4. 「この文書を校正して」と頼むか、`/ja-proofread-proofread` を呼びます。

### 新しい版にする

台帳が育ってマーケットプレイスの版が上がったら、先に手元のマーケットプレイスを最新にします。古いままの場所から同梱し直すと、古い版が入ります。

```bash
# 手元にプラグインを入れているとき
claude plugin marketplace update ja-doc-proofreading
# クローンした作業コピーを使うとき
git -C ja-doc-proofreading pull
```

そのあと1と2をもう一度実行します。同梱した部品は最新版に入れ替わり、フックは重複しません。同梱した版（`.claude/ja-proofread/scripts/`）の install-into-project.mjs からは実行できないので、必ず、クローンした作業コピーの `ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` か、手元のマーケットプレイスの写しの `~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` を使います。`~/.claude/plugins/cache/` の下や `${CLAUDE_PLUGIN_ROOT}` の下のものは、読み込み済みの版なので、update のあとでも古いことがあります。

### やめる

```bash
node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ> --remove
```

クローンした作業コピーを使うときは、`ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` に読み替えます。

フックと、同梱したときに入れた部品だけが消えます。何を入れたかは同梱のときに `.claude/ja-proofread/vendored.json` に記録しているので、あとから自分で足した `ja-proofread-` で始まるスキルなどは残ります。同梱のときに `.claude/settings.json` や `.claude/skills/` などを新しく作っていたなら、空になったものも消します。一度も同梱していないリポジトリで実行したときは、何も変えずに終わります。

`.ja-proofread.json` は残すので、要らなければ消します。消えたことをリポジトリにも反映するため、コミットしてプッシュします。`.ja-proofread.json` も消すときは、`git rm` の行も実行します。

```bash
cd <対象のリポジトリ>
git add -A -- .claude/ja-proofread '.claude/skills/ja-proofread-*' '.claude/agents/ja-proofread-*' .claude/settings.json
git rm .ja-proofread.json   # .ja-proofread.json も消すときだけ
git commit -m "ja-proofread の同梱をやめる"
git push
```

### 注意：プラグインと同梱を両方使うと、記録が分かれる

手元でプラグインを入れたまま、同梱したリポジトリを開くと、書いた直後の校正は同梱した版が受け持ち、プラグイン側のフックは黙ります。ただし、データ置き場が別になります。プラグインのスキルはプラグインのデータ置き場（`~/.claude/plugins/data/ja-proofread-ja-doc-proofreading/`）を、同梱した版のフックとスキルは既定の場所（`~/.cache/ja-proofread/`）を使います。そのため、検出の記録・誤検知の記録・フックの前回の結果が2か所に分かれ、`ledger.mjs stats` の数はそれぞれの場所の分だけになります。手元ではどちらか一方を使うか、スクリプトを手で動かすときに `JA_PROOFREAD_DATA` で見たい方の場所を指定します。

## 方法B：リポジトリに同梱しない（どれも確かめていない）

### B1. リポジトリを1つ選んだクラウドセッション

リポジトリの設定（`enabledPlugins`、`extraKnownMarketplaces`）でプラグインを有効にしても、クラウドセッションでは読み込まれません（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。claude.ai のアカウントで入れたプラグインがクラウドセッションに読み込まれるかは、公式の説明で確かめられませんでした。このため、今は方法Aを使ってください。

### B2. Projects のスレッド

Projects では、プラグインをプロジェクトの設定（Project settings の Plugins）から足します（[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。このマーケットプレイスは非公開の GitHub リポジトリなので、そこで追加できるかは確かめていません。

### B3. claude.ai のアカウントのスキル

claude.ai のアカウントで有効にしたスキルは、クラウドセッションでも読み込まれると説明されています（[Skills](https://code.claude.com/docs/en/skills)、[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。ただし入るのはスキルだけで、フックと textlint は入りません。このプラグインのスキルはスクリプトを `${CLAUDE_PLUGIN_ROOT}` で指しているので、そのままアップロードしても機械チェックは動かないはずです（試していません）。台帳を読んで書く `write` スキルの考え方だけを使う、という使い方になります。

### B4. Projects のスレッドを自分のコンピューターで動かす（未確認）

公式の説明では、Projects のスレッドは、Remote Control を通して自分のコンピューターのフォルダーで動く Claude Code のセッションにできます。そのときは、そのコンピューターのファイル・ツール・MCP サーバー・Claude Code の設定（フックや権限の規則を含む）で動きます（[Run a thread on your own computer](https://code.claude.com/docs/en/claude-projects)）。このため、そのコンピューターに入れたプラグイン（[install-local.md](install-local.md) の手順）か、方法Aで同梱したリポジトリのスキル・フックが使える見込みです。ただし、このプラグインで実際に試してはいません。

公式の説明にある条件と手順は次のとおりです。

- Claude Code v2.1.280 以降が要ります
- Remote Control は Pro・Max・Team・Enterprise のプランで、claude.ai のアカウントでログインしているときに使えます。API キーや Bedrock・Vertex・Foundry では使えません（[Remote Control](https://code.claude.com/docs/en/remote-control)）
- スレッドが動くのは、そのコンピューターが起きていて Remote Control がつながっている間だけです
- 組織で「Require trusted devices」が有効なときは使えません
- 準備：デスクトップアプリの Settings > Claude Code で「Use this computer from your phone and claude.ai」を有効にしてフォルダーを足すか、そのフォルダーで `claude remote-control` を実行します
- スレッドでは、+ のメニューから「Work locally」を選びます。「Allow Claude to work in a folder on your device」のカードが出たら許可します
- スレッドは、プロジェクトの指示を持って始まりますが、プロジェクトのメモリーは持ち込みません

プラグインを更新したあと、すでに動いているセッションに反映するには `/reload-plugins` が要ります。公式の説明では、`/plugin` は手元の端末でしか使えず、`/reload-plugins` はスマートフォンや Web から送れるものの、そのセッションが対話できる端末で動いているときだけ受け付けます（[Remote Control の Limitations](https://code.claude.com/docs/en/remote-control)）。デスクトップアプリから動かしているときなど、受け付けられないときは、そのコンピューターでセッションを始め直します。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| スキルが一覧に出ない | `.claude/skills/ja-proofread-*` をコミットしたか。プッシュ前のブランチでセッションを始めていないか。クラウドで動く Projects のスレッドでは出ません |
| 書いた直後の校正が動かない | リポジトリを1つだけ選んで始めたか。`.ja-proofread.json` がリポジトリの直下にあるか |
| 「textlint の依存がまだ入っていません」と出る | 環境のネットワークが Trusted か。`node .claude/ja-proofread/scripts/ensure-deps.mjs` を実行して npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 指摘が二重に出る | 手元で同じリポジトリを開いたときは、同梱した版が優先され、プラグイン側のフックは黙ります。それでも二重なら `.claude/settings.json` のフックが重複していないか見る |
