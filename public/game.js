// Three.js Demolition Derby 3D Client

const ARENA_W = 1600, ARENA_H = 900, MAX_HP = 100;
const PLAYER_NAMES   = ['Красный', 'Синий', 'Зелёный', 'Жёлтый'];
const CAR_COLORS     = [0xff3333, 0x2277ff, 0x33cc33, 0xffcc00];
const CAR_COLOR_STRS = ['#ff5555', '#4499ff', '#55ee55', '#ffdd00'];

let socket, myId, myIndex, gameReady = false, myBoosted = false;
const cars = {}, keys = {}, particles = [], debris = [];
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
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.000038);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 1, 6000);
camera.position.set(ARENA_W / 2, 1250, ARENA_H / 2 + 750);
camera.lookAt(ARENA_W / 2, 0, ARENA_H / 2);

// ── Освещение ────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.65));

const sun = new THREE.DirectionalLight(0xffffff, 1.2);
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

// ── Городская карта ───────────────────────────────────────────────────────────
{
  const winMat  = new THREE.MeshLambertMaterial({ color: 0xffeebb, emissive: 0xffcc44, emissiveIntensity: 0.3 });
  const roofMat = lMat(0x222222);
  const curbMat = lMat(0xbbbbbb);
  const whiteM  = lMat(0xdddddd);
  const yellowM = lMat(0xffcc00);

  // Здание с окнами (все 4 стороны)
  const makeBuilding = (cx, cz, w, h, d, wallC) => {
    const g = new THREE.Group();
    g.add(_box(w, h, d, lMat(wallC), 0, h/2, 0, true));
    g.add(_box(w+8, 8, d+8, roofMat, 0, h+4, 0));
    g.add(_box(w+4, 10, 5, curbMat, 0, h+5,  d/2+3));
    g.add(_box(w+4, 10, 5, curbMat, 0, h+5, -d/2-3));
    g.add(_box(5, 10, d, curbMat, -w/2-3, h+5, 0));
    g.add(_box(5, 10, d, curbMat,  w/2+3, h+5, 0));
    const rows = Math.max(1, Math.floor((h-20)/45));
    const colsW = Math.max(2, Math.floor(w/50));
    const colsD = Math.max(1, Math.floor(d/50));
    for (let r = 0; r < rows; r++) {
      const wy = 25 + r * 45; if (wy > h-14) continue;
      for (let c = 0; c < colsW; c++) {
        const wx = -w/2 + (c+0.5)*(w/colsW);
        g.add(_box(18,14,1.5, winMat, wx, wy,  d/2+1));
        g.add(_box(18,14,1.5, winMat, wx, wy, -d/2-1));
      }
      for (let c = 0; c < colsD; c++) {
        const wz = -d/2 + (c+0.5)*(d/colsD);
        g.add(_box(1.5,14,18, winMat, -w/2-1, wy, wz));
        g.add(_box(1.5,14,18, winMat,  w/2+1, wy, wz));
      }
    }
    g.position.set(cx, 0, cz);
    scene.add(g);
  };

  const makeLamp = (x, z) => {
    const g = new THREE.Group();
    g.add(_cyl(3, 90, 8, lMat(0x999999), 0, 45, 0));
    g.add(_box(32, 5, 5, lMat(0x777777), 14, 91, 0));
    g.add(_box(14, 9, 14, new THREE.MeshBasicMaterial({ color: 0xffffd0 }), 25, 87, 0));
    g.position.set(x, 0, z);
    scene.add(g);
  };

  // ── Асфальт ──
  const flr = _box(6000, 1, 6000, lMat(0x191919), ARENA_W/2, -0.5, ARENA_H/2);
  flr.receiveShadow = true;
  scene.add(flr);

  // ── Тротуары вдоль зданий ──
  const swMat = lMat(0x686868);
  // Вокруг TL и BL (x: 0–600)
  scene.add(_box(600, 1.5, 30, swMat, 300, 0, 330));   // юг TL блока
  scene.add(_box(600, 1.5, 30, swMat, 300, 0, 570));   // север BL блока
  scene.add(_box(30, 1.5, 660, swMat, 600, 0, 450));   // восток левых блоков
  // Вокруг TR и BR (x: 1000–1600)
  scene.add(_box(600, 1.5, 30, swMat, 1300, 0, 330));
  scene.add(_box(600, 1.5, 30, swMat, 1300, 0, 570));
  scene.add(_box(30, 1.5, 660, swMat, 1000, 0, 450));
  // Центральный блок
  scene.add(_box(250, 1.5, 30, swMat, 800, 0, 360));
  scene.add(_box(250, 1.5, 30, swMat, 800, 0, 540));
  scene.add(_box(30, 1.5, 150, swMat, 715, 0, 450));
  scene.add(_box(30, 1.5, 150, swMat, 885, 0, 450));

  // ── Бордюры ──
  [[600, 6, 300, 330], [600, 6, 300, 570],
   [6, 660, 600, 450], [600, 6, 1300, 330],
   [600, 6, 1300, 570],[6, 660, 1000, 450]
  ].forEach(([w,d,x,z]) => scene.add(_box(w, 9, d, curbMat, x, 4, z)));

  // ── Дорожная разметка ──
  // Горизонтальная дорога z=330-570 (ширина 240)
  for (let x = 50; x < ARENA_W-30; x += 160)
    scene.add(_box(90, 1.6, 5, whiteM, x, 0, 450));
  // Вертикальная дорога x=600-1000 (ширина 400)
  for (let z = 50; z < 330; z += 140)
    scene.add(_box(5, 1.6, 80, whiteM, 800, 0, z));
  for (let z = 570; z < ARENA_H-30; z += 140)
    scene.add(_box(5, 1.6, 80, whiteM, 800, 0, z));
  // Жёлтые разделительные
  scene.add(_box(ARENA_W, 1.6, 4, yellowM, ARENA_W/2, 0, 330));
  scene.add(_box(ARENA_W, 1.6, 4, yellowM, ARENA_W/2, 0, 570));
  scene.add(_box(4, 1.6, 330, yellowM, 600, 0, 165));
  scene.add(_box(4, 1.6, 330, yellowM, 1000, 0, 165));
  scene.add(_box(4, 1.6, 330, yellowM, 600, 0, 735));
  scene.add(_box(4, 1.6, 330, yellowM, 1000, 0, 735));

  // ── ГЛАВНЫЕ ЗДАНИЯ (совпадают с физическими препятствиями сервера) ──
  makeBuilding(390,  190, 420, 200, 280, 0x8b6a4a);  // TL
  makeBuilding(1210, 190, 420, 230, 280, 0x5a6a7a);  // TR
  makeBuilding(390,  710, 420, 180, 280, 0x6a7a5a);  // BL
  makeBuilding(1210, 710, 420, 210, 280, 0x8a5a5a);  // BR
  makeBuilding(800,  450, 180, 110, 180, 0x888888);  // центр

  // ── Фонари вдоль улиц ──
  [
    [630, 310], [800, 310], [970, 310],
    [630, 590], [800, 590], [970, 590],
    [180, 350], [180, 450], [180, 550],
    [1420, 350],[1420, 450],[1420, 550],
    [390, 50],  [800, 50],  [1210, 50],
    [390, 850], [800, 850], [1210, 850],
  ].forEach(([x, z]) => makeLamp(x, z));

  // ── Задние здания (фон за стенами) ──
  const bg = (cx,cz,w,h,d,c) => makeBuilding(cx,cz,w,h,d,c);
  bg(155, -85, 240, 210, 110, 0x9a7a5a); bg(490, -80, 200, 270, 100, 0x5a6a8a);
  bg(800, -95, 190, 350, 120, 0xa09070); bg(1110,-80, 210, 250, 100, 0x7a6a9a);
  bg(1440,-85, 250, 190, 110, 0x9a4a4a);
  bg(200, ARENA_H+85, 220,160,110, 0x5a8a6a); bg(600,ARENA_H+80,200,200,100, 0x7a9a5a);
  bg(1000,ARENA_H+85,210,190,110, 0x5a5a9a); bg(1400,ARENA_H+82,230,150,110, 0x4a8a8a);
  bg(-90, 200, 110,240,270, 0x7a6a5a); bg(-85, 660, 100,190,230, 0x5a7a6a);
  bg(ARENA_W+90,200,110,260,270, 0x9a5a5a); bg(ARENA_W+85,660,100,210,230, 0x6a9a5a);
  bg(-90,-90,190,300,190, 0x9a5a4a); bg(ARENA_W+90,-90,190,275,190, 0x4a5a9a);
  bg(-90,ARENA_H+90,190,235,190, 0x4a9a5a); bg(ARENA_W+90,ARENA_H+90,190,255,190, 0x9a4a5a);

  // ── Периметральные стены-барьеры ──
  const wallH = 40, wallT = 22;
  const barrMat = lMat(0x888888);
  const orMat = new THREE.MeshLambertMaterial({ color: 0xff7700, emissive: 0xff4400, emissiveIntensity: 0.4 });
  [
    [[ARENA_W+wallT*2, wallH, wallT], [ARENA_W/2, wallH/2, -wallT/2]],
    [[ARENA_W+wallT*2, wallH, wallT], [ARENA_W/2, wallH/2, ARENA_H+wallT/2]],
    [[wallT, wallH, ARENA_H],         [-wallT/2, wallH/2, ARENA_H/2]],
    [[wallT, wallH, ARENA_H],         [ARENA_W+wallT/2, wallH/2, ARENA_H/2]],
  ].forEach(([s, p]) => {
    const wm = new THREE.Mesh(new THREE.BoxGeometry(...s), barrMat);
    wm.position.set(...p); wm.castShadow = true; wm.receiveShadow = true;
    scene.add(wm);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(s[0],10,s[2]+1), orMat);
    stripe.position.set(p[0], p[1]+wallH/2-5, p[2]);
    scene.add(stripe);
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
  const bg = _box(64, 4, 8, new THREE.MeshBasicMaterial({ color: 0x222222 }), 0, yPos, 0);
  bg._isHpBar = true;
  group.add(bg);
  const geo = new THREE.BoxGeometry(60, 3, 6);
  geo.translate(30, 0, 0);
  const fill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00dd00 }));
  fill.position.set(-30, yPos, 0);
  fill._isHpBar = true;
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

