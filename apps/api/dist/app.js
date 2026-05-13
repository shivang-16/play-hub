"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
// Middleware
app.use((0, cors_1.default)({
    origin: ['https://4-in-a-row-web-kappa.vercel.app', 'https://play.shivangyadav.com', 'http://localhost:3000'],
    credentials: true,
}));
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
// Health check endpoint
app.get('/health', (_req, res) => {
    console.log('Health check ping received');
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: '4-in-a-row-api'
    });
});
// API routes will be added here
app.get('/', (_req, res) => {
    res.json({
        message: 'Welcome to 4 in a Row API',
        version: '1.0.0',
        endpoints: {
            health: '/health',
            // More endpoints will be added as we build
        }
    });
});
exports.default = app;
