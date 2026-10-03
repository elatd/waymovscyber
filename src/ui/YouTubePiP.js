// Picture-in-picture YouTube player for real music while driving. It uses YouTube's official
// embed (the player stays visible and at least 200 px tall, as YouTube requires) and works
// wherever the page is allowed to embed youtube.com: the local dev server or your own site.
// The claude.ai-hosted copy can't embed other sites, and YouTube refuses pages opened straight
// from a file (no page address to identify), so there it explains how to get YouTube.
// YouTube only replaces the soundtrack: the game's sound effects keep playing. The player's
// status messages (embed API over postMessage) bring the soundtrack back when a video can't play.

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

// → { video, list } | { list } | { handle } | null
export function parseYouTube(text) {
  const raw = (text || '').trim();
  if (!raw) return null;
  if (VIDEO_ID.test(raw)) return { video: raw };
  let u;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { return null; }
  const host = u.hostname.replace(/^(www|m|music)\./, '');
  const list = u.searchParams.get('list');
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'youtu.be') return VIDEO_ID.test(parts[0] || '') ? { video: parts[0], list } : null;
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  const v = u.searchParams.get('v');
  if (v && VIDEO_ID.test(v)) return { video: v, list };
  if (['shorts', 'live', 'embed', 'v'].includes(parts[0]) && VIDEO_ID.test(parts[1] || '')) return { video: parts[1], list };
  if (parts[0] === 'channel' && /^UC[\w-]{22}$/.test(parts[1] || '')) return { list: 'UU' + parts[1].slice(2) }; // channel uploads
  if (list) return { list };
  if (parts[0] && (parts[0].startsWith('@') || parts[0] === 'c' || parts[0] === 'user')) return { handle: parts[0] };
  return null;
}

const POS_KEY = 'wvc-yt-pos';
// YouTube embed error codes → what to tell the player
const NO_SITE = 'YouTube needs the game to run from a website to play videos — start it with npm run dev or host it on your own site.';
const ERROR_MSG = {
  2: 'YouTube didn’t accept that link. Check it and try again.',
  5: 'This video won’t play in the embedded player. Try another video or a playlist.',
  152: NO_SITE,
  153: NO_SITE,
  other: 'YouTube won’t play this video outside youtube.com (its owner turned that off, or it’s private or removed). Try another video or a playlist — the game music is back on.',
};
const BLOCKED_MSG = {
  sandbox: 'YouTube can’t play here: this copy of the game runs inside a sandbox that blocks YouTube.<br>Open the game from your computer (<b>npm run dev</b>) or your own website — or use <b>Add my music</b> with your own songs.',
  file: 'YouTube can’t play when the game is opened straight from a file — YouTube only plays inside a website.<br>Start it with <b>npm run dev</b> and open localhost:5178, or put it on your own website — or use <b>Add my music</b> with your own songs.',
};

export class YouTubePiP {
  // opts: { onStart(), onStop(), onTitle(title) }
  constructor(root, opts = {}) {
    this.root = root;
    this.opts = opts;
    this.el = null;
    this.frame = null;
    this.volume = 0.6;
    this.duck = 1;
    this.failed = false; // the video can't play (error shown, soundtrack back on)
    this.blocked = false; // sandboxed copy: YouTube can't load at all
    this.linked = false; // the embedded player answered our "listening" handshake
    this.isList = false;
    this.listLen = 0;
    this.skips = 0;
    this.title = '';
    window.addEventListener('message', (e) => this._onMessage(e));
    this.lastLink = '';
    try { this.lastLink = localStorage.getItem('wvc-yt-link') || ''; } catch { /* ignore */ }
    // the claude.ai-hosted copy runs in a sandbox whose policy forbids embedding other sites
    let anc = '';
    try { anc = Array.from(location.ancestorOrigins || []).join(' '); } catch { /* ignore */ }
    this.sandboxed = window.self !== window.top && /claude/i.test(anc + ' ' + document.referrer);
    this.blockReason = this.sandboxed ? 'sandbox' : location.protocol === 'file:' ? 'file' : '';
  }

