/**
 * Responsive design hook for LiquidityHunter
 *
 * Breakpoints:
 * - Mobile: < 768px (iPhone)
 * - Tablet: 768px - 1279px (iPad)
 * - Desktop: >= 1280px (Mac/PC)
 */

import { useState, useEffect, useCallback, createContext, useContext, type ReactNode } from 'react';

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export interface ResponsiveState {
  deviceType: DeviceType;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  width: number;
  height: number;
  isLandscape: boolean;
  isPortrait: boolean;
  // Touch device detection
  isTouchDevice: boolean;
}

// Breakpoints (in pixels)
const BREAKPOINTS = {
  mobile: 768,    // < 768px
  tablet: 1280,   // 768px - 1279px
  desktop: 1280,  // >= 1280px
} as const;

function getDeviceType(width: number): DeviceType {
  if (width < BREAKPOINTS.mobile) return 'mobile';
  if (width < BREAKPOINTS.desktop) return 'tablet';
  return 'desktop';
}

function isTouchDeviceCheck(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0
  );
}

export function useResponsive(): ResponsiveState {
  const [state, setState] = useState<ResponsiveState>(() => {
    if (typeof window === 'undefined') {
      return {
        deviceType: 'desktop',
        isMobile: false,
        isTablet: false,
        isDesktop: true,
        width: 1920,
        height: 1080,
        isLandscape: true,
        isPortrait: false,
        isTouchDevice: false,
      };
    }

    const width = window.innerWidth;
    const height = window.innerHeight;
    const deviceType = getDeviceType(width);

    return {
      deviceType,
      isMobile: deviceType === 'mobile',
      isTablet: deviceType === 'tablet',
      isDesktop: deviceType === 'desktop',
      width,
      height,
      isLandscape: width > height,
      isPortrait: height >= width,
      isTouchDevice: isTouchDeviceCheck(),
    };
  });

  const handleResize = useCallback(() => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const deviceType = getDeviceType(width);

    setState({
      deviceType,
      isMobile: deviceType === 'mobile',
      isTablet: deviceType === 'tablet',
      isDesktop: deviceType === 'desktop',
      width,
      height,
      isLandscape: width > height,
      isPortrait: height >= width,
      isTouchDevice: isTouchDeviceCheck(),
    });
  }, []);

  useEffect(() => {
    // Initial check
    handleResize();

    // Listen for resize events
    window.addEventListener('resize', handleResize);

    // Also listen for orientation change on mobile
    window.addEventListener('orientationchange', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [handleResize]);

  return state;
}

/**
 * Hook to get minimum touch target size based on device
 * Apple recommends 44x44pt, Google recommends 48x48dp
 */
export function useTouchTargetSize(): { minSize: number; padding: number } {
  const { isTouchDevice, isMobile, isTablet } = useResponsive();

  if (isTouchDevice || isMobile || isTablet) {
    return { minSize: 44, padding: 12 };
  }

  return { minSize: 32, padding: 8 };
}

/**
 * Context for responsive state to avoid prop drilling
 */
const ResponsiveContext = createContext<ResponsiveState | null>(null);

interface ResponsiveProviderProps {
  children: ReactNode;
}

export function ResponsiveProvider({ children }: ResponsiveProviderProps) {
  const responsive = useResponsive();

  return (
    <ResponsiveContext.Provider value={responsive}>
      {children}
    </ResponsiveContext.Provider>
  );
}

export function useResponsiveContext(): ResponsiveState {
  const context = useContext(ResponsiveContext);
  if (!context) {
    throw new Error('useResponsiveContext must be used within ResponsiveProvider');
  }
  return context;
}
