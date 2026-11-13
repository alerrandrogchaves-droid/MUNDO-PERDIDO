const socket = io('http://localhost:3000');

/* =====================================================
   ELEMENTOS DA PÁGINA
===================================================== */
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const areaCanvas = document.getElementById('areaCanvas');

const elStatus = document.getElementById('status');
const elOnline = document.getElementById('jogadoresOnline');
const elVidaBarra = document.getElementById('vidaBarra');
const elVidaTexto = document.getElementById('vidaTexto');
const elNivel = document.getElementById('nivel');
const elXpBarra = document.getElementById('xpBarra');
const elXpTexto = document.getElementById('xpTexto');
const elEquipamento = document.getElementById('equipamento');
const elInventario = document.getElementById('inventario');
const elAtrDano = document.getElementById('atrDano');
const elAtrDefesa = document.getElementById('atrDefesa');
const elMensagens = document.getElementById('mensagens');
const elAviso = document.getElementById('aviso');
const elAvisoTexto = document.getElementById('avisoTexto');

const nightCanvas = document.createElement('canvas');
const nightCtx = nightCanvas.getContext('2d');

/* =====================================================
   CONSTANTES
===================================================== */
const RAIO_JOGADOR = 14;
const VEL_ANDAR = 150;
const VEL_CORRER = 260;
const INTERVALO_ATAQUE = 350;
const DURACAO_ATAQUE = 220;
const DURACAO_DIA = 180; // segundos para um ciclo completo
const MAX_INVENTARIO = 12;
const MINI_W = 180;
const MINI_H = 135;

const ICONES = { arma: '⚔️', armadura: '🛡️', artefato: '🔮' };
const NOMES_SLOT = { arma: 'Arma', armadura: 'Armadura', artefato: 'Artefato' };
const CORES_SLIME = ['#5fd35f', '#4fb7d6', '#c46fd6'];

/* =====================================================
   ESTADO
===================================================== */
let meuId = null;
let mundo = { largura: 2400, altura: 1800 };
let rio = null;
let estrada = null;
let ponte = null;
let arvores = [];
let pedras = [];
const slimes = new Map();
const jogadores = new Map();
let eu = null;
let prontoParaJogar = false;

let statusJogador = {
  vida: 100, vidaMax: 100, nivel: 1, xp: 0, xpProx: 50,
  inventario: [], equip: { arma: null, armadura: null, artefato: null },
  dano: 0, defesa: 0
};

const teclas = {};
const camera = { x: 0, y: 0 };
const particulas = [];
const textos = [];

let fundoMundo = null;
let fundoMini = null;
let tempoJogo = 0;
let relogio = 0;
let proximoAtaque = 0;
let ultimoEnvio = 0;
let ultimoEstado = '';
let flashDano = 0;

/* =====================================================
   TELA / REDIMENSIONAMENTO
===================================================== */
function redimensionar() {
  canvas.width = areaCanvas.clientWidth;
  canvas.height = areaCanvas.clientHeight;
  nightCanvas.width = canvas.width;
  nightCanvas.height = canvas.height;
}
window.addEventListener('resize', redimensionar);
redimensionar();

/* =====================================================
   TECLADO
===================================================== */
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
  teclas[e.code] = true;
});

window.addEventListener('keyup', (e) => {
  teclas[e.code] = false;
});

window.addEventListener('blur', () => {
  for (const k in teclas) teclas[k] = false;
});

/* =====================================================
   SOCKET.IO
===================================================== */
socket.on('connect', () => {
  elStatus.textContent = '● Conectado';
  elStatus.className = 'online';
});

socket.on('disconnect', () => {
  elStatus.textContent = '● Desconectado';
  elStatus.className = 'offline';
  prontoParaJogar = false;
  elAvisoTexto.textContent = 'Conexão perdida. Tentando reconectar...';
  elAviso.classList.remove('oculto');
});

socket.on('connect_error', () => {
  elStatus.textContent = '● Erro de conexão';
  elStatus.className = 'offline';
  elAvisoTexto.textContent =
    'Não foi possível conectar em http://localhost:3000. Verifique se o servidor está rodando (node server.js).';
  elAviso.classList.remove('oculto');
});

socket.on('dadosIniciais', (d) => {
  meuId = d.meuId;
  mundo = d.mundo;
  rio = d.rio;
  estrada = d.estrada;
  ponte = d.ponte;
  arvores = d.arvores;
  pedras = d.pedras;

  slimes.clear();
  d.slimes.forEach((s) => slimes.set(s.id, criarSlimeLocal(s)));

  jogadores.clear();
  d.jogadores.forEach((j) => jogadores.set(j.id, criarJogadorLocal(j)));
  eu = jogadores.get(meuId);

  statusJogador = d.status;

  construirFundo();
  construirMinimapa();
  atualizarHUD();
  atualizarPainel();

  elAviso.classList.add('oculto');
  prontoParaJogar = true;
});

