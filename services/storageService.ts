import { Sale, Product } from '../types';

/**
 * Genera un identificador único compatible con UUID v4 en cualquier entorno
 * (incluso en contextos HTTP no seguros, WebViews móviles o navegadores antiguos donde crypto.randomUUID no existe).
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      // Continuar con fallback si el navegador restringe el uso
    }
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
      bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10xx
      const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}`;
    } catch {
      // Fallback a Math.random
    }
  }

  // Fallback universal RFC4122 v4 basado en Math.random y timestamp
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Servicio de almacenamiento local ultra-seguro contra errores de cuota (QuotaExceededError).
 * Evita bloqueos en navegadores móviles y laptops liberando espacio automáticamente.
 */

// Limpia claves pesadas redundantes y copias rodantes antiguas de LocalStorage
export function cleanStorageQuota(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('venstore_backup_') || key.startsWith('temp_') || key.includes('_backup_'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => {
      try {
        localStorage.removeItem(k);
      } catch (e) {
        // Ignorar
      }
    });
  } catch (e) {
    console.warn('No se pudo limpiar almacenamiento redundante:', e);
  }
}

// Guarda de manera segura en localStorage sin arrojar jamás una excepción no controlada
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`[StorageService] Error de cuota al guardar "${key}". Liberando espacio...`, err);
    
    // Paso 1: Limpiar copias rodantes y temporales
    cleanStorageQuota();

    try {
      localStorage.setItem(key, value);
      return true;
    } catch (retryErr) {
      // Paso 2: Si es el historial de ventas o inventario, guardar una versión optimizada
      if (key === 'venstore_sales') {
        try {
          const sales: Sale[] = JSON.parse(value);
          if (Array.isArray(sales)) {
            // Guardar solo las últimas 150 ventas más recientes en la caché local
            const trimmedSales = sales.slice(-150);
            localStorage.setItem(key, JSON.stringify(trimmedSales));
            console.log('[StorageService] Guardadas las últimas 150 ventas en caché local.');
            return true;
          }
        } catch (parseErr) {
          // Ignorar
        }
      }

      console.error(`[StorageService] Almacenamiento local lleno. No se pudo guardar "${key}".`, retryErr);
      return false;
    }
  }
}

// Lectura segura
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn(`[StorageService] Error al leer "${key}":`, e);
    return null;
  }
}

// Eliminación segura
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn(`[StorageService] Error al eliminar "${key}":`, e);
  }
}

// Ejecutar limpieza preventiva de claves obsoletas al cargar
cleanStorageQuota();
