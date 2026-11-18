import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { hash, token, passwordVerify } from './security.js';
import { transaction } from './db.js';
import { v2Routes, pickup, contrast } from './v2.js';
import { v3Routes, catalogProductsSql, componentSql, paymentParts, paymentTotals } from './v3.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const payments = ['pix','cash','debit','credit','mixed'];
const states = ['pending','preparing','ready','delivered'];
const publicUser = u => ({ id: u.id, name: u.name, role: u.role });
const first = async (db, sql, args = []) => (await db.query(sql, args)).rows[0];
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Envie dados JSON.');
  let data = '';
  for await (const part of req) { data += part; if (Buffer.byteLength(data) > 65536) fail(413, 'Dados muito grandes.'); }
  try { const result = JSON.parse(data); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; }
  catch { fail(400, 'JSON inválido.'); }
}
const orderSql = `SELECT o.*, u.name AS operator_name, COALESCE((SELECT json_agg(json_build_object('product_id',i.product_id,'name',i.name,'quantity',i.quantity,'price_cents',i.price_cents,'notes',i.notes,'combo_components',i.combo_components) ORDER BY i.id) FROM order_items i WHERE i.order_id=o.id),'[]') AS items FROM orders o JOIN users u ON u.id=o.user_id`;
export function createApp(db, options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const origin = options.origin ?? process.env.APP_ORIGIN ?? process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:3000';
  const sessionHours = Number(process.env.SESSION_HOURS || 12);
  if (!integer(sessionHours,1,24)) throw Error('SESSION_HOURS deve estar entre 1 e 24.');
  if (production && new URL(origin).protocol !== 'https:') throw Error('APP_ORIGIN deve usar HTTPS em produção.');
  const staticRoot = resolve(options.staticRoot || (production ? 'dist' : 'public'));
  const staticCache = new Map();
  const cookie = (value, age) => `pdv_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${production ? '; Secure' : ''}`;
  return createServer(async (req, res) => {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (production) res.setHeader('Strict-Transport-Security','max-age=31536000');
    res.setHeader('Cache-Control','no-store');
    try {
      const url = new URL(req.url, origin), path = url.pathname, method = req.method;
      if (path === '/health' && method === 'GET') { await db.query('SELECT 1'); return send(200,{ ok:true }); }
      if (path === '/api/pickup' && method === 'GET') return send(200,await pickup(db));
      if (path === '/theme.css' && method === 'GET') {
        const s=await first(db,'SELECT primary_color FROM settings WHERE id=1');
        const color=/^#[0-9a-f]{6}$/i.test(s.primary_color)?s.primary_color:'#16A34A';
        res.setHeader('Content-Type','text/css; charset=utf-8');return res.end(`:root{--green:${color};--on-green:${contrast(color)}}`);
      }
      if (!path.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(method)) fail(405,'Método inválido.');
        const name = ['/', '/retirada', '/retirada/'].includes(path) ? 'index.html' : path.slice(1);
        if (!['index.html','app.js','v2.js','v3.js','sw.js','style.css','favicon.svg','manifest.webmanifest','icon192.png','icon512.png','offline.html'].includes(name)) fail(404,'Página não encontrada.');
        let file = production ? staticCache.get(name) : null;
        if (!file) {
          const raw = await readFile(resolve(staticRoot,name));
          file = { raw, gzip:gzipSync(raw), type:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'})[extname(name)] };
          if (production) staticCache.set(name,file);
        }
        res.setHeader('Content-Type',`${file.type}; charset=utf-8`);
        res.setHeader('Vary','Accept-Encoding');
        const compressed = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        if (compressed) res.setHeader('Content-Encoding','gzip');
        return res.end(method === 'HEAD' ? undefined : compressed ? file.gzip : file.raw);
      }
      if (!['GET','POST','PATCH'].includes(method)) fail(405,'Método inválido.');
      if (method !== 'GET' && req.headers.origin !== origin) fail(403,'Origem não autorizada.');
      if (path === '/api/login' && method === 'POST') {
        const data = await body(req);
        if (!text(data.username,80) || typeof data.password !== 'string' || data.password.length > 128) fail(400,'Informe usuário e senha.');
        const username = data.username.trim().toLowerCase();
        const ip = process.env.TRUST_PROXY === '1' ? (req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim() : req.socket.remoteAddress;
        const keys = [hash(`ip:${ip}`),hash(`user:${username}`)];
        // Incremento atômico antes da verificação: tentativas paralelas também são limitadas.
        const attempts = await transaction(db,async client => {
          const results = [];
          for (const key of keys) results.push(await first(client,`INSERT INTO login_attempts(key,failures,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN login_attempts.reset_at<now() THEN 1 ELSE login_attempts.failures+1 END, reset_at=CASE WHEN login_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE login_attempts.reset_at END RETURNING failures`,[key]));
          return results;
        });
        if (attempts[0].failures > 40 || attempts[1].failures > 10) { res.setHeader('Retry-After','900'); fail(429,'Muitas tentativas. Tente novamente em 15 minutos.'); }
        const user = await first(db,'SELECT * FROM users WHERE username=$1 AND active=true',[username]);
        // Mesmo custo de scrypt quando a conta não existe.
        const valid = await passwordVerify(data.password,user?.password_hash || 'scrypt:00000000000000000000000000000000:'+'00'.repeat(64));
        if (!user || !valid) fail(401,'Usuário ou senha incorretos.');
        const rawToken = token(), csrf = token();
        await transaction(db,async client => {
          await client.query('DELETE FROM login_attempts WHERE key=$1',[keys[1]]);
          await client.query('DELETE FROM sessions WHERE expires_at<now()');
          await client.query("DELETE FROM login_attempts WHERE reset_at<now()");
          await client.query("INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+($4::integer*interval '1 hour'))",[hash(rawToken),user.id,csrf,sessionHours]);
        });
        res.setHeader('Set-Cookie',cookie(rawToken,sessionHours*3600));
        return send(200,{ user:publicUser(user), csrf });
      }
      const rawToken = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('pdv_session='))?.slice(12);
      const session = rawToken && /^[a-f0-9]{64}$/.test(rawToken) ? await first(db,`SELECT s.csrf,u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[hash(rawToken)]) : null;
      if (!session) fail(401,'Entre para continuar.');
      if (method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) fail(403,'Sessão inválida. Atualize a página.');
      const admin = () => { if (session.role !== 'admin') fail(403,'Acesso exclusivo do administrador.'); };
      const audit = (client,action,id) => client.query('INSERT INTO audit_log(user_id,action,entity_id) VALUES($1,$2,$3)',[session.id,action,String(id)]);
      if(await v3Routes({path,method,url,req,res,db,session,body,fail,admin,audit,send,orderSql}))return;
      if(await v2Routes({path,method,url,req,db,session,body,fail,admin,audit,send,orderSql}))return;
      if (path === '/api/session' && method === 'GET') return send(200,{ user:publicUser(session), csrf:session.csrf });
      if (path === '/api/logout' && method === 'POST') {
        await db.query('DELETE FROM sessions WHERE token_hash=$1',[hash(rawToken)]);
        res.setHeader('Set-Cookie',cookie('',0)); return send(200,{ ok:true });
      }
      if (path === '/api/catalog' && method === 'GET') {
        const [categories, products, settings] = await Promise.all([db.query('SELECT * FROM categories ORDER BY id'),db.query(`${catalogProductsSql} ${session.role === 'admin' ? '' : 'AND p.active=true'} ORDER BY p.display_order,p.id`),first(db,'SELECT * FROM settings WHERE id=1')]);
        return send(200,{ categories:categories.rows, products:products.rows, settings });
      }
      if (path === '/api/categories' && method === 'POST') {
        admin(); const d=await body(req); if (!text(d.name,50)) fail(400,'Informe um nome de até 50 caracteres.');
        const row = await transaction(db, async client => { const r=await first(client,'INSERT INTO categories(name) VALUES($1) RETURNING *',[d.name.trim()]); await audit(client,'category.create',r.id); return r; });
        return send(201,row);
      }
      if (path === '/api/orders' && method === 'POST') {
        const d=await body(req);
        if (!uuid.test(d.request_key) || !payments.includes(d.payment) || !Array.isArray(d.items) || !integer(d.items.length,1,100) || !integer(d.expected_total_cents,1,100000000) || !integer(d.received_cents,0,100000000)) fail(400,'Pedido inválido.');
        const items=d.items.map(i=>{
          if (!i || !integer(i.product_id,1,2147483647) || !integer(i.quantity,1,99) || !integer(i.price_cents,1,10000000)) fail(400,'Itens inválidos.');
          if(typeof(i.notes??'')!=='string'||(i.notes??'').length>200||(i.combo_version!==undefined&&!integer(i.combo_version,1,2147483647)))fail(400,'Observação ou composição inválida.');
          const item={ product_id:i.product_id, quantity:i.quantity, price_cents:i.price_cents };if(i.notes)item.notes=i.notes;if(i.combo_version!==undefined)item.combo_version=i.combo_version;return item;
        }).sort((a,b)=>a.product_id-b.product_id);
        if (new Set(items.map(i=>i.product_id)).size !== items.length) fail(400,'Itens repetidos.');
        const notes=d.notes??'',discount=d.discount_cents??0;
        if(typeof notes!=='string'||notes.length>500||!integer(discount,0,100000000))fail(400,'Observação ou desconto inválido.');
        if(discount>0)admin();
        const parts=paymentParts(d,d.expected_total_cents,fail);
        if(d.suspended_id!==undefined&&!uuid.test(d.suspended_id))fail(400,'Pedido guardado inválido.');
        const confirmed={items,payment:d.payment,received:d.received_cents,total:d.expected_total_cents};
        // Mantém a identificação de pedidos pendentes da versão 1.0.
        if(notes||discount)Object.assign(confirmed,{notes,discount});
        if(d.payment_parts)confirmed.payment_parts=parts;if(d.suspended_id)confirmed.suspended_id=d.suspended_id;
        const fingerprint=hash(JSON.stringify(confirmed));
        const checkReplay = order => { if (order.request_hash!==fingerprint || order.user_id!==session.id) fail(409,'Esta confirmação já foi utilizada em outro pedido.'); return order; };
        const result=await transaction(db,async client=>{
          const existing=await first(client,'SELECT * FROM orders WHERE request_key=$1',[d.request_key]);
          if (existing) return { id:checkReplay(existing).id, replay:true };
          if(d.suspended_id){const held=await first(client,'SELECT * FROM held_orders WHERE id=$1 FOR UPDATE',[d.suspended_id]);if(!held)fail(404,'Pedido guardado não encontrado.');if(held.user_id!==session.id&&session.role!=='admin')fail(403,'Pedido de outro operador.');if(held.consumed_at||held.discarded_at)fail(409,'Pedido guardado já vendido ou descartado.');}
          const shift=await first(client,'SELECT id FROM cash_sessions WHERE closed_at IS NULL FOR SHARE');
          if(!shift&&(await first(client,'SELECT require_open_cash FROM settings WHERE id=1')).require_open_cash)fail(409,'Abra o caixa antes de finalizar a venda.');
          await client.query('LOCK TABLE products IN SHARE MODE');
          const products=(await client.query('SELECT * FROM products WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE',[items.map(i=>i.product_id)])).rows;
          let total=0;
          for (const item of items) {
            const product=products.find(p=>p.id===item.product_id);
            if (!product?.active) fail(409,'Um produto foi desativado. Atualize o catálogo e revise o pedido.');
            if(!product.available||product.deleted_at)fail(409,'Um produto está indisponível. Revise o pedido.');
            if (product.price_cents!==item.price_cents) fail(409,'Um preço mudou. Atualize o catálogo e revise o pedido.');
            if(item.combo_version!==undefined&&item.combo_version!==product.combo_version)fail(409,'A composição do combo mudou. Adicione o combo novamente.');
            if(product.is_combo){const children=(await client.query(componentSql,[product.id])).rows;if(!children.length||children.some(c=>!c.available))fail(409,'Um componente do combo está esgotado.');item.combo_components=children.map(({product_id,name,quantity})=>({product_id,name,quantity}));}
            total+=product.price_cents*item.quantity;
          }
          const subtotal=total;total-=discount;
          if (!integer(total,1,100000000) || total!==d.expected_total_cents) fail(409,'O total mudou ou o desconto é inválido. Revise o pedido.');
          if (d.received_cents<total || (!['cash','mixed'].includes(d.payment) && d.received_cents!==total)) fail(400,'Valor recebido inválido.');
          const order=await first(client,`INSERT INTO orders(user_id,request_key,request_hash,total_cents,payment,received_cents,notes,discount_cents,subtotal_cents,cash_session_id,payment_parts,suspended_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(request_key) DO NOTHING RETURNING *`,[session.id,d.request_key,fingerprint,total,d.payment,d.received_cents,notes,discount,subtotal,shift?.id||null,JSON.stringify(parts),d.suspended_id||null]);
          if (!order) { const replay=checkReplay(await first(client,'SELECT * FROM orders WHERE request_key=$1',[d.request_key])); return { id:replay.id,replay:true }; }
          for (const item of items) await client.query('INSERT INTO order_items(order_id,product_id,name,quantity,price_cents,notes,combo_components) VALUES($1,$2,$3,$4,$5,$6,$7)',[order.id,item.product_id,products.find(p=>p.id===item.product_id).name,item.quantity,item.price_cents,item.notes||'',JSON.stringify(item.combo_components||[])]);
          if(d.suspended_id)await client.query('UPDATE held_orders SET consumed_at=now() WHERE id=$1',[d.suspended_id]);
          await audit(client,'order.create',order.id); return { id:order.id,replay:false };
        });
        return send(result.replay?200:201,{ order:await first(db,`${orderSql} WHERE o.id=$1`,[result.id]), replay:result.replay });
      }
      if (path === '/api/orders' && method === 'GET') {
        const status=url.searchParams.get('status'), before=url.searchParams.get('before');
        if (status && !['queue',...states].includes(status)) fail(400,'Status inválido.');
        if (before && !/^\d{1,18}$/.test(before)) fail(400,'Página inválida.');
        const args=[],where=[];
        where.push('o.cancelled_at IS NULL');
        if (status==='queue') where.push("o.status!='delivered'");
        else if (status) { args.push(status); where.push(`o.status=$${args.length}`); }
        if (before) { args.push(before); where.push(`o.id<$${args.length}`); }
        const rows=(await db.query(`${orderSql} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY o.id DESC LIMIT 51`,args)).rows;
        return send(200,{ orders:rows.slice(0,50), next:rows.length>50?rows[49].id:null });
      }
      if (/^\/api\/orders\/\d+$/.test(path) && method === 'GET') {
        const order=await first(db,`${orderSql} WHERE o.id=$1`,[path.split('/').at(-1)]);
        if (!order) fail(404,'Pedido não encontrado.'); return send(200,{ order });
      }
      if (/^\/api\/orders\/\d+\/status$/.test(path) && method === 'PATCH') {
        const d=await body(req),id=path.split('/')[3];
        if (!states.includes(d.expected_status) || states.indexOf(d.status)!==states.indexOf(d.expected_status)+1 || !states.includes(d.status)) fail(400,'Transição de status inválida.');
        const order=await transaction(db,async client=>{
          const row=await first(client,"UPDATE orders SET status=$1,ready_at=CASE WHEN $1='ready' THEN now() ELSE ready_at END WHERE id=$2 AND status=$3 AND cancelled_at IS NULL RETURNING *",[d.status,id,d.expected_status]);
          if (!row) fail(409,'Pedido alterado por outro atendente. Atualize a fila.'); await audit(client,`order.${d.status}`,id); return row;
        }); return send(200,{ order });
      }
      if (path === '/api/reports' && method === 'GET') {
        admin(); const date=url.searchParams.get('date');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) fail(400,'Data inválida.');
        const settings=await first(db,'SELECT timezone FROM settings WHERE id=1');
        const filter="created_at >= ($1::date::timestamp AT TIME ZONE $2) AND created_at < (($1::date+1)::timestamp AT TIME ZONE $2)";
        const [totals,byPayment,top]=await Promise.all([first(db,`SELECT count(*)::integer AS count,COALESCE(sum(total_cents),0)::bigint AS total_cents FROM orders WHERE cancelled_at IS NULL AND ${filter}`,[date,settings.timezone]),paymentTotals(db,filter.replaceAll('created_at','o.created_at'),[date,settings.timezone]),db.query(`SELECT i.name,sum(i.quantity)::bigint AS quantity FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.cancelled_at IS NULL AND ${filter.replaceAll('created_at','o.created_at')} GROUP BY i.product_id,i.name ORDER BY quantity DESC,i.name LIMIT 10`,[date,settings.timezone])]);
        const before=url.searchParams.get('before'); if (before && !/^\d{1,18}$/.test(before)) fail(400,'Página inválida.');
        const history=(await db.query(`${orderSql} WHERE o.${filter.replaceAll('created_at','created_at')} ${before?'AND o.id<$3':''} ORDER BY o.id DESC LIMIT 51`,before?[date,settings.timezone,before]:[date,settings.timezone])).rows;
        return send(200,{ date,timezone:settings.timezone, totals, payments:byPayment, top_products:top.rows, orders:history.slice(0,50),next:history.length>50?history[49].id:null });
      }
      fail(404,'Recurso não encontrado.');
    } catch (error) {
      if (res.headersSent) return res.end();
      if (error.status) return send(error.status,{ error:error.message });
      if (error.code==='23505') return send(409,{ error:'Este nome já está cadastrado.' });
      if (['23503','22003','22P02','22008'].includes(error.code)) return send(400,{ error:'Dados inválidos. Revise o cadastro.' });
      if (error.code==='ENOENT') return send(503,{ error:'Interface ausente. Execute npm run build antes de iniciar em produção.' });
      const incident=token().slice(0,12); console.error(`[${incident}] ${error.code||error.name}: ${error.message}`);
      send(503,{ error:`Serviço temporariamente indisponível. Tente novamente. Referência: ${incident}` });
    }
  });
}
