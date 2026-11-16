if (process.env.APP_ENV !== 'development') throw new Error('Local server requires APP_ENV=development');
await import('./server.js');
