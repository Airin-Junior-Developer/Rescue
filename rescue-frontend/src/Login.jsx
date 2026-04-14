import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'react-toastify';

function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post('http://127.0.0.1:3000/api/login', { username, password });
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
        <h2 style={{ textAlign: 'center', marginBottom: '30px' }}>Staff Access</h2>
        
        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Username</label>
            <input value={username} onChange={e=>setUsername(e.target.value)} required style={{width:'100%'}} placeholder="e.g. adminA" />
          </div>
          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', marginBottom: '8px', color: '#cbd5e1' }}>Password</label>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:'100%'}} placeholder="••••••••" />
          </div>
          <button type="submit" className="btn btn-primary" style={{width:'100%'}}>Sign In to Command Center</button>
        </form>

        <div style={{ marginTop: '30px', textAlign: 'center' }}>
          <Link to="/" style={{ textDecoration: 'none', color: '#94a3b8', fontSize: '14px', transition: 'color 0.3s' }}>
            &larr; Back to Citizen SOS
          </Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
