/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum UserRole {
  ADMINISTRADOR = 'ADMINISTRADOR',
  ENCARGADO = 'ENCARGADO',
  CAJERO = 'CAJERO',
  VENDEDOR = 'VENDEDOR',
  AUDITOR = 'AUDITOR',
}

export enum CashSessionStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum SaleStatus {
  COMPLETED = 'COMPLETED',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export enum PaymentMethod {
  EFECTIVO = 'EFECTIVO',
  DEBITO = 'DEBITO',
  CREDITO = 'CREDITO',
  TRANSFERENCIA = 'TRANSFERENCIA',
  MERCADO_PAGO = 'MERCADO_PAGO',
  CUENTA_CORRIENTE = 'CUENTA_CORRIENTE',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}

export enum StockMovementType {
  COMPRA = 'COMPRA',
  VENTA = 'VENTA',
  ENTRADA = 'ENTRADA',
  SALIDA = 'SALIDA',
  AJUSTE = 'AJUSTE',
  DEVOLUCION = 'DEVOLUCION',
}

export interface Business {
  id: string;
  name: string;
  cuit: string;
  taxCondition: string; // e.g., 'Responsable Inscripto', 'Monotributista', 'Exento'
  createdAt: string;
}

export interface Branch {
  id: string;
  name: string;
  address: string;
  createdAt: string;
}

export interface CashRegister {
  id: string;
  branchId: string;
  name: string;
  status: 'OPEN' | 'CLOSED';
  createdAt: string;
}

export interface UserProfile {
  id: string; // Auth UID
  email: string;
  name: string;
  role: UserRole;
  branchId: string;
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  createdAt: string;
}

export interface Product {
  id: string;
  code: string; // SKU or internal code
  barcode: string; // Barcode scanned by laser reader
  sku: string;
  name: string;
  description: string;
  categoryId: string;
  costPrice: number;
  salePrice: number;
  margin: number; // calculated mark-up
  taxRate: number; // e.g., 21, 10.5, 0 (IVA %)
  stock: number;
  minStock: number;
  maxStock: number;
  supplierId: string;
  imageUrl?: string;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  dni?: string;
  cuit?: string;
  taxCondition: string; // 'Consumidor Final', 'Responsable Inscripto', 'Monotributo'
  email?: string;
  phone?: string;
  address?: string;
  creditLimit: number;
  balance: number; // current debt in cuenta corriente
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

export interface CashSession {
  id: string;
  registerId: string;
  branchId: string;
  openedBy: string; // user UID
  openedByName?: string;
  openedAt: string;
  closedAt?: string;
  initialCash: number;
  expectedCash: number; // opening + cash sales + cash inputs - cash withdrawals
  declaredCash?: number;
  difference?: number;
  status: CashSessionStatus;
}

export interface CashMovement {
  id: string;
  sessionId: string;
  type: 'INGRESAR' | 'RETIRAR';
  amount: number;
  reason: string;
  userId: string;
  userName?: string;
  createdAt: string;
}

export interface Sale {
  id: string;
  branchId: string;
  registerId: string;
  sessionId: string;
  userId: string;
  userName?: string;
  customerId?: string;
  customerName?: string;
  subtotal: number;
  discount: number; // percentage or fixed amount
  surcharge: number;
  taxTotal: number; // IVA sum
  total: number;
  paymentMethod: string; // 'EFECTIVO', 'MIXTO', etc.
  status: SaleStatus;
  isFiscal: boolean; // if invoice has been emitted or pending
  createdAt: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  taxRate: number; // IVA %
  subtotal: number;
}

export interface Payment {
  id: string;
  saleId: string;
  method: PaymentMethod;
  amount: number;
  reference?: string;
  status: PaymentStatus;
  createdAt: string;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName?: string;
  type: StockMovementType;
  qtyPrevious: number;
  qtyChange: number; // positive or negative
  qtyAfter: number;
  reason: string;
  userId: string;
  userName?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface ArcaConfig {
  cuit: string;
  environment: 'DESARROLLO' | 'HOMOLOGACION' | 'PRODUCCION';
  pointOfSale: number;
  certificate?: string;
  privateKey?: string;
  lastError?: string;
  lastSyncAt?: string;
}

export interface Invoice {
  id: string;
  saleId: string;
  invoiceType: string; // e.g., 'A', 'B', 'C', 'NC-A', 'NC-B'
  pointOfSale: number;
  invoiceNumber: number;
  cae?: string;
  caeExpiration?: string;
  status: 'APPROVED' | 'PENDING_SYNC' | 'REJECTED';
  xmlRequest?: string;
  xmlResponse?: string;
  errorDetails?: string;
  createdAt: string;
}
