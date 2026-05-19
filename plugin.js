const WebSocket = require('ws');
const net = require('net');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// =====================================
// UTILITÁRIOS E CACHE
// =====================================
const logPath = path.join(__dirname, 'debug.log');
const tokenPath = path.join(__dirname, 'token.json');
const avatarCache = new Map(); // userId+hash -> base64

function log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(logPath, entry);
}

async function getBase64Avatar(userId, avatarHash) {
    if (!avatarHash) return null;
    const cacheKey = `${userId}_${avatarHash}`;
    if (avatarCache.has(cacheKey)) return avatarCache.get(cacheKey);

    return new Promise((resolve) => {
        const url = `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.png?size=64`;
        https.get(url, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const base64 = `data:image/png;base64,${buffer.toString('base64')}`;
                avatarCache.set(cacheKey, base64);
                resolve(base64);
            });
        }).on('error', () => resolve(null));
    });
}

// =====================================
// CONFIGURAÇÕES
// =====================================
// Tenta carregar .env manualmente
if (fs.existsSync(path.join(__dirname, '.env'))) {
    try {
        const envContent = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
        envContent.split('\n').forEach(line => {
            const [key, val] = line.split('=');
            if (key && val) process.env[key.trim()] = val.trim();
        });
    } catch (e) { log('Aviso: Erro ao ler .env: ' + e.message); }
}

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;




// =====================================
// DISCORD RPC PRO
// =====================================
class DiscordRPC extends EventEmitter {
    constructor(clientId, clientSecret) {
        super();
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        this.accessToken = this.loadToken();
        this.voiceState = { mute: false, deaf: false, speaking: false };
        this.user = null;
        this.currentChannel = null;
        this.usersInChannel = new Map();
        this.selectedUserId = null;
        this.currentPage = 0;
        this.isUpdating = false;
        this.richPresenceActive = false;
    }

    loadToken() {
        try {
            if (fs.existsSync(tokenPath) && fs.statSync(tokenPath).size > 2) {
                return JSON.parse(fs.readFileSync(tokenPath, 'utf8')).access_token;
            }
        } catch (e) { }
        return null;
    }

    saveToken(token) {
        fs.writeFileSync(tokenPath, JSON.stringify({ access_token: token }));
    }

    connect(index = 0) {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }

        if (index > 9) {
            log('Discord não encontrado. Tentando novamente em 10s...');
            return setTimeout(() => this.connect(0), 10000);
        }

        const pipePath = `\\\\?\\pipe\\discord-ipc-${index}`;
        const socket = net.createConnection(pipePath);
        this.socket = socket;

        socket.on('connect', () => {
            const payload = { v: 1, client_id: this.clientId, pid: process.pid };
            log(`Conectado ao Discord pipe ${index}. Enviando handshake...`);
            this.buffer = Buffer.alloc(0);
            this.currentChannel = null;
            this.usersInChannel.clear();
            this.send(0, payload);
        });




        socket.on('data', (data) => {
            this.buffer = Buffer.concat([this.buffer, data]);
            while (this.buffer.length >= 8) {
                try {
                    const length = this.buffer.readInt32LE(4);
                    if (this.buffer.length < 8 + length) break;

                    const opcode = this.buffer.readInt32LE(0);
                    const payload = JSON.parse(this.buffer.slice(8, 8 + length).toString());
                    this.buffer = this.buffer.slice(8 + length);
                    this.processMessage(opcode, payload);
                } catch (e) {
                    log('Erro ao processar pacote IPC: ' + e.message);
                    this.buffer = Buffer.alloc(0);
                    break;
                }
            }
        });

        socket.on('error', (err) => {
            if (socket === this.socket) {
                const pipeExists = err.code !== 'ENOENT';
                if (pipeExists) {
                    log(`Erro no socket (Pipe ${index}): ${err.message}`);
                }

                socket.destroy();
                this.socket = null;

                if (!pipeExists) {
                    // Se o pipe não existe, tenta o próximo
                    this.connect(index + 1);
                } else {
                    // Se o pipe existe mas deu erro, volta para o 0 com delay
                    setTimeout(() => this.connect(0), 5000);
                }
            }
        });


