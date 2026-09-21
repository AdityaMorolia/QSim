import './style.css';
import './display.css';
import type { PublishedSnapshot } from './types.ts';
import { blochVector } from './quantum.ts';
import { blochSvg, circuitSvg, escapeHtml, probabilityMarkup } from './render.ts';
import { createSync, readSnapshot } from './sync.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('display-page');
app.innerHTML = `<button class="fullscreen-control" type="button" aria-label="Enter fullscreen" title="Enter fullscreen">⛶ <span>Fullscreen</span></button><main id="display-content"></main>`;
const content = document.querySelector<HTMLElement>('#display-content')!;
const fullscreen = document.querySelector<HTMLButtonElement>('.fullscreen-control')!;
let revision = -1;

const brand = `<div class="display-brand"><span class="brand-orbit" aria-hidden="true">✳</span><span>Quantum Playground</span><span class="brand-divider">/</span><span class="display-edition">Live experiment</span></div>`;

function welcome(): void {
  content.className = 'welcome-screen';
  content.innerHTML = `${brand}<div class="welcome-body"><div class="welcome-copy"><div class="welcome-kicker"><span></span> Ready when you are</div><h1>Small gates.<br><span>Big possibilities.</span></h1><p>Build a circuit on the laptop,<br>then launch it here.</p><div class="welcome-footnote">A quantum playground for curious minds.</div></div>
    <svg class="welcome-art" viewBox="0 0 570 520" fill="none" aria-hidden="true"><circle cx="310" cy="245" r="186" fill="#edf2f8"/><circle cx="310" cy="245" r="146" stroke="#c1cfdf"/><ellipse cx="310" cy="245" rx="146" ry="51" stroke="#c1cfdf"/><ellipse cx="310" cy="245" rx="60" ry="146" stroke="#c1cfdf" transform="rotate(-28 310 245)"/><path d="M310 94V398M154 245H465" stroke="#c1cfdf" stroke-dasharray="4 6"/><path d="M310 245L381 145" stroke="#0c4f9b" stroke-width="4"/><circle cx="381" cy="145" r="9" fill="#0c4f9b" stroke="#fbfbfa" stroke-width="4"/><circle cx="310" cy="245" r="5" fill="#0c4f9b"/><text x="287" y="65" fill="#24354b" font-size="24">|0⟩</text><text x="291" y="432" fill="#24354b" font-size="24">|1⟩</text><rect x="28" y="292" width="219" height="92" rx="18" fill="#fbfbfa" stroke="#d8e1e9"/><path d="M48 338H222" stroke="#c1cfdf" stroke-width="2"/><rect x="73" y="314" width="48" height="48" rx="9" fill="#0c4f9b"/><text x="97" y="347" text-anchor="middle" fill="white" font-size="25">H</text><rect x="158" y="314" width="48" height="48" rx="9" fill="#8053ab"/><text x="182" y="347" text-anchor="middle" fill="white" font-size="25">P</text><circle cx="474" cy="353" r="9" fill="#d19b50"/><circle cx="191" cy="91" r="5" fill="#008b85"/></svg></div><div class="welcome-bottom"><span>Build. Launch. Wonder.</span><span>01 → 10 → ∞</span></div>`;
}

function render(snapshot: PublishedSnapshot): void {
  if (snapshot.revision <= revision) return;
  revision = snapshot.revision;
  if ('welcome' in snapshot) { welcome(); return; }
  const { circuit, state, step, status } = snapshot;
  const qubits = circuit.initial.length;
  // Reduced states can sit inside the sphere: entanglement must not become a fake pure state.
  const entangled = qubits === 2 && circuit.initial.some((_, index) => {
    const vector = blochVector(state, index);
    return Math.hypot(vector.x, vector.y, vector.z) < 1 - 1e-8;
  });
  const complete = step === circuit.operations.length;
  const feedback = complete ? snapshot.feedback : null;
  content.className = `experiment-screen qubits-${qubits}`;
  content.innerHTML = `${brand}
    <header class="experiment-heading"><div><h1>${escapeHtml(snapshot.title)}</h1><p>${escapeHtml(snapshot.goal)}</p></div><div class="run-meta">${snapshot.example ? '<span class="example-tag">Example</span>' : ''}<span class="step-counter">Step <strong>${step}</strong><span> / ${circuit.operations.length}</span></span><span class="playback-state"><span class="status-dot ${status}"></span>${status === 'playing' ? 'Running' : status === 'paused' ? 'Paused' : 'Complete'}</span></div></header>
    <section class="display-circuit" aria-label="Launched circuit">${circuitSvg(circuit, step)}</section>
    <div class="state-panels"><section class="measurement-panel"><div class="panel-heading"><span class="section-index">01</span><h2>If measured now</h2></div>${probabilityMarkup(state)}<p class="panel-caption">Exact chances. No measurement has been taken.</p></section>
    <section class="bloch-panel"><div class="panel-heading"><span class="section-index">02</span><h2>${qubits === 1 ? 'A view of the state' : 'Each qubit on its own'}</h2></div><div class="sphere-grid">${circuit.initial.map((_, index) => `<div class="sphere-cell"><div class="sphere-label">q${index}<span>${qubits === 1 ? 'Bloch sphere' : index === 0 ? 'Top wire' : 'Bottom wire'}</span></div>${blochSvg(state, index)}</div>`).join('')}</div><p class="panel-caption bloch-caption">${entangled ? 'Entangled: each qubit’s state lies inside its sphere.' : 'The direction reveals changes you can’t see in the chances.'}</p></section></div>
    <footer class="display-feedback ${feedback ? feedback.tone : 'neutral'}" aria-live="polite"><span class="feedback-dot" aria-hidden="true"></span><span class="feedback-message">${feedback ? escapeHtml(feedback.text) : complete ? 'Experiment complete. What will you try next?' : 'Follow the highlighted gate.'}</span><span class="state-note">${entangled ? 'Shared state · two connected qubits' : 'One gate at a time'}</span></footer>`;
}

welcome();
const saved = readSnapshot();
if (saved) render(saved);
let sync = createSync(render);
sync.request();
window.addEventListener('pagehide', () => sync.close());
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  // Back/forward cache restores the DOM, but pagehide closed its old channel.
  sync = createSync(render);
  const latest = readSnapshot();
  if (latest) render(latest);
  sync.request();
});

let hideTimer: ReturnType<typeof setTimeout>;
function revealFullscreen(): void {
  fullscreen.classList.add('is-visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => fullscreen.classList.remove('is-visible'), 2400);
}
document.addEventListener('pointermove', revealFullscreen);
document.addEventListener('keydown', revealFullscreen);
fullscreen.addEventListener('focus', revealFullscreen);
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    fullscreen.title = 'Use your browser’s fullscreen command';
  }
});
document.addEventListener('fullscreenchange', () => {
  const label = document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen';
  fullscreen.setAttribute('aria-label', label);
  fullscreen.title = label;
});
revealFullscreen();
