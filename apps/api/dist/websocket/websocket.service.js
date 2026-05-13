"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsService = exports.WebSocketService = void 0;
exports.initializeWebSocket = initializeWebSocket;
const socket_io_1 = require("socket.io");
const kafka_service_1 = require("../services/kafka.service");
const events_1 = require("../types/events");
const matchmaking_service_1 = require("../services/matchmaking.service");
const game_manager_service_1 = require("../services/game-manager.service");
const game_1 = require("../types/game");
const word_puzzle_service_1 = require("../services/word-puzzle.service");
const word_puzzle_1 = require("../types/word-puzzle");
const dots_and_boxes_service_1 = require("../services/dots-and-boxes.service");
const dots_and_boxes_1 = require("../types/dots-and-boxes");
const bingo_service_1 = require("../services/bingo.service");
const bingo_1 = require("../types/bingo");
class WebSocketService {
    io;
    connectedPlayers = new Map();
    /** Private lobby: host + invited players join until maxPlayers, then a game starts */
    privateRooms = new Map();
    /** Invite-game rematch: same partyId across games until everyone votes to play again */
    rematchPlayers = new Map();
    rematchVotes = new Map();
    /** Countdown timers: start when first vote arrives; fires after 10s to start with whoever voted */
    rematchTimers = new Map();
    /** Last win streak (4–8) for this party — reused on rematch so host choice persists */
    rematchWinStreak = new Map();
    /** Voice call: tracks who is in the call for each game room */
    callRooms = new Map(); // gameId → Set<username>
    // ── Word Puzzle lobby & matchmaking ───────────────────────────────────────
    wpRooms = new Map();
    /** Simple FIFO matchmaking queue for word puzzle */
    wpQueue = [];
    wpQueueTimer = null;
    // ── Word Puzzle rematch state ────────────────────────────────────────────
    wpRematchPlayers = new Map(); // gameId → usernames
    wpRematchVotes = new Map();
    wpRematchTimers = new Map();
    wpRematchWordCount = new Map();
    // ── Dots & Boxes state ───────────────────────────────────────────────────
    dabRooms = new Map();
    dabQueue = [];
    dabRematchVotes = new Map();
    dabRematchTimers = new Map();
    // ── Bingo state ──────────────────────────────────────────────────────────
    bingoRooms = new Map();
    bingoQueue = [];
    bingoCallTimers = new Map();
    bingoRematchVotes = new Map();
    bingoRematchTimers = new Map();
    constructor(httpServer) {
        // Define allowed origins
        const allowedOrigins = [
            'https://4-in-a-row-web-kappa.vercel.app',
            'https://play.shivangyadav.com',
            'http://localhost:3000',
            process.env.FRONTEND_URL,
        ].filter(Boolean);
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: allowedOrigins,
                methods: ['GET', 'POST'],
                credentials: true,
            },
            transports: ['websocket', 'polling'],
        });
        this.setupEventHandlers();
        console.log('🔌 WebSocket server initialized');
    }
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`✅ Client connected: ${socket.id}`);
            // Handle player joining
            socket.on('player:join', (data) => {
                const { username } = data;
                this.connectedPlayers.set(username, socket);
                socket.data.username = username;
                console.log(`👤 Player joined: ${username}`);
                // Send Kafka event
                kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_JOINED, {
                    username,
                    socketId: socket.id,
                    timestamp: new Date().toISOString(),
                });
                socket.emit('player:joined', { username, socketId: socket.id });
            });
            // Handle player ready for matchmaking
            socket.on('matchmaking:join', (data) => {
                const { username } = data;
                // Check if player has an active private room - they should not be in matchmaking
                const existingRoomCode = socket.data.roomCode;
                if (existingRoomCode && this.privateRooms.has(existingRoomCode)) {
                    // Clean up the private room first
                    this.privateRooms.delete(existingRoomCode);
                    socket.data.roomCode = null;
                    console.log(`🧹 Cleaned up private room ${existingRoomCode} for ${username} joining matchmaking`);
                }
                console.log(`🎮 Player ${username} joined matchmaking`);
                matchmaking_service_1.matchmakingService.joinQueue(username);
                socket.emit('matchmaking:queued', { position: matchmaking_service_1.matchmakingService.getQueueSize() });
            });
            // Handle player wanting to play with bot immediately
            socket.on('matchmaking:join-bot', (data) => {
                console.log(`🤖 Player ${data.username} requested bot game`);
                const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
                const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
                const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
                game_manager_service_1.gameManager.createTwoPlayerGame(data.username, botName, true);
            });
            // Handle creating a private room (Play with Friend)
            socket.on('room:create', (data) => {
                const { username } = data;
                const maxPlayers = game_1.MAX_PLAYERS_PER_GAME; // host picks when starting; cap at 8
                // IMPORTANT: Remove player from matchmaking queue if they were there
                matchmaking_service_1.matchmakingService.leaveQueue(username);
                const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
                const members = new Map();
                members.set(username, socket);
                const colorChoices = new Map();
                this.privateRooms.set(roomCode, { hostUsername: username, maxPlayers, members, colorChoices });
                socket.data.roomCode = roomCode;
                socket.data.waitingRoomCode = roomCode;
                socket.join(`waiting-${roomCode}`);
                console.log(`🏠 Room created: ${roomCode} by ${username}`);
                socket.emit('room:created', { roomCode, hostUsername: username, players: [username] });
                this.io.to(`waiting-${roomCode}`).emit('room:lobbyUpdate', {
                    players: [...members.keys()],
                    maxPlayers,
                    hostUsername: username,
                    colorChoices: Object.fromEntries(colorChoices),
                });
            });
            // Handle joining a private room
            socket.on('room:join', (data) => {
                const { username, roomCode } = data;
                const normalizedCode = roomCode.toUpperCase().trim();
                const room = this.privateRooms.get(normalizedCode);
                if (!room) {
                    socket.emit('room:error', { message: 'Room not found. Please check the code and try again.' });
                    return;
                }
                if (room.hostUsername === username) {
                    socket.emit('room:error', { message: 'You cannot join your own room!' });
                    return;
                }
                if (room.members.has(username)) {
                    room.members.set(username, socket);
                    socket.data.waitingRoomCode = normalizedCode;
                    socket.join(`waiting-${normalizedCode}`);
                    socket.emit('room:joinPending', {
                        roomCode: normalizedCode,
                        players: [...room.members.keys()],
                        maxPlayers: room.maxPlayers,
                        hostUsername: room.hostUsername,
                        colorChoices: Object.fromEntries(room.colorChoices),
                    });
                    return;
                }
                if (room.members.size >= room.maxPlayers) {
                    socket.emit('room:error', { message: 'This room is full.' });
                    return;
                }
                console.log(`🤝 ${username} joining room ${normalizedCode} (${room.members.size + 1}/${room.maxPlayers})`);
                matchmaking_service_1.matchmakingService.leaveQueue(username);
                room.members.set(username, socket);
                socket.data.waitingRoomCode = normalizedCode;
                socket.join(`waiting-${normalizedCode}`);
                const playerList = [...room.members.keys()];
                this.io.to(`waiting-${normalizedCode}`).emit('room:lobbyUpdate', {
                    players: playerList,
                    maxPlayers: room.maxPlayers,
                    hostUsername: room.hostUsername,
                    colorChoices: Object.fromEntries(room.colorChoices),
                });
                if (playerList.length < room.maxPlayers) {
                    socket.emit('room:joinPending', {
                        roomCode: normalizedCode,
                        players: playerList,
                        maxPlayers: room.maxPlayers,
                        hostUsername: room.hostUsername,
                        colorChoices: Object.fromEntries(room.colorChoices),
                    });
                    return;
                }
                for (const u of playerList) {
                    matchmaking_service_1.matchmakingService.leaveQueue(u);
                }
                this.privateRooms.delete(normalizedCode);
                for (const s of room.members.values()) {
                    s.data.roomCode = null;
                    s.data.waitingRoomCode = null;
                    s.leave(`waiting-${normalizedCode}`);
                }
                const participants = playerList.map((u) => ({ username: u, isBot: false }));
                game_manager_service_1.gameManager.createGame(participants, { isInviteGame: true });
                console.log(`🎮 Private game started: ${playerList.join(', ')}`);
            });
            // Handle leaving/canceling a private room (host closes lobby or guest leaves while waiting)
            socket.on('room:leave', () => {
                const roomCode = socket.data.roomCode;
                const waitingCode = socket.data.waitingRoomCode;
                const code = roomCode || waitingCode;
                if (!code || !this.privateRooms.has(code)) {
                    socket.data.roomCode = null;
                    socket.data.waitingRoomCode = null;
                    return;
                }
                const room = this.privateRooms.get(code);
                const username = socket.data.username;
                if (room.hostUsername === username) {
                    this.privateRooms.delete(code);
                    this.io.to(`waiting-${code}`).emit('room:closed', { reason: 'Host left the lobby' });
                    for (const s of room.members.values()) {
                        s.data.roomCode = null;
                        s.data.waitingRoomCode = null;
                        s.leave(`waiting-${code}`);
                    }
                    room.members.clear();
                    console.log(`🚪 Room ${code} closed by host`);
                }
                else {
                    room.members.delete(username);
                    room.colorChoices.delete(username);
                    socket.data.waitingRoomCode = null;
                    socket.leave(`waiting-${code}`);
                    const playerList = [...room.members.keys()];
                    this.io.to(`waiting-${code}`).emit('room:lobbyUpdate', {
                        players: playerList,
                        maxPlayers: room.maxPlayers,
                        hostUsername: room.hostUsername,
                        colorChoices: Object.fromEntries(room.colorChoices),
                    });
                    console.log(`🚪 ${username} left waiting room ${code}`);
                }
                socket.data.roomCode = null;
            });
            // Host manually starts the game with whoever is in the room
            socket.on('room:start', (data) => {
                const code = (socket.data.roomCode || socket.data.waitingRoomCode);
                if (!code)
                    return;
                const room = this.privateRooms.get(code);
                if (!room)
                    return;
                const username = socket.data.username;
                if (room.hostUsername !== username) {
                    socket.emit('room:error', { message: 'Only the host can start the game.' });
                    return;
                }
                const playerList = [...room.members.keys()];
                if (playerList.length < 2) {
                    socket.emit('room:error', { message: 'Need at least 2 players to start.' });
                    return;
                }
                const colorChoicesSnapshot = Object.fromEntries(room.colorChoices);
                for (const u of playerList)
                    matchmaking_service_1.matchmakingService.leaveQueue(u);
                this.privateRooms.delete(code);
                for (const s of room.members.values()) {
                    s.data.roomCode = null;
                    s.data.waitingRoomCode = null;
                    s.leave(`waiting-${code}`);
                }
                const participants = playerList.map((u) => ({ username: u, isBot: false }));
                game_manager_service_1.gameManager.createGame(participants, { isInviteGame: true, winStreak: data?.winStreak, colorChoices: colorChoicesSnapshot });
                console.log(`🎮 Host started private game: ${playerList.join(', ')} (winStreak: ${data?.winStreak ?? 'default'})`);
            });
            // Handle a player picking their ball color in the lobby
            socket.on('room:colorPick', (data) => {
                const code = (socket.data.roomCode || socket.data.waitingRoomCode);
                if (!code)
                    return;
                const room = this.privateRooms.get(code);
                if (!room)
                    return;
                const username = socket.data.username;
                if (!room.members.has(username))
                    return;
                const { colorId } = data;
                // Check if another player already holds this color
                for (const [u, c] of room.colorChoices.entries()) {
                    if (c === colorId && u !== username) {
                        socket.emit('room:error', { message: 'That color is already taken by another player.' });
                        return;
                    }
                }
                if (colorId) {
                    room.colorChoices.set(username, colorId);
                }
                else {
                    room.colorChoices.delete(username);
                }
                this.io.to(`waiting-${code}`).emit('room:lobbyUpdate', {
                    players: [...room.members.keys()],
                    maxPlayers: room.maxPlayers,
                    hostUsername: room.hostUsername,
                    colorChoices: Object.fromEntries(room.colorChoices),
                });
                console.log(`🎨 ${username} picked color "${colorId}" in room ${code}`);
            });
            // Handle game moves
            socket.on('game:move', (data) => {
                const { gameId, column } = data;
                const username = socket.data.username;
                if (!username) {
                    socket.emit('error', { message: 'Username not set' });
                    return;
                }
                console.log(`🎯 Move from ${username} in game ${gameId}: column ${column}`);
                // Make the move using game manager
                const result = game_manager_service_1.gameManager.makeMove(gameId, username, column);
                if (!result.success) {
                    socket.emit('game:error', { message: result.error });
                    return;
                }
                // Game manager will emit updates via WebSocket
            });
            // Handle disconnection
            socket.on('disconnect', () => {
                const username = socket.data.username;
                if (username) {
                    this.connectedPlayers.delete(username);
                    matchmaking_service_1.matchmakingService.leaveQueue(username);
                    // Remove from WP matchmaking queue
                    this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
                    // Clean up any WP waiting room
                    this.handleWPRoomLeave(socket);
                    const waitingKey = (socket.data.waitingRoomCode || socket.data.roomCode);
                    if (waitingKey && this.privateRooms.has(waitingKey)) {
                        const room = this.privateRooms.get(waitingKey);
                        if (room.hostUsername === username) {
                            this.privateRooms.delete(waitingKey);
                            this.io.to(`waiting-${waitingKey}`).emit('room:closed', { reason: 'Host disconnected' });
                            for (const s of room.members.values()) {
                                s.data.roomCode = null;
                                s.data.waitingRoomCode = null;
                                s.leave(`waiting-${waitingKey}`);
                            }
                            room.members.clear();
                            console.log(`🚪 Room ${waitingKey} closed due to host disconnect`);
                        }
                        else {
                            room.members.delete(username);
                            room.colorChoices.delete(username);
                            const playerList = [...room.members.keys()];
                            this.io.to(`waiting-${waitingKey}`).emit('room:lobbyUpdate', {
                                players: playerList,
                                maxPlayers: room.maxPlayers,
                                hostUsername: room.hostUsername,
                                colorChoices: Object.fromEntries(room.colorChoices),
                            });
                            console.log(`🚪 ${username} disconnected from waiting room ${waitingKey}`);
                        }
                    }
                    console.log(`❌ Player disconnected: ${username}`);
                    const game = game_manager_service_1.gameManager.getGameByPlayer(username);
                    if (game) {
                        const gameId = game.id;
                        console.log(`⏰ Starting 30s reconnection timer for ${username} in game ${gameId}`);
                        setTimeout(() => {
                            const stillDisconnected = !this.connectedPlayers.has(username);
                            if (stillDisconnected && game_manager_service_1.gameManager.getGame(gameId)) {
                                console.log(`⚠️  Player ${username} didn't reconnect. Forfeiting game ${gameId}`);
                                game_manager_service_1.gameManager.removeDisconnectedPlayerFromGame(gameId, username);
                            }
                        }, 30000);
                    }
                    kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_DISCONNECTED, {
                        username,
                        socketId: socket.id,
                        timestamp: new Date().toISOString(),
                    });
                }
            });
            // Handle reconnection
            socket.on('game:reconnect', (data) => {
                const { gameId, username } = data;
                socket.join(gameId);
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                console.log(`🔄 Player reconnected: ${username} to game ${gameId}`);
                const game = game_manager_service_1.gameManager.getGame(gameId);
                if (game) {
                    const players = game.players;
                    const usernames = players.map((p) => p.username);
                    const seat = players.findIndex((p) => p.username === username);
                    socket.emit('game:state', {
                        gameId,
                        board: game.board,
                        currentTurn: game.currentTurn,
                        status: game.status,
                        players: usernames,
                        playerUsernames: usernames,
                        yourPlayerNumber: seat + 1,
                        winStreak: game.winStreak,
                        rankings: game.rankedOut ?? [],
                        partyId: game.partyId,
                        isInviteGame: game.isInviteGame,
                    });
                }
                kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_RECONNECTED, {
                    gameId,
                    username,
                    timestamp: new Date().toISOString(),
                });
            });
            socket.on('party:rematch', (data) => {
                const username = socket.data.username;
                const partyId = data?.partyId;
                if (!username || !partyId)
                    return;
                const players = this.rematchPlayers.get(partyId);
                if (!players?.length || !players.includes(username)) {
                    socket.emit('game:error', { message: 'Rematch is not available for this game.' });
                    return;
                }
                if (!this.rematchVotes.has(partyId)) {
                    this.rematchVotes.set(partyId, new Set());
                }
                const votes = this.rematchVotes.get(partyId);
                votes.add(username);
                // Active = original players whose socket is still connected right now
                const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);
                if (activePlayers.length < 2) {
                    this.cleanupRematch(partyId);
                    for (const u of activePlayers) {
                        this.connectedPlayers.get(u)?.emit('rematch:error', {
                            message: 'Not enough players connected to rematch.',
                        });
                    }
                    return;
                }
                // Broadcast current progress (only counting active voters)
                const activeVotes = [...votes].filter((u) => activePlayers.includes(u));
                const progressPayload = {
                    partyId,
                    votes: activeVotes.length,
                    needed: activePlayers.length,
                    voted: activeVotes,
                };
                for (const u of activePlayers) {
                    this.connectedPlayers.get(u)?.emit('rematch:progress', progressPayload);
                }
                // Start a 10s countdown on the FIRST vote so late/disconnected players don't block
                if (!this.rematchTimers.has(partyId)) {
                    const timer = setTimeout(() => {
                        console.log(`⏰ Rematch timeout for party ${partyId} — starting with voters`);
                        this.startRematchWithVoters(partyId);
                    }, 30000);
                    this.rematchTimers.set(partyId, timer);
                }
                // If all active players already voted, start immediately
                if (activeVotes.length >= activePlayers.length) {
                    this.startRematchWithVoters(partyId);
                }
            });
            // Handle chat messages
            socket.on('chat:send', (data) => {
                const { gameId, message } = data;
                const payload = { username: data.username, message };
                // Broadcast to plain room (4-in-a-row) and wp-game- prefixed room (word puzzle)
                this.io.to(gameId).to(`wp-game-${gameId}`).emit('chat:message', payload);
                console.log(`💬 Chat message from ${data.username} in game ${gameId}: ${message}`);
            });
            // ── Voice call signaling ────────────────────────────────────────────────
            // Player starts a call — broadcast ring to everyone else in the game room
            socket.on('call:start', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                if (!username || !gameId)
                    return;
                if (!this.callRooms.has(gameId))
                    this.callRooms.set(gameId, new Set());
                this.callRooms.get(gameId).add(username);
                socket.to(gameId).to(`wp-game-${gameId}`).to(`dab-game-${gameId}`).emit('call:ringing', { from: username, gameId });
                console.log(`📞 Call started by ${username} in game ${gameId}`);
            });
            // Player accepts call — join the call room, tell existing members to initiate offers
            socket.on('call:join', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                if (!username || !gameId)
                    return;
                if (!this.callRooms.has(gameId))
                    this.callRooms.set(gameId, new Set());
                const members = this.callRooms.get(gameId);
                const existing = [...members]; // members before this joiner
                members.add(username);
                // Tell each existing member to create an offer for the new joiner
                for (const peer of existing) {
                    const peerSock = this.connectedPlayers.get(peer);
                    peerSock?.emit('call:peer_joined', { username, gameId });
                }
                // Tell the new joiner who is already in the call
                socket.emit('call:members', { members: existing, gameId });
                console.log(`📞 ${username} joined call in game ${gameId}. Members: ${[...members].join(', ')}`);
            });
            // Player rejects call
            socket.on('call:reject', (data) => {
                const username = socket.data.username;
                socket.to(data.gameId).to(`wp-game-${data.gameId}`).to(`dab-game-${data.gameId}`).emit('call:rejected', { username });
            });
            // Relay WebRTC offer to target peer
            socket.on('call:offer', (data) => {
                const from = socket.data.username;
                const targetSock = this.connectedPlayers.get(data.to);
                targetSock?.emit('call:offer', { from, offer: data.offer, gameId: data.gameId });
            });
            // Relay WebRTC answer to target peer
            socket.on('call:answer', (data) => {
                const from = socket.data.username;
                const targetSock = this.connectedPlayers.get(data.to);
                targetSock?.emit('call:answer', { from, answer: data.answer, gameId: data.gameId });
            });
            // Relay ICE candidate to target peer
            socket.on('call:ice', (data) => {
                const from = socket.data.username;
                const targetSock = this.connectedPlayers.get(data.to);
                targetSock?.emit('call:ice', { from, candidate: data.candidate });
            });
            // Player leaves call
            socket.on('call:leave', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                this.callRooms.get(gameId)?.delete(username);
                if (this.callRooms.get(gameId)?.size === 0)
                    this.callRooms.delete(gameId);
                socket.to(gameId).to(`wp-game-${gameId}`).to(`dab-game-${gameId}`).emit('call:peer_left', { username, gameId });
                console.log(`📞 ${username} left call in game ${gameId}`);
            });
            socket.on('call:mute', (data) => {
                const username = socket.data.username;
                socket.to(data.gameId).to(`wp-game-${data.gameId}`).to(`dab-game-${data.gameId}`).emit('call:mute', { username, muted: data.muted });
            });
            // ── Word Puzzle events (wp: prefix) ────────────────────────────────────
            // Matchmaking: join queue
            socket.on('wp:matchmaking:join', (data) => {
                const { username } = data;
                const wordCount = data.wordCount ?? 14; // default: medium
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                // Remove from queue if already in
                this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
                this.wpQueue.push({ username, socket, wordCount });
                socket.emit('wp:matchmaking:queued', { position: this.wpQueue.length });
                console.log(`🔤 WP matchmaking: ${username} joined queue (size=${this.wpQueue.length}, words=${wordCount})`);
                if (this.wpQueue.length >= 2) {
                    const pair = this.wpQueue.splice(0, 2);
                    // Use the average word count of the two matched players (rounded to nearest defined level)
                    const avgWc = Math.round(((pair[0]?.wordCount ?? 14) + (pair[1]?.wordCount ?? 14)) / 2);
                    this.startWPGame(pair.map((e) => ({ username: e.username, socket: e.socket })), avgWc);
                }
            });
            // Solo play: start an instant single-player game
            socket.on('wp:solo:start', (data) => {
                const { username } = data;
                const wordCount = data.wordCount ?? 14;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                console.log(`🔤 WP solo game starting for ${username} (words=${wordCount})`);
                this.startWPGame([{ username, socket }], wordCount);
            });
            // Matchmaking: leave queue
            socket.on('wp:matchmaking:leave', () => {
                const username = socket.data.username;
                if (username) {
                    this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
                }
            });
            // Room: create
            socket.on('wp:room:create', (data) => {
                const { username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                // Remove from WP queue if present
                this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
                const code = (0, word_puzzle_1.generateRoomCode)();
                const members = new Map();
                members.set(username, socket);
                const room = { code, hostUsername: username, members, wordCount: 10 };
                this.wpRooms.set(code, room);
                socket.data.wpRoomCode = code;
                socket.join(`wp-waiting-${code}`);
                socket.emit('wp:room:created', { roomCode: code, hostUsername: username });
                this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
                    players: [username],
                    hostUsername: username,
                    wordCount: room.wordCount,
                    maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
                });
                console.log(`🔤 WP room created: ${code} by ${username}`);
            });
            // Room: join
            socket.on('wp:room:join', (data) => {
                const { username, roomCode } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const code = roomCode.toUpperCase().trim();
                const room = this.wpRooms.get(code);
                if (!room) {
                    socket.emit('wp:room:error', { message: 'Room not found. Check the code and try again.' });
                    return;
                }
                if (room.members.size >= game_1.MAX_PLAYERS_PER_GAME) {
                    socket.emit('wp:room:error', { message: 'This room is full (max 8 players).' });
                    return;
                }
                if (room.members.has(username)) {
                    room.members.set(username, socket);
                    socket.data.wpRoomCode = code;
                    socket.join(`wp-waiting-${code}`);
                    socket.emit('wp:room:joinPending', {
                        roomCode: code,
                        players: [...room.members.keys()],
                        hostUsername: room.hostUsername,
                        wordCount: room.wordCount,
                        maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
                    });
                    return;
                }
                this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
                room.members.set(username, socket);
                socket.data.wpRoomCode = code;
                socket.join(`wp-waiting-${code}`);
                const playerList = [...room.members.keys()];
                this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
                    players: playerList,
                    hostUsername: room.hostUsername,
                    wordCount: room.wordCount,
                    maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
                });
                socket.emit('wp:room:joinPending', {
                    roomCode: code,
                    players: playerList,
                    hostUsername: room.hostUsername,
                    wordCount: room.wordCount,
                    maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
                });
                console.log(`🔤 ${username} joined WP room ${code}`);
            });
            // Room: leave
            socket.on('wp:room:leave', () => {
                this.handleWPRoomLeave(socket);
            });
            // Host sets word count
            socket.on('wp:room:setWordCount', (data) => {
                const code = socket.data.wpRoomCode;
                if (!code)
                    return;
                const room = this.wpRooms.get(code);
                if (!room || room.hostUsername !== socket.data.username)
                    return;
                room.wordCount = Math.max(10, Math.min(20, data.wordCount));
                this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
                    players: [...room.members.keys()],
                    hostUsername: room.hostUsername,
                    wordCount: room.wordCount,
                    maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
                });
                console.log(`🔤 WP room ${code}: word count set to ${room.wordCount}`);
            });
            // Host starts game
            socket.on('wp:room:start', () => {
                const code = socket.data.wpRoomCode;
                if (!code)
                    return;
                const room = this.wpRooms.get(code);
                if (!room)
                    return;
                if (room.hostUsername !== socket.data.username) {
                    socket.emit('wp:room:error', { message: 'Only the host can start the game.' });
                    return;
                }
                if (room.members.size < 2) {
                    socket.emit('wp:room:error', { message: 'Need at least 2 players to start.' });
                    return;
                }
                const playerList = [...room.members.keys()];
                const sockets = [...room.members.values()];
                // Clean up room
                this.wpRooms.delete(code);
                for (const s of sockets) {
                    s.data.wpRoomCode = null;
                    s.leave(`wp-waiting-${code}`);
                }
                this.startWPGame(playerList.map((u) => ({ username: u, socket: room.members.get(u) })), room.wordCount);
                console.log(`🔤 WP room ${code} game started: ${playerList.join(', ')}`);
            });
            // Player claims a word
            socket.on('wp:game:claim', (data) => {
                const username = socket.data.username;
                const { gameId, startRow, startCol, endRow, endCol } = data;
                if (!username || !gameId)
                    return;
                const result = word_puzzle_service_1.wordPuzzleService.claimWord(gameId, username, startRow, startCol, endRow, endCol);
                if (!result) {
                    socket.emit('wp:game:claimFailed', { message: 'Invalid selection or word already claimed.' });
                    return;
                }
                const { word, player } = result;
                const game = word_puzzle_service_1.wordPuzzleService.getGame(gameId);
                // Broadcast the claim to all players in the game room
                this.io.to(`wp-game-${gameId}`).emit('wp:game:wordClaimed', {
                    wordId: word.id,
                    word: word.word,
                    cells: word.cells,
                    claimedBy: username,
                    colorIndex: player.colorIndex,
                    score: player.score,
                    players: game.players.map((p) => ({ username: p.username, score: p.score, colorIndex: p.colorIndex })),
                });
                // If game ended, emit game over
                if (game.status === 'ended') {
                    const sorted = [...game.players].sort((a, b) => b.score - a.score);
                    const playerUsernames = game.players.map((p) => p.username);
                    // Register rematch so players can play again
                    this.wpRematchPlayers.set(gameId, playerUsernames);
                    this.wpRematchVotes.set(gameId, new Set());
                    this.wpRematchWordCount.set(gameId, game.wordCount);
                    this.io.to(`wp-game-${gameId}`).emit('wp:game:ended', {
                        gameId,
                        players: sorted.map((p) => ({ username: p.username, score: p.score, colorIndex: p.colorIndex })),
                        winner: sorted[0]?.username ?? null,
                        words: game.words,
                    });
                    setTimeout(() => word_puzzle_service_1.wordPuzzleService.deleteGame(gameId), 60000);
                    console.log(`🏁 WP game ${gameId} ended. Winner: ${sorted[0]?.username}`);
                }
            });
            // Reconnect to a word puzzle game
            socket.on('wp:game:reconnect', (data) => {
                const { gameId, username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                socket.join(`wp-game-${gameId}`);
                word_puzzle_service_1.wordPuzzleService.updateSocketId(gameId, username, socket.id);
                const game = word_puzzle_service_1.wordPuzzleService.getGame(gameId);
                if (game) {
                    socket.emit('wp:game:state', {
                        gameId: game.id,
                        board: game.board,
                        gridSize: game.gridSize,
                        words: game.words,
                        players: game.players,
                        wordCount: game.wordCount,
                        status: game.status,
                    });
                }
            });
            // ── Word Puzzle rematch ─────────────────────────────────────────────────
            socket.on('wp:rematch', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                if (!username || !gameId)
                    return;
                const players = this.wpRematchPlayers.get(gameId);
                if (!players?.length || !players.includes(username)) {
                    socket.emit('wp:rematch:error', { message: 'Rematch is not available.' });
                    return;
                }
                if (!this.wpRematchVotes.has(gameId)) {
                    this.wpRematchVotes.set(gameId, new Set());
                }
                const votes = this.wpRematchVotes.get(gameId);
                votes.add(username);
                const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);
                if (activePlayers.length < 2) {
                    this.cleanupWPRematch(gameId);
                    for (const u of activePlayers) {
                        this.connectedPlayers.get(u)?.emit('wp:rematch:error', {
                            message: 'Not enough players connected to rematch.',
                        });
                    }
                    return;
                }
                const activeVotes = [...votes].filter((u) => activePlayers.includes(u));
                const progressPayload = {
                    gameId,
                    votes: activeVotes.length,
                    needed: activePlayers.length,
                    voted: activeVotes,
                };
                for (const u of activePlayers) {
                    this.connectedPlayers.get(u)?.emit('wp:rematch:progress', progressPayload);
                }
                // Start 30s timer on first vote
                if (!this.wpRematchTimers.has(gameId)) {
                    const timer = setTimeout(() => {
                        console.log(`⏰ WP rematch timeout for game ${gameId} — starting with voters`);
                        this.startWPRematchWithVoters(gameId);
                    }, 30000);
                    this.wpRematchTimers.set(gameId, timer);
                }
                // If all active players voted, start immediately
                if (activeVotes.length >= activePlayers.length) {
                    this.startWPRematchWithVoters(gameId);
                }
            });
            // ══════════════════════════════════════════════════════════════════════
            // DOTS & BOXES — Socket Event Handlers
            // ══════════════════════════════════════════════════════════════════════
            const MAX_DAB_PLAYERS = 8;
            // ── Room: create ─────────────────────────────────────────────────────
            socket.on('dab:room:create', (data) => {
                const { username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const code = (0, dots_and_boxes_1.generateDABRoomCode)();
                const members = new Map();
                members.set(username, socket);
                const room = {
                    code,
                    hostUsername: username,
                    members,
                    gridRows: data.gridRows ?? 5,
                    gridCols: data.gridCols ?? 5,
                    maxPlayers: MAX_DAB_PLAYERS,
                    status: 'lobby',
                };
                this.dabRooms.set(code, room);
                socket.data.dabRoomCode = code;
                socket.join(`dab-lobby-${code}`);
                socket.emit('dab:room:created', { roomCode: code, hostUsername: username });
                this.io.to(`dab-lobby-${code}`).emit('dab:room:lobbyUpdate', {
                    players: [username],
                    hostUsername: username,
                    gridRows: room.gridRows,
                    gridCols: room.gridCols,
                    maxPlayers: MAX_DAB_PLAYERS,
                });
                console.log(`🟣 DAB room created: ${code} by ${username}`);
            });
            // ── Room: join ───────────────────────────────────────────────────────
            socket.on('dab:room:join', (data) => {
                const { username, roomCode } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const code = roomCode.toUpperCase().trim();
                const room = this.dabRooms.get(code);
                if (!room) {
                    socket.emit('dab:room:error', { message: 'Room not found. Check the code and try again.' });
                    return;
                }
                if (room.status !== 'lobby') {
                    socket.emit('dab:room:error', { message: 'This game has already started.' });
                    return;
                }
                if (room.members.size >= MAX_DAB_PLAYERS) {
                    socket.emit('dab:room:error', { message: 'This room is full (max 8 players).' });
                    return;
                }
                // Handle reconnect
                if (room.members.has(username)) {
                    room.members.set(username, socket);
                    socket.data.dabRoomCode = code;
                    socket.join(`dab-lobby-${code}`);
                    socket.emit('dab:room:joinPending', {
                        roomCode: code,
                        players: [...room.members.keys()],
                        hostUsername: room.hostUsername,
                        gridRows: room.gridRows,
                        gridCols: room.gridCols,
                        maxPlayers: MAX_DAB_PLAYERS,
                    });
                    return;
                }
                room.members.set(username, socket);
                socket.data.dabRoomCode = code;
                socket.join(`dab-lobby-${code}`);
                const playerList = [...room.members.keys()];
                this.io.to(`dab-lobby-${code}`).emit('dab:room:lobbyUpdate', {
                    players: playerList,
                    hostUsername: room.hostUsername,
                    gridRows: room.gridRows,
                    gridCols: room.gridCols,
                    maxPlayers: MAX_DAB_PLAYERS,
                });
                socket.emit('dab:room:joinPending', {
                    roomCode: code,
                    players: playerList,
                    hostUsername: room.hostUsername,
                    gridRows: room.gridRows,
                    gridCols: room.gridCols,
                    maxPlayers: MAX_DAB_PLAYERS,
                });
                console.log(`🟣 ${username} joined DAB room ${code}`);
            });
            // ── Room: leave ──────────────────────────────────────────────────────
            socket.on('dab:room:leave', () => {
                this.handleDABRoomLeave(socket);
            });
            // ── Host sets grid ───────────────────────────────────────────────────
            socket.on('dab:room:setGrid', (data) => {
                const code = socket.data.dabRoomCode;
                if (!code)
                    return;
                const room = this.dabRooms.get(code);
                if (!room || room.hostUsername !== socket.data.username)
                    return;
                room.gridRows = Math.max(2, Math.min(15, data.gridRows));
                room.gridCols = Math.max(2, Math.min(15, data.gridCols));
                this.io.to(`dab-lobby-${code}`).emit('dab:room:lobbyUpdate', {
                    players: [...room.members.keys()],
                    hostUsername: room.hostUsername,
                    gridRows: room.gridRows,
                    gridCols: room.gridCols,
                    maxPlayers: MAX_DAB_PLAYERS,
                });
                console.log(`🟣 DAB room ${code}: grid set to ${room.gridRows}×${room.gridCols}`);
            });
            // ── Host starts game ─────────────────────────────────────────────────
            socket.on('dab:room:start', () => {
                const code = socket.data.dabRoomCode;
                if (!code)
                    return;
                const room = this.dabRooms.get(code);
                if (!room)
                    return;
                if (room.hostUsername !== socket.data.username) {
                    socket.emit('dab:room:error', { message: 'Only the host can start the game.' });
                    return;
                }
                if (room.members.size < 2) {
                    socket.emit('dab:room:error', { message: 'Need at least 2 players to start.' });
                    return;
                }
                const playerList = [...room.members.keys()];
                this.startDABGame(room, playerList);
                console.log(`🟣 DAB room ${code} game started: ${playerList.join(', ')}`);
            });
            // ── Quick match queue ────────────────────────────────────────────────
            socket.on('dab:queue:join', (data) => {
                const { username, gridRows, gridCols } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                this.dabQueue = this.dabQueue.filter((e) => e.username !== username);
                this.dabQueue.push({ username, socket, gridRows, gridCols });
                socket.emit('dab:queue:queued', { position: this.dabQueue.length });
                if (this.dabQueue.length >= 2) {
                    const pair = this.dabQueue.splice(0, 2);
                    const avgRows = Math.round(((pair[0]?.gridRows ?? 5) + (pair[1]?.gridRows ?? 5)) / 2);
                    const avgCols = Math.round(((pair[0]?.gridCols ?? 5) + (pair[1]?.gridCols ?? 5)) / 2);
                    const code = (0, dots_and_boxes_1.generateDABRoomCode)();
                    const members = new Map();
                    for (const p of pair)
                        members.set(p.username, p.socket);
                    const room = {
                        code,
                        hostUsername: pair[0].username,
                        members,
                        gridRows: avgRows,
                        gridCols: avgCols,
                        maxPlayers: 2,
                        status: 'lobby',
                    };
                    this.dabRooms.set(code, room);
                    this.startDABGame(room, pair.map((p) => p.username));
                }
            });
            socket.on('dab:queue:leave', () => {
                const username = socket.data.username;
                if (username)
                    this.dabQueue = this.dabQueue.filter((e) => e.username !== username);
            });
            // ── Rejoin (friend-room game page reconnect) ──────────────────────────
            // When the lobby page navigates to the game page a fresh socket is created.
            // This event re-attaches that socket to the in-progress game room so that
            // dab:move:made / dab:chat:message broadcasts reach the new connection.
            socket.on('dab:rejoin', (data) => {
                const { gameId, username } = data;
                if (!gameId || !username)
                    return;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const room = [...this.dabRooms.values()].find((r) => r.gameId === gameId);
                if (!room) {
                    console.log(`🟣 dab:rejoin — room not found for gameId=${gameId}`);
                    return;
                }
                // Update the members map so future broadcasts / turn checks use the new socket
                room.members.set(username, socket);
                socket.data.dabGameId = gameId;
                socket.data.dabRoomCode = room.code;
                socket.join(`dab-game-${gameId}`);
                console.log(`🟣 dab:rejoin — ${username} rejoined game ${gameId}`);
                socket.emit('dab:rejoined', { gameId });
            });
            // ── Game move ────────────────────────────────────────────────────────
            socket.on('dab:move', (data) => {
                const username = socket.data.username;
                const { gameId, type, row, col } = data;
                console.log(`🟣 dab:move received — user=${username} gameId=${gameId} type=${type} r=${row} c=${col}`);
                if (!username || !gameId) {
                    console.log(`🟣 dab:move — rejected: missing username or gameId`);
                    return;
                }
                // Find the room with this gameId
                const room = [...this.dabRooms.values()].find((r) => r.gameId === gameId);
                if (!room || room.status !== 'playing') {
                    console.log(`🟣 dab:move — rejected: room not found or not playing (status=${room?.status})`);
                    return;
                }
                const players = room.players;
                const currentIdx = room.currentTurn;
                if (players[currentIdx] !== username) {
                    console.log(`🟣 dab:move — rejected: not your turn (expected=${players[currentIdx]}, got=${username})`);
                    socket.emit('dab:error', { message: 'Not your turn.' });
                    return;
                }
                // Validate move bounds
                const { hLines, vLines, boxes } = room;
                if (type === 'h') {
                    if (row < 0 || row > room.gridRows || col < 0 || col >= room.gridCols)
                        return;
                    if (hLines[row][col] !== null)
                        return;
                }
                else {
                    if (row < 0 || row >= room.gridRows || col < 0 || col > room.gridCols)
                        return;
                    if (vLines[row][col] !== null)
                        return;
                }
                const result = dots_and_boxes_service_1.dotsAndBoxesService.makeMove(hLines, vLines, boxes, room.scores, players.length, currentIdx, players, type, row, col);
                // Update room state
                room.hLines = result.hLines;
                room.vLines = result.vLines;
                room.boxes = result.boxes;
                room.scores = result.scores;
                room.currentTurn = result.currentTurn;
                const payload = {
                    gameId,
                    hLines: result.hLines,
                    vLines: result.vLines,
                    boxes: result.boxes,
                    scores: result.scores,
                    currentTurn: result.currentTurn,
                    currentPlayer: players[result.currentTurn],
                    boxesCompleted: result.boxesCompleted,
                    lastMove: { playerIdx: currentIdx, type, row, col },
                };
                this.io.to(`dab-game-${gameId}`).emit('dab:move:made', payload);
                if (result.gameOver) {
                    room.status = 'ended';
                    room.winner = result.winner;
                    const endPayload = {
                        gameId,
                        scores: result.scores,
                        players,
                        winner: result.winner,
                        rankings: result.rankings,
                        partyId: room.partyId,
                    };
                    this.io.to(`dab-game-${gameId}`).emit('dab:game:ended', endPayload);
                    // Setup rematch
                    if (players.length >= 2) {
                        this.dabRematchVotes.set(gameId, new Set());
                    }
                    console.log(`🟣 DAB game ${gameId} ended. Winner: ${result.winner}`);
                }
            });
            // ── Rematch vote ─────────────────────────────────────────────────────
            socket.on('dab:rematch:vote', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                if (!username || !gameId)
                    return;
                const room = [...this.dabRooms.values()].find((r) => r.gameId === gameId);
                if (!room || room.status !== 'ended')
                    return;
                let votes = this.dabRematchVotes.get(gameId);
                if (!votes) {
                    votes = new Set();
                    this.dabRematchVotes.set(gameId, votes);
                }
                votes.add(username);
                const players = room.players;
                const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);
                const progressPayload = { gameId, votes: votes.size, needed: activePlayers.length, voted: [...votes] };
                for (const u of activePlayers) {
                    this.connectedPlayers.get(u)?.emit('dab:rematch:progress', progressPayload);
                }
                if (!this.dabRematchTimers.has(gameId)) {
                    const timer = setTimeout(() => this.startDABRematch(gameId), 30000);
                    this.dabRematchTimers.set(gameId, timer);
                }
                if (votes.size >= activePlayers.length) {
                    this.startDABRematch(gameId);
                }
            });
            // ── Chat ─────────────────────────────────────────────────────────────
            socket.on('dab:chat', (data) => {
                const username = socket.data.username;
                const { gameId, message } = data;
                if (!username || !gameId || !message?.trim())
                    return;
                this.io.to(`dab-game-${gameId}`).emit('dab:chat:message', {
                    username,
                    message: message.trim().slice(0, 200),
                    timestamp: Date.now(),
                });
            });
            // ══════════════════════════════════════════════════════════════════════
            // BINGO — Socket Event Handlers
            // ══════════════════════════════════════════════════════════════════════
            const MAX_BINGO_PLAYERS = 8;
            // ── Room: create ─────────────────────────────────────────────────────
            socket.on('bingo:room:create', (data) => {
                const { username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const code = (0, bingo_1.generateBingoRoomCode)();
                const members = new Map();
                members.set(username, socket);
                const room = {
                    code,
                    hostUsername: username,
                    members,
                    maxPlayers: MAX_BINGO_PLAYERS,
                    status: 'lobby',
                };
                this.bingoRooms.set(code, room);
                socket.data.bingoRoomCode = code;
                socket.join(`bingo-lobby-${code}`);
                socket.emit('bingo:room:created', { roomCode: code, hostUsername: username });
                this.io.to(`bingo-lobby-${code}`).emit('bingo:room:lobbyUpdate', {
                    players: [username],
                    hostUsername: username,
                    maxPlayers: MAX_BINGO_PLAYERS,
                });
                console.log(`🎱 Bingo room created: ${code} by ${username}`);
            });
            // ── Room: join ───────────────────────────────────────────────────────
            socket.on('bingo:room:join', (data) => {
                const { username, roomCode } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const code = roomCode.toUpperCase().trim();
                const room = this.bingoRooms.get(code);
                if (!room) {
                    socket.emit('bingo:room:error', { message: 'Room not found. Check the code and try again.' });
                    return;
                }
                if (room.status !== 'lobby') {
                    socket.emit('bingo:room:error', { message: 'This game has already started.' });
                    return;
                }
                if (room.members.size >= MAX_BINGO_PLAYERS) {
                    socket.emit('bingo:room:error', { message: 'This room is full (max 8 players).' });
                    return;
                }
                if (room.members.has(username)) {
                    room.members.set(username, socket);
                    socket.data.bingoRoomCode = code;
                    socket.join(`bingo-lobby-${code}`);
                    socket.emit('bingo:room:joinPending', {
                        roomCode: code,
                        players: [...room.members.keys()],
                        hostUsername: room.hostUsername,
                        maxPlayers: MAX_BINGO_PLAYERS,
                    });
                    return;
                }
                room.members.set(username, socket);
                socket.data.bingoRoomCode = code;
                socket.join(`bingo-lobby-${code}`);
                const playerList = [...room.members.keys()];
                this.io.to(`bingo-lobby-${code}`).emit('bingo:room:lobbyUpdate', {
                    players: playerList,
                    hostUsername: room.hostUsername,
                    maxPlayers: MAX_BINGO_PLAYERS,
                });
                socket.emit('bingo:room:joinPending', {
                    roomCode: code,
                    players: playerList,
                    hostUsername: room.hostUsername,
                    maxPlayers: MAX_BINGO_PLAYERS,
                });
                console.log(`🎱 ${username} joined Bingo room ${code}`);
            });
            // ── Room: leave ──────────────────────────────────────────────────────
            socket.on('bingo:room:leave', () => {
                this.handleBingoRoomLeave(socket);
            });
            // ── Host starts game ─────────────────────────────────────────────────
            socket.on('bingo:room:start', () => {
                const code = socket.data.bingoRoomCode;
                if (!code)
                    return;
                const room = this.bingoRooms.get(code);
                if (!room)
                    return;
                if (room.hostUsername !== socket.data.username) {
                    socket.emit('bingo:room:error', { message: 'Only the host can start the game.' });
                    return;
                }
                if (room.members.size < 2) {
                    socket.emit('bingo:room:error', { message: 'Need at least 2 players to start.' });
                    return;
                }
                const playerList = [...room.members.keys()];
                this.startBingoGame(room, playerList, false);
                console.log(`🎱 Bingo room ${code} game started: ${playerList.join(', ')}`);
            });
            // ── Quick match ──────────────────────────────────────────────────────
            socket.on('bingo:queue:join', (data) => {
                const { username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                this.bingoQueue = this.bingoQueue.filter((e) => e.username !== username);
                this.bingoQueue.push({ username, socket });
                socket.emit('bingo:queue:queued', { position: this.bingoQueue.length });
                if (this.bingoQueue.length >= 2) {
                    const pair = this.bingoQueue.splice(0, 2);
                    const code = (0, bingo_1.generateBingoRoomCode)();
                    const members = new Map();
                    for (const p of pair)
                        members.set(p.username, p.socket);
                    const room = {
                        code,
                        hostUsername: pair[0].username,
                        members,
                        maxPlayers: 2,
                        status: 'lobby',
                    };
                    this.bingoRooms.set(code, room);
                    this.startBingoGame(room, pair.map((p) => p.username), false);
                }
            });
            socket.on('bingo:queue:leave', () => {
                const username = socket.data.username;
                if (username)
                    this.bingoQueue = this.bingoQueue.filter((e) => e.username !== username);
            });
            // ── Bot game ─────────────────────────────────────────────────────────
            socket.on('bingo:bot:start', (data) => {
                const { username } = data;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const adjectives = ['Lucky', 'Speedy', 'Clever', 'Happy', 'Wild', 'Cosmic', 'Thunder', 'Golden'];
                const nouns = ['Dauber', 'Caller', 'Bingo', 'Wizard', 'Master', 'Champion', 'Player', 'Ace'];
                const botName = `🤖 ${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
                const code = (0, bingo_1.generateBingoRoomCode)();
                const members = new Map();
                members.set(username, socket);
                const room = {
                    code,
                    hostUsername: username,
                    members,
                    maxPlayers: 2,
                    status: 'lobby',
                };
                this.bingoRooms.set(code, room);
                this.startBingoGame(room, [username, botName], true, botName);
                console.log(`🎱 Bingo bot game: ${username} vs ${botName}`);
            });
            // ── Rejoin ───────────────────────────────────────────────────────────
            socket.on('bingo:rejoin', (data) => {
                const { gameId, username } = data;
                if (!gameId || !username)
                    return;
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                const room = [...this.bingoRooms.values()].find((r) => r.gameId === gameId);
                if (!room)
                    return;
                room.members.set(username, socket);
                socket.data.bingoGameId = gameId;
                socket.data.bingoRoomCode = room.code;
                socket.join(`bingo-game-${gameId}`);
                console.log(`🎱 bingo:rejoin — ${username} rejoined game ${gameId}`);
                const game = bingo_service_1.bingoService.getGame(gameId);
                if (game) {
                    socket.emit('bingo:rejoined', {
                        gameId,
                        calledNumbers: game.calledNumbers,
                        currentCall: game.currentCall,
                        players: game.players,
                        status: game.status,
                        winner: game.winner,
                        rankings: game.rankings,
                    });
                }
            });
            // ── Chat ─────────────────────────────────────────────────────────────
            socket.on('bingo:chat', (data) => {
                const username = socket.data.username;
                const { gameId, message } = data;
                if (!username || !gameId || !message?.trim())
                    return;
                this.io.to(`bingo-game-${gameId}`).emit('bingo:chat:message', {
                    username,
                    message: message.trim().slice(0, 200),
                    timestamp: Date.now(),
                });
            });
            // ── Rematch vote ─────────────────────────────────────────────────────
            socket.on('bingo:rematch:vote', (data) => {
                const username = socket.data.username;
                const { gameId } = data;
                if (!username || !gameId)
                    return;
                const room = [...this.bingoRooms.values()].find((r) => r.gameId === gameId);
                if (!room || room.status !== 'ended')
                    return;
                let votes = this.bingoRematchVotes.get(gameId);
                if (!votes) {
                    votes = new Set();
                    this.bingoRematchVotes.set(gameId, votes);
                }
                votes.add(username);
                const players = room.gameState?.players.map((p) => p.username) ?? [];
                const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);
                for (const u of activePlayers) {
                    this.connectedPlayers.get(u)?.emit('bingo:rematch:progress', {
                        gameId, votes: votes.size, needed: activePlayers.length, voted: [...votes],
                    });
                }
                if (!this.bingoRematchTimers.has(gameId)) {
                    const timer = setTimeout(() => this.startBingoRematch(gameId), 30000);
                    this.bingoRematchTimers.set(gameId, timer);
                }
                if (votes.size >= activePlayers.length) {
                    this.startBingoRematch(gameId);
                }
            });
        });
    }
    /** Called when timer fires OR all active players voted. Starts game with whoever voted. */
    startRematchWithVoters(partyId) {
        const players = this.rematchPlayers.get(partyId);
        const votes = this.rematchVotes.get(partyId);
        if (!players || !votes)
            return; // already cleaned up
        // Participants = voted AND currently connected
        const participants = [...votes].filter((u) => this.connectedPlayers.get(u)?.connected);
        const winStreak = this.rematchWinStreak.get(partyId);
        this.cleanupRematch(partyId);
        if (participants.length < 2) {
            console.log(`⚠️  Rematch for ${partyId} cancelled — not enough voters (${participants.length})`);
            for (const u of participants) {
                this.connectedPlayers.get(u)?.emit('rematch:error', {
                    message: 'Not enough players ready to start the rematch.',
                });
            }
            return;
        }
        try {
            game_manager_service_1.gameManager.createGame(participants.map((u) => ({ username: u, isBot: false })), {
                isInviteGame: true,
                partyId,
                ...(winStreak != null ? { winStreak } : {}),
            });
            console.log(`🔁 Rematch started for party ${partyId}: ${participants.join(', ')} (winStreak: ${winStreak ?? 'default'})`);
        }
        catch (e) {
            console.error('Rematch failed:', e);
            for (const u of participants) {
                this.connectedPlayers.get(u)?.emit('rematch:error', { message: 'Could not start rematch.' });
            }
        }
    }
    cleanupRematch(partyId) {
        const timer = this.rematchTimers.get(partyId);
        if (timer)
            clearTimeout(timer);
        this.rematchTimers.delete(partyId);
        this.rematchVotes.delete(partyId);
        this.rematchPlayers.delete(partyId);
        this.rematchWinStreak.delete(partyId);
    }
    startWPRematchWithVoters(gameId) {
        const players = this.wpRematchPlayers.get(gameId);
        const votes = this.wpRematchVotes.get(gameId);
        if (!players || !votes)
            return;
        const participants = [...votes].filter((u) => this.connectedPlayers.get(u)?.connected);
        const wordCount = this.wpRematchWordCount.get(gameId) ?? 14;
        this.cleanupWPRematch(gameId);
        if (participants.length < 2) {
            console.log(`⚠️  WP rematch for ${gameId} cancelled — not enough voters (${participants.length})`);
            for (const u of participants) {
                this.connectedPlayers.get(u)?.emit('wp:rematch:error', {
                    message: 'Not enough players ready to rematch.',
                });
            }
            return;
        }
        const playerData = participants.map((u) => ({
            username: u,
            socket: this.connectedPlayers.get(u),
        }));
        this.startWPGame(playerData, wordCount);
        console.log(`🔁 WP rematch started: ${participants.join(', ')} (words: ${wordCount})`);
    }
    cleanupWPRematch(gameId) {
        const timer = this.wpRematchTimers.get(gameId);
        if (timer)
            clearTimeout(timer);
        this.wpRematchTimers.delete(gameId);
        this.wpRematchVotes.delete(gameId);
        this.wpRematchPlayers.delete(gameId);
        this.wpRematchWordCount.delete(gameId);
    }
    // ── Word Puzzle helpers ──────────────────────────────────────────────────
    startWPGame(players, wordCount) {
        const game = word_puzzle_service_1.wordPuzzleService.createGame(players.map((p) => ({ username: p.username })), wordCount);
        for (const p of players) {
            p.socket.join(`wp-game-${game.id}`);
            p.socket.data.wpGameId = game.id;
            word_puzzle_service_1.wordPuzzleService.updateSocketId(game.id, p.username, p.socket.id);
        }
        const playerMeta = game.players.map((p) => ({
            username: p.username,
            score: p.score,
            colorIndex: p.colorIndex,
        }));
        // Emit game started to each player with their seat info
        for (const p of players) {
            const seat = game.players.findIndex((gp) => gp.username === p.username);
            p.socket.emit('wp:game:started', {
                gameId: game.id,
                board: game.board,
                gridSize: game.gridSize,
                words: game.words.map((w) => ({
                    id: w.id,
                    word: w.word,
                    cells: w.cells,
                    claimedBy: w.claimedBy,
                    claimedAt: w.claimedAt,
                })),
                players: playerMeta,
                wordCount: game.wordCount,
                yourColorIndex: seat % 8,
                yourUsername: p.username,
            });
        }
        console.log(`🔤 WP game started: ${game.id} (${players.map((p) => p.username).join(', ')})`);
    }
    handleWPRoomLeave(socket) {
        const code = socket.data.wpRoomCode;
        if (!code)
            return;
        const room = this.wpRooms.get(code);
        if (!room)
            return;
        const username = socket.data.username;
        if (room.hostUsername === username) {
            this.wpRooms.delete(code);
            this.io.to(`wp-waiting-${code}`).emit('wp:room:closed', { reason: 'Host left the lobby' });
            for (const s of room.members.values()) {
                s.data.wpRoomCode = null;
                s.leave(`wp-waiting-${code}`);
            }
            room.members.clear();
            console.log(`🚪 WP room ${code} closed by host`);
        }
        else {
            room.members.delete(username);
            socket.data.wpRoomCode = null;
            socket.leave(`wp-waiting-${code}`);
            this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
                players: [...room.members.keys()],
                hostUsername: room.hostUsername,
                wordCount: room.wordCount,
                maxPlayers: game_1.MAX_PLAYERS_PER_GAME,
            });
            console.log(`🚪 ${username} left WP room ${code}`);
        }
        socket.data.wpRoomCode = null;
    }
    /** Notifies each human participant and joins them to the Socket.IO game room */
    emitGameStart(game, colorChoices) {
        const gameId = game.id;
        const players = game.players;
        const usernames = players.map((p) => p.username);
        const isBotGame = players.some((p) => p.isBot);
        console.log(`🎮 Emitting game start to ${usernames.join(', ')} (${game.rows}×${game.cols})`);
        players.forEach((p, index) => {
            if (p.isBot)
                return;
            const sock = this.connectedPlayers.get(p.username);
            if (!sock) {
                console.warn(`⚠️  Player ${p.username} socket not found`);
                return;
            }
            sock.join(gameId);
            const others = usernames.filter((u) => u !== p.username);
            sock.emit('game:started', {
                gameId,
                board: game.board,
                rows: game.rows,
                cols: game.cols,
                players: usernames,
                playerUsernames: usernames,
                yourPlayerNumber: index + 1,
                playerCount: players.length,
                isBot: isBotGame,
                yourTurn: index === 0,
                opponent: others.length === 1 ? others[0] : undefined,
                isInviteGame: Boolean(game.isInviteGame),
                partyId: game.partyId,
                winStreak: game.winStreak,
                rankings: game.rankedOut ?? [],
                colorChoices: colorChoices ?? {},
            });
            console.log(`✅ Sent game:started to ${p.username} (seat ${index + 1}/${players.length})`);
        });
        kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.GAME_STARTED, {
            gameId,
            player1: usernames[0],
            player2: usernames[1],
            players: usernames,
            isBot: isBotGame,
            rows: game.rows,
            cols: game.cols,
        });
        console.log(`🎮 Game started: ${gameId} - ${usernames.join(', ')}${isBotGame ? ' (BOT)' : ''}`);
    }
    // Emit game update to all players in the game
    emitGameUpdate(gameId, data) {
        // console.log(`📤 Broadcasting game update to room ${gameId}:`, data);
        this.io.to(gameId).emit('game:update', data);
    }
    registerInviteRematch(partyId, orderedHumanUsernames, winStreak) {
        if (!partyId || orderedHumanUsernames.length < 2)
            return;
        // Clear any leftover timer from a previous rematch cycle
        this.cleanupRematch(partyId);
        this.rematchPlayers.set(partyId, [...orderedHumanUsernames]);
        this.rematchVotes.set(partyId, new Set());
        if (winStreak != null) {
            this.rematchWinStreak.set(partyId, Math.max(4, Math.min(8, winStreak)));
        }
        console.log(`🔁 Rematch ready for party ${partyId}: ${orderedHumanUsernames.join(', ')} (winStreak: ${winStreak ?? 'default'})`);
    }
    // Emit game end event
    emitGameEnd(gameId, winner, reason, winningCells, rematch) {
        this.io.to(gameId).emit('game:ended', {
            gameId,
            winner,
            reason,
            winningCells,
            timestamp: new Date().toISOString(),
            partyId: rematch?.partyId,
            canRematch: rematch?.canRematch,
            rematchPlayers: rematch?.rematchPlayers,
        });
        kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.GAME_ENDED, {
            gameId,
            winner,
            reason,
        });
        console.log(`🏁 Game ended: ${gameId} - Winner: ${winner || 'DRAW'}`);
    }
    // Get number of players in matchmaking queue
    getQueueSize() {
        const room = this.io.sockets.adapter.rooms.get('matchmaking-queue');
        return room ? room.size : 0;
    }
    // Get WebSocket server instance
    getIO() {
        return this.io;
    }
    // ── Dots & Boxes helpers ─────────────────────────────────────────────────
    startDABGame(room, playerList) {
        const code = room.code;
        const { gameId, hLines, vLines, boxes, scores, currentTurn } = (0, dots_and_boxes_1.initDABGame)(room.gridRows, room.gridCols, playerList.length);
        room.status = 'playing';
        room.gameId = gameId;
        room.players = playerList;
        room.hLines = hLines;
        room.vLines = vLines;
        room.boxes = boxes;
        room.scores = scores;
        room.currentTurn = currentTurn;
        room.partyId = gameId; // use gameId as party for rematch
        for (const username of playerList) {
            const s = room.members.get(username);
            if (!s)
                continue;
            s.data.dabRoomCode = code;
            s.data.dabGameId = gameId;
            s.join(`dab-game-${gameId}`);
            s.leave(`dab-lobby-${code}`);
        }
        const startPayload = {
            gameId,
            players: playerList,
            gridRows: room.gridRows,
            gridCols: room.gridCols,
            hLines,
            vLines,
            boxes,
            scores,
            currentTurn,
            currentPlayer: playerList[currentTurn],
        };
        for (let i = 0; i < playerList.length; i++) {
            const s = room.members.get(playerList[i]);
            if (!s)
                continue;
            s.emit('dab:game:started', {
                ...startPayload,
                yourIndex: i,
                yourUsername: playerList[i],
            });
        }
        console.log(`🟣 DAB game started: ${gameId} — ${playerList.join(', ')} (${room.gridRows}×${room.gridCols})`);
    }
    startDABRematch(gameId) {
        const room = [...this.dabRooms.values()].find((r) => r.gameId === gameId);
        if (!room)
            return;
        const votes = this.dabRematchVotes.get(gameId);
        const timer = this.dabRematchTimers.get(gameId);
        if (timer)
            clearTimeout(timer);
        this.dabRematchTimers.delete(gameId);
        this.dabRematchVotes.delete(gameId);
        const participants = (votes ? [...votes] : []).filter((u) => this.connectedPlayers.get(u)?.connected);
        if (participants.length < 2) {
            for (const u of participants) {
                this.connectedPlayers.get(u)?.emit('dab:rematch:error', { message: 'Not enough players for rematch.' });
            }
            return;
        }
        // Re-seat participants and restart
        room.members = new Map(participants.map((u) => [u, this.connectedPlayers.get(u)]));
        room.hostUsername = participants[0];
        this.startDABGame(room, participants);
        console.log(`🔁 DAB rematch started: ${participants.join(', ')}`);
    }
    handleDABRoomLeave(socket) {
        const code = socket.data.dabRoomCode;
        if (!code)
            return;
        const room = this.dabRooms.get(code);
        if (!room)
            return;
        const username = socket.data.username;
        room.members.delete(username);
        socket.leave(`dab-lobby-${code}`);
        socket.data.dabRoomCode = null;
        if (room.members.size === 0) {
            this.dabRooms.delete(code);
            return;
        }
        // Transfer host if host left
        if (room.hostUsername === username) {
            room.hostUsername = [...room.members.keys()][0];
        }
        this.io.to(`dab-lobby-${code}`).emit('dab:room:lobbyUpdate', {
            players: [...room.members.keys()],
            hostUsername: room.hostUsername,
            gridRows: room.gridRows,
            gridCols: room.gridCols,
            maxPlayers: room.maxPlayers,
        });
    }
    // ── Bingo helpers ────────────────────────────────────────────────────────
    startBingoGame(room, playerList, withBot, botUsername) {
        const code = room.code;
        const playerData = playerList.map((u) => ({ username: u, isBot: u === botUsername }));
        const game = bingo_service_1.bingoService.createGame(playerData, { isInviteGame: !withBot && playerList.length > 1 });
        room.status = 'playing';
        room.gameId = game.id;
        room.partyId = game.id;
        room.gameState = game;
        const humanPlayers = playerList.filter((u) => u !== botUsername);
        for (const username of humanPlayers) {
            const s = room.members.get(username);
            if (!s)
                continue;
            s.data.bingoRoomCode = code;
            s.data.bingoGameId = game.id;
            s.join(`bingo-game-${game.id}`);
            s.leave(`bingo-lobby-${code}`);
        }
        for (let i = 0; i < playerList.length; i++) {
            const username = playerList[i];
            if (username === botUsername)
                continue;
            const s = room.members.get(username);
            if (!s)
                continue;
            const myPlayer = game.players.find((p) => p.username === username);
            s.emit('bingo:game:started', {
                gameId: game.id,
                players: game.players.map((p) => ({
                    username: p.username,
                    colorIndex: p.colorIndex,
                    card: p.username === username ? p.card : null, // Only send own card
                })),
                yourUsername: username,
                yourCard: myPlayer.card,
                yourColorIndex: myPlayer.colorIndex,
                calledNumbers: [],
                currentCall: null,
                isBot: withBot,
                botUsername: botUsername ?? null,
            });
        }
        // Auto-call numbers every 3 seconds for all bingo games
        const callInterval = setInterval(() => {
            const gameState = bingo_service_1.bingoService.getGame(game.id);
            if (!gameState || gameState.status !== 'playing') {
                clearInterval(callInterval);
                this.bingoCallTimers.delete(game.id);
                return;
            }
            const result = bingo_service_1.bingoService.callNextNumber(game.id);
            if (!result.success) {
                clearInterval(callInterval);
                this.bingoCallTimers.delete(game.id);
                return;
            }
            const callPayload = {
                gameId: game.id,
                calledNumber: result.calledNumber,
                calledNumbers: gameState.calledNumbers,
                players: result.updatedPlayers?.map((p) => ({
                    username: p.username,
                    markedCells: p.markedCells,
                    hasBingo: p.hasBingo,
                    bingoLines: p.bingoLines,
                    rank: p.rank,
                })),
                newBingoPlayers: result.newBingoPlayers,
                remaining: bingo_service_1.bingoService.getRemainingCount(game.id),
            };
            this.io.to(`bingo-game-${game.id}`).emit('bingo:number:called', callPayload);
            if (result.newBingoPlayers && result.newBingoPlayers.length > 0) {
                this.io.to(`bingo-game-${game.id}`).emit('bingo:player:bingo', {
                    gameId: game.id,
                    players: result.newBingoPlayers,
                    rankings: result.rankings,
                });
            }
            if (result.gameOver) {
                clearInterval(callInterval);
                this.bingoCallTimers.delete(game.id);
                room.status = 'ended';
                this.io.to(`bingo-game-${game.id}`).emit('bingo:game:ended', {
                    gameId: game.id,
                    winner: result.winner,
                    rankings: result.rankings,
                    players: result.updatedPlayers?.map((p) => ({
                        username: p.username,
                        markedCells: p.markedCells,
                        hasBingo: p.hasBingo,
                        bingoLines: p.bingoLines,
                        rank: p.rank,
                    })),
                    partyId: room.partyId,
                });
                // Setup rematch
                this.bingoRematchVotes.set(game.id, new Set());
                console.log(`🎱 Bingo game ${game.id} ended. Winner: ${result.winner}`);
                setTimeout(() => bingo_service_1.bingoService.deleteGame(game.id), 120000);
            }
        }, 3000);
        this.bingoCallTimers.set(game.id, callInterval);
        console.log(`🎱 Bingo game started: ${game.id} — ${playerList.join(', ')}`);
    }
    startBingoRematch(gameId) {
        const room = [...this.bingoRooms.values()].find((r) => r.gameId === gameId);
        if (!room)
            return;
        const votes = this.bingoRematchVotes.get(gameId);
        const timer = this.bingoRematchTimers.get(gameId);
        if (timer)
            clearTimeout(timer);
        this.bingoRematchTimers.delete(gameId);
        this.bingoRematchVotes.delete(gameId);
        const participants = (votes ? [...votes] : []).filter((u) => this.connectedPlayers.get(u)?.connected);
        if (participants.length < 2) {
            for (const u of participants) {
                this.connectedPlayers.get(u)?.emit('bingo:rematch:error', { message: 'Not enough players for rematch.' });
            }
            return;
        }
        room.members = new Map(participants.map((u) => [u, this.connectedPlayers.get(u)]));
        room.hostUsername = participants[0];
        this.startBingoGame(room, participants, false);
        console.log(`🔁 Bingo rematch started: ${participants.join(', ')}`);
    }
    handleBingoRoomLeave(socket) {
        const code = socket.data.bingoRoomCode;
        if (!code)
            return;
        const room = this.bingoRooms.get(code);
        if (!room)
            return;
        const username = socket.data.username;
        room.members.delete(username);
        socket.leave(`bingo-lobby-${code}`);
        socket.data.bingoRoomCode = null;
        if (room.members.size === 0) {
            this.bingoRooms.delete(code);
            return;
        }
        if (room.hostUsername === username) {
            room.hostUsername = [...room.members.keys()][0];
        }
        this.io.to(`bingo-lobby-${code}`).emit('bingo:room:lobbyUpdate', {
            players: [...room.members.keys()],
            hostUsername: room.hostUsername,
            maxPlayers: room.maxPlayers,
        });
    }
}
exports.WebSocketService = WebSocketService;
function initializeWebSocket(httpServer) {
    exports.wsService = new WebSocketService(httpServer);
    return exports.wsService;
}
