# Nostrmon 3D — architecture & module contracts

The 3D client (`3d.html` → `src/three/main3d.js`) is a second front-end for the same game. It reuses the shared
core (`src/core/game.js`): Nostr identity + saves, Yjs presence/chat/PvP/gifts/rare spawns, battle rules
(`src/battle.js`), creature data (`src/data/*`), menus (`src/menus.js`) and generic UI (`src/ui.js`).
It replaces three things: the overworld renderer (`World3D`), the battle presentation (`BattleUI3D`) and touch controls.
2D and 3D clients share the same Yjs room, so 2D players and 3D players see each other, chat and can PvP.

Tech: **three r186** (`import * as THREE from 'three'`, addons via `'three/addons/...'`, e.g.
`three/addons/renderers/CSS2DRenderer.js`, `three/addons/utils/BufferGeometryUtils.js`). No other new npm deps.
**No external assets** — every model, texture and effect is procedural (geometry + canvas textures + shaders).
Visual direction: bright cel-shaded "toy diorama" — `MeshToonMaterial` with the shared 4-step gradient and
dark ink outlines (`src/three/materials.js`), saturated but soft palette, warm sunlight, soft shadows.

## Coordinates (everyone must follow)

- 1 world unit = 1 map tile. Map tile `(x, y)` (column, row) spans X∈[x, x+1), Z∈[y, y+1); its center is `(x+0.5, 0, y+0.5)`.
- Y is up; ground is y = 0. Map covers X∈[0, map.w], Z∈[0, map.h].
- "Continuous tile coords" `(px, py)` used by World3D / Wilds / presence are the same numbers as world `(X, Z)`.
  Tile index = `Math.floor(px), Math.floor(py)`.
- Facing / heading `ry` = model `rotation.y`. Models face **+Z at ry = 0**. Direction vector = `(sin ry, cos ry)` in (X, Z).
  2D dirs: `down` = +Z (ry 0), `up` = −Z (ry π), `right` = +X (ry π/2), `left` = −X (ry −π/2).
- Default camera sits south (+Z) of the player looking north (−Z), so map "up" is screen-forward, matching the 2D version.
  Doors of all buildings are on their south (+Z) face.

## Data you consume (read-only)

`src/data/maps.js` → `MAPS[id]` (ids: `town`, `route1`, `village`, `forest`):
```
{ id, name, w, h, tiles: string[] (rows; chars below), solid: Uint8Array(w*h) (1 = blocked, includes buildings/trees/water/fences/rocks/signs),
  bg: '#hex' (void colour), battleBg: 'meadow'|'lake'|'forest', dark?: true (forest), spawn?: true, start?, respawn?,
  signs: { 'x,y': text }, buildings: [{ x, y, w, h, kind: 'house'|'center'|'shop', roof: '#hex', label, door: [dx, dy], action, lines? }],
  npcs: [{ id, x, y, dir, name, look, lines, after?, trainer?: { team, reward } }],
  warps: [{ x, y, w, h, to, tx, ty, dir }], wild: { min, max, table: [[speciesId, weight], ...] } | null, grassTiles: [[x, y], ...] }
```
Tile chars: `.` grass, `,` tall grass, `=` dirt path, `p` stone plaza, `~` water, `s` sand, `T` tree, `f` flowers, `#` fence,
`r` rock, `S` sign, `B` wooden pier/bridge (walkable, over water). `tileAt(map, x, y)` is exported.
Building rectangles are solid; the door tile `door` is on the building's bottom row (south face).

`src/data/species.js` → `SPECIES[id] = { no, name, types, base, look, desc, ... }`. `look`:
```
{ body: 'round'|'oval'|'long'|'wide'|'pear'|'tall'|'ghost'|'fish'|'bird', c1 (main), c2 (belly/secondary), c3 (accent),
  ears: 'fox'|'cat'|'pointy'|'bunny'|'round'|'frog'|'leaf'|'bush'|'tuft'|'antenna'|'horns'|'fin'|'none',
  tail: 'flame'|'bolt'|'puff'|'curl'|'feather'|'fish'|'none', eyes: 'normal'|'big'|'sleepy'|'fierce'|'glow',
  extra: subset of ['cheeks','mane','shell','bubble','crest','wings','rocky','arms','cap','tongue','crystal','beetle','moth','dragonwings','stripes','claws','nose'],
  cheek?: '#hex' }
```
The 2D sprite painter `src/render/sprites.js` (`drawCreature`) is the visual reference for how each part looks.
Shiny = every look colour hue-rotated 150° (`hueRotate` from `src/three/materials.js`).

Trainer look `{ skin, hair, shirt, pants, hat: 0 none|1 cap|2 beanie, hatColor }` = indices into
`SKIN, HAIR, SHIRT, PANTS, HATC` exported by `src/render/sprites.js`.

