"""
Order Manager - Handles buy/sell orders
"""
import os
from datetime import datetime
from typing import Optional, Dict, List

class OrderManager:
    """
    Manages trading orders via KIS API

    SAFETY: Uses MOCK account by default (paper trading)
    """

    def __init__(self, use_real_account: bool = False):
        self.use_real = use_real_account

        self.orders: List[Dict] = []
        self.positions: Dict[str, Dict] = {}

        mode = "REAL ACCOUNT" if self.use_real else "PAPER TRADING"
        print(f"[OrderManager] Initialized: {mode}")

    def buy_market(
        self,
        symbol: str,
        market: str,
        quantity: int,
        reason: str = ""
    ) -> Dict:
        """Place market buy order"""

        current_price = self._get_current_price(symbol, market)

        if not self.use_real:
            # Mock order
            order = {
                'order_id': f"MOCK_{int(datetime.now().timestamp() * 1000)}",
                'symbol': symbol,
                'market': market,
                'quantity': quantity,
                'order_type': 'BUY',
                'price_type': 'MARKET',
                'status': 'FILLED',
                'filled_price': current_price,
                'filled_quantity': quantity,
                'timestamp': datetime.now().isoformat(),
                'reason': reason,
                'is_mock': True
            }
            print(f"[MOCK BUY] {symbol} x{quantity} @ {current_price:,.0f}")
        else:
            # Real order via KIS API
            try:
                from engine.data.kis_api import get_kis_client
                client = get_kis_client()
                # TODO: Implement real order execution
                order = {
                    'order_id': 'REAL_ORDER_PENDING',
                    'symbol': symbol,
                    'market': market,
                    'quantity': quantity,
                    'order_type': 'BUY',
                    'status': 'PENDING',
                    'timestamp': datetime.now().isoformat(),
                    'reason': reason,
                    'is_mock': False
                }
            except Exception as e:
                print(f"[ERROR] Real order failed: {e}")
                return {'error': str(e)}

        self.orders.append(order)
        self._update_position(order)

        return order

    def sell_market(
        self,
        symbol: str,
        market: str,
        quantity: int,
        reason: str = ""
    ) -> Dict:
        """Place market sell order"""

        current_price = self._get_current_price(symbol, market)

        if not self.use_real:
            order = {
                'order_id': f"MOCK_{int(datetime.now().timestamp() * 1000)}",
                'symbol': symbol,
                'market': market,
                'quantity': quantity,
                'order_type': 'SELL',
                'price_type': 'MARKET',
                'status': 'FILLED',
                'filled_price': current_price,
                'filled_quantity': quantity,
                'timestamp': datetime.now().isoformat(),
                'reason': reason,
                'is_mock': True
            }
            print(f"[MOCK SELL] {symbol} x{quantity} @ {current_price:,.0f}")
        else:
            # Real order
            order = {
                'order_id': 'REAL_ORDER_PENDING',
                'symbol': symbol,
                'market': market,
                'quantity': quantity,
                'order_type': 'SELL',
                'status': 'PENDING',
                'timestamp': datetime.now().isoformat(),
                'reason': reason,
                'is_mock': False
            }

        self.orders.append(order)
        self._update_position(order)

        return order

    def _get_current_price(self, symbol: str, market: str = "KR") -> float:
        """Get current price from KIS API"""
        try:
            from engine.data.kis_api import get_kis_client
            client = get_kis_client()
            if client.is_configured:
                price_data = client.get_current_price(symbol, market)
                if price_data:
                    for field in ["current_price", "stck_prpr", "close", "price"]:
                        if field in price_data:
                            return float(price_data[field])
        except Exception as e:
            print(f"[OrderManager] Price fetch error: {e}")

        # Fallback price
        return 50000.0 if market == "KR" else 100.0

    def _update_position(self, order: Dict):
        """Update position tracking"""
        symbol = order['symbol']
        quantity = order.get('filled_quantity', order['quantity'])
        price = order.get('filled_price', 0)
        market = order.get('market', 'KR')

        if order['order_type'] == 'BUY':
            if symbol not in self.positions:
                self.positions[symbol] = {
                    'quantity': 0,
                    'avg_price': 0,
                    'total_cost': 0,
                    'market': market
                }

            pos = self.positions[symbol]
            new_cost = price * quantity
            pos['total_cost'] += new_cost
            pos['quantity'] += quantity
            if pos['quantity'] > 0:
                pos['avg_price'] = pos['total_cost'] / pos['quantity']

        elif order['order_type'] == 'SELL':
            if symbol in self.positions:
                self.positions[symbol]['quantity'] -= quantity

                if self.positions[symbol]['quantity'] <= 0:
                    del self.positions[symbol]

    def get_position(self, symbol: str) -> Optional[Dict]:
        """Get current position"""
        return self.positions.get(symbol)

    def get_all_positions(self) -> Dict:
        """Get all positions"""
        return self.positions.copy()

    def get_order_history(self, limit: int = 100) -> List[Dict]:
        """Get order history"""
        return self.orders[-limit:]

    def get_total_pnl(self) -> float:
        """Calculate total P&L"""
        total = 0.0
        for symbol, pos in self.positions.items():
            market = pos.get('market', 'KR')
            current_price = self._get_current_price(symbol, market)
            pnl = (current_price - pos['avg_price']) * pos['quantity']
            total += pnl
        return total
