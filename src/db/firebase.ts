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
export * from './serviceOrders';
export * from './dispatchIndex';
export * from './addresses';
export * from './monthlySummaries';

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