// ── Обломки (постоянные запчасти) ────────────────────────────────────────────
function updateDebris(dt) {
  for (const d of debris) {
    if (d.settled) continue;
    d.vy -= 420 * dt;
    d.mesh.position.x += d.vx * dt;
    d.mesh.position.y += d.vy * dt;
    d.mesh.position.z += d.vz * dt;
    d.mesh.rotation.x += d.rx * dt;
    d.mesh.rotation.y += d.ry * dt;
    d.mesh.rotation.z += d.rz * dt;

    if (d.mesh.position.y <= d.groundY) {
      d.mesh.position.y = d.groundY;
      if (Math.abs(d.vy) > 22) {
        d.vy *= -0.28;
        d.vx *= 0.70; d.vz *= 0.70;
        d.rx *= 0.55; d.ry *= 0.55; d.rz *= 0.55;
      } else {
        d.vy = 0;
        const sf = Math.pow(0.10, dt), rf = Math.pow(0.04, dt);
        d.vx *= sf; d.vz *= sf;
        d.rx *= rf; d.ry *= rf; d.rz *= rf;
        if (Math.abs(d.vx) < 2 && Math.abs(d.vz) < 2) d.settled = true;
      }
    }
    if (d.mesh.position.x < 8)         { d.mesh.position.x = 8;         d.vx =  Math.abs(d.vx) * 0.4; }
    if (d.mesh.position.x > ARENA_W-8) { d.mesh.position.x = ARENA_W-8; d.vx = -Math.abs(d.vx) * 0.4; }
    if (d.mesh.position.z < 8)         { d.mesh.position.z = 8;         d.vz =  Math.abs(d.vz) * 0.4; }
    if (d.mesh.position.z > ARENA_H-8) { d.mesh.position.z = ARENA_H-8; d.vz = -Math.abs(d.vz) * 0.4; }
  }
}

