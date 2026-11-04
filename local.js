'use strict';
/* Mode de secours HORS hub : une "salle" entre onglets du même navigateur (BroadcastChannel).
   Imite l'API ChadGang.join() pour pouvoir tester le jeu en local avec plusieurs onglets. */
window.bingmoLocalRoom = function (code, user, create) {
  const bc = new BroadcastChannel('bingmo-' + code);
  const keepKey = 'bingmo-keep-' + code;
  const self = { id: user.id, name: user.name, joinedAt: Date.now(), seen: Date.now() };
  const peers = new Map();
  const handlers = {};
  let closed = false;
  let ready = false;

  const emit = (ev, a, b) => (handlers[ev] || []).slice().forEach((fn) => {
    try { fn(a, b); } catch (e) { console.error(e); }
  });
  const players = () => [self].concat(Array.from(peers.values()))
    .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1))
    .map((p) => ({ id: p.id, name: p.name }));
  const post = (m) => { if (!closed) bc.postMessage(m); };
  const info = () => ({ id: self.id, name: self.name, joinedAt: self.joinedAt });

  bc.onmessage = (ev) => {
    const m = ev.data;
    if (!m) return;
    if (m.k === 'hello' || m.k === 'hb') {
      const isNew = !peers.has(m.from.id);
      peers.set(m.from.id, Object.assign({}, m.from, { seen: Date.now() }));
      if (m.k === 'hello') post({ k: 'hb', from: info() });
      if (isNew && ready) emit('players', players());
    } else if (m.k === 'bye') {
      if (peers.delete(m.from) && ready) emit('players', players());
    } else if (m.k === 'msg' && ready) {
      const p = peers.get(m.from);
      emit('message', m.data, { id: m.from, name: p ? p.name : '?' });
    }
  };

  const beat = setInterval(() => {
    post({ k: 'hb', from: info() });
    let changed = false;
    peers.forEach((p, id) => {
      if (Date.now() - p.seen > 5000) { peers.delete(id); changed = true; }
    });
    if (changed && ready) emit('players', players());
  }, 1500);

  function leave() {
    if (closed) return;
    post({ k: 'bye', from: self.id });
    closed = true;
    clearInterval(beat);
    bc.close();
  }
  window.addEventListener('beforeunload', leave);

  setTimeout(() => {
    if (closed) return;
    if (!create && peers.size === 0) { emit('error', 'Salle introuvable'); return; }
    if (peers.size === 0) { try { localStorage.removeItem(keepKey); } catch (e) { /* ignore */ } }
    let last = null;
    try { last = JSON.parse(localStorage.getItem(keepKey)); } catch (e) { /* ignore */ }
    ready = true;
    emit('ready', { me: self.id, players: players(), last });
  }, 650);
  post({ k: 'hello', from: info() });

  return {
    on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
    send(data, opts) {
      if (closed) return;
      if (opts && opts.keep) { try { localStorage.setItem(keepKey, JSON.stringify(data)); } catch (e) { /* ignore */ } }
      post({ k: 'msg', from: self.id, data });
      setTimeout(() => emit('message', data, { id: self.id, name: self.name }), 0);
    },
    leave
  };
};
