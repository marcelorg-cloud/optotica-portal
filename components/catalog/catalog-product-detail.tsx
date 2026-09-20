'use client';

import { CatalogColorPicker } from '@/components/catalog/catalog-color-picker';
import { useProcessingFeedback } from '@/components/processing-feedback';

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
  // Caminho cru no Storage (15/09/2026, "Desfazer última ação") — só usado
  // pra guardar/restaurar o valor de antes, nunca mostrado na tela (a URL
  // assinada acima é o que renderiza a foto).
  positionImagePath: string | null;
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
  // Caminhos crus no Storage (15/09/2026, "Desfazer última ação") — mesma
  // razão do comentário em Product.positionImagePath acima.
  originalImagePath: string | null;
  processedImagePath: string | null;
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
  // ATIVAR/OCULTAR (15/09/2026): controla se esta cor pode aparecer nos
  // fronts do profissional/paciente — independente do `status` de
  // processamento/validação da foto. Nasce `false` em toda cor.
  isActive: boolean;
  // Ordem de exibição no front (15/09/2026) — null = nunca reordenada
  // manualmente, fica no fim (ordenada por colorVariantNumber).
  displayOrder: number | null;
  variantSku: string | null;
  // Fotos de exibição por cor (13/09/2026, migração 202609131200; formato
  // atual desde 202609131400): até 4, recortadas pela IA a partir das fotos
  // da galeria marcadas manualmente pra esta cor em "Todas as fotos do
  // anúncio" — sem significado especial de posição, todas removíveis e
  // validáveis.
  displayImages: {
    id: string;
    position: number;
    url: string | null;
    validatedAt: string | null;
    imagePath: string | null;
    // Origem (15/09/2026, fim da recolorização — ver estado-consolidado.md
    // seção 0.67): usados só pelo "Desfazer última ação" (restaurar fiel) e
    // pra ler se a foto veio da própria "Foto da cor" ou de uma foto da
    // galeria marcada.
    source: string;
    sourceGalleryImageId: string | null;
    fromOwnColorPhoto: boolean;
  }[];
};

// Instantâneo do que a linha da cor tinha ANTES da última ação (15/09/2026,
// botão "Desfazer última ação") — só os campos que a tela já recebe do
// servidor (ver ColorImage acima); escrito de volta via a ação `restaurar`
// em .../images/[colorImageId]/route.ts.
type ColorSnapshot = {
  status: string;
  originalImagePath: string | null;
  processedImagePath: string | null;
  rejectionReason: string | null;
  validatedAt: string | null;
  missingRequiredFields: string[];
  isActive: boolean;
};

