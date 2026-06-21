import React, { useState } from 'react';
import { useTranslation } from '@nekazari/sdk';

interface Props {
  onAdd: (data: any) => Promise<boolean>;
}

export function CalibrationForm({ onAdd }: Props) {
  const { t } = useTranslation('datahub');
  const [variable, setVariable] = useState('');
  const [slope, setSlope] = useState('1.0');
  const [offsetVal, setOffsetVal] = useState('0.0');
  const [hardwareId, setHardwareId] = useState('');
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!variable.trim()) return;
    setSubmitting(true);
    const success = await onAdd({
      variable: variable.trim(),
      slope: parseFloat(slope),
      offset_val: parseFloat(offsetVal),
      sensor_hardware_id: hardwareId.trim(),
      valid_from: new Date(validFrom).toISOString(),
      notes: notes.trim() || undefined,
    });
    setSubmitting(false);
    if (success) {
      setVariable('');
      setSlope('1.0');
      setOffsetVal('0.0');
      setHardwareId('');
      setNotes('');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h4 className="text-sm font-semibold dh-text-primary">{t('sensor.calibration.form.title')}</h4>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={variable}
          onChange={e => setVariable(e.target.value)}
          placeholder={t('sensor.calibration.form.variable')}
          className="col-span-2 px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
          aria-required="true"
          required
        />
        <input
          type="number"
          step="0.01"
          value={slope}
          onChange={e => setSlope(e.target.value)}
          placeholder={t('sensor.calibration.form.slope')}
          className="px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
          aria-required="true"
          required
        />
        <input
          type="number"
          step="0.01"
          value={offsetVal}
          onChange={e => setOffsetVal(e.target.value)}
          placeholder={t('sensor.calibration.form.offset')}
          className="px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
          aria-required="true"
          required
        />
        <input
          type="text"
          value={hardwareId}
          onChange={e => setHardwareId(e.target.value)}
          placeholder={t('sensor.calibration.form.hardware_id')}
          className="col-span-2 px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
          aria-required="true"
          required
        />
        <input
          type="datetime-local"
          value={validFrom}
          onChange={e => setValidFrom(e.target.value)}
          className="col-span-2 px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
          aria-label={t('sensor.calibration.form.valid_from')}
          required
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t('sensor.calibration.form.notes')}
          className="col-span-2 px-3 py-1.5 text-sm border dh-border-light rounded dh-bg-surface-alt dh-text-primary placeholder-current opacity-70 focus:outline-none focus:ring-1 focus:dh-accent-border/50"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full px-3 py-1.5 text-sm font-medium text-white dh-accent-bg hover:opacity-90 rounded disabled:opacity-50 transition-opacity"
      >
        {submitting ? t('sensor.calibration.form.saving') : t('sensor.calibration.form.submit')}
      </button>
    </form>
  );
}