`src/data/moves.js` → `MOVES[id] = { name, type, power (0 = status), acc, pri?, effect? }`; `src/data/types.js` → `TYPES[type] = { name, color }`.
Types: normal fire water grass electric ice rock ground flying bug ghost psychic dragon.

## Shared core API (`game`, from `src/core/game.js`) available to World3D / controls / battle UI

- `game.save` — `{ name, look, party: [{ uid, sp, lv, hp, shiny, nick, moves }], beaten: { npcId: true }, pos, ... }`
- `game.signer.pubkey`, `game.ready` (bool)
- `game.net.players()` → remote players `[{ cid, pk, name, look, map, x, y, dir, lead: { sp, shiny } | null, busy, client?, fx?, fy?, ry?, moving?, emote? }]`
  (x, y = integer tiles; fx/fy/ry only from 3D clients). `game.net.setPresence(patch)`, `game.net.isVerified(p)`, `game.net.cid`.
- `game.bubbles: Map<pubkey, { text, t, map }>` — show chat bubble while `Date.now() - t < 7000` and `map === current map`.
- `game.emotes: Map<cid, { e, t }>` — show emoji while `Date.now() - t < 2500`. Local player's key is `game.net.cid`.
- `game.captureKey(e)` — **call first in every keydown handler; if it returns true, ignore the key.**
- `game.isBusy()` — dialog / modal / battle / lock active → no movement, no interaction.
- `game.openPlayer(playerState)`, `game.talkNpc(npc)` (async; mutates `npc.dir` to face the player — re-read it every frame),
  `game.say(lines, name?)` (async; use for signs), `game.enterBuilding(building)`,
  `game.warp(mapId, x, y, dir)` (core calls `world.loadMap` itself), `game.onArrive(x, y, tileChar)` (call when the player's tile changes;
  handles rare-spawn contact and save position), `game.spawnsOn(mapId)` → rare spawns `[{ id, x, y, sp, lv, shiny, by, byName }]` (tile ints),
  `game.engageWild(wild)` (async; claims + starts battle), `game.leadInfo()` → `{ sp, shiny } | null`, `game.wilds` (Wilds instance).
- The core calls on the world: `world.loadMap(id, x, y, dir)`, `world.sendPresence()`, `world.interact()`, `world.setPaused(bool)`
  (true when a battle overlay opens, false when it closes), `world.held = []` (**meaning: clear all current movement input**),
  `world.path = null`, `world.running`, and reads `world.map`, `world.p.x`, `world.p.y`, `world.p.dir`.

## Module contracts and ownership

Each file has exactly one owner. Do not edit files you do not own; code against these contracts.
Each module that needs CSS imports its own stylesheet (`import './world3d.css'`) — Vite bundles it.

### `src/three/materials.js` (done, shared)
`toonMat(color, { emissive, transparent, opacity, side, unique, vertexColors })` (cached/shared unless `unique`), `outlineMat(thickness)`,
`addOutline(mesh, thickness)` (adds an inverted-hull child; works for InstancedMesh), `gradientMap()`, `disposeTree(root)`,
`hueRotate(hex, deg)`, `shade(hex, amt)`, `OUTLINE_COLOR`.

### `src/three/models.js` — creatures, trainers, balls
```
buildCreature(sp, { shiny = false, flash = false } = {}) → THREE.Group
  userData.height          // ≈ 1.0 — model normalised so its bounding-box height is ~1 unit at scale 1
  userData.radius          // footprint radius at scale 1 (for spacing)
  userData.animate(t, state)   // t seconds; state { moving?: bool, speed?: 0..1, action?: 'idle'|'attack'|'hurt'|'happy'|'faint', actionT?: 0..1 }
  userData.setFlash(amount 0..1, color = 0xffffff)   // emissive tint; only works when built with flash: true (unique materials)
  userData.parts           // { body, head?, eyes: [], tail?, ... } named sub-objects
  userData.dispose()
  feet at y = 0, centred on origin, face toward +Z
buildTrainer(look) → THREE.Group   // ≈ 1.15 tall, feet at y = 0, faces +Z
  userData.animate(t, { speed })   // speed 0 idle, ~0.5 walk, 1 run — arm/leg swing, bob
  userData.dispose()
buildBall(kind = 'ball' | 'great' | 'ultra') → THREE.Group   // radius ≈ 0.12, gem faces +Z; userData.dispose()
```
Must be cheap to instantiate repeatedly (cache geometries/material templates per species+shiny; share when `flash` is false).

