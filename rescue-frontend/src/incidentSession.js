const key = 'activeCitizenIncident';

export function readIncident(storage) {
  try {
    const incident = JSON.parse(storage.getItem(key));
    return incident?.id && typeof incident.citizen_token === 'string' ? incident : null;
  } catch { return null; }
}

export function persistPendingIncident(storage, response) {
  const incident = { id: response.incident_id, citizen_token: response.citizen_token, status: 'Pending' };
  storage.setItem(key, JSON.stringify(incident));
  return incident;
}

export async function recoverIncident(storage, getStatus) {
  const incident = readIncident(storage);
  if (!incident) return null;
  let status;
  try { status = await getStatus(incident.id, incident.citizen_token); }
  catch (error) {
    if (readIncident(storage)?.id !== incident.id) return readIncident(storage);
    if ([401, 403, 404].includes(error.response?.status)) {
      storage.removeItem(key);
      return null;
    }
    throw error;
  }
  // A response from an old case must not overwrite a newer case or a completion event.
  if (readIncident(storage)?.id !== incident.id) return readIncident(storage);
  if (['Resolved', 'Completed'].includes(status.status)) {
    storage.removeItem(key);
    return null;
  }
  const current = readIncident(storage);
  if (current?.status === 'Accepted' && status.status === 'Pending') return current;
  const hydrated = { ...incident, ...status };
  storage.setItem(key, JSON.stringify(hydrated));
  return hydrated;
}
