/**
 * API Configuration for LiquidityHunter
 *
 * Supports:
 * - Local development (localhost:8000)
 * - ngrok tunneling for external access
 *
 * Set VITE_API_URL in .env.local for ngrok:
 * VITE_API_URL=https://your-tunnel.ngrok-free.app
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// WebSocket URL (derived from API URL)
export const WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');

// Log configuration on startup
if (import.meta.env.DEV) {
  console.log('[Config] API Base URL:', API_BASE_URL);
  console.log('[Config] WS Base URL:', WS_BASE_URL);
}