        socket.on('close', () => {
            if (socket === this.socket) {
                log(`Conexão com pipe ${index} fechada.`);
                this.socket = null;
                setTimeout(() => this.connect(0), 5000);
            }
        });
    }


    send(opcode, payload) {
        try {
            const data = JSON.stringify(payload);
            const len = Buffer.byteLength(data);
            const packet = Buffer.alloc(8 + len);
            packet.writeInt32LE(opcode, 0);
            packet.writeInt32LE(len, 4);
            packet.write(data, 8);

            // Log do pacote em HEX para debug técnico
            log(`HEX SEND: ${packet.toString('hex')}`);

            if (this.socket && this.socket.writable) {
                this.socket.write(packet);
            }
        } catch (e) { log('Erro no envio IPC: ' + e.message); }
    }



    processMessage(opcode, payload) {
        log(`RCV: cmd=${payload.cmd}, evt=${payload.evt}, status=${payload.evt === 'ERROR' ? 'ERROR' : 'OK'}`);
        if (payload.evt === 'ERROR') {
            log(`ERROR Detail: ${JSON.stringify(payload.data)}`);
        }

        if (payload.evt === 'READY') {
            this.accessToken ? this.authenticate() : this.authorize();
        } else if (payload.cmd === 'AUTHORIZE' && payload.data?.code) {
            this.exchangeCode(payload.data.code);
        } else if (payload.cmd === 'AUTHENTICATE') {
            if (payload.evt === 'ERROR') {
                log('Falha na autenticação (token possivelmente expirado). Autorizando novamente...');
                this.accessToken = null;
                this.authorize();
            } else {
                this.user = payload.data.user;
                log(`Autenticado como ${this.user.username}`);
                this.subscribeEvents();
            }
        } else if (payload.evt === 'VOICE_SETTINGS_UPDATE' || payload.cmd === 'GET_VOICE_SETTINGS') {

            Object.assign(this.voiceState, payload.data);
            this.updateStreamDockState();
        } else if (payload.evt === 'SPEAKING_START' || payload.evt === 'SPEAKING_STOP') {
            const userId = payload.data.user_id;
            if (userId === this.user?.id) this.voiceState.speaking = (payload.evt === 'SPEAKING_START');
            const user = this.usersInChannel.get(userId);
            if (user) user.speaking = (payload.evt === 'SPEAKING_START');
            this.updateStreamDockState();
        } else if (payload.evt === 'VOICE_CHANNEL_SELECT') {
            this.handleChannelSelect(payload.data.channel_id);
        } else if (payload.evt === 'VOICE_STATE_CREATE' || payload.evt === 'VOICE_STATE_UPDATE') {
            this.updateUserInMap(payload.data);
        } else if (payload.evt === 'VOICE_STATE_DELETE') {
            this.usersInChannel.delete(payload.data.user.id);
            if (this.selectedUserId === payload.data.user.id) this.selectedUserId = null;
            this.updateStreamDockState();
        } else if (payload.cmd === 'GET_SELECTED_VOICE_CHANNEL') {
            if (payload.data) {
                const channelId = payload.data.id;
                if (this.currentChannel !== channelId) {
                    this.currentChannel = channelId;
                    this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_CREATE');
                    this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_UPDATE');
                    this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_DELETE');
                    this.request('SUBSCRIBE', { channel_id: channelId }, 'SPEAKING_START');
                    this.request('SUBSCRIBE', { channel_id: channelId }, 'SPEAKING_STOP');
                }
                this.usersInChannel.clear();
                payload.data.voice_states.forEach(vs => this.updateUserInMap(vs));
            } else {
                this.currentChannel = null;
                this.usersInChannel.clear();
            }
            this.updateStreamDockState();
        }
    }

    updateUserInMap(vs) {
        if (!vs.user) return;
        const existing = this.usersInChannel.get(vs.user.id);
        this.usersInChannel.set(vs.user.id, {
            id: vs.user.id,
            username: vs.user.username,
            avatar: vs.user.avatar,
            volume: vs.volume ?? existing?.volume ?? 100,
            mute: vs.mute ?? existing?.mute ?? false,
            speaking: vs.voice_state?.speaking ?? existing?.speaking ?? false,
            pan: existing?.pan || { left: 1.0, right: 1.0 }
        });
        this.updateStreamDockState();
    }

    handleChannelSelect(channelId) {
        if (this.currentChannel) {
            this.request('UNSUBSCRIBE', { channel_id: this.currentChannel }, 'VOICE_STATE_CREATE');
            this.request('UNSUBSCRIBE', { channel_id: this.currentChannel }, 'VOICE_STATE_UPDATE');
            this.request('UNSUBSCRIBE', { channel_id: this.currentChannel }, 'VOICE_STATE_DELETE');
            this.request('UNSUBSCRIBE', { channel_id: this.currentChannel }, 'SPEAKING_START');
            this.request('UNSUBSCRIBE', { channel_id: this.currentChannel }, 'SPEAKING_STOP');
        }
        this.currentChannel = channelId;
        this.usersInChannel.clear();
        if (channelId) {
            this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_CREATE');
            this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_UPDATE');
            this.request('SUBSCRIBE', { channel_id: channelId }, 'VOICE_STATE_DELETE');
            this.request('SUBSCRIBE', { channel_id: channelId }, 'SPEAKING_START');
            this.request('SUBSCRIBE', { channel_id: channelId }, 'SPEAKING_STOP');
            this.request('GET_SELECTED_VOICE_CHANNEL');
        } else {
            this.voiceState.speaking = false;
        }
        this.updateStreamDockState();
    }

    authorize() {
        this.request('AUTHORIZE', {
            client_id: this.clientId,
            scopes: ['rpc', 'identify', 'rpc.activities.write', 'rpc.voice.read', 'rpc.voice.write']
        });
    }

    exchangeCode(code) {
        const postData = `client_id=${this.clientId}&client_secret=${this.clientSecret}&grant_type=authorization_code&code=${code}&redirect_uri=http://localhost`;
        const req = https.request({
            hostname: 'discord.com',
            path: '/api/oauth2/token',
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (json.access_token) {
                        this.accessToken = json.access_token;
                        this.saveToken(this.accessToken);
                        this.authenticate();
                    }
                } catch (e) { log('Erro no parse do token: ' + body); }
            });
        });
        req.write(postData); req.end();
    }

    authenticate() { this.request('AUTHENTICATE', { access_token: this.accessToken }); }

    subscribeEvents() {
        this.request('SUBSCRIBE', {}, 'VOICE_SETTINGS_UPDATE');
        this.request('SUBSCRIBE', {}, 'VOICE_CHANNEL_SELECT');
        this.request('GET_VOICE_SETTINGS');
        this.request('GET_SELECTED_VOICE_CHANNEL');
    }

    request(cmd, args = {}, evt = null) {
        const payload = { cmd, args, nonce: Math.random().toString(36).substring(7) };
        if (evt) payload.evt = evt;
        this.send(1, payload);
    }

    toggleMute() { this.request('SET_VOICE_SETTINGS', { mute: !this.voiceState.mute }); }
    toggleDeafen() { this.request('SET_VOICE_SETTINGS', { deaf: !this.voiceState.deaf }); }
    toggleNoiseSuppression() { this.request('SET_VOICE_SETTINGS', { noise_suppression: !this.voiceState.noise_suppression }); }

    async setUserVolume(userId, volume) {
        const user = this.usersInChannel.get(userId);
        if (user) {
            user.volume = Math.max(0, Math.min(200, volume));
            this.request('SET_USER_VOICE_SETTINGS', { user_id: userId, volume: user.volume });
            this.updateStreamDockState();
        }
    }

    async setUserPan(userId, direction) {
        const user = this.usersInChannel.get(userId);
        if (user) {
            if (!user.pan) user.pan = { left: 1.0, right: 1.0 };
            if (direction === 'left') {
                user.pan.left = 1.0;
                user.pan.right = Math.max(0, parseFloat((user.pan.right - 0.2).toFixed(1)));
            } else if (direction === 'right') {
                user.pan.right = 1.0;
                user.pan.left = Math.max(0, parseFloat((user.pan.left - 0.2).toFixed(1)));
            } else if (direction === 'center') {
                user.pan.left = 1.0;
                user.pan.right = 1.0;
            }
            this.request('SET_USER_VOICE_SETTINGS', { user_id: userId, pan: user.pan });
            this.updateStreamDockState();
        }
    }

    async toggleUserMute(userId) {
        const user = this.usersInChannel.get(userId);
        if (user) {
            user.mute = !user.mute;
            this.request('SET_USER_VOICE_SETTINGS', { user_id: userId, mute: user.mute });
            this.updateStreamDockState();
        }
    }

    async setActivity(isActive) {
        if (isActive) {
            this.request('SET_ACTIVITY', {
                pid: process.pid,
                activity: {
                    details: 'No StreamDock',
                    state: 'Discord Pro Plugin',
                    assets: {
                        large_image: 'discord',
                        large_text: 'Discord Pro'
                    },
                    timestamps: {
                        start: Date.now()
                    },
                    buttons: [
                        { label: 'Obter Plugin', url: 'https://github.com/DanielFBottega/DiscordPluginRiseModeVS1' }
                    ]
                }
            });
        } else {
            this.request('SET_ACTIVITY', { pid: process.pid, activity: null });
        }
        this.updateStreamDockState();
    }

    async updateStreamDockState() {
        if (!sdWS || sdWS.readyState !== WebSocket.OPEN || this.isUpdating) return;
        this.isUpdating = true;

        try {
            const setS = (ctx, state) => sdWS.send(JSON.stringify({ event: 'setState', context: ctx, payload: { state } }));
            const setT = (ctx, title) => sdWS.send(JSON.stringify({ event: 'setTitle', context: ctx, payload: { title } }));
            const setI = (ctx, image) => sdWS.send(JSON.stringify({ event: 'setImage', context: ctx, payload: { image } }));

            updateAction('com.daniel.discordpro.micmute', { state: this.voiceState.mute ? 1 : 0 });
            updateAction('com.daniel.discordpro.deafen', { state: this.voiceState.deaf ? 1 : 0 });

            // Atualiza os títulos explicativos dos botões de Mute e Deafen
            contexts['com.daniel.discordpro.micmute'].forEach(ctx => {
                setT(ctx, this.voiceState.mute ? "MUTADO" : "ATIVADO");
            });
            contexts['com.daniel.discordpro.deafen'].forEach(ctx => {
                setT(ctx, this.voiceState.deaf ? "MUTADO" : "ATIVADO");
            });

            // Atualiza o volume geral de saída do Discord
            const outVol = Math.round(this.voiceState.output?.volume ?? 100);
            contexts['com.daniel.discordpro.volumemute'].forEach(ctx => {
                setT(ctx, `VOL: ${outVol}%`);
            });

            // Atualiza o título do indicador com o nome de quem está falando
            const speakingList = [];
            if (this.voiceState.speaking) {
                speakingList.push(this.user?.username || 'Você');
            }
            this.usersInChannel.forEach(u => {
                if (u.speaking && u.id !== this.user?.id) {
                    speakingList.push(u.username);
                }
            });
            const speakingTitle = speakingList.length > 0 ? speakingList.join(', ') : 'SILÊNCIO';
            contexts['com.daniel.discordpro.speaking'].forEach(ctx => setT(ctx, speakingTitle));
            // O indicador acende (estado 1) se você ou qualquer amigo estiver falando
            updateAction('com.daniel.discordpro.speaking', { state: speakingList.length > 0 ? 1 : 0 });

            if (this.user) {
                const av = await getBase64Avatar(this.user.id, this.user.avatar);
                const nsText = this.voiceState.noise_suppression ? "Krisp: ON" : "Krisp: OFF";
                contexts['com.daniel.discordpro.userinfo'].forEach(ctx => {
                    setT(ctx, `${this.user.username}\n${nsText}`);
                    setI(ctx, av || "");
                });
            } else {
                contexts['com.daniel.discordpro.userinfo'].forEach(ctx => {
                    setT(ctx, "OFFLINE\n(CONECTANDO)");
                    setI(ctx, "");
                });
            }

            contexts['com.daniel.discordpro.activity'].forEach(ctx => {
                setT(ctx, this.richPresenceActive ? "STATUS\nATIVADO" : "STATUS\nDESATIVADO");
            });

            const userButtons = Array.from(contexts['com.daniel.discordpro.usercontrol']).sort((a, b) => {
                const coordA = contextCoordinates.get(a);
                const coordB = contextCoordinates.get(b);
                if (!coordA || !coordB) return 0;
                if (coordA.row !== coordB.row) return coordA.row - coordB.row;
                return coordA.column - coordB.column;
            });
            const sortedUsers = Array.from(this.usersInChannel.values()).filter(u => u.id !== this.user?.id);

            if (this.selectedUserId) {
                const selUser = this.usersInChannel.get(this.selectedUserId);
                if (selUser) {
                    const menuTitles = [
                        selUser.username,
                        selUser.mute ? "UNMUTE" : "MUTE",
                        "VOL -",
                        "VOL +",
                        "RESET",
                        `VOL: ${Math.round(selUser.volume)}%`
                    ];
                    for (let i = 0; i < userButtons.length; i++) {
                        setT(userButtons[i], menuTitles[i] || "");
                        if (i === 0) {
                            const avatar = await getBase64Avatar(selUser.id, selUser.avatar);
                            setI(userButtons[i], avatar || "");
                        } else {
                            setI(userButtons[i], "");
                        }
                    }
                }
            } else {
                const start = this.currentPage * 5;
                const pageUsers = sortedUsers.slice(start, start + 5);
                
                if (!this.currentChannel) {
                    // Sem estar conectado a canais de voz
                    for (let i = 0; i < 6; i++) {
                        const ctx = userButtons[i]; if (!ctx) continue;
                        if (i === 2) {
                            setT(ctx, "ENTRE EM UM\nCANAL DE VOZ");
                        } else {
                            setT(ctx, "");
                        }
                        setI(ctx, "");
                    }
                } else if (sortedUsers.length === 0) {
                    // Sozinho no canal
                    for (let i = 0; i < 6; i++) {
                        const ctx = userButtons[i]; if (!ctx) continue;
                        if (i === 2) {
                            setT(ctx, "CANAL VAZIO\n(SEM AMIGOS)");
                        } else {
                            setT(ctx, "");
                        }
                        setI(ctx, "");
                    }
                } else {
                    for (let i = 0; i < 6; i++) {
                        const ctx = userButtons[i]; if (!ctx) continue;
                        if (i < 5) {
                            const u = pageUsers[i];
                            if (u) {
                                setT(ctx, u.username);
                                const av = await getBase64Avatar(u.id, u.avatar);
                                setI(ctx, av || "");
                            } else { setT(ctx, ""); setI(ctx, ""); }
                        } else {
                            setT(ctx, sortedUsers.length > 5 ? "PRÓX. ->" : "");
                            setI(ctx, "");
                        }
                    }
                }
            }
        } finally {
            this.isUpdating = false;
        }
    }
}

