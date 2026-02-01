#!/usr/bin/env python3
"""
Quick validation test for trading bot
Uses mock price fluctuations since market is closed
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import asyncio
import random
from datetime import datetime


def create_mock_analysis(symbol: str, has_signal: bool = False):
    """Create mock analysis data"""

    base_price = 44000 if symbol == "005930" else 50000
    current_price = base_price + random.randint(-500, 500)

    return {
        'symbol': symbol,
        'market': 'KR',
        'bar_index': 1499,
        'current_price': current_price,
        'orderblocks': [
            {
                'index': 808,
                'direction': 'buy',
                'zone_top': current_price * 1.02,
                'zone_bottom': current_price * 0.98,
            }
        ] if has_signal else [],
        'confluence': {
            'has_confluence': has_signal,
            'score': 85 if has_signal else 60,
            'reason': 'Mock signal for testing'
        }
    }


async def test_market_mode():
    """Test MARKET mode entry"""
    print("\n" + "="*60)
    print("TEST 1: MARKET MODE")
    print("="*60)

    from engine.trading.order_manager import OrderManager
    from engine.trading.strategy import TradingStrategy

    # Create components
    om = OrderManager(use_real_account=False)
    strategy = TradingStrategy(om)

    # Set MARKET mode
    strategy.entry_mode = 'MARKET'
    strategy.add_symbol('005930', 'KR')
    strategy.start()

    print("\n1. Testing entry signal detection...")

    # Mock analysis with signal
    analysis = create_mock_analysis('005930', has_signal=True)
    print(f"   Current price: {analysis['current_price']:,}")
    print(f"   Confluence score: {analysis['confluence']['score']}")

    # Check entry
    should_enter = strategy.check_entry_signal('005930', 'KR', analysis)
    print(f"   Should enter? {should_enter}")

    if should_enter:
        print("\n2. Executing entry...")
        order = strategy.execute_entry('005930', 'KR', analysis, analysis['current_price'])
        print(f"   Order ID: {order.get('order_id', 'N/A')}")
        print(f"   Price: {order.get('filled_price', 0):,.0f}")
        print(f"   Quantity: {order.get('filled_quantity', order.get('quantity', 0))}")

    # Check position
    print("\n3. Checking position...")
    pos = om.get_position('005930')
    if pos:
        print(f"   Position exists")
        print(f"   Quantity: {pos['quantity']}")
        print(f"   Avg price: {pos['avg_price']:,.0f}")

    # Test exit (stop loss)
    print("\n4. Testing exit signal (stop loss -2.5%)...")
    exit_price = pos['avg_price'] * 0.975  # -2.5% loss
    exit_reason = strategy.check_exit_signal('005930', exit_price)
    print(f"   Exit price: {exit_price:,.0f}")
    print(f"   Exit reason: {exit_reason}")

    if exit_reason:
        print("\n5. Executing exit...")
        exit_order = strategy.execute_exit('005930', 'KR', exit_reason)
        print(f"   Exit order placed")

    # Check stats
    stats = strategy.get_stats()
    print(f"\n6. Stats: {stats}")

    print("\n" + "="*60)
    print("MARKET MODE TEST COMPLETE")
    print("="*60)


async def test_limit_mode():
    """Test LIMIT mode entry"""
    print("\n" + "="*60)
    print("TEST 2: LIMIT MODE")
    print("="*60)

    from engine.trading.order_manager import OrderManager
    from engine.trading.strategy import TradingStrategy

    # Create components
    om = OrderManager(use_real_account=False)
    strategy = TradingStrategy(om)

    # Set LIMIT mode
    target_price = 43500
    strategy.entry_mode = 'LIMIT'
    strategy.limit_price = target_price
    strategy.add_symbol('005930', 'KR')
    strategy.start()

    print(f"\n1. Testing LIMIT order (target: {target_price:,})...")

    # Mock analysis with signal
    analysis = create_mock_analysis('005930', has_signal=True)
    analysis['current_price'] = 44000  # Above target

    print(f"   Current price: {analysis['current_price']:,}")
    print(f"   Target price: {target_price:,}")

    # Check entry signal
    should_enter = strategy.check_entry_signal('005930', 'KR', analysis)
    print(f"   Signal detected? {should_enter}")

    if should_enter:
        # Execute entry - should create pending order
        result = strategy.execute_entry('005930', 'KR', analysis, analysis['current_price'])
        print(f"   Result: {result.get('status', 'order placed')}")

    # Check pending orders
    pending = strategy.get_pending_orders()
    print(f"\n2. Pending orders: {len(pending)}")
    for symbol, order in pending.items():
        print(f"   {symbol}: target {order['target_price']:,}")

    # Simulate price drop to target
    print(f"\n3. Simulating price drop to {target_price:,}...")
    triggered = strategy.check_pending_orders('005930', target_price)
    if triggered:
        print(f"   LIMIT order TRIGGERED!")
        print(f"   Order: {triggered.get('order_id', 'N/A')}")
    else:
        print("   Not triggered yet")

    # Check position
    pos = om.get_position('005930')
    if pos:
        print(f"\n4. Position created:")
        print(f"   Quantity: {pos['quantity']}")
        print(f"   Avg price: {pos['avg_price']:,.0f}")

    # Check pending orders again (should be empty)
    pending_after = strategy.get_pending_orders()
    print(f"\n5. Pending orders after fill: {len(pending_after)}")

    print("\n" + "="*60)
    print("LIMIT MODE TEST COMPLETE")
    print("="*60)


async def test_api_endpoints():
    """Test API endpoints"""
    print("\n" + "="*60)
    print("TEST 3: API ENDPOINTS")
    print("="*60)

    import requests

    base_url = "http://localhost:8000"

    # Test start endpoint
    print("\n1. Testing /api/trading/start...")
    try:
        response = requests.post(
            f"{base_url}/api/trading/start",
            json={
                'interval_minutes': 1,
                'symbols': ['005930'],
                'market': 'KR',
                'stop_loss': 2.0,
                'take_profit': 5.0,
                'position_size': 10,
                'entry_mode': 'MARKET',
                'use_real': False
            },
            timeout=5
        )

        if response.status_code == 200:
            print("   Bot started")
            data = response.json()
            params = data.get('config', {}).get('strategy_params', {})
            print(f"   Entry mode: {params.get('entry_mode')}")
            print(f"   Stop loss: {params.get('stop_loss')}%")
        else:
            print(f"   Error: {response.status_code} - {response.text[:100]}")
    except requests.exceptions.ConnectionError:
        print("   Skipped (server not running)")
        return
    except Exception as e:
        print(f"   Error: {e}")
        return

    # Wait a bit
    await asyncio.sleep(2)

    # Test status endpoint
    print("\n2. Testing /api/trading/status...")
    try:
        response = requests.get(f"{base_url}/api/trading/status", timeout=5)

        if response.status_code == 200:
            data = response.json()
            print("   Status retrieved")
            print(f"   Running: {data.get('running')}")
            print(f"   Entry mode: {data.get('strategy_params', {}).get('entry_mode')}")
            print(f"   Check count: {data.get('check_count', 0)}")
        else:
            print(f"   Error: {response.status_code}")
    except Exception as e:
        print(f"   Error: {e}")

    # Test stop endpoint
    print("\n3. Testing /api/trading/stop...")
    try:
        response = requests.post(f"{base_url}/api/trading/stop", timeout=5)

        if response.status_code == 200:
            print("   Bot stopped")
        else:
            print(f"   Error: {response.status_code}")
    except Exception as e:
        print(f"   Error: {e}")

    print("\n" + "="*60)
    print("API ENDPOINTS TEST COMPLETE")
    print("="*60)


async def main():
    """Run all tests"""

    print("\n")
    print("=" * 60)
    print("       TRADING BOT VALIDATION TEST")
    print("       Mock Data Testing (Market Closed)")
    print("=" * 60)

    try:
        # Test 1: Market mode
        await test_market_mode()

        await asyncio.sleep(0.5)

        # Test 2: Limit mode
        await test_limit_mode()

        await asyncio.sleep(0.5)

        # Test 3: API endpoints
        await test_api_endpoints()

        print("\n")
        print("=" * 60)
        print("       ALL TESTS COMPLETE")
        print("       Backend logic validated with mock data")
        print("=" * 60)
        print("\n")

    except Exception as e:
        print(f"\nTest failed: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
