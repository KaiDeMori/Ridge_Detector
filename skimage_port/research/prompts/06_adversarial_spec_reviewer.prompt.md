---
description: "Use when: reviewing the medial ridge spec against source facts and oracle fixtures."
name: "Medial Ridge Adversarial Spec Reviewer"
argument-hint: "Optional: review focus such as EDT, ordering, or boundary behavior"
agent: "agent"
---

# Medial Ridge Adversarial Spec Reviewer

## Task

Review the final ridge spec against the staged artifacts. Find mismatches, missing details, and places where categories are blended.

Use these inputs:

- `../shared/medial_axis_orientation.md`
- `../shared/result_contract.md`
- `../results/01_source_facts/source_fact_table.md`
- `../results/02_behavior_oracles/test_oracle_design.md`
- `../results/03_implementation_semantics/implementation_semantics.md`
- `../results/04_EDT_strategy/EDT_strategy.md`
- `../results/05_final_spec/medial_ridge_spec.md`

Write the result to:

- `../results/06_review/spec_review.md`

## Scope

Use a code-review stance. Lead with findings that would cause an implementation to diverge from scikit-image behavior or from the declared browser/project decisions.

## Review Checklist

Check these areas:

- source-version consistency
- category labels: scikit parity, browser replacement, project convention, open question
- distinction from `skeletonize` and `thin`
- 512-entry keep table semantics
- 3x3 bit layout
- center bit forced to `16` in the thinning pass
- mutable neighbor reads from `result`
- single ordered thinning pass
- table lookup and cornerness boundary behavior
- EDT source behavior and selected browser strategy
- image-edge convention
- `np.lexsort` key priority
- unique permutation tiebreaker
- fixture coverage
- ridge terminology
- claims about rectangle, circle, and disconnected-component behavior

## Output Format

Use this structure:

```markdown
# Spec Review

## Scope

## Inputs Used

## Findings

| Severity | Finding | Evidence | Suggested Resolution |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

## Acceptance Checklist

- [ ] Source behavior is traceable
- [ ] Browser replacements are labeled
- [ ] Project conventions are labeled
- [ ] Oracle fixtures are represented
- [ ] Open questions are explicit

## Open Questions
```

Use severity labels `blocking`, `important`, and `minor`.
