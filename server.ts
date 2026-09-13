import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import {
  getDatabaseUrl,
  setRuntimeDatabaseUrl,
  normalizeNeonUrl,
  checkNeonConnection,
  initTables,
  getConfigMap,
  setConfigValue,
  getProducts,
  upsertProduct,
  deleteProduct,
  getSales,
  saveSaleTransaction,
  deleteSale,
  updateSale,
} from './server/neonDb';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // --- API Routes ---
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // 1. Estado y verificación de conexión con Neon PostgreSQL
  app.get('/api/db/status', async (req, res) => {
    try {
      const status = await checkNeonConnection();
      const currentUrl = getDatabaseUrl();
      let maskedUrl = '';
      if (currentUrl) {
        try {
          const parsed = new URL(currentUrl);
          maskedUrl = `${parsed.protocol}//${parsed.username}:****@${parsed.host}${parsed.pathname}`;
        } catch {
          maskedUrl = currentUrl.substring(0, 15) + '...';
        }
      }

      res.json({
        ...status,
        provider: 'Neon.tech PostgreSQL',
        databaseUrlMasked: maskedUrl,
        hasEnvUrl: !!process.env.DATABASE_URL,
      });
    } catch (err: any) {
      res.status(500).json({
        configured: false,
        connected: false,
        missingTables: ['config', 'products', 'sales'],
        error: err.message || 'Error al comprobar estado de la base de datos',
      });
    }
  });

  // 2. Probar una URL de conexión de Neon específica
  app.post('/api/db/test-connection', async (req, res) => {
    try {
      const { databaseUrl } = req.body;
      if (!databaseUrl || typeof databaseUrl !== 'string') {
        res.status(400).json({ success: false, message: 'Falta el parámetro databaseUrl' });
        return;
      }
      const normalized = normalizeNeonUrl(databaseUrl);
      const testResult = await checkNeonConnection(normalized);

      if (testResult.connected && testResult.missingTables.length === 0) {
        res.json({
          success: true,
          stage: 'connected',
          missingTables: [],
          message: '¡Conexión exitosa a PostgreSQL en Neon.tech! Todas las tablas requeridas están listas.',
        });
      } else if (testResult.connected) {
        res.json({
          success: false,
          stage: 'missing_tables',
          missingTables: testResult.missingTables,
          message: `Conectado a Neon, pero faltan tablas: ${testResult.missingTables.join(', ')}. Puedes crearlas automáticamente con el botón de inicialización.`,
        });
      } else {
        res.json({
          success: false,
          stage: 'connection_error',
          missingTables: testResult.missingTables,
          message: testResult.error || 'No se pudo conectar a Neon PostgreSQL. Verifica tu connection string.',
        });
      }
    } catch (err: any) {
      res.status(500).json({
        success: false,
        stage: 'server_error',
        missingTables: [],
        message: err.message || 'Error al verificar conexión.',
      });
    }
  });

  // 3. Guardar / configurar connection string
  app.post('/api/db/configure', async (req, res) => {
    try {
      const { databaseUrl } = req.body;
      if (databaseUrl) {
        const normalized = normalizeNeonUrl(databaseUrl);
        setRuntimeDatabaseUrl(normalized);
      } else {
        setRuntimeDatabaseUrl(null);
      }

      const status = await checkNeonConnection();
      res.json({
        success: status.connected,
        status,
        message: status.connected ? 'Base de datos Neon conectada y configurada correctamente.' : (status.error || 'Configuración guardada.'),
      });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // 4. Inicializar / crear tablas en Neon (CREATE TABLE IF NOT EXISTS)
  app.post('/api/db/init-tables', async (req, res) => {
    try {
      const { databaseUrl } = req.body;
      const targetUrl = databaseUrl ? normalizeNeonUrl(databaseUrl) : undefined;
      const result = await initTables(targetUrl);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message || 'Error creando tablas en Neon' });
    }
  });

  // 5. Configuración (exchangeRate, criticalThreshold)
  app.get('/api/db/config', async (req, res) => {
    try {
      const config = await getConfigMap();
      res.json(config);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/db/config', async (req, res) => {
    try {
      const { key, value } = req.body;
      if (!key) {
        res.status(400).json({ error: 'Falta key' });
        return;
      }
      await setConfigValue(key, String(value ?? ''));
      res.json({ success: true, key, value });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Productos / Inventario (SELECT * FROM public.inventario)
  const handleGetInventory = async (req: express.Request, res: express.Response) => {
    try {
      const products = await getProducts();
      // Si el cliente solicita formato { rows }, devolvemos el objeto con rows
      if (req.query.format === 'rows') {
        res.json({ success: true, rows: products, count: products.length });
      } else {
        res.json(products);
      }
    } catch (err: any) {
      console.error('[API /api/db/products] Error al obtener productos de Neon:', err);
      res.status(500).json({ error: err.message, rows: [] });
    }
  };

  app.get('/api/db/products', handleGetInventory);
  app.get('/api/db/inventario', handleGetInventory);

  const handlePostInventory = async (req: express.Request, res: express.Response) => {
    try {
      const product = req.body;
      if (!product || (!product.id && !product.name)) {
        res.status(400).json({ error: 'Datos de producto inválidos (falta id o nombre)' });
        return;
      }
      if (!product.id) {
        product.id = `prod-${Date.now()}`;
      }
      await upsertProduct(product);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API POST /api/db/products] Error al guardar producto en Neon:', err);
      res.status(500).json({ error: err.message });
    }
  };

  app.post('/api/db/products', handlePostInventory);
  app.post('/api/db/inventario', handlePostInventory);

  const handleDeleteInventory = async (req: express.Request, res: express.Response) => {
    try {
      const { id } = req.params;
      await deleteProduct(id);
      res.json({ success: true });
    } catch (err: any) {
      console.error('[API DELETE /api/db/products] Error al eliminar producto en Neon:', err);
      res.status(500).json({ error: err.message });
    }
  };

  app.delete('/api/db/products/:id', handleDeleteInventory);
  app.delete('/api/db/inventario/:id', handleDeleteInventory);

  // 7. Ventas
  app.get('/api/db/sales', async (req, res) => {
    try {
      const sales = await getSales();
      res.json(sales);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/db/sales', async (req, res) => {
    try {
      const { sale, updatedInventory } = req.body;
      if (!sale || !sale.id) {
        res.status(400).json({ error: 'Datos de venta inválidos' });
        return;
      }
      await saveSaleTransaction(sale, updatedInventory);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/db/sales/:id', async (req, res) => {
    try {
      const { id } = req.params;
      await deleteSale(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/db/sales/:id', async (req, res) => {
    try {
      const sale = req.body;
      if (!sale || !sale.id) {
        res.status(400).json({ error: 'Datos de venta inválidos' });
        return;
      }
      await updateSale(sale);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-inicializar tablas si DATABASE_URL ya está configurada
  if (getDatabaseUrl()) {
    initTables().then(() => {
      console.log('✅ Tablas de Neon PostgreSQL verificadas/inicializadas automáticamente');
    }).catch(e => {
      console.warn('ℹ️ Neon auto-init notice:', e.message);
    });
  }

  // --- Vite Middleware para Desarrollo / Estáticos para Producción ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor ejecutándose en http://0.0.0.0:${PORT} con soporte para Neon PostgreSQL`);
  });
}

startServer().catch(err => {
  console.error('Fatal error starting server:', err);
});
