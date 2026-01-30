/**
 * SubChart Drawing Canvas - Simplified drawing for indicator charts
 * Supports: Horizontal Line, Trendline, Text
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import type {
  Drawing,
  DrawingToolType,
  Point,
  HorizontalLineDrawing,
  TrendlineDrawing,
  TextDrawing,
} from '../../types/drawings';
import { DRAWING_COLORS } from '../../types/drawings';
import { DrawingManager } from '../../utils/DrawingManager';

interface SubChartDrawingCanvasProps {
  chart: IChartApi | null;
  series: ISeriesApi<'Line' | 'Histogram'> | null;
  drawings: Drawing[];
  manager: DrawingManager;
  activeTool: DrawingToolType | null;
  isActiveChart: boolean;
  onChartActivate: () => void;
  onDrawingComplete: () => void;
  indicatorName: string;
}

export function SubChartDrawingCanvas({
  chart,
  series,
  drawings,
  manager,
  activeTool,
  isActiveChart,
  onChartActivate,
  onDrawingComplete,
  indicatorName,
}: SubChartDrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingStart, setDrawingStart] = useState<Point | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point | null>(null);
  const [textInput, setTextInput] = useState<{ point: Point; visible: boolean }>({
    point: { time: '', price: 0 },
    visible: false,
  });
  const [textValue, setTextValue] = useState('');
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; drawingId: string } | null>(null);

  const mouseDownRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isDraggingRef = useRef(false);
  const justActivatedRef = useRef(false); // Track if we just activated this chart


  // Convert pixel to point (for indicator values)
  // IMPORTANT: Preserve original time format - Unix timestamp for intraday, date string for daily
  const pixelToPoint = useCallback(
    (x: number, y: number): Point | null => {
      if (!chart || !series) return null;

      const value = series.coordinateToPrice(y);
      if (value === null) return null;

      const time = chart.timeScale().coordinateToTime(x);
      if (time === null) return null;

      // Keep time in original format (number for intraday, string/BusinessDay for daily)
      // This ensures timeToCoordinate works correctly when rendering
      if (typeof time === 'number') {
        return { time, price: value, x, y };
      }

      const timeStr =
        typeof time === 'string'
          ? time
          : `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;

      return { time: timeStr, price: value, x, y };
    },
    [chart, series]
  );

  // Convert point to pixel
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

  // Hit test - find drawing at given coordinates
  const findDrawingAt = useCallback(
    (x: number, y: number): Drawing | null => {
      const threshold = 8; // pixels

      for (const drawing of [...drawings].reverse()) {
        if (!drawing.visible) continue;

        switch (drawing.type) {
          case 'horizontal_line': {
            const hLine = drawing as HorizontalLineDrawing;
            const lineY = series?.priceToCoordinate(hLine.price);
            if (lineY !== null && lineY !== undefined && Math.abs(y - lineY) < threshold) {
              return drawing;
            }
            break;
          }
          case 'trendline': {
            const tLine = drawing as TrendlineDrawing;
            const start = pointToPixel(tLine.startPoint);
            const end = pointToPixel(tLine.endPoint);
            if (start && end) {
              // Distance from point to line segment
              const dx = end.x - start.x;
              const dy = end.y - start.y;
              const lengthSq = dx * dx + dy * dy;
              if (lengthSq > 0) {
                const t = Math.max(0, Math.min(1, ((x - start.x) * dx + (y - start.y) * dy) / lengthSq));
                const projX = start.x + t * dx;
                const projY = start.y + t * dy;
                const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);
                if (dist < threshold) {
                  return drawing;
                }
              }
            }
            break;
          }
          case 'text': {
            const textD = drawing as TextDrawing;
            const pos = pointToPixel(textD.point);
            if (pos) {
              const textWidth = textD.text.length * 7; // Approximate
              const textHeight = textD.fontSize;
              if (x >= pos.x - 4 && x <= pos.x + textWidth + 4 &&
                  y >= pos.y - textHeight && y <= pos.y + 4) {
                return drawing;
              }
            }
            break;
          }
        }
      }
      return null;
    },
    [drawings, series, pointToPixel]
  );

  // Render drawings
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !chart || !series) return;

    const parent = canvas.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      if (canvas.width !== rect.width || canvas.height !== rect.height) {
        canvas.width = rect.width;
        canvas.height = rect.height;
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each drawing
    drawings.forEach((drawing) => {
      if (!drawing.visible) return;

      const isSelected = drawing.id === selectedDrawingId;

      switch (drawing.type) {
        case 'horizontal_line':
          renderHorizontalLine(ctx, drawing as HorizontalLineDrawing, canvas.width, isSelected);
          break;
        case 'trendline':
          renderTrendline(ctx, drawing as TrendlineDrawing, isSelected);
          break;
        case 'text':
          renderText(ctx, drawing as TextDrawing, isSelected);
          break;
      }
    });

    // Draw preview
    if (isDrawing && drawingStart && currentPoint && activeTool) {
      ctx.globalAlpha = 0.7;
      renderPreview(ctx, activeTool, drawingStart, currentPoint, canvas.width);
      ctx.globalAlpha = 1;
    }

    // Active chart indicator
    if (isActiveChart && activeTool) {
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
    }
  }, [
    drawings,
    isDrawing,
    drawingStart,
    currentPoint,
    activeTool,
    isActiveChart,
    chart,
    series,
    pointToPixel,
    selectedDrawingId,
  ]);

  const renderHorizontalLine = (
    ctx: CanvasRenderingContext2D,
    drawing: HorizontalLineDrawing,
    canvasWidth: number,
    isSelected: boolean
  ) => {
    const y = series?.priceToCoordinate(drawing.price);
    if (y === null || y === undefined) return;

    // Selection highlight
    if (isSelected) {
      ctx.beginPath();
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = drawing.thickness + 4;
      ctx.setLineDash([]);
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    ctx.setLineDash(drawing.lineStyle === 'dashed' ? [8, 4] : drawing.lineStyle === 'dotted' ? [2, 2] : []);
    ctx.moveTo(0, y);
    ctx.lineTo(canvasWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Label with value
    const label = drawing.label || drawing.price.toFixed(1);
    ctx.font = '10px monospace';
    ctx.fillStyle = drawing.color;
    ctx.fillText(label, 4, y - 3);

    // Selection handles
    if (isSelected) {
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(canvasWidth / 2 - 4, y - 4, 8, 8);
    }
  };

  const renderTrendline = (ctx: CanvasRenderingContext2D, drawing: TrendlineDrawing, isSelected: boolean) => {
    const start = pointToPixel(drawing.startPoint);
    const end = pointToPixel(drawing.endPoint);
    if (!start || !end) return;

    // Selection highlight
    if (isSelected) {
      ctx.beginPath();
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = drawing.thickness + 4;
      ctx.setLineDash([]);
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.strokeStyle = drawing.color;
    ctx.lineWidth = drawing.thickness;
    ctx.setLineDash(drawing.lineStyle === 'dashed' ? [8, 4] : drawing.lineStyle === 'dotted' ? [2, 2] : []);
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.setLineDash([]);

    if (drawing.label) {
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      ctx.font = '10px sans-serif';
      ctx.fillStyle = drawing.color;
      ctx.fillText(drawing.label, midX + 4, midY - 4);
    }

    // Selection handles
    if (isSelected) {
      ctx.fillStyle = '#ec4899';
      ctx.fillRect(start.x - 4, start.y - 4, 8, 8);
      ctx.fillRect(end.x - 4, end.y - 4, 8, 8);
    }
  };

  const renderText = (ctx: CanvasRenderingContext2D, drawing: TextDrawing, isSelected: boolean) => {
    const pos = pointToPixel(drawing.point);
    if (!pos) return;

    ctx.font = `${drawing.fontSize}px sans-serif`;
    const metrics = ctx.measureText(drawing.text);
    const padding = 4;

    // Selection highlight
    if (isSelected) {
      ctx.strokeStyle = '#ec4899';
      ctx.lineWidth = 2;
      ctx.strokeRect(pos.x - padding - 2, pos.y - drawing.fontSize - 2, metrics.width + padding * 2 + 4, drawing.fontSize + padding + 4);
    }

    ctx.fillStyle = 'rgba(30, 34, 45, 0.9)';
    ctx.fillRect(pos.x - padding, pos.y - drawing.fontSize, metrics.width + padding * 2, drawing.fontSize + padding);

    ctx.fillStyle = drawing.color;
    ctx.fillText(drawing.text, pos.x, pos.y);
  };

  const renderPreview = (
    ctx: CanvasRenderingContext2D,
    tool: DrawingToolType,
    start: Point,
    current: Point,
    canvasWidth: number
  ) => {
    const startPixel = pointToPixel(start) || { x: start.x || 0, y: start.y || 0 };
    const currentPixel = pointToPixel(current) || { x: current.x || 0, y: current.y || 0 };

    ctx.strokeStyle = DRAWING_COLORS.DEFAULT;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);

    if (tool === 'horizontal_line') {
      ctx.beginPath();
      ctx.moveTo(0, currentPixel.y);
      ctx.lineTo(canvasWidth, currentPixel.y);
      ctx.stroke();

      // Show value
      const value = series?.coordinateToPrice(currentPixel.y);
      if (value !== null && value !== undefined) {
        ctx.font = '11px monospace';
        ctx.fillStyle = DRAWING_COLORS.DEFAULT;
        ctx.fillText(value.toFixed(1), 4, currentPixel.y - 4);
      }
    } else if (tool === 'trendline') {
      ctx.beginPath();
      ctx.moveTo(startPixel.x, startPixel.y);
      ctx.lineTo(currentPixel.x, currentPixel.y);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  };

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;

    // If not active, activate and mark that we just did
    if (!isActiveChart) {
      justActivatedRef.current = true;
      onChartActivate();
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    mouseDownRef.current = { x, y, time: Date.now() };
    isDraggingRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (mouseDownRef.current) {
      const dx = Math.abs(x - mouseDownRef.current.x);
      const dy = Math.abs(y - mouseDownRef.current.y);
      if (dx > 5 || dy > 5) {
        isDraggingRef.current = true;
      }
    }

    if (isDrawing) {
      const point = pixelToPoint(x, y);
      if (point) {
        setCurrentPoint({ ...point, x, y });
      }
    }
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const wasClick =
      mouseDownRef.current && !isDraggingRef.current && Date.now() - mouseDownRef.current.time < 500;

    mouseDownRef.current = null;

    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      return;
    }

    // Check if chart is active OR was just activated in this click
    const isActive = isActiveChart || justActivatedRef.current;
    justActivatedRef.current = false; // Reset the flag

    if (!wasClick || !isActive) return;

    // Handle selection tool - doesn't need point conversion
    if (activeTool === 'select') {
      const hitDrawing = findDrawingAt(x, y);
      setSelectedDrawingId(hitDrawing?.id || null);
      return;
    }

    // Handle delete tool - doesn't need point conversion
    if (activeTool === 'delete') {
      const hitDrawing = findDrawingAt(x, y);
      if (hitDrawing) {
        manager.delete(hitDrawing.id);
        if (selectedDrawingId === hitDrawing.id) {
          setSelectedDrawingId(null);
        }
      }
      return;
    }

    // For drawing tools, we need point conversion
    const point = pixelToPoint(x, y);
    if (!point) return;

    // Only support certain tools for subcharts
    if (activeTool === 'horizontal_line') {
      manager.createHorizontalLine(point.price, {
        label: `${indicatorName} ${point.price.toFixed(1)}`,
      });
      onDrawingComplete();
      return;
    }

    if (activeTool === 'text') {
      setTextInput({ point, visible: true });
      setTextValue('');
      return;
    }

    if (activeTool === 'trendline') {
      if (!isDrawing) {
        setIsDrawing(true);
        setDrawingStart({ ...point, x, y });
        setCurrentPoint({ ...point, x, y });
      } else if (drawingStart) {
        manager.createTrendline(
          { time: drawingStart.time, price: drawingStart.price },
          { time: point.time, price: point.price },
          { label: 'Divergence' }
        );
        setIsDrawing(false);
        setDrawingStart(null);
        setCurrentPoint(null);
        onDrawingComplete();
      }
    }
  };

  // Right-click context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hitDrawing = findDrawingAt(x, y);
    if (hitDrawing) {
      setSelectedDrawingId(hitDrawing.id);
      setContextMenu({ x: e.clientX, y: e.clientY, drawingId: hitDrawing.id });
    } else {
      setContextMenu(null);
    }
  };

  // Delete selected drawing
  const deleteSelectedDrawing = useCallback(() => {
    if (selectedDrawingId) {
      manager.delete(selectedDrawingId);
      setSelectedDrawingId(null);
    }
  }, [selectedDrawingId, manager]);

  const handleTextSubmit = () => {
    if (textValue.trim() && textInput.visible) {
      manager.createText({ time: textInput.point.time, price: textInput.point.price }, textValue.trim());
      setTextInput({ point: { time: '', price: 0 }, visible: false });
      setTextValue('');
      onDrawingComplete();
    }
  };

  // Keyboard shortcuts: ESC to cancel, Delete/Backspace to delete selected
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDrawing(false);
        setDrawingStart(null);
        setCurrentPoint(null);
        setTextInput({ point: { time: '', price: 0 }, visible: false });
        setContextMenu(null);
        setSelectedDrawingId(null);
      }
      // Delete selected drawing on Delete/Backspace (only if this chart is active)
      if ((e.key === 'Delete' || e.key === 'Backspace') && isActiveChart && selectedDrawingId) {
        // Don't delete if user is typing in an input
        if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
          return;
        }
        e.preventDefault();
        deleteSelectedDrawing();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActiveChart, selectedDrawingId, deleteSelectedDrawing]);

  // Render on changes
  useEffect(() => {
    render();
  }, [render]);

  // Re-render on chart zoom
  useEffect(() => {
    if (!chart) return;

    const handleRangeChange = () => render();
    chart.timeScale().subscribeVisibleLogicalRangeChange(handleRangeChange);
    return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleRangeChange);
  }, [chart, render]);

  // Check if any drawing tool is active (regardless of which chart is active)
  const hasDrawingTool = activeTool && ['horizontal_line', 'trendline', 'text'].includes(activeTool);
  const hasSelectionTool = activeTool === 'select' || activeTool === 'delete';
  const hasActiveTool = hasDrawingTool || hasSelectionTool;
  // Should show crosshair only if this chart is active and has a drawing tool
  const shouldShowCrosshair = isActiveChart && hasDrawingTool;
  // Should capture events if: any tool is active OR currently drawing OR has selected drawing
  const shouldCaptureEvents = hasActiveTool || isDrawing || selectedDrawingId !== null;

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, [contextMenu]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-10"
        style={{
          cursor: shouldShowCrosshair ? 'crosshair' : hasSelectionTool ? 'pointer' : hasDrawingTool ? 'pointer' : 'default',
          pointerEvents: shouldCaptureEvents ? 'auto' : 'none',
          // Show border when drawing tool is active and this chart is active
          border: isActiveChart && hasDrawingTool ? '2px solid rgba(236, 72, 153, 0.5)' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onMouseLeave={() => {
          mouseDownRef.current = null;
          isDraggingRef.current = false;
        }}
      />

      {/* Text input popup */}
      {textInput.visible && (
        <div
          className="absolute z-30 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded p-2 shadow-lg"
          style={{
            left: textInput.point.x || 50,
            top: (textInput.point.y || 20) - 30,
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
            placeholder="Label..."
            className="bg-[var(--bg-tertiary)] text-sm px-2 py-1 rounded border border-[var(--border-color)] outline-none focus:border-[var(--accent-blue)] w-32"
            autoFocus
          />
          <button
            onClick={handleTextSubmit}
            className="ml-1 px-2 py-1 text-xs bg-[var(--accent-blue)] text-white rounded hover:opacity-90"
          >
            OK
          </button>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded shadow-lg py-1 min-w-[120px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              manager.delete(contextMenu.drawingId);
              if (selectedDrawingId === contextMenu.drawingId) {
                setSelectedDrawingId(null);
              }
              setContextMenu(null);
            }}
            className="w-full px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--bg-tertiary)] flex items-center gap-2"
          >
            <span>🗑️</span>
            <span>Delete</span>
          </button>
        </div>
      )}
    </>
  );
}