function clearDebris() {
  for (const d of debris) scene.remove(d.mesh);
  debris.length = 0;
}

function spawnCarDebris(x, z, carIdx) {
  const color = CAR_COLORS[carIdx] ?? 0xaaaaaa;

  const addPart = (geo, matColor, transparent, groundY, hSpd, upMin, upMax) => {
    const mat = transparent
      ? new THREE.MeshLambertMaterial({ color: matColor, transparent: true, opacity: 0.7 })
      : new THREE.MeshLambertMaterial({ color: matColor });
    const angle = Math.random() * Math.PI * 2;
    const sp = hSpd * (0.5 + Math.random() * 0.9);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (Math.random()-.5)*18, 14 + Math.random()*8, z + (Math.random()-.5)*18);
    mesh.rotation.set(Math.random()*Math.PI*2, Math.random()*Math.PI*2, Math.random()*Math.PI*2);
    scene.add(mesh);
    debris.push({
      mesh, groundY, settled: false,
      vx: Math.cos(angle) * sp,
      vy: upMin + Math.random() * (upMax - upMin),
      vz: Math.sin(angle) * sp,
      rx: (Math.random()-.5) * 9,
      ry: (Math.random()-.5) * 9,
      rz: (Math.random()-.5) * 9,
    });
  };

  const wheelCount = (carIdx === 1 || carIdx === 3) ? 6 : 4;
  for (let i = 0; i < wheelCount; i++)
    addPart(new THREE.CylinderGeometry(7, 7, 8, 14), color, false, 7, 190, 170, 310);

  for (let i = 0; i < 4; i++)
    addPart(new THREE.BoxGeometry(16+Math.random()*22, 5, 10+Math.random()*16), color, false, 2.5, 230, 200, 330);

  addPart(new THREE.BoxGeometry(30, 10, 22), color, false, 5, 185, 230, 350);

  for (let i = 0; i < 2; i++)
    addPart(new THREE.BoxGeometry(7, 8, 30), color, false, 4, 165, 155, 275);

  for (let i = 0; i < 3; i++)
    addPart(new THREE.BoxGeometry(13, 2, 11), color, true, 1, 200, 185, 305);

  addPart(new THREE.BoxGeometry(15, 14, 15), color, false, 7, 145, 150, 240);

  for (let i = 0; i < 3; i++)
    addPart(new THREE.BoxGeometry(8+Math.random()*8, 3, 6+Math.random()*8), color, false, 1.5, 175, 140, 260);
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
      const inner = buildCar(p.index, p.id === myId, p.isBot);
      const outer = new THREE.Group();
      outer.add(inner);
      scene.add(outer);
      cars[p.id] = { group: outer, inner, tiltX: 0, tiltZ: 0, tiltVX: 0, tiltVZ: 0, prevHp: MAX_HP };
    }
    const car = cars[p.id];
    car.group.position.set(p.x, 0, p.y);
    car.group.rotation.y = -p.angle;

    // Деформация кузова по мере урона
    const dmg = 1 - p.hp / MAX_HP;
    car.inner.scale.y = 2 * Math.max(0.45, 1 - dmg * 0.50);
    car.inner.scale.x = 2 * (1 + dmg * 0.30);
    car.inner.scale.z = 2 * (1 + dmg * 0.20);

    // Удар → импульс опрокидывания
    if (p.hp < car.prevHp) {
      const drop = car.prevHp - p.hp;
      if (drop > 1) {
        const mag = Math.min(drop * 0.05, 1.4);
        car.tiltVX += (Math.random() - 0.5) * mag * 8;
        car.tiltVZ += (Math.random() - 0.5) * mag * 8;
        deformCarParts(car.inner, drop);
      }
    }
    car.prevHp = p.hp;

    updateHpBar(car.inner, p.hp / MAX_HP);

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

  socket.on('explosion', (data) => {
    spawnExplosion(data.x, data.y);
    spawnCarDebris(data.x, data.y, data.index ?? 0);
    Sound.playExplosion();
  });

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
    clearDebris();
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

