"""Trading module for automated trading"""
from .order_manager import OrderManager
from .strategy import TradingStrategy
from .bot import TradingBot

__all__ = ['OrderManager', 'TradingStrategy', 'TradingBot']
