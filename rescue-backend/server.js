const express = require('express');
const axios = require('axios');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const redis = require('redis');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { sosLimiter, loginLimiter, publicWriteLimiter } = require('./rateLimiters');
const { getJwtSecret } = require('./jwtSecret');
const { isAllowedOrigin } = require('./corsConfig');
const { verifyPassword } = require('./auth');
require('dotenv').config();


const corsOriginHandler = (origin, callback) => {
  if (isAllowedOrigin(origin)) return callback(null, true);
  callback(new Error('Not allowed by CORS'));
};

const app = express();
app.set('trust proxy', 1); // Railway sits in front of this server; without this, rate limiting keys off the proxy's IP for every request
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOriginHandler, methods: ['GET', 'POST'] } });

app.use(cors({
  origin: corsOriginHandler
}));
app.use(express.json());

const JWT_SECRET = getJwtSecret();

// Helper: Send LINE Push Message to a specific user
async function sendLinePush(lineUid, message) {
    if (!lineUid) return;
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (!token || token === 'YOUR_CHANNEL_ACCESS_TOKEN') return;
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: lineUid,
            messages: [{ type: 'text', text: message }]
        }, {
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        });
        console.log(`[LINE] Push sent to ${lineUid}`);
    } catch(e) {
        console.error('[LINE] Push failed:', e.response?.data || e.message);
    }
}


const { databaseConfig } = require('./databaseConfig');
const pool = mysql.createPool(databaseConfig(process.env));

// Auto-migrate timestamps for KPI metrics without breaking schema
pool.query('ALTER TABLE incidents ADD COLUMN accepted_at TIMESTAMP NULL').catch(()=>{});
pool.query('ALTER TABLE incidents ADD COLUMN resolved_at TIMESTAMP NULL').catch(()=>{});

// Auto-migrate Phone numbers for Rescue teams
pool.query('ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL').catch(()=>{});

// Auto-migrate parent incident link for Backup feature
pool.query('ALTER TABLE incidents ADD COLUMN parent_incident_id INT NULL').catch(()=>{});

// Auto-migrate citizen phone for SOS requests
pool.query('ALTER TABLE incidents ADD COLUMN citizen_phone VARCHAR(20) NULL').catch(()=>{});

// Auto-migrate cancel reason
pool.query('ALTER TABLE incidents ADD COLUMN cancel_reason VARCHAR(255) NULL').catch(()=>{});

// Auto-migrate citizen token for per-incident access control
pool.query('ALTER TABLE incidents ADD COLUMN citizen_token VARCHAR(64) NULL').catch(()=>{});

// Auto-migrate is_approved for Rescuer Approval
pool.query('ALTER TABLE users ADD COLUMN is_approved BOOLEAN DEFAULT TRUE').catch(()=>{});

// Auto-migrate citizens table for LINE login
pool.query(`
    CREATE TABLE IF NOT EXISTS citizens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        line_uid VARCHAR(100) NOT NULL UNIQUE,
        display_name VARCHAR(255) NULL,
        phone VARCHAR(20) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(()=>{});

pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        incident_id INT NOT NULL,
        sender VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        image LONGTEXT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
`).catch(()=>{});

const redisClient = redis.createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379', disableOfflineQueue: true });
redisClient.on('error', (err) => console.log('Redis error:', err));
redisClient.connect().then(() => console.log('Connected to Redis')).catch(err => console.error('[REDIS CONNECT]', err.message));

// 🗑️ Auto-Cleanup: Delete chat messages older than 3 days
async function cleanupChatHistory() {
    try {
        const [result] = await pool.query('DELETE FROM chat_messages WHERE timestamp < NOW() - INTERVAL 3 DAY');
        if (result.affectedRows > 0) {
            console.log(`[CLEANUP] Deleted ${result.affectedRows} old chat messages.`);
        }
    } catch (e) {
        console.error('[CLEANUP ERROR]', e);
    }
}

// Run cleanup every 1 hour
setInterval(cleanupChatHistory, 3600000);
cleanupChatHistory(); // Run once at startup

// Global Memory for Dispatch Queues (Handling Timeouts)
const dispatchState = {};

async function broadcastOffer(incident_id, drivers, payload) {
    if (drivers.length === 0) return;
    
    // Add prank count if citizen_phone exists
    let prank_count = 0;
    if (payload.citizen_phone) {
        try {
            const [rows] = await pool.query("SELECT COUNT(*) as count FROM incidents WHERE citizen_phone = ? AND cancel_reason = 'ก่อกวน / แจ้งเล่น'", [payload.citizen_phone]);
            prank_count = rows[0].count;
        } catch(e) {}
    }
    const finalPayload = { incident_id, prank_count, ...payload };
    
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
        io.to(`driver_${targetDriverId}`).emit('offer_mission', finalPayload);
    });
}


