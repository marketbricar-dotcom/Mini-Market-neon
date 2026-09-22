import { Product, Sale, ProductCategory, Currency, PaymentMethod } from '../types';

const STORAGE_KEY_NEON_URL = 'bricar_neon_database_url';

let localNeonUrl = '';
try {
  localNeonUrl = localStorage.getItem(STORAGE_KEY_NEON_URL) || '';
} catch (e) {
  localNeonUrl = '';
}

let isConfiguredState = true;
let isConnectedState = false;

export const databaseService = {
  /**
   * Indica si la base de datos está configurada (por variable de entorno en el servidor o URL local)
   */
  isEnabled(): boolean {
    return isConfiguredState || !!localNeonUrl;
  },

  /**
   * Obtiene las credenciales actuales
   */
  getCredentials() {
    return {
      url: localNeonUrl,
      anonKey: '', // Para compatibilidad
      isEnvConfigured: isConfiguredState && !localNeonUrl,
    };
  },

  /**
   * Actualiza la URL de conexión en el servidor y localmente
   */
  async updateCredentials(url: string): Promise<boolean> {
    const cleanedUrl = (url || '').trim();
    localNeonUrl = cleanedUrl;
    try {
      if (cleanedUrl) {
        localStorage.setItem(STORAGE_KEY_NEON_URL, cleanedUrl);
      } else {
        localStorage.removeItem(STORAGE_KEY_NEON_URL);
      }
    } catch (e) {}

    try {
      const resp = await fetch('/api/db/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: cleanedUrl }),
      });
      const data = await resp.json();
      isConfiguredState = !!data.status?.configured;
      isConnectedState = !!data.status?.connected;
      return !!data.success;
    } catch (err) {
      console.warn('Error configurando URL en el servidor:', err);
      return false;
    }
  },

  /**
   * Prueba una cadena de conexión a Neon PostgreSQL
   */
  async testConnectionDetails(databaseUrl: string): Promise<{
    success: boolean;
    stage: 'invalid_url' | 'network_error' | 'auth_error' | 'missing_tables' | 'connected' | 'connection_error' | 'server_error';
    missingTables: string[];
    message: string;
  }> {
    if (!databaseUrl || !databaseUrl.trim()) {
      return {
        success: false,
        stage: 'invalid_url',
        missingTables: ['config', 'products', 'sales'],
        message: 'Por favor ingresa la cadena de conexión DATABASE_URL de Neon (ejemplo: postgresql://usuario:clave@ep-xyz.neon.tech/neondb?sslmode=require)',
      };
    }

    try {
      const resp = await fetch('/api/db/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: databaseUrl.trim() }),
      });
      const data = await resp.json();
      return data;
    } catch (err: any) {
      return {
        success: false,
        stage: 'network_error',
        missingTables: [],
        message: err.message || 'Error de red al conectar con el servidor backend.',
      };
    }
  },

  /**
   * Crea automáticamente las tablas requeridas en Neon
   */
  async initTables(databaseUrl?: string): Promise<{ success: boolean; message: string }> {
    try {
      const resp = await fetch('/api/db/init-tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ databaseUrl: databaseUrl || localNeonUrl }),
      });
      const data = await resp.json();
      return data;
    } catch (err: any) {
      return { success: false, message: err.message || 'Error al inicializar tablas en Neon' };
    }
  },

  /**
   * Verifica el estado de la conexión en el servidor
   */
  async checkConnection(): Promise<{
    success: boolean;
    configured?: boolean;
    missingTables: string[];
    error?: string;
    isOffline?: boolean;
    databaseUrlMasked?: string;
  }> {
    try {
      const resp = await fetch('/api/db/status');
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      isConfiguredState = !!data.configured;
      isConnectedState = !!data.connected;

      return {
        success: !!data.connected && (!data.missingTables || data.missingTables.length === 0),
        configured: !!data.configured,
        missingTables: data.missingTables || [],
        error: data.error,
        isOffline: false,
        databaseUrlMasked: data.databaseUrlMasked,
      };
    } catch (err: any) {
      return {
        success: false,
        configured: isConfiguredState,
        missingTables: ['config', 'products', 'sales'],
        isOffline: true,
        error: 'No se pudo comunicar con el servidor backend local.',
      };
    }
  },

  /**
   * Tasa de cambio
   */
  async fetchExchangeRate(fallbackRate: number): Promise<number> {
    try {
      const resp = await fetch('/api/db/config');
      if (!resp.ok) return fallbackRate;
      const data = await resp.json();
      if (data && data.exchangeRate) {
        const val = parseFloat(data.exchangeRate);
        return isNaN(val) ? fallbackRate : val;
      }
      return fallbackRate;
    } catch {
      return fallbackRate;
    }
  },

  async saveExchangeRate(rate: number): Promise<boolean> {
    try {
      const resp = await fetch('/api/db/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'exchangeRate', value: String(rate) }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Umbral crítico de stock
   */
  async fetchCriticalThreshold(fallback: number): Promise<number> {
    try {
      const resp = await fetch('/api/db/config');
      if (!resp.ok) return fallback;
      const data = await resp.json();
      if (data && data.criticalThreshold) {
        const val = parseInt(data.criticalThreshold, 10);
        return isNaN(val) ? fallback : val;
      }
      return fallback;
    } catch {
      return fallback;
    }
  },

  async saveCriticalThreshold(threshold: number): Promise<boolean> {
    try {
      const resp = await fetch('/api/db/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'criticalThreshold', value: String(threshold) }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Productos / Inventario (SELECT * FROM public.inventario)
   */
  async fetchInventory(): Promise<Product[]> {
    try {
      console.log('[databaseService] Consultando inventario desde Neon PostgreSQL (/api/db/products)...');
      const resp = await fetch('/api/db/products');
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        console.error('[databaseService] Error en respuesta de inventario:', resp.status, errData);
        return [];
      }
      const data = await resp.json();

      // Manejar tanto si la respuesta devuelve el arreglo directo como si devuelve un objeto con propiedad rows
      const rows = Array.isArray(data)
        ? data
        : (Array.isArray(data?.rows) ? data.rows : (Array.isArray(data?.products) ? data.products : []));

      console.log(`[databaseService] Se recibieron ${rows.length} filas de inventario desde el backend.`);

      return rows.map((item: any, idx: number) => {
        // Función auxiliar para buscar campos con diferentes nombres posibles
        const getVal = (...keys: string[]): any => {
          for (const k of keys) {
            if (item[k] !== undefined && item[k] !== null) return item[k];
          }
          const itemKeys = Object.keys(item);
          for (const k of keys) {
            const match = itemKeys.find(ik => ik.toLowerCase() === k.toLowerCase());
            if (match && item[match] !== undefined && item[match] !== null) return item[match];
          }
          return undefined;
        };

        const id = String(getVal('id', 'codigo', 'id_producto') || `prod-${idx + 1}`);
        const name = String(getVal('name', 'nombre', 'descripcion', 'producto') || 'Producto sin nombre');
        
        let category = (getVal('category', 'categoria', 'rubro') || ProductCategory.OTROS) as ProductCategory;
        if (!Object.values(ProductCategory).includes(category)) {
          category = ProductCategory.OTROS;
        }

        const rawPrice = getVal('price', 'precio', 'precio_usd', 'pvp');
        const price = typeof rawPrice === 'number' ? rawPrice : (parseFloat(String(rawPrice || '0').replace(',', '.')) || 0);

        let rawCurrency = String(getVal('currency', 'moneda') || 'USD').toUpperCase();
        const currency = (rawCurrency.includes('BS') || rawCurrency.includes('VES')) ? Currency.BSF : Currency.USD;

        const unit = String(getVal('unit', 'unidad', 'medida') || 'Unidad');
        
        const rawUnitsPerCase = getVal('unitsPerCase', 'units_per_case', 'unidades_por_caja', 'unidades_caja');
        const unitsPerCase = Number(rawUnitsPerCase) > 0 ? Number(rawUnitsPerCase) : 1;

        const rawStock = getVal('stock', 'cantidad', 'existencia');
        const stock = typeof rawStock === 'number' ? rawStock : (parseFloat(String(rawStock || '0').replace(',', '.')) || 0);

        const barcode = String(getVal('barcode', 'codigo_barra', 'codigo_barras', 'codigo') || '');

        const rawCost = getVal('cost', 'costo', 'costo_usd');
        const cost = typeof rawCost === 'number' ? rawCost : (parseFloat(String(rawCost || '0').replace(',', '.')) || 0);

        const rawProfit = getVal('profitMargin', 'profit_margin', 'margen', 'ganancia');
        const profitMargin = typeof rawProfit === 'number' ? rawProfit : (parseFloat(String(rawProfit || '0').replace(',', '.')) || 0);

        return {
          id,
          name,
          category,
          price,
          currency,
          unit,
          unitsPerCase,
          stock,
          barcode,
          cost,
          profitMargin,
        };
      });
    } catch (err) {
      console.error('[databaseService] Error en fetchInventory:', err);
      return [];
    }
  },

  async saveProduct(product: Product, _isNew: boolean): Promise<boolean> {
    try {
      const resp = await fetch('/api/db/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(product),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Guardado en bloque (Batch) de productos en Neon
   */
  async saveProductsBatch(products: Product[]): Promise<boolean> {
    try {
      if (!Array.isArray(products) || products.length === 0) return true;
      const resp = await fetch('/api/db/products/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  async deleteProduct(productId: string): Promise<boolean> {
    try {
      const resp = await fetch(`/api/db/products/${encodeURIComponent(productId)}`, {
        method: 'DELETE',
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Ventas
   */
  async fetchSales(): Promise<Sale[]> {
    try {
      const resp = await fetch('/api/db/sales');
      if (!resp.ok) return [];
      const data = await resp.json();
      if (!Array.isArray(data)) return [];

      return data.map((item: any) => ({
        id: item.id,
        timestamp: Number(item.timestamp) || Date.now(),
        items: Array.isArray(item.items) ? item.items : [],
        totalUSD: Number(item.totalUSD) || 0,
        totalBsF: Number(item.totalBsF) || 0,
        rateAtSale: Number(item.rateAtSale) || 36.5,
        paymentMethod: (item.paymentMethod as PaymentMethod) || PaymentMethod.EFECTIVO_USD,
        customerName: item.customerName || undefined,
        paymentReference: item.paymentReference || undefined,
      }));
    } catch (err) {
      console.warn('Error obteniendo ventas de Neon:', err);
      return [];
    }
  },

  async saveSale(sale: Sale, updatedInventory: Product[]): Promise<boolean> {
    try {
      const resp = await fetch('/api/db/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sale, updatedInventory }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  async deleteSale(saleId: string): Promise<boolean> {
    try {
      const resp = await fetch(`/api/db/sales/${encodeURIComponent(saleId)}`, {
        method: 'DELETE',
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  async updateSale(sale: Sale): Promise<boolean> {
    try {
      const resp = await fetch(`/api/db/sales/${encodeURIComponent(sale.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sale),
      });
      return resp.ok;
    } catch {
      return false;
    }
  },

  /**
   * Sincronización en tiempo real multiplataforma (SSE Push + Polling de Respaldo)
   * Asegura que cualquier cambio en una PC o teléfono se refleje inmediatamente en todos los demás dispositivos.
   */
  subscribeToRealtime(onDataChanged: (tableName: string) => void): (() => void) {
    let eventSource: EventSource | null = null;
    let fallbackInterval: any = null;

    try {
      if (typeof window !== 'undefined' && 'EventSource' in window) {
        eventSource = new EventSource('/api/db/events');

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data && data.type) {
              if (data.type === 'connected') return;
              console.log(`[Neon Realtime SSE] Cambio detectado: ${data.type}`);
              onDataChanged(data.type);
            }
          } catch {
            onDataChanged('all');
          }
        };

        eventSource.onerror = () => {
          // EventSource se reconecta automáticamente en navegadores
        };
      }
    } catch (e) {
      console.warn('[Neon Realtime] Error inicializando SSE, usando polling:', e);
    }

    // Polling ligero de respaldo por si el teléfono pierde SSE o está en background
    fallbackInterval = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        try {
          const resp = await fetch('/api/db/version');
          if (resp.ok) {
            const { version } = await resp.json();
            const lastVersion = (window as any).__neon_last_version;
            if (lastVersion && version && version !== lastVersion) {
              console.log('[Neon Realtime Polling] Nueva versión de datos detectada en Neon');
              onDataChanged('all');
            }
            (window as any).__neon_last_version = version;
          }
        } catch {
          // Ignorar fallo de red puntual
        }
      }
    }, 3500);

    return () => {
      if (eventSource) {
        try {
          eventSource.close();
        } catch {}
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };
  },

  setRlsErrorListener(_listener: (tableName: string, errorMsg: string) => void) {
    // No RLS in direct PostgreSQL on Neon!
  },
};

// Exportar también como supabaseService para retrocompatibilidad total
export const supabaseService = databaseService;
