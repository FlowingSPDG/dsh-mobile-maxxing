# Known issues

## スマホでドロワーが開かない／閉じられない（修正済み）

- 2026-10-26
- 症状: iPhone でドロワーを開いても中身が出ず、バックドロップは画面全体を覆ったままなので、どこをタップしても閉じられない。
- 原因は DSH 0.2.1-rc.2 で増えた同梱プラグイン `@deepseek-ai/dsh-client-ui-mobile` との競合。
  - このパッケージは「`[data-app-frame]` に `data-sidebar-collapsed` が無い = 開いている」とみなす。
  - ところが `ui-mobile` はスマホ表示では `sidebarCollapsed` を常に `false` にするため、**`data-sidebar-collapsed` は一度も書かれない**。
  - その結果ドロワー状態が常に `open` になり、`ui-mobile` 自身もヘッダーにトグル（`[data-mobile-menu]`）と専用バックドロップを持つので、両者が重なって操作不能になる。
- 修正: `ui-mobile` のスマホ表示（`html[data-dsh-mobile-layout="smartphone"]`）を検出したら、このパッケージはドロワーを一切描かず、`data-dsh-mobile-drawer` を状態として追従する。自前のFABとバックドロップは退避。
- あわせて、バックドロップの閉じ動作を click 待ちからタッチのリリースへ変えた。アプリ本体が「パネル外の押下で閉じる」処理を pointerdown で先に実行するため、click まで待つと枠が既に閉じており何も起きなかった。
- 検証: `tests/live-app.e2e.mjs` が実際の DSH サーバーを iPhone 相当（390×844 / dpr3 / iPhone UA）で開いて確認する。

## スマホで入力欄タップ時に勝手にズームする（修正済み）

- 2026-10-26
- 症状: コンポーザーにフォーカスした瞬間に拡大され、画面が意図しない位置へ飛ぶ。
- 原因: iOS は 16px 未満の入力欄にフォーカスすると拡大し、その倍率をページ終了まで保持する。コンポーザー本体（contenteditable）は自前の `font-size` を持たず、カードの 14px を継承していた。端末の表示設定で本文サイズを下げている場合はなおさら小さい。
- 修正: 入力欄と `html` のテキスト自動拡大（`text-size-adjust`）を固定し、`[data-composer-input]` / `[data-composer-card] [contenteditable]` も 16px に固定。既に拡大された状態を検出したときは、キャレットのある入力欄を画面中央へ戻す（`releaseFocusZoom()`）。

## iOS 26 standalone: 下端が少し引っ張れる（未修正）

- 2026-10-22
- `body` を `100dvh` の1行グリッドにし、`overflow: hidden` / `overscroll-behavior: none` にしても、iOS 26 のホーム画面アプリでは下端で小さなラバーバンドが残る。
- iOS 26 の standalone WebView は画面（844px）よりステータスバー分（47px）短く、下に未描画の帯がある。DSH側のスクロールは本文1つにしたが、このネイティブの引っ張りはCSSでは止めきれない。
- 恒久対応は iOS/WebKit の修正、またはネイティブラッパー（Capacitor など）。
- 参考: [WebKit Bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
