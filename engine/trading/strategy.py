"""
Trading Strategy - Entry/Exit logic based on SMC + AI
"""
from typing import Dict, Optional, List
from datetime import datetime

class TradingStrategy:
    """
    SMC + AI based trading strategy

    Entry conditions:
    - OB + FVG confluence
    - Confluence score >= threshold
    - Not already in position

    Exit conditions:
    - Stop loss hit
    - Take profit hit
    """

    def __init__(self, order_manager):
        self.om = order_manager

        # Strategy parameters
        self.max_position_size = 10
        self.stop_loss_pct = 2.0
        self.take_profit_pct = 5.0
        self.min_confluence_score = 80

        # Entry mode: 'MARKET' or 'LIMIT'
        self.entry_mode = 'MARKET'
        self.limit_price = 0.0

        self.active = False
        self.monitored_symbols: List[Dict] = []  # [{symbol, market}]

        # Pending limit orders (symbol -> order info)
        self.pending_orders: Dict[str, Dict] = {}

        # Trade history
        self.trades: List[Dict] = []

    def start(self):
        """Start trading"""
        self.active = True
        print("[Strategy] ACTIVE")

    def stop(self):
        """Stop trading"""
        self.active = False
        print("[Strategy] STOPPED")

    def add_symbol(self, symbol: str, market: str = "KR"):
        """Add symbol to monitor"""
        item = {'symbol': symbol, 'market': market}
        if item not in self.monitored_symbols:
            self.monitored_symbols.append(item)
            print(f"[Strategy] Added {symbol} ({market})")

    def remove_symbol(self, symbol: str):
        """Remove symbol"""
        self.monitored_symbols = [
            s for s in self.monitored_symbols
            if s['symbol'] != symbol
        ]
        print(f"[Strategy] Removed {symbol}")

    def get_symbols(self) -> List[Dict]:
        """Get monitored symbols"""
        return self.monitored_symbols.copy()

    def check_entry_signal(self, symbol: str, market: str, analysis: Dict) -> bool:
        """
        Check if should enter position

        Conditions:
        1. Strategy is active
        2. OB + FVG confluence exists
        3. Confluence score >= threshold
        4. Not already in position
        """

        if not self.active:
            return False

        # Already in position?
        if self.om.get_position(symbol):
            return False

        # Check for orderblocks
        orderblocks = analysis.get('orderblocks', [])
        if not orderblocks:
            return False

        # Check confluence
        confluence = analysis.get('confluence', {})
        if not confluence:
            return False

        has_confluence = confluence.get('has_confluence', False)
        if not has_confluence:
            return False

        score = confluence.get('score', 0)
        if score < self.min_confluence_score:
            return False

        # Check direction (prefer buy signals for now)
        ob = orderblocks[0] if orderblocks else None
        if ob and ob.get('direction') == 'buy':
            print(f"[Signal] {symbol}: OB+FVG confluence, score={score}")
            return True

        return False

    def check_exit_signal(
        self,
        symbol: str,
        current_price: float
    ) -> Optional[str]:
        """
        Check if should exit position

        Returns: 'STOP_LOSS' | 'TAKE_PROFIT' | None
        """

        position = self.om.get_position(symbol)
        if not position:
            return None

        avg_price = position['avg_price']
        if avg_price <= 0:
            return None

        pnl_pct = ((current_price - avg_price) / avg_price) * 100

        # Stop loss
        if pnl_pct <= -self.stop_loss_pct:
            return 'STOP_LOSS'

        # Take profit
        if pnl_pct >= self.take_profit_pct:
            return 'TAKE_PROFIT'

        return None

    def execute_entry(self, symbol: str, market: str, analysis: Dict, current_price: float = 0) -> Dict:
        """Execute buy order based on entry mode"""

        quantity = self.max_position_size
        confluence = analysis.get('confluence', {})
        score = confluence.get('score', 0)
        reason = f"OB+FVG confluence, score={score}"

        if self.entry_mode == 'LIMIT':
            # Create pending limit order
            target_price = self.limit_price if self.limit_price > 0 else current_price * 0.99
            pending = {
                'symbol': symbol,
                'market': market,
                'quantity': quantity,
                'target_price': target_price,
                'reason': reason,
                'created_at': datetime.now().isoformat(),
                'status': 'PENDING'
            }
            self.pending_orders[symbol] = pending
            print(f"[LIMIT ORDER] {symbol}: 목표가 {target_price:,.0f} 대기 중")
            return pending

        # MARKET mode - execute immediately
        order = self.om.buy_market(
            symbol=symbol,
            market=market,
            quantity=quantity,
            reason=reason
        )

        # Record trade
        self.trades.append({
            'type': 'ENTRY',
            'symbol': symbol,
            'market': market,
            'order': order,
            'timestamp': datetime.now().isoformat()
        })

        return order

    def check_pending_orders(self, symbol: str, current_price: float) -> Optional[Dict]:
        """Check if pending limit order should be filled"""
        if symbol not in self.pending_orders:
            return None

        pending = self.pending_orders[symbol]
        target_price = pending.get('target_price', 0)

        # Fill if price drops to or below target
        if current_price <= target_price:
            print(f"[LIMIT FILLED] {symbol}: 목표가 {target_price:,.0f} 도달!")

            # Execute the order
            order = self.om.buy_market(
                symbol=symbol,
                market=pending['market'],
                quantity=pending['quantity'],
                reason=f"{pending['reason']} (LIMIT @ {target_price:,.0f})"
            )

            # Record trade
            self.trades.append({
                'type': 'ENTRY',
                'symbol': symbol,
                'market': pending['market'],
                'order': order,
                'entry_mode': 'LIMIT',
                'target_price': target_price,
                'timestamp': datetime.now().isoformat()
            })

            # Remove from pending
            del self.pending_orders[symbol]
            return order

        return None

    def cancel_pending_order(self, symbol: str) -> bool:
        """Cancel a pending limit order"""
        if symbol in self.pending_orders:
            del self.pending_orders[symbol]
            print(f"[CANCELLED] {symbol} 대기 주문 취소")
            return True
        return False

    def get_pending_orders(self) -> Dict[str, Dict]:
        """Get all pending limit orders"""
        return self.pending_orders.copy()

    def execute_exit(self, symbol: str, market: str, reason: str) -> Optional[Dict]:
        """Execute sell order"""

        position = self.om.get_position(symbol)
        if not position:
            return None

        quantity = position['quantity']
        entry_price = position['avg_price']

        order = self.om.sell_market(
            symbol=symbol,
            market=market,
            quantity=quantity,
            reason=reason
        )

        # Calculate P&L
        exit_price = order.get('filled_price', 0)
        pnl = (exit_price - entry_price) * quantity
        pnl_pct = ((exit_price - entry_price) / entry_price) * 100 if entry_price > 0 else 0

        print(f"[Trade] {symbol}: P&L {pnl:+,.0f} ({pnl_pct:+.2f}%)")

        # Record trade
        self.trades.append({
            'type': 'EXIT',
            'symbol': symbol,
            'market': market,
            'reason': reason,
            'order': order,
            'pnl': pnl,
            'pnl_pct': pnl_pct,
            'timestamp': datetime.now().isoformat()
        })

        return order

    def get_trade_history(self, limit: int = 50) -> List[Dict]:
        """Get trade history"""
        return self.trades[-limit:]

    def get_stats(self) -> Dict:
        """Get strategy statistics"""
        total_trades = len([t for t in self.trades if t['type'] == 'EXIT'])
        wins = len([t for t in self.trades if t['type'] == 'EXIT' and t.get('pnl', 0) > 0])
        losses = len([t for t in self.trades if t['type'] == 'EXIT' and t.get('pnl', 0) < 0])

        total_pnl = sum([t.get('pnl', 0) for t in self.trades if t['type'] == 'EXIT'])

        return {
            'total_trades': total_trades,
            'wins': wins,
            'losses': losses,
            'win_rate': (wins / total_trades * 100) if total_trades > 0 else 0,
            'total_pnl': total_pnl
        }
