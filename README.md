# Diagnostica gratuita TLS — Sistema TS TEST

Questa è una **sonda di rete di sola lettura**, non un connettore per fatture. Non accetta credenziali, PINCODE o dati pazienti. Non deve essere usata per invii di produzione.

## Pubblicazione di prova su Render Free
1. Crea un repository GitHub **privato** con `app.py` e `requirements.txt`.
2. Su https://dashboard.render.com scegli **New → Web Service**, collega il repository e scegli **Free** (se disponibile).
3. Runtime Python; build command: `pip install -r requirements.txt`; start command: `python app.py`.
4. Apri `https://<nome-servizio>.onrender.com/probe` dopo l'avvio. Condividi solo il JSON della sonda, **senza credenziali**.
5. Se `tls_ok` è `false`, serve individuare e validare la CA ufficiale: non usare `verify=False` o `CERT_NONE`.

## Limiti e sicurezza
- Il piano Free Render è esplicitamente **non destinato alla produzione**; si sospende dopo inattività e può avere limiti di risorse. Utilizzarlo **solo per questo test senza dati sanitari**.
- Nessuna credenziale TS deve essere configurata su Render in questa fase.
- Anche con `tls_ok=true`, il connettore SOAP e l'autenticazione **non sono collaudati**.
- L'ambiente TS e i certificati potrebbero essere cambiati rispetto al kit 2024: confermare con le specifiche correnti.
