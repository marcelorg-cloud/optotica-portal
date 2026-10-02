'use client';

export function PrintLaboratoryOrderButton() {
  return <button type="button" className="button primary" onClick={() => window.print()}>Imprimir / Salvar PDF</button>;
}
