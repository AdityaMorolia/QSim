import { EPSILON, MAX_GATES, MAX_QUBITS } from './config.ts';
import type { Circuit, Complex, Feedback, Operation, SingleGate, State } from './types.ts';

const c = (re: number, im = 0): Complex => ({ re, im });
const SQRT_HALF = Math.SQRT1_2;
const matrices: Record<SingleGate, [Complex, Complex, Complex, Complex]> = {
  H: [c(SQRT_HALF), c(SQRT_HALF), c(SQRT_HALF), c(-SQRT_HALF)],
  X: [c(0), c(1), c(1), c(0)],
  Y: [c(0), c(0, -1), c(0, 1), c(0)],
  Z: [c(1), c(0), c(0), c(-1)],
  // The worksheet calls the S gate P: this is a fixed quarter-turn, not P(θ).
  P: [c(1), c(0), c(0), c(0, 1)],
};

function multiply(a: Complex, b: Complex): Complex {
  return c(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}

function add(a: Complex, b: Complex): Complex {
  return c(a.re + b.re, a.im + b.im);
}

function isOperation(value: unknown, qubits: number): value is Operation {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  const isWire = (wire: unknown) => typeof wire === 'number' && Number.isInteger(wire) && wire >= 0 && wire < qubits;
  if (!isWire(op.target)) return false;
  if (op.gate === 'CNOT') return isWire(op.control) && op.control !== op.target;
  return typeof op.gate === 'string' && Object.hasOwn(matrices, op.gate);
}

export function isValidCircuit(value: unknown): value is Circuit {
  if (!value || typeof value !== 'object') return false;
  const circuit = value as Partial<Circuit>;
  return Array.isArray(circuit.initial) && circuit.initial.length >= 1 && circuit.initial.length <= MAX_QUBITS
    && circuit.initial.every(value => value === '0' || value === '+')
    && Array.isArray(circuit.operations) && circuit.operations.length <= MAX_GATES
    && circuit.operations.every(operation => isOperation(operation, circuit.initial!.length));
}

export function initialState(circuit: Circuit): State {
  if (!isValidCircuit(circuit)) throw new Error(`Use one to ${MAX_QUBITS} qubits and at most ${MAX_GATES} valid gates.`);
  let state: State = [c(1)];
  for (const initial of circuit.initial) {
    const factor = initial === '+' ? SQRT_HALF : 1;
    state = state.flatMap(a => [c(a.re * factor, a.im * factor), initial === '+' ? c(a.re * factor, a.im * factor) : c(0)]);
  }
  return state;
}

export function applyGate(state: State, operation: Operation): State {
  const qubits = Math.log2(state.length);
  if (!Number.isInteger(qubits) || qubits < 1 || qubits > MAX_QUBITS || !isOperation(operation, qubits)) throw new Error('Invalid gate or state size.');
  const next = state.map(a => ({ ...a }));
  // q0 is the top wire and most significant (leftmost) bit: 000, 001, …, 111.
  const targetMask = 1 << (qubits - 1 - operation.target);
  if (operation.gate === 'CNOT') {
    const controlMask = 1 << (qubits - 1 - operation.control);
    for (let index = 0; index < state.length; index++) {
      if ((index & controlMask) && !(index & targetMask)) {
        [next[index], next[index | targetMask]] = [next[index | targetMask], next[index]];
      }
    }
    return next;
  }
  const [a, b, d, e] = matrices[operation.gate];
  for (let index = 0; index < state.length; index++) {
    if (index & targetMask) continue;
    const zero = state[index];
    const one = state[index | targetMask];
    next[index] = add(multiply(a, zero), multiply(b, one));
    next[index | targetMask] = add(multiply(d, zero), multiply(e, one));
  }
  return next;
}

export function simulate(circuit: Circuit): State[] {
  const frames = [initialState(circuit)];
  for (const operation of circuit.operations) frames.push(applyGate(frames[frames.length - 1], operation));
  return frames;
}

export function probabilities(state: State): number[] {
  return state.map(a => a.re * a.re + a.im * a.im);
}

export function fidelity(actual: State, target: State): number {
  if (actual.length !== target.length) return 0;
  const inner = actual.reduce((sum, a, index) => add(sum, multiply(c(target[index].re, -target[index].im), a)), c(0));
  return inner.re * inner.re + inner.im * inner.im;
}

export function blochVector(state: State, qubit: number): { x: number; y: number; z: number } {
  const qubits = Math.log2(state.length);
  if (!Number.isInteger(qubits) || qubits < 1 || qubits > MAX_QUBITS || !Number.isInteger(qubit) || qubit < 0 || qubit >= qubits) throw new Error('Invalid qubit.');
  const mask = 1 << (qubits - 1 - qubit);
  const vector = { x: 0, y: 0, z: 0 };
  // Summing out the other wires gives the local mixed state. Entanglement can shorten this vector.
  for (let index = 0; index < state.length; index++) {
    if (index & mask) continue;
    const a = state[index];
    const b = state[index | mask];
    const coherence = multiply(c(a.re, -a.im), b);
    vector.x += 2 * coherence.re;
    vector.y += 2 * coherence.im;
    vector.z += a.re * a.re + a.im * a.im - b.re * b.re - b.im * b.im;
  }
  return vector;
}

export function canonicalState(state: State): State {
  const first = state.find(a => Math.hypot(a.re, a.im) > EPSILON);
  if (!first) return state.map(a => ({ ...a }));
  const magnitude = Math.hypot(first.re, first.im);
  // One global rotation preserves all relative phases. Never normalize each amplitude separately.
  const rotation = c(first.re / magnitude, -first.im / magnitude);
  return state.map(a => multiply(a, rotation));
}

export function formatAmplitude(value: Complex): string {
  const re = Math.abs(value.re) < EPSILON ? 0 : value.re;
  const im = Math.abs(value.im) < EPSILON ? 0 : value.im;
  const magnitude = (n: number, imaginary = false): string => {
    const a = Math.abs(n);
    if (Math.abs(a - SQRT_HALF) < EPSILON) return imaginary ? 'i/√2' : '1/√2';
    if (Math.abs(a - 1) < EPSILON) return imaginary ? 'i' : '1';
    return `${Number(a.toFixed(3))}${imaginary ? 'i' : ''}`;
  };
  if (!re && !im) return '0';
  if (!im) return `${re < 0 ? '−' : ''}${magnitude(re)}`;
  if (!re) return `${im < 0 ? '−' : ''}${magnitude(im, true)}`;
  return `${re < 0 ? '−' : ''}${magnitude(re)} ${im < 0 ? '−' : '+'} ${magnitude(im, true)}`;
}

export function circuitSignature(circuit: Circuit): string {
  // Puzzle 3 compares written gate sequences, not equivalence after simplification.
  return circuit.operations.map(op => op.gate === 'CNOT' ? `CNOT:${op.control}>${op.target}` : `${op.gate}:${op.target}`).join('|');
}

export function targetFeedback(actual: State, target: State): Feedback {
  if (fidelity(actual, target) >= 1 - EPSILON) return { tone: 'success', text: 'Target reached!' };
  const actualProbabilities = probabilities(actual);
  const sameChances = actual.length === target.length && probabilities(target).every((p, index) => Math.abs(p - actualProbabilities[index]) < EPSILON);
  return { tone: 'retry', text: sameChances ? 'The chances match. Check the signs and phases.' : 'Not quite—try another circuit.' };
}
