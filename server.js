
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
 
const PORTA = process.env.PORT || 3000;
 
const app = express();
 
// CORS liberado (Live Server em :5500 conversando com o servidor em :3000)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  next();
});
 
// Serve a pasta Public
app.use(express.static(path.join(__dirname, 'Public')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Public', 'index.html'));
});
 
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});
 
/* =====================================================
   CONFIGURAÇÃO DO MUNDO
===================================================== */
const MUNDO = { largura: 2400, altura: 1800 };
const RIO = { x: 1100, y: 0, w: 140, h: 1800 };
const ESTRADA = { x: 0, y: 850, w: 2400, h: 100 };
const PONTE = { x: 1085, y: 840, w: 170, h: 120 };
 
const RAIO_JOGADOR = 14;
const VEL_CORRER = 260;
const ALCANCE_ATAQUE = 75;
const INTERVALO_ATAQUE = 350;
const MAX_INVENTARIO = 12;
const TEMPO_RESPAWN_SLIME = 8000;
const VEL_SLIME = 35;
const VEL_SLIME_PERSEGUE = 55;
const CHANCE_CRITICO = 0.1;
 
const RARIDADES = ['comum', 'incomum', 'raro', 'epico', 'lendario'];
const TIPOS_EQUIP = ['arma', 'armadura', 'artefato'];
const NOMES_ITENS = {
  arma: ['Espada', 'Adaga', 'Machado', 'Lança'],
  armadura: ['Colete', 'Armadura', 'Escudo', 'Elmo'],
  artefato: ['Amuleto', 'Anel', 'Talismã', 'Orbe']
};
const CORES_JOGADORES = ['#e74c3c', '#3498db', '#9b59b6', '#f39c12', '#1abc9c', '#e67e22', '#ec407a'];
 
const arvores = [];
const pedras = [];
const slimes = [];
const jogadores = {};
const tokensOnline = new Set();
 
let contadorJogadores = 1;
let contadorItens = 1;
 
/* =====================================================
   SALVAMENTO DE PROGRESSO (saves.json)
===================================================== */
const ARQUIVO_SAVES = path.join(__dirname, 'saves.json');
let saves = {};
let savesSujos = false;
 
try {
  if (fs.existsSync(ARQUIVO_SAVES)) {
    saves = JSON.parse(fs.readFileSync(ARQUIVO_SAVES, 'utf8')) || {};
  }
} catch (e) {
  console.log('Não foi possível ler saves.json. Começando sem progresso salvo.');
  saves = {};
}
 
function salvarEmDisco(sincrono) {
  if (!savesSujos) return;
  savesSujos = false;
  const dados = JSON.stringify(saves);
  if (sincrono) {
    try { fs.writeFileSync(ARQUIVO_SAVES, dados); } catch (e) { /* ignora */ }
    return;
  }
  fs.writeFile(ARQUIVO_SAVES, dados, (err) => {
    if (err) {
      savesSujos = true;
      console.log('Erro ao salvar progresso:', err.message);
    }
  });
}
 
function guardarJogador(j) {
  if (!j || !j.token) return;
  saves[j.token] = {
    nome: j.nome,
    cor: j.cor,
    nivel: j.nivel,
    xp: j.xp,
    inventario: j.inventario,
    equip: j.equip
  };
  savesSujos = true;
}
 
setInterval(() => salvarEmDisco(false), 10000);
 
function encerrar() {
  for (const j of Object.values(jogadores)) guardarJogador(j);
  savesSujos = true;
  salvarEmDisco(true);
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
 
/* =====================================================
   FUNÇÕES AUXILIARES
===================================================== */
function aleatorio(min, max) {
  return min + Math.random() * (max - min);
}
 
function distancia(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}
 
function normalizarAngulo(a) {
  const dois = Math.PI * 2;
  return ((a + Math.PI) % dois + dois) % dois - Math.PI;
}
 
function naEstrada(y, margem) {
  return y > ESTRADA.y - margem && y < ESTRADA.y + ESTRADA.h + margem;
}
 
function noRio(x, margem) {
  return x > RIO.x - margem && x < RIO.x + RIO.w + margem;
}
 
function limparNome(txt) {
  const nome = String(txt || '')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 16);
  return nome.length >= 2 ? nome : '';
}
 
