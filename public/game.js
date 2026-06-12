// Three.js Demolition Derby 3D Client

const ARENA_W = 1600, ARENA_H = 900, MAX_HP = 100;
const PLAYER_NAMES   = ['Красный', 'Синий', 'Зелёный', 'Жёлтый'];
const CAR_COLORS     = [0xff3333, 0x2277ff, 0x33cc33, 0xffcc00];
const CAR_COLOR_STRS = ['#ff5555', '#4499ff', '#55ee55', '#ffdd00'];

let socket, myId, myIndex, gameReady = false, myBoosted = false;
const cars = {}, keys = {}, particles = [];
const lastInput = { up: false, down: false, left: false, right: false };
let lastUpTime = 0, lastDownTime = 0, upReleased = true, downReleased = true;

// ── UI элементы ──────────────────────────────────────────────────────────────
const overlay       = document.getElementById('overlay');
const overlayMsg    = document.getElementById('overlayMsg');
const statusBar     = document.getElementById('statusBar');
const winText       = document.getElementById('winText');
const countdownText = document.getElementById('countdownText');
const turboEl       = document.getElementById('turboIndicator');

// ── Renderer ─────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Сцена и камера ───────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a0800);
scene.fog = new THREE.FogExp2(0x1a0800, 0.000055);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 6000);
camera.position.set(ARENA_W / 2, 1250, ARENA_H / 2 + 750);
camera.lookAt(ARENA_W / 2, 0, ARENA_H / 2);

// ── Освещение ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

const sun = new THREE.DirectionalLight(0xfff0cc, 1.3);
sun.position.set(ARENA_W / 2 + 700, 1000, -500);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -400, right: ARENA_W + 400, top: 400, bottom: -ARENA_H - 400, near: 100, far: 2800 });
scene.add(sun);
const fill = new THREE.DirectionalLight(0x4488bb, 0.35);
fill.position.set(-300, 500, ARENA_H + 300);
scene.add(fill);

// ── Помощники ────────────────────────────────────────────────────────────────
const _box = (w, h, d, mat, x = 0, y = 0, z = 0, shadow = false) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (shadow) { m.castShadow = true; m.receiveShadow = true; }
  return m;
};
const _cyl = (r, h, segs, mat, x = 0, y = 0, z = 0, rz = 0) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segs), mat);
  m.position.set(x, y, z);
  if (rz) m.rotation.z = rz;
  m.castShadow = true;
  return m;
};
const lMat  = c => new THREE.MeshLambertMaterial({ color: c });
const glassMat = new THREE.MeshLambertMaterial({ color: 0x88aacc, transparent: true, opacity: 0.72 });
const headlightMat = new THREE.MeshBasicMaterial({ color: 0xffffaa });
const taillightMat = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const wheelMat = lMat(0x111111), hubMat = lMat(0x666666);

// ── Арена ────────────────────────────────────────────────────────────────────
{
  const floor = _box(ARENA_W, 1, ARENA_H, lMat(0x3a2510), ARENA_W/2, -0.5, ARENA_H/2);
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(1800, 18, 0x4a3520, 0x4a3520);
  grid.position.set(ARENA_W/2, 0.5, ARENA_H/2);
  scene.add(grid);

  const wallH = 55, wallT = 20;
  const wallMat = lMat(0xbb4400), topMat = new THREE.MeshLambertMaterial({ color: 0xff8800, emissive: 0xff5500, emissiveIntensity: 0.4 });
  [
    [[ARENA_W + wallT*2, wallH, wallT], [ARENA_W/2, wallH/2, -wallT/2]],
    [[ARENA_W + wallT*2, wallH, wallT], [ARENA_W/2, wallH/2, ARENA_H + wallT/2]],
    [[wallT, wallH, ARENA_H],           [-wallT/2, wallH/2, ARENA_H/2]],
    [[wallT, wallH, ARENA_H],           [ARENA_W + wallT/2, wallH/2, ARENA_H/2]],
  ].forEach(([s, p]) => {
    const w = new THREE.Mesh(new THREE.BoxGeometry(...s), wallMat);
    w.position.set(...p); w.castShadow = true; w.receiveShadow = true;
    scene.add(w);
    const top = new THREE.Mesh(new THREE.BoxGeometry(s[0], 5, s[2]), topMat);
    top.position.set(p[0], p[1] + wallH/2 + 2.5, p[2]);
    scene.add(top);
  });
}