socket.on('online', (n) => {
  elOnline.textContent = n;
});

socket.on('jogadorEntrou', (j) => {
  jogadores.set(j.id, criarJogadorLocal(j));
});

socket.on('jogadorSaiu', (id) => {
  jogadores.delete(id);
});

socket.on('jogadorMoveu', (d) => {
  if (d.id === meuId) {
    return;
  }
  const j = jogadores.get(d.id);
  if (!j) return;
  j.alvoX = d.x;
  j.alvoY = d.y;
  j.angulo = d.angulo;
  j.correndo = d.correndo;
});

socket.on('corrigirPosicao', (d) => {
  if (!eu) return;
  eu.x = d.x;
  eu.y = d.y;
  ultimoEstado = '';
});

socket.on('jogadorAtacou', (d) => {
  if (d.id === meuId) return;
  const j = jogadores.get(d.id);
  if (!j) return;
  j.angulo = d.angulo;
  j.atacandoAte = relogio + DURACAO_ATAQUE;
});

socket.on('jogadorNivel', (d) => {
  const j = jogadores.get(d.id);
  if (j) j.nivel = d.nivel;
});

socket.on('slimes', (lista) => {
  for (const d of lista) {
    const s = slimes.get(d.id);
    if (!s) continue;
    s.alvoX = d.x;
    s.alvoY = d.y;
    s.vida = d.vida;
    s.morto = d.morto;
  }
});

socket.on('slimeDano', (d) => {
  const s = slimes.get(d.id);
  if (s) {
    s.vida = d.vida;
    s.vidaMax = d.vidaMax;
    s.flash = 0.15;
  }
  criarParticulas(d.x, d.y - 10, 8, ['#ffffff', '#b6ff9e', '#7be07b'], 130);
  criarTexto(d.x, d.y - 34, String(d.dano), '#ffe14d', 18);
});

socket.on('slimeMorreu', (d) => {
  const s = slimes.get(d.id);
  if (s) {
    s.morto = true;
    s.vida = 0;
  }
  criarParticulas(d.x, d.y - 8, 24, ['#5fd35f', '#8cf08c', '#ffffff', '#3a9a3a'], 190);
});

socket.on('slimeRenasceu', (d) => {
  const s = slimes.get(d.id);
  if (!s) return;
  s.x = d.x;
  s.y = d.y;
  s.alvoX = d.x;
  s.alvoY = d.y;
  s.vida = d.vida;
  s.vidaMax = d.vidaMax;
  s.morto = false;
  criarParticulas(d.x, d.y - 8, 12, ['#ffffff', '#b6ff9e'], 90);
});

socket.on('status', (d) => {
  statusJogador = d;
  atualizarHUD();
  atualizarPainel();
});

socket.on('jogadorDano', (d) => {
  criarTexto(d.x, d.y - 40, '-' + d.dano, '#ff5a5a', 18);
  if (d.id === meuId) flashDano = 0.35;
});

socket.on('subiuNivel', () => {
  if (!eu) return;
  criarTexto(eu.x, eu.y - 60, 'NÍVEL UP!', '#ffd76a', 22);
  criarParticulas(eu.x, eu.y - 10, 30, ['#ffd76a', '#fff3b0', '#ffffff'], 200);
});

socket.on('mensagem', (texto) => {
  mostrarMensagem(texto);
});

/* =====================================================
   CRIAÇÃO DE ENTIDADES LOCAIS
===================================================== */
function criarJogadorLocal(d) {
  return {
    id: d.id,
    nome: d.nome,
    x: d.x,
    y: d.y,
    alvoX: d.x,
    alvoY: d.y,
    angulo: d.angulo || 0,
    correndo: !!d.correndo,
    cor: d.cor,
    nivel: d.nivel || 1,
    andando: false,
    anim: 0,
    atacandoAte: 0
  };
}

function criarSlimeLocal(d) {
  return {
    id: d.id,
    x: d.x,
    y: d.y,
    alvoX: d.x,
    alvoY: d.y,
    raio: d.raio,
    nivel: d.nivel,
    vida: d.vida,
    vidaMax: d.vidaMax,
    morto: d.morto,
    flash: 0,
    fase: Math.random() * 10
  };
}

