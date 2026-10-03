import fs from 'node:fs';

// Local backend secrets may live in .env, which is ignored by Git.
// Existing process variables remain the preferred deployment mechanism.
if (fs.existsSync('.env')) process.loadEnvFile('.env');
