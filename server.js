const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'rescue_super_secret_key';

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

const redisClient = redis.createClient({ url: 'redis://127.0.0.1:6379' });
redisClient.on('error', (err) => console.log('Redis error:', err));
redisClient.connect().then(() => console.log('Connected to Redis'));

// Haversine distance
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
    return R * c;
}

// 1. Auth API
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length > 0) {
            const user = users[0];
            const isMatch = user.password.startsWith('$2b$') ? await bcrypt.compare(password, user.password) : password === user.password;
            
            if (isMatch) {
                const token = jwt.sign({ id: user.id, role: user.role, foundation_id: user.foundation_id }, JWT_SECRET, { expiresIn: '12h' });
                res.json({ message: 'Login successful', token, user: { id: user.id, username: user.username, role: user.role, foundation_id: user.foundation_id, phone: user.phone } });
            } else {
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } else {
            res.status(401).json({ error: 'User not found' });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

const verifyToken = (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'A token is required' });
    try {
        req.user = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid Token' }); }
};

// 2. Incident API (Auto-Dispatch GRAB-Style)
app.post('/api/incidents', async (req, res) => {
    try {
        let { details, latitude, longitude, citizen_phone } = req.body;
        latitude = parseFloat(latitude); longitude = parseFloat(longitude);

        if (isNaN(latitude) || isNaN(longitude)) return res.status(400).json({ error: 'Invalid GPS' });

        // Phase 1: Retrieve all online/available drivers from Redis
        const keys = await redisClient.keys('rescuer_status:*');
        let closestDriverId = null;
        let closestFoundationId = null;
        let minDistance = 50; // max 50km
        let rescuerPhone = null;

        for (const key of keys) {
            const dataStr = await redisClient.get(key);
            if (dataStr) {
                const data = JSON.parse(dataStr);
                if (data.status === 'available') {
                    const dist = getDistanceFromLatLonInKm(latitude, longitude, data.latitude, data.longitude);
                    if (dist < minDistance) {
                        minDistance = dist;
                        closestDriverId = key.split(':')[1];
                        closestFoundationId = data.foundation_id;
                        rescuerPhone = data.phone;
                    }
                }
            }
        }

        if (!closestDriverId) {
            return res.status(404).json({ error: 'No rescue units available nearby. Please call 1669 directly.' });
        }

        // AUTO-ASSIGN to the Closest Driver!
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, foundation_id, assigned_user_id, citizen_phone) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [details || 'SOS via App', latitude, longitude, 'Accepted', closestFoundationId, closestDriverId, citizen_phone]
        );
        const incident_id = result.insertId;

        // Mark driver as BUSY in Redis
        const statStr = await redisClient.get(`rescuer_status:${closestDriverId}`);
        if (statStr) {
            let stat = JSON.parse(statStr);
            stat.status = 'busy';
            await redisClient.set(`rescuer_status:${closestDriverId}`, JSON.stringify(stat));
        }

        const newIncident = { id: incident_id, details, latitude, longitude, status: 'Accepted', citizen_phone, worker_phone: rescuerPhone };
        
        // Immediately notify driver via their private socket!
        io.to(`driver_${closestDriverId}`).emit('auto_dispatched_case', newIncident);

        res.status(201).json({ message: 'Rescue Dispatched!', incident_id, assigned_user_id: closestDriverId });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Fetch active case for Driver
app.get('/api/incidents/active', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM incidents WHERE assigned_user_id = ? AND status = "Accepted" LIMIT 1', [req.user.id]);
        res.json(rows[0] || null);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Driver complete case
app.post('/api/incidents/:id/complete', verifyToken, async (req, res) => {
    try {
        await pool.query('UPDATE incidents SET status = "Resolved" WHERE id = ?', [req.params.id]);
        // Free up Driver in Redis!
        const statStr = await redisClient.get(`rescuer_status:${req.user.id}`);
        if(statStr) {
            let stat = JSON.parse(statStr);
            stat.status = 'available';
            await redisClient.set(`rescuer_status:${req.user.id}`, JSON.stringify(stat));
        }
        res.json({ message: 'Mission Completed' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Real-time Socket.io (Driver tracking & Chat)
io.on('connection', (socket) => {
    console.log('⚡ Connected:', socket.id);

    // 1. Driver goes online (Available for Auto-Dispatch)
    socket.on('go_online', async ({ user_id, foundation_id, latitude, longitude, phone }) => {
        await redisClient.set(`rescuer_status:${user_id}`, JSON.stringify({
            status: 'available', foundation_id, phone, latitude, longitude
        }));
        socket.join(`driver_${user_id}`);
        console.log(`Driver ${user_id} is ONLINE via Mobile.`);
    });

    socket.on('go_offline', async ({ user_id }) => {
        await redisClient.del(`rescuer_status:${user_id}`);
    });

    // 2. Driver sends live GPS (For Tracking)
    socket.on('update_vehicle_location', async (data) => {
        const { vehicle_id, latitude, longitude, active_incident_id } = data;
        
        const statStr = await redisClient.get(`rescuer_status:${vehicle_id}`);
        if (statStr) {
            let stat = JSON.parse(statStr);
            stat.latitude = latitude; stat.longitude = longitude;
            await redisClient.set(`rescuer_status:${vehicle_id}`, JSON.stringify(stat));
        }

        // Broadcast directly to Citizen who is waiting in `incident_room_123`
        if (active_incident_id) {
            io.to(`incident_room_${active_incident_id}`).emit('vehicle_location_updated', { latitude, longitude });
        }
    });

    // 3. Citizen / Worker joins private Chat & GPS Tracker Room
    socket.on('join_incident_room', (incident_id) => {
        socket.join(`incident_room_${incident_id}`);
        console.log(`User joined incident tracking room ${incident_id}`);
    });

    // 4. Real-time Chat Messaging
    socket.on('send_chat_message', ({ incident_id, sender, message }) => {
        io.to(`incident_room_${incident_id}`).emit('new_chat_message', { sender, message, timestamp: new Date() });
    });
});

server.listen(3000, () => {
    console.log(`🚀 Automated Grab-style Dispatch Server on port 3000`);
});