import React, { useState, useEffect, useMemo } from 'react';
import ExchangeRate from './components/ExchangeRate';
import Inventory from './components/Inventory';
import SalesSystem from './components/SalesSystem';
import Reports from './components/Reports';
import Credits from './components/Credits';
import AIAssistant from './components/AIAssistant';
import { PublicCatalog } from './components/PublicCatalog';
import { Product, Sale } from './types';
import { supabaseService } from './services/supabaseService';
import { safeSetItem, safeGetItem, safeRemoveItem, cleanStorageQuota } from './services/storageService';

export interface SyncStatus {
  connected: boolean;
  sheetsConfigured: boolean; // Indica si las tablas de Supabase están listas y configuradas
  missingSheets: string[]; // Lista de tablas faltantes en Supabase
  loading: boolean;
  error?: string;
  dbType: 'Supabase' | 'None';
}

import { 
  LayoutDashboard, 
  ShoppingCart, 
  Package, 
  BrainCircuit, 
  Calculator, 
  Cloud, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  X, 
  Copy, 
  RefreshCw,
  User, 
  Download,
  Smartphone,
  HelpCircle,
  ExternalLink,
  Check,
  Database,
  Sparkles,
  BookOpen,
  Key,
  Link2,
  Store
} from 'lucide-react';

