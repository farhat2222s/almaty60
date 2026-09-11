import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT ?? 3000);
const mission = {
  id: 'm_demo_60_checkpoint_run',
  brandName: 'ALMATY 60 Demo Brand',
  title: '60 Second Checkpoint Run',
  description: 'Пройди 5 контрольных точек по порядку за 60 секунд.',
  timeLimitSeconds: 60,
  totalCheckpoints: 5,
  rewardXp: 500,
  rewardCoins: 300,
  rewardType: 'discount',
  rewardValue: 20,
  rewardValidHours: 48,
};

const attempts = new Map();
const rewards = new Map();

function json(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(out) });
  res.end(out);
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function route(req) {
  const u = new URL(req.url, `http://${req.headers.host}`);
  return { path: u.pathname.split('/').filter(Boolean), query: u.searchParams };
}

function attemptJson(a) {
  return {
    attemptId: a.id,
    startedAt: a.startedAt,
    timeLimitSeconds: mission.timeLimitSeconds,
    totalCheckpoints: mission.totalCheckpoints,
    rewardXp: mission.rewardXp,
    rewardCoins: mission.rewardCoins,
  };
}

const server = http.createServer(async (req, res) => {
  try {
    const { path } = route(req);
    if (req.method === 'GET' && path.join('/') === 'api/health') {
      return json(res, 200, { ok: true, service: 'almaty60-dev-server', database: 'in-memory' });
    }

    if (req.method === 'GET' && path[0] === 'api' && path[1] === 'missions' && path[2]) {
      if (path[2] !== mission.id) return json(res, 404, { error: 'mission not found' });
      return json(res, 200, mission);
    }

    if (req.method === 'POST' && path.length === 4 && path[0] === 'api' && path[1] === 'missions' && path[3] === 'start') {
      if (path[2] !== mission.id) return json(res, 404, { error: 'mission not found' });
      const data = await body(req);
      const playerId = String(data.playerId ?? 'prototype-player').trim();
      for (const a of attempts.values()) {
        if (a.playerId === playerId && a.status === 'active' && Date.now() - a.startedMs < 120000) {
          return json(res, 409, { error: 'player already has an active attempt' });
        }
      }
      const a = {
        id: randomUUID(), playerId, startedMs: Date.now(), startedAt: new Date().toISOString(),
        lastCheckpoint: 0, status: 'active', failureReason: null,
      };
      attempts.set(a.id, a);
      return json(res, 201, attemptJson(a));
    }

    if (req.method === 'POST' && path.length === 6 && path[0] === 'api' && path[1] === 'missions' && path[3] === 'attempts' && path[5] === 'checkpoints') {
      if (path[2] !== mission.id) return json(res, 404, { error: 'mission not found' });
      const a = attempts.get(path[4]);
      if (!a) return json(res, 404, { error: 'attempt not found' });
      if (a.status !== 'active') return json(res, 409, { error: 'attempt is not active' });
      if ((Date.now() - a.startedMs) / 1000 > mission.timeLimitSeconds) {
        a.status = 'failed';
        a.failureReason = 'time_expired';
        return json(res, 409, { error: 'time expired' });
      }
      const data = await body(req);
      const sequence = Number(data.sequence);
      if (!Number.isInteger(sequence)) return json(res, 400, { error: 'sequence must be an integer' });
      const expected = a.lastCheckpoint + 1;
      if (sequence !== expected) return json(res, 409, { error: `expected checkpoint ${expected}` });
      a.lastCheckpoint = sequence;
      const remainingSeconds = Math.max(0, mission.timeLimitSeconds - (Date.now() - a.startedMs) / 1000);
      return json(res, 200, { ok: true, sequence, completedCheckpoints: sequence, remainingSeconds });
    }

    if (req.method === 'POST' && path.length === 6 && path[0] === 'api' && path[1] === 'missions' && path[3] === 'attempts' && path[5] === 'finish') {
      if (path[2] !== mission.id) return json(res, 404, { error: 'mission not found' });
      const a = attempts.get(path[4]);
      if (!a) return json(res, 404, { error: 'attempt not found' });
      if (a.status !== 'active') return json(res, 409, { error: 'attempt is not active' });
      const elapsedSeconds = (Date.now() - a.startedMs) / 1000;
      if (a.lastCheckpoint !== mission.totalCheckpoints) return json(res, 409, { error: 'not all checkpoints completed' });
      if (elapsedSeconds > mission.timeLimitSeconds) {
        a.status = 'failed';
        return json(res, 409, { error: 'time expired' });
      }
      const code = `AL60-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`;
      const reward = {
        id: randomUUID(), attemptId: a.id, playerId: a.playerId, brandName: mission.brandName,
        redemptionCode: code, valueText: `${mission.rewardValue}% discount`, status: 'available',
        expiresAt: new Date(Date.now() + mission.rewardValidHours * 3600 * 1000).toISOString(),
      };
      rewards.set(code, reward);
      a.status = 'won';
      return json(res, 200, { ok: true, status: 'won', elapsedSeconds, rewardXp: mission.rewardXp, rewardCoins: mission.rewardCoins, reward });
    }

    if (req.method === 'GET' && path.length === 3 && path[0] === 'api' && path[1] === 'rewards') {
      const reward = rewards.get(path[2]);
      if (!reward) return json(res, 404, { error: 'reward not found' });
      if (reward.status === 'available' && Date.now() > Date.parse(reward.expiresAt)) reward.status = 'expired';
      return json(res, 200, reward);
    }

    if (req.method === 'POST' && path.length === 4 && path[0] === 'api' && path[1] === 'rewards' && path[3] === 'redeem') {
      const reward = rewards.get(path[2]);
      if (!reward || reward.status !== 'available' || Date.now() > Date.parse(reward.expiresAt)) {
        return json(res, 409, { error: 'reward invalid, expired, or already redeemed' });
      }
      reward.status = 'redeemed';
      reward.redeemedAt = new Date().toISOString();
      return json(res, 200, reward);
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'internal server error' });
  }
});

server.listen(port, () => console.log(`ALMATY 60 dev backend: http://127.0.0.1:${port}`));
