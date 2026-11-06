# Studio Manager — TS TEST: diagnosi catena TLS (sola lettura)

Sostituire `app.py` nel repository del servizio Render. Mantenere `requirements.txt` esistente. Start command: `python app.py`.

Aprire `https://<tuo-servizio>.onrender.com/probe`. In caso di errore SSL, la risposta include `certificates_presented`, `peer_certificates` e `openssl_verify_summary`. Questi sono metadati di certificati pubblici, non credenziali.

Il servizio **non disabilita la verifica TLS** e non invia credenziali o dati sanitari. La connessione non verificata usata per diagnosticare il certificato pubblico è distinta dalla connessione HTTPS autenticata: non trasmette richieste HTTP né dati sensibili.

Quando l'autorità di certificazione (CA) sarà identificata e verificata tramite fonte ufficiale, si potrà aggiungere su Render la variabile d'ambiente `TS_TEST_CA_PEM_B64` contenente il certificato CA PEM codificato in Base64. Non impostarla con certificati casuali, né con `SanitelCF.cer` senza conferma del suo ruolo. La CA personalizzata si aggiunge alle CA di sistema, senza disabilitare il controllo del nome host.

**Solo test tecnico**: non utilizzare il piano Render Free per trasmissioni reali di dati sanitari.
