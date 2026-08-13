import { schemaMigrations } from "@nozbe/watermelondb/Schema/migrations";

/**
 * Migraciones del esquema local.
 *
 * ⚠️ CADA BUMP DE SCHEMA_VERSION NECESITA SU PASO ACÁ, EN EL MISMO COMMIT. Sin la
 * migración, WMDB no tiene cómo actualizar la base del teléfono y **la borra** — con los
 * recibos del día adentro si la bitácora todavía no cerró, que es cuando el teléfono es
 * el único lugar donde existen.
 *
 * Vacío mientras la versión sea 1: no hay nada de dónde migrar.
 */
export const migrations = schemaMigrations({ migrations: [] });
