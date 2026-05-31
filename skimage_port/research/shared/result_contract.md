# Result Contract

Each step writes one artifact into its matching result folder. Later prompts should use prior artifacts as inputs.

## Artifact Paths

- `results/01_source_facts/source_fact_table.md`
- `results/02_behavior_oracles/test_oracle_design.md`
- `results/03_implementation_semantics/implementation_semantics.md`
- `results/04_EDT_strategy/EDT_strategy.md`
- `results/05_final_spec/medial_ridge_spec.md`
- `results/06_review/spec_review.md`

## Common Sections

Every result should include these sections:

- `# Title`
- `## Scope`
- `## Inputs Used`
- `## Result`
- `## Open Questions`

Use `Open Questions` only for genuine unresolved decisions.

## Fact Categories

Classify relevant claims as:

- **scikit parity**
- **browser replacement**
- **project convention**
- **open question**

## Handoff Standard

A later agent should be able to use the artifact without rereading the whole source history. Include enough detail to preserve exact behavior, especially ordering, boundary conventions, data normalization, and tie breaking.
