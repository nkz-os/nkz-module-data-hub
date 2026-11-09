import { describe, expect, it } from 'vitest';
import { unitFor } from '../panelUtils';

// Tree leaf-analysis series arrive in lab units: macronutrients in %, micronutrients in mg/kg.
describe('leaf-analysis units', () => {
  it('labels macronutrients in % and micronutrients in mg/kg', () => {
    for (const a of ['nitrogen', 'phosphorus', 'potassium', 'calcium', 'magnesium', 'sulphur', 'chloride']) {
      expect(unitFor(a)).toBe('%');
    }
    for (const a of ['iron', 'manganese', 'zinc', 'copper', 'boron', 'sodium']) {
      expect(unitFor(a)).toBe('mg/kg');
    }
  });
});
