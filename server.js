const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const ARENA_W = 1600;
const ARENA_H = 900;
const CAR_RADIUS = 28;
const MAX_HP = 100;
const MAX_SPEED = 260;
const ACCEL = 400;
const TURN_SPEED = 2.8;
const FRICTION_PER_SEC = 0.15;

const COLOR_NAMES = ['#ff4444', '#4488ff', '#44dd44', '#ffcc00'];
const SPAWN = [
  { x: 130, y: 130, angle: Math.PI * 0.25 },
  { x: 1470, y: 770, angle: Math.PI * 1.25 },
  { x: 1470, y: 130, angle: Math.PI * 0.75 },
  { x: 130, y: 770, angle: Math.PI * 1.75 },
];

// Прямоугольные препятствия (здания) — cx/cy = центр, hw/hd = полуразмеры
const OBSTACLES = [
  { x: 390,  y: 190, hw: 210, hd: 140 }, // TL квартал
  { x: 1210, y: 190, hw: 210, hd: 140 }, // TR квартал
  { x: 390,  y: 710, hw: 210, hd: 140 }, // BL квартал
  { x: 1210, y: 710, hw: 210, hd: 140 }, // BR квартал
  { x: 800,  y: 450, hw: 90,  hd: 90  }, // центральный блок
];

const BOT_IDS = ['bot_0', 'bot_1', 'bot_2', 'bot_3'];

let players = {};
let humanSlots = new Set(); // which slot indices are humans
let winnerEmitted = false;
let lastTime = Date.now();

function collideCarObstacle(p, obs) {
  const cx = Math.max(obs.x - obs.hw, Math.min(p.x, obs.x + obs.hw));
  const cy = Math.max(obs.y - obs.hd, Math.min(p.y, obs.y + obs.hd));
  const dx = p.x - cx, dy = p.y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < CAR_RADIUS && dist > 0.001) {
    const nx = dx / dist, ny = dy / dist;
    p.x += nx * (CAR_RADIUS - dist);
    p.y += ny * (CAR_RADIUS - dist);
    const dot = p.vx * nx + p.vy * ny;
    if (dot < 0) {
      const spd = Math.abs(dot);
      if (spd > 60) p.hp -= spd * 0.055;
      p.vx -= dot * nx * 1.3;
      p.vy -= dot * ny * 1.3;
      if (p.hp <= 0 && !p.dead) {
        p.dead = true; p.hp = 0;
        io.emit('explosion', { x: p.x, y: p.y, index: p.index });
      }
    }
  }
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI)  d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function createCar(id, index, isBot = false) {
  const s = SPAWN[index];
  return {
    id, index, isBot,
    x: s.x, y: s.y, angle: s.angle,
    vx: 0, vy: 0,
    hp: MAX_HP,
    color: COLOR_NAMES[index],
    dead: false,
    boosted: false,
    input: { up: false, down: false, left: false, right: false },
    // Bot-only state
    wanderAngle: Math.random() * Math.PI * 2,
    wanderTimer: 0,
    wallAvoidTimer: 0,
    wallAvoidAngle: 0,
    stuckTimer: 0,
    lastX: s.x, lastY: s.y,
  };
}

function spawnBot(index) {
  const bot = createCar(BOT_IDS[index], index, true);
  players[BOT_IDS[index]] = bot;
}

function removeBot(index) {
  delete players[BOT_IDS[index]];
}

// Start with 3 bots (slots 1, 2, 3); slot 0 waits for human
function initBots() {
  for (let i = 1; i < 4; i++) spawnBot(i);
}

function getFreeHumanSlot() {
  for (let i = 0; i < 4; i++) {
    if (!humanSlots.has(i)) return i;
  }
  return -1;
}

