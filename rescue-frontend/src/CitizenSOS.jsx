import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';

const iconBaseOpts = { shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] };
const RedIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' });
const BlueIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' });

const socket = io('http://127.0.0.1:3000');

function CitizenSOS() {
  const [details, setDetails] = useState('');
  const [citizenPhone, setCitizenPhone] = useState('');
  const [lat, setLat] = useState('13.7563');
  const [lng, setLng] = useState('100.5018');

  // SOS Hold Logic
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  // Tracking Screen State
  const [activeIncident, setActiveIncident] = useState(null);
  const [rescuerLoc, setRescuerLoc] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const mapRef = useRef(null);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setLat(pos.coords.latitude.toString());
        setLng(pos.coords.longitude.toString());
      });
    }

    // Socket listeners for Tracking Mode
    socket.on('vehicle_location_updated', (data) => {
      setRescuerLoc({ lat: data.latitude, lng: data.longitude });
    });

    socket.on('new_chat_message', (msg) => {
      setChatMessages(prev => [...prev, msg]);
    });

    return () => {
      socket.off('vehicle_location_updated');
      socket.off('new_chat_message');
    };
  }, []);

  // --------------- SOS HOLD LOGIC ---------------
  const startHold = () => {
    if (!citizenPhone.trim()) {
      toast.warning('กรุณากรอกเบอร์โทรศัพท์ก่อนกดแจ้งเหตุ (Phone Number Required)');
      return;
    }
    setIsHolding(true);
    setHoldProgress(0);

    const startTime = Date.now();
    progressTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTime;
        let progress = Math.min((elapsed / 5000) * 100, 100);
        setHoldProgress(progress);
    }, 50);

    holdTimerRef.current = setTimeout(() => {
      stopHold();
      submitSOS();
    }, 5000);
  };

  const stopHold = () => {
    setIsHolding(false);
    setHoldProgress(0);
    clearTimeout(holdTimerRef.current);
    clearInterval(progressTimerRef.current);
  };

  const submitSOS = async () => {
    try {
      toast.info('🚑 Searching for nearest rescue vehicle...');
      const res = await axios.post('http://127.0.0.1:3000/api/incidents', {
        details, latitude: parseFloat(lat), longitude: parseFloat(lng), citizen_phone: citizenPhone
      });

      toast.success('✅ Rescue Vehicle Found and Dispatched!');
      const incident = { id: res.data.incident_id, assigned_user_id: res.data.assigned_user_id };
      setActiveIncident(incident);

      // Join the private socket room
      socket.emit('join_incident_room', incident.id);

    } catch (e) {
      toast.error(e.response?.data?.error || '❌ Server Error or No Units Available.');
    }
  };

  // --------------- CHAT LOGIC ---------------
  const sendMessage = () => {
    if (!chatInput.trim() || !activeIncident) return;
    socket.emit('send_chat_message', {
      incident_id: activeIncident.id,
      sender: 'Citizen',
      message: chatInput
    });
    setChatInput('');
  };

  // --------------- UI RENDERS ---------------
  if (activeIncident) {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', fontFamily: 'sans-serif', background: '#0f172a' }}>
        <div style={{ padding: '20px', background: 'rgba(255,255,255,0.1)', color: '#fff', textAlign: 'center' }}>
          <h2>🚨 กู้ภัยกำลังเดินทางมาหาคุณ!</h2>
          <p>Rescue is En-Route (Incident #{activeIncident.id})</p>
        </div>
        
        <div style={{ flex: 1, position: 'relative' }}>
          <MapContainer center={[parseFloat(lat), parseFloat(lng)]} zoom={14} style={{ height: '100%', width: '100%' }} ref={mapRef}>
             <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
             
             {/* Citizen Location */}
             <Marker position={[parseFloat(lat), parseFloat(lng)]} icon={RedIcon}>
               <Popup>จุดเกิดเหตุ (คุณอยู่ที่นี่)</Popup>
             </Marker>

             {/* Rescuer Location */}
             {rescuerLoc && (
               <Marker position={[rescuerLoc.lat, rescuerLoc.lng]} icon={BlueIcon}>
                 <Popup>รถกู้ภัยกำลังมา</Popup>
               </Marker>
             )}

             <RoutingMachine citizen={[parseFloat(lat), parseFloat(lng)]} rescuer={rescuerLoc} />
          </MapContainer>
        </div>

        {/* Chat / Call Drawer */}
        <div className="glass-panel" style={{ height: '40vh', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
           <div style={{ padding: '15px', display: 'flex', justifyContent: 'space-around', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <button disabled className="btn" style={{ flex: 1, background: '#3b82f6', color: '#fff', marginRight: '10px' }}>📞 Call Rescuer</button>
              <div style={{ flex: 1, color: '#94a3b8', textAlign: 'center', lineHeight: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                Chat 💬
              </div>
           </div>
           <div style={{ flex: 1, padding: '15px', overflowY: 'auto' }}>
              {chatMessages.map((m, i) => (
                <div key={i} style={{ marginBottom: '10px', textAlign: m.sender === 'Citizen' ? 'right' : 'left' }}>
                  <span style={{ display: 'inline-block', padding: '8px 12px', borderRadius: '15px', background: m.sender === 'Citizen' ? '#ef4444' : '#3b82f6', color: '#fff' }}>
                    {m.message}
                  </span>
                </div>
              ))}
           </div>
           <div style={{ padding: '10px 15px', display: 'flex', gap: '10px' }}>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="พิมพ์ข้อความถึงกู้ภัย..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: 'none', outline: 'none' }} />
              <button onClick={sendMessage} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '20px', padding: '0 20px', cursor: 'pointer' }}>ส่ง</button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px', background: '#0f172a' }}>
      <div className="glass-panel animate-slide-up" style={{ maxWidth: '500px', width: '100%', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <h1 className="text-gradient" style={{ textAlign: 'center', marginBottom: '10px' }}>🚨 เรียกกู้ภัยด่วน</h1>
        <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '40px' }}>ระบบจะค้นหารถกู้ภัยที่ใกล้ที่สุดและจ่ายงานทันที</p>
        
        <input 
            type="tel"
            value={citizenPhone} 
            onChange={(e)=>setCitizenPhone(e.target.value)} 
            placeholder="เบอร์โทรศัพท์ติดต่อกลับ (Phone)"
            style={{ width: '100%', padding: '15px', marginBottom: '20px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '18px', textAlign: 'center' }}
        />

        <textarea 
            value={details} 
            onChange={(e)=>setDetails(e.target.value)} 
            placeholder="รายละเอียด (ถ้ามี) เช่น รถชนคนบาดเจ็บ..."
            style={{ width: '100%', height: '80px', padding: '15px', marginBottom: '40px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.5)', color: '#fff' }}
        />

        {/* MASSIVE SOS BUTTON */}
        <div style={{ position: 'relative', width: '250px', height: '250px', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: '30px' }}>
            <div style={{
                position: 'absolute', bottom: 0, left: 0, width: '100%', height: `${holdProgress}%`,
                background: 'rgba(239, 68, 68, 0.3)', borderRadius: '50%', transition: 'height 0.1s linear'
            }}></div>
            <button 
                onMouseDown={startHold} onMouseUp={stopHold} onMouseLeave={stopHold}
                onTouchStart={startHold} onTouchEnd={stopHold}
                style={{
                  width: '200px', height: '200px', borderRadius: '50%', background: isHolding ? '#dc2626' : '#ef4444',
                  boxShadow: isHolding ? '0 0 50px rgba(239, 68, 68, 0.8)' : '0 10px 25px rgba(0,0,0,0.5)',
                  border: '8px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: '32px', fontWeight: 'bold',
                  cursor: 'pointer', zIndex: 10, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
                  transform: isHolding ? 'scale(0.95)' : 'scale(1)', transition: 'all 0.2s', userSelect: 'none'
                }}
            >
              <span>SOS</span>
              <span style={{ fontSize: '14px', fontWeight: 'normal', marginTop: '10px' }}>กดค้าง 5 วินาที</span>
            </button>
        </div>

        <Link to="/login" style={{ textDecoration: 'none', color: '#64748b', fontSize: '14px' }}>
          Staff Login (Driver Companion)
        </Link>
      </div>
    </div>
  );
}

function RoutingMachine({ citizen, rescuer }) {
  const map = useMap();
  const routingControlRef = useRef(null);

  useEffect(() => {
    if (!citizen || !rescuer) return;

    if (!routingControlRef.current) {
      routingControlRef.current = L.Routing.control({
        waypoints: [
          L.latLng(rescuer.lat, rescuer.lng),
          L.latLng(citizen[0], citizen[1])
        ],
        lineOptions: { styles: [{ color: '#10b981', weight: 6, opacity: 0.9 }] },
        createMarker: () => null, show: false, addWaypoints: false,
      }).addTo(map);
    } else {
      routingControlRef.current.setWaypoints([
        L.latLng(rescuer.lat, rescuer.lng),
        L.latLng(citizen[0], citizen[1])
      ]);
    }
  }, [citizen[0], citizen[1], rescuer?.lat, rescuer?.lng, map]);

  useEffect(() => {
    return () => { if (routingControlRef.current) map.removeControl(routingControlRef.current); };
  }, [map]);

  return null;
}

export default CitizenSOS;
