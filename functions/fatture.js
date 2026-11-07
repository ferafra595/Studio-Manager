// Fatturazione amministrativa: ambiente di sviluppo, senza invii fiscali.
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const fail=(msg,status=400)=>respond({error:msg},status);
const id=()=>crypto.randomUUID();
const s=v=>String(v??'').trim();
const validDate=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const all=async(db,q,...p)=>(await db.prepare(q).bind(...p).all()).results||[];
const one=(db,q,...p)=>db.prepare(q).bind(...p).first();
const event=(db,invoice,action,detail='')=>db.prepare('INSERT INTO sm_invoice_events(id,invoice_id,action,detail) VALUES(?,?,?,?)').bind(id(),invoice,action,detail).run();
const money=v=>Number.isSafeInteger(v)&&v>=0&&v<=100000000;
async function body(req){if(Number(req.headers.get('content-length')||0)>12000)throw Error('Richiesta troppo grande');return req.json()}
function calculate(b){const qty=Number(b.quantity),unit=Number(b.unit_cents),vat=Number(b.vat_rate_bp),stamp=Number(b.stamp_cents);
 if(!Number.isInteger(qty)||qty<1||qty>10000||!money(unit)||!Number.isInteger(vat)||vat<0||vat>10000||![0,200].includes(stamp))throw Error('Quantità, importo, IVA o bollo non validi');
 const taxable=qty*unit,vatCents=Math.round(taxable*vat/10000),total=taxable+vatCents+stamp;
 if(!Number.isSafeInteger(total)||total<=0||total>100000000)throw Error('Totale non valido');
 return {qty,unit,vat,stamp,taxable,vatCents,total};}
