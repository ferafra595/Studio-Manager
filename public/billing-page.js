// Gestione fatture in sviluppo: nessuna trasmissione fiscale, nessun PDF fiscale certificato.
async function renderBilling(){
 const main=$('#main');main.innerHTML=`<div class="top"><div><h2>Fatturazione dello studio</h2><p class="sub">Unico emittente · bozze, emissione numerata, pagamenti e storico. Ambiente di sviluppo.</p></div><div class="row"><button id="bill-settings">Dati fiscali studio</button><button class="primary" id="bill-new">+ Nuova fattura</button></div></div><section class="card"><div id="bill-status">Verifica database…</div></section><section class="card"><h2>Registro fatture</h2><div id="bill-list">Caricamento…</div></section>`;
 $('#bill-new').onclick=billingNew;$('#bill-settings').onclick=billingSettings;
 try{const [status,data]=await Promise.all([api('v1/billing/status'),api('v1/billing/invoices')]);if(page!=='fatture')return;
 $('#bill-status').textContent=status.ready?'Archivio disponibile. Invio a Sistema TS e SdI non attivo.':'Database fatture non pronto: esegui migrations/0005_fatturazione.sql in Cloudflare D1.';
 const items=data.items||[];
 $('#bill-list').innerHTML=items.length?`<div class="table-wrap"><table><thead><tr><th>Numero</th><th>Data</th><th>Paziente</th><th>Totale</th><th>Incassato</th><th>Stato</th><th></th></tr></thead><tbody>${items.map(i=>`<tr><td>${i.sequence?esc(i.series+'/'+i.sequence+'/'+i.year):'Bozza'}</td><td>${esc(i.issue_date)}</td><td>${esc(i.last_name)} ${esc(i.first_name)}</td><td>${euro(i.total_cents)}</td><td>${euro(i.paid_cents)}</td><td>${esc(i.status)}</td><td><button data-bill-open="${esc(i.id)}">Dettagli</button></td></tr>`).join('')}</tbody></table></div>`:'<p>Nessuna fattura registrata.</p>';
 $$('[data-bill-open]').forEach(b=>b.onclick=()=>billingDetail(b.dataset.billOpen));
 }catch(e){if(page==='fatture')$('#bill-list').textContent=e.message}
}
function billingNew(){const pts=state.patients||[];if(!pts.length){toast('Crea prima un paziente di prova');return}
 const appts=state.appointments||[];
 modal('Nuova bozza fattura',`<p class="sub">Questa operazione crea una bozza. La numerazione viene assegnata solo con «Emetti».</p>`+form(
 select('Paziente','patient_id',pts.map(p=>[p.id,fullname(p)]))+
 select('Appuntamento (facoltativo)','appointment_id',[['','Nessuno'],...appts.map(a=>[a.id,`${a.start_at} · ${fullname(pat(a.patient_id))}`])])+
 field('Data fattura','issue_date',today(),'date',true)+field('Serie','series','A','text',true,'maxlength="8"')+
 field('Prestazione / descrizione','description','','text',true,'maxlength="400"')+
 field('Quantità','quantity','1','number',true,'min="1" max="10000"')+
 field('Prezzo unitario €','unit_eur','','number',true,'min="0" step="0.01"')+
 field('Aliquota IVA %','vat_pct','0','number',true,'min="0" max="100" step="0.01"')+
 field('Natura IVA (se applicabile)','vat_nature','','text',false,'maxlength="10"')+
 select('Imposta di bollo','stamp_cents',[['0','Nessuna'],['200','€ 2,00']]),'Salva bozza'),()=>bindForm(async b=>{
 const cents=billingCents(b.unit_eur),vat=billingPercent(b.vat_pct);
 await api('v1/billing/invoices','POST',{patient_id:b.patient_id,appointment_id:b.appointment_id||null,issue_date:b.issue_date,series:b.series,description:b.description,quantity:Number(b.quantity),unit_cents:cents,vat_rate_bp:vat,vat_nature:b.vat_nature,stamp_cents:Number(b.stamp_cents)});
 setTimeout(()=>{if(page==='fatture')renderBilling()},0)
 }))
}
function billingCents(value){const v=String(value).trim();if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error('Importo: usa massimo due decimali, separati dal punto');const [a,b='']=v.split('.');const n=Number(a)*100+Number(b.padEnd(2,'0'));if(!Number.isSafeInteger(n))throw Error('Importo troppo grande');return n}
function billingPercent(value){return billingCents(value)}
async function billingSettings(){try{const r=await api('v1/billing/settings'),v=r.settings||{};
 modal('Dati fiscali emittente',`<p class="sub">I dati saranno congelati nelle fatture al momento dell'emissione. Verifica con il commercialista regime, IVA, natura e bollo.</p>`+form(
 field('Ragione sociale / denominazione','legal_name',v.legal_name,'text',true)+field('Partita IVA','vat_number',v.vat_number,'text',true,'pattern="[0-9]{11}"')+
 field('Codice fiscale','tax_code',v.tax_code)+field('Indirizzo','address',v.address,'text',true)+
 field('CAP','postal_code',v.postal_code,'text',true)+field('Comune','city',v.city,'text',true)+field('Provincia','province',v.province)+
 field('Regime fiscale (codice)','tax_regime',v.tax_regime,'text',true)+field('PEC','pec',v.pec,'email')+field('Codice destinatario','sdi_code',v.sdi_code),'Salva dati studio'),()=>bindForm(async b=>{await api('v1/billing/settings','PUT',b);setTimeout(()=>{if(page==='fatture')renderBilling()},0)}));
 }catch(e){toast(e.message)}}
