"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchmakingService = exports.MatchmakingService = void 0;
const game_manager_service_1 = require("./game-manager.service");
class MatchmakingService {
    queue = [];
    MATCHMAKING_TIMEOUT = parseInt(process.env.MATCHMAKING_TIMEOUT_MS || '10000');
    joinQueue(username) {
        if (this.queue.find(p => p.username === username)) {
            console.log(`⚠️  Player ${username} already in queue`);
            return;
        }
        if (game_manager_service_1.gameManager.getGameByPlayer(username)) {
            console.log(`⚠️  Player ${username} already in a game`);
            return;
        }
        const player = {
            username,
            joinedAt: new Date(),
        };
        this.queue.push(player);
        console.log(`📥 Player ${username} joined matchmaking queue (${this.queue.length} in queue)`);
        this.tryMatch();
        player.timeoutId = setTimeout(() => {
            this.startBotGame(username);
        }, this.MATCHMAKING_TIMEOUT);
    }
    leaveQueue(username) {
        const index = this.queue.findIndex(p => p.username === username);
        if (index !== -1) {
            const player = this.queue[index];
            if (player.timeoutId) {
                clearTimeout(player.timeoutId);
            }
            this.queue.splice(index, 1);
            console.log(`📤 Player ${username} left matchmaking queue`);
        }
    }
    tryMatch() {
        if (this.queue.length < 2)
            return;
        const player1 = this.queue.shift();
        const player2 = this.queue.shift();
        if (player1.timeoutId)
            clearTimeout(player1.timeoutId);
        if (player2.timeoutId)
            clearTimeout(player2.timeoutId);
        game_manager_service_1.gameManager.createTwoPlayerGame(player1.username, player2.username, false);
        console.log(`🎮 Matched ${player1.username} with ${player2.username}`);
    }
    startBotGame(username) {
        const index = this.queue.findIndex(p => p.username === username);
        if (index === -1) {
            console.log(`⚠️  Player ${username} not in queue for bot game`);
            return;
        }
        this.queue.splice(index, 1);
        const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
        const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
        const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
        game_manager_service_1.gameManager.createTwoPlayerGame(username, botName, true);
        console.log(`🤖 Started bot game for ${username} vs ${botName}`);
    }
    getQueueSize() {
        return this.queue.length;
    }
    getQueue() {
        return [...this.queue];
    }
}
exports.MatchmakingService = MatchmakingService;
exports.matchmakingService = new MatchmakingService();
