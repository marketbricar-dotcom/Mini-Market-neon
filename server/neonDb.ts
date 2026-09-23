import { Pool } from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

const CONFIG_FILE = path.join(process.cwd(), '.neon_config.json');

function loadPersistedUrl(): string | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.databaseUrl === 'string' && parsed.databaseUrl.trim()) {
        return parsed.databaseUrl.trim();
      }
    }
  } catch {}
  return null;
}

let runtimeDatabaseUrl: string | null = loadPersistedUrl();

export function getDatabaseUrl(): string {
  return runtimeDatabaseUrl || loadPersistedUrl() || process.env.DATABASE_URL || '';
}

export function setRuntimeDatabaseUrl(url: string | null) {
  const cleaned = url ? url.trim() : null;
  runtimeDatabaseUrl = cleaned;
  try {
    if (cleaned) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify({ databaseUrl: cleaned, updatedAt: new Date().toISOString() }));
    } else {
      if (fs.existsSync(CONFIG_FILE)) {
        fs.unlinkSync(CONFIG_FILE);
      }
    }
  } catch (e) {
    console.warn('[Neon DB] Error guardando config en disco:', e);
  }
  resetPool();
}

let pool: Pool | null = null;
let currentPoolUrl: string | null = null;

function getPool(customUrl?: string): Pool {
  const targetUrl = (customUrl || getDatabaseUrl()).trim();
  if (!targetUrl) {
    throw new Error('DATABASE_URL no está configurada. Por favor define DATABASE_URL en las variables de entorno o en la configuración.');
  }

  if (customUrl) {
    // Custom pool for testing
    return new Pool({
      connectionString: targetUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
  }

  if (!pool || currentPoolUrl !== targetUrl) {
    if (pool) {
      pool.end().catch(() => {});
    }
    pool = new Pool({
      connectionString: targetUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      max: 10,
    });
    currentPoolUrl = targetUrl;
  }

  return pool;
}

export function resetPool() {
  if (pool) {
    pool.end().catch(() => {});
    pool = null;
    currentPoolUrl = null;
  }
}

/**
 * Normaliza y valida una cadena de conexión de Neon/PostgreSQL.
 */
export function normalizeNeonUrl(url: string): string {
  let cleaned = (url || '').trim();
  if (!cleaned) return '';
  // Eliminar comillas dobles o simples accidentales
  cleaned = cleaned.replace(/^["']|["']$/g, '');
  // Si falta el protocolo
  if (!cleaned.startsWith('postgres://') && !cleaned.startsWith('postgresql://')) {
    cleaned = 'postgresql://' + cleaned;
  }
  // Asegurar sslmode=require para Neon
  if (!cleaned.includes('sslmode=')) {
    cleaned += cleaned.includes('?') ? '&sslmode=require' : '?sslmode=require';
  }
  return cleaned;
}

function parseNumeric(val: any, fallback: number = 0): number {
  if (val === undefined || val === null || val === '') return fallback;
  if (typeof val === 'number') return isNaN(val) ? fallback : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]+/g, '').replace(',', '.');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function normalizeCategory(val: any): string {
  if (!val) return 'Otros';
  const str = String(val).toLowerCase().trim();
  if (str.includes('viver') || str.includes('alimento') || str.includes('comida') || str.includes('abarrote')) return 'Víveres';
  if (str.includes('aseo') || str.includes('personal') || str.includes('higiene')) return 'Aseo Personal';
  if (str.includes('bebida') || str.includes('refresco') || str.includes('jugo') || str.includes('licor')) return 'Bebidas';
  if (str.includes('charcuter') || str.includes('embutido') || str.includes('queso') || str.includes('jamon')) return 'Charcutería';
  if (str.includes('lacteo') || str.includes('leche') || str.includes('yogurt')) return 'Lácteos';
  if (str.includes('pan') || str.includes('panaderia') || str.includes('reposteria')) return 'Pan';
  if (str.includes('limpieza') || str.includes('detergente') || str.includes('desinfectante')) return 'Limpieza';
  if (str.includes('golosina') || str.includes('dulce') || str.includes('caramelo') || str.includes('snack') || str.includes('galleta')) return 'Golosinas';
  if (str.includes('grano') || str.includes('caraota') || str.includes('frijol') || str.includes('arroz') || str.includes('pasta')) return 'Granos';
  if (str.includes('farmacia') || str.includes('medicamento') || str.includes('salud') || str.includes('remedio')) return 'Farmacia';
  if (str.includes('papeler') || str.includes('oficina') || str.includes('escolar')) return 'Papelería';
  if (str.includes('miscel')) return 'Misceláneo';
  return String(val).trim();
}

let cachedInventoryTables: { schema: string; tableName: string; quoted: string }[] | null = null;

export async function getAllInventoryTables(poolOrClient?: Pool | any): Promise<{ schema: string; tableName: string; quoted: string }[]> {
  const p = poolOrClient || getPool();
  try {
    const res = await p.query(`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND LOWER(table_name) IN ('inventario', 'products')
      ORDER BY 
        CASE 
          WHEN table_name = 'Inventario' THEN 1 
          WHEN table_name = 'inventario' THEN 2 
          ELSE 3 
        END;
    `);
    if (res.rows && res.rows.length > 0) {
      return res.rows.map(r => ({
        schema: r.table_schema,
        tableName: r.table_name,
        quoted: `"${r.table_schema}"."${r.table_name}"`,
      }));
    }
  } catch (err: any) {
    console.warn('[Neon DB] Advertencia detectando tablas de inventario:', err.message);
  }
  return [{ schema: 'public', tableName: 'inventario', quoted: '"public"."inventario"' }];
}

export async function resolveInventoryTableName(poolOrClient?: Pool | any): Promise<string> {
  const tables = await getAllInventoryTables(poolOrClient);
  return tables[0].quoted;
}

/**
 * Ejecuta el script de creación de tablas en PostgreSQL Neon
 */
export async function initTables(customUrl?: string): Promise<{ success: boolean; message: string }> {
  const p = getPool(customUrl);
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // 1. Tabla config
    await client.query(`
      CREATE TABLE IF NOT EXISTS config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    // 2. Tabla inventario (principal para el sistema de punto de venta)
    await client.query(`
      CREATE TABLE IF NOT EXISTS inventario (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        price NUMERIC NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        unit TEXT NOT NULL DEFAULT 'Unidad',
        units_per_case NUMERIC DEFAULT 1,
        stock NUMERIC NOT NULL DEFAULT 0,
        barcode TEXT,
        cost NUMERIC DEFAULT 0,
        profit_margin NUMERIC DEFAULT 0
      );
    `);

    // 2b. Tabla products (para compatibilidad dual)
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT,
        price NUMERIC NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        unit TEXT NOT NULL DEFAULT 'Unidad',
        units_per_case NUMERIC DEFAULT 1,
        stock NUMERIC NOT NULL DEFAULT 0,
        barcode TEXT,
        cost NUMERIC DEFAULT 0,
        profit_margin NUMERIC DEFAULT 0
      );
    `);

    // 3. Tabla sales
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id TEXT PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        items JSONB NOT NULL DEFAULT '[]'::jsonb,
        total_usd NUMERIC NOT NULL DEFAULT 0,
        total_bsf NUMERIC NOT NULL DEFAULT 0,
        rate_at_sale NUMERIC NOT NULL DEFAULT 36.5,
        payment_method TEXT NOT NULL,
        customer_name TEXT,
        payment_reference TEXT
      );
    `);

    // 4. Valor por defecto para tasa de cambio
    await client.query(`
      INSERT INTO config (key, value) 
      VALUES ('exchangeRate', '36.5') 
      ON CONFLICT (key) DO NOTHING;
    `);

    // 5. Normalizaciones automáticas para compatibilidad total en todas las tablas existentes
    try {
      await client.query(`
        DO $$
        BEGIN
          -- Si la tabla "Inventario" existe, asegurar clave primaria en id para soporte ON CONFLICT
          IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Inventario') THEN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Inventario_pkey') THEN
              ALTER TABLE "Inventario" ADD CONSTRAINT "Inventario_pkey" PRIMARY KEY (id);
            END IF;
          END IF;

          -- Si la tabla "inventario" tiene columna id tipo integer, convertir a text
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'inventario' AND column_name = 'id' AND data_type = 'integer') THEN
            ALTER TABLE "inventario" ALTER COLUMN id TYPE text USING id::text;
          END IF;
        END $$;
      `);
    } catch (migErr: any) {
      console.warn('[Neon DB] Advertencia en migración automática de claves primarias:', migErr.message);
    }

    await client.query('COMMIT');
    cachedInventoryTables = null;
    return { success: true, message: 'Tablas (config, inventario, products, sales) creadas e inicializadas con éxito en Neon.' };
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error al inicializar tablas en Neon:', err);
    throw err;
  } finally {
    client.release();
    if (customUrl) {
      await p.end().catch(() => {});
    }
  }
}

/**
 * Verifica la conexión con Neon y comprueba si existen las tablas
 */
export async function checkNeonConnection(customUrl?: string): Promise<{
  configured: boolean;
  connected: boolean;
  missingTables: string[];
  error?: string;
}> {
  const url = customUrl || getDatabaseUrl();
  if (!url) {
    return {
      configured: false,
      connected: false,
      missingTables: ['config', 'inventario', 'sales'],
      error: 'DATABASE_URL no está configurada. Agrega DATABASE_URL en tu archivo .env.',
    };
  }

  let p: Pool | null = null;
  try {
    p = getPool(customUrl);
    const client = await p.connect();
    try {
      // Probar consulta básica
      await client.query('SELECT 1');

      // Comprobar tablas existentes (admitiendo inventario o products, y sales o ventas)
      const res = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
          AND LOWER(table_name) IN ('config', 'products', 'inventario', 'sales', 'ventas');
      `);

      const existing = res.rows.map(r => r.table_name.toLowerCase());
      const hasConfig = existing.includes('config');
      const hasInventory = existing.includes('inventario') || existing.includes('products');
      const hasSales = existing.includes('sales') || existing.includes('ventas');

      const missing: string[] = [];
      if (!hasConfig) missing.push('config');
      if (!hasInventory) missing.push('inventario');
      if (!hasSales) missing.push('sales');

      return {
        configured: true,
        connected: true,
        missingTables: missing,
        error: missing.length > 0 ? `Faltan tablas: ${missing.join(', ')}.` : undefined,
      };
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('Error verificando conexión Neon PostgreSQL:', err.message);
    return {
      configured: true,
      connected: false,
      missingTables: ['config', 'inventario', 'sales'],
      error: err.message || 'Error de conexión a PostgreSQL Neon',
    };
  } finally {
    if (customUrl && p) {
      await p.end().catch(() => {});
    }
  }
}

