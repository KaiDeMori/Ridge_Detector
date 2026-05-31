# Ridge Detector — scikit-image Port

This folder holds the **faithful port**: a JavaScript re-creation of `skimage.morphology.medial_axis`, plus the staged research workflow that produced it. The port uses the raw medial ridge as an intermediate and then applies low-radius endpoint pruning to produce the final inner ridge mask.

This is the place to contribute fixes that keep the implementation true to the source algorithms. For the tuned, battle-tested detector that goes beyond the port (and handles spiky shapes the port cannot), see [`../enhanced/`](../enhanced/).

## Layout

- `medial_ridge_detector_skimage_port.js` — the port implementation (the entry file).
- `research/` — the staged prompt workflow and its outputs.
- `tests/` — browser-based source-contract tests and a step-by-step visualizer. Open the HTML files in a browser; no build step or package install is required.

## Research Workflow

The `research/` folder is designed around small isolated tasks. Each prompt produces one partial result, and later prompts use those results as their source material.

### Execution Order

- `research/prompts/01_source_fact_extractor.prompt.md`
- `research/prompts/02_test_oracle_designer.prompt.md`
- `research/prompts/03_implementation_semantics_translator.prompt.md`
- `research/prompts/04_EDT_strategy_decider.prompt.md`
- `research/prompts/05_final_spec_writer.prompt.md`
- `research/prompts/06_adversarial_spec_reviewer.prompt.md`

### Shared Files

- `research/shared/medial_axis_orientation.md` gives every agent the same source-priority guidance and implementation details to keep visible.
- `research/shared/result_contract.md` defines the artifact each step should produce.

### Result Folders

- `research/results/01_source_facts/`
- `research/results/02_behavior_oracles/`
- `research/results/03_implementation_semantics/`
- `research/results/04_EDT_strategy/`
- `research/results/05_final_spec/`
- `research/results/06_review/`

## Working Principle

Treat the exact scikit-image behavior, browser-compatible replacements, and project conventions as separate categories. This keeps implementation facts clear and helps later agents keep source code behavior distinct from reasonable substitutions.