// Global Polling Loop: Find Pending Cases and retry matching every 5 seconds
setInterval(async () => {
    try {
        const [rows] = await pool.query('SELECT * FROM incidents WHERE status = "Pending"');
        for (const inc of rows) {
            if (!dispatchState[inc.id]) { 
                const nearbyDriverIds = await nearbyAvailableDrivers(inc.latitude, inc.longitude);
                console.log(`[SYS] 5s Loop: Found Pending SOS #${inc.id}, Nearby drivers: ${nearbyDriverIds.join(',')}`);
                if (nearbyDriverIds.length > 0) {
                     await broadcastOffer(inc.id, nearbyDriverIds, { details: inc.details, latitude: inc.latitude, longitude: inc.longitude, citizen_phone: inc.citizen_phone, parent_incident_id: inc.parent_incident_id });
                }
            } else {
                console.log(`[SYS] 5s Loop: Incident #${inc.id} is already ringing, ignoring...`);
            }
        }
    } catch(e) { console.error("[SYS] 5s Loop Error:", e); }
}, 5000);

// 1. Auth API
app.post('/api/login', loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length > 0) {
            const user = users[0];
            
            if (user.role === 'Rescue' && user.is_approved === 0) {
                return res.status(403).json({ error: 'บัญชีของคุณอยู่ระหว่างการรออนุมัติจากผู้ดูแลระบบ' });
            }

            const isMatch = await verifyPassword(password, user.password);
            
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

const verifyToken = async (req, res, next) => {
    const token = req.headers['authorization'];
    if (!token) return res.status(403).json({ error: 'A token is required' });
    try {
        req.user = await authenticateStaff(token.replace('Bearer ', ''));
        next();
    } catch (err) { res.status(401).json({ error: 'Invalid Token' }); }
};

// Resolve identity from the database on every privileged request (approval can be revoked).
async function authenticateStaff(token) {
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!['admin', 'rescue'].includes(claims.role?.toLowerCase())) throw new Error('Unauthorized');
    const [rows] = await pool.query('SELECT id, username, role, foundation_id, phone, is_approved FROM users WHERE id = ?', [claims.id]);
    const user = rows[0];
    if (!user || !['admin', 'rescue'].includes(user.role?.toLowerCase()) ||
        (user.role.toLowerCase() === 'rescue' && !user.is_approved)) throw new Error('Unauthorized');
    return user;
}

async function staffIncidentAccess(user, incidentId, family = false) {
    const [rows] = await pool.query('SELECT * FROM incidents WHERE id = ?', [incidentId]);
    const incident = rows[0];
    if (!incident) return null;
    if (user.role.toLowerCase() === 'admin' || String(incident.assigned_user_id) === String(user.id)) return incident;
    if (family) {
        const rootId = incident.parent_incident_id || incident.id;
        const [assigned] = await pool.query('SELECT assigned_user_id FROM incidents WHERE (id = ? OR parent_incident_id = ?) AND assigned_user_id = ?', [rootId, rootId, user.id]);
        if (assigned.some(row => String(row.assigned_user_id) === String(user.id))) return incident;
    }
    return null;
}

async function verifyLineIdentity(idToken) {
    if (typeof idToken !== 'string' || !idToken) throw new Error('Unauthorized');
    const channelId = process.env.LINE_LOGIN_CHANNEL_ID;
    if (!channelId) throw new Error('LINE Login is not configured');
    const { data } = await axios.post('https://api.line.me/oauth2/v2.1/verify',
        new URLSearchParams({ id_token: idToken, client_id: channelId }).toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 5000 });
    if (!data.sub || String(data.aud) !== String(channelId) || data.iss !== 'https://access.line.me' || (!Number.isFinite(data.exp) || data.exp * 1000 <= Date.now())) throw new Error('Unauthorized');
    return { line_uid: data.sub, display_name: data.name || '' };
}

const verifyCitizenSession = (req, res, next) => {
    try {
        const claims = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), JWT_SECRET, { algorithms: ['HS256'] });
        if (claims.role !== 'Citizen' || !claims.sub) throw new Error('Unauthorized');
        req.citizen = claims;
        next();
    } catch { res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ LINE ใหม่' }); }
};

