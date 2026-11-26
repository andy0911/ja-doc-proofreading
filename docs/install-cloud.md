# クラウドで使う（Claude Code on the web、claude.ai の Projects）

まずどれを使うか：claude.ai/code で、校正したいリポジトリを1つだけ選んでセッションを始め、その中で次の1行を実行します（Claude に「この1行を実行して」と頼んでも、自分で打っても同じです）。手元にプラグインを入れていなくても、手元の計算機がなくても済みます。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs
```

そのあと、表示されたコマンドでコミットしてプッシュし、新しいセッションを始めます。起動のときの依存の準備（SessionStart のフック）と書いた直後の校正は、新しいセッションから動きます。詳しくは下の方法Aです。同梱すると、同梱先のリポジトリに Notion の候補一覧の場所が載ります。場所を知られたくないリポジトリには同梱しないでください（方法Aの注意）。

手元の Claude Code で使うなら [install-local.md](install-local.md) です。claude.ai/customize/plugins でアカウントにプラグインを足す方法は、公式の説明ではクラウドセッションにも読み込まれるとされていますが、持ち主の環境では、その画面でこのマーケットプレイスの追加ができなかったので、主な手順にはせず参考に回しています（下の B1）。

claude.ai/code の Projects で使うなら、リポジトリの有無にかかわらず、[install-projects.md](install-projects.md) の kit（`/mnt/project-files` に一式を書き、プロジェクト指示で毎回の校正を頼む）が主な手順です。

この文書の「claude.ai の Projects」は、claude.ai/code の Projects（Claude Code の Projects）のことです。claude.ai のチャットのプロジェクト（claude.ai の Projects。プロジェクトの指示・ファイル・スキルを入れて使うもの）では、Claude Code とプラグインは動かないので、スキルの zip を上げて使います。[install-claude-ai.md](install-claude-ai.md) を見てください。

## 先に、どこで動くか

| 使う場所 | このプラグインの使い方 | 確かめた程度 |
|---|---|---|
| claude.ai/code で、リポジトリを1つだけ選んだセッション | 方法A（セッションの中で一式を入れてコミットする） | クラウドのコンテナの中で、一式を入れた一時リポジトリに `claude -p` を動かし、スキルとサブエージェントが見え、Write の後にフックの指摘が返ることを確認。claude.ai/code で新しく始めたセッションそのものでは未確認 |
| claude.ai/code で、リポジトリを複数選んだセッション | 方法A。ただしフックは動かない（※） | 未確認 |
| claude.ai の Projects のスレッドで、クラウドで動くもの（Projects は Pro・Max・Ultra のプランだけ） | [install-projects.md](install-projects.md) の kit（`--project-kit`）とプロジェクト指示。リポジトリがあれば、方法Aで同梱してスキルとサブエージェントを使う手もある（フックは動かないので書いた直後の自動校正はなく、依存は proofread スキルの準備（`ensure-deps.mjs`）で入る。※） | kit：Projects のクラウドのスレッドの中で、kit を書き、空の HOME で校正が動くことと、貼る部分を渡した `claude -p` が書いた文書を校正して直すことを確認。プロジェクト指示に貼った新しいスレッドでは未確認。同梱：未確認 |
| claude.ai のアカウントにプラグインを足したとき（claude.ai/customize/plugins） | 公式の説明では、クラウドセッションと、Projects のクラウドで動くスレッドに読み込まれる（下の B1。参考） | 持ち主の環境では、claude.ai/customize/plugins でこのマーケットプレイスの追加ができなかった |
| claude.ai の Projects のスレッドで、自分のコンピューターで動かすもの（Remote Control） | そのコンピューターの Claude Code が動くので、手元に入れたプラグインか、方法Aで同梱したリポジトリが使える見込み（下の B4） | 未確認 |

※ 公式の説明では、リポジトリを複数選んだセッションは、クローンの上の階層で始まります（[Settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions)）。そのため、リポジトリの直下に置いた `.ja-proofread.json` が見つからず、既定の設定（`include`・`exclude`・`prh` などを書いていない状態）で校正される可能性があります（未確認）。また、始めた場所より下の `.claude/skills/` は起動のときには読まれず、そのフォルダーのファイルを Claude が読むか編集したときに読まれます（[Load skills in monorepos and subdirectories](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)）。そのため、起動した直後は `/ja-proofread-proofread` が一覧に出ず、そのリポジトリのファイルに触れたあとで使えるようになると読めます（未確認）。起動した直後から使いたいときは、セッションの中で `/add-dir <そのリポジトリのパス>` を実行すると、そのリポジトリの `.claude/skills/` が読み込まれます（Claude Code v2.1.257 以降。同じ Load skills in monorepos and subdirectories）。Projects のスレッドのうちクラウドで動くものは別で、公式の説明では、スキル・サブエージェント・コマンドはリポジトリが複数あってもリポジトリごとに読み込まれます（下の段落と [What threads pick up from your repositories](https://code.claude.com/docs/en/claude-projects#what-threads-pick-up-from-your-repositories)）。リポジトリの直下の `.ja-proofread.json` が見つからないおそれは、Projects のスレッドでリポジトリが複数あるときにもあるかもしれません（未確認）。

クラウドセッションは、毎回まっさらなコンテナでリポジトリを開きます。手元で入れたプラグインは持ち込まれません。公式の説明では、ユーザー設定で有効にしたプラグインは読み込まれず、リポジトリの `.claude/settings.json` の `extraKnownMarketplaces` に書いたマーケットプレイスも足されません。読み込まれるのは主に、claude.ai のアカウントで足したプラグイン（下の B1。持ち主の環境では、このマーケットプレイスの追加ができなかった）と、リポジトリの `.claude/skills/`、`.claude/agents/`、`.claude/commands/`、`CLAUDE.md` です。セッションはリポジトリの新しいクローンから始まり、`.claude/settings.json` の `hooks` は、リポジトリを1つだけ選んだセッションでだけ読まれます（[What carries over from your setup](https://code.claude.com/docs/en/cloud-environments#what-carries-over-from-your-setup)）。

そのため、手元のプラグインの写し（`~/.claude/plugins/marketplaces/...`）から動かす `install-into-project.mjs` は、クラウドセッションの中では使えません。また、GitHub のプロキシは、セッションに付いていないリポジトリへの API と、`github.com/…/archive/`・`codeload.github.com` からの取得を、公開リポジトリでも 403 にします（[GitHub proxy](https://code.claude.com/docs/en/cloud-environments#github-proxy)）。このマーケットプレイスのリポジトリをセッションの中でクローンすることも、通らない見込みです。一方、公開リポジトリのファイルは raw.githubusercontent.com から取れ、このドメインは既定の許可リストに入っています（同じ GitHub proxy の項と [Default allowed domains](https://code.claude.com/docs/en/cloud-environments#default-allowed-domains)）。そこで方法Aでは、同梱に要るファイルを1つにまとめた `dist/ja-proofread-setup.mjs` をそこから取ります。

Projects のスレッドのうちクラウドで動くものも、リポジトリの `CLAUDE.md`、`.claude/CLAUDE.md`、`.claude/rules/` に加えて、`.claude/` の下のスキル・サブエージェント・コマンドを読みます。読まないのは、`.mcp.json` と、`.claude/settings.json` のフック・権限の規則・`env` です（[What threads pick up from your repositories](https://code.claude.com/docs/en/claude-projects#what-threads-pick-up-from-your-repositories)）。ただし、2026年10月1日より前に始めたスレッド、名前がドットで始まるリポジトリ（`.github` など）を含むスレッド、セルフホスト（self-hosted）の環境のスレッドなどは、スキル・サブエージェント・コマンドも読みません（[Threads that skip repository skills](https://code.claude.com/docs/en/claude-projects#threads-that-skip-repository-skills)。セルフホストの環境では、スキル・サブエージェント・コマンドをランナーのイメージに入れます）。そのため、方法Aで同梱すれば、スキルとサブエージェントは使える見込みです。フックは動かないので、書いた直後の自動校正はありません。依存は、proofread スキルの準備（`ensure-deps.mjs`）で入ります（未確認）。書いた直後の校正もさせたいとき、プロジェクトにリポジトリがないときは、[install-projects.md](install-projects.md) の kit とプロジェクト指示を使います。自分のコンピューターで動かすスレッドは別で、下の B4 を見てください。

## 方法A：リポジトリに同梱する

プラグインの部品を、校正したいリポジトリの `.claude/` に入れてコミットします。クラウドセッションはリポジトリの新しいクローンから始まり、リポジトリの `.claude/skills/`・`.claude/agents/` と（リポジトリを1つだけ選んだセッションでは）`.claude/settings.json` のフックを読むので、プラグインを入れなくても動きます。

確かめたこと：クラウドのコンテナ（外向きの通信はプロキシを通る）で、空の git リポジトリに上の curl と node で一式を入れ、依存の準備（`ensure-deps.mjs`）、Write の後のフック（「必ず直す」の指摘が返る）、`claude -p` でのスキルの一覧とフックの指摘を確かめました。claude.ai/code で新しく始めたセッションそのものでスキルの一覧に出るか、フックが呼ばれるかは、まだ確かめていません。

### 注意：同梱先のリポジトリに、Notion の候補一覧の場所が載る

同梱すると `.claude/ja-proofread/data/settings.json` もコミットされ、同梱先のリポジトリに、台帳候補を受け付ける Notion データベース（候補一覧）の場所が載ります。この場所はこのプラグインの公開リポジトリにもすでに載っていて、候補一覧の中身は Notion の共有設定で守られます。それでも、同梱先のリポジトリを見る人に候補一覧の場所を知られたくないなら（公開リポジトリや、社外の人と共有しているリポジトリなど）、同梱しないでください。

### 1. 同梱する（クラウドセッションの中で）

claude.ai/code で、校正したいリポジトリを1つだけ選んでセッションを始め、その中で次の1行を実行します。Claude に「次の1行を実行して」と頼んでも、自分で打っても同じです。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs
```

