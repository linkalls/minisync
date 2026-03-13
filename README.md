# minisync

Tiny OSS local-first sync engine prototype for SQLite-first apps.

## What it includes
- Local SQLite metadata tables
- Trigger generation for INSERT / UPDATE / DELETE
- HLC timestamps
- LWW conflict resolution
- Push / pull client orchestration via backend adapters
- Bun test coverage

## Run tests
```bash
bun test
```
