# Claude Code の Projects で使う（claude.ai/code の Projects）

claude.ai/code の Projects（会話と、そこから始まるスレッドがあるもの）で ja-proofread を使う手順です。プロジェクトにリポジトリがなくても使えます。

claude.ai のチャットのプロジェクト（claude.ai の Projects。プロジェクトの指示・ファイル・スキルを入れて、チャットで使うもの）は別のもので、この手順は使えません。そちらは [install-claude-ai.md](install-claude-ai.md) です。

Projects のクラウドのスレッドは、プロジェクト指示、プロジェクトのメモリー、`/mnt/project-files` にあるファイル（Context タブで足したもの、スレッドが作ったもの）、プロジェクトに足したリポジトリを持って始まります。リポジトリの `.claude/settings.json` のフックは動きません（[What threads pick up from your repositories](https://code.claude.com/docs/en/claude-projects#what-threads-pick-up-from-your-repositories)）。そこでこの手順では、校正の一式と手順の本文（kit）を `/mnt/project-files` に置き、書いたら校正するよう、プロジェクト指示でスレッドに頼みます。

claude.ai/customize/plugins でアカウントにプラグインを足す方法は、公式の説明ではクラウドのスレッドにも読み込まれるとされていますが、持ち主の環境ではその画面でこのマーケットプレイスの追加ができなかったので、この手順では使いません。

## 1. kit を書く

プロジェクトのどれかのスレッドで、次の1行を実行するよう頼みます（「次の1行を実行して」と頼めば足ります）。スレッドがまだ無ければ、プロジェクトの会話で、この1行を実行するスレッドを始めるよう頼みます。auto mode のスレッドで curl と node の実行に許可を求められたら、そのスレッドで許可します。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs --project-kit /mnt/project-files/ja-proofread-kit
```

`main` を取るこの1行は、その時点の `main` の版を信じて使うことになります。版を決めて使いたいときは、下の「版を固定する」の1行を使います。

`/mnt/project-files/ja-proofread-kit` に次のものが書かれます。git の作業コピーでなくてかまいません。隠しファイルと `node_modules` は書きません。

| 場所 | 中身 |
|---|---|
| `scripts/`、`rules/`、`data/`、`config/`、`templates/`、`package.json`、`package-lock.json` | 校正の一式（textlint の設定、台帳、辞書、スクリプト） |
| `skills/write/SKILL.md`、`skills/proofread/SKILL.md`、`skills/grow-ledger/SKILL.md` | 書く前・仕上げ・台帳を育てる手順の本文。スクリプトのパスとスキルの名前は、kit の中のファイルの場所に置き換えてある |
| `agents/structure-reviewer.md`、`agents/fresh-eyes-reader.md` | 独立レビューの役と読者役の指示。スレッドが Agent ツールでサブエージェントを起動するときに渡す |
| `kit.sha256` | kit の中のファイルの sha256 の一覧（下の「照らし合わせ」） |
| `PROJECT-INSTRUCTIONS.md` | プロジェクト指示に足す文 |
| `kit.json` | 版と、kit が書いたファイルの一覧（sha256 つき。入れ替えと `--remove` で、変わっていないものだけを消すため） |

書けるのは、まだないか空のディレクトリ、または前に kit を書いたディレクトリで、名前に `kit` という語を区切って含むとき（`ja-proofread-kit`・`kit`・`my-kit` など）だけです。`/mnt/project-files` そのもの、`/`、HOME、名前に `kit` という語のないディレクトリ（`toolkit` など）、`"`・`$`・`` ` ``・`\` を含むパスは断ります。

検出と誤検知の記録は、kit の隣の `/mnt/project-files/ja-proofread-data/` に残ります（スレッドをまたいで残る）。kit に `kit.json` があると、スクリプトが kit の隣を記録の置き場にします。textlint の依存は、スレッドの中の `~/.cache/ja-proofread/deps` に入り、スレッドごとに入れ直します（数十秒）。環境変数 `JA_PROOFREAD_DATA` は付けません（付けると、記録も依存もその下に変わります）。

### 版を固定する

`main` の代わりに、使う版のコミットの SHA を入れ、ファイルの sha256 を確かめてから動かします。SHA と sha256 の探し方は [install-cloud.md](install-cloud.md) の「版を固定する」と同じです（CHANGELOG のその版の項に sha256 があります）。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/<コミットのSHA>/dist/ja-proofread-setup.mjs && echo "<CHANGELOG に書いた sha256>  /tmp/ja-proofread-setup.mjs" | sha256sum -c - && node /tmp/ja-proofread-setup.mjs --project-kit /mnt/project-files/ja-proofread-kit
```

`--project-kit` を知っているのは、0.1.10 以降の版の SHA です（それより前の版では使えません）。下の照らし合わせ（`kit.sha256`）と、本人のファイルを消さない入れ替え・`--remove` は 0.1.11 からです。固定するなら 0.1.11 以降の版を使います。

### 手元で作って Context にアップロードする（別の手）

スレッドで curl を使えないとき（ネットワークが None など）は、手元で kit を作り、Context タブの Add context でフォルダーごと足します。手順と指示の中のパスを、使う場所で書くために `--as` を付けます（書く場所と `--as` の名前が違うと、注意を出します）。

```bash
d="$(mktemp -d)" && curl -fsSLo "$d/ja-proofread-setup.mjs" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node "$d/ja-proofread-setup.mjs" --project-kit "$d/ja-proofread-kit" --as /mnt/project-files/ja-proofread-kit && echo "$d/ja-proofread-kit"
```

最後に表示されたフォルダーをアップロードします。アップロードしたフォルダーが `/mnt/project-files/ja-proofread-kit` に置かれるかは確かめていません。スレッドで `ls /mnt/project-files` を実行して確かめ、違う場所なら、`--as` をその場所にして作り直します。

## 2. プロジェクト指示に足す

プロジェクトの会話で、次のように頼みます。

> /mnt/project-files/ja-proofread-kit/PROJECT-INSTRUCTIONS.md の貼る部分を、一字も変えずにプロジェクト指示に足して

貼る部分は、kit を `/mnt/project-files/ja-proofread-kit` に書いたとき約2,100字です（kit の場所が長いほど増えます）。プロジェクト指示は最大16,000字なので、ほかの指示と一緒に置けます。

手で貼るとき（別の手）は、`PROJECT-INSTRUCTIONS.md` の「----- 貼る部分ここから（この行は貼らない） -----」と「----- 貼る部分ここまで（この行は貼らない） -----」の2行の間を、Project settings > Memory > Project instructions に足します。1. の最後にも、同じものが同じ区切りの行で表示されます。

貼る部分は「（ja-proofread の指示はここまで）」の行で終わります。新しい版にするときとやめるときは、この行までを消します。

貼る部分には、次のことが書いてあります。

- 日本語の文書（`.md`・`.txt`）を書いた・直したら、毎回、kit を照らし合わせてから `ensure-deps.mjs` と `proofread.mjs` を実行し、誤検知と判断したもの以外の「必ず」が0件になってから渡す（フックの代わり）
- kit が見つからないとき（自分のコンピューターで動くスレッドなど）や、照らし合わせが合わないときは、校正せず本人に伝える
- 書く前は `skills/write` の手順に従う。書き終えたら上の毎回の校正だけを行い、仕上げは頼まれたときだけ
- 仕上げは `skills/proofread` の手順に従い、独立レビューと読者役テストは、Agent ツールで読むだけの種類（Explore など）のサブエージェントを起動して、`agents/` の本文を役の指示として渡す（使えなければ汎用の種類で、書き換えないよう頼む）
- 新しい型の候補と誤検知は `skills/grow-ledger` の手順に従う。Notion の候補一覧（Notion のコネクタ）に登録するのは、本人が頼んだときだけ（`.ja-proofread.json` の `notion.autoRegisterCandidates` は kit では使わない）

### 照らし合わせ（kit が書き換えられていないか）

`/mnt/project-files` は、プロジェクトのどのスレッドからも書き換えられます。kit のスクリプトが書き換えられると、後のスレッドがそれを実行します。そこで kit には、中のファイルの sha256 の一覧（`kit.sha256`）を置き、その一覧の sha256 を貼る部分に入れています。スレッドは毎回、次のように照らし合わせてから動かします（`<kit>` は kit の場所、`<値>` は貼る部分に書いた値）。

```bash
(cd "<kit>" && echo "<値>  kit.sha256" | sha256sum -c --quiet - && sha256sum -c --quiet kit.sha256) && node "<kit>/scripts/ensure-deps.mjs" && node "<kit>/scripts/proofread.mjs" <ファイル>
```

合わなければ校正せず、本人に伝えます。この1行は `cd`・`echo`・`sha256sum` をつないだ形なので、スレッドの権限の設定によっては、実行に許可を求められます（`claude -p` で試したときは、許可が要るとして止まり、スレッドが2つの照らし合わせを分けて実行してから校正しました）。許可を求められたら、そのスレッドで許可します。照らし合わせに入るのは kit の中身だけで、記録の置き場（`ja-proofread-data`）は入りません。貼る部分の値は kit とは別のプロジェクト指示にあるので、kit と一覧を一緒に書き換えても見つかります。ただし、公式の説明では、プロジェクトの会話で Claude に頼めばプロジェクト指示も変えられます。スレッドからプロジェクト指示を変えられるかは確かめていません。

`sha256sum -c` は、一覧にあるファイルが変わっていないかを確かめるだけで、あとから足したファイルは見つけません。そこで、kit として動くスクリプトは、kit の中に足されたものを使わないようにしています。

- kit かどうかは、照らし合わせに入る `kit.sha256`（か `kit.json`）があるかで決めます。`kit.json` は照らし合わせに入らないので、消されても kit として動きます。`kit.sha256` を消すと、照らし合わせが通りません。
- kit として動くときは、kit の中の `node_modules` を使いません。依存は kit の外（`~/.cache/ja-proofread/deps`）に、スレッドごとに lock ファイルの版で入れ直します。
- 記録の置き場は、`kit.json` の値に頼らず、kit の隣の `ja-proofread-data` に決まっています。
- 作業しているディレクトリの `.ja-proofread.json` も照らし合わせに入りません。共有フォルダーの下に置かれると、規則を止めて指摘を減らせます。リポジトリでの正当な使い方があるので読むことは止めませんが、kit として動くときは、使うたびに「ja-proofread: 設定 <パス> を使いました（止めた規則 N 件：…）」の1行を出し、スレッドがそれを本人に伝えます。
- 正規表現の検査の記録（追加の prh 辞書の規則が安全かを確かめた結果）は、共有の記録の置き場でなく、スレッドの中（`~/.cache/ja-proofread`）に置きます。共有の置き場はほかのスレッドが書き換えられ、安全の確認を飛ばせるためです。スレッドごとに確かめ直すので、追加の辞書があると、スレッドの最初の校正は少し遅くなります。

## 3. 新しいスレッドから使う

プロジェクト指示は新しく始めたスレッドに送られます（[Write project instructions](https://code.claude.com/docs/en/claude-projects#write-project-instructions)）。足す前から動いているスレッドには届かないので、新しいスレッドを始めます。そのあと、文書を書くよう頼めば、スレッドが書いたあとに校正を実行します。「この文書を校正して」と頼めば、proofread の手順で仕上げます。

作業しているディレクトリに `.ja-proofread.json` があれば、その設定（`include`・`exclude`・`profile`・追加の prh 辞書など）が使われます。そのときは「設定 … を使いました」の1行が出て、スレッドが本人に伝えます。JSON として読めないなど設定が壊れていると、校正が止まります（スレッドは本人に伝えます）。

確かめたこと：Projects のクラウドのスレッドの中で、raw.githubusercontent.com から取った一式で `/mnt/project-files` の下に kit を書き、照らし合わせが通ること、kit の中の1文字を変えると照らし合わせで止まること、空の HOME で `ensure-deps.mjs` と `proofread.mjs` が動いて指摘が返ること、`--remove` で本人のファイルが残ることを確かめました。また、貼る部分を `claude -p --append-system-prompt` で渡して文書を書かせ、スレッドが指示どおり照らし合わせて proofread を実行し、直すことを確かめました。プロジェクト指示に実際に足して新しいスレッドで試すことは、まだしていません。

## 新しい版にする

1. の1行をもう一度実行します。kit は新しい版に入れ替わります。0.1.11 以降で書いた kit から上げるときは、消すのは、前の版が書いたファイルのうち中身が変わっていないものだけです。kit に自分で置いたほかのファイルと、記録の置き場は残ります。kit が書いたあとに変わったファイルを新しい版で上書きするときは、元のファイルを `<名前>.mine-<日時>` という名前で残し、表示します。0.1.10 で書いた kit（書いたファイルの一覧がないもの）から上げるときは、kit の名前のファイルを、書き換えてあっても退避せずに上書きします。新しい版にないファイルは残ります。

そのあと、プロジェクト指示の ja-proofread の部分を「（ja-proofread の指示はここまで）」の行まで消し、新しい版の貼る部分を足します（2. と同じように会話で頼めます）。照らし合わせの値は版ごとに変わるので、貼り直さないと、次のスレッドからの校正が照らし合わせで止まります。

## やめる

1. の1行の最後に `--remove` を足して実行します。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs --project-kit /mnt/project-files/ja-proofread-kit --remove
```

消すのは、kit が書いたファイルのうち中身が変わっていないものだけです。本人が置いたファイルと、書いたあとに変わったファイルは残し、その名前を表示します。ファイルが残ったときは、同じ場所に kit を書き直せるよう、印の `kit.json` を置きます（要らなければディレクトリごと消します）。何も残らなければ、kit の場所ごと消します。記録の置き場（`/mnt/project-files/ja-proofread-data/`）は残し、あるかどうかを表示します。要らなければ消します。

プロジェクト指示に足した ja-proofread の部分も、「（ja-proofread の指示はここまで）」の行まで消します。消さないと、新しいスレッドが無い kit を使おうとします。

## できないこと

- 書いた直後の自動のフックはありません。プロジェクト指示で毎回実行するよう頼んでいるだけなので、Claude が守らないことがあります（実行を飛ばす、「必ず」を直さずに渡す、など）。渡されたときに校正の件数が書いていなければ、「proofread を実行して」と頼みます。
- 台帳を育てる最後の段階（承認された候補を台帳に反映して版を上げる `ledger.mjs apply`）は、このマーケットプレイスのリポジトリの作業コピーで行います。kit の中ではできません。
- 照らし合わせで防げるのは、kit の中のファイルの書き換えです。記録の置き場（`ja-proofread-data`）の中身（検出と誤検知の記録）は照らし合わせに入らず、書き換えられると台帳を育てるときの数（`ledger.mjs stats`）が変わります。正規表現の検査の記録は、kit ではスレッドの中に置くので、共有の置き場の書き換えでは安全の確認を飛ばせません。
- 環境のネットワークが None だと、1. の curl も、textlint の依存（registry.npmjs.org）も届きません。Limited で「Allow package managers」に印が付いた既定の状態なら、どちらも届きます（[Network access](https://code.claude.com/docs/en/cloud-environments#network-access)）。textlint が入らないときは、構成の型と件数で数える型だけが動きます。

## リポジトリを足している場合（別の手）

プロジェクトにリポジトリを足しているなら、[install-cloud.md](install-cloud.md) の方法Aで、そのリポジトリに同梱する手もあります。Projects のクラウドのスレッドでは、リポジトリの `.claude/skills/`・`.claude/agents/` は読まれるので、スキル（`/ja-proofread-proofread` など）とサブエージェントは使えます。ただし `.claude/settings.json` のフックは動かないので、書いた直後の校正と、起動のときの依存の準備はありません。依存は proofread の手順の準備（`ensure-deps.mjs`）で入ります。書いた直後の校正もスレッドにさせたいなら、この文書の kit とプロジェクト指示を一緒に使います。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| 1. の curl が 403 になる・つながらない | 環境のネットワークが None になっていないか。Limited なら、許可リストに raw.githubusercontent.com が入っているか（既定の許可リストには入っています） |
| 「kit（kit.json）でもないので、何も変えずに止めました」と出る | 指定したディレクトリが空でなく、kit でもありません。新しいディレクトリを指定するか、前に kit を書いたディレクトリを指定します |
| 「kit という語が入っていません」「使えません」と出る | 名前に `kit` という語を区切って含む、専用のディレクトリを指定します（例：`/mnt/project-files/ja-proofread-kit`） |
| スレッドが「照らし合わせが合わない」と言う | kit を入れ替えたあとに貼り直していないか（プロジェクト指示の値が前の版のまま）。貼り直しても合わなければ、kit が書き換えられています。1. の1行で書き直し、貼り直します |
| スレッドが校正を実行しない | 新しいスレッドで始めたか（足す前から動いているスレッドには届きません）。プロジェクト指示に貼る部分が入っているか。入っていても飛ばすことがあるので、「proofread を実行して」と頼みます |
| 「textlint の依存がまだ入っていません」「textlint が動かなかった」と出る | 環境のネットワークで registry.npmjs.org に届くか。入れるのに失敗すると、10分は試さずに知らせます。すぐに試すときは `node /mnt/project-files/ja-proofread-kit/scripts/ensure-deps.mjs --force` を実行して npm のエラーを見ます |
| 「.ja-proofread.json を JSON として読めません」などで止まる | 作業しているディレクトリの `.ja-proofread.json` を直すか、使わないならその場所から外します |
