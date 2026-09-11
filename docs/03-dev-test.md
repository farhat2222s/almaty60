# Local developer test

## Fastest path

```bash
cd Backend
node dev-server.mjs
```

In another terminal:

```bash
cd Backend
npm run smoke
```

Expected sequence:

`health -> start -> checkpoint 1 -> checkpoint 2 -> checkpoint 3 -> checkpoint 4 -> checkpoint 5 -> finish -> reward -> redeemed`

## Negative tests

The API must reject:

- starting a second active attempt for the same player;
- checkpoint 2 before checkpoint 1;
- finishing before checkpoint 5;
- using an expired reward;
- redeeming the same reward twice.

## Production note

`dev-server.mjs` uses in-memory state. `src/server.ts` + `sql/` is the persistent PostgreSQL implementation. Authentication and staff authorization are intentionally not implemented in v0.1.
