# 手元の Claude Code に入れる

手元のターミナルで動く Claude Code（CLI、VS Code・JetBrains の拡張を含む）向けの手順です。クラウドセッション（Claude Code on the web）では、この方法ではプラグインが読み込まれません。クラウドは [install-cloud.md](install-cloud.md) を見てください。

## 必要なもの

| もの | 確かめ方 |
|---|---|
| Claude Code（`claude plugin` コマンドが使える版） | `claude --version` |
| Node.js 20 以上と npm | `node -v` |
| このリポジトリを読める git の認証 | 下の「1. 非公開リポジトリを読めるようにする」 |
| registry.npmjs.org に届くネットワーク | 初回に textlint を入れるため |

## 1. 非公開リポジトリを読めるようにする

このマーケットプレイスは非公開リポジトリです。Claude Code は自分ではトークンを持たず、手元の git の認証を使って取得します。`GITHUB_TOKEN` や `GH_TOKEN` を環境変数に入れるだけでは認証されません。

どちらか一方で設定します。

```bash
# A. GitHub CLI を使う（おすすめ）
gh auth login
gh auth setup-git

# B. SSH 鍵を使う
ssh -T git@github.com
```

B の SSH は、次の2つがそろっているときだけ使えます。Claude Code は git をパスフレーズや確認の入力なしで動かすため、どちらかが欠けると取得に失敗します。

- 鍵が ssh-agent に入っている（`ssh-add -l` に表示される）。パスフレーズつきの鍵は、先に `ssh-add` で入れておく
- `~/.ssh/known_hosts` に github.com がある（一度 `ssh -T git@github.com` を実行して、ホストの確認に答えておく）

