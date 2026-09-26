# Genre Patterns Reference
# NES / SNES / SEGA Mega Drive mechanics, physics, and logic

---

## Platformer

### Physics Constants by Era
```js
// NES feel (Super Mario Bros style)
const ERA_NES  = { GRAV:.28, JUMP:-6.5, MAX_FALL:6,  WALK:1.8, RUN:3.2, ACCEL:.25, FRIC:.18 };
// SNES feel (Super Mario World style)
const ERA_SNES = { GRAV:.32, JUMP:-7.5, MAX_FALL:8,  WALK:2.2, RUN:4.0, ACCEL:.30, FRIC:.20 };
// SEGA feel (Sonic style — fast, momentum-based)
const ERA_SEGA = { GRAV:.38, JUMP:-9.0, MAX_FALL:12, TOP:8.0,  ACCEL:.46, FRIC:.15, SPIN:12 };
```

### Variable Jump Height
```js
function updateJump(player, keys) {
  if ((player.coyoteTime > 0 || player.jumpBuffer > 0) && player.onGround) {
    player.vy = ERA.JUMP;
    player.jumping = true;
    player.onGround = false;
    player.coyoteTime = 0;
    player.jumpBuffer = 0;
    SFX.jump();
  }
  if (!keys.jump && player.jumping && player.vy < -2) {
    player.vy *= 0.55; // cut jump short
    player.jumping = false;
  }
}
```

### Coyote Time + Jump Buffering
```js
// In update loop each frame:
if (player.onGround) player.coyoteTime = 6;
else if (player.coyoteTime > 0) player.coyoteTime--;

if (keys.jumpJustPressed) player.jumpBuffer = 8;
if (player.jumpBuffer > 0) player.jumpBuffer--;
```

### Tile Collision (AABB, axis-separated)
```js
function tileCollide(entity, map) {
  entity.onGround = false;

  // Horizontal
  entity.x += entity.vx;
  const tx1 = tileCoord(entity.x), tx2 = tileCoord(entity.x + entity.w - 1);
  const ty1 = tileCoord(entity.y + 2), ty2 = tileCoord(entity.y + entity.h - 2);
  if (isSolid(map,tx1,ty1) || isSolid(map,tx1,ty2)) { entity.x=(tx1+1)*TW*SCALE; entity.vx=0; }
  if (isSolid(map,tx2,ty1) || isSolid(map,tx2,ty2)) { entity.x=tx2*TW*SCALE-entity.w; entity.vx=0; }

  // Vertical
  entity.y += entity.vy;
  const bx1 = tileCoord(entity.x+2), bx2 = tileCoord(entity.x+entity.w-3);
  const top  = tileCoord(entity.y), bot = tileCoord(entity.y + entity.h - 1);
  if (isSolid(map,bx1,top) || isSolid(map,bx2,top)) { entity.y=(top+1)*TH*SCALE; entity.vy=0; }
  if (isSolid(map,bx1,bot) || isSolid(map,bx2,bot)) {
    entity.y=bot*TH*SCALE-entity.h; entity.vy=0; entity.onGround=true; entity.jumping=false;
  }

  // One-way platforms
  if (!entity.droppingThrough) {
    const midBot = tileCoord(entity.y + entity.h);
    if (tileAt(map,bx1,midBot)===T.PLATFORM || tileAt(map,bx2,midBot)===T.PLATFORM) {
      if (entity.vy > 0 && entity.y + entity.h - entity.vy <= midBot*TH*SCALE) {
        entity.y=midBot*TH*SCALE-entity.h; entity.vy=0; entity.onGround=true;
      }
    }
  }
}
```

### SEGA Spin Dash
```js
let spinCharge = 0;
function updateSpinDash(player, keys) {
  if (keys.down && keys.attack && player.onGround) {
    spinCharge = Math.min(spinCharge + 0.5, ERA_SEGA.SPIN);
  } else if (spinCharge > 0 && !keys.down) {
    player.vx = player.facingLeft ? -spinCharge : spinCharge;
    spinCharge = 0;
    SFX.spinRelease();
  }
}
```

### Squash & Stretch
```js
let scaleY = 1.0, scaleYTarget = 1.0;

// Triggers: onJump → target=0.7; inAir → target=1.2; onLand → target=1.35
scaleY += (scaleYTarget - scaleY) * 0.3; // each frame ease back

// Draw:
ctx.save();
ctx.translate(Math.round(player.x + player.w/2), Math.round(player.y + player.h));
ctx.scale(1, scaleY);
ctx.translate(-Math.round(player.w/2), -Math.round(player.h));
drawSprite(ctx, 0, 0, currentFrame, PAL, player.facingLeft);
ctx.restore();
```

---

## Top-Down Shooter / RPG

