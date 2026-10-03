// Menu screens (DOM): loading, title, car select, pause, settings, results.
// Navigable by keyboard, mouse/touch and gamepad (through Input's edge presses).

export const CAR_INFO = {
  waymo: {
    name: 'WAYMO', model: 'Jaguar I-PACE · 5th-gen Driver', color: '#3ad6c5',
    tagline: 'Sees everything. 360° lidar. Zero chill.',
    stats: { 'TOP SPEED': 0.76, ACCEL: 0.7, GRIP: 0.92, DRIFT: 0.68, TOUGHNESS: 0.85 },
    special: 'LIDAR PULSE', specialDesc: 'Fires a lidar shockwave that shoves nearby traffic out of your way and refills your boost.',
  },
  cybercab: {
    name: 'CYBERCAB', model: 'Tesla · no wheel, no pedals', color: '#ff5a36',
    tagline: 'Two seats. No steering wheel. All gas.',
    stats: { 'TOP SPEED': 0.9, ACCEL: 0.9, GRIP: 0.74, DRIFT: 0.88, TOUGHNESS: 0.7 },
    special: 'LUDICROUS MODE', specialDesc: 'Rocket-sled acceleration for a few seconds. Traffic becomes bowling pins.',
  },
};

export const TOD_LIST = [['day', 'SUNNY AFTERNOON'], ['sunset', 'GOLDEN HOUR'], ['night', 'NEON NIGHT']];
export const QUALITY_LIST = ['low', 'medium', 'high', 'ultra'];

export class Menus {
  constructor(game) {
    this.game = game;
    this.root = game.ui;
    this.screens = {};
    this.current = null;
    this.sel = 0;
    this.build();
  }

  el(html, id) {
    const d = document.createElement('div');
    d.className = 'screen hidden';
    d.id = id;
    d.innerHTML = html;
    this.root.appendChild(d);
    this.screens[id] = d;
    return d;
  }

