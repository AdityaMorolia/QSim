import type { Circuit, State } from './types.ts';
import { blochVector, canonicalState, formatAmplitude, probabilities } from './quantum.ts';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

const gateColors: Record<string, string> = {
  H: 'var(--gate-h, #0c4f9b)', X: 'var(--gate-x, #c34b3e)', Y: 'var(--gate-y, #c34b3e)',
  Z: 'var(--gate-z, #8053ab)', P: 'var(--gate-p, #8053ab)', CNOT: 'var(--gate-cnot, #008b85)',
};

/** One column is one operation; q0 is always the top wire and the leftmost bit. */
export function circuitSvg(circuit: Circuit, step = -1): string {
  const count = circuit.operations.length;
  const qubits = circuit.initial.length;
  const width = Math.max(650, 190 + count * 96);
  // Three wires use smaller gaps so gates remain readable on a 720p display.
  const wireStart = qubits === 3 ? 52 : 66;
  const wireSpacing = qubits === 3 ? 58 : 68;
  const height = qubits === 1 ? 106 : wireStart + (qubits - 1) * wireSpacing + 38;
  const wireY = (qubit: number) => wireStart + qubit * wireSpacing;
  const gateX = (index: number) => 155 + index * 96;
  const last = step - 1;
  const highlight = last >= 0 && last < count
    ? `<rect x="${gateX(last) - 35}" y="${wireStart - 48}" width="70" height="${height - wireStart + 42}" rx="12" fill="#e8eff8" />` : '';
  const wires = circuit.initial.map((initial, qubit) => `<g>
    <text x="12" y="${wireY(qubit) + 6}" fill="#6e7477" font-size="15">q${qubit}</text>
    <text x="54" y="${wireY(qubit) + 7}" fill="#24354b" font-size="23">|${initial}⟩</text>
    <line x1="105" y1="${wireY(qubit)}" x2="${width - 20}" y2="${wireY(qubit)}" stroke="#cbd3dc" stroke-width="2" />
  </g>`).join('');
  const gates = circuit.operations.map((operation, index) => {
    const x = gateX(index);
    const y = wireY(operation.target);
    const color = gateColors[operation.gate];
    const pending = step >= 0 && index >= step;
    const label = operation.gate === 'CNOT' ? `CNOT, q${operation.control} controls q${operation.target}` : `${operation.gate} on q${operation.target}`;
    const symbol = operation.gate === 'CNOT'
      ? `<line x1="${x}" y1="${wireY(operation.control)}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="3" />
         <circle cx="${x}" cy="${wireY(operation.control)}" r="7" fill="${color}" />
         <circle cx="${x}" cy="${y}" r="20" fill="#fbfbfa" stroke="${color}" stroke-width="3" />
         <path d="M ${x - 12} ${y} H ${x + 12} M ${x} ${y - 12} V ${y + 12}" stroke="${color}" stroke-width="3" />`
      : `<rect x="${x - 24}" y="${y - 24}" width="48" height="48" rx="9" fill="${pending ? '#fbfbfa' : color}" stroke="${color}" stroke-width="1.5" />
         <text x="${x}" y="${y + 8}" text-anchor="middle" font-size="25" font-weight="600" fill="${pending ? color : 'white'}">${operation.gate}</text>`;
    return `<g><title>${label}</title><text x="${x}" y="${wireStart - 37}" text-anchor="middle" fill="#6e7477" font-size="12">${index + 1}</text>${symbol}</g>`;
  }).join('');
  const empty = count === 0 ? `<text x="${width / 2 + 35}" y="${wireY(0) - 15}" text-anchor="middle" fill="#7b858c" font-size="16">Initial state · no gates yet</text>` : '';
  const description = circuit.operations.map(operation => operation.gate === 'CNOT' ? `CNOT from q${operation.control} to q${operation.target}` : `${operation.gate} on q${operation.target}`).join(', then ');
  return `<svg class="circuit-diagram" viewBox="0 0 ${width} ${height}" role="img" aria-label="${circuit.initial.length}-qubit circuit with ${count} gates${step >= 0 ? `, ${step} applied` : ''}${description ? `. ${description}.` : ''}" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;font-family:inherit">${highlight}${wires}${gates}${empty}</svg>`;
}