### 8-Direction Movement
```js
function moveTopDown(entity, keys, speed) {
  let dx=0, dy=0;
  if(keys.up)    dy-=1;
  if(keys.down)  dy+=1;
  if(keys.left)  dx-=1;
  if(keys.right) dx+=1;
  if(dx && dy) { dx*=0.707; dy*=0.707; }
  entity.x+=dx*speed; entity.y+=dy*speed;
  if(dx!==0) entity.facingLeft = dx<0;
}
```

### Bullet Pool
```js
const BULLET_POOL = Array.from({length:64}, ()=>({active:false,x:0,y:0,vx:0,vy:0,w:4,h:4,owner:''}));

function spawnBullet(x,y,vx,vy,owner) {
  const b = BULLET_POOL.find(b=>!b.active);
  if(!b) return;
  Object.assign(b, {active:true,x,y,vx,vy,owner});
}

function updateBullets(map) {
  BULLET_POOL.forEach(b => {
    if(!b.active) return;
    b.x+=b.vx; b.y+=b.vy;
    if(b.x<0||b.x>levelW||b.y<0||b.y>levelH) { b.active=false; return; }
    if(isSolid(map,tileCoord(b.x),tileCoord(b.y))) { b.active=false; sparks(b.x,b.y,4); }
  });
}
```

### Enemy FSM
```js
const ES = { IDLE:0, PATROL:1, ALERT:2, CHASE:3, ATTACK:4, HURT:5, DEAD:6 };

function updateEnemyFSM(e, player) {
  const dx=player.x-e.x, dy=player.y-e.y, dist=Math.hypot(dx,dy)||1;
  switch(e.state) {
    case ES.IDLE:
      if(--e.idleTimer<=0) { e.state=ES.PATROL; e.patrolDir*=-1; }
      if(dist<e.alertRange) { e.state=ES.ALERT; e.alertTimer=30; SFX.alert(); }
      break;
    case ES.PATROL:
      e.x+=e.patrolDir*e.speed*0.5;
      if(dist<e.alertRange) { e.state=ES.ALERT; e.alertTimer=30; SFX.alert(); }
      break;
    case ES.ALERT:
      if(--e.alertTimer<=0) e.state=ES.CHASE;
      break;
    case ES.CHASE:
      e.x+=dx/dist*e.speed; e.y+=dy/dist*e.speed;
      if(dist<e.attackRange) { e.state=ES.ATTACK; e.attackTimer=e.attackCooldown; }
      if(dist>e.alertRange*2) e.state=ES.PATROL;
      break;
    case ES.ATTACK:
      if(--e.attackTimer<=0) {
        if(e.ranged) spawnBullet(e.x+e.w/2,e.y+e.h/2,(dx/dist)*4,(dy/dist)*4,'enemy');
        else if(dist<e.attackRange) hitPlayer();
        e.state=ES.CHASE;
      }
      break;
    case ES.HURT:
      if(--e.hurtTimer<=0) e.state=e.hp>0?ES.CHASE:ES.DEAD;
      break;
  }
}
```

### SNES RPG: Dialogue System
```js
let dialogue=null;
function showDialogue(lines,onComplete){dialogue={lines,idx:0,charIdx:0,timer:0,onComplete};}
function updateDialogue(){
  if(!dialogue)return;
  if(++dialogue.timer%2===0) dialogue.charIdx++;
  if(dialogue.charIdx>dialogue.lines[dialogue.idx].length) dialogue.charIdx=dialogue.lines[dialogue.idx].length;
}
function drawDialogue(){
  if(!dialogue)return;
  const txt=dialogue.lines[dialogue.idx].slice(0,dialogue.charIdx);
  ctx.fillStyle=PAL.black; ctx.fillRect(8,BASE_H-42,BASE_W-16,36);
  ctx.strokeStyle=PAL.ui; ctx.lineWidth=1; ctx.strokeRect(8,BASE_H-42,BASE_W-16,36);
  ctx.fillStyle=PAL.ui; ctx.font=(6*SCALE)+'px monospace';
  ctx.fillText(txt,16,BASE_H-22);
}
```

---

## Shmup (Shoot-em-up)

### Auto-Scroll
```js
let scrollY = levelHeight - BASE_H;
function updateScroll(){ scrollY=Math.max(0,scrollY-0.6); cam.y=scrollY; }
```

### Formation Patterns
```js
const FORM = {
  vShape:(cx,y,n,gap)=>Array.from({length:n},(_,i)=>({
    x:cx+(i-Math.floor(n/2))*gap, y:y-Math.abs(i-Math.floor(n/2))*gap*0.5
  })),
  diamond:(cx,y)=>[{x:cx,y:y},{x:cx-24,y:y+20},{x:cx+24,y:y+20},{x:cx,y:y+40}],
  spiral:(cx,y,n)=>Array.from({length:n},(_,i)=>({
    x:cx+Math.cos(i/n*Math.PI*4)*40, y:y-i*12
  }))
};
```

