import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AdminDashboard from './AdminDashboard';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import 'leaflet/dist/leaflet.css';
import './index.css';

// Simple Login specifically for the Web Admin
function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  const handleLogin = async (e) => {
    e.preventDefault();
    try {
        const res = await fetch('http://127.0.0.1:3000/api/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok && data.user.role.toLowerCase() === 'admin') {
            onLogin(data.user, data.token);
        } else {
            alert('Access Denied: Only Admins can access God View');
        }
    } catch(e) { alert('Login Failed'); }
  };

  return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyItems: 'center', background: '#0f172a', width: '100vw', justifyContent: 'center' }}>
          <form onSubmit={handleLogin} className="glass-panel" style={{ padding: '40px', width: '400px', display: 'flex', flexDirection: 'column' }}>
              <h2 className="text-gradient" style={{ textAlign: 'center', marginBottom: '20px' }}>God View Login</h2>
              <input value={username} onChange={e=>setUsername(e.target.value)} placeholder="Username" style={{ width: '100%', marginBottom: '15px' }} required />
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" style={{ width: '100%', marginBottom: '20px' }} required />
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Login to Command Center</button>
          </form>
      </div>
  );
}

function App() {
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('adminUser')) || null);

  const handleLogin = (userData, token) => {
    localStorage.setItem('adminUser', JSON.stringify(userData));
    localStorage.setItem('token', token);
    setUser(userData);
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('adminUser');
    localStorage.removeItem('token');
  };

  return (
    <BrowserRouter>
      <ToastContainer position="top-right" autoClose={4000} hideProgressBar theme="dark" />
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/login" element={!user ? <Login onLogin={handleLogin} /> : <Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={
            user ? <AdminDashboard user={user} onLogout={handleLogout} /> : <Navigate to="/login" />
        } />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
