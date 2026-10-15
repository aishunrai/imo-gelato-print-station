# システム構成

Android Chrome → 同じ端末のSmooth Print（http://localhost:8088）→ QL-820NWB。

公開サイトは静的ファイルを配信します。印刷指示はタブレットから送信します。ラベルの共有は各Android端末で必要です。`public/assets/labels/gelato-label-v2.lbx` をダウンロードし、「共有」からSmooth Printへ登録してください。

## 現在の実装

- フレーバー、担当者、枚数、手入力の正味重量を入力。用紙62×29mmのgelato-label-v2.lbxへフレーバー・担当者・製造日時・重量を送信。
- 製造日時は発行依頼時に確定して日本時間で印字。正味重量2000〜2100gの合格時だけ発行可能。変更可能な基準値はconfig.mjsで管理。
- 印刷ボタン1回につき `/print` を1回だけ送信。成功XMLの確認で成功表示。
- 接続確認は `/getstatus` のみ。印刷しません。
- 接続欄は正常な状態応答または印刷成功で更新。印刷成功時は「印刷応答を確認しました」と確認時刻を表示。
- 取得失敗は「状態を確認できません」とし、未接続と断定しません。未知の応答も正常とは断定せず、表示して確認を促します。
- ページから離れると以前の接続確認を古い情報として扱い、画面へ戻った時に状態取得を試します。印刷中は別の通信を重ねません。自動印刷・自動再送はしません。
- 接続表示は常時監視ではなく、その時点の応答確認です。電源を切った直後の検知は保証しません。
- デモは通信しません。ページ再読み込み時、履歴から接続済み状態を復元しません。
- 印刷の結果不明時はラベル現物の確認が必要。紙切れなども部分印刷の可能性があるため自動再送しません。
- 発行履歴はlocalStorageとCSV。接続設定後はGoogle Apps Script経由でGoogleスプレッドシートへ非同期で保存。Google側の障害・接続未設定でも印刷可能。端末内の完全な旧履歴も同じUUIDで移行。スケールからの重量自動取得は未実装。
- 印刷と同期は別の状態で管理。再送でプリンタを呼ばない。同じIDのシート行を更新し、送信した版だけを同期済みとする。Apps Script側もロックと更新番号で古い版の上書きを防止。
- 保存用キーは初回に端末で設定。通常はsessionStorage、本人が端末保存を選択した場合はlocalStorageへ保持。公開コードには含めない。
- 詳細は[google-sheets.md](google-sheets.md)。Supabase用ソースはsupabase/legacyへ保存し、現行アプリからは呼ばない。

## 機器

- スケール：タニタ TL-280、8kg、RS-232C。
- タブレット：NEC PC-T1055KAS。USB-C、OTG対応。
- 変換器：WindowsでFTDI VID_0403 / PID_6001、COM3を確認済み。Android側のUSB認識は未解決。
- 秤通信：9600bps、8bit、パリティなし、ストップ1、フローなし。秤の出力設定はout PC。実装前に説明書と実データで確定する。

製造日時は初回発行時の値を履歴と印字で共有します。再発行は元の製造日時と重量を保持し、発行操作時刻は別に更新します。既存LBXの日付オブジェクトはv2で通常テキストへ置き換えています。

## 保存先の変更

GitHub Pagesへの移行でURLのオリジンが変わると、既存SitesのlocalStorage履歴は引き継がれません。旧ページでCSVを保存してください。現在CSVの再取込機能はありません。

## 参照

- https://support.brother.co.jp/j/s/support/html/smoothprint/reference/single_layout_printing/
- https://support.brother.co.jp/j/s/support/html/smoothprint/reference/printer_status/
