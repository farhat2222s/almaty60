import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

const app = express();
app.use(cors());
app.use(express.json());

const port = Number(process.env.PORT ?? 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function nowMs(): number {
  return Date.now();
}

function error(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'almaty60-backend' });
  } catch {
    return error(res, 503, 'database unavailable');
  }
});

app.get('/api/missions/:missionId', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT m.id, b.name AS brand_name, m.title, m.description,
           m.time_limit_seconds, m.total_checkpoints,
           m.reward_xp, m.reward_coins, m.reward_type, m.reward_value
      FROM missions m
      JOIN brands b ON b.id = m.brand_id
     WHERE m.id = $1 AND m.active = true AND b.active = true
  `, [req.params.missionId]);
  if (!rows[0]) return error(res, 404, 'mission not found');
  return res.json(rows[0]);
});

app.post('/api/missions/:missionId/start', async (req, res) => {
  const playerId = String(req.body?.playerId ?? 'prototype-player').trim();
  if (!playerId) return error(res, 400, 'playerId is required');

  const mission = await pool.query(`
    SELECT id, time_limit_seconds, total_checkpoints, reward_xp, reward_coins
      FROM missions WHERE id = $1 AND active = true
  `, [req.params.missionId]);
  if (!mission.rows[0]) return error(res, 404, 'mission not found');

  const active = await pool.query(`
    SELECT id FROM mission_attempts
     WHERE mission_id = $1 AND player_id = $2 AND status = 'active'
       AND started_at > now() - interval '2 minutes'
     ORDER BY started_at DESC LIMIT 1
  `, [req.params.missionId, playerId]);
  if (active.rows[0]) return error(res, 409, 'player already has an active attempt');

  const attempt = await pool.query(`
    INSERT INTO mission_attempts (mission_id, player_id)
    VALUES ($1, $2)
    RETURNING id, started_at
  `, [req.params.missionId, playerId]);

  return res.status(201).json({
    attemptId: attempt.rows[0].id,
    startedAt: attempt.rows[0].started_at,
    timeLimitSeconds: mission.rows[0].time_limit_seconds,
    totalCheckpoints: mission.rows[0].total_checkpoints,
    rewardXp: mission.rows[0].reward_xp,
    rewardCoins: mission.rows[0].reward_coins,
  });
});

app.post('/api/missions/:missionId/attempts/:attemptId/checkpoints', async (req, res) => {
  const sequence = Number(req.body?.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) return error(res, 400, 'sequence must be a positive integer');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const attempt = await client.query(`
      SELECT a.id, a.last_checkpoint, a.status, a.started_at,
             m.total_checkpoints, m.time_limit_seconds
        FROM mission_attempts a
        JOIN missions m ON m.id = a.mission_id
       WHERE a.id = $1 AND a.mission_id = $2
       FOR UPDATE
    `, [req.params.attemptId, req.params.missionId]);
    if (!attempt.rows[0]) {
      await client.query('ROLLBACK');
      return error(res, 404, 'attempt not found');
    }

    const row = attempt.rows[0];
    if (row.status !== 'active') {
      await client.query('ROLLBACK');
      return error(res, 409, 'attempt is not active');
    }

    const startedAt = new Date(row.started_at).getTime();
    const elapsed = (nowMs() - startedAt) / 1000;
    if (elapsed > Number(row.time_limit_seconds)) {
      await client.query(`UPDATE mission_attempts SET status='failed', failure_reason='time_expired' WHERE id=$1`, [req.params.attemptId]);
      await client.query('COMMIT');
      return error(res, 409, 'time expired');
    }

    const expected = Number(row.last_checkpoint) + 1;
    if (sequence !== expected) {
      await client.query('ROLLBACK');
      return error(res, 409, `expected checkpoint ${expected}`);
    }

    await client.query(`INSERT INTO checkpoint_events (attempt_id, sequence) VALUES ($1, $2)`, [req.params.attemptId, sequence]);
    await client.query(`UPDATE mission_attempts SET last_checkpoint=$1 WHERE id=$2`, [sequence, req.params.attemptId]);

    await client.query('COMMIT');
    return res.json({ ok: true, sequence, completedCheckpoints: sequence, remainingSeconds: Math.max(0, Number(row.time_limit_seconds) - elapsed) });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return error(res, 500, 'checkpoint failed');
  } finally {
    client.release();
  }
});

app.post('/api/missions/:missionId/attempts/:attemptId/finish', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const attempt = await client.query(`
      SELECT a.*, m.total_checkpoints, m.time_limit_seconds,
             m.reward_xp, m.reward_coins, m.reward_type, m.reward_value,
             m.reward_valid_hours, m.brand_id
        FROM mission_attempts a
        JOIN missions m ON m.id = a.mission_id
       WHERE a.id = $1 AND a.mission_id = $2
       FOR UPDATE
    `, [req.params.attemptId, req.params.missionId]);
    if (!attempt.rows[0]) {
      await client.query('ROLLBACK');
      return error(res, 404, 'attempt not found');
    }

    const row = attempt.rows[0];
    if (row.status !== 'active') {
      await client.query('ROLLBACK');
      return error(res, 409, 'attempt is not active');
    }

    const elapsed = (nowMs() - new Date(row.started_at).getTime()) / 1000;
    const complete = Number(row.last_checkpoint) === Number(row.total_checkpoints);
    const inTime = elapsed <= Number(row.time_limit_seconds);

    if (!complete || !inTime) {
      await client.query(`UPDATE mission_attempts SET status='failed', finished_at=now(), failure_reason=$1 WHERE id=$2`, [!complete ? 'not_all_checkpoints' : 'time_expired', req.params.attemptId]);
      await client.query('COMMIT');
      return error(res, 409, !complete ? 'not all checkpoints completed' : 'time expired');
    }

    const code = `AL60-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
    const valueText = `${row.reward_value}% discount`;

    const reward = await client.query(`
      INSERT INTO rewards (
        attempt_id, player_id, brand_id, reward_type, value_text,
        redemption_code, expires_at
      )
      VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval)
      RETURNING id, redemption_code, value_text, expires_at
    `, [req.params.attemptId, row.player_id, row.brand_id, row.reward_type, valueText, code, row.reward_valid_hours]);

    await client.query(`UPDATE mission_attempts SET status='won', finished_at=now() WHERE id=$1`, [req.params.attemptId]);
    await client.query('COMMIT');

    return res.json({
      ok: true,
      status: 'won',
      elapsedSeconds: elapsed,
      rewardXp: row.reward_xp,
      rewardCoins: row.reward_coins,
      reward: reward.rows[0]
    });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    return error(res, 500, 'finish failed');
  } finally {
    client.release();
  }
});

