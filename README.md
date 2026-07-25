# Football Analytics Lab

The dashboard now includes a third `Coin Flip Lab` project. It simulates a 10,000-flip experiment, builds a repeated-experiment distribution, calculates the exact binomial probability of exceeding 5,200 heads to 15 decimal places, compares it with a continuity-corrected central limit theorem approximation, and verifies it with Monte Carlo simulation.

This is a three-tab local dashboard for the football projects plus a probability and simulation lab:

- **Player Performance**: Transfermarkt-style player profile, per-90 metrics, KMeans-style playing-style clusters, comparison charts, and a player table.
- **World Cup Sentiment**: X/Twitter query input, Hugging Face Transformers sentiment path, event annotations, post volume, and a likes-versus-time scatter plot.
- **Coin Flip Lab**: 10,000-flip simulation, exact binomial tail probability, continuity-corrected CLT comparison, Monte Carlo verification, and a 95% uncertainty interval for rare-event estimates.

The app runs immediately with demo data. When credentials and packages are available, it switches into real API/model paths.

## Run

```bash
python3 app.py
```

Open:

```text
http://127.0.0.1:8765
```

## Keys

Copy `.env.example` to `.env`, then paste your private keys:

```bash
cp .env.example .env
```

Important keys:

- `X_BEARER_TOKEN`: X API v2 bearer token for recent search.
- `HF_TOKEN`: optional Hugging Face token for model downloads.
- `KAGGLE_USERNAME` and `KAGGLE_KEY`: optional Kaggle credentials.
- `PLAYER_DATA_DIR`: local folder containing Transfermarkt CSVs.

The app never hardcodes API keys. It reads them from `.env` or your shell environment.

## Real Player Data

Download the Kaggle Transfermarkt dataset and place these files in `data/transfermarkt/`:

- `players.csv`
- `appearances.csv`
- optional supporting CSVs such as `games.csv`, `clubs.csv`, and `competitions.csv`

On restart, the app automatically uses the CSVs instead of demo players. If `players.csv` includes `image_url`, those real player photos are shown in the dashboard; otherwise the app generates a local face portrait for each player.

## Transformers Sentiment

Install the optional stack when you want local model inference:

```bash
python3 -m pip install -r requirements.txt
```

The default model is:

```text
cardiffnlp/twitter-roberta-base-sentiment-latest
```

If Transformers or a model backend is unavailable, the dashboard keeps running with a lexicon fallback and shows the fallback reason in the UI.
