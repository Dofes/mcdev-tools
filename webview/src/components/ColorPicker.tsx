import { useEffect, useRef, useState } from 'react';

type RgbColor = [number, number, number];

interface HsvColor {
  h: number;
  s: number;
  v: number;
}

interface Props {
  id: string;
  value: number[] | null;
  label: string;
  clearLabel: string;
  notSetLabel: string;
  onChange: (value: RgbColor | null) => void;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const normalizeRgb = (value: number[] | null): RgbColor => [
  clamp(Math.round(value?.[0] ?? 0), 0, 255),
  clamp(Math.round(value?.[1] ?? 0), 0, 255),
  clamp(Math.round(value?.[2] ?? 0), 0, 255),
];

const rgbToHex = ([r, g, b]: RgbColor) =>
  `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

const parseHex = (value: string): RgbColor | null => {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  if (!match) return null;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
};

const rgbToHsv = ([rValue, gValue, bValue]: RgbColor): HsvColor => {
  const r = rValue / 255;
  const g = gValue / 255;
  const b = bValue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : delta / max, v: max };
};

const hsvToRgb = ({ h, s, v }: HsvColor): RgbColor => {
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;
  let rgb: [number, number, number];

  if (h < 60) rgb = [chroma, x, 0];
  else if (h < 120) rgb = [x, chroma, 0];
  else if (h < 180) rgb = [0, chroma, x];
  else if (h < 240) rgb = [0, x, chroma];
  else if (h < 300) rgb = [x, 0, chroma];
  else rgb = [chroma, 0, x];

  return rgb.map((channel) => Math.round((channel + m) * 255)) as RgbColor;
};

export const ColorPicker: React.FC<Props> = ({
  id,
  value,
  label,
  clearLabel,
  notSetLabel,
  onChange,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const rgb = normalizeRgb(value);
  const derivedHsv = rgbToHsv(rgb);
  const [hue, setHue] = useState(derivedHsv.h);
  const hsv = { ...derivedHsv, h: hue };
  const hex = rgbToHex(rgb);
  const [hexDraft, setHexDraft] = useState(hex);

  useEffect(() => setHexDraft(hex), [hex]);

  useEffect(() => {
    if (derivedHsv.s > 0) setHue(derivedHsv.h);
  }, [derivedHsv.h, derivedHsv.s]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const updatePlane = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(hsvToRgb({
      h: hsv.h,
      s: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      v: 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1),
    }));
  };

  const updateHue = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const h = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 359.999;
    setHue(h);
    onChange(hsvToRgb({ ...hsv, h }));
  };

  const setChannel = (index: number, channelValue: string) => {
    const next = [...rgb] as RgbColor;
    next[index] = clamp(Number.parseInt(channelValue, 10) || 0, 0, 255);
    onChange(next);
  };

  const commitHex = () => {
    const parsed = parseHex(hexDraft);
    if (parsed) onChange(parsed);
    else setHexDraft(hex);
  };

  const pickerStyle = {
    '--picker-color': `rgb(${rgb.join(', ')})`,
    '--picker-hue': hsv.h,
    '--picker-saturation': `${hsv.s * 100}%`,
    '--picker-value-y': `${(1 - hsv.v) * 100}%`,
    '--picker-hue-x': `${(hsv.h / 360) * 100}%`,
  } as React.CSSProperties;

  return (
    <div
      ref={rootRef}
      className={`color-picker${open ? ' open' : ''}`}
      style={pickerStyle}
    >
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="color-picker-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <span className={`color-picker-swatch${value ? '' : ' empty'}`}>
          {value && <span />}
        </span>
        <span className={value ? '' : 'color-picker-not-set'}>
          {value ? hex : notSetLabel}
        </span>
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </button>

      {open && (
        <div className="color-picker-popover" role="dialog" aria-label={label}>
          <div
            className="color-picker-plane"
            role="slider"
            tabIndex={0}
            aria-label={`${label} saturation and brightness`}
            aria-valuenow={Math.round(hsv.v * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updatePlane(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updatePlane(event);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 0.1 : 0.02;
              let next = hsv;
              if (event.key === 'ArrowLeft') next = { ...hsv, s: clamp(hsv.s - step, 0, 1) };
              else if (event.key === 'ArrowRight') next = { ...hsv, s: clamp(hsv.s + step, 0, 1) };
              else if (event.key === 'ArrowUp') next = { ...hsv, v: clamp(hsv.v + step, 0, 1) };
              else if (event.key === 'ArrowDown') next = { ...hsv, v: clamp(hsv.v - step, 0, 1) };
              else return;
              event.preventDefault();
              onChange(hsvToRgb(next));
            }}
          >
            <span className="color-picker-plane-thumb" />
          </div>

          <div
            className="color-picker-hue"
            role="slider"
            tabIndex={0}
            aria-label={`${label} hue`}
            aria-valuenow={Math.round(hsv.h)}
            aria-valuemin={0}
            aria-valuemax={360}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              updateHue(event);
            }}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId)) updateHue(event);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              const direction = event.key === 'ArrowRight' ? 1 : -1;
              const h = (hsv.h + direction * (event.shiftKey ? 15 : 3) + 360) % 360;
              setHue(h);
              onChange(hsvToRgb({ ...hsv, h }));
            }}
          >
            <span className="color-picker-hue-thumb" />
          </div>

          <div className="color-picker-values">
            <label className="color-picker-hex-field">
              <span>HEX</span>
              <input
                type="text"
                value={hexDraft}
                maxLength={7}
                spellCheck={false}
                onChange={(event) => setHexDraft(event.target.value.toUpperCase())}
                onBlur={commitHex}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitHex();
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            {(['R', 'G', 'B'] as const).map((channel, index) => (
              <label key={channel}>
                <span>{channel}</span>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={rgb[index]}
                  onChange={(event) => setChannel(index, event.target.value)}
                />
              </label>
            ))}
          </div>

          <button
            type="button"
            className="color-picker-clear"
            onClick={() => {
              onChange(null);
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            <span className="codicon codicon-clear-all" aria-hidden="true" />
            {clearLabel}
          </button>
        </div>
      )}
    </div>
  );
};
