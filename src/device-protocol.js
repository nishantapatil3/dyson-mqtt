import { isRobot } from './device-types.js';
import { commandFromTopic, mergeProductState, stateView } from './protocol.js';
import { mergeVacuumState, vacuumCommandFromTopic, vacuumStateView } from './vacuum.js';

const air = {
  statusTopics: ['status/current', 'status/connection', 'status/faults'],
  requests: ['REQUEST-CURRENT-STATE', 'REQUEST-PRODUCT-ENVIRONMENT-CURRENT-SENSOR-DATA', 'REQUEST-CURRENT-FAULTS'],
  merge: mergeProductState, view: stateView, command: commandFromTopic
};
const vacuum = {
  statusTopics: ['status'],
  requests: ['REQUEST-CURRENT-STATE'],
  merge: mergeVacuumState, view: vacuumStateView, command: vacuumCommandFromTopic
};

export function deviceProtocol(device) { return isRobot(device) ? vacuum : air; }