`node /tmp/ja-proofread-setup.mjs` は、カレントディレクトリ（セッションが始まったリポジトリの根）に同梱します。ほかの場所なら `node /tmp/ja-proofread-setup.mjs <リポジトリの根>` と指定します。git の作業コピーの根でないところでは、何も書かずに止まります。

`dist/ja-proofread-setup.mjs` は依存のない Node のスクリプトで、同梱に要るファイル（`install-into-project.mjs` がコピーするものと同じ一式）を中に持っています。動かすと、中のファイルの sha256 をすべて確かめてから一時ディレクトリに書き出し、その中の `install-into-project.mjs` を動かして、一時ディレクトリを消します。入るものは下の表のとおりで、`install-into-project.mjs` で同梱したときと同じです。最後に、コミットするパスと `git add … && git commit … && git push -u origin HEAD` の例を表示します。`git push -u origin HEAD` なので、上流を決めていない作業用のブランチ（クラウドセッションの `claude/…` など）でも、そのままプッシュできます。

ダウンロードに curl を使うのは、クラウドの外向きの通信がプロキシを通り、Node の `fetch` は既定ではプロキシ（`HTTPS_PROXY`）を使わないためです。

#### 版を固定する

`main` の URL は、いちばん新しい版を指します。版を固定したいときは、`main` の代わりにその版のコミットの SHA を入れ、ファイルの sha256 を確かめてから動かします。