/* =====================================================
   HUD E PAINEL
===================================================== */
function atualizarHUD() {
  const s = statusJogador;
  elNivel.textContent = s.nivel;

  const pct = Math.max(0, Math.min(100, (s.vida / s.vidaMax) * 100));
  elVidaBarra.style.width = pct + '%';
  elVidaBarra.style.background = pct > 50 ? '#3fbf4a' : pct > 25 ? '#e0a020' : '#d63b3b';
  elVidaTexto.textContent = `${Math.ceil(s.vida)} / ${s.vidaMax}`;

  const pctXp = Math.max(0, Math.min(100, (s.xp / s.xpProx) * 100));
  elXpBarra.style.width = pctXp + '%';
  elXpTexto.textContent = `${s.xp} / ${s.xpProx} XP`;
}

function descricaoBonus(item) {
  if (item.tipo === 'arma') return `+${item.bonus} de dano`;
  if (item.tipo === 'armadura') return `+${item.bonus} de defesa`;
  return `+${item.bonus} de vida máx.`;
}

function criarElItem(item, aoClicar) {
  const el = document.createElement('div');
  el.className = 'item r-' + item.raridade;
  el.textContent = ICONES[item.tipo];
  el.title = `${item.nome} (${item.raridade})\n${descricaoBonus(item)}`;
  el.addEventListener('click', aoClicar);
  return el;
}

function atualizarPainel() {
  const s = statusJogador;

  // Equipamento
  elEquipamento.innerHTML = '';
  ['arma', 'armadura', 'artefato'].forEach((tipo) => {
    const slot = document.createElement('div');
    slot.className = 'slot-equip';

    const caixa = document.createElement('div');
    caixa.className = 'caixa';

    const item = s.equip ? s.equip[tipo] : null;
    if (item) {
      caixa.appendChild(criarElItem(item, () => socket.emit('desequipar', tipo)));
    }

    const rotulo = document.createElement('span');
    rotulo.textContent = NOMES_SLOT[tipo];

    slot.appendChild(caixa);
    slot.appendChild(rotulo);
    elEquipamento.appendChild(slot);
  });

  elAtrDano.textContent = s.dano;
  elAtrDefesa.textContent = s.defesa;

  // Inventário
  elInventario.innerHTML = '';
  for (let i = 0; i < MAX_INVENTARIO; i++) {
    const slot = document.createElement('div');
    slot.className = 'slot-inv';
    const item = s.inventario[i];
    if (item) {
      slot.appendChild(criarElItem(item, () => socket.emit('equipar', i)));
    }
    elInventario.appendChild(slot);
  }
}

function mostrarMensagem(texto) {
  const el = document.createElement('div');
  el.className = 'mensagem';
  el.textContent = texto;
  elMensagens.appendChild(el);
  setTimeout(() => el.remove(), 3600);
  while (elMensagens.children.length > 4) {
    elMensagens.removeChild(elMensagens.firstChild);
  }
}

/* =====================================================
   PARTÍCULAS E TEXTOS FLUTUANTES
===================================================== */
function criarParticulas(x, y, quantidade, cores, velocidade) {
  for (let i = 0; i < quantidade; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = velocidade * (0.3 + Math.random() * 0.7);
    const vida = 0.5 + Math.random() * 0.5;
    particulas.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 40,
      vida,
      max: vida,
      cor: cores[Math.floor(Math.random() * cores.length)],
      tam: 2 + Math.random() * 3
    });
  }
  while (particulas.length > 400) particulas.shift();
}

function criarTexto(x, y, texto, cor, tam) {
  textos.push({
    x: x + (Math.random() * 16 - 8),
    y,
    texto,
    cor,
    tam: tam || 16,
    vida: 1
  });
}

/* =====================================================
   COLISÃO (cliente)
===================================================== */
function posicaoLivre(x, y) {
  const r = RAIO_JOGADOR;
  if (x < r || y < r || x > mundo.largura - r || y > mundo.altura - r) return false;

  // Rio: só dá para atravessar pela ponte
  if (x + r > rio.x && x - r < rio.x + rio.w) {
    if (!(y - r >= ponte.y && y + r <= ponte.y + ponte.h)) return false;
  }

  for (let i = 0; i < arvores.length; i++) {
    const a = arvores[i];
    if (Math.abs(a.x - x) > 60 || Math.abs(a.y - y) > 60) continue;
    if (Math.hypot(x - a.x, y - a.y) < r + a.raio) return false;
  }
  for (let i = 0; i < pedras.length; i++) {
    const p = pedras[i];
    if (Math.abs(p.x - x) > 60 || Math.abs(p.y - y) > 60) continue;
    if (Math.hypot(x - p.x, y - p.y) < r + p.raio) return false;
  }
  return true;
}

