# Database Adapters

minisync uses a thin `AsyncDatabase` abstraction layer so you can plug in any SQLite driver. Four ready-to-use adapters ship in the package.

---

## Bun SQLite — `bunSqliteAdapter`

For apps running on [Bun](https://bun.sh).

```ts
import { Database } from "bun:sqlite";
import { bunSqliteAdapter } from "minisync";

const db = bunSqliteAdapter(new Database("app.db"));
```

---

## better-sqlite3 — `betterSqlite3Adapter`

For Node.js apps using [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3).

```bash
npm install better-sqlite3
```

```ts
import Database from "better-sqlite3";
import { betterSqlite3Adapter } from "minisync";

const db = betterSqlite3Adapter(new Database("app.db"));
```

---

## node:sqlite — `nodeSqliteAdapter`

For Node.js 22.5+ using the built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html) module. No extra package required.

```ts
import { DatabaseSync } from "node:sqlite";
import { nodeSqliteAdapter } from "minisync";

const db = nodeSqliteAdapter(new DatabaseSync("app.db"));
```

---

## Deno @db/sqlite — `denoSqliteAdapter`

For [Deno](https://deno.com) apps using [`@db/sqlite`](https://jsr.io/@db/sqlite).

```ts
import { Database } from "@db/sqlite";
import { denoSqliteAdapter } from "minisync";

const db = denoSqliteAdapter(new Database("app.db"));
```

---

## libsql / Turso — `libsqlAdapter`

For apps using [`@libsql/client`](https://github.com/tursodatabase/libsql-client-ts), which supports both local SQLite files and [Turso](https://turso.tech) remote databases.

```bash
npm install @libsql/client
```

```ts
import { createClient } from "@libsql/client";
import { libsqlAdapter } from "minisync";

// Local file
const db = libsqlAdapter(createClient({ url: "file:app.db" }));

// Turso remote
const db = libsqlAdapter(createClient({
  url: process.env.TURSO_URL!,
  authToken: process.env.TURSO_TOKEN!,
}));
```

> **Note:** When using a remote libsql URL, every sync operation makes a network call. For local-first patterns, use a local `file:` URL as the primary database and replicate to Turso separately.

---

## Shared `SyncSqliteDatabase` interface

`betterSqlite3Adapter`, `nodeSqliteAdapter`, and `denoSqliteAdapter` all accept any object that satisfies the `SyncSqliteDatabase` interface:

```ts
interface SyncSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}
```

This makes it easy to use any synchronous SQLite driver — or even a test mock — without needing a specific adapter function.

---

## Implementing a custom adapter

If you have a different database driver, implement the `AsyncDatabase` interface directly:

```ts
import type { AsyncDatabase } from "minisync";

const db: AsyncDatabase = {
  async exec(sql, params) { /* run statement, no result */ },
  async query<T>(sql, params): Promise<T[]> { /* return all rows */ },
  async get<T>(sql, params): Promise<T | null> { /* return first row or null */ },
  async transaction<T>(fn) { /* run fn inside a transaction */ },
};
```

All methods receive parameters as `unknown[]`. SQL uses SQLite's `?1`, `?2`, … positional parameter syntax.