function snapshotColor(color: ColorImage): ColorSnapshot {
  return {
    status: color.status,
    originalImagePath: color.originalImagePath,
    processedImagePath: color.processedImagePath,
    rejectionReason: color.rejectionReason,
    validatedAt: color.validatedAt,
    missingRequiredFields: color.missingRequiredFields,
    isActive: color.isActive
  };
}

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
  useProcessingFeedback(busy, 'Processando catálogo…');
  const [normalizationBeforeUrl, setNormalizationBeforeUrl] = useState<string | null>(null);
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
  // `existingColorImageId` (14/09/2026, pedido do usuário — "trocasse todas
  // as fotos do produto, tipo um reset das imagens... inclusive a foto da
  // cor"): quando uma cor do JSON já bate com uma cor cadastrada aqui (por
  // SKU do fornecedor, ou por cor principal sem cor secundária — mesmo
  // critério que já decidia `alreadyExists`), guarda o id dela também, pra
  // dar pra "Resetar foto(s)" saber qual linha atualizar.
  const [importColors, setImportColors] = useState<(ParsedAliexpressColor & { include: boolean; alreadyExists: boolean; colorPrincipal: string; existingColorImageId: string | null })[]>([]);
  const [importGalleryUrls, setImportGalleryUrls] = useState<string[]>([]);
  // Lembrar o último JSON usado (14/09/2026, pedido do usuário — "seria bom
  // que aparecesse o Json usado pela ultima vez"): busca no servidor só na
  // PRIMEIRA vez que o painel é aberto nesta sessão da tela (o ref evita
  // buscar de novo se o master fechar e abrir o painel várias vezes) —
  // ver handleOpenAliexpressImport.
  const hasFetchedLastJson = useRef(false);
  const [loadingLastJson, setLoadingLastJson] = useState(false);

  // Rolagem automática até a mensagem REMOVIDA (15/09/2026 — 2ª rodada do
  // "Desfazer última ação", ver comentário junto do JSX do bloco fixo no
  // topo): a mensagem de sucesso/erro (e a faixa "Última ação") agora ficam
  // num bloco `position: sticky` no topo da página (`.catalog-sticky-status`
  // em `app/globals.css`), sempre visível mesmo com a página rolada — não
  // precisa mais forçar um scroll pra mostrar a mensagem, e forçar um scroll
  // num elemento sticky causava saltos estranhos na página (o navegador
  // tenta centralizar um elemento que já está fixo no topo). O motivo
  // original de existir (mensagem de ação numa cor lá embaixo saía da tela)
  // continua resolvido, só que pela posição fixa em vez de rolar a página.
  const newColorFileRef = useRef<File | null>(null);
  // Foto de medidas do produto (13/09/2026, 2ª rodada — ver migração
  // 202609130009): uma só por produto, compartilhada por todas as cores.
  // Mesmo padrão de captura por estado (não por ref/DOM) que corrigiu o
  // "Trocar foto" por cor.
  const positionFileInput = useRef<HTMLInputElement | null>(null);
  const [selectedPositionFile, setSelectedPositionFile] = useState<File | null>(null);
  // "Enviar Óculos da Prova Online" (14/09/2026, pedido do usuário — seção
  // 0.62 do estado consolidado): ADICIONADA como mais uma opção ao lado do
  // "Processar com IA" (não o substitui — ver incidente registrado em 0.63).
  // O master sobe manualmente, por cor, o PNG já pronto (recortado e
  // colorido fora do sistema) que vai ser usado na prova online — mesmo
  // padrão de captura por estado (não por ref/DOM) que corrigiu o "Trocar
  // foto".
  const glassesFileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const [selectedGlassesFile, setSelectedGlassesFile] = useState<Record<string, File | null>>({});

  // Seleção múltipla em "Todas as fotos do anúncio" (14/09/2026, pedido do
  // usuário: "quando for pra remover se a gente pudesse selecionar vários e
  // remover tudo de uma vez, fica mais prático") — junto com o "Remover"
  // individual de cada foto (continua existindo, útil pra tirar só uma).
  const [selectedGalleryIds, setSelectedGalleryIds] = useState<Set<string>>(new Set());
  // Filtro por cor em "Todas as fotos do anúncio" (14/09/2026, pedido do
  // usuário: "tem algum botão pra filtrar as fotos por cor do produto?") —
  // null = mostra todas; senão, mostra só as fotos já marcadas com esta cor.
  // É só um filtro de VISUALIZAÇÃO — não desmarca nem marca nada sozinho.
  const [galleryColorFilter, setGalleryColorFilter] = useState<string | null>(null);
  // Marcação de cor por foto agora é uma PRÉ-SELEÇÃO local (14/09/2026,
  // pedido do usuário: "está lenta a seleção de cores" — antes, cada clique
  // numa bolinha já disparava uma chamada ao servidor e recarregava a tela
  // inteira). Agora o clique só muda este mapa localmente (sem rede
  // nenhuma); nada é salvo de verdade até clicar em "Salvar marcações".
  // Mapa: gallery_image_id -> lista de color_image_id marcados (a versão de
  // TRABALHO, pode divergir do que já está salvo no servidor). Reiniciado
  // (voltando a refletir o servidor) toda vez que uma carga nova do produto
  // termina — ver `applyLoad` abaixo.
  const [pendingGalleryColors, setPendingGalleryColors] = useState<Record<string, string[]>>({});

  // Marcação manual "2 posições" REMOVIDA (15/09/2026 — 3ª rodada, ver
  // estado-consolidado.md seção 0.69): existia porque a detecção automática
  // de "esta foto tem a armação em duas posições" tinha um risco conhecido
  // (IA generativa não-determinística, chamar duas vezes numa foto de UMA
  // posição só podia gerar um "quase duplicado" por engano). O usuário
  // pediu explicitamente pra IA decidir sozinha agora ("a IA deve separar
  // em mais imagens" quando detectar mais de um óculos na foto) — ver
  // `lib/catalog/gallery-photo-crop.ts` (`detectFrameCount`), que faz essa
  // detecção antes de recortar. Não precisa mais de nenhuma marcação do
  // master antes de clicar "Processar com IA".

  // Popup de ampliar foto de exibição (15/09/2026, pedido do usuário: "vai
  // para a coluna da esquerda quando são aprovadas... clicando na foto ela
  // aumenta de tamanho e tem um botão de validar") — mostra a foto grande
  // com Validar/Remover (pendente) ou só Remover (já validada) dentro do
  // popup, em vez de botões pequenos ao lado de cada miniatura.
  const [openDisplayImage, setOpenDisplayImage] = useState<{ colorImageId: string; position: number; url: string | null; validatedAt: string | null } | null>(null);

  // "Ordem de exibição das cores" (15/09/2026, card no final da página —
  // pedido do usuário a partir de um print: arrastar as cores ATIVAS pra
  // definir a ordem no front, com um botão "Salvar" próprio). `null` = sem
  // mudança pendente (a ordem mostrada é derivada direto de `colors`,
  // por `displayOrder`); um array = ordem de trabalho local, só enviada ao
  // servidor quando "Salvar" é clicado (mesmo padrão de pré-seleção local
  // já usado em "Todas as fotos do anúncio", pedido do usuário lá por
  // "está lenta"). Resetado (voltando a refletir o servidor) toda vez que
  // uma carga nova do produto termina — ver `applyLoad`.
  const [colorOrderDraft, setColorOrderDraft] = useState<string[] | null>(null);
  const [draggingColorId, setDraggingColorId] = useState<string | null>(null);
  const [savingColorOrder, setSavingColorOrder] = useState(false);
  useProcessingFeedback(savingColorOrder, 'Salvando ordem das cores…');

  // "Desfazer última ação" (15/09/2026, pedido do usuário depois do
  // incidente de 15/09 — cores sumindo/duplicando sem um jeito fácil de
  // voltar atrás): guarda só a ÚLTIMA ação que mudou algo no banco nesta
  // visita à tela (em memória — um F5 ou sair da página perde essa
  // informação, decisão explícita do usuário: mais simples que precisar de
  // uma tabela de histórico no banco). Cada handler que muda algo chama
  // `setLastAction` no final, com uma função `undo` que sabe desfazer
  // exatamente aquela ação (escrevendo de volta o valor de antes, capturado
  // ANTES da chamada que mudou o dado). Uma ação nova sempre substitui a
  // anterior — só um nível de desfazer, sem histórico/pilha.
  const [lastAction, setLastAction] = useState<{ label: string; undo: () => Promise<void> } | null>(null);
  const [undoing, setUndoing] = useState(false);

  function applyLoad({ ok, payload }: Awaited<ReturnType<typeof fetchJson>>) {
    if (ok) { setProduct(payload.product); setColors(payload.colorImages); setPendingGalleryColors({}); setColorOrderDraft(null); }
    else setMessage({ kind: 'error', text: payload.message || 'Produto não encontrado.' });
  }

  function load() {
    return fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }

  async function handleUndo() {
    if (!lastAction) return;
    setUndoing(true);
    setMessage(null);
    try {
      await lastAction.undo();
      setMessage({ kind: 'success', text: `Desfeito: ${lastAction.label}.` });
      setLastAction(null);
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Não foi possível desfazer${err instanceof Error ? `: ${err.message}` : ''}. Tente de novo.` });
    } finally {
      setUndoing(false);
    }
  }

  // Escreve de volta, numa cor, os campos capturados por `snapshotColor`
  // ANTES da última ação — usada por quase todo `undo` de ação por cor (ver
  // ação `restaurar` em .../images/[colorImageId]/route.ts).
  async function restoreColorSnapshot(colorImageId: string, snapshot: ColorSnapshot) {
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'restaurar', snapshot })
    });
    if (!ok) throw new Error(payload.message || 'Não foi possível desfazer esta cor.');
  }

  // Apaga uma cor recém-criada por engano (undo de "+ Adicionar cor" e de
  // cada cor criada por "Importar do AliExpress") — usa a rota DELETE nova
  // em .../images/[colorImageId]/route.ts, só chamada por aqui.
  async function deleteColorForUndo(colorImageId: string) {
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, { method: 'DELETE' });
    if (!ok) throw new Error(payload.message || 'Não foi possível apagar a cor.');
  }

  // Recria foto(s) apagadas de "Todas as fotos do anúncio" (undo de
  // "Remover"/"Remover selecionadas") — a foto some da tabela ao apagar (sem
  // soft delete), então desfazer precisa recriar a linha do zero (ganha um
  // ID novo) e, se ela tinha marcação de cor, salvar essa marcação de novo
  // depois — a rota de criação em lote (`.../gallery`) não aceita cores
  // junto, só URLs.
  async function restoreDeletedGalleryPhotos(photos: { url: string; colorImageIds: string[] }[]) {
    if (!photos.length) return;
    const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrls: photos.map((p) => p.url) })
    });
    if (!ok) throw new Error(payload.message || 'Não foi possível desfazer.');
    const { ok: loadOk, payload: loadPayload } = await fetchJson(`/api/admin/catalog/products/${productId}`);
    if (!loadOk) throw new Error(loadPayload.message || 'Não foi possível desfazer.');
    const freshPhotos: { id: string; url: string; colorImageIds: string[] }[] = loadPayload.product.galleryPhotos;
    for (const photo of photos) {
      if (!photo.colorImageIds.length) continue;
      const match = freshPhotos.find((p) => p.url === photo.url);
      if (!match) continue;
      const { ok: tagOk, payload: tagPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${match.id}/colors`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ colorImageIds: photo.colorImageIds })
      });
      if (!tagOk) throw new Error(tagPayload.message || 'Não foi possível restaurar a marcação de cores.');
    }
  }

  useEffect(() => {
    fetchJson(`/api/admin/catalog/products/${productId}`).then(applyLoad);
  }, [productId]);

  async function handleSaveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const before = product;
    setBusy(true);
    setMessage(null);
    // try/finally (13/09/2026, 5ª rodada — achado em produção: "clico pra
    // enviar e não acontece nada" no botão de foto de medidas, sem nenhuma
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
      if (ok) {
        if (before) {
          setLastAction({
            label: 'salvar alterações do produto',
            undo: async () => {
              const { ok: undoOk, payload: undoPayload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  modelName: before.modelName,
                  skuOptotica: before.skuOptotica,
                  lensWidthMm: before.lensWidthMm,
                  lensHeightMm: before.lensHeightMm,
                  bridgeMm: before.bridgeMm ?? '',
                  lensDiagonalMm: before.lensDiagonalMm ?? '',
                  templeLengthMm: before.templeLengthMm ?? '',
                  rimMm: before.rimMm ?? '',
                  frameTotalWidthMm: before.frameTotalWidthMm ?? '',
                  standardHeightMm: before.standardHeightMm ?? ''
                })
              });
              if (!undoOk) throw new Error(undoPayload.message);
            }
          });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish(status: 'publicado' | 'arquivado') {
    const before = product;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        if (before) {
          setLastAction({
            label: status === 'publicado' ? 'publicar produto' : 'arquivar produto',
            undo: async () => {
              const { ok: undoOk, payload: undoPayload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: before.status })
              });
              if (!undoOk) throw new Error(undoPayload.message);
            }
          });
        }
        load();
      }
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
      if (ok) {
        event.currentTarget.reset();
        newColorFileRef.current = null;
        setShowNewColor(false);
        if (payload.id) {
          const newColorId = payload.id as string;
          setLastAction({ label: 'adicionar cor', undo: () => deleteColorForUndo(newColorId) });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Aceita um texto opcional (`textOverride`) em vez de sempre ler de
  // `aliexpressImportText` — necessário pra "abrir o painel já pré-
  // preenchido e analisado" (handleOpenAliexpressImport): `setState` é
  // assíncrono, então chamar esta função logo depois de
  // `setAliexpressImportText(json)` leria o valor ANTIGO (vazio) do estado
  // se não houvesse essa saída.
  function handleParseAliexpressImport(textOverride?: string) {
    const text = textOverride ?? aliexpressImportText;
    setImportParseMessage(null);
    try {
      const parsed = parseAliexpressJson(text);

      // Checagem de segurança (14/09/2026, pedido do usuário depois de um
      // incidente real: colou aqui o JSON de um Product ID diferente do
      // deste cadastro, trazendo cores e fotos de OUTRO produto AliExpress
      // pra este). Compara o itemId que veio no JSON com o Product ID já
      // registrado neste produto — só bloqueia quando os dois já estão
      // preenchidos e são diferentes; um produto sem Product ID ainda (por
      // exemplo, cadastrado à mão, sem nunca ter colado um JSON) aceita
      // normalmente, já que aí é a primeira vez que ele é preenchido.
      if (parsed.supplierItemId && product?.supplierItemId && parsed.supplierItemId !== product.supplierItemId) {
        const confirmed = confirm(
          `ATENÇÃO: este JSON é do Product ID ${parsed.supplierItemId} da AliExpress, mas este cadastro é do ` +
          `Product ID ${product.supplierItemId} (${product.modelName}).\n\n` +
          `Colar mesmo assim vai trazer cores e fotos de um produto DIFERENTE pra cá. Tem certeza que quer continuar?`
        );
        if (!confirmed) {
          setImportColors([]);
          setImportGalleryUrls([]);
          setImportParseMessage({
            kind: 'error',
            text: `JSON não aplicado — é do Product ID ${parsed.supplierItemId}, não deste produto (${product.supplierItemId}).`
          });
          return;
        }
      }

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
      const existingBySku = new Map((colors || []).filter((c) => c.supplierSku).map((c) => [c.supplierSku!.trim().toLowerCase(), c.id] as const));
      const existingByPrincipal = new Map((colors || []).filter((c) => !c.colorSecondary && c.colorPrincipal).map((c) => [c.colorPrincipal!.trim().toLowerCase(), c.id] as const));
      const withInclude = parsed.colors.map((c) => {
        const suggested = c.suggestedPrincipalColor || '';
        const matchedBySku = c.supplierSku ? existingBySku.get(c.supplierSku.trim().toLowerCase()) : undefined;
        const matchedByPrincipal = suggested ? existingByPrincipal.get(suggested.trim().toLowerCase()) : undefined;
        const existingColorImageId = matchedBySku || matchedByPrincipal || null;
        const alreadyExists = Boolean(existingColorImageId);
        return { ...c, alreadyExists, include: !alreadyExists, colorPrincipal: suggested, existingColorImageId };
      });
      setImportColors(withInclude);
      setImportGalleryUrls(parsed.galleryImageUrls);
      const existingCount = withInclude.filter((c) => c.alreadyExists).length;
      setImportParseMessage({
        kind: 'success',
        text: `Encontrei ${parsed.colors.length} cor(es)${existingCount ? ` (${existingCount} já cadastrada(s) aqui, desmarcada(s) — dá pra atualizar a foto delas em "Resetar foto(s)" abaixo)` : ''} e ${parsed.galleryImageUrls.length} foto(s) gerais do anúncio.`
      });

      // Lembrar o último JSON usado (14/09/2026): salva em segundo plano,
      // sem bloquear a tela nem mostrar erro se falhar — é só uma
      // conveniência pra da próxima vez já vir preenchido, nunca faz parte
      // do fluxo obrigatório de analisar/importar.
      fetchJson(`/api/admin/catalog/products/${productId}/aliexpress-json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json: text })
      }).catch(() => {});
    } catch (err) {
      setImportColors([]);
      setImportGalleryUrls([]);
      setImportParseMessage({ kind: 'error', text: err instanceof Error ? err.message : 'Não foi possível ler esse JSON.' });
    }
  }

  // Abre (ou fecha) o painel de importar/atualizar. Ao abrir pela primeira
  // vez nesta tela (`hasFetchedLastJson`), busca o último JSON salvo pra
  // este produto e, se encontrar algo, já preenche a caixa E analisa
  // sozinho — pedido do usuário: "seria bom que aparecesse o Json usado
  // pela ultima vez". Se o master já tiver digitado/colado algo na caixa
  // nesta sessão da tela, não sobrescreve nada.
  async function handleOpenAliexpressImport() {
    const next = !showAliexpressImport;
    setShowAliexpressImport(next);
    if (!next || hasFetchedLastJson.current || aliexpressImportText.trim()) return;
    hasFetchedLastJson.current = true;
    setLoadingLastJson(true);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/aliexpress-json`, { method: 'GET' });
      if (ok && typeof payload.json === 'string' && payload.json.trim()) {
        setAliexpressImportText(payload.json);
        handleParseAliexpressImport(payload.json);
      }
    } catch {
      // Silencioso de propósito — só uma conveniência; se falhar, a caixa
      // fica vazia do jeito que já era antes desta funcionalidade existir.
    } finally {
      setLoadingLastJson(false);
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
      // Ids das cores criadas AGORA (15/09/2026, "Desfazer última ação") —
      // pra "Importar N cor(es)" desfazer significa apagar só as que esta
      // chamada criou, nunca cores que já existiam antes.
      const createdIds: string[] = [];
      for (const color of toCreate) {
        const res = await fetchJson(`/api/admin/catalog/products/${productId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colorPrincipal: color.colorPrincipal, supplierColorName: color.supplierColorName || undefined, supplierSku: color.supplierSku || undefined, sourceImageUrl: color.sourceImageUrl || undefined })
        });
        if (res.ok) { successCount += 1; if (res.payload.id) createdIds.push(res.payload.id); }
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
      if (createdIds.length) {
        // Fotos da galeria adicionadas nesta importação NÃO são removidas
        // pelo desfazer (o upsert é idempotente e sem duplicar — não vale a
        // complexidade de rastrear quais eram realmente novas só pra isso) —
        // só as cores criadas agora são apagadas.
        setLastAction({
          label: `importar ${createdIds.length} cor(es)`,
          undo: async () => {
            for (const id of createdIds) await deleteColorForUndo(id);
          }
        });
      }
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // "Resetar foto(s)" (14/09/2026, pedido do usuário): "trocasse todas as
  // fotos do produto, tipo um reset das imagens... inclusive a foto da
  // cor". Diferente de "Importar X cor(es)" acima (que só CRIA cor nova),
  // este botão pega as cores do JSON que já batem com uma cor cadastrada
  // aqui (`existingColorImageId`, calculado em handleParseAliexpressImport)
  // e baixa de novo a foto de referência de cada uma, substituindo a que
  // estava salva — junto com as fotos gerais do anúncio (galeria), que só
  // são conferidas/adicionadas (nunca removidas). Nunca mexe em nome do
  // modelo, medidas ou qualquer outro dado do produto.
  async function handleResetExistingPhotos() {
    const matched = importColors.filter((c) => c.alreadyExists && c.existingColorImageId && c.sourceImageUrl);
    if (!matched.length && !importGalleryUrls.length) {
      setImportParseMessage({ kind: 'error', text: 'Nenhuma cor já cadastrada (com foto de referência) nem foto de galeria encontrada nesse JSON para resetar.' });
      return;
    }
    const confirmed = confirm(
      `Isso vai baixar de novo, direto do AliExpress, a foto de ${matched.length} cor(es) já cadastradas neste produto — substituindo a foto atual de cada uma.\n\n` +
      `Cores que já estavam "Validada" voltam para "Pendente" e precisam ser processadas/validadas de novo (a foto mudou). Descrição e medidas do produto NÃO são alteradas — só as fotos.\n\n` +
      `Tem certeza que quer continuar?`
    );
    if (!confirmed) return;

    // Instantâneo de cada cor afetada ANTES do reset (15/09/2026, "Desfazer
    // última ação") — só assim dá pra voltar `original_image_path`/status/
    // processamento/validação exatamente pro que eram, já que a rota de
    // reset sobrescreve tudo isso.
    const beforeSnapshots = matched
      .map((c) => {
        const found = (colors || []).find((col) => col.id === c.existingColorImageId);
        return found ? { id: found.id, snapshot: snapshotColor(found) } : null;
      })
      .filter((s): s is { id: string; snapshot: ColorSnapshot } => Boolean(s));

    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/reset-photos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          colors: matched.map((c) => ({ colorImageId: c.existingColorImageId, sourceImageUrl: c.sourceImageUrl })),
          galleryImageUrls: importGalleryUrls
        })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        setShowAliexpressImport(false);
        setAliexpressImportText('');
        setImportColors([]);
        setImportGalleryUrls([]);
        setImportParseMessage(null);
        if (beforeSnapshots.length) {
          // Fotos de galeria adicionadas neste reset não são removidas pelo
          // desfazer, mesma razão do "Importar" acima.
          setLastAction({
            label: `resetar foto(s) de ${beforeSnapshots.length} cor(es)`,
            undo: async () => {
              for (const { id, snapshot } of beforeSnapshots) await restoreColorSnapshot(id, snapshot);
            }
          });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Envio manual da foto de medidas do produto (mesmo padrão do "Trocar
  // foto" por cor: try/finally, arquivo lido de estado capturado no
  // onChange). Pedido do usuário (13/09/2026, 6ª rodada): esta seção passa a
  // ser SÓ upload manual — a opção de escolher direto da galeria do anúncio
  // foi removida da tela, já que aquelas fotos vêm cruas (sem recorte) e não
  // servem mais aqui desde a 4ª rodada (a foto de medidas precisa vir
  // recortada). A rota `.../position-photo` continua aceitando `imageUrl`
  // no corpo por compatibilidade, mas não é mais chamada por nenhum botão.
  async function handleUploadProductPosition() {
    const file = selectedPositionFile;
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Salvar foto de medidas".' }); return; }
    // Capturado ANTES da chamada (15/09/2026, "Desfazer última ação").
    // Simplificado na mesma data: esta rota deixou de resetar as cores como
    // efeito colateral (não alimenta mais nenhum processamento — ver
    // estado-consolidado.md seção 0.67), então desfazer só precisa
    // restaurar a foto de medidas em si.
    const beforePositionPath = product?.positionImagePath ?? null;
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
      if (ok) {
        setLastAction({
          label: 'salvar foto de medidas do produto',
          undo: async () => {
            const { ok: posOk, payload: posPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/position-photo`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(beforePositionPath ? { path: beforePositionPath } : { clear: true })
            });
            if (!posOk) throw new Error(posPayload.message);
          }
        });
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedPositionFile(null);
      if (positionFileInput.current) positionFileInput.current.value = '';
    }
  }

  // Reescrito de vez em 15/09/2026 (fim da recolorização — ver
  // estado-consolidado.md seção 0.67): não mexe mais em status/foto tratada
  // da cor, e não apaga mais nada — só ACRESCENTA fotos de exibição novas
  // (a rota devolve `createdIds`, então desfazer é só apagar essas
  // mesmas linhas, sem precisar restaurar snapshot nenhum).
  async function handleNormalizeDisplay(colorImageId: string, position: number, beforeUrl: string | null) {
    if (busy) return;
    setBusy(true);
    setMessage({ kind: 'success', text: 'Padronizando com as referências deste modelo. Aguarde; a original será preservada.' });
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/normalize-display`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ position })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        setLastAction({ label: 'padronizar foto de exibição', undo: async () => {
          const result = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: payload.createdId })
          });
          if (!result.ok) throw new Error(result.payload.message);
        } });
        await load();
        setNormalizationBeforeUrl(beforeUrl);
        setOpenDisplayImage({ colorImageId, position: payload.position, url: null, validatedAt: null });
      }
    } catch { setMessage({ kind: 'error', text: 'Falha de conexão durante a padronização. Atualize as fotos antes de tentar novamente.' }); }
    finally { setBusy(false); }
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
    // sintoma reportado foi "clico em Trocar foto de medidas [um botão sem
    // nenhuma relação] e não acontece nada", sem nenhuma mensagem — porque um
    // botão desabilitado nem chama a função ao ser clicado. Um F5 destravava
    // (recarregava o estado do zero), mas o clique em si nunca fazia nada até
    // isso.
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        const createdIds: string[] = Array.isArray(payload.createdIds) ? payload.createdIds : [];
        if (createdIds.length) {
          setLastAction({
            label: 'processar com IA',
            undo: async () => {
              for (const id of createdIds) {
                const { ok: delOk, payload: delPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id })
                });
                if (!delOk) throw new Error(delPayload.message);
              }
            }
          });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // "Enviar Óculos da Prova Online" (14/09/2026, pedido do usuário — seção
  // 0.62). Desde 15/09/2026 (fim da recolorização por IA — seção 0.67 do
  // estado consolidado) este é o ÚNICO jeito de definir a "Foto de Prova":
  // upload manual, por cor, do PNG já pronto pra prova online (recortado e
  // colorido fora do sistema) — grava em `processed_image_path` ("Foto de
  // Prova"). "Processar com IA" não mexe mais nesse campo, só nas "fotos de
  // exibição" (catálogo de fotos da cor). O nome do arquivo precisa
  // terminar em "<número>mm.png" (ex.:
  // "prova-online-SKU-138mm.png") — esse número é lido AQUI, no
  // navegador, antes do upload (o Storage descarta o nome original do
  // arquivo, só o conteúdo é enviado), e vira a "Frente Total (mm)" do
  // PRODUTO (não desta cor só — é o mesmo campo já usado pela Prova Online
  // pra escalar a armação, ver lib/tryon/geometry.ts) — subir o óculos de
  // qualquer cor deste modelo atualiza essa medida pra todo mundo.
  function parseFrameWidthMmFromFilename(fileName: string): number | null {
    const match = fileName.match(/(\d+(?:[.,]\d+)?)\s*mm\.png$/i);
    if (!match) return null;
    const value = Number(match[1].replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0 || value > 400) return null;
    return value;
  }

  async function handleUploadGlassesPhoto(colorImageId: string) {
    const file = selectedGlassesFile[colorImageId];
    if (!file) { setMessage({ kind: 'error', text: 'Escolha um arquivo antes de clicar em "Enviar Óculos da Prova Online".' }); return; }
    const frameWidthMm = parseFrameWidthMmFromFilename(file.name);
    if (!frameWidthMm) {
      setMessage({ kind: 'error', text: 'O nome do arquivo precisa terminar em "<número>mm.png" (ex.: prova-online-SKU-138mm.png), indicando a Frente Total da armação em mm. Renomeie o arquivo e tente de novo.' });
      return;
    }
    // Capturado ANTES da chamada (15/09/2026, "Desfazer última ação"): esta
    // ação mexe em DUAS coisas — a foto tratada da cor e a Frente Total (mm)
    // do produto inteiro — desfazer precisa devolver as duas.
    const before = (colors || []).find((c) => c.id === colorImageId);
    const beforeFrameTotalWidthMm = product?.frameTotalWidthMm ?? null;
    setBusy(true);
    setMessage(null);
    try {
      const uploaded = await uploadPhoto(productId, file);
      if (!uploaded.ok) { setMessage({ kind: 'error', text: uploaded.message }); return; }
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enviar_oculos', processedImagePath: uploaded.path })
      });
      if (!ok) { setMessage({ kind: 'error', text: payload.message }); return; }
      // Segunda chamada, mesma rota/campo que "Frente Total (mm)" no
      // formulário do produto no topo da página — só reaproveita a validação
      // que já existe lá (OPTIONAL_MEASUREMENTS em .../route.ts).
      const productPatch = await fetchJson(`/api/admin/catalog/products/${productId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frameTotalWidthMm: frameWidthMm })
      });
      setMessage({
        kind: productPatch.ok ? 'success' : 'error',
        text: productPatch.ok
          ? `Óculos enviado — Frente Total atualizada para ${frameWidthMm}mm.`
          : `Óculos enviado, mas não foi possível atualizar a Frente Total (${productPatch.payload.message}).`
      });
      if (before) {
        setLastAction({
          label: 'enviar óculos da prova online',
          undo: async () => {
            await restoreColorSnapshot(colorImageId, snapshotColor(before));
            // A Frente Total só mudou de verdade se a segunda chamada acima
            // deu certo — se ela falhou, não há nada a desfazer nesse campo.
            if (productPatch.ok) {
              const { ok: prodOk, payload: prodPayload } = await fetchJson(`/api/admin/catalog/products/${productId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ frameTotalWidthMm: beforeFrameTotalWidthMm ?? '' })
              });
              if (!prodOk) throw new Error(prodPayload.message);
            }
          }
        });
      }
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
      setSelectedGlassesFile((prev) => ({ ...prev, [colorImageId]: null }));
      const input = glassesFileInputs.current[colorImageId];
      if (input) input.value = '';
    }
  }

  async function handleValidate(colorImageId: string, action: 'validar' | 'rejeitar') {
    let reason: string | undefined;
    if (action === 'rejeitar') {
      reason = window.prompt('Motivo da rejeição:') || '';
      if (!reason) return;
    }
    const before = (colors || []).find((c) => c.id === colorImageId);
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        if (before) {
          setLastAction({
            label: action === 'validar' ? 'validar cor' : 'rejeitar cor',
            undo: () => restoreColorSnapshot(colorImageId, snapshotColor(before))
          });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // ATIVAR/OCULTAR (15/09/2026, pedido do usuário a partir de um print
  // anotado): liga/desliga se esta cor aparece nos fronts do
  // profissional (Etapa 3 "Escolha da armação") e do paciente (prova
  // online) — independente do status de processamento da foto. Suporta
  // "Desfazer última ação" como as demais ações desta tela.
  async function handleSetActive(colorImageId: string, active: boolean) {
    const before = (colors || []).find((c) => c.id === colorImageId);
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: active ? 'ativar' : 'ocultar' })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        if (before) {
          setLastAction({ label: active ? 'ativar cor' : 'ocultar cor', undo: () => restoreColorSnapshot(colorImageId, snapshotColor(before)) });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Apagar uma cor de vez (15/09/2026, botão de lixeira — pedido do
  // usuário): a rota já existia (usada internamente pelo "Desfazer última
  // ação"), agora também fica exposta aqui como ação normal da tela.
  // Irreversível — sem suporte a "Desfazer" (os dados já foram apagados do
  // banco), por isso pede confirmação explícita antes de chamar a rota.
  async function handleDeleteColor(colorImageId: string, label: string) {
    const confirmed = window.confirm(
      `Apagar de vez a cor "${label}"?\n\nIsso remove o cadastro desta cor, as fotos de exibição associadas e as marcações em "Todas as fotos do anúncio". Os arquivos de imagem no Storage NÃO são apagados. Esta ação NÃO pode ser desfeita.`
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}`, { method: 'DELETE' });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) { setLastAction(null); load(); }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // "Ordem de exibição das cores" — arrastar (drag-and-drop nativo do
  // navegador, sem biblioteca) reordena só o estado local (`colorOrderDraft`);
  // nada é salvo até clicar "Salvar" (handleSaveColorOrder).
  function reorderColorDraftTo(activeColorIds: string[], targetId: string) {
    if (!draggingColorId || draggingColorId === targetId) return;
    const base = colorOrderDraft || activeColorIds;
    const from = base.indexOf(draggingColorId);
    const to = base.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...base];
    next.splice(from, 1);
    next.splice(to, 0, draggingColorId);
    setColorOrderDraft(next);
  }

  async function handleSaveColorOrder() {
    if (!colorOrderDraft) return;
    setSavingColorOrder(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedColorImageIds: colorOrderDraft })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      // Em erro, mantém o rascunho local (não descarta o arraste do
      // usuário) pra dar pra clicar "Salvar" de novo sem reordenar tudo de
      // novo na mão; em sucesso, `load()` -> `applyLoad` já reseta o
      // rascunho pra refletir o servidor.
      if (ok) load();
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setSavingColorOrder(false);
    }
  }

  // Remover uma foto de exibição (13/09/2026, migração 202609131200; sem
  // limite de posição desde 15/09/2026 — ver comentário no DELETE da rota).
  // Chamado a partir do popup de ampliar (tanto pendentes quanto já
  // validadas podem ser removidas).
  async function handleRemoveDisplayImage(colorImageId: string, position: number) {
    // Conjunto INTEIRO de fotos de exibição desta cor, capturado ANTES de
    // remover (15/09/2026, "Desfazer última ação") — a rota de restaurar
    // (PUT) substitui tudo, então desfazer precisa mandar de volta o
    // conjunto completo de antes, com a foto removida de novo dentro dele.
    const before = (colors || []).find((c) => c.id === colorImageId);
    const beforeDisplayImages = before
      ? before.displayImages.filter((d) => d.imagePath).map((d) => ({
          position: d.position,
          imagePath: d.imagePath as string,
          validatedAt: d.validatedAt,
          source: d.source,
          sourceGalleryImageId: d.sourceGalleryImageId,
          fromOwnColorPhoto: d.fromOwnColorPhoto
        }))
      : [];
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position })
      });
      setMessage({ kind: ok ? 'success' : 'error', text: payload.message });
      if (ok) {
        setLastAction({
          label: 'remover foto de exibição',
          undo: async () => {
            const { ok: diOk, payload: diPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ images: beforeDisplayImages })
            });
            if (!diOk) throw new Error(diPayload.message);
          }
        });
        setOpenDisplayImage(null);
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Validar uma foto de exibição (13/09/2026, migração 202609131400 — botão
  // "Validar", desde 15/09/2026 dentro do popup de ampliar): ao validar, a
  // foto sai da área de pendentes (seção "Processamento") e passa a
  // aparecer na coluna esquerda ("Outras fotos validadas para o catálogo").
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
      if (ok) {
        setLastAction({
          label: 'validar foto de exibição',
          undo: async () => {
            const { ok: undoOk, payload: undoPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ position, undo: true })
            });
            if (!undoOk) throw new Error(undoPayload.message);
          }
        });
        setOpenDisplayImage(null);
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  // Reordenar manualmente as fotos já validadas (15/09/2026, pedido do
  // usuário: "seria bom cada foto ter um número de prioridade") — troca a
  // posição da foto com a da vizinha (seta pra cima/baixo), usando a ação
  // `moveTo` nova da rota. Sem undo dedicado — trocar de novo (seta
  // contrária) já desfaz.
  async function handleReorderDisplayImage(colorImageId: string, position: number, moveTo: number) {
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/images/${colorImageId}/display-images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ position, moveTo })
      });
      if (!ok) setMessage({ kind: 'error', text: payload.message });
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
  // substitui tudo, não acrescenta uma por vez). Atualizado em 14/09/2026
  // (pedido do usuário: "está lenta a seleção de cores... pode ser uma
  // pré-seleção e depois clica em atualizar?") — o clique agora só muda
  // `pendingGalleryColors` (memória local, sem chamada nenhuma ao servidor);
  // quem manda pro servidor de verdade é `handleSaveGalleryColorTags`, só
  // quando o master clica "Salvar marcações".
  function currentGalleryColorIds(photo: { id: string; colorImageIds: string[] }): string[] {
    return pendingGalleryColors[photo.id] ?? photo.colorImageIds;
  }

  function togglePendingGalleryColor(galleryImageId: string, colorImageId: string, baseIds: string[]) {
    setPendingGalleryColors((prev) => {
      const current = new Set(prev[galleryImageId] ?? baseIds);
      if (current.has(colorImageId)) current.delete(colorImageId);
      else current.add(colorImageId);
      return { ...prev, [galleryImageId]: Array.from(current) };
    });
  }

  // Fotos com marcação diferente do que já está salvo no servidor — é isso
  // que decide se "Salvar marcações"/"Descartar" aparecem, e quantas
  // chamadas `handleSaveGalleryColorTags` precisa fazer.
  const dirtyGalleryPhotos = (product?.galleryPhotos || []).filter((p) => {
    const pending = pendingGalleryColors[p.id];
    if (!pending) return false;
    const a = [...p.colorImageIds].sort().join(',');
    const b = [...pending].sort().join(',');
    return a !== b;
  });

  async function handleSaveGalleryColorTags() {
    if (!dirtyGalleryPhotos.length) return;
    // Marcação ANTIGA de cada foto suja, capturada ANTES de salvar
    // (15/09/2026, "Desfazer última ação") — desfazer manda de volta essa
    // lista completa pra cada foto que foi salva com sucesso.
    const beforeTags = dirtyGalleryPhotos.map((photo) => ({ id: photo.id, colorImageIds: photo.colorImageIds }));
    setBusy(true);
    setMessage(null);
    try {
      let okCount = 0;
      let failCount = 0;
      for (const photo of dirtyGalleryPhotos) {
        const { ok } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${photo.id}/colors`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ colorImageIds: pendingGalleryColors[photo.id] })
        });
        if (ok) okCount += 1;
        else failCount += 1;
      }
      setMessage({ kind: failCount ? 'error' : 'success', text: `Marcação de ${okCount} foto(s) salva.${failCount ? ` ${failCount} falharam — tente de novo.` : ''}` });
      if (okCount) {
        setLastAction({
          label: `salvar marcação de cores de ${okCount} foto(s)`,
          undo: async () => {
            for (const { id, colorImageIds } of beforeTags) {
              const { ok: undoOk, payload: undoPayload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${id}/colors`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ colorImageIds })
              });
              if (!undoOk) throw new Error(undoPayload.message);
            }
          }
        });
      }
      load();
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
    const before = product?.galleryPhotos.find((p) => p.id === galleryImageId);
    setBusy(true);
    setMessage(null);
    try {
      const { ok, payload } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${galleryImageId}`, { method: 'DELETE' });
      if (!ok) setMessage({ kind: 'error', text: payload.message || 'Não foi possível remover esta foto.' });
      if (ok) {
        if (before) {
          setLastAction({ label: 'remover foto da galeria', undo: () => restoreDeletedGalleryPhotos([{ url: before.url, colorImageIds: before.colorImageIds }]) });
        }
        load();
      }
    } catch (err) {
      setMessage({ kind: 'error', text: `Algo deu errado${err instanceof Error ? `: ${err.message}` : ''}. Tente novamente.` });
    } finally {
      setBusy(false);
    }
  }

  function toggleGallerySelection(galleryImageId: string) {
    setSelectedGalleryIds((prev) => {
      const next = new Set(prev);
      if (next.has(galleryImageId)) next.delete(galleryImageId);
      else next.add(galleryImageId);
      return next;
    });
  }

  // Remover em lote (14/09/2026, pedido do usuário) — chama a mesma rota de
  // remoção individual uma vez por foto selecionada, uma de cada vez (só
  // apagar linha no banco, sem chamada de IA nenhuma envolvida — não tem o
  // limite de "uma por vez" do Replicate aqui, mas sequencial evita
  // qualquer corrida entre remoções).
  async function handleRemoveSelectedGalleryPhotos() {
    const ids = Array.from(selectedGalleryIds);
    if (!ids.length) return;
    if (!confirm(`Remover ${ids.length} foto(s) selecionada(s) da galeria deste produto? Isso não pode ser desfeito.`)) return;
    const beforePhotos = (product?.galleryPhotos || [])
      .filter((p) => selectedGalleryIds.has(p.id))
      .map((p) => ({ url: p.url, colorImageIds: p.colorImageIds }));
    setBusy(true);
    setMessage(null);
    try {
      let removed = 0;
      let failed = 0;
      for (const id of ids) {
        const { ok } = await fetchJson(`/api/admin/catalog/products/${productId}/gallery/${id}`, { method: 'DELETE' });
        if (ok) removed += 1;
        else failed += 1;
      }
      setMessage({ kind: failed ? 'error' : 'success', text: `${removed} foto(s) removida(s).${failed ? ` ${failed} falharam — tente de novo.` : ''}` });
      if (removed) {
        setLastAction({ label: `remover ${removed} foto(s) da galeria`, undo: () => restoreDeletedGalleryPhotos(beforePhotos) });
      }
      setSelectedGalleryIds(new Set());
      load();
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

      {/* "Desfazer última ação" + mensagem de resultado (15/09/2026, pedido
          do usuário depois do incidente de cores sumindo/duplicando; ficou
          FIXO no topo em 15/09/2026 — 2ª rodada, depois do usuário mandar
          print mostrando que precisava rolar a página pra cima toda vez pra
          ver o resultado de uma ação feita lá embaixo, num card de cor):
          este bloco vira `position: sticky` a partir daqui, então continua
          visível mesmo com a página rolada — mesmo padrão já usado no
          `.flow-wrap` da tela de atendimento. `lastAction` só aparece
          quando há algo pra desfazer nesta visita à página (some depois de
          usado, depois de qualquer F5/saída da página — é só em memória —,
          ou assim que outra ação nova acontecer, substituindo a anterior,
          um nível só). */}
      {(lastAction || message) && (
        <div className="catalog-sticky-status">
          {lastAction && (
            <div className="card" style={{ padding: '10px 16px', marginBottom: message ? 8 : 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, background: '#fff8e6' }}>
              <span>Última ação: <strong>{lastAction.label}</strong></span>
              <button className="button secondary" type="button" disabled={busy || undoing} onClick={handleUndo}>
                {undoing ? 'Desfazendo…' : 'Desfazer última ação'}
              </button>
            </div>
          )}
          {message && <p ref={messageRef} className={`form-message ${message.kind}`} style={{ margin: 0 }}>{message.text}</p>}
        </div>
      )}

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

      {/* Foto de medidas do produto (13/09/2026, 2ª rodada — depois mudou de
          sentido na 4ª rodada). SEM USO FUNCIONAL desde 15/09/2026 (fim da
          recolorização por IA — ver estado-consolidado.md seção 0.67): esta
          foto só alimentava aquele passo (dar a forma/pose pra IA recolorir
          por cima). O usuário pediu explicitamente pra MANTER esta seção na
          tela mesmo assim (pode voltar a servir pra algo no futuro) — só o
          texto de ajuda abaixo foi ajustado pra não afirmar algo que não é
          mais verdade; upload/armazenamento continuam idênticos. */}
      <div className="card catalog-position-card">
        <div className="preview">
          {product.positionImageUrl ? <img src={product.positionImageUrl} alt="Foto de medidas do produto" /> : 'sem foto de medidas'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span className="section-label">Foto de medidas do modelo</span>
          <span className="helper">Exibida enquanto a prova online é gerada e ao passar o mouse ou tocar na foto de prova, nos painéis profissional e do paciente.</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            ref={positionFileInput}
            onChange={(e) => setSelectedPositionFile(e.target.files?.[0] || null)}
          />
          {selectedPositionFile ? (
            <span className="helper">Arquivo selecionado: {selectedPositionFile.name}</span>
          ) : (
            <span className="helper">Envie uma imagem com as medidas do modelo (PNG, JPG ou WebP).</span>
          )}
          <button className="button secondary small" type="button" disabled={busy} style={{ justifySelf: 'start' }} onClick={handleUploadProductPosition}>
            Salvar foto de medidas
          </button>
        </div>
      </div>

      <section className="card" style={{ padding: 20 }} aria-label="Padronização das fotos do modelo">
        <h3>Padrão visual deste modelo</h3>
        <p className="helper">A IA usa fotos validadas deste modelo como referência, separando frente, lateral e perspectiva. Cada grupo mantém enquadramento e escala consistentes entre as cores, com fundo branco e margem de segurança.</p>
        <p className="helper">{colors?.reduce((sum, color) => sum + color.displayImages.filter((photo) => photo.validatedAt).length, 0) || 0} fotos validadas · {colors?.reduce((sum, color) => sum + color.displayImages.filter((photo) => !photo.validatedAt).length, 0) || 0} aguardando conferência</p>
        <p className="helper">Para corrigir uma foto antiga, abra a imagem e clique em “Padronizar com IA”. Compare a nova versão antes de validar. Se não houver referência do mesmo ângulo, é aplicado apenas o padrão geral de fundo, margens e tamanho.</p>
      </section>

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
            Clique nas bolinhas de cor abaixo de cada foto para marcar/desmarcar — é só uma pré-seleção,
            ainda não salva nada. Clique em &quot;Salvar marcações&quot; quando terminar. Ao processar uma cor
            com IA, ela recorta só as fotos marcadas (e já salvas) para aquela cor.
          </p>
          {/* Salvar/descartar a pré-seleção (14/09/2026, pedido do usuário:
              "está lenta a seleção de cores... pode ser uma pré-seleção e
              depois clica em atualizar?") — antes, cada clique numa bolinha
              já ia pro servidor e recarregava a tela inteira; agora só muda
              localmente até clicar aqui. */}
          {dirtyGalleryPhotos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '8px 10px', background: '#fff8e1', borderRadius: 6 }}>
              <span className="helper" style={{ margin: 0 }}>
                {dirtyGalleryPhotos.length} foto(s) com marcação ainda não salva.
              </span>
              <button type="button" className="button primary small" disabled={busy} onClick={handleSaveGalleryColorTags}>
                Salvar marcações ({dirtyGalleryPhotos.length})
              </button>
              <button type="button" className="button secondary small" disabled={busy} onClick={() => setPendingGalleryColors({})}>
                Descartar
              </button>
            </div>
          )}
          {/* Filtro por cor (14/09/2026, pedido do usuário: "tem algum botão
              pra filtrar as fotos por cor do produto?") — clica numa cor pra
              ver só as fotos já marcadas com ela (útil quando tem muita foto
              e quer conferir/terminar a marcação de uma cor por vez); clica
              de novo (ou em "Todas") pra voltar a ver tudo. Só filtra o que
              aparece na tela, não muda marcação nenhuma. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span className="helper" style={{ marginRight: 2 }}>Filtrar por cor:</span>
            <button
              type="button"
              onClick={() => setGalleryColorFilter(null)}
              style={{
                fontSize: 11,
                padding: '4px 10px',
                borderRadius: 999,
                border: `2px solid ${galleryColorFilter === null ? '#222' : '#ccc'}`,
                background: '#fff',
                fontWeight: galleryColorFilter === null ? 700 : 400,
                cursor: 'pointer'
              }}
            >
              Todas ({product.galleryPhotos.length})
            </button>
            {colors.map((color) => {
              const count = product.galleryPhotos.filter((p) => currentGalleryColorIds(p).includes(color.id)).length;
              const active = galleryColorFilter === color.id;
              const label = color.colorVariantNumber ? `C${color.colorVariantNumber}` : (color.colorName || '?').slice(0, 2);
              const isLight = colorSwatchIsLight(color.colorPrincipal);
              return (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => setGalleryColorFilter(active ? null : color.id)}
                  title={`Mostrar só as fotos marcadas com ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}`}
                  style={{
                    fontSize: 11,
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: active ? '2px solid #222' : `1px solid ${colorSwatchSolidHex(color.colorPrincipal)}`,
                    background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary),
                    color: isLight ? '#222' : '#fff',
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  {label} ({count})
                </button>
              );
            })}
          </div>
          {/* Remoção em lote (14/09/2026, pedido do usuário: "selecionar vários
              e remover tudo de uma vez") — marca a caixinha de cada foto que
              não serve (banner, foto de outro modelo) e remove todas juntas;
              o "Remover" de cada foto continua existindo, pra tirar só uma. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button
              type="button"
              className="button secondary small"
              disabled={busy || !selectedGalleryIds.size}
              onClick={handleRemoveSelectedGalleryPhotos}
            >
              Remover selecionadas ({selectedGalleryIds.size})
            </button>
            {selectedGalleryIds.size > 0 && (
              <button type="button" className="button secondary small" disabled={busy} onClick={() => setSelectedGalleryIds(new Set())}>
                Limpar seleção
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {(galleryColorFilter ? product.galleryPhotos.filter((p) => currentGalleryColorIds(p).includes(galleryColorFilter)) : product.galleryPhotos).map((photo) => {
              const selected = selectedGalleryIds.has(photo.id);
              return (
              <div key={photo.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 108 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                  <input type="checkbox" checked={selected} disabled={busy} onChange={() => toggleGallerySelection(photo.id)} />
                  selecionar
                </label>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Foto do anúncio" style={{ width: 100, height: 100, objectFit: 'cover', borderRadius: 4, outline: selected ? '3px solid #0af' : 'none' }} />
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
                    const marked = currentGalleryColorIds(photo).includes(color.id);
                    const label = color.colorVariantNumber ? `C${color.colorVariantNumber}` : (color.colorName || '?').slice(0, 2);
                    const title = color.colorVariantNumber
                      ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}`
                      : color.colorName;
                    // Bolinha colorida de acordo com a cor de verdade da variante
                    // (pedido do usuário, 13/09/2026: "colorir cada checkbox de
                    // cor de acordo com a cor correspondente"). Atualizado em
                    // 14/09/2026 (pedido do usuário: "as bolinhas de cores serem
                    // preenchidas com a cor e escrever o código da cor em branco
                    // dentro, ficaria mais fácil de visualizar") — agora SEMPRE
                    // preenchida com a cor de verdade (bicolor vira meio a meio),
                    // marcada ou não, pra dar pra ver a cor de cada uma batendo o
                    // olho. O texto ("C1" etc.) é branco ou escuro dependendo de a
                    // cor ser clara ou não (nunca sempre branco — em "Branco"/
                    // "Cristal" o texto branco ficaria ilegível). O que distingue
                    // marcada de desmarcada agora é a borda (grossa e escura
                    // quando marcada) e o "✓".
                    const solidHex = colorSwatchSolidHex(color.colorPrincipal);
                    const isLight = colorSwatchIsLight(color.colorPrincipal);
                    return (
                      <button
                        key={color.id}
                        type="button"
                        disabled={busy}
                        title={title}
                        onClick={() => togglePendingGalleryColor(photo.id, color.id, photo.colorImageIds)}
                        style={{
                          fontSize: 10,
                          lineHeight: 1,
                          padding: '4px 6px',
                          borderRadius: 999,
                          border: marked ? '2px solid #222' : `1px solid ${solidHex}`,
                          background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary),
                          color: isLight ? '#222' : '#fff',
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
              );
            })}
          </div>
        </div>
      )}

      <div className="catalog-toolbar">
        <h2 style={{ margin: 0, fontSize: 18 }}>Cores e fotos de prova</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" type="button" onClick={handleOpenAliexpressImport}>Importar/atualizar do AliExpress</button>
          <button className="button secondary" type="button" onClick={() => setShowNewColor((v) => !v)}>+ Adicionar cor</button>
        </div>
      </div>

      {showAliexpressImport && (
        <div className="card" style={{ padding: 16, marginBottom: 16, display: 'grid', gap: 12 }}>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ fontSize: 13, fontWeight: 600 }}>Colar JSON do AliExpress</label>
            <p className="helper" style={{ margin: 0 }}>
              Cole a resposta da API &quot;Item Detail&quot; deste produto — cria as cores que ainda não existem aqui
              (com a foto de referência já associada) e adiciona as fotos gerais na galeria. &quot;Importar&quot; nunca
              mexe no que já está cadastrado; para cores que já existem, use &quot;Resetar foto(s)&quot; abaixo, que baixa
              a foto de novo da fonte (inclusive a foto da própria cor) sem alterar descrição/medidas do produto.
              {loadingLastJson
                ? ' Buscando o último JSON usado neste produto...'
                : ' O último JSON analisado com sucesso aqui fica salvo e já vem preenchido da próxima vez que este painel é aberto.'}
            </p>
            <textarea
              rows={4}
              value={aliexpressImportText}
              onChange={(e) => setAliexpressImportText(e.target.value)}
              placeholder='Cole aqui o JSON, ex.: {"result":{"item":{...}}}'
              style={{ fontFamily: 'monospace', fontSize: 12 }}
            />
            <div>
              <button className="button secondary small" type="button" onClick={() => handleParseAliexpressImport()} disabled={!aliexpressImportText.trim()}>
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
                  <span className="muted" style={{ fontSize: 11 }}>{color.alreadyExists ? 'já cadastrada aqui — foto pode ser atualizada em "Resetar foto(s)"' : color.supplierSku || 'sem SKU do fornecedor'}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(importColors.length > 0 || importGalleryUrls.length > 0) && (
              <button className="button primary" type="button" disabled={busy} onClick={handleImportAliexpress}>
                Importar {importColors.filter((c) => c.include).length} cor(es) e {importGalleryUrls.length} foto(s) da galeria
              </button>
            )}
            {(importColors.some((c) => c.alreadyExists && c.existingColorImageId && c.sourceImageUrl) || importGalleryUrls.length > 0) && (
              <button className="button secondary" type="button" disabled={busy} onClick={handleResetExistingPhotos}>
                Resetar foto(s) de {importColors.filter((c) => c.alreadyExists && c.existingColorImageId && c.sourceImageUrl).length} cor(es) já cadastradas
              </button>
            )}
          </div>
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
          {colors.map((color) => {
            // Layout em duas colunas (15/09/2026, pedido do usuário com
            // print anexado): coluna esquerda só com fotos (sem nenhum botão
            // de ação), coluna direita com todos os controles. As fotos de
            // exibição já validadas viram o "catálogo" desta cor na coluna
            // esquerda (reordenável); as ainda não validadas ficam pendentes
            // na seção "Processamento", à direita, esperando o master abrir
            // o popup e clicar "Validar" ou "Remover".
            const validatedImages = [...color.displayImages].filter((d) => d.validatedAt).sort((a, b) => a.position - b.position);
            const pendingImages = [...color.displayImages].filter((d) => !d.validatedAt).sort((a, b) => a.position - b.position);
            const taggedPhotos = product.galleryPhotos.filter((p) => p.colorImageIds.includes(color.id));
            // "Foto da cor" virou OBRIGATÓRIA pra processar (15/09/2026, 4ª
            // rodada — ver estado-consolidado.md seção 0.70): é ela que a IA
            // usa como referência visual pra identificar a cor certa em cada
            // foto candidata. Sem ela, não tem o que processar, mesmo com
            // fotos marcadas em "Todas as fotos do anúncio".
            const ownPhotoAlreadyProcessed = color.displayImages.some((d) => d.fromOwnColorPhoto);
            const hasProcessCandidates = Boolean(color.originalImageUrl) && (taggedPhotos.length > 0 || !ownPhotoAlreadyProcessed);
            return (
            <div key={color.id} className="catalog-color-card">
              <div className="catalog-color-photos" style={{ flexDirection: 'column' }}>
                <div className="half">
                  <span className="catalog-photo-label">Foto da cor</span>
                  {color.originalImageUrl ? <img src={color.originalImageUrl} alt="Foto da cor" /> : 'sem foto'}
                </div>
                <div className="half">
                  <span className="catalog-photo-label">Foto de Prova</span>
                  {color.processedImageUrl ? <img src={color.processedImageUrl} alt="Foto de Prova" /> : 'nenhuma ainda'}
                </div>
                <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="section-label" style={{ fontSize: 10 }}>Outras fotos validadas para o catálogo ({validatedImages.length})</span>
                  {validatedImages.length ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      {validatedImages.map((img, idx) => (
                        <div key={img.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <button
                            type="button"
                            style={{ padding: 0, border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', background: 'none' }}
                            onClick={() => { setNormalizationBeforeUrl(null); setOpenDisplayImage({ colorImageId: color.id, position: img.position, url: img.url, validatedAt: img.validatedAt }); }}
                            title={`${idx + 1}ª foto do catálogo — clique para ampliar`}
                          >
                            {img.url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={img.url} alt={`Foto ${idx + 1} do catálogo`} style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <span style={{ width: '100%', aspectRatio: '1 / 1', display: 'block', background: 'var(--soft)' }} />
                            )}
                          </button>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <button type="button" className="text-button" style={{ fontSize: 11 }} disabled={busy || idx === 0} onClick={() => handleReorderDisplayImage(color.id, img.position, validatedImages[idx - 1].position)} title="Subir prioridade">▲</button>
                            <span className="muted" style={{ fontSize: 10 }}>{idx + 1}º</span>
                            <button type="button" className="text-button" style={{ fontSize: 11 }} disabled={busy || idx === validatedImages.length - 1} onClick={() => handleReorderDisplayImage(color.id, img.position, validatedImages[idx + 1].position)} title="Descer prioridade">▼</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="helper" style={{ fontSize: 11 }}>Nenhuma ainda — valide fotos processadas na seção &quot;Processamento&quot; ao lado.</span>
                  )}
                </div>
              </div>
              <div className="catalog-color-body">
                <div className="catalog-color-toolbar">
                  <div className="name">
                    <span className="catalog-swatch" style={{ background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary) }} />
                    {color.colorVariantNumber ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}${color.colorNote ? ` (${color.colorNote})` : ''}` : color.colorName}
                  </div>
                  <div className="catalog-color-toolbar-actions">
                    <button type="button" className="button danger small" disabled={busy || color.isActive} onClick={() => handleSetActive(color.id, true)} title="Deixar esta cor apta a aparecer nos fronts do profissional e do paciente">ATIVAR</button>
                    <button type="button" className="button danger small" disabled={busy || !color.isActive} onClick={() => handleSetActive(color.id, false)} title="Manter o cadastro, sem aparecer em nenhum front">OCULTAR</button>
                    <button type="button" className="icon-button danger" disabled={busy} onClick={() => handleDeleteColor(color.id, color.colorVariantNumber ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}` : color.colorName)} title="Apagar de vez o cadastro desta cor">🗑</button>
                  </div>
                </div>
                <CatalogColorPicker productId={productId} colorId={color.id} currentNumber={color.colorVariantNumber}
                  usedNumbers={(colors || []).flatMap((entry) => entry.colorVariantNumber === null ? [] : [entry.colorVariantNumber])}
                  busy={busy} onBusy={setBusy} onSaved={async () => { setLastAction(null); await load(); }} />
                {color.variantSku && <span className="muted" style={{ fontSize: 11 }}>SKU {color.variantSku}</span>}
                {color.supplierColorName && <span className="muted" style={{ fontSize: 11 }}>Cor original do fornecedor: {color.supplierColorName}</span>}
                {color.supplierSku && <span className="muted" style={{ fontSize: 11 }}>SKU do fornecedor {color.supplierSku}</span>}
                <span className={`catalog-badge ${color.status}`}>{COLOR_STATUS_LABEL[color.status] || color.status}</span>
                <span className={`catalog-badge ${color.isActive ? 'validada' : 'rejeitada'}`}>{color.isActive ? 'Ativa — aparece nos fronts' : 'Oculta — não aparece em nenhum front'}</span>
                {color.rejectionReason && <span className="helper">Motivo: {color.rejectionReason}</span>}

                {color.status !== 'incompleto' && (
                  <div className="catalog-color-section">
                    <span className="section-label">Processamento</span>
                    {color.status === 'validada' && (
                      <span className="helper">Esta cor já está validada. Você ainda pode processar de novo, enviar um óculos manualmente, trocar a foto marcada ou rejeitar — o painel continua editável mesmo depois de validar.</span>
                    )}
                    {!color.originalImageUrl && (
                      <span className="helper">Falta a foto de referência desta cor. Envie a foto ao cadastrar a cor ou atualize as fotos pela importação do produto.</span>
                    )}
                    {color.originalImageUrl && !taggedPhotos.length && ownPhotoAlreadyProcessed && (
                      <span className="helper">Nenhuma foto nova pra processar — marque mais fotos para esta cor em &quot;Todas as fotos do anúncio&quot;.</span>
                    )}
                    {/* Marcação manual "2 posições" REMOVIDA (15/09/2026 —
                        3ª rodada, ver estado-consolidado.md seção 0.69): a
                        IA agora detecta sozinha se uma foto mostra mais de
                        um óculos e separa em mais de uma foto de resultado
                        — nenhuma marcação do master é necessária antes de
                        clicar "Processar com IA" (ver detectFrameCount em
                        lib/catalog/gallery-photo-crop.ts). */}
                    {taggedPhotos.length > 0 && (
                      <span className="helper">{taggedPhotos.length} foto(s) marcada(s) para esta cor em &quot;Todas as fotos do anúncio&quot; serão processadas.</span>
                    )}
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className="button secondary small" type="button" disabled={busy || !hasProcessCandidates} onClick={() => handleProcess(color.id)}>
                        {color.displayImages.length > 0 ? 'Processar novamente' : 'Processar com IA'}
                      </button>
                      <button className="button primary small" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'validar')}>{color.status === 'validada' ? 'Validar novamente' : 'Validar'}</button>
                      <button className="text-button danger" type="button" disabled={busy} onClick={() => handleValidate(color.id, 'rejeitar')}>Rejeitar</button>
                    </div>

                    {pendingImages.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span className="helper">{pendingImages.length} foto(s) processada(s), aguardando validação — clique pra ampliar:</span>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {pendingImages.map((img) => (
                            <button
                              key={img.id}
                              type="button"
                              style={{ padding: 0, border: '1px solid var(--line)', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', background: 'none', width: 64, height: 64 }}
                              onClick={() => { setNormalizationBeforeUrl(null); setOpenDisplayImage({ colorImageId: color.id, position: img.position, url: img.url, validatedAt: img.validatedAt }); }}
                              title="Clique para ampliar e validar"
                            >
                              {img.url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={img.url} alt="Pendente de validação" style={{ width: 64, height: 64, objectFit: 'cover', display: 'block' }} />
                              ) : (
                                <span style={{ width: 64, height: 64, display: 'block' }} />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* "Enviar Óculos da Prova Online" (14/09/2026, pedido do
                        usuário — seção 0.62). Desde 15/09/2026 (fim da
                        recolorização — seção 0.67 do estado consolidado) é o
                        ÚNICO jeito de definir a "Foto de Prova": o master
                        sobe aqui o PNG já pronto (recortado e colorido fora
                        do sistema), que grava em `processed_image_path`. O
                        nome do arquivo precisa terminar em "<número>mm.png"
                        (ex.: "prova-online-SKU-138mm.png") — esse número vira
                        a "Frente Total (mm)" do produto (campo do formulário
                        no topo da página, usado por lib/tryon/geometry.ts pra
                        escalar a armação na Prova Online). */}
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #eee', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span className="helper" style={{ fontWeight: 600 }}>Enviar manualmente o óculos já pronto (Foto de Prova):</span>
                      <span className="helper">Envie o PNG já pronto (recortado e colorido fora do sistema) — o nome do arquivo precisa terminar em &quot;&lt;número&gt;mm.png&quot; (ex.: prova-online-SKU-138mm.png), indicando a Frente Total da armação em mm.</span>
                      <input
                        type="file"
                        accept="image/png"
                        ref={(el) => { glassesFileInputs.current[color.id] = el; }}
                        onChange={(e) => setSelectedGlassesFile((prev) => ({ ...prev, [color.id]: e.target.files?.[0] || null }))}
                      />
                      {selectedGlassesFile[color.id] ? (
                        <span className="helper">Arquivo selecionado: {selectedGlassesFile[color.id]!.name}</span>
                      ) : (
                        <span className="helper">Nenhum arquivo selecionado ainda</span>
                      )}
                      <button className="button secondary small" type="button" disabled={busy} style={{ justifySelf: 'start' }} onClick={() => handleUploadGlassesPhoto(color.id)}>
                        Enviar Óculos da Prova Online
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <div className="catalog-empty">Nenhuma cor cadastrada ainda.</div>
      )}

      {/* "Ordem de exibição das cores" (15/09/2026, card no final da página
          — pedido do usuário): só cores ATIVAS entram aqui (cores ocultas
          não têm ordem de exibição relevante, já que não aparecem em
          nenhum front). Arrastar reordena localmente; "Salvar" grava. */}
      {(() => {
        const activeColorsSorted = (colors || [])
          .filter((c) => c.isActive)
          .sort((a, b) => {
            const ao = a.displayOrder ?? Number.MAX_SAFE_INTEGER;
            const bo = b.displayOrder ?? Number.MAX_SAFE_INTEGER;
            if (ao !== bo) return ao - bo;
            return (a.colorVariantNumber ?? 0) - (b.colorVariantNumber ?? 0);
          });
        const activeColorIds = activeColorsSorted.map((c) => c.id);
        const orderedIds = colorOrderDraft || activeColorIds;
        const orderedColors = orderedIds
          .map((id) => activeColorsSorted.find((c) => c.id === id))
          .filter((c): c is ColorImage => Boolean(c));
        const hasPendingOrder = Boolean(colorOrderDraft) && JSON.stringify(colorOrderDraft) !== JSON.stringify(activeColorIds);

        return (
          <section className="catalog-color-order-card">
            <h3>Ordem de exibição das cores</h3>
            {orderedColors.length ? (
              <>
                <p className="helper">Arraste uma cor pra esquerda ou direita pra definir a ordem em que ela aparece nos fronts do profissional e do paciente. Só cores ATIVAS aparecem aqui.</p>
                <div className="catalog-color-order-row">
                  {orderedColors.map((color) => {
                    const label = color.colorVariantNumber ? `C${color.colorVariantNumber}` : (color.colorName || '?').slice(0, 2);
                    return (
                      <button
                        key={color.id}
                        type="button"
                        draggable
                        className={`catalog-color-order-chip${draggingColorId === color.id ? ' is-dragging' : ''}`}
                        style={{ background: colorSwatchBackground(color.colorPrincipal, color.colorSecondary) }}
                        title={color.colorVariantNumber ? `Cor ${color.colorVariantNumber} — ${color.colorPrincipal}${color.colorSecondary ? ` / ${color.colorSecondary}` : ''}` : color.colorName}
                        onDragStart={() => setDraggingColorId(color.id)}
                        onDragEnd={() => setDraggingColorId(null)}
                        onDragOver={(e) => { e.preventDefault(); reorderColorDraftTo(activeColorIds, color.id); }}
                      >
                        <span className={colorSwatchIsLight(color.colorPrincipal) ? 'dark-label' : 'light-label'}>{label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="actions">
                  <button type="button" className="button primary" disabled={!hasPendingOrder || savingColorOrder} onClick={handleSaveColorOrder}>
                    {savingColorOrder ? 'Salvando…' : 'Salvar ordem de exibição'}
                  </button>
                  {hasPendingOrder && !savingColorOrder && <span className="helper">Ordem alterada — clique em Salvar pra valer no front.</span>}
                </div>
              </>
            ) : (
              <p className="helper">Nenhuma cor ativa ainda — clique ATIVAR numa cor acima pra ela aparecer aqui.</p>
            )}
          </section>
        );
      })()}

      {/* Popup de ampliar foto de exibição (15/09/2026) — abre tanto pra
          fotos pendentes (Validar + Remover) quanto já validadas (só
          Remover, já que "Validar" de novo não faz sentido). */}
      {openDisplayImage && (() => {
        const color = colors?.find((c) => c.id === openDisplayImage.colorImageId);
        const img = color?.displayImages.find((d) => d.position === openDisplayImage.position);
        if (!color || !img) return null;
        return (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => setOpenDisplayImage(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}
          >
            <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 16, maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              {normalizationBeforeUrl && <figure style={{ margin: 0 }}><figcaption>Original preservada</figcaption><img src={normalizationBeforeUrl} alt="Foto original antes da padronização" style={{ maxWidth: '75vw', maxHeight: '25vh', objectFit: 'contain' }} /></figure>}
              {img.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={img.url} alt="Foto de exibição ampliada" style={{ maxWidth: '85vw', maxHeight: normalizationBeforeUrl ? '35vh' : '70vh', objectFit: 'contain' }} />
              ) : (
                <span className="helper">sem foto</span>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="button secondary" type="button" disabled={busy} onClick={() => handleNormalizeDisplay(color.id, img.position, img.url)}>{busy ? 'Processando…' : 'Padronizar com IA'}</button>
                {!img.validatedAt && (
                  <button className="button primary" type="button" disabled={busy} onClick={() => handleValidateDisplayImage(color.id, img.position)}>Validar</button>
                )}
                <button className="text-button danger" type="button" disabled={busy} onClick={() => handleRemoveDisplayImage(color.id, img.position)}>Remover</button>
                <button className="button secondary" type="button" onClick={() => setOpenDisplayImage(null)}>Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
