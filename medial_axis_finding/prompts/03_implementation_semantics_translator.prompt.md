---
description: "Use when: translating source facts into language-neutral medial-axis implementation semantics."
name: "Medial Axis Implementation Semantics Translator"
argument-hint: "Optional: target output detail level"
agent: "agent"
---

# Medial Axis Implementation Semantics Translator

## Task

Translate the extracted facts into language-neutral pseudocode and implementation invariants for a JavaScript/browser port.

Use these inputs:

- `../shared/medial_axis_orientation.md`
- `../shared/result_contract.md`
- `../results/01_source_facts/source_fact_table.md`
- `../results/02_behavior_oracles/test_oracle_design.md`, if present

Write the result to:

- `../results/03_implementation_semantics/implementation_semantics.md`

## Scope

Focus on the mechanics of `medial_axis`: data normalization, lookup-table construction, cornerness, processing order, and the single ordered thinning pass.

Keep EDT implementation details at the interface level. The dedicated EDT strategy prompt will decide the browser replacement or strict parity path.

## Required Semantics

Cover these items:

- input and output array conventions
- binary foreground normalization
- keep-table construction and meaning
- component counting for 3x3 patterns
- cornerness calculation
- foreground list construction
- tiebreaker assignment
- sort key order
- exact thinning-loop state changes
- boundary behavior for 3x3 operations
- promotion from binary ridge to byte ridge mask
- invariants that tests should protect

## Output Format

Use this structure:

```markdown
# Implementation Semantics

## Scope

## Inputs Used

## Result

### Data Model

### Keep Table

### Cornerness

### Processing Order

### Ordered Thinning Pass

### Output Conversion

### Invariants

## Open Questions
```

Keep each source-derived behavior labeled as scikit parity. Label any bridge to browser code as browser replacement or project convention.
