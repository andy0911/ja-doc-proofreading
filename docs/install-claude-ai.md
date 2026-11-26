# claude.ai のチャットのプロジェクトで使う（claude.ai の Projects）

claude.ai のチャットのプロジェクト（claude.ai の Projects。プロジェクトの指示・ファイル・スキルを入れて、チャットで使うもの）で ja-proofread を使う手順です。チャットでは Claude Code もプラグインも動きません。そこで、校正の一式と手順の本文を1つのスキル（`ja-proofread`）の zip にまとめ、Customize > Skills で上げます。そのうえで、日本語の文書を書いたら毎回そのスキルで校正するよう、プロジェクトの指示で頼みます。

claude.ai/code の Projects（Claude Code の Projects。スレッドがあり、`/mnt/project-files` を使うもの）は別のもので、手順は [install-projects.md](install-projects.md) です。

| 使うもの | 場所 |
|---|---|
| スキルの zip | [dist/claude-ai/ja-proofread-skill.zip](https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/claude-ai/ja-proofread-skill.zip)（このリンクで落とせます） |
| プロジェクトの指示に足す文 | [dist/claude-ai/PROJECT-INSTRUCTIONS.md](../dist/claude-ai/PROJECT-INSTRUCTIONS.md) |

zip の sha256 は、`CHANGELOG.md` のその版の項に書いてあります。

## 1. コード実行を使えるようにする

スキルのスクリプトは、コード実行のサンドボックスで動きます。スキルのフォルダは丸ごとサンドボックスに写されます。

- Free・Pro・Max・Ultra：Settings > Capabilities で「Code execution and file creation」をオンにします（新しい Settings の画面では「Create and edit files」という名前です）。
- Team・Enterprise：組織のオーナーが、Organization settings > Plugins & skills の Policy タブで「Cloud code execution and file creation」と「Skills」をオンにします。

（[Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude)）

ネットワーク：textlint の依存は、会話の中で registry.npmjs.org から入れます（`npm ci`。数十秒）。Free・Pro・Max は、既定で外に出られます。Team・Enterprise の既定は、パッケージマネージャーの宛先だけに出られる設定で、registry.npmjs.org には届く見込みです。届かないときは、構成の型と件数で数える型だけが動き、textlint は動かなかったと伝えます。

## 2. zip を取る

どちらかで取ります。zip は展開せず、そのまま上げます。

- 上の表のリンク（`https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/claude-ai/ja-proofread-skill.zip`）を開いて保存する。
- リポジトリのページ（https://github.com/andy0911/ja-doc-proofreading）で `dist/claude-ai/ja-proofread-skill.zip` を開き、「Download raw file」（ダウンロードのボタン）を押す。

zip の中は、最上位の `ja-proofread/` フォルダだけです。その下に `SKILL.md`（スキルの入口）、`scripts/`・`rules/`・`data/`・`config/`・`templates/`（校正の一式）、`references/`（書く前・仕上げ・台帳を育てる手順をチャット向けに書き直したものと、役の指示）、`package.json`・`package-lock.json`、`skill.json`（印）があります。`node_modules` は入れていません（入れると約9,400ファイル・約21MBになるため）。

## 3. スキルを上げる

1. claude.ai で Customize > Skills を開きます。
2. 「+」を押し、「Create skill」を選びます。
3. 「Upload a skill」を選び、`ja-proofread-skill.zip` を上げます。
4. 一覧に `ja-proofread` が出て、スイッチがオンになっていることを確かめます。

スキルはプロジェクトごとでなく、アカウントに入ります。ほかの会話でも、日本語の文書を書くと Claude が使うことがあります。毎回確実に使わせたいプロジェクトでは、次の 4. でプロジェクトの指示に足します。

## 4. プロジェクトの指示に足す

`PROJECT-INSTRUCTIONS.md` の「----- 貼る部分ここから（この行は貼らない） -----」と「----- 貼る部分ここまで（この行は貼らない） -----」の2行の間（その2行は除く）を、プロジェクトの指示（Instructions）に足します。約650字です。

貼る部分には、次のことが書いてあります。

- アーティファクト、作ったファイル、文書として渡す長めの返答を日本語で書いたら、毎回、渡す前に ja-proofread スキルで校正する（文書をファイルに保存し、`ensure-deps.mjs` と `proofread.mjs` を実行し、誤検知と判断したもの以外の「必ず」を直す）。渡すときに件数を1行で書く
- スキルが見つからない、コード実行が使えないときは、校正したことにせず、できなかったと伝える
- 仕上げ（構成の型の点検と読者役）は、頼まれたときだけ、同じ会話の中で行う
- Notion の候補一覧に登録するのは、本人が頼んだときだけ

