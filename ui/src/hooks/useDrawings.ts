/**
 * useDrawings hook - Manages drawing state for a chart
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Drawing, DrawingToolType } from '../types/drawings';
import { DrawingManager, getDrawingManager } from '../utils/DrawingManager';
import type { ChartType } from '../utils/DrawingManager';

export interface UseDrawingsReturn {
  drawings: Drawing[];
  manager: DrawingManager;
  activeTool: DrawingToolType | null;
  setActiveTool: (tool: DrawingToolType | null) => void;
  selectedDrawingId: string | null;
  setSelectedDrawingId: (id: string | null) => void;
  editingDrawing: Drawing | null;
  setEditingDrawing: (drawing: Drawing | null) => void;
  clearAll: () => void;
  updateDrawing: (id: string, updates: Partial<Drawing>) => void;
  deleteDrawing: (id: string) => void;
  chartType: ChartType;
}

export function useDrawings(symbol: string, timeframe: string, chartType: ChartType = 'main'): UseDrawingsReturn {
  const managerRef = useRef<DrawingManager | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType | null>(null);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [editingDrawing, setEditingDrawing] = useState<Drawing | null>(null);

  // Initialize manager
  useEffect(() => {
    const manager = getDrawingManager(symbol, timeframe, chartType);
    managerRef.current = manager;

    // Subscribe to changes
    const unsubscribe = manager.subscribe((updatedDrawings) => {
      setDrawings(updatedDrawings);
    });

    // Initial load
    setDrawings(manager.getAll());

    return () => {
      unsubscribe();
    };
  }, [symbol, timeframe, chartType]);

  // Switch context when symbol/timeframe/chartType changes
  useEffect(() => {
    if (managerRef.current) {
      managerRef.current.switchContext(symbol, timeframe, chartType);
      setDrawings(managerRef.current.getAll());
    }
    // Reset selection when switching
    setSelectedDrawingId(null);
    setEditingDrawing(null);
  }, [symbol, timeframe, chartType]);

  // Clear all drawings
  const clearAll = useCallback(() => {
    if (managerRef.current) {
      managerRef.current.clearAll();
      setSelectedDrawingId(null);
      setEditingDrawing(null);
    }
  }, []);

  // Update a drawing
  const updateDrawing = useCallback((id: string, updates: Partial<Drawing>) => {
    if (managerRef.current) {
      managerRef.current.update(id, updates);
    }
  }, []);

  // Delete a drawing
  const deleteDrawing = useCallback((id: string) => {
    if (managerRef.current) {
      managerRef.current.delete(id);
      if (selectedDrawingId === id) {
        setSelectedDrawingId(null);
      }
      if (editingDrawing?.id === id) {
        setEditingDrawing(null);
      }
    }
  }, [selectedDrawingId, editingDrawing]);

  // Get manager (create if needed)
  const manager = managerRef.current || getDrawingManager(symbol, timeframe, chartType);

  return {
    drawings,
    manager,
    activeTool,
    setActiveTool,
    selectedDrawingId,
    setSelectedDrawingId,
    editingDrawing,
    setEditingDrawing,
    clearAll,
    updateDrawing,
    deleteDrawing,
    chartType,
  };
}