// Verifica se um ponto está livre de rio, estrada, árvores e pedras
function livreParaObjeto(x, y, margem) {
  if (x < margem || y < margem || x > MUNDO.largura - margem || y > MUNDO.altura - margem) return false;
  if (naEstrada(y, margem)) return false;
  if (noRio(x, margem)) return false;
  for (const a of arvores) {
    if (distancia(x, y, a.x, a.y) < a.raio + margem) return false;
  }
  for (const p of pedras) {
    if (distancia(x, y, p.x, p.y) < p.raio + margem) return false;
  }
  return true;
}
 
function longeDeSlimes(x, y, minimo) {
  for (const s of slimes) {
    if (distancia(x, y, s.x, s.y) < minimo) return false;
  }
  return true;
}
 
// Mesma regra de colisão do cliente (usada para validar movimento)
function posicaoJogadorLivre(x, y) {
  const r = RAIO_JOGADOR - 1; // 1px de tolerância
  if (x < r || y < r || x > MUNDO.largura - r || y > MUNDO.altura - r) return false;
 
  if (x + r > RIO.x && x - r < RIO.x + RIO.w) {
    if (!(y - r >= PONTE.y && y + r <= PONTE.y + PONTE.h)) return false;
  }
  for (const a of arvores) {
    if (Math.abs(a.x - x) > 60 || Math.abs(a.y - y) > 60) continue;
    if (distancia(x, y, a.x, a.y) < r + a.raio) return false;
  }
  for (const p of pedras) {
    if (Math.abs(p.x - x) > 60 || Math.abs(p.y - y) > 60) continue;
    if (distancia(x, y, p.x, p.y) < r + p.raio) return false;
  }
  return true;
}
 
/* =====================================================
   GERAÇÃO DO MUNDO (uma única vez)
===================================================== */
function gerarMundo() {
  // Árvores
  let tentativas = 0;
  while (arvores.length < 110 && tentativas < 4000) {
    tentativas++;
    const x = aleatorio(40, MUNDO.largura - 40);
    const y = aleatorio(40, MUNDO.altura - 40);
    const escala = aleatorio(0.9, 1.3);
    const raio = Math.round(16 * escala);
    if (!livreParaObjeto(x, y, 40)) continue;
    arvores.push({
      x: Math.round(x),
      y: Math.round(y),
      raio,
      escala: Number(escala.toFixed(2)),
      tipo: Math.floor(Math.random() * 3)
    });
  }
 
  // Pedras
  tentativas = 0;
  while (pedras.length < 45 && tentativas < 4000) {
    tentativas++;
    const x = aleatorio(40, MUNDO.largura - 40);
    const y = aleatorio(40, MUNDO.altura - 40);
    const raio = Math.round(aleatorio(13, 20));
    if (!livreParaObjeto(x, y, 34)) continue;
    pedras.push({
      x: Math.round(x),
      y: Math.round(y),
      raio,
      tipo: Math.floor(Math.random() * 2)
    });
  }
 
  // Slimes
  tentativas = 0;
  while (slimes.length < 16 && tentativas < 4000) {
    tentativas++;
    const x = aleatorio(60, MUNDO.largura - 60);
    const y = aleatorio(60, MUNDO.altura - 60);
    if (!livreParaObjeto(x, y, 50)) continue;
    if (!longeDeSlimes(x, y, 120)) continue;
    const nivel = 1 + Math.floor(Math.random() * 3);
    const vidaMax = 30 + nivel * 10;
    slimes.push({
      id: slimes.length,
      x,
      y,
      spawnX: x,
      spawnY: y,
      raio: 14,
      nivel,
      vidaMax,
      vida: vidaMax,
      morto: false,
      respawnEm: 0,
      vx: 0,
      vy: 0,
      tempoDir: Math.random() * 2,
      ultimoAtaque: 0
    });
  }
 
  console.log(`Mundo gerado: ${arvores.length} árvores, ${pedras.length} pedras, ${slimes.length} slimes`);
}
 
gerarMundo();
 