export async function fatture({request,env},path){const db=env.DB;if(!db)return fail('Binding D1 non configurato',503);
 const method=request.method;
 try{
 if(method==='GET'&&path==='/api/v1/billing/status'){
  const names=await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sm_invoices','sm_invoice_payments','sm_billing_settings')");return respond({ready:names.length===3,live_fiscal_transmission:false});
 }
 if(method==='GET'&&path==='/api/v1/billing/settings')return respond({settings:await one(db,'SELECT * FROM sm_billing_settings WHERE id=1')});
 if(method==='PUT'&&path==='/api/v1/billing/settings'){
  const b=await body(request);const fields=['legal_name','vat_number','tax_code','address','postal_code','city','province','pec','sdi_code','tax_regime'];const vals=fields.map(k=>s(b[k]));
  if(vals.some(x=>x.length>250))return fail('Campo troppo lungo');
  if(vals[1]&&!/^\d{11}$/.test(vals[1]))return fail('Partita IVA: inserire 11 cifre');
  await db.prepare(`UPDATE sm_billing_settings SET ${fields.map(k=>k+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(...vals).run();return respond({ok:true});
 }
 if(method==='GET'&&path==='/api/v1/billing/invoices'){
  const rows=await all(db,`SELECT i.id,i.patient_id,i.appointment_id,i.issue_date,i.year,i.series,i.sequence,i.status,i.kind,i.description,i.total_cents,i.created_at,p.first_name,p.last_name,COALESCE((SELECT SUM(amount_cents) FROM sm_invoice_payments m WHERE m.invoice_id=i.id),0) AS paid_cents FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 300`);
  return respond({items:rows});
 }
 if(method==='GET'&&/^\/api\/v1\/billing\/invoices\/[^/]+$/.test(path)){
  const invoice=await one(db,'SELECT * FROM sm_invoices WHERE id=?',path.split('/').pop());if(!invoice)return fail('Documento non trovato',404);
  return respond({invoice,payments:await all(db,'SELECT * FROM sm_invoice_payments WHERE invoice_id=? ORDER BY paid_on,created_at',invoice.id),events:await all(db,'SELECT action,detail,created_at FROM sm_invoice_events WHERE invoice_id=? ORDER BY created_at DESC',invoice.id)});
 }
 if(method==='POST'&&path==='/api/v1/billing/invoices'){
  const b=await body(request),pid=s(b.patient_id),aid=s(b.appointment_id)||null,date=s(b.issue_date),desc=s(b.description),series=s(b.series||'A').toUpperCase(),nature=s(b.vat_nature).toUpperCase();
  if(!validDate(date)||!pid||!desc||desc.length>400||!/^[A-Z0-9]{1,8}$/.test(series)||nature.length>10)return fail('Dati fattura incompleti o non validi');
  const p=await one(db,'SELECT id FROM sm_patients WHERE id=?',pid);if(!p)return fail('Paziente inesistente',404);
  if(aid&&!await one(db,'SELECT id FROM sm_appointments WHERE id=? AND patient_id=?',aid,pid))return fail('Appuntamento non appartenente al paziente');
  const m=calculate(b);const invoiceId=id();
  await db.prepare(`INSERT INTO sm_invoices(id,patient_id,appointment_id,issue_date,year,series,description,quantity,unit_cents,vat_rate_bp,vat_nature,stamp_cents,taxable_cents,vat_cents,total_cents) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(invoiceId,pid,aid,date,Number(date.slice(0,4)),series,desc,m.qty,m.unit,m.vat,nature,m.stamp,m.taxable,m.vatCents,m.total).run();
  await event(db,invoiceId,'bozza_creata');return respond({id:invoiceId,status:'bozza'},201);
 }
 if(method==='POST'&&/^\/api\/v1\/billing\/invoices\/[^/]+\/issue$/.test(path)){
  const invoiceId=path.split('/')[5],inv=await one(db,'SELECT * FROM sm_invoices WHERE id=?',invoiceId);if(!inv)return fail('Documento non trovato',404);
  if(inv.status!=='bozza')return fail('Documento già emesso: non è modificabile',409);
  const issuer=await one(db,'SELECT * FROM sm_billing_settings WHERE id=1');
  if(!issuer?.legal_name||!/^\d{11}$/.test(issuer.vat_number)||!issuer.address||!issuer.city||!issuer.postal_code||!issuer.tax_regime)return fail('Completa prima i dati fiscali dello studio nelle impostazioni');
  const customer=await one(db,'SELECT first_name,last_name,cf,address FROM sm_patients WHERE id=?',inv.patient_id);
  if(!customer?.first_name||!customer?.last_name||!customer.cf)return fail('Completa nome, cognome e codice fiscale del paziente');
  // L'emissione assegna il progressivo con una sola UPDATE SQL; UNIQUE(year,series,sequence)
  // impedisce duplicazioni anche in caso di richieste concorrenti. In caso di conflitto, ritentare.
  const result=await db.prepare(`UPDATE sm_invoices SET sequence=(SELECT COALESCE(MAX(sequence),0)+1 FROM sm_invoices WHERE year=? AND series=? AND status='emessa'),status='emessa',issued_at=CURRENT_TIMESTAMP,issuer_snapshot=?,customer_snapshot=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='bozza' RETURNING sequence`).bind(inv.year,inv.series,JSON.stringify(issuer),JSON.stringify(customer),invoiceId).first();
  if(!result)return fail('Documento già emesso o modificato',409);
  await event(db,invoiceId,'emessa',inv.series+'/'+result.sequence+'/'+inv.year);return respond({ok:true,number:`${inv.series}/${result.sequence}/${inv.year}`});
 }
 if(method==='POST'&&/^\/api\/v1\/billing\/invoices\/[^/]+\/payments$/.test(path)){
  const invoiceId=path.split('/')[5],b=await body(request),amount=Number(b.amount_cents),paidOn=s(b.paid_on),method=s(b.method),reference=s(b.reference);
  if(!Number.isSafeInteger(amount)||amount<=0||!validDate(paidOn)||!['contanti','carta','bonifico','assegno','altro'].includes(method)||reference.length>160)return fail('Pagamento non valido');
  const inv=await one(db,'SELECT id,total_cents,status,kind FROM sm_invoices WHERE id=?',invoiceId);if(!inv)return fail('Fattura non trovata',404);
  if(inv.status!=='emessa'||inv.kind!=='fattura')return fail('I pagamenti si registrano soltanto su fatture emesse');
  // INSERT condizionato evita sovrapagamenti concorrenti: la query è un'unica istruzione D1.
  const paymentId=id();const r=await db.prepare(`INSERT INTO sm_invoice_payments(id,invoice_id,paid_on,amount_cents,method,reference) SELECT ?,?,?,?,?,? WHERE (SELECT total_cents-COALESCE(SUM(amount_cents),0) FROM sm_invoices i LEFT JOIN sm_invoice_payments p ON p.invoice_id=i.id WHERE i.id=? GROUP BY i.id)>=?`).bind(paymentId,invoiceId,paidOn,amount,method,reference,invoiceId,amount).run();
  if(!r.meta?.changes)return fail('Importo superiore al residuo da incassare',409);
  await event(db,invoiceId,'pagamento_registrato',`${amount} centesimi; ${method}`);return respond({id:paymentId},201);
 }
 return fail('Endpoint fatturazione inesistente',404);
 }catch(e){const msg=String(e?.message||e);if(/no such table/i.test(msg))return fail('Eseguire la migrazione 0005_fatturazione.sql',503);if(/UNIQUE constraint failed/i.test(msg))return fail('Documento o progressivo già presente. Aggiorna e riprova.',409);if(/FOREIGN KEY constraint failed/i.test(msg))return fail('Elemento collegato non valido',409);if(/Richiesta troppo grande|non validi|Totale non valido/.test(msg))return fail(msg,400);return fail('Operazione di fatturazione non riuscita',500)}
}
