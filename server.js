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

// Auto-migrate timestamps for KPI metrics without breaking schema
pool.query('ALTER TABLE incidents ADD COLUMN accepted_at TIMESTAMP NULL').catch(()=>{});
pool.query('ALTER TABLE incidents ADD COLUMN resolved_at TIMESTAMP NULL').catch(()=>{});

// Auto-migrate Phone numbers for Rescue teams
pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL').catch(()=>{});
pool.query('UPDATE users SET phone = "081-669-1234" WHERE role = "Rescue"').catch(()=>{});

const redisClient = redis.createClient({ url: 'redis://127.0.0.1:6379' });
redisClient.on('error', (err) => console.log('Redis error:', err));
redisClient.connect().then(() => console.log('Connected to Redis'));

// Global Memory for Dispatch Queues (Handling Timeouts)
const dispatchState = {};

function broadcastOffer(incident_id, drivers, payload) {
    if (drivers.length === 0) return;
    
    // Set a 30s lifespan for this blasted offer
    dispatchState[incident_id] = {
        timer: setTimeout(() => {
            // If nobody accepts in 30s, clear state to allow the 5s loop to blast everyone again!
            io.emit('cancel_offer', { incident_id }); 
            delete dispatchState[incident_id];
        }, 30000)
    };

    // Blast to ALL eligible drivers SIMULTANEOUSLY!
    console.log(`[SYS] Broadcasting Incident ${incident_id} to ${drivers.length} online drivers!`);
    drivers.forEach(targetDriverId => {
        io.to(`driver_${targetDriverId}`).emit('offer_mission', { incident_id, ...payload });
    });
}


// Global Polling Loop: Find Pending Cases and retry matching every 5 seconds
setInterval(async () => {
    try {
        const [rows] = await pool.query('SELECT * FROM incidents WHERE status = "Pending"');
        for (const inc of rows) {
            if (!dispatchState[inc.id]) { 
                const nearbyDriverIds = await redisClient.sendCommand(['GEORADIUS', 'online_rescuers', inc.longitude.toString(), inc.latitude.toString(), '50', 'km', 'ASC']);
                if (nearbyDriverIds.length > 0) {
                     broadcastOffer(inc.id, nearbyDriverIds, { details: inc.details, latitude: inc.latitude, longitude: inc.longitude, citizen_phone: inc.citizen_phone });
                }
            }
        }
    } catch(e) {}
}, 5000);

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

        // Phase 1: Retrieve all online/available drivers within 50km using Redis GEOSPATIAL
        const nearbyDriverIds = await redisClient.sendCommand([
            'GEORADIUS', 
            'online_rescuers', 
            longitude.toString(), 
            latitude.toString(), 
            '50', 
            'km', 
            'ASC'
        ]);

        let closestDriverId = null;
        let closestFoundationId = null;
        let rescuerPhone = null;

        // AUTO-ASSIGN: Create Pending Case ALWAYS (Even if no one is nearby right now)
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone) VALUES (?, ?, ?, ?, ?)',
            [details || 'SOS via App', latitude, longitude, 'Pending', citizen_phone]
        );
        const incident_id = result.insertId;

        // If drivers are nearby, kick off blast immediately.
        if (nearbyDriverIds.length > 0) {
            broadcastOffer(incident_id, nearbyDriverIds, { details, latitude, longitude, citizen_phone });
        }

        res.status(201).json({ message: 'Searching for rescuer', incident_id });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Driver accept case (Atomic Lock)
