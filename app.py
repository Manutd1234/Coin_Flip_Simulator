from __future__ import annotations

import json
import math
import os
import random
import statistics
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HOST = os.getenv("DASHBOARD_HOST", "127.0.0.1")
PORT = int(os.getenv("DASHBOARD_PORT", "8765"))


def safe_int(value: object, default: int = 0) -> int:
    try:
        return int(float(str(value)))
    except (TypeError, ValueError):
        return default


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


def wilson_interval(successes: int, trials: int) -> tuple[float, float]:
    z = 1.96
    proportion = successes / trials
    denominator = 1 + z**2 / trials
    center = (proportion + z**2 / (2 * trials)) / denominator
    radius = z * math.sqrt(
        proportion * (1 - proportion) / trials + z**2 / (4 * trials**2)
    ) / denominator
    return max(0.0, center - radius), min(1.0, center + radius)


def coin_flip_payload(
    flips: int = 10000,
    experiments: int = 12000,
    threshold: int = 5200,
    seed: int | None = None,
) -> dict:
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
    interval_low, interval_high = wilson_interval(successes, experiments)

    histogram_width = max(10, round(flips / 250))
    histogram_start = (min(samples) // histogram_width) * histogram_width
    histogram_end = ((max(samples) // histogram_width) + 1) * histogram_width
    histogram = []
    for start in range(histogram_start, histogram_end, histogram_width):
        count = sum(start <= value < start + histogram_width for value in samples)
        histogram.append(
            {
                "heads": start + histogram_width / 2,
                "count": count,
                "start": start,
                "end": start + histogram_width,
            }
        )

    return {
        "flips": flips,
        "experiments": experiments,
        "threshold": threshold,
        "single_heads": single_heads,
        "single_tails": flips - single_heads,
        "simulation_successes": successes,
        "simulation_probability": round(simulation_probability, 8),
        "simulation_ci95_low": round(interval_low, 8),
        "simulation_ci95_high": round(interval_high, 8),
        "exact_probability": round(exact_probability, 15),
        "clt_probability": round(clt_probability, 15),
        "clt_absolute_error": round(abs(clt_probability - exact_probability), 15),
        "expected_successes": round(experiments * exact_probability, 2),
        "theoretical_mean": round(mean, 2),
        "theoretical_std_dev": round(standard_deviation, 2),
        "sample_mean": round(statistics.mean(samples), 2),
        "sample_std_dev": round(statistics.pstdev(samples), 2),
        "z_score": round(continuity_z, 3),
        "histogram": histogram,
    }


def json_response(handler: BaseHTTPRequestHandler, payload: object) -> None:
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(200)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class DashboardHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self.serve_file(ROOT / "public" / "index.html", "text/html; charset=utf-8")
        elif parsed.path == "/styles.css":
            self.serve_file(ROOT / "public" / "styles.css", "text/css; charset=utf-8")
        elif parsed.path == "/app.js":
            self.serve_file(ROOT / "public" / "app.js", "application/javascript; charset=utf-8")
        elif parsed.path == "/api/coin-flips":
            query = urllib.parse.parse_qs(parsed.query)
            seed_value = query.get("seed", [""])[0]
            seed = safe_int(seed_value) if seed_value else None
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

    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Coin Flip Simulator running at http://{HOST}:{PORT}")
    print("Press Ctrl+C to stop.")
    server.serve_forever()


if __name__ == "__main__":
    main()
