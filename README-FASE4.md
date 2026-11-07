# Studio Manager — Fase 4 (offline, NON produzione)

## File nuovi
- `ts_crypto.py`: cifratura RSA PKCS#1 v1.5 / Base64 con certificato pubblico X.509 PEM; non sostituisce TLS.
- `ts_invoice_adapter.py`: conversione **esplicita** di una fattura approvata in dati del tracciato `ts_soap.py` già installato. Non interroga D1.
- `test_ts_phase4.py`: test locali con chiave RSA generata al momento, senza pazienti.
- `requirements-ts-phase4.txt`: dipendenza Python.

## Installazione
Caricare solo i file nuovi nella stessa cartella di `ts_soap.py` e `ts_transport.py` del repository. Non sovrascrivere `app.py`, non sostituire `requirements.txt` esistente. Render deve installare `cryptography>=43,<47` per usare `ts_crypto.py`; se il servizio installa solo requirements.txt, aggiungere quella riga al file requirements.txt esistente **senza cancellare le altre dipendenze**. Non è necessario per il semplice deployment se i moduli non sono importati da app.py.

Test: `python -m unittest -v test_ts_phase4`

## Limiti e controlli
- Nessun invio attivo. Nessuna API pubblica. Nessuna modifica a Cloudflare/D1.
- La cifratura RSA è verificata localmente tramite decifratura con chiave di test, NON ancora collaudata con TS.
- Prima dell'uso verificare ufficialmente algoritmo/padding del campo specifico, la validità temporale del certificato Sanitel, tracciato 2026, regole opposizione, categorie spesa e responsabilità privacy.
- Non caricare credenziali, PINCODE o dati sanitari in GitHub, log, endpoint pubblici o Render Free.
- Il modulo di mapping non decide automaticamente se una prestazione è detraibile o quale codice TS assegnarle.
- Per collegare fatture reali serve la versione aggiornata del codice Cloudflare e del modello D1, e un canale di trasmissione autenticato e autorizzato.
