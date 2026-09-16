'use client';

import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';

type Register = (id: string, label: string | null) => void;
const ProcessingContext = createContext<Register>(() => {});

/** Bind feedback to the actual operation state, including concurrent operations. */
export function useProcessingFeedback(active: boolean, label = 'Aguarde, estamos processando…') {
  const register = useContext(ProcessingContext);
  const id = useId();
  useEffect(() => {
    if (active) register(id, label);
    return () => register(id, null);
  }, [active, id, label, register]);
}

export function ProcessingProvider({ children }: { children: ReactNode }) {
  const [operations, setOperations] = useState<Record<string, string>>({});
  const register = useCallback<Register>((id, label) => {
    setOperations(current => {
      if (label === null) {
        if (!(id in current)) return current;
        const next = { ...current }; delete next[id]; return next;
      }
      if (current[id] === label) return current;
      return { ...current, [id]: label };
    });
  }, []);
  const labels = Object.values(operations);
  return <ProcessingContext.Provider value={register}>
    {children}
    <div className="processing-announcer" role="status" aria-live="polite" aria-atomic="true">
      {labels.length > 0 && <div className="processing-pill">
        <span className="processing-spinner" aria-hidden="true" />
        <span><strong>{labels[labels.length - 1]}</strong><small>{labels.length > 1 ? `${labels.length} operações em andamento` : 'Aguarde a conclusão antes de sair desta página.'}</small></span>
      </div>}
    </div>
  </ProcessingContext.Provider>;
}
