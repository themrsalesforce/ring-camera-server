import 'dotenv/config';
import { getSnapshotBase64 } from '../services/ring.js';
import { classifyBins } from '../services/vision.js';

async function main() {
  const cameraName = process.argv[2] || process.env.CAMERA_NAME || '';
  try {
    const imageBase64 = await getSnapshotBase64(cameraName);
    const result = await classifyBins(imageBase64);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ camera: cameraName || 'default', ...result }));
    process.exit(0);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
}

main();



