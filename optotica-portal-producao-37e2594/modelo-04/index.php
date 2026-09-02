<?php require_once dirname(__DIR__) . '/optotica-core/auth.php'; optotica_require_any_login(); ?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<title>Optótica — Modelo 04</title>
<style>
:root{
  --bg:#f3f3f0;
  --paper:#fff;
  --ink:#111;
  --muted:#73736d;
  --line:#deded8;
  --soft:#ecece7;
  --ok:#2f7b4b;
  --danger:#9a3636;
  --radius:24px;
  --shadow:0 18px 65px rgba(18,18,16,.07);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0;
  background:var(--bg);
  color:var(--ink);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
button{font:inherit}
button:focus-visible{outline:3px solid rgba(17,17,17,.22);outline-offset:3px}
button:disabled{cursor:not-allowed}
.shell{width:min(1440px,100%);margin:auto;padding:0 28px 64px}
header{
  height:76px;
  border-bottom:1px solid var(--line);
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.brand{font-size:27px;font-weight:780;letter-spacing:-.06em}
.header-actions{display:flex;align-items:center;gap:24px;font-size:13px;color:#53534f}.header-actions a{color:inherit;text-decoration:none}.header-actions a:hover{color:#111}
.header-actions span:last-child{color:var(--ink)}
.crumb{padding:20px 0 18px;font-size:11px;color:var(--muted)}
.product{
  display:grid;
  grid-template-columns:minmax(0,1.12fr) minmax(390px,.88fr);
  gap:32px;
  align-items:start;
}
.gallery{position:sticky;top:18px}
.hero{
  height:min(72vh,730px);
  min-height:560px;
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:var(--radius);
  overflow:hidden;
  position:relative;
  display:grid;
  place-items:center;
  box-shadow:var(--shadow);
}
.hero img{
  display:block;
  width:100%;height:100%;
  object-fit:contain;
  padding:34px;
  transition:opacity .18s ease;
}
.hero .counter{
  position:absolute;right:16px;bottom:15px;
  background:rgba(255,255,255,.86);
  backdrop-filter:blur(8px);
  border:1px solid var(--line);
  border-radius:999px;
  padding:7px 10px;
  font-size:10px;
  color:var(--muted);
}
.gallery-strip{
  margin-top:12px;
  display:grid;
  grid-template-columns:repeat(6,1fr);
  gap:9px;
}
.gallery-thumb{
  border:1px solid var(--line);
  border-radius:14px;
  overflow:hidden;
  padding:0;
  background:var(--paper);
  cursor:pointer;
  aspect-ratio:1.18;
}
.gallery-thumb.active{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.gallery-thumb img{width:100%;height:100%;display:block;object-fit:cover}
.card{
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:32px;
  box-shadow:var(--shadow);
}
.kicker{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:11px}
h1{font-size:46px;letter-spacing:-.06em;line-height:.98;margin:0}
.kind{font-size:14px;color:var(--muted);margin:10px 0 0}
.product-code{font-size:11px;color:var(--muted);margin:8px 0 0;letter-spacing:.035em}
.availability{
  margin:24px 0 0;
  padding:16px 0;
  border-top:1px solid var(--line);
  border-bottom:1px solid var(--line);
  display:flex;
  gap:9px;
  align-items:center;
  font-size:13px;
}
.dot{width:9px;height:9px;border-radius:50%;background:var(--ok);flex:0 0 auto}
.dot.off{background:var(--danger)}
.availability small{margin-left:auto;color:var(--muted);font-size:10px}
.section{margin-top:27px}
.section-title{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:12px}
.section-title h2{font-size:14px;margin:0;letter-spacing:-.015em}
.section-title span{font-size:11px;color:var(--muted)}
.variants{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}
.variant{
  padding:7px;
  border:1px solid var(--line);
  background:var(--paper);
  border-radius:15px;
  cursor:pointer;
  text-align:left;
}
.variant.selected{border-color:var(--ink);box-shadow:inset 0 0 0 1px var(--ink)}
.variant img{width:100%;aspect-ratio:1.25;object-fit:cover;display:block;border-radius:10px;background:#f5f5f2}
.variant span{display:block;font-size:11px;margin:7px 4px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tryon{
  width:100%;
  min-height:61px;
  margin-top:28px;
  border:0;
  border-radius:999px;
  background:var(--ink);
  color:#fff;
  cursor:pointer;
  font-weight:720;
  letter-spacing:.02em;
  font-size:13px;
}
.measures{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:10px;
  margin-top:27px;
}
.measure{background:var(--soft);border-radius:17px;padding:17px}
.measure b{font-size:24px;letter-spacing:-.04em;display:block}
.measure span{font-size:10px;color:var(--muted);display:block;margin-top:2px}
.select{
  width:100%;
  min-height:57px;
  margin-top:22px;
  background:#fff;
  border:1px solid var(--ink);
  border-radius:999px;
  cursor:pointer;
  font-weight:680;
  font-size:13px;
}
.commercial-note{font-size:10px;color:var(--muted);line-height:1.45;text-align:center;margin:10px 20px 0}

.detailed-measures{
  margin-top:24px;
  background:var(--paper);
  border:1px solid var(--line);
  border-radius:22px;
  padding:24px;
}
.detailed-measures-head{
  display:flex;
  align-items:flex-end;
  justify-content:space-between;
  gap:18px;
  margin-bottom:18px;
}
.detailed-measures h2{
  margin:0;
  font-size:24px;
  letter-spacing:-.04em;
}
.detailed-measures p{
  margin:5px 0 0;
  color:var(--muted);
  font-size:11px;
  line-height:1.45;
}
.measure-image-fallback{
  display:block;
  max-width:920px;
  margin:0 auto;
  padding:38px 20px;
  border-radius:16px;
  background:var(--soft);
  text-align:center;
  color:var(--muted);
  font-size:12px;
  line-height:1.55;
}

.operator{
  display:none;
  margin-top:24px;
  background:#111;
  color:#fff;
  border-radius:22px;
  padding:24px;
}
.operator.visible{display:block}
.operator .kicker{color:#969690}
.op-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.op-item{background:#1d1d1d;border:1px solid #292929;border-radius:14px;padding:13px;min-width:0}
.op-item span{font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:5px}
.op-item b{font-size:12px;display:block;overflow-wrap:anywhere}
.op-note{font-size:10px;color:#898989;line-height:1.5;margin-top:13px}
footer{border-top:1px solid var(--line);margin-top:40px;padding-top:18px;font-size:10px;color:var(--muted);display:flex;justify-content:space-between;gap:20px}
.toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,20px);opacity:0;pointer-events:none;background:#111;color:#fff;border-radius:999px;padding:11px 16px;font-size:12px;transition:.2s;z-index:40;max-width:calc(100vw - 30px);text-align:center}
.toast.show{opacity:1;transform:translate(-50%,0)}
.modal{position:fixed;inset:0;background:rgba(0,0,0,.56);display:none;place-items:center;padding:20px;z-index:50}
.modal.open{display:grid}
.modal-card{background:#fff;border-radius:24px;width:min(780px,100%);padding:25px}
.modal-top{display:flex;justify-content:space-between;align-items:center;gap:16px}
.modal-top h2{font-size:28px;letter-spacing:-.045em;margin:0}
.close{border:0;background:#efefeb;width:40px;height:40px;border-radius:50%;cursor:pointer;font-size:20px}
.camera{margin-top:18px;aspect-ratio:16/9;background:#ededE8;border-radius:19px;display:grid;place-items:center;text-align:center;padding:25px;color:var(--muted);font-size:13px;line-height:1.5}

@media(max-width:1000px){
  .product{grid-template-columns:1fr}
  .gallery{position:static}
  .hero{height:630px;min-height:0}
  .op-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:650px){
  .shell{padding:0 12px 38px}
  header{height:68px}
  .brand{font-size:24px}
  .header-actions span:first-child{display:none}
  .crumb{padding:15px 3px 12px}
  .hero{height:auto;min-height:410px;border-radius:19px}
  .hero img{padding:17px}
  .gallery-strip{display:flex;overflow:auto;padding-bottom:2px}
  .gallery-thumb{width:77px;min-width:77px}
  .card{border-radius:19px;padding:22px}
  h1{font-size:38px}
  .variants{grid-template-columns:repeat(2,1fr)}
  .op-grid{grid-template-columns:1fr 1fr}
  footer{flex-direction:column}
  .detailed-measures{padding:16px;border-radius:19px}
  .detailed-measures-head{display:block}
  .detailed-measures h2{font-size:21px}
}
</style>
</head>
<body>
<div class="shell">
  <header>
    <div class="brand">Optótica</div>
    <div class="header-actions"><a href="/catalogo-optotico/">Armações</a><a href="/area-paciente-optotico/">Meu pedido</a><a href="?sair=1">Sair</a></div>
  </header>

  <div class="crumb">Catálogo &nbsp;›&nbsp; Armações &nbsp;›&nbsp; Modelo 04</div>

  <main class="product">
    <section class="gallery" aria-label="Fotos da armação">
      <div class="hero">
        <img id="heroImage" referrerpolicy="no-referrer" alt="Modelo 04">
        <span class="counter" id="counter">1 de 6</span>
      </div>
      <div class="gallery-strip" id="galleryStrip" aria-label="Outras cores"></div>
    </section>

    <aside class="card">
      <div class="kicker">Seleção Optótica</div>
      <h1>Modelo 04</h1>
      <p class="kind">Armação quadrada</p>
      <p class="product-code">Cód. <span id="publicProductCode">M04-PENDENTE-0004</span></p>

      <div class="availability">
        <span class="dot" id="availabilityDot"></span>
        <b id="availabilityText">Disponível</b>
        <small id="availabilityHint">para esta cor</small>
      </div>

      <section class="section">
        <div class="section-title">
          <h2>Escolha a cor</h2>
          <span id="selectedColor">Transparente</span>
        </div>
        <div class="variants" id="variants"></div>
      </section>

      <button class="tryon" id="tryBtn">PROVAR ESTA ARMAÇÃO</button>

      <div class="measures" aria-label="Medidas principais">
        <div class="measure"><b>—</b><span>largura da lente</span></div>
        <div class="measure"><b>—</b><span>altura da lente</span></div>
      </div>

      <button class="select" id="selectBtn">SELECIONAR ESTA ARMAÇÃO</button>
      <p class="commercial-note">O valor do conjunto, incluindo as lentes, será informado pelo seu optometrista ou pela ótica.</p>
    </aside>
  </main>

  <section class="detailed-measures" aria-labelledby="detailedMeasuresTitle">
    <div class="detailed-measures-head">
      <div>
        <div class="kicker">Tamanho e proporções</div>
        <h2 id="detailedMeasuresTitle">Medidas da armação</h2>
        <p>As medidas detalhadas não foram fornecidas em campos estruturados pela API para este produto.</p>
      </div>
    </div>

    <div class="measure-image-fallback">
      A imagem técnica de medidas ainda não foi vinculada a este cadastro.<br>
      As medidas serão vinculadas ao cadastro assim que forem confirmadas na imagem técnica do fornecedor.
    </div>
  </section>

  <section class="operator" id="operatorPanel" aria-label="Dados internos">
    <div class="kicker">Uso interno Optótica</div>
    <div class="op-grid">
      <div class="op-item"><span>Cadastro</span><b>OPT-0004</b></div>
      <div class="op-item"><span>Código comercial</span><b id="internalCode">M04-PENDENTE-0004</b></div>
      <div class="op-item"><span>Product ID fornecedor</span><b>4001287673416</b></div>
      <div class="op-item"><span>SKU selecionado</span><b id="opSku">10000015626241878</b></div>
      <div class="op-item"><span>Cor</span><b id="opColor">Transparente</b></div>
      <div class="op-item"><span>Estoque SKU</span><b id="opQty">9</b></div>
      <div class="op-item"><span>Custo fonte</span><b id="opSourcePrice">US$ 11,00</b></div>
      <div class="op-item"><span>Status</span><b id="opStatus">Disponível</b></div>
    </div>
    <div class="op-note">
      Protótipo: os dados internos permanecem no arquivo para preservar a ligação com a API.
      Em produção, custo, códigos comerciais, IDs do fornecedor e regras de procurement devem ser resolvidos pelo backend e nunca enviados ao navegador do paciente.
    </div>
  </section>

  <footer><span>Optótica · catálogo de armações</span><span>Modelo 04</span></footer>
</div>

<div class="toast" id="toast"></div>

<div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="tryTitle">
  <div class="modal-card">
    <div class="modal-top">
      <div><div class="kicker">Prova virtual</div><h2 id="tryTitle">Veja o Modelo 04 em você</h2></div>
      <button class="close" id="closeBtn" aria-label="Fechar">×</button>
    </div>
    <div class="camera">Área reservada para o SDK de prova virtual.<br>A variante selecionada será enviada automaticamente para a prova.</div>
  </div>
</div>

<script>
/*
  PÁGINA ESPELHO OPTÓTICA — MODELO 02
  Product ID AliExpress: 4001287673416
  Cadastro Optótica: OPT-0004

  Dados confirmados pela API:
  - Formato: Rectangle
  - Material: Plastic / TR90 acetate
  - Largura da lente: 50 mm
  - Altura da lente: 43 mm
  - 6 variantes de cor
  - Estoque total retornado: 9 unidades

  IMPORTANTE:
  - O código comercial continua pendente até o custo BRL de cadastro ser congelado.
  - Não foi associada automaticamente uma imagem técnica de medidas porque o retorno da API
    não identifica semanticamente qual imagem da descrição contém o diagrama.
*/

const PRODUCT = {
  publicName: 'Modelo 04',
  optoticaId: 'OPT-0004',
  supplierProductId: '4001287673416',
  registeredCostBRLExact: null,
  registeredFXUSDBRL: null,
  measures: { lensWidth: null, lensHeight: null },
  variants: [
    {
      color:'Preto',
      supplierName:'black with clear',
      supplierSku:'10000015626241875',
      qty:3,
      sourcePromoUSD:8.76,
      image:'https://ae01.alicdn.com/kf/Ha964e6e3b37049f599d709b682cb650fU.jpg'
    },
    {
      color:'Âmbar',
      supplierName:'yellow orange frame',
      supplierSku:'10000015626241879',
      qty:2,
      sourcePromoUSD:8.69,
      image:'https://ae01.alicdn.com/kf/Hc1e83ff43ab04eda8a4de94d1156bd2ff.jpg'
    },
    {
      color:'Transparente',
      supplierName:'transparent',
      supplierSku:'10000015626241878',
      qty:9,
      sourcePromoUSD:11.00,
      image:'https://ae01.alicdn.com/kf/H155cdfc6cbef4d679ff6f9ab59ad73c0d.jpg'
    },
    {
      color:'Tartaruga',
      supplierName:'leopard with clear',
      supplierSku:'10000015626241877',
      qty:3,
      sourcePromoUSD:8.75,
      image:'https://ae01.alicdn.com/kf/H77b17e76bcfe40c6b26598baea82b14e6.jpg'
    },
    {
      color:'Cinza translúcido',
      supplierName:'grey with clear',
      supplierSku:'10000015626241876',
      qty:3,
      sourcePromoUSD:11.33,
      image:'https://ae01.alicdn.com/kf/H0235a71222644de2ab54c6c0297464b6Y.jpg'
    }
  ]
};

let selectedIndex = 2;

const $ = (id)=>document.getElementById(id);
const hero = $('heroImage');
const variantsEl = $('variants');
const galleryStrip = $('galleryStrip');
const toast = $('toast');

function ptMoney(value){
  return new Intl.NumberFormat('pt-BR',{
    minimumFractionDigits:2,
    maximumFractionDigits:2
  }).format(value);
}

function buildProductCode(costBRL){
  if(typeof costBRL !== 'number' || !Number.isFinite(costBRL)){
    return 'M04-PENDENTE-0004';
  }
  const x3InCents = Math.round(costBRL * 3 * 100);
  const encoded = String(x3InCents).padStart(5,'0');
  return `M04-${encoded}-${PRODUCT.optoticaId.replace('OPT-','')}`;
}

function showToast(message){
  toast.textContent=message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer=setTimeout(()=>toast.classList.remove('show'),2300);
}

function render(){
  const v=PRODUCT.variants[selectedIndex];

  hero.style.opacity='.35';
  hero.src=v.image;
  hero.alt=`${PRODUCT.publicName} na cor ${v.color}`;
  hero.onload=()=>hero.style.opacity='1';

  $('counter').textContent=`${selectedIndex+1} de ${PRODUCT.variants.length}`;
  $('selectedColor').textContent=v.color;

  const available=v.qty>0;
  $('availabilityDot').className='dot'+(available?'':' off');
  $('availabilityText').textContent=available?'Disponível':'Indisponível';
  $('availabilityHint').textContent='para esta cor';

  $('selectBtn').disabled=!available;
  $('selectBtn').style.opacity=available?'1':'.45';

  document.querySelectorAll('.variant').forEach((el,i)=>{
    el.classList.toggle('selected',i===selectedIndex);
  });

  document.querySelectorAll('.gallery-thumb').forEach((el,i)=>{
    el.classList.toggle('active',i===selectedIndex);
  });

  $('opSku').textContent=v.supplierSku;
  $('opColor').textContent=v.color;
  $('opQty').textContent=String(v.qty);
  $('opSourcePrice').textContent=`US$ ${ptMoney(v.sourcePromoUSD)}`;
  $('opStatus').textContent=available?'Disponível':'Indisponível';

  const productCode=buildProductCode(PRODUCT.registeredCostBRLExact);
  $('publicProductCode').textContent=productCode;
  $('internalCode').textContent=productCode;
}

PRODUCT.variants.forEach((v,i)=>{
  const btn=document.createElement('button');
  btn.type='button';
  btn.className='variant';
  btn.setAttribute('aria-label',`Selecionar cor ${v.color}`);
  btn.innerHTML=`<img referrerpolicy="no-referrer" src="${v.image}" alt=""><span>${v.color}</span>`;
  btn.onclick=()=>{
    selectedIndex=i;
    render();
  };
  variantsEl.appendChild(btn);

  const thumb=document.createElement('button');
  thumb.type='button';
  thumb.className='gallery-thumb';
  thumb.setAttribute('aria-label',`Ver ${v.color}`);
  thumb.innerHTML=`<img referrerpolicy="no-referrer" src="${v.image}" alt="">`;
  thumb.onclick=()=>{
    selectedIndex=i;
    render();
  };
  galleryStrip.appendChild(thumb);
});

$('tryBtn').onclick=()=>$('modal').classList.add('open');
$('closeBtn').onclick=()=>$('modal').classList.remove('open');
$('modal').onclick=(e)=>{
  if(e.target===$('modal')) $('modal').classList.remove('open');
};

$('selectBtn').onclick=async()=>{
  const v=PRODUCT.variants[selectedIndex];

  showToast('Armação selecionada. Revalidação de disponibilidade no checkout.');

  // PRODUÇÃO — exemplo:
  // const response = await fetch('/api/optotica/frame/revalidate', {
  //   method:'POST',
  //   headers:{'Content-Type':'application/json'},
  //   body:JSON.stringify({
  //     optoticaId:PRODUCT.optoticaId,
  //     variant:v.color
  //   })
  // });
  // const result = await response.json();
  // if(!result.available) { ... }
};

/* Modo interno do protótipo:
   abra o arquivo com ?operador=1
   Em produção, substituir por autenticação/rota privada.
*/
const params=new URLSearchParams(location.search);
if(params.get('operador')==='1'){
  $('operatorPanel').classList.add('visible');
}

render();
</script>
</body>
</html>
