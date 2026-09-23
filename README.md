# Quantum Playground

A small, offline-ready quantum circuit playground for a school booth. The laptop is the **builder**; a second browser window is the **display** for the projector. Plain TypeScript, CSS, SVG, and Vite, with no runtime dependencies or backend.

## Run the booth

Install Node.js **22.18 or later**, then run:

```sh
npm install
npm run build
npm run preview
```

Open the local address printed by Vite. Click **Open display**, move that window onto the extended monitor/projector, and use the browser’s fullscreen command to hide its toolbar. The display always fills the browser window and has no fullscreen toggle; browser rules prevent a page from forcing true fullscreen on load. Keep the builder and display in the **same browser profile and on the same origin** (host and port). One builder controls the display; separate computers are not supported. The browser may need permission to open the display window.

The built app and all its assets run locally. After setup, internet access is unnecessary; keep the preview server running during the booth. To work on the app, use `npm run dev` instead.

## Play

- Choose one of puzzles **1–6**, or choose **Free play** with one, two, or three qubits.
- Select a gate, then click near a wire, or drag roughly to the desired position. A selected gate also has move/delete controls, so dragging is optional.
- With **CNOT**, place it on the target wire. In a three-qubit circuit, select the gate and choose its **Control** wire below the circuit. Dragging keeps the existing control when possible; **Reverse direction** swaps the target and control.
- Add gates, then select **Run** on either screen. The display button runs the builder’s current draft or resumes paused playback; keep the builder window open. Commuting gates stack across wires and execute together, with one group every **650 ms** and no numeric labels. Pause, step, replay, or return to editing from the laptop.
- Running a circuit shows exact outcome probabilities and amplitudes. It does **not** perform a random measurement or collapse the state.
- Hints and solutions stay on the laptop. A loaded solution appears on the display only after Run; example runs do not count toward puzzle progress.
- **Reset** clears the drafts and progress and returns both screens to the beginning. Otherwise drafts/progress survive a builder refresh for this browser session. Refreshing during playback restores it paused.

Puzzle 3 asks for two distinct successful gate sequences. Puzzle 4 compares two fixed circuits. Puzzle 5 begins directly in `|+⟩`. In puzzle 6, centered Bloch vectors describe the individual entangled qubits; the joint state is shown in the amplitude table.

The top wire is `q0`, the **leftmost bit** in the outcome. Two-qubit outcomes run from `00` to `11`; three-qubit outcomes run from `000` to `111`. Each wire has its own Bloch sphere. The worksheet's `P` gate is `diag(1, i)`, also called `S`.

## Small, editable code

`src/config.ts` holds the qubit limit, playback timing, numerical tolerance, and storage/channel names. Puzzle wording, hints, and example circuits live in `src/puzzles.ts`. Gate calculations and Bloch vectors live in `src/quantum.ts`. Colors and base styles live in `src/shared.css`; builder and display layouts have separate stylesheets. No fonts or assets are fetched from external services.

The builder owns the playback timer. It publishes complete snapshots with `BroadcastChannel` and keeps the last snapshot in local storage, so the display can be opened or refreshed mid-run. Drafts are separate from the launched circuit; editing never changes the monitor until the next run.

## Check changes

```sh
npm run check
npm test
npm run build
```

The compact numerical checks use Node's built-in test runner. There is no browser test framework. Before a booth, check these interactions manually:

- At **1366×768**, add, move, reverse, delete, undo, and reset gates using both clicking and dragging; try an invalid drop and a long circuit. Check keyboard navigation and Escape.
- At **1280×720**, confirm the monitor fits vertically and the circuit, probabilities, amplitudes, and sphere labels are readable.
- Use **Run** from each screen, including an empty circuit and a paused run; verify playback stays synchronized.
- Solve puzzle 3 twice with different circuits; run both puzzle 4 variants; check solution examples do not award progress.
- Pause, step backward/forward, replay, and edit after pausing. Changes should appear on the monitor only after Run.
- Open/refresh the monitor during a run; refresh the builder during playback; confirm paused restoration and draft preservation.
- Click **Reset** and verify that both windows reset.

Puzzle content follows *Quantum Puzzles.pdf* and the *Bubble Computer and QC cheat sheet.pdf* supplied for this project. Palette and lightweight setup are inspired by [math-viz](https://github.com/AdityaMorolia/math-viz). Bubble Computer, puzzles 7–10, random sampling, custom gates, and circuits larger than three qubits are outside this version.
