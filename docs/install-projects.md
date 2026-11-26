# Claude Code の Projects で使う（claude.ai/code の Projects）

claude.ai/code の Projects（会話と、そこから始まるスレッドがあるもの）で ja-proofread を使う手順です。プロジェクトにリポジトリがなくても使えます。

Projects のクラウドのスレッドは、プロジェクト指示、プロジェクトのメモリー、`/mnt/project-files` にあるファイル（Context タブで足したもの、スレッドが作ったもの）、プロジェクトに足したリポジトリを持って始まります。リポジトリの `.claude/settings.json` のフックは動きません（[What threads pick up from your repositories](https://code.claude.com/docs/en/claude-projects#what-threads-pick-up-from-your-repositories)）。そこでこの手順では、校正の一式と手順の本文を `/mnt/project-files` に置き、書いたら校正するよう、プロジェクト指示でスレッドに頼みます。

claude.ai/customize/plugins でアカウントにプラグインを足す方法は、公式の説明ではクラウドのスレッドにも読み込まれるとされていますが、持ち主の環境ではその画面でこのマーケットプレイスの追加ができなかったので、この手順では使いません。

## 1. kit を書く

プロジェクトのどれかのスレッドで、次の1行を実行するよう頼みます（「次の1行を実行して」と頼めば足ります）。スレッドがまだ無ければ、プロジェクトの会話で、この1行を実行するスレッドを始めるよう頼みます。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs --project-kit /mnt/project-files/ja-proofread-kit
```

`/mnt/project-files/ja-proofread-kit` に次のものが書かれます。git の作業コピーでなくてかまいません。隠しファイルと `node_modules` は書きません。

| 場所 | 中身 |
|---|---|
| `scripts/`、`rules/`、`data/`、`config/`、`templates/`、`package.json`、`package-lock.json` | 校正の一式（textlint の設定、台帳、辞書、スクリプト） |
| `skills/write/SKILL.md`、`skills/proofread/SKILL.md`、`skills/grow-ledger/SKILL.md` | 書く前・仕上げ・台帳を育てる手順の本文。スクリプトのパスは kit の場所に置き換えてある |
| `agents/structure-reviewer.md`、`agents/fresh-eyes-reader.md` | 独立レビューの役と読者役の指示。スレッドが Agent ツールでサブエージェントを起動するときに渡す |
| `PROJECT-INSTRUCTIONS.md` | プロジェクト指示に貼る文 |
| `kit.json` | 版と記録の置き場 |

検出と誤検知の記録は、kit の隣の `/mnt/project-files/ja-proofread-data/` に残ります（スレッドをまたいで残る）。textlint の依存は、スレッドの中の `~/.cache/ja-proofread/deps` に入り、スレッドごとに入れ直します（数十秒）。どちらも `kit.json` で決めてあるので、環境変数は要りません。

版を固定したいとき、ダウンロードの中身を確かめたいときは、[install-cloud.md](install-cloud.md) の「版を固定する」と同じです（最後の `node /tmp/ja-proofread-setup.mjs` に `--project-kit /mnt/project-files/ja-proofread-kit` を足します）。

### 手元で作って Context にアップロードする（別の手）

スレッドで curl を使えないとき（ネットワークが None など）は、手元で kit を作り、Context タブの Add context でフォルダーごと足します。手順と指示の中のパスを、使う場所で書くために `--as` を付けます。

```bash
f="$(mktemp -d)/ja-proofread-setup.mjs" && curl -fsSLo "$f" https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node "$f" --project-kit ./ja-proofread-kit --as /mnt/project-files/ja-proofread-kit
```

できた `ja-proofread-kit` フォルダーをアップロードします。アップロードしたフォルダーが `/mnt/project-files/ja-proofread-kit` に置かれるかは確かめていません。スレッドで `ls /mnt/project-files` を実行して確かめ、違う場所なら、`--as` をその場所にして作り直します。

## 2. プロジェクト指示に貼る

1. の最後に「貼る部分」が表示されます（`/mnt/project-files/ja-proofread-kit/PROJECT-INSTRUCTIONS.md` の、「貼る部分ここから」と「貼る部分ここまで」の間と同じです。約2,100字）。これを Project settings > Memory > Project instructions に貼ります。プロジェクト指示は最大16,000字なので、ほかの指示と一緒に置けます。プロジェクトの会話で「`/mnt/project-files/ja-proofread-kit/PROJECT-INSTRUCTIONS.md` の貼る部分をプロジェクト指示に足して」と頼んでもかまいません。

貼る部分には、次のことが書いてあります。

- 日本語の文書（`.md`・`.txt`）を書いた・直したら、毎回 `ensure-deps.mjs` と `proofread.mjs` を実行し、「必ず」の指摘を直してから渡す（フックの代わり）
- 書く前は `skills/write` の手順に従う
- 仕上げは `skills/proofread` の手順に従い、独立レビューと読者役テストは Agent ツールでサブエージェントを起動して、`agents/` の本文を役の指示として渡す
- 新しい型の候補と誤検知は `skills/grow-ledger` の手順に従う。Notion の候補一覧（Notion のコネクタ）に登録するのは、本人が頼んだときだけ

## 3. 新しいスレッドから使う

プロジェクト指示は新しく始めたスレッドに送られます（[Write project instructions](https://code.claude.com/docs/en/claude-projects#write-project-instructions)）。貼る前から動いているスレッドには届かないので、新しいスレッドを始めます。そのあと、文書を書くよう頼めば、スレッドが書いたあとに校正を実行します。「この文書を校正して」と頼めば、proofread の手順で仕上げます。

確かめたこと：Projects のクラウドのスレッドの中で、raw.githubusercontent.com から取った一式で `/mnt/project-files` の下に kit を書き、空の HOME で `ensure-deps.mjs` と `proofread.mjs` が動いて指摘が返ることを確かめました。また、貼る部分を `claude -p --append-system-prompt` で渡して文書を書かせ、スレッドが指示どおり proofread を実行して直すことを確かめました。プロジェクト指示に実際に貼って新しいスレッドで試すことは、まだしていません。

## 新しい版にする

1. の1行をもう一度実行します。kit は新しい版に入れ替わります（kit に自分で置いたほかのファイルと、記録の置き場は残ります）。貼る部分の文も版ごとに変わることがあるので、表示された貼る部分でプロジェクト指示を貼り直します。

## やめる

1. の1行の最後に `--remove` を足して実行します。

```bash
curl -fsSLo /tmp/ja-proofread-setup.mjs https://raw.githubusercontent.com/andy0911/ja-doc-proofreading/main/dist/ja-proofread-setup.mjs && node /tmp/ja-proofread-setup.mjs --project-kit /mnt/project-files/ja-proofread-kit --remove
```

kit が書いたものだけが消えます。記録の置き場（`/mnt/project-files/ja-proofread-data/`）は残すので、要らなければ消します。プロジェクト指示に貼った ja-proofread の部分も消します。消さないと、新しいスレッドが無い kit を使おうとします。

## できないこと

- 書いた直後の自動のフックはありません。プロジェクト指示で毎回実行するよう頼んでいるだけなので、Claude が守らないことがあります（実行を飛ばす、「必ず」を直さずに渡す、など）。渡されたときに校正の件数が書いていなければ、「proofread を実行して」と頼みます。
- プロジェクトの `.ja-proofread.json`（`include`・`exclude`・追加の prh 辞書など）は使いません。既定の設定で校正します。
- 台帳を育てる最後の段階（承認された候補を台帳に反映して版を上げる `ledger.mjs apply`）は、このマーケットプレイスのリポジトリの作業コピーで行います。kit の中ではできません。
- 環境のネットワークが None だと、1. の curl も、textlint の依存（registry.npmjs.org）も届きません。Limited で「Allow package managers」に印が付いた既定の状態なら、どちらも届きます（[Network access](https://code.claude.com/docs/en/cloud-environments#network-access)）。textlint が入らないときは、構成の型と件数で数える型だけが動きます。

## リポジトリを足している場合（別の手）

プロジェクトにリポジトリを足しているなら、[install-cloud.md](install-cloud.md) の方法Aで、そのリポジトリに同梱する手もあります。Projects のクラウドのスレッドでは、リポジトリの `.claude/skills/`・`.claude/agents/` は読まれるので、スキル（`/ja-proofread-proofread` など）とサブエージェントは使えます。ただし `.claude/settings.json` のフックは動かないので、書いた直後の校正と、起動のときの依存の準備はありません。依存は proofread の手順の準備（`ensure-deps.mjs`）で入ります。書いた直後の校正もスレッドにさせたいなら、この文書の kit とプロジェクト指示を一緒に使います。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| 1. の curl が 403 になる・つながらない | 環境のネットワークが None になっていないか。Limited なら、許可リストに raw.githubusercontent.com が入っているか（既定の許可リストには入っています） |
| 「kit（kit.json）でもないので、何も変えずに止めました」と出る | 指定したディレクトリが空でなく、kit でもありません。新しいディレクトリを指定するか、前に kit を書いたディレクトリを指定します |
| スレッドが校正を実行しない | 新しいスレッドで始めたか（貼る前から動いているスレッドには届きません）。プロジェクト指示に貼る部分が入っているか。入っていても飛ばすことがあるので、「proofread を実行して」と頼みます |
| 「textlint の依存がまだ入っていません」「textlint が動かなかった」と出る | 環境のネットワークで registry.npmjs.org に届くか。`node /mnt/project-files/ja-proofread-kit/scripts/ensure-deps.mjs` を実行して npm のエラーを見ます |