/* =====================================================
   SPAWN SEGURO
===================================================== */
function spawnValido(x, y, margem) {
  if (!livreParaObjeto(x, y, margem)) return false;
  if (!longeDeSlimes(x, y, 160)) return false;
  return true;
}
 
function pontoSpawnLivre() {
  // Lado esquerdo do rio, longe de tudo
  for (let i = 0; i < 400; i++) {
    const x = aleatorio(80, 1000);
    const y = aleatorio(80, MUNDO.altura - 80);
    if (spawnValido(x, y, 70)) return { x, y };
  }
  // Plano B: estrada (nenhuma árvore/pedra é gerada nela)
  for (let i = 0; i < 100; i++) {
    const x = aleatorio(100, 1000);
    const y = aleatorio(880, 920);
    if (longeDeSlimes(x, y, 120)) return { x, y };
  }
  // Plano C: ponto fixo na estrada
  return { x: 200, y: 900 };
}
 
/* =====================================================
   ITENS E JOGADORES
===================================================== */
function sortearRaridade(sorte) {
  const r = Math.min(99.9, Math.random() * 100 + (sorte || 0));
  if (r < 55) return 'comum';
  if (r < 83) return 'incomum';
  if (r < 95) return 'raro';
  if (r < 99) return 'epico';
  return 'lendario';
}
 
function gerarItem(nivel, sorte) {
  const tipo = TIPOS_EQUIP[Math.floor(Math.random() * TIPOS_EQUIP.length)];
  const raridade = sortearRaridade(sorte);
  const mult = RARIDADES.indexOf(raridade) + 1;
  const base = NOMES_ITENS[tipo][Math.floor(Math.random() * NOMES_ITENS[tipo].length)];
 
  let bonus;
  if (tipo === 'arma') bonus = 2 * mult + Math.floor(nivel / 2);
  else if (tipo === 'armadura') bonus = mult + Math.floor(nivel / 3);
  else bonus = 5 * mult;
 
  return {
    id: contadorItens++,
    tipo,
    raridade,
    nome: `${base} ${raridade.charAt(0).toUpperCase() + raridade.slice(1)}`,
    bonus
  };
}
 
function gerarPocao(nivelSlime) {
  return {
    id: contadorItens++,
    tipo: 'pocao',
    raridade: 'comum',
    nome: 'Poção de Vida',
    bonus: 25 + nivelSlime * 5
  };
}
 
// Valida um item vindo do arquivo de save (nunca confia cegamente)
function sanitizarItem(i, aceitaPocao) {
  if (!i || typeof i !== 'object') return null;
  const tiposOk = aceitaPocao ? TIPOS_EQUIP.concat('pocao') : TIPOS_EQUIP;
  if (!tiposOk.includes(i.tipo) || !RARIDADES.includes(i.raridade)) return null;
  const bonus = Math.floor(Number(i.bonus));
  if (!Number.isFinite(bonus) || bonus < 0) return null;
  return {
    id: contadorItens++,
    tipo: i.tipo,
    raridade: i.raridade,
    nome: String(i.nome || 'Item').slice(0, 40),
    bonus: Math.min(bonus, 9999)
  };
}
 
function xpProximo(nivel) {
  return nivel * 50;
}
 
function vidaMaxDe(j) {
  return j.vidaBase + (j.equip.artefato ? j.equip.artefato.bonus : 0);
}
 
function danoDe(j) {
  return 8 + j.nivel * 2 + (j.equip.arma ? j.equip.arma.bonus : 0);
}
 
function defesaDe(j) {
  return j.equip.armadura ? j.equip.armadura.bonus : 0;
}
 
