/**
 * Drawing types for ICT/SMC chart annotations
 */

export type DrawingType =
  | 'horizontal_line'
  | 'vertical_line'
  | 'trendline'
  | 'rectangle'
  | 'fibonacci'
  | 'arrow'
  | 'text';

export type DrawingToolType = DrawingType | 'select' | 'delete';

export interface Point {
  time: string | number; // ISO date string for daily, Unix timestamp for intraday
  price: number;
  x?: number; // Pixel coordinate (computed)
  y?: number; // Pixel coordinate (computed)
}

export interface BaseDrawing {
  id: string;
  type: DrawingType;
  color: string;
  thickness: number;
  label?: string;
  visible: boolean;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface HorizontalLineDrawing extends BaseDrawing {
  type: 'horizontal_line';
  price: number;
  extendLeft: boolean;
  extendRight: boolean;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface VerticalLineDrawing extends BaseDrawing {
  type: 'vertical_line';
  time: string | number; // ISO date string for daily, Unix timestamp for intraday
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface TrendlineDrawing extends BaseDrawing {
  type: 'trendline';
  startPoint: Point;
  endPoint: Point;
  extendLeft: boolean;
  extendRight: boolean;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

export interface RectangleDrawing extends BaseDrawing {
  type: 'rectangle';
  startPoint: Point;
  endPoint: Point;
  fillOpacity: number;
  borderStyle: 'solid' | 'dashed' | 'dotted';
}

export interface FibonacciDrawing extends BaseDrawing {
  type: 'fibonacci';
  startPoint: Point;
  endPoint: Point;
  levels: number[];
  showExtensions: boolean;
  extensionLevels: number[];
  showPrices: boolean;
  levelColors: Record<number, string>;
}

export interface ArrowDrawing extends BaseDrawing {
  type: 'arrow';
  point: Point;
  direction: 'up' | 'down';
  size: 'small' | 'medium' | 'large';
}

export interface TextDrawing extends BaseDrawing {
  type: 'text';
  point: Point;
  text: string;
  fontSize: number;
  backgroundColor: string;
  backgroundOpacity: number;
}

export type Drawing =
  | HorizontalLineDrawing
  | VerticalLineDrawing
  | TrendlineDrawing
  | RectangleDrawing
  | FibonacciDrawing
  | ArrowDrawing
  | TextDrawing;

// Default colors matching existing theme
export const DRAWING_COLORS = {
  OB: '#fbbf24',       // Yellow
  FVG: '#22d3d8',      // Cyan
  BULL: '#22c55e',     // Green
  BEAR: '#ef4444',     // Red
  TRENDLINE: '#ffffff', // White
  FIBONACCI: '#a855f7', // Purple
  DEFAULT: '#6b7280',  // Gray
};

// Default Fibonacci levels
export const FIBONACCI_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
export const FIBONACCI_EXTENSIONS = [1.272, 1.618, 2.0, 2.618];

// Arrow sizes in pixels
export const ARROW_SIZES = {
  small: 12,
  medium: 18,
  large: 26,
};

// Line thickness options
export const LINE_THICKNESS_OPTIONS = [1, 2, 3, 4, 5];

// Default values for new drawings
export const DEFAULT_DRAWING_VALUES = {
  horizontal_line: {
    color: DRAWING_COLORS.DEFAULT,
    thickness: 2,
    extendLeft: true,
    extendRight: true,
    lineStyle: 'solid' as const,
  },
  vertical_line: {
    color: DRAWING_COLORS.DEFAULT,
    thickness: 1,
    lineStyle: 'dashed' as const,
  },
  trendline: {
    color: DRAWING_COLORS.TRENDLINE,
    thickness: 2,
    extendLeft: false,
    extendRight: false,
    lineStyle: 'solid' as const,
  },
  rectangle: {
    color: DRAWING_COLORS.OB,
    thickness: 2,
    fillOpacity: 0.2,
    borderStyle: 'solid' as const,
  },
  fibonacci: {
    color: DRAWING_COLORS.FIBONACCI,
    thickness: 1,
    levels: FIBONACCI_LEVELS,
    showExtensions: false,
    extensionLevels: FIBONACCI_EXTENSIONS,
    showPrices: true,
    levelColors: {
      0: '#ef4444',
      0.236: '#f97316',
      0.382: '#eab308',
      0.5: '#22c55e',
      0.618: '#06b6d4',
      0.786: '#3b82f6',
      1.0: '#8b5cf6',
      1.272: '#d946ef',
      1.618: '#ec4899',
    },
  },
  arrow: {
    color: DRAWING_COLORS.BULL,
    thickness: 2,
    direction: 'up' as const,
    size: 'medium' as const,
  },
  text: {
    color: '#ffffff',
    thickness: 1,
    fontSize: 14,
    backgroundColor: '#1e222d',
    backgroundOpacity: 0.9,
  },
};

// Tool icons and labels
export const TOOL_CONFIG: Record<DrawingToolType, { icon: string; label: string; labelKo: string }> = {
  select: { icon: '↖', label: 'Select', labelKo: '선택' },
  horizontal_line: { icon: '─', label: 'Horizontal Line', labelKo: '수평선' },
  vertical_line: { icon: '│', label: 'Vertical Line', labelKo: '수직선' },
  trendline: { icon: '╱', label: 'Trendline', labelKo: '추세선' },
  rectangle: { icon: '▢', label: 'Rectangle', labelKo: '사각형' },
  fibonacci: { icon: '📐', label: 'Fibonacci', labelKo: '피보나치' },
  arrow: { icon: '▲', label: 'Arrow', labelKo: '화살표' },
  text: { icon: 'T', label: 'Text', labelKo: '텍스트' },
  delete: { icon: '🗑️', label: 'Delete', labelKo: '삭제' },
};
