import { RingApi } from 'ring-client-api';
import { getRingRefreshToken } from './config.js';

async function createRingApi(): Promise<RingApi> {
  const refreshToken = getRingRefreshToken();
  if (!refreshToken) {
    throw new Error('Missing Ring refresh token. Provide via config or env RING_REFRESH_TOKEN');
  }
  const ringApi = new RingApi({
    refreshToken,
  });
  return ringApi;
}

export async function getCameraNames(): Promise<string[]> {
  try {
    const api = await createRingApi();
    const cameras = await api.getCameras();
    return cameras.map((c) => c.name);
  } catch (error) {
    console.error('Error getting camera names:', error);
    throw new Error(`Failed to get camera names: ${(error as Error).message}`);
  }
}

export async function getSnapshotBase64(cameraName: string): Promise<string> {
  try {
    const api = await createRingApi();
    const cameras = await api.getCameras();
    const camera = cameraName
      ? cameras.find((c) => c.name.toLowerCase() === cameraName.toLowerCase())
      : cameras[0];

    if (!camera) {
      throw new Error(`Camera not found: ${cameraName}`);
    }

    const buffer = await camera.getSnapshot();
    return buffer.toString('base64');
  } catch (error) {
    console.error(`Error getting snapshot for camera ${cameraName}:`, error);
    throw new Error(`Failed to get snapshot from ${cameraName}: ${(error as Error).message}`);
  }
}


