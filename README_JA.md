# CC Sidecar

[English](README.md) | [日本語](README_JA.md)

<img src="icons/icon128.png" width="96" height="96" alt="CC Sidecarアイコン">

YouTube字幕をChromeのサイドパネルで取得・コピー・整形・保存するManifest V3拡張機能です。

**バージョン：0.5.0 · メンテナー：[naruo4](https://github.com/naruo4)**

**[Transcript Sidecar](https://github.com/tokumaru-labs/transcript-sidecar) 0.4.2（原作者：Tokumaru Labs）**を基にした独立フォークです。元作者への帰属、Git履歴、**GPL-3.0-only**を維持しています。[NOTICE.md](NOTICE.md)・[LICENSE](LICENSE)を参照してください。

## 機能

- 日本語／英語のサイドパネル。
- 公開動画と、現在のYouTubeアカウントで視聴権限があるメンバー限定動画の字幕取得。
- プレイヤーが実際に要求した字幕URLを、ログイン済みページから`credentials: "include"`で再取得。
- 全文・段落整形・時刻付き・Markdownのコピー、TXT／Markdown保存。
- セグメントの時刻から動画へシーク。
- 全取得経路を独立して診断し、比較TXTと詳細JSONの2ファイルを出力。複数動画をまとめてLLMに渡して分析できます。
- 追跡・広告・開発者の字幕サーバー・LLMへの自動送信なし。ビルド手順・実行時パッケージ依存なし。

## インストール・使い方

1. リポジトリをcloneするか、**Code → Download ZIP**で取得して展開します。
2. `chrome://extensions`でデベロッパーモードをオンにし、「パッケージ化されていない拡張機能を読み込む」を選びます。
3. `manifest.json`があるリポジトリのルートフォルダを選択します。
4. YouTube動画タブを再読み込みし、字幕をオンにして言語を選び、プレイヤーに字幕が出るまで待ちます。
5. **CC Sidecar**を開き、同じ字幕トラックを選んで「字幕を取得」を押します。
6. 本文をコピー・保存します。比較する場合は「字幕取得診断」→「比較TXTを保存」→「詳細JSONを保存」を実行します。

更新後は拡張機能とYouTubeタブを再読み込みし、パネルを開き直してください。元プロジェクトからの変更には`webRequest`権限の追加があります。今回のリポジトリ更新はChrome Web Storeへの公開ではありません。

## 通常の取得順

1. **player-webrequest-timedtext**：`chrome.webRequest`でYouTubeのトップフレームの`/api/timedtext`通信を観測し、そのURLをページ内でそのまま取得。
2. **alternate-player-timedtext（JSON3）**：ANDROID互換playerの完全一致トラックを取得。
3. **get_panel**：現在のページの文字起こしパネル用メタデータから取得。

監視URLが未取得・期限切れ・空・不正・取得失敗の場合は既存経路へ進みます。動画が切り替わった場合は中止します。言語・自動／手動の種別・トラック名・翻訳指定・一意なトラックIDを照合し、曖昧なトラックは採用しません。他形式やDOMの経路は診断用に維持しています。VTTのHTMLエンティティは整形後に復号し、診断の原文は保持します。

現在のYouTubeの視聴権限を利用する方式です。メンバー資格を追加したり、再生制限を解除したりするものではありません。取得可否はYouTubeの挙動とページのログイン状態に依存します。音声の文字起こしや、欠落語句の推測補完は行いません。

## 権限とプライバシー

- `scripting`：動画・字幕情報の確認、ページ内fetch、タブ内の拡張専用メモリ、シーク。
- `sidePanel`：インターフェース表示。
- `webRequest`：字幕要求URLの受動的な監視。通信のブロックやヘッダーの収集はしません。
- ホスト権限は`https://www.youtube.com/*`・`https://youtube.com/*`・`https://m.youtube.com/*`のみ。

署名付きURLはバックグラウンドとタブ内の拡張専用メモリだけに保持します。永続保存・ログ出力・保存ファイルへの混入・第三者への送信はありません。タブ内メモリからワーカー停止後も復元でき、常駐化・ポーリング・fetch/XHRの置換は行いません。動画遷移・タブ終了・失効・HTTP取得失敗で無効化します。各タブ最大12トラック、有効期限は署名期限と観測後1時間の早い方です。

永続保存する設定はパネルの表示言語のみです。互換性のため内部キー`transcriptSidecar.uiLanguage`を維持しています。詳細は[PRIVACY.md](PRIVACY.md)・[字幕取得診断ガイド](DIAGNOSTICS_JA.md)を参照してください。

## 開発・検証

```sh
git clone https://github.com/naruo4/cc-sidecar.git
cd cc-sidecar
node --test tests/*.test.mjs
node tests/run-browser-diagnostics.mjs
```

Chromeの検証には一時プロファイルとテスト字幕を使います。実行ファイルの場所が異なる場合は`CHROME_BIN`を指定できます。公開／メンバー動画、既存HTTP 200/0Bからの回復、フォールバック、動画・トラック分離、URL破棄、ワーカー再起動、VTT復号、各保存形式をテストしています。すべての実動画での成功を保証するものではなく、利用するアカウントで両種の動画を確認してください。

## ライセンスと帰属

原作は**Tokumaru LabsのTranscript Sidecar**、このフォークのメンテナーは**naruo4**です。ソースコードは引き続き**GPL-3.0-only**で、[LICENSE](LICENSE)本文は変更していません。改変履歴は[NOTICE.md](NOTICE.md)・[CHANGELOG.md](CHANGELOG.md)、名称・ロゴについては[TRADEMARKS.md](TRADEMARKS.md)を参照してください。YouTubeおよびTokumaru Labsの公式製品・公認製品ではありません。
