export interface PaymentProvider {
    name: string;
    createPayment(saleId: string, amount: number, terminalId: string, idempotencyKey: string): Promise<any>;
    getPaymentStatus(paymentId: string): Promise<any>;
    handleWebhook(data: any): Promise<any>;
}

export interface PaymentTerminal {
    id: string;
    businessId: string;
    provider: string;
    terminalId: string;
    displayName: string;
    status: 'ACTIVE' | 'INACTIVE';
}