/* =====================================================
   LÓGICA DE ATUALIZAÇÃO
===================================================== */
function moverJogadorLocal(dt) {
  let dx = 0;
  let dy = 0;
  if (teclas['KeyW'] || teclas['ArrowUp']) dy -= 1;
  if (teclas['KeyS'] || teclas['ArrowDown']) dy += 1;
  if (teclas['KeyA'] || teclas['ArrowLeft']) dx -= 1;
  if (teclas['KeyD'] || teclas['ArrowRight']) dx += 1;

  const movendo = dx !== 0 || dy !== 0;
  eu.correndo = movendo && (!!teclas['ShiftLeft'] || !!teclas['ShiftRight']);

  if (movendo) {
    const len = Math.hypot(dx, dy);
    dx /= len;
    dy /= len;
    const vel = eu.correndo ? VEL_CORRER : VEL_ANDAR;
    const nx = eu.x + dx * vel * dt;
    const ny = eu.y + dy * vel * dt;

    // Segurança extra: se por algum motivo estiver preso, move sem colisão
    const preso = !posicaoLivre(eu.x, eu.y);
    if (preso) {
      eu.x = Math.max(RAIO_JOGADOR, Math.min(mundo.largura - RAIO_JOGADOR, nx));
      eu.y = Math.max(RAIO_JOGADOR, Math.min(mundo.altura - RAIO_JOGADOR, ny));
    } else {
      if (posicaoLivre(nx, eu.y)) eu.x = nx;
      if (posicaoLivre(eu.x, ny)) eu.y = ny;
    }

    eu.angulo = Math.atan2(dy, dx);
    eu.andando = true;
    eu.anim += dt;
  } else {
    eu.andando = false;
  }
}

function tentarAtacar() {
  if (relogio < proximoAtaque || !socket.connected) return;
  proximoAtaque = relogio + INTERVALO_ATAQUE;
  eu.atacandoAte = relogio + DURACAO_ATAQUE;
  socket.emit('atacar', { angulo: eu.angulo });
}

function enviarPosicao() {
  if (!socket.connected) return;
  if (relogio - ultimoEnvio < 50) return;
  const estado = `${Math.round(eu.x)}|${Math.round(eu.y)}|${eu.angulo.toFixed(2)}|${eu.correndo ? 1 : 0}`;
  if (estado === ultimoEstado) return;
  ultimoEnvio = relogio;
  ultimoEstado = estado;
  socket.emit('mover', { x: eu.x, y: eu.y, angulo: eu.angulo, correndo: eu.correndo });
}