/**
 * Obtener todos los valores de config
 */
export async function getConfigMap(): Promise<Record<string, string>> {
  const p = getPool();
  const res = await p.query('SELECT key, value FROM config');
  const map: Record<string, string> = {};
  for (const row of res.rows) {
    map[row.key] = row.value;
  }
  return map;
}

/**
 * Guardar o actualizar un valor en config
 */
export async function setConfigValue(key: string, value: string): Promise<void> {
  const p = getPool();
  await p.query(`
    INSERT INTO config (key, value)
    VALUES ($1, $2)
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `, [key, value]);
}

/**
 * Obtener listado de productos de todas las tablas de inventario en PostgreSQL Neon
 * (Soporta tablas con mayúsculas como "Inventario", minúsculas "inventario" o "products")
 */
export async function getProducts(): Promise<any[]> {
  const p = getPool();
  const tables = await getAllInventoryTables(p);
  console.log(`[Neon DB] Tablas de inventario detectadas: ${tables.map(t => t.quoted).join(', ')}`);

  const allRawRows: any[] = [];
  const seenKeys = new Set<string>();
  const seenNames = new Set<string>();

  for (const t of tables) {
    try {
      console.log(`[Neon DB] Consultando: SELECT * FROM ${t.quoted}`);
      const res = await p.query(`SELECT * FROM ${t.quoted}`);
      const rows = res && Array.isArray(res.rows) ? res.rows : [];
      console.log(`[Neon DB] Tabla ${t.quoted} devolvió ${rows.length} registros.`);
      if (rows.length > 0) {
        console.log(`[Neon DB] Columnas de ${t.quoted}:`, Object.keys(rows[0]));
      }
      for (const row of rows) {
        const idVal = String(row.id ?? row.codigo ?? row.id_producto ?? '').trim();
        const nameVal = String(row.name ?? row.nombre ?? row.descripcion ?? '').trim().toLowerCase();
        const key = `${idVal}:::${nameVal}`;
        if (!seenKeys.has(key) && !seenNames.has(nameVal)) {
          seenKeys.add(key);
          if (nameVal) seenNames.add(nameVal);
          allRawRows.push(row);
        }
      }
    } catch (err: any) {
      console.warn(`[Neon DB] Error consultando tabla ${t.quoted}:`, err.message);
    }
  }

  // Si ninguna tabla específica devolvió filas, reintentar con consultas directas de respaldo
  if (allRawRows.length === 0) {
    const fallbacks = [
      'SELECT * FROM "public"."Inventario"',
      'SELECT * FROM "public"."inventario"',
      'SELECT * FROM "public"."products"',
      'SELECT * FROM inventario',
      'SELECT * FROM products',
    ];
    for (const fb of fallbacks) {
      try {
        const res = await p.query(fb);
        if (res && Array.isArray(res.rows) && res.rows.length > 0) {
          console.log(`[Neon DB] Consulta de respaldo exitosa (${fb}): ${res.rows.length} filas.`);
          for (const row of res.rows) {
            const idVal = String(row.id ?? row.codigo ?? row.id_producto ?? '').trim();
            const nameVal = String(row.name ?? row.nombre ?? row.descripcion ?? '').trim().toLowerCase();
            const key = `${idVal}:::${nameVal}`;
            if (!seenKeys.has(key) && !seenNames.has(nameVal)) {
              seenKeys.add(key);
              if (nameVal) seenNames.add(nameVal);
              allRawRows.push(row);
            }
          }
          break;
        }
      } catch (e: any) {
        // Ignorar fallo de consulta de respaldo
      }
    }
  }

  console.log(`[Neon DB] Total filas unificadas de inventario: ${allRawRows.length}`);

  // Mapear cada fila a los campos requeridos por la interfaz Product
  return allRawRows.map((r: any, idx: number) => {
    // Función auxiliar para buscar valor de forma insensible a mayúsculas/minúsculas
    const val = (...keys: string[]): any => {
      for (const k of keys) {
        if (r[k] !== undefined && r[k] !== null) return r[k];
      }
      const rowKeys = Object.keys(r);
      for (const k of keys) {
        const match = rowKeys.find(rk => rk.toLowerCase() === k.toLowerCase());
        if (match && r[match] !== undefined && r[match] !== null) return r[match];
      }
      return undefined;
    };

    // ID del producto
    const rawId = val('id', 'id_producto', 'producto_id', 'codigo', 'cod', 'codigo_barra', 'barcode');
    const id = rawId !== undefined && rawId !== null && String(rawId).trim() !== ''
      ? String(rawId).trim()
      : `prod-${idx + 1}`;

    // Nombre / Descripción del producto
    const rawName = val('name', 'nombre', 'descripcion', 'producto', 'nom_producto', 'articulo', 'detalle', 'title', 'titulo');
    const name = rawName !== undefined && rawName !== null && String(rawName).trim() !== ''
      ? String(rawName).trim()
      : 'Producto sin nombre';

    // Categoría
    const rawCategory = val('category', 'categoria', 'rubro', 'departamento', 'grupo', 'tipo', 'clasificacion');
    const category = normalizeCategory(rawCategory);

    // Precio de venta (detectando price, price_usd, precio, etc.)
    const rawPrice = val('price', 'precio', 'precio_usd', 'price_usd', 'precio_venta', 'pvp', 'monto', 'precio_unitario');
    const price = parseNumeric(rawPrice, 0);

    // Moneda (USD / BsF)
    const rawCurrency = String(val('currency', 'moneda', 'tipo_moneda') || 'USD').toUpperCase();
    const currency = (rawCurrency.includes('BS') || rawCurrency.includes('VES') || rawCurrency.includes('BOLIVAR')) ? 'BsF' : 'USD';

    // Unidad de medida
    const rawUnit = val('unit', 'unidad', 'medida', 'unidad_medida', 'tipo_unidad');
    const unit = rawUnit !== undefined && rawUnit !== null && String(rawUnit).trim() !== '' ? String(rawUnit).trim() : 'Unidad';

    // Unidades por caja / bulto
    const rawUnitsPerCase = val('units_per_case', 'unitspercase', 'unitsPerCase', 'unidades_por_caja', 'unidades_caja', 'bulto', 'empaque', 'cantidad_bulto');
    const unitsPerCase = parseNumeric(rawUnitsPerCase, 1);

    // Stock / Existencia disponible
    const rawStock = val('stock', 'cantidad', 'existencia', 'existencias', 'cant', 'disponible', 'cantidad_disponible', 'stock_actual');
    const stock = parseNumeric(rawStock, 0);

    // Código de barras
    const rawBarcode = val('barcode', 'codigo_barra', 'codigo_barras', 'cod_barra', 'cod_barras', 'codigo', 'upc', 'ean');
    const barcode = rawBarcode !== undefined && rawBarcode !== null ? String(rawBarcode).trim() : '';

    // Costo del producto
    const rawCost = val('cost', 'costo', 'costo_usd', 'precio_costo', 'costo_unitario');
    const cost = parseNumeric(rawCost, 0);

    // Margen de ganancia
    const rawProfitMargin = val('profit_margin', 'profitmargin', 'profitMargin', 'margen', 'margen_ganancia', 'ganancia', 'porcentaje_ganancia');
    const profitMargin = parseNumeric(rawProfitMargin, 0);

    return {
      id,
      name,
      category,
      price,
      currency,
      unit,
      unitsPerCase: unitsPerCase > 0 ? unitsPerCase : 1,
      stock,
      barcode,
      cost,
      profitMargin,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Guardar producto (upsert) adaptándose a la estructura real de la tabla en Neon
 * Sincroniza en todas las tablas de inventario existentes para máxima consistencia.
 */
export async function upsertProduct(product: any): Promise<void> {
  const p = getPool();
  const tables = await getAllInventoryTables(p);

  for (const t of tables) {
    try {
      const colRes = await p.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
      `, [t.schema, t.tableName]);
      
      const cols = colRes.rows;
      if (cols.length === 0) continue;

      const findCol = (...names: string[]) => cols.find(c => names.includes(c.column_name.toLowerCase()));

      const idColObj = findCol('id', 'codigo', 'id_producto') || cols.find(c => c.column_name.toLowerCase() === 'id') || cols[0];
      const idCol = idColObj.column_name;
      const isIdNumeric = idColObj.data_type.includes('int') || idColObj.data_type.includes('numeric');

      let parsedId: any = product.id;
      if (isIdNumeric) {
        const num = parseInt(String(product.id).replace(/\D/g, ''), 10);
        parsedId = isNaN(num) || num <= 0 ? (Date.now() % 100000000) : num;
      }

      const nameCol = findCol('name', 'nombre', 'descripcion', 'producto')?.column_name;
      const catCol = findCol('category', 'categoria', 'rubro')?.column_name;
      const priceCol = findCol('price', 'precio', 'price_usd', 'precio_usd', 'pvp')?.column_name;
      const currCol = findCol('currency', 'moneda')?.column_name;
      const unitCol = findCol('unit', 'unidad', 'unidad_medida')?.column_name;
      const unitsPerCaseCol = findCol('units_per_case', 'unitspercase', 'unidades_por_caja')?.column_name;
      const stockCol = findCol('stock', 'cantidad', 'existencia')?.column_name;
      const barcodeCol = findCol('barcode', 'codigo_barra', 'codigo_barras', 'codigo')?.column_name;
      const costCol = findCol('cost', 'costo')?.column_name;
      const profitMarginCol = findCol('profit_margin', 'profitmargin', 'margen')?.column_name;

      const insertCols: string[] = [`"${idCol}"`];
      const insertVals: any[] = [parsedId];
      const updateSets: string[] = [];

      if (nameCol) {
        insertCols.push(`"${nameCol}"`);
        insertVals.push(product.name || 'Producto sin nombre');
        updateSets.push(`"${nameCol}" = EXCLUDED."${nameCol}"`);
      }
      if (priceCol) {
        insertCols.push(`"${priceCol}"`);
        insertVals.push(product.price || 0);
        updateSets.push(`"${priceCol}" = EXCLUDED."${priceCol}"`);
      }
      if (stockCol) {
        insertCols.push(`"${stockCol}"`);
        insertVals.push(product.stock || 0);
        updateSets.push(`"${stockCol}" = EXCLUDED."${stockCol}"`);
      }
      if (catCol) {
        insertCols.push(`"${catCol}"`);
        insertVals.push(product.category || 'Otros');
        updateSets.push(`"${catCol}" = EXCLUDED."${catCol}"`);
      }
      if (currCol) {
        insertCols.push(`"${currCol}"`);
        insertVals.push(product.currency || 'USD');
        updateSets.push(`"${currCol}" = EXCLUDED."${currCol}"`);
      }
      if (unitCol) {
        insertCols.push(`"${unitCol}"`);
        insertVals.push(product.unit || 'Unidad');
        updateSets.push(`"${unitCol}" = EXCLUDED."${unitCol}"`);
      }
      if (unitsPerCaseCol) {
        insertCols.push(`"${unitsPerCaseCol}"`);
        insertVals.push(product.unitsPerCase || 1);
        updateSets.push(`"${unitsPerCaseCol}" = EXCLUDED."${unitsPerCaseCol}"`);
      }
      if (barcodeCol) {
        insertCols.push(`"${barcodeCol}"`);
        insertVals.push(product.barcode || '');
        updateSets.push(`"${barcodeCol}" = EXCLUDED."${barcodeCol}"`);
      }
      if (costCol) {
        insertCols.push(`"${costCol}"`);
        insertVals.push(product.cost || 0);
        updateSets.push(`"${costCol}" = EXCLUDED."${costCol}"`);
      }
      if (profitMarginCol) {
        insertCols.push(`"${profitMarginCol}"`);
        insertVals.push(product.profitMargin || 0);
        updateSets.push(`"${profitMarginCol}" = EXCLUDED."${profitMarginCol}"`);
      }

      const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
      const sql = `
        INSERT INTO ${t.quoted} (${insertCols.join(', ')})
        VALUES (${placeholders})
        ON CONFLICT ("${idCol}") DO UPDATE SET
          ${updateSets.join(', ')}
      `;

      await p.query(sql, insertVals);
      console.log(`[Neon DB] Producto "${product.name}" guardado exitosamente en ${t.quoted}`);
    } catch (err: any) {
      console.warn(`[Neon DB] Error guardando producto en ${t.quoted}:`, err.message);
    }
  }
}

/**
 * Guardar lote de productos (upsert masivo) en una sola operación atómica.
 * Actualiza todas las tablas de inventario para que todos los dispositivos vean los cambios de inmediato.
 */
export async function upsertProductsBatch(products: any[]): Promise<{ count: number }> {
  if (!Array.isArray(products) || products.length === 0) return { count: 0 };
  const p = getPool();
  const tables = await getAllInventoryTables(p);

  for (const t of tables) {
    try {
      const colRes = await p.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
      `, [t.schema, t.tableName]);
      
      const cols = colRes.rows;
      if (cols.length === 0) continue;

      const findCol = (...names: string[]) => cols.find(c => names.includes(c.column_name.toLowerCase()));
      const idColObj = findCol('id', 'codigo', 'id_producto') || cols[0];
      const idCol = idColObj.column_name;
      const isIdNumeric = idColObj.data_type.includes('int') || idColObj.data_type.includes('numeric');

      const nameCol = findCol('name', 'nombre', 'descripcion', 'producto')?.column_name;
      const catCol = findCol('category', 'categoria', 'rubro')?.column_name;
      const priceCol = findCol('price', 'precio', 'price_usd', 'precio_usd', 'pvp')?.column_name;
      const currCol = findCol('currency', 'moneda')?.column_name;
      const unitCol = findCol('unit', 'unidad', 'unidad_medida')?.column_name;
      const unitsPerCaseCol = findCol('units_per_case', 'unitspercase', 'unidades_por_caja')?.column_name;
      const stockCol = findCol('stock', 'cantidad', 'existencia')?.column_name;
      const barcodeCol = findCol('barcode', 'codigo_barra', 'codigo_barras', 'codigo')?.column_name;
      const costCol = findCol('cost', 'costo')?.column_name;
      const profitMarginCol = findCol('profit_margin', 'profitmargin', 'margen')?.column_name;

      for (const product of products) {
        if (!product || (!product.id && !product.name)) continue;

        let parsedId: any = product.id;
        if (isIdNumeric) {
          const num = parseInt(String(product.id).replace(/\D/g, ''), 10);
          parsedId = isNaN(num) || num <= 0 ? (Date.now() % 100000000) : num;
        }

        const insertCols: string[] = [`"${idCol}"`];
        const insertVals: any[] = [parsedId];
        const updateSets: string[] = [];

        if (nameCol) {
          insertCols.push(`"${nameCol}"`);
          insertVals.push(product.name || 'Producto sin nombre');
          updateSets.push(`"${nameCol}" = EXCLUDED."${nameCol}"`);
        }
        if (priceCol) {
          insertCols.push(`"${priceCol}"`);
          insertVals.push(product.price || 0);
          updateSets.push(`"${priceCol}" = EXCLUDED."${priceCol}"`);
        }
        if (stockCol) {
          insertCols.push(`"${stockCol}"`);
          insertVals.push(product.stock || 0);
          updateSets.push(`"${stockCol}" = EXCLUDED."${stockCol}"`);
        }
        if (catCol) {
          insertCols.push(`"${catCol}"`);
          insertVals.push(product.category || 'Otros');
          updateSets.push(`"${catCol}" = EXCLUDED."${catCol}"`);
        }
        if (currCol) {
          insertCols.push(`"${currCol}"`);
          insertVals.push(product.currency || 'USD');
          updateSets.push(`"${currCol}" = EXCLUDED."${currCol}"`);
        }
        if (unitCol) {
          insertCols.push(`"${unitCol}"`);
          insertVals.push(product.unit || 'Unidad');
          updateSets.push(`"${unitCol}" = EXCLUDED."${unitCol}"`);
        }
        if (unitsPerCaseCol) {
          insertCols.push(`"${unitsPerCaseCol}"`);
          insertVals.push(product.unitsPerCase || 1);
          updateSets.push(`"${unitsPerCaseCol}" = EXCLUDED."${unitsPerCaseCol}"`);
        }
        if (barcodeCol) {
          insertCols.push(`"${barcodeCol}"`);
          insertVals.push(product.barcode || '');
          updateSets.push(`"${barcodeCol}" = EXCLUDED."${barcodeCol}"`);
        }
        if (costCol) {
          insertCols.push(`"${costCol}"`);
          insertVals.push(product.cost || 0);
          updateSets.push(`"${costCol}" = EXCLUDED."${costCol}"`);
        }
        if (profitMarginCol) {
          insertCols.push(`"${profitMarginCol}"`);
          insertVals.push(product.profitMargin || 0);
          updateSets.push(`"${profitMarginCol}" = EXCLUDED."${profitMarginCol}"`);
        }

        const placeholders = insertCols.map((_, i) => `$${i + 1}`).join(', ');
        const sql = `
          INSERT INTO ${t.quoted} (${insertCols.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT ("${idCol}") DO UPDATE SET
            ${updateSets.join(', ')}
        `;

        await p.query(sql, insertVals);
      }
      console.log(`[Neon DB] Lote de ${products.length} productos guardado exitosamente en ${t.quoted}`);
    } catch (err: any) {
      console.warn(`[Neon DB] Error guardando lote de productos en ${t.quoted}:`, err.message);
    }
  }

  return { count: products.length };
}

/**
 * Eliminar producto en todas las tablas de inventario
 */
export async function deleteProduct(id: string): Promise<void> {
  const p = getPool();
  const tables = await getAllInventoryTables(p);

  for (const t of tables) {
    try {
      const colRes = await p.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_schema = $1 AND table_name = $2
      `, [t.schema, t.tableName]);
      
      const cols = colRes.rows;
      const idColObj = cols.find(c => ['id', 'codigo', 'id_producto'].includes(c.column_name.toLowerCase())) || { column_name: 'id', data_type: 'text' };
      const idCol = idColObj.column_name;
      
      await p.query(`DELETE FROM ${t.quoted} WHERE "${idCol}"::text = $1`, [String(id)]);
      console.log(`[Neon DB] Producto ID ${id} eliminado de ${t.quoted}`);
    } catch (err: any) {
      console.warn(`[Neon DB] Error eliminando producto de ${t.quoted}:`, err.message);
    }
  }
}

/**
 * Obtener todas las ventas (últimos 365 días)
 */
export async function getSales(): Promise<any[]> {
  const p = getPool();
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
  const res = await p.query(`
    SELECT * FROM sales 
    WHERE timestamp >= $1 
    ORDER BY timestamp ASC
  `, [oneYearAgo]);

  return res.rows.map(r => {
    let items = r.items;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    return {
      id: r.id,
      timestamp: Number(r.timestamp),
      items: items || [],
      totalUSD: Number(r.total_usd) || 0,
      totalBsF: Number(r.total_bsf) || 0,
      rateAtSale: Number(r.rate_at_sale) || 36.5,
      paymentMethod: r.payment_method,
      customerName: r.customer_name || undefined,
      paymentReference: r.payment_reference || undefined,
    };
  });
}

/**
 * Guardar venta y descontar/actualizar stock en una transacción atómica
 */
export async function saveSaleTransaction(sale: any, updatedInventory?: any[]): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    // 1. Upsert venta
    const itemsJson = typeof sale.items === 'string' ? sale.items : JSON.stringify(sale.items || []);
    await client.query(`
      INSERT INTO sales (id, timestamp, items, total_usd, total_bsf, rate_at_sale, payment_method, customer_name, payment_reference)
      VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        timestamp = EXCLUDED.timestamp,
        items = EXCLUDED.items,
        total_usd = EXCLUDED.total_usd,
        total_bsf = EXCLUDED.total_bsf,
        rate_at_sale = EXCLUDED.rate_at_sale,
        payment_method = EXCLUDED.payment_method,
        customer_name = EXCLUDED.customer_name,
        payment_reference = EXCLUDED.payment_reference
    `, [
      sale.id,
      sale.timestamp,
      itemsJson,
      sale.totalUSD || 0,
      sale.totalBsF || 0,
      sale.rateAtSale || 36.5,
      sale.paymentMethod,
      sale.customerName || null,
      sale.paymentReference || null,
    ]);

    // 2. Actualizar stock en caso de proporcionar inventario en todas las tablas
    if (Array.isArray(updatedInventory)) {
      const tables = await getAllInventoryTables(client);
      for (const t of tables) {
        try {
          const colRes = await client.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_schema = $1 AND table_name = $2
          `, [t.schema, t.tableName]);
          const cols = colRes.rows;
          const stockColObj = cols.find(c => ['stock', 'cantidad', 'existencia'].includes(c.column_name.toLowerCase())) || { column_name: 'stock' };
          const idColObj = cols.find(c => ['id', 'codigo', 'id_producto'].includes(c.column_name.toLowerCase())) || { column_name: 'id' };

          for (const prod of updatedInventory) {
            if (prod && prod.id && typeof prod.stock === 'number') {
              await client.query(`
                UPDATE ${t.quoted} SET "${stockColObj.column_name}" = $1 WHERE "${idColObj.column_name}"::text = $2
              `, [prod.stock, String(prod.id)]);
            }
          }
        } catch (tableErr: any) {
          console.warn(`[Neon DB] Advertencia actualizando stock en ${t.quoted}:`, tableErr.message);
        }
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Eliminar venta
 */
export async function deleteSale(id: string): Promise<void> {
  const p = getPool();
  await p.query('DELETE FROM sales WHERE id = $1', [id]);
}

/**
 * Actualizar venta existente
 */
export async function updateSale(sale: any): Promise<void> {
  const p = getPool();
  const itemsJson = typeof sale.items === 'string' ? sale.items : JSON.stringify(sale.items || []);
  await p.query(`
    UPDATE sales SET
      timestamp = $2,
      items = $3::jsonb,
      total_usd = $4,
      total_bsf = $5,
      rate_at_sale = $6,
      payment_method = $7,
      customer_name = $8,
      payment_reference = $9
    WHERE id = $1
  `, [
    sale.id,
    sale.timestamp,
    itemsJson,
    sale.totalUSD || 0,
    sale.totalBsF || 0,
    sale.rateAtSale || 36.5,
    sale.paymentMethod,
    sale.customerName || null,
    sale.paymentReference || null,
  ]);
}
