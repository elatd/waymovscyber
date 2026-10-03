// DOM heads-up display: timer, fares, versus bar, fare panel, combo popups, passenger
// dialog, speedometer, boost & special meters, minimap, speed lines.
import { Minimap } from './Minimap.js';

const fmt$ = (v) => '$' + v.toFixed(2);

export class HUD {
  constructor(root) {
    this.root = root;
    const el = document.createElement('div');
    el.id = 'hud';
    el.className = 'hidden';
    el.innerHTML = `
      <div class="speedlines" id="speedlines"></div>
      <div class="hud-tl">
        <div class="money-label">FARES</div>
        <div class="money" id="hud-money">$0.00</div>
        <div class="vs">
          <div class="vs-names"><span id="vs-pname">WAYMO</span><span class="vs-mid">VS</span><span id="vs-rname">CYBERCAB</span></div>
          <div class="vs-bar"><div class="vs-p" id="vs-p"></div><div class="vs-r" id="vs-r"></div><div class="vs-tick"></div></div>
          <div class="vs-money"><span id="vs-pm">$0</span><span id="vs-rm">$0</span></div>
        </div>
      </div>
      <div class="hud-timer" id="hud-timer-wrap"><div class="timer-label">TIME</div><div class="timer" id="hud-timer">75</div></div>
      <div class="hud-tr" id="hud-fare">
        <div class="fare-head"><span class="fare-icon" id="fare-icon">📍</span><span class="fare-dest" id="fare-dest">—</span></div>
        <div class="fare-row"><span class="fare-dist" id="fare-dist">0 m</span><span class="fare-time" id="fare-time">0</span></div>
        <div class="fare-bar"><div id="fare-bar"></div></div>
        <div class="fare-tips" id="fare-tips">TIPS $0.00</div>
      </div>
      <div class="hud-hint" id="hud-hint"></div>
      <div class="hud-popups" id="hud-popups"></div>
      <div class="hud-center" id="hud-center"></div>
      <div class="hud-dialog" id="hud-dialog"></div>
      <div class="hud-bl">
        <canvas id="minimap" width="240" height="240"></canvas>
        <div class="street" id="hud-street">—</div>
      </div>
      <div class="hud-br">
        <div class="speedo"><span id="hud-speed">0</span><small>MPH</small></div>
        <div class="meter boost"><div class="fill" id="boost-fill"></div><label>BOOST <kbd>SHIFT</kbd></label></div>
        <div class="meter special" id="special-meter"><div class="fill" id="special-fill"></div><label id="special-label">SPECIAL <kbd>E</kbd></label></div>
      </div>
      <div class="hud-flash" id="hud-flash"></div>
    `;
    root.appendChild(el);
    this.el = el;
    const $ = (id) => el.querySelector('#' + id);
    this.$ = {
      money: $('hud-money'), timer: $('hud-timer'), timerWrap: $('hud-timer-wrap'),
      pname: $('vs-pname'), rname: $('vs-rname'), vsP: $('vs-p'), vsR: $('vs-r'), pm: $('vs-pm'), rm: $('vs-rm'),
      fare: $('hud-fare'), fareDest: $('fare-dest'), fareIcon: $('fare-icon'), fareDist: $('fare-dist'), fareTime: $('fare-time'), fareBar: $('fare-bar'), fareTips: $('fare-tips'),
      popups: $('hud-popups'), center: $('hud-center'), dialog: $('hud-dialog'), hint: $('hud-hint'),
      street: $('hud-street'), speed: $('hud-speed'), boost: $('boost-fill'), special: $('special-fill'), specialLabel: $('special-label'), specialMeter: $('special-meter'),
      speedlines: $('speedlines'), flash: $('hud-flash'),
    };
    this.minimap = new Minimap($('minimap'));
    this.dialogT = 0;
    this.centerT = 0;
    this.last = {};
    this.buildSpeedlines();
  }

  buildSpeedlines() {
    const sl = this.$.speedlines;
    for (let k = 0; k < 28; k++) {
      const d = document.createElement('i');
      const a = (k / 28) * 360 + Math.random() * 8;
      d.style.setProperty('--a', a + 'deg');
      d.style.setProperty('--d', (Math.random() * 0.6).toFixed(2) + 's');
      d.style.setProperty('--l', (30 + Math.random() * 40).toFixed(0) + 'vmax');
      sl.appendChild(d);
    }
  }

  show(v) { this.el.classList.toggle('hidden', !v); }

