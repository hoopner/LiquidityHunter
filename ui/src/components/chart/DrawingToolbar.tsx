/**
 * Drawing Toolbar - Collapsible left sidebar with drawing tools
 */

import { useState } from 'react';
import type { DrawingToolType } from '../../types/drawings';
import { TOOL_CONFIG, DRAWING_COLORS } from '../../types/drawings';

interface DrawingToolbarProps {
  activeTool: DrawingToolType | null;
  onToolSelect: (tool: DrawingToolType | null) => void;
  onClearAll: () => void;
  drawingCount: number;
}

const TOOLS: DrawingToolType[] = [
  'select',
  'horizontal_line',
  'vertical_line',
  'trendline',
  'rectangle',
  'fibonacci',
  'arrow',
  'text',
  'delete',
];

export function DrawingToolbar({
  activeTool,
  onToolSelect,
  onClearAll,
  drawingCount,
}: DrawingToolbarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleToolClick = (tool: DrawingToolType) => {
    if (activeTool === tool) {
      onToolSelect(null); // Deselect if clicking same tool
    } else {
      onToolSelect(tool);
    }
  };

  const handleClearAll = () => {
    if (showClearConfirm) {
      onClearAll();
      setShowClearConfirm(false);
    } else {
      setShowClearConfirm(true);
      // Auto-hide confirmation after 3 seconds
      setTimeout(() => setShowClearConfirm(false), 3000);
    }
  };

  return (
    <div
      className={`absolute left-0 top-0 bottom-[22px] z-20 flex flex-col bg-[var(--bg-secondary)] border-r border-[var(--border-color)] transition-all ${
        collapsed ? 'w-10' : 'w-12'
      }`}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="h-8 flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
        title={collapsed ? '확장' : '접기'}
      >
        {collapsed ? '»' : '«'}
      </button>

      {/* Divider */}
      <div className="border-b border-[var(--border-color)]" />

      {/* Tools */}
      <div className="flex-1 overflow-y-auto">
        {TOOLS.map((tool) => {
          const config = TOOL_CONFIG[tool];
          const isActive = activeTool === tool;
          const isDeleteMode = tool === 'delete';

          return (
            <button
              key={tool}
              onClick={() => handleToolClick(tool)}
              className={`w-full h-10 flex items-center justify-center transition-all relative group ${
                isActive
                  ? isDeleteMode
                    ? 'bg-[var(--accent-red)] text-white'
                    : 'bg-[var(--accent-blue)] text-white'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'
              }`}
              title={`${config.labelKo} (${config.label})`}
            >
              <span className={`text-lg ${tool === 'fibonacci' ? 'text-base' : ''}`}>
                {config.icon}
              </span>

              {/* Tooltip */}
              {!collapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-[var(--bg-tertiary)] text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-30 border border-[var(--border-color)]">
                  {config.labelKo}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Divider */}
      <div className="border-b border-[var(--border-color)]" />

      {/* Clear all button */}
      <button
        onClick={handleClearAll}
        disabled={drawingCount === 0}
        className={`h-10 flex items-center justify-center transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
          showClearConfirm
            ? 'bg-[var(--accent-red)] text-white'
            : 'text-[var(--text-secondary)] hover:text-[var(--accent-red)] hover:bg-[var(--bg-tertiary)]'
        }`}
        title={showClearConfirm ? '다시 클릭하여 확인' : `모두 삭제 (${drawingCount}개)`}
      >
        <span className="text-lg">❌</span>
      </button>

      {/* Drawing count */}
      {drawingCount > 0 && !collapsed && (
        <div className="h-6 flex items-center justify-center text-[10px] text-[var(--text-secondary)] bg-[var(--bg-tertiary)]">
          {drawingCount}
        </div>
      )}
    </div>
  );
}

/**
 * Color picker for drawing tools
 */
interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const presetColors = [
    DRAWING_COLORS.OB,
    DRAWING_COLORS.FVG,
    DRAWING_COLORS.BULL,
    DRAWING_COLORS.BEAR,
    DRAWING_COLORS.TRENDLINE,
    DRAWING_COLORS.FIBONACCI,
    '#3b82f6', // Blue
    '#ec4899', // Pink
  ];

  return (
    <div className="flex items-center gap-1">
      {presetColors.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`w-5 h-5 rounded border-2 transition-all ${
            color === c ? 'border-white scale-110' : 'border-transparent hover:scale-105'
          }`}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
      <input
        type="color"
        value={color}
        onChange={(e) => onChange(e.target.value)}
        className="w-6 h-6 rounded cursor-pointer"
        title="커스텀 색상"
      />
    </div>
  );
}

/**
 * Thickness selector
 */
interface ThicknessSelectorProps {
  thickness: number;
  onChange: (thickness: number) => void;
}

export function ThicknessSelector({ thickness, onChange }: ThicknessSelectorProps) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
            thickness === t
              ? 'bg-[var(--accent-blue)] text-white'
              : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          }`}
          title={`${t}px`}
        >
          <div
            className="bg-current rounded-full"
            style={{ width: t * 2 + 2, height: t * 2 + 2 }}
          />
        </button>
      ))}
    </div>
  );
}