function atualizar(dt) {
  tempoJogo += dt;

  moverJogadorLocal(dt);
  if (teclas['Space']) tentarAtacar();
  enviarPosicao();

  // Outros jogadores (interpolação suave)
  const k = 1 - Math.exp(-dt * 14);
  for (const j of jogadores.values()) {
    if (j.id === meuId) continue;
    const dx = j.alvoX - j.x;
    const dy = j.alvoY - j.y;
    j.andando = Math.hypot(dx, dy) > 1;
    j.x += dx * k;
    j.y += dy * k;
    if (j.andando) j.anim += dt;
  }

  // Slimes
  for (const s of slimes.values()) {
    s.x += (s.alvoX - s.x) * k;
    s.y += (s.alvoY - s.y) * k;
    if (s.flash > 0) s.flash -= dt;
  }

  // Partículas
  for (let i = particulas.length - 1; i >= 0; i--) {
    const p = particulas[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
    p.vida -= dt;
    if (p.vida <= 0) particulas.splice(i, 1);
  }

  // Textos flutuantes
  for (let i = textos.length - 1; i >= 0; i--) {
    const t = textos[i];
    t.y -= 45 * dt;
    t.vida -= dt * 0.9;
    if (t.vida <= 0) textos.splice(i, 1);
  }

  if (flashDano > 0) flashDano -= dt;

  // Câmera centralizada no jogador
  const W = canvas.width;
  const H = canvas.height;
  camera.x = W >= mundo.largura
    ? (mundo.largura - W) / 2
    : Math.max(0, Math.min(mundo.largura - W, eu.x - W / 2));
  camera.y = H >= mundo.altura
    ? (mundo.altura - H) / 2
    : Math.max(0, Math.min(mundo.altura - H, eu.y - H / 2));
}

/* =====================================================
   FUNDO PRÉ-RENDERIZADO (grama, estrada, rio, ponte)
===================================================== */
function construirFundo() {
  fundoMundo = document.createElement('canvas');
  fundoMundo.width = mundo.largura;
  fundoMundo.height = mundo.altura;
  const c = fundoMundo.getContext('2d');

  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  // Grama
  c.fillStyle = '#4a9c3f';
  c.fillRect(0, 0, mundo.largura, mundo.altura);
  for (let y = 0; y < mundo.altura; y += 40) {
    for (let x = 0; x < mundo.largura; x += 40) {
      c.fillStyle = rnd() < 0.5 ? '#4fa543' : '#459637';
      c.fillRect(x, y, 40, 40);
    }
  }
  for (let i = 0; i < 2200; i++) {
    const x = rnd() * mundo.largura;
    const y = rnd() * mundo.altura;
    c.strokeStyle = rnd() < 0.5 ? '#3d8a32' : '#5cb04c';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + (rnd() * 4 - 2), y - 5 - rnd() * 4);
    c.stroke();
  }
  const coresFlores = ['#ffffff', '#ffe14d', '#ff8fb1', '#b9a2ff'];
  for (let i = 0; i < 260; i++) {
    c.fillStyle = coresFlores[Math.floor(rnd() * coresFlores.length)];
    c.beginPath();
    c.arc(rnd() * mundo.largura, rnd() * mundo.altura, 2.2, 0, Math.PI * 2);
    c.fill();
  }

  // Estrada
  c.fillStyle = '#b79b6b';
  c.fillRect(estrada.x, estrada.y, estrada.w, estrada.h);
  c.fillStyle = '#9d835a';
  c.fillRect(estrada.x, estrada.y, estrada.w, 6);
  c.fillRect(estrada.x, estrada.y + estrada.h - 6, estrada.w, 6);
  for (let i = 0; i < 700; i++) {
    c.fillStyle = rnd() < 0.5 ? '#a68c5e' : '#c7ad7c';
    c.fillRect(rnd() * estrada.w, estrada.y + 8 + rnd() * (estrada.h - 16), 3, 2);
  }

  // Rio
  c.fillStyle = '#d9c98a';
  c.fillRect(rio.x - 9, rio.y, rio.w + 18, rio.h);
  c.fillStyle = '#2f7fd1';
  c.fillRect(rio.x, rio.y, rio.w, rio.h);
  c.fillStyle = '#3d92e6';
  c.fillRect(rio.x + 20, rio.y, rio.w - 40, rio.h);
  c.strokeStyle = 'rgba(255,255,255,0.35)';
  c.lineWidth = 2;
  for (let i = 0; i < 160; i++) {
    const x = rio.x + 10 + rnd() * (rio.w - 20);
    const y = rnd() * rio.h;
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + 6, y - 4, x + 14, y);
    c.stroke();
  }

  // Ponte
  c.fillStyle = '#8b5a2b';
  c.fillRect(ponte.x, ponte.y, ponte.w, ponte.h);
  c.strokeStyle = '#6d431c';
  c.lineWidth = 2;
  for (let x = ponte.x + 8; x < ponte.x + ponte.w; x += 12) {
    c.beginPath();
    c.moveTo(x, ponte.y + 8);
    c.lineTo(x, ponte.y + ponte.h - 8);
    c.stroke();
  }
  c.fillStyle = '#5c3a1a';
  c.fillRect(ponte.x, ponte.y, ponte.w, 10);
  c.fillRect(ponte.x, ponte.y + ponte.h - 10, ponte.w, 10);
  for (let x = ponte.x + 4; x < ponte.x + ponte.w; x += 28) {
    c.fillRect(x, ponte.y - 6, 6, 18);
    c.fillRect(x, ponte.y + ponte.h - 12, 6, 18);
  }
}

function construirMinimapa() {
  fundoMini = document.createElement('canvas');
  fundoMini.width = MINI_W;
  fundoMini.height = MINI_H;
  const c = fundoMini.getContext('2d');
  const ex = MINI_W / mundo.largura;
  const ey = MINI_H / mundo.altura;

  c.fillStyle = '#3f8a37';
  c.fillRect(0, 0, MINI_W, MINI_H);

  c.fillStyle = '#b79b6b';
  c.fillRect(estrada.x * ex, estrada.y * ey, estrada.w * ex, estrada.h * ey);

  c.fillStyle = '#2f7fd1';
  c.fillRect(rio.x * ex, rio.y * ey, rio.w * ex, rio.h * ey);

  c.fillStyle = '#8b5a2b';
  c.fillRect(ponte.x * ex, ponte.y * ey, ponte.w * ex, ponte.h * ey);

  c.fillStyle = '#1f5a24';
  arvores.forEach((a) => c.fillRect(a.x * ex - 1, a.y * ey - 1, 3, 3));
  c.fillStyle = '#8a8a8a';
  pedras.forEach((p) => c.fillRect(p.x * ex - 1, p.y * ey - 1, 2, 2));
}

