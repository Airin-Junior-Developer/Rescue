import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { API_URL } from './config';


function RescuerRegister() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [foundationId, setFoundationId] = useState('');
  const [foundations, setFoundations] = useState([]);
  
  const navigate = useNavigate();

  useEffect(() => {
    // We need an open public endpoint to fetch foundations.
    // Currently, /api/admin/foundations is protected. 
    // Since we don't have a public one, we'll try to fetch with a dummy or let the backend open it.
    // Actually, I'll need to modify server.js to allow public fetch of foundations!
    // For now, I will add an API call. If it fails due to auth, I'll need to fix server.js.
    fetchFoundations();
  }, []);

  const fetchFoundations = async () => {
    try {
      const res = await axios.get(`${API_URL}/api/foundations/public`);
      setFoundations(res.data);
    } catch (error) {
      console.error("Failed to load foundations", error);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!/^0\d{8,9}$/.test(phone)) {
        toast.error('กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง (ต้องขึ้นต้นด้วย 0 และมี 9-10 หลัก)');
        return;
    }
    try {
      const res = await axios.post(`${API_URL}/api/rescuers/register`, {
        username,
        password,
        phone,
        foundation_id: foundationId
      });
      toast.success(res.data.message || 'ลงทะเบียนสำเร็จ รอการอนุมัติ');
      navigate('/login');
    } catch (err) {
      toast.error(err.response?.data?.error || 'เกิดข้อผิดพลาดในการลงทะเบียน');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
      <div className="glass-panel animate-slide-up" style={{ maxWidth: '400px', width: '100%', padding: '40px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '10px', color: '#10b981' }}>สมัครบัญชีกู้ภัย</h2>
        <p style={{ textAlign: 'center', color: '#94a3b8', marginBottom: '30px' }}>บัญชีของคุณต้องได้รับการอนุมัติจากแอดมินก่อนใช้งาน</p>
        
        <form onSubmit={handleRegister}>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>สังกัด / มูลนิธิ</label>
            <select value={foundationId} onChange={e=>setFoundationId(e.target.value)} required style={{width:'100%', padding:'12px', borderRadius:'8px', background:'rgba(0,0,0,0.5)', border:'1px solid #475569', color:'white'}}>
               <option value="">-- เลือกมูลนิธิ --</option>
               {foundations.map(f => (
                 <option key={f.id} value={f.id}>{f.name}</option>
               ))}
            </select>
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>ชื่อผู้ใช้ (Username)</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} required style={{width:'100%'}} placeholder="e.g. driver01" />
          </div>
          <div style={{ marginBottom: '15px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>รหัสผ่าน (Password)</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:'100%'}} placeholder="••••••••" />
          </div>
          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>เบอร์โทรศัพท์ติดต่อ</label>
            <input value={phone} onChange={e=>setPhone(e.target.value.replace(/\D/g, ''))} required style={{width:'100%'}} placeholder="08x-xxx-xxxx" type="tel" maxLength="10" />
          </div>
          
          <button type="submit" className="btn" style={{width:'100%', background:'#10b981', color:'white', fontWeight:'bold', border:'none', padding:'12px', borderRadius:'8px', cursor:'pointer'}}>
             ลงทะเบียน
          </button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <Link to="/login" style={{ textDecoration: 'none', color: '#94a3b8', fontSize: '14px', transition: 'color 0.3s' }}>
            &larr; กลับไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </div>
    </div>
  );
}

export default RescuerRegister;
