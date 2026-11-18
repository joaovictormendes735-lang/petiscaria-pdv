import { transaction } from './db.js';
import { hash } from './security.js';
const first=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
const int=(v,min=0,max=100000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const componentSql="SELECT ci.child_product_id AS product_id,p.name,ci.quantity,(p.active AND p.available AND p.deleted_at IS NULL AND NOT p.is_combo) AS available FROM combo_items ci JOIN products p ON p.id=ci.child_product_id WHERE ci.product_id=$1 ORDER BY ci.child_product_id";
export const catalogProductsSql=`SELECT p.*,p.available AS manual_available,CASE WHEN p.is_combo THEN p.available AND EXISTS(SELECT 1 FROM combo_items ci WHERE ci.product_id=p.id) AND NOT EXISTS(SELECT 1 FROM combo_items ci JOIN products ch ON ch.id=ci.child_product_id WHERE ci.product_id=p.id AND (NOT ch.active OR NOT ch.available OR ch.deleted_at IS NOT NULL OR ch.is_combo)) ELSE p.available END AS available,COALESCE((SELECT json_agg(json_build_object('product_id',ci.child_product_id,'name',ch.name,'quantity',ci.quantity) ORDER BY ci.child_product_id) FROM combo_items ci JOIN products ch ON ch.id=ci.child_product_id WHERE ci.product_id=p.id),'[]') AS components FROM products p WHERE p.deleted_at IS NULL`;
export function paymentParts(d,total,fail){
  const methods=['pix','cash','debit','credit'];
  if(!d.payment_parts){if(!methods.includes(d.payment))fail(400,'Informe as parcelas do pagamento misto.');return [{payment:d.payment,amount_cents:total,received_cents:d.received_cents}];}
  if(!Array.isArray(d.payment_parts)||!int(d.payment_parts.length,1,4))fail(400,'Informe de uma a quatro formas de pagamento.');
  const parts=d.payment_parts.map(p=>{
    if(!p||!methods.includes(p.payment)||!int(p.amount_cents,1))fail(400,'Parcela de pagamento inválida.');
    const received=p.received_cents??p.amount_cents;
    if(!int(received,p.amount_cents)||(p.payment!=='cash'&&received!==p.amount_cents))fail(400,'Troco só é permitido na parcela em dinheiro.');
    return {payment:p.payment,amount_cents:p.amount_cents,received_cents:received};
  }).sort((a,b)=>methods.indexOf(a.payment)-methods.indexOf(b.payment));
  if(new Set(parts.map(p=>p.payment)).size!==parts.length||parts.reduce((s,p)=>s+p.amount_cents,0)!==total||parts.reduce((s,p)=>s+p.received_cents,0)!==d.received_cents)fail(400,'A soma das parcelas deve corresponder ao total e ao recebido.');
  if((parts.length>1?'mixed':parts[0].payment)!==d.payment)fail(400,'Forma de pagamento inconsistente.');return parts;
}
export async function paymentTotals(db,filter,args){
  return (await db.query(`SELECT p.payment,count(*)::integer AS count,sum(p.amount_cents)::bigint AS total_cents FROM orders o CROSS JOIN LATERAL jsonb_to_recordset(CASE WHEN jsonb_array_length(o.payment_parts)>0 THEN o.payment_parts ELSE jsonb_build_array(jsonb_build_object('payment',o.payment,'amount_cents',o.total_cents)) END) AS p(payment text,amount_cents integer) WHERE o.cancelled_at IS NULL AND ${filter} GROUP BY p.payment`,args)).rows;
}
export async function validateCombo(c,id,isCombo,components,fail){
  if(!isCombo)return [];
  if(!Array.isArray(components)||!int(components.length,1,30))fail(400,'O combo deve ter de 1 a 30 produtos.');
  if(new Set(components.map(p=>p.product_id)).size!==components.length)fail(400,'Não repita produtos na composição do combo.');
  for(const item of components){if(!int(item.product_id,1,2147483647)||!int(item.quantity,1,99)||String(item.product_id)===String(id))fail(400,'Composição inválida.');}
  const children=(await c.query('SELECT id,is_combo,active,deleted_at FROM products WHERE id=ANY($1::integer[]) ORDER BY id FOR SHARE',[components.map(i=>i.product_id)])).rows;
  if(children.length!==components.length||children.some(p=>p.is_combo||p.deleted_at||!p.active))fail(400,'Use produtos ativos individuais na composição. Combos dentro de combos não são permitidos.');
  if(id&&await first(c,'SELECT product_id FROM combo_items WHERE child_product_id=$1 LIMIT 1',[id]))fail(400,'Este produto já integra outro combo e não pode se tornar um combo.');
  return components;
}
async function exportBackup({db,res,session,audit}){
  await audit(db,'backup.export','operational-v3');
  const c=await db.connect();
  const tables=['users','categories','products','combo_items','settings','cash_sessions','held_orders','orders','order_items','cash_movements','audit_log','schema_migrations'];
  const line=async data=>{if(res.destroyed)throw Error('Exportação interrompida pelo cliente.');if(!res.write(JSON.stringify(data)+'\n'))await new Promise((resolve,reject)=>{const cleanup=()=>{res.off('drain',drain);res.off('close',closed);};const drain=()=>{cleanup();resolve();};const closed=()=>{cleanup();reject(Error('Exportação interrompida.'));};res.once('drain',drain);res.once('close',closed);});};
  try{
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Content-Disposition':'attachment; filename="pdv-backup-'+new Date().toISOString().slice(0,10)+'.ndjson"'});
    await line({type:'manifest',version:3,exported_at:new Date().toISOString(),tables,credentials_included:false,account_passwords_require_reset:true});
    for(const table of tables){
      const columns=table==='users'?'id,name,username,role,active':'*';
      await c.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT ${columns} FROM ${table}`);
      for(;;){const rows=(await c.query('FETCH 200 FROM backup_rows')).rows;if(!rows.length)break;await line({table,rows});}
      await c.query('CLOSE backup_rows');
    }
    await line({type:'sequences',rows:(await c.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname=current_schema()")).rows});
    await c.query('COMMIT');await line({type:'complete',complete:true});res.end();
  }catch(error){await c.query('ROLLBACK');if(!res.destroyed)res.destroy();}
  finally{c.release();}
}
export async function v3Routes(ctx){
  const {path,method,url,req,res,db,session,body,fail,admin,audit,send}=ctx;
  if(path==='/api/backup'&&method==='GET'){admin();await exportBackup(ctx);return true;}
  if(/^\/api\/products\/\d+\/availability$/.test(path)&&method==='POST'){
    admin();const d=await body(req),id=path.split('/')[3];if(typeof d.available!=='boolean')fail(400,'Disponibilidade inválida.');
    await transaction(db,async c=>{const row=await first(c,'UPDATE products SET available=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id',[d.available,id]);if(!row)fail(404,'Produto não encontrado.');await audit(c,'product.availability',id);});send(200,{ok:true});return true;
  }
  if(path==='/api/held'&&method==='GET'){
    const before=url.searchParams.get('before');if(before&&!uuid.test(before))fail(400,'Página inválida.');
    const args=[],where=['h.consumed_at IS NULL','h.discarded_at IS NULL'];
    if(session.role!=='admin'){args.push(session.id);where.push(`h.user_id=$${args.length}`);}
    if(before){args.push(before);where.push(`(h.created_at,h.id)<(SELECT created_at,id FROM held_orders WHERE id=$${args.length}::uuid)`);}
    const rows=(await db.query(`SELECT h.id,h.label,h.created_at,h.user_id,h.version,u.name AS operator_name FROM held_orders h JOIN users u ON u.id=h.user_id WHERE ${where.join(' AND ')} ORDER BY h.created_at DESC,h.id DESC LIMIT 21`,args)).rows;
    send(200,{held:rows.slice(0,20),next:rows.length>20?rows[19].id:null});return true;
  }
  if(path==='/api/held'&&method==='POST'){
    const d=await body(req),payload=d.payload;
    if(!uuid.test(d.id)||typeof d.label!=='string'||!d.label.trim()||d.label.length>80||!payload||!Array.isArray(payload.items)||!int(payload.items.length,1,100)||typeof payload.notes!=='string'||payload.notes.length>500||!int(payload.discount_cents))fail(400,'Pedido suspenso inválido.');
    if(payload.discount_cents>0)admin();
    const held=await transaction(db,async c=>{
      const existing=await first(c,'SELECT * FROM held_orders WHERE id=$1 FOR UPDATE',[d.id]);
      if(existing&&(existing.user_id!==session.id&&session.role!=='admin'))fail(403,'Pedido de outro operador.');
      if(existing&&(existing.consumed_at||existing.discarded_at))fail(409,'Pedido já finalizado ou descartado.');
      if(existing){if((await first(c,'SELECT payload=$1::jsonb AS same FROM held_orders WHERE id=$2',[JSON.stringify(payload),d.id])).same&&existing.label===d.label)return existing;if(!int(d.expected_version,1)||existing.version!==d.expected_version)fail(409,'Pedido guardado foi alterado. Atualize a lista.');}
      const ids=[];for(const i of payload.items){if(!int(i.product_id,1,2147483647)||!int(i.quantity,1,99)||!int(i.price_cents,1,10000000)||typeof(i.notes??'')!=='string'||(i.notes??'').length>200)fail(400,'Item suspenso inválido.');ids.push(i.product_id);}
      if(new Set(ids).size!==ids.length)fail(400,'Itens repetidos.');
      const products=(await c.query('SELECT id FROM products WHERE id=ANY($1::integer[])',[ids])).rows;if(products.length!==ids.length)fail(400,'Produto não encontrado.');
      const row=existing?await first(c,'UPDATE held_orders SET payload=$1,label=$2,version=version+1 WHERE id=$3 RETURNING *',[JSON.stringify(payload),d.label,d.id]):await first(c,'INSERT INTO held_orders(id,user_id,label,payload) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING *',[d.id,session.id,d.label,JSON.stringify(payload)]);
      if(!row){const replay=await first(c,'SELECT *,payload=$1::jsonb AS same FROM held_orders WHERE id=$2',[JSON.stringify(payload),d.id]);if(replay&&replay.same&&replay.label===d.label&&replay.user_id===session.id&&!replay.consumed_at&&!replay.discarded_at)return replay;fail(409,'O pedido já foi guardado. Atualize a lista.');}await audit(c,'held.save',row.id);return row;
    });send(200,{held});return true;
  }
  if(/^\/api\/held\/[0-9a-f-]+$/.test(path)&&method==='GET'){
    const id=path.split('/')[3];if(!uuid.test(id))fail(400,'Pedido inválido.');const held=await first(db,'SELECT * FROM held_orders WHERE id=$1',[id]);
    if(!held)fail(404,'Pedido não encontrado.');if(held.user_id!==session.id&&session.role!=='admin')fail(403,'Pedido de outro operador.');if(held.consumed_at||held.discarded_at)fail(409,'Pedido já finalizado ou descartado.');send(200,{held});return true;
  }
  if(/^\/api\/held\/[0-9a-f-]+\/discard$/.test(path)&&method==='POST'){
    const id=path.split('/')[3];if(!uuid.test(id))fail(400,'Pedido inválido.');
    await transaction(db,async c=>{const held=await first(c,'SELECT * FROM held_orders WHERE id=$1 FOR UPDATE',[id]);if(!held)fail(404,'Pedido não encontrado.');if(held.user_id!==session.id&&session.role!=='admin')fail(403,'Pedido de outro operador.');if(held.consumed_at)fail(409,'Pedido já vendido.');await c.query('UPDATE held_orders SET discarded_at=COALESCE(discarded_at,now()) WHERE id=$1',[id]);await audit(c,'held.discard',id);});send(200,{ok:true});return true;
  }
  if(path==='/api/cash/movements'&&method==='GET'){
    admin();const id=url.searchParams.get('cash_id'),before=url.searchParams.get('before');if(!/^\d{1,18}$/.test(id||'')||(before&&!/^\d{1,18}$/.test(before)))fail(400,'Caixa ou página inválida.');
    const rows=(await db.query(`SELECT m.id,m.kind,m.amount_cents,m.reason,m.created_at,u.name AS operator_name FROM cash_movements m JOIN users u ON u.id=m.user_id WHERE m.cash_session_id=$1 ${before?'AND m.id<$2':''} ORDER BY m.id DESC LIMIT 51`,before?[id,before]:[id])).rows;send(200,{movements:rows.slice(0,50),next:rows.length>50?rows[49].id:null});return true;
  }
  if(path==='/api/cash/movements'&&method==='POST'){
    admin();const d=await body(req);if(!uuid.test(d.request_key)||!['in','out'].includes(d.kind)||!int(d.amount_cents,1)||typeof d.reason!=='string'||d.reason.trim().length<3||d.reason.length>300||!/^\d{1,18}$/.test(String(d.cash_session_id||'')))fail(400,'Movimentação inválida.');
    const fingerprint=hash(JSON.stringify({shift:String(d.cash_session_id),kind:d.kind,amount:d.amount_cents,reason:d.reason.trim()}));
    const movement=await transaction(db,async c=>{
      const shift=await first(c,'SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE',[d.cash_session_id]);if(!shift)fail(404,'Caixa não encontrado.');
      const replay=await first(c,'SELECT * FROM cash_movements WHERE request_key=$1',[d.request_key]);if(replay){if(replay.request_hash!==fingerprint||replay.user_id!==session.id)fail(409,'Confirmação já utilizada.');return replay;}
      if(shift.closed_at)fail(409,'O caixa já foi fechado.');
      if(d.kind==='out'){
        const pay=await paymentTotals(c,'o.cash_session_id=$1',[shift.id]);const moves=await first(c,"SELECT COALESCE(sum(CASE WHEN kind='in' THEN amount_cents ELSE -amount_cents END),0)::bigint AS net FROM cash_movements WHERE cash_session_id=$1",[shift.id]);
        const available=shift.opening_cents+Number(pay.find(p=>p.payment==='cash')?.total_cents||0)+Number(moves.net);if(d.amount_cents>available)fail(409,'A sangria excede o dinheiro esperado no caixa.');
      }
      const row=await first(c,'INSERT INTO cash_movements(cash_session_id,user_id,kind,amount_cents,reason,request_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[shift.id,session.id,d.kind,d.amount_cents,d.reason.trim(),d.request_key,fingerprint]);await audit(c,'cash.'+d.kind,row.id);return row;
    });send(200,{movement});return true;
  }
  return false;
}
