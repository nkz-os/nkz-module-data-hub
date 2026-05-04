/**
 * DerivedSeriesInput — formula bar for computed series.
 * Appears in the toolbar dropdown.
 */

import React, { useState } from 'react';
import { SlotShell } from '@nekazari/viewer-kit';
import { Button, Input } from '@nekazari/ui-kit';
import { Sigma } from 'lucide-react';

const datahubAccent = { base: '#06B6D4', soft: '#CFFAFE', strong: '#0891B2' };

export interface DerivedSeriesInputProps {
  /** Current formula string (empty when inactive). */
  formula: string;
  /** Labels for series[N] reference hints. */
  seriesLabels: string[];
  /** Called with the formula on submit. Empty string clears the derived series. */
  onSubmit: (formula: string) => void;
}

export const DerivedSeriesInput: React.FC<DerivedSeriesInputProps> = ({
  formula,
  seriesLabels,
  onSubmit,
}) => {
  const [draft, setDraft] = useState(formula);

  const handleApply = () => {
    const trimmed = draft.trim();
    onSubmit(trimmed);
  };

  const handleClear = () => {
    setDraft('');
    onSubmit('');
  };

  return (
    <SlotShell moduleId="datahub" accent={datahubAccent}>
    <div className="px-2 pb-2 pt-1 space-y-1">
      <div className="flex items-center gap-1.5">
        <Sigma size={12} className="text-muted-foreground shrink-0" />
        <Input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
            if (e.key === 'Escape') handleClear();
          }}
          placeholder="series[0] - series[1]"
          className="flex-1 px-2 py-1 text-[10px] font-mono"
        />
        <Button
          variant="primary"
          size="xs"
          onClick={handleApply}
          disabled={!draft.trim()}
          className="font-mono"
        >
          ✓
        </Button>
        {formula && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleClear}
          >
            ✕
          </Button>
        )}
      </div>
      {seriesLabels.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground font-mono">
          {seriesLabels.map((label, i) => (
            <span key={i}>series[{i}]={label}</span>
          ))}
        </div>
      )}
    </div>
    </SlotShell>
  );
};
