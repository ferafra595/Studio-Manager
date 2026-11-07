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
// Controlli formali: non certificano l'esistenza o la titolarità della partita IVA.
const fiscalRegimes=new Set(['RF01','RF02','RF04','RF05','RF06','RF07','RF08','RF09','RF10','RF11','RF12','RF13','RF14','RF15','RF16','RF17','RF18','RF19']);
function validVat(v){if(!/^\d{11}$/.test(v))return false;let sum=0;for(let i=0;i<10;i++){let d=Number(v[i]);if(i%2===1){d*=2;if(d>9)d-=9;}sum+=d;}return (10-sum%10)%10===Number(v[10]);}
function validItalianTaxCode(v){if(!v)return true;const cf=v.toUpperCase();if(/^\d{11}$/.test(cf))return validVat(cf);if(!/^[A-Z0-9]{16}$/.test(cf))return false;
 const oddLetters='BAKPLCQDREVOSFTGUHMINJWZYX',oddDigits=[1,0,5,7,9,13,15,17,19,21],even='ABCDEFGHIJKLMNOPQRSTUVWXYZ';let sum=0;
 for(let i=0;i<15;i++){const c=cf[i];if(i%2===0){sum+=/[0-9]/.test(c)?oddDigits[Number(c)]:oddLetters.indexOf(c);}else{sum+=/[0-9]/.test(c)?Number(c):even.indexOf(c);}}return even[sum%26]===cf[15];}
function checkIssuer(b){const x={};for(const k of ['legal_name','vat_number','tax_code','address','postal_code','city','province','pec','sdi_code','tax_regime'])x[k]=s(b[k]);
 if(Object.values(x).some(v=>v.length>250))throw Error('Un campo supera la lunghezza massima');
 if(!x.legal_name||!x.address||!x.city||!x.postal_code||!x.province)throw Error('Compila denominazione e indirizzo completo dello studio');
 if(!validVat(x.vat_number))throw Error('Partita IVA non valida: controlla le 11 cifre e il codice di controllo');
 if(x.tax_code&&!validItalianTaxCode(x.tax_code))throw Error('Codice fiscale non valido: verifica il codice di controllo');
 if(!/^\d{5}$/.test(x.postal_code))throw Error('CAP: sono richieste cinque cifre');
 if(!/^[A-Z]{2}$/.test(x.province.toUpperCase()))throw Error('Provincia: inserisci due lettere');
 if(!fiscalRegimes.has(x.tax_regime.toUpperCase()))throw Error('Seleziona un regime fiscale valido');
 if(x.pec&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.pec))throw Error('Indirizzo PEC non valido');
 if(x.sdi_code&&!/^[A-Z0-9]{7}$/i.test(x.sdi_code))throw Error('Codice destinatario: sono richiesti sette caratteri alfanumerici');
 x.province=x.province.toUpperCase();x.tax_regime=x.tax_regime.toUpperCase();x.sdi_code=x.sdi_code.toUpperCase();x.tax_code=x.tax_code.toUpperCase();return x;
}

