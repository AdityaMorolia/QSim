import './style.css';
import { MAX_QUBITS, STEP_MS, SESSION_KEY } from './config.ts';
import type { Circuit, Feedback, GateKind, Operation, Run } from './types.ts';
import { PUZZLES, GATES, getPuzzle, cloneCircuit } from './puzzles.ts';
import { circuitColumns, circuitSignature, isValidCircuit, simulate, targetFeedback } from './quantum.ts';
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
const helpTopics = {
  hint: { title: 'Hint', subtitle: '' },
  solution: { title: 'Show a solution', subtitle: 'See one way to do it' },
  gates: { title: 'Gate guide', subtitle: 'Meet the building blocks' },
};
type HelpTopic = keyof typeof helpTopics;
let activeHelp: { topic: HelpTopic; puzzleId: string } | null = null;
// Keep help open while the builder rerenders during editing and playback.
const helpDialog = document.createElement('dialog');
helpDialog.id = 'help-dialog';
helpDialog.className = 'help-dialog';
helpDialog.setAttribute('aria-labelledby', 'help-dialog-title');
document.body.append(helpDialog);
let published = readSnapshot();
let revision = published?.revision ?? 0;
const sync = createSync(() => {}, () => { if (published) sync.publish(published); }, () => {
  if (run?.status === 'playing') return;
  if (locked()) playbackAction('play');
  else launch();
});

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
  const circuitScroll = app.querySelector('.circuit-stage')?.scrollLeft ?? 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusAttributes = ['data-action', 'data-gate', 'data-place', 'data-target', 'data-index', 'data-puzzle', 'data-variant', 'data-qubits', 'data-example', 'data-control', 'data-help', 'data-slot'];
  const focusSelector = focused && app.contains(focused) ? focusAttributes.filter(key => focused.hasAttribute(key)).map(key => `[${key}="${CSS.escape(focused.getAttribute(key)!)}"]`).join('') : '';
  const puzzle = getPuzzle(visitor.selected);
  const current = locked() && run ? { circuit: run.circuit, example: run.example, variant: run.variant } : draft();
  const circuit = current.circuit;
  const count = circuit.operations.length;
  const state = progress();
  const columns = circuitColumns(circuit);
  const activeColumn = columns.findIndex(indices => selectedIndex !== null && indices.includes(selectedIndex));
  const active = selectedIndex !== null ? circuit.operations[selectedIndex] : undefined;
  const runningThis = run?.puzzleId === puzzle.id;
  const changed = run && (run.puzzleId !== puzzle.id || JSON.stringify(run.circuit) !== JSON.stringify(circuit) || run.example !== current.example);
  const status = locked() ? (run?.status === 'playing' ? 'Your circuit is running on the display' : 'Paused · explore your circuit') : changed ? 'Changes not launched' : 'Ready when you are';
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="./" aria-label="Quantum Playground home">${logo}<span>Quantum<span class="brand-light"> Playground</span></span></a>
      <div class="header-actions"><button class="quiet-button" data-action="new" ${disable(!!locked())}>Reset</button><button class="outline-button" data-action="display">Open display ${arrow}</button></div>
    </header>
    <div class="builder-layout">
      <aside class="sidebar" aria-label="Choose an experiment">
        <div class="sidebar-heading"><span class="eyebrow">YOUR EXPERIMENTS</span><span class="progress-count">${PUZZLES.filter(p => p.kind !== 'free' && progress(p.id).solved).length}/6</span></div>
        <nav class="puzzle-nav">${PUZZLES.map(p => `<button class="puzzle-link ${p.id === puzzle.id ? 'is-current' : ''} ${p.kind === 'free' ? 'free-link' : ''}" data-puzzle="${p.id}" ${p.id === puzzle.id ? 'aria-current="page"' : ''} ${disable(!!locked())}><span class="puzzle-number ${progress(p.id).solved ? 'is-solved' : ''}">${progress(p.id).solved ? '✓' : p.kind === 'free' ? '∞' : String(p.number).padStart(2, '0')}</span><span>${escapeHtml(p.shortTitle)}</span><span class="nav-arrow" aria-hidden="true">›</span></button>`).join('')}</nav>
        <section class="sidebar-help" aria-labelledby="help-heading"><h2 id="help-heading" class="eyebrow">HELP</h2><div class="help-links">${(Object.keys(helpTopics) as HelpTopic[]).map(topic => helpLinkMarkup(topic)).join('')}</div></section>
        <div class="sidebar-note"><span class="little-orbit" aria-hidden="true">✳</span><p>A little curiosity goes a long way.</p></div>
      </aside>
      <main class="workspace">
        <div class="workspace-heading"><div><h1>${escapeHtml(puzzle.title)}</h1>${puzzle.prompt ? `<p class="puzzle-prompt">${escapeHtml(puzzle.prompt)}</p>` : ''}</div><span class="concept-pill">${escapeHtml(puzzle.concept)}</span></div>
        <div class="goal-strip"><span class="goal-icon" aria-hidden="true">◎</span><div><span class="small-label">${puzzle.kind === 'compare' ? 'THE QUESTION' : puzzle.kind === 'free' ? 'YOUR LAB' : 'YOUR MISSION'}</span><span class="goal-text">${escapeHtml(puzzle.goal)}</span></div>${puzzle.kind === 'two-ways' ? `<span class="ways-count">${Math.min(2, state.signatures.length)} / 2 ways</span>` : ''}</div>
        <section class="lab-panel" aria-label="Circuit builder">
          <div class="lab-toolbar"><div><span class="section-label">${puzzle.kind === 'compare' ? 'Choose an order' : 'Your gate collection'}</span><span class="toolbar-hint">${puzzle.kind === 'compare' ? 'Two circuits. One small change.' : 'Click to choose · drag to explore'}</span></div>${current.example ? '<span class="example-badge">EXAMPLE</span>' : `<span class="gate-count">${count} gate${count === 1 ? '' : 's'}</span>`}</div>
          ${puzzle.kind === 'compare' ? `<div class="comparison-options">${puzzle.examples.map((ex, i) => `<button data-variant="${i}" class="comparison-button ${current.variant === i ? 'is-active' : ''}" ${disable(!!locked())}><span class="small-label">CIRCUIT ${i === 0 ? 'A' : 'B'} ${state.compared.includes(i) ? '· COMPARED' : ''}</span>${escapeHtml(ex.label)}</button>`).join('')}</div>` : `<div class="gate-palette">${GATES.filter(g => circuit.initial.length > 1 || g.gate !== 'CNOT').map(g => `<button class="palette-gate ${gateClass(g.gate)} ${selectedGate === g.gate ? 'is-selected' : ''}" data-gate="${g.gate}" aria-label="${g.gate}: ${escapeHtml(g.description)}" aria-pressed="${selectedGate === g.gate}" title="${escapeHtml(g.description)}" ${disable(!!locked())}><span class="gate-letter">${g.gate === 'CNOT' ? '⊕' : g.gate}</span><span class="gate-name">${g.gate === 'CNOT' ? 'CNOT' : escapeHtml(g.name)}</span></button>`).join('')}</div>${selectedGate ? `<div class="palette-note" role="status"><span class="small-label">SELECTED GATE</span><span>${escapeHtml(GATES.find(g => g.gate === selectedGate)!.description)}</span></div>` : ''}`}
          ${puzzle.kind === 'free' ? `<div class="qubit-picker"><span>Start with</span>${Array.from({ length: MAX_QUBITS }, (_, index) => index + 1).map(n => `<button data-qubits="${n}" class="${circuit.initial.length === n ? 'is-active' : ''}" aria-pressed="${circuit.initial.length === n}" ${disable(!!locked())}>${n} qubit${n > 1 ? 's' : ''}</button>`).join('')}</div>` : ''}
          <div class="circuit-stage ${selectedGate ? 'has-tool' : ''}" aria-label="Circuit, left to right">${editorMarkup(circuit)}</div>
          <div class="circuit-caption"><span>${puzzle.kind === 'compare' ? 'These circuits are ready to launch. Watch how their states differ.' : selectedGate === 'CNOT' ? (circuit.initial.length === 2 ? 'Place on the qubit to flip. The other wire becomes the control.' : 'Place on the qubit to flip, then choose its control wire below.') : count === 0 ? 'Your circuit starts here. Choose a gate, then click near a wire.' : 'Time moves left to right. Click a gate to edit it.'}</span><span class="flow-label">TIME <span aria-hidden="true">→</span></span></div>
          <div class="selection-tools" aria-label="Selected gate controls">${active && editable() ? `<span class="selection-label"><span class="selected-chip ${gateClass(active.gate)}">${active.gate}</span></span><button data-action="left" ${disable(activeColumn === 0)} aria-label="Move selected gate left">← Move</button><button data-action="right" ${disable(activeColumn === columns.length - 1)} aria-label="Move selected gate right">Move →</button>${circuit.initial.length > 1 ? `<button data-action="switch">${active.gate === 'CNOT' ? 'Reverse direction' : 'Switch wire'}</button>` : ''}${active.gate === 'CNOT' && circuit.initial.length > 2 ? `<span class="control-label">Control:</span>${circuit.initial.map((_, q) => q === active.target ? '' : `<button class="control-choice" data-control="${q}" aria-pressed="${active.control === q}" aria-label="Use qubit ${q} as control">q${q}</button>`).join('')}` : ''}<button class="delete-button" data-action="delete">Delete</button>` : `<span class="selection-placeholder">${puzzle.kind === 'compare' ? 'Same gates. Different order. What changes?' : 'No gate selected'}</span>`}</div>
          <div class="lab-footer"><div class="edit-actions"><button class="quiet-button" data-action="undo" ${disable(!editable() || !(undo[puzzle.id]?.length))}><span aria-hidden="true">↶</span> Undo</button><button class="quiet-button" data-action="reset" ${disable(!editable())}>Reset attempt</button><button class="quiet-button" data-action="replay" ${disable(!run)}><span aria-hidden="true">↺</span> Replay</button></div><div class="launch-group"><span class="draft-status"><span class="status-dot ${changed ? 'is-pending' : ''}"></span>${status}</span><button class="launch-button" data-action="launch" ${disable(!!locked())}>Run <span aria-hidden="true">↗</span></button></div></div>
          ${locked() ? playbackMarkup() : ''}
        </section>
        <div class="feedback-slot" role="status" aria-live="polite">${notice ? `<p class="notice">${escapeHtml(notice)}</p>` : runningThis && run && run.feedback ? `<p class="feedback feedback-${run.feedback.tone}"><span aria-hidden="true">${run.feedback.tone === 'success' ? '✦' : '◎'}</span>${escapeHtml(run.feedback.text)}</p>` : ''}${puzzle.kind === 'two-ways' && state.signatures.length === 1 && !locked() ? '<button class="outline-button" data-action="another">Try another way →</button>' : ''}</div>
      </main>
    </div>`;
  if (activeHelp && activeHelp.puzzleId !== puzzle.id) closeHelp(false);
  helpDialog.querySelectorAll<HTMLButtonElement>('[data-example]').forEach(button => { button.disabled = !editable(); });
  if (focusSelector) app.querySelector<HTMLButtonElement>(focusSelector)?.focus({ preventScroll: true });
  const stage = app.querySelector<HTMLElement>('.circuit-stage')!;
  stage.scrollLeft = circuitScroll;
  const visibleIndex = !editing && runningThis && run ? columns[run.step - 1]?.[0] : selectedIndex;
  const gate = stage.querySelector(`[data-index="${visibleIndex}"]`)?.getBoundingClientRect();
  const bounds = stage.getBoundingClientRect();
  if (gate && gate.left < bounds.left) stage.scrollLeft -= bounds.left - gate.left + 16;
  if (gate && gate.right > bounds.right) stage.scrollLeft += gate.right - bounds.right + 16;
}

function helpLinkMarkup(topic: HelpTopic) {
  const open = helpDialog.open && activeHelp?.topic === topic && activeHelp.puzzleId === visitor.selected;
  return `<button class="puzzle-link ${open ? 'is-current' : ''}" data-help="${topic}" aria-expanded="${open}" aria-controls="help-dialog"><span class="puzzle-number" aria-hidden="true">?</span><span>${helpTopics[topic].title}</span><span class="nav-arrow" aria-hidden="true">›</span></button>`;
}

function openHelp(topic: HelpTopic) {
  if (helpDialog.open && activeHelp?.topic === topic) { closeHelp(); return; }
  const puzzle = getPuzzle(visitor.selected);
  const { title, subtitle } = helpTopics[topic];
  const content = topic === 'hint' ? `<p>${escapeHtml(puzzle.hint)}</p>`
    : topic === 'solution' ? puzzle.examples.map((ex, i) => `<div class="example-card"><strong>${escapeHtml(ex.label)}</strong><p>${escapeHtml(ex.explanation)}</p>${circuitSvg(ex.circuit)}${puzzle.kind !== 'compare' ? `<button class="outline-button" data-example="${i}" ${disable(!editable())}>Load example</button>` : ''}</div>`).join('') || '<p>There is no right answer here. Try a gate, then see what changes.</p>'
    : `<dl class="gate-guide">${GATES.map(g => `<div><dt class="${gateClass(g.gate)}">${g.gate}</dt><dd>${escapeHtml(g.description)}</dd></div>`).join('')}</dl><p class="help-footnote">Amplitudes include signs and phases. Squaring their size gives the chance of each outcome. Overall phase does not change a physical state.</p>`;
  activeHelp = { topic, puzzleId: puzzle.id };
  helpDialog.innerHTML = `<div class="help-dialog-header"><div><span class="eyebrow">${escapeHtml(puzzle.title)}</span><h2 id="help-dialog-title">${title}</h2>${subtitle ? `<p class="help-dialog-subtitle">${subtitle}</p>` : ''}</div><button class="help-dialog-close" data-close-help aria-label="Close ${title.toLowerCase()}" autofocus><span aria-hidden="true">×</span></button></div><div class="help-content">${content}</div>`;
  if (!helpDialog.open) helpDialog.show();
  render();
}

function closeHelp(restoreFocus = helpDialog.contains(document.activeElement)) {
  const topic = activeHelp?.topic;
  activeHelp = null;
  helpDialog.close();
  const trigger = app.querySelector<HTMLButtonElement>(`[data-help="${topic}"]`);
  trigger?.setAttribute('aria-expanded', 'false');
  trigger?.classList.remove('is-current');
  if (restoreFocus) trigger?.focus({ preventScroll: true });
}
helpDialog.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (button?.disabled) return;
  if (button?.hasAttribute('data-close-help')) { closeHelp(); return; }
  if (button?.dataset.example !== undefined && activeHelp?.puzzleId === visitor.selected && editable()) {
    const example = getPuzzle(visitor.selected).examples[Number(button.dataset.example)];
    selectedIndex = null;
    commit(cloneCircuit(example.circuit), true);
    return;
  }
});

function controlLink(control: number, target: number) {
  return `<i class="control-link" style="top:${36 + Math.min(control, target) * 72}px;height:${Math.abs(control - target) * 72}px"></i>`;
}

function editorMarkup(circuit: Circuit) {
  const n = circuit.initial.length;
  let html = `<div class="editor-track" style="--qubits:${n}"><div class="track-lines">${circuit.initial.map((_, q) => `<i style="top:${36 + q * 72}px"></i>`).join('')}</div><div class="wire-labels">${circuit.initial.map((initial, q) => `<div class="wire-label"><span>q${q}</span><strong>|${initial}⟩</strong></div>`).join('')}</div>`;
  const columns = circuitColumns(circuit);
  for (let column = 0; column <= columns.length; column++) {
    const indices = columns[column];
    const start = indices?.[0] ?? circuit.operations.length;
    html += `<div class="insertion-column" data-insertion="${start}">${circuit.initial.map((_, target) => `<button class="insertion" data-slot="between" data-place="${start}" data-target="${target}" aria-label="Insert ${selectedGate ?? 'gate'} before column ${column + 1}, qubit ${target}" ${disable(!editable())}></button>`).join('')}</div>`;
    if (!indices) break;
    const end = indices.at(-1)! + 1;
    const cnot = indices.map(i => circuit.operations[i]).find(op => op.gate === 'CNOT');
    const applied = !editing && run?.puzzleId === visitor.selected && run.step - 1 === column;
    html += `<div class="gate-column ${cnot ? 'gate-cnot' : ''} ${applied ? 'is-applied' : ''}" data-column="${start}" data-end="${end}">${cnot ? controlLink(cnot.control, cnot.target) : ''}`;
    html += circuit.initial.map((_, q) => {
      const index = indices.find(i => circuit.operations[i].target === q || (circuit.operations[i].gate === 'CNOT' && circuit.operations[i].control === q));
      if (index === undefined) return `<div class="gate-slot"><button class="insertion" data-slot="aligned" data-place="${end}" data-target="${q}" aria-label="Add ${selectedGate ?? 'gate'} in column ${column + 1}, qubit ${q}" ${disable(!editable())}></button></div>`;
      const op = circuit.operations[index];
      return `<div class="gate-slot ${gateClass(op.gate)} ${selectedIndex === index ? 'is-selected' : ''}"><button class="circuit-gate ${op.gate === 'CNOT' && op.control === q ? 'control-gate' : ''}" data-index="${index}" aria-label="${op.gate}, ${op.gate === 'CNOT' ? `control qubit ${op.control}, target qubit ${op.target}` : `qubit ${q}`}" ${disable(!editable())}>${op.gate === 'CNOT' && op.control === q ? '<span class="control-dot"></span>' : gateSymbol(op.gate)}</button></div>`;
    }).join('') + '</div>';
  }
  return html + '<div class="wire-end" aria-hidden="true">›</div></div>';
}

function playbackMarkup() {
  if (!run) return '';
  const isPlaying = run.status === 'playing';
  return `<div class="playback-controls" role="group" aria-label="Circuit playback"><div class="playback-buttons"><button data-action="previous" aria-label="Previous state" ${disable(run.step === 0)}>←</button><button data-action="play" ${disable(run.step === run.frames.length - 1)}>${isPlaying ? 'Pause' : 'Resume'}</button><button data-action="next" aria-label="Next state" ${disable(run.step === run.frames.length - 1)}>→</button>${run.status === 'paused' && !editing ? '<button data-action="edit">Edit circuit</button>' : ''}</div></div>`;
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

function placedOperation(gate: GateKind, target: number, source?: number): Operation {
  if (gate !== 'CNOT') return { gate, target };
  const previous = source === undefined ? undefined : draft().circuit.operations[source];
  // Keep a moved CNOT's control when possible; new gates use the first other wire.
  const control = previous?.gate === 'CNOT' && previous.control !== target ? previous.control : target === 0 ? 1 : 0;
  return { gate, target, control };
}

// Clicks and drops use the same forgiving wire/column snapping.
function placementAt(x: number, y: number, gate: GateKind, source?: number) {
  if (!document.elementFromPoint(x, y)?.closest('.circuit-stage')) return null;
  const track = app.querySelector<HTMLElement>('.editor-track')!;
  const circuit = draft().circuit;
  const target = Math.max(0, Math.min(circuit.initial.length - 1, Math.round((y - track.getBoundingClientRect().top - 36) / 72)));
  const slots = [...track.querySelectorAll<HTMLElement>('[data-insertion], [data-column]')];
  if (x < slots[0].getBoundingClientRect().left) return null;
  const distance = (slot: HTMLElement) => { const rect = slot.getBoundingClientRect(); return Math.abs(x - rect.left - rect.width / 2); };
  let slot = slots.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
  let index = Number(slot.dataset.insertion);
  if (slot.dataset.column !== undefined) {
    const start = Number(slot.dataset.column), end = Number(slot.dataset.end);
    const op = placedOperation(gate, target, source);
    const mask = (operation: Operation) => (1 << operation.target) | (operation.gate === 'CNOT' ? 1 << operation.control : 0);
    const conflict = circuit.operations.slice(start, end).some((other, offset) => start + offset !== source && (mask(op) & mask(other)) !== 0);
    if (!conflict) index = end;
    else {
      const rect = slot.getBoundingClientRect();
      index = x < rect.left + rect.width / 2 ? start : end;
      slot = track.querySelector<HTMLElement>(`[data-insertion="${index}"]`)!;
    }
  }
  return { index, target, slot };
}

// Clicks, keyboard buttons and pointer dragging all enter the same edit path.
function place(gate: GateKind, insertion: number, target: number, source?: number) {
  if (!editable()) return;
  const circuit = cloneCircuit(draft().circuit);
  if (target < 0 || target >= circuit.initial.length || (gate === 'CNOT' && circuit.initial.length < 2)) return;
  const operation = placedOperation(gate, target, source);
  let at = insertion;
  if (source !== undefined) {
    circuit.operations.splice(source, 1);
    if (source < at) at--;
  }
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
  const step = Math.max(0, Math.min(run.frames.length - 1, run.step + delta));
  run.step = step;
  run.state = structuredClone(run.frames[step]);
  run.feedback = null;
  if (step === run.frames.length - 1) {
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
  run = { version: 2, revision, runId: crypto.randomUUID(), puzzleId: puzzle.id, title: puzzle.title, goal: puzzle.goal, circuit, frames, state: frames[0], step: 0, status: 'playing', example: current.example, variant: current.variant, feedback: null };
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
  if (event.detail > 0 && editable() && (event.target as Element).closest('.circuit-stage') && !button?.hasAttribute('data-index')) {
    if (selectedGate) {
      const destination = placementAt(event.clientX, event.clientY, selectedGate);
      if (destination) place(selectedGate, destination.index, destination.target);
    } else { notice = 'Choose a gate from the collection first.'; render(); }
    return;
  }
  if (!button || button.disabled) return;
  const data = button.dataset;
  if (data.help && data.help in helpTopics) { openHelp(data.help as HelpTopic); return; }
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
  const action = data.action;
  if (action === 'launch') { launch(); return; }
  if (action && ['play', 'previous', 'next', 'replay', 'edit'].includes(action)) { playbackAction(action); return; }
  if (action === 'display') {
    displayWindow = window.open(new URL('display.html', location.href), 'quantum-playground-display', 'popup,width=1280,height=720');
    notice = displayWindow ? 'Move the display window to the monitor. Use your browser’s fullscreen command to hide its toolbar.' : 'The browser blocked the window. Allow pop-ups, or open display.html in a second window.';
    render(); return;
  }
  if (action === 'new') {
    closeHelp(false);
    stopTimer(); visitor = freshVisitor(); run = null; editing = true; selectedGate = null; selectedIndex = null; notice = '';
    for (const key of Object.keys(undo)) delete undo[key];
    published = { version: 2, revision: revision = nextRevision(revision), welcome: true };
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
  if (data.control !== undefined) {
    const op = circuit.operations[index];
    const control = Number(data.control);
    if (op.gate !== 'CNOT' || control === op.target) return;
    op.control = control;
  } else if (action === 'delete') { circuit.operations.splice(index, 1); selectedIndex = null; }
  else if (action === 'left' || action === 'right') {
    const columns = circuitColumns(circuit);
    const column = columns.findIndex(indices => indices.includes(index));
    const adjacent = columns[column + (action === 'left' ? -1 : 1)];
    if (!adjacent) return;
    const insertion = action === 'left' ? adjacent[0] : adjacent.at(-1)! + 1;
    place(circuit.operations[index].gate, insertion, circuit.operations[index].target, index);
    return;
  } else if (action === 'switch') {
    const op = circuit.operations[index];
    if (op.gate === 'CNOT') [op.target, op.control] = [op.control, op.target];
    else op.target = (op.target + 1) % circuit.initial.length;
  } else return;
  commit(circuit);
});

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
  const destination = placementAt(event.clientX, event.clientY, drag.gate, drag.source);
  if (!destination) return;
  const { index, target, slot } = destination;
  drag.destination = { index, target };
  slot.classList.add('drop-target');
  const preview = document.createElement('div');
  preview.className = `drop-preview ${gateClass(drag.gate)}`;
  const operation = placedOperation(drag.gate, target, drag.source);
  preview.innerHTML = `${operation.gate === 'CNOT' ? controlLink(operation.control, target) : ''}${draft().circuit.initial.map((_, q) => `<div class="preview-slot">${q === target ? `<span class="preview-gate">${gateSymbol(operation.gate)}</span>` : operation.gate === 'CNOT' && q === operation.control ? '<span class="control-dot"></span>' : ''}</div>`).join('')}`;
  slot.append(preview);
}, { passive: false });

function clearDropPreview() {
  app.querySelectorAll('.drop-preview').forEach(node => node.remove());
  app.querySelectorAll('.drop-target').forEach(node => { node.classList.remove('drop-target'); });
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
  if (event.key !== 'Escape') return;
  cancelDrag();
  if (helpDialog.open) { closeHelp(); return; }
  selectedGate = null; selectedIndex = null; render();
});

// A refreshed controller restores an interrupted run paused, never with a phantom timer.
if (published && !('welcome' in published) && visitor.runId === published.runId && PUZZLES.map(p => p.id).includes(published.puzzleId)) {
  const frames = simulate(published.circuit);
  run = { ...published, frames, state: frames[published.step], status: published.status === 'playing' ? 'paused' : published.status };
  editing = run.status === 'complete' || !visitor.playbackActive;
  if (!editing) visitor.selected = run.puzzleId;
  publishRun();
} else if (!published || !('welcome' in published)) {
  published = { version: 2, revision: revision = nextRevision(revision), welcome: true };
  sync.publish(published);
}
render();
