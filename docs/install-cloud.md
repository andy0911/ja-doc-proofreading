# クラウドで使う（Claude Code on the web、claude.ai の Projects）

まずどれを使うか：いま動くと確かめているのは手元の Claude Code（[install-local.md](install-local.md)）です。クラウドで使うなら、claude.ai/code でリポジトリを1つだけ選んだセッションで方法Aを使います（実際のセッションでは未確認）。

## 先に、どこで動くか

| 使う場所 | このプラグインの使い方 | 確かめた程度 |
|---|---|---|
| claude.ai/code で、リポジトリを1つだけ選んだセッション | 方法A（リポジトリに同梱） | コンテナの中の CLI で確認。実際のセッションでは未確認 |
| claude.ai/code で、リポジトリを複数選んだセッション | 方法A。ただしフックは動かない（※） | 未確認 |
| claude.ai の Projects のスレッドで、クラウドで動くもの（Projects は Pro・Max・Ultra のプランだけ） | 方法Aで同梱すれば、スキルとサブエージェントは使える見込み。フックは動かないので書いた直後の自動校正はなく、依存は proofread スキルの準備（`ensure-deps.mjs`）で入る（※） | 未確認 |
| claude.ai のアカウントにプラグインを足したとき（claude.ai/customize/plugins） | クラウドセッションと、Projects のクラウドで動くスレッドに読み込まれる（下の B1）。このプラグインのフック・依存・データ置き場が動くかは未確認 | 未確認 |
| claude.ai の Projects のスレッドで、自分のコンピューターで動かすもの（Remote Control） | そのコンピューターの Claude Code が動くので、手元に入れたプラグインか、方法Aで同梱したリポジトリが使える見込み（下の B4） | 未確認 |

※ 公式の説明では、リポジトリを複数選んだセッションは、クローンの上の階層で始まります（[Settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions)）。そのため、リポジトリの直下に置いた `.ja-proofread.json` が見つからず、既定の設定（`include`・`exclude`・`prh` などを書いていない状態）で校正される可能性があります（未確認）。また、始めた場所より下の `.claude/skills/` は起動のときには読まれず、そのフォルダーのファイルを Claude が読むか編集したときに読まれます（[Load skills in monorepos and subdirectories](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)）。そのため、起動した直後は `/ja-proofread-proofread` が一覧に出ず、そのリポジトリのファイルに触れたあとで使えるようになると読めます（未確認）。Projects のスレッドでリポジトリが複数あるときも同じことが起きるかもしれません。

クラウドセッションは、毎回まっさらなコンテナでリポジトリを開きます。手元で入れたプラグインは持ち込まれません。公式の説明では、ユーザー設定で有効にしたプラグインは読み込まれず、リポジトリの `.claude/settings.json` の `extraKnownMarketplaces` に書いたマーケットプレイスも足されません。読み込まれるのは主に、claude.ai のアカウントで足したプラグイン（下の B1）と、リポジトリの `.claude/skills/`、`.claude/agents/`、`.claude/commands/`、`CLAUDE.md` です。`.claude/settings.json` の `hooks` は、リポジトリを1つだけ選んだセッションでだけ読まれます（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。

