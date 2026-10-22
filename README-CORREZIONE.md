# Studio Manager — correzione errore Cloudflare 1101

Questa ZIP contiene **solo tre file da aggiungere/sostituire** nella radice del repository GitHub:

- `public/_routes.json` (nuovo): esegue le Pages Functions esclusivamente su `/api/*`, senza intercettare `/` e le risorse statiche.
- `functions/[[path]].js` (sostituisce il precedente): nessun inoltro generico verso `context.next()`; il file resta direttamente in `functions`, senza cartella `api`.
- `public/index.html` (sostituisce il precedente): elimina il secondo blocco identico del login.

## Installazione
1. Apri la ZIP, entra nella cartella `studio-manager-fix-1101`.
2. Copia i tre file nei rispettivi percorsi GitHub. Mantieni gli altri file invariati.
3. Esegui il commit e attendi il deploy Cloudflare Pages.
4. Verifica che `/` carichi la schermata login.
5. Visita `/api/health`: con binding D1 `DB` configurato deve rispondere `{"status":"ready"}`; altrimenti risponderà `503` con messaggio sul binding.
6. Se il sito funziona ma l'accesso fallisce, verifica migrazione D1, utente amministratore e log Cloudflare.

Questa modifica isola le API dalle pagine statiche e corregge un duplicato. **Non costituisce collaudo del backend né sicurezza sanitaria di produzione**. Non inserire dati reali.

Se permane un errore 1101, controlla i log delle Pages Functions e condividi lo stack trace.
