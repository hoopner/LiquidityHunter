/**
 * Market hours detection for Korean and US markets
 */

export type Market = 'KR' | 'US';

export interface MarketStatus {
  isOpen: boolean;
  label: string;
  labelKR: string;
  dotColor: string;
  textColor: string;
  animate: boolean;
  nextEvent: string;  // "Opens in 2h" or "Closes in 30m"
}

/**
 * Detect market based on symbol format
 */
export function getMarket(symbol: string): Market {
  // Korean stocks: 6-digit numbers (005930, 035720)
  if (/^\d{6}$/.test(symbol)) return 'KR';

  // Korean exchange suffixes (.KS, .KQ)
  if (symbol.endsWith('.KS') || symbol.endsWith('.KQ')) return 'KR';

  // Default to US
  return 'US';
}

/**
 * Check if market is currently open
 */
export function isMarketOpen(market: Market): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday, 6=Saturday

  // Weekend check - markets closed
  if (day === 0 || day === 6) return false;

  if (market === 'KR') {
    // Korea Standard Time (KST = UTC+9)
    const kstTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const hour = kstTime.getHours();
    const minute = kstTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;

    // Korean market: 9:00 AM - 3:30 PM KST
    const marketOpen = 9 * 60;        // 9:00 AM = 540 minutes
    const marketClose = 15 * 60 + 30; // 3:30 PM = 930 minutes

    return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  } else {
    // US Eastern Time (ET)
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;

    // US market: 9:30 AM - 4:00 PM ET
    const marketOpen = 9 * 60 + 30;  // 9:30 AM = 570 minutes
    const marketClose = 16 * 60;      // 4:00 PM = 960 minutes

    return timeInMinutes >= marketOpen && timeInMinutes < marketClose;
  }
}

/**
 * Get time until market opens or closes
 */
export function getTimeUntilEvent(market: Market): { event: 'open' | 'close'; minutes: number } {
  const now = new Date();

  if (market === 'KR') {
    const kstTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
    const hour = kstTime.getHours();
    const minute = kstTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60;
    const marketClose = 15 * 60 + 30;

    if (timeInMinutes < marketOpen) {
      return { event: 'open', minutes: marketOpen - timeInMinutes };
    } else if (timeInMinutes < marketClose) {
      return { event: 'close', minutes: marketClose - timeInMinutes };
    } else {
      // After close, calculate time until next day's open
      return { event: 'open', minutes: (24 * 60 - timeInMinutes) + marketOpen };
    }
  } else {
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = etTime.getHours();
    const minute = etTime.getMinutes();
    const timeInMinutes = hour * 60 + minute;

    const marketOpen = 9 * 60 + 30;
    const marketClose = 16 * 60;

    if (timeInMinutes < marketOpen) {
      return { event: 'open', minutes: marketOpen - timeInMinutes };
    } else if (timeInMinutes < marketClose) {
      return { event: 'close', minutes: marketClose - timeInMinutes };
    } else {
      return { event: 'open', minutes: (24 * 60 - timeInMinutes) + marketOpen };
    }
  }
}

/**
 * Format minutes as human-readable string
 */
function formatMinutes(minutes: number): string {
  if (minutes < 60) {
    return `${minutes}분`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) {
    return `${hours}시간`;
  }
  return `${hours}시간 ${mins}분`;
}

/**
 * Get complete market status for display
 */
export function getMarketStatus(market: Market): MarketStatus {
  const isOpen = isMarketOpen(market);
  const timeUntil = getTimeUntilEvent(market);

  if (isOpen) {
    return {
      isOpen: true,
      label: 'LIVE',
      labelKR: '실시간',
      dotColor: '#26a69a',  // Green
      textColor: '#26a69a',
      animate: true,
      nextEvent: `마감 ${formatMinutes(timeUntil.minutes)} 후`,
    };
  } else {
    const marketName = market === 'KR' ? '한국장' : 'US';
    const now = new Date();
    const day = now.getDay();

    // Weekend message
    if (day === 0 || day === 6) {
      return {
        isOpen: false,
        label: `${marketName} Closed`,
        labelKR: `${marketName} 휴장`,
        dotColor: '#6b7280',  // Gray
        textColor: '#6b7280',
        animate: false,
        nextEvent: '주말 휴장',
      };
    }

    return {
      isOpen: false,
      label: `${marketName} Closed`,
      labelKR: `${marketName} 마감`,
      dotColor: '#6b7280',  // Gray
      textColor: '#6b7280',
      animate: false,
      nextEvent: `개장 ${formatMinutes(timeUntil.minutes)} 후`,
    };
  }
}

/**
 * Format "time since" for last update display
 */
export function formatTimeSince(timestamp: Date | number): string {
  const now = Date.now();
  const time = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  const seconds = Math.floor((now - time) / 1000);

  if (seconds < 5) return '방금';
  if (seconds < 60) return `${seconds}초 전`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  // Show actual time if > 24 hours
  const date = new Date(time);
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}
