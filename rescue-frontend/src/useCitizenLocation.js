import { useEffect, useRef, useState } from 'react';

const MAX_AGE_MS = 60_000;
const pending = { position: null, message: 'กำลังขอตำแหน่งจากอุปกรณ์…', status: 'pending' };
const expiredMessage = 'ตำแหน่งเดิมหมดอายุ กรุณาขอตำแหน่งอีกครั้งก่อนแจ้งเหตุ';
const errors = {
  1: 'ยังไม่ได้รับอนุญาตให้ใช้ตำแหน่ง กรุณาเปิดสิทธิ์ตำแหน่งให้ LINE หรือเบราว์เซอร์ แล้วลองอีกครั้ง',
  2: 'อุปกรณ์ระบุตำแหน่งไม่ได้ กรุณาตรวจสอบว่าบริการตำแหน่งเปิดอยู่ แล้วลองอีกครั้ง',
  3: 'ขอตำแหน่งไม่ทันเวลา กรุณาลองอีกครั้ง',
};

function isFresh(position) {
  const age = Date.now() - position.timestamp;
  return age >= 0 && age < MAX_AGE_MS;
}

export function useCitizenLocation() {
  const [location, setLocation] = useState(pending);
  const [attempt, setAttempt] = useState(0);
  const current = useRef(null);

  useEffect(() => {
    let active = true;
    let expiryTimer;

    function fail(message) {
      if (!active) return;
      current.current = null;
      setLocation({ position: null, message, status: 'error' });
    }

    function onSuccess({ coords, timestamp }) {
      if (!active) return;
      const { latitude, longitude } = coords;
      // The dispatch API uses the Web Mercator latitude limit.
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 85.05112878 ||
          !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
        fail('พิกัดที่ได้รับใช้แจ้งเหตุไม่ได้ กรุณาขอตำแหน่งอีกครั้ง');
        return;
      }
      const position = { latitude, longitude, timestamp };
      if (!Number.isFinite(timestamp) || !isFresh(position)) {
        fail(expiredMessage);
        return;
      }
      current.current = position;
      setLocation({ position, message: 'ได้รับตำแหน่งแล้ว', status: 'ready' });
      expiryTimer = setTimeout(() => {
        current.current = null;
        // Keep the last measured point available for the tracking map.
        setLocation({ position, message: expiredMessage, status: 'expired' });
      }, timestamp + MAX_AGE_MS - Date.now());
    }

    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(onSuccess, error => fail(errors[error.code] || errors[2]), {
          enableHighAccuracy: true, maximumAge: 0, timeout: 15_000,
        });
      } else {
        fail('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการขอตำแหน่ง');
      }
    } catch (error) {
      fail(error.name === 'SecurityError' ? errors[1] : errors[2]);
    }
    return () => {
      active = false;
      clearTimeout(expiryTimer);
      current.current = null;
    };
  }, [attempt]);

  function retry() {
    current.current = null;
    setLocation(pending);
    setAttempt(previous => previous + 1);
  }

  // Background tabs can delay the expiry timer. Check the clock at both ends of the hold.
  function getFreshPosition() {
    const position = current.current;
    if (position && !isFresh(position)) {
      current.current = null;
      setLocation({ position, message: expiredMessage, status: 'expired' });
    }
    return current.current;
  }

  return { ...location, retry, getFreshPosition };
}
