'use strict';
/* Bingmo — jeu d'ambiance en ligne (2 à 8 joueurs) pour le hub ChadGangGames.

   Principe : chaque joueur écrit un mot par thème, puis à tour de rôle on annonce un mot de sa grille.
   Tous ceux qui ont écrit le même mot pour ce thème cochent leur case. Le premier grille complète gagne.

   Architecture réseau (le hub ne fait que relayer) :
   - L'hôte (1er de la liste des joueurs) tient l'état officiel et le publie avec { keep: true } (version croissante).
   - Les mots des joueurs restent PRIVÉS sur leur appareil jusqu'à ce qu'ils soient annoncés.
   - À chaque annonce, chaque joueur répond par un "ack" { hit: true/false } ; l'hôte calcule le résultat. */
(function () {

const MAX_PLAYERS = 8;
const DEFAULT_SETTINGS = { n: 6, time: 90 };
const TURN_AUTO_MS = 22000;   // sans choix après ce délai, un mot est annoncé automatiquement
const TURN_SKIP_MS = 45000;   // l'hôte passe le tour d'un joueur absent
const ACK_WAIT_MS = 4500;     // attente max des réponses des joueurs après une annonce
const COLORS = ['#ff4d6d', '#ff9f1c', '#2de2c4', '#7c5cff', '#4cc9f0', '#8ac926', '#ff6bd6', '#f4d35e'];
const EMOJIS = ['😂', '🔥', '😱', '👏', '🤯', '💀'];

/* ---------------- Utilitaires ---------------- */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));

function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function hashColor(id) {
  let h = 0;
  String(id).split('').forEach((ch) => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; });
  return COLORS[h % COLORS.length];
}
function load(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

/** Normalise un mot pour la comparaison : casse, accents, articles, ponctuation, pluriel simple. */
const ARTICLES = ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du', 'de', 'd', 'au', 'aux', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'ce', 'cette', 'ces'];
function norm(s) {
  s = String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae');
  const words = s.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  while (words.length > 1 && ARTICLES.indexOf(words[0]) >= 0) words.shift();
  let w = words.join('');
  if (w.length > 3) w = w.replace(/[sx]$/, '');
  return w;
}
function same(a, b) {
  const na = norm(a);
  return na !== '' && na === norm(b);
}
const wordLabel = (w) => (norm(w) ? String(w).trim() : '— rien —');

/* ---------------- État ---------------- */
let me = { id: '', name: '', avatar: null };
let room = null;
let code = '';
let live = [];          // joueurs connectés [{id,name}] dans l'ordre d'arrivée (le 1er = hôte)
let S = null;           // état officiel de la salle (publié par l'hôte)
let clockOffset = 0;    // décalage avec l'horloge de l'hôte

// Données locales de la partie
let myWords = [];
let acks = {};          // n -> { playerId: hit }
let gridsSeen = {};     // playerId -> mots (révélés en fin de partie)
let sentAck = new Set();
let sentReady = false;
let finSent = false;
let selected = -1;
let saying = -1;        // numéro d'annonce déjà envoyée par moi
let lastTickSec = -1;

// Scène (animations séquencées pour un affichage fluide)
let sceneQueue = [];
let sceneBusy = false;
let shownProg = {};
let shownHistLen = 0;
let seenHist = 0;
let seenCurN = -1;

const now = () => Date.now() + clockOffset;
const isLive = (id) => live.some((p) => p.id === id);
const isHost = () => live.length > 0 && live[0].id === me.id;
const mePlays = () => !!S && Array.isArray(S.players) && S.players.some((p) => p.id === me.id);
const wordsKey = () => 'bingmo:w:' + (S ? S.gameId : '');
function nameOf(id) {
  const p = ((S && S.players) || []).find((x) => x.id === id) || live.find((x) => x.id === id);
  return p ? p.name : '???';
}
function av(p, size) {
  const img = p.avatar || (p.id === me.id ? me.avatar : null);
  const ch = (p.name || '?').trim().charAt(0).toUpperCase();
  return '<div class="av ' + (size || '') + '" data-chadgang-id="' + esc(p.id) + '" style="--c:' + hashColor(p.id) + '">' +
    (img ? '<img src="' + esc(img) + '" alt="">' : esc(ch)) + '</div>';
}
function pl(id) { return { id, name: nameOf(id) }; }

/* ---------------- Interface générale ---------------- */
function show(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === 's-' + name));
  $('#bar').hidden = name === 'home';
  document.body.dataset.screen = name;
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}
function callout(text, cls) {
  const el = $('#callout');
  el.className = '';
  el.textContent = text;
  void el.offsetWidth;
  el.className = 'show ' + (cls || '');
}
function copyCode() {
  const done = () => toast('Code ' + code + ' copié !');
  try { navigator.clipboard.writeText(code).then(done, () => toast('Code : ' + code)); } catch (e) { toast('Code : ' + code); }
}

/* ---------------- Connexion à la salle ---------------- */
function cleanCode(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12); }
function randomCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 4; i++) c += letters.charAt(Math.floor(Math.random() * letters.length));
  return c;
}

