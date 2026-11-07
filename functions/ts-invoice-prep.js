// Preparazione manuale di dati TS collegati a fatture emesse e incassate.
// NON trasmette al TS, non converte né espone i CF al server Render.
const out=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const bad=(message,status=400)=>out({error:message},status);
const one=(db,q,...a)=>db.prepare(q).bind(...a).first();
const all=async(db,q,...a)=>(await db.prepare(q).bind(...a).all()).results||[];
const validTypes=new Set(['TK','FC','FV','AS','SR','CT','PI','IC','AA','AD','SV','SP']);
const uuid=()=>crypto.randomUUID();
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+'T12:00:00Z'))&&new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
async function eligible(db,invoiceId){
 const invoice=await one(db,`SELECT i.*,p.cf,p.first_name,p.last_name FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id WHERE i.id=?`,invoiceId);
 if(!invoice)return {error:'Fattura non trovata',code:404};
 if(invoice.status!=='emessa'||invoice.kind!=='fattura'||!invoice.sequence)return {error:'È richiesta una fattura regolarmente emessa'};
 if(!date(invoice.issue_date)||!invoice.issuer_snapshot||!invoice.customer_snapshot)return {error:'Dati di emissione e snapshot fiscali incompleti'};
 const credit=await one(db,`SELECT id FROM sm_invoices WHERE kind='nota_credito' AND original_invoice_id=? AND status='emessa' LIMIT 1`,invoiceId);
 if(credit)return {error:'Esiste una nota di credito emessa: richiesta riconciliazione manuale dello storno prima di procedere'};
 let issuer,customer;try{issuer=JSON.parse(invoice.issuer_snapshot);customer=JSON.parse(invoice.customer_snapshot)}catch{return {error:'Snapshot fiscali non leggibili'}};
 if(!issuer?.vat_number||!issuer?.legal_name||!customer?.cf)return {error:'Dati fiscali storicizzati incompleti'};
 if(String(customer.cf).toUpperCase()!==String(invoice.cf).toUpperCase())return {error:'Il CF del paziente è cambiato rispetto alla fattura emessa: verifica documentale necessaria'};
 if(!/^[A-Z0-9]{16}$/i.test(String(invoice.cf||'')))return {error:'Codice fiscale paziente formalmente incompleto'};
 const payments=await all(db,`SELECT id,paid_on,amount_cents,method FROM sm_invoice_payments WHERE invoice_id=? ORDER BY created_at`,invoiceId);
 if(payments.length!==1||payments[0].amount_cents!==invoice.total_cents)return {error:'Per questa fase sono ammesse soltanto fatture saldate con un unico pagamento integrale'};
 if(!date(payments[0].paid_on)||!['contanti','carta','bonifico','assegno'].includes(payments[0].method))return {error:'Data o modalità di pagamento non verificabile'};
 const lines=await all(db,`SELECT id,position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents FROM sm_invoice_lines WHERE invoice_id=? ORDER BY position`,invoiceId);
 if(!lines.length)return {error:'Fattura priva delle righe di prestazione'};
 if(lines.some(l=>!Number.isSafeInteger(l.taxable_cents)||!Number.isSafeInteger(l.vat_cents)||l.taxable_cents+l.vat_cents<=0))return {error:'Importi delle prestazioni da verificare'};
 if(lines.reduce((sum,l)=>sum+l.taxable_cents+l.vat_cents,0)+invoice.stamp_cents!==invoice.total_cents)return {error:'Totali non coerenti con le righe fattura'};
 if(lines.some(l=>l.vat_rate_bp>0&&l.vat_nature||l.vat_rate_bp===0&&!l.vat_nature))return {error:'Aliquota IVA o natura IVA da correggere sulle righe'};
 return {invoice,payment:payments[0],lines};
}
// Impronta dei dati fiscalmente rilevanti: solo nel DB, mai in interfaccia.
async function fingerprint(e,types,opposition){
 const canonical=JSON.stringify({invoice:{id:e.invoice.id,number:e.invoice.sequence,year:e.invoice.year,series:e.invoice.series,date:e.invoice.issue_date,amount:e.invoice.total_cents,stamp:e.invoice.stamp_cents,issuer:e.invoice.issuer_snapshot,customer:e.invoice.customer_snapshot,cf:e.invoice.cf},payment:e.payment,lines:e.lines,types,opposition});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));
 return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function reviewInfo(db,invoiceId){
 const prep=await one(db,'SELECT * FROM sm_ts_invoice_preparations WHERE invoice_id=?',invoiceId);
 if(!prep)return {error:'Fattura non ancora preparata',code:404};
 const e=await eligible(db,invoiceId);
 if(e.error)return {preparation:prep,review:null,valid:false,problems:[e.error]};
 let types;try{types=JSON.parse(prep.expense_types_json)}catch{types=[]}
 if(!Array.isArray(types)||types.length!==e.lines.length||types.some((t,i)=>t.line_id!==e.lines[i].id||!validTypes.has(t.expense_type)))return {preparation:prep,review:null,valid:false,problems:['Classificazione delle righe cambiata o non valida']};
 const hash=await fingerprint(e,types,prep.opposition);
 const review=await one(db,'SELECT created_at,invoice_fingerprint,reviewer FROM sm_ts_invoice_reviews WHERE preparation_id=?',prep.id);
 const valid=!!review&&review.invoice_fingerprint===hash&&prep.opposition===0;
 return {preparation:prep,review:review?{created_at:review.created_at,reviewer:review.reviewer}:null,valid,problems:review&&!valid?['Dati fiscali o pagamento cambiati dalla verifica, oppure opposizione registrata']:[],opposition:!!prep.opposition,eligible:true,hash};
}
export async function tsInvoicePreparation({request,env},path){
 const db=env.DB;if(!db)return bad('Database D1 non configurato',503);
 try{
  if(request.method==='GET'&&path==='/api/v1/ts/invoice-preparations'){
   const rows=await all(db,`SELECT i.id,i.issue_date,i.series,i.sequence,i.year,i.total_cents,p.first_name,p.last_name,
    x.id AS preparation_id,x.status AS ts_status,x.opposition,rv.created_at AS reviewed_at,
    (SELECT COALESCE(SUM(amount_cents),0) FROM sm_invoice_payments m WHERE m.invoice_id=i.id) paid_cents,
    (SELECT COUNT(*) FROM sm_invoice_payments m WHERE m.invoice_id=i.id) payment_count
    FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id
    LEFT JOIN sm_ts_invoice_preparations x ON x.invoice_id=i.id
    LEFT JOIN sm_ts_invoice_reviews rv ON rv.preparation_id=x.id
    WHERE i.status='emessa' AND i.kind='fattura' ORDER BY i.issued_at DESC LIMIT 200`);
   return out({items:rows,live_transmission_enabled:false,notice:'Preparazione e revisione interna: nessun invio di fatture al Sistema TS.'});
  }
  const reviewMatch=path.match(/^\/api\/v1\/ts\/invoice-preparations\/([^/]+)\/review$/);
  if(reviewMatch){
   const invoiceId=decodeURIComponent(reviewMatch[1]);if(invoiceId.length>100)return bad('ID non valido');
   const result=await reviewInfo(db,invoiceId);
   if(request.method==='GET')return out({reviewed:result.valid===true,review:result.review||null,problems:result.problems||[],opposition:result.opposition??null,transmitted:false});
   if(request.method!=='POST')return bad('Metodo non consentito',405);
   if(Number(request.headers.get('content-length')||0)>1024)return bad('Richiesta troppo grande',413);
   const body=await request.json();
   if(body?.confirmation!=='CONFERMO VERIFICA FISCALE TS'||body?.payment_checked!==true||body?.classification_checked!==true||body?.issuer_checked!==true||Object.keys(body).length!==4)
    return bad('Richiesta una verifica manuale esplicita di pagamento, prestazioni e dati fiscali',400);
   if(result.error)return bad(result.error,result.code||422);
   if(result.problems?.length)return bad(result.problems.join('; '),422);
   if(result.opposition)return bad('Opposizione registrata: nessuna abilitazione alla trasmissione',409);
   await db.batch([
    db.prepare('INSERT INTO sm_ts_invoice_reviews(preparation_id,invoice_fingerprint,reviewer) VALUES(?,?,?) ON CONFLICT(preparation_id) DO UPDATE SET invoice_fingerprint=excluded.invoice_fingerprint,reviewer=excluded.reviewer,created_at=CURRENT_TIMESTAMP').bind(result.preparation.id,result.hash,'ADMIN'),
    db.prepare('INSERT INTO sm_ts_invoice_prep_events(id,preparation_id,action,description) VALUES(?,?,?,?)').bind(uuid(),result.preparation.id,'verifica_manual','Revisione documentale effettuata: non autorizza invio automatico')
   ]);
   return out({reviewed:true,transmitted:false,notice:'Revisione interna registrata. Invio reale non abilitato.'});
  }
  const match=path.match(/^\/api\/v1\/ts\/invoice-preparations\/([^/]+)$/);
  if(!match)return bad('Endpoint non disponibile',404);
  const invoiceId=decodeURIComponent(match[1]);if(invoiceId.length>100)return bad('ID non valido');
  // Elimina la SOLA preparazione TS interna, mai trasmessa; fattura originale intatta.
  if(request.method==='DELETE'){
   const prep=await one(db,'SELECT id,status FROM sm_ts_invoice_preparations WHERE invoice_id=?',invoiceId);
   if(!prep)return bad('Preparazione TS non trovata',404);
   if(!['da_verificare','opposizione_registrata'].includes(prep.status))return bad('Preparazione già trasmessa o protetta',409);
   const unsafe=await one(db,"SELECT id FROM sm_ts_invoice_prep_events WHERE preparation_id=? AND (lower(action) LIKE '%invi%' OR lower(action) LIKE '%trasm%' OR lower(action) LIKE '%accett%' OR lower(action) LIKE '%scart%') LIMIT 1",prep.id);
   if(unsafe)return bad('Preparazione con storico di trasmissione: cancellazione bloccata',409);
   const result=await db.batch([
    db.prepare('DELETE FROM sm_ts_invoice_reviews WHERE preparation_id=?').bind(prep.id),
    db.prepare('DELETE FROM sm_ts_invoice_prep_events WHERE preparation_id=?').bind(prep.id),
    db.prepare("DELETE FROM sm_ts_invoice_preparations WHERE id=? AND status IN ('da_verificare','opposizione_registrata')").bind(prep.id)
   ]);
   if(!result[2]?.meta?.changes)return bad('Preparazione non eliminata',409);
   return out({ok:true,deleted:true,invoice_unchanged:true});
  }
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
  if(/no such table: sm_ts_invoice_reviews/i.test(msg))return bad('Applicare la migrazione 0008_ts_revisioni.sql',503);
  if(/no such table/i.test(msg))return bad('Applicare la migrazione 0007_ts_fatture_preparazione.sql',503);
  if(/UNIQUE constraint failed/i.test(msg))return bad('Fattura già preparata',409);
  if(/Tipologia TS/.test(msg))return bad(msg,400);
  return bad('Preparazione fattura non riuscita',500);
 }
}
