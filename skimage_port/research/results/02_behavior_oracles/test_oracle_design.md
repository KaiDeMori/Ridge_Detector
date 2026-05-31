# Test Oracle Design

## Scope

This artifact defines the test and oracle strategy for a JavaScript/browser port of `skimage.morphology.medial_axis`.

The focus is source translation first. Golden outputs from a live scikit-image runtime are useful as a later calibration layer, but the tests below can be designed from the extracted source facts immediately.

## Inputs Used

- `../01_source_facts/source_fact_table.md`
- `../../shared/medial_axis_orientation.md`
- `../../shared/result_contract.md`

## Result

## Test Groups

### Source-Contract Tests

These tests verify source mechanics directly, usually with small handcrafted arrays and synthetic inputs.

- Input normalization: nonzero stencil values become `1`, zero values become `0`.
- Output promotion: binary ridge values become `255`, non-ridge values become `0` as a project output-format step.
- Optional mask behavior: if mask support is implemented, pixels outside the mask are excluded before EDT and thinning.

### 3x3 Bit-Layout Tests

These tests protect the shared bit layout:

```text
bit 0  bit 1  bit 2
bit 3  bit 4  bit 5
bit 6  bit 7  bit 8
```

Representative checks:

- A pattern with only the center foreground packs as `16`.
- A full 3x3 foreground pattern packs as `511`.
- A top-left plus center pattern packs as `17`.
- A right-neighbor plus center pattern packs as `48`.
- Boundary packing contributes only in-bounds foreground bits.

### Keep-Table Tests

These tests validate the 512-entry LUT semantics.

Representative patterns:

- Center bit clear gives keep value `0`.
- Isolated center foreground gives keep value `1` because foreground count is less than `3`.
- Center plus one neighbor gives keep value `1` because foreground count is less than `3`.
- Full 3x3 foreground gives keep value `0` because clearing the center keeps one connected component and foreground count is `9`.
- Center plus four diagonal corner pixels gives keep value `1` because clearing the center changes connectivity.

### Component-Count Tests

These tests verify 8-connectivity inside the 3x3 pattern.

Representative checks:

- Diagonal foreground cells are connected under 8-connectivity.
- Orthogonal foreground cells are connected.
- Separated corners without a connecting center form separate components.
- Clearing bit 4 can change the component count for patterns where the center bridges neighbors.

### Cornerness Tests

These tests verify `cornerness = 9 - foreground_count` under the same 3x3 lookup convention.

Representative checks:

- Full 3x3 foreground has cornerness `0`.
- Isolated center foreground has cornerness `8`.
- Center plus one neighbor has cornerness `7`.
- A foreground pixel at the image border counts out-of-bounds cells as background.

### Processing-Order Tests

These tests can use synthetic distance and cornerness arrays, which keeps them independent from EDT implementation details.

Representative checks:

- Lower distance sorts earlier.
- Equal distance sorts by lower cornerness earlier.
- Equal distance and cornerness sorts by lower unique tiebreaker earlier.
- Tiebreaker values are a permutation of unique integers.
- Foreground extraction order determines which pixel receives which tiebreaker value.

### Ordered-Thinning Loop Tests

These tests verify the Cython loop translation.

Representative checks:

- The center bit is forced by starting the neighborhood index at `16`.
- Neighbor bits are read from the mutable `result` image.
- Out-of-bounds neighbors contribute `0`.
- The current pixel is assigned directly from `keep_lut[neighborhood_index]`.
- Earlier ordered writes are visible to later ordered pixels.

### EDT Strategy Tests

These tests become concrete after step 04 decides the browser EDT strategy.

Candidate checks:

- Background pixels have distance `0`.
- Foreground pixels sort correctly by exact Euclidean squared distance.
- Squared distances preserve the same processing order as true distances.
- The chosen texture-edge convention is explicit and tested.
- All-foreground behavior is either supported by a declared convention or handled by a clear precondition.

### Integration Behavior Tests

These tests run the full ridge pipeline once the implementation exists.

Candidate shapes:

- isolated foreground pixel
- two adjacent foreground pixels
- diagonal foreground connection
- filled `3x3` square with surrounding background
- filled `5x3` rectangle with surrounding background
- filled `5x5` square with surrounding background
- rectangle touching image edge
- two disconnected components
- shape with a hole
- tie-heavy ring or symmetric shape
- no foreground pixels
- all-foreground image under the chosen EDT convention

## Fixture Candidates

### Isolated Pixel

Purpose: protects the foreground-count rule for tiny components.

```text
0 0 0
0 1 0
0 0 0
```

Expected style: the isolated foreground pixel survives.

### Full 3x3 Square In 5x5 Background

Purpose: protects EDT ordering, keep table, and center survival behavior.

