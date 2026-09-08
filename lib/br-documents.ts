// Utilitários de validação e máscara para documentos e endereços brasileiros
// usados no formulário de cadastro profissional (CPF/CNPJ e CEP via ViaCEP).

export function onlyDigits(value: string): string {
  return (value || '').replace(/\D/g, '');
}

export function isValidCPF(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(cpf.charAt(i), 10) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== parseInt(cpf.charAt(9), 10)) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(cpf.charAt(i), 10) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  return check === parseInt(cpf.charAt(10), 10);
}

export function isValidCNPJ(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calcDigit = (base: string) => {
    const size = base.length;
    let pos = size - 7;
    let sum = 0;
    for (let i = size; i >= 1; i--) {
      sum += parseInt(base.charAt(size - i), 10) * pos--;
      if (pos < 2) pos = 9;
    }
    const result = sum % 11;
    return result < 2 ? 0 : 11 - result;
  };
  const firstDigit = calcDigit(cnpj.substring(0, 12));
  if (firstDigit !== parseInt(cnpj.charAt(12), 10)) return false;
  const secondDigit = calcDigit(cnpj.substring(0, 13));
  return secondDigit === parseInt(cnpj.charAt(13), 10);
}

/** Formata progressivamente como CPF (até 11 dígitos) ou CNPJ (12 a 14 dígitos). */
export function formatCpfCnpj(value: string): string {
  const digits = onlyDigits(value).slice(0, 14);
  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function documentKind(value: string): 'cpf' | 'cnpj' | null {
  const digits = onlyDigits(value);
  if (digits.length === 11) return 'cpf';
  if (digits.length === 14) return 'cnpj';
  return null;
}

export function isValidDocument(value: string): boolean {
  const kind = documentKind(value);
  if (kind === 'cpf') return isValidCPF(value);
  if (kind === 'cnpj') return isValidCNPJ(value);
  return false;
}

export function documentErrorMessage(value: string): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) return 'CPF inválido. Verifique o número informado.';
  if (digits.length === 14) return 'CNPJ inválido. Verifique o número informado.';
  return 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.';
}

export function formatCep(value: string): string {
  const digits = onlyDigits(value).slice(0, 8);
  return digits.replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

export type ViaCepResult = {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
};

/** Busca um CEP no ViaCEP (API pública, gratuita). Retorna null se não encontrar ou em caso de erro de rede. */
export async function lookupCep(value: string): Promise<ViaCepResult | null> {
  const digits = onlyDigits(value);
  if (digits.length !== 8) return null;
  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!response.ok) return null;
    const data = (await response.json()) as ViaCepResult;
    if (data.erro) return null;
    return data;
  } catch {
    return null;
  }
}
