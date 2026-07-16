import { useEffect, useRef, useState } from 'react';

interface NumberSelectOption {
  value: number;
  label: string;
}

interface Props {
  id: string;
  value: number;
  options: NumberSelectOption[];
  onChange: (value: number) => void;
}

export const NumberSelect: React.FC<Props> = ({
  id,
  value,
  options,
  onChange,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    requestAnimationFrame(() => {
      document
        .getElementById(`${id}-option-${selectedIndex}`)
        ?.scrollIntoView({ block: 'nearest' });
    });
  }, [id, open, selectedIndex]);

  const selectOption = (index: number) => {
    onChange(options[index].value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveActive = (direction: 1 | -1) => {
    setActiveIndex((current) => {
      const start = open ? current : selectedIndex;
      return (start + direction + options.length) % options.length;
    });
    setOpen(true);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        setOpen(true);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(options.length - 1);
        setOpen(true);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) {
          selectOption(activeIndex);
        } else {
          setActiveIndex(selectedIndex);
          setOpen(true);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          setOpen(false);
        }
        break;
    }
  };

  return (
    <div ref={rootRef} className={`number-select${open ? ' open' : ''}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        className="number-select-trigger"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        aria-haspopup="listbox"
        aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
      >
        <span>{options[selectedIndex].label}</span>
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </button>

      {open && (
        <div
          id={`${id}-listbox`}
          className="number-select-list"
          role="listbox"
          aria-label={options[selectedIndex].label}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={`${id}-option-${index}`}
              className={`number-select-option${index === activeIndex ? ' active' : ''}${option.value === value ? ' selected' : ''}`}
              role="option"
              aria-selected={option.value === value}
              onPointerMove={() => setActiveIndex(index)}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => selectOption(index)}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <span className="codicon codicon-check" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
