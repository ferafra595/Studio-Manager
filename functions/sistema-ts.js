// Sistema TS: gestione documenti e controlli preliminari. Nessuna trasmissione reale finché
// non sono stati verificati WSDL, certificati, autorizzazione e test ufficiale.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'}});
const err=(message,status=400)=>json({error:message},status);
const uid=()=>crypto.randomUUID();
const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&!Number.isNaN(Date.parse(s+'T12:00:00Z'));
const clean=x=>String(x??'').trim();
const all=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export async function sistemaTS({request,env},path){
 const db=env.DB;if(!db)return err('Database non configurato',503);
 try{
  // Verifica SOLO raggiungibilità del servizio di TEST. Non trasmette credenziali o dati.
  if(request.method==='GET'&&path==='/api/v1/ts/test-connection'){
   const endpoint='https://invioSS730pTest.sanita.finanze.it/DocumentoSpesa730pWeb/DocumentoSpesa730pPort';
   try {
    const response=await fetch(endpoint+'?wsdl',{
     method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),
     headers:{'accept':'text/xml, application/xml'}
    });
    const contentType=response.headers.get('content-type')||'';
    // Non leggere né riportare il corpo della risposta: può contenere dettagli del server.
    return json({environment:'TEST',endpoint,transport_reachable:response.status!==526,tls_verified:response.status!==526,http_status:response.status,
      content_type:contentType.slice(0,100),wsdl_available:response.ok&&/xml/i.test(contentType),
      diagnosis:response.status===526?'TLS_CERTIFICATE_VALIDATION_FAILED':response.ok?'HTTP_OK':'HTTP_ERROR',
      next_step:response.status===526?'Verificare catena di fiducia TLS con il gestore del servizio TS; Cloudflare Workers non consente di disabilitare la verifica TLS o impostare una CA personalizzata per fetch. Non inviare credenziali.':null,
      authenticated:false,transmission_tested:false,
      notice:'Diagnostica di rete soltanto. Nessuna credenziale o fattura è stata inviata.'});
   }catch(e){
    return json({environment:'TEST',endpoint,transport_reachable:false,
      reason:e?.name==='TimeoutError'?'timeout':'connessione_non_riuscita',
      authenticated:false,transmission_tested:false,
      notice:'Nessuna credenziale o fattura è stata inviata.'},200);
   }
  }
  if(request.method==='GET'&&path==='/api/v1/ts/status'){
   const tables=await all(db,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sm_ts_documents','sm_ts_events')");
   return json({schema_ready:tables.length===2,mode:'preparazione',live_transmission_enabled:false,credentials_configured:!!(env.TS_USERNAME&&env.TS_PASSWORD&&env.TS_PINCODE),notice:'La presenza delle credenziali non abilita l’invio: verificare WSDL, autorizzazioni e certificati ufficiali.'});
  }
  if(request.method==='GET'&&path==='/api/v1/ts/documents'){
   return json({items:await all(db,`SELECT d.id,d.document_number,d.document_date,d.payment_date,d.payment_method,d.total_cents,d.expense_type,d.opposition,d.status,d.protocol,d.last_error,d.created_at,p.first_name,p.last_name FROM sm_ts_documents d JOIN sm_patients p ON p.id=d.patient_id ORDER BY d.created_at DESC LIMIT 200`)});
  }
  if(request.method==='POST'&&path==='/api/v1/ts/documents'){
   if(Number(request.headers.get('content-length')||0)>8192)return err('Richiesta troppo grande',413);
   const b=await request.json();const patient_id=clean(b.patient_id),appointment_id=clean(b.appointment_id)||null,document_number=clean(b.document_number),document_date=clean(b.document_date),payment_date=clean(b.payment_date),payment_method=clean(b.payment_method),expense_type=clean(b.expense_type).toUpperCase(),total_cents=Number(b.total_cents);
   if(!patient_id||!document_number||document_number.length>80||!date(document_date)||!date(payment_date)||!['contanti','tracciabile','altro'].includes(payment_method)||!Number.isSafeInteger(total_cents)||total_cents<=0||!/^[A-Z0-9]{1,5}$/.test(expense_type)||![true,false,0,1,undefined].includes(b.opposition))return err('Dati documento incompleti o non validi');
   if(!await one(db,'SELECT id FROM sm_patients WHERE id=?',patient_id))return err('Paziente inesistente',404);
   if(appointment_id&&!await one(db,'SELECT id FROM sm_appointments WHERE id=? AND patient_id=?',appointment_id,patient_id))return err('Appuntamento non associato al paziente',400);
   const id=uid();await db.prepare(`INSERT INTO sm_ts_documents(id,patient_id,appointment_id,document_number,document_date,payment_date,payment_method,total_cents,expense_type,opposition,status) VALUES(?,?,?,?,?,?,?,?,?,?,'bozza')`).bind(id,patient_id,appointment_id,document_number,document_date,payment_date,payment_method,total_cents,expense_type,Number(!!b.opposition)).run();
   await db.prepare('INSERT INTO sm_ts_events(id,document_id,event_type) VALUES(?,?,?)').bind(uid(),id,'bozza_creata').run();
   return json({id,status:'bozza',sent:false},201);
  }
  if(request.method==='POST'&&/^\/api\/v1\/ts\/documents\/[^/]+\/validate$/.test(path)){
   const id=path.split('/')[5];const d=await one(db,'SELECT d.*,p.cf FROM sm_ts_documents d JOIN sm_patients p ON p.id=d.patient_id WHERE d.id=?',id);
   if(!d)return err('Documento non trovato',404);
   const problems=[];
   if(!/^[A-Z0-9]{16}$/.test(clean(d.cf).toUpperCase()))problems.push('Codice fiscale del paziente assente o non valido');
   if(!date(d.document_date)||!date(d.payment_date))problems.push('Date non valide');
   if(!Number.isSafeInteger(d.total_cents)||d.total_cents<=0)problems.push('Importo non valido');
   if(!['contanti','tracciabile','altro'].includes(d.payment_method))problems.push('Modalità di pagamento non valida');
   // I codici di spesa e le regole fiscali vanno convalidati sulle specifiche TS correnti.
   problems.push('Verifica obbligatoria della tipologia di spesa, regime fiscale e soggetto inviante sulle specifiche ufficiali');
   await db.prepare("UPDATE sm_ts_documents SET status='da_verificare',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('bozza','da_verificare')").bind(id).run();
   return json({id,valid_for_transmission:false,problems,notice:'Non è stata effettuata alcuna trasmissione.'});
  }
  if(path.endsWith('/send'))return err('Invio TS disabilitato: manca collaudo ufficiale del connettore e autorizzazione del soggetto inviante',501);
  return err('Endpoint TS non disponibile',404);
 }catch(e){if(/no such table/i.test(String(e)))return err('Eseguire la migrazione 0004_sistema_ts.sql',503);if(/UNIQUE constraint failed/i.test(String(e)))return err('Documento fiscale già registrato',409);return err('Operazione TS non riuscita; controllare i dati e la configurazione',500)}
}
