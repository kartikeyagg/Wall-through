# Simulator evaluation baseline (S0)

Run the deterministic headless trial harness from `simulator/`:

```sh
npm run trials -- --seeds 10 --seconds 60
npm run trials -- --seeds 10 --seconds 60 --scenario outdoor
npm run trials -- --seeds 10 --seconds 60 --json
npm run bench
```

The runner advances the world and camera pipeline at 60 Hz with 10 officers and 3 targets. Seeds change sensor noise; target motion stays reproducible. The benchmark advances 3,600 ticks with 10 officers and 4 thrown pucks, skips the first 60 timings, and fails if mean tick time exceeds 3 ms or p99 exceeds 5 ms. Timings depend on the machine; the accuracy baseline below is deterministic.

| Metric | Indoor hall | Outdoor ground, GPS off |
| --- | ---: | ---: |
| GOSPA, mean (m; 10 m cutoff) | 3.733 | 0.771 |
| Officer localization RMSE (m) | 0.042 | 4.999 |
| Overlay foot-position registration RMSE (m) | 0.754 | 0.909 |
| Track data age, mean (ms) | 53.029 | 22.533 |
| Wrong clearance fraction | 0 | 0 |
| Uncleared bystander fraction | 1 | 1 |

Each row is the mean of 10 seeds run for 60 simulated seconds. GOSPA uses optimal spatial assignment, a 10 m cutoff, p=2, and α=2; it penalizes missed and extra tracks. The overlay metric compares the visible ankle midpoint with the simulated person's ground position. Clearance fractions reflect the no-operator baseline: the headless runner never clears a track, so every bystander stays flagged. Later phases can replace the clearance policy and compare its errors against this baseline.

`simulator/params/localization.json` holds the existing localization values and a source for each. All 11 are marked as guesses because they have not been calibrated against hardware. `SelfLocalization` loads these values as defaults, while callers may override individual values. The UI flags the guess count; future measured files should replace the guesses with trial IDs or source links.
