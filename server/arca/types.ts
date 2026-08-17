export interface ArcaCredentials {
  cuit: string;
  environment: 'homologation' | 'production';
  certificateBase64: string;
  privateKeyBase64: string;
  pointOfSale: string;
}

export type ArcaResult = 'AUTHORIZED' | 'REJECTED' | 'ERROR' | 'UNKNOWN';

export interface ArcaInvoiceResponse {
  result: ArcaResult;
  cae?: string;
  caeFchVto?: string;
  cbteTipo?: number;
  ptoVta?: number;
  cbteDesde?: number;
  cbteHasta?: number;
  errors?: any;
  rawResponse?: any;
}