function readPseudo() {
  if (!$('#pseudoRow').hidden) {
    me.name = $('#pseudo').value.trim().slice(0, 16);
    save('bingmo_name', me.name);
  }
}

function connect(rawCode, create) {
  readPseudo();
  const c = cleanCode(rawCode);
  if (!me.name) { toast('Il faut un pseudo pour jouer !'); return; }
  if (c.length < 3) { toast('Entre le code de la salle !'); return; }
  leaveRoom(true);
  code = c;
  const r = (window.ChadGang && ChadGang.join)
    ? ChadGang.join(c, { create: !!create })
    : window.bingmoLocalRoom(c, { id: me.id, name: me.name }, !!create);
  room = r;

  r.on('ready', (info) => {
    if (room !== r) return;
    if (info && info.me) me.id = info.me;
    live = (info && info.players) || live;
    if (info && info.last && info.last.t === 'state') receiveState(info.last.s);
    afterPlayersChange();
  });
  r.on('players', (list) => {
    if (room !== r) return;
    live = list || [];
    afterPlayersChange();
  });
  r.on('message', (d, from) => { if (room === r) onMessage(d, from || {}); });
  r.on('error', (msg) => {
    if (room !== r) return;
    toast(typeof msg === 'string' ? msg : 'Salle introuvable');
    leaveRoom();
  });

  $('#roomCode').textContent = c;
  $('#lobbyCode').textContent = c;
  try { history.replaceState(null, '', location.pathname + '?room=' + c); } catch (e) { /* ignore */ }
  show('lobby');
  renderLobby();
}

function leaveRoom(silent) {
  if (room) { try { room.leave(); } catch (e) { /* ignore */ } }
  room = null;
  S = null;
  live = [];
  resetGameLocals();
  sceneQueue = [];
  if (!silent) {
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    show('home');
  }
}

function resetGameLocals() {
  myWords = [];
  acks = {};
  gridsSeen = {};
  sentAck = new Set();
  sentReady = false;
  finSent = false;
  selected = -1;
  saying = -1;
  seenHist = 0;
  seenCurN = -1;
  shownHistLen = 0;
  shownProg = {};
  document.body.classList.remove('spectator');
}

/* ---------------- Messages ---------------- */
function onMessage(d, from) {
  if (!d || !d.t) return;
  switch (d.t) {
    case 'state':
      receiveState(d.s);
      break;
    case 'tick':
      if (from.id !== me.id && live.length && from.id === live[0].id) clockOffset = d.now - Date.now();
      break;
    case 'ready':
      if (isHost() && S && S.phase === 'write' && S.players.some((p) => p.id === from.id) && S.ready.indexOf(from.id) < 0) {
        commit((s) => { s.ready.push(from.id); });
      }
      break;
    case 'say':
      if (isHost()) hostSay(d, from);
      break;
    case 'ack':
      if (!acks[d.n]) acks[d.n] = {};
      acks[d.n][from.id] = !!d.hit;
      if (isHost()) hostTick();
      break;
    case 'grid':
      if (S && d.g === S.gameId && Array.isArray(d.words)) {
        gridsSeen[from.id] = d.words;
        if (S.phase === 'end') renderEndStatic();
      }
      break;
    case 'emo':
      floatEmoji(d.e, from);
      break;
    default:
  }
}

function receiveState(s) {
  if (!s || typeof s.v !== 'number') return;
  if (!S || s.v > S.v) adopt(s);
}

/** (Hôte) modifie l'état, incrémente la version, le publie et l'applique localement. */
function commit(fn) {
  const ns = S ? clone(S) : { v: 0 };
  fn(ns);
  ns.v = (S ? S.v : 0) + 1;
  room.send({ t: 'state', s: ns }, { keep: true });
  adopt(ns);
}

function adopt(ns) {
  const old = S;
  S = ns;
  onTransition(old, ns);
}

function afterPlayersChange() {
  if (!S) { renderLobby(); }
  else if (S.phase === 'lobby') renderLobby();
  else if (S.phase === 'write') renderWrite();
  else if (S.phase === 'play') { updateStrip(); renderPlayUI(); }
  else if (S.phase === 'end') { sendGrid(); renderEndStatic(); }
  hostTick();
}

/* ---------------- Transitions de phase ---------------- */
function onTransition(old, s) {
  const sameGame = !!old && !!s.gameId && old.gameId === s.gameId;
  switch (s.phase) {
    case 'lobby':
      if (!old || old.phase !== 'lobby') resetGameLocals();
      show('lobby');
      renderLobby();
      break;
    case 'write':
      if (!sameGame || old.phase !== 'write') enterWrite(); else renderWrite();
      break;
    case 'play':
      if (!sameGame || old.phase !== 'play') enterPlay(old, s); else syncPlay(s);
      break;
    case 'end':
      if (sameGame && old.phase === 'play') { syncPlay(s); pushScene({ k: 'end' }); }
      else if (!sameGame || old.phase !== 'end') enterEnd();
      else renderEndStatic();
      break;
    default:
  }
}

