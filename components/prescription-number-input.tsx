'use client';

import { useRef, useState } from 'react';
import { formatDiopter, formatSignedSphere, prescriptionNumber, stepPrescriptionNumber } from '@/lib/prescription-format';

type Props = {
  name: string;
  label: string;
  initialValue: string;
  kind: 'sphere' | 'cylinder' | 'axis' | 'addition';
  onValueChange: () => void;
};

export function PrescriptionNumberInput({ name, label, initialValue, kind, onValueChange }: Props) {
  const axis = kind === 'axis';
  const step = axis ? 5 : 0.25;
  const min = axis || kind === 'addition' ? 0 : -30;
  const max = axis ? 180 : kind === 'addition' ? 6 : 30;
  const format = (value: unknown) => axis
    ? String(prescriptionNumber(value) ?? '')
    : kind === 'sphere' ? formatSignedSphere(value) : formatDiopter(value);
  const [draft, setDraft] = useState(() => format(initialValue));
  const input = useRef<HTMLInputElement>(null);
  const number = prescriptionNumber(draft);

  function validation(value: string) {
    const parsed = prescriptionNumber(value);
    if (parsed === null) return 'Preencha um número válido.';
    if (parsed < min || parsed > max) return `Informe um valor entre ${min} e ${max}.`;
    // Keep existing integer axes valid; the arrows advance by five degrees.
    if (axis ? !Number.isInteger(parsed) : !Number.isInteger(parsed * 4)) {
      return axis ? 'Informe o eixo em graus inteiros.' : 'Use intervalos de 0,25.';
    }
    return '';
  }

  function update(value: string) {
    setDraft(value);
    input.current?.setCustomValidity(validation(value));
    onValueChange();
  }

  function advance(direction: 1 | -1) {
    const next = stepPrescriptionNumber(input.current?.value, direction, step, min, max);
    update(format(next));
  }

  return <div className={`rx-number${axis ? ' rx-number-axis' : ''}`}>
    <div className="rx-number-value">
      <input ref={input} name={name} type="text" inputMode={axis ? 'numeric' : 'decimal'}
        role="spinbutton" aria-label={label} aria-valuemin={min} aria-valuemax={max}
        aria-valuenow={number ?? undefined} aria-valuetext={number === null ? undefined : `${draft}${axis ? '°' : ''}`}
        pattern={axis ? '[0-9]+' : '(?:[+]|-)?[0-9]+([.,][0-9]{1,2})?'}
        value={draft} required autoComplete="off"
        onChange={event => update(event.currentTarget.value)}
        onBlur={event => {
          const error = validation(event.currentTarget.value);
          event.currentTarget.setCustomValidity(error);
          if (!error) setDraft(format(event.currentTarget.value));
        }}
        onKeyDown={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            advance(event.key === 'ArrowUp' ? 1 : -1);
          }
        }} />
      {axis && <span className="rx-degree" aria-hidden="true">°</span>}
    </div>
    <div className="rx-number-arrows">
      <button type="button" aria-label={`Aumentar ${label}`} disabled={number !== null && number >= max} onClick={() => advance(1)}><span aria-hidden="true">▴</span></button>
      <button type="button" aria-label={`Diminuir ${label}`} disabled={number !== null && number <= min} onClick={() => advance(-1)}><span aria-hidden="true">▾</span></button>
    </div>
  </div>;
}