### Power System
```js
let powerLevel=0, bombCount=3;
const SHOT_PATTERNS = {
  0: ()=>[{vx:0,vy:-7}],
  1: ()=>[{vx:-.6,vy:-7},{vx:0,vy:-7},{vx:.6,vy:-7}],
  2: ()=>[{vx:-1.2,vy:-6},{vx:-.4,vy:-7},{vx:0,vy:-8},{vx:.4,vy:-7},{vx:1.2,vy:-6}],
};

function useBomb(){
  if(bombCount<=0)return;
  bombCount--;
  screenFlash=20;
  enemies.forEach(e=>{if(e.active){e.hp=-1;spawnDeath(e.x+e.w/2,e.y+e.h/2,e.col);}});
  SFX.bomb();
}
```

---

## Beat-em-up

### Pseudo-3D Movement
```js
const GROUND_TOP=BASE_H*0.55, GROUND_BOT=BASE_H*0.85;
function movePlayer(keys){
  if(keys.left)  player.x=Math.max(0,player.x-2);
  if(keys.right) player.x=Math.min(levelW-player.w,player.x+2);
  if(keys.up)    player.y=Math.max(GROUND_TOP,player.y-1.5);
  if(keys.down)  player.y=Math.min(GROUND_BOT,player.y+1.5);
}
// Draw shadow at player.y, sprite at player.y - player.jumpH
```

### Combo System
```js
const MOVES=[
  {name:'jab',    dmg:5,  frames:12, hitAt:6,  kb:2},
  {name:'cross',  dmg:8,  frames:16, hitAt:10, kb:4},
  {name:'upper',  dmg:14, frames:22, hitAt:14, kb:8, launcher:true},
];
let comboIdx=0, comboTimer=0;
function attack(){
  comboIdx = comboTimer>0 ? Math.min(comboIdx+1,MOVES.length-1) : 0;
  comboTimer=30;
  player.move=MOVES[comboIdx];
  player.moveFrame=0;
  SFX.punch();
}
```

### Throw
```js
function tryGrab(){
  const t=enemies.find(e=>e.state===ES.HURT&&collides(player,e));
  if(t){t.state='grabbed';t.grabbedBy=player;}
}
function doThrow(t,dir){
  t.state=ES.HURT; t.vx=dir*6; t.vy=-4; t.grabbedBy=null; SFX.throw();
}
```

---

## Puzzle (SNES style)

### Grid + Smooth Slide
```js
const GW=8,GH=8;
let grid=Array.from({length:GH},()=>Array(GW).fill(null));

function updateSlide(){
  grid.forEach(row=>row.forEach(c=>{
    if(!c)return;
    c.vx+=(c.targetX-c.vx)*0.25;
    c.vy+=(c.targetY-c.vy)*0.25;
  }));
}
```

### Undo Stack
```js
const undoStack=[];
function makeMove(fn){undoStack.push(JSON.stringify(grid));fn();if(checkWin())onWin();}
function undo(){if(undoStack.length){grid=JSON.parse(undoStack.pop());SFX.undo();}}
```

---

## Shared Retro Patterns

### Floating Score
```js
const floaters=[];
function spawnScore(x,y,val){floaters.push({x,y,val,life:40,max:40});}
function updateFloaters(){floaters.forEach(f=>{f.y-=0.8;f.life--;});floaters.splice(0,floaters.length,...floaters.filter(f=>f.life>0));}
function drawFloaters(){
  floaters.forEach(f=>{
    ctx.globalAlpha=f.life/f.max; ctx.fillStyle=PAL.accent;
    ctx.font=(6*SCALE)+'px monospace'; ctx.textAlign='center';
    ctx.fillText('+'+f.val,f.x,f.y);
  });
  ctx.globalAlpha=1; ctx.textAlign='left';
}
```

### Death Explosion
```js
const deathAnims=[];
function spawnDeath(x,y,col){deathAnims.push({x,y,col,f:0,max:20});}
function updateDeaths(){deathAnims.forEach(d=>d.f++);deathAnims.splice(0,deathAnims.length,...deathAnims.filter(d=>d.f<d.max));}
function drawDeaths(){
  deathAnims.forEach(d=>{
    const t=d.f/d.max, r=t*16*SCALE;
    ctx.strokeStyle=d.col; ctx.lineWidth=SCALE; ctx.globalAlpha=1-t;
    ctx.beginPath(); ctx.arc(d.x,d.y,r,0,Math.PI*2); ctx.stroke();
    for(let i=0;i<6;i++){
      const a=i/6*Math.PI*2+t*Math.PI;
      ctx.beginPath(); ctx.moveTo(d.x,d.y); ctx.lineTo(d.x+Math.cos(a)*r,d.y+Math.sin(a)*r); ctx.stroke();
    }
  });
  ctx.globalAlpha=1;
}
```

### NES Flicker (invincibility frames)
```js
function shouldDraw(entity){
  if(entity.invFrames<=0) return true;
  return Math.floor(entity.invFrames/4)%2===0; // hard on/off every 4 frames
}
```

