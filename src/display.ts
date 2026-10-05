import './shared.css';
import './display.css';
import brandLogo from '../assets/NQCH LOGO_Singapore_gradient_reverse.png';
import type { Circuit, PublishedSnapshot, SingleGate, State } from './types.ts';
import { applyGate, blochVector, circuitColumns, fidelity, initialState, probabilities } from './quantum.ts';
import { EPSILON } from './config.ts';
import { blochSvg, circuitSvg, escapeHtml, probabilityMarkup } from './render.ts';
import { createSync, nextRevision, readSnapshot } from './sync.ts';

const app = document.querySelector<HTMLDivElement>('#app')!;
document.body.classList.add('display-page');
app.innerHTML = `<main id="display-content"></main>`;
const content = document.querySelector<HTMLElement>('#display-content')!;
let revision = -1;
let demoTimer: ReturnType<typeof setTimeout> | undefined;
let demoSuppressed = false;

const brand = (running = false, meta = '') => `<div class="display-brand"><img class="brand-logo" src="${brandLogo}" alt="National Quantum Computing Hub Singapore" /><span class="brand-divider">/</span><span class="display-edition">Live experiment</span>${meta}<button class="display-run" data-run aria-disabled="${running}">Run</button></div>`;

function show(markup: string, className: string): void {
  const refocusRun = document.activeElement?.matches('[data-run]');
  content.className = className;
  content.innerHTML = markup;
  // Keep keyboard focus on Run as playback replaces the displayed frame.
  if (refocusRun) content.querySelector<HTMLButtonElement>('[data-run]')?.focus({ preventScroll: true });
}

function welcomeMarkup(): string {
  return `<div class="welcome-body"><div class="welcome-copy">
    <svg class="welcome-gates" viewBox="0 0 220 94" fill="none" role="img" aria-label="H then P circuit"><rect x=".5" y="1" width="219" height="92" rx="18" fill="#fbfbfa" stroke="var(--brand-border)"/><path d="M20 47H194" stroke="var(--brand-border)" stroke-width="2"/><rect x="45" y="23" width="48" height="48" rx="9" fill="var(--gate-h)"/><text x="69" y="56" text-anchor="middle" fill="white" font-size="25">H</text><rect x="130" y="23" width="48" height="48" rx="9" fill="var(--gate-p)"/><text x="154" y="56" text-anchor="middle" fill="white" font-size="25">P</text></svg></div>
    <svg class="welcome-art" viewBox="0 0 570 520" fill="none" aria-hidden="true"><defs><linearGradient id="welcome-brand-gradient" x1="124" y1="59" x2="496" y2="431" gradientUnits="userSpaceOnUse"><stop stop-color="var(--brand-turquoise)"/><stop offset="1" stop-color="var(--brand-blue)"/></linearGradient></defs><circle cx="310" cy="245" r="186" fill="url(#welcome-brand-gradient)" fill-opacity=".09"/><circle cx="310" cy="245" r="146" stroke="var(--brand-border)"/><ellipse cx="310" cy="245" rx="146" ry="51" stroke="var(--brand-border)"/><ellipse cx="310" cy="245" rx="60" ry="146" stroke="var(--brand-border)" transform="rotate(-28 310 245)"/><path d="M310 94V398M154 245H465" stroke="var(--brand-border)" stroke-dasharray="4 6"/><path d="M310 245L381 145" stroke="var(--brand-blue)" stroke-width="4"/><circle cx="381" cy="145" r="9" fill="var(--brand-blue)" stroke="#fbfbfa" stroke-width="4"/><circle cx="310" cy="245" r="5" fill="var(--brand-blue)"/><text x="287" y="65" fill="#24354b" font-size="24">|0⟩</text><text x="291" y="432" fill="#24354b" font-size="24">|1⟩</text><circle cx="474" cy="353" r="9" fill="var(--brand-turquoise)"/><circle cx="191" cy="91" r="5" fill="var(--brand-blue)"/></svg></div>`;
}

function stopDemo(): void {
  clearTimeout(demoTimer);
  demoTimer = undefined;
}

function defaultBody(demo: boolean): HTMLElement {
  // Keep the header and Run button mounted through frames and the first interaction.
  if (!content.querySelector('.default-body')) show(`${brand()}<div class="default-body"></div>`, 'welcome-screen');
  content.className = demo ? 'experiment-screen demo-screen qubits-1' : 'welcome-screen';
  content.querySelector('.display-edition')!.textContent = demo ? 'Demo' : 'Live experiment';
  return content.querySelector<HTMLElement>('.default-body')!;
}

function demoFrame(circuit: Circuit, state: State, message: string, outcome?: 0 | 1): void {
  const measured = outcome !== undefined;
  const sphereState = measured ? [{ re: 1 - outcome, im: 0 }, { re: outcome, im: 0 }] : state;
  defaultBody(true).innerHTML = `
    <section class="display-circuit" aria-label="Demo circuit">${circuitSvg(circuit, circuit.operations.length)}</section>
    <div class="state-panels"><section class="measurement-panel"><div class="panel-heading"><h2>${measured ? 'Chances before measurement' : 'If measured now'}</h2></div>${probabilityMarkup(state, measured ? 'Probabilities and amplitudes before measurement.' : undefined)}<p class="panel-caption">${measured ? 'These were the chances before this result.' : 'Exact chances. No measurement has been taken.'}</p></section>
    <section class="bloch-panel"><div class="panel-heading"><h2>${measured ? 'After measurement' : 'A view of the state'}</h2></div><div class="sphere-grid"><div class="sphere-cell"><div class="sphere-label">q0<span>Bloch sphere</span></div>${blochSvg(sphereState, 0)}</div></div><p class="panel-caption bloch-caption">${measured ? `The qubit is now |${outcome}⟩.` : 'Watch the state change with each gate.'}</p></section></div>
    <footer class="display-feedback demo-status"><span class="feedback-dot" aria-hidden="true"></span><span class="feedback-message">${message}</span></footer>`;
}

