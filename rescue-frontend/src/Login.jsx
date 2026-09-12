import { Brand, DemoNotice } from './RescueUI';
import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import { API_URL } from './config';


function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API_URL}/api/login`, { username, password });
      toast.success('Login Successful');
      localStorage.setItem('token', res.data.token);
      onLogin(res.data.user);
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Invalid credentials');
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
      <div className="glass-panel animate-slide-up" style={{ maxWidth: '400px', width: '100%', padding: '40px' }}>
        <Brand subtitle="สำหรับทีมกู้ภัย" /><DemoNotice /><h2 style={{ textAlign: 'center', marginBottom: '30px' }}>เข้าสู่ระบบเจ้าหน้าที่</h2>
        
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} required style={{width:'100%'}} placeholder="ชื่อผู้ใช้" aria-label="ชื่อผู้ใช้" autoComplete="username" />
          </div>
          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Password</label>
            <input aria-label="รหัสผ่าน" autoComplete="current-password" type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:'100%'}} placeholder="••••••••" />
          </div>
          <button type="submit" className="btn btn-primary" style={{width:'100%'}}>เข้าสู่พื้นที่ปฏิบัติงาน</button>
        </form>

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <p style={{ color: '#cbd5e1', fontSize: '14px', marginBottom: '15px' }}>
            ไม่มีบัญชี? <Link to="/register" style={{ color: '#3b82f6', textDecoration: 'underline' }}>สมัครเป็นกู้ภัย</Link>
          </p>
          <Link to="/" style={{ textDecoration: 'none', color: '#94a3b8', fontSize: '14px', transition: 'color 0.3s' }}>
            &larr; กลับหน้าแจ้งเหตุ
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
