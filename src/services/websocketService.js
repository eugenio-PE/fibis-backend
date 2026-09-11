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
    // L'utente ha scelto un giorno
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
    
    // ✅ FIX: Gestione Esubero
    let giornoISO = null;
    let nuovoStato = 'in_attesa_completamento';
    
    if (giornoScelto === 'Esubero') {
        // ✅ Esubero: non convertire come data!
        giornoISO = null; // PostgreSQL accetta NULL
        nuovoStato = 'in_esubero';
        console.log(`🔄 [WS] Esubero scelto, stato: ${nuovoStato}`);
    } else if (giornoScelto && giornoScelto.includes('/')) {
        // ✅ Data normale: "25/09/2026" → "2026-09-25"
        const [dd, mm, yyyy] = giornoScelto.split('/');
        giornoISO = `${yyyy}-${mm}-${dd}`;
        console.log(`🔄 [WS] Data convertita: "${giornoScelto}" → "${giornoISO}"`);
    } else {
        // ✅ Fallback: usa il valore come stringa
        giornoISO = giornoScelto;
        console.log(`🔄 [WS] Data senza conversione: "${giornoISO}"`);
    }
    
    // ============================================================
    // ✅ FIX BUG #1 — VERIFICA POSTI LIBERI PRIMA DI AGGIORNARE IL DB
    // ============================================================
    // MOTIVO: L'app permette all'utente di selezionare QUALSIASI giorno,
    //         anche quelli con "0 posti liberi". Il worker poi tenta
    //         l'iscrizione e fallisce (o peggio, il portale FIBIS rifiuta).
    //
    // SOLUZIONE: Prima di aggiornare il DB, il backend verifica che il
    //            giorno scelto abbia effettivamente posti liberi.
    //            Se non li ha, invia un messaggio ERRORE all'app e NON
    //            aggiorna il DB (il worker non ripartirà).
    //
    // NOTA: Questa è una rete di sicurezza lato backend. La vera UX
    //       dovrebbe impedire all'utente di cliccare giorni pieni
    //       (fix futura nell'app Flutter).
    // ============================================================
    if (giornoScelto !== 'Esubero') {
        try {
            const { data: iscrizioneCheck, error: checkError } = await supabaseAdmin
                .from('iscrizioni_gare')
                .select('giorni_disponibili')
                .eq('id', iscrizioneId)
                .single();
            
            if (checkError) {
                console.log(`⚠️ [WS] Impossibile leggere giorni_disponibili:`, checkError.message);
                // Non bloccare — procediamo (fallback)
            } else if (iscrizioneCheck?.giorni_disponibili) {
                let giorniArray = [];
                try {
                    giorniArray = typeof iscrizioneCheck.giorni_disponibili === 'string'
                        ? JSON.parse(iscrizioneCheck.giorni_disponibili)
                        : iscrizioneCheck.giorni_disponibili;
                } catch (e) {
                    console.log(`⚠️ [WS] Errore parsing giorni_disponibili:`, e.message);
                }
                
                // Cerca il giorno scelto nell'array (match per data o value)
                const giornoTrovato = giorniArray.find(g => 
                    g.data === giornoScelto || 
                    g.value === giornoScelto ||
                    (g.testo && g.testo.includes(giornoScelto))
                );
                
                if (giornoTrovato) {
                    const posti = parseInt(giornoTrovato.postiLiberi, 10);
                    if (posti === 0) {
                        console.log(`❌ [WS] BLOCCO: giorno ${giornoScelto} ha 0 posti liberi`);
                        
                        // Notifica l'utente tramite WebSocket (ERRORE)
                        if (ws && ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify({
                                type: 'ERRORE',
                                payload: {
                                    message: `Il giorno ${giornoScelto} non ha più posti disponibili. Scegli un altro giorno.`,
                                    codice: 'GIORNO_PIENO',
                                    giornoScelto: giornoScelto
                                }
                            }));
                            console.log(`📤 [WS] Inviato ERRORE (GIORNO_PIENO) a utente ${userId}`);
                        }
                        
                        // NON aggiornare il DB — esce dal case
                        console.log(`📨 [WS] === FINE ISCRIZIONE_GIORNO_SCELTO (BLOCCATO) ===`);
                        break;
                    } else {
                        console.log(`✅ [WS] Giorno ${giornoScelto} ha ${posti} posti liberi — procedo`);
                    }
                } else {
                    console.log(`⚠️ [WS] Giorno ${giornoScelto} non trovato in giorni_disponibili — procedo (fallback)`);
                }
            }
        } catch (checkErr) {
            console.log(`⚠️ [WS] Eccezione verifica posti:`, checkErr.message);
            // Non bloccare — procediamo (fallback)
        }
    }
    // ✅ FINE FIX BUG #1
    
    console.log(`🔍 [WS] Tentativo di aggiornare iscrizione ${iscrizioneId} con giorno: "${giornoISO}", stato: "${nuovoStato}"...`);
    
    try {
        const { data: updateData, error: updateError } = await supabaseAdmin
            .from('iscrizioni_gare')
            .update({ 
                giorno_iscrizione: giornoISO,
                stato: nuovoStato
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