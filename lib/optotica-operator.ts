/** Corporate identification supplied by the operator. No personal identity document here. */
export const optoticaOperator = {
  brand: 'Optótica',
  legalName: 'GORAIEB INSTITUTO DA VISAO LTDA',
  cnpj: '48.633.784/0001-11',
  address: 'Avenida Carneiro Leão, 563, sala 1409B, Zona 04, Maringá - PR',
  representative: 'Marcelo Ribeiro Goraieb',
  phone: '(44) 3346-7517',
  mobile: '(44) 9838-4045',
  email: 'contato@uigafas.com.br',
} as const;

export const professionalTermsVersion = '2026-09-17.1';
export const professionalTermsSections = [
  {
    title: '1. Identificação e objeto',
    text: `A Optótica é uma plataforma operada por ${optoticaOperator.legalName}, CNPJ ${optoticaOperator.cnpj}, com endereço em ${optoticaOperator.address}, representada por ${optoticaOperator.representative}. Contato: ${optoticaOperator.email}; ${optoticaOperator.phone}; celular ${optoticaOperator.mobile}. Estes termos regulam o uso da área profissional, o envio de documentos, a conferência documental e a consulta das prescrições emitidas no portal.`,
  },
  {
    title: '2. Cadastro e responsabilidade profissional',
    text: 'O profissional declara que seus dados e documentos são autênticos, pertencem a ele e estão atualizados. Compromete-se a informar alterações na formação, no registro ou na situação profissional. Cada profissional responde pelos atendimentos, registros e documentos que emite, dentro dos limites legais de sua atuação. O uso do portal ou do selo não amplia atribuições profissionais nem representa reconhecimento por órgão público.',
  },
  {
    title: '3. Conferência e selo de verificação',
    text: 'A Optótica poderá conferir a documentação junto às instituições e entidades emissoras e solicitar esclarecimentos. A aprovação depende da análise efetiva dos documentos e da declaração assinada. O selo indica conferência documental pela Optótica, com data e prazo de revisão; não é uma certificação do gov.br nem garantia de resultado do atendimento. O selo pode ser suspenso ou revogado por inconsistências, expiração, alteração cadastral ou necessidade de nova análise.',
  },
  {
    title: '4. Acesso, prescrições e dados de pacientes',
    text: 'O acesso é pessoal. O profissional deve proteger suas credenciais, utilizar somente dados que esteja autorizado a tratar e respeitar a confidencialidade dos pacientes. A plataforma mantém registros de emissão e de alterações relevantes. O QR Code apresenta dados de conferência e identificação parcial do paciente; os graus e demais informações clínicas ficam no acesso protegido. A verificação pelo QR Code não equivale à assinatura digital do PDF.',
  },
  {
    title: '5. Documentos, privacidade e divulgação',
    text: `Os originais enviados e os registros de aceite permanecem em acesso restrito ao profissional e à equipe autorizada. Mediante autorização específica abaixo, as versões públicas do diploma ou certificado e do registro no conselho, conferidas pela equipe, poderão ser consultadas por quem acessar o QR Code. Essas versões devem ocultar CPF, RG, endereço residencial, assinaturas manuscritas e outros dados que não sejam necessários à conferência profissional. A declaração assinada e os termos não serão publicados. Correções, dúvidas e pedidos relativos aos dados ou à retirada da divulgação podem ser enviados a ${optoticaOperator.email}. Os registros necessários para obrigações legais e exercício de direitos poderão ser conservados pelo período aplicável.`,
  },
  {
    title: '6. Aceite eletrônico',
    text: 'Ao marcar o aceite e enviar a documentação, o profissional concorda com esta versão dos termos. O portal registra o usuário autenticado, a data, a versão e o conteúdo aceito. Este aceite substitui o envio de um contrato assinado para o fluxo de verificação e não substitui a assinatura da declaração de veracidade pelo gov.br. Serviços com condições comerciais específicas dependem de apresentação e aceite próprios. Alterações relevantes destes termos serão apresentadas para novo aceite.',
  },
] as const;
export const professionalTermsText = professionalTermsSections.map(section => `${section.title}\n${section.text}`).join('\n\n');