// ── Деформация деталей кузова ────────────────────────────────────────────────
function deformCarParts(inner, damage) {
  const parts = inner.children.filter(c => c.isMesh && !c._isHpBar);
  if (!parts.length) return;
  const count = Math.min(Math.ceil(damage * 0.6), 5);
  const bend = Math.min(damage * 0.006, 0.18);
  for (let i = 0; i < count; i++) {
    const p = parts[Math.floor(Math.random() * parts.length)];
    p.rotation.x += (Math.random() - 0.5) * bend * 5;
    p.rotation.z += (Math.random() - 0.5) * bend * 5;
    p.position.x  += (Math.random() - 0.5) * bend * 12;
    p.position.y  -= Math.random() * bend * 8;
    p.position.z  += (Math.random() - 0.5) * bend * 12;
  }
}

// ── Физика наклона/опрокидывания ─────────────────────────────────────────────
function updateCarTilts(dt) {
  for (const id in cars) {
    const car = cars[id];
    if (!car.inner) continue;

    const hpR = (car.prevHp ?? MAX_HP) / MAX_HP;
    const spring = hpR > 0.40 ? 3.5 : hpR > 0.18 ? 1.0 : 0.12;
    const damp   = 3.0;

    car.tiltVX += (-car.tiltX * spring - car.tiltVX * damp) * dt;
    car.tiltVZ += (-car.tiltZ * spring - car.tiltVZ * damp) * dt;
    car.tiltX  += car.tiltVX * dt;
    car.tiltZ  += car.tiltVZ * dt;

    const maxT = hpR > 0.28 ? 0.95 : Math.PI * 0.95;
    car.tiltX = Math.max(-maxT, Math.min(maxT, car.tiltX));
    car.tiltZ = Math.max(-maxT, Math.min(maxT, car.tiltZ));

    car.inner.rotation.x = car.tiltX;
    car.inner.rotation.z = car.tiltZ;

    // Подъём над землёй чтобы не уходить под текстуру
    const lift = 30 * (Math.abs(Math.sin(car.tiltX)) + Math.abs(Math.sin(car.tiltZ)));
    car.inner.position.y = lift;
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
  updateDebris(dt);
  updateCarTilts(dt);
  renderer.render(scene, camera);
}

animate();
setupSocket();
