import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyGate, blochVector, canonicalState, circuitColumns, circuitSignature, fidelity, formatAmplitude, initialState, isValidCircuit, probabilities, simulate, targetFeedback } from '../src/quantum.ts';
import { PUZZLES, getPuzzle } from '../src/puzzles.ts';
import type { Circuit, SingleGate, State } from '../src/types.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ≠ ${expected}`);
const sameState = (actual: State, expected: State) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((a, index) => { close(a.re, expected[index].re); close(a.im, expected[index].im); });
};
const final = (circuit: Circuit) => simulate(circuit).at(-1)!;
const zero = initialState({ initial: ['0'], operations: [] });

test('single-qubit matrices, identities, and P phase convention', () => {
  const arbitrary: State = [{ re: 0.5, im: 0.5 }, { re: -0.5, im: 0.5 }];
  for (const gate of ['H', 'X', 'Y', 'Z'] as SingleGate[]) {
    sameState(applyGate(applyGate(arbitrary, { gate, target: 0 }), { gate, target: 0 }), arbitrary);
  }
  sameState(applyGate(applyGate(arbitrary, { gate: 'P', target: 0 }), { gate: 'P', target: 0 }), applyGate(arbitrary, { gate: 'Z', target: 0 }));
  sameState(applyGate(zero, { gate: 'Y', target: 0 }), [{ re: 0, im: 0 }, { re: 0, im: 1 }]);
  const one = applyGate(zero, { gate: 'X', target: 0 });
  sameState(applyGate(one, { gate: 'Y', target: 0 }), [{ re: 0, im: -1 }, { re: 0, im: 0 }]);
  sameState(applyGate(one, { gate: 'P', target: 0 }), [{ re: 0, im: 0 }, { re: 0, im: 1 }]);
});

test('independent gates share one simulation order', () => {
  const circuit: Circuit = { initial: ['0', '0'], operations: [{ gate: 'H', target: 0 }, { gate: 'H', target: 1 }] };
  assert.deepEqual(circuitColumns(circuit), [[0, 1]]);
  const frames = simulate(circuit);
  assert.equal(frames.length, 2);
  sameState(frames[1], Array.from({ length: 4 }, () => ({ re: 0.5, im: 0 })));
});

test('shared targets and controls keep conflicting gates in separate orders', () => {
  const sameWire: Circuit = { initial: ['+'], operations: [{ gate: 'H', target: 0 }, { gate: 'X', target: 0 }] };
  const frames = simulate(sameWire);
  assert.deepEqual(circuitColumns(sameWire), [[0], [1]]);
  assert.equal(frames.length, 3);
  sameState(frames[1], [{ re: 1, im: 0 }, { re: 0, im: 0 }]);
  sameState(frames[2], [{ re: 0, im: 0 }, { re: 1, im: 0 }]);
  const conflicts: Circuit['operations'][] = [
    [{ gate: 'CNOT', control: 0, target: 1 }, { gate: 'H', target: 0 }],
    [{ gate: 'CNOT', control: 0, target: 1 }, { gate: 'X', target: 1 }],
    [{ gate: 'CNOT', control: 0, target: 1 }, { gate: 'CNOT', control: 1, target: 2 }],
  ];
  for (const operations of conflicts) assert.deepEqual(circuitColumns({ initial: ['0', '0', '0'], operations }), [[0], [1]]);
});

test('CNOT and an independent third wire share one order with the correct joint state', () => {
  const circuit: Circuit = { initial: ['+', '0', '0'], operations: [{ gate: 'CNOT', control: 0, target: 1 }, { gate: 'H', target: 2 }] };
  assert.deepEqual(circuitColumns(circuit), [[0, 1]]);
  const frames = simulate(circuit);
  assert.equal(frames.length, 2);
  sameState(frames[1], Array.from({ length: 8 }, (_, index) => ({ re: [0, 1, 6, 7].includes(index) ? 0.5 : 0, im: 0 })));
  sameState(final({ ...circuit, operations: [...circuit.operations].reverse() }), frames[1]);
});

test('all target examples solve their puzzle, including two different ways', () => {
  for (const puzzle of PUZZLES.filter(puzzle => puzzle.target)) {
    for (const example of puzzle.examples) {
      close(fidelity(final(example.circuit), puzzle.target!), 1);
      assert.equal(targetFeedback(final(example.circuit), puzzle.target!).tone, 'success');
    }
  }
  const ways = getPuzzle('3').examples.map(example => circuitSignature(example.circuit));
  assert.notEqual(ways[0], ways[1]);
  sameState(initialState(getPuzzle('5').starter), [{ re: Math.SQRT1_2, im: 0 }, { re: Math.SQRT1_2, im: 0 }]);
});