function updateAction(action, payload) {
    if (contexts[action]) contexts[action].forEach(ctx => sdWS.send(JSON.stringify({ event: 'setState', context: ctx, payload })));
}

const contexts = {
    'com.daniel.discordpro.micmute': new Set(), 'com.daniel.discordpro.deafen': new Set(),
    'com.daniel.discordpro.speaking': new Set(), 'com.daniel.discordpro.volumemute': new Set(),
    'com.daniel.discordpro.activity': new Set(), 'com.daniel.discordpro.userinfo': new Set(),
    'com.daniel.discordpro.usercontrol': new Set()
};
const contextCoordinates = new Map();

const discord = new DiscordRPC(CLIENT_ID, CLIENT_SECRET);
discord.connect();

let sdWS = null;

function connectStreamDock() {
    const args = process.argv.slice(2);
    const port = args[args.indexOf('-port') + 1];
    const pluginUUID = args[args.indexOf('-pluginUUID') + 1];
    const registerEvent = args[args.indexOf('-registerEvent') + 1];
    if (!port || !pluginUUID) return;

    sdWS = new WebSocket(`ws://127.0.0.1:${port}`);
    sdWS.on('error', (e) => log('Erro StreamDock WS: ' + e.message));
    sdWS.on('open', () => sdWS.send(JSON.stringify({ event: registerEvent, uuid: pluginUUID })));
    sdWS.on('message', (data) => {
        const { event, action, context, payload } = JSON.parse(data);
        if (event === 'willAppear') {
            if (contexts[action]) {
                contexts[action].add(context);
                if (payload && payload.coordinates) {
                    contextCoordinates.set(context, payload.coordinates);
                }
            }
            discord.updateStreamDockState();
        } else if (event === 'willDisappear') {
            if (contexts[action]) {
                contexts[action].delete(context);
                contextCoordinates.delete(context);
            }
        } else if (event === 'keyUp') {
            if (action === 'com.daniel.discordpro.micmute') discord.toggleMute();
            if (action === 'com.daniel.discordpro.deafen') discord.toggleDeafen();
            if (action === 'com.daniel.discordpro.volumemute') discord.toggleDeafen();
            if (action === 'com.daniel.discordpro.activity') {
                discord.richPresenceActive = !discord.richPresenceActive;
                discord.setActivity(discord.richPresenceActive);
            }
            if (action === 'com.daniel.discordpro.userinfo') {
                discord.toggleNoiseSuppression();
            }
            if (action === 'com.daniel.discordpro.usercontrol') {
                const buttons = Array.from(contexts['com.daniel.discordpro.usercontrol']).sort((a, b) => {
                    const coordA = contextCoordinates.get(a);
                    const coordB = contextCoordinates.get(b);
                    if (!coordA || !coordB) return 0;
                    if (coordA.row !== coordB.row) return coordA.row - coordB.row;
                    return coordA.column - coordB.column;
                });
                const index = buttons.indexOf(context);
                if (discord.selectedUserId) {
                    const user = discord.usersInChannel.get(discord.selectedUserId);
                    if (index === 0) {
                        discord.selectedUserId = null;
                    }
                    if (index === 1) discord.toggleUserMute(discord.selectedUserId);
                    if (index === 2) {
                        discord.setUserVolume(discord.selectedUserId, (user?.volume || 100) - 10);
                    }
                    if (index === 3) {
                        discord.setUserVolume(discord.selectedUserId, (user?.volume || 100) + 10);
                    }
                    if (index === 4) {
                        discord.setUserVolume(discord.selectedUserId, 100);
                    }
                } else {
                    if (index < 5) {
                        const sortedUsers = Array.from(discord.usersInChannel.values()).filter(u => u.id !== discord.user?.id);
                        const user = sortedUsers[discord.currentPage * 5 + index];
                        if (user) discord.selectedUserId = user.id;
                    } else {
                        discord.currentPage = (discord.currentPage + 1) % Math.ceil(Math.max(1, Array.from(discord.usersInChannel.values()).length - 1) / 5);
                    }
                }
                discord.updateStreamDockState();
            }
        } else if (event === 'dialRotate') {
            if (action === 'com.daniel.discordpro.usercontrol') {
                let targetUserId = discord.selectedUserId;
                if (!targetUserId) {
                    const speakingUser = Array.from(discord.usersInChannel.values())
                        .find(u => u.speaking && u.id !== discord.user?.id);
                    if (speakingUser) targetUserId = speakingUser.id;
                }
                if (targetUserId) {
                    const user = discord.usersInChannel.get(targetUserId);
                    if (user) discord.setUserVolume(targetUserId, (user.volume || 100) + payload.ticks * 5);
                }
            } else if (action === 'com.daniel.discordpro.volumemute' || action === 'com.daniel.discordpro.deafen') {
                const currentVol = discord.voiceState.output?.volume ?? 100;
                const newVol = Math.max(0, Math.min(200, currentVol + payload.ticks * 5));
                discord.request('SET_VOICE_SETTINGS', { output: { volume: newVol } });
            } else if (action === 'com.daniel.discordpro.micmute') {
                const currentVol = discord.voiceState.input?.volume ?? 100;
                const newVol = Math.max(0, Math.min(100, currentVol + payload.ticks * 5));
                discord.request('SET_VOICE_SETTINGS', { input: { volume: newVol } });
            }
        }
    });
}

connectStreamDock();
