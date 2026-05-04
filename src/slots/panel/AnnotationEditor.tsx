/**
 * AnnotationEditor — inline CRUD for chart annotations.
 * Appears as a collapsible section in the PanelToolbar.
 */

import React, { useState } from 'react';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Input } from '@nekazari/ui-kit';
import { Plus, Trash2 } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };
import type { ChartAnnotation } from '../../types/dashboard';

const ANNOTATION_COLORS = ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#c084fc', '#f472b6'];

export interface AnnotationEditorProps {
  annotations: ChartAnnotation[];
  onAdd: (label: string, color: string) => void;
  onDelete: (id: string) => void;
}

export const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
  annotations,
  onAdd,
  onDelete,
}) => {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState(ANNOTATION_COLORS[0]);

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed || trimmed.length > 60) return;
    onAdd(trimmed, color);
    setLabel('');
  };

  const fmtEpoch = (epoch: number) => {
    const d = new Date(epoch * 1000);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  return (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="px-2 pb-2 pt-1 space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Add annotation…"
          maxLength={60}
          className="flex-1 px-2 py-1 text-[10px]"
        />
        <div className="flex gap-0.5">
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              className={`w-4 h-4 rounded-full ring-1 transition-all ${
                color === c ? 'ring-foreground scale-110' : 'ring-transparent'
              }`}
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={handleAdd}
          disabled={!label.trim()}
        >
          <Plus size={12} />
        </Button>
      </div>
      {annotations.length > 0 && (
        <ul className="space-y-0.5">
          {annotations.map((a) => (
            <li key={a.id} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: a.color }} />
              <span className="text-foreground truncate flex-1 min-w-0">{a.label}</span>
              <span className="text-muted-foreground tabular-nums font-mono">{fmtEpoch(a.xEpoch)}</span>
              <Button
                variant="ghost"
                size="xs"
                className="p-0.5"
                onClick={() => onDelete(a.id)}
              >
                <Trash2 size={10} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </SlotShell>
  );
};
