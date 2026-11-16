import { v2 as cloudinary } from 'cloudinary';
import sharp from 'sharp';
import { randomUUID, createHash } from 'node:crypto';
import { activeOwner } from './mongo/users.js';
import { StoreError, ownerId } from './mongo/errors.js';

export async function normalizePhoto(base64) {
  if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 2800000) {
    throw new StoreError(400, 'invalid-image');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length > 2 * 1024 * 1024) throw new StoreError(413, 'image-too-large');
  try {
    const image = sharp(bytes, { limitInputPixels: 16000000, animated: false });
    const info = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(info.format) || (info.pages ?? 1) > 1) throw new Error();
    return await image.rotate().resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 }).toBuffer();
  } catch { throw new StoreError(400, 'invalid-image'); }
}

export function cloudinaryTransport(config) {
  cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true });
  return {
    upload: (bytes, publicId) => new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ public_id: publicId, resource_type: 'image',
        type: 'authenticated', overwrite: false, format: 'jpg', timeout: 60000 },
      (error, result) => error ? reject(new StoreError(503, 'photo-upload-unavailable')) : resolve(result));
      stream.on('error', () => reject(new StoreError(503, 'photo-upload-unavailable')));
      stream.end(bytes);
    }),
    async destroy(publicId) {
      const result = await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true, timeout: 60000 });
      if (!['ok', 'not found'].includes(result.result)) throw new StoreError(503, 'photo-delete-unavailable');
    },
    download: publicId => cloudinary.utils.private_download_url(publicId, 'jpg', {
      resource_type: 'image', type: 'authenticated', expires_at: Math.floor(Date.now() / 1000) + 60,
      attachment: false,
    }),
  };
}

export function mediaStore(database, transport) {
  const { db } = database;
  return {
    async upload(userId, base64) {
      ownerId(userId);
      const bytes = await normalizePhoto(base64);
      const id = randomUUID();
      const ownerKey = createHash('sha256').update(userId).digest('hex');
      const publicId = `health-broget/${ownerKey}/${id}`;
      const now = new Date();
      // Reserve the public ID and recovery job BEFORE calling Cloudinary.
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        await db.collection('mediaAssets').insertOne({ userId, id, publicId, status: 'uploading', createdAt: now, updatedAt: now }, { session });
        await db.collection('cleanupJobs').insertOne({ id: `media:${userId}:${id}`, userId, mediaId: id,
          kind: 'media-delete', status: 'pending', attempts: 0, nextAttemptAt: new Date(now.getTime() + 600000) }, { session });
      });
      try {
        await transport.upload(bytes, publicId);
        await database.transaction(async (db, session) => {
          await activeOwner(db, session, userId);
          const result = await db.collection('mediaAssets').updateOne({ userId, id, status: 'uploading' },
            { $set: { status: 'uploaded', updatedAt: new Date() } }, { session });
          if (!result.matchedCount) throw new StoreError(409, 'invalid-image');
          await db.collection('cleanupJobs').updateOne({ id: `media:${userId}:${id}` },
            { $set: { nextAttemptAt: new Date(Date.now() + 86400000) } }, { session });
        });
        return { id };
      } catch {
        // Durable recovery handles uncertain uploads and account-deletion races.
        await db.collection('cleanupJobs').updateOne({ id: `media:${userId}:${id}` },
          { $set: { nextAttemptAt: new Date(), status: 'pending' }, $unset: { lease: '', leaseUntil: '' } });
        throw new StoreError(503, 'photo-upload-unavailable');
      }
    },
    async url(userId, id) {
      ownerId(userId);
      const asset = await db.collection('mediaAssets').findOne({ userId, id, status: { $in: ['uploaded', 'attached'] } });
      if (!asset) throw new StoreError(404, 'not-found');
      return { url: transport.download(asset.publicId), expiresIn: 60 };
    },
    async discard(userId, id) {
      await database.transaction(async (db, session) => {
        await activeOwner(db, session, userId);
        const asset = await db.collection('mediaAssets').findOne({ userId, id }, { session });
        if (!asset) throw new StoreError(404, 'not-found');
        if (asset.status === 'attached') throw new StoreError(409, 'photo-attached');
        await db.collection('mediaAssets').updateOne({ userId, id }, { $set: { status: 'delete-pending' } }, { session });
        await db.collection('cleanupJobs').updateOne({ id: `media:${userId}:${id}` }, { $set: {
          userId, mediaId: id, kind: 'media-delete', status: 'pending', nextAttemptAt: new Date(), attempts: 0,
        }, $unset: { lease: '', leaseUntil: '' } }, { upsert: true, session });
      });
    },
  };
}
