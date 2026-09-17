'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { professionalTermsSections, professionalTermsVersion } from '@/lib/optotica-operator';

export function VerificationTerms({ professionalName, registration }: { professionalName: string; registration: string }) {
  const box = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLParagraphElement>(null);
  const [readToEnd, setReadToEnd] = useState(false);
  const id = useId();
  useEffect(() => {
    const root = box.current;
    const target = end.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) setReadToEnd(true);
    }, { root, threshold: 1 });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  return <section className="verification-terms" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Termos de uso profissional da Optótica</h2>
    <p className="helper">{professionalName} · Registro: {registration || 'Não informado'} · Versão {professionalTermsVersion}</p>
    <p id={`${id}-hint`} className="helper">Role o texto até o final para liberar o aceite.</p>
    <div ref={box} className="verification-terms-scroll" tabIndex={0} role="region" aria-label="Texto dos termos de uso" aria-describedby={`${id}-hint`}
      onScroll={event => { const el = event.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setReadToEnd(true); }}>
      {professionalTermsSections.map(section => <section key={section.title}><h3>{section.title}</h3><p>{section.text}</p></section>)}
      <p ref={end} className="verification-terms-end">Fim dos termos · versão {professionalTermsVersion}</p>
    </div>
    <input type="hidden" name="termsVersion" value={professionalTermsVersion} />
    <input type="hidden" name="termsRead" value={readToEnd ? 'yes' : 'no'} />
    <p role="status" className="helper">{readToEnd ? 'Leitura até o final concluída. Você pode registrar seu aceite.' : 'O aceite será liberado ao chegar ao final do texto.'}</p>
    <label className="verification-check"><input type="checkbox" name="acceptedTerms" value="yes" required disabled={!readToEnd} />
      <span>Li e aceito os Termos de uso profissional da Optótica, versão {professionalTermsVersion}.</span>
    </label>
    <label className="verification-check"><input type="checkbox" name="publicDocumentsConsent" value="yes" required disabled={!readToEnd} />
      <span>Autorizo a divulgação das versões públicas conferidas do meu diploma ou certificado e do registro no conselho na página do QR Code. Estou ciente de que qualquer pessoa com o link poderá consultá-las. Posso solicitar a retirada pelo contato indicado nos termos.</span>
    </label>
  </section>;
}
