/**
 * DerivedSeriesInput — formula bar for computed series.
 * Appears in the toolbar dropdown.
 */

import React, { useState } from 'react';
import { Sigma } from 'lucide-react';

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
    <div className="px-2 pb-2 pt-1 space-y-1">
      <div className="flex items-center gap-1.5">
        <Sigma size={12} className="text-slate-500 shrink-0" />
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleApply();
            if (e.key === 'Escape') handleClear();
          }}
          placeholder="series[0] - series[1]"
          className="flex-1 px-2 py-1 text-[10px] rounded border border-white/10 bg-slate-900 text-slate-100 placeholder-slate-500 font-mono"
        />
        <button
          type="button"
          onClick={handleApply}
          disabled={!draft.trim()}
          className="px-2 py-1 text-[10px] rounded bg-emerald-600/30 text-emerald-300 hover:bg-emerald-600/50 disabled:opacity-30 transition-colors font-mono"
        >
          ✓
        </button>
        {formula && (
          <button
            type="button"
            onClick={handleClear}
            className="px-1.5 py-1 text-[10px] rounded text-slate-400 hover:text-red-400"
          >
            ✕
          </button>
        )}
      </div>
      {seriesLabels.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-slate-500 font-mono">
          {seriesLabels.map((label, i) => (
            <span key={i}>series[{i}]={label}</span>
          ))}
        </div>
      )}
    </div>
  );
};
