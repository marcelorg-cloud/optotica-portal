'use client';

import { useState } from 'react';

export function VerificationReviewFields() {
  const [decision, setDecision] = useState('');
  const approving = decision === 'verified';
  return <>
    <label>Decisão documental<select name="decision" required value={decision} onChange={event => setDecision(event.target.value)}>
      <option value="" disabled>Selecione a decisão</option>
      <option value="verified">Aprovar verificação documental</option>
      <option value="changes_requested">Solicitar ajustes ao profissional</option>
    </select></label>
    <label>Fontes consultadas e resultado da conferência (privado)<textarea name="notes" required minLength={10} maxLength={2000} placeholder="Informe o que foi conferido e o resultado, com pelo menos 10 caracteres." /></label>
    {approving && <>
      <p className="setup-note">Para concluir a aprovação, preencha todos os campos abaixo. O selo só será liberado depois de clicar em “Salvar decisão documental” e receber a confirmação.</p>
      <label>Escopo da verificação para exibição pública<textarea name="scope" required minLength={10} maxLength={1000} placeholder="Descreva a formação, o registro e os documentos conferidos, sem dados pessoais desnecessários." /></label>
      <label>Verificação válida até<input type="date" name="validUntil" required min={new Date().toISOString().slice(0, 10)} /></label>
      <label>Declaração de conferência da Optótica assinada (PDF até 1 MB)<input type="file" name="attestation" accept="application/pdf" required /></label>
      <label>Diploma/certificado para consulta pública (PDF até 1 MB)<input type="file" name="public_diploma" accept="application/pdf" required /></label>
      <label>Registro no conselho para consulta pública (PDF até 1 MB)<input type="file" name="public_registration" accept="application/pdf" required /></label>
      <p className="helper">As versões públicas devem corresponder aos originais e ocultar CPF, RG, endereço residencial, assinatura manuscrita e outros dados desnecessários. Os originais e a declaração assinada permanecem privados.</p>
      <label className="verification-check"><input type="checkbox" name="publicDocumentsChecked" value="yes" required /><span>Conferi as versões públicas e a autorização do profissional. As cópias preservam nome, formação e registro necessários à consulta.</span></label>
      <label className="verification-check"><input type="checkbox" name="signaturesChecked" value="yes" required /><span>Conferi as assinaturas, a identidade e a documentação. A declaração assinada corresponde a esta análise.</span></label>
    </>}
  </>;
}
