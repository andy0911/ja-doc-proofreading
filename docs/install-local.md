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

Claude Code は git を、パスフレーズや確認の入力を求めない設定で動かします。そのため、どちらの方法も「入力なしで通る」状態にしておきます。

- A の HTTPS：認証ヘルパーに資格情報が保存されていること。保存されていれば使われ、入力を求めるヘルパーは失敗します。`gh auth login` のあと `gh auth setup-git` で保存されます
- B の SSH：パスフレーズを聞かれずに使える鍵であること（パスフレーズつきの鍵なら、先に `ssh-add` で ssh-agent に入れておき、`ssh-add -l` に表示されるのを確かめる）。あわせて、`~/.ssh/known_hosts` に github.com があること（一度 `ssh -T git@github.com` を実行して、ホストの確認に答えておく）

`andy0911/ja-doc-proofreading` のような `owner/repo` の形で追加すると、Claude Code は先に `ssh -T git@github.com` で SSH を試し、通れば SSH で取得します。その確認か SSH での取得そのものが失敗すると、HTTPS に切り替えて取得します。そのため、SSH の鍵が使えなくても、A の設定があれば取得できます。SSH を試さず最初から HTTPS にしたいときは `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` を設定します（[Grant access to a private marketplace](https://code.claude.com/docs/en/plugins/host-marketplace#grant-access-to-a-private-marketplace)、[Add a private marketplace](https://code.claude.com/docs/en/plugins/install.md#add-a-private-marketplace)）。

## 2. マーケットプレイスを追加して、プラグインを入れる

```bash
claude plugin marketplace add andy0911/ja-doc-proofreading
claude plugin install ja-proofread@ja-doc-proofreading --scope user
```

Claude Code の中からなら、`/plugin marketplace add andy0911/ja-doc-proofreading` のあと `/plugin install ja-proofread@ja-doc-proofreading` でも入れられます。ただし、セッションの中の `/plugin install` はすぐには入れず、そのプラグインの詳細の画面を開きます。そこでスコープを選んで入れます（[Install a plugin](https://code.claude.com/docs/en/plugins/install#install-a-plugin)）。

`--scope` の意味は次のとおりです。

| scope | 効く範囲 |
|---|---|
| `user` | 自分のすべてのプロジェクト |
| `project` | そのプロジェクトだけ。`.claude/settings.json` に書かれ、コミットすると仲間にも有効になる。ただし仲間の端末には入らない（7. を参照） |
| `local` | そのプロジェクトの自分だけ（`.claude/settings.local.json`） |

## 3. 動くか確かめる

1. Claude Code を起動し直します。textlint とルール（依存）は、次のどちらかで自動で入ります。
   - Claude Code が入れられれば、プラグインをキャッシュ（`~/.claude/plugins/cache/ja-doc-proofreading/ja-proofread/<版>/`）にコピーするときに、そこの `node_modules` に入ります。公式の説明では、プラグインの直下に `package.json` とロックファイル（`package-lock.json` など）があると、インストールや更新でキャッシュに写すたびに依存を入れます。入れるのはロックファイルのとおりの版だけで、インストールスクリプトは動かさず、60秒で打ち切ります（[Node.js package dependencies](https://code.claude.com/docs/en/plugins/loading#node-js-package-dependencies)）。このプラグインは `package.json` と `package-lock.json` を置いています。
   - それができなかったとき（入れ終わらなかった、npm が見つからない、など）は、最初の起動で SessionStart のフックがプラグインのデータ置き場 `~/.claude/plugins/data/ja-proofread-ja-doc-proofreading/deps/` に入れます（数十秒）。データ置き場はプラグインを更新しても残ります。

   どちらで入ったかは、実機では確かめていません。キャッシュに入っていれば、フックは入れ直しません。検出の記録と誤検知の記録は、どちらの場合もデータ置き場に入ります。
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

`.ja-proofread.json` が JSON として読めないとき（末尾のカンマやコメントがあるときなど）や、値の型が違うとき（`"include": "**/*.md"` のように配列にすべきところが文字列、`hook.blockOn` が `must`・`should`・`info`・`never` 以外、`hook.enabled` が真偽値でない、など）は、黙って既定値にはせず、フックは「設定を読めない」と Claude に知らせ、`proofread.mjs` は終了コード2で止まります。

主な設定は次のとおりです。

| 設定 | 意味 |
|---|---|
| `profile` | `doc`（文章）か `slide`（スライド。句点のない行を許す） |
| `profiles` | パスごとの種類。例：`{"slides/**": "slide"}` |
| `include` / `exclude` | 自動チェックする・しないファイル。`exclude` に書いたものは既定の除外（`**/node_modules/**`、`.claude/**`、`**/CLAUDE.md` など）に足され、既定は消えません |
| `disable` | 使わない型やルールのID。例：`["P010"]` |
| `prh` | チームの表記辞書を足す（文字列の配列）。辞書は prh 本体で読み、`imports` 先も含めて規則ごとに正規表現を検査します。長い文で止まるおそれのある規則はその規則だけを外し、外したことを表示します。検査の結果はデータ置き場に記録し、変わった規則だけを測り直します |
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

自分で足したマーケットプレイスは、自動更新が既定でオフです（このマーケットプレイスも）。既定でオンなのは、Anthropic の公式のマーケットプレイス（`claude-plugins-official` など）と、claude.ai から足したマーケットプレイスです（[Which marketplaces and plugins auto-update](https://code.claude.com/docs/en/plugins/loading#which-marketplaces-and-plugins-auto-update)）。台帳が育ってバージョンが上がったら、次を実行して Claude Code を起動し直します。起動中のセッションでは、`/reload-plugins` を実行しても新しい版に切り替わります。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

自動で更新したいときは、`/plugin` の Marketplaces タブで、このマーケットプレイスの自動更新をオンにします。自動更新は、対話セッションで最初のメッセージを送ったあと、最大10分ほど待ってから行われます。更新されても、動いているセッションは読み込んだ版のままなので、`Run /reload-plugins to apply` と出たら `/reload-plugins` を実行するか、次に起動したときに新しい版が使われます（[Plugin loading reference](https://code.claude.com/docs/en/plugins/loading.md#when-auto-update-runs)）。自動更新（裏で動く更新）は、入力を求めない認証しか使えません。HTTPS なら `gh auth setup-git` などで資格情報を保存した認証ヘルパー、SSH なら ssh-agent に鍵を入れ、github.com を `known_hosts` に入れておきます。`GITHUB_TOKEN` だけでは、自動更新は認証されません。認証が通らないときは、更新は黙って失敗し、前の版のまま動きます（[What background auto-update does with credentials](https://code.claude.com/docs/en/plugins/host-marketplace#what-background-auto-update-does-with-credentials)）。

環境変数 `DISABLE_UPDATES=1`、`DISABLE_AUTOUPDATER=1`、`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` のどれかを設定していると、プラグインの自動更新はまるごと止まり、`/plugin` の自動更新のスイッチも出ません。これらを設定したままプラグインだけ自動で更新したいときは、`FORCE_AUTOUPDATE_PLUGINS=1` も設定します。これらの変数はプラグイン以外にも効くので、ほかへの影響は [Environment variables](https://code.claude.com/docs/en/env-vars) で確かめます（[Which marketplaces and plugins auto-update](https://code.claude.com/docs/en/plugins/loading#which-marketplaces-and-plugins-auto-update)）。

## 7. 仲間にも使ってもらう

プロジェクトの `.claude/settings.json` に次を書いてコミットします。

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

仲間がそのフォルダーを信頼する（ワークスペースの信頼のダイアログで許可する）と、このマーケットプレイスが仲間の端末に登録されます。ただし、`enabledPlugins` で有効にしただけでは、プラグインは仲間の端末に入らず、起動しても読み込まれません（[Enabled in project settings but not installed](https://code.claude.com/docs/en/plugins/loading#enabled-in-project-settings-but-not-installed)）。仲間はそれぞれ、クローンごとに1回、そのプロジェクトで次を実行します。

```bash
claude plugin install ja-proofread@ja-doc-proofreading --scope project
```

入れたあと、新しいセッションを始めるか、`/reload-plugins` を実行すると読み込まれます。すべてのプロジェクトで使うなら `--scope project` の代わりに `--scope user` で入れます。入れずに今のセッションだけで試すなら、`/reload-plugins` でも読み込めます。このプラグインはマーケットプレイスの中に相対パスで置いてあるためで、読み込まれるのはそのセッションだけです（同じ Enabled in project settings but not installed）。入れていないときは、`/plugin` の Errors タブに `isn't installed here` で終わる行が出ます。

仲間はそれぞれ「1. 非公開リポジトリを読めるようにする」を先に済ませておきます。マーケットプレイスが登録されないとき（フォルダーを信頼していない、認証が通らないなど）は、先に `claude plugin marketplace add andy0911/ja-doc-proofreading` を実行してから、上の install を実行します。

## 8. やめる

```bash
claude plugin uninstall ja-proofread@ja-doc-proofreading
claude plugin marketplace remove ja-doc-proofreading
```

`local` で入れたときは `--scope local` をつけて外します。

`claude plugin marketplace remove` は、`--scope` をつけないと、すべてのスコープからこのマーケットプレイスの宣言を消します。共有の `.claude/settings.json` の `extraKnownMarketplaces`（7. で仲間と共有したもの）からも消えます。最後のスコープから消えると、このマーケットプレイスから入れたプラグインもすべて外れ、そのデータ置き場も消えます（[plugin marketplace remove](https://code.claude.com/docs/en/plugins/cli-reference#plugin-marketplace-remove)）。プロジェクトで仲間と共有しているときは、`marketplace remove` の行は実行しないでください。自分の分を外すだけなら、uninstall の行で足ります。

`--scope project` で入れたときは注意します。`claude plugin uninstall ja-proofread@ja-doc-proofreading --scope project` は、共有の（コミットする）`.claude/settings.json` からこのプラグインを消すので、仲間の分まで止まります。自分だけ止めたいときは、Claude Code の中で `/plugin` の Installed タブからこのプラグインを選んで Uninstall を選び、「Disable for me」を選びます。自分の `.claude/settings.local.json` に無効と書かれ、プロジェクトには入ったままになります（[Uninstall a plugin the project enables](https://code.claude.com/docs/en/plugins/install#uninstall-a-plugin-the-project-enables)）。プロジェクトの全員でやめるときだけ、`--scope project` の uninstall を使い、変わった `.claude/settings.json` をコミットします。

最後のスコープから外すと、データ置き場（依存、検出の記録、誤検知の記録）も消えます。残したいときは `--keep-data` をつけます。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| マーケットプレイスを追加できない | `gh auth status`、または `ssh -T git@github.com`。リポジトリを読む権限があるか |
| 「textlint の依存がまだ入っていません」と出る | 「5. スクリプトを手で動かすとき」のとおり `JA_PROOFREAD_DATA` を設定して `ensure-deps.mjs` を実行し、npm のエラーを見る |
| 「textlint が動かなかった」と出る | textlint の指摘は確かめられていません。表示されたエラーを見て、`ensure-deps.mjs` で入れ直す |
| 書いても自動チェックが動かない | `.ja-proofread.json` がプロジェクトの直下にあるか、JSON として読めるか。そのファイルのパス（`.ja-proofread.json` のある場所からの相対パス）が `include` のどれかの glob に合い、`exclude` に合っていないか。例の設定の `include` は `docs/` と `slides/` の下だけです |
| 指摘が多すぎる | スライドなら `profile` を `slide` に。効かない型は `disable` に入れ、grow-ledger スキルで誤検知を記録する |
