import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker } from 'react-leaflet';
import L from 'leaflet';
import { toast } from 'react-toastify';

const iconBaseOpts = { shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png', iconSize: [25, 41], iconAnchor: [12, 41] };
const RedIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png' });
const BlueIcon = new L.Icon({ ...iconBaseOpts, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png' });

function AdminDashboard({ user, onLogout }) {
  const [incidents, setIncidents] = useState([]);
  const [rescuers, setRescuers] = useState([]);
  const [history, setHistory] = useState([]);
  const [avgTime, setAvgTime] = useState(0);
  const [broadcastMsg, setBroadcastMsg] = useState('');

  useEffect(() => {
     fetchStatus();
     const interval = setInterval(fetchStatus, 3000);
     return () => clearInterval(interval);
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await axios.get('http://127.0.0.1:3000/api/admin/system-status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      setIncidents(res.data.incidents || []);
      setRescuers(res.data.rescuers || []);
      setHistory(res.data.history || []);
      setAvgTime(res.data.avgResponseTimeSec || 0);
    } catch(e) { }
  };

  const cancelIncident = async (id) => {
     const isConfirmed = window.confirm(`⚠️ ยืนยันการบังคับยกเลิก Incident #${id} หรือไม่?\n\nการกระทำนี้จะถือว่าภารกิจสิ้นสุดทันที รถกู้ภัยที่รับงานอยู่จะถูกปลดแอกให้ไปรับงานอื่นต่อได้ทันที`);
     if (!isConfirmed) return;

     try {
         await axios.post(`http://127.0.0.1:3000/api/admin/incidents/${id}/cancel`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         toast.success("ยกเลิกเหตุการณ์และปลดแอกคนขับเรียบร้อย");
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
         await axios.post('http://127.0.0.1:3000/api/admin/broadcast', { message: broadcastMsg }, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }});
         toast.success("📢 ประกาศกระจายให้รถกู้ภัยทุกคันแล้ว!");
         setBroadcastMsg('');
     } catch (e) { toast.error("Fail to broadcast: " + e.message); }
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
            <button onClick={onLogout} style={{ background: 'transparent', color: '#94a3b8', border: '1px solid #475569', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>Log Out</button>
         </div>
      </header>
      
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
         {/* LEFT MAP */}
         <div style={{ flex: 2, position: 'relative' }}>
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
                            <strong>🚑 Rescuer Unit #{r.id}</strong><br/>
                            Status: <span style={{color: r.status === 'available' ? 'green' : 'red'}}>{r.status}</span><br/>
                            Phone: {r.phone}
                        </Popup>
                    </Marker>
                ))}

                {/* Heatmap Layer for Resolved historical points */}
                {history.filter(h => h.latitude && h.longitude).map(h => (
                     <CircleMarker key={'heat'+h.id} center={[h.latitude, h.longitude]} radius={15} pathOptions={{ color: 'transparent', fillColor: h.status === 'Resolved' ? '#ef4444' : '#64748b', fillOpacity: 0.15 }}>
                         <Popup>Incident #{h.id} ({h.status})</Popup>
                     </CircleMarker>
                ))}
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
                   
                   <button onClick={() => cancelIncident(inc.id)} style={{ marginTop: '15px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', color: '#ef4444', padding: '10px', borderRadius: '5px', cursor: 'pointer', width: '100%', fontWeight: 'bold' }}>
                       บังคับยกเลิกเหตุนี้ (Force Cancel)
                   </button>
               </div>
            ))}

            {/* BROADCAST CENTER */}
            <div className="glass-panel" style={{ padding: '20px', marginTop: '20px', borderLeft: '4px solid #3b82f6' }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#60a5fa', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '20px' }}>📢</span> แจ้งเตือนฉุกเฉิน (Broadcast)
                </h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <input value={broadcastMsg} onChange={e=>setBroadcastMsg(e.target.value)} onKeyDown={e=> e.key === 'Enter' && sendBroadcast()} placeholder="พิมพ์ข้อความกระจายเสียง..." style={{ flex: 1, padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: 'white', outline: 'none' }} />
                    <button onClick={sendBroadcast} className="btn" style={{ background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', padding: '0 20px', cursor: 'pointer', fontWeight: 'bold', whiteSpace: 'nowrap' }}>ยิงประกาศ 🚀</button>
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
                                    <td style={{ padding: '10px', color: '#94a3b8', textAlign: 'right' }}>{h.assigned_user_id ? `Unit ${h.assigned_user_id}` : '-'}</td>
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
                        <h3 style={{ margin: '0 0 5px 0' }}>Unit #{r.id}</h3>
                        <p style={{ margin: 0, padding: '2px 8px', background: r.status === 'available' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)', color: r.status === 'available' ? '#10b981' : '#f59e0b', borderRadius: '10px', display: 'inline-block', fontSize: '12px', fontWeight: 'bold' }}>{r.status.toUpperCase()}</p>
                    </div>
                ))}
            </div>
         </div>
      </div>
    </div>
  );
}

export default AdminDashboard;
