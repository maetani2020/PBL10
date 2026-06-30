require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const os = require('os');
const { initDb } = require('./db');
const { initWebSocket } = require('./utils/websocket');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Initialize Database
const dbReady = initDb();

// Middleware
app.use(cors({
    origin: '*', // Allows access from any Android client / PWA / localhost
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Serve static files from the project root (one level up)
const projectRoot = path.join(__dirname, '..');
app.use(express.static(projectRoot));

// Route Routers
const authRoutes = require('./routes/auth');
const calendarRoutes = require('./routes/calendars');
const eventRoutes = require('./routes/events');
const aiRoutes = require('./routes/ai');
const groupRoutes = require('./routes/groups');
const taskRoutes = require('./routes/tasks');
const hpMotivationRoutes = require('./routes/hp_motivation');
const householdRoutes = require('./routes/household');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/calendars', calendarRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/hp-motivation', hpMotivationRoutes);
app.use('/api/household', householdRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);

// Config endpoint to provide credentials to client
app.get('/api/config', (req, res) => {
    res.json({
        googleClientId: process.env.GOOGLE_CLIENT_ID || ''
    });
});

// Admin portal
app.get('/admin', (req, res) => {
    res.sendFile(path.join(projectRoot, 'admin.html'));
});

app.get('/admin/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'admin.html'));
});

// Fallback: serve the main calendar frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(projectRoot, 'calendar.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error stack:', err.stack);
    res.status(500).json({ error: 'サーバー内で予期せぬエラーが発生しました' });
});

// Wrap express app in http server for WebSocket integration
const server = http.createServer(app);

// Initialize WebSocket server
initWebSocket(server);

// Helper to get local IP addresses for Android testing
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }
    return ips;
}

// Start server after database migrations are ready
dbReady.then(() => server.listen(PORT, HOST, () => {
    const localIPs = getLocalIPs();
    console.log(`==================================================`);
    console.log(`  統合型ライフマネジメントアプリ バックエンドサーバー`);
    console.log(`  起動完了: http://localhost:${PORT}`);
    console.log(`--------------------------------------------------`);
    console.log(`  [Android実機・エミュレータからのアクセス用URL]`);
    console.log(`  ・エミュレータから: http://10.0.2.2:${PORT}`);
    if (localIPs.length > 0) {
        localIPs.forEach(ip => {
            console.log(`  ・ローカルネットワークから: http://${ip}:${PORT}`);
        });
    }
    console.log(`==================================================`);
})).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
