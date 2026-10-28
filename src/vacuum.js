// Dyson 360 JSON MQTT protocol; newer CBOR-based robots use a different protocol.
// Reference: https://github.com/thoukydides/matterbridge-dyson-robot
export function mergeVacuumState(previous, message) {
  const { msg, time, oldstate, newstate, state, ...fields } = message;
  const next = { ...previous, ...fields };
  // Full snapshots can omit faults after they clear; partial updates keep them.
  if (msg === 'CURRENT-STATE' && typeof state === 'string') {
    next.faults = fields.faults ?? {};
    next.activeFaults = fields.activeFaults ?? [];
  }
  if (Array.isArray(fields.newActiveFaults)) next.activeFaults = fields.newActiveFaults;
  if (typeof (newstate ?? state) === 'string') next.state = newstate ?? state;
  return next;
}

export function vacuumStateView(product) {
  const status = product.state;
  let state = null;
  if (typeof status === 'string') {
    if (status.startsWith('FAULT_')) state = 'error';
    else if (status.endsWith('_PAUSED')) state = 'paused';
    else if (['FULL_CLEAN_INITIATED', 'FULL_CLEAN_RUNNING', 'FULL_CLEAN_DISCOVERING', 'FULL_CLEAN_TRAVERSING', 'MAPPING_INITIATED', 'MAPPING_RUNNING'].includes(status)) state = 'cleaning';
    else if (status.endsWith('_NEEDS_CHARGE')) state = 'returning';
    else if (['INACTIVE_CHARGED', 'INACTIVE_CHARGING', 'FULL_CLEAN_CHARGING', 'MAPPING_CHARGING'].includes(status)) state = 'docked';
    else state = 'idle';
  }
  const battery = product.batteryChargeLevel;
  return {
    state,
    battery_level: typeof battery === 'number' && Number.isFinite(battery) && battery >= 0 && battery <= 100 ? battery : null,
    dyson_state: status ?? null,
    product_state: product
  };
}

export function vacuumCommandFromTopic(command, payload, product = {}) {
  const value = payload.toString().trim().toLowerCase();
  const time = new Date().toISOString();
  if (command === 'request' && value === 'state') return { msg: 'REQUEST-CURRENT-STATE', time };
  if (command !== 'vacuum') throw new Error('Unsupported vacuum command topic');
  const actions = { start: product.state?.endsWith('_PAUSED') ? 'RESUME' : 'START', pause: 'PAUSE', resume: 'RESUME', stop: 'ABORT', return_to_base: 'ABORT' };
  if (!Object.hasOwn(actions, value)) throw new Error('Invalid vacuum action');
  const msg = actions[value];
  return {
    msg, time, 'mode-reason': 'RAPP',
    ...(msg === 'START' ? {
      fullCleanType: 'immediate',
      ...(product.defaultCleaningMode ? { cleaningMode: 'global' } : {}),
      ...(product.defaultCleaningStrategy ? { cleaningStrategy: product.defaultCleaningStrategy } : {})
    } : {})
  };
}