// GEO members have no individual TTL. Only dispatch to members with a live status lease.
async function nearbyAvailableDrivers(latitude, longitude) {
    if (!redisClient.isReady) return [];
    const ids = await redisClient.sendCommand(['GEORADIUS', 'online_rescuers', String(longitude), String(latitude), '50', 'km', 'ASC']);
    const available = [];
    for (const id of ids) {
        const raw = await redisClient.get(`rescuer_status:${id}`);
        const status = raw && JSON.parse(raw);
        if (status?.status === 'available' && status.last_seen > Date.now() - 60000) available.push(id);
        else await redisClient.sendCommand(['ZREM', 'online_rescuers', String(id)]);
    }
    return available;
}

// Change availability on the current lease only; never recreate a disconnected driver's key.
async function setDriverAvailability(userId, status) {
    try {
        if (!redisClient.isReady) return;
        await redisClient.eval(`-- status-write
            local raw = redis.call('GET', KEYS[1])
            if not raw then return 0 end
            local ttl = redis.call('PTTL', KEYS[1])
            if ttl <= 0 then redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[2]); return 0 end
            local state = cjson.decode(raw)
            state.status = ARGV[1]
            redis.call('SET', KEYS[1], cjson.encode(state), 'PX', ttl)
            if ARGV[1] == 'available' then redis.call('GEOADD', KEYS[2], state.longitude, state.latitude, ARGV[2])
            else redis.call('ZREM', KEYS[2], ARGV[2]) end
            return 1`, { keys: [`rescuer_status:${userId}`, 'online_rescuers'], arguments: [status, String(userId)] });
    } catch (error) {
        // SQL is authoritative. Heartbeat/polling reconcile a Redis outage without undoing the case.
        console.error('[PRESENCE SYNC]', error.message);
    }
}

// Citizen LINE Auth
app.post('/api/citizen/auth', publicWriteLimiter, async (req, res) => {
    try {
        const { line_uid, display_name } = await verifyLineIdentity(req.body.id_token);
        const citizen_token = jwt.sign({ sub: line_uid, role: 'Citizen' }, JWT_SECRET, { expiresIn: '1h' });
        const [rows] = await pool.query('SELECT phone FROM citizens WHERE line_uid = ?', [line_uid]);
        if (rows.length > 0) {
            await pool.query('UPDATE citizens SET display_name = ? WHERE line_uid = ?', [display_name, line_uid]);
            res.json({ message: 'Authenticated', phone: rows[0].phone || '', citizen_token });
        } else {
            await pool.query('INSERT INTO citizens (line_uid, display_name) VALUES (?, ?)', [line_uid, display_name]);
            res.json({ message: 'New citizen created', phone: '', citizen_token });
        }
    } catch(e) { res.status(401).json({ error: 'ไม่สามารถยืนยันตัวตน LINE ได้ กรุณาเข้าสู่ระบบใหม่' }); }
});

