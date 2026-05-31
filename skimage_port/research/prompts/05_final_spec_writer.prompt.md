---
description: "Use when: writing the final transferable medial ridge algorithm spec from staged artifacts."
name: "Medial Ridge Final Spec Writer"
argument-hint: "Optional: target audience or desired spec length"
agent: "agent"
---

# Medial Ridge Final Spec Writer

## Task

Write the final transferable algorithm document for producing an inner ridge mask from a binary stencil texture in JavaScript/browser code.

Use these inputs:

- `../shared/medial_axis_orientation.md`
- `../shared/result_contract.md`
- `../results/01_source_facts/source_fact_table.md`
- `../results/02_behavior_oracles/test_oracle_design.md`
- `../results/03_implementation_semantics/implementation_semantics.md`
- `../results/04_EDT_strategy/EDT_strategy.md`

Write the result to:

- `../results/05_final_spec/medial_ridge_spec.md`

## Scope

Create a document that a JavaScript/WebGL implementer can follow. Keep source-derived behavior, browser replacements, and project conventions visibly separated.

Use the project output term `ridge` or `ridge mask` throughout the project-facing parts of the document. Mention `medial_axis` only when naming the source algorithm.

## Required Content

Include these sections:

- goal and input/output conventions
- source-version target
- scikit parity summary
- browser replacement summary
- project conventions
- binary foreground normalization
- keep-table construction
- distance transform strategy
- cornerness calculation
- processing order
- single ordered thinning pass
- ridge-mask promotion
- Three.js upload note
- behavior oracle fixtures to test against
- open questions, if any

## Writing Guidance

Prefer direct implementation language. State what the implementer should do, and label each important choice with its category.

Use exact details from prior artifacts. When a detail is absent from prior artifacts, place it in `Open Questions` for review instead of filling it in from general knowledge.

## Output Format

Use this structure:

```markdown
# Inner Ridge Detection From A Binary Stencil Texture

## Goal

## Version Target

## Source Behavior Summary

## Browser Port Decisions

## Inputs

## Outputs

## Algorithm

## Validation Fixtures

## Three.js Upload

## Open Questions
```
