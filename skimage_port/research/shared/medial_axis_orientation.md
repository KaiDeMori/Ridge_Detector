# Medial Axis Orientation

Use this file as shared context for every prompt in this workflow.

## Version Targets

- scikit-image: v0.24.0
- SciPy: v1.14.0
- NumPy behavior: use the behavior implied by scikit-image v0.24.0 and its dependencies

## Source Priority

Use the exact source implementation as the highest-priority reference for behavior.

- scikit-image `skimage/morphology/_skeletonize.py`: top-level `medial_axis` workflow, lookup table construction, cornerness, ordering
- scikit-image `skimage/morphology/_skeletonize_cy.pyx`: ordered thinning loop and table lookup index behavior
- SciPy `scipy/ndimage/_morphology.py`: public `distance_transform_edt` behavior
- SciPy `scipy/ndimage/src/ni_morphology.c`: exact Euclidean feature transform implementation details
- scikit-image docs: conceptual explanation and public examples
- distance transform papers: useful background for browser-compatible EDT choices

## Classification Labels

Use these labels in every result:

- **scikit parity**: behavior directly required by the versioned scikit-image/SciPy implementation
- **browser replacement**: a substitute that preserves required behavior for the browser port
- **project convention**: a deliberate project choice beyond byte-for-byte scikit-image behavior
- **open question**: a decision that still needs confirmation

## Details To Keep Visible

- `medial_axis` is distinct from `skeletonize` and `thin`.
- The medial-axis thinning pass uses a 512-entry keep table.
- The 3x3 bit layout is:

```text
bit 0  bit 1  bit 2
bit 3  bit 4  bit 5
bit 6  bit 7  bit 8
```

- The Cython thinning loop starts each neighborhood index with center bit `16` already set.
- The eight neighbor bits are read from the mutable `result` image.
- The thinning loop writes `result[ii, jj] = table[accumulator]`.
- The ordered thinning pass is a single pass over the original foreground pixel list.
- Out-of-bounds neighbors contribute `0` for table lookup, cornerness, and thinning.
- `distance_transform_edt` computes distance to zero-valued background pixels in its input array.
- Treating texture edges as outside is a project convention unless the input is explicitly zero-padded.
- `np.lexsort((tiebreaker, corner_score, distance))` makes `distance` the primary key, `corner_score` the secondary key, and `tiebreaker` the tertiary key.
- The tiebreaker is a permutation of unique integers assigned to foreground pixels.
- Rectangle outputs are discrete scikit-image ridges and can include diagonal or boundary-adjacent end pixels.
- The project output term is `ridge` or `ridge mask`.
