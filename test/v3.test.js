import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture,client,password} from './fixture.js';
let f,admin,operator,other,combo,comboSale,held,shift,mixedSale,movement;
const item=(id=1,quantity=1,price=1200)=>({product_id:id,quantity,price_cents:price});
const sale=(extra={})=>({request_key:randomUUID(),payment:'pix',received_cents:1200,expected_total_cents:1200,items:[item()],...extra});
const mixed=()=>sale({payment:'mixed',received_cents:1700,payment_parts:[{payment:'cash',amount_cents:500,received_cents:1000},{payment:'pix',amount_cents:700}]});
before(async()=>{f=await fixture();admin=await client(f.base);operator=await client(f.base,'caixa');await f.db.query("INSERT INTO users(name,username,password_hash,role) SELECT 'Outro','outro',password_hash,'operator' FROM users WHERE id=2");other=await client(f.base,'outro');});
after(async()=>{await f?.close();});
test('combo é cadastrado em uma transação, com componentes individuais',async()=>{
  const r=await admin('/api/products',{method:'POST',data:{name:'Combo 01',category_id:1,price_cents:3500,active:true,available:true,is_combo:true,components:[{product_id:1,quantity:1},{product_id:2,quantity:2}]}});assert.equal(r.status,201);combo=r.data;
  const p=(await operator('/api/catalog')).data.products.find(p=>p.id===combo.id);assert.equal(p.components.length,2);assert.equal(p.price_cents,3500);assert.equal(p.is_combo,true);
  for(const components of [[{product_id:combo.id,quantity:1}],[{product_id:1,quantity:1},{product_id:1,quantity:2}]])assert.equal((await admin('/api/products',{method:'POST',data:{name:'Inválido',category_id:1,price_cents:100,active:true,is_combo:true,components}})).status,400);
  assert.equal((await f.db.query("SELECT count(*) AS n FROM products WHERE name='Inválido'")).rows[0].n,0);
});
test('combo cobra só o preço único e congela composição e observação de item',async()=>{
  const r=await operator('/api/orders',{method:'POST',data:sale({expected_total_cents:7000,received_cents:9500,payment:'mixed',payment_parts:[{payment:'cash',amount_cents:2500,received_cents:5000},{payment:'pix',amount_cents:4500}],items:[{...item(combo.id,2,3500),combo_version:combo.combo_version,notes:'Sem cebola.'}],notes:'Retirada no balcão'})});assert.equal(r.status,201);comboSale=r.data.order;
  assert.equal(comboSale.total_cents,7000);assert.equal(comboSale.received_cents-comboSale.total_cents,2500);assert.equal(comboSale.items.length,1);assert.equal(comboSale.items[0].combo_components[1].quantity,2);assert.equal(comboSale.items[0].notes,'Sem cebola.');
  await admin('/api/products/2',{method:'PATCH',data:{name:'Nome atualizado',price_cents:900}});assert.equal((await admin('/api/orders/'+comboSale.id)).data.order.items[0].combo_components[1].name,'Coxinha da casa');
});
test('esgotar componente bloqueia o combo no catálogo e no servidor',async()=>{
  assert.equal((await admin('/api/products/2/availability',{method:'POST',data:{available:false}})).status,200);
  assert.equal((await operator('/api/catalog')).data.products.find(p=>p.id===combo.id).available,false);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale({items:[item(combo.id,1,3500)],received_cents:3500,expected_total_cents:3500})})).status,409);
  assert.equal((await operator('/api/products/2/availability',{method:'POST',data:{available:true}})).status,403);
  await admin('/api/products/2/availability',{method:'POST',data:{available:true}});
});
test('alteração de composição exige revisão e preço adulterado é rejeitado',async()=>{
  const old=combo.combo_version;
  const r=await admin('/api/products/'+combo.id,{method:'PATCH',data:{components:[{product_id:1,quantity:2},{product_id:2,quantity:2}]}});assert.equal(r.status,200);combo=r.data;
  assert.equal((await operator('/api/orders',{method:'POST',data:sale({items:[{...item(combo.id,1,3500),combo_version:old}],received_cents:3500,expected_total_cents:3500})})).status,409);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale({items:[item(combo.id,1,1)]})})).status,409);
});
test('pagamento misto rejeita soma incorreta, duplicação de método e troco em cartão',async()=>{
  const cases=[{payment:'mixed',payment_parts:[{payment:'cash',amount_cents:400},{payment:'pix',amount_cents:700}]},{payment:'mixed',payment_parts:[{payment:'pix',amount_cents:600},{payment:'pix',amount_cents:600}]},{payment:'mixed',payment_parts:[{payment:'credit',amount_cents:600,received_cents:700},{payment:'pix',amount_cents:600}]},{payment:'mixed'}, {payment:'mixed',payment_parts:[{payment:'cash',amount_cents:1200}]}];
  for(const extra of cases)assert.equal((await operator('/api/orders',{method:'POST',data:sale(extra)})).status,400);
});
test('guardar e repetir confirmação não cria venda nem consome senha',async()=>{
  const count=Number((await f.db.query('SELECT count(*) AS n FROM orders')).rows[0].n);const payload={items:[{...item(),notes:'Sem sal.'}],notes:'Aguardando cliente',discount_cents:0};
  const d={id:randomUUID(),label:'Pedido aguardando',payload};const r=await operator('/api/held',{method:'POST',data:d});assert.equal(r.status,200);held=r.data.held;
  assert.equal((await operator('/api/held',{method:'POST',data:{...d,payload:{discount_cents:0,notes:payload.notes,items:payload.items}}})).status,200);
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM orders')).rows[0].n),count);
  assert.equal((await other('/api/held/'+held.id)).status,403);
  assert.equal((await operator('/api/held',{method:'POST',data:{...d,label:'Outra',expected_version:99}})).status,409);
});
test('duas telas retomando o mesmo pedido geram somente uma venda',async()=>{
  const payload=sale({suspended_id:held.id});const results=await Promise.all(Array.from({length:8},()=>operator('/api/orders',{method:'POST',data:{...payload,request_key:randomUUID()}})));
  assert.equal(results.filter(r=>r.status===201).length,1);assert.equal(results.filter(r=>r.status===409).length,7);
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM orders WHERE suspended_id=$1',[held.id])).rows[0].n),1);
  assert.equal((await operator('/api/held/'+held.id)).status,409);
});
test('descarte de suspenso é lógico e impede finalização',async()=>{
  const id=randomUUID();await operator('/api/held',{method:'POST',data:{id,label:'Descartar',payload:{items:[item()],notes:'',discount_cents:0}}});
  assert.equal((await operator('/api/held/'+id+'/discard',{method:'POST',data:{}})).status,200);assert.ok((await f.db.query('SELECT discarded_at FROM held_orders WHERE id=$1',[id])).rows[0].discarded_at);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale({suspended_id:id})})).status,409);
});
test('abertura, suprimento e sangria possuem permissão e idempotência',async()=>{
  shift=(await admin('/api/cash/open',{method:'POST',data:{opening_cents:10000,request_key:randomUUID()}})).data.cash;
  const base={cash_session_id:shift.id,kind:'in',amount_cents:5000,reason:'Troco inicial',request_key:randomUUID()};assert.equal((await operator('/api/cash/movements',{method:'POST',data:base})).status,403);
  const results=await Promise.all(Array.from({length:6},()=>admin('/api/cash/movements',{method:'POST',data:base})));assert.ok(results.every(r=>r.status===200));assert.equal(new Set(results.map(r=>r.data.movement.id)).size,1);
  movement=(await admin('/api/cash/movements',{method:'POST',data:{...base,request_key:randomUUID(),kind:'out',amount_cents:2000,reason:'Retirada autorizada'}})).data.movement;
  assert.equal((await admin('/api/cash/movements',{method:'POST',data:{...base,request_key:randomUUID(),kind:'out',amount_cents:999999}})).status,409);
  assert.equal((await admin('/api/cash')).data.current.expected_cents,13000);
});
test('fechamento usa o líquido em dinheiro do pagamento misto e as movimentações',async()=>{
  const payload=mixed();const r=await operator('/api/orders',{method:'POST',data:payload});assert.equal(r.status,201);mixedSale=r.data.order;
  assert.equal((await operator('/api/orders',{method:'POST',data:payload})).status,200);
  const current=(await admin('/api/cash')).data.current;assert.equal(current.summary.count,1);assert.equal(current.summary.total_cents,1200);assert.equal(current.expected_cents,13500);assert.equal(current.summary.movements.in_cents,5000);assert.equal(current.summary.movements.out_cents,2000);
  const closed=await admin('/api/cash/'+shift.id+'/close',{method:'POST',data:{counted_cents:13500}});assert.equal(Number(closed.data.cash.difference_cents),0);assert.equal(closed.data.cash.closing_summary.payments.length,2);
  assert.equal((await admin('/api/cash/movements',{method:'POST',data:{cash_session_id:shift.id,kind:'in',amount_cents:100,reason:'Após fechar',request_key:randomUUID()}})).status,409);
});
test('relatórios somam parcelas reais e também vendas legadas sem parcelas',async()=>{
  await f.db.query("INSERT INTO orders(user_id,request_key,request_hash,total_cents,payment,received_cents) VALUES(1,$1,'legacy',600,'debit',600)",[randomUUID()]);
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const day=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
  const d=(await admin('/api/reports?date='+day)).data;assert.equal(d.payments.reduce((s,p)=>s+Number(p.total_cents),0),Number(d.totals.total_cents));assert.equal(Number(d.payments.find(p=>p.payment==='debit').total_cents),600);assert.equal(d.payments.some(p=>p.payment==='mixed'),false);
});
test('limites de atenção e atraso são configuráveis e validados',async()=>{
  assert.equal((await operator('/api/settings',{method:'PATCH',data:{attention_minutes:5,late_minutes:15}})).status,403);
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{attention_minutes:20,late_minutes:10}})).status,400);
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{attention_minutes:5,late_minutes:15}})).status,200);
  assert.equal((await operator('/api/catalog')).data.settings.attention_minutes,5);
});
test('backup exige administrador, pagina a leitura e exclui credenciais',async()=>{
  assert.equal((await operator('/api/backup')).status,403);assert.equal((await fetch(f.base+'/api/backup')).status,401);
  await f.db.query("INSERT INTO audit_log(user_id,action,entity_id) SELECT 1,'fixture',i::text FROM generate_series(1,250) i");
  const login=await fetch(f.base+'/api/login',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({username:'admin',password})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const response=await fetch(f.base+'/api/backup',{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/\.ndjson/);const rows=(await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).complete,true);assert.equal(rows[0].credentials_included,false);assert.ok(rows.filter(r=>r.table==='audit_log').length>=2);
  for(const row of rows){if(row.rows)assert.ok(row.rows.length<=200||row.type==='sequences');assert.ok(!['sessions','login_attempts'].includes(row.table));if(row.table==='users')for(const account of row.rows)assert.equal('password_hash'in account,false);}
});
test('PWA entrega manifesto, ícones e worker limitado a estáticos',async()=>{
  const m=await(await fetch(f.base+'/manifest.webmanifest')).json();assert.equal(m.display,'standalone');assert.equal(m.icons.length,2);const icon=Buffer.from(await(await fetch(f.base+'/icon192.png')).arrayBuffer());assert.deepEqual([...icon.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  const worker=await(await fetch(f.base+'/sw.js')).text();assert.match(worker,/pathname.startsWith\('\/api\/'\)/);assert.equal((await fetch(f.base+'/offline.html')).status,200);
  assert.equal((await fetch(f.base+'/api/orders/1',{method:'DELETE'})).status,405);
});
