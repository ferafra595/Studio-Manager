# Studio Manager — Patch 02: primo Super Admin senza Node.js

Questa patch è basata sulla correzione 1101. **Contiene soltanto due file modificati**. Non contiene password, token o dati reali.

## GitHub
Sostituire `functions/[[path]].js` e `public/index.html` con i file della ZIP, mantenendo `public/_routes.json` della correzione precedente, con le API incluse (`/api/*`). Non creare `functions/api/`.

## Cloudflare — passaggio obbligatorio
1. Aprire il progetto Pages `studio-manager-djt` → Settings → Variables and Secrets (nome variabile può variare).
2. Aggiungere un **Secret** chiamato esattamente `BOOTSTRAP_TOKEN`, nell'ambiente Production. Usare un valore casuale e unico **di almeno 32 caratteri**. Non inserire questo valore in GitHub, wrangler.toml o chat. Se il pannello richiede un redeploy, eseguirlo.
3. Verificare che il binding D1 `DB` sia attivo e che le tabelle `users`, `sessions`, `auth_events` siano già presenti.
4. Aprire il sito e cliccare **Prima configurazione Super Admin**. Inserire il token segreto di Cloudflare, poi **Genera chiave autenticatore**.
5. Nell'app Google Authenticator usare `+` → `Inserisci una chiave di configurazione`, tipo basato sull'ora, con la chiave mostrata. Conservare la chiave in un gestore password sicuro.
6. Inserire email, password di almeno 16 caratteri e codice a sei cifre dell'app. Cliccare **Crea Super Admin**.
7. Tornare al login e accedere con email, password e codice. La configurazione si disabilita dopo la creazione del primo admin.
8. **Rimuovere `BOOTSTRAP_TOKEN` dalle impostazioni Cloudflare dopo l'inizializzazione**, e ridistribuire se necessario. L'account creato rimane.

## Importante
- Se si ricarica la pagina prima di confermare, bisogna generare una nuova chiave e aggiornare l'app autenticatore. Selezionare solo la voce più recente.
- La protezione contro tentativi ripetuti e gli altri controlli di sicurezza sono ancora incompleti: questa patch è per ambiente demo, NON per pazienti reali.
- Non si salvano ancora in D1 pazienti, appuntamenti, fatture o documenti clinici.
- L'endpoint di bootstrap è accessibile da Internet fino alla prima inizializzazione: non lasciare il Secret configurato inutilmente. Prima dell'uso reale occorrono rate limiting, audit, revisione della gestione MFA e autorizzazioni.