  setPlayers(pName, rName, pColor, rColor, specialName) {
    this.$.pname.textContent = pName;
    this.$.rname.textContent = rName || '';
    this.el.style.setProperty('--pcol', pColor);
    this.el.style.setProperty('--rcol', rColor);
    this.$.specialLabel.innerHTML = `${specialName} <kbd>E</kbd>`;
    this.el.classList.toggle('no-rival', !rName);
  }

  setText(node, key, text) {
    if (this.last[key] !== text) { node.textContent = text; this.last[key] = text; }
  }

  update(dt, s) {
    const $ = this.$;
    this.setText($.money, 'money', fmt$(s.money));
    if (s.timer !== null) {
      const t = Math.max(0, Math.ceil(s.timer));
      this.setText($.timer, 'timer', String(t));
      $.timerWrap.classList.toggle('low', s.timer <= 10);
      $.timerWrap.style.display = '';
    } else $.timerWrap.style.display = 'none';
    // versus bar
    const tot = Math.max(1, s.money + s.rivalMoney);
    const pf = s.money / tot;
    $.vsP.style.width = (pf * 100).toFixed(1) + '%';
    $.vsR.style.width = ((1 - pf) * 100).toFixed(1) + '%';
    this.setText($.pm, 'pm', '$' + Math.floor(s.money));
    this.setText($.rm, 'rm', '$' + Math.floor(s.rivalMoney));
    // fare panel
    if (s.fare) {
      $.fare.classList.add('on');
      this.setText($.fareDest, 'fdest', s.fare.dest.name);
      this.setText($.fareIcon, 'ficon', s.fare.dest.icon || '📍');
      this.setText($.fareDist, 'fdist', Math.round(s.fare.distLeft ?? s.fare.dist) + ' m');
      this.setText($.fareTime, 'ftime', String(Math.max(0, Math.ceil(s.fare.timeLeft))));
      const f = Math.max(0, s.fare.timeLeft / s.fare.timeMax);
      $.fareBar.style.width = (f * 100).toFixed(1) + '%';
      $.fareBar.style.background = f > 0.42 ? '#39ff88' : f > 0.15 ? '#ffd60a' : '#ff3b5c';
      this.setText($.fareTips, 'ftips', 'TIPS ' + fmt$(s.fare.tips));
      $.fare.classList.toggle('urgent', s.fare.timeLeft < 6);
    } else $.fare.classList.remove('on');
    this.setText($.street, 'street', s.street);
    this.setText($.speed, 'speed', String(Math.round(s.speed * 2.237)));
    $.boost.style.width = (s.boost * 100).toFixed(1) + '%';
    $.special.style.width = (s.special * 100).toFixed(1) + '%';
    $.specialMeter.classList.toggle('ready', s.special >= 1);
    $.specialMeter.classList.toggle('active', !!s.specialActive);
    // speed lines
    const sl = Math.max(0, Math.min(1, (s.speed - 30) / 20)) + (s.boosting ? 0.5 : 0);
    $.speedlines.style.opacity = Math.min(1, sl).toFixed(2);
    // dialog & center message timers
    if (this.dialogT > 0) { this.dialogT -= dt; if (this.dialogT <= 0) $.dialog.classList.remove('on'); }
    if (this.centerT > 0) { this.centerT -= dt; if (this.centerT <= 0) $.center.classList.remove('on'); }
    // minimap
    this.minimap.draw(s.player, { route: s.route, waiting: s.waiting, dest: s.fare ? s.fare.dest : null, rival: s.rival, rivalColor: s.rivalColor, playerColor: s.playerColor });
  }

  popup(title, sub = '', color = '#ffd60a', big = false) {
    const d = document.createElement('div');
    d.className = 'popup' + (big ? ' big' : '');
    d.style.setProperty('--c', color);
    d.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
    this.$.popups.appendChild(d);
    while (this.$.popups.children.length > 4) this.$.popups.firstChild.remove();
    setTimeout(() => d.remove(), 1700);
  }

  dialog(who, text, color = '#fff', dur = 3) {
    const $d = this.$.dialog;
    $d.innerHTML = `<b style="color:${color}">${who}</b> ${text}`;
    $d.classList.remove('on');
    void $d.offsetWidth;
    $d.classList.add('on');
    this.dialogT = dur;
  }

  center(text, dur = 1.6, cls = '') {
    const c = this.$.center;
    c.className = 'hud-center ' + cls;
    c.innerHTML = text;
    void c.offsetWidth;
    c.classList.add('on');
    this.centerT = dur;
  }

  hint(text) {
    this.$.hint.innerHTML = text || '';
    this.$.hint.classList.toggle('on', !!text);
  }

  flash(color = 'rgba(255,255,255,0.6)') {
    const f = this.$.flash;
    f.style.background = color;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
}
