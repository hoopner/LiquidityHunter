/**
 * Drawing Canvas - Renders drawings and handles interactions
 *
 * FIXED ISSUES:
 * 1. Chart zoom/pan now works even in drawing mode (wheel events pass through)
 * 2. Drawings use proper price/time coordinates that work at any zoom level
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type {
  Drawing,
  DrawingToolType,
  Point,
  HorizontalLineDrawing,
  VerticalLineDrawing,
  TrendlineDrawing,
  RectangleDrawing,
  FibonacciDrawing,
  ArrowDrawing,
  TextDrawing,
} from '../../types/drawings';
import { ARROW_SIZES, DRAWING_COLORS } from '../../types/drawings';
import { DrawingManager } from '../../utils/DrawingManager';

interface DrawingCanvasProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Candlestick'> | null;
  drawings: Drawing[];
  manager: DrawingManager;
  activeTool: DrawingToolType | null;
  selectedDrawingId: string | null;
  onDrawingSelect: (id: string | null) => void;
  onDrawingComplete: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
  data: { bars: Array<{ time: string; open: number; high: number; low: number; close: number }> } | null;
  // For coordination with subcharts - when multiple charts can have drawings
  isActiveChart?: boolean;
  onChartActivate?: () => void;
}

interface DragState {
  type: 'move' | 'resize';
  drawingId: string;
  handle?: 'tl' | 'tr' | 'bl' | 'br' | 'start' | 'end';
  startX: number;
  startY: number;
  originalDrawing: Drawing;
}

export function DrawingCanvas({
  chart,
  series,
  drawings,
  manager,
  activeTool,
  selectedDrawingId,
  onDrawingSelect,
  onDrawingComplete,
  containerRef,
  data,
  isActiveChart: _isActiveChart = true,
  onChartActivate,
}: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; drawingId: string } | null>(null);
  const [textInput, setTextInput] = useState<{ point: Point; visible: boolean }>({ point: { time: '', price: 0 }, visible: false });
  const [textValue, setTextValue] = useState('');

  // Track if mouse is currently pressed (for distinguishing click vs drag)
  const mouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingChartRef = useRef(false);

  // Convert pixel coordinates to price/time using chart APIs
  const pixelToPoint = useCallback(
    (x: number, y: number): Point | null => {
      if (!chart || !series || !data || data.bars.length === 0) return null;

      // Get price from y coordinate
      const price = series.coordinateToPrice(y);
      if (price === null) return null;

      // Get time from x coordinate - use coordinateToTime for accurate conversion
      const timeScale = chart.timeScale();
      const time = timeScale.coordinateToTime(x);

      // If coordinateToTime returns null (outside visible range), fall back to logical index
      if (time === null) {
        const logicalIndex = timeScale.coordinateToLogical(x);
        if (logicalIndex === null) return null;

        const barIndex = Math.round(logicalIndex);
        const clampedIndex = Math.max(0, Math.min(barIndex, data.bars.length - 1));
        const fallbackTime = data.bars[clampedIndex]?.time || '';
        return { time: fallbackTime, price, x, y };
      }

      // Convert Time to string format
      const timeStr = typeof time === 'string' ? time :
                     typeof time === 'number' ? new Date(time * 1000).toISOString().split('T')[0] :
                     `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;

      return { time: timeStr, price, x, y };
    },
    [chart, series, data]
  );

  // Convert point to pixel coordinates
  const pointToPixel = useCallback(
    (point: Point): { x: number; y: number } | null => {
      if (!chart || !series) return null;

      const y = series.priceToCoordinate(point.price);
      if (y === null) return null;

      const x = chart.timeScale().timeToCoordinate(point.time as Time);
      if (x === null) return null;

      return { x, y };
    },
    [chart, series]
  );


  // Get cursor style based on active tool
  const getCursorStyle = (): string => {
    if (dragState) return dragState.type === 'resize' ? 'nwse-resize' : 'move';
    if (!activeTool) return 'default';
    if (activeTool === 'select') return 'default';
    if (activeTool === 'delete') return 'not-allowed';
    return 'crosshair';
  };

  // Draw all drawings on canvas
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !chart || !series) return;

    // Resize canvas to match container
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each drawing
    drawings.forEach((drawing) => {
      if (!drawing.visible) return;

      const isSelected = drawing.id === selectedDrawingId;

      switch (drawing.type) {
        case 'horizontal_line':
          renderHorizontalLine(ctx, drawing, canvas.width, isSelected);
          break;
        case 'vertical_line':
          renderVerticalLine(ctx, drawing, canvas.height, isSelected);
          break;
        case 'trendline':
          renderTrendline(ctx, drawing, canvas.width, canvas.height, isSelected);
          break;
        case 'rectangle':
          renderRectangle(ctx, drawing, isSelected);
          break;
        case 'fibonacci':
          renderFibonacci(ctx, drawing, canvas.width, isSelected);
          break;
        case 'arrow':
          renderArrow(ctx, drawing, isSelected);
          break;
        case 'text':
          renderText(ctx, drawing, isSelected);
          break;
      }
    });

    // Draw preview for current drawing
    if (isDrawing && drawingStart && currentPoint && activeTool) {
      ctx.globalAlpha = 0.7;
      renderPreview(ctx, activeTool, drawingStart, currentPoint, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }, [drawings, selectedDrawingId, isDrawing, drawingStart, currentPoint, activeTool, chart, series, containerRef]);

  // Render functions for each drawing type
  const renderHorizontalLine = (
    ctx: CanvasRenderingContext2D,
    drawing: HorizontalLineDrawing,
    canvasWidth: number,
    isSelected: boolean
  ) => {
    const y = series?.priceToCoordinate(drawing.price);
    if (y === null || y === undefined) return;

    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    setLineStyle(ctx, drawing.lineStyle);

    const leftX = drawing.extendLeft ? 0 : 50;
    const rightX = drawing.extendRight ? canvasWidth - 60 : canvasWidth - 120;

    ctx.moveTo(leftX, y);
    ctx.lineTo(rightX, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    if (drawing.label) {
      renderLabel(ctx, drawing.label, leftX + 4, y - 6, drawing.color);
    }

    // Price label on right side
    const priceText = drawing.price.toLocaleString(undefined, { maximumFractionDigits: 2 });
    ctx.font = '10px monospace';
    ctx.fillStyle = drawing.color;
    ctx.fillText(priceText, rightX - ctx.measureText(priceText).width - 4, y - 4);

    // Selection indicator
    if (isSelected) {
      renderSelectionHandles(ctx, [
        { x: leftX, y },
        { x: rightX, y },
      ]);
    }
  };

  const renderVerticalLine = (
    ctx: CanvasRenderingContext2D,
    drawing: VerticalLineDrawing,
    canvasHeight: number,
    isSelected: boolean
  ) => {
    const x = chart?.timeScale().timeToCoordinate(drawing.time as Time);
    if (x === null || x === undefined) return;

    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    setLineStyle(ctx, drawing.lineStyle);

    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasHeight - 22);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    if (drawing.label) {
      renderLabel(ctx, drawing.label, x + 4, 16, drawing.color);
    }

    // Selection indicator
    if (isSelected) {
      renderSelectionHandles(ctx, [
        { x, y: 10 },
        { x, y: canvasHeight - 32 },
      ]);
    }
  };

  const renderTrendline = (
    ctx: CanvasRenderingContext2D,
    drawing: TrendlineDrawing,
    canvasWidth: number,
    _canvasHeight: number,
    isSelected: boolean
  ) => {
    const start = pointToPixel(drawing.startPoint);
    const end = pointToPixel(drawing.endPoint);
    if (!start || !end) return;

    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    setLineStyle(ctx, drawing.lineStyle);

    if (drawing.extendLeft || drawing.extendRight) {
      // Calculate slope and extend line
      const slope = (end.y - start.y) / (end.x - start.x);
      const intercept = start.y - slope * start.x;

      const x1 = drawing.extendLeft ? 0 : start.x;
      const x2 = drawing.extendRight ? canvasWidth - 60 : end.x;
      const y1 = slope * x1 + intercept;
      const y2 = slope * x2 + intercept;

      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    } else {
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
    }

    ctx.stroke();
    ctx.setLineDash([]);

    // Label
    if (drawing.label) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      renderLabel(ctx, drawing.label, midX, midY - 10, drawing.color);
    }

    // Selection handles
    if (isSelected) {
      renderSelectionHandles(ctx, [start, end]);
    }
  };

  const renderRectangle = (
    ctx: CanvasRenderingContext2D,
    drawing: RectangleDrawing,
    isSelected: boolean
  ) => {
    const start = pointToPixel(drawing.startPoint);
    const end = pointToPixel(drawing.endPoint);
    if (!start || !end) return;

    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    // Fill
    ctx.fillStyle = hexToRgba(drawing.color, drawing.fillOpacity);
    ctx.fillRect(x, y, width, height);

    // Border
    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    setLineStyle(ctx, drawing.borderStyle);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);

    // Label
    if (drawing.label) {
      renderLabel(ctx, drawing.label, x + 4, y + 14, drawing.color);
    }

    // Selection handles (4 corners)
    if (isSelected) {
      renderSelectionHandles(ctx, [
        { x, y },
        { x: x + width, y },
        { x, y: y + height },
        { x: x + width, y: y + height },
      ]);
    }
  };

  const renderFibonacci = (
    ctx: CanvasRenderingContext2D,
    drawing: FibonacciDrawing,
    canvasWidth: number,
    isSelected: boolean
  ) => {
    const start = pointToPixel(drawing.startPoint);
    const end = pointToPixel(drawing.endPoint);
    if (!start || !end) return;

    const priceRange = drawing.startPoint.price - drawing.endPoint.price;
    const allLevels = [...drawing.levels, ...(drawing.showExtensions ? drawing.extensionLevels : [])];

    allLevels.forEach((level) => {
      const price = drawing.endPoint.price + priceRange * level;
      const y = series?.priceToCoordinate(price);
      if (y === null || y === undefined) return;

      const levelColor = drawing.levelColors[level] || drawing.color;

      ctx.beginPath();
      ctx.strokeStyle = levelColor;
      ctx.lineWidth = level === 0.5 || level === 0.618 ? 2 : 1;
      ctx.setLineDash(level > 1 ? [5, 5] : []);
      ctx.moveTo(Math.min(start.x, end.x), y);
      ctx.lineTo(canvasWidth - 60, y);
      ctx.stroke();

      // Level label
      const labelText = drawing.showPrices
        ? `${(level * 100).toFixed(1)}% (${price.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
        : `${(level * 100).toFixed(1)}%`;

      ctx.font = '11px monospace';
      ctx.fillStyle = levelColor;
      ctx.fillText(labelText, Math.min(start.x, end.x) + 4, y - 3);
    });

    ctx.setLineDash([]);

    // Vertical guide line
    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Selection handles
    if (isSelected) {
      renderSelectionHandles(ctx, [start, end]);
    }
  };

  const renderArrow = (
    ctx: CanvasRenderingContext2D,
    drawing: ArrowDrawing,
    isSelected: boolean
  ) => {
    const pos = pointToPixel(drawing.point);
    if (!pos) return;

    const size = ARROW_SIZES[drawing.size];
    const isUp = drawing.direction === 'up';

    ctx.beginPath();
    ctx.fillStyle = drawing.color;

    if (isUp) {
      // Up arrow (triangle pointing up)
      ctx.moveTo(pos.x, pos.y - size / 2);
      ctx.lineTo(pos.x - size / 2, pos.y + size / 2);
      ctx.lineTo(pos.x + size / 2, pos.y + size / 2);
    } else {
      // Down arrow (triangle pointing down)
      ctx.moveTo(pos.x, pos.y + size / 2);
      ctx.lineTo(pos.x - size / 2, pos.y - size / 2);
      ctx.lineTo(pos.x + size / 2, pos.y - size / 2);
    }

    ctx.closePath();
    ctx.fill();

    // Label
    if (drawing.label) {
      const labelY = isUp ? pos.y - size / 2 - 8 : pos.y + size / 2 + 14;
      renderLabel(ctx, drawing.label, pos.x - 10, labelY, drawing.color);
    }

    // Selection indicator
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x - size / 2 - 2, pos.y - size / 2 - 2, size + 4, size + 4);
    }
  };

  const renderText = (
    ctx: CanvasRenderingContext2D,
    drawing: TextDrawing,
    isSelected: boolean
  ) => {
    const pos = pointToPixel(drawing.point);
    if (!pos) return;

    ctx.font = `${drawing.fontSize}px sans-serif`;
    const metrics = ctx.measureText(drawing.text);
    const padding = 6;
    const bgWidth = metrics.width + padding * 2;
    const bgHeight = drawing.fontSize + padding * 2;

    // Background
    ctx.fillStyle = hexToRgba(drawing.backgroundColor, drawing.backgroundOpacity);
    ctx.fillRect(pos.x - padding, pos.y - drawing.fontSize - padding / 2, bgWidth, bgHeight);

    // Text
    ctx.fillStyle = drawing.color;
    ctx.fillText(drawing.text, pos.x, pos.y);

    // Selection border
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(pos.x - padding - 1, pos.y - drawing.fontSize - padding / 2 - 1, bgWidth + 2, bgHeight + 2);
    }
  };

  const renderPreview = (
    ctx: CanvasRenderingContext2D,
    tool: DrawingToolType,
    start: Point,
    current: Point,
    canvasWidth: number,
    canvasHeight: number
  ) => {
    const startPixel = pointToPixel(start) || { x: start.x || 0, y: start.y || 0 };
    const currentPixel = pointToPixel(current) || { x: current.x || 0, y: current.y || 0 };

    ctx.strokeStyle = DRAWING_COLORS.DEFAULT;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    switch (tool) {
      case 'horizontal_line':
        ctx.beginPath();
        ctx.moveTo(0, currentPixel.y);
        ctx.lineTo(canvasWidth - 60, currentPixel.y);
        ctx.stroke();
        // Show price
        const hlPrice = series?.coordinateToPrice(currentPixel.y);
        if (hlPrice !== null && hlPrice !== undefined) {
          ctx.font = '12px monospace';
          ctx.fillStyle = DRAWING_COLORS.DEFAULT;
          ctx.fillText(hlPrice.toLocaleString(undefined, { maximumFractionDigits: 2 }), 10, currentPixel.y - 5);
        }
        break;

      case 'vertical_line':
        ctx.beginPath();
        ctx.moveTo(currentPixel.x, 0);
        ctx.lineTo(currentPixel.x, canvasHeight - 22);
        ctx.stroke();
        break;

      case 'trendline':
      case 'fibonacci':
        ctx.beginPath();
        ctx.moveTo(startPixel.x, startPixel.y);
        ctx.lineTo(currentPixel.x, currentPixel.y);
        ctx.stroke();
        break;

      case 'rectangle':
        ctx.beginPath();
        ctx.strokeRect(
          Math.min(startPixel.x, currentPixel.x),
          Math.min(startPixel.y, currentPixel.y),
          Math.abs(currentPixel.x - startPixel.x),
          Math.abs(currentPixel.y - startPixel.y)
        );
        break;

      case 'arrow':
        const arrowCurrentY = currentPixel.y;
        const arrowStartY = startPixel.y;
        ctx.fillStyle = arrowCurrentY < arrowStartY ? DRAWING_COLORS.BULL : DRAWING_COLORS.BEAR;
        const size = 18;
        const isUp = arrowCurrentY < arrowStartY;
        ctx.beginPath();
        if (isUp) {
          ctx.moveTo(currentPixel.x, currentPixel.y - size / 2);
          ctx.lineTo(currentPixel.x - size / 2, currentPixel.y + size / 2);
          ctx.lineTo(currentPixel.x + size / 2, currentPixel.y + size / 2);
        } else {
          ctx.moveTo(currentPixel.x, currentPixel.y + size / 2);
          ctx.lineTo(currentPixel.x - size / 2, currentPixel.y - size / 2);
          ctx.lineTo(currentPixel.x + size / 2, currentPixel.y - size / 2);
        }
        ctx.closePath();
        ctx.fill();
        break;
    }

    ctx.setLineDash([]);
  };

  const renderLabel = (
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    color: string
  ) => {
    ctx.font = '11px sans-serif';
    const metrics = ctx.measureText(text);
    const padding = 3;

    ctx.fillStyle = 'rgba(30, 34, 45, 0.9)';
    ctx.fillRect(x - padding, y - 11, metrics.width + padding * 2, 14);

    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  const renderSelectionHandles = (
    ctx: CanvasRenderingContext2D,
    points: Array<{ x: number; y: number }>
  ) => {
    const handleSize = 8;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;

    points.forEach((p) => {
      ctx.beginPath();
      ctx.rect(p.x - handleSize / 2, p.y - handleSize / 2, handleSize, handleSize);
      ctx.fill();
      ctx.stroke();
    });
  };

  // Utility functions
  const setLineStyle = (ctx: CanvasRenderingContext2D, style: 'solid' | 'dashed' | 'dotted') => {
    switch (style) {
      case 'dashed':
        ctx.setLineDash([8, 4]);
        break;
      case 'dotted':
        ctx.setLineDash([2, 2]);
        break;
      default:
        ctx.setLineDash([]);
    }
  };

  const hexToRgba = (hex: string, alpha: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  // Hit testing for drawing selection
  const hitTest = (x: number, y: number, tolerance: number = 8): Drawing | null => {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const drawing = drawings[i];
      if (!drawing.visible) continue;

      switch (drawing.type) {
        case 'horizontal_line': {
          const lineY = series?.priceToCoordinate(drawing.price);
          if (lineY !== null && lineY !== undefined && Math.abs(y - lineY) <= tolerance) {
            return drawing;
          }
          break;
        }
        case 'vertical_line': {
          const lineX = chart?.timeScale().timeToCoordinate(drawing.time as Time);
          if (lineX !== null && lineX !== undefined && Math.abs(x - lineX) <= tolerance) {
            return drawing;
          }
          break;
        }
        case 'rectangle': {
          const start = pointToPixel(drawing.startPoint);
          const end = pointToPixel(drawing.endPoint);
          if (start && end) {
            const minX = Math.min(start.x, end.x);
            const maxX = Math.max(start.x, end.x);
            const minY = Math.min(start.y, end.y);
            const maxY = Math.max(start.y, end.y);
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              return drawing;
            }
          }
          break;
        }
        case 'trendline':
        case 'fibonacci': {
          const start = pointToPixel(drawing.startPoint);
          const end = pointToPixel(drawing.endPoint);
          if (start && end) {
            const dist = pointToLineDistance(x, y, start.x, start.y, end.x, end.y);
            if (dist <= tolerance) {
              return drawing;
            }
          }
          break;
        }
        case 'arrow': {
          const pos = pointToPixel(drawing.point);
          if (pos) {
            const size = ARROW_SIZES[drawing.size];
            if (Math.abs(x - pos.x) <= size && Math.abs(y - pos.y) <= size) {
              return drawing;
            }
          }
          break;
        }
        case 'text': {
          const pos = pointToPixel(drawing.point);
          if (pos) {
            // Approximate text bounds
            const width = drawing.text.length * drawing.fontSize * 0.6;
            const height = drawing.fontSize + 12;
            if (x >= pos.x - 6 && x <= pos.x + width && y >= pos.y - height && y <= pos.y + 6) {
              return drawing;
            }
          }
          break;
        }
      }
    }
    return null;
  };

  const pointToLineDistance = (
    px: number,
    py: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number
  ): number => {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;

    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;

    if (param < 0) {
      xx = x1;
      yy = y1;
    } else if (param > 1) {
      xx = x2;
      yy = y2;
    } else {
      xx = x1 + param * C;
      yy = y1 + param * D;
    }

    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Mouse event handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only handle left clicks
    if (e.button !== 0) return;

    if (!chart || !series) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Activate this chart for drawing (for coordination with subcharts)
    onChartActivate?.();

    // Record mouse down position to distinguish click from drag
    mouseDownRef.current = { x, y, time: Date.now() };
    isDraggingChartRef.current = false;

    // Close context menu if open
    setContextMenu(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if user is dragging (moving while mouse down)
    if (mouseDownRef.current) {
      const dx = Math.abs(x - mouseDownRef.current.x);
      const dy = Math.abs(y - mouseDownRef.current.y);
      // If moved more than 5 pixels, consider it a drag (for chart panning)
      if (dx > 5 || dy > 5) {
        isDraggingChartRef.current = true;
      }
    }

    // Handle dragging existing drawings
    if (dragState) {
      // TODO: Implement actual drawing movement
      return;
    }

    // Update preview during drawing
    if (isDrawing) {
      const point = pixelToPoint(x, y);
      if (point) {
        setCurrentPoint({ ...point, x, y });
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!chart || !series) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if this was a click (not a drag)
    const wasClick = mouseDownRef.current &&
                     !isDraggingChartRef.current &&
                     Date.now() - mouseDownRef.current.time < 500;

    mouseDownRef.current = null;

    // If user was dragging the chart (panning), don't process as drawing click
    if (isDraggingChartRef.current) {
      isDraggingChartRef.current = false;

      // Still handle drag state cleanup
      if (dragState) {
        setDragState(null);
      }
      return;
    }

    isDraggingChartRef.current = false;

    if (dragState) {
      setDragState(null);
      return;
    }

    // Only process drawing actions if it was a click
    if (!wasClick) return;

    const point = pixelToPoint(x, y);

    // Handle delete mode
    if (activeTool === 'delete') {
      const hit = hitTest(x, y);
      if (hit) {
        manager.delete(hit.id);
      }
      return;
    }

    // Handle select mode or no tool
    if (!activeTool || activeTool === 'select') {
      const hit = hitTest(x, y);
      if (hit) {
        onDrawingSelect(hit.id);
      } else {
        onDrawingSelect(null);
      }
      return;
    }

    // Handle drawing tools
    if (point) {
      // Single-click tools
      if (activeTool === 'horizontal_line') {
        manager.createHorizontalLine(point.price);
        onDrawingComplete();
        return;
      }

      if (activeTool === 'vertical_line') {
        manager.createVerticalLine(point.time);
        onDrawingComplete();
        return;
      }

      if (activeTool === 'text') {
        setTextInput({ point, visible: true });
        setTextValue('');
        return;
      }

      if (activeTool === 'arrow') {
        // For arrow, place immediately on click (use previous mouse position for direction)
        const direction = currentPoint && currentPoint.y !== undefined && point.y !== undefined
          ? (point.y < currentPoint.y ? 'up' : 'down')
          : 'up';
        manager.createArrow(
          { time: point.time, price: point.price },
          direction
        );
        onDrawingComplete();
        return;
      }

      // Two-click tools (trendline, rectangle, fibonacci)
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingStart({ ...point, x, y });
        setCurrentPoint({ ...point, x, y });
      } else if (drawingStart) {
        // Complete the drawing
        completeDrawing(activeTool, drawingStart, { ...point, x, y });
        setIsDrawing(false);
        setDrawingStart(null);
        setCurrentPoint(null);
        onDrawingComplete();
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(x, y);
    if (hit) {
      onDrawingSelect(hit.id);
      setContextMenu({ x: e.clientX, y: e.clientY, drawingId: hit.id });
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = hitTest(x, y);
    if (hit) {
      // TODO: Open property editor
      onDrawingSelect(hit.id);
    }
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // ESC to cancel drawing
    if (e.key === 'Escape') {
      setIsDrawing(false);
      setDrawingStart(null);
      setCurrentPoint(null);
      setTextInput({ point: { time: '', price: 0 }, visible: false });
      onDrawingSelect(null);
    }

    // Delete selected drawing
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
      manager.delete(selectedDrawingId);
      onDrawingSelect(null);
    }
  }, [selectedDrawingId, manager, onDrawingSelect]);

  const completeDrawing = (tool: DrawingToolType, start: Point, end: Point) => {
    switch (tool) {
      case 'trendline':
        manager.createTrendline(
          { time: start.time, price: start.price },
          { time: end.time, price: end.price }
        );
        break;
      case 'rectangle':
        manager.createRectangle(
          { time: start.time, price: start.price },
          { time: end.time, price: end.price }
        );
        break;
      case 'fibonacci':
        manager.createFibonacci(
          { time: start.time, price: start.price },
          { time: end.time, price: end.price }
        );
        break;
    }
  };

  const handleTextSubmit = () => {
    if (textValue.trim() && textInput.visible) {
      manager.createText(
        { time: textInput.point.time, price: textInput.point.price },
        textValue.trim()
      );
      setTextInput({ point: { time: '', price: 0 }, visible: false });
      setTextValue('');
      onDrawingComplete();
    }
  };

  // Setup event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Render on changes
  useEffect(() => {
    render();
  }, [render]);

  // Re-render on chart scroll/zoom
  useEffect(() => {
    if (!chart) return;

    const handleVisibleRangeChange = () => {
      render();
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
    };
  }, [chart, render]);

  // Determine if canvas should capture mouse events
  // Only intercept when we have an active drawing tool (not select)
  const shouldCaptureEvents = activeTool !== null && activeTool !== 'select';

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{
          cursor: getCursorStyle(),
          // Key fix: Only capture pointer events when we need to draw
          // Otherwise, let events pass through to the chart for zoom/pan
          pointerEvents: shouldCaptureEvents || isDrawing ? 'auto' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          mouseDownRef.current = null;
          isDraggingChartRef.current = false;
        }}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
      />

      {/* Text input overlay */}
      {textInput.visible && (
        <div
          className="absolute z-30 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-2 shadow-lg"
          style={{
            left: textInput.point.x || 100,
            top: (textInput.point.y || 100) - 40,
          }}
        >
          <input
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTextSubmit();
              if (e.key === 'Escape') setTextInput({ point: { time: '', price: 0 }, visible: false });
            }}
            placeholder="텍스트 입력..."
            className="bg-[var(--bg-tertiary)] text-sm px-2 py-1 rounded border border-[var(--border-color)] outline-none focus:border-[var(--accent-blue)] w-40"
            autoFocus
          />
          <button
            onClick={handleTextSubmit}
            className="ml-2 px-2 py-1 text-xs bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            확인
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-lg py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={() => setContextMenu(null)}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
            onClick={() => {
              // TODO: Open property editor
              setContextMenu(null);
            }}
          >
            <span>✏️</span> 편집
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
            onClick={() => {
              const drawing = manager.get(contextMenu.drawingId);
              if (drawing) {
                manager.update(contextMenu.drawingId, { visible: !drawing.visible });
              }
              setContextMenu(null);
            }}
          >
            <span>👁️</span> 숨기기/보이기
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
            onClick={() => {
              const drawing = manager.get(contextMenu.drawingId);
              if (drawing) {
                manager.update(contextMenu.drawingId, { locked: !drawing.locked });
              }
              setContextMenu(null);
            }}
          >
            <span>🔒</span> 잠금/해제
          </button>
          <div className="border-t border-[var(--border-color)] my-1" />
          <button
            className="w-full px-3 py-1.5 text-left text-sm text-[var(--accent-red)] hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
            onClick={() => {
              manager.delete(contextMenu.drawingId);
              onDrawingSelect(null);
              setContextMenu(null);
            }}
          >
            <span>🗑️</span> 삭제
          </button>
        </div>
      )}
    </>
  );
}