const App: React.FC = () => {
  // --- Estados Persistentes (Caché local fallback) ---
  const [rate, setRate] = useState<number>(() => {
    const saved = safeGetItem('venstore_rate');
    return saved ? parseFloat(saved) : 36.5; // Tasa por defecto
  });

  const [inventory, setInventory] = useState<Product[]>(() => {
    const saved = safeGetItem('venstore_inventory');
    if (!saved) return [];
    try {
      return JSON.parse(saved);
    } catch {
      return [];
    }
  });

  const [sales, setSales] = useState<Sale[]>(() => {
    const saved = safeGetItem('venstore_sales');
    if (!saved) return [];
    try {
      const parsed: Sale[] = JSON.parse(saved);
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      return Array.isArray(parsed) 
        ? parsed.filter(s => s && typeof s.timestamp === 'number' && s.timestamp >= oneYearAgo) 
        : [];
    } catch {
      return [];
    }
  });

  // Detección de vista pública/cliente directa desde URL (?tab=CATALOG o ?public=true o ?catalogo=1)
  const isStandalonePublicCatalog = useMemo(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('public') === 'true' || urlParams.get('standalone') === 'true';
    } catch {
      return false;
    }
  }, []);

  const [activeTab, setActiveTab] = useState<'RATE' | 'INVENTORY' | 'SALES' | 'CREDITS' | 'REPORTS' | 'AI' | 'CATALOG'>(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const tabParam = (urlParams.get('tab') || urlParams.get('view') || '').toUpperCase();
      if (tabParam === 'CATALOG' || urlParams.get('catalogo') === 'true' || urlParams.get('catalogo') === '1') {
        return 'CATALOG';
      }
    } catch {
      // fallback
    }
    return 'SALES';
  });

  const [criticalThreshold, setCriticalThreshold] = useState<number>(() => {
    const saved = safeGetItem('venstore_critical_threshold');
    return saved ? parseInt(saved, 10) : 5; // Stock crítico por defecto
  });

  const criticalProducts = useMemo(() => {
    return Array.isArray(inventory) 
      ? inventory.filter(p => p && typeof p.stock === 'number' && p.stock <= criticalThreshold)
      : [];
  }, [inventory, criticalThreshold]);

  // --- Estados de Sincronización de Base de Datos ---
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    connected: false,
    sheetsConfigured: false,
    missingSheets: [],
    loading: true,
    dbType: 'None'
  });
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [showBackupPanel, setShowBackupPanel] = useState(false);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);

  // Referencias para evitar clausuras obsoletas (stale closures) en callbacks asíncronos
  const inventoryRef = React.useRef(inventory);
  const salesRef = React.useRef(sales);
  const rateRef = React.useRef(rate);
  const criticalThresholdRef = React.useRef(criticalThreshold);

  React.useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);

  React.useEffect(() => {
    salesRef.current = sales;
  }, [sales]);

  React.useEffect(() => {
    rateRef.current = rate;
  }, [rate]);

  React.useEffect(() => {
    criticalThresholdRef.current = criticalThreshold;
  }, [criticalThreshold]);

  // Estados para configuración de Neon PostgreSQL (DATABASE_URL)
  const [dbConfigUrl, setDbConfigUrl] = useState(() => supabaseService.getCredentials().url);
  const [dbConfigKey, setDbConfigKey] = useState(() => supabaseService.getCredentials().anonKey);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [modalTab, setModalTab] = useState<'CONFIG' | 'GUIDE' | 'QR'>('CONFIG');
  const [testingConnection, setTestingConnection] = useState(false);
  const [initializingTables, setInitializingTables] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    stage: 'invalid_url' | 'network_error' | 'auth_error' | 'missing_tables' | 'connected' | 'connection_error' | 'server_error';
    missingTables: string[];
    message: string;
  } | null>(null);

  const [rlsErrorState, setRlsErrorState] = useState<{ tableName: string; errorMsg: string } | null>(null);
  const [phoneConnectedToast, setPhoneConnectedToast] = useState(false);

  useEffect(() => {
    supabaseService.setRlsErrorListener((tableName, errorMsg) => {
      setRlsErrorState({ tableName, errorMsg });
    });
  }, []);

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    const result = await supabaseService.testConnectionDetails(dbConfigUrl);
    setTestResult(result);
    setTestingConnection(false);
  };

  const handleDbSaveAndConnect = async () => {
    setRlsErrorState(null);
    await supabaseService.updateCredentials(dbConfigUrl);
    setSaveSuccess(true);
    setTestingConnection(true);
    const result = await supabaseService.testConnectionDetails(dbConfigUrl);
    setTestResult(result);
    setTestingConnection(false);
    await syncWithDatabase();
  };

  const handleInitTables = async () => {
    setInitializingTables(true);
    try {
      const res = await (supabaseService as any).initTables(dbConfigUrl);
      if (res.success) {
        setSaveSuccess(true);
        await handleTestConnection();
        await syncWithDatabase();
      } else {
        alert(res.message || 'Error al inicializar tablas en Neon');
      }
    } catch (err: any) {
      alert(err.message || 'Error al inicializar tablas en Neon');
    } finally {
      setInitializingTables(false);
    }
  };

  // --- Guardar en LocalStorage de forma ultra-segura cada vez que cambien los estados ---
  useEffect(() => {
    safeSetItem('venstore_rate', rate.toString());
  }, [rate]);

  useEffect(() => {
    if (inventory && inventory.length > 0) {
      safeSetItem('venstore_inventory', JSON.stringify(inventory));
    } else {
      const saved = safeGetItem('venstore_inventory');
      if (!saved || saved === '[]') {
        safeSetItem('venstore_inventory', JSON.stringify(inventory));
      }
    }
  }, [inventory]);

  useEffect(() => {
    if (sales && sales.length > 0) {
      safeSetItem('venstore_sales', JSON.stringify(sales));
    } else {
      const saved = safeGetItem('venstore_sales');
      if (!saved || saved === '[]') {
        safeSetItem('venstore_sales', JSON.stringify(sales));
      }
    }
  }, [sales]);

  useEffect(() => {
    safeSetItem('venstore_critical_threshold', criticalThreshold.toString());
  }, [criticalThreshold]);

  // --- Helpers de la cola de sincronización Offline ---
  const getPendingQueue = () => {
    try {
      return {
        sales: JSON.parse(safeGetItem('pending_sales') || '[]') as Sale[],
        saleDeletions: JSON.parse(safeGetItem('pending_sale_deletions') || '[]') as string[],
        products: JSON.parse(safeGetItem('pending_products') || '[]') as Product[],
        productDeletions: JSON.parse(safeGetItem('pending_product_deletions') || '[]') as string[],
        rate: safeGetItem('pending_rate') ? parseFloat(safeGetItem('pending_rate')!) : null,
        threshold: safeGetItem('pending_threshold') ? parseInt(safeGetItem('pending_threshold')!, 10) : null,
      };
    } catch {
      return { sales: [], saleDeletions: [], products: [], productDeletions: [], rate: null, threshold: null };
    }
  };

  const savePendingQueue = (queue: ReturnType<typeof getPendingQueue>) => {
    safeSetItem('pending_sales', JSON.stringify(queue.sales));
    safeSetItem('pending_sale_deletions', JSON.stringify(queue.saleDeletions));
    safeSetItem('pending_products', JSON.stringify(queue.products));
    safeSetItem('pending_product_deletions', JSON.stringify(queue.productDeletions));
    if (queue.rate !== null) safeSetItem('pending_rate', queue.rate.toString());
    else safeRemoveItem('pending_rate');
    if (queue.threshold !== null) safeSetItem('pending_threshold', queue.threshold.toString());
    else safeRemoveItem('pending_threshold');
  };

  // Mezcla datos locales guardados y en memoria con lo que viene de la nube sin perder transacciones
  const mergeDbAndLocalQueue = (dbRate: number, dbInventory: Product[], dbSales: Sale[], dbThreshold: number) => {
    const queue = getPendingQueue();

    // --- 1. UNIFICAR VENTAS ---
    let savedLocalSales: Sale[] = [];
    try {
      const raw = safeGetItem('venstore_sales');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) savedLocalSales = parsed;
      }
    } catch {
      savedLocalSales = [];
    }

    const salesMap = new Map<string, Sale>();

    // Cargar de localStorage y estado actual en memoria
    (Array.isArray(savedLocalSales) ? savedLocalSales : []).forEach(s => { if (s && s.id) salesMap.set(s.id, s); });
    (Array.isArray(salesRef.current) ? salesRef.current : []).forEach(s => { if (s && s.id) salesMap.set(s.id, s); });

    // Cargar lo retornado de Supabase
    (Array.isArray(dbSales) ? dbSales : []).forEach(s => { if (s && s.id) salesMap.set(s.id, s); });

    // Aplicar eliminaciones pendientes
    const safeSaleDeletions = Array.isArray(queue.saleDeletions) ? queue.saleDeletions : [];
    if (safeSaleDeletions.length > 0) {
      safeSaleDeletions.forEach(delId => salesMap.delete(delId));
    }

    // Aplicar ventas pendientes en la cola (las más recientes locales)
    const safeQueueSales = Array.isArray(queue.sales) ? queue.sales : [];
    safeQueueSales.forEach(qs => { if (qs && qs.id) salesMap.set(qs.id, qs); });

    const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const mergedSales = Array.from(salesMap.values())
      .filter(s => s && typeof s.id === 'string' && typeof s.timestamp === 'number' && s.timestamp >= oneYearAgo)
      .sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));


    // --- 2. UNIFICAR INVENTARIO ---
    let savedLocalInventory: Product[] = [];
    try {
      const raw = safeGetItem('venstore_inventory');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) savedLocalInventory = parsed;
      }
    } catch {
      savedLocalInventory = [];
    }

    const inventoryMap = new Map<string, Product>();

    if (Array.isArray(dbInventory) && dbInventory.length > 0) {
      // Si la base de datos respondió productos, ellos son la fuente de la verdad
      dbInventory.forEach(p => { if (p && p.id) inventoryMap.set(p.id, p); });
    } else {
      // Si la base de datos no tiene productos aún o está offline, usar caché local
      (Array.isArray(savedLocalInventory) ? savedLocalInventory : []).forEach(p => { if (p && p.id) inventoryMap.set(p.id, p); });
      (Array.isArray(inventoryRef.current) ? inventoryRef.current : []).forEach(p => { if (p && p.id) inventoryMap.set(p.id, p); });
    }

    const safeProdDeletions = Array.isArray(queue.productDeletions) ? queue.productDeletions : [];
    if (safeProdDeletions.length > 0) {
      safeProdDeletions.forEach(delId => inventoryMap.delete(delId));
    }

    const safeQueueProducts = Array.isArray(queue.products) ? queue.products : [];
    safeQueueProducts.forEach(qp => { if (qp && qp.id) inventoryMap.set(qp.id, qp); });

    const mergedInventory = Array.from(inventoryMap.values())
      .filter(p => p && typeof p.id === 'string')
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    // Guardar copia local sincronizada
    if (mergedInventory.length > 0) {
      safeSetItem('venstore_inventory', JSON.stringify(mergedInventory));
    }

    const finalRate = queue.rate !== null ? queue.rate : (typeof dbRate === 'number' && !isNaN(dbRate) ? dbRate : rateRef.current);
    const finalThreshold = queue.threshold !== null ? queue.threshold : (typeof dbThreshold === 'number' && !isNaN(dbThreshold) ? dbThreshold : criticalThresholdRef.current);

    return {
      rate: finalRate,
      inventory: mergedInventory,
      sales: mergedSales,
      threshold: finalThreshold
    };
  };

  // Sube todos los cambios pendientes acumulados localmente a Supabase
  const processSyncQueue = async (): Promise<boolean> => {
    if (!supabaseService.isEnabled()) return false;

    try {
      const conn = await supabaseService.checkConnection();
      if (!conn.success) return false;

      const queue = getPendingQueue();
      let queueModified = false;

      // 1. Sincronizar tasa de cambio
      if (queue.rate !== null) {
        const ok = await supabaseService.saveExchangeRate(queue.rate);
        if (ok) {
          queue.rate = null;
          queueModified = true;
        }
      }

      // 2. Sincronizar stock crítico
      if (queue.threshold !== null) {
        const ok = await supabaseService.saveCriticalThreshold(queue.threshold);
        if (ok) {
          queue.threshold = null;
          queueModified = true;
        }
      }

      // 3. Sincronizar eliminaciones de productos
      if (queue.productDeletions.length > 0) {
        const remaining: string[] = [];
        for (const id of queue.productDeletions) {
          const ok = await supabaseService.deleteProduct(id);
          if (!ok) remaining.push(id);
        }
        if (remaining.length !== queue.productDeletions.length) {
          queue.productDeletions = remaining;
          queueModified = true;
        }
      }

      // 4. Sincronizar productos nuevos/actualizados
      if (queue.products.length > 0) {
        const remaining: Product[] = [];
        for (const prod of queue.products) {
          const ok = await supabaseService.saveProduct(prod, false);
          if (!ok) remaining.push(prod);
        }
        if (remaining.length !== queue.products.length) {
          queue.products = remaining;
          queueModified = true;
        }
      }

      // 5. Sincronizar eliminaciones de ventas
      if (queue.saleDeletions.length > 0) {
        const remaining: string[] = [];
        for (const id of queue.saleDeletions) {
          const ok = await supabaseService.deleteSale(id);
          if (!ok) remaining.push(id);
        }
        if (remaining.length !== queue.saleDeletions.length) {
          queue.saleDeletions = remaining;
          queueModified = true;
        }
      }

      // 6. Sincronizar ventas y abonos
      if (queue.sales.length > 0) {
        const remaining: Sale[] = [];
        for (const sale of queue.sales) {
          const ok = await supabaseService.saveSale(sale, inventoryRef.current);
          if (!ok) remaining.push(sale);
        }
        if (remaining.length !== queue.sales.length) {
          queue.sales = remaining;
          queueModified = true;
        }
      }

      if (queueModified) {
        savePendingQueue(queue);
      }

      const freshQueue = getPendingQueue();
      const allDone = freshQueue.sales.length === 0 &&
                      freshQueue.saleDeletions.length === 0 &&
                      freshQueue.products.length === 0 &&
                      freshQueue.productDeletions.length === 0 &&
                      freshQueue.rate === null &&
                      freshQueue.threshold === null;

      return allDone;
    } catch (err) {
      console.error('Error al procesar la cola de sincronización:', err);
      return false;
    }
  };

  // Dispara la sincronización con Neon para refrescar los datos más recientes
  const triggerBackgroundSync = (force?: boolean) => {
    if (backgroundSyncing && !force) return;
    setBackgroundSyncing(true);
    setTimeout(async () => {
      try {
        if (supabaseService.isEnabled()) {
          await processSyncQueue();
        }

        let dbRate = rateRef.current;
        let dbInventory: Product[] = [];
        let dbSales: Sale[] = [];
        let dbThreshold = criticalThresholdRef.current;

        if (supabaseService.isEnabled()) {
          try {
            const [freshRate, freshInv, freshSales, freshThreshold] = await Promise.all([
              supabaseService.fetchExchangeRate(rateRef.current).catch(() => rateRef.current),
              supabaseService.fetchInventory().catch(() => []),
              supabaseService.fetchSales().catch(() => []),
              supabaseService.fetchCriticalThreshold(criticalThresholdRef.current).catch(() => criticalThresholdRef.current)
            ]);
            dbRate = freshRate;
            dbInventory = freshInv;
            dbSales = freshSales;
            dbThreshold = freshThreshold;
          } catch (e) {
            console.warn('Error fetching fresh DB data in background:', e);
          }
        }

        const merged = mergeDbAndLocalQueue(dbRate, dbInventory, dbSales, dbThreshold);
        setRate(merged.rate);
        setInventory(merged.inventory);
        setSales(merged.sales);
        setCriticalThreshold(merged.threshold);

        if (supabaseService.isEnabled()) {
          setSyncStatus(prev => ({
            ...prev,
            connected: true,
            sheetsConfigured: true,
            missingSheets: [],
            loading: false,
            dbType: 'Neon PostgreSQL'
          }));
        }
      } catch (err) {
        console.warn('La sincronización asíncrona falló:', err);
      } finally {
        setBackgroundSyncing(false);
      }
    }, 50);
  };

  // --- Consultar a Neon (fetchInventory) cada vez que cambie de pestaña en la aplicación ---
  const isFirstMountTabRef = React.useRef(true);
  useEffect(() => {
    if (isFirstMountTabRef.current) {
      isFirstMountTabRef.current = false;
      return;
    }
    if (supabaseService.isEnabled()) {
      console.log(`[Neon DB] Cambio de pestaña a "${activeTab}". Consultando Neon (fetchInventory) para refrescar datos...`);
      triggerBackgroundSync(true);
    }
  }, [activeTab]);

  // --- Sincronizar al iniciar o al hacer clic manual ---
  const syncWithDatabase = async () => {
    setRlsErrorState(null);
    setSyncStatus(prev => ({ ...prev, loading: true, error: undefined }));
    try {
      const conn = await supabaseService.checkConnection();
      if (conn.success) {
        // 1. Sincronizar cola local pendiente primero
        const allProcessed = await processSyncQueue();
        
        // 2. Traer el estado fresco de Neon PostgreSQL
        let dbRate = rate;
        let dbInventory: Product[] = [];
        let dbSales: Sale[] = [];
        let dbThreshold = criticalThreshold;

        try {
          dbRate = await supabaseService.fetchExchangeRate(rate);
          dbInventory = await supabaseService.fetchInventory();
          dbSales = await supabaseService.fetchSales();
          dbThreshold = await supabaseService.fetchCriticalThreshold(criticalThreshold);
        } catch (e) {
          console.warn("Fallo al consultar Neon PostgreSQL en syncWithDatabase:", e);
        }

        // 3. Unificar base de datos con cualquier cambio local residual
        const merged = mergeDbAndLocalQueue(dbRate, dbInventory, dbSales, dbThreshold);

        setRate(merged.rate);
        setInventory(merged.inventory);
        setSales(merged.sales);
        setCriticalThreshold(merged.threshold);
        
        setSyncStatus({
          connected: true,
          sheetsConfigured: true,
          missingSheets: [],
          loading: false,
          dbType: 'Neon PostgreSQL',
          error: allProcessed ? undefined : 'Hay transacciones pendientes que no se pudieron sincronizar de inmediato.'
        });
      } else if (conn.isOffline) {
        // Modo sin conexión. No sobreescribir datos locales con vacíos, simplemente activar el "Modo Local"
        setSyncStatus({
          connected: false,
          sheetsConfigured: true,
          missingSheets: [],
          loading: false,
          error: 'Trabajando sin conexión (Modo Offline). Los datos se guardan en el navegador y se sincronizarán al recuperar internet.',
          dbType: 'Neon PostgreSQL'
        });
      } else if (conn.configured) {
        // Tablas incompletas o error en la base de datos
        setSyncStatus({
          connected: false,
          sheetsConfigured: false,
          missingSheets: conn.missingTables,
          loading: false,
          error: conn.error || 'Estructura de tablas incompleta en Neon PostgreSQL',
          dbType: 'Neon PostgreSQL'
        });
      } else {
        setSyncStatus({
          connected: false,
          sheetsConfigured: false,
          missingSheets: ['config', 'inventario', 'sales'],
          loading: false,
          error: 'Credenciales de Neon PostgreSQL no configuradas o incompletas.',
          dbType: 'Neon PostgreSQL'
        });
      }
    } catch (err: any) {
      setSyncStatus({
        connected: false,
        sheetsConfigured: false,
        missingSheets: [],
        loading: false,
        error: err?.message || 'Fallo al conectar con Neon PostgreSQL',
        dbType: 'Neon PostgreSQL'
      });
    }
  };

  useEffect(() => {
    supabaseService.setRlsErrorListener((tableName, msg) => {
      setRlsErrorState({ tableName, errorMsg: msg });
    });

    // Leer posibles credenciales compartidas vía enlace URL o código QR
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const paramUrl = urlParams.get('database_url') || urlParams.get('neon_url') || urlParams.get('supabase_url');
      if (paramUrl) {
        supabaseService.updateCredentials(paramUrl);
        setDbConfigUrl(paramUrl);
        setPhoneConnectedToast(true);
        // Limpiar parámetros de la URL de forma limpia
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } catch (e) {
      console.warn('Error leyendo credenciales de la URL:', e);
    }

    syncWithDatabase();

    // Suscripción WebSockets en Tiempo Real (Realtime Push Notification < 300ms)
    let unsubscribeRealtime: (() => void) | null = null;
    if (supabaseService.isEnabled()) {
      unsubscribeRealtime = supabaseService.subscribeToRealtime((tableName) => {
        console.log(`⚡ Evento en tiempo real recibido en la tabla '${tableName}'. Actualizando interfaz...`);
        triggerBackgroundSync();
      });
    }

    // Polling de respaldo en segundo plano cada 4 segundos
    const syncInterval = setInterval(() => {
      if (supabaseService.isEnabled()) {
        triggerBackgroundSync();
      }
    }, 4000);

    // Re-sincronizar al volver a la pestaña, al enfocar ventana o al recuperar internet
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && supabaseService.isEnabled()) {
        console.log('[Neon DB] Pestaña visible. Refrescando datos e inventario desde Neon...');
        triggerBackgroundSync(true);
      }
    };
    const handleFocus = () => {
      if (supabaseService.isEnabled()) {
        console.log('[Neon DB] Ventana enfocada. Refrescando datos e inventario desde Neon...');
        triggerBackgroundSync(true);
      }
    };
    const handleOnline = () => {
      if (supabaseService.isEnabled()) {
        console.log('[Neon DB] Conexión a internet restablecida. Sincronizando con Neon...');
        syncWithDatabase();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleOnline);

    return () => {
      if (unsubscribeRealtime) unsubscribeRealtime();
      clearInterval(syncInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  // --- Manejadores de Operaciones (Mutaciones con Sync dinámico automático) ---

  const handleAddProduct = async (product: Product) => {
    setInventory(prev => [...prev, product]);

    const queue = getPendingQueue();
    queue.products = [...queue.products.filter(p => p.id !== product.id), product];
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  const handleUpdateProduct = async (product: Product) => {
    setInventory(prev => prev.map(p => p.id === product.id ? product : p));

    const queue = getPendingQueue();
    queue.products = [...queue.products.filter(p => p.id !== product.id), product];
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  const handleDeleteProduct = async (id: string) => {
    setInventory(prev => prev.filter(p => p.id !== id));

    const queue = getPendingQueue();
    queue.products = queue.products.filter(p => p.id !== id);
    if (!queue.productDeletions.includes(id)) {
      queue.productDeletions.push(id);
    }
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  const handleUpdateRate = async (newRate: number) => {
    setRate(newRate);

    const queue = getPendingQueue();
    queue.rate = newRate;
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  const handleUpdateCriticalThreshold = async (newThreshold: number) => {
    setCriticalThreshold(newThreshold);

    const queue = getPendingQueue();
    queue.threshold = newThreshold;
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  // Registra ventas normales, créditos y abonos/liquidaciones
  const handleProcessSale = async (saleOrSales: Sale | Sale[], updatedInventory: Product[]) => {
    try {
      const rawSalesList = Array.isArray(saleOrSales) ? saleOrSales : [saleOrSales];
      const salesList = rawSalesList.filter(s => s && typeof s.id === 'string');
      if (salesList.length === 0) return;

      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      setSales(prev => {
        const safePrev = Array.isArray(prev) ? prev : [];
        return [
          ...safePrev.filter(s => s && typeof s.timestamp === 'number' && s.timestamp >= oneYearAgo), 
          ...salesList
        ];
      });

      const safeInventory = Array.isArray(updatedInventory) ? updatedInventory : [];
      setInventory(safeInventory);

      const queue = getPendingQueue();
      
      // Agregar ventas a la cola
      for (const sale of salesList) {
        queue.sales = [...queue.sales.filter(s => s && s.id !== sale.id), sale];
      }

      // Agregar stocks de productos involucrados en la venta a la cola para actualizar en Supabase
      for (const sale of salesList) {
        let itemsArray: any[] = [];
        try {
          if (typeof sale.items === 'string') {
            itemsArray = JSON.parse(sale.items);
          } else if (Array.isArray(sale.items)) {
            itemsArray = sale.items;
          }
        } catch {
          itemsArray = [];
        }

        for (const item of itemsArray) {
          if (item && !item.isManual && item.productId) {
            const prod = safeInventory.find(p => p && p.id === item.productId);
            if (prod) {
              queue.products = [...queue.products.filter(p => p && p.id !== prod.id), prod];
            }
          }
        }
      }

      savePendingQueue(queue);
      triggerBackgroundSync();
    } catch (err) {
      console.error('Error al procesar la venta en App:', err);
    }
  };

  // Elimina una venta (restando o devolviendo stocks automáticamente si aplica)
  const handleDeleteSale = async (saleId: string) => {
    const saleToDelete = sales.find(s => s.id === saleId);
    if (!saleToDelete) return;

    // Calcular inventario restaurado
    const updatedInventory = [...inventory];
    if (saleToDelete.items && Array.isArray(saleToDelete.items)) {
      saleToDelete.items.forEach(item => {
        if (!item.isManual && item.productId) {
          const idx = updatedInventory.findIndex(p => p.id === item.productId);
          if (idx !== -1) {
            updatedInventory[idx] = {
              ...updatedInventory[idx],
              stock: updatedInventory[idx].stock + item.quantity
            };
          }
        }
      });
    }

    setSales(prev => prev.filter(s => s.id !== saleId));
    setInventory(updatedInventory);

    const queue = getPendingQueue();
    
    queue.sales = queue.sales.filter(s => s.id !== saleId);
    if (!queue.saleDeletions.includes(saleId)) {
      queue.saleDeletions.push(saleId);
    }

    // Agregar productos actualizados a la cola
    if (saleToDelete.items && Array.isArray(saleToDelete.items)) {
      for (const item of saleToDelete.items) {
        if (!item.isManual && item.productId) {
          const prod = updatedInventory.find(p => p.id === item.productId);
          if (prod) {
            queue.products = [...queue.products.filter(p => p.id !== prod.id), prod];
          }
        }
      }
    }

    savePendingQueue(queue);
    triggerBackgroundSync();
  };

  const handleUpdateSale = async (updatedSale: Sale) => {
    setSales(prev => prev.map(s => s.id === updatedSale.id ? updatedSale : s));

    const queue = getPendingQueue();
    queue.sales = [...queue.sales.filter(s => s.id !== updatedSale.id), updatedSale];
    savePendingQueue(queue);

    triggerBackgroundSync();
  };

  // Helper para copiar texto al portapapeles
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('¡Copiado al portapapeles! Listo para pegar en el editor SQL de Supabase.');
  };

  // --- Escaneo e Historial de Copias de Seguridad de LocalStorage ---
  const [detectedBackups, setDetectedBackups] = useState<Array<{
    key: string;
    type: 'inventory' | 'sales' | 'unknown';
    count: number;
    preview: string;
    dayName?: string;
  }>>([]);

  const scanLocalStorage = () => {
    const found: typeof detectedBackups = [];
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const value = localStorage.getItem(key);
      if (!value) continue;
      
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Detectar si parece inventario o historial de ventas
          const sample = parsed[0];
          let type: 'inventory' | 'sales' | 'unknown' = 'unknown';
          let preview = '';
          
          if (sample && typeof sample === 'object') {
            if ('name' in sample && 'price' in sample) {
              type = 'inventory';
              preview = parsed.slice(0, 3).map((p: any) => p.name).join(', ') + (parsed.length > 3 ? '...' : '');
            } else if ('timestamp' in sample && ('totalUSD' in sample || 'items' in sample)) {
              type = 'sales';
              preview = `Venta o movimiento del cliente ${sample.customerName || 'General'} por $${Math.abs(sample.totalUSD).toFixed(2)}`;
            }
          }
          
          if (type !== 'unknown') {
            // Si el nombre de la clave termina en un número de día (0-6)
            let dayName = undefined;
            const match = key.match(/_day_(\d)$/);
            if (match) {
              const dayIndex = parseInt(match[1], 10);
              dayName = days[dayIndex] || undefined;
            }

            found.push({
              key,
              type,
              count: parsed.length,
              preview,
              dayName
            });
          }
        }
      } catch (e) {
        // Ignorar claves que no sean JSON válido o arrays
      }
    }
    
    // Ordenar para mostrar los de hoy o nombres conocidos más arriba
    found.sort((a, b) => {
      if (a.key.includes('backup') && !b.key.includes('backup')) return 1;
      if (!a.key.includes('backup') && b.key.includes('backup')) return -1;
      return a.key.localeCompare(b.key);
    });

    setDetectedBackups(found);
  };

  // Escanear cada vez que se abre el panel o cambia el inventario/ventas
  useEffect(() => {
    if (showBackupPanel) {
      scanLocalStorage();
    }
  }, [showBackupPanel, inventory, sales]);

  const handleRestoreDetectedBackup = (backup: typeof detectedBackups[0]) => {
    try {
      const value = localStorage.getItem(backup.key);
      if (!value) return;
      const parsed = JSON.parse(value);
      
      if (backup.type === 'inventory') {
        if (confirm(`¿Deseas restaurar ${parsed.length} productos desde el respaldo "${backup.key}"? Se unirá con tu lista actual y se subirá a la nube.`)) {
          setInventory(prev => {
            const updated = [...prev];
            parsed.forEach((vp: any) => {
              const idx = updated.findIndex(p => p.id === vp.id);
              if (idx >= 0) {
                updated[idx] = vp;
              } else {
                updated.push(vp);
              }
            });
            return updated;
          });
          
          // Cola de sincronización
          const queue = getPendingQueue();
          parsed.forEach((vp: any) => {
            queue.products = [...queue.products.filter(p => p.id !== vp.id), vp];
          });
          savePendingQueue(queue);
          
          alert('¡Inventario recuperado exitosamente! Los productos han vuelto a la lista. Sincronizando con Supabase en segundo plano...');
          triggerBackgroundSync();
          scanLocalStorage();
        }
      } else if (backup.type === 'sales') {
        if (confirm(`¿Deseas restaurar ${parsed.length} ventas/créditos deudores desde el respaldo "${backup.key}"? Se unirá con tu lista actual y se subirá a la nube.`)) {
          setSales(prev => {
            const updated = [...prev];
            parsed.forEach((vs: any) => {
              const idx = updated.findIndex(s => s.id === vs.id);
              if (idx >= 0) {
                updated[idx] = vs;
              } else {
                updated.push(vs);
              }
            });
            return updated;
          });
          
          // Cola de sincronización
          const queue = getPendingQueue();
          parsed.forEach((vs: any) => {
            queue.sales = [...queue.sales.filter(s => s.id !== vs.id), vs];
          });
          savePendingQueue(queue);
          
          alert('¡Ventas y cuentas por cobrar (créditos) recuperadas exitosamente! Sincronizando con Supabase en segundo plano...');
          triggerBackgroundSync();
          scanLocalStorage();
        }
      }
    } catch (err: any) {
      alert('Error al restaurar los datos: ' + err.message);
    }
  };

  // Exportar Inventario Local como JSON
  const handleExportLocalInventory = () => {
    try {
      const localData = safeGetItem('venstore_inventory');
      const dataToExport = localData ? JSON.parse(localData) : inventory;
      
      if (!dataToExport || dataToExport.length === 0) {
        alert('No hay productos en el inventario local para exportar.');
        return;
      }
      
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `inventario_local_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Error al exportar el inventario: ' + err.message);
    }
  };

  // Exportar Ventas Locales como JSON (para respaldar créditos e historial de ventas)
  const handleExportLocalSales = () => {
    try {
      const localData = safeGetItem('venstore_sales');
      const dataToExport = localData ? JSON.parse(localData) : sales;
      
      if (!dataToExport || dataToExport.length === 0) {
        alert('No hay ventas en el historial local para exportar.');
        return;
      }
      
      const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ventas_local_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert('Error al exportar el historial de ventas: ' + err.message);
    }
  };

  // Importar Inventario desde un Archivo JSON
  const handleImportLocalInventory = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const importedData = JSON.parse(text);

        if (!Array.isArray(importedData)) {
          alert('El archivo JSON debe contener una lista (array) de productos.');
          return;
        }

        const validProducts = importedData.filter(p => p && typeof p === 'object' && p.id && p.name);
        
        if (validProducts.length === 0) {
          alert('No se encontraron productos válidos en el archivo JSON.');
          return;
        }

        if (confirm(`Se importarán ${validProducts.length} productos al inventario. ¿Deseas continuar?`)) {
          setInventory(prev => {
            const updated = [...prev];
            validProducts.forEach(vp => {
              const idx = updated.findIndex(p => p.id === vp.id);
              if (idx >= 0) {
                updated[idx] = vp;
              } else {
                updated.push(vp);
              }
            });
            return updated;
          });

          // Agregar todos los productos importados a la cola de sincronización pendiente
          const queue = getPendingQueue();
          validProducts.forEach(vp => {
            queue.products = [...queue.products.filter(p => p.id !== vp.id), vp];
          });
          savePendingQueue(queue);

          alert(`¡Se importaron ${validProducts.length} productos con éxito! Iniciando sincronización en segundo plano...`);
          triggerBackgroundSync();
        }
      } catch (err: any) {
        alert('Error al leer e importar el archivo JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // Importar Ventas desde un Archivo JSON (para restaurar créditos e historial de ventas)
  const handleImportLocalSales = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string;
        const importedData = JSON.parse(text);

        if (!Array.isArray(importedData)) {
          alert('El archivo JSON debe contener una lista (array) de ventas.');
          return;
        }

        const validSales = importedData.filter(s => s && typeof s === 'object' && s.id && typeof s.timestamp === 'number');
        
        if (validSales.length === 0) {
          alert('No se encontraron ventas válidas en el archivo JSON.');
          return;
        }

        if (confirm(`Se importarán ${validSales.length} ventas y cuentas por cobrar (créditos). ¿Deseas continuar?`)) {
          setSales(prev => {
            const updated = [...prev];
            validSales.forEach(vs => {
              const idx = updated.findIndex(s => s.id === vs.id);
              if (idx >= 0) {
                updated[idx] = vs;
              } else {
                updated.push(vs);
              }
            });
            return updated;
          });

          // Agregar todos los importados a la cola de sincronización pendiente
          const queue = getPendingQueue();
          validSales.forEach(vs => {
            queue.sales = [...queue.sales.filter(s => s.id !== vs.id), vs];
          });
          savePendingQueue(queue);

          alert(`¡Se importaron ${validSales.length} ventas/créditos con éxito! Iniciando sincronización en segundo plano...`);
          triggerBackgroundSync();
        }
      } catch (err: any) {
        alert('Error al leer e importar el archivo JSON: ' + err.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const NavButton = ({ id, label, icon: Icon, active, badge }: { id: string, label: string, icon: any, active: boolean, badge?: React.ReactNode }) => (
    <button
      onClick={() => setActiveTab(id as any)}
      className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 border select-none relative ${
        active 
          ? 'bg-indigo-950 text-white border-indigo-950 shadow-md' 
          : 'bg-white text-indigo-950 hover:bg-violet-50/50 border-violet-100/85'
      }`}
    >
      <Icon className="w-4 h-4 text-violet-600" />
      <span>{label}</span>
      {badge}
    </button>
  );

  if (isStandalonePublicCatalog) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <PublicCatalog 
          inventory={inventory} 
          rate={rate} 
          onRefresh={() => triggerBackgroundSync(true)}
          isRefreshing={backgroundSyncing}
          isStandalonePublicView={true}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-violet-50/30 text-indigo-950 font-sans">
      <div className="max-w-7xl mx-auto px-4 py-6">
        
        {/* Encabezado Principal */}
        <header className="mb-6 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-2xl border border-violet-100/70 shadow-sm gap-4">
          <div className="text-center md:text-left">
            <h1 className="text-3xl font-black text-indigo-950 tracking-tight">
              MINI MARKET BRICAR
            </h1>
            <p className="text-slate-500 text-sm mt-1">
               Sistema de Gestión de Inventario y Ventas (Sincronizado con Supabase)
            </p>
          </div>

          {/* Widget del Estado de Sincronización */}
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-2">
            <button
              onClick={() => setActiveTab('CATALOG')}
              className={`flex items-center gap-2 transition-colors px-4 py-2.5 rounded-full text-xs font-bold shadow-xs cursor-pointer border ${
                activeTab === 'CATALOG'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
              }`}
              title="Abrir Catálogo Digital con Carrito y Pedidos por WhatsApp"
            >
              <Store className="w-4 h-4 text-emerald-600" />
              Catálogo Clientes
            </button>

            <button
              onClick={handleExportLocalInventory}
              className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white transition-colors px-4 py-2.5 rounded-full text-xs font-bold shadow-sm cursor-pointer"
              title="Exportar inventario guardado localmente"
            >
              <Download className="w-4 h-4" />
              Exportar Inventario Local como JSON
            </button>

            <button
              onClick={() => setShowBackupPanel(prev => !prev)}
              className={`flex items-center gap-2 transition-colors px-4 py-2.5 rounded-full text-xs font-bold shadow-sm cursor-pointer border ${
                showBackupPanel 
                  ? 'bg-indigo-950 text-white border-indigo-950' 
                  : 'bg-white hover:bg-indigo-50 text-indigo-700 border-indigo-200'
              }`}
              title="Panel para respaldar y recuperar inventario o ventas/créditos"
            >
              <RefreshCw className={`w-4 h-4 ${showBackupPanel ? 'animate-spin' : ''}`} />
              Importar / Restaurar JSON
            </button>

            <button
              onClick={() => {
                setShowSyncModal(true);
                setModalTab('GUIDE');
              }}
              className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 transition-colors px-4 py-2.5 rounded-full text-xs font-bold shadow-xs cursor-pointer"
              title="Guía y asistencia de conexión a PostgreSQL en Neon.tech"
            >
              <HelpCircle className="w-4 h-4 text-indigo-600" />
              Ayuda Neon
            </button>

            {syncStatus.loading ? (
              <div className="flex items-center gap-2 bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-blue-100">
                <Loader2 className="w-4 h-4 animate-spin" />
                Conectando bdd...
              </div>
            ) : syncStatus.sheetsConfigured ? (
              <button 
                onClick={() => syncWithDatabase()}
                className="flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-emerald-100 hover:bg-emerald-100 transition-colors"
                title="PostgreSQL Neon Sincronizado. Clic para forzar recarga."
              >
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                Neon Activo
                {backgroundSyncing && <RefreshCw className="w-3 h-3 animate-spin text-emerald-600" />}
              </button>
            ) : (
              <button
                onClick={() => setShowSyncModal(true)}
                className="flex items-center gap-2 bg-amber-50 text-amber-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-amber-100 hover:bg-amber-100 transition-colors"
              >
                <AlertCircle className="w-4 h-4 text-amber-500" />
                Conectar Neon
              </button>
            )}

            {!syncStatus.loading && !syncStatus.connected && (
              <button
                onClick={() => syncWithDatabase()}
                className="flex items-center gap-2 bg-rose-50 text-rose-700 px-3 py-1.5 rounded-full text-xs font-semibold border border-rose-100 hover:bg-rose-100 transition-colors animate-pulse"
                title="No se pudo establecer conexión. Haga clic para intentar de nuevo."
              >
                <Cloud className="w-4 h-4" />
                Modo Local (Reconectar)
              </button>
            )}
          </div>
        </header>

        {/* Panel de Respaldo y Restauración de Datos */}
        {showBackupPanel && (
          <div className="mb-6 bg-white border border-indigo-100 rounded-2xl p-6 shadow-md animate-fade-in font-sans">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
              <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                <RefreshCw className="w-4 h-4 text-indigo-600" />
                Mantenimiento de Datos: Respaldos y Recuperación Manual (JSON)
              </h3>
              <button 
                onClick={() => setShowBackupPanel(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors text-xs font-bold"
              >
                Cerrar Panel ×
              </button>
            </div>
            
            <p className="text-slate-600 text-xs leading-relaxed mb-4">
              Usa este panel para recuperar tu información de inventario o tus cuentas de crédito/ventas a partir de archivos JSON que hayas exportado previamente en este u otro dispositivo. Al importar un archivo, los datos se unificarán localmente y se sincronizarán de forma automática con Supabase.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Bloque Inventario */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 text-xs mb-1 flex items-center gap-1.5">
                    <span>📦</span> Gestión del Inventario de Productos
                  </h4>
                  <p className="text-slate-500 text-[11px] mb-3">Descarga tu lista de productos o restaura un inventario antiguo desde un archivo JSON.</p>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={handleExportLocalInventory}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white transition-colors px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Exportar Inventario (.json)
                  </button>
                  <label className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 transition-colors px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer">
                    <Cloud className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Importar Inventario (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportLocalInventory}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Bloque Ventas y Créditos */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between">
                <div>
                  <h4 className="font-bold text-slate-800 text-xs mb-1 flex items-center gap-1.5">
                    <span>👤</span> Historial de Ventas y Créditos
                  </h4>
                  <p className="text-slate-500 text-[11px] mb-3">Exporta el registro completo de ventas o recupera tus deudores y cuentas por cobrar (créditos) antiguos.</p>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    onClick={handleExportLocalSales}
                    className="bg-violet-600 hover:bg-violet-700 text-white transition-colors px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" /> Exportar Ventas (.json)
                  </button>
                  <label className="bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 transition-colors px-3.5 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer">
                    <Cloud className="w-3.5 h-3.5 text-violet-600" />
                    <span>Importar Ventas (.json)</span>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleImportLocalSales}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Lista de copias de seguridad autodetectadas en el navegador */}
            <div className="mt-6 border-t border-slate-100 pt-5">
              <h4 className="font-bold text-slate-800 text-xs mb-3 flex items-center gap-1.5">
                <span>🔍</span> Copias de seguridad automáticas detectadas en este navegador
              </h4>
              {detectedBackups.length === 0 ? (
                <p className="text-slate-400 text-xs italic">
                  No se encontraron claves de datos anteriores o copias automáticas guardadas en este navegador.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                  {detectedBackups.map((b) => (
                    <div key={b.key} className="bg-slate-50 hover:bg-slate-100/80 transition-colors p-3.5 rounded-xl border border-slate-200/60 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-black uppercase text-[9px] px-1.5 py-0.5 rounded ${
                            b.type === 'inventory' ? 'bg-indigo-100 text-indigo-700' : 'bg-violet-100 text-violet-700'
                          }`}>
                            {b.type === 'inventory' ? '📦 Inventario' : '👤 Ventas / Créditos'}
                          </span>
                          <span className="font-bold text-slate-700 truncate" title={b.key}>
                            {b.dayName ? `Copia del ${b.dayName}` : b.key}
                          </span>
                        </div>
                        <p className="text-slate-500 text-[11px] mt-1 truncate">
                          {b.count} registros • <span className="italic">{b.preview}</span>
                        </p>
                      </div>
                      <button
                        onClick={() => handleRestoreDetectedBackup(b)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white transition-colors px-3 py-1.5 rounded-lg text-[11px] font-bold shadow-sm shrink-0 cursor-pointer"
                      >
                        Recuperar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Toast de Éxito al Vincular Dispositivo desde Enlace QR */}
        {phoneConnectedToast && (
          <div className="mb-6 bg-emerald-600 text-white p-4 rounded-2xl shadow-lg flex items-center justify-between gap-4 animate-fade-in border-2 border-emerald-400">
            <div className="flex items-center gap-3">
              <span className="text-2xl shrink-0">📱</span>
              <div>
                <h4 className="font-bold text-sm">¡Dispositivo Vinculado Exitosamente!</h4>
                <p className="text-xs text-emerald-100 mt-0.5 leading-relaxed">
                  Este dispositivo ya está conectado en tiempo real a tu base de datos PostgreSQL en Neon.tech. Todo lo que registres aquí (ventas, créditos e inventario) se reflejará de inmediato en tu computadora y otros teléfonos.
                </p>
              </div>
            </div>
            <button
              onClick={() => setPhoneConnectedToast(false)}
              className="bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold px-3 py-1.5 rounded-xl transition-colors shrink-0 cursor-pointer shadow-sm"
            >
              Entendido ×
            </button>
          </div>
        )}

        {/* Banner Prominente ÚNICAMENTE cuando Neon PostgreSQL NO está configurado en este dispositivo */}
        {!supabaseService.isEnabled() && (
          <div className="mb-6 bg-gradient-to-r from-amber-50 to-orange-50 border-2 border-amber-300 rounded-2xl p-4 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 animate-fade-in">
            <div className="flex items-start md:items-center gap-3">
              <div className="bg-amber-100 p-2.5 rounded-xl text-amber-800 shrink-0 mt-0.5 md:mt-0">
                <Cloud className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-bold text-amber-950 text-sm flex items-center gap-2">
                  <span>⚠️ Base de datos Neon PostgreSQL no configurada</span>
                </h4>
                <p className="text-amber-900 text-xs mt-0.5 leading-relaxed">
                  Para guardar y sincronizar en tiempo real el inventario, ventas y cuentas por cobrar (créditos) entre computadora y teléfonos móviles, conecta tu base de datos PostgreSQL en Neon.tech con la variable <code className="font-mono font-bold">DATABASE_URL</code>.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={() => {
                  setShowSyncModal(true);
                  setModalTab('GUIDE');
                }}
                className="w-full md:w-auto bg-white hover:bg-amber-100 text-amber-900 font-bold text-xs px-3.5 py-2.5 rounded-xl border border-amber-300 transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <BookOpen className="w-4 h-4 text-amber-700" />
                Guía Paso a Paso
              </button>
              <button
                onClick={() => {
                  setShowSyncModal(true);
                  setModalTab('CONFIG');
                }}
                className="w-full md:w-auto bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Smartphone className="w-4 h-4" />
                Conectar Neon
              </button>
            </div>
          </div>
        )}

        {/* Banner Suave de Reconexión si Neon está configurado pero temporalmente fuera de línea */}
        {supabaseService.isEnabled() && !syncStatus.loading && !syncStatus.connected && (
          <div className="mb-6 bg-slate-50 border border-slate-300 rounded-2xl p-3.5 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-3 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0 ml-1" />
              <div>
                <span className="text-xs font-semibold text-slate-800">Modo Fuera de Línea Activo</span>
                <p className="text-[11px] text-slate-500">Tus ventas y datos se guardan de forma 100% segura en tu dispositivo y se sincronizarán con Neon PostgreSQL en segundo plano.</p>
              </div>
            </div>
            <button
              onClick={() => syncWithDatabase()}
              className="text-xs bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold px-3 py-1.5 rounded-lg transition-colors shrink-0 cursor-pointer shadow-xs"
            >
              Reintentar Sincronización
            </button>
          </div>
        )}

        {/* Banner de Advertencia de Estructura de Tablas Faltante */}
        {!syncStatus.loading && syncStatus.connected && !syncStatus.sheetsConfigured && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex flex-col md:flex-row justify-between items-center gap-3">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
              <div>
                <h4 className="font-bold text-amber-900 text-sm">
                  Falta Configurar Tablas en Supabase
                </h4>
                <p className="text-amber-700 text-xs mt-0.5">
                  Conectado correctamente a Supabase, pero tu base de datos necesita las tablas: 
                  <span className="font-semibold text-amber-950"> {syncStatus.missingSheets.join(', ')}</span> con la estructura requerida.
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowSyncModal(true)}
              className="bg-amber-600 text-white hover:bg-amber-700 transition-colors px-4 py-2 rounded-lg text-xs font-bold shrink-0 shadow-sm"
            >
              Ver Instrucciones de Configuración
            </button>
          </div>
        )}

        {/* Banner de Advertencia de Violación de Políticas RLS */}
        {rlsErrorState && (
          <div className="mb-6 bg-rose-50 border border-rose-200 rounded-xl p-5 shadow-sm transition-all duration-300">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="flex items-start gap-3 col-span-2">
                <div className="bg-rose-100 p-2 rounded-lg text-rose-700 shrink-0">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-rose-950 text-base flex items-center gap-2">
                    ⚠️ Error de Seguridad de Supabase (Políticas RLS Activas)
                  </h4>
                  <p className="text-rose-700 text-xs mt-1 leading-relaxed max-w-3xl">
                    Tu base de datos de Supabase rechazó la escritura en la tabla <strong className="text-rose-900">"{rlsErrorState.tableName}"</strong> debido a que tiene <strong>Row Level Security (RLS)</strong> activado pero carece de políticas de acceso público o anónimo. Conéctate a tu panel de Supabase y arregla este problema ejecutando el script de corrección.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2.5 shrink-0 w-full md:w-auto">
                <button
                  onClick={() => {
                    copyToClipboard(`-- Ejecuta esto en el SQL Editor de Supabase para arreglar el error RLS
ALTER TABLE config DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE sales DISABLE ROW LEVEL SECURITY;

-- OPTATIVO: Si prefieres políticas explícitas en vez de desactivar RLS:
-- DROP POLICY IF EXISTS "Permitir todo a anon en config" ON config;
-- CREATE POLICY "Permitir todo a anon en config" ON config FOR ALL TO anon USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "Permitir todo a anon en products" ON products;
-- CREATE POLICY "Permitir todo a anon en products" ON products FOR ALL TO anon USING (true) WITH CHECK (true);
-- DROP POLICY IF EXISTS "Permitir todo a anon en sales" ON sales;
-- CREATE POLICY "Permitir todo a anon en sales" ON sales FOR ALL TO anon USING (true) WITH CHECK (true);`);
                  }}
                  className="w-full md:w-auto bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs px-4 py-2.5 rounded-lg transition-colors shadow-sm flex items-center justify-center gap-1.5"
                >
                  <Copy className="w-4 h-4" /> Copiar SQL de Solución
                </button>
                <button
                  onClick={() => setRlsErrorState(null)}
                  className="w-full md:w-auto bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs px-3 py-2.5 rounded-lg transition-colors flex items-center justify-center"
                >
                  Ocultar Error
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Barra de Navegación */}
        <div className="flex flex-wrap justify-center gap-3 mb-8">
            <NavButton 
              id="CATALOG" 
              label="Catálogo WhatsApp" 
              icon={Store} 
              active={activeTab === 'CATALOG'} 
              badge={
                <span className="bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  Tienda
                </span>
              }
            />
            <NavButton id="RATE" label="Calculadora Tasa" icon={Calculator} active={activeTab === 'RATE'} />
            <NavButton 
              id="INVENTORY" 
              label="Inventario" 
              icon={Package} 
              active={activeTab === 'INVENTORY'} 
              badge={criticalProducts.length > 0 ? (
                <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-black animate-pulse">
                  {criticalProducts.length}
                </span>
              ) : undefined}
            />
            <NavButton id="SALES" label="Ventas" icon={ShoppingCart} active={activeTab === 'SALES'} />
            <NavButton id="CREDITS" label="Créditos" icon={User} active={activeTab === 'CREDITS'} />
            <NavButton id="REPORTS" label="Reportes" icon={LayoutDashboard} active={activeTab === 'REPORTS'} />
            <NavButton id="AI" label="Asistente IA" icon={BrainCircuit} active={activeTab === 'AI'} />
        </div>

        {/* Contenido Dinámico */}
        <div className="animate-fade-in-up">
            {activeTab === 'CATALOG' && (
                <PublicCatalog 
                  inventory={inventory} 
                  rate={rate} 
                  onRefresh={() => triggerBackgroundSync(true)}
                  isRefreshing={backgroundSyncing}
                  onExitCatalog={() => setActiveTab('SALES')}
                />
            )}

            {activeTab === 'RATE' && (
                <ExchangeRate rate={rate} onUpdateRate={handleUpdateRate} />
            )}

            {activeTab === 'INVENTORY' && (
                <Inventory 
                  inventory={inventory} 
                  onAddProduct={handleAddProduct}
                  onUpdateProduct={handleUpdateProduct}
                  onDeleteProduct={handleDeleteProduct}
                  rate={rate} 
                  criticalThreshold={criticalThreshold}
                  onUpdateCriticalThreshold={handleUpdateCriticalThreshold}
                  onRefresh={() => triggerBackgroundSync(true)}
                  isRefreshing={backgroundSyncing}
                />
            )}

            {activeTab === 'SALES' && (
                <SalesSystem inventory={inventory} rate={rate} onProcessSale={handleProcessSale} />
              )}

            {activeTab === 'CREDITS' && (
                <Credits 
                  sales={sales} 
                  rate={rate} 
                  onProcessSale={handleProcessSale} 
                  inventory={inventory} 
                  onDeleteSale={handleDeleteSale}
                  onUpdateSale={handleUpdateSale}
                  onExportSalesJSON={handleExportLocalSales}
                  onImportSalesJSON={handleImportLocalSales}
                />
            )}

            {activeTab === 'REPORTS' && (
                <Reports 
                  sales={sales} 
                  onRefreshData={syncWithDatabase} 
                  criticalThreshold={criticalThreshold}
                  inventory={inventory}
                  onGoToInventory={() => setActiveTab('INVENTORY')}
                  onDeleteSale={handleDeleteSale}
                  onUpdateSale={handleUpdateSale}
                />
            )}

            {activeTab === 'AI' && (
                <AIAssistant storeData={{ exchangeRate: rate, inventory, sales }} />
            )}
        </div>
      </div>

      {/* --- Modal de Configuración y Asistencia Supabase --- */}
      {showSyncModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-3xl w-full max-h-[92vh] overflow-y-auto shadow-2xl flex flex-col p-6 animate-fade-in animate-scale">
            
            {/* Cabecera del Modal */}
            <div className="flex justify-between items-start pb-4 border-b border-slate-100 font-sans">
              <div>
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
                    <Cloud className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-indigo-950 tracking-tight">
                      Centro de Conexión PostgreSQL en Neon.tech
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Sincroniza tus productos, ventas y cuentas por cobrar directamente en PostgreSQL de Neon.
                    </p>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setShowSyncModal(false)}
                className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                title="Cerrar ventana"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Pestañas de Navegación del Modal */}
            <div className="flex gap-2 border-b border-slate-200 mt-4 mb-4 pb-2">
              <button
                onClick={() => setModalTab('CONFIG')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'CONFIG'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <Key className="w-4 h-4" />
                1. Conectar Base de Datos
              </button>

              <button
                onClick={() => setModalTab('GUIDE')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'GUIDE'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                2. Guía Paso a Paso & Tablas SQL
              </button>

              <button
                onClick={() => setModalTab('QR')}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  modalTab === 'QR'
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                }`}
              >
                <Smartphone className="w-4 h-4" />
                3. Vincular Celular (QR)
              </button>
            </div>

            {/* Contenido del Modal por Pestaña */}
            <div className="flex-1 space-y-4 text-slate-600 text-sm leading-relaxed overflow-y-auto font-sans pr-1">
              
              {/* TAB 1: FORMULARIO Y DIAGNÓSTICO NEON */}
              {modalTab === 'CONFIG' && (
                <div className="space-y-4">
                  <div className="bg-slate-50 p-5 border border-slate-200 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center">
                      <h4 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                        <Database className="w-4 h-4 text-indigo-600" />
                        Cadena de Conexión de tu Base de Datos Neon.tech
                      </h4>
                      <button
                        onClick={() => setModalTab('GUIDE')}
                        className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        ¿Dónde encuentro mi DATABASE_URL?
                        <ExternalLink className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                          Cadena de Conexión PostgreSQL (DATABASE_URL)
                        </label>
                        <input
                          type="text"
                          value={dbConfigUrl}
                          onChange={(e) => {
                            setDbConfigUrl(e.target.value);
                            setSaveSuccess(false);
                            setTestResult(null);
                          }}
                          placeholder="postgresql://neondb_owner:password@ep-cool-lake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require"
                          className="w-full text-xs font-mono bg-white border border-slate-300 rounded-xl px-3.5 py-2.5 outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-100 text-slate-900"
                        />
                        <p className="text-[11px] text-slate-500 mt-1">
                          Ejemplo: <code className="text-indigo-600 break-all">postgresql://neondb_owner:pass@ep-lake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require</code>
                        </p>
                      </div>

                      <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-900 leading-relaxed">
                        <span className="font-bold block mb-1">📁 Archivo de configuración en el servidor (.env):</span>
                        También puedes colocar tu cadena directamente en el archivo <strong>.env</strong> del proyecto:
                        <pre className="mt-1 bg-white p-2 rounded-lg font-mono text-[11px] text-slate-800 border border-indigo-100 overflow-x-auto">
DATABASE_URL="postgresql://usuario:contraseña@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require"
                        </pre>
                      </div>
                    </div>

                    {/* Botones de acción en la configuración */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200">
                      <span className="text-[11px] text-slate-500">
                        {supabaseService.getCredentials().isEnvConfigured 
                          ? '✔️ Configurado por variable de entorno DATABASE_URL.' 
                          : '✏️ Configuración editable en este panel.'}
                      </span>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={handleInitTables}
                          disabled={initializingTables || testingConnection || !dbConfigUrl}
                          className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-bold text-xs px-4 py-2.5 rounded-xl transition-colors cursor-pointer shadow-sm"
                          title="Crea automáticamente las 3 tablas necesarias (config, products, sales) en tu base de datos de Neon"
                        >
                          {initializingTables ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Creando tablas...
                            </>
                          ) : (
                            <>
                              <CheckCircle className="w-3.5 h-3.5" />
                              ⚡ Crear Tablas en Neon
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleTestConnection}
                          disabled={testingConnection || !dbConfigUrl}
                          className="flex items-center gap-2 bg-slate-200 hover:bg-slate-300 disabled:opacity-50 text-slate-800 font-bold text-xs px-4 py-2.5 rounded-xl transition-colors cursor-pointer"
                        >
                          {testingConnection ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Probando...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="w-3.5 h-3.5" />
                              Probar Conexión
                            </>
                          )}
                        </button>

                        <button
                          onClick={handleDbSaveAndConnect}
                          disabled={testingConnection}
                          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-bold text-xs px-5 py-2.5 rounded-xl transition-colors shadow-sm flex items-center gap-1.5 cursor-pointer"
                        >
                          <Check className="w-4 h-4" />
                          Guardar y Conectar
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Panel de Diagnóstico en Tiempo Real */}
                  {testResult && (
                    <div className={`p-4 rounded-2xl border transition-all animate-fade-in ${
                      testResult.success
                        ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                        : testResult.stage === 'missing_tables'
                        ? 'bg-amber-50 border-amber-300 text-amber-950'
                        : 'bg-rose-50 border-rose-300 text-rose-950'
                    }`}>
                      <div className="flex items-start gap-3">
                        {testResult.success ? (
                          <div className="p-2 bg-emerald-100 text-emerald-700 rounded-xl shrink-0">
                            <CheckCircle className="w-5 h-5" />
                          </div>
                        ) : testResult.stage === 'missing_tables' ? (
                          <div className="p-2 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                            <AlertCircle className="w-5 h-5" />
                          </div>
                        ) : (
                          <div className="p-2 bg-rose-100 text-rose-700 rounded-xl shrink-0">
                            <AlertCircle className="w-5 h-5" />
                          </div>
                        )}

                        <div className="flex-1 space-y-1.5">
                          <h5 className="font-bold text-sm">
                            {testResult.success 
                              ? '¡Conexión Exitosa con PostgreSQL en Neon!' 
                              : testResult.stage === 'missing_tables' 
                              ? 'Conectado a Neon, pero faltan tablas requeridas' 
                              : 'Error de Conexión a Neon PostgreSQL'}
                          </h5>
                          <p className="text-xs leading-relaxed">
                            {testResult.message}
                          </p>

                          {/* Verificación de Tablas */}
                          <div className="pt-2 flex flex-wrap gap-2 text-xs">
                            <span className={`px-2.5 py-1 rounded-lg font-mono font-bold flex items-center gap-1 ${
                              testResult.missingTables?.includes('config') 
                                ? 'bg-rose-200 text-rose-900' 
                                : testResult.success 
                                ? 'bg-emerald-200 text-emerald-900' 
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {testResult.missingTables?.includes('config') ? '❌ config' : '✓ config'}
                            </span>
                            <span className={`px-2.5 py-1 rounded-lg font-mono font-bold flex items-center gap-1 ${
                              testResult.missingTables?.includes('products') 
                                ? 'bg-rose-200 text-rose-900' 
                                : testResult.success 
                                ? 'bg-emerald-200 text-emerald-900' 
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {testResult.missingTables?.includes('products') ? '❌ products' : '✓ products'}
                            </span>
                            <span className={`px-2.5 py-1 rounded-lg font-mono font-bold flex items-center gap-1 ${
                              testResult.missingTables?.includes('sales') 
                                ? 'bg-rose-200 text-rose-900' 
                                : testResult.success 
                                ? 'bg-emerald-200 text-emerald-900' 
                                : 'bg-slate-200 text-slate-700'
                            }`}>
                              {testResult.missingTables?.includes('sales') ? '❌ sales' : '✓ sales'}
                            </span>
                          </div>

                          {testResult.missingTables && testResult.missingTables.length > 0 && (
                            <div className="pt-2 flex flex-wrap items-center gap-2">
                              <button
                                onClick={handleInitTables}
                                disabled={initializingTables}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                              >
                                {initializingTables ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                                Crear Tablas en Neon Automáticamente
                              </button>
                              <button
                                onClick={() => setModalTab('GUIDE')}
                                className="bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer inline-flex items-center gap-1.5 shadow-xs"
                              >
                                <Copy className="w-3.5 h-3.5" />
                                Ver Script SQL Manual
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {saveSuccess && !testResult && (
                    <div className="p-3 bg-indigo-50 border border-indigo-200 text-indigo-900 rounded-xl text-xs font-semibold">
                      ¡Credenciales de Neon guardadas! Conectando con PostgreSQL...
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: GUÍA PASO A PASO Y SCRIPT SQL NEON */}
              {modalTab === 'GUIDE' && (
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-indigo-50 to-violet-50 p-4 border border-indigo-200 rounded-2xl">
                    <h4 className="font-bold text-indigo-950 text-sm mb-3 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-600" />
                      Pasos Sencillos para Conectar Neon PostgreSQL en 2 Minutos
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-xs space-y-1">
                        <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">1</span>
                          Crea tu Proyecto en Neon.tech
                        </div>
                        <p className="text-slate-600">
                          Entra en <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline font-semibold inline-flex items-center gap-0.5">neon.tech <ExternalLink className="w-2.5 h-2.5"/></a>, inicia sesión o regístrate gratis y crea una base de datos PostgreSQL.
                        </p>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-xs space-y-1">
                        <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">2</span>
                          Copia tu Connection String
                        </div>
                        <p className="text-slate-600">
                          En el <strong>Dashboard</strong> de Neon, en <strong>Connection details</strong>, copia la URL que empieza por <code className="font-mono text-indigo-700">postgresql://...</code>.
                        </p>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-xs space-y-1">
                        <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">3</span>
                          Configura tu DATABASE_URL
                        </div>
                        <p className="text-slate-600">
                          Pégala en el archivo <code className="font-mono text-indigo-700">.env</code> de tu servidor o en la pestaña <strong>"1. Conectar Base de Datos"</strong> de esta ventana.
                        </p>
                      </div>

                      <div className="bg-white p-3.5 rounded-xl border border-indigo-100 shadow-xs space-y-1">
                        <div className="font-bold text-indigo-900 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px]">4</span>
                          Inicializa las Tablas
                        </div>
                        <p className="text-slate-600">
                          Pulsa el botón <strong>"⚡ Crear Tablas en Neon"</strong> de la pestaña 1 para crearlas en 1 clic, o ejecuta el script de abajo en el <strong>SQL Editor</strong> de Neon.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Bloque de Código SQL con 1-Click Copy */}
                  <div className="bg-slate-900 text-slate-100 p-4 border border-slate-800 rounded-2xl space-y-3">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="bg-violet-500/20 text-violet-300 text-[10px] font-mono px-2 py-0.5 rounded-md border border-violet-500/30">
                          PostgreSQL Script
                        </span>
                        <span className="text-xs font-bold text-slate-200">
                          Tablas: config, inventario, sales
                        </span>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(`CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS public.inventario (
  id TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  unit TEXT,
  units_per_case NUMERIC DEFAULT 1,
  stock NUMERIC,
  barcode TEXT,
  cost NUMERIC DEFAULT 0,
  profit_margin NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  unit TEXT,
  units_per_case NUMERIC DEFAULT 1,
  stock NUMERIC,
  barcode TEXT,
  cost NUMERIC DEFAULT 0,
  profit_margin NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  timestamp BIGINT,
  items JSONB,
  total_usd NUMERIC,
  total_bsf NUMERIC,
  rate_at_sale NUMERIC,
  payment_method TEXT,
  customer_name TEXT,
  payment_reference TEXT
);

INSERT INTO config (key, value) VALUES ('exchangeRate', '36.5') ON CONFLICT (key) DO NOTHING;`)}
                        className="flex items-center gap-1.5 text-xs font-bold bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copiar Script SQL Completo
                      </button>
                    </div>

                    <pre className="bg-slate-950 text-emerald-400 p-3.5 rounded-xl font-mono text-[11px] overflow-x-auto max-h-[220px] leading-relaxed border border-slate-800">
{`CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS public.inventario (
  id TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  unit TEXT,
  units_per_case NUMERIC DEFAULT 1,
  stock NUMERIC,
  barcode TEXT,
  cost NUMERIC DEFAULT 0,
  profit_margin NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT,
  category TEXT,
  price NUMERIC,
  currency TEXT,
  unit TEXT,
  units_per_case NUMERIC DEFAULT 1,
  stock NUMERIC,
  barcode TEXT,
  cost NUMERIC DEFAULT 0,
  profit_margin NUMERIC DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  timestamp BIGINT,
  items JSONB,
  total_usd NUMERIC,
  total_bsf NUMERIC,
  rate_at_sale NUMERIC,
  payment_method TEXT,
  customer_name TEXT,
  payment_reference TEXT
);

INSERT INTO config (key, value) VALUES ('exchangeRate', '36.5') ON CONFLICT (key) DO NOTHING;`}
                    </pre>

                    <div className="flex items-center justify-between pt-1 text-slate-400 text-xs">
                      <span>✓ Compatible al 100% con PostgreSQL y Neon Serverless.</span>
                      <button
                        onClick={() => setModalTab('CONFIG')}
                        className="text-violet-400 hover:text-violet-300 font-semibold underline cursor-pointer"
                      >
                        Volver a Conectar y Probar →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: VINCULAR CON CELULAR O SEGUNDO DISPOSITIVO */}
              {modalTab === 'QR' && (
                <div className="space-y-4">
                  {dbConfigUrl ? (() => {
                    const syncLink = `${window.location.origin}${window.location.pathname}?database_url=${encodeURIComponent(dbConfigUrl)}`;
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(syncLink)}`;

                    return (
                      <div className="bg-gradient-to-br from-indigo-50/90 to-violet-50/90 border-2 border-indigo-200/80 rounded-2xl p-6 flex flex-col md:flex-row items-center gap-6 shadow-xs">
                        <div className="bg-white p-3 rounded-2xl border border-indigo-200 shadow-sm shrink-0 text-center">
                          <img 
                            src={qrUrl} 
                            alt="Código QR de Conexión Teléfono" 
                            className="w-44 h-44 mx-auto rounded-xl"
                          />
                          <span className="text-[11px] font-bold text-indigo-700 block mt-2">
                            Apunta con la Cámara de tu Teléfono 📱
                          </span>
                        </div>
                        <div className="flex-1 space-y-3 text-left">
                          <h5 className="font-bold text-indigo-950 text-base flex items-center gap-2">
                            <span>📱 ↔️ 💻</span> Vincular Teléfono y Computadora en Tiempo Real
                          </h5>
                          <p className="text-slate-600 text-xs leading-relaxed">
                            <strong>1.</strong> Abre la cámara de tu teléfono móvil o lector de códigos QR.<br/>
                            <strong>2.</strong> Apunta a este código y pulsa en la notificación para abrir la página.<br/>
                            <strong>3.</strong> ¡Tu teléfono quedará conectado al instante a la misma base de datos Neon PostgreSQL sin necesidad de escribir contraseñas!
                          </p>
                          <div className="p-3 bg-white border border-indigo-100 rounded-xl space-y-1">
                            <span className="text-[10px] font-bold text-slate-500 block uppercase tracking-wider">
                              Enlace Directo para Enviar por WhatsApp / Telegram:
                            </span>
                            <div className="flex items-center gap-2">
                              <input 
                                readOnly 
                                value={syncLink} 
                                className="w-full text-[11px] font-mono bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-600 select-all"
                              />
                              <button
                                onClick={() => copyToClipboard(syncLink)}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1 shrink-0 cursor-pointer shadow-xs"
                              >
                                <Copy className="w-3.5 h-3.5" /> Copiar
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })() : (
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl text-center space-y-3">
                      <div className="w-12 h-12 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center mx-auto">
                        <Smartphone className="w-6 h-6" />
                      </div>
                      <h4 className="font-bold text-slate-900 text-sm">
                        Ingresa primero la DATABASE_URL de Neon PostgreSQL
                      </h4>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Para generar el Código QR de vinculación automática para tu teléfono, ingresa y guarda la cadena de conexión en la pestaña <strong>"1. Conectar Base de Datos"</strong>.
                      </p>
                      <button
                        onClick={() => setModalTab('CONFIG')}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-colors cursor-pointer"
                      >
                        Ir a Conectar Base de Datos
                      </button>
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* Acciones y Cierre del Modal */}
            <div className="mt-6 pt-4 border-t border-slate-200 flex flex-col sm:flex-row gap-3 font-sans">
              <button 
                onClick={async () => {
                  await syncWithDatabase();
                  setShowSyncModal(false);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-3 rounded-2xl font-bold transition-colors shadow-sm text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                Sincronizar y Cerrar Asistente
              </button>
              <button 
                onClick={() => setShowSyncModal(false)}
                className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-3 rounded-2xl font-bold transition-colors text-sm cursor-pointer"
              >
                Continuar en Modo Local
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};

export default App;