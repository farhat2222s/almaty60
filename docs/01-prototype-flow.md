# Prototype flow

1. Player enters the `AL60MissionStartActor` trigger.
2. Unreal calls `POST /api/missions/m_demo_60_checkpoint_run/start`.
3. Backend stores `started_at` and returns `attemptId` + mission rules.
4. Five `AL60CheckpointActor` instances are placed in order.
5. Each overlap calls the backend.
6. Backend locks the attempt row, checks server time and expected checkpoint sequence, then records the event.
7. After checkpoint 5, Unreal calls `/finish`.
8. Backend verifies all checkpoints and the server elapsed time <= 60 seconds.
9. Backend atomically marks the attempt `won` and creates a unique real-world reward code.
10. A future brand/staff app will scan the reward and call `/redeem`.

## Test acceptance criteria

- Starting the same mission twice while an active attempt exists returns HTTP 409.
- Checkpoint 2 before checkpoint 1 returns HTTP 409.
- Finish before all 5 checkpoints returns HTTP 409.
- Finish after server-side 60 seconds returns HTTP 409.
- A successful finish creates exactly one reward for the attempt.
- A reward can be redeemed once; the second redemption returns HTTP 409.
