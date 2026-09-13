'use client';

import { useEffect, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/browser-client';
import { parseAliexpressJson, type ParsedAliexpressColor } from '@/lib/catalog/parse-aliexpress-json';
import { COLOR_VOCABULARY } from '@/lib/catalog/sku-standard';
import { colorSwatchBackground, colorSwatchIsLight, colorSwatchSolidHex } from '@/lib/catalog/color-swatch-style';

type Product = {
  id: string;
  modelName: string;
  skuOptotica: string;
  supplierItemId: string;
  lensWidthMm: number | null;
  lensHeightMm: number | null;
  bridgeMm: number | null;
  lensDiagonalMm: number | null;
  templeLengthMm: number | null;
  rimMm: number | null;
  frameTotalWidthMm: number | null;
  standardHeightMm: number | null;
  measurementSource: string;
  status: string;
  supplierName: string | null;
  supplierStoreId: string | null;
  createdAt: string;
  galleryImages: string[];
  // Fotos da galeria com marcação manual de cor (13/09/2026, migração
  // 202609131400 — "Substitui — só marcação manual daqui pra frente") —
  // alimenta a seção "Todas as fotos do anúncio".
  galleryPhotos: { id: string; url: string; colorImageIds: string[] }[];
  positionImageUrl: string | null;
};

type ColorImage = {
  id: string;
  colorName: string;
  supplierSku: string | null;
  status: string;
  missingRequiredFields: string[];
  rejectionReason: string | null;
  validatedAt: string | null;
  originalImageUrl: string | null;
  processedImageUrl: string | null;
  hasSourceImageUrl: boolean;
  // Padrão de SKU/cor (13/09/2026) — ver lib/catalog/sku-standard.ts. Cores
  // criadas antes dessa data podem ter esses campos nulos até a migração de
  // dados rodar (202609131101).
  colorVariantNumber: number | null;
  colorPrincipal: string | null;
  colorSecondary: string | null;
  supplierColorName: string | null;
  // Tabela global de cores (14/09/2026, migração 202609140100) — só
  // preenchida quando esta cor é uma variação de verdade (ex.: "fosco") de
  // uma combinação já existente na tabela global.
  colorNote: string | null;
  variantSku: string | null;
  // Fotos de exibição por cor (13/09/2026, migração 202609131200; formato
  // atual desde 202609131400): até 4, recortadas pela IA a partir das fotos
  // da galeria marcadas manualmente pra esta cor em "Todas as fotos do
  // anúncio" — sem significado especial de posição, todas removíveis e
  // validáveis.
  displayImages: { id: string; position: number; url: string | null; validatedAt: string | null }[];
};

const STATUS_LABEL: Record<string, string> = { em_triagem: 'Em triagem', publicado: 'Publicado', arquivado: 'Arquivado' };
const COLOR_STATUS_LABEL: Record<string, string> = { incompleto: 'Incompleto — falta foto', pendente: 'Pendente', validada: 'Validada', rejeitada: 'Rejeitada' };

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  // `status` (14/09/2026) — precisa pra distinguir "já existe" (409, tabela
  // global de cores) de outras falhas na importação em lote do AliExpress.
  return { ok: response.ok, status: response.status, payload };
}