/* ---------------- Salon ---------------- */
function renderLobby() {
  const st = (S && S.settings) || DEFAULT_SETTINGS;
  const host = isHost();
  $('#lobbyPlayers').innerHTML = live.map((p, i) =>
    '<div class="pl' + (i >= MAX_PLAYERS ? ' spec' : '') + '">' + av(p) + '<b>' + esc(p.name) + '</b>' +
    (i === 0 ? '<em>👑 hôte</em>' : '') + (i >= MAX_PLAYERS ? '<em>👀 spectateur</em>' : '') + '</div>').join('');
  $$('#settings .seg button').forEach((b) => {
    b.classList.toggle('on', st[b.dataset.k] === +b.dataset.v);
    b.disabled = !host;
  });
  const btn = $('#btnStart');
  btn.hidden = !host;
  btn.disabled = live.length < 2;
  const hostName = live[0] ? live[0].name : 'L’hôte';
  $('#lobbyHint').textContent = !live.length ? 'Connexion à la salle…'
    : host ? (live.length < 2 ? 'Il faut au moins 2 joueurs pour lancer la partie (3 ou plus, c’est encore mieux !).'
      : live.length + ' joueurs dans la salle — lance la partie quand tout le monde est là !')
      : '⏳ ' + hostName + ' va lancer la partie…';
}

function setSetting(k, v) {
  if (!isHost() || !S || S.phase !== 'lobby') return;
  commit((s) => { s.settings = Object.assign({}, DEFAULT_SETTINGS, s.settings); s.settings[k] = v; });
}

function startGame() {
  if (!isHost() || !S || S.phase !== 'lobby') return;
  const ps = live.slice(0, MAX_PLAYERS);
  if (ps.length < 2) { toast('Il faut au moins 2 joueurs !'); return; }
  const st = Object.assign({}, DEFAULT_SETTINGS, S.settings);
  commit((s) => {
    s.phase = 'write';
    s.settings = st;
    s.gameId = code + '-' + Date.now().toString(36);
    s.players = ps.map((p) => ({ id: p.id, name: p.name }));
    s.themes = shuffle(BINGMO_THEMES).slice(0, st.n);
    s.writeEnd = now() + st.time * 1000;
    s.ready = [];
    s.hist = [];
    s.cur = null;
    s.winners = [];
    s.prog = {};
    s.aborted = false;
    s.n = 0;
  });
}

/* ---------------- Phase d'écriture ---------------- */
function loadWords() {
  const w = load(wordsKey());
  myWords = Array.isArray(w) ? w : [];
  while (myWords.length < S.themes.length) myWords.push('');
}

function enterWrite() {
  resetGameLocals();
  if (!mePlays()) {
    $('#waitMsg').textContent = 'Une partie est en cours dans cette salle. Tu rejoindras la prochaine !';
    show('wait');
    return;
  }
  loadWords();
  sentReady = S.ready.indexOf(me.id) >= 0;
  buildWriteGrid();
  setReadyUI();
  show('write');
  renderWrite();
  SND.ding();
  FX.burst(window.innerWidth / 2, window.innerHeight * 0.3, { n: 50 });
  callout('ÉCRIS ! ✍️', 'go');
  const first = $('#writeGrid input');
  if (first && !sentReady) setTimeout(() => first.focus(), 350);
}

function buildWriteGrid() {
  const g = $('#writeGrid');
  g.className = 'grid n' + S.themes.length;
  g.innerHTML = S.themes.map((t, i) =>
    '<label class="cell wcell" style="--d:' + i * 60 + 'ms"><span class="th"><i>' + (i + 1) + '</i>' + esc(t) + '</span>' +
    '<input type="text" data-i="' + i + '" maxlength="28" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Ton mot…" value="' + esc(myWords[i] || '') + '"></label>').join('');
  $$('input', g).forEach((inp) => {
    inp.addEventListener('input', () => { myWords[+inp.dataset.i] = inp.value; save(wordsKey(), myWords); });
    inp.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = $('input[data-i="' + (+inp.dataset.i + 1) + '"]', g);
      if (next) next.focus(); else submitReady();
    });
  });
}

function lockWords() {
  const inputs = $$('#writeGrid input');
  if (inputs.length) inputs.forEach((inp) => { myWords[+inp.dataset.i] = inp.value; });
  while (myWords.length < S.themes.length) myWords.push('');
  save(wordsKey(), myWords);
}

function setReadyUI() {
  $$('#writeGrid input').forEach((i) => { i.disabled = sentReady; });
  const b = $('#btnReady');
  b.disabled = sentReady;
  b.textContent = sentReady ? '⏳ En attente des autres…' : '✅ Prêt !';
}

function submitReady() {
  if (sentReady || !S || S.phase !== 'write' || !mePlays()) return;
  lockWords();
  sentReady = true;
  setReadyUI();
  SND.pop();
  room.send({ t: 'ready' });
}

function renderWrite() {
  if (!mePlays()) return;
  $('#readyChips').innerHTML = S.players.map((p) => {
    const ok = S.ready.indexOf(p.id) >= 0;
    return '<span class="rchip ' + (ok ? 'ok' : '') + ' ' + (isLive(p.id) ? '' : 'gone') + '">' + av(p, 'xs') + esc(p.name) + (ok ? ' ✔' : ' …') + '</span>';
  }).join('');
}

