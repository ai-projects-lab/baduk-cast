// Baduk Cast – phone side. Loaded into an awesomebaduk.com lesson page by the bookmarklet.
// Mirrors the board, the lesson state and the Vimeo position to the TV page (Google Cast custom receiver).
(() => {
  if (window.__badukCast) { window.__badukCast.show(); return; }

  const BASE = window.__badukCastBase || (document.currentScript ? document.currentScript.src : location.href);
  const RECEIVER = new URL('tv.html', BASE).href;
  const SITE = 'https://awesomebaduk.com/';
  const APP_ID = '71DA1E68';                            // Google Cast application ID of tv.html (cast.google.com/publish)
  const NS = 'urn:x-cast:io.github.ai-projects-lab.badukcast';
  let conn = null;            // Cast session wrapper or test window
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

  // ---------- connection (Google Cast custom receiver; test mode: a second window) ----------
  // conn = { state: 'connected' | 'closed', send(string), terminate() }
  async function startCast(testWindow) {
    if (conn && conn.state === 'connected') { conn.terminate(); return; }
    if (testWindow) {
      const w = window.open(RECEIVER + '#test', 'badukcast-tv', 'width=1280,height=720');
      conn = { state: 'connected', send: m => w && !w.closed && w.postMessage(m, new URL(RECEIVER).origin), terminate: () => { w.close(); closed('stopped'); } };
      setTimeout(() => connected(), 1500);
      return;
    }
    if (!APP_ID) { status('no Cast app ID yet'); return; }
    status('loading Cast…');
    const ctx = await castContext().catch(err => { status('Cast not available'); return null; });
    if (!ctx) return;
    status('choose TV…');
    ctx.requestSession().catch(err => status(err === 'cancel' ? 'cancelled' : 'cast failed: ' + err));
  }

  const onHello = raw => {
    let m; try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { return; }
    if (m.type === 'hello') { lastBoard = ''; lastKey = ''; push(true); }
    if (m.type === 'control' && (m.action === 'play' || m.action === 'pause')) { vimeo(m.action); setTimeout(() => push(true), 1000); }   // TV remote
    if (m.type === 'control' && m.action === 'seek' && isFinite(m.t)) { vimeo('setCurrentTime', Math.max(0, +m.t)); vimeoState.t = +m.t; }
  };
  window.addEventListener('message', e => { if (e.origin === new URL(RECEIVER).origin) onHello(e.data); });

  let ctxPromise = null;
  function castContext() {
    if (ctxPromise) return ctxPromise;
    ctxPromise = new Promise((resolve, reject) => {
      const ready = () => {
        const ctx = cast.framework.CastContext.getInstance();
        ctx.setOptions({ receiverApplicationId: APP_ID, autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED });
        ctx.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, e => {
          const S = cast.framework.SessionState;
          if (e.sessionState === S.SESSION_STARTED || e.sessionState === S.SESSION_RESUMED) {
            const session = ctx.getCurrentSession();
            session.addMessageListener(NS, (ns, msg) => onHello(msg));
            conn = { state: 'connected', send: m => session.sendMessage(NS, m).catch(() => {}), terminate: () => ctx.endCurrentSession(true) };
            connected();
          }
          if (e.sessionState === S.SESSION_ENDED) closed('stopped');
        });
        resolve(ctx);
      };
      if (window.cast && cast.framework) return ready();
      window.__onGCastApiAvailable = ok => ok ? ready() : reject(new Error('cast unavailable'));
      const sc = document.createElement('script');
      sc.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      sc.onerror = () => reject(new Error('cast script failed'));
      document.head.appendChild(sc);
    });
    return ctxPromise;
  }
  if (APP_ID) castContext().catch(() => {});   // resumes a running TV session after a page reload

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
