import { dbAdmin } from '../server';
import { MercadoPagoPointProvider } from './providers/mercadoPagoPointProvider';

export class PaymentService {
    static async getProvider(businessId: string, providerName: string) {
        // Fetch secrets from Firestore securely (only accessible by Admin SDK)
        const secretDoc = await dbAdmin.collection(`businesses/${businessId}/secrets`).doc(providerName).get();
        
        if (!secretDoc.exists) {
            throw new Error('PROVIDER_NOT_CONFIGURED');
        }

        const credentials = secretDoc.data();

        if (providerName === 'MERCADO_PAGO_POINT') {
            return new MercadoPagoPointProvider(businessId, credentials);
        }
        
        throw new Error('PROVIDER_NOT_IMPLEMENTED');
    }
}
