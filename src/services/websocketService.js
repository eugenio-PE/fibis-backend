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
case 'ISCRIZIONE_GIORNI_RICHIESTI':
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

        case 'ISCRIZIONE_GIORNO_SCELTO':
            // L'utente ha scelto un giorno
            const { iscrizioneId, giornoScelto } = data.payload;
            console.log(`📨 [WS] Giorno scelto per iscrizione ${iscrizioneId}: ${giornoScelto}`);
            
            // Salva il giorno nel database
            await supabaseAdmin
                .from('iscrizioni_gare')
                .update({ 
                    giorno_iscrizione: giornoScelto,
                    stato: 'in_attesa_completamento'
                })
                .eq('id', iscrizioneId);
            
            // Il worker sta già controllando il DB, quindi procederà
            break;

        default:
            console.log('⚠️ [WS] Tipo messaggio sconosciuto:', data.type);
    }
}

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