'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type Laboratory = {
  id?: string;
  name: string;
  legalName: string;
  cnpj: string;
  addressLine: string;
  addressNumber: string;
  addressComplement: string;
  district: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  contactName: string;
};

const emptyLaboratory = (): Laboratory => ({
  name: '', legalName: '', cnpj: '', addressLine: '', addressNumber: '', addressComplement: '',
  district: '', city: '', state: '', postalCode: '', phone: '', contactName: ''
});

type ProfileInitialValues = {
  accountType?: string;
  displayName?: string;
  legalName?: string;
  councilRegistration?: string;
  technicalResponsibleName?: string;
  technicalResponsibleRegistration?: string;
  cnpj?: string;
  addressLine?: string;
  addressNumber?: string;
  addressComplement?: string;
  district?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  phone?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  laboratories?: Laboratory[];
};

export function ProfessionalProfileForm({ initialValues = {} }: { initialValues?: ProfileInitialValues }) {
  const router = useRouter();
  const [laboratories, setLaboratories] = useState<Laboratory[]>(() => initialValues.laboratories?.length ? initialValues.laboratories : [emptyLaboratory()]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');

  function updateLaboratory(index: number, field: keyof Laboratory, value: string) {
    setLaboratories((current) => current.map((laboratory, itemIndex) => itemIndex === index ? { ...laboratory, [field]: value } : laboratory));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('loading');
    setMessage('');
    const form = new FormData(event.currentTarget);
    const value = (name: string) => form.get(name);
    const response = await fetch('/api/professional/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountType: value('accountType'), displayName: value('displayName'), legalName: value('legalName'),
        councilRegistration: value('councilRegistration'), technicalResponsibleName: value('technicalResponsibleName'),
        technicalResponsibleRegistration: value('technicalResponsibleRegistration'), cnpj: value('cnpj'),
        addressLine: value('addressLine'), addressNumber: value('addressNumber'), addressComplement: value('addressComplement'),
        district: value('district'), city: value('city'), state: value('state'), postalCode: value('postalCode'),
        phone: value('phone'), contactName: value('contactName'), contactEmail: value('contactEmail'),
        contactPhone: value('contactPhone'), laboratories
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      router.push('/profissional');
      router.refresh();
      return;
    }
    setState('error');
    setMessage(payload.message || 'Não foi possível enviar o cadastro.');
  }

  return (
    <form className="profile-form" onSubmit={submit}>
      <fieldset>
        <legend>Identificação profissional</legend>
        <div className="form-grid">
          <label>Tipo de cadastro<select name="accountType" defaultValue={initialValues.accountType || 'professional'}><option value="professional">Profissional</option><option value="optical_store">Ótica</option></select></label>
          <label>Nome do profissional ou da ótica<input name="displayName" defaultValue={initialValues.displayName || ''} minLength={2} maxLength={140} required /></label>
          <label>Razão social<input name="legalName" defaultValue={initialValues.legalName || ''} maxLength={180} /></label>
          <label>CNPJ da ótica<input name="cnpj" defaultValue={initialValues.cnpj || ''} inputMode="numeric" placeholder="Somente números" /></label>
          <label>Registro no conselho<input name="councilRegistration" defaultValue={initialValues.councilRegistration || ''} maxLength={80} /></label>
          <label>Responsável técnico<input name="technicalResponsibleName" defaultValue={initialValues.technicalResponsibleName || ''} maxLength={140} /></label>
          <label>Registro do responsável técnico<input name="technicalResponsibleRegistration" defaultValue={initialValues.technicalResponsibleRegistration || ''} maxLength={80} /></label>
        </div>
        <p className="fine-print">Informe o registro do conselho ou o responsável técnico com seu registro.</p>
      </fieldset>

      <fieldset>
        <legend>Endereço e contato</legend>
        <div className="form-grid">
          <label className="span-2">Endereço<input name="addressLine" defaultValue={initialValues.addressLine || ''} maxLength={180} required /></label>
          <label>Número<input name="addressNumber" defaultValue={initialValues.addressNumber || ''} maxLength={30} /></label>
          <label>Complemento<input name="addressComplement" defaultValue={initialValues.addressComplement || ''} maxLength={100} /></label>
          <label>Bairro<input name="district" defaultValue={initialValues.district || ''} maxLength={100} /></label>
          <label>Cidade<input name="city" defaultValue={initialValues.city || ''} maxLength={100} required /></label>
          <label>UF<input name="state" defaultValue={initialValues.state || ''} minLength={2} maxLength={2} required /></label>
          <label>CEP<input name="postalCode" defaultValue={initialValues.postalCode || ''} inputMode="numeric" /></label>
          <label>Telefone principal<input name="phone" defaultValue={initialValues.phone || ''} type="tel" required /></label>
          <label>Pessoa de contato<input name="contactName" defaultValue={initialValues.contactName || ''} maxLength={140} /></label>
          <label>E-mail de contato<input name="contactEmail" defaultValue={initialValues.contactEmail || ''} type="email" /></label>
          <label>WhatsApp de contato<input name="contactPhone" defaultValue={initialValues.contactPhone || ''} type="tel" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Laboratórios ópticos</legend>
        <p className="muted">Os catálogos de lentes permanecerão bloqueados até a validação da Optótica.</p>
        {laboratories.map((laboratory, index) => (
          <div className="laboratory-card" key={laboratory.id || `laboratory-${index}`}>
            <div className="laboratory-head"><strong>Laboratório {index + 1}</strong>{laboratories.length > 1 && <button type="button" className="text-button" onClick={() => setLaboratories((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}</div>
            <div className="form-grid">
              <label>Nome<input value={laboratory.name} onChange={(event) => updateLaboratory(index, 'name', event.target.value)} required /></label>
              <label>Razão social<input value={laboratory.legalName} onChange={(event) => updateLaboratory(index, 'legalName', event.target.value)} /></label>
              <label>CNPJ<input inputMode="numeric" value={laboratory.cnpj} onChange={(event) => updateLaboratory(index, 'cnpj', event.target.value)} required /></label>
              <label>Telefone<input type="tel" value={laboratory.phone} onChange={(event) => updateLaboratory(index, 'phone', event.target.value)} required /></label>
              <label className="span-2">Endereço<input value={laboratory.addressLine} onChange={(event) => updateLaboratory(index, 'addressLine', event.target.value)} required /></label>
              <label>Número<input value={laboratory.addressNumber} onChange={(event) => updateLaboratory(index, 'addressNumber', event.target.value)} /></label>
              <label>Complemento<input value={laboratory.addressComplement} onChange={(event) => updateLaboratory(index, 'addressComplement', event.target.value)} /></label>
              <label>Bairro<input value={laboratory.district} onChange={(event) => updateLaboratory(index, 'district', event.target.value)} /></label>
              <label>Cidade<input value={laboratory.city} onChange={(event) => updateLaboratory(index, 'city', event.target.value)} required /></label>
              <label>UF<input minLength={2} maxLength={2} value={laboratory.state} onChange={(event) => updateLaboratory(index, 'state', event.target.value)} required /></label>
              <label>CEP<input inputMode="numeric" value={laboratory.postalCode} onChange={(event) => updateLaboratory(index, 'postalCode', event.target.value)} /></label>
              <label>Pessoa de contato<input value={laboratory.contactName} onChange={(event) => updateLaboratory(index, 'contactName', event.target.value)} /></label>
            </div>
          </div>
        ))}
        <button className="button secondary" type="button" disabled={laboratories.length >= 10} onClick={() => setLaboratories((current) => [...current, emptyLaboratory()])}>Adicionar laboratório</button>
      </fieldset>

      <label className="check-row"><input type="checkbox" required /><span>Declaro que os dados são verdadeiros e autorizo a Optótica a validá-los.</span></label>
      <button className="button primary" disabled={state === 'loading'} type="submit">{state === 'loading' ? 'Enviando…' : 'Enviar cadastro para análise'}</button>
      {message && <p className="form-message error" role="status">{message}</p>}
    </form>
  );
}
