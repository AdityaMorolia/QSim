import type { Circuit, GateKind, Puzzle, State } from './types.ts';

const state = (...values: number[]): State => values.map(re => ({ re, im: 0 }));
const h = Math.SQRT1_2;
const empty = (): Circuit => ({ initial: ['0'], operations: [] });

export const GATES: { gate: GateKind; name: string; description: string }[] = [
  { gate: 'H', name: 'Hadamard', description: 'Mix the |0⟩ and |1⟩ amplitudes.' },
  { gate: 'X', name: 'Bit flip', description: 'Swap |0⟩ and |1⟩.' },
  { gate: 'Y', name: 'Y gate', description: 'Swap the states and change their phases.' },
  { gate: 'Z', name: 'Sign flip', description: 'Change the sign of the |1⟩ amplitude.' },
  { gate: 'P', name: 'Phase gate', description: 'Multiply the |1⟩ amplitude by i. Also called S.' },
  { gate: 'CNOT', name: 'Controlled NOT', description: 'Flip the target when the control is |1⟩. Place it on the target wire.' },
];

export const PUZZLES: Puzzle[] = [
  {
    id: '1', number: 1, title: 'A different beginning', shortTitle: 'Different beginning', kind: 'target',
    prompt: 'Start at |0⟩ and turn your qubit into |1⟩.', goal: '|1⟩', concept: 'Flip a qubit',
    starter: empty(), target: state(0, 1), hint: 'Look for a gate that swaps |0⟩ and |1⟩.',
    examples: [{ label: 'One little flip', explanation: 'X swaps the two states, taking |0⟩ to |1⟩.', circuit: { initial: ['0'], operations: [{ gate: 'X', target: 0 }] } }],
  },
  {
    id: '2', number: 2, title: 'Be in a super position', shortTitle: 'Super position', kind: 'target',
    prompt: 'Make an equal superposition with matching signs.', goal: '(|0⟩ + |1⟩)/√2', concept: 'Mix two possibilities',
    starter: empty(), target: state(h, h), hint: 'H mixes the two amplitudes. Try it on the starting state.',
    examples: [{ label: 'A little H magic', explanation: 'H takes |0⟩ to an equal superposition: (|0⟩ + |1⟩)/√2.', circuit: { initial: ['0'], operations: [{ gate: 'H', target: 0 }] } }],
  },
  {
    id: '3', number: 3, title: 'A super negative position', shortTitle: 'Negative position', kind: 'two-ways',
    prompt: 'Find two different circuits that make this state.', goal: '(|0⟩ − |1⟩)/√2', concept: 'Discover relative phase',
    starter: empty(), target: state(h, -h), hint: 'Try making a superposition first, then changing a sign. Or change the starting bit before H.',
    examples: [
      { label: 'H then Z', explanation: 'H makes the superposition, then Z changes the sign of the |1⟩ amplitude.', circuit: { initial: ['0'], operations: [{ gate: 'H', target: 0 }, { gate: 'Z', target: 0 }] } },
      { label: 'X then H', explanation: 'X first makes |1⟩. Applying H to |1⟩ produces the minus superposition.', circuit: { initial: ['0'], operations: [{ gate: 'X', target: 0 }, { gate: 'H', target: 0 }] } },
    ],
  },
  {
    id: '4', number: 4, title: 'Different forward and backward', shortTitle: 'Forward & backward', kind: 'compare',
    prompt: 'Launch both circuits. What changes when their order changes?', goal: 'Compare H then P with P then H', concept: 'Order matters',
    starter: { initial: ['0'], operations: [{ gate: 'H', target: 0 }, { gate: 'P', target: 0 }] },
    hint: 'The measurement chances look the same. Compare the amplitudes and the Bloch vector.',
    examples: [
      { label: 'H then P', explanation: 'H creates two amplitudes; P multiplies the |1⟩ amplitude by i. The result is (|0⟩ + i|1⟩)/√2.', circuit: { initial: ['0'], operations: [{ gate: 'H', target: 0 }, { gate: 'P', target: 0 }] } },
      { label: 'P then H', explanation: 'P leaves |0⟩ unchanged. H then produces (|0⟩ + |1⟩)/√2.', circuit: { initial: ['0'], operations: [{ gate: 'P', target: 0 }, { gate: 'H', target: 0 }] } },
    ],
  },
  {
    id: '5', number: 5, title: 'Staying grounded', shortTitle: 'Staying grounded', kind: 'target',
    prompt: 'Your qubit starts in |+⟩. Bring it back to |0⟩.', goal: '|0⟩', concept: 'Undo a superposition',
    starter: { initial: ['+'], operations: [] }, target: state(1, 0), hint: 'The H gate is its own inverse. What happens if you use it on |+⟩?',
    examples: [{ label: 'H brings you home', explanation: 'H combines the two amplitudes so the |1⟩ part cancels, leaving |0⟩.', circuit: { initial: ['+'], operations: [{ gate: 'H', target: 0 }] } }],
  },
  {
    id: '6', number: 6, title: 'Oppositely entangled', shortTitle: 'Oppositely entangled', kind: 'target',
    prompt: 'Link two qubits so their measured bits are always opposite.', goal: '(|01⟩ + |10⟩)/√2', concept: 'Make an entangled pair',
    starter: { initial: ['0', '0'], operations: [] }, target: state(0, h, h, 0),
    hint: 'Use H on the top wire, then CNOT with the top wire as control. Flip one qubit to make the pair opposite.',
    examples: [{ label: 'Mix, link, flip', explanation: 'H on q0 and CNOT from q0 to q1 make (|00⟩ + |11⟩)/√2. X on q1 changes it to (|01⟩ + |10⟩)/√2.', circuit: { initial: ['0', '0'], operations: [{ gate: 'H', target: 0 }, { gate: 'CNOT', control: 0, target: 1 }, { gate: 'X', target: 1 }] } }],
  },
  {
    id: 'free', number: 0, title: 'Free play', shortTitle: 'Free play', kind: 'free',
    prompt: 'Follow your curiosity. Build a circuit and see where it takes you.', goal: 'Explore one or two qubits', concept: 'Your own experiment',
    starter: empty(), hint: 'Try two H gates in a row, or explore what P does to a superposition.', examples: [],
  },
];

export function getPuzzle(id: string): Puzzle {
  return PUZZLES.find(puzzle => puzzle.id === id) ?? PUZZLES[0];
}

export function cloneCircuit(circuit: Circuit): Circuit {
  return { initial: [...circuit.initial], operations: circuit.operations.map(operation => ({ ...operation })) };
}
