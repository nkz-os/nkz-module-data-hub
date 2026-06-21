import React, { useState } from 'react';

interface Props {
  onAdd: (data: any) => Promise<boolean>;
}

export function CalibrationForm({ onAdd }: Props) {
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
      <h4 className="text-sm font-semibold text-gray-800">Nueva Calibración</h4>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={variable}
          onChange={e => setVariable(e.target.value)}
          placeholder="Variable (ej. temperature)"
          className="col-span-2 px-3 py-1.5 text-sm border border-gray-300 rounded"
          required
        />
        <input
          type="number"
          step="0.01"
          value={slope}
          onChange={e => setSlope(e.target.value)}
          placeholder="Slope"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded"
          required
        />
        <input
          type="number"
          step="0.01"
          value={offsetVal}
          onChange={e => setOffsetVal(e.target.value)}
          placeholder="Offset"
          className="px-3 py-1.5 text-sm border border-gray-300 rounded"
          required
        />
        <input
          type="text"
          value={hardwareId}
          onChange={e => setHardwareId(e.target.value)}
          placeholder="Hardware ID"
          className="col-span-2 px-3 py-1.5 text-sm border border-gray-300 rounded"
          required
        />
        <input
          type="datetime-local"
          value={validFrom}
          onChange={e => setValidFrom(e.target.value)}
          className="col-span-2 px-3 py-1.5 text-sm border border-gray-300 rounded"
          required
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notas (opcional)"
          className="col-span-2 px-3 py-1.5 text-sm border border-gray-300 rounded"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full px-3 py-1.5 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded disabled:opacity-50"
      >
        {submitting ? 'Guardando...' : 'Añadir Período'}
      </button>
    </form>
  );
}
