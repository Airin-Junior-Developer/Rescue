import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { toast } from 'react-toastify';
import { API_URL } from './config';


function HeatmapLayer({ data }) {
  const map = useMap();
  useEffect(() => {
    if (!data || data.length === 0) return;
    let heat;
    let isMounted = true;
    const initHeatmap = async () => {
        window.L = L;
        await import('leaflet.heat');
        if (!isMounted) return;
        const points = data.map(p => [parseFloat(p.latitude), parseFloat(p.longitude), 1]);
        heat = L.heatLayer(points, {
          radius: 25,
          blur: 15,
          maxZoom: 17,
          gradient: { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1.0: 'red' }
        }).addTo(map);
    };
    initHeatmap();

    return () => {
      isMounted = false;
      if (heat) map.removeLayer(heat);
    };
  }, [map, data]);
  return null;
}


const iconBaseOpts = { shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] };
const RedIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' });
const BlueIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' });

function AdminDashboard({ user, onLogout }) {
  const [incidents, setIncidents] = useState([]);
  const [rescuers, setRescuers] = useState([]);
  const [history, setHistory] = useState([]);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [avgTime, setAvgTime] = useState(0);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [lineBroadcastMsg, setLineBroadcastMsg] = useState('');
  const [prankStats, setPrankStats] = useState([]);

  // Management Modal State
  const [showManageModal, setShowManageModal] = useState(false);
  const [foundations, setFoundations] = useState([]);
  const [newFoundation, setNewFoundation] = useState({ name: '', contact_info: '' });
  const [newRescuer, setNewRescuer] = useState({ username: '', password: '', phone: '', foundation_id: '' });
  const [pendingRescuers, setPendingRescuers] = useState([]);

  // Cancel Modal State
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelIncidentId, setCancelIncidentId] = useState(null);
  const [cancelReason, setCancelReason] = useState('สถานการณ์ปลอดภัยแล้ว');

  const fetchFoundations = async () => {
     try {
         const res = await axios.get(`${API_URL}/api/admin/foundations`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         setFoundations(res.data);
     } catch (e) { console.error("Failed to fetch foundations", e); }
  };

  const fetchPendingRescuers = async () => {
      try {
          const res = await axios.get(`${API_URL}/api/admin/rescuers/pending`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
          setPendingRescuers(res.data);
      } catch (e) { console.error("Failed to fetch pending rescuers", e); }
  };

  const openManageModal = () => {
      setShowManageModal(true);
      fetchFoundations();
      fetchPendingRescuers();
  };

  const handleAddFoundation = async (e) => {
      e.preventDefault();
      try {
          await axios.post(`${API_URL}/api/admin/foundations`, newFoundation, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
          toast.success("เพิ่มมูลนิธิเรียบร้อยแล้ว");
          setNewFoundation({ name: '', contact_info: '' });
          fetchFoundations(); // refresh list
      } catch (e) { toast.error("Fail: " + (e.response?.data?.error || e.message)); }
  };

  const handleAddRescuer = async (e) => {
      e.preventDefault();
      try {
          await axios.post(`${API_URL}/api/admin/rescuers`, newRescuer, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
          toast.success("เพิ่มบัญชีกู้ภัยเรียบร้อยแล้ว");
          setNewRescuer({ username: '', password: '', phone: '', foundation_id: '' });
      } catch (e) { toast.error("Fail: " + (e.response?.data?.error || e.message)); }
  };

  const handleCSVUpload = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
          const text = event.target.result;
          const lines = text.split('\n').map(l => l.trim()).filter(l => l);
          if (lines.length === 0) return;
          const startIndex = lines[0].toLowerCase().includes('username') ? 1 : 0;
          const rescuers = [];
          for (let i = startIndex; i < lines.length; i++) {
              const cols = lines[i].split(',').map(c => c.trim());
              if (cols.length >= 4) rescuers.push({ username: cols[0], password: cols[1], phone: cols[2], foundation_id: cols[3] });
          }
          if (rescuers.length === 0) return toast.error("ไม่มีข้อมูลที่ใช้ได้ หรือฟอร์แมต CSV ผิด");
          try {
              const res = await axios.post(`${API_URL}/api/admin/rescuers/bulk`, { rescuers }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
              toast.success(res.data.message || `อัปโหลดสำเร็จ`);
              e.target.value = null;
          } catch(err) { toast.error("Bulk Upload Error: " + (err.response?.data?.error || err.message)); }
      };
      reader.readAsText(file);
  };

  const downloadTemplate = () => {
      const csvContent = "data:text/csv;charset=utf-8,\uFEFFusername,password,phone,foundation_id\ndriver01,123456,0811111111,1\ndriver02,123456,0822222222,1";
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", "rescuer_template.csv");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleApprove = async (id) => {
      try {
          await axios.post(`${API_URL}/api/admin/rescuers/${id}/approve`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
          toast.success("อนุมัติบัญชีสำเร็จ");
          fetchPendingRescuers();
      } catch (e) { toast.error("Fail: " + (e.response?.data?.error || e.message)); }
  };

  const handleReject = async (id) => {
      if(!window.confirm("คุณแน่ใจหรือไม่ที่จะปฏิเสธและลบบัญชีนี้?")) return;
      try {
          await axios.post(`${API_URL}/api/admin/rescuers/${id}/reject`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
          toast.info("ปฏิเสธคำขอแล้ว");
          fetchPendingRescuers();
      } catch (e) { toast.error("Fail: " + (e.response?.data?.error || e.message)); }
  };

  useEffect(() => {
     fetchStatus();
     fetchPendingRescuers();
     const interval = setInterval(() => {
         fetchStatus();
         fetchPendingRescuers();
     }, 3000);
     return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/admin/system-status`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setIncidents(res.data.incidents || []);
      setRescuers(res.data.rescuers || []);
      setHistory(res.data.history || []);
      setAvgTime(res.data.avgResponseTimeSec || 0);
      setPrankStats(res.data.prank_stats || []);
    } catch(e) { }
  };

  const openCancelModal = (id) => {
      setCancelIncidentId(id);
      setCancelReason('สถานการณ์ปลอดภัยแล้ว');
      setShowCancelModal(true);
  };

  const confirmCancelIncident = async () => {
     if (!cancelIncidentId) return;

     try {
         await axios.post(`${API_URL}/api/admin/incidents/${cancelIncidentId}/cancel`, { reason: cancelReason }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         toast.success("ยกเลิกเหตุการณ์และบันทึกเหตุผลเรียบร้อย");
         setShowCancelModal(false);
         setCancelIncidentId(null);
         fetchStatus();
     } catch (e) {
         let errMsg = "SERVER CRASH";
         if (e.response && e.response.data && e.response.data.error) {
             errMsg = e.response.data.error; // Full stack trace!
         } else {
             errMsg = e.message;
         }
         console.error("FULL CANCEL ERROR:", e.response?.data || e);
         toast.error("FAIL: " + errMsg, { autoClose: false }); // keep open infinitely
     }
  };

  const sendBroadcast = async () => {
     if(!broadcastMsg.trim()) return;
     try {
         await axios.post(`${API_URL}/api/admin/broadcast`, { message: broadcastMsg }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         toast.success("📢 ประกาศกระจายให้รถกู้ภัยทุกคันแล้ว!");
         setBroadcastMsg('');
     } catch (e) { toast.error("Fail to broadcast: " + e.message); }
  };

  const sendLineBroadcast = async () => {
     if(!lineBroadcastMsg.trim()) return;
     try {
         await axios.post(`${API_URL}/api/admin/line-broadcast`, { message: lineBroadcastMsg }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         toast.success("📱 ส่งข่าวสารผ่าน LINE OA เรียบร้อยแล้ว!");
         setLineBroadcastMsg('');
     } catch (e) { toast.error("Fail to send LINE broadcast: " + (e.response?.data?.error || e.message)); }
  };

  const exportToCSV = () => {
      const headers = ["ID", "Status", "Details", "Citizen Phone", "Assigned Unit", "Response Time (Seconds)", "Created At", "Resolved At"];
      const rows = history.map(h => {
          let rTime = 0;
          if (h.accepted_at && h.created_at) rTime = ((new Date(h.accepted_at) - new Date(h.created_at))/1000).toFixed(1);
          return [h.id, h.status, `"${h.details.replace(/"/g, '""')}"`, h.citizen_phone, h.assigned_user_id || 'N/A', rTime, new Date(h.created_at).toLocaleString(), h.resolved_at ? new Date(h.resolved_at).toLocaleString() : 'N/A'];
      });
      const csvContent = "data:text/csv;charset=utf-8,\uFEFF" + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement("a");
      link.setAttribute("href", encodedUri);
      link.setAttribute("download", `Rescue_Export_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0f172a', color: 'white', fontFamily: 'sans-serif' }}>
      <header style={{ padding: '15px 30px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
         <div>
            <h1 className="text-gradient" style={{ margin: 0, fontSize: '24px' }}>🛡️ ศูนย์บัญชาการกู้ภัย (God View)</h1>
            <p style={{ margin: 0, color: '#94a3b8' }}>Admin mode: {user.username}</p>
         </div>
         <div>
            <button onClick={openManageModal} style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', marginRight: '10px', fontWeight: 'bold' }}>⚙️ จัดการหน่วยกู้ภัย</button>
            <button onClick={onLogout} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Log Out</button>
         </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
         {/* LEFT MAP */}
         <div style={{ flex: 2, position: 'relative' }}>
             <button 
                 onClick={() => setShowHeatmap(!showHeatmap)} 
                 style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 1000, background: showHeatmap ? '#ef4444' : '#1e293b', color: 'white', border: `2px solid ${showHeatmap ? '#ef4444' : '#334155'}`, padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', transition: '0.3s' }}>
                 {showHeatmap ? '🔥 ปิดโหมด Heatmap' : '📊 เปิดโหมด Heatmap'}
             </button>
             
             <MapContainer center={[13.7563, 100.5018]} zoom={11} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
                
                {incidents.map((inc) => (
                    <Marker key={'inc'+inc.id} position={[inc.latitude, inc.longitude]} icon={RedIcon}>
                        <Popup>
                            <strong>🚨 SOS Case #{inc.id}</strong><br/>
                            Status: {inc.status}<br/>
                            Phone: {inc.citizen_phone}<br/>
                            Details: {inc.details}<br/>
                            Assigned to: {inc.assigned_user_id ? `Unit ${inc.assigned_user_id}` : 'Searching...'}
                        </Popup>
                    </Marker>
                ))}
                
                {rescuers.map((r) => (
                    <Marker key={'res'+r.id} position={[r.latitude, r.longitude]} icon={BlueIcon}>
                        <Popup>
                            <strong>🚑 {r.username || `Rescuer Unit #${r.id}`}</strong><br/>
                            Status: <span style={{color: r.status === 'available' ? 'green' : 'red'}}>{r.status}</span><br/>
                            Phone: {r.phone}
                        </Popup>
                    </Marker>
                ))}

                {/* Heatmap Layer for Resolved historical points */}
                {showHeatmap ? (
                    <HeatmapLayer data={history.filter(h => h.latitude && h.longitude)} />
                ) : (
                    history.filter(h => h.latitude && h.longitude).map(h => (
                         <CircleMarker key={'heat'+h.id} center={[h.latitude, h.longitude]} radius={15} pathOptions={{ color: 'transparent', fillColor: h.status === 'Resolved' ? '#ef4444' : '#64748b', fillOpacity: 0.15 }}>
                             <Popup>Incident #{h.id} ({h.status})</Popup>
                         </CircleMarker>
                    ))
                )}
             </MapContainer>
         </div>

         {/* RIGHT DASHBOARD DATA */}
         <div style={{ flex: 1, padding: '20px', background: '#1e293b', overflowY: 'auto' }}>
            <h2 style={{ color: '#10b981', borderBottom: '1px solid #334155', paddingBottom: '10px' }}>🚨 ข้อมูลเหตุฉุกเฉิน (Active Events)</h2>
            {incidents.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center' }}>ไม่มีเหตุฉุกเฉินในขณะนี้ ทุกอย่างปกติดี 🟢</p> : null}
            
            {incidents.map(inc => (
               <div key={inc.id} style={{ background: '#334155', borderRadius: '8px', padding: '15px', marginBottom: '15px' }}>
                   <h3 style={{ margin: '0 0 10px 0', color: inc.status === 'Pending' ? '#f59e0b' : '#3b82f6' }}>
                       Incident #{inc.id} <span style={{ fontSize: '14px', padding: '2px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '15px' }}>{inc.status}</span>
                   </h3>
                   <p style={{ margin: '5px 0', color: '#e2e8f0' }}>ผู้ติดต่อ: {inc.citizen_phone}</p>
                   <p style={{ margin: '5px 0', color: '#e2e8f0' }}>รถที่รับผิดชอบ: <strong style={{ color: '#10b981' }}>{inc.assigned_user_id ? `Unit ${inc.assigned_user_id}` : 'กำลังค้นหา...'}</strong></p>
                   <p style={{ margin: '5px 0', fontSize: '12px', color: '#94a3b8' }}>รายละเอียด: {inc.details}</p>
                   
                   <button onClick={() => openCancelModal(inc.id)} style={{ marginTop: '15px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '10px', borderRadius: '5px', cursor: 'pointer', width: '100%', fontWeight: 'bold' }}>
                       บังคับยกเลิกเหตุนี้ (Force Cancel)
                   </button>
               </div>
            ))}

            {/* BROADCAST CENTER (Urgent for Rescuers) */}
            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px', borderLeft: '4px solid #ef4444' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📢</span> แจ้งเตือนฉุกเฉิน (ถึงรถกู้ภัย)
                </h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input value={broadcastMsg} onChange={e=>setBroadcastMsg(e.target.value)} onKeyDown={e=> e.key === 'Enter' && sendBroadcast()} placeholder="พิมพ์ข้อความสั่งการรถกู้ภัย..." style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
                    <button onClick={sendBroadcast} className="btn" style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: '8px', padding: '0 20px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}>ยิงประกาศด่วน 🚀</button>
                </div>
            </div>

            {/* LINE OA BROADCAST (General News for Citizens) */}
            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px', borderLeft: '4px solid #10b981' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#10b981', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📱</span> แจ้งข่าวสาร LINE OA (ถึงประชาชน)
                </h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input value={lineBroadcastMsg} onChange={e=>setLineBroadcastMsg(e.target.value)} onKeyDown={e=> e.key === 'Enter' && sendLineBroadcast()} placeholder="พิมพ์ข่าวสารทั่วไป หรือพยากรณ์อากาศ..." style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
                    <button onClick={sendLineBroadcast} className="btn" style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: '8px', padding: '0 20px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}>ยิงข่าวสาร LINE 🚀</button>
                </div>
            </div>
            
            {/* ANALYTICS */}
            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                    <h3 style={{ color: '#f8fafc', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '20px' }}>📊</span> สถิติสรุป (Analytics)
                    </h3>
                    <button onClick={exportToCSV} className="btn" style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', border: '1px solid #10b981', padding: '6px 12px', fontSize: '12px', borderRadius: '6px', cursor: 'pointer' }}>
                        📥 โหลด CSV
                    </button>
                </div>
                
                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '15px', borderRadius: '8px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: '4px solid #10b981' }}>
                    <span style={{ color: '#94a3b8', fontSize: '14px' }}>เวลาตอบสนองเฉลี่ย (Response Time)</span>
                    <strong style={{ color: '#10b981', fontSize: '24px' }}>{avgTime}s</strong>
                </div>
                 
                 <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                     <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#1e293b', zIndex: 1 }}>
                           <tr>
                              <th style={{ color:'#94a3b8', textAlign:'left', padding: '10px' }}>เลขเคส</th>
                              <th style={{ color:'#94a3b8', textAlign:'left', padding: '10px' }}>สถานะ</th>
                              <th style={{ color:'#94a3b8', textAlign:'right', padding: '10px' }}>รถที่รับ</th>
                           </tr>
                        </thead>
                        <tbody>
                            {history.length === 0 ? <tr><td colSpan="3" style={{ textAlign: 'center', padding: '20px', color: '#64748b' }}>ยังไม่มีประวัติการช่วยเหลือ</td></tr> : null}
                            {history.slice(0, 15).map(h => (
                                <tr key={h.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '10px', color: '#e2e8f0', fontWeight: 'bold' }}>#{h.id}</td>
                                    <td style={{ padding: '10px' }}>
                                        <span style={{ background: h.status === 'Resolved' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)', color: h.status === 'Resolved' ? '#10b981' : '#ef4444', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 'bold' }}>
                                            {h.status.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style={{ padding: '10px', color: '#94a3b8', textAlign: 'right' }}>{h.assigned_user_id ? (h.assigned_username || `Unit ${h.assigned_user_id}`) : '-'}</td>
                                </tr>
                            ))}
                        </tbody>
                     </table>
                 </div>

                 {/* PRANK STATS */}
                 <h4 style={{ color: '#ef4444', marginTop: '20px', marginBottom: '10px' }}>⚠️ สถิติเบอร์โทรก่อกวน</h4>
                 <div style={{ maxHeight: '150px', overflowY: 'auto', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                     <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#1e293b', zIndex: 1 }}>
                           <tr>
                              <th style={{ color:'#94a3b8', textAlign:'left', padding: '10px' }}>เบอร์โทรศัพท์</th>
                              <th style={{ color:'#94a3b8', textAlign:'right', padding: '10px' }}>จำนวนครั้งที่ก่อกวน</th>
                           </tr>
                        </thead>
                        <tbody>
                            {prankStats.length === 0 ? <tr><td colSpan="2" style={{ textAlign: 'center', padding: '15px', color: '#64748b' }}>ไม่มีประวัติการก่อกวน</td></tr> : null}
                            {prankStats.map(ps => (
                                <tr key={ps.citizen_phone} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '10px', color: '#e2e8f0' }}>{ps.citizen_phone || 'Unknown'}</td>
                                    <td style={{ padding: '10px', color: '#ef4444', textAlign: 'right', fontWeight: 'bold' }}>{ps.count} ครั้ง</td>
                                </tr>
                            ))}
                        </tbody>
                     </table>
                 </div>
            </div>

            <h2 style={{ color: '#3b82f6', borderBottom: '1px solid #334155', paddingBottom: '10px', marginTop: '40px' }}>🚑 รถกู้ภัยในระบบ (Units Online)</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                {rescuers.map(r => (
                    <div key={r.id} style={{ padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', textAlign: 'center', borderTop: `4px solid ${r.status === 'available' ? '#10b981' : '#f59e0b'}` }}>
                        <h3 style={{ margin: '0 0 5px 0' }}>{r.username || `Unit #${r.id}`}</h3>
                        <p style={{ margin: 0, padding: '2px 8px', background: r.status === 'available' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: r.status === 'available' ? '#10b981' : '#f59e0b', borderRadius: '10px', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>{r.status.toUpperCase()}</p>
                    </div>
                ))}
            </div>
         </div>
      </div>

      {/* MANAGE MODAL */}
      {showManageModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#1e293b', padding: '30px', borderRadius: '12px', width: '500px', maxWidth: '90%', color: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #334155', paddingBottom: '15px', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0, color: '#3b82f6' }}>⚙️ จัดการระบบ (Admin Management)</h2>
                    <button onClick={() => setShowManageModal(false)} style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '24px', cursor: 'pointer' }}>&times;</button>
                </div>

                {/* Foundation Form */}
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#10b981' }}>🏢 เพิ่มมูลนิธิ/สังกัดใหม่</h3>
                    <form onSubmit={handleAddFoundation}>
                        <input value={newFoundation.name} onChange={e=>setNewFoundation({...newFoundation, name: e.target.value})} placeholder="ชื่อมูลนิธิ (เช่น ป่อเต็กตึ๊ง, ร่วมกตัญญู)" required style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        <input value={newFoundation.contact_info} onChange={e=>setNewFoundation({...newFoundation, contact_info: e.target.value})} placeholder="ข้อมูลติดต่อ (เช่น เบอร์สายด่วน, ที่อยู่)" style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        <button type="submit" style={{ width: '100%', background: '#10b981', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>+ สร้างมูลนิธิ</button>
                    </form>
                </div>

                {/* Rescuer Form */}
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#f59e0b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>🚑 เพิ่มบัญชีรถกู้ภัย</span>
                        <div>
                           <button onClick={downloadTemplate} style={{ background: 'transparent', color: '#3b82f6', border: '1px solid #3b82f6', padding: '4px 8px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', marginRight: '5px' }}>📥 โหลดแบบฟอร์ม CSV</button>
                           <label style={{ background: '#3b82f6', color: 'white', padding: '5px 10px', borderRadius: '4px', fontSize: '12px', cursor: 'pointer', display: 'inline-block' }}>
                               📤 อัปโหลด CSV รวดเดียว
                               <input type="file" accept=".csv" onChange={handleCSVUpload} style={{ display: 'none' }} />
                           </label>
                        </div>
                    </h3>
                    <form onSubmit={handleAddRescuer}>
                        <select value={newRescuer.foundation_id} onChange={e=>setNewRescuer({...newRescuer, foundation_id: e.target.value})} required style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}>
                            <option value="">-- เลือกมูลนิธิ/สังกัด --</option>
                            {foundations.map(f => (
                                <option key={f.id} value={f.id}>{f.name}</option>
                            ))}
                        </select>
                        <input value={newRescuer.username} onChange={e=>setNewRescuer({...newRescuer, username: e.target.value})} placeholder="Username (สำหรับให้คนขับใช้ Login)" required style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        <input value={newRescuer.password} onChange={e=>setNewRescuer({...newRescuer, password: e.target.value})} placeholder="Password" type="password" required style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        <input value={newRescuer.phone} onChange={e=>setNewRescuer({...newRescuer, phone: e.target.value})} placeholder="เบอร์โทรศัพท์รถกู้ภัยคันนี้" required style={{ width: '100%', padding: '10px', marginBottom: '10px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        <button type="submit" style={{ width: '100%', background: '#f59e0b', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>+ สร้างบัญชีกู้ภัยทีละ 1 คัน</button>
                    </form>
                </div>

                {/* Pending Approvals */}
                <div style={{ background: 'rgba(255,255,255,0.05)', padding: '20px', borderRadius: '8px' }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#10b981' }}>⏱️ รอการอนุมัติ (Self-Registration)</h3>
                    {pendingRescuers.length === 0 ? <p style={{ color: '#94a3b8', margin: 0 }}>ไม่มีคำขอสมัครกู้ภัยในขณะนี้</p> : null}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {pendingRescuers.map(r => (
                            <div key={r.id} style={{ background: '#0f172a', padding: '15px', borderRadius: '8px', border: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h4 style={{ margin: '0 0 5px 0', color: '#f8fafc' }}>{r.username}</h4>
                                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>สังกัด: {r.foundation_name} | โทร: {r.phone}</p>
                                </div>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button onClick={() => handleApprove(r.id)} style={{ background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', border: '1px solid #10b981', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>✅ อนุมัติ</button>
                                    <button onClick={() => handleReject(r.id)} style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#ef4444', border: '1px solid #ef4444', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>❌ ลบ</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* CANCEL MODAL */}
      {showCancelModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.7)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <div style={{ background: '#1e293b', padding: '30px', borderRadius: '12px', width: '400px', maxWidth: '90%', color: 'white', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#ef4444' }}>⚠️ ยืนยันการบังคับยกเลิก</h3>
                <p style={{ color: '#94a3b8', marginBottom: '20px' }}>โปรดระบุเหตุผลในการยกเลิกเหตุการณ์ #{cancelIncidentId}</p>
                <select value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} style={{ width: '100%', padding: '10px', marginBottom: '20px', borderRadius: '6px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}>
                    <option value="สถานการณ์ปลอดภัยแล้ว">สถานการณ์ปลอดภัยแล้ว</option>
                    <option value="ก่อกวน / แจ้งเล่น">ก่อกวน / แจ้งเล่น</option>
                    <option value="มีหน่วยอื่นรับไปแล้ว">มีหน่วยอื่นรับไปแล้ว</option>
                    <option value="ข้อมูลผิดพลาด">ข้อมูลผิดพลาด</option>
                </select>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                    <button onClick={() => setShowCancelModal(false)} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>ปิด</button>
                    <button onClick={confirmCancelIncident} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>ยืนยันการยกเลิก</button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
