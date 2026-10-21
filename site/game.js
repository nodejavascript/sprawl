'use strict';
/*
    SPRAWL
    An endless neon city that is only built as far ahead as you can see.

    Built on LittleJS 1.27, where 2D and 3D share one canvas:
    - the city is one instanced 3D draw call, rebuilt row by row as you reach it
    - the ship, the shards, the lights, the fog, the shadows and the bloom are 3D
    - the HUD, the radar and the overlays are the ordinary 2D LittleJS layer on top
*/

///////////////////////////////////////////////////////////////////////////////
// tuning

const ROWS = 40;             // how many rows of city exist at once
const COLS = 19;             // buildings across the corridor
const ROW_GAP = 22;          // world units between rows along Z
const COL_GAP = 14;          // world units between columns along X
const CORRIDOR = 118;        // how far the ship may drift sideways
const CEILING = 72;          // and how high
const SHARDS = 64;           // glowing pickups alive at once
const GROW_RATE = 2.2;       // how fast a new row rises out of the ground

const SKY_TOP = hsl(.72, .9, .02);
const SKY_HORIZON = hsl(.79, .8, .22);
const SKY_BOTTOM = hsl(.74, .7, .02);
const CAM_BACK = 17.5;
const CAM_UP = 5.6;

///////////////////////////////////////////////////////////////////////////////
// scene state

let ship, shipMesh, shipLight, exhaust, trail;
let ground, cityBodies, cityLights, cityEdges, cityWindows;
let cityRows = [];           // {z, heights[][], meta[][], grow}
let minRowZ = 0;
let shards = [];
let popups = [];
let camPos = vec3();
let state;

const soundPickup = new Sound([,,,.02,,.5,,3,,-50,40,,.05]);
const soundHit = new Sound([1,.05,55,.2,,.5,,2]);
const soundBoost = new Sound([.35,,190,.08,,.25,,2]);

const clampV = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;

///////////////////////////////////////////////////////////////////////////////
// the ship — a built mesh, a glowing cockpit and a light that flies with it

function makeShipMesh()
{
    const m = new Mesh();

    // hull
    m.combine(buildBox(vec3(1.5, .55, 4.2), .18),
        buildMatrix(vec3(0, 0, 0)), hsl(.6, .18, .82));

    // nose
    m.combine(buildCone(1.05, 2.0, 6),
        buildMatrix(vec3(0, .02, -2.9), vec3(-PI/2)), hsl(.58, .3, .7));

    // two swept wings
    for (const side of [-1, 1])
        m.combine(buildBox(vec3(3.6, .16, 1.25), .06),
            buildMatrix(vec3(side*2.05, -.02, .55), vec3(0, -side*.38, -side*.1)),
            hsl(.6, .25, .6));

    // tail fin
    m.combine(buildBox(vec3(.16, 1.15, 1.5), .05),
        buildMatrix(vec3(0, .62, 1.45), vec3(.28)), hsl(.58, .3, .55));

    return m;
}

function makeShip()
{
    ship = new EngineObject3D(vec3(0, 20, 0), shipMesh, undefined, hsl(.6, .3, .95));
    ship.scale3D = vec3(1.25);
    ship.specular = 1;
    ship.shininess = 90;
    ship.castShadow = true;

    // cockpit, lit from within
    const cockpit = new EngineObject3D(vec3(0, .36, -1.15), buildSphere(1.25, 16, 8), undefined, hsl(.52, 1, .55));
    cockpit.scale3D = vec3(.72, .5, 1.55);
    cockpit.emissive = 1;
    ship.addChild(cockpit);

    // engine glow
    const core = new EngineObject3D(vec3(0, 0, 2.15), buildCylinder(1.15, .5, 12), undefined, hsl(.52, 1, .6));
    core.rotation3D = vec3(PI/2);
    core.emissive = 1;
    ship.addChild(core);

    shipLight = new Light3D(vec3(0, .4, 2.2), 38, hsl(.52, 1, .62), 1.7);
    ship.addChild(shipLight);

    // exhaust: particle spray aimed backwards, plus a fading ribbon
    exhaust = new ParticleEmitter3D(vec3(0, 0, 2.4), .3, undefined, 55, .32, undefined,
        hsl(.52, 1, .78), hsl(.58, 1, .62), hsl(.62, 1, .5, 0), hsl(.7, 1, .4, 0),
        .4, .4, .04, .11, .97, 0, .6, .5, true);
    exhaust.rotation3D = vec3(PI/2);
    ship.addChild(exhaust);

    trail = new Trail3D(vec3(0, 0, 2.3), .5, .22, undefined,
        hsl(.53, 1, .72, .75), hsl(.62, 1, .5, 0), true);
    ship.addChild(trail);
}