  // true while YouTube is the music source (mounted, not failed, not blocked)
  get active() {
    return !!this.frame && !this.failed && !this.blocked;
  }

  // returns an error message, or null when the player started
  play(link) {
    const p = parseYouTube(link);
    if (!p) return 'That doesn’t look like a YouTube link.';
    if (p.handle) return 'Channel names like @name can’t be looked up here — open the channel, pick a video or a playlist and paste that link instead.';
    const q = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', modestbranding: '1', enablejsapi: '1' });
    if (location.origin && location.origin !== 'null') q.set('origin', location.origin);
    let src;
    if (p.video) {
      if (p.list) q.set('list', p.list);
      else { q.set('loop', '1'); q.set('playlist', p.video); }
      src = `https://www.youtube.com/embed/${p.video}?${q}`;
    } else {
      q.set('list', p.list);
      src = `https://www.youtube.com/embed/videoseries?${q}`;
    }
    this.lastLink = link.trim();
    try { localStorage.setItem('wvc-yt-link', this.lastLink); } catch { /* ignore */ }
    this.mount();
    if (this.blockReason) { this.showBlocked(); return null; }
    this.failed = this.blocked = this.linked = false;
    this.isList = !!p.list;
    this.listLen = this.skips = 0;
    this.title = '';
    this.el.classList.remove('blocked');
    this.frame.src = src;
    if (this.opts.onStart) this.opts.onStart();
    return null;
  }

  stop() {
    if (!this.el) return;
    clearInterval(this.listenT);
    this.el.remove();
    this.el = this.frame = null;
    this.failed = this.blocked = false;
    if (this.opts.onStop) this.opts.onStop();
  }

  setVolume(v, duck = this.duck) {
    this.volume = v;
    this.duck = duck;
    this.command('setVolume', [Math.round(v * duck * 100)]);
  }

  next() {
    this.command('nextVideo');
  }

  command(func, args = []) {
    this._post({ event: 'command', func, args });
  }

  _post(msg) {
    try { if (this.frame && this.frame.contentWindow) this.frame.contentWindow.postMessage(JSON.stringify({ ...msg, id: 'wvc', channel: 'widget' }), '*'); } catch { /* ignore */ }
  }

  // ask the embedded player to report its state to us (what YouTube's iframe API does)
  _listen() {
    clearInterval(this.listenT);
    let n = 0;
    this.listenT = setInterval(() => {
      if (this.linked || !this.frame || ++n > 20) { clearInterval(this.listenT); return; }
      this._post({ event: 'listening' });
    }, 250);
  }

