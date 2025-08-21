import { RingApi } from 'ring-client-api';
import { getRingRefreshToken } from './config.js';
import fs from 'fs';
import path from 'path';

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
    
    // Store the image locally
    await storeImageLocally(buffer, cameraName);
    
    return buffer.toString('base64');
  } catch (error) {
    console.error(`Error getting snapshot for camera ${cameraName}:`, error);
    throw new Error(`Failed to get snapshot from ${cameraName}: ${(error as Error).message}`);
  }
}

async function storeImageLocally(imageBuffer: Buffer, cameraName: string): Promise<string> {
  try {
    // Create images directory if it doesn't exist
    const imagesDir = path.resolve(process.cwd(), 'public', 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Create camera-specific directory
    const cameraDir = path.join(imagesDir, cameraName.replace(/[^a-zA-Z0-9]/g, '_'));
    if (!fs.existsSync(cameraDir)) {
      fs.mkdirSync(cameraDir, { recursive: true });
    }

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot_${timestamp}.jpg`;
    const filePath = path.join(cameraDir, filename);

    // Write the image file
    fs.writeFileSync(filePath, imageBuffer);
    
    console.log(`Image stored: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error storing image locally:', error);
    throw error;
  }
}

export async function getStoredImages(): Promise<Array<{
  camera: string;
  images: Array<{
    filename: string;
    path: string;
    timestamp: Date;
    size: number;
  }>;
}>> {
  try {
    const imagesDir = path.resolve(process.cwd(), 'public', 'images');
    if (!fs.existsSync(imagesDir)) {
      return [];
    }

    const cameraFolders = fs.readdirSync(imagesDir).filter(item => {
      const fullPath = path.join(imagesDir, item);
      return fs.statSync(fullPath).isDirectory();
    });

    const result = [];
    for (const cameraFolder of cameraFolders) {
      const cameraPath = path.join(imagesDir, cameraFolder);
      const imageFiles = fs.readdirSync(cameraPath)
        .filter(file => file.toLowerCase().endsWith('.jpg'))
        .map(file => {
          const filePath = path.join(cameraPath, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            path: `/images/${cameraFolder}/${file}`,
            timestamp: stats.mtime,
            size: stats.size
          };
        })
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // Sort by newest first

      if (imageFiles.length > 0) {
        result.push({
          camera: cameraFolder.replace(/_/g, ' '),
          images: imageFiles
        });
      }
    }

    return result;
  } catch (error) {
    console.error('Error getting stored images:', error);
    return [];
  }
}


