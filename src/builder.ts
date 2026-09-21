import './style.css';
import { MAX_GATES, STEP_MS, SESSION_KEY } from './config.ts';
import type { Circuit, Feedback, GateKind, Operation, Run } from './types.ts';
import { PUZZLES, GATES, getPuzzle, cloneCircuit } from './puzzles.ts';
import { circuitSignature, isValidCircuit, simulate, targetFeedback } from './quantum.ts';
import { circuitSvg, escapeHtml } from './render.ts';
import { createSync, nextRevision, readSnapshot } from './sync.ts';

interface Draft { circuit: Circuit; example: boolean; variant: number }
interface Progress { solved: boolean; signatures: string[]; compared: number[] }
interface Visitor { selected: string; drafts: Record<string, Draft>; progress: Record<string, Progress>; runId?: string; playbackActive?: boolean }

const app = document.querySelector<HTMLDivElement>('#app')!;
const freshVisitor = (): Visitor => ({ selected: '1', drafts: {}, progress: {} });
let visitor = loadVisitor();
let selectedGate: GateKind | null = null;
let selectedIndex: number | null = null;
let run: Run | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let editing = true;
let notice = '';
let displayWindow: Window | null = null;
const undo: Record<string, Draft[]> = {};
const expanded = new Set<string>();
let published = readSnapshot();
let revision = published?.revision ?? 0;
const sync = createSync(() => {}, () => { if (published) sync.publish(published); });

function loadVisitor(): Visitor {
  try {
    const value = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as Visitor | null;
    if (!value || !PUZZLES.some(p => p.id === value.selected) || !value.drafts || !value.progress) return freshVisitor();
    for (const draft of Object.values(value.drafts)) {
      if (!draft || !isValidCircuit(draft.circuit) || typeof draft.example !== 'boolean' || ![0, 1].includes(draft.variant)) return freshVisitor();
    }
    for (const progress of Object.values(value.progress)) {
      if (!progress || typeof progress.solved !== 'boolean' || !Array.isArray(progress.signatures) || !progress.signatures.every(s => typeof s === 'string') || !Array.isArray(progress.compared) || !progress.compared.every(v => v === 0 || v === 1)) return freshVisitor();
    }
    // Saved drafts must still obey their puzzle's fixed starting conditions.
    for (const puzzle of PUZZLES) {
      const saved = value.drafts[puzzle.id];
      if (!saved) continue;
      if (puzzle.kind === 'compare') saved.circuit = cloneCircuit(puzzle.examples[saved.variant].circuit);
      else if (puzzle.kind !== 'free' && JSON.stringify(saved.circuit.initial) !== JSON.stringify(puzzle.starter.initial)) delete value.drafts[puzzle.id];
    }
    return value;
  } catch { return freshVisitor(); }
}

function saveVisitor() {
  visitor.runId = run?.runId;
  visitor.playbackActive = !!run && !editing && run.status !== 'complete';
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(visitor)); } catch { /* Play still works if browser storage is unavailable. */ }
}

function draft(): Draft {
  return visitor.drafts[visitor.selected] ??= { circuit: cloneCircuit(getPuzzle(visitor.selected).starter), example: false, variant: 0 };
}

function progress(id = visitor.selected): Progress {
  return visitor.progress[id] ??= { solved: false, signatures: [], compared: [] };
}

function locked() { return !editing && run?.status !== 'complete'; }
function editable() { return !locked() && getPuzzle(visitor.selected).kind !== 'compare'; }
function disable(condition: boolean) { return condition ? 'disabled' : ''; }
function gateClass(gate: GateKind) { return `gate-${gate.toLowerCase()}`; }
function gateSymbol(gate: GateKind) { return gate === 'CNOT' ? '⊕' : gate; }

const logo = `<svg viewBox="0 0 40 40" aria-hidden="true"><ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(-40 20 20)"/><ellipse cx="20" cy="20" rx="16" ry="7" transform="rotate(40 20 20)"/><circle cx="20" cy="20" r="3"/></svg>`;
const arrow = '<span aria-hidden="true">↗</span>';

