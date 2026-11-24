// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import CitizenSOS from '../src/CitizenSOS';

vi.mock('@line/liff', () => ({ default: {
  init: async () => {}, isInClient: () => true, isLoggedIn: () => true,
  getProfile: async () => ({ displayName: 'Tester' }), getIDToken: () => 'test-token',
} }));
vi.mock('axios', () => ({ default: { post: vi.fn(), get: vi.fn() } }));
vi.mock('socket.io-client', () => ({ io: () => ({
  on() {}, off() {}, connect() {}, disconnect() {}, emit() {},
}) }));

let root, container, requests;
const sos = () => container.querySelector('.sos-trigger');
const dispatches = () => axios.post.mock.calls.filter(([url]) => url.endsWith('/api/incidents'));
const advance = ms => act(async () => vi.advanceTimersByTimeAsync(ms));
const press = () => act(() => sos().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
const fix = (timestamp = Date.now(), latitude = 0, longitude = 99.12) => ({
  coords: { latitude, longitude }, timestamp,
});

async function mount() {
  await act(async () => root.render(<MemoryRouter><CitizenSOS /></MemoryRouter>));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  requests = [];
  vi.stubGlobal('navigator', { geolocation: {
    getCurrentPosition: (success, error) => requests.push({ success, error }),
  } });
  localStorage.clear();
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
  axios.post.mockImplementation(async url => {
    if (url.endsWith('/api/citizen/auth')) return { data: { citizen_token: 'test', phone: '0812345678' } };
    return { data: { incident_id: 7, citizen_token: 'test' } };
  });
  axios.get.mockResolvedValue({ data: { status: 'Pending' } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('citizen SOS location', () => {
  it('blocks a full hold before the first location fix', async () => {
    await mount();
    expect(container.querySelector('#citizen-phone').value).toBe('0812345678');
    await press();
    await advance(5000);
    expect(dispatches()).toHaveLength(0);
    expect(sos().disabled).toBe(true);
  });

  it.each([1, 2, 3])('blocks location error %i and sends only the successful retry coordinates', async code => {
    await mount();
    await act(() => requests[0].error({ code }));
    expect(sos().disabled).toBe(true);
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('ขอตำแหน่งอีกครั้ง'));
    await act(() => retry.click());
    await act(() => requests[0].success(fix(Date.now(), 15, 100)));
    expect(sos().disabled).toBe(true);
    await act(() => requests[1].success(fix()));
    await press();
    await advance(4999);
    expect(dispatches()).toHaveLength(0);
    await advance(1);
    expect(dispatches()).toHaveLength(1);
    expect(dispatches()[0][1]).toMatchObject({ latitude: 0, longitude: 99.12, citizen_phone: '0812345678' });
  });

  it('rechecks the fix age at submission when the clock jumps during a hold', async () => {
    await mount();
    await act(() => requests[0].success(fix()));
    await press();
    vi.setSystemTime(Date.now() + 120_000);
    await advance(5000);
    expect(dispatches()).toHaveLength(0);
    expect(sos().disabled).toBe(true);
  });

  it('offers a retry if a device refuses to start the location request', async () => {
    vi.stubGlobal('navigator', { geolocation: {
      getCurrentPosition() { throw new DOMException('Location access denied', 'SecurityError'); },
    } });
    await mount();
    expect(sos().disabled).toBe(true);
    expect(container.textContent).toContain('ขอตำแหน่งอีกครั้ง');
  });

  it('requires a new hold if the position expires and is reacquired', async () => {
    await mount();
    await act(() => requests[0].success(fix(Date.now() - 58_000)));
    await press();
    await advance(2000);
    expect(sos().disabled).toBe(true);
    const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('ขอตำแหน่งอีกครั้ง'));
    await act(() => retry.click());
    await act(() => requests[1].success(fix()));
    await advance(5000);
    expect(dispatches()).toHaveLength(0);
    expect(sos().disabled).toBe(false);
  });

  it.each([fix(Date.now(), NaN), fix(Date.now(), 15, 181), fix(1)])('rejects an unusable fix', async position => {
    await mount();
    await act(() => requests[0].success(position));
    expect(sos().disabled).toBe(true);
    await press();
    await advance(5000);
    expect(dispatches()).toHaveLength(0);
  });

  it('keeps tracking and chat usable without geolocation support', async () => {
    vi.stubGlobal('navigator', {});
    localStorage.setItem('activeCitizenIncident', JSON.stringify({ id: 7, citizen_token: 'test', status: 'Accepted' }));
    axios.get.mockImplementation(async url => ({ data: url.endsWith('/chat') ? [] : { status: 'Accepted' } }));
    await mount();
    expect(container.querySelector('.leaflet-container')).toBeNull();
    expect(container.querySelector('input[placeholder="พิมพ์ข้อความ..."]')).toBeTruthy();
    expect(container.textContent).toContain('ไม่รองรับ');
  });
});
