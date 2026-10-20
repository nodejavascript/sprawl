# SPRAWL

**Nothing is built until you arrive.**

A city exists only as far ahead as you can see it. Fly through it, and the skyline rises out of
the ground a row at a time — the towers do not exist until you are close enough to need them.
What you do is the proof of the belief: an endless city is not a map, it is an act of attention.

Live at **https://sprawl.nodejavascript.com/**.

A 2D and 3D game in **one canvas**, built with [LittleJS](https://littlejsengine.com) 1.27.

## Why it is built this way

LittleJS 1.27 added a full 3D renderer that shares the canvas with the 2D layer. This is that
promise in one screen:

- **3D** — the hull, the towers, the lights, the shadows, the fog, the sky, the bloom, the particle
  exhaust and the trail.
- **2D** — the score, the shield, the speed, the boost bar and the radar ring, drawn by the ordinary
  LittleJS 2D canvas over the live 3D scene.

The city is **four instanced draw calls** no matter how many buildings are on screen: tower bodies,
roof lights, neon edge strips and lit windows.

## Play

| Key | Action |
|---|---|
| ← → | steer |
| ↑ ↓ | climb and dive |
| Space | boost (hold) |
| M | mute |
| R | restart after a crash |

Collect the glowing shards. Three hits and the city is lost.

## Run it

```bash
npm run serve      # http://127.0.0.1:4355/
npm test           # the page's own rules + the consent gate in a stub DOM
npm run test:e2e   # the gate in a real browser: no request to Google before a yes
npm run test:live  # against the deployed site
```

## How it works

- `site/game.js` — everything: the ship, the city, the shards, the camera, the HUD.
- `site/littlejs.min.js` — the LittleJS 1.27.1 release build, vendored so the game runs offline
  and from a file.
- The city keeps `ROWS × COLS` buildings alive. A row the ship passes is rebuilt far ahead with
  fresh heights, and **grows** over about half a second, so the skyline visibly rises as it comes
  into range.
- Collision is an axis-aligned box test against the rows near the ship.
- The floor is a dark slab that follows the ship, with the neon grid drawn as lines in the opaque
  3D pass.

## Licence

Game code: MIT. LittleJS is MIT — © Killed By A Pixel.
