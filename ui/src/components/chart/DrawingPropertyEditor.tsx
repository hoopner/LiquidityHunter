/**
 * Drawing Property Editor - Modal for editing drawing properties
 */

import { useState, useEffect } from 'react';
import type { Drawing } from '../../types/drawings';
import { DRAWING_COLORS, TOOL_CONFIG } from '../../types/drawings';
import { ColorPicker, ThicknessSelector } from './DrawingToolbar';

interface DrawingPropertyEditorProps {
  drawing: Drawing | null;
  onUpdate: (updates: Partial<Drawing>) => void;
  onClose: () => void;
}

export function DrawingPropertyEditor({
  drawing,
  onUpdate,
  onClose,
}: DrawingPropertyEditorProps) {
  const [label, setLabel] = useState(drawing?.label || '');
  const [color, setColor] = useState(drawing?.color || DRAWING_COLORS.DEFAULT);
  const [thickness, setThickness] = useState(drawing?.thickness || 2);

  // Type-specific state
  const [extendLeft, setExtendLeft] = useState(false);
  const [extendRight, setExtendRight] = useState(false);
  const [lineStyle, setLineStyle] = useState<'solid' | 'dashed' | 'dotted'>('solid');
  const [fillOpacity, setFillOpacity] = useState(0.2);
  const [showExtensions, setShowExtensions] = useState(false);
  const [showPrices, setShowPrices] = useState(true);
  const [arrowSize, setArrowSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [fontSize, setFontSize] = useState(14);

  // Initialize state from drawing
  useEffect(() => {
    if (!drawing) return;

    setLabel(drawing.label || '');
    setColor(drawing.color);
    setThickness(drawing.thickness);

    switch (drawing.type) {
      case 'horizontal_line':
        setExtendLeft(drawing.extendLeft);
        setExtendRight(drawing.extendRight);
        setLineStyle(drawing.lineStyle);
        break;
      case 'vertical_line':
        setLineStyle(drawing.lineStyle);
        break;
      case 'trendline':
        setExtendLeft(drawing.extendLeft);
        setExtendRight(drawing.extendRight);
        setLineStyle(drawing.lineStyle);
        break;
      case 'rectangle':
        setFillOpacity(drawing.fillOpacity);
        setLineStyle(drawing.borderStyle);
        break;
      case 'fibonacci':
        setShowExtensions(drawing.showExtensions);
        setShowPrices(drawing.showPrices);
        break;
      case 'arrow':
        setArrowSize(drawing.size);
        break;
      case 'text':
        setFontSize(drawing.fontSize);
        break;
    }
  }, [drawing]);

  if (!drawing) return null;

  const handleSave = () => {
    const updates: Partial<Drawing> = {
      label: label || undefined,
      color,
      thickness,
    };

    switch (drawing.type) {
      case 'horizontal_line':
        Object.assign(updates, { extendLeft, extendRight, lineStyle });
        break;
      case 'vertical_line':
        Object.assign(updates, { lineStyle });
        break;
      case 'trendline':
        Object.assign(updates, { extendLeft, extendRight, lineStyle });
        break;
      case 'rectangle':
        Object.assign(updates, { fillOpacity, borderStyle: lineStyle });
        break;
      case 'fibonacci':
        Object.assign(updates, { showExtensions, showPrices });
        break;
      case 'arrow':
        Object.assign(updates, { size: arrowSize });
        break;
      case 'text':
        Object.assign(updates, { fontSize });
        break;
    }

    onUpdate(updates);
    onClose();
  };

  const toolConfig = TOOL_CONFIG[drawing.type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl w-80 max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-color)]">
          <div className="flex items-center gap-2">
            <span className="text-lg">{toolConfig.icon}</span>
            <span className="font-medium">{toolConfig.labelKo}</span>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xl"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Label */}
          <div>
            <label className="block text-sm font-medium mb-1">라벨</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: Support, OB 162"
              className="w-full bg-[var(--bg-tertiary)] text-sm px-3 py-2 rounded border border-[var(--border-color)] outline-none focus:border-[var(--accent-blue)]"
            />
          </div>

          {/* Color */}
          <div>
            <label className="block text-sm font-medium mb-2">색상</label>
            <ColorPicker color={color} onChange={setColor} />
          </div>

          {/* Thickness */}
          <div>
            <label className="block text-sm font-medium mb-2">두께</label>
            <ThicknessSelector thickness={thickness} onChange={setThickness} />
          </div>

          {/* Line style (for lines) */}
          {(drawing.type === 'horizontal_line' ||
            drawing.type === 'vertical_line' ||
            drawing.type === 'trendline' ||
            drawing.type === 'rectangle') && (
            <div>
              <label className="block text-sm font-medium mb-2">선 스타일</label>
              <div className="flex gap-2">
                {(['solid', 'dashed', 'dotted'] as const).map((style) => (
                  <button
                    key={style}
                    onClick={() => setLineStyle(style)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      lineStyle === style
                        ? 'bg-[var(--accent-blue)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {style === 'solid' ? '실선' : style === 'dashed' ? '점선' : '도트'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Extend options (for horizontal line and trendline) */}
          {(drawing.type === 'horizontal_line' || drawing.type === 'trendline') && (
            <div>
              <label className="block text-sm font-medium mb-2">연장</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extendLeft}
                    onChange={(e) => setExtendLeft(e.target.checked)}
                    className="rounded"
                  />
                  왼쪽
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={extendRight}
                    onChange={(e) => setExtendRight(e.target.checked)}
                    className="rounded"
                  />
                  오른쪽
                </label>
              </div>
            </div>
          )}

          {/* Fill opacity (for rectangle) */}
          {drawing.type === 'rectangle' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                채우기 불투명도: {Math.round(fillOpacity * 100)}%
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={fillOpacity * 100}
                onChange={(e) => setFillOpacity(parseInt(e.target.value) / 100)}
                className="w-full"
              />
            </div>
          )}

          {/* Fibonacci options */}
          {drawing.type === 'fibonacci' && (
            <>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showExtensions}
                    onChange={(e) => setShowExtensions(e.target.checked)}
                    className="rounded"
                  />
                  확장 레벨 표시
                </label>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={showPrices}
                    onChange={(e) => setShowPrices(e.target.checked)}
                    className="rounded"
                  />
                  가격 표시
                </label>
              </div>
            </>
          )}

          {/* Arrow size */}
          {drawing.type === 'arrow' && (
            <div>
              <label className="block text-sm font-medium mb-2">크기</label>
              <div className="flex gap-2">
                {(['small', 'medium', 'large'] as const).map((size) => (
                  <button
                    key={size}
                    onClick={() => setArrowSize(size)}
                    className={`px-3 py-1.5 text-xs rounded transition-colors ${
                      arrowSize === size
                        ? 'bg-[var(--accent-blue)] text-white'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {size === 'small' ? '작게' : size === 'medium' ? '보통' : '크게'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Font size (for text) */}
          {drawing.type === 'text' && (
            <div>
              <label className="block text-sm font-medium mb-1">
                글꼴 크기: {fontSize}px
              </label>
              <input
                type="range"
                min={10}
                max={24}
                value={fontSize}
                onChange={(e) => setFontSize(parseInt(e.target.value))}
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[var(--border-color)]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-[var(--accent-blue)] text-white rounded hover:opacity-90 transition-colors"
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
