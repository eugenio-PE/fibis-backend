// src/services/websocketService.js
import { WebSocketServer } from 'ws';
import { supabaseAdmin } from '../config/supabase.js';

let wss = null;
const clients = new Map(); // user_id -> WebSocket

export function initWebSocketServer(server) {
    wss = new WebSocketServer({ 
        server,
        path: '/ws' // WebSocket endpoint
    });

    wss.on('connection', (ws, req) => {
        // Estrai il token dalla query string (es. ?token=...)
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        
        if (!token) {
            console.log('❌ WebSocket: Token mancante');
            ws.close(1008, 'Token mancante');
            return;
        }

        // Verifica il token con Supabase
        supabaseAdmin.auth.getUser(token).then(({ data, error }) => {
            if (error || !data.user) {
                console.log('❌ WebSocket: Token non valido');
                ws.close(1008, 'Token non valido');
                return;
            }

            const userId = data.user.id;
            
            // Chiudi eventuale connessione esistente per questo utente
            if (clients.has(userId)) {
                const oldWs = clients.get(userId);
                if (oldWs.readyState === WebSocket.OPEN) {
                    oldWs.close(1000, 'Nuova connessione');
                }
            }
            
            clients.set(userId, ws);
            console.log(`🔌 WebSocket connesso per utente: ${userId}`);

            ws.on('close', () => {
                if (clients.get(userId) === ws) {
                    clients.delete(userId);
                }
                console.log(`🔌 WebSocket disconnesso per utente: ${userId}`);
            });

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await handleWebSocketMessage(ws, userId, data);
                } catch (error) {
                    console.error('❌ Errore messaggio WebSocket:', error);
                }
            });
        }).catch((err) => {
            console.error('❌ WebSocket auth error:', err);
            ws.close(1008, 'Errore autenticazione');
        });
    });

    console.log('🔌 WebSocket Server avviato su /ws');
}