// --- Bot AI ---
function updateBotAI(bot, allCars, dt) {
  if (bot.dead) return;

  bot.input = { up: false, down: false, left: false, right: false };

  // Stuck detection: if barely moved in 1 second
  bot.stuckTimer += dt;
  if (bot.stuckTimer >= 1.0) {
    const dx = bot.x - bot.lastX;
    const dy = bot.y - bot.lastY;
    if (Math.sqrt(dx*dx + dy*dy) < 20) {
      // Reverse for 0.5s to get unstuck
      bot.wallAvoidTimer = 0.5;
      bot.wallAvoidAngle = bot.angle + Math.PI + (Math.random() - 0.5);
    }
    bot.lastX = bot.x;
    bot.lastY = bot.y;
    bot.stuckTimer = 0;
  }

  // Wall avoidance
  const margin = 130;
  const nearWall = bot.x < margin || bot.x > ARENA_W - margin ||
                   bot.y < margin || bot.y > ARENA_H - margin;
  if (nearWall && bot.wallAvoidTimer <= 0) {
    bot.wallAvoidTimer = 0.7 + Math.random() * 0.4;
    bot.wallAvoidAngle = Math.atan2(ARENA_H / 2 - bot.y, ARENA_W / 2 - bot.x)
                         + (Math.random() - 0.5) * 0.6;
  }

  if (bot.wallAvoidTimer > 0) {
    bot.wallAvoidTimer -= dt;
    const diff = angleDiff(bot.angle, bot.wallAvoidAngle);
    bot.input.left  = diff < -0.1;
    bot.input.right = diff > 0.1;
    bot.input.up = true;
    return;
  }

  // Find nearest living target
  let nearest = null;
  let nearestDist = Infinity;
  for (const t of allCars) {
    if (t.id === bot.id || t.dead) continue;
    const dx = t.x - bot.x;
    const dy = t.y - bot.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < nearestDist) { nearestDist = dist; nearest = t; }
  }

  if (nearest) {
    // Lead the target slightly (predict position)
    const leadTime = 0.4;
    const tx = nearest.x + nearest.vx * leadTime;
    const ty = nearest.y + nearest.vy * leadTime;
    const targetAngle = Math.atan2(ty - bot.y, tx - bot.x);
    const diff = angleDiff(bot.angle, targetAngle);

    // Add tiny random wobble so bots don't drive perfectly
    const wobble = (Math.random() - 0.5) * 0.08;
    bot.input.left  = (diff + wobble) < -0.1;
    bot.input.right = (diff + wobble) > 0.1;
    bot.input.up = Math.abs(diff) < 1.8; // accelerate if roughly facing target
    bot.input.down = Math.abs(diff) > 2.5; // reverse if facing away
  } else {
    // Wander around arena
    bot.wanderTimer -= dt;
    if (bot.wanderTimer <= 0) {
      bot.wanderAngle = Math.random() * Math.PI * 2;
      bot.wanderTimer = 1.5 + Math.random() * 2;
    }
    const diff = angleDiff(bot.angle, bot.wanderAngle);
    bot.input.left  = diff < -0.1;
    bot.input.right = diff > 0.1;
    bot.input.up = true;
  }
}

// --- Reset ---
function resetGame() {
  winnerEmitted = false;
  for (const id in players) {
    const p = players[id];
    const s = SPAWN[p.index];
    Object.assign(p, {
      x: s.x, y: s.y, angle: s.angle,
      vx: 0, vy: 0,
      hp: MAX_HP, dead: false, boosted: false,
      input: { up: false, down: false, left: false, right: false },
      wanderTimer: 0, wallAvoidTimer: 0, stuckTimer: 0,
      lastX: s.x, lastY: s.y,
    });
  }
  io.emit('gameReset');
  console.log('Game reset!');
}