///////////////////////////////////////////////////////////////////////////////
// the city — every building is an instance of one box

function makeCity()
{
    cityBodies = new InstancedMesh3D(render3D.boxMesh, ROWS*COLS);
    cityBodies.count = ROWS*COLS;
    cityBodies.fixedRadius = 1400;

    cityLights = new InstancedMesh3D(render3D.boxMesh, ROWS*COLS);
    cityLights.count = ROWS*COLS;
    cityLights.emissive = 1;         // the band on every roof shines on its own
    cityLights.fixedRadius = 1400;

    // two neon strips running up the front corners of every building
    cityEdges = new InstancedMesh3D(render3D.boxMesh, ROWS*COLS*2);
    cityEdges.count = ROWS*COLS*2;
    cityEdges.emissive = 1;
    cityEdges.fixedRadius = 1400;

    // three lit windows on the face every tower turns toward the camera
    cityWindows = new InstancedMesh3D(render3D.boxMesh, ROWS*COLS*3);
    cityWindows.count = ROWS*COLS*3;
    cityWindows.emissive = 1;
    cityWindows.fixedRadius = 1400;
}

function resetCity()
{
    minRowZ = -ROWS * ROW_GAP;
    for (let r = 0; r < ROWS; ++r)
    {
        cityRows[r] = { z: -r*ROW_GAP - 60, heights: [], meta: [], grow: 1 };
        fillRow(r, true);
    }
}

function fillRow(r, instant)
{
    const row = cityRows[r];
    const mid = (COLS - 1) / 2;
    for (let c = 0; c < COLS; ++c)
    {
        const keep = Math.abs(c - mid) > 1 && Math.random() < .66;
        row.heights[c] = keep ? 10 + Math.pow(Math.random(), 2.2) * 130 : 0;
        row.meta[c] = {
            w: 7 + Math.random()*6,
            d: 7 + Math.random()*6,
            hue: .52 + Math.random()*.31,
            lit: Math.random() < .88,
            win: [0, 1, 2].map(()=> ({ dx: rand(-2.4, 2.4), dy: rand(.12, .92) })),
        };
    }
    row.grow = instant ? 1 : 0;
    applyRow(r);
}

function applyRow(r)
{
    const row = cityRows[r];
    const ease = 1 - Math.pow(1 - row.grow, 3);

    for (let c = 0; c < COLS; ++c)
    {
        const i = r*COLS + c;
        const x = (c - (COLS-1)/2) * COL_GAP;
        const h = row.heights[c] * ease;
        const m = row.meta[c];

        if (h < .05)
        {
            cityBodies.setTransformAt(i, vec3(x, -50, row.z), vec3(), vec3(0));
            cityLights.setTransformAt(i, vec3(x, -50, row.z), vec3(), vec3(0));
            cityEdges.setTransformAt(i*2, vec3(x, -50, row.z), vec3(), vec3(0));
            cityEdges.setTransformAt(i*2 + 1, vec3(x, -50, row.z), vec3(), vec3(0));
            for (let k = 0; k < 3; ++k)
                cityWindows.setTransformAt(i*3 + k, vec3(x, -50, row.z), vec3(), vec3(0));
            continue;
        }

        cityBodies.setTransformAt(i, vec3(x, h/2, row.z), vec3(), vec3(m.w, h, m.d));
        cityBodies.setColorAt(i, hsl(m.hue, .32, .17 + (m.hue - .52)*.28));

        const band = m.lit ? 1 : 0;
        cityLights.setTransformAt(i, vec3(x, h - .4, row.z), vec3(),
            band ? vec3(m.w*1.04, .55, m.d*1.04) : vec3(0));
        if (band)
            cityLights.setColorAt(i, hsl(m.hue, .9, .55 + Math.random()*.15));

        // a pair of bright edges, so every tower has a lit outline
        const ex = m.w/2 + .06, ez = m.d/2 + .06;
        const edgeColor = hsl(m.hue, .85, .5);
        cityEdges.setTransformAt(i*2, vec3(x - ex, h/2, row.z - ez), vec3(), vec3(.3, h, .3));
        cityEdges.setTransformAt(i*2 + 1, vec3(x + ex, h/2, row.z - ez), vec3(), vec3(.3, h, .3));
        cityEdges.setColorAt(i*2, edgeColor);
        cityEdges.setColorAt(i*2 + 1, edgeColor);

        for (let k = 0; k < 3; ++k)
        {
            const win = m.win[k];
            const wy = win.dy * h;
            cityWindows.setTransformAt(i*3 + k,
                vec3(x + win.dx, Math.max(.6, wy), row.z + m.d/2 + .08), vec3(),
                h > 6 ? vec3(.55, 1.25, .18) : vec3(0));
            cityWindows.setColorAt(i*3 + k, hsl(.09, .85, .55 + (k === 0 ? .2 : .05)));
        }
    }
}

