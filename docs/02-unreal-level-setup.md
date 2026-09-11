# Unreal level setup

## Create the first playable scene

1. In UE 5.8, open the project.
2. Create/open a blank level called `AL60Prototype` under `Content/Maps`.
3. Add a floor plane (or any temporary environment mesh).
4. Add `Player Start`.
5. Add one `AL60MissionStartActor` at the spawn area.
6. Add five `AL60CheckpointActor` actors.
7. Set each checkpoint `Sequence` to 1, 2, 3, 4, 5.
8. Place them 100–300 Unreal units apart for the first test.
9. Press Play and walk into the mission start trigger.
10. The HUD should show the 60-second state and checkpoint count.

## Temporary visual language

The actors intentionally use the engine BasicShapes cube so the prototype has visible mission markers without requiring third-party assets.

Replace these with branded 3D props later.