### `src/three/terrain.js` — static world from a map
```
buildTerrain(map) → { group: THREE.Group, update(t, playerPos: THREE.Vector3), labelAnchors: [{ x, y, z, text, kind: 'building' }], dispose() }
```
Ground, paths, plaza, sand, water (animated shader), tall grass (instanced blades, wind sway + bend away from playerPos),
trees (instanced), flowers, fences, rocks, signs, pier, buildings (walls, gable roof in `roof` colour, door + frame on the
door tile's south face, windows, emblem for center/shop), town fountain, plus scenery outside the map bounds so edges never show a void.
`map.dark` → darker forest palette. Everything casts/receives shadows sensibly. Target < 150 draw calls per map.

### `src/core/wilds.js` — visible wild creatures (renderer-agnostic, deterministic)
```
new Wilds(game)
list(mapId, now = Date.now()) → [{ id, map, sp, lv, shiny, x, y, heading, moving, battlingBy }]
   // x, y continuous tile coords; heading = ry convention; battlingBy = name of the player fighting it, or null
async engage(w) → boolean      // claim through own awareness field `battling`, tie-break by lowest clientID
release(id)                    // clear own claim
markGone(id, reason)           // caught / defeated: hide for everyone, respawn later
```
Positions are a pure function of (map, slot, generation, time) so every client computes the same herd without
network traffic; only removals (`Y.Map 'wildGone'`) and claims (awareness) are synced.

### `src/three/world3d.js` — overworld (implements the World interface above)
```
new World3D(game, canvas)        // canvas = #world
loadMap(id, x, y, dir), sendPresence(), interact(), setPaused(bool), setJoystick(x, y) /* x right+, y forward+ in [-1,1] */,
press(dir, down) /* optional keyboard-style input */, fields: map, p { x, y, dir }, held (setter clears input), path, running
```
Renders terrain, player + follower (party lead), NPCs (+ "!" for unbeaten trainers), remote players (+ followers),
wild creatures from `game.wilds.list`, rare spawns from `game.spawnsOn`, CSS2D labels (names ✓, chat bubbles, emotes,
building labels from `terrain.labelAnchors`), third-person orbit camera, keyboard + pointer + joystick movement with
tile collision, interactions, warps with a fade, presence at ≤10 Hz: `{ map, x, y, dir, fx, fy, ry, moving }`.

### `src/three/controls3d.js` — touch controls
`setupControls3D(game)`: on touch devices builds a virtual joystick + A (interact / advance dialog / skip battle text) + B (hold to run)
inside `#touch3d`, driving `game.world.setJoystick(x, y)`, `game.world.interact()`, `game.world.running`.

### `src/three/battleUI3d.js` + `src/three/battleStage.js` — 3D battle presentation
`class BattleUI3D extends BattleUI` (from `src/battleUI.js`) overriding only the presentation hooks:
`stageEnter(cfg)`, `stageExit()`, `showMon(side, idx, anim)`, `hideMon(side)`, `fxRecall(side)`, `fxMove(side, moveId)`,
`fxHit(side, e)`, `fxMiss(side)`, `fxFaint(side)`, `fxStat(side, stat, up)`, `fxHeal(side)`, `fxBall(e)`.
The base class keeps the turn loop, menus, message box and HP bars. Renders into `#b-3d` inside `#b-scene`.

## DOM available in `3d.html`

`#world` (overworld canvas), `#hud-left`, `#hud-right`, `#map-banner`, `#party-bar`, `#chat`, `#touch3d` (empty),
`#dialog`, `#toasts`, `#modal-wrap`, `#battle` > `#b-scene` > `#b-3d` (battle canvas), `#b-foe-info`, `#b-me-info`, `#b-fx` (empty
overlay for battle DOM effects), `#b-top`; `#b-bottom` > `#b-msg`, `#b-menu`. Hidden legacy `#b-foe`, `#b-me`, `#b-ball`
exist only so base-class code never hits null. `#loading` is removed when the game is ready.
Base stylesheet: `src/style.css` (tokens: `--ink #1c1a2e`, `--paper #f5f7fb`, `--coral #ff5a5f`, `--gold #ffc43d`,
`--teal #1fb5a3`, `--nostr #8e5cf7`, `--sky #2f9df4`; fonts `--display` ZCOOL QingKe HuangYou, `--body` Noto Sans SC, `--mono` Silkscreen).
HUD z-index 5–7, dialog 20, battle 25, modal 30, toasts 40 — overworld labels must stay below 5.

## Quality bar

- 60 fps on a laptop iGPU; `renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`; instancing for repeated props; no per-frame allocations in hot loops.
- Dispose GPU resources you create when they are no longer used (map switch, battle end).
- Works at phone size (375×812) with touch; nothing overlaps HUD.
- Chinese UI text, consistent with the 2D client.
