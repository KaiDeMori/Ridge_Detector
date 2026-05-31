---
description: "Use when: deciding the EDT parity and browser replacement strategy for medial-axis porting."
name: "Medial Axis EDT Strategy Decider"
argument-hint: "Optional: strict parity or browser performance preference"
agent: "agent"
---

# Medial Axis EDT Strategy Decider

## Task

Decide how the Euclidean distance transform should be specified for the browser port.

Use these inputs:

- `../shared/medial_axis_orientation.md`
- `../shared/result_contract.md`
- `../results/01_source_facts/source_fact_table.md`
- `../results/02_behavior_oracles/test_oracle_design.md`, if present
- `../results/03_implementation_semantics/implementation_semantics.md`, if present

Write the result to:

- `../results/04_EDT_strategy/EDT_strategy.md`

## Scope

Separate strict scikit/SciPy parity from browser-compatible replacement choices. The goal is a clear decision record that the final spec can use without blending implementation sources.

## Required Decisions

Cover these decisions:

- whether the final project needs strict SciPy EDT parity or exact-distance ordering parity
- whether squared distances are sufficient for thinning order
- how to handle images with no in-bounds background pixels
- whether texture edges count as outside by project convention
- whether zero padding is required before EDT
- whether the browser port uses Felzenszwalb-Huttenlocher, Maurer-style feature transform, brute force for tiny masks, or another exact EDT
- which numeric type is recommended for browser arrays
- which behavior oracle fixtures should validate the chosen strategy

## Output Format

Use this structure:

```markdown
# EDT Strategy

## Scope

## Inputs Used

## Result

### Source Behavior

### Browser Strategy

### Boundary Convention

### Numeric Representation

### Validation Fixtures

### Decision Matrix

| Decision | Choice | Category | Reason |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

## Open Questions
```
