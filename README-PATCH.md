# Studio Manager — PATCH 01: login server-side + schema D1

Questo archivio contiene **solo i file nuovi o modificati** da sovrapporre al repository Studio-Manager. Non sostituisce il codice V5.3.

## Limiti IMPORTANTI
- Il login usa D1, password derivate PBKDF2 e codice TOTP. Le sessioni sono HttpOnly/Secure/SameSite.
- **Tutte le sezioni cliniche, fatture, pazienti, agenda e documenti restano demo in memoria nel browser.** Il database contiene SOLO account/sessioni/eventi login.
- **Non usare dati reali**, neppure dopo l'attivazione del login. Non è ancora un gestionale sanitario di produzione.
- Necessari WAF/rate limiting login, test di sicurezza, policy di accesso, backend dati, audit clinico, backup, contratti GDPR prima di qualsiasi dato reale.
- Nessuna integrazione TS o Agenzia Entrate.

## Installazione
1. Copia i file di questa ZIP **nella radice del repository** (conserva public/index.html originale: il patch lo modifica, non lo rimpiazza con una pagina vuota).
2. Crea su Cloudflare un database D1 chiamato `studio-manager-auth-test` (per soli account di prova).
3. In Cloudflare Pages → progetto → Settings → Bindings aggiungi D1 con nome binding **DB** e seleziona il database creato. Configura anche ambiente Preview se lo usi.
4. Esegui migrazione da terminale con Wrangler: `npx wrangler d1 execute studio-manager-auth-test --remote --file=migrations/0001_auth.sql` (autenticati con `npx wrangler login`).
5. In locale esegui `node scripts/create-admin.mjs` e segui le istruzioni. Conserva la chiave TOTP in un'app autenticatore.
6. Esegui `npx wrangler d1 execute studio-manager-auth-test --remote --file=admin-setup.PRIVATO.sql` e **non caricare quel file su GitHub**. Eliminalo in sicurezza dal computer quando non serve più.
7. Su GitHub carica solo i file della patch, NON `admin-setup.PRIVATO.sql`; Cloudflare ricompila e pubblica automaticamente.
8. Accedi con email, password e codice TOTP. `/api/health` restituisce `ready` se il binding D1 è presente.

**Avvertenza:** le Cloudflare Pages Functions devono essere attive nel progetto Pages; controlla i log del deploy. Se ricevi 404 su `/api/health`, verifica che `functions/api/[[path]].js` sia nella radice del repository e che Cloudflare stia usando Pages, non Workers statici.