// Citizen Register Phone (Standalone API)
app.post('/api/citizen/register-phone', publicWriteLimiter, verifyCitizenSession, async (req, res) => {
    try {
        const { phone } = req.body;
        const line_uid = req.citizen.sub;
        if (typeof phone !== 'string' || !/^0\d{8,9}$/.test(phone)) return res.status(400).json({ error: 'Missing data' });
        await pool.query('UPDATE citizens SET phone = ? WHERE line_uid = ?', [phone, line_uid]);
        res.json({ message: 'Phone updated successfully' });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// 2. Incident API (Auto-Dispatch GRAB-Style)
app.post('/api/incidents', sosLimiter, async (req, res) => {
    try {
        let { details, latitude, longitude, citizen_phone } = req.body;
        latitude = Number(latitude); longitude = Number(longitude);
        if (req.body.latitude == null || req.body.longitude == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85.05112878 || Math.abs(longitude) > 180) {
            return res.status(400).json({ error: 'Invalid GPS' });
        }
        // A public SOS never updates another citizen's identity or registered phone.

        // AUTO-ASSIGN: Create Pending Case ALWAYS (Even if no one is nearby right now)
        const citizen_token = crypto.randomUUID();
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone, citizen_token) VALUES (?, ?, ?, ?, ?, ?)',
            [details || 'SOS via App', latitude, longitude, 'Pending', citizen_phone, citizen_token]
        );
        const incident_id = result.insertId;

        // A persisted Pending case is retried by the polling loop if Redis is down.
        if (redisClient.isReady) {
            nearbyAvailableDrivers(latitude, longitude)
                .then(drivers => broadcastOffer(incident_id, drivers, { details, latitude, longitude, citizen_phone }))
                .catch(error => console.error('[DISPATCH DEFERRED]', error.message));
        }

        res.status(201).json({ message: 'Searching for rescuer', incident_id, citizen_token });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Driver accept case (Atomic Lock)
app.post('/api/incidents/:id/accept', verifyToken, async (req, res) => {
    const incident_id = req.params.id;
    const driver_id = req.user.id;
    if (req.user.role.toLowerCase() !== 'rescue') return res.status(403).json({ error: 'Driver required' });

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

        await setDriverAvailability(driver_id, 'busy');

        const [driverRows] = await pool.query('SELECT username, phone FROM users WHERE id = ?', [driver_id]);
        const rescuerInfo = driverRows[0] || {};
        
        const [incRows] = await pool.query('SELECT parent_incident_id, citizen_phone FROM incidents WHERE id = ?', [incident_id]);
        const parent_id = incRows.length > 0 && incRows[0].parent_incident_id ? incRows[0].parent_incident_id : incident_id;
        const citizen_phone = incRows.length > 0 ? incRows[0].citizen_phone : null;

        // Notify Citizen via In-App socket
        io.to(`incident_room_${parent_id}`).emit('driver_assigned', { incident_id, driver_id, driver_name: rescuerInfo.username, driver_phone: rescuerInfo.phone });

        // Notify Citizen via LINE Push (if they have LINE account)
        if (citizen_phone) {
            const [citizenRows] = await pool.query('SELECT line_uid FROM citizens WHERE phone = ?', [citizen_phone]);
            if (citizenRows.length > 0 && citizenRows[0].line_uid) {
                const msg = `✅ รถกู้ภัยกำลังมาหาคุณแล้ว!\n\n` +
                    `🚑 หน่วย: ${rescuerInfo.username || 'ทีมกู้ภัย'}\n` +
                    `📞 เบอร์ติดต่อ: ${rescuerInfo.phone || '-'}\n\n` +
                    `กรุณารอที่จุดเกิดเหตุ ทีมกำลังมุ่งหน้ามาหาคุณโดยตรงครับ`;
                sendLinePush(citizenRows[0].line_uid, msg);
            }
        }

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

// Driver Request Backup
app.post('/api/incidents/:id/backup', verifyToken, async (req, res) => {
    try {
        const parent_id = req.params.id;
        const authorized = await staffIncidentAccess(req.user, parent_id, true);
        if (!authorized) return res.status(403).json({ error: 'Forbidden' });
        if (authorized.status !== 'Accepted') return res.status(409).json({ error: 'Incident is not active' });
        
        const [counts] = await pool.query('SELECT COUNT(*) as count FROM incidents WHERE parent_incident_id = ? AND status != "Resolved"', [parent_id]);
        if (counts[0].count >= 3) return res.status(400).json({ error: 'ถึงจำกัดการขอกำลังเสริมแล้ว (Max 3 units)' });

        const [parents] = await pool.query('SELECT * FROM incidents WHERE id = ?', [parent_id]);
        if (parents.length === 0) return res.status(404).json({ error: 'Incident not found' });
        const p = parents[0];

        const [recent] = await pool.query('SELECT created_at FROM incidents WHERE parent_incident_id = ? ORDER BY id DESC LIMIT 1', [parent_id]);
        if (recent.length > 0) {
            const msSinceLast = new Date() - new Date(recent[0].created_at);
            if (msSinceLast < 60000) return res.status(400).json({ error: 'โปรดรอ 1 นาทีก่อนขอกำลังเสริมอีกครั้ง (Cooldown 60s)' });
        }

        const details = `[🚨 BACKUP] ${p.details}`;
        const [result] = await pool.query(
            'INSERT INTO incidents (details, latitude, longitude, status, citizen_phone, parent_incident_id, citizen_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [details, p.latitude, p.longitude, 'Pending', p.citizen_phone, parent_id, p.citizen_token]
        );
        const incident_id = result.insertId;

        const nearbyDriverIds = await nearbyAvailableDrivers(p.latitude, p.longitude);
        const eligibleDrivers = nearbyDriverIds.filter(id => id != req.user.id);
        if (eligibleDrivers.length > 0) {
            broadcastOffer(incident_id, eligibleDrivers, { details, latitude: p.latitude, longitude: p.longitude, citizen_phone: p.citizen_phone, parent_incident_id: parent_id });
        }
        
        io.to(`incident_room_${parent_id}`).emit('new_chat_message', { sender: 'System', message: `🚨 รถพยาบาลคันแรกได้แจ้งขอกำลังเสริม! เตรียมพบทีมที่ ${counts[0].count + 2}`, timestamp: new Date() });
        res.json({ message: 'Backup requested', incident_id });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin System Status & Analytics
app.get('/api/admin/system-status', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [incidents] = await pool.query('SELECT i.*, u.username as assigned_username FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.status IN ("Pending", "Accepted")');
        const [history] = await pool.query('SELECT i.*, u.username as assigned_username FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.status IN ("Resolved", "Failed") ORDER BY i.id DESC LIMIT 500');
        const [prank_stats] = await pool.query("SELECT citizen_phone, COUNT(*) as count FROM incidents WHERE cancel_reason = 'ก่อกวน / แจ้งเล่น' GROUP BY citizen_phone ORDER BY count DESC LIMIT 50");
        
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
        res.json({ incidents, rescuers, history, avgResponseTimeSec, prank_stats });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Broadcast Message
app.post('/api/admin/broadcast', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    io.emit('admin_broadcast', { message: req.body.message, timestamp: new Date() });
    res.json({ message: 'Broadcast Sent' });
});

// Admin LINE OA Broadcast (General News)
app.post('/api/admin/line-broadcast', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        
        const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
        if (!token || token === 'YOUR_CHANNEL_ACCESS_TOKEN') {
            return res.status(500).json({ error: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน .env' });
        }

        // Call LINE Messaging API directly
        const lineRes = await axios.post('https://api.line.me/v2/bot/message/broadcast', {
            messages: [{ type: 'text', text: message }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log("LINE Broadcast success:", lineRes.status);
        res.json({ message: 'LINE Broadcast Sent' });
    } catch(e) { 
        const errDetail = e.response?.data || e.message;
        console.error("LINE Broadcast Error:", JSON.stringify(errDetail));
        res.status(500).json({ error: 'ส่ง LINE ไม่สำเร็จ: ' + JSON.stringify(errDetail) }); 
    }
});

// Admin Manual Force Cancel
app.post('/api/admin/incidents/:id/cancel', verifyToken, async (req, res) => {
    try {
        console.log("CANCEL ROUTE HIT FOR:", req.params.id);
        if (!req.user || !req.user.role || req.user.role.toLowerCase() !== 'admin') {
            return res.status(403).json({ error: 'Forbidden' });
        }
        
        const incident_id = req.params.id;
        const cancel_reason = req.body.reason || null;

        console.log("[DEBUG] Clearing dispatchState...");
        if (dispatchState[incident_id]) {
            clearTimeout(dispatchState[incident_id].timer);
            delete dispatchState[incident_id];
        }
        
        console.log("[DEBUG] Fetching assigned_user_id...");
        const [assignedRows] = await pool.query('SELECT assigned_user_id FROM incidents WHERE (id = ? OR parent_incident_id = ?) AND assigned_user_id IS NOT NULL', [incident_id, incident_id]);
        
        for (const user of assignedRows) {
            const uid = user.assigned_user_id;
            await setDriverAvailability(uid, 'available');
        }
        
        console.log("[DEBUG] Updating DB status to Resolved...");
        await pool.query('UPDATE incidents SET status = "Resolved", cancel_reason = ? WHERE id = ? OR parent_incident_id = ?', [cancel_reason, incident_id, incident_id]);
        
        console.log("[DEBUG] Emitting sockets...");
        io.to(`incident_room_${incident_id}`).emit('no_drivers'); // Signal Citizen to stop waiting
        
        console.log("[DEBUG] Done. Sending success.");
        res.json({ message: 'Cancelled manually' });
    } catch(e) { 
        console.log("[FATAL CANCEL ERROR]", e);
        res.status(500).json({ error: e.stack ? e.stack.toString() : String(e) }); 
    }
});

// Admin Add Foundation
app.post('/api/admin/foundations', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { name, contact_info } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        const [result] = await pool.query('INSERT INTO foundations (name, contact_info) VALUES (?, ?)', [name, contact_info || null]);
        res.status(201).json({ message: 'Foundation created', id: result.insertId });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Get Foundations
app.get('/api/admin/foundations', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [rows] = await pool.query('SELECT * FROM foundations');
        res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Public Get Foundations
app.get('/api/foundations/public', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM foundations');
        res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Add Rescuer
app.post('/api/admin/rescuers', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { username, password, foundation_id, phone } = req.body;
        if (!username || !password || !foundation_id) return res.status(400).json({ error: 'Missing required fields' });
        
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username already exists' });
        
        const hashed = await bcrypt.hash(password, 10);
        const [result] = await pool.query('INSERT INTO users (username, password, role, foundation_id, phone) VALUES (?, ?, ?, ?, ?)', 
            [username, hashed, 'Rescue', foundation_id, phone || null]);
        
        res.status(201).json({ message: 'Rescuer created', id: result.insertId });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Add Rescuer (Bulk CSV)
app.post('/api/admin/rescuers/bulk', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const { rescuers } = req.body;
        if (!Array.isArray(rescuers) || rescuers.length === 0) return res.status(400).json({ error: 'Empty array' });
        
        let successCount = 0;
        for (const r of rescuers) {
            const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [r.username]);
            if (existing.length === 0) {
                const hashed = await bcrypt.hash(r.password.toString(), 10);
                await pool.query('INSERT INTO users (username, password, role, foundation_id, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?)', 
                    [r.username, hashed, 'Rescue', r.foundation_id, r.phone || null, true]);
                successCount++;
            }
        }
        res.status(201).json({ message: `เพิ่มบัญชีสำเร็จ ${successCount} รายการ` });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Driver Self-Registration (Public API)
app.post('/api/rescuers/register', publicWriteLimiter, async (req, res) => {
    try {
        const { username, password, foundation_id, phone } = req.body;
        if (!username || !password || !foundation_id) return res.status(400).json({ error: 'Missing required fields' });
        
        const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
        if (existing.length > 0) return res.status(400).json({ error: 'Username already exists' });
        
        const hashed = await bcrypt.hash(password, 10);
        await pool.query('INSERT INTO users (username, password, role, foundation_id, phone, is_approved) VALUES (?, ?, ?, ?, ?, ?)', 
            [username, hashed, 'Rescue', foundation_id, phone || null, false]);
        
        res.status(201).json({ message: 'ลงทะเบียนสำเร็จ โปรดรอการอนุมัติ' });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Get Pending Rescuers
app.get('/api/admin/rescuers/pending', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        const [rows] = await pool.query('SELECT u.id, u.username, u.phone, f.name as foundation_name FROM users u LEFT JOIN foundations f ON u.foundation_id = f.id WHERE u.role = "Rescue" AND u.is_approved = FALSE');
        res.json(rows);
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Approve Rescuer
app.post('/api/admin/rescuers/:id/approve', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        await pool.query('UPDATE users SET is_approved = TRUE WHERE id = ?', [req.params.id]);
        res.json({ message: 'Approved' });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Admin Reject Rescuer
app.post('/api/admin/rescuers/:id/reject', verifyToken, async (req, res) => {
    if (req.user.role?.toLowerCase() !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    try {
        await pool.query('DELETE FROM users WHERE id = ? AND is_approved = FALSE', [req.params.id]);
        res.json({ message: 'Rejected and deleted' });
    } catch(e) { res.status(500).json({ error: e.message }) }
});

// Fetch active case for Driver
app.get('/api/incidents/active', verifyToken, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM incidents WHERE assigned_user_id = ? AND status = "Accepted" LIMIT 1', [req.user.id]);
        res.json(rows[0] || null);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Driver get chat history
app.get('/api/incidents/:id/chat', verifyToken, async (req, res) => {
    try {
        const incident_id = req.params.id;
        if (!await staffIncidentAccess(req.user, incident_id, true)) return res.status(403).json({ error: 'Forbidden' });
        const [rows] = await pool.query(`
            SELECT * FROM chat_messages 
            WHERE incident_id = ? 
               OR incident_id = (SELECT COALESCE(parent_incident_id, id) FROM incidents WHERE id = ?)
               OR incident_id IN (SELECT id FROM incidents WHERE parent_incident_id = ?)
            ORDER BY timestamp ASC
        `, [incident_id, incident_id, incident_id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Citizen get chat history (protected by per-incident citizen token)
app.get('/api/citizen/incidents/:id/chat', async (req, res) => {
    try {
        const incident_id = req.params.id;
        const { token } = req.query;
        if (!token) return res.status(403).json({ error: 'Unauthorized' });

        const [incidentRows] = await pool.query('SELECT citizen_token FROM incidents WHERE id = ?', [incident_id]);
        if (incidentRows.length === 0 || incidentRows[0].citizen_token !== token) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const [rows] = await pool.query(`
            SELECT * FROM chat_messages 
            WHERE incident_id = ? 
               OR incident_id IN (SELECT id FROM incidents WHERE parent_incident_id = ?)
            ORDER BY timestamp ASC
        `, [incident_id, incident_id]);
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Driver complete case
app.post('/api/incidents/:id/complete', verifyToken, async (req, res) => {
    try {
        const incident = await staffIncidentAccess(req.user, req.params.id);
        if (!incident) return res.status(403).json({ error: 'Forbidden' });
        if (incident.status !== 'Accepted') return res.status(409).json({ error: 'Incident is not active' });
        await pool.query('UPDATE incidents SET status = "Resolved", resolved_at = CURRENT_TIMESTAMP WHERE id = ? OR parent_incident_id = ?', [req.params.id, req.params.id]);

        const [assignedRows] = await pool.query('SELECT assigned_user_id FROM incidents WHERE (id = ? OR parent_incident_id = ?) AND assigned_user_id IS NOT NULL', [req.params.id, req.params.id]);
        for (const user of assignedRows) {
            const uid = user.assigned_user_id;
            await setDriverAvailability(uid, 'available');
        }

        const [incRows] = await pool.query('SELECT parent_incident_id, citizen_phone FROM incidents WHERE id = ?', [req.params.id]);
        const parent_id = incRows.length > 0 && incRows[0].parent_incident_id ? incRows[0].parent_incident_id : req.params.id;
        const citizen_phone = incRows.length > 0 ? incRows[0].citizen_phone : null;

        if (!incident.parent_incident_id) io.to(`incident_room_${parent_id}`).emit('mission_completed', { message: 'Mission Cascaded Complete' });

        // Notify Citizen via LINE Push (mission complete)
        if (citizen_phone && !incident.parent_incident_id) {
            const [citizenRows] = await pool.query('SELECT line_uid FROM citizens WHERE phone = ?', [citizen_phone]);
            if (citizenRows.length > 0 && citizenRows[0].line_uid) {
                const msg = `🏁 ภารกิจเสร็จสิ้นแล้วครับ!\n\n` +
                    `ทีมกู้ภัยได้ดำเนินการช่วยเหลือเรียบร้อยแล้ว\n` +
                    `ขอให้คุณปลอดภัยนะครับ 🙏\n\n` +
                    `หากต้องการความช่วยเหลือเพิ่มเติม กด "แจ้งเหตุ" ได้เลยครับ`;
                sendLinePush(citizenRows[0].line_uid, msg);
            }
        }

        res.json({ message: 'Mission Completed' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Citizen fetch status API (protected by per-incident citizen token)
app.get('/api/incidents/status/:id', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(403).json({ error: 'Unauthorized' });

        const [rows] = await pool.query('SELECT i.status, i.citizen_token, u.username as driver_name, u.phone as driver_phone FROM incidents i LEFT JOIN users u ON i.assigned_user_id = u.id WHERE i.id = ?', [req.params.id]);
        if (rows.length === 0 || rows[0].citizen_token !== token) {
            return res.status(403).json({ error: 'Unauthorized' });
        }
        res.json({ status: rows[0].status, driver_name: rows[0].driver_name, driver_phone: rows[0].driver_phone });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Real-time Socket.io: authenticate before any room join, Redis write or broadcast.
io.on('connection', (socket) => {
    let operations = Promise.resolve();
    const safe = handler => (data = {}, ack = () => {}) => {
        operations = operations.then(async () => {
        try { const result = await handler(data || {}); if (typeof ack === 'function') ack({ ok: true, ...result }); }
        catch (error) { if (typeof ack === 'function') ack({ ok: false, error: 'Unauthorized or unavailable', retry_registration: error.message === 'Presence expired' }); console.error('[SOCKET]', error.message); }
        });
        return operations;
    };
    const staff = data => authenticateStaff(data.staff_token);
    const driver = async data => {
        const user = await staff(data);
        if (user.role.toLowerCase() !== 'rescue') throw new Error('Driver required');
        return user;
    };
    const coordinates = data => {
        if (typeof data.latitude !== 'number' || typeof data.longitude !== 'number' || !Number.isFinite(data.latitude) || !Number.isFinite(data.longitude) || Math.abs(data.latitude) > 85.05112878 || Math.abs(data.longitude) > 180) throw new Error('Invalid GPS');
    };
    const release = async userId => {
        // An old socket disconnect must never delete a newly reconnected driver's lease.
        await redisClient.eval(`local raw = redis.call('GET', KEYS[1])
            if raw and cjson.decode(raw).socket_id == ARGV[1] then
                redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], ARGV[2]); return 1
            end return 0`, { keys: [`rescuer_status:${userId}`, 'online_rescuers'], arguments: [socket.id, String(userId)] });
        socket.leave(`driver_${userId}`);
    };
    const publishPresence = async (data, user, replaceOwner = false) => {
        coordinates(data);
        const [missions] = await pool.query('SELECT id FROM incidents WHERE assigned_user_id = ? AND status = "Accepted"', [user.id]);
        const status = missions.length ? 'busy' : 'available';
        const state = { status, username: user.username, foundation_id: user.foundation_id, phone: user.phone,
            latitude: data.latitude, longitude: data.longitude, last_seen: Date.now(), socket_id: socket.id };
        if (!socket.connected) throw new Error('Socket disconnected');
        // Atomically verify the owner, renew the lease and update the GEO index.
        const saved = await redisClient.eval(`-- presence-write
            local raw = redis.call('GET', KEYS[1])
            if ARGV[1] ~= '' and (not raw or cjson.decode(raw).socket_id ~= ARGV[1]) then return 0 end
            redis.call('SET', KEYS[1], ARGV[2], 'EX', 60)
            if ARGV[3] == 'available' then redis.call('GEOADD', KEYS[2], ARGV[4], ARGV[5], ARGV[6])
            else redis.call('ZREM', KEYS[2], ARGV[6]) end
            return 1`, { keys: [`rescuer_status:${user.id}`, 'online_rescuers'],
                arguments: [replaceOwner ? '' : socket.id, JSON.stringify(state), status, String(data.longitude), String(data.latitude), String(user.id)] });
        if (!saved) throw new Error('Driver session replaced or expired');
        socket.data.userId = user.id;
        socket.join(`driver_${user.id}`);
        return state;
    };
    socket.on('go_online', safe(async data => {
        const user = await driver(data);
        await publishPresence(data, user, true);
    }));
    socket.on('go_offline', safe(async data => {
        const user = await driver(data);
        await release(user.id);
        socket.data.userId = null;
    }));
    socket.on('disconnect', safe(async () => {
        if (socket.data.userId) {
            try { await release(socket.data.userId); } catch (error) { console.error('[PRESENCE]', error.message); }
        }
    }));
    socket.on('update_vehicle_location', safe(async data => {
        const user = await driver(data);
        coordinates(data);
        if (data.active_incident_id && !await staffIncidentAccess(user, data.active_incident_id, true)) throw new Error('Forbidden');
        const raw = await redisClient.get(`rescuer_status:${user.id}`);
        if (!raw) throw new Error('Presence expired');
        if (JSON.parse(raw).socket_id !== socket.id) throw new Error('Driver session replaced');
        const state = await publishPresence(data, user);
        io.to('admin_room').emit('rescuer_location_update', { vehicle_id: user.id, ...state });
        if (data.active_incident_id) {
            io.to(`incident_room_${data.active_incident_id}`).emit('vehicle_location_updated', { latitude: data.latitude, longitude: data.longitude });
        }
    }));
    socket.on('join_admin_room', safe(async data => {
        const user = await staff(data);
        if (user.role.toLowerCase() !== 'admin') throw new Error('Forbidden');
        socket.join('admin_room');
    }));
    const roomAccess = async data => {
        if (data.citizen_token) {
            const [rows] = await pool.query('SELECT citizen_token FROM incidents WHERE id = ?', [data.incident_id]);
            if (!rows[0]?.citizen_token || rows[0].citizen_token !== data.citizen_token) throw new Error('Forbidden');
            return 'Citizen';
        }
        const user = await staff(data);
        if (!await staffIncidentAccess(user, data.incident_id, true)) throw new Error('Forbidden');
        return `Staff:${user.username}`;
    };
    socket.on('join_incident_room', safe(async data => {
        await roomAccess(data);
        socket.join(`incident_room_${data.incident_id}`);
    }));
    socket.on('send_chat_message', safe(async data => {
        const sender = await roomAccess(data);
        const { incident_id, message, image, clientId } = data;
        if (typeof message !== 'string' || message.length > 5000 || (image && (typeof image !== 'string' || image.length > 500000))) throw new Error('Invalid message');
        await pool.query('INSERT INTO chat_messages (incident_id, sender, message, image) VALUES (?, ?, ?, ?)', [incident_id, sender, message, image || null]);
        socket.join(`incident_room_${incident_id}`);
        io.to(`incident_room_${incident_id}`).emit('new_chat_message', { sender, message, image, timestamp: new Date(), clientId });
    }));
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
    console.log(`Rescue dispatch server on port ${port}`);
});
