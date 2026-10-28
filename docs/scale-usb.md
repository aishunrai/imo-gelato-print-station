# TL-280重量連携テスト版

テストURL: https://aishunrai.github.io/imo-gelato-print-station/scale-test/

従来の印刷ページは https://aishunrai.github.io/imo-gelato-print-station/ 。従来ページのHTML・CSS・JS・LBXは変更しない。aishunrai/imo-gelato-lableと旧Sitesも変更しない。

## 初回操作

1. USBハブ・スケールを接続し、Serial USB Terminalの接続を解除する。必要ならアプリを終了する。
2. AndroidのChromeでテストURLを直接開く。埋め込みやアプリ内ブラウザを使わない。
3. 「USBで自動取得」を選び、「スケールを接続」を押す。FTDI機器を選び、ChromeへのUSBアクセスを許可する。
4. 接続後にケースを載せ、風袋引きを押して、中身を入れて計量する。安定後のWgが正味重量へ反映される。Ptは確認用で二重に引かない。
5. 初回は702g等の基準外の物でも受信表示を確認できる。印刷は2000〜2100gだけ可能。
6. 日時・重量対応のgelato-label-v2.lbxをSmooth Printに設定したAndroidで印刷する。現行と同じLBXなのでこの変更でテンプレートの再作成は不要。
7. 次のケースは「次の計量を開始」を押してから、載せ替え・風袋引き・計量を行う。

TL-280は安定した計量結果を送る。連続ストリーミングの重量表示や、物を下ろした瞬間の通知ではない。初回もUSB接続した後に再計量する。30秒経過、画面が隠れたとき、USB切断、印刷開始で重量の採用を解除する。重量の未受信・基準外・期限切れでは印刷しない。新しい重量を受信しただけでは印刷しない。

## 保存

従来ページのlocalStorageと接続設定を読み書きしない。テスト版の履歴は `imo-scale-test-v1`、保存設定は `imo-scale-test-sheets:<sheetId>`。従来ページのデータを自動移行・削除しない。

実機印刷のログをシートへ保存するにはテスト版でも保存キーを設定する。保存先のシートと受付URLは同じ。実機印刷のログは同じ製造ログに入るので、動作を見るだけのときは「画面を試す」を使う。画面確認モードはUSB重量を採用せず、プリンタ・シートへ送らない。

取得方法は `scale-usb`。ラベル・履歴・シートに同じ確定した正味重量を使用する。風袋量と重量受信日時は端末履歴とCSVに保持する。シートの列構成は変更しない。シート通信が失敗しても印刷を待たせず、未同期の記録を再送する。

## 対応範囲・診断

この版はFTDI VID 0403 / PID 6001の1ポート・64byteパケットとTL-280の8kg仕様専用。設定は9600bps、8N1、フロー制御なし。WebUSBでFTDI UARTを設定し、受信パケットごとの2byteステータスを除去し、CRLFまで組み立てて解析する。スケールへの送信コマンドやFTDI EEPROM書き換えは行わない。

USBのインターフェースをAndroidの組み込みドライバーや別アプリが使用している場合、Terminalで受信できてもChromeが直接取得できないことがある。PCのWindows標準FTDIドライバーを変更・削除する必要はない。Android Chromeで失敗するときは「受信の仕組み・診断情報」のメッセージを確認する。直接取得不可の場合は、別途Android中継アプリの実装を検討する。実機動作はまだ未確認で、ソフトウェアのテストのみで実機接続済みとは扱わない。

## 検証と公開

`npm run build`、`npm test`、`npm run package:pages`。従来ページ44件と新しいページ23件、計67件を確認。実際の702g/Pt0、334g/Pt0、702g/Pt334をテストデータに使用。

公開パッケージはdist-pagesを生成する。従来のpublicをルートへ、新しいapps/scale-print/publicをscale-testへコピーし、従来publicとの全ファイルのバイト一致を検証する。

参照: [Chrome WebUSB](https://developer.chrome.com/docs/capabilities/usb)、[Chrome Web Serial](https://developer.chrome.com/docs/capabilities/serial)、[FTDI UART実装・定数の一次資料](https://github.com/mik3y/usb-serial-for-android/blob/master/usbSerialForAndroid/src/main/java/com/hoho/android/usbserial/driver/FtdiSerialDriver.java)、[TL-280シリアル仕様](https://api-img.tanita.co.jp/v=1678670516/files/user/support/manual/RS_TL280_290_v11.pdf)。独自の限定実装で、外部ライブラリは追加していない。
