'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  documentErrorMessage,
  formatCep,
  formatCpfCnpj,
  isValidCNPJ,
  isValidCPF,
  lookupCep,
  onlyDigits
} from '@/lib/br-documents';

type RegistrationKind = 'optometrista' | 'bacharel' | 'optical_store';

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
  cepStatus?: 'idle' | 'loading' | 'done' | 'error';
};

const emptyLaboratory = (): Laboratory => ({
  name: '', legalName: '', cnpj: '', addressLine: '', addressNumber: '', addressComplement: '',
  district: '', city: '', state: '', postalCode: '', phone: '', contactName: '', cepStatus: 'idle'
});

type ProfileInitialValues = {
  registrationKind?: RegistrationKind;
  displayName?: string;
  documentNumber?: string;
  technicalResponsibleName?: string;
  technicalResponsibleRegistration?: string;
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

type FieldErrors = Record<string, string>;

function FieldError({ errors, name }: { errors: FieldErrors; name: string }) {
  return errors[name] ? <span className="field-error">{errors[name]}</span> : null;
}

export function ProfessionalProfileForm({ initialValues = {} }: { initialValues?: ProfileInitialValues }) {
  const router = useRouter();
  const [laboratories, setLaboratories] = useState<Laboratory[]>(() => initialValues.laboratories?.length ? initialValues.laboratories : [emptyLaboratory()]);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const [kind, setKind] = useState<RegistrationKind>(initialValues.registrationKind || 'optometrista');
  const [displayName, setDisplayName] = useState(initialValues.displayName || '');
  const [documentNumber, setDocumentNumber] = useState(formatCpfCnpj(initialValues.documentNumber || ''));
  const [sameAsResponsible, setSameAsResponsible] = useState(false);
  const [technicalResponsibleName, setTechnicalResponsibleName] = useState(initialValues.technicalResponsibleName || '');
  const [technicalResponsibleRegistration, setTechnicalResponsibleRegistration] = useState(initialValues.technicalResponsibleRegistration || '');

  const [postalCode, setPostalCode] = useState(formatCep(initialValues.postalCode || ''));
  const [addressLine, setAddressLine] = useState(initialValues.addressLine || '');
  const [addressNumber, setAddressNumber] = useState(initialValues.addressNumber || '');
  const [addressComplement, setAddressComplement] = useState(initialValues.addressComplement || '');
  const [district, setDistrict] = useState(initialValues.district || '');
  const [city, setCity] = useState(initialValues.city || '');
  const [addressState, setAddressState] = useState(initialValues.state || '');
  const [cepStatus, setCepStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  function updateLaboratory(index: number, field: keyof Laboratory, value: string) {
    setLaboratories((current) => current.map((laboratory, itemIndex) => itemIndex === index ? { ...laboratory, [field]: value } : laboratory));
  }

  async function handleCepChange(value: string) {
    const formatted = formatCep(value);
    setPostalCode(formatted);
    const digits = onlyDigits(formatted);
    if (digits.length !== 8) { setCepStatus('idle'); return; }
    setCepStatus('loading');
    const result = await lookupCep(digits);
    if (!result) { setCepStatus('error'); return; }
    if (result.logradouro) setAddressLine(result.logradouro);
    if (result.bairro) setDistrict(result.bairro);
    if (result.localidade) setCity(result.localidade);
    if (result.uf) setAddressState(result.uf);
    setCepStatus('done');
  }

  async function handleLabCepChange(index: number, value: string) {
    const formatted = formatCep(value);
    updateLaboratory(index, 'postalCode', formatted);
    const digits = onlyDigits(formatted);
    if (digits.length !== 8) { updateLaboratory(index, 'cepStatus', 'idle'); return; }
    updateLaboratory(index, 'cepStatus', 'loading');
    const result = await lookupCep(digits);
    if (!result) { updateLaboratory(index, 'cepStatus', 'error'); return; }
    if (result.logradouro) updateLaboratory(index, 'addressLine', result.logradouro);
    if (result.bairro) updateLaboratory(index, 'district', result.bairro);
    if (result.localidade) updateLaboratory(index, 'city', result.localidade);
    if (result.uf) updateLaboratory(index, 'state', result.uf);
    updateLaboratory(index, 'cepStatus', 'done');
  }

  function toggleSameAsResponsible(checked: boolean) {
    setSameAsResponsible(checked);
    if (checked) setTechnicalResponsibleName(displayName);
  }

  const effectiveResponsibleName = sameAsResponsible ? displayName : technicalResponsibleName;

  function validate(phoneValue: string): FieldErrors {
    const nextErrors: FieldErrors = {};
    if (displayName.trim().length < 2) nextErrors.displayName = 'Informe o nome completo do profissional ou da ótica.';

    const documentDigits = onlyDigits(documentNumber);
    const expectCnpj = kind === 'optical_store';
    if (!documentDigits) {
      nextErrors.documentNumber = expectCnpj ? 'Informe o CNPJ da ótica.' : 'Informe o CPF do profissional.';
    } else if (expectCnpj ? !isValidCNPJ(documentDigits) : !isValidCPF(documentDigits)) {
      nextErrors.documentNumber = documentErrorMessage(documentDigits) || (expectCnpj ? 'CNPJ inválido. Verifique o número informado.' : 'CPF inválido. Verifique o número informado.');
    }

    if (effectiveResponsibleName.trim().length < 2) nextErrors.technicalResponsibleName = 'Informe o nome do responsável técnico optometrista.';
    if (technicalResponsibleRegistration.trim().length < 2) nextErrors.technicalResponsibleRegistration = 'Informe o registro no Conselho Regional de Ótica e Optometria.';

    if (onlyDigits(postalCode).length !== 8) nextErrors.postalCode = 'CEP deve ter 8 dígitos.';
    if (!addressLine.trim()) nextErrors.addressLine = 'Informe o logradouro.';
    if (!city.trim()) nextErrors.city = 'Informe a cidade.';
    if (addressState.trim().length !== 2) nextErrors.state = 'Informe a UF (2 letras).';
    if (onlyDigits(phoneValue).length < 10) nextErrors.phone = 'Informe um telefone válido, com DDD.';

    return nextErrors;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) || '');

    const fieldErrors = validate(value('phone'));
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      setState('error');
      setMessage('Corrija os campos destacados antes de enviar.');
      return;
    }
    setErrors({});
    setState('loading');
    setMessage('');
    const response = await fetch('/api/professional/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        registrationKind: kind,
        displayName,
        documentNumber: onlyDigits(documentNumber),
        technicalResponsibleName: effectiveResponsibleName,
        technicalResponsibleRegistration,
        addressLine, addressNumber, addressComplement,
        district, city, state: addressState, postalCode: onlyDigits(postalCode),
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
    <form className="profile-form" onSubmit={submit} noValidate>
      <fieldset>
        <legend>Identificação</legend>
        <div className="form-grid">
          <label>
            Tipo de cadastro
            <select value={kind} onChange={(event) => setKind(event.target.value as RegistrationKind)}>
              <option value="optometrista">Optometrista</option>
              <option value="bacharel">Bacharel</option>
              <option value="optical_store">Ótica</option>
            </select>
          </label>
          <label>
            Nome completo do profissional ou da ótica
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={140} required />
            <FieldError errors={errors} name="displayName" />
          </label>
          <label>
            CPF do profissional ou CNPJ da ótica
            <input
              value={documentNumber}
              onChange={(event) => setDocumentNumber(formatCpfCnpj(event.target.value))}
              inputMode="numeric"
              placeholder={kind === 'optical_store' ? '00.000.000/0000-00' : '000.000.000-00'}
              required
            />
            <FieldError errors={errors} name="documentNumber" />
          </label>
          {kind !== 'optical_store' && (
            <label className="check-row span-2">
              <input type="checkbox" checked={sameAsResponsible} onChange={(event) => toggleSameAsResponsible(event.target.checked)} />
              <span>O responsável técnico é o próprio profissional</span>
            </label>
          )}
          <label>
            Nome do responsável técnico optometrista
            <input
              value={effectiveResponsibleName}
              onChange={(event) => setTechnicalResponsibleName(event.target.value)}
              disabled={sameAsResponsible}
              maxLength={140}
              required
            />
            <FieldError errors={errors} name="technicalResponsibleName" />
          </label>
          <label>
            Registro no Conselho Regional de Ótica e Optometria
            <input value={technicalResponsibleRegistration} onChange={(event) => setTechnicalResponsibleRegistration(event.target.value)} maxLength={80} required />
            <FieldError errors={errors} name="technicalResponsibleRegistration" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Endereço e contato</legend>
        <div className="form-grid">
          <label>
            CEP
            <input value={postalCode} onChange={(event) => handleCepChange(event.target.value)} inputMode="numeric" placeholder="00000-000" required />
            <FieldError errors={errors} name="postalCode" />
            {cepStatus === 'loading' && <span className="field-hint">Buscando endereço…</span>}
            {cepStatus === 'error' && <span className="field-hint">CEP não encontrado. Preencha manualmente.</span>}
          </label>
          <label className="span-2">
            Logradouro
            <input value={addressLine} onChange={(event) => setAddressLine(event.target.value)} maxLength={180} required />
            <FieldError errors={errors} name="addressLine" />
          </label>
          <label>Número<input value={addressNumber} onChange={(event) => setAddressNumber(event.target.value)} maxLength={30} /></label>
          <label>Complemento<input value={addressComplement} onChange={(event) => setAddressComplement(event.target.value)} maxLength={100} /></label>
          <label>Bairro<input value={district} onChange={(event) => setDistrict(event.target.value)} maxLength={100} /></label>
          <label>
            Cidade
            <input value={city} onChange={(event) => setCity(event.target.value)} maxLength={100} required />
            <FieldError errors={errors} name="city" />
          </label>
          <label>
            Estado
            <input value={addressState} onChange={(event) => setAddressState(event.target.value.toUpperCase())} minLength={2} maxLength={2} required />
            <FieldError errors={errors} name="state" />
          </label>
          <label>
            Telefone principal
            <input name="phone" defaultValue={initialValues.phone || ''} type="tel" required />
            <FieldError errors={errors} name="phone" />
          </label>
          <label>Pessoa de contato<input name="contactName" defaultValue={initialValues.contactName || ''} maxLength={140} /></label>
          <label>E-mail de contato<input name="contactEmail" defaultValue={initialValues.contactEmail || ''} type="email" /></label>
          <label>WhatsApp de contato<input name="contactPhone" defaultValue={initialValues.contactPhone || ''} type="tel" /></label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Laboratórios ópticos</legend>
        <p className="muted">Após o cadastro, será possível adicionar valores e tabelas de preços dos laboratórios.</p>
        {laboratories.map((laboratory, index) => (
          <div className="laboratory-card" key={laboratory.id || `laboratory-${index}`}>
            <div className="laboratory-head"><strong>Laboratório {index + 1}</strong>{laboratories.length > 1 && <button type="button" className="text-button" onClick={() => setLaboratories((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remover</button>}</div>
            <div className="form-grid">
              <label>Nome<input value={laboratory.name} onChange={(event) => updateLaboratory(index, 'name', event.target.value)} required /></label>
              <label>Razão social<input value={laboratory.legalName} onChange={(event) => updateLaboratory(index, 'legalName', event.target.value)} /></label>
              <label>CNPJ<input inputMode="numeric" value={formatCpfCnpj(laboratory.cnpj)} onChange={(event) => updateLaboratory(index, 'cnpj', onlyDigits(event.target.value))} required /></label>
              <label>Telefone<input type="tel" value={laboratory.phone} onChange={(event) => updateLaboratory(index, 'phone', event.target.value)} required /></label>
              <label>
                CEP
                <input inputMode="numeric" placeholder="00000-000" value={laboratory.postalCode} onChange={(event) => handleLabCepChange(index, event.target.value)} />
                {laboratory.cepStatus === 'loading' && <span className="field-hint">Buscando endereço…</span>}
                {laboratory.cepStatus === 'error' && <span className="field-hint">CEP não encontrado. Preencha manualmente.</span>}
              </label>
              <label className="span-2">Logradouro<input value={laboratory.addressLine} onChange={(event) => updateLaboratory(index, 'addressLine', event.target.value)} required /></label>
              <label>Número<input value={laboratory.addressNumber} onChange={(event) => updateLaboratory(index, 'addressNumber', event.target.value)} /></label>
              <label>Complemento<input value={laboratory.addressComplement} onChange={(event) => updateLaboratory(index, 'addressComplement', event.target.value)} /></label>
              <label>Bairro<input value={laboratory.district} onChange={(event) => updateLaboratory(index, 'district', event.target.value)} /></label>
              <label>Cidade<input value={laboratory.city} onChange={(event) => updateLaboratory(index, 'city', event.target.value)} required /></label>
              <label>Estado<input minLength={2} maxLength={2} value={laboratory.state} onChange={(event) => updateLaboratory(index, 'state', event.target.value.toUpperCase())} required /></label>
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
