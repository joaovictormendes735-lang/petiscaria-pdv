'use strict';
let receiptKind='customer',comboDraftV3=[],comboEditingIdV3=null,heldNextV3=null,heldRowsV3=[];
const quickNotesV3=['Sem cebola.','Sem gelo.','Bem passado.','Molho extra.','Sem sal.'];
function paymentLabel(key){return paymentLabels[key]||(key==='mixed'?'Misto':key);}
function cartItemV3(p){const item={product_id:p.id,name:p.name,price_cents:p.price_cents,quantity:1,notes:''};if(p.is_combo)item.combo_version=p.combo_version;return item;}
function itemRequestV3(i){const item={product_id:i.product_id,quantity:i.quantity,price_cents:i.price_cents};if(i.notes)item.notes=i.notes;if(i.combo_version!==undefined)item.combo_version=i.combo_version;return item;}
function resetHeldV3(){state.heldSource=null;state.heldVersion=0;state.heldSave=null;}
function quickButtonsV3(target){return `<div class="quick-notes" aria-label="Observações rápidas">${quickNotesV3.map((note,i)=>`<button type="button" data-quick-note="${i}" data-note-target="${target}">${note}</button>`).join('')}<button type="button" data-quick-note="other" data-note-target="${target}">Outras observações</button></div>`;}
function mountCartV3(){
  $('.cart-heading').insertAdjacentHTML('afterend','<button class="quiet secondary full-width" data-v3="held-list">Pedidos guardados</button>');
  if(!state.cart.length)return;
  if(state.heldSource)$('.cart-heading').insertAdjacentHTML('afterend','<p class="draft-label">Pedido retomado · só será contado após confirmar o pagamento</p>');
  $('#cart-notes')?.insertAdjacentHTML('afterend',quickButtonsV3('cart-notes'));
  [...document.querySelectorAll('.cart-item')].forEach((row,i)=>{const item=state.cart[i];row.insertAdjacentHTML('beforeend',`<div class="item-observation"><button class="quiet secondary" data-item-note="${item.product_id}" ${state.pending?'disabled':''}>${item.notes?'Editar observação':'Observação do item'}</button>${item.notes?`<p>${esc(item.notes)}</p>`:''}</div>`);});
  $('.cart-footer').insertAdjacentHTML('beforeend',`<button class="secondary full-width" data-v3="hold-current" ${state.pending?'disabled':''}>Guardar pedido</button>`);
}
function annotateCombosV3(){document.querySelectorAll('[data-product]').forEach(button=>{const p=state.products.find(p=>p.id===Number(button.dataset.product));if(p?.is_combo)button.insertAdjacentHTML('afterbegin','<span class="combo-badge">COMBO</span>');});}
function itemNoteDialogV3(id){
  const item=state.cart.find(i=>i.product_id===id);if(!item||state.pending)return;
  showDialog(`${modalHeading('Observações do item')}<p>${esc(item.name)}</p><form id="item-note-form"><label class="field"><span>Observação específica</span><textarea id="specific-note" maxlength="200" rows="3">${esc(item.notes||'')}</textarea></label>${quickButtonsV3('specific-note')}<p class="info">A observação vale para as ${item.quantity} unidade(s) desta linha.</p><div class="dialog-actions"><button type="button" data-action="close-modal">Voltar</button><button class="primary" type="submit">Salvar observação</button></div></form>`);
  $('#item-note-form').addEventListener('submit',e=>{e.preventDefault();item.notes=$('#specific-note').value;persist();modal.close();renderCart();});
}
function mountCheckoutV3(){
  $('.payment-options',modal).insertAdjacentHTML('beforeend',`<button data-payment="mixed" class="${checkoutPayment==='mixed'?'active':''}" ${state.pending?'disabled':''}>${icon('cash')} Pagamento misto</button>`);
  const parts=state.pending?.payment_parts||[];
  $('#cash-field').insertAdjacentHTML('afterend',`<section id="mixed-fields" ${checkoutPayment==='mixed'?'':'hidden'}><h3>Dividir o total entre as formas</h3><div class="split-grid">${Object.entries(paymentLabels).map(([key,label])=>`<label class="field compact"><span>${label} (R$)</span><input data-split="${key}" inputmode="decimal" placeholder="0,00" value="${parts.find(p=>p.payment===key)?(parts.find(p=>p.payment===key).amount_cents/100).toFixed(2).replace('.',','):''}" ${state.pending?'disabled':''}></label>`).join('')}</div><label class="field compact"><span>Recebido em dinheiro (misto)</span><input id="mixed-received" inputmode="decimal" placeholder="Igual à parcela, se deixar vazio" value="${parts.find(p=>p.payment==='cash')?(parts.find(p=>p.payment==='cash').received_cents/100).toFixed(2).replace('.',','):''}" ${state.pending?'disabled':''}></label><p id="mixed-balance" class="small muted">Informe pelo menos duas formas de pagamento.</p><div class="change"><span>Troco em dinheiro</span><strong id="mixed-change">${money(state.pending?state.pending.received_cents-state.pending.expected_total_cents:0)}</strong></div></section>`);
  $('#mixed-fields').querySelectorAll('input').forEach(input=>input.addEventListener('input',()=>{$('#payment-confirmed').checked=false;validateMixedV3();}));
  $('#checkout-notes').insertAdjacentHTML('afterend',quickButtonsV3('checkout-notes'));
  mountPrintPickerV3();
}
function switchPaymentV3(){if($('#mixed-fields'))$('#mixed-fields').hidden=checkoutPayment!=='mixed';}
function mixedPartsV3(){
  const parts=[];for(const field of modal.querySelectorAll('[data-split]')){const amount=field.value.trim()===''?0:parseMoney(field.value);if(amount===null)return null;if(amount>0){let received=amount;if(field.dataset.split==='cash'){const input=$('#mixed-received').value.trim();received=input===''?amount:parseMoney(input);if(received===null||received<amount)return null;}parts.push({payment:field.dataset.split,amount_cents:amount,received_cents:received});}}return parts;
}
function validateMixedV3(){
  if(state.pending)return;const parts=mixedPartsV3(),sum=parts?.reduce((s,p)=>s+p.amount_cents,0)||0,change=parts?.reduce((s,p)=>s+p.received_cents-p.amount_cents,0)||0;
  const valid=parts&&parts.length>=2&&sum===total();$('#mixed-balance').textContent=!parts?'Confira os valores e o recebido em dinheiro.':sum===total()?parts.length>=2?'Pagamentos conferidos.':'Use pelo menos duas formas ou selecione um pagamento único.':sum<total()?'Falta distribuir '+money(total()-sum):'Distribuição excede o total em '+money(sum-total());$('#mixed-change').textContent=money(change);$('#confirm-sale').disabled=!valid||!$('#payment-confirmed').checked;if($('#save-without-print'))$('#save-without-print').disabled=$('#confirm-sale').disabled;
}
function mountPrintPickerV3(order){
  if(state.pending?.print_kind)receiptKind=state.pending.print_kind;
  const target=$('.dialog-actions',modal);if(!target||$('#receipt-kind'))return;
  target.insertAdjacentHTML('beforebegin',`<label class="field"><span>Modelo de impressão</span><select id="receipt-kind" ${state.pending?'disabled':''}><option value="customer" ${receiptKind==='customer'?'selected':''}>Comanda do cliente</option><option value="kitchen" ${receiptKind==='kitchen'?'selected':''}>Comanda da cozinha</option></select></label>`);
  $('#receipt-kind').addEventListener('change',e=>{receiptKind=e.target.value;if(order&&$('.receipt-preview',modal))$('.receipt-preview',modal).innerHTML=receiptMarkup(order,receiptKind);});
}
function mountSuccessV3(order){mountPrintPickerV3();if(order.payment==='mixed')$('.success-number',modal).insertAdjacentHTML('afterend',`<p class="center small">Troco: ${money(order.received_cents-order.total_cents)}</p>`);}
function receiptItemExtraV3(item){return `${item.combo_components?.length?`<div class="receipt-components"><strong>COMBO</strong>${item.combo_components.map(c=>`<div>${c.quantity*item.quantity}x ${esc(c.name)}</div>`).join('')}</div>`:''}${item.notes?`<div class="receipt-notes">Obs.: ${esc(item.notes)}</div>`:''}`;}
function receiptMarkup(order,kind=receiptKind){
  if(kind==='kitchen')return `<h1>COZINHA</h1><div class="ticket-number"><small>PEDIDO Nº</small>${number(order.number)}</div><p class="receipt-meta">${dateTime(order.created_at)}</p>${order.cancelled_at?'<p class="receipt-total">CANCELADO</p>':''}${order.items.map(i=>`<div class="kitchen-item"><strong>${i.quantity}x ${esc(i.name)}</strong>${receiptItemExtraV3(i)}</div>`).join('')}${order.notes?`<p class="receipt-notes receipt-total">OBSERVAÇÕES DO PEDIDO<br>${esc(order.notes)}</p>`:''}`;
  const base=receiptCustomerV2(order);
  const split=order.payment==='mixed'?`<p>${(order.payment_parts||[]).map(p=>`${paymentLabel(p.payment).toUpperCase()}: ${money(p.amount_cents)}`).join('<br>')}<br>TROCO EM DINHEIRO: ${money(order.received_cents-order.total_cents)}</p>`:'';
  return base.replace('<p class="receipt-footer">',split+'<p class="receipt-footer">');
}
function mountKitchenDetailsV3(card,order){
  const rows=card.querySelectorAll('.order-line');order.items.forEach((item,i)=>{if(item.notes||item.combo_components?.length)rows[i]?.insertAdjacentHTML('afterend',`<div class="kitchen-detail">${receiptItemExtraV3(item)}</div>`);});
}
function orderTimingV3(o){if(o.status==='delivered')return {kind:'',label:'Entregue'};const minutes=elapsed(o);return minutes>=state.settings.late_minutes?{kind:'late',label:'Atrasado'}:minutes>=state.settings.attention_minutes?{kind:'attention',label:'Atenção'}:{kind:'',label:'Normal'};}
function mountProductV3(p,id){
  comboEditingIdV3=id;
  comboDraftV3=(p.components||[]).map(c=>({product_id:c.product_id,quantity:c.quantity}));
  $('#product-form .dialog-actions').insertAdjacentHTML('beforebegin',`<label class="check"><input type="checkbox" name="is_combo" id="is-combo" ${p.is_combo?'checked':''}><span>Este produto é um combo com preço único</span></label><section id="combo-config" ${p.is_combo?'':'hidden'}><h3>Produtos do combo</h3><p class="small muted">O preço acima é o valor total do combo. Os componentes serão detalhados na cozinha.</p><div id="combo-rows"></div><button type="button" class="secondary" data-v3="component-add">Adicionar componente</button></section>`);
  $('#is-combo').addEventListener('change',e=>{$('#combo-config').hidden=!e.target.checked;if(e.target.checked&&!comboDraftV3.length){comboDraftV3.push({product_id:0,quantity:1});renderComboRowsV3(id);}});renderComboRowsV3(id);
}
function renderComboRowsV3(id=comboEditingIdV3){
  const products=state.products.filter(p=>p.active&&!p.is_combo&&p.id!==id);
  $('#combo-rows').innerHTML=comboDraftV3.map((c,i)=>`<div class="component-row"><label><span class="small">Produto</span><select data-component-product="${i}"><option value="0">Selecione</option>${products.map(p=>`<option value="${p.id}" ${p.id===Number(c.product_id)?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><label><span class="small">Qtd.</span><input data-component-qty="${i}" type="number" min="1" max="99" value="${c.quantity}"></label><button type="button" class="quiet danger" data-remove-component="${i}" aria-label="Remover componente ${i+1}">×</button></div>`).join('');
  $('#combo-rows').querySelectorAll('[data-component-product]').forEach(el=>el.addEventListener('change',e=>comboDraftV3[Number(el.dataset.componentProduct)].product_id=Number(e.target.value)));
  $('#combo-rows').querySelectorAll('[data-component-qty]').forEach(el=>el.addEventListener('input',e=>comboDraftV3[Number(el.dataset.componentQty)].quantity=Number(e.target.value)));
}
function comboFormV3(f){return {is_combo:f.has('is_combo'),components:f.has('is_combo')?comboDraftV3:[]};}
function mountAvailabilityV3(){
  if(!document.querySelector('[data-v3="new-combo"]'))$('.page-heading').insertAdjacentHTML('beforeend','<button class="secondary" data-v3="new-combo">Novo combo</button>');
  document.querySelectorAll('#products-body [data-edit]').forEach(button=>{const p=state.products.find(p=>p.id===Number(button.dataset.edit));button.insertAdjacentHTML('afterend',`<button class="quiet ${p.available?'danger':'secondary'}" data-availability="${p.id}" data-available-value="${!p.available}">${p.available?'Esgotar':'Disponibilizar'}</button>`);});
}
function mountSettingsV3(){
  $('#settings-error').insertAdjacentHTML('beforebegin',`<h3>Tempo de preparo</h3><label class="field"><span>Atenção após (minutos)</span><input name="attention_minutes" type="number" min="1" max="180" value="${state.settings.attention_minutes??10}" required></label><label class="field"><span>Atrasado após (minutos)</span><input name="late_minutes" type="number" min="2" max="480" value="${state.settings.late_minutes??20}" required></label>`);
  $('.settings-grid').insertAdjacentHTML('beforeend','<section class="panel"><h2>Backup operacional</h2><p class="info">Exporte o histórico financeiro, produtos, combos, caixas e auditoria em NDJSON. O download usa uma fotografia consistente do banco e blocos pequenos.</p><a class="button secondary" href="/api/backup" download>Exportar backup autorizado</a><p class="info">O arquivo não inclui senhas, tokens ou credenciais de conexão. Na restauração, as contas precisam de novas senhas. Guarde o arquivo em local protegido.</p><h2>Instalar o PDV</h2><p class="info">Use a opção de instalar aplicativo do navegador. No iPhone, utilize Compartilhar e Adicionar à Tela de Início. Vendas continuam exigindo conexão com o servidor.</p></section>');
}
function draftPayloadV3(){return {items:state.cart.map(i=>({...itemRequestV3(i),name:i.name})),notes:state.notes,discount_cents:state.discount};}
function holdCurrentV3(){
  if(!state.cart.length||state.pending)return;
  showDialog(`${modalHeading('Guardar pedido')}<form id="hold-form"><p class="info">O pedido ficará guardado no servidor e não contará como venda.</p><label class="field"><span>Identificação do pedido</span><input name="label" maxlength="80" required placeholder="Ex.: balcão, cliente aguardando" value="${esc(state.heldSave?.label||'')}"></label><p class="error" id="hold-error"></p><div class="dialog-actions"><button type="button" data-action="close-modal">Voltar</button><button class="primary" type="submit">Guardar pedido</button></div></form>`);
  $('#hold-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;const label=new FormData(e.target).get('label');state.heldSave={id:state.heldSource||state.heldSave?.id||crypto.randomUUID(),label};persist();try{await post('/held',{id:state.heldSave.id,label,payload:draftPayloadV3(),expected_version:state.heldVersion||undefined});state.cart=[];state.notes='';state.discount=0;resetHeldV3();persist();modal.close();renderCashier();toast('Pedido guardado. O caixa está livre para o próximo atendimento.');}catch(error){if($('#hold-error'))$('#hold-error').textContent=error.message;b.disabled=false;}});
}
async function heldListV3(append=false){
  const data=await api('/held'+(append&&heldNextV3?'?before='+heldNextV3:''));heldRowsV3=append?[...heldRowsV3,...data.held]:data.held;heldNextV3=data.next;
  showDialog(`${modalHeading('Pedidos guardados')}<p class="info">Pedidos sem pagamento confirmado. Guarde ou limpe o pedido atual antes de retomar outro.</p>${heldRowsV3.map(h=>`<article class="held-card"><strong>${esc(h.label)}</strong><p class="small muted">${dateTime(h.created_at)} · ${esc(h.operator_name)}</p><div class="dialog-actions"><button class="primary" data-resume-held="${h.id}">Retomar</button><button class="quiet danger" data-discard-held="${h.id}">Descartar</button></div></article>`).join('')||'<p class="empty-state">Nenhum pedido guardado.</p>'}${heldNextV3?'<button class="secondary full-width" data-v3="more-held">Carregar mais</button>':''}`);
}
async function resumeHeldV3(id){
  if(state.cart.length||state.pending){toast('Guarde ou limpe o pedido atual antes de retomar outro.');return;}
  const {held}=await api('/held/'+id);await catalog();let changed=false;
  state.cart=held.payload.items.map(i=>{const p=state.products.find(p=>p.id===i.product_id);if(!p||!p.active||!p.available||p.price_cents!==i.price_cents)changed=true;const item={product_id:i.product_id,name:p?.name||i.name||'Produto indisponível',quantity:i.quantity,price_cents:p?.price_cents||i.price_cents,notes:i.notes||''};if(p?.is_combo)item.combo_version=p.combo_version;return item;});
  state.notes=held.payload.notes;state.discount=held.payload.discount_cents;state.heldSource=held.id;state.heldVersion=held.version;state.heldSave={id:held.id,label:held.label};persist();modal.close();state.view='cashier';shell();toast(changed?'Pedido retomado. Preços atualizados; confira os itens indisponíveis.':'Pedido retomado. Confira os itens antes de receber o pagamento.');
}
function mountCashV3(){
  if(state.user.role==='admin'&&pendingMovementV3())$('.page-heading').insertAdjacentHTML('afterend','<button class="secondary full-width" data-v3="verify-movement">Verificar movimentação pendente</button>');
  const c=cashData.current;if(c){$('.cash-banner').insertAdjacentHTML('afterend',`<div class="movement-summary"><span>Suprimentos: <strong>${money(c.summary.movements?.in_cents||0)}</strong></span><span>Sangrias: <strong>${money(c.summary.movements?.out_cents||0)}</strong></span>${state.user.role==='admin'?`<button class="secondary" data-movement-kind="in">Suprimento</button><button class="danger" data-movement-kind="out">Sangria</button><button class="quiet secondary" data-moves-cash="${c.id}">Ver movimentações</button>`:''}</div>`);}
  if(state.user.role==='admin')document.querySelectorAll('[data-close-print]').forEach(b=>b.insertAdjacentHTML('afterend',`<button class="quiet secondary" data-moves-cash="${b.dataset.closePrint}">Movimentações</button>`));
}
function appendMovementPrintV3(summary){$('#receipt .receipt-total:last-child')?.insertAdjacentHTML('beforebegin',`<p>SUPRIMENTOS: ${money(summary.movements?.in_cents||0)}<br>SANGRIAS: ${money(summary.movements?.out_cents||0)}</p>`);}
let movementPagesV3=[],movementNextV3=null,movementCashV3=null;
let movementPendingMemoryV3=null,movementOwnerV3=null;
function pendingMovementV3(){const memory=movementOwnerV3===state.user.id?movementPendingMemoryV3:null;try{return JSON.parse(sessionStorage.getItem(storageKey()+':movement')||'null')||memory;}catch{return memory;}}
function rememberMovementV3(value){movementPendingMemoryV3=value;movementOwnerV3=state.user.id;try{if(value)sessionStorage.setItem(storageKey()+':movement',JSON.stringify(value));else sessionStorage.removeItem(storageKey()+':movement');}catch{if(value)toast('Mantenha esta aba aberta até confirmar a movimentação. O navegador bloqueou o rascunho local.');}}
async function movementListV3(id,append=false){
  movementCashV3=id;const d=await api('/cash/movements?cash_id='+id+(append&&movementNextV3?'&before='+movementNextV3:''));movementPagesV3=append?[...movementPagesV3,...d.movements]:d.movements;movementNextV3=d.next;
  showDialog(`${modalHeading('Movimentações do caixa #'+id)}${movementPagesV3.map(m=>`<article class="held-card"><strong>${m.kind==='in'?'Suprimento':'Sangria'} · ${money(m.amount_cents)}</strong><p class="small">${esc(m.reason)}</p><p class="small muted">${dateTime(m.created_at)} · ${esc(m.operator_name)}</p></article>`).join('')||'<p class="info">Nenhuma movimentação registrada.</p>'}${movementNextV3?'<button class="secondary full-width" data-v3="more-movements">Carregar mais</button>':''}`);
}
function movementDialogV3(kind){
  const id=cashData.current?.id,pending=pendingMovementV3();
  if(!id&&!pending){toast('Abra o caixa antes de registrar uma movimentação.');return;}
  const d=pending||{cash_session_id:id,kind,request_key:crypto.randomUUID()};
  showDialog(`${modalHeading(d.kind==='in'?'Registrar suprimento':'Registrar sangria')}<form id="movement-form">${pending?'<p class="retry-note">Confirmação pendente. Repita com a mesma identificação para verificar sem duplicar.</p>':''}<label class="field"><span>Valor da movimentação (R$)</span><input name="amount" inputmode="decimal" required value="${pending?(d.amount_cents/100).toFixed(2).replace('.',','):''}" ${pending?'readonly':''}></label><label class="field"><span>Motivo</span><textarea name="reason" minlength="3" maxlength="300" required ${pending?'readonly':''}>${esc(d.reason||'')}</textarea></label><p id="movement-error" class="error"></p><div class="dialog-actions"><button type="button" data-action="close-modal">Voltar</button><button class="primary" type="submit">Confirmar movimentação</button></div></form>`);
  $('#movement-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),amount=parseMoney(f.get('amount')),b=$('[type=submit]',e.target);if(!amount){$('#movement-error').textContent='Informe um valor maior que zero.';return;}b.disabled=true;state.busy=true;Object.assign(d,{amount_cents:amount,reason:f.get('reason')});rememberMovementV3(d);e.target.querySelectorAll('input,textarea').forEach(field=>field.readOnly=true);try{await post('/cash/movements',d);rememberMovementV3(null);modal.close();await renderCash();toast('Movimentação registrada.');}catch(error){if(error.status&&![401,403,408,429].includes(error.status)&&error.status<500){rememberMovementV3(null);e.target.querySelectorAll('input,textarea').forEach(field=>field.readOnly=false);}if($('#movement-error'))$('#movement-error').textContent=error.message;b.disabled=false;}finally{state.busy=false;}});
}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  await safe(async()=>{
    if(b.dataset.quickNote){const target=document.getElementById(b.dataset.noteTarget);if(!target||target.disabled||target.readOnly)return;if(b.dataset.quickNote!=='other'){const text=quickNotesV3[Number(b.dataset.quickNote)];if(!text)return;const next=(target.value.trim()+' '+text).trim();if(next.length>target.maxLength){toast('Limite de observações atingido.');return;}target.value=next;target.dispatchEvent(new Event('input',{bubbles:true}));}target.focus();return;}
    if(b.dataset.itemNote){itemNoteDialogV3(Number(b.dataset.itemNote));return;}
    if(b.dataset.removeComponent!==undefined){comboDraftV3.splice(Number(b.dataset.removeComponent),1);renderComboRowsV3();return;}
    if(b.dataset.availability){b.disabled=true;try{await post('/products/'+b.dataset.availability+'/availability',{available:b.dataset.availableValue==='true'});await catalog();renderProducts();toast('Disponibilidade atualizada. Combos dependem também de seus componentes.');}finally{b.disabled=false;}return;}
    if(b.dataset.resumeHeld){await resumeHeldV3(b.dataset.resumeHeld);return;}
    if(b.dataset.discardHeld){const id=b.dataset.discardHeld;showDialog(`${modalHeading('Descartar pedido guardado?')}<p class="info">O pedido sairá da lista. Nenhuma venda será registrada e o histórico de auditoria será preservado.</p><div class="dialog-actions"><button data-action="close-modal">Voltar</button><button class="danger" data-confirm-discard="${id}">Confirmar descarte</button></div>`);return;}
    if(b.dataset.confirmDiscard){b.disabled=true;await post('/held/'+b.dataset.confirmDiscard+'/discard',{});await heldListV3();return;}
    if(b.dataset.movementKind){movementDialogV3(b.dataset.movementKind);return;}
    if(b.dataset.movesCash){await movementListV3(b.dataset.movesCash);return;}
    switch(b.dataset.v3){case 'held-list':await heldListV3();break;case 'hold-current':holdCurrentV3();break;case 'more-held':await heldListV3(true);break;case 'new-combo':productDialog();$('#is-combo').checked=true;$('#is-combo').dispatchEvent(new Event('change'));break;case 'component-add':if(comboDraftV3.length>=30){toast('Limite de 30 componentes.');break;}comboDraftV3.push({product_id:0,quantity:1});renderComboRowsV3();break;case 'verify-movement':movementDialogV3('in');break;case 'more-movements':await movementListV3(movementCashV3,true);break;}
  });
});
(async()=>{
  if('serviceWorker'in navigator&&window.isSecureContext)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  if(location.pathname.startsWith('/retirada')){await startPickup();return;}
  try{const data=await api('/session');state.user=data.user;state.csrf=data.csrf;await catalog();restore();state.view=state.pending||state.user.role!=='admin'?'cashier':'dashboard';shell();}catch(error){login(error.status===401?'':error.message);}
})();