test('top wire is the most significant bit and both CNOT directions work', () => {
  const start = initialState({ initial: ['0', '0'], operations: [] });
  const top = applyGate(start, { gate: 'X', target: 0 });
  const bottom = applyGate(start, { gate: 'X', target: 1 });
  assert.deepEqual(probabilities(top), [0, 0, 1, 0]);
  assert.deepEqual(probabilities(bottom), [0, 1, 0, 0]);
  assert.deepEqual(probabilities(applyGate(top, { gate: 'CNOT', control: 0, target: 1 })), [0, 0, 0, 1]);
  assert.deepEqual(probabilities(applyGate(bottom, { gate: 'CNOT', control: 1, target: 0 })), [0, 0, 0, 1]);
  sameState(applyGate(bottom, { gate: 'CNOT', control: 0, target: 1 }), bottom);
  sameState(applyGate(top, { gate: 'CNOT', control: 1, target: 0 }), top);
});

test('three-qubit CNOT truth tables cover every ordered pair and all eight basis states', () => {
  for (const control of [0, 1, 2]) {
    for (const target of [0, 1, 2]) {
      if (control === target) continue;
      for (let basis = 0; basis < 8; basis++) {
        const bits = basis.toString(2).padStart(3, '0').split('');
        if (bits[control] === '1') bits[target] = bits[target] === '0' ? '1' : '0';
        const expected = Number.parseInt(bits.join(''), 2);
        const state = Array.from({ length: 8 }, (_, index) => ({ re: Number(index === basis), im: 0 }));
        const output = applyGate(state, { gate: 'CNOT', control, target });
        assert.deepEqual(probabilities(output), Array.from({ length: 8 }, (_, index) => Number(index === expected)));
      }
    }
  }
  const start = initialState({ initial: ['0', '0', '0'], operations: [] });
  assert.equal(start.length, 8);
  for (const [qubit, index] of [[0, 4], [1, 2], [2, 1]]) {
    assert.equal(probabilities(applyGate(start, { gate: 'X', target: qubit })).indexOf(1), index);
  }
});

test('GHZ entangles all three qubits while a separated pair leaves the middle qubit pure', () => {
  const ghzFrames = simulate({ initial: ['0', '0', '0'], operations: [
    { gate: 'H', target: 0 }, { gate: 'CNOT', control: 0, target: 1 }, { gate: 'CNOT', control: 1, target: 2 },
  ] });
  for (const frame of ghzFrames) close(probabilities(frame).reduce((sum, p) => sum + p, 0), 1);
  const ghz = ghzFrames.at(-1)!;
  probabilities(ghz).forEach((p, index) => close(p, index === 0 || index === 7 ? 0.5 : 0));
  close(ghz[0].re, Math.SQRT1_2); close(ghz[7].re, Math.SQRT1_2);
  for (const q of [0, 1, 2]) Object.values(blochVector(ghz, q)).forEach(value => close(value, 0));

  const pair = final({ initial: ['0', '0', '0'], operations: [{ gate: 'H', target: 0 }, { gate: 'CNOT', control: 0, target: 2 }] });
  probabilities(pair).forEach((p, index) => close(p, index === 0 || index === 5 ? 0.5 : 0));
  for (const q of [0, 2]) Object.values(blochVector(pair, q)).forEach(value => close(value, 0));
  const middle = blochVector(pair, 1);
  close(middle.x, 0); close(middle.y, 0); close(middle.z, 1);
});

test('three-qubit initial states and phases on the bottom wire preserve wire order', () => {
  const plus = initialState({ initial: ['+', '+', '+'], operations: [] });
  assert.equal(plus.length, 8);
  plus.forEach(a => { close(a.re, 1 / Math.sqrt(8)); close(a.im, 0); });
  const phased = final({ initial: ['0', '0', '+'], operations: [{ gate: 'P', target: 2 }] });
  sameState(phased, [
    { re: Math.SQRT1_2, im: 0 }, { re: 0, im: Math.SQRT1_2 },
    ...Array.from({ length: 6 }, () => ({ re: 0, im: 0 })),
  ]);
  const bottom = blochVector(phased, 2);
  close(bottom.x, 0); close(bottom.y, 1); close(bottom.z, 0);
  for (const q of [0, 1]) close(blochVector(phased, q).z, 1);
});

test('forward/backward circuits have equal chances but different phases and Bloch vectors', () => {
  const [hp, ph] = getPuzzle('4').examples.map(example => final(example.circuit));
  probabilities(hp).forEach((p, index) => close(p, probabilities(ph)[index]));
  close(fidelity(hp, ph), 0.5);
  const hpVector = blochVector(hp, 0), phVector = blochVector(ph, 0);
  close(hpVector.x, 0); close(hpVector.y, 1); close(hpVector.z, 0);
  close(phVector.x, 1); close(phVector.y, 0); close(phVector.z, 0);
});

