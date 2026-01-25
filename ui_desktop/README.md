# LiquidityHunter Diagnostic Desktop App

A PySide6-based desktop application for visualizing and diagnosing the LiquidityHunter screener system.

**This application is for analysis and diagnostics only. No trading or order execution functionality exists.**

## Prerequisites

- Python 3.10+
- Running LiquidityHunter backend server

## Installation

```bash
# From project root (if not using existing venv)
python3 -m venv .venv
source .venv/bin/activate
pip install -r ui_desktop/requirements.txt
```

## Running

### Step 1: Start the backend server

```bash
# From project root
source .venv/bin/activate
uvicorn engine.api.app:app --reload --port 8000
```

### Step 2: Start the desktop app (in a new terminal)

```bash
# From project root
source .venv/bin/activate
python -m ui_desktop
```

Or using explicit venv path:

```bash
# Backend (terminal 1)
.venv/bin/uvicorn engine.api.app:app --reload --port 8000

# Desktop app (terminal 2)
.venv/bin/python -m ui_desktop
```

## Features

### Phase 2.7 Features

#### Sidebar Controls
- **Market Selector**: Switch between KR and US markets
- **Scan Mode Selector**: Choose between FULL, WATCHLIST_ONLY, or WATCHLIST_FILTER modes
  - Note: Backend currently only supports WATCHLIST_ONLY
  - Mode selection is display-only for now
- **Server Health Panel**: Real-time connection status with test button
- **Refresh Button**: Trigger data refresh from server
- **Clear Cache Button**: Clear the in-memory analysis cache

#### Main Content Area
- **Top Bar Indicators**: Visual badges showing current mode and market
- **Coverage Summary Cards**: Click any card to see detailed breakdown
  - Watchlist: Total symbols in watchlist
  - Available: Symbols with CSV data files
  - Missing: Symbols without data files (highlighted in red)
  - Insufficient: Symbols with < 250 data rows (highlighted in red)
  - Ready: Symbols ready for screening
- **Screener Results Table**: Sortable table with all candidate metrics

#### Status Bar
- Server connection status
- Candidate count
- Analysis cache size
- Last refresh timestamp

### Phase 2.8 Features (Order Block Analysis)

#### Tabbed Detail Drawer
The detail drawer now has two tabs:

**Summary Tab**
- All basic screener result fields
- Symbol, market, score, days to cross
- Price data (last close, EMA20, EMA200)
- Gap and slope diff metrics

**OB Analysis Tab**
- **Load Analysis Button**: Manual load (no auto-fetch)
- **Validation Status Card**: Shows has_displacement, has_fvg, is_fresh flags
- **Order Block Card**: Direction, zone top/bottom, zone width, displacement bar
- **FVG Card**: Fair Value Gap details if present
- **Zone Visualization**: Visual representation of OB zone, FVG, EMA lines, and current price

#### Analysis Cache
- In-memory session cache (cleared on app restart)
- Cache indicator shows "(cached)" when viewing cached results
- Clear cache button in sidebar
- Cache size shown in status bar

## Architecture

```
ui_desktop/
├── __init__.py       # Package init (v0.1.0)
├── __main__.py       # Entry point
├── client.py         # HTTP client with analysis cache
├── coverage.py       # Local file scanning for coverage stats
├── models.py         # Dataclasses including OB/FVG models
├── widgets.py        # All custom widgets including OB visualization
├── main_window.py    # Main application window
├── requirements.txt  # Dependencies
└── README.md         # This file
```

## Data Flow

### Screener Results
```
Desktop App → GET /screen?market=KR → FastAPI → Local CSV → Response
```

### OB Analysis
```
User clicks "Load Analysis"
    → GET /analyze?symbol=X&market=KR&tf=1D&bar_index=-1
    → FastAPI → Local CSV → OB Engine → AnalyzeResponse
    → Cache result
    → Display in OB Analysis tab
```

## Data Sources

- **Screener**: `GET http://127.0.0.1:8000/screen?market=KR|US`
- **OB Analysis**: `GET http://127.0.0.1:8000/analyze?symbol=X&market=M&tf=1D&bar_index=-1`
- **Coverage Stats**: Local filesystem scan of `data/` directory
  - Watchlist: `data/{market}_watchlist.txt`
  - Data files: `data/{market}/{symbol}_1D.csv`

## Error Handling

### Server Unavailable
- OB Analysis tab shows "Server unavailable"
- Server health panel shows disconnected status

### No Valid OB Found
- OB Analysis tab shows "No valid Order Block found"
- Validation status card shows which checks failed

### Data Not Found
- Shows "Data not found for {symbol} in {market}"
- Check that CSV file exists in correct location

## Constraints

- Read-only: No modifications to engine/ code (except minimal /analyze fix)
- No external API calls: Only localhost endpoints
- No trading functionality: Diagnostics only
- Backend endpoints unchanged (except market parameter on /analyze)
- No disk writes: Cache is in-memory only

## Troubleshooting

### Server Connection Failed
1. Ensure the backend server is running on port 8000
2. Click "Test Connection" in the Server Health panel
3. Check terminal for server errors

### No Candidates Shown
1. Verify data files exist in `data/{market}/` directory
2. Ensure CSV files have at least 250 rows
3. Check Coverage Summary for missing/insufficient data

### OB Analysis Shows Error
1. Verify symbol has CSV data file
2. Ensure server is running
3. Check bar_index is valid (-1 for latest)

### Coverage Shows All Missing
1. Verify watchlist file exists: `data/{market}_watchlist.txt`
2. Check that CSV files follow naming: `{symbol}_1D.csv`
3. Ensure data directory structure: `data/kr/`, `data/us/`