```text
0 0 0 0 0
0 1 1 1 0
0 1 1 1 0
0 1 1 1 0
0 0 0 0 0
```

Expected style: use golden oracle output when available; source-contract tests still validate the LUT and thinning mechanics.

### 5x3 Rectangle In 7x7 Background

Purpose: protects the documented discrete rectangle behavior and prevents a pure geometric-centerline assumption.

```text
0 0 0 0 0 0 0
0 0 1 1 1 0 0
0 0 1 1 1 0 0
0 0 1 1 1 0 0
0 0 1 1 1 0 0
0 0 1 1 1 0 0
0 0 0 0 0 0 0
```

Expected style: compare against a pinned golden oracle output once available.

### Two Disconnected Components

Purpose: protects independent ridge survival in disconnected foreground regions.

```text
0 0 0 0 0 0 0 0 0
0 1 1 1 0 0 0 0 0
0 1 1 1 0 0 1 1 0
0 1 1 1 0 0 1 1 0
0 0 0 0 0 0 1 1 0
0 0 0 0 0 0 1 1 0
0 0 0 0 0 0 0 0 0
```

Expected style: each disconnected component keeps its own ridge under the same global foreground order.

### Ring With Ties

Purpose: protects random-permutation tie breaking and symmetric-distance behavior.

```text
0 0 0 0 0 0 0
0 1 1 1 1 1 0
0 1 1 1 1 1 0
0 1 1 0 1 1 0
0 1 1 1 1 1 0
0 1 1 1 1 1 0
0 0 0 0 0 0 0
```

Expected style: compare outputs under more than one seed once a golden oracle runtime is available.

## Golden Oracle Plan

When a pinned Python reference environment is available, generate golden output arrays for the integration fixture candidates.

Record:

- scikit-image version
- SciPy version
- NumPy version
- fixture input mask
- `rng` value
- boolean ridge output
- distance output for EDT-sensitive edge cases

Recommended seeds:

- `rng=0` for baseline fixtures
- `rng=1` for tie-heavy fixtures
- one additional seed for any fixture where symmetric ties change the ridge

The golden outputs should supplement the source-contract tests. They are most valuable for full-pipeline regression checks and for catching translation mismatches that source-level unit tests did not isolate.

## Acceptance Checks

| Test | Type | Protects | Expected Source |
| --- | --- | --- | --- |
| Normalize stencil to binary foreground | unit source-contract test | `0` versus nonzero input convention | scikit-image `image.astype(bool)` |
| Pack center-only 3x3 as `16` | unit source-contract test | bit layout and center position | `_pattern_of`, `_table_lookup_index` |
| Center-clear LUT entry returns `0` | unit source-contract test | keep-table center condition | `center_is_foreground` table condition |
| Full 3x3 LUT entry returns `0` | unit source-contract test | removable center semantics | table component-count and foreground-count rules |
| Center plus diagonal corners returns keep `1` | unit source-contract test | 8-connectivity bridge behavior | `ndi.label(..., _eight_connect)` |
| Full 3x3 cornerness is `0` | unit source-contract test | cornerness table | `9 - np.sum(_pattern_of(index))` |
| Isolated center cornerness is `8` | unit source-contract test | cornerness table | `9 - np.sum(_pattern_of(index))` |
| Sort by distance, then cornerness, then tie value | unit source-contract test | `np.lexsort` translation | `np.lexsort((tiebreaker, corner_score, distance))` |
| Tiebreaker has unique integer values | unit source-contract test | row-order bias control | `generator.permutation(np.arange(masked_image.sum()))` |
| Thinning loop starts with center bit `16` | unit source-contract test | Cython accumulator behavior | `_skeletonize_loop` |
| Thinning loop reads mutable neighbors | unit source-contract test | one-pass thinning state | `_skeletonize_loop` |
| Boundary neighbor contributes `0` | unit source-contract test | 3x3 out-of-bounds behavior | `_table_lookup_index`, `_skeletonize_loop` |
| Rectangle fixture matches golden output | golden oracle test | full-pipeline behavior | future pinned scikit-image run |
| Tie-heavy fixture matches selected seed output | golden oracle test | tiebreaker behavior | future pinned scikit-image run |
| Texture-edge convention is tested | project convention test | project EDT behavior | step 04 decision |

## Open Questions

## Test Runner
Which JavaScript test runner or browser harness should host these tests?

**Answer**: 

## Golden Oracle Runtime
Should golden outputs be generated from a local pinned Python environment, an external reference machine, or checked in from a trusted prior run?

**Answer**: 

## Mask Support
Should the browser port include `mask` behavior from scikit-image, or should the final spec mark mask support outside the project scope?

**Answer**: 

## Exact RNG Parity
Should deterministic browser output use a project PRNG, or should it aim for NumPy PCG64-compatible permutation output?

**Answer**: 
