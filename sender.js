// Baduk Cast – phone side. Loaded into an awesomebaduk.com lesson page by the bookmarklet.
// Mirrors the board, the lesson state and the Vimeo position to the TV page (Presentation API / Chromecast).
(() => {
  if (window.__badukCast) { window.__badukCast.show(); return; }

  const BASE = window.__badukCastBase || (document.currentScript ? document.currentScript.src : location.href);
  const RECEIVER = new URL('tv.html', BASE).href;
  const SITE = 'https://awesomebaduk.com/';
  let conn = null;            // PresentationConnection or test window
  let face = true;            // show teacher video on the TV
  let vimeoState = { id: null, t: 0, paused: true, duration: 0 };
  let lastBoard = '';
  let wakeLock = null;

  // ---------- toolbar ----------
  const bar = document.createElement('div');
  bar.id = 'baduk-cast-bar';
  bar.innerHTML = `
    <style>
      #baduk-cast-bar{position:fixed;right:10px;bottom:10px;z-index:2147483647;display:flex;gap:6px;align-items:center;
        font:14px/1.2 system-ui,sans-serif;background:#1d1a16;color:#f3e6c8;padding:6px;border-radius:12px;box-shadow:0 4px 16px #0006}
      #baduk-cast-bar button{font:inherit;border:0;border-radius:8px;padding:9px 12px;background:#3a332a;color:#f3e6c8}
      #baduk-cast-bar button.on{background:#e0b85a;color:#1d1a16}
      #baduk-cast-bar .st{padding:0 4px;opacity:.8;max-width:9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    </style>
    <button data-a="cast">📺 Cast</button>
    <button data-a="face" class="on">🙂 Face</button>
    <span class="st">not connected</span>
    <button data-a="hide" title="Hide">✕</button>`;
  document.body.appendChild(bar);
  const status = s => { bar.querySelector('.st').textContent = s; };
  bar.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'cast') startCast(e.shiftKey);
    if (a === 'face') { face = !face; e.target.classList.toggle('on', face); push(true); }
    if (a === 'hide') bar.style.display = 'none';
  });

  // ---------- connection ----------
  async function startCast(testWindow) {
    if (conn && conn.state !== 'closed' && conn.state !== 'terminated') { conn.terminate?.(); conn = null; status('stopped'); setPhoneVolume(1); return; }
    if (testWindow || !('PresentationRequest' in window)) {           // desktop test: open the TV page in a new window
      const w = window.open(RECEIVER + '#test', 'badukcast-tv', 'width=1280,height=720');
      conn = { state: 'connected', send: m => w && !w.closed && w.postMessage(m, new URL(RECEIVER).origin), terminate: () => w.close() };
      setTimeout(() => connected(), 1500);
      return;
    }
    try {
      status('choose TV…');
      const req = new PresentationRequest([RECEIVER]);
      conn = await req.start();
      try { localStorage.setItem('badukCastId', conn.id); } catch (e) {}
      wire(conn);
    } catch (err) { status(err.name === 'NotAllowedError' ? 'cancelled' : 'cast failed: ' + err.name); }
  }
  const onHello = raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'hello') { lastBoard = ''; lastKey = ''; push(true); }
    if (m.type === 'control' && (m.action === 'play' || m.action === 'pause')) { vimeo(m.action); setTimeout(() => push(true), 1000); }   // TV remote
  };
  window.addEventListener('message', e => { if (e.origin === new URL(RECEIVER).origin) onHello(e.data); });
  function wire(c) {
    c.onmessage = e => onHello(e.data);
    c.onconnect = connected;
    c.onclose = () => { status('disconnected'); setPhoneVolume(1); };
    c.onterminate = () => { status('stopped'); setPhoneVolume(1); };
    if (c.state === 'connected') connected();
  }
  async function connected() {
    status('on TV');
    bar.querySelector('[data-a=cast]').classList.add('on');
    lastBoard = '';
    setPhoneVolume(0);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {}
    push(true);
  }
  // reconnect after a page reload (same tab)
  try {
    const id = localStorage.getItem('badukCastId');
    if (id && 'PresentationRequest' in window) new PresentationRequest([RECEIVER]).reconnect(id).then(c => { conn = c; wire(c); }).catch(() => {});
  } catch (e) {}

  const send = obj => { if (conn && conn.state === 'connected') conn.send(JSON.stringify(obj)); };

  // ---------- page reading ----------
  const iframe = () => document.getElementById('vimeo-player-iframe');
  const videoId = f => (f && (f.src.match(/vimeo\.com\/video\/(\d+)/) || [])[1]) || null;

  function boardSvg() {
    const b = document.querySelector('svg#board');
    if (!b) return '';
    const c = b.cloneNode(true);
    c.querySelectorAll('image').forEach(img => {
      const h = img.getAttribute('xlink:href') || img.getAttribute('href') || '';
      if (h && !/^(https?:|data:)/.test(h)) img.setAttribute('href', new URL(h, SITE).href), img.removeAttribute('xlink:href');
    });
    c.removeAttribute('width');
    return c.outerHTML;
  }

  function problem() {
    const card = [...document.querySelectorAll('.card')].find(c => c.querySelector('.card-header') && /to play|to live|to kill|problem/i.test(c.innerText));
    const inProblem = !iframe() && [...document.querySelectorAll('button')].some(b => /back to video/i.test(b.innerText));
    if (!inProblem) return null;
    return {
      title: card?.querySelector('.card-title')?.innerText.trim() || 'Problem',
      text: card?.querySelector('.card-body')?.innerText.trim() || ''
    };
  }

  function state() {
    return {
      type: 'state',
      lesson: document.querySelector('h1')?.innerText.trim() || '',
      mode: problem() ? 'problem' : (iframe() ? 'video' : 'board'),
      problem: problem(),
      face,
      video: { ...vimeoState, id: videoId(iframe()) }
    };
  }

  // ---------- Vimeo (phone player is the master clock) ----------
  const vimeo = (method, value) => {
    const f = iframe();
    if (f && f.contentWindow) f.contentWindow.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), 'https://player.vimeo.com');
  };
  function setPhoneVolume(v) { vimeo('setVolume', v); }
  window.addEventListener('message', e => {
    if (e.origin !== 'https://player.vimeo.com') return;
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch (err) { return; }
    if (d.method === 'getCurrentTime') vimeoState.t = +d.value || 0;
    if (d.method === 'getPaused') vimeoState.paused = !!d.value;
    if (d.method === 'getDuration') vimeoState.duration = +d.value || 0;
    if (d.event === 'ready' && conn) setPhoneVolume(0);
  });
  setInterval(() => {
    if (!iframe()) return;
    vimeo('getCurrentTime'); vimeo('getPaused'); vimeo('getDuration');
    if (conn && conn.state === 'connected') vimeo('setVolume', 0);   // new clip iframes start with sound
  }, 500);

  // ---------- push changes ----------
  let lastKey = '';
  function push(force) {
    if (!conn || conn.state !== 'connected') return;
    const svg = boardSvg();
    if (force || svg !== lastBoard) { lastBoard = svg; send({ type: 'board', svg }); }
    const s = state();
    const key = JSON.stringify({ ...s, video: { ...s.video, t: Math.round(s.video.t) } });
    if (force || key !== lastKey) { lastKey = key; send(s); }
  }
  let pending = 0;
  new MutationObserver(() => { if (!pending) pending = setTimeout(() => { pending = 0; push(); }, 120); })
    .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(() => push(), 1000);   // keeps the TV's video clock in step

  window.__badukCast = { show: () => { bar.style.display = 'flex'; }, test: () => startCast(true) };
  status('ready');
})();
