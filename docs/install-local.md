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

# B. SSH 鍵を使う（GitHub に登録済みなら何もしなくてよい）
ssh -T git@github.com
```

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

1. Claude Code を起動し直します。最初の起動で、textlint とルールが自動で入ります（数十秒。入れる先はプラグインのデータ置き場 `~/.claude/plugins/data/` で、プラグインを更新しても残ります）。
2. 入ったものを確かめます。

```bash
claude plugin details ja-proofread@ja-doc-proofreading
```

スキル3つ（write、proofread、grow-ledger）、サブエージェント2つ（fresh-eyes-reader、structure-reviewer）、フック2つ（SessionStart、PostToolUse）が並べば入っています。

3. Claude Code の中で `/ja-proofread:proofread 対象のファイル` と頼むと、校正の全工程が動きます。

## 4. 書いた直後の自動チェックを有効にする

自動チェック（ファイルを書いた直後の校正）は、プロジェクトの直下に `.ja-proofread.json` があるときだけ動きます。コードのリポジトリで README を直すたびに口を出さないためです。

```bash
cp ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/templates/ja-proofread.example.json .ja-proofread.json
```

場所が違うときは、最小限の `{"profile": "doc"}` だけを書いたファイルでも動きます。主な設定は次のとおりです。

| 設定 | 意味 |
|---|---|
| `profile` | `doc`（文章）か `slide`（スライド。句点のない行を許す） |
| `profiles` | パスごとの種類。例：`{"slides/**": "slide"}` |
| `include` / `exclude` | 自動チェックする・しないファイル |
| `disable` | 使わない型やルールのID。例：`["P010"]` |
| `prh` | チームの表記辞書を足す |
| `hook.blockOn` | Claude に直させる重さ。`must`（既定）、`should`、`info`、`never` |

## 5. 新しい版にする

非公開のマーケットプレイスは、自動更新が既定でオフです。台帳が育ってバージョンが上がったら、次を実行して Claude Code を起動し直します。

```bash
claude plugin marketplace update ja-doc-proofreading
claude plugin update ja-proofread@ja-doc-proofreading
```

自動で更新したいときは、`/plugin` の Marketplaces タブで、このマーケットプレイスの自動更新をオンにします。

## 6. 仲間にも使ってもらう

プロジェクトの `.claude/settings.json` に次を書いてコミットすると、仲間の手元で、マーケットプレイスの追加とプラグインの有効化が提案されます。仲間はそれぞれ「1. 非公開リポジトリを読めるようにする」を済ませておく必要があります。

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

この設定は、フォルダを信頼したあとに効きます。提案が出ないときは、仲間が一度 `claude plugin install ja-proofread@ja-doc-proofreading --scope project` を実行します。

## 7. やめる

```bash
claude plugin uninstall ja-proofread@ja-doc-proofreading
claude plugin marketplace remove ja-doc-proofreading
```

検出の記録と誤検知の記録もまとめて消えます。残したいときは `--keep-data` をつけます。

## 困ったとき

| 起きたこと | 確かめること |
|---|---|
| マーケットプレイスを追加できない | `gh auth status`、または `ssh -T git@github.com`。リポジトリを読む権限があるか |
| 「textlint の依存がまだ入っていません」と出る | `node ~/.claude/plugins/marketplaces/ja-doc-proofreading/plugins/ja-proofread/scripts/ensure-deps.mjs` を実行し、npm のエラーを見る |
| 書いても自動チェックが動かない | `.ja-proofread.json` がプロジェクトの直下にあるか。拡張子が `include` に入っているか |
| 指摘が多すぎる | スライドなら `profile` を `slide` に。効かない型は `disable` に入れ、grow-ledger スキルで誤検知を記録する |