// a row the ship has passed is rebuilt far ahead, and grows as you arrive
function recycleCity()
{
    for (let r = 0; r < ROWS; ++r)
    {
        const row = cityRows[r];
        if (ship.pos3D.z < row.z - 50)
        {
            row.z = minRowZ;
            minRowZ -= ROW_GAP;
            fillRow(r, false);
        }
        else if (row.grow < 1)
        {
            row.grow = Math.min(1, row.grow + GROW_RATE*Math.min(timeDelta, .05));
            applyRow(r);
        }
    }
}

// what the ship can hit, checked against the boxes near it
function cityHit(pos)
{
    for (let r = 0; r < ROWS; ++r)
    {
        const row = cityRows[r];
        if (Math.abs(row.z - pos.z) > 16) continue;
        for (let c = 0; c < COLS; ++c)
        {
            const h = row.heights[c] * row.grow;
            if (h < 4 || pos.y > h + 1.4) continue;
            const m = row.meta[c];
            const x = (c - (COLS-1)/2) * COL_GAP;
            if (Math.abs(pos.x - x) < m.w/2 + 1.1 && Math.abs(pos.z - row.z) < m.d/2 + 1.4)
                return true;
        }
    }
    return false;
}

///////////////////////////////////////////////////////////////////////////////
// shards — the thing worth flying through a city for

function respawnShard(s, far)
{
    s.pos3D = vec3(rand(-CORRIDOR*.85, CORRIDOR*.85),
                   rand(12, CEILING*.92),
                   ship ? ship.pos3D.z - (far ? rand(80, 760) : rand(40, 260)) : rand(-900, -200));
    s.rotation3D = vec3(rand(0, PI), rand(0, PI), 0);
    s.phase = rand(0, PI*2);
    const hue = Math.random() < .6 ? .5 : (Math.random() < .5 ? .83 : .09);
    s.color = hsl(hue, 1, .62);
    s.children[0].color = hsl(hue, 1, .6);
}

function makeShards()
{
    for (let i = 0; i < SHARDS; ++i)
    {
        const s = new EngineObject3D(vec3(), render3D.sphereMesh, undefined, hsl(.5, 1, .62));
        s.scale3D = vec3(1.55);
        s.emissive = 1;
        s.castShadow = false;
        s.radius = 9999;
        const light = new Light3D(vec3(), 18, hsl(.5, 1, .6), 1.2);
        s.addChild(light);
        s.respawn = () => respawnShard(s, true);
        respawnShard(s, false);
        shards.push(s);
    }
}