/* =====================================================
   DESENHO DAS ENTIDADES
===================================================== */
function elipse(x, y, rx, ry, cor) {
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

function circulo(x, y, r, cor) {
  ctx.fillStyle = cor;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function textoContornado(texto, x, y, fonte, cor) {
  ctx.font = fonte;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(texto, x, y);
  ctx.fillStyle = cor;
  ctx.fillText(texto, x, y);
}

function desenharArvore(a) {
  const { x, y, escala } = a;
  const paletas = [
    ['#2e7d32', '#43a047', '#66bb6a'],
    ['#1b6b3a', '#2e8b57', '#4cae78'],
    ['#3f7f1f', '#5a9f2a', '#7cbf47']
  ];
  const p = paletas[a.tipo];

  elipse(x, y + 4, 26 * escala, 9 * escala, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(x - 6 * escala, y - 34 * escala, 12 * escala, 38 * escala);
  ctx.fillStyle = '#58381c';
  ctx.fillRect(x + 1 * escala, y - 34 * escala, 5 * escala, 38 * escala);

  circulo(x, y - 48 * escala, 30 * escala, p[0]);
  circulo(x - 17 * escala, y - 38 * escala, 20 * escala, p[1]);
  circulo(x + 17 * escala, y - 38 * escala, 20 * escala, p[1]);
  circulo(x - 6 * escala, y - 58 * escala, 16 * escala, p[2]);
}

function desenharPedra(p) {
  const { x, y, raio } = p;
  elipse(x, y + raio * 0.35, raio * 1.1, raio * 0.5, 'rgba(0,0,0,0.28)');
  elipse(x, y - raio * 0.2, raio * 1.05, raio * 0.85, p.tipo === 0 ? '#8d8d8d' : '#7b7f86');
  elipse(x - raio * 0.25, y - raio * 0.5, raio * 0.5, raio * 0.35, p.tipo === 0 ? '#b3b3b3' : '#a1a7ae');
}

function desenharSlime(s) {
  const t = relogio / 300 + s.fase;
  const quica = Math.sin(t);
  const r = 14 + s.nivel * 2;
  const largura = r * (1.1 + quica * 0.08);
  const altura = r * (0.9 - quica * 0.08);
  const x = s.x;
  const y = s.y;

  elipse(x, y + 4, largura * 0.95, 5, 'rgba(0,0,0,0.3)');

  const corBase = s.flash > 0 ? '#ffffff' : CORES_SLIME[(s.nivel - 1) % CORES_SLIME.length];
  ctx.fillStyle = corBase;
  ctx.beginPath();
  ctx.ellipse(x, y - altura * 0.7 + quica * 1.5, largura, altura, 0, 0, Math.PI * 2);
  ctx.fill();

  if (s.flash <= 0) {
    elipse(x - largura * 0.35, y - altura * 1.2 + quica * 1.5, largura * 0.25, altura * 0.18, 'rgba(255,255,255,0.45)');
  }

  // Olhos
  const yo = y - altura * 0.8 + quica * 1.5;
  circulo(x - 5, yo, 3.2, '#ffffff');
  circulo(x + 5, yo, 3.2, '#ffffff');
  circulo(x - 5, yo, 1.5, '#111111');
  circulo(x + 5, yo, 1.5, '#111111');

  // Barra de vida
  if (s.vida < s.vidaMax) {
    const bw = 36;
    const bx = x - bw / 2;
    const by = y - altura * 1.9 - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    ctx.fillStyle = '#c93c3c';
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = '#5be05b';
    ctx.fillRect(bx, by, bw * (s.vida / s.vidaMax), 5);
  }

  textoContornado('Nv ' + s.nivel, x, y - altura * 1.9 - 12, 'bold 10px sans-serif', '#e8f5e9');
}

function desenharJogador(j) {
  const ehEu = j.id === meuId;
  const x = j.x;
  const y = j.y;
  const ritmo = j.correndo ? 20 : 13;
  const balanco = j.andando ? Math.sin(j.anim * ritmo) : 0;
  const bob = j.andando ? Math.abs(balanco) * -2 : 0;

  // Sombra
  elipse(x, y + 12, 12, 5, 'rgba(0,0,0,0.3)');

  // Pernas
  ctx.fillStyle = '#3b2f2f';
  ctx.fillRect(x - 7, y + 1 + balanco * 2, 5, 11);
  ctx.fillRect(x + 2, y + 1 - balanco * 2, 5, 11);

  // Corpo
  ctx.fillStyle = j.cor;
  ctx.fillRect(x - 9, y - 16 + bob, 18, 19);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x - 9, y - 2 + bob, 18, 3);

  // Cabeça
  circulo(x, y - 24 + bob, 8, '#f1c27d');
  ctx.fillStyle = '#4a2c17';
  ctx.beginPath();
  ctx.arc(x, y - 25 + bob, 8.3, Math.PI, Math.PI * 2);
  ctx.fill();

  // Olhos (olham na direção do movimento)
  const ox = Math.cos(j.angulo) * 2.2;
  circulo(x - 3 + ox, y - 23 + bob, 1.3, '#111111');
  circulo(x + 3 + ox, y - 23 + bob, 1.3, '#111111');

  // Espada / ataque
  const atacando = relogio < j.atacandoAte;
  if (atacando) {
    const prog = 1 - (j.atacandoAte - relogio) / DURACAO_ATAQUE;
    const inicio = j.angulo - 1.1;
    const atual = inicio + 2.2 * prog;
    const cy = y - 10;

    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${0.85 - prog * 0.5})`;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(x, cy, 46, inicio, atual);
    ctx.stroke();

    ctx.strokeStyle = '#dfe6ea';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(atual) * 12, cy + Math.sin(atual) * 12);
    ctx.lineTo(x + Math.cos(atual) * 44, cy + Math.sin(atual) * 44);
    ctx.stroke();
    ctx.restore();
  } else {
    const hx = x + Math.cos(j.angulo) * 10;
    const hy = y - 8 + Math.sin(j.angulo) * 5 + bob;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#cfd8dc';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx + Math.cos(j.angulo) * 16, hy + Math.sin(j.angulo) * 16 - 3);
    ctx.stroke();
    ctx.strokeStyle = '#7a4a1e';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(hx - Math.cos(j.angulo) * 3, hy - Math.sin(j.angulo) * 3);
    ctx.lineTo(hx + Math.cos(j.angulo) * 2, hy + Math.sin(j.angulo) * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Nome e nível
  textoContornado(
    `${j.nome} [${j.nivel}]`,
    x,
    y - 40 + bob,
    'bold 12px sans-serif',
    ehEu ? '#ffe082' : '#ffffff'
  );
}

/* =====================================================
   CICLO DE DIA E NOITE
===================================================== */
function desenharNoite() {
  const fase = (tempoJogo % DURACAO_DIA) / DURACAO_DIA;
  const luz = 0.5 + 0.5 * Math.cos(fase * Math.PI * 2); // 1 = meio-dia, 0 = meia-noite
  const noite = 1 - luz;
  const alpha = Math.min(0.68, noite * 0.85);
  if (alpha < 0.04) return;

  const crep = Math.max(0, 1 - Math.abs(noite - 0.35) / 0.3);
  const r = Math.round(12 + crep * 150);
  const g = Math.round(18 + crep * 60);
  const b = Math.round(60 - crep * 20);

  const W = nightCanvas.width;
  const H = nightCanvas.height;

  nightCtx.globalCompositeOperation = 'source-over';
  nightCtx.clearRect(0, 0, W, H);
  nightCtx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
  nightCtx.fillRect(0, 0, W, H);

  // Halo de luz em volta do jogador
  const px = eu.x - camera.x;
  const py = eu.y - camera.y - 10;
  nightCtx.globalCompositeOperation = 'destination-out';
  const gradiente = nightCtx.createRadialGradient(px, py, 10, px, py, 190);
  gradiente.addColorStop(0, `rgba(0,0,0,${Math.min(0.9, noite * 1.2)})`);
  gradiente.addColorStop(1, 'rgba(0,0,0,0)');
  nightCtx.fillStyle = gradiente;
  nightCtx.fillRect(0, 0, W, H);

  ctx.drawImage(nightCanvas, 0, 0);
}

function desenharRelogio() {
  const fase = (tempoJogo % DURACAO_DIA) / DURACAO_DIA;
  const hora24 = (fase * 24 + 12) % 24;
  const hh = String(Math.floor(hora24)).padStart(2, '0');
  const mm = String(Math.floor((hora24 % 1) * 60)).padStart(2, '0');
  const dia = hora24 >= 6 && hora24 < 18;

  const texto = `${dia ? '☀' : '☾'} ${hh}:${mm}`;
  ctx.font = 'bold 15px sans-serif';
  const larg = ctx.measureText(texto).width + 20;
  const x = canvas.width - larg - 12;
  const y = 12;

  ctx.fillStyle = 'rgba(20,16,10,0.72)';
  ctx.fillRect(x, y, larg, 28);
  ctx.strokeStyle = '#6b5636';
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, larg, 28);
  ctx.fillStyle = dia ? '#ffd76a' : '#b9c7ff';
  ctx.textAlign = 'left';
  ctx.fillText(texto, x + 10, y + 19);
}

/* =====================================================
   MINIMAPA
===================================================== */
function desenharMinimapa() {
  const mx = 12;
  const my = canvas.height - MINI_H - 12;
  const ex = MINI_W / mundo.largura;
  const ey = MINI_H / mundo.altura;

  ctx.save();
  ctx.globalAlpha = 0.93;
  ctx.drawImage(fundoMini, mx, my);
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.rect(mx, my, MINI_W, MINI_H);
  ctx.clip();

  // Slimes
  ctx.fillStyle = '#ff5252';
  for (const s of slimes.values()) {
    if (s.morto) continue;
    ctx.fillRect(mx + s.x * ex - 1.5, my + s.y * ey - 1.5, 3, 3);
  }

  // Jogadores
  for (const j of jogadores.values()) {
    if (j.id === meuId) continue;
    ctx.fillStyle = '#4de1ff';
    ctx.beginPath();
    ctx.arc(mx + j.x * ex, my + j.y * ey, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(mx + eu.x * ex, my + eu.y * ey, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Área visível
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mx + camera.x * ex, my + camera.y * ey, canvas.width * ex, canvas.height * ey);
  ctx.restore();

  ctx.strokeStyle = '#e8d8a8';
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - 1, my - 1, MINI_W + 2, MINI_H + 2);
}

/* =====================================================
   DESENHO PRINCIPAL
===================================================== */
function visivel(x, y, margem) {
  return (
    x > camera.x - margem &&
    x < camera.x + canvas.width + margem &&
    y > camera.y - margem &&
    y < camera.y + canvas.height + margem
  );
}

function desenhar() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#16301a';
  ctx.fillRect(0, 0, W, H);

  ctx.drawImage(fundoMundo, -Math.round(camera.x), -Math.round(camera.y));

  ctx.save();
  ctx.translate(-Math.round(camera.x), -Math.round(camera.y));

  // Reúne tudo que é visível e ordena por profundidade (Y)
  const itens = [];
  for (const a of arvores) {
    if (visivel(a.x, a.y, 90)) itens.push({ y: a.y, t: 0, o: a });
  }
  for (const p of pedras) {
    if (visivel(p.x, p.y, 40)) itens.push({ y: p.y, t: 1, o: p });
  }
  for (const s of slimes.values()) {
    if (!s.morto && visivel(s.x, s.y, 60)) itens.push({ y: s.y, t: 2, o: s });
  }
  for (const j of jogadores.values()) {
    if (visivel(j.x, j.y, 60)) itens.push({ y: j.y, t: 3, o: j });
  }
  itens.sort((a, b) => a.y - b.y);

  for (const it of itens) {
    if (it.t === 0) desenharArvore(it.o);
    else if (it.t === 1) desenharPedra(it.o);
    else if (it.t === 2) desenharSlime(it.o);
    else desenharJogador(it.o);
  }

  // Partículas
  for (const p of particulas) {
    ctx.globalAlpha = Math.max(0, p.vida / p.max);
    ctx.fillStyle = p.cor;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.tam, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Textos flutuantes
  for (const t of textos) {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.vida * 1.5));
    textoContornado(t.texto, t.x, t.y, `bold ${t.tam}px sans-serif`, t.cor);
  }
  ctx.globalAlpha = 1;

  ctx.restore();

  desenharNoite();

  if (flashDano > 0) {
    ctx.fillStyle = `rgba(255,0,0,${Math.min(0.35, flashDano)})`;
    ctx.fillRect(0, 0, W, H);
  }

  desenharMinimapa();
  desenharRelogio();
}

/* =====================================================
   LOOP PRINCIPAL
===================================================== */
let ultimoQuadro = performance.now();

function loop(agora) {
  const dt = Math.min(0.05, (agora - ultimoQuadro) / 1000);
  ultimoQuadro = agora;
  relogio = agora;

  if (prontoParaJogar && eu) {
    atualizar(dt);
    desenhar();
  }

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);