function writeTick() {
  if (!mePlays() || document.body.dataset.screen !== 'write') return;
  const total = S.settings.time * 1000;
  const left = Math.max(0, S.writeEnd - now());
  const sec = Math.ceil(left / 1000);
  $('#wtimer').textContent = sec;
  $('#wbar i').style.width = (left / total * 100) + '%';
  const low = sec <= 10;
  $('#wtimer').classList.toggle('low', low);
  $('#wbar').classList.toggle('low', low);
  if (low && sec > 0 && sec !== lastTickSec && !sentReady) { lastTickSec = sec; SND.tick(); }
  if (left <= 0 && !sentReady) submitReady();
}

/* ---------------- Phase de jeu : côté hôte ---------------- */
function hostTick() {
  if (!room || !live.length || !isHost()) return;
  if (!S) {
    commit((s) => { s.phase = 'lobby'; s.gameId = null; s.settings = clone(DEFAULT_SETTINGS); s.players = []; });
    return;
  }
  const t = now();
  if (S.phase === 'write') {
    const act = S.players.filter((p) => isLive(p.id));
    if (act.every((p) => S.ready.indexOf(p.id) >= 0) || t > S.writeEnd + 3500) startPlay();
  } else if (S.phase === 'play') {
    const act = S.players.filter((p) => isLive(p.id));
    if (act.length < 2) { commit((s) => { s.phase = 'end'; s.winners = []; s.aborted = true; s.cur = null; }); return; }
    if (S.cur) {
      const a = acks[S.cur.n] || {};
      if (act.every((p) => p.id in a) || t - S.cur.at > ACK_WAIT_MS) resolveTurn();
    } else if (!isLive(S.who) || t - S.turnStart > TURN_SKIP_MS) {
      commit((s) => advance(s));
    }
  }
}

function advance(s) {
  const L = s.order.length;
  for (let k = 1; k <= L; k++) {
    const i = (s.oi + k) % L;
    if (isLive(s.order[i])) { s.oi = i; s.who = s.order[i]; break; }
  }
  s.turnStart = now() + 2500;   // petit délai pour laisser jouer les animations
  s.cur = null;
}

function startPlay() {
  commit((s) => {
    const ids = shuffle(s.players.filter((p) => isLive(p.id)).map((p) => p.id));
    s.players = s.players.filter((p) => ids.indexOf(p.id) >= 0);
    s.order = ids;
    s.phase = 'play';
    s.hist = [];
    s.cur = null;
    s.n = 0;
    s.oi = -1;
    s.prog = {};
    ids.forEach((id) => { s.prog[id] = 0; });
    advance(s);
    s.turnStart = now() + 1800;
  });
}

function hostSay(d, from) {
  if (!S || S.phase !== 'play' || S.cur || S.who !== from.id) return;
  if (d.n !== S.n || typeof d.theme !== 'number' || d.theme < 0 || d.theme >= S.themes.length) return;
  commit((s) => { s.cur = { n: s.n, pid: from.id, theme: d.theme, word: String(d.word || '').slice(0, 40), at: now() }; });
}

function resolveTurn() {
  commit((s) => {
    const c = s.cur;
    const a = acks[c.n] || {};
    const hits = s.players.filter((p) => p.id !== c.pid && a[p.id]).map((p) => p.id);
    s.hist.push({ n: c.n, pid: c.pid, theme: c.theme, word: c.word, hits });
    s.prog[c.pid] = (s.prog[c.pid] || 0) + 1;
    hits.forEach((id) => { s.prog[id] = (s.prog[id] || 0) + 1; });
    s.n = c.n + 1;
    s.cur = null;
    const N = s.themes.length;
    const win = s.players.filter((p) => s.prog[p.id] >= N).map((p) => p.id);
    if (win.length) { s.phase = 'end'; s.winners = win; } else advance(s);
  });
}

/* ---------------- Phase de jeu : côté joueur ---------------- */
function isChecked(i, upTo) {
  const list = upTo == null ? S.hist : S.hist.slice(0, upTo);
  return list.some((h) => h.theme === i && (h.pid === me.id || h.hits.indexOf(me.id) >= 0));
}
const checkedShown = (i) => isChecked(i, shownHistLen);

function enterPlay(old, s) {
  const fromWrite = !!old && old.phase === 'write' && old.gameId === s.gameId;
  if (fromWrite) lockWords(); else { resetGameLocalsKeepRoom(); loadWords(); }
  document.body.classList.toggle('spectator', !mePlays());
  sceneQueue = [];
  shownHistLen = s.hist.length;
  seenHist = s.hist.length;
  shownProg = Object.assign({}, s.prog);
  seenCurN = -1;
  buildPlayGrid();
  buildStrip();
  rebuildFeed();
  resetCard();
  show('play');
  if (s.cur) { seenCurN = s.cur.n; showCardReveal(s.cur, true); sendAck(s.cur); }
  renderPlayUI();
  if (fromWrite) {
    SND.fanfare();
    FX.fireworks(2);
    FX.burst(window.innerWidth / 2, window.innerHeight / 3, { n: 70 });
    callout('C’EST PARTI !', 'go');
  }
}