// ── Надпись-спрайт над машиной ───────────────────────────────────────────────
function makeLabel(text, colorStr) {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 72;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px Arial'; ctx.textAlign = 'center';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 6;
  ctx.strokeText(text, 160, 52);
  ctx.fillStyle = colorStr; ctx.fillText(text, 160, 52);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  spr.scale.set(150, 34, 1); spr.renderOrder = 999;
  return spr;
}

// ── HP-бар ───────────────────────────────────────────────────────────────────
function addHpBar(group, yPos = 52) {
  group.add(_box(64, 4, 8, new THREE.MeshBasicMaterial({ color: 0x222222 }), 0, yPos, 0));
  const geo = new THREE.BoxGeometry(60, 3, 6);
  geo.translate(30, 0, 0);
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00dd00 }));
  fill.position.set(-30, yPos, 0);
  group.add(fill);
  group._hpFill = fill;
  group._hpMat  = fill.material;
}

function updateHpBar(group, ratio) {
  if (!group._hpFill) return;
  group._hpFill.scale.x = Math.max(0.001, ratio);
  group._hpMat.color.setHex(ratio > 0.6 ? 0x00dd00 : ratio > 0.3 ? 0xeeaa00 : 0xdd2200);
}

// ── Колёса ───────────────────────────────────────────────────────────────────
function addWheels(group, axles, sideZ, r = 7, w = 8) {
  axles.forEach(ax => {
    [sideZ, -sideZ].forEach(z => {
      const wh = _cyl(r, w, 14, wheelMat, ax, r, z, Math.PI/2);
      group.add(wh);
      group.add(_cyl(r * 0.42, w + 0.5, 6, hubMat, ax, r, z, Math.PI/2));
    });
  });
}

// ── Обводка для своей машины ─────────────────────────────────────────────────
function addOutline(group, w, h, d, x = 0, y = 0, z = 0) {
  group.add(_box(w + 4, h + 4, d + 4, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }), x, y, z));
}

// ── Модели транспорта ─────────────────────────────────────────────────────────
function buildCar(index, isMe, isBotFlag) {
  switch (index) {
    case 1: return buildTruck(isMe, isBotFlag);
    case 3: return buildBus(isMe, isBotFlag);
    default: return buildRegularCar(index, isMe, isBotFlag);
  }
}

function buildRegularCar(index, isMe, isBot) {
  const g = new THREE.Group();
  const bMat = lMat(CAR_COLORS[index]);

  g.add(_box(58, 12, 28, bMat,  0,  8, 0, true)); // кузов
  g.add(_box(32, 11, 22, bMat, -2, 20, 0, true)); // кабина
  g.add(_box(3, 8, 17, glassMat, 14, 19, 0));      // лобовое
  g.add(_box(3, 7, 16, glassMat,-19, 19, 0));      // заднее
  [-12, 2].forEach(x => {
    g.add(_box(8, 6, 2, glassMat, x, 21,  12));   // боковые окна
    g.add(_box(8, 6, 2, glassMat, x, 21, -12));
  });
  g.add(_box(4, 5, 7, headlightMat, 29,  9, -9)); // фары
  g.add(_box(4, 5, 7, headlightMat, 29,  9,  9));
  g.add(_box(4, 5, 7, taillightMat,-29,  9, -9)); // стопы
  g.add(_box(4, 5, 7, taillightMat,-29,  9,  9));
  g.add(_box(5, 8, 30, lMat(0x222222),  31, 5, 0)); // бамперы
  g.add(_box(5, 8, 30, lMat(0x222222), -31, 5, 0));

  addWheels(g, [18, -18], 16);
  addHpBar(g, 46);
  if (isMe) addOutline(g, 58, 12, 28, 0, 8, 0);

  const suffix = isMe ? ' (ТЫ)' : (isBot ? ' [БОТ]' : '');
  const lbl = makeLabel(PLAYER_NAMES[index] + suffix, isMe ? '#fff' : CAR_COLOR_STRS[index]);
  lbl.position.y = 60; g.add(lbl); g._label = lbl;
  return g;
}

