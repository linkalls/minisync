# minisync

SQLite-first local-first sync engine.

`minisync` is for apps that:
- write to local SQLite first
- work offline
- sync later with your server
- want simple auth/backends instead of a locked-in hosted sync product

---

## 3行でいうと

1. アプリは **ローカル SQLite** に普通に書く
2. `minisync` が変更を queue に積む
3. `push` / `pull` でサーバーと同期する

---

## まず一番かんたんな流れ

### 1. ローカルDBを同期対応にする

```ts
import { Database } from "bun:sqlite";
import { installSync, syncTable } from "minisync";

const db = new Database("app.db");

db.exec(`
  create table if not exists notes (
    id text primary key,
    user_id text not null,
    title text not null,
    deleted_at text
  )
`);

installSync({
  db,
  tables: [
    syncTable("notes", {
      columns: ["id", "user_id", "title", "deleted_at"],
      deletedAtColumn: "deleted_at",
    }),
  ],
});
```

これで `notes` の INSERT / UPDATE / DELETE 相当が `_sync_queue` に積まれる。

---

### 2. クライアントを作る

```ts
import { createSyncClient, HttpSyncBackend } from "minisync";

const backend = new HttpSyncBackend({
  baseUrl: "https://api.example.com/sync",
  headers: {
    authorization: `Bearer ${token}`,
  },
});

const client = createSyncClient({
  db,
  backend,
  userId: "u1",
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
```

これで:
- local changes を `push`
- remote changes を `pull`
- 5秒ごとに自動同期

が動く。

---

### 3. サーバーを作る

```ts
import { Database } from "bun:sqlite";
import { bearerTokenAuth, createSyncServer, SqliteSyncBackend } from "minisync";

const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

export default createSyncServer({
  backend,
  auth: bearerTokenAuth({
    resolve: async (token) => ({ userId: token }),
  }),
});
```

この例では `Authorization: Bearer u1` が来たら `userId = "u1"` として扱う。
実運用ではここを Clerk / Auth.js / JWT 検証に差し替える。

---

## Drizzle を使う場合

文字列で列名を二重管理したくないならこっち。

```ts
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { installSync, syncTable } from "minisync";

const db = new Database("app.db");

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});

installSync({
  db,
  tables: [syncTable(notes)],
});
```

`syncTable(notes)` はできるだけ自動で推論する:
- `id`
- `user_id`
- `deleted_at`

必要なら上書きもできる。

```ts
syncTable(notes, {
  deletedAtColumn: "deleted_at",
  omitColumns: ["search_cache"],
});
```

---

## auth はどう書く？

`createSyncServer({ auth })` に **userId を返す関数** を渡すだけ。

### Clerk

```ts
import { clerkAuth, createSyncServer } from "minisync";

createSyncServer({
  backend,
  auth: clerkAuth(),
});
```

### Auth.js

```ts
import { authJsAuth, createSyncServer } from "minisync";

createSyncServer({
  backend,
  auth: authJsAuth({
    getSession: async (c) => {
      const session = await getSessionFromYourApp(c);
      return session;
    },
  }),
});
```

### JWT

```ts
import { jwtClaimsAuth, createSyncServer } from "minisync";

createSyncServer({
  backend,
  auth: jwtClaimsAuth(),
});
```

### 複数対応

```ts
import { authJsAuth, chainAuth, clerkAuth, jwtClaimsAuth } from "minisync";

const auth = chainAuth(
  authJsAuth({ getSession: async (c) => getSessionFromYourApp(c) }),
  clerkAuth(),
  jwtClaimsAuth(),
);
```

---

## backend は何がある？

### 1. `SqliteSyncBackend`
小さく始めたいとき用。
ローカル検証・dev・単純な self-host に向いてる。

### 2. `PostgresSyncBackend`
汎用 Postgres 用の scaffold。
自前サーバーで SQL executor を差し込む想定。

### 3. `SupabaseSyncBackend`
Supabase の RPC で動かしたいとき用。

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseSyncBackend } from "minisync";

const supabase = createClient(url, anonKey);
const backend = new SupabaseSyncBackend({ client: supabase });
```

Supabase 側には SQL 関数が必要。

```ts
import { supabaseSqlSetup } from "minisync";

const sql = supabaseSqlSetup();
```

この SQL を Supabase に流して、`minisync_pull` / `minisync_push` を作る。

---

## いま入ってる機能

- local SQLite を主にする同期モデル
- trigger ベース変更追跡
- `_sync_queue`, `_sync_state`
- HLC ordering
- LWW conflict resolution
- soft delete (`deleted_at`)
- push / pull
- partial ack
- retry / dead-letter
- auth-aware server
- Clerk / Auth.js / JWT / custom auth adapters
- SQLite / Postgres / Supabase backend entrypoints
- Hono server helper

---

## まだ注意が必要なところ

まだ完全無欠ではないので、このへんは導入時に見てね。

- 本番 auth の検証ロジック
- migration 戦略
- サーバー側の durable storage 設計
- テーブルごとの細かい apply policy
- 高度な競合解決（今は基本 LWW）

---

## examples

- `examples/client.ts`
- `examples/http-server.ts`
- `examples/supabase.ts`

---

## 開発

```bash
bun install
bun test
```

GitHub Actions でも `bun test` を回してる。
