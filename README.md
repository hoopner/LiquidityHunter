# LiquidityHunter

Phase 2: Order Block Detection Engine

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install pytest numpy fastapi uvicorn pydantic httpx
```

## Run Tests

```bash
source .venv/bin/activate && pytest -q
```

## Run API Server

```bash
source .venv/bin/activate && uvicorn engine.api.app:app --reload --port 8000
```

## API Endpoints

### GET /analyze

Analyze order block at a specific bar index.

```bash
curl "http://localhost:8000/analyze?symbol=SAMPLE&tf=1D&bar_index=24"
```

### GET /replay

Replay analysis for all bars.

```bash
curl "http://localhost:8000/replay?symbol=SAMPLE&tf=1D"
```

## Data Format

Place CSV files in `/data/` with naming: `{SYMBOL}_{TIMEFRAME}.csv`

Required columns: `timestamp,open,high,low,close,volume`