Projects のスレッドのうちクラウドで動くものも、リポジトリの `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/` に加えて、`.claude/` の下のスキル・サブエージェント・コマンドを読みます。読まないのは、`.mcp.json` と、`.claude/settings.json` のフック・権限の規則・`env` です（[What threads pick up from your repositories](https://code.claude.com/docs/en/claude-projects#what-threads-pick-up-from-your-repositories)）。ただし、2026年10月1日より前に始めたスレッド、名前がドットで始まるリポジトリ（`.github` など）を含むスレッド、セルフホスト（self-hosted）の環境のスレッドなどは、スキル・サブエージェント・コマンドも読みません（[Threads that skip repository skills](https://code.claude.com/docs/en/claude-projects#threads-that-skip-repository-skills)。セルフホストの環境では、スキル・サブエージェント・コマンドをランナーのイメージに入れます）。そのため、方法Aで同梱すれば、スキルとサブエージェントは使える見込みです。フックは動かないので、書いた直後の自動校正はありません。依存は、proofread スキルの準備（`ensure-deps.mjs`）で入ります（未確認）。自分のコンピューターで動かすスレッドは別で、下の B4 を見てください。

## 方法A：リポジトリに同梱する（コンテナの中の CLI で確認。実際のセッションでは未確認）

プラグインの部品を対象のリポジトリにコピーしてコミットします。同梱した版のスクリプトとフックのスクリプトが動くことは、コンテナの中で `npm test` を動かして確かめています。claude.ai/code の実際のセッションで、スキルの一覧に出るか、フックが呼ばれるかはまだ確かめていません。

### 注意：公開リポジトリには同梱しない

同梱すると `.claude/ja-proofread/data/settings.json` もコミットされます。この中に、台帳候補を受け付ける Notion データベースの場所が入っています。公開リポジトリや、社外の人と共有しているリポジトリには同梱しないでください。

### 1. 同梱する

手元で実行します。`<対象のリポジトリ>` は、クラウドで校正したい文書があるリポジトリの作業コピーです。手元にプラグインを入れていれば（[install-local.md](install-local.md)）、次の1行です。

```bash
node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>
```

プラグインを入れていないときは、このマーケットプレイスのリポジトリをクローンして、その中のスクリプトを使います。

```bash
git clone https://github.com/andy0911/ja-doc-proofreading.git
node ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>
```

入るものは次のとおりです。

| 場所 | 中身 |
|---|---|
| `.claude/ja-proofread/` | スクリプト、ルール、台帳、設定、テンプレート |
| `.claude/skills/ja-proofread-write` ほか2つ | スキル（名前に `ja-proofread-` がつく） |
| `.claude/agents/ja-proofread-*.md` | サブエージェント（ファイル名には `ja-proofread-` がつくが、呼ぶときの名前は `structure-reviewer` と `fresh-eyes-reader` のまま） |
| `.claude/settings.json` | フック2つを追記（ほかの設定はそのまま）。もとからあったときは、書く前に `settings.json.bak` を作る。無かったときは新しく作り、`.bak` は作らない |
| `.ja-proofread.json` | 校正の設定（無いときだけ作る）。作るときの `include` は `**/*.md` と `**/*.txt` なので、`README.md` などリポジトリの中の Markdown とテキストが、書いた直後の校正の対象になります。ただし、`**/node_modules/**`・`**/.git/**`・`**/CHANGELOG.md`・`.claude/**`・`**/CLAUDE.md` は既定で除きます（`exclude` に書いても、この既定は消えません）。狭めたいときは `include` と `exclude` を書き換えます |

`.claude/settings.json` が JSON として読めない（コメントが入っているなど）ときは、何も変えずに止まります。直してからもう一度実行します。

同梱したサブエージェントの名前（`structure-reviewer`、`fresh-eyes-reader`）には接頭辞がつきません。リポジトリやユーザーの `.claude/agents/` に同じ名前のサブエージェントがあると、どちらかが使われなくなるので、同じ名前のものが無いか先に確かめてください。

同梱したスキルは、スクリプトを `${CLAUDE_SKILL_DIR}/../../ja-proofread/` で指します。公式の説明では、`${CLAUDE_SKILL_DIR}` はそのスキルの `SKILL.md` があるディレクトリに置き換わります（`${CLAUDE_PLUGIN_ROOT}`・`${CLAUDE_PLUGIN_DATA}` と違い、プラグインのスキルに限りません。[Available string substitutions](https://code.claude.com/docs/en/skills#available-string-substitutions)）。実際のセッションでは確かめていません。

### 2. コミットしてプッシュする

同梱したものだけを足します。`.claude/settings.json.bak`（できたとき）や、ほかの `.claude/` の中身はコミットしません。

```bash
cd <対象のリポジトリ>
git add .claude/ja-proofread .claude/skills/ja-proofread-* .claude/agents/ja-proofread-* .claude/settings.json .ja-proofread.json
git commit -m "ja-proofread を同梱"
git push
```

### 3. クラウドセッションを開く

1. そのリポジトリだけを選んでセッションを始めます。複数のリポジトリを選ぶと、`.claude/settings.json` のフックは読まれません。SessionStart のフックも動かないので、依存は proofread スキルの準備（`ensure-deps.mjs`）で入れることになります（未確認）。また、そのセッションはクローンの上の階層で始まるので（[Settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions)）、起動のときには `/ja-proofread-proofread` が一覧に出ず、そのリポジトリのファイルに触れたあとで使えるようになると読めます（未確認。[Load skills in monorepos and subdirectories](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)）。`.ja-proofread.json` が見つからない可能性もあります（上の表の※）。
2. 環境のネットワーク設定（Network access）は、既定の「Limited」で「Allow package managers」に印が付いたままにします。新しい環境と Default の環境はこの状態で始まり、このときの許可リストに registry.npmjs.org が入っていて、最初に textlint を入れるのに使います。以前に「Trusted」で保存した環境も、この状態で開きます。段階は None・Limited・Full の3つです。「Allow package managers」の印を外すなら、Allowed domains に registry.npmjs.org を足します。「None」にすると textlint は入らず動きませんが、構成の型と件数で数える型は Node だけで動きます（[Network access](https://code.claude.com/docs/en/cloud-environments#network-access)）。
3. 最初の起動で依存が入ります（数十秒）。入れる先はコンテナの中なので、セッションのたびに入れ直します。入れられなかったときは、その旨が Claude と画面に出ます。
4. 「この文書を校正して」と頼むか、`/ja-proofread-proofread` を呼びます。

Projects のクラウドで動くスレッドで使うときは、同梱したリポジトリをプロジェクトのリポジトリ（Project settings > Environment の Project repositories）に入れて、新しいスレッドを始めます。プロジェクトのリポジトリにするには、つないだ GitHub のアカウントにそのリポジトリへの push の権限があり、そのリポジトリに Claude GitHub App が入っている必要があります。`/web-setup` でつないだトークンは、ほかのクラウドセッションでは使えても、Projects のクラウドのスレッドには足りません（[Check the prerequisites](https://code.claude.com/docs/en/claude-projects#check-the-prerequisites)、[Set up GitHub access](https://code.claude.com/docs/en/claude-projects#set-up-github-access)）。フックは動かないので、書いた直後の校正と、起動のときの依存の準備はありません。「この文書を校正して」と頼むか `/ja-proofread-proofread` を呼ぶと、スキルの準備で依存を入れてから校正します（未確認）。依存は、プロジェクトのクラウドの環境のセットアップスクリプトで入れる手もあります（[Limitations in cloud sessions](https://code.claude.com/docs/en/cloud-environments#limitations-in-cloud-sessions)。このプラグインでは試していません）。

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

`.ja-proofread.json` は残すので、要らなければ消します。消えたことをリポジトリにも反映するため、コミットしてプッシュします。`.ja-proofread.json` も消すときは、`git rm` の行も実行します。ステージするのは同梱したものの名前だけにします（`ja-proofread-*` のような書き方にすると、自分で置いた `ja-proofread-mine` のようなスキルの変更まで一緒に入るため）。同梱したものの一覧は、やめる前の `.claude/ja-proofread/vendored.json` にあります。下はこの版の一覧です。

```bash
cd <対象のリポジトリ>
git add -A -- .claude/ja-proofread .claude/skills/ja-proofread-write .claude/skills/ja-proofread-proofread .claude/skills/ja-proofread-grow-ledger .claude/agents/ja-proofread-structure-reviewer.md .claude/agents/ja-proofread-fresh-eyes-reader.md .claude/settings.json
git rm .ja-proofread.json   # .ja-proofread.json も消すときだけ
git commit -m "ja-proofread の同梱をやめる"
git push
```

### 注意：プラグインと同梱を両方使うと、記録が分かれる

手元でプラグインを入れたまま、同梱したリポジトリを開くと、書いた直後の校正は同梱した版が受け持ち、プラグイン側のフックは黙ります。ただし、データ置き場が別になります。プラグインのスキルはプラグインのデータ置き場（`~/.claude/plugins/data/ja-proofread-ja-doc-proofreading/`）を、同梱した版のフックとスキルは既定の場所（`~/.cache/ja-proofread/`）を使います。そのため、検出の記録・誤検知の記録・フックの前回の結果が2か所に分かれ、`ledger.mjs stats` の数はそれぞれの場所の分だけになります。手元ではどちらか一方を使うか、スクリプトを手で動かすときに `JA_PROOFREAD_DATA` で見たい方の場所を指定します。

## 方法B：リポジトリに同梱しない（どれも確かめていない）

### B1. claude.ai のアカウントにプラグインを足す（クラウドセッション、Projects のクラウドのスレッド）

公式の説明では、claude.ai のアカウントで足したプラグインは、claude.ai/code のクラウドセッションと、Projects で Claude が始めるクラウドのスレッドに読み込まれます（[Install plugins の Cloud session](https://code.claude.com/docs/en/plugins/install#install-a-plugin)、[Plugins synced from claude.ai](https://code.claude.com/docs/en/plugins/loading#plugins-synced-from-claudeai)、[Get skills, plugins, connectors, and tools into threads](https://code.claude.com/docs/en/claude-projects#get-skills-plugins-connectors-and-tools-into-threads)）。リポジトリに同梱しなくてよい方法です。

1. [claude.ai/customize/plugins](https://claude.ai/customize/plugins) を開き、Add > Add marketplace を選びます。
2. `andy0911/ja-doc-proofreading` を入れます。このリポジトリは非公開なので、ダイアログに従って GitHub のアカウントをつなぎ、Claude GitHub App にこのリポジトリへのアクセスを与えます。アクセスが足りないときは、ダイアログに Connect GitHub か Install the Claude GitHub App が出ます（[Find and add a plugin](https://claude.com/docs/plugins/overview#find-and-add-a-plugin)）。
3. 一覧に出た ja-proofread を足し、新しいセッション（Projects なら新しいスレッド）を始めます。
4. Team・Enterprise のプランでは、どの足し方を使えるかを Owner が決めます。

新しい版が出たら、Check for updates を選びます。github.com から足したマーケットプレイスは、Sync automatically をオンにすると自動で取り込まれます（[Manage installed plugins](https://claude.com/docs/plugins/overview#manage-installed-plugins)）。

ただし、この経路で読み込んだときに、このプラグインのフック（起動のときの依存の準備と、書いた直後の校正）、依存（textlint）を入れる場所、データ置き場（`${CLAUDE_PLUGIN_DATA}`）が動くかは確かめていません。動かないときは方法Aを使います。

同じアカウントでログインした手元の Claude Code にも、`ja-proofread@synced` という名前で読み込まれます（端末では v2.1.273 以降）。公式の説明では、手元で[マーケットプレイスから入れた](install-local.md)同じ名前のプラグインもあると、手元のほうが読み込まれ、claude.ai から同期したほうは「読み込まれていない」と表示されます。claude.ai のほうを使いたいときは、手元のほうを無効にします（[Name conflicts](https://code.claude.com/docs/en/plugins/loading#name-conflicts)）。公式ではこう説明されていますが、このプラグインで実機ではまだ確かめていません。手元で同期したほうだけを止めたいときは、`claude plugin disable ja-proofread@synced` を実行します（[Control which synced plugins load](https://code.claude.com/docs/en/plugins/loading#control-which-synced-plugins-load)）。

### B2. Projects のスレッド

Projects は Pro・Max・Ultra のプランで使えます（Team・Enterprise ではまだ使えません。[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。Project settings に、プラグインの項目はありません（項目は General・Memory・Environment・Usage・Advanced。[Project settings reference](https://code.claude.com/docs/en/claude-projects#project-settings-reference)）。クラウドで動くスレッドには、B1 のとおり claude.ai のアカウントで足したプラグインが読み込まれます。プロジェクトのリポジトリに方法Aで同梱したスキルとサブエージェントも読み込まれます（フックは動きません）。

### B3. claude.ai のアカウントのスキル

claude.ai のアカウントで有効にしたスキルは、クラウドセッションでも読み込まれると説明されています（[Skills](https://code.claude.com/docs/en/skills)、[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。ただし入るのはスキルだけで、フックと textlint は入りません。このプラグインのスキルはスクリプトを `${CLAUDE_PLUGIN_ROOT}` で指しているので、そのままアップロードしても機械チェックは動かないはずです（試していません）。台帳を読んで書く `write` スキルの考え方だけを使う、という使い方になります。

### B4. Projects のスレッドを自分のコンピューターで動かす（未確認）

公式の説明では、Projects のスレッドは、Remote Control を通して自分のコンピューターのフォルダーで動く Claude Code のセッションにできます。そのときは、そのコンピューターのファイル・ツール・MCP サーバー・Claude Code の設定（フックや権限の規則を含む）で動きます（[Run a thread on your own computer](https://code.claude.com/docs/en/claude-projects)）。このため、そのコンピューターに入れたプラグイン（[install-local.md](install-local.md) の手順）か、方法Aで同梱したリポジトリのスキル・フックが使える見込みです。ただし、このプラグインで実際に試してはいません。

公式の説明にある条件と手順は、主に次のとおりです（[Run a thread on your own computer](https://code.claude.com/docs/en/claude-projects#run-a-thread-on-your-own-computer)、[Remote Control の Requirements](https://code.claude.com/docs/en/remote-control#requirements)）。

- そのコンピューターに Claude Code v2.1.280 以降が要ります
- Projects は Pro・Max・Ultra のプランだけで使えます
- claude.ai のアカウントでログインしているときだけ使えます（`/login`）。API キー、Amazon Bedrock・Google Cloud の Agent Platform・Microsoft Foundry、`ANTHROPIC_BASE_URL` をほかのホストに向けているとき、Claude apps gateway からのログインでは使えません
- 環境変数 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` か `CLAUDE_CODE_DISABLE_FEATURE_FLAGS` を設定していると、Remote Control は使えません。シェルの環境と、`settings.json` の `env` の両方から外します
- まだ信頼していないフォルダーで `claude remote-control` を動かすと、ワークスペースを信頼するか（`Trust <directory>? [y/N]`）を聞かれます。`y` と答えると覚えます（ホームディレクトリでは覚えず、毎回聞かれます）。端末から動かしていないときは聞けないので、`Workspace not trusted` で止まります
- スレッドが動くのは、そのコンピューターが起きていて Remote Control がつながっている間だけです
- アカウントで「Require trusted devices」が有効なときは、「Work locally」が灰色になり、そのプロジェクトのスレッドを自分のコンピューターで動かせません。そのフォルダーで作業するときは、そのコンピューターで Claude Code を直接動かします（[Trusted Devices](https://code.claude.com/docs/en/remote-control#trusted-devices)。Pro・Max・Ultra では本人が Cowork か Account の設定でオンにします）
- 準備：デスクトップアプリの Settings > Code（または Settings > Claude Code）で「Use this computer from your phone and claude.ai」をオンにし、そのスイッチの下の一覧にフォルダーを足します（アプリを開いている間だけ動きます）。または、そのフォルダーで `claude remote-control` を実行したままにします
- スレッドを始めるには、プロジェクトの会話で + のメニューから「Work locally」（デスクトップアプリでは「Work in a local folder」）を選び、やってほしいことを書きます。メッセージの中で、その作業を自分のコンピューターで動かしてほしいと書いても同じです。「Allow Claude to work in a folder on your computer」のカードが出たら、フォルダーを選んで「Allow once」を押します
- プラグインを入れたり同梱したりする前から動いているスレッドには、プラグインが読み込まれていないことがあります。そのときは、プロジェクトの会話で新しいスレッドを始めるよう頼みます
- スレッドは、プロジェクトの指示を持って始まりますが、プロジェクトのメモリーのファイルは読み込みません

プラグインを更新したあと、すでに動いているセッションに反映するには `/reload-plugins` が要ります。公式の説明では、`/plugin` は手元の端末でしか使えず、`/reload-plugins` はスマートフォンや Web から送れるものの、そのセッションが対話できる端末で動いているときだけ受け付けます（[Remote Control の Limitations](https://code.claude.com/docs/en/remote-control)）。対話できる端末のないセッション（デスクトップアプリなど）でも `/reload-plugins` は動きますが、そのセッションに直接打ち込んだときだけです。Remote Control から届いたときは `/reload-plugins isn't available over a remote connection in this session.` と返し、何も読み込み直しません（[Sessions without an interactive terminal](https://code.claude.com/docs/en/plugins/cli-reference#sessions-without-an-interactive-terminal)）。Projects のスレッドで受け付けられないときは、プロジェクトの会話で新しいスレッドを始めるよう頼みます（新しいスレッドで新しい版が読み込まれる見込み。未確認）。

参考：Projects の外で Remote Control を使うときは、Team・Enterprise のプランでも使えます。そのときは先に Owner が [Claude Code の管理設定](https://claude.ai/admin-settings/claude-code)で Remote Control を有効にします（[Remote Control の Requirements](https://code.claude.com/docs/en/remote-control#requirements)）。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| スキルが一覧に出ない | `.claude/skills/ja-proofread-*` をコミットしたか。プッシュ前のブランチでセッションを始めていないか。リポジトリを複数選んだセッションでは、起動のときには一覧に出ず、そのリポジトリのファイルを Claude に読ませるか編集させたあとで出ると読めます（未確認）。Projects のクラウドのスレッドでは、2026年10月1日より前に始めたスレッドや、名前がドットで始まるリポジトリを含むスレッドなどでは出ないので、新しいスレッドを始めるか、B4 のように自分のコンピューターで動かします。セルフホスト（self-hosted）の環境では、リポジトリのスキル・サブエージェント・コマンドを読まないことがあるので、ランナーのイメージに入れます |
| 書いた直後の校正が動かない | リポジトリを1つだけ選んで始めたか。`.ja-proofread.json` がリポジトリの直下にあるか。Projects のクラウドのスレッドではフックが動かないので、スキルで校正します |
| 「textlint の依存がまだ入っていません」と出る | 環境のネットワークが Limited で「Allow package managers」に印が付いているか（印を外したなら Allowed domains に registry.npmjs.org があるか、Full か）。セルフホストの環境なら、ランナーから registry.npmjs.org に届くか。`node .claude/ja-proofread/scripts/ensure-deps.mjs` を実行して npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 指摘が二重に出る | 手元で同じリポジトリを開いたときは、同梱した版が優先され、プラグイン側のフックは黙ります。それでも二重なら `.claude/settings.json` のフックが重複していないか見る |