### Alert Indicator
```js
function drawAlert(e){
  if(e.state!==ES.ALERT) return;
  ctx.fillStyle=PAL.accent; ctx.font=(8*SCALE)+'px monospace'; ctx.textAlign='center';
  ctx.fillText('!',e.x+e.w/2,e.y-6*SCALE); ctx.textAlign='left';
}
```

### HUD Pixel Heart
```js
function drawHeart(x,y,filled){
  ctx.fillStyle=filled?'#f44':'#422';
  [[1,0],[3,0],[0,1],[1,1],[2,1],[3,1],[4,1],[0,2],[1,2],[2,2],[3,2],[4,2],
   [1,3],[2,3],[3,3],[2,4]].forEach(([rx,ry])=>{
    ctx.fillRect(x+rx*SCALE,y+ry*SCALE,SCALE,SCALE);
  });
}
```

### Menu Screen (Retro)
```js
function drawMenu(){
  ctx.fillStyle=PAL.bg1; ctx.fillRect(0,0,BASE_W,BASE_H);
  ctx.font=(12*SCALE)+'px monospace'; ctx.textAlign='center';
  ctx.fillStyle='#000'; ctx.fillText(GAME_TITLE,BASE_W/2+1,40+1); // drop shadow
  ctx.fillStyle=PAL.accent; ctx.fillText(GAME_TITLE,BASE_W/2,40);
  if(Math.floor(frameCount/30)%2===0){
    ctx.fillStyle=PAL.ui; ctx.font=(6*SCALE)+'px monospace';
    ctx.fillText('PRESS SPACE TO START',BASE_W/2,BASE_H-24);
  }
  ctx.textAlign='left';
}
```

---

## Side-Scrolling (Action / Beat-em-up / Run-and-Gun)

Side-scrollers share a camera that follows the player horizontally through a wide level. The world
scrolls left while the player advances right. Key references: Contra (NES), Castlevania (NES/SNES),
Metal Slug (arcade/SEGA), Megaman X (SNES), Gunstar Heroes (SEGA).

### Camera & World Setup
```js
// Level is wider than the screen — camera tracks player
const LEVEL_COLS = 80;          // tile columns in the full level
const LEVEL_W    = LEVEL_COLS * TW * SCALE;

const cam = { x:0, shake:0 };

function updateCamera() {
  // Smooth camera with lead-ahead: camera centre sits slightly ahead of player
  const targetX = player.x - BASE_W * 0.38;
  cam.x += (targetX - cam.x) * 0.12;          // ease factor — lower = smoother
  cam.x = Math.max(0, Math.min(LEVEL_W - BASE_W, cam.x));
}

// In render:
// ctx.save(); ctx.translate(-Math.round(cam.x), 0);
// drawParallax(cam.x);  drawTiles();  drawEntities();
// ctx.restore();  drawHUD();
```

### Parallax Scroll (3-layer)
```js
// Each layer moves at a fraction of the camera speed
function drawParallax(camX) {
  drawBgLayer(farBgFn,  -(camX * 0.15) % BASE_W,  PAL.bg1);   // distant sky / mountains
  drawBgLayer(midBgFn,  -(camX * 0.40) % BASE_W,  PAL.bg2);   // mid hills / buildings
  // near layer is just the tile map itself at speed 1.0
}

function drawBgLayer(drawFn, offsetX, col) {
  // Draw twice side-by-side so scroll wraps seamlessly
  ctx.save(); ctx.translate(offsetX, 0); drawFn(col);
  ctx.translate(BASE_W, 0);              drawFn(col);
  ctx.restore();
}
```

### Run-and-Gun Player (Contra / Metal Slug style)
```js
// Player can shoot in 8 directions; aim direction independent of move direction
let aimAngle = 0; // radians

function updateAim(keys) {
  if (keys.up && keys.right) aimAngle = -Math.PI/4;
  else if (keys.up && keys.left) aimAngle = -Math.PI*3/4;
  else if (keys.up)    aimAngle = -Math.PI/2;
  else if (keys.down && !player.onGround) aimAngle = Math.PI/2;  // downward only in air
  else aimAngle = player.facingLeft ? Math.PI : 0;
}

function shoot() {
  const speed = 7;
  spawnBullet(
    player.x + player.w/2, player.y + player.h/2,
    Math.cos(aimAngle)*speed, Math.sin(aimAngle)*speed, 'player'
  );
  SFX.shoot();
  // Gun recoil: tiny knockback opposite to shot direction
  player.vx -= Math.cos(aimAngle) * 0.4;
}
```

