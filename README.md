# minisync

Drizzle-first local-first sync engine for SQLite apps.

`minisync` is for apps that:
- write to local SQLite first
- work offline
- sync later with your server
- want OSS sync infra instead of a hosted lock-in product

---

## いちばん理想の使い方

**既存の Auth.js 入りサーバーに、sync route を1個足すだけ。**

`minisync` は auth の主役にならない。
既存の session / auth middleware の結果を読んで、sync に渡すだけ。

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

---

### 2. クライアントを作る

```ts
import { createSyncClient, HttpSyncBackend } from "minisync";

const session = { user: { id: "u1" } };
const token = "your-auth-token";

const client = createSyncClient({
  db,
  backend: new HttpSyncBackend({
    baseUrl: "https://api.example.com/api/sync",
    headers: {
      authorization: `Bearer ${token}`,
    },
  }),
  userId: session.user.id,
  tables: ["notes"],
  intervalMs: 5000,
});

client.start();
await client.syncNow();
```

---

### 3. 既存の Auth.js サーバーに route を足す

```ts
// app/api/sync/[action]/route.ts
import { auth } from "@/auth";
import { createSyncRouteHandlers, resolveAuthJsIdentity, SqliteSyncBackend } from "minisync";
import { Database } from "bun:sqlite";

const db = new Database("sync.db");
const backend = new SqliteSyncBackend({ db });
backend.init();

export const { POST } = createSyncRouteHandlers({
  backend,
  resolveIdentity: resolveAuthJsIdentity({ auth }),
});
```

これが今の **一番おすすめの導線**。

---

## Auth.js をどう考えてる？

`minisync` は Auth.js の独自流儀を作らない。

やることはこれだけ:
- 既存の `auth()` や session resolver を呼ぶ
- `userId` を取り出す
- sync request に流す

つまり、**Auth.js 既存サーバーに後付けしやすい** ことを重視してる。

### 推奨 helper

```ts
import { resolveAuthJsIdentity } from "minisync";

const resolveIdentity = resolveAuthJsIdentity({ auth });
```

---

## ほかの auth も使える

### Auth.js helper

```ts
import { resolveAuthJsIdentity } from "minisync";

const resolveIdentity = resolveAuthJsIdentity({ auth });
```

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

## route handler 方式と server helper 方式

### 1. route handler に埋め込む（おすすめ）
既存のサーバーに足しやすい。

- `createSyncRouteHandlers(...)`
- `handleSyncRequest(...)`
- `resolveAuthJsIdentity(...)`

### 2. Hono helper を使う
新規に sync サーバーを切りたいとき向け。

- `createSyncServer(...)`

でも基本は **埋め込み型 route handler** をおすすめする。

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
- embedded route handlers
- auth-aware server helper
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
- `examples/http-server.ts` → standalone server helper example
- `examples/next-authjs-route.ts` → 既存 Auth.js サーバーに route を足す例
- `examples/supabase.ts` → Supabase backend example

---

## 開発

```bash
bun install
bun test
```
