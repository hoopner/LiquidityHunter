# Phase 2.6 Design Proposal (Final)

**Status:** Approved
**Date:** 2026-01-25
**Depends on:** Phase 2.5 (frozen)

---

## Objective

Enable full-universe scanning over locally-available CSV files by introducing a universe manifest, explicit scan modes, and unambiguous coverage reporting.

---

## Scope

### In Scope
- Universe manifest file format
- Three explicit, mutually exclusive scan modes
- Scan orchestration logic
- Coverage report with defined metrics

### Out of Scope
- External data fetching
- Caching / TTL / refresh logic
- New API endpoints
- Schema changes

---

## File Structure

```
data/
├── universe_kr.txt       # NEW: full KR market manifest
├── universe_us.txt       # NEW: full US market manifest
├── kr_watchlist.txt      # EXISTING: curated symbol list
├── us_watchlist.txt      # EXISTING: curated symbol list
├── kr/
│   └── {SYMBOL}_1D.csv
└── us/
    └── {SYMBOL}_1D.csv
```

---

## Scan Modes

Three explicit, mutually exclusive modes:

| Mode | Source | Behavior |
|------|--------|----------|
| `FULL` | Universe manifest only | Scans all symbols in `universe_{market}.txt` |
| `WATCHLIST_ONLY` | Watchlist only | Scans all symbols in `{market}_watchlist.txt` (Phase 2.5 behavior) |
| `WATCHLIST_FILTER` | Intersection | Scans symbols present in BOTH universe AND watchlist |

**No implicit behavior.** Mode must be explicitly specified. No automatic fallback or filtering.

---

## Scan Orchestration Logic

```
Input:
  market: "KR" | "US"
  mode: "FULL" | "WATCHLIST_ONLY" | "WATCHLIST_FILTER"
  top_n: int

Step 1: Determine Selected Symbols
  ┌────────────────────────────────────────────────────┐
  │ if mode == FULL:                                   │
  │     selected = load(universe_{market}.txt)         │
  │                                                    │
  │ else if mode == WATCHLIST_ONLY:                    │
  │     selected = load({market}_watchlist.txt)        │
  │                                                    │
  │ else if mode == WATCHLIST_FILTER:                  │
  │     universe = load(universe_{market}.txt)         │
  │     watchlist = load({market}_watchlist.txt)       │
  │     selected = universe ∩ watchlist                │
  └────────────────────────────────────────────────────┘

Step 2: Check CSV Availability
  ┌────────────────────────────────────────────────────┐
  │ available = []                                     │
  │ missing = []                                       │
  │                                                    │
  │ for symbol in selected:                            │
  │     path = data/{market}/{symbol}_1D.csv           │
  │     if file_exists(path):                          │
  │         available.append(symbol)                   │
  │     else:                                          │
  │         missing.append(symbol)                     │
  └────────────────────────────────────────────────────┘

Step 3: Process Available Symbols
  ┌────────────────────────────────────────────────────┐
  │ processed = []                                     │
  │ insufficient = []                                  │
  │                                                    │
  │ for symbol in available:                           │
  │     bars = count_bars(symbol)                      │
  │     if bars >= 250:                                │
  │         processed.append(symbol)                   │
  │     else:                                          │
  │         insufficient.append(symbol)                │
  └────────────────────────────────────────────────────┘

Step 4: Run Screener (Phase 2.5, frozen)
  ┌────────────────────────────────────────────────────┐
  │ candidates = []                                    │
  │                                                    │
  │ for symbol in processed:                           │
  │     result = screen_symbol(symbol)                 │
  │     if result.reason == "OK":                      │
  │         candidates.append(result)                  │
  └────────────────────────────────────────────────────┘

Step 5: Sort and Limit
  ┌────────────────────────────────────────────────────┐
  │ candidates.sort(by=score DESC, days_to_cross ASC)  │
  │ returned = candidates[:top_n]                      │
  └────────────────────────────────────────────────────┘

Output:
  returned: List[ScreenResult]
  coverage: CoverageReport
```

---

## Coverage Report Metrics

| Metric | Definition |
|--------|------------|
| `universe_size` | Total symbols in `universe_{market}.txt` |
| `selected_size` | Symbols after mode application |
| `available_count` | Symbols with existing CSV file |
| `missing_count` | Symbols without CSV file (`selected_size - available_count`) |
| `processed_count` | Symbols with ≥250 bars (sufficient data) |
| `insufficient_data_count` | Symbols with <250 bars (`available_count - processed_count`) |
| `candidate_count` | Symbols passing screener conditions (reason = "OK") |
| `returned_count` | Final output size (≤ top_n) |

---

## Metric Flow Diagram

```
universe_size (manifest total)
      │
      ▼
selected_size (after mode)
      │
      ├──▶ missing_count (no CSV)
      │
      ▼
available_count (CSV exists)
      │
      ├──▶ insufficient_data_count (<250 bars)
      │
      ▼
processed_count (≥250 bars)
      │
      ├──▶ rejected by screener (NO_CONVERGENCE, OUT_OF_WINDOW)
      │
      ▼
candidate_count (reason = "OK")
      │
      ├──▶ truncated (beyond top_n)
      │
      ▼
returned_count (final output)
```

**Invariants:**
- `selected_size = available_count + missing_count`
- `available_count = processed_count + insufficient_data_count`
- `returned_count ≤ candidate_count`
- `returned_count ≤ top_n`

---

## Coverage Report Structure

```
CoverageReport:
├── market: str
├── mode: str
├── universe_size: int
├── selected_size: int
├── available_count: int
├── missing_count: int
├── processed_count: int
├── insufficient_data_count: int
├── candidate_count: int
├── returned_count: int
└── missing_symbols: List[str]
```

---

## Example Coverage Report

```
Market: KR
Mode: FULL

universe_size:            2,500
selected_size:            2,500
available_count:            847
missing_count:            1,653
processed_count:            834
insufficient_data_count:     13
candidate_count:             42
returned_count:              20

Missing symbols (first 10):
  003670, 004020, 004170, 004370, 004490,
  004800, 005250, 005300, 005380, 005440
```

---

## Summary

| Component | Description |
|-----------|-------------|
| Universe manifest | User-maintained list of target symbols |
| Scan modes | Three explicit, mutually exclusive options |
| Coverage metrics | Eight unambiguous counts with defined invariants |
| Screener | Phase 2.5 (frozen, unchanged) |
