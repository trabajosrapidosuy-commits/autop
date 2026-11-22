import type { ConnectorCapability, SourceProduct } from '../types';
import type { SourceConnector, ConnectorSearchOptions } from '../services/connectors/types';

export class CatalogIntegrationError extends Error {
  constructor(readonly code: 'catalog_disabled' | 'catalog_unavailable' | 'catalog_budget_exhausted' | 'catalog_read_only' | 'catalog_query_denied') {
    super(code);
  }
}

const products: SourceProduct[] = ['A', 'B'].map((sku, index) => ({
  id: `synthetic-catalog-${sku.toLowerCase()}`, connectorId: 'synthetic-catalog', platform: 'SIMULADO',
  sourceUrl: `https://catalog.example.invalid/${sku}`, sourceSku: `SIMULADO-${sku}`,
  sourceTitle: `SIMULADO · accesorio de catálogo ${sku}`, sourceImages: [], sourceCost: 100 + index,
  sourceCurrency: 'UYU', sourceShippingCost: 0, estimatedDeliveryDaysMin: 0, estimatedDeliveryDaysMax: 0,
  inStock: false, supplierName: 'SIMULADO · sin proveedor comercial', supplierCountry: 'SIMULADO',
  rawAttributes: { simulation: true, readOnly: true, purchasable: false },
  lastVerifiedAt: '2026-11-21T00:00:00.000Z', status: 'raw',
}));

/** Opt-in fixture implementing the existing connector contract. Never registered in the production directory.
 * No SDK, credentials, network, purchase, import, stock claim or product publication capability.
 */
export class SyntheticCatalogConnector implements SourceConnector {
  readonly id = 'synthetic-catalog';
  readonly name = 'SIMULADO · catálogo sintético de solo lectura';
  readonly platform = 'Direct Import' as const;
  readonly capabilities: ConnectorCapability[] = ['search'];
  #calls = 0;
  #maxCalls: number;
  constructor(private readonly controls: { enabled: () => boolean; available: () => boolean; maxCalls: number }) {
    if (!Number.isSafeInteger(controls.maxCalls) || controls.maxCalls < 1 || controls.maxCalls > 8
      || typeof controls.enabled !== 'function' || typeof controls.available !== 'function') throw Error('invalid_catalog_controls');
    this.#maxCalls = controls.maxCalls;
  }
  get consumedCalls() { return this.#calls; }
  getStatus() { return this.controls.enabled() === true ? 'IMPLEMENTED' as const : 'NOT_CONFIGURED' as const; }
  getStatusReason() { return 'SIMULADO; fixture local sin acceso comercial. Máximo 8 lecturas por instancia del host.'; }
  isConfigured() { return this.controls.enabled() === true; }
  async searchProducts(options: ConnectorSearchOptions): Promise<SourceProduct[]> {
    if (this.controls.enabled() !== true) throw new CatalogIntegrationError('catalog_disabled');
    if (this.controls.available() !== true) throw new CatalogIntegrationError('catalog_unavailable');
    if (!options || Object.keys(options).some(key => key !== 'limit')
      || !Number.isSafeInteger(options.limit) || options.limit! < 1 || options.limit! > products.length)
      throw new CatalogIntegrationError('catalog_query_denied');
    if (this.#calls >= this.#maxCalls) throw new CatalogIntegrationError('catalog_budget_exhausted');
    // Reserve synchronously before yielding: concurrent calls cannot exceed the host's quota.
    this.#calls++;
    return structuredClone(products.slice(0, options.limit));
  }
  async getProductByUrl(): Promise<never> { throw new CatalogIntegrationError('catalog_read_only'); }
  async verifyAvailabilityAndPrice(): Promise<never> { throw new CatalogIntegrationError('catalog_read_only'); }
  async createPurchaseOrder(): Promise<never> { throw new CatalogIntegrationError('catalog_read_only'); }
  async getTracking(): Promise<never> { throw new CatalogIntegrationError('catalog_read_only'); }
}
