import './style.css';
import brandLogo from '../assets/NQCH LOGO_Singapore_gradient_reverse.png';
import { MAX_QUBITS, STEP_MS, SESSION_KEY } from './config.ts';
import type { Circuit, Feedback, GateKind, Operation, Run } from './types.ts';
import { PUZZLES, GATES, getPuzzle, cloneCircuit } from './puzzles.ts';
import { blochVector, circuitColumns, circuitSignature, controlWires, isValidCircuit, simulate, targetFeedback } from './quantum.ts';
import { blochSvg, circuitSvg, escapeHtml, probabilityMarkup } from './render.ts';
import { createSync, nextRevision, readSnapshot } from './sync.ts';

interface Draft { circuit: Circuit; example: boolean; variant: number }
interface Progress { solved: boolean; signatures: string[]; compared: number[] }
interface Visitor { selected: string; drafts: Record<string, Draft>; progress: Record<string, Progress>; runId?: string; playbackActive?: boolean }

const app = document.querySelector<HTMLDivElement>('#app')!;
const freshVisitor = (): Visitor => ({ selected: '1', drafts: {}, progress: {} });
let visitor = loadVisitor();
type Tool = GateKind | 'control';
let selectedGate: Tool | null = null;
let pendingControls: number[] = [];
let pendingInsertion = 0;
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
let published = readSnapshot();
let revision = published?.revision ?? 0;
const sync = createSync(() => {}, () => { if (published) sync.publish(published); }, () => {
  if (run?.status === 'playing') return;
  if (locked()) playbackAction('play');
  else launch();
}, resetSession);

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
function gateClass(gate: Tool) { return gate === 'control' ? 'control-tool' : `gate-${gate.toLowerCase()}`; }
function gateSymbol(gate: Tool) { return gate === 'control' ? '●' : gate === 'CNOT' ? '⊕' : gate; }

const arrow = '<span aria-hidden="true">↗</span>';