function updateShards(dt)
{
    for (const s of shards)
    {
        s.rotation3D.y += dt*1.6;
        s.rotation3D.x += dt*.7;
        s.pos3D.y += Math.sin(time*1.7 + s.phase)*dt*3;

        if (s.pos3D.z > ship.pos3D.z + 30)
            respawnShard(s, true);

        if (state.phase === 'play' && s.pos3D.distance(ship.pos3D) < 3.6)
        {
            state.score += 25;
            state.flash = 1;
            soundPickup.play(undefined, .35);
            popups.push({ x: rand(-.12, .12), y: rand(-.05, .05), life: 1 });
            respawnShard(s, true);
        }
    }
}

///////////////////////////////////////////////////////////////////////////////
// setup

async function gameInit()
{
    // the game keeps its own 1280x720 frame and the page scales it to fit
    setCanvasFixedSize(vec2(1280, 720));

    // the 3D pass, then bloom so the neon actually glows
    new Render3DPlugin;
    postProcessBloom(.8, 1.5, 8);

    render3D.setSky(SKY_TOP, SKY_HORIZON, SKY_BOTTOM, .7);
    render3D.setFog(80, 420, SKY_HORIZON);
    render3D.sunDirection = vec3(-.5, .52, .82);
    render3D.sunColor = hsl(.07, 1, .92);
    render3D.shadows = true;
    render3D.shadowMapSize = 2048;
    render3D.shadowRange = 150;
    render3D.smoothShading = true;
    render3D.anisotropy = 8;

    render3D.camera.fov = 1.02;
    render3D.camera.far = 1400;

    // the floor is a dark slab that follows the ship, with the grid drawn on it
    ground = new EngineObject3D(vec3(0, -1, 0), buildBox(vec3(1)), undefined, hsl(.72, .6, .05));
    ground.scale3D = vec3(2400, 1, 2400);
    ground.receiveShadow = true;

    render3D.onRenderOpaque = () =>
    {
        if (render3D.shadowPass) return;
        const cx = Math.round(ship.pos3D.x/20)*20;
        const cz = Math.round(ship.pos3D.z/20)*20;
        for (let i = -22; i <= 22; ++i)
        {
            const x = cx + i*20, z = cz + i*20;
            const bright = i % 5 === 0 ? hsl(.55, 1, .55) : hsl(.62, .8, .22);
            render3D.drawLine(vec3(x, .06, cz - 440), vec3(x, .06, cz + 440), .12, bright);
            render3D.drawLine(vec3(cx - 440, .06, z), vec3(cx + 440, .06, z), .12, bright);
        }
    };

    makeCity();
    makeShards();
    shipMesh = makeShipMesh();
    makeShip();

    state = {
        phase: 'intro',
        score: 0,
        distance: 0,
        shield: 3,
        speed: 60,
        boost: 1,
        invulnerable: 0,
        flash: 0,
        hurt: 0,
        shake: 0,
        boostFired: false,
        best: +(localStorage.getItem('sprawl.best') || 0),
        muted: false,
    };

    resetCity();
    camPos = ship.pos3D.add(vec3(0, 6, 16));
    render3D.camera.pos = camPos;
    render3D.camera.lookAt(ship.pos3D);
}

///////////////////////////////////////////////////////////////////////////////
// update

function resetRun()
{
    state.phase = 'play';
    state.score = 0;
    state.distance = 0;
    state.shield = 3;
    state.speed = 60;
    state.boost = 1;
    state.invulnerable = 0;
    state.hurt = 0;
    ship.pos3D = vec3(0, 20, 0);
    ship.rotation3D = vec3();
    trail.clear();
    popups.length = 0;
    state.boostFired = false;
    resetCity();
    for (const s of shards) respawnShard(s, false);
}