function render() {
  const focused = document.activeElement as HTMLElement | null;
  const focusAttributes = ['data-action', 'data-gate', 'data-place', 'data-target', 'data-index', 'data-puzzle', 'data-variant', 'data-qubits', 'data-example'];
  const focusSelector = focused && app.contains(focused) ? focusAttributes.filter(key => focused.hasAttribute(key)).map(key => `[${key}="${CSS.escape(focused.getAttribute(key)!)}"]`).join('') : '';
  const puzzle = getPuzzle(visitor.selected);
  const current = locked() && run ? { circuit: run.circuit, example: run.example, variant: run.variant } : draft();
  const circuit = current.circuit;
  const count = circuit.operations.length;
  const state = progress();
  const active = selectedIndex !== null ? circuit.operations[selectedIndex] : undefined;
  const runningThis = run?.puzzleId === puzzle.id;
  const changed = run && (run.puzzleId !== puzzle.id || JSON.stringify(run.circuit) !== JSON.stringify(circuit) || run.example !== current.example);
  const status = locked() ? (run?.status === 'playing' ? 'Your circuit is running on the display' : 'Paused · explore one step at a time') : changed ? 'Changes not launched' : 'Ready when you are';
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="./" aria-label="Quantum Playground home">${logo}<span>Quantum<span class="brand-light"> Playground</span></span></a>
      <span class="header-tag">SMALL CIRCUITS. BIG IDEAS.</span>
      <div class="header-actions"><button class="quiet-button" data-action="new" ${disable(!!locked())}>New visitor</button><button class="outline-button" data-action="display">Open display ${arrow}</button></div>
    </header>
    <div class="builder-layout">
      <aside class="sidebar" aria-label="Choose an experiment">
        <div class="sidebar-heading"><span class="eyebrow">YOUR EXPERIMENTS</span><span class="progress-count">${PUZZLES.filter(p => p.kind !== 'free' && progress(p.id).solved).length}/6</span></div>
        <nav class="puzzle-nav">${PUZZLES.map(p => `<button class="puzzle-link ${p.id === puzzle.id ? 'is-current' : ''} ${p.kind === 'free' ? 'free-link' : ''}" data-puzzle="${p.id}" ${p.id === puzzle.id ? 'aria-current="page"' : ''} ${disable(!!locked())}><span class="puzzle-number ${progress(p.id).solved ? 'is-solved' : ''}">${progress(p.id).solved ? '✓' : p.kind === 'free' ? '∞' : String(p.number).padStart(2, '0')}</span><span>${escapeHtml(p.shortTitle)}</span><span class="nav-arrow" aria-hidden="true">›</span></button>`).join('')}</nav>
        <div class="sidebar-note"><span class="little-orbit" aria-hidden="true">✳</span><p>A little curiosity goes a long way.</p><span>Build. Launch. Wonder.</span></div>
        <div class="sidebar-bottom"><span class="status-dot"></span> All experiments run right here.</div>
      </aside>
      <main class="workspace">
        <div class="workspace-heading"><div><div class="eyebrow"><span class="eyebrow-line"></span>${puzzle.kind === 'free' ? 'MAKE SOMETHING YOUR OWN' : `EXPERIMENT ${String(puzzle.number).padStart(2, '0')} / 06`}</div><h1>${escapeHtml(puzzle.title)}</h1><p class="puzzle-prompt">${escapeHtml(puzzle.prompt)}</p></div><span class="concept-pill">${escapeHtml(puzzle.concept)}</span></div>
        <div class="goal-strip"><span class="goal-icon" aria-hidden="true">◎</span><div><span class="small-label">${puzzle.kind === 'compare' ? 'THE QUESTION' : puzzle.kind === 'free' ? 'YOUR LAB' : 'YOUR MISSION'}</span><span class="goal-text">${escapeHtml(puzzle.goal)}</span></div>${puzzle.kind === 'two-ways' ? `<span class="ways-count">${Math.min(2, state.signatures.length)} / 2 ways</span>` : ''}</div>
        <section class="lab-panel" aria-label="Circuit builder">
          <div class="lab-toolbar"><div><span class="section-label">${puzzle.kind === 'compare' ? 'Choose an order' : 'Your gate collection'}</span><span class="toolbar-hint">${puzzle.kind === 'compare' ? 'Two circuits. One small change.' : 'Click to choose · drag to explore'}</span></div>${current.example ? '<span class="example-badge">EXAMPLE</span>' : `<span class="gate-count">${count} / ${MAX_GATES} gates</span>`}</div>
          ${puzzle.kind === 'compare' ? `<div class="comparison-options">${puzzle.examples.map((ex, i) => `<button data-variant="${i}" class="comparison-button ${current.variant === i ? 'is-active' : ''}" ${disable(!!locked())}><span class="small-label">CIRCUIT ${i === 0 ? 'A' : 'B'} ${state.compared.includes(i) ? '· COMPARED' : ''}</span>${escapeHtml(ex.label)}</button>`).join('')}</div>` : `<div class="gate-palette">${GATES.filter(g => circuit.initial.length === 2 || g.gate !== 'CNOT').map(g => `<button class="palette-gate ${gateClass(g.gate)} ${selectedGate === g.gate ? 'is-selected' : ''}" data-gate="${g.gate}" aria-label="${g.gate}: ${escapeHtml(g.description)}" aria-pressed="${selectedGate === g.gate}" title="${escapeHtml(g.description)}" ${disable(!!locked() || count >= MAX_GATES)}><span class="gate-letter">${g.gate === 'CNOT' ? '⊕' : g.gate}</span><span class="gate-name">${g.gate === 'CNOT' ? 'CNOT' : escapeHtml(g.name)}</span></button>`).join('')}<div class="palette-note"><span class="small-label">${selectedGate ? 'SELECTED GATE' : 'A RECIPE FOR A QUANTUM STATE'}</span><span>${selectedGate ? escapeHtml(GATES.find(g => g.gate === selectedGate)!.description) : 'Each gate changes what happens next.'}</span></div></div>`}
          ${puzzle.kind === 'free' ? `<div class="qubit-picker"><span>Start with</span><button data-qubits="1" class="${circuit.initial.length === 1 ? 'is-active' : ''}" ${disable(!!locked())}>1 qubit</button><button data-qubits="2" class="${circuit.initial.length === 2 ? 'is-active' : ''}" ${disable(!!locked())}>2 qubits</button></div>` : ''}
          <div class="circuit-stage ${selectedGate ? 'has-tool' : ''}" aria-label="Circuit, left to right">${editorMarkup(circuit)}</div>
          <div class="circuit-caption"><span>${puzzle.kind === 'compare' ? 'These circuits are ready to launch. Watch how their states differ.' : count >= MAX_GATES ? 'Eight gates is the limit. Move or remove a gate to keep exploring.' : selectedGate === 'CNOT' ? 'Place on the qubit to flip. The other wire becomes the control.' : count === 0 ? 'Your circuit starts here. Choose a gate, then click + on a wire.' : 'Time moves left to right. Click a gate to edit it.'}</span><span class="flow-label">TIME <span aria-hidden="true">→</span></span></div>
          <div class="selection-tools" aria-label="Selected gate controls">${active && editable() ? `<span class="selection-label"><span class="selected-chip ${gateClass(active.gate)}">${active.gate}</span> Step ${selectedIndex! + 1}</span><button data-action="left" ${disable(selectedIndex === 0)} aria-label="Move selected gate left">← Move</button><button data-action="right" ${disable(selectedIndex === count - 1)} aria-label="Move selected gate right">Move →</button>${circuit.initial.length === 2 ? `<button data-action="switch">${active.gate === 'CNOT' ? 'Reverse direction' : 'Switch wire'}</button>` : ''}<button class="delete-button" data-action="delete">Delete</button>` : `<span class="selection-placeholder">${puzzle.kind === 'compare' ? 'Same gates. Different order. What changes?' : 'No gate selected'}</span>`}</div>
          <div class="lab-footer"><div class="edit-actions"><button class="quiet-button" data-action="undo" ${disable(!editable() || !(undo[puzzle.id]?.length))}><span aria-hidden="true">↶</span> Undo</button><button class="quiet-button" data-action="reset" ${disable(!editable())}>Reset attempt</button></div><div class="launch-group"><span class="draft-status"><span class="status-dot ${changed ? 'is-pending' : ''}"></span>${status}</span><button class="launch-button" data-action="launch" ${disable(!!locked())}>Launch circuit <span aria-hidden="true">↗</span></button></div></div>
        </section>
        ${run ? playbackMarkup() : ''}
        <div class="feedback-slot" role="status" aria-live="polite">${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : runningThis && run && run.feedback ? `<p class="feedback feedback-${run.feedback.tone}"><span aria-hidden="true">${run.feedback.tone === 'success' ? '✦' : '◎'}</span>${escapeHtml(run.feedback.text)}</p>` : `<p class="resting-note"><span aria-hidden="true">↗</span> Your experiment comes to life on the display when you launch.</p>`}${puzzle.kind === 'two-ways' && state.signatures.length === 1 && !locked() ? '<button class="outline-button" data-action="another">Try another way →</button>' : ''}</div>
        <div class="help-grid">${helpMarkup('hint', 'A little nudge', 'Hint', `<p>${escapeHtml(puzzle.hint)}</p>`)}${helpMarkup('solution', 'See one way to do it', 'Show a solution', puzzle.examples.map((ex, i) => `<div class="example-card"><strong>${escapeHtml(ex.label)}</strong><p>${escapeHtml(ex.explanation)}</p>${circuitSvg(ex.circuit)}${puzzle.kind !== 'compare' ? `<button class="outline-button" data-example="${i}" ${disable(!!locked())}>Load example</button>` : ''}</div>`).join('') || '<p>There is no right answer here. Try a gate, then see what changes.</p>')}${helpMarkup('gates', 'Meet the building blocks', 'Gate guide', `<dl class="gate-guide">${GATES.map(g => `<div><dt class="${gateClass(g.gate)}">${g.gate}</dt><dd>${escapeHtml(g.description)}${g.gate === 'P' ? ' Also called S: a quarter-turn phase, not Z.' : ''}</dd></div>`).join('')}</dl><p class="help-footnote">Amplitudes include signs and phases. Squaring their size gives the chance of each outcome. Overall phase does not change a physical state.</p>`)}</div>
        <footer class="workspace-footer"><span>Made for curious minds.</span><span>1–2 qubits <span aria-hidden="true">·</span> Endless little discoveries</span></footer>
      </main>
    </div>`;
  if (focusSelector) app.querySelector<HTMLButtonElement>(focusSelector)?.focus({ preventScroll: true });
}

function helpMarkup(key: string, subtitle: string, title: string, content: string) {
  const id = `${visitor.selected}:${key}`;
  return `<details class="help-card" data-help="${id}" ${expanded.has(id) ? 'open' : ''}><summary><span><span class="help-title">${title}</span><span class="help-subtitle">${subtitle}</span></span><span class="help-plus" aria-hidden="true">+</span></summary><div class="help-content">${content}</div></details>`;
}

function editorMarkup(circuit: Circuit) {
  const n = circuit.initial.length;
  let html = `<div class="editor-track" style="--qubits:${n}"><div class="track-lines">${circuit.initial.map((_, q) => `<i style="top:${36 + q * 72}px"></i>`).join('')}</div><div class="wire-labels">${circuit.initial.map((initial, q) => `<div class="wire-label"><span>q${q}</span><strong>|${initial}⟩</strong></div>`).join('')}</div>`;
  for (let index = 0; index <= circuit.operations.length; index++) {
    html += `<div class="insertion-column" data-insertion="${index}">${circuit.initial.map((_, target) => `<button class="insertion" data-place="${index}" data-target="${target}" aria-label="Insert ${selectedGate ?? 'gate'} at step ${index + 1}, qubit ${target}" ${disable(!editable() || circuit.operations.length >= MAX_GATES)}><span aria-hidden="true">+</span></button>`).join('')}</div>`;
    const op = circuit.operations[index];
    if (!op) break;
    const applied = !editing && run?.puzzleId === visitor.selected && run.step - 1 === index;
    html += `<div class="gate-column ${gateClass(op.gate)} ${selectedIndex === index ? 'is-selected' : ''} ${applied ? 'is-applied' : ''}" data-column="${index}">${op.gate === 'CNOT' ? '<i class="control-link"></i>' : ''}${circuit.initial.map((_, q) => `<div class="gate-slot">${op.target === q || (op.gate === 'CNOT' && op.control === q) ? `<button class="circuit-gate ${op.gate === 'CNOT' && op.control === q ? 'control-gate' : ''}" data-index="${index}" aria-label="${op.gate}, step ${index + 1}, ${op.gate === 'CNOT' ? `control qubit ${op.control}, target qubit ${op.target}` : `qubit ${q}`}" ${disable(!editable())}>${op.gate === 'CNOT' && op.control === q ? '<span class="control-dot"></span>' : gateSymbol(op.gate)}</button>` : ''}</div>`).join('')}<span class="step-number">${index + 1}</span></div>`;
  }
  return html + '<div class="wire-end" aria-hidden="true">›</div></div>';
}

function playbackMarkup() {
  if (!run) return '';
  const isPlaying = run.status === 'playing';
  return `<section class="playback" aria-label="Last launched circuit playback"><div><span class="small-label">${editing ? 'LAST LAUNCH' : 'ON THE DISPLAY'}</span><span class="playback-name">${escapeHtml(run.title)}${run.example ? ' · Example' : ''}</span></div><span class="step-count">Step ${run.step} / ${run.circuit.operations.length}</span><div class="playback-buttons"><button data-action="previous" aria-label="Previous step" ${disable(run.step === 0)}>←</button><button data-action="play" ${disable(run.step === run.circuit.operations.length)}>${isPlaying ? 'Pause' : 'Resume'}</button><button data-action="next" aria-label="Next step" ${disable(run.step === run.circuit.operations.length)}>→</button><button data-action="replay">↺ Replay</button>${run.status === 'paused' && !editing ? '<button data-action="edit">Edit circuit</button>' : ''}</div></section>`;
}

function commit(circuit: Circuit, example = draft().example, variant = draft().variant) {
  if (!editable() || !isValidCircuit(circuit)) return;
  const history = undo[visitor.selected] ??= [];
  history.push(structuredClone(draft()));
  if (history.length > 20) history.shift();
  visitor.drafts[visitor.selected] = { circuit, example, variant };
  notice = '';
  saveVisitor();
  render();
}

// Clicks, keyboard buttons and pointer dragging all enter the same edit path.
function place(gate: GateKind, insertion: number, target: number, source?: number) {
  if (!editable()) return;
  const circuit = cloneCircuit(draft().circuit);
  if (target < 0 || target >= circuit.initial.length || (gate === 'CNOT' && circuit.initial.length !== 2)) return;
  if (source === undefined && circuit.operations.length >= MAX_GATES) return;
  let at = insertion;
  if (source !== undefined) {
    circuit.operations.splice(source, 1);
    if (source < at) at--;
  }
  const operation: Operation = gate === 'CNOT' ? { gate, target, control: 1 - target } : { gate, target };
  circuit.operations.splice(at, 0, operation);
  selectedIndex = at;
  commit(circuit);
}

function resetAttempt() {
  if (!editable()) return;
  const initial = getPuzzle(visitor.selected).kind === 'free' ? draft().circuit.initial : getPuzzle(visitor.selected).starter.initial;
  selectedIndex = null;
  commit({ initial: [...initial], operations: [] }, false, 0);
}

function publishRun() {
  if (!run) return;
  run.revision = revision = nextRevision(revision);
  // Only the revealed frame crosses to the monitor, never future frames or draft edits.
  const { frames: _frames, ...snapshot } = run;
  published = structuredClone(snapshot);
  sync.publish(published);
}

function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined; }
function schedule() {
  stopTimer();
  if (run?.status === 'playing') timer = setTimeout(() => advance(1, true), STEP_MS);
}

function evaluate(): Feedback {
  const puzzle = getPuzzle(run!.puzzleId);
  if (run!.example) return { tone: 'info', text: 'Example complete. Reset the attempt to try your own idea.' };
  if (puzzle.kind === 'free') return { tone: 'info', text: 'Experiment complete. What will you try next?' };
  const result = progress(puzzle.id);
  if (puzzle.kind === 'compare') {
    if (!result.compared.includes(run!.variant)) result.compared.push(run!.variant);
    result.solved = result.compared.length === 2;
    saveVisitor();
    return { tone: result.solved ? 'success' : 'info', text: result.solved ? 'Both compared! Same 50/50 chances, different phases: H then P points along +y; P then H points along +x.' : 'One order explored. Launch the other circuit and compare its state.' };
  }
  const feedback = targetFeedback(run!.state, puzzle.target!);
  if (feedback.tone === 'success') {
    if (puzzle.kind === 'two-ways') {
      // Two different recipes count, even if their unitaries are equivalent.
      const signature = circuitSignature(run!.circuit);
      const duplicate = result.signatures.includes(signature);
      if (!duplicate) result.signatures.push(signature);
      result.solved = result.signatures.length >= 2;
      feedback.text = result.solved ? 'Two ways found. Target reached!' : duplicate ? 'This way already works! Try a different gate sequence to find your second way.' : '1 of 2 ways found. Can you build a different circuit?';
    } else result.solved = true;
  }
  saveVisitor();
  return feedback;
}

function advance(delta: number, autoplay = false) {
  if (!run) return;
  stopTimer();
  visitor.selected = run.puzzleId;
  editing = false;
  const step = Math.max(0, Math.min(run.circuit.operations.length, run.step + delta));
  run.step = step;
  run.state = structuredClone(run.frames[step]);
  run.feedback = null;
  if (step === run.circuit.operations.length) {
    run.status = 'complete';
    run.feedback = evaluate();
    editing = true;
  } else run.status = autoplay ? 'playing' : 'paused';
  notice = '';
  saveVisitor();
  publishRun();
  render();
  schedule();
}

function launch() {
  if (locked()) return;
  stopTimer();
  const current = draft();
  const puzzle = getPuzzle(visitor.selected);
  const circuit = cloneCircuit(current.circuit);
  const frames = simulate(circuit);
  run = { version: 1, revision, runId: crypto.randomUUID(), puzzleId: puzzle.id, title: puzzle.title, goal: puzzle.goal, circuit, frames, state: frames[0], step: 0, status: 'playing', example: current.example, variant: current.variant, feedback: null };
  selectedIndex = null;
  notice = '';
  editing = false;
  if (!circuit.operations.length) { run.status = 'complete'; run.feedback = evaluate(); editing = true; }
  saveVisitor();
  publishRun();
  render();
  schedule();
}

function playbackAction(action: string) {
  if (!run) return;
  visitor.selected = run.puzzleId;
  if (action === 'previous' || action === 'next') { advance(action === 'previous' ? -1 : 1); return; }
  stopTimer();
  if (action === 'edit') { editing = true; run.status = 'paused'; }
  else if (action === 'play') { run.status = run.status === 'playing' ? 'paused' : 'playing'; editing = false; }
  else if (action === 'replay') {
    run.step = 0; run.state = structuredClone(run.frames[0]); run.feedback = null;
    run.status = run.circuit.operations.length ? 'playing' : 'complete';
    editing = run.status === 'complete';
    if (editing) run.feedback = evaluate();
  }
  notice = '';
  saveVisitor(); publishRun(); render(); schedule();
}

app.addEventListener('click', event => {
  if (suppressClick) { event.preventDefault(); return; }
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  const data = button.dataset;
  if (data.puzzle) {
    if (locked()) return;
    visitor.selected = data.puzzle; selectedIndex = null; selectedGate = null; notice = '';
    saveVisitor(); render(); return;
  }
  if (data.gate) { selectedGate = selectedGate === data.gate ? null : data.gate as GateKind; selectedIndex = null; notice = ''; render(); return; }
  if (data.place !== undefined) {
    if (selectedGate) place(selectedGate, Number(data.place), Number(data.target));
    else { notice = 'Choose a gate from the collection first.'; render(); }
    return;
  }
  if (data.index !== undefined) { selectedIndex = Number(data.index); render(); return; }
  if (data.variant !== undefined) {
    const variant = Number(data.variant);
    visitor.drafts[visitor.selected] = { circuit: cloneCircuit(getPuzzle(visitor.selected).examples[variant].circuit), example: false, variant };
    notice = ''; saveVisitor(); render(); return;
  }
  if (data.qubits) {
    selectedGate = null; selectedIndex = null;
    commit({ initial: Array(Number(data.qubits)).fill('0'), operations: [] }, false);
    return;
  }
  if (data.example !== undefined) {
    const example = getPuzzle(visitor.selected).examples[Number(data.example)];
    selectedIndex = null; commit(cloneCircuit(example.circuit), true); return;
  }
  const action = data.action;
  if (action === 'launch') { launch(); return; }
  if (action && ['play', 'previous', 'next', 'replay', 'edit'].includes(action)) { playbackAction(action); return; }
  if (action === 'display') {
    displayWindow = window.open(new URL('display.html', location.href), 'quantum-playground-display', 'popup,width=1280,height=720');
    notice = displayWindow ? 'Move the display window to the monitor, then use its fullscreen button.' : 'The browser blocked the window. Allow pop-ups, or open display.html in a second window.';
    render(); return;
  }
  if (action === 'new') {
    stopTimer(); visitor = freshVisitor(); run = null; editing = true; selectedGate = null; selectedIndex = null; notice = ''; expanded.clear();
    for (const key of Object.keys(undo)) delete undo[key];
    published = { version: 1, revision: revision = nextRevision(revision), welcome: true };
    sync.publish(published); saveVisitor(); render(); return;
  }
  if (action === 'reset' || action === 'another') { resetAttempt(); return; }
  if (action === 'undo') {
    const previous = undo[visitor.selected]?.pop();
    if (previous && editable()) { visitor.drafts[visitor.selected] = previous; selectedIndex = null; notice = ''; saveVisitor(); render(); }
    return;
  }
  if (selectedIndex === null || !editable()) return;
  const circuit = cloneCircuit(draft().circuit);
  const index = selectedIndex;
  if (action === 'delete') { circuit.operations.splice(index, 1); selectedIndex = null; }
  else if (action === 'left' || action === 'right') {
    const next = index + (action === 'left' ? -1 : 1);
    [circuit.operations[index], circuit.operations[next]] = [circuit.operations[next], circuit.operations[index]];
    selectedIndex = next;
  } else if (action === 'switch') {
    const op = circuit.operations[index];
    op.target = 1 - op.target;
    if (op.gate === 'CNOT') op.control = 1 - op.control;
  } else return;
  commit(circuit);
});

app.addEventListener('toggle', event => {
  const details = event.target as HTMLDetailsElement;
  const id = details.dataset.help;
  if (id) { if (details.open) expanded.add(id); else expanded.delete(id); }
}, true);

interface Drag { id: number; gate: GateKind; source?: number; x: number; y: number; active: boolean; ghost?: HTMLElement; destination?: { index: number; target: number } }
let drag: Drag | null = null;
let suppressClick = false;

app.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !editable()) return;
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-gate], [data-index]');
  if (!button || button.disabled) return;
  const source = button.dataset.index !== undefined ? Number(button.dataset.index) : undefined;
  const gate = source !== undefined ? draft().circuit.operations[source].gate : button.dataset.gate as GateKind;
  drag = { id: event.pointerId, gate, source, x: event.clientX, y: event.clientY, active: false };
});

document.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
  event.preventDefault();
  if (!drag.active) {
    drag.active = true;
    app.setPointerCapture(event.pointerId);
    drag.ghost = document.createElement('div');
    drag.ghost.className = `drag-ghost ${gateClass(drag.gate)}`;
    drag.ghost.textContent = gateSymbol(drag.gate);
    document.body.append(drag.ghost);
    app.classList.add('is-dragging');
  }
  drag.ghost!.style.transform = `translate(${event.clientX + 14}px, ${event.clientY + 14}px)`;
  clearDropPreview();
  drag.destination = undefined;
  const hit = document.elementFromPoint(event.clientX, event.clientY);
  const stage = hit?.closest<HTMLElement>('.editor-track');
  const column = hit?.closest<HTMLElement>('[data-insertion], [data-column]');
  if (!stage || !column) return;
  const rect = stage.getBoundingClientRect();
  const target = Math.floor((event.clientY - rect.top) / 72);
  if (target < 0 || target >= draft().circuit.initial.length) return;
  let index = Number(column.dataset.insertion);
  if (column.dataset.column !== undefined) {
    const bounds = column.getBoundingClientRect();
    index = Number(column.dataset.column) + (event.clientX > bounds.left + bounds.width / 2 ? 1 : 0);
  }
  drag.destination = { index, target };
  const slot = app.querySelector<HTMLElement>(`[data-insertion="${index}"]`)!;
  slot.classList.add('drop-target', gateClass(drag.gate));
  const preview = document.createElement('div');
  preview.className = 'drop-preview';
  preview.innerHTML = `${drag.gate === 'CNOT' ? '<i class="control-link"></i>' : ''}${draft().circuit.initial.map((_, q) => `<div class="preview-slot">${q === target ? `<span class="preview-gate">${gateSymbol(drag!.gate)}</span>` : drag!.gate === 'CNOT' ? '<span class="control-dot"></span>' : ''}</div>`).join('')}`;
  slot.append(preview);
}, { passive: false });

function clearDropPreview() {
  app.querySelectorAll('.drop-preview').forEach(node => node.remove());
  app.querySelectorAll('.drop-target').forEach(node => { node.classList.remove('drop-target', 'gate-h', 'gate-x', 'gate-y', 'gate-z', 'gate-p', 'gate-cnot'); });
}

function cancelDrag() {
  if (drag?.active) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 0); }
  drag?.ghost?.remove();
  if (drag && app.hasPointerCapture(drag.id)) app.releasePointerCapture(drag.id);
  drag = null; clearDropPreview(); app.classList.remove('is-dragging');
}

document.addEventListener('pointerup', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const finished = drag;
  cancelDrag();
  if (finished.active && finished.destination) place(finished.gate, finished.destination.index, finished.destination.target, finished.source);
});
document.addEventListener('pointercancel', cancelDrag);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { cancelDrag(); selectedGate = null; selectedIndex = null; render(); }
});

// A refreshed controller restores an interrupted run paused, never with a phantom timer.
if (published && !('welcome' in published) && visitor.runId === published.runId && PUZZLES.map(p => p.id).includes(published.puzzleId)) {
  const frames = simulate(published.circuit);
  run = { ...published, frames, state: frames[published.step], status: published.status === 'playing' ? 'paused' : published.status };
  editing = run.status === 'complete' || !visitor.playbackActive;
  if (!editing) visitor.selected = run.puzzleId;
  publishRun();
} else if (!published || !('welcome' in published)) {
  published = { version: 1, revision: revision = nextRevision(revision), welcome: true };
  sync.publish(published);
}
render();
