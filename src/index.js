import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import './db.js';                                  // importing runs the schema code
import accountRoutes from './routes/account.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/document.js';
import chunkRoutes from './routes/chunks.js';
import askRoutes from './routes/ask.js';
import conversationRoutes from './routes/conversations.js';
import { errorHandler } from './middleware/errors.js';
import { initAuth, requireAuth } from './middleware/auth.js';
import { requeueStale } from './services/ingest.js';
import { warmUp } from './services/embed.js';

initAuth();
const app = express();

app.disable('x-powered-by');
app.use(helmet());                    // safe default headers
app.use(cors());                      // allow requests from other origins (web testing)
app.use(express.json({ limit: '1mb' })); // read JSON request bodies

// Public route (no login needed)
app.get('/health', (req, res) => res.json({ ok: true }));

// Protected routes
app.use('/auth', requireAuth, authRoutes);
app.use('/account', requireAuth, accountRoutes);
app.use('/documents', requireAuth, documentRoutes);
app.use('/chunks', requireAuth, chunkRoutes);
app.use('/ask', requireAuth, askRoutes);
app.use('/conversations', requireAuth, conversationRoutes);

// Unknown route
app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Route not found' }));

// Always last
app.use(errorHandler);
requeueStale();
warmUp();

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Vault server running on http://localhost:${config.port}`);
});