/** Réinitialise le minimum quand on arrive en cours de partie (rechargement de page). */
function resetGameLocalsKeepRoom() {
  sentAck = new Set();
  selected = -1;
  saying = -1;
}

function syncPlay(s) {
  if (s.cur && s.cur.n !== seenCurN) {
    seenCurN = s.cur.n;
    pushScene({ k: 'reveal', cur: s.cur });
    sendAck(s.cur);
  }
  while (seenHist < s.hist.length) pushScene({ k: 'result', h: s.hist[seenHist++] });
  renderPlayUI();
}

function sendAck(c) {
  if (sentAck.has(c.n)) return;
  sentAck.add(c.n);
  if (!mePlays()) return;
  const hit = c.pid === me.id ? true : (!isChecked(c.theme) && same(myWords[c.theme], c.word));
  room.send({ t: 'ack', n: c.n, hit });
}

const canSay = () => mePlays() && !!S && S.phase === 'play' && S.who === me.id && !S.cur && !sceneBusy && saying !== S.n;
const canPick = (i) => canSay() && !checkedShown(i);

function pickCell(i) {
  if (!canPick(i)) return;
  selected = i;
  SND.tick();
  renderPlayUI();
}

function say(i) {
  if (!canPick(i)) return;
  saying = S.n;
  SND.whoosh();
  room.send({ t: 'say', n: S.n, theme: i, word: String(myWords[i] || '').trim() });
  renderPlayUI();
}

function playTick() {
  if (document.body.dataset.screen !== 'play') return;
  const bar = $('#turnbar');
  const mine = canSay();
  bar.hidden = !mine;
  if (!mine) return;
  const el = now() - S.turnStart;
  const fill = $('i', bar);
  if (el < 0) { fill.style.width = '100%'; return; }
  const left = Math.max(0, TURN_AUTO_MS - el);
  fill.style.width = (left / TURN_AUTO_MS * 100) + '%';
  bar.classList.toggle('low', left < 7000);
  const sec = Math.ceil(left / 1000);
  if (left < 5000 && sec !== lastTickSec) { lastTickSec = sec; SND.tick(); }
  if (left <= 0) {
    const opts = S.themes.map((_, i) => i).filter((i) => !checkedShown(i));
    if (!opts.length) return;
    say(opts.indexOf(selected) >= 0 ? selected : opts[Math.floor(Math.random() * opts.length)]);
  }
}

/* ---------------- Rendu de la partie ---------------- */
function buildPlayGrid() {
  const g = $('#myGrid');
  g.className = 'grid mine n' + S.themes.length;
  g.innerHTML = S.themes.map((t, i) =>
    '<button class="cell pcell" data-i="' + i + '"><span class="th">' + esc(t) + '</span>' +
    '<span class="w">' + esc(wordLabel(myWords[i])) + '</span><span class="stamp">✔</span></button>').join('');
  $$('.pcell', g).forEach((b) => b.addEventListener('click', () => pickCell(+b.dataset.i)));
}

function buildStrip() {
  $('#strip').innerHTML = S.order.map((id) => {
    const p = pl(id);
    const pips = S.themes.map(() => '<u></u>').join('');
    return '<div class="pchip' + (id === me.id ? ' me' : '') + '" data-pid="' + esc(id) + '">' + av(p, 's') +
      '<div><div class="pn">' + esc(p.name) + '</div><div class="pips">' + pips + '</div></div></div>';
  }).join('');
}

function updateStrip() {
  if (!S || S.phase !== 'play') return;
  const N = S.themes.length;
  const turnId = (!S.cur && !sceneBusy) ? S.who : (S.cur ? S.cur.pid : null);
  $$('#strip .pchip').forEach((el) => {
    const id = el.dataset.pid;
    const n = shownProg[id] || 0;
    el.classList.toggle('turn', id === turnId);
    el.classList.toggle('gone', !isLive(id));
    el.classList.toggle('danger', n === N - 1 && N > 1);
    $$('.pips u', el).forEach((u, i) => u.classList.toggle('on', i < n));
  });
}

function renderBanner() {
  const b = $('#banner');
  b.className = '';
  if (S.cur || sceneBusy) b.textContent = '🔎 Qui a le même mot ?';
  else if (S.who === me.id && mePlays()) { b.textContent = '🎤 À TOI ! Choisis un mot à annoncer'; b.className = 'mine'; }
  else b.textContent = '🎤 ' + nameOf(S.who) + ' choisit un mot…';
}

function renderPlayUI() {
  if (!S || S.phase !== 'play' || document.body.dataset.screen !== 'play') return;
  updateStrip();
  renderBanner();
  if (selected >= 0 && (checkedShown(selected) || !canSay())) selected = -1;
  $$('#myGrid .pcell').forEach((c) => {
    const i = +c.dataset.i;
    c.classList.toggle('checked', checkedShown(i));
    c.classList.toggle('pickable', canPick(i));
    c.classList.toggle('selected', i === selected);
  });
  const btn = $('#btnSay');
  const mine = canSay();
  btn.hidden = !mine;
  if (mine) {
    btn.disabled = selected < 0;
    btn.textContent = selected < 0 ? '👆 Choisis un mot dans ta grille' : '📣 Annoncer « ' + wordLabel(myWords[selected]) + ' »';
  }
}

