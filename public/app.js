'use strict';
const $ = (s,root=document) => root.querySelector(s);
const app=$('#app'), modal=$('#modal');
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => (Number(n)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const number = n => String(n).padStart(4,'0');
const paths={
  box:'M4 7h16v14H4z M3 3h18v4H3z M9 11h6',
  cart:'M3 3h2l3 12h11l3-9H6 M9 20h.01 M18 20h.01',
  orders:'M8 3h8v4H8z M8 5H5v16h14V5h-3 M8 11h8 M8 15h6',
  report:'M4 3v18h17 M8 16v-4 M13 16V7 M18 16v-7',
  settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  search:'M21 21l-5-5 M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14',
  print:'M7 8V3h10v5 M7 17H4V9h16v8h-3 M7 14h10v7H7z M17 11h.01',
  check:'M5 12l4 4L19 6',close:'M6 6l12 12 M6 18 18 6',
  snack:'M4 15c0-7 4-11 8-11s8 4 8 11 M3 15h18v5H3z M8 9l1-1 M13 7l1-1 M16 11l1-1',
  fries:'M6 10 4 3 M10 10V2 M14 10l1-8 M18 10l3-6 M4 10h16l-3 12H7z M10 14v4 M14 14v4',
  drink:'M6 7h12l-2 15H8z M5 7h14 M12 7l2-5h5 M8 11h8',
  refresh:'M20 7v5h-5 M4 17v-5h5 M5 8a8 8 0 0 1 13-3l2 2 M4 17l2 2a8 8 0 0 0 13-3',
  clock:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
  card:'M3 5h18v14H3z M3 9h18 M7 15h4',
  cash:'M2 5h20v14H2z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M5 9v6 M19 9v6',
  pix:'M12 2l10 10-10 10L2 12z M6 8l6 6 6-6 M6 16l6-6 6 6',
  logout:'M9 4H4v16h5 M9 12h12 M17 8l4 4-4 4',
  plus:'M12 5v14 M5 12h14',edit:'M4 16 16 4l4 4L8 20H4z M14 6l4 4'
};
const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name]||paths.box}"/></svg>`;
const labels={pending:'Pendente',preparing:'Em preparo',ready:'Pronto',delivered:'Entregue'};
const paymentLabels={pix:'Pix',cash:'Dinheiro',debit:'Débito',credit:'Crédito'};
const states=Object.keys(labels);
const state={user:null,csrf:'',view:'cashier',categories:[],products:[],settings:{store_name:'Petiscaria',timezone:'America/Sao_Paulo',paper_width:80},cart:[],notes:'',discount:0,category:0,search:'',orders:[],next:null,filter:'all',busy:false,pending:null};
let toastTimer;
function toast(message){ $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('#toast').hidden=true,5500); }
async function api(path,options={}){
  const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch('/api'+path,{...options,credentials:'same-origin',signal:controller.signal,headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf,...options.headers}});
    const data=await response.json();
    if(!response.ok){const error=new Error(data.error||'Não foi possível concluir.');error.status=response.status;if(response.status===401 && path!=='/login'){modal.close();login();}throw error;}
    return data;
  } catch(error){if(error.name==='AbortError' || error instanceof TypeError) throw new Error('Sem resposta do servidor. Confira a conexão e tente novamente.');throw error;}
  finally{clearTimeout(timeout);}
}
const post=(path,data,method='POST')=>api(path,{method,body:JSON.stringify(data)});
const subtotal=()=>state.cart.reduce((sum,i)=>sum+i.price_cents*i.quantity,0);
const total=()=>Math.max(0,subtotal()-(state.discount||0));
const count=()=>state.cart.reduce((sum,i)=>sum+i.quantity,0);
const time=v=>new Date(v).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:state.settings.timezone});
const dateTime=v=>new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:state.settings.timezone});
function today(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:state.settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');}
const storageKey=()=>`pdv:${state.user.id}`;
function persist(){try{sessionStorage.setItem(storageKey(),JSON.stringify({cart:state.cart,pending:state.pending,notes:state.notes,discount:state.discount}));}catch{toast('O navegador não permitiu guardar o rascunho nesta aba. Mantenha-a aberta até confirmar a venda.');}}
function restore(){try{const saved=JSON.parse(sessionStorage.getItem(storageKey())||'{}');if(Array.isArray(saved.cart))state.cart=saved.cart.filter(i=>Number.isInteger(i.product_id)&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=99&&Number.isInteger(i.price_cents));state.pending=saved.pending||null;state.notes=typeof saved.notes==='string'?saved.notes.slice(0,500):'';state.discount=state.user.role==='admin'&&Number.isSafeInteger(saved.discount)?Math.max(0,saved.discount):0;}catch{state.cart=[];state.pending=null;}}
async function catalog(){const data=await api('/catalog');Object.assign(state,data);document.title=`${state.settings.store_name} · PDV`;applyTheme();}
function login(message=''){
  state.user=null;state.csrf='';
  app.innerHTML=`<main class="login-page"><form class="login-card" id="login-form"><div class="brand"><img src="/favicon.svg" alt=""><div><strong>Petiscaria</strong><small>Seu caixa, mais simples</small></div></div><h1>Vamos abrir o caixa?</h1><p class="subtitle">Entre com sua conta para começar.</p><label class="field"><span>Usuário</span><input name="username" autocomplete="username" required maxlength="80" autocapitalize="none" spellcheck="false"></label><label class="field"><span>Senha</span><input name="password" type="password" autocomplete="current-password" required maxlength="128"></label><p class="error" id="login-error">${esc(message)}</p><button class="primary" type="submit">Entrar no sistema</button><p class="login-note">Acesso restrito à equipe da petiscaria.</p></form></main>`;
  $('#login-form').addEventListener('submit',async e=>{
    e.preventDefault();const button=$('button',e.target);button.disabled=true;button.textContent='Entrando…';$('#login-error').textContent='';
    try{const data=await post('/login',Object.fromEntries(new FormData(e.target)));state.user=data.user;state.csrf=data.csrf;await catalog();restore();state.view=state.pending||state.user.role!=='admin'?'cashier':'dashboard';shell();}
    catch(error){$('#login-error').textContent=error.message;button.disabled=false;button.textContent='Entrar no sistema';}
  });
}
function shell(){
  const admin=state.user.role==='admin';
  const nav=[...(admin?[['dashboard','Visão geral','report']]:[]),['cashier','Caixa','cart'],['orders','Pedidos','orders'],['cash','Controle de caixa','cash'],['history','Histórico','clock'],...(admin?[['products','Produtos','box'],['reports','Relatórios','report'],['settings','Configurações','settings']]:[]),['pickup','Retirada','check']];
  app.innerHTML=`<header class="topbar"><div class="brand"><img src="${esc(state.settings.logo_data_url||'/favicon.svg')}" alt=""><div><strong>${esc(state.settings.store_name)}</strong><small>Ponto de venda · 2.0</small></div></div><nav class="nav" aria-label="Menu principal">${nav.map(([v,label,i])=>`<button data-view="${v}" class="${state.view===v?'active':''}">${icon(i)}${label}</button>`).join('')}</nav><div class="account"><span class="avatar">${esc(state.user.name.charAt(0).toUpperCase())}</span><div class="account-name">${esc(state.user.name)}<small>${admin?'Administrador':'Operador'}</small></div><button class="quiet" data-action="logout" aria-label="Sair da conta" title="Sair">${icon('logout')}</button></div></header><main id="content"></main>`;
  renderView();
}
function heading(title,subtitle,action=''){return `<div class="page-heading"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div>${action}</div>`;}
async function renderView(){
  const target=$('#content');if(!target)return;
  if(state.view==='cashier')renderCashier();
  else if(['dashboard','cash','history'].includes(state.view))await safe(()=>renderV2View());
  else if(state.view==='products')renderProducts();
  else if(state.view==='settings')renderSettings();
  else {
    target.innerHTML=heading(state.view==='orders'?'Pedidos':'Relatório do caixa','Carregando informações…');
    try{if(state.view==='orders')await renderOrders();else await renderReports();}catch(error){if(state.user)target.innerHTML=heading('Não foi possível carregar',esc(error.message),'<button data-action="reload">Tentar novamente</button>');}
  }
}
function renderCashier(){
  $('#content').innerHTML=`${heading('Caixa','Tudo pronto para o próximo pedido.',`<span class="tag">${icon('clock')}${new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'long',timeZone:state.settings.timezone})}</span>`)}<div class="cashier"><section aria-label="Catálogo"><div class="catalog-toolbar"><div class="search">${icon('search')}<input id="product-search" type="search" placeholder="Buscar produto…" aria-label="Buscar produto" value="${esc(state.search)}"></div><button class="quiet secondary" data-action="refresh-catalog" aria-label="Atualizar catálogo" title="Atualizar catálogo">${icon('refresh')}</button></div><div class="tabs" aria-label="Categorias"><button data-category="0" class="${state.category===0?'active':''}">Todos</button>${state.categories.map(c=>`<button data-category="${c.id}" class="${state.category===c.id?'active':''}">${esc(c.name)}</button>`).join('')}</div><div class="section-label"><h2 id="category-title">Cardápio</h2><small id="product-count"></small></div><div class="product-grid" id="product-grid"></div><p class="catalog-note">${icon('check')}Toque em um produto para adicionar ao pedido.</p></section><aside id="cart" class="cart" aria-label="Pedido atual"></aside></div><div class="mobile-cart"><div><small id="mobile-count"></small><strong id="mobile-total"></strong></div><button class="primary" data-action="show-cart">Ver pedido</button></div>`;
  $('#product-search').addEventListener('input',e=>{state.search=e.target.value;renderGrid();});renderGrid();renderCart();
}
function renderGrid(){
  const query=state.search.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const products=state.products.filter(p=>p.active && (!state.category||p.category_id===state.category) && p.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(query));
  $('#category-title').textContent=state.categories.find(c=>c.id===state.category)?.name||'Cardápio';$('#product-count').textContent=`${products.length} produtos`;
  $('#product-grid').innerHTML=products.length?products.map(p=>{
    const index=state.categories.findIndex(c=>c.id===p.category_id),qty=state.cart.find(i=>i.product_id===p.id)?.quantity;
    return `<button class="product" data-product="${p.id}" data-color="${index%4}" ${state.pending||p.available===false?'disabled':''} aria-label="Adicionar ${esc(p.name)}, ${money(p.price_cents)}"><span class="product-illustration">${icon(['snack','fries','drink','box'][index%4]||'box')}</span>${qty?`<span class="product-count">${qty} no pedido</span>`:''}<span class="product-name">${esc(p.name)}</span><span class="product-bottom"><span class="product-price">${money(p.price_cents)}</span><span class="add" aria-hidden="true">${p.available===false?'×':'+'}</span></span>${p.available===false?'<span class="small muted">Indisponível</span>':''}</button>`;
  }).join(''):'<div class="empty-state"><h2>Nenhum produto encontrado</h2><p>Experimente outro nome ou categoria.</p></div>';
}
function renderCart(){
  $('#cart').innerHTML=`<div class="cart-heading"><div><h2>Pedido atual</h2><span class="count-badge">${count()}</span></div>${state.cart.length&&!state.pending?'<button class="quiet danger clear-cart" data-action="clear-cart">Limpar</button>':''}</div>${state.pending?'<div class="retry-note">Há uma venda aguardando confirmação. Verifique antes de iniciar outra.</div>':''}${state.cart.length?`<div class="cart-items">${state.cart.map(i=>`<div class="cart-item"><div class="item-top"><strong>${esc(i.name)}</strong><strong>${money(i.price_cents*i.quantity)}</strong></div><div class="item-bottom"><div class="qty"><button data-qty="${i.product_id}" data-delta="-1" aria-label="Diminuir ${esc(i.name)}" ${state.pending?'disabled':''}>−</button><span>${i.quantity}</span><button data-qty="${i.product_id}" data-delta="1" aria-label="Aumentar ${esc(i.name)}" ${state.pending?'disabled':''}>+</button></div><span class="unit-price">${money(i.price_cents)} / un.</span></div></div>`).join('')}</div>`:`<div class="cart-empty"><div class="empty-illustration">${icon('cart')}</div><strong>Seu pedido começa aqui</strong><p>Selecione os produtos ao lado<br>para começar uma venda.</p></div>`}<div class="cart-footer"><div class="cart-total"><span>Total do pedido</span><strong>${money(total())}</strong></div><button class="primary" data-action="checkout" ${!state.cart.length?'disabled':''}>${icon('check')}${state.pending?'Verificar venda':'Finalizar venda'}</button><small>${state.pending?'O pedido está preservado nesta aba.':'Confirme o pagamento na próxima etapa.'}</small></div>`;
  $('#mobile-count').textContent=`${count()} ${count()===1?'item':'itens'} no pedido`;$('#mobile-total').textContent=money(total());
  mountCartV2();
}
function cartChanged(){persist();renderGrid();renderCart();}
function showDialog(html){modal.innerHTML=html;if(!modal.open)modal.showModal();}
function modalHeading(title,close=true){return `<div class="modal-heading"><h2 id="modal-title">${title}</h2>${close?`<button class="quiet" data-action="close-modal" aria-label="Fechar">${icon('close')}</button>`:''}</div>`;}
let checkoutPayment='pix';
function checkout(){
  checkoutPayment=state.pending?.payment||'pix';
  const locked=Boolean(state.pending);
  showDialog(`${modalHeading(locked?'Verificar confirmação':'Finalizar venda',!state.busy)}${locked?'<p class="retry-note">A resposta da venda não foi confirmada. Consulte ou repita a confirmação com segurança; será mantido o mesmo número de pedido.</p>':''}<div class="payment-total"><small>Total a receber</small><strong>${money(state.pending?.expected_total_cents||total())}</strong></div><div class="payment-options">${Object.entries(paymentLabels).map(([key,label])=>`<button data-payment="${key}" class="${key===checkoutPayment?'active':''}" ${locked?'disabled':''}>${icon(key==='cash'?'cash':key==='pix'?'pix':'card')}${label}</button>`).join('')}</div><div id="cash-field" ${checkoutPayment==='cash'?'':'hidden'}><label class="field"><span>Valor recebido em dinheiro (R$)</span><input id="cash-received" inputmode="decimal" placeholder="0,00" value="${locked?(state.pending.received_cents/100).toFixed(2).replace('.',','):''}" ${locked?'disabled':''}></label><div class="change"><span>Troco</span><strong id="change-value">${locked?money(state.pending.received_cents-state.pending.expected_total_cents):money(0)}</strong></div></div><label class="check"><input id="payment-confirmed" type="checkbox" ${locked?'checked disabled':''}><span>Confirmo que o pagamento foi recebido.<br><span class="muted">O sistema não cobra Pix ou cartão automaticamente.</span></span></label><p id="checkout-error" class="error"></p><div class="dialog-actions"><button class="quiet" data-action="close-modal">Voltar</button><button class="primary" id="confirm-sale" data-action="confirm-sale" ${locked?'':'disabled'}>${locked?'Verificar venda':'Confirmar e salvar'}</button></div>`);
  $('#payment-confirmed').addEventListener('change',validateCheckout);
  $('#cash-received').addEventListener('input',validateCheckout);
  mountCheckoutV2();
}
function parseMoney(value){const v=String(value).trim();if(!/^\d{1,6}([.,]\d{1,2})?$/.test(v))return null;const [whole,dec='']=v.replace(',','.').split('.');return Number(whole)*100+Number(dec.padEnd(2,'0'));}
function validateCheckout(){
  if(state.pending)return;
  const received=checkoutPayment==='cash'?parseMoney($('#cash-received').value):total();
  $('#change-value').textContent=money(Math.max(0,(received||0)-total()));
  $('#confirm-sale').disabled=!$('#payment-confirmed').checked||received===null||received<total();
  if($('#save-without-print'))$('#save-without-print').disabled=$('#confirm-sale').disabled;
}
async function confirmSale(printRequested=true){
  if(state.busy)return;
  if(!state.pending){validateCheckout();if($('#confirm-sale').disabled)return;state.pending={request_key:crypto.randomUUID(),payment:checkoutPayment,received_cents:checkoutPayment==='cash'?parseMoney($('#cash-received').value):total(),expected_total_cents:total(),notes:state.notes,discount_cents:state.discount,print_requested:printRequested,items:state.cart.map(({product_id,quantity,price_cents})=>({product_id,quantity,price_cents}))};persist();}
  printRequested=state.pending.print_requested??printRequested;
  state.busy=true;modal.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=true);$('#confirm-sale').textContent='Salvando…';$('#checkout-error').textContent='';
  try{
    const {order}=await post('/orders',state.pending);
    state.pending=null;state.cart=[];state.notes='';state.discount=0;persist();state.busy=false;
    if(state.view==='cashier'){renderGrid();renderCart();}
    showOrderSuccess(order);
    if(printRequested||state.settings.auto_print)printOrder(order);
  }catch(error){
    state.busy=false;
    if(error.status && error.status>=400 && error.status<500 && ![401,403,408,429].includes(error.status)){state.pending=null;persist();}
    if(state.user){checkout();$('#checkout-error').textContent=error.message;if(state.view==='cashier'){renderGrid();renderCart();}}
  }
}
function showOrderSuccess(order){
  showDialog(`${modalHeading('Venda concluída')}<div class="success-check">${icon('check')}</div><p class="center small">Pagamento registrado com sucesso.</p><div class="success-number"><small>Pedido</small><strong>${number(order.number)}</strong></div><p class="center small muted">${paymentLabels[order.payment]} · ${money(order.total_cents)}${order.payment==='cash'?`<br>Troco: ${money(order.received_cents-order.total_cents)}`:''}</p><div class="dialog-actions"><button class="secondary" data-print="${order.id}">${icon('print')} Imprimir comanda</button><button class="primary" data-action="close-modal">Nova venda</button></div><p class="print-hint">Se a impressão for cancelada, a venda continua salva. Reimprima na tela Pedidos.</p>`);
  $('.dialog-actions',modal).insertAdjacentHTML('beforebegin',`<button class="quiet secondary full-width" data-preview="${order.id}">Pré-visualizar comanda</button>`);
}
function printOrder(order){
  const width=state.settings.paper_width;
  $('#receipt').className=`paper${width}`;
  $('#receipt').innerHTML=receiptMarkup(order);
  window.print();
}
async function renderOrders(append=false){
  const data=await api(`/orders?${state.filter==='all'?'':'status='+state.filter}${append&&state.next?'&before='+state.next:''}`);
  if(state.view!=='orders')return;
  state.orders=append?[...state.orders,...data.orders]:data.orders;state.next=data.next;
  $('#content').innerHTML=`${heading('Pedidos','Da confirmação à retirada, tudo em um lugar.','<button class="secondary" data-action="refresh-orders">'+icon('refresh')+' Atualizar</button>')}<div class="toolbar"><select id="order-filter" aria-label="Filtrar pedidos"><option value="queue">Fila de preparo</option>${states.map(s=>`<option value="${s}" ${state.filter===s?'selected':''}>${labels[s]}</option>`).join('')}</select><span class="tag">Atualize para ver alterações de outros aparelhos</span></div><div class="orders-grid">${state.orders.length?state.orders.map(o=>`<article class="order-card"><header><div><span class="order-number">#${number(o.number)}</span><div class="order-time">${dateTime(o.created_at)}</div></div><span class="status ${o.status}">${labels[o.status]}</span></header><div class="order-lines">${o.items.map(i=>`<div class="order-line"><span>${i.quantity}×</span><span>${esc(i.name)}</span></div>`).join('')}<p class="small muted">${paymentLabels[o.payment]} · ${money(o.total_cents)}</p></div><footer>${o.status!=='delivered'?`<button class="primary" data-status-id="${o.id}" data-current-status="${o.status}">${({pending:'Iniciar preparo',preparing:'Marcar como pronto',ready:'Confirmar entrega'})[o.status]}</button>`:'<span class="small muted">Pedido entregue</span>'}<button class="quiet secondary" data-print="${o.id}" aria-label="Imprimir pedido ${number(o.number)}">${icon('print')}</button></footer></article>`).join(''):'<div class="empty-state"><div class="empty-illustration">'+icon('orders')+'</div><h2>Nenhum pedido por aqui</h2><p>As vendas finalizadas aparecem nesta fila.</p></div>'}</div>${data.next?'<button class="load-more" data-action="more-orders">Carregar mais pedidos</button>':''}`;
  $('#order-filter').insertAdjacentHTML('afterbegin','<option value="all">Todos os pedidos</option>');
  $('#order-filter').value=state.filter;$('#order-filter').addEventListener('change',async e=>{state.filter=e.target.value;await safe(()=>renderOrders());});
  enhanceOrdersV2();
}
function renderProducts(){
  $('#content').innerHTML=`${heading('Produtos','Um cardápio organizado, um caixa mais rápido.','<button class="primary" data-action="new-product">'+icon('plus')+' Novo produto</button>')}<div class="toolbar"><div class="search">${icon('search')}<input id="admin-search" type="search" placeholder="Buscar no cadastro…" aria-label="Buscar no cadastro"></div><button class="secondary" data-action="new-category">Nova categoria</button><button class="quiet secondary" data-action="refresh-products">${icon('refresh')} Atualizar</button></div><div class="panel table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Situação</th><th></th></tr></thead><tbody id="products-body"></tbody></table></div>`;
  productRows();$('#admin-search').addEventListener('input',e=>productRows(e.target.value));
}
function productRows(search=''){$('#products-body').innerHTML=state.products.filter(p=>p.name.toLowerCase().includes(search.toLowerCase())).map(p=>`<tr><td><strong>${esc(p.name)}</strong><div class="small muted">Ordem ${p.display_order||0}</div></td><td>${esc(state.categories.find(c=>c.id===p.category_id)?.name)}</td><td>${money(p.price_cents)}</td><td><span class="status ${p.active&&p.available?'ready':'delivered'}">${!p.active?'Desativado':p.available?'Ativo':'Indisponível'}</span></td><td><button class="quiet secondary" data-edit="${p.id}">${icon('edit')} Editar</button></td></tr>`).join('')||'<tr><td colspan="5">Nenhum produto encontrado.</td></tr>';}
function productDialog(id){
  const p=state.products.find(p=>p.id===id)||{name:'',price_cents:0,active:true,category_id:state.categories[0]?.id};
  showDialog(`${modalHeading(id?'Editar produto':'Novo produto')}<form id="product-form"><label class="field"><span>Nome do produto</span><input name="name" value="${esc(p.name)}" required maxlength="100"></label><label class="field"><span>Categoria</span><select name="category_id" required>${state.categories.map(c=>`<option value="${c.id}" ${p.category_id===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>Preço (R$)</span><input name="price" inputmode="decimal" value="${p.price_cents?(p.price_cents/100).toFixed(2).replace('.',','):''}" required placeholder="0,00"></label><label class="check"><input name="active" type="checkbox" ${p.active?'checked':''}><span>Disponível para venda</span></label><p class="error" id="form-error"></p><div class="dialog-actions"><button type="button" class="quiet" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Salvar produto</button></div></form>`);
  $('#product-form').addEventListener('submit',async e=>{
    e.preventDefault();const f=new FormData(e.target),price=parseMoney(f.get('price'));if(!price||price>10000000){$('#form-error').textContent='Informe um preço entre R$ 0,01 e R$ 100.000,00.';return;}
    const button=$('[type=submit]',e.target);button.disabled=true;
    try{await post('/products'+(id?'/'+id:''),{name:f.get('name'),category_id:Number(f.get('category_id')),price_cents:price,active:f.has('active'),available:f.has('available'),display_order:Number(f.get('display_order')||0)},id?'PATCH':'POST');await catalog();modal.close();renderProducts();toast('Produto salvo.');}
    catch(error){$('#form-error').textContent=error.message;button.disabled=false;}
  });
  mountProductV2(p,id);
}
function categoryDialog(){
  showDialog(`${modalHeading('Nova categoria')}<form id="category-form"><label class="field"><span>Nome da categoria</span><input name="name" required maxlength="50" placeholder="Ex.: Sobremesas"></label><p id="form-error" class="error"></p><div class="dialog-actions"><button type="button" class="quiet" data-action="close-modal">Cancelar</button><button class="primary" type="submit">Criar categoria</button></div></form>`);
  $('#category-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('[type=submit]',e.target);b.disabled=true;try{await post('/categories',{name:new FormData(e.target).get('name')});await catalog();modal.close();renderProducts();toast('Categoria criada.');}catch(error){$('#form-error').textContent=error.message;b.disabled=false;}});
}
let reportDate='',reportNext=null,reportOrders=[];
async function renderReports(append=false){
  reportDate=reportDate||today();const d=await api('/reports?date='+reportDate+(append&&reportNext?'&before='+reportNext:''));if(state.view!=='reports')return;
  reportOrders=append?[...reportOrders,...d.orders]:d.orders;reportNext=d.next;
  const sum=Number(d.totals.total_cents),ticket=d.totals.count?Math.round(sum/d.totals.count):0;
  $('#content').innerHTML=`${heading('Relatório do caixa','Acompanhe suas vendas com clareza.','<button class="secondary" data-action="refresh-reports">'+icon('refresh')+' Atualizar</button>')}<div class="toolbar"><label class="small" for="report-date">Data das vendas</label><input id="report-date" type="date" value="${reportDate}"><span class="tag">${esc(d.timezone)}</span></div><div class="stats"><div class="stat highlight"><small>Total vendido</small><strong>${money(sum)}</strong></div><div class="stat"><small>Pedidos no dia</small><strong>${d.totals.count}</strong></div><div class="stat"><small>Ticket médio</small><strong>${money(ticket)}</strong></div><div class="stat"><small>Período</small><strong>${reportDate.split('-').reverse().slice(0,2).join('/')}</strong></div></div><div class="stats">${Object.entries(paymentLabels).map(([key,label])=>`<div class="stat"><small>${label}</small><strong>${money(d.payments.find(p=>p.payment===key)?.total_cents||0)}</strong></div>`).join('')}</div><div class="panel"><h2>Histórico de vendas <span class="count-label">· ${d.totals.count} pedidos</span></h2><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Horário</th><th>Pagamento</th><th>Operador</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${reportOrders.map(o=>`<tr><td><strong>#${number(o.number)}</strong></td><td>${time(o.created_at)}</td><td>${paymentLabels[o.payment]}</td><td>${esc(o.operator_name)}</td><td>${money(o.total_cents)}</td><td><span class="status ${o.status}">${labels[o.status]}</span></td><td><button class="quiet secondary" data-print="${o.id}" aria-label="Reimprimir ${number(o.number)}">${icon('print')}</button></td></tr>`).join('')||'<tr><td colspan="7">Nenhuma venda neste dia.</td></tr>'}</tbody></table></div></div>${reportNext?'<button class="load-more" data-action="more-reports">Carregar mais vendas</button>':''}`;
  $('#report-date').addEventListener('change',async e=>{if(!e.target.value)return;reportDate=e.target.value;await safe(()=>renderReports());});
  enhanceHistoryRows();
}
function renderSettings(){
  const s=state.settings;
  $('#content').innerHTML=`${heading('Configurações','Ajustes simples para a rotina da sua equipe.')}<div class="settings-grid"><form class="panel" id="settings-form"><h2>Loja e impressão</h2><label class="field"><span>Nome da petiscaria</span><input name="store_name" value="${esc(s.store_name)}" required maxlength="80"><small>Exibido no sistema e nas comandas.</small></label><label class="field"><span>Largura do papel</span><select name="paper_width"><option value="80" ${s.paper_width===80?'selected':''}>80 mm</option><option value="58" ${s.paper_width===58?'selected':''}>58 mm</option></select></label><label class="field"><span>Fuso horário dos relatórios</span><select name="timezone">${[...new Set(['America/Sao_Paulo','America/Manaus','America/Rio_Branco','America/Noronha',s.timezone])].map(t=>`<option ${s.timezone===t?'selected':''}>${esc(t)}</option>`).join('')}</select></label><label class="check"><input name="auto_print" type="checkbox" ${s.auto_print?'checked':''}><span>Abrir impressão após salvar a venda</span></label><p id="settings-error" class="error"></p><button class="primary" type="submit">Salvar configurações</button></form><div class="panel"><h2>Preparar a impressora</h2><p class="info">Instale a impressora térmica no computador ou use uma impressora compatível com a impressão do celular. Selecione o papel de 58 ou 80 mm no sistema e no driver.</p><p class="info">Na janela de impressão, use escala de 100%, sem cabeçalhos e rodapés. Ajuste as margens conforme o driver da impressora.</p><button class="secondary" data-action="test-print">${icon('print')} Imprimir teste</button><p class="info">O navegador sempre apresenta a janela de impressão. Cancelá-la não cancela uma venda.</p><h2>Contas da equipe</h2><p class="info">O administrador gerencia produtos, configurações e relatórios. O operador acessa o caixa, a fila e a reimpressão.</p><p class="info">As contas são criadas, desativadas e têm suas senhas redefinidas no servidor. Consulte as instruções de implantação entregues com o sistema.</p></div></div>`;
  mountSettingsV2();
  $('#settings-form').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target),b=$('[type=submit]',e.target);b.disabled=true;try{state.settings=await post('/settings',{store_name:f.get('store_name'),paper_width:Number(f.get('paper_width')),timezone:f.get('timezone'),auto_print:f.has('auto_print'),...settingsV2Payload(f)},'PATCH');applyTheme();shell();toast('Configurações salvas.');}catch(error){$('#settings-error').textContent=error.message;b.disabled=false;}});
}
async function safe(fn){try{await fn();}catch(error){toast(error.message);}}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.view){if(b.dataset.view==='pickup'){window.open('/retirada','_blank','noopener');return;}state.view=b.dataset.view;shell();return;}
  if(b.dataset.category){state.category=Number(b.dataset.category);renderCashier();return;}
  if(b.dataset.product){if(state.pending)return;const p=state.products.find(p=>p.id===Number(b.dataset.product)),item=state.cart.find(i=>i.product_id===p.id);if(item&&item.price_cents!==p.price_cents){toast('O preço mudou. Remova o item e adicione novamente.');return;}if(item){if(item.quantity>=99){toast('Limite de 99 unidades por produto.');return;}item.quantity++;}else state.cart.push({product_id:p.id,name:p.name,price_cents:p.price_cents,quantity:1});cartChanged();return;}
  if(b.dataset.qty){if(state.pending)return;const item=state.cart.find(i=>i.product_id===Number(b.dataset.qty));item.quantity=Math.min(99,item.quantity+Number(b.dataset.delta));state.cart=state.cart.filter(i=>i.quantity>0);cartChanged();return;}
  if(b.dataset.payment){checkoutPayment=b.dataset.payment;modal.querySelectorAll('[data-payment]').forEach(el=>el.classList.toggle('active',el.dataset.payment===checkoutPayment));$('#cash-field').hidden=checkoutPayment!=='cash';$('#payment-confirmed').checked=false;validateCheckout();return;}
  if(b.dataset.edit){productDialog(Number(b.dataset.edit));return;}
  if(b.dataset.print){await safe(async()=>{b.disabled=true;try{const {order}=await api('/orders/'+b.dataset.print);printOrder(order);}finally{b.disabled=false;}});return;}
  if(b.dataset.statusId){await safe(async()=>{b.disabled=true;try{await post('/orders/'+b.dataset.statusId+'/status',{expected_status:b.dataset.currentStatus,status:states[states.indexOf(b.dataset.currentStatus)+1]},'PATCH');await renderOrders();}finally{b.disabled=false;}});return;}
  await safe(async()=>{switch(b.dataset.action){
    case 'logout':if(state.pending){toast('Verifique a venda pendente antes de sair.');return;}await post('/logout',{});state.cart=[];state.view='cashier';login();break;
    case 'close-modal':if(!state.busy)modal.close();break;
    case 'checkout':checkout();break;
    case 'confirm-sale':await confirmSale();break;
    case 'show-cart':$('#cart').scrollIntoView({block:'start'});break;
    case 'clear-cart':showDialog(`${modalHeading('Limpar pedido?')}<p class="info">Os itens deste pedido serão removidos. Nenhuma venda será registrada.</p><div class="dialog-actions"><button data-action="close-modal">Voltar</button><button class="danger" data-action="confirm-clear">Limpar pedido</button></div>`);break;
    case 'confirm-clear':state.cart=[];state.notes='';state.discount=0;persist();modal.close();renderCashier();break;
    case 'refresh-catalog':await catalog();renderCashier();toast('Catálogo atualizado. Revise os preços do pedido antes de finalizar.');break;
    case 'refresh-orders':await renderOrders();break;
    case 'more-orders':await renderOrders(true);break;
    case 'new-product':productDialog();break;
    case 'new-category':categoryDialog();break;
    case 'refresh-products':await catalog();renderProducts();break;
    case 'refresh-reports':await renderReports();break;
    case 'more-reports':await renderReports(true);break;
    case 'reload':await renderView();break;
    case 'test-print':printOrder({number:'TESTE',created_at:new Date().toISOString(),total_cents:3700,payment:'pix',received_cents:3700,items:[{name:'Batata frita',quantity:1,price_cents:2500},{name:'Refrigerante',quantity:2,price_cents:600}]});break;
  }});
});
modal.addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
window.addEventListener('beforeunload',e=>{if(state.busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('offline',()=>toast('Sem conexão. O pedido continua nesta aba; finalize quando a conexão voltar.'));
