"""
Kalshi Dashboard Backend
Connects to Kalshi's API and serves data to the frontend dashboard.
Deploy on Railway, Render, or Fly.io.

Required environment variables:
  KALSHI_API_KEY_ID  - Your Kalshi API key ID
  KALSHI_API_KEY     - Your Kalshi private API key (RSA PEM)
  KALSHI_ENV         - "demo" (default) or "prod"
  FRONTEND_URL       - Your GitHub Pages URL for CORS (e.g. https://ppotter4689.github.io)
"""

import os
import time
import hashlib
import base64
import logging
from datetime import datetime

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────
KALSHI_ENV = os.environ.get("KALSHI_ENV", "demo")
BASE_URLS = {
    "demo": "https://demo-api.kalshi.co/trade-api/v2",
    "prod": "https://trading-api.kalshi.com/trade-api/v2",
}
KALSHI_BASE = BASE_URLS.get(KALSHI_ENV, BASE_URLS["demo"])

KALSHI_EMAIL = os.environ.get("KALSHI_EMAIL", "")
KALSHI_PASSWORD = os.environ.get("KALSHI_PASSWORD", "")
KALSHI_API_KEY_ID = os.environ.get("KALSHI_API_KEY_ID", "")
KALSHI_API_KEY = os.environ.get("KALSHI_API_KEY", "")

FRONTEND_URL = os.environ.get("FRONTEND_URL", "https://ppotter4689.github.io")

app = FastAPI(title="Kalshi Dashboard Backend")

# CORS — allow the GitHub Pages frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_URL,
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth state ──────────────────────────────────────────────────────
auth_state = {
    "token": None,
    "expires_at": 0,
}


def get_auth_headers() -> dict:
    """Get authentication headers for Kalshi API requests."""
    # Method 1: API Key authentication (recommended)
    if KALSHI_API_KEY_ID and KALSHI_API_KEY:
        return {"Authorization": f"Bearer {KALSHI_API_KEY_ID}"}

    # Method 2: Email/password login
    if auth_state["token"] and time.time() < auth_state["expires_at"]:
        return {"Authorization": f"Bearer {auth_state['token']}"}

    if KALSHI_EMAIL and KALSHI_PASSWORD:
        try:
            resp = httpx.post(
                f"{KALSHI_BASE}/login",
                json={"email": KALSHI_EMAIL, "password": KALSHI_PASSWORD},
                timeout=10,
            )
            resp.raise_for_status()
            data = resp.json()
            auth_state["token"] = data.get("token", "")
            # Tokens typically last ~24h, refresh after 20h
            auth_state["expires_at"] = time.time() + 72000
            logger.info("Authenticated with Kalshi via email/password")
            return {"Authorization": f"Bearer {auth_state['token']}"}
        except Exception as e:
            logger.error(f"Login failed: {e}")
            return {}

    return {}


def kalshi_get(path: str, params: dict = None) -> dict | list | None:
    """Make an authenticated GET request to the Kalshi API."""
    headers = get_auth_headers()
    try:
        resp = httpx.get(
            f"{KALSHI_BASE}{path}",
            headers=headers,
            params=params,
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as e:
        logger.error(f"Kalshi API error {e.response.status_code}: {path}")
        return None
    except Exception as e:
        logger.error(f"Kalshi request failed: {e}")
        return None


# ── Routes ──────────────────────────────────────────────────────────
@app.get("/")
def root():
    return {"service": "kalshi-dashboard-backend", "status": "running"}


@app.get("/api/status")
def api_status():
    """Check if we can reach the Kalshi API."""
    has_credentials = bool(
        (KALSHI_EMAIL and KALSHI_PASSWORD) or (KALSHI_API_KEY_ID and KALSHI_API_KEY)
    )

    if not has_credentials:
        return {
            "connected": False,
            "error": "No Kalshi credentials configured. Set KALSHI_EMAIL/KALSHI_PASSWORD or KALSHI_API_KEY_ID/KALSHI_API_KEY environment variables.",
        }

    try:
        result = kalshi_get("/exchange/status")
        if result is not None:
            return {"connected": True, "exchange_status": result}
        return {"connected": False, "error": "Could not reach Kalshi API"}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@app.get("/api/dashboard")
def api_dashboard(market_limit: int = 20):
    """Fetch markets, orderbooks, balance, positions, and fills."""
    errors = []
    markets = []
    orderbooks = {}
    balance = None
    positions = []
    fills = []

    # Fetch markets
    market_data = kalshi_get("/markets", params={"limit": market_limit, "status": "open"})
    if market_data and "markets" in market_data:
        markets = market_data["markets"]
    elif market_data is None:
        errors.append("Failed to fetch markets")

    # Fetch orderbooks for each market
    for m in markets[:market_limit]:
        ticker = m.get("ticker", "")
        if not ticker:
            continue
        ob_data = kalshi_get(f"/orderbook/{ticker}")
        if ob_data and "orderbook" in ob_data:
            ob = ob_data["orderbook"]
            orderbooks[ticker] = {
                "yes": [[lvl[0], lvl[1]] for lvl in (ob.get("yes", []) or [])],
                "no": [[lvl[0], lvl[1]] for lvl in (ob.get("no", []) or [])],
            }

    # Fetch balance
    balance_data = kalshi_get("/portfolio/balance")
    if balance_data:
        balance = balance_data
    else:
        errors.append("Failed to fetch balance")

    # Fetch positions
    positions_data = kalshi_get("/portfolio/positions", params={"limit": 50})
    if positions_data and "market_positions" in positions_data:
        positions = positions_data["market_positions"]
    elif positions_data and "event_positions" in positions_data:
        positions = positions_data["event_positions"]

    # Fetch recent fills
    fills_data = kalshi_get("/portfolio/fills", params={"limit": 20})
    if fills_data and "fills" in fills_data:
        fills = fills_data["fills"]

    return {
        "markets": markets,
        "orderbooks": orderbooks,
        "balance": balance,
        "positions": positions,
        "fills": fills,
        "errors": errors,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/markets")
def api_markets(limit: int = 20, status: str = "open"):
    """Fetch markets list."""
    data = kalshi_get("/markets", params={"limit": limit, "status": status})
    if data:
        return data
    return {"markets": [], "error": "Failed to fetch markets"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