貼る部分は「（ja-proofread の指示はここまで）」の行で終わります。新しい版にするときとやめるときは、この行までを消します。

## 5. 試す

プロジェクトで新しい会話を始め、次のように頼みます。

> 次の文を、お客さま向けのお知らせ（300字くらい）に書き直して：「来月はおトクなポイント還元キャンペーンを実施します。ユーザの皆様は是非ご利用下さい。」

うまく動いていれば、Claude が `node -v` と `ensure-deps.mjs`・`proofread.mjs` を実行し、「おトク」→「お得」、「ユーザ」→「ユーザー」のような「必ず」の指摘を直してから、「校正：必ず 2 → 0、直したい …」のような1行を添えて渡します。件数の行がないときは、「ja-proofread で校正して」と頼みます。

「『おトク』と書いて」のように、指摘される書き方を本人が指定すると、Claude はそれを誤検知と判断して直さず、そう書き添えて渡します（このリポジトリで `claude -p` で試したときもそうなりました）。試すときは、書き方を指定しないで頼みます。

## 新しい版にする

台帳が育ったときなど、新しい版が出たら、2. の zip をもう一度取り、Customize > Skills で上げ直します（同じ名前のスキルがあって上げられないときは、下の「やめる」の手順で前の版を消してから上げます）。そのあと、プロジェクトの指示の ja-proofread の部分を「（ja-proofread の指示はここまで）」の行まで消し、新しい版の `PROJECT-INSTRUCTIONS.md` の貼る部分を足します。版の変わったところは `CHANGELOG.md` にあります。

## やめる

1. Customize > Skills で `ja-proofread` を開き、右上のスイッチでオフにします。
2. スイッチの横の「…」から「Delete」を選び、確かめて消します。オフにするだけなら、2. は要りません。
3. プロジェクトの指示に足した部分を「（ja-proofread の指示はここまで）」の行まで消します。

## できないこと・確かめていないこと

- 書いた直後の自動のフックはありません。プロジェクトの指示で毎回校正するよう頼んでいるだけなので、Claude が飛ばすことがあります。
- 検出と誤検知の記録は、サンドボックスの中（`~/.cache/ja-proofread`）に残すだけです。コンテナは会話をまたいで残らない前提なので、記録も残りません。依存も会話ごとに入れ直します。
- チャットではサブエージェントを使えないので、仕上げの独立レビューと読者役は、書いた本人と同じ会話の中で役を変えて行います。独立性は低くなります。独立性を上げたいときは、対象の文書と、スキルの `references/agents/` の役の指示を、別の会話に貼って読ませます。
- 台帳を育てる最後の段階（承認された候補を反映して版を上げる `ledger.mjs apply`）は、このリポジトリの作業コピー（Claude Code）で行います。チャットではできません。
- スマートフォンのアプリから zip を上げられるかは確かめていません。たぶんできないので、パソコンのブラウザーで上げます。
- サンドボックスに Node と npm があるか、スキルのフォルダとプロジェクトのファイルがサンドボックスのどこに置かれるかは、claude.ai の実際のチャットでは確かめていません。このリポジトリでは、zip を展開して読み取り専用にしたフォルダから、空の HOME で `ensure-deps.mjs` と `proofread.mjs` が動いて指摘が返ること、zip を Claude Code のスキルとして読み込ませ、貼る部分を渡した `claude -p`（Sonnet）が、お知らせを書いたあとに ja-proofread スキルを使い、書く前に references/write.md を読み、proofread を実行して指摘を受け取り、件数を添えて渡すことを確かめました（そのときは「おトク」を使うよう頼んだので、その指摘は誤検知として残しました）。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| zip を上げると断られる | zip を展開したり作り直したりしていないか（最上位が `ja-proofread/` のフォルダでないと読まれません）。取り直してそのまま上げます |
| Claude が「スキルが見つからない」と言う | Customize > Skills で `ja-proofread` のスイッチがオンか。Team・Enterprise では、組織の設定で Skills がオンか |
| 「コード実行が使えない」と言う | 1. の設定がオンか |
| 「textlint が動かなかった」と出る | registry.npmjs.org に出られないか、npm がない。構成の型だけを点検した結果です。組織の設定でネットワークを絞っていないか確かめます |
| 校正の件数の行がない | 飛ばされています。「ja-proofread で校正して」と頼みます |
