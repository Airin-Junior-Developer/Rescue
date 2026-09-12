import { useEffect, useState } from 'react';

export function Brand({ subtitle = 'ศูนย์ช่วยเหลือและประสานงาน' }) {
  return <div className="rescue-brand"><span className="rescue-mark" aria-hidden="true">+</span><div><strong>RESCUE<span> CONNECT</span></strong><small>{subtitle}</small></div></div>;
}

export function ConnectionStatus({ socket }) {
  const [connected, setConnected] = useState(socket.connected);
  useEffect(() => {
    const online = () => setConnected(true);
    const offline = () => setConnected(false);
    socket.on('connect', online); socket.on('disconnect', offline); socket.on('connect_error', offline);
    return () => { socket.off('connect', online); socket.off('disconnect', offline); socket.off('connect_error', offline); };
  }, [socket]);
  return <span role="status" className={`connection-status ${connected ? 'connected' : ''}`}><i />{connected ? 'เชื่อมต่อแล้ว' : 'กำลังเชื่อมต่อ · อาจใช้เวลาสักครู่'}</span>;
}

export function DemoNotice() {
  return <div className="demo-notice">ระบบสาธิตสำหรับทดสอบ · ไม่ใช่ช่องทางรับแจ้งเหตุจริง</div>;
}
