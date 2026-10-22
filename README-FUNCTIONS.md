# Patch struttura Functions senza cartella api

Come richiesto, il file API è direttamente dentro `functions/[[path]].js`, senza sottocartella `api`.

## Da fare nel repository GitHub
1. Elimina il precedente `functions/api/[[path]].js` e la cartella `functions/api` se vuota.
2. Aggiungi `functions/[[path]].js` da questo archivio.
3. Non modificare gli altri file della patch precedente.
4. Pubblica e verifica `/api/health` e il login.

La route intercetta `/api/*`; le richieste ad altre pagine vengono inoltrate agli asset statici.

**Attenzione:** questa modifica riguarda solo la posizione del file. Il progetto è ancora una demo, non idonea a dati sanitari reali.
