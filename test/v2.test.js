import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { fixture,client } from './fixture.js';
import { hash } from '../src/security.js';
import { contrast } from '../src/v2.js';
let f,admin,operator,product,shift,cashOrder,pixOrder,debitOrder;
before(async()=>{f=await fixture();admin=await client(f.base);operator=await client(f.base,'caixa');product=(await admin('/api/catalog')).data.products[0];});
after(async()=>{await f?.close();});
const sale=(extra={})=>({request_key:randomUUID(),payment:'pix',received_cents:1200,expected_total_cents:1200,items:[{product_id:product.id,quantity:1,price_cents:1200}],...extra});
test('migração aditiva preserva venda, senha, itens e hash de senha da versão 1',async()=>{
  const engine=new PGlite();try{
    await engine.exec(await readFile(new URL('../db/001-init.sql',import.meta.url),'utf8'));
    await engine.query("INSERT INTO users(name,username,password_hash,role) VALUES('Original','original','hash-preservado','admin')");
    await engine.query("INSERT INTO categories(name) VALUES('Original')");await engine.query("INSERT INTO products(category_id,name,price_cents) VALUES(1,'Original',2500)");
    await engine.query("INSERT INTO orders(user_id,request_key,request_hash,total_cents,payment,received_cents) VALUES(1,$1,'original',2500,'pix',2500)",[randomUUID()]);
    await engine.query("INSERT INTO order_items(order_id,product_id,name,quantity,price_cents) VALUES(1,1,'Nome histórico',1,2500)");
    const original=(await engine.query('SELECT * FROM orders')).rows[0];await engine.exec(await readFile(new URL('../db/002-v2.sql',import.meta.url),'utf8'));
    const migrated=(await engine.query('SELECT * FROM orders')).rows[0];for(const key of Object.keys(original))assert.deepEqual(migrated[key],original[key]);
    assert.equal((await engine.query('SELECT name FROM order_items')).rows[0].name,'Nome histórico');assert.equal((await engine.query('SELECT password_hash FROM users')).rows[0].password_hash,'hash-preservado');assert.equal(migrated.cash_session_id,null);
  }finally{await engine.close();}
});
test('venda pendente de 1.0 mantém a mesma impressão digital na versão 2.0',async()=>{
  const d=sale(),fingerprint=hash(JSON.stringify({items:d.items,payment:d.payment,received:d.received_cents,total:d.expected_total_cents}));
  const row=(await f.db.query('INSERT INTO orders(user_id,request_key,request_hash,total_cents,payment,received_cents) VALUES(1,$1,$2,1200,$3,1200) RETURNING id',[d.request_key,fingerprint,d.payment])).rows[0];
  assert.equal((await admin('/api/orders',{method:'POST',data:d})).data.order.id,row.id);
});
test('abertura obrigatória é configurável e o operador não pode conceder desconto',async()=>{
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{require_open_cash:true}})).status,200);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale()})).status,409);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale({discount_cents:100})})).status,403);
});
test('abertura idempotente e um único caixa compartilhado',async()=>{
  const data={opening_cents:10000,request_key:randomUUID()};
  const r=await operator('/api/cash/open',{method:'POST',data});assert.equal(r.status,200);shift=r.data.cash;
  assert.equal((await operator('/api/cash/open',{method:'POST',data})).data.cash.id,shift.id);
  assert.equal((await admin('/api/cash/open',{method:'POST',data:{...data,request_key:randomUUID()}})).status,409);
});
test('dinheiro, Pix, débito, crédito, desconto e observações são persistidos',async()=>{
  cashOrder=(await admin('/api/orders',{method:'POST',data:sale({payment:'cash',received_cents:2000,notes:'Sem cebola'})})).data.order;
  pixOrder=(await operator('/api/orders',{method:'POST',data:sale()})).data.order;
  debitOrder=(await admin('/api/orders',{method:'POST',data:sale({payment:'debit',discount_cents:200,expected_total_cents:1000,received_cents:1000})})).data.order;
  const credit=await admin('/api/orders',{method:'POST',data:sale({payment:'credit'})});assert.equal(credit.status,201);
  assert.equal(cashOrder.notes,'Sem cebola');assert.equal(cashOrder.received_cents-cashOrder.total_cents,800);assert.equal(cashOrder.cash_session_id,shift.id);assert.equal(debitOrder.subtotal_cents,1200);assert.equal(debitOrder.total_cents,1000);
  const current=(await admin('/api/cash')).data.current;assert.equal(current.summary.total_cents,4600);assert.equal(current.expected_cents,11200);assert.equal(current.summary.payments.length,4);
});
test('cancelamento exige administrador, preserva o registro e atualiza o dinheiro esperado',async()=>{
  assert.equal((await operator('/api/orders/'+cashOrder.id+'/cancel',{method:'POST',data:{reason:'Teste'}})).status,403);
  assert.equal((await admin('/api/orders/'+cashOrder.id+'/cancel',{method:'POST',data:{reason:'Cliente desistiu'}})).status,200);
  const saved=(await admin('/api/orders/'+cashOrder.id)).data.order;assert.ok(saved.cancelled_at);assert.equal(saved.total_cents,1200);assert.equal(saved.items.length,1);
  assert.equal((await admin('/api/cash')).data.current.expected_cents,10000);
  assert.equal((await operator('/api/orders/'+cashOrder.id+'/status',{method:'PATCH',data:{expected_status:'pending',status:'preparing'}})).status,409);
});
test('histórico do operador se limita às próprias vendas e permite filtros',async()=>{
  const own=(await operator('/api/history')).data;assert.ok(own.orders.every(o=>o.user_id===2));assert.equal(own.orders.length,1);
  assert.equal((await admin('/api/history?number='+cashOrder.number)).data.orders[0].cancel_reason,'Cliente desistiu');
  assert.equal((await admin('/api/history?date=2026-02-30')).status,400);
});
test('retirada pública expõe somente senhas e metadados públicos',async()=>{
  for(const [from,to]of [['pending','preparing'],['preparing','ready']])assert.equal((await operator('/api/orders/'+debitOrder.id+'/status',{method:'PATCH',data:{expected_status:from,status:to}})).status,200);
  const response=await fetch(f.base+'/api/pickup');assert.equal(response.status,200);const d=await response.json();assert.ok(d.ready.some(o=>o.number===debitOrder.number));
  const json=JSON.stringify(d);for(const forbidden of ['total_cents','payment','user_id','operator_name','notes','price_cents','Sem cebola'])assert.equal(json.includes(forbidden),false);
  await operator('/api/orders/'+debitOrder.id+'/status',{method:'PATCH',data:{expected_status:'ready',status:'delivered'}});
  const after=await(await fetch(f.base+'/api/pickup')).json();assert.equal(after.ready.some(o=>o.number===debitOrder.number),false);assert.ok(after.recent.some(o=>o.number===debitOrder.number));
});
test('indisponibilidade e exclusão lógica bloqueiam vendas sem apagar itens históricos',async()=>{
  assert.equal((await admin('/api/products/'+product.id,{method:'PATCH',data:{available:false,display_order:9}})).status,200);
  assert.equal((await operator('/api/orders',{method:'POST',data:sale()})).status,409);
  assert.equal((await admin('/api/products/'+product.id+'/archive',{method:'POST',data:{}})).status,200);
  assert.equal((await admin('/api/catalog')).data.products.some(p=>p.id===product.id),false);
  assert.equal((await admin('/api/orders/'+pixOrder.id)).data.order.items[0].name,product.name);
});
test('fechamento calcula diferença, preserva resumo e aceita repetição segura',async()=>{
  const d={counted_cents:9900};const closed=await operator('/api/cash/'+shift.id+'/close',{method:'POST',data:d});assert.equal(closed.status,200);assert.equal(Number(closed.data.cash.expected_cents),10000);assert.equal(Number(closed.data.cash.difference_cents),-100);assert.equal(closed.data.cash.closing_summary.total_cents,3400);
  assert.equal((await operator('/api/cash/'+shift.id+'/close',{method:'POST',data:d})).status,200);
  assert.equal((await operator('/api/cash/'+shift.id+'/close',{method:'POST',data:{counted_cents:10000}})).status,409);
  const afterClose=await admin('/api/orders/'+pixOrder.id+'/cancel',{method:'POST',data:{reason:'Após fechamento'}});assert.equal(afterClose.status,200);assert.equal(afterClose.data.closed_cash_preserved,true);
  assert.equal((await admin('/api/cash')).data.closed[0].closing_summary.total_cents,3400);
  assert.equal((await admin('/api/cash')).data.current,null);
});
test('personalização valida imagem, limites e cor, com tema público seguro',async()=>{
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{primary_color:'red;bad'}})).status,400);
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{logo_data_url:'data:image/svg+xml;base64,PHN2Zz4='}})).status,400);
  assert.equal((await admin('/api/settings',{method:'PATCH',data:{primary_color:'#ffffff',receipt_message:'Aguarde no balcão',business_info:'Loja 1'}})).status,200);
  const theme=await fetch(f.base+'/theme.css');assert.match(await theme.text(),/--on-green:#000000/);assert.equal(contrast('#000000'),'#ffffff');
  assert.equal((await fetch(f.base+'/retirada')).status,200);
});
