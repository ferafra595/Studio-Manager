// Preparazione manuale di dati TS collegati a fatture emesse e incassate.
// NON trasmette al TS, non converte né espone i CF al server Render.
const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bad=(message,status=400)=>out({error:message},status);
const one=(db,q,...a)=>db.prepare(q).bind(...a).first();
const all=async(db,q,...a)=>(await db.prepare(q).bind(...a).all()).results||[];
const validTypes=new Set(['TK','FC','FV','AS','SR','CT','PI','IC','AA','AD','SV','SP']);
const uuid=()=>crypto.randomUUID();
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'));
async function eligible(db,invoiceId){
 const invoice=await one(db,`SELECT i.*,p.cf,p.first_name,p.last_name FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id WHERE i.id=?`,invoiceId);
 if(!invoice)return {error:'Fattura non trovata',code:404};
 if(invoice.status!=='emessa'||invoice.kind!=='fattura'||!invoice.sequence)return {error:'È richiesta una fattura regolarmente emessa'};
 if(!date(invoice.issue_date)||!invoice.issuer_snapshot||!invoice.customer_snapshot)return {error:'Dati di emissione e snapshot fiscali incompleti'};
 if(!/^[A-Z0-9]{16}$/i.test(String(invoice.cf||'')))return {error:'Codice fiscale paziente formalmente incompleto'};
 const payments=await all(db,`SELECT id,paid_on,amount_cents,method FROM sm_invoice_payments WHERE invoice_id=? ORDER BY created_at`,invoiceId);
 if(payments.length!==1||payments[0].amount_cents!==invoice.total_cents)return {error:'Per questa fase sono ammesse soltanto fatture saldate con un unico pagamento integrale'};
 if(!date(payments[0].paid_on)||!['contanti','carta','bonifico','assegno'].includes(payments[0].method))return {error:'Data o modalità di pagamento non verificabile'};
 const lines=await all(db,`SELECT id,position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents FROM sm_invoice_lines WHERE invoice_id=? ORDER BY position`,invoiceId);
 if(!lines.length)return {error:'Fattura priva delle righe di prestazione'};
 if(lines.some(l=>!Number.isSafeInteger(l.taxable_cents)||!Number.isSafeInteger(l.vat_cents)||l.taxable_cents+l.vat_cents<=0))return {error:'Importi delle prestazioni da verificare'};
 if(lines.reduce((sum,l)=>sum+l.taxable_cents+l.vat_cents,0)+invoice.stamp_cents!==invoice.total_cents)return {error:'Totali non coerenti con le righe fattura'};
 return {invoice,payment:payments[0],lines};
}
export async function tsInvoicePreparation({request,env},path){
 const db=env.DB;if(!db)return bad('Database D1 non configurato',503);
 try{
  if(request.method==='GET'&&path==='/api/v1/ts/invoice-preparations'){
   const rows=await all(db,`SELECT i.id,i.issue_date,i.series,i.sequence,i.year,i.total_cents,p.first_name,p.last_name,
    x.id AS preparation_id,x.status AS ts_status,x.opposition,
    (SELECT COALESCE(SUM(amount_cents),0) FROM sm_invoice_payments m WHERE m.invoice_id=i.id) paid_cents,
    (SELECT COUNT(*) FROM sm_invoice_payments m WHERE m.invoice_id=i.id) payment_count
    FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id
    LEFT JOIN sm_ts_invoice_preparations x ON x.invoice_id=i.id
    WHERE i.status='emessa' AND i.kind='fattura' ORDER BY i.issued_at DESC LIMIT 200`);
   return out({items:rows,live_transmission_enabled:false,notice:'Preparazione interna: nessun invio di fatture al Sistema TS.'});
  }
  const match=path.match(/^\/api\/v1\/ts\/invoice-preparations\/([^/]+)$/);
  if(!match)return bad('Endpoint non disponibile',404);
  const invoiceId=decodeURIComponent(match[1]);if(invoiceId.length>100)return bad('ID non valido');
  if(request.method==='GET'){
   const e=await eligible(db,invoiceId);
   if(e.error)return bad(e.error,e.code||422);
   const existing=await one(db,'SELECT id,status,opposition,expense_types_json FROM sm_ts_invoice_preparations WHERE invoice_id=?',invoiceId);
   return out({invoice:{id:e.invoice.id,number:`${e.invoice.series}/${e.invoice.sequence}/${e.invoice.year}`,issue_date:e.invoice.issue_date,total_cents:e.invoice.total_cents},payment:e.payment,lines:e.lines,existing,notice:'Classificazioni TS da verificare da operatore autorizzato.'});
  }
  if(request.method!=='POST')return bad('Metodo non consentito',405);
  if(Number(request.headers.get('content-length')||0)>6000)return bad('Richiesta troppo grande',413);
  const body=await request.json();
  if(body?.review_confirmed!==true||![true,false].includes(body.opposition)||!Array.isArray(body.types))return bad('Richiesta la conferma dell’operatore e una scelta esplicita sull’opposizione');
  const e=await eligible(db,invoiceId);if(e.error)return bad(e.error,e.code||422);
  if(e.lines.length!==body.types.length)return bad('Classificazione richiesta per ciascuna riga');
  const classifications=e.lines.map((line,index)=>{
   const item=body.types[index];
   if(!item||item.line_id!==line.id||!validTypes.has(item.expense_type))throw Error('Tipologia TS non valida o riga diversa dalla fattura');
   return {line_id:line.id,expense_type:item.expense_type};
  });
  const preparationId=uuid();
  const existing=await one(db,'SELECT id FROM sm_ts_invoice_preparations WHERE invoice_id=?',invoiceId);
  if(existing)return bad('Fattura già preparata; non creare duplicati',409);
  const status=body.opposition?'opposizione_registrata':'da_verificare';
  const statements=[
   db.prepare(`INSERT INTO sm_ts_invoice_preparations(id,invoice_id,payment_id,opposition,expense_types_json,status) VALUES(?,?,?,?,?,?)`).bind(preparationId,invoiceId,e.payment.id,Number(body.opposition),JSON.stringify(classifications),status),
   db.prepare('INSERT INTO sm_ts_invoice_prep_events(id,preparation_id,action,description) VALUES(?,?,?,?)').bind(uuid(),preparationId,'preparazione_creata',body.opposition?'Opposizione registrata; nessun invio':'Attesa verifica fiscale e autorizzazione inviante')
  ];
  await db.batch(statements);
  return out({id:preparationId,status,transmitted:false,notice:'Documento NON trasmesso; nessun collegamento alla produzione.'},201);
 }catch(e){const msg=String(e?.message||e);
  if(/no such table/i.test(msg))return bad('Applicare la migrazione 0007_ts_fatture_preparazione.sql',503);
  if(/UNIQUE constraint failed/i.test(msg))return bad('Fattura già preparata',409);
  if(/Tipologia TS/.test(msg))return bad(msg,400);
  return bad('Preparazione fattura non riuscita',500);
 }
}