### Castlevania-style: Weapon Arc + Sub-Weapons
```js
// Primary: whip with arc hitbox (not a bullet — a timed hitbox)
let whipState = null;  // null | { frame, maxFrame, hitbox }

function crackWhip() {
  if (whipState) return;
  const dir = player.facingLeft ? -1 : 1;
  whipState = {
    frame: 0, maxFrame: 18,
    hitbox: { x: player.x + dir*(player.w), y: player.y, w: 28*SCALE, h: 10*SCALE }
  };
  SFX.whip();
}

function updateWhip() {
  if (!whipState) return;
  whipState.frame++;
  if (whipState.frame >= whipState.maxFrame) { whipState = null; return; }
  // Hitbox is only active in middle frames (frames 4–12)
  if (whipState.frame >= 4 && whipState.frame <= 12) {
    enemies.forEach(e => {
      if (e.active && collides(whipState.hitbox, e)) hitEnemy(e, 2);
    });
  }
}

function drawWhip() {
  if (!whipState) return;
  const t = whipState.frame / whipState.maxFrame;
  const dir = player.facingLeft ? -1 : 1;
  // Draw chain extending then retracting
  const len = Math.sin(t * Math.PI) * 28 * SCALE;
  ctx.strokeStyle = PAL.accent; ctx.lineWidth = SCALE * 2;
  ctx.beginPath();
  ctx.moveTo(player.x + (dir>0 ? player.w : 0), player.y + player.h*0.4);
  ctx.lineTo(player.x + (dir>0 ? player.w : 0) + dir*len, player.y + player.h*0.4 + len*0.3);
  ctx.stroke();
}

// Sub-weapons (knife, axe, holy water) selected with Up+Attack
const SUB_WEAPONS = {
  knife:     { spawnFn: (p)=>spawnBullet(p.x,p.y,-1,6,0,'sub'), cooldown:15 },
  axe:       { spawnFn: (p)=>spawnBullet(p.x,p.y,-1,3,0,'arc',{ay:.18}), cooldown:20 },
  holywater: { spawnFn: (p)=>spawnPickup(p.x,p.y,'flame',{gravity:true}), cooldown:30 },
};
```

### Megaman X-style: Dash + Wall Slide + Wall Jump
```js
// Dash
let dashFrames = 0, dashCooldown = 0;
function dash() {
  if (dashCooldown > 0) return;
  dashFrames = 14;
  player.vx = player.facingLeft ? -ERA.TOP*1.6 : ERA.TOP*1.6;
  SFX.dash();
  dashCooldown = 35;
}

// Wall slide: when pressing into a wall while airborne, fall slowly
function updateWallSlide() {
  const onWallL = isSolid(map, tileCoord(player.x-1), tileCoord(player.y+4));
  const onWallR = isSolid(map, tileCoord(player.x+player.w), tileCoord(player.y+4));
  player.onWall = (!player.onGround && (onWallL || onWallR));
  if (player.onWall) {
    player.vy = Math.min(player.vy, 1.0);  // slow fall on wall
    player.wallDir = onWallL ? -1 : 1;
  }
}

// Wall jump: jump away from wall
function wallJump() {
  if (!player.onWall) return;
  player.vy = ERA_SNES.JUMP;
  player.vx = -player.wallDir * ERA_SNES.RUN;  // jump away
  player.onWall = false;
  SFX.jump();
}
```

### Enemy Spawn Triggers (region-based)
```js
// Enemies only activate when their spawn region enters camera view
const spawnTriggers = [
  { triggerX: 20*TW*SCALE, spawned:false, enemies:[{type:'soldier',x:22*TW*SCALE,y:5*TH*SCALE}] },
  { triggerX: 45*TW*SCALE, spawned:false, enemies:[{type:'soldier',x:48*TW*SCALE,y:5*TH*SCALE},{type:'turret',x:52*TW*SCALE,y:6*TH*SCALE}] },
];

function checkSpawnTriggers() {
  spawnTriggers.forEach(t => {
    if (!t.spawned && cam.x + BASE_W > t.triggerX) {
      t.spawned = true;
      t.enemies.forEach(e => spawnEnemy(e.type, e.x, e.y));
    }
  });
}
```

### Checkpoint System
```js
const checkpoints = [];   // { x, y, reached }

function checkCheckpoints() {
  checkpoints.forEach(cp => {
    if (!cp.reached && player.x > cp.x) {
      cp.reached = true;
      lastCheckpoint = { x:cp.x, y:cp.y };
      showBanner('CHECKPOINT');
      SFX.checkpoint();
    }
  });
}

function respawnAtCheckpoint() {
  player.x = lastCheckpoint.x;
  player.y = lastCheckpoint.y;
  player.vx = player.vy = 0;
  cam.x = Math.max(0, player.x - BASE_W*0.38);
}
```

### Mid-Level Boss Gate
```js
// When player reaches boss trigger X, lock camera and spawn boss
let bossActive = false;

function checkBossGate() {
  if (!bossActive && player.x > BOSS_TRIGGER_X) {
    bossActive = true;
    cam.locked = true;   // stop horizontal scroll
    // Seal left exit (solid wall) so player can't retreat
    spawnBoss(BOSS_TRIGGER_X + 40*SCALE, FLOOR_Y);
    startMusic(BOSS_MUSIC_IDX);
    showBanner('BOSS!');
  }
}
```