// Fase 9: righe multiple in bozza. Importi sempre in centesimi; il server ricalcola i totali.
function checkLines(raw){
 if(!Array.isArray(raw)||raw.length<1||raw.length>30)throw Error('Inserisci da 1 a 30 prestazioni');
 return raw.map((x,i)=>{
  const description=s(x.description),quantity=Number(x.quantity),unit=Number(x.unit_cents),rate=Number(x.vat_rate_bp),nature=s(x.vat_nature).toUpperCase();
  if(!description||description.length>400||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000||!money(unit)||!Number.isSafeInteger(rate)||rate<0||rate>10000||!/^([A-Z][0-9](?:\.[0-9]+)?)?$/.test(nature)||nature.length>10)throw Error('Prestazione '+(i+1)+' non valida');
  if(rate>0&&nature)throw Error('Non indicare una natura di esenzione con IVA diversa da zero');
  if(rate===0&&!nature)throw Error('Indica la natura IVA della prestazione senza IVA (da verificare fiscalmente)');
  const taxable=quantity*unit,vat=Math.round(taxable*rate/10000);
  if(!Number.isSafeInteger(taxable+vat)||taxable+vat>100000000)throw Error('Importo prestazione troppo elevato');
  return {description,quantity,unit,rate,nature,taxable,vat};
 });
}
async function invoiceLinesApi(db,request,path){
 const method=request.method;
 const match=path.match(/^\/api\/v1\/billing\/invoices\/([^/]+)\/lines$/);
 if(!match)return null;
 const invoiceId=match[1];
 const inv=await one(db,'SELECT * FROM sm_invoices WHERE id=?',invoiceId);
 if(!inv)return fail('Documento inesistente',404);
 if(method==='GET'){
  const lines=await all(db,'SELECT position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents FROM sm_invoice_lines WHERE invoice_id=? ORDER BY position',invoiceId);
  return respond({items:lines.length?lines:[{position:1,description:inv.description,quantity:inv.quantity,unit_cents:inv.unit_cents,vat_rate_bp:inv.vat_rate_bp,vat_nature:inv.vat_nature,taxable_cents:inv.taxable_cents,vat_cents:inv.vat_cents}]});
 }
 if(method!=='PUT')return fail('Metodo non consentito',405);
 if(inv.status!=='bozza'||inv.kind!=='fattura')return fail('Solo le bozze di fattura possono essere modificate',409);
 const payload=await body(request),lines=checkLines(payload.lines),stamp=Number(payload.stamp_cents);
 if(![0,200].includes(stamp))return fail('Bollo non valido');
 const taxable=lines.reduce((a,l)=>a+l.taxable,0),vat=lines.reduce((a,l)=>a+l.vat,0),total=taxable+vat+stamp;
 if(!Number.isSafeInteger(total)||total<=0||total>100000000)return fail('Totale non valido');
 const statements=[db.prepare('DELETE FROM sm_invoice_lines WHERE invoice_id=?').bind(invoiceId)];
 lines.forEach((l,i)=>statements.push(db.prepare('INSERT INTO sm_invoice_lines(id,invoice_id,position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id(),invoiceId,i+1,l.description,l.quantity,l.unit,l.rate,l.nature,l.taxable,l.vat)));
 statements.push(db.prepare(`UPDATE sm_invoices SET description=?,quantity=?,unit_cents=?,vat_rate_bp=?,vat_nature=?,stamp_cents=?,taxable_cents=?,vat_cents=?,total_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='bozza'`).bind(lines[0].description,lines[0].quantity,lines[0].unit,lines[0].rate,lines[0].nature,stamp,taxable,vat,total,invoiceId));
 // D1 batch esegue in transazione: righe e totale restano coerenti.
 await db.batch(statements);
 await event(db,invoiceId,'righe_aggiornate',`${lines.length} prestazioni`);
 return respond({ok:true,total_cents:total});
}

export async function fatture({request,env},path){const db=env.DB;if(!db)return fail('Binding D1 non configurato',503);
 const method=request.method;
 try{
 if(/^\/api\/v1\/billing\/invoices\/[^/]+\/lines$/.test(path))return await invoiceLinesApi(db,request,path);
 if(method==='GET'&&path==='/api/v1/billing/status'){
  const names=await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sm_invoices','sm_invoice_payments','sm_billing_settings')");return respond({ready:names.length===3,live_fiscal_transmission:false});
 }
 if(method==='GET'&&path==='/api/v1/billing/settings')return respond({settings:await one(db,'SELECT * FROM sm_billing_settings WHERE id=1')});
 if(method==='PUT'&&path==='/api/v1/billing/settings'){
  const b=await body(request);const validated=checkIssuer(b);const fields=['legal_name','vat_number','tax_code','address','postal_code','city','province','pec','sdi_code','tax_regime'];const vals=fields.map(k=>validated[k]);
  await db.prepare(`UPDATE sm_billing_settings SET ${fields.map(k=>k+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=1`).bind(...vals).run();return respond({ok:true});
 }
 if(method==='GET'&&path==='/api/v1/billing/invoices'){
  const rows=await all(db,`SELECT i.id,i.patient_id,i.appointment_id,i.issue_date,i.year,i.series,i.sequence,i.status,i.kind,i.description,i.total_cents,i.created_at,p.first_name,p.last_name,COALESCE((SELECT SUM(amount_cents) FROM sm_invoice_payments m WHERE m.invoice_id=i.id),0) AS paid_cents FROM sm_invoices i JOIN sm_patients p ON p.id=i.patient_id ORDER BY i.created_at DESC LIMIT 300`);
  return respond({items:rows});
 }
 if(method==='GET'&&/^\/api\/v1\/billing\/invoices\/[^/]+$/.test(path)){
  const invoice=await one(db,'SELECT * FROM sm_invoices WHERE id=?',path.split('/').pop());if(!invoice)return fail('Documento non trovato',404);
  return respond({invoice,lines:await all(db,'SELECT position,description,quantity,unit_cents,vat_rate_bp,vat_nature,taxable_cents,vat_cents FROM sm_invoice_lines WHERE invoice_id=? ORDER BY position',invoice.id),payments:await all(db,'SELECT * FROM sm_invoice_payments WHERE invoice_id=? ORDER BY paid_on,created_at',invoice.id),events:await all(db,'SELECT action,detail,created_at FROM sm_invoice_events WHERE invoice_id=? ORDER BY created_at DESC',invoice.id)});
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
  try{checkIssuer(issuer||{});}catch(e){return fail('Dati fiscali dello studio da correggere: '+e.message);}
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
 }catch(e){const msg=String(e?.message||e);if(/no such table: sm_invoice_lines/i.test(msg))return fail('Eseguire la migrazione 0006_righe_fattura.sql',503);if(/no such table/i.test(msg))return fail('Eseguire la migrazione 0005_fatturazione.sql',503);if(/UNIQUE constraint failed/i.test(msg))return fail('Documento o progressivo già presente. Aggiorna e riprova.',409);if(/FOREIGN KEY constraint failed/i.test(msg))return fail('Elemento collegato non valido',409);if(/Richiesta troppo grande|prestazioni|Prestazione|natura IVA|Bollo non valido|Importo prestazione|non validi|Totale non valido|Partita IVA|Codice fiscale|CAP:|Provincia:|regime fiscale|PEC|destinatario|Compila denominazione|lunghezza massima/.test(msg))return fail(msg,400);return fail('Operazione di fatturazione non riuscita',500)}
}