function gameUpdate()
{
    const dt = Math.min(timeDelta, .05);

    if (keyWasPressed('KeyM'))
        state.muted = !state.muted;

    if (state.phase === 'intro' && (keyWasPressed('Space') || keyWasPressed('Enter') || mouseWasPressed(0)))
    {
        resetRun();
        return;
    }

    if (state.phase === 'over' && (keyWasPressed('KeyR') || keyWasPressed('Space')))
    {
        resetRun();
        return;
    }

    if (state.phase === 'over')
        return;

    // ---- steering -------------------------------------------------------
    let dir = keyDirection();
    if (state.phase === 'intro')
        dir = vec2(Math.sin(time*.7)*.55, Math.sin(time*.43)*.25);

    const autonomy = state.phase === 'intro';
    const steerSpeed = 42;

    if (!autonomy)
    {
        ship.pos3D.x += dir.x * steerSpeed * dt;
        ship.pos3D.y += dir.y * steerSpeed * dt;

        if (keyIsDown('Space') && state.boost > .05)
        {
            if (!state.boostFired && state.boost > .95)
            {
                state.boostFired = true;
                new ParticleEmitter3D(ship.pos3D.copy(), 3, .25, 300, PI, undefined,
                    hsl(.52, 1, .7), hsl(.6, 1, .6), hsl(.52, 1, .5, 0), hsl(.6, 1, .4, 0),
                    .55, 1, .1, .25, .95, 0, .7, .6, true);
            }

            state.boost = Math.max(0, state.boost - dt*.5);
            if (Math.random() < .04) soundBoost.play(undefined, .2);
        }
        else
        {
            state.boost = Math.min(1, state.boost + dt*.18);
            if (state.boost < .5) state.boostFired = false;
        }
    }

    ship.pos3D.x = clampV(ship.pos3D.x, -CORRIDOR, CORRIDOR);
    ship.pos3D.y = clampV(ship.pos3D.y, 7, CEILING);

    // bank into the turn, and pitch slightly with climb
    ship.rotation3D.z = lerpAngleValue(ship.rotation3D.z, -dir.x*.5, dt*6);
    ship.rotation3D.y = lerpAngleValue(ship.rotation3D.y, -dir.x*.18, dt*5);
    ship.rotation3D.x = lerpAngleValue(ship.rotation3D.x, dir.y*.12, dt*4);

    // ---- forward speed --------------------------------------------------
    const ramp = Math.min(1, state.distance/5200);
    const target = 62 + ramp*46 + (state.boost < .99 && keyIsDown('Space') ? 46 : 0);
    state.speed = lerpValue(state.speed, target, dt*1.4);

    const step = state.speed*dt;
    ship.pos3D.z -= step;
    state.distance += step;
    if (state.phase === 'play') state.score += step*.9;

    // ---- the world ------------------------------------------------------
    recycleCity();
    updateShards(dt);
    ground.pos3D.z = Math.round(ship.pos3D.z/20)*20;

    // ---- collision ------------------------------------------------------
    state.invulnerable = Math.max(0, state.invulnerable - dt);
    if (state.phase === 'play' && state.invulnerable <= 0 && cityHit(ship.pos3D))
    {
        state.shield--;
        state.invulnerable = 1.6;
        state.hurt = 1;
        state.shake = 1;
        state.speed *= .55;
        soundHit.play(undefined, .5);
        new ParticleEmitter3D(ship.pos3D.copy(), 2, .1, 220, PI, undefined,
            hsl(.02, 1, .7), hsl(.1, 1, .6), hsl(.02, 1, .4, 0), hsl(.02, 1, .3, 0),
            1.1, 1.2, .1, .35, .96, 0, .5, .6, true);
        ship.pos3D.z -= 6;   // nudge clear of the wall we just hit

        if (state.shield <= 0)
        {
            state.phase = 'over';
            state.best = Math.max(state.best, Math.floor(state.score));
            localStorage.setItem('sprawl.best', state.best);
        }
    }

    state.flash = Math.max(0, state.flash - dt*2.2);
    state.hurt = Math.max(0, state.hurt - dt*1.6);
    state.shake = Math.max(0, state.shake - dt*2.5);

    for (let i = popups.length; i--;)
    {
        popups[i].life -= dt*1.5;
        popups[i].y -= dt*.14;
        if (popups[i].life <= 0) popups.splice(i, 1);
    }

    updateStatus(dt);
}

function lerpValue(a, b, t) { return a + (b - a) * Math.min(1, t); }
function lerpAngleValue(a, b, t) { return lerpValue(a, b, Math.min(1, t)); }

