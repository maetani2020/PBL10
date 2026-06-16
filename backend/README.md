# iOS Calendar Backend (REST API)

PBLの授業で開発するiOS風カレンダーアプリ用のバックエンドサーバーです。
ユーザー認証（JWT）、カレンダーの作成・共有権限管理、およびClaude APIを使用したシフト表のスケジュール自動解析機能を備えています。

---

## 機能概要

1. **ユーザー認証 (Auth)**: パスワードハッシュ化（bcrypt）、JWTトークンによる認証。
2. **複数カレンダー管理 & 共有 (Calendars & Sharing)**:
   - ユーザーは複数のカレンダーを作成可能。
   - 他のユーザーのメールアドレスを指定して「閲覧のみ (readonly)」「編集可能 (readwrite)」の権限で共有可能。
3. **カレンダー予定管理 (Events)**:
   - イベントのCRUD処理（取得・登録・更新・削除）。
   - 共有されたカレンダーに対する権限チェックをサーバー側で適用。
4. **AIシフト解析 (AI Parser)**:
   - 貼り付けられたシフトテキストを解析し、登録用のイベント形式（JSON配列）に自動抽出。
   - ※Claude APIキーが未設定の場合は、自動的にローカルの正規表現解析（デモモード）に切り替わります。

---

## セットアップと起動方法

### 1. 依存関係のインストール
プロジェクトのルートディレクトリで以下を実行します。
```bash
npm install
```

### 2. 環境変数設定（.env）
ルートディレクトリに `.env` ファイルを作成し、以下のように設定します（`.env` はgit管理から除外されています）。
```env
PORT=3000
JWT_SECRET=任意のシークレットキー
ANTHROPIC_API_KEY=あなたのClaude_APIキー (任意)

# PostgreSQL接続情報 (必須)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/calendar
# または個別の接続情報
# PGUSER=postgres
# PGHOST=localhost
# PGPASSWORD=postgres
# PGDATABASE=calendar
# PGPORT=5432
```

### 3. サーバーの起動
```bash
# 通常起動
npm start

# 開発用自動リロード起動 (nodemonが必要な場合)
npm run dev
```
起動すると、指定されたPostgreSQLデータベースに自動的に接続され、テーブル作成およびマイグレーションが実行されます。
ブラウザで `http://localhost:3000` にアクセスすると、フロントエンドのデモ画面でバックエンドの動作確認が可能です。

---

## API仕様書 (フロントエンド開発用)

すべてのAPIリクエストはJSON形式（`Content-Type: application/json`）で行います。
また、認証が必要なAPIには、リクエストヘッダーに `Authorization: Bearer <JWT_TOKEN>` を付与してください。

### 1. 認証関連 (Auth API)

#### ■ ユーザー新規登録
* **URL**: `POST /api/auth/register`
* **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password123",
    "display_name": "ユーザー名"
  }
  ```
* **Response (201 Created)**:
  ```json
  {
    "message": "ユーザー登録が完了しました",
    "user": { "id": 1, "email": "user@example.com", "display_name": "ユーザー名" }
  }
  ```

#### ■ ログイン
* **URL**: `POST /api/auth/login`
* **Body**:
  ```json
  {
    "email": "user@example.com",
    "password": "password123"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": "ログインに成功しました",
    "token": "eyJhbGciOi...",
    "user": { "id": 1, "email": "user@example.com", "display_name": "ユーザー名" }
  }
  ```

---

### 2. カレンダー管理 (Calendars API)

#### ■ カレンダー一覧の取得（要認証）
自分が所有するカレンダーおよび他人から共有されたカレンダーの一覧を取得します。
* **URL**: `GET /api/calendars`
* **Response (200 OK)**:
  ```json
  [
    {
      "id": 1,
      "name": "マイカレンダー",
      "owner_id": 1,
      "access_level": "owner",
      "is_shared": 0
    },
    {
      "id": 2,
      "name": "共有されたカレンダー",
      "owner_id": 2,
      "access_level": "readonly", // 'readonly' または 'readwrite'
      "is_shared": 1,
      "owner_name": "他ユーザー名"
    }
  ]
  ```

#### ■ 新規カレンダー作成（要認証）
* **URL**: `POST /api/calendars`
* **Body**: `{ "name": "カレンダー名" }`
* **Response (201 Created)**:
  ```json
  {
    "message": "カレンダーを作成しました",
    "calendar": { "id": 3, "name": "カレンダー名", "owner_id": 1, "access_level": "owner" }
  }
  ```

#### ■ カレンダーの共有設定（要認証・カレンダー所有者のみ）
他の登録ユーザーにカレンダーを共有します。
* **URL**: `POST /api/calendars/:id/share`
* **Body**:
  ```json
  {
    "email": "share_target@example.com",
    "access_level": "readwrite" // 'readonly' (閲覧のみ) または 'readwrite' (編集可)
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": "カレンダーを 共有相手 さんに共有しました",
    "sharedWith": {
      "id": 2,
      "email": "share_target@example.com",
      "display_name": "共有相手名",
      "access_level": "readwrite"
    }
  }
  ```

---

### 3. イベント管理 (Events API)

#### ■ イベント一覧の取得（要認証）
アクセス権限（自分が所有、または共有された）を持つすべてのカレンダーのイベントを取得します。
* **URL**: `GET /api/events`
* **Response (200 OK)**:
  ```json
  [
    {
      "id": "event_1718000000000",
      "calendar_id": 1,
      "calendar_name": "マイカレンダー",
      "title": "予定のタイトル",
      "location": "場所",
      "allday": false,
      "start": "2026-06-12T09:00",
      "end": "2026-06-12T18:00",
      "color": "#007AFF",
      "memo": "メモ内容",
      "user_access": "owner" // 'owner', 'readwrite', 'readonly' (フロント側での編集制限に使用)
    }
  ]
  ```

#### ■ 新規イベント登録（要認証・書込権限が必要）
* **URL**: `POST /api/events`
* **Body**:
  ```json
  {
    "calendar_id": 1, // 指定しない場合はデフォルトカレンダーに登録されます
    "title": "バイト",
    "location": "オフィス",
    "allday": false,
    "start": "2026-06-12T09:00",
    "end": "2026-06-12T18:00",
    "color": "#007AFF",
    "memo": "シフト"
  }
  ```

#### ■ イベント更新（要認証・書込権限が必要）
* **URL**: `PUT /api/events/:id`
* **Body**: 登録時と同じフィールド

#### ■ イベント削除（要認証・書込権限が必要）
* **URL**: `DELETE /api/events/:id`

---

### 4. AI解析関連 (AI API)

#### ■ シフト表テキストの解析（要認証）
* **URL**: `POST /api/ai/parse-shift`
* **Body**:
  ```json
  {
    "text": "6/12 9-18時 バイト\n6/15 13-17時 会議"
  }
  ```
* **Response (200 OK)**:
  ```json
  {
    "message": "Claude APIによるシフト解析が完了しました",
    "isMock": false,
    "events": [
      {
        "title": "バイト",
        "start": "2026-06-12T09:00",
        "end": "2026-06-12T18:00",
        "location": "",
        "memo": "元テキスト: \"6/12 9-18時 バイト\"",
        "allday": false
      },
      {
        "title": "会議",
        "start": "2026-06-15T13:00",
        "end": "2026-06-15T17:00",
        "location": "",
        "memo": "元テキスト: \"6/15 13-17時 会議\"",
        "allday": false
      }
    ]
  }
  ```