function buildTruck(isMe, isBot) {
  const g = new THREE.Group();
  const cabM  = lMat(0x2277ff);
  const tankM = lMat(0xbbbbbb);
  const bandM = lMat(0xffcc00);

  // Цистерна
  g.add(_box(46, 14, 28, tankM, -12, 10, 0, true));
  g.add(_cyl(14, 8, 16, tankM, -35, 10,  0, Math.PI/2)); // торцевые крышки
  g.add(_cyl(14, 8, 16, tankM,   8, 10,  0, Math.PI/2));
  [-28, -16, -4].forEach(x => g.add(_box(7, 15, 29, bandM, x, 10, 0))); // полосы
  g.add(_box(48, 2, 30, lMat(0x888888), -12,  3, 0)); // кольца
  g.add(_box(48, 2, 30, lMat(0x888888), -12, 17, 0));
  // Ромб-знак опасности
  g.add(_box(2, 10, 10, lMat(0xcc1100), -14, 10,  14.6));
  g.add(_box(2, 10, 10, lMat(0xcc1100), -14, 10, -14.6));

  // Кабина
  g.add(_box(26, 18, 28, cabM, 17, 12, 0, true));
  g.add(_box(3, 12, 20, glassMat, 27, 16, 0));
  g.add(_box(4, 5, 7, headlightMat,  31, 9, -9));
  g.add(_box(4, 5, 7, headlightMat,  31, 9,  9));
  g.add(_box(4, 5, 7, taillightMat, -36, 9, -9));
  g.add(_box(4, 5, 7, taillightMat, -36, 9,  9));
  g.add(_cyl(3, 20, 8, lMat(0x333333), 14, 22, -12)); // выхлоп

  addWheels(g, [22, 4, -14], 16);
  addHpBar(g, 52);
  if (isMe) addOutline(g, 68, 18, 30, -5, 12, 0);

  const suffix = isMe ? ' (ТЫ)' : (isBot ? ' [БОТ]' : '');
  const lbl = makeLabel('Синий 🚛' + suffix, isMe ? '#fff' : '#88aaff');
  lbl.position.y = 66; g.add(lbl); g._label = lbl;
  return g;
}

function buildBus(isMe, isBot) {
  const g = new THREE.Group();
  const busM    = lMat(0xffcc00);
  const darkM   = lMat(0x111111);
  const shadeM  = lMat(0xcc9900);
  const orangeM = new THREE.MeshLambertMaterial({ color: 0xff7700, emissive: 0xff5500, emissiveIntensity: 0.4 });

  g.add(_box(80, 18, 28, busM,   0, 10, 0, true)); // кузов
  g.add(_box(78,  4, 26, busM,   0, 20, 0));        // крыша
  g.add(_box(80,  4, 30, shadeM, 0,  2, 0));        // низ-тень
  g.add(_box(82,  4, 30, darkM,  0, 17, 0));        // верхняя полоса
  g.add(_box(82,  4, 30, darkM,  0,  3, 0));        // нижняя полоса

  // Окна (5 штук с каждой стороны)
  for (let i = 0; i < 5; i++) {
    const wx = -26 + i * 13;
    g.add(_box(10, 9, 2, glassMat, wx, 10,  14.6));
    g.add(_box(10, 9, 2, glassMat, wx, 10, -14.6));
  }

  // Кабина водителя (перед)
  g.add(_box(3, 12, 22, glassMat, 36, 12, 0));      // лобовое
  g.add(_box(5, 12, 30, darkM,    42,  8, 0));       // передний бампер
  g.add(_box(5, 14, 30, darkM,   -42,  8, 0));       // задний бампер

  g.add(_box(4, 6, 7, headlightMat,  39,  8, -10));
  g.add(_box(4, 6, 7, headlightMat,  39,  8,  10));
  g.add(_box(4, 6, 7, taillightMat, -39,  8, -10));
  g.add(_box(4, 6, 7, taillightMat, -39,  8,  10));

  g.add(_box(9, 5, 9, orangeM,  33, 24,  0)); // мигалка перед
  g.add(_box(9, 5, 9, orangeM, -30, 24,  0)); // мигалка зад
  g.add(_box(2, 10, 10, lMat(0xcc0000), -22, 23, 14.6)); // знак СТОП
  g.add(_cyl(3, 20, 8, lMat(0x333333), 33, 30, -12)); // выхлоп

  // Дверь
  g.add(_box(10, 14, 2, lMat(0xddaa00), 20, 10,  14.6));
  g.add(_box(1,  14, 2, darkM,          15, 10,  14.6));

  addWheels(g, [26, 6, -14], 16);
  addHpBar(g, 58);
  if (isMe) addOutline(g, 82, 20, 32, 0, 10, 0);

  const suffix = isMe ? ' (ТЫ)' : (isBot ? ' [БОТ]' : '');
  const lbl = makeLabel('ШКОЛА 🚌' + suffix, isMe ? '#fff' : '#ffdd66');
  lbl.position.y = 72; g.add(lbl); g._label = lbl;
  return g;
}

