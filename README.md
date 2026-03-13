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
クライアント側は **Drizzle schema を渡すだけ** に近づけてある。

---

## 今のおすすめ導線

### client

```ts
import { Database } from "bun:sqlite";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createDrizzleSyncClient, HttpSyncBackend } from "minisync";

const db = new Database("app.db");
db.exec("create table if not exists notes (id text primary key, user_id text not null, title text not null, deleted_at text)");

const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  deletedAt: text("deleted_at"),
});

const session = { user: { id: "u1" } };
const token = "your-auth-token";

const sync = createDrizzleSyncClient({
  db,
  backend: new HttpSyncBackend({
    baseUrl: "https://api.example.com/api/sync",
    headers: {
      authorization: `Bearer ${token}`,
    },
  }),
  userId: session.user.id,
  schema: [notes],
  intervalMs: 5000,
  autoStart: true,
});

await sync.syncNow();
```

これで:
- `installSync(...)` を手で呼ばなくていい
- `tables: ["notes"]` を別で書かなくていい
- Drizzle schema から同期対象を解決する

---

### server (Auth.js / Next.js route)

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

## 低レベルAPIもある

必要なら細かく組むこともできる。

### setup を明示したい場合

```ts
installSync({
  db,
  tables: [syncTable(notes)],
});
```

### client を明示したい場合

```ts
createSyncClient({
  db,
  backend,
  userId,
  tables: ["notes"],
});
```

でも、基本は **`createDrizzleSyncClient(...)` をおすすめ**。

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

---

## examples

- `examples/drizzle-client.ts` → 今のおすすめ client 例
- `examples/next-authjs-route.ts` → 既存 Auth.js サーバーに route を足す例
- `examples/http-server.ts` → standalone server helper example
- `examples/supabase.ts` → Supabase backend example

---

## 開発

```bash
bun install
bun test
```