async function billingDetail(invoiceId){try{const r=await api('v1/billing/invoices/'+encodeURIComponent(invoiceId)),i=r.invoice;
 const paid=(r.payments||[]).reduce((sum,p)=>sum+p.amount_cents,0),remaining=i.total_cents-paid;
 const number=i.sequence?`${i.series}/${i.sequence}/${i.year}`:'Bozza non numerata';
 modal('Documento '+number,`<div class="list"><div class="list-item">Tipo <strong>${esc(i.kind==='nota_credito'?'Nota di credito':'Fattura')}</strong></div><div class="list-item">Stato <strong>${esc(i.status)}</strong></div><div class="list-item">Data <strong>${esc(i.issue_date)}</strong></div><div class="list-item">Prestazione <strong>${esc(i.description)}</strong></div><div class="list-item">Imponibile <strong>${euro(i.taxable_cents)}</strong></div><div class="list-item">IVA <strong>${euro(i.vat_cents)}</strong></div><div class="list-item">Bollo <strong>${euro(i.stamp_cents)}</strong></div><div class="list-item">Totale <strong>${euro(i.total_cents)}</strong></div><div class="list-item">Residuo <strong>${euro(remaining)}</strong></div></div><div class="form-actions">${i.status==='bozza'?'<button class="primary" id="bill-issue">Emetti e assegna numero</button>':remaining>0?'<button class="primary" id="bill-pay">Registra pagamento</button>':''}</div>${i.kind==='fattura'&&i.status==='emessa'?'<div class="form-actions"><button id="bill-credit">Crea nota di credito</button><button id="bill-ts-preview">Controlli Sistema TS</button></div>':''}<h3>Pagamenti</h3>${(r.payments||[]).map(p=>`<p>${esc(p.paid_on)} · ${euro(p.amount_cents)} · ${esc(p.method)}</p>`).join('')||'<p>Nessun pagamento</p>'}<h3>Storico</h3>${(r.events||[]).map(e=>`<p>${esc(e.created_at)} · ${esc(e.action)}</p>`).join('')}`);
 if($('#bill-issue'))$('#bill-issue').onclick=async()=>{if(!confirm('Confermi l’emissione? La fattura riceverà un numero definitivo e non potrà essere modificata. Verifica prima tutti i dati fiscali.'))return;try{const out=await api('v1/billing/invoices/'+invoiceId+'/issue','POST',{});close();await renderBilling();toast('Documento numerato: '+out.number)}catch(e){toast(e.message)}};
 if($('#bill-credit'))$('#bill-credit').onclick=()=>{modal('Nuova nota di credito',form(field('Data nota di credito','issue_date',today(),'date',true)+field('Motivo della rettifica','reason','','text',true,'maxlength="250"'),'Crea bozza'),()=>bindForm(async b=>{await api('v1/billing/invoices/'+invoiceId+'/credit-note','POST',b);setTimeout(()=>{if(page==='fatture')renderBilling()},0)}))};
 if($('#bill-ts-preview'))$('#bill-ts-preview').onclick=async()=>{try{const v=await api('v1/billing/invoices/'+invoiceId+'/ts-preview');modal('Verifiche Sistema TS',`<p class="sub">Nessun invio eseguito.</p><p>Documento: ${esc(v.number||'Non numerato')}</p><p>Pagamenti: ${v.payments.length}</p><h3>Controlli ancora necessari</h3><ul>${v.problems.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul>`)}catch(e){toast(e.message)}};
 if($('#bill-pay'))$('#bill-pay').onclick=()=>{modal('Registra incasso',form(field('Data incasso','paid_on',today(),'date',true)+field('Importo € (massimo '+(remaining/100).toFixed(2)+')','amount_eur',(remaining/100).toFixed(2),'number',true,'min="0.01" step="0.01"')+select('Metodo','method',[['carta','Carta'],['bonifico','Bonifico'],['contanti','Contanti'],['assegno','Assegno'],['altro','Altro']])+field('Riferimento (facoltativo)','reference'),'Registra pagamento'),()=>bindForm(async b=>{await api('v1/billing/invoices/'+invoiceId+'/payments','POST',{paid_on:b.paid_on,amount_cents:billingCents(b.amount_eur),method:b.method,reference:b.reference});setTimeout(()=>{if(page==='fatture')renderBilling()},0)}))};
 }catch(e){toast(e.message)}}
