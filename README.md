# Quantum Playground

A small, offline-ready quantum circuit playground for a school booth. The laptop is the **builder**; a second browser window is the **display** for the projector. Plain TypeScript, CSS, SVG, and Vite, with no runtime dependencies or backend.

## Run the booth

Install Node.js **22.18 or later**, then run:

```sh
npm install
npm run build
npm run preview
```

Open the local address printed by Vite. Click **Open display**, move that window onto the extended monitor/projector, and use its fullscreen button. Keep the builder and display in the **same browser profile and on the same origin** (host and port). One builder controls the display; separate computers are not supported. The browser may need permission to open the display window.

The built app and all its assets run locally. After setup, internet access is unnecessary; keep the preview server running during the booth. To work on the app, use `npm run dev` instead.

## Play

- Choose one of puzzles **1–6**, or choose **Free play** with one or two qubits.
- Select a gate, then an insertion marker on a wire, or drag a gate into place. A selected gate also has move/delete controls, so dragging is optional.
- With **CNOT**, the wire you place it on is the target; the other wire is the control. Reverse its direction with the selected gate controls.
- Add up to **eight gates**, then **Launch**. The monitor shows one gate every **650 ms**. Pause, step, replay, or return to editing from the laptop.
- Launching shows exact outcome probabilities and amplitudes. It does **not** perform a random measurement or collapse the state.
- Hints and solutions stay on the laptop. A loaded solution appears on the display only after Launch; example runs do not count toward puzzle progress.
- **New visitor** clears the drafts and progress and returns both screens to the beginning. Otherwise drafts/progress survive a builder refresh for this browser session. Refreshing during playback restores it paused.

Puzzle 3 asks for two distinct successful gate sequences. Puzzle 4 compares two fixed circuits. Puzzle 5 begins directly in `|+⟩`. In puzzle 6, centered Bloch vectors describe the individual entangled qubits; the joint state is shown in the amplitude table.

The top wire is `q0`, the **leftmost bit** in `|q0 q1⟩`; outcome order is `00, 01, 10, 11`. The worksheet's `P` gate is `diag(1, i)`, also called `S`.

## Small, editable code

`src/config.ts` holds the gate limit, playback timing, numerical tolerance, and storage/channel names. Puzzle wording, hints, and example circuits live in `src/puzzles.ts`. Gate calculations and Bloch vectors live in `src/quantum.ts`. Colors and layout use CSS variables in the shared stylesheet. No fonts or assets are fetched from external services.

The builder owns the playback timer. It publishes complete snapshots with `BroadcastChannel` and keeps the last snapshot in local storage, so the display can be opened or refreshed mid-run. Drafts are separate from the launched circuit; editing never changes the monitor until the next launch.

## Check changes

```sh
npm run check
npm test
npm run build
```

The compact numerical checks use Node's built-in test runner. There is no browser test framework. Before a booth, check these interactions manually:

- At **1366×768**, add, move, reverse, delete, undo, and reset gates using both clicking and dragging; try an invalid drop and the eight-gate limit. Check keyboard navigation and Escape.
- At **1280×720**, confirm the monitor fits without scrolling and the circuit, probabilities, amplitudes, and sphere labels are readable.
- Solve puzzle 3 twice with different circuits; run both puzzle 4 variants; check solution examples do not award progress.
- Pause, step backward/forward, replay, and edit after pausing. Changes should appear on the monitor only after Launch.
- Open/refresh the monitor during a run; refresh the builder during playback; confirm paused restoration and draft preservation.
- Click **New visitor** and verify that both windows reset.

Puzzle content follows *Quantum Puzzles.pdf* and the *Bubble Computer and QC cheat sheet.pdf* supplied for this project. Palette and lightweight setup are inspired by [math-viz](https://github.com/AdityaMorolia/math-viz). Bubble Computer, puzzles 7–10, random sampling, custom gates, and three-qubit circuits are outside this version.
