// Uses only a synthetic image, verifies access controls, then removes it.
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { cloudinaryTransport } from './media.js';
const config = { cloudName: process.env.CLOUDINARY_CLOUD_NAME, apiKey: process.env.CLOUDINARY_API_KEY, apiSecret: process.env.CLOUDINARY_API_SECRET };
if (Object.values(config).some(value => !value)) throw new Error('Set Cloudinary server configuration');
const transport = cloudinaryTransport(config), id = `health-broget/diagnostics/${randomUUID()}`;
let attempted = false;
try {
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#eff5ed' } }).jpeg().toBuffer();
  attempted = true;
  await transport.upload(bytes, id);
  const download = await fetch(transport.download(id), { signal: AbortSignal.timeout(15000) });
  if (download.status !== 200 || !(download.headers.get('content-type') ?? '').startsWith('image/')) throw new Error('private-download-failed');
  const downloaded = Buffer.from(await download.arrayBuffer());
  if (!downloaded.equals(bytes)) throw new Error('download-content-mismatch');
  const anonymous = await fetch(`https://res.cloudinary.com/${config.cloudName}/image/authenticated/${id}.jpg`, { signal: AbortSignal.timeout(15000) });
  await anonymous.body?.cancel();
  if (![401, 403, 404].includes(anonymous.status)) throw new Error('unsigned-image-accessible');
  const expiredUrl = cloudinary.utils.private_download_url(id, 'jpg', { resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) - 60 });
  const expired = await fetch(expiredUrl, { signal: AbortSignal.timeout(15000) });
  await expired.body?.cancel();
  if (![401, 403, 404].includes(expired.status)) throw new Error('expired-download-accessible');
  console.log('Cloudinary live check passed: upload, signed download, unsigned access denied, expired link denied.');
} catch (error) {
  console.error(JSON.stringify({ event: 'cloudinary_check_failed', code: error.code ?? 'check-failed' }));
  process.exitCode = 1;
} finally {
  if (attempted) {
    try { await transport.destroy(id); console.log('Synthetic Cloudinary diagnostic image removed.'); }
    catch { console.error('Synthetic image cleanup requires retry.'); process.exitCode = 1; }
  }
}
