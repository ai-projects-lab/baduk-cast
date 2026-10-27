// Baduk Cast – phone side. Loaded into an awesomebaduk.com lesson page by the bookmarklet.
// Mirrors the board, the lesson state and the Vimeo position to the TV page (paired by a code shown on the TV).
(() => {
  if (window.__badukCast) { window.__badukCast.show(); return; }

  const BASE = window.__badukCastBase || (document.currentScript ? document.currentScript.src : location.href);
  const RECEIVER = new URL('tv.html', BASE).href;
  const SITE = 'https://awesomebaduk.com/';
  let conn = null;            // relay connection or test window
  let face = true;            // show teacher video on the TV
  let vimeoState = { id: null, t: 0, paused: true, duration: 0 };
  let lastBoard = '';
  let wakeLock = null;

  // ---------- toolbar ----------
  const bar = document.createElement('div');
  bar.id = 'baduk-cast-bar';
  bar.innerHTML = `
    <style>
      #baduk-cast-bar{position:fixed;right:10px;bottom:10px;z-index:2147483647;display:flex;flex-wrap:wrap;justify-content:flex-end;max-width:calc(100vw - 20px);gap:6px;align-items:center;
        font:14px/1.2 system-ui,sans-serif;background:#1d1a16;color:#f3e6c8;padding:6px;border-radius:12px;box-shadow:0 4px 16px #0006}
      #baduk-cast-bar button{font:inherit;border:0;border-radius:8px;padding:9px 10px;background:#3a332a;color:#f3e6c8}
      #baduk-cast-bar button.on{background:#e0b85a;color:#1d1a16}
      #baduk-cast-bar .st{padding:0 4px;opacity:.8;max-width:9em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    </style>
    <button data-a="cast">📺 Cast</button>
    <button data-a="back">⏪ 10</button>
    <button data-a="fwd">10 ⏩</button>
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
    if (a === 'back' || a === 'fwd') {
      const t = Math.max(0, Math.min(vimeoState.duration || Infinity, vimeoState.t + (a === 'back' ? -10 : 10)));
      vimeo('setCurrentTime', t); vimeoState.t = t; push(true);
    }
  });

  // ---------- connection: pairing code shown on the TV page, messages via a public MQTT relay ----------
  // conn = { state: 'connected' | 'closed', send(string), terminate() }   (test mode: a second window)
  async function startCast(testWindow) {
    if (conn && conn.state === 'connected') { conn.terminate(); return; }
    if (testWindow) {
      const w = window.open(RECEIVER + '#test', 'badukcast-tv', 'width=1280,height=720');
      conn = { state: 'connected', send: m => w && !w.closed && w.postMessage(m, new URL(RECEIVER).origin), terminate: () => { w.close(); closed('stopped'); } };
      setTimeout(() => connected(), 1500);
      return;
    }
    let saved = '';
    try { saved = localStorage.getItem('badukCastCode') || ''; } catch (e) {}
    const input = prompt('Code shown on the TV:', saved);
    if (input === null) return;
    const code = input.replace(/\D/g, '');
    if (code.length !== 6) { status('code must have 6 digits'); return; }
    try { localStorage.setItem('badukCastCode', code); } catch (e) {}
    status('connecting…');
    try { await loadScript(new URL('mqtt-lite.js', BASE).href, 'BadukMqtt'); } catch (e) { status('relay script failed'); return; }
    const client = BadukMqtt.connect({
      onMessage: (topic, text) => onHello(text),
      onState: st => {
        if (st === 'online') { status('looking for TV…'); client.publish(BadukMqtt.topic(code, 'tv'), JSON.stringify({ type: 'ping' })); }
        else if (conn && conn.state === 'connected') status(st === 'connecting' ? 'reconnecting…' : 'offline, retrying…');
      }
    });
    client.subscribe(BadukMqtt.topic(code, 'phone'));
    conn = { state: 'connected', send: m => client.publish(BadukMqtt.topic(code, 'tv'), m), terminate: () => { client.close(); closed('stopped'); } };
    tvSeen = false;
    const pinger = setInterval(() => {   // repeat until the TV answers (the first ping can beat our own subscription)
      if (tvSeen || !conn || conn.state !== 'connected') return clearInterval(pinger);
      client.publish(BadukMqtt.topic(code, 'tv'), JSON.stringify({ type: 'ping' }));
    }, 2000);
    setTimeout(() => { if (conn && conn.state === 'connected' && !tvSeen) status('TV not found – is the page open with code ' + code + '?'); }, 8000);
  }
  let tvSeen = false;
  function loadScript(src, globalName) {
    return new Promise((resolve, reject) => {
      if (window[globalName]) return resolve();
      const sc = document.createElement('script');
      sc.src = src; sc.onload = resolve; sc.onerror = reject;
      document.head.appendChild(sc);
    });
  }

  const onHello = raw => {
    let m; try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (m.type === 'hello') { if (!tvSeen) { tvSeen = true; connected(); } lastBoard = ''; lastKey = ''; imgSent.clear(); push(true); }
    if (m.type === 'control' && (m.action === 'play' || m.action === 'pause')) { vimeo(m.action); setTimeout(() => push(true), 1000); }   // TV remote
    if (m.type === 'control' && m.action === 'seek' && isFinite(m.t)) { vimeo('setCurrentTime', Math.max(0, +m.t)); vimeoState.t = +m.t; }
  };
  window.addEventListener('message', e => { if (e.origin === new URL(RECEIVER).origin) onHello(e.data); });

  async function connected() {
    status('on TV');
    bar.querySelector('[data-a=cast]').classList.add('on');
    lastBoard = '';
    setPhoneVolume(0);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {}
    push(true);
  }
  function closed(why) {
    if (conn) conn.state = 'closed';
    status(why);
    bar.querySelector('[data-a=cast]').classList.remove('on');
    setPhoneVolume(1);
    try { wakeLock && wakeLock.release(); } catch (e) {}
  }

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
    if (d.event === 'ready' && conn && conn.state === 'connected') setPhoneVolume(0);
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
    if (force || svg !== lastBoard) { lastBoard = svg; sendImages(svg); send({ type: 'board', svg }); }
    const s = state();
    const key = JSON.stringify({ ...s, video: { ...s.video, t: Math.round(s.video.t) } });
    if (force || key !== lastKey) { lastKey = key; send(s); }
  }
  // stone images travel with the board, so the TV never has to load anything from awesomebaduk.com itself
  const imgData = {}, imgSent = new Set();
  function sendImages(svg) {
    [...new Set(svg.match(/https:\/\/awesomebaduk\.com\/[^"'\s)]+\.(?:png|jpe?g|gif|svg|webp)/g) || [])].forEach(url => {
      if (imgSent.has(url)) return;
      imgSent.add(url);
      imgData[url] = imgData[url] || fetch(url).then(r => r.blob()).then(b => new Promise(res => {
        const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b);
      }));
      imgData[url].then(data => send({ type: 'img', url, data }), () => { imgSent.delete(url); delete imgData[url]; });
    });
  }
  let pending = 0;
  new MutationObserver(() => { if (!pending) pending = setTimeout(() => { pending = 0; push(); }, 120); })
    .observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  setInterval(() => push(), 1000);   // keeps the TV's video clock in step

  window.__badukCast = { show: () => { bar.style.display = 'flex'; }, test: () => startCast(true) };
  status('ready');
})();