function startDemo(): void {
  stopDemo();
  const circuit: Circuit = { initial: ['0'], operations: [] };
  let state = initialState(circuit);
  let phase = 0;
  demoFrame(circuit, state, 'Starting at |0⟩');
  const tick = () => {
    if (phase < 4) {
      const gates: SingleGate[] = ['H', 'X', 'Y', 'Z', 'P'];
      const choices = gates.filter(gate => fidelity(state, applyGate(state, { gate, target: 0 })) < 1 - EPSILON);
      const gate = phase === 0 ? 'H' : choices[Math.floor(Math.random() * choices.length)];
      const operation = { gate, target: 0 };
      circuit.operations.push(operation);
      state = applyGate(state, operation);
      demoFrame(circuit, state, `Applying ${gate}`);
    } else if (phase === 4) {
      demoFrame(circuit, state, 'Ready to measure');
    } else if (phase === 5) {
      const [p0, p1] = probabilities(state);
      // Treat numerical zero as zero; otherwise sample the actual normalized chances.
      const outcome = p0 < EPSILON ? 1 : p1 < EPSILON ? 0 : Math.random() < p0 / (p0 + p1) ? 0 : 1;
      demoFrame(circuit, state, `Measured ${outcome}`, outcome);
    } else { startDemo(); return; }
    phase++;
    demoTimer = setTimeout(tick, phase <= 4 ? 1500 : phase === 5 ? 2000 : 3000);
  };
  demoTimer = setTimeout(tick, 1000);
}

function welcome(): void {
  if (!demoSuppressed) { if (demoTimer === undefined) startDemo(); }
  else defaultBody(false).innerHTML = welcomeMarkup();
}

function onActivity(): void {
  demoSuppressed = true;
  stopDemo();
  if (content.classList.contains('demo-screen')) welcome();
}

function render(snapshot: PublishedSnapshot): void {
  if (snapshot.revision <= revision) return;
  revision = snapshot.revision;
  if ('welcome' in snapshot) { welcome(); return; }
  stopDemo();
  const { circuit, state, step, status } = snapshot;
  const qubits = circuit.initial.length;
  // Reduced states can sit inside the sphere: entanglement must not become a fake pure state.
  const entangled = qubits > 1 && circuit.initial.some((_, index) => {
    const vector = blochVector(state, index);
    return Math.hypot(vector.x, vector.y, vector.z) < 1 - 1e-8;
  });
  const complete = step === circuitColumns(circuit).length;
  const feedback = complete ? snapshot.feedback : null;
  show(`${brand(status === 'playing', `<div class="run-meta">${snapshot.example ? '<span class="example-tag">Example</span>' : ''}<span class="playback-state"><span class="status-dot ${status}"></span>${status === 'playing' ? 'Running' : status === 'paused' ? 'Paused' : 'Complete'}</span></div>`)}
    <section class="display-circuit" aria-label="Launched circuit">${circuitSvg(circuit, step)}</section>
    <div class="state-panels"><section class="measurement-panel"><div class="panel-heading"><h2>If measured now</h2></div>${probabilityMarkup(state)}<p class="panel-caption">Exact chances. No measurement has been taken.</p></section>
    <section class="bloch-panel"><div class="panel-heading"><h2>${qubits === 1 ? 'A view of the state' : 'Each qubit on its own'}</h2></div><div class="sphere-grid">${circuit.initial.map((_, index) => `<div class="sphere-cell"><div class="sphere-label">q${index}<span>${qubits === 1 ? 'Bloch sphere' : index === 0 ? 'Top wire' : index === qubits - 1 ? 'Bottom wire' : 'Middle wire'}</span></div>${blochSvg(state, index)}</div>`).join('')}</div><p class="panel-caption bloch-caption">${entangled ? 'Shorter vectors indicate entanglement with other qubits.' : 'The direction reveals changes you can’t see in the chances.'}</p></section></div>
    <footer class="display-feedback ${feedback ? feedback.tone : 'neutral'}" aria-live="polite"><span class="feedback-dot" aria-hidden="true"></span><span class="feedback-message">${feedback ? escapeHtml(feedback.text) : complete ? 'Experiment complete. What will you try next?' : 'Follow the highlighted gates.'}</span>${entangled ? '<span class="state-note">Shared quantum state</span>' : ''}</footer>`, `experiment-screen qubits-${qubits}`);
  const track = content.querySelector<HTMLElement>('.display-circuit')!;
  const order = track.querySelector(`[data-order="${step}"]`);
  if (order) track.scrollLeft = Math.max(0, order.getBoundingClientRect().left - track.getBoundingClientRect().left - track.clientWidth / 2);
}

function resetDisplay() {
  demoSuppressed = false;
  const snapshot: PublishedSnapshot = { version: 2, revision: nextRevision(revision), welcome: true };
  render(snapshot);
  sync.publish(snapshot);
  window.scrollTo(0, 0);
}

let sync = createSync(render, undefined, undefined, resetDisplay, onActivity);
const saved = readSnapshot();
if (saved) render(saved);
else welcome();
sync.request();
content.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-run]');
  if (button?.getAttribute('aria-disabled') === 'false') sync.run();
});
window.addEventListener('pagehide', () => { stopDemo(); sync.close(); });
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  // Back/forward cache restores the DOM, but pagehide closed its old channel.
  sync = createSync(render, undefined, undefined, resetDisplay, onActivity);
  const latest = readSnapshot();
  if (latest) render(latest);
  if (content.querySelector('.default-body')) welcome();
  sync.request();
});
