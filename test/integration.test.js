import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fixture,client,password } from './fixture.js';
let f,admin,operator,product;
before(async()=>{f=await fixture();admin=await client(f.base);operator=await client(f.base,'caixa');product=(await admin('/api/catalog')).data.products[0];});
after(async()=>{await f?.close();});
const sale=(overrides={})=>({request_key:randomUUID(),payment:'pix',received_cents:product.price_cents,expected_total_cents:product.price_cents,items:[{product_id:product.id,quantity:1,price_cents:product.price_cents}],...overrides});
test('rotas protegidas, cookie seguro, origem e CSRF',async()=>{
  assert.equal((await fetch(f.base+'/api/catalog')).status,401);
  const r=await fetch(f.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:3000'},body:JSON.stringify({username:'admin',password})});
  assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  assert.equal((await admin('/api/orders',{method:'POST',data:sale(),headers:{origin:'https://outro.example'}})).status,403);
  assert.equal((await admin('/api/orders',{method:'POST',data:sale(),headers:{'X-CSRF-Token':'errado'}})).status,403);
  assert.equal((await operator('/api/settings',{method:'PATCH',data:{}})).status,403);
  assert.equal((await operator('/api/reports?date=2026-11-18')).status,403);
  assert.equal((await operator('/api/products',{method:'POST',data:{}})).status,403);
});
test('venda mantém valores em centavos e cópia histórica dos itens',async()=>{
  const r=await operator('/api/orders',{method:'POST',data:sale({payment:'cash',received_cents:2000})});
  assert.equal(r.status,201);assert.equal(r.data.order.total_cents,1200);assert.equal(r.data.order.received_cents,2000);assert.equal(r.data.order.status,'pending');assert.equal(r.data.order.items[0].name,product.name);
  assert.equal((await admin('/api/orders/'+r.data.order.id)).data.order.items[0].price_cents,1200);
});
test('repetição e tentativas simultâneas salvam uma única venda',async()=>{
  const payload=sale();
  const responses=await Promise.all(Array.from({length:8},()=>admin('/api/orders',{method:'POST',data:payload})));
  assert.equal(responses.filter(r=>r.status===201).length,1);assert.ok(responses.every(r=>[200,201].includes(r.status)));
  assert.equal(new Set(responses.map(r=>r.data.order.number)).size,1);
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM orders WHERE request_key=$1',[payload.request_key])).rows[0].n),1);
  assert.equal((await admin('/api/orders',{method:'POST',data:{...payload,payment:'debit'}})).status,409);
  assert.equal((await operator('/api/orders',{method:'POST',data:payload})).status,409);
});
test('senhas únicas para pedidos distintos em vários dispositivos',async()=>{
  const responses=await Promise.all(Array.from({length:12},(_,i)=>(i%2?admin:operator)('/api/orders',{method:'POST',data:sale()})));
  assert.ok(responses.every(r=>r.status===201));assert.equal(new Set(responses.map(r=>r.data.order.number)).size,12);
});
test('preço adulterado, total incorreto e dinheiro insuficiente são rejeitados',async()=>{
  const before=Number((await f.db.query('SELECT count(*) AS n FROM orders')).rows[0].n);
  for(const payload of [sale({items:[{product_id:product.id,quantity:1,price_cents:1}]}),sale({expected_total_cents:1}),sale({payment:'cash',received_cents:100}),sale({items:[{product_id:product.id,quantity:-1,price_cents:1200}]}),sale({items:[{product_id:product.id,quantity:1,price_cents:1200},{product_id:product.id,quantity:1,price_cents:1200}]})])assert.ok([400,409].includes((await admin('/api/orders',{method:'POST',data:payload})).status));
  assert.equal(Number((await f.db.query('SELECT count(*) AS n FROM orders')).rows[0].n),before);
});
test('fila avança um estado de cada vez e bloqueia ação desatualizada',async()=>{
  const {data:{order}}=await admin('/api/orders',{method:'POST',data:sale()});
  assert.equal((await operator(`/api/orders/${order.id}/status`,{method:'PATCH',data:{expected_status:'pending',status:'ready'}})).status,400);
  for(const [from,to] of [['pending','preparing'],['preparing','ready'],['ready','delivered']])assert.equal((await operator(`/api/orders/${order.id}/status`,{method:'PATCH',data:{expected_status:from,status:to}})).status,200);
  assert.equal((await operator(`/api/orders/${order.id}/status`,{method:'PATCH',data:{expected_status:'pending',status:'preparing'}})).status,409);
});
test('cadastros, produto desativado e preservação de preço histórico',async()=>{
  const saved=(await admin('/api/orders',{method:'POST',data:sale()})).data.order;
  assert.equal((await admin('/api/products/'+product.id,{method:'PATCH',data:{...product,price_cents:1500,active:false}})).status,200);
  assert.equal((await operator('/api/catalog')).data.products.some(p=>p.id===product.id),false);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale()})).status,409);
  const original=(await admin('/api/orders/'+saved.id)).data.order;
  assert.equal(original.items[0].price_cents,1200);assert.equal(original.total_cents,1200);
  await admin('/api/products/'+product.id,{method:'PATCH',data:product});
  const cat=await admin('/api/categories',{method:'POST',data:{name:'Sobremesas'}});assert.equal(cat.status,201);
  assert.equal((await admin('/api/categories',{method:'POST',data:{name:'Sobremesas'}})).status,409);
  assert.equal((await admin('/api/products',{method:'POST',data:{name:'Doce',category_id:cat.data.id,price_cents:750,active:true}})).status,201);
});
test('relatório soma vendas por pagamento no fuso da loja e pagina histórico',async()=>{
  const {data:{settings}}=await admin('/api/catalog');
  // en-CA é yyyy-mm-dd; o fuso padrão é o da loja.
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:settings.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const day=['year','month','day'].map(k=>parts.find(p=>p.type===k).value).join('-');
  const report=await admin('/api/reports?date='+day);assert.equal(report.status,200);
  const expected=(await f.db.query('SELECT count(*)::integer AS n,sum(total_cents) AS total FROM orders')).rows[0];
  assert.equal(report.data.totals.count,expected.n);assert.equal(Number(report.data.totals.total_cents),Number(expected.total));
  assert.equal(report.data.payments.reduce((s,p)=>s+Number(p.total_cents),0),Number(expected.total));
  assert.equal((await admin('/api/reports?date=2026-02-30')).status,400);
  assert.equal((await admin('/api/orders?before=invalid')).status,400);
});
test('configuração persiste largura, nome e impressão automática',async()=>{
  const r=await admin('/api/settings',{method:'PATCH',data:{store_name:'Petiscaria Teste',paper_width:58,auto_print:true,timezone:'America/Sao_Paulo'}});assert.equal(r.status,200);
  const s=(await operator('/api/catalog')).data.settings;assert.equal(s.paper_width,58);assert.equal(s.auto_print,true);
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{...s,paper_width:20}})).status,400);
});
test('limites de dia no fuso e paginação sem repetir pedidos',async()=>{
  const insert=async stamp=>f.db.query("INSERT INTO orders(user_id,request_key,request_hash,total_cents,payment,received_cents,created_at) VALUES(1,$1,'fixture',100,'pix',100,$2)",[randomUUID(),stamp]);
  await insert('2020-06-01T02:59:59Z');
  for(let i=0;i<55;i++)await insert('2020-06-01T03:00:00Z');
  await insert('2020-06-02T02:59:59Z');await insert('2020-06-02T03:00:00Z');
  const first=await admin('/api/reports?date=2020-06-01');assert.equal(first.data.totals.count,56);assert.equal(Number(first.data.totals.total_cents),5600);assert.equal(first.data.orders.length,50);assert.ok(first.data.next);
  const second=await admin('/api/reports?date=2020-06-01&before='+first.data.next);assert.equal(second.data.orders.length,6);assert.equal(second.data.next,null);
  assert.equal(new Set([...first.data.orders,...second.data.orders].map(o=>o.id)).size,56);
  const queue=await operator('/api/orders?status=queue');assert.equal(queue.data.orders.length,50);assert.ok(queue.data.next);
});
test('logout revoga a sessão',async()=>{const account=await client(f.base,'caixa');assert.equal((await account('/api/logout',{method:'POST',data:{}})).status,200);assert.equal((await account('/api/session')).status,401);});
test('limite de login persiste no banco e mensagens não revelam contas',async()=>{
  const call=async password=>fetch(f.base+'/api/login',{method:'POST',headers:{origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({username:'inexistente',password})});
  for(let i=0;i<10;i++)assert.equal((await call('incorreta')).status,401);
  assert.equal((await call('incorreta')).status,429);
});
