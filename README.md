# Ridge Detector

![Example Stencil](docs/Example_Stencil.png) -> ![Example Ridges](docs/Example_Ridges.png)

Detect central inner ridges (medial structures) of arbitrary 2D shapes.

This repository is centered on a JavaScript re-implementation of scikit-image's `medial_axis` method, extended with additional project logic that removes low-radius corner branches.

In short: the pipeline first computes a scikit-style medial ridge, optionally rounds sharp corners, then applies a pruning step to remove branch fans that tend to appear near sharp corners.

The project focuses on extracting stable center-like lines from masks and silhouettes. A primary use case is building footprints in 3D games, where inner ridges can drive roof skeletons, corridor spines, support placement, or stylized architectural detail.

The project is not intended as production-ready software out of the box. It is a strong reference and experimentation base that can be adapted to specific pipelines and constraints.

## Repository Structure

This repo holds **two distinct detectors**, kept deliberately separate because they have different goals:

```
skimage_port/   The faithful port — contributions/fixes belong here
enhanced/       The real product — battle-tested, with a demo
docs/           Example images
```

### `skimage_port/` — faithful re-creation

- A close JavaScript port of scikit-image's `medial_axis` plus the paper-based thinning/pruning logic.
- Goal: stay true to the source algorithms; fully documented research workflow lives in `skimage_port/research/`.
- Known limitation: struggles on "spiky" / sharp-cornered shapes (this is where the original algorithm itself falls short — so this is the place to contribute improvements to the faithful port).
- Entry file: `skimage_port/medial_ridge_detector_skimage_port.js`. Browser tests/visualizer in `skimage_port/tests/`.

### `enhanced/` — the detector we actually use

- A re-interpretation, not a port: adds checkerboard thinning, corner smoothing (auto-radius morphological open/close) and a clean config-object API.
- Battle-tested on the wildest shapes the faithful port can't handle, with tuned default settings that produce great results.
- Entry file: `enhanced/medial_ridge_detector_enhanced.js`. The interactive step-by-step demo lives in `enhanced/demo/` (the demo is just a consumer of the algorithm).

## Example Use Cases

- Building footprints to roof ridge guides and roof mesh scaffolds.
- Centerline extraction for roads, paths, and rivers from painted map regions.
- AI lane generation inside irregular gameplay zones.
- Procedural dungeon and cave "inner spine" generation.
- Shape-aware anchor lines for VFX placement (cracks, veins, energy conduits).
- Region skeletons for strategy-map territories and influence overlays.

## Quick Start

1. Open `enhanced/demo/index.html` to load sample textures quickly.
2. Open `enhanced/demo/medial_ridge_visualizer.html` for the full step-by-step view.
3. Adjust settings and recompute to inspect behavior.

If your browser blocks local file access, run a lightweight local static server from the repository root, then open the same pages through `http://localhost`.

## Which Detector Should I Use?

- Use `enhanced/` for results — it's the tuned, battle-tested detector and what the demo runs.
- Use `skimage_port/` when you want a faithful, traceable re-creation of the scikit-image / paper algorithms, or when contributing fixes to the canonical port.

## Notes

- The implementation emphasizes clarity and inspectability over performance tuning.
- Default settings are stable for many shapes, but edge-case behavior should be validated for your specific content.
- The visualizer is intentionally detailed so it can serve both as a reference and as a practical tuning tool.

## References

- In-repo source resources:
  - `skimage_port/research/resources/_skeletonize.py` (scikit-image reference implementation details)
  - `skimage_port/research/resources/_skeletonize_cy.pyx` (ordered thinning loop details)
  - `skimage_port/research/resources/_morphology.py` (SciPy distance transform API behavior)
  - `skimage_port/research/resources/ni_morphology.c` (SciPy exact Euclidean feature transform implementation)
- scikit-image example page (medial axis and skeletonization): https://scikit-image.org/docs/stable/auto_examples/edges/plot_skeleton.html
- [Lee94] T.-C. Lee, R.L. Kashyap and C.-N. Chu, Building skeleton models via 3-D medial surface/axis thinning algorithms. Computer Vision, Graphics, and Image Processing, 56(6):462-478, 1994.
- [Zha84] A fast parallel algorithm for thinning digital patterns, T. Y. Zhang and C. Y. Suen, Communications of the ACM, March 1984, Volume 27, Number 3.