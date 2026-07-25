from __future__ import annotations

import csv
import hashlib
import html
import importlib.util
import json
import math
import os
import random
import re
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
HOST = os.getenv("DASHBOARD_HOST", "127.0.0.1")
PORT = int(os.getenv("DASHBOARD_PORT", "8765"))
DEFAULT_QUERY = '("Team A" OR "Team B" OR #WorldCup) lang:en -is:retweet'
DEFAULT_MODEL = "cardiffnlp/twitter-roberta-base-sentiment-latest"
DEFAULT_PLAYER_DIR = ROOT / "data" / "transfermarkt"


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


load_env_file(ROOT / ".env")


@dataclass(frozen=True)
class PlayerProfile:
    name: str
    club: str
    league: str
    position: str
    age: int
    minutes: int
    goals: int
    assists: int
    cards: int
    market_value_m: float


POSITIONS = ["Forward", "Winger", "Attacking Mid", "Central Mid", "Defensive Mid", "Fullback", "Center Back"]
CLUBS = [
    ("Manchester City", "Premier League"),
    ("Real Madrid", "LaLiga"),
    ("Bayern Munich", "Bundesliga"),
    ("Inter", "Serie A"),
    ("PSG", "Ligue 1"),
    ("Benfica", "Primeira Liga"),
    ("LA Galaxy", "MLS"),
    ("Ajax", "Eredivisie"),
]
PLAYER_NAMES = [
    "Landon Donovan",
    "Mikael Torres",
    "Noah Adeyemi",
    "Rafael Silva",
    "Jonas Keller",
    "Mateo Aranda",
    "Owen Fletcher",
    "Theo Marchand",
    "Luis Nascimento",
    "Samir Haddad",
    "Nico Vogel",
    "Arjun Mehta",
    "Diego Salazar",
    "Evan Brooks",
    "Youssef Amrani",
    "Kai Nakamura",
    "Luca Bianchi",
    "Ethan Reed",
    "Marcos Duarte",
    "Julien Moreau",
    "Tomas Novak",
    "Andre Costa",
    "Mateusz Zielinski",
    "Hugo Pereira",
    "Sebastian Ruiz",
    "Malik Johnson",
    "Felix Hartmann",
    "Ismael Diop",
    "Victor Santos",
    "Adam Clarke",
]