---

## RPG (SNES / SEGA overhead RPG)

Classic overhead RPG with tile-based world, NPC dialogue, shops, turn-based or action combat,
experience/levelling, and an overworld map. Key references: Final Fantasy IV/VI (SNES),
Chrono Trigger (SNES), Phantasy Star IV (SEGA), Secret of Mana (SNES).

### World Layers: Overworld → Town → Dungeon
```js
// Three distinct map modes with their own tile sets and camera rules
const MAP_MODE = { OVERWORLD:0, TOWN:1, DUNGEON:2 };
let mapMode = MAP_MODE.OVERWORLD;

const MAPS = {
  overworld: { tileset:'ow', map:OVERWORLD_MAP, musicIdx:0,
               transitions:[{tileX:12,tileY:8,dest:{mode:MAP_MODE.TOWN,   spawnX:5, spawnY:9}}] },
  town_01:   { tileset:'tw', map:TOWN_MAP,      musicIdx:1,
               transitions:[{tileX:5, tileY:10,dest:{mode:MAP_MODE.OVERWORLD,spawnX:12,spawnY:9}}] },
  dungeon_01:{ tileset:'dg', map:DUNGEON_MAP,   musicIdx:2 },
};

function enterMap(mode, spawnX, spawnY) {
  mapMode = mode;
  player.tx = spawnX; player.ty = spawnY;
  player.x = spawnX*TW*SCALE; player.y = spawnY*TH*SCALE;
  fadeIn();
  startMusic(currentMap().musicIdx);
}
```

### Tile-Based Player Movement (grid-locked, SNES RPG style)
```js
// Player moves one tile at a time; hold to walk continuously
let moveQueue = null, moveCooldown = 0;

function updatePlayerMove(keys) {
  if (moveCooldown > 0) { moveCooldown--; return; }

  let dx=0, dy=0;
  if (keys.up)    dy=-1;
  if (keys.down)  dy=1;
  if (keys.left)  dx=-1;
  if (keys.right) dx=1;
  if (!dx && !dy) return;

  player.facingDir = dx<0?'left':dx>0?'right':dy<0?'up':'down';

  const nx = player.tx + dx, ny = player.ty + dy;
  if (isSolid(currentMap().map, nx, ny)) { SFX.bump(); return; }

  // Check for map transition tile
  const trans = currentMap().transitions?.find(t=>t.tileX===nx&&t.tileY===ny);
  if (trans) { fadeOut(()=>enterMap(trans.dest.mode,trans.dest.spawnX,trans.dest.spawnY)); return; }

  // Check for NPC
  const npc = npcs.find(n=>n.tx===nx&&n.ty===ny);
  if (npc) { showDialogue(npc.lines); return; }

  player.tx = nx; player.ty = ny;
  player.targetPx = nx*TW*SCALE; player.targetPy = ny*TH*SCALE;
  moveCooldown = 10;  // frames between steps
  SFX.step();

  // Random encounter check
  if (ENCOUNTER_TILES.includes(tileAt(currentMap().map,nx,ny))) {
    if (Math.random() < 0.12) triggerEncounter();
  }
}

// Smooth visual interpolation between tiles
function updatePlayerVisual() {
  player.x += (player.targetPx - player.x) * 0.35;
  player.y += (player.targetPy - player.y) * 0.35;
}
```

### NPC System
```js
const npcs = [
  { tx:6, ty:7, sprite:'villager', lines:['Welcome to town!','The dungeon lies to the east.'] },
  { tx:10,ty:4, sprite:'merchant', lines:['Buy something?'], shop: SHOP_ITEMS },
];

function talkToNPC() {
  const facing = getFacingTile(player);
  const npc = npcs.find(n=>n.tx===facing.tx&&n.ty===facing.ty);
  if (!npc) return;
  if (npc.shop) openShop(npc.shop);
  else showDialogue(npc.lines);
}

function getFacingTile(entity) {
  const d = {left:[-1,0],right:[1,0],up:[0,-1],down:[0,1]}[entity.facingDir];
  return { tx:entity.tx+d[0], ty:entity.ty+d[1] };
}
```

### Shop System
```js
let shopOpen = false, shopItems = [], shopCursor = 0;

const SHOP_ITEMS = [
  { name:'Potion',   cost:50,  effect:()=>{ party[0].hp=Math.min(party[0].maxHp,party[0].hp+50); } },
  { name:'Hi-Potion',cost:150, effect:()=>{ party[0].hp=party[0].maxHp; } },
  { name:'Antidote', cost:30,  effect:()=>{ party[0].status=null; } },
];

function openShop(items){ shopOpen=true; shopItems=items; shopCursor=0; showDialogue(['What would you like?']); }

function drawShop() {
  if (!shopOpen) return;
  ctx.fillStyle=PAL.black; ctx.fillRect(BASE_W-90,20,86,shopItems.length*14+12);
  ctx.strokeStyle=PAL.ui; ctx.lineWidth=1; ctx.strokeRect(BASE_W-90,20,86,shopItems.length*14+12);
  shopItems.forEach((item,i)=>{
    ctx.fillStyle = i===shopCursor ? PAL.accent : PAL.ui;
    ctx.font=(5*SCALE)+'px monospace';
    ctx.fillText((i===shopCursor?'>':' ')+item.name, BASE_W-86, 32+i*14);
    ctx.textAlign='right'; ctx.fillText(item.cost+'G', BASE_W-6, 32+i*14); ctx.textAlign='left';
  });
}
```