function resetCard() {
  const card = $('#card');
  card.className = 'bcard idle';
  $('.bc-theme', card).textContent = '';
  const w = $('.bc-word', card);
  w.textContent = '?';
  w.className = 'bc-word';
  $('.bc-by', card).textContent = 'Le premier mot arrive…';
  $('.bc-hits', card).innerHTML = '';
}

function showCardReveal(c, instant) {
  const card = $('#card');
  card.className = 'bcard';
  $('.bc-theme', card).textContent = S.themes[c.theme];
  const text = String(c.word || '').trim();
  const w = $('.bc-word', card);
  w.textContent = text || '😶 rien trouvé…';
  w.className = 'bc-word' + (text.length > 11 ? ' long' : '') + (text ? '' : ' empty');
  $('.bc-by', card).innerHTML = av(pl(c.pid), 'xs') + '<span>' + esc(nameOf(c.pid)) + ' annonce…</span>';
  $('.bc-hits', card).innerHTML = '<span class="wait">Qui a le même mot ?<i>.</i><i>.</i><i>.</i></span>';
  if (!instant) { void card.offsetWidth; card.classList.add('flip'); }
}

function rebuildFeed() {
  $('#feed').innerHTML = '';
  S.hist.slice(-8).forEach(addFeed);
}
function addFeed(h) {
  const f = $('#feed');
  const k = h.hits.length;
  const chip = document.createElement('span');
  chip.className = 'fchip' + (k ? ' syn' : '');
  chip.innerHTML = '<i>' + esc(S.themes[h.theme]) + '</i>' + esc(String(h.word).trim() || '—') + (k ? ' ×' + (k + 1) : '');
  f.insertBefore(chip, f.firstChild);
  while (f.children.length > 8) f.removeChild(f.lastChild);
}

/* ---------------- Scènes (animations séquencées) ---------------- */
function pushScene(ev) {
  sceneQueue.push(ev);
  if (!sceneBusy) runScenes();
}

async function runScenes() {
  sceneBusy = true;
  renderPlayUI();
  while (sceneQueue.length) {
    const ev = sceneQueue.shift();
    try { await playScene(ev); } catch (e) { console.error(e); }
  }
  sceneBusy = false;
  renderPlayUI();
  if (canSay()) { SND.ding(); try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) { /* ignore */ } }
}

async function playScene(ev) {
  if (ev.k === 'reveal') {
    showCardReveal(ev.cur, false);
    SND.pop();
    renderPlayUI();
    await sleep(1100);
  } else if (ev.k === 'result') {
    await sceneResult(ev.h);
  } else if (ev.k === 'end') {
    await sleep(500);
    showEnd();
  }
}