// ── Частицы ──────────────────────────────────────────────────────────────────
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.mesh); particles.splice(i, 1); continue; }
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    p.vy -= 280 * dt;
    const a = Math.max(0, p.life / p.maxLife);
    p.mesh.material.opacity = a;
    p.mesh.scale.setScalar(a * 0.7 + 0.3);
  }
}

function addParticle(mesh, vx, vy, vz, life) {
  mesh.castShadow = false;
  scene.add(mesh);
  particles.push({ mesh, vx, vy, vz, life, maxLife: life });
}

function spawnExplosion(x, z) {
  // Вспышка
  const flash = new THREE.Mesh(new THREE.SphereGeometry(55, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8800, transparent: true }));
  flash.position.set(x, 20, z);
  addParticle(flash, 0, 0, 0, 0.28);

  // Обломки
  const dc = [0xff4400, 0xff8800, 0xffcc00, 0xdd1100, 0xff6600];
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 220;
    const m = new THREE.Mesh(new THREE.BoxGeometry(4 + Math.random()*7, 4, 4),
      new THREE.MeshBasicMaterial({ color: dc[i % dc.length], transparent: true }));
    m.position.set(x, 12, z);
    addParticle(m, Math.cos(a)*sp, 140 + Math.random()*200, Math.sin(a)*sp, 0.55 + Math.random()*0.4);
  }

  // Дым
  for (let i = 0; i < 10; i++) {
    const sm = new THREE.Mesh(new THREE.SphereGeometry(12 + Math.random()*14, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.7 }));
    sm.position.set(x + (Math.random()-.5)*35, 8, z + (Math.random()-.5)*35);
    addParticle(sm, (Math.random()-.5)*25, 35 + Math.random()*50, (Math.random()-.5)*25, 1.0 + Math.random()*0.6);
  }
}

function spawnHitSpark(x, z) {
  const sc = [0xffff00, 0xff8800, 0xffffff];
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 70 + Math.random() * 130;
    const m = new THREE.Mesh(new THREE.SphereGeometry(3, 4, 4),
      new THREE.MeshBasicMaterial({ color: sc[i % 3], transparent: true }));
    m.position.set(x, 12, z);
    addParticle(m, Math.cos(a)*sp, 50 + Math.random()*80, Math.sin(a)*sp, 0.2 + Math.random()*0.15);
  }
}

function spawnExhaustFlame(x, z, angle) {
  const rd = 38;
  const ex = x - Math.cos(angle) * rd;
  const ez = z - Math.sin(angle) * rd;
  const fc = [0xff4400, 0xff8800, 0xffcc00, 0xff2200];
  for (const side of [-10, 10]) {
    const px = ex - Math.sin(angle) * side;
    const pz = ez + Math.cos(angle) * side;
    const m = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random()*4, 5, 5),
      new THREE.MeshBasicMaterial({ color: fc[Math.floor(Math.random()*4)], transparent: true }));
    m.position.set(px, 6, pz);
    addParticle(m,
      -Math.cos(angle) * (30 + Math.random()*20) + (Math.random()-.5)*15,
      10 + Math.random() * 20,
      -Math.sin(angle) * (30 + Math.random()*20) + (Math.random()-.5)*15,
      0.18 + Math.random() * 0.1);
  }
}

// ── Обновление состояния игры ─────────────────────────────────────────────────
function updateGameState(state) {
  const ids = new Set(state.map(p => p.id));
  for (const id in cars) {
    if (!ids.has(id)) { scene.remove(cars[id].group); delete cars[id]; }
  }

  for (const p of state) {
    if (p.dead) {
      if (cars[p.id]) { scene.remove(cars[p.id].group); delete cars[p.id]; }
      continue;
    }
    if (!cars[p.id]) {
      const group = buildCar(p.index, p.id === myId, p.isBot);
      scene.add(group);
      cars[p.id] = { group };
    }
    const car = cars[p.id];
    car.group.position.set(p.x, 0, p.y);
    car.group.rotation.y = -p.angle;

    updateHpBar(car.group, p.hp / MAX_HP);

    if (p.boosted && !p.isBot) spawnExhaustFlame(p.x, p.y, p.angle);
  }

  if (gameReady) {
    const alive = state.filter(p => !p.dead).length;
    statusBar.textContent = `${PLAYER_NAMES[myIndex]} | Игроков: ${state.length} | Живых: ${alive} | WASD / Стрелки`;
  }
}

