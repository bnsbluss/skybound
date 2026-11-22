import './styles.css';
import { Game } from './core/Game.js';

const bootFallback = document.getElementById('boot-fallback');

function fail(error) {
  console.error('[SKYBOUND] fatal:', error);
  if (bootFallback && bootFallback.isConnected) {
    bootFallback.classList.remove('ready');
    const title = bootFallback.querySelector('.boot-fallback-sub');
    if (title) title.textContent = `BOOT FAILURE // ${error?.message || 'UNKNOWN ERROR'}`;
    const spinner = bootFallback.querySelector('.boot-spinner');
    if (spinner) spinner.style.display = 'none';
  }
  const status = document.getElementById('boot-status');
  if (status) {
    const span = status.querySelector('span:last-child');
    if (span) span.textContent = `BOOT FAILURE // ${error?.message || 'UNKNOWN ERROR'}`;
  }
}

window.addEventListener('error', (event) => {
  if (!game || game.state === 'boot') fail(event.error || new Error(event.message));
});
window.addEventListener('unhandledrejection', (event) => {
  if (!game || game.state === 'boot') fail(event.reason || new Error('Unhandled rejection'));
});

let game = null;

try {
  game = new Game();
  window.skybound = game;
  game.boot().catch(fail);
} catch (error) {
  fail(error);
}