test('opposite Bell pair has local centers; joint signs still matter', () => {
  const puzzle = getPuzzle('6');
  const bell = final(puzzle.examples[0].circuit);
  probabilities(bell).forEach((p, index) => close(p, [0, 0.5, 0.5, 0][index]));
  for (const q of [0, 1]) Object.values(blochVector(bell, q)).forEach(value => close(value, 0));
  const wrongPhase = applyGate(bell, { gate: 'Z', target: 0 });
  close(fidelity(wrongPhase, puzzle.target!), 0);
  assert.equal(targetFeedback(wrongPhase, puzzle.target!).text, 'The chances match. Check the signs and phases.');
  assert.equal(targetFeedback(initialState(puzzle.starter), puzzle.target!).text, 'Not quite—try another circuit.');
});

test('overall phase is accepted and formatting removes only the global rotation', () => {
  const target = getPuzzle('3').target!;
  const rotated = target.map(a => ({ re: -a.im, im: a.re }));
  close(fidelity(rotated, target), 1);
  sameState(canonicalState(rotated), target);
  assert.equal(targetFeedback(rotated, target).tone, 'success');
  assert.equal(formatAmplitude({ re: -Math.SQRT1_2, im: 0 }), '−1/√2');
  assert.equal(formatAmplitude({ re: 0, im: Math.SQRT1_2 }), 'i/√2');
  assert.equal(formatAmplitude({ re: -1e-16, im: 0 }), '0');
});

test('representative frames stay normalized without mutating their inputs', () => {
  const circuits: Circuit[] = [
    ...PUZZLES.flatMap(puzzle => puzzle.examples.map(example => example.circuit)),
    { initial: ['+', '+'], operations: [{ gate: 'Y', target: 0 }, { gate: 'P', target: 1 }, { gate: 'CNOT', control: 1, target: 0 }, { gate: 'H', target: 0 }, { gate: 'Z', target: 1 }] },
  ];
  for (const circuit of circuits) {
    const before = JSON.stringify(circuit);
    for (const frame of simulate(circuit)) close(probabilities(frame).reduce((sum, p) => sum + p, 0), 1);
    assert.equal(JSON.stringify(circuit), before);
  }
  const original = JSON.stringify(zero);
  applyGate(zero, { gate: 'H', target: 0 });
  assert.equal(JSON.stringify(zero), original);
});

test('circuit validation rejects unsupported sizes, gates, and wire references', () => {
  for (const invalid of [null, {}, { initial: [], operations: [] }, { initial: ['0', '0', '0', '0'], operations: [] }, { initial: ['1'], operations: [] }, ...[
    { gate: 'H', target: 1 }, { gate: 'H', target: -1 }, { gate: 'H', target: 0.5 }, { gate: 'T', target: 0 }, { gate: 'toString', target: 0 }, { gate: 'CNOT', control: 0, target: 0 }, { gate: 'CNOT', control: 1, target: 0 },
  ].map(operation => ({ initial: ['0'], operations: [operation] }))]) assert.equal(isValidCircuit(invalid), false);
  assert.equal(isValidCircuit({ initial: ['0', '+'], operations: [{ gate: 'CNOT', control: 1, target: 0 }] }), true);
  assert.equal(isValidCircuit({ initial: ['0', '0', '+'], operations: [{ gate: 'CNOT', control: 2, target: 0 }] }), true);
  assert.equal(isValidCircuit({ initial: ['0', '0', '0'], operations: [{ gate: 'H', target: 3 }] }), false);
  assert.equal(isValidCircuit({ initial: ['0', '0', '0'], operations: [{ gate: 'CNOT', control: 3, target: 0 }] }), false);
  assert.equal(isValidCircuit({ initial: ['0'], operations: Array(9).fill({ gate: 'H', target: 0 }) }), true);
  for (const length of [3, 16]) {
    const invalidState = Array.from({ length }, () => ({ re: 0, im: 0 }));
    assert.throws(() => applyGate(invalidState, { gate: 'H', target: 0 }));
    assert.throws(() => blochVector(invalidState, 0));
  }
});

test('long circuits validate and simulate every gate without truncation', () => {
  const circuit: Circuit = { initial: ['0'], operations: Array.from({ length: 129 }, () => ({ gate: 'X', target: 0 })) };
  assert.equal(isValidCircuit(circuit), true);
  const frames = simulate(circuit);
  assert.equal(frames.length, 130);
  sameState(frames.at(-1)!, [{ re: 0, im: 0 }, { re: 1, im: 0 }]);
});
