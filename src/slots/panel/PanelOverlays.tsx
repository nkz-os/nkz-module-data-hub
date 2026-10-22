/**
 * PanelOverlays — DOM overlays rendered on top of the uPlot canvas.
 *
 * Why DOM, not uPlot series:
 *  - Threshold lines must include a label that does not interfere with cursor
 *    sync nor the legend.
 *  - Forecast bands need a translucent fill which is awkward to express via
 *    uPlot's series API for a single series alongside its line.
 *  - Annotation pins are fundamentally markers, not data — they belong on a
 *    separate visual layer that survives panel re-renders without needing to
 *    rebuild uPlot.
 *
 * The overlay receives the uPlot instance via ref so it can map data values
 * to pixel coordinates with valToPos. It re-renders when the uPlot instance
 * resizes (ResizeObserver, owned by the chart container).
 */

import React, { useEffect, useRef, useState } from 'react';
import type uPlot from 'uplot';

import type { ThresholdLine, PredictionPayload } from '../../types/dashboard';

export interface AnnotationPin {
  /** Epoch seconds where the pin sits. */
  xEpoch: number;
  label: string;
  /** Hex colour. */
  color: string;
}

export interface PanelOverlaysProps {
  /** Imperative handle to read uPlot scales / valToPos. */
  plotRef: React.MutableRefObject<uPlot | null>;
  /** Stable trigger for re-render on data/zoom/resize. */
  resizeNonce: number;
  thresholds: ThresholdLine[];
  annotations: AnnotationPin[];
  prediction?: PredictionPayload | null;
  /** Primary series colour for the prediction band. */
  predictionColor?: string;
  /** Strict X domain in epoch seconds, used to clip overlays. */
  xDomain: { min: number; max: number } | null;
}

/**
 * Hook that re-renders this component on uPlot's draw cycle so the overlay
 * stays aligned with the chart during zoom and resize.
 */
function usePlotTick(
  plotRef: React.MutableRefObject<uPlot | null>,
  resizeNonce: number
): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const inst = plotRef.current;
    if (!inst) return;
    // Re-render after every uPlot draw (zoom, scale change, data update).
    const handler = () => setTick((n) => n + 1);
    inst.hooks.draw = inst.hooks.draw ?? [];
    inst.hooks.draw.push(handler);
    // Also bump once now so first paint is aligned.
    handler();
    return () => {
      const arr = inst.hooks.draw;
      if (!arr) return;
      const idx = arr.indexOf(handler);
      if (idx >= 0) arr.splice(idx, 1);
    };
    // resizeNonce is included so we re-bind when the uPlot instance is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeNonce]);
  return tick;
}

