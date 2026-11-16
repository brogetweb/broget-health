import { randomUUID } from 'node:crypto';
import { userCollections } from './mongo/indexes.js';

export function cleanupWorker(database, transport, auth) {
  const { db } = database;
  async function destroyAsset(asset) {
    if (asset.status === 'uploading' && Date.now() - asset.updatedAt.getTime() < 300000) {
      throw new Error('upload-in-progress');
    }
    await transport.destroy(asset.publicId);
    await db.collection('mediaAssets').deleteOne({ userId: asset.userId, id: asset.id });
  }
  async function perform(job) {
    if (job.kind === 'account-delete') {
      try { await auth.revokeRefreshTokens(job.userId); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      for await (const asset of db.collection('mediaAssets').find({ userId: job.userId })) await destroyAsset(asset);
      for (const name of userCollections) await db.collection(name).deleteMany({ userId: job.userId });
      await db.collection('quotas').deleteMany({ subject: job.userId });
      try { await auth.deleteUser(job.userId); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
      // Keep a minimal tombstone so a stale token cannot initialize an account.
      await db.collection('users').replaceOne({ userId: job.userId, deleting: true }, {
        userId: job.userId, name: '', health: null, deleting: true, deletedAt: new Date(),
      });
    } else if (job.kind === 'media-delete') {
      const asset = await db.collection('mediaAssets').findOne({ userId: job.userId, id: job.mediaId });
      if (!asset) return;
      // Acquire the owner's fence before claiming an unattached image, so a
      // simultaneous meal save cannot attach an image already being removed.
      const remove = await database.transaction(async (db, session) => {
        await db.collection('users').updateOne({ userId: job.userId }, { $inc: { revision: 1 } }, { session });
        const current = await db.collection('mediaAssets').findOne({ userId: job.userId, id: job.mediaId }, { session });
        if (!current || current.status === 'attached') return false;
        if (current.status === 'uploading' && Date.now() - current.updatedAt.getTime() < 300000) throw new Error('upload-in-progress');
        await db.collection('mediaAssets').updateOne({ userId: job.userId, id: job.mediaId },
          { $set: { status: 'delete-pending' } }, { session });
        return true;
      });
      if (remove) await destroyAsset({ ...asset, status: 'delete-pending' });
    } else throw new Error('invalid-cleanup-job');
  }
  return {
    async run(limit = 10) {
      let processed = 0;
      for (let n = 0; n < limit; n++) {
        const now = new Date(), lease = randomUUID();
        const job = await db.collection('cleanupJobs').findOneAndUpdate({
          $or: [{ status: 'pending', nextAttemptAt: { $lte: now } }, { status: 'processing', leaseUntil: { $lte: now } }],
        }, { $set: { status: 'processing', lease, leaseUntil: new Date(now.getTime() + 300000) }, $inc: { attempts: 1 } },
        { sort: { nextAttemptAt: 1 }, returnDocument: 'after' });
        if (!job) break;
        try {
          await perform(job);
          await db.collection('cleanupJobs').deleteOne({ id: job.id, lease, status: 'processing' });
          processed++;
        } catch {
          console.error(JSON.stringify({ event: 'cleanup_retry', kind: job.kind, attempts: job.attempts }));
          await db.collection('cleanupJobs').updateOne({ id: job.id, lease, status: 'processing' }, { $set: {
            status: 'pending', nextAttemptAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7))),
          }, $unset: { lease: '', leaseUntil: '' } });
        }
      }
      return processed;
    },
  };
}