（[Add a private marketplace](https://code.claude.com/docs/en/plugins/install.md#add-a-private-marketplace)）

`owner/repo` の形で追加すると、Claude Code は先に SSH を試し、通らなければ HTTPS で取得します。HTTPS に固定したいときは `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` を設定します。

## 2. マーケットプレイスを追加して、プラグインを入れる

```bash
claude plugin marketplace add andy0911/ja-doc-proofreading
claude plugin install ja-proofread@ja-doc-proofreading --scope user
```

Claude Code の中からなら、`/plugin marketplace add andy0911/ja-doc-proofreading` のあと `/plugin install ja-proofread@ja-doc-proofreading` でも同じです。

`--scope` の意味は次のとおりです。

| scope | 効く範囲 |
|---|---|
| `user` | 自分のすべてのプロジェクト |
| `project` | そのプロジェクトだけ。`.claude/settings.json` に書かれ、コミットすると仲間にも有効になる |
| `local` | そのプロジェクトの自分だけ（`.claude/settings.local.json`） |

## 3. 動くか確かめる

1. Claude Code を起動し直します。最初の起動で、textlint とルールが自動で入ります（数十秒）。入れる先はプラグインのデータ置き場 `~/.claude/plugins/data/ja-proofread-ja-doc-proofreading/` です。プラグインを更新しても残ります。検出の記録と誤検知の記録も同じ場所に入ります。
2. 入ったものを確かめます。

```bash
claude plugin details ja-proofread@ja-doc-proofreading
```

スキル3つ（write、proofread、grow-ledger）、サブエージェント2つ（fresh-eyes-reader、structure-reviewer）、フック2つ（SessionStart、PostToolUse）が並べば入っています。プラグインの部品はプラグイン名の接頭辞つきで呼ばれます。サブエージェントを名前で指定するときは `ja-proofread:structure-reviewer`、`ja-proofread:fresh-eyes-reader` と書きます。

3. Claude Code の中で `/ja-proofread:proofread 対象のファイル` と頼むと、校正の全工程が動きます。

## 4. 書いた直後の自動チェックを有効にする

自動チェック（ファイルを書いた直後の校正）は、プロジェクトの直下に `.ja-proofread.json` があるときだけ動きます。コードのリポジトリで README を直すたびに口を出さないためです。

```bash
cp ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/templates/ja-proofread.example.json .ja-proofread.json
```

プラグインの場所が違うときは、最小限の `{"profile": "doc"}` だけを書いたファイルでも動きます。

例の設定は `include` が `docs/**/*.md` と `slides/**/*.md` だけなので、`docs/` と `slides/` の下の Markdown しか自動チェックしません。ほかの場所の文書も見るときは、`include` にそのパスに合う glob を足します。パスは `.ja-proofread.json` のある場所からの相対パスで比べます（例：直下の `README.md` は `*.md` か `**/*.md` に合い、`docs/**/*.md` には合いません）。`include` を書かなければ、既定の `**/*.md` と `**/*.txt` を使います。

`.ja-proofread.json` が JSON として読めないとき（末尾のカンマやコメントがあるときなど）は、黙って既定値にはせず、フックは「設定を読めない」と Claude に知らせ、`proofread.mjs` は終了コード2で止まります。

主な設定は次のとおりです。

| 設定 | 意味 |
|---|---|
| `profile` | `doc`（文章）か `slide`（スライド。句点のない行を許す） |
| `profiles` | パスごとの種類。例：`{"slides/**": "slide"}` |
| `include` / `exclude` | 自動チェックする・しないファイル。`exclude` に書いたものは既定の除外（`**/node_modules/**`、`.claude/**`、`**/CLAUDE.md` など）に足され、既定は消えません |
| `disable` | 使わない型やルールのID。例：`["P010"]` |
| `prh` | チームの表記辞書を足す |
| `hook.blockOn` | Claude に直させる重さ。`must`（既定）、`should`、`info`、`never` |

フックが Claude に直させる（止める）のは、前回の結果になかった指摘だけです。ただし、そのファイルを初めて編集したときは前回の結果がないので、もとからある指摘も「新しい指摘」と数えます。初めて触る既存の文書では、以前からある `must` の指摘でも1回は止まります。2回目からは、同じ指摘が残っているだけなら止まりません。

## 5. スクリプトを手で動かすとき

スキルやフックから動かすときは、データ置き場を Claude Code が渡します。ターミナルから手でスクリプトを動かすときは、環境変数 `JA_PROOFREAD_DATA` で同じ場所を指定します。指定しないと `~/.cache/ja-proofread/` が使われ、依存を入れ直したうえ、検出の記録も別の場所に分かれます。

```bash
export JA_PROOFREAD_DATA=~/.claude/plugins/data/ja-proofread-ja-doc-proofreading
P=~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread
node "$P/scripts/ensure-deps.mjs"
node "$P/scripts/proofread.mjs" 対象のファイル.md
node "$P/scripts/ledger.mjs" stats
```

`CLAUDE_CODE_PLUGIN_CACHE_DIR` を設定しているときは、`~/.claude/plugins` をその場所に読み替えます。

## 6. 新しい版にする

Anthropic が運営するもの以外のマーケットプレイスは、自動更新が既定でオフです。このマーケットプレイスもオフです。台帳が育ってバージョンが上がったら、次を実行して Claude Code を起動し直します。起動中のセッションでは、`/reload-plugins` を実行しても新しい版に切り替わります。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

自動で更新したいときは、`/plugin` の Marketplaces タブで、このマーケットプレイスの自動更新をオンにします。自動更新は、対話セッションで最初のメッセージを送ったあと、最大10分ほど待ってから行われます。更新されても、動いているセッションは読み込んだ版のままなので、`Run /reload-plugins to apply` と出たら `/reload-plugins` を実行するか、次に起動したときに新しい版が使われます（[Plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md#when-auto-update-runs)）。起動時の自動更新は、入力を求めない認証しか使えません。HTTPS なら `gh auth setup-git` などの認証ヘルパー、SSH なら ssh-agent に鍵を入れ、github.com を `known_hosts` に入れておきます。`GITHUB_TOKEN` だけでは、起動時の自動更新は認証されません。

## 7. 仲間にも使ってもらう

プロジェクトの `.claude/settings.json` に次を書いてコミットします。仲間がそのフォルダを信頼すると、マーケットプレイスが登録され、プラグインも有効になります。提案が出るのではなく、自動で入ります。このプラグインはマーケットプレイスの中に置いてある（相対パスで指している）ためです。仲間はそれぞれ「1. 非公開リポジトリを読めるようにする」を先に済ませておく必要があります。

```json
{
  "extraKnownMarketplaces": {
    "ja-doc-proofreading": {
      "source": { "source": "github", "repo": "andy0911/ja-doc-proofreading" }
    }
  },
  "enabledPlugins": { "ja-proofread@ja-doc-proofreading": true }
}
```

自動で入らないとき（認証が通らなかったときなど）は、仲間が先に `claude plugin marketplace add andy0911/ja-doc-proofreading` を実行してから、Claude Code を起動し直します。

## 8. やめる

```bash
claude plugin uninstall ja-proofread@ja-doc-proofreading
claude plugin marketplace remove ja-doc-proofreading
```

`--scope project` で入れたときは、`claude plugin uninstall ja-proofread@ja-doc-proofreading --scope project` で外します。`local` で入れたときも同じように `--scope local` をつけます。

最後のスコープから外すと、データ置き場（依存、検出の記録、誤検知の記録）も消えます。残したいときは `--keep-data` をつけます。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| マーケットプレイスを追加できない | `gh auth status`、または `ssh -T git@github.com`。リポジトリを読む権限があるか |
| 「textlint の依存がまだ入っていません」と出る | 「5. スクリプトを手で動かすとき」のとおり `JA_PROOFREAD_DATA` を設定して `ensure-deps.mjs` を実行し、npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 書いても自動チェックが動かない | `.ja-proofread.json` がプロジェクトの直下にあるか、JSON として読めるか。そのファイルのパス（`.ja-proofread.json` のある場所からの相対パス）が `include` のどれかの glob に合い、`exclude` に合っていないか。例の設定の `include` は `docs/` と `slides/` の下だけです |
| 指摘が多すぎる | スライドなら `profile` を `slide` に。効かない型は `disable` に入れ、grow-ledger スキルで誤検知を記録する |
