# GitHub Pages公開手順

このプロジェクトの公開先は専用リポジトリ `aishunrai/imo-gelato-print-station` です。公開URLは https://aishunrai.github.io/imo-gelato-print-station/ です。既存の `aishunrai/imo-gelato-lable` と既存Sitesは別管理で、今回変更しません。development全体は公開しません。

1. `npm test` を実行する。
2. プロジェクトフォルダでGitを初期化する（まだ `.git` がない場合）。mainブランチで対象ファイルをコミットする。
3. 選んだGitHubリポジトリへpushする。既存リポジトリの内容を置き換える場合は、その内容と差分を先に確認する。
4. GitHubのSettings → Pages → Build and deployment → Sourceを **GitHub Actions** に設定する。
5. Actionsの「Publish label printing page」が成功することを確認する。必要ならworkflow_dispatchで手動実行する。
6. 公開URLをAndroid Chromeで開き、ラベルファイルを共有し、プリンターを設定して現場確認する。

ワークフローは `apps/label-print/public` だけを公開します。テスト、archive、仕様書、Git履歴はWeb配信しません。CSS・JS・LBXへのリンクは相対パスなので、リポジトリ名付きURLにも対応します。

GitHub Pagesでは印刷ページ自体は公開されます。ログ保存は保存用キーを設定した端末からApps Scriptへ送信します。cloud-config.mjsのスプレッドシートIDとウェブアプリURLは公開用です。保存用キー・パスワード・実際の製造履歴をGitに追加しないでください。既存SitesのChatGPTログイン制限は引き継がれません。

元のGitHubにあるflavor.jsonは今回のアプリと自動同期しません。フレーバーは現在 `apps/label-print/public/transport.mjs` で管理します。

既存Sitesの公開版はそのまま利用できます。本番切り替え前に旧ページでCSVを保存してください。新URLでは端末内履歴が別の保存領域になります。
