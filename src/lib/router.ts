/**
 * Routing policy: decides which Firebase AI Logic inference mode a request
 * should use. Pure and unit-tested; thresholds come from Remote Config so the
 * policy can be tuned without shipping a new build.
 */

export type DeviceStatus = 'unknown' | 'available' | 'downloadable' | 'downloading' | 'unavailable';

/** Why the local model cannot be used right now, in words that match the header pill. */
export const noLocalModel = (device: DeviceStatus): string =>
  device === 'downloading'
    ? 'The on-device model is still downloading'
    : device === 'downloadable'
      ? 'The on-device model is not enabled yet (use "Enable on-device AI" above)'
      : 'This device has no on-device model';

/** String values match firebase/ai's InferenceMode constants. */
export type RouteMode = 'only_on_device' | 'prefer_on_device' | 'prefer_in_cloud' | 'only_in_cloud' | 'blocked';

export interface RouteInput {
  /** Light = short single-pass tasks the local model does well. Heavy = reasoning, drafting, long context. */
  weight: 'light' | 'heavy';
  promptTokens: number;
  device: DeviceStatus;
  online: boolean;
  /** User switch: never let this request reach the cloud. */
  strictLocal: boolean;
  onDeviceTokenBudget: number;
}

export interface Route {
  mode: RouteMode;
  /** Where we expect it to run. The response's inferenceSource is the ground truth. */
  expected: 'device' | 'cloud' | 'none';
  reason: string;
}

export function decideRoute(input: RouteInput): Route {
  const deviceReady = input.device === 'available';
  const fits = input.promptTokens <= input.onDeviceTokenBudget;
  const tooLong = `This request is about ${input.promptTokens.toLocaleString('en-US')} tokens; the on-device budget is ${input.onDeviceTokenBudget.toLocaleString('en-US')}.`;

  if (input.strictLocal) {
    if (!deviceReady) {
      return { mode: 'blocked', expected: 'none', reason: 'Strict local is on, but this device has no on-device model ready.' };
    }
    if (!fits) return { mode: 'blocked', expected: 'none', reason: `Strict local is on. ${tooLong}` };
    return { mode: 'only_on_device', expected: 'device', reason: 'Strict local is on: this request cannot leave the device.' };
  }

  if (!input.online) {
    if (deviceReady && fits) {
      return { mode: 'only_on_device', expected: 'device', reason: 'You are offline, so this runs on the on-device model.' };
    }
    return {
      mode: 'blocked',
      expected: 'none',
      reason: deviceReady ? `You are offline. ${tooLong}` : 'You are offline and this device has no on-device model.',
    };
  }

  if (input.weight === 'light' && fits) {
    return deviceReady
      ? { mode: 'prefer_on_device', expected: 'device', reason: 'Light task that fits the on-device budget: it stays on this device, free and private.' }
      : { mode: 'prefer_on_device', expected: 'cloud', reason: 'No on-device model here, so the SDK falls back to the cloud with the blindfolded text.' };
  }

  if (deviceReady && fits) {
    return {
      mode: 'prefer_in_cloud',
      expected: 'cloud',
      reason: 'Heavier reasoning goes to the cloud model, blindfolded. If the cloud is unreachable it falls back to this device.',
    };
  }
  return {
    mode: 'only_in_cloud',
    expected: 'cloud',
    reason: fits
      ? 'Heavier reasoning goes to the cloud model, blindfolded.'
      : `Too long for the on-device model, so it goes to the cloud, blindfolded. ${tooLong}`,
  };
}