function gameUpdatePost()
{
    // chase camera, eased so it lags the ship just enough to feel fast
    const target = ship.pos3D.add(vec3(0, CAM_UP, CAM_BACK));
    const k = 1 - Math.pow(.0015, Math.min(timeDelta, .05));
    camPos = camPos.add(target.subtract(camPos).scale(k));

    const shake = state.shake * state.shake;
    const jitter = vec3((Math.random()-.5)*shake*2.2, (Math.random()-.5)*shake*2.2, 0);

    render3D.camera.pos = camPos.add(jitter);
    render3D.camera.lookAt(ship.pos3D.add(vec3(0, 1.2, -26)));
    render3D.shadowCenter = ship.pos3D;
}

///////////////////////////////////////////////////////////////////////////////
// the 2D layer: HUD, radar and overlays drawn over the live 3D scene

function gameRenderPost()
{
    const W = mainCanvasSize.x, H = mainCanvasSize.y;
    const s = H / 720;

    if (state.flash > 0)
        drawRect(vec2(W/2, H/2), vec2(W, H), hsl(.52, 1, .7, state.flash*.12));

    if (state.hurt > 0)
        drawRect(vec2(W/2, H/2), vec2(W, H), hsl(.02, 1, .55, state.hurt*.28));

    if (state.phase === 'play' && keyIsDown('Space') && state.boost > .05)
    {
        for (let i = 0; i < 22; ++i)
        {
            const a = (i/22)*PI*2 + time*.4;
            const r0 = (250 + Math.random()*90)*s;
            const r1 = r0 + (110 + Math.random()*160)*s;
            drawLine(vec2(W/2 + Math.cos(a)*r0, H/2 + Math.sin(a)*r0),
                     vec2(W/2 + Math.cos(a)*r1, H/2 + Math.sin(a)*r1),
                     2*s, hsl(.55, 1, .78, .32));
        }
    }

    if (state.phase === 'play' || state.phase === 'over')
        drawHud(W, H, s);

    for (const p of popups)
        drawTextScreen('+25', vec2(W*(.5 + p.x), H*(.5 + p.y)), 18*s,
            hsl(.5, 1, .8, Math.min(1, p.life)), 0, undefined, 'center');

    if (state.phase === 'over')
        drawOver(W, H, s);

    if (state.muted)
        drawTextScreen('MUTED', vec2(W - 24*s, 26*s), 13*s, hsl(.6, .3, .5), 0, undefined, 'right');
}

function drawHud(W, H, s)
{
    const score = Math.floor(state.score).toString().padStart(6, '0');
    drawTextScreen('SCORE ' + score, vec2(26*s, 26*s), 20*s, hsl(.55, 1, .8), 3, hsl(.6, 1, .2), 'left');

    const km = (state.distance/1000).toFixed(2);
    drawTextScreen(km + ' km', vec2(26*s, 54*s), 15*s, hsl(.55, .5, .7), 2, hsl(.6, 1, .15), 'left');

    // shield pips
    for (let i = 0; i < 3; ++i)
    {
        const full = i < state.shield;
        drawCircle(vec2(W - (26 + i*26)*s, 30*s), 8*s, full ? hsl(.52, 1, .68) : hsl(.6, .3, .2));
    }
    drawTextScreen('BEST ' + state.best, vec2(W - 26*s, 54*s), 13*s, hsl(.6, .3, .55), 0, undefined, 'right');

    // boost bar
    const bw = 160*s, bh = 6*s, bx = 26*s, by = H - 40*s;
    drawRect(vec2(bx + bw/2, by), vec2(bw, bh), hsl(.6, .4, .18));
    drawRect(vec2(bx + bw*state.boost/2, by), vec2(bw*state.boost, bh), hsl(.52, 1, .6));

    // radar: shards ahead, as 2D marks on a 2D ring
    const cx = W - 70*s, cy = H - 70*s, rad = 46*s;    drawCircle(vec2(cx, cy), rad, hsl(.6, .6, .12));
    drawCircle(vec2(cx, cy), rad, hsl(.55, .8, .35), 1.5*s, hsl(.55, .9, .45));
    for (const sh of shards)
    {
        const dz = sh.pos3D.z - ship.pos3D.z;
        if (dz > 0 || dz < -620) continue;
        const px = cx + (sh.pos3D.x - ship.pos3D.x) * rad/150;
        const py = cy + dz * rad/620;
        drawCircle(vec2(px, py), 2.2*s, hsl(.5, 1, .7));
    }
    drawCircle(vec2(cx, cy), 2.6*s, hsl(.55, 1, .85));

    const speed = Math.round(state.speed * 3.6);
    drawTextScreen(speed + ' km/h', vec2(W/2, H - 40*s), 14*s, hsl(.55, .8, .75), 0, undefined, 'center');
    drawTextScreen('ARROWS  steer + climb     SPACE  boost     M  mute',
        vec2(W/2, H - 18*s), 11*s, hsl(.6, .3, .45), 0, undefined, 'center');
}