/** Fixed orthographic camera; never normalize a reduced state to the sphere's surface. */
export function blochSvg(state: State, qubit: number): string {
  const { x, y, z } = blochVector(state, qubit);
  const cx = 150, cy = 139, radius = 93;
  const project = (a: number, b: number, c: number): [number, number] => [
    cx + radius * (-Math.SQRT1_2 * a + Math.SQRT1_2 * b),
    cy + radius * (0.2418447626 * a + 0.2418447626 * b - 0.9396926208 * c),
  ];
  const point = project(x, y, z);
  const length = Math.hypot(x, y, z);
  const mixed = state.length > 2 && length < 1 - 1e-8;
  const fixed = (value: number) => Math.abs(value) < 0.0005 ? '0' : value.toFixed(2).replace(/\.00$/, '');
  const axis = (a: number, b: number, c: number, label: string) => {
    const end = project(a * 1.18, b * 1.18, c * 1.18);
    const start = project(-a, -b, -c);
    return `<line x1="${start[0]}" y1="${start[1]}" x2="${end[0]}" y2="${end[1]}" stroke="#b6c1ca" stroke-width="1.2" stroke-dasharray="3 4" />
      <text x="${end[0] + (a ? -12 : b ? 12 : 14)}" y="${end[1] + (a || b ? 7 : 3)}" text-anchor="middle" fill="#65768a" font-size="15">${label}</text>`;
  };
  const vector = length < 1e-8
    ? `<circle cx="${cx}" cy="${cy}" r="7" fill="#0c4f9b" /><circle cx="${cx}" cy="${cy}" r="13" fill="none" stroke="#0c4f9b" stroke-opacity=".16" stroke-width="6" />`
    : `<line x1="${cx}" y1="${cy}" x2="${point[0]}" y2="${point[1]}" stroke="#0c4f9b" stroke-width="3.5" stroke-linecap="round" />
       <circle cx="${point[0]}" cy="${point[1]}" r="6" fill="#0c4f9b" stroke="white" stroke-width="2" />`;
  return `<svg class="bloch-sphere" viewBox="${state.length === 8 ? '30 0 240 285' : '0 0 300 285'}" role="img" aria-label="Qubit ${qubit} Bloch vector: x ${fixed(x)}, y ${fixed(y)}, z ${fixed(z)}${length < 1e-8 ? ', at the center' : ''}${mixed ? ', entangled with other qubits' : ', pure local state'}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="#f0f4f8" fill-opacity=".65" stroke="#b9c8d5" stroke-width="1.3" />
    <ellipse cx="${cx}" cy="${cy}" rx="${radius}" ry="${radius * 0.3420201433}" fill="none" stroke="#bdcbd8" stroke-width="1.1" />
    <ellipse cx="${cx}" cy="${cy}" rx="${radius * .36}" ry="${radius}" fill="none" stroke="#d6dfe6" stroke-width="1" />
    ${axis(1, 0, 0, 'x')}${axis(0, 1, 0, 'y')}${axis(0, 0, 1, 'z')}
    <text x="${cx - 16}" y="31" text-anchor="end" fill="#24354b" font-size="18">|0⟩</text>
    <text x="${cx + 14}" y="253" fill="#24354b" font-size="18">|1⟩</text>
    <circle cx="${cx}" cy="${cy}" r="3" fill="#8496a8" />${vector}
    <text x="${cx}" y="278" text-anchor="middle" fill="#617184" font-size="12" font-family="ui-monospace, monospace">x ${fixed(x)} · y ${fixed(y)} · z ${fixed(z)}</text>
  </svg>`;
}

export function probabilityMarkup(state: State): string {
  // Remove one shared global phase for readable amplitudes, never per-qubit phases.
  const readable = canonicalState(state);
  const qubits = Math.log2(state.length);
  const rows = probabilities(state).map((probability, index) => {
    const percent = Math.max(0, Math.min(100, probability * 100));
    const text = percent.toFixed(1).replace(/\.0$/, '');
    return `<tr><th scope="row"><span class="ket">|${index.toString(2).padStart(qubits, '0')}⟩</span></th>
      <td class="probability-cell"><span class="probability-value">${text}<span class="percent">%</span></span><span class="probability-track" aria-hidden="true"><span style="width:${percent}%"></span></span></td>
      <td class="amplitude${percent < 1e-8 ? ' is-zero' : ''}">${escapeHtml(formatAmplitude(readable[index]))}</td></tr>`;
  });
  const table = (tableRows: string[], range = '') => `<table class="probability-table"><caption class="visually-hidden">Exact measurement probabilities and amplitudes${range}. The state has not been measured.</caption><thead><tr><th scope="col">Outcome</th><th scope="col">Chance</th><th scope="col">Amplitude</th></tr></thead><tbody>${tableRows.join('')}</tbody></table>`;
  // Eight outcomes stay fully visible without doubling the projector's table height.
  return qubits === 3
    ? `<div class="probability-tables">${table(rows.slice(0, 4), ' for outcomes 000 through 011')}${table(rows.slice(4), ' for outcomes 100 through 111')}</div>`
    : table(rows);
}