app.post('/api/incidents/:id/accept', verifyToken, async (req, res) => {
    const incident_id = req.params.id;
    const driver_id = req.user.id;

    try {
        // Atomic Lock: ONLY update if it is still 'Pending' (hasn't been stolen by someone else yet)
        const [result] = await pool.query('UPDATE incidents SET assigned_user_id = ?, status = "Accepted", accepted_at = CURRENT_TIMESTAMP WHERE id = ? AND status = "Pending"', [driver_id, incident_id]);

        if (result.affectedRows === 0) {
            // Someone else beat them to it! (Or it was cancelled)
            return res.status(400).json({ error: 'มีกู้ภัยทีมอื่นรับเคสนี้ตัดหน้าไปเหตุก่อนแล้ว (Mission already taken)' });
        }

        // --- WINNER LOGIC ---

        // Clear global blast state
        if (dispatchState[incident_id]) {
            clearTimeout(dispatchState[incident_id].timer);
            delete dispatchState[incident_id];
        }

        // Instantly kill the ringing screen on ALL OTHER online drivers' phones for this incident
        io.emit('cancel_offer', { incident_id });

        const statStr = await redisClient.get(`rescuer_status:${driver_id}`);
        if(statStr) {
            let stat = JSON.parse(statStr);
            stat.status = 'busy';
            await redisClient.set(`rescuer_status:${driver_id}`, JSON.stringify(stat));
            await redisClient.sendCommand(['ZREM', 'online_rescuers', driver_id.toString()]);
        }

        const [driverRows] = await pool.query('SELECT username, phone FROM users WHERE id = ?', [driver_id]);
        const rescuerInfo = driverRows[0] || {};

        // Notify Citizen
        io.to(`incident_room_${incident_id}`).emit('driver_assigned', { incident_id, driver_id, driver_name: rescuerInfo.username, driver_phone: rescuerInfo.phone });
        res.json({ message: 'Mission Accepted Successfully' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Driver manually reject case
app.post('/api/incidents/:id/reject', verifyToken, async (req, res) => {
    const incident_id = req.params.id;
    // Just tell their personal device to drop the modal. The system waits for someone else, or re-blasts in 30s.
    io.to(`driver_${req.user.id}`).emit('cancel_offer', { incident_id }); 
    res.json({ message: 'Mission Rejected' });
});

// Admin System Status & Analytics
app.get('/api/admin/system-status', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [incidents] = await pool.query('SELECT * FROM incidents WHERE status IN ("Pending", "Accepted")');
        const [history] = await pool.query('SELECT * FROM incidents WHERE status IN ("Resolved", "Failed") ORDER BY id DESC LIMIT 500');
        
        let totalResponseTimeMs = 0;
        let respondedCount = 0;
        history.forEach(h => {
             if (h.accepted_at && h.created_at) {
                 const diff = new Date(h.accepted_at) - new Date(h.created_at);
                 if (diff > 0) { totalResponseTimeMs += diff; respondedCount++; }
             }
        });
        const avgResponseTimeSec = respondedCount > 0 ? (totalResponseTimeMs / respondedCount / 1000).toFixed(1) : 0;

        const keys = await redisClient.keys('rescuer_status:*');
        const rescuers = [];
        for (const k of keys) {
            const statStr = await redisClient.get(k);
            if (statStr) rescuers.push({ id: k.split(':')[1], ...JSON.parse(statStr) });
        }
        res.json({ incidents, rescuers, history, avgResponseTimeSec });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Broadcast Message
app.post('/api/admin/broadcast', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    io.emit('admin_broadcast', { message: req.body.message, timestamp: new Date() });
    res.json({ message: 'Broadcast Sent' });
});

// Admin Manual Force Cancel
app.post('/api/admin/incidents/:id/cancel', verifyToken, async (req, res) => {
    try {
        console.log("CANCEL ROUTE HIT FOR:", req.params.id);
        if (!req.user || !req.user.role || req.user.role.toLowerCase() !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const incident_id = req.params.id;
        console.log("[DEBUG] Clearing dispatchState...");
        if (dispatchState[incident_id]) {
            clearTimeout(dispatchState[incident_id].timer);
            delete dispatchState[incident_id];
        }
        
        console.log("[DEBUG] Fetching assigned_user_id...");
        const [rows] = await pool.query('SELECT assigned_user_id FROM incidents WHERE id = ?', [incident_id]);
        
        if (rows.length > 0 && rows[0].assigned_user_id) {
            console.log("[DEBUG] Rescuer found, updating redis...");
            const did = rows[0].assigned_user_id;
            const statStr = await redisClient.get(`rescuer_status:${did}`);
            if(statStr) {
               let stat = JSON.parse(statStr);
               stat.status = 'available';
               await redisClient.set(`rescuer_status:${did}`, JSON.stringify(stat));
               await redisClient.sendCommand(['GEOADD', 'online_rescuers', stat.longitude.toString(), stat.latitude.toString(), did.toString()]);
            }
        }
        
        console.log("[DEBUG] Updating DB status to Resolved...");
        await pool.query('UPDATE incidents SET status = "Resolved" WHERE id = ?', [incident_id]);
        
        console.log("[DEBUG] Emitting sockets...");
        io.to(`incident_room_${incident_id}`).emit('no_drivers'); // Signal Citizen to stop waiting
        
        console.log("[DEBUG] Done. Sending success.");
        res.json({ message: 'Cancelled manually' });
    } catch(e) { 
        console.log("[FATAL CANCEL ERROR]", e);
        res.status(500).json({ error: e.stack ? e.stack.toString() : String(e) }); 
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
        await pool.query('UPDATE incidents SET status = "Resolved", resolved_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);

        const statStr = await redisClient.get(`rescuer_status:${req.user.id}`);
        if(statStr) {
            let stat = JSON.parse(statStr);
            stat.status = 'available';
            await redisClient.set(`rescuer_status:${req.user.id}`, JSON.stringify(stat));
            // Add back to GeoRadius map immediately so they can receive the next job
            await redisClient.sendCommand(['GEOADD', 'online_rescuers', stat.longitude.toString(), stat.latitude.toString(), req.user.id.toString()]);
        }

        // Emit to citizen room so they know it is over
        io.to(`incident_room_${req.params.id}`).emit('mission_completed', { message: 'Mission Complete' });

        res.json({ message: 'Mission Completed' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Citizen fetch status API
app.get('/api/incidents/status/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT i.status, u.username as driver_name, u.phone as driver_phone FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.id = ?', [req.params.id]);
        if (rows.length > 0) res.json({ status: rows[0].status, driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
        else res.status(404).json({ error: 'Not found' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Real-time Socket.io (Driver tracking & Chat)
io.on('connection', (socket) => {
    console.log('⚡ Connected:', socket.id);

    // 1. Driver goes online (Available for Auto-Dispatch)
    socket.on('go_online', async ({ user_id, foundation_id, latitude, longitude, phone }) => {
        await redisClient.sendCommand(['GEOADD', 'online_rescuers', longitude.toString(), latitude.toString(), user_id.toString()]);
        await redisClient.set(`rescuer_status:${user_id}`, JSON.stringify({
            status: 'available', foundation_id, phone, latitude, longitude
        }));
        socket.join(`driver_${user_id}`);
        console.log(`Driver ${user_id} is ONLINE via Mobile.`);
    });

    socket.on('go_offline', async ({ user_id }) => {
        await redisClient.sendCommand(['ZREM', 'online_rescuers', user_id.toString()]);
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
            
            // Only update GEO map if they are still officially available
            if (stat.status === 'available') {
                await redisClient.sendCommand(['GEOADD', 'online_rescuers', longitude.toString(), latitude.toString(), vehicle_id.toString()]);
            }
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
    socket.on('send_chat_message', ({ incident_id, sender, message, image }) => {
        io.to(`incident_room_${incident_id}`).emit('new_chat_message', { sender, message, image, timestamp: new Date() });
    });
});

server.listen(3000, () => {
    console.log(`🚀 Automated Grab-style Dispatch Server on port 3000`);
});