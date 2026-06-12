# Home Stack REST API 設計

このMVPは静的Webアプリのため、実ネットワーク通信ではなく `api/local-rest-api.js` の Local REST Adapter が RESTful なリソース操作を `localStorage` に対して実行します。将来サーバー化するときは、同じリソース名・HTTPメソッド・レスポンス形を維持して `/api` 配下の実APIへ差し替える想定です。

## レスポンス形式

すべての操作は以下の形で返します。

```json
{
  "ok": true,
  "status": 200,
  "data": {},
  "error": null
}
```

エラー時は `ok: false`、HTTP相当の `status`、`error.message`、`error.details` を返します。

## リソース一覧

| Method | Path | 用途 |
|---|---|---|
| `GET` | `/inventory` | 在庫一覧を取得する |
| `POST` | `/inventory` | 在庫を作成する |
| `PATCH` | `/inventory/:id` | 在庫の残量・自動補充・カテゴリなどを部分更新する |
| `DELETE` | `/inventory/:id` | 在庫を削除し、関連する補充キュー判断も削除する |
| `PUT` | `/settings/household` | 世帯設定を置き換える |
| `PUT` | `/settings/autopilot` | 自動購入予約ルールを置き換える |
| `PUT` | `/ui/offer-filter` | オファー表示フィルターを更新する |
| `POST` | `/photo-detections` | 写真解析結果として在庫候補を作成する |
| `POST` | `/replenishment-plan/refresh` | 消費ペースを進め、補充キューを再計算できる状態にする |
| `POST` | `/offers/:id/click` | 購入/広告クリックを記録する |
| `PATCH` | `/queue/:itemId` | 補充候補の承認・自動予約・スヌーズ・キャンセルを更新する |
| `GET` | `/state/export` | デモ状態を書き出す |
| `POST` | `/state/reset` | デモ状態を初期化する |

## 堅牢性ルール

- UIは直接 `localStorage` を書き換えず、REST Adapter 経由で状態変更する。
- 数値入力はAPI層で最小/最大値に丸める。
- カテゴリ、通知チャネル、ブランド変更ポリシー、配送ポリシー、フィルター、キュー操作は許可リストで検証する。
- 見つからないリソースは `404`、不正な入力は `422` として返す。
- 自動購入予約は `autoReplenish` がON、上限金額内、スポンサー確認/ブランド変更ルールを満たす場合だけ許可する。

## 将来のサーバー化

1. `api/local-rest-api.js` と同じインターフェースを持つ `RemoteRestApi` を追加する。
2. `request(method, path, body)` 内で `fetch('/api' + path, { method, body })` を呼ぶ。
3. 現在のUIハンドラはすでにREST Adapter経由なので、差し替え範囲をAPI生成部分に限定できる。
4. サーバー側では在庫、世帯、補充キュー、クリックイベント、自動購入予約を別テーブル/コレクションとして管理する。


## テスト方針

`tests/local-rest-api.test.mjs` で Local REST Adapter の主要リソースを Node.js の組み込みテストランナーで検証します。対象は在庫作成/更新/削除、設定の正規化、クリック/キューKPI、エラー形式、状態リセットです。


## 実行方法

`npm start` または `npm run api` で `server/api-server.mjs` を起動します。静的ファイルは `/` から配信し、REST API は `/api` prefix で公開します。たとえば `GET /api/inventory` は在庫一覧を返し、`POST /api/inventory` は在庫を作成します。

ローカルMVPではプロセス内メモリに保存します。永続化が必要になったら `createHomeStackServer` の状態管理部分をDB-backed repositoryに差し替えます。