app.get('/api/rewards/:code', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT r.redemption_code, r.value_text, r.status, r.expires_at, r.redeemed_at,
           b.name AS brand_name
      FROM rewards r
      JOIN brands b ON b.id = r.brand_id
     WHERE r.redemption_code = $1
  `, [req.params.code]);
  if (!rows[0]) return error(res, 404, 'reward not found');
  const reward = rows[0];
  if (reward.status === 'available' && new Date(reward.expires_at).getTime() < nowMs()) {
    await pool.query(`UPDATE rewards SET status='expired' WHERE redemption_code=$1 AND status='available'`, [req.params.code]);
    reward.status = 'expired';
  }
  return res.json(reward);
});

app.post('/api/rewards/:code/redeem', async (req, res) => {
  // DEV ONLY: production must require authenticated brand/staff credentials.
  const result = await pool.query(`
    UPDATE rewards
       SET status='redeemed', redeemed_at=now()
     WHERE redemption_code=$1 AND status='available' AND expires_at > now()
    RETURNING redemption_code, value_text, status, redeemed_at
  `, [req.params.code]);
  if (!result.rows[0]) return error(res, 409, 'reward invalid, expired, or already redeemed');
  return res.json(result.rows[0]);
});

app.listen(port, () => {
  console.log(`ALMATY 60 backend listening on http://127.0.0.1:${port}`);
});