// ── Обратный отсчёт ───────────────────────────────────────────────────────────
function startCountdown(sec) {
  countdownText.textContent = `Перезапуск через ${sec}...`;
  countdownText.style.display = 'block';
  if (sec > 0) setTimeout(() => startCountdown(sec - 1), 1000);
  else countdownText.style.display = 'none';
}

// ── Socket ────────────────────────────────────────────────────────────────────
function setupSocket() {
  socket = io();

  socket.on('serverFull', () => { overlayMsg.textContent = 'Сервер заполнен! Максимум 4 игрока.'; });

  socket.on('init', (data) => {
    myId = data.id; myIndex = data.index;
    overlay.classList.add('hidden');
    gameReady = true;
    Sound.init();
    statusBar.textContent = `${PLAYER_NAMES[myIndex]} | WASD / Стрелки`;
  });

  socket.on('gameState', updateGameState);

  socket.on('explosion', (data) => { spawnExplosion(data.x, data.y); Sound.playExplosion(); });

  socket.on('hitSpark', (data) => {
    if (data.big) spawnHitSpark(data.x, data.y);
    Sound.playHit(Math.min(1.0, data.damage / 25));
  });

  socket.on('winner', (data) => {
    const names = ['Красный', 'Синий 🚛', 'Зелёный', 'Жёлтый 🚌'];
    if (!data) {
      winText.textContent = 'НИЧЬЯ!'; winText.style.color = '#ffffff'; Sound.playDefeat();
    } else if (data.id === myId) {
      winText.textContent = 'ТЫ ПОБЕДИЛ!'; winText.style.color = '#ffff00'; Sound.playVictory();
    } else {
      winText.textContent = `${data.isBot ? 'БОТ ' : ''}${names[data.index]} ПОБЕДИЛ!`;
      winText.style.color = '#ff9900'; Sound.playDefeat();
    }
    startCountdown(5);
  });

  socket.on('gameReset', () => {
    myBoosted = false; turboEl.classList.remove('active');
    winText.textContent = '';
    countdownText.style.display = 'none';
  });
}

// ── Клавиатура ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (!gameReady) return;
  const isUp   = e.code === 'ArrowUp'   || e.code === 'KeyW';
  const isDown = e.code === 'ArrowDown' || e.code === 'KeyS';

  if (isUp && upReleased) {
    upReleased = false;
    const now = Date.now();
    if (now - lastUpTime < 320 && !myBoosted) {
      myBoosted = true; socket.emit('setBoost', true);
      Sound.playEngineRev(); turboEl.classList.add('active');
    }
    lastUpTime = now;
  }
  if (isDown && downReleased) {
    downReleased = false;
    const now = Date.now();
    if (now - lastDownTime < 320 && myBoosted) {
      myBoosted = false; socket.emit('setBoost', false);
      Sound.playBrake(); turboEl.classList.remove('active');
    }
    lastDownTime = now;
  }
});

document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'ArrowUp'   || e.code === 'KeyW') upReleased   = true;
  if (e.code === 'ArrowDown' || e.code === 'KeyS') downReleased = true;
});

function sendInput() {
  if (!gameReady || !socket) return;
  const input = {
    up:    !!(keys['ArrowUp']    || keys['KeyW']),
    down:  !!(keys['ArrowDown']  || keys['KeyS']),
    left:  !!(keys['ArrowLeft']  || keys['KeyA']),
    right: !!(keys['ArrowRight'] || keys['KeyD']),
  };
  if (input.up !== lastInput.up || input.down !== lastInput.down ||
      input.left !== lastInput.left || input.right !== lastInput.right) {
    socket.emit('input', input);
    Object.assign(lastInput, input);
  }
}

// ── Главный цикл ─────────────────────────────────────────────────────────────
let prevTime = performance.now();

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt  = Math.min((now - prevTime) / 1000, 0.05);
  prevTime  = now;
  sendInput();
  updateParticles(dt);
  renderer.render(scene, camera);
}

animate();
setupSocket();