// --- Game Loop ---
function gameLoop() {
  const now = Date.now();
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;

  const allCars = Object.values(players);
  const alive = allCars.filter(p => !p.dead);

  // Update bot AI inputs
  for (const bot of allCars.filter(p => p.isBot && !p.dead)) {
    updateBotAI(bot, allCars, dt);
  }

  // Physics
  for (const p of alive) {
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);

    if (speed > 8) {
      if (p.input.left)  p.angle -= TURN_SPEED * dt;
      if (p.input.right) p.angle += TURN_SPEED * dt;
    }
    const boostMult = (p.boosted && !p.isBot) ? 1.5 : 1.0;
    const curAccel   = ACCEL * boostMult;
    const curMaxSpd  = MAX_SPEED * boostMult;

    if (p.input.up) {
      p.vx += Math.cos(p.angle) * curAccel * dt;
      p.vy += Math.sin(p.angle) * curAccel * dt;
    }
    if (p.input.down) {
      p.vx -= Math.cos(p.angle) * curAccel * 0.5 * dt;
      p.vy -= Math.sin(p.angle) * curAccel * 0.5 * dt;
    }

    const frictionFactor = Math.pow(FRICTION_PER_SEC, dt);
    p.vx *= frictionFactor;
    p.vy *= frictionFactor;

    const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (spd > curMaxSpd) { p.vx = (p.vx / spd) * curMaxSpd; p.vy = (p.vy / spd) * curMaxSpd; }

    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.x < CAR_RADIUS)            { const h = Math.abs(p.vx); if (h > 60) p.hp -= h * 0.06; p.x = CAR_RADIUS; p.vx = Math.abs(p.vx) * 0.35; }
    if (p.x > ARENA_W - CAR_RADIUS)  { const h = Math.abs(p.vx); if (h > 60) p.hp -= h * 0.06; p.x = ARENA_W - CAR_RADIUS; p.vx = -Math.abs(p.vx) * 0.35; }
    if (p.y < CAR_RADIUS)            { const h = Math.abs(p.vy); if (h > 60) p.hp -= h * 0.06; p.y = CAR_RADIUS; p.vy = Math.abs(p.vy) * 0.35; }
    if (p.y > ARENA_H - CAR_RADIUS)  { const h = Math.abs(p.vy); if (h > 60) p.hp -= h * 0.06; p.y = ARENA_H - CAR_RADIUS; p.vy = -Math.abs(p.vy) * 0.35; }
    for (const obs of OBSTACLES) collideCarObstacle(p, obs);

    if (p.hp <= 0 && !p.dead) {
      p.dead = true; p.hp = 0;
      io.emit('explosion', { x: p.x, y: p.y, index: p.index });
    }
  }

  // Collisions
  for (let i = 0; i < alive.length; i++) {
    for (let j = i + 1; j < alive.length; j++) {
      const a = alive[i], b = alive[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < CAR_RADIUS * 2 && dist > 0.01) {
        const nx = dx / dist, ny = dy / dist;
        const relVx = a.vx - b.vx, relVy = a.vy - b.vy;
        const impulse = relVx * nx + relVy * ny;
        if (impulse > 0) {
          const damage = Math.floor(impulse * 0.05);
          if (damage > 2) {
            a.hp -= damage; b.hp -= damage;
            io.emit('hitSpark', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, damage, big: damage > 8 });
          }
          a.vx -= impulse * nx * 0.85; a.vy -= impulse * ny * 0.85;
          b.vx += impulse * nx * 0.85; b.vy += impulse * ny * 0.85;
        }
        const overlap = (CAR_RADIUS * 2 - dist) / 2;
        a.x -= nx * overlap; a.y -= ny * overlap;
        b.x += nx * overlap; b.y += ny * overlap;

        if (a.hp <= 0 && !a.dead) { a.dead = true; a.hp = 0; io.emit('explosion', { x: a.x, y: a.y, index: a.index }); }
        if (b.hp <= 0 && !b.dead) { b.dead = true; b.hp = 0; io.emit('explosion', { x: b.x, y: b.y, index: b.index }); }
      }
    }
  }

  // Winner check (need at least 2 total cars)
  if (!winnerEmitted && Object.keys(players).length >= 2) {
    const remaining = Object.values(players).filter(p => !p.dead);
    if (remaining.length <= 1) {
      winnerEmitted = true;
      const winner = remaining[0] || null;
      io.emit('winner', winner ? { id: winner.id, index: winner.index, isBot: winner.isBot } : null);
      setTimeout(resetGame, 5000);
    }
  }

  io.emit('gameState', Object.values(players).map(p => ({
    id: p.id, index: p.index, isBot: p.isBot,
    x: p.x, y: p.y, angle: p.angle,
    hp: Math.max(0, p.hp),
    color: p.color, dead: p.dead, boosted: p.boosted,
  })));
}

setInterval(gameLoop, 1000 / 30);

// Start bots
initBots();

// --- Connections ---
io.on('connection', (socket) => {
  const slot = getFreeHumanSlot();
  if (slot === -1) {
    socket.emit('serverFull');
    return;
  }

  // Remove bot from this slot if present
  removeBot(slot);
  humanSlots.add(slot);

  players[socket.id] = createCar(socket.id, slot, false);
  socket.emit('init', { id: socket.id, index: slot });
  console.log(`Human Player ${slot + 1} joined [${socket.id.slice(0, 6)}]`);

  socket.on('input', (input) => {
    if (players[socket.id] && !players[socket.id].dead) {
      players[socket.id].input = input;
    }
  });

  socket.on('setBoost', (on) => {
    if (players[socket.id] && !players[socket.id].dead && !players[socket.id].isBot) {
      players[socket.id].boosted = !!on;
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player ${slot + 1} left`);
    humanSlots.delete(slot);
    delete players[socket.id];

    // Re-add bot for this slot
    spawnBot(slot);

    const remaining = Object.values(players).filter(p => !p.dead);
    if (!winnerEmitted && Object.keys(players).length >= 2 && remaining.length <= 1) {
      winnerEmitted = true;
      const winner = remaining[0] || null;
      io.emit('winner', winner ? { id: winner.id, index: winner.index, isBot: winner.isBot } : null);
      setTimeout(resetGame, 5000);
    }
  });
});

server.listen(3000, () => {
  console.log('=================================');
  console.log('  DEMOLITION DERBY');
  console.log('  http://localhost:3000');
  console.log('  Боты: 3  |  Игроков: до 4');
  console.log('=================================');
});
