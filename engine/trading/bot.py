"""
Trading Bot - Main orchestrator for automated trading
"""
import asyncio
from datetime import datetime
from typing import List, Dict, Optional
import requests

from engine.trading.order_manager import OrderManager
from engine.trading.strategy import TradingStrategy


class TradingBot:
    """
    Automated trading bot

    Monitors signals and executes trades based on SMC strategy
    """

    def __init__(self, use_real_account: bool = False):
        self.om = OrderManager(use_real_account=use_real_account)
        self.strategy = TradingStrategy(self.om)

        self.running = False
        self.check_interval_seconds = 300  # Default 5 minutes

        self.api_base_url = "http://localhost:8000"

        # Statistics
        self.last_check_time: Optional[datetime] = None
        self.check_count = 0
        self.signal_count = 0

    def set_check_interval(self, minutes: int):
        """Set check interval in minutes"""
        self.check_interval_seconds = max(minutes * 60, 30)  # Minimum 30 seconds
        print(f"[Bot] Check interval: {minutes} min")

    def set_strategy_params(
        self,
        stop_loss: float = 2.0,
        take_profit: float = 5.0,
        position_size: int = 10,
        min_confluence: int = 80
    ):
        """Update strategy parameters"""
        self.strategy.stop_loss_pct = stop_loss
        self.strategy.take_profit_pct = take_profit
        self.strategy.max_position_size = position_size
        self.strategy.min_confluence_score = min_confluence

    def set_entry_mode(self, mode: str = 'MARKET', limit_price: float = 0):
        """Set entry mode: MARKET or LIMIT"""
        self.strategy.entry_mode = mode.upper()
        self.strategy.limit_price = limit_price
        print(f"[Bot] Entry mode: {mode}" + (f" @ {limit_price:,.0f}" if mode == 'LIMIT' else ""))

    async def start(self):
        """Start the bot"""

        print("=" * 60)
        print("TRADING BOT STARTING")
        print("=" * 60)
        print(f"Mode: {'REAL' if self.om.use_real else 'PAPER TRADING'}")
        print(f"Entry: {self.strategy.entry_mode}" + (f" @ {self.strategy.limit_price:,.0f}" if self.strategy.entry_mode == 'LIMIT' else ""))
        print(f"Interval: {self.check_interval_seconds}s")
        print(f"Symbols: {[s['symbol'] for s in self.strategy.get_symbols()]}")
        print(f"Stop Loss: {self.strategy.stop_loss_pct}%")
        print(f"Take Profit: {self.strategy.take_profit_pct}%")
        print("=" * 60)

        self.strategy.start()
        self.running = True

        while self.running:
            try:
                self.check_count += 1
                self.last_check_time = datetime.now()

                print(f"\n[Bot] Check #{self.check_count} at {self.last_check_time.strftime('%H:%M:%S')}")

                await self.check_signals()
                await self.manage_positions()

                await asyncio.sleep(self.check_interval_seconds)

            except asyncio.CancelledError:
                print("[Bot] Task cancelled")
                break
            except Exception as e:
                print(f"[Bot] Error: {e}")
                await asyncio.sleep(5)

    async def check_signals(self):
        """Check for entry signals on all monitored symbols"""

        symbols = self.strategy.get_symbols()

        for item in symbols:
            symbol = item['symbol']
            market = item['market']

            try:
                # Get analysis from API
                response = requests.get(
                    f"{self.api_base_url}/analyze",
                    params={
                        'symbol': symbol,
                        'market': market,
                        'tf': '1D',
                        'bar_index': 1499,  # Latest bar
                        'filter_weak': 'false'
                    },
                    timeout=10
                )

                if response.status_code != 200:
                    continue

                analysis = response.json()

                # Get current price for limit orders
                current_price = self.om._get_current_price(symbol, market)

                # Check entry signal
                if self.strategy.check_entry_signal(symbol, market, analysis):
                    self.signal_count += 1
                    print(f"\n[ENTRY SIGNAL] {symbol} ({market})")
                    self.strategy.execute_entry(symbol, market, analysis, current_price)

            except requests.exceptions.Timeout:
                print(f"[Bot] Timeout checking {symbol}")
            except Exception as e:
                print(f"[Bot] Error checking {symbol}: {e}")

    async def manage_positions(self):
        """Manage existing positions and pending orders"""

        # Check pending limit orders first
        pending = self.strategy.get_pending_orders()
        for symbol, order in pending.items():
            market = order.get('market', 'KR')
            try:
                current_price = self.om._get_current_price(symbol, market)
                self.strategy.check_pending_orders(symbol, current_price)
            except Exception as e:
                print(f"[Bot] Error checking pending {symbol}: {e}")

        # Check existing positions for exit signals
        positions = self.om.get_all_positions()

        for symbol, position in positions.items():
            market = position.get('market', 'KR')

            try:
                current_price = self.om._get_current_price(symbol, market)

                # Check exit signal
                exit_reason = self.strategy.check_exit_signal(symbol, current_price)

                if exit_reason:
                    print(f"\n[EXIT SIGNAL] {symbol}: {exit_reason}")
                    self.strategy.execute_exit(symbol, market, exit_reason)

            except Exception as e:
                print(f"[Bot] Error managing {symbol}: {e}")

    def stop(self):
        """Stop the bot"""
        self.running = False
        self.strategy.stop()
        print("\n[Bot] Stopped")

    def get_status(self) -> Dict:
        """Get bot status"""
        return {
            'running': self.running,
            'is_real': self.om.use_real,
            'interval_seconds': self.check_interval_seconds,
            'interval_minutes': self.check_interval_seconds // 60,
            'monitored_symbols': self.strategy.get_symbols(),
            'positions': self.om.get_all_positions(),
            'pending_orders': self.strategy.get_pending_orders(),
            'total_pnl': self.om.get_total_pnl(),
            'order_count': len(self.om.orders),
            'check_count': self.check_count,
            'signal_count': self.signal_count,
            'last_check': self.last_check_time.isoformat() if self.last_check_time else None,
            'strategy_params': {
                'stop_loss': self.strategy.stop_loss_pct,
                'take_profit': self.strategy.take_profit_pct,
                'position_size': self.strategy.max_position_size,
                'min_confluence': self.strategy.min_confluence_score,
                'entry_mode': self.strategy.entry_mode,
                'limit_price': self.strategy.limit_price
            },
            'stats': self.strategy.get_stats()
        }
