import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import './db.js';                                  // importing runs the schema code
import accountRoutes from './routes/account.js';
import { errorHandler } from './middleware/errors.js';
import authRoutes from './routes/auth.js';
import { initAuth, requireAuth } from './middleware/auth.js';
initAuth();
const app = express();

app.disable('x-powered-by');
app.use(helmet());                    // safe default headers
app.use(cors());                      // allow requests from other origins (web testing)
app.use(express.json({ limit: '1mb' })); // read JSON request bodies
app.use('/account',requireAuth,accountRoutes);
// Public route (no login needed)
app.get('/health', (req, res) => res.json({ ok: true }));

// Protected routes
app.use('/auth', requireAuth, authRoutes);

// Placeholder: replaced by the real documents router in Step 3
app.get('/documents', requireAuth, (req, res) => res.json({ items: [] }));

// Unknown route
app.use((req, res) => res.status(404).json({ error: 'not_found', message: 'Route not found' }));

// Always last
app.use(errorHandler);

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Vault server running on http://localhost:${config.port}`);
});