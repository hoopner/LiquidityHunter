/**
 * Drawing Manager - handles state management and localStorage persistence
 */

import type {
  Drawing,
  HorizontalLineDrawing,
  VerticalLineDrawing,
  TrendlineDrawing,
  RectangleDrawing,
  FibonacciDrawing,
  ArrowDrawing,
  TextDrawing,
  Point,
} from '../types/drawings';
import { DEFAULT_DRAWING_VALUES, DRAWING_COLORS } from '../types/drawings';

export type DrawingChangeCallback = (drawings: Drawing[]) => void;

export type ChartType = 'main' | 'stoch_slow' | 'stoch_med' | 'stoch_fast' | 'rsi' | 'macd' | 'volume' | 'rsi_bb';

export class DrawingManager {
  private drawings: Map<string, Drawing> = new Map();
  private listeners: DrawingChangeCallback[] = [];
  private symbol: string;
  private timeframe: string;
  private chartType: ChartType;

  constructor(symbol: string, timeframe: string, chartType: ChartType = 'main') {
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.chartType = chartType;
    this.load();
  }

  private getStorageKey(): string {
    return `drawings_${this.symbol}_${this.timeframe}_${this.chartType}`;
  }

  getChartType(): ChartType {
    return this.chartType;
  }

  /**
   * Load drawings from localStorage
   */
  load(): void {
    try {
      const key = this.getStorageKey();
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored) as Drawing[];
        this.drawings.clear();
        parsed.forEach((d) => this.drawings.set(d.id, d));
      }
    } catch (e) {
      console.error('Failed to load drawings:', e);
    }
    this.notifyListeners();
  }

  /**
   * Save drawings to localStorage
   */
  private save(): void {
    try {
      const key = this.getStorageKey();
      const drawings = this.getAll();
      localStorage.setItem(key, JSON.stringify(drawings));
    } catch (e) {
      console.error('Failed to save drawings:', e);
    }
    this.notifyListeners();
  }

  /**
   * Switch to a different symbol/timeframe/chartType
   */
  switchContext(symbol: string, timeframe: string, chartType?: ChartType): void {
    this.symbol = symbol;
    this.timeframe = timeframe;
    if (chartType !== undefined) {
      this.chartType = chartType;
    }
    this.drawings.clear();
    this.load();
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all drawings
   */
  getAll(): Drawing[] {
    return Array.from(this.drawings.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get drawing by ID
   */
  get(id: string): Drawing | undefined {
    return this.drawings.get(id);
  }

  /**
   * Add a new drawing
   */
  add<T extends Drawing>(drawing: Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'visible' | 'locked'>): T {
    const now = Date.now();
    const newDrawing = {
      ...drawing,
      id: this.generateId(),
      visible: true,
      locked: false,
      createdAt: now,
      updatedAt: now,
    } as T;

    this.drawings.set(newDrawing.id, newDrawing);
    this.save();
    return newDrawing;
  }

  /**
   * Update a drawing
   */
  update(id: string, updates: Partial<Drawing>): Drawing | null {
    const drawing = this.drawings.get(id);
    if (!drawing) return null;

    const updated = {
      ...drawing,
      ...updates,
      id: drawing.id, // Preserve ID
      type: drawing.type, // Preserve type
      createdAt: drawing.createdAt, // Preserve creation time
      updatedAt: Date.now(),
    } as Drawing;

    this.drawings.set(id, updated);
    this.save();
    return updated;
  }

  /**
   * Delete a drawing
   */
  delete(id: string): boolean {
    const deleted = this.drawings.delete(id);
    if (deleted) {
      this.save();
    }
    return deleted;
  }

  /**
   * Clear all drawings
   */
  clearAll(): void {
    this.drawings.clear();
    this.save();
  }

  /**
   * Subscribe to changes
   */
  subscribe(callback: DrawingChangeCallback): () => void {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners(): void {
    const drawings = this.getAll();
    this.listeners.forEach((l) => l(drawings));
  }

  // Factory methods for creating specific drawing types

  createHorizontalLine(price: number, options?: Partial<Omit<HorizontalLineDrawing, 'type' | 'price'>>): HorizontalLineDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.horizontal_line;
    return this.add({
      type: 'horizontal_line',
      price,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      extendLeft: options?.extendLeft ?? defaults.extendLeft,
      extendRight: options?.extendRight ?? defaults.extendRight,
      lineStyle: options?.lineStyle ?? defaults.lineStyle,
      label: options?.label,
    }) as HorizontalLineDrawing;
  }

  createVerticalLine(time: string, options?: Partial<Omit<VerticalLineDrawing, 'type' | 'time'>>): VerticalLineDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.vertical_line;
    return this.add({
      type: 'vertical_line',
      time,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      lineStyle: options?.lineStyle ?? defaults.lineStyle,
      label: options?.label,
    }) as VerticalLineDrawing;
  }

  createTrendline(
    startPoint: Point,
    endPoint: Point,
    options?: Partial<Omit<TrendlineDrawing, 'type' | 'startPoint' | 'endPoint'>>
  ): TrendlineDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.trendline;
    return this.add({
      type: 'trendline',
      startPoint,
      endPoint,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      extendLeft: options?.extendLeft ?? defaults.extendLeft,
      extendRight: options?.extendRight ?? defaults.extendRight,
      lineStyle: options?.lineStyle ?? defaults.lineStyle,
      label: options?.label,
    }) as TrendlineDrawing;
  }

  createRectangle(
    startPoint: Point,
    endPoint: Point,
    options?: Partial<Omit<RectangleDrawing, 'type' | 'startPoint' | 'endPoint'>>
  ): RectangleDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.rectangle;
    return this.add({
      type: 'rectangle',
      startPoint,
      endPoint,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      fillOpacity: options?.fillOpacity ?? defaults.fillOpacity,
      borderStyle: options?.borderStyle ?? defaults.borderStyle,
      label: options?.label,
    }) as RectangleDrawing;
  }

  createFibonacci(
    startPoint: Point,
    endPoint: Point,
    options?: Partial<Omit<FibonacciDrawing, 'type' | 'startPoint' | 'endPoint'>>
  ): FibonacciDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.fibonacci;
    return this.add({
      type: 'fibonacci',
      startPoint,
      endPoint,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      levels: options?.levels ?? defaults.levels,
      showExtensions: options?.showExtensions ?? defaults.showExtensions,
      extensionLevels: options?.extensionLevels ?? defaults.extensionLevels,
      showPrices: options?.showPrices ?? defaults.showPrices,
      levelColors: options?.levelColors ?? defaults.levelColors,
      label: options?.label,
    }) as FibonacciDrawing;
  }

  createArrow(
    point: Point,
    direction: 'up' | 'down',
    options?: Partial<Omit<ArrowDrawing, 'type' | 'point' | 'direction'>>
  ): ArrowDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.arrow;
    const color = direction === 'up' ? DRAWING_COLORS.BULL : DRAWING_COLORS.BEAR;
    return this.add({
      type: 'arrow',
      point,
      direction,
      color: options?.color ?? color,
      thickness: options?.thickness ?? defaults.thickness,
      size: options?.size ?? defaults.size,
      label: options?.label,
    }) as ArrowDrawing;
  }

  createText(
    point: Point,
    text: string,
    options?: Partial<Omit<TextDrawing, 'type' | 'point' | 'text'>>
  ): TextDrawing {
    const defaults = DEFAULT_DRAWING_VALUES.text;
    return this.add({
      type: 'text',
      point,
      text,
      color: options?.color ?? defaults.color,
      thickness: options?.thickness ?? defaults.thickness,
      fontSize: options?.fontSize ?? defaults.fontSize,
      backgroundColor: options?.backgroundColor ?? defaults.backgroundColor,
      backgroundOpacity: options?.backgroundOpacity ?? defaults.backgroundOpacity,
      label: options?.label,
    }) as TextDrawing;
  }
}

/**
 * Singleton instance per symbol/timeframe/chartType combination
 */
const managers: Map<string, DrawingManager> = new Map();

export function getDrawingManager(symbol: string, timeframe: string, chartType: ChartType = 'main'): DrawingManager {
  const key = `${symbol}_${timeframe}_${chartType}`;
  let manager = managers.get(key);
  if (!manager) {
    manager = new DrawingManager(symbol, timeframe, chartType);
    managers.set(key, manager);
  }
  return manager;
}
