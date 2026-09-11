# Character source

Casual Character by Quaternius — public domain, CC0.

- Model page: https://poly.pizza/m/kZ3DmIoGip
- Creator's pack and license: https://quaternius.com/packs/ultimatemodularcharacters.html
- Downloaded GLB: https://static.poly.pizza/90a9e2d4-053f-42f1-99a2-8f5e1180ea7f.glb
- Retrieved 2026-09-09. 1,430,660 bytes. 24 bundled animations.

The game uses Idle, Idle_Neutral, Walk and Run. Outfit colours and procedural backpack are modified for ALMATY60. Jump uses a pose adjustment and the existing game trajectory; there is no imported jump animation. This is a stylized character, not a scan of a person.

GLTFLoader and BufferGeometryUtils use Three.js r180 under MIT, alongside the existing Three.js license in vendor/.

# Parked cars

Car Kit 3.1 by Kenney (www.kenney.nl) — public domain, CC0. Downloaded 2026-09-09 from https://kenney.nl/assets/car-kit.
Files: assets/models/kenney-cars/{sedan,sedan-sports,hatchback-sports,suv,suv-luxury,taxi,van,delivery}.glb plus Textures/colormap.png.
Full license text: assets/models/kenney-cars/LICENSE-kenney-car-kit.txt. Models are scenery only (no collision, no driving).

# Post-processing

Three.js r180 addons (EffectComposer, RenderPass, SSAOPass, UnrealBloomPass, OutputPass, shaders, SimplexNoise, SkeletonUtils,
DRACOLoader) in vendor/addons — MIT, same license file as vendor/THREE-LICENSE.txt. Bare `three` imports were rewritten to the
local three.module.js so the game keeps working offline and in Node tests.

# Map library

Leaflet 1.9.4 (BSD-2-Clause) in vendor/leaflet with its LICENSE. Raster tiles come from tile.openstreetmap.org at runtime under the OSM tile usage policy; data © OpenStreetMap contributors, ODbL.
