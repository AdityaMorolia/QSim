export type SingleGate = 'H' | 'X' | 'Y' | 'Z' | 'P';
export type GateKind = SingleGate | 'CNOT';
export type Operation =
  | { gate: SingleGate; target: number }
  | { gate: 'CNOT'; target: number; control: number };
export interface Complex { re: number; im: number }
export type State = Complex[];
export interface Circuit { initial: ('0' | '+')[]; operations: Operation[] }
export interface Example { label: string; explanation: string; circuit: Circuit }
export interface Puzzle {
  id: string;
  number: number;
  title: string;
  shortTitle: string;
  prompt: string;
  goal: string;
  concept: string;
  starter: Circuit;
  target?: State;
  kind: 'target' | 'two-ways' | 'compare' | 'free';
  hint: string;
  examples: Example[];
}
export interface Feedback { tone: 'success' | 'info' | 'retry'; text: string }
export type RunStatus = 'playing' | 'paused' | 'complete';
export interface DisplaySnapshot {
  version: 1;
  revision: number;
  runId: string;
  puzzleId: string;
  title: string;
  goal: string;
  circuit: Circuit;
  state: State;
  step: number;
  status: RunStatus;
  example: boolean;
  variant: number;
  feedback: Feedback | null;
}
export interface Run extends DisplaySnapshot { frames: State[] }
export interface WelcomeSnapshot { version: 1; revision: number; welcome: true }
export type PublishedSnapshot = DisplaySnapshot | WelcomeSnapshot;