function restaurarJogador(j, s) {
  if (!s || typeof s !== 'object') return;
 
  const nome = limparNome(s.nome);
  if (nome) j.nome = nome;
  if (typeof s.cor === 'string' && /^#[0-9a-fA-F]{6}$/.test(s.cor)) j.cor = s.cor;
 
  const nivel = Math.floor(Number(s.nivel));
  if (Number.isFinite(nivel) && nivel >= 1) j.nivel = Math.min(nivel, 999);
  j.vidaBase = 100 + (j.nivel - 1) * 10;
 
  const xp = Math.floor(Number(s.xp));
  j.xp = Number.isFinite(xp) ? Math.max(0, Math.min(xp, xpProximo(j.nivel) - 1)) : 0;
 
  if (Array.isArray(s.inventario)) {
    j.inventario = s.inventario
      .map((i) => sanitizarItem(i, true))
      .filter(Boolean)
      .slice(0, MAX_INVENTARIO);
  }
 
  if (s.equip && typeof s.equip === 'object') {
    for (const tipo of TIPOS_EQUIP) {
      const item = sanitizarItem(s.equip[tipo], false);
      j.equip[tipo] = item && item.tipo === tipo ? item : null;
    }
  }
 
  j.vida = vidaMaxDe(j);
}
 
function criarJogador(id, token) {
  const pos = pontoSpawnLivre();
  const numero = contadorJogadores++;
  const j = {
    id,
    token,
    nome: 'Aventureiro ' + numero,
    x: pos.x,
    y: pos.y,
    angulo: 0,
    correndo: false,
    cor: CORES_JOGADORES[numero % CORES_JOGADORES.length],
    nivel: 1,
    xp: 0,
    vidaBase: 100,
    vida: 100,
    inventario: [],
    equip: {
      arma: { id: contadorItens++, tipo: 'arma', raridade: 'comum', nome: 'Espada de Madeira', bonus: 1 },
      armadura: null,
      artefato: null
    },
    ultimoAtaque: 0,
    ultimoDano: 0,
    ultimoMover: Date.now(),
    credito: 100,
    ultimoChat: 0,
    ultimaPocao: 0
  };
  if (token) restaurarJogador(j, saves[token]);
  return j;
}
 
function pubJogador(j) {
  return {
    id: j.id,
    nome: j.nome,
    x: j.x,
    y: j.y,
    angulo: j.angulo,
    correndo: j.correndo,
    cor: j.cor,
    nivel: j.nivel
  };
}
 
function pubSlime(s) {
  return {
    id: s.id,
    x: s.x,
    y: s.y,
    raio: s.raio,
    nivel: s.nivel,
    vida: s.vida,
    vidaMax: s.vidaMax,
    morto: s.morto
  };
}
 
function statusPara(j) {
  return {
    vida: Math.ceil(j.vida),
    vidaMax: vidaMaxDe(j),
    nivel: j.nivel,
    xp: j.xp,
    xpProx: xpProximo(j.nivel),
    inventario: j.inventario,
    equip: j.equip,
    dano: danoDe(j),
    defesa: defesaDe(j)
  };
}
 
function enviarStatus(j) {
  io.to(j.id).emit('status', statusPara(j));
}
 
function ganharXp(j, quantidade) {
  j.xp += quantidade;
  let subiu = false;
  while (j.xp >= xpProximo(j.nivel)) {
    j.xp -= xpProximo(j.nivel);
    j.nivel++;
    j.vidaBase += 10;
    subiu = true;
  }
  if (subiu) {
    j.vida = vidaMaxDe(j);
    io.to(j.id).emit('subiuNivel', { nivel: j.nivel });
    io.emit('jogadorNivel', { id: j.id, nivel: j.nivel });
    io.to(j.id).emit('mensagem', `Você subiu para o nível ${j.nivel}!`);
  }
  guardarJogador(j);
  enviarStatus(j);
}
 
function machucarJogador(j, danoBruto) {
  const dano = Math.max(1, danoBruto - defesaDe(j));
  j.vida -= dano;
  j.ultimoDano = Date.now();
  io.emit('jogadorDano', { id: j.id, x: j.x, y: j.y, dano });
 
  if (j.vida <= 0) {
    const pos = pontoSpawnLivre();
    j.x = pos.x;
    j.y = pos.y;
    j.vida = vidaMaxDe(j);
    io.to(j.id).emit('corrigirPosicao', { x: j.x, y: j.y });
    io.to(j.id).emit('mensagem', 'Você foi derrotado e voltou ao ponto de partida.');
    io.emit('jogadorMoveu', { id: j.id, x: j.x, y: j.y, angulo: j.angulo, correndo: false });
  }
  enviarStatus(j);
}
 
function danoNoSlime(s, dano, atacante, critico) {
  s.vida = Math.max(0, s.vida - dano);
  io.emit('slimeDano', {
    id: s.id,
    x: s.x,
    y: s.y,
    dano,
    critico: !!critico,
    vida: s.vida,
    vidaMax: s.vidaMax
  });
 
  if (s.vida <= 0) {
    s.morto = true;
    s.respawnEm = Date.now() + TEMPO_RESPAWN_SLIME;
    io.emit('slimeMorreu', { id: s.id, x: s.x, y: s.y });
 
    // Recompensas
    if (jogadores[atacante.id]) {
      ganharXp(atacante, 15 * s.nivel);
      if (Math.random() < 0.5) {
        // 35% poção, 65% equipamento (slimes de nível alto dão raridade melhor)
        const item = Math.random() < 0.35
          ? gerarPocao(s.nivel)
          : gerarItem(atacante.nivel, (s.nivel - 1) * 4);
        if (atacante.inventario.length >= MAX_INVENTARIO) {
          io.to(atacante.id).emit('mensagem', `Inventário cheio! Item perdido: ${item.nome}`);
        } else {
          atacante.inventario.push(item);
          io.to(atacante.id).emit('mensagem', `Você encontrou: ${item.nome}`);
          guardarJogador(atacante);
          enviarStatus(atacante);
        }
      }
    }
  }
}
 
/* =====================================================
   SOCKET.IO
===================================================== */
io.on('connection', (socket) => {
  // Identidade do personagem (token gerado no navegador)
  let token = null;
  const bruto = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof bruto === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(bruto)) token = bruto;
 
  let aviso = null;
  if (token && tokensOnline.has(token)) {
    token = null;
    aviso = 'Seu personagem já está aberto em outra aba. Esta sessão não será salva.';
  }
  if (token) tokensOnline.add(token);
 
  const jogador = criarJogador(socket.id, token);
  jogadores[socket.id] = jogador;
  console.log(`+ ${jogador.nome} conectou (${Object.keys(jogadores).length} online)`);
 
  // Envia o mundo inteiro uma única vez
  socket.emit('dadosIniciais', {
    meuId: socket.id,
    mundo: MUNDO,
    rio: RIO,
    estrada: ESTRADA,
    ponte: PONTE,
    arvores,
    pedras,
    slimes: slimes.map(pubSlime),
    jogadores: Object.values(jogadores).map(pubJogador),
    status: statusPara(jogador)
  });
  if (aviso) socket.emit('mensagem', aviso);
 
  socket.broadcast.emit('jogadorEntrou', pubJogador(jogador));
  io.emit('online', Object.keys(jogadores).length);
 
  socket.on('mover', (d) => {
    const j = jogadores[socket.id];
    if (!j || !d) return;
    if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
 
    const x = Math.max(0, Math.min(MUNDO.largura, d.x));
    const y = Math.max(0, Math.min(MUNDO.altura, d.y));
 
    // Anti-trapaça: limita a velocidade (com "crédito" para tolerar lag) e valida colisão
    const agora = Date.now();
    const decorrido = Math.min(1, (agora - j.ultimoMover) / 1000);
    j.ultimoMover = agora;
    j.credito = Math.min(320, j.credito + VEL_CORRER * 1.25 * decorrido);
 
    const dist = distancia(j.x, j.y, x, y);
    if (dist > j.credito + 20 || !posicaoJogadorLivre(x, y)) {
      socket.emit('corrigirPosicao', { x: j.x, y: j.y });
      return;
    }
    j.credito = Math.max(0, j.credito - dist);
 
    j.x = x;
    j.y = y;
    if (Number.isFinite(d.angulo)) j.angulo = d.angulo;
    j.correndo = !!d.correndo;
 
    socket.broadcast.emit('jogadorMoveu', {
      id: j.id,
      x: j.x,
      y: j.y,
      angulo: j.angulo,
      correndo: j.correndo
    });
  });
 
  socket.on('atacar', (d) => {
    const j = jogadores[socket.id];
    if (!j) return;
 
    const agora = Date.now();
    if (agora - j.ultimoAtaque < INTERVALO_ATAQUE - 30) return;
    j.ultimoAtaque = agora;
 
    const angulo = d && Number.isFinite(d.angulo) ? d.angulo : j.angulo;
    j.angulo = angulo;
    io.emit('jogadorAtacou', { id: j.id, angulo });
 
    for (const s of slimes) {
      if (s.morto) continue;
      const dist = distancia(j.x, j.y, s.x, s.y);
      if (dist > ALCANCE_ATAQUE + s.raio) continue;
 
      const anguloSlime = Math.atan2(s.y - j.y, s.x - j.x);
      const diferenca = Math.abs(normalizarAngulo(anguloSlime - angulo));
      // Inimigos muito colados sempre são atingidos; os demais precisam estar no cone frontal
      if (dist > s.raio + 22 && diferenca > 1.2) continue;
 
      const critico = Math.random() < CHANCE_CRITICO;
      const base = danoDe(j) + Math.floor(Math.random() * 5);
      danoNoSlime(s, critico ? base * 2 : base, j, critico);
    }
  });
 
  // Clicar em equipamento = equipar; clicar em poção = beber
  socket.on('equipar', (indice) => {
    const j = jogadores[socket.id];
    if (!j || !Number.isInteger(indice)) return;
    const item = j.inventario[indice];
    if (!item) return;
 
    if (item.tipo === 'pocao') {
      const agora = Date.now();
      if (agora - j.ultimaPocao < 800) return;
      const max = vidaMaxDe(j);
      if (j.vida >= max) {
        socket.emit('mensagem', 'Sua vida já está cheia.');
        return;
      }
      j.ultimaPocao = agora;
      j.inventario.splice(indice, 1);
      const antes = j.vida;
      j.vida = Math.min(max, j.vida + item.bonus);
      io.to(j.id).emit('jogadorCura', { x: j.x, y: j.y, quantidade: Math.round(j.vida - antes) });
      guardarJogador(j);
      enviarStatus(j);
      return;
    }
 
    if (!TIPOS_EQUIP.includes(item.tipo)) return;
 
    const antigo = j.equip[item.tipo];
    j.equip[item.tipo] = item;
    j.inventario.splice(indice, 1);
    if (antigo) j.inventario.push(antigo);
 
    j.vida = Math.min(j.vida, vidaMaxDe(j));
    guardarJogador(j);
    enviarStatus(j);
  });
 
  socket.on('desequipar', (tipo) => {
    const j = jogadores[socket.id];
    if (!j || !TIPOS_EQUIP.includes(tipo)) return;
    if (!j.equip[tipo]) return;
    if (j.inventario.length >= MAX_INVENTARIO) {
      socket.emit('mensagem', 'Inventário cheio!');
      return;
    }
 
    j.inventario.push(j.equip[tipo]);
    j.equip[tipo] = null;
    j.vida = Math.min(j.vida, vidaMaxDe(j));
    guardarJogador(j);
    enviarStatus(j);
  });
 
  // Chat global + comando /nome
  socket.on('chat', (texto) => {
    const j = jogadores[socket.id];
    if (!j || typeof texto !== 'string') return;
 
    const agora = Date.now();
    if (agora - j.ultimoChat < 700) return;
    j.ultimoChat = agora;
 
    texto = texto.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    if (!texto) return;
 
    if (texto.toLowerCase().startsWith('/nome ')) {
      const nome = limparNome(texto.slice(6));
      if (!nome) {
        socket.emit('mensagem', 'Nome inválido (use 2 a 16 letras ou números).');
        return;
      }
      j.nome = nome;
      guardarJogador(j);
      io.emit('jogadorNome', { id: j.id, nome });
      socket.emit('mensagem', `Seu nome agora é ${nome}.`);
      return;
    }
 
    io.emit('chat', { id: j.id, nome: j.nome, texto });
  });
 
  socket.on('disconnect', () => {
    const j = jogadores[socket.id];
    if (j) {
      console.log(`- ${j.nome} saiu`);
      guardarJogador(j);
      if (j.token) tokensOnline.delete(j.token);
    }
    delete jogadores[socket.id];
    io.emit('jogadorSaiu', socket.id);
    io.emit('online', Object.keys(jogadores).length);
  });
});
 