def dependency_available(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def safe_int(value: object, default: int = 0) -> int:
    try:
        if value in ("", None):
            return default
        return int(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return default


def safe_float(value: object, default: float = 0.0) -> float:
    try:
        if value in ("", None):
            return default
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        return default


def per_90(value: float, minutes: float) -> float:
    return round((value / minutes) * 90, 2) if minutes else 0.0


def local_face_url(name: str, position: str = "") -> str:
    return f"/api/player-face?{urllib.parse.urlencode({'name': name, 'position': position})}"


def player_face_svg(name: str, position: str) -> bytes:
    digest = hashlib.sha256(f"{name}|{position}".encode("utf-8")).digest()
    palettes = [
        ("#f1c7a8", "#1e344f", "#143d59"),
        ("#d8a06f", "#2d263f", "#8a2432"),
        ("#b87852", "#1b4b50", "#174a33"),
        ("#e0b38f", "#2c2f3a", "#1f5f9b"),
        ("#8f5738", "#192233", "#633c93"),
        ("#c68a61", "#233524", "#b76523"),
    ]
    skin, hair, shirt = palettes[digest[0] % len(palettes)]
    hair_y = 44 + digest[1] % 10
    eye_gap = 17 + digest[2] % 5
    mouth_curve = 72 + digest[3] % 8
    initials = "".join(part[:1] for part in name.split()[:2]).upper() or "P"
    label = html.escape(initials)
    safe_name = html.escape(name)
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="220" height="260" viewBox="0 0 220 260" role="img" aria-label="{safe_name} face">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e7edf5"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="220" height="260" rx="16" fill="url(#bg)"/>
  <path d="M38 250c7-49 37-76 72-76s65 27 72 76z" fill="{shirt}"/>
  <circle cx="110" cy="104" r="58" fill="{skin}"/>
  <path d="M55 {hair_y}c18-33 83-48 119 5 4 19 0 35-8 47-10-29-34-37-58-37-25 0-44 9-61 36-5-17-3-34 8-51z" fill="{hair}"/>
  <circle cx="{110 - eye_gap}" cy="104" r="5" fill="#17202f"/>
  <circle cx="{110 + eye_gap}" cy="104" r="5" fill="#17202f"/>
  <path d="M99 126c7 4 15 4 22 0" stroke="#9b654a" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M88 {mouth_curve}c13 14 31 14 44 0" transform="translate(0 70)" stroke="#7a3f36" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="110" cy="205" r="25" fill="rgba(255,255,255,.18)"/>
  <text x="110" y="214" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="800" fill="#ffffff">{label}</text>
</svg>"""
    return svg.encode("utf-8")


def add_cluster_fields(rows: list[dict]) -> list[dict]:
    if not rows:
        return rows
    feature_rows = []
    for row in rows:
        row["goals_per_90"] = per_90(row["goals"], row["minutes"])
        row["assists_per_90"] = per_90(row["assists"], row["minutes"])
        row["cards_per_90"] = per_90(row["cards"], row["minutes"])
        row["contributions"] = row["goals"] + row["assists"]
        row["minutes_per_match"] = round(row["minutes"] / max(1, row.get("appearances", 34)), 1)
        feature_rows.append(
            [
                row["goals_per_90"],
                row["assists_per_90"],
                row["cards_per_90"],
                row["minutes_per_match"],
                row["market_value_m"],
            ]
        )

    clusters = kmeans(feature_rows, k=min(4, max(1, len(feature_rows))), seed=8)
    labels = describe_clusters(rows, clusters)
    random.seed(100)
    for row, cluster in zip(rows, clusters):
        row["cluster"] = cluster
        row["style"] = labels[cluster]
        row["x"] = round(row["goals_per_90"] * 100 + row["assists_per_90"] * 32 + random.uniform(-8, 8), 1)
        row["y"] = round(row["assists_per_90"] * 100 - row["cards_per_90"] * 20 + row["minutes_per_match"] / 4, 1)
    return rows


def make_demo_players() -> list[dict]:
    random.seed(42)
    players: list[PlayerProfile] = []
    for idx, name in enumerate(PLAYER_NAMES):
        position = POSITIONS[idx % len(POSITIONS)]
        club, league = CLUBS[idx % len(CLUBS)]
        age = random.randint(18, 34)
        minutes = random.randint(720, 3350)

        if position in {"Forward", "Winger"}:
            goals = random.randint(9, 31)
            assists = random.randint(3, 16)
            cards = random.randint(1, 7)
        elif position in {"Attacking Mid", "Central Mid"}:
            goals = random.randint(3, 14)
            assists = random.randint(6, 20)
            cards = random.randint(2, 9)
        elif position == "Defensive Mid":
            goals = random.randint(0, 6)
            assists = random.randint(2, 10)
            cards = random.randint(6, 15)
        else:
            goals = random.randint(0, 5)
            assists = random.randint(1, 8)
            cards = random.randint(4, 14)

        contribution = goals + assists
        value = max(1.8, contribution * random.uniform(2.8, 5.4) + minutes / 260 + random.uniform(-8, 12))
        players.append(
            PlayerProfile(
                name=name,
                club=club,
                league=league,
                position=position,
                age=age,
                minutes=minutes,
                goals=goals,
                assists=assists,
                cards=cards,
                market_value_m=round(value, 1),
            )
        )

    rows = []
    for player in players:
        row = player.__dict__.copy()
        row["appearances"] = random.randint(26, 42)
        row["source"] = "demo"
        row["image_url"] = local_face_url(row["name"], row["position"])
        row["fallback_image_url"] = row["image_url"]
        rows.append(row)
    return add_cluster_fields(rows)


def read_csv(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def player_name(row: dict) -> str:
    if row.get("name"):
        return row["name"]
    first = row.get("first_name", "")
    last = row.get("last_name", "")
    joined = f"{first} {last}".strip()
    return joined or row.get("player_name", "Unknown Player")


def load_transfermarkt_players() -> tuple[list[dict], str]:
    data_dir = Path(os.getenv("PLAYER_DATA_DIR", str(DEFAULT_PLAYER_DIR))).expanduser()
    players_path = data_dir / "players.csv"
    appearances_path = data_dir / "appearances.csv"
    if not players_path.exists() or not appearances_path.exists():
        return make_demo_players(), "Demo player data"

    players = {row.get("player_id"): row for row in read_csv(players_path) if row.get("player_id")}
    appearances: dict[str, dict] = {}
    for row in read_csv(appearances_path):
        player_id = row.get("player_id")
        if not player_id:
            continue
        bucket = appearances.setdefault(
            player_id,
            {"minutes": 0, "goals": 0, "assists": 0, "cards": 0, "appearances": 0},
        )
        bucket["minutes"] += safe_int(row.get("minutes_played"))
        bucket["goals"] += safe_int(row.get("goals"))
        bucket["assists"] += safe_int(row.get("assists"))
        bucket["cards"] += safe_int(row.get("yellow_cards")) + safe_int(row.get("red_cards")) * 2
        bucket["appearances"] += 1

    rows = []
    for player_id, stats in appearances.items():
        player = players.get(player_id, {})
        if stats["minutes"] < safe_int(os.getenv("MIN_PLAYER_MINUTES", "450")):
            continue
        dob = player.get("date_of_birth") or ""
        age = estimate_age(dob)
        value = safe_float(player.get("market_value_in_eur")) / 1_000_000
        if value <= 0:
            value = safe_float(player.get("highest_market_value_in_eur")) / 1_000_000
        rows.append(
            {
                "name": player_name(player) if player else f"Player {player_id}",
                "club": player.get("current_club_name") or "Unknown Club",
                "league": player.get("current_club_domestic_competition_id") or "Transfermarkt",
                "position": player.get("sub_position") or player.get("position") or "Unknown",
                "age": age,
                "minutes": stats["minutes"],
                "goals": stats["goals"],
                "assists": stats["assists"],
                "cards": stats["cards"],
                "appearances": stats["appearances"],
                "market_value_m": round(value, 1),
                "image_url": player.get("image_url") or local_face_url(player_name(player), player.get("position", "")),
                "fallback_image_url": local_face_url(player_name(player), player.get("position", "")),
                "source": "transfermarkt_csv",
            }
        )

    if len(rows) < 4:
        return make_demo_players(), "Demo player data"
    rows = sorted(rows, key=lambda item: item["minutes"], reverse=True)[: int(os.getenv("MAX_PLAYERS", "180"))]
    return add_cluster_fields(rows), f"Transfermarkt CSVs from {data_dir}"


def estimate_age(date_text: str) -> int:
    if not date_text:
        return 0
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%m/%d/%Y"):
        try:
            born = datetime.strptime(date_text[:10], fmt)
            now = datetime.now()
            return now.year - born.year - ((now.month, now.day) < (born.month, born.day))
        except ValueError:
            continue
    return 0


def zscore_columns(rows: list[list[float]]) -> list[list[float]]:
    columns = list(zip(*rows))
    means = [statistics.mean(col) for col in columns]
    stdevs = [statistics.pstdev(col) or 1.0 for col in columns]
    return [[(value - means[idx]) / stdevs[idx] for idx, value in enumerate(row)] for row in rows]


def kmeans(rows: list[list[float]], k: int, seed: int, iterations: int = 40) -> list[int]:
    if not rows:
        return []
    scaled = zscore_columns(rows)
    random.seed(seed)
    centers = random.sample(scaled, k)
    labels = [0] * len(rows)

    for _ in range(iterations):
        changed = False
        for row_idx, row in enumerate(scaled):
            distances = [sum((value - center[idx]) ** 2 for idx, value in enumerate(row)) for center in centers]
            label = distances.index(min(distances))
            if label != labels[row_idx]:
                changed = True
                labels[row_idx] = label

        new_centers = []
        for cluster_idx in range(k):
            members = [row for row, label in zip(scaled, labels) if label == cluster_idx]
            if not members:
                new_centers.append(random.choice(scaled))
                continue
            new_centers.append([statistics.mean(col) for col in zip(*members)])
        centers = new_centers
        if not changed:
            break
    return labels


def describe_clusters(rows: list[dict], clusters: list[int]) -> dict[int, str]:
    labels: dict[int, str] = {}
    for cluster in sorted(set(clusters)):
        members = [row for row, label in zip(rows, clusters) if label == cluster]
        avg_goals = statistics.mean(row["goals_per_90"] for row in members)
        avg_assists = statistics.mean(row["assists_per_90"] for row in members)
        avg_cards = statistics.mean(row["cards_per_90"] for row in members)
        avg_minutes = statistics.mean(row["minutes_per_match"] for row in members)
        if avg_goals > 0.45:
            labels[cluster] = "Goal-focused finishers"
        elif avg_assists > 0.34:
            labels[cluster] = "Creative connectors"
        elif avg_cards > 0.30:
            labels[cluster] = "Physical ball-winners"
        elif avg_minutes > 82:
            labels[cluster] = "High-minute anchors"
        else:
            labels[cluster] = "Balanced contributors"
    return labels


class SentimentEngine:
    def __init__(self) -> None:
        self.model_name = os.getenv("HF_SENTIMENT_MODEL", DEFAULT_MODEL)
        self.enabled = os.getenv("ENABLE_TRANSFORMERS", "1") != "0"
        self.pipeline = None
        self.mode = "lexicon fallback"
        self.error = ""
        if self.enabled:
            self._load_pipeline()

    def _load_pipeline(self) -> None:
        try:
            from transformers import pipeline

            kwargs = {
                "task": "sentiment-analysis",
                "model": self.model_name,
                "tokenizer": self.model_name,
                "truncation": True,
            }
            token = os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN")
            if token:
                kwargs["token"] = token
            self.pipeline = pipeline(**kwargs)
            self.mode = f"Transformers: {self.model_name}"
        except Exception as exc:  # noqa: BLE001
            self.pipeline = None
            self.error = str(exc).splitlines()[0]
            self.mode = "lexicon fallback"

    def analyze(self, texts: list[str]) -> list[dict]:
        if self.pipeline:
            try:
                predictions = self.pipeline(texts, batch_size=16, truncation=True)
                return [normalize_transformer_label(item) for item in predictions]
            except Exception as exc:  # noqa: BLE001
                self.error = str(exc).splitlines()[0]
                self.pipeline = None
                self.mode = "lexicon fallback"
        return [lexicon_sentiment(text) for text in texts]


def normalize_transformer_label(item: dict) -> dict:
    raw = str(item.get("label", "neutral")).lower()
    if raw in {"label_0", "0"}:
        label = "negative"
    elif raw in {"label_2", "2"}:
        label = "positive"
    elif "neg" in raw:
        label = "negative"
    elif "pos" in raw:
        label = "positive"
    else:
        label = "neutral"
    return {"label": label, "score": round(float(item.get("score", 0.0)), 4)}


POSITIVE_TERMS = {
    "amazing",
    "brilliant",
    "class",
    "elite",
    "goal",
    "great",
    "love",
    "magic",
    "perfect",
    "unreal",
    "win",
    "winner",
}
NEGATIVE_TERMS = {
    "awful",
    "bad",
    "bottled",
    "disaster",
    "hate",
    "loss",
    "miss",
    "robbed",
    "terrible",
    "var",
    "waste",
    "worst",
}


def lexicon_sentiment(text: str) -> dict:
    tokens = set(re.findall(r"[a-zA-Z']+", text.lower()))
    score = len(tokens & POSITIVE_TERMS) - len(tokens & NEGATIVE_TERMS)
    if score > 0:
        return {"label": "positive", "score": min(0.96, 0.58 + score * 0.13)}
    if score < 0:
        return {"label": "negative", "score": min(0.96, 0.58 + abs(score) * 0.13)}
    return {"label": "neutral", "score": 0.62}


def clean_tweet_text(text: str) -> str:
    text = re.sub(r"https?://\S+", "http", text)
    text = re.sub(r"@\w+", "@user", text)
    return " ".join(text.split())


def fetch_x_posts(query: str) -> list[dict]:
    token = os.getenv("X_BEARER_TOKEN") or os.getenv("TWITTER_BEARER_TOKEN")
    if not token:
        return []
    base_url = os.getenv("X_RECENT_SEARCH_URL", "https://api.x.com/2/tweets/search/recent")
    params = {
        "query": query,
        "max_results": os.getenv("X_MAX_RESULTS", "80"),
        "tweet.fields": "created_at,public_metrics,lang",
    }
    url = f"{base_url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(request, timeout=12) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("data", [])


def make_sentiment_events() -> dict:
    random.seed(77)
    events = [
        (0, "Kickoff", "neutral", 0),
        (18, "Early pressure", "negative", -11),
        (33, "Goal: Team A", "positive", 28),
        (45, "Halftime", "neutral", 2),
        (58, "VAR check", "negative", -24),
        (69, "Goal: Team B", "negative", -18),
        (82, "Late winner: Team A", "positive", 36),
        (90, "Fulltime", "positive", 18),
    ]
    rows: list[dict] = []
    samples: list[dict] = []
    hashtags = ["#WorldCup", "#ARGFRA", "#football", "#TeamA", "#TeamB", "#goal", "#VAR", "#matchday"]
    players = ["Messi", "Mbappe", "Donovan", "Marta", "Morgan", "Kane", "Bellingham", "Bonmati"]

    for minute in range(0, 96):
        nearest = min(events, key=lambda item: abs(item[0] - minute))
        event_pressure = max(0, 14 - abs(nearest[0] - minute))
        volume = 32 + int(event_pressure * 8) + random.randint(-8, 16)
        bias = nearest[3] * max(0.18, 1 - abs(nearest[0] - minute) / 18)
        positive = max(10, min(78, 38 + bias + random.randint(-6, 6)))
        negative = max(8, min(70, 30 - bias / 1.6 + random.randint(-5, 7)))
        neutral = max(5, 100 - positive - negative)
        total = positive + negative + neutral
        positive = round(positive / total * 100, 1)
        negative = round(negative / total * 100, 1)
        neutral = round(100 - positive - negative, 1)
        rows.append(
            {
                "minute": minute,
                "volume": volume,
                "positive": positive,
                "neutral": neutral,
                "negative": negative,
                "score": round((positive - negative) / 100, 2),
                "top_hashtag": hashtags[(minute + random.randint(0, 4)) % len(hashtags)],
                "top_player": players[(minute + random.randint(0, 5)) % len(players)],
            }
        )
        for _ in range(random.randint(1, 4)):
            roll = random.random() * 100
            label = "positive" if roll < positive else "negative" if roll < positive + negative else "neutral"
            samples.append(
                {
                    "minute": minute,
                    "likes": min(125, int(random.expovariate(1 / 18))),
                    "sentiment": label,
                    "text": demo_sample_text(label, nearest[1]),
                }
            )

    event_rows = [
        {"minute": minute, "label": label, "sentiment": sentiment}
        for minute, label, sentiment, _impact in events
    ]
    return {
        "timeline": rows,
        "events": event_rows,
        "samples": samples,
        "source": "Demo replay",
        "model": "Synthetic match feed",
        "error": "",
    }


def demo_sample_text(label: str, event: str) -> str:
    if label == "positive":
        return f"{event} changed everything, unbelievable football"
    if label == "negative":
        return f"{event} has everyone angry, this match is chaos"
    return f"{event} and the timeline is still split"


def parse_created_at(value: str) -> datetime:
    if not value:
        return datetime.now(timezone.utc)
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def extract_hashtags(text: str) -> list[str]:
    return re.findall(r"#\w+", text)


def make_sentiment_from_posts(posts: list[dict], engine: SentimentEngine) -> dict:
    if not posts:
        return make_sentiment_events()
    texts = [clean_tweet_text(post.get("text", "")) for post in posts]
    predictions = engine.analyze(texts)
    created = [parse_created_at(post.get("created_at", "")) for post in posts]
    start = min(created)
    player_terms = [item.strip() for item in os.getenv("MATCH_PLAYER_TERMS", "Messi,Mbappe,Kane,Bellingham,Donovan").split(",") if item.strip()]
    buckets: dict[int, dict] = {}
    samples = []
    for post, text, prediction, created_at in zip(posts, texts, predictions, created):
        minute = min(95, max(0, int((created_at - start).total_seconds() // 60)))
        bucket = buckets.setdefault(
            minute,
            {"minute": minute, "volume": 0, "positive": 0, "neutral": 0, "negative": 0, "hashtags": [], "players": []},
        )
        label = prediction["label"]
        bucket["volume"] += 1
        bucket[label] += 1
        bucket["hashtags"].extend(extract_hashtags(text))
        bucket["players"].extend([term for term in player_terms if term.lower() in text.lower()])
        metrics = post.get("public_metrics") or {}
        samples.append(
            {
                "minute": minute,
                "likes": safe_int(metrics.get("like_count")),
                "sentiment": label,
                "text": text,
            }
        )

    rows = []
    for minute in range(0, max(buckets) + 1):
        bucket = buckets.get(minute, {"minute": minute, "volume": 0, "positive": 0, "neutral": 0, "negative": 0, "hashtags": [], "players": []})
        volume = bucket["volume"] or 1
        positive = round(bucket["positive"] / volume * 100, 1)
        neutral = round(bucket["neutral"] / volume * 100, 1)
        negative = round(bucket["negative"] / volume * 100, 1)
        rows.append(
            {
                "minute": minute,
                "volume": bucket["volume"],
                "positive": positive,
                "neutral": neutral,
                "negative": negative,
                "score": round((positive - negative) / 100, 2),
                "top_hashtag": most_common(bucket["hashtags"]) or "#WorldCup",
                "top_player": most_common(bucket["players"]) or "mixed",
            }
        )

    return {
        "timeline": rows,
        "events": default_match_events(),
        "samples": samples,
        "source": "X recent search",
        "model": engine.mode,
        "error": engine.error,
    }


def default_match_events() -> list[dict]:
    return [
        {"minute": 0, "label": "Kickoff", "sentiment": "neutral"},
        {"minute": 33, "label": "Goal", "sentiment": "positive"},
        {"minute": 45, "label": "Halftime", "sentiment": "neutral"},
        {"minute": 58, "label": "VAR check", "sentiment": "negative"},
        {"minute": 90, "label": "Fulltime", "sentiment": "neutral"},
    ]


def most_common(values: list[str]) -> str:
    if not values:
        return ""
    return max(set(values), key=values.count)


def exact_binomial_tail(flips: int, threshold: int) -> float:
    """Compute P(X > threshold) for X ~ Binomial(flips, 0.5)."""
    first_success = threshold + 1
    if first_success > flips:
        return 0.0
    log_probability = (
        math.lgamma(flips + 1)
        - math.lgamma(first_success + 1)
        - math.lgamma(flips - first_success + 1)
        - flips * math.log(2)
    )
    probability = math.exp(log_probability)
    tail = probability
    for heads in range(first_success, flips):
        probability *= (flips - heads) / (heads + 1)
        tail += probability
    return tail


def coin_flip_payload(flips: int = 10000, experiments: int = 12000, threshold: int = 5200, seed: int | None = None) -> dict:
    """Return one flip run plus a Monte Carlo distribution for the CLT comparison."""
    flips = max(100, min(flips, 50000))
    experiments = max(1000, min(experiments, 30000))
    threshold = max(0, min(threshold, flips))
    rng = random.Random(seed if seed is not None else time.time_ns())

    def heads_in_trial() -> int:
        full_blocks, remainder = divmod(flips, 32)
        total = sum(rng.getrandbits(32).bit_count() for _ in range(full_blocks))
        if remainder:
            total += rng.getrandbits(remainder).bit_count()
        return total

    single_heads = heads_in_trial()
    samples = [heads_in_trial() for _ in range(experiments)]
    successes = sum(value > threshold for value in samples)
    mean = flips * 0.5
    standard_deviation = math.sqrt(flips * 0.5 * 0.5)
    continuity_z = ((threshold + 0.5) - mean) / standard_deviation
    exact_probability = exact_binomial_tail(flips, threshold)
    clt_probability = 0.5 * math.erfc(continuity_z / math.sqrt(2))
    simulation_probability = successes / experiments
    interval_z = 1.96
    interval_denominator = 1 + interval_z**2 / experiments
    interval_center = (simulation_probability + interval_z**2 / (2 * experiments)) / interval_denominator
    interval_radius = (
        interval_z
        * math.sqrt(
            simulation_probability * (1 - simulation_probability) / experiments
            + interval_z**2 / (4 * experiments**2)
        )
        / interval_denominator
    )
    histogram_width = max(10, round(flips / 250))
    histogram_start = (min(samples) // histogram_width) * histogram_width
    histogram_end = ((max(samples) // histogram_width) + 1) * histogram_width
    histogram = []
    for start in range(histogram_start, histogram_end, histogram_width):
        count = sum(start <= value < start + histogram_width for value in samples)
        histogram.append({"heads": start + histogram_width / 2, "count": count, "start": start, "end": start + histogram_width})

    return {
        "flips": flips,
        "experiments": experiments,
        "threshold": threshold,
        "single_heads": single_heads,
        "single_tails": flips - single_heads,
        "simulation_successes": successes,
        "simulation_probability": round(simulation_probability, 8),
        "exact_probability": round(exact_probability, 15),
        "clt_probability": round(clt_probability, 15),
        "clt_absolute_error": round(abs(clt_probability - exact_probability), 15),
        "expected_successes": round(experiments * exact_probability, 2),
        "simulation_se": round(math.sqrt(simulation_probability * (1 - simulation_probability) / experiments), 8),
        "simulation_ci95_low": round(max(0, interval_center - interval_radius), 8),
        "simulation_ci95_high": round(min(1, interval_center + interval_radius), 8),
        "theoretical_mean": round(mean, 2),
        "theoretical_std_dev": round(standard_deviation, 2),
        "sample_mean": round(statistics.mean(samples), 2),
        "sample_std_dev": round(statistics.pstdev(samples), 2),
        "z_score": round(continuity_z, 3),
        "histogram": histogram,
    }


PLAYER_DATA, PLAYER_SOURCE = load_transfermarkt_players()
SENTIMENT_ENGINE = SentimentEngine()
SENTIMENT_CACHE: dict = {"query": "", "time": 0.0, "payload": None}


def get_sentiment_payload(query: str) -> dict:
    query = query.strip() or os.getenv("DEFAULT_MATCH_QUERY", DEFAULT_QUERY)
    refresh_seconds = safe_int(os.getenv("X_REFRESH_SECONDS", "45"), 45)
    now = time.time()
    if (
        SENTIMENT_CACHE["payload"]
        and SENTIMENT_CACHE["query"] == query
        and now - SENTIMENT_CACHE["time"] < refresh_seconds
    ):
        return with_live_minute(SENTIMENT_CACHE["payload"])

    token = os.getenv("X_BEARER_TOKEN") or os.getenv("TWITTER_BEARER_TOKEN")
    if token:
        try:
            posts = fetch_x_posts(query)
            payload = make_sentiment_from_posts(posts, SENTIMENT_ENGINE)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
            payload = make_sentiment_events()
            payload["error"] = f"X API fallback: {exc}"
            payload["model"] = SENTIMENT_ENGINE.mode
    else:
        payload = make_sentiment_events()
        payload["model"] = SENTIMENT_ENGINE.mode
        payload["error"] = "X_BEARER_TOKEN is not set; using replay data"

    SENTIMENT_CACHE.update({"query": query, "time": now, "payload": payload})
    return with_live_minute(payload)


def with_live_minute(payload: dict) -> dict:
    timeline = payload.get("timeline", [])
    live_minute = int(time.time() / 4) % max(1, len(timeline))
    return {**payload, "live_minute": live_minute}


def status_payload() -> dict:
    token_present = bool(os.getenv("X_BEARER_TOKEN") or os.getenv("TWITTER_BEARER_TOKEN"))
    hf_present = bool(os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACEHUB_API_TOKEN"))
    kaggle_present = bool(os.getenv("KAGGLE_USERNAME") and os.getenv("KAGGLE_KEY"))
    return {
        "player_source": PLAYER_SOURCE,
        "x_bearer_token": token_present,
        "hf_token": hf_present,
        "kaggle_credentials": kaggle_present,
        "transformers_installed": dependency_available("transformers"),
        "torch_installed": dependency_available("torch"),
        "tweepy_installed": dependency_available("tweepy"),
        "sentiment_model": SENTIMENT_ENGINE.mode,
        "sentiment_error": SENTIMENT_ENGINE.error,
    }


def json_response(handler: BaseHTTPRequestHandler, payload: object) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/":
            self.serve_file(ROOT / "public" / "index.html", "text/html; charset=utf-8")
        elif path == "/styles.css":
            self.serve_file(ROOT / "public" / "styles.css", "text/css; charset=utf-8")
        elif path == "/app.js":
            self.serve_file(ROOT / "public" / "app.js", "application/javascript; charset=utf-8")
        elif path == "/api/player-face":
            query = parse_qs(parsed.query)
            name = query.get("name", ["Player"])[0]
            position = query.get("position", [""])[0]
            self.serve_bytes(player_face_svg(name, position), "image/svg+xml; charset=utf-8")
        elif path == "/api/status":
            json_response(self, status_payload())
        elif path == "/api/players":
            json_response(self, {"players": PLAYER_DATA, "source": PLAYER_SOURCE})
        elif path == "/api/sentiment":
            query = parse_qs(parsed.query).get("query", [os.getenv("DEFAULT_MATCH_QUERY", DEFAULT_QUERY)])[0]
            json_response(self, get_sentiment_payload(query))
        elif path == "/api/coin-flips":
            query = parse_qs(parsed.query)
            seed_value = query.get("seed", [""])[0]
            seed = safe_int(seed_value, 0) if seed_value else None
            json_response(
                self,
                coin_flip_payload(
                    flips=safe_int(query.get("flips", ["10000"])[0], 10000),
                    experiments=safe_int(query.get("experiments", ["12000"])[0], 12000),
                    threshold=safe_int(query.get("threshold", ["5200"])[0], 5200),
                    seed=seed,
                ),
            )
        else:
            self.send_error(404, "Not found")

    def serve_file(self, file_path: Path, content_type: str) -> None:
        if not file_path.exists():
            self.send_error(404, "Not found")
            return
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def serve_bytes(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "public, max-age=86400")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Three-project analytics dashboard running at http://{HOST}:{PORT}")
    print(f"Player source: {PLAYER_SOURCE}")
    print(f"Sentiment model: {SENTIMENT_ENGINE.mode}")
    if SENTIMENT_ENGINE.error:
        print(f"Sentiment fallback reason: {SENTIMENT_ENGINE.error}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
