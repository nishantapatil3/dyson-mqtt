const ROBOT_TYPES = new Set(['N223', '276', '277']);

export function isRobot(device) {
  return ROBOT_TYPES.has(device.productType);
}

export function manifestDeviceSupported(device) {
  const productType = device.connectedConfiguration?.mqtt?.mqttRootTopicLevel;
  return typeof productType === 'string' && /^[a-zA-Z0-9]+$/.test(productType)
    && (device.category === 'ec' || (device.category === 'robot' && isRobot({ productType })));
}