/* =====================================================
   LOOP DO SERVIDOR: IA DOS SLIMES (10x por segundo)
===================================================== */
function slimeLivre(x, y, raio) {
  if (x < raio || y < raio || x > MUNDO.largura - raio || y > MUNDO.altura - raio) return false;
  if (noRio(x, raio + 6)) return false;
  for (const a of arvores) {
    if (distancia(x, y, a.x, a.y) < a.raio + raio) return false;
  }
  for (const p of pedras) {
    if (distancia(x, y, p.x, p.y) < p.raio + raio) return false;
  }
  return true;
}
 
setInterval(() => {
  const agora = Date.now();
  const dt = 0.1;
  const listaJogadores = Object.values(jogadores);
 
  for (const s of slimes) {
    // Respawn
    if (s.morto) {
      if (agora >= s.respawnEm) {
        s.morto = false;
        s.vida = s.vidaMax;
        s.x = s.spawnX;
        s.y = s.spawnY;
        io.emit('slimeRenasceu', pubSlime(s));
      }
      continue;
    }
 
    // Procura o jogador mais próximo
    let alvo = null;
    let melhor = 180;
    if (distancia(s.x, s.y, s.spawnX, s.spawnY) < 320) {
      for (const j of listaJogadores) {
        const d = distancia(s.x, s.y, j.x, j.y);
        if (d < melhor) {
          melhor = d;
          alvo = j;
        }
      }
    }
 
    let dx = 0;
    let dy = 0;
 
    if (alvo) {
      const ang = Math.atan2(alvo.y - s.y, alvo.x - s.x);
      dx = Math.cos(ang) * VEL_SLIME_PERSEGUE;
      dy = Math.sin(ang) * VEL_SLIME_PERSEGUE;
    } else {
      s.tempoDir -= dt;
      if (s.tempoDir <= 0) {
        s.tempoDir = 1 + Math.random() * 2.5;
        if (Math.random() < 0.35) {
          s.vx = 0;
          s.vy = 0;
        } else {
          const a = Math.random() * Math.PI * 2;
          s.vx = Math.cos(a) * VEL_SLIME;
          s.vy = Math.sin(a) * VEL_SLIME;
        }
      }
      if (distancia(s.x, s.y, s.spawnX, s.spawnY) > 160) {
        const a = Math.atan2(s.spawnY - s.y, s.spawnX - s.x);
        s.vx = Math.cos(a) * VEL_SLIME;
        s.vy = Math.sin(a) * VEL_SLIME;
      }
      dx = s.vx;
      dy = s.vy;
    }
 
    const nx = s.x + dx * dt;
    const ny = s.y + dy * dt;
    if (slimeLivre(nx, s.y, s.raio)) s.x = nx;
    if (slimeLivre(s.x, ny, s.raio)) s.y = ny;
 
    // Dano de contato
    if (alvo && melhor < s.raio + RAIO_JOGADOR + 4 && agora - s.ultimoAtaque > 1000) {
      s.ultimoAtaque = agora;
      machucarJogador(alvo, 4 + s.nivel * 2);
    }
  }
 
  io.emit('slimes', slimes.map((s) => ({
    id: s.id,
    x: Math.round(s.x * 10) / 10,
    y: Math.round(s.y * 10) / 10,
    vida: s.vida,
    morto: s.morto
  })));
}, 100);
 
// Regeneração lenta de vida
setInterval(() => {
  const agora = Date.now();
  for (const j of Object.values(jogadores)) {
    const max = vidaMaxDe(j);
    if (j.vida < max && agora - j.ultimoDano > 5000) {
      j.vida = Math.min(max, j.vida + 2);
      enviarStatus(j);
    }
  }
}, 1000);
 
function pegarIpLocal() {
  const redes = require('os').networkInterfaces();
  for (const nome in redes) {
    for (const info of redes[nome]) {
      if (info.family === 'IPv4' && !info.internal) {
        return info.address;
      }
    }
  }
  return 'localhost';
}

const IP_REDE = pegarIpLocal();

server.listen(PORTA, '0.0.0.0', () => {
  console.log(`Seu acesso:       http://localhost:${PORTA}`);
  console.log(`Link pros amigos: http://${IP_REDE}:${PORTA}`);
}); 