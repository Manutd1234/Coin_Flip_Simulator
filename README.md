# Coin Flip Simulator

A focused probability and simulation project that compares computation with theory.

The app can:

- Simulate a single run of 10,000 fair coin flips.
- Repeat that experiment with configurable Monte Carlo trials.
- Plot the distribution of heads across repeated experiments.
- Calculate the exact binomial probability of exceeding a chosen threshold.
- Compare the exact result with the continuity-corrected central limit theorem.
- Show the Monte Carlo estimate and its 95% uncertainty interval.

For the default question, `P(X > 5200)` is calculated exactly as:

```text
0.000030294608814
```

## Run

```bash
python3 app.py
```

Open `http://127.0.0.1:8765` in a browser.

The simulator uses only Python's standard library and browser JavaScript. No API keys or external services are required.
