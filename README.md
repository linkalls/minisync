# minisync

Drizzle-first local-first sync engine for SQLite apps.

`minisync` is for apps that:
- write to local SQLite first
- work offline
- sync later with your server
- want OSS sync infra instead of a hosted lock-in product

---

## 3行でいうと

1. アプリは **Drizzle + local SQLite** に普通に書く
2. `minisync` が変更を queue に積む
3. `push` / `pull` でサーバーと同期する

---

## 最短のおすすめ構成

### 1. Drizzle テーブルを同期対象にする

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

`syncTable(notes)` はなるべく自動で推論する。
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
  userId: session.user.id,
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
```

---

### 3. サーバーは Auth.js helper を使う

```ts
import { authJsAuth, createSyncServer, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

export default createSyncServer({
  backend,
  auth: authJsAuth({
    getSession: async (c) => {
      return await getSessionFromYourApp(c);
    },
  }),
});
```

これがいまの **おすすめ導線**。

---

## Auth.js をどう考えてる？

`minisync` は Auth.js の独自流儀を作らない。
やることはシンプルで、**Auth.js が解決した session から `userId` を受け取るだけ**。

つまり:
- Auth.js の session / middleware / callback の流れはそのまま
- `minisync` は sync 用の接続点だけ提供
- 独自の auth wrapper を押しつけない

### 推奨

```ts
import { authJsAuth } from "minisync";

const auth = authJsAuth({
  getSession: async (c) => {
    return await getSessionFromYourApp(c);
  },
});
```

---

## ほかの auth も使える

### Clerk

```ts
import { clerkAuth } from "minisync";

const auth = clerkAuth();
```

### JWT

```ts
import { jwtClaimsAuth } from "minisync";

const auth = jwtClaimsAuth();
```

### custom

```ts
import { bearerTokenAuth } from "minisync";

const auth = bearerTokenAuth({
  resolve: async (token) => ({ userId: token }),
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

### `SqliteSyncBackend`
- 一番軽い
- ローカル検証 / dev / 小さめ self-host 向け

### `PostgresSyncBackend`
- 汎用 Postgres scaffold
- 自前サーバーで SQL executor を差し込む形

### `SupabaseSyncBackend`
- Supabase RPC ベース
- `supabaseSqlSetup()` で SQL scaffold を出せる

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseSyncBackend, supabaseSqlSetup } from "minisync";

const supabase = createClient(url, anonKey);
const backend = new SupabaseSyncBackend({ client: supabase });
const sql = supabaseSqlSetup();
```

---

## Drizzle を使わない場合

raw SQL でも使える。
ただ、これは **fallback** 扱い。
基本は Drizzle をおすすめする。

```ts
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

---

## いま入ってる機能

- Drizzle-first setup API
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
- Auth.js / Clerk / JWT / custom auth adapters
- SQLite / Postgres / Supabase backend entrypoints
- Hono server helper
- GitHub Actions CI

---

## まだ注意が必要なところ

- 本番 auth の検証ロジック
- migration 戦略
- サーバー側の durable storage 設計
- テーブルごとの細かい apply policy
- 高度な競合解決（今は基本 LWW）

---

## examples

- `examples/client.ts` → Drizzle client example
- `examples/http-server.ts` → Auth.js helper 推奨 server example
- `examples/supabase.ts` → Supabase backend example

---

## 開発

```bash
bun install
bun test
```