function drawOver(W, H, s)
{
    drawRect(vec2(W/2, H/2), vec2(W, H), hsl(.72, .9, .02, .62));
    drawTextScreen('CITY LOST', vec2(W/2, H*.38), 46*s, hsl(.02, 1, .66), 6, hsl(.02, 1, .18), 'center');
    drawTextScreen('SCORE ' + Math.floor(state.score), vec2(W/2, H*.5), 26*s, hsl(.55, 1, .8), 0, undefined, 'center');
    drawTextScreen((state.distance/1000).toFixed(2) + ' km flown   ·   best ' + state.best,
        vec2(W/2, H*.5 + 34*s), 14*s, hsl(.6, .3, .65), 0, undefined, 'center');
    const blink = .55 + .45*Math.sin(time*3);
    drawTextScreen('PRESS R TO FLY AGAIN', vec2(W/2, H*.68), 18*s, hsl(.52, 1, .8, blink), 0, undefined, 'center');
}

///////////////////////////////////////////////////////////////////////////////

// the page's Play button calls this; the game also starts on Space or a click
window.sprawlPlay = () =>
{
    if (state.phase !== 'play')
    {
        resetRun();
        // only exists once the visitor has allowed analytics
        if (typeof window.gtag === 'function') window.gtag('event', 'play_started');
        document.dispatchEvent(new CustomEvent('sprawl:started'));
    }
};

// read by the page and by the end-to-end test
window.sprawlStats = () => ({
    phase: state.phase,
    score: Math.round(state.score),
    shield: state.shield,
    fps: Math.round(frameRate),
    objects: engineObjects.length,
});

window.sprawlToggleMute = () =>
{
    state.muted = !state.muted;
    return state.muted;
};

// the page's own controls
const playBtn = document.getElementById('playBtn');
const muteBtn = document.getElementById('muteBtn');
const statusEl = document.getElementById('status');

if (playBtn)
    playBtn.addEventListener('click', () =>
    {
        window.sprawlPlay();
        playBtn.textContent = 'Fly again';
    });

if (muteBtn)
    muteBtn.addEventListener('click', () =>
    {
        muteBtn.setAttribute('aria-pressed', String(window.sprawlToggleMute()));
    });

let statusTick = 0;
function updateStatus(dt)
{
    if (!statusEl || (statusTick -= dt) > 0) return;
    statusTick = .25;
    const km = (state.distance/1000).toFixed(2);
    statusEl.textContent =
        state.phase === 'intro' ? 'Ready — press Play, or Space' :
        state.phase === 'over'  ? `Crashed after ${km} km · ${Math.round(state.score)} points — press R` :
        `Flying · ${km} km · ${Math.round(state.score)} points · shield ${state.shield}`;
}

// the canvas lives in the page's own frame, so the engine is told where to put it
engineInit(gameInit, gameUpdate, gameUpdatePost, undefined, gameRenderPost, [],
    document.getElementById('stage'));

// The engine cancels the wheel and the page's own keys across the WHOLE document by default, so a
// page with three screens of reading under the game could not be scrolled at all — measured in
// Chrome: every wheel event arrived with defaultPrevented true and scrollY never left 0. Turn that
// off, then hold back only the keys the ship is flying with, and only while a run is live.
setInputPreventDefault(false);
const FLIGHT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space']);
addEventListener('keydown', (e) =>
{
    if (state.phase === 'play' && FLIGHT_KEYS.has(e.code)) e.preventDefault();
}, { passive: false });
