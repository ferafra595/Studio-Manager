# Studio Manager — Patch integrazione TS TEST (base: Studio-Manager-main (13))

Questa patch contiene **solo i file nuovi/modificati**. Non sovrascrive fatturazione, design, database o CSS. Non abilita invii reali.

## GitHub
Carica i file mantenendo i percorsi dello ZIP. I file `app.py`, `functions/sistema-ts.js`, `public/ts-page.js` e `requirements.txt` sostituiscono quelli omonimi. Gli altri file sono nuovi. **Non caricare l’intero ZIP TEST-integrato precedente.**

## Secrets (NON su GitHub)
1. Genera un token casuale locale: `python -c "import secrets; print(secrets.token_hex(32))"`.
2. Render → Environment: `TS_BRIDGE_TOKEN` = token; conserva `TS_TEST_CA_PEM_B64` già funzionante.
3. Cloudflare Pages → Settings → Variables and Secrets: `TS_BRIDGE_TOKEN` = stesso token (Secret), `TS_RENDER_URL` = `https://studio-manager-4usa.onrender.com`.
4. Esegui nuovamente il deploy di Render e Cloudflare.

## Test
- `GET https://studio-manager-4usa.onrender.com/probe` deve continuare a mostrare `tls_ok: true`.
- Nel gestionale, **Sistema TS → Collauda SOAP (dati fittizi)**.
- Esito atteso: `Schema XSD superato`. Il test è **offline sul server Render**, non un invio TS autenticato.
- Non mettere credenziali TS o dati di pazienti nel codice o nei log.

## Limiti
La chiave pubblica del certificato SanitelCF del kit 20240214 è RSA 1024 bit: l'eccezione per usarla è limitata alla simulazione locale con dati sintetici e fingerprint bloccata. Il normale modulo `ts_crypto.py` resta invariato e rifiuta chiavi inferiori a 2048 bit. Prima di un invio reale occorre una verifica delle specifiche e del certificato aggiornato, oltre a collaudo e sicurezza/privacy. Nessuna migrazione D1 richiesta.
