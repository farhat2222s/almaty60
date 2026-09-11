# ALMATY 60 — technical prototype v0.1

This package contains a starter Unreal Engine 5.8 C++ project structure and a Node.js/PostgreSQL backend for one 60-second brand mission.

## Prototype mission

**Mission:** 60 Second Checkpoint Run

**Goal:** pass 5 checkpoints in order before the server-side 60-second deadline.

**Reward:** 500 XP + 300 Coins + a one-time demo discount reward.

The real-world reward is represented as a unique redemption code. Production must add authentication, staff access control, signed QR tokens, rate limits, device/anti-cheat signals, audit logs, and the real POS/CRM integration.

## Folder structure

- `Unreal/AL60/` — Unreal Engine project scaffold and C++ gameplay code.
- `Backend/` — REST API + PostgreSQL schema/seed.
- `docs/` — implementation and testing notes.

## Unreal setup

1. Install Unreal Engine **5.8**.
2. Generate project files from `Unreal/AL60/AL60.uproject`.
3. Build the `AL60` module in Rider/Visual Studio/Xcode as appropriate.
4. Open the editor and create a basic level from the `Third Person` template assets or an empty level.
5. Place five `AL60CheckpointActor` instances in the level and set Sequence values 1–5.
6. Place one `AL60MissionStartActor` in the level and set `MissionId` to `m_demo_60_checkpoint_run`.
7. Set `BackendBaseUrl` in `Config/DefaultGame.ini`.
8. Start the backend, then run the game.

### Local backend URL

- Desktop editor: `http://127.0.0.1:3000`
- Physical phone: replace this with the LAN address of the development machine, for example `http://192.168.1.50:3000`, and enable the OS firewall rule for TCP/3000.

## Backend setup — instant local prototype

The fastest demo path is the dependency-free in-memory server:

```bash
cd Backend
node dev-server.mjs
```

In a second terminal:

```bash
cd Backend
npm run smoke
```

This mode is for local gameplay/API testing only; data disappears when the process stops.

## Backend setup with PostgreSQL

PostgreSQL is required for the persistent backend.

```bash
cd Backend
cp .env.example .env
npm install
# create the database, then apply:
# psql "$DATABASE_URL" -f sql/001_schema.sql
# psql "$DATABASE_URL" -f sql/002_seed.sql
npm run dev
```

## Smoke test

With the backend running:

```bash
cd Backend
npm run smoke
```

The smoke test starts the mission, completes checkpoints 1–5, finishes the mission, and redeems the resulting demo reward.

## Scope intentionally excluded from v0.1

- production authentication
- real brand accounts
- real POS/CRM integrations
- payments
- multiplayer replication
- anti-cheat beyond server-authoritative mission timing/order
- final Almaty map and licensed 3D assets
- App Store / Google Play packaging