使うコミットの SHA は、GitHub の [dist/ja-proofread-setup.mjs の履歴](https://github.com/andy0911/ja-doc-proofreading/commits/main/dist/ja-proofread-setup.mjs) で探します。各版のコミットのメッセージは版の番号（`0.1.9：…` など）で始まるので、使いたい版のコミットを選び、その SHA（40文字。コピーのボタンで写せます）を下の `<コミットのSHA>` に入れます。タグは使いません。その版の sha256 は、[CHANGELOG.md](../CHANGELOG.md) のその版の項に書いています（0.1.8 から）。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/<コミットのSHA>/dist/ja-proofread-setup.mjs && echo "<CHANGELOG に書いた sha256>  /tmp/ja-proofread-setup.mjs" | sha256sum -c - && node /tmp/ja-proofread-setup.mjs
```

`sha256sum -c` が `OK` を出したときだけ node まで進み、合わなければそこで止まります。`node /tmp/ja-proofread-setup.mjs --version` で中の版を、`--list` で中のファイルとその sha256 を確かめられます。

一式の中に持っている各ファイルの sha256 で防げるのは、取る途中で壊れたり途切れたりしたファイルだけです。ファイルごと書き換えられたときは、中の sha256 も一緒に書き換えられるので防げません。書き換えに備えるのは、版の固定（コミットの SHA を入れた URL）と、外の sha256（CHANGELOG のものを前もって控えておく）との照らし合わせです。

#### 手元の Claude Code から同梱する

同じファイルで、手元の端末からも同梱できます。手元にプラグインを入れていなくても構いません。手元（macOS など）の `/tmp` はほかのユーザーやプログラムと共有していることがあるので、`mktemp -d` で作った自分だけの場所に落とします。

```bash
f="$(mktemp -d)/ja-proofread-setup.mjs" && curl -fsSLo "$f" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node "$f" <対象のリポジトリ>
```

版を固定するときは、次のようにします（`<コミットのSHA>` と sha256 の探し方は上の「版を固定する」と同じです）。

```bash
# Linux
f="$(mktemp -d)/ja-proofread-setup.mjs" && curl -fsSLo "$f" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/<コミットのSHA>/dist/ja-proofread-setup.mjs && echo "<CHANGELOG に書いた sha256>  $f" | sha256sum -c - && node "$f" <対象のリポジトリ>
# macOS
f="$(mktemp -d)/ja-proofread-setup.mjs" && curl -fsSLo "$f" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/<コミットのSHA>/dist/ja-proofread-setup.mjs && echo "<CHANGELOG に書いた sha256>  $f" | shasum -a 256 -c - && node "$f" <対象のリポジトリ>
```

手元にプラグインを入れていれば（[install-local.md](install-local.md)）、これまでどおり、手元のマーケットプレイスの写しのスクリプトでも同じものが入ります。

```bash
node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>
```

このマーケットプレイスのリポジトリをクローンした作業コピーがあれば、`node ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ>` でも同じです。

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

同梱したものだけを足します。1. の最後に表示されるコマンドと同じです（クラウドセッションの中なら、Claude に「表示されたコマンドでコミットしてプッシュして」と頼めます）。`.claude/settings.json.bak`（できたとき）や、ほかの `.claude/` の中身はコミットしません。下はこの版で同梱したものの名前です（`ja-proofread-*` と書くと、自分で置いた `ja-proofread-mine` のようなスキルまで入るため、名前で書きます）。

```bash
cd <対象のリポジトリ> && git add .claude/ja-proofread .claude/skills/ja-proofread-grow-ledger .claude/skills/ja-proofread-proofread .claude/skills/ja-proofread-write .claude/agents/ja-proofread-fresh-eyes-reader.md .claude/agents/ja-proofread-structure-reviewer.md .claude/settings.json .ja-proofread.json && git commit -m "ja-proofread を同梱" && git push -u origin HEAD
```

`git push -u origin HEAD` は、今のブランチを同じ名前で origin にプッシュし、上流に決めます。上流のない作業用のブランチでも、そのまま通ります。

### 3. 新しいセッションを始める

1. プッシュしたら、そのリポジトリだけを選んで、新しいセッションを始めます。SessionStart のフック（起動のときの依存の準備）はセッションが始まるときに動くので、同梱したセッションでは動いていません。そのセッションでは、書いた直後の校正も動かないことがあります。プッシュした先が作業用のブランチなら、既定のブランチにマージしてから始めるか、そのブランチで始めます。複数のリポジトリを選ぶと、`.claude/settings.json` のフックは読まれません。SessionStart のフックも動かないので、依存は proofread スキルの準備（`ensure-deps.mjs`）で入れることになります（未確認）。また、そのセッションはクローンの上の階層で始まるので（[Settings in cloud sessions](https://code.claude.com/docs/en/settings#settings-in-cloud-sessions)）、起動のときには `/ja-proofread-proofread` が一覧に出ず、そのリポジトリのファイルに触れたあとで使えるようになると読めます（未確認。[Load skills in monorepos and subdirectories](https://code.claude.com/docs/en/skills#load-skills-in-monorepos-and-subdirectories)）。`.ja-proofread.json` が見つからない可能性もあります（上の表の※）。
2. 環境のネットワーク設定（Network access）は、既定の「Limited」で「Allow package managers」に印が付いたままにします。新しい環境と Default の環境はこの状態で始まり、このときの許可リストに registry.npmjs.org が入っていて、最初に textlint を入れるのに使います。以前に「Trusted」で保存した環境も、この状態で開きます。段階は None・Limited・Full の3つです。「Allow package managers」の印を外すなら、Allowed domains に registry.npmjs.org を足します。「None」にすると textlint は入らず動きませんが、構成の型と件数で数える型は Node だけで動きます（[Network access](https://code.claude.com/docs/en/cloud-environments#network-access)）。1. の curl が取りに行く raw.githubusercontent.com も、この既定の許可リストに入っています。「None」では取れません。
3. 最初の起動で依存が入ります（数十秒）。入れる先はコンテナの中なので、セッションのたびに入れ直します。入れられなかったときは、その旨が Claude と画面に出ます。
4. 「この文書を校正して」と頼むか、`/ja-proofread-proofread` を呼びます。

Projects のスレッドのうちクラウドで動くものに使うときは、同梱したリポジトリをプロジェクトのリポジトリ（Project settings > Environment の Project repositories）に入れて、新しいスレッドを始めます。プロジェクトのリポジトリにするには、つないだ GitHub のアカウントにそのリポジトリへの push の権限があり、そのリポジトリに Claude GitHub App が入っている必要があります。`/web-setup` のトークンは、ほかのクラウドセッションには使えても、Projects のクラウドのスレッドには足りません（[Check the prerequisites](https://code.claude.com/docs/en/claude-projects#check-the-prerequisites)、[Set up GitHub access](https://code.claude.com/docs/en/claude-projects#set-up-github-access)）。フックは動かないので、書いた直後の校正と、起動のときの依存の準備はありません。「この文書を校正して」と頼むか `/ja-proofread-proofread` を呼ぶと、スキルの準備で依存を入れてから校正します（未確認）。依存は、プロジェクトのクラウドの環境のセットアップスクリプトに入れる手もあります（[Limitations in cloud sessions](https://code.claude.com/docs/en/cloud-environments#limitations-in-cloud-sessions)。このプラグインでは試していません）。書いた直後の校正の代わりは、[install-projects.md](install-projects.md) の kit とプロジェクト指示です（同梱と一緒に使えます）。

### 新しい版にする

クラウドセッションの中でも手元でも、1. の1行（手元なら「手元の Claude Code から同梱する」の1行）をもう一度実行します（`main` の URL なら、いちばん新しい版が入ります）。同梱した部品は新しい版に入れ替わり、フックは重複しません。そのあと 2. でコミットしてプッシュし、新しいセッションを始めます。

手元のマーケットプレイスの写しや、クローンした作業コピーの `install-into-project.mjs` を使うときは、先にそれを最新にします。古いままの場所から同梱し直すと、古い版が入ります。

```bash
# 手元にプラグインを入れているとき
claude plugin marketplace update ja-doc-proofreading
# クローンした作業コピーを使うとき
git -C ja-doc-proofreading pull
```

そのあと、その `install-into-project.mjs` で同梱し直し、2. を実行します。同梱した版（`.claude/ja-proofread/scripts/`）の install-into-project.mjs からは実行できないので、必ず、クローンした作業コピーの `ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` か、手元のマーケットプレイスの写しの `~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` を使います。`~/.claude/plugins/cache/` の下や `${CLAUDE_PLUGIN_ROOT}` の下のものは、読み込み済みの版なので、update のあとでも古いことがあります。

### やめる

1. と同じファイルに `--remove` をつけて、リポジトリの根で動かします（クラウドセッションの中でも動きます）。最後に、ステージするパスと `git add -A -- … && git commit … && git push -u origin HEAD` の例を表示します。同梱が無かったときは、何も変えず、パスと例も出さずに終わります。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs --remove
```

手元では、`mktemp -d` の形（「手元の Claude Code から同梱する」の1行）の最後の `<対象のリポジトリ>` のあとに `--remove` をつけます。

手元のプラグインの写しからなら `node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs <対象のリポジトリ> --remove`、クローンした作業コピーからなら `ja-doc-proofreading/plugins/ja-proofread/scripts/install-into-project.mjs` に読み替えます。

フックと、同梱したときに入れた部品だけが消えます。同梱したものの一覧は `.claude/ja-proofread/vendored.json` に記録しています。そのため、あとから自分で足したスキルなどは、名前が `ja-proofread-` から始まっていても残ります。同梱のときに `.claude/settings.json` や `.claude/skills/` などを新しく作っていたなら、空になったものも消します。一度も同梱していないリポジトリで実行したときは、何も変えずに終わります。

`.ja-proofread.json` は残すので、要らなければ消します。消えたことをリポジトリにも反映するため、コミットしてプッシュします。ステージするのは同梱したものの名前だけにします（`ja-proofread-*` のような書き方にすると、自分で置いた `ja-proofread-mine` のようなスキルの変更まで一緒に入るため）。同梱したものの一覧は、やめる前の `.claude/ja-proofread/vendored.json` にあります。下はこの版の一覧で、表示される例と同じ並びです（表示では、コミットしていたものだけに絞られます）。

```bash
cd <対象のリポジトリ> && git add -A -- .claude/ja-proofread .claude/skills/ja-proofread-grow-ledger .claude/skills/ja-proofread-proofread .claude/skills/ja-proofread-write .claude/agents/ja-proofread-fresh-eyes-reader.md .claude/agents/ja-proofread-structure-reviewer.md .claude/settings.json && git commit -m "ja-proofread の同梱をやめる" && git push -u origin HEAD
```

`.ja-proofread.json` も消すときは、先に `git rm .ja-proofread.json` を実行してから、上の行を実行します。

### 注意：プラグインと同梱を両方使うと、記録が分かれる

手元でプラグインを入れたまま、同梱したリポジトリを開くと、書いた直後の校正は同梱した版が受け持ち、プラグイン側のフックは黙ります。ただし、データ置き場が別になります。プラグインのスキルはプラグインのデータ置き場（`~/.claude/plugins/data/ja-proofread-ja-doc-proofreading/`）を、同梱した版のフックとスキルは既定の場所（`~/.cache/ja-proofread/`）を使います。そのため、検出の記録・誤検知の記録・フックの前回の結果が2か所に分かれ、`ledger.mjs stats` の数はそれぞれの場所の分だけになります。手元ではどちらか一方を使うか、スクリプトを手で動かすときに `JA_PROOFREAD_DATA` で見たい方の場所を指定します。

## 方法B：リポジトリに同梱しない（参考。主な手順にはしていない）

### B1. claude.ai のアカウントにプラグインを足す（参考。持ち主の環境ではマーケットプレイスの追加ができなかった）

公式の説明では、claude.ai のアカウントで足したプラグインは、claude.ai/code のクラウドセッションと、Projects で Claude が始めるクラウドのスレッドに読み込まれます（[Install plugins の Cloud session](https://code.claude.com/docs/en/plugins/install#install-a-plugin)、[Plugins synced from claude.ai](https://code.claude.com/docs/en/plugins/loading#plugins-synced-from-claudeai)、[Get skills, plugins, connectors, and tools into threads](https://code.claude.com/docs/en/claude-projects#get-skills-plugins-connectors-and-tools-into-threads)）。リポジトリに同梱しなくてよい方法です。ただし、持ち主の環境では、claude.ai/customize/plugins でこのマーケットプレイスの追加ができませんでした。そのため主な手順にはせず、参考として残します。クラウドでは方法Aを使ってください。

1. [claude.ai/customize/plugins](https://claude.ai/customize/plugins) を開き、Add > Add marketplace を選びます。
2. `andy0911/ja-doc-proofreading` を入れます。このリポジトリは公開なので、GitHub のアカウントをつないだり Claude GitHub App にアクセスを与えたりする必要はありません（それが要るのは非公開のリポジトリのとき。[Find and add a plugin](https://claude.com/docs/plugins/overview#find-and-add-a-plugin)）。
3. 一覧に出た ja-proofread を足し、新しいセッション（Projects なら新しいスレッド）を始めます。
4. Team・Enterprise のプランでは、どの足し方を使えるかを Owner が決めます。

新しい版が出たら、Check for updates を選びます。github.com から足したマーケットプレイスは、Sync automatically をオンにすると自動で取り込まれます（[Manage installed plugins](https://claude.com/docs/plugins/overview#manage-installed-plugins)）。

追加できて読み込まれたとしても、このプラグインのフック（起動のときの依存の準備と、書いた直後の校正）、依存（textlint）を入れる場所、データ置き場（`${CLAUDE_PLUGIN_DATA}`）が動くかは確かめていません。

同じアカウントでログインした手元の Claude Code にも、`ja-proofread@synced` という名前で読み込まれます（端末では v2.1.273 以降）。公式の説明では、手元で[マーケットプレイスから入れた](install-local.md)同じ名前のプラグインもあると、手元のほうが読み込まれ、claude.ai から同期したほうは「読み込まれていない」と表示されます。claude.ai のほうを使いたいときは、手元のほうを無効にします（[Name conflicts](https://code.claude.com/docs/en/plugins/loading#name-conflicts)）。公式ではこう説明されていますが、このプラグインで実機ではまだ確かめていません。手元で同期したほうだけを止めたいときは、`claude plugin disable ja-proofread@synced` を実行します（[Control which synced plugins load](https://code.claude.com/docs/en/plugins/loading#control-which-synced-plugins-load)）。

### B2. Projects のスレッド

Projects は Pro・Max・Ultra のプランで使えます（Team・Enterprise ではまだ使えません。[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。Project settings に、プラグインの項目はありません（項目は General・Memory・Environment・Usage・Advanced。[Project settings reference](https://code.claude.com/docs/en/claude-projects#project-settings-reference)）。公式の説明では、クラウドで動くスレッドには、B1 のとおり claude.ai のアカウントで足したプラグインが読み込まれます（持ち主の環境では、B1 のマーケットプレイスの追加ができませんでした）。プロジェクトのリポジトリに方法Aで同梱したスキルとサブエージェントも読み込まれます（フックは動きません）。主な手順は [install-projects.md](install-projects.md) です。

### B3. claude.ai のアカウントのスキル

claude.ai のアカウントで有効にしたスキルは、クラウドセッションでも読み込まれると説明されています（[Skills](https://code.claude.com/docs/en/skills)、[Claude Projects](https://code.claude.com/docs/en/claude-projects)）。ただし入るのはスキルだけで、フックと textlint は入りません。このプラグインのスキルはスクリプトを `${CLAUDE_PLUGIN_ROOT}` で指しているので、そのままアップロードしても機械チェックは動かないはずです（試していません）。台帳を読んで書く `write` スキルの考え方だけを使う、という使い方になります。

### B4. Projects のスレッドを自分のコンピューターで動かす（未確認）

公式の説明では、Projects のスレッドは、Remote Control を通して自分のコンピューターのフォルダーで動く Claude Code のセッションにできます。そのときは、そのコンピューターのファイル・ツール・MCP サーバー・Claude Code の設定（フックや権限の規則を含む）で動きます（[Run a thread on your own computer](https://code.claude.com/docs/en/claude-projects)）。このため、そのコンピューターに入れたプラグイン（[install-local.md](install-local.md) の手順）か、方法Aで同梱したリポジトリのスキル・フックが使える見込みです。ただし、このプラグインで実際に試してはいません。

公式の説明にある条件と手順は、主に次のとおりです（[Run a thread on your own computer](https://code.claude.com/docs/en/claude-projects#run-a-thread-on-your-own-computer)、[Remote Control の Requirements](https://code.claude.com/docs/en/remote-control#requirements)）。

- そのコンピューターに Claude Code v2.1.280 以降が要ります
- Projects は Pro・Max・Ultra のプランだけで使えます
- claude.ai のアカウントでログインしているときだけ使えます（`/login`）。API キー、Amazon Bedrock・Google Cloud の Agent Platform・Microsoft Foundry、`ANTHROPIC_BASE_URL` をほかのホストに向けているとき、Claude apps gateway からのログインでは使えません
- 環境変数 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` か `CLAUDE_CODE_DISABLE_FEATURE_FLAGS` を設定していると、Remote Control は使えません。シェルの環境と、`settings.json` の `env` の両方から外します
- まだ信頼していないフォルダーで `claude remote-control` を動かすと、ワークスペースを信頼するか（`Trust <directory>? [y/N]`）を聞かれます。`y` を選ぶと覚えます（ホームディレクトリでは覚えず、毎回聞かれます）。端末から動かしていないときは聞けないので、`Workspace not trusted` で止まります
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
| 1. の curl が 403 になる・つながらない（`curl: (22) … 403`、`Could not resolve host`、`CONNECT tunnel failed` など） | 環境のネットワーク（Network access）が「None」になっていないか。「Limited」なら、許可リストに raw.githubusercontent.com が入っているか（既定の許可リストには入っています。Allowed domains を自分で決めているなら足します）。URL のつづりと、`main` かコミットの SHA かを確かめる。`github.com/…/archive/`・`codeload.github.com`・GitHub の API からは、セッションに付いていないリポジトリだと公開でも 403 になるので、raw.githubusercontent.com の URL を使う |
| 同梱してプッシュしたのに、書いた直後の校正が動かない | 同梱したそのセッションでは、SessionStart のフックが動いておらず、フックも読み込まれていないことがあります。新しいセッションを始めます。プッシュした先が作業用のブランチなら、既定のブランチにマージしてから始めるか、そのブランチで始めます |
| 「git の作業コピーの根ではありません」「git の作業コピーではありません」と出る | 表示された根に `cd` するか、`node /tmp/ja-proofread-setup.mjs <リポジトリの根>` と根を指定する。何も書かずに止まっています |
| 「sha256 が合わない」と出る | ダウンロードしたファイルが壊れています。何も書かずに止まっているので、curl で取り直す。版を固定したときに `sha256sum -c` が `FAILED` を出したなら、SHA と sha256 の組み合わせ（同じ版のものか）を確かめる |
| スキルが一覧に出ない | `.claude/skills/ja-proofread-*` をコミットしたか。プッシュ前のブランチでセッションを始めていないか。リポジトリを複数選んだセッションでは、起動のときには一覧に出ず、そのリポジトリのファイルを Claude に読ませるか編集させたあとで出ると読めます（未確認）。Projects のクラウドのスレッドでは、2026年10月1日より前に始めたスレッドや、名前がドットで始まるリポジトリを含むスレッドなどでは出ないので、新しいスレッドを始めるか、B4 のように自分のコンピューターで動かします。セルフホスト（self-hosted）の環境では、リポジトリのスキル・サブエージェント・コマンドを読まないことがあるので、ランナーのイメージに入れます |
| 書いた直後の校正が動かない | リポジトリを1つだけ選んで始めたか。`.ja-proofread.json` がリポジトリの直下にあるか。Projects のクラウドのスレッドではフックが動かないので、スキルで校正します |
| 「textlint の依存がまだ入っていません」と出る | 環境のネットワークが Limited で「Allow package managers」に印が付いているか（印を外したなら Allowed domains に registry.npmjs.org があるか、Full か）。セルフホストの環境なら、ランナーから registry.npmjs.org に届くか。`node .claude/ja-proofread/scripts/ensure-deps.mjs` を実行して npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 指摘が二重に出る | 手元で同じリポジトリを開いたときは、同梱した版が優先され、プラグイン側のフックは黙ります。それでも二重なら `.claude/settings.json` のフックが重複していないか見る |