function render() {
  const circuitScroll = app.querySelector('.circuit-stage')?.scrollLeft ?? 0;
  const focused = document.activeElement as HTMLElement | null;
  const focusAttributes = ['data-action', 'data-gate', 'data-tool', 'data-place', 'data-target', 'data-index', 'data-puzzle', 'data-variant', 'data-qubits', 'data-example', 'data-control', 'data-help', 'data-close-help', 'data-slot'];
  const focusSelector = focused && app.contains(focused) ? focusAttributes.filter(key => focused.hasAttribute(key)).map(key => `[${key}="${CSS.escape(focused.getAttribute(key)!)}"]`).join('') : '';
  const puzzle = getPuzzle(visitor.selected);
  const current = locked() && run ? { circuit: run.circuit, example: run.example, variant: run.variant } : draft();
  const circuit = current.circuit;
  const count = circuit.operations.length;
  const state = progress();
  const columns = circuitColumns(circuit);
  const activeColumn = columns.findIndex(indices => selectedIndex !== null && indices.includes(selectedIndex));
  const active = selectedIndex !== null ? circuit.operations[selectedIndex] : undefined;
  const controls = active ? controlWires(active) : [];
  const runningThis = run?.puzzleId === puzzle.id;
  const changed = run && (run.puzzleId !== puzzle.id || JSON.stringify(run.circuit) !== JSON.stringify(circuit) || run.example !== current.example);
  const results = resultsMarkup(!!changed);
  const status = locked() ? (run?.status === 'playing' ? 'Your circuit is running on the display' : 'Paused · explore your circuit') : changed ? 'Changes not launched' : '';
  const complete = run && run.step === run.frames.length - 1;
  const feedback = complete ? run?.feedback : null;
  const message = notice || (run ? feedback?.text ?? (complete ? 'Experiment complete. What will you try next?' : 'Follow the highlighted gates.') : '');
  const anotherWay = puzzle.kind === 'two-ways' && state.signatures.length === 1 && !locked();
  app.innerHTML = `
    <header class="site-header">
      <a class="brand" href="./" aria-label="NQCH home"><img class="brand-logo" src="${brandLogo}" alt="National Quantum Computing Hub Singapore" width="800" height="289" /></a>
      <div class="header-actions"><button class="quiet-button" data-action="new" ${disable(!!locked())}>Reset</button><button class="outline-button" data-action="display">Open display ${arrow}</button></div>
    </header>
    <div class="builder-layout">
      <aside class="sidebar" aria-label="Choose an experiment">
        <div class="sidebar-heading"><span class="eyebrow">YOUR EXPERIMENTS</span><span class="progress-count">${PUZZLES.filter(p => p.kind !== 'free' && progress(p.id).solved).length}/6</span></div>
        <nav class="puzzle-nav">${PUZZLES.map(p => `<button class="puzzle-link ${p.id === puzzle.id ? 'is-current' : ''} ${p.kind === 'free' ? 'free-link' : ''}" data-puzzle="${p.id}" ${p.id === puzzle.id ? 'aria-current="page"' : ''} ${disable(!!locked())}><span class="puzzle-number ${progress(p.id).solved ? 'is-solved' : ''}">${progress(p.id).solved ? '✓' : p.kind === 'free' ? '∞' : String(p.number).padStart(2, '0')}</span><span>${escapeHtml(p.shortTitle)}</span><span class="nav-arrow" aria-hidden="true">›</span></button>`).join('')}</nav>
        <section class="sidebar-help" aria-labelledby="help-heading"><h2 id="help-heading" class="eyebrow">HELP</h2><div class="help-links">${(Object.keys(helpTopics) as HelpTopic[]).map(topic => helpLinkMarkup(topic)).join('')}</div></section>
        <div class="sidebar-note"><p>A little curiosity goes a long way.</p></div>
      </aside>
      <main class="workspace">
        <div class="editor-workspace">
        <section class="lab-panel" aria-label="Circuit builder">
          <div class="lab-toolbar"><div><span class="section-label">${puzzle.kind === 'compare' ? 'Choose an order' : 'Your gate collection'}</span><span class="toolbar-hint">${puzzle.kind === 'compare' ? 'Two circuits. One small change.' : 'Click to choose · drag to explore'}</span></div>${current.example ? '<span class="example-badge">EXAMPLE</span>' : `<span class="gate-count">${count} gate${count === 1 ? '' : 's'}</span>`}</div>
          <div class="gate-row"><div class="gate-choices">
          ${puzzle.kind === 'compare' ? `<div class="comparison-options">${puzzle.examples.map((ex, i) => `<button data-variant="${i}" class="comparison-button ${current.variant === i ? 'is-active' : ''}" ${disable(!!locked())}><span class="small-label">CIRCUIT ${i === 0 ? 'A' : 'B'} ${state.compared.includes(i) ? '· COMPARED' : ''}</span>${escapeHtml(ex.label)}</button>`).join('')}</div>` : `<div class="gate-palette"><button class="palette-gate control-tool ${selectedGate === 'control' ? 'is-selected' : ''}" data-tool="control" aria-label="Control: choose a control wire for the next gate" aria-pressed="${selectedGate === 'control'}" ${disable(!!locked() || circuit.initial.length < 2)}><span class="gate-letter">●</span><span class="gate-name">Control</span></button>${GATES.filter(g => circuit.initial.length > 1 || g.gate !== 'CNOT').map(g => `<button class="palette-gate ${gateClass(g.gate)} ${selectedGate === g.gate ? 'is-selected' : ''}" data-gate="${g.gate}" aria-label="${g.gate}: ${escapeHtml(g.description)}" aria-pressed="${selectedGate === g.gate}" title="${escapeHtml(g.description)}" ${disable(!!locked())}><span class="gate-letter">${g.gate === 'CNOT' ? '⊕' : g.gate}</span><span class="gate-name">${g.gate === 'CNOT' ? 'CNOT' : escapeHtml(g.name)}</span></button>`).join('')}</div>${selectedGate || pendingControls.length ? `<div class="palette-note" role="status"><span class="small-label">${selectedGate === 'control' || pendingControls.length ? 'CONTROLLED GATE' : 'SELECTED GATE'}</span><span>${selectedGate === 'control' ? `Click or drag onto a control wire.${circuit.initial.length > 2 ? ' Repeat Control to add a second wire.' : ' Then place a gate on the other wire.'}` : pendingControls.length ? `Control${pendingControls.length > 1 ? 's' : ''}: ${pendingControls.map(q => `q${q}`).join(', ')}. Choose a gate and place it on another wire.` : escapeHtml(GATES.find(g => g.gate === selectedGate)!.description)}</span>${pendingControls.length ? '<button class="quiet-button" data-action="cancel-controls">Cancel controls</button>' : ''}</div>` : ''}`}
          </div><button class="launch-button" data-action="launch" ${disable(!!locked())}>Run <span aria-hidden="true">↗</span></button></div>
          ${puzzle.kind === 'free' ? `<div class="qubit-picker"><span>Start with</span>${Array.from({ length: MAX_QUBITS }, (_, index) => index + 1).map(n => `<button data-qubits="${n}" class="${circuit.initial.length === n ? 'is-active' : ''}" aria-pressed="${circuit.initial.length === n}" ${disable(!!locked())}>${n} qubit${n > 1 ? 's' : ''}</button>`).join('')}</div>` : ''}
          <div class="circuit-stage ${selectedGate ? 'has-tool' : ''}" aria-label="Circuit, left to right">${editorMarkup(circuit)}</div>
        </section>
        ${results.bloch}
        </div>
        <div class="experiment-workspace">
        <aside class="experiment-controls" aria-label="Experiment controls">
        <div class="workspace-heading"><div><h1>${escapeHtml(puzzle.title)}</h1>${puzzle.prompt ? `<p class="puzzle-prompt">${escapeHtml(puzzle.prompt)}</p>` : ''}</div><span class="concept-pill">${escapeHtml(puzzle.concept)}</span></div>
        <div class="goal-strip"><span class="goal-icon" aria-hidden="true">◎</span><div><span class="small-label">${puzzle.kind === 'compare' ? 'THE QUESTION' : puzzle.kind === 'free' ? 'YOUR LAB' : 'YOUR MISSION'}</span><span class="goal-text">${escapeHtml(puzzle.goal)}</span></div>${puzzle.kind === 'two-ways' ? `<span class="ways-count">${Math.min(2, state.signatures.length)} / 2 ways</span>` : ''}</div>
          <div class="circuit-caption"><span>${puzzle.kind === 'compare' ? 'These circuits are ready to launch. Watch how their states differ.' : pendingControls.length ? 'Choose a gate and another wire. It will join the controls in their column.' : selectedGate === 'CNOT' ? (circuit.initial.length === 2 ? 'Place on the qubit to flip. The other wire becomes the control.' : 'Place on the qubit to flip, then choose its control wire below.') : count === 0 ? 'Your circuit starts here. Choose a gate, then click near a wire.' : 'Time moves left to right. Click a gate to edit it.'}</span><span class="flow-label">TIME <span aria-hidden="true">→</span></span></div>
          <div class="selection-tools" aria-label="Selected gate controls">${active && editable() ? `<span class="selection-label"><span class="selected-chip ${gateClass(active.gate)}">${active.gate}</span></span><button data-action="left" ${disable(activeColumn === 0)} aria-label="Move selected gate left">← Move</button><button data-action="right" ${disable(activeColumn === columns.length - 1)} aria-label="Move selected gate right">Move →</button>${circuit.initial.length > 1 && controls.length < 2 ? `<button data-action="switch">${controls.length ? 'Reverse direction' : 'Switch wire'}</button>` : ''}${controls.length === 1 && circuit.initial.length > 2 ? `<span class="control-label">Control:</span>${circuit.initial.map((_, q) => q === active.target ? '' : `<button class="control-choice" data-control="${q}" aria-pressed="${controls[0] === q}" aria-label="Use qubit ${q} as control">q${q}</button>`).join('')}` : ''}${controls.length ? '<button data-action="uncontrol">Remove controls</button>' : ''}<button class="delete-button" data-action="delete">Delete</button>` : `<span class="selection-placeholder">${puzzle.kind === 'compare' ? 'Same gates. Different order. What changes?' : 'No gate selected'}</span>`}</div>
          <div class="lab-footer"><div class="edit-actions"><button class="quiet-button" data-action="undo" ${disable(!editable() || !(undo[puzzle.id]?.length))}><span aria-hidden="true">↶</span> Undo</button><button class="quiet-button" data-action="reset" ${disable(!editable())}>Reset attempt</button><button class="quiet-button" data-action="replay" ${disable(!run)}><span aria-hidden="true">↺</span> Replay</button></div>${status ? `<div class="launch-group"><span class="draft-status"><span class="status-dot ${changed ? 'is-pending' : ''}"></span>${status}</span></div>` : ''}</div>
          ${locked() ? playbackMarkup() : ''}
        </aside>
        ${results.probabilities}
        </div>
        ${message || anotherWay ? `<footer class="display-feedback builder-feedback ${notice ? 'info' : feedback?.tone ?? 'neutral'}" role="status" aria-live="polite">${message ? `<span class="feedback-dot" aria-hidden="true"></span><span class="feedback-message">${escapeHtml(message)}</span>` : ''}${anotherWay ? '<button class="outline-button" data-action="another">Try another way →</button>' : ''}</footer>` : ''}
      </main>
    </div>`;
  if (activeHelp && activeHelp.puzzleId !== puzzle.id) closeHelp(false);
  app.querySelector('.experiment-controls')!.append(helpDialog);
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

function resultsMarkup(changed: boolean) {
  if (!run) return { bloch: '', probabilities: '<div class="builder-results"><p class="results-placeholder">Run a circuit to see results</p></div>' };
  // Follow the same revealed frame as the display, even while a new draft is edited.
  const { circuit, state, title } = run;
  const qubits = circuit.initial.length;
  const entangled = qubits > 1 && circuit.initial.some((_, index) => {
    const { x, y, z } = blochVector(state, index);
    return Math.hypot(x, y, z) < 1 - 1e-8;
  });
  const panel = (kind: string, body: string) => `<div class="builder-results qubits-${qubits}">${changed ? `<p class="results-context">Last run: ${escapeHtml(title)} · Run to update.</p>` : ''}<section class="results-panel ${kind}-panel">${body}</section></div>`;
  return {
    probabilities: panel('measurement', `<div class="panel-heading"><h2>If measured now</h2></div>${probabilityMarkup(state)}<p class="results-caption">Exact chances. No measurement has been taken.</p>`),
    bloch: panel('bloch', `<div class="panel-heading"><h2>${qubits === 1 ? 'A view of the state' : 'Each qubit on its own'}</h2></div><div class="sphere-grid">${circuit.initial.map((_, index) => `<div class="qubit-sphere"><div class="qubit-label">q${index}<span>${qubits === 1 ? 'Bloch sphere' : index === 0 ? 'Top wire' : index === qubits - 1 ? 'Bottom wire' : 'Middle wire'}</span></div>${blochSvg(state, index)}</div>`).join('')}</div><p class="results-caption">${entangled ? 'Shorter vectors indicate entanglement with other qubits.' : 'The direction reveals changes you can’t see in the chances.'}</p>`),
  };
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
    : `<dl class="gate-guide"><div><dt>Control</dt><dd>Choose one or two control wires, then place any gate on another wire. It acts when all controls are |1⟩.</dd></div>${GATES.map(g => `<div><dt class="${gateClass(g.gate)}">${g.gate}</dt><dd>${escapeHtml(g.description)}</dd></div>`).join('')}</dl><p class="help-footnote">Amplitudes include signs and phases. Squaring their size gives the chance of each outcome. Overall phase does not change a physical state.</p>`;
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
  event.stopPropagation();
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

function controlLink(controls: number[], target: number) {
  const first = Math.min(...controls, target), last = Math.max(...controls, target);
  return `<i class="control-link" style="top:${36 + first * 72}px;height:${(last - first) * 72}px"></i>`;
}

function editorMarkup(circuit: Circuit) {
  const n = circuit.initial.length;
  let html = `<div class="editor-track" style="--qubits:${n}"><div class="track-lines">${circuit.initial.map((_, q) => `<i style="top:${36 + q * 72}px"></i>`).join('')}</div><div class="wire-labels">${circuit.initial.map((initial, q) => `<div class="wire-label"><span>q${q}</span><strong>|${initial}⟩</strong></div>`).join('')}</div>`;
  const columns = circuitColumns(circuit);
  for (let column = 0; column <= columns.length; column++) {
    const indices = columns[column];
    const start = indices?.[0] ?? circuit.operations.length;
    html += `<div class="insertion-column" data-insertion="${start}">${start === pendingInsertion ? pendingControls.map(q => `<span class="pending-control" style="top:${36 + q * 72}px" aria-hidden="true"><span class="control-dot"></span></span>`).join('') : ''}${circuit.initial.map((_, target) => `<button class="insertion" data-slot="between" data-place="${start}" data-target="${target}" aria-label="Insert ${selectedGate ?? 'gate'} before column ${column + 1}, qubit ${target}" ${disable(!editable())}></button>`).join('')}</div>`;
    if (!indices) break;
    const end = indices.at(-1)! + 1;
    const controlled = indices.map(i => circuit.operations[i]).find(op => controlWires(op).length);
    const applied = !editing && run?.puzzleId === visitor.selected && run.step - 1 === column;
    html += `<div class="gate-column ${controlled ? gateClass(controlled.gate) : ''} ${applied ? 'is-applied' : ''}" data-column="${start}" data-end="${end}">${controlled ? controlLink(controlWires(controlled), controlled.target) : ''}`;
    html += circuit.initial.map((_, q) => {
      const index = indices.find(i => circuit.operations[i].target === q || controlWires(circuit.operations[i]).includes(q));
      if (index === undefined) return `<div class="gate-slot"><button class="insertion" data-slot="aligned" data-place="${end}" data-target="${q}" aria-label="Add ${selectedGate ?? 'gate'} in column ${column + 1}, qubit ${q}" ${disable(!editable())}></button></div>`;
      const op = circuit.operations[index];
      return `<div class="gate-slot ${gateClass(op.gate)} ${selectedIndex === index ? 'is-selected' : ''}"><button class="circuit-gate ${controlWires(op).includes(q) ? 'control-gate' : ''}" data-index="${index}" aria-label="${op.gate}, ${controlWires(op).length ? `control qubits ${controlWires(op).join(', ')}, target qubit ${op.target}` : `qubit ${q}`}" ${disable(!editable())}>${controlWires(op).includes(q) ? '<span class="control-dot"></span>' : gateSymbol(op.gate)}</button></div>`;
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
  pendingControls = [];
  if (selectedGate === 'control') selectedGate = null;
  visitor.drafts[visitor.selected] = { circuit, example, variant };
  notice = '';
  saveVisitor();
  render();
}

function placedOperation(gate: GateKind, target: number, source?: number): Operation {
  const previous = source === undefined ? undefined : draft().circuit.operations[source];
  let controls = previous ? controlWires(previous) : pendingControls;
  if (gate === 'CNOT' && !controls.length) controls = [target === 0 ? 1 : 0];
  // Moving onto a control swaps its wire with the old target, keeping every control.
  if (previous) controls = controls.map(q => q === target ? previous.target : q);
  if (gate === 'CNOT' && controls.length === 1) return { gate, target, control: controls[0] };
  const single = gate === 'CNOT' ? 'X' : gate;
  return controls.length ? { gate: single, target, controls: [...controls] } : { gate: single, target };
}

// Clicks and drops use the same forgiving wire/column snapping.
function placementAt(x: number, y: number, gate: Tool, source?: number) {
  if (!document.elementFromPoint(x, y)?.closest('.circuit-stage')) return null;
  const track = app.querySelector<HTMLElement>('.editor-track')!;
  const circuit = draft().circuit;
  const target = Math.max(0, Math.min(circuit.initial.length - 1, Math.round((y - track.getBoundingClientRect().top - 36) / 72)));
  const slots = [...track.querySelectorAll<HTMLElement>('[data-insertion], [data-column]')];
  if (x < slots[0].getBoundingClientRect().left) return null;
  const distance = (slot: HTMLElement) => { const rect = slot.getBoundingClientRect(); return Math.abs(x - rect.left - rect.width / 2); };
  let slot = slots.reduce((nearest, candidate) => distance(candidate) < distance(nearest) ? candidate : nearest);
  if (pendingControls.length && source === undefined) slot = track.querySelector<HTMLElement>(`[data-insertion="${pendingInsertion}"]`)!;
  let index = Number(slot.dataset.insertion ?? slot.dataset.column);
  if (gate !== 'control' && source === undefined && pendingControls.includes(target)) return null;
  if (gate !== 'control' && slot.dataset.column !== undefined) {
    const start = Number(slot.dataset.column), end = Number(slot.dataset.end);
    const op = placedOperation(gate, target, source);
    const mask = (operation: Operation) => (1 << operation.target) | controlWires(operation).reduce((bits, q) => bits | (1 << q), 0);
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
function place(gate: Tool, insertion: number, target: number, source?: number) {
  if (!editable()) return;
  const circuit = cloneCircuit(draft().circuit);
  if (target < 0 || target >= circuit.initial.length || (gate === 'CNOT' && circuit.initial.length < 2)) return;
  if (gate === 'control') {
    if (circuit.initial.length < 2) return;
    if (pendingControls.includes(target)) pendingControls = pendingControls.filter(q => q !== target);
    else if (pendingControls.length < circuit.initial.length - 1) {
      if (!pendingControls.length) pendingInsertion = insertion;
      pendingControls.push(target);
    }
    else { notice = 'Leave one wire for the gate.'; render(); return; }
    selectedGate = null; selectedIndex = null; notice = ''; render(); return;
  }
  if (source === undefined && pendingControls.includes(target)) {
    notice = 'Place the gate on a different wire from its controls.'; render(); return;
  }
  const operation = placedOperation(gate, target, source);
  let at = source === undefined && pendingControls.length ? pendingInsertion : insertion;
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

function resetSession() {
  closeHelp(false);
  cancelDrag();
  stopTimer();
  visitor = freshVisitor();
  run = null; editing = true; pendingControls = []; selectedGate = null; selectedIndex = null; notice = '';
  for (const key of Object.keys(undo)) delete undo[key];
  published = { version: 2, revision: revision = nextRevision(revision), welcome: true };
  sync.publish(published); saveVisitor(); render();
  app.querySelector('.circuit-stage')?.scrollTo(0, 0);
  app.querySelector('.puzzle-nav')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
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
  pendingControls = [];
  if (selectedGate === 'control') selectedGate = null;
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
  pendingControls = [];
  if (selectedGate === 'control') selectedGate = null;
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
  if (event.detail > 0 && editable() && (event.target as Element).closest('.circuit-stage') && (!button?.hasAttribute('data-index') || selectedGate === 'control')) {
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
    visitor.selected = data.puzzle; pendingControls = []; selectedIndex = null; selectedGate = null; notice = '';
    saveVisitor(); render(); return;
  }
  if (data.tool === 'control') { selectedGate = selectedGate === 'control' ? null : 'control'; selectedIndex = null; notice = ''; render(); return; }
  if (data.gate) { selectedGate = selectedGate === data.gate ? null : data.gate as GateKind; selectedIndex = null; notice = ''; render(); return; }
  if (data.place !== undefined) {
    if (selectedGate) place(selectedGate, Number(data.place), Number(data.target));
    else { notice = 'Choose a gate from the collection first.'; render(); }
    return;
  }
  if (data.index !== undefined) { pendingControls = []; selectedIndex = Number(data.index); render(); return; }
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
  if (action === 'cancel-controls') { pendingControls = []; if (selectedGate === 'control') selectedGate = null; notice = ''; render(); return; }
  if (action === 'launch') { launch(); return; }
  if (action && ['play', 'previous', 'next', 'replay', 'edit'].includes(action)) { playbackAction(action); return; }
  if (action === 'display') {
    displayWindow = window.open(new URL('display.html', location.href), 'quantum-playground-display', 'popup,width=1280,height=720');
    notice = displayWindow ? '' : 'The browser blocked the window. Allow pop-ups, or open display.html in a second window.';
    render(); return;
  }
  if (action === 'new') { resetSession(); return; }
  if (action === 'reset' || action === 'another') { resetAttempt(); return; }
  if (action === 'undo') {
    const previous = undo[visitor.selected]?.pop();
    if (previous && editable()) { pendingControls = []; visitor.drafts[visitor.selected] = previous; selectedIndex = null; notice = ''; saveVisitor(); render(); }
    return;
  }
  if (selectedIndex === null || !editable()) return;
  const circuit = cloneCircuit(draft().circuit);
  const index = selectedIndex;
  if (data.control !== undefined) {
    const op = circuit.operations[index];
    const control = Number(data.control);
    if (controlWires(op).length !== 1 || control === op.target) return;
    if (op.gate === 'CNOT') op.control = control;
    else op.controls = [control];
  } else if (action === 'uncontrol') {
    const op = circuit.operations[index];
    circuit.operations[index] = { gate: op.gate === 'CNOT' ? 'X' : op.gate, target: op.target };
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
    const controls = controlWires(op);
    if (controls.length) circuit.operations[index] = placedOperation(op.gate, controls[0], index);
    else op.target = (op.target + 1) % circuit.initial.length;
  } else return;
  commit(circuit);
});

interface Drag { id: number; gate: Tool; source?: number; x: number; y: number; active: boolean; ghost?: HTMLElement; destination?: { index: number; target: number } }
let drag: Drag | null = null;
let suppressClick = false;

app.addEventListener('pointerdown', event => {
  if (event.button !== 0 || !editable()) return;
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-gate], [data-tool], [data-index]');
  if (!button || button.disabled) return;
  const source = button.dataset.index !== undefined ? Number(button.dataset.index) : undefined;
  const gate = source !== undefined ? draft().circuit.operations[source].gate : (button.dataset.tool ?? button.dataset.gate) as Tool;
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
  const operation = drag.gate === 'control' ? null : placedOperation(drag.gate, target, drag.source);
  const controls = operation ? controlWires(operation) : [target];
  preview.innerHTML = `${operation && controls.length ? controlLink(controls, target) : ''}${draft().circuit.initial.map((_, q) => `<div class="preview-slot">${operation && q === target ? `<span class="preview-gate">${gateSymbol(operation.gate)}</span>` : controls.includes(q) ? '<span class="control-dot"></span>' : ''}</div>`).join('')}`;
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
  pendingControls = []; selectedGate = null; selectedIndex = null; render();
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
