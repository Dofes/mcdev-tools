import { CSSProperties, useEffect, useState } from 'react';

interface PropertyRowProps {
  label: string;
  value: unknown;
  wide?: boolean;
  readOnly?: boolean;
  property: string;
  saving: boolean;
  onChange(property: string, value: unknown): void;
}

type PropertyDraft = string | string[] | boolean;

const EDITABLE_ARRAY_PROPERTIES = new Set(['position', 'size', 'minSize', 'maxSize', 'color']);
const EDITABLE_BOOLEAN_PROPERTIES = new Set(['clipsChildren', 'shadow', 'toggleState']);
const EDITABLE_NUMBER_PROPERTIES = new Set([
  'layer', 'order', 'linePadding', 'scrollPosition', 'scrollPercent', 'sliderValue',
]);
const EDITABLE_TEXT_PROPERTIES = new Set(['text', 'editText']);

export function PropertyRow({
  label, value, wide = false, readOnly = false, property, saving, onChange,
}: PropertyRowProps) {
  const editable = !readOnly && isEditableProperty(property, value);
  return (
    <div className={`${wide ? 'wide' : ''} ${editable ? 'editable' : ''}`}>
      <dt>{label}</dt>
      <dd>
        {editable ? (
          <RuntimePropertyEditor
            property={property}
            value={value}
            saving={saving}
            onCommit={next => onChange(property, next)}
          />
        ) : formatValue(value)}
      </dd>
    </div>
  );
}

function RuntimePropertyEditor({
  property, value, saving, onCommit,
}: {
  property: string;
  value: unknown;
  saving: boolean;
  onCommit(value: unknown): void;
}) {
  const identity = JSON.stringify(value);
  const [draft, setDraft] = useState<PropertyDraft>(() => propertyDraft(value));
  useEffect(() => setDraft(propertyDraft(value)), [identity]);

  const commit = () => {
    let next: unknown;
    if (typeof value === 'boolean' && typeof draft === 'boolean') {
      next = draft;
    } else if (typeof value === 'number' && typeof draft === 'string') {
      next = Number(draft);
      if (!draft.trim() || !Number.isFinite(next)) {
        setDraft(propertyDraft(value));
        return;
      }
    } else if (typeof value === 'string' && typeof draft === 'string') {
      next = draft;
    } else if (Array.isArray(value) && Array.isArray(draft)) {
      const numbers = draft.map(Number);
      if (draft.some(item => !item.trim()) || numbers.some(item => !Number.isFinite(item))) {
        setDraft(propertyDraft(value));
        return;
      }
      next = numbers;
    } else {
      return;
    }
    if (JSON.stringify(next) !== identity) {
      onCommit(next);
    }
  };

  if (typeof value === 'boolean' && typeof draft === 'boolean') {
    return (
      <label className={`ui-runtime-boolean ${draft ? 'on' : 'off'}`}>
        <input
          type="checkbox"
          checked={draft}
          onChange={event => {
            const next = event.target.checked;
            setDraft(next);
            onCommit(next);
          }}
        />
        <span className="ui-runtime-boolean-track"><span /></span>
        {saving && <span className="codicon codicon-loading" />}
      </label>
    );
  }

  if (Array.isArray(value) && Array.isArray(draft)) {
    return (
      <div
        className={`ui-runtime-vector ${property === 'color' ? 'color' : ''}`}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            commit();
          }
        }}
      >
        {property === 'color' && <span className="ui-runtime-color" style={colorSwatchStyle(value)} />}
        {draft.map((item, index) => (
          <input
            type="number"
            step="any"
            value={item}
            aria-label={`${property} ${index + 1}`}
            onChange={event => {
              const next = [...draft];
              next[index] = event.target.value;
              setDraft(next);
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.currentTarget.blur();
              }
            }}
            key={index}
          />
        ))}
        {saving && <span className="codicon codicon-loading" />}
      </div>
    );
  }

  if (typeof value === 'string' && typeof draft === 'string') {
    return (
      <div className="ui-runtime-text">
        <textarea
          rows={2}
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.currentTarget.blur();
            }
          }}
        />
        {saving && <span className="codicon codicon-loading" />}
      </div>
    );
  }

  return (
    <div className="ui-runtime-number">
      <input
        type="number"
        step={property === 'layer' || property === 'order' || property === 'scrollPercent' ? 1 : 'any'}
        min={property === 'scrollPercent' ? 0 : undefined}
        max={property === 'scrollPercent' ? 100 : undefined}
        value={typeof draft === 'string' ? draft : String(value)}
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
      {saving && <span className="codicon codicon-loading" />}
    </div>
  );
}

function isEditableProperty(property: string, value: unknown): boolean {
  if (EDITABLE_ARRAY_PROPERTIES.has(property)) {
    const expectedLength = property === 'color' ? 4 : 2;
    return Array.isArray(value) && value.length === expectedLength
      && value.every(item => typeof item === 'number' && Number.isFinite(item));
  }
  if (EDITABLE_BOOLEAN_PROPERTIES.has(property)) {
    return typeof value === 'boolean';
  }
  if (EDITABLE_NUMBER_PROPERTIES.has(property)) {
    return typeof value === 'number' && Number.isFinite(value);
  }
  return EDITABLE_TEXT_PROPERTIES.has(property) && typeof value === 'string';
}

function propertyDraft(value: unknown): PropertyDraft {
  if (typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return String(value ?? '');
}

function colorSwatchStyle(value: unknown[]): CSSProperties {
  const channels = value.slice(0, 3).map(item => Number(item));
  const normalized = channels.every(item => item >= 0 && item <= 1);
  const [red, green, blue] = channels.map(item => Math.max(0, Math.min(255, normalized ? item * 255 : item)));
  const alphaValue = Number(value[3]);
  const alpha = Math.max(0, Math.min(1, alphaValue > 1 ? alphaValue / 255 : alphaValue));
  return { backgroundColor: `rgba(${red}, ${green}, ${blue}, ${alpha})` };
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'string') {
    return value || '""';
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
