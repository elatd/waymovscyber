// WAYMO vs CYBERTAXI — entry point
import { Game } from './game/Game.js';

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const el = document.createElement('pre');
  el.style.cssText = 'position:fixed;inset:20px;color:#ff6b6b;background:#111c;padding:20px;white-space:pre-wrap;z-index:99;font:13px monospace';
  el.textContent = 'Failed to start the game:\n' + (e && e.stack ? e.stack : e);
  document.body.appendChild(el);
});
