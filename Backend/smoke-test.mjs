const base = process.env.BASE_URL || 'http://127.0.0.1:3000';
const mission = 'm_demo_60_checkpoint_run';
const playerId = `smoke-${Date.now()}`;

async function call(path, options = {}) {
  const response = await fetch(base + path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const json = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json)}`);
  return json;
}

const health = await call('/api/health');
console.log('health:', health);

const start = await call(`/api/missions/${mission}/start`, {
  method: 'POST',
  body: JSON.stringify({ playerId }),
});
console.log('start:', start);

for (let i = 1; i <= 5; i++) {
  const checkpoint = await call(`/api/missions/${mission}/attempts/${start.attemptId}/checkpoints`, {
    method: 'POST',
    body: JSON.stringify({ sequence: i }),
  });
  console.log('checkpoint:', checkpoint);
}

const finish = await call(`/api/missions/${mission}/attempts/${start.attemptId}/finish`, { method: 'POST' });
console.log('finish:', finish);

const rewardCode = finish.reward.redemption_code ?? finish.reward.redemptionCode;
const reward = await call(`/api/rewards/${rewardCode}`);
console.log('reward:', reward);

const redeemed = await call(`/api/rewards/${rewardCode}/redeem`, { method: 'POST' });
console.log('redeemed:', redeemed);

let secondRedeemRejected = false;
try {
  await call(`/api/rewards/${rewardCode}/redeem`, { method: 'POST' });
} catch (e) {
  secondRedeemRejected = true;
  console.log('second redemption rejected:', e.message);
}
if (!secondRedeemRejected) throw new Error('second redemption should be rejected');
console.log('SMOKE TEST PASSED');
