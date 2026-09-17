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
      <p className="helper">A análise usa os documentos enviados pelo profissional, disponíveis acima. Após a aprovação, cópias do diploma e do registro serão disponibilizadas na consulta pelo QR Code. Não é necessário anexar arquivos novamente.</p>
      <label className="verification-check"><input type="checkbox" name="submittedDocumentsChecked" value="yes" required /><span>Conferi o diploma e o registro já enviados e autorizo o uso de cópias desses arquivos na consulta pública. Estão adequados à divulgação, sem CPF, RG, endereço residencial, assinatura manuscrita ou outros dados desnecessários.</span></label>
      <label className="verification-check"><input type="checkbox" name="signaturesChecked" value="yes" required /><span>Conferi a identidade, a formação, o registro e a assinatura da declaração de veracidade enviada pelo profissional.</span></label>
    </>}
  </>;
}