async function uploadPhoto(productId: string, file: File): Promise<{ ok: true; path: string } | { ok: false; message: string }> {
  // Tudo dentro de um try/catch: uma falha de rede (fetch ou o upload direto
  // pro Storage) lança exceção em vez de devolver {error} — sem isso, o botão
  // que chamou esta função ficava "travado" (busy=true pra sempre, sem
  // nenhuma mensagem) porque o catch do handler nunca era alcançado. Achado
  // em produção (12/09/2026): usuário reportou "clico em Trocar foto e não
  // muda nada", mesmo já tendo escolhido um arquivo.
  try {
    const signRes = await fetchJson(`/api/admin/catalog/products/${productId}/images/upload-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, size: file.size })
    });
    if (!signRes.ok) return { ok: false, message: signRes.payload.message || 'Não foi possível preparar o envio.' };
    const { error } = await getSupabaseBrowserClient().storage.from('catalog-product-photos').uploadToSignedUrl(signRes.payload.path, signRes.payload.token, file);
    if (error) return { ok: false, message: `Não foi possível enviar a foto (${error.message || 'erro desconhecido'}). Tente novamente.` };
    return { ok: true, path: signRes.payload.path };
  } catch (err) {
    return { ok: false, message: `Falha de conexão ao enviar a foto${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` };
  }
}

export function CatalogProductDetail({ productId }: { productId: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [colors, setColors] = useState<ColorImage[] | null>(null);
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const messageRef = useRef<HTMLParagraphElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [showNewColor, setShowNewColor] = useState(false);

  // "Importar/atualizar do AliExpress" (13/09/2026, pedido do usuário — "e os
  // modelos que já estão cadastrados?"): mesma ideia da seção 0.49 (colar
  // JSON na criação de produto novo), agora pra um produto que já existe.
  // Só acrescenta — nunca mexe no nome do modelo/medidas já cadastrados:
  // cria as cores que ainda não existem (comparando por nome, sem repetir as
  // que já estão na tela) e adiciona as fotos gerais do anúncio na galeria
  // (idempotente — colar o mesmo JSON de novo não duplica nada).
  const [showAliexpressImport, setShowAliexpressImport] = useState(false);
  const [aliexpressImportText, setAliexpressImportText] = useState('');
  const [importParseMessage, setImportParseMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [importColors, setImportColors] = useState<(ParsedAliexpressColor & { include: boolean; alreadyExists: boolean; colorPrincipal: string })[]>([]);
  const [importGalleryUrls, setImportGalleryUrls] = useState<string[]>([]);

  // A mensagem de sucesso/erro fica perto do topo da página — mas as ações
  // por cor (Trocar foto, Processar com IA etc.) ficam mais abaixo, na
  // grade de cores. Sem isso, um clique num card lá embaixo produz uma
  // mensagem que aparece fora da tela, dando a impressão de "não fez nada"
  // (achado em produção, 13/09/2026: usuário reportou "clico em Trocar foto
  // e não muda nada" mesmo depois da mensagem já estar aparecendo).
  useEffect(() => {
    if (message) messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [message]);
  const newColorFileRef = useRef<File | null>(null);
  const fixFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const replaceFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  // Selecionar o arquivo é capturado em estado (via onChange), não lido do
  // DOM na hora do clique (via ref) — achado em produção (13/09/2026):
  // usuário reportava "Escolha um arquivo antes de clicar em Trocar foto"
  // mesmo depois de já ter escolhido um arquivo. Ler o arquivo pelo estado
  // do React, capturado no exato onChange do input, remove qualquer
  // dependência de timing entre a seleção e o clique — e mostrar o nome do
  // arquivo na tela dá uma confirmação visual de que a seleção realmente
  // "pegou" antes do usuário clicar em "Trocar foto"/"Adicionar foto".
  const [selectedFixFile, setSelectedFixFile] = useState<Record<string, File | null>>({});
  const [selectedReplaceFile, setSelectedReplaceFile] = useState<Record<string, File | null>>({});
  // Foto de posição do produto (13/09/2026, 2ª rodada — ver migração
  // 202609130009): uma só por produto, compartilhada por todas as cores.
  // Mesmo padrão de captura por estado (não por ref/DOM) que corrigiu o
  // "Trocar foto" por cor.
  const positionFileInput = useRef<HTMLInputElement | null>(null);
  const [selectedPositionFile, setSelectedPositionFile] = useState<File | null>(null);

  function applyLoad({ ok, payload }: Awaited<ReturnType<typeof fetchJson>>) {
    if (ok) { setProduct(payload.product); setColors(payload.colorImages); }
    else setMessage({ kind: 'error', text: payload.message || 'Produto não encontrado.' });
  }

  function load() {
    return fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }

  useEffect(() => {
    fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }, [productId]);

  async function handleSaveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    // try/finally (13/09/2026, 5ª rodada — achado em produção: "clico pra
    // enviar e não acontece nada" no botão de foto de posição, sem nenhuma
    // mensagem). Causa real: `busy` é um estado ÚNICO que desabilita TODOS os
    // botões da página — se qualquer chamada aqui lançar uma exceção (rede
    // caiu, a função da Vercel truncou a resposta no meio por demorar demais,
    // etc.) sem passar por um catch/finally, `setBusy(false)` nunca roda, e a
    // página inteira fica travada com todo botão desabilitado, silenciosamente
    // (clicar num botão desabilitado não faz nada, nem chama a função — por
    // isso "não acontece nada"). Só um F5 destravava. Esse mesmo padrão
    // (try/finally garantindo `setBusy(false)` sempre) já existia em alguns
    // handlers (ex.: handleReplacePhoto) mas não em todos — agora está em
    // todos os que usam `busy`.
    try {
      const form = new FormData(event.currentTarget);
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelName: form.get('modelName'),
          skuOptotica: form.get('skuOptotica'),
          lensWidthMm: Number(form.get('lensWidthMm')),
          lensHeightMm: Number(form.get('lensHeightMm')),
          // Medidas completas (13/09/2026, 7ª rodada) — opcionais: campo
          // vazio manda '' (a rota interpreta como "limpar", vira null).
          bridgeMm: form.get('bridgeMm'),
          lensDiagonalMm: form.get('lensDiagonalMm'),
          templeLengthMm: form.get('templeLengthMm'),
          rimMm: form.get('rimMm'),
          frameTotalWidthMm: form.get('frameTotalWidthMm'),
          standardHeightMm: form.get('standardHeightMm')
        })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(status: 'publicado' | 'arquivado') {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  async function handleNewColor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData(event.currentTarget);
      const colorPrincipal = String(form.get('colorPrincipal') || '');
      const colorSecondary = String(form.get('colorSecondary') || '') || undefined;
      const colorNote = String(form.get('colorNote') || '') || undefined;
      const supplierColorName = String(form.get('supplierColorName') || '') || undefined;
      const supplierSku = String(form.get('supplierSku') || '') || undefined;
      const file = newColorFileRef.current;

      let originalImagePath: string | undefined;
      if (file) {
        const uploaded = await uploadPhoto(productId, file);
        if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
        originalImagePath = uploaded.path;
      }

      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorPrincipal, colorSecondary, colorNote, supplierColorName, supplierSku, originalImagePath })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) { event.currentTarget.reset(); newColorFileRef.current = null; setShowNewColor(false); load(); }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  function handleParseAliexpressImport() {
    setImportParseMessage(null);
    try {
      const parsed = parseAliexpressJson(aliexpressImportText);
      // Padrão de SKU/cor (13/09/2026): o nome não é mais digitado, então
      // "já cadastrada aqui" não pode mais comparar por nome — compara pelo
      // SKU do fornecedor (o identificador estável que realmente veio do
      // anúncio) quando disponível.
      //
      // Tabela global de cores (14/09/2026, depois do bug real — mesmo
      // modelo ganhou duas cores "Tartaruga" ao reimportar): agora TAMBÉM
      // compara pela cor principal já usada neste produto (sem cor
      // secundária) — é só uma pré-marcação (a rota de criação é quem
      // garante de verdade que não duplica, rejeitando com 409 se a mesma
      // combinação já existir), mas evita já entrar marcada pra importar de
      // novo uma cor que, visivelmente, é a mesma.
      const existingSkus = new Set((colors || []).map((c) => (c.supplierSku || '').trim().toLowerCase()).filter(Boolean));
      const existingPrincipals = new Set((colors || []).filter((c) => !c.colorSecondary).map((c) => (c.colorPrincipal || '').trim().toLowerCase()).filter(Boolean));
      const withInclude = parsed.colors.map((c) => {
        const suggested = c.suggestedPrincipalColor || '';
        const alreadyExists = (Boolean(c.supplierSku) && existingSkus.has(c.supplierSku!.trim().toLowerCase()))
          || (Boolean(suggested) && existingPrincipals.has(suggested.trim().toLowerCase()));
        return { ...c, alreadyExists, include: !alreadyExists, colorPrincipal: suggested };
      });
      setImportColors(withInclude);
      setImportGalleryUrls(parsed.galleryImageUrls);
      const existingCount = withInclude.filter((c) => c.alreadyExists).length;
      setImportParseMessage({
        kind: 'success',
        text: `Encontrei ${parsed.colors.length} cor(es)${existingCount ? ` (${existingCount} já cadastrada(s) aqui, desmarcada(s))` : ''} e ${parsed.galleryImageUrls.length} foto(s) gerais do anúncio.`
      });
    } catch (err) {
      setImportColors([]);
      setImportGalleryUrls([]);
      setImportParseMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Não foi possível ler esse JSON.' });
    }
  }

  function updateImportColor(index: number, patch: Partial<ParsedAliexpressColor & { include: boolean; colorPrincipal: string }>) {
    setImportColors((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function handleImportAliexpress() {
    setBusy(true);
    setMessage(null);
    try {
      const toCreate = importColors.filter((c) => c.include && c.colorPrincipal);
      let successCount = 0;
      let duplicateCount = 0;
      let failCount = 0;
      for (const color of toCreate) {
        const res = await fetchJson(`/api/admin/catalog/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colorPrincipal: color.colorPrincipal, supplierColorName: color.supplierColorName || undefined, supplierSku: color.supplierSku || undefined, sourceImageUrl: color.sourceImageUrl || undefined })
        });
        if (res.ok) successCount += 1;
        // 409 = já existe uma cor com esta combinação neste produto (tabela
        // global de cores, 14/09/2026) — não é bem uma "falha", é o
        // comportamento esperado pra evitar duplicar.
        else if (res.status === 409) duplicateCount += 1;
        else failCount += 1;
      }

      let galleryMessage = '';
      if (importGalleryUrls.length) {
        const galleryRes = await fetchJson(`/api/admin/catalog/products/${productId}/gallery`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrls: importGalleryUrls })
        });
        galleryMessage = galleryRes.ok ? ` ${galleryRes.payload.message}` : ' Não foi possível salvar as fotos da galeria.';
      }

      const parts: string[] = [];
      if (toCreate.length) {
        const extras: string[] = [];
        if (duplicateCount) extras.push(`${duplicateCount} já existia(m) neste produto, não recriada(s)`);
        if (failCount) extras.push(`${failCount} falharam — tente novamente`);
        parts.push(`${successCount} cor(es) criada(s)${extras.length ? ` (${extras.join('; ')})` : ''}.`);
      }
      if (galleryMessage) parts.push(galleryMessage.trim());
      setMessage({ kind: failCount ? 'error' : 'success', text: parts.join(' ') || 'Nada novo para importar desse JSON.' });

      setShowAliexpressImport(false);
      setAliexpressImportText('');
      setImportColors([]);
      setImportGalleryUrls([]);
      setImportParseMessage(null);
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMissingPhoto(colorImageId: string) {
    const file = selectedFixFile[colorImageId];
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Adicionar foto".' }); return; }
    setBusy(true);
    setMessage(null);
    // try/finally: garante que o botão nunca fique travado (busy preso em
    // true) e que sempre apareça alguma mensagem, mesmo se algo inesperado
    // (rede, etc.) der errado no meio do caminho.
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'completar', stillMissing: [], originalImagePath: uploaded.path })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedFixFile((prev) => ({ ...prev, [colorImageId]: null }));
      const input = fixFileInputs.current[colorImageId];
      if (input) input.value = '';
    }
  }

  async function handleReplacePhoto(colorImageId: string) {
    const file = selectedReplaceFile[colorImageId];
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Trocar foto".' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trocar_foto', originalImagePath: uploaded.path })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedReplaceFile((prev) => ({ ...prev, [colorImageId]: null }));
      const input = replaceFileInputs.current[colorImageId];
      if (input) input.value = '';
    }
  }

  async function handleImportPhoto(colorImageId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/import-photo`, { method: 'POST' });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Pedido do usuário (13/09/2026): buscar outra foto do AliExpress em vez
  // de só aceitar upload manual. As fotos oferecidas são as ~6 fotos gerais
  // do anúncio (galeria por produto, não por cor — ver migração
  // 202609130006): podem ser de outra cor, por isso a escolha é sempre
  // visual (miniatura clicável), nunca automática.
  async function handleImportFromGallery(colorImageId: string, imageUrl: string) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/import-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Envio manual da foto de posição do produto (mesmo padrão do "Trocar
  // foto" por cor: try/finally, arquivo lido de estado capturado no
  // onChange). Pedido do usuário (13/09/2026, 6ª rodada): esta seção passa a
  // ser SÓ upload manual — a opção de escolher direto da galeria do anúncio
  // foi removida da tela, já que aquelas fotos vêm cruas (sem recorte) e não
  // servem mais aqui desde a 4ª rodada (a foto de posição precisa vir
  // recortada). A rota `.../position-photo` continua aceitando `imageUrl`
  // no corpo por compatibilidade, mas não é mais chamada por nenhum botão.
  async function handleUploadProductPosition() {
    const file = selectedPositionFile;
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Salvar foto de posição".' }); return; }
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/position-photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: uploaded.path })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedPositionFile(null);
      if (positionFileInput.current) positionFileInput.current.value = '';
    }
  }

  async function handleProcess(colorImageId: string) {
    setBusy(true);
    setMessage(null);
    // try/finally (13/09/2026, 5ª rodada — achado em produção): esta é a
    // chamada mais demorada da tela (chega a chamar uma IA generativa) e por
    // isso a mais fácil de esbarrar num erro de REDE de verdade (não um erro
    // "normal" com resposta HTTP, mas a conexão cair no meio — ex.: a função
    // da Vercel estourar o tempo limite antes de terminar). Sem try/finally
    // aqui, uma falha dessas deixava `busy` travado em `true` pra sempre —
    // como `busy` desabilita TODOS os botões da página (não só este), o
    // sintoma reportado foi "clico em Trocar foto de posição [um botão sem
    // nenhuma relação] e não acontece nada", sem nenhuma mensagem — porque um
    // botão desabilitado nem chama a função ao ser clicado. Um F5 destravava
    // (recarregava o estado do zero), mas o clique em si nunca fazia nada até
    // isso.
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/process`, { method: 'POST' });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate(colorImageId: string, action: 'validar' | 'rejeitar') {
    let reason: string | undefined;
    if (action === 'rejeitar') {
      reason = window.prompt('Motivo da rejeição:') || '';
      if (!reason) return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Remover uma foto de exibição já recortada (13/09/2026, migração
  // 202609131200; qualquer posição desde a 202609131400 — não há mais
  // posição especial, ver comentário no DELETE da rota).
  async function handleRemoveDisplayImage(colorImageId: string, position: number) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Validar uma foto de exibição (13/09/2026, migração 202609131400 — botão
  // "Validar" do mockup): registro de que o master já conferiu esta foto.
  async function handleValidateDisplayImage(colorImageId: string, position: number) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Marcação manual de cor por foto geral do anúncio (13/09/2026, mockup do
  // usuário + migração 202609131400 — "Substitui — só marcação manual daqui
  // pra frente"): cada bolinha de cor numa foto liga/desliga a marcação —
  // sempre manda o conjunto COMPLETO de cores já marcadas nesta foto (a rota
  // substitui tudo, não acrescenta uma por vez).
  async function handleToggleGalleryColor(galleryImageId: string, colorImageId: string) {
    const photo = product?.galleryPhotos.find((p) => p.id === galleryImageId);
    if (!photo) return;
    const next = new Set(photo.colorImageIds);
    if (next.has(colorImageId)) next.delete(colorImageId);
    else next.add(colorImageId);
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${galleryImageId}/colors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorImageIds: Array.from(next) })
      });
      if (!ok) setMessage({ kind: 'error', text: payload.message || 'Não foi possível salvar a marcação de cores.' });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Remover uma foto de "Todas as fotos do anúncio" (14/09/2026) — pedido do
  // usuário depois de descobrir que o JSON do AliExpress pode trazer, junto
  // com as fotos de verdade do produto, banners genéricos e fotos de OUTROS
  // modelos que a mesma loja vende (embutidos na própria descrição do
  // anúncio) — não dá pra saber isso de antemão, então o jeito é o master
  // apagar na mão o que não serve depois de ver na tela.
  async function handleRemoveGalleryPhoto(galleryImageId: string) {
    if (!confirm('Remover esta foto da galeria deste produto? Isso não pode ser desfeito.')) return;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${galleryImageId}`, { method: 'DELETE' });
      if (!ok) setMessage({ kind: 'error', text: payload.message || 'Não foi possível remover esta foto.' });
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  if (!product || !colors) return <p className="muted">{message?.text || 'Carregando…'}</p>;

  return (
    <div>
      <div className="dashboard-head">
        <div>
          <p className="eyebrow">{STATUS_LABEL[product.status]}</p>
          <h1 style={{ fontSize: 28 }}>{product.modelName}</h1>
          <p className="muted">SKU {product.skuOptotica} · {product.supplierName || 'sem fornecedor'} · Product ID {product.supplierItemId}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {product.status !== 'publicado' && <button className="button primary" type="button" disabled={busy} onClick={() => handlePublish('publicado')}>Publicar</button>}
          {product.status !== 'arquivado' && <button className="button secondary" type="button" disabled={busy} onClick={() => handlePublish('arquivado')}>Arquivar</button>}
        </div>
      </div>

      {message && <p ref={messageRef} className={`form-message ${message.kind}`}>{message.text}</p>}

      <form className="card" style={{ padding: 20, marginBottom: 20 }} onSubmit={handleSaveProduct}>
        <div className="form-grid">
          <label>Nome do modelo<input name="modelName" defaultValue={product.modelName} required minLength={2} /></label>
          <label>SKU (Optótica)<input name="skuOptotica" defaultValue={product.skuOptotica} required /></label>
          {/* Horizontal/Vertical maior da lente = os mesmos lens_width_mm/
              lens_height_mm de sempre, só com rótulo novo (13/09/2026, 7ª
              rodada, pedido do usuário via mockup) — lens_width_mm continua
              obrigatório e usado de verdade pela Prova Online, por isso
              continua "required"; os 6 campos novos abaixo são só de
              referência pro laboratório, opcionais. */}
          <label>Horizontal maior da lente (mm)<input name="lensWidthMm" type="number" step="0.1" defaultValue={product.lensWidthMm ?? ''} required /></label>
          <label>Vertical maior da lente (mm)<input name="lensHeightMm" type="number" step="0.1" defaultValue={product.lensHeightMm ?? ''} required /></label>
          <label>Ponte (mm)<input name="bridgeMm" type="number" step="0.1" defaultValue={product.bridgeMm ?? ''} /></label>
          <label>Diagonal maior de lente (mm)<input name="lensDiagonalMm" type="number" step="0.1" defaultValue={product.lensDiagonalMm ?? ''} /></label>
          <label>Hastes (mm)<input name="templeLengthMm" type="number" step="0.1" defaultValue={product.templeLengthMm ?? ''} /></label>
          <label>Aro (mm)<input name="rimMm" type="number" step="0.1" defaultValue={product.rimMm ?? ''} /></label>
          <label>Frente Total (mm)<input name="frameTotalWidthMm" type="number" step="0.1" defaultValue={product.frameTotalWidthMm ?? ''} /></label>
          <label>Altura padrão (mm)<input name="standardHeightMm" type="number" step="0.1" defaultValue={product.standardHeightMm ?? ''} /></label>
        </div>
        <p className="helper">Origem da medida: {product.measurementSource === 'manual' ? 'corrigida manualmente' : 'API do fornecedor'}. As 6 medidas extras (Ponte, Diagonal, Hastes, Aro, Frente Total, Altura padrão) são opcionais — só referência pro laboratório, não afetam a Prova Online. Product ID, SKU e loja ficam só neste painel — nunca aparecem para o paciente.</p>
        <button className="button primary" type="submit" disabled={busy}>Salvar alterações</button>
      </form>

      {/* Foto de posição do produto (13/09/2026, 2ª rodada — depois mudou de
          sentido na 4ª rodada, ver lib/catalog/frame-colorize.ts): uma só,
          usada por "Processar com IA" em TODAS as cores deste modelo — o
          ângulo/pose é o mesmo, só a cor muda (ver migração 202609130009).
          A partir da 4ª rodada esta foto PRECISA já vir recortada (fundo e
          lente transparentes, feita fora do sistema) — deixou de ser uma
          foto crua que a IA recorta sozinha: agora ela também define a
          forma final do resultado (a IA só recolore por cima, nunca recorta
          nada), então se ela não estiver bem recortada o resultado sai sem
          nenhum recorte. */}
      <div className="card catalog-position-card">
        <div className="preview">
          {product.positionImageUrl ? <img src={product.positionImageUrl} alt="Foto de posição do produto" /> : 'sem foto de posição'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="section-label">Foto de posição — já recortada (de frente, fundo e lente transparentes, usada para todas as cores deste modelo)</span>
          <span className="helper">Envie um PNG já recortado por fora do sistema (ex.: Photoshop, remove.bg): fundo e a área da lente transparentes, só a armação visível. Esta foto define a forma final do resultado — a IA só troca a cor, não recorta mais nada.</span>
          <input
            type="file"
            accept="image/png"
            ref={positionFileInput}
            onChange={(e) => setSelectedPositionFile(e.target.files?.[0] || null)}
          />
          {selectedPositionFile ? (
            <span className="helper">Arquivo selecionado: {selectedPositionFile.name}</span>
          ) : (
            <span className="helper">Envie aqui o PNG já recortado</span>
          )}
          {/* Rótulo único "Salvar foto de posição", sem variante "Trocar"
              (13/09/2026, 8ª rodada, pedido do usuário): esse botão SEMPRE
              foi só upload manual do arquivo escolhido acima em "Escolher
              arquivo" — nunca consultou o AliExpress (isso só existe no
              "Trocar foto" por COR, seção mais abaixo, que tem miniaturas da
              galeria). O rótulo "Trocar" aqui só gerava confusão por
              parecer a mesma coisa. Comportamento não muda: salva o arquivo
              selecionado, e se já havia uma foto de posição, ela é
              substituída. */}
          <button className="button secondary small" type="button" disabled={busy} style={{ justifySelf: 'start' }} onClick={handleUploadProductPosition}>
            Salvar foto de posição
          </button>
          {product.positionImageUrl && (
            <span className="helper">Trocar esta foto marca as cores já tratadas para reprocessar (a pose mudou pra todas elas).</span>
          )}
        </div>
      </div>

      {/* "Todas as fotos do anúncio" (13/09/2026, mockup do usuário +
          migração 202609131400 — "Substitui — só marcação manual daqui pra
          frente"): o master marca aqui, foto a foto, quais cores aparecem em
          cada uma (uma foto pode ter mais de uma cor — ex.: foto
          comparativa). Essa marcação é o que "Processar com IA", em cada
          cor mais abaixo, usa como fonte das fotos a recortar — nada aqui
          recorta nada sozinho, é só a marcação. */}
      {product.galleryPhotos.length > 0 && colors.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 20 }}>
          <span className="section-label">Todas as fotos do anúncio — marque quais cores aparecem em cada foto</span>
          <p className="helper" style={{ margin: '4px 0 12px' }}>
            Clique nas bolinhas de cor abaixo de cada foto para marcar/desmarcar. Ao processar uma cor com IA, ela recorta
            só as fotos marcadas para aquela cor.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {product.galleryPhotos.map((photo) => (
              <div key={photo.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 108 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Foto do anúncio" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4 }} />
                {/* "Remover" (14/09/2026): pro caso de o JSON do AliExpress ter
                    trazido junto algo que não é foto deste produto (banner da
                    loja, foto de outro modelo embutida na descrição do
                    anúncio) — apaga só esta foto da galeria deste produto. */}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleRemoveGalleryPhoto(photo.id)}
                  style={{ fontSize: 10, padding: '2px 8px', borderRadius: 999, border: '1px solid #c33', background: '#fff', color: '#c33', cursor: 'pointer' }}
                >
                  Remover
                </button>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'center' }}>
                  {colors.map((color) => {
                    const marked = photo.colorImageIds.includes(color.id);
                    const label = color.colorVariantNumber ? `C${color.colorVariantNumber}` : (color.colorName || '?').slice(0, 2);
                    const title = color.colorVariantNumber
                      ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}`
                      : color.colorName;
                    // Bolinha colorida de acordo com a cor de verdade da variante
                    // (pedido do usuário, 13/09/2026: "colorir cada checkbox de
                    // cor de acordo com a cor correspondente") — marcada = bolinha
                    // preenchida com a cor (bicolor vira meio a meio); desmarcada =
                    // só o contorno na cor, fundo branco. O "✓" garante que dá pra
                    // ver que está marcada mesmo em cores muito claras (branco,
                    // cristal etc.), onde o preenchimento sozinho quase não aparece.
                    const solidHex = colorSwatchSolidHex(color.colorPrincipal);
                    const isLight = colorSwatchIsLight(color.colorPrincipal);
                    return (
                      <button
                        key={color.id}
                        type="button"
                        disabled={busy}
                        title={title}
                        onClick={() => handleToggleGalleryColor(photo.id, color.id)}
                        style={{
                          fontSize: 10,
                          lineHeight: 1,
                          padding: '4px 6px',
                          borderRadius: 999,
                          border: `2px solid ${solidHex}`,
                          background: marked ? colorSwatchBackground(color.colorPrincipal, color.colorSecondary) : '#fff',
                          color: marked ? (isLight ? '#222' : '#fff') : solidHex,
                          cursor: 'pointer',
                          fontWeight: 700
                        }}
                      >
                        {label}{marked ? ' ✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="catalog-toolbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>Cores e fotos de prova</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" type="button" onClick={() => setShowAliexpressImport((v) => !v)}>Importar/atualizar do AliExpress</button>
          <button className="button secondary" type="button" onClick={() => setShowNewColor((v) => !v)}>+ Adicionar cor</button>
        </div>
      </div>

      {showAliexpressImport && (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Colar JSON do AliExpress</label>
            <p className="helper" style={{ margin: 0 }}>
              Cole a resposta da API &quot;Item Detail&quot; deste produto — cria as cores que ainda não existem aqui
              (com a foto de referência já associada) e adiciona as fotos gerais na galeria. Nada do que já está
              cadastrado neste produto é alterado.
            </p>
            <textarea
              rows={4}
              value={aliexpressImportText}
              onChange={(e) => setAliexpressImportText(e.target.value)}
              placeholder='Cole aqui o JSON, ex.: {"result":{"item":{...}}}'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div>
              <button className="button secondary small" type="button" onClick={handleParseAliexpressImport} disabled={!aliexpressImportText.trim()}>
                Analisar JSON
              </button>
            </div>
            {importParseMessage && <p className={`form-message ${importParseMessage.kind}`} style={{ margin: 0 }}>{importParseMessage.text}</p>}
          </div>

          {importColors.length > 0 && (
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>Cores detectadas — confirme a cor principal antes de importar</label>
              {importColors.map((color, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: color.alreadyExists ? 0.6 : 1 }}>
                  <input type="checkbox" checked={color.include} onChange={(e) => updateImportColor(index, { include: e.target.checked })} />
                  {color.sourceImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={color.sourceImageUrl} alt={color.supplierColorName} style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} />
                  ) : (
                    <span style={{ width: 32, height: 32 }} />
                  )}
                  <select value={color.colorPrincipal} onChange={(e) => updateImportColor(index, { colorPrincipal: e.target.value })} style={{ flex: 1 }}>
                    <option value="" disabled>Escolha a cor principal</option>
                    {COLOR_VOCABULARY.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <span className="muted" style={{ fontSize: 11 }}>{color.supplierColorName}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{color.alreadyExists ? 'já cadastrada aqui' : color.supplierSku || 'sem SKU do fornecedor'}</span>
                </div>
              ))}
            </div>
          )}

          {(importColors.length > 0 || importGalleryUrls.length > 0) && (
            <button className="button primary" type="button" disabled={busy} style={{ justifySelf: 'start' }} onClick={handleImportAliexpress}>
              Importar {importColors.filter((c) => c.include).length} cor(es) e {importGalleryUrls.length} foto(s) da galeria
            </button>
          )}
        </div>
      )}

      {showNewColor && (
        <form className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }} onSubmit={handleNewColor}>
          <div className="form-grid">
            <label>Cor principal
              <select name="colorPrincipal" required defaultValue="">
                <option value="" disabled>Selecione</option>
                {COLOR_VOCABULARY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Cor secundária (opcional — armações bicolor)
              <select name="colorSecondary" defaultValue="">
                <option value="">nenhuma</option>
                {COLOR_VOCABULARY.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>Cor original do fornecedor (opcional, só rastreabilidade interna)<input name="supplierColorName" /></label>
            <label>SKU do fornecedor (opcional)<input name="supplierSku" /></label>
            {/* Tabela global de cores (14/09/2026): C1, C2... agora é o
                mesmo número em qualquer modelo — este produto NÃO pode ter
                duas cores com a mesma combinação principal/secundária.
                "Observação da cor" só deve ser preenchida quando esta cor é
                uma variação de verdade da mesma combinação (ex.: "fosco"),
                pra virar um C-número novo em vez de ser barrada como
                repetida. */}
            <label>Observação da cor (opcional — só se for uma variação diferente da mesma cor, ex.: &quot;fosco&quot;)<input name="colorNote" placeholder="deixe em branco na maioria das vezes" /></label>
          </div>
          <p className="helper" style={{ margin: 0 }}>
            O número da cor (C1, C2...) vem de uma tabela global — a mesma cor principal/secundária sempre usa o mesmo
            número, em qualquer modelo. O nome desta cor (ex.: &quot;{product.modelName} - Cor N&quot;) e o SKU da
            variante são gerados automaticamente.
          </p>
          <label>Foto real da armação nessa cor (opcional agora — sem foto, a cor entra como &quot;incompleto&quot;)
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { newColorFileRef.current = e.target.files?.[0] || null; }} />
          </label>
          <button className="button primary" type="submit" disabled={busy} style={{ justifySelf: 'start' }}>Adicionar cor</button>
        </form>
      )}

      {colors.length ? (
        <div className="catalog-color-grid">
          {colors.map((color) => (
            <div key={color.id} className="catalog-color-card">
              <div className="catalog-color-photos">
                <div className="half">
                  <span className="catalog-photo-label">Foto da cor</span>
                  {color.originalImageUrl ? <img src={color.originalImageUrl} alt="Foto da cor" /> : 'sem foto'}
                </div>
                <div className="half">
                  <span className="catalog-photo-label">Tratada</span>
                  {color.processedImageUrl ? <img src={color.processedImageUrl} alt="Tratada" /> : 'aguardando tratamento'}
                </div>
              </div>
              <div className="catalog-color-body">
                <div className="name">
                  <span className="catalog-swatch" style={{ background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary) }} />
                  {color.colorVariantNumber ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}${color.colorNote ? ` (${color.colorNote})` : ''}` : color.colorName}
                </div>
                {color.variantSku && <span className="muted" style={{ fontSize: 11 }}>SKU {color.variantSku}</span>}
                {color.supplierColorName && <span className="muted" style={{ fontSize: 11 }}>Cor original do fornecedor: {color.supplierColorName}</span>}
                {color.supplierSku && <span className="muted" style={{ fontSize: 11 }}>SKU do fornecedor {color.supplierSku}</span>}
                <span className={`catalog-badge ${color.status}`}>{COLOR_STATUS_LABEL[color.status] || color.status}</span>
                {color.rejectionReason && <span className="helper">Motivo: {color.rejectionReason}</span>}

                <div className="catalog-color-section">
                  <span className="section-label">Foto da cor (a foto real desta cor — também usada como referência de cor no processamento)</span>
                  {color.status === 'incompleto' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {color.hasSourceImageUrl && (
                        <button className="button primary small" type="button" disabled={busy} onClick={() => handleImportPhoto(color.id)}>Importar do AliExpress</button>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        ref={(el) => { fixFileInputs.current[color.id] = el; }}
                        onChange={(e) => setSelectedFixFile((prev) => ({ ...prev, [color.id]: e.target.files?.[0] || null }))}
                      />
                      {selectedFixFile[color.id] && (
                        <span className="helper">Arquivo selecionado: {selectedFixFile[color.id]!.name}</span>
                      )}
                      <button className="button secondary small" type="button" disabled={busy} onClick={() => handleAddMissingPhoto(color.id)}>Adicionar foto{color.hasSourceImageUrl ? ' manualmente' : ''}</button>
                    </div>
                  )}
                  {(color.status === 'pendente' || color.status === 'rejeitada') && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {product.galleryImages.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="helper">Fotos gerais do anúncio (podem ser de outra cor — confira antes de usar):</span>
                          <div className="catalog-gallery-thumbs">
                            {product.galleryImages.map((url) => (
                              <button key={url} type="button" disabled={busy} onClick={() => handleImportFromGallery(color.id, url)} title="Usar esta foto">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={url} alt="Foto do anúncio" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        ref={(el) => { replaceFileInputs.current[color.id] = el; }}
                        onChange={(e) => setSelectedReplaceFile((prev) => ({ ...prev, [color.id]: e.target.files?.[0] || null }))}
                      />
                      {selectedReplaceFile[color.id] ? (
                        <span className="helper">Arquivo selecionado: {selectedReplaceFile[color.id]!.name}</span>
                      ) : (
                        <span className="helper">Nenhum arquivo selecionado ainda</span>
                      )}
                      <button className="button secondary small" type="button" disabled={busy} onClick={() => handleReplacePhoto(color.id)}>Trocar foto (ex.: veio errada)</button>
                    </div>
                  )}
                </div>

                {color.status === 'pendente' && (
                  <div className="catalog-color-section">
                    <span className="section-label">Processamento</span>
                    {!product.positionImageUrl && (
                      <span className="helper">Falta a foto de posição do produto (seção no topo da página).</span>
                    )}
                    {!color.originalImageUrl && (
                      <span className="helper">Falta a foto desta cor (seção acima).</span>
                    )}
                    {(() => {
                      const taggedPhotos = product.galleryPhotos.filter((p) => p.colorImageIds.includes(color.id));
                      return taggedPhotos.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <span className="helper">{taggedPhotos.length} foto(s) marcada(s) para esta cor em &quot;Todas as fotos do anúncio&quot; — serão recortadas ao processar:</span>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {taggedPhotos.map((p) => (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={p.id} src={p.url} alt="Marcada para esta cor" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="helper">Nenhuma foto marcada para esta cor ainda — marque em &quot;Todas as fotos do anúncio&quot; acima antes de processar, se quiser fotos de exibição extras.</span>
                      );
                    })()}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="button secondary small" type="button" disabled={busy || !product.positionImageUrl || !color.originalImageUrl} onClick={() => handleProcess(color.id)}>
                        {color.processedImageUrl ? 'Reprocessar com IA' : 'Processar com IA'}
                      </button>
                      <button className="button primary small" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'validar')}>Validar</button>
                      <button className="text-button danger" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'rejeitar')}>Rejeitar</button>
                    </div>
                  </div>
                )}

                {color.displayImages.length > 0 && (
                  <div className="catalog-color-section">
                    <span className="section-label">Fotos de exibição desta cor ({color.displayImages.length}/4) — recortadas pela IA a partir das fotos marcadas para esta cor em &quot;Todas as fotos do anúncio&quot;</span>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {color.displayImages.map((img) => (
                        <div key={img.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                          {img.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img.url} alt={`Foto ${img.position}`} style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 4 }} />
                          ) : (
                            <span style={{ width: 64, height: 64 }} />
                          )}
                          <span className="muted" style={{ fontSize: 10 }}>{img.validatedAt ? 'validada' : 'recortada por IA'}</span>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {!img.validatedAt && (
                              <button className="text-button" type="button" disabled={busy} style={{ fontSize: 11 }} onClick={() => handleValidateDisplayImage(color.id, img.position)}>
                                Validar
                              </button>
                            )}
                            <button className="text-button danger" type="button" disabled={busy} style={{ fontSize: 11 }} onClick={() => handleRemoveDisplayImage(color.id, img.position)}>
                              Remover
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="catalog-empty">Nenhuma cor cadastrada ainda.</div>
      )}
    </div>
  );
}
