import { onAuthStateChanged } from 'firebase/auth';
import { authInstance, dbInstance, firebaseActive } from './core';

// Re-export all modular domain services (Universal Barrel Facade)
export * from './core';
export * from './qrTemplates';
export * from './organization';
export * from './audit';
export * from './templates';
export * from './preventiveEngine';
export * from './users';
export * from './permissions';
export * from './assets';
export * from './assetSync';
export * from './orderSync';
export * from './checklistVersions';
export * from './orderStarts';
export * from './executionDraft';
export * from './executionTeam';
export * from './serviceOrders';
export * from './dispatchIndex';
export * from './addresses';
export * from './monthlySummaries';
export * from './profiles';
export * from './workforce';
export * from './materials';
export * from './cycle';
export * from './dispatch';
export * from './planning';
export * from './manHours';
export * from './solicitations';
// Disjuntor do banco (proteção contra loops): só o que as telas usam
export { runBulk, onGuardTrip, guardTripped, GuardError } from './guard';
export type { GuardTrip } from './guard';
export * from './orderControl';

// Internal module imports for orchestration
import { clearAssetsCache, dbGetAssets } from './assets';
import {
  clearServiceOrdersCache,
  clearHistoriesCache,
  clearPlanningDeadlinesCache,
  dbGetServiceOrders,
  dbSavePlanningDeadline,
  appendServiceOrdersCache
} from './serviceOrders';
import { clearUsersCache, dbGetUsers } from './users';
import { clearPermissionsCache, dbGetPermissions } from './permissions';
import { clearTemplatesCache, dbGetTemplates } from './templates';
import { clearOrganizationCache, dbGetManagements, dbGetUnits } from './organization';
import { clearAuditCache } from './audit';
import { clearQrTemplatesCache } from './qrTemplates';
import { configurePreventiveEngineDeps } from './preventiveEngine';
import { clearProfilesCache } from './profiles';
import { clearWorkforceCache } from './workforce';
import { clearMaterialsCache } from './materials';

/**
 * Invalidate all domain-specific caches and pending promises across the system
 */
export function clearAllCaches(): void {
  clearAssetsCache();
  clearServiceOrdersCache();
  clearHistoriesCache();
  clearPlanningDeadlinesCache();
  clearUsersCache();
  clearPermissionsCache();
  clearTemplatesCache();
  clearOrganizationCache();
  clearAuditCache();
  clearQrTemplatesCache();
  clearProfilesCache();
  clearWorkforceCache();
  clearMaterialsCache();
}

/**
 * Force refetch of all core data entities across all modules
 */
export async function forceRefetchAllData(): Promise<void> {
  try {
    localStorage.removeItem('hexon_cache_timestamps');
  } catch (e) {
    console.warn('Error clearing cache timestamps:', e);
  }
  clearAllCaches();
  if (firebaseActive && dbInstance) {
    await Promise.all([
      dbGetPermissions().catch(() => ({})),
      dbGetUsers().catch(() => []),
      dbGetAssets().catch(() => []),
      dbGetServiceOrders().catch(() => []),
      dbGetTemplates().catch(() => []),
      dbGetManagements().catch(() => []),
      dbGetUnits().catch(() => [])
    ]);
  }
}

/**
 * React Firebase Authentication Subscriber
 */
export function subscribeToAuth(callback: (user: any) => void) {
  if (authInstance) {
    return onAuthStateChanged(authInstance, (user) => {
      // Clear cache and pending promises on auth state change to prevent leaks and load correct user profiles instantly
      clearAllCaches();
      callback(user);
    });
  }
  // Schedule fallback callback check immediately so the application boot sequence resolves without getting stuck
  setTimeout(() => {
    callback(null);
  }, 50);
  return () => {};
}

// Wire dependencies for the preventive maintenance generation engine
configurePreventiveEngineDeps({
  getAssets: dbGetAssets,
  getServiceOrders: dbGetServiceOrders,
  saveDeadline: dbSavePlanningDeadline,
  appendServiceOrdersCache: appendServiceOrdersCache
});
