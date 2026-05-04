# Medial Axis Finding Prompt Pack

This folder contains a staged prompt workflow for producing a correct, transferable description of `skimage.morphology.medial_axis` for a JavaScript/browser implementation. The current project implementation uses that raw medial ridge as an intermediate and then applies low-radius endpoint pruning to produce the final inner ridge mask.

The workflow is designed around small isolated tasks. Each prompt produces one partial result, and later prompts use those results as their source material.

## Execution Order

- `prompts/01_source_fact_extractor.prompt.md`
- `prompts/02_test_oracle_designer.prompt.md`
- `prompts/03_implementation_semantics_translator.prompt.md`
- `prompts/04_EDT_strategy_decider.prompt.md`
- `prompts/05_final_spec_writer.prompt.md`
- `prompts/06_adversarial_spec_reviewer.prompt.md`

## Shared Files

- `shared/medial_axis_orientation.md` gives every agent the same source-priority guidance and implementation details to keep visible.
- `shared/result_contract.md` defines the artifact each step should produce.

## Result Folders

- `results/01_source_facts/`
- `results/02_behavior_oracles/`
- `results/03_implementation_semantics/`
- `results/04_EDT_strategy/`
- `results/05_final_spec/`
- `results/06_review/`

## Reference Implementation

- `implementation/medial_ridge.js` contains the plain JavaScript reference implementation snapshot.
- `testing/medial_ridge_tests.html` contains browser-based source-contract tests.

The active browser test files currently live under `Work_Permit_Olympus_Mons/Ridge_Test/`.

Open the test HTML file in a browser to run the checks. No build step or package install is required.

## Working Principle

Treat the exact scikit-image behavior, browser-compatible replacements, and project conventions as separate categories. This keeps implementation facts clear and helps later agents keep source code behavior distinct from reasonable substitutions.
