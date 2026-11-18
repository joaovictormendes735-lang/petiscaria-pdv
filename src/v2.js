import { transaction } from './db.js';
import { paymentTotals, componentSql, validateCombo } from './v3.js';
const first=async(db,sql,args=[]) => (await db.query(sql,args)).rows[0];
const int=(v,min=0,max=100000000)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const str=(v,max)=>typeof v==='string'&&v.length<=max;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function contrast(color) {
  const rgb=color.slice(1).match(/../g).map(h=>parseInt(h,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  return (l+.05)/.05>1.05/(l+.05)?'#000000':'#ffffff';
}
export async function pickup(db) {
  const [settings,ready,recent]=await Promise.all([
    first(db,'SELECT store_name,pickup_message FROM settings WHERE id=1'),
    db.query("SELECT number,ready_at FROM orders WHERE status='ready' AND cancelled_at IS NULL ORDER BY ready_at DESC NULLS LAST,id DESC LIMIT 30"),
    db.query("SELECT number,ready_at FROM orders WHERE ready_at>now()-interval '24 hours' AND cancelled_at IS NULL ORDER BY ready_at DESC,id DESC LIMIT 10")
  ]);
  return {store_name:settings.store_name,message:settings.pickup_message,ready:ready.rows,recent:recent.rows,updated_at:new Date().toISOString()};
}
export async function cashSummary(db,id) {
  const rows=await paymentTotals(db,'o.cash_session_id=$1',[id]);
  const totals=await first(db,'SELECT count(*)::integer AS count,COALESCE(sum(total_cents),0)::bigint AS total_cents FROM orders WHERE cash_session_id=$1 AND cancelled_at IS NULL',[id]);
  const moves=await first(db,"SELECT COALESCE(sum(amount_cents) FILTER(WHERE kind='in'),0)::bigint AS in_cents,COALESCE(sum(amount_cents) FILTER(WHERE kind='out'),0)::bigint AS out_cents FROM cash_movements WHERE cash_session_id=$1",[id]);
  return {count:totals.count,total_cents:Number(totals.total_cents),payments:rows,movements:{in_cents:Number(moves.in_cents),out_cents:Number(moves.out_cents)}};
}
const cashSql='SELECT c.*,u.name AS opened_by_name,z.name AS closed_by_name FROM cash_sessions c JOIN users u ON u.id=c.opened_by LEFT JOIN users z ON z.id=c.closed_by';
export async function v2Routes(ctx) {
  const {path,method,url,req,db,session,body,fail,admin,audit,send,orderSql}=ctx;
  if(path==='/api/settings'&&method==='PATCH') {
    admin();const d=await body(req),old=await first(db,'SELECT * FROM settings WHERE id=1');
    const s={...old,...d};
    if(!str(s.store_name,80)||!s.store_name.trim()||![58,80].includes(s.paper_width)||typeof s.auto_print!=='boolean'||!str(s.timezone,80)||!/^#[0-9a-f]{6}$/i.test(s.primary_color)||!str(s.receipt_message,200)||!str(s.business_info,300)||!str(s.pickup_message,160)||typeof s.require_open_cash!=='boolean')fail(400,'Configurações inválidas.');
    if(!int(s.attention_minutes,1,180)||!int(s.late_minutes,s.attention_minutes+1,480))fail(400,'Configure atenção de 1 a 180 minutos e atraso maior que atenção, até 480 minutos.');
    try{new Intl.DateTimeFormat('pt-BR',{timeZone:s.timezone});}catch{fail(400,'Fuso horário inválido.');}
    if(typeof s.logo_data_url!=='string'||s.logo_data_url.length>45000)fail(400,'A logomarca deve ter no máximo 32 KB.');
    if(s.logo_data_url){
      const m=s.logo_data_url.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+=*)$/);
      if(!m)fail(400,'Envie uma imagem PNG, JPEG ou WebP.');
      const bytes=Buffer.from(m[2],'base64');
      const valid=m[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):m[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
      if(!valid||bytes.length>32768)fail(400,'Imagem inválida ou maior que 32 KB.');
    }
    const result=await transaction(db,async c=>{
      const row=await first(c,'UPDATE settings SET store_name=$1,paper_width=$2,auto_print=$3,timezone=$4,primary_color=$5,logo_data_url=$6,receipt_message=$7,business_info=$8,pickup_message=$9,require_open_cash=$10 WHERE id=1 RETURNING *',[s.store_name.trim(),s.paper_width,s.auto_print,s.timezone,s.primary_color,s.logo_data_url,s.receipt_message,s.business_info,s.pickup_message,s.require_open_cash]);
      await c.query('UPDATE settings SET attention_minutes=$1,late_minutes=$2 WHERE id=1',[s.attention_minutes,s.late_minutes]);Object.assign(row,{attention_minutes:s.attention_minutes,late_minutes:s.late_minutes});
      await audit(c,'settings.update',1);return row;
    });send(200,result);return true;
  }
  if((path==='/api/products'&&method==='POST')||(/^\/api\/products\/\d+$/.test(path)&&method==='PATCH')) {
    admin();const d=await body(req),id=path.split('/').at(-1);
    const old=method==='PATCH'?await first(db,'SELECT * FROM products WHERE id=$1 AND deleted_at IS NULL',[id]):{display_order:0,available:true,is_combo:false};
    if(!old)fail(404,'Produto não encontrado.');const p={...old,...d};
    if(!str(p.name,100)||!p.name.trim()||!int(p.price_cents,1,10000000)||!int(p.category_id,1,2147483647)||typeof p.active!=='boolean'||typeof p.available!=='boolean'||!int(p.display_order,0,100000)||typeof p.is_combo!=='boolean')fail(400,'Dados do produto inválidos.');
    const row=await transaction(db,async c=>{
      const values=[p.name.trim(),p.category_id,p.price_cents,p.active,p.available,p.display_order];
      const r=method==='POST'?await first(c,'INSERT INTO products(name,category_id,price_cents,active,available,display_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',values):await first(c,'UPDATE products SET name=$1,category_id=$2,price_cents=$3,active=$4,available=$5,display_order=$6 WHERE id=$7 RETURNING *',[...values,id]);
      const components=await validateCombo(c,r.id,p.is_combo,d.components??(await c.query(componentSql,[r.id])).rows,fail);
      await c.query('DELETE FROM combo_items WHERE product_id=$1',[r.id]);
      for(const item of components)await c.query('INSERT INTO combo_items(product_id,child_product_id,quantity) VALUES($1,$2,$3)',[r.id,item.product_id,item.quantity]);
      const updated=await first(c,'UPDATE products SET is_combo=$1,combo_version=combo_version+1 WHERE id=$2 RETURNING is_combo,combo_version',[p.is_combo,r.id]);Object.assign(r,updated,{components});
      await audit(c,method==='POST'?'product.create':'product.update',r.id);return r;
    });send(method==='POST'?201:200,row);return true;
  }
  if(/^\/api\/products\/\d+\/archive$/.test(path)&&method==='POST') {
    admin();const id=path.split('/')[3];
    await transaction(db,async c=>{const row=await first(c,'UPDATE products SET active=false,deleted_at=COALESCE(deleted_at,now()) WHERE id=$1 RETURNING id',[id]);if(!row)fail(404,'Produto não encontrado.');await audit(c,'product.archive',id);});
    send(200,{ok:true});return true;
  }
  if(path==='/api/cash'&&method==='GET') {
    const current=await first(db,`${cashSql} WHERE c.closed_at IS NULL`)||null;
    if(current){current.summary=await cashSummary(db,current.id);current.expected_cents=Number(current.opening_cents)+Number(current.summary.payments.find(p=>p.payment==='cash')?.total_cents||0)+current.summary.movements.in_cents-current.summary.movements.out_cents;}
    const before=url.searchParams.get('before');if(before&&!/^\d{1,18}$/.test(before))fail(400,'Página inválida.');
    const args=[],where=['c.closed_at IS NOT NULL'];
    if(session.role!=='admin'){args.push(session.id);where.push(`(c.opened_by=$${args.length} OR c.closed_by=$${args.length})`);}
    if(before){args.push(before);where.push(`c.id<$${args.length}`);}
    const rows=(await db.query(`${cashSql} WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 21`,args)).rows;
    send(200,{current,closed:rows.slice(0,20),next:rows.length>20?rows[19].id:null});return true;
  }
  if(path==='/api/cash/open'&&method==='POST') {
    const d=await body(req);if(!int(d.opening_cents)||!uuid.test(d.request_key))fail(400,'Informe o valor inicial.');
    const cash=await transaction(db,async c=>{
      await c.query('LOCK TABLE cash_sessions IN EXCLUSIVE MODE');
      const replay=await first(c,'SELECT * FROM cash_sessions WHERE open_request_key=$1',[d.request_key]);
      if(replay){if(replay.opened_by!==session.id||replay.opening_cents!==d.opening_cents)fail(409,'Esta abertura já foi utilizada.');return replay;}
      if(await first(c,'SELECT id FROM cash_sessions WHERE closed_at IS NULL'))fail(409,'Já existe um caixa aberto. Atualize a tela.');
      const row=await first(c,'INSERT INTO cash_sessions(opened_by,opening_cents,open_request_key) VALUES($1,$2,$3) RETURNING *',[session.id,d.opening_cents,d.request_key]);await audit(c,'cash.open',row.id);return row;
    });send(200,{cash});return true;
  }
  if(/^\/api\/cash\/\d+\/close$/.test(path)&&method==='POST') {
    const d=await body(req),id=path.split('/')[3];if(!int(d.counted_cents))fail(400,'Informe o dinheiro contado.');
    const cash=await transaction(db,async c=>{
      const row=await first(c,'SELECT * FROM cash_sessions WHERE id=$1 FOR UPDATE',[id]);if(!row)fail(404,'Caixa não encontrado.');
      if(session.role!=='admin'&&row.opened_by!==session.id)fail(403,'Somente quem abriu o caixa ou o administrador pode fechar.');
      if(row.closed_at){if(row.counted_cents!==d.counted_cents)fail(409,'Caixa já fechado com outro valor.');return row;}
      const summary=await cashSummary(c,id),expected=Number(row.opening_cents)+Number(summary.payments.find(p=>p.payment==='cash')?.total_cents||0)+summary.movements.in_cents-summary.movements.out_cents;
      const result=await first(c,'UPDATE cash_sessions SET closed_at=now(),closed_by=$1,expected_cents=$2,counted_cents=$3,difference_cents=$4,closing_summary=$5 WHERE id=$6 RETURNING *',[session.id,expected,d.counted_cents,d.counted_cents-expected,JSON.stringify(summary),id]);await audit(c,'cash.close',id);return result;
    });send(200,{cash});return true;
  }
  if(/^\/api\/orders\/\d+\/cancel$/.test(path)&&method==='POST') {
    admin();const d=await body(req),id=path.split('/')[3];if(!str(d.reason,300)||d.reason.trim().length<3)fail(400,'Informe o motivo do cancelamento (3 a 300 caracteres).');
    let closedCash=false;
    const order=await transaction(db,async c=>{
      const current=await first(c,'SELECT * FROM orders WHERE id=$1',[id]);if(!current)fail(404,'Pedido não encontrado.');
      if(current.cancelled_at)return current;
      if(current.cash_session_id){const shift=await first(c,'SELECT closed_at FROM cash_sessions WHERE id=$1 FOR SHARE',[current.cash_session_id]);closedCash=Boolean(shift.closed_at);}
      const r=await first(c,'UPDATE orders SET cancelled_at=now(),cancelled_by=$1,cancel_reason=$2 WHERE id=$3 AND cancelled_at IS NULL RETURNING *',[session.id,d.reason.trim(),id]);
      if(!r)return first(c,'SELECT * FROM orders WHERE id=$1',[id]);await audit(c,closedCash?'order.cancel_after_close':'order.cancel',id);return r;
    });send(200,{order,closed_cash_preserved:closedCash});return true;
  }
  if(path==='/api/history'&&method==='GET') {
    const args=[],where=[];const add=(expression,value)=>{args.push(value);where.push(expression.replace('?',`$${args.length}`));};
    if(session.role!=='admin')add('o.user_id=?',session.id);
    const number=url.searchParams.get('number'),date=url.searchParams.get('date'),before=url.searchParams.get('before');
    if(number){if(!/^\d{1,18}$/.test(number))fail(400,'Número inválido.');add('o.number=?',number);}
    if(date){if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail(400,'Data inválida.');const s=await first(db,'SELECT timezone FROM settings WHERE id=1');args.push(date,s.timezone);where.push(`o.created_at >= ($${args.length-1}::date::timestamp AT TIME ZONE $${args.length}) AND o.created_at < (($${args.length-1}::date+1)::timestamp AT TIME ZONE $${args.length})`);}
    if(before){if(!/^\d{1,18}$/.test(before))fail(400,'Página inválida.');add('o.id<?',before);}
    const rows=(await db.query(`${orderSql} ${where.length?'WHERE '+where.join(' AND '):''} ORDER BY o.id DESC LIMIT 51`,args)).rows;
    send(200,{orders:rows.slice(0,50),next:rows.length>50?rows[49].id:null});return true;
  }
  return false;
}
