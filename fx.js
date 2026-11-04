'use strict';
/* Bingmo — effets spéciaux : sons synthétisés (SND) + particules, secousses, flash (FX). */

/* ---------- Sons (WebAudio, aucun fichier) ---------- */
const SND = (() => {
  let ac = null;
  let muted = false;
  try { muted = localStorage.getItem('bingmo_mute') === '1'; } catch (e) { /* ignore */ }

  function audio() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function tone(freq, dur, type, vol, delay, slideTo) {
    if (muted) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.15, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function noise(dur, vol, delay, cutoff) {
    if (muted) return;
    const a = audio();
    if (!a) return;
    const t = a.currentTime + (delay || 0);
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff || 1500;
    const g = a.createGain();
    g.gain.value = vol || 0.1;
    src.connect(f);
    f.connect(g);
    g.connect(a.destination);
    src.start(t);
  }

  const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
  const note = (semi) => 523.25 * Math.pow(2, semi / 12);

  return {
    unlock() { audio(); },
    isMuted() { return muted; },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('bingmo_mute', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!muted) this.ding();
      return muted;
    },
    tick() { tone(880, 0.05, 'square', 0.05); },
    ding() { tone(784, 0.15, 'triangle', 0.18); tone(1175, 0.25, 'triangle', 0.16, 0.09); },
    pop() { tone(300, 0.14, 'sine', 0.22, 0, 800); },
    whoosh() { noise(0.28, 0.08, 0, 2200); },
    stamp() { noise(0.12, 0.25, 0, 500); tone(130, 0.16, 'square', 0.14, 0, 55); },
    combo(k) {
      const n = Math.min(2 + k, 8);
      for (let i = 0; i < n; i++) tone(note(SCALE[i]), 0.16, 'triangle', 0.16, i * 0.065);
    },
    sad() { tone(330, 0.3, 'sawtooth', 0.1, 0, 220); tone(247, 0.55, 'sawtooth', 0.1, 0.28, 120); },
    alert() { for (let i = 0; i < 3; i++) tone(180, 0.12, 'square', 0.1, i * 0.18); },
    boom() { noise(0.6, 0.3, 0, 350); tone(95, 0.45, 'sine', 0.3, 0, 38); },
    fanfare() {
      [0, 4, 7, 12].forEach((s, i) => tone(note(s), 0.22, 'square', 0.1, i * 0.14));
      [0, 4, 7, 12, 16].forEach((s) => tone(note(s), 0.9, 'triangle', 0.1, 0.6));
    }
  };
})();

/* ---------- Particules, secousses, flash ---------- */
const FX = (() => {
  const cv = document.getElementById('fx');
  const ctx = cv.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let parts = [];
  let running = false;
  const COLORS = ['#ffd426', '#ff4d6d', '#2de2c4', '#ffffff', '#7c5cff', '#ff9f1c', '#4cc9f0'];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = cv.width = Math.floor(window.innerWidth * dpr);
    H = cv.height = Math.floor(window.innerHeight * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  function add(p) {
    if (parts.length > 900) return;
    parts.push(p);
    if (!running) { running = true; requestAnimationFrame(loop); }
  }

  function star(c, r) {
    c.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? r * 0.45 : r;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
  }

  function draw(p) {
    const life = p.age / p.life;
    ctx.globalAlpha = life > 0.7 ? Math.max(0, 1 - (life - 0.7) / 0.3) : 1;
    ctx.fillStyle = p.color;
    ctx.strokeStyle = p.color;
    if (p.shape === 'spark') {
      ctx.lineWidth = Math.max(1, p.size * 0.4);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2.2, p.y - p.vy * 2.2);
      ctx.stroke();
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    if (p.shape === 'emoji') {
      ctx.font = Math.round(p.size * 3) + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.emoji, 0, 0);
    } else if (p.shape === 'circle') {
      ctx.beginPath();
      ctx.arc(0, 0, p.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.shape === 'star') {
      star(ctx, p.size * 0.8);
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
    }
    ctx.restore();
  }

  function loop() {
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.vx *= p.drag;
      p.vy = p.vy * p.drag + p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.age++;
      draw(p);
    }
    ctx.globalAlpha = 1;
    parts = parts.filter((p) => p.age < p.life && p.y < H + 60 * dpr);
    if (parts.length) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, W, H); }
  }

  /** Explosion de particules centrée sur (x, y) en pixels écran. */
  function burst(x, y, opt) {
    const o = opt || {};
    const n = o.n == null ? 36 : o.n;
    const colors = o.colors || COLORS;
    const shapes = o.shapes || ['rect', 'rect', 'circle', 'star'];
    const speed = o.speed == null ? 9 : o.speed;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * rnd(0.3, 1.1);
      add({
        x: x * dpr, y: y * dpr,
        vx: Math.cos(a) * s * dpr, vy: (Math.sin(a) * s - (o.up || 0)) * dpr,
        g: (o.gravity == null ? 0.28 : o.gravity) * dpr, drag: 0.985,
        life: (o.life || 75) * rnd(0.7, 1.2), age: 0,
        size: (o.size || 8) * rnd(0.6, 1.4) * dpr,
        color: pick(colors), shape: o.emoji ? 'emoji' : pick(shapes), emoji: o.emoji,
        rot: rnd(0, 6), vr: rnd(-0.3, 0.3)
      });
    }
  }

  /** Pluie de confettis qui tombent du haut de l'écran. */
  function rain(ms, opt) {
    const o = opt || {};
    const end = performance.now() + (ms || 3000);
    (function drop() {
      if (performance.now() > end) return;
      for (let i = 0; i < 4; i++) {
        add({
          x: Math.random() * W, y: -20 * dpr,
          vx: rnd(-1.5, 1.5) * dpr, vy: rnd(2, 5) * dpr, g: 0.04 * dpr, drag: 0.998,
          life: 260, age: 0, size: rnd(7, 13) * dpr,
          color: pick(o.colors || COLORS), shape: o.emoji ? 'emoji' : pick(['rect', 'rect', 'circle', 'star']),
          emoji: o.emoji, rot: rnd(0, 6), vr: rnd(-0.2, 0.2)
        });
      }
      requestAnimationFrame(drop);
    })();
  }

  /** Feux d'artifice qui éclatent un peu partout. */
  function fireworks(count) {
    for (let i = 0; i < (count || 5); i++) {
      setTimeout(() => {
        const x = window.innerWidth * rnd(0.12, 0.88);
        const y = window.innerHeight * rnd(0.12, 0.5);
        burst(x, y, {
          n: 70, speed: 11, gravity: 0.16, life: 95, size: 6,
          shapes: ['spark', 'spark', 'circle'], colors: [pick(COLORS), pick(COLORS), '#fff']
        });
        SND.boom();
      }, i * 340 + rnd(0, 200));
    }
  }

  function shake(ms) {
    const el = document.getElementById('app');
    el.classList.remove('shake');
    void el.offsetWidth;
    el.classList.add('shake');
    setTimeout(() => el.classList.remove('shake'), ms || 500);
  }

  function flash(color) {
    const f = document.getElementById('flash');
    f.style.background = color || '#fff';
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  return { burst, rain, fireworks, shake, flash };
})();