  _onMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow || typeof e.data !== 'string') return;
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (!d || typeof d !== 'object') return;
    if ((d.event === 'onReady' || d.event === 'initialDelivery') && !this.linked) {
      this.linked = true;
      this.setVolume(this.volume);
      if (this.isList) this.command('setLoop', [true]);
    }
    if (d.event === 'onError') { this._fail(d.info); return; }
    const info = d.info;
    if (!info || typeof info !== 'object') return;
    if (Array.isArray(info.playlist)) this.listLen = info.playlist.length;
    if (info.playerState === 1) this.skips = 0;
    const title = info.videoData && typeof info.videoData.title === 'string' ? info.videoData.title.trim() : '';
    if (title && title !== this.title && !this.failed) {
      this.title = title;
      if (this.opts.onTitle) this.opts.onTitle(title);
    }
  }

  // the current video can't play: skip it inside a playlist, otherwise say why and give
  // the music back to the game
  _fail(code) {
    if (this.failed || !this.el) return;
    if (this.isList && this.listLen > 1 && this.skips < Math.min(5, this.listLen - 1)) {
      this.skips++;
      this.next();
      return;
    }
    this.failed = true;
    this.title = '';
    this.el.querySelector('.yt-blocked-msg').textContent = ERROR_MSG[code] || ERROR_MSG.other;
    this.el.classList.add('blocked');
    if (this.opts.onStop) this.opts.onStop();
  }

  showBlocked() {
    if (!this.el) return;
    this.blocked = true;
    this.el.querySelector('.yt-blocked-msg').innerHTML = BLOCKED_MSG[this.blockReason] || BLOCKED_MSG.sandbox;
    this.el.classList.add('blocked');
    if (this.opts.onStop) this.opts.onStop();
  }

  mount() {
    if (this.el) return;
    const el = document.createElement('div');
    el.className = 'yt-pip';
    el.innerHTML = `
      <div class="yt-bar"><span class="yt-grip">♪ YOUTUBE</span><button class="yt-btn yt-next" title="Next video" aria-label="Next video">⏭</button><button class="yt-btn yt-close" title="Close" aria-label="Close YouTube player">✕</button></div>
      <div class="yt-blocked-msg" role="status"></div>`;
    const frame = document.createElement('iframe');
    frame.title = 'YouTube music';
    frame.allow = 'autoplay; encrypted-media; picture-in-picture';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    el.insertBefore(frame, el.querySelector('.yt-blocked-msg'));
    this.root.appendChild(el);
    this.el = el;
    this.frame = frame;
    this.frame.addEventListener('load', () => this._listen());
    el.querySelector('.yt-close').addEventListener('click', (e) => { e.stopPropagation(); this.stop(); });
    el.querySelector('.yt-next').addEventListener('click', (e) => { e.stopPropagation(); this.next(); });
    // drag by the title bar; remember where the player was left
    try {
      const pos = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (pos) this.place(pos.x, pos.y);
    } catch { /* ignore */ }
    const bar = el.querySelector('.yt-bar');
    let drag = null;
    bar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      const r = el.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', (e) => { if (drag) this.place(e.clientX - drag.dx, e.clientY - drag.dy); });
    bar.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = null;
      const r = el.getBoundingClientRect();
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top })); } catch { /* ignore */ }
    });
  }

  place(x, y) {
    const el = this.el;
    const w = el.offsetWidth || 360, h = el.offsetHeight || 230;
    el.style.left = Math.max(4, Math.min(innerWidth - w - 4, x)) + 'px';
    el.style.top = Math.max(4, Math.min(innerHeight - h - 4, y)) + 'px';
    el.style.right = 'auto';
    el.style.transform = 'none';
  }

  // small dialog to paste a link
  openDialog(onClose) {
    const d = document.createElement('div');
    d.className = 'yt-dialog';
    d.innerHTML = `
      <div class="yt-card" role="dialog" aria-label="YouTube music">
        <div class="panel-title">YOUTUBE MUSIC</div>
        <p>Paste a YouTube video, playlist or channel link (<i>youtube.com/channel/UC…</i>). It plays in a small window while you drive.</p>
        <input class="yt-input" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://www.youtube.com/watch?v=…">
        <div class="yt-err" aria-live="polite"></div>
        <div class="yt-actions">
          <button class="yt-play">PLAY ▶</button>
          ${this.el ? '<button class="yt-stop">STOP</button>' : ''}
          <button class="yt-cancel">CANCEL</button>
        </div>
      </div>`;
    this.root.appendChild(d);
    const input = d.querySelector('.yt-input');
    input.value = this.lastLink;
    setTimeout(() => { input.focus(); input.select(); }, 30);
    const close = () => { d.remove(); if (onClose) onClose(); };
    const go = () => {
      const err = this.play(input.value);
      if (err) { d.querySelector('.yt-err').textContent = err; return; }
      close();
    };
    d.querySelector('.yt-play').addEventListener('click', (e) => { e.stopPropagation(); go(); });
    d.querySelector('.yt-cancel').addEventListener('click', (e) => { e.stopPropagation(); close(); });
    const stopBtn = d.querySelector('.yt-stop');
    if (stopBtn) stopBtn.addEventListener('click', (e) => { e.stopPropagation(); this.stop(); close(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
      if (e.key === 'Escape') close();
    });
    d.addEventListener('pointerdown', (e) => { if (e.target === d) close(); });
  }
}
