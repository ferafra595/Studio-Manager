# Studio Manager — anteprima V5.3 per GitHub + Cloudflare Pages

> **SOLO DEMO. Non caricare dati reali di pazienti, referti, fotografie cliniche, fatture reali o credenziali.**

Questo repository contiene il **codice completo della demo frontend V5.3**, incluse le funzionalità di interfaccia già sviluppate: login simulato, agenda, schede pazienti, storico, richiami, specialisti, turni, fatture dimostrative, pagamenti e contabilità. La demo usa dati fittizi e memoria del browser: **non contiene un backend, un database, autenticazione vera, backup veri o integrazioni fiscali**.

## Avvio locale

Apri `public/index.html` in un browser oppure esegui `npm run build` e apri `dist/index.html`. Password **solo dimostrativa**: `DEMO2026`.

## Pubblicazione da GitHub su Cloudflare Pages

1. Crea un repository GitHub **privato** (può essere pubblico solo se desideri rendere pubblico il codice della demo; non inserire segreti).
2. Estrai questo ZIP e carica **tutti i file e le cartelle** nella radice del repository. Non caricare la ZIP come singolo file.
3. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → scegli il repository.
4. Imposta **Framework preset: None**, **Build command: `npm run build`**, **Build output directory: `dist`**, **Root directory: `/`**.
5. Distribuisci. Ogni nuovo commit sul ramo di produzione attiverà una nuova build.
6. Per limitare l'accesso all'anteprima, configura **Cloudflare Access** e verifica che la policy copra il dominio di preview.

Per il caricamento manuale (senza GitHub), esegui `npm run build` e carica il **contenuto di `dist/`** su Pages.

## Controlli

- `npm run check`: verifiche statiche minime.
- `npm run build`: copia i file pubblici nella directory di output.

I controlli non sostituiscono test funzionali, test di sicurezza o collaudi clinici.

## Limitazioni importanti

- Il login e i ruoli sono **simulati lato client**; la password demo non protegge nulla.
- Nessuna persistenza server o isolamento affidabile tra specialisti.
- Nessuna emissione fiscale valida, nessun invio Sistema TS o SdI, nessun invio email automatico.
- Le funzionalità di audit, backup, pagamenti e fatture sono **simulazioni**.
- Gli header HTTP mitigano alcune esposizioni ma **non trasformano** il prototipo in un'app sicura.
- Non è autorizzato l'utilizzo con pazienti reali.

## Per il sistema sanitario definitivo

Servono backend con controlli autorizzativi lato server, identità personali con MFA, database e storage privato adeguati al trattamento sanitario, cifratura e gestione chiavi, audit non alterabile, backup con prove di ripristino, valutazioni GDPR e collaudo. Solo dopo sarà possibile migrare i dati di Podoworks in modo verificato. Integrazioni Sistema TS e Agenzia Entrate da sviluppare separatamente.
