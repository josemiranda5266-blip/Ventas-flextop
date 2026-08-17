import { PaymentProvider } from '../types';
import { dbAdmin } from '../../server';
import { MercadoPagoConfig, MerchantOrder, Payment } from 'mercadopago';

export class MercadoPagoPointProvider implements PaymentProvider {
    name = 'MERCADO_PAGO_POINT';

    constructor(private businessId: string, private credentials: any) {}

    private getClient() {
        return new MercadoPagoConfig({ accessToken: this.credentials.accessToken });
    }

    async createPayment(saleId: string, amount: number, terminalId: string, idempotencyKey: string) {
        // 1. Verify terminal ownership and enablement
        const terminalDoc = await dbAdmin.collection(`businesses/${this.businessId}/terminals`).doc(terminalId).get();
        if (!terminalDoc.exists || terminalDoc.data()?.status !== 'ACTIVE') {
            throw new Error('DEVICE_NOT_FOUND_OR_INACTIVE');
        }

        const client = this.getClient();
        
        // POST /v1/orders
        // Requires: type=point, external_reference, device_id in body
        const response = await fetch('https://api.mercadopago.com/v1/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.credentials.accessToken}`,
                'Content-Type': 'application/json',
                'X-Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify({
                type: 'point',
                external_reference: saleId,
                device_id: terminalId,
                items: [{
                    title: `Venta ${saleId}`,
                    quantity: 1,
                    unit_price: amount
                }]
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`MP_API_ERROR: ${error.message}`);
        }

        return await response.json();
    }

    async getPaymentStatus(paymentId: string) {
        // GET /v1/payments/{paymentId}
        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
            headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (!response.ok) throw new Error('MP_API_ERROR');
        return await response.json();
    }

    async handleWebhook(data: any) {
        // Verification is done in server.ts
        // This is a placeholder for any extra processing needed
        return { status: 'OK' };
    }

    async cancelPayment(paymentId: string) {
        // DELETE /v1/orders/{orderId}
        const response = await fetch(`https://api.mercadopago.com/v1/orders/${paymentId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${this.credentials.accessToken}` }
        });
        if (!response.ok) throw new Error('MP_API_ERROR');
        return await response.json();
    }

    async refundPayment(paymentId: string, amount?: number) {
        // POST /v1/payments/{paymentId}/refunds
        const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}/refunds`, {
            method: 'POST',
            headers: { 
                'Authorization': `Bearer ${this.credentials.accessToken}`,
                'Content-Type': 'application/json'
            },
            body: amount ? JSON.stringify({ amount }) : undefined
        });
        if (!response.ok) throw new Error('MP_API_ERROR');
        return await response.json();
    }
}
