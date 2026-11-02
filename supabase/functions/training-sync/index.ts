import { createTrainingHandler } from '../_shared/training-handler.mjs';

// Disabled unless explicitly configured in the DEVELOPMENT project after review.
// These server-only environment variables must never be committed or sent in chat.
Deno.serve(createTrainingHandler({
  url: Deno.env.get('SUPABASE_URL'),
  publicKey: Deno.env.get('TRAINING_PUBLIC_KEY'),
  serverKey: Deno.env.get('TRAINING_SERVER_KEY'),
  allowedOrigins: (Deno.env.get('TRAINING_ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
  enabled: Deno.env.get('TRAINING_SYNC_ENABLED') === 'true'
}));