export const PanelOverlays: React.FC<PanelOverlaysProps> = ({
  plotRef,
  resizeNonce,
  thresholds,
  annotations,
  prediction,
  predictionColor,
  xDomain,
}) => {
  const tick = usePlotTick(plotRef, resizeNonce);
  const ref = useRef<HTMLDivElement>(null);

  const inst = plotRef.current;
  if (!inst || tick < 0) return <div ref={ref} className="absolute inset-0 pointer-events-none" />;

  const bbox = inst.bbox;
  if (!bbox) return <div ref={ref} className="absolute inset-0 pointer-events-none" />;

  // bbox is in canvas pixels and includes the device pixel ratio; CSS coords
  // need division by dpr for placement on the DOM overlay.
  const dpr = window.devicePixelRatio || 1;
  const left = bbox.left / dpr;
  const top = bbox.top / dpr;
  const width = bbox.width / dpr;
  const height = bbox.height / dpr;

  return (
    <div
      ref={ref}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      aria-hidden
    >
      {/* Forecast band */}
      {prediction &&
        renderForecastBand({
          inst,
          prediction,
          xDomain,
          left,
          top,
          width,
          height,
          color: predictionColor ?? '#34d399',
        })}

      {/* Threshold lines */}
      {thresholds.map((line, i) => {
        const scaleKey = line.axis === 'right' ? 'y2' : 'y';
        const scale = inst.scales[scaleKey];
        if (!scale || typeof scale.min !== 'number' || typeof scale.max !== 'number') return null;
        if (line.value < scale.min || line.value > scale.max) return null;
        const yPx = inst.valToPos(line.value, scaleKey, false);
        if (!Number.isFinite(yPx)) return null;
        return (
          <React.Fragment key={`th-${i}`}>
            <div
              className="absolute"
              style={{
                left,
                top: yPx,
                width,
                height: 0,
                borderTopWidth: 1,
                borderTopStyle: line.style === 'dot' ? 'dotted' : line.style === 'solid' ? 'solid' : 'dashed',
                borderTopColor: line.color,
                opacity: 0.7,
              }}
            />
            <div
              className="absolute px-1.5 py-0 rounded text-[9px] font-mono whitespace-nowrap"
              style={{
                left: left + 4,
                top: Math.max(top, yPx - 14),
                background: 'rgba(2,6,23,0.85)',
                color: line.color,
                border: `1px solid ${line.color}55`,
              }}
            >
              {line.label} · {line.value}
            </div>
          </React.Fragment>
        );
      })}

      {/* Annotation pins */}
      {annotations.map((pin, i) => {
        const xs = inst.scales.x;
        if (!xs || typeof xs.min !== 'number' || typeof xs.max !== 'number') return null;
        if (pin.xEpoch < xs.min || pin.xEpoch > xs.max) return null;
        const xPx = inst.valToPos(pin.xEpoch, 'x', false);
        if (!Number.isFinite(xPx)) return null;
        return (
          <React.Fragment key={`pin-${i}`}>
            <div
              className="absolute"
              style={{
                left: xPx,
                top,
                width: 1,
                height,
                background: pin.color,
                opacity: 0.5,
              }}
            />
            <div
              className="absolute px-1 py-0 rounded text-[9px] font-mono whitespace-nowrap"
              style={{
                left: xPx + 4,
                top: top + 2,
                background: 'rgba(2,6,23,0.85)',
                color: pin.color,
                border: `1px solid ${pin.color}55`,
              }}
            >
              {pin.label}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

interface ForecastArgs {
  inst: uPlot;
  prediction: PredictionPayload;
  xDomain: { min: number; max: number } | null;
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

/**
 * Render the prediction trace + a 95% confidence band as an SVG overlay.
 *
 * If the PredictionPayload only carries timestamps and values (no explicit
 * uncertainty), we synthesize a band of ±5% of the prediction range as a
 * conservative visual cue. When the contract is extended with uncertainty
 * arrays, this function should consume them directly.
 */
function renderForecastBand({
  inst,
  prediction,
  xDomain,
  left,
  top,
  width,
  height,
  color,
}: ForecastArgs): React.ReactNode {
  if (!prediction.timestamps || prediction.timestamps.length === 0) return null;
  const xs = prediction.timestamps;
  const ys = prediction.values;
  const xScale = inst.scales.x;
  const yScale = inst.scales.y;
  if (!xScale || !yScale) return null;
  if (typeof xScale.min !== 'number' || typeof xScale.max !== 'number') return null;
  if (typeof yScale.min !== 'number' || typeof yScale.max !== 'number') return null;

  // Synthesize ±5% range band.
  let yMin = Number.POSITIVE_INFINITY;
  let yMax = Number.NEGATIVE_INFINITY;
  for (const y of ys) {
    if (Number.isFinite(y)) {
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const halfBand = Number.isFinite(yMax - yMin) ? (yMax - yMin) * 0.05 : 0;

  const linePoints: string[] = [];
  const upperPoints: string[] = [];
  const lowerPoints: string[] = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (xDomain && (x < xDomain.min || x > xDomain.max)) continue;
    if (x < xScale.min || x > xScale.max) continue;
    const px = inst.valToPos(x, 'x', false);
    const py = inst.valToPos(y, 'y', false);
    const pyHigh = inst.valToPos(y + halfBand, 'y', false);
    const pyLow = inst.valToPos(y - halfBand, 'y', false);
    if (Number.isFinite(px) && Number.isFinite(py)) {
      linePoints.push(`${px},${py}`);
      upperPoints.push(`${px},${pyHigh}`);
      lowerPoints.push(`${px},${pyLow}`);
    }
  }
  if (linePoints.length === 0) return null;

  const bandPath = `M ${upperPoints.join(' L ')} L ${lowerPoints.reverse().join(' L ')} Z`;

  return (
    <svg
      className="absolute"
      style={{ left, top, width, height, overflow: 'visible' }}
      viewBox={`${left} ${top} ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <path d={bandPath} fill={`${color}33`} stroke="none" />
      <polyline
        points={linePoints.join(' ')}
        fill="none"
        stroke={color}
        strokeDasharray="4 3"
        strokeWidth={2}
      />
    </svg>
  );
}