### Turn-Based Combat (Final Fantasy style)
```js
const COMBAT_PHASE = { PLAYER_TURN:0, ENEMY_TURN:1, ANIMATING:2, RESULT:3 };
let combat = null;

function startCombat(enemyGroup) {
  combat = {
    phase: COMBAT_PHASE.PLAYER_TURN,
    enemies: enemyGroup.map(e=>({...e})),
    party: party.map(p=>({...p})),
    log: [],
    cursor: 0,
    actionMenu: ['Attack','Magic','Item','Run'],
    menuCursor: 0,
  };
  startMusic(BATTLE_MUSIC_IDX);
  fadeIn();
}

function combatAction(action) {
  if (combat.phase !== COMBAT_PHASE.PLAYER_TURN) return;
  const attacker = combat.party[combat.cursor];
  const target   = combat.enemies[0]; // simplify: target first alive enemy

  switch(action) {
    case 'Attack': {
      const dmg = Math.max(1, attacker.atk - target.def + Math.floor(Math.random()*5));
      target.hp -= dmg;
      combat.log.push(attacker.name+' attacks for '+dmg+'!');
      spawnScore(target.bx, target.by, dmg);
      cam.shake = 8;
      SFX.hit();
      if (target.hp<=0) { combat.log.push(target.name+' defeated!'); target.alive=false; SFX.die(); }
      break;
    }
    case 'Run': {
      if (Math.random()<0.5) { endCombat(false); return; }
      combat.log.push('Could not escape!');
      break;
    }
  }
  combat.phase = COMBAT_PHASE.ENEMY_TURN;
  setTimeout(enemyTurn, 800);
}

function enemyTurn() {
  combat.enemies.filter(e=>e.alive).forEach(e=>{
    const target = combat.party[0];
    const dmg = Math.max(1, e.atk - target.def + Math.floor(Math.random()*3));
    target.hp -= dmg;
    combat.log.push(e.name+' attacks for '+dmg+'!');
    SFX.hurt();
    if (target.hp<=0) { endCombat('lose'); return; }
  });
  if (combat.enemies.every(e=>!e.alive)) { endCombat('win'); return; }
  combat.phase = COMBAT_PHASE.PLAYER_TURN;
}

function endCombat(result) {
  if (result==='win') {
    const xp = combat.enemies.reduce((s,e)=>s+e.xp,0);
    const gp = combat.enemies.reduce((s,e)=>s+e.gp,0);
    gold += gp; giveXP(xp);
    showBanner('Victory! +'+xp+' XP  +'+gp+'G');
    SFX.lvl();
  }
  combat = null;
  startMusic(currentMap().musicIdx);
}
```

### Experience & Level-Up
```js
function giveXP(amount) {
  party.forEach(member => {
    member.xp += amount;
    if (member.xp >= member.nextXP) levelUp(member);
  });
}

function levelUp(member) {
  member.level++;
  member.xp -= member.nextXP;
  member.nextXP = Math.floor(member.nextXP * 1.4);  // exponential curve
  member.maxHp  += 8 + Math.floor(Math.random()*8);
  member.atk    += 2 + Math.floor(Math.random()*3);
  member.def    += 1 + Math.floor(Math.random()*2);
  member.hp = member.maxHp;  // full heal on level up
  showBanner(member.name+' reached Level '+member.level+'!');
  SFX.levelUp();
}
```

### Action RPG Combat (Secret of Mana / Zelda style)
```js
// Alternative to turn-based: real-time melee with charge attack
let attackCharge = 0, swingActive = false, swingFrame = 0;

function updateActionCombat(keys) {
  if (keys.attack) {
    attackCharge = Math.min(attackCharge + 1, 60);
  } else if (attackCharge > 0) {
    swingActive = true;
    swingFrame  = 0;
    const isCharged = attackCharge >= 55;
    const dmg = isCharged ? player.atk * 2.5 : player.atk;
    const range = isCharged ? 40*SCALE : 24*SCALE;
    hitEnemiesInArc(player, dmg, range, isCharged);
    if (isCharged) { cam.shake=10; SFX.powerHit(); } else SFX.swing();
    attackCharge = 0;
  }
  if (swingActive) { if (++swingFrame > 12) swingActive = false; }
}

function hitEnemiesInArc(attacker, dmg, range, charged) {
  const cx = attacker.x + attacker.w/2, cy = attacker.y + attacker.h/2;
  enemies.forEach(e => {
    if (!e.active) return;
    const ex = e.x+e.w/2, ey = e.y+e.h/2;
    if (Math.hypot(ex-cx, ey-cy) < range) {
      hitEnemy(e, dmg);
      if (charged) { e.vx=(ex-cx)/8; e.vy=(ey-cy)/8; } // knockback
    }
  });
}
```

