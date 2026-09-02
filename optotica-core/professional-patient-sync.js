/* Optótica V3.1 — ponte profissional <-> paciente por WhatsApp (ID sem +55). */
(function(){
  const API='/optotica-core/patient-api.php';
  let currentPhone='';
  let record=null;
  let saveTimer=null;
  let loading=false;

  const $=id=>document.getElementById(id);
  const get=(id)=>$(id)?.value ?? '';
  const set=(id,value)=>{const e=$(id); if(e) e.value=value ?? ''};
  function normalizePhone(v){let d=String(v||'').replace(/\D/g,'');if((d.length===12||d.length===13)&&d.startsWith('55'))d=d.slice(2);return d}
  function validPhone(v){return /^\d{10,11}$/.test(v)}
  function activeOrder(){return document.querySelector('.order-tab.active')?.dataset?.order || String($('pedidoSelecionado')?.textContent||'').replace(/\D/g,'') || ''}

  function emptyRecord(phone){return {phone,customer:{name:'',whatsapp:phone,email:'',dnpOd:'',dnpOe:'',photo:''},professional:{},orders:{}}}

  async function apiGet(phone){const r=await fetch(API+'?phone='+encodeURIComponent(phone),{credentials:'same-origin',headers:{Accept:'application/json'}});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'api');return d.record}
  async function apiPost(phone,payload){const r=await fetch(API+'?phone='+encodeURIComponent(phone),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(payload)});const d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||'api');return d}

  function collectBudgets(){return Array.from(document.querySelectorAll('.budget-option')).map((item,i)=>({
    id:String(item.dataset.budgetId||i+1),
    details:item.dataset.details||item.querySelector('strong')?.textContent||'',
    lab:item.dataset.lab||'',
    price:item.dataset.price||item.querySelector('.price')?.textContent?.replace(/[^\d,.]/g,'')||'',
    obs:item.dataset.obs||'',
    selected:!!item.querySelector('input[type="radio"]')?.checked
  }))}

  function renderBudgets(order){const list=$('orcamentosLista');if(!list)return;const budgets=Array.isArray(order?.budgets)?order.budgets:[];list.innerHTML='';if(!budgets.length){list.innerHTML='<div class="empty-budget" id="orcamentosVazio">Nenhum orçamento adicionado ainda.</div>';return}budgets.forEach((b,i)=>{const item=document.createElement('div');item.className='os-item budget-option'+(String(order.selectedBudgetId||'')===String(b.id)?' selected-budget':'');item.dataset.budgetId=String(b.id||i+1);item.dataset.details=b.details||'';item.dataset.lab=b.lab||'';item.dataset.price=b.price||'';item.dataset.obs=b.obs||'';const checked=String(order.selectedBudgetId||'')===String(b.id)||!!b.selected;item.innerHTML='<div style="display:flex;gap:12px;align-items:flex-start"><input type="radio" name="orcamento_escolhido" value="'+item.dataset.budgetId+'" '+(checked?'checked':'')+' style="width:auto;margin-top:4px"><div><strong></strong><small></small></div></div><div class="price"></div>';item.querySelector('strong').textContent=b.details||'';item.querySelector('small').textContent=[b.lab,b.obs].filter(Boolean).join(' · ');item.querySelector('.price').textContent='R$ '+(b.price||'');list.appendChild(item)})}

  function rebuildOrderTabs(){const strip=$('ordersStrip'),add=$('novoPedidoBtn');if(!strip||!add||!record)return;strip.querySelectorAll('.order-tab').forEach(t=>t.remove());const numbers=Object.keys(record.orders||{}).sort((a,b)=>Number(a)-Number(b));numbers.forEach(n=>{const o=record.orders[n]||{};const t=document.createElement('button');t.type='button';t.className='order-tab';t.dataset.order=n;t.innerHTML='Pedido #'+n+' <small>'+(o.status||'em andamento')+'</small>';strip.insertBefore(t,add)});if(numbers.length){activateTab(numbers[numbers.length-1],false)}}

  function activateTab(number,load=true){document.querySelectorAll('.order-tab').forEach(t=>t.classList.toggle('active',String(t.dataset.order)===String(number)));if($('pedidoSelecionado'))$('pedidoSelecionado').textContent='#'+number;if(load)loadOrder(number)}

  function loadOrder(number){const o=record?.orders?.[number]||{};loading=true;set('rxOdEsf',o.prescription?.od?.esf);set('rxOdCil',o.prescription?.od?.cil);set('rxOdEixo',o.prescription?.od?.eixo);set('rxOdAdicao',o.prescription?.od?.adicao);set('rxOeEsf',o.prescription?.oe?.esf);set('rxOeCil',o.prescription?.oe?.cil);set('rxOeEixo',o.prescription?.oe?.eixo);set('rxOeAdicao',o.prescription?.oe?.adicao);set('tipoLente',o.lensDraft?.type);set('indiceLente',o.lensDraft?.index||'1.50');set('materialLente',o.lensDraft?.material||'Resina');set('tratamentoLente',o.lensDraft?.treatment||'Antirreflexo');set('laboratorio',o.lensDraft?.lab);set('valorFinal',o.finalValue);set('skuArmacao',o.selectedFrame?.sku);set('corArmacao',o.selectedFrame?.color);set('origemArmacao',o.selectedFrame?.origin);if($('armacaoNome'))$('armacaoNome').textContent=o.selectedFrame?.name||'Armação ainda não definida';if($('sideArmacao'))$('sideArmacao').textContent=o.selectedFrame?.name||'Ainda não escolhida';renderBudgets(o);loading=false}

  function loadCustomer(){const c=record?.customer||{};loading=true;set('clienteNome',c.name);set('clienteWhatsapp',currentPhone);set('clienteEmail',c.email);set('dnpOd',c.dnpOd);set('dnpOe',c.dnpOe);if($('overviewPaciente'))$('overviewPaciente').textContent=c.name||'Paciente';if($('overviewDnp'))$('overviewDnp').textContent='OD '+(c.dnpOd||'—')+' · OE '+(c.dnpOe||'—');loading=false}

  async function loadPatient(phone){phone=normalizePhone(phone);if(!validPhone(phone))return;currentPhone=phone;loading=true;try{record=await apiGet(phone)}catch(e){record=emptyRecord(phone)}loadCustomer();rebuildOrderTabs();const nums=Object.keys(record.orders||{}).sort((a,b)=>Number(a)-Number(b));if(nums.length)activateTab(nums[nums.length-1],true);const link=$('abrirAreaCliente');if(link)link.href='/area-paciente-optotico/';loading=false}

  function mergeForm(){if(!record)record=emptyRecord(currentPhone);record.customer={...(record.customer||{}),name:get('clienteNome'),whatsapp:currentPhone,email:get('clienteEmail'),dnpOd:get('dnpOd'),dnpOe:get('dnpOe')};const n=activeOrder();if(!n)return;const bs=collectBudgets(),selected=bs.find(b=>b.selected);record.orders=record.orders||{};record.orders[n]={...(record.orders[n]||{}),number:n,status:record.orders[n]?.status||'em andamento',prescription:{od:{esf:get('rxOdEsf'),cil:get('rxOdCil'),eixo:get('rxOdEixo'),adicao:get('rxOdAdicao')},oe:{esf:get('rxOeEsf'),cil:get('rxOeCil'),eixo:get('rxOeEixo'),adicao:get('rxOeAdicao')}},budgets:bs.map(({selected,...b})=>b),selectedBudgetId:selected?selected.id:(record.orders[n]?.selectedBudgetId||''),lensDraft:{type:get('tipoLente'),index:get('indiceLente'),material:get('materialLente'),treatment:get('tratamentoLente'),lab:get('laboratorio')},selectedFrame:{name:$('sideArmacao')?.textContent||$('armacaoNome')?.textContent||'',sku:get('skuArmacao'),color:get('corArmacao'),origin:get('origemArmacao')},finalValue:get('valorFinal'),updatedAt:new Date().toISOString()}}

  async function saveNow(){if(loading)return;const phone=normalizePhone(get('clienteWhatsapp'));if(!validPhone(phone))return;if(phone!==currentPhone){await loadPatient(phone);return}mergeForm();try{const d=await apiPost(phone,{record});record=d.record||record;const link=$('abrirAreaCliente');if(link)link.href='/area-paciente-optotico/'}catch(e){console.error('Optótica: falha ao salvar paciente',e)}}
  function schedule(){if(loading)return;clearTimeout(saveTimer);saveTimer=setTimeout(saveNow,450)}

  document.addEventListener('change',e=>{if(e.target?.id==='clienteWhatsapp'){const p=normalizePhone(e.target.value);if(validPhone(p)&&p!==currentPhone)loadPatient(p);return}schedule()},true);
  document.addEventListener('input',e=>{if(e.target?.id!=='clienteWhatsapp')schedule()},true);

  document.addEventListener('click',async e=>{
    const add=e.target.closest('#novoPedidoBtn');
    if(add){
      e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
      const phone=normalizePhone(get('clienteWhatsapp'));if(!validPhone(phone)){alert('Informe primeiro o WhatsApp do paciente com DDD.');return}
      if(phone!==currentPhone)await loadPatient(phone);await saveNow();
      try{const d=await apiPost(phone,{action:'create_order'});record=d.record;rebuildOrderTabs();activateTab(String(d.order.number),true)}catch(err){alert('Não foi possível criar o novo pedido.')}
      return;
    }
    const tab=e.target.closest('.order-tab');
    if(tab){setTimeout(()=>activateTab(tab.dataset.order,true),0);return}
    if(e.target.closest('.budget-option,#adicionarOrcamento'))setTimeout(schedule,80);
  },true);

  const initial=normalizePhone(get('clienteWhatsapp'));
  if(validPhone(initial))loadPatient(initial);
  else { const link=$('abrirAreaCliente'); if(link)link.href='/area-paciente-optotico/'; }

  window.OptoticaPaciente={load:loadPatient,save:saveNow,getRecord:()=>record};
})();
