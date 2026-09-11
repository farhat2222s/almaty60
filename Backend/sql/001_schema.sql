CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  time_limit_seconds INT NOT NULL DEFAULT 60,
  total_checkpoints INT NOT NULL DEFAULT 5,
  reward_xp INT NOT NULL DEFAULT 500,
  reward_coins INT NOT NULL DEFAULT 300,
  reward_type TEXT NOT NULL DEFAULT 'discount',
  reward_value INT NOT NULL DEFAULT 20,
  reward_valid_hours INT NOT NULL DEFAULT 48,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mission_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id TEXT NOT NULL REFERENCES missions(id),
  player_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  last_checkpoint INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','failed')),
  failure_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_attempts_player ON mission_attempts(player_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON mission_attempts(status);

CREATE TABLE IF NOT EXISTS checkpoint_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES mission_attempts(id) ON DELETE CASCADE,
  sequence INT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(attempt_id, sequence)
);

CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL UNIQUE REFERENCES mission_attempts(id),
  player_id TEXT NOT NULL,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  reward_type TEXT NOT NULL,
  value_text TEXT NOT NULL,
  redemption_code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','redeemed','expired','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
