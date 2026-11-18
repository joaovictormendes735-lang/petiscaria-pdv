import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes,randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { createApp } from '../src/app.js';
import { passwordHash } from '../src/security.js';

// Homologação com conexões PostgreSQL independentes, em esquema isolado.
// Nunca usa nem remove tabelas operacionais da loja.
export async function verifyPostgres(connectionString,{ssl=true}={}) {
  const schema='pdv_test_'+randomBytes(8).toString('hex');
  const control=new pg.Pool({connectionString,ssl:ssl?{rejectUnauthorized:true}:undefined,max:1});
  let db,server;
  try {
    await control.query(`CREATE SCHEMA ${schema}`);
    db=new pg.Pool({connectionString,ssl:ssl?{rejectUnauthorized:true}:undefined,max:5,options:`-c search_path=${schema}`});
    await db.query(await readFile(new URL('../db/001-init.sql',import.meta.url),'utf8'));
    const password=randomBytes(24).toString('base64url');
    await db.query("INSERT INTO users(name,username,password_hash,role) VALUES('Teste','teste',$1,'admin')",[await passwordHash(password)]);
    await db.query("INSERT INTO categories(name) VALUES('Teste')");
    await db.query("INSERT INTO products(category_id,name,price_cents) VALUES(1,'Produto de teste',1200)");
    server=createApp(db,{production:false,origin:'http://localhost:3000'});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base=`http://127.0.0.1:${server.address().port}`;
    let cookie='',csrf='';
    const call=async(path,data,method='POST')=>{
      const r=await fetch(base+'/api'+path,{method,headers:{Origin:'http://localhost:3000','Content-Type':'application/json',cookie,'X-CSRF-Token':csrf},body:data===undefined?undefined:JSON.stringify(data)});
      const sessionCookie=r.headers.get('set-cookie');if(sessionCookie)cookie=sessionCookie.split(';')[0];
      const body=await r.json();if(body.csrf)csrf=body.csrf;
      return {status:r.status,...body};
    };
    assert.equal((await call('/login',{username:'teste',password})).status,200);
    const sale=()=>({request_key:randomUUID(),payment:'pix',received_cents:1200,expected_total_cents:1200,items:[{product_id:1,quantity:1,price_cents:1200}]});
    const orders=await Promise.all(Array.from({length:20},()=>call('/orders',sale())));
    assert.ok(orders.every(r=>r.status===201));
    assert.equal(new Set(orders.map(r=>r.order.number)).size,20);
    const duplicate=sale();
    const repeated=await Promise.all(Array.from({length:12},()=>call('/orders',duplicate)));
    assert.ok(repeated.every(r=>[200,201].includes(r.status)));
    assert.equal(repeated.filter(r=>r.status===201).length,1);
    assert.equal(new Set(repeated.map(r=>r.order.number)).size,1);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n),21);
    const id=orders[0].order.id;
    const transitions=await Promise.all(Array.from({length:5},()=>call(`/orders/${id}/status`,{expected_status:'pending',status:'preparing'},'PATCH')));
    assert.equal(transitions.filter(r=>r.status===200).length,1);
    assert.equal(transitions.filter(r=>r.status===409).length,4);
    const dishonest=sale();dishonest.items[0].price_cents=1;
    assert.equal((await call('/orders',dishonest)).status,409);
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n),21);
    return {ok:true,connections:5,distinctOrders:20,repeatedConfirmations:12,duplicateSales:0,competingStatusChanges:5,invalidPriceRejected:true};
  } finally {
    if(server)await new Promise(r=>server.close(r));
    await db?.end();
    await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await control.end();
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.TEST_DATABASE_URL){
    console.error('Configure TEST_DATABASE_URL com uma conexão PostgreSQL direta para executar a homologação.');
    process.exitCode=1;
  }else{
    verifyPostgres(process.env.TEST_DATABASE_URL,{ssl:process.env.TEST_DATABASE_SSL!=='disable'})
      .then(result=>console.log(JSON.stringify(result,null,2)))
      .catch(error=>{console.error(error.message);process.exitCode=1;});
  }
}
