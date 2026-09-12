import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';
import liff from '@line/liff';
import { Brand, ConnectionStatus, DemoNotice } from './RescueUI';
import { API_URL } from './config';
import { readIncident, persistPendingIncident, recoverIncident } from './incidentSession';


const iconBaseOpts = { shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] };
const RedIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' });
const BlueIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' });

const LIFF_ID = import.meta.env.VITE_LIFF_ID || '2009894409-w2sSn3rf';
const socket = io(API_URL, { autoConnect: false });

function CitizenSOS() {
  const [details, setDetails] = useState('');
  const [citizenPhone, setCitizenPhone] = useState('');
  const citizenSessionRef = useRef(null);
  const submittingRef = useRef(false);
  const [lat, setLat] = useState('13.7563');
  const [lng, setLng] = useState('100.5018');
  const [isInLine, setIsInLine] = useState(false);

  // Registration Modal State
  const [showRegister, setShowRegister] = useState(false);
  const [registerPhoneInput, setRegisterPhoneInput] = useState('');
  const chatEndRef = useRef(null);

  // SOS Hold Logic
  const [isHolding, setIsHolding] = useState(false);
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimerRef = useRef(null);
  const progressTimerRef = useRef(null);

  // Tracking Screen State
  const [activeIncident, setActiveIncident] = useState(() => { const saved = readIncident(localStorage); return saved && saved.status !== 'Pending' ? saved : null; });
  const [rescuerLoc, setRescuerLoc] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isSearching, setIsSearching] = useState(() => readIncident(localStorage)?.status === 'Pending');
  const [searchingIncidentId, setSearchingIncidentId] = useState(() => { const saved = readIncident(localStorage); return saved?.status === 'Pending' ? saved.id : null; });
  const [routeInfo, setRouteInfo] = useState(null); // ETA
  const mapRef = useRef(null);

  const fetchChatHistory = useCallback(async (incidentId, token) => {
    try {
      const res = await axios.get(`${API_URL}/api/citizen/incidents/${incidentId}/chat`, { params: { token } });
      setChatMessages(res.data);
    } catch (e) {
      console.error("Failed to fetch chat history", e);
    }
  }, []);

  const syncIncident = useCallback(async () => {
    const saved = readIncident(localStorage);
    if (!saved) return;
    socket.emit('join_incident_room', { incident_id: saved.id, citizen_token: saved.citizen_token });
    try {
      const incident = await recoverIncident(localStorage, async (id, token) => {
        const res = await axios.get(`${API_URL}/api/incidents/status/${id}`, { params: { token } });
        return res.data;
      });
      setIsSearching(incident?.status === 'Pending');
      setSearchingIncidentId(incident?.status === 'Pending' ? incident.id : null);
      setActiveIncident(incident && incident.status !== 'Pending' ? incident : null);
      if (incident?.status === 'Accepted') await fetchChatHistory(incident.id, incident.citizen_token);
    } catch (error) {
      console.error('Incident sync deferred until connection recovers', error.message);
    }
  }, [fetchChatHistory]);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        setLat(pos.coords.latitude.toString());
        setLng(pos.coords.longitude.toString());
      });
    }

    const handleLiffAuth = () => {
        setIsInLine(true);
        if (liff.isLoggedIn()) {
          liff.getProfile().then(profile => {
            axios.post(`${API_URL}/api/citizen/auth`, { id_token: liff.getIDToken() })
              .then(res => {
                citizenSessionRef.current = res.data.citizen_token;
                if (res.data.phone) {
                  setCitizenPhone(res.data.phone);
                  toast.success(`สวัสดีคุณ ${profile.displayName} ระบบดึงเบอร์โทรของคุณมาให้อัตโนมัติแล้ว!`);
                } else {
                  // If no phone is registered, enforce registration
                  setShowRegister(true);
                }
              }).catch(() => toast.error('ยืนยันตัวตน LINE ไม่สำเร็จ กรุณาเปิดแอปใหม่เพื่อลองอีกครั้ง'));
          });
        } else {
          // ถ้าเปิดในบราวเซอร์ปกติ แล้วยังไม่ได้ล็อกอิน ให้เด้งไปหน้าล็อกอินของ LINE
          liff.login();
        }
    };

    // Initialize LINE LIFF
    liff.init({ liffId: LIFF_ID })
      .then(() => {
        if (!liff.isInClient() && !liff.isLoggedIn()) {
            setIsInLine(false);
            return;
        }
        handleLiffAuth();
      })
      .catch(err => console.error("LIFF Init failed", err));

    // Socket listeners for Tracking Mode
    socket.on('vehicle_location_updated', (data) => {
      setRescuerLoc({ lat: data.latitude, lng: data.longitude });
    });

    socket.on('new_chat_message', (msg) => {
      setChatMessages(prev => {
        if (msg.clientId && prev.some(m => m.clientId === msg.clientId)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('mission_completed', () => {
        toast.success("🚑 กู้ภัยความช่วยเหลือเสร็จสิ้นแล้ว! ขอบคุณที่ใช้บริการครับ");
        setActiveIncident(null);
        setIsSearching(false);
        setSearchingIncidentId(null);
        setRescuerLoc(null);
        setChatMessages([]);
        localStorage.removeItem('activeCitizenIncident');
    });

    socket.on('driver_assigned', () => {
        toast.success('✅ กู้ภัยกดรับงานแล้ว! ติดตามรถได้เลย');
        void syncIncident();
    });

    socket.on('no_drivers', () => {
        toast.error("❌ ไม่สามารถหารถกู้ภัยที่ว่างในขณะนี้ได้ โปรดโทร 1669");
        setIsSearching(false);
        setSearchingIncidentId(null);
        setActiveIncident(null);
        localStorage.removeItem('activeCitizenIncident');
    });

    socket.on('connect', syncIncident);
    socket.connect();
    const retry = setInterval(syncIncident, 10000);
    void syncIncident();

    return () => {
      socket.off('vehicle_location_updated');
      socket.off('new_chat_message');
      socket.off('mission_completed');
      socket.off('driver_assigned');
      socket.off('no_drivers');
      socket.off('connect', syncIncident);
      clearInterval(retry);
      clearTimeout(holdTimerRef.current);
      clearInterval(progressTimerRef.current);
      socket.disconnect();
    };
  }, [syncIncident]);

  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // --------------- SOS HOLD LOGIC ---------------
  function startHold() {
    if (!isInLine || isHolding || submittingRef.current) return;
    if (!citizenPhone.trim()) {
      toast.warning('กรุณากรอกเบอร์โทรศัพท์ก่อนกดแจ้งเหตุ (Phone Number Required)');
      document.getElementById('citizen-phone')?.focus();
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

  const handleRegisterPhone = async (e) => {
      e.preventDefault();
      if (!/^0\d{8,9}$/.test(registerPhoneInput)) {
          toast.error('กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก)');
          return;
      }
      try {
          await axios.post(`${API_URL}/api/citizen/register-phone`, { phone: registerPhoneInput }, { headers: { Authorization: `Bearer ${citizenSessionRef.current}` } });
          setCitizenPhone(registerPhoneInput);
          setShowRegister(false);
          toast.success('ลงทะเบียนเบอร์โทรสำเร็จ! คุณสามารถกดแจ้งเหตุฉุกเฉินได้ทันที');
      } catch (e) {
          toast.error('การลงทะเบียนผิดพลาด: ' + e.message);
      }
  };

  function stopHold() {
    setIsHolding(false);
    setHoldProgress(0);
    clearTimeout(holdTimerRef.current);
    clearInterval(progressTimerRef.current);
  };

  async function submitSOS() {
    if (submittingRef.current || readIncident(localStorage)) return;
    submittingRef.current = true;
    try {
      toast.info('🔍 กำลังค้นหารถกู้ภัยที่ใกล้ที่สุดให้คุณ...');
      setIsSearching(true);
      const res = await axios.post(`${API_URL}/api/incidents`, {
        details, latitude: parseFloat(lat), longitude: parseFloat(lng), citizen_phone: citizenPhone
      });
      persistPendingIncident(localStorage, res.data);
      setSearchingIncidentId(res.data.incident_id);

      // Join the private socket room to wait for driver_assigned matching event!
      socket.emit('join_incident_room', { incident_id: res.data.incident_id, citizen_token: res.data.citizen_token });
      void syncIncident();

    } catch (e) {
      toast.error('❌ ค้นหาล้มเหลว: ' + (e.response?.data?.error || 'เซิร์ฟเวอร์มีปัญหา'));
      setIsSearching(false);
    } finally { submittingRef.current = false; }
  }

  // --------------- CHAT LOGIC ---------------
  const sendMessage = () => {
    if (!chatInput.trim() || !activeIncident) return;
    const clientId = Math.random().toString(36).substring(7);
    const msg = {
      incident_id: activeIncident.id,
      sender: 'Citizen',
      message: chatInput,
      timestamp: new Date(),
      clientId,
      citizen_token: activeIncident.citizen_token
    };
    
    // Optimistic update
    setChatMessages(prev => [...prev, msg]);
    
    socket.emit('send_chat_message', msg);
    setChatInput('');
  };

  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        socket.emit('send_chat_message', {
             incident_id: activeIncident.id,
             sender: 'Citizen',
             message: '📸 ส่งรูปภาพประกอบ',
             image: event.target.result,
             citizen_token: activeIncident.citizen_token
        });
    };
    reader.readAsDataURL(file);
  };

  // --------------- UI RENDERS ---------------
  if (activeIncident) {
    return (
      <div className="mission-screen" style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0f172a' }}><div className="mission-brand"><Brand subtitle="ติดตามความช่วยเหลือ" /><ConnectionStatus socket={socket} /></div>
        <div style={{ padding: '20px', background: 'rgba(255,255,255,0.1)', color: '#fff', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 5px 0' }}>🚨 {activeIncident.driver_name ? `กู้ภัยคุณ ${activeIncident.driver_name} กำลังเดินทางมา!` : 'กู้ภัยกำลังเดินทางมาหาคุณ!'}</h2>
          <p style={{ margin: '5px 0', color: '#10b981', fontWeight: 'bold' }}>
              {routeInfo ? `ระยะทาง ${(routeInfo.totalDistance/1000).toFixed(1)} กม. | คาดว่าจะถึงใน ${Math.ceil(routeInfo.totalTime/60)} นาที` : 'กำลังคำนวณระยะทาง...'}
          </p>
          {activeIncident.driver_phone && <p style={{ margin: 0, fontSize: '14px', color: '#94a3b8' }}>เบอร์โทร: {activeIncident.driver_phone}</p>}
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

             <RoutingMachine citizen={[parseFloat(lat), parseFloat(lng)]} rescuer={rescuerLoc} setRouteInfo={setRouteInfo} />
          </MapContainer>
        </div>

        {/* Chat / Call Drawer */}
        <div className="glass-panel" style={{ height: '40vh', borderTopLeftRadius: '20px', borderTopRightRadius: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
           <div style={{ padding: '15px', display: 'flex', justifyContent: 'space-around', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
              <a href={activeIncident.driver_phone ? `tel:${activeIncident.driver_phone}` : '#'} className="btn" style={{ flex: 1, background: '#3b82f6', color: '#fff', marginRight: '10px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞 โทรหากู้ภัย</a>
              <div style={{ flex: 1, color: '#94a3b8', textAlign: 'center', lineHeight: '40px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                Chat 💬
              </div>
           </div>
           <div style={{ flex: 1, padding: '15px', overflowY: 'auto', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column' }}>
              {chatMessages.map((m, i) => {
                 const isMe = m.sender === 'Citizen';
                 const isSystem = m.sender === 'System';
                 const align = isSystem ? 'center' : (isMe ? 'flex-end' : 'flex-start');
                 const bgColor = isSystem ? 'rgba(71, 85, 105, 0.6)' : (isMe ? 'linear-gradient(135deg, #10b981, #059669)' : 'linear-gradient(135deg, #3b82f6, #2563eb)');
                 const senderName = isSystem ? '' : (isMe ? '' : (m.sender.startsWith('Staff:') ? m.sender.replace('Staff:', 'กู้ภัย: ') : 'เจ้าหน้าที่กู้ภัย'));
                 const timeStr = m.timestamp ? new Date(m.timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';

                 return (
                   <div key={i} style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', alignItems: align }}>
                     {!isMe && !isSystem && <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px', marginLeft: '8px', fontWeight: 'bold' }}>{senderName}</div>}
                     <div style={{ 
                         display: 'inline-block', 
                         padding: '10px 14px', 
                         borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px', 
                         background: bgColor, 
                         color: '#fff', 
                         fontSize: isSystem ? '13px' : '15px',
                         boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
                         maxWidth: '85%',
                         lineHeight: '1.4'
                     }}>
                       {m.message}
                       {m.image && <><br/><img src={m.image} alt="evidence" style={{ maxWidth: '180px', borderRadius: '8px', cursor: 'pointer', marginTop: '8px', border: '1px solid rgba(255,255,255,0.2)' }} onClick={()=>window.open(m.image)}/></>}
                       {!isSystem && <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.6)', marginTop: '4px', textAlign: 'right' }}>{timeStr}</div>}
                     </div>
                   </div>
                 );
              })}
              <div ref={chatEndRef} />
           </div>
           <div style={{ padding: '10px 15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
              <label style={{ cursor: 'pointer', background: 'rgba(255,255,255,0.1)', padding: '10px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  📷<input type="file" accept="image/*" onChange={handleImageSelect} style={{ display: 'none' }} />
              </label>
              <input value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()} placeholder="พิมพ์ข้อความ..." style={{ flex: 1, padding: '10px', borderRadius: '20px', border: 'none', outline: 'none' }} />
              <button onClick={sendMessage} style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '20px', padding: '0 20px', cursor: 'pointer' }}>ส่ง</button>
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="citizen-page">
      <header className="citizen-header"><Brand /><ConnectionStatus socket={socket} /></header>
      <main className="citizen-layout">
        <section className="citizen-intro">
          <span className="eyebrow">อุ่นใจ ในทุกการเดินทาง</span>
          <h1>ความช่วยเหลือ<br />เริ่มต้นที่<span>คุณ</span></h1>
          <p>แจ้งรายละเอียด แชร์ตำแหน่ง และติดตามทีมกู้ภัย<br className="desktop-only" />ในที่เดียว ผ่าน LINE ของคุณ</p>
          <div className="rescue-illustration" aria-hidden="true"><div className="route-line" /><span className="map-pin">+</span><div className="ambulance"><span>RESCUE</span><b>+</b><i /><i /></div><span className="illustration-label">พร้อมเชื่อมต่อความช่วยเหลือ</span></div>
          <div className="steps"><div><b>01</b><span>ระบุข้อมูล</span></div><div><b>02</b><span>กดค้างเพื่อแจ้งเหตุ</span></div><div><b>03</b><span>ติดตามและพูดคุย</span></div></div>
        </section>
        <section className="sos-card" aria-labelledby="sos-title">
          <div className="card-heading"><span className="eyebrow">ขอความช่วยเหลือ</span><span className="small-tag">SOS</span></div>
          <h2 id="sos-title">แจ้งเหตุให้ทีมกู้ภัย</h2>
          <p className="muted">กรอกข้อมูลติดต่อก่อนกดปุ่มด้านล่าง</p>
          <DemoNotice />
          {new URLSearchParams(window.location.search).get('view') === 'tracking' && !readIncident(localStorage) && <p className="tracking-empty" role="status">ยังไม่มีเคสที่กำลังติดตามบนอุปกรณ์นี้ เมื่อแจ้งเหตุแล้ว สถานะจะปรากฏที่นี่</p>}
          <label className="field-label" htmlFor="citizen-phone">เบอร์โทรศัพท์ติดต่อกลับ</label>
          <input id="citizen-phone" type="tel" inputMode="tel" autoComplete="tel" value={citizenPhone} onChange={e=>setCitizenPhone(e.target.value)} placeholder="เช่น 081 234 5678" />
          <label className="field-label" htmlFor="incident-details">เกิดอะไรขึ้น <span>ไม่บังคับ</span></label>
          <textarea id="incident-details" value={details} onChange={e=>setDetails(e.target.value)} placeholder="เล่าอาการ จุดสังเกต หรือรายละเอียดที่ทีมควรรู้" rows={3} />
          {!isInLine && <a className="line-entry" href={`https://liff.line.me/${LIFF_ID}`}>เปิดใน LINE เพื่อแจ้งเหตุ ↗</a>}
          <div className="sos-ring" style={{ '--progress': `${holdProgress * 3.6}deg` }}>
            <button disabled={!isInLine} className="sos-trigger" aria-label="กดค้าง 5 วินาทีเพื่อแจ้งเหตุ" onPointerDown={e=>{ e.currentTarget.setPointerCapture(e.pointerId); startHold(); }} onPointerUp={stopHold} onPointerCancel={stopHold} onLostPointerCapture={stopHold}
              onKeyDown={e=>{ if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); startHold(); } }} onKeyUp={e=>{ if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); stopHold(); } }} onBlur={stopHold}>
              <strong>SOS</strong><span>{isHolding ? `กำลังยืนยัน ${Math.min(5, Math.floor(holdProgress / 20))}/5` : 'กดค้าง 5 วินาที'}</span>
            </button>
          </div>
          <p className="hold-hint">ปล่อยปุ่มก่อนครบเวลาเพื่อยกเลิก</p>
          <div className="citizen-links"><Link to="/login">เข้าสู่ระบบเจ้าหน้าที่ <span>↗</span></Link><Link to="/register">สมัครเป็นกู้ภัย <span>↗</span></Link></div>
        </section>
      </main>
      <footer className="citizen-footer">RESCUE CONNECT <span>เชื่อมคุณกับทีมช่วยเหลือ</span></footer>
      {isSearching && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(15, 23, 42, 0.95)', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
            <div style={{ width: '80px', height: '80px', background: '#10b981', borderRadius: '50%', marginBottom: '20px', boxShadow: '0 0 30px #10b981' }}></div>
            <h2 style={{ color: '#10b981', textAlign: 'center' }}>{searchingIncidentId ? 'ส่งคำขอแล้ว กำลังค้นหาทีมกู้ภัย' : 'กำลังส่งคำขอ กรุณารอสักครู่'}</h2>
            <p style={{ color: '#94a3b8', textAlign: 'center', margin: '10px 20px' }}>{searchingIncidentId ? 'ยังไม่มีทีมตอบรับในขณะนี้ ระบบจะอัปเดตให้อัตโนมัติเมื่อมีเจ้าหน้าที่รับงาน' : 'กำลังเชื่อมต่อเพื่อบันทึกคำขอ ระบบยังไม่ได้ยืนยันการรับแจ้ง'}</p>
            {searchingIncidentId && <p style={{ fontSize: '14px', color: '#475569' }}>(Tracking ID: #{searchingIncidentId})</p>}
        </div>
      )}

      {/* REGISTRATION MODAL */}
      {showRegister && (
          <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(15, 23, 42, 0.98)', color: 'white', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
              <div className="glass-panel animate-slide-up" style={{ width: '90%', maxWidth: '400px', padding: '30px', borderRadius: '15px', textAlign: 'center' }}>
                  <h2 style={{ color: '#10b981', margin: '0 0 15px 0' }}>📱 ลงทะเบียนครั้งแรก</h2>
                  <p style={{ color: '#94a3b8', marginBottom: '20px', fontSize: '14px' }}>เพื่อความรวดเร็วในการติดต่อกลับยามฉุกเฉิน กรุณาระบุเบอร์โทรศัพท์ของคุณ (ระบบจะจำไว้สำหรับการใช้งานครั้งต่อไป)</p>
                  
                  <form onSubmit={handleRegisterPhone}>
                      <input 
                          type="tel"
                          value={registerPhoneInput}
                          onChange={(e) => setRegisterPhoneInput(e.target.value.replace(/\D/g, ''))}
                          placeholder="เบอร์โทรศัพท์ (เช่น 0812345678)"
                          style={{ width: '100%', padding: '15px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.5)', color: '#fff', fontSize: '18px', textAlign: 'center', marginBottom: '20px' }}
                          required
                          maxLength="10"
                      />
                      <button type="submit" style={{ width: '100%', background: '#10b981', color: 'white', border: 'none', padding: '15px', borderRadius: '8px', fontSize: '18px', fontWeight: 'bold', cursor: 'pointer' }}>
                          บันทึกข้อมูลและเข้าสู่ระบบ
                      </button>
                  </form>
              </div>
          </div>
      )}

    </div>
  );
}

function RoutingMachine({ citizen, rescuer, setRouteInfo }) {
  const map = useMap();
  const routingControlRef = useRef(null);

  const citizenLat = citizen?.[0], citizenLng = citizen?.[1];
  const rescuerLat = rescuer?.lat, rescuerLng = rescuer?.lng;
  useEffect(() => {
    if (citizenLat == null || citizenLng == null || rescuerLat == null || rescuerLng == null) return;

    if (!routingControlRef.current) {
      routingControlRef.current = L.Routing.control({
        waypoints: [
          L.latLng(rescuerLat, rescuerLng),
          L.latLng(citizenLat, citizenLng)
        ],
        lineOptions: { styles: [{ color: '#10b981', weight: 6, opacity: 0.9 }] },
        createMarker: () => null, show: false, addWaypoints: false,
      }).addTo(map);

      routingControlRef.current.on('routesfound', function(e) {
          if(e.routes && e.routes[0]) {
             setRouteInfo(e.routes[0].summary);
          }
      });
    } else {
      routingControlRef.current.setWaypoints([
        L.latLng(rescuerLat, rescuerLng),
        L.latLng(citizenLat, citizenLng)
      ]);
    }
  }, [citizenLat, citizenLng, rescuerLat, rescuerLng, map, setRouteInfo]);

  useEffect(() => {
    return () => { if (routingControlRef.current) map.removeControl(routingControlRef.current); };
  }, [map]);

  return null;
}

export default CitizenSOS;