  build() {
    this.el(`
      <div class="load-wrap">
        <div class="logo small"><span class="l-way">WAYMO</span><span class="l-vs">VS</span><span class="l-cyber">CYBERTAXI</span></div>
        <div class="load-bar"><div id="load-fill"></div></div>
        <div class="load-msg" id="load-msg">Booting robotaxi brains…</div>
      </div>`, 'loading');

    this.el(`
      <div class="title-wrap">
        <div class="logo"><span class="l-way">WAYMO</span><span class="l-vs">VS</span><span class="l-cyber">CYBERTAXI</span></div>
        <div class="subtitle">CRAZY ROBOTAXI WARS · SAN FRANCISCO</div>
        <div class="menu" id="title-menu"></div>
        <div class="press" id="title-press">PRESS ENTER OR CLICK TO START</div>
        <div class="controls-hint">
          <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> drive</span><span><kbd>SPACE</kbd> drift</span><span><kbd>SHIFT</kbd> boost</span><span><kbd>E</kbd> special</span><span><kbd>H</kbd> horn</span><span><kbd>C</kbd> camera</span><span><kbd>R</kbd> reset</span><span><kbd>ESC</kbd> pause</span><span>🎮 gamepad supported</span><span>🎵 drop your own songs here · YouTube in Settings · <kbd>N</kbd> next song</span>
        </div>
      </div>`, 'title');

    const pills = Object.entries(CAR_INFO).map(([k, c]) => `<button class="cs-pill" data-car="${k}" role="tab" style="--c:${c.color}">${c.name}</button>`).join('');
    this.el(`
      <div class="select-wrap">
        <div class="select-head">CHOOSE YOUR ROBOTAXI</div>
        <div class="car-switch" role="tablist" aria-label="Robotaxi">
          <button class="cs-arrow" data-dir="-1" aria-label="Previous robotaxi">◀</button>${pills}<button class="cs-arrow" data-dir="1" aria-label="Next robotaxi">▶</button>
        </div>
        <div class="car-card" id="car-card"></div>
        <div class="select-opts" id="select-opts"></div>
        <button class="start-btn" id="start-btn">START ▶</button>
        <div class="press"><kbd>◀</kbd><kbd>▶</kbd> SWITCH ROBOTAXI · <kbd>ENTER</kbd> START · <kbd>ESC</kbd> BACK</div>
      </div>`, 'select');

    this.el(`<div class="panel"><div class="panel-title">PAUSED</div><div class="menu" id="pause-menu"></div></div>`, 'pause');
    this.el(`<div class="panel"><div class="panel-title">SETTINGS</div><div class="menu" id="settings-menu"></div></div>`, 'settings');
    this.el(`<div class="results-wrap" id="results-body"></div>`, 'results');
    this.el(`<div class="countdown" id="countdown-num">3</div>`, 'countdown');

    const sel = this.screens.select;
    sel.querySelectorAll('.cs-arrow').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); this.game.cycleCar(+b.dataset.dir); this.game.audio.play('ui_move'); })
    );
    sel.querySelectorAll('.cs-pill').forEach((b) =>
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.game.selectedCar === b.dataset.car) return;
        this.game.selectCar(b.dataset.car);
        this.game.audio.play('ui_move');
      })
    );
    sel.querySelector('#start-btn').addEventListener('click', (e) => { e.stopPropagation(); this.game.audio.play('ui_select'); this.game.startRace(); });
  }

  show(name) {
    for (const [k, s] of Object.entries(this.screens)) s.classList.toggle('hidden', k !== name);
    this.current = name;
    this.sel = 0;
    if (name === 'title') this.renderTitle();
    if (name === 'select') this.renderSelect();
    if (name === 'pause') this.renderList('pause-menu', this.pauseItems());
    if (name === 'settings') this.renderList('settings-menu', this.settingsItems());
  }

  hideAll() {
    for (const s of Object.values(this.screens)) s.classList.add('hidden');
    this.current = null;
  }

  setLoading(p, msg) {
    const f = document.getElementById('load-fill');
    if (f) f.style.width = Math.round(p * 100) + '%';
    const m = document.getElementById('load-msg');
    if (m && msg) m.textContent = msg;
  }

  // ---------------------------------------------------------------- lists
  titleItems() {
    const g = this.game;
    return [
      { label: 'ARCADE · VS RIVAL', action: () => g.toSelect('arcade') },
      { label: 'FREE RIDE', action: () => g.toSelect('free') },
      { label: 'SETTINGS', action: () => { this.back = 'title'; this.show('settings'); } },
    ];
  }

  pauseItems() {
    const g = this.game;
    return [
      { label: 'RESUME', action: () => g.resume() },
      { label: 'RESTART', action: () => g.restart() },
      { label: 'CHANGE ROBOTAXI', action: () => g.toSelect(g.mode) },
      { label: 'SETTINGS', action: () => { this.back = 'pause'; this.show('settings'); } },
      { label: 'QUIT TO TITLE', action: () => g.toTitle() },
    ];
  }

  settingsItems() {
    const g = this.game;
    const s = g.settings;
    return [
      { label: 'GRAPHICS', type: 'option', get: () => s.quality.toUpperCase(), change: (d) => g.setQuality(QUALITY_LIST[(QUALITY_LIST.indexOf(s.quality) + d + 4) % 4]) },
      { label: 'MUSIC', type: 'option', get: () => bar(s.music), change: (d) => g.setVolume('music', s.music + d * 0.1) },
      { label: 'SOUND FX', type: 'option', get: () => bar(s.sfx), change: (d) => g.setVolume('sfx', s.sfx + d * 0.1) },
      { label: 'CAMERA', type: 'option', get: () => ['CHASE', 'FAR', 'HOOD'][s.camera], change: (d) => g.setCamera((s.camera + d + 3) % 3) },
      { label: 'SOUNDTRACK', type: 'option', get: () => (g.audio.trackCount && g.audio.musicSource === 'mine' ? `MY MUSIC (${g.audio.trackCount})` : 'GAME'), change: () => g.toggleMusicSource() },
      { label: 'ADD MY MUSIC…', action: () => g.pickMusic() },
      { label: g.yt && g.yt.active ? 'YOUTUBE · PLAYING' : 'YOUTUBE MUSIC…', action: () => g.openYouTube() },
      ...(g.audio.trackCount ? [
        { label: 'NEXT SONG', action: () => g.audio.nextTrack() },
        { label: 'FORGET MY MUSIC', action: () => { g.forgetMusic(); this.show('settings'); } },
      ] : []),
      { label: 'BACK', action: () => this.show(this.back || 'title') },
    ];
  }

  renderTitle() {
    this.renderList('title-menu', this.titleItems());
  }

  renderList(id, items) {
    const box = document.getElementById(id);
    this.items = items;
    this.listId = id;
    box.innerHTML = '';
    items.forEach((it, k) => {
      const b = document.createElement('div');
      b.className = 'item' + (k === this.sel ? ' sel' : '') + (it.type === 'option' ? ' opt' : '');
      b.innerHTML = it.type === 'option' ? `<span>${it.label}</span><span class="val"><i data-d="-1">◀</i> ${it.get()} <i data-d="1">▶</i></span>` : it.label;
      b.addEventListener('mouseenter', () => { if (this.sel !== k) { this.sel = k; this.refresh(); this.game.audio.play('ui_move'); } });
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.sel = k;
        const dEl = e.target.closest('i[data-d]');
        if (it.type === 'option') it.change(dEl ? +dEl.dataset.d : 1);
        else it.action();
        this.game.audio.play('ui_select');
        if (this.current && this.listId === id) this.refresh();
      });
      box.appendChild(b);
    });
  }

  refresh() {
    if (this.listId) this.renderList(this.listId, this.items);
  }

  renderSelect() {
    const g = this.game;
    const info = CAR_INFO[g.selectedCar];
    const rival = CAR_INFO[g.selectedCar === 'waymo' ? 'cybercab' : 'waymo'];
    this.screens.select.querySelectorAll('.cs-pill').forEach((b) => {
      const on = b.dataset.car === g.selectedCar;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.getElementById('start-btn').textContent = g.mode === 'free' ? 'START FREE RIDE ▶' : 'START ▶';
    const card = document.getElementById('car-card');
    card.style.setProperty('--c', info.color);
    card.innerHTML = `
      <div class="car-name">${info.name}</div>
      <div class="car-model">${info.model}</div>
      <div class="car-tag">“${info.tagline}”</div>
      ${g.settings.best && g.settings.best[g.selectedCar] ? `<div class="car-best">BEST FARES · $${g.settings.best[g.selectedCar].toFixed(2)}</div>` : ''}
      <div class="stats">${Object.entries(info.stats).map(([k, v]) => `<div class="stat"><span>${k}</span><div class="sbar"><div style="width:${v * 100}%"></div></div></div>`).join('')}</div>
      <div class="special"><b>SPECIAL · ${info.special}</b><p>${info.specialDesc}</p></div>
      ${g.mode === 'arcade' ? `<div class="rival">YOUR RIVAL: <b style="color:${rival.color}">${rival.name}</b> — beat its earnings before the clock runs out!</div>` : '<div class="rival">FREE RIDE: no clock, no rival. Just you and the hills.</div>'}
    `;
    const opts = document.getElementById('select-opts');
    const tod = TOD_LIST.find((t) => t[0] === g.settings.tod) || TOD_LIST[0];
    opts.innerHTML = `<div class="opt-row"><span>TIME OF DAY</span><span class="val"><i data-d="-1">◀</i> ${tod[1]} <i data-d="1">▶</i></span></div>`;
    opts.querySelectorAll('i[data-d]').forEach((i) => i.addEventListener('click', (e) => { e.stopPropagation(); g.cycleTod(+i.dataset.d); }));
  }

  showResults(r) {
    const body = document.getElementById('results-body');
    const won = r.rival ? r.money >= r.rivalMoney : true;
    body.innerHTML = `
      <div class="res-banner ${won ? 'win' : 'lose'}">${r.rival ? (won ? `${r.playerName} WINS!` : `${r.rivalName} WINS!`) : 'SHIFT OVER!'}</div>
      <div class="res-grid">
        <div class="res-card" style="--c:${r.playerColor}">
          <div class="res-who">YOU · ${r.playerName}</div>
          <div class="res-money">$${r.money.toFixed(2)}</div>
          <div class="res-line"><span>Deliveries</span><b>${r.deliveries}</b></div>
          <div class="res-line"><span>Failed fares</span><b>${r.fails}</b></div>
          <div class="res-line"><span>Crazy stunts</span><b>${r.stunts}</b></div>
          <div class="res-line"><span>Best combo</span><b>x${r.bestCombo}</b></div>
          <div class="res-line"><span>Longest jump</span><b>${r.bestAir.toFixed(1)} s</b></div>
          <div class="res-line"><span>Props destroyed</span><b>${r.smashed}</b></div>
        </div>
        ${r.rival ? `<div class="res-card" style="--c:${r.rivalColor}">
          <div class="res-who">RIVAL · ${r.rivalName}</div>
          <div class="res-money">$${r.rivalMoney.toFixed(2)}</div>
          <div class="res-line"><span>Deliveries</span><b>${r.rivalDeliveries}</b></div>
          <div class="res-line"><span>Fares stolen from you</span><b>${r.stolen}</b></div>
        </div>` : ''}
      </div>
      <div class="res-rank">CRAZY LICENSE <b>${r.rank}</b><span class="res-best">${r.record ? '★ NEW RECORD! ★' : `BEST $${r.best.toFixed(2)}`}</span></div>
      <div class="menu" id="results-menu"></div>
    `;
    for (const s of Object.values(this.screens)) s.classList.add('hidden');
    this.screens.results.classList.remove('hidden');
    this.current = 'results';
    this.sel = 0;
    const g = this.game;
    this.renderList('results-menu', [
      { label: 'PLAY AGAIN', action: () => g.restart() },
      { label: 'CHANGE ROBOTAXI', action: () => g.toSelect(g.mode) },
      { label: 'TITLE SCREEN', action: () => g.toTitle() },
    ]);
  }

  countdown(n) {
    const s = this.screens.countdown;
    s.classList.remove('hidden');
    const num = document.getElementById('countdown-num');
    num.textContent = n;
    num.classList.remove('pop');
    void num.offsetWidth;
    num.classList.add('pop');
    num.classList.toggle('go', n === 'GO!');
  }

  hideCountdown() { this.screens.countdown.classList.add('hidden'); }

  // keyboard / gamepad navigation
  handle(input) {
    const g = this.game;
    const up = input.hit('ArrowUp', 'KeyW'), down = input.hit('ArrowDown', 'KeyS');
    const left = input.hit('ArrowLeft', 'KeyA'), right = input.hit('ArrowRight', 'KeyD');
    const ok = input.hit('Enter', 'NumpadEnter', 'Space');
    const back = input.hit('Escape', 'Backspace');
    if (this.current === 'select') {
      if (left || right) { g.cycleCar(left ? -1 : 1); g.audio.play('ui_move'); }
      if (up || down) { g.cycleTod(up ? -1 : 1); g.audio.play('ui_move'); }
      if (ok) { g.audio.play('ui_select'); g.startRace(); }
      if (back) { g.audio.play('ui_back'); g.toTitle(); }
      return;
    }
    if (!this.items || !this.listId) return;
    if (up || down) {
      this.sel = (this.sel + (down ? 1 : -1) + this.items.length) % this.items.length;
      this.refresh();
      g.audio.play('ui_move');
    }
    const it = this.items[this.sel];
    if (it && it.type === 'option' && (left || right)) { it.change(left ? -1 : 1); this.refresh(); g.audio.play('ui_move'); }
    if (ok && it) {
      g.audio.play('ui_select');
      if (it.type === 'option') { it.change(1); this.refresh(); } else it.action();
    }
    if (back) {
      g.audio.play('ui_back');
      if (this.current === 'pause') g.resume();
      else if (this.current === 'settings') this.show(this.back || 'title');
    }
  }
}

function bar(v) {
  const n = Math.round(v * 10);
  return '▮'.repeat(n) + '▯'.repeat(10 - n);
}