function cellRect(i) {
  const c = $('#myGrid .pcell[data-i="' + i + '"]');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function sceneResult(h) {
  const N = S.themes.length;
  const others = S.players.length - 1;
  const k = h.hits.length;
  const gained = [h.pid].concat(h.hits);

  // Mise à jour de l'affichage de la progression
  shownHistLen++;
  gained.forEach((id) => { shownProg[id] = (shownProg[id] || 0) + 1; });

  // Qui a le même mot ?
  const card = $('#card');
  $('.bc-by', card).innerHTML = av(pl(h.pid), 'xs') + '<span>annoncé par ' + esc(nameOf(h.pid)) + '</span>';
  $('.bc-hits', card).innerHTML = k
    ? h.hits.map((id, i) => '<span class="hit" style="--d:' + i * 130 + 'ms">' + av(pl(id), 'xs') + '<b>' + esc(nameOf(id)) + '</b></span>').join('')
    : '<span class="nobody">Personne d’autre n’a ce mot 😬</span>';
  addFeed(h);

  const r = card.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let wait = 1500;
  if (k === 0) {
    SND.sad();
    callout('SOLO… 😬', 'sad');
    FX.burst(cx, cy, { n: 16, colors: ['#9aa0c8', '#c6cae8'], speed: 4, gravity: 0.12, shapes: ['circle'] });
  } else if (others >= 2 && k === others) {
    SND.combo(8); SND.boom();
    callout('TOUT LE MONDE !!! 🤯', 'mega');
    card.classList.add('mega');
    FX.shake(700); FX.flash('#ffd426'); FX.fireworks(4); FX.rain(2500);
    wait = 2700;
  } else if (k === 1) {
    SND.combo(1);
    callout('SYNCHRO !', 'syn');
    FX.burst(cx, cy, { n: 44 });
  } else if (k === 2) {
    SND.combo(3);
    callout('DOUBLE SYNCHRO !', 'syn2');
    FX.burst(cx, cy, { n: 80 });
    FX.shake(350);
    wait = 1700;
  } else {
    SND.combo(6);
    callout('COMBO ×' + (k + 1) + ' 🔥', 'combo');
    FX.burst(cx, cy, { n: 24, emoji: '🔥', speed: 11, life: 80 });
    FX.burst(cx, cy, { n: 70 });
    FX.shake(500); FX.flash('#ff9f1c');
    wait = 2100;
  }

  // Ma case cochée
  if (gained.indexOf(me.id) >= 0) {
    const cell = $('#myGrid .pcell[data-i="' + h.theme + '"]');
    if (cell) {
      cell.classList.add('checked', 'stampin');
      setTimeout(() => cell.classList.remove('stampin'), 700);
      const p = cellRect(h.theme);
      if (p) FX.burst(p.x, p.y, { n: 34, speed: 7 });
      setTimeout(() => SND.stamp(), 200);
    }
  }

  // Progression + alerte "plus qu'une case !"
  updateStrip();
  gained.forEach((id) => {
    const chip = $('#strip .pchip[data-pid="' + id + '"]');
    if (chip) { chip.classList.remove('bump'); void chip.offsetWidth; chip.classList.add('bump'); }
  });
  const nearly = gained.filter((id) => shownProg[id] === N - 1 && N > 2);
  if (nearly.length) {
    const mine = nearly.indexOf(me.id) >= 0;
    const b = $('#banner');
    b.className = 'alert';
    b.textContent = mine ? '⚠️ TU ES À UNE CASE DU BINGMO !' : '⚠️ ' + nearly.map(nameOf).join(' & ') + ' : plus qu’UNE case !';
    $('#vignette').classList.remove('on');
    void $('#vignette').offsetWidth;
    $('#vignette').classList.add('on');
    setTimeout(() => SND.alert(), 600);
    wait = Math.max(wait, 2300);
  }
  await sleep(wait);
  card.classList.remove('mega');
}

/* ---------------- Fin de partie ---------------- */
function enterEnd() {
  // Arrivée directement sur l'écran de fin (rechargement de page) : on récupère ma grille sauvegardée
  const w = load(wordsKey());
  if (Array.isArray(w)) myWords = w;
  document.body.classList.remove('spectator');
  show('end');
  setEndTitle(false);
  renderEndStatic();
  sendGrid();
}

function setEndTitle(party) {
  const el = $('#endTitle');
  const text = S.aborted ? 'PARTIE ANNULÉE' : 'BINGMO !';
  el.className = 'bingmo-title' + (S.aborted ? ' small' : '');
  el.innerHTML = text.split('').map((ch, i) => '<span style="--i:' + i + '">' + (ch === ' ' ? '&nbsp;' : esc(ch)) + '</span>').join('');
  const win = S.winners || [];
  let sub;
  if (S.aborted) sub = 'Trop de joueurs sont partis… on se refait ça ?';
  else if (win.length === 1 && win[0] === me.id) sub = '🏆 C’EST TOI LE ROI DES IDÉES !';
  else if (win.length > 1) sub = '🤝 Égalité parfaite : ' + win.map(nameOf).join(' & ') + ' !';
  else sub = '🏆 ' + nameOf(win[0]) + ' crie BINGMO en premier !';
  $('#endSub').textContent = sub;
  if (party && win.indexOf(me.id) >= 0) callout('VICTOIRE ! 👑', 'mega');
}

function showEnd() {
  document.body.classList.remove('spectator');
  show('end');
  setEndTitle(true);
  renderEndStatic();
  sendGrid();
  if (S.aborted) return;
  SND.fanfare();
  FX.shake(800);
  FX.flash('#ffffff');
  FX.fireworks(8);
  FX.rain(6000);
  FX.burst(window.innerWidth / 2, window.innerHeight / 3, { n: 120, speed: 14 });
  reportEnd();
}

function renderEndStatic() {
  if (!S || S.phase !== 'end') return;
  const N = S.themes.length;
  const ranked = S.players.slice().sort((a, b) => (S.prog[b.id] || 0) - (S.prog[a.id] || 0));
  const medals = ['🥇', '🥈', '🥉'];
  $('#podium').innerHTML = ranked.map((p, i) => {
    const win = (S.winners || []).indexOf(p.id) >= 0;
    const syn = S.hist.filter((h) => h.hits.indexOf(p.id) >= 0).length;
    return '<div class="prow' + (win ? ' win' : '') + '" style="--d:' + i * 90 + 'ms"><span class="rk">' + (win ? '👑' : (medals[i] || (i + 1))) + '</span>' +
      av(p, 's') + '<span class="nm">' + esc(p.name) + '</span><span class="bar"><i style="width:' + ((S.prog[p.id] || 0) / N * 100) + '%"></i></span>' +
      '<span class="sc">' + (S.prog[p.id] || 0) + '/' + N + ' · ' + syn + ' synchro' + (syn > 1 ? 's' : '') + '</span></div>';
  }).join('');

  $('#grids').innerHTML = S.players.map((p) => {
    const words = p.id === me.id ? myWords : gridsSeen[p.id];
    const rows = S.themes.map((t, i) => {
      const got = S.hist.some((h) => h.theme === i && (h.pid === p.id || h.hits.indexOf(p.id) >= 0));
      const w = words ? wordLabel(words[i]) : '…';
      return '<li class="' + (got ? 'ok' : 'ko') + '"><span>' + esc(t) + '</span><b>' + esc(w) + '</b></li>';
    }).join('');
    return '<div class="gbox"><h4>' + av(p, 'xs') + esc(p.name) + '</h4><ul>' + rows + '</ul></div>';
  }).join('');

  const host = isHost();
  $('#btnAgain').hidden = !host;
  $('#againWait').hidden = host;
}

function sendGrid() {
  if (room && S && S.phase === 'end' && mePlays() && myWords.length) {
    room.send({ t: 'grid', g: S.gameId, words: myWords });
  }
}

function reportEnd() {
  if (finSent || S.aborted || !mePlays()) return;
  finSent = true;
  if (window.ChadGang && ChadGang.finPartie) {
    const synchros = S.hist.filter((h) => h.hits.indexOf(me.id) >= 0).length;
    try {
      Promise.resolve(ChadGang.finPartie({ gagne: S.winners.indexOf(me.id) >= 0, partie: S.gameId, score: synchros })).catch(() => {});
    } catch (e) { /* ignore */ }
  }
}

function playAgain() {
  if (!isHost() || !S || S.phase !== 'end') return;
  commit((s) => { s.phase = 'lobby'; s.gameId = null; s.cur = null; });
}

/* ---------------- Réactions emoji ---------------- */
let lastEmo = 0;
function sendEmoji(e) {
  if (!room || Date.now() - lastEmo < 350) return;
  lastEmo = Date.now();
  room.send({ t: 'emo', e });
}
function floatEmoji(e, from) {
  if (EMOJIS.indexOf(e) < 0) return;
  const el = document.createElement('div');
  el.className = 'fl';
  el.style.left = (8 + Math.random() * 80) + '%';
  el.style.setProperty('--dx', (Math.random() * 80 - 40) + 'px');
  el.innerHTML = esc(e) + '<small>' + esc(from.name || nameOf(from.id)) + '</small>';
  $('#floats').appendChild(el);
  setTimeout(() => el.remove(), 2700);
}

/* ---------------- Démarrage ---------------- */
async function boot() {
  let uid = null;
  try { uid = sessionStorage.getItem('bingmo_uid'); } catch (e) { /* ignore */ }
  if (!uid) {
    uid = 'u' + Math.random().toString(36).slice(2, 10);
    try { sessionStorage.setItem('bingmo_uid', uid); } catch (e) { /* ignore */ }
  }
  me.id = uid;
  let hub = false;
  if (window.ChadGang && ChadGang.me) {
    try {
      const m = await ChadGang.me();
      if (m && m.id) { me.id = m.id; me.name = m.name || ''; me.avatar = m.avatar || null; hub = !!m.name; }
    } catch (e) { /* mode secours */ }
  }
  if (!hub) {
    me.name = load('bingmo_name') || '';
    $('#pseudoRow').hidden = false;
    $('#pseudo').value = me.name;
  }

  // Boutons
  document.addEventListener('pointerdown', () => SND.unlock(), { once: true });
  $('#btnCreate').addEventListener('click', () => connect(randomCode(), true));
  $('#joinForm').addEventListener('submit', (e) => { e.preventDefault(); connect($('#code').value, false); });
  $('#btnRules').addEventListener('click', () => { $('#modal').hidden = false; });
  $('#btnHelp').addEventListener('click', () => { $('#modal').hidden = false; });
  $('#btnCloseRules').addEventListener('click', () => { $('#modal').hidden = true; });
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  $('#btnSound').addEventListener('click', () => { $('#btnSound').textContent = SND.toggle() ? '🔇' : '🔊'; });
  $('#btnSound').textContent = SND.isMuted() ? '🔇' : '🔊';
  $('#btnLeave').addEventListener('click', () => leaveRoom());
  $('#roomChip').addEventListener('click', copyCode);
  $('#btnCopy').addEventListener('click', copyCode);
  $('#btnStart').addEventListener('click', startGame);
  $('#btnReady').addEventListener('click', submitReady);
  $('#btnSay').addEventListener('click', () => { if (selected >= 0) say(selected); });
  $('#btnAgain').addEventListener('click', playAgain);
  $$('#settings .seg button').forEach((b) => b.addEventListener('click', () => setSetting(b.dataset.k, +b.dataset.v)));
  $$('.emos').forEach((box) => {
    box.innerHTML = EMOJIS.map((e) => '<button type="button">' + e + '</button>').join('');
    $$('button', box).forEach((b) => b.addEventListener('click', () => sendEmoji(b.textContent)));
  });

  // Boucles
  setInterval(() => {
    if (!room || !S) return;
    if (S.phase === 'write') writeTick(); else if (S.phase === 'play') playTick();
  }, 200);
  setInterval(hostTick, 400);
  setInterval(() => { if (room && isHost()) room.send({ t: 'tick', now: now() }); }, 2000);

  // Arrivée par invitation ?
  let inv = null;
  try { inv = (window.ChadGang && ChadGang.room && ChadGang.room()) || new URLSearchParams(location.search).get('room'); } catch (e) { /* ignore */ }
  if (inv) {
    if (me.name) connect(inv, true);
    else $('#code').value = cleanCode(inv);
  }
}

boot();

})();