// ============================================================
// GESTIONE MESSAGGI
// ============================================================
async function handleWebSocketMessage(ws, userId, data) {
    switch (data.type) {
        case 'ISCRIZIONE_GIORNI_RICHIESTI': {
            const { idIscrizione, idGara } = data.payload;
            console.log(`📨 [WS] Richiesta giorni per iscrizione ${idIscrizione}`);
            console.log(`🔍 [WS] idIscrizione = ${idIscrizione}, tipo = ${typeof idIscrizione}`);
            console.log(`🔍 [WS] userId = ${userId}, tipo = ${typeof userId}`);
            
            import('../workers/iscrizioneWorker.js').then(({ eseguiIscrizioneGara }) => {
                console.log(`🔍 [WS] Worker caricato, chiamo con id: ${idIscrizione}`);
                eseguiIscrizioneGara(idIscrizione, userId);
            }).catch(err => {
                console.error('❌ [WS] Errore caricamento worker:', err);
            });
            break;
        }

case 'ISCRIZIONE_GIORNO_SCELTO': {
    // L'utente ha scelto un giorno o un turno specifico
    console.log(`📨 [WS] === RICEVUTO ISCRIZIONE_GIORNO_SCELTO ===`);
    console.log(`📨 [WS] Payload ricevuto:`, JSON.stringify(data.payload, null, 2));

    const { iscrizioneId, giornoScelto } = data.payload;
    console.log(`📨 [WS] iscrizioneId: ${iscrizioneId} (tipo: ${typeof iscrizioneId})`);
    console.log(`📨 [WS] giornoScelto: "${giornoScelto}" (tipo: ${typeof giornoScelto})`);

    if (!iscrizioneId) {
        console.log(`❌ [WS] ERRORE: iscrizioneId mancante!`);
        break;
    }
    if (!giornoScelto) {
        console.log(`❌ [WS] ERRORE: giornoScelto mancante!`);
        break;
    }

    // ============================================================
    // ✅ FIX: giornoScelto può essere:
    //   - Una DATA (formato "DD/MM/YYYY") → vecchio comportamento
    //   - Un VALUE (formato "46773") → nuovo comportamento (turno univoco)
    //   - "Esubero" → caso speciale
    // ============================================================

    // Leggi l'iscrizione per trovare il turno scelto
    let giorniArray = [];
    try {
        const { data: iscrizioneCheck } = await supabaseAdmin
            .from('iscrizioni_gare')
            .select('giorni_disponibili')
            .eq('id', iscrizioneId)
            .single();

        if (iscrizioneCheck?.giorni_disponibili) {
            giorniArray = typeof iscrizioneCheck.giorni_disponibili === 'string'
                ? JSON.parse(iscrizioneCheck.giorni_disponibili)
                : iscrizioneCheck.giorni_disponibili;
        }
    } catch (e) {
        console.log(`⚠️ [WS] Errore lettura giorni_disponibili:`, e.message);
    }

    // Trova il turno selezionato (per value o per data)
    let turnoSelezionato = null;
    if (giornoScelto !== 'Esubero') {
        turnoSelezionato = giorniArray.find(g =>
            g.value === giornoScelto ||     // match per value (univoco)
            g.data === giornoScelto          // fallback: match per data
        );
    }

    // Determina giornoISO
    let giornoISO = null;
    let nuovoStato = 'in_attesa_completamento';

    if (giornoScelto === 'Esubero') {
        giornoISO = null;
        nuovoStato = 'in_esubero';
        console.log(`🔄 [WS] Esubero scelto, stato: ${nuovoStato}`);
    } else if (turnoSelezionato) {
        // ✅ Turno trovato: usa la SUA data
        const dataTurno = turnoSelezionato.data; // "01/10/2026"
        if (dataTurno && dataTurno.includes('/')) {
            const [dd, mm, yyyy] = dataTurno.split('/');
            giornoISO = `${yyyy}-${mm}-${dd}`;
            console.log(`🔄 [WS] Turno selezionato: value=${giornoScelto}, data=${dataTurno} → ${giornoISO}`);
        } else {
            giornoISO = giornoScelto;
        }
    } else if (giornoScelto && giornoScelto.includes('/')) {
        // Fallback: giornoScelto è già una data
        const [dd, mm, yyyy] = giornoScelto.split('/');
        giornoISO = `${yyyy}-${mm}-${dd}`;
        console.log(`🔄 [WS] Data convertita (fallback): "${giornoScelto}" → "${giornoISO}"`);
    } else {
        giornoISO = giornoScelto;
        console.log(`🔄 [WS] Data senza conversione: "${giornoISO}"`);
    }

    // ============================================================
    // ✅ FIX BUG #1 — VERIFICA POSTI LIBERI PRIMA DI AGGIORNARE IL DB
    // ============================================================
    if (giornoScelto !== 'Esubero' && turnoSelezionato) {
        const posti = parseInt(turnoSelezionato.postiLiberi, 10);
        if (posti === 0) {
            console.log(`❌ [WS] BLOCCO: turno ${giornoScelto} ha 0 posti liberi`);

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'ERRORE',
                    payload: {
                        message: `Il turno selezionato non ha più posti disponibili. Scegli un altro turno.`,
                        codice: 'GIORNO_PIENO',
                        giornoScelto: giornoScelto
                    }
                }));
                console.log(`📤 [WS] Inviato ERRORE (GIORNO_PIENO) a utente ${userId}`);
            }

            console.log(`📨 [WS] === FINE ISCRIZIONE_GIORNO_SCELTO (BLOCCATO) ===`);
            break;
        } else {
            console.log(`✅ [WS] Turno ${giornoScelto} ha ${posti} posti liberi — procedo`);
        }
    }

    // ============================================================
    // ✅ FIX — VERIFICA CATEGORIA UTENTE (RETE DI SICUREZZA)
    // ============================================================
    // Anche se il frontend disabilita i turni non compatibili,
    // il backend verifica comunque (evita bypass manuali).
    // ============================================================
    if (giornoScelto !== 'Esubero' && turnoSelezionato) {
        const testo = turnoSelezionato.testo || '';
        const parti = testo.split(' - ');

        // Regex per riconoscere la stringa delle sigle
        const regexSigle = /^([1-3]|M|N|NP|J|S)(\s*,\s*([1-3]|M|N|NP|J|S))*$/i;

        // Mappa sigle → categorie
        const mappaCategorie = {
            '1': 'prima',
            '2': 'seconda',
            '3': 'terza',
            'M': 'master',
            'N': 'nazionali',
            'NP': 'nazionali_pro',
            'J': 'juniores',
            'S': 'seniores',
        };

        // Cerca la parte con le sigle
        let categorieTurno = [];
        for (let i = 2; i < parti.length; i++) {
            const parte = parti[i].trim();
            if (parte && regexSigle.test(parte)) {
                categorieTurno = parte
                    .split(',')
                    .map(s => s.trim().toUpperCase())
                    .filter(s => mappaCategorie[s])
                    .map(s => mappaCategorie[s]);
                break;
            }
        }

        console.log(`🔍 [WS] Categorie turno: [${categorieTurno.join(', ')}]`);

        // Se il turno ha categorie specifiche, verifica la categoria utente
        if (categorieTurno.length > 0) {
            // Recupera la categoria del tesserato dell'iscrizione
            const { data: iscrizioneFull } = await supabaseAdmin
                .from('iscrizioni_gare')
                .select('id_tesserato')
                .eq('id', iscrizioneId)
                .single();

            if (iscrizioneFull?.id_tesserato) {
                const { data: tesseratoData } = await supabaseAdmin
                    .from('tesserati')
                    .select('categoria_ranking')
                    .eq('id', iscrizioneFull.id_tesserato)
                    .single();

                const categoriaUtente = tesseratoData?.categoria_ranking?.toLowerCase();

                console.log(`🔍 [WS] Categoria utente: ${categoriaUtente}`);

                if (!categoriaUtente || !categorieTurno.includes(categoriaUtente)) {
                    console.log(`❌ [WS] BLOCCO categoria: turno richiede [${categorieTurno.join(', ')}], utente è ${categoriaUtente}`);

                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                            type: 'ERRORE',
                            payload: {
                                message: `Il turno selezionato è riservato alle categorie: ${categorieTurno.join(', ')}. La tua categoria (${categoriaUtente || 'non specificata'}) non è ammessa.`,
                                codice: 'CATEGORIA_NON_COMPATIBILE'
                            }
                        }));
                    }

                    console.log(`📨 [WS] === FINE ISCRIZIONE_GIORNO_SCELTO (BLOCCATO CATEGORIA) ===`);
                    break;
                } else {
                    console.log(`✅ [WS] Categoria ${categoriaUtente} ammessa nel turno`);
                }
            }
        }
    }

    // ============================================================
    // UPDATE DB
    // ============================================================
    console.log(`🔍 [WS] Tentativo di aggiornare iscrizione ${iscrizioneId} con giorno: "${giornoISO}", stato: "${nuovoStato}"...`);

    try {
        const { data: updateData, error: updateError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .update({
                giorno_iscrizione: giornoISO,
                stato: nuovoStato,
                // ✅ Salva anche il value del turno per il worker
                turno_value: giornoScelto !== 'Esubero' ? giornoScelto : null,
            })
            .eq('id', iscrizioneId)
            .select();

        if (updateError) {
            console.log(`❌ [WS] ERRORE UPDATE:`, updateError);
            console.log(`❌ [WS] Dettaglio errore:`, JSON.stringify(updateError, null, 2));
        } else {
            console.log(`✅ [WS] UPDATE RIUSCITO!`);
            console.log(`📊 [WS] Dati aggiornati:`, JSON.stringify(updateData, null, 2));
            console.log(`📨 [WS] ✅ Giorno "${giornoISO || 'Esubero'}" salvato per iscrizione ${iscrizioneId}`);
        }
    } catch (error) {
        console.log(`❌ [WS] ECCEZIONE DURANTE UPDATE:`, error);
        console.log(`❌ [WS] Stack:`, error.stack);
    }

    console.log(`📨 [WS] === FINE ISCRIZIONE_GIORNO_SCELTO ===`);
    break;
}
        default:
            console.log(`⚠️ [WS] Tipo messaggio sconosciuto: ${data.type}`);
    } // ← CHIUSURA SWITCH
} // ← CHIUSURA FUNZIONE handleWebSocketMessage

// ============================================================
// INVIO MESSAGGI ALL'APP
// ============================================================
export function sendToApp(userId, type, payload) {
    const ws = clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type, payload }));
        console.log(`📤 [WS] Inviato a utente ${userId}: ${type}`);
        return true;
    }
    console.log(`⚠️ [WS] Utente ${userId} non connesso`);
    return false;
}