### Inventory System
```js
const MAX_ITEMS = 16;
let inventory = [];  // [{ id, name, qty, type, effect }]

function addItem(itemDef) {
  const existing = inventory.find(i=>i.id===itemDef.id);
  if (existing) { existing.qty++; }
  else if (inventory.length < MAX_ITEMS) { inventory.push({...itemDef, qty:1}); }
  else showBanner('Inventory full!');
}

function useItem(idx) {
  const item = inventory[idx];
  if (!item || item.qty <= 0) return;
  item.effect(party[0]);
  item.qty--;
  if (item.qty <= 0) inventory.splice(idx, 1);
  SFX.heal();
}

// Inventory UI: grid of 4×4 item slots drawn at screen centre
function drawInventory() {
  const ox=BASE_W/2-48, oy=BASE_H/2-48;
  ctx.fillStyle='rgba(0,0,0,.85)'; ctx.fillRect(ox-4,oy-4,100,100);
  ctx.strokeStyle=PAL.ui; ctx.lineWidth=1; ctx.strokeRect(ox-4,oy-4,100,100);
  inventory.forEach((item,i)=>{
    const ix=ox+(i%4)*24, iy=oy+Math.floor(i/4)*24;
    ctx.fillStyle=i===invCursor?PAL.accent:'#333';
    ctx.fillRect(ix,iy,22,22);
    ctx.fillStyle=PAL.ui; ctx.font=(4*SCALE)+'px monospace';
    ctx.fillText(item.name.slice(0,3),ix+2,iy+10);
    if(item.qty>1){ctx.fillStyle='#aaa';ctx.fillText('x'+item.qty,ix+2,iy+20);}
  });
}
```

### World Map (SNES Overworld style)
```js
// Overworld is a zoomed-out tile map with location icons
// Player walks between dungeon/town icons; pressing A enters the location
const OW_LOCATIONS = [
  { name:'Town of Alba', tx:12, ty:8,  icon:'town',    dest:{mode:MAP_MODE.TOWN,    spawnX:5,spawnY:9} },
  { name:'Dark Dungeon', tx:20, ty:10, icon:'dungeon',  dest:{mode:MAP_MODE.DUNGEON, spawnX:2,spawnY:2} },
];

function drawOverworldUI() {
  // Location name tooltip when player stands on an icon
  const loc = OW_LOCATIONS.find(l=>l.tx===player.tx&&l.ty===player.ty);
  if (loc) {
    ctx.fillStyle='rgba(0,0,0,.75)'; ctx.fillRect(BASE_W/2-40,BASE_H-22,80,14);
    ctx.fillStyle=PAL.ui; ctx.font=(5*SCALE)+'px monospace'; ctx.textAlign='center';
    ctx.fillText(loc.name,BASE_W/2,BASE_H-12); ctx.textAlign='left';
    ctx.fillStyle='#aaa'; ctx.font=(4*SCALE)+'px monospace'; ctx.textAlign='center';
    ctx.fillText('Press Z to Enter',BASE_W/2,BASE_H-4); ctx.textAlign='left';
  }
}
```

### Status Effects
```js
const STATUS = {
  poison:  { color:'#a0f',  tickDmg:3,  duration:300, onTick:(p)=>{ p.hp=Math.max(1,p.hp-3); SFX.hurt(); } },
  burn:    { color:'#f80',  tickDmg:5,  duration:180, onTick:(p)=>{ p.hp=Math.max(1,p.hp-5); cam.shake=3; } },
  frozen:  { color:'#8ef',  tickDmg:0,  duration:120, onTick:(p)=>{ p.speed*=0; } },
  regen:   { color:'#4f4',  tickDmg:-4, duration:240, onTick:(p)=>{ p.hp=Math.min(p.maxHp,p.hp+4); } },
};

function applyStatus(entity, statusKey) {
  entity.status = { key:statusKey, timer:STATUS[statusKey].duration };
}

function updateStatus(entity) {
  if (!entity.status) return;
  entity.status.timer--;
  if (entity.status.timer % 30 === 0) STATUS[entity.status.key].onTick(entity);
  if (entity.status.timer <= 0) entity.status = null;
}

// Draw status indicator above entity sprite
function drawStatus(entity) {
  if (!entity.status) return;
  ctx.fillStyle = STATUS[entity.status.key].color;
  ctx.font = (4*SCALE)+'px monospace'; ctx.textAlign='center';
  ctx.fillText(entity.status.key.toUpperCase(), entity.x+entity.w/2, entity.y-8);
  ctx.textAlign='left';
}
```
