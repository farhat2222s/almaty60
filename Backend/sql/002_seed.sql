INSERT INTO brands (id, name, slug)
VALUES ('demo-brand', 'ALMATY 60 Demo Brand', 'demo-brand')
ON CONFLICT (id) DO NOTHING;

INSERT INTO missions (
  id, brand_id, title, description, time_limit_seconds, total_checkpoints,
  reward_xp, reward_coins, reward_type, reward_value, reward_valid_hours
)
VALUES (
  'm_demo_60_checkpoint_run',
  'demo-brand',
  '60 Second Checkpoint Run',
  'Пройди 5 контрольных точек по порядку за 60 секунд.',
  60,
  5,
  500,
  300,
  'discount',
  20,
  48
)
ON CONFLICT (id) DO NOTHING;
