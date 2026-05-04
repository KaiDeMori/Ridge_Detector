---
description: "Use when: extracting exact source facts for a scikit-image medial_axis JavaScript/browser port."
name: "Medial Axis Source Fact Extractor"
argument-hint: "Optional: extra version notes or specific facts to inspect"
agent: "agent"
---

# Medial Axis Source Fact Extractor

## Task

Extract exact behavioral facts needed to port `skimage.morphology.medial_axis` from scikit-image v0.24.0 into JavaScript/browser code.

Use the shared orientation first:

- `../shared/medial_axis_orientation.md`
- `../shared/result_contract.md`

Write the result to:

- `../results/01_source_facts/source_fact_table.md`

## Source Targets

Use exact versioned online sources:

- scikit-image v0.24.0 `skimage/morphology/_skeletonize.py`
- scikit-image v0.24.0 `skimage/morphology/_skeletonize_cy.pyx`
- SciPy v1.14.0 `scipy/ndimage/_morphology.py`
- SciPy v1.14.0 `scipy/ndimage/src/ni_morphology.c`
- scikit-image v0.24.0 API docs for `medial_axis`
- SciPy v1.14.0 API docs for `distance_transform_edt`

## Scope

Stay in fact extraction mode. Record what the source says and why it matters for a JavaScript port. Keep broader interpretation for later prompts.

## Required Facts

Cover these facts explicitly:

- version target and exact source files used
- input binary conversion and mask behavior
- 512-entry table construction
- 3x3 bit layout
- keep-table meaning
- 8-connectivity component counting in the table
- `cornerness_table` construction
- `_table_lookup` and `_table_lookup_index` boundary behavior
- `distance_transform_edt` call site and return value use
- foreground pixel extraction order
- `np.lexsort` key priority
- random tiebreaker construction
- `_skeletonize_loop` center-bit handling
- `_skeletonize_loop` mutable neighbor reads
- `_skeletonize_loop` assignment behavior
- result conversion and `return_distance` behavior
- any distinction between scikit parity and browser replacement choices

## Output Format

Use this structure:

```markdown
# Source Fact Table

## Scope

## Inputs Used

## Result

| Fact | Source | Category | JavaScript Port Consequence |
| --- | --- | --- | --- |
| ... | ... | scikit parity | ... |

## Open Questions
```

Use the categories from `../shared/result_contract.md`.
