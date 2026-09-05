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
            
            // ✅ VALIDAZIONE: controlla se i dati sono validi
            if (!iscrizioneId) {
                console.log(`❌ [WS] ERRORE: iscrizioneId mancante!`);
                break;
            }
            if (!giornoScelto) {
                console.log(`❌ [WS] ERRORE: giornoScelto mancante!`);
                break;
            }
            
            // ✅ CONVERTI LA DATA IN FORMATO ISO (YYYY-MM-DD)
            // Da "25/09/2026" a "2026-09-25"
            const dateParts = giornoScelto.split('/'); // ["25", "09", "2026"]
            const giornoISO = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`; // "2026-09-25"
            console.log(`🔄 [WS] Data convertita: "${giornoScelto}" → "${giornoISO}"`);
            
            console.log(`🔍 [WS] Tentativo di aggiornare iscrizione ${iscrizioneId} con giorno: "${giornoISO}"...`);
            
            try {
                // ✅ AGGIUNTO .select() PER VEDERE IL RISULTATO
                const { data: updateData, error: updateError } = await supabaseAdmin
                    .from('iscrizioni_gare')
                    .update({ 
                        giorno_iscrizione: giornoISO,  // ✅ USA IL FORMATO ISO!
                        stato: 'in_attesa_completamento'
                    })
                    .eq('id', iscrizioneId)
                    .select(); // ← IMPORTANTE! Per vedere cosa è stato aggiornato
                
                if (updateError) {
                    console.log(`❌ [WS] ERRORE UPDATE:`, updateError);
                    console.log(`❌ [WS] Dettaglio errore:`, JSON.stringify(updateError, null, 2));
                } else {
                    console.log(`✅ [WS] UPDATE RIUSCITO!`);
                    console.log(`📊 [WS] Dati aggiornati:`, JSON.stringify(updateData, null, 2));
                    console.log(`📨 [WS] ✅ Giorno "${giornoISO}" salvato per iscrizione ${iscrizioneId}`);
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