/**
 * Servicios de Base de Datos para Neon.tech PostgreSQL.
 * Este archivo redirige a databaseService para mantener compatibilidad con todos los componentes existentes.
 */
import { databaseService } from './databaseService';

export { databaseService };
export const supabaseService = databaseService;
export default databaseService;
