require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Database
initDb();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (like the frontend HTML)
app.use(express.static(path.join(__dirname)));

// Route Routers
const authRoutes = require('./routes/auth');
const calendarRoutes = require('./routes/calendars');
const eventRoutes = require('./routes/events');
const aiRoutes = require('./routes/ai');

app.use('/api/auth', authRoutes);
app.use('/api/calendars', calendarRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/ai', aiRoutes);

// Fallback to serve the main frontend file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'ios_style_calendar_app.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'サーバー内で予期せぬエラーが発生しました' });
});

// Start server
app.listen(PORT, () => {
    console.log(`==================================================`);
    console.log(`  iOS Calendar Backend is running on port ${PORT}`);
    console.log(`  Access the app at: http://localhost:${PORT}`);
    console.log(`==================================================`);
});
