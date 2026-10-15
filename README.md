# ジェラート品質管理

ジェラート製造の計量・記録・ラベル発行のためのプロジェクトです。現在はAndroid / Smooth Print / Brother QL-820NWB向けのラベル印刷アプリを実装しています。

公開先: https://aishunrai.github.io/imo-gelato-print-station/ 。既存の印刷ページは別のリポジトリで運用しており、この公開では変更しません。新URLでは初回にGoogleスプレッドシート保存の接続設定が必要です。保存用キーは公開ファイルに含めません。

製造日時と手入力重量の印字に対応しました。正味2000〜2100gのみ発行できます。Androidには新しい `gelato-label-v2.lbx` の共有が必要です。[手順と仕様](docs/manual-weight.md)

Googleスプレッドシートへの印刷ログ保存に対応しました。保存に失敗しても印刷を継続し、未同期記録を後から再送します。[接続設定・同期の操作](docs/google-sheets.md)

## 構成

```text
apps/label-print/public/  公開するHTML・CSS・JavaScript・ラベルテンプレート
apps/label-print/tests/   印刷通信・接続表示の回帰テスト
docs/                    仕様、現場確認、公開手順、移動記録
scripts/                 ローカル確認用サーバー
apps-script/             Google側の保存受付（Apps Script）
supabase/                DBの定義SQL・権限テスト
.github/workflows/       GitHub Pages公開用ワークフロー
archive/                 移動前のSitesソース・Git履歴・成果物・作業データ（Git対象外）
```

このフォルダを1つのGitHubリポジトリとして扱います。親のdevelopment全体や、他案件を同じリポジトリに含めないでください。

## 開発

Node.js 20以降。外部パッケージのインストールは不要です。

```sh
npm run build
npm test
npm run dev
```

表示確認は http://127.0.0.1:4173 。PCでは「画面を試す」を使用します。PCからAndroid端末内のSmooth Printへ接続することはできません。

HTMLを直接開く場合もフレーバー選択・重量判定・デモ発行を利用できます。ソースの.mjsを編集した後は `npm run build` でapp.bundle.jsを更新してください。[フレーバー表示とローカルプレビュー](docs/flavor-display.md)

## 運用と公開

- [システム構成と実装範囲](docs/architecture.md)
- [Googleスプレッドシートの設定・操作・障害時](docs/google-sheets.md)
- [GitHub Pagesへの公開](docs/github-pages.md)
- [実機の確認項目](docs/acceptance.md)
- [ファイルの移動記録](docs/migration.md)

## 2026-10-15の修正

実機印刷の成功は利用者が確認済みです。従来は印刷成功時に接続欄を更新していなかったため、未確認の表示が残る実装でした。印刷成功・状態取得・取得失敗の各結果で表示を更新し、確認時刻を表示します。

今回の修正は開発用ソースです。既存Sitesの公開URLと元のGitHubには反映していません。修正版の接続表示・状態取得はAndroid実機で再確認が必要です。
