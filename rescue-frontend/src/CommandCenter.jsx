import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { toast } from 'react-toastify';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';

// Custom Map Icons
const iconBaseOpts = { shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] };
const RedIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' });
const BlueIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' });

const socket = io('http://127.0.0.1:3000');

function CommandCenter({ user, onLogout }) {
  const [isOnline, setIsOnline] = useState(false);
  const [activeMission, setActiveMission] = useState(null);
  const [incomingMission, setIncomingMission] = useState(null);
  
  // Driver Live GPS
  const [lat, setLat] = useState(13.7463);
  const [lng, setLng] = useState(100.5118);
  
  // Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');

  const gpsInterval = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    // 1. Fetch any existing active mission if app reloads
    fetchActiveMission();

    // 2. Start GPS simulation (In real life, navigator.geolocation)
    gpsInterval.current = setInterval(() => {
       setLat(prev => prev + (Math.random() - 0.5) * 0.0002);
       setLng(prev => prev + (Math.random() - 0.5) * 0.0002);
    }, 10000);

    // 3. Listen for Mission Offers (Broadcast System)
    socket.on('offer_mission', (mission) => {
       toast.warning('🚨 มีงานด่วนโซนคุณ! (ใครกดก่อนได้ก่อน)!', { autoClose: 30000 });
       setIncomingMission(mission);
    });

    socket.on('cancel_offer', (data) => {
       setIncomingMission(curr => {
           if (curr && curr.incident_id === data.incident_id) return null;
           return curr;
       });
    });

    socket.on('new_chat_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    socket.on('admin_broadcast', (data) => {
       toast.error(`📢 ประกาศจากศูนย์กลาง:\n${data.message}`, { autoClose: 20000, theme: 'colored' });
    });

    return () => {
      clearInterval(gpsInterval.current);
      socket.off('offer_mission');
      socket.off('cancel_offer');
      socket.off('new_chat_message');
      socket.off('admin_broadcast');
    };
  }, []);

  // Update Redis Location repeatedly
  useEffect(() => {
      if (isOnline || activeMission) {
          socket.emit('update_vehicle_location', {
              vehicle_id: user.id, latitude: lat, longitude: lng, active_incident_id: activeMission?.id
          });
      }
  }, [lat, lng, isOnline, activeMission]);


  const fetchActiveMission = async () => {
    try {
      const res = await axios.get(`http://127.0.0.1:3000/api/incidents/active`, {
         headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.data) {
         setActiveMission(res.data);
         socket.emit('join_incident_room', res.data.id);
      }
    } catch(e) { }
  };

  const toggleOnline = () => {
      if (!isOnline) {
          socket.emit('go_online', { user_id: user.id, foundation_id: user.foundation_id, phone: user.phone, latitude: lat, longitude: lng });
          toast.success("🌐 You are now ONLINE. Waiting for dispatch.");
          setIsOnline(true);
      } else {
          socket.emit('go_offline', { user_id: user.id });
          toast.info("🔴 You are now OFFLINE.");
          setIsOnline(false);
      }
  };

  const completeMission = async () => {
      try {
          await axios.post(`http://127.0.0.1:3000/api/incidents/${activeMission.id}/complete`, {}, {
             headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
          });
          toast.success("✅ Mission Completed successfully!");
          setActiveMission(null);
          setChatMessages([]);
          // Driver stays online automatically for the next job!
          
      } catch (e) { 
          if (e.response?.status === 403 || e.response?.data?.error === 'Invalid Token') {
              toast.error("เซสชันหมดอายุแล้ว กรุณาล็อกอินใหม่");
              localStorage.removeItem('token');
              setTimeout(() => { window.location.href = '/login'; }, 1500);
          } else {
              toast.error("Failed to complete mission: " + (e.response?.data?.error || e.message)); 
          }
      }
  };

  const sendMessage = () => {
    if (!chatInput.trim() || !activeMission) return;
    socket.emit('send_chat_message', {
      incident_id: activeMission.id, sender: 'Staff', message: chatInput
    });
    setChatInput('');
  };

  // --------------- RENDER INCOMING MISSION (RINGING) ---------------
  if (incomingMission && !activeMission) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a', color: 'white', padding: '20px', textAlign: 'center' }}>
         <div style={{ width: '120px', height: '120px', background: '#ef4444', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '50px', marginBottom: '30px' }}>🚨</div>
         <h1 style={{ color: '#ef4444', margin: 0 }}>🚨 SOS ฉุกเฉิน! (ชิงเคส)</h1>
         <p style={{ fontSize: '18px', color: '#94a3b8' }}>ใครกดก่อนได้เคสนี้ไป (รัศมี 50km)</p>
         
         <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '15px', padding: '20px', width: '100%', maxWidth: '400px', margin: '30px 0', textAlign: 'left' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#f8fafc' }}>รายละเอียด:</h3>
            <p style={{ margin: 0, color: '#94a3b8', fontSize: '18px' }}>{incomingMission.details || 'SOS ขอความช่วยเหลือด่วน ผ่านแอป'}</p>
         </div>
         
         <div style={{ display: 'flex', gap: '20px', width: '100%', maxWidth: '400px' }}>
            <button onClick={async () => {
                try {
                   await axios.post(`http://127.0.0.1:3000/api/incidents/${incomingMission.incident_id}/accept`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
                   const missionData = { id: incomingMission.incident_id, latitude: incomingMission.latitude, longitude: incomingMission.longitude, details: incomingMission.details, citizen_phone: incomingMission.citizen_phone };
                   setActiveMission(missionData);
                   setIncomingMission(null);
                   toast.success("✅ รับงานเรียบร้อย นำทางทันที!");
                   socket.emit('join_incident_room', incomingMission.incident_id);
                } catch(e) {
                   toast.error('❌ ไม่สามารถรับงานได้: ' + (e.response?.data?.error || 'เซิร์ฟเวอร์ขัดข้อง'));
                   setIncomingMission(null);
                }
            }} style={{ flex: 2, background: '#10b981', color: 'white', padding: '20px', fontSize: '24px', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: 'bold' }}>รับงาน (Accept)</button>
            
            <button onClick={async () => {
                setIncomingMission(null); 
                await axios.post(`http://127.0.0.1:3000/api/incidents/${incomingMission.incident_id}/reject`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
            }} style={{ flex: 1, background: 'transparent', color: '#ef4444', padding: '20px', fontSize: '18px', border: '2px solid #ef4444', borderRadius: '12px', cursor: 'pointer' }}>ข้ามเคสนี้</button>
         </div>
         <p style={{ marginTop: '30px', color: '#ef4444', fontWeight: 'bold' }}>⏳ หากถูกแย่งเคสไปแล้ว หน้านี้จะอัปเดตและดับไปเอง</p>
      </div>
    );
  }

  // --------------- RENDER ACTIVE MISSION ---------------
  if (activeMission) {
     return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
        <header style={{ padding: '20px', background: '#dc2626', color: '#fff', display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>🚨 Active Mission #{activeMission.id}</h2>
            <p style={{ margin: 0 }}>{activeMission.details}</p>
          </div>
          <button onClick={completeMission} className="btn" style={{ background: '#10b981', color: 'white', fontWeight: 'bold' }}>Complete Mission ✅</button>
        </header>

        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[lat, lng]} zoom={14} style={{ height: '100%', width: '100%' }}>
             <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
             <Marker position={[activeMission.latitude, activeMission.longitude]} icon={RedIcon}>
               <Popup>จุดเกิดเหตุ (Citizen)</Popup>
             </Marker>
             <Marker position={[lat, lng]} icon={BlueIcon}>
               <Popup>รถกู้ภัย (You)</Popup>
             </Marker>
             <RoutingMachine citizen={[activeMission.latitude, activeMission.longitude]} rescuer={{lat, lng}} />
          </MapContainer>
        </div>

        <div className="glass-panel" style={{ height: '40vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTopLeftRadius: '20px', borderTopRightRadius: '20px' }}>
           <div style={{ padding: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-around', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <span style={{ color: '#e2e8f0' }}>📞 Citizen: {activeMission.citizen_phone || 'Unknown'}</span>
              <a href={`tel:${activeMission.citizen_phone}`} className="btn" style={{ background: '#3b82f6', color: '#fff', textDecoration: 'none' }}>Call Now</a>
           </div>
           
           <div style={{ flex: 1, padding: '15px', overflowY: 'auto' }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: '10px', textAlign: m.sender === 'Staff' ? 'right' : 'left' }}>
                  <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: '15px', background: m.sender === 'Staff' ? '#3b82f6' : '#ef4444', color: '#fff' }}>
                    {m.message}
                    {m.image && <><br/><img src={m.image} alt="evidence" style={{ maxWidth: '180px', borderRadius: '8px', cursor: 'pointer', marginTop: '5px' }} onClick={()=>window.open(m.image)}/></>}
                  </span>
                </div>
              ))}
           </div>
           <div style={{ padding: '10px 15px', display: 'flex', gap: '10px' }}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="พิมพ์ข้อความถึงผู้แจ้งเหตุ..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: 'none', outline: 'none' }} />
              <button onClick={sendMessage} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '20px', padding: '0 20px', cursor: 'pointer' }}>ส่ง</button>
           </div>
        </div>
      </div>
     );
  }

  // --------------- RENDER IDLE SCREEN ---------------
  return (
    <div style={{ padding: '20px', height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
        <div className="glass-panel animate-slide-up" style={{ padding: '40px', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
            <h1 className="text-gradient">🚑 Driver Companion</h1>
            <p style={{ color: '#94a3b8', marginBottom: '30px' }}>Role: {user.role} | Unit {user.id}</p>
            
            <div style={{ marginBottom: '40px' }}>
                <span style={{ display: 'inline-block', width: '15px', height: '15px', borderRadius: '50%', background: isOnline ? '#10b981' : '#64748b', marginRight: '10px' }}></span>
                <span style={{ color: '#fff', fontSize: '20px' }}>{isOnline ? 'ONLINE' : 'OFFLINE'}</span>
            </div>

            <button 
               onClick={toggleOnline} 
               style={{ width: '100%', padding: '16px', fontSize: '18px', borderRadius: '12px', border: 'none', background: isOnline ? '#334155' : '#10b981', color: '#fff', cursor: 'pointer', marginBottom: '20px' }}>
               {isOnline ? 'Go Offline' : 'Go Online & Ready'}
            </button>

            <button onClick={onLogout} style={{ width: '100%', padding: '12px', borderRadius: '12px', border: '1px solid #475569', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>Log Out</button>
        </div>
    </div>
  );
}

function RoutingMachine({ citizen, rescuer }) {
  const map = useMap();
  const routingControlRef = useRef(null);

  useEffect(() => {
    if (!citizen || !rescuer) return;

    const cLat = parseFloat(citizen[0]);
    const cLng = parseFloat(citizen[1]);
    const rLat = parseFloat(rescuer.lat);
    const rLng = parseFloat(rescuer.lng);

    // Delay the route request by 800ms to prevent identical duplicated requests 
    // from Citizen App and Driver App crashing the OSRM server rate limit at the exact same millisecond.
    const delayQuery = setTimeout(() => {
        if (!routingControlRef.current) {
          routingControlRef.current = L.Routing.control({
            waypoints: [
              L.latLng(rLat, rLng),
              L.latLng(cLat, cLng)
            ],
            lineOptions: { styles: [{ color: '#10b981', weight: 6, opacity: 0.9 }] },
            createMarker: () => null, show: false, addWaypoints: false,
          }).addTo(map);

          // Listen if the server rejected the ping
          routingControlRef.current.on('routingerror', (err) => {
              console.error("OSRM free server blocked the route request:", err);
              toast.error("Map Server blocked routing (Too many rapid requests). It will auto-retry.");
          });
        } else {
          routingControlRef.current.setWaypoints([
            L.latLng(rLat, rLng),
            L.latLng(cLat, cLng)
          ]);
        }
    }, 800);

    return () => clearTimeout(delayQuery);
  }, [citizen[0], citizen[1], rescuer.lat, rescuer.lng, map]);

  useEffect(() => {
    return () => { if (routingControlRef.current) map.removeControl(routingControlRef.current); };
  }, [map]);

  return null;
}

export default CommandCenter;
