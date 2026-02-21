"""
Kalshi Dashboard Backend
Runs on port 8000. Set KALSHI_API_KEY in a .env file.
Demo API: https://demo-api.kalshi.co/trade-api/v2
Live API: https://trading-api.kalshi.co/trade-api/v2
"""

import os
import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

KALSHI_API_KEY = os.getenv("KALSHI_API_KEY", "")
KALSHI_ENV = os.getenv("KALSHI_ENV", "demo")  # "demo" or "live"

BASE_URL = (
    "https://demo-api.kalshi.co/trade-api/v2"
    if KALSHI_ENV == "demo"
    else "https://trading-api.kalshi.co/trade-api/v2"
)


def headers():
    return {
        "Authorization": KALSHI_API_KEY,
        "Content-Type": "application/json",
    }


@app.get("/api/status")
async def status():
    """Check if Kalshi API is reachable and credentials are valid."""
    if not KALSHI_API_KEY:
        return {"connected": False, "error": "KALSHI_API_KEY not set in .env"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{BASE_URL}/portfolio/balance", headers=headers())
        if resp.status_code == 200:
            return {"connected": True, "env": KALSHI_ENV}
        return {"connected": False, "error": f"Kalshi returned {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:
        return {"connected": False, "error": str(e)}


@app.get("/api/dashboard")
async def dashboard(market_limit: int = Query(20, ge=1, le=100)):
    """Fetch markets, orderbooks, balance, positions, and fills in one call."""
    result = {
        "markets": [],
        "orderbooks": {},
        "balance": None,
        "positions": [],
        "fills": [],
        "errors": [],
    }

    async with httpx.AsyncClient(timeout=15) as client:
        # ── Markets ──────────────────────────────────────────────────
        try:
            resp = await client.get(
                f"{BASE_URL}/markets",
                headers=headers(),
                params={"limit": market_limit, "status": "open"},
            )
            if resp.status_code == 200:
                data = resp.json()
                result["markets"] = data.get("markets", [])
            else:
                result["errors"].append(f"markets: {resp.status_code}")
        except Exception as e:
            result["errors"].append(f"markets: {e}")

        # ── Orderbooks ───────────────────────────────────────────────
        for market in result["markets"][:10]:  # limit orderbook calls
            ticker = market.get("ticker")
            if not ticker:
                continue
            try:
                resp = await client.get(
                    f"{BASE_URL}/markets/{ticker}/orderbook",
                    headers=headers(),
                    params={"depth": 5},
                )
                if resp.status_code == 200:
                    ob = resp.json().get("orderbook", {})
                    result["orderbooks"][ticker] = ob
            except Exception as e:
                result["errors"].append(f"orderbook {ticker}: {e}")

        # ── Balance ──────────────────────────────────────────────────
        try:
            resp = await client.get(f"{BASE_URL}/portfolio/balance", headers=headers())
            if resp.status_code == 200:
                result["balance"] = resp.json().get("balance", {})
            else:
                result["errors"].append(f"balance: {resp.status_code}")
        except Exception as e:
            result["errors"].append(f"balance: {e}")

        # ── Positions ────────────────────────────────────────────────
        try:
            resp = await client.get(
                f"{BASE_URL}/portfolio/positions",
                headers=headers(),
                params={"limit": 50},
            )
            if resp.status_code == 200:
                result["positions"] = resp.json().get("market_positions", [])
            else:
                result["errors"].append(f"positions: {resp.status_code}")
        except Exception as e:
            result["errors"].append(f"positions: {e}")

        # ── Fills ────────────────────────────────────────────────────
        try:
            resp = await client.get(
                f"{BASE_URL}/portfolio/fills",
                headers=headers(),
                params={"limit": 25},
            )
            if resp.status_code == 200:
                result["fills"] = resp.json().get("fills", [])
            else:
                result["errors"].append(f"fills: {resp.status_code}")
        except Exception as e:
            result["errors"].append(f"fills: {e}")

    return result


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
